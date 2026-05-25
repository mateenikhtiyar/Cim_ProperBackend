export const getClientThrottleTracker = (req: Record<string, any>): string => {
  const forwardedFor = req.headers?.["x-forwarded-for"]
  if (typeof forwardedFor === "string" && forwardedFor.trim()) {
    return forwardedFor.split(",")[0].trim()
  }
  if (Array.isArray(forwardedFor) && forwardedFor.length > 0) {
    return String(forwardedFor[0])
  }

  const realIp = req.headers?.["x-real-ip"]
  if (typeof realIp === "string" && realIp.trim()) {
    return realIp.trim()
  }

  return req.ip || req.socket?.remoteAddress || "unknown"
}
