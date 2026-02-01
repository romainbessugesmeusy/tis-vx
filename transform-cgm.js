/**
 * CGM to SVG/PNG Transformer
 * 
 * Uses the SDICGM viewer website (https://www.sdicgm.com/cgmview/) to convert
 * CGM (Computer Graphics Metafile) files to web-friendly formats.
 * 
 * The website uses WebAssembly to parse CGM files and renders them to a canvas.
 * This script automates the conversion process using Playwright.
 * 
 * Output options:
 * - PNG: High-resolution raster image captured from the canvas
 * - SVG: Fabric.js SVG export with embedded PNG of the CGM rendering
 * 
 * Usage:
 *   node transform-cgm.js [--png|--svg] [--file <specific-file>]
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const CONFIG = {
  cgmViewerUrl: 'https://www.sdicgm.com/cgmview/',
  inputDir: path.join(__dirname, 'viewer/public/data/assets'),
  outputDir: path.join(__dirname, 'viewer/public/data/assets/converted'),
  format: 'png', // 'png' or 'svg'
  headless: true,
  timeout: 30000, // 30 seconds per file
  retries: 2,
  // 4K resolution for high-quality output
  viewport: { width: 3840, height: 2160 },
};

async function waitForCgmRender(page, timeout = 10000) {
  // Wait for the CGM to render by checking if canvas has content
  // The WASM module sets c.w1.x when loaded
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeout) {
    const isRendered = await page.evaluate(() => {
      try {
        // Check if the global context exists and has been initialized
        if (typeof c !== 'undefined' && c.w1 && c.w1.x !== -9898) {
          // Also check if canvas has actual content
          const canvas = document.getElementById('canvas1');
          if (canvas) {
            const ctx = canvas.getContext('2d');
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            // Check if there are any non-transparent pixels
            for (let i = 3; i < imageData.data.length; i += 4) {
              if (imageData.data[i] !== 0) return true;
            }
          }
        }
        return false;
      } catch (e) {
        return false;
      }
    });
    
    if (isRendered) {
      // Give a little extra time for rendering to complete
      await page.waitForTimeout(500);
      return true;
    }
    
    await page.waitForTimeout(100);
  }
  
  return false;
}

async function exportAsPng(page) {
  // Capture the CGM canvas as a high-resolution PNG
  const pngData = await page.evaluate(() => {
    const canvas1 = document.getElementById('canvas1');
    if (!canvas1) return null;
    
    // Create a new canvas with white background
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = canvas1.width;
    exportCanvas.height = canvas1.height;
    const ctx = exportCanvas.getContext('2d');
    
    // Fill with white background
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
    
    // Draw the CGM content
    ctx.drawImage(canvas1, 0, 0);
    
    return exportCanvas.toDataURL('image/png');
  });
  
  if (pngData && pngData.startsWith('data:image/png;base64,')) {
    return Buffer.from(pngData.replace('data:image/png;base64,', ''), 'base64');
  }
  
  return null;
}

async function exportAsSvg(page) {
  // Use the saveRedline() approach to get SVG with embedded PNG
  const svgData = await page.evaluate(() => {
    try {
      if (typeof c === 'undefined' || !c.fcanvas) return null;
      
      const canvas1 = document.getElementById('canvas1');
      if (!canvas1) return null;
      
      // Get canvas as PNG
      const png = canvas1.toDataURL('image/png');
      
      // Get fabric.js SVG
      let svg = c.fcanvas.toSVG();
      
      // Get viewBox dimensions from SVG
      const viewBoxMatch = svg.match(/viewBox="([^"]+)"/);
      if (viewBoxMatch) {
        const [x, y, w, h] = viewBoxMatch[1].split(' ');
        
        // Insert the PNG image into the SVG
        const imageElement = `<image x="${x}" y="${y}" width="${w}" height="${h.replace('"', '')}" href="${png}"></image>`;
        svg = svg.replace('</defs>', `</defs>${imageElement}`);
      }
      
      return svg;
    } catch (e) {
      console.error('SVG export error:', e);
      return null;
    }
  });
  
  return svgData ? Buffer.from(svgData) : null;
}

async function convertCgmFile(page, cgmFilePath, outputPath, format) {
  console.log(`  Converting: ${path.basename(cgmFilePath)}`);
  
  // Clear any previous content
  await page.evaluate(() => {
    if (typeof c !== 'undefined' && c.fcanvas) {
      c.fcanvas.clear();
    }
    const canvas1 = document.getElementById('canvas1');
    if (canvas1) {
      const ctx = canvas1.getContext('2d');
      ctx.clearRect(0, 0, canvas1.width, canvas1.height);
    }
    // Reset the viewport indicator
    if (typeof c !== 'undefined' && c.w1) {
      c.w1.x = -9898;
    }
  });
  
  // Upload the CGM file
  const fileInput = await page.locator('#filein');
  await fileInput.setInputFiles(cgmFilePath);
  
  // Wait for rendering
  const rendered = await waitForCgmRender(page, CONFIG.timeout);
  
  if (!rendered) {
    console.log(`    Warning: CGM may not have rendered completely`);
  }
  
  // Export based on format
  let data;
  if (format === 'svg') {
    data = await exportAsSvg(page);
  } else {
    data = await exportAsPng(page);
  }
  
  if (data) {
    fs.writeFileSync(outputPath, data);
    console.log(`    Saved: ${path.basename(outputPath)}`);
    return true;
  } else {
    console.log(`    Error: Failed to export`);
    return false;
  }
}

async function main() {
  // Parse command line arguments
  const args = process.argv.slice(2);
  let specificFile = null;
  let format = CONFIG.format;
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--png') format = 'png';
    if (args[i] === '--svg') format = 'svg';
    if (args[i] === '--file' && args[i + 1]) {
      specificFile = args[i + 1];
      i++;
    }
  }
  
  console.log('='.repeat(60));
  console.log('CGM to ' + format.toUpperCase() + ' Converter');
  console.log('Using SDICGM viewer: ' + CONFIG.cgmViewerUrl);
  console.log('='.repeat(60));
  
  // Create output directory
  if (!fs.existsSync(CONFIG.outputDir)) {
    fs.mkdirSync(CONFIG.outputDir, { recursive: true });
  }
  
  // Find CGM files
  let cgmFiles;
  if (specificFile) {
    cgmFiles = [specificFile];
  } else {
    cgmFiles = fs.readdirSync(CONFIG.inputDir)
      .filter(f => f.toLowerCase().endsWith('.cgm'))
      .map(f => path.join(CONFIG.inputDir, f));
  }
  
  console.log(`Found ${cgmFiles.length} CGM files to convert\n`);
  
  if (cgmFiles.length === 0) {
    console.log('No CGM files found!');
    return;
  }
  
  // Launch browser
  console.log('Launching browser...');
  const browser = await chromium.launch({
    headless: CONFIG.headless,
  });
  
  const context = await browser.newContext({
    viewport: CONFIG.viewport,
  });
  
  const page = await context.newPage();
  
  // Navigate to CGM viewer
  console.log('Loading CGM viewer website...');
  await page.goto(CONFIG.cgmViewerUrl, { 
    waitUntil: 'domcontentloaded',
    timeout: 60000 
  });
  
  // Wait for the WASM module to initialize
  console.log('Waiting for WASM module to initialize...');
  await page.waitForFunction(() => {
    return typeof Module !== 'undefined' && 
           typeof c !== 'undefined' && 
           typeof sdi_printcgm !== 'undefined';
  }, { timeout: 60000 });
  
  // Resize canvas to fill the 4K viewport
  console.log(`Setting canvas size to ${CONFIG.viewport.width}x${CONFIG.viewport.height}...`);
  await page.evaluate((viewport) => {
    if (typeof sdiSetCanvasSize === 'function') {
      sdiSetCanvasSize(viewport.width, viewport.height);
    }
  }, CONFIG.viewport);
  
  console.log('CGM viewer ready!\n');
  
  // Process each CGM file
  let successCount = 0;
  let failCount = 0;
  
  for (let i = 0; i < cgmFiles.length; i++) {
    const cgmFile = cgmFiles[i];
    const baseName = path.basename(cgmFile, '.cgm');
    const outputPath = path.join(CONFIG.outputDir, `${baseName}.${format}`);
    
    console.log(`[${i + 1}/${cgmFiles.length}] Processing ${baseName}.cgm`);
    
    let success = false;
    for (let retry = 0; retry <= CONFIG.retries && !success; retry++) {
      if (retry > 0) {
        console.log(`    Retry ${retry}/${CONFIG.retries}...`);
        // Reload page on retry
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForFunction(() => {
          return typeof Module !== 'undefined' && 
                 typeof c !== 'undefined' && 
                 typeof sdi_printcgm !== 'undefined';
        }, { timeout: 60000 });
        // Resize canvas again
        await page.evaluate((viewport) => {
          if (typeof sdiSetCanvasSize === 'function') {
            sdiSetCanvasSize(viewport.width, viewport.height);
          }
        }, CONFIG.viewport);
      }
      
      try {
        success = await convertCgmFile(page, cgmFile, outputPath, format);
      } catch (error) {
        console.log(`    Error: ${error.message}`);
      }
    }
    
    if (success) {
      successCount++;
    } else {
      failCount++;
    }
  }
  
  await browser.close();
  
  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('Conversion Complete!');
  console.log(`  Successful: ${successCount}`);
  console.log(`  Failed: ${failCount}`);
  console.log(`  Output directory: ${CONFIG.outputDir}`);
  console.log('='.repeat(60));
}

main().catch(console.error);
