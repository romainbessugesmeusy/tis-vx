#!/usr/bin/env node

/**
 * Build retrieval and grounding indexes for chat/RAG.
 *
 * Inputs (default): viewer/public/data/
 * Outputs (default): viewer/public/data/rag/
 *
 * Generated files:
 * - procedure-chunks.json
 * - doc-metadata.json
 * - parts-index.json
 * - part-procedure-links.json
 * - diagram-grounding.json
 * - index-manifest.json
 */

const fs = require("fs");
const path = require("path");
const cheerio = require("cheerio");

const VERSION = "1.0.0";
const CHUNK_MAX_CHARS = 2800;
const PROCEDURE_STEPS_PER_CHUNK = 8;
const GLOSSARY_ITEMS_PER_CHUNK = 10;

function parseArgs(argv) {
  const args = {
    dataDir: path.join(__dirname, "viewer", "public", "data"),
    outputDir: null,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--data-dir" && next) {
      args.dataDir = path.resolve(next);
      i += 1;
    } else if (arg === "--output-dir" && next) {
      args.outputDir = path.resolve(next);
      i += 1;
    }
  }

  if (!args.outputDir) {
    args.outputDir = path.join(args.dataDir, "rag");
  }
  return args;
}

function log(message) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] ${message}`);
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    if (fallback !== null) return fallback;
    throw error;
  }
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

function normalizeWhitespace(value) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim();
}

function normalizePartNo(value) {
  if (typeof value !== "string") return "";
  return value.replace(/^[\s(]+|[\s)]+$/g, "").replace(/\s+/g, "").trim().toUpperCase();
}

function normalizeKatNo(value) {
  if (typeof value !== "string") return "";
  return value.replace(/^[\s(]+|[\s)]+$/g, "").replace(/\s+/g, " ").trim().toUpperCase();
}

function normalizeRef(value) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).replace(/\s+/g, "").trim().toUpperCase();
  if (!normalized || normalized === "-" || normalized === "N/A") return null;
  return normalized;
}

function getLeadingDigits(value) {
  if (!value) return null;
  const match = value.match(/^(\d+)/);
  return match ? match[1] : null;
}

function stripHtml(html) {
  if (!html || typeof html !== "string") return "";
  const $ = cheerio.load(html);
  return normalizeWhitespace($.text());
}

function splitLongText(text, maxChars = CHUNK_MAX_CHARS) {
  const normalized = normalizeWhitespace(text);
  if (!normalized) return [];
  if (normalized.length <= maxChars) return [normalized];

  const paragraphs = normalized
    .split(/\.\s+/g)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p, idx, arr) => (idx < arr.length - 1 ? `${p}.` : p));

  const chunks = [];
  let buffer = "";
  for (const paragraph of paragraphs) {
    const candidate = buffer ? `${buffer} ${paragraph}` : paragraph;
    if (candidate.length > maxChars && buffer) {
      chunks.push(buffer);
      buffer = paragraph;
    } else {
      buffer = candidate;
    }
  }
  if (buffer) chunks.push(buffer);
  return chunks;
}

function chunkLines(lines, maxChars = CHUNK_MAX_CHARS) {
  const out = [];
  let buffer = [];
  let length = 0;
  for (const line of lines) {
    const normalized = normalizeWhitespace(line);
    if (!normalized) continue;
    const nextLength = length + normalized.length + 1;
    if (nextLength > maxChars && buffer.length > 0) {
      out.push(buffer.join("\n"));
      buffer = [normalized];
      length = normalized.length;
    } else {
      buffer.push(normalized);
      length = nextLength;
    }
  }
  if (buffer.length > 0) out.push(buffer.join("\n"));
  return out;
}

function buildSlugToSectionMap(manifest) {
  const map = new Map();
  const sections = Array.isArray(manifest.sections) ? manifest.sections : [];
  for (const section of sections) {
    if (!section || !section.id) continue;
    map.set(section.id, { section, engine: null });
    if (section.variants && typeof section.variants === "object") {
      for (const [engine, variant] of Object.entries(section.variants)) {
        if (variant && variant.slug) {
          map.set(variant.slug, { section, engine });
        }
      }
    }
  }
  return map;
}

function buildSlugToTreePaths(manifest) {
  const tree = manifest.tree || {};
  const nodes = tree.nodes || {};
  const tocIdToSlug = manifest.tocIdToSlug || {};

  const pathCache = new Map();
  const slugToPathSet = new Map();

  const getNodePath = (nodeId) => {
    if (pathCache.has(nodeId)) return pathCache.get(nodeId);
    const node = nodes[nodeId];
    if (!node) return [];
    const ownTitle = normalizeWhitespace(node.title || node.id || "");
    let path = ownTitle ? [ownTitle] : [];
    if (node.parentId) {
      const parentPath = getNodePath(node.parentId);
      path = parentPath.concat(path);
    }
    pathCache.set(nodeId, path);
    return path;
  };

  const addPathForSlug = (slug, nodePath) => {
    if (!slug) return;
    if (!slugToPathSet.has(slug)) slugToPathSet.set(slug, new Set());
    slugToPathSet.get(slug).add(nodePath.join(" > "));
  };

  for (const [nodeId, node] of Object.entries(nodes)) {
    if (!node || !node.isLeaf) continue;
    const nodePath = getNodePath(nodeId);
    if (node.variants && typeof node.variants === "object") {
      for (const variant of Object.values(node.variants)) {
        if (variant && variant.slug) addPathForSlug(variant.slug, nodePath);
      }
    } else if (tocIdToSlug[nodeId]) {
      addPathForSlug(tocIdToSlug[nodeId], nodePath);
    }
  }

  const slugToPaths = new Map();
  for (const [slug, pathSet] of slugToPathSet.entries()) {
    slugToPaths.set(slug, Array.from(pathSet.values()).sort());
  }
  return slugToPaths;
}

function buildToolsByDocId(references) {
  const map = new Map();
  const tools = Array.isArray(references.tools) ? references.tools : [];
  for (const tool of tools) {
    const usedIn = Array.isArray(tool.usedIn) ? tool.usedIn : [];
    for (const docId of usedIn) {
      if (!map.has(docId)) map.set(docId, []);
      map.get(docId).push(tool.code);
    }
  }
  for (const codes of map.values()) {
    codes.sort();
  }
  return map;
}

function buildTorqueByDocId(references) {
  const map = new Map();
  const values = Array.isArray(references.values) ? references.values : [];
  for (const entry of values) {
    const docId = entry && entry.sourcePage ? entry.sourcePage : null;
    if (!docId) continue;
    if (!map.has(docId)) map.set(docId, []);
    map.get(docId).push(entry);
  }
  return map;
}

function remedBlockToLines(block) {
  if (!block || typeof block !== "object") return [];
  if (block.type === "paragraph" || block.type === "text") {
    return [normalizeWhitespace(block.text || "")];
  }
  if (block.type === "numbered" && Array.isArray(block.items)) {
    return block.items.map((item, idx) => `${idx + 1}. ${normalizeWhitespace(item)}`);
  }
  if (block.type === "bullets" && Array.isArray(block.items)) {
    return block.items.map((item) => `- ${normalizeWhitespace(item)}`);
  }
  if (block.type === "diagnosis_table" && block.table && Array.isArray(block.table.categories)) {
    const lines = [];
    for (const category of block.table.categories) {
      lines.push(`${normalizeWhitespace(category.name || "Category")}:`);
      if (Array.isArray(category.rows)) {
        for (const row of category.rows) {
          const description = normalizeWhitespace(row.description || "");
          const action = normalizeWhitespace(row.action || "");
          lines.push(`- ${description}${action ? ` -> ${action}` : ""}`);
        }
      }
    }
    return lines;
  }
  return [];
}

function extractContentChunks({
  doc,
  docId,
  docTitle,
  contentType,
  engines,
  treePaths,
  toolsByDocId,
  torqueByDocId,
}) {
  const chunks = [];

  const addChunk = (chunkId, text, meta = {}) => {
    const normalizedText = normalizeWhitespace(text);
    if (!normalizedText) return;
    chunks.push({
      chunkId,
      docId,
      title: docTitle,
      contentType,
      engines,
      treePaths,
      text: normalizedText,
      meta,
    });
  };

  if (contentType === "procedure" && Array.isArray(doc.phases)) {
    const overviewLines = [docTitle];
    if (Array.isArray(doc.toolsRequired) && doc.toolsRequired.length > 0) {
      overviewLines.push(`Tools required: ${doc.toolsRequired.join(", ")}`);
    } else if (toolsByDocId.has(docId)) {
      overviewLines.push(`Tools references: ${toolsByDocId.get(docId).join(", ")}`);
    }
    if (Array.isArray(doc.torqueValues) && doc.torqueValues.length > 0) {
      const tv = doc.torqueValues
        .slice(0, 8)
        .map((v) => `${normalizeWhitespace(v.component || "")}: ${normalizeWhitespace(v.value || "")} ${normalizeWhitespace(v.unit || "")}`.trim())
        .filter(Boolean);
      if (tv.length > 0) overviewLines.push(`Torque highlights: ${tv.join("; ")}`);
    } else if (torqueByDocId.has(docId)) {
      const tv = torqueByDocId
        .get(docId)
        .slice(0, 8)
        .map((v) => `${normalizeWhitespace(v.component || "")}: ${normalizeWhitespace(v.value || "")} ${normalizeWhitespace(v.unit || "")}`.trim())
        .filter(Boolean);
      if (tv.length > 0) overviewLines.push(`Torque highlights: ${tv.join("; ")}`);
    }
    addChunk(`${docId}#overview`, overviewLines.join("\n"), { chunkType: "overview" });

    for (let pIdx = 0; pIdx < doc.phases.length; pIdx += 1) {
      const phase = doc.phases[pIdx];
      const phaseLabel = normalizeWhitespace(phase.label || phase.phase || `phase-${pIdx}`);
      const phaseSteps = Array.isArray(phase.steps) ? phase.steps : [];
      if (phaseSteps.length === 0) continue;

      let buffer = [];
      let bufferStartStep = null;
      let bufferEndStep = null;
      let charCount = 0;

      const flush = () => {
        if (buffer.length === 0) return;
        const chunkText = [docTitle, `Phase: ${phaseLabel}`, ...buffer].join("\n");
        addChunk(
          `${docId}#phase-${pIdx}-steps-${bufferStartStep}-${bufferEndStep}`,
          chunkText,
          {
            chunkType: "procedure_steps",
            phaseIndex: pIdx,
            phase: phase.phase || phase.label || `phase-${pIdx}`,
            stepRange: `${bufferStartStep}-${bufferEndStep}`,
          }
        );
        buffer = [];
        bufferStartStep = null;
        bufferEndStep = null;
        charCount = 0;
      };

      for (let sIdx = 0; sIdx < phaseSteps.length; sIdx += 1) {
        const step = phaseSteps[sIdx];
        const stepNumber = step.number !== undefined && step.number !== null ? String(step.number) : String(sIdx + 1);
        const lines = [`${stepNumber}. ${normalizeWhitespace(step.text || "")}`];
        if (Array.isArray(step.substeps)) {
          for (const substep of step.substeps) {
            lines.push(`- ${normalizeWhitespace(substep)}`);
          }
        }
        if (step.image && step.image.src) {
          lines.push(`Image: ${normalizeWhitespace(step.image.src)}`);
        }

        const stepText = lines.filter(Boolean).join("\n");
        const wouldOverflow = charCount + stepText.length > CHUNK_MAX_CHARS;
        const tooManySteps = buffer.length >= PROCEDURE_STEPS_PER_CHUNK;
        if ((wouldOverflow || tooManySteps) && buffer.length > 0) flush();

        buffer.push(stepText);
        if (bufferStartStep === null) bufferStartStep = stepNumber;
        bufferEndStep = stepNumber;
        charCount += stepText.length;
      }
      flush();
    }
    return chunks;
  }

  if (contentType === "tsb") {
    const lines = [
      docTitle,
      normalizeWhitespace(doc.subject || ""),
      `Complaint: ${normalizeWhitespace(doc.complaint || "")}`,
      `Cause: ${normalizeWhitespace(doc.cause || "")}`,
      `Production: ${normalizeWhitespace(doc.production || "")}`,
    ].filter(Boolean);

    if (Array.isArray(doc.parts) && doc.parts.length > 0) {
      for (const part of doc.parts) {
        lines.push(
          `Part: ${normalizeWhitespace(part.name || "")} | ${normalizeWhitespace(part.partNumber || "")} | ${normalizeWhitespace(part.catalogueNumber || "")}`
        );
      }
    }

    const remedyContent = Array.isArray(doc.remedyContent) ? doc.remedyContent : [];
    for (let i = 0; i < remedyContent.length; i += 1) {
      const remedyLines = remedBlockToLines(remedyContent[i]);
      lines.push(...remedyLines);
    }

    const textChunks = chunkLines(lines);
    textChunks.forEach((chunkText, idx) => addChunk(`${docId}#tsb-${idx}`, chunkText, { chunkType: "tsb" }));
    return chunks;
  }

  if (contentType === "diagnostic") {
    const lines = [
      docTitle,
      `Objective: ${normalizeWhitespace(doc.objective || "")}`,
      `Measurement: ${normalizeWhitespace(doc.measurement || "")}`,
      `Preparation: ${normalizeWhitespace(doc.preparation || "")}`,
    ];
    if (Array.isArray(doc.connections) && doc.connections.length > 0) {
      for (const conn of doc.connections) {
        lines.push(`Connection: ${normalizeWhitespace(conn)}`);
      }
    }
    if (Array.isArray(doc.steps)) {
      for (let i = 0; i < doc.steps.length; i += 1) {
        const step = doc.steps[i];
        const number = step.number !== undefined && step.number !== null ? step.number : i + 1;
        lines.push(`${number}. ${normalizeWhitespace(step.text || "")}`);
      }
    }
    const textChunks = chunkLines(lines);
    textChunks.forEach((chunkText, idx) => addChunk(`${docId}#diagnostic-${idx}`, chunkText, { chunkType: "diagnostic" }));
    return chunks;
  }

  if (contentType === "glossary") {
    const items = Array.isArray(doc.items) ? doc.items : [];
    if (items.length === 0) {
      addChunk(`${docId}#glossary-0`, docTitle, { chunkType: "glossary", subtype: doc.subtype || null });
      return chunks;
    }
    for (let start = 0, idx = 0; start < items.length; start += GLOSSARY_ITEMS_PER_CHUNK, idx += 1) {
      const subset = items.slice(start, start + GLOSSARY_ITEMS_PER_CHUNK);
      const lines = [docTitle];
      for (const item of subset) {
        if (doc.subtype === "terms") {
          lines.push(`${normalizeWhitespace(item.term || "")}: ${normalizeWhitespace(item.description || "")}`);
        } else if (doc.subtype === "pictograms") {
          lines.push(`${normalizeWhitespace(item.label || "")}: ${normalizeWhitespace(item.description || "")}`);
        } else if (doc.subtype === "conversions") {
          lines.push(`${normalizeWhitespace(item.from || "")} -> ${normalizeWhitespace(item.to || "")}: ${normalizeWhitespace(item.factor || "")}`);
        } else {
          lines.push(normalizeWhitespace(JSON.stringify(item)));
        }
      }
      addChunk(`${docId}#glossary-${idx}`, lines.join("\n"), {
        chunkType: "glossary",
        subtype: doc.subtype || null,
        itemRange: `${start}-${start + subset.length - 1}`,
      });
    }
    return chunks;
  }

  if (contentType === "torque_table") {
    const lines = [docTitle, `Group: ${normalizeWhitespace(doc.group || "")}`];
    const values = Array.isArray(doc.values) ? doc.values : [];
    for (const value of values) {
      lines.push(
        `${normalizeWhitespace(value.component || "")}: ${normalizeWhitespace(value.value || "")} ${normalizeWhitespace(value.unit || "")}`.trim()
      );
    }
    addChunk(`${docId}#torque-0`, lines.join("\n"), { chunkType: "torque_table" });
    return chunks;
  }

  if (contentType === "tool_list") {
    const lines = [docTitle, `Group: ${normalizeWhitespace(doc.group || "")}`];
    const tools = Array.isArray(doc.tools) ? doc.tools : [];
    for (const tool of tools) {
      lines.push(
        `${normalizeWhitespace(tool.code || "")}: ${normalizeWhitespace(tool.name || "")}${tool.description ? ` - ${normalizeWhitespace(tool.description)}` : ""}`
      );
    }
    addChunk(`${docId}#tools-0`, lines.join("\n"), { chunkType: "tool_list" });
    return chunks;
  }

  if (contentType === "harness_diagram") {
    const lines = [docTitle];
    const components = Array.isArray(doc.components) ? doc.components : [];
    const locations = Array.isArray(doc.locations) ? doc.locations : [];
    for (const component of components) {
      lines.push(`${normalizeWhitespace(component.code || "")}: ${normalizeWhitespace(component.description || "")}`);
    }
    if (locations.length > 0) {
      lines.push("Locations:");
      locations.forEach((location) => lines.push(`- ${normalizeWhitespace(location)}`));
    }
    if (doc.diagram && doc.diagram.src) {
      lines.push(`Diagram: ${normalizeWhitespace(doc.diagram.src)}`);
    }
    addChunk(`${docId}#diagram-0`, lines.join("\n"), { chunkType: "harness_diagram" });
    return chunks;
  }

  // generic + fallback
  const baseText = doc.htmlContent ? stripHtml(doc.htmlContent) : "";
  const fallbackText = normalizeWhitespace(JSON.stringify(doc));
  const rawText = baseText || fallbackText;
  const textChunks = splitLongText(`${docTitle}\n${rawText}`);
  textChunks.forEach((text, idx) => addChunk(`${docId}#generic-${idx}`, text, { chunkType: "generic" }));
  return chunks;
}

