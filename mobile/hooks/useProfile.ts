import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../contexts/AuthContext";
import { fetchWithAuth } from "../utils/api";
import { logError } from "../utils/logger";
import { queryKeys } from "./queryKeys";

export interface Profile {
  id: string;
  full_name?: string;
  avatar_url?: string;
  phone?: string;
  country_code?: string;
  profile_completed: boolean;
  terms_accepted_at?: string | null;
  terms_version?: string | null;
  preferred_currency?: string | null;
  /** Optional UPI VPA; group co-members can read for settle Pay via UPI. */
  upi_id?: string | null;
  created_at: string;
  updated_at: string;
}

export type ProfileUpdate = Partial<Profile> & {
  accept_terms?: true;
};

export function useProfile() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // Keyed by user.id so that when user changes asynchronously, we naturally
  // refetch for the new user once enabled flips to true.
  const profileQuery = useQuery<Profile, Error>({
    queryKey: queryKeys.profile(user?.id ?? null),
    enabled: !!user?.id,
    queryFn: async () => {
      try {
        const response = await fetchWithAuth("/profile");
        if (!response.ok) {
          throw new Error(`Failed to fetch profile: ${response.status}`);
        }
        const profile: Profile = await response.json();

        return profile;
      } catch (err) {
        const error =
          err instanceof Error ? err : new Error("Failed to fetch profile");

        throw error;
      }
    },
    staleTime: 60_000,
  });

  const updateProfileMutation = useMutation<Profile, Error, ProfileUpdate>({
    mutationFn: async (updates: ProfileUpdate) => {
      if (!user?.id) {
        throw new Error("Not authenticated");
      }

      try {
        const response = await fetchWithAuth("/profile", {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(updates),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(
            (errorData as any).message ||
              `Failed to update profile: ${response.status}`
          );
        }

        const updatedProfile: Profile = await response.json();
        return updatedProfile;
      } catch (err) {
        const error =
          err instanceof Error
            ? err
            : new Error("Failed to update profile");
        logError(error, { context: "Profile update", updates });
        throw error;
      }
    },
    onSuccess: (updatedProfile) => {
      queryClient.setQueryData<Profile | null>(
        queryKeys.profile(user?.id ?? null),
        updatedProfile
      );
    },
  });

  return {
    data: profileQuery.data ?? null,
    // Only block the app on the *initial* load, not on background refetches/retries
    isLoading: profileQuery.isLoading,
    isFetching: profileQuery.isFetching,
    error: profileQuery.error ?? null,
    refetch: profileQuery.refetch,
    updateProfile: updateProfileMutation.mutateAsync,
    updateProfileLoading: updateProfileMutation.isPending,
    updateProfileError: (updateProfileMutation.error as Error | null) ?? null,
  };
}
