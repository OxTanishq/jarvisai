import type { BrainManager } from './brains.ts';
import type { HearingManager } from './hear.ts';
import type { LiveKnowledgeIndex, GraphNode, GraphLink } from './indexer.ts';
import type { VoiceManager } from './voice.ts';

export interface InterceptedRouteResult {
  handled: boolean;
  answer?: string;
  brainKey?: string;
  brainModel?: string;
  voiceLabel?: string;
  voiceMode?: 'local' | 'gemini' | 'browser';
  needsPreloadNotice?: boolean;
  capturedNote?: {
    node: GraphNode;
    newLinks: GraphLink[];
    relatedNodeId: number;
  };
}

const CAPTURE_TRIGGERS = /^(?:jarvis[\s,]+)?(?:please\s+)?(?:remember\s+that|note\s+to\s+self|don'?t\s+let\s+me\s+forget|log\s+this)\b/i;

export async function matchVoiceAndSystemRoutes(
  rawInput: string,
  brainManager: BrainManager,
  voiceManager: VoiceManager,
  hearingManager: HearingManager,
  knowledgeIndex: LiveKnowledgeIndex
): Promise<InterceptedRouteResult> {
  const cleaned = rawInput.trim().replace(/^(?:hey\s+jarvis|jarvis)[\s,.:;-]*/i, '').trim();
  const lower = cleaned.toLowerCase().replace(/[.!?]+$/, '').trim();

  // 1. Prompt 05: Total Recall ("remember that...", "note to self...", "don't let me forget...", "log this...")
  if (CAPTURE_TRIGGERS.test(rawInput.trim()) || CAPTURE_TRIGGERS.test(cleaned)) {
    try {
      const created = knowledgeIndex.createCaptureNote(rawInput.trim());
      return {
        handled: true,
        answer: `Duly noted and filed under "${created.node.label}", sir.`,
        brainKey: brainManager.getActiveBrainKey(),
        brainModel: brainManager.getActiveBrain().model,
        voiceLabel: voiceManager.getVoiceBadgeLabel(),
        voiceMode: voiceManager.getMode(),
        capturedNote: {
          node: created.node,
          newLinks: created.newLinks,
          relatedNodeId: created.relatedNodeId
        }
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'disk write error';
      return {
        handled: true,
        answer: `I must report that writing the note failed, sir: ${msg}.`,
        brainKey: brainManager.getActiveBrainKey(),
        brainModel: brainManager.getActiveBrain().model,
        voiceLabel: voiceManager.getVoiceBadgeLabel(),
        voiceMode: voiceManager.getMode()
      };
    }
  }

  // 2. Prompt 02: Voice Routes ("use your local voice", "use the browser voice", "use neural/cloud voice")
  if (/\buse\s+(your\s+)?local\s+voice\b/.test(lower)) {
    const res = await voiceManager.setMode('local');
    return {
      handled: true,
      answer: res.message,
      brainKey: brainManager.getActiveBrainKey(),
      brainModel: brainManager.getActiveBrain().model,
      voiceLabel: voiceManager.getVoiceBadgeLabel(),
      voiceMode: res.mode
    };
  }

  if (/\buse\s+(the\s+|your\s+)?browser\s+voice\b/.test(lower)) {
    const res = await voiceManager.setMode('browser');
    return {
      handled: true,
      answer: res.message,
      brainKey: brainManager.getActiveBrainKey(),
      brainModel: brainManager.getActiveBrain().model,
      voiceLabel: voiceManager.getVoiceBadgeLabel(),
      voiceMode: res.mode
    };
  }

  if (/\buse\s+(the\s+|your\s+)?(neural|cloud|gemini)\s+voice\b/.test(lower)) {
    const res = await voiceManager.setMode('gemini');
    return {
      handled: true,
      answer: res.message,
      brainKey: brainManager.getActiveBrainKey(),
      brainModel: brainManager.getActiveBrain().model,
      voiceLabel: voiceManager.getVoiceBadgeLabel(),
      voiceMode: res.mode
    };
  }

  // 3. Prompt 06: Brain & Mode Switch Routes
  if (/\b(switch\s+to\s+(your\s+)?local\s+brain|back\s+to\s+(your\s+)?local\s+brain)\b/.test(lower)) {
    const res = await brainManager.switchBrain('local');
    return {
      handled: true,
      answer: res.message,
      brainKey: res.activeKey,
      brainModel: res.model,
      voiceLabel: voiceManager.getVoiceBadgeLabel(),
      voiceMode: voiceManager.getMode(),
      needsPreloadNotice: res.needsPreloadNotice
    };
  }

  if (/\bswitch\s+to\s+claude\b/.test(lower)) {
    const res = await brainManager.switchBrain('claude');
    return {
      handled: true,
      answer: res.message,
      brainKey: res.activeKey,
      brainModel: res.model,
      voiceLabel: voiceManager.getVoiceBadgeLabel(),
      voiceMode: voiceManager.getMode()
    };
  }

  if (/\bswitch\s+to\s+(gemini|cloud(\s+brain)?)\b/.test(lower)) {
    const res = await brainManager.switchBrain('gemini');
    return {
      handled: true,
      answer: res.message,
      brainKey: res.activeKey,
      brainModel: res.model,
      voiceLabel: voiceManager.getVoiceBadgeLabel(),
      voiceMode: voiceManager.getMode()
    };
  }

  if (/\bwhich\s+brain\s+are\s+you\s+on\b|\bwhat\s+brain\s+are\s+you\s+(on|using)\b/.test(lower)) {
    const key = brainManager.getActiveBrainKey();
    const entry = brainManager.getActiveBrain();
    return {
      handled: true,
      answer: `I am currently thinking on ${key} (${entry.model}) and speaking via ${voiceManager.getVoiceBadgeLabel()}, sir.`,
      brainKey: key,
      brainModel: entry.model,
      voiceLabel: voiceManager.getVoiceBadgeLabel(),
      voiceMode: voiceManager.getMode()
    };
  }

  if (lower === 'go local' || /\bgo\s+fully\s+local\b/.test(lower)) {
    const bRes = await brainManager.switchBrain('local');
    const vRes = await voiceManager.setMode('local');
    await hearingManager.setMode('local');
    const summary = bRes.switched
      ? `All local engines engaged: ${bRes.model} brain and ${vRes.mode} voice, sir.`
      : `Local Ollama is offline on port 11434, sir; brain stays on ${bRes.activeKey} (${bRes.model}) and voice is ${vRes.mode}.`;
    return {
      handled: true,
      answer: summary,
      brainKey: bRes.activeKey,
      brainModel: bRes.model,
      voiceLabel: voiceManager.getVoiceBadgeLabel(),
      voiceMode: vRes.mode,
      needsPreloadNotice: bRes.needsPreloadNotice
    };
  }

  if (lower === 'go cloud') {
    // Try Claude if configured, otherwise Gemini cloud brain + neural voice
    const claudeAttempt = await brainManager.switchBrain('claude');
    let finalBrain = claudeAttempt;
    if (!claudeAttempt.switched) {
      finalBrain = await brainManager.switchBrain('gemini');
    }
    const vRes = await voiceManager.setMode('gemini');
    await hearingManager.setMode('gemini');
    return {
      handled: true,
      answer: `Cloud link active on ${finalBrain.activeKey} (${finalBrain.model}) with neural voice, sir.`,
      brainKey: finalBrain.activeKey,
      brainModel: finalBrain.model,
      voiceLabel: voiceManager.getVoiceBadgeLabel(),
      voiceMode: vRes.mode
    };
  }

  return { handled: false };
}
