const express = require("express");
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

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

async function callOpenAI({ apiKey, model, systemPrompt, userPrompt, images, history }) {
  // Build user content: text-only string when no images, multi-part array for vision
  let userContent;
  if (Array.isArray(images) && images.length > 0) {
    userContent = [{ type: "text", text: userPrompt }];
    for (const img of images) {
      userContent.push({
        type: "image_url",
        image_url: { url: `data:${img.mediaType || "image/png"};base64,${img.base64}` },
      });
    }
  } else {
    userContent = userPrompt;
  }

  // Build messages array with conversation history
  const messages = [{ role: "system", content: systemPrompt }];
  if (Array.isArray(history) && history.length > 0) {
    for (const h of history) {
      messages.push({ role: h.role === "assistant" ? "assistant" : "user", content: h.text || "" });
    }
  }
  messages.push({ role: "user", content: userContent });

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, messages }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI request failed (${response.status}): ${text}`);
  }

  const payload = await response.json();
  return payload?.choices?.[0]?.message?.content || "";
}

async function callAnthropic({ apiKey, model, systemPrompt, userPrompt, images, history }) {
  // Build user content: text string when no images, multi-part array for vision
  let userContent;
  if (Array.isArray(images) && images.length > 0) {
    userContent = [{ type: "text", text: userPrompt }];
    for (const img of images) {
      userContent.push({
        type: "image",
        source: {
          type: "base64",
          media_type: img.mediaType || "image/png",
          data: img.base64,
        },
      });
    }
  } else {
    userContent = userPrompt;
  }

  // Build messages array with conversation history
  const messages = [];
  if (Array.isArray(history) && history.length > 0) {
    for (const h of history) {
      messages.push({ role: h.role === "assistant" ? "assistant" : "user", content: h.text || "" });
    }
  }
  messages.push({ role: "user", content: userContent });

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
      messages,
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
  taxonomyData,
  knowledgeNodesData,
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

  const taxonomy = taxonomyData && Array.isArray(taxonomyData.systems) ? taxonomyData : null;
  const knowledgeNodes = knowledgeNodesData && Array.isArray(knowledgeNodesData.nodes) ? knowledgeNodesData.nodes : [];
  const docIdToKnowledgeNode = new Map();
  for (const node of knowledgeNodes) {
    if (node.docId) docIdToKnowledgeNode.set(node.docId, node);
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
    taxonomy,
    knowledgeNodes,
    docIdToKnowledgeNode,
  };
}

function taxonomySummaryForPlanner(taxonomy) {
  if (!taxonomy || !Array.isArray(taxonomy.systems)) return "";
  return taxonomy.systems
    .map((s) => `${s.id}: ${(s.names || []).slice(0, 5).join(", ")}`)
    .join("\n");
}

const QUERY_PLANNER_SYSTEM = `You are a query planner for automotive service documentation. Given a user query and a taxonomy of systems (id and names), return a JSON object with exactly these keys:
- intent: "find_info" or "find_procedure" or "find_part"
- systems: array of taxonomy system ids that are relevant (use only ids from the taxonomy list).
- keywords: array of important search terms from the query (normalize: colour->color, tyre->tire if needed).
- contentTypes: array of preferred content types, e.g. ["procedure","generic","tsb"] or ["generic"].
- engine: specific engine if mentioned (e.g. "Z20LET", "Z22SE") or null.
Return only valid JSON, no markdown or explanation.`;

async function planQuery({ apiKey, provider, model, query, selectedEngine, taxonomy }) {
  if (!apiKey || !taxonomy) return null;
  const summary = taxonomySummaryForPlanner(taxonomy);
  const userPrompt = `Taxonomy (system id: names):\n${summary}\n\nUser query: "${query}"${selectedEngine ? ` (selected engine: ${selectedEngine})` : ""}\n\nReturn JSON: intent, systems, keywords, contentTypes, engine.`;
  const providerLower = (provider || "openai").toLowerCase();
  try {
    if (providerLower === "openai") {
      const text = await callOpenAI({
        apiKey,
        model: model || "gpt-4.1-nano-2025-04-14",
        systemPrompt: QUERY_PLANNER_SYSTEM,
        userPrompt,
      });
      return extractJsonFromText(text);
    }
    if (providerLower === "anthropic" || providerLower === "claude") {
      const text = await callAnthropic({
        apiKey,
        model: model || "claude-3-5-sonnet-latest",
        systemPrompt: QUERY_PLANNER_SYSTEM,
        userPrompt,
      });
      return extractJsonFromText(text);
    }
  } catch (_) {}
  return null;
}

function keywordFallbackPlan(query, taxonomy) {
  if (!taxonomy || !Array.isArray(taxonomy.systems)) return { systems: [], keywords: tokenize(query) };
  const queryTokens = tokenize(query);
  const systemIds = new Set();
  for (const sys of taxonomy.systems) {
    const names = (sys.names || []).map((n) => String(n).toLowerCase());
    for (const t of queryTokens) {
      if (names.some((n) => n.includes(t) || t.includes(n))) {
        systemIds.add(sys.id);
        break;
      }
    }
    if (sys.subsystems) {
      for (const sub of sys.subsystems) {
        const subNames = (sub.names || []).map((n) => String(n).toLowerCase());
        for (const t of queryTokens) {
          if (subNames.some((n) => n.includes(t) || t.includes(n))) {
            systemIds.add(sys.id);
            break;
          }
        }
      }
    }
  }
  return { systems: [...systemIds], keywords: queryTokens };
}

function getDocIdsForPlan(state, plan) {
  if (!state.docIdToKnowledgeNode || !plan || !Array.isArray(plan.systems) || plan.systems.length === 0) {
    return null;
  }
  const systemSet = new Set(plan.systems);
  const docIds = new Set();
  for (const [docId, node] of state.docIdToKnowledgeNode) {
    const nodeSystems = node.systemIds || [];
    if (nodeSystems.some((id) => systemSet.has(id))) docIds.add(docId);
  }
  return docIds.size > 0 ? docIds : null;
}

function retrieveContextGraph(state, plan, { query, selectedEngine, limit = 10 }) {
  const docIds = getDocIdsForPlan(state, plan);
  const chunksToScore = docIds
    ? state.chunks.filter((c) => docIds.has(c.docId))
    : state.chunks;
  const queryTokens = plan && plan.keywords && plan.keywords.length ? plan.keywords : tokenize(query);
  const partNosInQuery = extractPartNumbersFromText(query);
  const procedureIntent = detectProcedureIntent(query, queryTokens);

  const scoredChunks = [];
  for (const chunk of chunksToScore) {
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

  const topChunks = selected.map(({ chunk, score }) => ({ ...chunk, score: Number(score.toFixed(3)) }));
  const citationByDocId = new Map();
  for (const chunk of topChunks) {
    const existing = citationByDocId.get(chunk.docId);
    if (!existing || chunk.score > existing.score) {
      citationByDocId.set(chunk.docId, buildCitationFromChunk(chunk, chunk.score));
    }
  }
  const citationByTitle = new Map();
  for (const citation of citationByDocId.values()) {
    const key = (citation.title || "").toLowerCase().trim();
    const existing = citationByTitle.get(key);
    if (!existing || citation.score > existing.score) citationByTitle.set(key, citation);
  }
  const citations = [...citationByTitle.values()];
  const docIdSet = new Set(topChunks.map((c) => c.docId));

  const relatedLinks = state.partLinks.filter((link) => docIdSet.has(link.docId));
  const partsFromLinks = [];
  for (const link of relatedLinks) {
    for (const match of link.epcMatches || []) {
      partsFromLinks.push({ ...match, sourceDocId: link.docId, sourceDocTitle: link.docTitle });
    }
  }

  // Collect referencedPartNumbers from knowledge nodes of matched docs
  const knowledgePartNos = new Set();
  if (state.docIdToKnowledgeNode) {
    for (const docId of docIdSet) {
      const node = state.docIdToKnowledgeNode.get(docId);
      if (node && Array.isArray(node.referencedPartNumbers)) {
        for (const pn of node.referencedPartNumbers) {
          if (pn) knowledgePartNos.add(String(pn).replace(/\s+/g, "").toUpperCase());
        }
      }
    }
  }

  const scoredParts = [];
  for (const part of state.partsIndex) {
    if (selectedEngine && !isUsageCompatible(part.usage, selectedEngine)) continue;
    let score = 0;
    // Boost parts that the knowledge node linked to the matched procedure
    if (knowledgePartNos.size > 0 && part.partNoNormalized && knowledgePartNos.has(part.partNoNormalized)) {
      score += 30;
    }
    if (partNosInQuery.length > 0 && part.partNoNormalized && partNosInQuery.includes(part.partNoNormalized)) score += 25;
    const searchable = [part.description, part.groupName, part.subSectionName, part.mainName, part.partNo, part.katNo, part.usage]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    for (const token of queryTokens) {
      if (searchable.includes(token)) score += 2;
    }
    if (score > 0) scoredParts.push({ part, score });
  }
  scoredParts.sort((a, b) => b.score - a.score);
  const lexicalParts = scoredParts.slice(0, 10).map((e) => ({ ...e.part, score: e.score }));

  const partIdentitySet = new Set();
  const mergedParts = [];
  const ingestPart = (part) => {
    const key = `${part.partNoNormalized || part.partNo}|${part.diagramId}|${part.refNormalized || part.ref || ""}`;
    if (partIdentitySet.has(key)) return;
    partIdentitySet.add(key);
    const diagramUrl =
      part.diagramId && part.groupId ? `/epc/${part.groupId}/diagram/${part.diagramId}` : null;
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
    (state.toolsByDocId.get(docId) || []).forEach((entry) => tools.push(entry));
  }
  const uniqueToolMap = new Map();
  for (const tool of tools) {
    if (!tool.code) continue;
    if (!uniqueToolMap.has(tool.code)) uniqueToolMap.set(tool.code, tool);
  }

  const torqueSpecs = [];
  for (const docId of docIdSet) {
    (state.torqueByDocId.get(docId) || []).forEach((entry) => {
      torqueSpecs.push({
        component: entry.component,
        value: entry.value,
        unit: entry.unit,
        sourcePage: entry.sourcePage,
      });
    });
  }

  const warnings = [];
  if (topChunks.length === 0) warnings.push("No document chunks matched the query in the selected systems.");
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

async function retrieveContextWithGraph(state, opts, llmPayload) {
  const hasGraph = state.taxonomy && state.knowledgeNodes && state.knowledgeNodes.length > 0;
  if (!hasGraph) {
    return retrieveContext(state, opts);
  }

  const apiKey = llmPayload && llmPayload.apiKey ? normalizeWhitespace(String(llmPayload.apiKey)) : "";
  const provider = llmPayload && llmPayload.provider ? String(llmPayload.provider).toLowerCase() : "openai";
  const model = llmPayload && llmPayload.model ? String(llmPayload.model) : null;

  let plan = null;
  if (apiKey) {
    plan = await planQuery({
      apiKey,
      provider,
      model,
      query: opts.query,
      selectedEngine: opts.selectedEngine,
      taxonomy: state.taxonomy,
    });
  }
  if (!plan || !Array.isArray(plan.systems) || plan.systems.length === 0) {
    plan = keywordFallbackPlan(opts.query, state.taxonomy);
  }

  const docIds = getDocIdsForPlan(state, plan);
  if (docIds && docIds.size > 0) {
    return retrieveContextGraph(state, plan, opts);
  }
  return retrieveContext(state, opts);
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

  // Deduplicate citations: first by docId, then collapse engine-variant duplicates by title
  const citationByDocId = new Map();
  for (const chunk of topChunks) {
    const existing = citationByDocId.get(chunk.docId);
    if (!existing || chunk.score > existing.score) {
      citationByDocId.set(chunk.docId, buildCitationFromChunk(chunk, chunk.score));
    }
  }
  // Collapse docs with identical titles (e.g. A26D1C vs AQS315 variants) - keep highest score
  const citationByTitle = new Map();
  for (const citation of citationByDocId.values()) {
    const key = (citation.title || "").toLowerCase().trim();
    const existing = citationByTitle.get(key);
    if (!existing || citation.score > existing.score) {
      citationByTitle.set(key, citation);
    }
  }
  const citations = [...citationByTitle.values()];
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

  // Collect referencedPartNumbers from knowledge nodes of matched docs
  const knowledgePartNos = new Set();
  if (state.docIdToKnowledgeNode) {
    for (const docId of docIdSet) {
      const node = state.docIdToKnowledgeNode.get(docId);
      if (node && Array.isArray(node.referencedPartNumbers)) {
        for (const pn of node.referencedPartNumbers) {
          if (pn) knowledgePartNos.add(String(pn).replace(/\s+/g, "").toUpperCase());
        }
      }
    }
  }

  const scoredParts = [];
  for (const part of state.partsIndex) {
    if (selectedEngine && !isUsageCompatible(part.usage, selectedEngine)) continue;
    let score = 0;
    if (knowledgePartNos.size > 0 && part.partNoNormalized && knowledgePartNos.has(part.partNoNormalized)) {
      score += 30;
    }
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

// ---------------------------------------------------------------------------
// Vision: annotate EPC diagrams with hotspot overlays and extract procedure images
// ---------------------------------------------------------------------------

const OVERLAY_COLORS = [
  "#ef4444", "#3b82f6", "#22c55e", "#f59e0b", "#8b5cf6",
  "#ec4899", "#06b6d4", "#f97316", "#14b8a6", "#6366f1",
];

function escapeXml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Build an SVG overlay with labeled hotspot outlines for the given parts.
 * @param {object} hotspotData  - parsed hotspot JSON (from epc/hotspots/{id}.json)
 * @param {Array}  parts        - array of { ref, description } for relevant parts
 * @param {number} imgW         - image width
 * @param {number} imgH         - image height
 * @returns {string} SVG markup
 */
function buildHotspotSvg(hotspotData, parts, imgW, imgH) {
  const hotspots = Array.isArray(hotspotData.hotspots) ? hotspotData.hotspots : [];
  const refToHotspot = new Map();
  for (const h of hotspots) {
    refToHotspot.set(Number(h.ref), h);
  }

  let svgElements = "";
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const ref = Number(part.ref);
    const color = OVERLAY_COLORS[i % OVERLAY_COLORS.length];
    const h = refToHotspot.get(ref);
    const shortDesc = `${ref}: ${(part.description || "").slice(0, 40)}`;

    if (h && h.type === "rect" && h.bbox) {
      const { x, y, width, height } = h.bbox;
      svgElements += `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${color}" fill-opacity="0.2" stroke="${color}" stroke-width="3"/>`;
      svgElements += `<rect x="${x}" y="${Math.max(0, y - 22)}" width="${Math.min(shortDesc.length * 8 + 8, imgW - x)}" height="22" fill="${color}" fill-opacity="0.85" rx="3"/>`;
      svgElements += `<text x="${x + 4}" y="${Math.max(0, y - 22) + 16}" font-family="Arial,sans-serif" font-size="14" font-weight="bold" fill="white">${escapeXml(shortDesc)}</text>`;
    } else if (h && h.type === "polygon" && Array.isArray(h.points) && h.points.length >= 3) {
      const pts = h.points.map((p) => `${p.x},${p.y}`).join(" ");
      const minX = Math.min(...h.points.map((p) => p.x));
      const minY = Math.min(...h.points.map((p) => p.y));
      svgElements += `<polygon points="${pts}" fill="${color}" fill-opacity="0.2" stroke="${color}" stroke-width="3"/>`;
      svgElements += `<rect x="${minX}" y="${Math.max(0, minY - 22)}" width="${Math.min(shortDesc.length * 8 + 8, imgW - minX)}" height="22" fill="${color}" fill-opacity="0.85" rx="3"/>`;
      svgElements += `<text x="${minX + 4}" y="${Math.max(0, minY - 22) + 16}" font-family="Arial,sans-serif" font-size="14" font-weight="bold" fill="white">${escapeXml(shortDesc)}</text>`;
    }
    // Parts without hotspots get no overlay (handled in the text legend)
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${imgW}" height="${imgH}">${svgElements}</svg>`;
}

