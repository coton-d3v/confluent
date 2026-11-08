import { readdirSync, readFileSync } from 'node:fs'
import { builtinModules } from 'node:module'
import { join } from 'node:path'

// pnpm only exposes declared dependencies: a package imported at runtime but reached transitively
// in development is missing from the production image (code review R41: `express`).
const ROOT = join(__dirname, '..')
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
  dependencies: Record<string, string>
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === 'testing' ? [] : sourceFiles(path)
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts') ? [path] : []
  })
}

// Package name of every runtime (non `import type`) bare import.
function runtimePackages(source: string): string[] {
  const names: string[] = []
  for (const [, clause, specifier] of source.matchAll(
    /^import\s+(type\s+)?[^'"]*?from\s+'([^'.][^']*)'/gm,
  )) {
    if (clause) continue
    const parts = specifier.split('/')
    names.push(specifier.startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0])
  }
  for (const [, specifier] of source.matchAll(/^import\s+'([^'.][^']*)'/gm)) names.push(specifier)
  return names
}

describe('runtime dependencies', () => {
  it('declares every package imported at runtime by src/ in package.json dependencies', () => {
    const builtins = new Set([...builtinModules, ...builtinModules.map((m) => `node:${m}`)])
    const missing = new Set<string>()
    for (const file of sourceFiles(join(ROOT, 'src'))) {
      for (const name of runtimePackages(readFileSync(file, 'utf8'))) {
        if (!builtins.has(name) && !name.startsWith('node:') && !pkg.dependencies[name])
          missing.add(name)
      }
    }
    expect([...missing].sort()).toEqual([])
  })
})
