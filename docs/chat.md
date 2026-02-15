# Chat/RAG Session Log (2026-02-14)

This document captures what was done in this session for the TIS/EPC chat assistant work, including decisions, implementation, fixes, validations, and remaining tasks.

## 1) User requests covered in this session

- Build a workshop chatbox over TIS + EPC data (RAG style) with:
  - procedure guidance,
  - required parts/tools/torque,
  - source citations,
  - diagram/hotspot grounding.
- Evaluate MCP approach and architecture direction.
- Consider PageIndex repo (then drop it per user request).
- Add vision-aware grounding using existing hotspot data.
- Split work into multiple coding agents and execute.
- After implementation started:
  - fix `500` errors in chat flow,
  - fix black-on-black chat UI contrast,
  - move provider/key config to client-side chat settings (`localStorage`),
  - fix OpenAI model error about unsupported `temperature`.

## 2) Architecture and design decisions made

- Use **indexed JSON retrieval** over already transformed TIS/EPC datasets.
- Keep chat backend **provider-agnostic** with deterministic fallback answers when LLM calls fail.
- Keep citations and grounding first-class in the response payload:
  - `citations[]`,
  - `requiredParts[]`,
  - `diagramGrounding[]`.
- Use a floating React chat panel in the viewer for workshop UX.
- Use chat settings in UI to pass provider/model/key per request.
  - Server no longer depends on provider keys in env vars.
- Prefer graceful degradation (fallback response + warning) over hard 500 errors.

## 3) Implementation delivered

### 3.1 Indexing and grounding pipeline

- Added `build-rag-index.js`:
  - creates chunked retrieval corpus and metadata,
  - flattens EPC parts,
  - links TIS part mentions to EPC parts,
  - emits diagram/hotspot grounding artifacts.
- Added script in `package.json`:
  - `build-rag-index`.
- Generated `viewer/public/data/rag/` outputs:
  - `procedure-chunks.json`,
  - `doc-metadata.json`,
  - `parts-index.json`,
  - `part-procedure-links.json`,
  - `diagram-grounding.json`,
  - `index-manifest.json`.

### 3.2 Chat and retrieval API

- Added `rag-server.js` (Express):
  - `GET /api/health`,
  - `POST /api/reload-indexes`,
  - `POST /api/retrieve`,
  - `POST /api/locate-part`,
  - `POST /api/chat`.
- Retrieval improvements:
  - intent-aware scoring for replace/remove/install style queries,
  - engine-aware filtering,
  - per-document chunk caps to reduce redundancy.
- Reliability hardening:
  - invalid JSON body -> HTTP 400,
  - unloaded index state -> HTTP 503 with guidance,
  - provider failure -> fallback payload with warning (instead of 500).

### 3.3 Viewer chat UX

- Added `viewer/src/components/ChatPanel.jsx`:
  - floating chat,
  - answer rendering by sections,
  - citations and diagram links,
  - error/loading states.
- Integrated chat panel in `viewer/src/App.jsx`.
- Added chat styles in `viewer/src/App.css`.
- Vite proxy configured in `viewer/vite.config.js` to forward `/api` to `http://localhost:3002`.

### 3.4 Chat settings and key handling change

- Added chat settings UX in `ChatPanel`:
  - provider selector (`retrieval only`, `OpenAI`, `Anthropic`),
  - API key field,
  - optional model field,
  - local-only storage note.
- Persisted settings in `localStorage` under:
  - `tis.chat.settings.v1`.
- Chat request now includes:
  - `provider`,
  - `llm.provider`,
  - `llm.apiKey`,
  - `llm.model`.
- Server `/api/chat` now reads provider/key/model from request payload and no longer reads provider env vars.

### 3.5 OpenAI model compatibility fix

- Fixed OpenAI `unsupported_value` error for models that reject non-default temperature:
  - removed hardcoded `temperature: 0.2` from OpenAI request body in `callOpenAI()` in `rag-server.js`.
- Result: no more `"temperature does not support 0.2"` failure for those models.

### 3.6 Chat history persistence (client-side)

