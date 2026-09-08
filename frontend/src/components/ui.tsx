'use client';

/** Shared UI primitives used across pages: section headers, error banners,
 * empty states, loading states, confidence bars, status badges, and modals.
 * Only genuinely shared visual+behavioral semantics live here. */
import { ReactNode, useEffect, useRef } from 'react';
import { AlertCircle, Loader2, X } from 'lucide-react';
import type { ApplicationStatus, QueueStatus } from '@/lib/types';

// ---- Confidence semantics: single source of truth for 0-100 scoring ---- //
export function confidenceTone(score: number): { bar: string; text: string } {
  if (score >= 70) return { bar: 'bg-cyber-500', text: 'text-cyber-600 dark:text-cyber-400' };
  if (score >= 40) return { bar: 'bg-amber-500', text: 'text-amber-600 dark:text-amber-400' };
  return { bar: 'bg-red-500', text: 'text-red-500' };
}

export function ConfidenceBar({ score, width = 'w-40' }: { score: number; width?: string }) {
  const tone = confidenceTone(score);
  return (
    <div className={`flex items-center gap-3 ${width} flex-shrink-0`}>
      <div className="flex-1 h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${tone.bar}`} style={{ width: `${Math.round(score)}%` }} />
      </div>
      <span className="text-xs font-mono text-slate-400 w-8 text-right">{Math.round(score)}%</span>
    </div>
  );
}

// ---- Page scaffolding ---- //
export function PageHeader({ title, description }: { title: string; description: string }) {
  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">{title}</h1>
      <p className="section-desc">{description}</p>
    </div>
  );
}

export function ErrorBanner({ message, onDismiss }: { message: string; onDismiss?: () => void }) {
  return (
    <div
      role="alert"
      className="bg-red-500/10 border border-red-500/30 text-red-700 dark:text-red-400 px-4 py-3 rounded-xl flex items-center gap-3"
    >
      <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
      <p className="text-sm">{message}</p>
      {onDismiss && (
        <button onClick={onDismiss} className="ml-auto text-xs text-red-500 hover:text-red-400">
          Dismiss
        </button>
      )}
    </div>
  );
}

export function InlineLoader({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center py-24 text-sm text-slate-400">
      <Loader2 className="w-5 h-5 text-cyber-500 animate-spin mr-3" />
      {label}
    </div>
  );
}

export function EmptyState({
  message,
  hint,
  action,
}: {
  message: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="py-12 text-center space-y-2">
      <p className="text-sm text-slate-400">{message}</p>
      {hint && <p className="text-xs text-slate-500 dark:text-slate-500">{hint}</p>}
      {action && <div className="pt-2">{action}</div>}
    </div>
  );
}

// ---- Status badges ---- //
const QUEUE_TONES: Record<QueueStatus, string> = {
  done: 'badge-green',
  error: 'badge-red',
  processing: 'badge-amber',
  pending: 'badge-amber',
};

export function QueueStatusBadge({ status }: { status: QueueStatus }) {
  return <span className={`badge ${QUEUE_TONES[status] ?? 'badge-slate'}`}>{status}</span>;
}

export const APPLICATION_STATUSES: ApplicationStatus[] = ['interested', 'applied', 'interview', 'closed'];

export const APPLICATION_STATUS_LABELS: Record<ApplicationStatus, string> = {
  interested: 'Interested',
  applied: 'Applied',
  interview: 'Interviewing',
  closed: 'Closed / Offer',
};

const APP_TONES: Record<ApplicationStatus, string> = {
  interested: 'badge-blue-holder',
  applied: 'badge-amber',
  interview: 'badge-green',
  closed: 'badge-slate',
};

export function ApplicationStatusBadge({ status }: { status: ApplicationStatus }) {
  const tone =
    status === 'interested'
      ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20'
      : APP_TONES[status];
  return <span className={`badge ${tone} font-bold uppercase text-[10px]`}>{APPLICATION_STATUS_LABELS[status]}</span>;
}

// ---- Modal with focus trap, ESC close, and scroll lock ---- //
export function Modal({
  open,
  onClose,
  title,
  badge,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  badge?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    document.body.style.overflow = 'hidden';

    const dialog = dialogRef.current;
    const focusable = dialog?.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    focusable?.[0]?.focus();

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key === 'Tab' && focusable && focusable.length > 0) {
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.body.style.overflow = '';
      previousFocus?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 fade-in"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 max-w-lg w-full max-h-[85vh] overflow-y-auto shadow-2xl space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
          <div>
            {badge}
            <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100 mt-1">{title}</h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close dialog"
            className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        {children}
        {footer && (
          <div className="pt-3 flex items-center justify-between border-t border-slate-100 dark:border-slate-800">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
