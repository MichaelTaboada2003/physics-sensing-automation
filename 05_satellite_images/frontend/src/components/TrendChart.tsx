import { useEffect, useId, useRef, useState } from 'react';
import type { Trend } from '../types';

export interface TrendPoint {
  year: number;
  /** Hectáreas; null = año excluido de la tendencia (se dibuja como hueco). */
  ha: number | null;
}

interface TrendChartProps {
  points: TrendPoint[];
  trend: Trend | null | undefined;
  /** Color de la clase (trazo). */
  color: string;
  /** Nombre de la clase para el texto alternativo. */
  label: string;
  /** Año resaltado (p. ej. el cuadro visible de la línea de tiempo). */
  activeYear?: number | null;
  onYear?: (year: number) => void;
  height?: number;
}

const INK = '#1b2430';
const INK_2 = '#3d4856';
const MUTED = '#5f6b77';
const RULE = '#cdd3c8';
const RULE_STRONG = '#aab3a6';
const PAPER = '#fbfcf8';
const SIGNAL = '#b42318';

const es = (v: number, d = 0) => v.toLocaleString('es-CO', { maximumFractionDigits: d, minimumFractionDigits: d });

function median(v: number[]): number {
  const o = [...v].sort((a, b) => a - b);
  const m = Math.floor(o.length / 2);
  return o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2;
}

/** Paso «redondo» (1, 2 o 5 × 10ⁿ) para unas *count* divisiones del eje. */
function niceStep(range: number, count: number): number {
  const raw = range / Math.max(1, count);
  const pow = 10 ** Math.floor(Math.log10(raw));
  const n = raw / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}

/**
 * Hectáreas de la clase principal por año, con la recta de Theil-Sen y la franja
 * de su IC 95 % pivotando en la mediana. El eje parte de cero por defecto; el modo
 * «Acercar» recorta el eje y lo dice, para mirar el vaivén año a año sin engañar.
 */
