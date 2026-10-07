import { useEffect, useMemo, useState } from 'react';
import { MapContainer, TileLayer, WMSTileLayer, GeoJSON, LayersControl } from 'react-leaflet';
import L from 'leaflet';

const WMS_URL = '/geoserver/ween/wms';
const COLORS = { hydrometrique: '#1f6feb', pluviometrique: '#2da44e' };
const LABELS = { hydrometrique: 'Hydrométrique', pluviometrique: 'Pluviométrique' };
const UNITS = { debit_m3s: 'm³/s', pluie_mm: 'mm' };

const STATUTS = { succes: 'succès', succes_partiel: 'succès partiel', echec: 'échec', en_cours: 'en cours' };
const fmtDate = (d) => (d ? new Date(d).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '–');

function useJson(url, deps = []) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    let alive = true;
    fetch(url)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e.message));
    return () => { alive = false; };
  }, deps);
  return { data, error };
}

function Catalogue() {
  const { data, error } = useJson('/api/catalogue');
  if (error) return <p className="muted">Catalogue indisponible ({error}).</p>;
  if (!data) return <p className="muted">Chargement…</p>;
  return (
    <table className="tbl">
      <thead><tr><th>Jeu de données</th><th className="num">Objets</th><th>Mis à jour</th></tr></thead>
      <tbody>
        {data.map((d) => (
          <tr key={d.id} title={d.source ?? ''}>
            <td>{d.titre}{d.couche_ogc && <div className="tag">{d.couche_ogc}</div>}</td>
            <td className="num">{d.objets}</td>
            <td>{fmtDate(d.mis_a_jour)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Imports() {
  const { data, error } = useJson('/api/imports');
  if (error) return <p className="muted">Journal indisponible ({error}).</p>;
  if (!data) return <p className="muted">Chargement…</p>;
  return (
    <ul className="imports">
      {data.map((i) => (
        <li key={i.id}>
          <div className="imp-head">
            <strong>{i.jeu}</strong>
            <span className={`badge ${i.statut}`}>{STATUTS[i.statut] ?? i.statut}</span>
          </div>
          <div className="muted">
            {i.lignes_lues} lues · {i.acceptees} acceptées · {i.rejetees} rejetées
          </div>
          {i.rejets.length > 0 && (
            <ul className="rejets">
              {i.rejets.map((r) => <li key={r.ligne}>Ligne {r.ligne} : {r.motif}</li>)}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}

function Chart({ mesures, unit, color }) {
  if (!mesures.length) return <p className="muted">Aucune mesure.</p>;
  const w = 320, h = 140, pad = 24;
  const max = Math.max(...mesures.map((m) => m.valeur));
  const bw = (w - pad) / mesures.length;
  return (
    <svg viewBox={`0 0 ${w} ${h + 20}`} className="chart" role="img" aria-label="Série de mesures">
      <line x1={pad} x2={w} y1={h} y2={h} stroke="currentColor" opacity="0.3" />
      {mesures.map((m, i) => {
        const bh = (m.valeur / max) * (h - 10);
        return (
          <g key={m.date}>
            <rect x={pad + i * bw + 2} y={h - bh} width={bw - 4} height={bh} fill={color} opacity="0.85">
              <title>{`${m.date} : ${m.valeur} ${unit}`}</title>
            </rect>
            <text x={pad + i * bw + bw / 2} y={h + 14} fontSize="9" textAnchor="middle" fill="currentColor" opacity="0.7">
              {m.date.slice(5, 7)}
            </text>
          </g>
        );
      })}
      <text x={0} y={12} fontSize="9" fill="currentColor" opacity="0.7">{Math.round(max)}</text>
    </svg>
  );
}

function StationPanel({ code, onClose }) {
  const { data, error } = useJson(`/api/stations/${code}/mesures`, [code]);
  if (error) return <div className="station"><p>Erreur : {error}</p></div>;
  if (!data) return <div className="station"><p className="muted">Chargement…</p></div>;
  const variable = data.mesures[0]?.variable;
  return (
    <div className="station">
      <div className="station-head">
        <div>
          <h3>{data.station.nom}</h3>
          <div className="muted">{data.station.code} · {LABELS[data.station.type]} · données fictives</div>
        </div>
        <button className="close" onClick={onClose} aria-label="Fermer">×</button>
      </div>
      <div className="muted small">
        {variable === 'debit_m3s' ? 'Débit moyen mensuel 2025' : 'Pluie mensuelle 2025'} ({UNITS[variable] ?? ''})
      </div>
      <Chart mesures={data.mesures} unit={UNITS[variable]} color={COLORS[data.station.type]} />
    </div>
  );
}

export default function App() {
  const { data: stations } = useJson('/api/stations');
  const [selected, setSelected] = useState(null);

  const pointToLayer = useMemo(() => (feature, latlng) =>
    L.circleMarker(latlng, {
      radius: 8, weight: 2, color: '#fff', fillOpacity: 0.95,
      fillColor: COLORS[feature.properties.type],
    }), []);

  const onEach = (feature, layer) => {
    const p = feature.properties;
    layer.bindTooltip(`${p.nom} (${p.code})`);
    layer.on('click', () => setSelected(p.code));
  };

  return (
    <div className="app">
      <aside className="side">
        <header>
          <div className="eyebrow">Démonstrateur</div>
          <h1>Portail national de données WEEN</h1>
          <p className="muted">
            Province pilote du Maniema. Limites administratives et cours d'eau issus de sources ouvertes ;
            stations et mesures <strong>fictives</strong>.
          </p>
        </header>

        <section>
          <h2>Catalogue</h2>
          <Catalogue />
        </section>

        <section>
          <h2>Légende</h2>
          <div className="legend">
            {Object.entries(LABELS).map(([k, v]) => (
              <span key={k}><i style={{ background: COLORS[k] }} />{v}</span>
            ))}
          </div>
        </section>

        <section>
          <h2>Journal des imports</h2>
          <Imports />
        </section>

        <footer className="muted small">
          <a href="/api/docs" target="_blank" rel="noreferrer">Documentation de l'API</a>
          {' · '}
          <a href="/geoserver/ween/wms?service=WMS&request=GetCapabilities" target="_blank" rel="noreferrer">Services WMS</a>
        </footer>
      </aside>

      <main className="map-wrap">
        <MapContainer center={[-3.0, 26.2]} zoom={7} className="map">
          <LayersControl position="topright">
            <LayersControl.BaseLayer checked name="OpenStreetMap">
              <TileLayer
                attribution='&copy; contributeurs <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
            </LayersControl.BaseLayer>
            <LayersControl.Overlay checked name="Province (WMS GeoServer)">
              <WMSTileLayer url={WMS_URL} layers="ween:province" format="image/png" transparent opacity={0.45}
                attribution="geoBoundaries / Natural Earth" />
            </LayersControl.Overlay>
            <LayersControl.Overlay checked name="Cours d'eau (WMS GeoServer)">
              <WMSTileLayer url={WMS_URL} layers="ween:cours_eau" format="image/png" transparent
                attribution="Natural Earth" />
            </LayersControl.Overlay>
            {stations && (
              <LayersControl.Overlay checked name="Stations (API REST)">
                <GeoJSON data={stations} pointToLayer={pointToLayer} onEachFeature={onEach} />
              </LayersControl.Overlay>
            )}
          </LayersControl>
        </MapContainer>
        {selected && <StationPanel code={selected} onClose={() => setSelected(null)} />}
      </main>
    </div>
  );
}
