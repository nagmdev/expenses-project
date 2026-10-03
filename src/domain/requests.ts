import type {
  DisbursementDetails,
  EmailNotificationSettings,
  ExpenseRequest,
  Organization,
  PaymentAccount,
  RequestComment,
  RequestStatus,
  ServiceCategory,
  ServiceProvider,
  TimelineEvent,
  RequestAttachment,
} from '../types';
import { idFromKey } from '../utils/ids';
import {
  COL,
  DomainError,
  assertOrgWritable,
  assertRole,
  auditIdFor,
  normalizeEmail,
  pad,
  paymentMethodLabel,
  roleLabel,
  readCounter,
  timelineTimestamp,
  toMoney,
  writeAudit,
  writeCounter,
  type Actor,
  formatAmount,
} from './common';
import { buildOutboxEvent, enqueueOutbox, outboxEventId } from './outbox';
import type { DataStore, TxContext } from './store';
import { applyMovement, readAccountWithParent } from './treasury';
import { isSupportedCurrency, normalizeCurrency } from './analytics';

export interface NotifyContext {
  settings: EmailNotificationSettings;
  org?: Organization;
  /** Admin recipients (new request / clarification reply). */
  adminRecipients?: string[];
}

export type RequestDraft = Omit<
  ExpenseRequest,
  | 'id'
  | 'requestNumber'
  | 'status'
  | 'comments'
  | 'timeline'
  | 'createdAt'
  | 'updatedAt'
  | 'requesterId'
  | 'requesterName'
  | 'requesterEmail'
  | 'disbursement'
  | 'rejectionReason'
>;

export interface MutationResult<T> {
  value: T;
  /** false when the call was a replay/no-op (duplicate submit, already in target state). */
  changed: boolean;
  reason?: 'duplicate_operation' | 'already_in_state' | 'already_disbursed';
  outboxEventIds: string[];
}

const ADMIN_ROLES = ['super_admin', 'org_admin', 'finance'] as const;

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------
export async function createExpenseRequest(
  store: DataStore,
  actor: Actor,
  draft: RequestDraft,
  operationKey: string,
  notify: NotifyContext,
  now: Date = new Date(),
): Promise<MutationResult<ExpenseRequest>> {
  if (!draft.orgId) throw new DomainError('missing_org', 'يرجى تحديد الشركة أو المؤسسة التابع لها الطلب.');
  const amount = toMoney(draft.amount);
  if (!(amount > 0)) throw new DomainError('invalid_amount', 'يرجى إدخال مبلغ صحيح أكبر من الصفر.');
  const reqCurrency = normalizeCurrency(draft.currency, 'EGP');
  if (!isSupportedCurrency(reqCurrency)) {
    throw new DomainError('invalid_currency', `العملة المحددة (${draft.currency}) غير مدعومة في النظام المالي.`);
  }

  const id = idFromKey('req', operationKey);
  const nowIso = now.toISOString();
  const year = now.getFullYear();
  const isIncome = draft.requestType === 'income';

  return store.runTransaction(async tx => {
    const existing = await tx.get<ExpenseRequest>(COL.requests, id);
    if (existing) {
      // Retry / double submit of the same intent: return the record created the first time.
      return { value: existing, changed: false, reason: 'duplicate_operation', outboxEventIds: [] };
    }
    await assertOrgWritable(tx, draft.orgId);
    const counter = await readCounter(tx, `requests-${year}`);

    const request: ExpenseRequest & { operationKey: string } = {
      ...draft,
      amount,
      id,
      requestNumber: `REQ-${year}-${pad(counter.next, 6)}`,
      requesterId: actor.id,
      requesterName: actor.name,
      requesterEmail: normalizeEmail(actor.email),
      status: 'pending',
      comments: [],
      timeline: [
        {
          id: `tl-${operationKey}`,
          status: 'created',
          title: isIncome ? 'تم إنشاء وتقديم طلب توريد / تحصيل مالي' : 'تم إنشاء وتقديم طلب الصرف',
          description: draft.paymentAccountDetails
            ? `طريقة التحويل: ${paymentMethodLabel(draft.preferredPaymentMethod || 'instapay')} (${draft.paymentAccountDetails})`
            : isIncome
            ? 'تم إرسال طلب التوريد للمراجعة والاستلام المالي'
            : 'تم إرسال الطلب للاعتماد المالي والإداري',
          actorName: actor.name,
          timestamp: timelineTimestamp(now),
        },
      ],
      createdAt: nowIso,
      updatedAt: nowIso,
      operationKey,
    };

    writeCounter(tx, counter, nowIso);
    tx.set(COL.requests, id, request);
    const eventId = enqueueOutbox(
      tx,
      buildOutboxEvent({
        eventId: outboxEventId('new_request', id),
        eventType: 'new_request',
        entityType: 'request',
        entityId: id,
        orgId: request.orgId,
        recipients: notify.adminRecipients || [],
        details: { request, org: notify.org, actorName: actor.name },
        settings: notify.settings,
        actor,
        nowIso,
      }),
    );
    return { value: request, changed: true, outboxEventIds: eventId ? [eventId] : [] };
  });
}

