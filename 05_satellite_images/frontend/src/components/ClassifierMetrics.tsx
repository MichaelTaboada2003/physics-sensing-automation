import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Info } from 'lucide-react';
import type { ClassifierMetrics as Metrics } from '../types';

// Rampa secuencial de un solo matiz (sello violeta), clara → oscura
const cellBg = (share: number) => `rgb(90 74 156 / ${0.06 + 0.8 * share})`;

const pct = (v?: number) =>
  v === undefined ? '—' : `${(v * 100).toLocaleString('es-CO', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;

export default function ClassifierMetrics({ metrics }: { metrics: Metrics }) {
  const cm = metrics.confusion_matrix;
  const importances = metrics.feature_importances.slice(0, 10);

  return (
    <div className="space-y-4 animate-fade-in">
      <dl className="sheet grid grid-cols-2 sm:grid-cols-4 divide-x divide-y sm:divide-y-0 divide-rule text-sm">
        {[
          ['Exactitud', pct(metrics.accuracy), 'Acierto sobre el 25 % de píxeles reservados'],
          ['Kappa de Cohen', metrics.kappa?.toLocaleString('es-CO', { minimumFractionDigits: 3 }) ?? '—', 'Acuerdo corregido por azar (1 = perfecto)'],
          ['OOB', pct(metrics.oob_score), 'Acierto de cada árbol en las muestras que no vio'],
          ['Muestras', `${metrics.n_train.toLocaleString('es-CO')} + ${metrics.n_test.toLocaleString('es-CO')}`, 'Entrenamiento + validación'],
        ].map(([label, value, hint]) => (
          <div key={label} className="px-4 py-3" title={hint}>
            <dt className="text-ink-2">{label}</dt>
            <dd className="figure font-bold text-base mt-0.5">{value}</dd>
          </div>
        ))}
      </dl>

      <div className="grid gap-4 lg:grid-cols-2">
        {cm && (
          <figure className="sheet p-4 overflow-x-auto">
            <figcaption className="text-sm font-semibold mb-3">
              Matriz de confusión <span className="font-normal text-muted">(filas: etiqueta · columnas: predicción)</span>
            </figcaption>
            <table className="w-full text-sm border-separate border-spacing-[2px]">
              <thead>
                <tr>
                  <th />
                  {metrics.classes.map(c => (
                    <th key={c} scope="col" className="font-semibold text-ink-2 pb-1 text-center">{c}</th>
                  ))}
                  <th scope="col" className="font-semibold text-ink-2 pb-1 text-center">Recall</th>
                </tr>
              </thead>
              <tbody>
                {cm.map((row, i) => {
                  const total = row.reduce((a, b) => a + b, 0) || 1;
                  return (
                    <tr key={i}>
                      <th scope="row" className="text-left font-semibold text-ink-2 pr-2">{metrics.classes[i]}</th>
                      {row.map((v, j) => (
                        <td
                          key={j}
                          title={`${metrics.classes[i]} → ${metrics.classes[j]}: ${v} píxeles (${((v / total) * 100).toLocaleString('es-CO', { maximumFractionDigits: 1 })} %)`}
                          className={`figure text-center py-2 rounded-[3px] ${v / total > 0.5 ? 'text-white font-bold' : 'text-ink'}`}
                          style={{ background: cellBg(v / total) }}
                        >
                          {v.toLocaleString('es-CO')}
                        </td>
                      ))}
                      <td className="figure text-center px-1.5 whitespace-nowrap">{pct(metrics.per_class?.[i]?.recall)}</td>
                    </tr>
                  );
                })}
                <tr>
                  <th scope="row" className="text-left font-semibold text-ink-2 pr-2 pt-1">Precisión</th>
                  {metrics.per_class?.map(c => (
                    <td key={c.class} className="figure text-center pt-1 px-1.5 whitespace-nowrap">{pct(c.precision)}</td>
                  ))}
                  <td />
                </tr>
              </tbody>
            </table>
          </figure>
        )}

        <figure className="sheet p-4">
          <figcaption className="text-sm font-semibold mb-3">Importancia de las variables</figcaption>
          <ResponsiveContainer width="100%" height={importances.length * 26 + 8}>
            <BarChart data={importances} layout="vertical" margin={{ left: 0, right: 16, top: 0, bottom: 0 }} barCategoryGap={3}>
              <XAxis type="number" hide domain={[0, 'dataMax']} />
              <YAxis
                type="category"
                dataKey="feature"
                width={56}
                tickLine={false}
                axisLine={false}
                tick={{ fill: '#3d4856', fontSize: 12, fontFamily: 'Courier Prime, monospace' }}
              />
              <Tooltip
                cursor={{ fill: 'rgb(27 36 48 / 0.04)' }}
                contentStyle={{ background: '#fbfcf8', border: '1px solid #cdd3c8', borderRadius: 4, fontSize: 13 }}
                labelStyle={{ color: '#1b2430', fontWeight: 700 }}
                itemStyle={{ color: '#3d4856' }}
                formatter={(v) => [pct(Number(v)), 'Importancia']}
              />
              <Bar dataKey="importance" fill="#5a4a9c" radius={[0, 3, 3, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </figure>
      </div>

      <p className="flex items-start gap-2 text-sm text-ink-2 max-w-[75ch]">
        <Info className="w-4 h-4 shrink-0 mt-0.5 text-muted" />
        La validación compara con las etiquetas de las reglas, no con datos de campo. Valores cercanos al 100 %
        significan que el modelo reproduce las reglas, no que el mapa sea perfecto.
      </p>
    </div>
  );
}
