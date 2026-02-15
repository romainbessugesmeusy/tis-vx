# Chat / RAG System

Complete reference for the workshop chat assistant built over TIS service documentation and EPC parts data. Covers architecture, all components, how to run, and what's left to do.

## Architecture overview

The chat uses a **3-round LLM flow** with per-round model selection:

```
User query
    │
    ▼
┌──────────────────────────────────────────────────────────────┐
│  /api/chat  (rag-server.js)                                  │
│                                                              │
│  Round 1: Query planner (fast nano model)                    │
│     ├─ LLM maps query → { systems, keywords }               │
│     ├─ OR keyword fallback (match taxonomy names)            │
│     └─ OR plain lexical retrieval (no taxonomy)              │
│                                                              │
│  Retrieval: graph filter + chunk scoring + parts matching    │
│     └─ knowledge-node part boost (+30 for linked parts)      │
│                                                              │
│  Round 2: Text reasoning (fast nano model)                   │
│     ├─ Full procedure markdown (from original JSON)          │
│     ├─ Parts legend + torque values                          │
│     ├─ Image catalog (numbered list of available images)     │
│     └─ Returns: answer JSON + requestedImages[]              │
│                                                              │
│  Round 3: Vision refinement (stronger mini model, optional)  │
│     ├─ Only triggered if model requested images              │
│     ├─ Loads only the requested images (1-4)                 │
│     ├─ Annotated EPC diagrams (sharp SVG overlay)            │
│     ├─ Wiring diagrams (CGM→PNG, 4K)                        │
│     ├─ Procedure step photos (JPG)                           │
│     └─ Returns: refined answer JSON                          │
│                                                              │
│  Response: answer + parts + tools + torque + citations       │
│     + diagramGrounding + procedureImages (all types)         │
└──────────────────────────────────────────────────────────────┘
    │
    ▼
ChatPanel.jsx (floating React panel with conversation history)
```

### Per-round model defaults

| Round | Task | OpenAI default | Anthropic default |
|-------|------|----------------|-------------------|
| 1 (planner) | Map query to taxonomy | gpt-4.1-nano | claude-3-5-haiku |
| 2 (text) | Read docs, extract torque, build answer | gpt-4.1-nano | claude-3-5-haiku |
| 3 (vision) | Read diagrams, tightening sequences | gpt-4.1-mini | claude-3-5-sonnet |

The user's `llm.model` setting overrides the Round 2 text model. Round 3 always uses the stronger vision model for that provider. Defaults are in `OPENAI_DEFAULTS` / `ANTHROPIC_DEFAULTS` in the `/api/chat` handler.

## Files and their roles

| File | Lines | Purpose |
|------|-------|---------|
| `rag-server.js` | ~1760 | Express API: 3-round chat, retrieval, vision, graph traversal, planner |
| `build-rag-index.js` | ~1015 | Offline: chunks docs, flattens EPC parts, links parts to procedures, builds diagram grounding |
| `build-knowledge-graph.js` | ~495 | Offline: seeds taxonomy, LLM enrichment with ALL EPC parts for cross-system matching |
| `profile-rag-queries.js` | ~81 | Dev tool: runs test queries against `/api/retrieve` and reports timing + quality |
| `viewer/src/components/ChatPanel.jsx` | ~579 | React chat UI: settings, conversations, answer + image rendering |
| `viewer/netlify/functions/rag-server.js` | — | Netlify serverless copy (no vision, no sharp, no knowledge graph) |

## Generated data files (`viewer/public/data/rag/`)

| File | Records | Source |
|------|---------|--------|
| `procedure-chunks.json` | 3997 chunks | `build-rag-index.js` — text chunks from 1771 TIS documents |
| `doc-metadata.json` | 1771 docs | `build-rag-index.js` — title, contentType, engines, treePaths per doc |
| `parts-index.json` | 3018 parts | `build-rag-index.js` — flattened EPC parts with group/subsection/diagram info |
| `part-procedure-links.json` | 6 links | `build-rag-index.js` — TIS docs that mention EPC part numbers |
| `diagram-grounding.json` | 3018 entries | `build-rag-index.js` — per-part diagram + hotspot geometry for visual grounding |
| `index-manifest.json` | — | `build-rag-index.js` — build metadata and stats |
| `taxonomy.json` | 15 systems | `build-knowledge-graph.js` — EPC groups (A-Q) mapped to TIS tree roots |
| `knowledge-nodes.json` | 1771 nodes | `build-knowledge-graph.js --enrich` — LLM-annotated documents with part number cross-references |

