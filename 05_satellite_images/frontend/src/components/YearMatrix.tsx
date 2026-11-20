import { AlertCircle, Check } from 'lucide-react';
import type { YearProgress } from '../lib/yearProgress';
import { sceneCount } from '../lib/yearProgress';

interface YearMatrixProps {
  progress: YearProgress;
  /** Nombre de la clase principal, en minúsculas («bosque», «vegetación»). */
  mainLabel: string;
  className?: string;
}

const pct = (v: number | null | undefined) =>
  v === null || v === undefined ? '—' : `${v.toLocaleString('es-CO', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;

/**
 * Avance real de la serie: una fila por año y una casilla por escena clasificada.
 * Al terminar un año aparece su cifra, la misma que irá a la ficha de determinación.
 */
export default function YearMatrix({ progress, mainLabel, className = '' }: YearMatrixProps) {
  const { rows, scenesPerYear, currentYear } = progress;
  if (!rows.length) return null;
  const { done, total } = sceneCount(progress);
  const cols = Math.max(scenesPerYear, ...rows.map(r => r.total ?? 0));
  const composite = scenesPerYear > 1;

  return (
    <section className={`sheet ${className}`} aria-label="Avance por año">
      <header className="flex items-baseline justify-between gap-4 px-4 pt-3 pb-2 border-b border-rule">
        <h3 className="font-semibold">
          {composite ? 'Escenas por año' : 'Años clasificados'}
        </h3>
        <p className="figure text-sm text-ink-2 whitespace-nowrap" aria-live="off">
          {done} de {total}
        </p>
      </header>
      <ol className="px-4 py-2.5 space-y-1.5">
        {[...rows].reverse().map(r => {
          const cells = r.state === 'cached' ? 0 : Math.max(cols, r.total ?? 0);
          return (
            <li key={r.year} className="grid grid-cols-[3.25rem_1fr_auto] items-center gap-3 min-h-6">
              <span className={`figure text-sm ${r.state === 'pending' ? 'text-muted' : 'font-bold'}`}>
                {r.year}
              </span>
              <span className="flex flex-wrap items-center gap-1" aria-hidden>
                {Array.from({ length: cells }, (_, i) => {
                  const planned = r.total === null ? i < scenesPerYear : i < r.total;
                  const state = !planned ? 'none'
                    : i < r.done ? (r.state === 'done' ? 'kept' : 'read')
                    : i === r.done && r.state === 'running' ? 'next'
                    : 'empty';
                  return <span key={i} className="scene-cell" data-state={state} />;
                })}
                {r.state === 'cached' && <span className="text-sm text-muted">ya calculado</span>}
              </span>
              <span className="text-sm text-right whitespace-nowrap">
                {r.state === 'done' && (
                  <span className="inline-flex items-center gap-1.5">
                    <span className="figure font-bold">{pct(r.percent)}</span>
                    <Check className="w-3.5 h-3.5 text-veg" strokeWidth={3} aria-hidden />
                  </span>
                )}
                {r.state === 'failed' && (
                  <span className="inline-flex items-center gap-1.5 text-ink-2">
                    sin imágenes <AlertCircle className="w-3.5 h-3.5 text-soil" aria-hidden />
                  </span>
                )}
                {r.state === 'running' && (
                  <span className="figure text-ink-2">{r.done}/{r.total ?? scenesPerYear}</span>
                )}
                {r.state === 'pending' && <span className="text-muted">en cola</span>}
                <span className="sr-only">
                  {r.state === 'done' ? `${r.year} listo` : r.state === 'failed' ? `${r.year} sin imágenes` : ''}
                </span>
              </span>
            </li>
          );
        })}
      </ol>
      <p className="px-4 py-2.5 border-t border-rule text-sm text-muted">
        La cifra de cada año es el <span className="text-ink-2">% de {mainLabel}</span> sobre el área clasificada
        {currentYear !== null && composite && <>; <span className="figure">{currentYear}</span> se mide igual que los demás</>}.
      </p>
    </section>
  );
}
