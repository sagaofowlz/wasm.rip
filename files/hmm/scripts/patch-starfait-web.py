
#!/usr/bin/env python3
"""Add audio support and internal createRunner diagnostics to Starfait."""
from pathlib import Path
import sys

if len(sys.argv) != 2:
    raise SystemExit("Usage: patch-starfait-web.py path/to/StarfaitRunner.kt")

path = Path(sys.argv[1])
source = path.read_text(encoding="utf-8")

# 1. Preserve the existing audio-resume export.
key_marker = "@JsExport\nfun onKeyDown(key: Int) {"

audio_patch = (
    "// Added by hmm: browser-gesture audio resume.\n"
    "@JsExport\n"
    "fun resumeAudioContext() {\n"
    "    (gRunner.audioManager as WebAudioManager).resumeAudioContext()\n"
    "}\n\n"
)

if "fun resumeAudioContext()" not in source:
    if source.count(key_marker) != 1:
        raise SystemExit("Could not locate the audio export insertion point.")
    source = source.replace(key_marker, audio_patch + key_marker, 1)

# 2. Add storage for the internal diagnostic.
state_marker = "lateinit var gRunner: StarfaitRunner"

if "private var createRunnerDiagnostic" not in source:
    if source.count(state_marker) != 1:
        raise SystemExit("Could not locate the diagnostic storage insertion point.")

    source = source.replace(
        state_marker,
        'private var createRunnerDiagnostic = "No createRunner failure recorded."\n\n'
        + state_marker,
        1
    )

# 3. Wrap createRunner so Kotlin exceptions are recorded before rethrowing.
start_marker = (
    "    return GlobalScope.async("
    "CoroutineExceptionHandler { _, e -> println(e.stackTraceToString()) }) {\n"
)

if "var createRunnerStage =" not in source:
    if source.count(start_marker) != 1:
        raise SystemExit("Could not locate the createRunner function.")

    source = source.replace(
        start_marker,
        start_marker
        + '        var createRunnerStage = "Opening OPFS root"\n'
        + "        try {\n",
        1
    )

    stages = [
        (
            "        val baseDirectory = navigator.storage.getDirectory()",
            '            createRunnerStage = "Opening OPFS root"\n'
        ),
        (
            "        val bundleFS = VirtualFileSystem()",
            '            createRunnerStage = "Creating virtual game filesystem"\n'
        ),
        (
            "        bundleDirectory.values().asFlow().collect { handle ->",
            '            createRunnerStage = "Reading game files from OPFS"\n'
        ),
        (
            "        val gameWAD = GameWAD.read(",
            '            createRunnerStage = "Parsing game.unx archive"\n'
        ),
        (
            "        val vm = StarfaitVM(",
            '            createRunnerStage = "Creating GameMaker virtual machine"\n'
        ),
        (
            "        val context = gameCanvas.getContext(",
            '            createRunnerStage = "Creating WebGL2 context"\n'
        ),
        (
            "        val renderer = GLRenderer(",
            '            createRunnerStage = "Creating OpenGL renderer"\n'
        ),
        (
            "        val savesDirectory = getNestedFolder(",
            '            createRunnerStage = "Opening save directory"\n'
        ),
        (
            "        val saveFS = VirtualFileSystem()",
            '            createRunnerStage = "Reading save files"\n'
        ),
        (
            "        val layeredFileSystem = LayeredFileSystem(",
            '            createRunnerStage = "Creating layered filesystem"\n'
        ),
        (
            "        val audioManager = WebAudioManager(",
            '            createRunnerStage = "Creating Web Audio context"\n'
        ),
        (
            "        val runner = StarfaitRunner(",
            '            createRunnerStage = "Creating Starfait runner"\n'
        ),
        (
            "        runner.start()",
            '            createRunnerStage = "Starting game runner"\n'
        ),
    ]

    for marker, addition in stages:
        if source.count(marker) != 1:
            raise SystemExit(
                "Could not uniquely locate diagnostic stage: " + marker.strip()
            )
        source = source.replace(marker, addition + marker, 1)

    end_marker = (
        "        return@async true.toJsBoolean()\n"
        "    }.asPromise()"
    )

    replacement = (
        "            return@async true.toJsBoolean()\n"
        "        } catch (error: Throwable) {\n"
        '            createRunnerDiagnostic = "Failed during $createRunnerStage\\n'
        '${error.stackTraceToString()}"\n'
        "            throw error\n"
        "        }\n"
        "    }.asPromise()"
    )

    if source.count(end_marker) != 1:
        raise SystemExit("Could not locate the end of createRunner.")

    source = source.replace(end_marker, replacement, 1)

# 4. Export the diagnostic so app.js can read it.
getter = (
    "@JsExport\n"
    "fun getCreateRunnerDiagnostic(): String {\n"
    "    return createRunnerDiagnostic\n"
    "}\n\n"
)

if "fun getCreateRunnerDiagnostic()" not in source:
    if source.count(key_marker) != 1:
        raise SystemExit("Could not locate the diagnostic export insertion point.")
    source = source.replace(key_marker, getter + key_marker, 1)

path.write_text(source, encoding="utf-8")
print("Starfait audio and createRunner diagnostics patches applied.")
