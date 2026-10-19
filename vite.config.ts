import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // `npm run desktop` opens exactly this address (tauri.conf.json `devUrl`).
  // Without strictPort a busy 5173 silently moves Vite to 5174, and the
  // desktop window loads whatever else is listening on 5173.
  server: { port: 5173, strictPort: true },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
