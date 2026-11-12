import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { RepoStatus } from '../shared/ipc.ts'

/**
 * Working-tree status for the rail, in the same spirit as gentle-pi's
 * `shell-changes.ts`: Git is the source of truth and this module only turns
 * raw porcelain/numstat output into a display model. Parsing is pure so the
 * contracts live in `tests/repoStatus.test.mts` without spawning Git.
 */

const GIT_TIMEOUT_MS = 5000
const RENAME_BRACES = /\{([^{}]*) => ([^{}]*)\}/g
// Porcelain writes a plain rename as `old -> new`; the ` => ` arrow only appears inside
// the brace form, `src/{a.ts => b.ts}`. Using the numstat arrow here matched nothing.
const RENAME_ARROW = ' -> '

export function emptyRepoStatus(): RepoStatus {
  return { branch: null, dirtyCount: 0, added: 0, removed: 0, files: [] }
}

/** Numstat marks binary files and unreadable counts with `-`; that is zero, never NaN. */
function countField(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

/** Renames carry their old path either in braces or after an arrow; the new path wins. */
function renamedPath(path: string): string {
  if (path.includes('{') && path.includes(' => ')) {
    return path.replace(RENAME_BRACES, '$2').replace(/\/\//g, '/')
  }
  const arrow = path.indexOf(RENAME_ARROW)
  return arrow === -1 ? path : path.slice(arrow + RENAME_ARROW.length)
}

export interface ParsedPorcelain {
  branch: string | null
  files: string[]
  untracked: string[]
}

/**
 * `git status --porcelain=v1 --branch`: the first line carries the branch, every
 * following record is `XY path` where `??` marks an untracked file. Rename records
 * are followed by one extra line with the original path, which is skipped.
 */
export function parsePorcelain(text: string): ParsedPorcelain {
  const result: ParsedPorcelain = { branch: null, files: [], untracked: [] }
  const lines = text.split('\n')

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    if (line.length === 0) continue

    if (line.startsWith('## ')) {
      const header = line.slice(3)
      if (header.startsWith('HEAD (no branch)') || header.includes('(no branch)')) {
        result.branch = null
      } else if (header.startsWith('No commits yet on ')) {
        result.branch = header.slice('No commits yet on '.length)
      } else {
        // `main...origin/main [ahead 1]` and a plain `main` both name the branch first.
        const name = header.split('...')[0]?.split(' ')[0] ?? ''
        result.branch = name.length > 0 ? name : null
      }
      continue
    }

    const status = line.slice(0, 2)
    const path = renamedPath(line.slice(3))
    if (path.length === 0) continue
    result.files.push(path)
    if (status === '??') result.untracked.push(path)
    // Porcelain v1 without `-z` writes a rename as a single `R  old -> new` line, so there
    // is no continuation record to skip. Advancing the index here dropped the next file.
  }

  return result
}

export interface NumstatTotals {
  added: number
  removed: number
}

export function parseNumstat(text: string): NumstatTotals {
  let added = 0
  let removed = 0
  for (const line of text.split('\n')) {
    const fields = line.split('\t')
    if (fields.length < 3) continue
    added += countField(fields[0])
    removed += countField(fields[1])
  }
  return { added, removed }
}

export interface RepoStatusInputs {
  porcelain: string
  numstat: string
  stagedNumstat: string
  /** Untracked files never appear in numstat; their content is counted as added lines. */
  lineCount: (path: string) => number
}

export function buildRepoStatus(inputs: RepoStatusInputs): RepoStatus {
  const parsed = parsePorcelain(inputs.porcelain)
  const worktree = parseNumstat(inputs.numstat)
  const staged = parseNumstat(inputs.stagedNumstat)

  let added = worktree.added + staged.added
  for (const path of parsed.untracked) added += inputs.lineCount(path)

  return {
    branch: parsed.branch,
    dirtyCount: parsed.files.length,
    added,
    removed: worktree.removed + staged.removed,
    files: parsed.files
  }
}

function countLines(cwd: string, path: string): number {
  try {
    const raw = readFileSync(join(cwd, path), 'utf8')
    if (raw.length === 0) return 0
    return raw.split('\n').length - (raw.endsWith('\n') ? 1 : 0)
  } catch {
    // An unreadable untracked file contributes no lines rather than failing the rail.
    return 0
  }
}

function runGit(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      args,
      { cwd, timeout: GIT_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024, windowsHide: true },
      (error, stdout) => {
        if (error) reject(error)
        else resolve(stdout)
      }
    )
  })
}

/**
 * A directory outside a repository (or any Git failure) is nulls and zeros: the rail
 * simply has no Changes row instead of an error.
 */
export async function collectRepoStatus(cwd: string): Promise<RepoStatus> {
  try {
    const porcelain = await runGit(cwd, ['status', '--porcelain=v1', '--branch'])
    const [numstat, stagedNumstat] = await Promise.all([
      runGit(cwd, ['diff', '--numstat']),
      runGit(cwd, ['diff', '--cached', '--numstat'])
    ])
    return buildRepoStatus({ porcelain, numstat, stagedNumstat, lineCount: (path) => countLines(cwd, path) })
  } catch {
    return emptyRepoStatus()
  }
}
