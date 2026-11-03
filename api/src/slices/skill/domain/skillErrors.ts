/**
 * Prisma's unique-violation code, matched by shape so the controller and the
 * tools do not import the data layer to recognise it. A skill name is the
 * only unique column on Skill, so P2002 here always means "name taken".
 */
export function isUniqueNameViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'P2002'
  );
}
