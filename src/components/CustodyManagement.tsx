import React, { useState, useMemo, useRef } from 'react';
import { useApp } from '../context/AppContext';
import { 
  PettyCashCustody, 
  CustodySettlementItem, 
  CustodyStatus,
  PaymentAccount 
} from '../types';
import { 
  Briefcase, 
  Wallet, 
  Receipt, 
  Plus, 
  Search, 
  Building2, 
  User, 
  Phone, 
  Calendar, 
  CheckCircle2, 
  Clock3, 
  AlertCircle, 
  Layers, 
  FileText, 
  RefreshCw, 
  DollarSign, 
  X, 
  Eye, 
  Percent, 
  ArrowRight,
  TrendingDown,
  UploadCloud,
  Image as ImageIcon,
  ExternalLink,
  ChevronRight
} from 'lucide-react';
import { 
  handleNumericKeyDown, 
  sanitizeAmount, 
  sanitizePhone 
} from '../utils/validation';
import { InvoiceViewerModal } from './InvoiceViewerModal';

export const CustodyManagement: React.FC = () => {
  const {
    custodies,
    allCustodies,
    custodySettlements,
    allCustodySettlements,
    organizations,
    allOrganizations,
    paymentAccounts,
    allPaymentAccounts,
    services,
    allServices,
    providers,
    allProviders,
    members,
    allMembers,
    activeOrgId,
    activeOrg,
    currentRole,
    currentUser,
    issueCustody,
    settleCustodyItem,
    replenishCustody,
  } = useApp();

  const isSuperAdmin = currentRole === 'super_admin';
  const orgList = isSuperAdmin ? (allOrganizations.length > 0 ? allOrganizations : organizations) : organizations;
  const targetCustodies = isSuperAdmin ? allCustodies : custodies;
  const targetSettlements = isSuperAdmin ? allCustodySettlements : custodySettlements;
  const targetAccounts = isSuperAdmin ? allPaymentAccounts : paymentAccounts;
  const targetMembers = isSuperAdmin ? allMembers : members;
  const targetServices = isSuperAdmin ? allServices : services;
  const targetProviders = isSuperAdmin ? allProviders : providers;

  // Filters & State
  const [selectedOrgFilter, setSelectedOrgFilter] = useState<string>(
    activeOrgId && activeOrgId !== 'all' ? activeOrgId : 'all'
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'settled'>('all');
  const [employeeFilter, setEmployeeFilter] = useState<string>('all');
  const [activeMainTab, setActiveMainTab] = useState<'custodies' | 'settlements'>('custodies');

  // Unique Employees list for filter
  const uniqueEmployees = useMemo(() => {
    const names = new Set<string>();
    targetCustodies.forEach(c => {
      if (c.employeeName) names.add(c.employeeName.trim());
    });
    targetSettlements.forEach(s => {
      if (s.employeeName) names.add(s.employeeName.trim());
    });
    return Array.from(names).sort();
  }, [targetCustodies, targetSettlements]);

  // Modals
  const [isIssueModalOpen, setIsIssueModalOpen] = useState(false);
  const [settlingCustody, setSettlingCustody] = useState<PettyCashCustody | null>(null);
  const [replenishingCustody, setReplenishingCustody] = useState<PettyCashCustody | null>(null);
  const [inspectingCustody, setInspectingCustody] = useState<PettyCashCustody | null>(null);
  const [previewReceiptUrl, setPreviewReceiptUrl] = useState<string | null>(null);

  // Issue Custody Form State
  const [issueOrgId, setIssueOrgId] = useState<string>('');
  const [issueEmployeeMode, setIssueEmployeeMode] = useState<'select' | 'custom'>('select');
  const [issueEmployeeId, setIssueEmployeeId] = useState('');
  const [issueEmployeeName, setIssueEmployeeName] = useState('');
  const [issueEmployeePhone, setIssueEmployeePhone] = useState('');
  const [issueAmount, setIssueAmount] = useState('');
  const [issueSourceAccountId, setIssueSourceAccountId] = useState('');
  const [issueNotes, setIssueNotes] = useState('');
  const [isIssuing, setIsIssuing] = useState(false);
  const [issueError, setIssueError] = useState<string | null>(null);

  // Settle Custody Form State
  const [settleAmount, setSettleAmount] = useState('');
  const [settleServiceCategoryId, setSettleServiceCategoryId] = useState('');
  const [settleVendorName, setSettleVendorName] = useState('');
  const [settleInvoiceNumber, setSettleInvoiceNumber] = useState('');
  const [settleInvoiceDate, setSettleInvoiceDate] = useState(new Date().toISOString().split('T')[0]);
  const [settleDescription, setSettleDescription] = useState('');
  const [settleReceiptUrl, setSettleReceiptUrl] = useState('');
  const [isSettling, setIsSettling] = useState(false);
  const [settleError, setSettleError] = useState<string | null>(null);
  const receiptFileInputRef = useRef<HTMLInputElement>(null);

  // Replenish Custody Form State
  const [replenishAmount, setReplenishAmount] = useState('');
  const [replenishSourceAccountId, setReplenishSourceAccountId] = useState('');
  const [replenishNotes, setReplenishNotes] = useState('');
  const [isReplenishing, setIsReplenishing] = useState(false);
  const [replenishError, setReplenishError] = useState<string | null>(null);

  // Filtered Custodies
  const filteredCustodies = useMemo(() => {
    return targetCustodies.filter(item => {
      // Org filter
      if (selectedOrgFilter !== 'all' && item.orgId !== selectedOrgFilter) {
        return false;
      }
      // Employee filter
      if (employeeFilter !== 'all' && item.employeeName !== employeeFilter) {
        return false;
      }
      // Status filter
      if (statusFilter !== 'all' && item.status !== statusFilter) {
        return false;
      }
      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchName = (item.employeeName || '').toLowerCase().includes(q);
        const matchNum = (item.custodyNumber || '').toLowerCase().includes(q);
        const matchPhone = (item.employeePhone || '').toLowerCase().includes(q);
        const matchNotes = (item.notes || '').toLowerCase().includes(q);
        const matchAccount = (item.sourceAccountName || '').toLowerCase().includes(q);
        if (!matchName && !matchNum && !matchPhone && !matchNotes && !matchAccount) {
          return false;
        }
      }
      return true;
    });
  }, [targetCustodies, selectedOrgFilter, employeeFilter, statusFilter, searchQuery]);

  // Filtered Settlements
  const filteredSettlements = useMemo(() => {
    return targetSettlements.filter(item => {
      if (selectedOrgFilter !== 'all' && item.orgId !== selectedOrgFilter) {
        return false;
      }
      if (employeeFilter !== 'all' && item.employeeName !== employeeFilter) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchEmployee = (item.employeeName || '').toLowerCase().includes(q);
        const matchInvoice = (item.invoiceNumber || '').toLowerCase().includes(q);
        const matchVendor = (item.vendorName || '').toLowerCase().includes(q);
        const matchBand = (item.serviceCategoryName || '').toLowerCase().includes(q);
        const matchDesc = (item.description || '').toLowerCase().includes(q);
        if (!matchEmployee && !matchInvoice && !matchVendor && !matchBand && !matchDesc) {
          return false;
        }
      }
      return true;
    });
  }, [targetSettlements, selectedOrgFilter, employeeFilter, searchQuery]);

  // KPI Calculations
  const { totalIssued, totalRemaining, totalSettled, activeCount } = useMemo(() => {
    let issued = 0;
    let remaining = 0;
    let settled = 0;
    let active = 0;

    filteredCustodies.forEach(c => {
      issued += Number(c.totalAmount || 0);
      remaining += Number(c.remainingAmount || 0);
      settled += Number(c.settledAmount || 0);
      if (c.status === 'active') {
        active += 1;
      }
    });

    return {
      totalIssued: issued,
      totalRemaining: remaining,
      totalSettled: settled,
      activeCount: active,
    };
  }, [filteredCustodies]);

  // Handle open issue custody modal
  const handleOpenIssueModal = () => {
    const defaultOrg = selectedOrgFilter !== 'all' ? selectedOrgFilter : (activeOrgId && activeOrgId !== 'all' ? activeOrgId : orgList[0]?.id || '');
    setIssueOrgId(defaultOrg);
    setIssueEmployeeMode('select');
    setIssueEmployeeId('');
    setIssueEmployeeName('');
    setIssueEmployeePhone('');
    setIssueAmount('');
    setIssueSourceAccountId('');
    setIssueNotes('');
    setIssueError(null);
    setIsIssueModalOpen(true);
  };

  // Available employees for the selected org in issue modal
  const availableMembers = useMemo(() => {
    if (!issueOrgId) return targetMembers;
    return targetMembers.filter(m => m.orgId === issueOrgId && m.active !== false);
  }, [targetMembers, issueOrgId]);

  // Available treasury accounts for the selected org in issue modal
  const availableAccountsForIssue = useMemo(() => {
    if (!issueOrgId) return targetAccounts;
    return targetAccounts.filter(a => a.orgId === issueOrgId && a.active !== false);
  }, [targetAccounts, issueOrgId]);

  // Handle submit issue custody
  const handleSubmitIssue = async (e: React.FormEvent) => {
    e.preventDefault();
    setIssueError(null);

    const amountNum = parseFloat(issueAmount);
    if (!amountNum || amountNum <= 0) {
      setIssueError('يرجى إدخال مبلغ صحيح للعهدة.');
      return;
    }

    if (!issueOrgId) {
      setIssueError('يرجى تحديد الشركة أو المؤسسة.');
      return;
    }

    let finalEmpId = issueEmployeeId;
    let finalEmpName = issueEmployeeName.trim();
    let finalEmpPhone = issueEmployeePhone.trim();

    if (issueEmployeeMode === 'select') {
      const selectedMember = availableMembers.find(m => m.id === issueEmployeeId || m.userId === issueEmployeeId);
      if (!selectedMember) {
        setIssueError('يرجى اختيار الموظف المستلم للعهدة.');
        return;
      }
      finalEmpId = selectedMember.userId || selectedMember.id;
      finalEmpName = selectedMember.userName;
      finalEmpPhone = selectedMember.phone || '';
    } else {
      if (!finalEmpName) {
        setIssueError('يرجى كتابة اسم الموظف أو المندوب.');
        return;
      }
      if (!finalEmpId) {
        finalEmpId = `emp-${Date.now()}`;
      }
    }

    if (!issueSourceAccountId) {
      setIssueError('يرجى اختيار حساب الخزينة أو المحفظة مصدر الصرف.');
      return;
    }

    setIsIssuing(true);
    try {
      const res = await issueCustody(
        issueOrgId,
        finalEmpId,
        finalEmpName,
        finalEmpPhone || undefined,
        amountNum,
        issueSourceAccountId,
        issueNotes.trim() || undefined
      );

      if (res && !res.success) {
        setIssueError(res.message || 'حدث خطأ أثناء صرف العهدة.');
        setIsIssuing(false);
        return;
      }

      setIsIssueModalOpen(false);
    } catch (err: any) {
      console.error(err);
      setIssueError(err?.message || 'حدث خطأ أثناء صرف العهدة.');
    } finally {
      setIsIssuing(false);
    }
  };

  // Handle open settlement modal
  const handleOpenSettleModal = (custody: PettyCashCustody) => {
    setSettlingCustody(custody);
    setSettleAmount('');
    setSettleServiceCategoryId('');
    setSettleVendorName('');
    setSettleInvoiceNumber('');
    setSettleInvoiceDate(new Date().toISOString().split('T')[0]);
    setSettleDescription('');
    setSettleReceiptUrl('');
    setSettleError(null);
  };

  // Handle receipt image upload
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      alert('حجم الملف كبير جداً، يرجى اختيار ملف أقل من 5 ميجابايت.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (reader.result) {
        setSettleReceiptUrl(reader.result.toString());
      }
    };
    reader.readAsDataURL(file);
  };

  // Submit settlement
  const handleSubmitSettlement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settlingCustody) return;
    setSettleError(null);

    const amountNum = parseFloat(settleAmount);
    if (!amountNum || amountNum <= 0) {
      setSettleError('يرجى إدخال مبلغ صحيح للفاتورة.');
      return;
    }

    if (amountNum > settlingCustody.remainingAmount) {
      const confirmExceed = window.confirm(
        `تنبيه: قيمة الفاتورة (${amountNum.toLocaleString()}) أكبر من الرصيد المتبقي طرف الموظف (${settlingCustody.remainingAmount.toLocaleString()}). هل تريد المتابعة وتصفية كامل العهدة؟`
      );
      if (!confirmExceed) return;
    }

    if (!settleDescription.trim()) {
      setSettleError('يرجى كتابة بيان مختصر أو وصف للفاتورة والمصروف.');
      return;
    }

    setIsSettling(true);
    try {
      const res = await settleCustodyItem(
        settlingCustody.id,
        amountNum,
        settleDescription.trim(),
        settleServiceCategoryId || undefined,
        settleVendorName.trim() || undefined,
        settleInvoiceNumber.trim() || undefined,
        settleInvoiceDate || undefined,
        settleReceiptUrl || undefined
      );

      if (res && !res.success) {
        setSettleError(res.message || 'حدث خطأ أثناء تسجيل فاتورة التصفية.');
        setIsSettling(false);
        return;
      }

      setSettlingCustody(null);
    } catch (err: any) {
      console.error(err);
      setSettleError(err?.message || 'حدث خطأ غير متوقع أثناء تسجيل التصفية.');
    } finally {
      setIsSettling(false);
    }
  };

  // Handle open replenish modal
  const handleOpenReplenishModal = (custody: PettyCashCustody) => {
    setReplenishingCustody(custody);
    setReplenishAmount('');
    setReplenishSourceAccountId(custody.sourceAccountId || '');
    setReplenishNotes('');
    setReplenishError(null);
  };

  // Submit replenish
  const handleSubmitReplenish = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!replenishingCustody) return;
    setReplenishError(null);

    const amountNum = parseFloat(replenishAmount);
    if (!amountNum || amountNum <= 0) {
      setReplenishError('يرجى إدخال مبلغ استعاضة صحيح.');
      return;
    }

    if (!replenishSourceAccountId) {
      setReplenishError('يرجى اختيار حساب الخزينة أو المصدر المالي للاستعاضة.');
      return;
    }

    setIsReplenishing(true);
    try {
      const res = await replenishCustody(
        replenishingCustody.id,
        amountNum,
        replenishSourceAccountId,
        replenishNotes.trim() || undefined
      );

      if (res && !res.success) {
        setReplenishError(res.message || 'حدث خطأ أثناء استعاضة العهدة.');
        setIsReplenishing(false);
        return;
      }

      setReplenishingCustody(null);
    } catch (err: any) {
      console.error(err);
      setReplenishError(err?.message || 'حدث خطأ غير متوقع أثناء استعاضة العهدة.');
    } finally {
      setIsReplenishing(false);
    }
  };

  // Get settlements for an inspected custody
  const inspectedCustodySettlements = useMemo(() => {
    if (!inspectingCustody) return [];
    return targetSettlements.filter(s => s.custodyId === inspectingCustody.id);
  }, [inspectingCustody, targetSettlements]);

  // Helper for company name
  const getOrgName = (orgId: string) => {
    return orgList.find(o => o.id === orgId)?.name || 'الشركة';
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-200" dir="rtl">
      
      {/* 1. Header & Controls */}
      <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center border border-emerald-100 shadow-inner">
              <Briefcase className="h-6 w-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-slate-900">إدارة العُهد النقدية للموظفين والمناديب</h1>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                  Petty Cash
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                صرف العهد التشغيلية، تسجيل فواتير التصفية الدورية، واستعاضة الأرصدة عبر الخزائن والمحافظ
              </p>
            </div>
          </div>

          {/* Action button */}
          {currentRole !== 'employee' && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleOpenIssueModal}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-xs shadow-sm transition hover:shadow-md cursor-pointer shrink-0"
              >
                <Plus className="h-4 w-4" />
                <span>صرف عهدة جديدة لموظف</span>
              </button>
            </div>
          )}
        </div>

        {/* Filters Bar */}
        <div className="mt-6 pt-5 border-t border-slate-100 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
          
          <div className="flex flex-wrap items-center gap-2">
            {/* Super Admin Org Filter */}
            {isSuperAdmin && (
              <div className="relative min-w-[180px]">
                <Building2 className="h-4 w-4 absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                <select
                  value={selectedOrgFilter}
                  onChange={(e) => setSelectedOrgFilter(e.target.value)}
                  className="w-full pr-9 pl-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 cursor-pointer"
                >
                  <option value="all">🏢 جميع الشركات والمؤسسات</option>
                  {orgList.map(org => (
                    <option key={org.id} value={org.id}>{org.name}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Employee Filter */}
            <div className="relative min-w-[170px]">
              <User className="h-4 w-4 absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <select
                value={employeeFilter}
                onChange={(e) => setEmployeeFilter(e.target.value)}
                className="w-full pr-9 pl-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 cursor-pointer"
              >
                <option value="all">👤 كافة الموظفين والمناديب</option>
                {uniqueEmployees.map(emp => (
                  <option key={emp} value={emp}>{emp}</option>
                ))}
              </select>
            </div>

            {/* Status Filter Chips */}
            <div className="inline-flex bg-slate-100 p-1 rounded-xl gap-1 text-xs">
              <button
                type="button"
                onClick={() => setStatusFilter('all')}
                className={`px-3 py-1.5 rounded-lg font-bold transition cursor-pointer ${
                  statusFilter === 'all'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                الكل ({targetCustodies.length})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('active')}
                className={`px-3 py-1.5 rounded-lg font-bold transition cursor-pointer ${
                  statusFilter === 'active'
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'text-slate-600 hover:text-emerald-700'
                }`}
              >
                🟢 عهد نشطة ({targetCustodies.filter(c => c.status === 'active').length})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('settled')}
                className={`px-3 py-1.5 rounded-lg font-bold transition cursor-pointer ${
                  statusFilter === 'settled'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-slate-600 hover:text-blue-700'
                }`}
              >
                ✓ تمت تصفيتها بالكامل ({targetCustodies.filter(c => c.status === 'settled').length})
              </button>
            </div>
          </div>

          {/* Search Input */}
          <div className="relative flex-1 max-w-md">
            <Search className="h-4 w-4 absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="البحث باسم الموظف، كود العهدة CUS-، رقم الهاتف، أو الخزينة..."
              className="w-full pr-10 pl-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 2. KPI Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Total Active Custodies Amount */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500">إجمالي مبالغ العُهد المصروفة</span>
            <div className="h-9 w-9 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center border border-emerald-100">
              <Wallet className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-1.5">
            <span className="text-2xl font-black text-slate-900 tracking-tight">
              {totalIssued.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            <span className="text-xs font-bold text-slate-400">{activeOrg?.currency || 'EGP'}</span>
          </div>
          <p className="text-[11px] text-slate-400 mt-1">المجموع الكلي لقيمة العُهد المفتوحة</p>
          <div className="absolute -bottom-6 -left-6 w-20 h-20 bg-emerald-500/5 rounded-full pointer-events-none" />
        </div>

        {/* Card 2: Remaining Balance in Hand */}
        <div className="bg-white rounded-2xl border border-amber-200 p-5 shadow-xs relative overflow-hidden bg-gradient-to-bl from-white via-white to-amber-50/40">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-amber-800">الرصيد المتبقي طرف الموظفين</span>
            <div className="h-9 w-9 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center border border-amber-200">
              <Clock3 className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-1.5">
            <span className="text-2xl font-black text-amber-900 tracking-tight">
              {totalRemaining.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            <span className="text-xs font-bold text-amber-700">{activeOrg?.currency || 'EGP'}</span>
          </div>
          <p className="text-[11px] text-amber-700/80 mt-1">نقدية بانتظار تقديم فواتير التصفية</p>
          <div className="absolute -bottom-6 -left-6 w-20 h-20 bg-amber-500/10 rounded-full pointer-events-none" />
        </div>

        {/* Card 3: Total Settled Amount */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500">إجمالي ما تم تصفيته بالفواتير</span>
            <div className="h-9 w-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center border border-blue-100">
              <Receipt className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-1.5">
            <span className="text-2xl font-black text-blue-950 tracking-tight">
              {totalSettled.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            <span className="text-xs font-bold text-slate-400">{activeOrg?.currency || 'EGP'}</span>
          </div>
          <p className="text-[11px] text-slate-400 mt-1">مبالغ موثقة بفواتير ومستندات رسمية</p>
          <div className="absolute -bottom-6 -left-6 w-20 h-20 bg-blue-500/5 rounded-full pointer-events-none" />
        </div>

        {/* Card 4: Active Custodies Count */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500">عدد العُهد القائمة والنشطة</span>
            <div className="h-9 w-9 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center border border-purple-100">
              <Briefcase className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-1.5">
            <span className="text-2xl font-black text-purple-950 tracking-tight">
              {activeCount}
            </span>
            <span className="text-xs font-bold text-slate-400">عهدة طرف موظفين</span>
          </div>
          <p className="text-[11px] text-slate-400 mt-1">من إجمالي {filteredCustodies.length} مسجلة بالنظام</p>
          <div className="absolute -bottom-6 -left-6 w-20 h-20 bg-purple-500/5 rounded-full pointer-events-none" />
        </div>
      </div>

      {/* 3. Main Navigation Sub-Tabs */}
      <div className="flex items-center gap-3 border-b border-slate-200 pb-2">
        <button
          type="button"
          onClick={() => setActiveMainTab('custodies')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
            activeMainTab === 'custodies'
              ? 'bg-slate-900 text-white shadow-xs'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <Briefcase className="h-4 w-4" />
          <span>بطاقات وقوائم العُهد ({filteredCustodies.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveMainTab('settlements')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
            activeMainTab === 'settlements'
              ? 'bg-slate-900 text-white shadow-xs'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <Receipt className="h-4 w-4" />
          <span>سجل تسويات وفواتير العُهد ({filteredSettlements.length})</span>
        </button>
      </div>

      {/* 4. Tab Content: Custodies Grid / Table */}
      {activeMainTab === 'custodies' && (
        <>
          {filteredCustodies.length === 0 ? (
            <div className="bg-white rounded-3xl border border-slate-200 p-12 text-center max-w-lg mx-auto shadow-xs">
              <div className="h-16 w-16 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center mx-auto mb-4">
                <Briefcase className="h-8 w-8 stroke-[1.5]" />
              </div>
              <h3 className="text-base font-bold text-slate-800">لا توجد عُهد نقدية مطابقة</h3>
              <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                لم يتم العثور على أي عهد نقدية بالمعايير الحالية. يمكنك صرف عهدة نقدية جديدة لأحد الموظفين أو المناديب للبدء.
              </p>
              <button
                type="button"
                onClick={handleOpenIssueModal}
                className="mt-5 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-sm transition cursor-pointer"
              >
                + صرف عهدة جديدة الآن
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {filteredCustodies.map((custody) => {
                const percentSettled = Math.min(
                  100, 
                  Math.round(((custody.settledAmount || 0) / (custody.totalAmount || 1)) * 100)
                );
                const isFullySettled = custody.status === 'settled' || custody.remainingAmount <= 0;

                return (
                  <div 
                    key={custody.id}
                    className="bg-white rounded-3xl border border-slate-200 hover:border-slate-300 p-5 shadow-xs hover:shadow-md transition-all flex flex-col justify-between"
                  >
                    {/* Top Row: Custody Code, Status, Date */}
                    <div>
                      <div className="flex items-center justify-between gap-2 mb-3">
                        <div className="flex items-center gap-2">
                          <span className="px-2.5 py-1 rounded-lg text-xs font-black bg-slate-900 text-white tracking-wider font-mono">
                            {custody.custodyNumber}
                          </span>
                          {isSuperAdmin && (
                            <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-100 text-slate-600">
                              {getOrgName(custody.orgId)}
                            </span>
                          )}
                        </div>

                        {/* Status Badge */}
                        {isFullySettled ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
                            <CheckCircle2 className="h-3 w-3" />
                            تمت التصفية بالكامل
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 animate-pulse">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                            عهدة نشطة قائمة
                          </span>
                        )}
                      </div>

                      {/* Employee Info */}
                      <div className="flex items-start gap-3 mt-4">
                        <div className="h-11 w-11 rounded-2xl bg-gradient-to-tr from-emerald-100 to-teal-100 text-emerald-700 font-bold flex items-center justify-center text-sm border border-emerald-200/60 shadow-xs shrink-0">
                          {custody.employeeName ? custody.employeeName.charAt(0).toUpperCase() : <User className="h-5 w-5" />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <h3 className="text-sm font-bold text-slate-900 truncate">
                            {custody.employeeName}
                          </h3>
                          <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500 mt-1">
                            {custody.employeePhone && (
                              <span className="flex items-center gap-1">
                                <Phone className="h-3 w-3 text-slate-400" />
                                <span dir="ltr">{custody.employeePhone}</span>
                              </span>
                            )}
                            <span className="flex items-center gap-1">
                              <Calendar className="h-3 w-3 text-slate-400" />
                              <span>{custody.issuedAt ? new Date(custody.issuedAt).toLocaleDateString('ar-EG') : '—'}</span>
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Source Account Info */}
                      <div className="mt-3 px-3 py-2 bg-slate-50 rounded-xl border border-slate-100 text-xs flex items-center justify-between text-slate-600">
                        <span className="text-[11px] text-slate-400">مصدر الصرف:</span>
                        <span className="font-bold text-slate-800 truncate max-w-[200px]">
                          {custody.sourceAccountName || 'الخزينة الرئيسية'}
                        </span>
                      </div>

                      {/* Progress Bar & Settlement Ratio */}
                      <div className="mt-4 p-3.5 bg-slate-50/70 rounded-2xl border border-slate-100">
                        <div className="flex items-center justify-between text-xs mb-1.5">
                          <span className="text-slate-500 font-semibold">نسبة التصفية بالفواتير:</span>
                          <span className="font-bold text-slate-900">{percentSettled}%</span>
                        </div>
                        <div className="w-full bg-slate-200 rounded-full h-2.5 overflow-hidden flex">
                          <div 
                            className="bg-blue-600 h-full rounded-full transition-all duration-500"
                            style={{ width: `${percentSettled}%` }}
                          />
                          <div 
                            className="bg-amber-500 h-full rounded-full transition-all duration-500"
                            style={{ width: `${100 - percentSettled}%` }}
                          />
                        </div>

                        {/* Amounts Matrix */}
                        <div className="grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-slate-200/60 text-center">
                          <div>
                            <span className="text-[10px] text-slate-400 block font-medium">إجمالي العهدة</span>
                            <span className="text-xs font-black text-slate-900 mt-0.5 block">
                              {Number(custody.totalAmount || 0).toLocaleString()}
                            </span>
                          </div>
                          <div>
                            <span className="text-[10px] text-blue-600 block font-medium">المصفى بفواتير</span>
                            <span className="text-xs font-black text-blue-700 mt-0.5 block">
                              {Number(custody.settledAmount || 0).toLocaleString()}
                            </span>
                          </div>
                          <div>
                            <span className="text-[10px] text-amber-600 block font-medium">المتبقي نقداً</span>
                            <span className="text-xs font-black text-amber-700 mt-0.5 block">
                              {Number(custody.remainingAmount || 0).toLocaleString()}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Custody Notes */}
                      {custody.notes && (
                        <div className="mt-3 px-3 py-1.5 bg-amber-50/50 rounded-xl border border-amber-100/60 text-[11px] text-amber-800 truncate">
                          💬 {custody.notes}
                        </div>
                      )}
                    </div>

                    {/* Card Actions */}
                    <div className="mt-5 pt-4 border-t border-slate-100 flex items-center gap-2">
                      {/* Settle Action */}
                      <button
                        type="button"
                        onClick={() => handleOpenSettleModal(custody)}
                        disabled={isFullySettled}
                        className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition cursor-pointer ${
                          isFullySettled 
                            ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                            : 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs'
                        }`}
                        title="تسجيل فاتورة تصفية ومستند"
                      >
                        <Receipt className="h-3.5 w-3.5" />
                        <span>تصفية عهدة (فاتورة)</span>
                      </button>

                      {/* Replenish Action */}
                      {currentRole !== 'employee' && (
                        <button
                          type="button"
                          onClick={() => handleOpenReplenishModal(custody)}
                          className="py-2 px-3 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition cursor-pointer"
                          title="استعاضة العهدة وإعادة تغذية رصيد الموظف"
                        >
                          <RefreshCw className="h-3.5 w-3.5 text-slate-600" />
                          <span>استعاضة</span>
                        </button>
                      )}

                      {/* Inspect details */}
                      <button
                        type="button"
                        onClick={() => setInspectingCustody(custody)}
                        className="p-2 bg-slate-50 hover:bg-slate-100 text-slate-600 rounded-xl transition cursor-pointer border border-slate-200"
                        title="عرض كشف حساب العهدة والفواتير"
                      >
                        <Eye className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* 5. Tab Content: Settlements History View */}
      {activeMainTab === 'settlements' && (
        <div className="bg-white rounded-3xl border border-slate-200 overflow-hidden shadow-xs">
          <div className="p-5 border-b border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Receipt className="h-5 w-5 text-blue-600" />
              <h2 className="text-sm font-bold text-slate-900">سجل فواتير وتسويات العُهد النقدية (Settlements Ledger)</h2>
            </div>
            <span className="text-xs text-slate-500">
              إجمالي {filteredSettlements.length} فواتير مسجلة
            </span>
          </div>

          {filteredSettlements.length === 0 ? (
            <div className="p-12 text-center text-slate-400 text-xs">
              لا توجد فواتير تسوية مسجلة حتى الآن.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead className="bg-slate-50 border-b border-slate-100 text-slate-500 font-bold">
                  <tr>
                    <th className="p-4">تاريخ الفاتورة</th>
                    <th className="p-4">الموظف / المستلم</th>
                    <th className="p-4">رقم الفاتورة</th>
                    <th className="p-4">بند الصرف</th>
                    <th className="p-4">المورد / الجهة</th>
                    <th className="p-4">البيان والتفاصيل</th>
                    <th className="p-4">المبلغ</th>
                    <th className="p-4 text-center">المستند / الإيصال</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredSettlements.map((item) => (
                    <tr key={item.id} className="hover:bg-slate-50/70 transition">
                      <td className="p-4 text-slate-600 font-mono whitespace-nowrap">
                        {item.invoiceDate || new Date(item.createdAt).toLocaleDateString('ar-EG')}
                      </td>
                      <td className="p-4 font-bold text-slate-900 whitespace-nowrap">
                        {item.employeeName}
                      </td>
                      <td className="p-4 font-mono font-bold text-slate-700 whitespace-nowrap">
                        {item.invoiceNumber || '—'}
                      </td>
                      <td className="p-4 whitespace-nowrap">
                        <span className="px-2.5 py-1 bg-emerald-50 text-emerald-800 rounded-lg font-bold text-[11px] border border-emerald-100">
                          {item.serviceCategoryName || 'بند عام'}
                        </span>
                      </td>
                      <td className="p-4 text-slate-700 whitespace-nowrap">
                        {item.vendorName || '—'}
                      </td>
                      <td className="p-4 text-slate-600 max-w-xs truncate">
                        {item.description}
                      </td>
                      <td className="p-4 font-black text-slate-900 whitespace-nowrap">
                        {Number(item.amount || 0).toLocaleString()} {item.currency || 'EGP'}
                      </td>
                      <td className="p-4 text-center whitespace-nowrap">
                        {item.receiptUrl ? (
                          <button
                            type="button"
                            onClick={() => setPreviewReceiptUrl(item.receiptUrl || null)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 bg-blue-50 text-blue-700 hover:bg-blue-100 rounded-lg text-xs font-bold transition cursor-pointer"
                          >
                            <FileText className="h-3.5 w-3.5" />
                            <span>عرض الفاتورة</span>
                          </button>
                        ) : (
                          <span className="text-slate-300 text-[11px]">لا يوجد</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 1: صرف عهدة نقدية جديدة لموظف */}
      {/* ========================================================================= */}
      {isIssueModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl max-w-lg w-full p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-2xl bg-emerald-100 text-emerald-700 flex items-center justify-center">
                  <Briefcase className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">صرف عهدة نقدية جديدة</h3>
                  <p className="text-xs text-slate-500">إصدار عهدة مالية لموظف أو مندوب وخصمها من الخزينة</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsIssueModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-xl hover:bg-slate-100 cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {issueError && (
              <div className="mt-4 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs font-bold flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{issueError}</span>
              </div>
            )}

            <form onSubmit={handleSubmitIssue} className="mt-5 space-y-4">
              
              {/* Select Company (For Super Admin) */}
              {isSuperAdmin && (
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">الشركة / المؤسسة *</label>
                  <select
                    value={issueOrgId}
                    onChange={(e) => {
                      setIssueOrgId(e.target.value);
                      setIssueEmployeeId('');
                      setIssueSourceAccountId('');
                    }}
                    required
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  >
                    <option value="">-- اختر الشركة --</option>
                    {orgList.map(o => (
                      <option key={o.id} value={o.id}>{o.name}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Employee Mode Selector */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-bold text-slate-700">الموظف أو المندوب المستلم *</label>
                  <div className="flex items-center gap-2 text-[11px]">
                    <button
                      type="button"
                      onClick={() => setIssueEmployeeMode('select')}
                      className={`font-bold transition ${issueEmployeeMode === 'select' ? 'text-emerald-600 underline' : 'text-slate-400'}`}
                    >
                      من المسجلين
                    </button>
                    <span className="text-slate-300">|</span>
                    <button
                      type="button"
                      onClick={() => setIssueEmployeeMode('custom')}
                      className={`font-bold transition ${issueEmployeeMode === 'custom' ? 'text-emerald-600 underline' : 'text-slate-400'}`}
                    >
                      كتابة اسم يدوي
                    </button>
                  </div>
                </div>

                {issueEmployeeMode === 'select' ? (
                  <select
                    value={issueEmployeeId}
                    onChange={(e) => setIssueEmployeeId(e.target.value)}
                    required
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  >
                    <option value="">-- اختر الموظف من القائمة --</option>
                    {availableMembers.map(m => (
                      <option key={m.id} value={m.userId || m.id}>
                        {m.userName} ({m.department || 'موظف'} - {m.jobTitle || 'عضو'})
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="space-y-2">
                    <input
                      type="text"
                      value={issueEmployeeName}
                      onChange={(e) => setIssueEmployeeName(e.target.value)}
                      placeholder="اسم الموظف أو المندوب بالكامل..."
                      required
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                    <input
                      type="text"
                      value={issueEmployeePhone}
                      onChange={(e) => setIssueEmployeePhone(sanitizePhone(e.target.value))}
                      placeholder="رقم الهاتف (اختياري)..."
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>
                )}
              </div>

              {/* Custody Amount */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">مبلغ العهدة المطلوب صرفه *</label>
                <div className="relative">
                  <input
                    type="text"
                    inputMode="decimal"
                    onKeyDown={handleNumericKeyDown}
                    value={issueAmount}
                    onChange={(e) => setIssueAmount(sanitizeAmount(e.target.value))}
                    placeholder="0.00"
                    required
                    className="w-full pr-4 pl-12 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-black text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">
                    {activeOrg?.currency || 'EGP'}
                  </span>
                </div>
              </div>

              {/* Source Treasury Account */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">خصم من الخزينة / حساب الدفع *</label>
                <select
                  value={issueSourceAccountId}
                  onChange={(e) => setIssueSourceAccountId(e.target.value)}
                  required
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  <option value="">-- اختر الخزينة أو الحساب المالي --</option>
                  {availableAccountsForIssue.map(acc => {
                    const bal = Number(acc.currentBalance ?? acc.balance ?? 0);
                    return (
                      <option key={acc.id} value={acc.id}>
                        {acc.name} (الرصيد: {bal.toLocaleString()} {acc.currency})
                      </option>
                    );
                  })}
                </select>
              </div>

              {/* Purpose / Notes */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">الغرض من العهدة / ملاحظات</label>
                <textarea
                  rows={2}
                  value={issueNotes}
                  onChange={(e) => setIssueNotes(e.target.value)}
                  placeholder="مثال: عهدة نقدية للمشتريات اليومية ومصروفات الصيانة الطارئة..."
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              {/* Submit Buttons */}
              <div className="pt-3 flex items-center justify-end gap-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsIssueModalOpen(false)}
                  disabled={isIssuing}
                  className="px-4 py-2.5 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={isIssuing}
                  className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-xs transition flex items-center gap-2 cursor-pointer"
                >
                  {isIssuing ? (
                    <>
                      <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                      <span>جاري الصرف والتوثيق...</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="h-4 w-4" />
                      <span>تأكيد وصرف العهدة</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 2: تصفية عهدة وتسجيل فاتورة ومستند */}
      {/* ========================================================================= */}
      {settlingCustody && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl max-w-lg w-full p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-2xl bg-blue-100 text-blue-700 flex items-center justify-center">
                  <Receipt className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">تصفية عهدة (تسجيل فاتورة)</h3>
                  <p className="text-xs text-slate-500">تقديم فاتورة ومستند خصم من رصيد العهدة</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSettlingCustody(null)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-xl hover:bg-slate-100 cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Custody Quick Stats Banner */}
            <div className="mt-4 p-3 bg-slate-50 rounded-2xl border border-slate-200/80 flex items-center justify-between text-xs">
              <div>
                <span className="text-slate-400 block text-[10px]">الموظف:</span>
                <span className="font-bold text-slate-900">{settlingCustody.employeeName}</span>
                <span className="text-[10px] text-slate-500 block font-mono mt-0.5">({settlingCustody.custodyNumber})</span>
              </div>
              <div className="text-left">
                <span className="text-amber-600 block text-[10px] font-bold">الرصيد المتبقي طرفه:</span>
                <span className="font-black text-sm text-amber-700">
                  {Number(settlingCustody.remainingAmount || 0).toLocaleString()} {settlingCustody.currency}
                </span>
              </div>
            </div>

            {settleError && (
              <div className="mt-3 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs font-bold flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{settleError}</span>
              </div>
            )}

            <form onSubmit={handleSubmitSettlement} className="mt-4 space-y-3.5">
              
              {/* Invoice Amount */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">قيمة الفاتورة *</label>
                <div className="relative">
                  <input
                    type="text"
                    inputMode="decimal"
                    onKeyDown={handleNumericKeyDown}
                    value={settleAmount}
                    onChange={(e) => setSettleAmount(sanitizeAmount(e.target.value))}
                    placeholder="0.00"
                    required
                    className="w-full pr-4 pl-12 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-black text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">
                    {settlingCustody.currency}
                  </span>
                </div>
              </div>

              {/* Service Band & Vendor Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">بند الصرف (الميزانية)</label>
                  <select
                    value={settleServiceCategoryId}
                    onChange={(e) => setSettleServiceCategoryId(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">-- بند عام / غير محدد --</option>
                    {targetServices
                      .filter(s => s.orgId === settlingCustody.orgId || isSuperAdmin)
                      .map(s => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">المورد / مقدم الخدمة</label>
                  <input
                    type="text"
                    value={settleVendorName}
                    onChange={(e) => setSettleVendorName(e.target.value)}
                    placeholder="مثال: مكتبة سمير وعلي..."
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              {/* Invoice Number & Date */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">رقم الفاتورة / الإيصال</label>
                  <input
                    type="text"
                    value={settleInvoiceNumber}
                    onChange={(e) => setSettleInvoiceNumber(e.target.value)}
                    placeholder="INV-99201"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono font-bold text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">تاريخ الفاتورة</label>
                  <input
                    type="date"
                    value={settleInvoiceDate}
                    onChange={(e) => setSettleInvoiceDate(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              {/* Description */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">البيان / تفاصيل المشتريات *</label>
                <textarea
                  rows={2}
                  value={settleDescription}
                  onChange={(e) => setSettleDescription(e.target.value)}
                  placeholder="شراء أدوات مكتبية وأوراق طباعة للمقر..."
                  required
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Receipt Upload / Attachment Link */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">صورة الفاتورة أو المستند</label>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <input
                      type="file"
                      ref={receiptFileInputRef}
                      onChange={handleFileUpload}
                      accept="image/*,.pdf"
                      className="hidden"
                    />
                    <button
                      type="button"
                      onClick={() => receiptFileInputRef.current?.click()}
                      className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold flex items-center gap-1.5 transition cursor-pointer"
                    >
                      <UploadCloud className="h-4 w-4" />
                      <span>رفع صورة المستند</span>
                    </button>
                    <span className="text-[11px] text-slate-400">أو رابط إلكتروني:</span>
                  </div>

                  <input
                    type="text"
                    value={settleReceiptUrl}
                    onChange={(e) => setSettleReceiptUrl(e.target.value)}
                    placeholder="https://... أو سيتم حفظ الملف المرفوع تلقائياً"
                    className="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-700 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />

                  {settleReceiptUrl && (
                    <div className="flex items-center gap-2 text-xs text-blue-600 font-bold">
                      <ImageIcon className="h-3.5 w-3.5" />
                      <span>تم إرفاق المستند بنجاح</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Submit Buttons */}
              <div className="pt-3 flex items-center justify-end gap-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setSettlingCustody(null)}
                  disabled={isSettling}
                  className="px-4 py-2.5 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={isSettling}
                  className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl shadow-xs transition flex items-center gap-2 cursor-pointer"
                >
                  {isSettling ? (
                    <>
                      <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                      <span>جاري تسجيل الفاتورة...</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="h-4 w-4" />
                      <span>تسجيل الفاتورة وتصفية المبلغ</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 3: استعاضة العهدة النقدية */}
      {/* ========================================================================= */}
      {replenishingCustody && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl max-w-md w-full p-6">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-2xl bg-amber-100 text-amber-700 flex items-center justify-center">
                  <RefreshCw className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">استعاضة عهدة نقدية</h3>
                  <p className="text-xs text-slate-500">إعادة تغذية رصيد العهدة للموظف من الخزينة</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setReplenishingCustody(null)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-xl hover:bg-slate-100 cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Custody Info */}
            <div className="mt-4 p-3 bg-slate-50 rounded-2xl border border-slate-200 text-xs flex justify-between">
              <div>
                <span className="text-slate-400 block text-[10px]">الموظف:</span>
                <span className="font-bold text-slate-900">{replenishingCustody.employeeName}</span>
                <span className="text-[10px] text-slate-500 block font-mono">({replenishingCustody.custodyNumber})</span>
              </div>
              <div className="text-left">
                <span className="text-slate-400 block text-[10px]">الرصيد المتبقي حالياً:</span>
                <span className="font-black text-amber-700">
                  {Number(replenishingCustody.remainingAmount || 0).toLocaleString()} {replenishingCustody.currency}
                </span>
              </div>
            </div>

            {replenishError && (
              <div className="mt-3 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs font-bold flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{replenishError}</span>
              </div>
            )}

            <form onSubmit={handleSubmitReplenish} className="mt-4 space-y-3.5">
              
              {/* Replenish Amount */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">مبلغ الاستعاضة *</label>
                <div className="relative">
                  <input
                    type="text"
                    inputMode="decimal"
                    onKeyDown={handleNumericKeyDown}
                    value={replenishAmount}
                    onChange={(e) => setReplenishAmount(sanitizeAmount(e.target.value))}
                    placeholder="0.00"
                    required
                    className="w-full pr-4 pl-12 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-black text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">
                    {replenishingCustody.currency}
                  </span>
                </div>
              </div>

              {/* Source Treasury Account */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">خصم مبلغ الاستعاضة من خزينة *</label>
                <select
                  value={replenishSourceAccountId}
                  onChange={(e) => setReplenishSourceAccountId(e.target.value)}
                  required
                  className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                >
                  <option value="">-- اختر الخزينة أو المحفظة --</option>
                  {targetAccounts
                    .filter(a => a.orgId === replenishingCustody.orgId || isSuperAdmin)
                    .map(acc => {
                      const bal = Number(acc.currentBalance ?? acc.balance ?? 0);
                      return (
                        <option key={acc.id} value={acc.id}>
                          {acc.name} (الرصيد: {bal.toLocaleString()} {acc.currency})
                        </option>
                      );
                    })}
                </select>
              </div>

              {/* Notes */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">ملاحظات الاستعاضة</label>
                <textarea
                  rows={2}
                  value={replenishNotes}
                  onChange={(e) => setReplenishNotes(e.target.value)}
                  placeholder="سبب الاستعاضة ورقم إذن الصرف..."
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>

              {/* Submit Buttons */}
              <div className="pt-3 flex items-center justify-end gap-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setReplenishingCustody(null)}
                  disabled={isReplenishing}
                  className="px-4 py-2.5 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={isReplenishing}
                  className="px-5 py-2.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-xl shadow-xs transition flex items-center gap-2 cursor-pointer"
                >
                  {isReplenishing ? (
                    <>
                      <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                      <span>جاري الاستعاضة...</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="h-4 w-4" />
                      <span>تأكيد الاستعاضة وصرف المبلغ</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 4: تفاصيل وكشف حساب العهدة المسجلة */}
      {/* ========================================================================= */}
      {inspectingCustody && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-2xl bg-slate-100 text-slate-800 flex items-center justify-center">
                  <FileText className="h-5 w-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold text-slate-900">كشف حساب العهدة</h3>
                    <span className="px-2 py-0.5 rounded-md text-xs font-mono font-bold bg-slate-900 text-white">
                      {inspectingCustody.custodyNumber}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500">
                    الموظف: <strong>{inspectingCustody.employeeName}</strong> {inspectingCustody.employeePhone ? `(${inspectingCustody.employeePhone})` : ''}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setInspectingCustody(null)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-xl hover:bg-slate-100 cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Quick Metrics Grid */}
            <div className="grid grid-cols-3 gap-3 my-4">
              <div className="bg-slate-50 p-3.5 rounded-2xl border border-slate-100 text-center">
                <span className="text-[11px] text-slate-400 block font-medium">إجمالي المنصرف</span>
                <span className="text-sm font-black text-slate-900 mt-1 block">
                  {Number(inspectingCustody.totalAmount).toLocaleString()} {inspectingCustody.currency}
                </span>
              </div>
              <div className="bg-blue-50/60 p-3.5 rounded-2xl border border-blue-100 text-center">
                <span className="text-[11px] text-blue-600 block font-medium">تمت تصفيته بالفواتير</span>
                <span className="text-sm font-black text-blue-800 mt-1 block">
                  {Number(inspectingCustody.settledAmount).toLocaleString()} {inspectingCustody.currency}
                </span>
              </div>
              <div className="bg-amber-50/60 p-3.5 rounded-2xl border border-amber-100 text-center">
                <span className="text-[11px] text-amber-700 block font-medium">المتبقي طرف الموظف</span>
                <span className="text-sm font-black text-amber-900 mt-1 block">
                  {Number(inspectingCustody.remainingAmount).toLocaleString()} {inspectingCustody.currency}
                </span>
              </div>
            </div>

            {/* Invoices List */}
            <div className="mt-5">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                  <Receipt className="h-4 w-4 text-blue-600" />
                  <span>سجل فواتير هذه العهدة ({inspectedCustodySettlements.length})</span>
                </h4>
                {inspectingCustody.remainingAmount > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      const c = inspectingCustody;
                      setInspectingCustody(null);
                      handleOpenSettleModal(c);
                    }}
                    className="text-xs font-bold text-blue-600 hover:text-blue-800 hover:underline cursor-pointer"
                  >
                    + تسجيل فاتورة جديدة
                  </button>
                )}
              </div>

              {inspectedCustodySettlements.length === 0 ? (
                <div className="p-8 text-center bg-slate-50 rounded-2xl border border-slate-100 text-slate-400 text-xs">
                  لم يتم تسجيل أي فواتير تصفية لهذه العهدة بعد.
                </div>
              ) : (
                <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                  {inspectedCustodySettlements.map((item) => (
                    <div 
                      key={item.id}
                      className="p-3 bg-slate-50 hover:bg-slate-100/80 rounded-2xl border border-slate-100 flex items-center justify-between gap-3 text-xs transition"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-slate-900">{item.description}</span>
                          {item.invoiceNumber && (
                            <span className="font-mono text-[10px] px-2 py-0.5 rounded-md bg-slate-200 text-slate-700">
                              #{item.invoiceNumber}
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-400 mt-0.5 flex items-center gap-2">
                          <span>{item.invoiceDate || new Date(item.createdAt).toLocaleDateString('ar-EG')}</span>
                          {item.vendorName && <span>• المورد: {item.vendorName}</span>}
                          {item.serviceCategoryName && <span>• البند: {item.serviceCategoryName}</span>}
                        </div>
                      </div>

                      <div className="flex items-center gap-3 shrink-0">
                        <span className="font-black text-slate-900">
                          {Number(item.amount).toLocaleString()} {item.currency}
                        </span>
                        {item.receiptUrl && (
                          <button
                            type="button"
                            onClick={() => setPreviewReceiptUrl(item.receiptUrl || null)}
                            className="p-1.5 bg-white border border-slate-200 rounded-lg text-slate-600 hover:text-blue-600 hover:border-blue-300"
                            title="عرض الفاتورة"
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Close Button */}
            <div className="mt-6 pt-4 border-t border-slate-100 flex justify-end">
              <button
                type="button"
                onClick={() => setInspectingCustody(null)}
                className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition cursor-pointer"
              >
                إغلاق
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 5: معاينة الفاتورة أو المستند الإلكتروني */}
      {/* ========================================================================= */}
      {previewReceiptUrl && (
        <InvoiceViewerModal
          attachment={{ url: previewReceiptUrl, name: 'مستند_إيصال_العهدة' }}
          onClose={() => setPreviewReceiptUrl(null)}
        />
      )}

    </div>
  );
};
