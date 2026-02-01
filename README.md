# TIS2Web Scraper & Viewer

A complete solution for extracting and modernizing documentation from the legacy Opel/Vauxhall TIS2Web service information system.

## Project Overview

This project scrapes the TIS2Web application (running in a VirtualBox VM) and transforms the content into a modern React-based viewer. The original TIS2Web uses outdated technologies (frames, ActiveX, CGM diagrams) with poor UX.

### What This Project Does

1. **Scrapes** all service documentation from TIS2Web using Playwright browser automation
2. **Downloads** assets (CGM diagrams and dynamic images)
3. **Preserves** the hierarchical tree structure (folders and documents)
4. **Cleans** the HTML content (removes scripts, ActiveX, proprietary tags)
5. **Transforms** `TFormSubmit` JavaScript links into functional relative links
6. **Serves** the content via a modern React SPA with tree navigation and search

## Architecture

```
TIS2Web (VM:9090)  →  Scraper (Playwright)  →  Transform  →  React Viewer
     ↓                      ↓                     ↓              ↓
  Legacy HTML           output/raw/          manifest.json    Modern UI
  CGM diagrams          output/pages/        tree structure   Hierarchical
  ActiveX controls      output/assets/       tocIdToSlug      Sidebar
  TFormSubmit links     images/              link mapping     Searchable
```

## Files

| File | Purpose |
|------|---------|
| `scrape-tis.js` | Main scraper - expands tree, parses DOM, fetches documents |
| `transform-content.js` | **NEW** - Structured content transformer (HTML → typed JSON) |
| `transform-spa.js` | Legacy transformer (basic copy + link resolution) |
| `viewer/` | React SPA with semantic viewers for each content type |
| `output/` | Scraped content: raw HTML, cleaned pages, assets, images |

## Prerequisites

- Node.js 18+
- TIS2Web running in VirtualBox VM with port forwarding to `localhost:9090`
- ~500MB disk space for scraped content

## Installation

```bash
npm install
cd viewer && npm install
```

## Usage

### 1. Run the Scraper

```bash
node scrape-tis.js
```

This will:
- Launch a browser (headful by default for debugging)
- Navigate to TIS2Web and select the vehicle
- **Phase 1**: Click ALL closed folder icons until none remain (full tree expansion)
- **Phase 2**: Parse the nested `<table>` DOM structure to build the hierarchy
- **Phase 3**: Fetch all leaf document content and assets
- Save everything to `output/` directory

### 2. Transform the Content (Structured JSON)

```bash
node transform-content.js
```

This is the **recommended** transformation that produces structured JSON documents:

- **Classifies** each HTML document into content types (procedure, TSB, diagram, etc.)
- **Parses** content into semantic JSON structures (phases, steps, torque values, tools)
- **Extracts** cross-references (tools, torque specifications, pictograms, glossary terms)
- **Generates** reference indexes for faceted navigation
- **Copies** all assets (CGM diagrams, images) to the viewer

#### Content Types Detected

| Type | Description | Example |
|------|-------------|---------|
| `procedure` | Step-by-step repair instructions with phases (Remove/Install) | Brake caliper replacement |
| `tsb` | Technical Service Bulletins / Field Remedies | Recall notices |
| `harness_diagram` | Wiring and cable routing diagrams | Body harness layouts |
| `torque_table` | Torque specifications by component group | Engine bolt torques |
| `tool_list` | Special service tools catalog | SST group listings |
| `glossary` | Reference content (pictograms, conversions, terms) | Technical ABC |
| `diagnostic` | Test procedures with measurements | Alternator testing |
| `generic` | Fallback for unclassified content | Description pages |

#### Reference Extraction

The transformer extracts and aggregates technical data across all documents:

- **Tools**: Special service tool codes with usage locations
- **Torque Values**: All torque specifications with component context
- **Pictograms**: Phase icons (Remove, Install, Adjust, etc.)
- **Glossary Terms**: Technical terminology definitions

These are saved as JSON indexes enabling alternative navigation (e.g., "all procedures requiring tool KM-123").

### 2b. Legacy Transform (Basic)

```bash
node transform-spa.js
```

