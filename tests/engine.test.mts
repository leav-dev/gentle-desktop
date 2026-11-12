import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { buildLaunchPlan } from '../src/main/rpc/launch.ts'
import { RpcTransport } from '../src/main/rpc/transport.ts'
import type { DialogRequest, ExtensionUiRequest, RpcEvent } from '../src/shared/protocol.ts'

const repoRoot = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const PI_ENTRY = join(repoRoot, 'node_modules', '@earendil-works', 'pi-coding-agent', 'dist', 'bundle', 'cli.js')
const GENTLE_PI_ROOT = join(repoRoot, 'node_modules', 'gentle-pi')

test(
  'the engine starts as an interactive RPC host and loads gentle-pi extensions',
  { timeout: 180_000 },
  async (t) => {
    const home = mkdtempSync(join(tmpdir(), 'gentle-desktop-engine-'))
    const previous = {
      home: process.env['GENTLE_SHELL_HOME'],
      entry: process.env['GENTLE_DESKTOP_PI_ENTRY'],
      root: process.env['GENTLE_DESKTOP_GENTLE_PI_ROOT']
    }
    process.env['GENTLE_SHELL_HOME'] = home
    process.env['GENTLE_DESKTOP_PI_ENTRY'] = PI_ENTRY
    process.env['GENTLE_DESKTOP_GENTLE_PI_ROOT'] = GENTLE_PI_ROOT

    t.after(() => {
      for (const [key, value] of [
        ['GENTLE_SHELL_HOME', previous.home],
        ['GENTLE_DESKTOP_PI_ENTRY', previous.entry],
        ['GENTLE_DESKTOP_GENTLE_PI_ROOT', previous.root]
      ] as const) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
    })

    const plan = buildLaunchPlan({ cwd: home })
    const child = spawn(plan.command, plan.args, {
      cwd: plan.cwd,
      env: plan.env,
      stdio: ['pipe', 'pipe', 'pipe']
    })

    const events: RpcEvent[] = []
    const dialogs: DialogRequest[] = []
    const notices: ExtensionUiRequest[] = []
    const protocolErrors: Error[] = []
    let stderr = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
    })

    const transport = new RpcTransport(child, {
      onEvent: (event) => events.push(event),
      onDialog: (request) => dialogs.push(request),
      onNotice: (request) => notices.push(request),
      onProtocolError: (error) => protocolErrors.push(error),
      onExit: () => {}
    })

    t.after(() => {
      transport.close()
      transport.kill('SIGKILL')
    })

    const state = await transport.request<{ sessionId?: string; sessionFile?: string | null }>({
      type: 'get_state'
    })
    assert.ok(
      typeof state?.sessionId === 'string' || typeof state?.sessionFile === 'string',
      `the engine answered get_state with a session identity (stderr: ${stderr.slice(-400)})`
    )

    const { commands } = await transport.request<{ commands: Array<{ name: string; source?: string }> }>({
      type: 'get_commands'
    })
    assert.ok(Array.isArray(commands), 'get_commands returns a list')
    const gentleCommands = commands.filter((command) => command.name.includes('gentle'))
    assert.ok(
      gentleCommands.length > 0,
      `gentle-pi extensions are loaded in the engine; got ${commands
        .slice(0, 15)
        .map((command) => command.name)
        .join(', ')}`
    )

    assert.equal(dialogs.length, 0, 'nothing prompts the user before the first turn')
    assert.equal(protocolErrors.length, 0, `the stream stayed parseable: ${protocolErrors.map((e) => e.message)}`)
    assert.equal(notices.length >= 0, true)
  }
)
