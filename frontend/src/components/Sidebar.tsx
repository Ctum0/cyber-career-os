'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import {
  Moon, Sun, Shield, Layers, FileText, Database, Target, Award,
  Wrench, Flag, Briefcase, Calendar, Menu, X, Settings,
} from 'lucide-react';
import { useTheme } from '@/lib/useTheme';

const NAV_GROUPS = [
  {
    label: 'Overview',
    items: [
      { href: '/', label: 'Dashboard', icon: Layers },
    ],
  },
  {
    label: 'Ingest',
    items: [
      { href: '/ingest', label: 'Inbox', icon: Database },
      { href: '/obsidian', label: 'Obsidian Vault', icon: FileText },
      { href: '/graph', label: 'Knowledge Graph', icon: Shield },
    ],
  },
  {
    label: 'Build',
    items: [
      { href: '/roles', label: 'Target Roles', icon: Target },
      { href: '/skills', label: 'Skill Pipeline', icon: Award },
      { href: '/projects', label: 'Projects', icon: Wrench },
      { href: '/ctf', label: 'CTF Write-ups', icon: Flag },
    ],
  },
  {
    label: 'Apply',
    items: [
      { href: '/applications', label: 'Applications', icon: Briefcase },
      { href: '/digest', label: 'Weekly Digest', icon: Calendar },
    ],
  },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { theme, toggle } = useTheme();
  const [mobileOpen, setMobileOpen] = useState<boolean>(false);

  const nav = (
    <nav className="flex-1 overflow-y-auto px-3 py-2 space-y-6" aria-label="Main navigation">
      {NAV_GROUPS.map((group) => (
        <div key={group.label}>
          <p className="px-3 pb-2 text-[10px] font-bold uppercase tracking-widest text-slate-600 dark:text-slate-500">
            {group.label}
          </p>
          <ul className="space-y-0.5">
            {group.items.map((item) => {
              const active = pathname === item.href;
              const Icon = item.icon;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={() => setMobileOpen(false)}
                    aria-current={active ? 'page' : undefined}
                    className={`flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] font-medium transition-colors ${
                      active
                        ? 'bg-cyber-500/10 text-cyber-400'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
                    }`}
                  >
                    <Icon className="w-4 h-4 flex-shrink-0" />
                    <span>{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );

  return (
    <>
      {/* Mobile header */}
      <div className="lg:hidden fixed top-0 left-0 right-0 h-14 bg-slate-950 border-b border-slate-800/80 flex items-center justify-between px-4 z-40">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-cyber-500/20 flex items-center justify-center">
            <Shield className="w-4 h-4 text-cyber-400" />
          </div>
          <span className="font-bold text-sm text-slate-100">Cyber Career OS</span>
        </div>
        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label={mobileOpen ? 'Close navigation menu' : 'Open navigation menu'}
          aria-expanded={mobileOpen}
          className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-white/5"
        >
          {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed left-0 top-0 h-full w-60 bg-slate-950 border-r border-slate-800/80 flex flex-col z-50 transition-transform duration-200 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        {/* Logo */}
        <div className="px-4 pt-5 pb-4 flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-cyber-500/20 flex items-center justify-center flex-shrink-0">
            <Shield className="w-4.5 h-4.5 text-cyber-400" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-slate-100 leading-tight">Cyber Career OS</h1>
            <p className="text-[10px] text-slate-500 font-mono">v1.0</p>
          </div>
        </div>

        {/* Nav */}
        {nav}

        {/* Footer */}
        <div className="px-3 pb-4 space-y-2">
          <Link
            href="/settings"
            onClick={() => setMobileOpen(false)}
            className={`flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] font-medium transition-colors ${
              pathname === '/settings'
                ? 'bg-cyber-500/10 text-cyber-400'
                : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
            }`}
          >
            <Settings className="w-4 h-4" />
            <span>Settings</span>
          </Link>
          <button
            onClick={toggle}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] font-medium text-slate-400 hover:text-slate-200 hover:bg-white/5 transition-colors"
          >
            {theme === 'dark' ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4 text-amber-400" />}
            <span>{theme === 'dark' ? 'Dark Mode' : 'Light Mode'}</span>
          </button>
        </div>
      </aside>
    </>
  );
}
