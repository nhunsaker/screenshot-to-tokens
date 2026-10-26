// Rewrite: tokens + clusters → literal-to-var(...) edits, via the configured coder provider.
import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { settings } from '../config.js'
import deterministicCoder from '../providers/coder/deterministic.js'
import metaCodeCoder from '../providers/coder/meta-code.js'

/** @param {string} id */
export function coderFor(id) {
  if (id === 'deterministic') return deterministicCoder()
  if (id === 'meta') return metaCodeCoder()
  throw new Error(`unknown coder: ${id}`)
}

/**
 * @param {{targetDir:string, tokens:import('../types.js').TokenSet, clusters:import('../types.js').Cluster[], write:boolean, runDir:string}} opts
 * @returns {Promise<import('../types.js').RewriteResult>}
 */
export async function runRewrite(opts) {
  const provider = coderFor(settings().coder)
  const result = await provider.rewrite(opts)
  mkdirSync(opts.runDir, { recursive: true })
  writeFileSync(join(opts.runDir, 'rewrite.json'), JSON.stringify(result, null, 2))
  return result
}
