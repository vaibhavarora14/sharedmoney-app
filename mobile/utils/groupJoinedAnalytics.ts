/**
 * Pure helpers for group_joined activation capture (PostHog project 563625).
 *
 * Invite-link redeem and email-invite accept are separate join_method values so
 * funnels can split share-link vs email acquisition without inventing a new
 * signup event.
 */

export type GroupJoinMethod = "invite_link" | "email_invite";

export type RedeemInviteStatus = "joined" | "already_member" | "expired";

export type RedeemInviteLinkResult = {
  status: RedeemInviteStatus;
  group_id: string;
  group_name: string | null;
  remaining_uses?: number;
};

const REDEEM_STATUSES = new Set<RedeemInviteStatus>([
  "joined",
  "already_member",
  "expired",
]);

/**
 * Supabase JSONB RPCs usually return an object; tolerate a JSON string so a
 * shape mismatch cannot silently skip activation capture.
 */
export function normalizeRedeemInviteLinkResult(
  data: unknown,
): RedeemInviteLinkResult {
  const parsed =
    typeof data === "string"
      ? (() => {
        try {
          return JSON.parse(data) as unknown;
        } catch {
          return null;
        }
      })()
      : data;

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Invalid invite redeem response");
  }

  const record = parsed as Record<string, unknown>;
  const status = record.status;
  const groupId = record.group_id;

  if (typeof status !== "string" || !REDEEM_STATUSES.has(status as RedeemInviteStatus)) {
    throw new Error("Invalid invite redeem status");
  }
  if (typeof groupId !== "string" || !groupId) {
    throw new Error("Invalid invite redeem group_id");
  }

  const remaining = record.remaining_uses;
  return {
    status: status as RedeemInviteStatus,
    group_id: groupId,
    group_name: typeof record.group_name === "string" ? record.group_name : null,
    ...(typeof remaining === "number" ? { remaining_uses: remaining } : {}),
  };
}

/** True when redeem newly admitted the signed-in user into the group. */
export function shouldCaptureGroupJoinedFromRedeem(
  status: RedeemInviteStatus,
): boolean {
  return status === "joined";
}

export function buildGroupJoinedProperties(input: {
  groupId: string;
  joinMethod: GroupJoinMethod;
}): { group_id: string; join_method: GroupJoinMethod } {
  return {
    group_id: input.groupId,
    join_method: input.joinMethod,
  };
}

export type AcceptedEmailInvitation = {
  id: string;
  group_id: string;
  status: string;
  email?: string | null;
  accepted_at?: string | null;
};

/**
 * After signup, handle_new_user() accepts pending email invitations server-side
 * with no client callback. Surface those as group_joined once when the invitee
 * reaches an authenticated session.
 */
export function selectRecentEmailInviteJoins(
  invitations: AcceptedEmailInvitation[],
  options: {
    userEmail: string | null | undefined;
    nowMs?: number;
    /** How far back to attribute signup auto-accept (default 24h). */
    maxAgeMs?: number;
    alreadyReportedIds?: ReadonlySet<string>;
  },
): AcceptedEmailInvitation[] {
  const userEmail = options.userEmail?.trim().toLowerCase();
  if (!userEmail) return [];

  const nowMs = options.nowMs ?? Date.now();
  const maxAgeMs = options.maxAgeMs ?? 24 * 60 * 60 * 1000;
  const reported = options.alreadyReportedIds ?? new Set<string>();

  return invitations.filter((invitation) => {
    if (reported.has(invitation.id)) return false;
    if (invitation.status !== "accepted") return false;
    if (!invitation.group_id) return false;

    const inviteEmail = invitation.email?.trim().toLowerCase();
    // Link invites have null email; never attribute those here.
    if (!inviteEmail || inviteEmail !== userEmail) return false;

    if (!invitation.accepted_at) return false;
    const acceptedMs = Date.parse(invitation.accepted_at);
    if (!Number.isFinite(acceptedMs)) return false;
    if (nowMs - acceptedMs > maxAgeMs || acceptedMs > nowMs + 60_000) {
      return false;
    }

    return true;
  });
}
