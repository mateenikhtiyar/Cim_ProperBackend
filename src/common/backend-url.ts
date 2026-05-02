/**
 * Returns the primary backend URL for use in public links sent in emails
 * (e.g. NDA download links that hit the API directly without a frontend hop).
 *
 * BACKEND_URL may contain comma-separated origins; this helper always returns
 * only the first (primary) origin.
 */
export const getBackendUrl = (): string => {
  const raw = process.env.BACKEND_URL || "https://api.cimamplify.com"
  return raw.split(",")[0].trim().replace(/\/$/, "")
}
