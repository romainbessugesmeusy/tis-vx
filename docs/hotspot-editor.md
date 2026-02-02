# Hotspot Editor

A visual editor for creating and managing interactive hotspots on EPC diagram images. Hotspots link part reference numbers to their locations on technical diagrams.

## Overview

The hotspot system consists of:

1. **Hotspot Server** (`hotspot-server.js`) - Express.js API for CRUD operations on hotspot JSON files
2. **Hotspot Editor** (`viewer/public/hotspot-editor.html`) - Standalone browser-based visual editor
3. **EPCBrowser Integration** (`viewer/src/components/EPCBrowser.jsx`) - Renders hotspots in the main app
4. **Extraction Script** (`extract-diagram-hotspots.js`) - OCR-based initial extraction (limited accuracy)

## Quick Start

```bash
# Terminal 1: Start the API server
npm run hotspot-server

# Terminal 2: Start Vite dev server
cd viewer && npm run dev

# Open the editor
open http://localhost:5173/hotspot-editor.html
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Hotspot Editor (HTML)                     │
│                   localhost:5173/hotspot-editor.html         │
└─────────────────────────┬───────────────────────────────────┘
                          │ HTTP (CORS)
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                   Hotspot Server (Express)                   │
│                      localhost:3001                          │
│  GET/PUT/DELETE /api/hotspots/:id                           │
└─────────────────────────┬───────────────────────────────────┘
                          │ File System
                          ▼
┌─────────────────────────────────────────────────────────────┐
│              viewer/public/data/epc/hotspots/                │
│                    *.json (per diagram)                      │
│                    _index.json (summary)                     │
└─────────────────────────────────────────────────────────────┘
```

## Data Structures

### Hotspot JSON File

Each diagram has a corresponding JSON file in `viewer/public/data/epc/hotspots/`:

```json
{
  "diagramId": "52d610c5d4d2",
  "imageWidth": 1240,
  "imageHeight": 1761,
  "status": "done",
  "sheetCode": {
    "text": "C1",
    "bbox": { "x": 151, "y": 1616, "width": 44, "height": 33 },
    "confidence": 91
  },
  "hotspots": [
    {
      "type": "rect",
      "ref": 2,
      "bbox": { "x": 805, "y": 469, "width": 30, "height": 25 },
      "normalized": { "x": 0.649, "y": 0.266, "width": 0.024, "height": 0.014 },
      "confidence": 100,
      "manual": true
    },
    {
      "type": "polygon",
      "ref": 5,
      "points": [
        { "x": 100, "y": 200 },
        { "x": 150, "y": 180 },
        { "x": 160, "y": 250 },
        { "x": 90, "y": 240 }
      ],
      "confidence": 100,
      "manual": true
    }
  ],
  "extractedAt": "2026-02-02T13:55:35.235Z",
  "modifiedAt": "2026-02-02T14:30:00.000Z"
}
```

### Hotspot Types

#### Rectangle (`type: "rect"`)
- `bbox`: Bounding box with `x`, `y`, `width`, `height` in image pixels
- `normalized`: Same values as ratios (0-1) for responsive scaling
- Simpler to create, good for isolated parts

#### Polygon (`type: "polygon"`)
- `points`: Array of `{x, y}` coordinates in image pixels
- Minimum 3 points required
- Better for irregularly shaped parts or parts that overlap

### Common Properties

| Property | Type | Description |
|----------|------|-------------|
| `ref` | number | Part reference number (1-99), matches `ref` in parts.json |
| `confidence` | number | 0-100, OCR confidence or 100 for manual |
| `manual` | boolean | True if created/edited manually |

### Status Field

The `status` field tracks editing progress:
- `"todo"` - Not yet reviewed/edited (default)
- `"done"` - Reviewed and complete

## API Endpoints

The server runs on port **3001**.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/diagrams` | List all diagrams with metadata |
| `GET` | `/api/hotspots/:id` | Get hotspots for a diagram |
| `PUT` | `/api/hotspots/:id` | Create/update hotspots |
| `DELETE` | `/api/hotspots/:id` | Delete hotspot file |
| `POST` | `/api/hotspots/rebuild-index` | Rebuild `_index.json` |

### GET /api/diagrams Response

```json
{
  "diagrams": [
    {
      "id": "52d610c5d4d2",
      "filename": "52d610c5d4d2.png",
      "hasHotspots": true,
      "sheetCode": "C1",
      "hotspotCount": 6,
      "status": "done"
    }
  ],
  "total": 332
}
```

## Editor UI

### Toolbar Modes

| Mode | Icon | Description |
|------|------|-------------|
| **Select** | 🖱️ | Click to select hotspots, drag to move, resize handles on corners |
| **Rectangle** | ▢ | Click and drag to draw rectangular hotspots |
| **Polygon** | ⬡ | Click to place vertices, click first point to close |

### Zoom Controls

- **Scroll wheel**: Zoom in/out (centered on cursor)
- **+/−** buttons: Step zoom
- **⊡** button: Fit diagram to viewport
- Zoom range: 25% - 400%

### Panning

- **Select mode**: Drag on empty space to pan
- **Any mode**: Middle mouse button + drag
- **Any mode**: Space + drag

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Esc` | Cancel current action → Deselect → Switch to Select mode |
| `Del` / `Backspace` | Delete selected hotspot |
| `Cmd/Ctrl + S` | Save changes |
| `Space + Drag` | Pan (in any mode) |
| `Scroll` | Zoom |