export default function TrendChart({ points, trend, color, label, activeYear = null, onYear, height = 300 }: TrendChartProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [zoom, setZoom] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const clip = useId();

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(280, Math.round(entry.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const used = points.filter((p): p is { year: number; ha: number } => p.ha !== null);
  const m = { top: 26, right: 18, bottom: 30, left: width < 420 ? 46 : 60 };
  const iw = width - m.left - m.right;
  const ih = height - m.top - m.bottom;

  const years = points.map(p => p.year);
  const x0 = Math.min(...years);
  const x1 = Math.max(...years);
  const x = (year: number) => m.left + (x1 === x0 ? iw / 2 : ((year - x0) / (x1 - x0)) * iw);

  // Recta y franja, igual que en el PNG exportado
  const xm = used.length ? median(used.map(p => p.year)) : 0;
  const ym = used.length ? median(used.map(p => p.ha)) : 0;
  const at = (slope: number, year: number) => ym + slope * (year - xm);
  const slope = trend?.ha_per_year ?? 0;
  const lo = trend?.ha_per_year_low ?? 0;
  const hi = trend?.ha_per_year_high ?? 0;
  const bandAt = (year: number) => [Math.min(at(lo, year), at(hi, year)), Math.max(at(lo, year), at(hi, year))];

  const values = used.map(p => p.ha);
  const bandValues = trend && used.length ? [x0, x1].flatMap(bandAt) : [];
  const dataMax = Math.max(1, ...values, ...bandValues);
  const dataMin = Math.min(...values, ...bandValues, dataMax);
  let yMin = 0;
  let yMax = dataMax * 1.08;
  if (zoom && used.length) {
    const pad = Math.max((dataMax - dataMin) * 0.25, dataMax * 0.01);
    yMin = Math.max(0, dataMin - pad);
    yMax = dataMax + pad;
  }
  const step = niceStep(yMax - yMin, height < 240 ? 3 : 4);
  const ticks: number[] = [];
  for (let t = Math.ceil(yMin / step) * step; t <= yMax + 1e-9; t += step) ticks.push(t);
  const y = (v: number) => m.top + ih - ((v - yMin) / (yMax - yMin)) * ih;

  const trendColor = trend?.significant ? SIGNAL : MUTED;
  // Tramos continuos: un año excluido corta la línea
  const segments: { year: number; ha: number }[][] = [];
  let run: { year: number; ha: number }[] = [];
  for (const p of points) {
    if (p.ha === null) {
      if (run.length) segments.push(run);
      run = [];
    } else run.push({ year: p.year, ha: p.ha });
  }
  if (run.length) segments.push(run);

  const focus = hover ?? activeYear;
  const focusPoint = points.find(p => p.year === focus) ?? null;
  const everyOther = iw / Math.max(1, points.length) < 34;
  const colW = points.length > 1 ? iw / (points.length - 1) : iw;
  const significant = trend?.significant ? 'significativa' : 'no significativa';

  return (
    <div ref={wrap} className="relative">
      <div className="absolute right-0 -top-1 z-10 segmented !p-0.5" role="group" aria-label="Eje vertical">
        <button type="button" aria-pressed={!zoom} onClick={() => setZoom(false)} className="!py-1 !px-2 !text-xs">Desde cero</button>
        <button type="button" aria-pressed={zoom} onClick={() => setZoom(true)} className="!py-1 !px-2 !text-xs">Acercar</button>
      </div>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`${label}: hectáreas por año de ${x0} a ${x1}${trend ? `; tendencia ${significant} de ${es(slope, 1)} hectáreas por año` : ''}.`}
        className="block select-none"
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <clipPath id={clip}>
            <rect x={m.left} y={m.top} width={iw} height={ih} />
          </clipPath>
        </defs>

        {/* Retícula horizontal y eje de valores */}
        {ticks.map(t => (
          <g key={t}>
            <line x1={m.left} x2={m.left + iw} y1={y(t)} y2={y(t)} stroke={t === 0 ? RULE_STRONG : RULE} strokeWidth={1} />
            <text x={m.left - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={12} fill={INK_2} fontFamily="Courier Prime, monospace">
              {es(t)}
            </text>
          </g>
        ))}
        {zoom && (
          // Quiebre del eje: avisa que no parte de cero
          <path
            d={`M${m.left - 5} ${m.top + ih + 3} l10 -4 M${m.left - 5} ${m.top + ih + 8} l10 -4`}
            stroke={INK_2}
            strokeWidth={1.5}
            fill="none"
          />
        )}

        <g clipPath={`url(#${clip})`}>
          {trend && used.length > 1 && (
            <>
              <polygon
                points={[
                  `${x(x0)},${y(bandAt(x0)[1])}`, `${x(x1)},${y(bandAt(x1)[1])}`,
                  `${x(x1)},${y(bandAt(x1)[0])}`, `${x(x0)},${y(bandAt(x0)[0])}`,
                ].join(' ')}
                fill={trendColor}
                fillOpacity={0.12}
              />
              <line
                x1={x(x0)} y1={y(at(slope, x0))} x2={x(x1)} y2={y(at(slope, x1))}
                stroke={trendColor} strokeWidth={1.5} strokeDasharray="6 4"
              />
            </>
          )}
          {segments.map(seg => (
            <polyline
              key={seg[0].year}
              points={seg.map(p => `${x(p.year)},${y(p.ha)}`).join(' ')}
              fill="none"
              stroke={color}
              strokeWidth={2.25}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))}
        </g>

        {/* Cursor del año en foco */}
        {focusPoint && (
          <line x1={x(focusPoint.year)} x2={x(focusPoint.year)} y1={m.top} y2={m.top + ih} stroke={INK_2} strokeWidth={1} strokeDasharray="2 3" />
        )}

        {points.map(p => {
          const on = p.year === focus;
          return p.ha === null ? (
            // Año excluido: marca hueca sobre el eje, nunca un cero
            <circle key={p.year} cx={x(p.year)} cy={m.top + ih} r={3.5} fill={PAPER} stroke={MUTED} strokeWidth={1.5} strokeDasharray="2 2" />
          ) : (
            <circle key={p.year} cx={x(p.year)} cy={y(p.ha)} r={on ? 6 : 4} fill={color} stroke={PAPER} strokeWidth={2} />
          );
        })}

        {/* Eje de años */}
        {points.map((p, i) => {
          const on = p.year === focus;
          if (everyOther && !on && (points.length - 1 - i) % 2 === 1) return null;
          return (
            <text
              key={p.year}
              x={x(p.year)}
              y={m.top + ih + 19}
              textAnchor="middle"
              fontSize={12}
              fontWeight={on ? 700 : 400}
              fill={p.ha === null ? MUTED : on ? INK : INK_2}
              fontFamily="Courier Prime, monospace"
            >
              {p.year}
            </text>
          );
        })}

        {/* Valor del año en foco, escrito a máquina sobre el punto */}
        {focusPoint && (() => {
          const text = focusPoint.ha === null ? 'sin datos suficientes' : `${es(focusPoint.ha)} ha`;
          const w = text.length * 7.4 + 14;
          const cx = Math.min(Math.max(x(focusPoint.year), m.left + w / 2), m.left + iw - w / 2);
          const cy = focusPoint.ha === null ? m.top + ih - 22 : Math.max(m.top - 12, y(focusPoint.ha) - 24);
          return (
            <g pointerEvents="none">
              <rect x={cx - w / 2} y={cy - 10} width={w} height={20} rx={3} fill={PAPER} stroke={RULE_STRONG} />
              <text x={cx} y={cy} dy="0.33em" textAnchor="middle" fontSize={12.5} fontWeight={700} fill={INK} fontFamily="Courier Prime, monospace">
                {text}
              </text>
            </g>
          );
        })()}

        {/* Zonas de puntero por año (la selección con teclado vive en la tira de fichas) */}
        {points.map(p => (
          <rect
            key={p.year}
            x={x(p.year) - colW / 2}
            y={m.top}
            width={colW}
            height={ih + m.bottom}
            fill="transparent"
            style={{ cursor: onYear ? 'pointer' : 'default' }}
            onMouseEnter={() => setHover(p.year)}
            onClick={() => onYear?.(p.year)}
          />
        ))}
      </svg>
      {zoom && (
        <p className="text-sm text-soil font-semibold mt-1">
          Eje recortado (no parte de cero): las diferencias entre años se ven mayores de lo que son.
        </p>
      )}
    </div>
  );
}
