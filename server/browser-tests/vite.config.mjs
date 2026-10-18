import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// No API proxy: even an unhandled test request cannot reach a real backend.
export default defineConfig({ plugins: [react()] })
