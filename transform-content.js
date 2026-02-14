/**
 * TIS2Web Structured Content Transformer
 * 
 * Transforms scraped TIS2Web HTML content into typed JSON documents.
 * Extracts technical references (tools, torque values, glossary terms).
 * Enables faceted navigation beyond the hierarchical tree structure.
 * 
 * @author AI Assistant
 */

const fs = require("fs");
const path = require("path");
const cheerio = require("cheerio");

// ============================================================================
// CONFIGURATION
// ============================================================================

function parseArgs() {
  const inputDir = (() => {
    const idx = process.argv.indexOf("--input");
    if (idx === -1 || !process.argv[idx + 1]) return path.join(__dirname, "output");
    return path.resolve(process.argv[idx + 1]);
  })();
  const outputDir = (() => {
    const idx = process.argv.indexOf("--output");
    if (idx === -1 || !process.argv[idx + 1]) return path.join(__dirname, "viewer", "public", "data");
    return path.resolve(process.argv[idx + 1]);
  })();
  return { inputDir, outputDir };
}

const { inputDir, outputDir: outputBase } = parseArgs();

const config = {
  pagesDir: path.join(inputDir, "pages"),
  assetsDir: path.join(inputDir, "assets"),
  imagesDir: path.join(inputDir, "assets", "images"),
  manifestPath: path.join(inputDir, "manifest.json"),
  outputDir: outputBase,
  contentDir: path.join(outputBase, "content"),
  viewerAssetsDir: path.join(outputBase, "assets"),
  viewerImagesDir: path.join(outputBase, "assets", "images"),
  referencesDir: path.join(outputBase, "references"),
};

// ============================================================================
// CONTENT TYPE DEFINITIONS
// ============================================================================

const ContentType = {
  PROCEDURE: "procedure",
  TSB: "tsb",               // Technical Service Bulletin / Field Remedy
  HARNESS_DIAGRAM: "harness_diagram",
  TORQUE_TABLE: "torque_table",
  TOOL_LIST: "tool_list",
  GLOSSARY: "glossary",
  DIAGNOSTIC: "diagnostic",
  GENERIC: "generic",       // Fallback for unparseable content
};

