import { useEffect, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import type { ClassifierMetrics as Metrics } from '../types';
import { useMapStats } from '../hooks/useMapStats';
import IndicesPanel from './IndicesPanel';
import ClassifierMetrics from './ClassifierMetrics';

interface GuidedMethodProps {
  sessionId: string;
  sceneInfo: { id: string; datetime: string; cloudCover?: number } | null;
  onOpenExpert: () => void;
}

const pct = (v: number) => `${v.toLocaleString('es-CO', { maximumFractionDigits: 1 })} %`;

/**
 * «Cómo se hizo»: lo que el modo experto muestra en los pasos 1–4 (imagen,
 * índices y modelo), con los parámetros que el modo guiado eligió solo.
 */
export default function GuidedMethod({ sessionId, sceneInfo, onOpenExpert }: GuidedMethodProps) {
  const stats = useMapStats(sessionId, 'method');
  const [metrics, setMetrics] = useState<Metrics | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/classifier/metrics?session_id=${sessionId}`)
      .then(r => (r.ok ? r.json() : null))
      .then((m: Metrics | null) => alive && setMetrics(m))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [sessionId]);

  const worldcover = (metrics?.method ?? stats?.scheme) === 'worldcover';

  return (
    <div className="space-y-10">
      {/* Parámetros elegidos automáticamente */}
      <section className="space-y-3" aria-labelledby="auto-title">
        <h2 id="auto-title" className="font-serif text-xl font-semibold">Lo que se eligió automáticamente</h2>
        <dl className="sheet grid sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-rule text-sm">
          {[
            ['Imagen', sceneInfo ? sceneInfo.datetime.slice(0, 10) : '—', 'Sentinel-2 L2A, la más despejada del último año'],
            ['Nubes en la zona', stats?.cloud_fraction != null ? pct(stats.cloud_fraction * 100) : '—', 'Píxeles enmascarados con la capa SCL'],
            ['Ejemplos del modelo', worldcover ? 'ESA WorldCover 2021' : 'Reglas del curso', worldcover ? '5 clases, incluido urbano' : '3 clases por umbrales'],
            ['Comparación', '10 años, misma temporada', '±60 días alrededor de la fecha de la imagen'],
          ].map(([label, value, hint]) => (
            <div key={label} className="px-4 py-3">
              <dt className="text-ink-2">{label}</dt>
              <dd className="figure font-bold text-base mt-0.5">{value}</dd>
              <dd className="text-muted mt-0.5">{hint}</dd>
            </div>
          ))}
        </dl>
        <button onClick={onOpenExpert} className="btn btn-secondary">
          Cambiar estos parámetros en modo experto <ArrowRight className="w-4 h-4" />
        </button>
      </section>

      {/* Índices (paso 3 del experto) */}
      {sceneInfo && (
        <section className="space-y-3" aria-labelledby="indices-title">
          <div className="max-w-[70ch]">
            <h2 id="indices-title" className="font-serif text-xl font-semibold">La imagen y sus índices espectrales</h2>
            <p className="text-ink-2 mt-1">
              Cada índice combina bandas de luz para resaltar algo: vegetación, agua, suelo desnudo o construcciones. El modelo los usa,
              junto con las nueve bandas, para reconocer cada cobertura.
            </p>
          </div>
          <IndicesPanel sessionId={sessionId} sceneInfo={sceneInfo} />
        </section>
      )}

      {/* Modelo (paso 4 del experto) */}
      <section className="space-y-3" aria-labelledby="model-title">
        <div className="max-w-[70ch]">
          <h2 id="model-title" className="font-serif text-xl font-semibold">El modelo y qué tan bien acierta</h2>
          <p className="text-ink-2 mt-1">
            Un Random Forest aprende la firma de cada cobertura con{' '}
            {worldcover ? 'ejemplos del mapa ESA WorldCover 2021' : 'ejemplos etiquetados por umbrales espectrales'} y luego clasifica
            cada píxel de 10 × 10 m de esta imagen y de los años anteriores. Se valida con un 25 % de ejemplos que el modelo no vio.
          </p>
        </div>
        {metrics ? <ClassifierMetrics metrics={metrics} /> : <p className="text-sm text-muted">Cargando métricas…</p>}
      </section>
    </div>
  );
}
