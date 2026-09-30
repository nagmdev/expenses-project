import type {
  AccountTransaction,
  CustodySettlementItem,
  PaymentAccount,
  PettyCashCustody,
  TransactionReferenceType,
  TransactionType,
} from '../types';
import { idFromKey } from '../utils/ids';
import {
  COL,
  DomainError,
  accountTypeLabel,
  assertOrgWritable,
  assertRole,
  auditIdFor,
  claimUniqueKey,
  formatAmount,
  isKeyTakenByOther,
  localDate,
  pad,
  readCounter,
  readUniqueKey,
  releaseUniqueKey,
  requirePositiveAmount,
  toMoney,
  writeAudit,
  writeCounter,
  type Actor,
} from './common';
import type { DataStore, TxContext } from './store';

export interface MutationOutcome<T> {
  value: T;
  changed: boolean;
  reason?: 'duplicate_operation';
}

const balanceOf = (a: Partial<PaymentAccount>) => toMoney(a.currentBalance ?? a.balance ?? 0);
const currencyOf = (c?: string | null) => ((c || '').trim() || 'EGP').toUpperCase();

type AccountDoc = PaymentAccount & { id: string };
type LedgerEntry = AccountTransaction & { operationLedgerId: string };

// ---------------------------------------------------------------------------
// Shared: read an account and (for InstaPay only) its linked parent bank
// ---------------------------------------------------------------------------
// InstaPay is a transfer channel ON a bank account, so its movements mirror to that
// bank. An e-wallet is a standalone treasury: new wallets are never linked. A wallet
// created before that rule still carries its bank link and keeps mirroring — so its
// balances stay consistent with the bank's history — until an admin detaches it with
// detachLegacyWallet. Other types never mirror.
export const linkedParentIdOf = (account: Pick<PaymentAccount, 'id' | 'type' | 'parentAccountId'>) =>
  (account.type === 'instapay' || account.type === 'wallet') && account.parentAccountId && account.parentAccountId !== account.id
    ? account.parentAccountId
    : null;

/** A pre-standalone wallet still mirroring to its bank (see detachLegacyWallet). */
export const isLegacyLinkedWallet = (account: Pick<PaymentAccount, 'id' | 'type' | 'parentAccountId'>) =>
  account.type === 'wallet' && Boolean(linkedParentIdOf(account));

/**
 * Reads accounts (and their InstaPay parents) inside a transaction, each document at
 * most once, so an operation touching several accounts never reads one twice.
 * Resolves to null when the account does not exist.
 */
function createAccountReader(tx: TxContext) {
  const cache = new Map<string, Promise<AccountDoc | null>>();
  const load = (id: string) => {
    let doc = cache.get(id);
    if (!doc) {
      doc = tx.get<PaymentAccount>(COL.paymentAccounts, id);
      cache.set(id, doc);
    }
    return doc;
  };
  return async (accountId: string) => {
    const account = await load(accountId);
    if (!account) return null;
    const parentId = linkedParentIdOf(account);
    const parent = parentId ? await load(parentId) : null;
    return { account, parent };
  };
}

export async function readAccountWithParent(tx: TxContext, accountId: string) {
  const read = await createAccountReader(tx)(accountId);
  if (!read) throw new DomainError('account_not_found', 'حساب الخزينة المحدد غير موجود في قاعدة البيانات.');
  return read;
}

export interface MovementInput {
  account: AccountDoc;
  parent: AccountDoc | null;
  type: TransactionType;
  amount: number;
  allowOverdraft: boolean;
  /** Deterministic ledger document ID — the idempotency anchor of the movement. */
  ledgerId: string;
  referenceType: TransactionReferenceType;
  referenceId?: string;
  referenceNumber?: string;
  description: string;
  parentDescription: string;
  actor: Actor;
  nowIso: string;
}

export interface MovementResult {
  balanceBefore: number;
  balanceAfter: number;
  ledger: LedgerEntry;
  /** Mirror entry on the linked InstaPay parent bank (id `<ledgerId>-parent`), if any. */
  parentLedger: LedgerEntry | null;
}

// No money operation takes an account below zero (manual withdrawal, custody issue and
// replenishment, visa payment, request disbursement, transfer). The only exception is the
// owner-confirmed bank correction when a legacy wallet is detached (detachLegacyWallet).
const DEPOSIT_FIRST = 'يرجى إيداع المبلغ في الحساب أولاً (إيداع وتغذية رصيد + IN) أو اختيار حساب آخر.';

export function insufficientFunds(account: Pick<PaymentAccount, 'name' | 'currency'>, available: number, amount: number) {
  const cur = currencyOf(account.currency);
  return new DomainError(
    'insufficient_funds',
    `رصيد الحساب "${account.name}" غير كافٍ لإتمام العملية: الرصيد المتوفر (${formatAmount(available)} ${cur}) أقل من المبلغ المطلوب (${formatAmount(amount)} ${cur}). ${DEPOSIT_FIRST}`,
  );
}

/** An InstaPay channel (or a not-yet-detached legacy wallet) spends its bank's money: that bank must cover it too. */
export function insufficientParentFunds(parent: Pick<PaymentAccount, 'name' | 'currency'>, via: Pick<PaymentAccount, 'name'>, available: number, amount: number) {
  const cur = currencyOf(parent.currency);
  return new DomainError(
    'insufficient_funds',
    `رصيد الحساب البنكي المرتبط "${parent.name}" غير كافٍ لإتمام الخصم عبر "${via.name}": الرصيد المتوفر (${formatAmount(available)} ${cur}) أقل من المبلغ المطلوب (${formatAmount(amount)} ${cur}). يرجى إيداع المبلغ في الحساب البنكي أولاً أو اختيار حساب آخر.`,
  );
}

interface RunningAccount {
  doc: AccountDoc;
  balance: number;
  totalIn: number;
  totalOut: number;
  updatedAt?: string;
}

/**
 * Several balance movements inside ONE transaction (a transfer, a bulk custody
 * return…). Balances are chained per account id — linked parents included — so the
 * second movement on an account starts from the first one's result instead of the
 * stale balance read at the start of the transaction. Every touched account is
 * written once with its final balance; every movement gets its own ledger entry.
 *
 * Starting balances must come from documents read INSIDE the transaction (never
 * from possibly-stale UI state). Two concurrent transactions on the same account
 * are serialized by the store, so no update is ever lost. `add` throws (before
 * anything is written) when an out-movement without overdraft is not covered.
 */
