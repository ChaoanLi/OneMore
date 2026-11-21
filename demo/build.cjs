const { buildSync } = require('esbuild')
const fs = require('node:fs')
const path = require('node:path')
const bundle = buildSync({
  entryPoints: [path.join(__dirname, 'game-night.js')], bundle: true, minify: true, write: false,
}).outputFiles[0].text
const template = fs.readFileSync(path.join(__dirname, 'index.template.html'), 'utf8')
const out = path.join(__dirname, 'dist')
fs.mkdirSync(out, { recursive: true })
fs.writeFileSync(path.join(out, 'index.html'), template.replace('/* DEMO_SCRIPT */', () => bundle))