/**
 * Annotate a diagram image with hotspot overlays for the given parts.
 * Returns a base64 PNG string, or null on failure.
 */
async function annotateDiagram(dataDir, diagramId, relevantParts) {
  const imgPath = path.join(dataDir, "epc", "diagrams", `${diagramId}.png`);
  const hotspotPath = path.join(dataDir, "epc", "hotspots", `${diagramId}.json`);
  if (!fs.existsSync(imgPath)) return null;

  let hotspotData = { hotspots: [] };
  if (fs.existsSync(hotspotPath)) {
    try { hotspotData = JSON.parse(fs.readFileSync(hotspotPath, "utf8")); } catch (_) {}
  }

  const imgMeta = await sharp(imgPath).metadata();
  const imgW = hotspotData.imageWidth || imgMeta.width || 1240;
  const imgH = hotspotData.imageHeight || imgMeta.height || 1761;

  const svgOverlay = buildHotspotSvg(hotspotData, relevantParts, imgW, imgH);
  const svgBuf = Buffer.from(svgOverlay);

  try {
    const annotated = await sharp(imgPath)
      .composite([{ input: svgBuf, top: 0, left: 0 }])
      .png()
      .toBuffer();
    return annotated.toString("base64");
  } catch (err) {
    console.warn(`[RAG] Failed to annotate diagram ${diagramId}: ${err.message}`);
    return null;
  }
}

