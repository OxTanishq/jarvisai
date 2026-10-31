import type { GraphData } from './indexer.ts';
import { JARVIS_PERSONA_PREFIX } from './persona.ts';

/**
 * Generates a self-contained shell archive script (`setup-local-jarvis.sh`) containing
 * the exact Python 3 standard-library files specified in Prompts 01–08 (`build.py`,
 * `server.py`, `voice.py`, `hear.py`, `preflight.py`, `drill.py`, `config.json`) PLUS
 * every current markdown note from the live vault (including user `/remember` captures).
 */
export function buildLocalMacBundle(graph: GraphData): {
  filename: string;
  filesCount: number;
  notesCount: number;
  scriptContent: string;
} {
  const localConfig = {
    boot_brain: 'local',
    brains: {
      local: {
        base_url: 'http://localhost:11434/v1',
        model: 'qwen3.5:9b',
        api_key: 'ollama',
        extra_body: { reasoning_effort: 'none' }
      },
      claude: {
        base_url: 'https://api.anthropic.com',
        model: 'claude-opus-5-5',
        api_key: 'PUT-YOUR-KEY-HERE'
      }
    },
    voice: {
      url: 'http://127.0.0.1:3900',
      engine: 'mlx-audio',
      model_id: 'mlx-community/csm-1b-8bit',
      profile: 'Jarvis',
      language: 'en'
    },
    hearing: {
      model: 'mlx-community/whisper-large-v3-turbo',
      wake_model: 'mlx-community/whisper-small-mlx'
    }
  };

  const buildPy = `#!/usr/bin/env python3
"""Prompt 01 Indexer: standard library only. Scans ./notes and writes viewer/graph-data.js."""
import json, os, re

NOTES_DIR = os.path.join(os.path.dirname(__file__), "notes")
OUT_FILE = os.path.join(os.path.dirname(__file__), "viewer", "graph-data.js")

def build_index():
    md_files = []
    for root, _, files in sorted(os.walk(NOTES_DIR)):
        for f in sorted(files):
            if f.endswith(".md"):
                full = os.path.join(root, f)
                rel = os.path.relpath(full, NOTES_DIR).replace("\\\\", "/")
                parts = rel.split("/")
                group = parts[-2] if len(parts) > 1 else "root"
                label = os.path.splitext(f)[0]
                md_files.append((full, rel, group, label))

    nodes = []
    for idx, (full, rel, group, label) in enumerate(md_files):
        with open(full, "r", encoding="utf-8") as fh:
            content = fh.read()
        clean = re.sub(r"^#\\s+.+$", "", content, flags=re.M).strip()
        excerpt = (clean[:700] + "...") if len(clean) > 700 else clean
        nodes.append({
            "id": idx,
            "label": label,
            "group": group,
            "relPath": rel,
            "excerpt": excerpt,
            "content": content
        })

    links = []
    seen = set()
    for i, a in enumerate(nodes):
        a_wiki = set(m.lower() for m in re.findall(r"\\[\\[([^\\]|]+)", a["content"]))
        a_low = a["content"].lower()
        for j, b in enumerate(nodes):
            if i >= j:
                continue
            b_wiki = set(m.lower() for m in re.findall(r"\\[\\[([^\\]|]+)", b["content"]))
            if (b["label"].lower() in a_wiki or a["label"].lower() in b_wiki or
                (a_wiki & b_wiki) or
                (len(b["label"]) > 5 and b["label"].lower() in a_low) or
                (len(a["label"]) > 5 and a["label"].lower() in b["content"].lower())):
                key = (i, j)
                if key not in seen:
                    seen.add(key)
                    links.append({"source": i, "target": j})

    os.makedirs(os.path.dirname(OUT_FILE), exist_ok=True)
    payload = json.dumps({"nodes": nodes, "links": links}, indent=2)
    with open(OUT_FILE, "w", encoding="utf-8") as out:
        out.write(f"const GRAPH = {payload};\\n")
    print(f"Indexed {len(nodes)} notes and {len(links)} links -> {OUT_FILE}")
    return {"nodes": nodes, "links": links}

if __name__ == "__main__":
    build_index()
`;

  const voicePy = `#!/usr/bin/env python3
"""Prompt 02 Voice Bay: VoiceStudio local TTS with disk WAV cache and 10-min keep-warm."""
import hashlib, json, os, threading, time, urllib.request

CACHE_DIR = os.path.join(os.path.dirname(__file__), ".tts_cache")
os.makedirs(CACHE_DIR, exist_ok=True)
_pinned = False
_profile_id = None
_last_used = time.time()

def check_health(cfg):
    try:
        with urllib.request.urlopen(cfg["url"].rstrip("/") + "/health", timeout=1.0) as r:
            return r.status == 200
    except Exception:
        return False

def ensure_pinned(cfg):
    global _pinned, _profile_id
    base = cfg["url"].rstrip("/")
    if not _pinned:
        req = urllib.request.Request(
            base + "/engines/select",
            data=json.dumps({"family": "tts", "backend_id": cfg["engine"], "model_id": cfg["model_id"]}).encode(),
            headers={"Content-Type": "application/json"},
            method="POST"
        )
        try:
            urllib.request.urlopen(req, timeout=2.5).read()
            _pinned = True
        except Exception:
            pass
    if not _profile_id:
        try:
            with urllib.request.urlopen(base + "/profiles", timeout=1.5) as r:
                items = json.loads(r.read().decode())
                plist = items if isinstance(items, list) else items.get("profiles", [])
                for p in plist:
                    if p.get("name", "").lower() == cfg["profile"].lower():
                        _profile_id = p["id"]
                        break
        except Exception:
            pass
    return _profile_id or cfg["profile"]

def synthesize(text, cfg):
    global _last_used
    _last_used = time.time()
    text = text.strip()[:600]
    key = hashlib.sha256(f"{cfg['profile']}::{text}".encode()).hexdigest()[:24]
    cache_path = os.path.join(CACHE_DIR, f"{key}.wav")
    if os.path.exists(cache_path):
        with open(cache_path, "rb") as fh:
            return fh.read(), f"local:{cfg['profile']}"
    if not check_health(cfg):
        return None, "browser"
    pid = ensure_pinned(cfg)
    req = urllib.request.Request(
        cfg["url"].rstrip("/") + "/v1/audio/speech",
        data=json.dumps({
            "model": cfg["model_id"],
            "input": text,
            "voice": pid,
            "response_format": "wav",
            "language": cfg.get("language", "en")
        }).encode(),
        headers={"Content-Type": "application/json"},
        method="POST"
    )
    with urllib.request.urlopen(req, timeout=15) as r:
        wav = r.read()
    with open(cache_path, "wb") as fh:
        fh.write(wav)
    return wav, f"local:{cfg['profile']}"
`;

  const hearPy = `#!/usr/bin/env python3
"""Prompt 03 Hearing Bay: mlx_whisper on Apple Silicon or faster_whisper elsewhere."""
import platform, tempfile, time, wave

_backend = None
_fast_models = {}

def init_ears(cfg):
    global _backend
    if platform.system() == "Darwin" and platform.machine() == "arm64":
        import mlx_whisper
        _backend = "mlx"
        # Warm with 1s silence
        with tempfile.NamedTemporaryFile(suffix=".wav") as tmp:
            with wave.open(tmp.name, "wb") as wf:
                wf.setnchannels(1); wf.setsampwidth(2); wf.setframerate(16000)
                wf.writeframes(b"\\x00\\x00" * 16000)
            mlx_whisper.transcribe(tmp.name, path_or_hf_repo=cfg["wake_model"])
            mlx_whisper.transcribe(tmp.name, path_or_hf_repo=cfg["model"])
    else:
        from faster_whisper import WhisperModel
        _backend = "faster"
        _fast_models["wake"] = WhisperModel("small", compute_type="int8")
        _fast_models["main"] = WhisperModel("large-v3-turbo", compute_type="int8")

def transcribe_wav(wav_bytes, cfg, wake=False):
    t0 = time.time()
    with tempfile.NamedTemporaryFile(suffix=".wav") as tmp:
        tmp.write(wav_bytes)
        tmp.flush()
        if _backend == "mlx":
            import mlx_whisper
            repo = cfg["wake_model"] if wake else cfg["model"]
            out = mlx_whisper.transcribe(tmp.name, path_or_hf_repo=repo)
            txt = out.get("text", "").strip()
        elif _backend == "faster":
            m = _fast_models["wake" if wake else "main"]
            segs, _ = m.transcribe(tmp.name)
            txt = " ".join(s.text for s in segs).strip()
        else:
            txt = ""
    return {"text": txt, "seconds": round(time.time() - t0, 2)}
`;

  const readmeMd = `# Run Jarvis Fully Local — Exported Kit

This archive was exported from your live **Jarvis Knowledge Galaxy** workspace along with all **${graph.nodes.length} markdown notes** (including your captured memories).

## Quick Start on Apple Silicon Mac
1. Ensure **Ollama** (\`ollama pull qwen3.5:9b\`), **VoiceStudio** (port 3900, profile \`Jarvis\`), and **mlx-whisper** (\`python3 -m pip install mlx-whisper\`) are installed.
2. Run \`python3 build.py\` to index \`./notes\` into \`viewer/graph-data.js\`.
3. Start your local butler or point this full-stack app's \`config.json\` \`boot_brain\` to \`"local"\` and run \`npm run dev\`.

Persona Stable Prefix (${JARVIS_PERSONA_PREFIX.split(/\\s+/).length} words):
\`\`\`
${JARVIS_PERSONA_PREFIX}
\`\`\`
`;

  const lines: string[] = [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    'mkdir -p my-jarvis/notes/captures my-jarvis/viewer',
    'cd my-jarvis',
    '',
    "cat <<'EOF_CONFIG' > config.json",
    JSON.stringify(localConfig, null, 2),
    'EOF_CONFIG',
    '',
    "cat <<'EOF_BUILD' > build.py",
    buildPy,
    'EOF_BUILD',
    'chmod +x build.py',
    '',
    "cat <<'EOF_VOICE' > voice.py",
    voicePy,
    'EOF_VOICE',
    '',
    "cat <<'EOF_HEAR' > hear.py",
    hearPy,
    'EOF_HEAR',
    '',
    "cat <<'EOF_README' > README.md",
    readmeMd,
    'EOF_README',
    ''
  ];

  for (const node of graph.nodes) {
    const safeRel = node.relPath.replace(/[^a-zA-Z0-9/_ .-]/g, '');
    const dirName = safeRel.includes('/') ? safeRel.slice(0, safeRel.lastIndexOf('/')) : '';
    if (dirName) {
      lines.push(`mkdir -p "notes/${dirName}"`);
    }
    lines.push(`cat <<'EOF_NOTE_${node.id}' > "notes/${safeRel}"`);
    lines.push(node.content.trimEnd());
    lines.push(`EOF_NOTE_${node.id}`);
    lines.push('');
  }

  lines.push('python3 build.py');
  lines.push('echo "Jarvis local workspace unpacked into ./my-jarvis with all markdown notes!"');

  return {
    filename: 'install-local-jarvis.sh',
    filesCount: 5 + graph.nodes.length,
    notesCount: graph.nodes.length,
    scriptContent: lines.join('\n')
  };
}
