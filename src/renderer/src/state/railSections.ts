import type { OddTaskFeature, RepoStatus } from '../../../shared/ipc.ts'
import type { AgentActivity } from './agentActivity.ts'

/**
 * The rail is a preset, fixed list of sections in fixed order:
 * Tasks → Jobs → Helpers → Session (gentle-desktop S11).
 *
 * Jobs has no desktop data source yet, so it never appears. A section with
 * nothing to show is not rendered at all — no empty panel, no placeholder row,
 * no zero count — and the remaining sections keep their order and appearance.
 */
export type RailSectionId = 'tasks' | 'helpers' | 'session'

export interface RailData {
  tasks: readonly OddTaskFeature[]
  activity: AgentActivity
  repo: RepoStatus | null
  sessionName: string | null
}

export function helpersHaveActivity(activity: AgentActivity): boolean {
  const { running, queued, waiting, finished } = activity.counts
  return running + queued + waiting + finished > 0 || activity.tasks.length > 0
}

export function sessionHasContent(repo: RepoStatus | null, sessionName: string | null): boolean {
  if (sessionName !== null && sessionName.trim().length > 0) return true
  return repo !== null && (repo.dirtyCount > 0 || repo.files.length > 0)
}

export function visibleRailSections(data: RailData): RailSectionId[] {
  const sections: RailSectionId[] = []
  if (data.tasks.length > 0) sections.push('tasks')
  if (helpersHaveActivity(data.activity)) sections.push('helpers')
  if (sessionHasContent(data.repo, data.sessionName)) sections.push('session')
  return sections
}
