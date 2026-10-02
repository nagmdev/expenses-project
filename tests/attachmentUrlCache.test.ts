/**
 * resolveAttachmentUrl (src/lib/attachments.ts) caches the object URL of an fsattach://
 * attachment for the session, but never across accounts: after a sign-out or an account
 * switch on the same tab, the file is read from Firestore again (through the rules) instead
 * of being handed out from what the previous account read.
 * Firebase is replaced by a fake signed-in user; the Firestore read is a stub.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fakeAuth: { currentUser: { uid: string } | null } = { currentUser: null };
const readAttachmentBlob = vi.fn(async () => new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' }));

vi.mock('../src/lib/firebase', () => ({
  auth: fakeAuth,
  getDb: () => ({}),
}));

vi.mock('../src/lib/attachmentsCore', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/lib/attachmentsCore')>();
  return { ...actual, readAttachmentBlob };
});

const { clearAttachmentUrlCache, resolveAttachmentUrl } = await import('../src/lib/attachments');

const URL_A = 'fsattach://att-cache-a';

describe('cached attachment object URLs never outlive the account that read them', () => {
  beforeEach(() => {
    clearAttachmentUrlCache();
    readAttachmentBlob.mockClear();
    fakeAuth.currentUser = { uid: 'uid-a' };
  });

  it('the same account reads a file once per session', async () => {
    const first = await resolveAttachmentUrl(URL_A);
    const second = await resolveAttachmentUrl(URL_A);
    expect(first).toMatch(/^blob:/);
    expect(second).toBe(first);
    expect(readAttachmentBlob).toHaveBeenCalledTimes(1);
  });

  it('another account signed in on the same tab reads it again from Firestore', async () => {
    const forA = await resolveAttachmentUrl(URL_A);
    fakeAuth.currentUser = { uid: 'uid-b' };
    const forB = await resolveAttachmentUrl(URL_A);
    expect(readAttachmentBlob).toHaveBeenCalledTimes(2);
    expect(forB).not.toBe(forA);
  });

  it('after a sign-out nothing is served from the cache', async () => {
    await resolveAttachmentUrl(URL_A);
    fakeAuth.currentUser = null;
    await resolveAttachmentUrl(URL_A);
    expect(readAttachmentBlob).toHaveBeenCalledTimes(2);
  });

  it('data: and https links of older records are returned unchanged (no read)', async () => {
    expect(await resolveAttachmentUrl('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA');
    expect(await resolveAttachmentUrl('https://example.test/x.png')).toBe('https://example.test/x.png');
    expect(readAttachmentBlob).not.toHaveBeenCalled();
  });
});
