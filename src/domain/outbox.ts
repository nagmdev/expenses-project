/**
 * Transactional outbox for notifications (email / webhook).
 *
 * Business transaction ──► outbox/{eventId} (status: pending)   ← same atomic commit
 *                                   │
 *                     dispatcher claims it (pending → sending, with a lease)
 *                                   │
 *                   provider call (timeout + Idempotency-Key = eventId)
 *                                   │
 *            sent  |  failed (exponential backoff)  |  dead (dead-letter)
 *
 * - The event ID is deterministic (event type + entity + operation), so a
 *   duplicated business operation can never enqueue a second notification.
 * - Only one dispatcher can hold the lease at a time (transactional claim), so
 *   two tabs / two admins never send the same event twice concurrently.
 * - Delivery failures never fail the business operation; they are retried.
 */
import type { EmailEventType, EmailLogEntry, EmailNotificationSettings } from '../types';
import { generateEmailContent, type EmailDispatchDetails } from '../services/emailTemplates';
import { COL, normalizeEmail, type Actor } from './common';
import type { DataStore, TxContext } from './store';

export type OutboxChannel = 'email_api' | 'webhook' | 'firestore_mail';
export type OutboxStatus = 'pending' | 'sending' | 'sent' | 'failed' | 'dead';

export interface OutboxEvent {
  id: string;
  orgId: string;
  eventType: EmailEventType;
  entityType: 'request' | 'visa' | 'system';
  entityId: string;
  channel: OutboxChannel;
  recipients: string[];
  message: { subject: string; html: string; text: string; snippet: string };
  meta: {
    senderName: string;
    senderEmail: string;
    replyTo: string;
    provider: string;
    webhookUrl?: string;
    requestNumber?: string;
    recipientName?: string;
    amount?: number;
    currency?: string;
  };
  status: OutboxStatus;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: string;
  leaseUntil?: string;
  lastError?: string;
  /** Targets (recipients / webhook) that already received this event. */
  deliveredTo?: string[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  sentAt?: string;
}

export const OUTBOX_MAX_ATTEMPTS = 6;
export const OUTBOX_LEASE_MS = 90_000;

export const outboxEventId = (eventType: EmailEventType, entityId: string, operationKey?: string) =>
  [eventType, entityId, operationKey].filter(Boolean).join('__');

const EVENT_TOGGLES: Partial<Record<EmailEventType, keyof EmailNotificationSettings>> = {
  new_request: 'notifyOnNewRequest',
  request_approved: 'notifyOnApproval',
  request_paid: 'notifyOnDisbursement',
  clarification_requested: 'notifyOnClarification',
  request_rejected: 'notifyOnRejection',
};

export function isNotificationEnabled(eventType: EmailEventType, settings: EmailNotificationSettings, force = false) {
  if (force) return true;
  if (!settings.enabled) return false;
  const toggle = EVENT_TOGGLES[eventType];
  return toggle ? Boolean(settings[toggle]) : true;
}

function channelFor(settings: EmailNotificationSettings): OutboxChannel {
  if (settings.deliveryMethod === 'webhook' && settings.webhookUrl) return 'webhook';
  if (settings.deliveryMethod === 'firestore_mail') return 'firestore_mail';
  return 'email_api';
}

export interface BuildOutboxInput {
  eventId: string;
  eventType: EmailEventType;
  entityType: OutboxEvent['entityType'];
  entityId: string;
  orgId: string;
  recipients: string[];
  details: EmailDispatchDetails;
  settings: EmailNotificationSettings;
  actor: Actor;
  nowIso: string;
  force?: boolean;
}

/** Returns null when the notification is disabled or has no valid recipient. */
export function buildOutboxEvent(input: BuildOutboxInput): OutboxEvent | null {
  const recipients = Array.from(new Set(input.recipients.map(normalizeEmail))).filter(e => e.includes('@'));
  if (recipients.length === 0) return null;
  if (!isNotificationEnabled(input.eventType, input.settings, input.force)) return null;

  const { subject, html, text, snippet } = generateEmailContent(input.eventType, input.details);
  const s = input.settings;
  const req = input.details.request;
  return {
    id: input.eventId,
    orgId: input.orgId || '',
    eventType: input.eventType,
    entityType: input.entityType,
    entityId: input.entityId,
    channel: channelFor(s),
    recipients,
    message: { subject, html, text, snippet },
    meta: {
      senderName: s.senderName || 'نظام مصروفي',
      senderEmail: s.senderEmail || 'no-reply@expenses.app',
      replyTo: s.replyToEmail || s.senderEmail || 'no-reply@expenses.app',
      provider: s.directProvider || 'auto',
      webhookUrl: s.deliveryMethod === 'webhook' ? s.webhookUrl : undefined,
      requestNumber: req?.requestNumber,
      recipientName: req?.requesterName,
      amount: req?.amount,
      currency: req?.currency,
    },
    status: 'pending',
    attempts: 0,
    maxAttempts: OUTBOX_MAX_ATTEMPTS,
    nextAttemptAt: input.nowIso,
    createdBy: input.actor.id,
    createdAt: input.nowIso,
    updatedAt: input.nowIso,
  };
}

/** Enqueue inside the caller's business transaction (must be called in the write phase). */
export function enqueueOutbox(tx: TxContext, event: OutboxEvent | null): string | null {
  if (!event) return null;
  tx.set(COL.outbox, event.id, event);
  return event.id;
}

/** Exponential backoff with jitter: 30s, 1m, 2m, 4m, 8m … capped at 1h. */
export function computeBackoffMs(attempts: number, random: () => number = Math.random): number {
  const base = Math.min(60 * 60_000, 30_000 * 2 ** Math.max(0, attempts - 1));
  return Math.round(base * (0.8 + random() * 0.4));
}

/**
 * Delivers ONE target of an event (one email recipient, or the webhook).
 * Implementations must send `idempotencyKey` to the provider so a retried call
 * that already succeeded upstream is de-duplicated by the provider as well.
 */
export interface OutboxTransport {
  deliver(event: OutboxEvent, target: string, idempotencyKey: string): Promise<void>;
}

/** Throw this from a transport when retrying cannot help (e.g. provider not configured). */
export class NonRetryableDeliveryError extends Error {
  readonly nonRetryable = true;
}

export const WEBHOOK_TARGET = '__webhook__';

export function deliveryTargets(event: Pick<OutboxEvent, 'channel' | 'recipients'>): string[] {
  return event.channel === 'webhook' ? [WEBHOOK_TARGET] : event.recipients || [];
}

export type DispatchResult = 'sent' | 'failed' | 'dead' | 'skipped';

export function isDue(event: Pick<OutboxEvent, 'status' | 'nextAttemptAt' | 'leaseUntil'>, now: Date): boolean {
  if (event.status === 'sent' || event.status === 'dead') return false;
  if (event.status === 'sending') return Boolean(event.leaseUntil && new Date(event.leaseUntil) <= now);
  return !event.nextAttemptAt || new Date(event.nextAttemptAt) <= now;
}

/**
 * Claim → deliver → record. Safe to call from any number of tabs/users at once:
 * only the caller that wins the transactional claim performs the delivery.
 */
export async function dispatchOutboxEvent(
  store: DataStore,
  eventId: string,
  transport: OutboxTransport,
  now: () => Date = () => new Date(),
): Promise<DispatchResult> {
  const claimed = await store.runTransaction(async tx => {
    const ev = await tx.get<OutboxEvent>(COL.outbox, eventId);
    const t = now();
    if (!ev || !isDue(ev, t)) return null;
    const attempts = Number(ev.attempts || 0) + 1;
    tx.update(COL.outbox, eventId, {
      status: 'sending',
      attempts,
      leaseUntil: new Date(t.getTime() + OUTBOX_LEASE_MS).toISOString(),
      updatedAt: t.toISOString(),
    });
    return { ...ev, attempts } as OutboxEvent;
  });
  if (!claimed) return 'skipped';

  // Targets already delivered by a previous attempt are never sent again.
  const delivered = new Set<string>(claimed.deliveredTo || []);
  try {
    for (const target of deliveryTargets(claimed)) {
      if (delivered.has(target)) continue;
      await transport.deliver(claimed, target, `${claimed.id}:${target}`);
      delivered.add(target);
    }
    const t = now().toISOString();
    await store.runTransaction(async tx => {
      tx.update(COL.outbox, eventId, {
        status: 'sent',
        deliveredTo: Array.from(delivered),
        sentAt: t,
        updatedAt: t,
        lastError: null,
        leaseUntil: null,
      });
    });
    return 'sent';
  } catch (err: any) {
    const t = now();
    const dead = Boolean(err?.nonRetryable) || claimed.attempts >= (claimed.maxAttempts || OUTBOX_MAX_ATTEMPTS);
    await store
      .runTransaction(async tx => {
        tx.update(COL.outbox, eventId, {
          status: dead ? 'dead' : 'failed',
          deliveredTo: Array.from(delivered),
          lastError: String(err?.message || err || 'delivery_failed').slice(0, 500),
          nextAttemptAt: new Date(t.getTime() + computeBackoffMs(claimed.attempts)).toISOString(),
          leaseUntil: null,
          updatedAt: t.toISOString(),
        });
      })
      .catch(() => undefined); // lease expiry will make it retryable anyway
    return dead ? 'dead' : 'failed';
  }
}

/** Maps outbox events to the per-recipient log rows displayed in Settings. */
export function outboxToEmailLogs(events: OutboxEvent[]): EmailLogEntry[] {
  const rows: EmailLogEntry[] = [];
  for (const ev of events) {
    const status: EmailLogEntry['status'] =
      ev.status === 'sent' ? 'sent' : ev.status === 'dead' ? 'failed' : ev.status === 'failed' ? 'failed' : 'pending';
    for (const r of ev.recipients || []) {
      rows.push({
        id: `${ev.id}::${r}`,
        eventType: ev.eventType,
        recipientEmail: r,
        recipientName: ev.meta?.recipientName,
        subject: ev.message?.subject || '',
        snippet: ev.message?.snippet || '',
        requestId: ev.entityType === 'request' ? ev.entityId : undefined,
        requestNumber: ev.meta?.requestNumber,
        amount: ev.meta?.amount,
        currency: ev.meta?.currency,
        status,
        errorMessage:
          ev.status === 'dead'
            ? `فشل نهائي بعد ${ev.attempts} محاولات: ${ev.lastError || ''}`
            : ev.status === 'failed'
            ? `ستتم إعادة المحاولة تلقائياً (${ev.attempts}/${ev.maxAttempts}): ${ev.lastError || ''}`
            : undefined,
        timestamp: ev.sentAt || ev.updatedAt || ev.createdAt,
      });
    }
  }
  return rows;
}
