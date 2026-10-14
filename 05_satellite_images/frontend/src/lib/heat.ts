import type { ClassDef, HeatSummary } from '../types';

/** Primer año con Landsat 8 (temperatura de superficie). */
export const HEAT_FIRST_YEAR = 2013;

const nf = (digits: number) => ({ minimumFractionDigits: digits, maximumFractionDigits: digits });

/** «33,2 °C» */
export const fmtC = (n: number, digits = 1) => `${n.toLocaleString('es-CO', nf(digits))} °C`;

/** «+1,4 °C» / «−0,3 °C» */
export const signedC = (n: number, digits = 1) =>
  `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toLocaleString('es-CO', nf(digits))} °C`;

export const fmtHa = (n: number) => n.toLocaleString('es-CO', { maximumFractionDigits: 0 });

/** Fecha corta en español: «7 dic 2024». */
export const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** La clase principal del resumen como ClassDef (para las frases con artículo). */
export const primaryDef = (h: HeatSummary): ClassDef => ({ code: 0, color: '', ...h.primary });

/** Años elegibles para comparar el calor: Landsat 8 y hasta 10 años atrás. */
export function heatYears(sceneYear: number): number[] {
  const out: number[] = [];
  for (let y = sceneYear - 1; y >= Math.max(HEAT_FIRST_YEAR, sceneYear - 10); y--) out.push(y);
  return out;
}
