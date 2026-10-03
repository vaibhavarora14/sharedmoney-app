export interface Participant {
  id: string;
  group_id: string;
  user_id?: string | null;
  email?: string | null;
  phone?: string | null;
  type: 'member' | 'invited' | 'former';
  role?: 'owner' | 'member';
  full_name?: string | null;
  avatar_url?: string | null;
  joined_at?: string;
  left_at?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface TransactionSplit {
  id?: string;
  transaction_id?: number;
  participant_id: string; // New: participant reference
  user_id?: string | null; // Legacy: kept for backward compatibility
  email?: string | null; // Legacy: kept for backward compatibility
  amount: number; // Individual split amount (for equal splits: transaction.amount / split_count)
  created_at?: string;
  full_name?: string | null; // Populated from participant or API join
  avatar_url?: string | null; // Populated from participant or API join
  participant?: Participant; // Enriched participant data
}

export interface Transaction {
  id: number;
  amount: number;
  description: string;
  date: string;
  type: 'income' | 'expense';
  category?: string;
  created_at?: string;
  user_id?: string;
  group_id?: string;
  currency?: string;
  paid_by?: string; // Legacy: User ID of who paid (deprecated, use paid_by_participant_id)
  paid_by_participant_id?: string; // Participant who paid
  split_among?: string[]; // Legacy: Array of user IDs/emails (deprecated, use split_among_participant_ids)
  split_among_participant_ids?: string[]; // Array of participant IDs to split among
  splits?: TransactionSplit[]; // From transaction_splits table (preferred for reading)
}

export interface Currency {
  code: string;
  symbol: string;
  name: string;
}

export interface AmountInfo {
  text: string;
  color: string;
}

export interface Group {
  id: string;
  name: string;
  description?: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  user_status?: 'active' | 'left' | 'invited';
  /** Per-user: when set, group is under Archived (not Active). */
  archived_at?: string | null;
  /** Per-user: when set, group is removed from Active/Archived/Former for this user. */
  hidden_at?: string | null;
  settlement_currency?: string | null;
  unify_balances?: boolean;
}

export interface GroupMember {
  id: string;
  group_id: string;
  user_id: string;
  participant_id?: string; // New: link to participant
  role: 'owner' | 'member';
  status?: 'active' | 'left' | 'invited'; // 'invited' for users who haven't signed up yet
  joined_at: string;
  left_at?: string | null;
  archived_at?: string | null;
  hidden_at?: string | null;
  email?: string;
  full_name?: string | null;
  avatar_url?: string | null;
}

export interface GroupInvitation {
  id: string;
  group_id: string;
  /** Invitee email; null for shareable link invites */
  email?: string | null;
  /** Invitee phone in E.164; null for email and shareable link invites */
  phone?: string | null;
  invited_by: string;
  status: 'pending' | 'accepted' | 'expired' | 'cancelled';
  token?: string;
  expires_at: string;
  created_at: string;
  accepted_at?: string;
  user_id?: string; // User ID if the invited user has signed up
  /** Link invites: how many users the link admits (null for email invites) */
  max_uses?: number | null;
  /** Link invites: how many users have joined through the link */
  uses_count?: number | null;
}

export interface GroupWithMembers extends Group {
  members?: GroupMember[];
  invitations?: GroupInvitation[];
}

export type CurrencyCode = string;

export interface Balance {
  user_id: string;
  participant_id?: string; // New: link to participant
  email?: string; // Enriched by API
  full_name?: string | null; // Enriched by API
  avatar_url?: string | null; // Enriched by API
  amount: number;
  currency: string; // Keeping as string for flexibility, but could be CurrencyCode
} // Positive = they owe you, Negative = you owe them

export interface GroupBalance {
  group_id: string;
  group_name: string;
  balances: Balance[];
}

export interface BalancesResponse {
  group_balances: GroupBalance[];
  overall_balances: Balance[];
  group_stats?: GroupStatsResponse;
}

export interface GroupStatsMemberBreakdown {
  participant_id: string;
  user_id?: string;
  email?: string | null;
  full_name?: string | null;
  avatar_url?: string | null;
  share_totals: Record<string, number>;
  paid_totals: Record<string, number>;
  net_balances: Record<string, number>;
}

export interface GroupStatsMyTransaction {
  transaction: Transaction;
  share_amount: number | null;
  is_payer: boolean;
  net_receivable: number | null;
}

export interface GroupStatsSettlementEdge {
  from_participant_id?: string;
  from_user_id?: string;
  from_full_name?: string | null;
  from_email?: string | null;
  from_avatar_url?: string | null;
  to_participant_id?: string;
  to_user_id?: string;
  to_full_name?: string | null;
  to_email?: string | null;
  to_avatar_url?: string | null;
  amount: number;
  currency: string;
}

export interface GroupStatsResponse {
  member_breakdown: GroupStatsMemberBreakdown[];
  my_transactions: GroupStatsMyTransaction[];
  totals: {
    my_share: Record<string, number>;
    group_total: Record<string, number>;
    i_owe: Record<string, number>;
    im_owed: Record<string, number>;
  };
  settlement_plan: GroupStatsSettlementEdge[];
}

export interface Settlement {
  id: string;
  group_id: string;
  from_user_id: string; // Legacy: kept for backward compatibility
  to_user_id: string; // Legacy: kept for backward compatibility
  from_participant_id?: string; // New: Participant who is paying
  to_participant_id?: string; // New: Participant who is receiving
  amount: number;
  currency: string;
  notes?: string;
  created_by: string;
  created_at: string;
  from_user_email?: string;
  to_user_email?: string;
}

export interface SettlementsResponse {
  settlements: Settlement[];
}

export interface ActivityItem {
  id: string;
  type: 'transaction_created' | 'transaction_updated' | 'transaction_deleted' | 'settlement_created' | 'settlement_updated' | 'settlement_deleted';
  transaction_id?: number;
  settlement_id?: string;
  group_id: string;
  changed_by: {
    id: string;
    email: string;
    full_name?: string | null;
    avatar_url?: string | null;
  };
  changed_at: string;
  description: string;
  details: {
    action: 'created' | 'updated' | 'deleted';
    changes?: {
      [field: string]: {
        old: any;
        new: any;
      };
    };
    transaction?: Transaction;
    settlement?: Settlement;
  };
}

export interface ActivityFeedResponse {
  activities: ActivityItem[];
  total: number;
  has_more: boolean;
}
