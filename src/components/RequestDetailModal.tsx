import React, { useState, useEffect, useRef } from 'react';
import { useApp } from '../context/AppContext';
import { ExpenseRequest, PaymentMethod } from '../types';
import {
  X,
  CheckCircle2,
  XCircle,
  HelpCircle,
  CreditCard,
  FileText,
  Send,
  AlertTriangle,
  ArrowDownLeft,
  Landmark,
  Pencil,
  Receipt,
  Eye,
  Upload,
  Loader2
} from 'lucide-react';
import { processAndUploadInvoice } from '../utils/fileUpload';
import { showToast } from '../utils/toast';
import { useKeyedSubmitGuard } from '../hooks/useSubmitGuard';
import { useEscapeToClose } from '../hooks/useEscapeToClose';
import { can } from '../utils/permissions';
import {
  accountBalance,
  accountTypeLabel,
  accountTypeToPaymentMethod,
  accountsForRequest,
  checkRequestCoverage,
  currencyCode,
  fmtMoney,
  formatLocalDate,
  formatLocalDateTime,
  incomeMethodLabel,
  insufficientBalanceMessage,
  paymentMethodLabel,
  pickDisbursementAccount,
  requestPaymentMethodLabel,
  resolveRequestPaymentMethod,
} from '../utils/requestUi';
import { NewRequestModal } from './NewRequestModal';
import { InvoiceViewerModal, InvoiceViewerAttachment } from './InvoiceViewerModal';

/** Largest invoice file accepted here (the same limit as the new-request form). */
const MAX_UPLOAD_MB = 15;

interface RequestDetailModalProps {
  request: ExpenseRequest | null;
  onClose: () => void;
  onEditRequest?: (request: ExpenseRequest) => void;
}

