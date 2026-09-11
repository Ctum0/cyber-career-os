'use client';
import { useCallback, useEffect, useState } from 'react';
import { ingestText, getIngestQueue, retryQueueItem } from '@/lib/api';
import type { IngestResult, IngestSourceType, QueueItem } from '@/lib/types';
import { PageHeader, ErrorBanner, EmptyState, InlineLoader, QueueStatusBadge } from '@/components/ui';
import Link from 'next/link';
import { ArrowRight, CheckCircle2, Database, FileText, Globe, Loader2, RefreshCw, Rss } from 'lucide-react';

const SOURCE_TYPES: Array<{ id: IngestSourceType; label: string; icon: typeof FileText }> = [
  { id: 'text', label: 'Raw Text', icon: FileText },
  { id: 'url', label: 'URL Link', icon: Globe },
  { id: 'rss', label: 'RSS Feed', icon: Rss },
];

export default function IngestPage() {
  const [content, setContent] = useState('');
  const [sourceType, setSourceType] = useState<IngestSourceType>('text');
  const [sourceUrl, setSourceUrl] = useState('');
  const [result, setResult] = useState<IngestResult | null>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [queueLoading, setQueueLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<number | null>(null);

  const loadQueue = useCallback(() => {
    return getIngestQueue()
      .then((items) => {
        setQueue(items);
        setError(null);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Failed to load the ingest queue.');
      })
      .finally(() => setQueueLoading(false));
  }, []);

  useEffect(() => {
    loadQueue();
  }, [loadQueue]);

  const handleIngest = async () => {
    if (!content.trim()) return;
    setLoading(true);
    setResult(null);
    setError(null);
    try {
      const res = await ingestText(content, sourceType, sourceUrl || undefined);
      setResult(res);
      setContent('');
      setSourceUrl('');
      loadQueue();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Ingest failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleRetry = async (item: QueueItem) => {
    if (retryingId !== null) return;
    setRetryingId(item.id);
    setError(null);
    try {
      await retryQueueItem(item.id);
      await loadQueue();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : `Failed to retry queue item #${item.id}.`);
      setRetryingId(null);
    }
  };

  return (
    <div className="space-y-8">
      <PageHeader
        title="Inbox / Ingest"
        description="Ingest raw technical writeups, URLs, or security RSS feeds to extract vulnerabilities, tools, and skills into your Knowledge Graph."
      />

      <div className="card">
        <h2 className="text-lg font-semibold mb-4 text-slate-900 dark:text-slate-100">Drop Content</h2>

        <div className="flex gap-2 mb-4">
          {SOURCE_TYPES.map((type) => {
            const Icon = type.icon;
            return (
              <button
                key={type.id}
                onClick={() => setSourceType(type.id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
                  sourceType === type.id
                    ? 'bg-cyber-600 text-white shadow-sm'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {type.label}
              </button>
            );
          })}
        </div>

        {sourceType !== 'text' && (
          <div className="mb-4">
            <label className="block text-xs font-semibold text-slate-400 uppercase mb-1">Source URL</label>
            <input
              type="text"
              placeholder={sourceType === 'url' ? 'https://example.com/writeup' : 'https://example.com/rss.xml'}
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              className="input"
            />
          </div>
        )}

        <div className="mb-4">
          <label className="block text-xs font-semibold text-slate-400 uppercase mb-1">Content / Writeup Body</label>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={
              sourceType === 'text'
                ? 'Paste text content, writeup, or terminal notes (e.g. nmap scan results, CVE IDs, exploit methodology)...'
                : sourceType === 'url'
                ? 'Paste main content snippet or full article text...'
                : 'Paste RSS feed content or feed notes...'
            }
            className="input min-h-[220px] font-mono text-xs leading-relaxed"
          />
        </div>

        <div className="flex justify-end">
          <button
            onClick={handleIngest}
            disabled={loading || !content.trim()}
            className="btn-primary flex items-center gap-2 disabled:opacity-50"
          >
            <Database className="w-4 h-4" />
            {loading ? 'Extracting Entities...' : 'Ingest & Link Graph'}
          </button>
        </div>
      </div>

      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      {result && (
        <div className="card fade-in border-cyber-500/30">
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3 mb-4">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-cyber-500" />
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Ingestion Complete</h2>
            </div>
            <span className="badge bg-cyber-500/10 text-cyber-600 dark:text-cyber-400 border-cyber-500/20">
              ID #{result.id}
            </span>
          </div>

          <div className="space-y-4">
            <div>
              <span className="text-xs font-semibold uppercase text-slate-400">Source Node</span>
              <div className="flex flex-wrap gap-2 mt-2">
                <span className="badge bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-mono text-xs border border-slate-200 dark:border-slate-700">
                  {result.source_node}
                </span>
              </div>
            </div>

            <div>
              <span className="text-xs font-semibold uppercase text-slate-400">Links Created</span>
              <p className="text-sm text-cyber-600 dark:text-cyber-400 font-medium mt-2">
                {result.edges_created} {result.edges_created === 1 ? 'link' : 'links'} created
              </p>
            </div>

            <div className="pt-2 flex justify-end">
              <Link href="/graph" className="btn-secondary text-xs flex items-center gap-1.5">
                View in Knowledge Graph <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* Historical Queue */}
      <div className="card overflow-hidden">
        <h2 className="text-lg font-semibold mb-4 text-slate-900 dark:text-slate-100">Ingest Queue & History</h2>
        {queueLoading ? (
          <InlineLoader label="Loading queue..." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 text-left text-xs uppercase font-semibold">
                  <th className="py-3 px-4">ID</th>
                  <th className="py-3 px-4">Type</th>
                  <th className="py-3 px-4">Preview</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Created</th>
                  <th className="py-3 px-4">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 text-sm">
                {queue.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="py-3 px-4 font-mono text-xs text-slate-500">#{item.id}</td>
                    <td className="py-3 px-4">
                      <span className="badge bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                        {item.source_type}
                      </span>
                    </td>
                    <td className="py-3 px-4 font-mono text-xs text-slate-700 dark:text-slate-300 max-w-xs truncate">
                      {item.raw_content}
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <QueueStatusBadge status={item.status} />
                        {item.status === 'error' && (
                          <button
                            onClick={() => handleRetry(item)}
                            disabled={retryingId === item.id}
                            className="btn-secondary !py-1 !px-2 text-[11px] flex items-center gap-1 disabled:opacity-50"
                            title="Retry processing this item"
                          >
                            {retryingId === item.id ? (
                              <>
                                <Loader2 className="w-3 h-3 animate-spin" />
                                Retrying...
                              </>
                            ) : (
                              <>
                                <RefreshCw className="w-3 h-3" />
                                Retry
                              </>
                            )}
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-400">{item.created_at}</td>
                    <td className="py-3 px-4 text-xs text-slate-400">
                      {item.status === 'error' ? '' : ''}
                    </td>
                  </tr>
                ))}
                {queue.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-2">
                      <EmptyState
                        message="No ingestion history yet."
                        hint="Drop content above to populate your Knowledge Graph."
                      />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
