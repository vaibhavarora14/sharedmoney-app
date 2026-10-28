import type { LedgerFilter } from "./transactionsLedger";

export type TransactionsEmptyCopy = {
  title: string;
  body: string;
  /** Primary button label; omit when no empty-state CTA. */
  primaryLabel?: string;
  primaryAction?: "add_people" | "add_expense";
  /** Secondary text/ghost label (solo empty — quiet escape hatch). */
  secondaryLabel?: string;
  secondaryAction?: "add_expense";
};

/**
 * Count active group members only (excludes left / invited / former).
 * Missing status is treated as active for backwards compatibility.
 */
export function countActiveMembers(
  members: Array<{ status?: string | null } | null | undefined> | null | undefined,
): number {
  if (!members?.length) return 0;
  return members.filter((m) => m != null && (m.status ?? "active") === "active")
    .length;
}

/**
 * Count non-former participants: members with accounts, people without accounts,
 * and pending invites. Excludes former / left people.
 * Prefer this over {@link countActiveMembers} for settle-slot visibility —
 * `group.members` only mirrors `group_members` and omits account-less people.
 */
export function countNonFormerParticipants(
  participants:
    | Array<{ type?: string | null } | null | undefined>
    | null
    | undefined,
): number {
  if (!participants?.length) return 0;
  return participants.filter((p) => p != null && p.type !== "former").length;
}

/**
 * Empty-state copy + CTAs for the Transactions ledger.
 * Solo groups (1 active member) prioritize inviting people before expenses.
 */
export function getTransactionsEmptyCopy(
  filter: LedgerFilter,
  activeMemberCount: number,
): TransactionsEmptyCopy {
  if (filter === "payments") {
    return {
      title: "No payments yet",
      body: "Record a settlement from Settle and it will show up here.",
    };
  }

  const isSolo = activeMemberCount <= 1;

  if (filter === "expenses") {
    if (isSolo) {
      return {
        title: "Just you so far",
        body: "Send a link to the people you split costs with. They join with one tap, and you can add expenses now or later.",
        primaryLabel: "Invite people",
        primaryAction: "add_people",
        secondaryLabel: "Add an expense first",
        secondaryAction: "add_expense",
      };
    }
    return {
      title: "No expenses yet",
      body: "Add your first expense to start tracking shared spending.",
      primaryLabel: "Add first expense",
      primaryAction: "add_expense",
    };
  }

  // filter === "all"
  if (isSolo) {
    return {
      title: "Just you so far",
      body: "Send a link to the people you split costs with. They join with one tap, and you can add expenses now or later.",
      primaryLabel: "Invite people",
      primaryAction: "add_people",
      secondaryLabel: "Add an expense first",
      secondaryAction: "add_expense",
    };
  }

  return {
    title: "No expenses yet",
    body: "Add what someone paid and who shared it. SharedMoney works out who owes whom.",
    primaryLabel: "Add first expense",
    primaryAction: "add_expense",
  };
}

/** FAB should prefer people-first when the group is solo and the ledger is empty. */
export function shouldPreferAddPeopleFab(
  activeMemberCount: number,
  ledgerIsEmpty: boolean,
): boolean {
  return ledgerIsEmpty && activeMemberCount <= 1;
}
