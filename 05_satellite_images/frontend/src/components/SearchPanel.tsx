import { useState } from 'react';
import { Search, AlertCircle, Loader2, MapPin, Calendar, Cloud, Images, ArrowRight } from 'lucide-react';
import type { BBox, SceneCandidate, ScenesResponse, SearchResponse } from '../types';
import { MAX_AREA_KM2, PRESETS, bboxInRegion, bboxIsTooLarge } from '../lib/geo';
import type { Region } from '../lib/geo';
import { useRegion } from '../hooks/useRegion';
import AoiMap from './map/AoiMap';
import ScenePicker from './ScenePicker';

// ── Constants ──────────────────────────────────────────────────────────────────

const API_BASE = '';

const DEFAULT_BBOX: BBox = PRESETS[0].bbox;
const LAST_YEAR = new Date().getFullYear() - 1;
const DEFAULT_DATE_START = `${LAST_YEAR}-01-01`;
const DEFAULT_DATE_END = `${LAST_YEAR}-12-31`;
// El umbral filtra por nubosidad del tile completo; las escenas se ordenan luego
// por nubosidad dentro de la zona, así que conviene un umbral permisivo.
const DEFAULT_CLOUD = 60;

// ── Validation helpers ─────────────────────────────────────────────────────────

function isValidDate(str: string): boolean {
  // Must match YYYY-MM-DD exactly
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
  const d = new Date(str + 'T00:00:00');
  if (isNaN(d.getTime())) return false;
  // Verify the date components round-trip (catches Feb 30, etc.)
  const [y, m, day] = str.split('-').map(Number);
  return d.getFullYear() === y && d.getMonth() + 1 === m && d.getDate() === day;
}

interface ValidationErrors {
  lonMin?: string;
  latMin?: string;
  lonMax?: string;
  latMax?: string;
  bboxRelation?: string;
  dateStart?: string;
  dateEnd?: string;
  dateRelation?: string;
  cloud?: string;
}

function validateForm(
  lonMin: string,
  latMin: string,
  lonMax: string,
  latMax: string,
  dateStart: string,
  dateEnd: string,
  cloud: string,
  region: Region | null = null,
): ValidationErrors {
  const errors: ValidationErrors = {};

  const lonMinN = parseFloat(lonMin);
  const latMinN = parseFloat(latMin);
  const lonMaxN = parseFloat(lonMax);
  const latMaxN = parseFloat(latMax);

  // Bbox coordinate range checks (R1.5)
  if (isNaN(lonMinN) || lonMinN < -180 || lonMinN > 180)
    errors.lonMin = 'Longitud mínima debe estar en [-180, 180]';
  if (isNaN(latMinN) || latMinN < -90 || latMinN > 90)
    errors.latMin = 'Latitud mínima debe estar en [-90, 90]';
  if (isNaN(lonMaxN) || lonMaxN < -180 || lonMaxN > 180)
    errors.lonMax = 'Longitud máxima debe estar en [-180, 180]';
  if (isNaN(latMaxN) || latMaxN < -90 || latMaxN > 90)
    errors.latMax = 'Latitud máxima debe estar en [-90, 90]';

  // Bbox relational checks (R1.5)
  if (!errors.lonMin && !errors.lonMax && lonMinN >= lonMaxN)
    errors.bboxRelation = 'lon_min debe ser menor que lon_max';
  if (!errors.latMin && !errors.latMax && latMinN >= latMaxN) {
    errors.bboxRelation = errors.bboxRelation
      ? errors.bboxRelation + ' y lat_min debe ser menor que lat_max'
      : 'lat_min debe ser menor que lat_max';
  }

  if (!errors.lonMin && !errors.lonMax && !errors.latMin && !errors.latMax && !errors.bboxRelation
      && bboxIsTooLarge([lonMinN, latMinN, lonMaxN, latMaxN]))
    errors.bboxRelation = `La zona supera el máximo de ${MAX_AREA_KM2} km²`;
  else if (region && !errors.lonMin && !errors.lonMax && !errors.latMin && !errors.latMax && !errors.bboxRelation
      && !bboxInRegion([lonMinN, latMinN, lonMaxN, latMaxN], region))
    errors.bboxRelation = `La zona debe estar en ${region.name}`;

  // Date format and validity checks (R1.6)
  if (!isValidDate(dateStart))
    errors.dateStart = 'Fecha de inicio inválida (formato YYYY-MM-DD)';
  if (!isValidDate(dateEnd))
    errors.dateEnd = 'Fecha de fin inválida (formato YYYY-MM-DD)';

  // Date relational check (R1.6)
  if (!errors.dateStart && !errors.dateEnd && dateStart > dateEnd)
    errors.dateRelation = 'La fecha de inicio no puede ser posterior a la fecha de fin';

  // Cloud cover check (R1.7)
  const cloudN = Number(cloud);
  if (!Number.isInteger(cloudN) || cloudN < 0 || cloudN > 100 || cloud.trim() === '')
    errors.cloud = 'El umbral de nubes debe ser un entero entre 0 y 100';

  return errors;
}