## How to run

### Build indexes (one-time or when source data changes)

```bash
# 1. Build retrieval indexes (chunks, parts, grounding)
node build-rag-index.js

# 2. Build taxonomy (always)
node build-knowledge-graph.js

# 3. LLM enrichment (requires API key)
#    --concurrency 100 for ~10 min total
#    --model defaults to gpt-4o-mini; gpt-5-nano is cheapest
#    --limit N to test with fewer docs; --dry-run to skip API calls
OPENAI_API_KEY=sk-... node build-knowledge-graph.js --enrich --model gpt-5-nano-2025-08-07 --concurrency 100
```

### Start servers

```bash
# Terminal 1: RAG API server (port 3002)
node rag-server.js

# Terminal 2: Viewer dev server (port 5173)
cd viewer && npm run dev
```

### Reload indexes without restarting

```bash
curl -X POST http://localhost:3002/api/reload-indexes
```

### Profile retrieval quality

```bash
node profile-rag-queries.js
```

## API endpoints

All endpoints on `http://localhost:3002`.

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/health` | Server status + index counts (includes taxonomy, knowledgeNodes) |
| POST | `/api/reload-indexes` | Hot-reload all JSON indexes from disk |
| POST | `/api/retrieve` | Retrieval only (no LLM). Body: `{ query, selectedEngine?, limit?, llm? }` |
| POST | `/api/chat` | Full 3-round chat. Body: `{ query, selectedEngine?, llm?, history? }` |
| POST | `/api/locate-part` | Find part in diagram grounding. Body: `{ partNo?, diagramId?, ref? }` |

### Chat request shape

```json
{
  "query": "what is the torque and tightening order for the exhaust manifold nuts",
  "selectedEngine": "Z20LET",
  "history": [
    { "role": "user", "text": "previous question" },
    { "role": "assistant", "text": "previous answer" }
  ],
  "llm": {
    "provider": "openai",
    "apiKey": "sk-..."
  }
}
```

The `llm.model` field is optional -- overrides the Round 2 text model only. Round 3 vision model is always the provider's stronger model.

### Chat response shape

```json
{
  "ok": true,
  "providerUsed": "openai",
  "modelUsed": "gpt-4.1-nano-2025-04-14 + gpt-4.1-mini-2025-04-14",
  "timing": {
    "retrievalMs": 1431,
    "promptBuildMs": 5,
    "round2Ms": 2623,
    "round3Ms": 4885,
    "totalMs": 8948,
    "imageCount": 1,
    "round3Triggered": true
  },
  "response": {
    "answer": "...",
    "procedureSummary": "...",
    "requiredParts": [{ "partNo": "90424073", "description": "NUT,M8,EXHAUST MANIFOLD", "qty": "10" }],
    "requiredTools": [{ "code": "KM-...", "name": "..." }],
    "torqueSpecs": [{ "component": "Exhaust manifold nuts", "value": "8", "unit": "Nm" }],
    "warnings": [],
    "citations": [{ "type": "doc", "docId": "...", "title": "...", "url": "/doc/...", "score": 14 }],
    "diagramGrounding": [{ "partNo": "...", "diagramId": "...", "diagramUrl": "/epc/G/diagram/..." }],
    "procedureImages": [{ "url": "/data/assets/images/55ad4b9efdcb.jpg", "step": "35", "description": "...", "type": "procedure_photo" }]
  }
}
```

## Retrieval pipeline

### Three retrieval paths

1. **Graph retrieval** (best quality, requires taxonomy + knowledge-nodes + LLM key): Query planner maps query to taxonomy systems, graph filter narrows to matching docs, chunk scoring with planner keywords.
2. **Keyword fallback** (no LLM key, taxonomy present): Tokenizes query, matches against taxonomy names, uses graph retrieval with matched systems.
3. **Lexical retrieval** (baseline): Scores all chunks by token overlap. No synonym expansion -- the LLM planner handles vocabulary normalization.

### Knowledge-node part number boost

When retrieval identifies documents, their knowledge-node `referencedPartNumbers` are used to boost EPC parts scoring by +30. This ensures the correct EPC diagram is grounded (e.g. the exhaust manifold diagram from group G, not the induction manifold from group G6).

## Knowledge graph

### Taxonomy (`taxonomy.json`)

Seeded deterministically from EPC groups and TIS tree roots. 15 systems, each with subsystems from EPC subSections. No LLM needed.

### Knowledge nodes (`knowledge-nodes.json`)

LLM-enriched. Each node = one TIS document annotated with:

- `systemIds` / `subsystemIds`: taxonomy links (e.g. `"fuel_and_exhaust"`, `"exhaust_manifold"`)
- `components`: specific component names mentioned
- `procedures`: action types (remove, install, inspect, bleed, torque)
- `tools`, `torqueRefs`, `crossRefs`: extracted references
- `referencedPartNumbers`: EPC part numbers matched by the LLM from the full parts catalog
- `referencedProcedureIds`: cross-referenced procedure names/slugs

### Enrichment pipeline (`build-knowledge-graph.js --enrich`)

- Sends each document's **full text** (all chunks concatenated, not truncated) to the LLM
- Includes the **complete taxonomy with subsystem IDs** so the LLM uses valid IDs
- Includes **ALL EPC parts from all 15 systems** (~34K tokens) so the LLM can match component names to part numbers across system boundaries (e.g. exhaust manifold procedure under "J Engine" matching parts in EPC group G "Fuel and exhaust")
- Parallelized with `--concurrency N` (default 20, tested up to 100). Workers stagger launch by 50ms to avoid rate limit bursts
- 1771 docs at concurrency 100: ~10 minutes, ~$0.15 with gpt-5-nano

## 3-round chat flow

### Round 1: Query planner

Same as retrieval. Uses the fast nano model. Returns `{ systems, keywords }` for graph filtering. Falls back to keyword matching if no API key.

### Round 2: Text-only reasoning with image catalog

Sends the LLM:

- **Full procedure markdown** rendered from the original content JSON (not chunks). Preserves substeps, notes, torque values, warnings, and image bracket references like `[IMG-5]`
- **Parts legend** with EPC ref numbers
- **Torque values** from structured references
- **Image catalog**: numbered list of all available images from 3 sources:

```
Available images (request by ID if any would help answer the query):
[IMG-1] EPC diagram G7: Fuel and exhaust exploded view (refs 1,2,3,4,5)
[IMG-2] Wiring diagram: Anti-Lock Brake System - circuit diagram
[IMG-30] Procedure step 35: Install exhaust manifold (Install new gasket; Install 10x new nut) -- NOTE: Tighten 10x nut 8 Nm in sequence shown
```

The model answers the query from text and outputs `requestedImages: ["IMG-30"]` when it needs to see an image. The system prompt forces the model to request images when the text says "sequence shown", "as illustrated", or similar.

### Round 3: Vision refinement (conditional)

Only triggered if `requestedImages` is non-empty. Uses the stronger vision model (gpt-4.1-mini for OpenAI, claude-3-5-sonnet for Anthropic). Sends:

- The model's Round 2 answer as context
- Only the requested images (1-4), loaded on demand
- A prompt asking it to refine the answer using the images

### Three image types

| Type | Count | Source path | How loaded |
|------|-------|------------|------------|
| EPC exploded-view | ~150 | `epc/diagrams/{id}.png` | `annotateDiagram()` -- sharp SVG overlay with hotspot labels |
| Wiring/harness (CGM) | ~67 | `assets/converted/{hash}.png` | Read directly (4K PNG, no annotation needed) |
| Procedure step photo | ~988 | `assets/images/{hash}.jpg` | Read directly |

### Procedure markdown rendering (`renderDocumentAsMarkdown`)

Instead of sending raw chunk text, the server reads the original content JSON (`viewer/public/data/content/{docId}.json`) and renders it as structured markdown:

- Phases with numbered steps and substeps
- Notes matched to their corresponding steps (e.g. "Tighten 10x nut 8 Nm in sequence shown" linked to step 35)
- Image bracket references `[IMG-X]` with explicit hints when notes say "sequence shown"
- Torque values with step references
- Warnings section
- Falls back to chunk text concatenation for generic/glossary docs without JSON

This preserves critical information that chunking flattens (substeps, tightening sequence notes, step-to-image associations).

## Conversation history

The frontend sends prior messages as `history` in each request. Both `callOpenAI` and `callAnthropic` prepend history as prior turns before the current user message, giving the LLM full conversation context for follow-up questions.

## Chat UI (`ChatPanel.jsx`)

- Floating panel, toggled by button in bottom-right
- **Settings**: provider (retrieval-only / OpenAI / Anthropic), API key, model. Persisted in `localStorage` under `tis.chat.settings.v1`
- **Conversations**: persisted in `localStorage` under `tis.chat.history.v1`. List view with title, timestamp, message count. Auto-saved after each response.
- **Answer rendering**: answer text, procedure summary, parts list, tools, torque specs, procedure images (all 3 types with captions), warnings, citations (linked to doc viewer), diagram grounding (linked to EPC browser)
- Vite proxy: `viewer/vite.config.js` forwards `/api` to `http://localhost:3002`

