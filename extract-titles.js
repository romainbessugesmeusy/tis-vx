const { readFileSync, writeFileSync } = require('fs')

const manifest = JSON.parse(readFileSync('viewer/public/data/manifest.json', 'utf-8'))
const titles = {}

for (const [nodeId, node] of Object.entries(manifest.tree.nodes)) {
  if (node.title) {
    titles[nodeId] = node.title
  }
}

writeFileSync('titles.json', JSON.stringify(titles, null, 2))
console.log(`Extracted ${Object.keys(titles).length} titles to titles.json`)
