import { useEffect, useState } from 'react';
import type { LatLngBoundsExpression } from 'leaflet';

/** Límites geográficos de la grilla de la sesión (para superponer capas en Leaflet). */
export function useLayerBounds(sessionId: string) {
  const [bounds, setBounds] = useState<LatLngBoundsExpression | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/layer/bounds?session_id=${sessionId}`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: { bounds: [[number, number], [number, number]] }) => {
        if (!cancelled) setBounds(d.bounds);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  return { bounds, error };
}
