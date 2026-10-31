import fs from 'node:fs';
import path from 'node:path';

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

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'that', 'this', 'with', 'from', 'your', 'have', 'are',
  'was', 'were', 'been', 'has', 'had', 'not', 'but', 'what', 'when', 'where',
  'which', 'who', 'whom', 'whose', 'why', 'how', 'can', 'could', 'would',
  'should', 'will', 'shall', 'may', 'might', 'must', 'about', 'into', 'over',
  'after', 'before', 'between', 'under', 'above', 'below', 'our', 'their',
  'there', 'here', 'they', 'them', 'then', 'than', 'also', 'only', 'just',
  'more', 'most', 'some', 'such', 'each', 'every', 'any', 'all', 'both',
  'jarvis', 'sir', 'please', 'tell', 'show', 'give', 'does', 'did', 'notes', 'note'
]);

const SMALL_TALK_PATTERNS = [
  /^(hi|hello|hey|good\s+(morning|afternoon|evening)|greetings|yo)\b/i,
  /^(how\s+are\s+you|who\s+are\s+you|what\s+are\s+you)\b/i,
  /^(thank\s+you|thanks|cheers|well\s+done|brilliant|splendid)\b/i,
  /what\s+(do|does)\s+(you|it|he|jarvis)\s+cost/i,
  /how\s+much\s+do\s+you\s+cost/i,
  /are\s+you\s+(local|private|in\s+the\s+cloud)/i
];

function hashString(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const GROUP_CENTERS: Record<string, [number, number, number]> = {
  strategy: [-42, 22, -18],
  operations: [44, 18, -22],
  clients: [-36, -24, 30],
  finance: [40, -22, 28],
  product: [0, 32, 36],
  captures: [0, -8, -42]
};

function computeNodeInitialPosition(label: string, group: string, index: number): { x: number; y: number; z: number } {
  const center = GROUP_CENTERS[group] ?? [0, 0, 0];
  const h1 = hashString(label + ':x:' + index);
  const h2 = hashString(label + ':y:' + index);
  const h3 = hashString(label + ':z:' + index);

  const theta = ((h1 % 3600) / 3600) * Math.PI * 2;
  const phi = Math.acos(2 * ((h2 % 3600) / 3600) - 1);
  const radius = 14 + ((h3 % 1000) / 1000) * 18;

  return {
    x: Number((center[0] + radius * Math.sin(phi) * Math.cos(theta)).toFixed(2)),
    y: Number((center[1] + radius * Math.sin(phi) * Math.sin(theta)).toFixed(2)),
    z: Number((center[2] + radius * Math.cos(phi)).toFixed(2))
  };
}

function extractWikilinks(markdown: string): string[] {
  const matches: string[] = [];
  const regex = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(markdown)) !== null) {
    matches.push(m[1].trim().toLowerCase());
  }
  return matches;
}

function makeCleanExcerpt(markdown: string, maxLen = 700): string {
  const stripped = markdown
    .replace(/^#\s+.+$/m, '')
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target, alias) => alias || target)
    .trim();
  if (stripped.length <= maxLen) return stripped;
  const cut = stripped.slice(0, maxLen);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > maxLen * 0.7 ? cut.slice(0, lastSpace) : cut) + '…';
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/^-+|-+$/g, ''))
    .filter((w) => w.length >= 2 && !STOP_WORDS.has(w));
}

function stemToken(token: string): string {
  if (token.length > 5 && token.endsWith('ing')) return token.slice(0, -3);
  if (token.length > 4 && token.endsWith('ed')) return token.slice(0, -2);
  if (token.length > 4 && token.endsWith('es')) return token.slice(0, -2);
  if (token.length > 3 && token.endsWith('s')) return token.slice(0, -1);
  return token;
}

class LiveKnowledgeIndex {
  private notesRoot: string;
  private dataOutPath: string;
  private graph: GraphData = { nodes: [], links: [] };

  constructor(notesRoot: string, dataOutPath: string) {
    this.notesRoot = notesRoot;
    this.dataOutPath = dataOutPath;
  }