### Sidebar Panels

1. **Diagram List**: Searchable, filterable by status (All/To-Do/Done)
2. **Info Panel**: Current diagram metadata, status toggle
3. **Edit Panel**: Edit selected hotspot's ref number
4. **Hotspots List**: All hotspots sorted by ref, click to select

### Visual Indicators

- **Yellow dot** in list: To-Do status
- **Green dot** in list: Done status
- **Orange dot** next to "Hotspots": Unsaved changes
- **Blue border**: Rectangle hotspot
- **Purple border**: Polygon hotspot
- **Red border**: Selected hotspot
- **Orange border**: Highlighted hotspot (hover)

## EPCBrowser Integration

The main app renders hotspots in the diagram modal:

```jsx
// viewer/src/components/EPCBrowser.jsx
// Loads hotspot data when diagram opens
fetch(`/data/epc/hotspots/${diagramId}.json`)

// Renders both rect and polygon hotspots
// Highlights on hover (bidirectional with table rows)
```

### CSS Classes

```css
.epc-hotspots-container    /* Container positioned over image */
.epc-hotspot               /* Rectangle hotspot */
.epc-hotspot-polygon       /* Polygon hotspot (uses SVG) */
.epc-hotspot.highlighted   /* Hover state */
.epc-hotspot-label         /* Ref number badge */
```

## OCR Extraction Script

Initial hotspot extraction using Tesseract.js (limited accuracy):

```bash
# Extract all diagrams
npm run extract-hotspots

# Extract specific diagrams
node extract-diagram-hotspots.js 52d610c5d4d2.png 78b6e087ae17.png
```

### Limitations

- Tesseract struggles with sparse technical diagrams
- Many numbers are missed or misidentified
- Best used as a starting point, requires manual review
- Sheet codes are detected more reliably (bottom-left position)

### Preprocessing

The script applies image preprocessing for better OCR:
- Grayscale conversion
- Contrast enhancement (`linear(1.5, -50)`)
- Sharpening

## File Locations

```
tis-vx/
├── hotspot-server.js              # API server
├── extract-diagram-hotspots.js    # OCR extraction script
├── package.json                   # npm scripts: hotspot-server, extract-hotspots
├── viewer/
│   ├── public/
│   │   ├── hotspot-editor.html    # Standalone editor
│   │   └── data/epc/
│   │       ├── diagrams/          # PNG diagram images (332 files)
│   │       └── hotspots/          # JSON hotspot files
│   │           ├── _index.json    # Summary index
│   │           └── *.json         # Per-diagram hotspots
│   └── src/
│       ├── components/
│       │   └── EPCBrowser.jsx     # Renders hotspots in modal
│       └── App.css                # Hotspot styles (.epc-hotspot*)
```

## Coordinate Systems

### Image Coordinates (Primary)

All coordinates are stored in **image pixels** relative to the original image dimensions:

```json
{
  "imageWidth": 1240,
  "imageHeight": 1761,
  "bbox": { "x": 805, "y": 469, "width": 30, "height": 25 }
}
```

### Normalized Coordinates

Rectangle hotspots also store normalized (0-1) coordinates for responsive scaling:

```json
{
  "normalized": {
    "x": 0.649,      // x / imageWidth
    "y": 0.266,      // y / imageHeight
    "width": 0.024,  // width / imageWidth
    "height": 0.014  // height / imageHeight
  }
}
```

### Display Scaling

When rendering, coordinates are scaled to match the displayed image size:

```javascript
const scaleX = img.offsetWidth / hotspots.imageWidth;
const scaleY = img.offsetHeight / hotspots.imageHeight;
const displayX = hotspot.bbox.x * scaleX;
```

## Workflow Recommendations

### Initial Setup

1. Run OCR extraction as a starting point (optional)
2. Open editor, filter by "To-Do"
3. Work through diagrams systematically

### Per-Diagram Workflow

1. Select diagram from list
2. Use "Fit" (⊡) to see whole diagram
3. Zoom in on areas with parts
4. Draw hotspots using Rectangle or Polygon mode
5. Use ESC to return to Select mode for panning
6. Set ref numbers when prompted
7. Mark as "Done" when complete
8. Save (`Cmd/Ctrl + S`)

### Tips

- **Polygon mode**: Great for parts with irregular shapes or leader lines
- **Rectangle mode**: Faster for simple isolated parts
- **Sheet codes**: Edit in the toolbar input field
- **Repeated numbers**: Create multiple hotspots with the same ref
- **Overlapping parts**: Use polygons to trace exact boundaries

## Troubleshooting

### "Server not running"

```bash
npm run hotspot-server
# Verify: curl http://localhost:3001/api/diagrams
```

### Changes not saving

- Check browser console for errors
- Verify server is running
- Check file permissions on hotspots directory

### Hotspots not showing in EPCBrowser

- Hotspot JSON must exist for the diagram
- Check `diagramId` matches the filename (without .png)
- Check browser console for fetch errors

### Zoom/pan not working

- Ensure cursor is over the diagram container
- Check that no dialog is open
- Try refreshing the page

## Future Improvements

- [ ] Undo/redo support
- [ ] Copy/paste hotspots between diagrams
- [ ] Bulk status update
- [ ] Hotspot templates for common part shapes
- [ ] AI-powered hotspot detection (using vision models)
- [ ] Validation against parts.json (check ref numbers exist)
- [ ] Export statistics (coverage, completion rate)
