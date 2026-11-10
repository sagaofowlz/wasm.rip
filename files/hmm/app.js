
"use strict";

// iPad Safari compatibility: async iterator disposal.
if (typeof Symbol.asyncDispose !== "symbol") {
  Object.defineProperty(Symbol, "asyncDispose", {
    configurable: true,
    value: Symbol.for("Symbol.asyncDispose")
  });
}

if (globalThis.FileSystemDirectoryHandle) {
  const directoryPrototype = FileSystemDirectoryHandle.prototype;
  const originalValues = directoryPrototype.values;

  if (
    typeof originalValues === "function" &&
    !directoryPrototype.__hmmAsyncDisposePatched
  ) {
    Object.defineProperty(directoryPrototype, "__hmmAsyncDisposePatched", {
      value: true
    });

    directoryPrototype.values = function (...args) {
      const iterator = originalValues.apply(this, args);
      const disposeSymbol = Symbol.asyncDispose;

      if (
        iterator &&
        typeof iterator[disposeSymbol] !== "function"
      ) {
        Object.defineProperty(iterator, disposeSymbol, {
          configurable: true,
          value() {
            return typeof this.return === "function"
              ? this.return()
              : Promise.resolve();
          }
        });
      }

      return iterator;
    };
  }
}

const ASSET_MANIFEST = "./asset-manifest.json";
const STARFAIT_ENTRY = "./runtime/starfait/entry.json";
const OPFS_BUNDLE_DIR = "hmm-undertale-bundle";
const OPFS_SAVE_DIR = "hmm-undertale-saves";
const OPFS_META_DIR = "hmm-undertale-meta";

const $ = (id) => document.getElementById(id);
const canvas = $("game-canvas");
const debugPanel = $("debug-panel");
const debugToggle = $("debug-toggle");

let starfait = null;
let runnerStarted = false;
let audioUnlocked = false;
let startPromise = null;
let startupStage = "initialising";

const heldKeys = new Set();

function log(message) {
  const output = $("debug-output");
  const time = new Date().toLocaleTimeString();

  output.textContent += "\n[" + time + "] " + String(message);
  output.scrollTop = output.scrollHeight;
}

function setDebugVisible(visible) {
  debugPanel.hidden = !visible;
  debugToggle.setAttribute("aria-expanded", String(visible));
}

function toggleDebug() {
  setDebugVisible(debugPanel.hidden);
}

function describeError(error) {
  if (error === null) return "Thrown value: null";
  if (error === undefined) return "Thrown value: undefined";

  if (typeof error !== "object" && typeof error !== "function") {
    return "Thrown " + typeof error + ": " + String(error);
  }

  try {
    const name = error.name == null ? "" : String(error.name);
    const message = error.message == null ? "" : String(error.message);

    return [name, message].filter(Boolean).join(": ") ||
      Object.prototype.toString.call(error) + " (no name/message)";
  } catch (_) {
    return "Could not inspect thrown error";
  }
}

function describeThrownValue(error) {
  if (error === null) return "Raw thrown value: null";
  if (error === undefined) return "Raw thrown value: undefined";

  try {
    return "Raw thrown value: " +
      (JSON.stringify(error) || Object.prototype.toString.call(error));
  } catch (_) {
    return "Raw thrown value: [unserializable]";
  }
}

function formatConsoleArgument(value) {
  if (typeof value === "string") return value;

  if (value instanceof Error) {
    return value.stack || value.message || String(value);
  }

  try {
    const result = JSON.stringify(value);

    return result === undefined
      ? String(value)
      : result;
  } catch (_) {
    try {
      return String(value);
    } catch (_) {
      return "[unprintable value]";
    }
  }
}

