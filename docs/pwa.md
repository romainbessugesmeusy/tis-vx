# PWA & Offline Mode

This document describes the Progressive Web App (PWA) and offline-download feature for the TIS2Web viewer. It is intended for agents and human developers who need to maintain or extend this functionality with full context.

## Overview and goals

- **Context**: The app is used in garages and workshops where internet is often unreliable or absent.
- **Goals**:
  - Allow the app to work offline after content has been downloaded.
  - Let users choose what to cache: reference pages (Tools, Torque, Pictograms, Glossary), Parts (EPC) by group, and Manual sections by tree root.
  - Use the same `fetch()`-based data loading; the service worker serves cached responses when offline so existing code paths stay unchanged.
- **Approach**: PWA with a single Cache API cache for data (`tis-data`), plus a Download Manager UI that pre-populates that cache. No IndexedDB; all content is request/response pairs keyed by URL.

---

## Architecture

### High-level flow

```
User opens "Offline" → Download Manager (dropdown or fullscreen on mobile)
  → User clicks "Download" on a section (or "Download all")
  → addToCache(urls) fetches each URL and cache.put(url, response) into "tis-data"
  → setStoredSectionUrls(sectionKey, urls) persists the list in localStorage

When offline:
  → App fetches /data/content/foo.json etc. as usual
  → Service worker intercepts fetch, runs CacheFirst for /data/*
  → If the URL is in "tis-data", cached response is returned; otherwise network fails
  → ContentViewer shows "This section is not available offline" if fetch fails while offline
```

### Cache and storage

| What | Where | Purpose |
|------|--------|--------|
| **Cache name** | `tis-data` (constant in `useOffline.js` and in Workbox runtime config) | Single Cache API cache for all downloadable data. Download Manager and the service worker both use this name so pre-populated entries are served by the SW. |
| **localStorage key** | `tis-offline-downloads` | JSON object: `{ [sectionKey]: string[] }`. Maps each downloaded section’s `rootId` to the list of request URLs that were cached, so we can remove them on "Remove" / "Remove all". |

### Section keys (rootId)

- **Pages**: `_ref_tools`, `_ref_torque`, `_ref_pictograms`, `_ref_glossary`
- **EPC**: `_epc_core` (parts.json + hotspots/_index.json), `_epc_group_A`, `_epc_group_B`, … (one per group in `parts.json`)
- **Manual**: tree root node IDs from the manifest (e.g. `m_fa1c44d6dc46`). Same IDs as in `manifest.tree.roots` after filtering by `isValidRootFolder`.

---

## Key files and roles

| File | Role |
|------|------|
| **viewer/src/hooks/useOffline.js** | Online/offline state (`useOnline`, `useOffline`), Cache API helpers (`openDataCache`, `addToCache`, `removeUrlsFromCache`, `removeCachedSection`), localStorage helpers for section URL lists (`getStoredSectionUrls`, `setStoredSectionUrls`, `clearStoredSection`), `getStorageEstimate()`, `requestPersistentStorage()`. |
| **viewer/src/components/DownloadManager.jsx** | Full UI: three collapsible panels (Pages, Parts EPC, Manual), per-item and "Download all" / "Remove all", progress, storage display. Builds EPC group list from `parts.json` when the EPC panel is expanded. |
| **viewer/src/App.jsx** | Renders the Offline trigger button (top-right), the dropdown panel containing `<DownloadManager />`, backdrop and fullscreen class on mobile/tablet, click-outside and Escape to close, body scroll lock when drawer is open on mobile/tablet. Passes `onOpenOfflineDownloads` to Sidebar. |
| **viewer/src/App.css** | Styles for `.header-right`, `.header-offline-dropdown`, `.header-offline-trigger`, `.header-offline-panel`, `.header-offline-panel--fullscreen`, `.header-offline-backdrop`, and `.content-offline-unavailable`. |
| **viewer/src/components/ContentViewer.jsx** | Uses `useOffline()`. When `error` is set and `isOffline` is true, renders the offline-unavailable message instead of the generic error. |
| **viewer/src/components/Sidebar.jsx** | No offline entry; the header Offline button is the sole entry point to the Download Manager. |
| **viewer/vite.config.js** | Should configure `vite-plugin-pwa` (see below). If the PWA block is missing, the app still works but there is no service worker; only the Download Manager and Cache API are used when online to fill the cache, and offline behavior depends on the browser’s handling of uncached fetches. |

