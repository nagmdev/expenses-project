/**
 * An archived company keeps its records but takes no new ones, whatever page (or stale
 * picker) asks; and a company with no records at all is really deleted, together with the
 * default treasury accounts every company is created with.
 */ 
import { describe, expect, it } from 'vitest';
import { uniqueKeyDocId, type Actor } from '../src/domain/common';
import { createOrganization, defaultAccountsFor, removeOrganization } from '../src/domain/directory';
import { createExpenseRequest } from '../src/domain/requests';
import type { MemoryStore } from '../src/domain/store';
import { createPaymentAccount, issueCustody } from '../src/domain/treasury';
import { createVisaRequest } from '../src/domain/visa';
import type { Organization } from '../src/types';
import { ORG, admin, draft, employee, finance, freshStore, key, notify, seedAccount } from './helpers';

const now = new Date('2026-09-30T10:00:00.000Z');
const owner: Actor = { id: 'uidOwner000000000000000001', name: 'Owner', email: 'mahmoud@tieapps.com', role: 'super_admin' };

const archive = (store: MemoryStore) => store.seed('organizations', ORG, { ...store.read('organizations', ORG)!, archived: true, status: 'archived' });

const visaInput = () => ({
  orgId: ORG, requestDate: '2026-09-30', travelerName: 'T', passportNumber: 'P', destinationCountry: 'SA', hasTraveledBefore: false,
  expectedTravelDate: '2026-12-01', visaType: 'tourist' as const, serviceProviderId: 'prov-1', serviceProviderName: 'AWS', assignedApprover: '',
  totalAmount: 100, currency: 'EGP', paymentMode: 'full' as const, requesterId: employee.id, requesterName: employee.name,
});

describe('an archived company takes no new record', () => {
  const creates: Array<[string, (store: MemoryStore) => Promise<unknown>]> = [
    ['expense request', store => createExpenseRequest(store, employee, draft(), key(), notify, now)],
    ['visa request', store => createVisaRequest(store, employee, visaInput(), key(), now)],
    ['custody', store => issueCustody(store, finance, { orgId: ORG, employeeId: employee.id, employeeName: employee.name, amount: 10, sourceAccountId: 'cash' }, key(), now)],
    ['treasury account', store => createPaymentAccount(store, admin, { orgId: ORG, name: 'N', type: 'cash', accountIdentifier: 'NEW-1', currency: 'EGP', active: true, initialBalance: 0 } as never, key(), now)],
  ];

  it.each(creates)('%s: refused, and nothing is written', async (_label, create) => {
    const store = freshStore();
    seedAccount(store, 'cash', 1000);
    archive(store);
    const commits = store.commits;
    await expect(create(store)).rejects.toMatchObject({ code: 'archived_org' });
    expect(store.commits).toBe(commits);
    expect(store.read('paymentAccounts', 'cash')).toMatchObject({ balance: 1000 });
  });

  it.each(creates)('%s: refused in a company that does not exist', async (_label, create) => {
    const store = freshStore();
    seedAccount(store, 'cash', 1000);
    await expect(create(withoutCompanyDoc(store))).rejects.toMatchObject({ code: 'not_found' });
    expect(store.read('paymentAccounts', 'cash')).toMatchObject({ balance: 1000 });
  });

  it('a retry of a request created before the company was archived still resolves to it', async () => {
    const store = freshStore();
    const op = key();
    const first = await createExpenseRequest(store, employee, draft(), op, notify, now);
    archive(store);
    const again = await createExpenseRequest(store, employee, draft(), op, notify, now);
    expect(again).toMatchObject({ changed: false, reason: 'duplicate_operation', value: { id: first.value.id } });
  });
});

/** The same store, but its company document reads as missing (seed() cannot delete). */
function withoutCompanyDoc(store: MemoryStore): MemoryStore {
  return {
    ...store,
    runTransaction: fn =>
      store.runTransaction(tx =>
        fn({ ...tx, get: (c, id) => (c === 'organizations' && id === ORG ? Promise.resolve(null) : tx.get(c, id)) }),
      ),
  };
}

describe('deleting a company', () => {
  const newCompany = async (store: MemoryStore): Promise<Organization> =>
    (await createOrganization(store, owner, { name: 'Beta', code: 'BETA', currency: 'EGP', budget: 1, description: '' }, key(), now)).value;

  it('a brand-new company is deleted with its default accounts and their keys', async () => {
    const store = freshStore();
    const org = await newCompany(store);
    const accounts = defaultAccountsFor(org);
    expect(store.dump('paymentAccounts').filter(a => a.orgId === org.id)).toHaveLength(accounts.length);

    const res = await removeOrganization(store, owner, org.id, 'delete', key(), now);
    expect(res).toMatchObject({ changed: true, mode: 'delete' });
    expect(store.read('organizations', org.id)).toBeNull();
    expect(store.dump('paymentAccounts').filter(a => a.orgId === org.id)).toEqual([]);
    for (const acc of accounts) expect(store.read('uniqueKeys', uniqueKeyDocId('account_identifier', org.id, acc.accountIdentifier))).toBeNull();
    expect(store.read('uniqueKeys', uniqueKeyDocId('org_code', '-', 'BETA'))).toBeNull();
    // The code is free again: the company can be created anew.
    await expect(newCompany(store)).resolves.toMatchObject({ id: org.id });
  });

  it('also removes the extra empty accounts it is given', async () => {
    const store = freshStore();
    const org = await newCompany(store);
    const extra = await createPaymentAccount(store, owner, { orgId: org.id, name: 'X', type: 'cash', accountIdentifier: 'X-1', currency: 'EGP', active: true, initialBalance: 0 } as never, key(), now);
    await removeOrganization(store, owner, org.id, 'delete', key(), now, [extra.value.id]);
    expect(store.read('paymentAccounts', extra.value.id)).toBeNull();
    expect(store.read('uniqueKeys', uniqueKeyDocId('account_identifier', org.id, 'X-1'))).toBeNull();
  });

  it('is archived instead when one of its accounts has a balance by then (nothing deleted)', async () => {
    const store = freshStore();
    const org = await newCompany(store);
    const cashId = `vault-cash-${org.id}`;
    store.seed('paymentAccounts', cashId, { ...store.read('paymentAccounts', cashId)!, balance: 50, currentBalance: 50, totalIn: 50 });
    const res = await removeOrganization(store, owner, org.id, 'delete', key(), now);
    expect(res).toMatchObject({ changed: true, mode: 'archive' });
    expect(store.read('organizations', org.id)).toMatchObject({ archived: true, status: 'archived' });
    expect(store.dump('paymentAccounts').filter(a => a.orgId === org.id)).toHaveLength(defaultAccountsFor(org).length);
  });

  it('archive mode touches no account', async () => {
    const store = freshStore();
    const org = await newCompany(store);
    const res = await removeOrganization(store, owner, org.id, 'archive', key(), now, [`vault-cash-${org.id}`]);
    expect(res).toMatchObject({ mode: 'archive' });
    expect(store.dump('paymentAccounts').filter(a => a.orgId === org.id)).toHaveLength(defaultAccountsFor(org).length);
  });

  it('never deletes an account of another company passed by mistake', async () => {
    const store = freshStore();
    const org = await newCompany(store);
    seedAccount(store, 'acme-empty', 0);
    await removeOrganization(store, owner, org.id, 'delete', key(), now, ['acme-empty']);
    expect(store.read('paymentAccounts', 'acme-empty')).toMatchObject({ orgId: ORG });
  });
});
