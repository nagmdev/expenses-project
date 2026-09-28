import type { Actor } from '../src/domain/common';
import { createMemoryStore, type MemoryStore } from '../src/domain/store';
import { DEFAULT_EMAIL_SETTINGS } from '../src/services/emailTemplates';
import type { RequestDraft, NotifyContext } from '../src/domain/requests';
import { newOperationKey } from '../src/utils/ids';

export const ORG = 'org-acme';

export const admin: Actor = { id: 'uidAdmin000000000000000001', name: 'مدير', email: 'admin@acme.test', role: 'org_admin' };
export const finance: Actor = { id: 'uidFinance00000000000000001', name: 'مالية', email: 'fin@acme.test', role: 'finance' };
export const employee: Actor = { id: 'uidEmployee0000000000000001', name: 'موظف', email: 'emp@acme.test', role: 'employee' };
export const otherEmployee: Actor = { id: 'uidEmployee0000000000000002', name: 'موظف 2', email: 'emp2@acme.test', role: 'employee' };

export const notify: NotifyContext = {
  settings: { ...DEFAULT_EMAIL_SETTINGS, enabled: true },
  adminRecipients: ['admin@acme.test'],
};

export function freshStore(): MemoryStore {
  const store = createMemoryStore();
  store.seed('organizations', ORG, { id: ORG, name: 'Acme', code: 'ACME', currency: 'EGP', budget: 100000, description: '', createdAt: '2026-01-01T00:00:00.000Z' });
  store.seed('services', 'srv-1', { id: 'srv-1', orgId: ORG, name: 'Cloud', code: 'CLD', budgetLimit: 50000, spentAmount: 0, color: '#000', iconName: 'x', description: '' });
  store.seed('providers', 'prov-1', { id: 'prov-1', orgId: ORG, name: 'AWS', totalPaid: 0, active: true });
  return store;
}

export function seedAccount(store: MemoryStore, id: string, balance: number, extra: Record<string, any> = {}) {
  store.seed('paymentAccounts', id, {
    id,
    orgId: ORG,
    name: `Account ${id}`,
    type: 'cash',
    accountIdentifier: `ID-${id}`,
    currency: 'EGP',
    active: true,
    balance,
    currentBalance: balance,
    initialBalance: balance,
    totalIn: 0,
    totalOut: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...extra,
  });
}

export function draft(overrides: Partial<RequestDraft> = {}): RequestDraft {
  return {
    orgId: ORG,
    requesterDepartment: 'IT',
    serviceCategoryId: 'srv-1',
    serviceCategoryName: 'Cloud',
    providerId: 'prov-1',
    providerName: 'AWS',
    title: 'Servers',
    description: 'desc',
    justification: 'why',
    amount: 400,
    currency: 'EGP',
    urgency: 'medium',
    requestType: 'expense',
    attachments: [],
    ...overrides,
  } as RequestDraft;
}

export const key = () => newOperationKey();

/** Fire `n` identical calls in the same tick (double click / rapid clicks / two tabs). */
export const burst = <T,>(n: number, fn: () => Promise<T>) => Promise.allSettled(Array.from({ length: n }, fn));
