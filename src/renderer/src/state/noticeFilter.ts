/**
 * Which incoming notices deserve a toast.
 *
 * The skill registry announces every refresh ("Skill registry refreshed (13 skills)"), and a
 * refresh happens on its own schedule. The toast lands over the composer and interrupts a
 * message being typed, for news the user did not ask for and cannot act on.
 *
 * Only the toast is silenced: the extension keeps indexing, its entry keeps arriving, and
 * nothing here reaches the engine. Matched on the words the extension uses, so if it ever
 * rewords the notice it becomes visible again — a silence nobody can see is worse than a
 * repeat nobody wanted.
 */
const SILENCED_NOTICES: readonly RegExp[] = [/skill registry/i]

export function shouldShowNotice(message: string): boolean {
  return !SILENCED_NOTICES.some((pattern) => pattern.test(message))
}
