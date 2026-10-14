import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Permite compartir el servidor de desarrollo con un túnel rápido de Cloudflare
    allowedHosts: ['.trycloudflare.com'],
    proxy: {
      '/search': 'http://localhost:8004',
      '/download': 'http://localhost:8004',
      '/preview': 'http://localhost:8004',
      '/index': 'http://localhost:8004',
      '/thresholds': 'http://localhost:8004',
      '/train': 'http://localhost:8004',
      '/predict': 'http://localhost:8004',
      '/map': 'http://localhost:8004',
      '/compare': 'http://localhost:8004',
      '/timeseries': 'http://localhost:8004',
      '/layer': 'http://localhost:8004',
      '/scenes': 'http://localhost:8004',
      '/export': 'http://localhost:8004',
      '/region': 'http://localhost:8004',
      '/heat': 'http://localhost:8004',
      '/classifier': 'http://localhost:8004',
    },
  },
})
