import { Balance, Group, GroupBalance, GroupMember, Participant } from "../types";
import { formatCurrency, getDefaultCurrency } from "./currency";
import { formatShareCurrency } from "./settleShareMessage";
import {
  formatBreakdown,
  formatUnifiedHeadline,
  simplifyUnifiedDebts,
  unifyTotals,
  type ConvertedPart,
  type RateBook,
  type UnifiedTotal,
} from "./currencyMerge";
import { simplifyDebts, type DebtEdge } from "./debt";
import { groupSettingsFromGroup, resolveRateBook } from "./rateBook";

export type GroupSettlementContext = {
  groupId: string;
  groupName: string;
  kind?: "standard" | "direct";
  balances: Balance[];
  unifyEnabled: boolean;
  settlementCurrency: string;
  rateBook: RateBook;
  defaultCurrency: string;
};

export type GroupSettlementLine = {
  groupId: string;
  groupName: string;
  kind?: "standard" | "direct";
  amount: number;
  currency: string;
  direction: "pay" | "receive";
  signedAmount: number;
  you: Balance;
  other: Balance;
  originalParts: ConvertedPart[];
};

export type PersonSettlement = {
  key: string;
  displayName: string;
  email: string | null;
  avatarUrl: string | null;
  userId: string | null;
  lines: GroupSettlementLine[];
  netsByCurrency: Record<string, number>;
};

export type PersonSettlementHeadline = {
  verb: "pay" | "receive" | "mixed" | "settled";
  headline: string;
  breakdown: string;
  leftover: string;
  unified: UnifiedTotal | null;
};

function normalizeEmail(email?: string | null): string | null {
  if (typeof email !== "string") return null;
  const trimmed = email.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeName(name?: string | null): string {
  return (name ?? "").trim().toLocaleLowerCase();
}

export function personDisplayName(person: {
  full_name?: string | null;
  email?: string | null;
}): string {
  const name = (person.full_name ?? "").trim();
  if (name) return name;
  const email = normalizeEmail(person.email);
  if (!email) return "Someone";
  return email.split("@")[0] || email;
}

function hasUserId(userId?: string | null): userId is string {
  return typeof userId === "string" && userId.length > 0;
}

export function isCurrentUser(
  person: { user_id?: string | null; participant_id?: string | null },
  currentUserId: string,
  currentParticipantId?: string | null
): boolean {
  if (hasUserId(person.user_id) && person.user_id === currentUserId) return true;
  if (currentParticipantId && person.participant_id === currentParticipantId) {
    return true;
  }
  return false;
}

export function findCurrentParticipantId(
  balances: Balance[],
  currentUserId: string
): string | undefined {
  return balances.find((balance) => balance.user_id === currentUserId)?.participant_id;
}

/**
 * Cross-group identity. Do not use participant_id to merge — those IDs are
 * unique per group. Same linked account, same email, or the same name-only
 * placeholder collapse to one person.
 */
export function crossGroupIdentityTokens(person: {
  user_id?: string | null;
  email?: string | null;
  full_name?: string | null;
  participant_id?: string | null;
}): string[] {
  const tokens: string[] = [];
  if (hasUserId(person.user_id)) tokens.push(`user:${person.user_id}`);
  const email = normalizeEmail(person.email);
  if (email) tokens.push(`email:${email}`);
  if (tokens.length === 0) {
    const name = normalizeName(person.full_name);
    if (name) tokens.push(`name:${name}`);
  }
  if (tokens.length === 0) {
    tokens.push(`participant:${person.participant_id || "unknown"}`);
  }
  return tokens;
}

function richness(person: {
  user_id?: string | null;
  email?: string | null;
  full_name?: string | null;
  avatar_url?: string | null;
}): number {
  return (hasUserId(person.user_id) ? 4 : 0)
    + (normalizeEmail(person.email) ? 2 : 0)
    + ((person.full_name ?? "").trim() ? 1 : 0)
    + (person.avatar_url ? 1 : 0);
}

function groupByIdentity<T>(
  items: T[],
  identityOf: (item: T) => {
    user_id?: string | null;
    email?: string | null;
    full_name?: string | null;
    participant_id?: string | null;
  }
): T[][] {
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    const current = parent.get(id) ?? id;
    if (current !== id) {
      const root = find(current);
      parent.set(id, root);
      return root;
    }
    parent.set(id, id);
    return id;
  };
  const union = (left: string, right: string) => {
    const a = find(left);
    const b = find(right);
    if (a !== b) parent.set(a, b);
  };

  for (const item of items) {
    const tokens = crossGroupIdentityTokens(identityOf(item));
    for (let i = 1; i < tokens.length; i++) union(tokens[0], tokens[i]);
  }

  const grouped = new Map<string, T[]>();
  for (const item of items) {
    const root = find(crossGroupIdentityTokens(identityOf(item))[0]);
    const list = grouped.get(root) || [];
    list.push(item);
    grouped.set(root, list);
  }
  return Array.from(grouped.values());
}

