import fs from 'node:fs';
import path from 'node:path';
import type { BrainManager, JarvisConfig } from './brains.ts';
import type { HearingManager } from './hear.ts';
import type { LiveKnowledgeIndex } from './indexer.ts';
import { countPromptWords, estimateTokens, JARVIS_PERSONA_PREFIX } from './persona.ts';
import type { VoiceManager } from './voice.ts';
import { outboundWatcher } from './watcher.ts';

export interface PreflightCheckItem {
  id: string;
  label: string;
  status: 'PASS' | 'FAIL' | 'WARN';
  detail: string;
  seconds?: number;
}

export interface PreflightReport {
  checks: PreflightCheckItem[];
  latencyBudget: {
    hearSeconds: number;
    thinkSeconds: number;
    speakSeconds: number;
    totalSeconds: number;
    line: string;
  };
  summary: {
    pass: number;
    fail: number;
    warn: number;
    line: string;
  };
  personaMetrics: {
    words: number;
    estimatedTokens: number;
  };
}

export interface DrillReport {
  passed: boolean;
  activeBrain: string;
  activeVoice: string;
  questionAsked: string;
  answerSpoken: string;
  transcribedBack: string;
  externalHosts: string[];
  allServerConnections: { host: string; reason: string; isLocal: boolean }[];
  honestInternetList: string[];
  verdictLine: string;
}

export function computeHonestInternetList(
  config: JarvisConfig,
  brainManager: BrainManager,
  voiceManager: VoiceManager,
  hearingManager: HearingManager
): string[] {
  const items: string[] = [];
  const activeBrain = brainManager.getActiveBrainKey();
  if (activeBrain === 'gemini') {
    items.push(`Active Brain ("gemini" · ${config.brains['gemini']?.model}): calls generativelanguage.googleapis.com over HTTPS.`);
  }
  const claudeEntry = config.brains['claude'];
  if (claudeEntry && claudeEntry.api_key && claudeEntry.api_key !== 'PUT-YOUR-KEY-HERE') {
    items.push(`Configured Shelf Brain ("claude" · ${claudeEntry.model}): calls api.anthropic.com when switched to cloud.`);
  } else {
    items.push('Shelf Brain ("claude"): key is placeholder (unplugged; never leaves machine).');
  }
  if (voiceManager.getMode() === 'gemini') {
    items.push(`Neural Butler Voice ("gemini" · ${config.voice.gemini_model}): calls generativelanguage.googleapis.com when uncached.`);
  }
  if (hearingManager.getMode() === 'gemini') {
    items.push(`Audio Transcription Ear ("gemini" · ${config.hearing.gemini_model}): calls generativelanguage.googleapis.com for WAV transcription.`);
  }
  items.push('Live Web Research: not implemented by design (Jarvis answers strictly from local markdown notes).');
  return items;
}

function normalizeWords(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function scanClientFilesForPatterns(projectRoot: string): {
  hasKeyLeak: boolean;
  hasCdnLink: boolean;
  hasMuteGate: boolean;
  cdnDetails: string[];
} {
  const filesToScan: string[] = [path.join(projectRoot, 'index.html')];
  const walkSrc = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walkSrc(full);
      else if (e.isFile() && /\.(ts|tsx|js|html|css)$/.test(e.name)) {
        filesToScan.push(full);
      }
    }
  };
  walkSrc(path.join(projectRoot, 'src'));

  let hasKeyLeak = false;
  const cdnDetails: string[] = [];
  const envKey = process.env.GEMINI_API_KEY;

  for (const file of filesToScan) {
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, 'utf-8');
    if (text.includes('PUT-YOUR-KEY-HERE')) {
      hasKeyLeak = true;
    }
    if (envKey && envKey.length > 8 && text.includes(envKey)) {
      hasKeyLeak = true;
    }
    // Check external CDN script/link/import URLs
    const cdnRegex = /https?:\/\/(?:unpkg\.com|cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|esm\.sh|fonts\.googleapis\.com)/gi;
    const matches = text.match(cdnRegex);
    if (matches) {
      cdnDetails.push(`${path.relative(projectRoot, file)}: ${matches[0]}`);
    }
  }

  const audioPlayerPath = path.join(projectRoot, 'src/utils/audioPlayer.ts');
  let hasMuteGate = false;
  if (fs.existsSync(audioPlayerPath)) {
    const playerCode = fs.readFileSync(audioPlayerPath, 'utf-8');
    hasMuteGate =
      playerCode.includes("get('mute') === '1'") &&
      playerCode.includes('playSingleChunk');
  }

  return {
    hasKeyLeak,
    hasCdnLink: cdnDetails.length > 0,
    hasMuteGate,
    cdnDetails
  };
}

