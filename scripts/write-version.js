import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const outputPath = join(root, 'public', 'version.json')

function gitCommitSha() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return ''
  }
}

function readExisting() {
  try {
    return existsSync(outputPath) ? JSON.parse(readFileSync(outputPath, 'utf8')) : {}
  } catch {
    return {}
  }
}

const version = (
  process.env.VITE_APP_VERSION ||
  process.env.VERCEL_GIT_COMMIT_SHA ||
  process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ||
  gitCommitSha() ||
  ''
).trim() || `local-${new Date().toISOString()}`
const existing = readExisting()
const generatedAt = existing.version === version && existing.generatedAt ? existing.generatedAt : new Date().toISOString()

mkdirSync(dirname(outputPath), { recursive: true })
writeFileSync(outputPath, `${JSON.stringify({ version, generatedAt }, null, 2)}\n`)
