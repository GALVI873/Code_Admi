import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // El proyecto vive en una unidad de red (\\servidor\DATOS\...); los watchers
    // nativos de Windows fallan ahí, así que forzamos polling.
    watch: { usePolling: true },
  },
})
