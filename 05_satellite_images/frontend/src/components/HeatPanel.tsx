import { useEffect, useState } from 'react';
import { Loader2, Thermometer } from 'lucide-react';
import type { HeatSummary, StreamLine } from '../types';
import { useProgressStream } from '../hooks/useProgressStream';
import { useLayerBounds } from '../hooks/useLayerBounds';
import { heatYears } from '../lib/heat';
import TaskProgress from './TaskProgress';
import type { TaskStatus } from './TaskProgress';
import HeatMap from './heat/HeatMap';
import { DeforestationHeadline, HeatByClassTable, HeatNotes } from './heat/HeatFindings';

interface HeatPanelProps {
  sessionId: string;
  sceneYear: number;
}

/** Recupera el último análisis de calor de la sesión (al volver a este paso). */
async function fetchExisting(sessionId: string): Promise<HeatSummary | null> {
  const base = await fetch(`/heat/summary?session_id=${sessionId}`);
  if (!base.ok) return null;
  const summary: HeatSummary = await base.json();
  const past = summary.years.filter(y => y !== summary.year);
  if (!past.length) return summary;
  const withPast = await fetch(`/heat/summary?session_id=${sessionId}&year=${Math.min(...past)}`);
  return withPast.ok ? withPast.json() : summary;
}

export default function HeatPanel({ sessionId, sceneYear }: HeatPanelProps) {
  const years = heatYears(sceneYear);
  const [year, setYear] = useState<number>(years[Math.min(7, years.length - 1)] ?? sceneYear - 1);
  const [status, setStatus] = useState<TaskStatus>('idle');
  const [progress, setProgress] = useState(0);
  const [logs, setLogs] = useState<StreamLine[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [heat, setHeat] = useState<HeatSummary | null>(null);
  const { bounds } = useLayerBounds(sessionId);
  const { consume } = useProgressStream();

  useEffect(() => {
    let alive = true;
    fetchExisting(sessionId).then(h => {
      if (alive && h) {
        setHeat(h);
        if (h.past) setYear(h.past.year);
      }
    }).catch(() => {});
    return () => {
      alive = false;
    };
  }, [sessionId]);

  const run = async () => {
    setStatus('running');
    setProgress(0);
    setLogs([]);
    setErrorMsg(null);
    await consume(
      '/heat',
      'POST',
      JSON.stringify({ session_id: sessionId, year }),
      line => {
        setLogs(prev => [...prev, line]);
        setProgress(line.progress);
      },
      line => {
        setProgress(1);
        setStatus('done');
        if (line.heat) setHeat(line.heat);
      },
      line => {
        setStatus('error');
        setErrorMsg(line.error ?? line.message);
      },
    );
  };

  return (
    <div className="space-y-6">
      <section className="sheet p-4 space-y-3" aria-labelledby="heat-year-title">
        <div>
          <h2 id="heat-year-title" className="font-serif text-xl font-semibold">
            Año a comparar con <span className="figure">{sceneYear}</span>
          </h2>
          <p className="text-sm text-ink-2 mt-1 max-w-[70ch]">
            Sentinel-2 no mide calor; la temperatura viene de Landsat 8/9, en la misma temporada. Si el año aún no se clasificó, se clasifica
            con el mismo modelo para saber dónde se perdió bosque o vegetación.
          </p>
        </div>
        <div className="segmented flex-wrap" role="group" aria-label="Año">
          {years.map(y => (
            <button
              key={y}
              type="button"
              aria-pressed={year === y}
              onClick={() => setYear(y)}
              disabled={status === 'running'}
              className="figure relative"
            >
              {y}
              {heat?.years.includes(y) && (
                <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-stamp" aria-label="calculado" />
              )}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button onClick={run} disabled={status === 'running'} className="btn btn-primary">
            {status === 'running' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Thermometer className="w-4 h-4" />}
            Medir calor <span className="figure">{year}</span> y <span className="figure">{sceneYear}</span>
          </button>
          <p className="text-sm text-muted">Landsat 8 empezó en 2013. Tarda unos 30 s por año nuevo.</p>
        </div>
      </section>

      <TaskProgress
        status={status}
        progress={progress}
        lines={logs}
        error={errorMsg}
        titles={{ running: 'Midiendo la temperatura…', done: 'Temperatura lista', error: 'No se pudo medir la temperatura' }}
      />

      {heat && (
        <div className="space-y-6 animate-fade-in">
          <DeforestationHeadline heat={heat} />
          {bounds && <HeatMap key={`${heat.year}-${heat.past?.year}`} sessionId={sessionId} heat={heat} bounds={bounds} />}
          {heat.by_class.length > 0 && (
            <section className="space-y-3" aria-labelledby="heat-class-title">
              <h2 id="heat-class-title" className="font-serif text-xl font-semibold">
                Temperatura por cobertura en <span className="figure">{heat.year}</span>
              </h2>
              <HeatByClassTable heat={heat} />
            </section>
          )}
          <HeatNotes heat={heat} />
        </div>
      )}
    </div>
  );
}
