import React, { useState, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { 
  PaymentAccount, 
  PaymentAccountType, 
  SUPPORTED_CURRENCIES, 
  TransactionType 
} from '../types';
import { 
  Building2, 
  Wallet, 
  Landmark, 
  DollarSign, 
  CreditCard, 
  Plus, 
  Search, 
  X, 
  Edit3, 
  Trash2, 
  ArrowDownLeft, 
  ArrowUpRight, 
  History, 
  TrendingUp,
  TrendingDown,
  Download,
  FileSpreadsheet
} from 'lucide-react';
import { 
  handleNumericKeyDown, 
  sanitizeAmount, 
  sanitizeDigitalWallet, 
  sanitizeIBAN, 
  sanitizeInstaPay 
} from '../utils/validation';

export const TreasuryManagement: React.FC = () => {
  const { 
    paymentAccounts, 
    allPaymentAccounts,
    transactions,
    allTransactions,
    organizations,
    allOrganizations,
    activeOrgId,
    activeOrg,
    currentRole,
    currentUser,
    addPaymentAccount,
    updatePaymentAccount,
    deletePaymentAccount,
    recordManualAccountAdjustment,
    resolveParentBankAccount
  } = useApp();

  const isSuperAdmin = currentRole === 'super_admin';
  const orgList = isSuperAdmin ? (allOrganizations.length > 0 ? allOrganizations : organizations) : organizations;
  const targetAccounts = isSuperAdmin ? allPaymentAccounts : paymentAccounts;
  const targetTransactions = isSuperAdmin ? allTransactions : transactions;

  // Filters & State
  const [selectedOrgFilter, setSelectedOrgFilter] = useState<string>(
    activeOrgId && activeOrgId !== 'all' ? activeOrgId : 'all'
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'accounts' | 'ledger'>('accounts');

  // Account Modal (Add / Edit)
  const [isAccountModalOpen, setIsAccountModalOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<PaymentAccount | null>(null);
  const [accName, setAccName] = useState('');
  const [accType, setAccType] = useState<PaymentAccountType>('instapay');
  const [accIdentifier, setAccIdentifier] = useState('');
  const [accBankName, setAccBankName] = useState('');
  const [accParentAccountId, setAccParentAccountId] = useState('');
  const [accCurrency, setAccCurrency] = useState('EGP');
  const [accInitialBalance, setAccInitialBalance] = useState('');
  const [accDescription, setAccDescription] = useState('');
  const [accOrgId, setAccOrgId] = useState('');

  // Adjustment Modal (Manual IN / OUT)
  const [isAdjustmentModalOpen, setIsAdjustmentModalOpen] = useState(false);
  const [adjustmentTargetAccount, setAdjustmentTargetAccount] = useState<PaymentAccount | null>(null);
  const [adjustmentType, setAdjustmentType] = useState<TransactionType>('in');
  const [adjustmentAmount, setAdjustmentAmount] = useState('');
  const [adjustmentReason, setAdjustmentReason] = useState('');
  const [isAdjusting, setIsAdjusting] = useState(false);

  // Account Detail Inspection
  const [inspectingAccount, setInspectingAccount] = useState<PaymentAccount | null>(null);

  // Filtered Accounts
  const filteredAccounts = useMemo(() => {
    return targetAccounts.filter(acc => {
      if (selectedOrgFilter !== 'all' && acc.orgId !== selectedOrgFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchName = acc.name.toLowerCase().includes(q);
        const matchId = acc.accountIdentifier.toLowerCase().includes(q);
        const matchBank = (acc.bankName || '').toLowerCase().includes(q);
        if (!matchName && !matchId && !matchBank) return false;
      }
      return true;
    });
  }, [targetAccounts, selectedOrgFilter, searchQuery]);

  // Filtered Transactions
  const filteredTransactions = useMemo(() => {
    return targetTransactions.filter(tx => {
      if (selectedOrgFilter !== 'all' && tx.orgId !== selectedOrgFilter) return false;
      if (inspectingAccount && tx.accountId !== inspectingAccount.id) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchAcc = tx.accountName.toLowerCase().includes(q);
        const matchDesc = (tx.description || '').toLowerCase().includes(q);
        const matchRef = (tx.referenceNumber || '').toLowerCase().includes(q);
        const matchActor = (tx.actorName || '').toLowerCase().includes(q);
        if (!matchAcc && !matchDesc && !matchRef && !matchActor) return false;
      }
      return true;
    });
  }, [targetTransactions, selectedOrgFilter, inspectingAccount, searchQuery]);

  // Overall Financial Stats
  const stats = useMemo(() => {
    let totalBalance = 0;
    let totalIn = 0;
    let totalOut = 0;

    filteredAccounts.forEach(acc => {
      totalBalance += Number(acc.currentBalance ?? acc.balance ?? 0);
      totalIn += Number(acc.totalIn ?? 0);
      totalOut += Number(acc.totalOut ?? 0);
    });

    return { totalBalance, totalIn, totalOut };
  }, [filteredAccounts]);

  // Export Filtered Ledger Transactions to Excel / CSV with UTF-8 BOM
  const exportLedgerToExcel = () => {
    const headers = [
      'التاريخ والوقت',
      'الحساب',
      'الشركة',
      'نوع الحركة (وارد / منصرف)',
      'المبلغ',
      'العملة',
      'الرصيد قبل',
      'الرصيد بعد',
      'البيان',
      'رقم المرجع',
      'الموظف المسؤول'
    ];

    const escapeCsvCell = (cell: any) => {
      if (cell === null || cell === undefined) return '""';
      const str = String(cell).replace(/"/g, '""');
      return `"${str}"`;
    };

    const rows = filteredTransactions.map(tx => {
      const orgName = orgList.find(o => o.id === tx.orgId)?.name || activeOrg?.name || 'الشركة';
      const acc = targetAccounts.find(a => a.id === tx.accountId);
      const txCurrency = acc?.currency || activeOrg?.currency || 'EGP';
      const typeText = tx.type === 'in' ? 'وارد / إيداع (+ IN)' : 'منصرف / سحب (- OUT)';
      const dateFormatted = tx.createdAt ? tx.createdAt.replace('T', ' ').slice(0, 19) : '';

      return [
        dateFormatted,
        tx.accountName || '',
        orgName,
        typeText,
        tx.amount,
        txCurrency,
        tx.balanceBefore,
        tx.balanceAfter,
        tx.description || '',
        tx.referenceNumber || '',
        tx.actorName || ''
      ].map(escapeCsvCell).join(',');
    });

    const csvContent = '\uFEFF' + [headers.map(escapeCsvCell).join(','), ...rows].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    const fileName = inspectingAccount 
      ? `كشف_حساب_${inspectingAccount.name.replace(/[/\\?%*:|"<>]/g, '_')}_${new Date().toISOString().slice(0, 10)}.csv`
      : `سجل_حركات_الخزينة_${new Date().toISOString().slice(0, 10)}.csv`;
    link.setAttribute('download', fileName);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Handlers for Account Modal
  const handleOpenAddAccount = () => {
    setEditingAccount(null);
    setAccName('');
    setAccType('instapay');
    setAccIdentifier('');
    setAccBankName('');
    const targetOrg = selectedOrgFilter !== 'all' 
      ? selectedOrgFilter 
      : (activeOrgId && activeOrgId !== 'all' ? activeOrgId : (orgList[0]?.id || ''));
    const defaultBank = targetAccounts.find(a => a.orgId === targetOrg && a.type === 'bank');
    setAccParentAccountId(defaultBank?.id || '');
    setAccCurrency(activeOrg?.currency || 'EGP');
    setAccInitialBalance('0');
    setAccDescription('');
    setAccOrgId(targetOrg);
    setIsAccountModalOpen(true);
  };

  const handleOpenEditAccount = (acc: PaymentAccount) => {
    setEditingAccount(acc);
    setAccName(acc.name);
    setAccType(acc.type);
    setAccIdentifier(acc.accountIdentifier);
    setAccBankName(acc.bankName || '');
    setAccParentAccountId(acc.parentAccountId || '');
    setAccCurrency(acc.currency || 'EGP');
    setAccInitialBalance(String(acc.initialBalance ?? acc.currentBalance ?? 0));
    setAccDescription(acc.description || '');
    setAccOrgId(acc.orgId);
    setIsAccountModalOpen(true);
  };

  const handleSaveAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accName.trim() || !accIdentifier.trim()) return;

    const initialNum = parseFloat(accInitialBalance) || 0;
    const finalOrgId = accOrgId || (selectedOrgFilter !== 'all' ? selectedOrgFilter : '') || (activeOrgId !== 'all' ? activeOrgId : '') || orgList[0]?.id || '';
    
    const parentBank = (accType === 'instapay' || accType === 'wallet') && accParentAccountId
      ? targetAccounts.find(a => a.id === accParentAccountId)
      : undefined;

    if (editingAccount) {
      await updatePaymentAccount(editingAccount.id, {
        name: accName.trim(),
        type: accType,
        accountIdentifier: accIdentifier.trim(),
        bankName: accBankName.trim() || undefined,
        parentAccountId: parentBank ? parentBank.id : undefined,
        parentAccountName: parentBank ? parentBank.name : undefined,
        currency: accCurrency,
        description: accDescription.trim() || undefined,
      });
    } else {
      await addPaymentAccount({
        orgId: finalOrgId,
        name: accName.trim(),
        type: accType,
        accountIdentifier: accIdentifier.trim(),
        bankName: accBankName.trim() || undefined,
        parentAccountId: parentBank ? parentBank.id : undefined,
        parentAccountName: parentBank ? parentBank.name : undefined,
        initialBalance: initialNum,
        currentBalance: initialNum,
        totalIn: 0,
        totalOut: 0,
        currency: accCurrency,
        active: true,
        description: accDescription.trim() || undefined,
      });
    }

    setIsAccountModalOpen(false);
  };

  // Handlers for Adjustment (IN / OUT)
  const handleOpenAdjustment = (acc: PaymentAccount, type: TransactionType) => {
    setAdjustmentTargetAccount(acc);
    setAdjustmentType(type);
    setAdjustmentAmount('');
    setAdjustmentReason('');
    setIsAdjustmentModalOpen(true);
  };

  const handleSaveAdjustment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adjustmentTargetAccount) return;
    const amountNum = parseFloat(adjustmentAmount);
    if (!amountNum || amountNum <= 0) return;

    setIsAdjusting(true);
    try {
      await recordManualAccountAdjustment(
        adjustmentTargetAccount.id,
        adjustmentType,
        amountNum,
        adjustmentReason.trim()
      );
      setIsAdjustmentModalOpen(false);
    } catch (err) {
      console.error(err);
      alert('حدث خطأ أثناء حفظ الحركة المالية.');
    } finally {
      setIsAdjusting(false);
    }
  };

  const getAccountIcon = (type: PaymentAccountType) => {
    switch (type) {
      case 'instapay':
        return <Wallet className="h-5 w-5 text-emerald-600" />;
      case 'wallet':
        return <CreditCard className="h-5 w-5 text-purple-600" />;
      case 'bank':
        return <Landmark className="h-5 w-5 text-indigo-600" />;
      case 'cash':
      default:
        return <DollarSign className="h-5 w-5 text-amber-600" />;
    }
  };

  const getAccountBadge = (type: PaymentAccountType) => {
    switch (type) {
      case 'instapay':
        return '⚡ إنستاباي (InstaPay)';
      case 'wallet':
        return '📱 محفظة إلكترونية';
      case 'bank':
        return '🏛️ حساب بنكي';
      case 'cash':
      default:
        return '💵 خزينة كاش (Petty Cash)';
    }
  };

  return (
    <div className="space-y-6">
      
      {/* Header & Title */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white p-5 rounded-3xl border border-slate-200/80 shadow-xs">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-500 flex items-center justify-center text-white shadow-md shadow-emerald-500/20">
              <Landmark className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-lg sm:text-xl font-black text-slate-900">
                🏛️ إدارة الخزائن والمحافظ وحسابات الصرف (Treasury)
              </h1>
              <p className="text-xs text-slate-500 mt-0.5">
                تتبع الأرصدة المتوفرة، حركات الوارد والمنصرف (IN / OUT)، والربط الآلي مع طلبات التحويل
              </p>
            </div>
          </div>
        </div>

        {/* Action Button */}
        <button
          type="button"
          onClick={handleOpenAddAccount}
          className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-xs shadow-md transition cursor-pointer"
        >
          <Plus className="h-4 w-4" />
          <span>إضافة حساب / خزينة جديدة</span>
        </button>
      </div>

      {/* Financial Overview Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Total Available Balance */}
        <div className="bg-gradient-to-br from-emerald-600 to-teal-700 text-white p-5 rounded-3xl shadow-sm relative overflow-hidden">
          <div className="relative z-10">
            <span className="text-emerald-100 text-xs font-bold block mb-1">الرصيد الكلي المتوفر (Total Balance)</span>
            <div className="text-2xl sm:text-3xl font-black tracking-tight">
              {stats.totalBalance.toLocaleString()} <span className="text-xs font-normal opacity-80">{activeOrg?.currency || 'EGP'}</span>
            </div>
            <span className="text-[11px] text-emerald-100/90 mt-2 block">
              عبر {filteredAccounts.length} حسابات وخزائن نشطة
            </span>
          </div>
          <Wallet className="absolute -left-3 -bottom-3 h-24 w-24 text-white/10" />
        </div>

        {/* Total IN */}
        <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-xs relative overflow-hidden">
          <div className="flex items-center justify-between mb-2">
            <span className="text-slate-500 text-xs font-bold">إجمالي الوارد والتحصيلات (Total IN)</span>
            <span className="p-1.5 bg-emerald-50 text-emerald-600 rounded-xl">
              <TrendingUp className="h-4 w-4" />
            </span>
          </div>
          <div className="text-2xl font-black text-emerald-700">
            +{stats.totalIn.toLocaleString()} <span className="text-xs font-bold text-slate-400">{activeOrg?.currency || 'EGP'}</span>
          </div>
          <span className="text-[11px] text-slate-400 mt-1 block">توريدات، تحصيلات عملاء، وإيداعات نقدية</span>
        </div>

        {/* Total OUT */}
        <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-xs relative overflow-hidden">
          <div className="flex items-center justify-between mb-2">
            <span className="text-slate-500 text-xs font-bold">إجمالي المنصرف والتحويلات (Total OUT)</span>
            <span className="p-1.5 bg-rose-50 text-rose-600 rounded-xl">
              <TrendingDown className="h-4 w-4" />
            </span>
          </div>
          <div className="text-2xl font-black text-rose-700">
            -{stats.totalOut.toLocaleString()} <span className="text-xs font-bold text-slate-400">{activeOrg?.currency || 'EGP'}</span>
          </div>
          <span className="text-[11px] text-slate-400 mt-1 block">طلبات صرف معتمدة، تحويلات لمندوبين، ومصاريف</span>
        </div>
      </div>

      {/* Tabs & Filters */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-white p-3 rounded-2xl border border-slate-200 shadow-xs">
        
        {/* Tab switch */}
        <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl">
          <button
            type="button"
            onClick={() => {
              setActiveTab('accounts');
              setInspectingAccount(null);
            }}
            className={`px-3 py-1.5 text-xs font-bold rounded-lg transition cursor-pointer ${
              activeTab === 'accounts' 
                ? 'bg-white text-emerald-800 shadow-xs' 
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            كروت الحسابات والخزائن ({filteredAccounts.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('ledger')}
            className={`px-3 py-1.5 text-xs font-bold rounded-lg transition cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'ledger' 
                ? 'bg-white text-emerald-800 shadow-xs' 
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <History className="h-3.5 w-3.5 text-emerald-600" />
            <span>دفتر الحركات المالية (Ledger)</span>
          </button>
        </div>

        {/* Search & Org Filter */}
        <div className="flex items-center gap-2 flex-1 sm:justify-end">
          <div className="relative flex-1 sm:max-w-xs">
            <Search className="h-3.5 w-3.5 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="بحث في الحسابات أو المعرفات..."
              className="w-full pr-8 pl-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl outline-hidden focus:border-emerald-500 focus:bg-white"
            />
            {searchQuery && (
              <button 
                onClick={() => setSearchQuery('')}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>

          {/* Org Filter (for Super Admin) */}
          {isSuperAdmin && (
            <select
              value={selectedOrgFilter}
              onChange={(e) => setSelectedOrgFilter(e.target.value)}
              className="px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-800 cursor-pointer outline-hidden"
            >
              <option value="all">🌐 جميع المؤسسات ({orgList.length})</option>
              {orgList.map(o => (
                <option key={o.id} value={o.id}>{o.name} ({o.code})</option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* Main Tab 1: Accounts Cards Grid */}
      {activeTab === 'accounts' && (
        <>
          {filteredAccounts.length === 0 ? (
            <div className="bg-white rounded-3xl border border-slate-200 p-12 text-center shadow-xs">
              <div className="h-16 w-16 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto mb-3">
                <Wallet className="h-8 w-8" />
              </div>
              <h3 className="font-bold text-slate-800 text-sm">لا توجد حسابات أو خزائن مسجلة بعد</h3>
              <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
                ابدأ بإضافة حساب إنستاباي، محفظة إلكترونية، حساب بنكي، أو خزينة كاش لتتمكن من ضبط حركات الصرف والتوريد.
              </p>
              <button
                type="button"
                onClick={handleOpenAddAccount}
                className="mt-4 px-4 py-2 bg-emerald-600 text-white rounded-xl font-bold text-xs hover:bg-emerald-700 transition"
              >
                + إضافة الحساب الأول الآن
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredAccounts.map(acc => {
                const curBal = Number(acc.currentBalance ?? acc.balance ?? 0);
                const accOrg = orgList.find(o => o.id === acc.orgId);

                return (
                  <div 
                    key={acc.id}
                    className="bg-white rounded-3xl border border-slate-200/90 p-5 shadow-xs hover:shadow-md transition flex flex-col justify-between group"
                  >
                    <div>
                      {/* Top Row: Type Badge + Org Badge + Actions */}
                      <div className="flex items-start justify-between gap-2 mb-3">
                        <div className="flex items-center gap-2.5">
                          <div className="h-10 w-10 rounded-2xl bg-slate-50 border border-slate-200/70 flex items-center justify-center shadow-2xs">
                            {getAccountIcon(acc.type)}
                          </div>
                          <div>
                            <span className="text-[10px] font-bold text-slate-500 block">
                              {getAccountBadge(acc.type)}
                            </span>
                            <h3 className="font-extrabold text-slate-900 text-sm leading-tight mt-0.5">
                              {acc.name}
                            </h3>
                          </div>
                        </div>

                        {/* Edit & Delete */}
                        <div className="flex items-center gap-1 opacity-80 group-hover:opacity-100 transition">
                          <button
                            type="button"
                            onClick={() => handleOpenEditAccount(acc)}
                            className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition cursor-pointer"
                            title="تعديل بيانات الحساب"
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (confirm(`هل أنت متأكد من حذف الحساب "${acc.name}"؟`)) {
                                deletePaymentAccount(acc.id);
                              }
                            }}
                            className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition cursor-pointer"
                            title="حذف الحساب"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Account Identifier details */}
                      <div className="bg-slate-50 p-3 rounded-2xl border border-slate-100 space-y-1 mb-4">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-slate-400">معرف الحساب / الرقم:</span>
                          <span className="font-mono font-bold text-slate-800 dir-ltr">{acc.accountIdentifier}</span>
                        </div>
                        {acc.bankName && (
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="text-slate-400">اسم المصرف / البنك:</span>
                            <span className="font-bold text-slate-700">{acc.bankName}</span>
                          </div>
                        )}
                        {accOrg && (
                          <div className="flex items-center justify-between text-[11px] pt-1 border-t border-slate-200/50">
                            <span className="text-slate-400">الشركة:</span>
                            <span className="font-bold text-emerald-800">{accOrg.name} ({accOrg.code})</span>
                          </div>
                        )}
                        {(acc.type === 'instapay' || acc.type === 'wallet') && (
                          <div className="flex items-center justify-between text-[10.5px] pt-1.5 border-t border-blue-100 bg-blue-50/70 -mx-3 px-3 py-1 rounded-b-xl">
                            <span className="text-blue-700 flex items-center gap-1 font-bold">
                              <Landmark className="h-3 w-3 text-blue-600 shrink-0" />
                              خصم/إيداع مزدوج بـ:
                            </span>
                            <span className="font-black text-blue-950 truncate max-w-[140px]" title={acc.parentAccountName || resolveParentBankAccount(acc)?.name || 'الحساب البنكي الرئيسي'}>
                              {acc.parentAccountName || resolveParentBankAccount(acc)?.name || 'الحساب البنكي الرئيسي'}
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Current Balance Display */}
                      <div className="p-3.5 bg-emerald-50/50 rounded-2xl border border-emerald-100 mb-4">
                        <span className="text-[10px] font-bold text-emerald-700 block mb-0.5">الرصيد المتاح الحالي (Balance)</span>
                        <div className="text-xl font-black text-emerald-950">
                          {curBal.toLocaleString()} <span className="text-xs font-semibold text-emerald-700">{acc.currency || 'EGP'}</span>
                        </div>
                        <div className="flex items-center justify-between text-[10px] text-slate-500 mt-2 pt-2 border-t border-emerald-100/70">
                          <span className="text-emerald-700 font-bold">الوارد (+): {Number(acc.totalIn || 0).toLocaleString()}</span>
                          <span className="text-rose-700 font-bold">المنصرف (-): {Number(acc.totalOut || 0).toLocaleString()}</span>
                        </div>
                      </div>
                    </div>

                    {/* Bottom Actions */}
                    <div className="space-y-2 pt-2 border-t border-slate-100">
                      <div className="grid grid-cols-2 gap-2">
                        {/* Quick IN */}
                        <button
                          type="button"
                          onClick={() => handleOpenAdjustment(acc, 'in')}
                          className="flex items-center justify-center gap-1.5 py-2 px-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-2xs transition cursor-pointer"
                        >
                          <ArrowDownLeft className="h-3.5 w-3.5" />
                          <span>إيداع (+ IN)</span>
                        </button>

                        {/* Quick OUT */}
                        <button
                          type="button"
                          onClick={() => handleOpenAdjustment(acc, 'out')}
                          className="flex items-center justify-center gap-1.5 py-2 px-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold shadow-2xs transition cursor-pointer"
                        >
                          <ArrowUpRight className="h-3.5 w-3.5 text-rose-400" />
                          <span>سحب (- OUT)</span>
                        </button>
                      </div>

                      {/* View Ledger */}
                      <button
                        type="button"
                        onClick={() => {
                          setInspectingAccount(acc);
                          setActiveTab('ledger');
                        }}
                        className="w-full flex items-center justify-center gap-1.5 py-1.5 bg-slate-50 hover:bg-slate-100 text-slate-700 rounded-xl text-xs font-semibold border border-slate-200 transition cursor-pointer"
                      >
                        <History className="h-3.5 w-3.5 text-slate-400" />
                        <span>عرض كشف وحركات الحساب ({targetTransactions.filter(t => t.accountId === acc.id).length})</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* Main Tab 2: Financial Ledger / Transaction Log */}
      {activeTab === 'ledger' && (
        <div className="bg-white rounded-3xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-2">
              <History className="h-5 w-5 text-emerald-600" />
              <h2 className="font-extrabold text-slate-900 text-sm sm:text-base">
                {inspectingAccount 
                  ? `دفتر حركات الحساب: ${inspectingAccount.name}` 
                  : 'سجل الحركات المالية المجمعة (جميع الخزائن والمحافظ)'}
              </h2>
              {inspectingAccount && (
                <button
                  type="button"
                  onClick={() => setInspectingAccount(null)}
                  className="text-xs text-emerald-700 hover:underline font-bold mr-2 cursor-pointer"
                >
                  عرض كل الحركات
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={exportLedgerToExcel}
                className="flex items-center gap-1.5 px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-xs transition cursor-pointer active:scale-95"
                title="تصدير كشف الحركات المفلترة إلى ملف إكسل CSV"
              >
                <Download className="h-3.5 w-3.5" />
                <span>تصدير كشف الحساب إلى Excel (CSV)</span>
              </button>
            </div>
          </div>

          {filteredTransactions.length === 0 ? (
            <div className="p-12 text-center text-slate-400 text-xs">
              لا توجد حركات مالية مسجلة بعد. عند تنفيذ وصرف أي طلب أو إجراء إيداع/سحب ستظهر هنا فوراً.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-100">
                  <tr>
                    <th className="p-3.5">التاريخ والوقت</th>
                    <th className="p-3.5">الحساب / الخزينة</th>
                    <th className="p-3.5">نوع الحركة</th>
                    <th className="p-3.5">المبلغ</th>
                    <th className="p-3.5">الرصيد قبل</th>
                    <th className="p-3.5">الرصيد بعد</th>
                    <th className="p-3.5">البيان والتفاصيل</th>
                    <th className="p-3.5">المسؤول</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredTransactions.map(tx => {
                    const isTxIn = tx.type === 'in';

                    return (
                      <tr key={tx.id} className="hover:bg-slate-50/70 transition">
                        <td className="p-3.5 text-slate-400 font-mono whitespace-nowrap text-[11px]">
                          {tx.createdAt.replace('T', ' ').slice(0, 16)}
                        </td>
                        <td className="p-3.5 font-bold text-slate-800 whitespace-nowrap">
                          {tx.accountName}
                        </td>
                        <td className="p-3.5 whitespace-nowrap">
                          <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold ${
                            isTxIn ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-rose-50 text-rose-700 border border-rose-200'
                          }`}>
                            {isTxIn ? <ArrowDownLeft className="h-3 w-3" /> : <ArrowUpRight className="h-3 w-3" />}
                            {isTxIn ? 'وارد / إيداع (+ IN)' : 'منصرف / سحب (- OUT)'}
                          </span>
                        </td>
                        <td className={`p-3.5 font-black whitespace-nowrap ${isTxIn ? 'text-emerald-700' : 'text-rose-700'}`}>
                          {isTxIn ? '+' : '-'}{tx.amount.toLocaleString()}
                        </td>
                        <td className="p-3.5 text-slate-400 font-mono whitespace-nowrap">
                          {tx.balanceBefore.toLocaleString()}
                        </td>
                        <td className="p-3.5 font-bold text-slate-800 font-mono whitespace-nowrap">
                          {tx.balanceAfter.toLocaleString()}
                        </td>
                        <td className="p-3.5 text-slate-600 max-w-xs truncate" title={tx.description}>
                          {tx.referenceNumber && (
                            <span className="font-mono text-emerald-700 font-bold ml-1">
                              [{tx.referenceNumber}]
                            </span>
                          )}
                          {tx.description}
                        </td>
                        <td className="p-3.5 text-slate-500 whitespace-nowrap text-[11px]">
                          {tx.actorName}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* =========================================================================
          MODAL 1: ADD / EDIT ACCOUNT
          ========================================================================= */}
      {isAccountModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto overscroll-contain">
          <div className="bg-white rounded-3xl max-w-lg w-full shadow-2xl border border-slate-100 animate-in fade-in zoom-in-95 duration-150 my-auto flex flex-col max-h-[90vh] overflow-hidden">
            <div className="flex items-center justify-between p-5 sm:p-6 pb-3.5 border-b border-slate-100 shrink-0 bg-white">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold">
                  {editingAccount ? <Edit3 className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                </div>
                <h3 className="font-bold text-slate-900 text-sm">
                  {editingAccount ? 'تعديل بيانات الحساب / الخزينة' : 'إضافة حساب أو وسيلة صرف جديدة'}
                </h3>
              </div>
              <button 
                type="button" 
                onClick={() => setIsAccountModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1.5 hover:bg-slate-100 rounded-xl transition cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSaveAccount} className="flex flex-col flex-1 overflow-hidden min-h-0">
              <div className="p-5 sm:p-6 overflow-y-auto flex-1 space-y-3.5 text-xs overscroll-contain">
              {/* Org Selector (if super admin) */}
              {isSuperAdmin && (
                <div>
                  <label className="block font-bold text-slate-700 mb-1">المؤسسة / الشركة التابع لها الحساب *</label>
                  <select
                    value={accOrgId}
                    onChange={(e) => setAccOrgId(e.target.value)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-semibold"
                  >
                    {orgList.map(o => (
                      <option key={o.id} value={o.id}>{o.name} ({o.code})</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Account Type */}
              <div>
                <label className="block font-bold text-slate-700 mb-1">نوع الحساب / وسيلة الدفع *</label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {[
                    { id: 'instapay', label: 'إنستاباي', icon: Wallet },
                    { id: 'wallet', label: 'محفظة كاش', icon: CreditCard },
                    { id: 'bank', label: 'حساب بنكي', icon: Landmark },
                    { id: 'cash', label: 'خزينة نقدية', icon: DollarSign },
                  ].map(t => {
                    const isSelected = accType === t.id;
                    const Icon = t.icon;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setAccType(t.id as PaymentAccountType)}
                        className={`p-2.5 rounded-xl border flex flex-col items-center gap-1 text-center transition cursor-pointer ${
                          isSelected 
                            ? 'bg-emerald-50 border-emerald-500 text-emerald-900 font-bold shadow-xs' 
                            : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                        }`}
                      >
                        <Icon className="h-4 w-4 text-emerald-600" />
                        <span className="text-[11px]">{t.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Account Name */}
              <div>
                <label className="block font-bold text-slate-700 mb-1">الاسم التعريفي للحساب *</label>
                <input
                  type="text"
                  required
                  value={accName}
                  onChange={(e) => setAccName(e.target.value)}
                  placeholder="مثال: إنستاباي الإدارة، فودافون كاش المبيعات، خزينة كاش المقر..."
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-semibold"
                />
              </div>

              {/* Account Identifier */}
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  {accType === 'instapay' 
                    ? 'عنوان الدفع اللحظي IPA (مثل username@instapay أو رقم الهاتف) *' 
                    : accType === 'wallet' 
                    ? 'رقم هاتف المحفظة الإلكترونية (01xxxxxxxxx) *' 
                    : accType === 'bank' 
                    ? 'رقم الحساب البنكي أو الآيبان (IBAN) *' 
                    : 'معرف الخزينة / العهدة *'}
                </label>
                <input
                  type="text"
                  required
                  value={accIdentifier}
                  onChange={(e) => {
                    if (accType === 'instapay') setAccIdentifier(sanitizeInstaPay(e.target.value));
                    else if (accType === 'wallet') setAccIdentifier(sanitizeDigitalWallet(e.target.value));
                    else if (accType === 'bank') setAccIdentifier(sanitizeIBAN(e.target.value));
                    else setAccIdentifier(e.target.value);
                  }}
                  placeholder={
                    accType === 'instapay' ? 'company@instapay' :
                    accType === 'wallet' ? '01012345678' :
                    accType === 'bank' ? 'EG0000000000000000000000000' : 'CASH-MAIN'
                  }
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono font-bold"
                />
              </div>

              {/* Bank Name if Bank or InstaPay */}
              {(accType === 'bank' || accType === 'instapay') && (
                <div>
                  <label className="block font-bold text-slate-700 mb-1">اسم البنك / المصرف (اختياري)</label>
                  <input
                    type="text"
                    value={accBankName}
                    onChange={(e) => setAccBankName(e.target.value)}
                    placeholder="مثال: البنك التجاري الدولي CIB، بنك مصر، البنك الأهلي..."
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                  />
                </div>
              )}

              {/* Linked Parent Bank Account for InstaPay / Digital Wallet (Dual Deduction) */}
              {(accType === 'instapay' || accType === 'wallet') && (
                <div className="bg-blue-50/80 border border-blue-200/90 rounded-2xl p-3.5 space-y-2">
                  <div className="flex items-center gap-2">
                    <Landmark className="h-4 w-4 text-blue-600 shrink-0" />
                    <label className="block font-bold text-blue-950 text-xs">
                      الحساب البنكي الرئيسي المرتبط به (للخصم والإيداع المزدوج التلقائي)
                    </label>
                  </div>
                  <p className="text-[11px] text-blue-800 leading-relaxed">
                    💡 حساب الإنستاباي والمحافظ الإلكترونية تكون مغذاة أو مربوطة بحساب بنكي رئيسي. عند اختيار الحساب البنكي، سيتم تلقائياً خصم أو إيداع نفس المبلغ في البنك مع كل حركة صرف أو توريد.
                  </p>
                  <select
                    value={accParentAccountId}
                    onChange={(e) => setAccParentAccountId(e.target.value)}
                    className="w-full p-2.5 bg-white border border-blue-300 rounded-xl font-bold text-slate-800 text-xs"
                  >
                    <option value="">-- بدون ربط بنكي مباشر --</option>
                    {targetAccounts
                      .filter(a => a.orgId === (accOrgId || (selectedOrgFilter !== 'all' ? selectedOrgFilter : '') || (activeOrgId !== 'all' ? activeOrgId : '') || orgList[0]?.id) && a.type === 'bank' && (!editingAccount || a.id !== editingAccount.id))
                      .map(bank => (
                        <option key={bank.id} value={bank.id}>
                          🏦 {bank.name} ({bank.accountIdentifier}) — الرصيد: {Number(bank.currentBalance ?? bank.balance ?? 0).toLocaleString()} {bank.currency}
                        </option>
                      ))}
                  </select>
                </div>
              )}

              {/* Initial Balance & Currency (Only when creating) */}
              {!editingAccount && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">الرصيد الافتتاحي *</label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={accInitialBalance}
                      onKeyDown={handleNumericKeyDown}
                      onChange={(e) => setAccInitialBalance(sanitizeAmount(e.target.value))}
                      placeholder="0.00"
                      className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold font-mono"
                    />
                  </div>
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">العملة *</label>
                    <select
                      value={accCurrency}
                      onChange={(e) => setAccCurrency(e.target.value)}
                      className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold"
                    >
                      {SUPPORTED_CURRENCIES.map(c => (
                        <option key={c.code} value={c.code}>{c.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              {/* Description */}
              <div>
                <label className="block font-bold text-slate-700 mb-1">ملاحظات ووصف الحساب</label>
                <textarea
                  rows={2}
                  value={accDescription}
                  onChange={(e) => setAccDescription(e.target.value)}
                  placeholder="بيانات إضافية عن حدود الصرف، الشخص المسؤول عن الحساب..."
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2.5 p-4 sm:px-6 border-t border-slate-100 shrink-0 bg-slate-50/90 rounded-b-3xl">
                <button
                  type="button"
                  onClick={() => setIsAccountModalOpen(false)}
                  className="px-4 py-2 text-slate-600 hover:bg-slate-200/60 rounded-xl font-bold transition cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold shadow-md transition cursor-pointer active:scale-98"
                >
                  {editingAccount ? 'حفظ التعديلات' : 'إنشاء وتفعيل الحساب'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =========================================================================
          MODAL 2: MANUAL ADJUSTMENT (IN / OUT)
          ========================================================================= */}
      {isAdjustmentModalOpen && adjustmentTargetAccount && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto overscroll-contain">
          <div className="bg-white rounded-3xl max-w-md w-full shadow-2xl border border-slate-100 animate-in fade-in zoom-in-95 duration-150 my-auto flex flex-col max-h-[90vh] overflow-hidden">
            <div className="flex items-center justify-between p-5 pb-3.5 border-b border-slate-100 shrink-0 bg-white rounded-t-3xl">
              <div className="flex items-center gap-2">
                <div className={`h-8 w-8 rounded-lg flex items-center justify-center font-bold ${
                  adjustmentType === 'in' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'
                }`}>
                  {adjustmentType === 'in' ? <ArrowDownLeft className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-sm">
                    {adjustmentType === 'in' ? 'إيداع وتغذية رصيد (+ IN)' : 'سحب وتسوية رصيد (- OUT)'}
                  </h3>
                  <span className="text-[11px] text-slate-400 block">{adjustmentTargetAccount.name}</span>
                </div>
              </div>
              <button 
                type="button" 
                onClick={() => setIsAdjustmentModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1.5 hover:bg-slate-100 rounded-xl transition cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSaveAdjustment} className="flex flex-col flex-1 overflow-hidden min-h-0">
              <div className="p-5 overflow-y-auto flex-1 space-y-3.5 text-xs overscroll-contain">
                {/* Current balance reminder */}
                <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 flex items-center justify-between">
                  <span className="text-slate-500 font-medium">الرصيد الحالي للحساب:</span>
                  <span className="font-bold text-slate-900 font-mono text-sm">
                    {Number(adjustmentTargetAccount.currentBalance ?? adjustmentTargetAccount.balance ?? 0).toLocaleString()} {adjustmentTargetAccount.currency}
                  </span>
                </div>

                {/* Amount */}
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    المبلغ المراد {adjustmentType === 'in' ? 'إيداعه' : 'سحبه'} ({adjustmentTargetAccount.currency}) *
                  </label>
                  <input
                    type="text"
                    required
                    inputMode="decimal"
                    value={adjustmentAmount}
                    onKeyDown={handleNumericKeyDown}
                    onChange={(e) => setAdjustmentAmount(sanitizeAmount(e.target.value))}
                    placeholder="0.00"
                    className={`w-full p-2.5 bg-slate-50 border rounded-xl font-bold font-mono text-base ${
                      adjustmentType === 'in' ? 'focus:border-emerald-500 text-emerald-800' : 'focus:border-rose-500 text-rose-800'
                    }`}
                  />
                </div>

                {/* Reason / Notes */}
                <div>
                  <label className="block font-bold text-slate-700 mb-1">بيان وسبب الحركة *</label>
                  <textarea
                    required
                    rows={3}
                    value={adjustmentReason}
                    onChange={(e) => setAdjustmentReason(e.target.value)}
                    placeholder={
                      adjustmentType === 'in'
                        ? 'مثال: توريد نقدي من المندوب فلان، استلام مبيعات يومية، إيداع بنكي...'
                        : 'مثال: تسليم عهدة كاش للمندوب، سحب نثريات غير مجدولة، مصاريف بنكية...'
                    }
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2.5 p-4 sm:px-6 border-t border-slate-100 shrink-0 bg-slate-50/90 rounded-b-3xl">
                <button
                  type="button"
                  onClick={() => setIsAdjustmentModalOpen(false)}
                  className="px-4 py-2 text-slate-600 hover:bg-slate-200/60 rounded-xl font-bold transition cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={isAdjusting || !adjustmentAmount}
                  className={`px-5 py-2.5 text-white rounded-xl font-bold shadow-md transition cursor-pointer active:scale-98 ${
                    adjustmentType === 'in' 
                      ? 'bg-emerald-600 hover:bg-emerald-700' 
                      : 'bg-rose-600 hover:bg-rose-700'
                  }`}
                >
                  {isAdjusting ? 'جاري الحفظ...' : (adjustmentType === 'in' ? 'تأكيد الإيداع (+)' : 'تأكيد السحب (-)')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};