// ---------------------------------------------------------------------------
// Edit (requester / admin) — protected fields can never be changed here
// ---------------------------------------------------------------------------
const PROTECTED_FIELDS: Array<keyof ExpenseRequest | 'operationKey'> = [
  'id',
  'requestNumber',
  'status',
  'orgId',
  'requesterId',
  'requesterName',
  'requesterEmail',
  'comments',
  'timeline',
  'disbursement',
  'rejectionReason',
  'createdAt',
  'updatedAt',
  'operationKey',
];

export async function updateExpenseRequest(
  store: DataStore,
  actor: Actor,
  requestId: string,
  fields: Partial<ExpenseRequest>,
  operationKey: string,
  now: Date = new Date(),
): Promise<MutationResult<ExpenseRequest>> {
  const clean: Record<string, any> = { ...fields };
  PROTECTED_FIELDS.forEach(f => delete clean[f as string]);
  if (clean.amount !== undefined) {
    clean.amount = toMoney(clean.amount);
    if (!(clean.amount > 0)) throw new DomainError('invalid_amount', 'يرجى إدخال مبلغ صحيح أكبر من الصفر.');
  }
  if (clean.currency !== undefined) {
    clean.currency = normalizeCurrency(clean.currency, 'EGP');
    if (!isSupportedCurrency(clean.currency)) {
      throw new DomainError('invalid_currency', `العملة المحددة (${clean.currency}) غير مدعومة في النظام المالي.`);
    }
  }
  const eventId = `tl-${operationKey}`;

  return store.runTransaction(async tx => {
    const req = await tx.get<ExpenseRequest>(COL.requests, requestId);
    if (!req) throw new DomainError('not_found', 'الطلب غير موجود أو تم حذفه.');
    if ((req.timeline || []).some(e => e.id === eventId)) {
      return { value: req, changed: false, reason: 'duplicate_operation', outboxEventIds: [] };
    }
    if (req.status === 'disbursed' || req.status === 'rejected') {
      throw new DomainError('locked', 'لا يمكن تعديل طلب تم صرفه أو رفضه؛ السجلات المالية المغلقة غير قابلة للتعديل.');
    }
    const isAdmin = (ADMIN_ROLES as readonly string[]).includes(actor.role);
    const isRequester = req.requesterId === actor.id || normalizeEmail(req.requesterEmail) === normalizeEmail(actor.email);
    if (!isAdmin && !isRequester) throw new DomainError('forbidden', 'ليس لديك صلاحية تعديل هذا الطلب.');
    if (!isAdmin && req.status === 'approved') {
      throw new DomainError('locked', 'تم اعتماد الطلب ولا يمكن لمقدمه تعديله الآن.');
    }

    // The edit form sends the whole request: an amount / currency that is the stored one
    // (also a legacy request without a currency, read as EGP, or an amount never rounded) is
    // not a change and is not rewritten, so an approved request keeps its approval.
    if (clean.amount !== undefined && clean.amount === toMoney(req.amount)) delete clean.amount;
    if (clean.currency !== undefined && clean.currency === normalizeCurrency(req.currency, 'EGP')) delete clean.currency;
    // Changing money on an approved request invalidates the approval.
    const moneyChanged = clean.amount !== undefined || clean.currency !== undefined;

    // firestore.rules → requests: finance attaches / replaces the invoice of a request it did
    // not file (or of any approved request) and nothing else; re-opening an approved request
    // by changing its money is the org admin's call.
    const changed = Object.keys(clean).filter(k => JSON.stringify(clean[k]) !== JSON.stringify((req as Record<string, any>)[k]));
    const invoiceOnly = changed.every(k => k === 'invoiceAttachment' || k === 'attachments');
    if (actor.role === 'finance' && (!isRequester || req.status === 'approved') && !invoiceOnly) {
      throw new DomainError('forbidden', 'يمكن لمسؤول المالية إرفاق الفاتورة أو استبدالها فقط في هذا الطلب؛ تعديل بياناته متاح لمقدمه أو لمدير الشركة.');
    }
    const nextStatus: RequestStatus = req.status === 'approved' && moneyChanged ? 'pending' : req.status;

    const tl: TimelineEvent = {
      id: eventId,
      status: nextStatus,
      title: 'تعديل بيانات ومرفقات الطلب',
      description:
        nextStatus !== req.status
          ? 'تم تعديل المبلغ بعد الاعتماد؛ أُعيد الطلب لقائمة المراجعة لإعادة الاعتماد'
          : 'قام مقدم الطلب بتعديل بيانات الطلب والمرفقات',
      actorName: actor.name,
      timestamp: timelineTimestamp(now),
    };
    const patch = {
      ...clean,
      status: nextStatus,
      timeline: [...(req.timeline || []), tl],
      updatedAt: now.toISOString(),
    };
    tx.update(COL.requests, requestId, patch);
    return { value: { ...req, ...patch } as ExpenseRequest, changed: true, outboxEventIds: [] };
  });
}

