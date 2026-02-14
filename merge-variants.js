/**
 * Merge two engine-variant viewer manifests and content into a single multi-engine manifest.
 * Reads from two viewer data dirs (e.g. from transform --output data-z20let and data-z22se),
 * aligns tree nodes by path + title, tags with engines, and writes merged manifest + content to viewer/public/data.
 *
 * Usage:
 *   node merge-variants.js --z20let <dir> --z22se <dir> [--output <dir>]
 * If only --z20let is provided, outputs that variant with engine tags (single-variant mode).
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ENGINES = { Z20LET: "Z20LET", Z22SE: "Z22SE" };

function parseArgs() {
  const idx20 = process.argv.indexOf("--z20let");
  const idx22 = process.argv.indexOf("--z22se");
  const idxOut = process.argv.indexOf("--output");
  const z20letDir = idx20 !== -1 && process.argv[idx20 + 1] ? path.resolve(process.argv[idx20 + 1]) : null;
  const z22seDir = idx22 !== -1 && process.argv[idx22 + 1] ? path.resolve(process.argv[idx22 + 1]) : null;
  const outputDir = idxOut !== -1 && process.argv[idxOut + 1]
    ? path.resolve(process.argv[idxOut + 1])
    : path.join(__dirname, "viewer", "public", "data");
  return { z20letDir, z22seDir, outputDir };
}

const log = (msg) => console.log(`[merge] ${msg}`);
const ensureDir = (dir) => fs.mkdirSync(dir, { recursive: true });
const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));

/** Build path from root to node as array of titles */
function buildPathToNode(nodeId, nodes, roots) {
  const path = [];
  let current = nodes[nodeId];
  while (current) {
    path.unshift(normalizeTitle(current.title));
    if (current.parentId == null) break;
    current = nodes[current.parentId];
  }
  return path;
}

function normalizeTitle(t) {
  return (t || "").replace(/\s+/g, " ").trim();
}

/** Path key for matching nodes across trees */
function pathKey(pathTitles, nodeTitle) {
  return [...pathTitles, normalizeTitle(nodeTitle)].join("\n");
}

/** Collect all leaf path keys and slug per manifest */
function collectLeaves(manifest, engineCode) {
  const { tree, tocIdToSlug, sections } = manifest;
  const nodes = tree?.nodes || {};
  const roots = tree?.roots || [];
  const sectionById = new Map();
  for (const s of sections || []) {
    sectionById.set(s.id, s);
  }
  const leaves = new Map(); // pathKey -> { slug, section, nodeId }
  for (const [nodeId, node] of Object.entries(nodes)) {
    if (!node.isLeaf) continue;
    const slug = tocIdToSlug?.[nodeId];
    if (!slug) continue;
    const pathTitles = buildPathToNode(nodeId, nodes, roots);
    const key = pathKey(pathTitles.slice(0, -1), node.title);
    leaves.set(key, {
      engineCode,
      slug,
      section: sectionById.get(slug) || { id: slug, title: node.title, contentType: "generic", filename: `${slug}.json`, htmlFilename: `${slug}.html` },
      nodeId,
      pathTitles,
      title: node.title,
    });
  }
  return leaves;
}

/** Build path key to node for every node (for tree alignment) */
function allPathKeys(manifest) {
  const { tree } = manifest;
  const nodes = tree?.nodes || {};
  const result = new Map(); // pathKey -> { nodeId, node, pathTitles }
  for (const [nodeId, node] of Object.entries(nodes)) {
    const pathTitles = buildPathToNode(nodeId, nodes, tree?.roots || []);
    const key = pathKey(pathTitles.slice(0, -1), node.title);
    result.set(key, { nodeId, node, pathTitles });
  }
  return result;
}

