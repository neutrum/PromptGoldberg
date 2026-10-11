import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // 127.0.0.1, not localhost: the API listens on IPv4 only, and Node tries ::1 first, which costs ~2 s per request.
      '/api': 'http://127.0.0.1:8787',
    },
  },
  worker: {
    format: 'es',
  },
});
