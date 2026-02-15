# TIS2Web Scraper & Viewer

Extract and modernize Opel/Vauxhall TIS2Web service documentation into a React-based viewer. Supports VX220/Speedster with **Z20LET (Turbo)** and **Z22SE (NA)** engine variants.

**Full pipeline and troubleshooting:** [docs/tis-scraper.md](docs/tis-scraper.md) — actionable reference for scraper, transform, merge, and viewer data flow.

Other docs: [docs/app-header.md](docs/app-header.md) (header nav & breadcrumb), [docs/menu.md](docs/menu.md) (sidebar nav), [docs/epc.md](docs/epc.md) (parts catalog), [docs/cgm-viewer.md](docs/cgm-viewer.md), [docs/hotspot-editor.md](docs/hotspot-editor.md).

## What it does

1. **Scrapes** TIS2Web (Playwright) from a VM at `localhost:9090` — tree expansion, document fetch, asset download
2. **Transforms** HTML into typed JSON (procedures, TSBs, diagrams, torque, tools, glossary) and extracts references
3. **Merges** multiple engine variants (optional) into one manifest with engine tags and filtering
4. **Serves** content via a React SPA with tree/column nav, engine filter, and semantic viewers

## Files

| File | Purpose |
|------|---------|
| `scrape-tis.js` | Scraper — `--engine z20let` (default) or `--engine z22se`; writes to `output-z20let/` or `output-z22se/` |
| `transform-content.js` | Transformer — `--input <dir> --output <dir>`; HTML → JSON + references |
| `merge-variants.js` | Merge — `--z20let <dir> --z22se <dir> [--output <dir>]`; single manifest + engine tags |
| `transform-spa.js` | Legacy transformer (basic copy + link resolution) |
| `viewer/` | React SPA; reads `viewer/public/data/` (merged or single-variant) |

## Prerequisites

- Node.js 18+
- TIS2Web in a VirtualBox VM with port forwarding to `localhost:9090`
- ~500MB+ disk per engine variant

## Installation

```bash
npm install
cd viewer && npm install
```

## Usage

### Single engine (e.g. Turbo only)

```bash
node scrape-tis.js                                    # → output-z20let/
node transform-content.js --input output-z20let --output viewer/public/data
cd viewer && npm run dev
```

### Two engines (Turbo + NA)

```bash
node scrape-tis.js                                    # → output-z20let/
node scrape-tis.js --engine z22se                     # → output-z22se/
node transform-content.js --input output-z20let --output viewer/public/data-z20let
node transform-content.js --input output-z22se --output viewer/public/data-z22se
node merge-variants.js --z20let viewer/public/data-z20let --z22se viewer/public/data-z22se --output viewer/public/data
cd viewer && npm run dev
```

The viewer then shows an engine filter (All / Z20LET (Turbo) / Z22SE (NA)) and filters the tree and content by selected engine.

### Viewer

```bash
cd viewer
npm run dev      # Development — http://localhost:5173
npm run build    # Production build
npm run preview  # Preview build — http://localhost:4173
```

### Content types (transform)

The transformer classifies HTML into: `procedure`, `tsb`, `harness_diagram`, `torque_table`, `tool_list`, `glossary`, `diagnostic`, `generic`, and extracts tools, torque values, pictograms, and glossary terms into `viewer/public/data/references/`. See [docs/tis-scraper.md](docs/tis-scraper.md) for detection rules and output shapes.

### Legacy transform

`node transform-spa.js` — basic copy + `tocIdToSlug`, no semantic parsing.

---

## Scraper phases (summary)

1. **Expand tree** — Click every `img[src*='closed']` in the TOC frame until none remain (2–5 min). Re-acquire frame each iteration.
2. **Parse tree** — Recursively parse nested `<table class="tree">` into `roots` and `nodes`; extract `TFormSubmit` params for tocIds.
3. **Fetch leaves** — Request each leaf URL, clean HTML, download assets; save to `pages/` and `assets/`; skip duplicates by hash.

Details, selectors, and failure modes: [docs/tis-scraper.md](docs/tis-scraper.md).

---

## Critical lessons (post-mortem)

- **Locale**: TIS serves different content by language; French has far fewer pages. Always use `locale: 'en-GB'` (and `Accept-Language: en-GB`) in the Playwright context.
- **Tree expansion**: Only reliable approach is click-every-closed-icon until none remain (3 consecutive zeros). No level heuristics. See [docs/tis-scraper.md](docs/tis-scraper.md).
- **TFormSubmit**: 4th param can be `'_top'` or `null`; regex must handle both. Link resolution uses `tocIdToSlug` (scraper/transform).
- **Frames**: Re-acquire TOC frame each iteration; document URL returns frameset — content comes from iframe.
- **Images**: Use `\s*` in `src` regex (whitespace in attributes). CGM files are downloaded; browser display needs future conversion (e.g. SVG).

---

## Troubleshooting

| Issue | Likely cause | See |
|-------|----------------|-----|
| SI/ISD link not found | Dialogs or load | Screenshots in `output-*/_screenshots/` |
| Partial content / missing sections | Locale | Use `en-GB` in Playwright context |
| Frame context destroyed | Frame reload | Scraper re-acquires frame; normal |
| Tree stops with closed folders left | Low iterations | Increase `maxIterations` in `scrape-tis.js` |
| Sidebar shows wrong engine’s leaves | Filter not applied | Ensure `selectedEngine` and `visibleNodeIds` passed to all TreeGroup/TreeNode |

Full layout (output dirs, viewer data, merged manifest): [docs/tis-scraper.md](docs/tis-scraper.md).

---

## Completed

- Structured content parsing (procedures, TSBs, diagrams, torque, tools, glossary)
- Multi-engine support (Z20LET + Z22SE): scrape per engine, transform, merge, engine filter + badges in viewer
- Faceted navigation (tools, torque, pictograms, glossary) with links back to procedures
- Semantic viewers per content type; phase detection and inline images for procedures

## Future

1. **CGM to SVG conversion** - Convert diagrams to web-friendly format using libcgm
2. **Full-text search** - Index structured JSON content for better search
3. **LLM-assisted parsing** - Use AI to parse complex ASCII-layout content
4. **Offline PWA** - Make the viewer work offline with service workers
5. **Print styling** - Add print-optimized CSS for workshop use
6. ~~**Breadcrumb navigation**~~ ✅ Interactive breadcrumb in AppHeader with tree path tracing
7. **Image callout highlighting** - Overlay clickable hotspots on numbered diagram callouts

---

## Stats (Vauxhall SPEEDSTER/VX220 2003, en-GB)

Rough orders: per variant ~850–920 docs, ~1k pages scraped, 14 roots; merged ~1.3k sections, ~2.2k tree nodes. French locale yields far fewer pages — **always use `en-GB`**. See [docs/tis-scraper.md](docs/tis-scraper.md) for manifest shapes and pipeline details.

---

## License

This project is for personal use to modernize access to legitimately owned service documentation. The TIS2Web software and content are property of General Motors / Opel / Vauxhall.
