/**
 * The paged history queries (src/lib/pagedFirestore.ts, driven by the REAL pager of
 * src/lib/pagination.ts) against the UNCHANGED firestore.rules: every query shape the app now
 * sends for the ledger / account statements, the audit log, the email log, the per-account
 * ledger counts and the fresh "has the ledger any line" checks must be provable for the roles
 * that use them, and refused for the others.
 *
 *   npm run test:rules      (starts the emulator; requires Java 11+)
 *
 * Note: the emulator does not require composite indexes; firestore.indexes.json holds the ones
 * production needs (and the pager falls back to the old query until they are deployed).
 */
import { readFileSync } from 'fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getCountFromServer, getDocs, limit, orderBy, query, setDoc, where, type Firestore } from 'firebase/firestore';
import { RECENT_AUDIT_WINDOW, createPager, historyScope, newestFirstBy, type EqFilters, type PagerState } from '../src/lib/pagination';
import { createFirestorePagedSource, eqQuery } from '../src/lib/pagedFirestore';

const ORG = 'org-acme';
const OTHER_ORG = 'org-other';
let env: RulesTestEnvironment;

const OWNER = { uid: 'uidOwner000000000000000001', email: 'mahmoud@tieapps.com' };
const ADMIN = { uid: 'uidAdmin000000000000000001', email: 'admin@acme.test' };
const FIN = { uid: 'uidFinance00000000000000001', email: 'fin@acme.test' };
const EMP = { uid: 'uidEmployee0000000000000001', email: 'emp@acme.test' };
const OTHER_ADMIN = { uid: 'uidOtherAdmin0000000000001', email: 'admin@other.test' };

const db = (u: { uid: string; email: string }): Firestore =>
  env.authenticatedContext(u.uid, { email: u.email, email_verified: true }).firestore() as unknown as Firestore;

const iso = (n: number) => new Date(Date.UTC(2026, 8, 1, 8, 0, n)).toISOString();

type Doc = { id: string; orgId?: string; createdAt?: string; timestamp?: string; accountId?: string };

/** Runs the app's pager on a real query until everything is loaded (or it fails). */
async function pageThrough<T extends Doc>(u: { uid: string; email: string }, col: string, filters: EqFilters, orderField: string, pageSize = 3) {
  let state: PagerState<T> | null = null;
  let pages = 0;
  const pager = createPager<T>(createFirestorePagedSource<T>(db(u), col, filters, orderField), {
    pageSize,
    compare: newestFirstBy<T>(orderField as keyof T),
    onChange: s => {
      state = s;
    },
    warn: () => {},
  });
  pager.start();
  for (let i = 0; i < 100 && (!state || (state as PagerState<T>).loading); i++) await new Promise(r => setTimeout(r, 20));
  // Page by page, like the "تحميل المزيد" button.
  while (state && (state as PagerState<T>).hasMore && !(state as PagerState<T>).error && pages < 50) {
    await pager.loadMore();
    pages++;
  }
  pager.stop();
  return { state: state as unknown as PagerState<T>, pages };
}