export function createMovementBatch() {
  const running = new Map<string, RunningAccount>();
  const ledgers: LedgerEntry[] = [];
  const ledgerIds = new Set<string>();

  const stateOf = (doc: AccountDoc): RunningAccount =>
    running.get(doc.id) ?? { doc, balance: balanceOf(doc), totalIn: Number(doc.totalIn || 0), totalOut: Number(doc.totalOut || 0) };
  const moved = (s: RunningAccount, type: TransactionType, amount: number, after: number, nowIso: string): RunningAccount => ({
    doc: s.doc,
    balance: after,
    totalIn: toMoney(s.totalIn + (type === 'in' ? amount : 0)),
    totalOut: toMoney(s.totalOut + (type === 'out' ? amount : 0)),
    updatedAt: nowIso,
  });
  const claimLedgerId = (id: string) => {
    if (ledgerIds.has(id)) throw new Error(`Duplicate ledger id in one movement batch: ${id}`);
    ledgerIds.add(id);
  };

  function add(input: MovementInput): MovementResult {
    const { account, type, amount, actor, nowIso } = input;
    const parent = input.parent && input.parent.id !== account.id ? input.parent : null;

    const acc = stateOf(account);
    const before = acc.balance;
    if (!input.allowOverdraft && type === 'out' && before < amount) {
      throw insufficientFunds(account, before, amount);
    }
    const after = toMoney(type === 'in' ? before + amount : before - amount);

    const par = parent ? stateOf(parent) : null;
    let parentBefore = 0;
    let parentAfter = 0;
    if (parent && par) {
      parentBefore = par.balance;
      if (!input.allowOverdraft && type === 'out' && parentBefore < amount) {
        throw insufficientParentFunds(parent, account, parentBefore, amount);
      }
      parentAfter = toMoney(type === 'in' ? parentBefore + amount : parentBefore - amount);
    }

    const parentLedgerId = `${input.ledgerId}-parent`;
    claimLedgerId(input.ledgerId);
    if (parent) claimLedgerId(parentLedgerId);

    const ledger: LedgerEntry = {
      id: input.ledgerId,
      operationLedgerId: input.ledgerId,
      orgId: account.orgId,
      accountId: account.id,
      accountName: account.name,
      type,
      amount,
      balanceBefore: before,
      balanceAfter: after,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      referenceNumber: input.referenceNumber,
      description: input.description,
      actorName: actor.name,
      actorId: actor.id,
      createdAt: nowIso,
    };
    const parentLedger: LedgerEntry | null = parent
      ? {
          ...ledger,
          id: parentLedgerId,
          operationLedgerId: parentLedgerId,
          orgId: parent.orgId || account.orgId,
          accountId: parent.id,
          accountName: parent.name,
          balanceBefore: parentBefore,
          balanceAfter: parentAfter,
          description: input.parentDescription,
        }
      : null;

    running.set(account.id, moved(acc, type, amount, after, nowIso));
    if (parent && par) running.set(parent.id, moved(par, type, amount, parentAfter, nowIso));
    ledgers.push(ledger);
    if (parentLedger) ledgers.push(parentLedger);
    return { balanceBefore: before, balanceAfter: after, ledger, parentLedger };
  }

  function write(tx: TxContext) {
    running.forEach(s => {
      tx.update(COL.paymentAccounts, s.doc.id, {
        currentBalance: s.balance,
        balance: s.balance,
        totalIn: s.totalIn,
        totalOut: s.totalOut,
        updatedAt: s.updatedAt,
      });
    });
    ledgers.forEach(l => tx.set(COL.accountTransactions, l.id, l));
  }

  return {
    add,
    write,
    /** Documents `write` will touch (account updates + ledger entries). */
    get writeCount() {
      return running.size + ledgers.length;
    },
  };
}

/**
 * A single balance movement (and its InstaPay parent mirror): computed from the
 * balances read INSIDE the transaction, written by `write(tx)`.
 */
export function applyMovement(input: MovementInput) {
  const batch = createMovementBatch();
  const { balanceBefore, balanceAfter, ledger } = batch.add(input);
  return { balanceBefore, balanceAfter, ledger, write: (tx: TxContext) => batch.write(tx) };
}

// ---------------------------------------------------------------------------
// Payment accounts ("cards" / vaults)
// ---------------------------------------------------------------------------
export type NewAccountInput = Omit<PaymentAccount, 'id' | 'createdAt'>;

export function buildAccountDoc(id: string, input: NewAccountInput, nowIso: string): PaymentAccount {
  const opening = toMoney(input.initialBalance ?? input.currentBalance ?? input.balance ?? 0);
  return {
    ...input,
    id,
    name: input.name.trim(),
    accountIdentifier: (input.accountIdentifier || '').trim(),
    initialBalance: opening,
    currentBalance: opening,
    balance: opening,
    totalIn: 0,
    totalOut: 0,
    active: input.active !== false,
    createdAt: nowIso,
  };
}

/** Writes account + opening-balance ledger entry + uniqueness key (caller already did the reads). */
export function writeNewAccount(tx: TxContext, actor: Actor, account: PaymentAccount, identifierKey: Awaited<ReturnType<typeof readUniqueKey>> | null, nowIso: string) {
  tx.set(COL.paymentAccounts, account.id, account);
  if (identifierKey) claimUniqueKey(tx, identifierKey, { collection: COL.paymentAccounts, id: account.id }, nowIso);
  const opening = toMoney(account.initialBalance);
  if (opening !== 0) {
    const openingTx: AccountTransaction = {
      id: `tx-open-${account.id}`,
      orgId: account.orgId,
      accountId: account.id,
      accountName: account.name,
      type: opening > 0 ? 'in' : 'out',
      amount: Math.abs(opening),
      balanceBefore: 0,
      balanceAfter: opening,
      referenceType: 'initial',
      description: 'رصيد افتتاحي عند إنشاء الحساب',
      actorName: actor.name,
      actorId: actor.id,
      createdAt: nowIso,
    };
    tx.set(COL.accountTransactions, openingTx.id, openingTx);
  }
}

