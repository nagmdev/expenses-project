import React, { useState } from 'react';
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
  CreditCard
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

export const DashboardAnalytics: React.FC<DashboardAnalyticsProps> = ({ 
  onSelectRequest, 
  onOpenNewRequest 
}) => {
  const { 
    activeOrg, 
    activeOrgId, 
    organizations, 
    requests, 
    services, 
    providers, 
    currentRole 
  } = useApp();

  const [timeFilter, setTimeFilter] = useState<'all' | 'q3' | 'month'>('all');

  // Filter requests by organization
  const orgRequests = requests.filter(r => activeOrgId === 'all' || r.orgId === activeOrgId);
  const currentOrgServices = services.filter(s => activeOrgId === 'all' || s.orgId === activeOrgId);
  const currentOrgProviders = providers.filter(p => activeOrgId === 'all' || p.orgId === activeOrgId);

  // Financial Metrics
  const disbursedRequests = orgRequests.filter(r => r.status === 'disbursed');
  const totalDisbursed = disbursedRequests.reduce((sum, r) => sum + r.amount, 0);

  const approvedRequests = orgRequests.filter(r => r.status === 'approved');
  const totalApprovedAwaitingDisbursement = approvedRequests.reduce((sum, r) => sum + r.amount, 0);

  const pendingRequests = orgRequests.filter(r => r.status === 'pending');
  const totalPending = pendingRequests.reduce((sum, r) => sum + r.amount, 0);

  const clarificationRequests = orgRequests.filter(r => r.status === 'clarification_requested');
  const rejectedRequests = orgRequests.filter(r => r.status === 'rejected');

  // Total budget
  const totalBudget = activeOrgId === 'all' 
    ? organizations.reduce((sum, o) => sum + o.budget, 0)
    : (activeOrg?.budget || 0);

  const remainingBudget = totalBudget - totalDisbursed;
  const budgetUtilization = totalBudget > 0 ? Math.min(100, Math.round((totalDisbursed / totalBudget) * 100)) : 0;
  const currency = activeOrg?.currency || 'SAR';

  // Chart 1: Expenses by Service Category
  const serviceChartData = currentOrgServices.map(srv => {
    // calculate actual disbursed for this service
    const spent = orgRequests
      .filter(r => r.serviceCategoryId === srv.id && r.status === 'disbursed')
      .reduce((sum, r) => sum + r.amount, 0);
    return {
      name: srv.name.length > 18 ? srv.name.slice(0, 18) + '...' : srv.name,
      fullName: srv.name,
      spent,
      budget: srv.budgetLimit,
    };
  }).filter(item => item.spent > 0 || item.budget > 0);

  // Chart 2: Status Distribution
  const statusColors: Record<string, string> = {
    'تم الصرف': '#10b981',
    'معتمد للصرف': '#3b82f6',
    'قيد المراجعة': '#f59e0b',
    'طلب توضيح': '#ef4444',
    'مرفوض': '#94a3b8',
  };

  const statusData = [
    { name: 'تم الصرف', count: disbursedRequests.length, amount: totalDisbursed },
    { name: 'معتمد للصرف', count: approvedRequests.length, amount: totalApprovedAwaitingDisbursement },
    { name: 'قيد المراجعة', count: pendingRequests.length, amount: totalPending },
    { name: 'طلب توضيح', count: clarificationRequests.length, amount: clarificationRequests.reduce((s, r) => s + r.amount, 0) },
    { name: 'مرفوض', count: rejectedRequests.length, amount: rejectedRequests.reduce((s, r) => s + r.amount, 0) },
  ].filter(d => d.count > 0);

  // Chart 3: Expenses by Top Providers
  const providerExpenseData = currentOrgProviders.map(prov => {
    const paid = orgRequests
      .filter(r => r.providerId === prov.id && r.status === 'disbursed')
      .reduce((sum, r) => sum + r.amount, 0);
    return {
      name: prov.name.length > 16 ? prov.name.slice(0, 16) + '...' : prov.name,
      fullName: prov.name,
      paid,
    };
  }).sort((a, b) => b.paid - a.paid).slice(0, 5);

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
              {orgRequests.length} طلب إجمالي
            </span>
          </div>
          <p className="text-sm text-slate-500 mt-1">
            نظرة تفصيلية على حجم المصروفات والتدفقات المالية ونسب الإنجاز والاعتمادات.
          </p>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          <div className="flex items-center bg-slate-100 p-1 rounded-lg border border-slate-200 text-xs">
            <button
              onClick={() => setTimeFilter('all')}
              className={`px-3 py-1.5 rounded-md font-medium transition cursor-pointer ${
                timeFilter === 'all' ? 'bg-white text-slate-900 shadow-xs font-bold' : 'text-slate-600'
              }`}
            >
              كافة الفترات
            </button>
            <button
              onClick={() => setTimeFilter('q3')}
              className={`px-3 py-1.5 rounded-md font-medium transition cursor-pointer ${
                timeFilter === 'q3' ? 'bg-white text-slate-900 shadow-xs font-bold' : 'text-slate-600'
              }`}
            >
              الربع الثالث 2026
            </button>
            <button
              onClick={() => setTimeFilter('month')}
              className={`px-3 py-1.5 rounded-md font-medium transition cursor-pointer ${
                timeFilter === 'month' ? 'bg-white text-slate-900 shadow-xs font-bold' : 'text-slate-600'
              }`}
            >
              هذا الشهر
            </button>
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

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        
        {/* Card 1: Total Disbursed */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500">إجمالي المصروف الفعلي</span>
            <div className="h-9 w-9 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center border border-emerald-100">
              <CheckCircle2 className="h-5 w-5" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-black text-slate-900">
              {totalDisbursed.toLocaleString()} <span className="text-sm font-semibold text-slate-500">{currency}</span>
            </div>
            <div className="text-xs text-emerald-600 font-semibold mt-1 flex items-center gap-1">
              <span>{disbursedRequests.length} طلبات تم صرفها بنجاح</span>
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
              <p className="text-xs text-slate-500">مقارنة المبالغ المصروفة فعلياً بالميزانية المحددة لكل بند</p>
            </div>
          </div>

          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={serviceChartData} margin={{ top: 10, right: 10, left: 10, bottom: 20 }}>
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#64748b' }} />
                <YAxis tick={{ fontSize: 11, fill: '#64748b' }} />
                <Tooltip 
                  formatter={(value: any, name: any) => [
                    `${Number(value).toLocaleString()} ${currency}`, 
                    name === 'spent' ? 'المصروف الفعلي' : 'الميزانية التقديرية'
                  ]}
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
