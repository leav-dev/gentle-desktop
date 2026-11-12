# Design system

Tokens are recorded from sources, never invented. Two sources feed this system:

- **Palette** — the theme Gentle Shell ships and gives a new user:
  `node_modules/gentle-pi/themes/Gentleman-Cute.json`.
- **Structure and spacing** — the app's current stylesheet: `src/renderer/src/styles.css`.

The app's previous accent (`#7c9cff`) is retired in favour of the Gentle palette, because the
product goal is a faithful desktop rendering of the terminal experience.

## Colors

| Token | Value | Usage |
| --- | --- | --- |
| `--bg` | `#060407` | Page background |
| `--bg-panel` | `#100A0F` | Right rail, cards, elevated surfaces |
| `--selection` | `#28121E` | Selected row, active list item |
| `--user-bg` | `#2A1523` | User message block |
| `--text` | `#F6EFF3` | Primary text |
| `--muted` | `#A78E9B` | Meta text, section labels |
| `--dim` | `#76616B` | Hints, counts, disabled |
| `--accent` | `#F095C8` | Brand petal, focus, primary action |
| `--accent-strong` | `#FFB1DD` | Active border, hover on accent |
| `--border` | `#563040` | Card and rail borders |
| `--border-subtle` | `#2A1720` | Inner dividers |
| `--success` | `#B4E7C7` | Added lines, done states, clean |
| `--warning` | `#F2B86D` | Queued, needs-you, dirty counts |
| `--error` | `#FF718F` | Removed lines, failures |
| `--champagne` | `#E0C27A` | Tool titles |
| `--soft-rose` | `#D7A0B8` | Thinking text |
| `--powder-blue` | `#A9C7EE` | Model and secondary metadata |
| `--tool-ok-bg` | `#151316` | Tool card body |
| `--tool-error-bg` | `#261019` | Failed tool card body |

Contrast: `--text` on `--bg` is above AA; `--muted` is reserved for non-essential metadata
and never carries the only signal for an action.

## Typography

**One typeface for the whole application**, exposed as the `--font` token:

`ui-monospace, "Cascadia Code", "SF Mono", Consolas, monospace`

There is no second stack and no per-surface override — not for prose, not for dialogs, not
for the setup window. A different family anywhere reads as an accident, and the terminal it
mirrors has exactly one.

Scale: `11px` micro labels, `12px` meta, `13px` chrome and body, `15px` section titles.
Line height `1.55` for prose, `1.25` for single-row chrome. Bold is semantic: section titles,
mode badges and the brand petal. Dim is metadata only.

## Spacing and radius

- Base unit `4px`; gaps between transcript items `10px`; rail row padding `6px 10px`.
- Radius `7px` for cards and buttons, `10px` for the prompt panel.
- Right rail is a fixed `50ch` column with a `3ch` gap, matching the terminal's 50-column
  rail and 3-column gap; it collapses below `140ch` of available width, exactly like the
  terminal's `SIDEBAR_BREAKPOINT = 140`.

## Conversation rendering

The transcript mirrors the terminal, which is the reason this section exists: without it,
each attempt reinvented the styling.

- **Everything is monospaced**, including assistant prose: the transcript uses the single
  application typeface, never a second stack.
- **Assistant text is plain text**: no bubble, no border, no card, no avatar. It fills the
  conversation column.
- **User messages** are a `--user-bg` block with `› ` in `--accent` as their prefix, and the
  text is preserved verbatim with `white-space: pre-wrap`.
- **Thinking** is text in `--soft-rose` with no rule or frame; only the disclosure summary is
  `--dim`. Streaming markers use `▍` in `--accent`.
- **Tool calls** are framed cards: title in `--champagne`, status or elapsed time at the
  right of the header, body on `--tool-ok-bg` and `--tool-error-bg` when failed. A failed
  call turns the frame and the body, never the whole transcript.
- **Diffs** color additions `--success`, removals `--error`, and context `--dim`. Nothing
  else about a diff is colored.

## Component rules

