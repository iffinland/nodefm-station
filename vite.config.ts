import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    // Deliberately one archive-safe executable; the compressed payload remains
    // small enough for NodeFM's QDN delivery model.
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        // QDN application updates replace one archive atomically, while an
        // Android WebView may still fail an on-demand module request through
        // Home's render proxy. Keep the application executable in one file so
        // navigation never depends on a second, lazy route request.
        inlineDynamicImports: true,
      },
    },
  },
});
