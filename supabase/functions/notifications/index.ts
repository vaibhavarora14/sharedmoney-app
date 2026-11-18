import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { verifyAuth } from '../_shared/auth.ts';
import { guestSignInRequiredResponse } from '../_shared/guest.ts';
import { lastSeenForPushRegistration, persistLastSeenApp } from '../_shared/last-seen-app.ts';
import {
  buildNotificationCursorFilter,
  isNotificationPermissionStatus,
  isValidExpoPushToken,
  parseNotificationCursor,
  parseNotificationReadIds,
  resolveReadAt,
} from '../_shared/notification-contract.ts';
import { createErrorResponse, handleError } from '../_shared/error-handler.ts';
import { SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL } from '../_shared/env.ts';
import { transactionNotificationsEnabled } from '../_shared/posthog-feature-flags.ts';
import { createEmptyResponse, createSuccessResponse } from '../_shared/response.ts';
import { isValidUUID, validateBodySize } from '../_shared/validation.ts';

const DEFAULT_LIMIT = 40;
const MAX_LIMIT = 100;
interface UnreadSummary {
  unread_count: number;
  unread_by_group: Record<string, number>;
}

interface UnreadSummaryRow {
  group_id: string | null;
  unread_count: number | string;
}

function parseLimit(value: string | null): number {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

function parseJson(body: string | null): Record<string, unknown> {
  if (!body) return {};
  const parsed = JSON.parse(body);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Invalid JSON object');
  }
  return parsed as Record<string, unknown>;
}

