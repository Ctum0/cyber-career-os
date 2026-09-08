'use client';
import { useEffect, useState } from 'react';
import type { Application, ApplicationStatus } from '@/lib/types';
import { createApplication, getApplications, updateApplication } from '@/lib/api';
import { ApplicationStatusBadge, APPLICATION_STATUSES, APPLICATION_STATUS_LABELS, EmptyState, ErrorBanner, Modal, PageHeader } from '@/components/ui';
import { Briefcase, Building2, Sparkles, CheckCircle2, AlertTriangle, AlertCircle, FileText, Loader2 } from 'lucide-react';

export default function ApplicationsPage() {
  const [applications, setApplications] = useState<Application[]>([]);
  const [company, setCompany] = useState('');
  const [roleTitle, setRoleTitle] = useState('');
  const [listingText, setListingText] = useState('');
  const [selectedApp, setSelectedApp] = useState<Application | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getApplications()
      .then((data) => setApplications(data || []))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load applications'));
  }, []);

  const handleSubmit = async () => {
    if (!company.trim() || !roleTitle.trim() || !listingText.trim()) return;
    setLoading(true);
    setError(null);
    try {
      await createApplication(company, roleTitle, listingText);
      const updated = await getApplications();
      setApplications(updated || []);
      setCompany('');
      setRoleTitle('');
      setListingText('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to analyze job listing');
    }
    setLoading(false);
  };

  const handleMove = async (appId: number, newStatus: ApplicationStatus) => {
    try {
      await updateApplication(appId, { status: newStatus });
      const updated = await getApplications();
      setApplications(updated || []);
      if (selectedApp?.id === appId) {
        setSelectedApp(updated.find((a) => a.id === appId) ?? null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update application');
    }
  };

  const allFieldsFilled = company.trim() && roleTitle.trim() && listingText.trim();

  return (
    <div className="space-y-8">
      <PageHeader
        title="Application Tracker"
        description="Paste security job descriptions to analyze real skill gaps, generate evidence-backed resume bullets, and track application stages."
      />

      {/* Error Banner */}
      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      {/* Ingest Listing Form */}
      <div className="card">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-4 flex items-center gap-2">
          <Briefcase className="w-5 h-5 text-cyber-500" />
          Analyze New Job Listing
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-xs font-semibold uppercase text-slate-400 mb-1">Company Name *</label>
            <input
              type="text"
              placeholder="e.g. CrowdStrike, Mandiant, Cloudflare"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              className="input"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase text-slate-400 mb-1">Role Title *</label>
            <input
              type="text"
              placeholder="e.g. SOC Analyst II, AppSec Engineer, Security Consultant"
              value={roleTitle}
              onChange={(e) => setRoleTitle(e.target.value)}
              className="input"
            />
          </div>
        </div>
        <div className="mb-4">
          <label className="block text-xs font-semibold uppercase text-slate-400 mb-1">Job Description Text *</label>
          <textarea
            value={listingText}
            onChange={(e) => setListingText(e.target.value)}
            placeholder="Paste full job description including requirements and qualifications..."
            className="input min-h-[140px] text-xs font-mono"
          />
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-400">
            {allFieldsFilled ? (
              <span className="text-cyber-500">✓ All fields filled — ready to analyze</span>
            ) : (
              'Fill all 3 fields to enable analysis'
            )}
          </span>
          <button
            onClick={handleSubmit}
            disabled={loading || !allFieldsFilled}
            className="btn-primary flex items-center gap-2 disabled:opacity-50"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Analyzing via Groq...
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                Analyze Listing & Build Resume Bullets
              </>
            )}
          </button>
        </div>
      </div>

      {/* Kanban Board Columns */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {APPLICATION_STATUSES.map((statusKey) => {
          const items = applications.filter((a) => a.status === statusKey);
          return (
            <div key={statusKey} className="card bg-slate-900/40 border-slate-800 space-y-3">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <ApplicationStatusBadge status={statusKey} />
                <span className="text-xs font-mono font-bold text-slate-400">{items.length}</span>
              </div>

              <div className="space-y-3 min-h-[200px]">
                {items.map((app) => (
                  <div
                    key={app.id}
                    tabIndex={0}
                    role="button"
                    aria-label={`${app.role_title} at ${app.company}`}
                    onClick={() => setSelectedApp(app)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setSelectedApp(app);
                      }
                    }}
                    className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-cyber-500/50 cursor-pointer transition-all shadow-sm group outline-none focus-visible:ring-2 focus-visible:ring-cyber-500"
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <h4 className="font-bold text-sm text-slate-900 dark:text-slate-100 group-hover:text-cyber-400 transition-colors">
                          {app.role_title}
                        </h4>
                        <p className="text-xs text-slate-400 flex items-center gap-1 mt-0.5">
                          <Building2 className="w-3 h-3" />
                          {app.company}
                        </p>
                      </div>
                    </div>

                    {/* Quick Move Buttons */}
                    <div className="mt-3 pt-2 border-t border-slate-100 dark:border-slate-800/80 flex flex-wrap gap-1">
                      {APPLICATION_STATUSES.filter((s) => s !== statusKey).map((s) => (
                        <button
                          key={s}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleMove(app.id, s);
                          }}
                          className="text-[10px] px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-cyber-500/20 hover:text-cyber-400 transition-colors"
                        >
                          → {APPLICATION_STATUS_LABELS[s]}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
                {items.length === 0 && (
                  <div className="h-full flex items-center justify-center text-xs text-slate-400 py-12 border border-dashed border-slate-800 rounded-xl">
                    No applications
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {applications.length === 0 && (
        <EmptyState
          message="No applications tracked yet"
          hint="Analyze your first job listing above to extract skill gaps and resume bullets."
        />
      )}

      {/* Selected Application Detailed Inspector Modal */}
      {selectedApp && (
        <Modal
          open={!!selectedApp}
          onClose={() => setSelectedApp(null)}
          title={selectedApp.role_title}
          badge={
            <span className="badge bg-cyber-500/10 text-cyber-600 dark:text-cyber-400 border-cyber-500/20 uppercase text-[10px] font-bold">
              {selectedApp.company}
            </span>
          }
          footer={
            <button onClick={() => setSelectedApp(null)} className="btn-secondary text-xs ml-auto">
              Close Inspector
            </button>
          }
        >
          <div className="space-y-5 text-xs">
            {/* Required Skills */}
            <div>
              <h3 className="text-xs font-semibold uppercase text-slate-400 mb-2 flex items-center gap-1">
                <CheckCircle2 className="w-4 h-4 text-cyber-500" />
                Required Skills Extracted
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {selectedApp.required_skills.map((s, i) => (
                  <span key={i} className="badge bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                    {s}
                  </span>
                ))}
              </div>
            </div>

            {/* Real Gaps vs Bluffable Gaps */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 space-y-2">
                <h3 className="text-xs font-bold uppercase text-red-500 flex items-center gap-1">
                  <AlertCircle className="w-4 h-4" />
                  Real Gaps (No Evidence Logged)
                </h3>
                <div className="flex flex-wrap gap-1.5">
                  {selectedApp.real_gaps.map((s, i) => (
                    <span key={i} className="badge bg-red-500/20 text-red-400 font-semibold">
                      {s}
                    </span>
                  ))}
                  {selectedApp.real_gaps.length === 0 && <span className="text-slate-400">None detected!</span>}
                </div>
              </div>

              <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 space-y-2">
                <h3 className="text-xs font-bold uppercase text-amber-500 flex items-center gap-1">
                  <AlertTriangle className="w-4 h-4" />
                  Bluffable Gaps (Partial Competency)
                </h3>
                <div className="flex flex-wrap gap-1.5">
                  {selectedApp.bluffable_gaps.map((s, i) => (
                    <span key={i} className="badge bg-amber-500/20 text-amber-400 font-semibold">
                      {s}
                    </span>
                  ))}
                  {selectedApp.bluffable_gaps.length === 0 && <span className="text-slate-400">None detected!</span>}
                </div>
              </div>
            </div>

            {/* Resume Bullets */}
            <div>
              <h3 className="text-xs font-semibold uppercase text-slate-400 mb-2 flex items-center gap-1">
                <FileText className="w-4 h-4 text-cyber-500" />
                Tailored Resume Bullet Points
              </h3>
              <ul className="space-y-2">
                {selectedApp.resume_bullets.map((b, i) => (
                  <li key={i} className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200">
                    • {b}
                  </li>
                ))}
              </ul>
            </div>

            {/* Cover Letter Paragraph */}
            {selectedApp.cover_letter && (
              <div>
                <h3 className="text-xs font-semibold uppercase text-slate-400 mb-2">Tailored Cover Letter Intro</h3>
                <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 leading-relaxed text-slate-700 dark:text-slate-300">
                  {selectedApp.cover_letter}
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
