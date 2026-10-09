import { useState, useCallback } from 'react';
import { Eye, Play, Map as MapIcon, Loader2 } from 'lucide-react';
import type { ClassifierMetrics as Metrics, StreamLine, ThresholdPreviewResponse } from '../types';
import ClassifierMetrics from './ClassifierMetrics';
import { useProgressStream } from '../hooks/useProgressStream';
import TaskProgress from './TaskProgress';
import { DEFAULT_THRESHOLDS } from '../lib/classifier';

// ── Constants ──────────────────────────────────────────────────────────────────

const API_BASE = '';


// ── Types ──────────────────────────────────────────────────────────────────────

type ThresholdKey = keyof typeof DEFAULT_THRESHOLDS;

type StepStatus   = 'idle' | 'running' | 'done' | 'error';

interface ClassifierPanelProps {
  sessionId: string;
  onComplete: () => void;
}

// Reglas tal como las aplica el backend: comparaciones estrictas (core/classifier.py)
const RULES: {
  cls: 'vegetation' | 'water' | 'mining';
  label: string;
  swatch: string;
  a: { index: string; key: ThresholdKey };
  b: { index: string; key: ThresholdKey };
}[] = [
  { cls: 'vegetation', label: 'Vegetación', swatch: 'bg-veg',
    a: { index: 'NDVI', key: 'ndvi_veg_min' }, b: { index: 'BSI', key: 'bsi_veg_max' } },
  { cls: 'water', label: 'Agua', swatch: 'bg-water',
    a: { index: 'NDWI', key: 'ndwi_water_min' }, b: { index: 'NDVI', key: 'ndvi_water_max' } },
  { cls: 'mining', label: 'Suelo / minería', swatch: 'bg-soil',
    a: { index: 'BSI', key: 'bsi_mining_min' }, b: { index: 'NDVI', key: 'ndvi_mining_max' } },
];

const THRESHOLD_KEYS = RULES.flatMap(r => [r.a.key, r.b.key]);

// ── Helpers ────────────────────────────────────────────────────────────────────

function parseThreshold(raw: string): number | null {
  const n = parseFloat(raw);
  if (isNaN(n)) return null;
  if (n < -1.0 || n > 1.0) return null;
  return n;
}

function formatThreshold(n: number): string {
  return n.toFixed(2);
}