// Pictogram phases with their icon patterns
const PictogramPhases = {
  remove: { pattern: /7c3d75e8b2c9\.gif/i, label: "Remove" },
  install: { pattern: /6eff4d42a9f9\.gif/i, label: "Install" },
  disassemble: { pattern: /f624612d033b\.gif/i, label: "Disassemble" },
  assemble: { pattern: /1e33bc0b1f5e\.gif/i, label: "Assemble" },
  clean: { pattern: /d9fe69774efb\.gif/i, label: "Clean" },
  inspect: { pattern: /549a1406f8f0\.gif/i, label: "Inspect" },
  measure: { pattern: /707731fa677f\.gif/i, label: "Measure" },
  adjust: { pattern: /8bcc88ed08ca\.gif/i, label: "Adjust" },
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

// ============================================================================
// CONTENT TYPE CLASSIFIER
// ============================================================================

/**
 * Classifies HTML content into one of the defined content types.
 * Uses pattern matching on HTML structure and content.
 * 
 * @param {string} html - Raw HTML content
 * @param {string} filename - Original filename for additional hints
 * @returns {string} - One of ContentType values
 */
function classifyContent(html, filename) {
  const $ = cheerio.load(html);
  const lowerFilename = filename.toLowerCase();
  
  // Check for TSB/Field Remedy (has <pre> blocks with ASCII layout and field-name class)
  const hasPreBlocks = $("pre").length > 3;
  const hasFieldName = $(".field-name").length > 0;
  const hasH1FieldRemedy = $("h1").text().toLowerCase().includes("field remedy");
  if ((hasPreBlocks && hasFieldName) || hasH1FieldRemedy) {
    return ContentType.TSB;
  }
  
  // Check for Harness Diagram (has CGM diagrams and component tables)
  const hasCgmDiagram = $(".diagram").length > 0 || $("img[src*='.cgm']").length > 0;
  const hasComponentTable = $("th:contains('Components')").length > 0;
  const hasGmFigureGroup = $("[data-gm-tag='figure-group'], [data-gm='figure-group']").length > 0;
  if (hasCgmDiagram || hasComponentTable || hasGmFigureGroup) {
    return ContentType.HARNESS_DIAGRAM;
  }
  
  // Check for Torque Table (title contains "torque values" and has bordered table)
  const titleText = $(".title").first().text().toLowerCase();
  if (titleText.includes("torque value") || lowerFilename.includes("torque-value")) {
    return ContentType.TORQUE_TABLE;
  }
  
  // Check for Tool List (title contains "special service tools" or "tools group")
  if (titleText.includes("special service tool") || lowerFilename.includes("special-service-tool")) {
    return ContentType.TOOL_LIST;
  }
  
  // Check for Glossary/Reference pages
  if (titleText.includes("technical abc") || 
      titleText.includes("explanation of pictograms") ||
      titleText.includes("conversion table") ||
      lowerFilename.includes("technical-abc") ||
      lowerFilename.includes("explanation-of-pictograms") ||
      lowerFilename.includes("conversion-table")) {
    return ContentType.GLOSSARY;
  }
  
  // Check for Diagnostic/Test pages (has reference curves, setup files)
  const hasReferenceCurve = $("p:contains('Reference Curve')").length > 0;
  const hasSetupFile = $("p:contains('Setup File')").length > 0;
  const hasTech31 = $("p:contains('Tech 31')").length > 0 || $("p:contains('Tech 32')").length > 0;
  if (hasReferenceCurve || hasSetupFile || hasTech31) {
    return ContentType.DIAGNOSTIC;
  }
  
  // Check for Procedure (has table.mainstep with numbered steps and/or pictogram phases)
  const hasMainstep = $("table.mainstep").length > 0;
  const hasGtPicto = $(".gt-picto").length > 0;
  const hasStepFirstPara = $(".step-first-para").length > 0;
  const hasNumberedSteps = $("td:contains('1.')").length > 0 && $("td:contains('2.')").length > 0;
  
  // Also check for simpler paragraph-based procedures (has gt-picto and multiple paragraphs after)
  const hasParagraphSteps = hasGtPicto && $("p").length > 3;
  
  // Check for procedure keywords in filename
  const hasProcedureKeyword = /replace|remove|install|overhaul|adjust|check|inspect|bleed|drain|fill/i.test(lowerFilename);
  
  // Check for FONT-based phase markers (older format)
  // These have bold FONT tags containing phase keywords like "Remove, Disconnect" or "Install, Connect"
  const hasFontPhaseMarker = $("font").filter((i, el) => {
    const style = $(el).attr("style") || "";
    const text = $(el).text().toLowerCase();
    return style.includes("font-weight: bold") && 
           (text.includes("remove") || text.includes("install") || text.includes("disconnect") || 
            text.includes("connect") || text.includes("disassemble") || text.includes("assemble"));
  }).length > 0;
  
  // Check for 42x42 procedure icons (ICON01.tif, ICON02.tif, etc.)
  const hasProcedureIcons = $("img[height='42'][width='42']").length > 0;
  
  if (hasMainstep || (hasGtPicto && hasStepFirstPara) || (hasNumberedSteps && hasGtPicto) || 
      (hasParagraphSteps && hasProcedureKeyword) ||
      (hasFontPhaseMarker && hasProcedureIcons) ||
      (hasFontPhaseMarker && hasProcedureKeyword)) {
    return ContentType.PROCEDURE;
  }
  
  // Default to generic
  return ContentType.GENERIC;
}

// ============================================================================
// PROCEDURE PARSER
// ============================================================================

/**
 * Parses a procedure HTML document into structured JSON.
 * Extracts phases (Remove/Install/etc.), steps, substeps, images, and callouts.
 * Handles both mainstep table format and simpler paragraph format.
 * 
 * @param {string} html - Raw HTML content
 * @param {string} id - Document ID
 * @returns {Object} - Structured procedure object
 */
function parseProcedure(html, id) {
  const $ = cheerio.load(html);
  
  // Try multiple methods to extract title
  let title = $(".title").first().text().trim();
  
  // Method 2: Look for bold FONT with larger font size (title format in older documents)
  if (!title) {
    $("font").each((i, el) => {
      const style = $(el).attr("style") || "";
      if (style.includes("font-weight: bold") && 
          (style.includes("font-size: 12pt") || style.includes("font-size: 14pt"))) {
        const text = $(el).text().trim();
        // Skip phase labels
        if (text && !text.toLowerCase().includes("remove") && 
            !text.toLowerCase().includes("install") &&
            !text.toLowerCase().includes("disconnect") &&
            !text.toLowerCase().includes("connect")) {
          title = text;
          return false; // Break loop
        }
      }
    });
  }
  
  // Fallback to ID
  if (!title) {
    title = id.replace(/-/g, " ").replace(/AQS\d+$/i, "").trim();
  }
  const phases = [];
  let torqueValues = [];
  let toolsRequired = [];
  let warnings = [];
  let notes = [];
  
  // First, find all phase markers and their positions
  const phaseMarkers = [];
  
  // Method 1: Look for .gt-picto class (newer format)
  $(".gt-picto").each((i, el) => {
    const $el = $(el);
    const phaseLabel = $el.text().trim().toLowerCase();
    const $parent = $el.parent();
    const $prevImg = $parent.find("img").first();
    let phaseIcon = $prevImg.length ? $prevImg.attr("src") : null;
    
    // Determine phase type from label
    let phaseType = "other";
    for (const [key, config] of Object.entries(PictogramPhases)) {
      if (phaseLabel.includes(key)) {
        phaseType = key;
        break;
      }
    }
    
    phaseMarkers.push({
      element: $parent[0],
      phase: phaseType,
      label: phaseLabel.charAt(0).toUpperCase() + phaseLabel.slice(1),
      icon: phaseIcon,
      steps: [],
    });
  });
  
  // Method 2: Look for FONT-based phase markers (older format)
  // These have bold FONT tags like "Remove, Disconnect" or "Install, Connect"
  if (phaseMarkers.length === 0) {
    $("font").each((i, el) => {
      const $el = $(el);
      const style = $el.attr("style") || "";
      const text = $el.text().trim();
      const lowerText = text.toLowerCase();
      
      // Check if this is a phase marker (bold font with phase keywords)
      if (style.includes("font-weight: bold") && 
          (lowerText.includes("remove") || lowerText.includes("install") || 
           lowerText.includes("disconnect") || lowerText.includes("connect") ||
           lowerText.includes("disassemble") || lowerText.includes("assemble") ||
           lowerText.includes("adjust") || lowerText.includes("inspect") ||
           lowerText.includes("clean") || lowerText.includes("measure"))) {
        
        // Find the parent DIV or P containing this marker
        const $parent = $el.closest("div, p");
        
        // Find the associated icon (42x42 img before this font tag)
        let phaseIcon = null;
        const $prevImg = $parent.find("img[height='42'][width='42']").first();
        if ($prevImg.length) {
          phaseIcon = $prevImg.attr("src");
        }
        
        // Determine phase type from label
        let phaseType = "other";
        if (lowerText.includes("remove") || lowerText.includes("disconnect")) {
          phaseType = "remove";
        } else if (lowerText.includes("install") || lowerText.includes("connect")) {
          phaseType = "install";
        } else if (lowerText.includes("disassemble")) {
          phaseType = "disassemble";
        } else if (lowerText.includes("assemble")) {
          phaseType = "assemble";
        } else if (lowerText.includes("adjust")) {
          phaseType = "adjust";
        } else if (lowerText.includes("inspect")) {
          phaseType = "inspect";
        } else if (lowerText.includes("clean")) {
          phaseType = "clean";
        } else if (lowerText.includes("measure")) {
          phaseType = "measure";
        }
        
        // Check if we already have this phase marker (avoid duplicates from multiple FONT tags)
        const existingMarker = phaseMarkers.find(m => m.element === $parent[0]);
        if (!existingMarker) {
          phaseMarkers.push({
            element: $parent[0],
            phase: phaseType,
            label: text.replace(/\s+/g, " ").trim(),
            icon: phaseIcon,
            steps: [],
          });
        }
      }
    });
  }
  
  // If no phases found, create a default one
  if (phaseMarkers.length === 0) {
    phaseMarkers.push({
      element: null,
      phase: "general",
      label: "Procedure",
      icon: null,
      steps: [],
    });
  }
  
  // Copy to phases array
  phaseMarkers.forEach(pm => {
    phases.push({
      phase: pm.phase,
      label: pm.label,
      icon: pm.icon,
      steps: pm.steps,
    });
  });
  
  // Build a map of images by their container for association with steps
  const imageMap = new Map();
  $("table").each((i, table) => {
    const $table = $(table);
    const $imgCell = $table.find("> tr > td[align='right'], > tbody > tr > td[align='right']").first();
    if ($imgCell.length) {
      const $img = $imgCell.find("img[src*='images']").not("[src*='.gif']").first();
      if ($img.length) {
        const imgData = {
          src: $img.attr("src"),
          alt: $img.attr("alt") || "",
        };
        // Associate with the content cell
        const $contentCell = $table.find("> tr > td[width='90%'], > tr > td[width='95%'], > tbody > tr > td[width='90%'], > tbody > tr > td[width='95%']").first();
        if ($contentCell.length) {
          imageMap.set($contentCell[0], imgData);
        }
        // Also associate with the table itself
        imageMap.set(table, imgData);
      }
    }
  });
  
  // Helper to find the current phase for an element based on DOM position
  const findPhaseForElement = (el) => {
    if (phaseMarkers.length <= 1) return 0;
    
    // Get all elements in document order
    const allElements = $("*").toArray();
    const elIndex = allElements.indexOf(el);
    
    // Find the last phase marker before this element
    let lastPhaseIndex = 0;
    for (let i = phaseMarkers.length - 1; i >= 0; i--) {
      const markerIndex = allElements.indexOf(phaseMarkers[i].element);
      if (markerIndex !== -1 && markerIndex < elIndex) {
        lastPhaseIndex = i;
        break;
      }
    }
    return lastPhaseIndex;
  };
  
  // Parse mainstep tables (numbered step format)
  let stepCounter = 0;
  $("table.mainstep").each((i, table) => {
    const $table = $(table);
    const $rows = $table.find("> tr, > tbody > tr");
    
    // Find which phase this table belongs to
    const phaseIndex = findPhaseForElement(table);
    
    // Find associated image from parent wrapper table
    let tableImage = null;
    let $wrapper = $table.parent().closest("table").not(".mainstep");
    while ($wrapper.length && !tableImage) {
      if (imageMap.has($wrapper[0])) {
        tableImage = imageMap.get($wrapper[0]);
        break;
      }
      // Also check direct parent cell
      const $parentCell = $table.parent("td");
      if ($parentCell.length && imageMap.has($parentCell[0])) {
        tableImage = imageMap.get($parentCell[0]);
        break;
      }
      $wrapper = $wrapper.parent().closest("table");
    }
    
    $rows.each((ri, row) => {
      const $row = $(row);
      const $stepCell = $row.find(".step-first-para").first();
      
      if ($stepCell.length) {
        const stepText = $stepCell.text().trim();
        const stepMatch = stepText.match(/^(\d+)\.\s*$/);
        
        if (stepMatch) {
          stepCounter++;
          const stepNumber = parseInt(stepMatch[1]);
          const $contentCell = $stepCell.next("td");
          
          // Extract step text
          let stepMainText = "";
          $contentCell.contents().each((ci, node) => {
            if (node.type === "text") {
              stepMainText += node.data;
            } else if (node.name === "br") {
              stepMainText += " ";
            } else if (node.name === "span") {
              stepMainText += $(node).text();
            } else if (node.name !== "table") {
              return false;
            }
          });
          stepMainText = stepMainText.replace(/\s+/g, " ").trim();
          
          // Extract substeps
          const substeps = [];
          $contentCell.find("> table").each((si, subTable) => {
            const $subRow = $(subTable).find("tr").first();
            const bullet = $subRow.find(".step-first-para").text().trim();
            const subText = $subRow.find("td").last().text().trim();
            
            if (bullet && subText) {
              const subSubsteps = [];
              $(subTable).find("> tr > td > table, > tbody > tr > td > table").each((ssi, subSubTable) => {
                const $ssRow = $(subSubTable).find("tr").first();
                const ssBullet = $ssRow.find(".step-first-para").text().trim();
                const ssText = $ssRow.find("td").last().text().trim();
                if (ssBullet && ssText) {
                  subSubsteps.push({ bullet: ssBullet, text: ssText });
                }
              });
              
              // Clean up bullet (remove redundant dashes)
              const cleanBullet = bullet.replace(/[•\-–]\s*[•\-–]/g, '•').trim();
              const cleanSubText = subText.split("\n")[0].trim();
              
              // Filter out sub-substeps that have the same text as their parent
              // (This happens when the HTML structure duplicates content)
              const filteredSubSubsteps = subSubsteps.filter(ss => 
                ss.text.toLowerCase() !== cleanSubText.toLowerCase()
              );
              
              substeps.push({
                bullet: cleanBullet,
                text: cleanSubText,
                substeps: filteredSubSubsteps.length > 0 ? filteredSubSubsteps : undefined,
              });
            }
          });
          
          // Extract callouts
          const calloutMatches = stepMainText.match(/\((\d+)\)/g) || [];
          const callouts = calloutMatches.map(m => m.replace(/[()]/g, ""));
          
          // Extract torque values
          $contentCell.find(".tech-spec").each((ti, spec) => {
            const specText = $(spec).text().trim();
            const torqueMatch = specText.match(/(\d+(?:\.\d+)?)\s*(Nm|N·m)/i);
            if (torqueMatch) {
              torqueValues.push({
                component: stepMainText,
                value: torqueMatch[1],
                unit: "Nm",
                stepRef: stepNumber,
              });
            }
          });
          
          // Extract tool references
          $contentCell.find(".tool").each((ti, tool) => {
            const toolCode = $(tool).text().trim();
            if (!toolsRequired.includes(toolCode)) {
              toolsRequired.push(toolCode);
            }
          });
          
          // Extract warnings and notes
          $contentCell.find(".gt-important").each((wi, warn) => {
            const warnText = $(warn).parent().text().replace(/Important:\s*/i, "").trim();
            if (warnText && !warnings.includes(warnText)) {
              warnings.push(warnText);
            }
          });
          
          $contentCell.find(".gt-notice").each((ni, note) => {
            const noteText = $(note).parent().text().replace(/Note:\s*/i, "").trim();
            if (noteText && !notes.includes(noteText)) {
              notes.push(noteText);
            }
          });
          
          phases[phaseIndex].steps.push({
            number: stepNumber,
            text: stepMainText,
            substeps: substeps.length > 0 ? substeps : undefined,
            image: tableImage,
            callouts: callouts.length > 0 ? callouts : undefined,
          });
        }
      }
      
      // Check for Important/Note in non-step rows
      const $important = $row.find(".gt-important");
      if ($important.length) {
        const warnText = $row.text().replace(/Important:\s*/i, "").trim();
        if (warnText && !warnings.includes(warnText)) {
          warnings.push(warnText);
        }
      }
    });
  });
  
  // If no mainstep tables found, try parsing paragraph-based or DIV-based procedures
  if (stepCounter === 0) {
    let paragraphStepNum = 0;
    
    const $contentArea = $(".content").first();
    if ($contentArea.length) {
      
      // Method A: DIV-based format with FONT tags (older TIS format)
      // Each DIV is a self-contained section with its own phase marker and steps
      const hasDivFormat = $contentArea.find("div img[height='42'][width='42']").length > 0;
      
      if (hasDivFormat) {
        // Clear pre-detected phases and rebuild from DIV structure
        phases.length = 0;
        let lastPhaseType = null;
        let currentPhase = null;
        
        const $divs = $contentArea.find("> td > div, div");
        $divs.each((i, div) => {
          const $div = $(div);
          
          // Check if this DIV has a phase marker (42x42 icon + bold FONT)
          const $icon = $div.find("img[height='42'][width='42']").first();
          const $boldFont = $div.find("font[style*='font-weight: bold']").first();
          
          if ($icon.length && $boldFont.length) {
            const phaseText = $boldFont.text().trim();
            const lowerPhaseText = phaseText.toLowerCase();
            
            // Determine phase type
            let phaseType = "other";
            if (lowerPhaseText.includes("remove") || lowerPhaseText.includes("disconnect")) {
              phaseType = "remove";
            } else if (lowerPhaseText.includes("install") || lowerPhaseText.includes("connect")) {
              phaseType = "install";
            } else if (lowerPhaseText.includes("disassemble")) {
              phaseType = "disassemble";
            } else if (lowerPhaseText.includes("assemble")) {
              phaseType = "assemble";
            } else if (lowerPhaseText.includes("adjust")) {
              phaseType = "adjust";
            } else if (lowerPhaseText.includes("inspect")) {
              phaseType = "inspect";
            } else if (lowerPhaseText.includes("clean")) {
              phaseType = "clean";
            } else if (lowerPhaseText.includes("measure")) {
              phaseType = "measure";
            }
            
            // Only create a new phase if the phase type changed
            if (phaseType !== lastPhaseType || !currentPhase) {
              currentPhase = {
                phase: phaseType,
                label: phaseText.replace(/\s+/g, " "),
                icon: $icon.attr("src"),
                steps: [],
              };
              phases.push(currentPhase);
              lastPhaseType = phaseType;
            }
          }
          
          // If no phase yet, create a default one
          if (!currentPhase) {
            currentPhase = {
              phase: "general",
              label: "Procedure",
              icon: null,
              steps: [],
            };
            phases.push(currentPhase);
          }
          
          // Find image in this DIV (in td[align='right'])
          let divImage = null;
          const $img = $div.find("td[align='right'] img[src*='images']").not("[height='42']").first();
          if ($img.length) {
            divImage = {
              src: $img.attr("src"),
              alt: $img.attr("alt") || "",
            };
          }
          
          // Find step paragraphs in this DIV - only P tags, not FONT (FONT is inside P)
          const $stepContainer = $div.find("td[valign='top']").not("[align='right']").first();
          const $paragraphs = $stepContainer.length ? $stepContainer.find("> p") : $div.find("> p");
          
          let imageUsed = false;
          $paragraphs.each((pi, p) => {
            const $p = $(p);
            let text = $p.text().replace(/\u00A0/g, " ").replace(/\s+/g, " ").trim();
            
            // Skip if too short or just whitespace
            if (!text || text.length < 5) return;
            
            // Skip phase labels (contains phase keywords at start or standalone)
            const lowerText = text.toLowerCase();
            if (lowerText === "remove, disconnect" || lowerText === "install, connect" ||
                lowerText === "remove" || lowerText === "install" ||
                lowerText === "disassemble" || lowerText === "assemble" ||
                lowerText === "adjust" || lowerText === "inspect" ||
                lowerText === "clean" || lowerText === "measure") {
              return;
            }
            
            // Skip title-like text (check for 18pt font size in contained elements)
            const hasLargeFontTitle = $p.find("font[style*='font-size: 18pt']").length > 0;
            if (hasLargeFontTitle) return;
            
            // Skip if this P contains the phase icon
            if ($p.find("img[height='42']").length > 0) return;
            
            paragraphStepNum++;
            
            // Extract callouts
            const calloutMatches = text.match(/\((\d+)\)/g) || [];
            const callouts = calloutMatches.map(m => m.replace(/[()]/g, ""));
            
            // Check for inline torque values
            const inlineTorque = text.match(/(\d+(?:\.\d+)?)\s*(Nm|N·m)/i);
            if (inlineTorque) {
              const exists = torqueValues.some(tv => tv.value === inlineTorque[1]);
              if (!exists) {
                torqueValues.push({
                  component: text,
                  value: inlineTorque[1],
                  unit: "Nm",
                  stepRef: paragraphStepNum,
                });
              }
            }
            
            currentPhase.steps.push({
              number: paragraphStepNum,
              text: text,
              image: !imageUsed ? divImage : null,
              callouts: callouts.length > 0 ? callouts : undefined,
            });
            
            imageUsed = true; // Only first step in DIV gets the image
          });
        });
      }
      
      // Method B: Simple P-based format (for .gt-picto style procedures)
      if (paragraphStepNum === 0) {
        let currentPhaseIdx = 0;
        let currentImage = null;
        
        $contentArea.find("p, table, img").each((i, el) => {
          const $el = $(el);
          
          // Check if this is a phase marker paragraph
          if ($el.find(".gt-picto").length > 0) {
            // Match the phase by comparing labels
            const markerLabel = $el.find(".gt-picto").text().trim().toLowerCase();
            for (let pi = 0; pi < phases.length; pi++) {
              const phaseLabel = phases[pi].label.toLowerCase();
              if (phaseLabel.includes(markerLabel) || markerLabel.includes(phases[pi].phase)) {
                currentPhaseIdx = pi;
                break;
              }
            }
            return;
          }
          
          // Check for images in tables
          if (el.name === "table") {
            const $img = $el.find("img[src*='images']").not("[src*='.gif']").not("[height='42']").first();
            if ($img.length) {
              currentImage = {
                src: $img.attr("src"),
                alt: $img.attr("alt") || "",
              };
            }
            return;
          }
          
          // Check for standalone images
          if (el.name === "img" && $el.attr("src") && !$el.attr("src").includes(".gif") && 
              $el.attr("height") !== "42") {
            currentImage = {
              src: $el.attr("src"),
              alt: $el.attr("alt") || "",
            };
            return;
          }
          
          // Process content paragraphs
          if (el.name === "p" && !$el.hasClass("title") && !$el.find(".gt-picto").length) {
            const text = $el.text().replace(/\u00A0/g, " ").replace(/\s+/g, " ").trim();
            if (text && text.length > 5) {
              paragraphStepNum++;
              
              const calloutMatches = text.match(/\((\d+)\)/g) || [];
              const callouts = calloutMatches.map(m => m.replace(/[()]/g, ""));
              
              const inlineTorque = text.match(/(\d+(?:\.\d+)?)\s*(Nm|N·m)/i);
              if (inlineTorque) {
                const exists = torqueValues.some(tv => tv.value === inlineTorque[1]);
                if (!exists) {
                  torqueValues.push({
                    component: text,
                    value: inlineTorque[1],
                    unit: "Nm",
                    stepRef: paragraphStepNum,
                  });
                }
              }
              
              if (currentPhaseIdx < phases.length) {
                phases[currentPhaseIdx].steps.push({
                  number: paragraphStepNum,
                  text: text,
                  image: currentImage,
                  callouts: callouts.length > 0 ? callouts : undefined,
                });
              }
              
              currentImage = null;
            }
          }
        });
      }
    }
  }
  
  // Also check for inline torque values outside steps
  $(".tech-spec").each((i, spec) => {
    const $spec = $(spec);
    const specText = $spec.text().trim();
    const torqueMatch = specText.match(/(\d+(?:\.\d+)?)\s*(Nm|N·m)/i);
    if (torqueMatch) {
      const context = $spec.parent().text().replace(/\s+/g, " ").trim();
      const exists = torqueValues.some(tv => 
        tv.value === torqueMatch[1] && tv.component.includes(context.substring(0, 20))
      );
      if (!exists) {
        torqueValues.push({
          component: context,
          value: torqueMatch[1],
          unit: "Nm",
          stepRef: null,
        });
      }
    }
  });
  
  // Deduplicate torque values (same value + same step ref = duplicate)
  const uniqueTorqueValues = [];
  const seenTorque = new Set();
  for (const tv of torqueValues) {
    const key = `${tv.value}-${tv.unit}-${tv.stepRef || 'null'}`;
    if (!seenTorque.has(key)) {
      seenTorque.add(key);
      uniqueTorqueValues.push(tv);
    }
  }

  return {
    type: ContentType.PROCEDURE,
    id: id,
    title: title,
    phases: phases,
    torqueValues: uniqueTorqueValues.length > 0 ? uniqueTorqueValues : undefined,
    toolsRequired: toolsRequired.length > 0 ? toolsRequired : undefined,
    warnings: warnings.length > 0 ? warnings : undefined,
    notes: notes.length > 0 ? notes : undefined,
  };
}

// ============================================================================
// TSB (TECHNICAL SERVICE BULLETIN) PARSER
// ============================================================================

/**
 * Parses a TSB/Field Remedy HTML document into structured JSON.
 * Handles ASCII-formatted <pre> blocks.
 * 
 * @param {string} html - Raw HTML content
 * @param {string} id - Document ID
 * @returns {Object} - Structured TSB object
 */
function parseTSB(html, id) {
  const $ = cheerio.load(html);
  
  // Extract metadata fields
  const getFieldValue = (fieldName) => {
    const $field = $(`.field-name:contains('${fieldName}')`).first();
    if ($field.length) {
      const $valueCell = $field.next(".field-text, .problem-text");
      if ($valueCell.length) {
        return $valueCell.text().trim();
      }
    }
    return null;
  };
  
  const title = $("h1").first().text().trim() || $(".title").first().text().trim() || id;
  const subject = getFieldValue("Subject");
  const models = getFieldValue("Models");
  const engines = getFieldValue("Engines");
  const complaint = getFieldValue("Complaint");
  const cause = getFieldValue("Cause");
  const production = getFieldValue("Production");
  const functionalGroup = getFieldValue("FunctionalGroup");
  const complaintGroup = getFieldValue("Complaint Group");
  const troubleCode = getFieldValue("Trouble Code");
  
  // Helper to parse ASCII table rows with | separators
  const parseTableRow = (text) => {
    // Remove divider lines
    const cleanText = text.replace(/[_\-=]{5,}/g, '').trim();
    if (!cleanText) return null;
    
    // Split by | and collect into description and action
    // Format: | Description content | Action content |
    const lines = cleanText.split('\n');
    let descParts = [];
    let actionParts = [];
    
    for (const line of lines) {
      const parts = line.split('|').map(p => p.trim()).filter(p => p);
      if (parts.length >= 2) {
        descParts.push(parts[0]);
        actionParts.push(parts.slice(1).join(' '));
      } else if (parts.length === 1) {
        // Continuation line - add to whichever is more appropriate
        actionParts.push(parts[0]);
      }
    }
    
    const description = descParts.join(' ').replace(/\s+/g, ' ').trim();
    const action = actionParts.join(' ').replace(/\s+/g, ' ').trim();
    
    if (description || action) {
      return { description, action };
    }
    return null;
  };
  
  // Collect all content in order to build structured remedy
  const remedyContent = [];
  let foundRemedyHeader = false;
  let foundPartsSection = false;
  let foundLabourSection = false;
  
  // For diagnosis tables, collect by category
  let diagnosisTable = null;
  let currentCategory = null;
  let currentRowBuffer = [];
  
  const flushRowBuffer = () => {
    if (currentRowBuffer.length > 0 && currentCategory) {
      // Join multi-line row and parse
      const fullText = currentRowBuffer.join('\n');
      const row = parseTableRow(fullText);
      if (row && row.description) {
        if (!diagnosisTable) {
          diagnosisTable = { categories: [] };
        }
        let cat = diagnosisTable.categories.find(c => c.name === currentCategory);
        if (!cat) {
          cat = { name: currentCategory, rows: [] };
          diagnosisTable.categories.push(cat);
        }
        cat.rows.push(row);
      }
      currentRowBuffer = [];
    }
  };
  
  // Get all content elements in document order
  $("h2.remedy, pre, p").each((i, el) => {
    const $el = $(el);
    const tagName = el.name;
    const text = $el.text();
    
    // Track when we've passed the Remedy header
    if (tagName === "h2" && $el.hasClass("remedy")) {
      foundRemedyHeader = true;
      return;
    }
    
    // Stop at parts/labour sections
    if (text.includes("Spare-Parts:") || text.includes("Part-No.:")) {
      flushRowBuffer();
      foundPartsSection = true;
      return;
    }
    if (text.includes("Labour Times:")) {
      flushRowBuffer();
      foundLabourSection = true;
      return;
    }
    
    // Skip if we're in parts/labour section
    if (foundPartsSection || foundLabourSection) return;
    
    // Capture content after Remedy header
    if (!foundRemedyHeader) return;
    
    const trimmedText = text.trim();
    if (!trimmedText) return;
    
    // Check for divider lines only
    if (trimmedText.match(/^[_\-=]+$/)) {
      flushRowBuffer();
      return;
    }
    
    // Check for diagnosis table header (has "Description" and "Action" or similar)
    if (trimmedText.includes('Description') && trimmedText.includes('Action') && trimmedText.includes('Mode')) {
      // Start of diagnosis table - skip the header line
      return;
    }
    
    // Check for category headers - must be short (< 40 chars), end with :, and be a standalone label
    // NOT match things like "Most turbocharger failures are caused by one of the three basic reasons:"
    const categoryMatch = trimmedText.match(/^([A-Za-z][A-Za-z\s,]*):?\s*$/);
    const isLikelyCategoryHeader = categoryMatch && 
                                   !trimmedText.includes('|') && 
                                   trimmedText.length < 40 &&
                                   !trimmedText.includes(' are ') &&
                                   !trimmedText.includes(' is ') &&
                                   !trimmedText.includes(' the ');
    if (isLikelyCategoryHeader) {
      flushRowBuffer();
      currentCategory = categoryMatch[1].trim().replace(/:$/, '');
      return;
    }
    
    // Check for table row (contains |)
    if (trimmedText.includes('|')) {
      // If this starts a new row (first | near start of line), flush previous
      const firstPipe = trimmedText.indexOf('|');
      if (firstPipe < 15) {
        flushRowBuffer();
      }
      currentRowBuffer.push(trimmedText);
      return;
    }
    
    // If we're in a table row buffer (continuation without |), add to it
    if (currentRowBuffer.length > 0 && currentCategory) {
      // Check if this looks like a continuation (starts with whitespace or is short)
      if (trimmedText.match(/^\s/) || trimmedText.length < 40) {
        currentRowBuffer.push(trimmedText);
        return;
      }
    }
    
    // Regular content - add to remedyContent
    flushRowBuffer();
    
    if (tagName === "pre") {
      if (trimmedText.match(/^\s*[•\-\*]\s/m)) {
        // Bullet list
        const items = trimmedText.split('\n')
          .map(line => line.replace(/^\s*[•\-\*]\s*/, '').trim())
          .filter(line => line);
        remedyContent.push({ type: "bullets", items: items });
      } else if (trimmedText.match(/^\s*\d+\.\s/m)) {
        // Numbered list
        const items = trimmedText.split('\n')
          .map(line => line.replace(/^\s*\d+\.\s*/, '').trim())
          .filter(line => line);
        remedyContent.push({ type: "numbered", items: items });
      } else {
        // Plain text
        remedyContent.push({ type: "text", text: trimmedText });
      }
    } else if (tagName === "p") {
      // Check if this is a category header for diagnosis table
      // Only treat short text ending with : as category if we already have a category
      // (meaning we're in a diagnosis table context)
      const pCategoryMatch = trimmedText.match(/^([^.!?]{3,50}):$/);
      if (pCategoryMatch && currentCategory !== null) {
        // This is a new category in an ongoing diagnosis table
        flushRowBuffer();
        currentCategory = pCategoryMatch[1].trim();
      } else if (pCategoryMatch && trimmedText.length < 50 && 
                 (trimmedText.toLowerCase().includes('power') || 
                  trimmedText.toLowerCase().includes('acceleration') ||
                  trimmedText.toLowerCase().includes('noise') ||
                  trimmedText.toLowerCase().includes('leak'))) {
        // This looks like a diagnosis category header
        flushRowBuffer();
        currentCategory = pCategoryMatch[1].trim();
      } else {
        remedyContent.push({ type: "paragraph", text: trimmedText });
      }
    }
  });
  
  // Flush any remaining buffer
  flushRowBuffer();
  
  // Add diagnosis table to content if we found one
  if (diagnosisTable && diagnosisTable.categories.length > 0) {
    remedyContent.push({ type: "diagnosis_table", table: diagnosisTable });
  }
  
  // Extract parts list
  const parts = [];
  let inPartsSection = false;
  $("pre").each((i, pre) => {
    const text = $(pre).text();
    if (text.includes("Spare-Parts:") || text.includes("Part-No.:")) {
      inPartsSection = true;
    } else if (inPartsSection) {
      const partMatch = text.match(/^(.+?)\s{2,}(\d+)\s{2,}([\d\s]+)/);
      if (partMatch) {
        parts.push({
          name: partMatch[1].trim(),
          partNumber: partMatch[2].trim(),
          catalogueNumber: partMatch[3].trim(),
        });
      } else if (text.includes("Labour Times:")) {
        inPartsSection = false;
      }
    }
  });
  
  // Extract labour times
  const labourTimes = [];
  let inLabourSection = false;
  $("pre").each((i, pre) => {
    const text = $(pre).text();
    if (text.includes("Labour Times:")) {
      inLabourSection = true;
    } else if (inLabourSection) {
      const labourMatch = text.match(/([A-Z]\d+\s+\d+\s+\d+)\s+(.+?)\s+(\d+)\s+([\d.]+)/);
      if (labourMatch) {
        labourTimes.push({
          code: labourMatch[1].trim(),
          description: labourMatch[2].trim(),
          tc: labourMatch[3].trim(),
          hours: parseFloat(labourMatch[4]),
        });
      }
    }
  });
  
  // Extract images
  const images = [];
  $("img[src*='images']").each((i, img) => {
    const src = $(img).attr("src");
    if (src && !src.includes(".gif")) {
      images.push({ src: src, alt: $(img).attr("alt") || "" });
    }
  });
  
  return {
    type: ContentType.TSB,
    id: id,
    title: title,
    subject: subject,
    metadata: {
      models: models,
      engines: engines,
      functionalGroup: functionalGroup,
      complaintGroup: complaintGroup,
      troubleCode: troubleCode,
    },
    complaint: complaint,
    cause: cause,
    production: production,
    remedyContent: remedyContent.length > 0 ? remedyContent : undefined,
    parts: parts.length > 0 ? parts : undefined,
    labourTimes: labourTimes.length > 0 ? labourTimes : undefined,
    images: images.length > 0 ? images : undefined,
  };
}

// ============================================================================
// HARNESS DIAGRAM PARSER
// ============================================================================

/**
 * Parses a harness/wiring diagram HTML document into structured JSON.
 * Extracts component tables and CGM diagram references.
 * 
 * @param {string} html - Raw HTML content
 * @param {string} id - Document ID
 * @returns {Object} - Structured diagram object
 */
function parseHarnessDiagram(html, id) {
  const $ = cheerio.load(html);
  
  const title = $("b").first().text().trim() || $(".title").first().text().trim() || id;
  
  // Extract diagram reference
  let diagram = null;
  const $diagramImg = $(".diagram img, img[src*='.cgm']").first();
  if ($diagramImg.length) {
    diagram = {
      src: $diagramImg.attr("src"),
      type: "cgm",
    };
  }
  
  // Extract component list
  const components = [];
  $("table[cellpadding='5'] tr, table th:contains('Components')").closest("table").find("tr").each((i, row) => {
    const $cells = $(row).find("td");
    if ($cells.length >= 2) {
      // Components are in pairs: code, description, code, description
      for (let ci = 0; ci < $cells.length; ci += 2) {
        const code = $($cells[ci]).text().trim();
        const description = $($cells[ci + 1]).text().trim();
        if (code && description && code.match(/^[A-Z]\d+/)) {
          components.push({ code: code, description: description });
        }
      }
    }
  });
  
  // Extract location information
  const locations = [];
  $("table[bgcolor='linen'] tr, th:contains('Location')").closest("table").find("tr").each((i, row) => {
    const text = $(row).text().trim();
    if (text && !text.includes("Components") && !text.includes("Location")) {
      locations.push(text);
    }
  });
  
  return {
    type: ContentType.HARNESS_DIAGRAM,
    id: id,
    title: title,
    diagram: diagram,
    components: components.length > 0 ? components : undefined,
    locations: locations.length > 0 ? locations : undefined,
  };
}

// ============================================================================
// TORQUE TABLE PARSER
// ============================================================================

/**
 * Parses a torque values table HTML document into structured JSON.
 * 
 * @param {string} html - Raw HTML content
 * @param {string} id - Document ID
 * @returns {Object} - Structured torque table object
 */
function parseTorqueTable(html, id) {
  const $ = cheerio.load(html);
  
  const title = $(".title").first().text().trim() || id;
  
  // Extract group from title
  const groupMatch = title.match(/Group\s+([A-Z])/i);
  const group = groupMatch ? groupMatch[1].toUpperCase() : null;
  
  // Extract torque values from table
  const values = [];
  $("table.border-all tr").each((i, row) => {
    const $cells = $(row).find("td");
    if ($cells.length >= 2) {
      const component = $($cells[0]).text().trim();
      const value = $($cells[1]).text().trim();
      
      // Skip header row
      if (component && value && !component.toLowerCase().includes("nm") && value !== "Nm") {
        const numericValue = value.match(/(\d+(?:\.\d+)?)/);
        if (numericValue) {
          values.push({
            component: component,
            value: numericValue[1],
            unit: "Nm",
          });
        }
      }
    }
  });
  
  return {
    type: ContentType.TORQUE_TABLE,
    id: id,
    title: title,
    group: group,
    values: values,
  };
}

// ============================================================================
// TOOL LIST PARSER
// ============================================================================

/**
 * Parses a special service tools HTML document into structured JSON.
 * 
 * @param {string} html - Raw HTML content
 * @param {string} id - Document ID
 * @returns {Object} - Structured tool list object
 */
function parseToolList(html, id) {
  const $ = cheerio.load(html);
  
  const title = $(".title").first().text().trim() || id;
  
  // Extract group from title
  const groupMatch = title.match(/Group\s+([A-Z])/i);
  const group = groupMatch ? groupMatch[1].toUpperCase() : null;
  
  // Extract tools from table
  const tools = [];
  let currentTool = null;
  
  $("table.border-none tr").each((i, row) => {
    const $cells = $(row).find("td");
    
    if ($cells.length >= 2) {
      const firstCell = $($cells[0]).text().trim();
      const secondCell = $($cells[1]).text().trim();
      
      // Check if this is a tool code row (format: KM-### or MKM-###)
      if (firstCell.match(/^[KM]{1,3}-\d+/)) {
        if (currentTool) {
          tools.push(currentTool);
        }
        currentTool = {
          code: firstCell,
          name: secondCell,
          description: null,
        };
      } else if ($cells.attr("colspan") === "2" && currentTool) {
        // Description row
        currentTool.description = $($cells[0]).text().trim();
      }
    }
  });
  
  // Add last tool
  if (currentTool) {
    tools.push(currentTool);
  }
  
  // Extract tool image if present
  let image = null;
  const $img = $("img[src*='images']").not("[src*='.gif']").first();
  if ($img.length) {
    image = { src: $img.attr("src"), alt: $img.attr("alt") || "" };
  }
  
  return {
    type: ContentType.TOOL_LIST,
    id: id,
    title: title,
    group: group,
    tools: tools,
    image: image,
  };
}

// ============================================================================
// GLOSSARY PARSER
// ============================================================================

/**
 * Parses a glossary/reference HTML document into structured JSON.
 * 
 * @param {string} html - Raw HTML content
 * @param {string} id - Document ID
 * @returns {Object} - Structured glossary object
 */
function parseGlossary(html, id) {
  const $ = cheerio.load(html);
  
  const title = $(".title").first().text().trim() || id;
  
  // Check what type of glossary this is
  const lowerTitle = title.toLowerCase();
  
  if (lowerTitle.includes("pictogram")) {
    // Parse pictograms
    const pictograms = [];
    $("p").each((i, p) => {
      const $p = $(p);
      const $img = $p.find("img").first();
      const $label = $p.find(".gt-picto").first();
      
      if ($img.length && $label.length) {
        const nextP = $p.next("p");
        pictograms.push({
          icon: $img.attr("src"),
          label: $label.text().trim(),
          description: nextP.length ? nextP.text().trim() : null,
        });
      }
    });
    
    return {
      type: ContentType.GLOSSARY,
      subtype: "pictograms",
      id: id,
      title: title,
      items: pictograms,
    };
  } else if (lowerTitle.includes("conversion")) {
    // Parse conversion table
    const conversions = [];
    $("table.border-none tr").each((i, row) => {
      const $cells = $(row).find("td");
      if ($cells.length >= 7) {
        const from = $($cells[0]).text().trim();
        const to = $($cells[2]).text().trim();
        const factor = $($cells[6]).text().trim();
        
        if (from && to && factor) {
          conversions.push({ from: from, to: to, factor: factor });
        }
      }
    });
    
    return {
      type: ContentType.GLOSSARY,
      subtype: "conversions",
      id: id,
      title: title,
      items: conversions,
    };
  } else {
    // Parse general glossary (Technical ABC)
    const terms = [];
    $("li").each((i, li) => {
      const $li = $(li);
      const text = $li.clone().children("ul").remove().end().text().trim();
      const links = [];
      
      $li.find("a").each((ai, a) => {
        const href = $(a).attr("href");
        if (href && href.includes("TFormSubmit")) {
          links.push(href);
        }
      });
      
      if (text) {
        terms.push({
          term: text.split(",")[0].trim(),
          description: text,
          links: links.length > 0 ? links : undefined,
        });
      }
    });
    
    return {
      type: ContentType.GLOSSARY,
      subtype: "terms",
      id: id,
      title: title,
      items: terms.slice(0, 100), // Limit for large glossaries
      totalItems: terms.length,
    };
  }
}

// ============================================================================
// DIAGNOSTIC PARSER
// ============================================================================

/**
 * Parses a diagnostic/test procedure HTML document into structured JSON.
 * 
 * @param {string} html - Raw HTML content
 * @param {string} id - Document ID
 * @returns {Object} - Structured diagnostic object
 */
function parseDiagnostic(html, id) {
  const $ = cheerio.load(html);
  
  const title = $(".title").first().text().trim() || id;
  
  // Extract sections
  const sections = {};
  $(".topic").each((i, topic) => {
    const $topic = $(topic);
    const sectionTitle = $topic.text().trim().replace(":", "");
    const $nextP = $topic.parent().next("p");
    
    if ($nextP.length) {
      sections[sectionTitle.toLowerCase()] = $nextP.text().trim();
    }
  });
  
  // Extract connection table
  const connections = {};
  $("table.border-all tr").each((i, row) => {
    const $cells = $(row).find("td");
    if ($cells.length >= 3) {
      const header = $(row).find("th, .bold").first().text().trim();
      const content = $(row).find("td:not(:has(.bold))").text().trim();
      
      if (header && content) {
        connections[header.toLowerCase()] = content;
      }
    }
  });
  
  // Extract procedure steps
  const steps = [];
  $("table:has(.list--arabic--number) tr").each((i, row) => {
    const stepNum = $(row).find(".list--arabic--number").text().trim();
    const stepText = $(row).find("td").last().text().trim();
    
    if (stepNum && stepText) {
      steps.push({
        number: parseInt(stepNum.replace(".", "")),
        text: stepText,
      });
    }
  });
  
  // Extract reference images
  const images = [];
  $("img[src*='images']").not("[src*='.gif']").each((i, img) => {
    const src = $(img).attr("src");
    images.push({ src: src, alt: $(img).attr("alt") || "" });
  });
  
  return {
    type: ContentType.DIAGNOSTIC,
    id: id,
    title: title,
    objective: sections.objective,
    measurement: sections.measurement,
    preparation: sections.preparation,
    connections: Object.keys(connections).length > 0 ? connections : undefined,
    steps: steps.length > 0 ? steps : undefined,
    images: images.length > 0 ? images : undefined,
  };
}

// ============================================================================
// GENERIC PARSER (FALLBACK)
// ============================================================================

/**
 * Minimal parser for unclassified content.
 * Preserves HTML with basic cleanup.
 * 
 * @param {string} html - Raw HTML content
 * @param {string} id - Document ID
 * @returns {Object} - Generic content object
 */
function parseGeneric(html, id) {
  const $ = cheerio.load(html);
  
  const title = $(".title").first().text().trim() || 
                $("h1").first().text().trim() ||
                id;
  
  // Extract any torque values
  const torqueValues = [];
  $(".tech-spec").each((i, spec) => {
    const text = $(spec).text().trim();
    const match = text.match(/(\d+(?:\.\d+)?)\s*(Nm|N·m)/i);
    if (match) {
      torqueValues.push({
        value: match[1],
        unit: "Nm",
        context: $(spec).parent().text().replace(/\\s+/g, " ").trim(),
      });
    }
  });
  
  // Extract any tool references
  const tools = [];
  $(".tool").each((i, tool) => {
    const code = $(tool).text().trim();
    if (!tools.includes(code)) {
      tools.push(code);
    }
  });
  
  return {
    type: ContentType.GENERIC,
    id: id,
    title: title,
    htmlContent: html, // Preserve original HTML for rendering
    extractedData: {
      torqueValues: torqueValues.length > 0 ? torqueValues : undefined,
      tools: tools.length > 0 ? tools : undefined,
    },
  };
}

// ============================================================================
// REFERENCE EXTRACTOR
// ============================================================================

/**
 * Extracts and aggregates references from all parsed documents.
 * Creates indexes for tools, torque values, and pictograms.
 */
class ReferenceExtractor {
  constructor() {
    this.tools = new Map();
    this.torqueValues = [];
    this.pictograms = [];
    this.glossaryTerms = [];
  }
  
  /**
   * Process a parsed document and extract references.
   */
  processDocument(doc) {
    const docId = doc.id;
    
    // Extract tools
    if (doc.type === ContentType.TOOL_LIST && doc.tools) {
      for (const tool of doc.tools) {
        if (!this.tools.has(tool.code)) {
          this.tools.set(tool.code, {
            code: tool.code,
            name: tool.name,
            description: tool.description,
            sourcePage: docId,
            usedIn: [],
          });
        }
      }
    }
    
    // Track tool usage in procedures
    if (doc.toolsRequired) {
      for (const toolCode of doc.toolsRequired) {
        if (this.tools.has(toolCode)) {
          const tool = this.tools.get(toolCode);
          if (!tool.usedIn.includes(docId)) {
            tool.usedIn.push(docId);
          }
        } else {
          this.tools.set(toolCode, {
            code: toolCode,
            name: null,
            description: null,
            sourcePage: null,
            usedIn: [docId],
          });
        }
      }
    }
    
    // Extract torque values
    if (doc.type === ContentType.TORQUE_TABLE && doc.values) {
      for (const tv of doc.values) {
        this.torqueValues.push({
          ...tv,
          sourcePage: docId,
          group: doc.group,
        });
      }
    } else if (doc.torqueValues) {
      for (const tv of doc.torqueValues) {
        this.torqueValues.push({
          ...tv,
          sourcePage: docId,
        });
      }
    }
    
    // Extract pictograms
    if (doc.type === ContentType.GLOSSARY && doc.subtype === "pictograms") {
      this.pictograms = doc.items;
    }
    
    // Extract glossary terms
    if (doc.type === ContentType.GLOSSARY && doc.subtype === "terms") {
      this.glossaryTerms = doc.items;
    }
  }
  
  /**
   * Get aggregated reference data.
   */
  getReferences() {
    return {
      tools: Array.from(this.tools.values()),
      torqueValues: this.torqueValues,
      pictograms: this.pictograms,
      glossaryTerms: this.glossaryTerms,
    };
  }
}

// ============================================================================
// MAIN TRANSFORMER
// ============================================================================

function main() {
  log("Starting structured content transformation...");
  
  // Ensure output directories exist
  ensureDir(config.outputDir);
  ensureDir(config.contentDir);
  ensureDir(config.viewerAssetsDir);
  ensureDir(config.viewerImagesDir);
  ensureDir(config.referencesDir);
  
  // Copy assets
  if (fs.existsSync(config.assetsDir)) {
    const assetFiles = fs.readdirSync(config.assetsDir).filter(f => 
      !fs.statSync(path.join(config.assetsDir, f)).isDirectory()
    );
    log(`Copying ${assetFiles.length} CGM assets to viewer...`);
    for (const file of assetFiles) {
      fs.copyFileSync(
        path.join(config.assetsDir, file),
        path.join(config.viewerAssetsDir, file)
      );
    }
  }
  
  if (fs.existsSync(config.imagesDir)) {
    const imageFiles = fs.readdirSync(config.imagesDir);
    log(`Copying ${imageFiles.length} images to viewer...`);
    for (const file of imageFiles) {
      fs.copyFileSync(
        path.join(config.imagesDir, file),
        path.join(config.viewerImagesDir, file)
      );
    }
  }
  
  // Load original manifest for tree structure
  let scraperManifest = { pages: [], tree: { roots: [], nodes: {} } };
  if (fs.existsSync(config.manifestPath)) {
    try {
      scraperManifest = JSON.parse(fs.readFileSync(config.manifestPath, "utf8"));
      log(`Loaded scraper manifest: ${scraperManifest.pages?.length || 0} pages`);
    } catch (e) {
      log("Could not load scraper manifest");
    }
  }
  
  // Process all HTML files
  const htmlFiles = fs.readdirSync(config.pagesDir).filter(f => f.endsWith(".html"));
  log(`Processing ${htmlFiles.length} HTML files...`);
  
  const refExtractor = new ReferenceExtractor();
  const contentTypeStats = {};
  const sections = [];
  const tocIdToSlug = {};
  
  // Build tocId to slug mapping
  if (scraperManifest.pages) {
    for (const page of scraperManifest.pages) {
      if (page.tocId && page.filename) {
        tocIdToSlug[page.tocId] = page.filename.replace(/\.html$/, "");
      }
    }
  }
  
  // Fix orphan tree leaves: map tree nodes without tocId entries by matching title
  // This handles duplicate content that was skipped during scraping
  if (scraperManifest.tree?.nodes && scraperManifest.pages) {
    const titleToSlugForOrphans = new Map();
    for (const page of scraperManifest.pages) {
      if (page.title && page.filename) {
        const slug = page.filename.replace(/\.html$/, "");
        if (!titleToSlugForOrphans.has(page.title)) {
          titleToSlugForOrphans.set(page.title, slug);
        }
      }
    }

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
  
  for (const filename of htmlFiles) {
    const inputPath = path.join(config.pagesDir, filename);
    const html = fs.readFileSync(inputPath, "utf8");
    const id = filename.replace(/\.html$/, "");
    
    // Classify content
    const contentType = classifyContent(html, filename);
    contentTypeStats[contentType] = (contentTypeStats[contentType] || 0) + 1;
    
    // Parse based on content type
    let parsed;
    switch (contentType) {
      case ContentType.PROCEDURE:
        parsed = parseProcedure(html, id);
        break;
      case ContentType.TSB:
        parsed = parseTSB(html, id);
        break;
      case ContentType.HARNESS_DIAGRAM:
        parsed = parseHarnessDiagram(html, id);
        break;
      case ContentType.TORQUE_TABLE:
        parsed = parseTorqueTable(html, id);
        break;
      case ContentType.TOOL_LIST:
        parsed = parseToolList(html, id);
        break;
      case ContentType.GLOSSARY:
        parsed = parseGlossary(html, id);
        break;
      case ContentType.DIAGNOSTIC:
        parsed = parseDiagnostic(html, id);
        break;
      default:
        parsed = parseGeneric(html, id);
    }
    
    // Process references
    refExtractor.processDocument(parsed);
    
    // Write parsed content as JSON
    const outputPath = path.join(config.contentDir, `${id}.json`);
    fs.writeFileSync(outputPath, JSON.stringify(parsed, null, 2));
    
    // Also write the original HTML for fallback rendering
    const htmlOutputPath = path.join(config.contentDir, filename);
    fs.writeFileSync(htmlOutputPath, html);
    
    // Add to sections list
    sections.push({
      id: id,
      title: parsed.title,
      contentType: contentType,
      filename: `${id}.json`,
      htmlFilename: filename,
    });
  }
  
  // Write reference files
  const references = refExtractor.getReferences();
  
  fs.writeFileSync(
    path.join(config.referencesDir, "tools.json"),
    JSON.stringify({ tools: references.tools }, null, 2)
  );
  log(`Extracted ${references.tools.length} tools`);
  
  fs.writeFileSync(
    path.join(config.referencesDir, "torque-values.json"),
    JSON.stringify({ values: references.torqueValues }, null, 2)
  );
  log(`Extracted ${references.torqueValues.length} torque values`);
  
  fs.writeFileSync(
    path.join(config.referencesDir, "pictograms.json"),
    JSON.stringify({ pictograms: references.pictograms }, null, 2)
  );
  log(`Extracted ${references.pictograms.length} pictograms`);
  
  fs.writeFileSync(
    path.join(config.referencesDir, "glossary.json"),
    JSON.stringify({ terms: references.glossaryTerms }, null, 2)
  );
  log(`Extracted ${references.glossaryTerms.length} glossary terms`);
  
  // Build enhanced manifest
  const manifest = {
    vehicle: scraperManifest.vehicle || { make: "Vauxhall", model: "VX220", year: 2003 },
    generatedAt: new Date().toISOString(),
    sections: sections,
    tree: scraperManifest.tree || { roots: [], nodes: {} },
    tocIdToSlug: tocIdToSlug,
    contentTypeStats: contentTypeStats,
    references: {
      toolsCount: references.tools.length,
      torqueValuesCount: references.torqueValues.length,
      pictogramsCount: references.pictograms.length,
      glossaryTermsCount: references.glossaryTerms.length,
    },
  };
  
  fs.writeFileSync(
    path.join(config.outputDir, "manifest.json"),
    JSON.stringify(manifest, null, 2)
  );
  
  // Print summary
  log("\n=== TRANSFORMATION COMPLETE ===");
  log(`Processed: ${sections.length} documents`);
  log("\nContent types:");
  for (const [type, count] of Object.entries(contentTypeStats).sort((a, b) => b[1] - a[1])) {
    log(`  ${type}: ${count}`);
  }
  log("\nReferences extracted:");
  log(`  Tools: ${references.tools.length}`);
  log(`  Torque values: ${references.torqueValues.length}`);
  log(`  Pictograms: ${references.pictograms.length}`);
  log(`  Glossary terms: ${references.glossaryTerms.length}`);
}

main();
