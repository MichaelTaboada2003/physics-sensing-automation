import { useEffect, useRef } from 'react';
import type { StreamLine } from '../types';

interface LogConsoleProps {
  lines: StreamLine[];
  maxLines?: number;
}

function lineColor(stage: string): string {
  if (stage === 'error') return 'text-signal';
  if (stage === 'done') return 'text-veg-ink';
  return 'text-ink-2';
}

/** Registro técnico del proceso (mensajes NDJSON del backend). */
export default function LogConsole({ lines, maxLines = 40 }: LogConsoleProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const visible = lines.slice(-maxLines);

  // Desplaza solo la caja del registro, nunca la página
  useEffect(() => {
    const el = boxRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  return (
    <div ref={boxRef} className="figure text-[0.8125rem] leading-relaxed max-h-44 overflow-y-auto bg-paper-2 border border-rule rounded-[4px] p-3 space-y-0.5">
      {visible.length === 0 ? (
        <span className="text-muted">Sin mensajes todavía.</span>
      ) : (
        visible.map((line, i) => (
          <div key={i} className={`flex gap-2 ${lineColor(line.stage)}`}>
            <span className="text-muted shrink-0 w-11 text-right">{Math.round(line.progress * 100)} %</span>
            <span className="break-words min-w-0">{line.message}</span>
          </div>
        ))
      )}
    </div>
  );
}