---

## PWA / Service worker configuration

The project depends on **vite-plugin-pwa** (`viewer/package.json`). The service worker and manifest are only active if the plugin is wired in `viewer/vite.config.js`. If you need to restore or add it, use the following pattern.

### Intended vite.config.js (PWA block)

```js
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
        globIgnores: ['**/data/**', '**/data-merged/**'],
        navigateFallback: null,
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
```

- **Precache**: App shell only (JS, CSS, HTML, icons). `globIgnores` ensures `public/data` and `public/data-merged` are not precached (they are large and user-chosen via Download Manager).
- **Runtime cache**: All `/data/*` requests use the same cache name `tis-data`. Manifest uses NetworkFirst (with short timeout) so updates are picked up when online; everything else uses CacheFirst so cached data is used when available (including entries added by the Download Manager).

### Icons

- Placeholder icons live under `viewer/public/icons/`: `icon-192.png`, `icon-512.png`. They can be minimal (e.g. 1×1 PNG) until replaced with real assets.

---

## useOffline hook API

- **`useOnline()`** → `boolean`. Tracks `navigator.onLine` and `online` / `offline` events.
- **`useOffline()`** → `{ isOnline, isOffline }`.
- **`getDataCacheName()`** → `'tis-data'`.
- **`openDataCache()`** → `Promise<Cache | null>`. Opens the `tis-data` cache (null if `caches` is unavailable).
- **`getStoredSectionUrls()`** → `Record<string, string[]>`. Reads `localStorage['tis-offline-downloads']`.
- **`setStoredSectionUrls(sectionKey, urls)`** → Merges this section’s URL list into stored and saves.
- **`clearStoredSection(sectionKey)`** → Removes that key from the stored object and saves.
- **`addToCache(urls, onProgress?)`** → Fetches each URL (with current origin if relative), puts successful responses into `tis-data`, calls `onProgress(done, total, url)` per URL.
- **`removeUrlsFromCache(urls)`** → Deletes each URL from `tis-data`.
- **`removeCachedSection(sectionKey)`** → Loads URL list for that key from localStorage, deletes those from cache, then clears the key from localStorage.
- **`getStorageEstimate()`** → `Promise<{ usage, quota }>` from `navigator.storage.estimate()`.
- **`requestPersistentStorage()`** → `Promise<boolean>` from `navigator.storage.persist()` to reduce eviction under pressure.

URLs passed to these helpers are stored and used as-is for cache keys; when they are relative (e.g. `/data/content/foo.json`), `addToCache` and `removeUrlsFromCache` prepend `window.location.origin` before `fetch` or `cache.delete`.

---

## Download Manager

### Three collapsible panels

1. **Pages (Tools, Torque, Pictograms, Glossary)**  
   - Static list: `PAGE_ITEMS` in `DownloadManager.jsx`.  
   - Each item: `rootId` (e.g. `_ref_tools`), `title`, `urls` (single reference JSON path).  
   - Each row has Download / Remove and optional progress bar.

2. **Parts (EPC)**  
   - **Core**: Always present. `rootId: '_epc_core'`, urls: `['/data/epc/parts.json', '/data/epc/hotspots/_index.json']`.  
   - **Groups**: Built when the EPC panel is expanded. The component fetches `/data/epc/parts.json` and calls `buildEpcItems(partsData)`:
     - For each `group` in `partsData.groups`, collect every `diagramId` from `group.subSections[].main[].parts[].diagramId`.
     - For each such id, add `/data/epc/diagrams/${partsData.diagrams[id].filename}` and `/data/epc/hotspots/${id}.json` to that group’s URL list.
     - Section key: `_epc_group_${group.id}` (e.g. `_epc_group_A`).  
   - If EPC is expanded but `parts.json` hasn’t loaded yet, a "Loading groups…" placeholder is shown under Core.

