import type { HeatSummary } from '../../types';
import { chartColor, dePhrase, phrase } from '../../lib/classes';
import { fmtC, fmtDate, fmtHa, primaryDef, signedC } from '../../lib/heat';

/** Frase principal sobre calor y deforestación, sin exagerar lo que la medición sostiene. */
export function DeforestationHeadline({ heat }: { heat: HeatSummary }) {
  const d = heat.deforestation;
  const main = primaryDef(heat);
  if (!d) return null;
  const span = (
    <>
      entre <span className="figure">{d.year}</span> y <span className="figure">{heat.year}</span>
    </>
  );
  if (!d.enough || d.did === undefined) {
    return (
      <p className="font-serif text-xl leading-snug">
        Entre <span className="figure">{d.year}</span> y <span className="figure">{heat.year}</span> se perdieron{' '}
        <span className="figure font-bold">{fmtHa(d.lost_hectares)} ha</span> {dePhrase(main)} con temperatura medida: muy poco para
        estimar su efecto en el calor.
      </p>
    );
  }
  const warmer = (d.did ?? 0) > 0;
  return (
    <div className="space-y-2">
      <p className="font-serif text-xl sm:text-2xl leading-snug">
        Donde se perdió {phrase(main).replace(/^(el|la|los|las) /, '')} {span}{' '}
        (<span className="figure">{fmtHa(d.lost_hectares)} ha</span>),{' '}
        {d.significant ? (
          <>
            la superficie se calentó{' '}
            <span className={`figure font-bold ${warmer ? 'text-signal' : 'text-ink'}`}>
              {fmtC(Math.abs(d.did!))} {warmer ? 'más' : 'menos'}
            </span>{' '}
            que donde {phrase(main)} se conservó.
          </>
        ) : (
          <>la superficie no se calentó de forma distinguible respecto a donde {phrase(main)} se conservó.</>
        )}
      </p>
      <p className="text-ink-2 max-w-[70ch]">
        Intervalo del 95 %: <span className="figure">{signedC(d.did_low!)}</span> a <span className="figure">{signedC(d.did_high!)}</span>.
        Hoy esas zonas están en promedio a <span className="figure text-ink font-bold">{fmtC(d.lost_now_mean!)}</span>, frente a{' '}
        <span className="figure text-ink font-bold">{fmtC(d.kept_now_mean!)}</span> {dePhrase(main)} conservado
        (<span className="figure">{signedC(d.now_diff!)}</span>).
      </p>
    </div>
  );
}

/** Temperatura media por cobertura en la escena actual, con su rango p10–p90. */
export function HeatByClassTable({ heat }: { heat: HeatSummary }) {
  const ref = heat.by_class.find(c => c.key === heat.primary.key);
  const lo = Math.min(...heat.by_class.map(c => c.p10));
  const hi = Math.max(...heat.by_class.map(c => c.p90));
  const pos = (v: number) => `${((v - lo) / Math.max(hi - lo, 0.1)) * 100}%`;
  return (
    <div className="sheet overflow-x-auto">
      <table className="data-table">
        <caption className="sr-only">Temperatura de la superficie por cobertura, {heat.year}</caption>
        <thead>
          <tr>
            <th scope="col">Cobertura</th>
            <th scope="col" className="!text-right">Media</th>
            {ref && <th scope="col" className="!text-right">vs. {ref.label.toLowerCase()}</th>}
            <th scope="col" className="hidden sm:table-cell">
              Rango (10 %–90 % de los píxeles)
            </th>
            <th scope="col" className="!text-right">Superficie</th>
          </tr>
        </thead>
        <tbody>
          {heat.by_class.map(c => (
            <tr key={c.key}>
              <td>
                <span className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-[2px] shrink-0" style={{ background: c.color }} aria-hidden />
                  {c.label}
                </span>
              </td>
              <td className="num font-bold">{fmtC(c.mean)}</td>
              {ref && <td className="num">{c.key === ref.key ? '—' : signedC(c.mean - ref.mean)}</td>}
              <td className="hidden sm:table-cell min-w-[180px]">
                <span className="relative block h-4" aria-label={`${fmtC(c.p10)} a ${fmtC(c.p90)}`}>
                  <span className="absolute top-1/2 h-px w-full bg-rule" aria-hidden />
                  <span
                    className="absolute top-1/2 -translate-y-1/2 h-1.5 rounded-full"
                    style={{ left: pos(c.p10), width: `calc(${pos(c.p90)} - ${pos(c.p10)})`, background: chartColor({ ...c, code: 0 }) }}
                    aria-hidden
                  />
                  <span
                    className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-ink ring-2 ring-paper"
                    style={{ left: pos(c.median) }}
                    aria-hidden
                  />
                </span>
              </td>
              <td className="num">{fmtHa(c.hectares)} ha</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Qué mide y qué no: fechas Landsat, hora, resolución y referencia. */
export function HeatNotes({ heat }: { heat: HeatSummary }) {
  return (
    <ul className="text-sm text-ink-2 space-y-1.5 list-disc pl-5 max-w-[75ch]">
      <li>
        Temperatura de la <strong>superficie</strong> (techos, copas, suelo), no del aire, medida por Landsat hacia las 10:30 a. m.
        Escenas: <span className="figure">{fmtDate(heat.scene.datetime)}</span>
        {heat.past && <> y <span className="figure">{fmtDate(heat.past.scene.datetime)}</span></>}.
      </li>
      <li>El sensor térmico mide a 100 m: los detalles más pequeños que una cuadra se promedian con su entorno.</li>
      {heat.deforestation?.enough && (
        <li>
          Cada fecha tuvo su propio clima. Por eso no se compara la temperatura directamente entre años, sino cuánto más se calentó lo
          deforestado que {phrase(primaryDef(heat))} que se mantuvo, descontando las diferencias de gran escala en la escena. El intervalo
          considera que los píxeles vecinos no son independientes (bloques de 300 m).
        </li>
      )}
      <li>Contiene datos de Landsat 8/9, cortesía del Servicio Geológico de los Estados Unidos (USGS).</li>
    </ul>
  );
}
