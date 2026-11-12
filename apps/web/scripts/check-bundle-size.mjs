// ROADMAP E10.08: a budget for the JavaScript the built web app makes every visitor download — the
// scripts `index.html` loads before any page (entry and its preloaded chunks: what the public page and
// the sign-in page start with) — and for any single chunk. Pages load on demand (src/router.tsx): a
// static import that pulls a heavy screen back into the entry fails the build here.
// Usage (after `vite build`): node scripts/check-bundle-size.mjs [dist directory]
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

// Gzip sizes, in KiB. Measured on 2026-11-12: 160 initially and largest chunk 62 — before E10.08,
// one chunk of 342 for every page.
const INITIAL_BUDGET_KIB = 180
const CHUNK_BUDGET_KIB = 80

const dist = process.argv[2] ?? 'dist'
const kib = (file) => gzipSync(readFileSync(join(dist, file)), { level: 9 }).length / 1024

const html = readFileSync(join(dist, 'index.html'), 'utf8')
const initial = [...html.matchAll(/(?:src|href)="\/(assets\/[^"]+\.js)"/g)].map((m) => m[1])
if (initial.length === 0) {
  console.error('No script found in index.html: is it a Vite build?')
  process.exit(2)
}
const initialKib = initial.reduce((sum, file) => sum + kib(file), 0)

const chunks = readdirSync(join(dist, 'assets'))
  .filter((f) => f.endsWith('.js'))
  .map((f) => ({ file: `assets/${f}`, size: kib(`assets/${f}`) }))
  .sort((a, b) => b.size - a.size)

console.log(
  `Initial JavaScript: ${initialKib.toFixed(1)} KiB gzip in ${initial.length} files ` +
    `(budget ${INITIAL_BUDGET_KIB}); ${chunks.length} chunks, largest ${chunks[0].file} ` +
    `${chunks[0].size.toFixed(1)} KiB (budget ${CHUNK_BUDGET_KIB}).`,
)
const over = chunks.filter((c) => c.size > CHUNK_BUDGET_KIB)
let failed = false
if (initialKib > INITIAL_BUDGET_KIB) {
  console.error(`Initial JavaScript over budget: ${initialKib.toFixed(1)} > ${INITIAL_BUDGET_KIB} KiB.`)
  failed = true
}
for (const c of over) {
  console.error(`Chunk over budget: ${c.file} ${c.size.toFixed(1)} > ${CHUNK_BUDGET_KIB} KiB.`)
  failed = true
}
process.exit(failed ? 1 : 0)
