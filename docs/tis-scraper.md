# TIS2Web Scraper & Pipeline

Actionable reference for the TIS scraper, transformer, merge script, and viewer data flow. For human and AI coders.

## Quick reference

| Step | Command | Purpose |
|------|---------|---------|
| Scrape (Turbo) | `node scrape-tis.js` | Scrape Z20LET to `output-z20let/` |
| Scrape (NA) | `node scrape-tis.js --engine z22se` | Scrape Z22SE to `output-z22se/` |
| Transform (default) | `node transform-content.js` | `output/` → `viewer/public/data/` |
| Transform (variant) | `node transform-content.js --input output-z20let --output viewer/public/data-z20let` | One variant to a data dir |
| Merge | `node merge-variants.js --z20let viewer/public/data-z20let --z22se viewer/public/data-z22se --output viewer/public/data` | Merge two variants for viewer |
| Viewer | `cd viewer && npm run dev` | Dev server (port 5173) |
| Preview | `cd viewer && npm run preview` | Production preview (port 4173) |

**Prerequisites:** Node.js 18+, TIS2Web VM with port forwarding to `localhost:9090`, ~500MB+ disk per variant.

---

## Architecture

```
TIS2Web (VM:9090)  →  Scraper (Playwright)  →  output-{engine}/
       ↓                      ↓
  Frames, TFormSubmit     manifest.json, pages/*.html, assets/

output-{engine}/  →  transform-content.js  →  viewer/public/data-{engine}/
       ↓                        ↓
  manifest + HTML          manifest.json, content/*.json|html, references/

data-z20let + data-z22se  →  merge-variants.js  →  viewer/public/data/
       ↓                              ↓
  Two manifests                 Single manifest with engines[], variants
```

- **Scraper** drives the browser, expands the TOC, parses the tree, fetches each leaf document and assets. Output is engine-specific dirs (`output-z20let`, `output-z22se`).
- **Transformer** reads one scraper output dir, classifies HTML into content types, parses to JSON, extracts references, writes to a viewer data dir (default or `--output`).
- **Merge** reads two viewer data dirs, aligns trees by path+title, tags nodes/sections with `engines` and `variants`, copies all content, writes one merged manifest and content into `viewer/public/data`.

---

## 1. Scraper (`scrape-tis.js`)

### Config and CLI

- **Engine:** `node scrape-tis.js` → Z20LET, output `output-z20let/`.  
  `node scrape-tis.js --engine z22se` → Z22SE, output `output-z22se/`.
- **ENGINES** (in script): `z20let` → label `/Z.*20.*LET/i`, dir `output-z20let`, code `Z20LET`; `z22se` → label `/Z.*22.*SE/i`, dir `output-z22se`, code `Z22SE`.
- All paths (outputDir, pagesDir, assetsDir, rawDir, screenshotsDir) are derived from the chosen engine’s `dir`.
- Vehicle selection uses `#vc\.attributename\.salesmake`, `.model`, `.modelyear`, `.engine`; engine option is selected by the engine’s `label` regex (fallback value `"1"` for turbo, `"2"` for NA if needed).
- **Other config:** `baseUrl: "http://localhost:9090/tis2web/"`, `headless: false`, `throttleMs: 80`, `maxIterations: 2000`. Increase `maxIterations` if the log still shows closed folders at the end.

### Phases

1. **Vehicle & navigation:** Dismiss dialogs, select vehicle (make/model/year/engine), open SI/ISD, go to Assembly Groups.
2. **Expand tree:** In a loop, find `img[src*='closed']` in the TOC frame, click the first until none remain (or `maxIterations`). Need 3 consecutive “0 closed” before stopping. Periodically scroll the TOC. Re-acquire the TOC frame each iteration (frame can reload).
3. **Parse tree:** Recursively parse nested `<table class="tree">`: rows → second cell has link + optional nested table. Extract `TFormSubmit('...','...','...', ...)` params for node IDs; build `roots` and `nodes` with `id`, `title`, `parentId`, `children`, `isLeaf`, `formParams`.
4. **Fetch leaves:** For each leaf, request document URL, get content frame if needed, clean HTML (strip scripts/ActiveX, fix image srcs with `\s*` in regex), download assets/images, save to `pages/` and `assets/`. Dedupe by content hash. Manifest gets `pages[]`, `tree`, and is written to `outputDir/manifest.json` with `vehicle.engine` set to the engine code.

