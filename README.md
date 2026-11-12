# Gentle Desktop

A desktop application that runs the **Gentle Shell** experience outside a terminal.

Gentle Shell is a terminal application: it renders its whole interface inside a TUI and
spawns the `pi` coding agent as a child process. This project keeps that engine and
replaces only the terminal render layer, so ODD tracking, RDD review gates, subagents and
extensions behave exactly as upstream defines them.

> Independent project. Not affiliated with, endorsed by, or sponsored by the Gentle Shell
> project or Earendil Works. See [NOTICE](NOTICE) before you publish a build.

Part of the community around the Gentle tooling, and filed under the
[`gentle-hub-project`](https://github.com/topics/gentle-hub-project) topic. The name is a
working title: it is used until the upstream project confirms whether it may be kept.

## How it works

```
┌──────────────────────────────┐
│ renderer (React)             │  transcript, tool cards, dialogs, composer
└──────────────┬───────────────┘
               │ contextBridge (typed, no Node in the renderer)
┌──────────────▼───────────────┐
│ main (Electron, Node)        │  supervision, session listing, framing
└──────────────┬───────────────┘
               │ stdin/stdout, newline-delimited JSON
┌──────────────▼───────────────┐
│ pi --mode rpc                │  the engine, with gentle-pi extensions loaded
│  GENTLE_SHELL_INTERACTIVE_HOST=1
└──────────────────────────────┘
```

The engine is not reimplemented. `pi --mode rpc` is a documented bidirectional protocol,
and `GENTLE_SHELL_INTERACTIVE_HOST=1` is the flag gentle-pi already reads to route
`ask_user_question`, `ask_user_choice`, permission confirmations and live subagent activity
to a host that is not a terminal. This app is that host.

Three consequences worth knowing:

- **No tool-approval event exists.** pi never blocks on approvals; permission decisions are
  extension-owned and surface as `select`/`confirm` dialogs. The app renders those dialogs,
  which is why permissions need no separate integration.
- **Sessions are listed from disk.** pi has no list-sessions command, so the main process
  reads the session files and reopens one with `switch_session`.
- **Framing is LF-only.** Records are split on `\n` and nothing else; Node's `readline` also
  splits on U+2028/U+2029 and corrupts message payloads.

## Requirements

- Node.js 22 or newer in development
- pnpm 10 or newer
- An Electron release that bundles **Node.js 22 or newer** (Electron 35+; the project pins a
  current release). This is not cosmetic: pi's bundle imports `node:module`'s
  `enableCompileCache`, so an older Electron opens the window and then fails to start the
  engine. Electron runs pi with `ELECTRON_RUN_AS_NODE=1`, which is what makes the installer
  independent of any Node installed on the user's machine.

## Run it

```bash
pnpm install
pnpm dev
```

The app starts its own engine on launch. It uses your Gentle Shell home when one exists
(`~/.gentle-shell/agent`), otherwise your pi home (`~/.pi/agent`). Credentials are never
copied or moved.

## Checks

```bash
pnpm typecheck          # both projects, strict
pnpm build              # main, preload and renderer bundles
pnpm test               # all tests
pnpm test:engine        # integration: spawns the real engine, asserts extensions load
```

`test:engine` starts a real `pi --mode rpc` child, so it takes tens of seconds. It proves
the two claims this architecture rests on: the child answers `get_state`, and `get_commands`
contains gentle-pi commands, meaning the extensions loaded inside pi.

## Package it

```bash
pnpm dist
```

Installers land in `release/`. Verify what actually went inside before shipping it:

```bash
node scripts/verify-package.mjs
```

It fails when the packaged build is missing the engine, the gentle-pi extensions or the
renderer bundle — a build can succeed while shipping an app that cannot start an agent.

On Windows the installer step needs symlink privileges: electron-builder extracts its
signing toolchain into the user cache and fails with
`Cannot create symbolic link ... privilege required` on an account without that right.
Either enable Windows Developer Mode, or build the runnable directory without an installer:

```bash
CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --dir
```

That produces `release/win-unpacked/Gentle Desktop.exe`, which is the full app.

Always close a running build before repackaging. Rewriting `release/` while the app holds
its own files leaves a half-written package that starts and exits with code 1 and no
message — Windows refuses to replace a mapped executable, and nothing warns you.

## Layout

| Path | Role |
| --- | --- |
| `src/main/rpc/launch.ts` | resolves the pi bundle and builds the child launch plan (argv, env) |
| `src/main/rpc/transport.ts` | newline-delimited JSON framing, request correlation, dialogs |
| `src/main/rpc/host.ts` | one supervised engine child, restarts, dialog bookkeeping |
| `src/main/sessions.ts` | session listing derived from pi's session files |
| `src/shared/protocol.ts` | the RPC wire types, including the dialog subprotocol |
| `src/shared/ipc.ts` | the main↔renderer contract |
| `src/renderer/` | the React surface |
| `odd/tasks/gentle-desktop.md` | the specification and task log for this fork |

## Upstream relationship

The engine is consumed as published npm dependencies, not vendored:

- `@earendil-works/pi-coding-agent` — the agent runtime and RPC mode
- `gentle-pi` — the Gentle Shell extensions, ODD and RDD

Engine fixes therefore stay reachable by bumping a version. Code is vendored only for a
patch that cannot be expressed as an extension.

## License

MIT. See [LICENSE](LICENSE), which preserves the upstream notices.
