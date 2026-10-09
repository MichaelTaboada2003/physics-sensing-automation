import { useEffect, useState } from 'react';
import type { BBox } from '../types';
import type { Region } from '../lib/geo';

// Caché a nivel de módulo: el contorno se pide una sola vez por carga de página
let cached: Promise<Region> | null = null;

function loadRegion(): Promise<Region> {
  cached ??= fetch('/region')
    .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
    .then((d: { name: string; bounds: BBox; geojson: { features: { geometry: { coordinates: [number, number][][][] } }[] } }) => ({
      name: d.name,
      bounds: d.bounds,
      rings: d.geojson.features[0].geometry.coordinates.map(poly => poly[0]),
    }))
    .catch(err => {
      cached = null; // permitir reintento
      throw err;
    });
  return cached;
}

/** Región de trabajo (Colombia): límites y contorno. `null` mientras carga. */
export function useRegion(): Region | null {
  const [region, setRegion] = useState<Region | null>(null);
  useEffect(() => {
    let alive = true;
    loadRegion().then(r => alive && setRegion(r)).catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  return region;
}