function extractTisPartMentions(doc, context) {
  const mentions = [];
  if (!Array.isArray(doc.parts) || doc.parts.length === 0) return mentions;

  for (let i = 0; i < doc.parts.length; i += 1) {
    const part = doc.parts[i];
    const partNumberRaw = normalizeWhitespace(part.partNumber || "");
    const catalogueRaw = normalizeWhitespace(part.catalogueNumber || "");
    mentions.push({
      docId: context.docId,
      docTitle: context.docTitle,
      contentType: context.contentType,
      engines: context.engines,
      treePaths: context.treePaths,
      partIndex: i,
      name: normalizeWhitespace(part.name || ""),
      partNumber: partNumberRaw,
      partNumberNormalized: normalizePartNo(partNumberRaw),
      catalogueNumber: catalogueRaw,
      catalogueNumberNormalized: normalizeKatNo(catalogueRaw),
    });
  }
  return mentions;
}

function flattenEpcParts(epcData) {
  const items = [];
  const groups = Array.isArray(epcData.groups) ? epcData.groups : [];
  const diagramsMap = epcData.diagrams && typeof epcData.diagrams === "object" ? epcData.diagrams : {};

  for (const group of groups) {
    const subSections = Array.isArray(group.subSections) ? group.subSections : [];
    for (const subSection of subSections) {
      const mains = Array.isArray(subSection.main) ? subSection.main : [];
      for (const main of mains) {
        const parts = Array.isArray(main.parts) ? main.parts : [];
        for (const part of parts) {
          const partNo = normalizeWhitespace(part.partNo || "");
          const katNo = normalizeWhitespace(part.katNo || "");
          const diagramId = normalizeWhitespace(part.diagramId || "");
          const diagramInfo = diagramsMap[diagramId] || null;
          const filename = diagramInfo && diagramInfo.filename ? diagramInfo.filename : null;
          items.push({
            groupId: group.id || "",
            groupName: normalizeWhitespace(group.name || ""),
            subSectionId: subSection.id || "",
            subSectionName: normalizeWhitespace(subSection.name || ""),
            mainId: main.id || "",
            mainName: normalizeWhitespace(main.name || ""),
            ref: normalizeWhitespace(part.ref || ""),
            refNormalized: normalizeRef(part.ref),
            description: normalizeWhitespace(part.description || ""),
            usage: normalizeWhitespace(part.usage || ""),
            qty: normalizeWhitespace(part.qty || ""),
            partNo,
            partNoNormalized: normalizePartNo(partNo),
            katNo,
            katNoNormalized: normalizeKatNo(katNo),
            diagramId,
            diagramFilename: filename,
            diagramUrl: filename ? `/data/epc/diagrams/${filename}` : null,
          });
        }
      }
    }
  }
  return items;
}

