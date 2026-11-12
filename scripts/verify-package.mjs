import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { extractFile, listPackage } from '@electron/asar'

/**
 * Verifies that a packaged build actually works, not just that it built.
 *
 * Two failures motivated each check:
 *   - an installer that succeeds while the engine is missing from the package;
 *   - a package whose app entry is absent, so the app starts and exits with code 1 and
 *     prints nothing at all.
 *
 * Archive entries use `\` on Windows, so every comparison normalizes separators first.
 */
const resources = process.argv[2] ?? join('release', 'win-unpacked', 'resources')
const unpackedRoot = join(resources, 'app.asar.unpacked', 'node_modules')
const failures = []

const normalize = (entry) => entry.replace(/\\/g, '/')
const asarPath = join(resources, 'app.asar')

if (!existsSync(asarPath)) {
  failures.push(`no app.asar under ${resources}`)
} else {
  const entries = listPackage(asarPath).map(normalize)
  const packed = (needle) => entries.some((entry) => entry.endsWith(needle))
  const unpacked = (needle) => existsSync(join(unpackedRoot, ...needle.split('/')))

  let mainEntry = null
  try {
    const manifest = JSON.parse(extractFile(asarPath, 'package.json').toString('utf8'))
    mainEntry = typeof manifest.main === 'string' ? normalize(manifest.main.replace(/^\.\//, '')) : null
  } catch (error) {
    failures.push(`cannot read the packaged package.json: ${error.message}`)
  }

  if (mainEntry === null) {
    failures.push('the packaged package.json declares no main entry')
  } else if (!packed(mainEntry)) {
    failures.push(`the declared main entry is not in the archive: ${mainEntry}`)
  } else {
    try {
      const bytes = extractFile(asarPath, mainEntry.split('/').join('\\'))
      if (bytes.length === 0) failures.push(`the main entry is empty: ${mainEntry}`)
    } catch (error) {
      failures.push(`the main entry cannot be extracted: ${error.message}`)
    }
  }

  const checks = [
    ['preload bundle', 'out/preload/index.js'],
    ['renderer bundle', 'out/renderer/index.html'],
    ['pi engine entry', 'pi-coding-agent/dist/bundle/cli.js'],
    ['gentle-pi extensions', 'gentle-pi/extensions/gentle-shell.ts']
  ]

  for (const [label, needle] of checks) {
    if (!packed(needle) && !unpacked(needle)) failures.push(`${label} is missing (${needle})`)
  }

  console.log(`asar entries: ${entries.length}`)
  console.log(`main entry: ${mainEntry ?? '(none)'}`)
  for (const [label, needle] of checks) {
    console.log(`  ${label}: packed=${packed(needle)} unpacked=${unpacked(needle)}`)
  }
}

const workspace = join(unpackedRoot, '@earendil-works')
if (existsSync(workspace)) console.log(`unpacked @earendil-works: ${readdirSync(workspace).join(', ')}`)

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL ${failure}`)
  process.exit(1)
}

console.log('package looks complete')
