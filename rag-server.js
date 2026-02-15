const express = require("express");
const fs = require("fs");
const path = require("path");

const DEFAULT_PORT = Number(process.env.RAG_SERVER_PORT || 3002);
const DEFAULT_DATA_DIR = path.join(__dirname, "viewer", "public", "data");
const DEFAULT_RAG_DIR = path.join(DEFAULT_DATA_DIR, "rag");

const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "of",
  "for",
  "to",
  "in",
  "on",
  "with",
  "without",
  "from",
  "by",
  "is",
  "are",
  "be",
  "it",
  "this",
  "that",
  "as",
  "at",
  "i",
  "you",
  "my",
  "your",
  "me",
  "need",
  "replace",
  "show",
  "explain",
  "what",
  "where",
  "how",
]);

function normalizeWhitespace(value) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim();
}

function normalizePartNo(value) {
  if (typeof value !== "string") return "";
  return value.replace(/^[\s(]+|[\s)]+$/g, "").replace(/\s+/g, "").trim().toUpperCase();
}

function normalizeRef(value) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).replace(/\s+/g, "").trim().toUpperCase();
  if (!normalized || normalized === "-" || normalized === "N/A") return null;
  return normalized;
}

function tokenize(text) {
  if (!text || typeof text !== "string") return [];
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !STOPWORDS.has(token));
}

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    return fallback;
  }
}

function extractPartNumbersFromText(text) {
  if (!text || typeof text !== "string") return [];
  const matches = text.match(/\b\d{6,9}\b/g) || [];
  const seen = new Set();
  const out = [];
  for (const match of matches) {
    const normalized = normalizePartNo(match);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function isEngineCompatible(itemEngines, selectedEngine) {
  if (!selectedEngine) return true;
  if (!Array.isArray(itemEngines) || itemEngines.length === 0) return true;
  return itemEngines.includes(selectedEngine);
}

function isUsageCompatible(usage, selectedEngine) {
  if (!selectedEngine) return true;
  const normalizedUsage = normalizeWhitespace(usage).toUpperCase();
  if (!normalizedUsage) return true;
  return normalizedUsage.includes(selectedEngine.toUpperCase());
}

function detectProcedureIntent(query, queryTokens) {
  const lower = query.toLowerCase();
  if (
    lower.includes("replace") ||
    lower.includes("remove") ||
    lower.includes("install") ||
    lower.includes("change")
  ) {
    return true;
  }
  return queryTokens.some((token) => ["replace", "remove", "install", "change", "repair"].includes(token));
}

function scoreChunk(chunk, query, queryTokens, selectedEngine, procedureIntent) {
  if (!isEngineCompatible(chunk.engines, selectedEngine)) return -1;
  const title = (chunk.title || "").toLowerCase();
  const text = (chunk.text || "").toLowerCase();
  const queryLower = query.toLowerCase();
  let score = 0;

  if (title.includes(queryLower)) score += 12;
  if (text.includes(queryLower)) score += 8;

  for (const token of queryTokens) {
    if (title.includes(token)) score += 3;
    else if (text.includes(token)) score += 1;
  }

  if (procedureIntent) {
    if (chunk.contentType === "procedure") score += 9;
    if (chunk.meta && chunk.meta.chunkType === "procedure_steps") score += 4;
    if (/(remove|install|replace)/.test(title)) score += 2;
    if (chunk.contentType === "generic") score -= 1;
  }

  if (chunk.contentType === "tsb") score += 0.5;
  if (chunk.contentType === "diagnostic") score -= 0.5;

  if (selectedEngine && Array.isArray(chunk.engines) && chunk.engines.includes(selectedEngine)) {
    score += 1;
  }
  return score;
}

function buildCitationFromChunk(chunk, score) {
  return {
    type: "doc",
    docId: chunk.docId,
    chunkId: chunk.chunkId,
    title: chunk.title,
    url: `/doc/${chunk.docId}`,
    score: Number(score.toFixed(3)),
  };
}

function bestDiagramFromPart(part, diagramGroundingByPartNo) {
  if (!part || !part.partNoNormalized) return null;
  const candidates = diagramGroundingByPartNo.get(part.partNoNormalized) || [];
  if (candidates.length === 0) return null;

  const sorted = [...candidates].sort((a, b) => {
    const aScore = (a.hotspot && a.hotspot.hasHotspot ? 1 : 0) * 100 + (a.hotspot && a.hotspot.bestConfidence ? a.hotspot.bestConfidence : 0);
    const bScore = (b.hotspot && b.hotspot.hasHotspot ? 1 : 0) * 100 + (b.hotspot && b.hotspot.bestConfidence ? b.hotspot.bestConfidence : 0);
    return bScore - aScore;
  });
  return sorted[0];
}

function clipText(text, maxChars = 1500) {
  if (!text || typeof text !== "string") return "";
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}...`;
}

function extractJsonFromText(text) {
  if (!text || typeof text !== "string") return null;
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch (_) {}

  const fencedMatch = trimmed.match(/```json\s*([\s\S]+?)\s*```/i);
  if (fencedMatch) {
    try {
      return JSON.parse(fencedMatch[1]);
    } catch (_) {}
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    try {
      return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
    } catch (_) {}
  }
  return null;
}

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

async function callAnthropic({ apiKey, model, systemPrompt, userPrompt }) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 1400,
      temperature: 0.2,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Anthropic request failed (${response.status}): ${text}`);
  }

  const payload = await response.json();
  const chunks = Array.isArray(payload.content) ? payload.content : [];
  return chunks
    .filter((item) => item && item.type === "text")
    .map((item) => item.text)
    .join("\n");
}

