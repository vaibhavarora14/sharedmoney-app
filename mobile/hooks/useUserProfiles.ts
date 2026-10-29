import { useQuery } from "@tanstack/react-query";
import { fetchWithAuth } from "../utils/api";
import { logError } from "../utils/logger";
import { queryKeys } from "./queryKeys";

export interface UserProfile {
  id: string;
  full_name?: string | null;
  avatar_url?: string | null;
  phone?: string | null;
  country_code?: string | null;
  email?: string | null;
  /** Present only when viewer shares an active group (or is self). */
  upi_id?: string | null;
  profile_completed: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Hook to fetch profiles for multiple user IDs
 * Useful for getting profile data for inactive members in transactions
 */
export function useUserProfiles(userIds: string[]) {
  const uniqueUserIds = Array.from(new Set(userIds)).filter(Boolean);
  
  const query = useQuery<Map<string, UserProfile>, Error>({
    queryKey: queryKeys.userProfiles(uniqueUserIds),
    queryFn: async () => {
      if (uniqueUserIds.length === 0) {
        return new Map();
      }

      try {
        const response = await fetchWithAuth(
          `/profile?user_ids=${encodeURIComponent(JSON.stringify(uniqueUserIds))}`
        );
        
        if (!response.ok) {
          throw new Error(`Failed to fetch user profiles: ${response.status}`);
        }
        
        const profiles: UserProfile[] = await response.json();
        const profileMap = new Map<string, UserProfile>();
        
        profiles.forEach((profile) => {
          profileMap.set(profile.id, profile);
        });
        
        if (__DEV__) {
          console.log('[useUserProfiles] Fetched profiles:', {
            requestedIds: uniqueUserIds,
            receivedCount: profiles.length,
            profiles: profiles.map(p => ({ id: p.id, full_name: p.full_name, email: p.email })),
          });
        }
        
        return profileMap;
      } catch (err) {
        const error =
          err instanceof Error
            ? err
            : new Error("Failed to fetch user profiles");
        logError(error, { context: "User profiles fetch", userIds: uniqueUserIds });
        throw error;
      }
    },
    enabled: uniqueUserIds.length > 0,
    staleTime: 60_000, // Cache for 1 minute
  });

  return {
    data: query.data ?? new Map<string, UserProfile>(),
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error ?? null,
    refetch: query.refetch,
  };
}

