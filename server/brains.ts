import { ThinkingLevel } from '@google/genai';
import { getGenAIClient } from './genaiClient.ts';
import type { GraphNode } from './indexer.ts';
import { JARVIS_PERSONA_PREFIX } from './persona.ts';
import { outboundWatcher } from './watcher.ts';

export interface BrainEntry {
  provider: 'gemini' | 'openai' | 'anthropic';
  base_url?: string;
  model: string;
  api_key?: string;
  extra_body?: Record<string, unknown>;
  label?: string;
}

export interface JarvisConfig {
  boot_brain: string;
  brains: Record<string, BrainEntry>;
  voice: {
    mode: 'local' | 'gemini' | 'browser';
    url: string;
    engine: string;
    model_id: string;
    profile: string;
    language: string;
    gemini_model: string;
    gemini_voice: string;
  };
  hearing: {
    mode: 'local' | 'gemini';
    url: string;
    model: string;
    wake_model: string;
    gemini_model: string;
  };
}

export interface ChatTurnHistory {
  role: 'user' | 'assistant';
  content: string;
}

export class BrainManager {
  private config: JarvisConfig;
  private activeBrainKey: string;
  private history: ChatTurnHistory[] = [];

  constructor(config: JarvisConfig) {
    this.config = config;
    this.activeBrainKey = config.boot_brain || 'gemini';
  }

  public getActiveBrainKey(): string {
    return this.activeBrainKey;
  }

  public getActiveBrain(): BrainEntry {
    return this.config.brains[this.activeBrainKey] ?? this.config.brains['gemini'];
  }

  public getShelfSummary(): {
    key: string;
    model: string;
    provider: string;
    label: string;
    active: boolean;
    hasPlaceholderKey: boolean;
  }[] {
    return Object.entries(this.config.brains).map(([key, entry]) => ({
      key,
      model: entry.model,
      provider: entry.provider,
      label: entry.label || `${key} (${entry.model})`,
      active: key === this.activeBrainKey,
      hasPlaceholderKey: entry.api_key === 'PUT-YOUR-KEY-HERE'
    }));
  }

  public clearHistory(): void {
    this.history = [];
  }

  public async checkOllamaStatus(): Promise<{
    reachable: boolean;
    models: string[];
    configuredModelInstalled: boolean;
    loadedInMemory: boolean;
  }> {
    const localEntry = this.config.brains['local'];
    const baseUrl = (localEntry?.base_url || 'http://localhost:11434/v1').replace(/\/v1\/?$/, '');
    const targetModel = localEntry?.model || 'qwen3.5:9b';

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 1200);
      outboundWatcher.logConnection(`${baseUrl}/v1/models`, 'ollama-models-check');
      const res = await fetch(`${baseUrl}/v1/models`, { signal: controller.signal });
      clearTimeout(timeout);
      if (!res.ok) {
        return { reachable: false, models: [], configuredModelInstalled: false, loadedInMemory: false };
      }
      const data = (await res.json()) as { data?: { id: string }[] };
      const models = (data.data || []).map((m) => m.id);
      const configuredModelInstalled = models.some(
        (m) => m === targetModel || m.startsWith(targetModel.split(':')[0])
      );

      let loadedInMemory = false;
      try {
        const psRes = await fetch(`${baseUrl}/api/ps`, { signal: AbortSignal.timeout(800) });
        if (psRes.ok) {
          const psData = (await psRes.json()) as { models?: { name: string }[] };
          loadedInMemory = (psData.models || []).some((m) => m.name.includes(targetModel));
        }
      } catch {
        // Optional endpoint
      }

