export interface DensePerson {
  key: string;
  name: string;
  avatarUrl: string | null;
}

type NamedPerson = {
  participant_id?: string | null;
  user_id?: string | null;
  id?: string | null;
  full_name?: string | null;
  email?: string | null;
  avatar_url?: string | null;
};

function personKey(person: NamedPerson): string | null {
  return person.participant_id || person.user_id || person.id || null;
}

function personName(person: NamedPerson): string {
  return (person.full_name || person.email || "").trim();
}

function pushUnique(people: DensePerson[], person: NamedPerson): void {
  const key = personKey(person);
  const name = personName(person);
  if (!key || !name) return;
  if (people.some((entry) => entry.key === key)) return;
  people.push({
    key,
    name,
    avatarUrl: person.avatar_url || null,
  });
}

/** Group / 1:1 list avatars from already-loaded balance rows. */
export function densePeopleFromBalances(
  balances: NamedPerson[] | undefined,
  options?: { excludeUserId?: string },
): DensePerson[] {
  const people: DensePerson[] = [];
  for (const row of balances ?? []) {
    if (options?.excludeUserId && row.user_id === options.excludeUserId) continue;
    pushUnique(people, row);
  }
  return people;
}

export function densePeopleFromParticipants(
  people: NamedPerson[] | undefined,
): DensePerson[] {
  const result: DensePerson[] = [];
  for (const person of people ?? []) {
    pushUnique(result, person);
  }
  return result;
}

export function fallbackDensePerson(key: string, name: string): DensePerson {
  return { key, name: name.trim() || "Group", avatarUrl: null };
}

type LedgerNameSource = {
  id?: string | null;
  participant_id?: string | null;
  user_id?: string | null;
  full_name?: string | null;
  email?: string | null;
  avatar_url?: string | null;
};

function lookupPerson(
  participantId: string | null | undefined,
  userId: string | null | undefined,
  sources: LedgerNameSource[],
): LedgerNameSource | undefined {
  return sources.find((person) => {
    if (participantId && (person.id === participantId || person.participant_id === participantId)) {
      return true;
    }
    if (userId && person.user_id === userId) return true;
    return false;
  });
}

export function densePeopleForExpense(input: {
  payerName: string;
  paidByParticipantId?: string | null;
  paidByUserId?: string | null;
  splits?: Array<{
    participant_id: string;
    user_id?: string | null;
    full_name?: string | null;
    avatar_url?: string | null;
  }> | null;
  participants?: LedgerNameSource[];
  members?: LedgerNameSource[];
}): DensePerson[] {
  const sources = [...(input.participants ?? []), ...(input.members ?? [])];
  const fromSplits = densePeopleFromBalances(input.splits ?? []);
  if (fromSplits.length >= 2) return fromSplits;
  const payer = lookupPerson(input.paidByParticipantId, input.paidByUserId, [
    ...fromSplits.map((person) => ({
      id: person.key,
      full_name: person.name,
      avatar_url: person.avatarUrl,
    })),
    ...sources,
    ...(input.splits ?? []),
  ]);
  if (payer) {
    const people: DensePerson[] = [];
    pushUnique(people, payer);
    if (people.length > 0) return people;
  }
  return [fallbackDensePerson(
    input.paidByParticipantId || input.paidByUserId || "payer",
    input.payerName,
  )];
}

export function densePeopleForPayment(input: {
  fromName: string;
  toName: string;
  fromParticipantId?: string | null;
  fromUserId?: string | null;
  toParticipantId?: string | null;
  toUserId?: string | null;
  participants?: LedgerNameSource[];
  members?: LedgerNameSource[];
}): DensePerson[] {
  const sources = [...(input.participants ?? []), ...(input.members ?? [])];
  const people: DensePerson[] = [];
  const from = lookupPerson(input.fromParticipantId, input.fromUserId, sources);
  const to = lookupPerson(input.toParticipantId, input.toUserId, sources);
  if (from) pushUnique(people, from);
  else people.push(fallbackDensePerson(
    input.fromParticipantId || input.fromUserId || "from",
    input.fromName,
  ));
  if (to) pushUnique(people, to);
  else people.push(fallbackDensePerson(
    input.toParticipantId || input.toUserId || "to",
    input.toName,
  ));
  return people;
}