### Critical behaviour

- **Locale:** Browser context must use `locale: 'en-GB'` and `Accept-Language: en-GB`. French gives far fewer pages.
- **Tree expansion:** Only reliable method is “click every closed icon until none”. No level heuristics or DOM-diff tricks.
- **TOC frame:** Use `getTocFrame(page)` (frame name `tociframepanel`) and re-get it every iteration; handle “Execution context destroyed” by retrying.
- **Links:** In-page links are `TFormSubmit('formId','...','tocId', '_top'|null)`. Transform/build step later maps tocId → slug for the viewer.
- **Images:** Match `src` with whitespace: `/src\s*=\s*["']([^"']+)["']/gi`.

### Output layout (per engine)

```
output-z20let/   (or output-z22se/)
├── manifest.json     # pages[], tree{ roots, nodes }, vehicle.engine
├── pages/            # {slug}-{formId}.html (cleaned)
├── raw/             # Original HTML
├── assets/
│   ├── cgm/
│   └── images/
├── toc-expanded.html # Debug (after Phase 1)
└── _screenshots/
```

### Troubleshooting (scraper)

| Symptom | Cause | Action |
|---------|--------|--------|
| Tree stops with “X closed folders” | `maxIterations` too low | Raise to 2000–3000 in config |
| Few sections / ~260 pages | Wrong locale | Ensure `locale: 'en-GB'` in context |
| SI/ISD link not found | Dialogs or load issue | Check `_screenshots/`, dismiss dialogs |
| Execution context destroyed | Frame reload | Normal; scraper re-acquires frame |
| Images missing in output | `src` regex | Use `\s*` in image src regex |
| Wrong engine content | Engine dropdown | Check ENGINES label regex and fallback value |

---

## 2. Transformer (`transform-content.js`)

### CLI

- **Default:** `node transform-content.js` → reads `output/`, writes `viewer/public/data/`.
- **Variant:** `--input <scraper-output-dir>` and `--output <viewer-data-dir>`.

Examples:

```bash
node transform-content.js --input output-z20let --output viewer/public/data-z20let
node transform-content.js --input output-z22se --output viewer/public/data-z22se
```

### Role

- Reads `manifest.json` and `pages/*.html` from input dir.
- Classifies each HTML into one of: `procedure`, `tsb`, `harness_diagram`, `torque_table`, `tool_list`, `glossary`, `diagnostic`, `generic`.
- Parses into typed JSON (phases/steps, remedyContent, components, etc.), extracts references (tools, torque values, pictograms, glossary).
- Writes per-doc `content/<id>.json` and `content/<id>.html` (fallback for generic), plus `references/*.json`, and copies assets to output. Builds enhanced manifest: `vehicle`, `sections`, `tree` (from scraper), `tocIdToSlug`, `contentTypeStats`, `references` counts.

### Content types (summary)

| Type | Typical detection | Output shape |
|------|-------------------|--------------|
| procedure | `table.mainstep`, `.gt-picto`, FONT phase markers | phases[], steps[], torqueValues[] |
| tsb | `<pre>` blocks, `.field-name`, “Field Remedy” title | subject, remedyContent[], parts[] |
| harness_diagram | `.diagram`, CGM, component tables | components[], locations[] |
| torque_table | “Torque Values” in title | group, values[] |
| tool_list | “Special Service Tools” | group, tools[] |
| glossary | “Technical ABC”, “Pictograms”, “Conversion” | terms[], pictograms[], conversions[] |
| diagnostic | “Reference Curve”, Tech 31/32 | objective, procedure[], measurements[] |
| generic | Fallback | htmlContent preserved |

