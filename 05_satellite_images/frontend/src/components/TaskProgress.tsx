import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import type { StreamLine } from '../types';
import ProgressBar from './ProgressBar';
import LogConsole from './LogConsole';

export type TaskStatus = 'idle' | 'running' | 'done' | 'error';

interface TaskProgressProps {
  status: TaskStatus;
  progress: number;
  lines: StreamLine[];
  /** Títulos por estado, en lenguaje claro. */
  titles: { running: string; done: string; error: string };
  error?: string | null;
}

/**
 * Estado de una tarea larga: qué está pasando ahora (el último mensaje),
 * la barra de progreso y el registro técnico plegado.
 */
export default function TaskProgress({ status, progress, lines, titles, error }: TaskProgressProps) {
  if (status === 'idle') return null;
  const last = [...lines].reverse().find(l => l.stage !== 'error')?.message;

  return (
    <div className="sheet p-4 space-y-3" aria-live="polite">
      <div className="flex items-start gap-2.5">
        {status === 'running' && <Loader2 className="w-5 h-5 text-stamp animate-spin shrink-0 mt-0.5" aria-hidden />}
        {status === 'done' && <CheckCircle2 className="w-5 h-5 text-veg shrink-0 mt-0.5" aria-hidden />}
        {status === 'error' && <AlertCircle className="w-5 h-5 text-signal shrink-0 mt-0.5" aria-hidden />}
        <div className="min-w-0">
          <p className="font-semibold">{titles[status]}</p>
          {status === 'running' && last && <p className="text-sm text-ink-2 mt-0.5">{last}</p>}
          {status === 'error' && error && <p className="text-sm text-signal mt-0.5">{error}</p>}
        </div>
      </div>
      {status !== 'error' && <ProgressBar progress={progress} />}
      {lines.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm font-semibold text-ink-2 hover:text-ink select-none">
            Detalle técnico
          </summary>
          <div className="mt-2">
            <LogConsole lines={lines} />
          </div>
        </details>
      )}
    </div>
  );
}
