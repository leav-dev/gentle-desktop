import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  buildRepoStatus,
  collectRepoStatus,
  emptyRepoStatus,
  parseNumstat,
  parsePorcelain
} from '../src/main/repo.ts'
import { visibleRailSections } from '../src/renderer/src/state/railSections.ts'

const porcelain = ['## main...origin/main [ahead 1]', ' M src/a.ts', '?? new.ts', ''].join('\n')

test('porcelain output yields the branch, the changed files, and the untracked ones', () => {
  const parsed = parsePorcelain(porcelain)
  assert.equal(parsed.branch, 'main')
  assert.deepEqual(parsed.files, ['src/a.ts', 'new.ts'])
  assert.deepEqual(parsed.untracked, ['new.ts'])
})

test('a detached head reports the branch as null', () => {
  const parsed = parsePorcelain(['## HEAD (no branch)', '?? x', ''].join('\n'))
  assert.equal(parsed.branch, null)
  assert.deepEqual(parsed.files, ['x'])
})

test('numstat totals ignore binary files instead of producing NaN', () => {
  const numstat = ['4\t2\tsrc/a.ts', '-\t-\tlogo.png', ''].join('\n')
  const parsed = parseNumstat(numstat)
  assert.equal(parsed.added, 4, 'the binary row contributes nothing')
  assert.equal(parsed.removed, 2)
  assert.equal(Number.isNaN(parsed.added), false)
})

test('untracked files count as added lines only, on top of the numstat totals', () => {
  const status = buildRepoStatus({
    porcelain,
    numstat: '4\t2\tsrc/a.ts\n',
    stagedNumstat: '1\t0\tsrc/a.ts\n',
    lineCount: (path: string) => (path === 'new.ts' ? 3 : 0)
  })
  assert.equal(status.branch, 'main')
  assert.equal(status.dirtyCount, 2)
  assert.equal(status.added, 8, '4 worktree + 1 staged + 3 untracked lines')
  assert.equal(status.removed, 2, 'untracked files never remove lines')
  assert.deepEqual(status.files, ['src/a.ts', 'new.ts'])
})

test('a clean repository yields zeros and an empty file list', () => {
  const status = buildRepoStatus({ porcelain: '## main\n', numstat: '', stagedNumstat: '', lineCount: () => 0 })
  assert.deepEqual(status, { branch: 'main', dirtyCount: 0, added: 0, removed: 0, files: [] })
})

test('collectRepoStatus returns nulls and zeros for a directory that is not a repository', async () => {
  const scratch = mkdtempSync(join(tmpdir(), 'gentle-desktop-repo-'))
  try {
    const status = await collectRepoStatus(scratch)
    assert.deepEqual(status, emptyRepoStatus())
    assert.equal(status.branch, null)
    assert.equal(status.dirtyCount, 0)
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
})

test('collectRepoStatus reads a real repository: branch, dirty count, and untracked additions', async () => {
  const scratch = mkdtempSync(join(tmpdir(), 'gentle-desktop-repo-real-'))
  const git = (args: string[]): void => {
    execFileSync('git', args, { cwd: scratch, stdio: 'ignore' })
  }
  try {
    git(['init', '-b', 'main'])
    writeFileSync(join(scratch, 'tracked.txt'), 'one\ntwo\nthree\n')
    git(['add', 'tracked.txt'])
    git(['-c', 'user.name=test', '-c', 'user.email=test@example.com', 'commit', '-m', 'init'])
    writeFileSync(join(scratch, 'tracked.txt'), 'one\ntwo\nthree\nfour\nfive\nsix\n')
    writeFileSync(join(scratch, 'fresh.txt'), 'new\n')

    const status = await collectRepoStatus(scratch)
    assert.equal(status.branch, 'main')
    assert.equal(status.dirtyCount, 2, 'one modified tracked file and one untracked file')
    assert.equal(status.added, 4, 'three appended lines plus the untracked file line')
    assert.equal(status.removed, 0)
    assert.ok(status.files.includes('tracked.txt'))
    assert.ok(status.files.includes('fresh.txt'))
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
})

test('Status is the one section that survives an otherwise empty rail', () => {
  const sections = visibleRailSections({
    tasks: [],
    activity: { counts: { running: 0, queued: 0, waiting: 0, finished: 0 }, tasks: [] },
    repo: { branch: 'main', dirtyCount: 0, added: 0, removed: 0, files: [] },
    sessionName: null
  })
  assert.deepEqual(
    sections,
    ['status'],
    'an empty data source yields no section, except Status, which always has an answer'
  )
})


test('a rename is one line and never swallows the next entry', () => {
  // Porcelain v1 without -z writes `R  old -> new` on a single line. Skipping a
  // continuation line silently dropped the file that followed the rename.
  const parsed = parsePorcelain(
    ['## main', 'R  old.txt -> new.txt', ' M other.txt', '?? fresh.ts', ''].join('\n')
  )

  assert.deepEqual(
    parsed.files,
    ['new.txt', 'other.txt', 'fresh.ts'],
    'every entry survives, and the rename reports its new path'
  )
  assert.deepEqual(parsed.untracked, ['fresh.ts'])
  assert.equal(parsed.branch, 'main')
})

test('a rename written with braces keeps the resolved path', () => {
  const parsed = parsePorcelain(['## main', 'R  src/{a.ts => b.ts}', ''].join('\n'))
  assert.deepEqual(parsed.files, ['src/b.ts'])
})
