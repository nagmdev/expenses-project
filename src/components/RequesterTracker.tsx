import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { 
  Clock, 
  CheckCircle2, 
  XCircle, 
  AlertCircle, 
  Send, 
  Paperclip, 
  FileText, 
  Building, 
  CreditCard, 
  Check, 
  MessageSquare,
  Sparkles,
  Search,
  Plus
} from 'lucide-react';
import { ExpenseRequest } from '../types';

interface RequesterTrackerProps {
  onOpenNewRequest: () => void;
  onSelectRequest: (request: ExpenseRequest) => void;
}

export const RequesterTracker: React.FC<RequesterTrackerProps> = ({ 
  onOpenNewRequest, 
  onSelectRequest 
}) => {
  const { requests, currentUser, replyClarification, activeOrgId } = useApp();

  const [selectedReqId, setSelectedReqId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [attachmentName, setAttachmentName] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Filter requests submitted by this employee or in current org
  const myRequests = requests.filter(r => {
    const matchOrg = activeOrgId === 'all' || r.orgId === activeOrgId;
    const matchUser = r.requesterId === currentUser.id;
    return matchOrg && matchUser;
  });

  const filteredRequests = myRequests.filter(r => {
    const matchStatus = filterStatus === 'all' || r.status === filterStatus;
    const matchSearch = 
      r.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.requestNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.serviceCategoryName.toLowerCase().includes(searchQuery.toLowerCase());
    return matchStatus && matchSearch;
  });

  // Selected request for deep tracking
  const activeRequest = selectedReqId 
    ? myRequests.find(r => r.id === selectedReqId) || filteredRequests[0]
    : filteredRequests[0];

  const handleSendClarification = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeRequest || !replyText.trim()) return;

    replyClarification(activeRequest.id, replyText, attachmentName.trim() || undefined);
    setReplyText('');
    setAttachmentName('');
  };

  const getStatusBadge = (status: ExpenseRequest['status']) => {
    switch (status) {
      case 'pending':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-700 border border-amber-200">
            <Clock className="h-3 w-3 animate-spin" />
            <span>قيد المراجعة الإدارية</span>
          </span>
        );
      case 'clarification_requested':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-rose-50 text-rose-700 border border-rose-200 animate-pulse">
            <AlertCircle className="h-3 w-3" />
            <span>مطلوب توضيح من قبلك</span>
          </span>
        );
      case 'approved':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-blue-50 text-blue-700 border border-blue-200">
            <CheckCircle2 className="h-3 w-3" />
            <span>معتمد وبانتظار الصرف</span>
          </span>
        );
      case 'disbursed':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
            <Check className="h-3 w-3" />
            <span>تم الصرف المالي بنجاح</span>
          </span>
        );
      case 'rejected':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-700 border border-slate-200">
            <XCircle className="h-3 w-3" />
            <span>مرفوض</span>
          </span>
        );
    }
  };

  return (
    <div className="space-y-6 pb-12">
      
      {/* Tracker Intro Header */}
      <div className="bg-gradient-to-l from-emerald-800 to-teal-900 text-white rounded-2xl p-6 shadow-md relative overflow-hidden">
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="bg-emerald-500/20 text-emerald-200 border border-emerald-400/30 text-xs px-2.5 py-0.5 rounded-full font-semibold">
                بوابة الموظف / طالب الصرف
              </span>
            </div>
            <h1 className="text-2xl font-black mt-2">شاشة تتبع الطلبات وحالة الصرف</h1>
            <p className="text-sm text-emerald-100/80 mt-1 max-w-2xl">
              مرحباً {currentUser.name}، يمكنك هنا متابعة مسار كل طلب، الاطلاع على قرارات الإدارة المالية، الرد الفوري على أي توضيح مطلوب، وتأكيد وصول المبالغ المصروفة.
            </p>
          </div>

          <button
            type="button"
            onClick={onOpenNewRequest}
            className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-extrabold text-sm px-5 py-3 rounded-xl shadow-lg transition cursor-pointer self-start md:self-auto shrink-0"
          >
            <Plus className="h-4 w-4" />
            <span>تقديم طلب صرف جديد</span>
          </button>
        </div>
      </div>

      {/* Main Content Layout: List on Right, Detailed Tracker on Left (RTL) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Requests List Column (5 cols) */}
        <div className="lg:col-span-5 space-y-4">
          
          {/* Search & Filter Tabs */}
          <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs space-y-3">
            <div className="relative">
              <Search className="h-4 w-4 text-slate-400 absolute right-3 top-3" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="بحث برقم الطلب أو البند..."
                className="w-full pl-3 pr-9 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition"
              />
            </div>

            {/* Filter Pills */}
            <div className="flex flex-wrap gap-1.5 text-xs">
              {[
                { id: 'all', label: 'الكل' },
                { id: 'clarification_requested', label: 'بحاجة لتوضيح ⚠️' },
                { id: 'pending', label: 'قيد الانتظار' },
                { id: 'approved', label: 'معتمد' },
                { id: 'disbursed', label: 'تم الصرف' },
              ].map((pill) => (
                <button
                  key={pill.id}
                  onClick={() => setFilterStatus(pill.id)}
                  className={`px-3 py-1.5 rounded-lg font-medium transition cursor-pointer ${
                    filterStatus === pill.id
                      ? 'bg-slate-900 text-white font-bold'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {pill.label}
                </button>
              ))}
            </div>
          </div>

          {/* List Items */}
          <div className="space-y-3">
            {filteredRequests.map((req) => {
              const isSelected = activeRequest?.id === req.id;
              const hasClarification = req.status === 'clarification_requested';

              return (
                <div
                  key={req.id}
                  onClick={() => setSelectedReqId(req.id)}
                  className={`p-4 rounded-2xl border transition cursor-pointer relative ${
                    isSelected
                      ? 'bg-emerald-50/40 border-emerald-500 ring-2 ring-emerald-500/20 shadow-xs'
                      : 'bg-white border-slate-200 hover:border-slate-300'
                  }`}
                >
                  {hasClarification && (
                    <span className="absolute top-3 left-3 h-2.5 w-2.5 rounded-full bg-rose-500 animate-ping"></span>
                  )}

                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs font-bold text-slate-500">{req.requestNumber}</span>
                    {getStatusBadge(req.status)}
                  </div>

                  <h4 className="font-bold text-slate-900 text-sm mt-2 line-clamp-1">{req.title}</h4>

                  <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-100 text-xs">
                    <span className="text-slate-500">{req.serviceCategoryName}</span>
                    <span className="font-black text-slate-900 text-sm">
                      {req.amount.toLocaleString()} {req.currency}
                    </span>
                  </div>
                </div>
              );
            })}

            {filteredRequests.length === 0 && (
              <div className="bg-white p-8 rounded-2xl border border-slate-200 text-center">
                <FileText className="h-8 w-8 text-slate-300 mx-auto mb-2" />
                <p className="font-bold text-slate-700 text-sm">لا توجد طلبات تطابق هذا الاختيار</p>
                <p className="text-xs text-slate-400 mt-1">ابدأ بإنشاء طلب صرف جديد بالضغط على الزر أعلاه.</p>
              </div>
            )}
          </div>
        </div>

        {/* Detailed Stepper & Live Status Tracker Column (7 cols) */}
        <div className="lg:col-span-7">
          {activeRequest ? (
            <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs p-6 space-y-6">
              
              {/* Header Info */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-bold text-slate-400">{activeRequest.requestNumber}</span>
                    <span className="text-xs text-slate-400">• تاريخ التقديم: {activeRequest.createdAt.split('T')[0]}</span>
                  </div>
                  <h2 className="text-lg font-bold text-slate-900 mt-1">{activeRequest.title}</h2>
                </div>

                <div className="text-left">
                  <div className="text-2xl font-black text-slate-900">
                    {activeRequest.amount.toLocaleString()} <span className="text-sm font-semibold text-slate-500">{activeRequest.currency}</span>
                  </div>
                  <div className="mt-1">{getStatusBadge(activeRequest.status)}</div>
                </div>
              </div>

              {/* Visual 4-Step Stepper */}
              <div>
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4">
                  شريط مسار دورة حياة الطلب والصرف
                </h3>

                <div className="relative">
                  {/* Progress Line */}
                  <div className="absolute top-5 right-6 left-6 h-0.5 bg-slate-200 -z-0"></div>

                  <div className="grid grid-cols-4 gap-2 text-center relative z-10">
                    
                    {/* Step 1: Created */}
                    <div className="flex flex-col items-center">
                      <div className="h-10 w-10 rounded-full bg-emerald-600 text-white flex items-center justify-center font-bold text-sm shadow-md">
                        <Check className="h-5 w-5" />
                      </div>
                      <span className="text-xs font-bold text-slate-800 mt-2">تقديم الطلب</span>
                      <span className="text-[10px] text-slate-400">مكتمل</span>
                    </div>

                    {/* Step 2: Under Review */}
                    <div className="flex flex-col items-center">
                      <div className={`h-10 w-10 rounded-full flex items-center justify-center font-bold text-sm shadow-xs ${
                        activeRequest.status === 'clarification_requested'
                          ? 'bg-rose-500 text-white animate-pulse'
                          : activeRequest.status === 'pending'
                          ? 'bg-amber-500 text-white'
                          : 'bg-emerald-600 text-white'
                      }`}>
                        {activeRequest.status === 'pending' ? (
                          <Clock className="h-5 w-5" />
                        ) : activeRequest.status === 'clarification_requested' ? (
                          <AlertCircle className="h-5 w-5" />
                        ) : (
                          <Check className="h-5 w-5" />
                        )}
                      </div>
                      <span className="text-xs font-bold text-slate-800 mt-2">مراجعة الإدارة</span>
                      <span className="text-[10px] text-slate-400">
                        {activeRequest.status === 'clarification_requested' ? 'مطلوب توضيح' :
                         activeRequest.status === 'pending' ? 'جاري الفحص' : 'معتمد'}
                      </span>
                    </div>

                    {/* Step 3: Approval */}
                    <div className="flex flex-col items-center">
                      <div className={`h-10 w-10 rounded-full flex items-center justify-center font-bold text-sm shadow-xs ${
                        activeRequest.status === 'approved' || activeRequest.status === 'disbursed'
                          ? 'bg-emerald-600 text-white'
                          : activeRequest.status === 'rejected'
                          ? 'bg-rose-500 text-white'
                          : 'bg-slate-200 text-slate-400'
                      }`}>
                        {activeRequest.status === 'rejected' ? (
                          <XCircle className="h-5 w-5" />
                        ) : activeRequest.status === 'approved' || activeRequest.status === 'disbursed' ? (
                          <Check className="h-5 w-5" />
                        ) : (
                          <span>3</span>
                        )}
                      </div>
                      <span className="text-xs font-bold text-slate-800 mt-2">اعتماد المدير</span>
                      <span className="text-[10px] text-slate-400">
                        {activeRequest.status === 'rejected' ? 'تم الرفض' :
                         activeRequest.status === 'approved' || activeRequest.status === 'disbursed' ? 'مكتمل' : 'قيد الانتظار'}
                      </span>
                    </div>

                    {/* Step 4: Disbursed */}
                    <div className="flex flex-col items-center">
                      <div className={`h-10 w-10 rounded-full flex items-center justify-center font-bold text-sm shadow-xs ${
                        activeRequest.status === 'disbursed'
                          ? 'bg-emerald-600 text-white'
                          : 'bg-slate-200 text-slate-400'
                      }`}>
                        {activeRequest.status === 'disbursed' ? (
                          <Check className="h-5 w-5" />
                        ) : (
                          <span>4</span>
                        )}
                      </div>
                      <span className="text-xs font-bold text-slate-800 mt-2">تنفيذ الصرف</span>
                      <span className="text-[10px] text-slate-400">
                        {activeRequest.status === 'disbursed' ? 'تم تحويل المبلغ' : 'غير مكتمل'}
                      </span>
                    </div>

                  </div>
                </div>
              </div>

              {/* Clarification Action Box (When Manager requests more information) */}
              {activeRequest.status === 'clarification_requested' && (
                <div className="bg-rose-50 border-2 border-rose-300/80 rounded-2xl p-5 space-y-4 animate-in fade-in duration-200">
                  <div className="flex items-start gap-3">
                    <div className="h-9 w-9 rounded-xl bg-rose-200 text-rose-800 flex items-center justify-center shrink-0">
                      <AlertCircle className="h-5 w-5" />
                    </div>
                    <div>
                      <h4 className="font-extrabold text-rose-900 text-sm">
                        طلب توضيح من مدير المؤسسة
                      </h4>
                      <p className="text-xs text-rose-800 mt-1">
                        طلب المدير استفسارات إضافية قبل اتخاذ قرار الاعتماد:
                      </p>
                    </div>
                  </div>

                  {/* Clarification message from manager */}
                  <div className="bg-white p-4 rounded-xl border border-rose-200 text-sm text-slate-800 font-medium">
                    {activeRequest.comments
                      .filter(c => c.type === 'clarification_request')
                      .slice(-1)[0]?.content || 'يرجى تقديم مزيد من التفاصيل والفواتير المساندة.'}
                  </div>

                  {/* Employee Reply Form */}
                  <form onSubmit={handleSendClarification} className="space-y-3 pt-2">
                    <label className="block text-xs font-bold text-slate-700">
                      اكتب ردك وتوضيحك لمدير المؤسسة:
                    </label>
                    <textarea
                      rows={3}
                      required
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      placeholder="اكتب التوضيح المفصل هنا وسيعود الطلب فوراً للمدير للاعتماد..."
                      className="w-full p-3 bg-white border border-rose-300 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 text-slate-900"
                    />

                    <div className="flex items-center gap-3">
                      <div className="relative flex-1">
                        <Paperclip className="h-3.5 w-3.5 text-slate-400 absolute right-3 top-2.5" />
                        <input
                          type="text"
                          value={attachmentName}
                          onChange={(e) => setAttachmentName(e.target.value)}
                          placeholder="اسم المرفق الإضافي (مثال: عرض_سعر_بديل.pdf)..."
                          className="w-full pl-3 pr-9 py-2 bg-white border border-slate-200 rounded-lg text-xs"
                        />
                      </div>

                      <button
                        type="submit"
                        className="px-5 py-2 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs rounded-xl shadow-xs flex items-center gap-1.5 transition cursor-pointer shrink-0"
                      >
                        <Send className="h-3.5 w-3.5" />
                        <span>إرسال التوضيح للمدير</span>
                      </button>
                    </div>
                  </form>
                </div>
              )}

              {/* Disbursement Receipt (When Disbursed) */}
              {activeRequest.status === 'disbursed' && activeRequest.disbursement && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-emerald-900 font-bold text-sm">
                      <CreditCard className="h-5 w-5 text-emerald-600" />
                      <span>إشعار الصرف المالي الرسمي</span>
                    </div>
                    <span className="text-xs bg-emerald-200/60 text-emerald-900 font-bold px-2 py-0.5 rounded-md">
                      تم الدفع والتحويل
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 text-xs">
                    <div>
                      <span className="text-slate-500 block">طريقة الصرف:</span>
                      <span className="font-bold text-slate-800">
                        {activeRequest.disbursement.paymentMethod === 'bank_transfer' ? 'تحويل بنكي' :
                         activeRequest.disbursement.paymentMethod === 'cash' ? 'نقداً / خزينة' : 'شيك'}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">رقم المرجع / الحوالة:</span>
                      <span className="font-mono font-bold text-slate-900">{activeRequest.disbursement.referenceNumber}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">البنك المسحوب منه:</span>
                      <span className="font-bold text-slate-800">{activeRequest.disbursement.bankName || 'المصرف الرئيسي'}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">تاريخ وساعة الصرف:</span>
                      <span className="font-bold text-slate-800">{activeRequest.disbursement.disbursedAt}</span>
                    </div>
                  </div>

                  {activeRequest.disbursement.notes && (
                    <div className="mt-2 text-xs bg-white/70 p-2.5 rounded-lg border border-emerald-100 text-slate-700">
                      <span className="font-bold">ملاحظات الصرف: </span>
                      {activeRequest.disbursement.notes}
                    </div>
                  )}
                </div>
              )}

              {/* Rejection Notice (When Rejected) */}
              {activeRequest.status === 'rejected' && (
                <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 text-xs">
                  <div className="flex items-center gap-2 text-rose-700 font-bold mb-1">
                    <XCircle className="h-4 w-4" />
                    <span>تم رفض هذا الطلب من قبل الإدارة</span>
                  </div>
                  <p className="text-slate-700">
                    <span className="font-semibold">سبب الرفض: </span>
                    {activeRequest.rejectionReason || 'لم يتم استيفاء شروط الصرف المالي.'}
                  </p>
                </div>
              )}

              {/* Request Metadata & Description */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs bg-slate-50 p-4 rounded-xl border border-slate-100">
                <div>
                  <span className="text-slate-400 block mb-0.5">بند الخدمة:</span>
                  <span className="font-bold text-slate-800">{activeRequest.serviceCategoryName}</span>
                </div>
                <div>
                  <span className="text-slate-400 block mb-0.5">مقدم الخدمة / المورد:</span>
                  <span className="font-bold text-slate-800">{activeRequest.providerName}</span>
                </div>
                <div className="sm:col-span-2">
                  <span className="text-slate-400 block mb-0.5">تفاصيل وموضوع الطلب:</span>
                  <p className="text-slate-700 leading-relaxed">{activeRequest.description}</p>
                </div>
                <div className="sm:col-span-2">
                  <span className="text-slate-400 block mb-0.5">المبرر المالي:</span>
                  <p className="text-slate-700 leading-relaxed">{activeRequest.justification}</p>
                </div>
              </div>

              {/* Attachments */}
              {activeRequest.attachments.length > 0 && (
                <div>
                  <h4 className="text-xs font-bold text-slate-700 mb-2">المرفقات والفواتير ({activeRequest.attachments.length})</h4>
                  <div className="flex flex-wrap gap-2">
                    {activeRequest.attachments.map((att) => (
                      <div
                        key={att.id}
                        className="flex items-center gap-2 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs"
                      >
                        <FileText className="h-4 w-4 text-emerald-600" />
                        <span className="font-medium text-slate-800">{att.name}</span>
                        <span className="text-slate-400 text-[10px]">({att.size})</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Event Timeline History */}
              <div className="pt-2">
                <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">
                  سجل الأحداث الكامل للطلب
                </h4>

                <div className="border-r-2 border-slate-200 pr-4 space-y-4 mr-2">
                  {activeRequest.timeline.map((event) => (
                    <div key={event.id} className="relative">
                      <div className="absolute -right-[21px] top-1 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-4 ring-white"></div>
                      <div className="text-xs font-bold text-slate-800">{event.title}</div>
                      <p className="text-xs text-slate-600 mt-0.5">{event.description}</p>
                      <div className="text-[10px] text-slate-400 mt-1">
                        بواسطة: {event.actorName} • {event.timestamp}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-slate-200/80 p-12 text-center">
              <Clock className="h-12 w-12 text-slate-300 mx-auto mb-3" />
              <h3 className="font-bold text-slate-800">اختر طلباً لمتابعة حالته</h3>
              <p className="text-xs text-slate-400 mt-1">انقر على أي طلب من القائمة في اليمين لعرض التفاصيل الكاملة ومسار الصرف.</p>
            </div>
          )}
        </div>

      </div>

    </div>
  );
};
