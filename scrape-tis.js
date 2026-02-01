/**
 * TIS2Web Scraper
 * 
 * Extracts service documentation from the legacy Opel/Vauxhall TIS2Web system.
 * 
 * CRITICAL: This scraper MUST use English locale (en-GB) to get complete content.
 * The French database has significantly less documentation for the same vehicle.
 * 
 * Key behaviors:
 * - Uses Playwright for browser automation
 * - Iterates through all SIT filter categories to capture all content types
 * - Expands the entire TOC tree by clicking each folder (DOM is not pre-loaded)
 * - Downloads CGM diagram assets
 * - Cleans HTML by removing scripts, ActiveX, and proprietary tags
 * 
 * See README.md for detailed post-mortem and lessons learned.
 * 
 * @author AI Assistant
 * @version 4.0 (Final)
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { chromium } = require("playwright");

// ============================================================================
// CONFIGURATION
// ============================================================================

const config = {
  baseUrl: "http://localhost:9090/tis2web/",
  outputDir: path.join(__dirname, "output"),
  pagesDir: path.join(__dirname, "output", "pages"),
  assetsDir: path.join(__dirname, "output", "assets"),
  imagesDir: path.join(__dirname, "output", "assets", "images"),
  rawDir: path.join(__dirname, "output", "raw"),
  screenshotsDir: path.join(__dirname, "output", "_screenshots"),
  headless: false,
  throttleMs: 80,
  maxIterations: 2000,

  vehicle: {
    make: "Vauxhall",
    model: "SPEEDSTER",
    year: "2003",
    engine: "Z 20 LET",
  },
};

// ============================================================================
// UTILITIES
// ============================================================================

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ensureDir = (dir) => fs.mkdirSync(dir, { recursive: true });
const writeJson = (filePath, data) => fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
const log = (msg) => console.log(`[${new Date().toISOString().slice(11,19)}] ${msg}`);
const hash = (str) => crypto.createHash("md5").update(str).digest("hex").slice(0, 12);
const slugify = (str) => str.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

// ============================================================================
// FRAME HELPERS
// ============================================================================

const getTocFrame = (page) => page.frames().find((f) => f.name() === "tociframepanel");

// ============================================================================
// INITIAL SETUP
// ============================================================================

const dismissDialogs = async (page) => {
  for (let i = 0; i < 5; i++) {
    await sleep(400);
    // French: OUI, English: YES
    const yes = await page.$("button:has-text('OUI'), button:has-text('YES'), button:has-text('Yes')");
    if (yes) { await yes.click(); await sleep(600); continue; }
    const ok = await page.$("button:has-text('OK'), button:has-text('Ok')");
    if (ok) { await ok.click(); await sleep(600); continue; }
    break;
  }
};

const selectVehicle = async (page) => {
  log("Selecting vehicle...");
  
  // Try to find the vehicle icon - it might have different src patterns
  let carIcon = await page.$("img[src*='vehiclecontext']");
  if (!carIcon) {
    carIcon = await page.$("img[alt*='vehicle' i]");
  }
  if (!carIcon) {
    // Try finding by title or other attributes
    carIcon = await page.$("a[title*='vehicle' i] img, a[title*='Vehicle' i] img");
  }
  if (!carIcon) {
    // Last resort - look for any icon in the toolbar area that might be vehicle related
    const icons = await page.$$("img[src*='.gif']");
    for (const icon of icons) {
      const src = await icon.getAttribute("src");
      if (src && (src.includes("vehicle") || src.includes("car") || src.includes("context"))) {
        carIcon = icon;
        break;
      }
    }
  }
  
  if (!carIcon) {
    log("WARNING: Could not find vehicle icon, taking screenshot for debug");
    await page.screenshot({ path: path.join(config.screenshotsDir, "no-vehicle-icon.png") });
    throw new Error("Vehicle icon not found");
  }
  
  const parent = await carIcon.evaluateHandle((el) => el.closest("a"));
  await parent.asElement().click();
  await sleep(800);
  
  // Select by label text instead of value (more robust across languages)
  // Vauxhall brand, SPEEDSTER/VX220 model
  try {
    await page.selectOption("#vc\\.attributename\\.salesmake", { label: /Vauxhall/i });
  } catch {
    await page.selectOption("#vc\\.attributename\\.salesmake", { value: "2" });
  }
  await sleep(300);
  
  try {
    await page.selectOption("#vc\\.attributename\\.model", { label: /SPEEDSTER/i });
  } catch {
    await page.selectOption("#vc\\.attributename\\.model", { value: "32" });
  }
  await sleep(300);
  
  try {
    await page.selectOption("#vc\\.attributename\\.modelyear", { label: "2003" });
  } catch {
    await page.selectOption("#vc\\.attributename\\.modelyear", { value: "5" });
  }
  await sleep(300);
  
  try {
    await page.selectOption("#vc\\.attributename\\.engine", { label: /Z.*20.*LET/i });
  } catch {
    await page.selectOption("#vc\\.attributename\\.engine", { value: "1" });
  }
  await sleep(300);
  
  await page.click("button:has-text('OK')");
  await sleep(800);
};

const navigateToAssemblyGroups = async (page) => {
  log("Navigating to ISD -> AssemblyGroups...");
  
  // Take screenshot before navigation
  await page.screenshot({ path: path.join(config.screenshotsDir, "before-isd.png") });
  
  // SI/ISD link - try multiple selectors (English: SI, French: ISD)
  let siLink = await page.$("a:has-text('SI')");
  if (!siLink) {
    siLink = await page.$("a:has-text('ISD')");
  }
  if (!siLink) {
    // Look for it in the navigation bar
    const links = await page.$$("a");
    for (const link of links) {
      const text = await link.textContent();
      if (text && (text.trim() === "SI" || text.trim() === "ISD")) {
        siLink = link;
        break;
      }
    }
  }
  
  if (!siLink) {
    await page.screenshot({ path: path.join(config.screenshotsDir, "no-si-link.png") });
    throw new Error("SI/ISD link not found");
  }
  
  await siLink.click();
  await sleep(1000);
  
  // Take screenshot after ISD click
  await page.screenshot({ path: path.join(config.screenshotsDir, "after-isd.png") });
  
  // Look for AssemblyGroups icon (stdinfo2 or similar)
  let assemblyGroupsLink = await page.$("img[src*='stdinfo2']");
  if (!assemblyGroupsLink) {
    assemblyGroupsLink = await page.$("img[src*='stdinfo']");
  }
  if (!assemblyGroupsLink) {
    // Try finding by alt text or title
    assemblyGroupsLink = await page.$("a[title*='group' i] img, a[title*='Assembly' i] img");
  }
  if (!assemblyGroupsLink) {
    // Try finding by link text
    assemblyGroupsLink = await page.$("a:has-text('Assembly'), a:has-text('Choix'), a:has-text('Document')");
    if (assemblyGroupsLink) {
      await assemblyGroupsLink.click();
    }
  } else {
    const parent = await assemblyGroupsLink.evaluateHandle((el) => el.closest("a"));
    await parent.asElement().click();
  }
  
  await sleep(2000); // Wait longer for tree to fully load
  
  // Take screenshot after AssemblyGroups
  await page.screenshot({ path: path.join(config.screenshotsDir, "after-assembly.png") });
  
  // Debug: Save initial TOC HTML
  const tocFrame = getTocFrame(page);
  if (tocFrame) {
    const tocHtml = await tocFrame.content();
    fs.writeFileSync(path.join(config.screenshotsDir, "toc-initial.html"), tocHtml);
    
    // Count what we see
    const allLinks = await tocFrame.$$eval("table.tree a[href*='TFormSubmit']", links => links.length);
    const folderIcons = await tocFrame.$$eval("img[src*='folder']", imgs => imgs.length);
    log(`TOC initial state: ${allLinks} links, ${folderIcons} folder icons`);
  } else {
    log("WARNING: TOC frame not found!");
    await page.screenshot({ path: path.join(config.screenshotsDir, "no-toc-frame.png") });
  }
};

// Apply a specific filter to the TOC
const applyFilter = async (page, filterValue, filterName) => {
  const tocFrame = getTocFrame(page);
  if (!tocFrame) return false;
  
  try {
    await tocFrame.selectOption('#SITSelection', filterValue);
    log(`Applied filter: ${filterName}`);
    await sleep(1000); // Wait for tree to reload
    return true;
  } catch (err) {
    log(`Filter error: ${err.message}`);
    return false;
  }
};

// ============================================================================
// TOC PARSING - Parse nested <table> structure as tree hierarchy
// ============================================================================

// Count closed folder icons in TOC
const countClosedFolders = async (tocFrame) => {
  return await tocFrame.$$eval("img[src*='closed']", imgs => imgs.length);
};

// Click all closed folder icons to fully expand tree
const expandAllFolders = async (page) => {
  let iteration = 0;
  const maxIterations = 2000;  // Increased for larger trees
  let consecutiveErrors = 0;
  let consecutiveZeros = 0;    // Track how many times we see 0 closed icons
  
  while (iteration < maxIterations) {
    iteration++;
    
    // Always re-acquire TOC frame (it may have been destroyed/recreated)
    const tocFrame = getTocFrame(page);
    if (!tocFrame) {
      log(`TOC frame lost at iteration ${iteration}, waiting...`);
      await sleep(500);
      consecutiveErrors++;
      if (consecutiveErrors > 10) {
        log("Too many consecutive errors, stopping expansion");
        break;
      }
      continue;
    }
    
    // Scroll to ensure all content is loaded - scroll down then up periodically
    if (iteration % 50 === 0) {
      try {
        await tocFrame.evaluate(() => {
          const container = document.body;
          container.scrollTop = container.scrollHeight;
        });
        await sleep(100);
        await tocFrame.evaluate(() => {
          const container = document.body;
          container.scrollTop = 0;
        });
        await sleep(100);
      } catch {}
    }
    
    // Find closed folder icons
    let closedIcons;
    try {
      closedIcons = await tocFrame.$$("img[src*='closed']");
    } catch (err) {
      log(`Error finding closed icons: ${err.message.split('\n')[0]}`);
      await sleep(200);
      consecutiveErrors++;
      if (consecutiveErrors > 10) break;
      continue;
    }
    
    consecutiveErrors = 0; // Reset on success
    
    if (closedIcons.length === 0) {
      consecutiveZeros++;
      // Only consider fully expanded after seeing 0 multiple times
      if (consecutiveZeros >= 3) {
        log(`Tree fully expanded after ${iteration} iterations`);
        break;
      }
      await sleep(200);
      continue;
    }
    
    consecutiveZeros = 0; // Reset when we find closed icons
    
    if (iteration % 20 === 1) {
      log(`[${iteration}] Expanding... ${closedIcons.length} closed folders remaining`);
    }
    
    // Click the first closed folder
    try {
      await closedIcons[0].click();
      await sleep(config.throttleMs);
    } catch (err) {
      // Icon might have been removed or frame destroyed, continue
      await sleep(100);
    }
  }
};

// Parse the fully expanded tree DOM into a JSON structure
// Structure: <table class="tree"><tr>
//   <td>icon link</td>
//   <td>text link <br> <table class="tree">children</table></td>
// </tr></table>
const parseTreeStructure = async (tocFrame) => {
  return await tocFrame.evaluate(() => {
    const tree = { roots: [], nodes: {}, debug: [] };
    
    // Recursive function to parse a tree table
    function parseTable(table, parentId, depth = 0) {
      // Get direct rows of this table
      const tbody = table.querySelector("tbody") || table;
      const rows = tbody.querySelectorAll(":scope > tr");
      
      if (depth === 0) {
        tree.debug.push("parseTable called with " + rows.length + " rows at depth " + depth);
      }
      
      for (const row of rows) {
        const cells = row.querySelectorAll(":scope > td");
        if (cells.length < 2) continue;
        
        // Second cell contains the text link and nested children
        const contentCell = cells[1];
        
        // Find the text link (direct child <a> with no img, or <a> with img for leaves)
        const links = contentCell.querySelectorAll(":scope > a[href*='TFormSubmit']");
        
        if (depth === 0 && tree.debug.length < 20) {
          tree.debug.push("Row has " + links.length + " direct links");
        }
        
        let textLink = null;
        for (const link of links) {
          const img = link.querySelector("img");
          // Text link has no img, or leaf link has img with leaf icon
          if (!img || (img.src && img.src.includes("leaf"))) {
            textLink = link;
            break;
          }
        }
        
        if (!textLink) {
          if (depth === 0 && tree.debug.length < 30) {
            tree.debug.push("No textLink found, links checked: " + links.length);
            for (const l of links) {
              const hasImg = !!l.querySelector("img");
              tree.debug.push("  - hasImg: " + hasImg + ", text: " + (l.textContent?.trim()?.substring(0, 30) || "[empty]"));
            }
          }
          continue;
        }
        
        const href = textLink.getAttribute("href") || "";
        const id = textLink.id;
        const text = textLink.textContent?.trim() || "";
        
        if (depth === 0 && tree.debug.length < 30) {
          tree.debug.push("textLink found: href=" + href.substring(0, 50) + " text=" + text.substring(0, 30));
        }
        
        // Parse TFormSubmit arguments - handles both quoted and unquoted (null) fourth argument
        // Pattern: TFormSubmit('param1','param2','param3',target) where target is 'string' or null
        const match = href.match(/TFormSubmit\('([^']+)','([^']+)','([^']+)'(?:,(?:'([^']*)'|null))?\)/);
        if (!match) {
          if (depth === 0 && tree.debug.length < 30) {
            tree.debug.push("Regex did not match: " + href.substring(0, 80));
          }
          continue;
        }
        
        // match[4] is the quoted target if present, undefined if null or missing
        const isLeaf = match[4] === "_top";
        const nodeId = id || match[1]; // Use ID or first param
        
        if (depth === 0 && tree.debug.length < 30) {
          tree.debug.push("Match found: isLeaf=" + isLeaf + " nodeId=" + nodeId + " text=" + text);
        }
        
        // Skip if empty text and not a leaf
        if (!text && !isLeaf) {
          if (depth === 0 && tree.debug.length < 30) {
            tree.debug.push("Skipping: empty text and not leaf");
          }
          continue;
        }
        
        tree.nodes[nodeId] = {
          id: nodeId,
          title: text,
          parentId: parentId,
          children: [],
          isLeaf: isLeaf,
          formParams: {
            param1: match[1],
            param2: match[2],
            param3: match[3],
            target: match[4] || null
          }
        };
        
        // Add to parent's children or to roots
        if (parentId && tree.nodes[parentId]) {
          tree.nodes[parentId].children.push(nodeId);
        } else if (!parentId) {
          tree.roots.push(nodeId);
        }
        
        // If not a leaf, look for nested table (children)
        if (!isLeaf) {
          const nestedTable = contentCell.querySelector(":scope > table.tree");
          if (nestedTable) {
            parseTable(nestedTable, nodeId, depth + 1);
          }
        }
      }
    }
    
    // Find the root tree table
    const rootTable = document.querySelector("table.tree");
    tree.debug.push("Root table found: " + !!rootTable);
    
    if (rootTable) {
      const tbody = rootTable.querySelector("tbody") || rootTable;
      const rows = tbody.querySelectorAll(":scope > tr");
      tree.debug.push("Direct rows in root table: " + rows.length);
      
      // Debug: show first row structure
      if (rows.length > 0) {
        const cells = rows[0].querySelectorAll(":scope > td");
        tree.debug.push("Cells in first row: " + cells.length);
        if (cells.length >= 2) {
          const allLinks = cells[1].querySelectorAll("a[href*='TFormSubmit']");
          tree.debug.push("All links in second cell: " + allLinks.length);
          const directLinks = cells[1].querySelectorAll(":scope > a[href*='TFormSubmit']");
          tree.debug.push("Direct links in second cell: " + directLinks.length);
          for (const l of directLinks) {
            tree.debug.push("  Link: " + (l.textContent?.trim()?.substring(0, 40) || "[no text]"));
          }
        }
      }
      
      parseTable(rootTable, null);
    }
    
    return tree;
  });
};

// Get folder title by finding the text link that follows an icon link with the same base ID
const getFolderTitle = async (tocFrame, folderId) => {
  try {
    // Look for a text link that might be associated with this folder icon
    // Usually they share the same row or have related IDs
    const text = await tocFrame.$eval(`a[id="${folderId}"]`, (link) => {
      // Get the containing row
      const row = link.closest("tr");
      if (row) {
        // Find text links in the same row
        const textLinks = row.querySelectorAll("a:not(:has(img))");
        for (const tl of textLinks) {
          const txt = tl.textContent?.trim();
          if (txt && txt.length > 0) return txt;
        }
      }
      // Fallback: check next sibling
      const next = link.nextElementSibling;
      if (next && next.tagName === "A") {
        return next.textContent?.trim() || "";
      }
      return "";
    });
    return text;
  } catch {
    return "";
  }
};

// ============================================================================
// ASSET EXTRACTION (CGM diagrams)
// ============================================================================

const extractAssets = (html) => {
  const assets = [];
  const regex = /<param\s+name=["']src["']\s+value=["']([^"']+)["']/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    assets.push({ type: "cgm", path: match[1] });
  }
  return assets;
};

const downloadAsset = async (page, assetPath, outputDir) => {
  const url = new URL(assetPath, config.baseUrl).href;
  const filename = hash(assetPath) + ".cgm";
  const outputPath = path.join(outputDir, filename);
  
  if (fs.existsSync(outputPath)) return { path: assetPath, filename, cached: true };
  
  try {
    const response = await page.request.get(url);
    if (response.ok()) {
      const buffer = await response.body();
      fs.writeFileSync(outputPath, buffer);
      return { path: assetPath, filename, size: buffer.length };
    }
  } catch {}
  return { path: assetPath, filename: null, error: true };
};

// ============================================================================
// IMAGE EXTRACTION (GIF, JPG, PNG, dynamic images)
// ============================================================================

const extractImages = (html) => {
  const images = new Set();
  
  // Match src attributes with image extensions (handles whitespace/newlines after src=)
  const staticImgRegex = /src\s*=\s*["']([^"']*\.(gif|jpg|jpeg|png))["']/gi;
  let match;
  while ((match = staticImgRegex.exec(html)) !== null) {
    images.add(match[1]);
  }
  
  // Match dynamic image URLs like si/pic/i/123456/789012 (handles whitespace/newlines)
  const dynamicImgRegex = /src\s*=\s*["'](si\/pic\/i\/[^"']+)["']/gi;
  while ((match = dynamicImgRegex.exec(html)) !== null) {
    images.add(match[1]);
  }
  
  return Array.from(images);
};

const downloadImage = async (page, imagePath, outputDir) => {
  const url = new URL(imagePath, config.baseUrl).href;
  
  // Determine file extension
  const extMatch = imagePath.match(/\.(gif|jpg|jpeg|png)$/i);
  const ext = extMatch ? extMatch[1].toLowerCase() : "jpg"; // Default to jpg for dynamic images
  const filename = hash(imagePath) + "." + ext;
  const outputPath = path.join(outputDir, filename);
  
  if (fs.existsSync(outputPath)) return { path: imagePath, filename, cached: true };
  
  try {
    const response = await page.request.get(url);
    if (response.ok()) {
      const buffer = await response.body();
      fs.writeFileSync(outputPath, buffer);
      return { path: imagePath, filename, size: buffer.length };
    }
  } catch {}
  return { path: imagePath, filename: null, error: true };
};

const cleanHtml = (html, assetMap = {}, imageMap = {}) => {
  let cleaned = html;
  cleaned = cleaned.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");
  cleaned = cleaned.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "");
  cleaned = cleaned.replace(/<gm:callout-text[^>]*>[\s\S]*?<\/gm:callout-text>/gi, "");
  cleaned = cleaned.replace(/<gm:finish\s*\/?>/gi, "");
  cleaned = cleaned.replace(/<gm:([a-z-]+)([^>]*)>/gi, '<div data-gm="$1"$2>');
  cleaned = cleaned.replace(/<\/gm:[a-z-]+>/gi, "</div>");
  
  // Replace CGM objects with img tags
  cleaned = cleaned.replace(
    /<object[^>]*type=["']image\/cgm["'][^>]*>[\s\S]*?<param\s+name=["']src["']\s+value=["']([^"']+)["'][\s\S]*?<\/object>/gi,
    (match, src) => {
      const asset = assetMap[src];
      const filename = asset?.filename || hash(src) + ".cgm";
      return `<div class="diagram"><img src="/data/assets/${filename}" alt="Diagram" onerror="this.style.display='none';this.nextElementSibling.style.display='block'"/><span style="display:none">[Diagram: ${filename}]</span></div>`;
    }
  );
  
  // Rewrite image src paths to local assets (handles whitespace/newlines after src=)
  cleaned = cleaned.replace(/src\s*=\s*["']([^"']+)["']/gi, (match, src) => {
    // Check if we have a downloaded image for this path
    const imageInfo = imageMap[src];
    if (imageInfo && imageInfo.filename) {
      return `src="/data/assets/images/${imageInfo.filename}"`;
    }
    // Return original if not in our map (will be broken, but keeps structure)
    return match;
  });
  
  const bodyMatch = cleaned.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  if (bodyMatch) cleaned = bodyMatch[1];
  cleaned = cleaned.replace(/<form[^>]*>/gi, '<div class="content">');
  cleaned = cleaned.replace(/<\/form>/gi, "</div>");
  
  return cleaned.trim();
};

// ============================================================================
// MAIN CRAWLER - Simple approach:
// 1. Expand ALL folders by clicking closed icons until none remain
// 2. Parse the nested table DOM structure to get the tree
// 3. Fetch all leaf documents
// ============================================================================

const crawl = async (page, manifest, globalLeafIds, treeBuilder) => {
  log("Phase 1: Expanding all folders...\n");
  
  let tocFrame = getTocFrame(page);
  if (!tocFrame) {
    log("ERROR: TOC frame not found!");
    return;
  }
  
  // Get form action once
  let formAction = "";
  try {
    formAction = await tocFrame.$eval("form", f => f.action);
  } catch {}
  
  // Step 1: Expand ALL folders by clicking closed icons
  await expandAllFolders(page);
  
  // Re-get TOC frame after expansion
  tocFrame = getTocFrame(page);
  if (!tocFrame) {
    log("ERROR: TOC frame lost after expansion!");
    return;
  }
  
  // Step 2: Parse the tree structure from the DOM
  log("\nPhase 2: Parsing tree structure from DOM...\n");
  
  // Save TOC HTML for debugging
  try {
    const tocHtml = await tocFrame.content();
    fs.writeFileSync(path.join(config.screenshotsDir, "toc-expanded.html"), tocHtml);
    log("Saved expanded TOC HTML for debugging");
  } catch (err) {
    log(`Could not save TOC HTML: ${err.message}`);
  }
  
  const parsedTree = await parseTreeStructure(tocFrame);
  
  // Log debug info
  if (parsedTree.debug) {
    for (const d of parsedTree.debug) {
      log(`DEBUG: ${d}`);
    }
  }
  
  log(`Parsed tree: ${parsedTree.roots.length} roots, ${Object.keys(parsedTree.nodes).length} total nodes`);
  
  // Merge parsed tree into treeBuilder (for multi-filter runs)
  for (const rootId of parsedTree.roots) {
    if (!treeBuilder.roots.includes(rootId)) {
      treeBuilder.roots.push(rootId);
    }
  }
  for (const [nodeId, node] of Object.entries(parsedTree.nodes)) {
    if (!treeBuilder.nodes[nodeId]) {
      treeBuilder.nodes[nodeId] = node;
    }
  }
  
  // Collect all leaf nodes for fetching
  const leafQueue = [];
  for (const [nodeId, node] of Object.entries(parsedTree.nodes)) {
    if (node.isLeaf && !globalLeafIds.has(nodeId)) {
      globalLeafIds.add(nodeId);
      leafQueue.push({
        id: nodeId,
        text: node.title,
        paramName: node.formParams.param1,
        paramValue: node.formParams.param2,
        bookmark: node.formParams.param3,
        formAction,
        parentId: node.parentId,
      });
    }
  }
  
  log(`Found ${leafQueue.length} new leaf documents to fetch\n`);
  log(`\nPhase 3: Fetching ${leafQueue.length} documents...\n`);
  
  // Phase 3: Fetch all documents
  const contentHashes = new Set();
  
  for (let i = 0; i < leafQueue.length; i++) {
    const leaf = leafQueue[i];
    
    const framesetUrl = `${leaf.formAction}&${leaf.paramName}=${leaf.paramValue}&bm=${leaf.bookmark}#${leaf.bookmark}`;
    
    try {
      // Fetch frameset page
      const framesetResponse = await page.request.get(framesetUrl);
      if (!framesetResponse.ok()) {
        log(`[${i+1}/${leafQueue.length}] ✗ ${leaf.text} (HTTP ${framesetResponse.status()})`);
        continue;
      }
      
      const framesetHtml = await framesetResponse.text();
      
      // Extract document iframe URL
      const iframeMatch = framesetHtml.match(/name=["']documentiframepanel["'][^>]*src=["']([^"']+)["']/i) ||
                          framesetHtml.match(/src=["']([^"']+)["'][^>]*name=["']documentiframepanel["']/i);
      
      if (!iframeMatch) {
        log(`[${i+1}/${leafQueue.length}] ✗ ${leaf.text} (no doc iframe)`);
        continue;
      }
      
      // Fetch actual document
      const docUrl = new URL(iframeMatch[1].replace(/&amp;/g, '&'), config.baseUrl).href;
      const docResponse = await page.request.get(docUrl);
      if (!docResponse.ok()) {
        log(`[${i+1}/${leafQueue.length}] ✗ ${leaf.text} (doc HTTP ${docResponse.status()})`);
        continue;
      }
      
      const content = await docResponse.text();
      
      if (content.length < 300) {
        log(`[${i+1}/${leafQueue.length}] ✗ ${leaf.text} (too short)`);
        continue;
      }
      
      const contentHash = hash(content);
      if (contentHashes.has(contentHash)) {
        log(`[${i+1}/${leafQueue.length}] ⊘ ${leaf.text} (duplicate)`);
        continue;
      }
      contentHashes.add(contentHash);
      
      // Extract form ID
      const formIdMatch = content.match(/id="([A-Z0-9]+)"/);
      const formId = formIdMatch ? formIdMatch[1] : hash(docUrl);
      
      // Download CGM assets
      const assets = extractAssets(content);
      const assetMap = {};
      for (const asset of assets) {
        const result = await downloadAsset(page, asset.path, config.assetsDir);
        assetMap[asset.path] = result;
        if (result.filename && !result.cached && !result.error) {
          manifest.assets.push({ type: asset.type, originalPath: asset.path, filename: result.filename });
        }
      }
      
      // Download images (GIF, JPG, PNG, dynamic)
      const images = extractImages(content);
      const imageMap = {};
      for (const imagePath of images) {
        const result = await downloadImage(page, imagePath, config.imagesDir);
        imageMap[imagePath] = result;
        if (result.filename && !result.cached && !result.error) {
          manifest.images = manifest.images || [];
          manifest.images.push({ originalPath: imagePath, filename: result.filename });
        }
      }
      
      // Save files
      const rawFile = `${formId}.html`;
      fs.writeFileSync(path.join(config.rawDir, rawFile), content);
      
      const cleanFile = `${slugify(leaf.text)}-${formId.slice(0,6)}.html`;
      fs.writeFileSync(path.join(config.pagesDir, cleanFile), cleanHtml(content, assetMap, imageMap));
      
      manifest.pages.push({
        id: formId,
        tocId: leaf.id,
        title: leaf.text,
        filename: cleanFile,
        contentHash,
        assetCount: assets.length,
        parentId: leaf.parentId || null,
      });
      
      log(`[${i+1}/${leafQueue.length}] ✓ ${leaf.text}`);
      
      await sleep(config.throttleMs);
    } catch (err) {
      log(`[${i+1}/${leafQueue.length}] ✗ ${leaf.text} (${err.message})`);
    }
  }
};

// ============================================================================
// MAIN
// ============================================================================

const main = async () => {
  for (const dir of [config.pagesDir, config.assetsDir, config.imagesDir, config.rawDir]) {
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true });
  }
  ensureDir(config.outputDir);
  ensureDir(config.pagesDir);
  ensureDir(config.assetsDir);
  ensureDir(config.imagesDir);
  ensureDir(config.rawDir);
  ensureDir(config.screenshotsDir);
  
  log("Starting TIS2Web Scraper V4...\n");
  
  const browser = await chromium.launch({ headless: config.headless });
  const context = await browser.newContext({ 
    viewport: { width: 1400, height: 900 },
    locale: 'en-GB',  // Use English (UK) locale to match user's browser
    extraHTTPHeaders: {
      'Accept-Language': 'en-GB,en;q=0.9'
    }
  });
  const page = await context.newPage();
  
  const manifest = {
    vehicle: config.vehicle,
    crawledAt: new Date().toISOString(),
    pages: [],
    assets: [],
    images: [],
    tree: { roots: [], nodes: {} },  // Tree structure for sidebar
  };
  
  // All filter options from the TIS app
  const filters = [
    { value: "null", name: "No selection (all)" },
    { value: "7", name: "Repair Instructions" },
    { value: "2", name: "Description and Operation" },
    { value: "3", name: "Diagnostic Information and Procedures" },
    { value: "12", name: "Specifications" },
    { value: "13", name: "Technical Information" },
    { value: "1", name: "Component Locator" },
    { value: "4", name: "Inspections" },
    { value: "6", name: "Other Information" },
    { value: "11", name: "Special Tools and Equipment" },
    { value: "15", name: "Warnings, Disclaimers, Safety" },
  ];
  
  try {
    await page.goto(config.baseUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await sleep(500);
    
    await dismissDialogs(page);
    await selectVehicle(page);
    await navigateToAssemblyGroups(page);
    
    await page.screenshot({ path: path.join(config.screenshotsDir, "01-start.png") });
    
    // Global set to track collected leaves across all filter runs
    const globalLeafIds = new Set();
    
    // Tree builder - shared across all filter runs to build complete hierarchy
    const treeBuilder = manifest.tree;
    
    // Use "No Selection" filter to get ALL content at once
    log(`\n======== FILTER: ${filters[0].name} ========\n`);
    
    let tocFrame = getTocFrame(page);
    if (tocFrame) {
      await applyFilter(page, filters[0].value, filters[0].name);
      await sleep(1000);
    }
    
    // Crawl: expand all, parse tree, fetch documents
    await crawl(page, manifest, globalLeafIds, treeBuilder);
    log(`\nComplete: ${manifest.pages.length} pages, tree has ${treeBuilder.roots.length} roots\n`);
    
    // Log tree stats
    log(`Tree structure: ${treeBuilder.roots.length} root folders, ${Object.keys(treeBuilder.nodes).length} total nodes`);
    
    writeJson(path.join(config.outputDir, "manifest.json"), manifest);
    
    await page.screenshot({ path: path.join(config.screenshotsDir, "99-end.png") });
    
    log("\n========================================");
    log(`COMPLETE: ${manifest.pages.length} pages, ${manifest.assets.length} CGM assets, ${manifest.images.length} images`);
    log("========================================");
    
    await sleep(2000);
  } catch (error) {
    log(`ERROR: ${error.message}`);
    console.error(error);
    await page.screenshot({ path: path.join(config.screenshotsDir, "error.png") });
  } finally {
    await browser.close();
  }
};

main().catch(console.error);
