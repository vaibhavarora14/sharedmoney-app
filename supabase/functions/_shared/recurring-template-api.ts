import { isUniqueViolation } from './clientRequestId.ts';
import { createErrorResponse, handleError } from './error-handler.ts';
import { createSuccessResponse } from './response.ts';
import { isValidUUID } from './validation.ts';
import {
  isPeriodKey,
  isRecurringCadence,
  isRecurringTemplateStatus,
  resolveRecurringView,
  type RecurringCadence,
  type RecurringCycleLookup,
  type RecurringTemplateStatus,
  type RecurringViewState,
} from './recurring-templates.ts';

const TEMPLATE_COLUMNS =
  'id, group_id, title, amount, currency, category, cadence, anchor_date, paid_by_participant_id, split_among_participant_ids, status, created_by, created_at, updated_at';

type SupabaseClient = any;

type TemplateRow = {
  id: string;
  group_id: string;
  cadence: RecurringCadence;
  anchor_date: string;
  status: RecurringTemplateStatus;
  amount: number | string;
  paid_by_participant_id?: string | null;
  split_among_participant_ids?: string[] | null;
};

export async function loadRecurringTemplateViews(
  supabase: SupabaseClient,
  groupId: string,
  now = new Date(),
) {
  const { data: templates, error } = await supabase
    .from('recurring_templates')
    .select(TEMPLATE_COLUMNS)
    .eq('group_id', groupId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  if (!templates?.length) return [];

  const { data: cycles, error: cycleError } = await supabase
    .from('recurring_template_cycles')
    .select('template_id, period_key, status, transaction_id')
    .in('template_id', templates.map((template: { id: string }) => template.id));
  if (cycleError) throw cycleError;

  const cyclesByTemplate = new Map<string, RecurringCycleLookup[]>();
  for (const cycle of cycles || []) {
    const list = cyclesByTemplate.get(cycle.template_id) || [];
    list.push({
      period_key: cycle.period_key,
      status: cycle.status,
      transaction_id: cycle.transaction_id,
    });
    cyclesByTemplate.set(cycle.template_id, list);
  }

  return templates.map((template: TemplateRow) => {
    const view = resolveRecurringView({
      cadence: template.cadence,
      anchorDate: template.anchor_date,
      templateStatus: template.status,
      cycles: cyclesByTemplate.get(template.id) || [],
      now,
    });
    return decorateTemplate(template, view);
  });
}

export async function handleRecurringTemplateRequest(params: {
  req: Request;
  supabase: SupabaseClient;
  user: { id: string };
  groupId: string;
  action: string | null;
  httpMethod: string;
  body: string | null;
}): Promise<Response | null> {
  const { req, supabase, user, groupId, action, httpMethod, body } = params;
  if (
    action !== 'recurring-templates' &&
    action !== 'recurring-template-cycles'
  ) {
    return null;
  }
  if (!isValidUUID(groupId)) {
    return createErrorResponse(400, 'Invalid group_id format. Expected UUID.', 'VALIDATION_ERROR', undefined, req);
  }

  const { data: membership } = await supabase
    .from('group_members')
    .select('status')
    .eq('group_id', groupId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (membership?.status !== 'active') {
    return createErrorResponse(403, 'Not an active group member', 'PERMISSION_DENIED', undefined, req);
  }

  const { data: group, error: groupError } = await supabase
    .from('groups')
    .select('id, kind')
    .eq('id', groupId)
    .maybeSingle();
  if (groupError) return handleError(groupError, 'loading group for recurring templates', req);
  if (!group) return createErrorResponse(404, 'Group not found', 'NOT_FOUND', undefined, req);
  if (group.kind === 'direct') {
    return createErrorResponse(400, 'Recurring templates are for shared groups, not 1:1 ledgers.', 'VALIDATION_ERROR', undefined, req);
  }

  try {
    if (action === 'recurring-templates' && httpMethod === 'POST') {
      const parsed = parseTemplateWrite(body, { requireCore: true });
      if (!parsed.ok) return createErrorResponse(400, parsed.error, 'VALIDATION_ERROR', undefined, req);
      const participantError = await assertParticipantsInGroup(supabase, groupId, parsed.value);
      if (participantError) return createErrorResponse(400, participantError, 'VALIDATION_ERROR', undefined, req);
      const { data, error } = await supabase
        .from('recurring_templates')
        .insert({
          group_id: groupId,
          created_by: user.id,
          ...parsed.value,
        })
        .select(TEMPLATE_COLUMNS)
        .single();
      if (error || !data) return handleError(error || new Error('Failed to create template'), 'creating recurring template', req);
      const [view] = await decorate([data], supabase);
      return createSuccessResponse(view, 201, 0, req);
    }

    if (action === 'recurring-templates' && httpMethod === 'PATCH') {
      const parsed = parseTemplateWrite(body, { requireCore: false });
      if (!parsed.ok) return createErrorResponse(400, parsed.error, 'VALIDATION_ERROR', undefined, req);
      if (!parsed.id) return createErrorResponse(400, 'id is required', 'VALIDATION_ERROR', undefined, req);
      const participantError = await assertParticipantsInGroup(supabase, groupId, parsed.value);
      if (participantError) return createErrorResponse(400, participantError, 'VALIDATION_ERROR', undefined, req);
      const { data, error } = await supabase
        .from('recurring_templates')
        .update({ ...parsed.value, updated_at: new Date().toISOString() })
        .eq('id', parsed.id)
        .eq('group_id', groupId)
        .select(TEMPLATE_COLUMNS)
        .single();
      if (error || !data) return handleError(error || new Error('Template not found'), 'updating recurring template', req);
      const [view] = await decorate([data], supabase);
      return createSuccessResponse(view, 200, 0, req);
    }

    if (action === 'recurring-templates' && httpMethod === 'DELETE') {
      const url = new URL(req.url);
      const id = url.searchParams.get('id');
      if (!id || !isValidUUID(id)) {
        return createErrorResponse(400, 'id is required', 'VALIDATION_ERROR', undefined, req);
      }
      const { error } = await supabase
        .from('recurring_templates')
        .delete()
        .eq('id', id)
        .eq('group_id', groupId);
      if (error) return handleError(error, 'deleting recurring template', req);
      return createSuccessResponse({ success: true }, 200, 0, req);
    }

    if (action === 'recurring-template-cycles' && httpMethod === 'POST') {
      let payload: { template_id?: string; action?: string; transaction_id?: number; period_key?: string };
      try {
        payload = body ? JSON.parse(body) : {};
      } catch {
        return createErrorResponse(400, 'Invalid JSON in request body', 'VALIDATION_ERROR', undefined, req);
      }
      if (!payload.template_id || !isValidUUID(payload.template_id)) {
        return createErrorResponse(400, 'template_id is required', 'VALIDATION_ERROR', undefined, req);
      }
      if (payload.action !== 'add' && payload.action !== 'skip') {
        return createErrorResponse(400, 'action must be add or skip', 'VALIDATION_ERROR', undefined, req);
      }
      const { data: template, error: templateError } = await supabase
        .from('recurring_templates')
        .select(TEMPLATE_COLUMNS)
        .eq('id', payload.template_id)
        .eq('group_id', groupId)
        .single();
      if (templateError || !template) {
        return createErrorResponse(404, 'Template not found', 'NOT_FOUND', undefined, req);
      }
      const [view] = await decorate([template], supabase);
      if (!view || view.current_status !== 'due') {
        return createErrorResponse(400, 'This cycle is not due.', 'VALIDATION_ERROR', undefined, req);
      }
      const key = payload.period_key || view.current_period_key;
      if (!isPeriodKey(template.cadence, key) || key !== view.current_period_key) {
        return createErrorResponse(400, 'period_key must be the open due cycle.', 'VALIDATION_ERROR', undefined, req);
      }

      let transactionId: number | null = null;
      if (payload.action === 'add') {
        if (!Number.isInteger(payload.transaction_id)) {
          return createErrorResponse(400, 'transaction_id is required when adding a cycle.', 'VALIDATION_ERROR', undefined, req);
        }
        const { data: transaction, error: transactionError } = await supabase
          .from('transactions')
          .select('id, group_id, type')
          .eq('id', payload.transaction_id)
          .eq('group_id', groupId)
          .maybeSingle();
        if (transactionError) return handleError(transactionError, 'verifying cycle transaction', req);
        if (!transaction) {
          return createErrorResponse(400, 'transaction_id must belong to this group.', 'VALIDATION_ERROR', undefined, req);
        }
        transactionId = transaction.id;
      }

      const { data: cycle, error } = await supabase
        .from('recurring_template_cycles')
        .insert({
          template_id: template.id,
          period_key: key,
          status: payload.action === 'add' ? 'added' : 'skipped',
          transaction_id: transactionId,
          decided_by: user.id,
          decided_at: new Date().toISOString(),
        })
        .select('template_id, period_key, status, transaction_id')
        .single();
      if (isUniqueViolation(error)) {
        return createErrorResponse(409, 'This cycle was already marked.', 'CONFLICT', undefined, req);
      }
      if (error || !cycle) return handleError(error || new Error('Failed to record cycle'), 'recording recurring cycle', req);
      const [nextView] = await decorate([template], supabase);
      return createSuccessResponse({ cycle, template: nextView }, 200, 0, req);
    }

    return createErrorResponse(405, 'Method not allowed', 'METHOD_NOT_ALLOWED', undefined, req);
  } catch (error) {
    return handleError(error, 'recurring templates handler', req);
  }
}

function decorateTemplate(template: TemplateRow, view: RecurringViewState) {
  return {
    ...template,
    amount: Number(template.amount),
    current_period_key: view.current_period_key,
    current_status: view.current_status,
    due_on: view.due_on,
    current_transaction_id: view.current_transaction_id,
  };
}

async function decorate(templates: TemplateRow[], supabase: SupabaseClient) {
  if (templates.length === 0) return [];
  const groupId = templates[0].group_id;
  const views = await loadRecurringTemplateViews(supabase, groupId);
  const byId = new Map(views.map((view: { id: string }) => [view.id, view]));
  return templates.map((template) => byId.get(template.id) || template);
}

async function assertParticipantsInGroup(
  supabase: SupabaseClient,
  groupId: string,
  value: Record<string, unknown>,
): Promise<string | null> {
  const ids: string[] = [];
  if (typeof value.paid_by_participant_id === 'string') ids.push(value.paid_by_participant_id);
  if (Array.isArray(value.split_among_participant_ids)) {
    ids.push(...value.split_among_participant_ids as string[]);
  }
  const unique = [...new Set(ids)];
  if (unique.length === 0) return null;
  const { data, error } = await supabase
    .from('participants')
    .select('id, group_id, type')
    .in('id', unique);
  if (error) throw error;
  if (!data || data.length !== unique.length || data.some((row: { group_id: string }) => row.group_id !== groupId)) {
    return 'Participants must belong to this group.';
  }
  if (data.some((row: { type?: string }) => row.type === 'former')) {
    return 'Former members cannot be used on a recurring template.';
  }
  return null;
}

function parseTemplateWrite(body: string | null, options: { requireCore: boolean }):
  | { ok: true; id?: string; value: Record<string, unknown> }
  | { ok: false; error: string } {
  let raw: Record<string, unknown>;
  try {
    raw = body ? JSON.parse(body) : {};
  } catch {
    return { ok: false, error: 'Invalid JSON in request body' };
  }

  const id = typeof raw.id === 'string' ? raw.id : undefined;
  if (id && !isValidUUID(id)) return { ok: false, error: 'Invalid template id' };

  const value: Record<string, unknown> = {};
  const has = (key: string) => Object.prototype.hasOwnProperty.call(raw, key);

  if (options.requireCore || has('title')) {
    if (typeof raw.title !== 'string' || raw.title.trim().length < 1 || raw.title.trim().length > 80) {
      return { ok: false, error: 'title must be between 1 and 80 characters' };
    }
    value.title = raw.title.trim();
  }
  if (options.requireCore || has('amount')) {
    const amount = typeof raw.amount === 'number' ? raw.amount : Number(raw.amount);
    if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: 'amount must be greater than 0' };
    value.amount = Math.round(amount * 100) / 100;
  }
  if (options.requireCore || has('currency')) {
    if (typeof raw.currency !== 'string' || !/^[A-Za-z]{3}$/.test(raw.currency)) {
      return { ok: false, error: 'currency must be a 3-letter code' };
    }
    value.currency = raw.currency.toUpperCase();
  }
  if (options.requireCore || has('cadence')) {
    if (!isRecurringCadence(raw.cadence)) return { ok: false, error: 'cadence must be weekly, monthly, or yearly' };
    value.cadence = raw.cadence;
  }
  if (options.requireCore || has('anchor_date')) {
    if (typeof raw.anchor_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw.anchor_date)) {
      return { ok: false, error: 'anchor_date must be YYYY-MM-DD' };
    }
    value.anchor_date = raw.anchor_date;
  }
  if (has('category')) {
    value.category = typeof raw.category === 'string' && raw.category.trim() ? raw.category.trim() : null;
  }
  if (has('paid_by_participant_id')) {
    if (raw.paid_by_participant_id != null && (typeof raw.paid_by_participant_id !== 'string' || !isValidUUID(raw.paid_by_participant_id))) {
      return { ok: false, error: 'paid_by_participant_id must be a UUID' };
    }
    value.paid_by_participant_id = raw.paid_by_participant_id ?? null;
  }
  if (has('split_among_participant_ids')) {
    if (!Array.isArray(raw.split_among_participant_ids) || raw.split_among_participant_ids.some((item) => typeof item !== 'string' || !isValidUUID(item))) {
      return { ok: false, error: 'split_among_participant_ids must be an array of UUIDs' };
    }
    value.split_among_participant_ids = raw.split_among_participant_ids;
  }
  if (has('status')) {
    if (!isRecurringTemplateStatus(raw.status)) return { ok: false, error: 'status must be active or paused' };
    value.status = raw.status as RecurringTemplateStatus;
  }

  if (options.requireCore && Object.keys(value).length < 5) {
    return { ok: false, error: 'title, amount, currency, cadence, and anchor_date are required' };
  }
  if (!options.requireCore && Object.keys(value).length === 0) {
    return { ok: false, error: 'Provide at least one field to update' };
  }
  return { ok: true, id, value };
}