// ---------------------------------------------------------------------------
// State machine: approve / reject / clarify / reply
// ---------------------------------------------------------------------------
export type RequestAction =
  | { type: 'approve'; note?: string }
  | { type: 'reject'; reason: string }
  | { type: 'clarify'; question: string }
  | { type: 'reply'; replyText: string; attachmentName?: string; attachment?: RequestAttachment };

interface TransitionRule {
  from: RequestStatus[];
  to: RequestStatus;
  roles: Actor['role'][] | 'requester';
  forbidden: string;
  invalid: string;
}

const TRANSITIONS: Record<RequestAction['type'], TransitionRule> = {
  approve: {
    from: ['pending', 'clarification_requested'],
    to: 'approved',
    roles: ['super_admin', 'org_admin', 'finance'],
    forbidden: 'عفواً، صلاحية اعتماد الطلبات مقتصرة على مدراء المؤسسة ومسؤولي الصرف المعتمدين.',
    invalid: 'لا يمكن اعتماد الطلب في حالته الحالية.',
  },
  reject: {
    from: ['pending', 'clarification_requested', 'approved'],
    to: 'rejected',
    roles: ['super_admin', 'org_admin', 'finance'],
    forbidden: 'عفواً، صلاحية رفض الطلبات مقتصرة على مدراء المؤسسة ومسؤولي الصرف المعتمدين.',
    invalid: 'لا يمكن رفض الطلب في حالته الحالية (تم صرفه أو رفضه مسبقاً).',
  },
  clarify: {
    from: ['pending', 'clarification_requested'],
    to: 'clarification_requested',
    roles: ['super_admin', 'org_admin'],
    forbidden: 'عفواً، صلاحية طلب توضيحات مقتصرة على مدراء المؤسسة فقط.',
    invalid: 'لا يمكن طلب توضيح على طلب تم اعتماده أو صرفه أو رفضه.',
  },
  reply: {
    from: ['clarification_requested'],
    to: 'pending',
    roles: 'requester',
    forbidden: 'الرد على الاستيضاح متاح لمقدم الطلب فقط.',
    invalid: 'لا يوجد استيضاح مفتوح على هذا الطلب.',
  },
};