      return { reachable: true, models, configuredModelInstalled, loadedInMemory };
    } catch {
      return { reachable: false, models: [], configuredModelInstalled: false, loadedInMemory: false };
    }
  }

  public async switchBrain(targetKey: string): Promise<{
    switched: boolean;
    activeKey: string;
    model: string;
    needsPreloadNotice: boolean;
    message: string;
  }> {
    const entry = this.config.brains[targetKey];
    if (!entry) {
      return {
        switched: false,
        activeKey: this.activeBrainKey,
        model: this.getActiveBrain().model,
        needsPreloadNotice: false,
        message: `I do not have a "${targetKey}" brain on the shelf, sir.`
      };
    }

    // Prompt 06 Honesty Law: if Anthropic key is still placeholder, stay on current brain and never ask for key in chat
    if (entry.provider === 'anthropic' && (!entry.api_key || entry.api_key === 'PUT-YOUR-KEY-HERE')) {
      return {
        switched: false,
        activeKey: this.activeBrainKey,
        model: this.getActiveBrain().model,
        needsPreloadNotice: false,
        message: `The Claude slot has no key in config.json, sir; remaining on ${this.activeBrainKey} (${this.getActiveBrain().model}).`
      };
    }

    if (targetKey === 'local') {
      const status = await this.checkOllamaStatus();
      if (!status.reachable) {
        return {
          switched: false,
          activeKey: this.activeBrainKey,
          model: this.getActiveBrain().model,
          needsPreloadNotice: false,
          message: `Ollama is not answering on localhost:11434, sir; remaining on ${this.activeBrainKey} (${this.getActiveBrain().model}) until your local engine is running.`
        };
      }
      this.activeBrainKey = 'local';
      return {
        switched: true,
        activeKey: 'local',
        model: entry.model,
        needsPreloadNotice: !status.loadedInMemory,
        message: `Switched to your local ${entry.model} brain, sir.`
      };
    }

    this.activeBrainKey = targetKey;
    return {
      switched: true,
      activeKey: targetKey,
      model: entry.model,
      needsPreloadNotice: false,
      message: `Switched to ${entry.label || entry.model}, sir.`
    };
  }

  public async ask(
    question: string,
    retrievedNotes: GraphNode[],
    turnId?: number
  ): Promise<{
    answer: string;
    brainKey: string;
    model: string;
    seconds: number;
    controlTag: string | null;
  }> {
    const t0 = performance.now();
    const brainKey = this.activeBrainKey;
    const entry = this.getActiveBrain();

    // Dynamic context block placed AFTER stable persona prefix (Prompt 01 & Prompt 04 rule)
    const today = new Date().toISOString().slice(0, 10);
    const notesBlock =
      retrievedNotes.length > 0
        ? retrievedNotes
            .map(
              (n, idx) =>
                `[Note ${idx + 1} | Title: "${n.label}" | Folder: ${n.group}]\n${n.content.trim()}`
            )
            .join('\n\n---\n\n')
        : 'No matching notes retrieved for this query.';

    const dynamicUserMessage = `Current Date: ${today}\n\nRetrieved Notes:\n${notesBlock}\n\nQuestion: ${question}`;

    let rawReply = '';

    if (entry.provider === 'openai') {
      rawReply = await this.callOpenAICompatible(entry, dynamicUserMessage, 600, turnId);
      if (!rawReply.trim()) {
        // Prompt 01 rule: retry once with a bigger token budget if text comes back empty
        rawReply = await this.callOpenAICompatible(entry, dynamicUserMessage, 1200, turnId);
      }
    } else if (entry.provider === 'anthropic') {
      rawReply = await this.callAnthropicMessages(entry, dynamicUserMessage, turnId);
    } else {
      rawReply = await this.callGeminiBrain(entry, dynamicUserMessage, turnId);
    }

    const cleaned = rawReply.trim() || 'I appear to be momentarily lost for words, sir.';

    // Detect control tags in square brackets per Prompt 04
    const tagMatch = cleaned.match(/^\[(FLY_RANDOM|RESET_VIEW|RUN_PREFLIGHT|RUN_DRILL)\]$/i);
    const controlTag = tagMatch ? tagMatch[1].toUpperCase() : null;

    // Update short server-side conversation history (keep last 6 messages = 3 turns)
    if (!controlTag) {
      this.history.push({ role: 'user', content: question });
      this.history.push({ role: 'assistant', content: cleaned });
      if (this.history.length > 6) {
        this.history = this.history.slice(this.history.length - 6);
      }
    }

    const seconds = Number(((performance.now() - t0) / 1000).toFixed(2));
    return {
      answer: cleaned,
      brainKey,
      model: entry.model,
      seconds,
      controlTag
    };
  }

  private async callOpenAICompatible(
    entry: BrainEntry,
    userContent: string,
    maxTokens: number,
    turnId?: number
  ): Promise<string> {
    const baseUrl = (entry.base_url || 'http://localhost:11434/v1').replace(/\/$/, '');
    const endpoint = `${baseUrl}/chat/completions`;
    outboundWatcher.logConnection(endpoint, `chat:${entry.model}`, turnId);

    const messages = [
      { role: 'system', content: JARVIS_PERSONA_PREFIX },
      ...this.history,
      { role: 'user', content: userContent }
    ];

    const body: Record<string, unknown> = {
      model: entry.model,
      messages,
      max_tokens: maxTokens,
      ...(entry.extra_body || {})
    };

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${entry.api_key || 'ollama'}`
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Local brain HTTP ${res.status}: ${errText.slice(0, 180)}`);
    }

    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    return json.choices?.[0]?.message?.content ?? '';
  }

  private async callAnthropicMessages(
    entry: BrainEntry,
    userContent: string,
    turnId?: number
  ): Promise<string> {
    if (!entry.api_key || entry.api_key === 'PUT-YOUR-KEY-HERE') {
      throw new Error('Claude API key is still placeholder in config.json.');
    }
    const baseUrl = (entry.base_url || 'https://api.anthropic.com').replace(/\/$/, '');
    const endpoint = `${baseUrl}/v1/messages`;
    outboundWatcher.logConnection(endpoint, `chat:${entry.model}`, turnId);

    const messages = [
      ...this.history.map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: userContent }
    ];

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': entry.api_key,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: entry.model,
        max_tokens: 600,
        system: JARVIS_PERSONA_PREFIX,
        messages
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Anthropic HTTP ${res.status}: ${errText.slice(0, 180)}`);
    }

    const json = (await res.json()) as {
      content?: { type: string; text?: string }[];
    };
    return json.content?.find((c) => c.type === 'text')?.text ?? '';
  }

  private async callGeminiBrain(
    entry: BrainEntry,
    userContent: string,
    turnId?: number
  ): Promise<string> {
    const primaryModel = entry.model || 'gemini-3.8-flash';
    outboundWatcher.logConnection(
      'https://generativelanguage.googleapis.com/v1beta/models/' + primaryModel,
      `chat:${primaryModel}`,
      turnId
    );
    const ai = getGenAIClient();

    const contents = [
      ...this.history.map((h) => ({
        role: h.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: h.content }]
      })),
      {
        role: 'user',
        parts: [{ text: userContent }]
      }
    ];

    const fallbackChain = [
      primaryModel,
      'gemini-3.1-flash-lite',
      'gemini-flash-latest'
    ];

    let lastErr: unknown = null;
    for (let attempt = 0; attempt < fallbackChain.length; attempt++) {
      const candidateModel = fallbackChain[attempt];
      try {
        const response = await ai.models.generateContent({
          model: candidateModel,
          contents,
          config:
            candidateModel === 'gemini-3.8-flash'
              ? {
                  systemInstruction: JARVIS_PERSONA_PREFIX,
                  thinkingConfig: { thinkingLevel: ThinkingLevel.LOW }
                }
              : candidateModel === 'gemini-3.1-flash-lite'
                ? {
                    systemInstruction: JARVIS_PERSONA_PREFIX,
                    thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL }
                  }
                : {
                    systemInstruction: JARVIS_PERSONA_PREFIX
                  }
        });
        return response.text ?? '';
      } catch (err) {
        lastErr = err;
        const status = (err as { status?: number })?.status;
        const msg = err instanceof Error ? err.message : '';
        const isTransient =
          status === 503 ||
          status === 429 ||
          msg.includes('503') ||
          msg.includes('UNAVAILABLE') ||
          msg.includes('high demand');
        if (isTransient && attempt < fallbackChain.length - 1) {
          continue;
        }
        throw err;
      }
    }

    throw lastErr instanceof Error ? lastErr : new Error('Gemini brain temporarily unavailable');
  }
}
