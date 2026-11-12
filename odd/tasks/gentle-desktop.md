# gentle-desktop — a desktop host for Gentle Shell

Fork of `Gentleman-Programming/gentle-shell` (npm `gentle-pi`, MIT) that runs the Gentle
Shell experience as a self-launching desktop application instead of a terminal TUI.
The engine (pi extensions, ODD, RDD, subagents) is reused through pi's RPC mode; only the
terminal render layer is replaced.

Baseline: `gentle-pi@4.5.1-main`, pi `@earendil-works/pi-coding-agent@1.5.2`.

## Specs

S1. The product is a desktop application that launches itself and is usable without a
    terminal. User's words: "para de una tui a una app que se pueda ajecuitar ella misma,
    no en una terminal".

S2. The repository is a fork that diverges into its own product, not an upstream
    contribution branch. User's words: "Fork divergente, producto mío".

S3. The fork preserves the MIT license and original attribution, and is written so the
    community can read and reuse it. User's words: "quiero aportar a la comunidad del
    gentleman". Technical artifacts and documentation are written in English.

S4. Stack: Electron + React + TypeScript. Approved choice.

S5. First milestone ("rebanada vertical usable") delivers, and only delivers:
    S5.1 session list and creation, with assistant text streamed into the transcript;
    S5.2 tool calls rendered as cards, with an inline diff for file edits;
    S5.3 `ask_user_question` and `ask_user_choice` answered through native desktop
         dialogs, including multi-question and multiSelect forms;
    S5.4 permission and review-consent prompts answerable from the app.

S6. The app is free and non-commercial, and its purpose is reach: people who are not
    comfortable with a terminal should get the same engine. User's words: "hacer una
    version app para las personas no se sienten comodas con la versiond e terminal, no
    pienso cobrar nada de algo por el estilo, la idea que la herramienta de gentleman
    llegue a mas personas".

S8. Onboarding belongs to the first milestone: a person who has never opened a terminal
    must be able to install the app, connect a provider and start a conversation without
    seeing a terminal. User's words: "Sí, el wizard entra en el hito 1".

S9. Provider registration runs behind the app, driven from a configuration window instead
    of a visible terminal. User's words: "poder llamr por detras el proceso que se usa
    poara registrar el proveedor, se puede hacer una ventana que solite su configuracion
    sintener que mostrar la terminal".

S10. The app honours the provider configuration gentle-shell already has, including
    providers that gentle-pi contributes at runtime, and keeps as much of that setup as
    possible. User's words: "puedes usar la configuracion de proveedores de gentle-shell,
    la idea es tratar de manetener lo mas posible de el, y genlte-shell tie configurado
    otros provedores de los que me esta mostrando la app".

S11. The layout mirrors the Gentle Shell terminal: header row, transcript, a fixed 50-column
    rail ordered Tasks → Jobs → Helpers → Session, a petal prompt panel and one full-width
    status bar; the rail collapses below 140 columns. The palette is the one Gentle Shell
    gives a new user (Gentleman-Cute). Chosen direction: artboard
    `design/gentle-layout/01-terminal-faithful.html`.

S12. There is no permanent conversation list. Saved conversations are reached through a
    picker opened on demand, as in the terminal. User's words: "no me gusta tener un
    listado de las deams conversaiones".

S13. The commands the engine exposes are usable from the app: listed, filtered and executed
    with the same effect as typing them in the terminal. User's words: "se requiere que se
    soporten comando ... para respetar lo mas posible la experiencia de gentle shell".

S14. Surfaces the terminal shows as floating windows are floating overlays in the app, all
    sharing one chrome — rounded frame, title, tone, hint slot — instead of each feature
    inventing its own modal. User's words: "y las ventanas flotantes con las que cuenta
    gentel shell".

