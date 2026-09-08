'use client';
import { useEffect, useState } from 'react';
import { getGraphStats } from '@/lib/api';
import Link from 'next/link';
import type { GraphStats } from '@/lib/types';
import { PageHeader, EmptyState } from '@/components/ui';
import {
  ArrowUpRight, Loader2, Database, Target, Award, Briefcase,
} from 'lucide-react';

function timeAgo(dateStr: string): string {
  if (!dateStr) return '';
  const date = new Date(dateStr.replace(' ', 'T'));
  const now = new Date();
  const diffSec = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.floor(diffHr / 24)}d ago`;
}

export default function Dashboard() {
  const [stats, setStats] = useState<GraphStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getGraphStats()
      .then(setStats)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="w-6 h-6 text-cyber-500 animate-spin" />
      </div>
    );
  }

  const nodeCount = stats?.total_nodes ?? 0;
  const edgeCount = stats?.total_edges ?? 0;
  const skillCount = stats?.nodes_by_type?.skill ?? 0;
  const projectCount = stats?.nodes_by_type?.project ?? 0;
  const statItems: { href: string; value: number; label: string }[] = [
    { href: '/graph', value: nodeCount, label: 'nodes' },
    { href: '/graph', value: edgeCount, label: 'edges' },
    { href: '/skills', value: skillCount, label: 'skills' },
    { href: '/projects', value: projectCount, label: 'projects' },
  ];
  return (
    <div className="space-y-10">
      <PageHeader
        title="Dashboard"
        description="Your cybersecurity knowledge graph at a glance."
      />

      {/* Stats row */}
      <div className="flex flex-wrap gap-8">
        {statItems.map((stat) => (
          <Link key={stat.label} href={stat.href} className="group">
            <div className="flex items-baseline gap-2">
              <span className="stat-value">{stat.value}</span>
              <span className="text-sm font-medium text-slate-400 group-hover:text-cyber-400 transition-colors">
                {stat.label}
              </span>
              <ArrowUpRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-cyber-400 transition-colors" />
            </div>
          </Link>
        ))}
      </div>

      {/* Two-column content */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
        {/* Skills — wider column */}
        <div className="lg:col-span-3">
          <div className="flex items-center justify-between mb-4">
            <h2 className="section-title">Top Skills</h2>
            <Link href="/skills" className="text-xs font-medium text-cyber-500 hover:text-cyber-400 transition-colors">
              View all →
            </Link>
          </div>
          {stats && stats.top_skills.length > 0 ? (
            <div className="space-y-1">
              {stats.top_skills.map((skill, i) => (
                <div key={skill.label} className="flex items-center gap-4 py-2.5 px-3 rounded-lg hover:bg-slate-50 dark:hover:bg-white/[0.02] transition-colors">
                  <span className="text-xs font-mono text-slate-400 w-5 text-right">{i + 1}</span>
                  <span className="flex-1 text-sm font-medium text-slate-800 dark:text-slate-200 truncate">
                    {skill.label}
                  </span>
                  <div className="flex items-center gap-3 w-40 flex-shrink-0">
                    <div className="flex-1 h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${
                          skill.confidence_score >= 70
                            ? 'bg-cyber-500'
                            : skill.confidence_score >= 40
                            ? 'bg-amber-500'
                            : 'bg-red-500'
                        }`}
                        style={{ width: `${skill.confidence_score}%` }}
                      />
                    </div>
                    <span className="text-xs font-mono text-slate-400 w-8 text-right">
                      {skill.confidence_score}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              message="No skills tracked yet."
              hint="Ingest content or set a target role to build your skill map."
              action={
                <Link href="/ingest" className="text-sm text-cyber-500 hover:text-cyber-400 inline-block">
                  Start by ingesting content →
                </Link>
              }
            />
          )}
        </div>

        {/* Activity — narrower column */}
        <div className="lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h2 className="section-title">Recent Activity</h2>
            <Link href="/graph" className="text-xs font-medium text-cyber-500 hover:text-cyber-400 transition-colors">
              Explore →
            </Link>
          </div>
          {stats && stats.recent_activity.length > 0 ? (
            <div className="space-y-0.5">
              {stats.recent_activity.slice(0, 8).map((item, i) => (
                <div key={`${item.label}-${i}`} className="flex items-center gap-3 py-2 px-2 rounded-lg hover:bg-slate-50 dark:hover:bg-white/[0.02] transition-colors">
                  <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                    item.type === 'skill' ? 'bg-cyber-500' :
                    item.type === 'vuln' ? 'bg-red-500' :
                    item.type === 'tool' ? 'bg-blue-500' :
                    item.type === 'role' ? 'bg-purple-500' :
                    'bg-slate-500'
                  }`} />
                  <span className="flex-1 text-sm text-slate-700 dark:text-slate-300 truncate">
                    {item.label}
                  </span>
                  <span className="text-[11px] text-slate-400 flex-shrink-0">
                    {timeAgo(item.last_touched)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState message="No recent activity." />
          )}
        </div>
      </div>

      {/* Quick actions */}
      <div>
        <h2 className="section-title mb-4">Quick Actions</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { href: '/ingest', label: 'Ingest Content', desc: 'Add writeups, notes, URLs', icon: Database },
            { href: '/roles', label: 'Set Target Role', desc: 'Define career goals', icon: Target },
            { href: '/skills', label: 'Practice Skills', desc: 'Train weak areas', icon: Award },
            { href: '/applications', label: 'Analyze Job', desc: 'Gap analysis & resume', icon: Briefcase },
          ].map((action) => {
            const Icon = action.icon;
            return (
              <Link
                key={action.href}
                href={action.href}
                className="flex items-center gap-3 p-4 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-cyber-500/30 hover:bg-cyber-500/[0.02] transition-colors group"
              >
                <div className="w-9 h-9 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center group-hover:bg-cyber-500/10 transition-colors">
                  <Icon className="w-4.5 h-4.5 text-slate-500 group-hover:text-cyber-500 transition-colors" />
                </div>
                <div>
                  <div className="text-sm font-semibold text-slate-800 dark:text-slate-200">{action.label}</div>
                  <div className="text-xs text-slate-400">{action.desc}</div>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
