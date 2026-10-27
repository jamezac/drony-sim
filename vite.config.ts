import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    // Three.js ocupa ~500 kB minificado por sí solo; el aviso por defecto no aporta nada
    chunkSizeWarningLimit: 1000,
    rolldownOptions: {
      // Dos páginas: el simulador y la prueba/calibración de dispositivos
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        devices: resolve(import.meta.dirname, 'devices.html'),
      },
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
