import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { ExpenseRequest, PaymentMethod, PaymentAccount, PaymentAccountType } from '../types';
import { 
  X, 
  CheckCircle2, 
  XCircle, 
  HelpCircle, 
  CreditCard, 
  Clock, 
  Paperclip, 
  FileText, 
  Send,
  Building,
  User as UserIcon,
  Tag,
  AlertTriangle,
  ArrowDownLeft,
  Landmark,
  Smartphone,
  Wallet,
  Coins,
  Pencil,
  Receipt,
  Eye,
  Upload,
  Loader2
} from 'lucide-react';
import { processAndUploadInvoice } from '../utils/fileUpload';
import { NewRequestModal } from './NewRequestModal';

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
    resolveParentBankAccount
  } = useApp();

  const [isEditing, setIsEditing] = useState(false);
  const [activeAction, setActiveAction] = useState<'none' | 'approve' | 'reject' | 'clarify' | 'reply' | 'disburse'>('none');

  const isSuperAdmin = currentRole === 'super_admin' || currentUser.role === 'super_admin';
  const canEdit = request ? ((request.status === 'pending' || request.status === 'clarification_requested') &&
    (currentUser.id === request.requesterId || currentUser.email === request.requesterEmail || isSuperAdmin || currentRole === 'org_admin')) : false;
  
  // Action form states
  const [approvalNote, setApprovalNote] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');
  const [clarificationQuestion, setClarificationQuestion] = useState('');
  const [replyText, setReplyText] = useState('');
  const [replyAttachment, setReplyAttachment] = useState('');

  // Disbursement states
  const [disburseAccountId, setDisburseAccountId] = useState<string>('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('bank_transfer');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [bankName, setBankName] = useState('المصرف الرئيسي');
  const [disbursementNotes, setDisbursementNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUploadingInvoice, setIsUploadingInvoice] = useState(false);

  const handleDirectInvoiceUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !request) return;

    if (file.size > 15 * 1024 * 1024) {
      alert('حجم الملف كبير جداً، يرجى اختيار ملف أقل من 15 ميجابايت');
      return;
    }

    setIsUploadingInvoice(true);
    try {
      const att = await processAndUploadInvoice(file, request.orgId || 'org-main', request.id);
      const otherAttachments = (request.attachments || []).filter(
        a => !request.invoiceAttachment || a.id !== request.invoiceAttachment.id
      );
      await updateRequest(request.id, {
        invoiceAttachment: att,
        attachments: [att, ...otherAttachments],
      });
    } catch (err: any) {
      console.error('[DirectInvoiceUpload]', err);
      alert('تعذر إرفاق صورة الفاتورة: ' + (err?.message || 'خطأ غير متوقع'));
    } finally {
      setIsUploadingInvoice(false);
      e.target.value = '';
    }
  };

  // Sync state whenever request changes
  useEffect(() => {
    if (request) {
      setDisburseAccountId(request.targetAccountId || '');
      setPaymentMethod(request.preferredPaymentMethod || (request.requestType === 'income' ? 'instapay' : 'bank_transfer'));
      setReferenceNumber(
        request.requestType === 'income'
          ? `IN-${Math.floor(100000 + Math.random() * 900000)}`
          : `TXN-${Math.floor(10000000 + Math.random() * 90000000)}`
      );
      setBankName('المصرف الرئيسي');
      setDisbursementNotes(request.requestType === 'income' ? `استلام وتوريد لحساب ${request.providerName || ''}`.trim() : '');
      setActiveAction('none');
      setApprovalNote('');
      setRejectionReason('');
      setClarificationQuestion('');
      setReplyText('');
      setReplyAttachment('');
    }
  }, [request]);

  // Close on Escape key press for accessibility
  useEffect(() => {
    if (!request) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [request, onClose]);

  if (!request) return null;

  const mapAccountTypeToPaymentMethod = (type: PaymentAccount['type']): PaymentMethod => {
    switch (type) {
      case 'bank': return 'bank_transfer';
      case 'instapay': return 'instapay';
      case 'wallet': return 'digital_wallet';
      case 'cash': return 'cash';
      default: return 'bank_transfer';
    }
  };

  const mapPaymentMethodToAccountType = (method: PaymentMethod): PaymentAccount['type'] => {
    switch (method) {
      case 'bank_transfer': return 'bank';
      case 'instapay': return 'instapay';
      case 'digital_wallet': return 'wallet';
      case 'cash': return 'cash';
      default: return 'other';
    }
  };

  const companyAccounts = (paymentAccounts || []).filter(
    a => a.orgId === request?.orgId && a.active !== false
  );

  const handleApprove = (e: React.FormEvent) => {
    e.preventDefault();
    approveRequest(request.id, approvalNote.trim() || undefined);
    setActiveAction('none');
    onClose();
  };

  const handleReject = (e: React.FormEvent) => {
    e.preventDefault();
    if (!rejectionReason.trim()) return;
    rejectRequest(request.id, rejectionReason.trim());
    setActiveAction('none');
    onClose();
  };

  const handleClarify = (e: React.FormEvent) => {
    e.preventDefault();
    if (!clarificationQuestion.trim()) return;
    requestClarification(request.id, clarificationQuestion.trim());
    setActiveAction('none');
    onClose();
  };

  const handleReply = (e: React.FormEvent) => {
    e.preventDefault();
    if (!replyText.trim()) return;
    replyClarification(request.id, replyText.trim(), replyAttachment.trim() || undefined);
    setActiveAction('none');
    onClose();
  };

  const handleDisburse = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!referenceNumber.trim()) return;
    setIsSubmitting(true);
    try {
      const targetAcc = companyAccounts.find(a => a.id === disburseAccountId) 
        || companyAccounts.find(a => a.type === mapPaymentMethodToAccountType(paymentMethod)) 
        || companyAccounts[0];

      await disburseRequest(request.id, {
        paymentMethod,
        referenceNumber: referenceNumber.trim(),
        bankName: targetAcc ? `${targetAcc.name} (${targetAcc.accountIdentifier})` : bankName,
        accountId: targetAcc?.id || disburseAccountId || undefined,
        accountName: targetAcc?.name,
        notes: disbursementNotes.trim() || undefined,
      });
      setActiveAction('none');
      onClose();
    } catch (err) {
      console.error(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div 
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
          <div className="flex items-center gap-3">
            <span className="font-mono text-xs font-bold text-slate-500 bg-slate-200 px-2.5 py-1 rounded-lg">
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
                {request.requestType === 'income' ? '+' : '-'}{request.amount.toLocaleString()} <span className="text-base font-bold text-slate-500">{request.currency}</span>
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
                    {request.preferredPaymentMethod === 'instapay' && '📱 إنستاباي'}
                    {request.preferredPaymentMethod === 'digital_wallet' && '💳 محفظة كاش'}
                    {request.preferredPaymentMethod === 'bank_transfer' && '🏦 حساب بنكي'}
                    {request.preferredPaymentMethod === 'cash' && '💵 خزينة نقدية'}
                    {!['instapay', 'digital_wallet', 'bank_transfer', 'cash'].includes(request.preferredPaymentMethod || '') && '📥 توريد مباشر'}
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
                  <span className="font-bold text-slate-800">{request.createdAt.split('T')[0]}</span>
                </div>
              </div>

              {/* Target Treasury Card Preview with live balance */}
              {(() => {
                const targetType = request.preferredPaymentMethod 
                  ? mapPaymentMethodToAccountType(request.preferredPaymentMethod) 
                  : undefined;
                const targetAcc = companyAccounts.find(a => a.id === request.targetAccountId) 
                  || (targetType ? companyAccounts.find(a => a.type === targetType) : undefined);
                if (!targetAcc) return null;
                const accBal = targetAcc.currentBalance ?? targetAcc.balance ?? 0;
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
                      <span className="font-black text-emerald-700 text-sm font-mono">{accBal.toLocaleString()} {targetAcc.currency || 'EGP'}</span>
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
                  <span className="font-bold text-slate-800">{request.createdAt.split('T')[0]}</span>
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

              {/* Goods / Items Details */}
              {request.itemsDetail && (
                <div className="bg-amber-50/70 border border-amber-200/80 rounded-xl p-3.5 text-xs">
                  <span className="font-bold text-amber-900 block mb-1">
                    📦 بيانات البضاعة أو الأصناف المرتبطة بالطلب:
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
                      <a
                        href={request.invoiceAttachment.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block shrink-0"
                      >
                        <img 
                          src={request.invoiceAttachment.url} 
                          alt="فاتورة" 
                          className="w-10 h-10 rounded-lg object-cover border border-amber-200 shadow-2xs hover:scale-105 transition" 
                        />
                      </a>
                    ) : (
                      <div className="w-10 h-10 rounded-lg bg-amber-100 text-amber-800 flex items-center justify-center font-bold text-xs shrink-0 border border-amber-200">
                        PDF
                      </div>
                    )}
                    <div className="min-w-0">
                      <span className="font-bold text-slate-800 text-xs truncate block max-w-xs">{request.invoiceAttachment.name}</span>
                      <span className="text-[10px] text-slate-400 font-mono">حجم الملف: {request.invoiceAttachment.size}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {request.invoiceAttachment.url && (
                      <a
                        href={request.invoiceAttachment.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-3 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-bold transition flex items-center gap-1 shadow-2xs"
                      >
                        <Eye className="h-3.5 w-3.5" />
                        <span>معاينة الفاتورة ↗</span>
                      </a>
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
                    <div key={att.id} className="flex items-center justify-between p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs">
                      <div className="flex items-center gap-2 truncate">
                        <FileText className="h-4 w-4 text-emerald-600 shrink-0" />
                        <span className="font-medium text-slate-800 truncate">{att.name}</span>
                      </div>
                      <span className="text-slate-400 text-[10px] shrink-0">{att.size}</span>
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
                  {request.disbursement.paymentMethod === 'bank_transfer' ? 'تحويل بنكي' : 
                   request.disbursement.paymentMethod === 'instapay' ? 'إنستاباي' : 
                   request.disbursement.paymentMethod === 'digital_wallet' ? 'محفظة كاش' : 
                   request.disbursement.paymentMethod === 'cash' ? 'خزينة نقدية' : 'أخرى'}
                </span></div>
                <div>رقم المرجع: <span className="font-mono font-bold">{request.disbursement.referenceNumber}</span></div>
                <div>تاريخ العملية: <span className="font-bold">{request.disbursement.disbursedAt}</span></div>
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
                      <span className="text-slate-400 font-normal">{comm.createdAt.split('T')[0]}</span>
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

          {/* ACTION FORMS ACCORDING TO ROLES */}
          {(currentRole === 'org_admin' || currentRole === 'super_admin' || currentRole === 'finance') && (
            <div className="pt-4 border-t border-slate-100">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="text-xs font-bold text-slate-500">
                  {request.requestType === 'income' ? 'إجراءات استلام وتوريد المبلغ في الخزينة:' : 'إجراءات الاعتماد والصرف المالي:'}
                </span>
                
                <div className="flex items-center gap-2 flex-wrap">
                  {/* For Income Requests: Direct Receipt or Reject */}
                  {request.requestType === 'income' ? (
                    (request.status === 'pending' || request.status === 'approved') && (
                      <>
                        <button
                          type="button"
                          onClick={() => setActiveAction(activeAction === 'disburse' ? 'none' : 'disburse')}
                          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-xs flex items-center gap-1.5 transition cursor-pointer"
                        >
                          <ArrowDownLeft className="h-4 w-4" />
                          <span>📥 تأكيد الاستلام والتوريد في الخزينة (تم الاستلام)</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => setActiveAction(activeAction === 'reject' ? 'none' : 'reject')}
                          className="px-3.5 py-2 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs rounded-xl shadow-xs flex items-center gap-1.5 transition cursor-pointer"
                        >
                          <XCircle className="h-4 w-4" />
                          <span>رفض التوريد</span>
                        </button>
                      </>
                    )
                  ) : (
                    /* For Expense Requests */
                    <>
                      {(request.status === 'pending' || request.status === 'clarification_requested') && (
                        <>
                          <button
                            type="button"
                            onClick={() => setActiveAction(activeAction === 'approve' ? 'none' : 'approve')}
                            className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-xs flex items-center gap-1.5 transition cursor-pointer"
                          >
                            <CheckCircle2 className="h-4 w-4" />
                            <span>اعتماد الطلب</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => setActiveAction(activeAction === 'clarify' ? 'none' : 'clarify')}
                            className="px-3.5 py-2 bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs rounded-xl shadow-xs flex items-center gap-1.5 transition cursor-pointer"
                          >
                            <HelpCircle className="h-4 w-4" />
                            <span>طلب توضيح أكثر</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => setActiveAction(activeAction === 'reject' ? 'none' : 'reject')}
                            className="px-3.5 py-2 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs rounded-xl shadow-xs flex items-center gap-1.5 transition cursor-pointer"
                          >
                            <XCircle className="h-4 w-4" />
                            <span>رفض الطلب</span>
                          </button>
                        </>
                      )}

                      {request.status === 'approved' && (
                        <button
                          type="button"
                          onClick={() => setActiveAction(activeAction === 'disburse' ? 'none' : 'disburse')}
                          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-xs flex items-center gap-1.5 transition cursor-pointer"
                        >
                          <CreditCard className="h-4 w-4" />
                          <span>تسجيل وتنفيذ الصرف المالي</span>
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* Sub-form: Approve Form — with Treasury Balance Alert */}
              {activeAction === 'approve' && (
                <form onSubmit={handleApprove} className="mt-4 p-4 bg-emerald-50/70 border border-emerald-200 rounded-xl space-y-3">
                  <h5 className="font-bold text-emerald-900 text-xs">تأكيد اعتماد الطلب بمبلغ {request.amount.toLocaleString()} {request.currency}</h5>
                  
                  {/* 🟡 NEW: Treasury Balance Warning */}
                  {request.requestType !== 'income' && (() => {
                    const totalBalance = companyAccounts.reduce((sum, acc) => sum + Number(acc.currentBalance ?? acc.balance ?? 0), 0);
                    const isInsufficient = totalBalance < request.amount;
                    const matchingAcc = companyAccounts.find(a => {
                      const methodType = request.preferredPaymentMethod === 'instapay' ? 'instapay' 
                        : request.preferredPaymentMethod === 'digital_wallet' ? 'wallet'
                        : request.preferredPaymentMethod === 'bank_transfer' ? 'bank'
                        : request.preferredPaymentMethod === 'cash' ? 'cash' : null;
                      return methodType && a.type === methodType;
                    });
                    const matchingBalance = matchingAcc ? Number(matchingAcc.currentBalance ?? matchingAcc.balance ?? 0) : null;
                    const isMatchingInsufficient = matchingBalance !== null && matchingBalance < request.amount;

                    return (
                      <div className={`p-3 rounded-xl border text-xs flex items-start gap-2.5 ${
                        isInsufficient || isMatchingInsufficient
                          ? 'bg-rose-50 border-rose-300 text-rose-900' 
                          : 'bg-teal-50 border-teal-200 text-teal-900'
                      }`}>
                        <AlertTriangle className={`h-4 w-4 shrink-0 mt-0.5 ${
                          isInsufficient || isMatchingInsufficient ? 'text-rose-600' : 'text-teal-600'
                        }`} />
                        <div className="space-y-1">
                          <div className="font-bold">
                            {isInsufficient 
                              ? '⚠️ تنبيه: رصيد الخزينة قد لا يكفي لتنفيذ هذا الصرف!'
                              : isMatchingInsufficient
                              ? `⚠️ تنبيه: رصيد حساب ${matchingAcc?.name || 'الصرف'} قد لا يكفي`
                              : '✅ رصيد الخزينة كافٍ لتنفيذ هذا الصرف'}
                          </div>
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
                            <span>إجمالي الرصيد المتاح: <strong>{totalBalance.toLocaleString()} {request.currency}</strong></span>
                            {matchingAcc && (
                              <span>رصيد {matchingAcc.name}: <strong>{matchingBalance?.toLocaleString()} {request.currency}</strong></span>
                            )}
                            <span>المبلغ المطلوب: <strong>{request.amount.toLocaleString()} {request.currency}</strong></span>
                          </div>
                          {(isInsufficient || isMatchingInsufficient) && (
                            <div className="text-[11px] font-bold text-rose-700 mt-1">
                              يمكنك الاعتماد لكن قد يتعذر التنفيذ الفعلي عند الصرف لعدم كفاية الرصيد.
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
                      className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-lg"
                    >
                      تأكيد الاعتماد
                    </button>
                  </div>
                </form>
              )}

              {/* Sub-form: Clarify Form */}
              {activeAction === 'clarify' && (
                <form onSubmit={handleClarify} className="mt-4 p-4 bg-amber-50/70 border border-amber-200 rounded-xl space-y-3">
                  <h5 className="font-bold text-amber-900 text-xs">طلب استفسار وتوضيح من طالب الصرف ({request.requesterName})</h5>
                  <textarea
                    rows={3}
                    required
                    value={clarificationQuestion}
                    onChange={(e) => setClarificationQuestion(e.target.value)}
                    placeholder="اكتب التساؤل المطلوب من الموظف توضيحه أو المستندات المطلوبة..."
                    className="w-full p-2.5 bg-white border border-amber-300 rounded-lg text-xs"
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
                      className="px-4 py-1.5 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs rounded-lg"
                    >
                      إرسال الاستفسار للموظف
                    </button>
                  </div>
                </form>
              )}

              {/* Sub-form: Reject Form */}
              {activeAction === 'reject' && (
                <form onSubmit={handleReject} className="mt-4 p-4 bg-rose-50/70 border border-rose-200 rounded-xl space-y-3">
                  <h5 className="font-bold text-rose-900 text-xs">رفض الطلب</h5>
                  <textarea
                    rows={2}
                    required
                    value={rejectionReason}
                    onChange={(e) => setRejectionReason(e.target.value)}
                    placeholder="اذكر سبب الرفض لتوضيحه للموظف..."
                    className="w-full p-2.5 bg-white border border-rose-300 rounded-lg text-xs"
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
                      className="px-4 py-1.5 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs rounded-lg"
                    >
                      تأكيد الرفض
                    </button>
                  </div>
                </form>
              )}

              {/* Sub-form: Disburse / Receipt Form */}
              {activeAction === 'disburse' && (
                <form onSubmit={handleDisburse} className={`mt-4 p-4 border rounded-xl space-y-3 ${
                  request.requestType === 'income' ? 'bg-emerald-50/80 border-emerald-300' : 'bg-blue-50/70 border-blue-200'
                }`}>
                  <div className="flex items-center justify-between">
                    <h5 className={`font-black text-xs flex items-center gap-1.5 ${
                      request.requestType === 'income' ? 'text-emerald-900' : 'text-blue-900'
                    }`}>
                      {request.requestType === 'income' ? (
                        <>
                          <ArrowDownLeft className="h-4 w-4 text-emerald-600" />
                          <span>📥 تأكيد استلام المبلغ وتوريده في الرصيد (+ IN)</span>
                        </>
                      ) : (
                        <span>توثيق وتسجيل الصرف المالي الفعلي</span>
                      )}
                    </h5>
                    <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-white border border-slate-200">
                      المبلغ: {request.amount.toLocaleString()} {request.currency}
                    </span>
                  </div>

                  {request.requestType === 'income' ? (
                    <>
                      {/* Income: Card selection and quick reference */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[11px] font-bold text-slate-700 mb-1">
                            حساب الخزينة / الكارت المستلم للرصيد:
                          </label>
                          <select
                            value={disburseAccountId}
                            onChange={(e) => {
                              setDisburseAccountId(e.target.value);
                              const acc = companyAccounts.find(a => a.id === e.target.value);
                              if (acc) setPaymentMethod(mapAccountTypeToPaymentMethod(acc.type));
                            }}
                            className="w-full p-2.5 bg-white border border-emerald-300 rounded-lg text-xs font-medium"
                          >
                            {companyAccounts.map(acc => (
                              <option key={acc.id} value={acc.id}>
                                {acc.name} ({acc.accountIdentifier}) - رصيده الحالي: {(acc.currentBalance ?? acc.balance ?? 0).toLocaleString()} {acc.currency || 'EGP'}
                              </option>
                            ))}
                          </select>
                          {(() => {
                            const acc = companyAccounts.find(a => a.id === disburseAccountId) || companyAccounts[0];
                            const parentBank = resolveParentBankAccount(acc);
                            if (!parentBank) return null;
                            return (
                              <div className="mt-1.5 p-2 bg-blue-50 border border-blue-200 rounded-lg text-blue-900 text-[11px] flex items-start gap-1.5">
                                <Landmark className="h-3.5 w-3.5 text-blue-600 shrink-0 mt-0.5" />
                                <div>
                                  <span className="font-bold block">إيداع بنكي مزدوج تلقائي:</span>
                                  <span className="text-[10.5px] text-blue-800 leading-relaxed">
                                    حساب ({acc?.name}) مربوط بالحساب البنكي (<strong>{parentBank.name}</strong>). سيتم إضافة المبلغ في الحسابين تلقائياً.
                                  </span>
                                </div>
                              </div>
                            );
                          })()}
                        </div>

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

                      <div className="flex justify-end gap-2 pt-2">
                        <button
                          type="button"
                          onClick={() => setActiveAction('none')}
                          className="px-3.5 py-2 text-xs text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer"
                        >
                          إلغاء
                        </button>
                        <button
                          type="submit"
                          disabled={isSubmitting}
                          className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs rounded-xl shadow-sm flex items-center gap-1.5 transition cursor-pointer"
                        >
                          <CheckCircle2 className="h-4 w-4" />
                          <span>{isSubmitting ? 'جارٍ توريد المبلغ...' : `✓ تأكيد الاستلام والتوريد في الرصيد الآن (+ ${request.amount.toLocaleString()} ${request.currency})`}</span>
                        </button>
                      </div>
                    </>
                  ) : (
                    /* Expense disburse form */
                    <>
                      {/* Account selection for expense */}
                      <div>
                        <label className="block text-[11px] font-bold text-slate-700 mb-1">
                          حساب / خزينة الصرف المحول منه (- OUT):
                        </label>
                        <select
                          value={disburseAccountId}
                          onChange={(e) => {
                            setDisburseAccountId(e.target.value);
                            const acc = companyAccounts.find(a => a.id === e.target.value);
                            if (acc) {
                              setBankName(`${acc.name} (${acc.accountIdentifier})`);
                              setPaymentMethod(mapAccountTypeToPaymentMethod(acc.type));
                            }
                          }}
                          className="w-full p-2.5 bg-white border border-slate-200 rounded-lg text-xs font-bold"
                        >
                          {companyAccounts.map(acc => (
                            <option key={acc.id} value={acc.id}>
                              {acc.name} — {acc.type === 'bank' ? 'حساب بنكي' : acc.type === 'instapay' ? 'انستاباي' : 'خزينة'} ({acc.accountIdentifier}) - الرصيد: {(acc.currentBalance ?? acc.balance ?? 0).toLocaleString()} {acc.currency || 'EGP'}
                            </option>
                          ))}
                        </select>
                        {(() => {
                          const acc = companyAccounts.find(a => a.id === disburseAccountId) || companyAccounts[0];
                          const parentBank = resolveParentBankAccount(acc);
                          if (!parentBank) return null;
                          return (
                            <div className="mt-1.5 p-2 bg-blue-50 border border-blue-200 rounded-lg text-blue-900 text-[11px] flex items-start gap-1.5">
                              <Landmark className="h-3.5 w-3.5 text-blue-600 shrink-0 mt-0.5" />
                              <div>
                                <span className="font-bold block">خصم بنكي مزدوج تلقائي:</span>
                                <span className="text-[10.5px] text-blue-800 leading-relaxed">
                                  حساب ({acc?.name}) مربوط بالحساب البنكي (<strong>{parentBank.name}</strong>). سيتم خصم مبلغ الصرف تلقائياً من هذا الحساب ومن الحساب البنكي الرئيسي معاً.
                                </span>
                              </div>
                            </div>
                          );
                        })()}
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div>
                          <label className="block text-[11px] font-bold text-slate-600 mb-1">طريقة الدفع:</label>
                          <select
                            value={paymentMethod}
                            onChange={(e: any) => setPaymentMethod(e.target.value)}
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

                      <div className="flex justify-end gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => setActiveAction('none')}
                          className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded-lg"
                        >
                          إلغاء
                        </button>
                        <button
                          type="submit"
                          disabled={isSubmitting}
                          className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-lg"
                        >
                          {isSubmitting ? 'جارٍ تسجيل الصرف...' : 'تأكيد الصرف وإغلاق الطلب'}
                        </button>
                      </div>
                    </>
                  )}
                </form>
              )}
            </div>
          )}

          {/* Requester Action: Reply if clarification requested */}
          {(currentRole === 'employee' || request.requesterId === currentUser.id || (request.requesterEmail && currentUser.email && request.requesterEmail.toLowerCase() === currentUser.email.toLowerCase())) && request.status === 'clarification_requested' && (
            <div className="pt-4 border-t border-slate-100">
              <form onSubmit={handleReply} className="p-4 bg-rose-50/70 border border-rose-300 rounded-xl space-y-3">
                <h5 className="font-bold text-rose-900 text-xs">الرد على طلب التوضيح وتقديم المستندات:</h5>
                <textarea
                  rows={2}
                  required
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
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
                <div className="flex justify-end">
                  <button
                    type="submit"
                    className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs rounded-xl shadow-xs flex items-center gap-1.5"
                  >
                    <Send className="h-3.5 w-3.5" />
                    <span>إرسال الرد للمدير</span>
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
    </div>
  );
};