S7. The engine is consumed, not copied: the app launches the published `pi` runtime with
    gentle-pi's extensions enabled and `GENTLE_SHELL_INTERACTIVE_HOST=1`, so upstream
    engine fixes remain reachable. Engine code is vendored only for a patch that cannot
    be expressed as an extension.

## Tasks

T1. [x] Scaffold the Electron + React + TypeScript project (main / preload / renderer, Vite,
    dev and build scripts, pnpm). Done in d2c331d. — S4
T2. [x] Spawn and supervise the `pi --mode rpc` child with gentle-pi's extensions enabled and
    `GENTLE_SHELL_INTERACTIVE_HOST=1`; typed transport with framing, correlation, and
    restart on crash. Done in 6497cc5. — S1, S6
T3. [x] Bridge main to renderer: contextIsolation-safe preload API for session create, prompt,
    abort, and event subscription. Done in 6497cc5. — S5.1
T4. [x] Session list, creation and reopen, with the saved conversation hydrated into
    the transcript. — S5.1
T5. [x] Chat transcript with streamed assistant text and tool-call cards including inline
    diffs. Done in 6639da3. — S5.1, S5.2
T6. [x] Native dialogs for `ask_user_question` / `ask_user_choice`, multi-question and
    multiSelect, with cancellation. Done in 6639da3. — S5.3
T7. [x] Permission and review-consent prompts rendered and answered from the app; they
    reuse the dialog pipeline. Done in 6639da3. — S5.4
T9. [x] First-run setup: detect an already configured provider with the non-interactive
    readiness check, and otherwise drive provider registration from a configuration window
    with no visible terminal. — S8, S9
T12. [x] Offer every provider the running engine reports, not only those with a login
    flow, and let a ready provider be chosen by picking one of its models. — S10
T19. [x] Rebuild the window shell as the terminal layout: header row, transcript, 50-column rail
    with real data (agent activity, session stats, repository changes, ODD tasks), petal
    prompt panel and the status bar, in the Gentleman-Cute palette. Done in d3faf02. — S11
T20. [x] Replace the session sidebar with a history picker opened on demand. Done in
    d3faf02. — S12
T26. [x] Command palette: list the engine's commands over `get_commands`, filter by typing,
    navigate with the keyboard, and run the chosen one through `prompt "/<name>"`, with the
    palette closing and the turn starting as if it had been typed. Done in 035c4b8. — S13
T27. [x] Floating window chrome: one shared overlay component with the terminal's frame, tone
    variants and hint slot, adopted by the command palette, the history picker and the
    dialog host so every floating surface looks and behaves the same. Done in 035c4b8. — S14
T28. [x] Close the gaps that removing the status bar opened: extension notifications become
    a toast, extension status lines sit beside the prompt rule, and the engine phase stays
    visible in the top bar. Done in 035c4b8. — S11, S14
T13. Support providers that need a custom base URL by writing pi's own configuration,
    instead of asking the user to edit files. — S10
T10. Distribution: installers a non-technical person can run, plus a short first-run guide
    that never asks for a terminal command. Commit 8. — S1, S6
T8. Packaging: installers for Windows and macOS, MIT license and attribution, README that
    documents build, run, and the upstream relationship. Commit 6. — S1, S3

## Evidence

- E1 `pnpm typecheck` passes for both node and web projects.
- E2 `pnpm build` produces main, preload and renderer bundles.
- E3 `tests/engine.test.mts` spawns the real engine, gets a session identity from
  `get_state`, and asserts that `get_commands` contains gentle-pi commands — proof that the
  extensions load inside pi as an interactive RPC host.
- E5 `pi auth login` refuses to run without a TTY (`terminal.interactive` gate), so the
  CLI path cannot serve the app. The SDK behind it accepts an `AuthInteraction`, and a
  probe confirmed `login(provider, "api_key", interaction)` completes offline, asks its
  questions through the interaction, and writes `<home>/auth.json` with mode 0600.
  Provider registration therefore needs no PTY — the app asks the same questions in a
  window, and pi keeps custody of the credential.
