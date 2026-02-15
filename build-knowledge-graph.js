#!/usr/bin/env node

/**
 * Build knowledge graph for RAG: taxonomy (Phase 1) and LLM-enriched nodes (Phase 2).
 *
 * Inputs (default): viewer/public/data/
 * Outputs (default): viewer/public/data/rag/
 *
 * Phase 1: taxonomy.json — seed from EPC groups + TIS tree roots.
 * Phase 2: knowledge-nodes.json — doc/part annotations (optional, requires LLM).
 */

const fs = require("fs");
const path = require("path");

const VERSION = "1.0.0";

function parseArgs(argv) {
  const args = {
    dataDir: path.join(__dirname, "viewer", "public", "data"),
    outputDir: null,
    enrich: false,
    limit: null,
    dryRun: false,
    model: "gpt-4o-mini",
    concurrency: 20,
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
    } else if (arg === "--enrich") {
      args.enrich = true;
    } else if (arg === "--limit" && next) {
      args.limit = Math.max(0, parseInt(next, 10));
      i += 1;
    } else if (arg === "--dry-run") {
      args.dryRun = true;
    } else if (arg === "--model" && next) {
      args.model = next;
      i += 1;
    } else if (arg === "--concurrency" && next) {
      args.concurrency = Math.max(1, parseInt(next, 10));
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

function slug(text) {
  if (!text || typeof text !== "string") return "";
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

/** Tokenize for name aliases (no stopwords). */
function nameTokens(name) {
  if (!name || typeof name !== "string") return [];
  const normalized = name.toLowerCase().replace(/[^a-z0-9\s]/g, " ");
  return normalized.split(/\s+/).filter((w) => w.length > 1);
}

/**
 * Build seed taxonomy from EPC group/subsection hierarchy and TIS tree roots.
 * EPC: groups A–Q with subSections (id, name) and main (id, name).
 * TIS: manifest tree roots with titles like "A  ...", "B  Paint", "E  Front Wheel Suspension", etc.
 * We map TIS root title leading letter to EPC group(s) and attach treeRoots to systems.
 */
function buildTaxonomy(epc, manifest, docMetadata) {
  const systems = [];
  const tree = manifest && manifest.tree ? manifest.tree : { roots: [], nodes: {} };
  const nodes = tree.nodes || {};
  const rootIds = tree.roots || [];

  // TIS root id -> title
  const rootTitles = new Map();
  for (const id of rootIds) {
    const node = nodes[id];
    if (node && node.title) rootTitles.set(id, node.title.trim());
  }

  // TIS root title leading letter -> EPC group id(s). TIS uses letters that don't always match EPC 1:1.
  const tisLetterToEpc = {
    A: ["A"],
    B: ["B"],
    C: ["C"],
    D: ["D"],
    E: ["K", "N"],   // Front Wheel Suspension, Wheels and Tyres -> Front axle (K), Road wheels (N)
    F: ["M"],       // Rear Axle -> Rear axle (M)
    G: [],          // no TIS G root in manifest
    H: ["J"],       // Brakes (TIS H) -> EPC J
    J: ["E", "F"],  // Engine and aggregates -> Engine (E), Cooling (F) often under same section
    K: ["H"],       // Clutch and Transmission -> Transmission (H)
    L: ["G"],       // Fuel and Exhaust -> Fuel (G)
    M: ["L"],       // Steering -> Steering (L)
    N: ["P"],       // Electrical -> Electrical (P)
    P: [],
    Q: [],
    R: ["Q"],       // Accessories (TIS R) -> EPC Q
  };

  // EPC group id -> list of TIS root ids that map to it
  const epcToRootIds = new Map();
  for (const [rootId, title] of rootTitles) {
    const letter = title.replace(/^\s*([A-Za-z])[\s\S]*/, "$1").toUpperCase();
    const epcGroups = tisLetterToEpc[letter] || [];
    for (const g of epcGroups) {
      if (!epcToRootIds.has(g)) epcToRootIds.set(g, []);
      epcToRootIds.get(g).push(rootId);
    }
  }

  const groups = Array.isArray(epc.groups) ? epc.groups : [];
  for (const group of groups) {
    const groupId = group.id;
    const name = group.name || "";
    const systemId = slug(name) || `epc_${groupId}`;
    const names = [name, ...nameTokens(name)].filter(Boolean);
    const treeRoots = epcToRootIds.get(groupId) || [];

    const subsystems = [];
    const subSections = Array.isArray(group.subSections) ? group.subSections : [];
    for (const sub of subSections) {
      const subId = sub.id;
      const subName = sub.name || "";
      const subSlug = slug(subName) || subId.toLowerCase();
      const subNames = [subName, ...nameTokens(subName)].filter(Boolean);
      const procedureIds = []; // filled by enrichment
      const parts = [];
      const tools = [];
      const torqueSpecs = [];
      if (Array.isArray(sub.main)) {
        for (const m of sub.main) {
          if (m.parts && m.parts.length) {
            for (const p of m.parts) {
              if (p.partNo) parts.push(p.partNo.replace(/\s+/g, "").trim());
            }
          }
        }
      }
      subsystems.push({
        id: subSlug,
        names: [...new Set(subNames)],
        epcSubSections: [subId],
        procedures: procedureIds,
        parts: [...new Set(parts)].slice(0, 500),
        tools,
        torqueSpecs,
      });
    }

    systems.push({
      id: systemId,
      names: [...new Set(names)],
      epcGroups: [groupId],
      treeRoots: [...new Set(treeRoots)],
      subsystems,
    });
  }

  return {
    version: VERSION,
    generatedAt: new Date().toISOString(),
    systems,
  };
}

/** Taxonomy summary for LLM prompt: system IDs, names, and subsystem IDs with names. */
function taxonomySummary(taxonomy) {
  const systems = taxonomy.systems || [];
  const lines = [];
  for (const s of systems) {
    const names = (s.names || []).slice(0, 5).join(", ");
    const subs = (s.subsystems || []).map((sub) => `${sub.id} (${(sub.names || [])[0] || ""})`).join(", ");
    lines.push(`${s.id}: ${names}${subs ? `\n  subsystems: ${subs}` : ""}`);
  }
  return lines.join("\n");
}

const ENRICHMENT_SYSTEM = `You are annotating automotive service documents for a knowledge graph. Given a document's title, type, tree path, full text, and a taxonomy, return a JSON object with exactly these keys (use empty arrays where none apply):
- systemIds: array of taxonomy system ids this document belongs to. Use ONLY ids from the taxonomy system list (e.g. "front_axle_and_suspension", "brakes").
- subsystemIds: array of taxonomy SUBSYSTEM ids if identifiable. Use ONLY subsystem ids from the taxonomy (e.g. "front_wishbones", "front_springs"). Never put system-level ids here.
- components: array of specific component names or part descriptions mentioned in the text.
- procedures: array of procedure action types described (e.g. replace, remove, install, inspect, adjust, measure, bleed, torque).
- tools: array of tool codes or names (e.g. KM-..., special tools, torque wrench).
- torqueRefs: array of torque references as "component value unit" (e.g. "hub nut 180 Nm", "upper wishbone bolt 45 Nm").
- crossRefs: array of other document or section titles explicitly referenced in the text (e.g. "see operation X").
- referencedPartNumbers: array of part numbers (7-9 digit numbers like 9197032, or catalogue numbers like "48 01 654") found in the text.
- referencedProcedureIds: array of procedure names or slugs referenced (e.g. when text says 'see operation "Brake System, Bleed"').
Return only valid JSON, no markdown or explanation.`;

async function callOpenAI({ apiKey, model, systemPrompt, userPrompt }) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI request failed (${response.status}): ${text}`);
  }

  const payload = await response.json();
  return payload?.choices?.[0]?.message?.content || "";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Parse LLM JSON response; return null on failure. */
function parseEnrichmentResponse(text) {
  const trimmed = (text || "").trim();
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    return JSON.parse(jsonMatch[0]);
  } catch (_) {
    return null;
  }
}

/**
 * Build knowledge-nodes.json by LLM enrichment of each document.
 * Reads taxonomy, doc-metadata, procedure-chunks; calls OpenAI per doc; writes nodes.
 */
async function runEnrichment(args) {
  const outputDir = args.outputDir;
  const taxonomyPath = path.join(outputDir, "taxonomy.json");
  const docMetaPath = path.join(outputDir, "doc-metadata.json");
  const chunksPath = path.join(outputDir, "procedure-chunks.json");

  if (!fs.existsSync(taxonomyPath)) {
    console.error("Run without --enrich first to generate taxonomy.json");
    process.exit(1);
  }
  if (!fs.existsSync(docMetaPath) || !fs.existsSync(chunksPath)) {
    console.error("Missing doc-metadata.json or procedure-chunks.json in output dir");
    process.exit(1);
  }

  const apiKey = process.env.OPENAI_API_KEY || "";
  if (!args.dryRun && !apiKey) {
    console.error("Set OPENAI_API_KEY for enrichment, or use --dry-run");
    process.exit(1);
  }

  const taxonomy = readJson(taxonomyPath);
  const docMeta = readJson(docMetaPath);
  const chunksData = readJson(chunksPath);
  const epcPath = path.join(args.dataDir, "epc", "parts.json");
  const epc = fs.existsSync(epcPath) ? readJson(epcPath) : { groups: [] };
  const docs = docMeta.documents || [];
  const chunks = chunksData.chunks || [];

  // Concatenate ALL chunks per docId for full document text
  const docIdToFullText = new Map();
  for (const ch of chunks) {
    if (!ch.docId) continue;
    const prev = docIdToFullText.get(ch.docId) || "";
    const text = ch.text || "";
    docIdToFullText.set(ch.docId, prev ? `${prev}\n${text}` : text);
  }

  // Build compact EPC parts listing per system (keyed by taxonomy system id)
  const systemIdToPartsListing = new Map();
  const epcGroups = Array.isArray(epc.groups) ? epc.groups : [];
  for (const sys of taxonomy.systems || []) {
    const lines = [];
    for (const gId of sys.epcGroups || []) {
      const group = epcGroups.find((g) => g.id === gId);
      if (!group) continue;
      for (const sub of group.subSections || []) {
        for (const m of sub.main || []) {
          for (const p of m.parts || []) {
            if (p.partNo && p.description) {
              lines.push(`${p.partNo.replace(/[()]/g, "").trim()} ${p.description.slice(0, 50).trim()}`);
            }
          }
        }
      }
    }
    if (lines.length > 0) systemIdToPartsListing.set(sys.id, lines.join("\n"));
  }
  // Reverse map: TIS treePath root letter -> taxonomy system IDs
  // Uses the same tisLetterToEpc mapping from buildTaxonomy, then EPC group -> system
  const epcGroupToSystemId = new Map();
  for (const sys of taxonomy.systems || []) {
    for (const gId of sys.epcGroups || []) {
      epcGroupToSystemId.set(gId, sys.id);
    }
  }
  const tisLetterToEpc = {
    A: ["A"], B: ["B"], C: ["C"], D: ["D"],
    E: ["K", "N"], F: ["M"], H: ["J"], J: ["E", "F"],
    K: ["H"], L: ["G"], M: ["L"], N: ["P"], R: ["Q"],
  };
  const tisLetterToSystemIds = new Map();
  for (const [letter, epcIds] of Object.entries(tisLetterToEpc)) {
    const sysIds = epcIds.map((g) => epcGroupToSystemId.get(g)).filter(Boolean);
    if (sysIds.length > 0) tisLetterToSystemIds.set(letter, sysIds);
  }
  // Build a single compact listing of ALL EPC parts for the enrichment prompt
  const allPartsLines = [];
  for (const [sysId, listing] of systemIdToPartsListing) {
    allPartsLines.push(`[${sysId}]\n${listing}`);
  }
  const allPartsListing = allPartsLines.join("\n");
  log(`Built EPC parts listings for ${systemIdToPartsListing.size} systems (${allPartsListing.length} chars, ~${Math.round(allPartsListing.length / 4)} tokens)`);

  const summary = taxonomySummary(taxonomy);
  const model = args.model || "gpt-4o-mini";
  let limit = args.limit != null ? args.limit : docs.length;
  if (limit <= 0) limit = docs.length;

  const total = Math.min(docs.length, limit);
  const concurrency = args.concurrency || 20;
  const nodes = new Array(total);
  let completed = 0;
  let errors = 0;

  log(`Enriching ${total} documents (dryRun=${args.dryRun}, concurrency=${concurrency})`);

  function emptyNode(docId, title, contentType) {
    return { docId, title, contentType, systemIds: [], subsystemIds: [], components: [], procedures: [], tools: [], torqueRefs: [], crossRefs: [], referencedPartNumbers: [], referencedProcedureIds: [] };
  }

  async function enrichOne(i) {
    const doc = docs[i];
    const docId = doc.docId || doc.sectionId;
    const title = doc.title || "";
    const contentType = doc.contentType || "generic";
    const treePaths = Array.isArray(doc.treePaths) ? doc.treePaths : [];
    const fullText = docIdToFullText.get(docId) || "";

    // Include ALL EPC parts so the LLM can match component names across system boundaries.
    // Many procedures (e.g. exhaust manifold under "J Engine") reference parts in other EPC groups (e.g. G Fuel/Exhaust).
    let epcContext = "";
    if (allPartsListing) {
      epcContext = `\nEPC parts catalog (partNo description). Match components from the document text to these part numbers in referencedPartNumbers:\n${allPartsListing}\n`;
    }

    const userPrompt = `Taxonomy:\n${summary}\n\nDocument: title="${title}" contentType=${contentType}\ntreePaths: ${treePaths.slice(0, 3).join(" | ")}\n\nFull text:\n${fullText}\n${epcContext}\nReturn JSON with systemIds, subsystemIds, components, procedures, tools, torqueRefs, crossRefs, referencedPartNumbers, referencedProcedureIds.`;

    if (args.dryRun) {
      nodes[i] = emptyNode(docId, title, contentType);
      completed++;
      if (completed % 100 === 0) log(`Dry-run ${completed}/${total}`);
      return;
    }

    try {
      const raw = await callOpenAI({ apiKey, model, systemPrompt: ENRICHMENT_SYSTEM, userPrompt });
      const parsed = parseEnrichmentResponse(raw);
      if (parsed) {
        nodes[i] = {
          docId, title, contentType,
          systemIds: Array.isArray(parsed.systemIds) ? parsed.systemIds : [],
          subsystemIds: Array.isArray(parsed.subsystemIds) ? parsed.subsystemIds : [],
          components: Array.isArray(parsed.components) ? parsed.components : [],
          procedures: Array.isArray(parsed.procedures) ? parsed.procedures : [],
          tools: Array.isArray(parsed.tools) ? parsed.tools : [],
          torqueRefs: Array.isArray(parsed.torqueRefs) ? parsed.torqueRefs : [],
          crossRefs: Array.isArray(parsed.crossRefs) ? parsed.crossRefs : [],
          referencedPartNumbers: Array.isArray(parsed.referencedPartNumbers) ? parsed.referencedPartNumbers : [],
          referencedProcedureIds: Array.isArray(parsed.referencedProcedureIds) ? parsed.referencedProcedureIds : [],
        };
      } else {
        nodes[i] = emptyNode(docId, title, contentType);
      }
    } catch (err) {
      errors++;
      log(`Enrich error for ${docId}: ${err.message}`);
      nodes[i] = emptyNode(docId, title, contentType);
    }
    completed++;
    if (completed % 50 === 0) log(`Enriched ${completed}/${total} (${errors} errors)`);
  }

  // Run with bounded concurrency, staggering worker starts to avoid initial burst
  const queue = Array.from({ length: total }, (_, i) => i);
  const workerCount = Math.min(concurrency, total);
  async function worker() {
    while (queue.length > 0) {
      const i = queue.shift();
      if (i === undefined) break;
      await enrichOne(i);
    }
  }
  const workers = [];
  for (let w = 0; w < workerCount; w++) {
    workers.push(worker());
    if (w < workerCount - 1) await sleep(50); // 50ms stagger between worker launches
  }
  await Promise.all(workers);

  const validNodes = nodes.filter(Boolean);
  log(`Done: ${completed} processed, ${errors} errors, ${validNodes.length} nodes written`);
  const out = {
    version: VERSION,
    generatedAt: new Date().toISOString(),
    documentCount: validNodes.length,
    nodes: validNodes,
  };
  const outPath = path.join(outputDir, "knowledge-nodes.json");
  writeJson(outPath, out);
  log(`Wrote ${outPath} (${nodes.length} nodes)`);
}

async function main() {
  const args = parseArgs(process.argv);
  const dataDir = args.dataDir;
  const outputDir = args.outputDir;

  log("Building knowledge graph");
  log(`Data dir: ${dataDir}`);
  log(`Output dir: ${outputDir}`);

  const epcPath = path.join(dataDir, "epc", "parts.json");
  const manifestPath = path.join(dataDir, "manifest.json");
  const docMetaPath = path.join(outputDir, "doc-metadata.json");

  if (!fs.existsSync(epcPath)) {
    console.error("Missing EPC data: " + epcPath);
    process.exit(1);
  }
  if (!fs.existsSync(manifestPath)) {
    console.error("Missing manifest: " + manifestPath);
    process.exit(1);
  }

  const epc = readJson(epcPath);
  const manifest = readJson(manifestPath);
  const docMetadata = fs.existsSync(docMetaPath) ? readJson(docMetaPath) : { documents: [] };

  const taxonomy = buildTaxonomy(epc, manifest, docMetadata);
  ensureDir(outputDir);
  const taxonomyPath = path.join(outputDir, "taxonomy.json");
  writeJson(taxonomyPath, taxonomy);
  log(`Wrote ${taxonomyPath} (${taxonomy.systems.length} systems)`);

  if (args.enrich) {
    await runEnrichment(args);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
