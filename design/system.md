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

| Role | Stack |
| --- | --- |
| Chrome, transcript, code | `ui-monospace, "Cascadia Code", "SF Mono", Consolas, monospace` |
| Long-form prose inside messages | `ui-sans-serif, system-ui, "Segoe UI", sans-serif` |

Scale: `12px` meta, `13px` chrome, `14px` body, `15px` section titles. Line height `1.55`
for prose, single-row `1.25` for chrome rows. Bold is semantic: section titles, mode badges
and the brand petal. Dim is metadata only.

## Spacing and radius

- Base unit `4px`; gaps between transcript items `10px`; rail row padding `6px 10px`.
- Radius `7px` for cards and buttons, `10px` for the prompt panel.
- Right rail is a fixed `50ch` column with a `3ch` gap, matching the terminal's 50-column
  rail and 3-column gap; it collapses below `140ch` of available width, exactly like the
  terminal's `SIDEBAR_BREAKPOINT = 140`.

## Component rules

- **Prompt panel** — the only place the petal appears: `✿` plus a state label (`exploring…`,
  `waiting for input`), a rule above the field, and the input prefixed with `› `. Never a
  boxed chat input.
- **Status bar** — one row, segments separated by `│`: branch with `±N`, mode badge, model
  and effort, context gauge, cost. Segments drop from the right when space runs out.
- **Rail sections** — `▾ NAME` + count. Order is fixed: Tasks, Jobs, Helpers, then session
  status. Section headers are not buttons; the whole section is scannable.
- **Tool card** — bordered, title in `--champagne`, status glyph, elapsed time at the right
  of the top rule. Failures switch the body to `--tool-error-bg`.
- **Session history is not a permanent list** — it is a picker opened on demand, as in the
  terminal.
- Glyphs carry meaning and are never decorative: `○ ◐ ✓ ✗ ⊘ ✕ ▰ ▱ ✎ ▾ ▸ › ✿ ❀`.
