# EPC (Electronic Parts Catalog) Feature

## Overview

The EPC feature provides a complete parts catalog browser for the Opel/Vauxhall Speedster & VX220, scraped from the speedsterclub.nl Electronic Parts Catalog.

## Data Source

**Source URL:** `https://www.speedsterclub.nl/bibliotheek/technische%20documentatie/epc/`

The website has a hierarchical structure:
- **Groups (A-R)**: Top-level categories (Body shell, Engine, Brakes, Steering, etc.)
- **Sub Sections**: Numbered items within each group
- **Main Items**: Numbered items within each sub section (optional level)
- **Parts**: Individual parts with detailed specifications

### Important: Variable Depth Structure

Some sections have a **2-level structure**:
```
Group → Sub Section → Parts
```

Others have a **3-level structure**:
```
Group → Sub Section → Main Items → Parts
```

The scraper detects which structure each section uses by checking if the sub-section page contains an iframe pointing to `parts.html` (2-level) or has links to main items (3-level).

## Scraper (`scrape-epc.js`)

### Dependencies
- `playwright` - Browser automation for fetching pages
- `cheerio` - HTML parsing

### Configuration
```javascript
const config = {
  baseUrl: "https://www.speedsterclub.nl/bibliotheek/technische%20documentatie/epc/",
  outputDir: "viewer/public/data/epc",
  diagramsDir: "viewer/public/data/epc/diagrams",
  headless: true,
  throttleMs: 150,
};
```

### Running the Scraper
```bash
# Install dependencies (if not already installed)
npm install
npx playwright install chromium

# Run scraper
node scrape-epc.js
```

### Output
- `viewer/public/data/epc/parts.json` - All parts data in JSON format
- `viewer/public/data/epc/diagrams/*.png` - Downloaded diagram images

### Data Structure

```json
{
  "scrapedAt": "2026-02-02T...",
  "source": "https://www.speedsterclub.nl/...",
  "groups": [
    {
      "id": "A",
      "name": "Body shell and panels",
      "image": "images/A.png",
      "subSections": [
        {
          "id": "A1",
          "name": "Partial body",
          "main": [
            {
              "id": "A1-1",
              "name": "Bonnet hinge",
              "parts": [
                {
                  "ref": "1",
                  "description": "PANEL,ASSY.,CLAMSHELL,FRONT",
                  "usage": "Z20LET",
                  "range": "",
                  "qty": "1",
                  "partNo": "9198356",
                  "katNo": "48 01 403",
                  "diagramId": "abc123def456"
                }
              ]
            }
          ]
        }
      ]
    }
  ],
  "diagrams": {
    "abc123def456": {
      "originalUrl": "https://...",
      "filename": "abc123def456.png"
    }
  }
}
```

### Part Properties
| Property | Description | Example |
|----------|-------------|---------|
| `ref` | Reference number (shown on diagram) | "1", "2", "15" |
| `description` | Raw part description (ALL CAPS, comma-separated) | "PANEL,ASSY.,CLAMSHELL,FRONT" |
| `descriptionParts` | Parsed description components (added at load time) | ["Panel", "Assy.", "Clamshell", "Front"] |
| `usage` | Engine/trim variant | "Z20LET", "Z22SE", "" |
| `range` | Model range | Usually empty |
| `qty` | Quantity per vehicle | "1", "2", "AR" |
| `partNo` | Opel/Vauxhall part number | "9198356" |
| `katNo` | Catalog number | "48 01 403" |
| `diagramId` | Reference to diagram in diagrams map | "abc123def456" |

### Description Parsing

Raw descriptions from the EPC source are ALL CAPS and comma-separated without spaces (e.g. `"CABLE,BONNET LOCK RELEASE"`). At data load time, `parseDescription()` splits by `,`, lowercases, and sentence-cases each component, storing the result as `descriptionParts`. Display uses `descriptionParts.join(', ')` for readability (e.g. "Cable, Bonnet lock release"). The original `description` field is preserved.

