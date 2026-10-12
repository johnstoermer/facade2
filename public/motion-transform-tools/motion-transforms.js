// Pure helpers for the finite, normal character-render path proved in README.
// No controller timing, pose composition, mutation, rendering, or GL state.
// Source GL/x87 precision is not an asserted bit-exact JavaScript guarantee.
const f = Math.fround;
export const ROOT_DEGREES_TO_RADIANS = f(0.017452778294682503);
const GL_DEGREES_TO_RADIANS = Math.PI / 180;
const group3Points = new Set([18, 19, 22, 23, 24, 25, 26, 27, 28, 29]);
const group2Points = [new Set([0, 1, 16, 17, 71, 72, 73, 74, 75]),
                new Set([0, 1, 6, 7, 16, 17, 44, 71, 72])];
const counts = [76, 73];
const pivots = [75, 44];

function scalar(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isFinite(f(value)))
    throw new TypeError('Expected a finite native float: ' + name);
  return f(value);
}
function triple(value, name) {
  if (!value || value.length !== 3) throw new TypeError('Expected XYZ: ' + name);
  return [0, 1, 2].map(i => scalar(value[i], name + '[' + i + ']'));
}
function actorCount(actorId) {
  if (actorId !== 0 && actorId !== 1) throw new RangeError('Expected original actor ID0 or1');
  return counts[actorId];
}

// Native100af4d0 stores a float after each +/-360. This helper rejects values
// whose subtraction cannot progress, rather than emulating a native hang.
export function wrapNativeDegrees(value) {
  let result = scalar(value, 'angle');
  while (result >= 360) {
    const next = f(result - 360);
    if (next === result) throw new RangeError('Angle is outside the native progressing domain');
    result = next;
  }
  while (result < 0) {
    const next = f(result + 360);
    if (next === result) throw new RangeError('Angle is outside the native progressing domain');
    result = next;
  }
  return result;
}

// basePrefix must be from the uncomposed BASE frame, not composePose's output.
// It may be the complete base Float32Array: only its first6 words are read.
export function resolveRootPrefix({basePosition, baseRotation, basePrefix}) {
  const position = triple(basePosition, 'basePosition');
  const rotation = triple(baseRotation, 'baseRotation');
  if (!basePrefix || basePrefix.length < 6) throw new TypeError('Missing base root prefix');
  const t = [0, 1, 2].map(i => scalar(basePrefix[i], 'root translation'));
  const r = [3, 4, 5].map(i => scalar(basePrefix[i], 'root rotation'));
  const theta = f(rotation[1] * ROOT_DEGREES_TO_RADIANS);
  const c = f(Math.cos(theta)), s = f(Math.sin(theta));
  const delta = [f(s * t[2] + c * t[0]), t[1], f(s * t[0] - c * t[2])];
  const worldRotation = rotation.map((v, i) => f(v + r[i]));
  worldRotation[1] = wrapNativeDegrees(worldRotation[1]);
  return {position: position.map((v, i) => f(v + delta[i])), rotation: worldRotation};
}

export function nativeBodyGroup(actorId, pointIndex) {
  const count = actorCount(actorId);
  if (!Number.isInteger(pointIndex) || pointIndex < 0 || pointIndex >= count)
    throw new RangeError('Point is outside the original body');
  return group3Points.has(pointIndex) ? 3 : group2Points[actorId].has(pointIndex) ? 2 : 1;
}

function rotationFor(dx, dy, dz) {
  const x = dx * GL_DEGREES_TO_RADIANS, y = dy * GL_DEGREES_TO_RADIANS,
        z = dz * GL_DEGREES_TO_RADIANS;
  return {cx: Math.cos(x), sx: Math.sin(x), cy: Math.cos(y), sy: Math.sin(y),
          cz: Math.cos(z), sz: Math.sin(z)};
}
function rotatePoint(point, pivot, a) {
  const x = point[0] - pivot[0], y = point[1] - pivot[1], z = point[2] - pivot[2];
  // GL call sequence Rx*Ry*Rz; a column vector encounters Z first.
  const zx = a.cz * x - a.sz * y, zy = a.sz * x + a.cz * y;
  const yx = a.cy * zx + a.sy * z, yz = -a.sy * zx + a.cy * z;
  return [yx + pivot[0], a.cx * zy - a.sx * yz + pivot[1],
          a.sx * zy + a.cx * yz + pivot[2]];
}

// center is the already-projected world center (native call args3/4). scale
// is the existing native body scaleGetter, including its0.625 body factor.
// points are already composed/prepared model points; no prefixes live here.
export function projectBodyPoints({actorId, points, worldRotation, cameraRotation,
                                   torsoYaw = 0, offAxisCorrection = 0,
                                   scale, center, pivotIndex = pivots[actorId]}) {
  const count = actorCount(actorId);
  if (!points || points.length !== count) throw new RangeError('Original point count required');
  if (!Number.isInteger(pivotIndex) || pivotIndex < -1 || pivotIndex >= count)
    throw new RangeError('Invalid projection pivot');
  const input = Array.from(points, (p, i) => triple(p, 'points[' + i + ']'));
  const world = triple(worldRotation, 'worldRotation'), camera = triple(cameraRotation, 'cameraRotation');
  const extra = scalar(torsoYaw, 'torsoYaw'), correction = scalar(offAxisCorrection, 'offAxisCorrection');
  if (!center || center.length < 2) throw new TypeError('Missing projected world center');
  const centerX = scalar(center[0], 'centerX'), centerY = scalar(center[1], 'centerY');
  const nativeScale = scalar(scale, 'scale');
  const baseY = wrapNativeDegrees(f(world[1] + correction));
  const fullY = f(baseY + extra), midY = f((fullY + baseY) / 2);
  const yaw = {1: fullY, 2: midY, 3: baseY};
  const pivot = pivotIndex < 0 ? [0, 0, 0] : input[pivotIndex];
  const transformed = new Array(count), projected = new Array(count), groups = new Array(count);
  for (const group of [3, 2, 1]) {
    const angles = rotationFor(f(world[0] - camera[0]), f(yaw[group] - camera[1]), f(world[2] - camera[2]));
    for (let i = 0; i < count; i++) {
      if (nativeBodyGroup(actorId, i) !== group) continue;
      const q = rotatePoint(input[i], pivot, angles);
      transformed[i] = q;
      projected[i] = [f(q[0] * 5.08 * nativeScale + centerX),
                      f((q[1] * 5.08 + 138) * nativeScale + centerY), f(-q[2] / 2000)];
      groups[i] = group;
    }
  }
  // Outline yaw follows its separate source expression, without the group's
  // torso offset or this routine's wrap360. Do not apply group yaw to rings.
  const outlineRelativeYaw = f(f(world[1] + correction) - camera[1]);
  return {points: projected, transformed, groups, pivotIndex,
          baseYaw: baseY, middleYaw: midY, fullYaw: fullY, outlineRelativeYaw};
}
