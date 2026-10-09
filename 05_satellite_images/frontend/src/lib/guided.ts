import type { BBox, TimeSeries } from '../types';

export type GuidedStage = 'zone' | 'running' | 'results';

export type TaskId = 'scene' | 'bands' | 'train' | 'map' | 'series';

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
