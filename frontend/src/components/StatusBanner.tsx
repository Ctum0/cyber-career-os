'use client';
import { useEffect, useState } from 'react';
import { getHealthCheck } from '@/lib/api';
import { AlertTriangle, RefreshCw, WifiOff, Loader2 } from 'lucide-react';

type HealthState = 'online' | 'degraded' | 'offline' | 'checking';

export default function StatusBanner() {
  const [status, setStatus] = useState<HealthState>('checking');
  const [errorDetails, setErrorDetails] = useState<string | null>(null);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [relativeTime, setRelativeTime] = useState('');

  const checkHealth = async () => {
    setStatus('checking');
    try {
      const res = await getHealthCheck();
      if (res?.status === 'ok') {
        setStatus('online');
        setErrorDetails(null);
      } else {
        setStatus('degraded');
        setErrorDetails('Degraded backend status');
      }
    } catch {
      setStatus('offline');
      setErrorDetails('Cannot connect to the backend. Run ./start.sh to launch the stack.');
    } finally {
      setLastChecked(new Date());
    }
  };

  useEffect(() => {
    checkHealth();
    const interval = setInterval(checkHealth, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!lastChecked) return;
    const update = () => {
      const diffSec = Math.floor((Date.now() - lastChecked.getTime()) / 1000);
      if (diffSec < 10) setRelativeTime('just now');
      else if (diffSec < 60) setRelativeTime(`${diffSec}s ago`);
      else setRelativeTime(`${Math.floor(diffSec / 60)}m ago`);
    };
    update();
    const interval = setInterval(update, 10000);
    return () => clearInterval(interval);
  }, [lastChecked]);

  if (status === 'offline') {
    return (
      <div className="mb-6 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <WifiOff className="w-4 h-4 text-red-500 animate-pulse" />
          <div>
            <p className="text-sm font-semibold text-red-600 dark:text-red-400">Backend Offline</p>
            <p className="text-xs text-red-500/80">{errorDetails}</p>
          </div>
        </div>
        <button onClick={checkHealth} className="btn-ghost text-xs text-red-500">
          <RefreshCw className="w-3.5 h-3.5" />
          Retry
        </button>
      </div>
    );
  }

  if (status === 'degraded') {
    return (
      <div className="mb-6 px-4 py-3 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <AlertTriangle className="w-4 h-4 text-amber-500" />
          <div>
            <p className="text-sm font-semibold text-amber-600 dark:text-amber-400">Degraded</p>
            <p className="text-xs text-amber-500/80">{errorDetails || 'Some features may be limited.'}</p>
          </div>
        </div>
        <button onClick={checkHealth} className="btn-ghost text-xs text-amber-500">
          <RefreshCw className="w-3.5 h-3.5" />
          Re-check
        </button>
      </div>
    );
  }

  if (status === 'checking') {
    return (
      <div className="mb-6 flex items-center justify-center py-2 text-xs text-slate-400">
        <Loader2 className="w-3.5 h-3.5 animate-spin mr-2" />
        Checking backend...
      </div>
    );
  }

  // Online — minimal indicator
  return (
    <div className="mb-6 flex items-center justify-between px-3 py-1.5 text-[11px] text-slate-400">
      <span className="flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full bg-cyber-500" aria-hidden="true" />
        Backend online
      </span>
      {relativeTime && <span className="font-mono">checked {relativeTime}</span>}
    </div>
  );
}
