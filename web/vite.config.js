import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// En développement local (npm run dev), on relaie l'API et GeoServer comme le fait nginx en production.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
      '/geoserver': 'http://localhost:8080',
    },
  },
});