function createIndexByKey(items, keyName) {
  const map = new Map();
  for (const item of items) {
    const key = item[keyName];
    if (!key) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return map;
}

function isEpcUsageCompatible(epcUsage, docEngines) {
  if (!epcUsage) return true;
  if (!Array.isArray(docEngines) || docEngines.length === 0) return true;
  const normalizedUsage = epcUsage.toUpperCase();
  return docEngines.some((engine) => normalizedUsage.includes(String(engine).toUpperCase()));
}

function computeBoundingBoxFromPoints(points) {
  if (!Array.isArray(points) || points.length === 0) return null;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

function createHotspotCache(hotspotsDir, hotspotsIndexData) {
  const diagramMetaById = new Map();
  const diagrams = hotspotsIndexData && Array.isArray(hotspotsIndexData.diagrams) ? hotspotsIndexData.diagrams : [];
  for (const entry of diagrams) {
    if (entry && entry.id) diagramMetaById.set(entry.id, entry);
  }

  const fileCache = new Map();
  const loadDiagramHotspots = (diagramId) => {
    if (!diagramId) return null;
    if (fileCache.has(diagramId)) return fileCache.get(diagramId);
    const filePath = path.join(hotspotsDir, `${diagramId}.json`);
    if (!fs.existsSync(filePath)) {
      fileCache.set(diagramId, null);
      return null;
    }
    try {
      const data = readJson(filePath, null);
      fileCache.set(diagramId, data);
      return data;
    } catch (error) {
      fileCache.set(diagramId, null);
      return null;
    }
  };

  return {
    diagramMetaById,
    loadDiagramHotspots,
  };
}

function getHotspotMatchesByRef(hotspotData, refNormalized) {
  if (!hotspotData || !Array.isArray(hotspotData.hotspots) || !refNormalized) {
    return { mode: "none", matches: [] };
  }

  const exactMatches = hotspotData.hotspots.filter((hotspot) => normalizeRef(hotspot.ref) === refNormalized);
  if (exactMatches.length > 0) return { mode: "exact", matches: exactMatches };

  const leadingDigits = getLeadingDigits(refNormalized);
  if (!leadingDigits) return { mode: "none", matches: [] };
  const numericMatches = hotspotData.hotspots.filter((hotspot) => normalizeRef(hotspot.ref) === leadingDigits);
  if (numericMatches.length > 0) return { mode: "numeric-fallback", matches: numericMatches };

  return { mode: "none", matches: [] };
}

function toGeometry(hotspot) {
  const type = hotspot.type || (hotspot.points ? "polygon" : "rect");
  const bbox = hotspot.bbox || computeBoundingBoxFromPoints(hotspot.points || null);
  return {
    type,
    ref: hotspot.ref,
    bbox: bbox || null,
    normalized: hotspot.normalized || null,
    points: Array.isArray(hotspot.points) ? hotspot.points : null,
    confidence: typeof hotspot.confidence === "number" ? hotspot.confidence : null,
    manual: Boolean(hotspot.manual),
  };
}

function calculateMatchConfidence({ matchType, hasHotspot, hotspotMode, engineAligned }) {
  let score = matchType === "partNo" ? 0.92 : 0.82;
  if (hasHotspot) score += hotspotMode === "exact" ? 0.06 : 0.03;
  else score -= 0.15;
  if (engineAligned) score += 0.04;
  if (score < 0) score = 0;
  if (score > 1) score = 1;
  return Number(score.toFixed(3));
}

function main() {
  const args = parseArgs(process.argv);
  const dataDir = args.dataDir;
  const outputDir = args.outputDir;

  const manifestPath = path.join(dataDir, "manifest.json");
  const contentDir = path.join(dataDir, "content");
  const referencesDir = path.join(dataDir, "references");
  const epcPartsPath = path.join(dataDir, "epc", "parts.json");
  const hotspotsDir = path.join(dataDir, "epc", "hotspots");
  const hotspotsIndexPath = path.join(hotspotsDir, "_index.json");

  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Manifest not found: ${manifestPath}`);
  }
  if (!fs.existsSync(contentDir)) {
    throw new Error(`Content directory not found: ${contentDir}`);
  }
  if (!fs.existsSync(epcPartsPath)) {
    throw new Error(`EPC parts file not found: ${epcPartsPath}`);
  }

  ensureDir(outputDir);
  log(`Reading data from ${dataDir}`);

  const manifest = readJson(manifestPath);
  const referencesTools = readJson(path.join(referencesDir, "tools.json"), { tools: [] });
  const referencesTorque = readJson(path.join(referencesDir, "torque-values.json"), { values: [] });
  const epcPartsData = readJson(epcPartsPath);
  const hotspotsIndexData = readJson(hotspotsIndexPath, { diagrams: [] });

  const slugToSection = buildSlugToSectionMap(manifest);
  const slugToTreePaths = buildSlugToTreePaths(manifest);
  const toolsByDocId = buildToolsByDocId(referencesTools);
  const torqueByDocId = buildTorqueByDocId(referencesTorque);

  const contentFiles = fs
    .readdirSync(contentDir)
    .filter((file) => file.endsWith(".json"))
    .sort();

  const chunks = [];
  const documents = [];
  const tisPartMentions = [];

  log(`Processing ${contentFiles.length} content files`);
  for (const file of contentFiles) {
    const docPath = path.join(contentDir, file);
    const doc = readJson(docPath, null);
    if (!doc || typeof doc !== "object") continue;

    const docId = file.replace(/\.json$/i, "");
    const title = normalizeWhitespace(doc.title || docId);
    const sectionEntry = slugToSection.get(docId) || null;
    const section = sectionEntry ? sectionEntry.section : null;
    const contentType = doc.type || (section && section.contentType) || "unknown";
    const engines = Array.isArray(section && section.engines) ? section.engines : [];
    const treePaths = slugToTreePaths.get(docId) || [];

    const docChunks = extractContentChunks({
      doc,
      docId,
      docTitle: title,
      contentType,
      engines,
      treePaths,
      toolsByDocId,
      torqueByDocId,
    });

    chunks.push(...docChunks);
    documents.push({
      docId,
      title,
      contentType,
      engines,
      treePaths,
      sectionId: section && section.id ? section.id : docId,
      hasParts: Array.isArray(doc.parts) && doc.parts.length > 0,
      chunkCount: docChunks.length,
    });

    const mentions = extractTisPartMentions(doc, {
      docId,
      docTitle: title,
      contentType,
      engines,
      treePaths,
    });
    tisPartMentions.push(...mentions);
  }

  const epcItems = flattenEpcParts(epcPartsData);
  const epcByPartNo = createIndexByKey(epcItems, "partNoNormalized");
  const epcByKatNo = createIndexByKey(epcItems, "katNoNormalized");

  const hotspotCache = createHotspotCache(hotspotsDir, hotspotsIndexData);

  const diagramGroundings = [];
  let groundedByHotspot = 0;
  let groundedByNumericFallback = 0;
  let epcWithoutHotspotMatch = 0;

  for (const item of epcItems) {
    const hotspotData = hotspotCache.loadDiagramHotspots(item.diagramId);
    const hotspotMeta = hotspotCache.diagramMetaById.get(item.diagramId) || null;
    const matchResult = getHotspotMatchesByRef(hotspotData, item.refNormalized);
    const geometries = matchResult.matches.map(toGeometry);

    if (matchResult.mode === "exact" && geometries.length > 0) groundedByHotspot += 1;
    else if (matchResult.mode === "numeric-fallback" && geometries.length > 0) groundedByNumericFallback += 1;
    else epcWithoutHotspotMatch += 1;

    const confidenceValues = geometries
      .map((g) => g.confidence)
      .filter((value) => typeof value === "number");
    const bestHotspotConfidence = confidenceValues.length > 0 ? Math.max(...confidenceValues) : null;

    diagramGroundings.push({
      partNo: item.partNo,
      partNoNormalized: item.partNoNormalized,
      katNo: item.katNo,
      katNoNormalized: item.katNoNormalized,
      description: item.description,
      usage: item.usage,
      qty: item.qty,
      ref: item.ref,
      refNormalized: item.refNormalized,
      groupId: item.groupId,
      groupName: item.groupName,
      subSectionId: item.subSectionId,
      subSectionName: item.subSectionName,
      mainId: item.mainId,
      mainName: item.mainName,
      diagram: {
        id: item.diagramId,
        filename: item.diagramFilename,
        url: item.diagramUrl,
        sheetCode:
          (hotspotData && hotspotData.sheetCode && hotspotData.sheetCode.text) ||
          (hotspotMeta && hotspotMeta.sheetCode) ||
          null,
        imageWidth: hotspotData && hotspotData.imageWidth ? hotspotData.imageWidth : null,
        imageHeight: hotspotData && hotspotData.imageHeight ? hotspotData.imageHeight : null,
        hotspotIndexStatus: hotspotMeta && hotspotMeta.status ? hotspotMeta.status : null,
      },
      hotspot: {
        mode: matchResult.mode,
        hasHotspot: geometries.length > 0,
        geometryCount: geometries.length,
        bestConfidence: bestHotspotConfidence,
        geometries,
      },
    });
  }

  const partProcedureLinks = [];
  const unmatchedTisParts = [];

  for (const mention of tisPartMentions) {
    const hasPartNo = Boolean(mention.partNumberNormalized);
    const hasKatNo = Boolean(mention.catalogueNumberNormalized);
    let candidates = hasPartNo ? epcByPartNo.get(mention.partNumberNormalized) || [] : [];
    let matchType = "partNo";
    if (candidates.length === 0 && hasKatNo) {
      candidates = epcByKatNo.get(mention.catalogueNumberNormalized) || [];
      matchType = "katNo";
    }

    if (candidates.length === 0) {
      unmatchedTisParts.push(mention);
      partProcedureLinks.push({
        docId: mention.docId,
        docTitle: mention.docTitle,
        contentType: mention.contentType,
        engines: mention.engines,
        treePaths: mention.treePaths,
        tisPart: mention,
        epcMatches: [],
      });
      continue;
    }

    let filteredCandidates = candidates;
    if (Array.isArray(mention.engines) && mention.engines.length > 0) {
      const engineCompatible = candidates.filter((candidate) => isEpcUsageCompatible(candidate.usage, mention.engines));
      if (engineCompatible.length > 0) filteredCandidates = engineCompatible;
    }

    const epcMatches = filteredCandidates.map((candidate) => {
      const hotspotData = hotspotCache.loadDiagramHotspots(candidate.diagramId);
      const hotspotMeta = hotspotCache.diagramMetaById.get(candidate.diagramId) || null;
      const matchResult = getHotspotMatchesByRef(hotspotData, candidate.refNormalized);
      const hasHotspot = matchResult.matches.length > 0;
      const engineAligned = isEpcUsageCompatible(candidate.usage, mention.engines);
      return {
        matchType,
        confidence: calculateMatchConfidence({
          matchType,
          hasHotspot,
          hotspotMode: matchResult.mode,
          engineAligned,
        }),
        partNo: candidate.partNo,
        partNoNormalized: candidate.partNoNormalized,
        katNo: candidate.katNo,
        katNoNormalized: candidate.katNoNormalized,
        description: candidate.description,
        usage: candidate.usage,
        qty: candidate.qty,
        diagramId: candidate.diagramId,
        diagramFilename: candidate.diagramFilename,
        diagramUrl: candidate.diagramUrl,
        ref: candidate.ref,
        refNormalized: candidate.refNormalized,
        groupId: candidate.groupId,
        groupName: candidate.groupName,
        subSectionId: candidate.subSectionId,
        subSectionName: candidate.subSectionName,
        mainId: candidate.mainId,
        mainName: candidate.mainName,
        sheetCode:
          (hotspotData && hotspotData.sheetCode && hotspotData.sheetCode.text) ||
          (hotspotMeta && hotspotMeta.sheetCode) ||
          null,
        hotspotMode: matchResult.mode,
        hotspotCount: matchResult.matches.length,
      };
    });

    partProcedureLinks.push({
      docId: mention.docId,
      docTitle: mention.docTitle,
      contentType: mention.contentType,
      engines: mention.engines,
      treePaths: mention.treePaths,
      tisPart: mention,
      epcMatches,
    });
  }

  const now = new Date().toISOString();

  const procedureChunksOutput = {
    version: VERSION,
    generatedAt: now,
    chunkCount: chunks.length,
    chunks,
  };

  const docMetadataOutput = {
    version: VERSION,
    generatedAt: now,
    documentCount: documents.length,
    documents,
  };

  const partsIndexOutput = {
    version: VERSION,
    generatedAt: now,
    partCount: epcItems.length,
    items: epcItems,
  };

  const partLinksOutput = {
    version: VERSION,
    generatedAt: now,
    linksCount: partProcedureLinks.length,
    unmatchedCount: unmatchedTisParts.length,
    links: partProcedureLinks,
    unmatchedTisParts,
  };

  const diagramGroundingOutput = {
    version: VERSION,
    generatedAt: now,
    groundingCount: diagramGroundings.length,
    groundings: diagramGroundings,
    stats: {
      exactHotspotMatches: groundedByHotspot,
      numericFallbackMatches: groundedByNumericFallback,
      noHotspotMatch: epcWithoutHotspotMatch,
    },
  };

  writeJson(path.join(outputDir, "procedure-chunks.json"), procedureChunksOutput);
  writeJson(path.join(outputDir, "doc-metadata.json"), docMetadataOutput);
  writeJson(path.join(outputDir, "parts-index.json"), partsIndexOutput);
  writeJson(path.join(outputDir, "part-procedure-links.json"), partLinksOutput);
  writeJson(path.join(outputDir, "diagram-grounding.json"), diagramGroundingOutput);

  const indexManifest = {
    version: VERSION,
    generatedAt: now,
    sourceDataDir: dataDir,
    outputDir,
    files: [
      { name: "procedure-chunks.json", count: chunks.length },
      { name: "doc-metadata.json", count: documents.length },
      { name: "parts-index.json", count: epcItems.length },
      { name: "part-procedure-links.json", count: partProcedureLinks.length },
      { name: "diagram-grounding.json", count: diagramGroundings.length },
    ],
    stats: {
      contentFilesProcessed: contentFiles.length,
      tisPartMentions: tisPartMentions.length,
      unmatchedTisPartMentions: unmatchedTisParts.length,
      epcParts: epcItems.length,
      exactHotspotMatches: groundedByHotspot,
      numericFallbackMatches: groundedByNumericFallback,
      noHotspotMatch: epcWithoutHotspotMatch,
    },
  };
  writeJson(path.join(outputDir, "index-manifest.json"), indexManifest);

  log("RAG index generation complete");
  log(`Chunks: ${chunks.length}`);
  log(`Documents: ${documents.length}`);
  log(`EPC parts: ${epcItems.length}`);
  log(`TIS part mentions: ${tisPartMentions.length}`);
  log(`Unmatched TIS part mentions: ${unmatchedTisParts.length}`);
}

main();

