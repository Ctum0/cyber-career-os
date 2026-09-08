'use client';
import { useEffect, useState } from 'react';
import { setTargetRole, getTargetRoles, getSkillGaps } from '@/lib/api';
import type { TargetRole, SkillGap } from '@/lib/types';
import { PageHeader, ErrorBanner, EmptyState, ConfidenceBar } from '@/components/ui';
import { Target, Loader2, ChevronRight } from 'lucide-react';

export default function RolesPage() {
  const [roles, setRoles] = useState<TargetRole[]>([]);
  const [roleName, setRoleName] = useState('');
  const [listingText, setListingText] = useState('');
  const [gaps, setGaps] = useState<SkillGap[]>([]);
  const [selectedRole, setSelectedRole] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingGaps, setLoadingGaps] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getTargetRoles()
      .then(setRoles)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load target roles'));
  }, []);

  const handleSetRole = async () => {
    if (!roleName.trim()) return;
    setLoading(true);
    setError(null);
    try {
      await setTargetRole(roleName, listingText || undefined);
      const updated = await getTargetRoles();
      setRoles(updated);
      setRoleName('');
      setListingText('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to set target role');
    }
    setLoading(false);
  };

  const handleViewGaps = async (role: string) => {
    setSelectedRole(role);
    setLoadingGaps(true);
    setError(null);
    try {
      const data = await getSkillGaps(role);
      setGaps(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load skill gaps');
    }
    setLoadingGaps(false);
  };

  return (
    <div className="space-y-8">
      <PageHeader
        title="Target Roles"
        description="Define career targets to auto-generate skill checklists and identify gaps in your knowledge graph."
      />

      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      <div className="card">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-4 flex items-center gap-2">
          <Target className="w-5 h-5 text-cyber-500" />
          Set Target Role
        </h2>
        <input
          type="text"
          placeholder="Role name (e.g., SOC Analyst, AppSec Engineer, Red Team)"
          value={roleName}
          onChange={(e) => setRoleName(e.target.value)}
          className="input mb-4"
        />
        <textarea
          placeholder="Optional: paste a job listing for more accurate skill extraction..."
          value={listingText}
          onChange={(e) => setListingText(e.target.value)}
          className="input min-h-[100px] mb-4 text-sm"
        />
        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-400">
            {roleName.trim() ? (
              <span className="text-cyber-500">✓ Ready to set role</span>
            ) : (
              'Enter a role name to enable'
            )}
          </span>
          <button onClick={handleSetRole} disabled={loading || !roleName.trim()} className="btn-primary flex items-center gap-2 disabled:opacity-50">
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Generating...
              </>
            ) : (
              'Set Target Role'
            )}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-4">Your Target Roles</h2>
          {roles.length > 0 ? (
            <div className="space-y-3">
              {roles.map((role) => {
                const isSelected = selectedRole === role.role_name;
                return (
                  <div
                    key={role.id}
                    className={`flex items-center justify-between p-3 rounded-lg border transition-colors ${
                      isSelected
                        ? 'bg-cyber-500/5 border-cyber-500/30'
                        : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800'
                    }`}
                  >
                    <span className="font-medium text-slate-900 dark:text-slate-100">{role.role_name}</span>
                    <button
                      onClick={() => handleViewGaps(role.role_name)}
                      className="text-sm text-cyber-600 dark:text-cyber-400 hover:text-cyber-500 flex items-center gap-1"
                    >
                      View Gaps <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState message="No target roles set yet." hint="Set a target role above to generate your skill checklist." />
          )}
        </div>

        <div className="card">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-4">
            {selectedRole ? `Skill Gaps: ${selectedRole}` : 'Skill Gaps'}
          </h2>
          {loadingGaps ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 text-cyber-500 animate-spin" />
            </div>
          ) : gaps.length > 0 ? (
            <div className="space-y-3">
              {gaps.slice(0, 10).map((gap, i) => (
                <div key={i} className="flex items-center gap-4">
                  <span className="w-6 text-center text-sm text-slate-400">#{i + 1}</span>
                  <div className="flex-1">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium text-slate-900 dark:text-slate-100">{gap.skill}</span>
                      <span className="text-xs text-slate-400">
                        Priority: {Math.round(gap.priority_score)}
                      </span>
                    </div>
                    <ConfidenceBar score={gap.confidence} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              message={selectedRole ? 'No gaps found.' : 'Select a role to view skill gaps.'}
              hint={selectedRole ? undefined : 'Gaps are ranked by priority based on your knowledge graph.'}
            />
          )}
        </div>
      </div>
    </div>
  );
}
