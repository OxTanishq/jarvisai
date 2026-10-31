import { ArrowUpRight, FileText, X } from 'lucide-react';
import type { GraphData, GraphNode } from '../types/jarvis.ts';
import { GROUP_PALETTE } from './KnowledgeGalaxy3D.tsx';

interface NoteInspectorDrawerProps {
  node: GraphNode | null;
  graph: GraphData;
  onClose: () => void;
  onSelectNeighbour: (node: GraphNode) => void;
}

export function NoteInspectorDrawer({
  node,
  graph,
  onClose,
  onSelectNeighbour
}: NoteInspectorDrawerProps) {
  if (!node) return null;

  const palette = GROUP_PALETTE[node.group] ?? GROUP_PALETTE.root;

  // Find connected neighbour nodes
  const neighbourIds = new Set<number>();
  for (const link of graph.links) {
    if (link.source === node.id) neighbourIds.add(link.target);
    if (link.target === node.id) neighbourIds.add(link.source);
  }
  const neighbours = Array.from(neighbourIds)
    .map((id) => graph.nodes.find((n) => n.id === id))
    .filter((n): n is GraphNode => Boolean(n));

  // Render markdown paragraphs with clickable [[Wikilinks]]
  const renderFormattedContent = (markdown: string) => {
    const bodyWithoutH1 = markdown.replace(/^#\s+.+$/m, '').trim();
    const lines = bodyWithoutH1.split('\n');

    return lines.map((line, lineIdx) => {
      const trimmed = line.trim();
      if (!trimmed) {
        return <div key={lineIdx} className="h-2.5" />;
      }

      const isBullet = /^[-*]\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed);
      const cleanLine = trimmed.replace(/^[-*]\s+/, '• ');

      // Parse [[Wikilinks]] and **bold**
      const parts = cleanLine.split(/(\[\[[^\]]+\]\]|\*\*[^*]+\*\*)/g);
      return (
        <p
          key={lineIdx}
          className={`text-sm leading-relaxed text-slate-300 ${isBullet ? 'pl-3 py-0.5' : 'py-1'}`}
        >
          {parts.map((part, pIdx) => {
            if (part.startsWith('[[') && part.endsWith(']]')) {
              const rawTarget = part.slice(2, -2).split('|')[0].trim();
              const matchedNode = graph.nodes.find(
                (n) => n.label.toLowerCase() === rawTarget.toLowerCase()
              );
              if (matchedNode) {
                return (
                  <button
                    key={pIdx}
                    type="button"
                    onClick={() => onSelectNeighbour(matchedNode)}
                    className="inline-flex items-center gap-0.5 text-amber-300 hover:text-amber-200 underline decoration-amber-400/40 underline-offset-2 transition-colors cursor-pointer"
                  >
                    <span>{rawTarget}</span>
                  </button>
                );
              }
              return (
                <span key={pIdx} className="text-slate-200 font-medium">
                  {rawTarget}
                </span>
              );
            }
            if (part.startsWith('**') && part.endsWith('**')) {
              return (
                <strong key={pIdx} className="font-semibold text-slate-100">
                  {part.slice(2, -2)}
                </strong>
              );
            }
            return <span key={pIdx}>{part}</span>;
          })}
        </p>
      );
    });
  };

  return (
    <aside
      aria-label="Selected Note Reader"
      className="fixed top-4 right-4 bottom-28 z-30 w-[min(410px,92vw)] bg-[#0b0f18]/96 border border-white/10 rounded-xl shadow-2xl flex flex-col overflow-hidden transition-transform duration-200"
    >
      {/* Header with unboxed metadata (Zero-Pill Discipline) */}
      <div className="px-5 pt-5 pb-4 border-b border-white/10 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs text-slate-400 mb-1.5 font-mono tabular-nums">
            <span className="capitalize font-sans font-medium" style={{ color: palette.css }}>
              {palette.label}
            </span>
            <span aria-hidden="true">·</span>
            <span>Node #{node.id}</span>
            <span aria-hidden="true">·</span>
            <span>{node.wordCount} words</span>
          </div>
          <h2 className="text-lg font-semibold text-slate-50 leading-snug break-words">
            {node.label}
          </h2>
          <p className="text-xs text-slate-500 mt-1 font-mono truncate">
            notes/{node.relPath}
          </p>
        </div>

        <button
          type="button"
          onClick={onClose}
          aria-label="Close note reader"
          className="p-2 -mr-1 -mt-1 text-slate-400 hover:text-slate-100 rounded-lg hover:bg-white/5 transition-colors cursor-pointer shrink-0"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Scrollable Note Excerpt & Full Body */}
      <div className="flex-1 overflow-y-auto px-5 py-4">
        <div className="mb-4 pb-4 border-b border-white/8">
          <div className="text-xs font-medium text-slate-400 mb-1.5 flex items-center gap-1.5">
            <FileText className="w-3.5 h-3.5 text-slate-500" />
            <span>Indexed Excerpt</span>
          </div>
          <p className="text-xs leading-relaxed text-slate-400">
            {node.excerpt}
          </p>
        </div>

        <div>{renderFormattedContent(node.content)}</div>
      </div>

      {/* Connected Constellation Neighbours */}
      <div className="px-5 py-3.5 border-t border-white/10 bg-[#080b12]">
        <div className="text-xs text-slate-400 mb-2 flex items-center justify-between">
          <span>Connected Constellation Notes</span>
          <span className="font-mono tabular-nums text-slate-500">{neighbours.length}</span>
        </div>
        {neighbours.length === 0 ? (
          <p className="text-xs text-slate-500">No direct wikilinks yet.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
            {neighbours.map((nb) => {
              const nbColor = GROUP_PALETTE[nb.group] ?? GROUP_PALETTE.root;
              return (
                <button
                  key={nb.id}
                  type="button"
                  onClick={() => onSelectNeighbour(nb)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white/[0.04] hover:bg-white/[0.09] border border-white/8 text-xs text-slate-200 transition-colors cursor-pointer whitespace-nowrap"
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full shrink-0"
                    style={{ backgroundColor: nbColor.css }}
                  />
                  <span className="truncate max-w-[170px]">{nb.label}</span>
                  <ArrowUpRight className="w-3 h-3 text-slate-500 shrink-0" />
                </button>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
}
