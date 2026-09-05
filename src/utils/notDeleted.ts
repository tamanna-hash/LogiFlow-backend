/**
 * Reusable Prisma where-clause fragment for soft-delete filtering.
 * Usage: prisma.user.findMany({ where: { ...notDeleted() } })
 */
export function notDeleted(): { deletedAt: null } {
  return { deletedAt: null };
}