- E6 `setRuntimeApiKey` is memory-only and does not persist; persistence goes through
  `login`. Pinned by `tests/auth.test.mts`.
- E7 Importing pi's SDK root in a headless process is safe even though it re-exports
  terminal UI modules: `tests/auth.test.mts` builds a runtime and reads the provider
  catalogue with no terminal attached.
- E8 A defect surfaced during verification and is now pinned: `ModelRuntime.create` with
  `refreshOnCreate: false` reports stored credentials as unconfigured, because the
  create-time refresh is what builds the status snapshot. Measured on the same `auth.json`:
  disabled → `{configured:false}`, default → `{configured:true, source:"stored"}` in 11 ms
  with `allowModelNetwork: false`. Left unfixed it would reopen the setup window on every
  launch after a successful sign-in.
- E14 Two packaged builds started and exited with code 1 printing nothing, and the cause was
  not the code: the asar was corrupt, so the app entry was unreadable and Electron quit
  before creating its user data directory. `scripts/verify-package.mjs` passed anyway,
  because it checked bundled files and never the `main` the packaged manifest declares. It
  now reads that entry from the archive and extracts it, and a clean rebuild passes.
  Lesson: verify the artifact you are about to run, not the files you expect inside it.
- E13 The delivered git porcelain parsing was wrong in two ways, and neither showed up in
  the handoff summary: it split renames on numstat's ` => ` arrow instead of porcelain's
  ` -> `, and then advanced the index by one for a continuation record that porcelain v1
  does not write. A rename therefore reported the whole `old -> new` string and swallowed
  the entry after it. Verified against real `git status --porcelain=v1` output and pinned
  by `tests/repoStatus.test.mts`.
- E12 Repackaging while the previous build was still running produced an app that exited
  with code 1 and wrote no message. Windows will not replace a mapped executable, so
  `release/` ended up half-written while `scripts/verify-package.mjs` still passed: it
  inspects the asar, not the executable. Close the app before packaging.
- E11 The setup window hid the user's own provider. `nan` is not missing from pi's
  catalogue by accident: `gentle-pi/lib/nan-provider.ts` declares `NAN_PROVIDER_ID = "nan"`
  and registers it as a runtime extension. A bare SDK runtime therefore reports 43
  providers without `nan`, while the engine offers its models. The provider list must come
  from the engine; the SDK only contributes which providers have a login flow.
- E10 The first packaged launch failed with "engine is not running (phase: crashed)".
  Root cause: pi declares `exports` with an `import` condition only, so
  `require.resolve("<pkg>/package.json")` throws and the engine entry never resolved — in
  dev as well. It stayed hidden because every existing test set the env overrides that
  bypass resolution. Resolution now walks `node_modules` from an explicit module base,
  which also works inside `app.asar`, and the crash detail reaches stderr.
  Verified on the packaged app: the child runs
  `app.asar/.../pi-coding-agent/dist/bundle/cli.js --mode rpc -e app.asar/.../gentle-pi`.
- E9 The packaged build exposed a runtime contract that dev never showed: Electron 33
  bundles Node 20.18, and pi's bundle imports `node:module`'s `enableCompileCache`, which
  exists only on Node 22+. The window would open and the engine would die on spawn. The app
  therefore requires an Electron release that bundles Node 22 or newer, and
  `scripts/verify-package.mjs` checks that a packaged build actually contains the engine
  rather than trusting that the installer built.
- E4 `tests/launch.test.mts` pins the launch contract: `--mode rpc`, the interactive host
  flag, the owned agent home, single-load extension injection, and take-over mode.

## Log

L1. User request, verbatim: "quiero aportar a la comunidad del gentleman, quiero hacer un
    fork de gentle_shell para hacer version app"

L2. User clarification, verbatim: "quiero ahcer un fork para llevar gentle_shella una app
    de escritorio es decir para de una tui a una app que se pueda ajecuitar ella misma, no
    en una terminal"

