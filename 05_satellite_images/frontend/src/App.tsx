import { useState } from 'react';
import { Check, Lock, RotateCcw } from 'lucide-react';
import type { SearchResponse, Zone } from './types';
import SearchPanel from './components/SearchPanel';
import BandsPanel from './components/BandsPanel';
import IndicesPanel from './components/IndicesPanel';
import ClassifierPanel from './components/ClassifierPanel';
import MapPanel from './components/MapPanel';
import ComparePanel from './components/ComparePanel';
import SpecimenLabel from './components/SpecimenLabel';
import { useMapStats } from './hooks/useMapStats';
import GuidedFlow from './components/GuidedFlow';
import type { GuidedStage } from './components/GuidedFlow';

// ── Types ──────────────────────────────────────────────────────────────────────

type AppStep = 1 | 2 | 3 | 4 | 5 | 6;
type Mode = 'guided' | 'expert';

const MODE_KEY = 'satelite05.mode';

// Preferencia de modo por navegador; si el almacenamiento falla, modo guiado
function loadMode(): Mode {
  try {
    return localStorage.getItem(MODE_KEY) === 'expert' ? 'expert' : 'guided';
  } catch {
    return 'guided';
  }
}

function saveMode(m: Mode) {
  try {
    localStorage.setItem(MODE_KEY, m);
  } catch {
    /* sin almacenamiento: la preferencia no persiste */
  }
}

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

const GUIDED_STAGES: { id: GuidedStage; label: string; title: string; purpose: string }[] = [
  {
    id: 'zone', label: 'Elegir zona', title: '¿Qué cambió en este lugar?',
    purpose: 'Elige una zona de Colombia y revisamos cómo cambió su vegetación en los últimos 10 años.',
  },
  {
    id: 'running', label: 'Análisis', title: 'Analizando la zona',
    purpose: 'Descargamos imágenes de satélite, aprendemos a reconocer la cobertura y la comparamos año por año.',
  },
  {
    id: 'results', label: 'Resultados', title: 'Resultados',
    purpose: 'La tendencia de la vegetación, con su incertidumbre, y el material listo para publicar.',
  },
];

// ── App ────────────────────────────────────────────────────────────────────────