function createAdmin(): SupabaseClient {
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Missing required environment variable: SUPABASE_SERVICE_ROLE_KEY');
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

async function fetchUnreadSummary(
  supabase: SupabaseClient,
): Promise<UnreadSummary> {
  const { data, error } = await supabase.rpc('get_notification_unread_summary');
  if (error) throw error;

  const unreadByGroup: Record<string, number> = {};
  let unreadCount = 0;
  for (const row of (data ?? []) as UnreadSummaryRow[]) {
    const count = Number(row.unread_count) || 0;
    unreadCount += count;
    if (row.group_id) unreadByGroup[row.group_id] = count;
  }
  return { unread_count: unreadCount, unread_by_group: unreadByGroup };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return createEmptyResponse(200, req);

  try {
    const rawBody = req.method === 'GET' ? null : await req.text().catch(() => null);
    const size = validateBodySize(rawBody);
    if (!size.valid) {
      return createErrorResponse(413, size.error || 'Request body too large', 'VALIDATION_ERROR', undefined, req);
    }

    const authResult = await verifyAuth(req);
    const { user, supabase } = authResult;
    if (authResult.isAnonymous && req.method === 'PUT') {
      return guestSignInRequiredResponse(req);
    }
    const url = new URL(req.url);
    const featureEnabled = await transactionNotificationsEnabled(user.id, user.email);

    if (!featureEnabled) {
      if (req.method === 'GET' && !url.searchParams.get('id')) {
        return createSuccessResponse({
          feature_enabled: false,
          items: [],
          unread_count: 0,
          unread_by_group: {},
          has_more: false,
          next_cursor: null,
          preference: {
            push_enabled: false,
            permission_status: 'not_requested',
            permission_prompted_at: null,
            nudge_dismissed_at: null,
          },
        }, 200, 0, req);
      }
      return createErrorResponse(404, 'Notifications are unavailable', 'NOT_FOUND', undefined, req);
    }

    if (req.method === 'GET') {
      const notificationId = url.searchParams.get('id');
      if (notificationId) {
        if (!isValidUUID(notificationId)) {
          return createErrorResponse(400, 'Invalid notification id', 'VALIDATION_ERROR', undefined, req);
        }

        const { data: activeNotificationId, error: resolveError } = await supabase
          .rpc('get_active_notification_id', { p_notification_id: notificationId });
        if (resolveError) return handleError(resolveError, 'resolving active notification', req);
        if (!activeNotificationId) {
          return createErrorResponse(404, 'Notification not found', 'NOT_FOUND', undefined, req);
        }

        const { data, error } = await supabase
          .from('notifications')
          .select('*')
          .eq('id', activeNotificationId)
          .eq('recipient_user_id', user.id)
          .maybeSingle();
        if (error) return handleError(error, 'fetching notification detail', req);
        if (!data) return createErrorResponse(404, 'Notification not found', 'NOT_FOUND', undefined, req);
        return createSuccessResponse(data, 200, 0, req);
      }

      const limit = parseLimit(url.searchParams.get('limit'));
      let cursor;
      try {
        cursor = parseNotificationCursor(
          url.searchParams.get('cursor_created_at'),
          url.searchParams.get('cursor_id'),
        );
      } catch (error) {
        return createErrorResponse(
          400,
          error instanceof Error ? error.message : 'Invalid notification cursor',
          'VALIDATION_ERROR',
          undefined,
          req,
        );
      }

      let listQuery = supabase
        .from('notifications')
        .select('*')
        .eq('recipient_user_id', user.id)
        .is('superseded_at', null)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(limit + 1);
      if (cursor) listQuery = listQuery.or(buildNotificationCursorFilter(cursor));

      const [listResult, unreadSummary, preferenceResult] = await Promise.all([
        listQuery,
        fetchUnreadSummary(supabase),
        supabase
          .from('notification_preferences')
          .select('push_enabled, permission_status, permission_prompted_at, nudge_dismissed_at')
          .eq('user_id', user.id)
          .maybeSingle(),
      ]);

      if (listResult.error) return handleError(listResult.error, 'fetching notifications', req);
      if (preferenceResult.error) return handleError(preferenceResult.error, 'fetching notification preference', req);

      const rows = listResult.data ?? [];
      const items = rows.slice(0, limit);

      return createSuccessResponse({
        feature_enabled: true,
        items,
        ...unreadSummary,
        has_more: rows.length > limit,
        next_cursor: rows.length > limit && items.length > 0
          ? { created_at: items[items.length - 1].created_at, id: items[items.length - 1].id }
          : null,
        preference: preferenceResult.data ?? {
          push_enabled: false,
          permission_status: 'not_requested',
          permission_prompted_at: null,
          nudge_dismissed_at: null,
        },
      }, 200, 0, req);
    }

    let payload: Record<string, unknown>;
    try {
      payload = parseJson(rawBody);
    } catch {
      return createErrorResponse(400, 'Invalid JSON in request body', 'VALIDATION_ERROR', undefined, req);
    }

    if (req.method === 'PATCH') {
      const action = payload.action;
      const now = new Date().toISOString();

      if (action === 'read') {
        const id = typeof payload.id === 'string' ? payload.id : '';
        if (!isValidUUID(id)) {
          return createErrorResponse(400, 'Invalid notification id', 'VALIDATION_ERROR', undefined, req);
        }
        const { data: existing, error: existingError } = await supabase
          .from('notifications')
          .select('id, read_at')
          .eq('id', id)
          .eq('recipient_user_id', user.id)
          .maybeSingle();
        if (existingError) return handleError(existingError, 'fetching notification read state', req);
        if (!existing) return createErrorResponse(404, 'Notification not found', 'NOT_FOUND', undefined, req);

        let readAt = resolveReadAt(existing.read_at, now);
        if (!existing.read_at) {
          const { data: updated, error } = await supabase
            .from('notifications')
            .update({ read_at: readAt })
            .eq('id', id)
            .eq('recipient_user_id', user.id)
            .is('read_at', null)
            .select('read_at')
            .maybeSingle();
          if (error) return handleError(error, 'marking notification read', req);
          if (updated?.read_at) {
            readAt = updated.read_at;
          } else {
            const { data: raced, error: raceError } = await supabase
              .from('notifications')
              .select('read_at')
              .eq('id', id)
              .eq('recipient_user_id', user.id)
              .single();
            if (raceError) return handleError(raceError, 'resolving notification read state', req);
            readAt = resolveReadAt(raced.read_at, readAt);
          }
        }

        const summary = await fetchUnreadSummary(supabase);
        return createSuccessResponse({ id, read_at: readAt, ...summary }, 200, 0, req);
      }

      if (action === 'read_many') {
        let ids: string[];
        try {
          ids = parseNotificationReadIds(payload.ids);
        } catch (error) {
          return createErrorResponse(
            400,
            error instanceof Error ? error.message : 'Invalid notification ids',
            'VALIDATION_ERROR',
            undefined,
            req,
          );
        }

        const { data, error } = await supabase
          .from('notifications')
          .update({ read_at: now })
          .in('id', ids)
          .eq('recipient_user_id', user.id)
          .is('read_at', null)
          .is('superseded_at', null)
          .select('id');
        if (error) return handleError(error, 'marking notifications read', req);
        const summary = await fetchUnreadSummary(supabase);
        return createSuccessResponse({
          updated: data?.length ?? 0,
          read_at: now,
          ...summary,
        }, 200, 0, req);
      }

      if (action === 'read_all') {
        const requestedThrough = typeof payload.through === 'string' ? payload.through : now;
        if (Number.isNaN(Date.parse(requestedThrough))) {
          return createErrorResponse(400, 'Invalid read-all timestamp', 'VALIDATION_ERROR', undefined, req);
        }
        const through = new Date(Math.min(Date.parse(requestedThrough), Date.now())).toISOString();
        const { data, error } = await supabase
          .from('notifications')
          .update({ read_at: now })
          .eq('recipient_user_id', user.id)
          .is('read_at', null)
          .is('superseded_at', null)
          .lte('created_at', through)
          .select('id');
        if (error) return handleError(error, 'marking all notifications read', req);
        const summary = await fetchUnreadSummary(supabase);
        return createSuccessResponse({
          updated: data?.length ?? 0,
          read_at: now,
          through,
          ...summary,
        }, 200, 0, req);
      }

      return createErrorResponse(400, 'Unsupported notification action', 'VALIDATION_ERROR', undefined, req);
    }

    if (req.method === 'PUT') {
      const action = payload.action;

      if (action === 'preference') {
        const pushEnabled = payload.push_enabled;
        const permissionStatus = payload.permission_status;
        if (typeof pushEnabled !== 'boolean' || !isNotificationPermissionStatus(permissionStatus)) {
          return createErrorResponse(400, 'Invalid notification preference', 'VALIDATION_ERROR', undefined, req);
        }
        if (pushEnabled && permissionStatus !== 'granted') {
          return createErrorResponse(400, 'Push requires granted permission', 'VALIDATION_ERROR', undefined, req);
        }

        const promptedAt = permissionStatus === 'not_requested' ? null : new Date().toISOString();
        const { data, error } = await supabase
          .from('notification_preferences')
          .upsert({
            user_id: user.id,
            push_enabled: pushEnabled,
            permission_status: permissionStatus,
            permission_prompted_at: promptedAt,
          }, { onConflict: 'user_id' })
          .select('push_enabled, permission_status, permission_prompted_at, nudge_dismissed_at')
          .single();
        if (error) return handleError(error, 'updating notification preference', req);
        return createSuccessResponse(data, 200, 0, req);
      }

      if (action === 'dismiss_nudge') {
        const { data, error } = await supabase
          .from('notification_preferences')
          .upsert({
            user_id: user.id,
            push_enabled: false,
            permission_status: 'not_requested',
            nudge_dismissed_at: new Date().toISOString(),
          }, { onConflict: 'user_id' })
          .select('push_enabled, permission_status, permission_prompted_at, nudge_dismissed_at')
          .single();
        if (error) return handleError(error, 'dismissing notification nudge', req);
        return createSuccessResponse(data, 200, 0, req);
      }

      if (action === 'push_token') {
        const token = typeof payload.token === 'string' ? payload.token.trim() : '';
        const platform = payload.platform;
        const deviceId = typeof payload.device_id === 'string' ? payload.device_id.slice(0, 255) : null;
        if (!isValidExpoPushToken(token) || (platform !== 'ios' && platform !== 'android')) {
          return createErrorResponse(400, 'Invalid Expo push token', 'VALIDATION_ERROR', undefined, req);
        }

        const { data, error } = await createAdmin()
          .from('push_tokens')
          .upsert({
            user_id: user.id,
            expo_push_token: token,
            platform,
            device_id: deviceId,
            active: true,
            last_error: null,
            last_seen_at: new Date().toISOString(),
          }, { onConflict: 'expo_push_token' })
          .select('id, platform, active, last_seen_at')
          .single();
        if (error) return handleError(error, 'registering push token', req);
        const lastSeen = lastSeenForPushRegistration(req.headers, platform);
        if (lastSeen) {
          await persistLastSeenApp(supabase, user.id, lastSeen);
        }
        return createSuccessResponse(data, 200, 0, req);
      }

      return createErrorResponse(400, 'Unsupported notification action', 'VALIDATION_ERROR', undefined, req);
    }

    if (req.method === 'DELETE') {
      const token = typeof payload.token === 'string' ? payload.token.trim() : '';
      if (!isValidExpoPushToken(token)) {
        return createErrorResponse(400, 'Invalid Expo push token', 'VALIDATION_ERROR', undefined, req);
      }
      const { error } = await createAdmin()
        .from('push_tokens')
        .update({ active: false, last_seen_at: new Date().toISOString() })
        .eq('user_id', user.id)
        .eq('expo_push_token', token);
      if (error) return handleError(error, 'removing push token', req);
      return createSuccessResponse({ success: true }, 200, 0, req);
    }

    return createErrorResponse(405, 'Method not allowed', 'METHOD_NOT_ALLOWED', undefined, req);
  } catch (error) {
    return handleError(error, 'notifications handler', req);
  }
});
