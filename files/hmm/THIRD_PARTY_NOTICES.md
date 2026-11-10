# Third-party notices

## Starfait

Starfait is developed by MrPowerGamerBR and is licensed under the Apache License,
Version 2.0. Source: https://github.com/MrPowerGamerBR/Starfait

The `hmm` Pages build checks out Starfait at commit
`2da1b9dd287fce70eae68a8e84b69816bdddd1a7` and applies one build-time change to
`starfait-runner-web/.../StarfaitRunner.kt`: it exports the existing web audio
resume method as `resumeAudioContext()` so the browser can unlock audio after
user interaction. The upstream source checkout and generated Wasm module are
not copied into the repository; the deployed site includes the upstream Apache
2.0 license text under `third-party/STARFAIT-LICENSE.txt`.

## @js-joda/core

`@js-joda/core` version `6.1.0` is used by Starfait's transitive
`kotlinx-datetime` WebAssembly dependency. The Pages workflow copies its ESM
build into the deployed site so the browser import map can resolve it locally.
It is licensed under BSD-3-Clause; the full license is deployed as
`third-party/JS-JODA-LICENSE.txt`. Source: https://github.com/js-joda/js-joda

Undertale game data and music are separate assets and are not part of Starfait.
