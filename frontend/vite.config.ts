import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Em desenvolvimento (npm run dev) o Vite repassa /api para a API Go.
export default defineConfig({
  plugins: [react()],
  server: {
    // O material de estudo importa ../docs/*.md (fora da pasta do frontend).
    fs: { allow: ['.', '../docs'] },
    proxy: {
      '/api': process.env.API_URL ?? 'http://localhost:8080',
    },
  },
})