- **Prompt panel** — the only place the petal appears: `✿` plus a state label (`exploring…`,
  `waiting for input`), a rule above the field, and the input prefixed with `› `. Never a
  boxed chat input.
- **Agent permission mode** (`🔥 YOLO`, `💥 SUPER-YOLO`) sits on the prompt rule immediately
  after the agent state, because it describes how the agent will act on the next turn. It is
  never a status-bar segment, and it is absent in the default guarded mode.
- **Top bar** — brand, the project folder name, branch with `±N`, and on the right: model
  with effort, context usage gauge with percent, subscription usage when the provider
  reports it, and cost with a `sub` marker on subscription billing. It carries no actions:
  they live on the action row, and an accelerator is never advertised twice.
  Everything the window needs to state lives here and nowhere else; nothing is repeated in
  the rail or the prompt rule.
- **Key map** — `Alt+K`/`⌥K` Gentle (settings), `Ctrl+K`/`⌘K` commands, `Ctrl+H`/`⌘H`
  history, `Alt+A`/`⌥A` agents, `Ctrl+,`/`⌘,` providers. `Ctrl+P` stays as an alias for
  commands. Every one of these is also a labelled row on the action row: no action exists
  only behind a shortcut.
- **There is no settings *form*.** The Gentle window is an index, not a second implementation:
  each row routes to the surface that already owns the setting — an engine command, the
  agents window, the providers window — and it never re-implements one. A row appears only
  when its target exists, so the window cannot offer a dead end.
- **Configuration is the command surface.** The terminal's command menu groups Configuration,
  Session, Diagnostics and Skills, and every one of those is an engine command. A separate
  settings dialog would fork a surface the engine already
  owns, so the palette is where configuration lives.
- **Action row** — a labelled button row directly under the top bar for every overlay and
  session action: New, History, Commands, Agents, Providers, and Show rail when it is
  folded. Each button carries its accelerator in dim text beside the label. This row is not
  optional chrome: it is how someone who has not learned the shortcuts reaches them, and no
  action may exist only as an accelerator.
- **Never show a full filesystem path** in the chrome. A folder name identifies the project;
  the absolute path is a tooltip at most.
- **There is no status bar.** Every value it used to repeat already has an owner: branch,
  model, context and cost in the top bar, work counts in the rail, and hints on the prompt
  rule. A second row restating them is noise, not information.
- **Rail sections** — `▾ NAME` + count. The set is predefined and the order is fixed:
  Tasks → Jobs → Helpers → Session. Section headers are not buttons; the whole section is
  scannable.
- **Scrollbars** — thin, on a transparent track, thumb in `--border` with the accent only
  on hover and `--accent-strong` while dragging. Scrolling containers reserve their gutter,
  so a bar appearing never shifts text.
- **Changes show a count, never a list.** The Status section states how many files changed
  and the line deltas; individual paths are noise in a status panel and belong to a
  dedicated view, not the chrome.
- **Rail order** — Status → Tasks → Helpers. Status is always the first section: the
  session's own state anchors everything read below it.
- **Integrations and Profiles are groups inside Status**, never sections of their own.
  Integrations lists one row per extension that reported a status key; Profiles lists the
  agent model profiles found on disk with how many agents each configures.
- **Status is always visible and always first.** It is the rail's only permanent section: engine health,
  permission mode, the session identity with its message count, and the working-tree
  changes. These are questions that have an answer at all times, so an empty Status section
  is not a state — it is a defect.
- **An unused rail section is not rendered at all** (Status excepted) — no empty panel, no placeholder row, no
  zero count. A window with no background job shows Tasks, Helpers and Session, and nothing
  where Jobs would be; the remaining sections do not renumber or change appearance.
- **Tool card** — bordered, title in `--champagne`, status glyph, elapsed time at the right
  of the top rule. Failures switch the body to `--tool-error-bg`.
- **Session history is not a permanent list** — it is a picker opened on demand, as in the
  terminal.
- Glyphs carry meaning and are never decorative: `○ ◐ ✓ ✗ ⊘ ✕ ▰ ▱ ✎ ▾ ▸ › ✿ ❀`.
