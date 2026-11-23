import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // chemins relatifs : l'app fonctionne à la racine d'un domaine comme dans un sous-dossier (GitHub Pages)
  base: './',
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
} as any);
