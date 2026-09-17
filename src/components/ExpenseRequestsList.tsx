import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { ExpenseRequest } from '../types';
import { 
  Search, 
  Filter, 
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
  CreditCard
} from 'lucide-react';

interface ExpenseRequestsListProps {
  onSelectRequest: (request: ExpenseRequest) => void;
  onOpenNewRequest: () => void;
}

export const ExpenseRequestsList: React.FC<ExpenseRequestsListProps> = ({ 
  onSelectRequest, 
  onOpenNewRequest 
}) => {
  const { requests, activeOrgId, services, providers, currentRole } = useApp();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');

  const filteredRequests = React.useMemo(() => {
    const seenIds = new Set<string>();
    const seenNumbers = new Set<string>();

    return requests.filter(req => {
      const numKey = (req.requestNumber || '').trim().toUpperCase();
      if (seenIds.has(req.id) || (numKey && seenNumbers.has(numKey))) {
        return false;
      }
      seenIds.add(req.id);
      if (numKey) seenNumbers.add(numKey);

      const matchStatus = statusFilter === 'all' || req.status === statusFilter;
      const matchCategory = categoryFilter === 'all' || req.serviceCategoryId === categoryFilter;
      const matchSearch = 
        req.title.toLowerCase().includes(search.toLowerCase()) ||
        req.requestNumber.toLowerCase().includes(search.toLowerCase()) ||
        req.requesterName.toLowerCase().includes(search.toLowerCase()) ||
        req.providerName.toLowerCase().includes(search.toLowerCase());

      return matchStatus && matchCategory && matchSearch;
    });
  }, [requests, statusFilter, categoryFilter, search]);

  const getStatusBadge = (status: ExpenseRequest['status']) => {
    switch (status) {
      case 'pending':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-700 border border-amber-200">
            <Clock className="h-3 w-3" />
            <span>قيد المراجعة</span>
          </span>
        );
      case 'clarification_requested':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-rose-50 text-rose-700 border border-rose-200">
            <AlertCircle className="h-3 w-3" />
            <span>مطلوب توضيح</span>
          </span>
        );
      case 'approved':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-blue-50 text-blue-700 border border-blue-200">
            <CheckCircle2 className="h-3 w-3" />
            <span>معتمد للصرف</span>
          </span>
        );
      case 'disbursed':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
            <Check className="h-3 w-3" />
            <span>تم الصرف</span>
          </span>
        );
      case 'rejected':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-700 border border-slate-200">
            <XCircle className="h-3 w-3" />
            <span>مرفوض</span>
          </span>
        );
    }
  };

  return (
    <div className="space-y-6 pb-12">
      
      {/* Top Controls Bar */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-slate-900">سجل طلبات المصروفات والعهد</h1>
            <p className="text-xs text-slate-500 mt-0.5">
              استعراض وإدارة وتدقيق جميع طلبات الصرف المالي وحالاتها
            </p>
          </div>

          <button
            type="button"
            onClick={onOpenNewRequest}
            className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs px-4 py-2.5 rounded-xl shadow-xs transition cursor-pointer self-start md:self-auto"
          >
            <Plus className="h-4 w-4" />
            <span>تقديم طلب صرف جديد</span>
          </button>
        </div>

        {/* Filter Bar */}
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 pt-2">
          
          {/* Search */}
          <div className="sm:col-span-5 relative">
            <Search className="h-4 w-4 text-slate-400 absolute right-3 top-2.5" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="بحث بالرقم، الموظف، المورد، أو العنوان..."
              className="w-full pl-3 pr-9 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
            />
          </div>

          {/* Status Filter */}
          <div className="sm:col-span-4">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full py-2 px-3 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:bg-white focus:outline-none"
            >
              <option value="all">كافة حالات الطلبات</option>
              <option value="pending">قيد المراجعة</option>
              <option value="clarification_requested">مطلوب توضيح</option>
              <option value="approved">معتمد للصرف</option>
              <option value="disbursed">تم الصرف</option>
              <option value="rejected">مرفوض</option>
            </select>
          </div>

          {/* Category Filter */}
          <div className="sm:col-span-3">
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="w-full py-2 px-3 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:bg-white focus:outline-none"
            >
              <option value="all">كافة بنود الخدمات</option>
              {services.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>

        </div>
      </div>

      {/* Requests Table */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold">
              <tr>
                <th className="p-4">رقم الطلب</th>
                <th className="p-4">عنوان وتفاصيل الطلب</th>
                <th className="p-4">طالب الصرف</th>
                <th className="p-4">بند الخدمة</th>
                <th className="p-4">مقدم الخدمة</th>
                <th className="p-4">المبلغ</th>
                <th className="p-4">الحالة</th>
                <th className="p-4 text-center">الإجراء</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredRequests.map((req) => (
                <tr 
                  key={req.id} 
                  onClick={() => onSelectRequest(req)}
                  className="hover:bg-slate-50/80 transition cursor-pointer"
                >
                  <td className="p-4 font-mono font-bold text-slate-700 whitespace-nowrap">
                    {req.requestNumber}
                  </td>
                  <td className="p-4 max-w-xs">
                    <div className="font-bold text-slate-900 truncate">{req.title}</div>
                    <div className="text-[11px] text-slate-400 line-clamp-1">{req.description}</div>
                  </td>
                  <td className="p-4 whitespace-nowrap">
                    <div className="font-semibold text-slate-800">{req.requesterName}</div>
                    <div className="text-[10px] text-slate-400">{req.requesterDepartment}</div>
                  </td>
                  <td className="p-4 whitespace-nowrap text-slate-700">
                    {req.serviceCategoryName}
                  </td>
                  <td className="p-4 whitespace-nowrap text-slate-700">
                    {req.providerName}
                  </td>
                  <td className="p-4 whitespace-nowrap font-black text-slate-900">
                    {req.amount.toLocaleString()} {req.currency}
                  </td>
                  <td className="p-4 whitespace-nowrap">
                    {getStatusBadge(req.status)}
                  </td>
                  <td className="p-4 text-center whitespace-nowrap">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectRequest(req);
                      }}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-emerald-50 hover:text-emerald-700 text-slate-700 font-bold text-xs transition"
                    >
                      <Eye className="h-3.5 w-3.5" />
                      <span>تفاصيل</span>
                    </button>
                  </td>
                </tr>
              ))}

              {filteredRequests.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-center py-12 text-slate-400">
                    لا توجد طلبات تطابق معايير البحث والفلترة المحددة.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
};
