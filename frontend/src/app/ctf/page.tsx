'use client';
import { useEffect, useState } from 'react';
import { createCTFWriteup, getCTFWriteups } from '@/lib/api';
import { CTFWriteup } from '@/lib/types';
import { PageHeader, ErrorBanner, EmptyState } from '@/components/ui';
import { Flag, Loader2, CheckCircle2 } from 'lucide-react';

export default function CTFPage() {
  const [notes, setNotes] = useState('');
  const [title, setTitle] = useState('');
  const [writeups, setWriteups] = useState<CTFWriteup[]>([]);
  const [result, setResult] = useState<CTFWriteup | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getCTFWriteups()
      .then(setWriteups)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed to load write-ups'));
  }, []);

  const handleSubmit = async () => {
    if (!notes.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await createCTFWriteup(notes, title || undefined);
      setResult(res);
      setNotes('');
      setTitle('');
      getCTFWriteups().then(setWriteups);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to restructure notes');
    }
    setLoading(false);
  };

  return (
    <div className="space-y-8">
      <PageHeader
        title="CTF / Lab Write-up Engine"
        description="Paste raw CTF/challenge notes and get structured writeups with MITRE ATT&CK techniques and interview talking points."
      />

      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      <div className="card">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-4 flex items-center gap-2">
          <Flag className="w-5 h-5 text-cyber-500" />
          Restructure Notes
        </h2>
        <input
          type="text"
          placeholder="Title (optional)"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="input mb-4"
        />
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Paste your raw CTF/challenge notes here..."
          className="input min-h-[250px] mb-4 font-mono text-sm"
        />
        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-400">
            {notes.trim() ? (
              <span className="text-cyber-500">✓ Ready to restructure</span>
            ) : (
              'Paste your notes to enable'
            )}
          </span>
          <button onClick={handleSubmit} disabled={loading || !notes.trim()} className="btn-primary flex items-center gap-2 disabled:opacity-50">
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Restructuring...
              </>
            ) : (
              'Restructure Notes'
            )}
          </button>
        </div>
      </div>

      {result && (
        <div className="card animate-in fade-in duration-200">
          <div className="flex items-center gap-2 mb-4 border-b border-slate-100 dark:border-slate-800 pb-3">
            <CheckCircle2 className="w-5 h-5 text-cyber-500" />
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{result.title}</h2>
          </div>
          <div className="space-y-4">
            {result.structured.recon && (
              <div>
                <h3 className="font-medium text-sm text-slate-400 mb-1">Recon</h3>
                <p className="text-sm text-slate-800 dark:text-slate-200">{result.structured.recon}</p>
              </div>
            )}
            {result.structured.method && (
              <div>
                <h3 className="font-medium text-sm text-slate-400 mb-1">Method</h3>
                <p className="text-sm text-slate-800 dark:text-slate-200 whitespace-pre-wrap">{result.structured.method}</p>
              </div>
            )}
            {result.structured.pitfall && (
              <div>
                <h3 className="font-medium text-sm text-slate-400 mb-1">Pitfall</h3>
                <p className="text-sm text-slate-800 dark:text-slate-200">{result.structured.pitfall}</p>
              </div>
            )}
            {result.structured.lesson && (
              <div>
                <h3 className="font-medium text-sm text-slate-400 mb-1">Lesson</h3>
                <p className="text-sm text-slate-800 dark:text-slate-200">{result.structured.lesson}</p>
              </div>
            )}
            {result.structured.interview_point && (
              <div className="p-4 rounded-xl bg-blue-500/10 border border-blue-500/20">
                <h3 className="font-medium text-sm text-blue-600 dark:text-blue-400 mb-1">60-sec Interview Talking Point</h3>
                <p className="text-sm text-slate-800 dark:text-slate-200">{result.structured.interview_point}</p>
              </div>
            )}
            {result.techniques.length > 0 && (
              <div>
                <h3 className="font-medium text-sm text-slate-400 mb-1">Techniques Used</h3>
                <div className="flex flex-wrap gap-2">
                  {result.techniques.map((t, i) => (
                    <span key={i} className="badge bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20">{t}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="card">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-4">Past Write-ups</h2>
        {writeups.length > 0 ? (
          <div className="space-y-3">
            {writeups.map((w) => (
              <div key={w.id} className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-medium text-slate-900 dark:text-slate-100">{w.title}</span>
                  <span className="text-xs text-slate-400">{w.created_at}</span>
                </div>
                {w.techniques.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {w.techniques.map((t, i) => (
                      <span key={i} className="badge bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20 text-xs">{t}</span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            message="No write-ups yet."
            hint="Restructure your first set of raw notes above and it will show up here."
          />
        )}
      </div>
    </div>
  );
}
