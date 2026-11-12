import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

/** Marks this pi child as an interactive RPC host (exact match `"1"`). */
export const INTERACTIVE_HOST_ENV = 'GENTLE_SHELL_INTERACTIVE_HOST'
/** pi's own configuration home for this launch. */
export const AGENT_HOME_ENV = 'GENTLE_PI_AGENT_HOME'
/** The user's untouched pi home, so the shell never claims its credentials. */
export const USER_PI_HOME_ENV = 'GENTLE_SHELL_USER_PI_HOME'
/** Gentle Shell home override, honoured when set. */
export const SHELL_HOME_ENV = 'GENTLE_SHELL_HOME'
/** Status-bar name reported by pi. */
export const PROGRAM_STATUS_APP = 'gentle-shell'

const PI_PACKAGE = '@earendil-works/pi-coding-agent'
const GENTLE_PI_PACKAGE = 'gentle-pi'

export interface LaunchPlan {
  command: string
  args: string[]
  env: NodeJS.ProcessEnv
  cwd: string
  /** Resolved absolute path of pi's CLI entry, for diagnostics in the UI. */
  piEntry: string
  /** Resolved agent home pi will read and write. */
  home: string
}

export class LaunchResolutionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LaunchResolutionError'
  }
}

const requireFromHere = (): NodeJS.Require => {
  // Lazy so module consumers that run as ESM (tests, tooling) can still import this file
  // and rely on the explicit overrides below instead of module-relative resolution.
  if (typeof __filename !== 'string') {
    throw new LaunchResolutionError(
      'cannot resolve packages without a CommonJS module base; set GENTLE_DESKTOP_PI_ENTRY and GENTLE_DESKTOP_GENTLE_PI_ROOT'
    )
  }
  return createRequire(__filename)
}

function packageRoot(specifier: string): string {
  const manifest = requireFromHere().resolve(`${specifier}/package.json`)
  return dirname(manifest)
}

function packageRootByWalking(specifier: string, entry: string): string {
  let current = dirname(entry)
  for (let depth = 0; depth < 6; depth += 1) {
    const manifest = join(current, 'package.json')
    if (existsSync(manifest)) {
      try {
        const parsed = JSON.parse(readFileSync(manifest, 'utf8')) as { name?: string }
        if (parsed.name === specifier) return current
      } catch {
        // A malformed manifest higher up is not this package's problem.
      }
    }
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  throw new LaunchResolutionError(`cannot locate the root of ${specifier}`)
}

/**
 * pi ships a bundled CLI; the desktop app runs it through Electron's own Node so the
 * installer never depends on a Node installation on the user's machine.
 */
export function resolvePiEntry(): string {
  const override = process.env['GENTLE_DESKTOP_PI_ENTRY']
  if (override) return resolve(override)

  let root: string
  try {
    root = packageRoot(PI_PACKAGE)
  } catch {
    throw new LaunchResolutionError(
      `${PI_PACKAGE} is not installed. Run "pnpm install" (or reinstall the app) so the engine ships with it.`
    )
  }

  const entry = join(root, 'dist', 'bundle', 'cli.js')
  if (!existsSync(entry)) {
    throw new LaunchResolutionError(`pi bundle is missing at ${entry}`)
  }
  return entry
}

/** Root of the published gentle-pi package, loaded into pi with `-e`. */
export function resolveGentlePiRoot(): string {
  const override = process.env['GENTLE_DESKTOP_GENTLE_PI_ROOT']
  if (override) return resolve(override)

  try {
    return packageRoot(GENTLE_PI_PACKAGE)
  } catch {
    const entry = requireFromHere().resolve(GENTLE_PI_PACKAGE)
    return packageRootByWalking(GENTLE_PI_PACKAGE, entry)
  }
}

function userPiHome(): string {
  return join(homedir(), '.pi', 'agent')
}

/**
 * Home resolution order: explicit override, the Gentle Shell home when the user already
 * has one, then the plain pi home. The app never invents a home or migrates credentials.
 */
export function resolveAgentHome(): string {
  const override = process.env[SHELL_HOME_ENV]
  if (override) return resolve(override)

  const shellHome = join(homedir(), '.gentle-shell', 'agent')
  if (existsSync(shellHome)) return shellHome

  return userPiHome()
}

/** True when the agent home already declares gentle-pi, so `-e` would double-load it. */
export function declaresGentlePi(home: string): boolean {
  const manifest = join(home, 'settings.json')
  if (!existsSync(manifest)) return false

  try {
    const parsed = JSON.parse(readFileSync(manifest, 'utf8')) as { packages?: unknown }
    const packages = Array.isArray(parsed.packages) ? parsed.packages : []
    return packages.some(
      (entry) => typeof entry === 'string' && (entry === GENTLE_PI_PACKAGE || entry.endsWith(`:${GENTLE_PI_PACKAGE}`))
    )
  } catch {
    return false
  }
}

export interface LaunchOptions {
  /** Working directory the session operates on. */
  cwd?: string
  /** Ignore the home's extension declarations and load only gentle-pi. */
  takeOverExtensions?: boolean
}

export function buildLaunchPlan(options: LaunchOptions = {}): LaunchPlan {
  const home = resolveAgentHome()
  const piEntry = resolvePiEntry()
  const gentlePiRoot = resolveGentlePiRoot()
  const cwd = resolve(options.cwd ?? process.cwd())

  const extensionArgs: string[] = []
  if (options.takeOverExtensions) {
    extensionArgs.push('--no-extensions', '-e', gentlePiRoot)
  } else if (!declaresGentlePi(home)) {
    extensionArgs.push('-e', gentlePiRoot)
  }

  return {
    // Electron's binary doubles as Node; this keeps the app self-contained.
    command: process.execPath,
    args: [piEntry, '--mode', 'rpc', ...extensionArgs],
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      PI_CODING_AGENT_DIR: home,
      [AGENT_HOME_ENV]: home,
      [USER_PI_HOME_ENV]: userPiHome(),
      PI_PROGRAM_STATUS_APP: PROGRAM_STATUS_APP,
      [INTERACTIVE_HOST_ENV]: '1'
    },
    cwd,
    piEntry,
    home
  }
}
