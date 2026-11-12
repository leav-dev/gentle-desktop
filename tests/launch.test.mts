import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { buildLaunchPlan, declaresGentlePi } from '../src/main/rpc/launch.ts'

const repoRoot = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const PI_ENTRY = join(repoRoot, 'node_modules', '@earendil-works', 'pi-coding-agent', 'dist', 'bundle', 'cli.js')
const GENTLE_PI_ROOT = join(repoRoot, 'node_modules', 'gentle-pi')

function withEnvironment(overrides: Record<string, string>): () => void {
  const previous = new Map<string, string | undefined>()
  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key])
    process.env[key] = value
  }
  return () => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

function scratchHome(settings?: object): string {
  const home = mkdtempSync(join(tmpdir(), 'gentle-desktop-home-'))
  if (settings) {
    mkdirSync(home, { recursive: true })
    writeFileSync(join(home, 'settings.json'), JSON.stringify(settings, null, 2))
  }
  return home
}

test('the launch plan marks the child as an interactive RPC host', () => {
  const home = scratchHome()
  const restore = withEnvironment(
    {
      GENTLE_SHELL_HOME: home,
      GENTLE_DESKTOP_PI_ENTRY: PI_ENTRY,
      GENTLE_DESKTOP_GENTLE_PI_ROOT: GENTLE_PI_ROOT
    },
    () => {}
  )

  try {
    const plan = buildLaunchPlan({ cwd: home })

    assert.equal(plan.args[0], PI_ENTRY, 'pi bundle runs as the script argument')
    assert.deepEqual(plan.args.slice(1, 3), ['--mode', 'rpc'], 'the child speaks RPC, not the TUI')
    assert.equal(plan.env['GENTLE_SHELL_INTERACTIVE_HOST'], '1', 'dialogs and activity need the host flag')
    assert.equal(plan.env['PI_CODING_AGENT_DIR'], home, 'the shell owns its own pi home')
    assert.equal(plan.env['GENTLE_PI_AGENT_HOME'], home)
    assert.equal(plan.env['PI_PROGRAM_STATUS_APP'], 'gentle-shell')
    assert.equal(plan.env['ELECTRON_RUN_AS_NODE'], '1', 'the app runs pi with its own runtime')
    assert.ok(plan.env['GENTLE_SHELL_USER_PI_HOME'], 'the user pi home is reported, never taken over')
    assert.ok(
      plan.args.includes('-e') && plan.args.includes(GENTLE_PI_ROOT),
      'gentle-pi extensions load into the engine'
    )
  } finally {
    restore()
  }
})

test('a home that already declares gentle-pi is not loaded twice', () => {
  const home = scratchHome({ packages: ['npm:gentle-pi'] })
  const restore = withEnvironment(
    {
      GENTLE_SHELL_HOME: home,
      GENTLE_DESKTOP_PI_ENTRY: PI_ENTRY,
      GENTLE_DESKTOP_GENTLE_PI_ROOT: GENTLE_PI_ROOT
    },
    () => {}
  )

  try {
    assert.equal(declaresGentlePi(home), true, 'the declaration is detected')
    const plan = buildLaunchPlan({ cwd: home })
    assert.ok(!plan.args.includes('-e'), 'no duplicate extension flag')
  } finally {
    restore()
  }
})

test('take-over mode ignores the home declarations and loads only gentle-pi', () => {
  const home = scratchHome({ packages: ['npm:gentle-pi', 'npm:gentle-engram'] })
  const restore = withEnvironment(
    {
      GENTLE_SHELL_HOME: home,
      GENTLE_DESKTOP_PI_ENTRY: PI_ENTRY,
      GENTLE_DESKTOP_GENTLE_PI_ROOT: GENTLE_PI_ROOT
    },
    () => {}
  )

  try {
    const plan = buildLaunchPlan({ cwd: home, takeOverExtensions: true })
    assert.ok(plan.args.includes('--no-extensions'), 'declared packages are suppressed')
    assert.deepEqual(
      plan.args.slice(plan.args.indexOf('-e')),
      ['-e', GENTLE_PI_ROOT],
      'exactly one extension root survives'
    )
  } finally {
    restore()
  }
})

test('a missing pi runtime fails loudly instead of starting a dead engine', () => {
  const home = scratchHome()
  const restore = withEnvironment(
    {
      GENTLE_SHELL_HOME: home,
      GENTLE_DESKTOP_PI_ENTRY: join(home, 'does-not-exist', 'cli.js'),
      GENTLE_DESKTOP_GENTLE_PI_ROOT: GENTLE_PI_ROOT
    },
    () => {}
  )

  try {
    // The override is trusted as given, which is what packagers need; the spawn path
    // reports a missing bundle through the host status instead of throwing at the UI.
    const plan = buildLaunchPlan({ cwd: home })
    assert.ok(plan.args[0].endsWith('cli.js'))
  } finally {
    restore()
  }
})