export const RequestDetailModal: React.FC<RequestDetailModalProps> = ({ request, onClose, onEditRequest }) => {
  const { 
    currentRole, 
    currentUser, 
    updateRequest,
    approveRequest, 
    rejectRequest, 
    requestClarification, 
    replyClarification, 
    disburseRequest,
    paymentAccounts,
    resolveParentBankAccount,
    activeOrgId,
    activeOrg
  } = useApp();

  const [isEditing, setIsEditing] = useState(false);
  const [activeAction, setActiveAction] = useState<'none' | 'approve' | 'reject' | 'clarify' | 'reply' | 'disburse'>('none');
  const [previewInvoice, setPreviewInvoice] = useState<InvoiceViewerAttachment | null>(null);

  const isSuperAdmin = currentRole === 'super_admin' || currentUser.role === 'super_admin';
  const canEdit = request ? ((request.status === 'pending' || request.status === 'clarification_requested') &&
    (currentUser.id === request.requesterId || currentUser.email === request.requesterEmail || isSuperAdmin || currentRole === 'org_admin')) : false;

  // Every action is shown only to the roles the domain (and firestore.rules) accept.
  const canApprove = can(currentRole, 'approveRequests');
  const canReject = can(currentRole, 'rejectRequests');
  const canClarify = can(currentRole, 'clarifyRequests');
  const canDisburse = can(currentRole, 'disburseRequests');
  const rootRef = useRef<HTMLDivElement>(null);
  
  // Action form states
  const [approvalNote, setApprovalNote] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');
  const [clarificationQuestion, setClarificationQuestion] = useState('');
  const [replyText, setReplyText] = useState('');
  const [replyAttachment, setReplyAttachment] = useState('');
  // Inline message of the open sub-form (an empty reason / question never fails silently)
  const [actionError, setActionError] = useState<string | null>(null);

  // Disbursement states
  const [disburseAccountId, setDisburseAccountId] = useState<string>('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('bank_transfer');
  const [referenceNumber, setReferenceNumber] = useState('');
  // Optional free text for the payment advice; empty = the selected account's name.
  const [bankName, setBankName] = useState('');
  const [disbursementNotes, setDisbursementNotes] = useState('');
  const [isUploadingInvoice, setIsUploadingInvoice] = useState(false);

  // Per-action submit lock + idempotency key, scoped by `${action}:${requestId}`
  const actionGuard = useKeyedSubmitGuard();

  const handleDirectInvoiceUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !request) return;

    if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
      showToast(`حجم الملف كبير جداً، يرجى اختيار ملف أقل من ${MAX_UPLOAD_MB} ميجابايت`, 'error');
      e.target.value = '';
      return;
    }

    const scope = `invoice:${request.id}`;
    await actionGuard.run(scope, async (idempotencyKey) => {
      setIsUploadingInvoice(true);
      try {
        const targetOrgId = request.orgId || (activeOrgId && activeOrgId !== 'all' ? activeOrgId : '') || activeOrg?.id || '';
        if (!targetOrgId) {
          throw new Error('تعذر تحديد الشركة المرتبطة بهذا الطلب لرفع الملف.');
        }
        const att = await processAndUploadInvoice(file, targetOrgId, request.id);
        const otherAttachments = (request.attachments || []).filter(
          a => !request.invoiceAttachment || a.id !== request.invoiceAttachment.id
        );
        await updateRequest(request.id, {
          invoiceAttachment: att,
          attachments: [att, ...otherAttachments],
        }, { idempotencyKey });
        actionGuard.rotateKey(scope);
      } catch (err: any) {
        console.error('[DirectInvoiceUpload]', err);
        showToast('تعذر إرفاق صورة الفاتورة: ' + (err?.message || 'خطأ غير متوقع'), 'error');
      } finally {
        setIsUploadingInvoice(false);
        e.target.value = '';
      }
    });
  };

  // Sync state when a DIFFERENT request is shown (keyed on the id: live snapshots of the
  // same request must not wipe a half-typed reason/question or regenerate the reference).
  useEffect(() => {
    if (request) {
      // '' = the default account picked below (pickDisbursementAccount), shown selected in the form.
      setDisburseAccountId('');
      setPaymentMethod(resolveRequestPaymentMethod(request));
      setReferenceNumber(
        request.requestType === 'income'
          ? `IN-${Math.floor(100000 + Math.random() * 900000)}`
          : `TXN-${Math.floor(10000000 + Math.random() * 90000000)}`
      );
      setBankName('');
      setDisbursementNotes(request.requestType === 'income' ? `استلام وتوريد لحساب ${request.providerName || ''}`.trim() : '');
      setActiveAction('none');
      setApprovalNote('');
      setRejectionReason('');
      setClarificationQuestion('');
      setReplyText('');
      setReplyAttachment('');
      setActionError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request?.id]);

  // Esc closes this window only when it is the top-most dialog: an invoice preview or
  // the edit form opened from here closes first.
  useEscapeToClose(Boolean(request), onClose, rootRef);

  if (!request) return null;

  const companyAccounts = (paymentAccounts || []).filter(
    a => a.orgId === request?.orgId && a.active !== false
  );
  // Accounts a disbursement / receipt can use: active, this company, the request's currency
  // (the domain refuses any other).
  const eligibleAccounts = accountsForRequest(companyAccounts, request);
  const defaultDisburseAccount = pickDisbursementAccount(eligibleAccounts, request, resolveParentBankAccount);
  const selectedDisburseAccount = eligibleAccounts.find(a => a.id === disburseAccountId) || defaultDisburseAccount;
  const selectedDisburseParent = resolveParentBankAccount(selectedDisburseAccount);
  const isIncome = request.requestType === 'income';
  // No money operation takes an account below zero: the expense disbursement is blocked
  // here already when the chosen account (and the bank behind an InstaPay) cannot cover it.
  const disburseShortfall = !isIncome
    ? insufficientBalanceMessage(selectedDisburseAccount, selectedDisburseParent, request.amount)
    : null;
  const openAction = (action: typeof activeAction) => {
    setActionError(null);
    setActiveAction(activeAction === action ? 'none' : action);
  };
  const selectDisburseAccount = (accountId: string) => {
    setDisburseAccountId(accountId);
    setActionError(null);
    const acc = eligibleAccounts.find(a => a.id === accountId);
    if (acc) {
      setBankName('');
      setPaymentMethod(accountTypeToPaymentMethod(acc.type));
    }
  };
  const isRequester =
    request.requesterId === currentUser.id ||
    Boolean(request.requesterEmail && currentUser.email && request.requesterEmail.toLowerCase() === currentUser.email.toLowerCase());
  // Which actions this viewer really has on the request right now (no empty action bar).
  const incomeActions = isIncome && (request.status === 'pending' || request.status === 'approved') && (canDisburse || canReject);
  const reviewActions = !isIncome && (request.status === 'pending' || request.status === 'clarification_requested') && (canApprove || canClarify || canReject);
  const payAction = !isIncome && request.status === 'approved' && canDisburse;
  const showActions = incomeActions || reviewActions || payAction;

  // Guarded + awaited action: UI is reset / closed only after the call succeeded.
  // On failure the idempotency key is kept so a retry resolves to the same operation.
  const runAction = (action: string, fn: (idempotencyKey: string) => Promise<unknown>) => {
    const scope = `${action}:${request.id}`;
    return actionGuard.run(scope, async (idempotencyKey) => {
      try {
        await fn(idempotencyKey);
        actionGuard.rotateKey(scope);
        setActiveAction('none');
        onClose();
      } catch (err: any) {
        console.error(`[RequestDetailModal] ${action} failed:`, err);
        showToast(err?.message || 'تعذر تنفيذ العملية', 'error');
      }
    });
  };
  const isActionPending = (action: string) => actionGuard.isPending(`${action}:${request.id}`);
  const isSubmitting = isActionPending('disburse');

  const handleApprove = async (e: React.FormEvent) => {
    e.preventDefault();
    await runAction('approve', (idempotencyKey) =>
      approveRequest(request.id, approvalNote.trim() || undefined, { idempotencyKey })
    );
  };

  const handleReject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rejectionReason.trim()) {
      setActionError('يرجى كتابة سبب الرفض ليصل للموظف.');
      return;
    }
    await runAction('reject', (idempotencyKey) =>
      rejectRequest(request.id, rejectionReason.trim(), { idempotencyKey })
    );
  };

  const handleClarify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clarificationQuestion.trim()) {
      setActionError('يرجى كتابة سؤال الاستيضاح أو المستندات المطلوبة من الموظف.');
      return;
    }
    await runAction('clarify', (idempotencyKey) =>
      requestClarification(request.id, clarificationQuestion.trim(), { idempotencyKey })
    );
  };

  const handleReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!replyText.trim()) {
      setActionError('يرجى كتابة ردك على الاستيضاح.');
      return;
    }
    await runAction('reply', (idempotencyKey) =>
      replyClarification(request.id, replyText.trim(), replyAttachment.trim() || undefined, { idempotencyKey })
    );
  };

  const handleDisburse = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!referenceNumber.trim()) {
      setActionError('يرجى إدخال رقم المرجع / العملية.');
      return;
    }
    // The account shown selected in the form is the one paid from (never a different fallback).
    const targetAcc = selectedDisburseAccount;
    if (!targetAcc) {
      setActionError(`لا يوجد حساب خزينة نشط بعملة الطلب (${currencyCode(request.currency)}) في هذه الشركة. يرجى إضافة حساب أو تفعيله أولاً.`);
      return;
    }
    if (disburseShortfall) {
      setActionError(disburseShortfall);
      return;
    }
    setActionError(null);
    await runAction('disburse', async (idempotencyKey) => {
      // changed=false (e.g. 'already_disbursed' / 'duplicate_operation') means it was already paid — not an error.
      await disburseRequest(request.id, {
        paymentMethod,
        referenceNumber: referenceNumber.trim(),
        // The requester sees this on their payment advice: the account's name, never the company's account number.
        bankName: bankName.trim() || targetAcc.name,
        accountId: targetAcc.id,
        accountName: targetAcc.name,
        notes: disbursementNotes.trim() || undefined,
      }, { idempotencyKey });
    });
  };

  return (
    <div 
      ref={rootRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="request-detail-title"
    >
      <div 
        className="bg-white rounded-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto shadow-2xl border border-slate-100 animate-in fade-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        
        {/* Modal Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-100 bg-slate-50/50 sticky top-0 bg-white z-10">
          <div className="flex items-center gap-3 min-w-0">
            <span className="font-mono text-xs font-bold text-slate-500 bg-slate-200 px-2.5 py-1 rounded-lg shrink-0">
              {request.requestNumber}
            </span>
            <h3 id="request-detail-title" className="text-base font-bold text-slate-900 truncate max-w-md">
              {request.title}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق النافذة"
            className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Modal Content */}
        <div className="p-6 space-y-6">
          
          {/* Top Amount & Status Banner */}
          <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl border ${
            request.requestType === 'income' 
              ? 'bg-emerald-50/50 border-emerald-200' 
              : 'bg-slate-50 border-slate-200'
          }`}>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs text-slate-500 font-medium">
                  {request.requestType === 'income' ? 'المبلغ المورد / المحول (+ IN)' : 'المبلغ المطلوب للصرف (- OUT)'}
                </span>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1 ${
                  request.requestType === 'income' 
                    ? 'bg-emerald-100 text-emerald-800' 
                    : 'bg-rose-100 text-rose-800'
                }`}>
                  {request.requestType === 'income' ? (
                    <>
                      <ArrowDownLeft className="h-3 w-3" />
                      <span>توريد وتحصيل وارد (+ IN)</span>
                    </>
                  ) : (
                    <span>💸 طلب صرف مالي</span>
                  )}
                </span>
              </div>
              <div className={`text-3xl font-black mt-0.5 ${request.requestType === 'income' ? 'text-emerald-700' : 'text-slate-900'}`}>
                {request.requestType === 'income' ? '+' : '-'}{fmtMoney(request.amount)} <span className="text-base font-bold text-slate-500">{request.currency}</span>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400">حالة الطلب:</span>
                {request.status === 'pending' && (
                  <span className={`text-xs px-3 py-1 rounded-full font-bold ${
                    request.requestType === 'income' 
                      ? 'bg-amber-100 text-amber-900 border border-amber-300' 
                      : 'bg-amber-100 text-amber-800'
                  }`}>
                    {request.requestType === 'income' ? 'تحت المراجعة وبانتظار الاستلام' : 'قيد مراجعة الإدارة'}
                  </span>
                )}
                {request.status === 'clarification_requested' && (
                  <span className="bg-rose-100 text-rose-800 text-xs px-3 py-1 rounded-full font-bold">
                    مطلوب استيضاح
                  </span>
                )}
                {request.status === 'approved' && (
                  <span className="bg-blue-100 text-blue-800 text-xs px-3 py-1 rounded-full font-bold">
                    {request.requestType === 'income' ? 'معتمد وبانتظار تأكيد الاستلام والتوريد' : 'معتمد وبانتظار الصرف'}
                  </span>
                )}
                {request.status === 'disbursed' && (
                  <span className="bg-emerald-100 text-emerald-800 text-xs px-3 py-1 rounded-full font-bold">
                    {request.requestType === 'income' ? 'تم استلام وتوريد المبلغ في الخزينة ✓' : 'تم الصرف المالي والتحويل ✓'}
                  </span>
                )}
                {request.status === 'rejected' && (
                  <span className="bg-slate-200 text-slate-800 text-xs px-3 py-1 rounded-full font-bold">
                    مرفوض
                  </span>
                )}
              </div>

              {/* Edit Request Button or Non-editable Badge */}
              {canEdit ? (
                <button
                  type="button"
                  onClick={() => {
                    if (onEditRequest) {
                      onEditRequest(request);
                    } else {
                      setIsEditing(true);
                    }
                  }}
                  title="يمكنك تعديل بيانات الطلب طالما لم يتم اعتماده بعد"
                  className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow-xs flex items-center gap-1.5 transition cursor-pointer active:scale-95"
                >
                  <Pencil className="h-3.5 w-3.5" />
                  <span>✏️ تعديل الطلب</span>
                </button>
              ) : (request.status === 'approved' || request.status === 'disbursed') ? (
                <span 
                  title="لا يمكن تعديل الطلب بعد اعتماده أو صرفه"
                  className="px-2.5 py-1 bg-slate-100 text-slate-500 rounded-lg text-[10px] font-semibold flex items-center gap-1 border border-slate-200 cursor-help"
                >
                  🔒 لا يمكن تعديل الطلب بعد اعتماده أو صرفه
                </span>
              ) : null}
            </div>
          </div>

          {/* Key Metadata Section */}
          {request.requestType === 'income' ? (
            /* Inflow Clean Metadata */
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                  <span className="text-slate-400 block mb-1">المسؤول عن التوريد</span>
                  <span className="font-bold text-slate-800">{request.requesterName}</span>
                  <span className="text-[10px] text-slate-400 block">{request.requesterDepartment || 'الإدارة'}</span>
                </div>

                <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                  <span className="text-slate-400 block mb-1">طريقة وشكل التوريد</span>
                  <span className="font-bold text-emerald-700 flex items-center gap-1">
                    {request.preferredPaymentMethod ? incomeMethodLabel(request.preferredPaymentMethod) : '📥 توريد مباشر'}
                  </span>
                </div>

                <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                  <span className="text-slate-400 block mb-1">المودع / بيان التوريد</span>
                  <span className="font-bold text-slate-800 truncate block" title={request.providerName}>
                    {request.providerName && request.providerName !== 'توريدات نقدية عامة' && request.providerName !== 'مورد توريد عام'
                      ? request.providerName
                      : 'توريد مباشر لحساب الشركة'}
                  </span>
                </div>

                <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                  <span className="text-slate-400 block mb-1">تاريخ إنشاء الطلب</span>
                  <span className="font-bold text-slate-800">{formatLocalDate(request.createdAt)}</span>
                </div>
              </div>

              {/* Target Treasury Card Preview with live balance */}
              {(() => {
                // The request's target account, else the account of its method (same rule as the receipt form).
                const targetAcc = defaultDisburseAccount;
                if (!targetAcc) return null;
                return (
                  <div className="p-3.5 bg-emerald-50/70 border border-emerald-200 rounded-xl flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center font-bold text-lg shadow-xs">
                        💳
                      </div>
                      <div>
                        <span className="text-[10px] text-emerald-800 font-bold block">كارت الخزينة المستهدف للتوريد</span>
                        <span className="font-bold text-slate-900 text-xs">{targetAcc.name} ({targetAcc.accountIdentifier})</span>
                      </div>
                    </div>
                    <div className="text-left">
                      <span className="text-[10px] text-slate-500 block">الرصيد الفعلي الحالي بالكارت</span>
                      <span className="font-black text-emerald-700 text-sm font-mono">{fmtMoney(accountBalance(targetAcc))} {currencyCode(targetAcc.currency)}</span>
                    </div>
                  </div>
                );
              })()}

              {request.description && (
                <div>
                  <h4 className="font-bold text-slate-700 text-xs mb-1">بيان وملاحظات التوريد:</h4>
                  <p className="text-slate-700 bg-slate-50 p-3 rounded-xl border border-slate-100 text-xs leading-relaxed">
                    {request.description}
                  </p>
                </div>
              )}
            </div>
          ) : (
            /* Outflow Expense Metadata */
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                  <span className="text-slate-400 block mb-1">طالب الصرف</span>
                  <span className="font-bold text-slate-800">{request.requesterName}</span>
                  <span className="text-[10px] text-slate-400 block">{request.requesterDepartment}</span>
                </div>

                <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                  <span className="text-slate-400 block mb-1">بند الخدمة</span>
                  <span className="font-bold text-slate-800">{request.serviceCategoryName}</span>
                </div>

                <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                  <span className="text-slate-400 block mb-1">مقدم الخدمة / المورد</span>
                  <span className="font-bold text-slate-800">{request.providerName}</span>
                </div>

                <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                  <span className="text-slate-400 block mb-1">تاريخ الطلب</span>
                  <span className="font-bold text-slate-800">{formatLocalDate(request.createdAt)}</span>
                </div>
              </div>

              {/* Description & Justification */}
              <div className="space-y-3 text-xs">
                <div>
                  <h4 className="font-bold text-slate-700 mb-1">التفاصيل والوصف:</h4>
                  <p className="text-slate-600 bg-slate-50 p-3 rounded-xl border border-slate-100 leading-relaxed">
                    {request.description}
                  </p>
                </div>

                <div>
                  <h4 className="font-bold text-slate-700 mb-1">المبرر المالي للطلب:</h4>
                  <p className="text-slate-600 bg-slate-50 p-3 rounded-xl border border-slate-100 leading-relaxed">
                    {request.justification}
                  </p>
                </div>
              </div>

              {/* Payout Details & Beneficiary Information */}
              <div className="bg-slate-50/80 p-3.5 rounded-xl border border-slate-200 text-xs">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <div>
                    <span className="text-slate-400 block text-[10px] mb-0.5">طريقة التحويل المطلوبة:</span>
                    <span className="font-bold text-slate-900">
                      {requestPaymentMethodLabel(request)}
                    </span>
                  </div>

                  <div>
                    <span className="text-slate-400 block text-[10px] mb-0.5">عنوان / رقم حساب المستفيد:</span>
                    <span className="font-mono font-bold text-slate-900">
                      {request.paymentAccountDetails || 'الحساب المسجل لدى الإدارة'}
                    </span>
                  </div>

                  {request.beneficiaryName && (
                    <div>
                      <span className="text-slate-400 block text-[10px] mb-0.5">اسم المستفيد الرباعي (انستاباي):</span>
                      <span className="font-bold text-emerald-800">
                        {request.beneficiaryName}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Installment Device Information */}
              {(request.installmentDeviceType || request.installmentDeviceDescription) && (
                <div className="bg-blue-50/70 border border-blue-200/90 rounded-xl p-3.5 text-xs space-y-1">
                  <span className="font-bold text-blue-950 block mb-1">
                    ⚙️ بيانات ومواصفات الجهاز المقسط له:
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-slate-800">
                    {request.installmentDeviceType && (
                      <div>
                        <span className="text-slate-500 block text-[10px]">نوع وعمل الجهاز:</span>
                        <span className="font-bold text-blue-900">{request.installmentDeviceType}</span>
                      </div>
                    )}
                    {request.installmentDeviceDescription && (
                      <div>
                        <span className="text-slate-500 block text-[10px]">وصف وموديل الجهاز:</span>
                        <span className="font-bold text-slate-900">{request.installmentDeviceDescription}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Goods / Items Details or Visa Details */}
              {request.itemsDetail && (
                <div className="bg-amber-50/70 border border-amber-200/80 rounded-xl p-3.5 text-xs">
                  <span className="font-bold text-amber-900 block mb-1">
                    {request.visaDocumentAttachment || request.title?.includes('تأشير') || request.serviceCategoryName?.includes('تأشير')
                      ? '✈️ نوع التأشيرة وبيانات المسافر:'
                      : '📦 بيانات البضاعة أو الأصناف المرتبطة بالطلب:'}
                  </span>
                  <p className="text-slate-800 font-medium whitespace-pre-wrap">{request.itemsDetail}</p>
                </div>
              )}
            </>
          )}

          {/* Invoice & Personal Prepayment Details Card */}
          {(request.isPrepaidByRequester || request.invoiceNumber || request.invoiceDate || request.invoiceAttachment) && (
            <div className="bg-gradient-to-br from-amber-50/70 via-orange-50/20 to-white border-2 border-amber-200 rounded-2xl p-4 text-xs space-y-3 shadow-2xs">
              <div className="flex items-center justify-between border-b border-amber-100 pb-2">
                <div className="flex items-center gap-2 font-black text-amber-950 text-xs">
                  <Receipt className="h-4 w-4 text-amber-600" />
                  <span>بيانات الفاتورة وإثبات السداد المسبق</span>
                </div>
                {request.isPrepaidByRequester ? (
                  <span className="text-[10px] font-black bg-amber-100 text-amber-900 border border-amber-300 px-2.5 py-0.5 rounded-full">
                    💰 استرداد مصروفات شخصية (دفع مسبق من جيب الموظف)
                  </span>
                ) : (
                  <span className="text-[10px] font-bold bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">
                    سداد مباشر من الشركة
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-slate-700">
                {request.invoiceNumber && (
                  <div className="bg-white/80 p-2.5 rounded-xl border border-amber-100">
                    <span className="text-slate-400 block text-[10px] mb-0.5">رقم الفاتورة / الإيصال:</span>
                    <span className="font-mono font-bold text-slate-900">{request.invoiceNumber}</span>
                  </div>
                )}
                {request.invoiceDate && (
                  <div className="bg-white/80 p-2.5 rounded-xl border border-amber-100">
                    <span className="text-slate-400 block text-[10px] mb-0.5">تاريخ الفاتورة / السداد:</span>
                    <span className="font-bold text-slate-900">{request.invoiceDate}</span>
                  </div>
                )}
                {request.isPrepaidByRequester && (
                  <div className="bg-white/80 p-2.5 rounded-xl border border-amber-100 sm:col-span-1">
                    <span className="text-slate-400 block text-[10px] mb-0.5">طبيعة العملية:</span>
                    <span className="font-bold text-amber-800">استرداد لمقدم الطلب</span>
                  </div>
                )}
              </div>

              {/* Invoice Attachment Preview / Action */}
              {request.invoiceAttachment ? (
                <div className="pt-2 border-t border-amber-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 truncate">
                    {request.invoiceAttachment.url && (request.invoiceAttachment.type === 'png' || request.invoiceAttachment.type === 'jpg' || request.invoiceAttachment.type.startsWith('image/')) ? (
                      <button
                        type="button"
                        onClick={() => setPreviewInvoice({
                          url: request.invoiceAttachment!.url,
                          name: request.invoiceAttachment!.name,
                          size: request.invoiceAttachment!.size,
                          type: request.invoiceAttachment!.type
                        })}
                        className="block shrink-0 cursor-pointer group"
                        title="معاينة الفاتورة بملء الشاشة"
                      >
                        <img 
                          src={request.invoiceAttachment.url} 
                          alt="فاتورة" 
                          className="w-10 h-10 rounded-lg object-cover border border-amber-200 shadow-2xs group-hover:scale-105 group-hover:border-amber-400 transition" 
                        />
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => request.invoiceAttachment?.url && setPreviewInvoice({
                          url: request.invoiceAttachment.url,
                          name: request.invoiceAttachment.name,
                          size: request.invoiceAttachment.size,
                          type: request.invoiceAttachment.type
                        })}
                        className="w-10 h-10 rounded-lg bg-amber-100 hover:bg-amber-200 text-amber-800 flex items-center justify-center font-bold text-xs shrink-0 border border-amber-200 cursor-pointer transition"
                        title="معاينة ملف PDF"
                      >
                        PDF
                      </button>
                    )}
                    <div className="min-w-0">
                      <span className="font-bold text-slate-800 text-xs truncate block max-w-xs">{request.invoiceAttachment.name}</span>
                      <span className="text-[10px] text-slate-400 font-mono">حجم الملف: {request.invoiceAttachment.size}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {request.invoiceAttachment.url && (
                      <button
                        type="button"
                        onClick={() => setPreviewInvoice({
                          url: request.invoiceAttachment!.url,
                          name: request.invoiceAttachment!.name,
                          size: request.invoiceAttachment!.size,
                          type: request.invoiceAttachment!.type
                        })}
                        className="px-3 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-bold transition flex items-center gap-1 shadow-2xs cursor-pointer"
                      >
                        <Eye className="h-3.5 w-3.5" />
                        <span>معاينة الفاتورة</span>
                      </button>
                    )}
                    <label className="cursor-pointer px-2.5 py-1 bg-white hover:bg-amber-50 text-amber-800 border border-amber-200 rounded-lg text-xs font-bold transition flex items-center gap-1">
                      {isUploadingInvoice ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                      <span>تحديث</span>
                      <input
                        type="file"
                        disabled={isUploadingInvoice}
                        accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf"
                        onChange={handleDirectInvoiceUpload}
                        className="hidden"
                      />
                    </label>
                  </div>
                </div>
              ) : (
                <div className="pt-2 border-t border-amber-100 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-slate-500">
                    <FileText className="h-4 w-4 text-amber-600/70 shrink-0" />
                    <span className="text-xs">مستند الفاتورة: لم يتم إرفاق ملف بعد (اختياري)</span>
                  </div>
                  <label className="cursor-pointer px-3 py-1.5 bg-amber-100 hover:bg-amber-200 text-amber-900 rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow-2xs">
                    {isUploadingInvoice ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-800" />
                    ) : (
                      <Upload className="h-3.5 w-3.5 text-amber-800" />
                    )}
                    <span>{isUploadingInvoice ? 'جاري الرفع...' : 'إرفاق صورة الفاتورة الآن'}</span>
                    <input
                      type="file"
                      disabled={isUploadingInvoice}
                      accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf"
                      onChange={handleDirectInvoiceUpload}
                      className="hidden"
                    />
                  </label>
                </div>
              )}
            </div>
          )}

          {/* Dedicated Attachments: Visa Document, Installment Transfer, Wallet Transfer */}
          {(request.visaDocumentAttachment || request.installmentTransferAttachment || request.walletTransferAttachment) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              {/* Visa Document Attachment Card */}
              {request.visaDocumentAttachment && (
                <div className="bg-teal-50/70 border-2 border-teal-200 rounded-2xl p-3.5 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-black text-teal-950 flex items-center gap-1.5 text-xs">
                      <span>✈️ مستند التأشيرة أو جواز السفر</span>
                    </span>
                    <span className="text-[10px] bg-teal-100 text-teal-800 font-bold px-2 py-0.5 rounded-full">
                      مستند تأشيرة
                    </span>
                  </div>

                  <div className="flex items-center justify-between gap-2 pt-1 border-t border-teal-100">
                    <div className="flex items-center gap-2 truncate">
                      {request.visaDocumentAttachment.url && (request.visaDocumentAttachment.type === 'png' || request.visaDocumentAttachment.type === 'jpg' || request.visaDocumentAttachment.type?.startsWith('image/')) ? (
                        <button
                          type="button"
                          onClick={() => setPreviewInvoice({
                            url: request.visaDocumentAttachment!.url,
                            name: request.visaDocumentAttachment!.name,
                            size: request.visaDocumentAttachment!.size,
                            type: request.visaDocumentAttachment!.type,
                          })}
                          className="cursor-pointer shrink-0"
                          title="معاينة المستند"
                        >
                          <img src={request.visaDocumentAttachment.url} alt="تأشيرة" className="w-10 h-10 rounded-lg object-cover border border-teal-300 shadow-2xs" />
                        </button>
                      ) : (
                        <div className="w-10 h-10 rounded-lg bg-teal-100 text-teal-800 font-bold text-xs flex items-center justify-center border border-teal-200 shrink-0">
                          PDF
                        </div>
                      )}
                      <div className="truncate">
                        <span className="font-bold text-slate-800 truncate block text-xs">{request.visaDocumentAttachment.name}</span>
                        <span className="text-[10px] text-slate-400 font-mono">{request.visaDocumentAttachment.size}</span>
                      </div>
                    </div>

                    {request.visaDocumentAttachment.url && (
                      <button
                        type="button"
                        onClick={() => setPreviewInvoice({
                          url: request.visaDocumentAttachment!.url,
                          name: request.visaDocumentAttachment!.name,
                          size: request.visaDocumentAttachment!.size,
                          type: request.visaDocumentAttachment!.type,
                        })}
                        className="px-2.5 py-1 bg-teal-700 hover:bg-teal-800 text-white rounded-lg text-xs font-bold transition flex items-center gap-1 shadow-2xs cursor-pointer shrink-0"
                      >
                        <Eye className="h-3.5 w-3.5" />
                        <span>معاينة</span>
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Installment Transfer Screenshot Card */}
              {request.installmentTransferAttachment && (
                <div className="bg-blue-50/70 border-2 border-blue-200 rounded-2xl p-3.5 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-black text-blue-950 flex items-center gap-1.5 text-xs">
                      <span>📅 سكرين شوت تحويل أو إثبات سداد القسط (انستاباي / سداد بنكي)</span>
                    </span>
                    <span className="text-[10px] bg-blue-100 text-blue-800 font-bold px-2 py-0.5 rounded-full">
                      سداد بنكي / انستاباي
                    </span>
                  </div>

                  <div className="flex items-center justify-between gap-2 pt-1 border-t border-blue-100">
                    <div className="flex items-center gap-2 truncate">
                      {request.installmentTransferAttachment.url && (request.installmentTransferAttachment.type === 'png' || request.installmentTransferAttachment.type === 'jpg' || request.installmentTransferAttachment.type?.startsWith('image/')) ? (
                        <button
                          type="button"
                          onClick={() => setPreviewInvoice({
                            url: request.installmentTransferAttachment!.url,
                            name: request.installmentTransferAttachment!.name,
                            size: request.installmentTransferAttachment!.size,
                            type: request.installmentTransferAttachment!.type,
                          })}
                          className="cursor-pointer shrink-0"
                          title="معاينة السكرين"
                        >
                          <img src={request.installmentTransferAttachment.url} alt="قسط" className="w-10 h-10 rounded-lg object-cover border border-blue-300 shadow-2xs" />
                        </button>
                      ) : (
                        <div className="w-10 h-10 rounded-lg bg-blue-100 text-blue-800 font-bold text-xs flex items-center justify-center border border-blue-200 shrink-0">
                          PDF
                        </div>
                      )}
                      <div className="truncate">
                        <span className="font-bold text-slate-800 truncate block text-xs">{request.installmentTransferAttachment.name}</span>
                        <span className="text-[10px] text-slate-400 font-mono">{request.installmentTransferAttachment.size}</span>
                      </div>
                    </div>

                    {request.installmentTransferAttachment.url && (
                      <button
                        type="button"
                        onClick={() => setPreviewInvoice({
                          url: request.installmentTransferAttachment!.url,
                          name: request.installmentTransferAttachment!.name,
                          size: request.installmentTransferAttachment!.size,
                          type: request.installmentTransferAttachment!.type,
                        })}
                        className="px-2.5 py-1 bg-blue-700 hover:bg-blue-800 text-white rounded-lg text-xs font-bold transition flex items-center gap-1 shadow-2xs cursor-pointer shrink-0"
                      >
                        <Eye className="h-3.5 w-3.5" />
                        <span>معاينة</span>
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Wallet Top-up Screenshot Card */}
              {request.walletTransferAttachment && (
                <div className="bg-purple-50/70 border-2 border-purple-200 rounded-2xl p-3.5 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-black text-purple-950 flex items-center gap-1.5 text-xs">
                      <span>⚡ سكرين شحن وتحويل المحفظة</span>
                    </span>
                    <span className="text-[10px] bg-purple-100 text-purple-800 font-bold px-2 py-0.5 rounded-full">
                      شحن محفظة
                    </span>
                  </div>

                  <div className="flex items-center justify-between gap-2 pt-1 border-t border-purple-100">
                    <div className="flex items-center gap-2 truncate">
                      {request.walletTransferAttachment.url && (request.walletTransferAttachment.type === 'png' || request.walletTransferAttachment.type === 'jpg' || request.walletTransferAttachment.type?.startsWith('image/')) ? (
                        <button
                          type="button"
                          onClick={() => setPreviewInvoice({
                            url: request.walletTransferAttachment!.url,
                            name: request.walletTransferAttachment!.name,
                            size: request.walletTransferAttachment!.size,
                            type: request.walletTransferAttachment!.type,
                          })}
                          className="cursor-pointer shrink-0"
                          title="معاينة السكرين"
                        >
                          <img src={request.walletTransferAttachment.url} alt="محفظة" className="w-10 h-10 rounded-lg object-cover border border-purple-300 shadow-2xs" />
                        </button>
                      ) : (
                        <div className="w-10 h-10 rounded-lg bg-purple-100 text-purple-800 font-bold text-xs flex items-center justify-center border border-purple-200 shrink-0">
                          PDF
                        </div>
                      )}
                      <div className="truncate">
                        <span className="font-bold text-slate-800 truncate block text-xs">{request.walletTransferAttachment.name}</span>
                        <span className="text-[10px] text-slate-400 font-mono">{request.walletTransferAttachment.size}</span>
                      </div>
                    </div>

                    {request.walletTransferAttachment.url && (
                      <button
                        type="button"
                        onClick={() => setPreviewInvoice({
                          url: request.walletTransferAttachment!.url,
                          name: request.walletTransferAttachment!.name,
                          size: request.walletTransferAttachment!.size,
                          type: request.walletTransferAttachment!.type,
                        })}
                        className="px-2.5 py-1 bg-purple-700 hover:bg-purple-800 text-white rounded-lg text-xs font-bold transition flex items-center gap-1 shadow-2xs cursor-pointer shrink-0"
                      >
                        <Eye className="h-3.5 w-3.5" />
                        <span>معاينة</span>
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Attachments (Only shown if authentic non-dummy attachments exist) */}
          {(() => {
            const realAttachments = (request.attachments || []).filter(att => 
              att && att.name && 
              !String(att.name).includes('فاتورة_عرض_سعر') && 
              String(att.name).trim() !== 'fdvbgfbgfb' &&
              String(att.name).trim().length > 0
            );
            if (realAttachments.length === 0) return null;
            return (
              <div>
                <h4 className="font-bold text-slate-700 text-xs mb-2">المرفقات والفواتير ({realAttachments.length})</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {realAttachments.map((att) => (
                    <div 
                      key={att.id} 
                      className={`flex items-center justify-between p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs transition ${
                        att.url ? 'hover:border-emerald-300 hover:bg-emerald-50/40 cursor-pointer' : ''
                      }`}
                      onClick={() => {
                        if (att.url) {
                          setPreviewInvoice({
                            url: att.url,
                            name: att.name,
                            size: att.size,
                            type: att.type,
                          });
                        }
                      }}
                    >
                      <div className="flex items-center gap-2 truncate min-w-0">
                        <FileText className="h-4 w-4 text-emerald-600 shrink-0" />
                        <span className="font-medium text-slate-800 truncate" title={att.name}>{att.name}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-slate-400 text-[10px]">{att.size}</span>
                        {att.url && (
                          <span className="text-emerald-700 bg-emerald-100 p-1 rounded hover:bg-emerald-200 transition" title="معاينة الملف">
                            <Eye className="h-3.5 w-3.5" />
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* Disbursement Receipt (if disbursed) */}
          {request.status === 'disbursed' && request.disbursement && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-xs space-y-2">
              <div className="flex items-center gap-2 font-bold text-emerald-900">
                <CreditCard className="h-4 w-4 text-emerald-600" />
                <span>
                  {request.requestType === 'income' 
                    ? 'بيانات استلام وتوريد المبلغ المكتملة في الخزينة' 
                    : 'بيانات الصرف المالي المكتمل'}
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-1 text-slate-700">
                <div>طريقة الدفع / التوريد: <span className="font-bold">
                  {isIncome ? incomeMethodLabel(request.disbursement.paymentMethod) : paymentMethodLabel(request.disbursement.paymentMethod)}
                </span></div>
                <div>رقم المرجع: <span className="font-mono font-bold">{request.disbursement.referenceNumber}</span></div>
                <div>تاريخ العملية: <span className="font-bold">{formatLocalDateTime(request.disbursement.disbursedAt)}</span></div>
                {(request.disbursement.accountName || request.disbursement.bankName) && (
                  <div className="col-span-2 sm:col-span-3">الحساب: <span className="font-bold">{request.disbursement.accountName || request.disbursement.bankName}</span></div>
                )}
              </div>
            </div>
          )}

          {/* Rejection Info */}
          {request.status === 'rejected' && (
            <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 text-xs text-rose-900">
              <span className="font-bold block mb-1">تم رفض الطلب:</span>
              <p>{request.rejectionReason}</p>
            </div>
          )}

          {/* Clarification Box / History */}
          {request.comments.length > 0 && (
            <div className="space-y-2">
              <h4 className="font-bold text-slate-700 text-xs">سجل الملاحظات والاستيضاحات:</h4>
              <div className="space-y-2">
                {request.comments.map((comm) => (
                  <div 
                    key={comm.id} 
                    className={`p-3 rounded-xl border text-xs ${
                      comm.type === 'clarification_request'
                        ? 'bg-rose-50 border-rose-200 text-rose-900'
                        : 'bg-blue-50 border-blue-200 text-blue-900'
                    }`}
                  >
                    <div className="flex items-center justify-between font-bold mb-1 text-[11px]">
                      <span>{comm.authorName}</span>
                      <span className="text-slate-400 font-normal">{formatLocalDateTime(comm.createdAt)}</span>
                    </div>
                    <p>{comm.content}</p>
                    {comm.attachmentName && (
                      <span className="text-[10px] bg-white/80 px-2 py-0.5 rounded mt-1 inline-block border border-slate-200">
                        مرفق إضافي: {comm.attachmentName}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ACTION FORMS — each action only for the roles the domain accepts (src/utils/permissions.ts);
              the section is not rendered at all when this viewer has nothing to do on the request. */}
          {showActions && (
            <div className="pt-4 border-t border-slate-100">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="text-xs font-bold text-slate-500">
                  {isIncome ? 'إجراءات استلام وتوريد المبلغ في الخزينة:' : 'إجراءات الاعتماد والصرف المالي:'}
                </span>

                <div className="flex items-center gap-2 flex-wrap">
                  {/* For Income Requests: Direct Receipt or Reject */}
                  {incomeActions && (
                    <>
                      {canDisburse && (
                        <button
                          type="button"
                          onClick={() => openAction('disburse')}
                          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-xs flex items-center gap-1.5 transition cursor-pointer"
                        >
                          <ArrowDownLeft className="h-4 w-4" />
                          <span>📥 تأكيد الاستلام والتوريد في الخزينة (تم الاستلام)</span>
                        </button>
                      )}

                      {canReject && (
                        <button
                          type="button"
                          onClick={() => openAction('reject')}
                          className="px-3.5 py-2 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs rounded-xl shadow-xs flex items-center gap-1.5 transition cursor-pointer"
                        >
                          <XCircle className="h-4 w-4" />
                          <span>رفض التوريد</span>
                        </button>
                      )}
                    </>
                  )}

                  {/* For Expense Requests under review */}
                  {reviewActions && (
                    <>
                      {canApprove && (
                        <button
                          type="button"
                          onClick={() => openAction('approve')}
                          className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-xs flex items-center gap-1.5 transition cursor-pointer"
                        >
                          <CheckCircle2 className="h-4 w-4" />
                          <span>اعتماد الطلب</span>
                        </button>
                      )}

                      {canClarify && (
                        <button
                          type="button"
                          onClick={() => openAction('clarify')}
                          className="px-3.5 py-2 bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs rounded-xl shadow-xs flex items-center gap-1.5 transition cursor-pointer"
                        >
                          <HelpCircle className="h-4 w-4" />
                          <span>طلب توضيح أكثر</span>
                        </button>
                      )}

                      {canReject && (
                        <button
                          type="button"
                          onClick={() => openAction('reject')}
                          className="px-3.5 py-2 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs rounded-xl shadow-xs flex items-center gap-1.5 transition cursor-pointer"
                        >
                          <XCircle className="h-4 w-4" />
                          <span>رفض الطلب</span>
                        </button>
                      )}
                    </>
                  )}

                  {payAction && (
                    <button
                      type="button"
                      onClick={() => openAction('disburse')}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-xs flex items-center gap-1.5 transition cursor-pointer"
                    >
                      <CreditCard className="h-4 w-4" />
                      <span>تسجيل وتنفيذ الصرف المالي</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Sub-form: Approve Form — with Treasury Balance Alert */}
              {activeAction === 'approve' && canApprove && (
                <form onSubmit={handleApprove} className="mt-4 p-4 bg-emerald-50/70 border border-emerald-200 rounded-xl space-y-3">
                  <h5 className="font-bold text-emerald-900 text-xs">تأكيد اعتماد الطلب بمبلغ {fmtMoney(request.amount)} {currencyCode(request.currency)}</h5>

                  {/* Treasury balance check: can the company actually pay this? One disbursement is
                      paid from ONE account, and an InstaPay channel pays with its linked bank's money. */}
                  {!isIncome && (() => {
                    const cover = checkRequestCoverage(eligibleAccounts, request, resolveParentBankAccount);
                    const cur = currencyCode(request.currency);
                    const matchingName = cover.matching?.name || `حساب ${paymentMethodLabel(resolveRequestPaymentMethod(request))}`;
                    const tone =
                      cover.level === 'ok'
                        ? 'bg-teal-50 border-teal-200 text-teal-900'
                        : cover.level === 'other'
                        ? 'bg-amber-50 border-amber-300 text-amber-900'
                        : 'bg-rose-50 border-rose-300 text-rose-900';
                    const iconTone = cover.level === 'ok' ? 'text-teal-600' : cover.level === 'other' ? 'text-amber-600' : 'text-rose-600';
                    return (
                      <div className={`p-3 rounded-xl border text-xs flex items-start gap-2.5 ${tone}`}>
                        <AlertTriangle className={`h-4 w-4 shrink-0 mt-0.5 ${iconTone}`} />
                        <div className="space-y-1 min-w-0">
                          <div className="font-bold">
                            {cover.level === 'ok'
                              ? `✅ رصيد "${matchingName}" يكفي لتنفيذ هذا الصرف`
                              : cover.level === 'other'
                              ? `رصيد "${matchingName}" لا يكفي لهذا المبلغ، ويمكن الصرف من "${cover.best?.name}"`
                              : eligibleAccounts.length === 0
                              ? `⚠️ لا يوجد حساب خزينة نشط بعملة الطلب (${cur}) في هذه الشركة`
                              : `⚠️ لا يوجد حساب بعملة ${cur} يكفي رصيده لتنفيذ هذا الصرف`}
                          </div>
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
                            {cover.matching && (
                              <span>رصيد {cover.matching.name}: <strong>{fmtMoney(accountBalance(cover.matching))} {cur}</strong></span>
                            )}
                            {cover.matchingLinkedBank && (
                              <span>البنك المرتبط ({cover.matchingLinkedBank.name}): <strong>{fmtMoney(accountBalance(cover.matchingLinkedBank))} {cur}</strong></span>
                            )}
                            {cover.level === 'other' && cover.best && (
                              <span>المتاح في {cover.best.name}: <strong>{fmtMoney(cover.bestSpendable)} {cur}</strong></span>
                            )}
                            <span>المبلغ المطلوب: <strong>{fmtMoney(request.amount)} {cur}</strong></span>
                          </div>
                          {cover.level === 'none' && (
                            <div className="text-[11px] font-bold text-rose-700 mt-1">
                              يمكنك الاعتماد الآن، لكن الصرف لن يتم حتى يُودَع المبلغ في أحد الحسابات أولاً (لا يُسمح بأن يصبح رصيد أي حساب بالسالب).
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })()}

                  <input
                    type="text"
                    value={approvalNote}
                    onChange={(e) => setApprovalNote(e.target.value)}
                    placeholder="ملاحظات الاعتماد (اختياري)..."
                    className="w-full p-2.5 bg-white border border-emerald-200 rounded-lg text-xs"
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setActiveAction('none')}
                      className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded-lg"
                    >
                      إلغاء
                    </button>
                    <button
                      type="submit"
                      disabled={isActionPending('approve')}
                      className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-lg disabled:opacity-60"
                    >
                      {isActionPending('approve') ? 'جاري الاعتماد...' : 'تأكيد الاعتماد'}
                    </button>
                  </div>
                </form>
              )}

              {/* Sub-form: Clarify Form */}
              {activeAction === 'clarify' && canClarify && (
                <form onSubmit={handleClarify} className="mt-4 p-4 bg-amber-50/70 border border-amber-200 rounded-xl space-y-3">
                  <h5 className="font-bold text-amber-900 text-xs">طلب استفسار وتوضيح من طالب الصرف ({request.requesterName})</h5>
                  <textarea
                    rows={3}
                    required
                    value={clarificationQuestion}
                    onChange={(e) => {
                      setClarificationQuestion(e.target.value);
                      if (actionError) setActionError(null);
                    }}
                    placeholder="اكتب التساؤل المطلوب من الموظف توضيحه أو المستندات المطلوبة..."
                    className="w-full p-2.5 bg-white border border-amber-300 rounded-lg text-xs"
                  />
                  {actionError && (
                    <p role="alert" className="text-[11px] font-bold text-rose-700">⚠️ {actionError}</p>
                  )}
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setActiveAction('none')}
                      className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded-lg"
                    >
                      إلغاء
                    </button>
                    <button
                      type="submit"
                      disabled={isActionPending('clarify')}
                      className="px-4 py-1.5 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs rounded-lg disabled:opacity-60"
                    >
                      {isActionPending('clarify') ? 'جاري الإرسال...' : 'إرسال الاستفسار للموظف'}
                    </button>
                  </div>
                </form>
              )}

              {/* Sub-form: Reject Form */}
              {activeAction === 'reject' && canReject && (
                <form onSubmit={handleReject} className="mt-4 p-4 bg-rose-50/70 border border-rose-200 rounded-xl space-y-3">
                  <h5 className="font-bold text-rose-900 text-xs">{isIncome ? 'رفض التوريد' : 'رفض الطلب'}</h5>
                  <textarea
                    rows={2}
                    required
                    value={rejectionReason}
                    onChange={(e) => {
                      setRejectionReason(e.target.value);
                      if (actionError) setActionError(null);
                    }}
                    placeholder="اذكر سبب الرفض لتوضيحه للموظف..."
                    className="w-full p-2.5 bg-white border border-rose-300 rounded-lg text-xs"
                  />
                  {actionError && (
                    <p role="alert" className="text-[11px] font-bold text-rose-700">⚠️ {actionError}</p>
                  )}
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setActiveAction('none')}
                      className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded-lg"
                    >
                      إلغاء
                    </button>
                    <button
                      type="submit"
                      disabled={isActionPending('reject')}
                      className="px-4 py-1.5 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs rounded-lg disabled:opacity-60"
                    >
                      {isActionPending('reject') ? 'جاري الرفض...' : 'تأكيد الرفض'}
                    </button>
                  </div>
                </form>
              )}

              {/* Sub-form: Disburse / Receipt Form */}
              {activeAction === 'disburse' && canDisburse && (
                <form onSubmit={handleDisburse} className={`mt-4 p-4 border rounded-xl space-y-3 ${
                  isIncome ? 'bg-emerald-50/80 border-emerald-300' : 'bg-blue-50/70 border-blue-200'
                }`}>
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <h5 className={`font-black text-xs flex items-center gap-1.5 ${
                      isIncome ? 'text-emerald-900' : 'text-blue-900'
                    }`}>
                      {isIncome ? (
                        <>
                          <ArrowDownLeft className="h-4 w-4 text-emerald-600" />
                          <span>📥 تأكيد استلام المبلغ وتوريده في الرصيد (+ IN)</span>
                        </>
                      ) : (
                        <span>توثيق وتسجيل الصرف المالي الفعلي</span>
                      )}
                    </h5>
                    <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-white border border-slate-200">
                      المبلغ: {fmtMoney(request.amount)} {currencyCode(request.currency)}
                    </span>
                  </div>

                  {/* Account selection: only this company's active accounts in the request's currency */}
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">
                      {isIncome ? 'حساب الخزينة / الكارت المستلم للرصيد:' : 'حساب / خزينة الصرف المحول منه (- OUT):'}
                    </label>
                    {eligibleAccounts.length === 0 ? (
                      <div role="alert" className="p-2.5 bg-rose-50 border border-rose-200 rounded-lg text-rose-800 text-[11px] font-bold">
                        لا يوجد حساب خزينة نشط بعملة الطلب ({currencyCode(request.currency)}) في هذه الشركة. يرجى إضافة حساب أو تفعيله من شاشة الخزينة أولاً.
                      </div>
                    ) : (
                      <select
                        value={selectedDisburseAccount?.id || ''}
                        onChange={(e) => selectDisburseAccount(e.target.value)}
                        className={`w-full p-2.5 bg-white border rounded-lg text-xs font-bold ${
                          isIncome ? 'border-emerald-300' : disburseShortfall ? 'border-rose-400' : 'border-slate-200'
                        }`}
                      >
                        {eligibleAccounts.map(acc => (
                          <option key={acc.id} value={acc.id}>
                            {acc.name} — {accountTypeLabel(acc.type)} ({acc.accountIdentifier}) — الرصيد: {fmtMoney(accountBalance(acc))} {currencyCode(acc.currency)}
                          </option>
                        ))}
                      </select>
                    )}
                    {selectedDisburseAccount && selectedDisburseParent && (
                      <div className="mt-1.5 p-2 bg-blue-50 border border-blue-200 rounded-lg text-blue-900 text-[11px] flex items-start gap-1.5">
                        <Landmark className="h-3.5 w-3.5 text-blue-600 shrink-0 mt-0.5" />
                        <div>
                          <span className="font-bold block">{isIncome ? 'إيداع بنكي مزدوج تلقائي:' : 'خصم بنكي مزدوج تلقائي:'}</span>
                          <span className="text-[10.5px] text-blue-800 leading-relaxed">
                            {isIncome
                              ? <>حساب ({selectedDisburseAccount.name}) مربوط بالحساب البنكي (<strong>{selectedDisburseParent.name}</strong>). سيتم إضافة المبلغ في الحسابين تلقائياً.</>
                              : <>حساب ({selectedDisburseAccount.name}) مربوط بالحساب البنكي (<strong>{selectedDisburseParent.name}</strong> — رصيده {fmtMoney(accountBalance(selectedDisburseParent))} {currencyCode(selectedDisburseParent.currency)}). سيتم خصم مبلغ الصرف تلقائياً من هذا الحساب ومن الحساب البنكي معاً، ويجب أن يكفي رصيد الاثنين.</>}
                          </span>
                        </div>
                      </div>
                    )}
                    {disburseShortfall && (
                      <div role="alert" className="mt-1.5 p-2 bg-rose-50 border border-rose-200 rounded-lg text-rose-800 text-[11px] font-bold flex items-start gap-1.5">
                        <AlertTriangle className="h-3.5 w-3.5 text-rose-600 shrink-0 mt-0.5" />
                        <span>{disburseShortfall}</span>
                      </div>
                    )}
                  </div>

                  {isIncome ? (
                    <>
                      <div>
                        <label className="block text-[11px] font-bold text-slate-700 mb-1">
                          رقم إيصال / مرجع التوريد:
                        </label>
                        <input
                          type="text"
                          required
                          value={referenceNumber}
                          onChange={(e) => setReferenceNumber(e.target.value)}
                          className="w-full p-2.5 bg-white border border-emerald-300 rounded-lg text-xs font-mono font-bold"
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] font-bold text-slate-700 mb-1">
                          بيان / ملاحظات التوريد:
                        </label>
                        <input
                          type="text"
                          value={disbursementNotes}
                          onChange={(e) => setDisbursementNotes(e.target.value)}
                          placeholder="مثال: تم التأكد من وصول الحوالة في الحساب البنكي..."
                          className="w-full p-2.5 bg-white border border-emerald-200 rounded-lg text-xs"
                        />
                      </div>
                    </>
                  ) : (
                    /* Expense disburse details */
                    <>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div>
                          <label className="block text-[11px] font-bold text-slate-600 mb-1">طريقة الدفع:</label>
                          <select
                            value={paymentMethod}
                            onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                            className="w-full p-2 bg-white border border-slate-200 rounded-lg text-xs font-semibold"
                          >
                            <option value="bank_transfer">تحويل بنكي</option>
                            <option value="instapay">إنستاباي</option>
                            <option value="digital_wallet">محفظة إلكترونية</option>
                            <option value="cash">نقداً / خزينة</option>
                            <option value="cheque">شيك مصرفي</option>
                          </select>
                        </div>

                        <div>
                          <label className="block text-[11px] font-bold text-slate-600 mb-1">رقم المرجع / الحوالة:</label>
                          <input
                            type="text"
                            required
                            value={referenceNumber}
                            onChange={(e) => setReferenceNumber(e.target.value)}
                            className="w-full p-2 bg-white border border-slate-200 rounded-lg text-xs font-mono font-bold"
                          />
                        </div>

                        <div>
                          <label className="block text-[11px] font-bold text-slate-600 mb-1">اسم البنك / الحساب:</label>
                          <input
                            type="text"
                            value={bankName}
                            onChange={(e) => setBankName(e.target.value)}
                            placeholder={selectedDisburseAccount ? `${selectedDisburseAccount.name} (${selectedDisburseAccount.accountIdentifier})` : ''}
                            className="w-full p-2 bg-white border border-slate-200 rounded-lg text-xs"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block text-[11px] font-bold text-slate-600 mb-1">ملاحظات إضافية:</label>
                        <input
                          type="text"
                          value={disbursementNotes}
                          onChange={(e) => setDisbursementNotes(e.target.value)}
                          placeholder="مثل: تم التحويل إلى حساب المورد المعتمد..."
                          className="w-full p-2 bg-white border border-slate-200 rounded-lg text-xs"
                        />
                      </div>
                    </>
                  )}

                  {actionError && actionError !== disburseShortfall && (
                    <p role="alert" className="text-[11px] font-bold text-rose-700">⚠️ {actionError}</p>
                  )}

                  <div className="flex justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setActiveAction('none')}
                      className="px-3.5 py-2 text-xs text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer"
                    >
                      إلغاء
                    </button>
                    <button
                      type="submit"
                      disabled={isSubmitting || !selectedDisburseAccount || Boolean(disburseShortfall)}
                      title={disburseShortfall || undefined}
                      className={`px-5 py-2 text-white font-black text-xs rounded-xl shadow-sm flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                        isIncome ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-blue-600 hover:bg-blue-700'
                      }`}
                    >
                      {isIncome ? (
                        <>
                          <CheckCircle2 className="h-4 w-4" />
                          <span>{isSubmitting ? 'جارٍ توريد المبلغ...' : `✓ تأكيد الاستلام والتوريد في الرصيد الآن (+ ${fmtMoney(request.amount)} ${currencyCode(request.currency)})`}</span>
                        </>
                      ) : (
                        <span>{isSubmitting ? 'جارٍ تسجيل الصرف...' : 'تأكيد الصرف وإغلاق الطلب'}</span>
                      )}
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}

          {/* Requester Action: Reply if clarification requested (the domain accepts only the requester) */}
          {isRequester && request.status === 'clarification_requested' && (
            <div className="pt-4 border-t border-slate-100">
              <form onSubmit={handleReply} className="p-4 bg-rose-50/70 border border-rose-300 rounded-xl space-y-3">
                <h5 className="font-bold text-rose-900 text-xs">الرد على طلب التوضيح وتقديم المستندات:</h5>
                <textarea
                  rows={2}
                  required
                  value={replyText}
                  onChange={(e) => {
                    setReplyText(e.target.value);
                    if (actionError) setActionError(null);
                  }}
                  placeholder="اكتب ردك وتوضيحك لمدير المؤسسة..."
                  className="w-full p-2.5 bg-white border border-rose-300 rounded-lg text-xs"
                />
                <input
                  type="text"
                  value={replyAttachment}
                  onChange={(e) => setReplyAttachment(e.target.value)}
                  placeholder="اسم الملف المرفق الإضافي (اختياري)..."
                  className="w-full p-2 bg-white border border-slate-200 rounded-lg text-xs"
                />
                {canEdit && (
                  <p className="text-[11px] text-rose-800">
                    لإرفاق المستند المطلوب نفسه (مثل عرض السعر أو الفاتورة) استخدم زر «✏️ تعديل الطلب» أعلاه وأضفه للطلب، ثم أرسل ردك.
                  </p>
                )}
                {actionError && (
                  <p role="alert" className="text-[11px] font-bold text-rose-700">⚠️ {actionError}</p>
                )}
                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={isActionPending('reply')}
                    className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs rounded-xl shadow-xs flex items-center gap-1.5 disabled:opacity-60"
                  >
                    <Send className="h-3.5 w-3.5" />
                    <span>{isActionPending('reply') ? 'جاري إرسال الرد...' : 'إرسال الرد للمدير'}</span>
                  </button>
                </div>
              </form>
            </div>
          )}

        </div>

      </div>

      {/* Edit Request Modal */}
      {isEditing && request && (
        <NewRequestModal
          isOpen={isEditing}
          onClose={() => setIsEditing(false)}
          editingRequest={request}
        />
      )}

      {/* Invoice and Document Full-Screen In-App Lightbox Viewer */}
      {previewInvoice && (
        <InvoiceViewerModal
          attachment={previewInvoice}
          onClose={() => setPreviewInvoice(null)}
        />
      )}
    </div>
  );
};
