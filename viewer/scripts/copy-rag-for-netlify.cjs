/**
 * Copies RAG server and data into netlify/functions so the serverless function
 * is self-contained. Run from viewer/ (e.g. npm run copy-rag-for-netlify).
 */
const fs = require("fs");
const path = require("path");

const viewerDir = process.cwd();
const rootDir = path.join(viewerDir, "..");
const functionsDir = path.join(viewerDir, "netlify", "functions");
const ragDataDir = path.join(functionsDir, "rag-data");

function copyFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function copyDir(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    const s = path.join(src, name);
    const d = path.join(dest, name);
    if (fs.statSync(s).isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

// rag-server.js at repo root -> netlify/functions/rag-server.js
const ragServerSrc = path.join(rootDir, "rag-server.js");
if (fs.existsSync(ragServerSrc)) {
  copyFile(ragServerSrc, path.join(functionsDir, "rag-server.js"));
  console.log("[copy-rag-for-netlify] Copied rag-server.js");
}

// viewer/public/data/rag -> netlify/functions/rag-data/rag
const ragSrc = path.join(viewerDir, "public", "data", "rag");
if (fs.existsSync(ragSrc)) {
  copyDir(ragSrc, path.join(ragDataDir, "rag"));
  console.log("[copy-rag-for-netlify] Copied public/data/rag");
}

// viewer/public/data/references -> netlify/functions/rag-data/references
const refsSrc = path.join(viewerDir, "public", "data", "references");
if (fs.existsSync(refsSrc)) {
  copyDir(refsSrc, path.join(ragDataDir, "references"));
  console.log("[copy-rag-for-netlify] Copied public/data/references");
}