/** Merge two trees by path alignment; produce merged nodes and roots */
function mergeTrees(manifestA, manifestB, leafMapping) {
  const keysA = allPathKeys(manifestA);
  const keysB = manifestB ? allPathKeys(manifestB) : new Map();
  const mergedNodes = {};
  const seenRootTitles = new Set();
  const rootOrder = [];
  const nodeIdToMergedId = new Map();

  const engineList = manifestB ? [ENGINES.Z20LET, ENGINES.Z22SE] : [ENGINES.Z20LET];

  function ensureMergedId(key, nodeA, nodeB) {
    if (nodeIdToMergedId.has(key)) return nodeIdToMergedId.get(key);
    const mergedId = "m_" + crypto.createHash("md5").update(key).digest("hex").slice(0, 12);
    nodeIdToMergedId.set(key, mergedId);
    const leafInfo = leafMapping.get(key);
    const engines = leafInfo ? leafInfo.engines : engineList;
    const variants = leafInfo?.variants || null;
    const isLeaf = !!nodeA?.isLeaf || !!nodeB?.isLeaf;
    const title = nodeA?.title || nodeB?.title || "";
    const childrenA = nodeA?.children || [];
    const childrenB = nodeB?.children || [];
    const childKeys = new Set();
    for (const cid of childrenA) {
      const c = manifestA.tree.nodes[cid];
      if (c) childKeys.add(pathKey(buildPathToNode(cid, manifestA.tree.nodes, manifestA.tree.roots).slice(0, -1), c.title));
    }
    if (manifestB?.tree?.nodes) {
      for (const cid of childrenB) {
        const c = manifestB.tree.nodes[cid];
        if (c) childKeys.add(pathKey(buildPathToNode(cid, manifestB.tree.nodes, manifestB.tree.roots).slice(0, -1), c.title));
      }
    }
    const mergedChildren = [];
    for (const ckey of childKeys) {
      const a = keysA.get(ckey);
      const b = keysB.get(ckey);
      const cMergedId = ensureMergedId(ckey, a?.node, b?.node);
      if (cMergedId) mergedChildren.push(cMergedId);
    }
    mergedNodes[mergedId] = {
      id: mergedId,
      title,
      engines: isLeaf && leafInfo ? leafInfo.engines : engineList,
      parentId: null,
      children: mergedChildren,
      isLeaf,
      ...(variants && Object.keys(variants).length ? { variants } : {}),
    };
    return mergedId;
  }
  function setParentIds() {
    for (const node of Object.values(mergedNodes)) {
      for (const cid of node.children) {
        if (mergedNodes[cid]) mergedNodes[cid].parentId = node.id;
      }
    }
  }

  const rootsA = manifestA.tree?.roots || [];
  const rootsB = manifestB?.tree?.roots || [];
  const rootKeys = new Set();
  for (const rid of rootsA) {
    const n = manifestA.tree.nodes[rid];
    if (n) rootKeys.add(pathKey([], n.title));
  }
  for (const rid of rootsB) {
    const n = manifestB?.tree?.nodes[rid];
    if (n) rootKeys.add(pathKey([], n.title));
  }
  const mergedRoots = [];
  for (const rkey of rootKeys) {
    const a = keysA.get(rkey);
    const b = keysB.get(rkey);
    const mid = ensureMergedId(rkey, a?.node, b?.node);
    if (mid && !seenRootTitles.has(mergedNodes[mid].title)) {
      seenRootTitles.add(mergedNodes[mid].title);
      mergedRoots.push(mid);
    }
  }
  for (const rid of rootsA) {
    const n = manifestA.tree.nodes[rid];
    if (!n) continue;
    const rkey = pathKey([], n.title);
    const mid = nodeIdToMergedId.get(rkey);
    if (mid && mergedRoots.indexOf(mid) === -1) mergedRoots.push(mid);
  }
  for (const rid of rootsB) {
    const n = manifestB?.tree?.nodes[rid];
    if (!n) continue;
    const rkey = pathKey([], n.title);
    if (nodeIdToMergedId.has(rkey)) {
      const mid = nodeIdToMergedId.get(rkey);
      if (mergedRoots.indexOf(mid) === -1) mergedRoots.push(mid);
    }
  }
  setParentIds();
  return { roots: mergedRoots, nodes: mergedNodes };
}

