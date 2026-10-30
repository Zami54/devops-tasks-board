import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  build: {
    // Pas de fichiers .map en production : ils exposeraient le code source
    // complet de l'application à n'importe quel visiteur.
    sourcemap: false,
  },
  server: {
    port: 5173,
    // En développement, Vite relaie /api vers le backend (même rôle que
    // nginx en conteneur) : le code React est identique partout.
    proxy: {
      '/api': {
        target: process.env.BACKEND_URL || 'http://localhost:3000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
})
