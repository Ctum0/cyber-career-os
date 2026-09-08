'use client';
import { useEffect, useRef, useState } from 'react';
import { getGraphNodes, getGraphVisualization } from '@/lib/api';
import type { GraphNode, GraphVisualization } from '@/lib/types';
import ForceGraph from '@/components/ForceGraph';
import { PageHeader, ConfidenceBar, Modal, EmptyState, InlineLoader, confidenceTone } from '@/components/ui';
import { Network, Table, Search, Filter, X } from 'lucide-react';
import Link from 'next/link';

const NODE_TYPES = ['', 'vuln', 'tool', 'mitigation', 'skill', 'project', 'ctf', 'role', 'company', 'interview_q', 'source'];
const SEARCH_DEBOUNCE_MS = 300;

export default function GraphPage() {
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [visData, setVisData] = useState<GraphVisualization>({ nodes: [], links: [] });
  const [typeFilter, setTypeFilter] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [viewMode, setViewMode] = useState<'graph' | 'table'>('graph');
  const [loading, setLoading] = useState<boolean>(true);

  // Debounce search: one request per pause, not per keystroke.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setSearch(searchInput), SEARCH_DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchInput]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      getGraphNodes(typeFilter || undefined, search || undefined),
      getGraphVisualization(),
    ])
      .then(([nodesData, graphVis]) => {
        if (cancelled) return;
        setNodes(nodesData || []);
        if (graphVis) {
          // The viz endpoint returns everything (up to its caps); filter locally
          // so the graph view matches the node list without extra requests.
          let filteredNodes = graphVis.nodes || [];
          if (typeFilter) filteredNodes = filteredNodes.filter((n) => n.type === typeFilter);
          if (search) {
            const s = search.toLowerCase();
            filteredNodes = filteredNodes.filter((n) => n.label?.toLowerCase().includes(s));
          }
          const allowed = new Set(filteredNodes.map((n) => n.id));
          const filteredLinks = (graphVis.links || []).filter(
            (l) => allowed.has(l.source) && allowed.has(l.target)
          );
          setVisData({ nodes: filteredNodes, links: filteredLinks });
        }
      })
      .catch(console.error)
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [typeFilter, search]);

  return (
    <div>
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <PageHeader
          title="Knowledge Graph"
          description="Explore cyber threats, tools, vulnerabilities, skills, and mitigation relationships."
        />

        {/* View Switcher */}
        <div className="flex items-center gap-1 bg-slate-200 dark:bg-slate-900 p-1.5 rounded-xl border border-slate-300 dark:border-slate-800">
          <button
            onClick={() => setViewMode('graph')}
            aria-pressed={viewMode === 'graph'}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              viewMode === 'graph'
                ? 'bg-white dark:bg-slate-800 text-cyber-600 dark:text-cyber-400 shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <Network className="w-4 h-4" />
            Interactive Graph
          </button>
          <button
            onClick={() => setViewMode('table')}
            aria-pressed={viewMode === 'table'}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              viewMode === 'table'
                ? 'bg-white dark:bg-slate-800 text-cyber-600 dark:text-cyber-400 shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <Table className="w-4 h-4" />
            Table View
          </button>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="flex flex-col sm:flex-row gap-4 mb-6">
        <div className="relative w-full sm:w-64">
          <Filter className="absolute left-3.5 top-3 w-4 h-4 text-slate-400" />
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            aria-label="Filter by node type"
            className="input pl-10 pr-4 appearance-none"
          >
            <option value="">All Node Types</option>
            {NODE_TYPES.filter(Boolean).map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-3 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search nodes by title or description..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            aria-label="Search nodes"
            className="input pl-10"
          />
          {searchInput && (
            <button
              onClick={() => setSearchInput('')}
              aria-label="Clear search"
              className="absolute right-3 top-3 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Main View Area */}
      {loading ? (
        <InlineLoader label="Loading graph..." />
      ) : viewMode === 'graph' ? (
        <div className="space-y-4">
          {visData.nodes.length === 0 ? (
            <div className="card">
              <EmptyState
                message="No nodes matching your query."
                hint="Try resetting filters, or ingest new content to populate the graph."
              />
            </div>
          ) : (
            <ForceGraph
              nodes={visData.nodes}
              links={visData.links}
              onSelectNode={(n) => {
                const fullNode = nodes.find((item) => item.id === n.id);
                setSelectedNode(
                  fullNode ?? {
                    id: n.id, type: n.type, label: n.label,
                    description: '', confidence_score: n.score ?? 0,
                    last_touched: '', created_at: '', metadata: {},
                  }
                );
              }}
              selectedNodeId={selectedNode?.id}
            />
          )}
        </div>
      ) : (
        <div className="card overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                  <th scope="col" className="text-left py-3.5 px-4 text-xs font-semibold uppercase tracking-wider">Type</th>
                  <th scope="col" className="text-left py-3.5 px-4 text-xs font-semibold uppercase tracking-wider">Label</th>
                  <th scope="col" className="text-left py-3.5 px-4 text-xs font-semibold uppercase tracking-wider">Confidence</th>
                  <th scope="col" className="text-left py-3.5 px-4 text-xs font-semibold uppercase tracking-wider">Last Touched</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                {nodes.map((node) => (
                  <tr
                    key={node.id}
                    className="hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer transition-colors"
                    onClick={() => setSelectedNode(node)}
                  >
                    <td className="py-3 px-4">
                      <span className="badge badge-slate">{node.type}</span>
                    </td>
                    <td className="py-3 px-4 font-medium text-slate-900 dark:text-slate-100">{node.label}</td>
                    <td className="py-3 px-4">
                      {node.type === 'skill' ? (
                        <ConfidenceBar score={node.confidence_score} width="w-32" />
                      ) : (
                        <span className="text-slate-400 dark:text-slate-600">—</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-sm text-slate-500 dark:text-slate-400">{node.last_touched}</td>
                  </tr>
                ))}
                {nodes.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-12 text-center text-slate-500 dark:text-slate-400">
                      No nodes matching your query. Try resetting filters or ingesting new content.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Selected Node Inspector */}
      <Modal
        open={!!selectedNode}
        onClose={() => setSelectedNode(null)}
        badge={
          selectedNode && (
            <span className="badge bg-cyber-500/10 text-cyber-600 dark:text-cyber-400 border-cyber-500/20 uppercase text-[10px] font-bold">
              {selectedNode.type}
            </span>
          )
        }
        title={selectedNode?.label ?? ''}
        footer={
          <>
            {selectedNode?.type === 'skill' ? (
              <Link href="/skills" className="btn-primary text-xs flex items-center gap-1">
                Practice Skill →
              </Link>
            ) : selectedNode?.type === 'project' ? (
              <Link href="/projects" className="btn-primary text-xs flex items-center gap-1">
                View Project →
              </Link>
            ) : (
              <div />
            )}
            <button onClick={() => setSelectedNode(null)} className="btn-secondary text-xs">
              Close Inspector
            </button>
          </>
        }
      >
        {selectedNode && (
          <div className="space-y-3 text-sm">
            <div>
              <span className="text-xs text-slate-400 uppercase font-semibold">Node Identifier</span>
              <p className="font-mono text-xs text-slate-700 dark:text-slate-300 mt-0.5">{selectedNode.id}</p>
            </div>
            <div>
              <span className="text-xs text-slate-400 uppercase font-semibold">Description</span>
              <p className="text-slate-700 dark:text-slate-300 mt-0.5">
                {selectedNode.description || 'No description provided.'}
              </p>
            </div>
            {selectedNode.confidence_score !== undefined && (
              <div>
                <span className="text-xs text-slate-400 uppercase font-semibold">Confidence Score</span>
                <div className="mt-1">
                  <ConfidenceBar score={selectedNode.confidence_score} width="w-full" />
                </div>
              </div>
            )}
            <div>
              <span className="text-xs text-slate-400 uppercase font-semibold">Last Modified</span>
              <p className="text-slate-600 dark:text-slate-400 mt-0.5">{selectedNode.last_touched || '—'}</p>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
