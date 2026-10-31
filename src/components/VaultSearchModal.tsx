import { Search, Sparkles, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { GraphNode } from '../types/jarvis.ts';
import { GROUP_PALETTE } from './KnowledgeGalaxy3D.tsx';

interface VaultSearchModalProps {
  open: boolean;
  nodes: GraphNode[];
  onClose: () => void;
  onSelectNode: (node: GraphNode) => void;
  onQuickCapture: (memoryText: string) => Promise<void>;
}

export function VaultSearchModal({
  open,
  nodes,
  onClose,
  onSelectNode,
  onQuickCapture
}: VaultSearchModalProps) {
  const [query, setQuery] = useState('');
  const [groupFilter, setGroupFilter] = useState<string>('all');
  const [captureDraft, setCaptureDraft] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const groups = useMemo(() => {
    const counts = new Map<string, number>();
    for (const n of nodes) {
      counts.set(n.group, (counts.get(n.group) ?? 0) + 1);
    }
    return Array.from(counts.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [nodes]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return nodes.filter((n) => {
      if (groupFilter !== 'all' && n.group !== groupFilter) return false;
      if (!q) return true;
      return (
        n.label.toLowerCase().includes(q) ||
        n.excerpt.toLowerCase().includes(q) ||
        n.group.toLowerCase().includes(q)
      );
    });
  }, [nodes, query, groupFilter]);

  if (!open) return null;

  const handleCreateCapture = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!captureDraft.trim() || isSaving) return;
    setIsSaving(true);
    try {
      await onQuickCapture(`Remember that ${captureDraft.trim()}`);
      setCaptureDraft('');
      onClose();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Knowledge Vault Index"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75"
    >
      <div className="w-full max-w-3xl max-h-[85vh] bg-[#0b0f18] border border-white/12 rounded-xl shadow-2xl flex flex-col overflow-hidden">
        <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-slate-100">
              Markdown Vault Index ({nodes.length} Stars)
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Select any markdown note to fly the 3D constellation camera directly to its coordinates
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close vault index"
            className="p-2 text-slate-400 hover:text-slate-100 rounded-lg hover:bg-white/5 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Direct Live Capture Form (Total Recall · Prompt 05) */}
        <form
          onSubmit={(e) => void handleCreateCapture(e)}
          className="px-6 py-3 bg-[#080b12] border-b border-white/8 flex items-center gap-2"
        >
          <Sparkles className="w-4 h-4 text-amber-400 shrink-0" />
          <input
            type="text"
            value={captureDraft}
            onChange={(e) => setCaptureDraft(e.target.value)}
            placeholder="Birth a new star in captures/ (e.g., Friday espresso cupping moved to 14:00)…"
            className="flex-1 bg-transparent text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none"
          />
          <button
            type="submit"
            disabled={!captureDraft.trim() || isSaving}
            className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-slate-950 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap"
          >
            {isSaving ? 'Indexing…' : 'Capture Note'}
          </button>
        </form>

        {/* Search & Folder Filter */}
        <div className="px-6 py-3 border-b border-white/8 space-y-2.5">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search note titles or contents…"
              className="w-full pl-9 pr-4 py-2 rounded-lg bg-white/[0.04] border border-white/10 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-amber-400/50"
            />
          </div>

          <div className="flex items-center gap-1 overflow-x-auto pb-0.5">
            <button
              type="button"
              onClick={() => setGroupFilter('all')}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                groupFilter === 'all'
                  ? 'bg-slate-800 text-slate-100'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              All ({nodes.length})
            </button>
            {groups.map(([g, count]) => {
              const pal = GROUP_PALETTE[g] ?? GROUP_PALETTE.root;
              return (
                <button
                  key={g}
                  type="button"
                  onClick={() => setGroupFilter(g)}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
                    groupFilter === g
                      ? 'bg-slate-800 text-slate-100'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full"
                    style={{ backgroundColor: pal.css }}
                  />
                  <span className="capitalize">{pal.label}</span>
                  <span className="font-mono text-slate-500 tabular-nums">{count}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Notes List */}
        <div className="flex-1 overflow-y-auto divide-y divide-white/6">
          {filtered.map((n) => {
            const pal = GROUP_PALETTE[n.group] ?? GROUP_PALETTE.root;
            return (
              <button
                key={n.id}
                type="button"
                onClick={() => {
                  onSelectNode(n);
                  onClose();
                }}
                className="w-full px-6 py-3.5 text-left hover:bg-white/[0.03] transition-colors cursor-pointer flex items-start justify-between gap-4"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-xs text-slate-400 mb-0.5 font-mono tabular-nums">
                    <span className="font-sans font-medium capitalize" style={{ color: pal.css }}>
                      {pal.label}
                    </span>
                    <span>·</span>
                    <span>#{n.id}</span>
                    <span>·</span>
                    <span>{n.wordCount} words</span>
                  </div>
                  <div className="text-sm font-medium text-slate-100 truncate">
                    {n.label}
                  </div>
                  <p className="text-xs text-slate-400 line-clamp-1 mt-0.5">
                    {n.excerpt}
                  </p>
                </div>
                <span className="text-xs text-amber-300/80 shrink-0 self-center">
                  Fly to star →
                </span>
              </button>
            );
          })}
          {filtered.length === 0 && (
            <div className="py-12 text-center text-sm text-slate-500">
              No markdown notes match &ldquo;{query}&rdquo;.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
