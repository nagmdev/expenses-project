/**
 * /api/send-email is not a generic mailer: it delivers one recipient of an outbox
 * event that the caller can read in Firestore (with their own ID token, so the
 * security rules decide), using the event's content — never the request body's.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import handler from '../api/send-email';
import { createNotificationTransport } from '../src/services/emailService';
import type { OutboxEvent } from '../src/domain/outbox';
import { createMemoryStore } from '../src/domain/store';

const str = (v: string) => ({ stringValue: v });
const map = (fields: Record<string, any>) => ({ mapValue: { fields } });

function restEvent(overrides: Record<string, any> = {}) {
  return {
    name: 'projects/p/databases/(default)/documents/outbox/x',
    fields: {
      channel: str('email_api'),
      status: str('sending'),
      recipients: { arrayValue: { values: [str('boss@acme.test')] } },
      deliveredTo: { arrayValue: {} },
      attempts: { integerValue: '1' },
      message: map({ subject: str('طلب جديد'), html: str('<p>event body</p>'), text: str('event body') }),
      meta: map({ senderName: str('مصروفي'), senderEmail: str('sender@acme.test'), replyTo: str('reply@acme.test'), provider: str('auto') }),
      ...overrides,
    },
  };
}

function mockRes() {
  const res: any = { statusCode: 0, body: undefined, headers: {} };
  res.setHeader = (k: string, v: string) => { res.headers[k] = v; };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: any) => { res.body = b; return res; };
  res.end = () => res;
  return res;
}

const post = (body: any, headers: Record<string, string> = { authorization: 'Bearer id-token-1' }) => ({ method: 'POST', headers, body });

let firestoreResponse: { status: number; body?: any };
let providerCalls: any[];
let firestoreCalls: Array<{ url: string; auth: string }>;

beforeEach(() => {
  process.env.RESEND_API_KEY = 'test-resend-key';
  delete process.env.GMAIL_APP_PASSWORD;
  delete process.env.GMAIL_PASSWORD;
  delete process.env.BREVO_API_KEY;
  delete process.env.Brevo_API_KEY;
  delete process.env.FIRESTORE_EMULATOR_HOST;
  firestoreResponse = { status: 200, body: restEvent() };
  providerCalls = [];
  firestoreCalls = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: any) => {
    if (url.includes('/documents/outbox/')) {
      firestoreCalls.push({ url, auth: init?.headers?.Authorization });
      return { ok: firestoreResponse.status === 200, status: firestoreResponse.status, json: async () => firestoreResponse.body };
    }
    if (url === 'https://api.resend.com/emails') {
      providerCalls.push(JSON.parse(init.body));
      return { ok: true, status: 200, json: async () => ({ id: 'msg-1' }) };
    }
    throw new Error(`unexpected fetch ${url}`);
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.RESEND_API_KEY;
});

describe('/api/send-email only delivers outbox events', () => {
  it('rejects a call without a Firebase ID token (no more open relay)', async () => {
    const res = mockRes();
    await handler(post({ to: 'victim@example.com', subject: 'spam', html: '<b>spam</b>' }, {}), res);
    expect(res.statusCode).toBe(401);
    expect(providerCalls).toHaveLength(0);
  });

  it('requires an event id and one recipient', async () => {
    const res = mockRes();
    await handler(post({ to: 'boss@acme.test', eventId: '../../users/x' }), res);
    expect(res.statusCode).toBe(400);
    expect(firestoreCalls).toHaveLength(0);
  });

  it('refuses an event the caller may not read under the Firestore rules', async () => {
    firestoreResponse = { status: 403, body: { error: { status: 'PERMISSION_DENIED' } } };
    const res = mockRes();
    await handler(post({ eventId: 'new_request__req-a1', to: 'boss@acme.test' }), res);
    expect(res.statusCode).toBe(403);
    expect(firestoreCalls[0].auth).toBe('Bearer id-token-1'); // read as the caller
    expect(providerCalls).toHaveLength(0);
  });

  it('refuses a recipient that is not one of the event recipients', async () => {
    const res = mockRes();
    await handler(post({ eventId: 'new_request__req-a2', to: 'victim@example.com' }), res);
    expect(res.statusCode).toBe(403);
    expect(providerCalls).toHaveLength(0);
  });

  it('refuses an event that is not claimed for sending, or not for this channel', async () => {
    firestoreResponse = { status: 200, body: restEvent({ status: str('sent') }) };
    const sent = mockRes();
    await handler(post({ eventId: 'new_request__req-a3', to: 'boss@acme.test' }), sent);
    expect(sent.statusCode).toBe(409);

    firestoreResponse = { status: 200, body: restEvent({ channel: str('firestore_mail') }) };
    const wrongChannel = mockRes();
    await handler(post({ eventId: 'new_request__req-a4', to: 'boss@acme.test' }), wrongChannel);
    expect(wrongChannel.statusCode).toBe(422);
    expect(providerCalls).toHaveLength(0);
  });

  it("sends the event's own subject and body to that one recipient, ignoring the request body", async () => {
    const res = mockRes();
    await handler(post({ eventId: 'new_request__req-a5', to: 'Boss@Acme.test', subject: 'injected', html: '<b>injected</b>' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(providerCalls).toHaveLength(1);
    expect(providerCalls[0]).toMatchObject({ to: ['boss@acme.test'], subject: 'طلب جديد', html: '<p>event body</p>', reply_to: 'reply@acme.test' });
  });

  it('does not send again to a recipient the event already delivered to', async () => {
    firestoreResponse = { status: 200, body: restEvent({ deliveredTo: { arrayValue: { values: [str('boss@acme.test')] } } }) };
    const res = mockRes();
    await handler(post({ eventId: 'new_request__req-a6', to: 'boss@acme.test' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.deduplicated).toBe(true);
    expect(providerCalls).toHaveLength(0);
  });
});

describe('notification transport (email_api channel)', () => {
  const event = {
    id: 'new_request__req-t1',
    channel: 'email_api',
    recipients: ['boss@acme.test'],
    message: { subject: 's', html: 'h', text: 't', snippet: '' },
    meta: { senderName: 'n', senderEmail: 'e@acme.test', replyTo: 'e@acme.test', provider: 'auto' },
  } as unknown as OutboxEvent;

  it('posts only the event id and recipient, authenticated with the user ID token', async () => {
    const calls: any[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: any) => {
      calls.push({ url, init });
      return { ok: true, status: 200, json: async () => ({ success: true }) };
    }));
    await createNotificationTransport(createMemoryStore(), async () => 'tok-9').deliver(event, 'boss@acme.test', 'new_request__req-t1:boss@acme.test');
    expect(calls[0].url).toBe('/api/send-email');
    expect(JSON.parse(calls[0].init.body)).toEqual({ eventId: 'new_request__req-t1', to: 'boss@acme.test' });
    expect(calls[0].init.headers.Authorization).toBe('Bearer tok-9');
  });

  it('does not call the API without a signed-in user (retried later)', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(createNotificationTransport(createMemoryStore(), async () => null).deliver(event, 'boss@acme.test', 'k')).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
