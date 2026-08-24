/**
 * Regenerate `operations/products/_registry.md` from the platform's own module
 * manifests — M2.5 Tier 2: derive the facts that can be derived.
 *
 * Why: engineering shipped 5 modules sales never heard of, one product carried
 * two names into the same room (GovHire vs HireCA), and "demo-ready" was
 * remembered rather than measured. Every fact below comes from origin/main of
 * the platform repo: each module's `MANIFEST = ModuleManifest(...)` declares
 * its canonical slug and display name (the naming authority), and the rest is
 * computed from the tree (UI size, tests, last touch).
 *
 * Authored positioning (taglines, buyers, pricing, market evidence) stays in
 * the per-product files — derived and authored facts never share a file.
 *
 * Runs weekly on the machine with the platform clone (the MacBook), alongside
 * drift-check. Commits only when content changed.
 *
 * Run:  node --experimental-strip-types --no-warnings scripts/run-ts.mjs scripts/generate-registry.ts
 */
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { PATHS } from '../src/lib/paths.ts'
import { runCommandArgs } from '../src/lib/shell.ts'

const PLATFORM = path.join(os.homedir(), 'infiniteai_platform')
const REGISTRY = path.join(PATHS.operationsRoot, 'products/_registry.md')
const REF = 'origin/main'

const pgit = (args: string[]) => runCommandArgs('git', ['-C', PLATFORM, ...args], 60_000)

interface Mod {
  slug: string; name: string; version: string; prefix: string; surface: string
  manifestPath: string
  uiFiles: number; uiKB: number
  testFiles: number
  lastTouched: string
  signal: string
}

function field(src: string, key: string): string {
  const m = src.match(new RegExp(`${key}\\s*=\\s*"([^"]*)"`))
  return m?.[1] ?? ''
}

async function main() {
  await pgit(['fetch', '-q', 'origin', 'main']).catch(() => { /* offline — use last fetch */ })
  const refShort = (await pgit(['rev-parse', '--short', REF])).trim()
  const allFiles = (await pgit(['ls-tree', '-r', '--name-only', REF])).split('\n')

  const manifestFiles = allFiles.filter(f =>
    /^packages\/api\/app\/routers\/.*manifest\.py$/.test(f))

  const mods: Mod[] = []
  for (const mf of manifestFiles) {
    const src = await pgit(['show', `${REF}:${mf}`])
    const slug = field(src, 'slug')
    if (!slug) continue
    const uiDir = `packages/ui/components/modules/${slug}/`
    // -l gives byte sizes; the UI tree is the "does a real frontend exist" signal.
    const uiList = (await pgit(['ls-tree', '-r', '-l', REF, uiDir]).catch(() => ''))
      .split('\n').filter(Boolean)
    const uiKB = Math.round(uiList.reduce((s, l) => s + (Number(l.split(/\s+/)[3]) || 0), 0) / 1024)
    const slugUnder = slug.replace(/-/g, '_')
    const testFiles = allFiles.filter(f =>
      f.startsWith('tests/') && (f.includes(slug) || f.includes(slugUnder))).length
    const lastTouched = (await pgit(['log', '-1', '--format=%cs', REF, '--',
      path.dirname(mf), uiDir]).catch(() => '')).trim()

    // The readiness heuristic that made "needs-frontend" computable: a module
    // whose UI tree is tiny has a nav shell, not a product surface.
    const signal = uiList.length === 0 ? 'no frontend dir'
      : uiKB < 15 ? `thin frontend (${uiKB}KB / ${uiList.length} files)`
      : `frontend ${uiKB}KB / ${uiList.length} files`

    mods.push({
      slug, name: field(src, 'name') || slug, version: field(src, 'version'),
      prefix: field(src, 'backend_prefix'), surface: field(src, 'surface') || 'product',
      manifestPath: mf, uiFiles: uiList.length, uiKB, testFiles, lastTouched, signal,
    })
  }
  mods.sort((a, b) => a.slug.localeCompare(b.slug))

  const s: string[] = [
    '# Product registry — DERIVED. DO NOT HAND-EDIT.',
    '',
    '<!-- Generated weekly by command-center scripts/generate-registry.ts from',
    '     the platform repo\'s own module manifests. The `name` column IS the',
    '     canonical display name — sales collateral that disagrees with it is',
    '     wrong by definition. Authored positioning stays in per-product files;',
    '     it never belongs here. -->',
    `generated_at: ${new Date().toISOString()}`,
    `platform ref: ${REF} @ ${refShort}`,
    '',
    '| slug | display name | ver | route | frontend | tests | last touched | manifest |',
    '|------|--------------|-----|-------|----------|-------|--------------|----------|',
    ...mods.map(m =>
      `| \`${m.slug}\` | **${m.name}** | ${m.version} | \`${m.prefix}\` | ${m.signal} | ${m.testFiles} | ${m.lastTouched} | \`${m.manifestPath} (platform)\` |`),
    '',
    `_${mods.length} modules declared on ${REF}. A module absent here does not exist,`,
    'whatever any document says; a name spelled differently anywhere else is a',
    'defect in that document. Frontend size is a heuristic readiness signal,',
    'not a verdict — a thin frontend means "look before you demo"._',
    '',
  ]

  const next = s.join('\n')
  const strip = (t: string) => t.split('\n').filter(l => !l.startsWith('generated_at:')).join('\n')
  let current = ''
  try { current = await fs.readFile(REGISTRY, 'utf8') } catch { /* first run */ }
  if (strip(current) === strip(next)) { console.log('registry: unchanged'); return }

  await fs.mkdir(path.dirname(REGISTRY), { recursive: true })
  await fs.writeFile(REGISTRY, next)
  const rel = path.relative(PATHS.operationsRoot, REGISTRY)
  try {
    await runCommandArgs('git', ['-C', PATHS.operationsRoot, 'add', '--', rel], 15_000)
    await runCommandArgs('git', ['-C', PATHS.operationsRoot, 'commit', '-q',
      '-m', `products: regenerate registry (${mods.length} modules @ ${refShort})`,
      '-m', 'via: generate-registry', '--', rel], 15_000)
  } catch { /* janitor sweeps */ }
  console.log(`registry: regenerated — ${mods.length} modules @ ${refShort}`)
}

main().catch(err => { console.error('generate-registry failed:', err); process.exit(1) })
