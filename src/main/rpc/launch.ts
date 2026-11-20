import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { resolveDesktopConfigHome } from '../config-home.ts'

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

/**
 * Resolver anchored at an explicit directory, so resolution works in the packaged app
 * (inside app.asar) and in tests, which run as ESM where `__filename` does not exist.
 */
function moduleBaseOrDefault(moduleBase?: string): string {
  if (moduleBase) return resolve(moduleBase)
  if (typeof __filename === 'string') return dirname(__filename)
  throw new LaunchResolutionError(
    'cannot resolve packages without a module base; pass moduleBase or set GENTLE_DESKTOP_PI_ENTRY'
  )
}

/**
 * Finds a dependency directory by walking `node_modules` ancestors of the module base.
 *
 * Node's resolver cannot be used here: pi declares `exports` with an `import` condition
 * only, so `require.resolve` fails even though the package is installed. A filesystem walk
 * is also what works inside `app.asar`, where Electron patches `fs` but not everything.
 */
/** Packaged builds keep extension trees in `app.asar.unpacked`; prefer that over the asar copy. */
function resolveUnpackedDependencyRoot(specifier: string): string | null {
  const resources = process.resourcesPath
  if (typeof resources !== 'string' || resources.length === 0) return null
  const root = join(resources, 'app.asar.unpacked', 'node_modules', ...specifier.split('/'))
  return existsSync(join(root, 'package.json')) ? root : null
}

function locatePackage(specifier: string, moduleBase: string): string {
  let current = moduleBase
  for (;;) {
    const candidate = join(current, 'node_modules', ...specifier.split('/'))
    if (existsSync(join(candidate, 'package.json'))) return candidate
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }

  // Last resort: a layout where the package is only reachable through the resolver.
  try {
    const manifest = createRequire(join(moduleBase, 'index.js')).resolve(`${specifier}/package.json`)
    return dirname(manifest)
  } catch {
    throw new LaunchResolutionError(
      `${specifier} is not installed under ${moduleBase}. Run "pnpm install" so the engine ships with the app.`
    )
  }
}

/**
 * pi ships a bundled CLI; the desktop app runs it through Electron's own Node so the
 * installer never depends on a Node installation on the user's machine.
 */
export function resolvePiEntry(moduleBase?: string): string {
  const override = process.env['GENTLE_DESKTOP_PI_ENTRY']
  if (override) return resolve(override)

  const root = locatePackage(PI_PACKAGE, moduleBaseOrDefault(moduleBase))

  const entry = join(root, 'dist', 'bundle', 'cli.js')
  if (!existsSync(entry)) {
    throw new LaunchResolutionError(`pi bundle is missing at ${entry}`)
  }
  return entry
}

/** Root of the published gentle-pi package, loaded into pi with `-e`. */
export function resolveGentlePiRoot(moduleBase?: string): string {
  const override = process.env['GENTLE_DESKTOP_GENTLE_PI_ROOT']
  if (override) return resolve(override)
  const unpacked = resolveUnpackedDependencyRoot(GENTLE_PI_PACKAGE)
  if (unpacked) return unpacked
  return locatePackage(GENTLE_PI_PACKAGE, moduleBaseOrDefault(moduleBase))
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
  /** Directory dependency resolution starts from; the packaged app passes `__dirname`. */
  moduleBase?: string
}

export function buildLaunchPlan(options: LaunchOptions = {}): LaunchPlan {
  const home = resolveAgentHome()
  const piEntry = resolvePiEntry(options.moduleBase)
  const gentlePiRoot = resolveGentlePiRoot(options.moduleBase)
  const cwd = resolve(options.cwd ?? process.cwd())

  // The engine must read the store the Models window writes: without this, the child
  // would fall back to ~/.pi/gentle-ai while the app resolves ~/.gentle-shell/gentle-ai
  // (resolveDesktopConfigHome's own desktop layer), and the user's profiles would be
  // invisible to the engine. The resolved directory is advertised through the launcher
  // marker the engine already honours — but never when GENTLE_PI_CONFIG_HOME is set,
  // because that variable wins inside the engine and must not be shadowed, and never
  // as an empty string, which the engine would treat as unset anyway.
  const desktopConfigHome = resolveDesktopConfigHome(process.env, homedir(), existsSync)
  const engineEnv: NodeJS.ProcessEnv = { ...process.env }
  if (!engineEnv['GENTLE_PI_CONFIG_HOME']) engineEnv['GENTLE_SHELL_CONFIG_HOME'] = desktopConfigHome

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
      ...engineEnv,
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
