import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { ClassDef, ClassKey, ClassStat, Trend, Zone } from '../types';
import { RULES_DEFS, slipDefs } from '../lib/classes';
import { bboxAreaKm2, centerDms } from '../lib/geo';
import Stamp from './Stamp';

// ── Tipos ──────────────────────────────────────────────────────────────────────

/** Ficha de determinación de un año comparado (porcentajes del área despejada). */
export interface DeterminationSlip {
  year: number;
  /** Fecha de la escena o, en un compuesto, cuántas escenas votaron («6 escenas»). */
  date: string;
  /** % del área despejada por clave de clase. */
  values: Record<string, number | null>;
}

interface SpecimenLabelProps {
  zone: Zone;
  scene?: { id: string; datetime: string } | null;
  cloudFraction?: number | null;
  classes?: Record<ClassKey, ClassStat> | null;
  /** Clases del esquema con que se entrenó (reglas o WorldCover). */
  classDefs?: ClassDef[];
  /** Fichas de años anteriores; la más reciente queda arriba. */
  slips?: DeterminationSlip[];
  /** Tendencia de la clase principal (vegetación o bosque): el rojo solo si es significativa. */
  vegetationTrend?: Trend | null;
  /** Arranca plegada (móvil o mapas pequeños). */
  defaultCollapsed?: boolean;
  /** Fichas visibles sobre la etiqueta (menos dentro de un mapa, para que quepa). */
  maxSlips?: number;
  /** Escenas que componen el mapa del año actual (más de una = compuesto anual). */
  nScenes?: number;
  /** Sobre un mapa: sin satélite ni tile, para no tapar la imagen. */
  compact?: boolean;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/** «S2A_MSIL2A_…» → «Sentinel-2A»; tile «T18NWP». */
function sceneMeta(id: string) {
  const sat = /^S2([ABC])/.exec(id)?.[1];
  const tile = /_T(\d{2}[A-Z]{3})_/.exec(id)?.[1];
  return { collector: sat ? `Sentinel-2${sat}` : 'Sentinel-2', tile: tile ? `T${tile}` : null };
}

const pct = (v: number | null | undefined) =>
  v === null || v === undefined ? '—' : `${v.toLocaleString('es-CO', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;


// ── Componente ─────────────────────────────────────────────────────────────────

export default function SpecimenLabel({
  zone, scene, cloudFraction, classes, classDefs = RULES_DEFS, slips = [], vegetationTrend, defaultCollapsed = false, maxSlips = 4,
  nScenes = 1, compact = false,
}: SpecimenLabelProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const meta = scene ? sceneMeta(scene.id) : null;
  const ordered = [...slips].sort((a, b) => b.year - a.year);
  const visibleSlips = ordered.slice(0, maxSlips);

  return (
    <section aria-label={`Etiqueta del ejemplar: ${zone.name}`} className="w-[300px] max-w-full">
      {/* Fichas de determinación apiladas sobre la etiqueta */}
      {!collapsed && visibleSlips.length > 0 && (
        <ol className="relative -mb-1 space-y-[-6px]" aria-label="Determinaciones por año">
          {visibleSlips.map((slip, i) => (
            <li
              key={slip.year}
              className="slip-enter relative bg-paper bg-[image:var(--tex-paper)] border border-rule rounded-t-[4px] px-3 pt-1.5 pb-2.5 shadow-[0_1px_2px_rgb(27_36_48/0.08)]"
              style={{ marginLeft: `${(visibleSlips.length - 1 - i) * 6}px`, marginRight: `${i * 4}px`, animationDelay: `${i * 70}ms` }}
            >
              <p className="flex items-baseline justify-between text-xs">
                <span className="font-semibold text-ink-2">Det. <span className="figure">{slip.year}</span></span>
                <span className="figure text-muted">{slip.date}</span>
              </p>
              <p className="figure text-[0.8125rem] mt-0.5 flex gap-3">
                {slipDefs(classDefs).map((d, j) => (
                  <span key={d.key} className={`inline-flex items-center gap-1 ${j === 0 ? 'font-bold' : ''}`} title={d.label}>
                    <span className="w-2 h-2 rounded-[2px]" style={{ background: d.color }} aria-hidden />
                    <span className="sr-only">{d.label}</span>
                    {pct(slip.values[d.key])}
                  </span>
                ))}
              </p>
            </li>
          ))}
        </ol>
      )}

      {/* Etiqueta */}
      <div className="relative bg-paper bg-[image:var(--tex-paper)] border border-rule-strong rounded-[4px] shadow-[var(--shadow-lift)]">
        <button
          type="button"
          onClick={() => setCollapsed(c => !c)}
          aria-expanded={!collapsed}
          className="w-full flex items-start justify-between gap-3 px-3.5 pt-3 pb-2 text-left"
        >
          <span className="min-w-0">
            <span className="block font-serif italic text-lg leading-snug text-ink">{zone.name}</span>
            <span className="figure block text-sm text-ink-2 mt-0.5">
              {centerDms(zone.bbox)}
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
                  {!compact && (
                    <>
                      <dt className="text-muted">Satélite</dt>
                      <dd className="figure text-right">{meta.collector}</dd>
                    </>
                  )}
                  {!compact && meta.tile && (
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
              {nScenes > 1 && (
                <>
                  <dt className="text-muted">Compuesto anual</dt>
                  <dd className="figure text-right">voto de {nScenes} escenas</dd>
                </>
              )}
            </dl>

            {classes && (
              <div className="mt-2 border-t border-rule pt-2">
                <p className="text-xs font-semibold text-ink-2 mb-1">Determinación (% del área despejada)</p>
                <ul className="space-y-0.5">
                  {classDefs.filter(c => classes[c.key]).map(c => (
                    <li key={c.key} className="flex items-center gap-2 text-sm">
                      <span className="w-2.5 h-2.5 rounded-[2px]" style={{ background: c.color }} aria-hidden />
                      <span className="text-ink-2">{c.label}</span>
                      <span className="figure ml-auto font-bold">{pct(classes[c.key].percent_clear)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {vegetationTrend && (
              <div className="mt-2 border-t border-rule pt-2.5 pb-1 flex items-center justify-between gap-3">
                <p className="text-sm leading-tight">
                  <span className="block text-xs text-muted">Tendencia · {(classDefs[0]?.label ?? 'Vegetación').toLowerCase()}</span>
                  <span className="figure font-bold">
                    {vegetationTrend.slope > 0 ? '+' : vegetationTrend.slope < 0 ? '−' : ''}
                    {Math.abs(vegetationTrend.ha_per_year ?? 0).toLocaleString('es-CO', { maximumFractionDigits: 1 })} ha/año
                  </span>
                </p>
                <Stamp trend={vegetationTrend} small className="shrink-0 mr-1" />
              </div>
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
