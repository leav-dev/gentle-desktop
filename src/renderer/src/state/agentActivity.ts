/**
 * Live Gentle Agents activity, pushed by the engine as one JSON document per
 * coalescing window through `setWidget` (`gentle-agents.activity/v1`, see
 * gentle-pi's `docs/gentle-agents-activity.md`).
 *
 * Everything here is defensive: a malformed or partial payload degrades to an
 * empty section and never throws — the rail renders silence, not an error.
 */

export const ACTIVITY_WIDGET_KEY = 'gentle-agents'
export const ACTIVITY_SCHEMA = 'gentle-agents.activity/v1'

export interface AgentActivityCounts {
  running: number
  queued: number
  waiting: number
  finished: number
}

export interface AgentActivityTask {
  label: string
  status: string
  agent: string
  lastStep: string
}

export interface AgentActivity {
  counts: AgentActivityCounts
  tasks: AgentActivityTask[]
}

export function emptyAgentActivity(): AgentActivity {
  return { counts: { running: 0, queued: 0, waiting: 0, finished: 0 }, tasks: [] }
}

function nonNegativeInteger(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  return typeof value === 'string' ? value : ''
}

function parseTask(raw: unknown): AgentActivityTask | null {
  if (typeof raw !== 'object' || raw === null) return null
  const summary = (raw as Record<string, unknown>)['summary']
  if (typeof summary !== 'object' || summary === null) return null

  const fields = summary as Record<string, unknown>
  const label = stringField(fields, 'label')
  const prompt = stringField(fields, 'prompt')
  const status = stringField(fields, 'status')
  if (label.length === 0 && prompt.length === 0 && status.length === 0) return null

  return {
    // The label is the display text; the prompt is the publisher's own fallback.
    label: label.length > 0 ? label : prompt,
    status,
    agent: stringField(fields, 'agent'),
    lastStep: stringField(fields, 'lastStep')
  }
}

export function parseAgentActivity(payload: string | null | undefined): AgentActivity {
  if (typeof payload !== 'string' || payload.length === 0) return emptyAgentActivity()

  let parsed: unknown
  try {
    parsed = JSON.parse(payload)
  } catch {
    return emptyAgentActivity()
  }
  if (typeof parsed !== 'object' || parsed === null) return emptyAgentActivity()

  const record = parsed as Record<string, unknown>
  if (record['schema'] !== ACTIVITY_SCHEMA) return emptyAgentActivity()

  const activity = emptyAgentActivity()

  const summary = record['summary']
  if (typeof summary === 'object' && summary !== null) {
    const counts = summary as Record<string, unknown>
    activity.counts = {
      running: nonNegativeInteger(counts['running']),
      queued: nonNegativeInteger(counts['queued']),
      waiting: nonNegativeInteger(counts['waiting']),
      finished: nonNegativeInteger(counts['finished'])
    }
  }

  if (Array.isArray(record['tasks'])) {
    for (const raw of record['tasks']) {
      const task = parseTask(raw)
      if (task !== null) activity.tasks.push(task)
    }
  }

  return activity
}