3. **Manual sections**  
   - From `buildSections(manifest)` using the same logic as the sidebar: `manifest.tree.roots` filtered by `isValidRootFolder` (root title matches `^[A-R]\s+[A-Z]` or "General Vehicle").  
   - For each root, all leaf slugs under that root are collected (from `node.variants` for leaves); urls = for each slug, `['/data/content/${slug}.json', '/data/content/${slug}.html']`.  
   - `rootId` is the tree node id (e.g. `m_fa1c44d6dc46`).

### State and actions

- **expandedPanels**: `{ pages, epc, manual }`. Clicking a panel header toggles that key. All default to `true`.
- **epcPartsData**: Result of `fetch('/data/epc/parts.json').then(r => r.json())`, or null. Fetched only when `expandedPanels.epc` is true and `epcPartsData` is still null.
- **handleDownload(section)**: Requires `section.urls.length > 0`. Sets `downloadingId`, runs `addToCache(section.urls, onProgress)`, then `setStoredSectionUrls(section.rootId, urls)` and clears `downloadingId`.
- **handleRemove(section)**: Calls `removeCachedSection(section.rootId)` and refreshes stored state.
- **handleDownloadAll**: Caches `['/data/manifest.json']` first, then iterates `allItems` (PAGE_ITEMS + epc core + epc groups + manualSections) and for each runs the same addToCache + setStoredSectionUrls. Progress is global (done/total across all).
- **handleRemoveAll**: Calls `removeCachedSection(section.rootId)` for every item in `allItems`.

### UI details

- **Storage line**: Uses `getStorageEstimate()`; shows "Storage: X used of Y" and "(persistent)" if `requestPersistentStorage()` succeeded.
- **Meta line per item**: For manual sections, "X docs · Y files"; for others, "Y file(s)". EPC core shows "2 files".
- **Progress**: While a section is downloading, a thin progress bar appears under that row; "Download" label shows "done/total" during download.
- **Styling**: Panel headers use `.download-manager-panel-header`; lists use `.download-manager-list` and `.download-manager-item`. Inline `<style>` in the component defines `.download-manager-*` so the panel is self-contained; `.header-offline-panel` and fullscreen overrides live in `App.css`.

---

## App shell: Offline trigger and drawer

- **Placement**: Top-right of the header, inside a `header-right` block that also holds vehicle info and engine filter. Implemented as a dropdown: button with label "Offline", optional offline-status dot, and a chevron that rotates when open.
- **Ref**: `offlineDropdownRef` is attached to the dropdown container so that mousedown outside closes the panel (and Escape also closes it).
- **Panel**: When `showDownloadManager` is true, a div with class `header-offline-panel` is rendered; it contains `<DownloadManager manifest={manifest} onClose={() => setShowDownloadManager(false)} />`.
- **Mobile/tablet** (same breakpoint as sidebar: `isMobile || isTablet`):
  - The panel gets an extra class `header-offline-panel--fullscreen`: fixed, full viewport (100vh/100dvh), no border-radius.
  - A backdrop div `header-offline-backdrop` is rendered (sibling to main layout); clicking it or the overlay closes the drawer.
  - Body scroll is locked when either the mobile menu or the offline drawer is open on mobile/tablet (`document.body.style.overflow = 'hidden'`).
- **Sidebar**: No Offline entry; the header trigger is the only way to open the Download Manager.

---

## ContentViewer offline behavior

- **Normal**: Fetches `/data/content/${slug}.json` (and optionally `.html` for generic). No change to this flow.
- **When a fetch fails**: `setError(err.message)` is called.
- **When error is set and `isOffline` is true**: Instead of the generic error div, the component renders a block with class `content-error content-offline-unavailable` and two paragraphs: "This section is not available offline." and "When you are back online, open **Offline** in the header to download sections for use without internet."
- **When error is set and online**: Standard `content-error` with `err.message`.

---

## Data URLs reference

What the app fetches and what the Download Manager caches:

