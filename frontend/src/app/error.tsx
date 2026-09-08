'use client';

import { AlertCircle, RefreshCw } from 'lucide-react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="card max-w-lg mx-auto mt-16 text-center space-y-4">
      <div className="w-12 h-12 rounded-xl bg-red-500/10 flex items-center justify-center mx-auto">
        <AlertCircle className="w-6 h-6 text-red-500" />
      </div>
      <div>
        <h2 className="section-title">Something went wrong</h2>
        <p className="section-desc">
          This view hit an unexpected error. Your data is safe — the backend stores
          everything independently of this page.
        </p>
        {error.digest && (
          <p className="text-[11px] font-mono text-slate-400 mt-2">ref: {error.digest}</p>
        )}
      </div>
      <button onClick={reset} className="btn-primary mx-auto">
        <RefreshCw className="w-4 h-4" />
        Try again
      </button>
    </div>
  );
}
