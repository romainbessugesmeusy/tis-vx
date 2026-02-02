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
| `description` | Part description | "PANEL,ASSY.,CLAMSHELL,FRONT" |
| `usage` | Engine/trim variant | "Z20LET", "Z22SE", "" |
| `range` | Model range | Usually empty |
| `qty` | Quantity per vehicle | "1", "2", "AR" |
| `partNo` | Opel/Vauxhall part number | "9198356" |
| `katNo` | Catalog number | "48 01 403" |
| `diagramId` | Reference to diagram in diagrams map | "abc123def456" |

### Diagram Handling
- Each unique diagram is downloaded once
- Diagrams are hashed by URL to create unique filenames
- Multiple parts can reference the same diagram (via `diagramId`)
- The `ref` number on each part corresponds to a numbered callout on the diagram

## Viewer Components

### EPCBrowser (`viewer/src/components/EPCBrowser.jsx`)

Main component for browsing the parts catalog.

**Features:**
- **Groups Grid**: Visual grid of all groups (A-R) with icons
- **Hierarchical Navigation**: Drill down through levels with breadcrumbs
- **Parts Table**: Sortable columns (click headers), filterable by search
- **Diagram Viewer**: Modal popup showing diagram when clicking Ref number
- **Global Search**: Search across all parts by description, part number, or catalog number

**Routes:**
- `/epc` - Groups grid (home)
- `/epc/:groupId` - Sub sections list
- `/epc/:groupId/:subSectionId` - Main items list
- `/epc/:groupId/:subSectionId/:mainId` - Parts table

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
- `.epc-parts-table` - Parts table with sortable headers
- `.epc-diagram-modal` - Diagram viewer modal
- `.sidebar-mode-toggle` - Manual/Parts mode toggle

## Statistics (as of last scrape)

- **15 Groups**
- **130 Sub Sections**
- **332 Main Items**
- **3018 Parts**
- **332 Diagrams**

## Future Improvements

Potential enhancements:
1. Part number cross-reference with service manual procedures
2. Search by diagram callout number
3. Export parts list to CSV
4. Highlight part location on diagram when hovering table row
5. Price lookup integration (if API available)
