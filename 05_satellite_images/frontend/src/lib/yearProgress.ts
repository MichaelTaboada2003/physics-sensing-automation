import type { YearEvent } from '../types';

/** Estado de una fila de la matriz de avance (un año). */
export interface YearRow {
  year: number;
  /** Escenas previstas para el año; null hasta que el catálogo responde. */
  total: number | null;
  done: number;
  state: 'pending' | 'running' | 'done' | 'failed' | 'cached';
  /** % de la clase principal al terminar el año. */
  percent?: number | null;
}

export interface YearProgress {
  scenesPerYear: number;
  currentYear: number | null;
  rows: YearRow[];
}

export const emptyYearProgress = (scenesPerYear = 1): YearProgress => ({ scenesPerYear, currentYear: null, rows: [] });

/** Aplica un evento del stream; devuelve el mismo objeto si no cambia nada. */
export function applyYearEvent(state: YearProgress, e: YearEvent | undefined): YearProgress {
  if (!e) return state;
  if (e.plan) {
    const cached = new Set(e.plan.cached);
    const years = [...new Set([...e.plan.years, ...e.plan.cached])].sort((a, b) => a - b);
    return {
      scenesPerYear: e.plan.scenes_per_year,
      currentYear: e.plan.current_year,
      rows: years.map(year => ({ year, total: null, done: 0, state: cached.has(year) ? 'cached' : 'pending' })),
    };
  }
  if (e.year === undefined) return state;
  const known = state.rows.some(r => r.year === e.year);
  const rows = known ? state.rows : [...state.rows, { year: e.year, total: null, done: 0, state: 'pending' as const }]
    .sort((a, b) => a.year - b.year);
  return {
    ...state,
    rows: rows.map(r => {
      if (r.year !== e.year) return r;
      if (e.year_failed) return { ...r, state: 'failed' };
      if (e.year_done) return { ...r, state: 'done', done: e.n_scenes ?? r.done, total: e.n_scenes ?? r.total, percent: e.primary_percent };
      return {
        ...r,
        state: 'running',
        total: e.scenes_total ?? r.total,
        done: e.scene_index ?? r.done,
      };
    }),
  };
}

/** Escenas clasificadas y previstas en total (para la cuenta «37 de 66»). */
export function sceneCount(p: YearProgress): { done: number; total: number } {
  let done = 0;
  let total = 0;
  for (const r of p.rows) {
    if (r.state === 'cached') continue;
    done += r.done;
    total += r.state === 'failed' ? r.done : r.total ?? p.scenesPerYear;
  }
  return { done, total };
}