beforeAll(async () => {
  const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8085').split(':');
  env = await initializeTestEnvironment({
    projectId: 'demo-expenses-rules',
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host, port: Number(port) },
  });
});
afterAll(async () => {
  await env?.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async ctx => {
    const f = ctx.firestore();
    await setDoc(doc(f, 'organizations', ORG), { id: ORG, name: 'Acme', code: 'ACME', currency: 'EGP', notificationRecipients: [] });
    await setDoc(doc(f, 'organizations', OTHER_ORG), { id: OTHER_ORG, name: 'Other', code: 'OTH', currency: 'EGP', notificationRecipients: [] });
    const people: Array<[{ uid: string; email: string }, string, string]> = [
      [ADMIN, ORG, 'org_admin'],
      [FIN, ORG, 'finance'],
      [EMP, ORG, 'employee'],
      [OTHER_ADMIN, OTHER_ORG, 'org_admin'],
    ];
    for (const [u, orgId, role] of people) {
      await setDoc(doc(f, 'users', u.uid), { orgId, role, active: true });
      await setDoc(doc(f, 'members', `${u.uid}_${orgId}`), { orgId, userId: u.uid, userEmail: u.email, role, active: true });
    }
    // Ledger: ORG acc-a 7 lines (2 transfer legs), ORG acc-b 3 lines, OTHER_ORG acc-x 4 lines.
    let n = 0;
    const line = (orgId: string, accountId: string, referenceType = 'manual_adjustment') => {
      n++;
      return setDoc(doc(f, 'accountTransactions', `tx-${String(n).padStart(3, '0')}`), {
        id: `tx-${String(n).padStart(3, '0')}`, orgId, accountId, accountName: accountId, type: n % 2 ? 'in' : 'out', amount: n,
        balanceBefore: 0, balanceAfter: n, referenceType, description: `line ${n}`, actorName: 'x', actorId: 'x', createdAt: iso(n),
      });
    };
    for (let i = 0; i < 5; i++) await line(ORG, 'acc-a');
    await line(ORG, 'acc-a', 'transfer');
    await line(ORG, 'acc-a', 'transfer');
    for (let i = 0; i < 3; i++) await line(ORG, 'acc-b');
    for (let i = 0; i < 3; i++) await line(OTHER_ORG, 'acc-x');
    await line(OTHER_ORG, 'acc-x', 'transfer');
    // Audit log: 6 entries in ORG, 2 in OTHER_ORG, 1 platform entry (no company).
    const audit = (i: number, orgId: string) =>
      setDoc(doc(f, 'auditLogs', `log-${i}`), { id: `log-${i}`, orgId, actorId: 'x', actorName: 'x', actorEmail: 'x@x.test', actionType: 'update', entityType: 'service', entityId: 'e', entityName: 'e', details: `d${i}`, timestamp: iso(i) });
    for (let i = 1; i <= 6; i++) await audit(i, ORG);
    for (let i = 7; i <= 8; i++) await audit(i, OTHER_ORG);
    await audit(9, '');
    // Outbox (the email log): 5 events in ORG, 2 in OTHER_ORG.
    const event = (i: number, orgId: string) =>
      setDoc(doc(f, 'outbox', `ev-${i}`), { id: `ev-${i}`, orgId, status: 'sent', createdBy: 'x', recipients: ['a@x.test'], attempts: 1, maxAttempts: 6, eventType: 'request_created', entityType: 'request', entityId: `r${i}`, createdAt: iso(i), message: { subject: 's', snippet: 's' } });
    for (let i = 1; i <= 5; i++) await event(i, ORG);
    for (let i = 6; i <= 7; i++) await event(i, OTHER_ORG);
    // Legacy email logs (platform owner only).
    for (let i = 1; i <= 4; i++) {
      await setDoc(doc(f, 'email_logs', `mail-${i}`), { id: `mail-${i}`, recipientEmail: 'a@x.test', subject: 's', status: 'sent', eventType: 'request_created', timestamp: iso(i) });
    }
  });
});

const scopeFor = (u: typeof OWNER, extra: EqFilters = [], recordOrgId?: string, orgFilter?: string) =>
  historyScope({ isSuperAdmin: u === OWNER, activeOrgId: u === OTHER_ADMIN ? OTHER_ORG : ORG, orgFilter, extra, recordOrgId })!;

