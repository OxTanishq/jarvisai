/**
 * THE MICROPHONE, WAKE WORD & FINISH WINDOW (Prompt 03):
 * - No browser SpeechRecognition anywhere in this project (sends audio to cloud silently).
 * - Captures via getUserMedia and encodes 16 kHz mono 16-bit PCM WAV directly in the browser.
 * - Named constants SILENCE_MS (700) and FINISH_MS (900) at top of file.
 */

export const SILENCE_MS = 700;
export const FINISH_MS = 900;
export const MIN_UTTERANCE_MS = 300;

export function encodePcm16Wav(float32Samples: Float32Array, sourceSampleRate: number, targetRate = 16000): Blob {
  // Downsample to 16 kHz mono
  const ratio = sourceSampleRate / targetRate;
  const outLength = Math.max(1, Math.floor(float32Samples.length / ratio));
  const pcm16 = new Int16Array(outLength);

  for (let i = 0; i < outLength; i++) {
    const srcIdx = Math.min(float32Samples.length - 1, Math.floor(i * ratio));
    const clamped = Math.max(-1, Math.min(1, float32Samples[srcIdx]));
    pcm16[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }

  const byteRate = targetRate * 2;
  const dataByteLen = pcm16.byteLength;
  const buffer = new ArrayBuffer(44 + dataByteLen);
  const view = new DataView(buffer);

  const writeAscii = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + dataByteLen, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM format = 1
  view.setUint16(22, 1, true); // Mono = 1 channel
  view.setUint32(24, targetRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, 2, true); // Block align
  view.setUint16(34, 16, true); // 16-bit
  writeAscii(36, 'data');
  view.setUint32(40, dataByteLen, true);

  const targetBytes = new Int16Array(buffer, 44);
  targetBytes.set(pcm16);

  return new Blob([buffer], { type: 'audio/wav' });
}

export async function postWavToHear(
  wavBlob: Blob,
  wakeCheck = false
): Promise<{ text: string; seconds: number }> {
  const res = await fetch(`/api/hear${wakeCheck ? '?wake=1' : ''}`, {
    method: 'POST',
    headers: { 'Content-Type': 'audio/wav' },
    body: wavBlob
  });
  if (!res.ok) {
    throw new Error(`Hearing HTTP ${res.status}`);
  }
  const data = (await res.json()) as { text?: string; seconds?: number };
  return {
    text: (data.text || '').trim(),
    seconds: data.seconds ?? 0
  };
}

export interface HandsFreeCallbacks {
  getIsSpeaking: () => boolean;
  onLoudness: (rms: number) => void;
  onUtteranceActive: (active: boolean) => void;
  onWakePrompt: () => void; // Triggered when user says only "Jarvis" -> speaks "Yes, sir?"
  onInterruptWord: () => void; // Triggered when user says "stop" or "wait" during playback
  onHeardInterim: (text: string) => void;
  onFinalCommand: (commandText: string, hearSeconds: number) => void;
  onHeadphoneWarning: () => void;
  onError: (message: string) => void;
}

export class BrowserWavEarController {
  private stream: MediaStream | null = null;
  private audioCtx: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;
  private mode: 'off' | 'ptt' | 'handsfree' = 'off';

  private silenceMs: number = SILENCE_MS;
  private finishMs: number = FINISH_MS;
  private baseThreshold = 0.018;

  private pttChunks: Float32Array[] = [];
  private utteranceChunks: Float32Array[] = [];
  private inUtterance = false;
  private utteranceStartMs = 0;
  private lastLoudMs = 0;

  private awaitingCommandAfterWake = false;
  private pendingCommandBuffer = '';
  private finishWindowTimer: ReturnType<typeof setTimeout> | null = null;
  private lastHearSeconds = 0;
  private speakerBleedCount = 0;

  private callbacks: HandsFreeCallbacks;

  constructor(callbacks: HandsFreeCallbacks) {
    this.callbacks = callbacks;
  }

  public setTimingConstants(silenceMs: number, finishMs: number): void {
    this.silenceMs = Math.max(300, Math.min(2500, silenceMs));
    this.finishMs = Math.max(300, Math.min(3000, finishMs));
  }

  public getTimingConstants(): { silenceMs: number; finishMs: number } {
    return { silenceMs: this.silenceMs, finishMs: this.finishMs };
  }

  private async ensureStream(): Promise<void> {
    if (this.stream && this.audioCtx) {
      if (this.audioCtx.state === 'suspended') {
        await this.audioCtx.resume();
      }
      return;
    }

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });

    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.audioCtx = new AudioCtx();
    const source = this.audioCtx.createMediaStreamSource(this.stream);
    const processor = this.audioCtx.createScriptProcessor(4096, 1, 1);
    this.processor = processor;

    processor.onaudioprocess = (ev) => {
      const input = ev.inputBuffer.getChannelData(0);
      let sumSq = 0;
      for (let i = 0; i < input.length; i++) {
        sumSq += input[i] * input[i];
      }
      const rms = Math.sqrt(sumSq / input.length);
      this.callbacks.onLoudness(rms);

      if (this.mode === 'ptt') {
        this.pttChunks.push(new Float32Array(input));
        return;
      }

      if (this.mode === 'handsfree') {
        this.processHandsFreeFrame(input, rms);
      }
    };

    source.connect(processor);
    processor.connect(this.audioCtx.destination);
  }

  public async startPushToTalk(): Promise<void> {
    try {
      await this.ensureStream();
      this.pttChunks = [];
      this.mode = 'ptt';
      this.callbacks.onUtteranceActive(true);
    } catch (err) {
      this.callbacks.onError(
        err instanceof Error ? err.message : 'Microphone permission denied.'
      );
    }
  }

  public async stopPushToTalk(resumeHandsFree = false): Promise<void> {
    if (this.mode !== 'ptt' || !this.audioCtx) return;
    const sampleRate = this.audioCtx.sampleRate;
    const chunks = this.pttChunks;
    this.pttChunks = [];
    this.callbacks.onUtteranceActive(false);

    if (resumeHandsFree) {
      this.mode = 'handsfree';
    } else {
      this.shutdownStream();
    }

    const totalLen = chunks.reduce((acc, c) => acc + c.length, 0);
    const durationMs = (totalLen / sampleRate) * 1000;
    if (durationMs < MIN_UTTERANCE_MS) {
      return;
    }

    const merged = new Float32Array(totalLen);
    let offset = 0;
    for (const c of chunks) {
      merged.set(c, offset);
      offset += c.length;
    }

    const wavBlob = encodePcm16Wav(merged, sampleRate, 16000);
    try {
      const { text, seconds } = await postWavToHear(wavBlob, false);
      if (text) {
        this.callbacks.onHeardInterim(text);
        this.callbacks.onFinalCommand(text, seconds);
      }
    } catch (err) {
      this.callbacks.onError(err instanceof Error ? err.message : 'Transcription error');
    }
  }

  public async enableHandsFree(): Promise<boolean> {
    try {
      await this.ensureStream();
      this.mode = 'handsfree';
      this.inUtterance = false;
      this.utteranceChunks = [];
      return true;
    } catch (err) {
      this.callbacks.onError(
        err instanceof Error ? err.message : 'Microphone permission required for hands-free wake word.'
      );
      return false;
    }
  }

  public disableHandsFree(): void {
    if (this.finishWindowTimer) {
      clearTimeout(this.finishWindowTimer);
      this.finishWindowTimer = null;
    }
    this.pendingCommandBuffer = '';
    this.awaitingCommandAfterWake = false;
    this.shutdownStream();
  }

  private shutdownStream(): void {
    this.mode = 'off';
    this.inUtterance = false;
    this.callbacks.onLoudness(0);
    this.callbacks.onUtteranceActive(false);
    if (this.processor) {
      this.processor.disconnect();
      this.processor = null;
    }
    if (this.audioCtx) {
      this.audioCtx.close().catch(() => {});
      this.audioCtx = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
  }

  private processHandsFreeFrame(frame: Float32Array, rms: number): void {
    const now = performance.now();
    const isSpeaking = this.callbacks.getIsSpeaking();
    // Raise threshold 2.4x while Jarvis is speaking so speaker audio doesn't self-trigger (Prompt 03)
    const activeThreshold = isSpeaking ? this.baseThreshold * 2.4 : this.baseThreshold;

    if (rms >= activeThreshold) {
      if (!this.inUtterance) {
        this.inUtterance = true;
        this.utteranceStartMs = now;
        this.utteranceChunks = [];
        this.callbacks.onUtteranceActive(true);
        // Pause finish window timer if user continues speaking mid-thought!
        if (this.finishWindowTimer) {
          clearTimeout(this.finishWindowTimer);
          this.finishWindowTimer = null;
        }
      }
      this.lastLoudMs = now;
      this.utteranceChunks.push(new Float32Array(frame));
    } else if (this.inUtterance) {
      this.utteranceChunks.push(new Float32Array(frame));
      if (now - this.lastLoudMs >= this.silenceMs) {
        const duration = now - this.utteranceStartMs;
        const captured = this.utteranceChunks;
        this.inUtterance = false;
        this.utteranceChunks = [];
        this.callbacks.onUtteranceActive(false);

        if (duration >= MIN_UTTERANCE_MS && this.audioCtx) {
          void this.handleCompletedUtterance(captured, this.audioCtx.sampleRate, isSpeaking);
        }
      }
    }
  }

  private async handleCompletedUtterance(
    chunks: Float32Array[],
    sampleRate: number,
    capturedDuringPlayback: boolean
  ): Promise<void> {
    const totalLen = chunks.reduce((s, c) => s + c.length, 0);
    const merged = new Float32Array(totalLen);
    let offset = 0;
    for (const c of chunks) {
      merged.set(c, offset);
      offset += c.length;
    }
    const wavBlob = encodePcm16Wav(merged, sampleRate, 16000);

    try {
      const { text, seconds } = await postWavToHear(wavBlob, true);
      const cleaned = text.trim();
      if (!cleaned) return;

      // INTERRUPTING LAW (Prompt 03): while Jarvis speaks, listen ONLY for "stop" or "wait"
      if (capturedDuringPlayback || this.callbacks.getIsSpeaking()) {
        const lower = cleaned.toLowerCase().replace(/[^a-z\s]/g, '').trim();
        if (/\b(stop|wait|halt|quiet)\b/.test(lower)) {
          this.speakerBleedCount = 0;
          this.callbacks.onInterruptWord();
        } else {
          this.speakerBleedCount += 1;
          if (this.speakerBleedCount >= 2) {
            this.callbacks.onHeadphoneWarning();
            this.speakerBleedCount = 0;
          }
        }
        return;
      }

      // If we are inside the FINISH WINDOW or waiting after "Yes, sir?", append without needing wake word again
      if (this.pendingCommandBuffer || this.awaitingCommandAfterWake) {
        this.awaitingCommandAfterWake = false;
        const stripped = cleaned.replace(/^(?:hey\s+jarvis|jarvis)[\s,.:;-]*/i, '').trim() || cleaned;
        this.appendToFinishWindow(stripped, seconds);
        return;
      }

      // WAKE WORD CHECK (Prompt 03): must start with "Jarvis" or "Hey Jarvis"; otherwise discard silently!
      const wakeRegex = /^(?:hey\s+jarvis|ok\s+jarvis|jarvis)\b[\s,.:;-]*(.*)$/i;
      const match = cleaned.match(wakeRegex);
      if (!match) {
        // Discarded silently: never logged, never sent anywhere
        return;
      }

      const remainder = (match[1] || '').trim();
      if (!remainder) {
        // User said only "Jarvis" -> reply "Yes, sir?" and treat next utterance as command
        this.awaitingCommandAfterWake = true;
        this.callbacks.onWakePrompt();
        return;
      }

      this.appendToFinishWindow(remainder, seconds);
    } catch {
      // Ignore transient ambient frame failure
    }
  }

  private appendToFinishWindow(segment: string, seconds: number): void {
    this.pendingCommandBuffer = this.pendingCommandBuffer
      ? `${this.pendingCommandBuffer} ${segment}`
      : segment;
    this.lastHearSeconds = Number((this.lastHearSeconds + seconds).toFixed(2));
    this.callbacks.onHeardInterim(this.pendingCommandBuffer);

    if (this.finishWindowTimer) {
      clearTimeout(this.finishWindowTimer);
    }

    this.finishWindowTimer = setTimeout(() => {
      const finalCmd = this.pendingCommandBuffer.trim();
      const totalHear = this.lastHearSeconds;
      this.pendingCommandBuffer = '';
      this.lastHearSeconds = 0;
      this.finishWindowTimer = null;
      if (finalCmd) {
        this.callbacks.onFinalCommand(finalCmd, totalHear);
      }
    }, this.finishMs);
  }
}
