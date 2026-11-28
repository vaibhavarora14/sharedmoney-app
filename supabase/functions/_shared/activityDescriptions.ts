/**
 * Activity description generation functions
 */

import { formatCurrency } from './currency.ts';

interface TransactionSnapshot {
  id: number;
  amount: number;
  description: string;
  date: string;
  type: string;
  category?: string;
  currency: string;
  user_id: string;
  group_id: string;
  paid_by?: string;
  paid_by_participant_id?: string;
  payers?: Array<{ participant_id?: string; amount?: number }>;
  split_among?: string[];
  split_among_participant_ids?: string[];
  created_at: string;
  updated_at?: string;
}

interface SettlementSnapshot {
  id: string;
  group_id: string;
  from_user_id?: string;
  to_user_id?: string;
  from_participant_id?: string;
  to_participant_id?: string;
  amount: number;
  currency: string;
  notes?: string;
  created_by: string;
  created_at: string;
}

interface ChangesDiff {
  [field: string]: {
    old: unknown;
    new: unknown;
  };
}

interface HistoryChanges {
  action: 'created' | 'updated' | 'deleted';
  diff?: ChangesDiff;
  transaction?: TransactionSnapshot;
  settlement?: SettlementSnapshot;
  transaction_id?: number;
  settlement_id?: string;
}

interface HistorySnapshot {
  transaction?: TransactionSnapshot;
  settlement?: SettlementSnapshot;
}

function normalizeCurrency(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim().toUpperCase();
  }
  return undefined;
}

function resolveCurrencyCode(
  snapshot?: TransactionSnapshot | SettlementSnapshot,
  diff?: ChangesDiff,
  fallback: string = 'USD'
): string {
  const diffCurrency = diff?.currency as { old?: unknown; new?: unknown } | undefined;
  const newCurrency = normalizeCurrency(diffCurrency?.new);
  if (newCurrency) {
    return newCurrency;
  }

  const snapshotCurrency = normalizeCurrency(snapshot?.currency);
  if (snapshotCurrency) {
    return snapshotCurrency;
  }

  const oldCurrency = normalizeCurrency(diffCurrency?.old);
  if (oldCurrency) {
    return oldCurrency;
  }

  return fallback;
}

interface TransactionHistory {
  id: string;
  transaction_id: number | null;
  settlement_id: string | null;
  activity_type: 'transaction' | 'settlement';
  group_id: string;
  action: 'created' | 'updated' | 'deleted';
  changed_by: string;
  changed_at: string;
  changes: HistoryChanges;
  snapshot: HistorySnapshot | null;
}

export function formatFieldName(field: string): string {
  const fieldMap: Record<string, string> = {
    'amount': 'Amount',
    'description': 'Description',
    'date': 'Date',
    'category': 'Category',
    'type': 'Type',
    'paid_by': 'Paid by',
    'paid_by_participant_id': 'Paid by',
    'payers': 'Paid by',
    'split_among': 'Splits',
    'split_among_participant_ids': 'Splits',
    'currency': 'Currency',
    'notes': 'Notes',
    'from_user_id': 'From',
    'to_user_id': 'To',
  };
  return fieldMap[field] || field.charAt(0).toUpperCase() + field.slice(1).replace(/_/g, ' ');
}

interface Participant {
  id: string;
  group_id: string;
  user_id?: string | null;
  email?: string | null;
  type: 'member' | 'invited' | 'former';
  role?: 'owner' | 'member';
  full_name?: string | null;
  avatar_url?: string | null;
}

