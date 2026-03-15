const { readFileSync, writeFileSync, mkdirSync } = require('fs')

const titles = JSON.parse(readFileSync('titles.json', 'utf-8'))
const entries = Object.entries(titles)
const CHUNK_SIZE = 100

mkdirSync('titles-chunks', { recursive: true })

const totalChunks = Math.ceil(entries.length / CHUNK_SIZE)
for (let i = 0; i < totalChunks; i++) {
  const chunk = Object.fromEntries(entries.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE))
  writeFileSync(`titles-chunks/titles-${String(i).padStart(3, '0')}.json`, JSON.stringify(chunk, null, 2))
}
console.log(`Split ${entries.length} titles into ${totalChunks} chunks of ~${CHUNK_SIZE}`)
