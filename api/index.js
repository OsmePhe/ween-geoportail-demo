// API REST de démonstration WEEN : catalogue, stations, mesures, journal des imports.
import express from 'express';
import pg from 'pg';
import swaggerUi from 'swagger-ui-express';
import { openapi } from './openapi.js';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const app = express();

const wrap = (fn) => (req, res) => fn(req, res).catch((e) => {
  console.error(e);
  res.status(500).json({ erreur: 'Erreur interne' });
});

app.get('/api/health', wrap(async (_req, res) => {
  await pool.query('SELECT 1');
  res.json({ statut: 'ok' });
}));

// Catalogue des jeux de données : volumétrie et dernière mise à jour
app.get('/api/catalogue', wrap(async (_req, res) => {
  const { rows } = await pool.query(`
    SELECT 'province' AS id, 'Province du Maniema' AS titre, 'ref.province' AS table_source,
           (SELECT count(*) FROM ref.province)::int AS objets, 'ween:province' AS couche_ogc
    UNION ALL
    SELECT 'cours_eau', 'Cours d''eau', 'eau.cours_eau', (SELECT count(*) FROM eau.cours_eau)::int, 'ween:cours_eau'
    UNION ALL
    SELECT 'station', 'Stations de mesure (fictives)', 'eau.station', (SELECT count(*) FROM eau.station)::int, 'ween:station'
    UNION ALL
    SELECT 'mesure', 'Mesures (fictives)', 'eau.mesure', (SELECT count(*) FROM eau.mesure)::int, NULL`);
  const { rows: maj } = await pool.query(
    `SELECT DISTINCT ON (jeu) jeu, fin, source FROM audit.import_log WHERE statut <> 'echec' ORDER BY jeu, fin DESC`,
  );
  const parJeu = Object.fromEntries(maj.map((m) => [m.jeu, m]));
  res.json(rows.map((r) => ({
    ...r,
    source: parJeu[r.table_source]?.source ?? null,
    mis_a_jour: parJeu[r.table_source]?.fin ?? null,
  })));
}));

// Stations en GeoJSON, filtrables par type
app.get('/api/stations', wrap(async (req, res) => {
  const type = req.query.type ?? null;
  const { rows } = await pool.query(
    `SELECT json_build_object(
       'type', 'FeatureCollection',
       'features', coalesce(json_agg(json_build_object(
         'type', 'Feature',
         'geometry', ST_AsGeoJSON(s.geom)::json,
         'properties', json_build_object(
           'code', s.code, 'nom', s.nom, 'type', s.type, 'cours_eau', s.cours_eau, 'fictive', s.fictive,
           'nb_mesures', (SELECT count(*) FROM eau.mesure m WHERE m.station_code = s.code)
         )
       ) ORDER BY s.code), '[]'::json)
     ) AS fc
     FROM eau.station s
     WHERE $1::text IS NULL OR s.type = $1`,
    [type],
  );
  res.type('application/geo+json').json(rows[0].fc);
}));

// Mesures d'une station
app.get('/api/stations/:code/mesures', wrap(async (req, res) => {
  const { rows: st } = await pool.query('SELECT code, nom, type FROM eau.station WHERE code = $1', [req.params.code]);
  if (!st.length) return res.status(404).json({ erreur: 'Station inconnue' });
  const { rows } = await pool.query(
    `SELECT to_char(date_mesure, 'YYYY-MM-DD') AS date, variable, valeur::float AS valeur
     FROM eau.mesure WHERE station_code = $1
       AND ($2::date IS NULL OR date_mesure >= $2) AND ($3::date IS NULL OR date_mesure <= $3)
     ORDER BY date_mesure`,
    [req.params.code, req.query.debut ?? null, req.query.fin ?? null],
  );
  res.json({ station: st[0], mesures: rows });
}));

// Requête spatiale : stations à moins de N km d'un point
app.get('/api/stations-proches', wrap(async (req, res) => {
  const lon = Number(req.query.lon), lat = Number(req.query.lat), km = Number(req.query.km ?? 50);
  if (![lon, lat, km].every(Number.isFinite)) return res.status(400).json({ erreur: 'lon, lat et km doivent être numériques' });
  const { rows } = await pool.query(
    `SELECT code, nom, type,
            round((ST_Distance(geom::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) / 1000)::numeric, 1)::float AS distance_km
     FROM eau.station
     WHERE ST_DWithin(geom::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $3 * 1000)
     ORDER BY distance_km`,
    [lon, lat, km],
  );
  res.json(rows);
}));

// Journal des imports et détail des rejets
app.get('/api/imports', wrap(async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT l.id, l.jeu, l.source, l.debut, l.fin, l.lignes_lues, l.acceptees, l.rejetees, l.statut,
            coalesce((SELECT json_agg(json_build_object('ligne', r.ligne, 'motif', r.motif) ORDER BY r.ligne)
                      FROM audit.import_rejet r WHERE r.import_id = l.id), '[]'::json) AS rejets
     FROM audit.import_log l ORDER BY l.id DESC LIMIT 50`,
  );
  res.json(rows);
}));

app.get('/api/openapi.json', (_req, res) => res.json(openapi));
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openapi));

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => console.log(`[api] écoute sur ${port}`));
