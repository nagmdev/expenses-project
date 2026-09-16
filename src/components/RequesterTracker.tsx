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
  CreditCard, 
  Check, 
  Search, 
  Plus,
  ArrowDownLeft,
  Smartphone,
  Building,
  DollarSign,
  ShieldCheck,
  Receipt
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
  const { requests, currentUser, currentRole, replyClarification, activeOrg } = useApp();

  const [selectedReqId, setSelectedReqId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [attachmentName, setAttachmentName] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // The requests array from AppContext is already 100% strictly scoped to the employee
  const myRequests = requests;

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

  // Financial Metrics for Employee
  const totalDisbursed = myRequests
    .filter(r => r.status === 'disbursed')
    .reduce((sum, r) => sum + r.amount, 0);

  const totalPending = myRequests
    .filter(r => r.status === 'pending' || r.status === 'approved' || r.status === 'clarification_requested')
    .reduce((sum, r) => sum + r.amount, 0);

  const currency = activeOrg?.currency || myRequests[0]?.currency || 'EGP';

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
            <span>مطلوب توضيح منك ⚠️</span>
          </span>
        );
      case 'approved':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-blue-50 text-blue-700 border border-blue-200">
            <CheckCircle2 className="h-3 w-3" />
            <span>معتمد وبانتظار التحويل</span>
          </span>
        );
      case 'disbursed':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 shadow-2xs">
            <Check className="h-3 w-3" />
            <span>تم التحويل البنكي والصرف ✓</span>
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

  const getMethodBadge = (method?: string) => {
    if (method === 'instapay') {
      return (
        <span className="inline-flex items-center gap-1 text-[11px] font-bold text-teal-700 bg-teal-50 px-2 py-0.5 rounded-md border border-teal-200">
          <Smartphone className="h-3 w-3" />
          <span>انستاباي (InstaPay)</span>
        </span>
      );
    }
    if (method === 'digital_wallet') {
      return (
        <span className="inline-flex items-center gap-1 text-[11px] font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-md border border-indigo-200">
          <Smartphone className="h-3 w-3" />
          <span>محفظة إلكترونية</span>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-700 bg-slate-100 px-2 py-0.5 rounded-md border border-slate-200">
        <Building className="h-3 w-3" />
        <span>تحويل بنكي / IBAN</span>
      </span>
    );
  };

  return (
    <div className="space-y-6 pb-12">
      
      {/* Banking & InstaPay Tracker Hero Header */}
      <div className="bg-gradient-to-l from-slate-900 via-teal-950 to-slate-900 text-white rounded-3xl p-6 sm:p-8 shadow-xl border border-slate-800 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-80 h-80 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none"></div>
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <div className="flex items-center gap-2">
              <span className="bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 text-[11px] px-3 py-1 rounded-full font-bold flex items-center gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
                <span>حسابك البنكي الآمن — {activeOrg?.name || 'الشركة'}</span>
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-black mt-2 tracking-tight">
              تتبع المطالبات والتحويلات المالية
            </h1>
            <p className="text-xs sm:text-sm text-slate-300 mt-1 max-w-xl leading-relaxed">
              مرحباً {currentUser.name}، تابع هنا دورة تحويل مستحقاتك وعهدتك المالية خطوة بخطوة، واطلع على إشعارات الصرف وإيصالات التحويل البنكية فور صدورها.
            </p>
          </div>

          <button
            type="button"
            onClick={onOpenNewRequest}
            className="flex items-center gap-2 bg-gradient-to-r from-emerald-500 to-teal-400 hover:from-emerald-400 hover:to-teal-300 text-slate-950 font-black text-sm px-6 py-3.5 rounded-2xl shadow-xl shadow-emerald-500/20 transition cursor-pointer self-start md:self-auto shrink-0 active:scale-98"
          >
            <Plus className="h-5 w-5 stroke-[2.5]" />
            <span>طلب تحويل / صرف جديد</span>
          </button>
        </div>

        {/* Banking Financial Quick Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-6 pt-6 border-t border-slate-800/80">
          <div className="bg-slate-950/60 backdrop-blur-md p-4 rounded-2xl border border-slate-800">
            <span className="text-[11px] text-slate-400 block mb-1">إجمالي المبالغ المحولة بنجاح</span>
            <div className="flex items-baseline gap-1.5 text-xl font-black text-emerald-400">
              <span>{totalDisbursed.toLocaleString()}</span>
              <span className="text-xs text-slate-400 font-semibold">{currency}</span>
            </div>
          </div>

          <div className="bg-slate-950/60 backdrop-blur-md p-4 rounded-2xl border border-slate-800">
            <span className="text-[11px] text-slate-400 block mb-1">مبالغ قيد المراجعة والاعتماد</span>
            <div className="flex items-baseline gap-1.5 text-xl font-black text-amber-400">
              <span>{totalPending.toLocaleString()}</span>
              <span className="text-xs text-slate-400 font-semibold">{currency}</span>
            </div>
          </div>

          <div className="bg-slate-950/60 backdrop-blur-md p-4 rounded-2xl border border-slate-800">
            <span className="text-[11px] text-slate-400 block mb-1">إجمالي المطالبات المسجلة لك</span>
            <div className="flex items-baseline gap-1.5 text-xl font-black text-white">
              <span>{myRequests.length}</span>
              <span className="text-xs text-slate-400 font-semibold">مطالبة</span>
            </div>
          </div>
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
                placeholder="بحث برقم المطالبة أو البند..."
                className="w-full pl-3 pr-9 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition"
              />
            </div>

            {/* Filter Pills */}
            <div className="flex flex-wrap gap-1.5 text-xs">
              {[
                { id: 'all', label: 'الكل' },
                { id: 'clarification_requested', label: 'توضيح مطلوب ⚠️' },
                { id: 'pending', label: 'قيد المراجعة' },
                { id: 'approved', label: 'معتمد' },
                { id: 'disbursed', label: 'تم التحويل ✓' },
              ].map((pill) => (
                <button
                  key={pill.id}
                  onClick={() => setFilterStatus(pill.id)}
                  className={`px-3 py-1.5 rounded-lg font-medium transition cursor-pointer ${
                    filterStatus === pill.id
                      ? 'bg-slate-900 text-white font-bold shadow-xs'
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
                    <div>
                      {getMethodBadge(req.preferredPaymentMethod)}
                    </div>
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
            <div className="bg-white rounded-3xl border border-slate-200/80 shadow-xs p-6 sm:p-7 space-y-6">
              
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

              {/* Visual 4-Step Stepper (InstaPay / Banking Lifecycle) */}
              <div>
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4">
                  مسار دورة الاعتماد والتحويل المالي
                </h3>

                <div className="relative">
                  {/* Progress Line */}
                  <div className="absolute top-5 right-6 left-6 h-0.5 bg-slate-200 -z-0"></div>

                  <div className="grid grid-cols-4 gap-2 text-center relative z-10">
                    
                    {/* Step 1: Created */}
                    <div className="flex flex-col items-center">
                      <div className="h-10 w-10 rounded-full bg-emerald-600 text-white flex items-center justify-center font-bold text-sm shadow-md">
                        <Check className="h-5 w-5 stroke-[2.5]" />
                      </div>
                      <span className="text-xs font-bold text-slate-800 mt-2">تقديم الطلب</span>
                      <span className="text-[10px] text-slate-400 font-medium">مكتمل</span>
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
                          <Clock className="h-5 w-5 animate-spin" />
                        ) : activeRequest.status === 'clarification_requested' ? (
                          <AlertCircle className="h-5 w-5" />
                        ) : (
                          <Check className="h-5 w-5 stroke-[2.5]" />
                        )}
                      </div>
                      <span className="text-xs font-bold text-slate-800 mt-2">مراجعة الإدارة</span>
                      <span className="text-[10px] text-slate-400 font-medium">
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
                          <Check className="h-5 w-5 stroke-[2.5]" />
                        ) : (
                          <span>3</span>
                        )}
                      </div>
                      <span className="text-xs font-bold text-slate-800 mt-2">اعتماد المدير</span>
                      <span className="text-[10px] text-slate-400 font-medium">
                        {activeRequest.status === 'rejected' ? 'تم الرفض' :
                         activeRequest.status === 'approved' || activeRequest.status === 'disbursed' ? 'معتمد' : 'قيد الانتظار'}
                      </span>
                    </div>

                    {/* Step 4: Disbursed / Transferred */}
                    <div className="flex flex-col items-center">
                      <div className={`h-10 w-10 rounded-full flex items-center justify-center font-bold text-sm shadow-xs ${
                        activeRequest.status === 'disbursed'
                          ? 'bg-emerald-600 text-white shadow-emerald-500/30 ring-4 ring-emerald-100'
                          : 'bg-slate-200 text-slate-400'
                      }`}>
                        {activeRequest.status === 'disbursed' ? (
                          <Check className="h-5 w-5 stroke-[2.5]" />
                        ) : (
                          <span>4</span>
                        )}
                      </div>
                      <span className="text-xs font-bold text-slate-800 mt-2">إتمام التحويل</span>
                      <span className="text-[10px] text-slate-400 font-medium">
                        {activeRequest.status === 'disbursed' ? 'تم الصرف بنجاح' : 'غير مكتمل'}
                      </span>
                    </div>

                  </div>
                </div>
              </div>

              {/* InstaPay Transfer Receipt (When Disbursed) */}
              {activeRequest.status === 'disbursed' && activeRequest.disbursement && (
                <div className="bg-emerald-50/80 border-2 border-emerald-300 rounded-3xl p-6 space-y-4 shadow-sm animate-in fade-in duration-200">
                  <div className="flex items-center justify-between pb-3 border-b border-emerald-200">
                    <div className="flex items-center gap-2.5 text-emerald-950 font-black text-sm sm:text-base">
                      <div className="h-9 w-9 rounded-xl bg-emerald-600 text-white flex items-center justify-center shadow-md">
                        <CreditCard className="h-5 w-5" />
                      </div>
                      <div>
                        <span>إشعار التحويل البنكي الرسمي (Payment Advice)</span>
                        <div className="text-[11px] text-emerald-700 font-normal">تم تسوية وتحويل المبلغ إلى حسابك</div>
                      </div>
                    </div>
                    <span className="text-xs bg-emerald-600 text-white font-black px-3 py-1 rounded-full shadow-xs">
                      تم التحويل ✓
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
                    <div className="bg-white/80 p-3 rounded-xl border border-emerald-100">
                      <span className="text-slate-500 block mb-0.5">طريقة التحويل:</span>
                      <span className="font-bold text-slate-900">
                        {activeRequest.disbursement.paymentMethod === 'instapay' ? 'انستاباي (InstaPay)' :
                         activeRequest.disbursement.paymentMethod === 'bank_transfer' ? 'تحويل بنكي' :
                         activeRequest.disbursement.paymentMethod === 'digital_wallet' ? 'محفظة إلكترونية' :
                         activeRequest.disbursement.paymentMethod === 'cash' ? 'نقداً / خزينة' : 'شيك'}
                      </span>
                    </div>
                    <div className="bg-white/80 p-3 rounded-xl border border-emerald-100">
                      <span className="text-slate-500 block mb-0.5">رقم العملية / المرجع:</span>
                      <span className="font-mono font-black text-emerald-800 text-xs">
                        {activeRequest.disbursement.referenceNumber}
                      </span>
                    </div>
                    <div className="bg-white/80 p-3 rounded-xl border border-emerald-100">
                      <span className="text-slate-500 block mb-0.5">الجهة المحول منها:</span>
                      <span className="font-bold text-slate-900">
                        {activeRequest.disbursement.bankName || 'انستاباي / البنك المركزي'}
                      </span>
                    </div>
                    <div className="bg-white/80 p-3 rounded-xl border border-emerald-100">
                      <span className="text-slate-500 block mb-0.5">تاريخ وساعة الصرف:</span>
                      <span className="font-bold text-slate-900">
                        {activeRequest.disbursement.disbursedAt}
                      </span>
                    </div>
                  </div>

                  {activeRequest.disbursement.notes && (
                    <div className="text-xs bg-white/90 p-3 rounded-xl border border-emerald-200 text-slate-800">
                      <span className="font-bold text-emerald-900">ملاحظات التحويل: </span>
                      {activeRequest.disbursement.notes}
                    </div>
                  )}
                </div>
              )}

              {/* Clarification Action Box */}
              {activeRequest.status === 'clarification_requested' && (
                <div className="bg-rose-50 border-2 border-rose-300 rounded-3xl p-6 space-y-4 animate-in fade-in duration-200">
                  <div className="flex items-start gap-3">
                    <div className="h-9 w-9 rounded-xl bg-rose-200 text-rose-800 flex items-center justify-center shrink-0">
                      <AlertCircle className="h-5 w-5" />
                    </div>
                    <div>
                      <h4 className="font-extrabold text-rose-900 text-sm">
                        طلب توضيح من مدير الشركة
                      </h4>
                      <p className="text-xs text-rose-800 mt-0.5">
                        يرجى الإجابة على الاستفسار ليعود الطلب فوراً إلى المدير للاعتماد المالي:
                      </p>
                    </div>
                  </div>

                  <div className="bg-white p-4 rounded-xl border border-rose-200 text-sm text-slate-800 font-medium">
                    {activeRequest.comments
                      .filter(c => c.type === 'clarification_request')
                      .slice(-1)[0]?.content || 'يرجى تقديم مزيد من التفاصيل والفواتير المساندة.'}
                  </div>

                  <form onSubmit={handleSendClarification} className="space-y-3 pt-2">
                    <label className="block text-xs font-bold text-slate-700">
                      اكتب ردك وتوضيحك هنا:
                    </label>
                    <textarea
                      rows={3}
                      required
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      placeholder="اكتب التوضيح المفصل هنا..."
                      className="w-full p-3 bg-white border border-rose-300 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-rose-500/20 text-slate-900"
                    />

                    <div className="flex items-center gap-3">
                      <div className="relative flex-1">
                        <Paperclip className="h-3.5 w-3.5 text-slate-400 absolute right-3 top-2.5" />
                        <input
                          type="text"
                          value={attachmentName}
                          onChange={(e) => setAttachmentName(e.target.value)}
                          placeholder="اسم المرفق الإضافي (مثال: مستند_بديل.pdf)..."
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

              {/* Rejection Notice */}
              {activeRequest.status === 'rejected' && (
                <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 text-xs">
                  <div className="flex items-center gap-2 text-rose-700 font-bold mb-1">
                    <XCircle className="h-4 w-4" />
                    <span>تم رفض هذا الطلب من قبل الإدارة المالية</span>
                  </div>
                  <p className="text-slate-700">
                    <span className="font-semibold">سبب الرفض: </span>
                    {activeRequest.rejectionReason || 'لم يتم استيفاء شروط الصرف المالي.'}
                  </p>
                </div>
              )}

              {/* Transfer Details & Destination Account */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs bg-slate-50 p-4 rounded-2xl border border-slate-100">
                <div>
                  <span className="text-slate-400 block mb-0.5">طريقة التحويل المطلوبة:</span>
                  <div className="mt-1">{getMethodBadge(activeRequest.preferredPaymentMethod)}</div>
                </div>
                <div>
                  <span className="text-slate-400 block mb-0.5">بيانات الحساب / عنوان التحويل:</span>
                  <span className="font-mono font-bold text-slate-800">
                    {activeRequest.paymentAccountDetails || 'الحساب المسجل لدى الإدارة'}
                  </span>
                </div>
                <div className="sm:col-span-2 pt-2 border-t border-slate-200/60">
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
                  سجل العمليات الكامل للمطالبة
                </h4>

                <div className="border-r-2 border-slate-200 pr-4 space-y-4 mr-2">
                  {activeRequest.timeline.map((event) => (
                    <div key={event.id} className="relative">
                      <div className="absolute -right-[21px] top-1 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-4 ring-white"></div>
                      <div className="text-xs font-bold text-slate-800">{event.title}</div>
                      <p className="text-xs text-slate-600 mt-0.5">{event.description}</p>
                      <div className="text-[10px] text-slate-400 mt-1 font-mono">
                        {event.actorName} • {event.timestamp}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

            </div>
          ) : (
            <div className="bg-white rounded-3xl border border-slate-200/80 p-12 text-center">
              <Clock className="h-12 w-12 text-slate-300 mx-auto mb-3" />
              <h3 className="font-bold text-slate-800">اختر طلباً لمتابعة مسار تحويله</h3>
              <p className="text-xs text-slate-400 mt-1">انقر على أي مطالبة في القائمة لعرض تفاصيلها وحالة الصرف وإيصال التحويل.</p>
            </div>
          )}
        </div>

      </div>

    </div>
  );
};