function buildFallbackAnswer({ query, retrieval, selectedEngine }) {
  const topChunks = retrieval.topChunks.slice(0, 3);
  const topParts = retrieval.matchedParts.slice(0, 8);
  const topTools = retrieval.tools.slice(0, 8);
  const topTorque = retrieval.torqueSpecs.slice(0, 10);
  const topGrounding = retrieval.diagramGrounding.slice(0, 8);

  let answer = "I could not find a confident match in the indexed content.";
  if (topChunks.length > 0) {
    const titles = [...new Set(topChunks.map((item) => item.title))];
    answer =
      `I found relevant procedures for "${query}"` +
      (selectedEngine ? ` (engine: ${selectedEngine})` : "") +
      `.\nTop matches: ${titles.slice(0, 5).join("; ")}.`;
  }

  const safePart = (part) => {
    if (!part || typeof part !== "object") return null;
    const groupId = part.groupId != null ? part.groupId : "";
    const diagramId = part.diagramId != null ? part.diagramId : "";
    return {
      partNo: part.partNo,
      katNo: part.katNo,
      description: part.description,
      usage: part.usage,
      qty: part.qty,
      diagramId: part.diagramId,
      diagramUrl: groupId && diagramId ? `/epc/${groupId}/diagram/${diagramId}` : null,
      ref: part.ref,
    };
  };

  return {
    answer,
    procedureSummary: topChunks.map((chunk) => `${chunk.title}: ${clipText(chunk.text, 280)}`).join("\n"),
    requiredParts: topParts.map(safePart).filter(Boolean),
    requiredTools: topTools,
    torqueSpecs: topTorque,
    diagramGrounding: topGrounding,
    warnings: retrieval.warnings,
    citations: retrieval.citations,
  };
}

