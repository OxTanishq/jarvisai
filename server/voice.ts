import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { JarvisConfig } from './brains.ts';
import { getGenAIClient } from './genaiClient.ts';
import { outboundWatcher } from './watcher.ts';

export class VoiceManager {
  private config: JarvisConfig['voice'];
  private cacheDir: string;
  private mode: 'local' | 'gemini' | 'browser';
  private localEnginePinned = false;
  private cachedProfileId: string | null = null;
  private lastActivityMs = Date.now();
  private warmTimer: ReturnType<typeof setInterval> | null = null;

  constructor(voiceConfig: JarvisConfig['voice'], cacheDir: string) {
    this.config = voiceConfig;
    this.cacheDir = cacheDir;
    this.mode = voiceConfig.mode || 'gemini';
    fs.mkdirSync(this.cacheDir, { recursive: true });
    this.startKeepWarmLoop();
  }

  public getMode(): 'local' | 'gemini' | 'browser' {
    return this.mode;
  }

  public getVoiceBadgeLabel(): string {
    if (this.mode === 'browser') return 'browser WebSpeech';
    if (this.mode === 'local') return `local ${this.config.profile}`;
    return `gemini ${this.config.profile}`;
  }

  public async setMode(target: 'local' | 'gemini' | 'browser'): Promise<{
    mode: 'local' | 'gemini' | 'browser';
    message: string;
  }> {
    if (target === 'local') {
      const healthy = await this.checkLocalHealth();
      if (!healthy) {
        this.mode = 'browser';
        return {
          mode: 'browser',
          message: 'VoiceStudio is not answering on 127.0.0.1:3900, sir; falling back to the browser voice for now.'
        };
      }
      this.mode = 'local';
      return {
        mode: 'local',
        message: `Local ${this.config.profile} voice online, sir.`
      };
    }

    this.mode = target;
    if (target === 'browser') {
      return { mode: 'browser', message: 'Switched to the browser voice, sir.' };
    }
    return { mode: 'gemini', message: 'Switched to neural butler voice, sir.' };
  }