export function formatValue(
  field: string, 
  value: unknown, 
  currencyCode?: string,
  participantMap?: Map<string, Participant>
): string {
  if (value === null || value === undefined) {
    return 'none';
  }
  
  if (field === 'amount') {
    if (typeof value === 'number') {
      return formatCurrency(value, currencyCode || 'USD');
    }
    if (typeof value === 'string') {
      const num = parseFloat(value);
      if (!isNaN(num)) {
        return formatCurrency(num, currencyCode || 'USD');
      }
    }
    return String(value);
  }
  
  if (field === 'date') {
    try {
      if (typeof value === 'string' || value instanceof Date) {
        return new Date(value).toLocaleDateString();
      }
    } catch {
      // Fall through
    }
  }
  
  // Handle participant_id fields
  if ((field === 'paid_by_participant_id' || field === 'paid_by') && typeof value === 'string') {
    if (participantMap && participantMap.has(value)) {
      const participant = participantMap.get(value)!;
      // Try to get a meaningful display name
      let displayName: string;
      if (participant.full_name) {
        displayName = participant.full_name;
      } else if (participant.email) {
        // Use email username part (before @) if no full_name
        displayName = participant.email.split('@')[0] || participant.email;
      } else if (participant.user_id) {
        // Fallback: use user_id if we have it
        displayName = participant.user_id.substring(0, 8) + '...';
      } else {
        displayName = 'Unknown';
      }
      const typeLabel = participant.type === 'former' ? ' (Former)' : '';
      return `${displayName}${typeLabel}`;
    }
    // Fallback for legacy user_id
    if (field === 'paid_by') {
      return 'User';
    }
    // For participant_id without map, show shortened ID
    return value.substring(0, 8) + '...';
  }
  
  if ((field === 'split_among_participant_ids' || field === 'split_among') && Array.isArray(value)) {
    return `${value.length} person${value.length !== 1 ? 's' : ''}`;
  }

  if (field === 'payers' && Array.isArray(value)) {
    const ids = value
      .map((entry) => {
        if (entry && typeof entry === 'object' && 'participant_id' in entry) {
          return (entry as { participant_id?: string }).participant_id;
        }
        return typeof entry === 'string' ? entry : null;
      })
      .filter((id): id is string => typeof id === 'string' && id.length > 0);
    if (ids.length >= 3) return `${ids.length} people`;
    if (ids.length === 2) {
      return ids.map((id) => getParticipantDisplayName(id, participantMap)).join(' and ');
    }
    if (ids.length === 1) return getParticipantDisplayName(ids[0], participantMap);
    return 'none';
  }
  
  if (Array.isArray(value)) {
    return `${value.length} item${value.length !== 1 ? 's' : ''}`;
  }
  
  const str = String(value);
  if (str.length > 25) {
    return str.substring(0, 25) + '...';
  }
  
  return str;
}

function formatSplitChanges(
  oldSplits: string[],
  newSplits: string[],
  emailMap?: Map<string, string>,
  participantMap?: Map<string, Participant>
): string {
  const oldSet = new Set(oldSplits);
  const newSet = new Set(newSplits);
  
  const addedUsers = newSplits.filter((id: string) => !oldSet.has(id));
  const removedUsers = oldSplits.filter((id: string) => !newSet.has(id));
  
  if (addedUsers.length === 0 && removedUsers.length === 0) {
    return 'changed splits';
  }
  
  const changes: string[] = [];
  
  const getName = (id: string): string => {
    // Try participant map first
    if (participantMap && participantMap.has(id)) {
      const participant = participantMap.get(id)!;
      // Try to get a meaningful display name
      let displayName: string;
      if (participant.full_name) {
        displayName = participant.full_name;
      } else if (participant.email) {
        // Use email username part (before @) if no full_name
        displayName = participant.email.split('@')[0] || participant.email;
      } else if (participant.user_id) {
        // Fallback: use user_id if we have it
        displayName = participant.user_id.substring(0, 8) + '...';
      } else {
        displayName = 'Unknown';
      }
      const typeLabel = participant.type === 'former' ? ' (Former)' : '';
      return `${displayName}${typeLabel}`;
    }
    // Fallback to email map (for legacy user_ids)
    if (emailMap) {
      const email = emailMap.get(id);
      if (email) {
        return email.split('@')[0];
      }
    }
    return id.substring(0, 8) + '...';
  };
  
  if (addedUsers.length > 0) {
    const userNames = addedUsers.map(getName);
    
    if (addedUsers.length === 1) {
      changes.push(`added ${userNames[0]} to splits`);
    } else {
      changes.push(`added ${userNames.join(', ')} to splits`);
    }
  }
  
  if (removedUsers.length > 0) {
    const userNames = removedUsers.map(getName);
    
    if (removedUsers.length === 1) {
      changes.push(`removed ${userNames[0]} from splits`);
    } else {
      changes.push(`removed ${userNames.join(', ')} from splits`);
    }
  }
  
  return changes.join(', ');
}

function getUserName(
  userId: string, 
  emailMap?: Map<string, string>,
  participantMap?: Map<string, Participant>
): string {
  // Try participant map first (by user_id)
  if (participantMap) {
    for (const p of participantMap.values()) {
      if (p.user_id === userId) {
        if (p.full_name) return p.full_name;
        if (p.email) return p.email.split('@')[0];
        break;
      }
    }
  }
  
  if (emailMap) {
    const email = emailMap.get(userId);
    if (email) {
      return email.split('@')[0];
    }
  }
  return 'User';
}

function getParticipantDisplayName(
  participantId: string,
  participantMap?: Map<string, Participant>
): string {
  if (participantMap && participantMap.has(participantId)) {
    const p = participantMap.get(participantId)!;
    if (p.full_name) return p.full_name;
    if (p.email) return p.email.split('@')[0];
    if (p.user_id) return p.user_id.substring(0, 8) + '...';
  }
  return participantId.substring(0, 8) + '...';
}