The original basic transformer (still available):
- Copies HTML files without semantic parsing
- Builds `tocIdToSlug` mapping for link resolution
- Generates basic `manifest.json`

### 3. Run the Viewer

```bash
cd viewer
npm run dev      # Development
npm run build    # Production build
npm run preview  # Preview production build
```

Open `http://localhost:5173` (dev) or `http://localhost:4173` (preview).

---

## Scraper Phases Explained

### Phase 1: Expand All Folders

The scraper clicks every closed folder icon (`img[src*='closed']`) until none remain:

```
[1] Expanding... 14 closed folders remaining
[21] Expanding... 21 closed folders remaining
...
[1201] Expanding... 4 closed folders remaining
Tree fully expanded after 1205 iterations
```

This can take 2-5 minutes depending on tree size.

### Phase 2: Parse Tree Structure

After expansion, the entire hierarchy is visible in the DOM as nested tables. The scraper parses this structure:

```
Parsed tree: 14 roots, 1851 total nodes
Found 1080 new leaf documents to fetch
```

### Phase 3: Fetch Documents

Each leaf node is fetched via HTTP:

```
[1/1080] ✓ Technical ABC
[2/1080] ✓ Body Panel Precautions
...
[1080/1080] ✓ Cable damages - Marten bite attacks
```

Duplicates are skipped based on content hash.

---

## Critical Lessons Learned (Post-Mortem)

### 1. LOCALE MATTERS - The Most Important Discovery

**Problem**: The scraper initially captured only ~260 pages when the user expected ~760.

**Root Cause**: The Playwright browser defaulted to French locale (`fr`), and **TIS2Web serves different content based on language**. The French database had significantly less documentation than the English version.

**Solution**: Set English locale in Playwright context:

```javascript
const context = await browser.newContext({ 
  locale: 'en-GB',
  extraHTTPHeaders: {
    'Accept-Language': 'en-GB,en;q=0.9'
  }
});
```

### 2. Tree Expansion Strategy - Click Until None Remain

**Problem**: The tree structure was incomplete or incorrectly nested.

**Root Cause**: Initial attempts used level-based heuristics or "before/after" DOM comparisons, which failed because TIS's DOM updates are complex.

**Solution**: The ONLY reliable approach is brute-force expansion:

```javascript
const expandAllFolders = async (page) => {
  let iteration = 0;
  const maxIterations = 2000;  // Must be high enough!
  let consecutiveZeros = 0;
  
  while (iteration < maxIterations) {
    const closedIcons = await tocFrame.$$("img[src*='closed']");
    
    if (closedIcons.length === 0) {
      consecutiveZeros++;
      if (consecutiveZeros >= 3) break;  // Confirm it's really done
      continue;
    }
    
    consecutiveZeros = 0;
    await closedIcons[0].click();
    await sleep(throttleMs);
  }
};
```

**Key insights**:
- Need **2000+ iterations** for complete trees
- Must check for **3 consecutive zeros** before stopping (DOM may be updating)
- **Periodically scroll** to ensure viewport doesn't hide folders

### 3. Parse Nested Tables for Hierarchy

**Problem**: The tree hierarchy must be accurately captured with correct parent-child relationships.

**Root Cause**: TIS uses nested `<table class="tree">` elements for hierarchy. Each row's second cell contains both the link AND any nested child table.

**Solution**: Recursive table parsing:

```javascript
const parseTable = (table, parentId) => {
  const rows = table.querySelectorAll(':scope > tbody > tr');
  rows.forEach(row => {
    const cells = row.querySelectorAll(':scope > td');
    const secondCell = cells[1];  // Contains link + nested table
    
    const link = secondCell.querySelector(':scope > a');  // Direct child only!
    const nestedTable = secondCell.querySelector(':scope > table.tree');
    
    // Extract node from link
    // Recursively parse nestedTable with this node as parent
  });
};
```

### 4. TFormSubmit Regex Must Handle `null`

**Problem**: Some `TFormSubmit` parameters weren't being extracted.

**Root Cause**: The 4th parameter can be either a quoted string `'_top'` OR unquoted `null`:

```javascript
TFormSubmit('ABC123','1','ABC123','_top')  // leaf
TFormSubmit('ABC123','1','ABC123',null)     // folder
```

