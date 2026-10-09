import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Info } from 'lucide-react';
import type { ClassifierMetrics as Metrics } from '../types';

// Tono secuencial (un solo matiz, claro → oscuro) para la matriz de confusión
const cellBg = (share: number) => `rgba(16, 185, 129, ${0.08 + 0.72 * share})`;

const pct = (v?: number) => (v === undefined ? '—' : `${(v * 100).toFixed(1)} %`);

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="bg-black/30 rounded-xl p-4 border border-white/5" title={hint}>
      <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1">{label}</p>
      <p className="text-xl font-mono font-bold text-zinc-100">{value}</p>
    </div>
  );
}

export default function ClassifierMetrics({ metrics }: { metrics: Metrics }) {
  const cm = metrics.confusion_matrix;
  const importances = metrics.feature_importances.slice(0, 10);

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Exactitud (hold-out)" value={pct(metrics.accuracy)} hint="Acierto sobre el 25 % de píxeles reservados" />
        <Stat label="Kappa de Cohen" value={metrics.kappa?.toFixed(3) ?? '—'} hint="Acuerdo corregido por azar (1 = perfecto)" />
        <Stat label="OOB" value={pct(metrics.oob_score)} hint="Out-of-bag: acierto de cada árbol en las muestras que no vio" />
        <Stat
          label="Muestras"
          value={`${metrics.n_train.toLocaleString('es-ES')}`}
          hint={`${metrics.n_train} de entrenamiento · ${metrics.n_test} de validación`}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Confusion matrix */}
        {cm && (
          <div className="bg-black/20 rounded-xl border border-white/5 p-4 overflow-x-auto">
            <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-3">
              Matriz de confusión (filas = pseudo-etiqueta, columnas = predicción)
            </p>
            <table className="w-full text-xs font-mono border-separate border-spacing-0.5">
              <thead>
                <tr>
                  <th />
                  {metrics.classes.map(c => (
                    <th key={c} className="text-zinc-500 font-bold pb-1 font-sans">{c}</th>
                  ))}
                  <th className="text-zinc-500 font-bold pb-1 font-sans">Recall</th>
                </tr>
              </thead>
              <tbody>
                {cm.map((row, i) => {
                  const total = row.reduce((a, b) => a + b, 0) || 1;
                  return (
                    <tr key={i}>
                      <th className="text-left text-zinc-400 font-sans font-bold pr-2">{metrics.classes[i]}</th>
                      {row.map((v, j) => (
                        <td
                          key={j}
                          title={`${metrics.classes[i]} → ${metrics.classes[j]}: ${v} píxeles (${((v / total) * 100).toFixed(1)} %)`}
                          className={`text-center py-2 rounded ${v / total > 0.55 ? 'text-white' : 'text-zinc-300'}`}
                          style={{ background: cellBg(v / total) }}
                        >
                          {v.toLocaleString('es-ES')}
                        </td>
                      ))}
                      <td className="text-center text-zinc-300">{pct(metrics.per_class?.[i]?.recall)}</td>
                    </tr>
                  );
                })}
                <tr>
                  <th className="text-left text-zinc-500 font-sans font-bold pr-2 pt-1">Precisión</th>
                  {metrics.per_class?.map(c => (
                    <td key={c.class} className="text-center text-zinc-300 pt-1">{pct(c.precision)}</td>
                  ))}
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {/* Feature importance */}
        <div className="bg-black/20 rounded-xl border border-white/5 p-4">
          <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-3">
            Importancia de variables (top 10)
          </p>
          <ResponsiveContainer width="100%" height={importances.length * 24 + 10}>
            <BarChart data={importances} layout="vertical" margin={{ left: 0, right: 16, top: 0, bottom: 0 }} barCategoryGap={2}>
              <XAxis type="number" hide domain={[0, 'dataMax']} />
              <YAxis
                type="category"
                dataKey="feature"
                width={56}
                tickLine={false}
                axisLine={false}
                tick={{ fill: '#a1a1aa', fontSize: 11, fontFamily: 'monospace' }}
              />
              <Tooltip
                cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                contentStyle={{ background: '#18181b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }}
                labelStyle={{ color: '#e4e4e7' }}
                itemStyle={{ color: '#d4d4d8' }}
                formatter={(v) => [`${(Number(v) * 100).toFixed(1)} %`, 'Importancia']}
              />
              <Bar dataKey="importance" fill="#10b981" radius={[0, 4, 4, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <p className="flex items-start gap-2 text-xs text-zinc-500">
        <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
        La validación mide el acuerdo con las pseudo-etiquetas generadas por umbrales, no con datos de campo:
        valores cercanos al 100 % indican que el modelo reproduce las reglas, no que el mapa sea perfecto.
      </p>
    </div>
  );
}
