/**
 * Notification delivery transport used by the outbox dispatcher.
 *
 * Notifications are never sent directly from business code any more: business
 * operations enqueue an outbox event in the same transaction, and the dispatcher
 * (src/domain/outbox.ts) claims it and calls this transport. Every call carries an
 * idempotency key so providers can de-duplicate retried deliveries.
 */
import { NonRetryableDeliveryError, WEBHOOK_TARGET, type OutboxEvent, type OutboxTransport } from '../domain/outbox';
import type { DataStore } from '../domain/store';

export { DEFAULT_EMAIL_SETTINGS, escapeHtml, generateEmailContent, type EmailDispatchDetails } from './emailTemplates';

const API_TIMEOUT_MS = 15_000;
const WEBHOOK_TIMEOUT_MS = 10_000;

async function postJson(url: string, body: unknown, headers: Record<string, string>, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => null);
    return { res, data };
  } catch (err: any) {
    if (err?.name === 'AbortError') throw new Error(`انتهت مهلة الاتصال بمزود الإرسال (${Math.round(timeoutMs / 1000)} ثانية).`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export function createNotificationTransport(store: DataStore): OutboxTransport {
  return {
    async deliver(event: OutboxEvent, target: string, idempotencyKey: string) {
      const { subject, html, text } = event.message;

      if (event.channel === 'webhook') {
        if (target !== WEBHOOK_TARGET || !event.meta.webhookUrl) throw new NonRetryableDeliveryError('رابط الـ Webhook غير محدد.');
        const { res } = await postJson(
          event.meta.webhookUrl,
          {
            eventId: event.id, // receivers must ignore an eventId they already processed
            eventType: event.eventType,
            entityType: event.entityType,
            entityId: event.entityId,
            orgId: event.orgId,
            recipients: event.recipients,
            subject,
            html,
            text,
            timestamp: event.createdAt,
          },
          { 'Idempotency-Key': event.id, 'X-Event-Id': event.id },
          WEBHOOK_TIMEOUT_MS,
        );
        if (!res.ok) {
          if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
            throw new NonRetryableDeliveryError(`رفض الـ Webhook الطلب (HTTP ${res.status}).`);
          }
          throw new Error(`فشل الـ Webhook (HTTP ${res.status}).`);
        }
        return;
      }

      if (event.channel === 'firestore_mail') {
        // Trigger-Email extension: one deterministic document per (event, recipient),
        // created only if absent, so a retry can never enqueue a second email.
        const mailId = idempotencyKey.replace(/[^A-Za-z0-9_-]/g, '_');
        await store.runTransaction(async tx => {
          if (await tx.get('mail', mailId)) return;
          tx.set('mail', mailId, {
            to: [target],
            message: { subject, html, text },
            from: `"${event.meta.senderName}" <${event.meta.senderEmail}>`,
            replyTo: event.meta.replyTo,
            metadata: { eventId: event.id, eventType: event.eventType, entityId: event.entityId, orgId: event.orgId, createdAt: event.createdAt },
          });
        });
        return;
      }

      const { res, data } = await postJson(
        '/api/send-email',
        {
          to: target,
          subject,
          html,
          text,
          senderName: event.meta.senderName,
          senderEmail: event.meta.senderEmail,
          replyTo: event.meta.replyTo,
          provider: event.meta.provider || 'auto',
          idempotencyKey,
        },
        { 'Idempotency-Key': idempotencyKey },
        API_TIMEOUT_MS,
      );
      if (res.ok && data?.success) return;
      const message = data?.message || data?.error || `HTTP ${res.status}`;
      if (data?.skipped) throw new NonRetryableDeliveryError(message); // provider not configured
      if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 409 && res.status !== 429) {
        throw new NonRetryableDeliveryError(message);
      }
      throw new Error(message);
    },
  };
}
