export const getAdminNotificationEmail = (): string => {
  const email = process.env.ADMIN_NOTIFICATION_EMAIL;
  if (!email) {
    throw new Error("ADMIN_NOTIFICATION_EMAIL must be configured.");
  }
  return email;
};
