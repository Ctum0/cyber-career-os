'use client';
import { useEffect, useState } from 'react';
import { getObsidianStatus, triggerObsidianSync } from '@/lib/api';
import { ObsidianStatus, ObsidianSyncResult } from '@/lib/types';
import { PageHeader, ErrorBanner } from '@/components/ui';
import { FileText, Loader2, CheckCircle2, RefreshCw } from 'lucide-react';

export default function ObsidianPage() {
  const [status, setStatus] = useState<ObsidianStatus | null>(null);
  const [result, setResult] = useState<ObsidianSyncResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadStatus = () => {
    getObsidianStatus()
      .then(setStatus)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed to load Obsidian status'));
  };

  useEffect(loadStatus, []);

  const handleSync = async () => {
    setLoading(true);
    setResult(null);
    setError(null);
    try {
      const res = await triggerObsidianSync();
      setResult(res);
      loadStatus();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Sync failed');
    }
    setLoading(false);
  };

  if (status && !status.enabled) {
    return (
      <div className="space-y-8">
        <PageHeader
          title="Obsidian Vault"
          description="Sync your Obsidian vault into the knowledge graph."
        />
        <div className="card">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-2">Sync disabled</h2>
          <p className="text-slate-400 text-sm">
            Set <code className="bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded text-xs font-mono">OBSIDIAN_VAULT_PATH</code> in{' '}
            <code className="bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded text-xs font-mono">backend/.env</code> to point at your vault,
            then restart the backend. Or set it in Settings → Obsidian Vault (takes effect on the next sync — no restart needed). The app reads the
            vault strictly read-only.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="Obsidian Vault"
        description="Reads your Obsidian vault into the knowledge graph (read-only, incremental)."
      />

      {/* Error Banner */}
      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <FileText className="w-5 h-5 text-cyber-500" />
              Vault Sync
            </h2>
            <p className="text-sm text-slate-400 dark:text-slate-300 mt-0.5">
              Reads your Obsidian vault into the knowledge graph (read-only, incremental)
            </p>
          </div>
          <button onClick={handleSync} disabled={loading} className="btn-primary flex items-center gap-2 disabled:opacity-50">
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Syncing...
              </>
            ) : (
              <>
                <RefreshCw className="w-4 h-4" />
                Sync Now
              </>
            )}
          </button>
        </div>

        {status && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
              <p className="text-xs text-slate-400 mb-1">Vault Path</p>
              <p className="font-medium text-slate-900 dark:text-slate-100 break-all text-xs">{status.vault_path}</p>
            </div>
            <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
              <p className="text-xs text-slate-400 mb-1">Last Scan</p>
              <p className="font-medium text-slate-900 dark:text-slate-100">{status.last_scanned_at || 'never'}</p>
            </div>
            <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
              <p className="text-xs text-slate-400 mb-1">Tracked Files</p>
              <p className="font-medium text-slate-900 dark:text-slate-100">{status.tracked_files}</p>
            </div>
            <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
              <p className="text-xs text-slate-400 mb-1">Graph Sources</p>
              <p className="font-medium text-slate-900 dark:text-slate-100">{status.vault_source_nodes}</p>
            </div>
          </div>
        )}
      </div>

      {status && status.required_tags.length > 0 && (
        <div className="card">
          <p className="text-sm text-slate-400">
            LLM entity extraction runs only on notes tagged: <span className="font-mono text-cyber-500">{status.required_tags.join(', ')}</span>. All other
            notes are indexed (title/folder/tags) without an LLM call.
          </p>
        </div>
      )}

      {result && (
        <div className="card fade-in">
          <div className="flex items-center gap-2 mb-3 border-b border-slate-100 dark:border-slate-800 pb-3">
            <CheckCircle2 className="w-5 h-5 text-cyber-500" />
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Last Sync Result</h2>
          </div>
          <div className="text-sm space-y-2">
            <p className="text-slate-800 dark:text-slate-200">
              Scanned: <strong>{result.scanned}</strong> · Ingested:{' '}
              <strong>{result.ingested}</strong> · Indexed: <strong>{result.indexed}</strong> ·
              Excluded: <strong>{result.excluded}</strong> · Unchanged:{' '}
              <strong>{result.unchanged}</strong> · Errors: <strong>{result.errors}</strong>
            </p>
            {(result.error_details?.length ?? 0) > 0 && (
              <ul className="list-disc list-inside text-red-500 space-y-0.5">
                {result.error_details!.map((d) => (
                  <li key={d.path}><span className="font-mono text-xs">{d.path}</span> — {d.error}</li>
                ))}
              </ul>
            )}
            {result.notes.length > 0 && (
              <ul className="list-disc list-inside text-slate-400 space-y-0.5">
                {result.notes.map((n) => (
                  <li key={n.path}><span className="font-mono text-xs">{n.path}</span> — {n.status}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      <div className="card">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-3">How it works</h2>
        <ul className="text-sm text-slate-400 list-disc list-inside space-y-1.5">
          <li>The vault is read <strong className="text-slate-300">in-place and read-only</strong> — nothing is ever written back.</li>
          <li>Only new or changed notes are processed (content-hash based).</li>
          <li>Embedded screenshots (![[image.png]]) are analyzed with Groq vision and merged into the note.</li>
          <li>Scheduled to auto-sync every {status?.scan_interval_minutes || 30} minutes while the backend runs.</li>
        </ul>
      </div>
    </div>
  );
}