describe('treasury ledger, paged (accountTransactions)', () => {
  it('finance pages its whole company ledger, newest first, page by page, nothing of another company', async () => {
    const { state, pages } = await pageThrough(FIN, 'accountTransactions', scopeFor(FIN), 'createdAt');
    expect(state.error).toBeNull();
    expect(state.fallback).toBe(false);
    expect(state.items).toHaveLength(10);
    expect(state.items.every(t => t.orgId === ORG)).toBe(true);
    expect(state.items.map(t => t.id)).toEqual(['tx-010', 'tx-009', 'tx-008', 'tx-007', 'tx-006', 'tx-005', 'tx-004', 'tx-003', 'tx-002', 'tx-001']);
    expect(pages).toBeGreaterThanOrEqual(3);
  });

  it("an org admin reads one account's statement (orgId + accountId)", async () => {
    const { state } = await pageThrough(ADMIN, 'accountTransactions', scopeFor(ADMIN, [['accountId', 'acc-a']], ORG), 'createdAt');
    expect(state.error).toBeNull();
    expect(state.items.map(t => t.id)).toEqual(['tx-007', 'tx-006', 'tx-005', 'tx-004', 'tx-003', 'tx-002', 'tx-001']);
  });

  it('the first page, the live window, an older page and the old whole-set query are each allowed for finance', async () => {
    const f = db(FIN);
    const src = createFirestorePagedSource<Doc>(f, 'accountTransactions', scopeFor(FIN), 'createdAt');
    const first = await assertSucceeds(src.fetchFirst(4));
    expect(first).toHaveLength(4);
    const live = await assertSucceeds(new Promise<number>((resolve, reject) => {
      let unsub = () => {};
      unsub = src.listenFrom(first[3].cursor, docs => {
        unsub();
        resolve(docs.length);
      }, reject);
    }));
    expect(live).toBe(4);
    const older = await assertSucceeds(src.fetchAfter(first[3].cursor, null));
    expect(older).toHaveLength(6);
    const all = await assertSucceeds(new Promise<number>((resolve, reject) => {
      let unsub = () => {};
      unsub = src.listenAll(docs => {
        unsub();
        resolve(docs.length);
      }, reject);
    }));
    expect(all).toBe(10);
  });

  it('finance loads only the transfer lines (the headline totals), and counts / checks an account without loading its ledger', async () => {
    const f = db(FIN);
    const transfers = await assertSucceeds(getDocs(eqQuery(f, 'accountTransactions', scopeFor(FIN, [['referenceType', 'transfer']]))));
    expect(transfers.docs.map(d => d.id).sort()).toEqual(['tx-006', 'tx-007']);
    const count = await assertSucceeds(getCountFromServer(eqQuery(f, 'accountTransactions', [['orgId', ORG], ['accountId', 'acc-a']])));
    expect(count.data().count).toBe(7);
    const exists = await assertSucceeds(getDocs(query(eqQuery(f, 'accountTransactions', [['orgId', ORG], ['accountId', 'acc-b']]), limit(1))));
    expect(exists.size).toBe(1);
    const none = await assertSucceeds(getDocs(query(eqQuery(f, 'accountTransactions', [['orgId', ORG], ['accountId', 'acc-none']]), limit(1))));
    expect(none.empty).toBe(true);
  });

  it('a company admin can never page, count or check another company ledger', async () => {
    const f = db(ADMIN);
    const { state } = await pageThrough(ADMIN, 'accountTransactions', [['orgId', OTHER_ORG]], 'createdAt');
    expect(state.error).toBe('permission-denied');
    expect(state.items).toHaveLength(0);
    expect(state.fallback).toBe(false);
    await assertFails(getCountFromServer(eqQuery(f, 'accountTransactions', [['orgId', OTHER_ORG], ['accountId', 'acc-x']])));
    await assertFails(getDocs(query(eqQuery(f, 'accountTransactions', [['orgId', OTHER_ORG]]), limit(1))));
  });

  it('without the orgId filter the same queries are refused for staff (why historyScope always adds it)', async () => {
    const f = db(FIN);
    await assertFails(getDocs(query(collection(f, 'accountTransactions'), orderBy('createdAt', 'desc'), limit(3))));
    await assertFails(getDocs(eqQuery(f, 'accountTransactions', [['referenceType', 'transfer']])));
    await assertFails(getCountFromServer(eqQuery(f, 'accountTransactions', [['accountId', 'acc-a']])));
  });

  it('an employee reads no ledger at all, even of their own company', async () => {
    const { state } = await pageThrough(EMP, 'accountTransactions', [['orgId', ORG]], 'createdAt');
    expect(state.error).toBe('permission-denied');
    await assertFails(getCountFromServer(eqQuery(db(EMP), 'accountTransactions', [['orgId', ORG], ['accountId', 'acc-a']])));
  });

  it('the platform owner pages the whole platform ledger, a company, or any statement', async () => {
    const all = await pageThrough(OWNER, 'accountTransactions', scopeFor(OWNER, [], undefined, 'all'), 'createdAt', 4);
    expect(all.state.error).toBeNull();
    expect(all.state.items).toHaveLength(14);
    expect(all.state.items[0].id).toBe('tx-014');
    const other = await pageThrough(OWNER, 'accountTransactions', scopeFor(OWNER, [], undefined, OTHER_ORG), 'createdAt');
    expect(other.state.items).toHaveLength(4);
    const statement = await pageThrough(OWNER, 'accountTransactions', scopeFor(OWNER, [['accountId', 'acc-x']], OTHER_ORG, 'all'), 'createdAt');
    expect(statement.state.items).toHaveLength(4);
    const transfers = await assertSucceeds(getDocs(eqQuery(db(OWNER), 'accountTransactions', scopeFor(OWNER, [['referenceType', 'transfer']]))));
    expect(transfers.size).toBe(3);
    // The owner's fresh pre-delete check (deletePaymentAccount): on the account alone, any company.
    const ownerCheck = await assertSucceeds(getDocs(query(eqQuery(db(OWNER), 'accountTransactions', [['accountId', 'acc-x']]), limit(1))));
    expect(ownerCheck.size).toBe(1);
    // ...which staff may not send (they keep the orgId filter).
    await assertFails(getDocs(query(eqQuery(db(ADMIN), 'accountTransactions', [['accountId', 'acc-a']]), limit(1))));
  });
});

