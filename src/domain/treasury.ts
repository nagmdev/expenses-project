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
  assertRole,
  auditIdFor,
  claimUniqueKey,
  isKeyTakenByOther,
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

// ---------------------------------------------------------------------------
// Shared: read an account and (for InstaPay / wallets) its linked parent bank
// ---------------------------------------------------------------------------
export async function readAccountWithParent(tx: TxContext, accountId: string) {
  const account = await tx.get<PaymentAccount>(COL.paymentAccounts, accountId);
  if (!account) throw new DomainError('account_not_found', 'حساب الخزينة المحدد غير موجود في قاعدة البيانات.');
  let parent: (PaymentAccount & { id: string }) | null = null;
  if ((account.type === 'instapay' || account.type === 'wallet') && account.parentAccountId && account.parentAccountId !== account.id) {
    parent = await tx.get<PaymentAccount>(COL.paymentAccounts, account.parentAccountId);
  }
  return { account, parent };
}

export interface MovementInput {
  account: PaymentAccount & { id: string };
  parent: (PaymentAccount & { id: string }) | null;
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

/**
 * Computes a balance movement from the balances read INSIDE the transaction
 * (never from possibly-stale UI state) and returns a writer for the account
 * update(s) and ledger entries. Two concurrent movements on the same account
 * are serialized by the transaction, so no update is ever lost.
 */
export function applyMovement(input: MovementInput) {
  const { account, parent, type, amount, actor, nowIso } = input;
  const before = balanceOf(account);
  if (!input.allowOverdraft && type === 'out' && before < amount) {
    throw new DomainError(
      'insufficient_funds',
      `رصيد الحساب غير كافٍ لإتمام الصرف: الرصيد المتوفر (${before.toLocaleString()} ${account.currency || ''}) أقل من المبلغ المطلوب (${amount.toLocaleString()}).`,
    );
  }
  const after = toMoney(type === 'in' ? before + amount : before - amount);

  let parentBefore = 0;
  let parentAfter = 0;
  if (parent) {
    parentBefore = balanceOf(parent);
    if (!input.allowOverdraft && type === 'out' && parentBefore < amount) {
      throw new DomainError('insufficient_funds', `رصيد الحساب البنكي الأم (${parent.name}) غير كافٍ لإتمام الخصم المرتبط.`);
    }
    parentAfter = toMoney(type === 'in' ? parentBefore + amount : parentBefore - amount);
  }

  const ledger: AccountTransaction & { operationLedgerId: string } = {
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

  const write = (tx: TxContext) => {
    tx.update(COL.paymentAccounts, account.id, {
      currentBalance: after,
      balance: after,
      totalIn: toMoney(Number(account.totalIn || 0) + (type === 'in' ? amount : 0)),
      totalOut: toMoney(Number(account.totalOut || 0) + (type === 'out' ? amount : 0)),
      updatedAt: nowIso,
    });
    tx.set(COL.accountTransactions, ledger.id, ledger);
    if (parent) {
      tx.update(COL.paymentAccounts, parent.id, {
        currentBalance: parentAfter,
        balance: parentAfter,
        totalIn: toMoney(Number(parent.totalIn || 0) + (type === 'in' ? amount : 0)),
        totalOut: toMoney(Number(parent.totalOut || 0) + (type === 'out' ? amount : 0)),
        updatedAt: nowIso,
      });
      const parentId = `${input.ledgerId}-parent`;
      tx.set(COL.accountTransactions, parentId, {
        ...ledger,
        id: parentId,
        operationLedgerId: parentId,
        orgId: parent.orgId || account.orgId,
        accountId: parent.id,
        accountName: parent.name,
        balanceBefore: parentBefore,
        balanceAfter: parentAfter,
        description: input.parentDescription,
      });
    }
  };

  return { balanceBefore: before, balanceAfter: after, ledger, write };
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

  return store.runTransaction(async tx => {
    const existing = await tx.get<PaymentAccount>(COL.paymentAccounts, id);
    if (existing) return { value: existing, changed: false, reason: 'duplicate_operation' };

    const key = await readUniqueKey(tx, 'account_identifier', input.orgId, input.accountIdentifier);
    if (isKeyTakenByOther(key, id)) {
      throw new DomainError('duplicate', `يوجد حساب مسجل بالفعل بنفس الرقم / المعرف (${input.accountIdentifier.trim()}) في هذه الشركة.`);
    }
    if (input.parentAccountId) {
      const parent = await tx.get<PaymentAccount>(COL.paymentAccounts, input.parentAccountId);
      if (!parent || parent.orgId !== input.orgId) {
        throw new DomainError('invalid_parent', 'الحساب البنكي الأم المحدد غير موجود أو تابع لشركة أخرى.');
      }
    }

    const account = buildAccountDoc(id, input, nowIso);
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
        details: `تم إنشاء وسيلة وخزينة دفع جديدة: "${account.name}" (${account.type}) برصيد افتتاحي ${toMoney(account.initialBalance).toLocaleString()} ${account.currency}`,
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

export async function deletePaymentAccount(store: DataStore, actor: Actor, accountId: string, operationKey: string, now: Date = new Date()) {
  assertRole(actor, ['super_admin', 'org_admin'], 'حذف الحسابات المالية متاح لمدير الشركة فقط.');
  const nowIso = now.toISOString();
  return store.runTransaction(async tx => {
    const account = await tx.get<PaymentAccount>(COL.paymentAccounts, accountId);
    if (!account) return { value: null, changed: false };
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
      allowOverdraft: true,
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
        details: `${input.type === 'in' ? 'إيداع وتغذية رصيد (+ IN)' : 'سحب وتسوية رصيد (- OUT)'} بقيمة ${amount.toLocaleString()} ${account.currency}. الرصيد: ${movement.balanceBefore.toLocaleString()} -> ${movement.balanceAfter.toLocaleString()}. البيان: ${description}`,
      },
      auditIdFor(operationKey),
      nowIso,
    );
    return { value: movement.ledger, changed: true };
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
    const counter = await readCounter(tx, `custodies-${year}`);
    const custodyNumber = `CUS-${year}-${pad(counter.next, 5)}`;

    const movement = applyMovement({
      account,
      parent,
      type: 'out',
      amount,
      allowOverdraft: true,
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
        details: `صرف عهدة نقدية للموظف ${input.employeeName} بقيمة ${amount} ${custody.currency} من خزينة/حساب "${account.name}"`,
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
      invoiceDate: input.invoiceDate || nowIso.split('T')[0],
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
        details: `تسجيل فاتورة تصفية عهدة بمبلغ ${amount} ${custody.currency} (فاتورة #${input.invoiceNumber || 'بدون'}) للموظف ${custody.employeeName}`,
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
    const movement = applyMovement({
      account,
      parent,
      type: 'out',
      amount,
      allowOverdraft: true,
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
        details: `استعاضة عهدة بقيمة ${amount} ${custody.currency} للموظف ${custody.employeeName} من حساب ${account.name}`,
      },
      auditIdFor(operationKey),
      nowIso,
    );
    return { value: { ...custody, ...patch }, changed: true };
  });
}
