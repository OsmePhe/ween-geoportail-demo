# Démonstrateur : portail national de données WEEN

Prototype d'une plateforme nationale de données Eau-Énergie-Écosystèmes, construit sur l'architecture open source
recommandée pour la Base de Données Nationale WEEN (RDC) : PostgreSQL/PostGIS, GeoServer, API REST et portail web
cartographique. Province pilote : Maniema.

> **Données.** Les limites administratives et les cours d'eau proviennent de sources ouvertes
> (geoBoundaries, avec repli sur Natural Earth). **Les stations de mesure et les mesures sont fictives**,
> créées pour la démonstration.

## Architecture

```
Sources ouvertes + fichiers CSV
        │
        ▼
 ingest (Node.js) ── récupérer → contrôler → transformer → charger → tracer
        │
        ▼
 PostgreSQL / PostGIS ── schémas ref, eau, staging, audit
   │                │
   ▼                ▼
 API REST        GeoServer ── WMS / WFS (espace ween)
 (Express,          │
  OpenAPI)          │
   └──────┬─────────┘
          ▼
 Portail React + Leaflet (servi par nginx)
```

| Service     | Rôle                                                            | Adresse locale                                      |
| ----------- | --------------------------------------------------------------- | --------------------------------------------------- |
| `db`        | PostgreSQL 16 + PostGIS 3.4                                     | `localhost:5432`                                    |
| `ingest`    | Flux d'intégration, puis publication des couches dans GeoServer | s'exécute une fois                                  |
| `api`       | API REST documentée (OpenAPI / Swagger)                         | http://localhost:3000/api/docs                      |
| `geoserver` | Services cartographiques OGC                                    | http://localhost:8080/geoserver (admin / geoserver) |
| `web`       | Portail cartographique                                          | **http://localhost:8000**                           |

## Lancer le démonstrateur

Prérequis : Docker Desktop (ou équivalent) avec Docker Compose, et une connexion internet au premier lancement.

```bash
docker compose up -d --build
docker compose logs -f ingest      # suivre l'intégration des données (Ctrl+C pour quitter)
```

Le premier démarrage télécharge les images et les données ouvertes : compter quelques minutes.
Quand `ingest` affiche `terminé`, ouvrir **http://localhost:8000**.

Relancer l'intégration (par exemple après modification des CSV) : `docker compose run --rm ingest`.
Tout arrêter : `docker compose down` (ajouter `-v` pour effacer la base).

## Le flux d'intégration (`ingest/`)

Chaque jeu de données suit la même chaîne :

1. **Récupérer** : téléchargement des sources ouvertes, lecture des fichiers CSV de `ingest/data/`.
2. **Contrôler** : champs obligatoires, types attendus, coordonnées numériques et situées dans la province,
   dates valides, valeurs numériques et positives, stations connues, cohérence variable / type de station.
3. **Transformer** : géométries reprojetées et validées, cours d'eau découpés sur la province dans PostGIS.
4. **Charger** : données brutes en zone tampon (`staging`), seules les lignes valides passent dans les tables métier.
5. **Tracer** : chaque import et chaque rejet (ligne, motif) sont consignés dans `audit`, consultables dans le portail
   et via `GET /api/imports`.

Les fichiers de démonstration contiennent volontairement des lignes erronées (point hors province, type inconnu,
date invalide, valeur négative, station inconnue, valeur non numérique) pour illustrer les contrôles.

## API

| Méthode | Route                                      | Description                                                           |
| ------- | ------------------------------------------ | --------------------------------------------------------------------- |
| GET     | `/api/catalogue`                           | Jeux de données, volumétrie, source, dernière mise à jour, couche OGC |
| GET     | `/api/stations?type=`                      | Stations en GeoJSON                                                   |
| GET     | `/api/stations/{code}/mesures?debut=&fin=` | Série de mesures d'une station                                        |
| GET     | `/api/stations-proches?lon=&lat=&km=`      | Requête spatiale PostGIS : stations à moins de N km                   |
| GET     | `/api/imports`                             | Journal des imports et motifs de rejet                                |
| GET     | `/api/docs`                                | Documentation interactive OpenAPI                                     |

## Développement

```bash
cd web && npm install && npm run dev   # portail sur http://localhost:5173, relayé vers l'API et GeoServer locaux
```

## Sources

- geoBoundaries, limites administratives (ADM1), licence ouverte : https://www.geoboundaries.org
- Natural Earth, cours d'eau et limites (domaine public) : https://www.naturalearthdata.com
- Fond de carte © contributeurs OpenStreetMap

Réalisé par **Omar OGOUBI**, ingénieur full stack · [github.com/OsmePhe](https://github.com/OsmePhe)
