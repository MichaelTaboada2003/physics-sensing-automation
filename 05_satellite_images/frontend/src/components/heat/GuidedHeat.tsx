import { useEffect, useState } from 'react';
import type { LatLngBoundsExpression } from 'leaflet';
import { AlertCircle, Loader2, Thermometer } from 'lucide-react';
import type { HeatSummary } from '../../types';
import { useProgressStream } from '../../hooks/useProgressStream';
import { HEAT_FIRST_YEAR } from '../../lib/heat';
import HeatMap from './HeatMap';
import HeatTimeline from './HeatTimeline';
import { DeforestationHeadline, HeatByClassTable, HeatNotes } from './HeatFindings';

interface GuidedHeatProps {
  sessionId: string;
  /** Año base de la comparación del modo guiado. */
  year: number;
  bounds: LatLngBoundsExpression | null;
}

/** Bloque de calor en los resultados guiados: se pide a demanda (~30 s) y se recupera si ya existe. */
export default function GuidedHeat({ sessionId, year: baseYear, bounds }: GuidedHeatProps) {
  const year = Math.max(baseYear, HEAT_FIRST_YEAR);
  const [heat, setHeat] = useState<HeatSummary | null>(null);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { consume } = useProgressStream();

  useEffect(() => {
    let alive = true;
    fetch(`/heat/summary?session_id=${sessionId}&year=${year}`)
      .then(r => (r.ok ? r.json() : null))
      .then((h: HeatSummary | null) => alive && h && setHeat(h))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [sessionId, year]);

  const run = async () => {
    setRunning(true);
    setError(null);
    await consume(
      '/heat', 'POST', JSON.stringify({ session_id: sessionId, year }),
      l => setMessage(l.message),
      l => {
        if (l.heat) setHeat(l.heat);
        setRunning(false);
      },
      l => {
        setError(l.error ?? l.message);
        setRunning(false);
      },
    );
  };

  return (
    <div className="space-y-6">
      <HeatTimeline key={sessionId} sessionId={sessionId} />
      <details className="sheet p-4">
        <summary className="font-semibold cursor-pointer">Mapas térmicos y contraste espacial entre dos fechas</summary>
    <section className="space-y-4 mt-4" aria-labelledby="guided-heat-title">
      <div className="max-w-[72ch]">
        <h2 id="guided-heat-title" className="font-serif text-xl sm:text-2xl font-semibold flex items-center gap-2">
          <Thermometer className="w-5 h-5 text-ink-2" aria-hidden /> ¿Se calentó la zona?
        </h2>
        {!heat && (
          <p className="mt-1 text-ink-2">
            Con el satélite Landsat medimos la temperatura de la superficie en <span className="figure">{year}</span> y en la escena de referencia, y comparamos
            las zonas que perdieron bosque con las que lo conservaron. Tarda alrededor de medio minuto.
          </p>
        )}
      </div>

      {!heat && (
        <div className="space-y-2">
          <button onClick={run} disabled={running} className="btn btn-primary">
            {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Thermometer className="w-4 h-4" />}
            {running ? 'Midiendo la temperatura…' : 'Medir el calor'}
          </button>
          {running && message && <p className="text-sm text-ink-2" aria-live="polite">{message}</p>}
          {error && (
            <p className="flex items-start gap-2 text-sm text-signal" role="alert">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden /> {error}
            </p>
          )}
        </div>
      )}

      {heat && (
        <div className="space-y-5 animate-fade-in">
          <div className="max-w-[72ch]"><DeforestationHeadline heat={heat} /></div>
          {bounds && <HeatMap sessionId={sessionId} heat={heat} bounds={bounds} height="h-[400px] lg:h-[520px]" />}
          {heat.by_class.length > 0 && (
            <div className="space-y-2">
              <h3 className="font-semibold">Temperatura de la superficie por cobertura</h3>
              <HeatByClassTable heat={heat} />
            </div>
          )}
          <HeatNotes heat={heat} />
        </div>
      )}
    </section>
      </details>
    </div>
  );
}
