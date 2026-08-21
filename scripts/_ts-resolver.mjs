/**
 * Resolve extensionless relative imports to .ts so Node can run the app's own
 * library code directly. Next.js resolves these via tsconfig; plain Node does
 * not. Keeping this here means scripts reuse src/lib/* as-is and can never
 * drift from the implementation the dashboard actually runs.
 */
import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('.') && !/\.[cm]?[jt]s$/.test(specifier)) {
    const parentDir = context.parentURL
      ? path.dirname(fileURLToPath(context.parentURL))
      : process.cwd()
    for (const ext of ['.ts', '.tsx', '/index.ts']) {
      const candidate = path.resolve(parentDir, specifier + ext)
      if (existsSync(candidate)) {
        return { url: pathToFileURL(candidate).href, shortCircuit: true }
      }
    }
  }
  return nextResolve(specifier, context)
}
