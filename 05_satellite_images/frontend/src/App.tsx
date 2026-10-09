import { useState } from 'react';
import { Check, Lock, RotateCcw } from 'lucide-react';
import type { SearchResponse, Zone } from './types';
import SearchPanel from './components/SearchPanel';
import BandsPanel from './components/BandsPanel';
import IndicesPanel from './components/IndicesPanel';
import ClassifierPanel from './components/ClassifierPanel';
import MapPanel from './components/MapPanel';
import ComparePanel from './components/ComparePanel';

// ── Types ──────────────────────────────────────────────────────────────────────

type AppStep = 1 | 2 | 3 | 4 | 5 | 6;

interface AppState {
  step: AppStep;
  /** Paso más avanzado alcanzado: los anteriores se marcan como listos. */
  reached: AppStep;
  sessionId: string | null;
  sceneInfo: { id: string; datetime: string; cloudCover: number } | null;
  mapReady: boolean;
  zone: Zone | null;
}

const INITIAL_STATE: AppState = {
  step: 1,
  reached: 1,
  sessionId: null,
  sceneInfo: null,
  mapReady: false,
  zone: null,
};

// ── Step definitions ───────────────────────────────────────────────────────────

const STEPS: { id: AppStep; label: string; title: string; purpose: string }[] = [
  {
    id: 1, label: 'Zona y escena', title: 'Zona y escena',
    purpose: 'Elige un lugar de Colombia y la imagen Sentinel-2 con menos nubes sobre él.',
  },
  {
    id: 2, label: 'Bandas', title: 'Descarga de bandas',
    purpose: 'Nueve bandas espectrales y la máscara de nubes, en reflectancia de superficie a 10 m.',
  },
  {
    id: 3, label: 'Índices', title: 'Índices espectrales',
    purpose: 'Siete índices para leer vegetación, agua y suelo expuesto. Las nubes quedan en gris.',
  },
  {
    id: 4, label: 'Clasificar', title: 'Clasificador',
    purpose: 'Reglas de pseudo-etiquetado y un Random Forest que clasifica cada píxel.',
  },
  {
    id: 5, label: 'Mapa', title: 'Mapa de cobertura',
    purpose: 'La clasificación sobre la imagen satelital, lista para exportar.',
  },
  {
    id: 6, label: 'Comparar', title: 'Comparativa temporal',
    purpose: 'La misma zona hasta 10 años atrás, con tendencias y su significancia.',
  },
];

// ── App ────────────────────────────────────────────────────────────────────────