/**
 * Render a procedure/content JSON document as structured markdown for the LLM.
 * Reads the original JSON (not the chunks) to preserve substeps, notes, torque, images.
 * Image references use bracket notation [IMG-id] from the catalog.
 * Falls back to concatenated chunk text if the JSON isn't available.
 */
function renderDocumentAsMarkdown(docId, dataDir, imageUrlToId) {
  // Try to load the original content JSON
  const jsonPath = path.join(dataDir, "content", `${docId}.json`);
  if (!fs.existsSync(jsonPath)) return null;

  let doc;
  try { doc = JSON.parse(fs.readFileSync(jsonPath, "utf8")); } catch (_) { return null; }

  const lines = [];
  const title = (doc.title || docId).replace(/\n/g, " ");
  lines.push(`# ${title}`);
  if (doc.type) lines.push(`Type: ${doc.type}`);

  // Warnings
  if (Array.isArray(doc.warnings) && doc.warnings.length > 0) {
    lines.push("\n**Warnings:**");
    for (const w of doc.warnings) lines.push(`- ${w.replace(/\n/g, " ")}`);
  }

  // Build a map: match notes to steps by finding substep text overlap
  const notes = Array.isArray(doc.notes) ? doc.notes : [];
  const notesByStepNum = new Map();
  const unmatchedNotes = [];
  if (Array.isArray(doc.phases)) {
    for (const note of notes) {
      const noteClean = note.replace(/\n/g, " ").trim();
      let matched = false;
      for (const phase of doc.phases) {
        for (const step of phase.steps || []) {
          const stepTexts = [step.text || ""];
          if (Array.isArray(step.substeps)) {
            for (const sub of step.substeps) stepTexts.push(sub.text || "");
          }
          // Match if the note starts with or contains a substep's text
          for (const st of stepTexts) {
            if (st && st.length > 5 && noteClean.toLowerCase().includes(st.toLowerCase().slice(0, 20))) {
              if (!notesByStepNum.has(step.number)) notesByStepNum.set(step.number, []);
              notesByStepNum.get(step.number).push(noteClean);
              matched = true;
              break;
            }
          }
          if (matched) break;
        }
        if (matched) break;
      }
      if (!matched) unmatchedNotes.push(noteClean);
    }
  } else {
    for (const n of notes) unmatchedNotes.push(n.replace(/\n/g, " ").trim());
  }

  // Unmatched notes go in a general section
  if (unmatchedNotes.length > 0) {
    lines.push("\n**Notes:**");
    for (const n of unmatchedNotes) lines.push(`- ${n}`);
  }

  // Torque values table
  if (Array.isArray(doc.torqueValues) && doc.torqueValues.length > 0) {
    lines.push("\n**Torque values:**");
    for (const tv of doc.torqueValues) {
      const step = tv.stepRef ? ` (step ${tv.stepRef})` : "";
      lines.push(`- ${tv.component}: ${tv.value} ${tv.unit || ""}${step}`);
    }
  }

  // Phases (remove, install, etc.)
  if (Array.isArray(doc.phases)) {
    for (const phase of doc.phases) {
      lines.push(`\n## Phase: ${phase.label || phase.phase || "General"}`);
      if (Array.isArray(phase.steps)) {
        for (const step of phase.steps) {
          let stepLine = `${step.number || "-"}. ${step.text || ""}`;
          // Substeps
          if (Array.isArray(step.substeps) && step.substeps.length > 0) {
            for (const sub of step.substeps) {
              stepLine += `\n   ${sub.bullet || "•"} ${sub.text || ""}`;
              if (Array.isArray(sub.substeps)) {
                for (const ss of sub.substeps) {
                  stepLine += `\n     ${ss.bullet || "-"} ${ss.text || ""}`;
                }
              }
            }
          }
          // Image reference
          if (step.image && step.image.src) {
            const imgId = imageUrlToId.get(step.image.src);
            stepLine += imgId ? ` [${imgId}]` : ` [image: ${step.image.src}]`;
          }
          // Inline notes matched to this step (critical: tightening sequences, special instructions)
          const stepNotes = notesByStepNum.get(step.number);
          if (stepNotes) {
            for (const sn of stepNotes) {
              stepLine += `\n   ** NOTE: ${sn}`;
              // If note mentions "sequence shown" and step has an image, emphasize it
              if (/sequence\s+shown/i.test(sn) && step.image && step.image.src) {
                const imgId = imageUrlToId.get(step.image.src);
                if (imgId) stepLine += ` (see ${imgId} for the tightening sequence diagram)`;
              }
            }
          }
          lines.push(stepLine);
        }
      }
    }
  }

  // Glossary, diagnostic, generic content
  if (doc.type === "glossary" && Array.isArray(doc.terms)) {
    for (const t of doc.terms) lines.push(`**${t.term}**: ${t.definition || ""}`);
  }
  if (doc.type === "generic" && doc.html) {
    // For generic docs, fall back to chunk text (HTML is not useful raw)
    return null;
  }

  // Diagrams (CGM wiring diagrams)
  if (Array.isArray(doc.diagrams)) {
    for (const d of doc.diagrams) {
      if (d.src) {
        const imgId = imageUrlToId.get(d.src);
        lines.push(`\nDiagram: ${d.title || ""} ${imgId ? `[${imgId}]` : `[${d.src}]`}`);
      }
    }
  }

  return lines.join("\n");
}

