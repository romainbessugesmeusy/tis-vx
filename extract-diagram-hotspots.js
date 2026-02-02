const Tesseract = require("tesseract.js");
const sharp = require("sharp");
const fs = require("fs").promises;
const path = require("path");

const config = {
  diagramsDir: "viewer/public/data/epc/diagrams",
  outputDir: "viewer/public/data/epc/hotspots",
  // Process specific file(s) or all if empty
  specificFiles: process.argv.slice(2),
};

/**
 * Determines if a detected text is likely a sheet code (bottom-left identifier)
 * Sheet codes are typically: A1, A10, P5, P19-1, C1, etc.
 */
function isSheetCode(text, x, y, imageWidth, imageHeight) {
  // Sheet codes are in the bottom-left corner (roughly bottom 15%, left 25%)
  const isBottomLeft = x < imageWidth * 0.25 && y > imageHeight * 0.85;
  // Sheet codes match pattern like: A1, A10, P5, P19-1, C1, etc.
  const sheetCodePattern = /^[A-Z]\d{1,2}(-\d)?$/i;
  const matchesPattern = sheetCodePattern.test(text.trim());
  return isBottomLeft && matchesPattern;
}

/**
 * Determines if a detected text is a valid part number
 * Part numbers are single or double digit numbers (1-99)
 */
function isValidPartNumber(text, confidence) {
  const trimmed = text.trim();
  // Must be 1-2 digit number only
  if (!/^\d{1,2}$/.test(trimmed)) return false;
  // Skip 0 as it's usually noise
  if (trimmed === "0") return false;
  // Must have some confidence (allow low values since sparse text is hard)
  if (confidence < 5) return false;
  return true;
}

/**
 * Parse TSV output from Tesseract to extract word-level data with positions
 */
function parseTSV(tsv) {
  const words = [];
  if (!tsv) return words;

  const lines = tsv.split("\n");
  for (const line of lines) {
    const parts = line.split("\t");
    // Level 5 = word level in Tesseract TSV format
    if (parts[0] === "5" && parts.length >= 12) {
      const [, , , , , , left, top, width, height, conf, text] = parts;
      if (text && text.trim()) {
        words.push({
          text: text.trim(),
          x: parseInt(left, 10),
          y: parseInt(top, 10),
          width: parseInt(width, 10),
          height: parseInt(height, 10),
          confidence: parseFloat(conf),
        });
      }
    }
  }
  return words;
}

/**
 * Preprocess image for better OCR results
 */
async function preprocessImage(imagePath) {
  const metadata = await sharp(imagePath).metadata();

  // Aggressive contrast enhancement for sparse technical diagrams
  const buffer = await sharp(imagePath)
    .grayscale()
    .linear(1.5, -50) // Increase contrast
    .sharpen({ sigma: 2 })
    .toBuffer();

  return { buffer, width: metadata.width, height: metadata.height };
}

/**
 * Process a single diagram image
 */
async function processDiagram(imagePath, worker) {
  const filename = path.basename(imagePath, ".png");
  process.stdout.write(`Processing: ${filename}... `);

  try {
    // Preprocess image
    const { buffer, width, height } = await preprocessImage(imagePath);

    // Use SINGLE_BLOCK mode which works better for sparse diagrams
    await worker.setParameters({
      tessedit_pageseg_mode: Tesseract.PSM.SINGLE_BLOCK,
      tessedit_char_whitelist: "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-",
    });

    const result = await worker.recognize(buffer, {}, { tsv: true });

    const words = parseTSV(result.data.tsv);

    let sheetCode = null;
    const hotspots = [];

    // Process each word detected
    for (const word of words) {
      const { text, x, y, confidence } = word;

      // Check if this is the sheet code
      if (isSheetCode(text, x, y, width, height)) {
        sheetCode = {
          text: text,
          bbox: {
            x: word.x,
            y: word.y,
            width: word.width,
            height: word.height,
          },
          confidence: Math.round(confidence),
        };
        continue;
      }

      // Check if this is a valid part number
      if (isValidPartNumber(text, confidence)) {
        hotspots.push({
          ref: parseInt(text, 10),
          bbox: {
            x: word.x,
            y: word.y,
            width: word.width,
            height: word.height,
          },
          // Normalized coordinates (0-1) for responsive hotspots
          normalized: {
            x: word.x / width,
            y: word.y / height,
            width: word.width / width,
            height: word.height / height,
          },
          confidence: Math.round(confidence),
        });
      }
    }

    // Sort hotspots by ref number, then by position (top to bottom, left to right)
    hotspots.sort((a, b) => {
      if (a.ref !== b.ref) return a.ref - b.ref;
      if (Math.abs(a.bbox.y - b.bbox.y) > 20) return a.bbox.y - b.bbox.y;
      return a.bbox.x - b.bbox.x;
    });

    const output = {
      diagramId: filename,
      imageWidth: width,
      imageHeight: height,
      sheetCode,
      hotspots,
      extractedAt: new Date().toISOString(),
    };

    const uniqueRefs = [...new Set(hotspots.map((h) => h.ref))];
    console.log(
      `sheet: ${sheetCode?.text || "?"}, refs: [${uniqueRefs.join(", ")}] (${hotspots.length} hotspots)`
    );

    return output;
  } catch (error) {
    console.log(`ERROR: ${error.message}`);
    return null;
  }
}

/**
 * Main function
 */
async function main() {
  // Ensure output directory exists
  await fs.mkdir(config.outputDir, { recursive: true });

  // Get list of diagram files
  let files;
  if (config.specificFiles.length > 0) {
    files = config.specificFiles.map((f) => {
      if (f.includes("/")) return f;
      return path.join(config.diagramsDir, f.endsWith(".png") ? f : `${f}.png`);
    });
  } else {
    const allFiles = await fs.readdir(config.diagramsDir);
    files = allFiles
      .filter((f) => f.endsWith(".png"))
      .map((f) => path.join(config.diagramsDir, f));
  }

  console.log(`Found ${files.length} diagram(s) to process\n`);

  // Initialize Tesseract worker
  const worker = await Tesseract.createWorker("eng");

  const results = [];
  let processed = 0;
  let failed = 0;

  for (const file of files) {
    const result = await processDiagram(file, worker);
    if (result) {
      // Save individual JSON file
      const outputPath = path.join(config.outputDir, `${result.diagramId}.json`);
      await fs.writeFile(outputPath, JSON.stringify(result, null, 2));
      results.push(result);
      processed++;
    } else {
      failed++;
    }
  }

  await worker.terminate();

  // Create summary index file
  const index = {
    processedAt: new Date().toISOString(),
    totalDiagrams: files.length,
    processed,
    failed,
    diagrams: results.map((r) => ({
      id: r.diagramId,
      sheetCode: r.sheetCode?.text || null,
      hotspotCount: r.hotspots.length,
      uniqueRefs: [...new Set(r.hotspots.map((h) => h.ref))].length,
    })),
  };

  await fs.writeFile(
    path.join(config.outputDir, "_index.json"),
    JSON.stringify(index, null, 2)
  );

  console.log("\n" + "=".repeat(50));
  console.log(`Processing complete!`);
  console.log(`  Processed: ${processed}`);
  console.log(`  Failed: ${failed}`);
  console.log(`  Output: ${config.outputDir}`);
}

main().catch(console.error);
