import type { HeatSummary } from '../../types';
import { fmtC, primaryDef, signedC } from '../../lib/heat';
import { phrase } from '../../lib/classes';

export type HeatLayer = 'lst' | 'delta';

/** Leyenda de las capas de calor: rampa continua con sus extremos en °C. */
export default function HeatLegend({ kind, heat }: { kind: HeatLayer; heat: HeatSummary }) {
  const ramp = kind === 'lst' ? heat.ramp : heat.delta_ramp;
  const gradient = `linear-gradient(90deg, ${ramp.join(', ')})`;
  if (kind === 'lst') {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-2">
        <span className="figure">{fmtC(heat.range[0], 0)}</span>
        <span className="h-2.5 w-40 rounded-full border border-rule" style={{ background: gradient }} aria-hidden />
        <span className="figure">{fmtC(heat.range[1], 0)}</span>
        <span>Temperatura de la superficie · misma escala para ambos años · transparente: nubes</span>
      </div>
    );
  }
  const lim = heat.delta_range ?? 1;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-2">
      <span className="figure">{signedC(-lim, 0)}</span>
      <span className="h-2.5 w-40 rounded-full border border-rule" style={{ background: gradient }} aria-hidden />
      <span className="figure">{signedC(lim, 0)}</span>
      <span>
        Calentamiento comparado con {phrase(primaryDef(heat))} que se conservó · gris: igual · naranja: se calentó más · morado: menos
      </span>
    </div>
  );
}
