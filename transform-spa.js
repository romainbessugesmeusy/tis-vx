/**
 * TIS2Web Content Transformer
 * 
 * Transforms scraped TIS2Web content into a structured format for the React viewer.
 * 
 * This script:
 * - Reads scraped HTML from output/pages/
 * - Categorizes content based on keywords (Engine, Brakes, Electrical, etc.)
 * - Copies assets (CGM diagrams) to the viewer's public directory
 * - Generates manifest.json with all documents and their metadata
 * 
 * Run this after scrape-tis.js and before starting the viewer.
 * 
 * @author AI Assistant
 */

const fs = require("fs");
const path = require("path");
const cheerio = require("cheerio");

// ============================================================================
// CONFIGURATION
// ============================================================================

const config = {
  pagesDir: path.join(__dirname, "output", "pages"),
  assetsDir: path.join(__dirname, "output", "assets"),
  imagesDir: path.join(__dirname, "output", "assets", "images"),
  manifestPath: path.join(__dirname, "output", "manifest.json"),
  outputDir: path.join(__dirname, "viewer", "public", "data"),
  contentDir: path.join(__dirname, "viewer", "public", "data", "content"),
  viewerAssetsDir: path.join(__dirname, "viewer", "public", "data", "assets"),
  viewerImagesDir: path.join(__dirname, "viewer", "public", "data", "assets", "images"),
};

// ============================================================================
// UTILITIES
// ============================================================================

const ensureDir = (dir) => fs.mkdirSync(dir, { recursive: true });
const log = (msg) => console.log(`[transform] ${msg}`);

const slugify = (str) =>
  str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);