export async function transitionExpenseRequest(
  store: DataStore,
  actor: Actor,
  requestId: string,
  action: RequestAction,
  operationKey: string,
  notify: NotifyContext,
  now: Date = new Date(),
): Promise<MutationResult<ExpenseRequest>> {
  const rule = TRANSITIONS[action.type];
  if (rule.roles !== 'requester') assertRole(actor, rule.roles, rule.forbidden);
  if (action.type === 'reject' && !action.reason?.trim()) throw new DomainError('invalid_input', 'يرجى كتابة سبب الرفض.');
  if (action.type === 'clarify' && !action.question?.trim()) throw new DomainError('invalid_input', 'يرجى كتابة سؤال الاستيضاح.');
  if (action.type === 'reply' && !action.replyText?.trim()) throw new DomainError('invalid_input', 'يرجى كتابة الرد.');

  const tlId = `tl-${operationKey}`;
  const nowIso = now.toISOString();
  const ts = timelineTimestamp(now);

  return store.runTransaction(async tx => {
    const req = await tx.get<ExpenseRequest>(COL.requests, requestId);
    if (!req) throw new DomainError('not_found', 'الطلب غير موجود أو تم حذفه.');

    if ((req.timeline || []).some(e => e.id === tlId)) {
      return { value: req, changed: false, reason: 'duplicate_operation', outboxEventIds: [] };
    }
    // Idempotent terminal transitions: approving an approved request is a no-op,
    // never a second side effect (no second email, no second timeline entry).
    if (req.status === rule.to && action.type !== 'clarify') {
      return { value: req, changed: false, reason: 'already_in_state', outboxEventIds: [] };
    }
    if (!rule.from.includes(req.status)) throw new DomainError('invalid_transition', rule.invalid);

    if (rule.roles === 'requester') {
      const isRequester = req.requesterId === actor.id || normalizeEmail(req.requesterEmail) === normalizeEmail(actor.email);
      if (!isRequester && actor.role !== 'super_admin') throw new DomainError('forbidden', rule.forbidden);
    }

    const comments: RequestComment[] = [...(req.comments || [])];
    let attachments = req.attachments || [];
    let timelineTitle = '';
    let timelineDescription = '';
    const patch: Record<string, any> = {};

    switch (action.type) {
      case 'approve':
        if (action.note?.trim()) {
          comments.push({
            id: `cmt-${operationKey}`,
            authorId: actor.id,
            authorName: actor.name,
            authorRole: roleLabel(actor.role),
            content: action.note.trim(),
            type: 'internal_note',
            createdAt: nowIso,
          });
        }
        timelineTitle = 'تمت الموافقة والاعتماد المالي';
        timelineDescription = action.note?.trim() ? `ملاحظات الاعتماد: ${action.note.trim()}` : 'تم اعتماد الطلب وتحويله للصرف المالي';
        patch.approvedBy = actor.id;
        patch.approvedAt = nowIso;
        break;
      case 'reject':
        comments.push({
          id: `cmt-${operationKey}`,
          authorId: actor.id,
          authorName: actor.name,
          authorRole: roleLabel(actor.role),
          content: `سبب الرفض: ${action.reason.trim()}`,
          type: 'internal_note',
          createdAt: nowIso,
        });
        timelineTitle = 'تم رفض طلب الصرف';
        timelineDescription = `السبب: ${action.reason.trim()}`;
        patch.rejectionReason = action.reason.trim();
        break;
      case 'clarify':
        comments.push({
          id: `cmt-${operationKey}`,
          authorId: actor.id,
          authorName: actor.name,
          authorRole: roleLabel(actor.role),
          content: action.question.trim(),
          type: 'clarification_request',
          createdAt: nowIso,
        });
        timelineTitle = 'طلب توضيحات ومستندات إضافية';
        timelineDescription = action.question.trim();
        break;
      case 'reply':
        if (action.attachment) {
          attachments = [...attachments, action.attachment];
          patch.attachments = attachments;
        }
        comments.push({
          id: `cmt-${operationKey}`,
          authorId: actor.id,
          authorName: actor.name,
          authorRole: 'طالب الصرف',
          content: action.replyText.trim(),
          type: 'clarification_reply',
          createdAt: nowIso,
          ...(action.attachment?.name || action.attachmentName?.trim()
            ? { attachmentName: (action.attachment?.name || action.attachmentName)!.trim() }
            : {}),
        });
        timelineTitle = 'قام طالب الصرف بتقديم التوضيح والمستندات';
        timelineDescription = action.replyText.trim();
        break;
    }

    const timeline: TimelineEvent[] = [
      ...(req.timeline || []),
      { id: tlId, status: rule.to, title: timelineTitle, description: timelineDescription, actorName: actor.name, timestamp: ts },
    ];
    Object.assign(patch, { status: rule.to, comments, timeline, updatedAt: nowIso });
    tx.update(COL.requests, requestId, patch);
    const updated = { ...req, ...patch } as ExpenseRequest;

    const emailEvent =
      action.type === 'approve'
        ? 'request_approved'
        : action.type === 'reject'
        ? 'request_rejected'
        : action.type === 'clarify'
        ? 'clarification_requested'
        : 'clarification_replied';
    const recipients = action.type === 'reply' ? notify.adminRecipients || [] : [updated.requesterEmail || ''];
    // The reply email to the admins is the requester's: by UID, or by a VERIFIED email
    // (firestore.rules → outbox isRequesterOf). A requester recognised only by an unverified
    // email (an admin-provisioned password account replying on a request filed under an older
    // id) still saves the reply; only the email is not sent.
    const mayNotify = action.type !== 'reply' || actor.role === 'super_admin' ||
      req.requesterId === actor.id || actor.emailVerified !== false;
    const eventId = !mayNotify ? null : enqueueOutbox(
      tx,
      buildOutboxEvent({
        eventId: outboxEventId(emailEvent, requestId, operationKey),
        eventType: emailEvent,
        entityType: 'request',
        entityId: requestId,
        orgId: updated.orgId,
        recipients,
        details: {
          request: updated,
          org: notify.org,
          actorName: actor.name,
          note: action.type === 'approve' ? action.note : action.type === 'reply' ? action.replyText : undefined,
          rejectionReason: action.type === 'reject' ? action.reason : undefined,
          clarificationQuestion: action.type === 'clarify' ? action.question : undefined,
        },
        settings: notify.settings,
        actor,
        nowIso,
      }),
    );
    return { value: updated, changed: true, outboxEventIds: eventId ? [eventId] : [] };
  });
}