### Output layout (per variant)

```
viewer/public/data-z20let/
├── manifest.json   # sections[], tree, tocIdToSlug, contentTypeStats, references
├── content/        # *.json, *.html
├── references/    # tools.json, torque-values.json, pictograms.json, glossary.json
└── assets/         # cgm/, images/
```

---

## 3. Merge (`merge-variants.js`)

### CLI

- **Two variants:**  
  `node merge-variants.js --z20let <viewer-data-dir> --z22se <viewer-data-dir> [--output <dir>]`  
  Default `--output` is `viewer/public/data`.
- **Single variant (tag only):**  
  `node merge-variants.js --z20let viewer/public/data-z20let --output viewer/public/data`  
  Copies that variant and adds `engines: ["Z20LET"]` (no Z22SE).

### Behaviour

- Loads both manifests, builds “path from root to node” (titles) for every node.
- Aligns leaves by path+title: same path+title → both engines; only in one tree → that engine. Builds `leafMapping`: pathKey → `{ engines, variants: { Z20LET: { slug, filename, htmlFilename }, Z22SE: { ... } } }`.
- Merges trees: merged node IDs (`m_<hash>`), `engines` on every node (leaf from leafMapping, folder gets both), `variants` on leaves when both slugs exist. Sets `parentId` so hierarchy is consistent.
- Merged manifest: `vehicle.engines: ["Z20LET","Z22SE"]`, `sections[]` with `engines` and `variants`, `tree.{ roots, nodes }` with `engines`/`variants`, merged `tocIdToSlug`. Copies all content from both input dirs into output (content, references, assets).

### Merged manifest shape (relevant bits)

- `vehicle.engines`: array of engine codes.
- `sections[].engines`, `sections[].variants`: per-doc engine tags and slug per engine.
- `tree.nodes[id].engines`, `tree.nodes[id].variants`: same for tree nodes; viewer uses this for filtering and slug resolution.

---

## 4. Viewer data flow

- **Single-engine (legacy):** `manifest.vehicle.engine` (string). No engine selector; one tree, one set of content.
- **Multi-engine (merged):** `manifest.vehicle.engines` (array). Header shows engine pills (All / Z20LET (Turbo) / Z22SE (NA)). Selection stored in state + localStorage; passed to Sidebar and ContentViewer.
- **Sidebar:** Builds `visibleNodeIds` when an engine is selected (leaves with that engine + ancestors). Filters roots and all children by `visibleNodeIds`; resolves slug via `node.variants[engine].slug` or `tocIdToSlug`. Tree and column layouts both respect the filter. Engine badges (Turbo/NA) on leaves that have a single engine.
- **ContentViewer:** Resolves content slug from section/node `variants` using `selectedEngine`; loads `/data/content/<slug>.json` (or .html). Shows a note when “All” is selected and the doc has multiple variants.

---

## 5. End-to-end workflows

### Single engine (e.g. Turbo only)

1. `node scrape-tis.js` → `output-z20let/` (or copy existing `output/` to `output-z20let/`).
2. `node transform-content.js --input output-z20let --output viewer/public/data`.
3. Run viewer; no engine selector if manifest has only one engine.

### Two engines (Turbo + NA)

1. Scrape both:  
   `node scrape-tis.js` → `output-z20let/`  
   `node scrape-tis.js --engine z22se` → `output-z22se/`
2. Transform both:  
   `node transform-content.js --input output-z20let --output viewer/public/data-z20let`  
   `node transform-content.js --input output-z22se --output viewer/public/data-z22se`
3. Merge:  
   `node merge-variants.js --z20let viewer/public/data-z20let --z22se viewer/public/data-z22se --output viewer/public/data`
4. Run viewer; engine selector and filtering appear.

### After a re-scrape of one variant

Re-run transform for that variant, then merge again so `viewer/public/data` is up to date.

