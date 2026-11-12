import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The working folder (S17): how it is named for a person, and how the user's chosen
 * folder is remembered across launches.
 *
 * Two display rules shape the label:
 *   - a window still running from the application's own directory (the packaged case,
 *     whose folder is named `win-unpacked` or similar) must say so plainly instead of
 *     naming a folder that means nothing to the user;
 *   - a path with no last segment (a drive root such as `C:\`) must still show
 *     something identifiable, so the path itself is used.
 *
 * The remembered record lives next to the app's other state (`userData`), never in the
 * repository, and anything missing, unreadable, malformed, or pointing at a folder that
 * no longer exists reads as "no choice yet" rather than as an error.
 */

/** What the header shows for the folder the agent works in. */
export interface WorkspaceLabel {
  /** The text shown in the header; the full path stays on the tooltip. */
  name: string
  /** The full path, for the tooltip only — never the transcript or the rail. */
  fullPath: string
  /** True when the folder is the application's own (the packaged case). */
  inAppFolder: boolean
}

/** Plain words for the packaged case, where the folder name means nothing to a person. */
export const APP_FOLDER_LABEL = "this app's folder"

export const REMEMBERED_WORKSPACE_FILE = 'workspace.json'

/**
 * Unifies separators and drops a trailing one, so `C:\apps` and `C:/apps/` compare equal.
 * A drive root keeps its meaning after stripping: `C:\` and `C:/` both become `C:`.
 */
function normalizePath(path: string): string {
  return path.replace(/\//g, '\\').replace(/\\+$/, '')
}

function foldCase(path: string): string {
  // Windows folder names are case-insensitive; elsewhere the case is the name.
  return process.platform === 'win32' ? path.toLowerCase() : path
}

/** True when `cwd` is the application's own directory or somewhere inside it. */
function sameOrInside(cwd: string, appDir: string): boolean {
  const normalizedCwd = foldCase(normalizePath(cwd))
  const normalizedAppDir = foldCase(normalizePath(appDir))
  if (normalizedCwd === normalizedAppDir) return true
  return normalizedCwd.startsWith(`${normalizedAppDir}\\`)
}

/**
 * Names the working folder for the header, or null when there is nothing to name yet
 * (the engine has not reported a folder).
 */
export function workspaceLabel(
  cwd: string | null | undefined,
  appDir: string | null | undefined
): WorkspaceLabel | null {
  if (cwd === undefined || cwd === null || cwd.length === 0) return null

  if (appDir !== undefined && appDir !== null && appDir.length > 0 && sameOrInside(cwd, appDir)) {
    return { name: APP_FOLDER_LABEL, fullPath: cwd, inAppFolder: true }
  }

  // The last segment, for both separators: a wrong pattern would silently show everything.
  const lastSeparator = Math.max(cwd.lastIndexOf('/'), cwd.lastIndexOf('\\'))
  const folder = cwd.slice(lastSeparator + 1)
  // A drive root has no last segment; the path itself is the identifiable name.
  const name = folder.length > 0 ? folder : cwd
  return { name, fullPath: cwd, inAppFolder: false }
}

/** Where the application itself runs from: its install directory when packaged. */
export function applicationDirectory(exePath: string, isPackaged: boolean, devCwd: string): string {
  if (!isPackaged) return devCwd
  const lastSeparator = Math.max(exePath.lastIndexOf('/'), exePath.lastIndexOf('\\'))
  return lastSeparator > 0 ? exePath.slice(0, lastSeparator) : exePath
}

/**
 * Reads the folder the user chose in a previous launch, from the app's own state
 * directory. Anything missing, unreadable, malformed, or pointing at a folder that no
 * longer exists is "no choice yet" — never a reason to fail the launch.
 */
export function readRememberedWorkspace(stateDir: string): string | null {
  let raw: string
  try {
    raw = readFileSync(join(stateDir, REMEMBERED_WORKSPACE_FILE), 'utf8')
  } catch {
    return null
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const folder = (parsed as { folder?: unknown }).folder
  if (typeof folder !== 'string' || folder.length === 0) return null

  // The folder may have been deleted since the choice was made; an engine that cannot
  // run there would leave a broken window, so the record counts as absent instead.
  try {
    if (!statSync(folder).isDirectory()) return null
  } catch {
    return null
  }
  return folder
}

/** Remembers the chosen folder. A torn or failed write reads back as malformed, so the next launch falls back to the default rather than to a half-written path. */
export function writeRememberedWorkspace(stateDir: string, folder: string): void {
  mkdirSync(stateDir, { recursive: true })
  writeFileSync(join(stateDir, REMEMBERED_WORKSPACE_FILE), `${JSON.stringify({ folder }, null, 2)}\n`, 'utf8')
}
