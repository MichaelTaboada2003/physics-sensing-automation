export interface StreamLine {
  stage: string;
  progress: number;
  message: string;
  error?: string;
  // optional fields depending on operation
  scene_id?: string;
  oob_score?: number;
  map_id?: string;
  cloud_fraction?: number;
  metrics?: ClassifierMetrics;
  comparison?: ComparisonSummary;
  series?: TimeSeries;
}

export interface SearchRequest {
  bbox: [number, number, number, number]; // [lon_min, lat_min, lon_max, lat_max]
  time_range: string;                     // "YYYY-MM-DD/YYYY-MM-DD"
  cloud_cover_threshold: number;          // integer [0, 100]
}

export type BBox = [number, number, number, number];

export interface SceneCandidate {
  id: string;
  datetime: string;
  cloud_cover: number;        // % de nubes del tile completo
  local_cloud: number | null; // % de nubes/sombras (SCL) dentro de la zona
  platform: string;
}

export interface ScenesResponse {
  search_id: string;
  scenes: SceneCandidate[];
}

export interface SearchResponse {
  session_id: string;
  scene_id: string;
  datetime: string;
  cloud_cover: number;
}

export interface ThresholdPreviewRequest {
  session_id: string;
  ndvi_veg_min: number;
  bsi_veg_max: number;
  ndwi_water_min: number;
  ndvi_water_max: number;
  bsi_mining_min: number;
  ndvi_mining_max: number;
}

export interface ThresholdPreviewResponse {
  total_valid: number;
  vegetation: number;
  water: number;
  mining: number;
  ambiguous: number; // cumplen 2+ reglas → descartados
}

export interface TrainRequest {
  session_id: string;
  ndvi_veg_min: number;
  bsi_veg_max: number;
  ndwi_water_min: number;
  ndvi_water_max: number;
  bsi_mining_min: number;
  ndvi_mining_max: number;
}

export interface PredictRequest {
  session_id: string;
}

export interface ClassStat {
  pixels: number;
  hectares: number;
  percent: number;
  percent_clear: number | null; // % del área sin nubes
}

export type ClassKey = 'vegetation' | 'water' | 'mining' | 'unclassified';

export interface SceneMeta {
  id: string;
  datetime: string;
  cloud_cover: number;
  local_cloud?: number | null;
}

export interface ComparisonSummary {
  year: number;
  past_scene: SceneMeta;
  current_scene: SceneMeta;
  pixel_area_m2: number;
  past: Record<ClassKey, ClassStat>;
  current: Record<ClassKey, ClassStat>;
  transitions: number[][]; // filas = pasado, columnas = actual (veg, agua, minería, no clasif.)
  changed_percent: number;
  comparable_percent: number;
}

export interface ClassifierMetrics {
  oob_score: number;
  n_train: number;
  n_test: number;
  classes: string[];
  feature_importances: { feature: string; importance: number }[];
  accuracy?: number;
  kappa?: number;
  confusion_matrix?: number[][];
  per_class?: { class: string; precision: number; recall: number; f1: number; support: number }[];
}

/** Pendiente de Theil-Sen + prueba de Mann-Kendall. */
export interface Trend {
  slope: number;        // pp/año (clases) o NDVI/año
  slope_low: number;    // IC 95 %
  slope_high: number;
  tau: number;          // tau de Kendall
  p_value: number;
  significant: boolean; // p < 0.05
  n: number;
  ha_per_year?: number;
  ha_per_year_low?: number;
  ha_per_year_high?: number;
}

export interface SeriesPoint {
  year: number;
  scene: SceneMeta;
  stats: Record<ClassKey, ClassStat>;
  ndvi_mean: number | null;
  clear_percent: number;
}

export interface TimeSeries {
  points: SeriesPoint[];
  trends: Record<'vegetation' | 'water' | 'mining', Trend | null>;
  ndvi_trend: Trend | null;
  total_hectares: number;
  years_used_for_trend: number[];
  failed: { year: number; error: string }[];
}

export type LayerKind = 'rgb' | 'class' | 'ndvi' | 'change';
