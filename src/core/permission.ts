/**
 * The tool-approval posture injected into the OpenCode config. Pure so it is
 * unit-testable.
 *
 * OpenCode flattens the `permission` object into an ordered rule list where the
 * LAST matching rule wins; OpenCode 2 still accepts this 1.x object form.
 *
 * - `question` is allowed because the question picker IS the interaction; an
 *   approval gate before it would ask permission to ask.
 * - `external_directory` asks: reading or writing outside the workspace
 *   prompted under OpenCode 1.x, but OpenCode 2's own defaults allow it, so the
 *   1.x posture is kept explicitly. (.env reads still ask by default.)
 */
export function opencodePermission(): Record<string, 'allow' | 'ask'> {
  return { question: 'allow', external_directory: 'ask' };
}
