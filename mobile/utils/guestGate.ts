import type { GuestSignInAction } from "./guestMode";

export interface GuestSignInRequest {
  title: string;
  body: string;
  action: GuestSignInAction;
}

type GuestGateListener = (request: GuestSignInRequest) => void;

let listener: GuestGateListener | null = null;

export function setGuestGateListener(next: GuestGateListener | null): void {
  listener = next;
}

export function requestGuestSignIn(request: GuestSignInRequest): void {
  listener?.(request);
}
