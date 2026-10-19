import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': { target: 'https://haatz.quilibrium.com', changeOrigin: true, rewrite: path => path.replace(/^\/api/, '') },
    },
  },
  build: { target: 'es2022' },
});
