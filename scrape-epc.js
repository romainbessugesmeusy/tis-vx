/**
 * EPC (Electronic Parts Catalog) Scraper
 * 
 * Extracts parts data from the speedsterclub.nl EPC website.
 * 
 * Structure:
 * - Groups (A-R): Body shell and panels, Body exterior fittings, etc.
 * - Sub Sections: Numbered items within each group
 * - Main: Numbered items within each sub section
 * - Parts: Individual parts with Ref, Description, Usage, Range, Qty, Part No, Kat No
 * 
 * Diagrams are shared across multiple parts - each unique diagram is downloaded once.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { chromium } = require("playwright");
const cheerio = require("cheerio");

// ============================================================================
// CONFIGURATION
// ============================================================================

const config = {
  baseUrl: "https://www.speedsterclub.nl/bibliotheek/technische%20documentatie/epc/",
  outputDir: path.join(__dirname, "viewer", "public", "data", "epc"),
  diagramsDir: path.join(__dirname, "viewer", "public", "data", "epc", "diagrams"),
  headless: true,
  throttleMs: 150,
};

// ============================================================================
// UTILITIES
// ============================================================================

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ensureDir = (dir) => fs.mkdirSync(dir, { recursive: true });
const writeJson = (filePath, data) => fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
const log = (msg) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
const hash = (str) => crypto.createHash("md5").update(str).digest("hex").slice(0, 12);

// ============================================================================
// SCRAPING FUNCTIONS
// ============================================================================

/**
 * Fetch page content and return cheerio instance
 */
async function fetchPage(page, url) {
  try {
    const response = await page.request.get(url);
    if (!response.ok()) {
      return null;
    }
    const content = await response.text();
    return cheerio.load(content);
  } catch (err) {
    log(`  Error fetching ${url}: ${err.message}`);
    return null;
  }
}

/**
 * Extract groups from the index page
 */
