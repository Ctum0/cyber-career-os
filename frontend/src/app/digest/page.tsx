'use client';
import { useEffect, useState } from 'react';
import { generateDigest, getDigests, updateJournal } from '@/lib/api';
import { WeeklyDigest } from '@/lib/types';
import { PageHeader, ErrorBanner, EmptyState } from '@/components/ui';
import { Calendar, Loader2, Sparkles } from 'lucide-react';

export default function DigestPage() {
  const [digests, setDigests] = useState<WeeklyDigest[]>([]);
  const [currentDigest, setCurrentDigest] = useState<WeeklyDigest | null>(null);
  const [journalEdit, setJournalEdit] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getDigests()
      .then(setDigests)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed to load digests'));
  }, []);

  const handleGenerate = async () => {
    setLoading(true);
    setError(null);
    try {
      const digest = await generateDigest();
      setCurrentDigest(digest);
      setJournalEdit(digest.journal_entry || '');
      getDigests().then(setDigests);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to generate digest');
    }
    setLoading(false);
  };

  const handleSaveJournal = async (digestId: number) => {
    setSaving(true);
    try {
      await updateJournal(digestId, journalEdit);
      const updated = await getDigests();
      setDigests(updated);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save journal');
    }
    setSaving(false);
  };

  return (
    <div className="space-y-8">
      <PageHeader
        title="Weekly Synthesis"
        description="Automated weekly career development digest with skill gap analysis, actionable tasks, and a personal journal."
      />

      {/* Error Banner */}
      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      <div className="card">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-cyber-500" />
              Generate This Week&apos;s Digest
            </h2>
            <p className="text-sm text-slate-400 dark:text-slate-300 mt-0.5">
              Generate on demand — generation is manual, nothing runs automatically.
            </p>
          </div>
          <button onClick={handleGenerate} disabled={loading} className="btn-primary flex items-center gap-2 disabled:opacity-50">
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                Generate Digest
              </>
            )}
          </button>
        </div>
      </div>

      {currentDigest && (
        <div className="card animate-in fade-in duration-200">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-4 flex items-center gap-2">
            <Calendar className="w-5 h-5 text-cyber-500" />
            Week of {currentDigest.week_of}
          </h2>

          <div className="mb-6">
            <h3 className="font-medium text-sm text-slate-400 mb-2">Skill Gap Report</h3>
            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-sm text-slate-800 dark:text-slate-200 whitespace-pre-wrap">
              {currentDigest.skill_gap_report}
            </div>
          </div>

          <div className="mb-6">
            <h3 className="font-medium text-sm text-slate-400 mb-2">Actions for Next Week</h3>
            <ul className="space-y-2">
              {currentDigest.actions?.map((action, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="text-cyber-500 mt-0.5">•</span>
                  <span className="text-sm text-slate-800 dark:text-slate-200">{action}</span>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="font-medium text-sm text-slate-400 mb-2">Journal Entry (editable)</h3>
            <textarea
              value={journalEdit}
              onChange={(e) => setJournalEdit(e.target.value)}
              className="input min-h-[150px] mb-4 text-sm"
            />
            <button
              onClick={() => handleSaveJournal(currentDigest.id)}
              disabled={saving}
              className="btn-secondary flex items-center gap-2 disabled:opacity-50"
            >
              {saving ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Saving...
                </>
              ) : (
                'Save Journal'
              )}
            </button>
          </div>
        </div>
      )}

      <div className="card">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-4">Past Digests</h2>
        {digests.length > 0 ? (
          <div className="space-y-4">
            {digests.map((d) => (
              <div key={d.id} className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-cyber-500/30 transition-colors">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium text-slate-900 dark:text-slate-100">Week of {d.week_of}</span>
                  <button
                    onClick={() => { setCurrentDigest(d); setJournalEdit(d.journal_entry || ''); }}
                    className="text-sm text-cyber-600 dark:text-cyber-400 hover:text-cyber-500"
                  >
                    View →
                  </button>
                </div>
                <p className="text-sm text-slate-400 line-clamp-2">{d.journal_entry}</p>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            message="No digests yet."
            hint="Generate your first weekly synthesis to see it here."
            action={
              <button onClick={handleGenerate} disabled={loading} className="btn-primary flex items-center gap-2 disabled:opacity-50">
                <Sparkles className="w-4 h-4" />
                Generate Digest
              </button>
            }
          />
        )}
      </div>
    </div>
  );
}
