/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Activity,
  BookOpen,
  ChevronDown,
  ChevronUp,
  Compass,
  Ear,
  Mic,
  Send,
  Square,
  Volume2,
  VolumeX
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { DiagnosticsModal } from './components/DiagnosticsModal.tsx';
import {
  GROUP_PALETTE,
  KnowledgeGalaxy3D,
  type KnowledgeGalaxyHandle
} from './components/KnowledgeGalaxy3D.tsx';
import { NoteInspectorDrawer } from './components/NoteInspectorDrawer.tsx';
import { VaultSearchModal } from './components/VaultSearchModal.tsx';
import type {
  ButlerActivityState,
  ChatTurnResponse,
  DrillReport,
  GraphData,
  GraphLink,
  GraphNode,
  JarvisRuntimeStatus,
  PreflightReport
} from './types/jarvis.ts';
import { isTabMuted, speakButlerReply, stopJarvisSpeech } from './utils/audioPlayer.ts';
import {
  BrowserWavEarController,
  FINISH_MS,
  SILENCE_MS
} from './utils/wavRecorder.ts';

const SAMPLE_PROMPTS = [
  'When does the Hotel Vance wholesale contract renew?',
  'What TDS range do we require for espresso water?',
  'Why did Bramble & Co dispute their October invoice?',
  'Remember that Friday roastery cupping is moved to 3pm',
  'What do you cost to run?'
];