function App() {
  const [state, setState] = useState<AppState>(INITIAL_STATE);
  const [bandsTick, setBandsTick] = useState(0);
  const [mode, setModeState] = useState<Mode>(loadMode);
  const [guidedStage, setGuidedStage] = useState<GuidedStage>('zone');

  const setMode = (m: Mode) => {
    setModeState(m);
    saveMode(m);
  };

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

  const guided = mode === 'guided';
  const current = guided ? GUIDED_STAGES.find(g => g.id === guidedStage)! : STEPS[state.step - 1];
  // La etiqueta se actualiza al cambiar de paso (nubes tras la descarga, clases tras clasificar)
  const stats = useMapStats(state.sessionId, `${state.step}-${state.mapReady}-${bandsTick}`);
  const showSideLabel = !guided && state.zone && state.step >= 2 && state.step <= 4;

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

        <div className="px-3 pb-3 lg:pb-5">
          <div className="flex p-[3px] rounded-[5px] bg-folder-2" role="group" aria-label="Modo">
            {([['guided', 'Guiado'], ['expert', 'Experto']] as const).map(([m, label]) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                aria-pressed={mode === m}
                className={`flex-1 py-1.5 rounded-[3px] text-sm font-semibold transition-colors ${
                  mode === m ? 'bg-paper text-ink' : 'text-folder-ink hover:text-white'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {guided ? (
          <nav aria-label="Etapas" className="px-3 lg:flex-1 overflow-x-auto lg:overflow-visible">
            <ol className="flex lg:flex-col gap-1 pb-3 lg:pb-0">
              {GUIDED_STAGES.map((g, i) => {
                const idx = GUIDED_STAGES.findIndex(x => x.id === guidedStage);
                const active = g.id === guidedStage;
                const done = i < idx;
                return (
                  <li key={g.id} className="shrink-0">
                    <span
                      aria-current={active ? 'step' : undefined}
                      className={`flex items-center gap-2 lg:gap-3 rounded-[5px] px-2 lg:px-2.5 py-1.5 lg:py-2 ${
                        active ? 'bg-paper text-ink' : done ? 'text-folder-ink' : 'text-folder-muted/70'
                      }`}
                    >
                      <span
                        className={`figure grid place-items-center w-7 h-7 rounded-full text-sm font-bold shrink-0 border ${
                          active ? 'bg-stamp text-white border-stamp' : done ? 'bg-folder-ink text-folder border-folder-ink' : 'border-folder-muted/50'
                        }`}
                        aria-hidden
                      >
                        {done ? <Check className="w-3.5 h-3.5" strokeWidth={3} /> : i + 1}
                      </span>
                      <span className="text-sm lg:text-[0.9375rem] font-semibold whitespace-nowrap">{g.label}</span>
                    </span>
                  </li>
                );
              })}
            </ol>
          </nav>
        ) : (
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
                    className={`w-full flex items-center gap-2 lg:gap-3 rounded-[5px] px-2 lg:px-2.5 py-1.5 lg:py-2 text-left transition-colors ${
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
                    <span className="text-sm lg:text-[0.9375rem] font-semibold whitespace-nowrap">{s.label}</span>
                    {!accessible && <Lock className="w-3.5 h-3.5 ml-auto hidden lg:block" aria-label="bloqueado" />}
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>
        )}

        {!guided && state.sceneInfo && (
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

        <div
          // En modo guiado no se remonta: GuidedFlow guarda el estado del análisis entre etapas
          key={guided ? 'guided' : state.step}
          className={`animate-fade-in ${showSideLabel ? 'max-w-[1400px] grid gap-6 xl:grid-cols-[minmax(0,1fr)_300px] items-start' : 'max-w-6xl'}`}
        >
          {guided && (
            <GuidedFlow
              stage={guidedStage}
              onStage={setGuidedStage}
              onSession={(response, zone) =>
                setState({
                  ...INITIAL_STATE,
                  sessionId: response.session_id,
                  sceneInfo: { id: response.scene_id, datetime: response.datetime, cloudCover: response.cloud_cover },
                  zone,
                  step: 2,
                  reached: 2,
                })}
              onMapReady={() => setState(prev => ({ ...prev, mapReady: true, step: 5, reached: 5 }))}
              onOpenExpert={() => {
                setMode('expert');
                setState(prev => ({ ...prev, step: 6, reached: 6 }));
              }}
              sessionId={state.sessionId}
              zone={state.zone}
              sceneInfo={state.sceneInfo}
            />
          )}
          {showSideLabel && state.zone && (
            <div className="xl:order-2 xl:sticky xl:top-8">
              <SpecimenLabel
                zone={state.zone}
                scene={state.sceneInfo}
                cloudFraction={stats?.cloud_fraction}
                classes={stats?.classes}
              />
            </div>
          )}
          <div className="min-w-0">
          {!guided && state.step === 1 && <SearchPanel onSearchComplete={handleSearchComplete} />}

          {!guided && state.step === 2 && state.sessionId && state.sceneInfo && (
            <BandsPanel
              sessionId={state.sessionId}
              sceneInfo={state.sceneInfo}
              onComplete={() => goTo(3)}
              onDownloaded={() => setBandsTick(t => t + 1)}
            />
          )}

          {!guided && state.step === 3 && state.sessionId && state.sceneInfo && (
            <IndicesPanel sessionId={state.sessionId} sceneInfo={state.sceneInfo} onComplete={() => goTo(4)} />
          )}

          {!guided && state.step === 4 && state.sessionId && (
            <ClassifierPanel
              sessionId={state.sessionId}
              onComplete={() => setState(prev => ({ ...prev, step: 5, reached: 5, mapReady: true }))}
            />
          )}

          {!guided && state.step === 5 && state.sessionId && (
            <MapPanel
              sessionId={state.sessionId}
              zone={state.zone}
              sceneInfo={state.sceneInfo}
              onReset={handleReset}
              onCompare={() => goTo(6)}
            />
          )}

          {!guided && state.step === 6 && state.sessionId && state.sceneInfo && (
            <ComparePanel
              sessionId={state.sessionId}
              sceneYear={new Date(state.sceneInfo.datetime).getUTCFullYear()}
              zone={state.zone}
              sceneInfo={state.sceneInfo}
            />
          )}
          </div>
        </div>
      </main>
    </div>
  );
}

export default App;
