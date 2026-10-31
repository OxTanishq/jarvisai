import 'dotenv/config';
import express from 'express';
import type { Request, Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BrainManager } from './server/brains.ts';
import type { JarvisConfig } from './server/brains.ts';
import { HearingManager } from './server/hear.ts';
import { createKnowledgeIndex } from './server/indexer.ts';
import { buildLocalMacBundle } from './server/localPackTemplate.ts';
import { countPromptWords, estimateTokens, JARVIS_PERSONA_PREFIX } from './server/persona.ts';
import { computeHonestInternetList, runLivePreflight, runWifiOffDrill } from './server/preflight.ts';
import { matchVoiceAndSystemRoutes } from './server/routesMatcher.ts';
import { ensureSeedNotes } from './server/seedNotes.ts';
import { VoiceManager } from './server/voice.ts';
import { outboundWatcher } from './server/watcher.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;
const PROJECT_ROOT = __dirname;
const CONFIG_PATH = path.join(PROJECT_ROOT, 'config.json');
const NOTES_ROOT = path.join(PROJECT_ROOT, 'notes');
const GRAPH_JSON_PATH = path.join(PROJECT_ROOT, 'data', 'graph-data.json');
const TTS_CACHE_DIR = path.join(PROJECT_ROOT, 'data', 'tts-cache');

function loadConfig(): JarvisConfig {
  const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
  return JSON.parse(raw) as JarvisConfig;
}