- Conversations are stored in the browser under `localStorage` key `tis.chat.history.v1`.
- Each conversation has: `id`, `title` (first user message, truncated ~60 chars), `createdAt`, `updatedAt`, `engine`, `messages[]` (same shape as in-memory: `id`, `role`, `text`, `data?`).
- **Conversation list**: When the panel is open with no active conversation, the list view shows "New conversation" and past conversations (title, relative time, message count, engine). Click to open; Delete to remove.
- **Navigation**: "← Conversations" in the header returns to the list (current conversation is saved if non-empty). "New conversation" starts a new thread; "Clear" clears the current thread only.
- **Auto-save**: After each assistant response, the current conversation is upserted into storage and the list is refreshed. No server-side changes; each `/api/chat` request remains stateless.
- Storage helpers in `ChatPanel.jsx`: `loadConversations()`, `saveConversation(conv)`, `deleteConversation(id)`, `conversationTitle(messages)`, `formatRelativeTime(ts)`.
- CSS for list view: `.chat-conv-list`, `.chat-conv-new`, `.chat-conv-item`, `.chat-conv-item-main`, `.chat-conv-item-title`, `.chat-conv-item-meta`, `.chat-conv-item-delete`, `.chat-panel-back`.

## 4) Documentation updated during session

- `docs/tis-scraper.md`:
  - added RAG/chat index and API section,
  - documented runtime behavior and fallback rules,
  - documented client-supplied LLM settings behavior.
- `docs/epc.md`:
  - added RAG grounding integration details (parts links + diagram grounding usage).

## 5) Issues encountered and fixes applied

- `500` on `/api/chat`:
  - causes included provider/key errors and resilience gaps;
  - fixed with fallback behavior and better state/body guards.
- Chat color contrast (black-on-black):
  - fixed with explicit chat color tokens and selector-level color rules.
- Invalid JSON payload handling:
  - added body parse error middleware returning structured 400 JSON.
- Port conflicts on `3002` (`EADDRINUSE`):
  - resolved by identifying and killing stale `node rag-server.js` processes before restart.
- OpenAI model param incompatibility:
  - removed forced temperature for OpenAI requests.

## 6) Validation performed

- Syntax/lint/build checks:
  - `node --check rag-server.js`,
  - lints for edited files,
  - `npm run build` in `viewer/`.
- API smoke checks:
  - `/api/health`,
  - `/api/reload-indexes`,
  - `/api/chat` with retrieval-only, missing key, invalid key, and provider requests.
- Browser checks (Playwright/headless + interactive):
  - chat renders and responds,
  - no black-on-black text,
  - settings UI present and persisted,
  - provider warning text includes `chat settings` when key is missing.

## 7) Current operational commands

- Build indexes:
  - `node build-rag-index.js`
- Start API:
  - `node rag-server.js`
- Start viewer:
  - `cd viewer && npm run dev`

## 8) What remains to be done

- Finish **Agent E integration sign-off** (currently in-progress in plan):
  - run and record final workshop scenarios systematically,
  - close loop on known failure modes with documented outcomes.
- Retrieval quality tuning:
  - improve operation-centric ranking (pick the single best procedure path first),
  - improve part/tool/torque ordering relevance per operation.
- Hardening for key handling:
  - optional UX improvements for safer key use (for example easy key wipe/rotation guidance already partially present),
  - evaluate optional session-only mode vs persistent localStorage.
- Provider compatibility hardening:
  - keep request payload model-safe across providers/models (OpenAI fix completed; continue validating Anthropic/default params across model variants).
- Data/index quality pass:
  - verify/clean modified hotspot JSON artifacts in working tree and decide what should be kept.
- Release workflow tasks:
  - review final diff set,
  - create commit(s),
  - optionally prepare PR with summary + manual test checklist.

## 9) Current status snapshot

- Core RAG/chat flow: implemented and running.
- Chat UI: implemented with settings + citations + grounding output.
- Provider/key handling: moved to client settings (localStorage-backed).
- Chat history: conversations persisted in localStorage; list view, new/open/delete, auto-save on each reply; continue conversations from the list.
- Major runtime blockers addressed in this session:
  - 500 handling, contrast issues, OpenAI temperature incompatibility.
