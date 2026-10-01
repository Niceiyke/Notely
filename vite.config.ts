import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    watch: {
      // Rust creates and locks executables under this directory during Tauri builds.
      // Vite should never watch the native build output.
      ignored: ['**/src-tauri/**'],
    },
  },
})
