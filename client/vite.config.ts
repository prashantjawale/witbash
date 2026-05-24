import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/questions.json': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      // Proxy WebSocket upgrade requests to the backend during development.
      // The game client connects via ws://host:port/ws and the Express/ws
      // server handles upgrades on any path.
      '/ws': {
        target: 'ws://localhost:3000',
        ws: true,
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
  },
});
