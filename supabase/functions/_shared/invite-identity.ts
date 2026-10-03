import {
  EMAIL_FORMAT_ERROR,
  isValidEmail,
  normalizePhoneToE164,
  PHONE_FORMAT_ERROR,
} from "./validation.ts";

export type InviteIdentityKind = "email" | "phone";

export interface InviteIdentity {
  kind: InviteIdentityKind;
  value: string;
  column: "email" | "phone";
}

export interface InviteIdentityInput {
  email?: string | null;
  phone?: string | null;
  country_code?: string | null;
}

export interface InviteIdentityResult {
  identity: InviteIdentity | null;
  error: string | null;
}

export function normalizeInviteIdentity(
  input: InviteIdentityInput,
): InviteIdentityResult {
  const phone = input.phone?.trim() || "";
  if (phone) {
    const normalizedPhone = normalizePhoneToE164(phone, input.country_code);
    if (!normalizedPhone) {
      return { identity: null, error: PHONE_FORMAT_ERROR };
    }
    return {
      identity: { kind: "phone", value: normalizedPhone, column: "phone" },
      error: null,
    };
  }

  const email = input.email?.trim().toLowerCase() || "";
  if (email) {
    if (!isValidEmail(email)) {
      return { identity: null, error: EMAIL_FORMAT_ERROR };
    }
    return {
      identity: { kind: "email", value: email, column: "email" },
      error: null,
    };
  }

  return { identity: null, error: "Provide an email or phone number" };
}

export function buildInvitationInsert(input: {
  groupId: string;
  invitedBy: string;
  token: string;
  identity: InviteIdentity;
}): Record<string, string | null> {
  return {
    group_id: input.groupId,
    email: input.identity.kind === "email" ? input.identity.value : null,
    phone: input.identity.kind === "phone" ? input.identity.value : null,
    invited_by: input.invitedBy,
    token: input.token,
    status: "pending",
  };
}

export function resolveInviteAction(
  targetUserId: string | null,
): "attach_existing_user" | "create_pending_invite" {
  return targetUserId ? "attach_existing_user" : "create_pending_invite";
}
