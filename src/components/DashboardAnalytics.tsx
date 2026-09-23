import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { 
  DollarSign, 
  TrendingUp, 
  Clock, 
  AlertCircle, 
  CheckCircle2, 
  Layers, 
  Building2, 
  FileSpreadsheet, 
  ArrowUpRight,
  Filter,
  CreditCard,
  Calendar,
  ChevronDown,
  X,
  RotateCcw,
  CalendarRange,
  Wallet
} from 'lucide-react';
import { 
  ResponsiveContainer, 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  Tooltip, 
  PieChart, 
  Pie, 
  Cell, 
  Legend 
} from 'recharts';
import { ExpenseRequest } from '../types';

interface DashboardAnalyticsProps {
  onSelectRequest: (request: ExpenseRequest) => void;
  onOpenNewRequest: () => void;
}

const getNormalizedDateStr = (dateVal: string | undefined): string | null => {
  if (!dateVal) return null;
  const match = String(dateVal).match(/^(\d{4}-\d{2}-\d{2})/);
  if (match) return match[1];
  const d = new Date(dateVal);
  if (isNaN(d.getTime())) return null;
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const formatDateArabic = (dateStr: string) => {
  if (!dateStr) return '';
  try {
    const parts = dateStr.split('-');
    if (parts.length < 3) return dateStr;
    const [y, m, d] = parts;
    const months = [
      'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
      'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'
    ];
    const monthName = months[parseInt(m, 10) - 1] || m;
    return `${parseInt(d, 10)} ${monthName} ${y}`;
  } catch {
    return dateStr;
  }
};

export const DashboardAnalytics: React.FC<DashboardAnalyticsProps> = ({ 
  onSelectRequest, 
  onOpenNewRequest 
}) => {
  const { 
    activeOrg, 
    activeOrgId, 
    organizations, 
    allOrganizations,
    requests, 
    allRequests,
    services, 
    allServices,
    providers, 
    allProviders,
    custodies,
    allCustodies,
    custodySettlements,
    allCustodySettlements,
    currentRole 
  } = useApp();

  const isSuperAdmin = currentRole === 'super_admin';
  const orgList = isSuperAdmin ? (allOrganizations.length > 0 ? allOrganizations : organizations) : organizations;
  const targetRequests = isSuperAdmin 
    ? (activeOrgId === 'all' ? allRequests : allRequests.filter(r => r.orgId === activeOrgId)) 
    : requests;
  const targetCustodies = isSuperAdmin 
    ? (activeOrgId === 'all' ? allCustodies : allCustodies.filter(c => c.orgId === activeOrgId)) 
    : custodies;
  const targetSettlements = isSuperAdmin 
    ? (activeOrgId === 'all' ? allCustodySettlements : allCustodySettlements.filter(s => s.orgId === activeOrgId)) 
    : custodySettlements;
  const currentOrgServices = isSuperAdmin ? (activeOrgId === 'all' ? allServices : allServices.filter(s => !s.orgIds || s.orgIds.includes(activeOrgId))) : services;
  const currentOrgProviders = isSuperAdmin ? (activeOrgId === 'all' ? allProviders : allProviders.filter(p => !p.orgId || p.orgId === activeOrgId)) : providers;

  const [timeFilter, setTimeFilter] = useState<'all' | 'today' | 'month' | 'q3' | 'specific' | 'range'>('all');
  const [specificDate, setSpecificDate] = useState<string>(() => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  });
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [customMode, setCustomMode] = useState<'single' | 'range'>('single');
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);
  const datePickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (datePickerRef.current && !datePickerRef.current.contains(event.target as Node)) {
        setIsDatePickerOpen(false);
      }
    };
    if (isDatePickerOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isDatePickerOpen]);

  const todayStr = useMemo(() => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }, []);

  const isDateInTimeFilter = (dateStr: string | undefined): boolean => {
    if (timeFilter === 'all') return true;
    const normalized = getNormalizedDateStr(dateStr);
    if (!normalized) return false;

    if (timeFilter === 'today') {
      return normalized === todayStr;
    }
    if (timeFilter === 'month') {
      return normalized.startsWith(todayStr.slice(0, 7));
    }
    if (timeFilter === 'q3') {
      return normalized.startsWith('2026-07') || normalized.startsWith('2026-08') || normalized.startsWith('2026-09');
    }
    if (timeFilter === 'specific') {
      return !specificDate || normalized === specificDate;
    }
    if (timeFilter === 'range') {
      if (startDate && normalized < startDate) return false;
      if (endDate && normalized > endDate) return false;
      return true;
    }
    return true;
  };

  // Filter requests reactively according to selected time frame or specific date
  const filteredRequests = useMemo(() => {
    return targetRequests.filter(req => {
      if (timeFilter === 'all') return true;
      const dateToCheck = req.disbursement?.disbursedAt || req.createdAt;
      return isDateInTimeFilter(dateToCheck);
    });
  }, [targetRequests, timeFilter, specificDate, startDate, endDate, todayStr]);

  // Filter custody settlements reactively according to selected time frame or specific date
  const filteredSettlements = useMemo(() => {
    return targetSettlements.filter(stl => {
      if (timeFilter === 'all') return true;
      const dateToCheck = stl.invoiceDate || stl.createdAt;
      return isDateInTimeFilter(dateToCheck);
    });
  }, [targetSettlements, timeFilter, specificDate, startDate, endDate, todayStr]);

  // Filter issued custodies reactively according to selected time frame or specific date
  const filteredCustodies = useMemo(() => {
    return targetCustodies.filter(cus => {
      if (timeFilter === 'all') return true;
      const dateToCheck = cus.issuedAt || cus.createdAt;
      return isDateInTimeFilter(dateToCheck);
    });
  }, [targetCustodies, timeFilter, specificDate, startDate, endDate, todayStr]);

  // Financial Metrics
  const disbursedRequests = filteredRequests.filter(r => r.status === 'disbursed');
  const totalDisbursedRequests = disbursedRequests.reduce((sum, r) => sum + r.amount, 0);

  // Settled Custodies (مصروفات فواتير تسوية العهد النقدية الفعلية)
  const totalSettledCustodies = filteredSettlements.reduce((sum, s) => sum + Number(s.amount || 0), 0);

  // إجمالي المصروف الفعلي الحقيقي = طلبات الصرف المنفذة + فواتير تسوية العهد
  const totalActualExpenses = totalDisbursedRequests + totalSettledCustodies;

  // Requests Pending & Approved
  const approvedRequests = filteredRequests.filter(r => r.status === 'approved');
  const totalApprovedAwaitingDisbursement = approvedRequests.reduce((sum, r) => sum + r.amount, 0);

  const pendingRequests = filteredRequests.filter(r => r.status === 'pending');
  const totalPending = pendingRequests.reduce((sum, r) => sum + r.amount, 0);

  const clarificationRequests = filteredRequests.filter(r => r.status === 'clarification_requested');
  const rejectedRequests = filteredRequests.filter(r => r.status === 'rejected');

  // Custodies Breakdown
  const activeCustodies = filteredCustodies.filter(c => c.status === 'active');
  const totalActiveCustodiesRemaining = activeCustodies.reduce((sum, c) => sum + Number(c.remainingAmount || 0), 0);
  const totalCustodiesIssued = filteredCustodies.reduce((sum, c) => sum + Number(c.totalAmount || 0), 0);

  // Total budget
  const totalBudget = activeOrgId === 'all' 
    ? orgList.reduce((sum, o) => sum + o.budget, 0)
    : (activeOrg?.budget || 0);

  const remainingBudget = Math.max(0, totalBudget - totalActualExpenses);
  const budgetUtilization = totalBudget > 0 ? Math.min(100, Math.round((totalActualExpenses / totalBudget) * 100)) : 0;
  const currency = activeOrg?.currency || 'EGP';

  // Chart 1: Expenses by Service Category (Combines Requests + Custody Settlements)
  const serviceChartData = currentOrgServices.map(srv => {
    const requestsSpent = filteredRequests
      .filter(r => r.serviceCategoryId === srv.id && r.status === 'disbursed')
      .reduce((sum, r) => sum + r.amount, 0);

    const custodySpent = filteredSettlements
      .filter(s => s.serviceCategoryId === srv.id)
      .reduce((sum, s) => sum + Number(s.amount || 0), 0);

    const totalSpent = requestsSpent + custodySpent;

    return {
      name: srv.name.length > 18 ? srv.name.slice(0, 18) + '...' : srv.name,
      fullName: srv.name,
      spent: totalSpent,
      requestsSpent,
      custodySpent,
      budget: srv.budgetLimit || 0,
    };
  }).filter(item => item.spent > 0 || item.budget > 0);

  // Chart 2: Status Distribution (All financial operations)
  const statusColors: Record<string, string> = {
    'طلبات تم صرفها': '#10b981',
    'فواتير عُهد مسواة': '#059669',
    'معتمد للصرف': '#3b82f6',
    'قيد المراجعة': '#f59e0b',
    'عُهد جارية مع الموظفين': '#8b5cf6',
    'طلب توضيح': '#ef4444',
    'مرفوض': '#94a3b8',
  };

  const statusData = [
    { name: 'طلبات تم صرفها', count: disbursedRequests.length, amount: totalDisbursedRequests },
    { name: 'فواتير عُهد مسواة', count: filteredSettlements.length, amount: totalSettledCustodies },
    { name: 'معتمد للصرف', count: approvedRequests.length, amount: totalApprovedAwaitingDisbursement },
    { name: 'قيد المراجعة', count: pendingRequests.length, amount: totalPending },
    { name: 'عُهد جارية مع الموظفين', count: activeCustodies.length, amount: totalActiveCustodiesRemaining },
    { name: 'طلب توضيح', count: clarificationRequests.length, amount: clarificationRequests.reduce((s, r) => s + r.amount, 0) },
    { name: 'مرفوض', count: rejectedRequests.length, amount: rejectedRequests.reduce((s, r) => s + r.amount, 0) },
  ].filter(d => d.count > 0 || d.amount > 0);

  // Chart 3: Expenses by Top Providers (Aggregating Requests + Custody Settlements)
  const providerExpenseData = useMemo(() => {
    const vendorMap = new Map<string, { fullName: string; paid: number }>();

    // 1. From requests
    currentOrgProviders.forEach(prov => {
      const paid = filteredRequests
        .filter(r => (r.providerId === prov.id || r.providerName === prov.name) && r.status === 'disbursed')
        .reduce((sum, r) => sum + r.amount, 0);
      if (paid > 0) {
        vendorMap.set(prov.name, { fullName: prov.name, paid });
      }
    });

    // 2. From custody settlements
    filteredSettlements.forEach(s => {
      const vName = (s.vendorName || '').trim();
      if (vName) {
        const existing = vendorMap.get(vName);
        if (existing) {
          existing.paid += Number(s.amount || 0);
        } else {
          vendorMap.set(vName, { fullName: vName, paid: Number(s.amount || 0) });
        }
      }
    });

    return Array.from(vendorMap.values())
      .map(item => ({
        name: item.fullName.length > 16 ? item.fullName.slice(0, 16) + '...' : item.fullName,
        fullName: item.fullName,
        paid: item.paid,
      }))
      .sort((a, b) => b.paid - a.paid)
      .slice(0, 5);
  }, [currentOrgProviders, filteredRequests, filteredSettlements]);

  const exportReport = () => {
    window.print();
  };

  return (
    <div className="space-y-6 pb-12">
      
      {/* Top Welcome & Actions Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-slate-900">
              {activeOrgId === 'all' ? 'لوحة تحليلات كافة المؤسسات' : `لوحة تحليلات ${activeOrg?.name}`}
            </h1>
            <span className="text-xs bg-slate-100 text-slate-700 font-semibold px-2.5 py-0.5 rounded-full border border-slate-200">
              {filteredRequests.length} طلب إجمالي {filteredSettlements.length > 0 ? `(+ ${filteredSettlements.length} تسوية)` : ''}
            </span>
          </div>
          <p className="text-sm text-slate-500 mt-1">
            نظرة تفصيلية على حجم المصروفات والتدفقات المالية ونسب الإنجاز والاعتمادات.
          </p>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          <div className="flex items-center bg-slate-100 p-1 rounded-xl border border-slate-200 text-xs">
            <button
              type="button"
              onClick={() => { setTimeFilter('all'); setIsDatePickerOpen(false); }}
              className={`px-3 py-1.5 rounded-lg font-medium transition cursor-pointer ${
                timeFilter === 'all' ? 'bg-white text-slate-900 shadow-xs font-bold' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              كافة الفترات
            </button>
            <button
              type="button"
              onClick={() => { setTimeFilter('today'); setIsDatePickerOpen(false); }}
              className={`px-3 py-1.5 rounded-lg font-medium transition cursor-pointer ${
                timeFilter === 'today' ? 'bg-white text-slate-900 shadow-xs font-bold' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              اليوم
            </button>
            <button
              type="button"
              onClick={() => { setTimeFilter('month'); setIsDatePickerOpen(false); }}
              className={`px-3 py-1.5 rounded-lg font-medium transition cursor-pointer ${
                timeFilter === 'month' ? 'bg-white text-slate-900 shadow-xs font-bold' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              هذا الشهر
            </button>
            <button
              type="button"
              onClick={() => { setTimeFilter('q3'); setIsDatePickerOpen(false); }}
              className={`px-3 py-1.5 rounded-lg font-medium transition cursor-pointer ${
                timeFilter === 'q3' ? 'bg-white text-slate-900 shadow-xs font-bold' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              الربع الثالث 2026
            </button>

            {/* Specific Date / Range Selector Button */}
            <div className="relative" ref={datePickerRef}>
              <button
                type="button"
                onClick={() => setIsDatePickerOpen(!isDatePickerOpen)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium transition cursor-pointer ${
                  timeFilter === 'specific' || timeFilter === 'range'
                    ? 'bg-indigo-600 text-white shadow-xs font-bold'
                    : 'text-slate-700 hover:bg-white hover:text-slate-900'
                }`}
                title="تحديد تاريخ معين أو فترة زمنية مخصصة"
              >
                <Calendar className="h-3.5 w-3.5" />
                <span>
                  {timeFilter === 'specific' && specificDate
                    ? formatDateArabic(specificDate)
                    : timeFilter === 'range' && startDate && endDate
                    ? `${startDate} ~ ${endDate}`
                    : 'تاريخ محدد 📅'}
                </span>
                <ChevronDown className={`h-3 w-3 transition-transform duration-200 ${isDatePickerOpen ? 'rotate-180' : ''}`} />
              </button>

              {/* Popover Card */}
              {isDatePickerOpen && (
                <div className="absolute left-0 top-full mt-2 w-72 sm:w-80 bg-white rounded-2xl shadow-2xl border border-slate-200 p-4 z-50 text-right">
                  <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                    <span className="font-bold text-slate-900 text-xs flex items-center gap-1.5">
                      <Calendar className="h-4 w-4 text-indigo-600" />
                      <span>تحديد التاريخ أو الفترة الزمنية</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setIsDatePickerOpen(false)}
                      className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  {/* Mode tabs: يوم محدد vs فترة زمنية */}
                  <div className="flex bg-slate-100 p-1 rounded-xl my-3 text-[11px] font-semibold">
                    <button
                      type="button"
                      onClick={() => setCustomMode('single')}
                      className={`flex-1 py-1.5 rounded-lg transition ${
                        customMode === 'single' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                      }`}
                    >
                      يوم محدد (تاريخ معين)
                    </button>
                    <button
                      type="button"
                      onClick={() => setCustomMode('range')}
                      className={`flex-1 py-1.5 rounded-lg transition ${
                        customMode === 'range' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                      }`}
                    >
                      فترة (من - إلى)
                    </button>
                  </div>

                  {customMode === 'single' ? (
                    <div className="space-y-3">
                      <div>
                        <label className="block text-[11px] font-bold text-slate-600 mb-1">
                          اختر اليوم المطلوب:
                        </label>
                        <input
                          type="date"
                          value={specificDate}
                          onChange={(e) => {
                            setSpecificDate(e.target.value);
                            if (e.target.value) {
                              setTimeFilter('specific');
                            }
                          }}
                          className="w-full px-3 py-2 text-xs font-semibold bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-slate-800"
                        />
                      </div>

                      {/* Quick shortcuts */}
                      <div>
                        <span className="text-[10px] text-slate-400 font-bold block mb-1.5">اختصارات سريعة:</span>
                        <div className="flex flex-wrap gap-1 text-[11px]">
                          <button
                            type="button"
                            onClick={() => {
                              setSpecificDate(todayStr);
                              setTimeFilter('specific');
                              setIsDatePickerOpen(false);
                            }}
                            className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-medium cursor-pointer"
                          >
                            اليوم
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const y = new Date();
                              y.setDate(y.getDate() - 1);
                              const yStr = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, '0')}-${String(y.getDate()).padStart(2, '0')}`;
                              setSpecificDate(yStr);
                              setTimeFilter('specific');
                              setIsDatePickerOpen(false);
                            }}
                            className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-medium cursor-pointer"
                          >
                            أمس
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const firstDay = `${todayStr.slice(0, 7)}-01`;
                              setSpecificDate(firstDay);
                              setTimeFilter('specific');
                              setIsDatePickerOpen(false);
                            }}
                            className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-medium cursor-pointer"
                          >
                            أول الشهر
                          </button>
                        </div>
                      </div>

                      <div className="pt-2 flex items-center justify-between border-t border-slate-100">
                        <button
                          type="button"
                          onClick={() => {
                            setTimeFilter('all');
                            setIsDatePickerOpen(false);
                          }}
                          className="text-[11px] text-slate-500 hover:text-slate-800 font-medium cursor-pointer"
                        >
                          إلغاء التحديد
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (specificDate) {
                              setTimeFilter('specific');
                            }
                            setIsDatePickerOpen(false);
                          }}
                          className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-xs cursor-pointer"
                        >
                          تطبيق العرض
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[11px] font-bold text-slate-600 mb-1">
                            من تاريخ:
                          </label>
                          <input
                            type="date"
                            value={startDate}
                            onChange={(e) => setStartDate(e.target.value)}
                            className="w-full px-2 py-2 text-xs font-semibold bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 text-slate-800"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-bold text-slate-600 mb-1">
                            إلى تاريخ:
                          </label>
                          <input
                            type="date"
                            value={endDate}
                            onChange={(e) => setEndDate(e.target.value)}
                            className="w-full px-2 py-2 text-xs font-semibold bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 text-slate-800"
                          />
                        </div>
                      </div>

                      <div className="pt-2 flex items-center justify-between border-t border-slate-100">
                        <button
                          type="button"
                          onClick={() => {
                            setTimeFilter('all');
                            setIsDatePickerOpen(false);
                          }}
                          className="text-[11px] text-slate-500 hover:text-slate-800 font-medium cursor-pointer"
                        >
                          إلغاء التحديد
                        </button>
                        <button
                          type="button"
                          disabled={!startDate && !endDate}
                          onClick={() => {
                            if (startDate || endDate) {
                              setTimeFilter('range');
                            }
                            setIsDatePickerOpen(false);
                          }}
                          className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold shadow-xs cursor-pointer"
                        >
                          تطبيق الفترة
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={exportReport}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg border border-slate-200 transition cursor-pointer"
          >
            <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600" />
            <span>تصدير / طباعة التقرير</span>
          </button>
        </div>
      </div>

      {/* Active Filter Notification Banner */}
      {timeFilter !== 'all' && (
        <div className="flex items-center justify-between bg-indigo-50/80 border border-indigo-200/80 px-4 py-2.5 rounded-2xl text-xs">
          <div className="flex items-center gap-2 text-indigo-900 font-bold flex-wrap">
            <Filter className="h-3.5 w-3.5 text-indigo-600 shrink-0" />
            <span>
              {timeFilter === 'specific' && specificDate
                ? `تصفية نشطة حسب التاريخ المحدد: ${formatDateArabic(specificDate)} (${specificDate})`
                : timeFilter === 'range'
                ? `تصفية نشطة للفترة من ${startDate || 'البداية'} إلى ${endDate || 'اليوم'}`
                : timeFilter === 'today'
                ? `تصفية نشطة: اليوم (${formatDateArabic(todayStr)})`
                : timeFilter === 'month'
                ? 'تصفية نشطة: مصروفات هذا الشهر'
                : 'تصفية نشطة: الربع الثالث 2026'}
            </span>
            <span className="text-indigo-600 font-semibold">
              • تم العثور على {filteredRequests.length + filteredSettlements.length} حركة مالية
            </span>
          </div>
          <button
            type="button"
            onClick={() => setTimeFilter('all')}
            className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold text-indigo-700 hover:text-indigo-900 hover:bg-indigo-100 rounded-lg transition cursor-pointer shrink-0"
          >
            <RotateCcw className="h-3 w-3" />
            <span>عرض كافة الفترات</span>
          </button>
        </div>
      )}

      {/* Empty State Banner if 0 records for this specific date */}
      {(filteredRequests.length + filteredSettlements.length) === 0 && timeFilter !== 'all' && (
        <div className="bg-white border border-slate-200 p-8 rounded-2xl text-center space-y-3 shadow-xs">
          <div className="h-12 w-12 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center mx-auto border border-amber-200">
            <Calendar className="h-6 w-6" />
          </div>
          <h3 className="text-base font-bold text-slate-800">
            لا توجد طلبات أو حركات مسجلة في هذا التاريخ المحدد
          </h3>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            {timeFilter === 'specific' && specificDate 
              ? `لم يتم تسجيل أي طلبات صرف أو عمليات تسوية في يوم ${formatDateArabic(specificDate)} (${specificDate}).`
              : 'لم يتم العثور على أي طلبات أو تسويات خلال الفترة المحددة.'}
          </p>
          <div className="pt-2">
            <button
              type="button"
              onClick={() => setTimeFilter('all')}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow-xs transition cursor-pointer"
            >
              عرض كافة الفترات والطلبات
            </button>
          </div>
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        
        {/* Card 1: Total Actual Disbursed & Settled Expenses */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500">إجمالي المصروف الفعلي</span>
            <div className="h-9 w-9 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center border border-emerald-100">
              <CheckCircle2 className="h-5 w-5" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-black text-slate-900">
              {totalActualExpenses.toLocaleString()} <span className="text-sm font-semibold text-slate-500">{currency}</span>
            </div>
            <div className="text-[11px] text-emerald-700 font-semibold mt-1.5 flex items-center gap-1.5 flex-wrap">
              <span>{disbursedRequests.length} طلبات صرف ({totalDisbursedRequests.toLocaleString()} {currency})</span>
              {totalSettledCustodies > 0 && (
                <span className="bg-emerald-100/80 text-emerald-900 px-1.5 py-0.5 rounded-md font-bold">
                  + {filteredSettlements.length} فواتير تصفية عُهد ({totalSettledCustodies.toLocaleString()} {currency})
                </span>
              )}
            </div>
          </div>
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-emerald-500"></div>
        </div>

        {/* Card 2: Approved Awaiting Disbursement */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500">معتمد وبانتظار الصرف</span>
            <div className="h-9 w-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center border border-blue-100">
              <CreditCard className="h-5 w-5" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-black text-slate-900">
              {totalApprovedAwaitingDisbursement.toLocaleString()} <span className="text-sm font-semibold text-slate-500">{currency}</span>
            </div>
            <div className="text-xs text-blue-600 font-semibold mt-1 flex items-center gap-1">
              <span>{approvedRequests.length} طلبات جاهزة للصرف المالي</span>
            </div>
          </div>
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-blue-500"></div>
        </div>

        {/* Card 3: Pending Manager Review */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500">طلبات بانتظار الاعتماد</span>
            <div className="h-9 w-9 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center border border-amber-100">
              <Clock className="h-5 w-5" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-black text-slate-900">
              {totalPending.toLocaleString()} <span className="text-sm font-semibold text-slate-500">{currency}</span>
            </div>
            <div className="text-xs text-amber-600 font-semibold mt-1 flex items-center gap-1">
              <span>{pendingRequests.length} طلبات جديدة تحت المراجعة</span>
            </div>
          </div>
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-amber-500"></div>
        </div>

        {/* Card 4: Budget Utilization */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500">استهلاك الميزانية الكلية</span>
            <div className="h-9 w-9 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center border border-purple-100">
              <TrendingUp className="h-5 w-5" />
            </div>
          </div>
          <div className="mt-3">
            <div className="flex items-baseline justify-between">
              <div className="text-2xl font-black text-slate-900">
                %{budgetUtilization}
              </div>
              <span className="text-xs text-slate-400 font-medium">
                المتبقي: {remainingBudget.toLocaleString()} {currency}
              </span>
            </div>
            {/* Progress bar */}
            <div className="w-full bg-slate-100 h-2 rounded-full mt-2 overflow-hidden">
              <div 
                className="bg-purple-600 h-full rounded-full transition-all duration-500"
                style={{ width: `${budgetUtilization}%` }}
              ></div>
            </div>
          </div>
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-purple-500"></div>
        </div>

      </div>

      {/* Petty Cash Custodies Live KPI Strip */}
      <div className="bg-gradient-to-r from-slate-900 to-indigo-950 text-white p-4.5 rounded-2xl shadow-sm border border-slate-800 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-white/10 flex items-center justify-center text-indigo-300 shrink-0">
            <Wallet className="h-5 w-5" />
          </div>
          <div>
            <h4 className="font-bold text-sm text-white flex items-center gap-2">
              <span>موقف العهد النقدية وسلف الموظفين</span>
              <span className="text-[10px] bg-indigo-500/30 text-indigo-200 px-2 py-0.5 rounded-full border border-indigo-400/20">
                {filteredCustodies.length} عهدة مسجلة
              </span>
            </h4>
            <p className="text-xs text-slate-300 mt-0.5">
              متابعة مباشرة للعهد المنصرفة، المتبقي قيد التصفية، والمصروفات المسواة فعلياً بالفواتير.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 divide-x divide-x-reverse divide-white/10 text-center">
          <div className="px-2">
            <span className="text-[10.5px] text-slate-300 block">إجمالي المنصرف كعُهد</span>
            <span className="text-sm sm:text-base font-black text-white">
              {totalCustodiesIssued.toLocaleString()} <span className="text-[10px] font-normal text-slate-300">{currency}</span>
            </span>
          </div>
          <div className="px-2">
            <span className="text-[10.5px] text-amber-300 block">جارية مع الموظفين</span>
            <span className="text-sm sm:text-base font-black text-amber-400">
              {totalActiveCustodiesRemaining.toLocaleString()} <span className="text-[10px] font-normal text-amber-200">{currency}</span>
            </span>
          </div>
          <div className="px-2">
            <span className="text-[10.5px] text-emerald-300 block">مسواة بفواتير (مصروف)</span>
            <span className="text-sm sm:text-base font-black text-emerald-400">
              {totalSettledCustodies.toLocaleString()} <span className="text-[10px] font-normal text-emerald-200">{currency}</span>
            </span>
          </div>
        </div>
      </div>

      {/* Action Banner for Clarification Requests */}
      {clarificationRequests.length > 0 && (
        <div className="bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200/80 p-4 rounded-2xl flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-amber-100 text-amber-800 flex items-center justify-center shrink-0">
              <AlertCircle className="h-5 w-5" />
            </div>
            <div>
              <h4 className="font-bold text-amber-900 text-sm">
                يوجد {clarificationRequests.length} طلب مصروفات بحاجة إلى استيفاء وتوضيح
              </h4>
              <p className="text-xs text-amber-700 mt-0.5">
                طلب مدير المؤسسة معلومات إضافية أو عروض أسعار لمراجعتها قبل اتخاذ قرار الاعتماد.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onSelectRequest(clarificationRequests[0])}
            className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs rounded-xl shadow-xs transition cursor-pointer shrink-0"
          >
            عرض الطلبات العالقة
          </button>
        </div>
      )}

      {/* Analytics Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Chart 1: Expenses by Service Category (Bar) */}
        <div className="lg:col-span-2 bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-bold text-slate-900 text-base flex items-center gap-2">
                <Layers className="h-4 w-4 text-emerald-600" />
                <span>تحليل المصروفات والميزانيات حسب بنود الخدمات</span>
              </h3>
              <p className="text-xs text-slate-500">مقارنة المبالغ المصروفة فعلياً (طلبات صرف + فواتير تصفية عُهد) بالميزانية المحددة لكل بند</p>
            </div>
          </div>

          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={serviceChartData} margin={{ top: 10, right: 10, left: 10, bottom: 20 }}>
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#64748b' }} />
                <YAxis tick={{ fontSize: 11, fill: '#64748b' }} />
                <Tooltip 
                  formatter={(value: any, name: any, item: any) => {
                    if (name === 'spent') {
                      const req = item?.payload?.requestsSpent || 0;
                      const cus = item?.payload?.custodySpent || 0;
                      return [
                        `${Number(value).toLocaleString()} ${currency} (طلبات: ${req.toLocaleString()} + عُهد: ${cus.toLocaleString()})`, 
                        'المصروف الفعلي'
                      ];
                    }
                    return [`${Number(value).toLocaleString()} ${currency}`, 'الميزانية المخصصة'];
                  }}
                  labelFormatter={(label, payload) => {
                    const item = payload?.[0]?.payload;
                    return item ? item.fullName : label;
                  }}
                />
                <Bar dataKey="spent" name="المصروف الفعلي" fill="#10b981" radius={[4, 4, 0, 0]} />
                <Bar dataKey="budget" name="الميزانية المخصصة" fill="#e2e8f0" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Chart 2: Status Breakdown (Pie) */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs">
          <div className="mb-4">
            <h3 className="font-bold text-slate-900 text-base">حالات طلبات المصروفات</h3>
            <p className="text-xs text-slate-500">توزيع جميع الطلبات حسب مرحلة الإجراء الحالية</p>
          </div>

          <div className="h-56 w-full flex items-center justify-center">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={statusData}
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={80}
                  paddingAngle={4}
                  dataKey="count"
                >
                  {statusData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={statusColors[entry.name] || '#6366f1'} />
                  ))}
                </Pie>
                <Tooltip formatter={(val: any, name: any) => [`${val} طلب`, name]} />
              </PieChart>
            </ResponsiveContainer>
          </div>

          {/* Custom Status Legend */}
          <div className="grid grid-cols-2 gap-2 mt-3 pt-3 border-t border-slate-100">
            {statusData.map((item) => (
              <div key={item.name} className="flex items-center gap-2 text-xs">
                <span 
                  className="h-2.5 w-2.5 rounded-full shrink-0" 
                  style={{ backgroundColor: statusColors[item.name] || '#6366f1' }}
                ></span>
                <span className="text-slate-600 truncate">{item.name}</span>
                <span className="font-bold text-slate-900 mr-auto">({item.count})</span>
              </div>
            ))}
          </div>
        </div>

      </div>

      {/* Bottom Section: Top Providers & Recent Pending Requests */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* Top Vendors Table */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-bold text-slate-900 text-base flex items-center gap-2">
                <Building2 className="h-4 w-4 text-indigo-600" />
                <span>أعلى مقدمي الخدمات استحقاقاً للمصروفات</span>
              </h3>
              <p className="text-xs text-slate-500">الموردون الأكثر تعاملاً وإجمالي المبالغ المصروفة لهم</p>
            </div>
          </div>

          <div className="divide-y divide-slate-100">
            {providerExpenseData.map((prov, i) => (
              <div key={i} className="py-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-lg bg-indigo-50 text-indigo-700 font-bold flex items-center justify-center text-xs">
                    {i + 1}
                  </div>
                  <div>
                    <h5 className="font-bold text-slate-800 text-sm">{prov.fullName}</h5>
                    <span className="text-xs text-slate-400">مقدم خدمة معتمد</span>
                  </div>
                </div>
                <div className="text-left">
                  <div className="font-extrabold text-slate-900 text-sm">
                    {prov.paid.toLocaleString()} {currency}
                  </div>
                  <span className="text-[11px] text-emerald-600 font-medium">مدفوع ومسوى</span>
                </div>
              </div>
            ))}
            {providerExpenseData.length === 0 && (
              <p className="text-xs text-slate-400 py-4 text-center">لا توجد سجلات دفع مسجلة بعد</p>
            )}
          </div>
        </div>

        {/* Actionable Pending Requests */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-bold text-slate-900 text-base flex items-center gap-2">
                <Clock className="h-4 w-4 text-amber-500" />
                <span>أحدث الطلبات المعلقة للاعتماد</span>
              </h3>
              <p className="text-xs text-slate-500">طلبات تتطلب اتخاذ إجراء من مدير المؤسسة</p>
            </div>
          </div>

          <div className="space-y-2.5">
            {pendingRequests.slice(0, 4).map((req) => (
              <div
                key={req.id}
                onClick={() => onSelectRequest(req)}
                className="p-3.5 rounded-xl border border-slate-100 hover:border-emerald-300 hover:bg-emerald-50/20 transition cursor-pointer flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-400 font-mono">{req.requestNumber}</span>
                    <span className="text-xs bg-amber-50 text-amber-800 px-2 py-0.2 rounded-md font-semibold border border-amber-200">
                      قيد المراجعة
                    </span>
                  </div>
                  <h4 className="font-bold text-slate-800 text-sm truncate mt-1">{req.title}</h4>
                  <div className="text-xs text-slate-400 mt-0.5">
                    بواسطة: {req.requesterName} • {req.serviceCategoryName}
                  </div>
                </div>

                <div className="text-left shrink-0">
                  <div className="font-black text-slate-900 text-base">
                    {req.amount.toLocaleString()} {req.currency}
                  </div>
                  <span className="text-xs font-semibold text-emerald-600 flex items-center gap-0.5 hover:underline">
                    <span>مراجعة والبت</span>
                    <ArrowUpRight className="h-3 w-3" />
                  </span>
                </div>
              </div>
            ))}

            {pendingRequests.length === 0 && (
              <div className="text-center py-8">
                <CheckCircle2 className="h-10 w-10 text-emerald-500 mx-auto opacity-70 mb-2" />
                <p className="font-bold text-slate-700 text-sm">لا توجد طلبات معلقة حالياً!</p>
                <p className="text-xs text-slate-400 mt-1">جميع طلبات المصروفات تم البت فيها أو صرفها.</p>
              </div>
            )}
          </div>
        </div>

      </div>

    </div>
  );
};
