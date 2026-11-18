import { supabase } from "../supabase";

export type DirectGroupRef = {
  groupId: string;
  viewerParticipantId: string;
  counterpartyParticipantId: string;
  created: boolean;
};

type DirectGroupRpc = {
  group_id?: string;
  viewer_participant_id?: string;
  counterparty_participant_id?: string;
  created?: boolean;
};

export async function createOrGetDirectGroup(input: {
  counterpartyUserId?: string | null;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
}): Promise<DirectGroupRef> {
  const { data, error } = await supabase.rpc("create_or_get_direct_group", {
    p_counterparty_user_id: input.counterpartyUserId || null,
    p_name: input.name || null,
    p_email: input.email || null,
    p_phone: input.phone || null,
  });
  if (error) {
    throw new Error(error.message || "Could not open that person");
  }
  const row = (data ?? {}) as DirectGroupRpc;
  if (!row.group_id || !row.viewer_participant_id || !row.counterparty_participant_id) {
    throw new Error("Could not open that person");
  }
  return {
    groupId: row.group_id,
    viewerParticipantId: row.viewer_participant_id,
    counterpartyParticipantId: row.counterparty_participant_id,
    created: row.created === true,
  };
}
