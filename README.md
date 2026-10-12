# Facade 2

An experimental, unofficial browser-local fan project based on Façade. Target website: [facade2.com](https://facade2.com).

Players need a compatible browser, with no account, API key, subscription, or installed game. Rendering, dialogue, speech recognition, and generated character voices run on the player's device. Cloudflare serves the code and download files.

## Playing

Choose a name and select **Start**. The loading bar downloads and warms the local models. Downloads are large: Qwen3.5 4B is about 2.4 GB, plus character voices and recognition. The browser caches these files. **Use recordings** skips AI preparation.

- **W/S:** forward/backward; **A/D:** sideways; **left/right arrows:** turn.
- Click the apartment door to knock. Walk inside after Trip opens it.
- **Enter** or **Talk:** type; Enter submits the message.
- **Mic:** opt into microphone capture. It pauses during character playback.
- **Stop:** interrupt replies and actions. **Menu:** dialogue, voices, restart.

Qwen3.5-4B is the default shared dialogue model. Trip and Grace have distinct personalities, shared recent context, and validated character commands. Corrected Chatterbox Turbo is the default generated voice. Original recorded lines remain available and take playback priority.

Characters are encouraged to respond rudely and use profanity when insulted directly. Casual swearing, praise, reported insults, and apologies receive context-sensitive treatment. This is model guidance, not a guarantee of every response.

## Status and limitations

This is a development slice, not the original complete drama engine or an official sequel. Original visuals and recordings are reused, but pixel-perfect native rendering and all original behavior are not established. Generated dialogue can be repetitive, misread context, or choose an invalid plan. The game checks supported commands, ownership, reachability, and actual outcomes.

Local AI requires hardware WebGPU with `shader-f16` and substantial memory. Layout support on small screens does not establish that a phone can run the models. Recognition has a local CPU fallback; dialogue and generated voices report failures rather than silently using a cloud service. Captions and original recordings remain available.

## Source and development

The repository contains the browser game code, pinned dependency manifests, a Cloudflare download handler, and hosting tests. Original game data, voice references, and model weights are excluded from Git. Their exact paths, sizes, and SHA-256 hashes are recorded in `asset-manifest.json`.

```sh
npm ci
npm run fetch-assets
npm run build
npm test
npm run dev
```

Asset download requires an available published asset origin. Maintainers with the existing development assets can instead run `node tools/import-game.mjs <browser-native-directory>` before building. This uses an explicit game dependency list and does not copy local account stores, browser profiles, development logs, or audition recordings.

With the development server running, `npm run qa` opens a separate headless Chrome profile, checks compact layouts and movement, warms the actual models, and tests a spoken reply from each character. It blocks microphone capture. Set `CHROME_PATH` for another Chrome installation; pass a site URL to test a deployment, or `--ui-only` to skip model loading. Results and screenshots stay in the ignored `test-artifacts/` directory.

Builds verify every binary hash. Cloudflare's per-file limit is handled by packaging large files in 24 MiB segments; the download handler reconstructs their HTTP response without changing the model bytes. It supports HEAD, conditional requests, byte ranges, cancellation, and explicit failure. This is file delivery only; inference and gameplay are not run on the server.

`wrangler.jsonc` pins the runtime and custom domain. After authenticating the domain's Cloudflare account, `npm run deploy` uploads the release. DNS/domain association and a successful live browser test must be verified before calling a release live. Deployment is currently manual; pushing Git does not deploy automatically.

## Credits and third-party material

Façade is © 2005–2006 Procedural Arts, created by Michael Mateas and Andrew Stern. Original voice performances are by Chloe Johnston and Andy Bayiates. This project is not affiliated with or endorsed by the original creators. Generated lines are synthetic and are not new performances by the original actors.

Qwen, MLC/WebLLM, Transformers.js, ONNX Runtime, Whisper, and Chatterbox retain their respective licenses and attribution. See `public/third-party/` and the pinned model manifests. Public source availability does not relicense the original game's material or third-party fonts.