function generateTransactionCreatedDescription(
  transaction: TransactionSnapshot,
  participantMap?: Map<string, Participant>,
): string {
  const amount = transaction.amount || 0;
  const currency = transaction.currency || 'USD';
  const description = transaction.description || 'transaction';
  const descriptionGlimpse = description.length > 30 
    ? description.substring(0, 30) + '...' 
    : description;
  const payerIds = (transaction.payers ?? [])
    .map((payer) => payer.participant_id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
  if (payerIds.length >= 3) {
    return `${payerIds.length} people paid ${formatCurrency(amount, currency)}`;
  }
  if (payerIds.length === 2) {
    const names = payerIds.map((id) => getParticipantDisplayName(id, participantMap));
    return `${names[0]} and ${names[1]} paid ${formatCurrency(amount, currency)}`;
  }
  return `${formatCurrency(amount, currency)} - ${descriptionGlimpse}`;
}

function generateTransactionUpdatedDescription(
  transaction: TransactionSnapshot | undefined,
  diff: ChangesDiff,
  emailMap?: Map<string, string>,
  participantMap?: Map<string, Participant>
): string {
  const userVisibleFields = Object.keys(diff).filter(field => 
    !['updated_at', 'created_at', 'id'].includes(field)
  );
  
  if (userVisibleFields.length === 0) {
    return 'Updated transaction';
  }

  const currency = resolveCurrencyCode(transaction, diff);
  const descriptionGlimpse = transaction?.description 
    ? (transaction.description.length > 25 
        ? transaction.description.substring(0, 25) + '...' 
        : transaction.description)
    : null;

  const fieldChanges: string[] = [];
  
  userVisibleFields.forEach(field => {
    const { old: oldVal, new: newVal } = diff[field];
    const fieldDisplayName = formatFieldName(field);
    
    if (field === 'split_among' || field === 'split_among_participant_ids') {
      const oldSplits = Array.isArray(oldVal) ? oldVal : [];
      const newSplits = Array.isArray(newVal) ? newVal : [];
      fieldChanges.push(formatSplitChanges(oldSplits, newSplits, emailMap, participantMap));
    } else {
      const currencyCode = field === 'amount' ? currency : undefined;
      fieldChanges.push(`${fieldDisplayName}: ${formatValue(field, oldVal, currencyCode, participantMap)} → ${formatValue(field, newVal, currencyCode, participantMap)}`);
    }
  });

  if (descriptionGlimpse) {
    return `${descriptionGlimpse} - ${fieldChanges.join(', ')}`;
  } else {
    return fieldChanges.join(', ');
  }
}

function generateTransactionDeletedDescription(transaction: TransactionSnapshot): string {
  const amount = transaction.amount || 0;
  const currency = transaction.currency || 'USD';
  const description = transaction.description || 'transaction';
  const descriptionGlimpse = description.length > 30 
    ? description.substring(0, 30) + '...' 
    : description;
  return `Deleted: ${formatCurrency(amount, currency)} - ${descriptionGlimpse}`;
}

function generateSettlementCreatedDescription(
  settlement: SettlementSnapshot,
  emailMap?: Map<string, string>,
  participantMap?: Map<string, Participant>
): string {
  const amount = settlement.amount || 0;
  const currency = settlement.currency || 'USD';
  const fromId = settlement.from_participant_id || settlement.from_user_id || '';
  const toId = settlement.to_participant_id || settlement.to_user_id || '';
  const notes = settlement.notes;
  
  const fromName = getParticipantDisplayName(fromId, participantMap);
  const toName = getParticipantDisplayName(toId, participantMap);
  
  let description = `${fromName} paid ${toName} ${formatCurrency(amount, currency)}`;
  if (notes) {
    const notesGlimpse = notes.length > 20 ? notes.substring(0, 20) + '...' : notes;
    description += ` - ${notesGlimpse}`;
  }
  return description;
}

function generateSettlementUpdatedDescription(
  settlement: SettlementSnapshot | undefined,
  diff: ChangesDiff,
  emailMap?: Map<string, string>,
  participantMap?: Map<string, Participant>
): string {
  const userVisibleFields = Object.keys(diff).filter(field => 
    !['created_at', 'id'].includes(field)
  );
  
  if (userVisibleFields.length === 0) {
    return 'Updated settlement';
  }
  
  const amount = settlement?.amount || 0;
  const currency = resolveCurrencyCode(settlement, diff);
  const fromId = (settlement as any)?.from_participant_id || (settlement as any)?.from_user_id || '';
  const toId = (settlement as any)?.to_participant_id || (settlement as any)?.to_user_id || '';
  
  const fromName = getParticipantDisplayName(fromId, participantMap);
  const toName = getParticipantDisplayName(toId, participantMap);
  
  const fieldChanges: string[] = [];
  userVisibleFields.forEach(field => {
    const { old: oldVal, new: newVal } = diff[field];
    const fieldDisplayName = formatFieldName(field);
    
    if (field === 'amount') {
      fieldChanges.push(`Amount: ${formatValue(field, oldVal, currency)} → ${formatValue(field, newVal, currency)}`);
    } else if (field === 'notes') {
      const oldNotes = oldVal || 'none';
      const newNotes = newVal || 'none';
      fieldChanges.push(`Notes: ${oldNotes} → ${newNotes}`);
    } else {
      fieldChanges.push(`${fieldDisplayName}: ${formatValue(field, oldVal, undefined, participantMap)} → ${formatValue(field, newVal, undefined, participantMap)}`);
    }
  });
  
  return `${fromName} paid ${toName} ${formatCurrency(amount, currency)} - ${fieldChanges.join(', ')}`;
}

function generateSettlementDeletedDescription(
  settlement: SettlementSnapshot,
  emailMap?: Map<string, string>,
  participantMap?: Map<string, Participant>
): string {
  const amount = settlement.amount || 0;
  const currency = settlement.currency || 'USD';
  const fromId = settlement.from_participant_id || settlement.from_user_id || '';
  const toId = settlement.to_participant_id || settlement.to_user_id || '';
  
  const fromName = getParticipantDisplayName(fromId, participantMap);
  const toName = getParticipantDisplayName(toId, participantMap);
  
  return `Deleted settlement: ${fromName} paid ${toName} ${formatCurrency(amount, currency)}`;
}

function extractTransactionFromSnapshot(
  snapshot: HistorySnapshot | null,
  changes: HistoryChanges | undefined,
  activityType: 'transaction' | 'settlement'
): TransactionSnapshot | SettlementSnapshot | undefined {
  if (!snapshot) {
    return changes?.transaction || changes?.settlement;
  }

  // Check if snapshot has nested structure
  if (activityType === 'settlement') {
    if ((snapshot as any).settlement) {
      return (snapshot as any).settlement;
    }
    // Check if snapshot itself is a settlement (flat structure)
    if (
      ('from_user_id' in snapshot && 'to_user_id' in snapshot) ||
      ('from_participant_id' in snapshot && 'to_participant_id' in snapshot)
    ) {
      return snapshot as unknown as SettlementSnapshot;
    }
  } else {
    if ((snapshot as any).transaction) {
      return (snapshot as any).transaction;
    }
    // Check if snapshot itself is a transaction (flat structure)
    if ('amount' in snapshot && 'currency' in snapshot && 'group_id' in snapshot) {
      return snapshot as unknown as TransactionSnapshot;
    }
  }

  return changes?.transaction || changes?.settlement;
}

export function generateActivityDescription(
  history: TransactionHistory,
  emailMap?: Map<string, string>,
  participantMap?: Map<string, Participant>
): string {
  const action = history.action;
  const changes = history.changes;
  const snapshot = history.snapshot;
  const activityType = history.activity_type || 'transaction';
  
  switch (action) {
    case 'created': {
      if (activityType === 'settlement') {
        const settlement = extractTransactionFromSnapshot(snapshot, changes, 'settlement') as SettlementSnapshot | undefined;
        if (settlement) {
          return generateSettlementCreatedDescription(settlement, emailMap, participantMap);
        }
        return 'Created settlement';
      } else {
        const transaction = extractTransactionFromSnapshot(snapshot, changes, 'transaction') as TransactionSnapshot | undefined;
        if (transaction) {
          return generateTransactionCreatedDescription(transaction, participantMap);
        }
        return 'Added transaction';
      }
    }

    case 'updated': {
      if (activityType === 'settlement') {
        const diff = changes?.diff || {};
        const settlement = extractTransactionFromSnapshot(snapshot, changes, 'settlement') as SettlementSnapshot | undefined;
        return generateSettlementUpdatedDescription(settlement, diff, emailMap, participantMap);
      } else {
        const diff = changes?.diff || {};
        const transaction = extractTransactionFromSnapshot(snapshot, changes, 'transaction') as TransactionSnapshot | undefined;
        return generateTransactionUpdatedDescription(transaction, diff, emailMap, participantMap);
      }
    }

    case 'deleted': {
      if (activityType === 'settlement') {
        const settlement = extractTransactionFromSnapshot(snapshot, changes, 'settlement') as SettlementSnapshot | undefined;
        if (settlement) {
          return generateSettlementDeletedDescription(settlement, emailMap, participantMap);
        }
        return 'Deleted settlement';
      } else {
        const transaction = extractTransactionFromSnapshot(snapshot, changes, 'transaction') as TransactionSnapshot | undefined;
        if (transaction) {
          return generateTransactionDeletedDescription(transaction);
        }
        return 'Deleted transaction';
      }
    }

    default:
      return 'Transaction activity';
  }
}
