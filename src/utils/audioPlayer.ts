/**
 * THE PLAYER, THE CHUNKING LAW & THE MUTE FLAG (Prompt 02):
 * 1. Sentence-packed chunks of ~170 characters, NEVER breaking inside a sentence.
 * 2. Request chunk 0, play it, and prefetch chunk 1 while chunk 0 plays so playback never gaps.
 * 3. THE MUTE FLAG: if URL contains ?mute=1, NOTHING in this tab ever speaks.
 *    Checked inside the ONE function (`playSingleChunk`) that plays audio so nothing routes around it.
 */

export function isTabMuted(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('mute') === '1';
}

export function chunkIntoSentencePacks(text: string, targetChars = 170): string[] {
  const cleaned = text
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, t, a) => a || t)
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return [];

  // Split strictly on sentence-ending punctuation followed by whitespace
  const rawSentences = cleaned.split(/(?<=[.!?])\s+/);
  const chunks: string[] = [];
  let current = '';

  for (const sentence of rawSentences) {
    const trimmed = sentence.trim();
    if (!trimmed) continue;

    if (!current) {
      current = trimmed;
    } else if (current.length + 1 + trimmed.length <= targetChars) {
      current = `${current} ${trimmed}`;
    } else {
      chunks.push(current);
      current = trimmed;
    }
  }

  if (current) {
    chunks.push(current);
  }

  // Cap any extraordinary single run-on sentence at 600 chars per Prompt 02
  return chunks.map((c) => c.slice(0, 600));
}

interface PrefetchedChunk {
  text: string;
  audioBlob: Blob | null;
  voiceHeader: string;
}

let activeRunToken = 0;
let currentHtmlAudio: HTMLAudioElement | null = null;
let currentObjectUrl: string | null = null;

export function stopJarvisSpeech(): void {
  activeRunToken += 1;
  if (currentHtmlAudio) {
    currentHtmlAudio.pause();
    currentHtmlAudio.src = '';
    currentHtmlAudio = null;
  }
  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = null;
  }
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
}

async function fetchTtsChunk(text: string, turnId?: number): Promise<PrefetchedChunk> {
  try {
    const res = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, turnId })
    });
    const voiceHeader = res.headers.get('X-Jarvis-Voice') || 'browser';
    if (res.status === 200 && res.headers.get('Content-Type')?.includes('audio/wav')) {
      const blob = await res.blob();
      return { text, audioBlob: blob, voiceHeader };
    }
    return { text, audioBlob: null, voiceHeader: 'browser' };
  } catch {
    return { text, audioBlob: null, voiceHeader: 'browser' };
  }
}

/**
 * THE ONE AND ONLY AUDIO OUTPUT GATE (Prompt 02 & Prompt 07):
 * Refuses to emit sound whenever `?mute=1` is present in window.location.search.
 */
async function playSingleChunk(chunk: PrefetchedChunk, runToken: number): Promise<void> {
  // Mandatory single-gate ?mute=1 check: nothing in a muted tab ever speaks
  if (isTabMuted() || runToken !== activeRunToken) {
    return;
  }

  if (chunk.audioBlob && chunk.audioBlob.size > 44) {
    await new Promise<void>((resolve) => {
      if (isTabMuted() || runToken !== activeRunToken) {
        resolve();
        return;
      }
      const url = URL.createObjectURL(chunk.audioBlob!);
      currentObjectUrl = url;
      const audio = new Audio(url);
      currentHtmlAudio = audio;

      const finish = () => {
        if (currentObjectUrl === url) {
          URL.revokeObjectURL(url);
          currentObjectUrl = null;
        }
        if (currentHtmlAudio === audio) {
          currentHtmlAudio = null;
        }
        resolve();
      };

      audio.onended = finish;
      audio.onerror = finish;
      audio.play().catch(() => {
        // Browser autoplay policy blocked un-gestured boot greeting: resolve gracefully without crashing
        finish();
      });
    });
    return;
  }

  // Fallback: Browser Web Speech API
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    await new Promise<void>((resolve) => {
      if (isTabMuted() || runToken !== activeRunToken) {
        resolve();
        return;
      }
      const utter = new SpeechSynthesisUtterance(chunk.text);
      utter.rate = 1.02;
      utter.pitch = 0.94;
      const voices = window.speechSynthesis.getVoices();
      const british =
        voices.find((v) => /en-GB/i.test(v.lang) && /Daniel|Arthur|Male|Google UK English Male/i.test(v.name)) ||
        voices.find((v) => /en-GB/i.test(v.lang));
      if (british) {
        utter.voice = british;
      }
      utter.onend = () => resolve();
      utter.onerror = () => resolve();
      window.speechSynthesis.speak(utter);
    });
  }
}

export async function speakButlerReply(
  fullText: string,
  options?: {
    turnId?: number;
    onStartSpeaking?: (voiceHeader: string, firstAudioSeconds: number) => void;
    onFinishSpeaking?: () => void;
  }
): Promise<void> {
  stopJarvisSpeech();
  const myToken = ++activeRunToken;
  const chunks = chunkIntoSentencePacks(fullText, 170);

  if (chunks.length === 0) {
    options?.onFinishSpeaking?.();
    return;
  }

  // If muted by ?mute=1, still honor state transitions quickly without emitting any audio
  if (isTabMuted()) {
    options?.onStartSpeaking?.('muted', 0);
    options?.onFinishSpeaking?.();
    return;
  }

  const t0 = performance.now();
  let nextPromise: Promise<PrefetchedChunk> | null = fetchTtsChunk(chunks[0], options?.turnId);

  for (let i = 0; i < chunks.length; i++) {
    if (myToken !== activeRunToken) break;

    const readyChunk = await nextPromise!;
    if (myToken !== activeRunToken) break;

    // Prefetch chunk i + 1 immediately BEFORE awaiting playback of chunk i so playback never gaps
    if (i + 1 < chunks.length) {
      nextPromise = fetchTtsChunk(chunks[i + 1], options?.turnId);
    } else {
      nextPromise = null;
    }

    if (i === 0) {
      const firstAudioSec = Number(((performance.now() - t0) / 1000).toFixed(2));
      options?.onStartSpeaking?.(readyChunk.voiceHeader, firstAudioSec);
    }

    await playSingleChunk(readyChunk, myToken);
  }

  if (myToken === activeRunToken) {
    options?.onFinishSpeaking?.();
  }
}