const titleCase = (str) => {
  return str
    .split(" ")
    .map((word) => {
      // Keep short words/acronyms uppercase (HVAC, 2D, 3D, etc.)
      if (word.length <= 2 || /^[A-Z0-9]+$/.test(word)) {
        return word.toUpperCase();
      }
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
};

const deriveCategory = (filename, title) => {
  const lowerTitle = title.toLowerCase();
  const lowerFile = filename.toLowerCase();

  if (lowerFile.startsWith("voltage") || lowerTitle.includes("distribution")) {
    return "Electrical - Power";
  }
  if (
    lowerTitle.includes("lamp") ||
    lowerTitle.includes("headlamp") ||
    lowerTitle.includes("fog")
  ) {
    return "Electrical - Lighting";
  }
  if (
    lowerTitle.includes("relay") ||
    lowerTitle.includes("fuse") ||
    lowerTitle.includes("fuses")
  ) {
    return "Electrical - Fuses & Relays";
  }
  if (
    lowerTitle.includes("wiring") ||
    lowerTitle.includes("harness") ||
    lowerTitle.includes("diagram")
  ) {
    return "Electrical - Wiring";
  }
  if (lowerTitle.includes("airbag") || lowerTitle.includes("sdm")) {
    return "Safety Systems";
  }
  if (
    lowerTitle.includes("engine") ||
    lowerTitle.includes("motronic") ||
    lowerTitle.includes("fuel") ||
    lowerTitle.includes("exhaust")
  ) {
    return "Engine";
  }
  if (lowerTitle.includes("brake")) {
    return "Brakes";
  }
  if (lowerTitle.includes("clutch") || lowerTitle.includes("transmission")) {
    return "Drivetrain";
  }
  if (lowerTitle.includes("hvac") || lowerTitle.includes("heating")) {
    return "Climate Control";
  }
  if (lowerTitle.includes("diagnostic") || lowerTitle.includes("trouble")) {
    return "Diagnostics";
  }
  if (lowerTitle.includes("instrument") || lowerTitle.includes("interior")) {
    return "Interior";
  }
  if (lowerTitle.includes("body") || lowerTitle.includes("accessori")) {
    return "Body & Accessories";
  }
  if (
    lowerTitle.includes("start") ||
    lowerTitle.includes("charging") ||
    lowerTitle.includes("battery")
  ) {
    return "Electrical - Starting & Charging";
  }
  if (lowerTitle.includes("horn") || lowerTitle.includes("cigarette")) {
    return "Electrical - Accessories";
  }
  if (lowerTitle.includes("general") || lowerTitle.includes("information")) {
    return "General";
  }
  return "Other";
};

// ============================================================================
// CONTENT EXTRACTION
// ============================================================================

const extractContent = (html) => {
  // First, clean up GM-specific tags using regex (cheerio can't handle namespaced tags)
  let cleaned = html;
  
  // Remove gm:callout-text and gm:finish completely (hidden content)
  cleaned = cleaned.replace(/<gm:callout-text[^>]*>[\s\S]*?<\/gm:callout-text>/gi, "");
  cleaned = cleaned.replace(/<gm:finish[^>]*>[\s\S]*?<\/gm:finish>/gi, "");
  cleaned = cleaned.replace(/<gm:finish\s*\/?>/gi, "");
  
  // Convert other GM tags to divs
  cleaned = cleaned.replace(/<gm:([a-z-]+)/gi, "<div data-gm-tag=\"$1\"");
  cleaned = cleaned.replace(/<\/gm:[a-z-]+>/gi, "</div>");
  
  const $ = cheerio.load(cleaned);

  // Remove scripts and styles
  $("script, style, noscript").remove();

  // Get content from form or body
  let $content = $("form").length ? $("form") : $("body");

  // Handle CGM objects - convert to placeholder divs
  $("object[type='image/cgm']").each((i, el) => {
    const $el = $(el);
    const src = $el.find("param[name='src']").attr("value");
    const name = $el.attr("name") || "diagram";

    if (src) {
      $el.replaceWith(`
        <div class="diagram-placeholder" data-src="${src}" data-name="${name}">
          <div class="diagram-icon">📊</div>
          <p class="diagram-label">${name}</p>
          <p class="diagram-note">CGM diagram: ${src}</p>
        </div>
      `);
    }
  });

  // Remove form attributes but keep content
  $("form").removeAttr("action method id onsubmit accept-charset");

  // Clean up empty elements
  $("div:empty, span:empty, p:empty").remove();
  
  // Remove data-gm-tag divs that are now empty
  $("div[data-gm-tag]").each((i, el) => {
    const $el = $(el);
    if (!$el.text().trim() && !$el.find("table, img, .diagram-placeholder").length) {
      $el.remove();
    }
  });

  // Get the cleaned HTML
  let content = $content.html() || "";

  // Remove excessive whitespace
  content = content.replace(/\s+/g, " ").trim();

  return content;
};

const extractTitle = (filename) => {
  let title = filename.replace(/\.html$/, "").replace(/-/g, " ");
  return titleCase(title);
};

// ============================================================================
// LINK RESOLUTION - Convert TFormSubmit links to /doc/{slug} links
// ============================================================================

const buildTitleToSlugMap = (scraperManifest) => {
  const titleToSlug = new Map();
  
  if (scraperManifest.pages) {
    for (const page of scraperManifest.pages) {
      // Use the original title from scraping, normalized
      const normalizedTitle = page.title.toLowerCase().trim();
      const slug = page.filename.replace(/\.html$/, "");
      
      // Only set if not already present (first wins)
      if (!titleToSlug.has(normalizedTitle)) {
        titleToSlug.set(normalizedTitle, slug);
      }
    }
  }
  
  return titleToSlug;
};

const resolveLinks = (html, titleToSlug) => {
  const $ = cheerio.load(html, { decodeEntities: false });
  let resolvedCount = 0;
  let unresolvedCount = 0;
  
  // Find all TFormSubmit links
  $('a[href^="javascript:TFormSubmit"]').each((i, el) => {
    const $el = $(el);
    const linkText = $el.text().trim();
    const normalizedText = linkText.toLowerCase();
    
    // Try to find matching slug
    const slug = titleToSlug.get(normalizedText);
    
    if (slug) {
      // Replace JavaScript href with proper link
      $el.attr("href", `/doc/${slug}`);
      $el.removeAttr("id"); // Remove the dynamic ID
      resolvedCount++;
    } else {
      // Mark as unresolved but make it non-functional
      $el.attr("href", "#");
      $el.addClass("unresolved-link");
      $el.attr("title", `Link target not found: ${linkText}`);
      unresolvedCount++;
    }
  });
  
  // Also handle detail links (zoom images etc) - these often point to detail views
  $('a[href*="\'detail\'"]').each((i, el) => {
    const $el = $(el);
    // Remove these links entirely as we don't have detail views
    $el.attr("href", "#");
    $el.addClass("detail-link-disabled");
  });
  
  return {
    html: $.html(),
    resolvedCount,
    unresolvedCount,
  };
};

// ============================================================================
// MAIN
// ============================================================================

const main = () => {
  log("Starting SPA transformation...");

  ensureDir(config.outputDir);
  ensureDir(config.contentDir);
  ensureDir(config.viewerAssetsDir);
  ensureDir(config.viewerImagesDir);

  // Copy CGM assets to viewer
  if (fs.existsSync(config.assetsDir)) {
    const assetFiles = fs.readdirSync(config.assetsDir).filter(f => !fs.statSync(path.join(config.assetsDir, f)).isDirectory());
    log(`Copying ${assetFiles.length} CGM assets to viewer...`);
    for (const file of assetFiles) {
      const src = path.join(config.assetsDir, file);
      const dest = path.join(config.viewerAssetsDir, file);
      fs.copyFileSync(src, dest);
    }
  }
  
  // Copy images to viewer
  if (fs.existsSync(config.imagesDir)) {
    const imageFiles = fs.readdirSync(config.imagesDir);
    log(`Copying ${imageFiles.length} images to viewer...`);
    for (const file of imageFiles) {
      const src = path.join(config.imagesDir, file);
      const dest = path.join(config.viewerImagesDir, file);
      fs.copyFileSync(src, dest);
    }
  }

  // Load scraper manifest for vehicle info, pages, and tree structure
  let scraperManifest = {
    vehicle: { make: "Vauxhall", model: "VX220", year: 2003, engine: "Z20 LET" },
    pages: [],
    tree: { roots: [], nodes: {} },
  };

  if (fs.existsSync(config.manifestPath)) {
    try {
      scraperManifest = JSON.parse(fs.readFileSync(config.manifestPath, "utf8"));
      log(`Loaded scraper manifest: ${scraperManifest.pages?.length || 0} pages, ${scraperManifest.tree?.roots?.length || 0} root folders`);
    } catch (e) {
      log("Could not load scraper manifest, using defaults");
    }
  }

  const vehicleInfo = {
    make: scraperManifest.vehicle?.make || "Vauxhall",
    model: scraperManifest.vehicle?.model || "VX220",
    year: parseInt(scraperManifest.vehicle?.year) || 2003,
    engine: scraperManifest.vehicle?.engine || "Z20 LET",
  };

  // Build title-to-slug map for link resolution
  const titleToSlug = buildTitleToSlugMap(scraperManifest);
  log(`Built title-to-slug map with ${titleToSlug.size} entries`);

  // Build tocId-to-slug map for tree node resolution
  const tocIdToSlug = {};
  if (scraperManifest.pages) {
    for (const page of scraperManifest.pages) {
      if (page.tocId && page.filename) {
        const slug = page.filename.replace(/\.html$/, "");
        tocIdToSlug[page.tocId] = slug;
      }
    }
  }
  log(`Built tocId-to-slug map with ${Object.keys(tocIdToSlug).length} entries`);

  // Fix orphan tree leaves: map tree nodes without tocId entries by matching title
  // This handles duplicate content that was skipped during scraping
  if (scraperManifest.tree?.nodes && scraperManifest.pages) {
    // Build title -> slug map from existing pages
    const titleToSlugForOrphans = new Map();
    for (const page of scraperManifest.pages) {
      if (page.title && page.filename) {
        const slug = page.filename.replace(/\.html$/, "");
        // First occurrence wins (matches scraper behavior)
        if (!titleToSlugForOrphans.has(page.title)) {
          titleToSlugForOrphans.set(page.title, slug);
        }
      }
    }

    // Find orphan leaf nodes and map them by title
    let orphansMapped = 0;
    for (const [nodeId, node] of Object.entries(scraperManifest.tree.nodes)) {
      if (node.isLeaf && !tocIdToSlug[nodeId]) {
        const matchingSlug = titleToSlugForOrphans.get(node.title);
        if (matchingSlug) {
          tocIdToSlug[nodeId] = matchingSlug;
          orphansMapped++;
        }
      }
    }
    if (orphansMapped > 0) {
      log(`Mapped ${orphansMapped} orphan tree leaves by title match`);
    }
  }

  // Get all HTML files from pages directory
  const rawFiles = fs
    .readdirSync(config.pagesDir)
    .filter((f) => f.endsWith(".html"));

  log(`Found ${rawFiles.length} raw files`);

  const sections = [];
  let totalResolved = 0;
  let totalUnresolved = 0;

  for (const filename of rawFiles) {
    const inputPath = path.join(config.pagesDir, filename);
    let html = fs.readFileSync(inputPath, "utf8");

    // Resolve TFormSubmit links to proper /doc/ links
    const { html: resolvedHtml, resolvedCount, unresolvedCount } = resolveLinks(html, titleToSlug);
    html = resolvedHtml;
    totalResolved += resolvedCount;
    totalUnresolved += unresolvedCount;

    const id = filename.replace(/\.html$/, "");
    const title = extractTitle(filename);
    const category = deriveCategory(filename, title);

    // Write transformed HTML to viewer
    const outputPath = path.join(config.contentDir, filename);
    fs.writeFileSync(outputPath, html);

    sections.push({
      id,
      title,
      category,
      filename,
      size: html.length,
    });
  }

  log(`Link resolution: ${totalResolved} resolved, ${totalUnresolved} unresolved`);

  // Sort sections by category then title
  sections.sort((a, b) => {
    if (a.category !== b.category) {
      return a.category.localeCompare(b.category);
    }
    return a.title.localeCompare(b.title);
  });

  // Build viewer manifest with tree structure from scraper
  const manifest = {
    vehicle: vehicleInfo,
    generatedAt: new Date().toISOString(),
    sections,
    tree: scraperManifest.tree || { roots: [], nodes: {} },
    tocIdToSlug,  // Map from tree leaf tocId to document slug for sidebar navigation
  };

  // Write manifest
  const manifestOutputPath = path.join(config.outputDir, "manifest.json");
  fs.writeFileSync(manifestOutputPath, JSON.stringify(manifest, null, 2));

  log(`\n=== TRANSFORMATION COMPLETE ===`);
  log(`Processed: ${sections.length} documents`);
  log(`Links resolved: ${totalResolved}, unresolved: ${totalUnresolved}`);
  log(`Tree structure: ${manifest.tree.roots.length} root folders`);
  log(`Manifest: ${manifestOutputPath}`);
  log(`Content: ${config.contentDir}`);

  // Print category summary
  const categories = {};
  sections.forEach((s) => {
    categories[s.category] = (categories[s.category] || 0) + 1;
  });
  log(`\nCategories:`);
  Object.entries(categories)
    .sort((a, b) => b[1] - a[1])
    .forEach(([cat, count]) => {
      log(`  ${cat}: ${count}`);
    });
};

main();