---

## 6. File map (where to change what)

| Goal | File |
|------|------|
| Add/change engine, output dirs, throttle, maxIterations | `scrape-tis.js` (ENGINES, config) |
| Vehicle selectors / TOC selectors | `scrape-tis.js` (selectVehicle, getTocFrame, expand) |
| Tree parsing / link extraction | `scrape-tis.js` (parseTreeStructure, TFormSubmit regex) |
| Content classification / new content type | `transform-content.js` (classifyContent, parse* functions) |
| Reference extraction (e.g. tools, torque) | `transform-content.js` (ReferenceExtractor, parsers) |
| Merge logic / engine tags | `merge-variants.js` |
| Engine filter UI, sidebar filtering, badges | `viewer/src/App.jsx`, `viewer/src/components/Sidebar.jsx` |
| Content slug resolution, variant note | `viewer/src/components/ContentViewer.jsx` |

---

## 7. Manifest and IDs

- **Scraper manifest:** `pages[]` (tocId, title, slug, file), `tree.{ roots, nodes }` (TIS node IDs), `vehicle.engine` (code string).
- **Viewer manifest (single):** `sections[]` (id, title, contentType, filename, htmlFilename), same `tree` and `tocIdToSlug` (tocId → slug).
- **Viewer manifest (merged):** Same plus `vehicle.engines`, `sections[].engines` and `sections[].variants`, `tree.nodes[id].engines` and `.variants`. Merged node IDs are `m_<hash>`; `tocIdToSlug` is union of both source maps so both TIS tocIds resolve to the correct slug.

---

## 8. Debug tips

- **Scraper:** Keep `headless: false`, watch the browser. Inspect `output-*/toc-expanded.html` and `_screenshots/` if the tree or selection is wrong.
- **Transform:** Inspect `output-*/pages/<id>.html` and `viewer/public/data/content/<id>.json` to debug classification or parsing.
- **Merge:** Log merged node count and a sample node’s `engines`/`variants` to confirm alignment.
- **Viewer:** Check manifest in Network tab; confirm `vehicle.engines` and node `engines`/`variants` when testing filter and content loading.

---

## 9. RAG and chat indexes

After `transform-content.js` (and `merge-variants.js` if used), build retrieval indexes:

```bash
node build-rag-index.js
```

Optional flags:

```bash
node build-rag-index.js --data-dir viewer/public/data --output-dir viewer/public/data/rag
```

### Generated files

`viewer/public/data/rag/`:

- `procedure-chunks.json` - chunked retrieval corpus with deterministic `chunkId`
- `doc-metadata.json` - content metadata (`contentType`, engines, tree paths)
- `parts-index.json` - flattened EPC parts index
- `part-procedure-links.json` - joined TIS `parts[]` to EPC `partNo`/`katNo`
- `diagram-grounding.json` - part-to-diagram-to-hotspot grounding data
- `index-manifest.json` - index build stats and file counts

### API server

Run the RAG API server:

```bash
node rag-server.js
```

Endpoints:

- `POST /api/retrieve` - retrieval-only debug payload
- `POST /api/locate-part` - part/diagram/hotspot lookup
- `POST /api/chat` - structured chat response with citations

Runtime behavior notes:

- LLM provider settings are supplied by the chat UI (`localStorage`) on each `/api/chat` request (`provider` + `llm.apiKey` + optional `llm.model`), so the server does not require provider keys in environment variables.
- If `provider` is set but the API key is missing or the provider call fails, `/api/chat` falls back to retrieval-based output and appends a warning instead of returning HTTP 500.
- If indexes are not loaded, retrieval endpoints return HTTP 503 with guidance to run `node build-rag-index.js` and restart `node rag-server.js`.
- Invalid JSON request bodies return HTTP 400 (`{ ok: false, error: "Invalid JSON request body" }`).

For the viewer dev server, `viewer/vite.config.js` proxies `/api` to `http://localhost:3002`.
