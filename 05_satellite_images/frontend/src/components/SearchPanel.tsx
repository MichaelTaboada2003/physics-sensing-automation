import { useState } from 'react';
import { Search, AlertCircle, Loader2, ArrowRight } from 'lucide-react';
import type { BBox, SceneCandidate, ScenesResponse, SearchResponse, Zone } from '../types';
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
    <p className="mt-1 flex items-center gap-1.5 text-sm text-signal font-semibold">
      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
      {msg}
    </p>
  ) : null;
}

// ── Props ──────────────────────────────────────────────────────────────────────

interface SearchPanelProps {
  onSearchComplete: (response: SearchResponse, zone: Zone) => void;
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
  const [zoneName, setZoneName] = useState<string>(PRESETS[0].name);
  const [focus, setFocus] = useState<{ bbox: BBox; n: number } | undefined>(undefined);

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
      onSearchComplete(data, { name: zoneName, bbox: requestBody().bbox });
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
  const startYear = dateStart.slice(0, 4);
  const isFullYear = dateStart.endsWith('-01-01') && dateEnd === `${startYear}-12-31`;
  const selectedYear = isFullYear ? Number(startYear) : null;

  const pickYear = (y: number) => {
    setDateStart(`${y}-01-01`);
    setDateEnd(`${y}-12-31`);
    setCandidates(null);
    revalidate({ dateStart: `${y}-01-01`, dateEnd: `${y}-12-31` });
  };

  const pickPreset = (p: (typeof PRESETS)[number]) => {
    setBBox(p.bbox);
    setZoneName(p.name);
    setFocus(f => ({ bbox: p.bbox, n: (f?.n ?? 0) + 1 }));
  };

  const selected = candidates?.scenes.find(c => c.id === selectedId);

  // ── JSX ──────────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      <form onSubmit={handleSubmit} noValidate className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] items-start">

        {/* ── Mapa ── */}
        <div className="min-w-0">
          <AoiMap
            bbox={currentBBox()}
            onChange={b => { setBBox(b); setZoneName('Zona personalizada'); }}
            focus={focus}
          />
          {errors.bboxRelation && (
            <p className="mt-2 flex items-center gap-1.5 text-sm text-signal font-semibold">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {errors.bboxRelation}
            </p>
          )}

          <details className="mt-3 group">
            <summary className="cursor-pointer text-sm font-semibold text-ink-2 hover:text-ink select-none">
              Coordenadas exactas (EPSG:4326)
            </summary>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
              {([
                ['lonMin', 'Longitud oeste', lonMin, setLonMin],
                ['latMin', 'Latitud sur', latMin, setLatMin],
                ['lonMax', 'Longitud este', lonMax, setLonMax],
                ['latMax', 'Latitud norte', latMax, setLatMax],
              ] as const).map(([key, label, value, setter]) => (
                <div key={key}>
                  <label className="field-label mb-1" htmlFor={key}>{label}</label>
                  <input
                    id={key}
                    type="number"
                    step="any"
                    value={value}
                    aria-invalid={!!errors[key]}
                    onChange={e => {
                      setter(e.target.value);
                      setCandidates(null);
                      setZoneName('Zona personalizada');
                      revalidate({ [key]: e.target.value });
                    }}
                    className="field figure"
                  />
                  <ErrorMsg msg={errors[key]} />
                </div>
              ))}
            </div>
          </details>
        </div>

