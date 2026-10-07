// Flux d'intégration de démonstration :
// récupérer -> contrôler -> transformer -> charger -> tracer, puis publier dans GeoServer.
import fs from 'node:fs/promises';
import pg from 'pg';

const DATABASE_URL = process.env.DATABASE_URL;
const GS_URL = process.env.GEOSERVER_URL;
const GS_AUTH = 'Basic ' + Buffer.from(`${process.env.GEOSERVER_USER}:${process.env.GEOSERVER_PASSWORD}`).toString('base64');

const SOURCES = {
  provinces: 'https://www.geoboundaries.org/api/current/gbOpen/COD/ADM1/',
  provincesRepli: 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_1_states_provinces.geojson',
  rivieres: 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_rivers_lake_centerlines.geojson',
};
const PROVINCE = 'Maniema';

const log = (...a) => console.log('[ingest]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function connect() {
  for (let i = 0; i < 30; i++) {
    try {
      const c = new pg.Client({ connectionString: DATABASE_URL });
      await c.connect();
      return c;
    } catch {
      await sleep(2000);
    }
  }
  throw new Error('Base injoignable');
}

async function fetchJson(url) {
  const r = await fetch(url, { redirect: 'follow' });
  if (!r.ok) throw new Error(`${url} -> HTTP ${r.status}`);
  return r.json();
}

// ---------- Journal des imports ----------
async function startImport(db, jeu, source) {
  const { rows } = await db.query('INSERT INTO audit.import_log (jeu, source) VALUES ($1, $2) RETURNING id', [jeu, source]);
  return rows[0].id;
}
async function endImport(db, id, { lues, acceptees, rejetees, statut }) {
  await db.query(
    'UPDATE audit.import_log SET fin = now(), lignes_lues = $2, acceptees = $3, rejetees = $4, statut = $5 WHERE id = $1',
    [id, lues, acceptees, rejetees, statut],
  );
}
async function reject(db, importId, ligne, motif, contenu) {
  await db.query('INSERT INTO audit.import_rejet (import_id, ligne, motif, contenu) VALUES ($1, $2, $3, $4)', [
    importId, ligne, motif, JSON.stringify(contenu),
  ]);
}

// ---------- Référentiel : province du Maniema (geoBoundaries) ----------
async function loadProvince(db) {
  const id = await startImport(db, 'ref.province', SOURCES.provinces);
  try {
    // Source principale : geoBoundaries ; source de repli : Natural Earth (admin 1)
    let fc, features, source;
    try {
      const meta = await fetchJson(SOURCES.provinces);
      fc = await fetchJson(meta.simplifiedGeometryGeoJSON || meta.gjDownloadURL);
      features = fc.features.filter((f) => (f.properties.shapeName || '').toLowerCase().includes(PROVINCE.toLowerCase()));
      source = 'geoBoundaries (gbOpen, ADM1)';
    } catch (e) {
      log(`geoBoundaries indisponible (${e.message}), repli sur Natural Earth`);
      fc = await fetchJson(SOURCES.provincesRepli);
      features = fc.features.filter((f) => f.properties.adm0_a3 === 'COD' && f.properties.name === PROVINCE);
      source = 'Natural Earth 10m (admin_1_states_provinces)';
    }
    if (!features.length) throw new Error(`Province ${PROVINCE} introuvable dans la source`);
    await db.query('DELETE FROM ref.province');
    for (const f of features) {
      await db.query(
        `INSERT INTO ref.province (nom, code_iso, source, geom)
         VALUES ($1, $2, $3, ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON($4), 4326)), 3)))`,
        [PROVINCE, f.properties.shapeISO || f.properties.iso_3166_2 || null, source, JSON.stringify(f.geometry)],
      );
    }
    await db.query('UPDATE audit.import_log SET source = $2 WHERE id = $1', [id, source]);
    await endImport(db, id, { lues: fc.features.length, acceptees: features.length, rejetees: 0, statut: 'succes' });
    log(`province ${PROVINCE} chargée (${source})`);
  } catch (e) {
    await endImport(db, id, { lues: 0, acceptees: 0, rejetees: 0, statut: 'echec' });
    throw e;
  }
}

