import { verifyAuth } from "../_shared/auth.ts";
import { SUPABASE_SERVICE_ROLE_KEY } from "../_shared/env.ts";
import { createErrorResponse, handleError } from "../_shared/error-handler.ts";
import {
  createEmptyResponse,
  createSuccessResponse,
} from "../_shared/response.ts";
import { fetchUserEmails } from "../_shared/user-email.ts";
import { fetchUserProfiles } from "../_shared/user-profiles.ts";
import { findUserIdByEmail } from "../_shared/user-lookup.ts";
import {
  buildReusablePeopleDirectory,
  isReusableParticipantType,
  REUSABLE_PARTICIPANT_TYPES,
  type ReusablePerson,
} from "../_shared/reusable-people.ts";
import {
  isMissingTargetMembershipError,
  planPersonRemoval,
} from "../_shared/remove-person.ts";
import {
  EMAIL_FORMAT_ERROR,
  isValidEmail,
  isValidUUID,
  validateBodySize,
} from "../_shared/validation.ts";

/**
 * Participants Edge Function
 *
 * Handles group people:
 * - GET /participants?group_id=xxx - Get all participants (members, invited, former) for a group
 * - POST /participants - Add a person to a group with name and optional email
 * - PATCH /participants/:id - Edit a person's name/email
 * - POST /participants/:id/invite - Invite a person with an email
 * - POST /participants/:id/connect - Connect a person to an existing SharedMoney account by email
 * - DELETE /participants/:id - Remove an active person (delete if unused, otherwise mark former)
 * @route /functions/v1/participants
 * @requires Authentication
 */

interface Participant {
  id: string;
  group_id: string;
  user_id?: string | null;
  email?: string | null;
  type: "member" | "invited" | "former";
  role?: "owner" | "member";
  full_name?: string | null;
  avatar_url?: string | null;
  joined_at?: string | null;
  left_at?: string | null;
  created_at: string;
  updated_at: string;
}

interface CreateParticipantRequest {
  group_id?: string;
  full_name?: string;
  email?: string | null;
  /** Reuses someone the requester has already been grouped with. */
  source_participant_id?: string;
}

interface UpdateParticipantRequest {
  full_name?: string;
  email?: string | null;
}

interface ParticipantIdentity {
  id: string;
  user_id?: string | null;
  email?: string | null;
  full_name: string;
}

function normalizeName(name: unknown): string | null {
  if (typeof name !== "string") return null;
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > 255) return null;
  return trimmed;
}