**Solution**: Regex that handles both:

```javascript
const match = href.match(/TFormSubmit\('([^']+)','([^']+)','([^']+)'(?:,(?:'([^']*)'|null))?\)/);
```

### 5. Frame Context Gets Destroyed

**Problem**: "Execution context was destroyed" errors during expansion.

**Root Cause**: Some folder clicks cause the TIS frame to reload, destroying Playwright's reference.

**Solution**: Re-acquire frame reference on every iteration:

```javascript
while (iteration < maxIterations) {
  const tocFrame = getTocFrame(page);  // Get fresh reference each time
  if (!tocFrame) {
    await sleep(500);
    continue;  // Retry
  }
  // ...
}
```

### 6. Image src Attributes Have Whitespace

**Problem**: Dynamic images weren't being downloaded.

**Root Cause**: TIS HTML often has newlines in attributes:

```html
<img src=
"si/pic/i/image.jpg">
```

**Solution**: Regex must handle whitespace:

```javascript
const imgRegex = /src\s*=\s*["']([^"']+)["']/gi;  // \s* handles whitespace
```

### 7. Link Resolution via tocIdToSlug

**Problem**: `TFormSubmit` IDs in content don't match manifest slugs.

**Solution**: The scraper captures `tocId` for each node. Transform builds a mapping:

```javascript
// In transform-spa.js
const tocIdToSlug = {};
manifest.pages.forEach(page => {
  if (page.tocId) tocIdToSlug[page.tocId] = page.slug;
});

// In Sidebar.jsx
const slug = tocIdToSlug[node.id];  // node.id IS the tocId
```

### 8. Frames Within Frames

TIS2Web uses nested framesets:
```
Main Page
└── tociframepanel (TOC navigation)
└── documentiframepanel (actual content)
```

Fetching a document URL returns the frameset. Extract the actual content URL from the iframe src.

### 9. Session Management

TIS2Web only allows one active session. Handle the "already in use" dialog:

```javascript
const yes = await page.$("button:has-text('YES'), button:has-text('OUI')");
if (yes) await yes.click();
```

### 10. CGM Diagrams

CGM (Computer Graphics Metafile) format isn't supported by modern browsers. Current approach: download files and preserve for future conversion to SVG/PNG.

---

## Configuration

Edit `scrape-tis.js` to modify:

```javascript
const config = {
  baseUrl: "http://localhost:9090/tis2web/",
  headless: false,        // Set true for production
  throttleMs: 80,         // Delay between actions (ms)
  maxIterations: 2000,    // Tree expansion limit (increase if tree is incomplete)
  
  vehicle: {
    make: "Vauxhall",     // or "Opel"
    model: "SPEEDSTER",
    year: "2003",
    engine: "Z 20 LET",
  },
};
```

**Important settings**:
- `maxIterations`: Set high enough for complete tree expansion. Monitor scraper logs - if it stops with "X closed folders remaining", increase this value.
- `throttleMs`: Lower = faster but may cause errors. 80ms is a good balance.
- `headless`: Keep `false` during development to watch the scraper work.

---

## Troubleshooting

### "SI/ISD link not found"
- Check if dialogs are blocking the UI
- Verify the app loaded correctly (check screenshots in `output/_screenshots/`)

### Only getting partial content
1. Check browser locale is set to English
2. Verify all filters are being cycled through
3. Ensure `expandedIds` is reset for each filter

### Frame context destroyed
- Some clicks cause page reloads that destroy the frame context
- The scraper has recovery logic to re-navigate to AssemblyGroups

### Missing sections (A, B, E, F, M folders)
- This was a locale issue - French had fewer sections than English
- Set `locale: 'en-GB'` in browser context

---

## Output Structure

```
output/
├── manifest.json          # Index with pages[], tree{roots[], nodes{}}
├── raw/                   # Original HTML from TIS2Web
│   └── {formId}.html
├── pages/                 # Cleaned HTML
│   └── {slug}-{formId}.html
├── assets/                # Downloaded CGM diagrams
│   ├── cgm/
│   │   └── {hash}.cgm
│   └── images/            # Downloaded dynamic images
│       └── {hash}.jpg
├── toc-expanded.html      # Debug: TOC after full expansion
└── _screenshots/          # Debug screenshots
    └── *.png
```