export async function createPaymentAccount(
  store: DataStore,
  actor: Actor,
  input: NewAccountInput,
  operationKey: string,
  now: Date = new Date(),
): Promise<MutationOutcome<PaymentAccount>> {
  assertRole(actor, ['super_admin', 'org_admin'], 'إنشاء الحسابات والخزائن متاح لمدير الشركة فقط.');
  if (!input.orgId) throw new DomainError('missing_org', 'يرجى تحديد الشركة التابع لها الحساب.');
  if (!input.name?.trim()) throw new DomainError('invalid_input', 'يرجى إدخال اسم الحساب.');
  if (!input.accountIdentifier?.trim()) throw new DomainError('invalid_input', 'يرجى إدخال رقم / معرف الحساب.');

  const id = idFromKey('vault', operationKey);
  const nowIso = now.toISOString();
  // Only an InstaPay channel is linked to a bank; a wallet (or any other type) is standalone.
  const accountInput: NewAccountInput = { ...input };
  if (accountInput.type !== 'instapay') {
    delete accountInput.parentAccountId;
    delete accountInput.parentAccountName;
  }

  return store.runTransaction(async tx => {
    const existing = await tx.get<PaymentAccount>(COL.paymentAccounts, id);
    if (existing) return { value: existing, changed: false, reason: 'duplicate_operation' };
    await assertOrgWritable(tx, input.orgId);

    const key = await readUniqueKey(tx, 'account_identifier', input.orgId, input.accountIdentifier);
    if (isKeyTakenByOther(key, id)) {
      throw new DomainError('duplicate', `يوجد حساب مسجل بالفعل بنفس الرقم / المعرف (${input.accountIdentifier.trim()}) في هذه الشركة.`);
    }
    if (accountInput.parentAccountId) {
      const parent = await tx.get<PaymentAccount>(COL.paymentAccounts, accountInput.parentAccountId);
      if (!parent || parent.orgId !== input.orgId) {
        throw new DomainError('invalid_parent', 'الحساب البنكي الأم المحدد غير موجود أو تابع لشركة أخرى.');
      }
    }

    const account = buildAccountDoc(id, accountInput, nowIso);
    writeNewAccount(tx, actor, account, key, nowIso);
    writeAudit(
      tx,
      actor,
      {
        actionType: 'create',
        entityType: 'vault',
        entityId: id,
        entityName: account.name,
        orgId: account.orgId,
        details: `تم إنشاء وسيلة وخزينة دفع جديدة: "${account.name}" (${accountTypeLabel(account.type)}) برصيد افتتاحي ${formatAmount(toMoney(account.initialBalance))} ${account.currency}`,
      },
      auditIdFor(operationKey),
      nowIso,
    );
    return { value: account, changed: true };
  });
}

const BALANCE_FIELDS: Array<keyof PaymentAccount> = ['balance', 'currentBalance', 'initialBalance', 'totalIn', 'totalOut', 'id', 'createdAt', 'orgId'];

export async function updatePaymentAccount(
  store: DataStore,
  actor: Actor,
  accountId: string,
  updates: Partial<PaymentAccount>,
  operationKey: string,
  now: Date = new Date(),
): Promise<MutationOutcome<PaymentAccount>> {
  assertRole(actor, ['super_admin', 'org_admin', 'finance'], 'ليس لديك صلاحية تعديل الحسابات المالية.');
  // Balances may only change through ledger movements (never by overwriting the field).
  const clean: Record<string, any> = { ...updates };
  BALANCE_FIELDS.forEach(f => delete clean[f as string]);
  const nowIso = now.toISOString();

  return store.runTransaction(async tx => {
    const account = await tx.get<PaymentAccount>(COL.paymentAccounts, accountId);
    if (!account) throw new DomainError('account_not_found', 'الحساب غير موجود أو تم حذفه.');

    const newIdentifier = typeof clean.accountIdentifier === 'string' ? clean.accountIdentifier.trim() : undefined;
    const identifierChanged = newIdentifier !== undefined && newIdentifier.toLowerCase() !== (account.accountIdentifier || '').trim().toLowerCase();
    let oldKey = null as Awaited<ReturnType<typeof readUniqueKey>> | null;
    let newKey = null as Awaited<ReturnType<typeof readUniqueKey>> | null;
    if (identifierChanged) {
      oldKey = await readUniqueKey(tx, 'account_identifier', account.orgId, account.accountIdentifier || '');
      newKey = await readUniqueKey(tx, 'account_identifier', account.orgId, newIdentifier!);
      if (isKeyTakenByOther(newKey, accountId)) {
        throw new DomainError('duplicate', `يوجد حساب آخر بنفس الرقم / المعرف (${newIdentifier}) في هذه الشركة.`);
      }
    }

    // Only an InstaPay channel is ever (re)linked to a bank. A wallet's link fields are never
    // taken from the caller: a legacy link (or an InstaPay's link carried into a wallet) is
    // kept and only detachLegacyWallet removes it, together with the bank correction.
    // Changing a still-linked account into a type that cannot mirror would silently cut it
    // off from the bank history, so that is refused.
    const resultingType = clean.type ?? account.type;
    if (linkedParentIdOf(account) && resultingType !== 'instapay' && resultingType !== 'wallet') {
      throw new DomainError('linked_account', 'هذا الحساب مرتبط بحساب بنكي؛ افصله عن البنك أولاً ثم غيّر نوعه.');
    }
    if (resultingType !== 'instapay') {
      delete clean.parentAccountId;
      delete clean.parentAccountName;
    } else if (clean.parentAccountId && clean.parentAccountId !== account.parentAccountId) {
      const parent = clean.parentAccountId === accountId ? null : await tx.get<PaymentAccount>(COL.paymentAccounts, clean.parentAccountId);
      if (!parent || parent.orgId !== account.orgId) {
        throw new DomainError('invalid_parent', 'الحساب البنكي الأم المحدد غير موجود أو تابع لشركة أخرى.');
      }
    }
    const patch = { ...clean, ...(newIdentifier !== undefined ? { accountIdentifier: newIdentifier } : {}), updatedAt: nowIso };
    tx.update(COL.paymentAccounts, accountId, patch);
    if (oldKey) releaseUniqueKey(tx, oldKey, accountId);
    if (newKey) claimUniqueKey(tx, newKey, { collection: COL.paymentAccounts, id: accountId }, nowIso);

    const nameChanged = typeof clean.name === 'string' && clean.name.trim() !== account.name.trim();
    const statusChanged = typeof clean.active === 'boolean' && clean.active !== account.active;
    writeAudit(
      tx,
      actor,
      {
        actionType: statusChanged ? 'status_toggle' : nameChanged ? 'rename' : 'update',
        entityType: 'vault',
        entityId: accountId,
        entityName: clean.name || account.name,
        orgId: account.orgId,
        details: statusChanged
          ? `تم ${clean.active ? 'تفعيل' : 'تعطيل'} حساب/خزينة الدفع "${account.name}"`
          : nameChanged
          ? `تم إعادة تسمية وسيلة الدفع من "${account.name}" إلى "${clean.name}"`
          : `تم تعديل بيانات وسيلة وخزينة الدفع "${account.name}"`,
      },
      auditIdFor(operationKey),
      nowIso,
    );
    return { value: { ...account, ...patch } as PaymentAccount, changed: true };
  });
}

/**
 * A treasury account with a balance or any history (opening balance, money in or out)
 * is part of the books: deleting it would orphan its ledger and change the totals.
 * Such an account can only be deactivated (firestore.rules refuse the delete as well).
 */
export const paymentAccountHasHistory = (a: Partial<PaymentAccount>) =>
  [a.currentBalance, a.balance, a.initialBalance, a.totalIn, a.totalOut].some(v => toMoney(v) !== 0);

export function assertPaymentAccountDeletable(account: Partial<PaymentAccount> & { name?: string }) {
  if (paymentAccountHasHistory(account)) {
    throw new DomainError(
      'account_has_history',
      `لا يمكن حذف الحساب "${account.name || ''}" لأن له رصيداً أو حركات مالية مسجلة (الرصيد الحالي ${formatAmount(balanceOf(account))} ${currencyOf(account.currency)}). يمكنك تعطيله بدلاً من الحذف مع الاحتفاظ بسجله المالي.`,
    );
  }
}