        {/* ── Columna de parámetros ── */}
        <div className="space-y-5">
          <fieldset>
            <legend className="field-label mb-2">Zonas de ejemplo</legend>
            <ul className="sheet divide-y divide-rule overflow-hidden">
              {PRESETS.map(p => {
                const active = zoneName === p.name;
                return (
                  <li key={p.name}>
                    <button
                      type="button"
                      onClick={() => pickPreset(p)}
                      aria-pressed={active}
                      className={`w-full text-left px-3.5 py-2.5 transition-colors ${
                        active ? 'bg-stamp-tint' : 'hover:bg-paper-2'
                      }`}
                    >
                      <span className={`block text-[0.9375rem] font-semibold ${active ? 'text-stamp-2' : 'text-ink'}`}>
                        {p.name}
                      </span>
                      <span className="block text-sm text-muted">{p.description}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </fieldset>

          <fieldset>
            <legend className="field-label mb-2">Año de la imagen</legend>
            <div className="segmented w-full">
              {[0, 1, 2, 3].map(k => {
                const y = LAST_YEAR + 1 - k;
                return (
                  <button
                    key={y}
                    type="button"
                    onClick={() => pickYear(y)}
                    aria-pressed={selectedYear === y}
                    className="figure flex-1"
                  >
                    {y}
                  </button>
                );
              })}
            </div>
            <details className="mt-2" open={!isFullYear}>
              <summary className="cursor-pointer text-sm font-semibold text-ink-2 hover:text-ink select-none">
                Otro rango de fechas
              </summary>
              <div className="grid grid-cols-2 gap-3 mt-2">
                <div>
                  <label className="field-label mb-1" htmlFor="date-start">Desde</label>
                  <input
                    id="date-start"
                    type="date"
                    value={dateStart}
                    aria-invalid={!!errors.dateStart}
                    onChange={e => { setDateStart(e.target.value); setCandidates(null); revalidate({ dateStart: e.target.value }); }}
                    className="field figure"
                  />
                  <ErrorMsg msg={errors.dateStart} />
                </div>
                <div>
                  <label className="field-label mb-1" htmlFor="date-end">Hasta</label>
                  <input
                    id="date-end"
                    type="date"
                    value={dateEnd}
                    aria-invalid={!!errors.dateEnd}
                    onChange={e => { setDateEnd(e.target.value); setCandidates(null); revalidate({ dateEnd: e.target.value }); }}
                    className="field figure"
                  />
                  <ErrorMsg msg={errors.dateEnd} />
                </div>
              </div>
              <ErrorMsg msg={errors.dateRelation} />
            </details>
          </fieldset>

          <div>
            <div className="flex items-baseline justify-between">
              <label className="field-label" htmlFor="cloud">Nubes máximas en el tile</label>
              <span className="figure text-sm font-bold">{cloud} %</span>
            </div>
            <input
              id="cloud"
              type="range"
              min={0}
              max={100}
              step={5}
              value={parseInt(cloud) || 0}
              onChange={e => { setCloud(e.target.value); setCandidates(null); revalidate({ cloud: e.target.value }); }}
              className="w-full mt-2"
            />
            <p className="text-sm text-muted mt-1">
              Es un filtro amplio: después ordenamos las escenas por las nubes que hay dentro de tu zona.
            </p>
            <ErrorMsg msg={errors.cloud} />
          </div>

          {apiError && (
            <p role="alert" className="flex items-start gap-2 text-sm text-signal bg-signal-tint border border-signal/30 rounded-[4px] px-3 py-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              {apiError}
            </p>
          )}
          {touched && hasErrors && !apiError && (
            <p className="text-sm text-signal font-semibold">Corrige los campos marcados para continuar.</p>
          )}

          <button type="submit" disabled={loading} className="btn btn-primary w-full">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            {loading ? 'Midiendo nubes en tu zona…' : 'Buscar escenas'}
          </button>
        </div>
      </form>

      {/* ── Selector de escena ── */}
      {candidates && !loading && (
        <section aria-labelledby="scenes-title" className="space-y-4 animate-fade-in">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 id="scenes-title" className="font-serif text-xl font-semibold">
                <span className="figure">{candidates.scenes.length}</span> escenas para {zoneName}
              </h2>
              <p className="text-sm text-muted">Ordenadas por nubes dentro de la zona. La primera es la más despejada.</p>
            </div>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={!selectedId || confirming}
              className="btn btn-primary"
            >
              {confirming ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
              Usar la escena del <span className="figure">{selected?.datetime.slice(0, 10)}</span>
            </button>
          </div>
          <ScenePicker
            searchId={candidates.searchId}
            scenes={candidates.scenes}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        </section>
      )}
    </div>
  );
}