function originalPartsOf(edge: DebtEdge): ConvertedPart[] {
  if ("originalParts" in edge && Array.isArray(edge.originalParts)) {
    return edge.originalParts;
  }
  return [];
}

export function buildGroupSettlementLines(
  group: GroupSettlementContext,
  currentUserId: string
): GroupSettlementLine[] {
  const currentParticipantId = findCurrentParticipantId(group.balances, currentUserId);
  const edges = group.unifyEnabled
    ? simplifyUnifiedDebts(
      group.balances,
      group.settlementCurrency,
      group.rateBook,
      currentUserId,
      currentParticipantId
    )
    : simplifyDebts(
      group.balances,
      currentUserId,
      group.defaultCurrency,
      currentParticipantId
    );

  const lines: GroupSettlementLine[] = [];
  for (const edge of edges) {
    const fromMe = isCurrentUser(edge.fromUser, currentUserId, currentParticipantId);
    const toMe = isCurrentUser(edge.toUser, currentUserId, currentParticipantId);
    if (fromMe === toMe) continue;

    const direction = fromMe ? "pay" : "receive";
    lines.push({
      groupId: group.groupId,
      groupName: group.groupName,
      kind: group.kind === "direct" ? "direct" : "standard",
      amount: edge.amount,
      currency: edge.currency,
      direction,
      signedAmount: direction === "receive" ? edge.amount : -edge.amount,
      you: fromMe ? edge.fromUser : edge.toUser,
      other: fromMe ? edge.toUser : edge.fromUser,
      originalParts: originalPartsOf(edge),
    });
  }
  return lines;
}

function sortLines(left: GroupSettlementLine, right: GroupSettlementLine): number {
  if (left.direction !== right.direction) {
    return left.direction === "pay" ? -1 : 1;
  }
  if (right.amount !== left.amount) return right.amount - left.amount;
  return left.groupName.localeCompare(right.groupName);
}

function absoluteNet(nets: Record<string, number>): number {
  return Object.values(nets).reduce((sum, amount) => sum + Math.abs(amount), 0);
}

export function clubPersonSettlements(
  groups: GroupSettlementContext[],
  currentUserId: string
): PersonSettlement[] {
  const lines = groups.flatMap((group) => buildGroupSettlementLines(group, currentUserId));
  const clustered = groupByIdentity(lines, (line) => line.other);

  return clustered.map((personLines) => {
    const richest = [...personLines]
      .map((line) => line.other)
      .sort((left, right) => {
        const richOrder = richness(right) - richness(left);
        if (richOrder !== 0) return richOrder;
        return (right.full_name || "").trim().length - (left.full_name || "").trim().length;
      })[0];
    const netsByCurrency: Record<string, number> = {};
    for (const line of personLines) {
      const currency = (line.currency || getDefaultCurrency()).toUpperCase();
      netsByCurrency[currency] = (netsByCurrency[currency] || 0) + line.signedAmount;
    }

    const tokens = crossGroupIdentityTokens(richest);
    return {
      key: tokens[0],
      displayName: personDisplayName(richest),
      email: normalizeEmail(richest.email),
      avatarUrl: richest.avatar_url || null,
      userId: hasUserId(richest.user_id) ? richest.user_id : null,
      lines: [...personLines].sort(sortLines),
      netsByCurrency,
    };
  }).sort((left, right) => {
    const leftPay = left.lines.some((line) => line.direction === "pay");
    const rightPay = right.lines.some((line) => line.direction === "pay");
    if (leftPay !== rightPay) return leftPay ? -1 : 1;
    const netOrder = absoluteNet(right.netsByCurrency) - absoluteNet(left.netsByCurrency);
    if (netOrder !== 0) return netOrder;
    return left.displayName.localeCompare(right.displayName);
  });
}