### Diagram Handling
- Each unique diagram is downloaded once
- Diagrams are hashed by URL to create unique filenames
- Multiple parts can reference the same diagram (via `diagramId`)
- The `ref` number on each part corresponds to a numbered callout on the diagram

## Viewer Components

### EPCBrowser (`viewer/src/components/EPCBrowser.jsx`)

Main component for browsing the parts catalog.

**Diagram-centric pages:** The viewer aggregates pages by shared diagram. Main items that share the same diagram (e.g. "Front spoiler" and "Rear spoiler" both on diagram B6) are shown on a single page. The sidebar lists one entry per diagram per group, with a combined title (e.g. "Front spoiler / Rear spoiler"). Old URLs (`/epc/:groupId/:subSectionId/:mainId`) redirect to the diagram URL.

**Features:**
- **Groups Grid**: Visual grid of all groups (A-R) with icons (home)
- **Diagram-based navigation**: Sidebar shows group → diagram leaves (no subSection level); each leaf opens one diagram page with all main items that use that diagram
- **Resizable diagram/table split**: On a diagram page, the top panel is the diagram viewer only; a horizontal drag handle resizes it; the bottom panel (part info bar, search, parts list) has its own vertical scroll. Split height is persisted in localStorage (`epc-diagram-height`)
- **Foldable part groups**: Parts are grouped by original main item (e.g. "Front spoiler", "Rear spoiler") in collapsible sections with bold headers and part count. When a diagram has only one group, the group header is hidden
- **Part info bar**: Sits below the drag handle in the table section. Shows selected/hovered part details; when empty shows placeholder "Hover or click a part to see details"
- **Parts table**: Sortable columns (click headers), filterable by search (pill-shaped search field in the table section). Smaller table header row for clearer hierarchy
- **Inline Diagram Viewer**: MapViewer fills the top panel height; zoom/pan, fullscreen
- **Center on Part**: Clicking a ref badge in the table pans and zooms the diagram to that hotspot
- **Scroll to part**: Clicking a hotspot on the diagram selects the part, expands its group if collapsed, and scrolls the table to that row (smooth, centered)
- **Global Search**: On home, search across all parts; results link to diagram pages
- **Copy Part Number**: Click any Part No cell (table or info bar) to copy to clipboard
- **Prettified Descriptions**: Raw ALL CAPS descriptions are parsed into readable sentence case

**Routes:**
- `/epc` - Groups grid (home)
- `/epc/:groupId/diagram/:diagramId` - Diagram page (one diagram, all main items that use it, foldable part groups)
- `/epc/:groupId/:subSectionId/:mainId` - Redirects to `/epc/:groupId/diagram/:diagramId` for the same content

### Sidebar Integration

The sidebar has a mode toggle between "Manual" and "Parts":
- Stored in localStorage (`tis-sidebar-mode`)
- Auto-detects mode from URL (paths starting with `/epc` = parts mode)
- Parts mode shows a simplified group navigation in the sidebar

### Group Icons
```javascript
const GROUP_ICONS = {
  A: '🚗', // Body shell and panels
  B: '🔩', // Body exterior fittings
  C: '🪟', // Body interior fittings
  D: '💺', // Body interior trim
  E: '⚙️', // Engine and clutch
  F: '❄️', // Cooling
  G: '⛽', // Fuel and exhaust
  H: '🔧', // Transmission
  J: '🛞', // Brakes
  K: '🏎️', // Front axle and suspension
  L: '🎯', // Steering
  M: '🔄', // Rear axle and suspension
  N: '⭕', // Road wheels
  P: '⚡', // Electrical
  Q: '📦', // Accessories
  R: '🚙', // Special vehicle option specification
}
```

## Styling

EPC-specific styles are in `viewer/src/App.css` under the section:
```css
/* ======================================== 
   EPC (Electronic Parts Catalog) Styles
   ======================================== */
```

