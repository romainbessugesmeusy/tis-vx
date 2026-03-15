const { readFileSync, writeFileSync, readdirSync } = require('fs')
const path = require('path')

const inputDir = process.argv[2]
const outputFile = process.argv[3]

if (!inputDir || !outputFile) {
  console.error('Usage: node merge-json.js <input-dir> <output-file>')
  process.exit(1)
}

const files = readdirSync(inputDir).filter(f => f.endsWith('.json')).sort()
const chunks = files.map(f => JSON.parse(readFileSync(path.join(inputDir, f), 'utf-8')))

if (chunks.length === 0) {
  console.error('No JSON files found in ' + inputDir)
  process.exit(1)
}

if (Array.isArray(chunks[0])) {
  const merged = chunks.flat()
  writeFileSync(outputFile, JSON.stringify(merged, null, 2))
  console.log(`Merged ${files.length} chunks → ${merged.length} items → ${outputFile}`)
} else if (typeof chunks[0] === 'object') {
  const arrayKey = Object.keys(chunks[0]).find(k => Array.isArray(chunks[0][k]))

  if (arrayKey) {
    const rest = Object.fromEntries(Object.entries(chunks[0]).filter(([k]) => k !== arrayKey))
    const mergedArray = chunks.flatMap(c => c[arrayKey] || [])
    writeFileSync(outputFile, JSON.stringify({ ...rest, [arrayKey]: mergedArray }, null, 2))
    console.log(`Merged ${files.length} chunks → ${mergedArray.length} ${arrayKey} → ${outputFile}`)
  } else {
    const merged = Object.assign({}, ...chunks)
    writeFileSync(outputFile, JSON.stringify(merged, null, 2))
    console.log(`Merged ${files.length} chunks → ${Object.keys(merged).length} entries → ${outputFile}`)
  }
}