---

## Viewer Structure

```
viewer/
├── public/
│   └── data/
│       ├── manifest.json     # Tree structure + tocIdToSlug + contentTypeStats
│       ├── content/          # Structured JSON + HTML fallback
│       │   ├── *.json        # Typed content documents
│       │   └── *.html        # HTML fallback for generic type
│       ├── references/       # Cross-reference indexes
│       │   ├── tools.json
│       │   ├── torque-values.json
│       │   ├── pictograms.json
│       │   └── glossary.json
│       └── assets/
│           ├── cgm/          # CGM diagram files
│           └── images/       # Dynamic images
├── src/
│   ├── App.jsx              # Main app with routing + reference nav
│   ├── App.css              # Styles for all viewers
│   └── components/
│       ├── Sidebar.jsx          # Hierarchical tree navigation
│       ├── ContentViewer.jsx    # Dynamic content dispatcher
│       ├── ProcedureViewer.jsx  # Semantic procedure renderer
│       ├── TsbViewer.jsx        # TSB/Field Remedy renderer
│       ├── DiagramViewer.jsx    # Harness diagram renderer
│       ├── TorqueTableViewer.jsx
│       ├── ToolListViewer.jsx
│       ├── DiagnosticViewer.jsx
│       ├── GlossaryViewer.jsx
│       └── ReferenceIndex.jsx   # Tools/Torque/Pictograms/Glossary browser
└── vite.config.js
```

### Semantic Viewers

The viewer renders content differently based on its type:

- **ProcedureViewer**: Collapsible phases (Remove/Install), numbered steps with substeps, inline images, callout badges, torque summary table
- **ReferenceIndex**: Searchable/filterable indexes for tools, torque values, pictograms, and glossary with links back to source documents

---

## Completed Improvements

- ✅ **Structured content parsing** - HTML converted to typed JSON with semantic extraction
- ✅ **Faceted navigation** - Browse by tools, torque values, pictograms, glossary
- ✅ **Cross-references** - Tools and torque values link back to source procedures
- ✅ **Semantic viewers** - Custom React components for each content type
- ✅ **Phase detection** - Procedures correctly split into Remove/Install/Adjust phases
- ✅ **Image association** - Step images displayed inline with relevant instructions

## Future Improvements

1. **CGM to SVG conversion** - Convert diagrams to web-friendly format using libcgm
2. **Full-text search** - Index structured JSON content for better search
3. **LLM-assisted parsing** - Use AI to parse complex ASCII-layout content
4. **Offline PWA** - Make the viewer work offline with service workers
5. **Print styling** - Add print-optimized CSS for workshop use
6. **Breadcrumb navigation** - Show path in tree when viewing a document
7. **Image callout highlighting** - Overlay clickable hotspots on numbered diagram callouts

---

## Statistics (Vauxhall SPEEDSTER/VX220, 2003, Z 20 LET)

### Scraping

| Metric | Value |
|--------|-------|
| Pages scraped | 984 |
| Tree nodes | 1,851 |
| Root folders | 14 |
| CGM assets | 67 |
| Images | 1,086 |
| Categories | 16 |

### Content Transformation

| Content Type | Count |
|--------------|-------|
| Procedures | 357 |
| Generic (unclassified) | 333 |
| Harness Diagrams | 84 |
| TSBs / Field Remedies | 42 |
| Diagnostic Tests | 14 |
| Torque Tables | 9 |
| Tool Lists | 7 |
| Glossary/Reference | 3 |

### Reference Extraction

| Reference Type | Count |
|----------------|-------|
| Torque Values | 930 |
| Glossary Terms | 100 |
| Special Tools | 65 |
| Pictograms | 8 |

### Locale Impact

| Locale | Pages |
|--------|-------|
| French (fr) | ~260 |
| English (en-GB) | ~984 |

**Always use English locale** - the French database has significantly less content.

---

## License

This project is for personal use to modernize access to legitimately owned service documentation. The TIS2Web software and content are property of General Motors / Opel / Vauxhall.