export function personSettlementHeadline(
  person: PersonSettlement,
  preferredCurrency: string,
  rateBook: RateBook
): PersonSettlementHeadline {
  const visible = Object.entries(person.netsByCurrency)
    .filter(([, amount]) => Math.abs(amount) >= 0.01);
  if (visible.length === 0) {
    return {
      verb: "settled",
      headline: formatShareCurrency(0, preferredCurrency),
      breakdown: "",
      leftover: "",
      unified: null,
    };
  }

  if (visible.length === 1) {
    const [currency, amount] = visible[0];
    return {
      verb: amount > 0.01 ? "receive" : amount < -0.01 ? "pay" : "settled",
      headline: formatShareCurrency(Math.abs(amount), currency),
      breakdown: "",
      leftover: "",
      unified: null,
    };
  }

  const signs = new Set(visible.map(([, amount]) => (amount > 0 ? 1 : -1)));
  const unified = unifyTotals(person.netsByCurrency, preferredCurrency, rateBook);
  const leftover = unified.leftover
    .filter((part) => Math.abs(part.original) >= 0.01)
    .map((part) => formatCurrency(Math.abs(part.original), part.currency))
    .join(" + ");

  if (signs.size > 1 && Math.abs(unified.amount) < 0.01) {
    return {
      verb: "mixed",
      headline: leftover || "Open balances",
      breakdown: person.lines.map((line) => line.groupName).join(" · "),
      leftover,
      unified,
    };
  }

  const verb: PersonSettlementHeadline["verb"] = Math.abs(unified.amount) < 0.01
    ? (leftover ? "mixed" : "settled")
    : unified.amount > 0 ? "receive" : "pay";

  return {
    verb,
    headline: leftover && Math.abs(unified.amount) < 0.01
      ? leftover
      : formatUnifiedHeadline({
        ...unified,
        leftover: leftover ? unified.leftover : [],
      }),
    breakdown: formatBreakdown(unified.parts),
    leftover,
    unified,
  };
}

export function settlementSummary(people: PersonSettlement[]): {
  personCount: number;
  lineCount: number;
  payCount: number;
  receiveCount: number;
} {
  return {
    personCount: people.length,
    lineCount: people.reduce((sum, person) => sum + person.lines.length, 0),
    payCount: people.reduce(
      (sum, person) => sum + person.lines.filter((line) => line.direction === "pay").length,
      0
    ),
    receiveCount: people.reduce(
      (sum, person) => sum + person.lines.filter((line) => line.direction === "receive").length,
      0
    ),
  };
}

export function groupContextsFromBalances(options: {
  groupBalances: GroupBalance[];
  groups: Group[];
  prefsGroups: Record<string, {
    enabled: boolean;
    settlementCurrency: string;
    customRates: Record<string, number>;
  }>;
  marketBook: RateBook;
  preferredCurrency: string;
  defaultCurrency?: string;
  /**
   * Server (or hydrated) pair overrides keyed by group id.
   * Settlements must use these — market FX alone diverges from the group page
   * whenever a group has a custom rate (e.g. Phuket THB→INR).
   */
  groupCustomRates?: Record<string, Record<string, number>>;
}): GroupSettlementContext[] {
  const fallback = options.defaultCurrency || options.preferredCurrency || getDefaultCurrency();
  const groupById = new Map(options.groups.map((group) => [group.id, group]));

  return options.groupBalances.flatMap((groupBalance) => {
    const group = groupById.get(groupBalance.group_id);
    // Former members still have a participant row and a balance, but settlement
    // inserts require group_members.status = 'active'. Including a left group
    // in settle-all makes Postgres reject the row and the client report
    // "Couldn't settle all groups" (Sentry REACT-NATIVE-22).
    if (group?.user_status === "left") return [];
    const stored = options.prefsGroups[groupBalance.group_id];
    const settings = stored || groupSettingsFromGroup(group, fallback);
    const customRates = options.groupCustomRates?.[groupBalance.group_id]
      ?? settings.customRates
      ?? {};
    const kind = groupBalance.group_kind === "direct" || group?.kind === "direct"
      ? "direct"
      : "standard";
    return [{
      groupId: groupBalance.group_id,
      groupName: groupBalance.group_name || group?.name || "Group",
      kind,
      balances: groupBalance.balances,
      unifyEnabled: settings.enabled === true,
      settlementCurrency: settings.settlementCurrency || fallback,
      rateBook: resolveRateBook(options.marketBook, customRates),
      defaultCurrency: fallback,
    }];
  });
}