## Netlify serverless

`viewer/netlify/functions/rag-server.js` is a separate copy adapted for Netlify Functions. Does NOT have: sharp, vision grounding, knowledge graph, 3-round flow, conversation history. Provides same API shape with lexical-only retrieval and single-round text-only LLM calls.

## Issues and fixes log

| Issue | Fix |
|-------|-----|
| 500 on `/api/chat` | Fallback answer + warning instead of throwing |
| Black-on-black chat text | Explicit color tokens in CSS |
| OpenAI `temperature: 0.2` rejected | Removed hardcoded temperature from `callOpenAI` |
| Invalid JSON body crash | Body parse error middleware returning HTTP 400 |
| Port 3002 `EADDRINUSE` | Kill stale `node rag-server.js` before restart |
| Enrichment too slow (sequential) | Parallelized with worker pool + 50ms stagger |
| Enrichment empty arrays | Was sending first 1500 chars; now sends full document text |
| Subsystem IDs orphaned | Taxonomy summary now includes all subsystem IDs with names |
| Wrong EPC diagram grounded | Enrichment now includes ALL EPC parts (not just treePath group); retrieval boosts knowledge-node parts by +30 |
| LLM says "torque not provided" when it is | System prompt explicitly instructs about "Torque highlights" format |
| LLM ignores tightening sequence image | System prompt forces image request when text says "sequence shown"; notes linked to step images in markdown |
| Round 3 forgets original question | Per-round model selection: nano for text, mini for vision |

