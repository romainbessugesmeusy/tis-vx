const express = require("express");
const fs = require("fs").promises;
const path = require("path");

const app = express();
const PORT = 3001;

const HOTSPOTS_DIR = path.join(__dirname, "viewer/public/data/epc/hotspots");
const DIAGRAMS_DIR = path.join(__dirname, "viewer/public/data/epc/diagrams");

app.use(express.json());

// CORS for dev (Vite runs on 5173)
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "http://localhost:5173");
  res.header("Access-Control-Allow-Methods", "GET, PUT, POST, DELETE, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});

// List all diagrams (with hotspot status)
app.get("/api/diagrams", async (req, res) => {
  try {
    const diagramFiles = await fs.readdir(DIAGRAMS_DIR);
    const pngFiles = diagramFiles.filter((f) => f.endsWith(".png"));

    let hotspotFiles = [];
    try {
      hotspotFiles = await fs.readdir(HOTSPOTS_DIR);
    } catch {
      // Hotspots dir might not exist yet
    }

    const diagrams = await Promise.all(
      pngFiles.map(async (file) => {
        const id = file.replace(".png", "");
        const hasHotspots = hotspotFiles.includes(`${id}.json`);

        let hotspotData = null;
        if (hasHotspots) {
          try {
            const content = await fs.readFile(
              path.join(HOTSPOTS_DIR, `${id}.json`),
              "utf-8"
            );
            hotspotData = JSON.parse(content);
          } catch {
            // Ignore parse errors
          }
        }

        return {
          id,
          filename: file,
          hasHotspots,
          sheetCode: hotspotData?.sheetCode?.text || null,
          hotspotCount: hotspotData?.hotspots?.length || 0,
          status: hotspotData?.status || 'todo',
        };
      })
    );

    // Sort by sheet code, then by id
    diagrams.sort((a, b) => {
      if (a.sheetCode && b.sheetCode) {
        return a.sheetCode.localeCompare(b.sheetCode, undefined, { numeric: true });
      }
      if (a.sheetCode) return -1;
      if (b.sheetCode) return 1;
      return a.id.localeCompare(b.id);
    });

    res.json({ diagrams, total: diagrams.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get hotspots for a specific diagram
app.get("/api/hotspots/:diagramId", async (req, res) => {
  const { diagramId } = req.params;
  const filePath = path.join(HOTSPOTS_DIR, `${diagramId}.json`);

  try {
    const content = await fs.readFile(filePath, "utf-8");
    res.json(JSON.parse(content));
  } catch (error) {
    if (error.code === "ENOENT") {
      // Return empty structure if file doesn't exist
      res.json({
        diagramId,
        imageWidth: null,
        imageHeight: null,
        sheetCode: null,
        hotspots: [],
        extractedAt: null,
      });
    } else {
      res.status(500).json({ error: error.message });
    }
  }
});

// Create or update hotspots for a diagram
app.put("/api/hotspots/:diagramId", async (req, res) => {
  const { diagramId } = req.params;
  const data = req.body;

  // Validate
  if (!data || typeof data !== "object") {
    return res.status(400).json({ error: "Invalid data" });
  }

  // Ensure directory exists
  await fs.mkdir(HOTSPOTS_DIR, { recursive: true });

  const filePath = path.join(HOTSPOTS_DIR, `${diagramId}.json`);

  // Add/update metadata
  data.diagramId = diagramId;
  data.modifiedAt = new Date().toISOString();

  try {
    await fs.writeFile(filePath, JSON.stringify(data, null, 2));
    console.log(`✓ Saved hotspots for ${diagramId}`);
    res.json({ success: true, diagramId });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete hotspots for a diagram
app.delete("/api/hotspots/:diagramId", async (req, res) => {
  const { diagramId } = req.params;
  const filePath = path.join(HOTSPOTS_DIR, `${diagramId}.json`);

  try {
    await fs.unlink(filePath);
    console.log(`✓ Deleted hotspots for ${diagramId}`);
    res.json({ success: true, diagramId });
  } catch (error) {
    if (error.code === "ENOENT") {
      res.json({ success: true, diagramId, message: "File did not exist" });
    } else {
      res.status(500).json({ error: error.message });
    }
  }
});

// Rebuild index file
app.post("/api/hotspots/rebuild-index", async (req, res) => {
  try {
    const files = await fs.readdir(HOTSPOTS_DIR);
    const jsonFiles = files.filter((f) => f.endsWith(".json") && f !== "_index.json");

    const diagrams = [];
    for (const file of jsonFiles) {
      try {
        const content = await fs.readFile(path.join(HOTSPOTS_DIR, file), "utf-8");
        const data = JSON.parse(content);
        diagrams.push({
          id: data.diagramId,
          sheetCode: data.sheetCode?.text || null,
          hotspotCount: data.hotspots?.length || 0,
          uniqueRefs: [...new Set(data.hotspots?.map((h) => h.ref) || [])].length,
        });
      } catch {
        // Skip invalid files
      }
    }

    const index = {
      processedAt: new Date().toISOString(),
      totalDiagrams: diagrams.length,
      diagrams,
    };

    await fs.writeFile(
      path.join(HOTSPOTS_DIR, "_index.json"),
      JSON.stringify(index, null, 2)
    );

    console.log(`✓ Rebuilt index with ${diagrams.length} diagrams`);
    res.json({ success: true, count: diagrams.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════╗
║       EPC Hotspot Editor Server                   ║
╠═══════════════════════════════════════════════════╣
║  API running on:  http://localhost:${PORT}           ║
║  Editor at:       http://localhost:5173/hotspot-editor.html
╚═══════════════════════════════════════════════════╝

Endpoints:
  GET    /api/diagrams              - List all diagrams
  GET    /api/hotspots/:id          - Get hotspots for diagram
  PUT    /api/hotspots/:id          - Save hotspots for diagram
  DELETE /api/hotspots/:id          - Delete hotspots for diagram
  POST   /api/hotspots/rebuild-index - Rebuild the index file
`);
});