  public buildFullIndex(): GraphData {
    const mdFiles: { fullPath: string; relPath: string; group: string; label: string }[] = [];

    const walk = (dir: string) => {
      if (!fs.existsSync(dir)) return;
      const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          const relPath = path.relative(this.notesRoot, full).split(path.sep).join('/');
          const parts = relPath.split('/');
          const group = parts.length > 1 ? parts[parts.length - 2] : 'root';
          const label = path.basename(entry.name, '.md');
          mdFiles.push({ fullPath: full, relPath, group, label });
        }
      }
    };

    walk(this.notesRoot);

    const nodes: GraphNode[] = mdFiles.map((file, idx) => {
      const content = fs.readFileSync(file.fullPath, 'utf-8');
      const stat = fs.statSync(file.fullPath);
      const pos = computeNodeInitialPosition(file.label, file.group, idx);
      const words = content.trim().split(/\s+/).filter(Boolean).length;
      return {
        id: idx, // CRITICAL (Prompt 01): numeric id equal to index in nodes array
        label: file.label,
        group: file.group,
        relPath: file.relPath,
        excerpt: makeCleanExcerpt(content, 700),
        content,
        wordCount: words,
        updatedAt: stat.mtime.toISOString().slice(0, 10),
        x: pos.x,
        y: pos.y,
        z: pos.z
      };
    });

    const links = this.computeAllLinks(nodes);
    this.relax3DPositions(nodes, links, 45);

    this.graph = { nodes, links };
    this.persistGraphFiles();
    return this.graph;
  }

  private computeLinksForNode(nodeIdx: number, allNodes: GraphNode[]): GraphLink[] {
    const found: GraphLink[] = [];
    const nodeA = allNodes[nodeIdx];
    const aWiki = new Set(extractWikilinks(nodeA.content));
    const aLowerContent = nodeA.content.toLowerCase();
    const aLowerLabel = nodeA.label.toLowerCase();

    for (let j = 0; j < allNodes.length; j++) {
      if (j === nodeIdx) continue;
      const nodeB = allNodes[j];
      const bWiki = new Set(extractWikilinks(nodeB.content));
      const bLowerContent = nodeB.content.toLowerCase();
      const bLowerLabel = nodeB.label.toLowerCase();

      // Check wikilink match or shared wikilink
      let sharedWiki = aWiki.has(bLowerLabel) || bWiki.has(aLowerLabel);
      if (!sharedWiki) {
        for (const w of aWiki) {
          if (bWiki.has(w)) {
            sharedWiki = true;
            break;
          }
        }
      }

      if (sharedWiki) {
        const s = Math.min(nodeIdx, j);
        const t = Math.max(nodeIdx, j);
        found.push({ source: s, target: t, reason: 'wikilink' });
        continue;
      }

      // Check explicit title mention (> 5 chars so short words don't overlink)
      const mentionsB = bLowerLabel.length > 5 && aLowerContent.includes(bLowerLabel);
      const mentionsA = aLowerLabel.length > 5 && bLowerContent.includes(aLowerLabel);
      if (mentionsB || mentionsA) {
        const s = Math.min(nodeIdx, j);
        const t = Math.max(nodeIdx, j);
        found.push({ source: s, target: t, reason: 'mention' });
      }
    }
    return found;
  }

  private computeAllLinks(nodes: GraphNode[]): GraphLink[] {
    const dedup = new Map<string, GraphLink>();
    for (let i = 0; i < nodes.length; i++) {
      const nodeLinks = this.computeLinksForNode(i, nodes);
      for (const l of nodeLinks) {
        const key = `${l.source}-${l.target}`;
        const existing = dedup.get(key);
        if (!existing || l.reason === 'wikilink') {
          dedup.set(key, l);
        }
      }
    }
    return Array.from(dedup.values());
  }

  private relax3DPositions(nodes: GraphNode[], links: GraphLink[], iterations: number): void {
    const n = nodes.length;
    if (n <= 1) return;

    for (let iter = 0; iter < iterations; iter++) {
      const fx = new Float64Array(n);
      const fy = new Float64Array(n);
      const fz = new Float64Array(n);

      // Repulsion between all pairs
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          let dx = nodes[i].x - nodes[j].x;
          let dy = nodes[i].y - nodes[j].y;
          let dz = nodes[i].z - nodes[j].z;
          const distSq = dx * dx + dy * dy + dz * dz + 4.0;
          const dist = Math.sqrt(distSq);
          const repulse = 260 / distSq;
          dx = (dx / dist) * repulse;
          dy = (dy / dist) * repulse;
          dz = (dz / dist) * repulse;
          fx[i] += dx;
          fy[i] += dy;
          fz[i] += dz;
          fx[j] -= dx;
          fy[j] -= dy;
          fz[j] -= dz;
        }
      }

      // Spring attraction along links
      for (const link of links) {
        const a = nodes[link.source];
        const b = nodes[link.target];
        if (!a || !b) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dz = b.z - a.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) + 0.01;
        const ideal = link.reason === 'wikilink' ? 26 : 34;
        const pull = (dist - ideal) * 0.035;
        const px = (dx / dist) * pull;
        const py = (dy / dist) * pull;
        const pz = (dz / dist) * pull;
        fx[link.source] += px;
        fy[link.source] += py;
        fz[link.source] += pz;
        fx[link.target] -= px;
        fy[link.target] -= py;
        fz[link.target] -= pz;
      }

      // Mild gravity toward origin so clusters remain a cohesive galaxy
      for (let i = 0; i < n; i++) {
        fx[i] -= nodes[i].x * 0.012;
        fy[i] -= nodes[i].y * 0.012;
        fz[i] -= nodes[i].z * 0.012;

        nodes[i].x = Number((nodes[i].x + Math.max(-3, Math.min(3, fx[i]))).toFixed(2));
        nodes[i].y = Number((nodes[i].y + Math.max(-3, Math.min(3, fy[i]))).toFixed(2));
        nodes[i].z = Number((nodes[i].z + Math.max(-3, Math.min(3, fz[i]))).toFixed(2));
      }
    }
  }

  private persistGraphFiles(): void {
    const dir = path.dirname(this.dataOutPath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.dataOutPath, JSON.stringify(this.graph, null, 2), 'utf-8');
  }

  public getGraph(): GraphData {
    return this.graph;
  }

  public scoreNotes(query: string, topK = 6): {
    topNodes: GraphNode[];
    scoredIds: number[];
    isNoteQuery: boolean;
  } {
    const trimmed = query.trim();
    const isSmallTalk = SMALL_TALK_PATTERNS.some((re) => re.test(trimmed));
    if (isSmallTalk) {
      return { topNodes: [], scoredIds: [], isNoteQuery: false };
    }

    const rawTokens = tokenize(trimmed);
    const queryStems = rawTokens.map(stemToken);

    if (queryStems.length === 0) {
      return { topNodes: [], scoredIds: [], isNoteQuery: false };
    }

    const scored: { node: GraphNode; score: number }[] = [];

    for (const node of this.graph.nodes) {
      const titleTokens = tokenize(node.label).map(stemToken);
      const bodyTokens = tokenize(node.content).map(stemToken);
      const titleSet = new Set(titleTokens);
      const bodyFreq = new Map<string, number>();
      for (const bt of bodyTokens) {
        bodyFreq.set(bt, (bodyFreq.get(bt) ?? 0) + 1);
      }

      let score = 0;
      const lowerQuery = trimmed.toLowerCase();
      if (lowerQuery.includes(node.label.toLowerCase())) {
        score += 18;
      }

      for (let i = 0; i < queryStems.length; i++) {
        const stem = queryStems[i];
        const raw = rawTokens[i];
        // Title matches weighted 4x higher per Prompt 01
        if (titleSet.has(stem) || node.label.toLowerCase().includes(raw)) {
          score += 8.0;
        }
        const count = bodyFreq.get(stem) ?? 0;
        if (count > 0) {
          score += Math.min(4.5, 1.5 + Math.log2(count + 1));
        } else if (node.content.toLowerCase().includes(raw)) {
          score += 1.5;
        }
      }

      // Slight boost for freshly captured memories when matched so /remember is immediately authoritative
      if (score > 0 && node.group === 'captures') {
        score += 1.25;
      }

      if (score > 0) {
        scored.push({ node, score });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, topK).map((s) => s.node);
    // Filter ids that genuinely contributed meaningfully (>= 30% of top score)
    const maxScore = scored[0]?.score ?? 0;
    const relevantIds = scored
      .slice(0, topK)
      .filter((s) => s.score >= Math.max(2.0, maxScore * 0.38))
      .map((s) => s.node.id);

    return {
      topNodes: top,
      scoredIds: relevantIds,
      isNoteQuery: top.length > 0
    };
  }

  /**
   * ONE DOOR FOR NEW NOTES (Prompt 05):
   * Writes a real markdown file into captures/, appends node & links to graph-data,
   * updates live search index immediately, and returns the new node + related parent star.
   */
  public createCaptureNote(rawMemoryText: string): {
    node: GraphNode;
    newLinks: GraphLink[];
    relatedNodeId: number;
    filePath: string;
  } {
    const cleaned = rawMemoryText
      .replace(/^(jarvis[\s,]+)?(please\s+)?(remember\s+that|remember|note\s+to\s+self|don'?t\s+let\s+me\s+forget|log\s+this)[\s,:;-]*/i, '')
      .trim();

    if (!cleaned) {
      throw new Error('Empty memory text provided.');
    }

    // Build sensible title from first 5-7 meaningful words
    const words = cleaned.replace(/[.!?]+$/, '').split(/\s+/).slice(0, 6);
    const rawTitle = words
      .map((w, idx) => {
        const cleanW = w.replace(/[^a-zA-Z0-9&-]/g, '');
        if (!cleanW) return '';
        if (idx === 0 || cleanW.length > 3) {
          return cleanW.charAt(0).toUpperCase() + cleanW.slice(1);
        }
        return cleanW.toLowerCase();
      })
      .filter(Boolean)
      .join(' ');

    const baseLabel = rawTitle || `Capture ${new Date().toISOString().slice(11, 19).replace(/:/g, '')}`;
    const capturesDir = path.join(this.notesRoot, 'captures');
    fs.mkdirSync(capturesDir, { recursive: true });

    let finalLabel = baseLabel;
    let suffix = 2;
    while (fs.existsSync(path.join(capturesDir, `${finalLabel}.md`))) {
      finalLabel = `${baseLabel} ${suffix++}`;
    }

    const today = new Date().toISOString().slice(0, 10);

    // Find most related existing note BEFORE inserting so we can cross-link & spawn near it
    const relatedSearch = this.scoreNotes(cleaned, 3);
    const bestRelated = relatedSearch.topNodes[0] ?? this.graph.nodes[0];
    const relatedWikiSection =
      relatedSearch.topNodes.length > 0
        ? `\n\nRelated: ${relatedSearch.topNodes.slice(0, 2).map((n) => `[[${n.label}]]`).join(' · ')}`
        : '';

    const markdownContent = `# ${finalLabel}\n\nCaptured: ${today}\n\n${cleaned}${relatedWikiSection}\n`;
    const filePath = path.join(capturesDir, `${finalLabel}.md`);

    // Write real markdown file to disk (throws loudly if disk write fails)
    fs.writeFileSync(filePath, markdownContent, 'utf-8');

    const newIndex = this.graph.nodes.length;
    const h = hashString(finalLabel + ':' + newIndex);
    const angle = ((h % 360) / 360) * Math.PI * 2;
    const elev = (((h >> 8) % 200) / 200 - 0.5) * 14;
    const dist = 11 + ((h % 90) / 90) * 6;

    const spawnX = bestRelated ? Number((bestRelated.x + Math.cos(angle) * dist).toFixed(2)) : 0;
    const spawnY = bestRelated ? Number((bestRelated.y + elev).toFixed(2)) : 0;
    const spawnZ = bestRelated ? Number((bestRelated.z + Math.sin(angle) * dist).toFixed(2)) : 0;

    const newNode: GraphNode = {
      id: newIndex,
      label: finalLabel,
      group: 'captures',
      relPath: `captures/${finalLabel}.md`,
      excerpt: makeCleanExcerpt(markdownContent, 700),
      content: markdownContent,
      wordCount: markdownContent.trim().split(/\s+/).filter(Boolean).length,
      updatedAt: today,
      x: spawnX,
      y: spawnY,
      z: spawnZ
    };

    this.graph.nodes.push(newNode);

    const computedLinks = this.computeLinksForNode(newIndex, this.graph.nodes);
    // Ensure at least one link to bestRelated so every captured star joins the constellation
    if (computedLinks.length === 0 && bestRelated) {
      computedLinks.push({
        source: bestRelated.id,
        target: newIndex,
        reason: 'mention'
      });
    }

    const existingKeys = new Set(this.graph.links.map((l) => `${l.source}-${l.target}`));
    const addedLinks: GraphLink[] = [];
    for (const l of computedLinks) {
      const k = `${l.source}-${l.target}`;
      if (!existingKeys.has(k)) {
        existingKeys.add(k);
        this.graph.links.push(l);
        addedLinks.push(l);
      }
    }

    this.persistGraphFiles();

    return {
      node: newNode,
      newLinks: addedLinks,
      relatedNodeId: bestRelated ? bestRelated.id : 0,
      filePath
    };
  }

  public removeNoteById(id: number): boolean {
    const target = this.graph.nodes.find((n) => n.id === id);
    if (!target) return false;
    const fullPath = path.join(this.notesRoot, target.relPath);
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
    }
    this.buildFullIndex();
    return true;
  }
}

export function createKnowledgeIndex(notesRoot: string, dataOutPath: string): LiveKnowledgeIndex {
  const index = new LiveKnowledgeIndex(notesRoot, dataOutPath);
  index.buildFullIndex();
  return index;
}

export type { LiveKnowledgeIndex };
