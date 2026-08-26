import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: 'src/web',
  plugins: [react()],
  build: {
    outDir: '../../dist/web',
    emptyOutDir: true,
  },
  server: {
    port: 5273,
    proxy: {
      // Anchored so it cannot swallow the `api.ts` module request.
      '^/api/': {
        target: 'http://127.0.0.1:5274',
        changeOrigin: false,
      },
    },
  },
})