## What remains to do

### High priority

- **Improve Round 3 vision quality**: gpt-4.1-mini can see the tightening diagram but doesn't always extract the actual sequence numbers (5,3,1,8,10 / 6,4,2,7,9). May need gpt-4o or a specialized prompt for reading numbered labels from technical drawings.
- **Netlify parity**: The serverless copy is significantly behind. Either sync it or accept it as retrieval-only.
- **Re-enrich after EPC fix**: The latest enrichment run should be redone with the "all EPC parts" prompt to get proper `referencedPartNumbers` across system boundaries.

### Medium priority

- **Procedure-to-procedure graph traversal**: Knowledge nodes have `referencedProcedureIds` and `crossRefs` but these aren't used in retrieval yet. Could surface related procedures (e.g. "Brake System, Bleed" when asking about brake caliper replacement).
- **Image pre-analysis**: For critical images like tightening sequences, pre-extract the sequence numbers during the build pipeline (using a vision model offline) and store them in the knowledge nodes. This avoids relying on runtime vision quality.
- **Cost tracking**: Add token/cost logging per round for monitoring spend.

### Lower priority

- **Session-only key mode**: Option to not persist API key to localStorage.
- **Anthropic testing**: 3-round flow and vision implemented for Anthropic but only tested with OpenAI. Verify Claude models work.
- **Hotspot coverage**: Many parts have `mode: "none"` (no hotspot). Running the hotspot editor improves annotation quality.