| Source | URLs |
|--------|------|
| **Manifest** | `/data/manifest.json` (cached in "Download all" and by SW NetworkFirst) |
| **References** | `/data/references/tools.json`, `torque-values.json`, `pictograms.json`, `glossary.json` |
| **Manual content** | `/data/content/{slug}.json`, `/data/content/{slug}.html` for each slug under the chosen tree roots |
| **EPC core** | `/data/epc/parts.json`, `/data/epc/hotspots/_index.json` |
| **EPC per group** | For each diagram id in that group: `/data/epc/diagrams/{filename}`, `/data/epc/hotspots/{id}.json` |

All paths are relative to the app origin; the cache stores full request URLs (origin + path).

---

## Adding a new downloadable section

1. **If it’s a new "page" (single or fixed set of URLs)**  
   - Add an entry to `PAGE_ITEMS` in `DownloadManager.jsx` with `rootId`, `title`, and `urls`.  
   - It will appear in the "Pages" panel and in `allItems` for Download all / Remove all.

2. **If it’s a new EPC-like group**  
   - EPC groups are derived from `parts.json`; no code change unless the EPC data shape changes. If you add another data source with a similar structure, add a new panel (or subsection) that fetches that source and builds a list of `{ rootId, title, urls }`, then include those in `allItems` and render them in a collapsible block.

3. **If it’s a new manual-like category**  
   - Manual sections come from `buildSections(manifest)`. To include a different slice of the tree, either extend `isValidRootFolder` or add a second builder (e.g. "Quick reference") that uses a different filter and merge its results into the Manual panel or a new panel.

4. **localStorage**  
   - Any new section key you use will be stored and cleared by the existing `getStoredSectionUrls` / `setStoredSectionUrls` / `clearStoredSection` and `removeCachedSection`; no change needed there as long as you use a unique `rootId`.

---

## Storage and limits

- **Cache name**: One cache, `tis-data`. Browsers impose a quota (often a fraction of free disk). `getStorageEstimate()` is shown in the Download Manager.
- **Persistent storage**: `requestPersistentStorage()` is called once when the Download Manager mounts so the origin may be marked persistent and less likely to be evicted under storage pressure.
- **Typical data size**: Full manual + references + EPC can be on the order of hundreds of MB to over 1 GB depending on engine variants and EPC diagrams. Users can choose to download only some panels or groups.

---

## Testing and troubleshooting

- **Offline simulation**: DevTools → Network → "Offline". Then open a document or reference page; if it was not cached, ContentViewer shows the offline-unavailable message.
- **Cache inspection**: Application (or Storage) → Cache Storage → `tis-data`. You should see request URLs and their responses after downloading sections.
- **localStorage**: Application → Local Storage → your origin → key `tis-offline-downloads`. Should be a JSON object mapping section keys to arrays of URL strings.
- **Service worker**: Only active when vite-plugin-pwa is configured in `vite.config.js` and after a production build (`npm run build`). Use `npm run preview` to test with the built SW. In dev, `vite run dev` typically does not run the generated SW.
- **Download Manager not opening**: Ensure `showDownloadManager` is toggled by the Offline button or Sidebar "Offline downloads"; check that `offlineDropdownRef` is attached and that no parent is stopping propagation.
- **EPC groups empty**: Ensure `/data/epc/parts.json` exists and has `groups` and `diagrams`. Expand the Parts (EPC) panel so the fetch runs; check network and console for errors.

---

## Summary for agents

- **Offline behavior** is driven by the Cache API cache `tis-data` and the service worker (when PWA is configured) using that same cache for `/data/*` with CacheFirst.
- **Download Manager** is the only place that writes section URL lists (localStorage) and pre-populates the cache; it uses `useOffline` for all cache and storage helpers.
- **Section keys** are stable: `_ref_*`, `_epc_core`, `_epc_group_*`, and manifest tree root ids. Use the same keys when clearing or when adding new sections.
- **Mobile**: Offline drawer is fullscreen with backdrop and body scroll lock; logic lives in App.jsx and App.css (`header-offline-panel--fullscreen`, `header-offline-backdrop`).
- **Adding content** = adding URLs to the right section and ensuring that section is in `allItems` and rendered in one of the three panels.
