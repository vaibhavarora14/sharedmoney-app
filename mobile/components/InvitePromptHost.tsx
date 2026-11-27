import React, { useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import { useAuth } from "../contexts/AuthContext";
import { createGroupShareLinkRPC } from "../hooks/useGroupInvitations";
import { showErrorAlert } from "../utils/errorHandling";
import { requestGuestSignIn } from "../utils/guestGate";
import { guestSignInCopy, isGuestUser } from "../utils/guestMode";
import { getInviteLinkUrl } from "../utils/inviteLinks";
import {
  setInvitePromptPresenter,
  type InvitePromptChoice,
  type InvitePromptRequest,
} from "../utils/invitePromptPresenter";
import {
  INVITE_LINK_MAX_USES,
  INVITE_LINK_VALID_DAYS,
} from "../utils/inviteShare";
import { inviteShareChannel, shareInviteLink } from "../utils/inviteShareAction";
import { captureIdentifiedAnalyticsEvent } from "../utils/posthogAnalytics";
import { ANALYTICS_EVENTS } from "../utils/posthogEvents";
import { InvitePromptDialog } from "./InvitePromptDialog";

type HostState = {
  request: InvitePromptRequest;
  resolve: (choice: InvitePromptChoice) => void;
};

export function InvitePromptHost() {
  const { user, signOut } = useAuth();
  const [state, setState] = useState<HostState | null>(null);
  const [sharing, setSharing] = useState(false);
  const stateRef = useRef<HostState | null>(null);
  stateRef.current = state;

  useEffect(() => {
    setInvitePromptPresenter((request) => {
      return new Promise<InvitePromptChoice>((resolve) => {
        setSharing(false);
        setState({ request, resolve });
      });
    });
    return () => {
      setInvitePromptPresenter(null);
    };
  }, []);

  const settle = (choice: InvitePromptChoice) => {
    const pending = stateRef.current;
    if (!pending) return;
    setState(null);
    setSharing(false);
    pending.resolve(choice);
  };

  const handleShare = async () => {
    const pending = stateRef.current;
    if (!pending) return;
    const { request } = pending;

    if (isGuestUser(user)) {
      requestGuestSignIn(guestSignInCopy("share_link", request.groupName));
      return;
    }

    setSharing(true);
    try {
      const token = await createGroupShareLinkRPC({
        groupId: request.groupId,
        maxUses: INVITE_LINK_MAX_USES,
        validDays: INVITE_LINK_VALID_DAYS,
      });
      const url = getInviteLinkUrl(token);
      captureIdentifiedAnalyticsEvent(
        user?.id,
        ANALYTICS_EVENTS.INVITE_LINK_CREATED,
        {
          group_id: request.groupId,
          invite_type: "share_link",
          max_uses: INVITE_LINK_MAX_USES,
          valid_days: INVITE_LINK_VALID_DAYS,
          source: "invite_prompt",
        },
      );

      const result = await shareInviteLink(url, request.groupName);
      if (result === "shared") {
        captureIdentifiedAnalyticsEvent(
          user?.id,
          ANALYTICS_EVENTS.INVITE_LINK_SHARED,
          {
            group_id: request.groupId,
            invite_type: "share_link",
            share_channel: inviteShareChannel(Platform.OS),
            source: "invite_prompt",
          },
        );
        settle("share");
        return;
      }
    } catch (err) {
      showErrorAlert(err, signOut, "Error sharing invite link");
    } finally {
      setSharing(false);
    }
  };

  return (
    <InvitePromptDialog
      visible={state != null}
      sharing={sharing}
      groupName={state?.request.groupName}
      amount={state?.request.amount}
      currency={state?.request.currency}
      onShare={() => {
        void handleShare();
      }}
      onDismiss={() => settle("dismiss")}
    />
  );
}
