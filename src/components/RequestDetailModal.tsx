import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { ExpenseRequest } from '../types';
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
  AlertTriangle
} from 'lucide-react';

interface RequestDetailModalProps {
  request: ExpenseRequest | null;
  onClose: () => void;
}

export const RequestDetailModal: React.FC<RequestDetailModalProps> = ({ request, onClose }) => {
  const { 
    currentRole, 
    currentUser, 
    approveRequest, 
    rejectRequest, 
    requestClarification, 
    replyClarification, 
    disburseRequest 
  } = useApp();

  const [activeAction, setActiveAction] = useState<'none' | 'approve' | 'reject' | 'clarify' | 'reply' | 'disburse'>('none');
  
  // Action form states
  const [approvalNote, setApprovalNote] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');
  const [clarificationQuestion, setClarificationQuestion] = useState('');
  const [replyText, setReplyText] = useState('');
  const [replyAttachment, setReplyAttachment] = useState('');

  // Disbursement states
  const [paymentMethod, setPaymentMethod] = useState<'bank_transfer' | 'cash' | 'cheque'>('bank_transfer');
  const [referenceNumber, setReferenceNumber] = useState(`TXN-${Math.floor(10000000 + Math.random() * 90000000)}`);
  const [bankName, setBankName] = useState('مصرف الراجحي');
  const [disbursementNotes, setDisbursementNotes] = useState('');

  if (!request) return null;

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

  const handleDisburse = (e: React.FormEvent) => {
    e.preventDefault();
    if (!referenceNumber.trim()) return;
    disburseRequest(request.id, {
      paymentMethod,
      referenceNumber,
      bankName,
      notes: disbursementNotes.trim() || undefined,
    });
    setActiveAction('none');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 overflow-y-auto">
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
            <h3 className="text-base font-bold text-slate-900 truncate max-w-md">
              {request.title}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Modal Content */}
        <div className="p-6 space-y-6">
          
          {/* Top Amount & Status Banner */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl bg-slate-50 border border-slate-200">
            <div>
              <span className="text-xs text-slate-400 font-medium">المبلغ المطلوب للصرف</span>
              <div className="text-3xl font-black text-slate-900 mt-0.5">
                {request.amount.toLocaleString()} <span className="text-base font-bold text-slate-500">{request.currency}</span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400">حالة الطلب الحالية:</span>
              {request.status === 'pending' && (
                <span className="bg-amber-100 text-amber-800 text-xs px-3 py-1 rounded-full font-bold">
                  قيد مراجعة المدير
                </span>
              )}
              {request.status === 'clarification_requested' && (
                <span className="bg-rose-100 text-rose-800 text-xs px-3 py-1 rounded-full font-bold">
                  مطلوب استيضاح
                </span>
              )}
              {request.status === 'approved' && (
                <span className="bg-blue-100 text-blue-800 text-xs px-3 py-1 rounded-full font-bold">
                  معتمد وبانتظار الصرف
                </span>
              )}
              {request.status === 'disbursed' && (
                <span className="bg-emerald-100 text-emerald-800 text-xs px-3 py-1 rounded-full font-bold">
                  تم الصرف المالي
                </span>
              )}
              {request.status === 'rejected' && (
                <span className="bg-slate-200 text-slate-800 text-xs px-3 py-1 rounded-full font-bold">
                  مرفوض
                </span>
              )}
            </div>
          </div>

          {/* Key Metadata Grid */}
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

          {/* Attachments */}
          {request.attachments.length > 0 && (
            <div>
              <h4 className="font-bold text-slate-700 text-xs mb-2">المرفقات والفواتير ({request.attachments.length})</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {request.attachments.map((att) => (
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
          )}

          {/* Disbursement Receipt (if disbursed) */}
          {request.status === 'disbursed' && request.disbursement && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-xs space-y-2">
              <div className="flex items-center gap-2 font-bold text-emerald-900">
                <CreditCard className="h-4 w-4 text-emerald-600" />
                <span>بيانات الصرف المالي المكتمل</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-1 text-slate-700">
                <div>طريقة الدفع: <span className="font-bold">{request.disbursement.paymentMethod === 'bank_transfer' ? 'تحويل بنكي' : 'نقداً'}</span></div>
                <div>رقم المرجع: <span className="font-mono font-bold">{request.disbursement.referenceNumber}</span></div>
                <div>تاريخ الصرف: <span className="font-bold">{request.disbursement.disbursedAt}</span></div>
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

          {/* Manager Action Buttons Bar */}
          {currentRole === 'org_admin' && (
            <div className="pt-4 border-t border-slate-100">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="text-xs font-bold text-slate-500">إجراءات مدير المؤسسة:</span>
                
                <div className="flex items-center gap-2 flex-wrap">
                  {/* If pending or clarification_requested: can approve, clarify, reject */}
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

                  {/* If approved: can disburse */}
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
                </div>
              </div>

              {/* Sub-form: Approve Form */}
              {activeAction === 'approve' && (
                <form onSubmit={handleApprove} className="mt-4 p-4 bg-emerald-50/70 border border-emerald-200 rounded-xl space-y-3">
                  <h5 className="font-bold text-emerald-900 text-xs">تأكيد اعتماد الطلب بمبلغ {request.amount.toLocaleString()} {request.currency}</h5>
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
                  <h5 className="font-bold text-rose-900 text-xs">رفض طلب المصروف</h5>
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

              {/* Sub-form: Disburse Form */}
              {activeAction === 'disburse' && (
                <form onSubmit={handleDisburse} className="mt-4 p-4 bg-blue-50/70 border border-blue-200 rounded-xl space-y-3">
                  <h5 className="font-bold text-blue-900 text-xs">توثيق وتسجيل الصرف المالي الفعلي</h5>
                  
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-[11px] font-bold text-slate-600 mb-1">طريقة الدفع:</label>
                      <select
                        value={paymentMethod}
                        onChange={(e: any) => setPaymentMethod(e.target.value)}
                        className="w-full p-2 bg-white border border-slate-200 rounded-lg text-xs"
                      >
                        <option value="bank_transfer">تحويل بنكي</option>
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
                        className="w-full p-2 bg-white border border-slate-200 rounded-lg text-xs font-mono"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-slate-600 mb-1">اسم البنك:</label>
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
                      className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-lg"
                    >
                      تأكيد الصرف وإغلاق الطلب
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}

          {/* Employee Action: Reply if clarification requested */}
          {currentRole === 'employee' && request.status === 'clarification_requested' && (
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
    </div>
  );
};
