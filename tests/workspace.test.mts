import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'
import {
  APP_FOLDER_LABEL,
  readRememberedWorkspace,
  workspaceLabel,
  writeRememberedWorkspace
} from '../src/main/workspace.ts'

/** Scratch state directories live outside the repository and are removed afterwards. */
const scratchDirs: string[] = []
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'gentle-desktop-workspace-'))
  scratchDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of scratchDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a normal project folder is shown by its last segment, with the full path for hover', () => {
  const windows = workspaceLabel('C:\\Users\\lea\\projects\\demo', null)
  assert.ok(windows !== null)
  assert.equal(windows.name, 'demo')
  assert.equal(windows.fullPath, 'C:\\Users\\lea\\projects\\demo')
  assert.equal(windows.inAppFolder, false)

  const posix = workspaceLabel('/home/lea/projects/demo', null)
  assert.ok(posix !== null)
  assert.equal(posix.name, 'demo')
  assert.equal(posix.inAppFolder, false)
})

test("the application's own directory says so instead of naming an installation folder", () => {
  const appDir = 'C:\\apps\\gentle desktop\\win-unpacked'
  const label = workspaceLabel(appDir, appDir)
  assert.ok(label !== null)
  assert.equal(label.name, APP_FOLDER_LABEL, 'the header names no installation folder')
  assert.equal(label.inAppFolder, true)
  assert.equal(label.fullPath, appDir)

  // A folder inside the application's own tree is still not a project folder.
  const nested = workspaceLabel('C:\\apps\\gentle desktop\\win-unpacked\\resources', appDir)
  assert.equal(nested?.name, APP_FOLDER_LABEL)

  // A folder outside it is named as usual.
  assert.equal(workspaceLabel('C:\\apps\\other\\demo', appDir)?.inAppFolder, false)

  if (process.platform === 'win32') {
    // Windows folder names are case-insensitive; the comparison must be too.
    assert.equal(workspaceLabel(appDir.toLowerCase(), appDir)?.inAppFolder, true)
  }
})

test('a path with no last segment still shows something identifiable', () => {
  const driveRoot = workspaceLabel('C:\\', null)
  assert.ok(driveRoot !== null)
  assert.equal(driveRoot.name, 'C:\\', 'a drive root shows the drive itself')
  assert.equal(driveRoot.fullPath, 'C:\\')

  const root = workspaceLabel('/', null)
  assert.ok(root !== null)
  assert.equal(root.name, '/')
  assert.equal(root.fullPath, '/')
})

test('the remembered folder record: valid, missing, unreadable or malformed', () => {
  const stateDir = scratch()
  assert.equal(readRememberedWorkspace(stateDir), null, 'a missing record is no choice yet')

  const folder = join(stateDir, 'projects', 'demo')
  mkdirSync(folder, { recursive: true })
  writeRememberedWorkspace(stateDir, folder)
  assert.equal(readRememberedWorkspace(stateDir), folder, 'a valid record is remembered')

  writeFileSync(join(stateDir, 'workspace.json'), 'this is not json at all')
  assert.equal(readRememberedWorkspace(stateDir), null, 'an unreadable record is no choice yet')

  writeFileSync(join(stateDir, 'workspace.json'), JSON.stringify({ folder: 42 }))
  assert.equal(readRememberedWorkspace(stateDir), null, 'a malformed record is no choice yet')

  // A folder that no longer exists cannot be worked in; the record is treated as absent
  // so the app falls back to its default instead of starting an engine that cannot run.
  writeFileSync(join(stateDir, 'workspace.json'), JSON.stringify({ folder: join(stateDir, 'deleted') }))
  assert.equal(readRememberedWorkspace(stateDir), null, 'a record for a deleted folder is no choice yet')
})