Key CSS classes:
- `.epc-groups-grid` - Groups home page grid
- `.epc-group-card` - Individual group card
- `.epc-list` / `.epc-list-item` - Sub section and main item lists
- `.epc-parts-table` - Parts table with sortable headers (smaller thead on diagram page)
- `.epc-diagram-split` - Diagram page: full-height flex column
- `.epc-diagram-split-container` - Wrapper for top panel, resize handle, bottom panel
- `.epc-diagram-split-top` - Diagram viewer panel (height from `--epc-diagram-height`)
- `.epc-epc-resize-handle` - Horizontal drag handle between diagram and table (row-resize)
- `.epc-diagram-split-bottom` - Scrollable table section (overflow-y: auto)
- `.epc-diagram-group` - Diagram viewer wrapper (inside split top)
- `.epc-diagram-viewer-wrapper` - Viewer background (uses `--bg-sidebar` for consistency)
- `.epc-parts-group` / `.epc-parts-group-header` / `.epc-parts-group-content` - Foldable part sections (bold header, chevron, count)
- `.epc-part-info-bar` - Selected/hovered part info below drag handle; placeholder when empty
- `.epc-copyable` / `.epc-copy-icon` - Copy-to-clipboard interaction on part numbers
- `.sidebar-mode-toggle` - Manual/Parts mode toggle

## MapViewer & react-zoom-pan-pinch

The diagram viewer uses `react-zoom-pan-pinch` (v3.7+) with a `TransformWrapper` / `TransformComponent` pair. The library applies a CSS `transform: translate(x, y) scale(s)` with `transform-origin: 0 0` to the content div.

### Centering math

Both `handleFitToView` and the `centerOnRef` effect compute a translate/scale and pass it to `setTransform(x, y, scale, ms, easing)`:

```
x = containerWidth / 2 − cx * scale
y = containerHeight / 2 − cy * scale
```

where `(cx, cy)` is the point to center in **image-pixel coordinates** (natural dimensions). This formula assumes the image starts at `(0, 0)` of the content div. Any CSS that offsets the image (flex centering, margins, padding) will break the calculation.

### Critical CSS constraint

The library's content div (`.transform-component-module_content`) **must not** have `justify-content: center`, `align-items: center`, or any other layout property that moves the image away from the top-left origin. These would introduce a flex offset `((containerW − imageW) / 2, (containerH − imageH) / 2)` that the centering formula doesn't account for, causing the hotspot to land off-center. The error scales with zoom level and is proportionally worse on narrower viewports (mobile).

Current overrides in `App.css`:

```css
/* Wrapper: fill the container */
.map-viewer [class*="transform-component-module_wrapper"] {
  width: 100% !important;
  height: 100% !important;
  background: inherit !important;
}

/* Content: only override background — do NOT add width/height/flex alignment */
.map-viewer [class*="transform-component-module_content"] {
  background: inherit !important;
}
```

The wrapper override (`width/height: 100%`) is needed so the transform area fills the `.map-viewer` container and clips content via `overflow: hidden`. The content div must keep the library defaults (`width: fit-content; display: flex; flex-wrap: wrap; justify-content: flex-start; align-items: stretch; transform-origin: 0 0`).

## Statistics (as of last scrape)

- **15 Groups**
- **130 Sub Sections**
- **332 Main Items**
- **3018 Parts**
- **151 Unique Diagrams** (deduplicated from 332 original files)

## Diagram Deduplication

The original scrape contained 332 diagram files, but many were duplicates (same diagram used across different part categories). A deduplication process was performed:

### Process

1. **Hash Comparison**: Each diagram's pixel content was hashed using MD5
2. **Duplicate Detection**: 181 duplicate images identified (54.5% reduction)
3. **Reference Update**: 1085 part references in `parts.json` updated to canonical IDs
4. **Cleanup**: Duplicate PNG and hotspot JSON files removed

### Utility Scripts

```bash
# Find duplicates (analysis only)
node find-duplicate-diagrams.js

# Run deduplication (modifies files!)
node deduplicate-diagrams.js
```

### Reference Files

