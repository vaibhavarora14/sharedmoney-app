/**
 * Unapproved guest privacy copy for #524.
 * Not rendered, not scheduled, and not copied into web/public/privacy.html.
 * The in-app banner follows Design's G11 wording and stays behind the
 * guest-cleanup flag, which defaults off.
 */
export const GUEST_PRIVACY_DRAFT = {
  status: "draft-not-approved",
  bannerDay45Title: "Your guest data will be deleted in 15 days",
  bannerDay45Body:
    "You haven't added or changed anything in 45 days. Sign in to keep your groups and expenses, or add something to keep them for another 60 days.",
  retentionBullet:
    "Guest account data is deleted after 60 days of inactivity (see Guest Accounts), or right away if you delete it in the app.",
} as const;
