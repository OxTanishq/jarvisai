import { AlertTriangle, Check, Download, Play, ShieldCheck, Sliders, X, XCircle } from 'lucide-react';
import { useState } from 'react';
import type { DrillReport, JarvisRuntimeStatus, PreflightReport } from '../types/jarvis.ts';

interface DiagnosticsModalProps {
  open: boolean;
  onClose: () => void;
  status: JarvisRuntimeStatus | null;
  silenceMs: number;
  finishMs: number;
  onUpdateTimings: (silenceMs: number, finishMs: number) => void;
  onSwitchRuntime: (opts: { brain?: string; voice?: 'local' | 'gemini' | 'browser' }) => Promise<void>;
  preflightReport: PreflightReport | null;
  drillReport: DrillReport | null;
  isRunningPreflight: boolean;
  isRunningDrill: boolean;
  onRunPreflight: () => Promise<void>;
  onRunDrill: () => Promise<void>;
}

export function DiagnosticsModal({
  open,
  onClose,
  status,
  silenceMs,
  finishMs,
  onUpdateTimings,
  onSwitchRuntime,
  preflightReport,
  drillReport,
  isRunningPreflight,
  isRunningDrill,
  onRunPreflight,
  onRunDrill
}: DiagnosticsModalProps) {
  const [activeTab, setActiveTab] = useState<'preflight' | 'drill' | 'shelf'>('preflight');

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Jarvis Diagnostics, Brain Shelf & Local Export"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75"
    >
      <div className="w-full max-w-3xl max-h-[86vh] bg-[#0b0f18] border border-white/12 rounded-xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-slate-100">
              System Diagnostics, Brain Shelf & Local Kit
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Live end-to-end Preflight Harness, Outbound Connection Watcher Drill, and macOS Local Pack export
            </p>
          </div>
          <div className="flex items-center gap-2">
            <a
              href="/api/export-local-pack"
              download="install-local-jarvis.sh"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 border border-amber-400/30 text-amber-200 text-xs font-medium transition-colors whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export Local Mac Pack (.sh)</span>
            </a>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close diagnostics"
              className="p-2 text-slate-400 hover:text-slate-100 rounded-lg hover:bg-white/5 transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Segmented Control Bar */}
        <div className="px-6 pt-3 pb-2 border-b border-white/8 flex items-center justify-between gap-4 bg-[#080b12]">
          <div className="flex items-center gap-1 p-1 bg-white/[0.04] rounded-lg">
            <button
              type="button"
              onClick={() => setActiveTab('preflight')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                activeTab === 'preflight'
                  ? 'bg-slate-800 text-slate-50 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              07. Preflight & Latency Budget
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('drill')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                activeTab === 'drill'
                  ? 'bg-slate-800 text-slate-50 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              08. Outbound Watcher Drill
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('shelf')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                activeTab === 'shelf'
                  ? 'bg-slate-800 text-slate-50 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              06. Brain Shelf & Ear Tuning
            </button>
          </div>

          {status && (
            <div className="hidden sm:flex items-center gap-2 text-xs text-slate-400 font-mono tabular-nums">
              <span>Persona: {status.personaWords}w</span>
              <span>·</span>
              <span>~{status.personaEstimatedTokens} tok</span>
            </div>
          )}
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {activeTab === 'preflight' && (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h3 className="text-sm font-semibold text-slate-100">
                    End-to-End Live Chain Verification
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Executes real live HTTP requests against /chat, /tts, /hear loop, /remember, and /config.json isolation.
                  </p>
                </div>
                <button
                  type="button"
                  disabled={isRunningPreflight}
                  onClick={() => void onRunPreflight()}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>{isRunningPreflight ? 'Running Live Chains…' : 'Run Preflight Now'}</span>
                </button>
              </div>

              {preflightReport ? (
                <>
                  {/* Canonical Two-Line Verdict Box */}
                  <div className="p-4 rounded-lg bg-[#06080d] border border-white/10 font-mono text-xs space-y-1.5 tabular-nums">
                    <div className="text-amber-300 font-medium">
                      {preflightReport.latencyBudget.line}
                    </div>
                    <div className="text-slate-300">
                      SUMMARY: {preflightReport.summary.line}
                    </div>
                  </div>

                  {/* Individual Checks */}
                  <div className="divide-y divide-white/8 border border-white/8 rounded-lg overflow-hidden">
                    {preflightReport.checks.map((chk) => (
                      <div
                        key={chk.id}
                        className="px-4 py-3 bg-white/[0.015] flex items-start justify-between gap-4"
                      >
                        <div className="flex items-start gap-3 min-w-0">
                          {chk.status === 'PASS' && (
                            <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                          )}
                          {chk.status === 'WARN' && (
                            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                          )}
                          {chk.status === 'FAIL' && (
                            <XCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                          )}
                          <div className="min-w-0">
                            <div className="text-xs font-medium text-slate-100">
                              {chk.label}
                            </div>
                            <div className="text-xs text-slate-400 font-mono mt-0.5 break-words">
                              {chk.detail}
                            </div>
                          </div>
                        </div>
                        <span
                          className={`text-xs font-mono shrink-0 ${
                            chk.status === 'PASS'
                              ? 'text-emerald-400'
                              : chk.status === 'WARN'
                                ? 'text-amber-400'
                                : 'text-rose-400'
                          }`}
                        >
                          {chk.status}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="py-12 text-center border border-dashed border-white/10 rounded-lg">
                  <p className="text-sm text-slate-400">
                    Click &ldquo;Run Preflight Now&rdquo; to measure your real hear, think, and speak latency budget.
                  </p>
                </div>
              )}
            </div>
          )}

          {activeTab === 'drill' && (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h3 className="text-sm font-semibold text-slate-100">
                    Outbound Connection Watcher & Wi-Fi-Off Drill
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Runs a full /chat → /tts → /hear loop and audits every socket opened by the server and browser.
                  </p>
                </div>
                <button
                  type="button"
                  disabled={isRunningDrill}
                  onClick={() => void onRunDrill()}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap"
                >
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>{isRunningDrill ? 'Auditing Turn…' : 'Run Connection Drill'}</span>
                </button>
              </div>

              {drillReport ? (
                <div className="space-y-4">
                  <div className="p-4 rounded-lg bg-[#06080d] border border-white/10 font-mono text-xs space-y-1.5">
                    <div className={drillReport.passed ? 'text-emerald-400 font-medium' : 'text-amber-300 font-medium'}>
                      {drillReport.verdictLine}
                    </div>
                    <div className="text-slate-400">
                      Brain: {drillReport.activeBrain} · Voice: {drillReport.activeVoice}
                    </div>
                    <div className="text-slate-300 pt-1">
                      External Hosts Contacted:{' '}
                      {drillReport.externalHosts.length === 0
                        ? '[] (Empty — 100% Local)'
                        : drillReport.externalHosts.join(', ')}
                    </div>
                  </div>

                  <div className="p-4 rounded-lg bg-white/[0.02] border border-white/8 space-y-2 text-xs">
                    <div className="text-slate-400">
                      <strong className="text-slate-200">Question Sent:</strong> {drillReport.questionAsked}
                    </div>
                    <div className="text-slate-400">
                      <strong className="text-slate-200">Butler Answer:</strong> {drillReport.answerSpoken}
                    </div>
                    <div className="text-slate-400">
                      <strong className="text-slate-200">Heard Back From WAV:</strong> {drillReport.transcribedBack}
                    </div>
                  </div>

                  <div>
                    <h4 className="text-xs font-semibold text-slate-200 mb-2">
                      The Honest List (Features Requiring Network Access, Read From Runtime)
                    </h4>
                    <ul className="space-y-1.5 text-xs text-slate-400 font-mono bg-[#06080d] p-4 rounded-lg border border-white/8">
                      {drillReport.honestInternetList.map((item, i) => (
                        <li key={i}>• {item}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              ) : (
                <div className="py-12 text-center border border-dashed border-white/10 rounded-lg">
                  <p className="text-sm text-slate-400">
                    Run the drill to inspect every outbound connection recorded during a live conversational turn.
                  </p>
                </div>
              )}
            </div>
          )}

          {activeTab === 'shelf' && status && (
            <div className="space-y-6">
              {/* Brain Shelf */}
              <div>
                <h3 className="text-sm font-semibold text-slate-100 mb-1">
                  Configured Brain Shelf (Prompt 06)
                </h3>
                <p className="text-xs text-slate-400 mb-3">
                  Switch out loud by saying &ldquo;switch to your local brain&rdquo;, &ldquo;switch to Gemini&rdquo;, or &ldquo;switch to Claude&rdquo;, or select below:
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {status.shelf.map((b) => (
                    <button
                      key={b.key}
                      type="button"
                      onClick={() => void onSwitchRuntime({ brain: b.key })}
                      className={`p-3.5 rounded-lg border text-left transition-colors cursor-pointer ${
                        b.active
                          ? 'bg-amber-500/12 border-amber-400/50 text-slate-50'
                          : 'bg-white/[0.02] border-white/10 hover:bg-white/[0.05] text-slate-300'
                      }`}
                    >
                      <div className="flex items-center justify-between text-xs font-mono text-slate-400 mb-1">
                        <span>{b.key}</span>
                        <span>{b.active ? 'Active' : b.hasPlaceholderKey ? 'No Key' : 'Ready'}</span>
                      </div>
                      <div className="text-sm font-semibold truncate">{b.label}</div>
                      <div className="text-xs text-slate-500 font-mono mt-1 truncate">{b.model}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Voice Engine Mode */}
              <div>
                <h3 className="text-sm font-semibold text-slate-100 mb-1">
                  Voice Bay Output (Prompt 02)
                </h3>
                <p className="text-xs text-slate-400 mb-3">
                  Say &ldquo;use your local voice&rdquo;, &ldquo;use neural voice&rdquo;, or &ldquo;use the browser voice&rdquo;:
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {(
                    [
                      { id: 'gemini', title: 'Gemini Neural Butler', sub: '24kHz WAV + Disk Cache' },
                      { id: 'local', title: 'Local VoiceStudio CSM', sub: '127.0.0.1:3900 · Profile Jarvis' },
                      { id: 'browser', title: 'Browser Web Speech', sub: 'Zero-latency offline fallback' }
                    ] as const
                  ).map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => void onSwitchRuntime({ voice: v.id })}
                      className={`p-3.5 rounded-lg border text-left transition-colors cursor-pointer ${
                        status.voiceMode === v.id
                          ? 'bg-amber-500/12 border-amber-400/50 text-slate-50'
                          : 'bg-white/[0.02] border-white/10 hover:bg-white/[0.05] text-slate-300'
                      }`}
                    >
                      <div className="text-sm font-semibold">{v.title}</div>
                      <div className="text-xs text-slate-400 mt-1">{v.sub}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Personal Hearing Cadence Sliders (SILENCE_MS & FINISH_MS) */}
              <div className="p-4 rounded-lg bg-white/[0.02] border border-white/10 space-y-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
                  <Sliders className="w-4 h-4 text-amber-400" />
                  <span>Personal Hearing Cadence (Prompt 03)</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <div className="flex justify-between text-xs mb-1.5 font-mono tabular-nums">
                      <span className="text-slate-300">SILENCE_MS (end of utterance)</span>
                      <span className="text-amber-300">{silenceMs} ms</span>
                    </div>
                    <input
                      type="range"
                      min={400}
                      max={1600}
                      step={50}
                      value={silenceMs}
                      onChange={(e) => onUpdateTimings(Number(e.target.value), finishMs)}
                      className="w-full accent-amber-400 cursor-pointer"
                    />
                  </div>
                  <div>
                    <div className="flex justify-between text-xs mb-1.5 font-mono tabular-nums">
                      <span className="text-slate-300">FINISH_MS (mid-sentence pause window)</span>
                      <span className="text-amber-300">{finishMs} ms</span>
                    </div>
                    <input
                      type="range"
                      min={400}
                      max={2200}
                      step={50}
                      value={finishMs}
                      onChange={(e) => onUpdateTimings(silenceMs, Number(e.target.value))}
                      className="w-full accent-amber-400 cursor-pointer"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
