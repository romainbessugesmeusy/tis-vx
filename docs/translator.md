# Translation System

AI-agent reference for the content translation pipeline and viewer language switching.

## Architecture

```
viewer/public/data/              ← English (default, original)
  content/*.json                   ~1,771 structured content files
  content/*.html                   HTML fallbacks for generic type
  references/*.json                4 files: tools, torque-values, pictograms, glossary
  manifest.json                    tree, sections, tocIdToSlug (NOT translated)

viewer/public/data/fr/           ← French (translated)
  content/*.json                   same filenames, same JSON structure, French text
  references/*.json                same filenames, French text
  titles.json                      flat { nodeId: frenchTitle } for sidebar display
```

The manifest is shared across languages — only content files, reference files, and sidebar titles get translated. The `data/fr/` directory mirrors the `data/` structure for translatable files only.

## Translation tool: `@axeptio/ai-translator`

npm package (created by repo owner). Translates JSON files via OpenAI API.

### CLI usage

```bash
npx @axeptio/ai-translator translate <input-glob> <output-pattern> -j <job-file> -l <locale>
```

Note the `translate` subcommand. Output pattern uses `{filename}` and `{locale}` placeholders. Use `.json` literally for the extension (the `{ext}` placeholder adds a double dot).

### Known constraints

- Job options require: `model` (enum: `"gpt-3.5-turbo"` or `"gpt-4"`), `maxTokens`, `format`, `context`, `style`, `locales`. `fieldDescriptions` must be an array of strings, not an object.
- The `gpt-4` base model does NOT support JSON mode (`response_format: json_object`). Use `"gpt-3.5-turbo"`.
- Large files (200+ entries) get auto-chunked with 5s delay between API calls. This makes large reference files slow.
- For the titles file (2,194 entries), split into chunks of ~100 before translating. Use `split-titles.js` → translate chunks → `merge-titles.js`.

### Translation runs

```bash
# 1. Content (~1,771 files — will take hours)
npx @axeptio/ai-translator translate \
  "./viewer/public/data/content/*.json" \
  "./viewer/public/data/fr/content/{filename}.json" \
  -j translate-job.json -l fr

# 2. References (4 files — small ones are fast, torque-values is slow)
npx @axeptio/ai-translator translate \
  "./viewer/public/data/references/*.json" \
  "./viewer/public/data/fr/references/{filename}.json" \
  -j translate-job.json -l fr

# 3. Sidebar titles (chunked approach)
node extract-titles.js              # → titles.json (2,194 entries)
node split-titles.js                # → titles-chunks/*.json (22 files of ~100)
npx @axeptio/ai-translator translate \
  "./titles-chunks/*.json" \
  "./titles-chunks-fr/{filename}.json" \
  -j translate-titles-job.json -l fr
node merge-titles.js                # → viewer/public/data/fr/titles.json
```

### Job options files

**`translate-job.json`** — used for content and reference files:
- `context`: automotive workshop manual, TIS2Web, never-translate rules (part numbers, engine codes, model names, component codes, units, tool codes, Field Remedy numbers), cross-reference translation with guillemets
- `style`: impersonal infinitive (Revue Technique register), mandatory glossary (~50 term pairs: Remove=Déposer, Install=Reposer, Bolt=Vis, Harness=Faisceau, etc.)
- `protectedFields`: `id`, `type`, `subtype`, `totalItems`, `extractedData`, `diagram`, `metadata`, `phases.*.icon`, `phases.*.phase`, `phases.*.steps.*.number`, `phases.*.steps.*.image`, `phases.*.steps.*.callouts`, `phases.*.torqueValues`, `components.*.code`, `items.*.links`, `values.*.value`, `values.*.unit`, `tools.*.code`, `parts.*.partNumber`
- `fieldDescriptions.htmlContent`: preserve HTML tags, only translate visible text

