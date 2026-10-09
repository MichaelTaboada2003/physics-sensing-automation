import type { BBox } from '../types';

// ── Zonas predefinidas ─────────────────────────────────────────────────────────

export const PRESETS: { name: string; description: string; bbox: BBox }[] = [
  { name: 'El Bagre, Antioquia',        description: 'Minería aluvial de oro (río Nechí)',         bbox: [-74.85, 7.55, -74.75, 7.65] },
  { name: 'Río Quito, Chocó',           description: 'Minería con dragas en el río',               bbox: [-76.78, 5.42, -76.66, 5.54] },
  { name: 'Hidroituango, Antioquia',    description: 'Embalse llenado entre 2019 y 2022',          bbox: [-75.75, 7.02, -75.63, 7.14] },
  { name: 'Cerrejón, La Guajira',       description: 'Mina de carbón a cielo abierto',             bbox: [-72.72, 11.0, -72.6, 11.1] },
  { name: 'San José del Guaviare',      description: 'Arco de deforestación amazónico',            bbox: [-72.85, 2.35, -72.73, 2.47] },
  { name: 'Ciénaga Grande, Magdalena',  description: 'Manglar y espejo de agua',                   bbox: [-74.55, 10.85, -74.43, 10.97] },
];

export const MAX_AREA_KM2 = 500;
export const WARN_AREA_KM2 = 250;

export function bboxAreaKm2([w, s, e, n]: BBox): number {
  const latMid = ((s + n) / 2) * (Math.PI / 180);
  return Math.abs(e - w) * 111.32 * Math.cos(latMid) * Math.abs(n - s) * 110.57;
}

export function bboxIsTooLarge(b: BBox): boolean {
  return bboxAreaKm2(b) > MAX_AREA_KM2;
}

// ── Región de trabajo (Colombia) ───────────────────────────────────────────────

export interface Region {
  name: string;
  bounds: BBox;
  /** Anillos exteriores de cada polígono, en [lon, lat]. */
  rings: [number, number][][];
}

/** Ray casting: ¿está (lon, lat) dentro del anillo? */
function inRing([x, y]: [number, number], ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Igual que el backend: válida si el centro o alguna esquina cae dentro de la región. */
export function bboxInRegion([w, s, e, n]: BBox, region: Region): boolean {
  const pts: [number, number][] = [[(w + e) / 2, (s + n) / 2], [w, s], [w, n], [e, s], [e, n]];
  return pts.some(p => region.rings.some(r => inRing(p, r)));
}
