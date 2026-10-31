import type { JarvisConfig } from './brains.ts';
import { getGenAIClient } from './genaiClient.ts';
import { outboundWatcher } from './watcher.ts';

export class HearingManager {
  private config: JarvisConfig['hearing'];
  private mode: 'local' | 'gemini';

  constructor(hearingConfig: JarvisConfig['hearing']) {
    this.config = hearingConfig;
    this.mode = hearingConfig.mode || 'gemini';
  }

  public getMode(): 'local' | 'gemini' {
    return this.mode;
  }

  public async checkLocalWhisperHealth(): Promise<boolean> {
    try {
      const baseUrl = (this.config.url || 'http://127.0.0.1:4701').replace(/\/$/, '');
      outboundWatcher.logConnection(`${baseUrl}/health`, 'whisper-health');
      const res = await fetch(`${baseUrl}/health`, {
        signal: AbortSignal.timeout(1000)
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  public async setMode(target: 'local' | 'gemini'): Promise<{
    mode: 'local' | 'gemini';
    message: string;
  }> {
    if (target === 'local') {
      const ok = await this.checkLocalWhisperHealth();
      if (!ok) {
        return {
          mode: this.mode,
          message: 'Local Whisper ear daemon is not answering on 127.0.0.1:4701; remaining on active transcription ear.'
        };
      }
      this.mode = 'local';
      return { mode: 'local', message: 'Local Whisper ears online.' };
    }
    this.mode = 'gemini';
    return { mode: 'gemini', message: 'Cloud Whisper-grade transcription active.' };
  }

  public async transcribeWav(
    wavBuffer: Buffer,
    useWakeModel = false,
    turnId?: number
  ): Promise<{
    text: string;
    seconds: number;
    engine: string;
  }> {
    const t0 = performance.now();

    if (!wavBuffer || wavBuffer.length < 100) {
      return { text: '', seconds: 0, engine: 'empty' };
    }

    if (this.mode === 'local') {
      const baseUrl = (this.config.url || 'http://127.0.0.1:4701').replace(/\/$/, '');
      const endpoint = `${baseUrl}/hear${useWakeModel ? '?wake=1' : ''}`;
      outboundWatcher.logConnection(endpoint, 'whisper-transcribe', turnId);
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'audio/wav' },
        body: new Uint8Array(wavBuffer)
      });
      if (!res.ok) {
        throw new Error(`Local Whisper HTTP ${res.status}`);
      }
      const data = (await res.json()) as { text?: string };
      return {
        text: (data.text || '').trim(),
        seconds: Number(((performance.now() - t0) / 1000).toFixed(2)),
        engine: useWakeModel ? this.config.wake_model : this.config.model
      };
    }

    // Gemini 3.5 Transcribe server-side transcription of 16kHz WAV captured from getUserMedia
    const transcribeModel = this.config.gemini_model || 'gemini-3.5-transcribe';
    outboundWatcher.logConnection(
      `https://generativelanguage.googleapis.com/v1beta/models/${transcribeModel}`,
      `hear:${transcribeModel}`,
      turnId
    );
    const ai = getGenAIClient();
    const base64Audio = wavBuffer.toString('base64');

    let extracted = '';
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await ai.models.generateContent({
          model: transcribeModel,
          contents: {
            parts: [
              {
                inlineData: {
                  mimeType: 'audio/wav',
                  data: base64Audio
                }
              },
              {
                text: 'Transcribe the spoken English speech in this audio clip verbatim.'
              }
            ]
          }
        });

        const parts = response.candidates?.[0]?.content?.parts ?? [];
        const fromParts = parts
          .map((p) => {
            const anyPart = p as unknown as {
              text?: string;
              audioTranscription?: { text?: string };
            };
            return anyPart.audioTranscription?.text || anyPart.text || '';
          })
          .filter(Boolean)
          .join(' ')
          .trim();

        extracted = fromParts || (response.text ?? '').trim();
        break;
      } catch (err) {
        const status = (err as { status?: number })?.status;
        if ((status === 503 || status === 429) && attempt < 2) {
          await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
          continue;
        }
        throw err;
      }
    }

    return {
      text: extracted,
      seconds: Number(((performance.now() - t0) / 1000).toFixed(2)),
      engine: transcribeModel
    };
  }
}