// ---------- Cours d'eau : Natural Earth, découpés sur la province ----------
async function loadRivers(db) {
  const id = await startImport(db, 'eau.cours_eau', SOURCES.rivieres);
  const fc = await fetchJson(SOURCES.rivieres);
  await db.query('DELETE FROM eau.cours_eau');
  // Transformation dans PostGIS : géométrie, découpage sur la province, type multi-lignes
  const { rowCount } = await db.query(
    `INSERT INTO eau.cours_eau (nom, source, geom)
     SELECT f->'properties'->>'name', 'Natural Earth 10m (rivers_lake_centerlines)',
            ST_Multi(ST_CollectionExtract(ST_Intersection(g.geom, p.geom), 2))
     FROM json_array_elements($1::json->'features') f
     CROSS JOIN LATERAL (SELECT ST_SetSRID(ST_GeomFromGeoJSON(f->>'geometry'), 4326) AS geom) g
     JOIN ref.province p ON ST_Intersects(g.geom, p.geom)
     WHERE NOT ST_IsEmpty(ST_CollectionExtract(ST_Intersection(g.geom, p.geom), 2))`,
    [JSON.stringify(fc)],
  );
  await endImport(db, id, { lues: fc.features.length, acceptees: rowCount, rejetees: 0, statut: 'succes' });
  log(`${rowCount} cours d'eau retenus sur ${fc.features.length}`);
}

// ---------- Lecture CSV (fichiers simples, sans guillemets) ----------
async function readCsv(path) {
  const text = (await fs.readFile(path, 'utf8')).trim();
  const [head, ...lines] = text.split(/\r?\n/);
  const cols = head.split(',');
  return lines.map((l, i) => {
    const v = l.split(',');
    return { ligne: i + 2, ...Object.fromEntries(cols.map((c, j) => [c, (v[j] ?? '').trim()])) };
  });
}

// ---------- Stations : contrôle qualité ligne par ligne ----------
async function loadStations(db) {
  const file = 'data/stations.csv';
  const id = await startImport(db, 'eau.station', file);
  const rows = await readCsv(file);
  await db.query('TRUNCATE staging.station_brut');
  for (const r of rows) {
    await db.query('INSERT INTO staging.station_brut VALUES ($1,$2,$3,$4,$5,$6,$7)', [
      r.ligne, r.code, r.nom, r.type, r.cours_eau, r.lon, r.lat,
    ]);
  }
  await db.query('DELETE FROM eau.mesure');
  await db.query('DELETE FROM eau.station');
  let ok = 0, ko = 0;
  for (const r of rows) {
    const lon = Number(r.lon), lat = Number(r.lat);
    let motif = null;
    if (!r.code || !r.nom) motif = 'code ou nom manquant';
    else if (!['hydrometrique', 'pluviometrique'].includes(r.type)) motif = `type inconnu : ${r.type}`;
    else if (!Number.isFinite(lon) || !Number.isFinite(lat)) motif = 'coordonnées non numériques';
    else {
      const { rows: inside } = await db.query(
        'SELECT ST_Within(ST_SetSRID(ST_MakePoint($1, $2), 4326), geom) AS dedans FROM ref.province LIMIT 1',
        [lon, lat],
      );
      if (!inside[0]?.dedans) motif = `point hors de la province ${PROVINCE}`;
    }
    if (motif) {
      ko++;
      await reject(db, id, r.ligne, motif, r);
      continue;
    }
    await db.query(
      `INSERT INTO eau.station (code, nom, type, cours_eau, fictive, geom)
       VALUES ($1, $2, $3, NULLIF($4, ''), true, ST_SetSRID(ST_MakePoint($5, $6), 4326))`,
      [r.code, r.nom, r.type, r.cours_eau, lon, lat],
    );
    ok++;
  }
  await endImport(db, id, { lues: rows.length, acceptees: ok, rejetees: ko, statut: ko ? 'succes_partiel' : 'succes' });
  log(`stations : ${ok} acceptées, ${ko} rejetées`);
}

// ---------- Mesures ----------
const VARIABLES = { debit_m3s: 'hydrometrique', pluie_mm: 'pluviometrique' };

function isValidDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