// ---------------------------------------------------------------------------
// Disbursement (atomic: request + balance + ledger + budget + provider + audit + outbox)
// ---------------------------------------------------------------------------
export interface DisburseInput extends Omit<DisbursementDetails, 'disbursedAt' | 'disbursedBy'> {
  accountId: string;
  batchId?: string;
}

/** A service read that the rules refuse (not shared with this company any more) reads as absent. */
async function readRequestService(tx: TxContext, serviceId: string): Promise<ServiceCategory | null> {
  try {
    return await tx.get<ServiceCategory>(COL.services, serviceId);
  } catch (err) {
    if ((err as { code?: string } | null)?.code === 'permission-denied') return null;
    throw err;
  }
}

export async function disburseExpenseRequest(
  store: DataStore,
  actor: Actor,
  requestId: string,
  input: DisburseInput,
  operationKey: string,
  notify: NotifyContext,
  now: Date = new Date(),
): Promise<MutationResult<ExpenseRequest>> {
  assertRole(actor, ['super_admin', 'org_admin', 'finance'], 'عفواً، ليس لديك صلاحية تنفيذ عمليات الصرف والتحويل.');
  if (!input.accountId) throw new DomainError('missing_account', 'يرجى اختيار الخزينة أو الحساب المالي الذي سيتم الصرف منه.');
  if (!input.referenceNumber?.trim()) throw new DomainError('invalid_input', 'يرجى إدخال رقم المرجع / العملية.');

  const nowIso = now.toISOString();
  const ts = timelineTimestamp(now);

  return store.runTransaction(async tx => {
    // ---------- reads ----------
    const req = await tx.get<ExpenseRequest>(COL.requests, requestId);
    if (!req) throw new DomainError('not_found', 'طلب الصرف غير موجود في قاعدة البيانات.');
    if (req.status === 'disbursed') {
      // Double click, batch retry, second finance user: never pay twice.
      return { value: req, changed: false, reason: 'already_disbursed', outboxEventIds: [] };
    }
    const isIncome = req.requestType === 'income';
    const allowed: RequestStatus[] = isIncome ? ['approved', 'pending'] : ['approved'];
    if (!allowed.includes(req.status)) {
      throw new DomainError('invalid_transition', 'لا يمكن صرف طلب غير معتمد رسمياً من الإدارة.');
    }

    const { account, parent } = await readAccountWithParent(tx, input.accountId);
    if (account.orgId && req.orgId && account.orgId !== req.orgId) {
      throw new DomainError('cross_org', 'لا يمكن الصرف من حساب تابع لشركة أخرى.');
    }
    if (account.active === false) throw new DomainError('inactive_account', 'الحساب المالي المحدد معطل.');

    const reqCurrency = (req.currency || 'EGP').trim().toUpperCase();
    const accCurrency = (account.currency || 'EGP').trim().toUpperCase();
    if (reqCurrency !== accCurrency) {
      throw new DomainError('currency_mismatch', `تعارض في العملات: عملة الطلب (${reqCurrency}) لا تطابق عملة الحساب (${accCurrency}).`);
    }

    // The request's service may no longer be readable here: e.g. the owner stopped sharing it
    // with the request's company after the request was filed. The payment does not depend on
    // it: its budget counter is then left alone (the rules let only a company the service
    // names raise it, firestore.rules → services, paidByRequestDoc).
    const service = req.serviceCategoryId ? await readRequestService(tx, req.serviceCategoryId) : null;
    const countsService = Boolean(service && (service.orgId === req.orgId || (Array.isArray(service.orgIds) && service.orgIds.includes(req.orgId))));
    const provider = req.providerId ? await tx.get<ServiceProvider>(COL.providers, req.providerId) : null;

    // ---------- compute ----------
    const amount = toMoney(req.amount);
    const movement = applyMovement({
      account,
      parent,
      type: isIncome ? 'in' : 'out',
      amount,
      allowOverdraft: false,
      ledgerId: `tx-req-${requestId}`,
      referenceType: 'request',
      referenceId: req.id,
      referenceNumber: req.requestNumber,
      description: isIncome
        ? `توريد وتحصيل للطلب رقم (${req.requestNumber}) - ${req.title}`
        : `صرف وتحويل للطلب رقم (${req.requestNumber}) - ${req.title} - المستلم: ${req.requesterName}`,
      parentDescription: isIncome
        ? `توريد وإيداع بنكي مرتبط تلقائياً عبر (${account.name}) للطلب رقم (${req.requestNumber})`
        : `خصم وتحويل بنكي مرتبط تلقائياً عبر (${account.name}) لصرف الطلب رقم (${req.requestNumber})`,
      actor,
      nowIso,
    });

    const methodLabel = paymentMethodLabel(input.paymentMethod);
    const disbursement: DisbursementDetails & { batchId?: string; operationKey: string } = {
      paymentMethod: input.paymentMethod,
      referenceNumber: input.referenceNumber.trim(),
      bankName: input.bankName || account.name,
      accountId: account.id,
      accountName: account.name,
      receiptUrl: input.receiptUrl,
      notes: input.notes,
      disbursedAt: ts,
      disbursedBy: actor.name,
      batchId: input.batchId,
      operationKey,
    };
    const timeline: TimelineEvent[] = [
      ...(req.timeline || []),
      {
        id: `tl-${operationKey}`,
        status: 'disbursed',
        title: isIncome ? 'تم تأكيد واستلام توريد المبلغ بنجاح' : 'تم تحويل وصرف المبلغ بنجاح',
        description: `${isIncome ? 'طريقة الاستلام' : 'طريقة الصرف'}: ${methodLabel} | رقم العملية/المرجع: ${disbursement.referenceNumber}`,
        actorName: actor.name,
        timestamp: ts,
      },
    ];

    // ---------- writes ----------
    const patch = { status: 'disbursed' as const, disbursement, timeline, updatedAt: nowIso };
    tx.update(COL.requests, requestId, patch);
    movement.write(tx);
    if (service && countsService && !isIncome) {
      // lastDisbursedRequestId: the payment that justifies the increment (firestore.rules → services)
      tx.update(COL.services, service.id, { spentAmount: toMoney(Number(service.spentAmount || 0) + amount), updatedAt: nowIso, lastDisbursedRequestId: requestId });
    }
    if (provider && !isIncome) {
      tx.update(COL.providers, provider.id, { totalPaid: toMoney(Number(provider.totalPaid || 0) + amount), updatedAt: nowIso, lastDisbursedRequestId: requestId });
    }
    writeAudit(
      tx,
      actor,
      {
        actionType: 'update',
        entityType: 'request',
        entityId: requestId,
        entityName: req.requestNumber,
        orgId: req.orgId,
        orgName: notify.org?.name,
        details: `${isIncome ? 'تأكيد توريد' : 'صرف'} الطلب ${req.requestNumber} بمبلغ ${formatAmount(amount)} ${reqCurrency} عبر "${account.name}" (مرجع: ${disbursement.referenceNumber}${input.batchId ? ` | دفعة مجمعة ${input.batchId}` : ''})`,
      },
      // Keyed by the operation (as every other flow): an id derived from the request alone
      // could be pre-created by anyone and would then refuse the payment's audit write.
      auditIdFor(operationKey, 'disburse'),
      nowIso,
    );
    const updated = { ...req, ...patch } as ExpenseRequest;
    const eventId = enqueueOutbox(
      tx,
      buildOutboxEvent({
        eventId: outboxEventId('request_paid', requestId),
        eventType: 'request_paid',
        entityType: 'request',
        entityId: requestId,
        orgId: req.orgId,
        recipients: [req.requesterEmail || ''],
        details: {
          request: updated,
          org: notify.org,
          disbursedVaultName: account.name,
          transactionRef: disbursement.referenceNumber,
          note: input.notes,
          actorName: actor.name,
        },
        settings: notify.settings,
        actor,
        nowIso,
      }),
    );
    return { value: updated, changed: true, outboxEventIds: eventId ? [eventId] : [] };
  });
}

export type { PaymentAccount };