async function extractGroups(page) {
  const $ = await fetchPage(page, config.baseUrl + "index.html");
  if (!$) return [];
  
  const groups = [];
  const seenIds = new Set();

  // Parse table structure - groups are in cells with images
  $("table td").each((i, td) => {
    const $td = $(td);
    const link = $td.find("a").first();
    const img = link.find("img").first();
    
    if (link.length && img.length) {
      const href = link.attr("href");
      const imgSrc = img.attr("src");
      
      // Extract group letter from image src (e.g., "images/A.png" -> "A")
      const imgMatch = imgSrc ? imgSrc.match(/([A-R])\.png/i) : null;
      const groupId = imgMatch ? imgMatch[1].toUpperCase() : null;
      
      if (groupId && href && !seenIds.has(groupId)) {
        seenIds.add(groupId);
        
        // Find the group name from the header cell above
        const row = $td.closest("tr");
        const prevRow = row.prev("tr");
        const headerCell = prevRow.find("td").eq($td.index());
        const name = headerCell.text().trim() || `Group ${groupId}`;
        
        groups.push({
          id: groupId,
          name: name,
          href: href,
          image: imgSrc,
        });
      }
    }
  });

  return groups.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Extract sub sections from a group page
 */
async function extractSubSections(page, groupUrl) {
  const $ = await fetchPage(page, groupUrl);
  if (!$) return [];
  
  const subSections = [];

  // Sub sections are in table rows with class "listll"
  $("tr.listll").each((i, tr) => {
    const $tr = $(tr);
    const link = $tr.find("a").first();
    
    if (link.length) {
      const href = link.attr("href");
      const text = link.text().trim();
      
      // Parse "N Name" pattern
      const match = text.match(/^(\d+)\s+(.+)$/);
      if (match && href) {
        subSections.push({
          id: match[1],
          name: match[2],
          href: href,
        });
      }
    }
  });

  // Fallback: look for any links with "N Name" pattern
  if (subSections.length === 0) {
    $("a").each((i, a) => {
      const $a = $(a);
      const href = $a.attr("href");
      const text = $a.text().trim();
      
      if (href && !href.includes("index.html") && !href.startsWith("..")) {
        const match = text.match(/^(\d+)\s+(.+)$/);
        if (match) {
          subSections.push({
            id: match[1],
            name: match[2],
            href: href,
          });
        }
      }
    });
  }

  return subSections;
}

/**
 * Check if a page is a parts page (has iframe pointing to parts.html)
 */
function isPartsPage($) {
  const iframe = $("iframe[src*='parts.html']");
  return iframe.length > 0;
}

/**
 * Extract main items from a sub section page
 * Returns { isDirectParts: boolean, mainItems: [] }
 */
async function extractMainItems(page, subSectionUrl) {
  const $ = await fetchPage(page, subSectionUrl);
  if (!$) return { isDirectParts: false, mainItems: [] };
  
  // Check if this is actually a parts page (no main items level)
  if (isPartsPage($)) {
    return { isDirectParts: true, mainItems: [] };
  }
  
  const mainItems = [];

  // Main items are in table rows with class "listll"
  $("tr.listll").each((i, tr) => {
    const $tr = $(tr);
    const link = $tr.find("a").first();
    
    if (link.length) {
      const href = link.attr("href");
      const text = link.text().trim();
      
      // Parse "N Name" pattern
      const match = text.match(/^(\d+)\s+(.+)$/);
      if (match && href) {
        mainItems.push({
          id: match[1],
          name: match[2],
          href: href,
        });
      }
    }
  });

  // Fallback: look for any links with "N Name" pattern
  if (mainItems.length === 0) {
    $("a").each((i, a) => {
      const $a = $(a);
      const href = $a.attr("href");
      const text = $a.text().trim();
      
      if (href && !href.includes("index.html") && !href.startsWith("..")) {
        const match = text.match(/^(\d+)\s+(.+)$/);
        if (match) {
          mainItems.push({
            id: match[1],
            name: match[2],
            href: href,
          });
        }
      }
    });
  }

  return { isDirectParts: false, mainItems };
}

/**
 * Extract parts from a main item's parts.html page
 */
async function extractParts(page, mainUrl, diagrams) {
  // The actual parts are in parts.html, not index.html
  const partsUrl = mainUrl.replace(/index\.html$/, "parts.html").replace(/\/$/, "/parts.html");
  const $ = await fetchPage(page, partsUrl);
  if (!$) return [];
  
  const parts = [];
  
  // Also check for diagram image
  const diagramUrl = mainUrl.replace(/index\.html$/, "image.png").replace(/\/$/, "/image.png");
  const diagramId = hash(diagramUrl);

  // Parts are in table rows with class "listll"
  $("tr.listll").each((i, tr) => {
    const $tr = $(tr);
    const cells = $tr.find("td");
    
    if (cells.length >= 6) {
      const ref = cells.eq(0).text().trim();
      const description = cells.eq(1).text().trim();
      const usage = cells.eq(2).text().trim();
      const range = cells.eq(3).text().trim();
      const qty = cells.eq(4).text().trim();
      const partNo = cells.eq(5).text().trim().replace(/^\(|\)$/g, '').trim();
      const katNo = (cells.eq(6)?.text().trim() || "").replace(/^\(|\)$/g, '').trim();
      
      if (ref && description) {
        parts.push({
          ref: ref,
          description: description,
          usage: usage,
          range: range,
          qty: qty,
          partNo: partNo,
          katNo: katNo,
          diagramId: diagramId,
        });
      }
    }
  });

  // If we found parts, add the diagram
  if (parts.length > 0 && !diagrams[diagramId]) {
    diagrams[diagramId] = {
      originalUrl: diagramUrl,
      filename: null,
    };
  }

  return parts;
}

/**
 * Download a diagram image
 */
async function downloadDiagram(page, diagram, diagramId) {
  if (!diagram.originalUrl || diagram.filename) return;
  
  try {
    const response = await page.request.get(diagram.originalUrl);
    if (response.ok()) {
      const buffer = await response.body();
      
      // Determine file extension from content type or URL
      const contentType = response.headers()["content-type"] || "";
      let ext = "png";
      if (contentType.includes("jpeg") || contentType.includes("jpg")) ext = "jpg";
      else if (contentType.includes("gif")) ext = "gif";
      
      const filename = `${diagramId}.${ext}`;
      const outputPath = path.join(config.diagramsDir, filename);
      
      fs.writeFileSync(outputPath, buffer);
      diagram.filename = filename;
      
      log(`  Downloaded diagram: ${filename}`);
    }
  } catch (err) {
    // Silently skip failed downloads
  }
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  // Ensure output directories exist
  ensureDir(config.outputDir);
  ensureDir(config.diagramsDir);
  
  log("Starting EPC Scraper...\n");
  
  const browser = await chromium.launch({ headless: config.headless });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
  });
  const page = await context.newPage();
  
  const output = {
    scrapedAt: new Date().toISOString(),
    source: config.baseUrl,
    groups: [],
    diagrams: {},
  };
  
  try {
    // Step 1: Extract groups
    log("Extracting groups...");
    const groups = await extractGroups(page);
    log(`Found ${groups.length} groups\n`);
    
    // Step 2: Process each group
    for (const group of groups) {
      log(`\n=== Group ${group.id}: ${group.name} ===`);
      
      const groupData = {
        id: group.id,
        name: group.name,
        image: group.image,
        subSections: [],
      };
      
      const groupUrl = new URL(group.href, config.baseUrl).href;
      
      // Extract sub sections
      const subSections = await extractSubSections(page, groupUrl);
      log(`  Found ${subSections.length} sub sections`);
      
      for (const subSection of subSections) {
        log(`  Sub Section ${subSection.id}: ${subSection.name}`);
        
        const subSectionData = {
          id: `${group.id}${subSection.id}`,
          name: subSection.name,
          main: [],
        };
        
        const subSectionUrl = new URL(subSection.href, groupUrl).href;
        
        // Extract main items (or detect if this is directly a parts page)
        const { isDirectParts, mainItems } = await extractMainItems(page, subSectionUrl);
        
        if (isDirectParts) {
          // This sub-section IS the parts page (no main items level)
          const mainData = {
            id: `${group.id}${subSection.id}-1`,
            name: subSection.name,
            parts: [],
          };
          
          // Extract parts directly from this URL
          const parts = await extractParts(page, subSectionUrl, output.diagrams);
          
          if (parts.length > 0) {
            log(`    Direct parts: ${parts.length} parts`);
          }
          
          mainData.parts = parts;
          subSectionData.main.push(mainData);
        } else {
          // Normal case: has main items
          log(`    Found ${mainItems.length} main items`);
          
          for (const mainItem of mainItems) {
            const mainData = {
              id: `${group.id}${subSection.id}-${mainItem.id}`,
              name: mainItem.name,
              parts: [],
            };
            
            const mainUrl = new URL(mainItem.href, subSectionUrl).href;
            
            // Extract parts
            const parts = await extractParts(page, mainUrl, output.diagrams);
            
            if (parts.length > 0) {
              log(`      ${mainItem.id} ${mainItem.name}: ${parts.length} parts`);
            }
            
            mainData.parts = parts;
            subSectionData.main.push(mainData);
            
            await sleep(config.throttleMs);
          }
        }
        
        groupData.subSections.push(subSectionData);
      }
      
      output.groups.push(groupData);
    }
    
    // Step 3: Download all diagrams
    log("\n=== Downloading diagrams ===");
    const diagramIds = Object.keys(output.diagrams);
    log(`Found ${diagramIds.length} unique diagrams to download`);
    
    for (const diagramId of diagramIds) {
      await downloadDiagram(page, output.diagrams[diagramId], diagramId);
      await sleep(50);
    }
    
    // Step 4: Save output
    const outputPath = path.join(config.outputDir, "parts.json");
    writeJson(outputPath, output);
    
    // Calculate statistics
    let totalParts = 0;
    let totalSubSections = 0;
    let totalMainItems = 0;
    
    for (const group of output.groups) {
      totalSubSections += group.subSections.length;
      for (const subSection of group.subSections) {
        totalMainItems += subSection.main.length;
        for (const main of subSection.main) {
          totalParts += main.parts.length;
        }
      }
    }
    
    log("\n========================================");
    log("COMPLETE!");
    log(`Groups: ${output.groups.length}`);
    log(`Sub Sections: ${totalSubSections}`);
    log(`Main Items: ${totalMainItems}`);
    log(`Parts: ${totalParts}`);
    log(`Diagrams: ${Object.keys(output.diagrams).length}`);
    log(`Output: ${outputPath}`);
    log("========================================");
    
  } catch (error) {
    log(`ERROR: ${error.message}`);
    console.error(error);
  } finally {
    await browser.close();
  }
}

main().catch(console.error);
