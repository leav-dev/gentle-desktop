import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { listPackage } from '@electron/asar'

/**
 * Verifies that a packaged build actually contains the engine.
 *
 * This exists because the first packaged build looked fine and would have shipped an app
 * that opens a window and then fails to start an agent: the engine is a dependency spawned
 * as a script, so "the installer built" says nothing about "the engine is inside".
 */
const resources = process.argv[2] ?? join('release', 'win-unpacked', 'resources')
const unpackedRoot = join(resources, 'app.asar.unpacked', 'node_modules')
const failures = []

const asarPath = join(resources, 'app.asar')
const entries = existsSync(asarPath) ? listPackage(asarPath).map((entry) => entry.replace(/\\/g, '/')) : null

if (entries === null) {
  failures.push(`no app.asar under ${resources}`)
} else {
  const packed = (needle) => entries.some((entry) => entry.endsWith(needle))
  const unpacked = (needle) => existsSync(join(unpackedRoot, ...needle.split('/')))

  const checks = [
    ['pi engine entry', 'pi-coding-agent/dist/bundle/cli.js'],
    ['gentle-pi extensions', 'gentle-pi/extensions/gentle-shell.ts'],
    ['renderer bundle', 'out/renderer/index.html']
  ]

  for (const [label, needle] of checks) {
    if (!packed(needle) && !unpacked(needle)) failures.push(`${label} is missing (${needle})`)
  }

  console.log(`asar entries: ${entries.length}`)
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
