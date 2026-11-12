import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { AgentPermissionMode } from '../shared/ipc.ts'

/**
 * Reads the agent's permission mode the way gentle-pi persists it.
 *
 * The mode is not part of pi's RPC surface, so it comes from the same file the terminal
 * reads: `<gentle config home>/permission-mode.json`, holding `{ schema, mode }`.
 *
 * Parsing is deliberately tolerant about `schema`: a future schema value must not hide a
 * mode that is still readable. An unreadable or malformed file is reported as `normal`,
 * because that is the guarded mode — showing "YOLO" when the agent is actually guarded
 * would be the dangerous direction to be wrong in.
 */
export function permissionModeFile(configHome: string): string {
  return join(configHome, 'permission-mode.json')
}

export function resolveConfigHome(): string {
  const override = process.env['GENTLE_SHELL_CONFIG_HOME']
  return override ? override : join(homedir(), '.gentle-shell', 'gentle-ai')
}

const MODES: readonly AgentPermissionMode[] = ['normal', 'auto', 'yolo', 'super-yolo']

export function parsePermissionMode(raw: string): AgentPermissionMode {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return 'normal'
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return 'normal'

  const mode = (parsed as { mode?: unknown }).mode
  return typeof mode === 'string' && (MODES as readonly string[]).includes(mode)
    ? (mode as AgentPermissionMode)
    : 'normal'
}

export function readPermissionMode(configHome: string = resolveConfigHome()): AgentPermissionMode {
  const file = permissionModeFile(configHome)
  if (!existsSync(file)) return 'normal'

  try {
    return parsePermissionMode(readFileSync(file, 'utf8'))
  } catch {
    return 'normal'
  }
}