function captureStarfaitConsole() {
  if (window.__hmmConsoleCaptureInstalled) return;

  window.__hmmConsoleCaptureInstalled = true;

  const methods = ["log", "info", "warn", "error", "debug"];

  for (const method of methods) {
    const original = console[method];

    if (typeof original !== "function") continue;

    try {
      console[method] = function (...args) {
        log(
          "[Starfait console." + method + "] " +
          args.map(formatConsoleArgument).join(" ")
        );

        return original.apply(console, args);
      };
    } catch (error) {
      log(
        "Could not intercept console." + method + ": " +
        formatConsoleArgument(error)
      );
    }
  }

  window.addEventListener("error", (event) => {
    log(
      "[JavaScript window error] " +
      (event.message || "Unknown error")
    );

    if (event.error) {
      log("[JavaScript error detail] " + describeError(event.error));
    }
  });

  window.addEventListener("unhandledrejection", (event) => {
    log("[Unhandled rejection] " + describeError(event.reason));
    log(describeThrownValue(event.reason));
  });

  log("Starfait console interception installed before module import.");
}

captureStarfaitConsole();

async function fetchJson(path) {
  const response = await fetch(new URL(path, import.meta.url), {
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(
      "Could not load " + path +
      " (HTTP " + response.status + ")."
    );
  }

  return response.json();
}

async function loadStarfaitModule() {
  const entryInfo = await fetchJson(STARFAIT_ENTRY);

  if (
    typeof entryInfo.entry !== "string" ||
    entryInfo.entry.includes("..")
  ) {
    throw new Error(
      "Starfait build did not provide a valid module entry point."
    );
  }

  const moduleUrl = new URL(
    "./runtime/starfait/" + entryInfo.entry,
    import.meta.url
  );

  log("Importing Starfait module…");

  const namespace = await import(moduleUrl.href);
  const api = namespace.default || namespace;

  const required = [
    "createRunner",
    "startRunner",
    "onKeyDown",
    "onKeyUp",
    "resumeAudioContext"
  ];

  const missing = required.filter(
    (name) => typeof api[name] !== "function"
  );

  if (missing.length) {
    throw new Error(
      "Starfait module is missing exports: " +
      missing.join(", ")
    );
  }

  log("Starfait WebAssembly module loaded.");

  return api;
}

async function getDirectory(parent, name) {
  return parent.getDirectoryHandle(name, {
    create: true
  });
}

async function writeOPFSFile(directory, name, bytes) {
  const handle = await directory.getFileHandle(name, {
    create: true
  });

  const writable = await handle.createWritable();

  try {
    await writable.write(bytes);
    await writable.close();
  } catch (error) {
    try {
      await writable.abort();
    } catch (_) {}

    throw error;
  }
}

async function fileHasExpectedSize(directory, item) {
  try {
    const file = await (
      await directory.getFileHandle(item.name)
    ).getFile();

    return file.size === item.size;
  } catch (_) {
    return false;
  }
}

async function isBundleCached(
  bundleDirectory,
  metaDirectory,
  manifest,
  items
) {
  try {
    const versionFile = await (
      await metaDirectory.getFileHandle("asset-version.txt")
    ).getFile();

    const version = (await versionFile.text()).trim();

    if (!manifest.version || version !== manifest.version) {
      return false;
    }

    for (const item of items) {
      if (!(await fileHasExpectedSize(bundleDirectory, item))) {
        return false;
      }
    }

    return true;
  } catch (_) {
    return false;
  }
}

function makeAssetUrl(path) {
  const safePath = path
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");

  return new URL("./" + safePath, import.meta.url);
}

async function downloadAsset(
  item,
  bundleDirectory,
  label,
  index,
  total
) {
  const response = await fetch(makeAssetUrl(item.path), {
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(
      "Could not download " + item.path +
      " (HTTP " + response.status + ")."
    );
  }

  const bytes = await response.arrayBuffer();

  if (
    item.size != null &&
    bytes.byteLength !== item.size
  ) {
    throw new Error(
      "Size mismatch for " + item.path +
      ": expected " + item.size +
      ", got " + bytes.byteLength + "."
    );
  }

  await writeOPFSFile(
    bundleDirectory,
    item.name,
    bytes
  );

  log(
    "Cached " + label + " " +
    (index + 1) + "/" + total +
    ": " + item.name +
    " (" + bytes.byteLength.toLocaleString() +
    " bytes)."
  );
}

async function cacheGameAssets(manifest, rootDirectory) {
  if (!manifest.game || manifest.game.name !== "game.unx") {
    throw new Error("This build has no game.unx archive.");
  }

  if (!Array.isArray(manifest.music)) {
    throw new Error("The asset manifest has an invalid music list.");
  }

  const music = manifest.music.map((item) => {
    if (
      !item ||
      typeof item.path !== "string" ||
      typeof item.name !== "string" ||
      item.name.includes("/") ||
      item.name.includes("\\")
    ) {
      throw new Error(
        "The asset manifest contains an invalid music entry."
      );
    }

    return item;
  });

  const items = [manifest.game, ...music];

  const expectedNames = new Set(
    items.map((item) => item.name)
  );

  if (expectedNames.size !== items.length) {
    throw new Error("Two game assets have the same filename.");
  }

  const bundleDirectory = await getDirectory(
    rootDirectory,
    OPFS_BUNDLE_DIR
  );

  const metaDirectory = await getDirectory(
    rootDirectory,
    OPFS_META_DIR
  );

  if (
    await isBundleCached(
      bundleDirectory,
      metaDirectory,
      manifest,
      items
    )
  ) {
    log(
      "Game files already exist in this browser's private storage; skipping download."
    );

    return bundleDirectory;
  }

  log("Preparing game files in OPFS…");

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];

    await downloadAsset(
      item,
      bundleDirectory,
      item === manifest.game ? "game archive" : "audio file",
      index,
      items.length
    );
  }

  for await (const [name, handle] of bundleDirectory.entries()) {
    if (
      handle.kind === "file" &&
      !expectedNames.has(name)
    ) {
      await bundleDirectory.removeEntry(name);
    }
  }

  await writeOPFSFile(
    metaDirectory,
    "asset-version.txt",
    new TextEncoder().encode(
      String(manifest.version || "")
    )
  );

  log("Game assets cached.");

  return bundleDirectory;
}