function normalizeOptionalEmail(email: unknown): string | null {
  if (email === undefined || email === null) return null;
  if (typeof email !== "string") return null;
  const trimmed = email.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

async function requireCanManageParticipants(
  supabase: Awaited<ReturnType<typeof verifyAuth>>["supabase"],
  groupId: string,
  userId: string,
): Promise<boolean> {
  const { data: membership, error: membershipError } = await supabase
    .from("group_members")
    .select("id, status")
    .eq("group_id", groupId)
    .eq("user_id", userId)
    .maybeSingle();

  if (
    !membershipError && membership &&
    ((membership as { status?: string }).status ?? "active") === "active"
  ) {
    return true;
  }

  const { data: group, error: groupError } = await supabase
    .from("groups")
    .select("created_by")
    .eq("id", groupId)
    .maybeSingle();

  return !groupError && !!group &&
    (group as { created_by: string }).created_by === userId;
}

async function hasBeenGroupedIn(
  supabase: Awaited<ReturnType<typeof verifyAuth>>["supabase"],
  groupId: string,
  userId: string,
): Promise<boolean> {
  const { data: membership, error: membershipError } = await supabase
    .from("group_members")
    .select("id")
    .eq("group_id", groupId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!membershipError && membership) return true;

  const { data: group, error: groupError } = await supabase
    .from("groups")
    .select("created_by")
    .eq("id", groupId)
    .maybeSingle();

  return !groupError && !!group &&
    (group as { created_by: string }).created_by === userId;
}

async function fetchParticipantById(
  supabase: Awaited<ReturnType<typeof verifyAuth>>["supabase"],
  participantId: string,
): Promise<Participant | null> {
  const { data, error } = await supabase
    .from("participants")
    .select("*")
    .eq("id", participantId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return (data as Participant | null) ?? null;
}

function toPersonIdentity(
  person: Participant,
  profileName?: string | null,
  profileEmail?: string | null,
): ParticipantIdentity {
  return {
    id: person.id,
    user_id: person.user_id,
    email: person.email || profileEmail || null,
    full_name: person.full_name || profileName || "",
  };
}

async function fetchReusablePeople(
  supabase: Awaited<ReturnType<typeof verifyAuth>>["supabase"],
  targetGroupId: string,
  userId: string,
  currentUserEmail: string | null,
): Promise<ReusablePerson[]> {
  const [membershipsResult, ownedGroupsResult] = await Promise.all([
    supabase
      .from("group_members")
      .select("group_id")
      .eq("user_id", userId),
    supabase
      .from("groups")
      .select("id")
      .eq("created_by", userId),
  ]);

  if (membershipsResult.error) throw membershipsResult.error;
  if (ownedGroupsResult.error) throw ownedGroupsResult.error;

  const groupIds = new Set<string>();
  (membershipsResult.data || []).forEach((membership: { group_id: string }) =>
    groupIds.add(membership.group_id)
  );
  (ownedGroupsResult.data || []).forEach((group: { id: string }) =>
    groupIds.add(group.id)
  );

  if (groupIds.size === 0) return [];

  const directoryGroupIds = Array.from(groupIds);
  const { data: people, error: peopleError } = await supabase
    .from("participants")
    .select("id, group_id, user_id, email, full_name, type, created_at")
    .in("group_id", directoryGroupIds)
    .in("type", [...REUSABLE_PARTICIPANT_TYPES])
    .order("created_at", { ascending: true });

  if (peopleError) throw peopleError;

  const participantRows = (people as Participant[] | null) ?? [];
  const userIds = participantRows
    .map((person) => person.user_id)
    .filter((id): id is string => Boolean(id));
  const [profileMap, emailMap] = await Promise.all([
    fetchUserProfiles(supabase, userIds),
    fetchUserEmails(userIds, userId, currentUserEmail),
  ]);

  const candidates: ParticipantIdentity[] = [];
  const alreadyInTarget: ParticipantIdentity[] = [];

  for (const person of participantRows) {
    const profile = person.user_id ? profileMap.get(person.user_id) : undefined;
    const identity = toPersonIdentity(
      person,
      profile?.full_name,
      person.user_id ? emailMap.get(person.user_id) ?? null : null,
    );
    if (person.group_id === targetGroupId) {
      alreadyInTarget.push(identity);
    } else {
      candidates.push(identity);
    }
  }

  return buildReusablePeopleDirectory(candidates, {
    excludeUserId: userId,
    excludePeople: alreadyInTarget,
  });
}

async function createInvitation(
  supabase: Awaited<ReturnType<typeof verifyAuth>>["supabase"],
  groupId: string,
  email: string,
  invitedBy: string,
): Promise<{ id: string } | null> {
  const normalizedEmail = email.toLowerCase().trim();

  const { data: existingInvitation } = await supabase
    .from("group_invitations")
    .select("id")
    .eq("group_id", groupId)
    .eq("email", normalizedEmail)
    .eq("status", "pending")
    .maybeSingle();

  if (existingInvitation) {
    return null;
  }

  const tokenArray = new Uint8Array(32);
  crypto.getRandomValues(tokenArray);
  const token = Array.from(tokenArray)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const { data: invitation, error: inviteError } = await supabase
    .from("group_invitations")
    .insert({
      group_id: groupId,
      email: normalizedEmail,
      invited_by: invitedBy,
      token,
      status: "pending",
    })
    .select("id")
    .single();

  if (inviteError) {
    throw inviteError;
  }

  return invitation as { id: string };
}

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return createEmptyResponse(200, req);
  }

  try {
    const authResult = await verifyAuth(req);
    const { user, supabase } = authResult;

    const url = new URL(req.url);
    const pathParts = url.pathname.split("/").filter(Boolean);
    const participantId = pathParts[pathParts.length - 2] === "participants"
      ? pathParts[pathParts.length - 1]
      : null;
    const action = participantId ? null : pathParts[pathParts.length - 1];
    const actionParticipantId = action === "invite" || action === "connect"
      ? pathParts[pathParts.length - 2]
      : null;
    const httpMethod = req.method;

    if (httpMethod !== "GET") {
      const bodyText = await req.text().catch(() => null);
      const bodySizeValidation = validateBodySize(bodyText);
      if (!bodySizeValidation.valid) {
        return createErrorResponse(
          413,
          bodySizeValidation.error || "Request body too large",
          "VALIDATION_ERROR",
          undefined,
          req,
        );
      }

      let requestData: CreateParticipantRequest | UpdateParticipantRequest;
      try {
        requestData = bodyText ? JSON.parse(bodyText) : {};
      } catch {
        return createErrorResponse(
          400,
          "Invalid JSON in request body",
          "VALIDATION_ERROR",
          undefined,
          req,
        );
      }

      if (httpMethod === "POST" && !actionParticipantId) {
        const createData = requestData as CreateParticipantRequest;
        const groupId = createData.group_id;

        if (!groupId || !isValidUUID(groupId)) {
          return createErrorResponse(
            400,
            "Invalid group_id format. Expected UUID.",
            "VALIDATION_ERROR",
            undefined,
            req,
          );
        }

        const canManage = await requireCanManageParticipants(
          supabase,
          groupId,
          user.id,
        );
        if (!canManage) {
          return createErrorResponse(
            403,
            "You must be an active group member to add people",
            "PERMISSION_DENIED",
            undefined,
            req,
          );
        }

        if (createData.source_participant_id !== undefined) {
          if (!isValidUUID(createData.source_participant_id)) {
            return createErrorResponse(
              400,
              "Invalid source_participant_id format. Expected UUID.",
              "VALIDATION_ERROR",
              undefined,
              req,
            );
          }

          const source = await fetchParticipantById(
            supabase,
            createData.source_participant_id,
          );
          if (
            !source ||
            !isReusableParticipantType(source.type) ||
            source.group_id === groupId
          ) {
            return createErrorResponse(
              404,
              "That person is not available to reuse",
              "NOT_FOUND",
              undefined,
              req,
            );
          }

          const canAccessSource = await hasBeenGroupedIn(
            supabase,
            source.group_id,
            user.id,
          );
          if (!canAccessSource) {
            return createErrorResponse(
              403,
              "You do not have access to that person",
              "PERMISSION_DENIED",
              undefined,
              req,
            );
          }

          const profileMap = source.user_id
            ? await fetchUserProfiles(supabase, [source.user_id])
            : new Map();
          const sourceProfile = source.user_id
            ? profileMap.get(source.user_id)
            : null;
          const fullName = normalizeName(
            source.full_name || sourceProfile?.full_name,
          );

          if (!fullName) {
            return createErrorResponse(
              400,
              "This person needs a name before they can be reused",
              "VALIDATION_ERROR",
              undefined,
              req,
            );
          }

          if (source.user_id) {
            const { data: existingByUser, error: existingUserError } =
              await supabase
                .from("participants")
                .select("*")
                .eq("group_id", groupId)
                .eq("user_id", source.user_id)
                .maybeSingle();

            if (existingUserError) {
              return handleError(
                existingUserError,
                "checking existing person",
                req,
              );
            }
            if (existingByUser) {
              return createSuccessResponse(existingByUser, 200, 0, req);
            }

            const { data: pendingParticipant, error: pendingInsertError } =
              await supabase
                .from("participants")
                .insert({
                  group_id: groupId,
                  type: "member",
                  role: "member",
                  full_name: fullName,
                  avatar_url: source.avatar_url || sourceProfile?.avatar_url ||
                    null,
                  joined_at: new Date().toISOString(),
                })
                .select()
                .single();

            if (pendingInsertError) {
              return handleError(
                pendingInsertError,
                "preparing existing account",
                req,
              );
            }

            const { data: canonicalParticipantId, error: connectError } =
              await supabase.rpc("connect_group_participant", {
                p_participant_id: (pendingParticipant as Participant).id,
                p_user_id: source.user_id,
                p_role: "member",
              });

            if (connectError) {
              return handleError(connectError, "adding existing account", req);
            }
            const connectedParticipant = await fetchParticipantById(
              supabase,
              canonicalParticipantId as string,
            );
            return createSuccessResponse(connectedParticipant, 201, 0, req);
          }

          const email = normalizeOptionalEmail(source.email);
          if (email) {
            const { data: existingByEmail, error: existingEmailError } =
              await supabase
                .from("participants")
                .select("*")
                .eq("group_id", groupId)
                .eq("email", email)
                .maybeSingle();

            if (existingEmailError) {
              return handleError(
                existingEmailError,
                "checking existing person",
                req,
              );
            }
            if (existingByEmail) {
              return createSuccessResponse(existingByEmail, 200, 0, req);
            }
          }

          const { data: participant, error: insertError } = await supabase
            .from("participants")
            .insert({
              group_id: groupId,
              email,
              type: "member",
              role: "member",
              full_name: fullName,
              avatar_url: source.avatar_url || null,
              joined_at: new Date().toISOString(),
            })
            .select()
            .single();

          if (insertError) {
            return handleError(insertError, "reusing person", req);
          }
          return createSuccessResponse(participant, 201, 0, req);
        }

        const fullName = normalizeName(createData.full_name);
        const email = normalizeOptionalEmail(createData.email);

        if (!fullName) {
          return createErrorResponse(
            400,
            "Name is required and must be 255 characters or fewer",
            "VALIDATION_ERROR",
            undefined,
            req,
          );
        }

        if (email && !isValidEmail(email)) {
          return createErrorResponse(
            400,
            EMAIL_FORMAT_ERROR,
            "VALIDATION_ERROR",
            undefined,
            req,
          );
        }

        if (email) {
          const { data: existingByEmail, error: existingError } = await supabase
            .from("participants")
            .select("*")
            .eq("group_id", groupId)
            .eq("email", email)
            .maybeSingle();

          if (existingError) {
            return handleError(
              existingError,
              "checking existing participant",
              req,
            );
          }

          if (existingByEmail) {
            const { data: updatedParticipant, error: updateError } =
              await supabase
                .from("participants")
                .update({
                  full_name: fullName,
                  type: "member",
                  role: (existingByEmail as Participant).role || "member",
                  updated_at: new Date().toISOString(),
                })
                .eq("id", (existingByEmail as Participant).id)
                .select()
                .single();

            if (updateError) {
              return handleError(
                updateError,
                "updating existing participant",
                req,
              );
            }

            return createSuccessResponse(updatedParticipant, 200, 0, req);
          }
        }

        const { data: participant, error: insertError } = await supabase
          .from("participants")
          .insert({
            group_id: groupId,
            email,
            type: "member",
            role: "member",
            full_name: fullName,
            joined_at: new Date().toISOString(),
          })
          .select()
          .single();

        if (insertError) {
          return handleError(insertError, "creating participant", req);
        }

        return createSuccessResponse(participant, 201, 0, req);
      }

      if (
        httpMethod === "DELETE" && participantId && isValidUUID(participantId)
      ) {
        const participant = await fetchParticipantById(supabase, participantId);
        if (!participant) {
          return createErrorResponse(
            404,
            "Person not found",
            "NOT_FOUND",
            undefined,
            req,
          );
        }

        if (participant.type !== "member") {
          return createErrorResponse(
            400,
            "Only active people can be removed from a group",
            "VALIDATION_ERROR",
            undefined,
            req,
          );
        }

        const isSelf = participant.user_id === user.id;
        const canManage = await requireCanManageParticipants(
          supabase,
          participant.group_id,
          user.id,
        );
        if (!canManage && !isSelf) {
          return createErrorResponse(
            403,
            "You must be an active group member to remove people",
            "PERMISSION_DENIED",
            undefined,
            req,
          );
        }

        const [splitResult, payerResult, settlementResult] = await Promise.all([
          supabase
            .from("transaction_splits")
            .select("id")
            .eq("participant_id", participant.id)
            .limit(1),
          supabase
            .from("transactions")
            .select("id")
            .eq("paid_by_participant_id", participant.id)
            .limit(1),
          supabase
            .from("settlements")
            .select("id")
            .or(
              `from_participant_id.eq.${participant.id},to_participant_id.eq.${participant.id}`,
            )
            .limit(1),
        ]);

        if (splitResult.error) return handleError(splitResult.error, "checking expense history", req);
        if (payerResult.error) return handleError(payerResult.error, "checking expense history", req);
        if (settlementResult.error) return handleError(settlementResult.error, "checking settlement history", req);

        const hasHistory =
          (splitResult.data?.length || 0) > 0 ||
          (payerResult.data?.length || 0) > 0 ||
          (settlementResult.data?.length || 0) > 0;
        const plan = planPersonRemoval(participant, hasHistory);

        if (plan.action === "reject") {
          return createErrorResponse(
            400,
            "Only active people can be removed from a group",
            "VALIDATION_ERROR",
            undefined,
            req,
          );
        }

        if (plan.action === "mark_former" && plan.leaveMembership && participant.user_id) {
          const { error: rpcError } = await supabase.rpc("remove_group_member", {
            p_group_id: participant.group_id,
            p_user_id: participant.user_id,
          });

          if (rpcError && !isMissingTargetMembershipError(rpcError.message)) {
            const errorMessage = rpcError.message || "Failed to remove member";
            if (
              errorMessage.includes("not authenticated") ||
              errorMessage.includes("Unauthorized")
            ) {
              return createErrorResponse(401, "Unauthorized", "AUTH_ERROR", undefined, req);
            }
            if (errorMessage.includes("active member of the group")) {
              return createErrorResponse(
                403,
                "You must be an active group member to remove people",
                "PERMISSION_DENIED",
                undefined,
                req,
              );
            }
            return handleError(rpcError, "removing member", req);
          }

          if (!rpcError) {
            return createSuccessResponse({ success: true, former: true }, 200, 0, req);
          }
        }

        if (plan.action === "hard_delete") {
          const { data: deleted, error: deleteError } = await supabase
            .from("participants")
            .delete()
            .eq("id", participant.id)
            .select("id");

          if (deleteError) {
            return handleError(deleteError, "removing person", req);
          }

          if (!deleted?.length) {
            return createErrorResponse(
              403,
              "You must be an active group member to remove people",
              "PERMISSION_DENIED",
              undefined,
              req,
            );
          }

          return createSuccessResponse({ success: true, deleted: true }, 200, 0, req);
        }

        const { data: updated, error: updateError } = await supabase
          .from("participants")
          .update({
            type: "former",
            left_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", participant.id)
          .eq("type", "member")
          .select("id");

        if (updateError) {
          return handleError(updateError, "removing person", req);
        }

        if (!updated?.length) {
          return createErrorResponse(
            409,
            "This person could not be removed from the group",
            "CONFLICT",
            undefined,
            req,
          );
        }

        return createSuccessResponse({ success: true, former: true }, 200, 0, req);
      }

      if (
        httpMethod === "PATCH" && participantId && isValidUUID(participantId)
      ) {
        const participant = await fetchParticipantById(supabase, participantId);
        if (!participant) {
          return createErrorResponse(
            404,
            "Person not found",
            "NOT_FOUND",
            undefined,
            req,
          );
        }

        const canManage = await requireCanManageParticipants(
          supabase,
          participant.group_id,
          user.id,
        );
        if (!canManage) {
          return createErrorResponse(
            403,
            "You must be an active group member to edit people",
            "PERMISSION_DENIED",
            undefined,
            req,
          );
        }

        const updateData = requestData as UpdateParticipantRequest;
        const fullName = updateData.full_name === undefined
          ? undefined
          : normalizeName(updateData.full_name);
        const email = updateData.email === undefined
          ? undefined
          : normalizeOptionalEmail(updateData.email);

        if (updateData.full_name !== undefined && !fullName) {
          return createErrorResponse(
            400,
            "Name must be 255 characters or fewer",
            "VALIDATION_ERROR",
            undefined,
            req,
          );
        }

        if (email && !isValidEmail(email)) {
          return createErrorResponse(
            400,
            EMAIL_FORMAT_ERROR,
            "VALIDATION_ERROR",
            undefined,
            req,
          );
        }

        const patch: Record<string, string | null> = {
          updated_at: new Date().toISOString(),
        };

        if (fullName !== undefined) patch.full_name = fullName;
        if (email !== undefined && !participant.user_id) patch.email = email;

        const { data: updatedParticipant, error: updateError } = await supabase
          .from("participants")
          .update(patch)
          .eq("id", participant.id)
          .select()
          .single();

        if (updateError) {
          return handleError(updateError, "updating participant", req);
        }

        return createSuccessResponse(updatedParticipant, 200, 0, req);
      }

      if (
        httpMethod === "POST" && actionParticipantId &&
        isValidUUID(actionParticipantId)
      ) {
        const participant = await fetchParticipantById(
          supabase,
          actionParticipantId,
        );
        if (!participant) {
          return createErrorResponse(
            404,
            "Person not found",
            "NOT_FOUND",
            undefined,
            req,
          );
        }

        const canManage = await requireCanManageParticipants(
          supabase,
          participant.group_id,
          user.id,
        );
        if (!canManage) {
          return createErrorResponse(
            403,
            "You must be an active group member to manage people",
            "PERMISSION_DENIED",
            undefined,
            req,
          );
        }

        const emailFromBody = normalizeOptionalEmail(
          (requestData as UpdateParticipantRequest).email,
        );
        const email = emailFromBody || participant.email;

        if (!email) {
          return createErrorResponse(
            400,
            "Add an email address before inviting.",
            "VALIDATION_ERROR",
            undefined,
            req,
          );
        }

        if (!isValidEmail(email)) {
          return createErrorResponse(
            400,
            EMAIL_FORMAT_ERROR,
            "VALIDATION_ERROR",
            undefined,
            req,
          );
        }

        if (action === "invite") {
          try {
            const invitation = await createInvitation(
              supabase,
              participant.group_id,
              email,
              user.id,
            );

            return createSuccessResponse(
              {
                invitation: true,
                email,
                invitation_id: invitation?.id ?? null,
                message: invitation
                  ? "Invitation sent successfully."
                  : "An invitation has already been sent to this email address.",
              },
              invitation ? 201 : 200,
              0,
              req,
            );
          } catch (error: unknown) {
            return handleError(error, "creating participant invitation", req);
          }
        }

        if (action === "connect") {
          if (!SUPABASE_SERVICE_ROLE_KEY) {
            return createErrorResponse(
              500,
              "Server configuration error: Service role key not configured.",
              "CONFIGURATION_ERROR",
              undefined,
              req,
            );
          }

          let targetUserId: string | null;
          try {
            targetUserId = await findUserIdByEmail(email);
          } catch (error: unknown) {
            return handleError(error, "searching for user", req);
          }

          if (!targetUserId) {
            return createErrorResponse(404, 'No SharedMoney account was found for this email yet', 'NOT_FOUND', undefined, req);
          }

          const { data: canonicalParticipantId, error: connectError } =
            await supabase.rpc("connect_group_participant", {
              p_participant_id: participant.id,
              p_user_id: targetUserId,
              p_role: participant.role || "member",
            });

          if (connectError) {
            return handleError(connectError, "connecting participant", req);
          }

          const connectedParticipant = await fetchParticipantById(
            supabase,
            canonicalParticipantId as string,
          );
          return createSuccessResponse(connectedParticipant, 200, 0, req);
        }
      }

      return createErrorResponse(
        405,
        "Method not allowed",
        "METHOD_NOT_ALLOWED",
        undefined,
        req,
      );
    }

    const reusableForGroupId = url.searchParams.get("available_for_group_id");
    if (reusableForGroupId) {
      if (!isValidUUID(reusableForGroupId)) {
        return createErrorResponse(
          400,
          "Invalid available_for_group_id format. Expected UUID.",
          "VALIDATION_ERROR",
          undefined,
          req,
        );
      }

      const canManage = await requireCanManageParticipants(
        supabase,
        reusableForGroupId,
        user.id,
      );
      if (!canManage) {
        return createErrorResponse(
          403,
          "You must be an active group member to view reusable people",
          "PERMISSION_DENIED",
          undefined,
          req,
        );
      }

      const people = await fetchReusablePeople(
        supabase,
        reusableForGroupId,
        user.id,
        user.email,
      );
      return createSuccessResponse(people, 200, 0, req);
    }

    const groupId = url.searchParams.get("group_id");

    if (!groupId) {
      return createErrorResponse(
        400,
        "group_id query parameter is required",
        "VALIDATION_ERROR",
        undefined,
        req,
      );
    }

    if (!isValidUUID(groupId)) {
      return createErrorResponse(
        400,
        "Invalid group_id format. Expected UUID.",
        "VALIDATION_ERROR",
        undefined,
        req,
      );
    }

    // Verify user is a member of the group or is the group owner
    const { data: membership, error: membershipError } = await supabase
      .from("group_members")
      .select("id")
      .eq("group_id", groupId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (membershipError || !membership) {
      // Also check if user is the group owner
      const { data: group, error: groupError } = await supabase
        .from("groups")
        .select("created_by")
        .eq("id", groupId)
        .single();

      const owner = group as { created_by: string } | null;
      if (groupError || !owner || owner.created_by !== user.id) {
        return createErrorResponse(
          403,
          "You must be a member of the group to view participants",
          "PERMISSION_DENIED",
          undefined,
          req,
        );
      }
    }

    // Fetch all participants for the group
    const { data: participantsRaw, error: participantsError } = await supabase
      .from("participants")
      .select("*")
      .eq("group_id", groupId)
      .order("created_at", { ascending: true });

    if (participantsError) {
      return handleError(participantsError, "fetching participants", req);
    }

    let participants: Participant[] =
      (participantsRaw as Participant[] | null) ?? [];

    // Enrich participants with profile data and emails
    if (participants.length > 0) {
      // Collect all user_ids from participants (members and former members)
      const userIds: string[] = [];
      participants.forEach((p: Participant) => {
        if (p.user_id) {
          userIds.push(p.user_id);
        }
      });

      // Fetch profile data and emails for members
      const currentUserEmail = user.email || null;
      const [emailMap, profileMap] = await Promise.all([
        fetchUserEmails(userIds, user.id, currentUserEmail),
        fetchUserProfiles(supabase, userIds),
      ]);

      // Enrich participants with profile data
      participants = participants.map((p: Participant) => {
        if (p.user_id) {
          const profile = profileMap.get(p.user_id);
          const email = emailMap.get(p.user_id);

          return {
            ...p,
            full_name: p.full_name || profile?.full_name || null,
            avatar_url: p.avatar_url || profile?.avatar_url || null,
            email: p.email || email || null,
          };
        }
        return p;
      });
    }

    return createSuccessResponse(participants || [], 200, 0, req);
  } catch (error: unknown) {
    return handleError(error, "participants handler", req);
  }
});