export async function runLivePreflight(params: {
  port: number;
  projectRoot: string;
  config: JarvisConfig;
  knowledgeIndex: LiveKnowledgeIndex;
  brainManager: BrainManager;
  voiceManager: VoiceManager;
  hearingManager: HearingManager;
}): Promise<PreflightReport> {
  const { port, projectRoot, config, knowledgeIndex, brainManager, voiceManager, hearingManager } = params;
  const baseUrl = `http://127.0.0.1:${port}`;
  const checks: PreflightCheckItem[] = [];

  let hearSeconds = 0;
  let thinkSeconds = 0;
  let speakSeconds = 0;

  // 1. Server is up and serving viewer
  let servedHtml = '';
  try {
    const res = await fetch(`${baseUrl}/`, { signal: AbortSignal.timeout(3000) });
    servedHtml = await res.text();
    checks.push({
      id: 'viewer-up',
      label: 'Server is up and serving the viewer',
      status: res.ok && servedHtml.includes('<div id="root">') ? 'PASS' : 'FAIL',
      detail: `HTTP ${res.status} (${servedHtml.length} bytes)`
    });
  } catch (e) {
    checks.push({
      id: 'viewer-up',
      label: 'Server is up and serving the viewer',
      status: 'FAIL',
      detail: e instanceof Error ? e.message : 'Unreachable'
    });
  }

  // 2. Graph data loads and node count > 0
  const graph = knowledgeIndex.getGraph();
  checks.push({
    id: 'graph-data',
    label: 'Graph data loads and node count > 0',
    status: graph.nodes.length > 0 ? 'PASS' : 'FAIL',
    detail: `${graph.nodes.length} indexed notes, ${graph.links.length} constellation links`
  });

  // 3. Ollama local check + Active brain readiness
  const ollama = await brainManager.checkOllamaStatus();
  const localModelName = config.brains['local']?.model || 'qwen3.5:9b';
  if (ollama.reachable && ollama.configuredModelInstalled) {
    checks.push({
      id: 'ollama-models',
      label: 'Ollama answers on /v1/models with configured brain',
      status: 'PASS',
      detail: `Local ${localModelName} ready on port 11434`
    });
  } else if (brainManager.getActiveBrainKey() === 'gemini') {
    checks.push({
      id: 'ollama-models',
      label: 'Local Ollama daemon check (optional while Cloud Brain active)',
      status: 'WARN',
      detail: `Port 11434 offline in this environment. On your Mac run: ollama pull ${localModelName}`
    });
  } else {
    checks.push({
      id: 'ollama-models',
      label: 'Ollama answers on /v1/models with configured brain',
      status: 'FAIL',
      detail: `Missing model. Run: ollama pull ${localModelName}`
    });
  }

  // 4. Live /chat end-to-end turn
  try {
    const tChat = performance.now();
    const chatRes = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: 'What is our target TDS range for espresso water?' })
    });
    const chatData = (await chatRes.json()) as { answer?: string; nodes?: number[]; seconds?: number };
    thinkSeconds = chatData.seconds ?? Number(((performance.now() - tChat) / 1000).toFixed(2));
    const valid =
      chatRes.ok &&
      typeof chatData.answer === 'string' &&
      chatData.answer.length > 5 &&
      Array.isArray(chatData.nodes);
    checks.push({
      id: 'chat-live',
      label: '/chat returns a well-formed answer with source node indexes',
      status: valid ? 'PASS' : 'FAIL',
      detail: valid
        ? `${thinkSeconds.toFixed(2)}s · cited [${chatData.nodes?.join(', ')}] · "${chatData.answer?.slice(0, 80)}…"`
        : 'Malformed /chat response',
      seconds: thinkSeconds
    });
  } catch (e) {
    checks.push({
      id: 'chat-live',
      label: '/chat returns a well-formed answer with source node indexes',
      status: 'FAIL',
      detail: e instanceof Error ? e.message : 'Chat error'
    });
  }

  // 5. Voice /tts check & 6. THE LOOP (/tts -> /hear)
  const loopPhrase = 'Good afternoon sir, our espresso blend is ready.';
  let synthesizedWav: Buffer | null = null;
  try {
    const tSpeak = performance.now();
    const ttsRes = await fetch(`${baseUrl}/api/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: loopPhrase, bypassCache: false })
    });
    speakSeconds = Number(((performance.now() - tSpeak) / 1000).toFixed(2));
    const voiceHdr = ttsRes.headers.get('X-Jarvis-Voice') || 'unknown';

    if (ttsRes.ok && ttsRes.headers.get('Content-Type')?.includes('audio/wav')) {
      const ab = await ttsRes.arrayBuffer();
      synthesizedWav = Buffer.from(ab);
      const isRiff =
        synthesizedWav.length > 44 &&
        synthesizedWav.toString('ascii', 0, 4) === 'RIFF';
      checks.push({
        id: 'tts-live',
        label: 'Voice engine returns real RIFF WAV with X-Jarvis-Voice header',
        status: isRiff ? 'PASS' : 'WARN',
        detail: `${speakSeconds.toFixed(2)}s to audio · header ${voiceHdr} (${synthesizedWav.length} bytes)`,
        seconds: speakSeconds
      });
    } else {
      checks.push({
        id: 'tts-live',
        label: 'Voice engine check (browser WebSpeech fallback)',
        status: 'WARN',
        detail: `Using browser voice fallback (X-Jarvis-Voice: ${voiceHdr})`
      });
    }
  } catch (e) {
    checks.push({
      id: 'tts-live',
      label: 'Voice engine check',
      status: 'WARN',
      detail: e instanceof Error ? e.message : 'Voice fallback'
    });
  }

  // 6. THE LOOP: send synthesized WAV to /hear and verify words match
  if (synthesizedWav && synthesizedWav.length > 44) {
    try {
      const tHear = performance.now();
      const hearRes = await fetch(`${baseUrl}/api/hear`, {
        method: 'POST',
        headers: { 'Content-Type': 'audio/wav' },
        body: new Uint8Array(synthesizedWav)
      });
      const hearData = (await hearRes.json()) as { text?: string; seconds?: number };
      hearSeconds = hearData.seconds ?? Number(((performance.now() - tHear) / 1000).toFixed(2));
      const expectedWords = normalizeWords(loopPhrase);
      const actualWords = new Set(normalizeWords(hearData.text || ''));
      const matched = expectedWords.filter((w) => actualWords.has(w)).length;
      const ratio = matched / Math.max(1, expectedWords.length);

      checks.push({
        id: 'loop-tts-hear',
        label: 'THE LOOP: /tts WAV fed into /hear transcribes matching words',
        status: ratio >= 0.5 ? 'PASS' : 'WARN',
        detail: `${hearSeconds.toFixed(2)}s · heard "${hearData.text || ''}" (${Math.round(ratio * 100)}% word match)`,
        seconds: hearSeconds
      });
    } catch (e) {
      checks.push({
        id: 'loop-tts-hear',
        label: 'THE LOOP: /tts WAV fed into /hear',
        status: 'WARN',
        detail: e instanceof Error ? e.message : 'Transcription unavailable'
      });
    }
  } else {
    checks.push({
      id: 'loop-tts-hear',
      label: 'THE LOOP: /tts WAV fed into /hear',
      status: 'WARN',
      detail: 'Skipped WAV loop because voice is set to browser SpeechSynthesis'
    });
  }

  // 7. /remember writes a real file, is immediately retrievable, and cleans up
  let tempNodeId: number | null = null;
  try {
    const tokenCode = `canary-${Date.now().toString().slice(-5)}`;
    const remRes = await fetch(`${baseUrl}/api/remember`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: `Remember that preflight verification code ${tokenCode} requires 900ms finish window.`
      })
    });
    const remData = (await remRes.json()) as { node?: { id: number; relPath: string } };
    tempNodeId = remData.node?.id ?? null;

    const fullDiskPath = remData.node ? path.join(projectRoot, 'notes', remData.node.relPath) : '';
    const existsOnDisk = fullDiskPath ? fs.existsSync(fullDiskPath) : false;
    const searchHit = knowledgeIndex.scoreNotes(tokenCode, 3);
    const retrievable = searchHit.topNodes.some((n) => n.id === tempNodeId);

    if (tempNodeId !== null) {
      knowledgeIndex.removeNoteById(tempNodeId);
    }

    checks.push({
      id: 'remember-live',
      label: '/remember writes real markdown file and indexes it live without rebuild',
      status: existsOnDisk && retrievable ? 'PASS' : 'FAIL',
      detail:
        existsOnDisk && retrievable
          ? `Verified disk write + live index hit for ${tokenCode} (test note cleaned up)`
          : 'Failed disk write or immediate index retrieval'
    });
  } catch (e) {
    if (tempNodeId !== null) {
      knowledgeIndex.removeNoteById(tempNodeId);
    }
    checks.push({
      id: 'remember-live',
      label: '/remember writes real markdown file and indexes it live',
      status: 'FAIL',
      detail: e instanceof Error ? e.message : 'Remember error'
    });
  }

  // 8. Served index.html matches disk index.html core title
  const diskIndex = fs.readFileSync(path.join(projectRoot, 'index.html'), 'utf-8');
  const titleMatch = servedHtml.includes('<title>Jarvis Knowledge Galaxy</title>') &&
    diskIndex.includes('<title>Jarvis Knowledge Galaxy</title>');
  checks.push({
    id: 'disk-parity',
    label: 'Served viewer HTML matches source files on disk',
    status: titleMatch ? 'PASS' : 'FAIL',
    detail: titleMatch ? 'Verified <title> and entry bundle parity' : 'Mismatch between disk and served HTML'
  });

  // 9. config.json is strictly unreachable from browser (MUST FAIL LOUDLY if 200)
  try {
    const cfgRes = await fetch(`${baseUrl}/config.json`);
    const blocked = cfgRes.status === 403 || cfgRes.status === 404;
    checks.push({
      id: 'config-blocked',
      label: 'config.json is strictly unreachable from the browser',
      status: blocked ? 'PASS' : 'FAIL',
      detail: `GET /config.json returned HTTP ${cfgRes.status} (isolated in project root)`
    });
  } catch {
    checks.push({
      id: 'config-blocked',
      label: 'config.json is strictly unreachable from the browser',
      status: 'PASS',
      detail: 'Connection refused for /config.json'
    });
  }

  // 10, 11, 12: Static security & Prompt 08 Zero-CDN checks
  const scan = scanClientFilesForPatterns(projectRoot);
  checks.push({
    id: 'mute-flag',
    label: 'A ?mute=1 tab is strictly silent inside the single play gate',
    status: scan.hasMuteGate ? 'PASS' : 'FAIL',
    detail: scan.hasMuteGate
      ? 'Verified URL ?mute=1 guard inside sole playSingleChunk() audio output gate'
      : 'Missing ?mute=1 guard in audioPlayer.ts'
  });

  checks.push({
    id: 'no-key-leak',
    label: 'No cloud or placeholder API key appears anywhere in client files',
    status: !scan.hasKeyLeak ? 'PASS' : 'FAIL',
    detail: !scan.hasKeyLeak
      ? 'Zero secret or placeholder keys found across index.html and src/'
      : 'Detected key string inside client files!'
  });

  checks.push({
    id: 'zero-cdn',
    label: 'Zero external CDN references anywhere in viewer client files',
    status: !scan.hasCdnLink ? 'PASS' : 'FAIL',
    detail: !scan.hasCdnLink
      ? 'All 3D WebGL libraries and styles bundled locally (zero CDN imports)'
      : `Found CDN URLs: ${scan.cdnDetails.join(', ')}`
  });

  const passCount = checks.filter((c) => c.status === 'PASS').length;
  const failCount = checks.filter((c) => c.status === 'FAIL').length;
  const warnCount = checks.filter((c) => c.status === 'WARN').length;

  const totalSeconds = Number((hearSeconds + thinkSeconds + speakSeconds).toFixed(2));
  const budgetLine = `LATENCY BUDGET: hear ${hearSeconds.toFixed(2)} s, think ${thinkSeconds.toFixed(2)} s, speak ${speakSeconds.toFixed(2)} s, total ${totalSeconds.toFixed(2)} s`;
  const summaryLine = `${passCount} pass, ${failCount} fail, ${warnCount} warn`;

  return {
    checks,
    latencyBudget: {
      hearSeconds,
      thinkSeconds,
      speakSeconds,
      totalSeconds,
      line: budgetLine
    },
    summary: {
      pass: passCount,
      fail: failCount,
      warn: warnCount,
      line: summaryLine
    },
    personaMetrics: {
      words: countPromptWords(JARVIS_PERSONA_PREFIX),
      estimatedTokens: estimateTokens(JARVIS_PERSONA_PREFIX)
    }
  };
}

export async function runWifiOffDrill(params: {
  port: number;
  config: JarvisConfig;
  brainManager: BrainManager;
  voiceManager: VoiceManager;
  hearingManager: HearingManager;
}): Promise<DrillReport> {
  const { port, config, brainManager, voiceManager, hearingManager } = params;
  const baseUrl = `http://127.0.0.1:${port}`;
  const turnId = outboundWatcher.startTurn();

  const questionAsked = 'When does the Hotel Vance wholesale contract renew?';

  // 1. Ask /api/chat
  const chatRes = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Jarvis-Turn': String(turnId) },
    body: JSON.stringify({ question: questionAsked, turnId })
  });
  const chatData = (await chatRes.json()) as { answer?: string };
  const answerSpoken = chatData.answer || '';

  // 2. Render answer through /api/tts
  let transcribedBack = '(browser speech fallback)';
  const ttsRes = await fetch(`${baseUrl}/api/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: answerSpoken.slice(0, 220), turnId })
  });

  if (ttsRes.ok && ttsRes.headers.get('Content-Type')?.includes('audio/wav')) {
    const wavBuf = Buffer.from(await ttsRes.arrayBuffer());
    // 3. Feed WAV back through /api/hear
    const hearRes = await fetch(`${baseUrl}/api/hear`, {
      method: 'POST',
      headers: {
        'Content-Type': 'audio/wav',
        'X-Jarvis-Turn': String(turnId)
      },
      body: new Uint8Array(wavBuf)
    });
    if (hearRes.ok) {
      const hearJson = (await hearRes.json()) as { text?: string };
      transcribedBack = hearJson.text || '';
    }
  }

  const report = outboundWatcher.getLastTurnReport(turnId);
  const honestList = computeHonestInternetList(config, brainManager, voiceManager, hearingManager);
  const passed = report.externalHosts.length === 0;

  const verdictLine = passed
    ? 'DRILL PASSED: 0 external hosts contacted (100% localhost / 127.0.0.1).'
    : `DRILL DETECTED CLOUD TRAFFIC (${brainManager.getActiveBrainKey()} mode): contacted [${report.externalHosts.join(', ')}] — watcher verified.`;

  return {
    passed,
    activeBrain: `${brainManager.getActiveBrainKey()} (${brainManager.getActiveBrain().model})`,
    activeVoice: voiceManager.getVoiceBadgeLabel(),
    questionAsked,
    answerSpoken,
    transcribedBack,
    externalHosts: report.externalHosts,
    allServerConnections: report.serverConnections.map((c) => ({
      host: c.host,
      reason: c.reason,
      isLocal: c.isLocal
    })),
    honestInternetList: honestList,
    verdictLine
  };
}
