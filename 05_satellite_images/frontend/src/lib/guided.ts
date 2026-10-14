import type { BBox, TimeSeries } from '../types';

export type GuidedStage = 'zone' | 'running' | 'results';

export type TaskId = 'scene' | 'bands' | 'train' | 'map' | 'series' | 'heat';

/** Estado del modo guiado. Vive en App para sobrevivir a los cambios de modo. */
export interface GuidedRun {
  bbox: BBox;
  zoneName: string;
  current: TaskId | null;
  done: TaskId[];
  message: string;
  error: { task: TaskId; text: string } | null;
  series: TimeSeries | null;
  /** Sesión a la que pertenece la serie (si la sesión cambia, la serie no vale). */
  seriesSession: string | null;
}

export const initialGuidedRun = (bbox: BBox, zoneName: string): GuidedRun => ({
  bbox, zoneName, current: null, done: [], message: '', error: null, series: null, seriesSession: null,
});

/** Año base de la comparación guiada: el primero bien clasificado desde 2017
 *  (antes, Sentinel-2 L2A es irregular). */
export function baseYear(series: TimeSeries): number {
  const current = series.points[series.points.length - 1];
  const used = new Set(series.years_used_for_trend);
  const candidates = series.points.filter(p => used.has(p.year) && p.year !== current.year);
  return (candidates.find(p => p.year >= 2017) ?? candidates[0] ?? series.points[0]).year;
}