async function unlockAudioFromUserGesture() {
  if (!runnerStarted || !starfait || audioUnlocked) {
    return;
  }

  try {
    starfait.resumeAudioContext();
    audioUnlocked = true;
    log("Browser audio context resumed.");
  } catch (error) {
    log("Audio resume error: " + describeError(error));
  }
}

async function startGame() {
  if (startPromise) return startPromise;

  startPromise = (async () => {
    try {
      log("Starting Undertale webport…");

      startupStage = "loading Starfait module";
      starfait = await loadStarfaitModule();

      startupStage = "loading asset manifest";
      const manifest = await fetchJson(ASSET_MANIFEST);

      if (!manifest || typeof manifest !== "object") {
        throw new Error("Invalid game asset manifest.");
      }

      log("Asset manifest loaded.");

      startupStage = "checking OPFS support";

      if (!navigator.storage?.getDirectory) {
        throw new Error(
          "This browser does not support Origin Private File System (OPFS)."
        );
      }

      startupStage = "opening OPFS storage";
      const rootDirectory = await navigator.storage.getDirectory();

      try {
        const persistent = await navigator.storage.persist?.();

        log(
          persistent
            ? "Persistent browser storage granted."
            : "Browser storage is available; persistence may depend on browser policy."
        );
      } catch (error) {
        log(
          "Could not request persistent storage: " +
          describeError(error)
        );
      }

      startupStage = "caching game assets";
      await cacheGameAssets(manifest, rootDirectory);

      startupStage = "opening save directory";
      await getDirectory(rootDirectory, OPFS_SAVE_DIR);

      startupStage = "Starfait createRunner";

      log("Creating Starfait runner…");
      log("Browser: " + navigator.userAgent);
      log("WebAssembly: " + typeof WebAssembly);
      log("WebGL2: " + Boolean(canvas.getContext("webgl2")));

      log("Calling Starfait createRunner now…");

      const result = await starfait.createRunner(
        OPFS_BUNDLE_DIR,
        OPFS_SAVE_DIR,
        "game.unx",
        canvas
      );

      log("Starfait createRunner returned: " + String(result));

      if (result === false) {
        throw new Error(
          "Starfait refused to initialise the game archive."
        );
      }

      startupStage = "Starfait startRunner";

      starfait.startRunner(
        () => log("Starfait game loop ended.")
      );

      runnerStarted = true;
      canvas.focus();

      log("Runner started. Keyboard input is ready.");

      startupStage = "completed";
    } catch (error) {
      log("BOOT ERROR during: " + startupStage);
      log("Error summary: " + describeError(error));
      log(describeThrownValue(error));

      try {
        if (error && error.stack) {
          log("Stack: " + String(error.stack));
        }
      } catch (_) {
        log("Stack could not be read.");
      }

      if (startupStage === "Starfait createRunner") {
        try {
          if (
            starfait &&
            typeof starfait.getCreateRunnerDiagnostic === "function"
          ) {
            log("Starfait internal diagnostic:");
            log(starfait.getCreateRunnerDiagnostic());
          } else {
            log(
              "Starfait internal diagnostic export unavailable."
            );
          }
        } catch (diagnosticError) {
          log(
            "Could not read Starfait internal diagnostic: " +
            describeError(diagnosticError)
          );
        }
      }

      setDebugVisible(true);
      throw error;
    }
  })();

  return startPromise;
}

