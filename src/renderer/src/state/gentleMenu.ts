import type { CommandChoice } from '../../../shared/ipc.ts'

/**
 * The Gentle window's contents (gentle-desktop S17), kept as a pure function so node can
 * pin it: the destinations a user reaches for when they want to change something about the
 * agent, resolved against the commands this engine actually exposes.
 *
 * Three of these are the app's own surfaces and always exist. The other two are engine
 * commands — profiles and permission mode — and they are only offered when the engine
 * reports the command. A row that runs a command the engine does not have is worse than a
 * missing row: the user presses it, a turn starts, and nothing happens.
 */

export type GentleDestinationId = 'profiles' | 'mode' | 'subagents' | 'providers' | 'commands'

export interface GentleDestination {
  id: GentleDestinationId
  /** What the user is changing, in their words, not the command's. */
  label: string
  /** One line that says what pressing it does. */
  detail: string
  /** The command to run through the prompt path, or null for an app surface. */
  command: string | null
}

/**
 * Finds the command a destination maps to.
 *
 * Matching is on the command name only, never the description: a description mentioning
 * "profile" does not make that command the profile picker. Engine commands arrive as
 * `gentle:profiles`, so a bare substring match is enough and a prefix would be brittle.
 */
function findCommand(commands: readonly CommandChoice[], pattern: RegExp): string | null {
  for (const command of commands) {
    const name = typeof command.name === 'string' ? command.name.toLowerCase() : ''
    if (name.length > 0 && pattern.test(name)) return command.name
  }
  return null
}

/**
 * Builds the destination list in a fixed order: the things that change *how the agent
 * behaves* come first, then who is working, where the keys live, and finally the escape
 * hatch to every command the engine has.
 */
export function resolveGentleDestinations(commands: readonly CommandChoice[]): GentleDestination[] {
  const destinations: GentleDestination[] = []

  const profiles = findCommand(commands, /profile/)
  if (profiles !== null) {
    destinations.push({
      id: 'profiles',
      label: 'Profiles',
      detail: 'Switch the model profile the agents run under',
      command: profiles
    })
  }

  const mode = findCommand(commands, /(^|[^a-z])(mode|permission)/)
  if (mode !== null) {
    destinations.push({
      id: 'mode',
      label: 'Permission mode',
      detail: 'Choose how often the agent asks before acting',
      command: mode
    })
  }

  destinations.push(
    {
      id: 'subagents',
      label: 'Subagents',
      detail: 'See which agents are running and what they are doing',
      command: null
    },
    {
      id: 'providers',
      label: 'Providers',
      detail: 'Connect a provider, or add one with its own server address',
      command: null
    },
    {
      id: 'commands',
      label: 'All commands',
      detail: 'Everything this engine exposes, with a filter',
      command: null
    }
  )

  return destinations
}
