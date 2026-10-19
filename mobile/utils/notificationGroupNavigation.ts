import { Group, GroupWithMembers } from "../types";

export interface NotificationGroupReference {
  id: string;
  name: string;
}

interface OpenNotificationGroupOptions {
  reference: NotificationGroupReference;
  cachedDetails?: GroupWithMembers | null;
  cachedGroups?: readonly Group[] | null;
  isAlreadyOpening: boolean;
  navigate: (group: Group) => void;
  refresh: () => Promise<void>;
  onRefreshError: (error: unknown) => void;
  onSettled?: () => void;
}

export function resolveNotificationGroup(
  reference: NotificationGroupReference,
  cachedDetails?: GroupWithMembers | null,
  cachedGroups?: readonly Group[] | null,
): Group {
  if (cachedDetails?.id === reference.id) return cachedDetails;

  const cachedGroup = cachedGroups?.find((group) => group.id === reference.id);
  if (cachedGroup) return cachedGroup;

  return {
    id: reference.id,
    name: reference.name,
    created_by: "",
    created_at: "",
    updated_at: "",
  };
}

export function openNotificationGroupImmediately({
  reference,
  cachedDetails,
  cachedGroups,
  isAlreadyOpening,
  navigate,
  refresh,
  onRefreshError,
  onSettled,
}: OpenNotificationGroupOptions): boolean {
  if (isAlreadyOpening) return false;

  navigate(resolveNotificationGroup(reference, cachedDetails, cachedGroups));

  void Promise.resolve()
    .then(refresh)
    .catch(onRefreshError)
    // Hermes' Promise#finally calls its argument unconditionally, so passing an
    // undefined onSettled throws "undefined is not a function" (REACT-NATIVE-2F).
    .finally(() => onSettled?.());

  return true;
}
