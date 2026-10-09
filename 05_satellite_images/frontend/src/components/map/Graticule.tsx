import { useEffect, useState } from 'react';
import { Marker, Polyline, useMap } from 'react-leaflet';
import { divIcon } from 'leaflet';
import type { LatLngBounds } from 'leaflet';

// Paso de la retícula según el zoom (en grados)
function stepFor(zoom: number): number {
  if (zoom <= 5) return 2;
  if (zoom <= 7) return 1;
  if (zoom <= 9) return 0.25;
  if (zoom <= 11) return 0.1;
  if (zoom <= 13) return 0.05;
  return 0.01;
}

function label(v: number, pos: string, neg: string, step: number): string {
  const digits = step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
  return `${Math.abs(v).toFixed(digits).replace('.', ',')}°${v >= 0 ? pos : neg}`;
}

const labelIcon = (text: string, side: 'top' | 'left') =>
  divIcon({
    className: `graticule-label graticule-${side}`,
    html: `<span>${text}</span>`,
    iconSize: [0, 0],
  });

/** Retícula de coordenadas (meridianos y paralelos) que se adapta al zoom. */
export default function Graticule() {
  const map = useMap();
  const [view, setView] = useState<{ b: LatLngBounds; z: number }>(() => ({ b: map.getBounds(), z: map.getZoom() }));

  useEffect(() => {
    const update = () => setView({ b: map.getBounds(), z: map.getZoom() });
    map.on('moveend zoomend', update);
    return () => {
      map.off('moveend zoomend', update);
    };
  }, [map]);

  const step = stepFor(view.z);
  const s = view.b.getSouth(), n = view.b.getNorth(), w = view.b.getWest(), e = view.b.getEast();
  const lons: number[] = [];
  const lats: number[] = [];
  for (let x = Math.ceil(w / step) * step; x <= e; x += step) lons.push(+x.toFixed(4));
  for (let y = Math.ceil(s / step) * step; y <= n; y += step) lats.push(+y.toFixed(4));
  const style = { color: '#fbfcf8', weight: 1, opacity: 0.7, dashArray: '2 4', interactive: false };

  return (
    <>
      {lons.map(x => (
        <Polyline key={`x${x}`} positions={[[s, x], [n, x]]} pathOptions={style} />
      ))}
      {lats.map(y => (
        <Polyline key={`y${y}`} positions={[[y, w], [y, e]]} pathOptions={style} />
      ))}
      {lons.map(x => (
        <Marker key={`lx${x}`} position={[n, x]} icon={labelIcon(label(x, 'E', 'O', step), 'top')} interactive={false} />
      ))}
      {lats.map(y => (
        <Marker key={`ly${y}`} position={[y, w]} icon={labelIcon(label(y, 'N', 'S', step), 'left')} interactive={false} />
      ))}
    </>
  );
}