  public async checkLocalHealth(): Promise<boolean> {
    try {
      const baseUrl = this.config.url.replace(/\/$/, '');
      outboundWatcher.logConnection(`${baseUrl}/health`, 'voicestudio-health');
      const res = await fetch(`${baseUrl}/health`, {
        signal: AbortSignal.timeout(1000)
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  private async ensureLocalEnginePinned(): Promise<string> {
    const baseUrl = this.config.url.replace(/\/$/, '');
    if (!this.localEnginePinned) {
      outboundWatcher.logConnection(`${baseUrl}/engines/select`, 'voicestudio-pin-engine');
      await fetch(`${baseUrl}/engines/select`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          family: 'tts',
          backend_id: this.config.engine,
          model_id: this.config.model_id
        }),
        signal: AbortSignal.timeout(2500)
      }).catch(() => {});
      this.localEnginePinned = true;
    }

    if (!this.cachedProfileId) {
      outboundWatcher.logConnection(`${baseUrl}/profiles`, 'voicestudio-profiles');
      const res = await fetch(`${baseUrl}/profiles`, {
        signal: AbortSignal.timeout(1500)
      });
      if (res.ok) {
        const profiles = (await res.json()) as { id: string; name: string }[] | { profiles?: { id: string; name: string }[] };
        const list = Array.isArray(profiles) ? profiles : profiles.profiles || [];
        const match =
          list.find((p) => p.name.toLowerCase() === this.config.profile.toLowerCase()) || list[0];
        if (match) {
          this.cachedProfileId = match.id;
        }
      }
    }

    return this.cachedProfileId || this.config.profile;
  }

  private getCachePath(providerKey: string, text: string): string {
    const hash = crypto
      .createHash('sha256')
      .update(`${providerKey}::${this.config.profile}::${text}`)
      .digest('hex')
      .slice(0, 24);
    return path.join(this.cacheDir, `${hash}.wav`);
  }

  public async synthesize(
    rawText: string,
    turnId?: number
  ): Promise<{
    wavBuffer: Buffer | null;
    voiceHeader: string;
    cached: boolean;
    seconds: number;
  }> {
    const t0 = performance.now();
    this.lastActivityMs = Date.now();
    // Cap one request at 600 characters per Prompt 02
    const text = rawText.trim().slice(0, 600);

    if (!text || this.mode === 'browser') {
      return {
        wavBuffer: null,
        voiceHeader: 'browser',
        cached: false,
        seconds: Number(((performance.now() - t0) / 1000).toFixed(2))
      };
    }

    // 1. Local VoiceStudio path
    if (this.mode === 'local') {
      const cacheFile = this.getCachePath(`local:${this.config.model_id}`, text);
      if (fs.existsSync(cacheFile)) {
        const buf = fs.readFileSync(cacheFile);
        return {
          wavBuffer: buf,
          voiceHeader: `local:${this.config.profile}`,
          cached: true,
          seconds: Number(((performance.now() - t0) / 1000).toFixed(2))
        };
      }

      const healthy = await this.checkLocalHealth();
      if (!healthy) {
        return {
          wavBuffer: null,
          voiceHeader: 'browser',
          cached: false,
          seconds: Number(((performance.now() - t0) / 1000).toFixed(2))
        };
      }

      try {
        const profileId = await this.ensureLocalEnginePinned();
        const baseUrl = this.config.url.replace(/\/$/, '');
        outboundWatcher.logConnection(`${baseUrl}/v1/audio/speech`, 'voicestudio-tts', turnId);
        const res = await fetch(`${baseUrl}/v1/audio/speech`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: this.config.model_id,
            input: text,
            voice: profileId,
            response_format: 'wav',
            language: this.config.language || 'en'
          })
        });

        if (!res.ok) {
          throw new Error(`VoiceStudio TTS HTTP ${res.status}`);
        }
        const arrBuf = await res.arrayBuffer();
        const wavBuffer = Buffer.from(arrBuf);
        fs.writeFileSync(cacheFile, wavBuffer);

        return {
          wavBuffer,
          voiceHeader: `local:${this.config.profile}`,
          cached: false,
          seconds: Number(((performance.now() - t0) / 1000).toFixed(2))
        };
      } catch {
        return {
          wavBuffer: null,
          voiceHeader: 'browser',
          cached: false,
          seconds: Number(((performance.now() - t0) / 1000).toFixed(2))
        };
      }
    }

    // 2. Gemini Neural Butler TTS path (gemini-3.8-flash-lite-tts unary WAV)
    const geminiModel = this.config.gemini_model || 'gemini-3.8-flash-lite-tts';
    const geminiVoice = this.config.gemini_voice || 'Charon';
    const cacheFile = this.getCachePath(`gemini:${geminiModel}:${geminiVoice}`, text);

    if (fs.existsSync(cacheFile)) {
      const buf = fs.readFileSync(cacheFile);
      return {
        wavBuffer: buf,
        voiceHeader: `gemini:${this.config.profile}`,
        cached: true,
        seconds: Number(((performance.now() - t0) / 1000).toFixed(2))
      };
    }

    try {
      outboundWatcher.logConnection(
        `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}`,
        `tts:${geminiModel}`,
        turnId
      );
      const ai = getGenAIClient();
      const response = await ai.models.generateContent({
        model: geminiModel,
        contents: [
          {
            role: 'user',
            parts: [
              {
                text,
                speechMetadata: {
                  style: 'Calm, dry, impeccably polite British butler with crisp articulation'
                }
              }
            ]
          }
        ],
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: geminiVoice }
            }
          }
        }
      });

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (!base64Audio) {
        throw new Error('No audio returned from TTS model');
      }

      const wavBuffer = Buffer.from(base64Audio, 'base64');
      fs.writeFileSync(cacheFile, wavBuffer);

      return {
        wavBuffer,
        voiceHeader: `gemini:${this.config.profile}`,
        cached: false,
        seconds: Number(((performance.now() - t0) / 1000).toFixed(2))
      };
    } catch {
      return {
        wavBuffer: null,
        voiceHeader: 'browser',
        cached: false,
        seconds: Number(((performance.now() - t0) / 1000).toFixed(2))
      };
    }
  }

  // Prompt 02 Keep-It-Warm: every 10 idle minutes, warm local VoiceStudio so model stays in RAM
  private startKeepWarmLoop(): void {
    this.warmTimer = setInterval(async () => {
      const idleMs = Date.now() - this.lastActivityMs;
      if (this.mode === 'local' && idleMs >= 10 * 60 * 1000) {
        const healthy = await this.checkLocalHealth();
        if (healthy) {
          try {
            const profileId = await this.ensureLocalEnginePinned();
            const baseUrl = this.config.url.replace(/\/$/, '');
            await fetch(`${baseUrl}/v1/audio/speech`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                model: this.config.model_id,
                input: 'Standing by.',
                voice: profileId,
                response_format: 'wav',
                language: 'en'
              }),
              signal: AbortSignal.timeout(5000)
            });
          } catch {
            // Ignore warm ping error
          }
        }
      }
    }, 60 * 1000);
    if (this.warmTimer.unref) {
      this.warmTimer.unref();
    }
  }
}
