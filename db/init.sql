-- Base de démonstration WEEN : schémas par domaine, zone tampon, journal des imports
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE SCHEMA IF NOT EXISTS ref;      -- référentiels (limites administratives)
CREATE SCHEMA IF NOT EXISTS eau;      -- domaine eau
CREATE SCHEMA IF NOT EXISTS staging;  -- zone tampon avant validation
CREATE SCHEMA IF NOT EXISTS audit;    -- traçabilité des imports

-- Référentiel : provinces
CREATE TABLE IF NOT EXISTS ref.province (
  id          serial PRIMARY KEY,
  nom         text NOT NULL UNIQUE,
  code_iso    text,
  source      text NOT NULL,
  geom        geometry(MultiPolygon, 4326) NOT NULL
);
CREATE INDEX IF NOT EXISTS province_geom_idx ON ref.province USING gist (geom);

-- Eau : cours d'eau (découpés sur la province)
CREATE TABLE IF NOT EXISTS eau.cours_eau (
  id          serial PRIMARY KEY,
  nom         text,
  source      text NOT NULL,
  geom        geometry(MultiLineString, 4326) NOT NULL
);
CREATE INDEX IF NOT EXISTS cours_eau_geom_idx ON eau.cours_eau USING gist (geom);

-- Eau : stations de mesure
CREATE TABLE IF NOT EXISTS eau.station (
  code        text PRIMARY KEY,
  nom         text NOT NULL,
  type        text NOT NULL CHECK (type IN ('hydrometrique', 'pluviometrique')),
  cours_eau   text,
  fictive     boolean NOT NULL DEFAULT true,
  geom        geometry(Point, 4326) NOT NULL
);
CREATE INDEX IF NOT EXISTS station_geom_idx ON eau.station USING gist (geom);

-- Eau : mesures
CREATE TABLE IF NOT EXISTS eau.mesure (
  id            bigserial PRIMARY KEY,
  station_code  text NOT NULL REFERENCES eau.station(code),
  date_mesure   date NOT NULL,
  variable      text NOT NULL CHECK (variable IN ('debit_m3s', 'pluie_mm')),
  valeur        numeric NOT NULL CHECK (valeur >= 0),
  UNIQUE (station_code, date_mesure, variable)
);

-- Zone tampon : les fichiers bruts arrivent ici, tels quels
CREATE TABLE IF NOT EXISTS staging.station_brut (
  ligne int, code text, nom text, type text, cours_eau text, lon text, lat text
);
CREATE TABLE IF NOT EXISTS staging.mesure_brut (
  ligne int, station_code text, date_mesure text, variable text, valeur text
);

-- Journal des imports
CREATE TABLE IF NOT EXISTS audit.import_log (
  id          bigserial PRIMARY KEY,
  jeu         text NOT NULL,
  source      text NOT NULL,
  debut       timestamptz NOT NULL DEFAULT now(),
  fin         timestamptz,
  lignes_lues int DEFAULT 0,
  acceptees   int DEFAULT 0,
  rejetees    int DEFAULT 0,
  statut      text NOT NULL DEFAULT 'en_cours'
);
CREATE TABLE IF NOT EXISTS audit.import_rejet (
  id          bigserial PRIMARY KEY,
  import_id   bigint NOT NULL REFERENCES audit.import_log(id),
  ligne       int,
  motif       text NOT NULL,
  contenu     jsonb
);
