const fs = require('fs');
const path = require('path');

const REPORT_PATH = path.join(__dirname, 'duplicate-diagrams-report.json');
const PARTS_PATH = path.join(__dirname, 'viewer/public/data/epc/parts.json');
const DIAGRAMS_DIR = path.join(__dirname, 'viewer/public/data/epc/diagrams');
const HOTSPOTS_DIR = path.join(__dirname, 'viewer/public/data/epc/hotspots');

// Load the duplicate report
const report = JSON.parse(fs.readFileSync(REPORT_PATH, 'utf8'));

// Build a mapping: duplicateId -> canonicalId
const mapping = {};
for (const group of report.duplicateGroups) {
  for (const duplicateId of group.remove) {
    mapping[duplicateId] = group.keep;
  }
}

console.log(`Loaded mapping for ${Object.keys(mapping).length} duplicate diagrams\n`);

// Load parts.json
const partsData = JSON.parse(fs.readFileSync(PARTS_PATH, 'utf8'));

// Track updates
let updatedParts = 0;
const usedDiagramIds = new Set();

// Recursively process all parts
function processParts(parts) {
  for (const part of parts) {
    if (part.diagramId) {
      usedDiagramIds.add(part.diagramId);
      
      if (mapping[part.diagramId]) {
        const oldId = part.diagramId;
        const newId = mapping[part.diagramId];
        part.diagramId = newId;
        updatedParts++;
      }
    }
  }
}

function processSection(section) {
  if (section.main) {
    for (const item of section.main) {
      if (item.parts) {
        processParts(item.parts);
      }
    }
  }
  if (section.sub) {
    for (const item of section.sub) {
      if (item.parts) {
        processParts(item.parts);
      }
    }
  }
}

// Process all groups and sections
for (const group of partsData.groups) {
  if (group.subSections) {
    for (const section of group.subSections) {
      processSection(section);
    }
  }
}

console.log(`Found ${usedDiagramIds.size} unique diagram IDs referenced in parts.json`);
console.log(`Updated ${updatedParts} part references to canonical diagram IDs\n`);

// Save updated parts.json
fs.writeFileSync(PARTS_PATH, JSON.stringify(partsData, null, 2));
console.log('✓ Updated parts.json\n');

// Now remove duplicate files
let removedDiagrams = 0;
let removedHotspots = 0;

for (const duplicateId of Object.keys(mapping)) {
  // Remove diagram file
  const diagramPath = path.join(DIAGRAMS_DIR, `${duplicateId}.png`);
  if (fs.existsSync(diagramPath)) {
    fs.unlinkSync(diagramPath);
    removedDiagrams++;
  }
  
  // Remove hotspot file
  const hotspotPath = path.join(HOTSPOTS_DIR, `${duplicateId}.json`);
  if (fs.existsSync(hotspotPath)) {
    fs.unlinkSync(hotspotPath);
    removedHotspots++;
  }
}

console.log(`✓ Removed ${removedDiagrams} duplicate diagram files`);
console.log(`✓ Removed ${removedHotspots} duplicate hotspot files\n`);

// Rebuild the hotspots index
const remainingHotspots = fs.readdirSync(HOTSPOTS_DIR)
  .filter(f => f.endsWith('.json') && !f.startsWith('_'));

const indexData = {
  updatedAt: new Date().toISOString(),
  totalDiagrams: remainingHotspots.length,
  diagrams: []
};

for (const file of remainingHotspots) {
  const diagramId = path.basename(file, '.json');
  try {
    const hotspotData = JSON.parse(fs.readFileSync(path.join(HOTSPOTS_DIR, file), 'utf8'));
    indexData.diagrams.push({
      id: diagramId,
      sheetCode: hotspotData.sheetCode?.text || '?',
      hotspotCount: hotspotData.hotspots?.length || 0,
      status: hotspotData.status || 'todo'
    });
  } catch (err) {
    console.error(`Warning: Could not read ${file}:`, err.message);
  }
}

// Sort by sheet code
indexData.diagrams.sort((a, b) => a.sheetCode.localeCompare(b.sheetCode));

fs.writeFileSync(path.join(HOTSPOTS_DIR, '_index.json'), JSON.stringify(indexData, null, 2));
console.log(`✓ Rebuilt hotspot index with ${indexData.diagrams.length} diagrams\n`);

// Final summary
const remainingDiagrams = fs.readdirSync(DIAGRAMS_DIR).filter(f => f.endsWith('.png')).length;
console.log('=== Summary ===');
console.log(`Diagrams before: 332`);
console.log(`Diagrams after: ${remainingDiagrams}`);
console.log(`Parts references updated: ${updatedParts}`);
console.log(`Space saved: ~${Math.round(removedDiagrams * 0.15)}MB (estimated)`);

// Save a mapping file for reference
const mappingPath = path.join(__dirname, 'diagram-id-mapping.json');
fs.writeFileSync(mappingPath, JSON.stringify({
  createdAt: new Date().toISOString(),
  description: 'Maps old duplicate diagram IDs to their canonical versions',
  mapping
}, null, 2));
console.log(`\n✓ Saved ID mapping to: diagram-id-mapping.json`);