- `duplicate-diagrams-report.json` - Analysis results with duplicate groups
- `diagram-id-mapping.json` - Maps old duplicate IDs → canonical IDs

## Diagram Hotspots

Part numbers are extracted from diagram images using OCR and stored as interactive hotspots.

### Extraction Script (`extract-diagram-hotspots.js`)

```bash
# Extract hotspots from all diagrams
node extract-diagram-hotspots.js

# Extract specific diagrams
node extract-diagram-hotspots.js 52d610c5d4d2.png 78b6e087ae17.png
```

### Output
- `viewer/public/data/epc/hotspots/*.json` - Individual hotspot files per diagram
- `viewer/public/data/epc/hotspots/_index.json` - Summary index

### Hotspot JSON Structure
```json
{
  "diagramId": "52d610c5d4d2",
  "imageWidth": 1240,
  "imageHeight": 1761,
  "sheetCode": {
    "text": "C1",
    "bbox": { "x": 151, "y": 1616, "width": 44, "height": 33 },
    "confidence": 91
  },
  "hotspots": [
    {
      "ref": 2,
      "bbox": { "x": 805, "y": 469, "width": 13, "height": 18 },
      "normalized": { "x": 0.649, "y": 0.266, "width": 0.010, "height": 0.010 },
      "confidence": 96
    }
  ],
  "extractedAt": "2026-02-02T..."
}
```

### Visual Hotspot Editor

A browser-based editor is available at `/hotspot-editor.html` to:
- View detected hotspots overlaid on diagrams
- Add missing hotspots by clicking on the image
- Delete incorrect hotspots
- Export corrected JSON for manual placement

### Viewer Integration

In the EPC Browser:
- **Hover table row** → Highlights corresponding hotspot(s) on the diagram (polygon outlines only, no bounding box)
- **Hover hotspot** → Highlights corresponding table row(s)
- **Click hotspot** → Selects part, expands its foldable group if collapsed, scrolls the table section to that part (smooth), and centers diagram on the hotspot
- **Click ref badge** → Selects part and centers/zooms diagram on the hotspot (`centerOnRef` prop on MapViewer). Zooms to ~2.5× fit scale (capped at 3×) and animates (400ms easeOut)
- **Part Info Bar** → Below the resize handle in the table section; shows hovered/selected part details; placeholder "Hover or click a part to see details" when empty
- **Click Part No** → Copies to clipboard with visual feedback (checkmark)
- **Navigation reset** → Search query and selection are cleared when navigating to a different page via sidebar
- **Resize handle** → Drag to resize the diagram panel; height is stored in localStorage

## RAG Grounding Integration

The chat/RAG pipeline now consumes EPC + hotspot data to ground part explanations spatially.

### Index build

Run:

```bash
node build-rag-index.js
```

Generated grounding files:

- `viewer/public/data/rag/parts-index.json` - flattened EPC parts records with group/subSection/main context
- `viewer/public/data/rag/part-procedure-links.json` - links TIS `parts[]` (TSB/procedure) to EPC by normalized part number and catalogue number
- `viewer/public/data/rag/diagram-grounding.json` - per-part diagram grounding:
  - `diagram.id`, `diagram.filename`, `sheetCode`
  - `ref`, `hotspot.mode` (`exact`, `numeric-fallback`, `none`)
  - hotspot geometries (`bbox` and/or `points`)

### Runtime API usage

`rag-server.js` provides:

- `POST /api/locate-part` for direct part localization on diagrams
- `POST /api/chat` for responses that include:
  - `requiredParts[]`
  - `diagramGrounding[]`
  - `citations[]`

This allows responses such as "replace turbo on Z20LET" to include both procedural citations and EPC diagram callout links.

## Future Improvements

Potential enhancements:
1. Part number cross-reference with service manual procedures
2. Search by diagram callout number
3. Export parts list to CSV
4. ~~Highlight part location on diagram when hovering table row~~ ✅ Implemented
5. Price lookup integration (if API available)
6. AI-powered hotspot extraction for better accuracy