export async function deletePaymentAccount(store: DataStore, actor: Actor, accountId: string, operationKey: string, now: Date = new Date()) {
  assertRole(actor, ['super_admin', 'org_admin'], 'حذف الحسابات المالية متاح لمدير الشركة فقط.');
  const nowIso = now.toISOString();
  return store.runTransaction(async tx => {
    const account = await tx.get<PaymentAccount>(COL.paymentAccounts, accountId);
    if (!account) return { value: null, changed: false };
    assertPaymentAccountDeletable(account);
    const key = await readUniqueKey(tx, 'account_identifier', account.orgId, account.accountIdentifier || '');
    tx.delete(COL.paymentAccounts, accountId);
    releaseUniqueKey(tx, key, accountId);
    writeAudit(
      tx,
      actor,
      {
        actionType: 'delete',
        entityType: 'vault',
        entityId: accountId,
        entityName: account.name,
        orgId: account.orgId,
        details: `تم حذف وسيلة وخزينة الدفع "${account.name}" من النظام`,
      },
      auditIdFor(operationKey),
      nowIso,
    );
    return { value: account, changed: true };
  });
}

// ---------------------------------------------------------------------------
// Manual deposit / withdrawal
// ---------------------------------------------------------------------------
export async function adjustAccountBalance(
  store: DataStore,
  actor: Actor,
  input: { accountId: string; type: TransactionType; amount: number; description: string },
  operationKey: string,
  now: Date = new Date(),
): Promise<MutationOutcome<AccountTransaction>> {
  assertRole(actor, ['super_admin', 'org_admin', 'finance'], 'ليس لديك صلاحية تسجيل حركات مالية.');
  const amount = requirePositiveAmount(input.amount);
  const ledgerId = `tx-${operationKey}`;
  const nowIso = now.toISOString();
  const description = input.description.trim() || (input.type === 'in' ? 'إيداع نقدي مباشر' : 'سحب نقدي مباشر');

  return store.runTransaction(async tx => {
    const already = await tx.get<AccountTransaction>(COL.accountTransactions, ledgerId);
    if (already) return { value: already, changed: false, reason: 'duplicate_operation' };
    const { account, parent } = await readAccountWithParent(tx, input.accountId);

    const movement = applyMovement({
      account,
      parent,
      type: input.type,
      amount,
      // A withdrawal never takes the account (or the bank behind an InstaPay) below zero.
      allowOverdraft: false,
      ledgerId,
      referenceType: 'manual_adjustment',
      description,
      parentDescription: `تسوية وتعديل رصيد تلقائي بالحساب البنكي مرتبط بـ (${account.name}): ${description}`,
      actor,
      nowIso,
    });
    movement.write(tx);
    writeAudit(
      tx,
      actor,
      {
        actionType: 'update',
        entityType: 'vault',
        entityId: account.id,
        entityName: account.name,
        orgId: account.orgId,
        details: `${input.type === 'in' ? 'إيداع وتغذية رصيد (+ IN)' : 'سحب وتسوية رصيد (- OUT)'} بقيمة ${formatAmount(amount)} ${account.currency}. الرصيد: ${formatAmount(movement.balanceBefore)} -> ${formatAmount(movement.balanceAfter)}. البيان: ${description}`,
      },
      auditIdFor(operationKey),
      nowIso,
    );
    return { value: movement.ledger, changed: true };
  });
}

// ---------------------------------------------------------------------------
// Legacy linked wallet -> standalone treasury
// ---------------------------------------------------------------------------
export interface DetachWalletInput {
  walletId: string;
  /**
   * Signed amount booked on the bank (+ in / - out), confirmed by the owner; 0 = detach only.
   * Old mirror entries cannot be matched one by one (legacy ids carry no link to the wallet
   * entry), so the UI suggests `totalOut - totalIn` of the wallet: what mirroring took from
   * (or added to) the bank.
   */
  bankCorrection: number;
  /** The wallet totals the suggestion was computed from; refused if they changed meanwhile. */
  expectedWalletTotals?: { totalIn: number; totalOut: number };
  note?: string;
}

export async function detachLegacyWallet(
  store: DataStore,
  actor: Actor,
  input: DetachWalletInput,
  operationKey: string,
  now: Date = new Date(),
): Promise<MutationOutcome<{ wallet: PaymentAccount; correction: AccountTransaction | null }>> {
  assertRole(actor, ['super_admin', 'org_admin'], 'فصل المحفظة عن البنك متاح لمدير الشركة فقط.');
  const correction = toMoney(Number(input.bankCorrection) || 0);
  const ledgerId = `tx-${operationKey}`;
  const nowIso = now.toISOString();
  const note = (input.note || '').trim();

  return store.runTransaction(async tx => {
    const wallet = await tx.get<PaymentAccount>(COL.paymentAccounts, input.walletId);
    if (!wallet) throw new DomainError('account_not_found', 'المحفظة غير موجودة أو تم حذفها.');
    const already = await tx.get<AccountTransaction>(COL.accountTransactions, ledgerId);
    // Already standalone: a retry of this operation, or it was detached from another tab.
    if (!isLegacyLinkedWallet(wallet)) return { value: { wallet, correction: already }, changed: false, reason: 'duplicate_operation' };

    const expected = input.expectedWalletTotals;
    if (expected && (toMoney(Number(wallet.totalIn || 0)) !== toMoney(expected.totalIn) || toMoney(Number(wallet.totalOut || 0)) !== toMoney(expected.totalOut))) {
      throw new DomainError('stale', 'تغيرت حركات المحفظة أثناء المراجعة. راجع مبلغ التصحيح المقترح مرة أخرى ثم أكد.');
    }
    const bank = await tx.get<PaymentAccount>(COL.paymentAccounts, wallet.parentAccountId!);

    let correctionLedger: AccountTransaction | null = null;
    let bankLine = '';
    if (correction !== 0) {
      if (!bank) throw new DomainError('account_not_found', 'الحساب البنكي المرتبط بالمحفظة لم يعد موجوداً؛ افصل المحفظة بدون تعديل رصيد.');
      if (bank.orgId !== wallet.orgId) throw new DomainError('cross_org', 'الحساب البنكي المرتبط تابع لشركة أخرى.');
      const batch = createMovementBatch();
      const moved = batch.add({
        account: bank,
        parent: null,
        type: correction > 0 ? 'in' : 'out',
        amount: Math.abs(correction),
        allowOverdraft: true,
        ledgerId,
        referenceType: 'manual_adjustment',
        referenceId: wallet.id,
        description: `تصحيح رصيد البنك عند فصل المحفظة (${wallet.name}): عكس أثر حركات المحفظة التي كانت تُسجَّل على البنك${note ? ` - ${note}` : ''}`,
        parentDescription: '',
        actor,
        nowIso,
      });
      batch.write(tx);
      correctionLedger = moved.ledger;
      bankLine = ` وتصحيح رصيد "${bank.name}" بمبلغ ${correction > 0 ? '+' : '-'}${formatAmount(Math.abs(correction))} ${bank.currency || ''} (${formatAmount(moved.balanceBefore)} -> ${formatAmount(moved.balanceAfter)})`;
    }
    tx.update(COL.paymentAccounts, wallet.id, { parentAccountId: '', parentAccountName: '', updatedAt: nowIso });
    writeAudit(
      tx,
      actor,
      {
        actionType: 'update',
        entityType: 'vault',
        entityId: wallet.id,
        entityName: wallet.name,
        orgId: wallet.orgId,
        details: `فصل المحفظة "${wallet.name}" عن الحساب البنكي "${bank?.name || wallet.parentAccountName || wallet.parentAccountId}" لتصبح خزينة مستقلة${bankLine || ' بدون تعديل رصيد البنك'}`,
      },
      auditIdFor(operationKey),
      nowIso,
    );
    return { value: { wallet: { ...wallet, parentAccountId: '', parentAccountName: '', updatedAt: nowIso }, correction: correctionLedger }, changed: true };
  });
}

