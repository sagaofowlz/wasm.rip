# Starfait browser runtime

The GitHub Pages workflow builds the Starfait `starfait-runner-web` Kotlin/Wasm
library from the pinned upstream commit `2da1b9dd287fce70eae68a8e84b69816bdddd1a7`.
It copies the generated `.mjs` and `.wasm` files into `runtime/starfait/` at
deploy time; generated binaries are not committed to this repository.

The client imports the generated Kotlin/Wasm module and calls these exported
functions:

- `createRunner(bundlePath, savePath, gameWADName, canvas)`
- `startRunner(onExit)`
- `onKeyDown(keyCode)`
- `onKeyUp(keyCode)`
- `resumeAudioContext()`

The last function is a small build-time patch to Starfait's web source. It
exposes the existing `WebAudioManager.resumeAudioContext()` so the page can
resume browser audio after the user's first key press or canvas interaction.

Game data and external audio are copied to OPFS before the runner starts.
Starfait loads the files in the bundle directory as a flat virtual filesystem;
therefore audio files from `mus/` are stored in OPFS by basename. The original
`.ogg` files remain in the web deployment's `mus/` folder.

Starfait is licensed under Apache License 2.0. See `THIRD_PARTY_NOTICES.md` and
the deployed `third-party/STARFAIT-LICENSE.txt`.