/** Map HTTP status codes to user-friendly messages */
function httpErrorMessage(status: number): string {
  switch (status) {
    case 400: return 'Umbrales inválidos: verifica que todos los valores estén en el rango [-1.0, 1.0].';
    case 404: return 'Sesión no encontrada o expirada. Vuelve al paso 1 para iniciar una nueva búsqueda.';
    case 409: return 'El clasificador no ha sido entrenado. Entrena el modelo antes de predecir.';
    case 422: return 'Ninguna clase obtuvo píxeles con estos umbrales. Amplía los rangos e intenta de nuevo.';
    default:  return `Error del servidor (HTTP ${status}). Intenta de nuevo.`;
  }
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function ClassifierPanel({ sessionId, onComplete }: ClassifierPanelProps) {
  // ── Threshold inputs ─────────────────────────────────────────────────────────
  const [rawValues, setRawValues] = useState<Record<ThresholdKey, string>>(() =>
    Object.fromEntries(
      Object.entries(DEFAULT_THRESHOLDS).map(([k, v]) => [k, formatThreshold(v)])
    ) as Record<ThresholdKey, string>
  );
  const [inputErrors, setInputErrors] = useState<Partial<Record<ThresholdKey, string>>>({});

  // ── Preview state ─────────────────────────────────────────────────────────────
  const [previewStatus, setPreviewStatus] = useState<StepStatus>('idle');
  const [previewResult, setPreviewResult] = useState<ThresholdPreviewResponse | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // ── Train state ───────────────────────────────────────────────────────────────
  const [trainStatus, setTrainStatus] = useState<StepStatus>('idle');
  const [trainProgress, setTrainProgress] = useState(0);
  const [trainLogs, setTrainLogs] = useState<StreamLine[]>([]);
  const [trainError, setTrainError] = useState<string | null>(null);
  const [oobScore, setOobScore] = useState<number | null>(null);
  const [metrics, setMetrics] = useState<Metrics | null>(null);

  // ── Predict state ─────────────────────────────────────────────────────────────
  const [predictStatus, setPredictStatus] = useState<StepStatus>('idle');
  const [predictProgress, setPredictProgress] = useState(0);
  const [predictLogs, setPredictLogs] = useState<StreamLine[]>([]);
  const [predictError, setPredictError] = useState<string | null>(null);

  const { consume } = useProgressStream();

  // ── Derived state ─────────────────────────────────────────────────────────────
  const canPreview  = previewStatus !== 'running';
  const canTrain    = previewStatus === 'done' && trainStatus !== 'running';
  const canPredict  = trainStatus === 'done' && predictStatus !== 'running';

  // ── Input handling ────────────────────────────────────────────────────────────

  const handleInputChange = (key: ThresholdKey, value: string) => {
    setRawValues(prev => ({ ...prev, [key]: value }));
    // Clear error on change
    setInputErrors(prev => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  /** Validate all inputs and return parsed values, or null if any are invalid */
  const validateThresholds = (): Record<ThresholdKey, number> | null => {
    const errors: Partial<Record<ThresholdKey, string>> = {};
    const parsed: Partial<Record<ThresholdKey, number>> = {};

    for (const key of THRESHOLD_KEYS) {
      const n = parseThreshold(rawValues[key]);
      if (n === null) {
        errors[key] = 'Valor inválido. Rango: [-1.0, 1.0]';
      } else {
        parsed[key] = n;
      }
    }

    if (Object.keys(errors).length > 0) {
      setInputErrors(errors);
      return null;
    }

    return parsed as Record<ThresholdKey, number>;
  };

  // ── Preview handler ───────────────────────────────────────────────────────────

  const handlePreview = async () => {
    const thresholds = validateThresholds();
    if (!thresholds) return;

    setPreviewStatus('running');
    setPreviewResult(null);
    setPreviewError(null);

    try {
      const response = await fetch(`${API_BASE}/thresholds/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId, ...thresholds }),
      });

      if (!response.ok) {
        setPreviewError(httpErrorMessage(response.status));
        setPreviewStatus('error');
        return;
      }

      const data = (await response.json()) as ThresholdPreviewResponse;
      setPreviewResult(data);
      setPreviewStatus('done');
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : 'Error de red al conectar con el servidor.');
      setPreviewStatus('error');
    }
  };

  // ── Train handler ─────────────────────────────────────────────────────────────

  const appendTrainLog = useCallback((line: StreamLine) => {
    setTrainLogs(prev => [...prev, line]);
  }, []);

  const handleTrain = async () => {
    const thresholds = validateThresholds();
    if (!thresholds) return;

    setTrainStatus('running');
    setTrainProgress(0);
    setTrainLogs([]);
    setTrainError(null);
    setOobScore(null);
    setMetrics(null);

    await consume(
      `${API_BASE}/train`,
      'POST',
      JSON.stringify({ session_id: sessionId, ...thresholds }),
      // onLine
      (line) => {
        appendTrainLog(line);
        setTrainProgress(line.progress);
      },
      // onDone
      (line) => {
        setTrainProgress(1);
        setTrainStatus('done');
        if (line.oob_score !== undefined) {
          setOobScore(line.oob_score);
        }
        if (line.metrics) setMetrics(line.metrics);
      },
      // onError
      (line) => {
        setTrainStatus('error');
        setTrainError(line.error ?? line.message);
      },
    );
  };

  // ── Predict handler ───────────────────────────────────────────────────────────

  const appendPredictLog = useCallback((line: StreamLine) => {
    setPredictLogs(prev => [...prev, line]);
  }, []);

  const handlePredict = async () => {
    setPredictStatus('running');
    setPredictProgress(0);
    setPredictLogs([]);
    setPredictError(null);

    await consume(
      `${API_BASE}/predict`,
      'POST',
      JSON.stringify({ session_id: sessionId }),
      // onLine
      (line) => {
        appendPredictLog(line);
        setPredictProgress(line.progress);
      },
      // onDone
      () => {
        setPredictProgress(1);
        setPredictStatus('done');
        onComplete();
      },
      // onError
      (line) => {
        setPredictStatus('error');
        setPredictError(line.error ?? line.message);
      },
    );
  };

  // ── Render ────────────────────────────────────────────────────────────────────

  const ruleInput = (key: ThresholdKey, label: string) => (
    <span className="inline-flex flex-col">
      <label className="sr-only" htmlFor={key}>{label}</label>
      <input
        id={key}
        type="number"
        step={0.01}
        min={-1}
        max={1}
        value={rawValues[key]}
        onChange={e => handleInputChange(key, e.target.value)}
        aria-invalid={!!inputErrors[key]}
        className="field figure !w-[5.5rem] !py-1.5 text-center"
      />
    </span>
  );

  const counts: Record<string, number | undefined> = {
    vegetation: previewResult?.vegetation,
    water: previewResult?.water,
    mining: previewResult?.mining,
  };

  return (
    <div className="space-y-6">
      {/* ── Reglas de pseudo-etiquetado ── */}
      <section className="sheet" aria-labelledby="rules-title">
        <div className="px-4 pt-4 pb-3 border-b border-rule">
          <h2 id="rules-title" className="font-serif text-xl font-semibold">Reglas de etiquetado</h2>
          <p className="text-sm text-ink-2 mt-1 max-w-[70ch]">
            Los píxeles que cumplen exactamente una regla sirven de ejemplo para entrenar el modelo; los que
            cumplen varias se descartan por ambiguos. Valores entre −1 y 1.
          </p>
        </div>
        <ul className="divide-y divide-rule">
          {RULES.map(rule => (
            <li key={rule.cls} className="px-4 py-3 flex flex-wrap items-center gap-x-3 gap-y-2">
              <span className="flex items-center gap-2 w-40 font-semibold">
                <span className={`w-3 h-3 rounded-[2px] ${rule.swatch}`} aria-hidden />
                {rule.label}
              </span>
              <span className="flex flex-wrap items-center gap-2 text-ink-2">
                si <span className="figure font-bold text-ink">{rule.a.index}</span> &gt; {ruleInput(rule.a.key, `${rule.label}: ${rule.a.index} mínimo`)}
                y <span className="figure font-bold text-ink">{rule.b.index}</span> &lt; {ruleInput(rule.b.key, `${rule.label}: ${rule.b.index} máximo`)}
              </span>
              <span className="ml-auto text-sm text-right" aria-live="polite">
                {counts[rule.cls] !== undefined && (
                  <><span className="figure font-bold">{counts[rule.cls]!.toLocaleString('es-CO')}</span> <span className="text-muted">píxeles</span></>
                )}
              </span>
              {(inputErrors[rule.a.key] || inputErrors[rule.b.key]) && (
                <p className="w-full text-sm text-signal font-semibold">Usa valores entre −1 y 1 con hasta dos decimales.</p>
              )}
            </li>
          ))}
        </ul>
        <div className="px-4 py-3 border-t border-rule bg-paper-2 flex flex-wrap items-center gap-3">
          <button onClick={handlePreview} disabled={!canPreview} className="btn btn-secondary">
            {previewStatus === 'running' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />}
            Contar píxeles
          </button>
          {previewResult && (
            <p className="text-sm text-ink-2">
              De <span className="figure">{previewResult.total_valid.toLocaleString('es-CO')}</span> píxeles despejados
              {previewResult.ambiguous > 0 && (
                <>; <span className="figure">{previewResult.ambiguous.toLocaleString('es-CO')}</span> ambiguos descartados (p. ej. ríos con sedimento)</>
              )}.
            </p>
          )}
          {previewStatus === 'error' && previewError && (
            <p role="alert" className="text-sm text-signal">{previewError}</p>
          )}
        </div>
      </section>

      {/* ── Entrenar ── */}
      <section className="space-y-4" aria-labelledby="train-title">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="train-title" className="font-serif text-xl font-semibold">Entrenar el Random Forest</h2>
            <p className="text-sm text-ink-2 mt-1">150 árboles sobre 16 variables (7 índices y 9 bandas), validado con un 25 % reservado.</p>
          </div>
          <button onClick={handleTrain} disabled={!canTrain} className="btn btn-primary">
            {trainStatus === 'running' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            {trainStatus === 'done' ? 'Volver a entrenar' : 'Entrenar modelo'}
          </button>
        </div>
        {previewStatus !== 'done' && trainStatus === 'idle' && (
          <p className="text-sm text-muted">Primero cuenta los píxeles para revisar que cada clase tenga ejemplos.</p>
        )}
        <TaskProgress
          status={trainStatus}
          progress={trainProgress}
          lines={trainLogs}
          error={trainError}
          titles={{ running: 'Entrenando el modelo…', done: 'Modelo entrenado', error: 'No se pudo entrenar el modelo' }}
        />
        {trainStatus === 'done' && metrics && <ClassifierMetrics metrics={metrics} />}
        {trainStatus === 'done' && !metrics && oobScore !== null && (
          <p className="text-sm">OOB <span className="figure font-bold">{(oobScore * 100).toFixed(2)} %</span></p>
        )}
      </section>

      {/* ── Clasificar ── */}
      <section className="space-y-4 border-t border-rule pt-6" aria-labelledby="predict-title">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="predict-title" className="font-serif text-xl font-semibold">Clasificar la escena</h2>
            <p className="text-sm text-ink-2 mt-1">Aplica el modelo a todos los píxeles despejados y abre el mapa.</p>
          </div>
          <button onClick={handlePredict} disabled={!canPredict} className="btn btn-primary">
            {predictStatus === 'running' ? <Loader2 className="w-4 h-4 animate-spin" /> : <MapIcon className="w-4 h-4" />}
            Clasificar y ver el mapa
          </button>
        </div>
        <TaskProgress
          status={predictStatus}
          progress={predictProgress}
          lines={predictLogs}
          error={predictError}
          titles={{ running: 'Clasificando píxeles…', done: 'Mapa listo', error: 'No se pudo clasificar la escena' }}
        />
      </section>
    </div>
  );
}