function buildRetrieverState({
  chunksData,
  docsData,
  partsData,
  linksData,
  groundingData,
  referencesTools,
  referencesTorque,
}) {
  const chunks = Array.isArray(chunksData && chunksData.chunks) ? chunksData.chunks : [];
  const documents = Array.isArray(docsData && docsData.documents) ? docsData.documents : [];
  const partsIndex = Array.isArray(partsData && partsData.items) ? partsData.items : [];
  const partLinks = Array.isArray(linksData && linksData.links) ? linksData.links : [];
  const diagramGrounding = Array.isArray(groundingData && groundingData.groundings) ? groundingData.groundings : [];

  const chunksByDocId = new Map();
  for (const chunk of chunks) {
    if (!chunksByDocId.has(chunk.docId)) chunksByDocId.set(chunk.docId, []);
    chunksByDocId.get(chunk.docId).push(chunk);
  }

  const partsByPartNo = new Map();
  for (const part of partsIndex) {
    if (!part.partNoNormalized) continue;
    if (!partsByPartNo.has(part.partNoNormalized)) partsByPartNo.set(part.partNoNormalized, []);
    partsByPartNo.get(part.partNoNormalized).push(part);
  }

  const diagramGroundingByPartNo = new Map();
  for (const item of diagramGrounding) {
    const key = item.partNoNormalized;
    if (!key) continue;
    if (!diagramGroundingByPartNo.has(key)) diagramGroundingByPartNo.set(key, []);
    diagramGroundingByPartNo.get(key).push(item);
  }

  const toolsByDocId = new Map();
  const tools = Array.isArray(referencesTools && referencesTools.tools) ? referencesTools.tools : [];
  for (const tool of tools) {
    const usedIn = Array.isArray(tool.usedIn) ? tool.usedIn : [];
    for (const docId of usedIn) {
      if (!toolsByDocId.has(docId)) toolsByDocId.set(docId, []);
      toolsByDocId.get(docId).push({
        code: tool.code,
        name: tool.name,
        description: tool.description,
      });
    }
  }

  const torqueByDocId = new Map();
  const torqueValues = Array.isArray(referencesTorque && referencesTorque.values) ? referencesTorque.values : [];
  for (const entry of torqueValues) {
    const docId = entry.sourcePage;
    if (!docId) continue;
    if (!torqueByDocId.has(docId)) torqueByDocId.set(docId, []);
    torqueByDocId.get(docId).push(entry);
  }

  return {
    chunks,
    documents,
    partsIndex,
    partLinks,
    diagramGrounding,
    chunksByDocId,
    partsByPartNo,
    diagramGroundingByPartNo,
    toolsByDocId,
    torqueByDocId,
  };
}

