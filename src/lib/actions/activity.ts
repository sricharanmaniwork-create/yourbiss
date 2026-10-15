import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { AppKey } from '@/lib/types';

export interface ActivityInput {
  orgId: string;
  actorId: string;
  appKey?: AppKey | null;
  entityType: string;
  entityId?: string | null;
  action: string;
  summary?: string | null;
  meta?: Record<string, unknown>;
}

/**
 * Audit rows are written with the caller's own client, because the
 * `activity_insert` policy is what proves the actor is a member and is writing
 * as themselves. A service-role insert would skip that check for no benefit.
 *
 * Failures are logged and swallowed: an audit trail is not worth rolling back a
 * successful booking or a published page.
 */
export async function logActivity(client: SupabaseClient, input: ActivityInput): Promise<void> {
  const { error } = await client.from('activity_log').insert({
    org_id: input.orgId,
    actor_id: input.actorId,
    app_key: input.appKey ?? null,
    entity_type: input.entityType.slice(0, 40),
    entity_id: input.entityId ? String(input.entityId).slice(0, 64) : null,
    action: input.action.slice(0, 60),
    summary: input.summary ? input.summary.slice(0, 500) : null,
    meta: input.meta ?? {},
  });
  if (error) console.error('[activity] could not record', input.action, error.message);
}
