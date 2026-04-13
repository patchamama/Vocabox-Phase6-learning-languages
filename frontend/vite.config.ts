/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: '/vocabox/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Vocabox – Aprende Idiomas',
        short_name: 'Vocabox',
        description: 'Sistema de repetición espaciada para aprender vocabulario',
        theme_color: '#3B82F6',
        background_color: '#0f172a',
        display: 'standalone',
        start_url: '/vocabox/',
        icons: [
          { src: '/vocabox/icon-72.png',  sizes: '72x72',   type: 'image/png' },
          { src: '/vocabox/icon-96.png',  sizes: '96x96',   type: 'image/png' },
          { src: '/vocabox/icon-128.png', sizes: '128x128', type: 'image/png' },
          { src: '/vocabox/icon-144.png', sizes: '144x144', type: 'image/png' },
          { src: '/vocabox/icon-152.png', sizes: '152x152', type: 'image/png' },
          { src: '/vocabox/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/vocabox/icon-384.png', sizes: '384x384', type: 'image/png' },
          { src: '/vocabox/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/vocabox/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: '/vocabox/icon.svg',     sizes: 'any',     type: 'image/svg+xml' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
      },
    }),
  ],
  test: {
    environment: 'node',
    globals: true,
  },
  server: {
    proxy: {
      '/vocabox/api': {
        target: 'http://localhost:9009',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/vocabox/, ''),
      },
    },
  },
})
