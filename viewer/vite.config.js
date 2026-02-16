import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

const DATA_CACHE = 'tis-data'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'VX220 / Speedster Manual',
        short_name: 'VX220 Manual',
        description: 'Opel/Vauxhall TIS2Web service documentation for VX220 and Speedster',
        theme_color: '#1a1a2e',
        background_color: '#16213e',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        globIgnores: ['**/data/**', '**/data-*/**'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/data\//],
        runtimeCaching: [
          {
            urlPattern: /^https?:\/\/[^/]+\/data\/manifest\.json$/,
            handler: 'NetworkFirst',
            options: {
              cacheName: DATA_CACHE,
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 1, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^https?:\/\/[^/]+\/data\//,
            handler: 'CacheFirst',
            options: {
              cacheName: DATA_CACHE,
              expiration: { maxEntries: 5000, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
})
