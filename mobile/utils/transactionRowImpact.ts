/**
 * What a ledger row did to the viewer.
 * Impact uses the existing words rule (You're owed / You owe / Even), never a
 * bare sign. Payments are an unsigned amount with no "Payment" subtitle.
 */
import { groupListBalanceWords } from "./balanceRowLabels";
import { formatShareCurrency } from "./settleShareMessage";

export const NOT_IN_SPLIT_LABEL = "not in split";
export const SAVING_PAYER_LINE = "Saving…";

export interface ViewerRef {
  userId?: string | null;
  participantId?: string | null;
}

export interface SplitRef {
  participant_id: string;
  user_id?: string | null;
  amount: number;
}

export interface ExpenseRowModel {
  payerLine: string;
  impactText: string;
  /** Coloured amount only (`₹1,400`). Empty for muted copy. */
  impactAmountText: string;
  /** Direction or muted label (`You're owed` / `not in split`). */
  impactDirectionText: string;
  /** Muted figure: not in the split, even, or not yet known. */
  impactMuted: boolean;
  /**
   * Signed impact. Positive: the viewer is owed. Negative: the viewer owes.
   * Null when the viewer is not in the split or splits have not loaded.
   */
  net: number | null;
  involvesViewer: boolean;
}

function samePerson(
  candidate: { participantId?: string | null; userId?: string | null },
  viewer: ViewerRef,
): boolean {
  if (
    viewer.participantId
    && candidate.participantId
    && candidate.participantId === viewer.participantId
  ) {
    return true;
  }
  if (viewer.userId && candidate.userId && candidate.userId === viewer.userId) {
    return true;
  }
  return false;
}

export function buildExpenseRowModel(input: {
  amount: number;
  currency: string;
  payerName: string;
  paidByParticipantId?: string | null;
  paidByUserId?: string | null;
  splits?: SplitRef[] | null;
  viewer: ViewerRef;
  saving?: boolean;
}): ExpenseRowModel {
  const viewerPaid = samePerson(
    { participantId: input.paidByParticipantId, userId: input.paidByUserId },
    input.viewer,
  );
  const payerLine = input.saving
    ? SAVING_PAYER_LINE
    : `${input.payerName} paid ${formatShareCurrency(input.amount, input.currency)}`;

  if (!input.splits) {
    return {
      payerLine,
      impactText: "",
      impactAmountText: "",
      impactDirectionText: "",
      impactMuted: true,
      net: null,
      involvesViewer: viewerPaid,
    };
  }

  const share = input.splits.find((split) => samePerson(
    { participantId: split.participant_id, userId: split.user_id },
    input.viewer,
  ));
  const inSplit = share != null;
  if (!viewerPaid && !inSplit) {
    return {
      payerLine,
      impactText: NOT_IN_SPLIT_LABEL,
      impactAmountText: "",
      impactDirectionText: NOT_IN_SPLIT_LABEL,
      impactMuted: true,
      net: null,
      involvesViewer: false,
    };
  }

  const net = (viewerPaid ? input.amount : 0) - (share?.amount ?? 0);
  const amountText = formatShareCurrency(Math.abs(net), input.currency);
  const impactText = groupListBalanceWords(net, amountText);
  const material = Math.abs(net) > 0.01;
  const directionText = net > 0.01 ? "You're owed" : net < -0.01 ? "You owe" : "";
  return {
    payerLine,
    impactText,
    impactAmountText: material ? amountText : "",
    impactDirectionText: material ? directionText : impactText,
    impactMuted: !material,
    net,
    involvesViewer: true,
  };
}

/** Title already says who paid whom. There is no Payment subtitle. */
export function paymentRowTitle(fromName: string, toName: string): string {
  const fromYou = fromName === "You";
  const toYou = toName === "You";
  if (toYou && !fromYou) return `${fromName} paid you`;
  if (fromYou && !toYou) return `You paid ${toName}`;
  return `${fromName} paid ${toName}`;
}

export function paymentAmountText(amount: number, currency: string): string {
  return formatShareCurrency(Math.abs(amount), currency);
}

export function paymentInvolvesViewer(input: {
  fromParticipantId?: string | null;
  fromUserId?: string | null;
  toParticipantId?: string | null;
  toUserId?: string | null;
  viewer: ViewerRef;
}): boolean {
  return samePerson(
    { participantId: input.fromParticipantId, userId: input.fromUserId },
    input.viewer,
  ) || samePerson(
    { participantId: input.toParticipantId, userId: input.toUserId },
    input.viewer,
  );
}
