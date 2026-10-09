import { useState } from 'react';
import { Search, Layers, BarChart2, Cpu, Map, History, ChevronRight, Satellite } from 'lucide-react';
import type { SearchResponse, StreamLine } from './types';
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
  sessionId: string | null;
  sceneInfo: { id: string; datetime: string; cloudCover: number } | null;
  streamLogs: StreamLine[];
  errorMsg: string;
  loading: boolean;
  mapReady: boolean;
}

// ── Step definitions ───────────────────────────────────────────────────────────

const STEPS = [
  { id: 1 as AppStep, label: 'Búsqueda',   icon: Search   },
  { id: 2 as AppStep, label: 'Bandas',     icon: Layers   },
  { id: 3 as AppStep, label: 'Índices',    icon: BarChart2 },
  { id: 4 as AppStep, label: 'Clasificar', icon: Cpu      },
  { id: 5 as AppStep, label: 'Mapa',       icon: Map      },
  { id: 6 as AppStep, label: 'Comparar',   icon: History  },
];

// ── App ────────────────────────────────────────────────────────────────────────

function App() {
  const [state, setState] = useState<AppState>({
    step: 1,
    sessionId: null,
    sceneInfo: null,
    streamLogs: [],
    errorMsg: '',
    loading: false,
    mapReady: false,
  });

  const setStep = (step: AppStep) => setState(prev => ({ ...prev, step }));

  const handleReset = () => {
    setState({
      step: 1,
      sessionId: null,
      sceneInfo: null,
      streamLogs: [],
      errorMsg: '',
      loading: false,
      mapReady: false,
    });
  };

  // A step is accessible if it has been reached (sessionId unlocks steps 2+)
  const isStepAccessible = (stepId: AppStep): boolean => {
    if (stepId === 1) return true;
    // La comparativa necesita el mapa clasificado actual
    if (stepId === 6) return state.mapReady;
    return state.sessionId !== null;
  };

  const handleSearchComplete = (response: SearchResponse) => {
    setState(prev => ({
      ...prev,
      sessionId: response.session_id,
      sceneInfo: {
        id: response.scene_id,
        datetime: response.datetime,
        cloudCover: response.cloud_cover,
      },
      step: 2,
    }));
  };

  return (
    <div className="min-h-screen p-4 md:p-8">
      {/* ── Header ── */}
      <header className="max-w-7xl mx-auto mb-12 flex flex-col md:flex-row items-center justify-between gap-8 animate-fade-in">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-emerald-500/10 rounded-2xl border border-emerald-500/20">
            <Satellite className="w-8 h-8 text-emerald-500" />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight accent-gradient-text">
              Imágenes Satelitales
            </h1>
            <p className="text-zinc-500 font-medium">
              Cobertura terrestre de Colombia con Sentinel-2 y Random Forest
            </p>
          </div>
        </div>

        {/* ── Stepper nav ── */}
        <nav className="flex items-center gap-2 bg-zinc-900/40 p-2 rounded-2xl border border-white/5">
          {STEPS.map((s, i) => (
            <div key={s.id} className="flex items-center">
              <button
                onClick={() => isStepAccessible(s.id) && setStep(s.id)}
                disabled={!isStepAccessible(s.id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl transition-all duration-300 ${
                  state.step === s.id
                    ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-600/20'
                    : isStepAccessible(s.id)
                    ? 'text-zinc-400 hover:text-zinc-200 hover:bg-white/5 cursor-pointer'
                    : 'text-zinc-700 cursor-not-allowed'
                }`}
              >
                <s.icon className="w-4 h-4" />
                <span className="text-sm font-semibold hidden lg:block">{s.label}</span>
              </button>
              {i < STEPS.length - 1 && (
                <ChevronRight className="w-4 h-4 text-zinc-700 mx-1 hidden lg:block" />
              )}
            </div>
          ))}
        </nav>
      </header>

      {/* ── Main panels ── */}
      <main className="max-w-7xl mx-auto">

        {/* Step 1 — Búsqueda */}
        {state.step === 1 && (
          <div className="glass-panel p-8 md:p-12 animate-fade-in">
            <div className="flex flex-col items-center mb-10">
              <div className="w-20 h-20 bg-emerald-500/10 rounded-3xl flex items-center justify-center mb-6 border border-emerald-500/20">
                <Search className="w-9 h-9 text-emerald-500" />
              </div>
              <h2 className="text-3xl font-bold mb-3">Configurar Consulta STAC</h2>
              <p className="text-zinc-400 max-w-sm text-center leading-relaxed text-sm">
                Elige una zona de Colombia en el mapa y el rango temporal; luego escoge entre
                las escenas Sentinel-2 con menos nubes sobre tu zona.
              </p>
            </div>
            <SearchPanel onSearchComplete={handleSearchComplete} />
          </div>
        )}

        {/* Step 2 — Bandas */}
        {state.step === 2 && state.sessionId && state.sceneInfo && (
          <div className="glass-panel p-8 md:p-12 animate-fade-in">
            <div className="flex flex-col items-center mb-10">
              <div className="w-20 h-20 bg-blue-500/10 rounded-3xl flex items-center justify-center mb-6 border border-blue-500/20">
                <Layers className="w-9 h-9 text-blue-500" />
              </div>
              <h2 className="text-3xl font-bold mb-3">Descarga de Bandas</h2>
              <p className="text-zinc-400 max-w-sm text-center leading-relaxed text-sm">
                Descarga 9 bandas espectrales y la máscara de nubes (SCL), convertidas a
                reflectancia de superficie y alineadas en una grilla de 10 m.
              </p>
            </div>
            <BandsPanel
              sessionId={state.sessionId}
              sceneInfo={state.sceneInfo}
              onComplete={() => setStep(3)}
            />
          </div>
        )}

        {/* Step 3 — Índices */}
        {state.step === 3 && state.sessionId && state.sceneInfo && (
          <div className="glass-panel p-8 md:p-12 animate-fade-in">
            <div className="flex flex-col items-center mb-10">
              <div className="w-20 h-20 bg-yellow-500/10 rounded-3xl flex items-center justify-center mb-6 border border-yellow-500/20">
                <BarChart2 className="w-9 h-9 text-yellow-500" />
              </div>
              <h2 className="text-3xl font-bold mb-3">Índices Espectrales</h2>
              <p className="text-zinc-400 max-w-sm text-center leading-relaxed text-sm">
                Explora 7 índices (NDVI, BSI, NDWI, MNDWI, NDBI, EVI, SAVI) para interpretar
                la vegetación, el suelo expuesto y el agua. Las nubes quedan en gris.
              </p>
            </div>
            <IndicesPanel
              sessionId={state.sessionId}
              sceneInfo={state.sceneInfo}
              onComplete={() => setStep(4)}
            />
          </div>
        )}

        {/* Step 4 — Clasificar */}
        {state.step === 4 && state.sessionId && (
          <div className="glass-panel p-8 md:p-12 animate-fade-in">
            <div className="flex flex-col items-center mb-10">
              <div className="w-20 h-20 bg-purple-500/10 rounded-3xl flex items-center justify-center mb-6 border border-purple-500/20">
                <Cpu className="w-9 h-9 text-purple-500" />
              </div>
              <h2 className="text-3xl font-bold mb-3">Entrenamiento del Clasificador</h2>
              <p className="text-zinc-400 max-w-sm text-center leading-relaxed text-sm">
                Ajusta los umbrales de pseudo-etiquetado y entrena el modelo Random Forest
                para clasificar la cobertura terrestre.
              </p>
            </div>
            <ClassifierPanel
              sessionId={state.sessionId}
              onComplete={() => setState(prev => ({ ...prev, step: 5, mapReady: true }))}
            />
          </div>
        )}

        {/* Step 5 — Mapa */}
        {state.step === 5 && state.sessionId && (
          <div className="glass-panel p-8 md:p-12 animate-fade-in">
            <div className="flex flex-col items-center mb-10">
              <div className="w-20 h-20 bg-teal-500/10 rounded-3xl flex items-center justify-center mb-6 border border-teal-500/20">
                <Map className="w-9 h-9 text-teal-500" />
              </div>
              <h2 className="text-3xl font-bold mb-3">Mapa Clasificado</h2>
              <p className="text-zinc-400 max-w-sm text-center leading-relaxed text-sm">
                Visualiza y exporta el mapa de clasificación con las clases Vegetación,
                Agua, Minería/Suelo expuesto y No clasificado.
              </p>
            </div>
            <MapPanel
              sessionId={state.sessionId}
              onReset={handleReset}
              onCompare={() => setStep(6)}
            />
          </div>
        )}

        {/* Step 6 — Comparativa temporal */}
        {state.step === 6 && state.sessionId && state.sceneInfo && (
          <div className="glass-panel p-8 md:p-12 animate-fade-in">
            <div className="flex flex-col items-center mb-10">
              <div className="w-20 h-20 bg-orange-500/10 rounded-3xl flex items-center justify-center mb-6 border border-orange-500/20">
                <History className="w-9 h-9 text-orange-500" />
              </div>
              <h2 className="text-3xl font-bold mb-3">Comparativa Temporal</h2>
              <p className="text-zinc-400 max-w-sm text-center leading-relaxed text-sm">
                Compara con cualquier año de la última década o calcula la serie completa
                con tendencias, sobre el mapa y con exportación.
              </p>
            </div>
            <ComparePanel
              sessionId={state.sessionId}
              sceneYear={new Date(state.sceneInfo.datetime).getUTCFullYear()}
            />
          </div>
        )}

      </main>
    </div>
  );
}

export default App;
