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

S6. The engine is consumed, not copied: the app launches the published `pi` runtime with
    gentle-pi's extensions enabled and `GENTLE_SHELL_INTERACTIVE_HOST=1`, so upstream
    engine fixes remain reachable. Engine code is vendored only for a patch that cannot
    be expressed as an extension.

## Tasks

T1. Scaffold the Electron + React + TypeScript project (main / preload / renderer, Vite,
    dev and build scripts, pnpm). Commit 1. — S4
T2. Spawn and supervise the `pi --mode rpc` child with gentle-pi's extensions enabled and
    `GENTLE_SHELL_INTERACTIVE_HOST=1`; typed transport with framing, correlation, and
    restart on crash. Commit 2. — S1, S6
T3. Bridge main to renderer: contextIsolation-safe preload API for session create, prompt,
    abort, and event subscription. Commit 2. — S5.1
T4. Session list and creation, persisted and reopenable. Commit 3. — S5.1
T5. Chat transcript with streamed assistant text and tool-call cards including inline
    diffs. Commit 4. — S5.1, S5.2
T6. Native dialogs for `ask_user_question` / `ask_user_choice`, multi-question and
    multiSelect, with cancellation. Commit 5. — S5.3
T7. Permission and review-consent prompts rendered and answered from the app. Commit 5.
    — S5.4
T8. Packaging: installers for Windows and macOS, MIT license and attribution, README that
    documents build, run, and the upstream relationship. Commit 6. — S1, S3

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

L6. Evidence: gentle-pi `lib/rpc-host.ts` already defines the desktop contract
    (`GENTLE_SHELL_INTERACTIVE_HOST=1` on a `pi --mode rpc` process), documented in
    `docs/readme-reference.md` and `docs/gentle-agents-activity.md`. The desktop host is
    the sanctioned integration path, so the TUI render layer is the only thing replaced.
