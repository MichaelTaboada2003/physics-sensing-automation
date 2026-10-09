import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { ClassKey, ClassStat, Trend, Zone } from '../types';
import { bboxAreaKm2 } from '../lib/geo';

// ── Tipos ──────────────────────────────────────────────────────────────────────

/** Ficha de determinación de un año comparado (porcentajes del área despejada). */
export interface DeterminationSlip {
  year: number;
  date: string;
  vegetation: number | null;
  water: number | null;
  mining: number | null;
}

interface SpecimenLabelProps {
  zone: Zone;
  scene?: { id: string; datetime: string } | null;
  cloudFraction?: number | null;
  classes?: Record<ClassKey, ClassStat> | null;
  /** Fichas de años anteriores; la más reciente queda arriba. */
  slips?: DeterminationSlip[];
  /** Tendencia de la vegetación: el sello rojo solo aparece si es significativa. */
  vegetationTrend?: Trend | null;
  /** Arranca plegada (móvil o mapas pequeños). */
  defaultCollapsed?: boolean;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function dms(value: number, pos: string, neg: string): string {
  const abs = Math.abs(value);
  const d = Math.floor(abs);
  const m = Math.round((abs - d) * 60);
  return `${d}°${String(m).padStart(2, '0')}′${value >= 0 ? pos : neg}`;
}

/** «S2A_MSIL2A_…» → «Sentinel-2A»; tile «T18NWP». */
function sceneMeta(id: string) {
  const sat = /^S2([ABC])/.exec(id)?.[1];
  const tile = /_T(\d{2}[A-Z]{3})_/.exec(id)?.[1];
  return { collector: sat ? `Sentinel-2${sat}` : 'Sentinel-2', tile: tile ? `T${tile}` : null };
}

const pct = (v: number | null | undefined) =>
  v === null || v === undefined ? '—' : `${v.toLocaleString('es-CO', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;

const CLASS_ROWS: { key: Exclude<ClassKey, 'unclassified'>; label: string; color: string }[] = [
  { key: 'vegetation', label: 'Vegetación', color: 'bg-veg' },
  { key: 'water', label: 'Agua', color: 'bg-water' },
  { key: 'mining', label: 'Suelo / minería', color: 'bg-soil' },
];

// ── Componente ─────────────────────────────────────────────────────────────────

export default function SpecimenLabel({
  zone, scene, cloudFraction, classes, slips = [], vegetationTrend, defaultCollapsed = false,
}: SpecimenLabelProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [w, s, e, n] = zone.bbox;
  const meta = scene ? sceneMeta(scene.id) : null;
  const ordered = [...slips].sort((a, b) => b.year - a.year);
  const visibleSlips = ordered.slice(0, 4);
  const significant = vegetationTrend?.significant;

  return (
    <section aria-label={`Etiqueta del ejemplar: ${zone.name}`} className="w-[300px] max-w-full">
      {/* Fichas de determinación apiladas sobre la etiqueta */}
      {!collapsed && visibleSlips.length > 0 && (
        <ol className="relative -mb-1 space-y-[-6px]" aria-label="Determinaciones por año">
          {visibleSlips.map((slip, i) => (
            <li
              key={slip.year}
              className="slip-enter relative bg-paper border border-rule rounded-t-[4px] px-3 pt-1.5 pb-2.5 shadow-[0_1px_2px_rgb(27_36_48/0.08)]"
              style={{ marginLeft: `${(visibleSlips.length - 1 - i) * 6}px`, marginRight: `${i * 4}px`, animationDelay: `${i * 70}ms` }}
            >
              <p className="flex items-baseline justify-between text-xs">
                <span className="font-semibold text-ink-2">Det. <span className="figure">{slip.year}</span></span>
                <span className="figure text-muted">{slip.date}</span>
              </p>
              <p className="figure text-[0.8125rem] mt-0.5 flex gap-3">
                <span className="text-veg font-bold">V {pct(slip.vegetation)}</span>
                <span className="text-water">A {pct(slip.water)}</span>
                <span className="text-soil">S {pct(slip.mining)}</span>
              </p>
            </li>
          ))}
        </ol>
      )}

      {/* Etiqueta */}
      <div className="relative bg-paper border border-rule-strong rounded-[4px] shadow-[var(--shadow-lift)]">
        <button
          type="button"
          onClick={() => setCollapsed(c => !c)}
          aria-expanded={!collapsed}
          className="w-full flex items-start justify-between gap-3 px-3.5 pt-3 pb-2 text-left"
        >
          <span className="min-w-0">
            <span className="block font-serif italic text-lg leading-snug text-ink">{zone.name}</span>
            <span className="figure block text-sm text-ink-2 mt-0.5">
              {dms((s + n) / 2, 'N', 'S')} {dms((w + e) / 2, 'E', 'O')}
            </span>
          </span>
          {collapsed
            ? <ChevronUp className="w-4 h-4 mt-1 shrink-0 text-muted" aria-label="Mostrar etiqueta" />
            : <ChevronDown className="w-4 h-4 mt-1 shrink-0 text-muted" aria-label="Plegar etiqueta" />}
        </button>

        {!collapsed && (
          <div className="px-3.5 pb-3">
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm border-t border-rule pt-2">
              <dt className="text-muted">Área</dt>
              <dd className="figure text-right">{bboxAreaKm2(zone.bbox).toLocaleString('es-CO', { maximumFractionDigits: 0 })} km²</dd>
              {scene && meta && (
                <>
                  <dt className="text-muted">Fecha</dt>
                  <dd className="figure text-right">{scene.datetime.slice(0, 10)}</dd>
                  <dt className="text-muted">Satélite</dt>
                  <dd className="figure text-right">{meta.collector}</dd>
                  {meta.tile && (
                    <>
                      <dt className="text-muted">Tile</dt>
                      <dd className="figure text-right">{meta.tile}</dd>
                    </>
                  )}
                </>
              )}
              {cloudFraction !== null && cloudFraction !== undefined && (
                <>
                  <dt className="text-muted">Nubes en la zona</dt>
                  <dd className="figure text-right">{pct(cloudFraction * 100)}</dd>
                </>
              )}
            </dl>

            {classes && (
              <div className="mt-2 border-t border-rule pt-2">
                <p className="text-xs font-semibold text-ink-2 mb-1">Determinación (% del área despejada)</p>
                <ul className="space-y-0.5">
                  {CLASS_ROWS.map(c => (
                    <li key={c.key} className="flex items-center gap-2 text-sm">
                      <span className={`w-2.5 h-2.5 rounded-[2px] ${c.color}`} aria-hidden />
                      <span className="text-ink-2">{c.label}</span>
                      <span className="figure ml-auto font-bold">{pct(classes[c.key].percent_clear)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {vegetationTrend && (
              <p
                className={`mt-2.5 text-sm rounded-[3px] px-2 py-1.5 border ${
                  significant ? 'border-signal text-signal bg-signal-tint' : 'border-rule text-ink-2 bg-paper-2'
                }`}
              >
                <span className="font-bold">
                  Vegetación {vegetationTrend.slope > 0 ? '+' : ''}
                  <span className="figure">{(vegetationTrend.ha_per_year ?? 0).toLocaleString('es-CO', { maximumFractionDigits: 1 })}</span> ha/año
                </span>
                <span className="block text-xs mt-0.5">
                  {significant ? 'Tendencia significativa' : 'Sin tendencia significativa'} · Mann-Kendall p{' '}
                  <span className="figure">{vegetationTrend.p_value < 0.001 ? '< 0,001' : `= ${vegetationTrend.p_value.toLocaleString('es-CO', { minimumFractionDigits: 3, maximumFractionDigits: 3 })}`}</span>
                </span>
              </p>
            )}

            {ordered.length > visibleSlips.length && (
              <p className="text-xs text-muted mt-2">
                + <span className="figure">{ordered.length - visibleSlips.length}</span> determinaciones anteriores
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
