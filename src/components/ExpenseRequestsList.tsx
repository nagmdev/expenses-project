import React, { useState, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { ExpenseRequest, PaymentMethod } from '../types';
import { 
  Search, 
  Plus, 
  Clock, 
  CheckCircle2, 
  XCircle, 
  AlertCircle, 
  Eye, 
  Check, 
  Layers,
  Building,
  Calendar,
  CreditCard,
  Copy,
  Printer,
  Smartphone,
  ShieldCheck,
  Send,
  HelpCircle,
  X,
  FileText,
  User as UserIcon,
  Tag,
  Flame,
  Filter
} from 'lucide-react';

interface ExpenseRequestsListProps {
  onSelectRequest: (request: ExpenseRequest) => void;
  onOpenNewRequest: () => void;
}

export const ExpenseRequestsList: React.FC<ExpenseRequestsListProps> = ({ 
  onSelectRequest, 
  onOpenNewRequest 
}) => {
  const { 
    requests, 
    activeOrg, 
    activeOrgId, 
    services, 
    providers, 
    currentRole, 
    currentUser,
    paymentAccounts,
    approveRequest,
    rejectRequest,
    requestClarification,
    disburseRequest
  } = useApp();

  const [selectedReqId, setSelectedReqId] = useState<string | null>(null);
  const [copiedText, setCopiedText] = useState(false);

  // Search and Rich Filter States
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [providerFilter, setProviderFilter] = useState<string>('all');
  const [departmentFilter, setDepartmentFilter] = useState<string>('all');
  const [urgencyFilter, setUrgencyFilter] = useState<string>('all');
  const [paymentMethodFilter, setPaymentMethodFilter] = useState<string>('all');
  const [datePeriodFilter, setDatePeriodFilter] = useState<string>('all');

  // Inline Actions States
  const [activeAction, setActiveAction] = useState<'none' | 'approve' | 'reject' | 'clarify' | 'disburse'>('none');
  const [approvalNote, setApprovalNote] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');
  const [clarificationQuestion, setClarificationQuestion] = useState('');

  // Disbursement States
  const [disburseMethod, setDisburseMethod] = useState<PaymentMethod>('instapay');
  const [disburseRefNumber, setDisburseRefNumber] = useState(`TXN-${Math.floor(10000000 + Math.random() * 90000000)}`);
  const [disburseBankName, setDisburseBankName] = useState('انستاباي / المصرف الرئيسي');
  const [disburseNotes, setDisburseNotes] = useState('');
  const [disbursing, setDisbursing] = useState(false);

  // Derive unique departments for filter dropdown
  const uniqueDepartments = useMemo(() => {
    const set = new Set<string>();
    requests.forEach(r => {
      if (r.requesterDepartment) set.add(r.requesterDepartment.trim());
    });
    return Array.from(set);
  }, [requests]);

  // Strict deduplication & comprehensive multi-filter matching
  const filteredRequests = useMemo(() => {
    const seenIds = new Set<string>();
    const seenNumbers = new Set<string>();
    const now = new Date();

    return requests.filter(req => {
      const numKey = (req.requestNumber || '').trim().toUpperCase();
      if (seenIds.has(req.id) || (numKey && seenNumbers.has(numKey))) {
        return false;
      }
      seenIds.add(req.id);
      if (numKey) seenNumbers.add(numKey);

      // Status
      if (statusFilter !== 'all' && req.status !== statusFilter) return false;

      // Category
      if (categoryFilter !== 'all' && req.serviceCategoryId !== categoryFilter) return false;

      // Provider
      if (providerFilter !== 'all' && req.providerId !== providerFilter) return false;

      // Department
      if (departmentFilter !== 'all' && req.requesterDepartment !== departmentFilter) return false;

      // Urgency
      if (urgencyFilter !== 'all' && req.urgency !== urgencyFilter) return false;

      // Payment Method
      if (paymentMethodFilter !== 'all' && req.preferredPaymentMethod !== paymentMethodFilter) return false;

      // Date Period
      if (datePeriodFilter !== 'all') {
        const reqDate = new Date(req.createdAt);
        const diffHours = (now.getTime() - reqDate.getTime()) / (1000 * 60 * 60);
        if (datePeriodFilter === 'today' && diffHours > 24) return false;
        if (datePeriodFilter === 'week' && diffHours > 24 * 7) return false;
        if (datePeriodFilter === 'month' && diffHours > 24 * 30) return false;
      }

      // Search (Matches Title, Request Number, Requester, Provider, Justification)
      if (search.trim()) {
        const q = search.toLowerCase().trim();
        const matchTitle = req.title.toLowerCase().includes(q);
        const matchNumber = (req.requestNumber || '').toLowerCase().includes(q);
        const matchRequester = (req.requesterName || '').toLowerCase().includes(q);
        const matchProvider = (req.providerName || '').toLowerCase().includes(q);
        const matchDept = (req.requesterDepartment || '').toLowerCase().includes(q);
        if (!matchTitle && !matchNumber && !matchRequester && !matchProvider && !matchDept) {
          return false;
        }
      }

      return true;
    });
  }, [
    requests, 
    statusFilter, 
    categoryFilter, 
    providerFilter, 
    departmentFilter, 
    urgencyFilter, 
    paymentMethodFilter, 
    datePeriodFilter, 
    search
  ]);

  // Selected Active Request for Deep Tracking Workspace
  const activeRequest: ExpenseRequest | undefined = useMemo(() => {
    if (selectedReqId) {
      const found = filteredRequests.find(r => r.id === selectedReqId) || requests.find(r => r.id === selectedReqId);
      if (found) return found;
    }
    return filteredRequests[0];
  }, [selectedReqId, filteredRequests, requests]);

  // Synchronize disburse method with request preference when activeRequest changes
  React.useEffect(() => {
    if (activeRequest?.preferredPaymentMethod) {
      setDisburseMethod(activeRequest.preferredPaymentMethod);
    }
    setActiveAction('none');
  }, [activeRequest?.id]);

  // Copy Bank Account Details to Clipboard
  const handleCopyAccountDetails = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedText(true);
    setTimeout(() => setCopiedText(false), 2000);
  };

  // Inline Action Handlers
  const handleApprove = async () => {
    if (!activeRequest) return;
    await approveRequest(activeRequest.id, approvalNote.trim() || undefined);
    setApprovalNote('');
    setActiveAction('none');
  };

  const handleReject = async () => {
    if (!activeRequest || !rejectionReason.trim()) return;
    await rejectRequest(activeRequest.id, rejectionReason.trim());
    setRejectionReason('');
    setActiveAction('none');
  };

  const handleClarify = async () => {
    if (!activeRequest || !clarificationQuestion.trim()) return;
    await requestClarification(activeRequest.id, clarificationQuestion.trim());
    setClarificationQuestion('');
    setActiveAction('none');
  };

  const handleDisburse = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeRequest || !disburseRefNumber.trim()) return;

    setDisbursing(true);
    try {
      await disburseRequest(activeRequest.id, {
        paymentMethod: disburseMethod,
        referenceNumber: disburseRefNumber.trim(),
        bankName: disburseBankName.trim() || 'المصرف الرئيسي',
        notes: disburseNotes.trim() || undefined,
      });
      setActiveAction('none');
      setDisburseNotes('');
    } catch (err) {
      console.error('[Disbursement Error]', err);
    } finally {
      setDisbursing(false);
    }
  };

  // Financial KPIs Calculations
  const totalAmount = requests.reduce((sum, r) => sum + r.amount, 0);
  const totalDisbursed = requests
    .filter(r => r.status === 'disbursed')
    .reduce((sum, r) => sum + r.amount, 0);
  const totalApproved = requests
    .filter(r => r.status === 'approved')
    .reduce((sum, r) => sum + r.amount, 0);
  const totalPending = requests
    .filter(r => r.status === 'pending' || r.status === 'clarification_requested')
    .reduce((sum, r) => sum + r.amount, 0);

  const approvedToDisburseCount = requests.filter(r => r.status === 'approved').length;
  const currency = activeOrg?.currency || requests[0]?.currency || 'EGP';

  const getStatusBadge = (status: ExpenseRequest['status']) => {
    switch (status) {
      case 'pending':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-50 text-amber-700 border border-amber-200">
            <Clock className="h-3 w-3 animate-spin" />
            <span>قيد المراجعة</span>
          </span>
        );
      case 'clarification_requested':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-rose-50 text-rose-700 border border-rose-200 animate-pulse">
            <AlertCircle className="h-3 w-3" />
            <span>مطلوب توضيح</span>
          </span>
        );
      case 'approved':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-50 text-blue-700 border border-blue-200">
            <CheckCircle2 className="h-3 w-3" />
            <span>معتمد للصرف</span>
          </span>
        );
      case 'disbursed':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 shadow-2xs">
            <Check className="h-3 w-3" />
            <span>تم الصرف والتحويل ✓</span>
          </span>
        );
      case 'rejected':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-slate-100 text-slate-700 border border-slate-200">
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
    if (method === 'cash') {
      return (
        <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-md border border-amber-200">
          <CreditCard className="h-3 w-3" />
          <span>نقداً من الخزينة</span>
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

  const getUrgencyBadge = (urgency?: string) => {
    if (urgency === 'high') {
      return (
        <span className="inline-flex items-center gap-1 text-[10px] font-black text-rose-700 bg-rose-50 px-2 py-0.5 rounded-full border border-rose-200">
          <Flame className="h-2.5 w-2.5 fill-rose-500" />
          <span>عاجل وهام</span>
        </span>
      );
    }
    if (urgency === 'medium') {
      return (
        <span className="text-[10px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
          متوسط
        </span>
      );
    }
    return (
      <span className="text-[10px] font-medium text-slate-600 bg-slate-100 px-2 py-0.5 rounded-full">
        عادي
      </span>
    );
  };

  return (
    <div className="space-y-6 pb-12">
      
      {/* Top Financial Metrics Bar */}
      <div className="bg-gradient-to-l from-slate-900 via-indigo-950 to-slate-900 text-white rounded-3xl p-6 sm:p-8 shadow-xl border border-slate-800 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-80 h-80 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none"></div>
        
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <div className="flex items-center gap-2">
              <span className="bg-indigo-500/20 text-indigo-300 border border-indigo-400/30 text-[11px] px-3 py-1 rounded-full font-bold flex items-center gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5 text-indigo-400" />
                <span>مركز الاعتماد وإجراءات الصرف والتحويل — {activeOrg?.name || 'الشركة'}</span>
              </span>
              {approvedToDisburseCount > 0 && (
                <span className="bg-emerald-500 text-slate-950 font-black text-[11px] px-2.5 py-0.5 rounded-full animate-bounce shadow-md">
                  {approvedToDisburseCount} طلبات جاهزة للصرف
                </span>
              )}
            </div>

            <h1 className="text-2xl sm:text-3xl font-black mt-2 tracking-tight">
              سجل وإدارة طلبات المصروفات
            </h1>
            <p className="text-xs sm:text-sm text-slate-300 mt-1 max-w-2xl leading-relaxed">
              {currentRole === 'finance' 
                ? 'مرحباً بك كمسؤول الصرف والخزينة، راجع بيانات التحويل المصرفية والآيبان للطلبات المعتمدة ونفذ الصرف المالي مع إصدار إشعار التحويل الرسمي.'
                : 'استعراض وتدقيق طلبات الصرف المالي، التحقق من بيانات التحويل المصرفية، واتخاذ قرارات الاعتماد أو طلب التوضيحات فوراً.'}
            </p>
          </div>

          <button
            type="button"
            onClick={onOpenNewRequest}
            className="flex items-center gap-2 bg-gradient-to-r from-emerald-500 to-teal-400 hover:from-emerald-400 hover:to-teal-300 text-slate-950 font-black text-sm px-6 py-3.5 rounded-2xl shadow-xl shadow-emerald-500/20 transition cursor-pointer self-start md:self-auto shrink-0 active:scale-98"
          >
            <Plus className="h-5 w-5 stroke-[2.5]" />
            <span>إنشاء طلب صرف جديد</span>
          </button>
        </div>

        {/* 4 Financial KPI Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-6 pt-6 border-t border-slate-800/80">
          <div className="bg-slate-950/60 backdrop-blur-md p-4 rounded-2xl border border-slate-800">
            <span className="text-[11px] text-slate-400 block mb-1">إجمالي المبالغ المنصرفة</span>
            <div className="flex items-baseline gap-1.5 text-lg sm:text-xl font-black text-emerald-400">
              <span>{totalDisbursed.toLocaleString()}</span>
              <span className="text-xs text-slate-400 font-semibold">{currency}</span>
            </div>
          </div>

          <div className="bg-slate-950/60 backdrop-blur-md p-4 rounded-2xl border border-slate-800">
            <span className="text-[11px] text-slate-400 block mb-1">مبالغ معتمدة بانتظار الصرف</span>
            <div className="flex items-baseline gap-1.5 text-lg sm:text-xl font-black text-blue-400">
              <span>{totalApproved.toLocaleString()}</span>
              <span className="text-xs text-slate-400 font-semibold">{currency}</span>
            </div>
          </div>

          <div className="bg-slate-950/60 backdrop-blur-md p-4 rounded-2xl border border-slate-800">
            <span className="text-[11px] text-slate-400 block mb-1">مبالغ قيد فحص الإدارة</span>
            <div className="flex items-baseline gap-1.5 text-lg sm:text-xl font-black text-amber-400">
              <span>{totalPending.toLocaleString()}</span>
              <span className="text-xs text-slate-400 font-semibold">{currency}</span>
            </div>
          </div>

          <div className="bg-slate-950/60 backdrop-blur-md p-4 rounded-2xl border border-slate-800">
            <span className="text-[11px] text-slate-400 block mb-1">إجمالي المطالبات المسجلة</span>
            <div className="flex items-baseline gap-1.5 text-lg sm:text-xl font-black text-white">
              <span>{requests.length}</span>
              <span className="text-xs text-slate-400 font-semibold">طلب ({totalAmount.toLocaleString()} {currency})</span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Split-Screen Workspace (Matching RequesterTracker Layout) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Right Column: Search, Rich Dropdown Filters, and Scrollable Request Cards (5 Cols) */}
        <div className="lg:col-span-5 space-y-4">
          
          {/* Search & Advanced Filters Container */}
          <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200/80 shadow-xs space-y-3">
            
            {/* Search Input */}
            <div className="relative">
              <Search className="h-4 w-4 text-slate-400 absolute right-3 top-3" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="بحث برقم الطلب، الموظف، المورد، أو العنوان..."
                className="w-full pl-3 pr-9 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition font-medium"
              />
            </div>

            {/* Status Pills */}
            <div className="flex flex-wrap gap-1.5 text-xs pt-1">
              {[
                { id: 'all', label: 'الكل' },
                { id: 'approved', label: 'جاهز للصرف 💸' },
                { id: 'pending', label: 'قيد المراجعة' },
                { id: 'clarification_requested', label: 'توضيح مطلوب ⚠️' },
                { id: 'disbursed', label: 'تم الصرف ✓' },
                { id: 'rejected', label: 'مرفوض' },
              ].map((pill) => (
                <button
                  key={pill.id}
                  type="button"
                  onClick={() => setStatusFilter(pill.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer ${
                    statusFilter === pill.id
                      ? 'bg-slate-900 text-white font-bold shadow-xs'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {pill.label}
                </button>
              ))}
            </div>

            {/* Rich Dropdown Filters (Department, Category, Provider, Urgency, Payment Method, Date Range) */}
            <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-100 text-xs">
              {/* Department Dropdown */}
              <div>
                <label className="block text-[11px] font-bold text-slate-500 mb-1">القسم / الإدارة:</label>
                <select
                  value={departmentFilter}
                  onChange={(e) => setDepartmentFilter(e.target.value)}
                  className="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl outline-none font-semibold text-slate-800"
                >
                  <option value="all">كل الأقسام</option>
                  {uniqueDepartments.map(d => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </div>

              {/* Service Category Dropdown */}
              <div>
                <label className="block text-[11px] font-bold text-slate-500 mb-1">بند الخدمة:</label>
                <select
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  className="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl outline-none font-semibold text-slate-800"
                >
                  <option value="all">كافة بنود الصرف</option>
                  {services.map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>

              {/* Provider / Vendor Dropdown */}
              <div>
                <label className="block text-[11px] font-bold text-slate-500 mb-1">مقدم الخدمة:</label>
                <select
                  value={providerFilter}
                  onChange={(e) => setProviderFilter(e.target.value)}
                  className="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl outline-none font-semibold text-slate-800"
                >
                  <option value="all">كافة الموردين</option>
                  {providers.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>

              {/* Payment Method Dropdown */}
              <div>
                <label className="block text-[11px] font-bold text-slate-500 mb-1">طريقة الصرف:</label>
                <select
                  value={paymentMethodFilter}
                  onChange={(e) => setPaymentMethodFilter(e.target.value)}
                  className="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl outline-none font-semibold text-slate-800"
                >
                  <option value="all">كل وسائل الدفع</option>
                  <option value="instapay">انستاباي (InstaPay)</option>
                  <option value="bank_transfer">تحويل بنكي (IBAN)</option>
                  <option value="digital_wallet">محفظة إلكترونية</option>
                  <option value="cash">نقداً من الخزينة</option>
                </select>
              </div>

              {/* Urgency Dropdown */}
              <div>
                <label className="block text-[11px] font-bold text-slate-500 mb-1">مستوى الأهمية:</label>
                <select
                  value={urgencyFilter}
                  onChange={(e) => setUrgencyFilter(e.target.value)}
                  className="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl outline-none font-semibold text-slate-800"
                >
                  <option value="all">كل السرعات</option>
                  <option value="high">🔴 عاجل وهام</option>
                  <option value="medium">🟡 متوسط</option>
                  <option value="low">🟢 عادي</option>
                </select>
              </div>

              {/* Date Period Dropdown */}
              <div>
                <label className="block text-[11px] font-bold text-slate-500 mb-1">الفترة الزمنية:</label>
                <select
                  value={datePeriodFilter}
                  onChange={(e) => setDatePeriodFilter(e.target.value)}
                  className="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl outline-none font-semibold text-slate-800"
                >
                  <option value="all">كامل السجل</option>
                  <option value="today">اليوم (آخر 24 ساعة)</option>
                  <option value="week">آخر 7 أيام</option>
                  <option value="month">هذا الشهر (آخر 30 يوماً)</option>
                </select>
              </div>
            </div>

            {/* Results count & reset filters */}
            <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-xs text-slate-500">
              <span>النتائج المعروضة: <strong>{filteredRequests.length}</strong> طلب</span>
              {(statusFilter !== 'all' || categoryFilter !== 'all' || providerFilter !== 'all' || departmentFilter !== 'all' || urgencyFilter !== 'all' || paymentMethodFilter !== 'all' || datePeriodFilter !== 'all' || search) && (
                <button
                  type="button"
                  onClick={() => {
                    setStatusFilter('all');
                    setCategoryFilter('all');
                    setProviderFilter('all');
                    setDepartmentFilter('all');
                    setUrgencyFilter('all');
                    setPaymentMethodFilter('all');
                    setDatePeriodFilter('all');
                    setSearch('');
                  }}
                  className="text-indigo-600 hover:text-indigo-800 font-bold cursor-pointer"
                >
                  إعادة ضبط الفلاتر ↺
                </button>
              )}
            </div>

          </div>

          {/* Cards List */}
          <div className="space-y-3">
            {filteredRequests.map((req) => {
              const isSelected = activeRequest?.id === req.id;
              const hasClarification = req.status === 'clarification_requested';
              const isApproved = req.status === 'approved';

              return (
                <div
                  key={req.id}
                  onClick={() => setSelectedReqId(req.id)}
                  className={`p-4 rounded-2xl border transition cursor-pointer relative ${
                    isSelected
                      ? 'bg-indigo-50/50 border-indigo-500 ring-2 ring-indigo-500/20 shadow-md'
                      : isApproved
                      ? 'bg-blue-50/20 border-blue-200 hover:border-blue-400 shadow-2xs'
                      : 'bg-white border-slate-200 hover:border-slate-300 shadow-2xs'
                  }`}
                >
                  {hasClarification && (
                    <span className="absolute top-3 left-3 h-2.5 w-2.5 rounded-full bg-rose-500 animate-ping"></span>
                  )}

                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-bold text-slate-500">{req.requestNumber}</span>
                      {getUrgencyBadge(req.urgency)}
                    </div>
                    {getStatusBadge(req.status)}
                  </div>

                  <h4 className="font-bold text-slate-900 text-sm mt-2 line-clamp-1">{req.title}</h4>

                  <div className="flex items-center justify-between text-xs text-slate-500 mt-2">
                    <div className="flex items-center gap-1.5 font-medium text-slate-700">
                      <UserIcon className="h-3.5 w-3.5 text-slate-400" />
                      <span>{req.requesterName}</span>
                      {req.requesterDepartment && (
                        <span className="text-[10px] text-slate-400">({req.requesterDepartment})</span>
                      )}
                    </div>
                    <span className="text-[11px] text-slate-400">{req.createdAt.split('T')[0]}</span>
                  </div>

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
                <p className="font-bold text-slate-700 text-sm">لا توجد طلبات تطابق الفلترة المحددة</p>
                <p className="text-xs text-slate-400 mt-1">جرّب تغيير خيارات البحث أو إعادة ضبط الفلاتر.</p>
              </div>
            )}
          </div>

        </div>

        {/* Left Column: Deep Tracking and Action Workspace (7 Cols) */}
        <div className="lg:col-span-7">
          {activeRequest ? (
            <div className="bg-white rounded-3xl border border-slate-200/80 shadow-xs p-6 sm:p-7 space-y-6">
              
              {/* Active Request Header Info */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-xs font-bold text-slate-500">{activeRequest.requestNumber}</span>
                    <span className="text-xs text-slate-400">• تاريخ التقديم: {activeRequest.createdAt.split('T')[0]}</span>
                    {getUrgencyBadge(activeRequest.urgency)}
                  </div>
                  <h2 className="text-lg font-black text-slate-900 mt-1">{activeRequest.title}</h2>
                  <div className="text-xs text-slate-500 mt-1 flex items-center gap-2">
                    <span>مقدم الطلب: <strong className="text-slate-800">{activeRequest.requesterName}</strong></span>
                    {activeRequest.requesterDepartment && <span>• القسم: <strong>{activeRequest.requesterDepartment}</strong></span>}
                    {activeRequest.requesterEmail && <span className="font-mono text-[11px] text-slate-400">({activeRequest.requesterEmail})</span>}
                  </div>
                </div>

                <div className="text-left shrink-0">
                  <div className="text-2xl font-black text-slate-900">
                    {activeRequest.amount.toLocaleString()} <span className="text-sm font-semibold text-slate-500">{activeRequest.currency}</span>
                  </div>
                  <div className="mt-1">{getStatusBadge(activeRequest.status)}</div>
                </div>
              </div>

              {/* Visual 4-Step Lifecycle Stepper */}
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
                      <span className="text-xs font-bold text-slate-800 mt-2">إتمام الصرف</span>
                      <span className="text-[10px] text-slate-400 font-medium">
                        {activeRequest.status === 'disbursed' ? 'تم الصرف بنجاح' : 'غير مكتمل'}
                      </span>
                    </div>

                  </div>
                </div>
              </div>

              {/* Bank Account & InstaPay Transfer Box (With 1-Click Copy Button) */}
              <div className="bg-emerald-50/70 border border-emerald-200 rounded-2xl p-4 sm:p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 font-black text-emerald-950 text-xs">
                    <CreditCard className="h-4 w-4 text-emerald-700" />
                    <span>بيانات المستفيد للتحويل البنكي والصرف (Recipient Payment Data)</span>
                  </div>
                  {activeRequest.paymentAccountDetails && (
                    <button
                      type="button"
                      onClick={() => handleCopyAccountDetails(activeRequest.paymentAccountDetails!)}
                      className="flex items-center gap-1 text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-3 py-1.5 rounded-lg transition cursor-pointer shadow-xs"
                    >
                      {copiedText ? (
                        <>
                          <Check className="h-3.5 w-3.5" />
                          <span>تم النسخ بنجاح ✓</span>
                        </>
                      ) : (
                        <>
                          <Copy className="h-3.5 w-3.5" />
                          <span>نسخ بيانات التحويل</span>
                        </>
                      )}
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                  <div className="bg-white p-3 rounded-xl border border-emerald-100">
                    <span className="text-slate-400 block mb-0.5">وسيلة الدفع المطلوبة:</span>
                    <span className="font-bold text-slate-900">
                      {getMethodBadge(activeRequest.preferredPaymentMethod)}
                    </span>
                  </div>

                  <div className="bg-white p-3 rounded-xl border border-emerald-100 sm:col-span-2">
                    <span className="text-slate-400 block mb-0.5">
                      {activeRequest.preferredPaymentMethod === 'instapay' ? 'عنوان انستاباي / رقم الهاتف:' :
                       activeRequest.preferredPaymentMethod === 'digital_wallet' ? 'رقم المحفظة الإلكترونية:' :
                       activeRequest.preferredPaymentMethod === 'bank_transfer' ? 'رقم الآيبان (IBAN) / الحساب:' : 'جهة الاستلام:'}
                    </span>
                    <span className="font-mono font-black text-emerald-900 text-xs sm:text-sm select-all">
                      {activeRequest.paymentAccountDetails || 'لم يتم إدخال تفاصيل'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Request Metadata Details */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200/80">
                  <span className="text-slate-500 font-bold block mb-1">بند الخدمة ومركز التكلفة:</span>
                  <span className="font-bold text-slate-800 text-xs">{activeRequest.serviceCategoryName}</span>
                </div>

                <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200/80">
                  <span className="text-slate-500 font-bold block mb-1">مقدم الخدمة / المورد:</span>
                  <span className="font-bold text-slate-800 text-xs">{activeRequest.providerName}</span>
                </div>

                <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200/80 sm:col-span-2">
                  <span className="text-slate-500 font-bold block mb-1">المبرر المالي للطلب:</span>
                  <p className="text-slate-700 leading-relaxed font-medium">{activeRequest.justification}</p>
                </div>

                <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200/80 sm:col-span-2">
                  <span className="text-slate-500 font-bold block mb-1">المواصفات والشرح التفصيلي:</span>
                  <p className="text-slate-700 leading-relaxed">{activeRequest.description}</p>
                </div>
              </div>

              {/* Official Payment Advice Receipt (When Disbursed) */}
              {activeRequest.status === 'disbursed' && activeRequest.disbursement && (
                <div className="bg-emerald-50/80 border-2 border-emerald-300 rounded-3xl p-6 space-y-4 shadow-sm animate-in fade-in duration-200">
                  <div className="flex items-center justify-between pb-3 border-b border-emerald-200">
                    <div className="flex items-center gap-2.5 text-emerald-950 font-black text-sm sm:text-base">
                      <div className="h-9 w-9 rounded-xl bg-emerald-600 text-white flex items-center justify-center shadow-md">
                        <CreditCard className="h-5 w-5" />
                      </div>
                      <div>
                        <span>إشعار التحويل البنكي الرسمي (Payment Advice)</span>
                        <div className="text-[11px] text-emerald-700 font-normal">تمت تسوية وصرف المبلغ رسمياً وتحديث الميزانية</div>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => window.print()}
                      className="flex items-center gap-1 px-3 py-1.5 bg-white hover:bg-emerald-100 text-emerald-800 rounded-xl font-bold text-xs border border-emerald-200 transition cursor-pointer"
                    >
                      <Printer className="h-3.5 w-3.5" />
                      <span>طباعة السند</span>
                    </button>
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
                      <span className="font-mono font-black text-emerald-800 text-xs select-all">
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

              {/* ACTION PANELS ACCORDING TO ROLES */}
              <div className="pt-4 border-t border-slate-100 space-y-4">
                
                {/* 1. If Manager / Admin: Can Approve, Clarify, or Reject */}
                {(currentRole === 'org_admin' || currentRole === 'super_admin') && 
                 (activeRequest.status === 'pending' || activeRequest.status === 'clarification_requested') && (
                  <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-3">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <span className="text-xs font-bold text-slate-700">اتخاذ إجراء إداري على هذا الطلب:</span>
                      
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setActiveAction(activeAction === 'approve' ? 'none' : 'approve')}
                          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-xs flex items-center gap-1.5 transition cursor-pointer"
                        >
                          <CheckCircle2 className="h-4 w-4" />
                          <span>اعتماد الطلب ✓</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => setActiveAction(activeAction === 'clarify' ? 'none' : 'clarify')}
                          className="px-3.5 py-2 bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs rounded-xl shadow-xs flex items-center gap-1.5 transition cursor-pointer"
                        >
                          <HelpCircle className="h-4 w-4" />
                          <span>طلب توضيح ⚠️</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => setActiveAction(activeAction === 'reject' ? 'none' : 'reject')}
                          className="px-3.5 py-2 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs rounded-xl shadow-xs flex items-center gap-1.5 transition cursor-pointer"
                        >
                          <XCircle className="h-4 w-4" />
                          <span>رفض ✕</span>
                        </button>
                      </div>
                    </div>

                    {/* Approve Form */}
                    {activeAction === 'approve' && (
                      <div className="mt-3 p-4 bg-emerald-50 rounded-xl border border-emerald-200 space-y-3 animate-in fade-in duration-150">
                        <h5 className="font-bold text-emerald-950 text-xs">
                          تأكيد اعتماد الطلب بمبلغ {activeRequest.amount.toLocaleString()} {activeRequest.currency}
                        </h5>
                        <input
                          type="text"
                          value={approvalNote}
                          onChange={(e) => setApprovalNote(e.target.value)}
                          placeholder="ملاحظات الاعتماد (اختياري)..."
                          className="w-full p-2.5 bg-white border border-emerald-200 rounded-xl text-xs outline-none"
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
                            type="button"
                            onClick={handleApprove}
                            className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-lg shadow-xs cursor-pointer"
                          >
                            تأكيد الاعتماد المالي
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Clarify Form */}
                    {activeAction === 'clarify' && (
                      <div className="mt-3 p-4 bg-amber-50 rounded-xl border border-amber-200 space-y-3 animate-in fade-in duration-150">
                        <h5 className="font-bold text-amber-950 text-xs">طلب مستندات أو استفسار من طالب الصرف:</h5>
                        <textarea
                          rows={2}
                          value={clarificationQuestion}
                          onChange={(e) => setClarificationQuestion(e.target.value)}
                          placeholder="اكتب استفسارك بدقة للموظف هنا..."
                          className="w-full p-2.5 bg-white border border-amber-200 rounded-xl text-xs outline-none"
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
                            type="button"
                            onClick={handleClarify}
                            className="px-4 py-1.5 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs rounded-lg shadow-xs cursor-pointer"
                          >
                            إرسال الاستفسار
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Reject Form */}
                    {activeAction === 'reject' && (
                      <div className="mt-3 p-4 bg-rose-50 rounded-xl border border-rose-200 space-y-3 animate-in fade-in duration-150">
                        <h5 className="font-bold text-rose-950 text-xs">تأكيد رفض طلب الصرف:</h5>
                        <input
                          type="text"
                          required
                          value={rejectionReason}
                          onChange={(e) => setRejectionReason(e.target.value)}
                          placeholder="اكتب سبب الرفض بوضوح للموظف..."
                          className="w-full p-2.5 bg-white border border-rose-200 rounded-xl text-xs outline-none"
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
                            type="button"
                            onClick={handleReject}
                            className="px-4 py-1.5 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs rounded-lg shadow-xs cursor-pointer"
                          >
                            تأكيد الرفض
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* 2. If Finance Role: Notice when request is awaiting admin approval */}
                {currentRole === 'finance' && 
                 (activeRequest.status === 'pending' || activeRequest.status === 'clarification_requested') && (
                  <div className="p-4 bg-amber-50/80 border border-amber-200 rounded-2xl flex items-center gap-3 text-xs text-amber-900">
                    <AlertCircle className="h-5 w-5 text-amber-600 shrink-0" />
                    <div>
                      <span className="font-bold block">هذا الطلب بانتظار اعتماد مدير المؤسسة أولاً.</span>
                      <span className="text-[11px] text-amber-700">
                        بصفتك مسؤول الصرف والخزينة، ستتمكن من تنفيذ التحويل المالي وإصدار الإشعار فور صدور اعتماد الإدارة.
                      </span>
                    </div>
                  </div>
                )}

                {/* 3. Both Finance & Admin: When Request is Approved -> Prominent Disbursement Action */}
                {activeRequest.status === 'approved' && (
                  <div className="p-5 bg-gradient-to-r from-blue-50 to-indigo-50 border-2 border-blue-200 rounded-2xl space-y-3">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div>
                        <span className="font-extrabold text-blue-950 text-sm flex items-center gap-1.5">
                          <CheckCircle2 className="h-4 w-4 text-blue-600" />
                          <span>الطلب معتمد ومصرح بصرفه بمبلغ ({activeRequest.amount.toLocaleString()} {activeRequest.currency})</span>
                        </span>
                        <p className="text-xs text-blue-700 mt-0.5">
                          جاهز الآن للتحويل المصرفي إلى حساب المستفيد الموضح أعلاه.
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={() => setActiveAction(activeAction === 'disburse' ? 'none' : 'disburse')}
                        className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-md flex items-center gap-2 transition cursor-pointer"
                      >
                        <CreditCard className="h-4 w-4" />
                        <span>💸 تنفيذ الصرف والتحويل المالي الآن</span>
                      </button>
                    </div>

                    {/* Disbursement Drawer / Form */}
                    {activeAction === 'disburse' && (
                      <form onSubmit={handleDisburse} className="mt-4 p-4 bg-white rounded-2xl border border-blue-200 space-y-4 animate-in fade-in duration-150">
                        <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                          <span className="font-bold text-slate-800 text-xs">بيانات تنفيذ العملية والتحويل المصرفي:</span>
                          <button
                            type="button"
                            onClick={() => setActiveAction('none')}
                            className="text-slate-400 hover:text-slate-600 p-1"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                          {/* Payment Account / Vault */}
                          <div>
                            <label className="block font-bold text-slate-700 mb-1">خزينة / حساب الصرف المحول منه *</label>
                            <select
                              value={disburseBankName}
                              onChange={(e) => setDisburseBankName(e.target.value)}
                              className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold"
                            >
                              {paymentAccounts.length > 0 ? (
                                paymentAccounts.map(acc => (
                                  <option key={acc.id} value={`${acc.name} (${acc.accountIdentifier})`}>
                                    {acc.name} — {acc.type === 'bank' ? 'حساب بنكي' : acc.type === 'instapay' ? 'انستاباي' : 'خزينة'} ({acc.accountIdentifier})
                                  </option>
                                ))
                              ) : (
                                <>
                                  <option value="انستاباي / الحساب المصرفي الرئيسي">انستاباي / الحساب المصرفي الرئيسي</option>
                                  <option value="بنك مصر — الحساب الجاري">بنك مصر — الحساب الجاري</option>
                                  <option value="البنك الأهلي المصري — حساب المصروفات">البنك الأهلي المصري — حساب المصروفات</option>
                                  <option value="الخزينة النقدية الرئيسية (Cash Desk)">الخزينة النقدية الرئيسية (Cash Desk)</option>
                                </>
                              )}
                            </select>
                          </div>

                          {/* Payment Method */}
                          <div>
                            <label className="block font-bold text-slate-700 mb-1">وسيلة التحويل المنفذة *</label>
                            <select
                              value={disburseMethod}
                              onChange={(e: any) => setDisburseMethod(e.target.value)}
                              className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold"
                            >
                              <option value="instapay">انستاباي (InstaPay)</option>
                              <option value="bank_transfer">تحويل بنكي فوري (IBAN)</option>
                              <option value="digital_wallet">محفظة إلكترونية (فودافون كاش / اتصالات / أورانج)</option>
                              <option value="cash">نقداً من الخزينة</option>
                            </select>
                          </div>

                          {/* Reference Number */}
                          <div>
                            <label className="block font-bold text-slate-700 mb-1">رقم مرجع / كود العملية البنكية *</label>
                            <div className="flex gap-2">
                              <input
                                type="text"
                                required
                                value={disburseRefNumber}
                                onChange={(e) => setDisburseRefNumber(e.target.value)}
                                placeholder="مثال: TXN-94827103"
                                className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono text-xs font-bold"
                              />
                              <button
                                type="button"
                                onClick={() => setDisburseRefNumber(`TXN-${Math.floor(10000000 + Math.random() * 90000000)}`)}
                                className="px-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl text-[11px] font-bold shrink-0"
                                title="توليد رقم مرجعي عشوائي"
                              >
                                توليد ↺
                              </button>
                            </div>
                          </div>

                          {/* Notes */}
                          <div>
                            <label className="block font-bold text-slate-700 mb-1">ملاحظات التحويل</label>
                            <input
                              type="text"
                              value={disburseNotes}
                              onChange={(e) => setDisburseNotes(e.target.value)}
                              placeholder="مثال: تم إرسال الإشعار للموظف عبر رسالة بنكية"
                              className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs"
                            />
                          </div>
                        </div>

                        <div className="flex items-center justify-end gap-2 pt-2">
                          <button
                            type="button"
                            onClick={() => setActiveAction('none')}
                            className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-xl font-bold text-xs"
                          >
                            إلغاء
                          </button>
                          <button
                            type="submit"
                            disabled={disbursing}
                            className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-md transition cursor-pointer disabled:opacity-50 flex items-center gap-2"
                          >
                            {disbursing ? 'جاري تسجيل الصرف...' : 'تأكيد وإتمام الصرف المالي ✓'}
                          </button>
                        </div>
                      </form>
                    )}
                  </div>
                )}

                {/* Open Modal Full Details Link */}
                <div className="flex justify-end pt-2">
                  <button
                    type="button"
                    onClick={() => onSelectRequest(activeRequest)}
                    className="inline-flex items-center gap-1.5 text-xs text-indigo-600 hover:text-indigo-800 font-bold hover:underline cursor-pointer"
                  >
                    <Eye className="h-3.5 w-3.5" />
                    <span>عرض سجل التفاعلات والتعليقات والملفات بالتفصيل في نافذة منبثقة</span>
                  </button>
                </div>

              </div>

            </div>
          ) : (
            <div className="bg-white rounded-3xl border border-slate-200 p-12 text-center">
              <FileText className="h-10 w-10 text-slate-300 mx-auto mb-3" />
              <h3 className="font-bold text-slate-700 text-base">اختر طلباً من القائمة لعرض تفاصيل التتبع والصرف</h3>
              <p className="text-xs text-slate-400 mt-1">يمكنك استخدام الفلاتر على اليمين للعثور على الطلبات المطلوبة بدقة.</p>
            </div>
          )}
        </div>

      </div>

    </div>
  );
};
