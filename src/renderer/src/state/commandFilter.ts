import type { CommandChoice } from '../../../shared/ipc.ts'

/**
 * Pure command-palette logic (gentle-desktop S13), kept free of React so node's test
 * runner can pin it directly: filtering, ranking, and the `/` trigger rule.
 */

/**
 * Skills are registered as commands by the engine (`skill:<name>`). They are not actions a
 * user reaches for while looking at an unfiltered list — the terminal keeps them in their own
 * group — so the default palette leaves them out. They stay discoverable: any query that
 * matches one brings it back, including typing `skill`.
 */
const SKILL_PREFIX = 'skill:'

/**
 * Filters and ranks commands for the palette.
 *
 * - an empty query returns every command in engine order, except skills;
 * - matching is a case-insensitive substring on name and description;
 * - a name match ranks above a description-only match, ties keep engine order;
 * - a command whose description is absent never throws and can still match by name;
 * - a leading `/` is ignored, because the prompt hands the palette its raw draft.
 */
export function filterCommands(commands: readonly CommandChoice[], rawQuery: string): CommandChoice[] {
  const query = rawQuery.replace(/^\//, '').trim().toLowerCase()
  if (query.length === 0) {
    return commands.filter((command) => !command.name.toLowerCase().startsWith(SKILL_PREFIX))
  }

  const byName: CommandChoice[] = []
  const byDescription: CommandChoice[] = []
  for (const command of commands) {
    const name = typeof command.name === 'string' ? command.name.toLowerCase() : ''
    const description = typeof command.description === 'string' ? command.description.toLowerCase() : ''
    if (name.includes(query)) byName.push(command)
    else if (description.includes(query)) byDescription.push(command)
  }
  return [...byName, ...byDescription]
}

/**
 * The `/` trigger: a slash typed as the first character of an empty prompt opens the
 * palette; a slash anywhere else is ordinary text (paths, division, code). The palette
 * owns the draft from there, so a second slash can never re-trigger it.
 */
export function shouldOpenPalette(previousDraft: string, nextDraft: string): boolean {
  return previousDraft.length === 0 && nextDraft.startsWith('/')
}
