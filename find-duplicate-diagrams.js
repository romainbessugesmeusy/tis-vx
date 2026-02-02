const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');

const DIAGRAMS_DIR = path.join(__dirname, 'viewer/public/data/epc/diagrams');
const HOTSPOTS_DIR = path.join(__dirname, 'viewer/public/data/epc/hotspots');

async function hashImage(filePath) {
  // Get raw pixel data and hash it
  const { data } = await sharp(filePath)
    .raw()
    .toBuffer({ resolveWithObject: true });
  
  return crypto.createHash('md5').update(data).digest('hex');
}

async function main() {
  const files = fs.readdirSync(DIAGRAMS_DIR).filter(f => f.endsWith('.png'));
  console.log(`Analyzing ${files.length} diagrams...\n`);
  
  const hashMap = {}; // hash -> [filenames]
  const fileHashes = {}; // filename -> hash
  
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const filePath = path.join(DIAGRAMS_DIR, file);
    
    try {
      const hash = await hashImage(filePath);
      fileHashes[file] = hash;
      
      if (!hashMap[hash]) {
        hashMap[hash] = [];
      }
      hashMap[hash].push(file);
      
      if ((i + 1) % 50 === 0) {
        process.stdout.write(`\rProcessed ${i + 1}/${files.length}`);
      }
    } catch (err) {
      console.error(`\nError processing ${file}:`, err.message);
    }
  }
  
  console.log(`\rProcessed ${files.length}/${files.length}\n`);
  
  // Find duplicates
  const duplicates = Object.entries(hashMap)
    .filter(([_, files]) => files.length > 1)
    .sort((a, b) => b[1].length - a[1].length);
  
  if (duplicates.length === 0) {
    console.log('No duplicate images found.');
    return;
  }
  
  console.log(`Found ${duplicates.length} groups of duplicates:\n`);
  
  let totalDuplicates = 0;
  const duplicateReport = [];
  
  for (const [hash, fileList] of duplicates) {
    // Get sheet codes for each file
    const filesWithCodes = fileList.map(f => {
      const diagramId = path.basename(f, '.png');
      const hotspotPath = path.join(HOTSPOTS_DIR, `${diagramId}.json`);
      let sheetCode = '?';
      try {
        const data = JSON.parse(fs.readFileSync(hotspotPath, 'utf8'));
        sheetCode = data.sheetCode?.text || '?';
      } catch {}
      return { file: f, diagramId, sheetCode };
    });
    
    // Sort by sheet code
    filesWithCodes.sort((a, b) => a.sheetCode.localeCompare(b.sheetCode));
    
    const sheetCode = filesWithCodes[0].sheetCode;
    console.log(`[${sheetCode}] ${fileList.length} identical images:`);
    filesWithCodes.forEach(({ file, sheetCode }) => {
      console.log(`  - ${file} (${sheetCode})`);
    });
    console.log();
    
    totalDuplicates += fileList.length - 1;
    
    duplicateReport.push({
      sheetCode,
      hash: hash.substring(0, 8),
      keep: filesWithCodes[0].diagramId,
      remove: filesWithCodes.slice(1).map(f => f.diagramId)
    });
  }
  
  const uniqueCount = Object.keys(hashMap).length;
  console.log(`\n=== Summary ===`);
  console.log(`Total diagrams: ${files.length}`);
  console.log(`Unique images: ${uniqueCount}`);
  console.log(`Duplicates to remove: ${totalDuplicates}`);
  console.log(`Reduction: ${((totalDuplicates / files.length) * 100).toFixed(1)}%`);
  
  // Save report
  const reportPath = path.join(__dirname, 'duplicate-diagrams-report.json');
  fs.writeFileSync(reportPath, JSON.stringify({
    totalDiagrams: files.length,
    uniqueImages: uniqueCount,
    duplicatesToRemove: totalDuplicates,
    duplicateGroups: duplicateReport
  }, null, 2));
  console.log(`\nReport saved to: ${reportPath}`);
}

main().catch(console.error);
