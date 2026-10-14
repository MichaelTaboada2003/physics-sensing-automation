import { useState } from 'react';
import type { LatLngBoundsExpression } from 'leaflet';
import type { HeatSummary } from '../../types';
import SwipeMap from '../map/SwipeMap';
import { phrase } from '../../lib/classes';
import { primaryDef } from '../../lib/heat';
import HeatLegend from './HeatLegend';
import type { HeatLayer } from './HeatLegend';

interface HeatMapProps {
  sessionId: string;
  heat: HeatSummary;
  bounds: LatLngBoundsExpression;
  height?: string;
}

/** Temperatura antes/después con cortina, o el calentamiento relativo en una sola capa. */
export default function HeatMap({ sessionId, heat, bounds, height = 'h-[440px] lg:h-[600px]' }: HeatMapProps) {
  const past = heat.past?.year;
  const [kind, setKind] = useState<HeatLayer>(past ? 'delta' : 'lst');
  const [opacity, setOpacity] = useState(0.9);
  const url = (k: HeatLayer, year?: number) =>
    `/heat/layer?session_id=${sessionId}&kind=${k}${year ? `&year=${year}` : ''}&v=${heat.years.join('-')}`;

  return (
    <section className="sheet overflow-hidden" aria-label="Mapa de temperatura">
      <div className="p-3 border-b border-rule bg-paper-2 space-y-2.5">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          {past && (
            <div className="segmented" role="group" aria-label="Capa de calor">
              <button type="button" onClick={() => setKind('delta')} aria-pressed={kind === 'delta'}>
                Calentamiento
              </button>
              <button type="button" onClick={() => setKind('lst')} aria-pressed={kind === 'lst'}>
                Temperatura
              </button>
            </div>
          )}
          <label className="flex items-center gap-3 text-sm text-ink-2 sm:ml-auto">
            Opacidad
            <input type="range" min={0} max={1} step={0.05} value={opacity} onChange={e => setOpacity(Number(e.target.value))} className="w-32" />
            <span className="figure w-14 text-right whitespace-nowrap">{Math.round(opacity * 100)} %</span>
          </label>
        </div>
        <HeatLegend kind={kind} heat={heat} />
      </div>
      {kind === 'lst' ? (
        <SwipeMap
          bounds={bounds}
          before={past ? { url: url('lst', past), label: String(past) } : undefined}
          after={{ url: url('lst'), label: String(heat.year) }}
          opacity={opacity}
          height={height}
        />
      ) : (
        <SwipeMap bounds={bounds} after={{ url: url('delta', past), label: 'Calentamiento' }} opacity={opacity} height={height} />
      )}
      <p className="px-4 py-2.5 border-t border-rule text-sm text-ink-2">
        {kind === 'delta' ? (
          <>
            Cuánto cambió la temperatura entre <span className="figure">{past}</span> y <span className="figure">{heat.year}</span> en cada
            lugar, comparado con {phrase(primaryDef(heat))} que se conservó. Las manchas naranjas suelen coincidir con claros nuevos.
          </>
        ) : past ? (
          <>
            Arrastra el divisor: a la izquierda <span className="figure">{past}</span>, a la derecha <span className="figure">{heat.year}</span>. Cada
            fecha tuvo su propio clima; compara los contrastes dentro de la imagen, no el tono general.
          </>
        ) : (
          'Más oscuro, más caliente.'
        )}
      </p>
    </section>
  );
}
