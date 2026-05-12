import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [svelte()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts']
  },
  resolve: {
    conditions: ['browser']
  },
  clearScreen: false,
  server: {
    strictPort: true
  },
  envPrefix: ['VITE_', 'TAURI_']
});