async function loadMeasures(db) {
  const file = 'data/mesures.csv';
  const id = await startImport(db, 'eau.mesure', file);
  const rows = await readCsv(file);
  await db.query('TRUNCATE staging.mesure_brut');
  for (const r of rows) {
    await db.query('INSERT INTO staging.mesure_brut VALUES ($1,$2,$3,$4,$5)', [
      r.ligne, r.station_code, r.date_mesure, r.variable, r.valeur,
    ]);
  }
  const { rows: st } = await db.query('SELECT code, type FROM eau.station');
  const stations = new Map(st.map((s) => [s.code, s.type]));
  let ok = 0, ko = 0;
  for (const r of rows) {
    const v = Number(r.valeur);
    let motif = null;
    if (!stations.has(r.station_code)) motif = `station inconnue : ${r.station_code}`;
    else if (!VARIABLES[r.variable]) motif = `variable inconnue : ${r.variable}`;
    else if (VARIABLES[r.variable] !== stations.get(r.station_code)) motif = 'variable incompatible avec le type de station';
    else if (!isValidDate(r.date_mesure)) motif = `date invalide : ${r.date_mesure}`;
    else if (!Number.isFinite(v)) motif = `valeur non numérique : ${r.valeur}`;
    else if (v < 0) motif = `valeur négative : ${v}`;
    if (motif) {
      ko++;
      await reject(db, id, r.ligne, motif, r);
      continue;
    }
    await db.query(
      `INSERT INTO eau.mesure (station_code, date_mesure, variable, valeur) VALUES ($1, $2, $3, $4)
       ON CONFLICT (station_code, date_mesure, variable) DO UPDATE SET valeur = EXCLUDED.valeur`,
      [r.station_code, r.date_mesure, r.variable, v],
    );
    ok++;
  }
  await endImport(db, id, { lues: rows.length, acceptees: ok, rejetees: ko, statut: ko ? 'succes_partiel' : 'succes' });
  log(`mesures : ${ok} acceptées, ${ko} rejetées`);
}

// ---------- Publication GeoServer (API REST) ----------
async function gs(method, path, body) {
  const r = await fetch(`${GS_URL}/rest${path}`, {
    method,
    headers: { Authorization: GS_AUTH, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return r;
}
async function ensure(getPath, postPath, body) {
  const exists = await gs('GET', getPath);
  if (exists.ok) return;
  const r = await gs('POST', postPath, body);
  if (!r.ok) throw new Error(`GeoServer ${postPath} -> ${r.status} ${await r.text()}`);
}

async function publishGeoServer() {
  log('attente de GeoServer…');
  for (let i = 0; i < 100; i++) {
    const r = await gs('GET', '/about/version').catch(() => null);
    if (r?.ok) break;
    await sleep(3000);
  }
  await ensure('/workspaces/ween', '/workspaces', { workspace: { name: 'ween' } });
  for (const schema of ['ref', 'eau']) {
    await ensure(`/workspaces/ween/datastores/${schema}`, '/workspaces/ween/datastores', {
      dataStore: {
        name: schema,
        connectionParameters: {
          entry: [
            { '@key': 'dbtype', $: 'postgis' },
            { '@key': 'host', $: 'db' },
            { '@key': 'port', $: '5432' },
            { '@key': 'database', $: 'ween' },
            { '@key': 'schema', $: schema },
            { '@key': 'user', $: 'ween' },
            { '@key': 'passwd', $: 'ween_demo' },
          ],
        },
      },
    });
  }
  const layers = [
    ['ref', 'province', 'Province du Maniema'],
    ['eau', 'cours_eau', "Cours d'eau"],
    ['eau', 'station', 'Stations de mesure (fictives)'],
  ];
  for (const [store, name, title] of layers) {
    await ensure(`/workspaces/ween/datastores/${store}/featuretypes/${name}`, `/workspaces/ween/datastores/${store}/featuretypes`, {
      featureType: { name, nativeName: name, title, srs: 'EPSG:4326' },
    });
  }
  log('couches publiées dans GeoServer (espace ween)');
}

async function main() {
  const db = await connect();
  try {
    await loadProvince(db);
    await loadRivers(db);
    await loadStations(db);
    await loadMeasures(db);
  } finally {
    await db.end();
  }
  if (process.env.SKIP_GEOSERVER === '1') log('publication GeoServer ignorée');
  else await publishGeoServer();
  log('terminé');
}

main().catch((e) => {
  console.error('[ingest] erreur :', e.message);
  process.exit(1);
});