async function startServer() {
  ensureSeedNotes(NOTES_ROOT);
  const config = loadConfig();
  const knowledgeIndex = createKnowledgeIndex(NOTES_ROOT, GRAPH_JSON_PATH);
  const brainManager = new BrainManager(config);
  const voiceManager = new VoiceManager(config.voice, TTS_CACHE_DIR);
  const hearingManager = new HearingManager(config.hearing);

  const app = express();

  // Explicitly block browser access to config.json, server/, notes/, and data/ (Prompt 01 & Prompt 07 Law)
  app.use((req, res, next) => {
    const cleanPath = req.path.toLowerCase();
    if (
      cleanPath === '/config.json' ||
      cleanPath.endsWith('/config.json') ||
      cleanPath.startsWith('/server/') ||
      cleanPath.startsWith('/data/')
    ) {
      res.status(403).json({ error: 'Forbidden: server configuration is isolated from browser access.' });
      return;
    }
    next();
  });

  // Raw WAV parser for /hear and /api/hear (up to 15 MB)
  app.use(['/api/hear', '/hear'], express.raw({ type: ['audio/wav', 'audio/*', 'application/octet-stream'], limit: '15mb' }));
  app.use(express.json({ limit: '5mb' }));

  // GET /api/graph: returns live indexed 3D galaxy nodes & links
  app.get('/api/graph', (_req: Request, res: Response) => {
    res.json(knowledgeIndex.getGraph());
  });

  // GET /api/status: returns current live brain, voice, ear, shelf, and persona token budget
  app.get('/api/status', (_req: Request, res: Response) => {
    const graph = knowledgeIndex.getGraph();
    res.json({
      noteCount: graph.nodes.length,
      linkCount: graph.links.length,
      activeBrainKey: brainManager.getActiveBrainKey(),
      activeBrainModel: brainManager.getActiveBrain().model,
      voiceMode: voiceManager.getMode(),
      voiceLabel: voiceManager.getVoiceBadgeLabel(),
      hearingMode: hearingManager.getMode(),
      shelf: brainManager.getShelfSummary(),
      personaWords: countPromptWords(JARVIS_PERSONA_PREFIX),
      personaEstimatedTokens: estimateTokens(JARVIS_PERSONA_PREFIX)
    });
  });

  // POST /api/switch: manual UI button switch for brain or voice (mirrors spoken routes)
  app.post('/api/switch', async (req: Request, res: Response) => {
    try {
      const { brain, voice } = req.body as { brain?: string; voice?: 'local' | 'gemini' | 'browser' };
      let message = '';
      let needsPreloadNotice = false;

      if (brain) {
        const bRes = await brainManager.switchBrain(brain);
        message = bRes.message;
        needsPreloadNotice = bRes.needsPreloadNotice;
      }
      if (voice) {
        const vRes = await voiceManager.setMode(voice);
        message = message ? `${message} ${vRes.message}` : vRes.message;
      }

      res.json({
        message,
        activeBrainKey: brainManager.getActiveBrainKey(),
        activeBrainModel: brainManager.getActiveBrain().model,
        voiceMode: voiceManager.getMode(),
        voiceLabel: voiceManager.getVoiceBadgeLabel(),
        shelf: brainManager.getShelfSummary(),
        needsPreloadNotice
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Switch failed' });
    }
  });

  // POST /chat and /api/chat: Voice routes -> Top-6 Retrieval -> Butler Brain -> Control Tags / Proof Nodes
  const handleChat = async (req: Request, res: Response) => {
    try {
      const { question, turnId: reqTurnId, browserResources } = req.body as {
        question?: string;
        turnId?: number;
        browserResources?: string[];
      };

      if (!question || !question.trim()) {
        res.status(400).json({ error: 'Question is required.' });
        return;
      }

      const turnId = reqTurnId ?? outboundWatcher.startTurn();
      if (Array.isArray(browserResources)) {
        outboundWatcher.recordBrowserResources(browserResources);
      }

      // Check voice/brain/capture routes BEFORE sending to the LLM (Prompt 02, 05, 06)
      const intercepted = await matchVoiceAndSystemRoutes(
        question,
        brainManager,
        voiceManager,
        hearingManager,
        knowledgeIndex
      );

      if (intercepted.handled) {
        res.json({
          answer: intercepted.answer,
          nodes: intercepted.capturedNote ? [intercepted.capturedNote.node.id] : [],
          isNoteQuery: Boolean(intercepted.capturedNote),
          capturedNote: intercepted.capturedNote ?? null,
          controlTag: null,
          seconds: 0.02,
          brainKey: intercepted.brainKey,
          brainModel: intercepted.brainModel,
          voiceMode: intercepted.voiceMode,
          voiceLabel: intercepted.voiceLabel,
          needsPreloadNotice: intercepted.needsPreloadNotice ?? false,
          turnId
        });
        return;
      }

      // Retrieve top 6 notes by weighted keyword overlap (Prompt 01)
      const retrieval = knowledgeIndex.scoreNotes(question, 6);
      const result = await brainManager.ask(question, retrieval.topNodes, turnId);

      // Handle Control Tags with genuine receipts (Prompt 04)
      if (result.controlTag) {
        const graph = knowledgeIndex.getGraph();
        let receiptAnswer = 'Right away, sir.';
        let citedNodes: number[] = [];

        if (result.controlTag === 'FLY_RANDOM' && graph.nodes.length > 0) {
          const pick = graph.nodes[Math.floor(Math.random() * graph.nodes.length)];
          citedNodes = [pick.id];
          receiptAnswer = `Bringing up "${pick.label}" from your ${pick.group} archive, sir.`;
        } else if (result.controlTag === 'RESET_VIEW') {
          receiptAnswer = 'Pulling back to the full constellation view, sir.';
        } else if (result.controlTag === 'RUN_PREFLIGHT') {
          receiptAnswer = 'Opening the preflight harness and measuring your latency budget now, sir.';
        } else if (result.controlTag === 'RUN_DRILL') {
          receiptAnswer = 'Initiating the outbound connection audit drill now, sir.';
        }

        res.json({
          answer: receiptAnswer,
          nodes: citedNodes,
          isNoteQuery: citedNodes.length > 0,
          capturedNote: null,
          controlTag: result.controlTag,
          seconds: result.seconds,
          brainKey: result.brainKey,
          brainModel: result.model,
          voiceMode: voiceManager.getMode(),
          voiceLabel: voiceManager.getVoiceBadgeLabel(),
          turnId
        });
        return;
      }

      // If Jarvis says the notes don't cover it, don't fly camera to weakly matched notes
      const lowerAns = result.answer.toLowerCase();
      const notesDoNotCover =
        lowerAns.includes('do not cover') ||
        lowerAns.includes('does not cover') ||
        lowerAns.includes('not in your notes') ||
        lowerAns.includes('no mention in') ||
        lowerAns.includes('nothing in your notes') ||
        lowerAns.includes('unplugged');

      const finalNodes = retrieval.isNoteQuery && !notesDoNotCover ? retrieval.scoredIds : [];

      res.json({
        answer: result.answer,
        nodes: finalNodes,
        isNoteQuery: finalNodes.length > 0,
        capturedNote: null,
        controlTag: null,
        seconds: result.seconds,
        brainKey: result.brainKey,
        brainModel: result.model,
        voiceMode: voiceManager.getMode(),
        voiceLabel: voiceManager.getVoiceBadgeLabel(),
        turnId
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unexpected brain error';
      res.status(500).json({ error: msg });
    }
  };
  app.post('/api/chat', handleChat);
  app.post('/chat', handleChat);

  // POST /remember and /api/remember: One Door for New Notes (Prompt 05)
  const handleRemember = (req: Request, res: Response) => {
    try {
      const { text } = req.body as { text?: string };
      if (!text || !text.trim()) {
        res.status(400).json({ error: 'Memory text is required.' });
        return;
      }
      const created = knowledgeIndex.createCaptureNote(text);
      res.json({
        ok: true,
        index: created.node.id,
        node: created.node,
        newLinks: created.newLinks,
        relatedNodeId: created.relatedNodeId,
        answer: `Duly noted and filed under "${created.node.label}", sir.`
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Capture failed';
      res.status(500).json({ error: msg });
    }
  };
  app.post('/api/remember', handleRemember);
  app.post('/remember', handleRemember);

  // POST /tts and /api/tts: Cloned / Neural Butler WAV speech with disk cache & X-Jarvis-Voice header (Prompt 02)
  const handleTts = async (req: Request, res: Response) => {
    try {
      const { text, turnId } = req.body as { text?: string; turnId?: number };
      if (!text || !text.trim()) {
        res.status(400).json({ error: 'Text is required for TTS.' });
        return;
      }
      const synth = await voiceManager.synthesize(text, turnId);
      res.setHeader('X-Jarvis-Voice', synth.voiceHeader);
      res.setHeader('X-Jarvis-TTS-Seconds', String(synth.seconds));
      res.setHeader('X-Jarvis-TTS-Cached', synth.cached ? '1' : '0');
      res.setHeader('Access-Control-Expose-Headers', 'X-Jarvis-Voice, X-Jarvis-TTS-Seconds, X-Jarvis-TTS-Cached');

      if (!synth.wavBuffer) {
        // Signals client to speak cleanly via Web Speech API fallback (Prompt 02)
        res.status(204).end();
        return;
      }

      res.setHeader('Content-Type', 'audio/wav');
      res.send(synth.wavBuffer);
    } catch {
      res.setHeader('X-Jarvis-Voice', 'browser');
      res.status(204).end();
    }
  };
  app.post('/api/tts', handleTts);
  app.post('/tts', handleTts);

  // POST /hear and /api/hear: Transcribes 16kHz mono 16-bit WAV captured in browser (Prompt 03)
  const handleHear = async (req: Request, res: Response) => {
    try {
      const wake = req.query.wake === '1';
      const turnHdr = req.headers['x-jarvis-turn'];
      const turnId = typeof turnHdr === 'string' ? Number(turnHdr) : undefined;
      const wavBuffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);

      if (wavBuffer.length < 100) {
        res.json({ text: '', seconds: 0, engine: 'empty' });
        return;
      }

      const result = await hearingManager.transcribeWav(wavBuffer, wake, turnId);
      res.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Hearing transcription failed';
      res.status(500).json({ error: msg });
    }
  };
  app.post('/api/hear', handleHear);
  app.post('/hear', handleHear);

  // GET /drill/connections: Outbound HTTP Watcher log for last turn (Prompt 08)
  app.get(['/drill/connections', '/api/drill/connections'], (_req: Request, res: Response) => {
    const report = outboundWatcher.getLastTurnReport();
    const honestList = computeHonestInternetList(config, brainManager, voiceManager, hearingManager);
    res.json({
      ...report,
      honestInternetList: honestList
    });
  });

  // POST /api/preflight: Live end-to-end Preflight Harness with Latency Budget (Prompt 07)
  app.post('/api/preflight', async (_req: Request, res: Response) => {
    try {
      const report = await runLivePreflight({
        port: PORT,
        projectRoot: PROJECT_ROOT,
        config,
        knowledgeIndex,
        brainManager,
        voiceManager,
        hearingManager
      });
      res.json(report);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Preflight failed' });
    }
  });

  // POST /api/drill: Runs the full Wi-Fi-Off Outbound Watcher Drill (Prompt 08)
  app.post('/api/drill', async (req: Request, res: Response) => {
    try {
      const { browserResources } = req.body as { browserResources?: string[] };
      if (Array.isArray(browserResources)) {
        outboundWatcher.recordBrowserResources(browserResources);
      }
      const drill = await runWifiOffDrill({
        port: PORT,
        config,
        brainManager,
        voiceManager,
        hearingManager
      });
      res.json(drill);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Drill failed' });
    }
  });

  // GET /api/export-local-pack: Downloads self-contained macOS Apple Silicon local kit + live vault notes
  app.get('/api/export-local-pack', (_req: Request, res: Response) => {
    const bundle = buildLocalMacBundle(knowledgeIndex.getGraph());
    res.setHeader('Content-Type', 'text/x-shellscript; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${bundle.filename}"`);
    res.send(bundle.scriptContent);
  });

  // Mount Vite middleware in development or serve dist/ in production
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(PROJECT_ROOT, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Jarvis Knowledge Galaxy live on http://0.0.0.0:${PORT}`);
  });
}

startServer();