// ---------------------------------------------------------------------------
// Petty-cash custodies
// ---------------------------------------------------------------------------
export interface IssueCustodyInput {
  orgId: string;
  orgName?: string;
  employeeId: string;
  employeeName: string;
  employeePhone?: string;
  amount: number;
  sourceAccountId: string;
  notes?: string;
}

export async function issueCustody(
  store: DataStore,
  actor: Actor,
  input: IssueCustodyInput,
  operationKey: string,
  now: Date = new Date(),
): Promise<MutationOutcome<PettyCashCustody>> {
  assertRole(actor, ['super_admin', 'org_admin', 'finance'], 'صرف العهد متاح لمسؤولي الخزينة ومدير الشركة فقط.');
  const amount = requirePositiveAmount(input.amount, 'يرجى إدخال مبلغ صحيح للعهدة.');
  const custodyId = idFromKey('cus', operationKey);
  const nowIso = now.toISOString();
  const year = now.getFullYear();

  return store.runTransaction(async tx => {
    const existing = await tx.get<PettyCashCustody>(COL.custodies, custodyId);
    if (existing) return { value: existing, changed: false, reason: 'duplicate_operation' };

    const { account, parent } = await readAccountWithParent(tx, input.sourceAccountId);
    if (account.orgId && input.orgId && account.orgId !== input.orgId) {
      throw new DomainError('cross_org', 'لا يمكن صرف عهدة من حساب تابع لشركة أخرى.');
    }
    if (account.active === false) throw new DomainError('inactive_account', `الحساب "${account.name}" معطل ولا يمكن الصرف منه.`);
    const custodyOrgId = input.orgId || account.orgId;
    if (custodyOrgId) await assertOrgWritable(tx, custodyOrgId);
    const counter = await readCounter(tx, `custodies-${year}`);
    const custodyNumber = `CUS-${year}-${pad(counter.next, 5)}`;

    const movement = applyMovement({
      account,
      parent,
      type: 'out',
      amount,
      allowOverdraft: false,
      ledgerId: `tx-${operationKey}`,
      referenceType: 'custody',
      referenceId: custodyId,
      referenceNumber: custodyNumber,
      description: `صرف عهدة نقدية للموظف ${input.employeeName}`,
      parentDescription: `خصم تلقائي من الحساب البنكي مقابل صرف عهدة نقدية عبر (${account.name}) للموظف ${input.employeeName}`,
      actor,
      nowIso,
    });

    const custody: PettyCashCustody = {
      id: custodyId,
      orgId: input.orgId,
      custodyNumber,
      employeeId: input.employeeId,
      employeeName: input.employeeName,
      employeePhone: input.employeePhone || '',
      totalAmount: amount,
      remainingAmount: amount,
      settledAmount: 0,
      currency: account.currency || 'EGP',
      sourceAccountId: account.id,
      sourceAccountName: account.name,
      status: 'active',
      issuedAt: nowIso,
      notes: input.notes || '',
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    writeCounter(tx, counter, nowIso);
    tx.set(COL.custodies, custodyId, custody);
    movement.write(tx);
    writeAudit(
      tx,
      actor,
      {
        actionType: 'create',
        entityType: 'custody',
        entityId: custodyId,
        entityName: `${custodyNumber} - ${input.employeeName}`,
        orgId: input.orgId,
        orgName: input.orgName,
        details: `صرف عهدة نقدية للموظف ${input.employeeName} بقيمة ${formatAmount(amount)} ${custody.currency} من خزينة/حساب "${account.name}"`,
      },
      auditIdFor(operationKey),
      nowIso,
    );
    return { value: custody, changed: true };
  });
}

export interface SettleCustodyInput {
  custodyId: string;
  amount: number;
  description: string;
  serviceCategoryId?: string;
  serviceCategoryName?: string;
  vendorName?: string;
  invoiceNumber?: string;
  invoiceDate?: string;
  receiptUrl?: string;
  orgName?: string;
}

export async function settleCustodyItem(
  store: DataStore,
  actor: Actor,
  input: SettleCustodyInput,
  operationKey: string,
  now: Date = new Date(),
): Promise<MutationOutcome<CustodySettlementItem>> {
  const amount = requirePositiveAmount(input.amount, 'يرجى إدخال مبلغ صحيح للفاتورة.');
  const settlementId = idFromKey('stl', operationKey);
  const nowIso = now.toISOString();

  return store.runTransaction(async tx => {
    const existing = await tx.get<CustodySettlementItem>(COL.custodySettlements, settlementId);
    if (existing) return { value: existing, changed: false, reason: 'duplicate_operation' };
    const custody = await tx.get<PettyCashCustody>(COL.custodies, input.custodyId);
    if (!custody) throw new DomainError('not_found', 'العهدة غير موجودة أو تم حذفها.');
    const isOwner = custody.employeeId === actor.id;
    if (!isOwner && !['super_admin', 'org_admin', 'finance'].includes(actor.role)) {
      throw new DomainError('forbidden', 'ليس لديك صلاحية تسوية هذه العهدة.');
    }

    // Computed from the committed custody, so two concurrent invoices can't both
    // subtract from the same stale "remaining" value.
    const remaining = toMoney(Math.max(0, Number(custody.remainingAmount || 0) - amount));
    const settled = toMoney(Number(custody.settledAmount || 0) + amount);
    const fullySettled = remaining <= 0;

    const settlement: CustodySettlementItem = {
      id: settlementId,
      custodyId: custody.id,
      orgId: custody.orgId,
      employeeId: custody.employeeId,
      employeeName: custody.employeeName,
      amount,
      currency: custody.currency || 'EGP',
      serviceCategoryId: input.serviceCategoryId || '',
      serviceCategoryName: input.serviceCategoryName || '',
      vendorName: input.vendorName || '',
      invoiceNumber: input.invoiceNumber || '',
      invoiceDate: input.invoiceDate || localDate(now),
      description: input.description.trim() || 'فاتورة تسوية عهدة',
      receiptUrl: input.receiptUrl || '',
      status: 'approved',
      createdAt: nowIso,
    };

    tx.update(COL.custodies, custody.id, {
      remainingAmount: remaining,
      settledAmount: settled,
      status: fullySettled ? 'settled' : custody.status,
      settledAt: fullySettled ? nowIso : custody.settledAt ?? null,
      updatedAt: nowIso,
    });
    tx.set(COL.custodySettlements, settlementId, settlement);
    writeAudit(
      tx,
      actor,
      {
        actionType: 'update',
        entityType: 'custody',
        entityId: custody.id,
        entityName: `${custody.custodyNumber} - ${custody.employeeName}`,
        orgId: custody.orgId,
        orgName: input.orgName,
        details: `تسجيل فاتورة تصفية عهدة بمبلغ ${formatAmount(amount)} ${custody.currency} (فاتورة #${input.invoiceNumber || 'بدون'}) للموظف ${custody.employeeName}`,
      },
      auditIdFor(operationKey),
      nowIso,
    );
    return { value: settlement, changed: true };
  });
}

export async function replenishCustody(
  store: DataStore,
  actor: Actor,
  input: { custodyId: string; amount: number; sourceAccountId: string; notes?: string; orgName?: string },
  operationKey: string,
  now: Date = new Date(),
): Promise<MutationOutcome<PettyCashCustody>> {
  assertRole(actor, ['super_admin', 'org_admin', 'finance'], 'استعاضة العهد متاحة لمسؤولي الخزينة ومدير الشركة فقط.');
  const amount = requirePositiveAmount(input.amount, 'يرجى إدخال مبلغ استعاضة صحيح.');
  const ledgerId = `tx-${operationKey}`;
  const nowIso = now.toISOString();

  return store.runTransaction(async tx => {
    const already = await tx.get(COL.accountTransactions, ledgerId);
    const custody = await tx.get<PettyCashCustody>(COL.custodies, input.custodyId);
    if (!custody) throw new DomainError('not_found', 'العهدة غير موجودة.');
    if (already) return { value: custody, changed: false, reason: 'duplicate_operation' };

    const { account, parent } = await readAccountWithParent(tx, input.sourceAccountId);
    if (account.orgId && custody.orgId && account.orgId !== custody.orgId) {
      throw new DomainError('cross_org', 'لا يمكن الاستعاضة من حساب تابع لشركة أخرى.');
    }
    if (account.active === false) throw new DomainError('inactive_account', `الحساب "${account.name}" معطل ولا يمكن الصرف منه.`);
    const movement = applyMovement({
      account,
      parent,
      type: 'out',
      amount,
      allowOverdraft: false,
      ledgerId,
      referenceType: 'custody',
      referenceId: custody.id,
      referenceNumber: custody.custodyNumber,
      description: `استعاضة عهدة نقدية للموظف ${custody.employeeName} (${custody.custodyNumber})`,
      parentDescription: `خصم تلقائي من الحساب البنكي مقابل استعاضة عهدة نقدية عبر (${account.name}) للموظف ${custody.employeeName} (${custody.custodyNumber})`,
      actor,
      nowIso,
    });
    const patch = {
      totalAmount: toMoney(Number(custody.totalAmount || 0) + amount),
      remainingAmount: toMoney(Number(custody.remainingAmount || 0) + amount),
      status: 'active' as const,
      notes: input.notes ? (custody.notes ? `${custody.notes} | [استعاضة: ${input.notes}]` : input.notes) : custody.notes || '',
      updatedAt: nowIso,
    };
    tx.update(COL.custodies, custody.id, patch);
    movement.write(tx);
    writeAudit(
      tx,
      actor,
      {
        actionType: 'update',
        entityType: 'custody',
        entityId: custody.id,
        entityName: `${custody.custodyNumber} - ${custody.employeeName}`,
        orgId: custody.orgId,
        orgName: input.orgName,
        details: `استعاضة عهدة بقيمة ${formatAmount(amount)} ${custody.currency} للموظف ${custody.employeeName} من حساب ${account.name}`,
      },
      auditIdFor(operationKey),
      nowIso,
    );
    return { value: { ...custody, ...patch }, changed: true };
  });
}

// ---------------------------------------------------------------------------
// Custody return: the cash left with employees goes back into a treasury
// ---------------------------------------------------------------------------
export const MAX_CUSTODY_RETURN_BATCH = 100;
// Firestore commits at most 500 writes; a bulk return refuses (never half-applies) above that.
const MAX_TX_WRITES = 500;

export interface ReturnCustodyInput {
  custodyIds: string[];
  /** One treasury account for every custody; omitted → each custody's own source account. */
  targetAccountId?: string;
  notes?: string;
  orgName?: string;
}

export interface CustodyReturnLine {
  custodyId: string;
  custodyNumber: string;
  employeeName: string;
  amount: number;
  accountId: string;
  accountName: string;
}

export type CustodyReturnSkipReason = 'not_found' | 'nothing_remaining' | 'already_done';

export interface CustodyReturnResult {
  returned: CustodyReturnLine[];
  skipped: Array<{ custodyId: string; reason: CustodyReturnSkipReason }>;
  totalReturned: number;
}

/** Deterministic ledger id of one custody's return within one operation (the idempotency anchor). */
export const custodyReturnLedgerId = (operationKey: string, custodyId: string) => `${idFromKey('tx', operationKey)}-ret-${custodyId}`;

/**
 * Deposits the remaining cash of one or more custodies into a treasury account, in
 * ONE transaction: an 'in' ledger entry per custody (balances chained, so several
 * custodies into the same account never start from the same stale balance), the
 * custody closed (remaining 0, status settled) and an audit entry per custody.
 *
 * Idempotent: a retry with the same key finds each custody's ledger entry and skips
 * it ('already_done'). A second operation (another key) on an already-returned
 * custody finds nothing remaining, so money is never returned twice.
 */
export async function returnCustodyRemainders(
  store: DataStore,
  actor: Actor,
  input: ReturnCustodyInput,
  operationKey: string,
  now: Date = new Date(),
): Promise<MutationOutcome<CustodyReturnResult>> {
  assertRole(actor, ['super_admin', 'org_admin', 'finance'], 'رد متبقي العهد إلى الخزينة متاح لمسؤولي الخزينة ومدير الشركة فقط.');
  const custodyIds = Array.from(new Set((input.custodyIds || []).map(id => String(id || '').trim()).filter(Boolean)));
  if (custodyIds.length === 0) throw new DomainError('invalid_input', 'يرجى اختيار عهدة واحدة على الأقل لرد المتبقي منها.');
  if (custodyIds.length > MAX_CUSTODY_RETURN_BATCH) {
    throw new DomainError('too_many', `لا يمكن رد أكثر من ${MAX_CUSTODY_RETURN_BATCH} عهدة في عملية واحدة؛ يرجى تقسيمها على أكثر من عملية.`);
  }
  if (custodyIds.some(id => id.includes('/'))) throw new DomainError('invalid_input', 'معرف عهدة غير صالح.');
  const targetAccountId = (input.targetAccountId || '').trim() || undefined;
  const notes = (input.notes || '').trim();
  const ledgerIds = new Map(custodyIds.map(id => [id, custodyReturnLedgerId(operationKey, id)]));
  const nowIso = now.toISOString();

  return store.runTransaction(async tx => {
    // ---------- reads (all before any write) ----------
    const [custodies, done] = await Promise.all([
      Promise.all(custodyIds.map(id => tx.get<PettyCashCustody>(COL.custodies, id))),
      Promise.all(custodyIds.map(id => tx.get<AccountTransaction>(COL.accountTransactions, ledgerIds.get(id)!))),
    ]);

    const skipped: CustodyReturnResult['skipped'] = [];
    const due: Array<{ custody: PettyCashCustody & { id: string }; amount: number; accountId: string }> = [];
    custodyIds.forEach((custodyId, i) => {
      const custody = custodies[i];
      if (done[i]) skipped.push({ custodyId, reason: 'already_done' });
      else if (!custody) skipped.push({ custodyId, reason: 'not_found' });
      else {
        const amount = toMoney(custody.remainingAmount);
        if (amount <= 0) skipped.push({ custodyId, reason: 'nothing_remaining' });
        else due.push({ custody, amount, accountId: targetAccountId || custody.sourceAccountId || '' });
      }
    });

    if (due.length === 0) {
      if (skipped.some(s => s.reason === 'already_done')) {
        // Retry / double submit of an operation that already went through.
        return { value: { returned: [], skipped, totalReturned: 0 }, changed: false, reason: 'duplicate_operation' };
      }
      throw new DomainError('nothing_to_return', 'لا يوجد متبقٍ في العهد المحددة لرده.');
    }

    const readAccount = createAccountReader(tx);
    const accounts = await Promise.all(due.map(d => (d.accountId ? readAccount(d.accountId) : Promise.resolve(null))));

    // ---------- validate + compute ----------
    const batch = createMovementBatch();
    const returned: CustodyReturnLine[] = [];
    const moves = due.map((d, i) => {
      const { custody, amount } = d;
      const read = accounts[i];
      if (!read) {
        throw new DomainError(
          'account_not_found',
          targetAccountId
            ? 'حساب الخزينة المحدد للإيداع غير موجود أو تم حذفه؛ يرجى اختيار حساب آخر.'
            : `الحساب المسحوب منه العهدة ${custody.custodyNumber} (${custody.sourceAccountName || 'غير محدد'}) غير موجود أو تم حذفه؛ يرجى اختيار حساب آخر لإيداع المتبقي فيه.`,
        );
      }
      const { account, parent } = read;
      if (account.orgId && custody.orgId && account.orgId !== custody.orgId) {
        throw new DomainError('cross_org', `لا يمكن رد متبقي العهدة ${custody.custodyNumber} إلى حساب تابع لشركة أخرى.`);
      }
      if (currencyOf(custody.currency) !== currencyOf(account.currency)) {
        throw new DomainError(
          'currency_mismatch',
          `تعارض في العملات: عملة العهدة ${custody.custodyNumber} (${currencyOf(custody.currency)}) لا تطابق عملة الحساب "${account.name}" (${currencyOf(account.currency)}).`,
        );
      }
      const movement = batch.add({
        account,
        parent,
        type: 'in',
        amount,
        allowOverdraft: true,
        ledgerId: ledgerIds.get(custody.id)!,
        referenceType: 'custody_return',
        referenceId: custody.id,
        referenceNumber: custody.custodyNumber,
        description: `رد المتبقي من عهدة الموظف ${custody.employeeName} (${custody.custodyNumber}) وإيداعه بالخزينة${notes ? `: ${notes}` : ''}`,
        parentDescription: `إيداع تلقائي بالحساب البنكي مرتبط عبر (${account.name}) مقابل رد متبقي عهدة الموظف ${custody.employeeName} (${custody.custodyNumber})`,
        actor,
        nowIso,
      });
      returned.push({ custodyId: custody.id, custodyNumber: custody.custodyNumber, employeeName: custody.employeeName, amount, accountId: account.id, accountName: account.name });
      return { custody, amount, account, movement };
    });

    if (batch.writeCount + moves.length * 2 >= MAX_TX_WRITES) {
      throw new DomainError('too_many', 'عدد الحسابات والعهد المحددة كبير لتنفيذه في عملية واحدة؛ يرجى تقسيم العهد على أكثر من عملية.');
    }

    // ---------- writes ----------
    batch.write(tx);
    moves.forEach(({ custody, amount, account, movement }) => {
      tx.update(COL.custodies, custody.id, {
        remainingAmount: 0,
        returnedAmount: toMoney(Number(custody.returnedAmount || 0) + amount),
        status: 'settled',
        settledAt: nowIso,
        returnedAt: nowIso,
        returnedToAccountId: account.id,
        returnedToAccountName: account.name,
        updatedAt: nowIso,
      });
      writeAudit(
        tx,
        actor,
        {
          actionType: 'update',
          entityType: 'custody',
          entityId: custody.id,
          entityName: `${custody.custodyNumber} - ${custody.employeeName}`,
          orgId: custody.orgId,
          orgName: input.orgName,
          details: `رد المتبقي من عهدة الموظف ${custody.employeeName} بقيمة ${formatAmount(amount)} ${currencyOf(custody.currency)} وإيداعه في خزينة/حساب "${account.name}". رصيد الحساب: ${formatAmount(movement.balanceBefore)} -> ${formatAmount(movement.balanceAfter)}${notes ? `. ملاحظات: ${notes}` : ''}`,
        },
        auditIdFor(operationKey, custody.id),
        nowIso,
      );
    });

    const totalReturned = toMoney(returned.reduce((sum, r) => sum + r.amount, 0));
    return { value: { returned, skipped, totalReturned }, changed: true };
  });
}

// ---------------------------------------------------------------------------
// Transfer between two treasury accounts (ترانسفير)
// ---------------------------------------------------------------------------
export interface TransferInput {
  fromAccountId: string;
  toAccountId: string;
  amount: number;
  description?: string;
  orgName?: string;
}

export interface TransferResult {
  transferNumber: string;
  out: AccountTransaction;
  in: AccountTransaction;
}

/** Where the money of an account actually sits: an InstaPay channel's bank, else the account itself. */
const fundsHolderOf = (read: { account: AccountDoc; parent: AccountDoc | null }) => (read.parent ? read.parent.id : read.account.id);

/**
 * Moves money from one account to another in ONE transaction: an 'out' ledger entry
 * on the source and an 'in' entry on the destination (InstaPay channels mirror to
 * their bank as usual), numbered TRF-<year>-<6 digits>. Never overdraws the source.
 * Idempotent on the operation key (deterministic ledger ids tx-<key>-out / -in).
 */
export async function transferBetweenAccounts(
  store: DataStore,
  actor: Actor,
  input: TransferInput,
  operationKey: string,
  now: Date = new Date(),
): Promise<MutationOutcome<TransferResult>> {
  assertRole(actor, ['super_admin', 'org_admin', 'finance'], 'التحويل بين الخزائن والحسابات متاح لمسؤولي الخزينة ومدير الشركة فقط.');
  const amount = requirePositiveAmount(input.amount, 'يرجى إدخال مبلغ تحويل صحيح أكبر من الصفر.');
  const fromId = (input.fromAccountId || '').trim();
  const toId = (input.toAccountId || '').trim();
  if (!fromId || !toId) throw new DomainError('missing_account', 'يرجى اختيار الحساب المحوَّل منه والحساب المحوَّل إليه.');
  if (fromId === toId) throw new DomainError('same_account', 'لا يمكن التحويل من الحساب إلى نفسه؛ يرجى اختيار حساب آخر.');
  const transferId = idFromKey('trf', operationKey);
  const outLedgerId = `tx-${operationKey}-out`;
  const inLedgerId = `tx-${operationKey}-in`;
  const description = (input.description || '').trim();
  const nowIso = now.toISOString();
  const year = now.getFullYear();

  return store.runTransaction(async tx => {
    // ---------- reads (all before any write) ----------
    const [doneOut, doneIn] = await Promise.all([
      tx.get<AccountTransaction>(COL.accountTransactions, outLedgerId),
      tx.get<AccountTransaction>(COL.accountTransactions, inLedgerId),
    ]);
    if (doneOut) {
      return {
        value: { transferNumber: doneOut.referenceNumber || '', out: doneOut, in: (doneIn ?? doneOut) as AccountTransaction },
        changed: false,
        reason: 'duplicate_operation',
      };
    }

    const readAccount = createAccountReader(tx);
    const [from, to] = await Promise.all([readAccount(fromId), readAccount(toId)]);
    if (!from) throw new DomainError('account_not_found', 'الحساب المحوَّل منه غير موجود أو تم حذفه.');
    if (!to) throw new DomainError('account_not_found', 'الحساب المحوَّل إليه غير موجود أو تم حذفه.');
    if (from.account.active === false) throw new DomainError('inactive_account', `الحساب "${from.account.name}" معطل ولا يمكن التحويل منه.`);
    if (to.account.active === false) throw new DomainError('inactive_account', `الحساب "${to.account.name}" معطل ولا يمكن التحويل إليه.`);
    if ((from.account.orgId || '') !== (to.account.orgId || '')) {
      throw new DomainError('cross_org', 'لا يمكن التحويل بين حسابات تابعة لشركات مختلفة.');
    }
    const fromCurrency = currencyOf(from.account.currency);
    const toCurrency = currencyOf(to.account.currency);
    if (fromCurrency !== toCurrency) {
      throw new DomainError('currency_mismatch', `تعارض في العملات: عملة الحساب المحوَّل منه (${fromCurrency}) لا تطابق عملة الحساب المحوَّل إليه (${toCurrency}).`);
    }
    if (fundsHolderOf(from) === fundsHolderOf(to)) {
      throw new DomainError(
        'same_funds',
        `لا يمكن التحويل بين "${from.account.name}" و"${to.account.name}" لأنهما يمثلان نفس الرصيد الفعلي (حساب بنكي وقناة إنستاباي مربوطة به، أو قناتا إنستاباي على نفس البنك)؛ حركة إنستاباي تنعكس تلقائياً على البنك المرتبط.`,
      );
    }
    // No overdraft for transfers: the source (and the bank behind an InstaPay source) must cover it.
    // Checked before a transfer number is read, so a refused transfer never burns a number.
    const available = balanceOf(from.account);
    if (available < amount) throw insufficientFunds(from.account, available, amount);
    if (from.parent && balanceOf(from.parent) < amount) throw insufficientParentFunds(from.parent, from.account, balanceOf(from.parent), amount);
    const counter = await readCounter(tx, `transfers-${year}`);
    const transferNumber = `TRF-${year}-${pad(counter.next, 6)}`;

    // ---------- compute ----------
    const suffix = description ? `: ${description}` : '';
    const batch = createMovementBatch();
    const out = batch.add({
      account: from.account,
      parent: from.parent,
      type: 'out',
      amount,
      allowOverdraft: false,
      ledgerId: outLedgerId,
      referenceType: 'transfer',
      referenceId: transferId,
      referenceNumber: transferNumber,
      description: `تحويل صادر إلى (${to.account.name})${suffix}`,
      parentDescription: `خصم تلقائي من الحساب البنكي مرتبط عبر (${from.account.name}) مقابل تحويل صادر إلى (${to.account.name}) - ${transferNumber}`,
      actor,
      nowIso,
    });
    const inn = batch.add({
      account: to.account,
      parent: to.parent,
      type: 'in',
      amount,
      allowOverdraft: true,
      ledgerId: inLedgerId,
      referenceType: 'transfer',
      referenceId: transferId,
      referenceNumber: transferNumber,
      description: `تحويل وارد من (${from.account.name})${suffix}`,
      parentDescription: `إيداع تلقائي بالحساب البنكي مرتبط عبر (${to.account.name}) مقابل تحويل وارد من (${from.account.name}) - ${transferNumber}`,
      actor,
      nowIso,
    });

    // ---------- writes ----------
    writeCounter(tx, counter, nowIso);
    batch.write(tx);
    writeAudit(
      tx,
      actor,
      {
        actionType: 'update',
        entityType: 'vault',
        entityId: transferId,
        entityName: `تحويل ${transferNumber} من (${from.account.name}) إلى (${to.account.name})`,
        orgId: from.account.orgId,
        orgName: input.orgName,
        details: `تحويل مبلغ ${formatAmount(amount)} ${fromCurrency} من "${from.account.name}" (${formatAmount(out.balanceBefore)} -> ${formatAmount(out.balanceAfter)}) إلى "${to.account.name}" (${formatAmount(inn.balanceBefore)} -> ${formatAmount(inn.balanceAfter)}) برقم ${transferNumber}${description ? `. البيان: ${description}` : ''}`,
      },
      auditIdFor(operationKey),
      nowIso,
    );
    return { value: { transferNumber, out: out.ledger, in: inn.ledger }, changed: true };
  });
}