export default function App() {
  const galaxyRef = useRef<KnowledgeGalaxyHandle | null>(null);

  const [graph, setGraph] = useState<GraphData | null>(null);
  const [status, setStatus] = useState<JarvisRuntimeStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [highlightedIds, setHighlightedIds] = useState<number[]>([]);
  const [activeGroupFilter, setActiveGroupFilter] = useState<string | null>(null);

  // Butler Conversational & Audio State
  const [activity, setActivity] = useState<ButlerActivityState>('standing_by');
  const activityRef = useRef<ButlerActivityState>('standing_by');
  activityRef.current = activity;

  const [heardText, setHeardText] = useState<string>('');
  const [butlerReply, setButlerReply] = useState<string>('Hello, sir.');
  const [citedNodes, setCitedNodes] = useState<GraphNode[]>([]);
  const [lastTurnMetrics, setLastTurnMetrics] = useState<{
    hearSec?: number;
    thinkSec?: number;
    speakSec?: number;
  }>({});

  const [questionInput, setQuestionInput] = useState('');
  const [dockCollapsed, setDockCollapsed] = useState(false);
  const [showPromptsMenu, setShowPromptsMenu] = useState(false);

  // Microphone & Hands-Free Wake Word State
  const [handsFreeOn, setHandsFreeOn] = useState(false);
  const [pttRecording, setPttRecording] = useState(false);
  const [micLoudness, setMicLoudness] = useState(0);
  const [utteranceActive, setUtteranceActive] = useState(false);
  const [headphoneNotice, setHeadphoneNotice] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [silenceMs, setSilenceMs] = useState(SILENCE_MS);
  const [finishMs, setFinishMs] = useState(FINISH_MS);

  // Prompt 06 Runtime Change Badge (hidden by default; appears for 5s ONLY when brain or voice changes)
  const [changeBadgeText, setChangeBadgeText] = useState<string | null>(null);
  const lastRuntimeSigRef = useRef<{ brain: string; voice: string } | null>(null);
  const badgeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Modals
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [vaultOpen, setVaultOpen] = useState(false);
  const [preflightReport, setPreflightReport] = useState<PreflightReport | null>(null);
  const [drillReport, setDrillReport] = useState<DrillReport | null>(null);
  const [isRunningPreflight, setIsRunningPreflight] = useState(false);
  const [isRunningDrill, setIsRunningDrill] = useState(false);

  const tabMuted = isTabMuted();
  const bootedGreetingRef = useRef(false);

  // Trigger 5-second Runtime Badge ONLY when brain or voice genuinely changes (Prompt 06 Law)
  const syncRuntimeSignature = useCallback((brainStr: string, voiceStr: string) => {
    const prev = lastRuntimeSigRef.current;
    if (!prev) {
      lastRuntimeSigRef.current = { brain: brainStr, voice: voiceStr };
      return;
    }
    if (prev.brain !== brainStr || prev.voice !== voiceStr) {
      lastRuntimeSigRef.current = { brain: brainStr, voice: voiceStr };
      setChangeBadgeText(`BRAIN ${brainStr}  ·  VOICE ${voiceStr}`);
      if (badgeTimerRef.current) clearTimeout(badgeTimerRef.current);
      badgeTimerRef.current = setTimeout(() => {
        setChangeBadgeText(null);
      }, 5000);
    }
  }, []);

  /**
   * ONE VIEWER FUNCTION FOR NEW NOTES (Prompt 05):
   * Births star at parent position, links into constellation, pulses, flies camera, and opens inspector.
   */
  const addNoteToViewer = useCallback(
    (node: GraphNode, newLinks: GraphLink[], relatedNodeId: number) => {
      setGraph((prev) => {
        if (!prev) return prev;
        if (prev.nodes.some((n) => n.id === node.id)) return prev;
        return {
          nodes: [...prev.nodes, node],
          links: [...prev.links, ...newLinks]
        };
      });
      setStatus((prev) =>
        prev
          ? {
              ...prev,
              noteCount: prev.noteCount + 1,
              linkCount: prev.linkCount + newLinks.length
            }
          : prev
      );
      galaxyRef.current?.addNote(node, newLinks, relatedNodeId);
      setHighlightedIds([node.id]);
      setSelectedNode(node);
    },
    []
  );

  // Run Preflight Harness (Prompt 07)
  const handleRunPreflight = useCallback(async () => {
    setIsRunningPreflight(true);
    try {
      const res = await fetch('/api/preflight', { method: 'POST' });
      if (res.ok) {
        const data = (await res.json()) as PreflightReport;
        setPreflightReport(data);
      }
    } finally {
      setIsRunningPreflight(false);
    }
  }, []);

  // Run Outbound Connection Drill (Prompt 08)
  const handleRunDrill = useCallback(async () => {
    setIsRunningDrill(true);
    try {
      const browserResources = performance
        .getEntriesByType('resource')
        .map((r) => r.name);
      const res = await fetch('/api/drill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ browserResources })
      });
      if (res.ok) {
        const data = (await res.json()) as DrillReport;
        setDrillReport(data);
      }
    } finally {
      setIsRunningDrill(false);
    }
  }, []);

  // Dispatch any spoken or typed command/question to /api/chat
  const dispatchToJarvis = useCallback(
    async (rawQuestion: string, measuredHearSec?: number) => {
      const trimmed = rawQuestion.trim();
      if (!trimmed) return;

      stopJarvisSpeech();
      setMicError(null);
      setActivity('thinking');
      if (measuredHearSec !== undefined) {
        setLastTurnMetrics({ hearSec: measuredHearSec });
      } else {
        setLastTurnMetrics({});
      }

      try {
        const browserResources = performance
          .getEntriesByType('resource')
          .slice(-25)
          .map((r) => r.name);

        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question: trimmed, browserResources })
        });

        if (!res.ok) {
          const errJson = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(errJson.error || `HTTP ${res.status}`);
        }

        const data = (await res.json()) as ChatTurnResponse;

        // Prompt 06 Preload notice if switching to a cold local Ollama model
        if (data.needsPreloadNotice) {
          await speakButlerReply('One moment, sir.');
        }

        setButlerReply(data.answer);
        setLastTurnMetrics((prev) => ({ ...prev, thinkSec: data.seconds }));

        // Update status brain/voice info
        setStatus((prev) =>
          prev
            ? {
                ...prev,
                activeBrainKey: data.brainKey,
                activeBrainModel: data.brainModel,
                voiceMode: data.voiceMode,
                voiceLabel: data.voiceLabel
              }
            : prev
        );

        const brainLabel = `${data.brainKey} ${data.brainModel}`;
        syncRuntimeSignature(brainLabel, data.voiceLabel);

        // 1. Did this turn birth a new capture star? (Prompt 05)
        if (data.capturedNote) {
          addNoteToViewer(
            data.capturedNote.node,
            data.capturedNote.newLinks,
            data.capturedNote.relatedNodeId
          );
          setCitedNodes([data.capturedNote.node]);
        } else if (data.controlTag) {
          // 2. Did the butler emit a Control Tag? (Prompt 04)
          if (data.controlTag === 'RESET_VIEW') {
            setSelectedNode(null);
            setHighlightedIds([]);
            galaxyRef.current?.resetCamera();
          } else if (data.controlTag === 'FLY_RANDOM' && data.nodes.length > 0 && graph) {
            const target = graph.nodes.find((n) => n.id === data.nodes[0]) ?? null;
            setHighlightedIds(data.nodes);
            setSelectedNode(target);
            if (target) galaxyRef.current?.flyToNode(target.id);
          } else if (data.controlTag === 'RUN_PREFLIGHT') {
            setDiagnosticsOpen(true);
            void handleRunPreflight();
          } else if (data.controlTag === 'RUN_DRILL') {
            setDiagnosticsOpen(true);
            void handleRunDrill();
          }
        } else if (data.isNoteQuery && data.nodes.length > 0 && graph) {
          // 3. MAKE THE ANSWER PROVE ITSELF (Prompt 05):
          // - 1 to 3 source notes -> fly camera to top source node and open its panel while speaking
          // - 4+ source notes -> light the whole cluster instead of flying to one
          const matchedNodes = data.nodes
            .map((id) => graph.nodes.find((n) => n.id === id))
            .filter((n): n is GraphNode => Boolean(n));
          setCitedNodes(matchedNodes);
          setHighlightedIds(data.nodes);

          if (data.nodes.length >= 4) {
            setSelectedNode(null);
            galaxyRef.current?.highlightCluster(data.nodes);
          } else if (matchedNodes[0]) {
            setSelectedNode(matchedNodes[0]);
            galaxyRef.current?.flyToNode(matchedNodes[0].id);
          }
        } else {
          // Small talk or out-of-vault query: never jump the camera!
          setCitedNodes([]);
          setHighlightedIds([]);
        }

        // Speak the butler's answer using sentence-packed prefetching player
        await speakButlerReply(data.answer, {
          turnId: data.turnId,
          onStartSpeaking: (voiceHeader, firstAudioSeconds) => {
            setActivity('speaking');
            setLastTurnMetrics((prev) => ({ ...prev, speakSec: firstAudioSeconds }));
            const formattedVoice = voiceHeader.replace(':', ' ');
            if (voiceHeader !== 'muted') {
              syncRuntimeSignature(brainLabel, formattedVoice);
            }
          },
          onFinishSpeaking: () => {
            setActivity(handsFreeOn ? 'listening' : 'standing_by');
          }
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unable to reach Jarvis server.';
        setButlerReply(`I encountered a hiccup, sir: ${msg}`);
        setActivity(handsFreeOn ? 'listening' : 'standing_by');
      }
    },
    [addNoteToViewer, graph, handsFreeOn, handleRunDrill, handleRunPreflight, syncRuntimeSignature]
  );

  const dispatchRef = useRef(dispatchToJarvis);
  dispatchRef.current = dispatchToJarvis;

  // Initialize Browser 16kHz WAV Ear Controller (Prompt 03)
  const earRef = useRef<BrowserWavEarController | null>(null);
  if (!earRef.current && typeof window !== 'undefined') {
    earRef.current = new BrowserWavEarController({
      getIsSpeaking: () => activityRef.current === 'speaking',
      onLoudness: (rms) => setMicLoudness(rms),
      onUtteranceActive: (active) => setUtteranceActive(active),
      onWakePrompt: () => {
        setHeardText('Jarvis');
        setButlerReply('Yes, sir?');
        void speakButlerReply('Yes, sir?', {
          onStartSpeaking: () => setActivity('speaking'),
          onFinishSpeaking: () => setActivity('listening')
        });
      },
      onInterruptWord: () => {
        stopJarvisSpeech();
        setActivity('listening');
      },
      onHeardInterim: (txt) => {
        setHeardText(txt);
        setActivity('heard');
      },
      onFinalCommand: (cmdText, hearSeconds) => {
        setHeardText(cmdText);
        void dispatchRef.current(cmdText, hearSeconds);
      },
      onHeadphoneWarning: () => {
        setHeadphoneNotice(true);
      },
      onError: (msg) => {
        setMicError(msg);
        setHandsFreeOn(false);
        setPttRecording(false);
      }
    });
  }

  // Initial Load + Prompt 04 Boot Greeting ("Hello, sir.")
  useEffect(() => {
    let cancelled = false;
    async function boot() {
      try {
        const [graphRes, statusRes] = await Promise.all([
          fetch('/api/graph'),
          fetch('/api/status')
        ]);
        if (!graphRes.ok || !statusRes.ok) {
          throw new Error('Failed to load initial constellation index.');
        }
        const graphData = (await graphRes.json()) as GraphData;
        const statusData = (await statusRes.json()) as JarvisRuntimeStatus;
        if (cancelled) return;

        setGraph(graphData);
        setStatus(statusData);
        lastRuntimeSigRef.current = {
          brain: `${statusData.activeBrainKey} ${statusData.activeBrainModel}`,
          voice: statusData.voiceLabel
        };

        // Boot Greeting Law (Prompt 04): speak "Hello, sir." and nothing more
        if (!bootedGreetingRef.current) {
          bootedGreetingRef.current = true;
          void speakButlerReply('Hello, sir.', {
            onStartSpeaking: () => setActivity('speaking'),
            onFinishSpeaking: () => setActivity('standing_by')
          });
        }
      } catch (e) {
        if (!cancelled) {
          setLoadError(e instanceof Error ? e.message : 'Boot failure');
        }
      }
    }
    void boot();
    return () => {
      cancelled = true;
      stopJarvisSpeech();
      earRef.current?.disableHandsFree();
    };
  }, []);

  // Keyboard shortcut 'H' to toggle Zen/Cinema dock collapse & Escape to close panels
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      const inInput = tag === 'INPUT' || tag === 'TEXTAREA';

      if (e.key === 'Escape') {
        if (diagnosticsOpen) setDiagnosticsOpen(false);
        else if (vaultOpen) setVaultOpen(false);
        else if (selectedNode) setSelectedNode(null);
        return;
      }

      if (!inInput && (e.key === 'h' || e.key === 'H')) {
        setDockCollapsed((prev) => !prev);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [diagnosticsOpen, vaultOpen, selectedNode]);

  const handleToggleHandsFree = async () => {
    setMicError(null);
    if (handsFreeOn) {
      earRef.current?.disableHandsFree();
      setHandsFreeOn(false);
      setActivity('standing_by');
    } else {
      const ok = await earRef.current?.enableHandsFree();
      if (ok) {
        setHandsFreeOn(true);
        setActivity('listening');
      }
    }
  };

  const handleTogglePushToTalk = async () => {
    setMicError(null);
    if (pttRecording) {
      setPttRecording(false);
      await earRef.current?.stopPushToTalk(handsFreeOn);
    } else {
      stopJarvisSpeech();
      setPttRecording(true);
      setActivity('listening');
      await earRef.current?.startPushToTalk();
    }
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!questionInput.trim()) return;
    const q = questionInput.trim();
    setQuestionInput('');
    setShowPromptsMenu(false);
    setHeardText('');
    void dispatchToJarvis(q);
  };

  const handleManualSwitch = async (opts: {
    brain?: string;
    voice?: 'local' | 'gemini' | 'browser';
  }) => {
    const res = await fetch('/api/switch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(opts)
    });
    if (!res.ok) return;
    const data = (await res.json()) as {
      message: string;
      activeBrainKey: string;
      activeBrainModel: string;
      voiceMode: 'local' | 'gemini' | 'browser';
      voiceLabel: string;
      shelf: JarvisRuntimeStatus['shelf'];
    };
    setStatus((prev) =>
      prev
        ? {
            ...prev,
            activeBrainKey: data.activeBrainKey,
            activeBrainModel: data.activeBrainModel,
            voiceMode: data.voiceMode,
            voiceLabel: data.voiceLabel,
            shelf: data.shelf
          }
        : prev
    );
    const brainStr = `${data.activeBrainKey} ${data.activeBrainModel}`;
    syncRuntimeSignature(brainStr, data.voiceLabel);
    setButlerReply(data.message);
    void speakButlerReply(data.message, {
      onStartSpeaking: () => setActivity('speaking'),
      onFinishSpeaking: () => setActivity(handsFreeOn ? 'listening' : 'standing_by')
    });
  };

  const handleUpdateTimings = (newSilence: number, newFinish: number) => {
    setSilenceMs(newSilence);
    setFinishMs(newFinish);
    earRef.current?.setTimingConstants(newSilence, newFinish);
  };

  const renderStatusText = () => {
    if (pttRecording) return 'Recording Push-to-Talk (16 kHz WAV)…';
    if (activity === 'listening') {
      return utteranceActive
        ? 'Hearing speech…'
        : 'Listening for "Jarvis"…';
    }
    if (activity === 'heard') return `Heard: "${heardText}"`;
    if (activity === 'thinking') return 'Thinking…';
    if (activity === 'speaking') return 'Speaking…';
    return handsFreeOn ? 'Listening for "Jarvis"…' : 'Standing by';
  };

  if (loadError) {
    return (
      <div className="w-screen h-screen bg-[#06080d] flex items-center justify-center p-6">
        <div className="max-w-md p-6 rounded-xl bg-[#0b0f18] border border-white/10 text-center space-y-3">
          <h1 className="text-lg font-semibold text-slate-100">Unable to Initialize Galaxy</h1>
          <p className="text-sm text-slate-400">{loadError}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="px-4 py-2 rounded-lg bg-amber-500 text-slate-950 text-xs font-semibold cursor-pointer"
          >
            Reload Workspace
          </button>
        </div>
      </div>
    );
  }

  return (
    <main className="relative w-screen h-screen overflow-hidden bg-[#06080d] text-slate-100">
      {/* 100% Full-Viewport 3D Knowledge Galaxy */}
      {graph ? (
        <KnowledgeGalaxy3D
          ref={galaxyRef}
          initialGraph={graph}
          selectedNodeId={selectedNode?.id ?? null}
          highlightedIds={highlightedIds}
          activeGroupFilter={activeGroupFilter}
          onSelectNode={(node) => {
            setSelectedNode(node);
            if (node) {
              setHighlightedIds([node.id]);
            }
          }}
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          <div className="text-sm text-slate-400 font-mono">
            Indexing markdown constellation…
          </div>
        </div>
      )}

      {/* Minimal Top-Left Identity, Real Note Count & Status Line (Unboxed Zero-Pill Metadata) */}
      <header className="pointer-events-none fixed top-5 left-6 z-20 max-w-lg space-y-1.5">
        <div className="pointer-events-auto inline-flex flex-wrap items-baseline gap-2.5">
          <h1 className="text-xl font-bold tracking-tight text-slate-50 whitespace-nowrap">
            Jarvis
          </h1>
          <span className="text-slate-600" aria-hidden="true">·</span>
          <span className="text-xs text-slate-300 font-mono tabular-nums whitespace-nowrap">
            {graph ? `${graph.nodes.length} notes indexed` : 'Indexing…'}
          </span>
          {tabMuted && (
            <>
              <span className="text-slate-600" aria-hidden="true">·</span>
              <span className="inline-flex items-center gap-1 text-xs text-amber-300 font-mono whitespace-nowrap">
                <VolumeX className="w-3.5 h-3.5" />
                <span>Muted (?mute=1)</span>
              </span>
            </>
          )}
        </div>

        {/* Live Status Line (Prompt 03) */}
        <div className="flex items-center gap-2 text-xs text-slate-400 font-mono tabular-nums">
          <span className="text-slate-200">{renderStatusText()}</span>
          {(lastTurnMetrics.thinkSec !== undefined || lastTurnMetrics.speakSec !== undefined) &&
            activity === 'standing_by' && (
              <>
                <span className="text-slate-600">·</span>
                <span>
                  {lastTurnMetrics.hearSec !== undefined ? `hear ${lastTurnMetrics.hearSec}s · ` : ''}
                  {lastTurnMetrics.thinkSec !== undefined ? `think ${lastTurnMetrics.thinkSec}s` : ''}
                  {lastTurnMetrics.speakSec !== undefined ? ` · speak ${lastTurnMetrics.speakSec}s` : ''}
                </span>
              </>
            )}
        </div>

        {/* Prompt 06 Runtime Change Badge: Hidden by default; appears for 5s ONLY on brain/voice change */}
        {changeBadgeText && (
          <div
            role="status"
            className="inline-block pt-0.5 text-xs font-mono text-amber-300 tracking-tight transition-opacity duration-200"
          >
            {changeBadgeText}
          </div>
        )}

        {/* Headphone acoustic feedback advisory if speaker bleed detected */}
        {headphoneNotice && (
          <div className="pointer-events-auto mt-1.5 p-2.5 rounded-lg bg-[#0b0f18]/95 border border-amber-400/30 text-xs text-amber-200 flex items-center justify-between gap-3 max-w-sm">
            <span>
              Room speaker bleed detected while speaking, sir—headphones will keep interrupts crisp.
            </span>
            <button
              type="button"
              onClick={() => setHeadphoneNotice(false)}
              className="text-slate-400 hover:text-slate-100 text-xs cursor-pointer shrink-0"
            >
              Dismiss
            </button>
          </div>
        )}

        {micError && (
          <div className="pointer-events-auto mt-1.5 p-2.5 rounded-lg bg-[#0b0f18]/95 border border-rose-400/30 text-xs text-rose-200 max-w-sm">
            {micError}
          </div>
        )}
      </header>

      {/* Slide-Over Note Reader Panel (Open only when inspecting or proving an answer) */}
      <NoteInspectorDrawer
        node={selectedNode}
        graph={graph ?? { nodes: [], links: [] }}
        onClose={() => {
          setSelectedNode(null);
          setHighlightedIds([]);
        }}
        onSelectNeighbour={(nb) => {
          setSelectedNode(nb);
          setHighlightedIds([nb.id]);
          galaxyRef.current?.flyToNode(nb.id);
        }}
      />

      {/* Unified Collapsible Bottom Control Dock (Zero Viewport Occlusion, Zero Backdrop-Blur) */}
      <section
        aria-label="Butler Command Dock"
        className="fixed bottom-5 left-1/2 -translate-x-1/2 z-30 w-[min(920px,94vw)] transition-transform duration-200"
        style={{
          transform: dockCollapsed ? 'translate3d(0, calc(100% - 28px), 0)' : 'translate3d(0, 0, 0)'
        }}
      >
        {/* Cinema / Zen Collapse Tab */}
        <div className="flex justify-center mb-1.5">
          <button
            type="button"
            onClick={() => setDockCollapsed((v) => !v)}
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md bg-[#0b0f18]/95 border border-white/10 text-xs text-slate-400 hover:text-slate-100 transition-colors cursor-pointer whitespace-nowrap"
          >
            {dockCollapsed ? (
              <>
                <ChevronUp className="w-3.5 h-3.5" />
                <span>Show Controls (H)</span>
              </>
            ) : (
              <>
                <ChevronDown className="w-3.5 h-3.5" />
                <span>Hide Controls (H)</span>
              </>
            )}
          </button>
        </div>

        <div className="bg-[#0b0f18]/96 border border-white/12 rounded-xl shadow-2xl p-4 space-y-3">
          {/* Butler Answer Strip + Cited Constellation Sources */}
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <p className="text-sm sm:text-[15px] leading-relaxed text-slate-100">
                {butlerReply}
              </p>

              {citedNodes.length > 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-slate-400">
                  <span className="text-slate-500">Sources:</span>
                  {citedNodes.map((cn, idx) => {
                    const pal = GROUP_PALETTE[cn.group] ?? GROUP_PALETTE.root;
                    return (
                      <span key={cn.id} className="inline-flex items-center gap-2">
                        {idx > 0 && <span className="text-slate-600">·</span>}
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedNode(cn);
                            setHighlightedIds([cn.id]);
                            galaxyRef.current?.flyToNode(cn.id);
                          }}
                          className="hover:text-slate-100 underline decoration-white/25 underline-offset-2 transition-colors cursor-pointer"
                          style={{ color: pal.css }}
                        >
                          {cn.label}
                        </button>
                      </span>
                    );
                  })}
                </div>
              )}
            </div>

            {activity === 'speaking' && !tabMuted && (
              <button
                type="button"
                onClick={() => {
                  stopJarvisSpeech();
                  setActivity(handsFreeOn ? 'listening' : 'standing_by');
                }}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 border border-rose-400/30 text-rose-200 text-xs font-medium transition-colors cursor-pointer shrink-0 whitespace-nowrap"
              >
                <Square className="w-3 h-3 fill-current" />
                <span>Stop Audio</span>
              </button>
            )}
          </div>

          {/* Sample Questions Popover */}
          {showPromptsMenu && (
            <div className="p-2.5 rounded-lg bg-[#070a10] border border-white/10 grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {SAMPLE_PROMPTS.map((sp) => (
                <button
                  key={sp}
                  type="button"
                  onClick={() => {
                    setShowPromptsMenu(false);
                    void dispatchToJarvis(sp);
                  }}
                  className="px-3 py-2 rounded-md text-left text-xs text-slate-300 hover:text-slate-50 hover:bg-white/[0.05] transition-colors cursor-pointer truncate"
                >
                  &ldquo;{sp}&rdquo;
                </button>
              ))}
            </div>
          )}

          {/* Unified Command Input + Voice Controls + Galaxy Filter Bar */}
          <form onSubmit={handleFormSubmit} className="flex flex-wrap items-center gap-2">
            {/* Push-to-Talk 16kHz WAV Mic Button */}
            <button
              type="button"
              onClick={() => void handleTogglePushToTalk()}
              title="Push to Talk (bypasses wake word, encodes 16kHz WAV)"
              className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                pttRecording
                  ? 'bg-rose-500 text-white border-rose-400'
                  : 'bg-white/[0.04] hover:bg-white/[0.08] text-slate-200 border-white/10'
              }`}
            >
              <Mic className="w-3.5 h-3.5" />
              <span>{pttRecording ? 'Finish Clip' : 'Push to Talk'}</span>
            </button>

            {/* Hands-Free "Jarvis" Wake-Word Toggle */}
            <button
              type="button"
              onClick={() => void handleToggleHandsFree()}
              title='Toggle Hands-Free Wake Word ("Jarvis" wakes, "stop" interrupts)'
              className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                handsFreeOn
                  ? 'bg-amber-500/20 text-amber-200 border-amber-400/40'
                  : 'bg-white/[0.04] hover:bg-white/[0.08] text-slate-300 border-white/10'
              }`}
            >
              <Ear className="w-3.5 h-3.5" />
              <span>{handsFreeOn ? 'Wake Word: On' : 'Wake Word'}</span>
              {handsFreeOn && (
                <span className="w-8 h-1.5 bg-black/50 rounded-sm overflow-hidden ml-0.5">
                  <span
                    className="block h-full bg-amber-400 transition-transform duration-75 origin-left"
                    style={{
                      transform: `scaleX(${Math.min(1, micLoudness * 14).toFixed(2)})`
                    }}
                  />
                </span>
              )}
            </button>

            {/* Text Input */}
            <div className="flex-1 min-w-[210px] flex items-center bg-[#06080d] border border-white/12 focus-within:border-amber-400/50 rounded-lg px-3 py-1.5">
              <input
                type="text"
                value={questionInput}
                onChange={(e) => setQuestionInput(e.target.value)}
                placeholder='Ask your notes, "remember that…", or "switch to local brain"…'
                className="w-full bg-transparent text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setShowPromptsMenu((s) => !s)}
                className="text-xs text-slate-400 hover:text-amber-300 px-2 py-0.5 transition-colors cursor-pointer whitespace-nowrap"
              >
                Examples
              </button>
            </div>

            <button
              type="submit"
              disabled={!questionInput.trim() || activity === 'thinking'}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-slate-950 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <Send className="w-3.5 h-3.5" />
              <span>Ask</span>
            </button>
          </form>

          {/* Bottom Dock Secondary Toolbar: Constellation Group Filter + Vault + Diagnostics */}
          <div className="pt-2 border-t border-white/8 flex flex-wrap items-center justify-between gap-2 text-xs">
            {/* Interactive Group Filter Controls */}
            <div className="flex items-center gap-1 overflow-x-auto">
              <button
                type="button"
                onClick={() => {
                  setActiveGroupFilter(null);
                  setSelectedNode(null);
                  setHighlightedIds([]);
                  galaxyRef.current?.resetCamera();
                }}
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                  activeGroupFilter === null
                    ? 'bg-white/10 text-slate-100 font-medium'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Compass className="w-3 h-3" />
                <span>All Stars</span>
              </button>

              {(['strategy', 'operations', 'clients', 'finance', 'product', 'captures'] as const).map(
                (grp) => {
                  const pal = GROUP_PALETTE[grp];
                  const active = activeGroupFilter === grp;
                  return (
                    <button
                      key={grp}
                      type="button"
                      onClick={() => setActiveGroupFilter(active ? null : grp)}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                        active
                          ? 'bg-white/10 text-slate-100 font-medium'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <span
                        className="w-1.5 h-1.5 rounded-full"
                        style={{ backgroundColor: pal.css }}
                      />
                      <span>{pal.label}</span>
                    </button>
                  );
                }
              )}
            </div>

            {/* Vault Index & Preflight / Brain Shelf Actions */}
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setVaultOpen(true)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white/[0.04] hover:bg-white/[0.08] text-slate-300 transition-colors cursor-pointer whitespace-nowrap"
              >
                <BookOpen className="w-3.5 h-3.5 text-slate-400" />
                <span>Vault & Capture</span>
              </button>

              <button
                type="button"
                onClick={() => setDiagnosticsOpen(true)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white/[0.04] hover:bg-white/[0.08] text-slate-300 transition-colors cursor-pointer whitespace-nowrap"
              >
                <Activity className="w-3.5 h-3.5 text-amber-400" />
                <span>Preflight & Shelf</span>
                {status && (
                  <Volume2 className="w-3 h-3 text-slate-500 ml-0.5" />
                )}
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Vault Search & Quick Capture Modal */}
      <VaultSearchModal
        open={vaultOpen}
        nodes={graph?.nodes ?? []}
        onClose={() => setVaultOpen(false)}
        onSelectNode={(n) => {
          setSelectedNode(n);
          setHighlightedIds([n.id]);
          galaxyRef.current?.flyToNode(n.id);
        }}
        onQuickCapture={async (text) => {
          await dispatchToJarvis(text);
        }}
      />

      {/* Live Preflight Harness, Wi-Fi-Off Drill & Brain Shelf Modal */}
      <DiagnosticsModal
        open={diagnosticsOpen}
        onClose={() => setDiagnosticsOpen(false)}
        status={status}
        silenceMs={silenceMs}
        finishMs={finishMs}
        onUpdateTimings={handleUpdateTimings}
        onSwitchRuntime={handleManualSwitch}
        preflightReport={preflightReport}
        drillReport={drillReport}
        isRunningPreflight={isRunningPreflight}
        isRunningDrill={isRunningDrill}
        onRunPreflight={handleRunPreflight}
        onRunDrill={handleRunDrill}
      />
    </main>
  );
}
