# CGM to PNG Conversion & Diagram Viewer

## Overview

The TIS2Web documentation contains wiring diagrams in CGM (Computer Graphics Metafile) format, which is a legacy ISO standard for 2D vector graphics that modern browsers cannot display natively.

## CGM Conversion

### Approach Taken

We used the web-based CGM viewer at `https://www.sdicgm.com/cgmview/` to convert CGM files to PNG format via browser automation with Playwright.

### Key Findings

1. **CGM Format**: Legacy vector graphics format, not supported by modern browsers
2. **Website's SVG Export**: The sdicgm.com viewer's "Save as SVG" function does NOT produce true vector SVGs - it embeds a rasterized PNG inside the SVG using base64 encoding (see `saveRedline()` function in their `view.js`)
3. **WebAssembly Parser**: The website uses a large (~4.2MB) WebAssembly module (`cgmparse.js`) for CGM parsing, making client-side integration impractical
4. **True Vector Conversion**: Would require commercial tools (like SDI's Cgm2svg.exe) or significant development with less mature open-source libraries

### Conversion Script: `transform-cgm.js`

Location: `c:\Users\PC\TIS\transform-cgm.js`

**Features:**
- Uses Playwright to automate the sdicgm.com web viewer
- Configurable viewport size (default: 4K resolution 3840×2160 for high-quality output)
- Batch processes all CGM files from `viewer/public/data/assets/`
- Outputs PNG files to `viewer/public/data/assets/converted/`
- Includes retry logic for reliability

**Configuration:**
```javascript
const CONFIG = {
  cgmViewerUrl: 'https://www.sdicgm.com/cgmview/',
  inputDir: './viewer/public/data/assets',
  outputDir: './viewer/public/data/assets/converted',
  format: 'png',
  headless: true,
  timeout: 60000,
  retries: 2,
  viewport: { width: 3840, height: 2160 }
}
```

**Usage:**
```bash
node transform-cgm.js
```

### Conversion Results

- **67 CGM files** converted to PNG
- **4K resolution** (3840×2160) for high detail
- **Total size**: ~51.5 MB
- **Output location**: `viewer/public/data/assets/converted/`

### Content File Updates

After conversion, all HTML and JSON content files were updated to reference the new PNG paths:
- Changed: `/data/assets/[hash].cgm` → `/data/assets/converted/[hash].png`

## Diagram Viewer Component

### Architecture

The diagram viewing functionality is split between two components:

1. **DiagramViewer** (`viewer/src/components/ContentViewer.jsx`)
   - Wrapper component that handles diagram data and layout
   - Renders the title, MapViewer, and component tables
   - Shows fallback message for unconverted CGM files

2. **MapViewer** (`viewer/src/components/MapViewer.jsx`)
   - Google Maps-style interactive image viewer
   - Built on `react-zoom-pan-pinch` library
   - Handles all zoom/pan interactions

### MapViewer Features

**Interactions:**
- Scroll wheel to zoom in/out
- Click and drag to pan (free movement in all directions)
- Double-click to zoom in
- Pinch-to-zoom on touch devices

**Controls:**
- Zoom in (+) button
- Zoom out (-) button  
- Reset view button
- Fit to view button (scales and centers image to fit container)

**Visual Elements:**
- Minimap in bottom-left showing viewport position on full image
- Zoom level indicator (percentage) in bottom-right
- Help text: "Scroll to zoom | Drag to pan | Double-click to zoom in"

**Keyboard Shortcuts:**
- `+` or `=` - Zoom in
- `-` or `_` - Zoom out
- `0` - Reset view
- `F` - Fit to view
- Arrow keys - Pan in direction

### Key Implementation Details

**react-zoom-pan-pinch Configuration:**
```javascript
<TransformWrapper
  initialScale={1}
  minScale={0.1}
  maxScale={10}
  centerOnInit={true}
  limitToBounds={false}  // Allows free panning beyond image edges
  wheel={{ step: 0.1 }}
  doubleClick={{ mode: 'zoomIn', step: 0.7 }}
  panning={{ velocityDisabled: false }}
/>
```

**Fit-to-View Centering:**
The `handleFitToView` function manually calculates centered position to ensure proper centering:
```javascript
const scaleX = container.width / imageWidth
const scaleY = container.height / imageHeight
const newScale = Math.min(scaleX, scaleY, 1) * 0.95

const scaledWidth = imageWidth * newScale
const scaledHeight = imageHeight * newScale
const x = (container.width - scaledWidth) / 2
const y = (container.height - scaledHeight) / 2

transformRef.current.setTransform(x, y, newScale, 300, 'easeOut')
```

### CSS Styling

Location: `viewer/src/App.css`

Key classes:
- `.map-viewer` - Main container (600px height, dark background, rounded corners)
- `.map-controls` - Control button group (top-right, white background)
- `.map-control-btn` - Individual control buttons
- `.map-minimap` - Minimap container (bottom-left)
- `.minimap-viewport` - Blue rectangle showing current viewport
- `.map-zoom-indicator` - Zoom percentage display (bottom-right)
- `.map-viewer-help` - Help text overlay
- `.diagram-viewer` - Parent container for diagram content
- `.diagram-map-container` - Wrapper around MapViewer

## Alternative CGM Solutions

### Commercial
- **SDI Tools** (sdicgm.com) - Cgm2svg.exe command-line converter
- Various CAD software with CGM import

### Open Source
- `LegalizeAdulthood/cgm` - C++ CGM library (requires significant integration)
- `ralcgm` - Older C-based converter
- Note: Open source options lack the maturity for production use

## File References

- `transform-cgm.js` - Batch conversion script
- `viewer/public/data/assets/` - Original CGM files
- `viewer/public/data/assets/converted/` - Converted PNG files
- `viewer/src/components/ContentViewer.jsx` - DiagramViewer wrapper component
- `viewer/src/components/MapViewer.jsx` - Interactive zoom/pan viewer component
- `viewer/src/App.css` - Diagram and MapViewer styling

## Dependencies

- `react-zoom-pan-pinch` - Core library for zoom/pan functionality