L3. Decision: fork divergente, producto propio.

L4. Decision: Electron + React + TypeScript.

L5. Decision: first milestone is the usable vertical slice (sessions, streaming, tool
    cards, ask-user dialogs, permission/consent), not full TUI parity.

L7. User statement of purpose, verbatim: "hacer una version app para las personas no se
    sienten comodas con la versiond e terminal, no pienso cobrar nada de algo por el
    estilo, la idea que la herramienta de gentleman llegue a mas personas". Consequence:
    the audience is non-terminal users, so reach depends on distribution and first-run
    usability, not on the terminal being merely optional.

L8. Decision: onboarding is part of the first milestone. Provider registration runs behind
    the app through a configuration window; no terminal is shown to the user.

L9. Evidence: `pi auth check --provider <p> --json` reports `ready`/`not_ready`/`invalid`
    with exit codes 0/1/2 and needs no TTY, so the app can detect readiness itself;
    `pi auth login` is documented as requiring an interactive terminal, which the app must
    satisfy behind its own window. Credentials live in `<agent-dir>/auth.json`.

L11. Correction from the user, verbatim: "no veo la opciond e registrar mi proveedor de nan,
    puedes usar la configuracion de proveedores de gentle-shell, la idea es tratar de
    manetener lo mas posible de el, y genlte-shell tie configurado otros provedores de los
    que me esta mostrando la app". The defect was in this fork, not upstream: the setup
    window filtered to providers with a login flow and sourced its catalogue from the SDK
    instead of the running engine.

L10. Decision: provider registration uses pi's SDK `login` with an `AuthInteraction`
    implemented as GUI prompts (text, secret, select, manual_code) plus rendered
    `auth_url`/`device_code` events. No PTY, no credential handling by the app, OAuth stays
    available. Rejected: an embedded terminal (needs node-pty and still shows a terminal),
    and requiring a pre-configured pi (excludes the audience in S6).

L12. User feedback, verbatim: "no estoy logrando navegar en la conversacion, no me gusta tener un
    listado de las deams conversaiones, me gustaria aagrgar un layout como el de la tui de
    gentleman, la idea es mantener las intrezas tan parecida como se pueda a gentleman, para
    poder dar la experiencia mas fiel posible". Two responses: the transcript scroll defect is
    fixed (a flex child that could not shrink, plus auto-scroll that yanked the reader back),
    and the layout is designed in `design/gentle-layout/` with two directions that follow the
    terminal's structure and its Gentleman-Cute palette.

L13. Decision: implement artboard 01 (terminal faithful) and adopt the Gentleman-Cute
    palette, over the one-column alternative and over keeping the current blue accent.

L14. Design handoff: `design/gentle-layout/01-terminal-faithful.html` is the chosen artboard
    for T19/T20; `02-one-column-work-rows.html` stays as an alternative and is not being
    implemented. The artboard is the visual spec, not code to copy: colors, type, spacing
    and radius come from `design/system.md`. Two rules from the canvas apply to the build:
    a rail section with nothing to show is not rendered at all, and context usage plus cost
    live in the top bar only.

L16. User requirement, verbatim: "se requiere que se soporten comando y las ventanas
    flotantes con las que cuenta gentel shell para respetar lo mas posible la experiencia de
    gentle shell". Commands come from `get_commands` and run through `prompt "/<name>"`;
    floating windows follow the terminal's card chrome in `lib/shell-card.ts`.

L6. Evidence: gentle-pi `lib/rpc-host.ts` already defines the desktop contract
    (`GENTLE_SHELL_INTERACTIVE_HOST=1` on a `pi --mode rpc` process), documented in
    `docs/readme-reference.md` and `docs/gentle-agents-activity.md`. The desktop host is
    the sanctioned integration path, so the TUI render layer is the only thing replaced.
