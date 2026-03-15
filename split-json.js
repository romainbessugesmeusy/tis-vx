const { readFileSync, writeFileSync, mkdirSync } = require('fs')
const path = require('path')

const inputFile = process.argv[2]
const outputDir = process.argv[3]
const chunkSize = parseInt(process.argv[4] || '50', 10)

if (!inputFile || !outputDir) {
  console.error('Usage: node split-json.js <input.json> <output-dir> [chunk-size]')
  process.exit(1)
}

const data = JSON.parse(readFileSync(inputFile, 'utf-8'))
mkdirSync(outputDir, { recursive: true })

const basename = path.basename(inputFile, '.json')

if (Array.isArray(data)) {
  const totalChunks = Math.ceil(data.length / chunkSize)
  for (let i = 0; i < totalChunks; i++) {
    const chunk = data.slice(i * chunkSize, (i + 1) * chunkSize)
    writeFileSync(path.join(outputDir, `${basename}-${String(i).padStart(3, '0')}.json`), JSON.stringify(chunk, null, 2))
  }
  console.log(`Split ${data.length} items from ${inputFile} into ${totalChunks} chunks`)
} else if (typeof data === 'object') {
  const topKeys = Object.keys(data)
  const arrayKey = topKeys.find(k => Array.isArray(data[k]) && data[k].length > chunkSize)

  if (arrayKey) {
    const arr = data[arrayKey]
    const rest = Object.fromEntries(topKeys.filter(k => k !== arrayKey).map(k => [k, data[k]]))
    const totalChunks = Math.ceil(arr.length / chunkSize)
    for (let i = 0; i < totalChunks; i++) {
      const chunk = { ...rest, [arrayKey]: arr.slice(i * chunkSize, (i + 1) * chunkSize) }
      writeFileSync(path.join(outputDir, `${basename}-${String(i).padStart(3, '0')}.json`), JSON.stringify(chunk, null, 2))
    }
    console.log(`Split ${arr.length} ${arrayKey} from ${inputFile} into ${totalChunks} chunks`)
  } else {
    const entries = Object.entries(data)
    const totalChunks = Math.ceil(entries.length / chunkSize)
    for (let i = 0; i < totalChunks; i++) {
      const chunk = Object.fromEntries(entries.slice(i * chunkSize, (i + 1) * chunkSize))
      writeFileSync(path.join(outputDir, `${basename}-${String(i).padStart(3, '0')}.json`), JSON.stringify(chunk, null, 2))
    }
    console.log(`Split ${entries.length} entries from ${inputFile} into ${totalChunks} chunks`)
  }
}