// ── Small components ───────────────────────────────────────────────────────────

function ErrorMsg({ msg }: { msg?: string }) {
  return msg ? (
    <p className="mt-1.5 flex items-center gap-1.5 text-xs text-red-400 font-medium">
      <AlertCircle className="w-3 h-3 flex-shrink-0" />
      {msg}
    </p>
  ) : null;
}

// ── Props ──────────────────────────────────────────────────────────────────────

interface SearchPanelProps {
  onSearchComplete: (response: SearchResponse) => void;
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function SearchPanel({ onSearchComplete }: SearchPanelProps) {
  const region = useRegion();
  // Form state
  const [lonMin, setLonMin] = useState(DEFAULT_BBOX[0].toString());
  const [latMin, setLatMin] = useState(DEFAULT_BBOX[1].toString());
  const [lonMax, setLonMax] = useState(DEFAULT_BBOX[2].toString());
  const [latMax, setLatMax] = useState(DEFAULT_BBOX[3].toString());
  const [dateStart, setDateStart] = useState(DEFAULT_DATE_START);
  const [dateEnd, setDateEnd] = useState(DEFAULT_DATE_END);
  const [cloud, setCloud] = useState(DEFAULT_CLOUD.toString());

  // UI state
  const [errors, setErrors] = useState<ValidationErrors>({});
  const [touched, setTouched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<{ searchId: string; scenes: SceneCandidate[] } | null>(null);
  const [selectedId, setSelectedId] = useState<string>('');
  const [confirming, setConfirming] = useState(false);

  const currentBBox = (): BBox | null => {
    const b = [lonMin, latMin, lonMax, latMax].map(parseFloat) as BBox;
    return b.some(isNaN) || b[0] >= b[2] || b[1] >= b[3] ? null : b;
  };

  const setBBox = (b: BBox) => {
    const [w, s_, e, n] = b.map(String);
    setLonMin(w); setLatMin(s_); setLonMax(e); setLatMax(n);
    setCandidates(null);
    revalidate({ lonMin: w, latMin: s_, lonMax: e, latMax: n });
  };

  const requestBody = () => ({
    bbox: [parseFloat(lonMin), parseFloat(latMin), parseFloat(lonMax), parseFloat(latMax)] as BBox,
    time_range: `${dateStart}/${dateEnd}`,
    cloud_cover_threshold: parseInt(cloud, 10),
  });

  const describeError = async (res: Response) => {
    const data = await res.json().catch(() => ({}));
    const detail = data?.detail ?? `Error ${res.status}`;
    // Errores de validación de FastAPI: lista de {msg}
    if (Array.isArray(detail)) {
      return detail.map((d: { msg?: string }) => (d.msg ?? '').replace(/^Value error, /, '')).join(' · ');
    }
    if (res.status === 404) return `${detail} — Intenta ampliar el rango de fechas o el umbral de nubes.`;
    if (res.status === 502) return 'El catálogo de Planetary Computer no está disponible temporalmente. Intenta de nuevo.';
    return typeof detail === 'string' ? detail : JSON.stringify(detail);
  };

  // ── Handlers ────────────────────────────────────────────────────────────────

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    setApiError(null);

    const validationErrors = validateForm(lonMin, latMin, lonMax, latMax, dateStart, dateEnd, cloud, region);
    setErrors(validationErrors);

    if (Object.keys(validationErrors).length > 0) return;

    setLoading(true);
    setCandidates(null);
    try {
      const res = await fetch(`${API_BASE}/scenes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody()),
      });
      if (!res.ok) {
        setApiError(await describeError(res));
        return;
      }
      const data: ScenesResponse = await res.json();
      setCandidates({ searchId: data.search_id, scenes: data.scenes });
      setSelectedId(data.scenes[0]?.id ?? '');
    } catch (err: unknown) {
      setApiError(err instanceof Error ? err.message : 'Error de red al conectar con el servidor.');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = async () => {
    if (!candidates || !selectedId) return;
    setConfirming(true);
    setApiError(null);
    try {
      const res = await fetch(`${API_BASE}/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...requestBody(), search_id: candidates.searchId, scene_id: selectedId }),
      });
      if (!res.ok) {
        setApiError(await describeError(res));
        return;
      }
      const data: SearchResponse = await res.json();
      onSearchComplete(data);
    } catch (err: unknown) {
      setApiError(err instanceof Error ? err.message : 'Error de red al conectar con el servidor.');
    } finally {
      setConfirming(false);
    }
  };

  // Re-validate on change if the form has been submitted once
  const revalidate = (
    overrides: Partial<{
      lonMin: string; latMin: string; lonMax: string; latMax: string;
      dateStart: string; dateEnd: string; cloud: string;
    }>
  ) => {
    if (!touched) return;
    setErrors(validateForm(
      overrides.lonMin ?? lonMin,
      overrides.latMin ?? latMin,
      overrides.lonMax ?? lonMax,
      overrides.latMax ?? latMax,
      overrides.dateStart ?? dateStart,
      overrides.dateEnd ?? dateEnd,
      overrides.cloud ?? cloud,
      region,
    ));
  };

  // ── Render helpers ───────────────────────────────────────────────────────────

  const hasErrors = Object.keys(errors).length > 0;

  const inputClass = (hasError: boolean) =>
    `w-full bg-zinc-900/60 border ${
      hasError ? 'border-red-500/60 focus:border-red-500' : 'border-white/10 focus:border-emerald-500/50'
    } rounded-xl px-4 py-3 text-sm outline-none transition-all font-mono text-zinc-200 placeholder-zinc-600`;


  // ── JSX ──────────────────────────────────────────────────────────────────────

  return (
    <div className="w-full max-w-4xl mx-auto animate-fade-in">
      <form onSubmit={handleSubmit} noValidate className="space-y-6">

        {/* ── Bounding Box ── */}
        <div className="bg-zinc-900/40 rounded-2xl border border-white/5 p-6">
          <div className="flex items-center gap-3 mb-5">
            <div className="p-2 bg-emerald-500/10 rounded-lg border border-emerald-500/20">
              <MapPin className="w-4 h-4 text-emerald-500" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-zinc-200">Zona de interés</h3>
              <p className="text-xs text-zinc-500">Dibuja un rectángulo, elige una zona de ejemplo o edita las coordenadas EPSG:4326</p>
            </div>
          </div>

          <AoiMap bbox={currentBBox()} onChange={setBBox} />

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-5">
            {/* lon_min */}
            <div>
              <label className="block text-xs font-bold text-zinc-500 mb-2 uppercase tracking-widest">
                lon_min
              </label>
              <input
                type="number"
                step="any"
                value={lonMin}
                onChange={e => { setLonMin(e.target.value); revalidate({ lonMin: e.target.value }); }}
                className={inputClass(!!errors.lonMin)}
                placeholder="-180 … 180"
              />
              <ErrorMsg msg={errors.lonMin} />
            </div>

            {/* lat_min */}
            <div>
              <label className="block text-xs font-bold text-zinc-500 mb-2 uppercase tracking-widest">
                lat_min
              </label>
              <input
                type="number"
                step="any"
                value={latMin}
                onChange={e => { setLatMin(e.target.value); revalidate({ latMin: e.target.value }); }}
                className={inputClass(!!errors.latMin)}
                placeholder="-90 … 90"
              />
              <ErrorMsg msg={errors.latMin} />
            </div>

            {/* lon_max */}
            <div>
              <label className="block text-xs font-bold text-zinc-500 mb-2 uppercase tracking-widest">
                lon_max
              </label>
              <input
                type="number"
                step="any"
                value={lonMax}
                onChange={e => { setLonMax(e.target.value); revalidate({ lonMax: e.target.value }); }}
                className={inputClass(!!errors.lonMax)}
                placeholder="-180 … 180"
              />
              <ErrorMsg msg={errors.lonMax} />
            </div>

            {/* lat_max */}
            <div>
              <label className="block text-xs font-bold text-zinc-500 mb-2 uppercase tracking-widest">
                lat_max
              </label>
              <input
                type="number"
                step="any"
                value={latMax}
                onChange={e => { setLatMax(e.target.value); revalidate({ latMax: e.target.value }); }}
                className={inputClass(!!errors.latMax)}
                placeholder="-90 … 90"
              />
              <ErrorMsg msg={errors.latMax} />
            </div>
          </div>

          {/* Relational bbox error */}
          {errors.bboxRelation && (
            <p className="mt-3 flex items-center gap-1.5 text-xs text-red-400 font-medium">
              <AlertCircle className="w-3 h-3 flex-shrink-0" />
              {errors.bboxRelation}
            </p>
          )}
        </div>

        {/* ── Time Range ── */}
        <div className="bg-zinc-900/40 rounded-2xl border border-white/5 p-6">
          <div className="flex items-center gap-3 mb-5">
            <div className="p-2 bg-blue-500/10 rounded-lg border border-blue-500/20">
              <Calendar className="w-4 h-4 text-blue-400" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-zinc-200">Rango Temporal</h3>
              <p className="text-xs text-zinc-500">Formato YYYY-MM-DD</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* Date start */}
            <div>
              <label className="block text-xs font-bold text-zinc-500 mb-2 uppercase tracking-widest">
                Fecha inicio
              </label>
              <input
                type="date"
                value={dateStart}
                onChange={e => { setDateStart(e.target.value); setCandidates(null); revalidate({ dateStart: e.target.value }); }}
                className={inputClass(!!errors.dateStart)}
              />
              <ErrorMsg msg={errors.dateStart} />
            </div>

            {/* Date end */}
            <div>
              <label className="block text-xs font-bold text-zinc-500 mb-2 uppercase tracking-widest">
                Fecha fin
              </label>
              <input
                type="date"
                value={dateEnd}
                onChange={e => { setDateEnd(e.target.value); setCandidates(null); revalidate({ dateEnd: e.target.value }); }}
                className={inputClass(!!errors.dateEnd)}
              />
              <ErrorMsg msg={errors.dateEnd} />
            </div>
          </div>

          {/* Relational date error */}
          {errors.dateRelation && (
            <p className="mt-3 flex items-center gap-1.5 text-xs text-red-400 font-medium">
              <AlertCircle className="w-3 h-3 flex-shrink-0" />
              {errors.dateRelation}
            </p>
          )}
        </div>

        {/* ── Cloud Cover ── */}
        <div className="bg-zinc-900/40 rounded-2xl border border-white/5 p-6">
          <div className="flex items-center gap-3 mb-5">
            <div className="p-2 bg-zinc-500/10 rounded-lg border border-zinc-500/20">
              <Cloud className="w-4 h-4 text-zinc-400" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-zinc-200">Umbral de Nubosidad</h3>
              <p className="text-xs text-zinc-500">
                Máximo de nubes del tile completo [0–100]. Luego se ordenan por nubes dentro de tu zona.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={parseInt(cloud) || 0}
              onChange={e => { setCloud(e.target.value); setCandidates(null); revalidate({ cloud: e.target.value }); }}
              className="flex-1 h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-emerald-500"
            />
            <input
              type="number"
              min={0}
              max={100}
              step={1}
              value={cloud}
              onChange={e => { setCloud(e.target.value); setCandidates(null); revalidate({ cloud: e.target.value }); }}
              className={`w-20 text-center ${inputClass(!!errors.cloud)}`}
              placeholder="0–100"
            />
          </div>
          <ErrorMsg msg={errors.cloud} />
        </div>

        {/* ── API error ── */}
        {apiError && (
          <div className="flex items-start gap-3 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">
            <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-400 font-medium">{apiError}</p>
          </div>
        )}

        {/* ── Validation summary (only shown after first submit attempt) ── */}
        {touched && hasErrors && (
          <div className="flex items-center gap-2 text-xs text-amber-400 font-medium">
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
            Corrige los errores indicados antes de enviar.
          </div>
        )}

        {/* ── Submit button ── */}
        <button
          type="submit"
          disabled={loading}
          className={`w-full py-4 rounded-2xl font-bold text-base transition-all shadow-lg flex items-center justify-center gap-3 ${
            loading
              ? 'bg-zinc-800 cursor-wait text-zinc-500'
              : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-600/20 active:scale-[0.98]'
          }`}
        >
          {loading ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              Buscando escenas y midiendo nubes en tu zona…
            </>
          ) : (
            <>
              <Search className="w-5 h-5" />
              Buscar escenas Sentinel-2
            </>
          )}
        </button>
      </form>

      {/* ── Scene picker ── */}
      {candidates && !loading && (
        <div className="mt-6 bg-zinc-900/40 border border-white/5 rounded-2xl p-6 space-y-5 animate-fade-in">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-500/10 rounded-lg border border-emerald-500/20">
              <Images className="w-4 h-4 text-emerald-500" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-zinc-200">
                {candidates.scenes.length} escenas candidatas
              </h3>
              <p className="text-xs text-zinc-500">
                Ordenadas por nubes dentro de tu zona (capa SCL). Elige la que prefieras.
              </p>
            </div>
          </div>

          <ScenePicker
            searchId={candidates.searchId}
            scenes={candidates.scenes}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />

          <button
            type="button"
            onClick={handleConfirm}
            disabled={!selectedId || confirming}
            className="w-full py-4 rounded-2xl font-bold text-base transition-all shadow-lg flex items-center justify-center gap-3 bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-600/20 active:scale-[0.98] disabled:opacity-60 disabled:cursor-wait"
          >
            {confirming ? <Loader2 className="w-5 h-5 animate-spin" /> : <ArrowRight className="w-5 h-5" />}
            Usar escena del {candidates.scenes.find(c => c.id === selectedId)?.datetime.slice(0, 10)}
          </button>
        </div>
      )}
    </div>
  );
}
