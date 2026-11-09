import { randomUUID } from 'node:crypto';
import type { SyncStore } from './notion-sync';
import { notionId } from '../notion-server';

export function webhookErrorCode(error: any): string {
  const code = error?.code || error?.cause?.code;
  if (typeof code === 'string' && (/^PGRST\d{3}$/.test(code) || /^\d{5}$/.test(code)
    || ['unauthorized', 'restricted_resource', 'object_not_found', 'rate_limited', 'validation_error', 'internal_server_error', 'service_unavailable',
      'ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET', 'UND_ERR_HEADERS_TIMEOUT'].includes(code))) return code;
  const messages: Record<string, string> = { 'Notion page did not stabilize': 'PAGE_UNSTABLE', 'Invalid event': 'INVALID_EVENT', 'Invalid event page': 'INVALID_EVENT_PAGE' };
  if (Object.hasOwn(messages, error?.message)) return messages[error.message];
  if (['AbortError', 'TimeoutError', 'TypeError'].includes(error?.name)) return error.name;
  return Number.isInteger(error?.status) && error.status >= 400 && error.status <= 599 ? `HTTP_${error.status}` : 'UNKNOWN_ERROR';
}

export type WebhookFailure = { code: string; status?: number };

export function webhookDiagnostics(createStore: () => SyncStore) {
  const started = Date.now();
  const record: Record<string, any> = {
    request_id: randomUUID(), started_at: new Date(started).toISOString(), stage: 'received',
    finished_at: null, status_code: null, duration_ms: 0, client_disconnected: false,
  };
  const report = (failure: WebhookFailure, databaseId?: string) => {
    if (record.error_code) return; // Preserve the first failure across source databases.
    record.error_code = failure.code;
    record.upstream_status = failure.status >= 400 && failure.status <= 599 ? failure.status : null;
    record.database_id = notionId(databaseId) || null;
  };
  const persist = async () => {
    record.duration_ms = Date.now() - started;
    try {
      await createStore().call('blog_record_webhook_delivery', { p_delivery: { ...record } }, AbortSignal.timeout(800));
    } catch (error) {
      // Logging failure must not change the original webhook result or leak raw errors.
      console.error('notion_webhook_log_unavailable', JSON.stringify({ request_id: record.request_id, stage: record.stage, code: webhookErrorCode(error) }));
    }
  };
  return {
    requestId: record.request_id as string,
    stage(value: string) { record.stage = value; },
    signature(valid: boolean) { record.signature_valid = valid; },
    disconnected() {
      record.client_disconnected = true;
      console.warn('notion_webhook_client_disconnected', JSON.stringify({ request_id: record.request_id, stage: record.stage }));
    },
    trustedEvent(payload: any) {
      record.event_id = notionId(payload?.id) || null;
      record.subscription_id = notionId(payload?.subscription_id) || null;
      record.entity_id = notionId(payload?.entity?.id) || null;
      record.event_type = typeof payload?.type === 'string' && /^[a-z_]+\.[a-z_]+$/.test(payload.type) ? payload.type.slice(0, 80) : null;
      record.attempt_number = Number.isInteger(payload?.attempt_number) && payload.attempt_number > 0 && payload.attempt_number <= 100 ? payload.attempt_number : null;
    },
    report,
    async start() {
      console.info('notion_webhook_started', JSON.stringify(record));
      await persist();
    },
    checkpoint: persist,
    async finish(status: number, message?: string) {
      record.status_code = status;
      record.finished_at = new Date().toISOString();
      record.error_message = message || null; // Only fixed, server-authored messages.
      await persist();
      const write = status >= 400 ? console.error : console.info;
      write('notion_webhook_result', JSON.stringify(record));
    },
  };
}