function retrieveContext(state, { query, selectedEngine, limit = 10 }) {
  const queryTokens = tokenize(query);
  const partNosInQuery = extractPartNumbersFromText(query);
  const procedureIntent = detectProcedureIntent(query, queryTokens);

  const scoredChunks = [];
  for (const chunk of state.chunks) {
    const score = scoreChunk(chunk, query, queryTokens, selectedEngine, procedureIntent);
    if (score <= 0) continue;
    scoredChunks.push({ chunk, score });
  }
  scoredChunks.sort((a, b) => b.score - a.score);

  const maxChunksPerDoc = 3;
  const selected = [];
  const docChunkCount = new Map();
  for (const candidate of scoredChunks) {
    const count = docChunkCount.get(candidate.chunk.docId) || 0;
    if (count >= maxChunksPerDoc) continue;
    docChunkCount.set(candidate.chunk.docId, count + 1);
    selected.push(candidate);
    if (selected.length >= limit) break;
  }

  const topChunks = selected.map(({ chunk, score }) => ({
    ...chunk,
    score: Number(score.toFixed(3)),
  }));

  const citations = topChunks.map((chunk) => buildCitationFromChunk(chunk, chunk.score));
  const docIdSet = new Set(topChunks.map((chunk) => chunk.docId));

  const relatedLinks = state.partLinks.filter((link) => docIdSet.has(link.docId));
  const partsFromLinks = [];
  for (const link of relatedLinks) {
    for (const match of link.epcMatches || []) {
      partsFromLinks.push({
        ...match,
        sourceDocId: link.docId,
        sourceDocTitle: link.docTitle,
      });
    }
  }

  const scoredParts = [];
  for (const part of state.partsIndex) {
    if (selectedEngine && !isUsageCompatible(part.usage, selectedEngine)) continue;
    let score = 0;
    if (partNosInQuery.length > 0 && part.partNoNormalized && partNosInQuery.includes(part.partNoNormalized)) {
      score += 25;
    }
    const searchable = [
      part.description,
      part.groupName,
      part.subSectionName,
      part.mainName,
      part.partNo,
      part.katNo,
      part.usage,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    for (const token of queryTokens) {
      if (searchable.includes(token)) score += 2;
    }
    if (score > 0) scoredParts.push({ part, score });
  }
  scoredParts.sort((a, b) => b.score - a.score);
  const lexicalParts = scoredParts.slice(0, 10).map((entry) => ({
    ...entry.part,
    score: entry.score,
  }));

  const partIdentitySet = new Set();
  const mergedParts = [];
  const ingestPart = (part) => {
    const key = `${part.partNoNormalized || part.partNo}|${part.diagramId}|${part.refNormalized || part.ref || ""}`;
    if (partIdentitySet.has(key)) return;
    partIdentitySet.add(key);
    // Override diagramUrl to use EPC browser route (not raw image path)
    const diagramUrl = part.diagramId && part.groupId
      ? `/epc/${part.groupId}/diagram/${part.diagramId}`
      : null;
    mergedParts.push({ ...part, diagramUrl });
  };
  partsFromLinks.forEach(ingestPart);
  lexicalParts.forEach(ingestPart);

  const diagramGrounding = [];
  for (const part of mergedParts) {
    const grounding = bestDiagramFromPart(part, state.diagramGroundingByPartNo);
    if (!grounding) continue;
    diagramGrounding.push({
      partNo: grounding.partNo,
      description: grounding.description,
      usage: grounding.usage,
      ref: grounding.ref,
      diagramId: grounding.diagram.id,
      sheetCode: grounding.diagram.sheetCode,
      geometryCount: grounding.hotspot.geometryCount,
      hotspotMode: grounding.hotspot.mode,
      hotspotConfidence: grounding.hotspot.bestConfidence,
      groupId: grounding.groupId,
      groupName: grounding.groupName,
      diagramUrl: `/epc/${grounding.groupId}/diagram/${grounding.diagram.id}`,
    });
  }

  const tools = [];
  for (const docId of docIdSet) {
    const entries = state.toolsByDocId.get(docId) || [];
    entries.forEach((entry) => tools.push(entry));
  }
  const uniqueToolMap = new Map();
  for (const tool of tools) {
    if (!tool.code) continue;
    if (!uniqueToolMap.has(tool.code)) uniqueToolMap.set(tool.code, tool);
  }

  const torqueSpecs = [];
  for (const docId of docIdSet) {
    const entries = state.torqueByDocId.get(docId) || [];
    entries.forEach((entry) => {
      torqueSpecs.push({
        component: entry.component,
        value: entry.value,
        unit: entry.unit,
        sourcePage: entry.sourcePage,
      });
    });
  }

  const warnings = [];
  if (topChunks.length === 0) warnings.push("No high-confidence document chunks matched the query.");
  if (mergedParts.length === 0) warnings.push("No matching parts identified from EPC index for this query.");

  return {
    query,
    selectedEngine: selectedEngine || null,
    queryTokens,
    partNosInQuery,
    topChunks,
    matchedParts: mergedParts.slice(0, 12),
    tools: Array.from(uniqueToolMap.values()).slice(0, 12),
    torqueSpecs: torqueSpecs.slice(0, 20),
    diagramGrounding: diagramGrounding.slice(0, 12),
    citations: citations.slice(0, 20),
    warnings,
  };
}

function buildLlmPrompts({ query, retrieval, selectedEngine }) {
  const schemaInstructions = `Return strict JSON with exactly these keys:
{
  "answer": string,
  "procedureSummary": string,
  "requiredParts": [{"partNo": string, "katNo": string, "description": string, "usage": string, "qty": string, "diagramId": string, "diagramUrl": string, "ref": string}],
  "requiredTools": [{"code": string, "name": string, "description": string}],
  "torqueSpecs": [{"component": string, "value": string, "unit": string, "sourcePage": string}],
  "diagramGrounding": [{"partNo": string, "description": string, "usage": string, "ref": string, "diagramId": string, "sheetCode": string, "geometryCount": number, "hotspotMode": string, "hotspotConfidence": number, "groupId": string, "groupName": string, "diagramUrl": string}],
  "warnings": [string],
  "citations": [{"type": string, "docId": string, "chunkId": string, "title": string, "url": string, "score": number}]
}`;

  const systemPrompt =
    "You are a workshop assistant for Opel/Vauxhall TIS and EPC data. " +
    "Only use provided retrieval context. Do not invent unsupported parts, tools, torque, or procedures. " +
    "If evidence is weak, say so in warnings.";

  const compactContext = {
    selectedEngine: selectedEngine || null,
    topChunks: retrieval.topChunks.slice(0, 8).map((chunk) => ({
      chunkId: chunk.chunkId,
      docId: chunk.docId,
      title: chunk.title,
      text: clipText(chunk.text, 900),
      score: chunk.score,
    })),
    matchedParts: retrieval.matchedParts.slice(0, 8),
    tools: retrieval.tools.slice(0, 8),
    torqueSpecs: retrieval.torqueSpecs.slice(0, 8),
    diagramGrounding: retrieval.diagramGrounding.slice(0, 8),
    citations: retrieval.citations.slice(0, 12),
    warnings: retrieval.warnings,
  };

  const userPrompt =
    `User query: ${query}\n\n` +
    `Retrieved context JSON:\n${JSON.stringify(compactContext, null, 2)}\n\n` +
    `${schemaInstructions}\n` +
    "Use concise workshop language.";

  return { systemPrompt, userPrompt };
}

function createServer({ dataDir = DEFAULT_DATA_DIR, ragDir = DEFAULT_RAG_DIR, port = DEFAULT_PORT } = {}) {
  const app = express();
  app.use(express.json({ limit: "2mb" }));

  app.use((error, req, res, next) => {
    if (error && error.type === "entity.parse.failed") {
      return res.status(400).json({ ok: false, error: "Invalid JSON request body" });
    }
    return next(error);
  });

  app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") return res.sendStatus(200);
    return next();
  });

  let state = null;

  const loadState = () => {
    const chunksData = readJson(path.join(ragDir, "procedure-chunks.json"), { chunks: [] });
    const docsData = readJson(path.join(ragDir, "doc-metadata.json"), { documents: [] });
    const partsData = readJson(path.join(ragDir, "parts-index.json"), { items: [] });
    const linksData = readJson(path.join(ragDir, "part-procedure-links.json"), { links: [] });
    const groundingData = readJson(path.join(ragDir, "diagram-grounding.json"), { groundings: [] });
    const referencesTools = readJson(path.join(dataDir, "references", "tools.json"), { tools: [] });
    const referencesTorque = readJson(path.join(dataDir, "references", "torque-values.json"), { values: [] });

    state = buildRetrieverState({
      chunksData,
      docsData,
      partsData,
      linksData,
      groundingData,
      referencesTools,
      referencesTorque,
    });
  };

  const ensureStateLoaded = (res) => {
    if (state) return true;
    res.status(503).json({
      ok: false,
      error: "RAG indexes are not loaded. Run `npm run build-rag-index` then restart `npm run rag-server`.",
    });
    return false;
  };

  loadState();

  app.get("/api/health", (req, res) => {
    res.json({
      ok: true,
      loaded: Boolean(state),
      counts: {
        chunks: state ? state.chunks.length : 0,
        documents: state ? state.documents.length : 0,
        parts: state ? state.partsIndex.length : 0,
        links: state ? state.partLinks.length : 0,
        diagramGrounding: state ? state.diagramGrounding.length : 0,
      },
    });
  });

  app.post("/api/reload-indexes", (req, res) => {
    try {
      loadState();
      res.json({
        ok: true,
        counts: {
          chunks: state.chunks.length,
          documents: state.documents.length,
          parts: state.partsIndex.length,
          links: state.partLinks.length,
          diagramGrounding: state.diagramGrounding.length,
        },
      });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/retrieve", (req, res) => {
    const query = normalizeWhitespace(req.body && req.body.query ? String(req.body.query) : "");
    const selectedEngine = req.body && req.body.selectedEngine ? String(req.body.selectedEngine) : null;
    const limit = req.body && Number.isFinite(req.body.limit) ? Number(req.body.limit) : 10;
    if (!query) {
      return res.status(400).json({ ok: false, error: "query is required" });
    }
    if (!ensureStateLoaded(res)) return;

    try {
      const retrieval = retrieveContext(state, {
        query,
        selectedEngine,
        limit: Math.max(1, Math.min(limit, 25)),
      });
      return res.json({ ok: true, retrieval });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/locate-part", (req, res) => {
    const partNoRaw = normalizeWhitespace(req.body && req.body.partNo ? String(req.body.partNo) : "");
    const diagramId = normalizeWhitespace(req.body && req.body.diagramId ? String(req.body.diagramId) : "");
    const ref = normalizeRef(req.body && req.body.ref ? req.body.ref : null);
    if (!partNoRaw && !diagramId) {
      return res.status(400).json({ ok: false, error: "partNo or diagramId is required" });
    }
    if (!ensureStateLoaded(res)) return;

    const partNo = normalizePartNo(partNoRaw);
    let matches = state.diagramGrounding;
    if (partNo) matches = matches.filter((item) => item.partNoNormalized === partNo);
    if (diagramId) matches = matches.filter((item) => item.diagram && item.diagram.id === diagramId);
    if (ref) matches = matches.filter((item) => normalizeRef(item.ref) === ref);

    const payload = matches.slice(0, 100).map((item) => ({
      partNo: item.partNo,
      description: item.description,
      usage: item.usage,
      qty: item.qty,
      groupId: item.groupId,
      groupName: item.groupName,
      subSectionId: item.subSectionId,
      subSectionName: item.subSectionName,
      mainId: item.mainId,
      mainName: item.mainName,
      ref: item.ref,
      diagram: item.diagram,
      hotspot: item.hotspot,
      diagramRoute: item.diagram && item.diagram.id ? `/epc/${item.groupId}/diagram/${item.diagram.id}` : null,
    }));

    return res.json({
      ok: true,
      query: { partNo: partNoRaw || null, diagramId: diagramId || null, ref: ref || null },
      count: payload.length,
      matches: payload,
    });
  });

  app.post("/api/chat", async (req, res) => {
    try {
      const query = normalizeWhitespace(req.body && req.body.query ? String(req.body.query) : "");
      const selectedEngine = req.body && req.body.selectedEngine ? String(req.body.selectedEngine) : null;
      const llmPayload = req.body && typeof req.body.llm === "object" && req.body.llm ? req.body.llm : null;
      const preferredProvider = normalizeWhitespace(
        llmPayload && llmPayload.provider ? String(llmPayload.provider) : req.body && req.body.provider ? String(req.body.provider) : ""
      );
      const provider = preferredProvider.toLowerCase();
      const requestedApiKey = normalizeWhitespace(llmPayload && llmPayload.apiKey ? String(llmPayload.apiKey) : "");
      const requestedModel = normalizeWhitespace(llmPayload && llmPayload.model ? String(llmPayload.model) : "");
      if (!query) {
        return res.status(400).json({ ok: false, error: "query is required" });
      }
      if (!ensureStateLoaded(res)) return;

      const retrieval = retrieveContext(state, {
        query,
        selectedEngine,
        limit: 12,
      });

      const fallbackAnswer = buildFallbackAnswer({
        query,
        retrieval,
        selectedEngine,
      });

      let providerUsed = null;
      let modelUsed = null;
      let llmJson = null;
      let providerWarning = null;

      if (provider) {
        const providerLower = provider.toLowerCase();
        const prompts = buildLlmPrompts({ query, retrieval, selectedEngine });
        if (providerLower === "openai") {
          const apiKey = requestedApiKey;
          if (apiKey) {
            try {
              const model = requestedModel || "gpt-4o-mini";
              const responseText = await callOpenAI({
                apiKey,
                model,
                systemPrompt: prompts.systemPrompt,
                userPrompt: prompts.userPrompt,
              });
              llmJson = extractJsonFromText(responseText);
              providerUsed = "openai";
              modelUsed = model;
            } catch (error) {
              providerWarning = "OpenAI request failed; returned retrieval-based fallback.";
              console.warn(`[RAG] OpenAI chat failure: ${error.message}`);
            }
          } else {
            providerWarning = "OpenAI provider requested but no API key was provided in chat settings; returned retrieval-based fallback.";
          }
        } else if (providerLower === "anthropic" || providerLower === "claude") {
          const apiKey = requestedApiKey;
          if (apiKey) {
            try {
              const model = requestedModel || "claude-3-5-sonnet-latest";
              const responseText = await callAnthropic({
                apiKey,
                model,
                systemPrompt: prompts.systemPrompt,
                userPrompt: prompts.userPrompt,
              });
              llmJson = extractJsonFromText(responseText);
              providerUsed = "anthropic";
              modelUsed = model;
            } catch (error) {
              providerWarning = "Anthropic request failed; returned retrieval-based fallback.";
              console.warn(`[RAG] Anthropic chat failure: ${error.message}`);
            }
          } else {
            providerWarning = "Anthropic provider requested but no API key was provided in chat settings; returned retrieval-based fallback.";
          }
        } else {
          providerWarning = `Unsupported provider "${provider}". Returned retrieval-based fallback.`;
        }
      }

      const responsePayload = llmJson && typeof llmJson === "object" ? llmJson : fallbackAnswer;
      if (!Array.isArray(responsePayload.citations) || responsePayload.citations.length === 0) {
        responsePayload.citations = retrieval.citations;
      }
      if (!Array.isArray(responsePayload.diagramGrounding) || responsePayload.diagramGrounding.length === 0) {
        responsePayload.diagramGrounding = retrieval.diagramGrounding;
      }
      if (!Array.isArray(responsePayload.warnings)) {
        responsePayload.warnings = retrieval.warnings;
      }
      if (providerWarning) {
        responsePayload.warnings = Array.isArray(responsePayload.warnings) ? responsePayload.warnings : [];
        if (!responsePayload.warnings.includes(providerWarning)) {
          responsePayload.warnings.push(providerWarning);
        }
      }
      if (typeof responsePayload.answer !== "string" || responsePayload.answer.trim() === "") {
        responsePayload.answer = "I could not find a confident match in the indexed content.";
      }

      return res.json({
        ok: true,
        providerUsed,
        modelUsed,
        retrieval: {
          selectedEngine: retrieval.selectedEngine,
          topChunkCount: retrieval.topChunks.length,
          matchedPartCount: retrieval.matchedParts.length,
          citationCount: retrieval.citations.length,
        },
        response: responsePayload,
      });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

  const start = () =>
    new Promise((resolve) => {
      const server = app.listen(port, () => {
        console.log(`[RAG] Server running on http://localhost:${port}`);
        console.log(`[RAG] Data: ${dataDir}`);
        console.log(`[RAG] Indexes: ${ragDir}`);
        resolve(server);
      });
    });

  return { app, start, reload: loadState };
}

if (require.main === module) {
  createServer().start();
}

module.exports = {
  createServer,
  retrieveContext,
  normalizePartNo,
  normalizeRef,
};

