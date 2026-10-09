import { LayersControl, TileLayer } from 'react-leaflet';

// ── Capas base compartidas por todos los mapas ─────────────────────────────────

const ESRI_IMAGERY =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const ESRI_LABELS =
  'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}';
const OSM = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';

export default function BaseLayers() {
  return (
    <LayersControl position="topright">
      <LayersControl.BaseLayer checked name="Satélite (Esri)">
        <TileLayer url={ESRI_IMAGERY} attribution="Imagery © Esri, Maxar, Earthstar Geographics" maxZoom={19} />
      </LayersControl.BaseLayer>
      <LayersControl.BaseLayer name="Mapa (OpenStreetMap)">
        <TileLayer url={OSM} attribution="© OpenStreetMap contributors" maxZoom={19} />
      </LayersControl.BaseLayer>
      <LayersControl.Overlay checked name="Etiquetas">
        <TileLayer url={ESRI_LABELS} maxZoom={19} />
      </LayersControl.Overlay>
    </LayersControl>
  );
}
