/* Original typed-input quad plan. No DOM, GL, input, cursor, or story mutation. */
const f = Math.fround;
const CHARS = "abcdefghijklmnopqrstuvwxyz0123456789!?.,\"';:()-ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function requireValue(condition, message) {
  if (!condition) throw new TypeError(message);
}

export function createAtlasInput(atlas) {
  requireValue(atlas?.schema === 'facade-typed-input-atlas-v1', 'Wrong atlas schema');
  requireValue(atlas.glyphs?.length === 73 && atlas.mapping?.count === 73, 'Expected 73 glyph records');
  const lookup = new Map();
  for (let i = 0; i < 73; i++) {
    const row = atlas.glyphs[i];
    const [x, y, width, height] = row.rectPixelsTopLeft ?? [];
    requireValue(row.index === i && row.byteCode === CHARS.charCodeAt(i) && row.character === CHARS[i], 'Wrong glyph order/code');
    requireValue([x, y, width, height].every(Number.isInteger) && x >= 0 && x + width <= 512 && width >= 24 && width <= 86 && height === 85, 'Invalid glyph rectangle');
    requireValue(y + height <= 512 && (i < 8 ? y === -3 : y >= 0), 'Invalid glyph Y/wrap edge');
    const stripId = row.byteCode >= 65 && row.byteCode <= 90 ? 41 : 40;
    requireValue(row.stripId === stripId && !lookup.has(row.byteCode), 'Invalid glyph texture/code');
    const uv = [[x / 512, 1 - (y + height) / 512], [x / 512, 1 - y / 512],
      [(x + width) / 512, 1 - y / 512], [(x + width) / 512, 1 - (y + height) / 512]];
    requireValue(JSON.stringify(row.uvQuadBottomLeftTopLeftTopRightBottomRight) === JSON.stringify(uv), 'Invalid glyph UVs');
    lookup.set(row.byteCode, { index: i, width, height, stripId, uv });
  }
  return Object.freeze({
    layout(bytes) {
      requireValue(bytes instanceof Uint8Array, 'Expected original byte string as Uint8Array');
      let length = bytes.indexOf(0);
      if (length < 0) length = bytes.length;
      const quads = [];
      let x = -95;
      let truncatedAt = null;
      for (let i = 0; i < length; i++) {
        // Native truncation is checked before processing the next character.
        if (x > 90) { truncatedAt = i; break; }
        const code = bytes[i];
        if (code === 32) { x = f(x + 30 * .125); continue; }
        const glyph = lookup.get(code);
        if (!glyph) continue;
        const right = f(x + glyph.width * .125);
        const top = f(-80 + glyph.height * .125);
        quads.push({ byteIndex: i, byteCode: code, glyphIndex: glyph.index, stripId: glyph.stripId,
          positions: [[x, -80, -5], [x, top, -5], [right, top, -5], [right, -80, -5]],
          uvs: glyph.uv.map(pair => [...pair]) });
        x = f((right - x) - f(.4) + x);
      }
      return { quads, endX: x, y: -80, z: -5, inputByteLength: length, truncatedAt,
        nativeTruncationSoundId: truncatedAt === null ? null : 29,
        state: { colorRgba: [1, 1, 1, 1], blendEnabled: false, alphaFunction: 'LESS', alphaReference: 1,
          minFilter: 'LINEAR', magFilter: 'LINEAR', wrapS: 'REPEAT', wrapT: 'REPEAT' } };
    },
  });
}

export function decodeAtlasBmp(bytes) {
  requireValue(bytes instanceof Uint8Array && bytes.byteLength >= 54, 'Truncated atlas BMP');
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  requireValue(v.getUint16(0, true) === 0x4d42 && v.getUint32(2, true) === bytes.byteLength && v.getUint32(6, true) === 0, 'Invalid BMP header');
  requireValue(v.getUint32(10, true) === 54 && v.getUint32(14, true) === 40 && v.getInt32(18, true) === 512 && v.getInt32(22, true) === 512, 'Unexpected atlas extent');
  requireValue(v.getUint16(26, true) === 1 && v.getUint16(28, true) === 24 && v.getUint32(30, true) === 0 && v.getUint32(34, true) === 0, 'Unsupported atlas BMP encoding');
  const pixelEnd = 54 + 512 * 512 * 3;
  requireValue(bytes.length === pixelEnd + 2 && bytes[pixelEnd] === 0 && bytes[pixelEnd + 1] === 0, 'Invalid atlas pixel length/trailer');
  const rgbaBottomUp = new Uint8Array(512 * 512 * 4);
  for (let source = 54, target = 0; source < pixelEnd; source += 3, target += 4) {
    const b = bytes[source], g = bytes[source + 1], r = bytes[source + 2];
    rgbaBottomUp[target] = r; rgbaBottomUp[target + 1] = g; rgbaBottomUp[target + 2] = b;
    rgbaBottomUp[target + 3] = Math.floor((r + g + b) / 3);
  }
  return { width: 512, height: 512, rgbaBottomUp, unpackFlipY: false };
}