describe('audit log, paged (auditLogs)', () => {
  it('an org admin pages its company audit log, newest first', async () => {
    const { state } = await pageThrough(ADMIN, 'auditLogs', scopeFor(ADMIN), 'timestamp');
    expect(state.error).toBeNull();
    expect(state.items.map(l => l.id)).toEqual(['log-6', 'log-5', 'log-4', 'log-3', 'log-2', 'log-1']);
  });

  it("the app's recent window (AppContext) is allowed for an org admin and the owner", async () => {
    const recent = (f: Firestore, ...eq: ReturnType<typeof where>[]) =>
      getDocs(query(collection(f, 'auditLogs'), ...eq, orderBy('timestamp', 'desc'), limit(RECENT_AUDIT_WINDOW)));
    const mine = await assertSucceeds(recent(db(ADMIN), where('orgId', '==', ORG)));
    expect(mine.size).toBe(6);
    const all = await assertSucceeds(recent(db(OWNER)));
    expect(all.size).toBe(9);
  });

  it('finance and employees never read the audit log; an org admin never reads another company', async () => {
    expect((await pageThrough(FIN, 'auditLogs', [['orgId', ORG]], 'timestamp')).state.error).toBe('permission-denied');
    expect((await pageThrough(EMP, 'auditLogs', [['orgId', ORG]], 'timestamp')).state.error).toBe('permission-denied');
    expect((await pageThrough(ADMIN, 'auditLogs', [['orgId', OTHER_ORG]], 'timestamp')).state.error).toBe('permission-denied');
    await assertFails(getDocs(query(collection(db(ADMIN), 'auditLogs'), orderBy('timestamp', 'desc'), limit(3))));
  });

  it('the platform owner pages every entry, platform entries included, or one company', async () => {
    const all = await pageThrough(OWNER, 'auditLogs', scopeFor(OWNER, [], undefined, 'all'), 'timestamp');
    expect(all.state.items).toHaveLength(9);
    expect(all.state.items[0].id).toBe('log-9');
    const other = await pageThrough(OWNER, 'auditLogs', scopeFor(OWNER, [], undefined, OTHER_ORG), 'timestamp');
    expect(other.state.items.map(l => l.id)).toEqual(['log-8', 'log-7']);
  });
});

describe('email delivery log, paged (outbox, email_logs)', () => {
  it("an org admin pages its company's outbox", async () => {
    const { state } = await pageThrough(ADMIN, 'outbox', scopeFor(ADMIN), 'createdAt', 2);
    expect(state.error).toBeNull();
    expect(state.items.map(e => e.id)).toEqual(['ev-5', 'ev-4', 'ev-3', 'ev-2', 'ev-1']);
  });

  it("an org admin never reads another company's outbox nor the legacy email_logs; an employee no outbox", async () => {
    expect((await pageThrough(ADMIN, 'outbox', [['orgId', OTHER_ORG]], 'createdAt')).state.error).toBe('permission-denied');
    expect((await pageThrough(ADMIN, 'email_logs', [], 'timestamp')).state.error).toBe('permission-denied');
    expect((await pageThrough(EMP, 'outbox', [['orgId', ORG]], 'createdAt')).state.error).toBe('permission-denied');
  });

  it('the platform owner pages the whole outbox and the legacy email_logs', async () => {
    const outbox = await pageThrough(OWNER, 'outbox', scopeFor(OWNER), 'createdAt', 3);
    expect(outbox.state.items).toHaveLength(7);
    expect(outbox.state.items[0].id).toBe('ev-7');
    const legacy = await pageThrough(OWNER, 'email_logs', [], 'timestamp', 3);
    expect(legacy.state.items.map(l => l.id)).toEqual(['mail-4', 'mail-3', 'mail-2', 'mail-1']);
  });
});