export function membersFromSettlementLine(
  line: GroupSettlementLine,
  currentUserId: string
): { members: GroupMember[]; participants: Participant[] } {
  const youId = line.you.participant_id || line.you.user_id || currentUserId;
  const otherId = line.other.participant_id || line.other.user_id || "other";
  const members: GroupMember[] = [
    {
      id: youId,
      group_id: line.groupId,
      user_id: hasUserId(line.you.user_id) ? line.you.user_id : currentUserId,
      participant_id: line.you.participant_id,
      role: "member",
      joined_at: "",
      email: line.you.email,
      full_name: line.you.full_name || "You",
      avatar_url: line.you.avatar_url,
    },
    {
      id: otherId,
      group_id: line.groupId,
      user_id: hasUserId(line.other.user_id) ? line.other.user_id : "",
      participant_id: line.other.participant_id,
      role: "member",
      joined_at: "",
      email: line.other.email,
      full_name: line.other.full_name,
      avatar_url: line.other.avatar_url,
    },
  ];
  const participants: Participant[] = members.map((member) => ({
    id: member.participant_id || member.id,
    group_id: line.groupId,
    user_id: member.user_id || null,
    email: member.email || null,
    type: "member",
    full_name: member.full_name || null,
    avatar_url: member.avatar_url || null,
  }));
  return { members, participants };
}

export function settleBalanceFromLine(line: GroupSettlementLine): Balance {
  return {
    ...line.other,
    amount: line.signedAmount,
    currency: line.currency,
  };
}

export function canRecordSettlementLine(line: GroupSettlementLine): boolean {
  return Boolean(line.you.participant_id && line.other.participant_id);
}

export type SettlementCreateInput = {
  group_id: string;
  group_name: string;
  from_participant_id: string;
  to_participant_id: string;
  amount: number;
  currency: string;
  direction: "pay" | "receive";
  notes?: string;
};

export function settlementCreateFromLine(
  line: GroupSettlementLine,
  notes?: string
): SettlementCreateInput | null {
  if (!canRecordSettlementLine(line) || !line.you.participant_id || !line.other.participant_id) {
    return null;
  }
  return {
    group_id: line.groupId,
    group_name: line.groupName,
    from_participant_id: line.direction === "pay"
      ? line.you.participant_id
      : line.other.participant_id,
    to_participant_id: line.direction === "pay"
      ? line.other.participant_id
      : line.you.participant_id,
    amount: line.amount,
    currency: line.currency,
    direction: line.direction,
    notes,
  };
}

export type PersonSettlePlan = {
  recordable: SettlementCreateInput[];
  skipped: GroupSettlementLine[];
  groupCount: number;
  canSettleAll: boolean;
};

export function personSettlePlan(
  person: PersonSettlement,
  notes?: string
): PersonSettlePlan {
  const recordable: SettlementCreateInput[] = [];
  const skipped: GroupSettlementLine[] = [];
  for (const line of person.lines) {
    const payload = settlementCreateFromLine(line, notes);
    if (payload) recordable.push(payload);
    else skipped.push(line);
  }
  return {
    recordable,
    skipped,
    groupCount: new Set(person.lines.map((line) => line.groupId)).size,
    canSettleAll: recordable.length > 0 && skipped.length === 0,
  };
}

export function personSettleNotes(person: PersonSettlement): string {
  const groups = new Set(person.lines.map((line) => line.groupName));
  if (groups.size <= 1) return `Settled with ${person.displayName}`;
  return `Settled with ${person.displayName} across ${groups.size} groups`;
}

export function personSettleActionLabel(
  person: PersonSettlement,
  headline: PersonSettlementHeadline,
  options?: { compact?: boolean }
): string {
  const plan = personSettlePlan(person);
  if (options?.compact) {
    if (headline.verb === "pay") return `Pay ${headline.headline}`;
    if (headline.verb === "receive") return `Record ${headline.headline}`;
    if (headline.verb === "mixed") return `Settle ${plan.groupCount} groups`;
    return "Settled";
  }
  if (headline.verb === "pay") {
    return plan.groupCount > 1
      ? `Pay ${headline.headline} and close ${plan.groupCount} groups`
      : `Pay ${headline.headline}`;
  }
  if (headline.verb === "receive") {
    return plan.groupCount > 1
      ? `Record ${headline.headline} and close ${plan.groupCount} groups`
      : `Record ${headline.headline}`;
  }
  if (headline.verb === "mixed") {
    return `Settle ${plan.groupCount} groups`;
  }
  return "Settled";
}