/**
 * Extract all image references from the matched documents for frontend display and catalog.
 * Returns array of { id, type, url, step?, description, diagramId?, cgmHash? }.
 * Types: "epc_diagram", "wiring_diagram", "procedure_photo"
 */
function buildImageCatalog(retrieval, state, dataDir) {
  const entries = [];
  const seen = new Set();
  let idx = 1;

  // 1. EPC exploded-view diagrams from diagram grounding
  const seenDiagrams = new Set();
  for (const g of retrieval.diagramGrounding || []) {
    const dId = g.diagramId;
    if (!dId || seenDiagrams.has(dId)) continue;
    seenDiagrams.add(dId);
    const partsOnDiagram = (retrieval.diagramGrounding || [])
      .filter((p) => p.diagramId === dId)
      .map((p) => p.ref);
    const refRange = partsOnDiagram.length > 0 ? `refs ${partsOnDiagram.join(",")}` : "";
    const desc = `EPC diagram ${g.sheetCode || dId}: ${g.groupName || ""} exploded view (${refRange})`;
    const id = `IMG-${idx++}`;
    entries.push({ id, type: "epc_diagram", url: `/data/epc/diagrams/${dId}.png`, diagramId: dId, description: desc });
  }

  // 2. Wiring/harness diagrams (CGM -> converted PNG) from matched doc chunks
  const chunksByDocId = state && state.chunksByDocId ? state.chunksByDocId : new Map();
  const seenDocIds = new Set();
  for (const chunk of retrieval.topChunks || []) {
    if (seenDocIds.has(chunk.docId)) continue;
    seenDocIds.add(chunk.docId);
    const allChunks = chunksByDocId.get(chunk.docId) || [];
    for (const c of allChunks) {
      const text = c.text || "";
      const cgmRe = /Diagram:\s*\/data\/assets\/([a-f0-9]+)\.cgm/gi;
      let match;
      while ((match = cgmRe.exec(text)) !== null) {
        const hash = match[1];
        const key = `cgm:${hash}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const title = c.title || chunk.title || chunk.docId;
        const desc = `Wiring diagram: ${title}`;
        const id = `IMG-${idx++}`;
        entries.push({ id, type: "wiring_diagram", url: `/data/assets/converted/${hash}.png`, cgmHash: hash, description: desc });
      }
    }
  }

  // 3. Procedure step photos -- prefer original JSON (has substep context) over chunk regex
  seenDocIds.clear();
  for (const chunk of retrieval.topChunks || []) {
    if (seenDocIds.has(chunk.docId)) continue;
    seenDocIds.add(chunk.docId);
    const jsonPath = path.join(dataDir, "content", `${chunk.docId}.json`);
    let usedJson = false;
    if (dataDir && fs.existsSync(jsonPath)) {
      try {
        const doc = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
        if (Array.isArray(doc.phases)) {
          // Build step-to-notes map for enriching catalog descriptions
          const docNotes = Array.isArray(doc.notes) ? doc.notes : [];
          const stepNoteMap = new Map();
          for (const note of docNotes) {
            const noteClean = note.replace(/\n/g, " ").trim();
            for (const phase of doc.phases) {
              for (const step of phase.steps || []) {
                const texts = [step.text || ""];
                if (Array.isArray(step.substeps)) step.substeps.forEach((s) => texts.push(s.text || ""));
                for (const t of texts) {
                  if (t && t.length > 5 && noteClean.toLowerCase().includes(t.toLowerCase().slice(0, 20))) {
                    if (!stepNoteMap.has(step.number)) stepNoteMap.set(step.number, []);
                    stepNoteMap.get(step.number).push(noteClean);
                    break;
                  }
                }
              }
            }
          }

          for (const phase of doc.phases) {
            for (const step of phase.steps || []) {
              if (step.image && step.image.src) {
                const url = step.image.src;
                if (seen.has(url)) continue;
                seen.add(url);
                const stepNum = step.number || null;
                let desc = step.text || "";
                if (Array.isArray(step.substeps) && step.substeps.length > 0) {
                  desc += " (" + step.substeps.map((s) => s.text).join("; ") + ")";
                }
                // Enrich description with note content (e.g. tightening sequence instructions)
                const stepNotes = stepNoteMap.get(step.number);
                if (stepNotes) {
                  for (const sn of stepNotes) {
                    if (/sequence|order|pattern/i.test(sn)) {
                      desc += ` -- NOTE: ${sn}`;
                    }
                  }
                }
                const id = `IMG-${idx++}`;
                entries.push({ id, type: "procedure_photo", url, step: stepNum, description: `Procedure step ${stepNum || "?"}: ${desc}`.trim() });
              }
            }
          }
          usedJson = true;
        }
      } catch (_) {}
    }
    // Fallback to chunk text regex if JSON not available
    if (!usedJson) {
      const allChunks = chunksByDocId.get(chunk.docId) || [];
      const imageRe = /(?:(\d+)\.\s+)?([^.]*?)Image:\s*(\/data\/assets\/images\/([a-f0-9]+\.jpg))/gi;
      for (const c of allChunks) {
        let match;
        while ((match = imageRe.exec(c.text || "")) !== null) {
          const url = match[3];
          if (seen.has(url)) continue;
          seen.add(url);
          const id = `IMG-${idx++}`;
          const stepNum = match[1] || null;
          const desc = (match[2] || "").replace(/[-–—]+\s*$/, "").trim();
          entries.push({ id, type: "procedure_photo", url, step: stepNum, description: `Procedure step ${stepNum || "?"}: ${desc}`.trim() });
        }
      }
    }
  }

  const catalogText = entries.length > 0
    ? "Available images (request by ID if any would help answer the query):\n" +
      entries.map((e) => `[${e.id}] ${e.description}`).join("\n")
    : "";

  return { catalogText, entries };
}

/**
 * Build the Round 2 text-only prompt: full documents + parts + torque + image catalog.
 */
function buildTextPrompt({ query, retrieval, selectedEngine, state, catalog, dataDir }) {
  const schemaInstructions = `Return strict JSON: {"answer":string,"procedureSummary":string,"requiredParts":[{"partNo":string,"description":string,"qty":string}],"requiredTools":[{"code":string,"name":string}],"torqueSpecs":[{"component":string,"value":string,"unit":string}],"warnings":[string],"requestedImages":[string]}
requestedImages: array of image IDs from the catalog that you MUST request if your answer references them or if the text says "sequence shown", "as shown", "see diagram", or similar. ALWAYS request the image when the text says something is "shown" in it -- you cannot describe what is shown without seeing it. Use empty array [] ONLY if no images are referenced in your answer.`;

  const systemPrompt =
    "You are a workshop assistant for Opel/Vauxhall TIS and EPC data. " +
    "You are given complete procedure documents. Extract your answer ONLY from the provided text. " +
    "IMPORTANT: Each document begins with 'Torque highlights:' listing every torque value for that procedure as 'step description: N Nm'. " +
    "These ARE the official torque values -- always include them in your answer and in the torqueSpecs array. " +
    "Procedure steps also contain Nm values inline. " +
    "Do not say torque values are 'not provided' if they appear anywhere in the document text. " +
    "If evidence is genuinely missing, say so in warnings. Be thorough but concise. " +
    "You also have access to an image catalog. IMPORTANT: If the document text references something 'shown' in an image " +
    "(e.g. 'in sequence shown', 'as illustrated', 'see diagram'), you MUST request that image in requestedImages -- " +
    "you cannot describe what the image shows without seeing it. Do NOT say 'in the sequence shown' without requesting " +
    "and reading the image first. List image IDs in requestedImages and you will see them in a follow-up round.";

  // Build image URL -> catalog ID map for bracket references
  const imageUrlToId = new Map();
  for (const entry of catalog.entries) {
    if (entry.url) imageUrlToId.set(entry.url, entry.id);
  }

  // Render COMPLETE documents as structured markdown from original JSON.
  // Falls back to chunk text if JSON is unavailable (generic/glossary docs).
  const chunksByDocId = state && state.chunksByDocId ? state.chunksByDocId : new Map();
  const docIds = [];
  const seenDocIds = new Set();
  for (const chunk of retrieval.topChunks) {
    if (!seenDocIds.has(chunk.docId)) {
      seenDocIds.add(chunk.docId);
      docIds.push(chunk.docId);
    }
  }
  const topDocIds = docIds.slice(0, 5);
  const contextLines = [];
  for (const docId of topDocIds) {
    const md = renderDocumentAsMarkdown(docId, dataDir, imageUrlToId);
    if (md) {
      contextLines.push(md);
    } else {
      // Fallback: concatenate chunk text
      const allChunks = chunksByDocId.get(docId) || [];
      const title = allChunks.length > 0 ? allChunks[0].title : docId;
      const fullText = allChunks.map((c) => c.text || "").join("\n");
      contextLines.push(`--- ${title} ---\n${fullText}`);
    }
  }

  const allParts = retrieval.matchedParts.slice(0, 12);
  const partsLegend = allParts.map((p) => {
    const ref = p.ref || p.refNormalized || "?";
    const desc = p.description || "";
    const qty = p.qty ? ` (qty: ${p.qty})` : "";
    return `Ref ${ref}: ${p.partNo || "?"} - ${desc}${qty}`;
  });
  const tools = retrieval.tools.slice(0, 12).map((t) => `${t.code || ""} ${t.name || ""}`);
  const torque = retrieval.torqueSpecs.slice(0, 20).map((t) => `${t.component}: ${t.value} ${t.unit || ""}`);

  const userPrompt =
    `Query: ${query}${selectedEngine ? " (engine: " + selectedEngine + ")" : ""}\n\n` +
    `Documents:\n${contextLines.join("\n\n")}\n\n` +
    (partsLegend.length ? `Parts (ref numbers match diagram labels):\n${partsLegend.join("\n")}\n\n` : "") +
    (tools.length ? `Tools: ${tools.join("; ")}\n` : "") +
    (torque.length ? `Torque: ${torque.join("; ")}\n` : "") +
    (catalog.catalogText ? `\n${catalog.catalogText}\n\n` : "") +
    `\n${schemaInstructions}`;

  return { systemPrompt, userPrompt };
}

/**
 * Build the Round 3 vision prompt: send previous answer + only the requested images.
 */
async function buildVisionPrompt(previousAnswer, requestedEntries, retrieval, dataDir) {
  const systemPrompt =
    "You are a workshop assistant refining your previous answer using images. " +
    "You previously answered based on text only. Now you can see the images you requested. " +
    "Update your answer if the images reveal additional detail: tightening sequences, assembly order, " +
    "spatial part layout, wiring connections, or anything the text alone could not convey. " +
    "Return the same JSON schema as before with any corrections or additions.";

  const schemaInstructions = `Return strict JSON: {"answer":string,"procedureSummary":string,"requiredParts":[{"partNo":string,"description":string,"qty":string}],"requiredTools":[{"code":string,"name":string}],"torqueSpecs":[{"component":string,"value":string,"unit":string}],"warnings":[string]}`;

  const userPrompt =
    `Your previous answer (text-only):\n${typeof previousAnswer === "string" ? previousAnswer : JSON.stringify(previousAnswer)}\n\n` +
    `You are now shown ${requestedEntries.length} image(s) you requested. ` +
    `Review them and refine your answer.\n\n${schemaInstructions}`;

  // Load only the requested images
  const images = [];
  for (const entry of requestedEntries) {
    if (entry.type === "epc_diagram" && entry.diagramId) {
      const partsOnDiagram = (retrieval.diagramGrounding || [])
        .filter((p) => p.diagramId === entry.diagramId)
        .map((p) => ({ ref: p.ref, description: p.description }));
      const base64 = await annotateDiagram(dataDir, entry.diagramId, partsOnDiagram);
      if (base64) images.push({ base64, mediaType: "image/png" });
    } else if (entry.type === "wiring_diagram" && entry.cgmHash) {
      const imgPath = path.join(dataDir, "assets", "converted", `${entry.cgmHash}.png`);
      if (fs.existsSync(imgPath)) {
        try {
          const buf = fs.readFileSync(imgPath);
          images.push({ base64: buf.toString("base64"), mediaType: "image/png" });
        } catch (_) {}
      }
    } else if (entry.type === "procedure_photo" && entry.url) {
      const relPath = entry.url.replace(/^\/data\//, "");
      const imgPath = path.join(dataDir, relPath);
      if (fs.existsSync(imgPath)) {
        try {
          const buf = fs.readFileSync(imgPath);
          const ext = imgPath.endsWith(".png") ? "image/png" : "image/jpeg";
          images.push({ base64: buf.toString("base64"), mediaType: ext });
        } catch (_) {}
      }
    }
  }

  return { systemPrompt, userPrompt, images };
}

function createServer({ dataDir = DEFAULT_DATA_DIR, ragDir = DEFAULT_RAG_DIR, port = DEFAULT_PORT, lazyLoad = false } = {}) {
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
  let loading = false;

  const loadState = () => {
    const chunksData = readJson(path.join(ragDir, "procedure-chunks.json"), { chunks: [] });
    const docsData = readJson(path.join(ragDir, "doc-metadata.json"), { documents: [] });
    const partsData = readJson(path.join(ragDir, "parts-index.json"), { items: [] });
    const linksData = readJson(path.join(ragDir, "part-procedure-links.json"), { links: [] });
    const groundingData = readJson(path.join(ragDir, "diagram-grounding.json"), { groundings: [] });
    const referencesTools = readJson(path.join(dataDir, "references", "tools.json"), { tools: [] });
    const referencesTorque = readJson(path.join(dataDir, "references", "torque-values.json"), { values: [] });
    const taxonomyData = readJson(path.join(ragDir, "taxonomy.json"), null);
    const knowledgeNodesData = readJson(path.join(ragDir, "knowledge-nodes.json"), null);

    state = buildRetrieverState({
      chunksData,
      docsData,
      partsData,
      linksData,
      groundingData,
      referencesTools,
      referencesTorque,
      taxonomyData,
      knowledgeNodesData,
    });
  };

  const ensureStateLoaded = (res, retryAfter = 20) => {
    if (state) return true;
    if (lazyLoad && !loading) {
      loading = true;
      setImmediate(() => {
        try {
          loadState();
        } finally {
          loading = false;
        }
      });
      res.status(503).json({
        ok: false,
        error: "RAG indexes are loading (serverless cold start). Please retry in a few seconds.",
        retryAfter,
      });
      return false;
    }
    if (lazyLoad && loading) {
      res.status(503).json({
        ok: false,
        error: "RAG indexes are still loading. Please retry shortly.",
        retryAfter: 10,
      });
      return false;
    }
    res.status(503).json({
      ok: false,
      error: "RAG indexes are not loaded. Run `npm run build-rag-index` then restart `npm run rag-server`.",
    });
    return false;
  };

  if (!lazyLoad) loadState();

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
        taxonomy: state && state.taxonomy ? state.taxonomy.systems.length : 0,
        knowledgeNodes: state && state.knowledgeNodes ? state.knowledgeNodes.length : 0,
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

  app.post("/api/retrieve", async (req, res) => {
    const query = normalizeWhitespace(req.body && req.body.query ? String(req.body.query) : "");
    const selectedEngine = req.body && req.body.selectedEngine ? String(req.body.selectedEngine) : null;
    const limit = req.body && Number.isFinite(req.body.limit) ? Number(req.body.limit) : 10;
    const llmPayload = req.body && typeof req.body.llm === "object" && req.body.llm ? req.body.llm : null;
    if (!query) {
      return res.status(400).json({ ok: false, error: "query is required" });
    }
    if (!ensureStateLoaded(res)) return;

    try {
      const retrieval = await retrieveContextWithGraph(state, {
        query,
        selectedEngine,
        limit: Math.max(1, Math.min(limit, 25)),
      }, llmPayload || {});
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
      const conversationHistory = Array.isArray(req.body.history) ? req.body.history : [];
      if (!query) {
        return res.status(400).json({ ok: false, error: "query is required" });
      }
      if (!ensureStateLoaded(res)) return;

      const t0 = Date.now();
      const retrieval = await retrieveContextWithGraph(state, {
        query,
        selectedEngine,
        limit: 12,
      }, llmPayload || {});
      const tRetrieval = Date.now() - t0;

      const fallbackAnswer = buildFallbackAnswer({
        query,
        retrieval,
        selectedEngine,
      });

      let providerUsed = null;
      let modelUsed = null;
      let llmJson = null;
      let providerWarning = null;
      let tPrompts = 0;
      let tLlmRound2 = 0;
      let tLlmRound3 = 0;
      let imageCount = 0;
      let round3Triggered = false;

      if (provider) {
        const providerLower = provider.toLowerCase();
        const apiKey = requestedApiKey;
        // Per-round model defaults: fast model for text reasoning, stronger model for vision
        const OPENAI_DEFAULTS = { planner: "gpt-4.1-nano-2025-04-14", text: "gpt-4.1-nano-2025-04-14", vision: "gpt-4.1-mini-2025-04-14" };
        const ANTHROPIC_DEFAULTS = { planner: "claude-3-5-haiku-latest", text: "claude-3-5-haiku-latest", vision: "claude-3-5-sonnet-latest" };
        const defaults = providerLower === "openai" ? OPENAI_DEFAULTS : ANTHROPIC_DEFAULTS;
        const textModel = requestedModel || defaults.text;
        const visionModel = defaults.vision;
        const callLlm = providerLower === "openai" ? callOpenAI : (providerLower === "anthropic" || providerLower === "claude") ? callAnthropic : null;

        if (!callLlm) {
          providerWarning = `Unsupported provider "${provider}". Returned retrieval-based fallback.`;
        } else if (!apiKey) {
          providerWarning = `${provider} provider requested but no API key was provided in chat settings; returned retrieval-based fallback.`;
        } else {
          // --- Round 2: Text-only reasoning with image catalog ---
          const t1 = Date.now();
          const catalog = buildImageCatalog(retrieval, state, dataDir);
          const textPrompt = buildTextPrompt({ query, retrieval, selectedEngine, state, catalog, dataDir });
          tPrompts = Date.now() - t1;

          const t2 = Date.now();
          try {
            const round2Text = await callLlm({
              apiKey, model: textModel,
              systemPrompt: textPrompt.systemPrompt,
              userPrompt: textPrompt.userPrompt,
              history: conversationHistory,
            });
            tLlmRound2 = Date.now() - t2;
            llmJson = extractJsonFromText(round2Text);
            providerUsed = providerLower === "openai" ? "openai" : "anthropic";
            modelUsed = textModel;

            // --- Round 3: Vision refinement (conditional, uses stronger model) ---
            const requested = llmJson && Array.isArray(llmJson.requestedImages) ? llmJson.requestedImages : [];
            if (requested.length > 0 && catalog.entries.length > 0) {
              const entryMap = new Map(catalog.entries.map((e) => [e.id, e]));
              const selectedEntries = requested.map((id) => entryMap.get(id)).filter(Boolean).slice(0, 4);
              if (selectedEntries.length > 0) {
                round3Triggered = true;
                imageCount = selectedEntries.length;
                console.log(`[RAG] Round 3: model requested ${requested.length} images, loading ${selectedEntries.length}: ${selectedEntries.map((e) => e.id).join(", ")} (using ${visionModel})`);
                const t3build = Date.now();
                const visionPrompt = await buildVisionPrompt(llmJson, selectedEntries, retrieval, dataDir);
                const tVisionBuild = Date.now() - t3build;
                const t3 = Date.now();
                try {
                  const round3Text = await callLlm({
                    apiKey, model: visionModel,
                    systemPrompt: visionPrompt.systemPrompt,
                    userPrompt: visionPrompt.userPrompt,
                    images: visionPrompt.images,
                    history: conversationHistory,
                  });
                  tLlmRound3 = Date.now() - t3;
                  const refined = extractJsonFromText(round3Text);
                  if (refined && typeof refined === "object") {
                    llmJson = refined;
                    modelUsed = `${textModel} + ${visionModel}`;
                  }
                } catch (err) {
                  tLlmRound3 = Date.now() - t3;
                  console.warn(`[RAG] Round 3 vision failed: ${err.message}`);
                  // Keep Round 2 answer
                }
              }
            }
          } catch (error) {
            tLlmRound2 = Date.now() - t2;
            providerWarning = `${provider} request failed; returned retrieval-based fallback.`;
            console.warn(`[RAG] Chat failure: ${error.message}`);
          }
        }
      }

      const responsePayload = llmJson && typeof llmJson === "object" ? llmJson : fallbackAnswer;
      if (!Array.isArray(responsePayload.citations) || responsePayload.citations.length === 0) {
        responsePayload.citations = retrieval.citations;
      }
      // Final dedup of citations: collapse engine-variant duplicates (strip -A26D1C/-AQS315 suffixes)
      if (Array.isArray(responsePayload.citations)) {
        const seen = new Map();
        responsePayload.citations = responsePayload.citations.filter((c) => {
          const raw = (c.title || c.docId || "").toLowerCase().trim();
          const key = raw.replace(/-(a26d1c|aqs315)$/i, "");
          if (seen.has(key)) return false;
          seen.set(key, true);
          return true;
        });
      }
      if (!Array.isArray(responsePayload.diagramGrounding) || responsePayload.diagramGrounding.length === 0) {
        responsePayload.diagramGrounding = retrieval.diagramGrounding;
      }
      // Include all image URLs from matched documents for frontend display
      const frontendCatalog = buildImageCatalog(retrieval, state, dataDir);
      responsePayload.procedureImages = frontendCatalog.entries.map((e) => ({
        url: e.url,
        step: e.step || null,
        description: e.description || null,
        type: e.type,
      }));
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

      const tTotal = Date.now() - t0;
      const timing = { retrievalMs: tRetrieval, promptBuildMs: tPrompts, round2Ms: tLlmRound2, round3Ms: tLlmRound3, totalMs: tTotal, imageCount, round3Triggered };
      console.log(`[RAG] Chat timing: retrieval=${tRetrieval}ms, round2=${tLlmRound2}ms (${modelUsed || "none"}), round3=${tLlmRound3}ms (${round3Triggered ? imageCount + " imgs" : "skipped"}), total=${tTotal}ms`);

      return res.json({
        ok: true,
        providerUsed,
        modelUsed,
        timing,
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

