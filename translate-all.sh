#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

JOB="translate-job.json"
TITLES_JOB="translate-titles-job.json"
TRANSLATOR="npx @axeptio/ai-translator translate"
TMP=".translate-tmp"

rm -rf "$TMP"
mkdir -p "$TMP"

# ── Titles ──────────────────────────────────────────────────────

echo "=== [1/6] Extracting and splitting titles ==="
node extract-titles.js
node split-json.js titles.json "$TMP/titles-in" 100

echo "=== [2/6] Translating title chunks ==="
$TRANSLATOR "./$TMP/titles-in/*.json" "./$TMP/titles-out/{filename}.json" -j "$TITLES_JOB" -l fr

echo "=== [3/6] Merging translated titles ==="
node merge-json.js "$TMP/titles-out" viewer/public/data/fr/titles.json

# ── References (pre-split to avoid chunking warnings) ──────────

echo "=== [4/6] Translating references ==="
mkdir -p viewer/public/data/fr/references

for ref in viewer/public/data/references/*.json; do
  name=$(basename "$ref" .json)
  echo "  → $name"
  rm -rf "$TMP/ref-in" "$TMP/ref-out"
  node split-json.js "$ref" "$TMP/ref-in" 50
  $TRANSLATOR "./$TMP/ref-in/*.json" "./$TMP/ref-out/{filename}.json" -j "$JOB" -l fr
  node merge-json.js "$TMP/ref-out" "viewer/public/data/fr/references/$name.json"
done

# ── Content ────────────────────────────────────────────────────

echo "=== [5/6] Translating content (~1,771 files — this will take a while) ==="
$TRANSLATOR "./viewer/public/data/content/*.json" "./viewer/public/data/fr/content/{filename}.json" -j "$JOB" -l fr

# ── Cleanup ────────────────────────────────────────────────────

echo "=== [6/6] Cleanup ==="
rm -rf "$TMP" titles.json

echo ""
echo "=== Done ==="
echo "Titles:     $(wc -l < viewer/public/data/fr/titles.json) lines"
echo "References: $(ls viewer/public/data/fr/references/*.json 2>/dev/null | wc -l) files"
echo "Content:    $(ls viewer/public/data/fr/content/*.json 2>/dev/null | wc -l) files"
