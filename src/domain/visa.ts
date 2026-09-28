import type { PaymentAccount, VisaPaymentRecord, VisaRequest, VisaStatus } from '../types';
import { idFromKey } from '../utils/ids';
import {
  COL,
  DomainError,
  assertRole,
  auditIdFor,
  pad,
  readCounter,
  requirePositiveAmount,
  toMoney,
  writeAudit,
  writeCounter,
  type Actor,
} from './common';
import type { DataStore } from './store';
import { applyMovement, readAccountWithParent, type MutationOutcome } from './treasury';

export type NewVisaInput = Omit<
  VisaRequest,
  'id' | 'requestNumber' | 'status' | 'paidAmount' | 'remainingBalance' | 'payments' | 'createdAt' | 'updatedAt'
>;

export async function createVisaRequest(
  store: DataStore,
  actor: Actor,
  input: NewVisaInput,
  operationKey: string,
  now: Date = new Date(),
): Promise<MutationOutcome<VisaRequest>> {
  if (!input.orgId) throw new DomainError('missing_org', 'يرجى تحديد الشركة.');
  const total = requirePositiveAmount(input.totalAmount, 'يرجى إدخال التكلفة الإجمالية للتأشيرة.');
  const id = idFromKey('visa', operationKey);
  const nowIso = now.toISOString();
  const year = now.getFullYear();

  return store.runTransaction(async tx => {
    const existing = await tx.get<VisaRequest>(COL.visaRequests, id);
    if (existing) return { value: existing, changed: false, reason: 'duplicate_operation' };
    const counter = await readCounter(tx, `visa-${year}`);
    const visa: VisaRequest = {
      ...input,
      id,
      requestNumber: `VISA-${year}-${pad(counter.next, 6)}`,
      totalAmount: total,
      status: 'pending',
      paidAmount: 0,
      remainingBalance: total,
      payments: [],
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    writeCounter(tx, counter, nowIso);
    tx.set(COL.visaRequests, id, visa);
    writeAudit(
      tx,
      actor,
      {
        actionType: 'create',
        entityType: 'visa_request' as any,
        entityId: id,
        entityName: `طلب تأشيرة: ${visa.travelerName} (${visa.requestNumber})`,
        orgId: visa.orgId,
        details: `تم إنشاء طلب تأشيرة جديد للمسافر "${visa.travelerName}" برقم جواز (${visa.passportNumber}) إلى (${visa.destinationCountry || 'غير محدد'}) بمبلغ ${total.toLocaleString()} ${visa.currency} - المورد: ${visa.serviceProviderName}`,
      },
      auditIdFor(operationKey),
      nowIso,
    );
    return { value: visa, changed: true };
  });
}

export async function decideVisaRequest(
  store: DataStore,
  actor: Actor,
  visaId: string,
  decision: { type: 'approve'; approverName: string } | { type: 'reject'; approverName: string; reason: string },
  operationKey: string,
  now: Date = new Date(),
): Promise<MutationOutcome<VisaRequest>> {
  assertRole(actor, ['super_admin', 'org_admin', 'finance'], 'اعتماد ورفض التأشيرات متاح للإدارة فقط.');
  if (decision.type === 'reject' && !decision.reason.trim()) throw new DomainError('invalid_input', 'يرجى كتابة سبب الرفض.');
  const nowIso = now.toISOString();

  return store.runTransaction(async tx => {
    const visa = await tx.get<VisaRequest>(COL.visaRequests, visaId);
    if (!visa) throw new DomainError('not_found', 'طلب التأشيرة غير موجود.');

    let status: VisaStatus;
    if (decision.type === 'approve') {
      if (visa.status !== 'pending' && visa.status !== 'rejected') {
        return { value: visa, changed: false }; // already approved / paying: no-op
      }
      status = visa.paidAmount >= visa.totalAmount ? 'paid' : visa.paidAmount > 0 ? 'partially_paid' : 'approved';
    } else {
      if (visa.status === 'rejected') return { value: visa, changed: false };
      if (Number(visa.paidAmount || 0) > 0) {
        throw new DomainError('invalid_transition', 'لا يمكن رفض طلب تأشيرة بعد تسجيل دفعات مالية عليه.');
      }
      status = 'rejected';
    }
    const patch = {
      status,
      approvedBy: actor.id,
      approvedByName: decision.approverName,
      approvedAt: nowIso,
      rejectionReason: decision.type === 'reject' ? decision.reason.trim() : null,
      updatedAt: nowIso,
    };
    tx.update(COL.visaRequests, visaId, patch);
    writeAudit(
      tx,
      actor,
      {
        actionType: decision.type as any,
        entityType: 'visa_request' as any,
        entityId: visaId,
        entityName: `${decision.type === 'approve' ? 'اعتماد' : 'رفض'} تأشيرة: ${visa.travelerName}`,
        orgId: visa.orgId,
        details:
          decision.type === 'approve'
            ? `قام "${decision.approverName}" باعتماد طلب التأشيرة للمسافر "${visa.travelerName}" (${visa.requestNumber})`
            : `تم رفض طلب التأشيرة للمسافر "${visa.travelerName}" بسبب: "${decision.reason}" بواسطة ${decision.approverName}`,
      },
      auditIdFor(operationKey),
      nowIso,
    );
    return { value: { ...visa, ...patch } as VisaRequest, changed: true };
  });
}

export type NewVisaPayment = Omit<VisaPaymentRecord, 'id' | 'visaRequestId' | 'recordedBy' | 'recordedByName' | 'recordedAt'>;

export async function addVisaPayment(
  store: DataStore,
  actor: Actor,
  visaId: string,
  payment: NewVisaPayment,
  operationKey: string,
  now: Date = new Date(),
): Promise<MutationOutcome<VisaRequest>> {
  assertRole(actor, ['super_admin', 'org_admin', 'finance'], 'تسجيل الدفعات متاح لمسؤولي الخزينة فقط.');
  const amount = requirePositiveAmount(payment.amount, 'مبلغ الدفعة يجب أن يكون أكبر من الصفر.');
  const paymentId = idFromKey('vpay', operationKey);
  const nowIso = now.toISOString();

  return store.runTransaction(async tx => {
    const visa = await tx.get<VisaRequest>(COL.visaRequests, visaId);
    if (!visa) throw new DomainError('not_found', 'طلب التأشيرة غير موجود.');
    if ((visa.payments || []).some(p => p.id === paymentId)) {
      return { value: visa, changed: false, reason: 'duplicate_operation' };
    }
    if (visa.status !== 'approved' && visa.status !== 'partially_paid') {
      throw new DomainError('invalid_transition', 'لا يمكن تسجيل دفعات مالية إلا بعد اعتماد الطلب من الإدارة.');
    }
    const newPaid = toMoney(Number(visa.paidAmount || 0) + amount);
    if (newPaid > toMoney(visa.totalAmount)) {
      throw new DomainError(
        'overpayment',
        `إجمالي الدفعات المسددة (${newPaid.toLocaleString()} ${visa.currency}) لا يمكن أن يتجاوز إجمالي تكلفة التأشيرة (${Number(visa.totalAmount).toLocaleString()} ${visa.currency}).`,
      );
    }

    let movement: ReturnType<typeof applyMovement> | null = null;
    let account: (PaymentAccount & { id: string }) | null = null;
    if (payment.accountId) {
      const read = await readAccountWithParent(tx, payment.accountId);
      account = read.account;
      if (account.orgId && visa.orgId && account.orgId !== visa.orgId) {
        throw new DomainError('cross_org', 'لا يمكن السداد من حساب تابع لشركة أخرى.');
      }
      movement = applyMovement({
        account: read.account,
        parent: read.parent,
        type: 'out',
        amount,
        allowOverdraft: true,
        ledgerId: `tx-${operationKey}`,
        referenceType: 'request',
        referenceId: visa.id,
        referenceNumber: visa.requestNumber,
        description: `سداد دفعة تأشيرة للمسافر: ${visa.travelerName} (${visa.requestNumber})`,
        parentDescription: `خصم تلقائي من الحساب البنكي مقابل سداد دفعة تأشيرة عبر (${read.account.name}) (${visa.requestNumber})`,
        actor,
        nowIso,
      });
    }

    const record: VisaPaymentRecord = {
      ...payment,
      amount,
      accountName: payment.accountName || account?.name,
      id: paymentId,
      visaRequestId: visaId,
      recordedBy: actor.id,
      recordedByName: actor.name,
      recordedAt: nowIso,
    };
    const remaining = toMoney(Math.max(0, Number(visa.totalAmount) - newPaid));
    const patch = {
      paidAmount: newPaid,
      remainingBalance: remaining,
      status: (remaining === 0 ? 'paid' : 'partially_paid') as VisaStatus,
      payments: [...(visa.payments || []), record],
      updatedAt: nowIso,
    };
    tx.update(COL.visaRequests, visaId, patch);
    movement?.write(tx);
    writeAudit(
      tx,
      actor,
      {
        actionType: 'create',
        entityType: 'payment' as any,
        entityId: paymentId,
        entityName: `دفعة تأشيرة: ${amount} ${visa.currency}`,
        orgId: visa.orgId,
        details: `تم تسجيل سداد دفعة بقيمة ${amount.toLocaleString()} ${visa.currency} للمسافر "${visa.travelerName}" (المتبقي: ${remaining.toLocaleString()} ${visa.currency})`,
      },
      auditIdFor(operationKey),
      nowIso,
    );
    return { value: { ...visa, ...patch } as VisaRequest, changed: true };
  });
}

const VISA_PROTECTED: Array<keyof VisaRequest> = ['id', 'requestNumber', 'status', 'paidAmount', 'remainingBalance', 'payments', 'createdAt', 'approvedBy', 'approvedAt'];

export async function updateVisaRequest(store: DataStore, actor: Actor, visaId: string, updates: Partial<VisaRequest>, now: Date = new Date()) {
  const clean: Record<string, any> = { ...updates };
  VISA_PROTECTED.forEach(f => delete clean[f as string]);
  const nowIso = now.toISOString();
  return store.runTransaction(async tx => {
    const visa = await tx.get<VisaRequest>(COL.visaRequests, visaId);
    if (!visa) throw new DomainError('not_found', 'طلب التأشيرة غير موجود.');
    if (clean.totalAmount !== undefined) {
      const total = requirePositiveAmount(clean.totalAmount);
      if (total < Number(visa.paidAmount || 0)) {
        throw new DomainError('invalid_input', 'لا يمكن أن تقل التكلفة الإجمالية عن المبالغ المسددة بالفعل.');
      }
      clean.totalAmount = total;
      clean.remainingBalance = toMoney(total - Number(visa.paidAmount || 0));
    }
    const patch = { ...clean, updatedAt: nowIso };
    tx.update(COL.visaRequests, visaId, patch);
    return { value: { ...visa, ...patch } as VisaRequest, changed: true };
  });
}

export async function deleteVisaRequest(store: DataStore, actor: Actor, visaId: string, operationKey: string, now: Date = new Date()) {
  const nowIso = now.toISOString();
  return store.runTransaction(async tx => {
    const visa = await tx.get<VisaRequest>(COL.visaRequests, visaId);
    if (!visa) return { value: null, changed: false };
    if (Number(visa.paidAmount || 0) > 0 && actor.role !== 'super_admin') {
      throw new DomainError('locked', 'لا يمكن حذف طلب تأشيرة عليه دفعات مالية مسجلة.');
    }
    tx.delete(COL.visaRequests, visaId);
    writeAudit(
      tx,
      actor,
      {
        actionType: 'delete',
        entityType: 'visa_request' as any,
        entityId: visaId,
        entityName: `حذف تأشيرة: ${visa.travelerName}`,
        orgId: visa.orgId,
        details: `تم حذف طلب التأشيرة الخاص بالمسافر "${visa.travelerName}" (${visa.requestNumber})`,
      },
      auditIdFor(operationKey),
      nowIso,
    );
    return { value: visa, changed: true };
  });
}
