import type { QueryClient } from "@tanstack/react-query";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../contexts/AuthContext";
import { Participant } from "../types";
import { fetchWithAuth } from "../utils/api";
import { ExistingPerson } from "../utils/peoplePicker";
import { captureIdentifiedAnalyticsEvent } from "../utils/posthogAnalytics";
import { ANALYTICS_EVENTS } from "../utils/posthogEvents";
import { queryKeys } from "./queryKeys";

export async function fetchParticipants(
  groupId: string,
): Promise<Participant[]> {
  const response = await fetchWithAuth(`/participants?group_id=${groupId}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch participants: ${response.status}`);
  }
  return response.json();
}

export function useParticipants(groupId: string | null) {
  const { user } = useAuth();

  const query = useQuery<Participant[], Error>({
    queryKey: groupId
      ? queryKeys.participants(groupId)
      : queryKeys.participants(""),
    queryFn: () => fetchParticipants(groupId as string),
    enabled: !!user?.id && !!groupId,
    placeholderData: [],
    staleTime: 60_000,
  });

  return {
    data: query.data ?? [],
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error ?? null,
    refetch: query.refetch,
  };
}

export async function fetchExistingPeople(
  groupId: string,
): Promise<ExistingPerson[]> {
  const response = await fetchWithAuth(
    `/participants?available_for_group_id=${encodeURIComponent(groupId)}`,
  );
  if (!response.ok) {
    throw new Error(`Failed to fetch existing people: ${response.status}`);
  }
  return response.json();
}

export function useExistingPeople(groupId: string | null, enabled = true) {
  const { user } = useAuth();
  const query = useQuery<ExistingPerson[], Error>({
    queryKey: ["existing-people", groupId],
    queryFn: () => fetchExistingPeople(groupId as string),
    enabled: Boolean(user?.id && groupId && enabled),
    placeholderData: [],
    staleTime: 60_000,
  });

  return {
    data: query.data ?? [],
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error ?? null,
    refetch: query.refetch,
  };
}

function invalidateParticipantAdjacents(
  queryClient: QueryClient,
  groupId: string,
) {
  queryClient.invalidateQueries({ queryKey: queryKeys.participants(groupId) });
  queryClient.invalidateQueries({ queryKey: queryKeys.group(groupId) });
  queryClient.invalidateQueries({ queryKey: queryKeys.invitations(groupId) });
  queryClient.invalidateQueries({
    queryKey: queryKeys.transactionsFeed(groupId),
  });
  queryClient.invalidateQueries({ queryKey: queryKeys.balances(groupId) });
  queryClient.invalidateQueries({ queryKey: queryKeys.groupStats(groupId) });
  queryClient.invalidateQueries({ queryKey: queryKeys.activity(groupId) });
  queryClient.invalidateQueries({ queryKey: queryKeys.settlements(groupId) });
}

export function useInviteParticipant(onSuccess?: () => void) {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const mutation = useMutation({
    mutationFn: async (
      variables: {
        groupId: string;
        participantId: string;
        email?: string | null;
      },
    ) => {
      const response = await fetchWithAuth(
        `/participants/${variables.participantId}/invite`,
        {
          method: "POST",
          body: JSON.stringify({
            email: variables.email || null,
          }),
        },
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to invite person");
      }

      return response.json() as Promise<{
        invitation?: boolean;
        invitation_id?: string | null;
        message?: string;
      }>;
    },
    onSuccess: (data, variables) => {
      invalidateParticipantAdjacents(queryClient, variables.groupId);
      // Inviter-side growth event; never attach raw invitee email (person identify has it).
      if (data?.invitation_id) {
        captureIdentifiedAnalyticsEvent(
          user?.id,
          ANALYTICS_EVENTS.MEMBER_INVITED,
          {
            group_id: variables.groupId,
            invite_type: "email_invite",
          },
        );
      }
      onSuccess?.();
    },
  });

  return {
    mutate: mutation.mutateAsync,
    isLoading: mutation.isPending,
    error: (mutation.error as Error | null) ?? null,
  };
}

export function useConnectParticipant(onSuccess?: () => void) {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (
      variables: {
        groupId: string;
        participantId: string;
        email?: string | null;
      },
    ) => {
      const response = await fetchWithAuth(
        `/participants/${variables.participantId}/connect`,
        {
          method: "POST",
          body: JSON.stringify({
            email: variables.email || null,
          }),
        },
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to connect account");
      }

      return response.json();
    },
    onSuccess: (_data, variables) => {
      invalidateParticipantAdjacents(queryClient, variables.groupId);
      onSuccess?.();
    },
  });

  return {
    mutate: mutation.mutateAsync,
    isLoading: mutation.isPending,
    error: (mutation.error as Error | null) ?? null,
  };
}

export function useRemoveParticipant(onSuccess?: () => void) {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (variables: { groupId: string; participantId: string }) => {
      const response = await fetchWithAuth(`/participants/${variables.participantId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to remove person");
      }

      return response.status === 204 ? null : response.json();
    },
    onSuccess: (_data, variables) => {
      invalidateParticipantAdjacents(queryClient, variables.groupId);
      queryClient.invalidateQueries({ queryKey: ["existing-people"] });
      onSuccess?.();
    },
  });

  return {
    mutate: mutation.mutateAsync,
    isLoading: mutation.isPending,
    error: (mutation.error as Error | null) ?? null,
  };
}
