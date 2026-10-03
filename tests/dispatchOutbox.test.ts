import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import handler from '../api/dispatch-outbox';

function mockRes() {
  const res: any = { statusCode: 0, body: undefined, headers: {} };
  res.setHeader = (k: string, v: string) => { res.headers[k] = v; };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: any) => { res.body = b; return res; };
  res.end = () => res;
  return res;
}

describe('api/dispatch-outbox independent worker', () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    process.env.CRON_SECRET = 'secret-123';
    process.env.NODE_ENV = 'production';
  });

  afterEach(() => {
    process.env = { ...origEnv };
    vi.restoreAllMocks();
  });

  it('rejects unauthorized cron calls with 401', async () => {
    const req = {
      method: 'POST',
      headers: { authorization: 'Bearer wrong-secret' },
      body: {},
    };
    const res = mockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(401);
    expect(res.body.error).toBe('unauthorized');
  });

  it('accepts calls with valid x-cron-secret header and queries due events', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes(':runQuery')) {
        return {
          ok: true,
          status: 200,
          json: async () => [],
        };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    });
    vi.stubGlobal('fetch', fetchMock);

    const req = {
      method: 'GET',
      headers: { 'x-cron-secret': 'secret-123' },
      query: { limit: 10 },
    };
    const res = mockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.processed).toBe(0);
    expect(fetchMock).toHaveBeenCalled();
  });

  it('sorts due events by nextAttemptAt ascending to prevent starvation', async () => {
    const patchedDocs: string[] = [];
    const fetchMock = vi.fn(async (url: string, init?: any) => {
      if (url.includes(':runQuery')) {
        return {
          ok: true,
          status: 200,
          json: async () => [
            {
              document: {
                name: 'projects/p/databases/(default)/documents/outbox/newer-event',
                fields: {
                  id: { stringValue: 'newer-event' },
                  status: { stringValue: 'pending' },
                  nextAttemptAt: { stringValue: new Date(Date.now() - 5000).toISOString() },
                  recipients: { arrayValue: { values: [{ stringValue: 'a@test.com' }] } },
                  channel: { stringValue: 'webhook' },
                  meta: { mapValue: { fields: { webhookUrl: { stringValue: 'https://webhook.test' } } } },
                },
              },
            },
            {
              document: {
                name: 'projects/p/databases/(default)/documents/outbox/older-event',
                fields: {
                  id: { stringValue: 'older-event' },
                  status: { stringValue: 'failed' },
                  nextAttemptAt: { stringValue: new Date(Date.now() - 30000).toISOString() },
                  recipients: { arrayValue: { values: [{ stringValue: 'b@test.com' }] } },
                  channel: { stringValue: 'webhook' },
                  meta: { mapValue: { fields: { webhookUrl: { stringValue: 'https://webhook.test' } } } },
                },
              },
            },
          ],
        };
      }
      if (url.includes('/documents/outbox/')) {
        const docId = url.split('/documents/outbox/')[1].split('?')[0];
        if (init?.method === 'PATCH' && init?.body?.includes('sending')) {
          patchedDocs.push(decodeURIComponent(docId));
        }
        return { ok: true, status: 200, json: async () => ({}) };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    });
    vi.stubGlobal('fetch', fetchMock);

    const req = {
      method: 'POST',
      headers: { authorization: 'Bearer secret-123' },
      body: { limit: 10 },
    };
    const res = mockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.processed).toBe(2);
    // Older event must be claimed FIRST to prevent starvation
    expect(patchedDocs[0]).toBe('older-event');
    expect(patchedDocs[1]).toBe('newer-event');
  });
});
