import { useEffect, useState } from 'react';
import type { ClassKey, ClassStat } from '../types';

export interface MapStats {
  scene_id: string;
  datetime: string;
  cloud_fraction: number | null;
  pixel_area_m2: number | null;
  classes: Record<ClassKey, ClassStat> | null;
}

/** Datos de la etiqueta del ejemplar; `refreshKey` fuerza a volver a pedirlos. */
export function useMapStats(sessionId: string | null, refreshKey: unknown): MapStats | null {
  const [stats, setStats] = useState<MapStats | null>(null);
  useEffect(() => {
    if (!sessionId) return;
    let alive = true;
    fetch(`/map/stats?session_id=${sessionId}`)
      .then(r => (r.ok ? r.json() : null))
      .then((d: MapStats | null) => alive && setStats(d))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [sessionId, refreshKey]);
  return sessionId ? stats : null;
}
