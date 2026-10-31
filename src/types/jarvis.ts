export interface GraphNode {
  id: number;
  label: string;
  group: string;
  relPath: string;
  excerpt: string;
  content: string;
  wordCount: number;
  updatedAt: string;
  x: number;
  y: number;
  z: number;
}

export interface GraphLink {
  source: number;
  target: number;
  reason: 'wikilink' | 'mention';
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

export type ButlerActivityState =
  | 'standing_by'
  | 'listening'
  | 'heard'
  | 'thinking'
  | 'speaking';

export interface BrainShelfItem {
  key: string;
  model: string;
  provider: string;
  label: string;
  active: boolean;
  hasPlaceholderKey: boolean;
}

export interface JarvisRuntimeStatus {
  noteCount: number;
  linkCount: number;
  activeBrainKey: string;
  activeBrainModel: string;
  voiceMode: 'local' | 'gemini' | 'browser';
  voiceLabel: string;
  hearingMode: 'local' | 'gemini';
  shelf: BrainShelfItem[];
  personaWords: number;
  personaEstimatedTokens: number;
}

export interface CapturedNotePayload {
  node: GraphNode;
  newLinks: GraphLink[];
  relatedNodeId: number;
}

export interface ChatTurnResponse {
  answer: string;
  nodes: number[];
  isNoteQuery: boolean;
  capturedNote: CapturedNotePayload | null;
  controlTag: string | null;
  seconds: number;
  brainKey: string;
  brainModel: string;
  voiceMode: 'local' | 'gemini' | 'browser';
  voiceLabel: string;
  needsPreloadNotice?: boolean;
  turnId: number;
}

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
