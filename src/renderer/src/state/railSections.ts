import type { OddTaskFeature, RepoStatus } from '../../../shared/ipc.ts'

/**
 * The rail is a preset, fixed list of sections in fixed order: Status → Tasks
 * (gentle-desktop S11). Status is always first, because the session's own state is the anchor
 * the rest of the panel is read against; Integrations and Profiles are groups inside it
 * rather than sections of their own.
 *
 * Helpers is gone from the layout: subagent activity is read in the Agents window, which
 * shows the same thing with room to breathe. Repeating it in a 50-column rail earned no
 * space back. Jobs has no desktop data source yet, so it never appears either. A section with nothing to show
 * is not rendered at all — no empty panel, no placeholder row, no zero count — and the
 * remaining sections keep their order and appearance.
 *
 * Status is the exception: it is always present, because "is the engine healthy, what is it
 * allowed to do, and which session is this" has an answer at all times. An empty Status
 * section is a defect, not a state.
 */
export type RailSectionId = 'status' | 'tasks'

export interface RailData {
  tasks: readonly OddTaskFeature[]
  repo: RepoStatus | null
  sessionName: string | null
  /** Optional so existing callers keep compiling; an absent list means no section. */
  integrations?: readonly { key: string; text: string }[]
  profiles?: readonly { name: string; agents: number }[]
}

/**
 * Integrations are whatever the loaded extensions report about themselves. One of them is the
 * skill registry, which announces itself on every refresh and ends up owning the group.
 *
 * This retires that entry from the *view* only: the extension keeps indexing skills, the entry
 * keeps arriving in state, and nothing here touches the engine. Matching is on the reported
 * name, not on a position, so a renamed entry cannot quietly come back — it would simply be
 * visible again, which is the honest failure.
 */
const SKILL_REGISTRY_ENTRY = /skill/i

export function visibleIntegrations(
  integrations: readonly { key: string; text: string }[]
): { key: string; text: string }[] {
  return integrations.filter(
    (entry) => !SKILL_REGISTRY_ENTRY.test(entry.key) && !SKILL_REGISTRY_ENTRY.test(entry.text)
  )
}

export function visibleRailSections(data: RailData): RailSectionId[] {
  // First and always: the session's own state anchors everything read below it.
  const sections: RailSectionId[] = ['status']
  if (data.tasks.length > 0) sections.push('tasks')
  return sections
}
