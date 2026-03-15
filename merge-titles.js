const { readFileSync, writeFileSync, readdirSync } = require('fs')
const path = require('path')

const dir = 'titles-chunks-fr'
const files = readdirSync(dir).filter(f => f.endsWith('.json')).sort()
const merged = {}

for (const file of files) {
  const chunk = JSON.parse(readFileSync(path.join(dir, file), 'utf-8'))
  Object.assign(merged, chunk)
}

writeFileSync('viewer/public/data/fr/titles.json', JSON.stringify(merged, null, 2))
console.log(`Merged ${files.length} chunks → ${Object.keys(merged).length} titles`)
