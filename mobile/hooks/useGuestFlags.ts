import { useEffect, useState } from "react";
import { guestCleanupVisible, guestEntryVisible } from "../utils/guestMode";
import {
  evaluateRemoteGuestFlag,
  guestCleanupOverride,
  guestModeOverride,
} from "../utils/guestFlag";

export function useGuestFlags(): { entryEnabled: boolean; cleanupEnabled: boolean } {
  const modeOverride = guestModeOverride();
  const cleanupOverride = guestCleanupOverride();
  const [modeRemote, setModeRemote] = useState(false);
  const [cleanupRemote, setCleanupRemote] = useState(false);

  useEffect(() => {
    if (modeOverride !== null) return;
    let cancelled = false;
    void evaluateRemoteGuestFlag("guest_mode").then((enabled) => {
      if (!cancelled) setModeRemote(enabled);
    });
    return () => {
      cancelled = true;
    };
  }, [modeOverride]);

  useEffect(() => {
    if (cleanupOverride !== null) return;
    let cancelled = false;
    void evaluateRemoteGuestFlag("guest_cleanup").then((enabled) => {
      if (!cancelled) setCleanupRemote(enabled);
    });
    return () => {
      cancelled = true;
    };
  }, [cleanupOverride]);

  return {
    entryEnabled: guestEntryVisible({ envOverride: modeOverride, remoteEnabled: modeRemote }),
    cleanupEnabled: guestCleanupVisible({ envOverride: cleanupOverride, remoteEnabled: cleanupRemote }),
  };
}
