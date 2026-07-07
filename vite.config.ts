import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    build: {
      rollupOptions: {
        output: {
          // Skill de tunge, sjelden-endrede avhengighetene ut i egne chunks. De
          // lastes parallelt med app-koden OG beholder cachen på tvers av deployer
          // (endrer vi bare app-koden, slipper brukeren å laste ned firebase/react
          // på nytt). NB: matcher '/react/' med slash foran, så 'lucide-react'
          // havner IKKE her.
          manualChunks(id) {
            if (!id.includes('node_modules')) return;
            if (id.includes('/firebase/') || id.includes('/@firebase/')) return 'firebase';
            if (/\/react(-dom)?\//.test(id) || id.includes('/scheduler/')) return 'react-vendor';
          },
        },
      },
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
        // jspdf sine ubrukte optionals (vi lager kun tekst-PDF) → tom stub for
        // å holde ~230 KB ute av PDF-chunken.
        'html2canvas': path.resolve(__dirname, 'src/stubs/empty.ts'),
        'canvg': path.resolve(__dirname, 'src/stubs/empty.ts'),
        'dompurify': path.resolve(__dirname, 'src/stubs/empty.ts'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