const FALLBACK_KEY_CODES = {
  ArrowLeft: 37,
  ArrowUp: 38,
  ArrowRight: 39,
  ArrowDown: 40,
  Enter: 13,
  ShiftLeft: 16,
  ShiftRight: 16,
  ControlLeft: 17,
  ControlRight: 17,
  Escape: 27,
  Space: 32,
  Tab: 9,
  KeyZ: 90,
  KeyX: 88,
  KeyC: 67,
  KeyW: 87,
  KeyA: 65,
  KeyS: 83,
  KeyD: 68
};

function getGameKeyCode(event) {
  const code = Number(
    event.keyCode ||
    event.which ||
    FALLBACK_KEY_CODES[event.code] ||
    0
  );

  return Number.isInteger(code) &&
    code > 0 &&
    code < 256
    ? code
    : 0;
}

function sendKeyDown(code) {
  if (
    !code ||
    !runnerStarted ||
    !starfait ||
    heldKeys.has(code)
  ) {
    return;
  }

  heldKeys.add(code);
  starfait.onKeyDown(code);
}

function sendKeyUp(code) {
  if (!code || !heldKeys.has(code)) return;

  heldKeys.delete(code);

  if (runnerStarted && starfait) {
    starfait.onKeyUp(code);
  }
}

window.addEventListener("keydown", (event) => {
  if (event.key === "F1") {
    event.preventDefault();
    toggleDebug();
    return;
  }

  if (event.key === "F2") {
    event.preventDefault();

    if (!document.fullscreenElement) {
      $("stage").requestFullscreen?.().catch((error) =>
        log("Fullscreen error: " + describeError(error))
      );
    } else {
      document.exitFullscreen?.().catch((error) =>
        log("Fullscreen error: " + describeError(error))
      );
    }

    return;
  }

  if (
    [
      "ArrowUp",
      "ArrowDown",
      "ArrowLeft",
      "ArrowRight",
      " ",
      "Tab"
    ].includes(event.key)
  ) {
    event.preventDefault();
  }

  if (!audioUnlocked && starfait) {
    unlockAudioFromUserGesture();
  }

  sendKeyDown(getGameKeyCode(event));
});

window.addEventListener("keyup", (event) => {
  sendKeyUp(getGameKeyCode(event));
});

window.addEventListener("blur", () => {
  for (const code of [...heldKeys]) {
    sendKeyUp(code);
  }
});

canvas.addEventListener("pointerdown", () => {
  canvas.focus();

  if (!audioUnlocked && starfait) {
    unlockAudioFromUserGesture();
  }
});

canvas.addEventListener("contextmenu", (event) => {
  event.preventDefault();
});

debugToggle.addEventListener("click", (event) => {
  event.stopPropagation();
  toggleDebug();
});

if (
  new URLSearchParams(location.search).get("debug") === "1"
) {
  setDebugVisible(true);
}

log(
  "Keyboard: arrows / WASD, Z / Enter to confirm, X / Shift to cancel."
);

log("F1 = debug log. F2 = fullscreen.");

log("Game files and saves use OPFS. Runner: Starfait.");

startGame().catch(() => {});
