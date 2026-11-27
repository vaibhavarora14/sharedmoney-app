/**
 * Bridge from the after-save invite-prompt logic (non-React) to the Paper
 * dialog host mounted in the app shell. Mirrors {@link setGuestGateListener}.
 */

export type InvitePromptRequest = {
  groupId: string;
  groupName?: string;
};

export type InvitePromptChoice = "share" | "dismiss";

type InvitePromptPresenter = (
  request: InvitePromptRequest,
) => Promise<InvitePromptChoice>;

let presenter: InvitePromptPresenter | null = null;

export function setInvitePromptPresenter(
  next: InvitePromptPresenter | null,
): void {
  presenter = next;
}

export function presentInvitePrompt(
  request: InvitePromptRequest,
): Promise<InvitePromptChoice> {
  if (!presenter) return Promise.resolve("dismiss");
  return presenter(request);
}