function main() {
  const { z20letDir, z22seDir, outputDir } = parseArgs();
  if (!z20letDir) {
    console.error("Usage: node merge-variants.js --z20let <viewer-data-dir> [--z22se <viewer-data-dir>] [--output <dir>]");
    process.exit(1);
  }

  const singleVariant = !z22seDir;
  if (singleVariant) log("Single-variant mode (Z20LET only)");

  const manifestA = readJson(path.join(z20letDir, "manifest.json"));
  let manifestB = null;
  if (z22seDir && fs.existsSync(path.join(z22seDir, "manifest.json"))) {
    manifestB = readJson(path.join(z22seDir, "manifest.json"));
  }

  const leavesA = collectLeaves(manifestA, ENGINES.Z20LET);
  const leavesB = manifestB ? collectLeaves(manifestB, ENGINES.Z22SE) : new Map();

  const leafMapping = new Map(); // pathKey -> { engines, variants }
  for (const [key, data] of leavesA) {
    const b = leavesB.get(key);
    const engines = b ? [ENGINES.Z20LET, ENGINES.Z22SE] : [ENGINES.Z20LET];
    const variants = {
      [ENGINES.Z20LET]: { slug: data.slug, filename: data.section.filename, htmlFilename: data.section.htmlFilename },
    };
    if (b) variants[ENGINES.Z22SE] = { slug: b.slug, filename: b.section.filename, htmlFilename: b.section.htmlFilename };
    leafMapping.set(key, { engines, variants });
  }
  for (const [key, data] of leavesB) {
    if (leafMapping.has(key)) continue;
    leafMapping.set(key, {
      engines: [ENGINES.Z22SE],
      variants: { [ENGINES.Z22SE]: { slug: data.slug, filename: data.section.filename, htmlFilename: data.section.htmlFilename } },
    });
  }

  const { roots, nodes } = mergeTrees(manifestA, manifestB, leafMapping);

  const mergedTocIdToSlug = { ...(manifestA.tocIdToSlug || {}) };
  if (manifestB?.tocIdToSlug) {
    for (const [tocId, slug] of Object.entries(manifestB.tocIdToSlug)) {
      mergedTocIdToSlug[tocId] = slug;
    }
  }

  const sectionBySlugA = new Map((manifestA.sections || []).map((s) => [s.id, s]));
  const sectionBySlugB = new Map((manifestB?.sections || []).map((s) => [s.id, s]));
  const sections = [];
  for (const [, info] of leafMapping) {
    const primarySlug = info.variants[ENGINES.Z20LET]?.slug || info.variants[ENGINES.Z22SE]?.slug;
    const meta = sectionBySlugA.get(primarySlug) || sectionBySlugB.get(primarySlug) || {};
    sections.push({
      id: primarySlug,
      title: meta.title ?? "",
      contentType: meta.contentType ?? "generic",
      filename: info.variants[ENGINES.Z20LET]?.filename || info.variants[ENGINES.Z22SE]?.filename,
      htmlFilename: info.variants[ENGINES.Z20LET]?.htmlFilename || info.variants[ENGINES.Z22SE]?.htmlFilename,
      engines: info.engines,
      variants: info.variants,
    });
  }

  const contentTypeStats = { ...(manifestA.contentTypeStats || {}) };
  if (manifestB?.contentTypeStats) {
    for (const [k, v] of Object.entries(manifestB.contentTypeStats)) {
      contentTypeStats[k] = (contentTypeStats[k] || 0) + v;
    }
  }

  const refsA = manifestA.references || {};
  const refsB = manifestB?.references || {};
  const references = {
    toolsCount: (refsA.toolsCount || 0) + (refsB.toolsCount || 0),
    torqueValuesCount: (refsA.torqueValuesCount || 0) + (refsB.torqueValuesCount || 0),
    pictogramsCount: Math.max(refsA.pictogramsCount || 0, refsB.pictogramsCount || 0),
    glossaryTermsCount: Math.max(refsA.glossaryTermsCount || 0, refsB.glossaryTermsCount || 0),
  };

  const mergedManifest = {
    vehicle: {
      make: manifestA.vehicle?.make || "Vauxhall",
      model: manifestA.vehicle?.model || "SPEEDSTER",
      year: manifestA.vehicle?.year || "2003",
      engines: manifestB ? [ENGINES.Z20LET, ENGINES.Z22SE] : [ENGINES.Z20LET],
    },
    generatedAt: new Date().toISOString(),
    sections,
    tree: { roots, nodes },
    tocIdToSlug: mergedTocIdToSlug,
    contentTypeStats,
    references,
  };

  ensureDir(outputDir);
  ensureDir(path.join(outputDir, "content"));
  ensureDir(path.join(outputDir, "references"));
  ensureDir(path.join(outputDir, "assets"));
  ensureDir(path.join(outputDir, "assets", "images"));

  const contentOut = path.join(outputDir, "content");
  const copyContent = (sourceDir) => {
    if (!fs.existsSync(path.join(sourceDir, "content"))) return;
    const files = fs.readdirSync(path.join(sourceDir, "content"));
    for (const f of files) {
      const src = path.join(sourceDir, "content", f);
      const dest = path.join(contentOut, f);
      if (fs.statSync(src).isFile()) fs.copyFileSync(src, dest);
    }
  };
  copyContent(z20letDir);
  if (z22seDir) copyContent(z22seDir);

  const copyDirRecursive = (srcDir, destDir) => {
    if (!fs.existsSync(srcDir)) return;
    ensureDir(destDir);
    for (const f of fs.readdirSync(srcDir)) {
      const src = path.join(srcDir, f);
      const dest = path.join(destDir, f);
      if (fs.statSync(src).isFile()) fs.copyFileSync(src, dest);
      else copyDirRecursive(src, dest);
    }
  };
  copyDirRecursive(path.join(z20letDir, "references"), path.join(outputDir, "references"));
  if (z22seDir) copyDirRecursive(path.join(z22seDir, "references"), path.join(outputDir, "references"));
  copyDirRecursive(path.join(z20letDir, "assets"), path.join(outputDir, "assets"));
  if (z22seDir) copyDirRecursive(path.join(z22seDir, "assets"), path.join(outputDir, "assets"));

  fs.writeFileSync(
    path.join(outputDir, "manifest.json"),
    JSON.stringify(mergedManifest, null, 2)
  );

  log(`Merged: ${sections.length} sections, ${Object.keys(nodes).length} tree nodes`);
  log(`Output: ${outputDir}`);
}

main();
