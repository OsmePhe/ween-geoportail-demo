export const openapi = {
  openapi: '3.0.3',
  info: {
    title: 'API WEEN (démonstrateur)',
    version: '1.0.0',
    description: "API d'échange de la base de démonstration WEEN : catalogue, stations, mesures et journal des imports. Les stations et les mesures sont fictives.",
  },
  servers: [{ url: '/' }],
  paths: {
    '/api/health': { get: { summary: 'État du service', responses: { 200: { description: 'Service disponible' } } } },
    '/api/catalogue': {
      get: { summary: 'Catalogue des jeux de données', description: 'Volumétrie, source, dernière mise à jour et couche OGC associée.', responses: { 200: { description: 'Liste des jeux' } } },
    },
    '/api/stations': {
      get: {
        summary: 'Stations de mesure (GeoJSON)',
        parameters: [{ name: 'type', in: 'query', schema: { type: 'string', enum: ['hydrometrique', 'pluviometrique'] } }],
        responses: { 200: { description: 'FeatureCollection GeoJSON' } },
      },
    },
    '/api/stations/{code}/mesures': {
      get: {
        summary: "Mesures d'une station",
        parameters: [
          { name: 'code', in: 'path', required: true, schema: { type: 'string', example: 'MAN-H01' } },
          { name: 'debut', in: 'query', schema: { type: 'string', format: 'date' } },
          { name: 'fin', in: 'query', schema: { type: 'string', format: 'date' } },
        ],
        responses: { 200: { description: 'Station et série de mesures' }, 404: { description: 'Station inconnue' } },
      },
    },
    '/api/stations-proches': {
      get: {
        summary: "Stations à moins de N km d'un point (requête PostGIS)",
        parameters: [
          { name: 'lon', in: 'query', required: true, schema: { type: 'number', example: 25.92 } },
          { name: 'lat', in: 'query', required: true, schema: { type: 'number', example: -2.95 } },
          { name: 'km', in: 'query', schema: { type: 'number', example: 150 } },
        ],
        responses: { 200: { description: 'Stations triées par distance' }, 400: { description: 'Paramètres invalides' } },
      },
    },
    '/api/imports': {
      get: { summary: 'Journal des imports et motifs de rejet', responses: { 200: { description: '50 derniers imports' } } },
    },
  },
};
