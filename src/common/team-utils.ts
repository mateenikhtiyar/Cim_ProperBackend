/**
 * Utility functions for team member data scoping.
 *
 * Team members must access their owner's data, not their own.
 * These helpers extract the correct ID from the JWT-decoded request user.
 */

/**
 * Returns the effective user ID for data queries.
 * - For team members: returns ownerId (the actual seller/buyer they belong to)
 * - For regular users: returns userId (their own ID)
 */
export function getEffectiveUserId(user: any): string {
  if (user?.isTeamMember && user?.ownerId) {
    return user.ownerId
  }
  return user?.userId || user?.sub
}

/**
 * Checks if the current user is a team member.
 */
export function isTeamMember(user: any): boolean {
  return user?.isTeamMember === true
}

/**
 * Checks if the user has a specific permission (team members only).
 * Regular users always return true (they have all permissions).
 */
export function hasPermission(user: any, permission: string): boolean {
  if (!isTeamMember(user)) return true
  const permissions: string[] = user?.permissions || []
  return permissions.includes(permission)
}