function App() {
  const [state, setState] = useState<AppState>(INITIAL_STATE);

  const goTo = (step: AppStep) =>
    setState(prev => ({ ...prev, step, reached: (Math.max(prev.reached, step) as AppStep) }));

  const handleReset = () => setState(INITIAL_STATE);

  const isStepAccessible = (stepId: AppStep): boolean => {
    if (stepId === 1) return true;
    // La comparativa necesita el mapa clasificado actual
    if (stepId === 6) return state.mapReady;
    return state.sessionId !== null;
  };

  const handleSearchComplete = (response: SearchResponse, zone: Zone) => {
    setState(prev => ({
      ...prev,
      sessionId: response.session_id,
      sceneInfo: {
        id: response.scene_id,
        datetime: response.datetime,
        cloudCover: response.cloud_cover,
      },
      zone,
      mapReady: false,
      step: 2,
      reached: 2,
    }));
  };

  const current = STEPS[state.step - 1];

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[248px_1fr]">
      {/* ── Riel: carpeta de género ── */}
      <aside className="bg-folder text-folder-ink lg:sticky lg:top-0 lg:h-dvh flex flex-col">
        <div className="px-5 pt-5 pb-4 lg:pt-7 lg:pb-6 flex items-baseline justify-between gap-3 lg:block">
          <div>
            <p className="font-serif text-xl font-semibold leading-tight">Imágenes Satelitales</p>
            <p className="text-sm text-folder-muted mt-0.5">Cobertura terrestre · Colombia</p>
          </div>
        </div>

        <nav aria-label="Pasos del análisis" className="px-3 lg:flex-1 overflow-x-auto lg:overflow-visible">
          <ol className="flex lg:flex-col gap-1 pb-3 lg:pb-0">
            {STEPS.map(s => {
              const accessible = isStepAccessible(s.id);
              const active = state.step === s.id;
              const done = s.id < state.reached && accessible && !active;
              return (
                <li key={s.id} className="shrink-0">
                  <button
                    onClick={() => accessible && goTo(s.id)}
                    disabled={!accessible}
                    aria-current={active ? 'step' : undefined}
                    className={`w-full flex items-center gap-3 rounded-[5px] px-2.5 py-2 text-left transition-colors ${
                      active
                        ? 'bg-paper text-ink'
                        : accessible
                        ? 'hover:bg-folder-2 text-folder-ink'
                        : 'text-folder-muted/60 cursor-not-allowed'
                    }`}
                  >
                    <span
                      className={`figure grid place-items-center w-7 h-7 rounded-full text-sm font-bold shrink-0 border ${
                        active
                          ? 'bg-stamp text-white border-stamp'
                          : done
                          ? 'bg-folder-ink text-folder border-folder-ink'
                          : 'border-folder-muted/50'
                      }`}
                      aria-hidden
                    >
                      {done ? <Check className="w-3.5 h-3.5" strokeWidth={3} /> : s.id}
                    </span>
                    <span className="text-[0.9375rem] font-semibold whitespace-nowrap">{s.label}</span>
                    {!accessible && <Lock className="w-3.5 h-3.5 ml-auto hidden lg:block" aria-label="bloqueado" />}
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>

        {state.sceneInfo && (
          <div className="hidden lg:block mx-3 mb-4 p-3 rounded-[5px] border border-folder-2 text-sm">
            <p className="text-folder-muted">Escena</p>
            <p className="figure text-folder-ink mt-0.5">{state.sceneInfo.datetime.slice(0, 10)}</p>
            <button
              onClick={handleReset}
              className="mt-3 inline-flex items-center gap-1.5 text-folder-ink/90 hover:text-white font-semibold"
            >
              <RotateCcw className="w-3.5 h-3.5" /> Nuevo análisis
            </button>
          </div>
        )}
      </aside>

      {/* ── Área de trabajo ── */}
      <main className="min-w-0 px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
        <header className="mb-6 lg:mb-8 max-w-6xl">
          <h1 className="font-serif text-[1.75rem] sm:text-[2rem] font-semibold leading-tight">{current.title}</h1>
          <p className="text-ink-2 mt-1.5 max-w-[65ch]">{current.purpose}</p>
        </header>

        <div key={state.step} className="max-w-6xl animate-fade-in">
          {state.step === 1 && <SearchPanel onSearchComplete={handleSearchComplete} />}

          {state.step === 2 && state.sessionId && state.sceneInfo && (
            <BandsPanel sessionId={state.sessionId} sceneInfo={state.sceneInfo} onComplete={() => goTo(3)} />
          )}

          {state.step === 3 && state.sessionId && state.sceneInfo && (
            <IndicesPanel sessionId={state.sessionId} sceneInfo={state.sceneInfo} onComplete={() => goTo(4)} />
          )}

          {state.step === 4 && state.sessionId && (
            <ClassifierPanel
              sessionId={state.sessionId}
              onComplete={() => setState(prev => ({ ...prev, step: 5, reached: 5, mapReady: true }))}
            />
          )}

          {state.step === 5 && state.sessionId && (
            <MapPanel sessionId={state.sessionId} onReset={handleReset} onCompare={() => goTo(6)} />
          )}

          {state.step === 6 && state.sessionId && state.sceneInfo && (
            <ComparePanel
              sessionId={state.sessionId}
              sceneYear={new Date(state.sceneInfo.datetime).getUTCFullYear()}
            />
          )}
        </div>
      </main>
    </div>
  );
}

export default App;