**`translate-titles-job.json`** — used for the flat titles map:
- `context`: TOC section titles, keys are node IDs (don't translate keys)
- `style`: same Revue Technique style, abbreviated glossary

### `extract-titles.js`

Reads `viewer/public/data/manifest.json` → iterates `tree.nodes` → writes `titles.json` as flat `{ nodeId: title }`. Run before translating titles.

## Viewer: language switching

### State (App.jsx)

```
language       — 'en' | 'fr', default 'en', persisted to localStorage key 'tis-language'
titleOverrides — null (en) or { nodeId: frenchTitle } fetched from /data/fr/titles.json
```

Both are React state in `App`. `handleLanguageChange(lang)` updates state + localStorage.

### Effect: title overrides

When `language !== 'en'`, App.jsx fetches `/data/${language}/titles.json` → `setTitleOverrides(data)`. When `language === 'en'`, clears to `null`.

### Prop flow

```
App
├── AppHeader       ← language, onLanguageChange
│   └── DownloadManager ← language
├── Sidebar         ← titleOverrides
├── ContentViewer   ← language
└── ReferenceIndex  ← language
```

### Content path pattern

Every component that fetches content uses:
```js
const basePath = language === 'en' ? '/data' : `/data/${language}`
```

Then fetches from `${basePath}/content/${slug}.json`, `${basePath}/references/${filename}`, etc.

Affected components and what they prefix:
- **ContentViewer.jsx** — `${basePath}/content/${slug}.json`, `${basePath}/content/${slug}.html`
- **ReferenceIndex.jsx** — `${basePath}/references/${filename}`
- **DownloadManager.jsx** — `buildSections(manifest, language)` and `getPageItems(language)` both build URLs with `${base}/content/` and `${base}/references/`

### Sidebar title overrides

Utility at top of Sidebar.jsx:
```js
const nodeTitle = (nodeId, node, titleOverrides) =>
  titleOverrides?.[nodeId] || node?.title || ''
```

`titleOverrides` prop flows: Sidebar → ColumnNav → MixedColumn, Sidebar → TreeNode → TreeGroup.

All display renders of `node.title` use `nodeTitle(id, node, titleOverrides)`. Logic checks (isGroupFolder, getGroupStyle, GROUP_FOLDER_TITLES matching) still use `node.title` directly — the original English title drives structural behavior.

Search also matches on translated titles: `node.title.toLowerCase().includes(query) || nodeTitle(id, node, titleOverrides).toLowerCase().includes(query)`.

### Settings UI (AppHeader.jsx)

Language selector in the settings dropdown, between Engine Filter and Downloads sections. Two pill buttons: "English" / "Français", using the same `settings-engine-pill` CSS class. Calls `onLanguageChange('en')` / `onLanguageChange('fr')`.

## Content types and translatable fields

| Type | Translatable fields |
|------|---------------------|
| procedure | `title`, `phases[].label`, `phases[].steps[].text` |
| tsb | `title`, `subject`, `complaint`, `cause`, `remedyContent[].text` |
| harness_diagram | `title`, `components[].description` |
| glossary | `title`, `items[].term`, `items[].description` |
| torque_table | `title`, `values[].component` |
| tool_list | `title`, `tools[].name`, `tools[].description` |
| diagnostic | `title`, `objective`, `procedure[].text` |
| generic | `title`, `htmlContent` (HTML — translate text nodes only) |

Reference files: `tools.json` (name, description), `glossary.json` (term, description), `torque-values.json` (component), `pictograms.json` (label, description).

## Adding a new language

1. Add locale to `translate-job.json` and `translate-titles-job.json` `locales` arrays
2. Run the three translation commands with `-l <newlocale>`
3. In App.jsx: extend the `useState` initializer to recognize the new locale code
4. In AppHeader.jsx: add a third pill button for the new language
5. Everything else (basePath, titleOverrides fetch) already uses `language` dynamically — no other code changes needed

## File inventory

| File | Role |
|------|------|
| `translate-job.json` | Job options for content + reference translation |
| `translate-titles-job.json` | Job options for sidebar titles translation |
| `extract-titles.js` | manifest → titles.json extractor |
| `viewer/src/App.jsx` | language state, titleOverrides fetch, prop distribution |
| `viewer/src/components/AppHeader.jsx` | language selector UI, passes language to DownloadManager |
| `viewer/src/components/ContentViewer.jsx` | basePath for content fetches |
| `viewer/src/components/ReferenceIndex.jsx` | basePath for reference fetches |
| `viewer/src/components/DownloadManager.jsx` | buildSections/getPageItems use language for download URLs |
| `viewer/src/components/Sidebar.jsx` | nodeTitle() utility, titleOverrides threading to all sub-components |
| `split-titles.js` | splits titles.json into ~100-entry chunks for translation |
| `merge-titles.js` | merges translated title chunks into viewer/public/data/fr/titles.json |
| `viewer/public/data/fr/` | translated content directory |
