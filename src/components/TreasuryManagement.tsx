import React, { useState, useMemo, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import {
  AccountTransaction,
  PaymentAccount,
  PaymentAccountType,
  SUPPORTED_CURRENCIES,
  TransactionReferenceType,
  TransactionType
} from '../types';
import {
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
  ArrowLeftRight,
  Briefcase,
  CheckCircle2,
  History,
  Info,
  TrendingUp,
  TrendingDown,
  Download,
  FileSpreadsheet,
  Unlink,
  Power,
  PowerOff,
  Lock
} from 'lucide-react';
import {
  handleNumericKeyDown,
  sanitizeAmount,
  sanitizeDigitalWallet,
  sanitizeIBAN,
  sanitizeInstaPay
} from '../utils/validation';
import { useKeyedSubmitGuard, useSubmitGuard } from '../hooks/useSubmitGuard';
import { useLiveEqQuery, usePagedHistory } from '../hooks/usePagedHistory';
import { useAccountLedgerCounts } from '../hooks/useAccountLedgerCounts';
import { historyScope } from '../lib/pagination';
import { HistoryPagerFooter } from './ListPaging';
import { isLegacyLinkedWallet, linkedParentIdOf, MAX_CUSTODY_RETURN_BATCH } from '../domain/treasury';
import { isArchivedOrg, toMoney } from '../domain/common';
import { showToast } from '../utils/toast';
import { can } from '../utils/permissions';

const errorText = (err: unknown, fallback: string) =>
  err instanceof Error && err.message ? err.message : fallback;

const balanceOf = (acc: PaymentAccount) => toMoney(acc.currentBalance ?? acc.balance ?? 0);
// Same normalisation as the domain (src/domain/treasury.ts): an empty currency is EGP.
const currencyOf = (c?: string | null) => ((c || '').trim() || 'EGP').toUpperCase();
// Amounts always in Western digits, whatever the browser locale.
const fmtMoney = (n: unknown) => toMoney(n).toLocaleString('en-US', { maximumFractionDigits: 2 });

const pad2 = (n: number) => String(n).padStart(2, '0');
/** Local date (browser time zone, e.g. Africa/Cairo), Western digits: YYYY-MM-DD. */
const localDate = (d: Date = new Date()) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
/**
 * A stored ISO timestamp (UTC) in the viewer's local time with Western digits:
 * YYYY-MM-DD HH:mm (or HH:mm:ss). Slicing the ISO string showed UTC, 3 h off in Cairo.
 */
const localDateTime = (iso?: string | null, withSeconds = false) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const hm = `${pad2(d.getHours())}:${pad2(d.getMinutes())}${withSeconds ? `:${pad2(d.getSeconds())}` : ''}`;
  return `${localDate(d)} ${hm}`;
};

// Readable label of a ledger entry's origin (AccountTransaction.referenceType).
const REFERENCE_TYPE_LABELS: Record<TransactionReferenceType, string> = {
  request: 'صرف طلب / دفعة',
  manual_adjustment: 'حركة يدوية',
  initial: 'رصيد افتتاحي',
  custody: 'صرف / استعاضة عهدة',
  custody_return: 'استرداد متبقي عهدة',
  transfer: 'تحويل بين الحسابات',
};
const referenceTypeLabel = (type?: string) =>
  (type && REFERENCE_TYPE_LABELS[type as TransactionReferenceType]) || '';

const CUSTODY_RETURN_REASON = 'استرداد متبقي عهدة موظف';

const ACCOUNT_TYPE_SHORT: Record<PaymentAccountType, string> = {
  instapay: 'إنستاباي',
  wallet: 'محفظة',
  bank: 'بنك',
  cash: 'كاش',
  other: 'أخرى',
};
const accountTypeShort = (type?: string) => ACCOUNT_TYPE_SHORT[type as PaymentAccountType] || 'أخرى';

export const TreasuryManagement: React.FC = () => {
  const { 
    paymentAccounts, 
    allPaymentAccounts,
    organizations,
    allOrganizations,
    activeOrgId,
    activeOrg,
    currentRole,
    addPaymentAccount,
    updatePaymentAccount,
    deletePaymentAccount,
    togglePaymentAccountStatus,
    recordManualAccountAdjustment,
    resolveParentBankAccount,
    custodies,
    allCustodies,
    returnCustodyRemainders,
    transferBetweenAccounts,
    detachLegacyWallet
  } = useApp();

  const isSuperAdmin = currentRole === 'super_admin';
  // Every action is shown only to the roles the domain / firestore.rules accept (src/utils/permissions.ts).
  const canViewTreasury = can(currentRole, 'viewTreasury');
  const canMoveMoney = can(currentRole, 'moveMoney');
  const canCreateAccounts = can(currentRole, 'createAccounts');
  const canEditAccounts = can(currentRole, 'editAccounts');
  const canDeleteAccounts = can(currentRole, 'deleteAccounts');
  const canDetachWallets = can(currentRole, 'detachWallets');
  const orgList = isSuperAdmin ? (allOrganizations.length > 0 ? allOrganizations : organizations) : organizations;
  // A new account goes only to a company that is still active (an archived one takes no new records).
  const creatableOrgs = orgList.filter(o => !isArchivedOrg(o));
  const targetAccounts = isSuperAdmin ? allPaymentAccounts : paymentAccounts;
  const targetCustodies = isSuperAdmin ? allCustodies : custodies;

  // Linked parent bank of an account: an InstaPay channel's bank, or the bank a legacy
  // wallet still mirrors to until it is detached. New wallets are standalone treasuries.
  const linkedParentOf = useCallback((acc: PaymentAccount | null | undefined): PaymentAccount | null => {
    if (!acc) return null;
    const parentId = linkedParentIdOf(acc);
    if (!parentId) return null;
    return targetAccounts.find(a => a.id === parentId) || resolveParentBankAccount(acc);
  }, [targetAccounts, resolveParentBankAccount]);

  // Where an account's money actually sits (mirrors the domain's same-funds check):
  // the bank behind a linked InstaPay channel, otherwise the account itself.
  const fundsHolderIdOf = useCallback((acc: PaymentAccount) => linkedParentOf(acc)?.id || acc.id, [linkedParentOf]);

  // Success feedback for every money movement / account change, and the error of a card action
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const showNotice = (text: string) => {
    setActionError(null);
    setNotice(text);
  };

  // Internal transfers only move money between the company's own accounts: they change the
  // balances but are neither income nor spending, so the Total IN / Total OUT headline leaves
  // them out (both legs, and the mirror entry on an InstaPay channel's bank). Only the transfer
  // lines are loaded for this (live, equality filters only: no composite index), never the
  // whole ledger; the ledger itself is paged below.
  const transferLegs = useLiveEqQuery<AccountTransaction>(
    'accountTransactions',
    canViewTreasury ? historyScope({ isSuperAdmin, activeOrgId, extra: [['referenceType', 'transfer']] }) : null,
  );
  const transferTotalsByAccount = useMemo(() => {
    const totals = new Map<string, { in: number; out: number }>();
    const seenIds = new Set<string>();
    transferLegs.items.forEach(tx => {
      if (tx.referenceType !== 'transfer' || seenIds.has(tx.id)) return;
      seenIds.add(tx.id);
      const row = totals.get(tx.accountId) || { in: 0, out: 0 };
      if (tx.type === 'in') row.in += Number(tx.amount || 0);
      else row.out += Number(tx.amount || 0);
      totals.set(tx.accountId, row);
    });
    return totals;
  }, [transferLegs.items]);

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
  const [adjustmentError, setAdjustmentError] = useState('');
  // Deposit window: a plain amount, or taking back what employees still hold of their custodies
  const [depositMode, setDepositMode] = useState<'amount' | 'custody'>('amount');
  const [selectedCustodyIds, setSelectedCustodyIds] = useState<string[]>([]);
  const [custodyReturnNotes, setCustodyReturnNotes] = useState('');

  // Transfer Modal (account -> account)
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [transferFromId, setTransferFromId] = useState('');
  const [transferToId, setTransferToId] = useState('');
  const [transferAmount, setTransferAmount] = useState('');
  const [transferDescription, setTransferDescription] = useState('');
  const [transferError, setTransferError] = useState('');

  // Detach Modal (legacy wallet still mirrored on its bank -> standalone treasury)
  const [detachWalletId, setDetachWalletId] = useState('');
  const [detachMode, setDetachMode] = useState<'suggested' | 'custom' | 'none'>('suggested');
  const [detachDirection, setDetachDirection] = useState<TransactionType>('in');
  const [detachAmount, setDetachAmount] = useState('');
  const [detachNote, setDetachNote] = useState('');
  const [detachError, setDetachError] = useState('');
  const detachGuard = useSubmitGuard();

  // Synchronous submit locks + idempotency keys (double click / Enter+click / retry-safe)
  const accountGuard = useSubmitGuard();
  const adjustmentGuard = useSubmitGuard();
  const custodyReturnGuard = useSubmitGuard();
  const transferGuard = useSubmitGuard();
  // Per-card actions (delete / deactivate / reactivate) with their own pending state
  const accountActions = useKeyedSubmitGuard();
  const isSavingAccount = accountGuard.pending;
  const isAdjusting = adjustmentGuard.pending || custodyReturnGuard.pending;
  const isTransferring = transferGuard.pending;

  // Account Detail Inspection
  const [inspectingAccount, setInspectingAccount] = useState<PaymentAccount | null>(null);

  const searchNeedle = searchQuery.trim().toLowerCase();

  // Accounts of the selected company, before the search box (tells "no match" from "none yet")
  const orgScopedAccounts = useMemo(
    () => targetAccounts.filter(acc => selectedOrgFilter === 'all' || acc.orgId === selectedOrgFilter),
    [targetAccounts, selectedOrgFilter]
  );

  // Filtered Accounts: name, identifier (IBAN / IPA / phone / code), bank or type (Arabic label or code)
  const filteredAccounts = useMemo(() => {
    if (!searchNeedle) return orgScopedAccounts;
    return orgScopedAccounts.filter(acc =>
      (acc.name || '').toLowerCase().includes(searchNeedle) ||
      (acc.accountIdentifier || '').toLowerCase().includes(searchNeedle) ||
      (acc.bankName || '').toLowerCase().includes(searchNeedle) ||
      accountTypeShort(acc.type).includes(searchNeedle) ||
      (acc.type || '').toLowerCase() === searchNeedle
    );
  }, [orgScopedAccounts, searchNeedle]);

  // Ledger lines per account (the card's statement count, and the history check before a
  // delete): counted by Firestore for the cards on screen, never by loading the whole ledger.
  const ledgerCountByAccount = useAccountLedgerCounts(filteredAccounts, canViewTreasury && activeTab === 'accounts');

  // An account that holds money or has any history is never hard-deleted (its ledger would be
  // orphaned); it is deactivated instead. Mirrors the domain guard on deletePaymentAccount
  // (deletePaymentAccount in AppContext also reads the ledger fresh before deleting).
  const accountHasHistory = (acc: PaymentAccount) =>
    balanceOf(acc) !== 0 ||
    toMoney(acc.totalIn) !== 0 ||
    toMoney(acc.totalOut) !== 0 ||
    toMoney(acc.initialBalance) !== 0 ||
    Boolean(acc.lastLedgerId) ||
    (ledgerCountByAccount.get(acc.id) || 0) > 0;

  // The ledger, newest first, paged on the server (first page live, "تحميل المزيد" for the
  // older ones): the whole company / platform ledger, the owner's company filter, or one
  // account's statement (accountId). Loaded only while the ledger tab is open.
  const ledger = usePagedHistory<AccountTransaction>({
    col: 'accountTransactions',
    orderField: 'createdAt',
    enabled: canViewTreasury && activeTab === 'ledger',
    filters: historyScope({
      isSuperAdmin,
      orgFilter: selectedOrgFilter,
      activeOrgId,
      extra: inspectingAccount ? [['accountId', inspectingAccount.id]] : [],
      recordOrgId: inspectingAccount?.orgId,
    }),
  });

  // Filtered Transactions: the same search as the cards (every movement of a matching account),
  // plus a match on the entry's own text (description, reference, responsible person).
  // Ledger ids are deterministic (derived from the operation key), so entries are de-duplicated
  // by document id ONLY: two entries sharing a reference (a custody issued then replenished,
  // both legs of a transfer…) are distinct real money movements.
  const filterLedger = useCallback((entries: AccountTransaction[]) => {
    const matchingAccountIds = new Set(filteredAccounts.map(a => a.id));
    const seenIds = new Set<string>();
    return entries.filter(tx => {
      if (seenIds.has(tx.id)) return false;
      seenIds.add(tx.id);
      if (selectedOrgFilter !== 'all' && tx.orgId !== selectedOrgFilter) return false;
      if (inspectingAccount && tx.accountId !== inspectingAccount.id) return false;
      if (searchNeedle) {
        const matchAcc = matchingAccountIds.has(tx.accountId) || (tx.accountName || '').toLowerCase().includes(searchNeedle);
        const matchDesc = (tx.description || '').toLowerCase().includes(searchNeedle);
        const matchRef = (tx.referenceNumber || '').toLowerCase().includes(searchNeedle);
        const matchActor = (tx.actorName || '').toLowerCase().includes(searchNeedle);
        if (!matchAcc && !matchDesc && !matchRef && !matchActor) return false;
      }
      return true;
    });
  }, [filteredAccounts, selectedOrgFilter, inspectingAccount, searchNeedle]);
  const filteredTransactions = useMemo(() => filterLedger(ledger.items), [filterLedger, ledger.items]);

  // Overall Financial Stats (Aggregated only across primary physical containers to prevent double counting linked channels)
  const stats = useMemo(() => {
    // An InstaPay channel linked to a bank account is a mirror of that bank's funds (dual
    // deduction keeps both in sync), so for macro-level liquidity totals (الرصيد الكلي، إجمالي
    // الوارد، إجمالي المنصرف) it must not be counted twice. E-wallets are standalone treasuries
    // with their own money, so they always count as primary balances.
    const isLinkedChildAccount = (acc: PaymentAccount) => Boolean(linkedParentOf(acc));

    // Filter to primary independent financial accounts (Banks, Cash Safes, wallets, unlinked InstaPay)
    let accountsToSum = filteredAccounts.filter(acc => !isLinkedChildAccount(acc));

    // Fallback: If user filtered/searched specifically for a child account (e.g. typed "إنستاباي"),
    // so accountsToSum would be empty, fall back to filteredAccounts so the user sees the numbers for that account.
    if (accountsToSum.length === 0 && filteredAccounts.length > 0) {
      accountsToSum = filteredAccounts;
    }

    // Totals per currency: amounts in different currencies are never added under one label.
    // Total IN / OUT leave internal transfers out (they are not income or spending).
    const byCurrency = new Map<string, { balance: number; totalIn: number; totalOut: number }>();
    accountsToSum.forEach(acc => {
      const cur = currencyOf(acc.currency);
      const row = byCurrency.get(cur) || { balance: 0, totalIn: 0, totalOut: 0 };
      const moved = transferTotalsByAccount.get(acc.id);
      row.balance = toMoney(row.balance + balanceOf(acc));
      row.totalIn = toMoney(row.totalIn + Math.max(0, Number(acc.totalIn ?? 0) - (moved?.in || 0)));
      row.totalOut = toMoney(row.totalOut + Math.max(0, Number(acc.totalOut ?? 0) - (moved?.out || 0)));
      byCurrency.set(cur, row);
    });
    // The company's own currency first, then the others alphabetically
    const mainCurrency = currencyOf(activeOrg?.currency);
    const currencies = Array.from(byCurrency.keys()).sort((a, b) =>
      a === mainCurrency ? -1 : b === mainCurrency ? 1 : a.localeCompare(b)
    );
    const totals = currencies.map(currency => ({ currency, ...byCurrency.get(currency)! }));
    const primary = totals[0] || { currency: mainCurrency, balance: 0, totalIn: 0, totalOut: 0 };
    const otherCurrencies = totals.slice(1);

    const primaryCount = accountsToSum.length;
    const totalCount = filteredAccounts.length;
    const linkedCount = totalCount - primaryCount;

    return {
      primary,
      otherCurrencies,
      primaryCount,
      totalCount,
      linkedCount
    };
  }, [filteredAccounts, linkedParentOf, transferTotalsByAccount, activeOrg?.currency]);

  // Export Filtered Ledger Transactions to Excel / CSV with UTF-8 BOM. The export covers the
  // WHOLE ledger / statement of the current scope: the older pages not shown yet are read first.
  const exportGuard = useSubmitGuard();
  const exportLedgerToExcel = () => {
    void exportGuard.run(async () => {
      let entries = filteredTransactions;
      if (ledger.hasMore) {
        try {
          entries = filterLedger(await ledger.loadAll());
        } catch (err) {
          console.error(err);
          showToast('تعذر تحميل كامل الحركات للتصدير. أعد المحاولة.', 'error');
          return;
        }
      }
      writeLedgerCsv(entries);
    });
  };
  const writeLedgerCsv = (entries: AccountTransaction[]) => {
    const headers = [
      'التاريخ والوقت',
      'الحساب',
      'الشركة',
      'نوع الحركة (وارد / منصرف)',
      'نوع العملية',
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

    const rows = entries.map(tx => {
      const orgName = orgList.find(o => o.id === tx.orgId)?.name || activeOrg?.name || 'الشركة';
      const acc = targetAccounts.find(a => a.id === tx.accountId);
      const txCurrency = acc?.currency || activeOrg?.currency || 'EGP';
      const typeText = tx.type === 'in' ? 'وارد / إيداع (+ IN)' : 'منصرف / سحب (- OUT)';
      // Local time (as on every other screen), not the stored UTC
      const dateFormatted = localDateTime(tx.createdAt, true);

      return [
        dateFormatted,
        tx.accountName || '',
        orgName,
        typeText,
        referenceTypeLabel(tx.referenceType),
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
      ? `كشف_حساب_${inspectingAccount.name.replace(/[/\\?%*:|"<>]/g, '_')}_${localDate()}.csv`
      : `سجل_حركات_الخزينة_${localDate()}.csv`;
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
    const preferredOrg = selectedOrgFilter !== 'all'
      ? selectedOrgFilter
      : (activeOrgId && activeOrgId !== 'all' ? activeOrgId : (creatableOrgs[0]?.id || ''));
    // The super admin's picker lists active companies only: an archived default gives way to the first active one.
    const targetOrg = isSuperAdmin && !creatableOrgs.some(o => o.id === preferredOrg) ? (creatableOrgs[0]?.id || '') : preferredOrg;
    const defaultBank = targetAccounts.find(a => a.orgId === targetOrg && a.type === 'bank');
    setAccParentAccountId(defaultBank?.id || '');
    setAccCurrency(activeOrg?.currency || 'EGP');
    setAccInitialBalance('0');
    setAccDescription('');
    setAccOrgId(targetOrg);
    accountGuard.rotateKey();
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
    
    // Only an InstaPay channel is linked to a bank; a wallet (or any other type) sends no
    // link at all (the domain keeps a legacy wallet's link until it is detached).
    const isInstaPay = accType === 'instapay';
    const parentBank = isInstaPay && accParentAccountId
      ? targetAccounts.find(a => a.id === accParentAccountId)
      : undefined;

    await accountGuard.run(async (idempotencyKey) => {
      try {
        if (editingAccount) {
          await updatePaymentAccount(editingAccount.id, {
            name: accName.trim(),
            type: accType,
            accountIdentifier: accIdentifier.trim(),
            bankName: accBankName.trim() || undefined,
            // '' (not undefined, which is stripped before writing) so "بدون ربط" really unlinks an InstaPay
            ...(isInstaPay
              ? { parentAccountId: parentBank ? parentBank.id : '', parentAccountName: parentBank ? parentBank.name : '' }
              : {}),
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
          }, { idempotencyKey });
        }

        accountGuard.rotateKey();
        setIsAccountModalOpen(false);
        showNotice(editingAccount ? `تم حفظ تعديلات الحساب "${accName.trim()}".` : `تم إنشاء الحساب "${accName.trim()}" وتفعيله.`);
      } catch (err) {
        console.error(err);
        showToast(errorText(err, 'حدث خطأ أثناء حفظ بيانات الحساب.'), 'error');
      }
    });
  };

  // Delete: only an account with no balance and no history (asks first)
  const handleDeleteAccount = async (acc: PaymentAccount) => {
    if (accountHasHistory(acc)) {
      setNotice(null);
      setActionError(`لا يمكن حذف الحساب "${acc.name}" لأن له رصيداً أو حركات مسجلة؛ يمكنك تعطيله بدلاً من الحذف.`);
      return;
    }
    if (!window.confirm(`هل أنت متأكد من حذف الحساب "${acc.name}" نهائياً؟ لا يمكن التراجع عن هذا الإجراء.`)) return;
    await accountActions.run(`delete:${acc.id}`, async () => {
      try {
        setActionError(null);
        await deletePaymentAccount(acc.id);
        if (inspectingAccount?.id === acc.id) setInspectingAccount(null);
        showNotice(`تم حذف الحساب "${acc.name}".`);
      } catch (err) {
        console.error(err);
        setNotice(null);
        setActionError(errorText(err, 'حدث خطأ أثناء حذف الحساب.'));
      }
    });
  };

  // Deactivate / reactivate: keeps the balance and the full ledger (asks first)
  const handleToggleAccountActive = async (acc: PaymentAccount, active: boolean) => {
    const question = active
      ? `إعادة تفعيل الحساب "${acc.name}"؟ سيظهر مجدداً في قوائم الإيداع والسحب والتحويل والصرف.`
      : `تعطيل الحساب "${acc.name}"؟ يبقى رصيده (${fmtMoney(balanceOf(acc))} ${currencyOf(acc.currency)}) وكشف حركاته كما هو، ولن يُستخدم في أي عملية جديدة حتى تعيد تفعيله.`;
    if (!window.confirm(question)) return;
    await accountActions.run(`toggle:${acc.id}`, async () => {
      try {
        setActionError(null);
        await togglePaymentAccountStatus(acc.id, active);
        showNotice(active ? `تم إعادة تفعيل الحساب "${acc.name}".` : `تم تعطيل الحساب "${acc.name}"؛ رصيده وكشف حركاته محفوظان.`);
      } catch (err) {
        console.error(err);
        setNotice(null);
        setActionError(errorText(err, 'حدث خطأ أثناء تغيير حالة الحساب.'));
      }
    });
  };

  // Handlers for Adjustment (IN / OUT)
  const handleOpenAdjustment = (acc: PaymentAccount, type: TransactionType, mode: 'amount' | 'custody' = 'amount') => {
    setAdjustmentTargetAccount(acc);
    setAdjustmentType(type);
    setAdjustmentAmount('');
    setAdjustmentReason('');
    setAdjustmentError('');
    setDepositMode(type === 'in' ? mode : 'amount');
    setSelectedCustodyIds([]);
    setCustodyReturnNotes('');
    adjustmentGuard.rotateKey();
    custodyReturnGuard.rotateKey();
    setNotice(null);
    setIsAdjustmentModalOpen(true);
  };

  // Live copy of the modal's account (balances move while the modal is open)
  const adjustmentAccount = adjustmentTargetAccount
    ? targetAccounts.find(a => a.id === adjustmentTargetAccount.id) || adjustmentTargetAccount
    : null;
  const isCustodyReturnMode = adjustmentType === 'in' && depositMode === 'custody';

  // No account may go below zero: a withdrawal needs the account — and the bank behind an
  // InstaPay channel — to cover it (same rule as transfers and the domain's movement batch).
  const adjustmentParent = linkedParentOf(adjustmentAccount);
  const adjustmentAvailable = adjustmentAccount
    ? adjustmentParent
      ? Math.min(balanceOf(adjustmentAccount), balanceOf(adjustmentParent))
      : balanceOf(adjustmentAccount)
    : 0;
  const adjustmentAmountNum = toMoney(parseFloat(adjustmentAmount) || 0);
  const withdrawExceedsBalance = adjustmentType === 'out' && adjustmentAmountNum > 0 && adjustmentAmountNum > adjustmentAvailable;
  const insufficientWithdrawMessage = (acc: PaymentAccount) => {
    const cur = currencyOf(acc.currency);
    const limitedByBank = adjustmentParent && balanceOf(adjustmentParent) < balanceOf(acc);
    return `الرصيد غير كافٍ: المتاح للسحب ${fmtMoney(adjustmentAvailable)} ${cur}${
      limitedByBank ? ` (محدود برصيد الحساب البنكي المرتبط "${adjustmentParent?.name}")` : ''
    } والمبلغ المطلوب ${fmtMoney(adjustmentAmountNum)} ${cur}. لا يُسمح بأن يصبح رصيد أي حساب بالسالب؛ قم بإيداع رصيد في الحساب أولاً ثم أعد المحاولة.`;
  };

  // Custodies whose remaining cash can go back into the deposit window's account:
  // same company and currency as that account, something still left with the employee.
  const returnableCustodies = useMemo(() => {
    if (!adjustmentAccount) return [];
    const accCurrency = currencyOf(adjustmentAccount.currency);
    const seen = new Set<string>();
    return targetCustodies
      .filter(c => {
        if (seen.has(c.id)) return false;
        seen.add(c.id);
        return c.orgId === adjustmentAccount.orgId
          && currencyOf(c.currency) === accCurrency
          && toMoney(c.remainingAmount) > 0;
      })
      .sort((a, b) =>
        (a.employeeName || '').localeCompare(b.employeeName || '', 'ar') ||
        (a.custodyNumber || '').localeCompare(b.custodyNumber || '')
      );
  }, [targetCustodies, adjustmentAccount]);

  // Only rows still listed count (a custody returned meanwhile by someone else drops out).
  const selectedReturnCustodies = useMemo(() => {
    const picked = new Set(selectedCustodyIds);
    return returnableCustodies.filter(c => picked.has(c.id));
  }, [returnableCustodies, selectedCustodyIds]);
  const selectedReturnTotal = toMoney(selectedReturnCustodies.reduce((sum, c) => sum + toMoney(c.remainingAmount), 0));
  const allReturnableSelected =
    returnableCustodies.length > 0 &&
    selectedReturnCustodies.length === Math.min(returnableCustodies.length, MAX_CUSTODY_RETURN_BATCH);

  const switchDepositMode = (mode: 'amount' | 'custody') => {
    setDepositMode(mode);
    setAdjustmentError('');
  };

  const toggleReturnCustody = (custodyId: string) => {
    setAdjustmentError('');
    if (selectedCustodyIds.includes(custodyId)) {
      setSelectedCustodyIds(prev => prev.filter(id => id !== custodyId));
      return;
    }
    if (selectedReturnCustodies.length >= MAX_CUSTODY_RETURN_BATCH) {
      setAdjustmentError(`يمكن استرداد ${MAX_CUSTODY_RETURN_BATCH} عهدة كحد أقصى في العملية الواحدة.`);
      return;
    }
    setSelectedCustodyIds(prev => (prev.includes(custodyId) ? prev : [...prev, custodyId]));
  };

  const toggleSelectAllReturnCustodies = () => {
    setAdjustmentError('');
    setSelectedCustodyIds(
      allReturnableSelected ? [] : returnableCustodies.slice(0, MAX_CUSTODY_RETURN_BATCH).map(c => c.id)
    );
  };

  const handleReturnCustodies = async () => {
    if (!adjustmentAccount) return;
    const ids = selectedReturnCustodies.map(c => c.id);
    if (ids.length === 0) {
      setAdjustmentError('يرجى تحديد عهدة واحدة على الأقل لاسترداد المتبقي منها.');
      return;
    }
    if (ids.length > MAX_CUSTODY_RETURN_BATCH) {
      setAdjustmentError(`يمكن استرداد ${MAX_CUSTODY_RETURN_BATCH} عهدة كحد أقصى في العملية الواحدة.`);
      return;
    }
    const account = adjustmentAccount;

    await custodyReturnGuard.run(async (idempotencyKey) => {
      try {
        setAdjustmentError('');
        const res = await returnCustodyRemainders(ids, account.id, custodyReturnNotes.trim(), { idempotencyKey });
        custodyReturnGuard.rotateKey();
        setIsAdjustmentModalOpen(false);
        showNotice(
          res.returnedCount > 0
            ? `تم استرداد المتبقي من ${res.returnedCount} عهدة بإجمالي ${res.totalReturned.toLocaleString('en-US')} ${currencyOf(account.currency)} وإيداعه في "${account.name}".` +
              (res.skippedCount > 0 ? ` (تم تخطي ${res.skippedCount} عهدة لم يعد بها متبقٍ أو سبق ردها.)` : '')
            : 'تم تنفيذ عملية الاسترداد هذه مسبقاً ولم تتكرر.'
        );
      } catch (err) {
        console.error(err);
        setAdjustmentError(errorText(err, 'حدث خطأ أثناء استرداد متبقي العهد.'));
      }
    });
  };

  const handleSaveAdjustment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adjustmentTargetAccount) return;
    if (isCustodyReturnMode) {
      await handleReturnCustodies();
      return;
    }
    const amountNum = adjustmentAmountNum;
    if (!amountNum || amountNum <= 0) {
      setAdjustmentError('يرجى إدخال مبلغ صحيح أكبر من الصفر.');
      return;
    }
    const account = adjustmentAccount || adjustmentTargetAccount;
    if (account.active === false) {
      setAdjustmentError(`الحساب "${account.name}" معطل؛ أعد تفعيله أولاً أو اختر حساباً آخر.`);
      return;
    }
    if (adjustmentType === 'out' && amountNum > adjustmentAvailable) {
      setAdjustmentError(insufficientWithdrawMessage(account));
      return;
    }
    const type = adjustmentType;

    await adjustmentGuard.run(async (idempotencyKey) => {
      try {
        setAdjustmentError('');
        await recordManualAccountAdjustment(
          account.id,
          type,
          amountNum,
          adjustmentReason.trim(),
          { idempotencyKey }
        );
        adjustmentGuard.rotateKey();
        setIsAdjustmentModalOpen(false);
        showNotice(
          type === 'in'
            ? `تم إيداع ${fmtMoney(amountNum)} ${currencyOf(account.currency)} في "${account.name}" بنجاح.`
            : `تم سحب ${fmtMoney(amountNum)} ${currencyOf(account.currency)} من "${account.name}" بنجاح.`
        );
      } catch (err) {
        console.error(err);
        setAdjustmentError(errorText(err, 'حدث خطأ أثناء حفظ الحركة المالية.'));
      }
    });
  };

  // Handlers for Transfer (account -> account)
  const transferableAccounts = useMemo(
    () => targetAccounts.filter(a => a.active !== false && (selectedOrgFilter === 'all' || a.orgId === selectedOrgFilter)),
    [targetAccounts, selectedOrgFilter]
  );
  const transferFrom = transferFromId ? targetAccounts.find(a => a.id === transferFromId) || null : null;

  // Valid destinations mirror the domain's refusals: another active account of the same
  // company and currency that does not hold the same funds (a bank and its own InstaPay
  // channel, or two InstaPay channels of one bank, are one balance).
  const transferDestinations = useMemo(() => {
    if (!transferFrom) return [];
    const fromCurrency = currencyOf(transferFrom.currency);
    const fromHolder = fundsHolderIdOf(transferFrom);
    return targetAccounts.filter(a =>
      a.id !== transferFrom.id &&
      a.active !== false &&
      a.orgId === transferFrom.orgId &&
      currencyOf(a.currency) === fromCurrency &&
      fundsHolderIdOf(a) !== fromHolder
    );
  }, [targetAccounts, transferFrom, fundsHolderIdOf]);
  const transferTo = transferToId ? transferDestinations.find(a => a.id === transferToId) || null : null;

  // No overdraft on transfers: the source — and the bank behind an InstaPay source — must cover it.
  const transferFromParent = linkedParentOf(transferFrom);
  const transferToParent = linkedParentOf(transferTo);
  const transferFromBalance = transferFrom ? balanceOf(transferFrom) : 0;
  const transferAvailable = transferFromParent
    ? Math.min(transferFromBalance, balanceOf(transferFromParent))
    : transferFromBalance;
  const transferAmountNum = toMoney(parseFloat(transferAmount) || 0);
  const transferExceedsBalance = transferAmountNum > 0 && transferAmountNum > transferAvailable;
  const canSubmitTransfer = Boolean(transferFrom && transferTo && transferAmountNum > 0 && !transferExceedsBalance);

  const handleOpenTransfer = (from?: PaymentAccount) => {
    const source = from && from.active !== false ? from : transferableAccounts.find(a => balanceOf(a) > 0) || transferableAccounts[0];
    setTransferFromId(source?.id || '');
    setTransferToId('');
    setTransferAmount('');
    setTransferDescription('');
    setTransferError('');
    transferGuard.rotateKey();
    setNotice(null);
    setIsTransferModalOpen(true);
  };

  const transferOptionLabel = (acc: PaymentAccount) => {
    // Across companies ("all" view of the platform owner) the company code tells same-named accounts apart
    const org = isSuperAdmin && selectedOrgFilter === 'all' ? orgList.find(o => o.id === acc.orgId) : undefined;
    return `${acc.name} (${accountTypeShort(acc.type)})${org ? ` [${org.code}]` : ''} — الرصيد: ${fmtMoney(balanceOf(acc))} ${currencyOf(acc.currency)}`;
  };

  const handleChangeTransferFrom = (fromId: string) => {
    setTransferFromId(fromId);
    setTransferToId('');
    setTransferAmount('');
    setTransferError('');
  };

  const handleSaveTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!transferFrom || !transferTo) {
      setTransferError('يرجى اختيار الحساب المحوَّل منه والحساب المحوَّل إليه.');
      return;
    }
    if (transferAmountNum <= 0) {
      setTransferError('يرجى إدخال مبلغ تحويل صحيح أكبر من الصفر.');
      return;
    }
    if (transferExceedsBalance) {
      setTransferError(`المبلغ أكبر من الرصيد المتاح للتحويل (${transferAvailable.toLocaleString('en-US')} ${currencyOf(transferFrom.currency)}).`);
      return;
    }
    const from = transferFrom;
    const to = transferTo;

    await transferGuard.run(async (idempotencyKey) => {
      try {
        setTransferError('');
        const res = await transferBetweenAccounts(from.id, to.id, transferAmountNum, transferDescription.trim(), { idempotencyKey });
        transferGuard.rotateKey();
        setIsTransferModalOpen(false);
        // Describe the transfer the server actually stored: a retry with the same key after the
        // form was edited returns the original transfer (money never moves twice).
        const summary = `${res.amount.toLocaleString('en-US')} ${currencyOf(from.currency)} من "${res.fromAccountName || from.name}" إلى "${res.toAccountName || to.name}"`;
        const number = res.transferNumber ? ` برقم ${res.transferNumber}` : '';
        showNotice(
          res.changed
            ? `تم تحويل ${summary} بنجاح${number}.`
            : `تم تنفيذ هذا التحويل مسبقاً${number} (${summary}) ولم يتكرر.`
        );
      } catch (err) {
        console.error(err);
        setTransferError(errorText(err, 'حدث خطأ أثناء تنفيذ التحويل.'));
      }
    });
  };

  // Handlers for detaching a legacy linked wallet (فصل المحفظة عن البنك)
  const legacyLinkedWallets = useMemo(() => filteredAccounts.filter(a => isLegacyLinkedWallet(a)), [filteredAccounts]);
  const detachWallet = detachWalletId ? targetAccounts.find(a => a.id === detachWalletId) || null : null;
  const detachBank = linkedParentOf(detachWallet);
  const detachTotals = {
    totalIn: toMoney(Number(detachWallet?.totalIn || 0)),
    totalOut: toMoney(Number(detachWallet?.totalOut || 0)),
  };
  // While linked, every amount into the wallet was also added to the bank and every amount out
  // was also taken from it (the opening balance never was); reversing that is totalOut - totalIn.
  const detachSuggested = toMoney(detachTotals.totalOut - detachTotals.totalIn);
  const detachCustomNum = toMoney(parseFloat(detachAmount) || 0);
  const detachCorrection =
    detachMode === 'suggested' ? detachSuggested
    : detachMode === 'custom' ? (detachDirection === 'in' ? detachCustomNum : -detachCustomNum)
    : 0;

  const handleOpenDetach = (wallet: PaymentAccount) => {
    setDetachWalletId(wallet.id);
    setDetachMode('suggested');
    setDetachDirection('in');
    setDetachAmount('');
    setDetachNote('');
    setDetachError('');
    detachGuard.rotateKey();
    setNotice(null);
  };

  const handleSaveDetach = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!detachWallet) return;
    if (detachMode === 'custom' && detachCustomNum <= 0) {
      setDetachError('يرجى إدخال مبلغ التصحيح، أو اختيار الفصل بدون تعديل رصيد البنك.');
      return;
    }
    if (detachCorrection !== 0 && !detachBank) {
      setDetachError('الحساب البنكي المرتبط غير موجود؛ اختر الفصل بدون تعديل رصيد البنك.');
      return;
    }
    const wallet = detachWallet;
    const bankName = detachBank?.name || wallet.parentAccountName || 'الحساب البنكي';
    const correction = detachCorrection;
    await detachGuard.run(async (idempotencyKey) => {
      try {
        setDetachError('');
        const res = await detachLegacyWallet(wallet.id, correction, detachTotals, detachNote.trim(), { idempotencyKey });
        detachGuard.rotateKey();
        setDetachWalletId('');
        showNotice(
          !res.changed
            ? `المحفظة "${wallet.name}" مفصولة بالفعل عن البنك.`
            : correction === 0
            ? `تم فصل المحفظة "${wallet.name}" عن "${bankName}" بدون تعديل رصيد البنك؛ أصبحت خزينة مستقلة.`
            : `تم فصل المحفظة "${wallet.name}" عن "${bankName}" وتصحيح رصيد البنك بمبلغ ${correction > 0 ? '+' : '-'}${Math.abs(correction).toLocaleString('en-US')} ${currencyOf(wallet.currency)}؛ أصبحت خزينة مستقلة.`
        );
      } catch (err) {
        console.error(err);
        setDetachError(errorText(err, 'حدث خطأ أثناء فصل المحفظة عن البنك.'));
      }
    });
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
        return '💵 خزينة كاش (Petty Cash)';
      default:
        return '🗂️ حساب آخر';
    }
  };

  // Treasury data is readable only by the money roles (firestore.rules); anyone else would see
  // empty lists that look like "no accounts yet", and every button would end in a refusal.
  if (!canViewTreasury) {
    return (
      <div className="bg-white rounded-3xl border border-slate-200 p-12 text-center shadow-xs">
        <div className="h-16 w-16 rounded-2xl bg-slate-100 text-slate-500 flex items-center justify-center mx-auto mb-3">
          <Lock className="h-8 w-8" />
        </div>
        <h3 className="font-bold text-slate-800 text-sm">الخزائن وحسابات الدفع متاحة للمسؤول المالي ومدير الشركة فقط</h3>
        <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
          حسابك لا يملك صلاحية الاطلاع على الأرصدة أو تنفيذ حركات مالية. تواصل مع مدير الشركة إذا كنت تحتاج هذه الصلاحية.
        </p>
      </div>
    );
  }

  // Where the header's quick deposit starts: the first active account of the current view
  const firstActiveAccount = filteredAccounts.find(a => a.active !== false) || orgScopedAccounts.find(a => a.active !== false);

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

        {/* Action Buttons */}
        <div className="flex items-center gap-2 flex-wrap">
          {canMoveMoney && firstActiveAccount && (
            <button
              type="button"
              onClick={() => handleOpenAdjustment(firstActiveAccount, 'in')}
              className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white rounded-xl font-bold text-xs shadow-md transition cursor-pointer"
            >
              <ArrowDownLeft className="h-4 w-4" />
              <span>⚡ إيداع وتغذية رصيد خزينة / بنك (+ IN)</span>
            </button>
          )}

          {canMoveMoney && (
            <button
              type="button"
              onClick={() => handleOpenTransfer()}
              className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold text-xs shadow-md transition cursor-pointer"
              title="تحويل مبلغ من خزينة / حساب إلى خزينة / حساب آخر"
            >
              <ArrowLeftRight className="h-4 w-4" />
              <span>🔁 تحويل بين الحسابات (Transfer)</span>
            </button>
          )}

          <button
            type="button"
            onClick={exportLedgerToExcel}
            className="flex items-center gap-2 px-3.5 py-2.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200/80 rounded-xl font-bold text-xs shadow-2xs transition cursor-pointer"
            title="تصدير كشف حركة الخزائن والحسابات إلى ملف Excel"
          >
            <FileSpreadsheet className="h-4 w-4 text-indigo-600" />
            <span>تصدير كشف الحسابات (Excel)</span>
          </button>

          {canCreateAccounts && (
            <button
              type="button"
              onClick={handleOpenAddAccount}
              className="flex items-center gap-2 px-3.5 py-2.5 bg-slate-800 hover:bg-slate-900 text-white rounded-xl font-bold text-xs shadow-2xs transition cursor-pointer"
            >
              <Plus className="h-4 w-4" />
              <span>إضافة خزينة / حساب</span>
            </button>
          )}
        </div>
      </div>

      {/* Error of a card action (delete / deactivate) */}
      {actionError && (
        <div role="alert" className="flex items-start justify-between gap-3 bg-rose-50 border border-rose-200 text-rose-800 p-3.5 rounded-2xl text-xs font-bold shadow-2xs">
          <div className="flex items-start gap-2">
            <Info className="h-4 w-4 text-rose-600 shrink-0 mt-0.5" />
            <span className="leading-relaxed">{actionError}</span>
          </div>
          <button
            type="button"
            onClick={() => setActionError(null)}
            className="text-rose-500 hover:text-rose-800 p-1 hover:bg-rose-100 rounded-lg transition cursor-pointer shrink-0"
            title="إخفاء"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Success notice (deposit / withdrawal / transfer / custody return / account changes) */}
      {notice && (
        <div className="flex items-start justify-between gap-3 bg-emerald-50 border border-emerald-200 text-emerald-900 p-3.5 rounded-2xl text-xs font-bold shadow-2xs">
          <div className="flex items-start gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
            <span className="leading-relaxed">{notice}</span>
          </div>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="text-emerald-500 hover:text-emerald-800 p-1 hover:bg-emerald-100 rounded-lg transition cursor-pointer shrink-0"
            title="إخفاء"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Legacy wallets still mirrored on a bank: ask the admin to detach them once */}
      {canDetachWallets && legacyLinkedWallets.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 text-amber-900 p-3.5 rounded-2xl text-xs shadow-2xs space-y-2">
          <div className="flex items-start gap-2">
            <Info className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
            <span className="leading-relaxed">
              <span className="font-black">المحفظة الإلكترونية أصبحت خزينة مستقلة لا تنعكس حركاتها على البنك.</span>{' '}
              {legacyLinkedWallets.length === 1 ? 'توجد محفظة' : `توجد ${legacyLinkedWallets.length} محافظ`} من الإعداد القديم ما زالت مربوطة بحساب بنكي.
              افصلها مرة واحدة لتصبح مستقلة، مع تصحيح أثر حركاتها السابقة على رصيد البنك.
            </span>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {legacyLinkedWallets.map(w => (
              <button
                key={w.id}
                type="button"
                onClick={() => handleOpenDetach(w)}
                className="flex items-center gap-1 px-2.5 py-1 bg-white hover:bg-amber-100 border border-amber-300 text-amber-900 rounded-lg text-[11px] font-bold transition cursor-pointer"
              >
                <Unlink className="h-3 w-3" />
                <span>فصل: {w.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Financial Overview Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Total Available Balance */}
        <div className="bg-gradient-to-br from-emerald-600 to-teal-700 text-white p-5 rounded-3xl shadow-sm relative overflow-hidden">
          <div className="relative z-10">
            <span className="text-emerald-100 text-xs font-bold block mb-1">الرصيد الكلي المتوفر (Total Balance)</span>
            <div className="text-2xl sm:text-3xl font-black tracking-tight">
              {fmtMoney(stats.primary.balance)} <span className="text-xs font-normal opacity-80">{stats.primary.currency}</span>
            </div>
            {stats.otherCurrencies.map(row => (
              <div key={row.currency} className="text-sm font-black text-emerald-50/95 mt-0.5">
                + {fmtMoney(row.balance)} <span className="text-[10px] font-normal opacity-80">{row.currency}</span>
              </div>
            ))}
            <div className="text-[11px] text-emerald-100/90 mt-2 flex items-center justify-between gap-1 flex-wrap">
              <span>
                عبر {stats.primaryCount} أوعية مالية رئيسية
                {stats.linkedCount > 0 && ` (+ ${stats.linkedCount} قنوات دفع تابعة)`}
              </span>
              {stats.linkedCount > 0 && (
                <span 
                  className="inline-flex items-center gap-1 bg-emerald-800/60 backdrop-blur-xs px-2 py-0.5 rounded-full text-[10px] text-emerald-200 border border-emerald-400/30"
                  title="تم استبعاد قنوات الإنستاباي المربوطة بحساب بنكي تلقائياً لمنع ازدواجية احتساب الرصيد (المحافظ الإلكترونية خزائن مستقلة وتُحتسب برصيدها)"
                >
                  بدون تكرار مزدوج ✓
                </span>
              )}
            </div>
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
            +{fmtMoney(stats.primary.totalIn)} <span className="text-xs font-bold text-slate-400">{stats.primary.currency}</span>
          </div>
          {stats.otherCurrencies.map(row => (
            <div key={row.currency} className="text-sm font-black text-emerald-700/90 mt-0.5">
              +{fmtMoney(row.totalIn)} <span className="text-[10px] font-bold text-slate-400">{row.currency}</span>
            </div>
          ))}
          <span className="text-[11px] text-slate-400 mt-1 block">توريدات وإيداعات ومردودات عُهد (بدون التحويلات الداخلية بين الحسابات)</span>
          {transferLegs.error && (
            <span className="text-[10px] text-amber-700 font-bold mt-1 block">تعذر تحميل التحويلات الداخلية: قد يشمل الإجمالي مبالغ محولة بين الحسابات.</span>
          )}
        </div>

        {/* Total OUT */}
        <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-xs relative overflow-hidden">
          <div className="flex items-center justify-between mb-2">
            <span className="text-slate-500 text-xs font-bold">إجمالي المنصرف (Total OUT)</span>
            <span className="p-1.5 bg-rose-50 text-rose-600 rounded-xl">
              <TrendingDown className="h-4 w-4" />
            </span>
          </div>
          <div className="text-2xl font-black text-rose-700">
            -{fmtMoney(stats.primary.totalOut)} <span className="text-xs font-bold text-slate-400">{stats.primary.currency}</span>
          </div>
          {stats.otherCurrencies.map(row => (
            <div key={row.currency} className="text-sm font-black text-rose-700/90 mt-0.5">
              -{fmtMoney(row.totalOut)} <span className="text-[10px] font-bold text-slate-400">{row.currency}</span>
            </div>
          ))}
          <span className="text-[11px] text-slate-400 mt-1 block">طلبات صرف، عُهد، ومسحوبات فعلية (بدون التحويلات الداخلية بين الحسابات)</span>
          {transferLegs.error && (
            <span className="text-[10px] text-amber-700 font-bold mt-1 block">تعذر تحميل التحويلات الداخلية: قد يشمل الإجمالي مبالغ محولة بين الحسابات.</span>
          )}
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
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                title="مسح البحث"
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
          {filteredAccounts.length === 0 && searchNeedle && orgScopedAccounts.length > 0 ? (
            // The search matched nothing (accounts DO exist): never the "add your first account" state
            <div className="bg-white rounded-3xl border border-slate-200 p-12 text-center shadow-xs">
              <div className="h-16 w-16 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center mx-auto mb-3">
                <Search className="h-8 w-8" />
              </div>
              <h3 className="font-bold text-slate-800 text-sm">لا نتائج مطابقة لـ «{searchQuery.trim()}»</h3>
              <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
                لا يوجد حساب يطابق هذا البحث بالاسم أو الرقم / المعرف أو البنك أو النوع ({orgScopedAccounts.length} حساب مسجل).
              </p>
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="mt-4 px-4 py-2 bg-slate-800 text-white rounded-xl font-bold text-xs hover:bg-slate-900 transition cursor-pointer"
              >
                مسح البحث وعرض كل الحسابات
              </button>
            </div>
          ) : filteredAccounts.length === 0 ? (
            <div className="bg-white rounded-3xl border border-slate-200 p-12 text-center shadow-xs">
              <div className="h-16 w-16 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto mb-3">
                <Wallet className="h-8 w-8" />
              </div>
              <h3 className="font-bold text-slate-800 text-sm">لا توجد حسابات أو خزائن مسجلة بعد</h3>
              <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
                {canCreateAccounts
                  ? 'ابدأ بإضافة حساب إنستاباي، محفظة إلكترونية، حساب بنكي، أو خزينة كاش لتتمكن من ضبط حركات الصرف والتوريد.'
                  : 'إضافة الحسابات والخزائن متاحة لمدير الشركة؛ تواصل معه لإنشاء أول حساب.'}
              </p>
              {canCreateAccounts && (
                <button
                  type="button"
                  onClick={handleOpenAddAccount}
                  className="mt-4 px-4 py-2 bg-emerald-600 text-white rounded-xl font-bold text-xs hover:bg-emerald-700 transition cursor-pointer"
                >
                  + إضافة الحساب الأول الآن
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredAccounts.map(acc => {
                const curBal = balanceOf(acc);
                const accOrg = orgList.find(o => o.id === acc.orgId);
                const cardParent = linkedParentOf(acc);
                const isInactive = acc.active === false;
                const hasHistory = accountHasHistory(acc);
                const isDeleting = accountActions.isPending(`delete:${acc.id}`);
                const isToggling = accountActions.isPending(`toggle:${acc.id}`);

                return (
                  <div
                    key={acc.id}
                    className={`bg-white rounded-3xl border p-5 shadow-xs hover:shadow-md transition flex flex-col justify-between group ${
                      isInactive ? 'border-slate-300 bg-slate-50/60' : 'border-slate-200/90'
                    } ${isDeleting ? 'opacity-60 pointer-events-none' : ''}`}
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
                            {isInactive && (
                              <span className="inline-flex items-center gap-1 mt-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-200 text-slate-700">
                                <PowerOff className="h-3 w-3" />
                                معطل — لا يُستخدم في عمليات جديدة
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Edit / Delete or Deactivate (an account with a balance or history is never deleted) */}
                        <div className="flex items-center gap-1 opacity-80 group-hover:opacity-100 transition">
                          {canEditAccounts && (
                            <button
                              type="button"
                              onClick={() => handleOpenEditAccount(acc)}
                              className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition cursor-pointer"
                              title="تعديل بيانات الحساب"
                            >
                              <Edit3 className="h-3.5 w-3.5" />
                            </button>
                          )}
                          {canDeleteAccounts && isInactive && (
                            <button
                              type="button"
                              onClick={() => handleToggleAccountActive(acc, true)}
                              disabled={isToggling}
                              className="p-1.5 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition cursor-pointer disabled:opacity-50 disabled:cursor-wait"
                              title={isToggling ? 'جاري إعادة التفعيل...' : 'إعادة تفعيل الحساب'}
                            >
                              <Power className={`h-3.5 w-3.5 ${isToggling ? 'animate-pulse' : ''}`} />
                            </button>
                          )}
                          {canDeleteAccounts && !isInactive && hasHistory && (
                            <button
                              type="button"
                              onClick={() => handleToggleAccountActive(acc, false)}
                              disabled={isToggling}
                              className="p-1.5 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition cursor-pointer disabled:opacity-50 disabled:cursor-wait"
                              title={isToggling ? 'جاري التعطيل...' : 'تعطيل الحساب (له رصيد أو حركات مسجلة فلا يمكن حذفه)'}
                            >
                              <PowerOff className={`h-3.5 w-3.5 ${isToggling ? 'animate-pulse' : ''}`} />
                            </button>
                          )}
                          {canDeleteAccounts && !hasHistory && (
                            <button
                              type="button"
                              onClick={() => handleDeleteAccount(acc)}
                              disabled={isDeleting}
                              className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition cursor-pointer disabled:opacity-50 disabled:cursor-wait"
                              title={isDeleting ? 'جاري الحذف...' : 'حذف الحساب (بدون رصيد أو حركات)'}
                            >
                              <Trash2 className={`h-3.5 w-3.5 ${isDeleting ? 'animate-pulse' : ''}`} />
                            </button>
                          )}
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
                        {acc.type === 'instapay' && cardParent && (
                          <div className="flex items-center justify-between text-[10.5px] pt-1.5 border-t border-blue-100 bg-blue-50/70 -mx-3 px-3 py-1.5 rounded-b-xl">
                            <span className="text-blue-700 flex items-center gap-1 font-bold">
                              <Landmark className="h-3 w-3 text-blue-600 shrink-0" />
                              خصم/إيداع مزدوج بـ:
                            </span>
                            <div className="text-left">
                              <span className="font-black text-blue-950 truncate max-w-[140px] block" title={cardParent.name || acc.parentAccountName}>
                                {cardParent.name || acc.parentAccountName}
                              </span>
                              <span className="text-[9.5px] text-blue-600/80 block">
                                (قناة تابعة - لا تكرر بالرصيد الكلي)
                              </span>
                            </div>
                          </div>
                        )}
                        {acc.type === 'instapay' && !cardParent && (
                          <div className="flex items-center gap-1 text-[10.5px] pt-1.5 border-t border-amber-100 bg-amber-50/70 -mx-3 px-3 py-1.5 rounded-b-xl text-amber-800 font-bold">
                            <Info className="h-3 w-3 text-amber-600 shrink-0" />
                            <span>غير مربوط بحساب بنكي — يُعامل كرصيد مستقل</span>
                          </div>
                        )}
                        {acc.type === 'wallet' && cardParent && (
                          <div className="text-[10.5px] pt-1.5 border-t border-amber-200 bg-amber-50/80 -mx-3 px-3 py-1.5 rounded-b-xl text-amber-900 space-y-1.5">
                            <div className="flex items-start gap-1.5">
                              <Landmark className="h-3 w-3 text-amber-600 shrink-0 mt-0.5" />
                              <span className="leading-relaxed">
                                <span className="font-black">ما زالت مربوطة بـ ({cardParent.name})</span> من الإعداد القديم؛ حركاتها تنعكس على البنك حتى تُفصل.
                              </span>
                            </div>
                            {canDetachWallets && (
                              <button
                                type="button"
                                onClick={() => handleOpenDetach(acc)}
                                className="w-full flex items-center justify-center gap-1.5 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-[11px] font-bold transition cursor-pointer"
                              >
                                <Unlink className="h-3 w-3" />
                                <span>فصل المحفظة عن البنك (خزينة مستقلة)</span>
                              </button>
                            )}
                          </div>
                        )}
                        {acc.type === 'wallet' && !cardParent && (
                          <div className="flex items-start gap-1.5 text-[10.5px] pt-1.5 border-t border-purple-100 bg-purple-50/70 -mx-3 px-3 py-1.5 rounded-b-xl text-purple-800">
                            <CreditCard className="h-3 w-3 text-purple-600 shrink-0 mt-0.5" />
                            <span className="leading-relaxed">
                              <span className="font-black">خزينة مستقلة</span> غير مرتبطة بأي حساب بنكي؛ حركاتها لا تنعكس على البنك، وتستقبل تحويلات من بنك أو محفظة أو إنستاباي.
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Current Balance Display */}
                      <div className="p-3.5 bg-emerald-50/50 rounded-2xl border border-emerald-100 mb-4">
                        <span className="text-[10px] font-bold text-emerald-700 block mb-0.5">الرصيد المتاح الحالي (Balance)</span>
                        <div className={`text-xl font-black ${curBal < 0 ? 'text-rose-700' : 'text-emerald-950'}`}>
                          {fmtMoney(curBal)} <span className="text-xs font-semibold text-emerald-700">{currencyOf(acc.currency)}</span>
                        </div>
                        <div className="flex items-center justify-between text-[10px] text-slate-500 mt-2 pt-2 border-t border-emerald-100/70">
                          <span className="text-emerald-700 font-bold">الوارد (+): {fmtMoney(acc.totalIn || 0)}</span>
                          <span className="text-rose-700 font-bold">المنصرف (-): {fmtMoney(acc.totalOut || 0)}</span>
                        </div>
                      </div>
                    </div>

                    {/* Bottom Actions */}
                    <div className="space-y-2 pt-2 border-t border-slate-100">
                      {canMoveMoney && (
                        <div className="grid grid-cols-2 gap-2">
                          {/* Quick IN */}
                          <button
                            type="button"
                            onClick={() => handleOpenAdjustment(acc, 'in')}
                            disabled={isInactive}
                            className="flex items-center justify-center gap-1.5 py-2 px-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-2xs transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                            title={isInactive ? 'الحساب معطل؛ أعد تفعيله أولاً' : 'إيداع مبلغ أو استرداد متبقي عهد في هذا الحساب'}
                          >
                            <ArrowDownLeft className="h-3.5 w-3.5" />
                            <span>إيداع (+ IN)</span>
                          </button>

                          {/* Quick OUT */}
                          <button
                            type="button"
                            onClick={() => handleOpenAdjustment(acc, 'out')}
                            disabled={isInactive}
                            className="flex items-center justify-center gap-1.5 py-2 px-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold shadow-2xs transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                            title={isInactive ? 'الحساب معطل؛ أعد تفعيله أولاً' : 'سحب مبلغ من رصيد هذا الحساب'}
                          >
                            <ArrowUpRight className="h-3.5 w-3.5 text-rose-400" />
                            <span>سحب (- OUT)</span>
                          </button>
                        </div>
                      )}

                      {/* Transfer from this account */}
                      {canMoveMoney && (
                        <button
                          type="button"
                          onClick={() => handleOpenTransfer(acc)}
                          disabled={acc.active === false}
                          className="w-full flex items-center justify-center gap-1.5 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-xl text-xs font-bold border border-indigo-200/80 transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                          title={acc.active === false ? 'الحساب معطل ولا يمكن التحويل منه' : 'تحويل مبلغ من هذا الحساب إلى حساب آخر'}
                        >
                          <ArrowLeftRight className="h-3.5 w-3.5" />
                          <span>تحويل</span>
                        </button>
                      )}

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
                        <span>
                          عرض كشف وحركات الحساب
                          {ledgerCountByAccount.has(acc.id) ? ` (${ledgerCountByAccount.get(acc.id)})` : ''}
                        </span>
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
                disabled={exportGuard.pending || ledger.loading}
                className="flex items-center gap-1.5 px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-xs transition cursor-pointer active:scale-95 disabled:opacity-60 disabled:cursor-wait"
                title="تصدير كشف الحركات المفلترة (كاملاً، بما فيها الصفحات الأقدم) إلى ملف إكسل CSV"
              >
                <Download className="h-3.5 w-3.5" />
                <span>{exportGuard.pending ? 'جارٍ تجهيز الملف...' : 'تصدير كشف الحساب إلى Excel (CSV)'}</span>
              </button>
            </div>
          </div>

          {searchNeedle && ledger.hasMore && (
            <p className="px-5 py-2 bg-amber-50 border-b border-amber-100 text-[11px] font-semibold text-amber-800">
              البحث يشمل الحركات المحمّلة فقط. استخدم «تحميل المزيد» أسفل الجدول للبحث في الحركات الأقدم.
            </p>
          )}
          {filteredTransactions.length === 0 ? (
            <div className="p-12 text-center text-slate-400 text-xs space-y-3">
              {ledger.loading ? (
                <p>جارٍ تحميل الحركات...</p>
              ) : searchNeedle ? (
                <>
                  <p className="font-bold text-slate-600">لا نتائج مطابقة لـ «{searchQuery.trim()}» في دفتر الحركات.</p>
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="px-3.5 py-1.5 bg-slate-800 text-white rounded-xl font-bold hover:bg-slate-900 transition cursor-pointer"
                  >
                    مسح البحث
                  </button>
                </>
              ) : inspectingAccount ? (
                <p>لا توجد حركات مسجلة على هذا الحساب بعد.</p>
              ) : (
                <p>لا توجد حركات مالية مسجلة بعد. عند تنفيذ وصرف أي طلب أو إجراء إيداع/سحب ستظهر هنا فوراً.</p>
              )}
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
                    const refLabel = referenceTypeLabel(tx.referenceType);

                    return (
                      <tr key={tx.id} className="hover:bg-slate-50/70 transition">
                        <td className="p-3.5 text-slate-400 font-mono whitespace-nowrap text-[11px]" dir="ltr">
                          {localDateTime(tx.createdAt)}
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
                          {refLabel && (
                            <span className={`block mt-1 text-[10px] font-bold ${
                              tx.referenceType === 'transfer'
                                ? 'text-indigo-700'
                                : tx.referenceType === 'custody_return'
                                ? 'text-amber-700'
                                : 'text-slate-400'
                            }`}>
                              {refLabel}
                            </span>
                          )}
                        </td>
                        <td className={`p-3.5 font-black whitespace-nowrap ${isTxIn ? 'text-emerald-700' : 'text-rose-700'}`}>
                          {isTxIn ? '+' : '-'}{fmtMoney(tx.amount)}
                        </td>
                        <td className="p-3.5 text-slate-400 font-mono whitespace-nowrap">
                          {fmtMoney(tx.balanceBefore)}
                        </td>
                        <td className="p-3.5 font-bold text-slate-800 font-mono whitespace-nowrap">
                          {fmtMoney(tx.balanceAfter)}
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
          <HistoryPagerFooter history={ledger} shown={ledger.items.length} noun="الحركات" />
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
                    {orgList.filter(o => !isArchivedOrg(o) || o.id === editingAccount?.orgId).map(o => (
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

              {/* E-wallet: a standalone treasury, never linked to a bank account */}
              {accType === 'wallet' && editingAccount && isLegacyLinkedWallet(editingAccount) && (
                <div className="bg-amber-50/80 border border-amber-200/90 rounded-2xl p-3.5 flex items-start gap-2">
                  <Landmark className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                  <p className="text-[11px] text-amber-900 leading-relaxed">
                    <span className="font-black">هذه المحفظة ما زالت مربوطة بحساب بنكي من الإعداد القديم</span> وحركاتها تنعكس عليه. الحفظ هنا لا يغيّر الربط؛ استخدم زر «فصل المحفظة عن البنك» في بطاقتها لتصبح خزينة مستقلة مع تصحيح رصيد البنك.
                  </p>
                </div>
              )}
              {accType === 'wallet' && !(editingAccount && isLegacyLinkedWallet(editingAccount)) && (
                <div className="bg-purple-50/80 border border-purple-200/90 rounded-2xl p-3.5 flex items-start gap-2">
                  <CreditCard className="h-4 w-4 text-purple-600 shrink-0 mt-0.5" />
                  <p className="text-[11px] text-purple-900 leading-relaxed">
                    <span className="font-black">المحفظة الإلكترونية خزينة مستقلة بذاتها</span> وغير مرتبطة بأي حساب بنكي: أي إيداع أو سحب عليها لا ينعكس على الحساب البنكي. يمكن تغذيتها بالتحويل إليها من بنك أو محفظة أخرى أو إنستاباي عبر زر (تحويل).
                  </p>
                </div>
              )}

              {/* Linked Parent Bank Account for InstaPay only (Dual Deduction) */}
              {accType === 'instapay' && (
                <div className="bg-blue-50/80 border border-blue-200/90 rounded-2xl p-3.5 space-y-2">
                  <div className="flex items-center gap-2">
                    <Landmark className="h-4 w-4 text-blue-600 shrink-0" />
                    <label className="block font-bold text-blue-950 text-xs">
                      الحساب البنكي الرئيسي المرتبط به (للخصم والإيداع المزدوج التلقائي)
                    </label>
                  </div>
                  <p className="text-[11px] text-blue-800 leading-relaxed">
                    💡 حساب الإنستاباي قناة دفع على حساب بنكي رئيسي. عند اختيار الحساب البنكي، سيتم تلقائياً خصم أو إيداع نفس المبلغ في البنك مع كل حركة صرف أو توريد.
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
                          🏦 {bank.name} ({bank.accountIdentifier}) — الرصيد: {Number(bank.currentBalance ?? bank.balance ?? 0).toLocaleString('en-US')} {bank.currency}
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
                  disabled={isSavingAccount}
                  className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold shadow-md transition cursor-pointer active:scale-98"
                >
                  {isSavingAccount ? 'جاري الحفظ...' : (editingAccount ? 'حفظ التعديلات' : 'إنشاء وتفعيل الحساب')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =========================================================================
          MODAL 2: MANUAL ADJUSTMENT (IN / OUT) + CUSTODY RECOVERY
          ========================================================================= */}
      {isAdjustmentModalOpen && adjustmentAccount && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto overscroll-contain">
          <div className={`bg-white rounded-3xl w-full shadow-2xl border border-slate-100 animate-in fade-in zoom-in-95 duration-150 my-auto flex flex-col max-h-[90vh] overflow-hidden ${
            isCustodyReturnMode ? 'max-w-lg' : 'max-w-md'
          }`}>
            <div className="flex items-center justify-between p-5 pb-3.5 border-b border-slate-100 shrink-0 bg-white rounded-t-3xl">
              <div className="flex items-center gap-2">
                <div className={`h-8 w-8 rounded-lg flex items-center justify-center font-bold ${
                  adjustmentType === 'in' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'
                }`}>
                  {isCustodyReturnMode
                    ? <Briefcase className="h-4 w-4" />
                    : adjustmentType === 'in' ? <ArrowDownLeft className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-sm">
                    {isCustodyReturnMode
                      ? 'استرداد العهد وإيداعها بالخزينة (+ IN)'
                      : adjustmentType === 'in' ? 'إيداع وتغذية رصيد (+ IN)' : 'سحب وتسوية رصيد (- OUT)'}
                  </h3>
                  <span className="text-[11px] text-slate-400 block">{adjustmentAccount.name}</span>
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
                {/* Deposit kind: a plain amount, or the cash employees still hold of their custodies */}
                {adjustmentType === 'in' && (
                  <div className="grid grid-cols-2 gap-1 bg-slate-100 p-1 rounded-xl">
                    <button
                      type="button"
                      onClick={() => switchDepositMode('amount')}
                      className={`flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                        !isCustodyReturnMode ? 'bg-white text-emerald-800 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      <ArrowDownLeft className="h-3.5 w-3.5" />
                      <span>إيداع مبلغ</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => switchDepositMode('custody')}
                      className={`flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                        isCustodyReturnMode ? 'bg-white text-emerald-800 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      <Briefcase className="h-3.5 w-3.5" />
                      <span>استرداد العهد</span>
                    </button>
                  </div>
                )}

                {/* Account Selector */}
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    {isCustodyReturnMode ? 'الحساب أو الخزينة التي سيُودع فيها المتبقي من العهد *' : 'الحساب أو الخزينة المستهدفة بالعملية *'}
                  </label>
                  <select
                    value={adjustmentAccount.id}
                    onChange={(e) => {
                      const found = targetAccounts.find(a => a.id === e.target.value);
                      if (found) {
                        setAdjustmentTargetAccount(found);
                        // The custody list depends on the account's company & currency
                        setSelectedCustodyIds([]);
                        setAdjustmentError('');
                      }
                    }}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-900 text-xs"
                  >
                    {targetAccounts.filter(a => a.active !== false || a.id === adjustmentAccount.id).map(acc => (
                      <option key={acc.id} value={acc.id}>
                        {transferOptionLabel(acc)}{acc.bankName ? ` — ${acc.bankName}` : ''}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Current balance reminder (+ what a withdrawal may take: the bank behind an InstaPay limits it too) */}
                <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500 font-medium">الرصيد الحالي للحساب:</span>
                    <span className="font-bold text-slate-900 font-mono text-sm">
                      {fmtMoney(balanceOf(adjustmentAccount))} {currencyOf(adjustmentAccount.currency)}
                    </span>
                  </div>
                  {adjustmentType === 'out' && (
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500 font-medium">المتاح للسحب:</span>
                      <span className={`font-bold font-mono text-sm ${adjustmentAvailable > 0 ? 'text-slate-900' : 'text-rose-700'}`}>
                        {fmtMoney(adjustmentAvailable)} {currencyOf(adjustmentAccount.currency)}
                      </span>
                    </div>
                  )}
                  {adjustmentType === 'out' && adjustmentParent && (
                    <p className="text-[10.5px] text-blue-700 font-semibold leading-relaxed">
                      {adjustmentAccount.type === 'wallet' ? 'محفظة ما زالت مربوطة بالحساب البنكي' : 'قناة إنستاباي على الحساب البنكي'} ({adjustmentParent.name}) — رصيد البنك: {fmtMoney(balanceOf(adjustmentParent))}؛ يُخصم المبلغ من الاثنين معاً.
                    </p>
                  )}
                </div>

                {isCustodyReturnMode ? (
                  <>
                    {/* Custodies with cash still held by employees */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <label className="block font-bold text-slate-700">
                          الموظفون الذين لديهم متبقٍ من العهد ({returnableCustodies.length})
                        </label>
                        {returnableCustodies.length > 0 && (
                          <button
                            type="button"
                            onClick={toggleSelectAllReturnCustodies}
                            className="text-[11px] font-bold text-emerald-700 hover:text-emerald-900 hover:underline cursor-pointer"
                          >
                            {allReturnableSelected ? 'إلغاء تحديد الكل' : 'تحديد الكل'}
                          </button>
                        )}
                      </div>

                      {returnableCustodies.length === 0 ? (
                        <div className="p-6 text-center text-slate-400 bg-slate-50 rounded-xl border border-dashed border-slate-200 leading-relaxed">
                          <Briefcase className="h-6 w-6 mx-auto mb-2 text-slate-300" />
                          لا توجد عهد بها متبقٍ لدى الموظفين في شركة هذا الحساب وبنفس عملته ({currencyOf(adjustmentAccount.currency)}).
                        </div>
                      ) : (
                        <div className="max-h-64 overflow-y-auto overscroll-contain border border-slate-200 rounded-xl divide-y divide-slate-100">
                          {returnableCustodies.map(c => {
                            const checked = selectedCustodyIds.includes(c.id);
                            return (
                              <label
                                key={c.id}
                                className={`flex items-center gap-3 p-2.5 cursor-pointer transition ${
                                  checked ? 'bg-emerald-50/80' : 'hover:bg-slate-50'
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => toggleReturnCustody(c.id)}
                                  className="h-4 w-4 accent-emerald-600 cursor-pointer shrink-0"
                                />
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-1.5 min-w-0">
                                    <span className="font-bold text-slate-900 truncate">{c.employeeName}</span>
                                    <span className="font-mono text-[10px] text-slate-500 shrink-0">({c.custodyNumber})</span>
                                  </div>
                                  <span className="text-[10.5px] text-slate-400 block truncate">
                                    مسحوبة من: {c.sourceAccountName || 'غير محدد'}
                                    {c.sourceAccountId === adjustmentAccount.id ? ' (نفس الحساب)' : ''}
                                  </span>
                                </div>
                                <span className="font-black text-emerald-700 font-mono whitespace-nowrap">
                                  {toMoney(c.remainingAmount).toLocaleString('en-US')}
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      )}
                      {returnableCustodies.length > MAX_CUSTODY_RETURN_BATCH && (
                        <p className="text-[11px] text-amber-700 font-semibold">
                          يمكن استرداد {MAX_CUSTODY_RETURN_BATCH} عهدة كحد أقصى في العملية الواحدة؛ نفّذ الباقي في عملية أخرى.
                        </p>
                      )}
                    </div>

                    {/* Live total + balance preview */}
                    {selectedReturnCustodies.length > 0 && (
                      <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="text-emerald-800 font-semibold">العهد المحددة:</span>
                          <span className="font-bold text-emerald-950">{selectedReturnCustodies.length}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-emerald-800 font-semibold">إجمالي المبلغ المسترد:</span>
                          <span className="font-black text-emerald-950 font-mono text-sm">
                            +{selectedReturnTotal.toLocaleString('en-US')} {currencyOf(adjustmentAccount.currency)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between pt-1.5 border-t border-emerald-200/70">
                          <span className="text-emerald-800 font-semibold">رصيد الحساب بعد الاسترداد:</span>
                          <span className="font-bold text-emerald-950 font-mono">
                            {toMoney(balanceOf(adjustmentAccount) + selectedReturnTotal).toLocaleString('en-US')} {currencyOf(adjustmentAccount.currency)}
                          </span>
                        </div>
                        {linkedParentOf(adjustmentAccount) && (
                          <p className="text-[10.5px] text-blue-700 font-semibold">
                            سيُضاف نفس الإجمالي تلقائياً إلى الحساب البنكي المرتبط ({linkedParentOf(adjustmentAccount)?.name}).
                          </p>
                        )}
                      </div>
                    )}

                    {/* Optional notes */}
                    <div className="space-y-1.5">
                      <label className="block font-bold text-slate-700">ملاحظات (اختياري)</label>
                      <textarea
                        rows={2}
                        value={custodyReturnNotes}
                        onChange={(e) => setCustodyReturnNotes(e.target.value)}
                        placeholder="مثال: تسوية نهاية الشهر، استلام النقدية من المندوبين..."
                        className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                      />
                      <p className="text-[10.5px] text-slate-400 leading-relaxed">
                        يُودَع متبقي كل عهدة محددة في هذا الحساب، وتُغلق العهدة (المتبقي = صفر) مع قيد مستقل لكل عهدة في دفتر الحركات.
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    {/* Amount */}
                    <div className="space-y-1.5">
                      <label className="block font-bold text-slate-700">
                        المبلغ المراد {adjustmentType === 'in' ? 'إيداعه' : 'سحبه'} ({currencyOf(adjustmentAccount.currency)}) *
                      </label>
                      <input
                        type="text"
                        required
                        inputMode="decimal"
                        value={adjustmentAmount}
                        onKeyDown={handleNumericKeyDown}
                        onChange={(e) => {
                          setAdjustmentAmount(sanitizeAmount(e.target.value));
                          setAdjustmentError('');
                        }}
                        placeholder="0.00"
                        className={`w-full p-2.5 bg-slate-50 border rounded-xl font-bold font-mono text-base ${
                          withdrawExceedsBalance
                            ? 'border-rose-400 focus:border-rose-500 text-rose-800'
                            : adjustmentType === 'in' ? 'focus:border-emerald-500 text-emerald-800' : 'focus:border-rose-500 text-rose-800'
                        }`}
                      />
                      {withdrawExceedsBalance && (
                        <p className="text-[11px] text-rose-700 font-bold leading-relaxed">
                          {insufficientWithdrawMessage(adjustmentAccount)}
                        </p>
                      )}
                      {/* Quick Amount Chips */}
                      <div className="flex items-center gap-1.5 flex-wrap pt-1">
                        <span className="text-[11px] text-slate-500 font-semibold">مبالغ سريعة:</span>
                        {[500, 1000, 5000, 10000, 50000].map(amt => (
                          <button
                            key={amt}
                            type="button"
                            onClick={() => {
                              const current = parseFloat(adjustmentAmount) || 0;
                              setAdjustmentAmount(String(current + amt));
                              setAdjustmentError('');
                            }}
                            className="px-2 py-0.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200/80 rounded-lg text-[11px] font-bold transition cursor-pointer"
                          >
                            +{amt.toLocaleString('en-US')}
                          </button>
                        ))}
                        {adjustmentAmount && (
                          <button
                            type="button"
                            onClick={() => setAdjustmentAmount('')}
                            className="px-2 py-0.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg text-[10px] font-medium transition cursor-pointer"
                          >
                            مسح
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Reason / Notes */}
                    <div className="space-y-1.5">
                      <label className="block font-bold text-slate-700">بيان وسبب الحركة *</label>
                      <textarea
                        required
                        rows={2}
                        value={adjustmentReason}
                        onChange={(e) => setAdjustmentReason(e.target.value)}
                        placeholder={
                          adjustmentType === 'in'
                            ? 'مثال: توريد نقدي، استلام مبيعات يومية، إيداع بنكي...'
                            : 'مثال: تسليم عهدة كاش، سحب نثريات غير مجدولة، مصاريف بنكية...'
                        }
                        className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                      />
                      {/* Quick Reason Chips */}
                      {adjustmentType === 'in' ? (
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-[11px] text-slate-500 font-semibold">أسباب شائعة:</span>
                          {[
                            'تغذية رصيد عهدة تشغيل',
                            'إيداع مبيعات نقدية',
                            'تحويل من حساب بنكي',
                            'تمويل رأس مال تشغيلي',
                            CUSTODY_RETURN_REASON
                          ].map(reason => (
                            <button
                              key={reason}
                              type="button"
                              // Taking custody cash back is a real custody operation (closes the custodies), not a free-text deposit
                              onClick={() => (reason === CUSTODY_RETURN_REASON ? switchDepositMode('custody') : setAdjustmentReason(reason))}
                              className={`px-2 py-0.5 rounded-lg text-[11px] font-medium transition cursor-pointer ${
                                reason === CUSTODY_RETURN_REASON
                                  ? 'bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200/80 inline-flex items-center gap-1'
                                  : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                              }`}
                            >
                              {reason === CUSTODY_RETURN_REASON && <Briefcase className="h-3 w-3" />}
                              {reason}
                            </button>
                          ))}
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-[11px] text-slate-500 font-semibold">أسباب شائعة:</span>
                          {[
                            'صرف عهدة نقدية لمندوب',
                            'مصروفات نقدية طارئة',
                            'تحويل إلى حساب فرعي',
                            'رسوم ومصاريف بنكية'
                          ].map(reason => (
                            <button
                              key={reason}
                              type="button"
                              onClick={() => setAdjustmentReason(reason)}
                              className="px-2 py-0.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-[11px] font-medium transition cursor-pointer"
                            >
                              {reason}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                )}

                {adjustmentError && (
                  <div className="bg-rose-50 border border-rose-200 text-rose-700 p-2.5 rounded-xl font-bold leading-relaxed">
                    {adjustmentError}
                  </div>
                )}
              </div>

              <div className="flex items-center justify-end gap-2.5 p-4 sm:px-6 border-t border-slate-100 shrink-0 bg-slate-50/90 rounded-b-3xl">
                <button
                  type="button"
                  onClick={() => setIsAdjustmentModalOpen(false)}
                  className="px-4 py-2 text-slate-600 hover:bg-slate-200/60 rounded-xl font-bold transition cursor-pointer"
                >
                  إلغاء
                </button>
                {isCustodyReturnMode ? (
                  <button
                    type="submit"
                    disabled={isAdjusting || selectedReturnCustodies.length === 0}
                    className="px-5 py-2.5 text-white rounded-xl font-bold shadow-md transition cursor-pointer active:scale-98 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isAdjusting
                      ? 'جاري الاسترداد...'
                      : `تأكيد استرداد (${selectedReturnCustodies.length}) عهد بإجمالي ${selectedReturnTotal.toLocaleString('en-US')} ${currencyOf(adjustmentAccount.currency)}`}
                  </button>
                ) : (
                  <button
                    type="submit"
                    disabled={isAdjusting || !adjustmentAmount || withdrawExceedsBalance}
                    className={`px-5 py-2.5 text-white rounded-xl font-bold shadow-md transition cursor-pointer active:scale-98 disabled:opacity-50 disabled:cursor-not-allowed ${
                      adjustmentType === 'in'
                        ? 'bg-emerald-600 hover:bg-emerald-700'
                        : 'bg-rose-600 hover:bg-rose-700'
                    }`}
                  >
                    {isAdjusting ? 'جاري الحفظ...' : (adjustmentType === 'in' ? 'تأكيد الإيداع (+)' : 'تأكيد السحب (-)')}
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =========================================================================
          MODAL 3: TRANSFER BETWEEN ACCOUNTS (ترانسفير)
          ========================================================================= */}
      {isTransferModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto overscroll-contain">
          <div className="bg-white rounded-3xl max-w-md w-full shadow-2xl border border-slate-100 animate-in fade-in zoom-in-95 duration-150 my-auto flex flex-col max-h-[90vh] overflow-hidden">
            <div className="flex items-center justify-between p-5 pb-3.5 border-b border-slate-100 shrink-0 bg-white rounded-t-3xl">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-lg bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold">
                  <ArrowLeftRight className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-sm">تحويل بين الحسابات والخزائن (Transfer)</h3>
                  <span className="text-[11px] text-slate-400 block">نقل رصيد من خزينة / حساب إلى آخر داخل نفس الشركة</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsTransferModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1.5 hover:bg-slate-100 rounded-xl transition cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSaveTransfer} className="flex flex-col flex-1 overflow-hidden min-h-0">
              <div className="p-5 overflow-y-auto flex-1 space-y-3.5 text-xs overscroll-contain">
                {transferableAccounts.length < 2 && (
                  <div className="bg-amber-50 border border-amber-200 text-amber-800 p-3 rounded-xl font-semibold leading-relaxed">
                    يلزم وجود حسابين نشطين على الأقل في نفس الشركة لإجراء تحويل بينهما.
                  </div>
                )}

                {/* From */}
                <div>
                  <label className="block font-bold text-slate-700 mb-1">من حساب / خزينة (المحوَّل منه) *</label>
                  <select
                    value={transferFromId}
                    onChange={(e) => handleChangeTransferFrom(e.target.value)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-900 text-xs"
                  >
                    <option value="" disabled>-- اختر الحساب المحوَّل منه --</option>
                    {transferableAccounts.map(acc => (
                      <option key={acc.id} value={acc.id}>{transferOptionLabel(acc)}</option>
                    ))}
                  </select>
                  {transferFrom && (
                    <div className="mt-1.5 bg-slate-50 p-2.5 rounded-xl border border-slate-100 space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-slate-500 font-medium">الرصيد المتاح للتحويل:</span>
                        <span className={`font-bold font-mono text-sm ${transferAvailable > 0 ? 'text-slate-900' : 'text-rose-700'}`}>
                          {transferAvailable.toLocaleString('en-US')} {currencyOf(transferFrom.currency)}
                        </span>
                      </div>
                      {transferFromParent && (
                        <p className="text-[10.5px] text-blue-700 font-semibold leading-relaxed">
                          {transferFrom.type === 'wallet' ? 'محفظة ما زالت مربوطة بالحساب البنكي' : 'قناة إنستاباي على الحساب البنكي'} ({transferFromParent.name}) — رصيد البنك: {balanceOf(transferFromParent).toLocaleString('en-US')}؛ يُخصم المبلغ من الاثنين معاً.
                        </p>
                      )}
                    </div>
                  )}
                </div>

                {/* To */}
                <div>
                  <label className="block font-bold text-slate-700 mb-1">إلى حساب / خزينة (المحوَّل إليه) *</label>
                  <select
                    value={transferToId}
                    onChange={(e) => {
                      setTransferToId(e.target.value);
                      setTransferError('');
                    }}
                    disabled={!transferFrom || transferDestinations.length === 0}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-900 text-xs disabled:opacity-60"
                  >
                    <option value="">-- اختر الحساب المحوَّل إليه --</option>
                    {transferDestinations.map(acc => (
                      <option key={acc.id} value={acc.id}>{transferOptionLabel(acc)}</option>
                    ))}
                  </select>
                  {transferFrom && transferDestinations.length === 0 ? (
                    <p className="text-[10.5px] text-amber-700 font-semibold mt-1 leading-relaxed">
                      لا يوجد حساب آخر نشط في نفس الشركة وبنفس العملة ({currencyOf(transferFrom.currency)}) يمكن التحويل إليه.
                    </p>
                  ) : (
                    <p className="text-[10.5px] text-slate-400 mt-1 leading-relaxed">
                      تظهر حسابات نفس الشركة والعملة فقط، ولا يظهر الحساب البنكي مع قناة الإنستاباي (أو المحفظة غير المفصولة) المربوطة به (هما نفس الرصيد).
                    </p>
                  )}
                </div>

                {/* Amount */}
                <div className="space-y-1.5">
                  <label className="block font-bold text-slate-700">
                    مبلغ التحويل{transferFrom ? ` (${currencyOf(transferFrom.currency)})` : ''} *
                  </label>
                  <input
                    type="text"
                    required
                    inputMode="decimal"
                    value={transferAmount}
                    onKeyDown={(e) => handleNumericKeyDown(e, true)}
                    onChange={(e) => {
                      setTransferAmount(sanitizeAmount(e.target.value));
                      setTransferError('');
                    }}
                    placeholder="0.00"
                    className={`w-full p-2.5 bg-slate-50 border rounded-xl font-bold font-mono text-base text-indigo-900 ${
                      transferExceedsBalance ? 'border-rose-400 focus:border-rose-500' : 'border-slate-200 focus:border-indigo-500'
                    }`}
                  />
                  <div className="flex items-center gap-1.5 flex-wrap pt-1">
                    <button
                      type="button"
                      disabled={!transferFrom || transferAvailable <= 0}
                      onClick={() => {
                        setTransferAmount(String(toMoney(transferAvailable)));
                        setTransferError('');
                      }}
                      className="px-2 py-0.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-800 border border-indigo-200/80 rounded-lg text-[11px] font-bold transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      كامل الرصيد
                    </button>
                    {transferAmount && (
                      <button
                        type="button"
                        onClick={() => setTransferAmount('')}
                        className="px-2 py-0.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg text-[10px] font-medium transition cursor-pointer"
                      >
                        مسح
                      </button>
                    )}
                  </div>
                  {transferExceedsBalance && transferFrom && (
                    <p className="text-[11px] text-rose-700 font-bold">
                      المبلغ أكبر من الرصيد المتاح للتحويل ({transferAvailable.toLocaleString('en-US')} {currencyOf(transferFrom.currency)}).
                    </p>
                  )}
                </div>

                {/* Description */}
                <div className="space-y-1.5">
                  <label className="block font-bold text-slate-700">البيان (اختياري)</label>
                  <input
                    type="text"
                    value={transferDescription}
                    onChange={(e) => setTransferDescription(e.target.value)}
                    placeholder="مثال: تغذية المحفظة من البنك، تجميع السيولة في الخزينة الرئيسية..."
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                  />
                </div>

                {/* Preview of both balances after the transfer */}
                {transferFrom && transferTo && transferAmountNum > 0 && !transferExceedsBalance && (
                  <div className="bg-indigo-50/70 border border-indigo-200 rounded-xl p-3 space-y-2">
                    <span className="block font-bold text-indigo-900">معاينة الأرصدة بعد التحويل:</span>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-600 truncate">{transferFrom.name}</span>
                      <span className="font-mono font-bold whitespace-nowrap">
                        <span className="text-slate-400">{transferFromBalance.toLocaleString('en-US')}</span>
                        <span className="text-slate-400 mx-1">←</span>
                        <span className="text-rose-700">{toMoney(transferFromBalance - transferAmountNum).toLocaleString('en-US')}</span>
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-600 truncate">{transferTo.name}</span>
                      <span className="font-mono font-bold whitespace-nowrap">
                        <span className="text-slate-400">{balanceOf(transferTo).toLocaleString('en-US')}</span>
                        <span className="text-slate-400 mx-1">←</span>
                        <span className="text-emerald-700">{toMoney(balanceOf(transferTo) + transferAmountNum).toLocaleString('en-US')}</span>
                      </span>
                    </div>
                    {(transferFromParent || transferToParent) && (
                      <div className="pt-1.5 border-t border-indigo-200/70 space-y-0.5 text-[10.5px] text-blue-700 font-semibold">
                        {transferFromParent && <p>سيُخصم نفس المبلغ تلقائياً من الحساب البنكي المرتبط ({transferFromParent.name}).</p>}
                        {transferToParent && <p>سيُضاف نفس المبلغ تلقائياً إلى الحساب البنكي المرتبط ({transferToParent.name}).</p>}
                      </div>
                    )}
                  </div>
                )}

                {transferError && (
                  <div className="bg-rose-50 border border-rose-200 text-rose-700 p-2.5 rounded-xl font-bold leading-relaxed">
                    {transferError}
                  </div>
                )}
              </div>

              <div className="flex items-center justify-end gap-2.5 p-4 sm:px-6 border-t border-slate-100 shrink-0 bg-slate-50/90 rounded-b-3xl">
                <button
                  type="button"
                  onClick={() => setIsTransferModalOpen(false)}
                  className="px-4 py-2 text-slate-600 hover:bg-slate-200/60 rounded-xl font-bold transition cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={isTransferring || !canSubmitTransfer}
                  className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold shadow-md transition cursor-pointer active:scale-98 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isTransferring ? 'جاري التحويل...' : 'تأكيد التحويل'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =========================================================================
          MODAL 4: DETACH A LEGACY WALLET FROM ITS BANK (فصل المحفظة عن البنك)
          ========================================================================= */}
      {detachWallet && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto overscroll-contain">
          <div className="bg-white rounded-3xl max-w-md w-full shadow-2xl border border-slate-100 animate-in fade-in zoom-in-95 duration-150 my-auto flex flex-col max-h-[90vh] overflow-hidden">
            <div className="flex items-center justify-between p-5 pb-3.5 border-b border-slate-100 shrink-0 bg-white rounded-t-3xl">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center font-bold">
                  <Unlink className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-sm">فصل المحفظة عن البنك</h3>
                  <span className="text-[11px] text-slate-400 block">{detachWallet.name} — تصبح خزينة مستقلة لا تنعكس حركاتها على البنك</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDetachWalletId('')}
                className="text-slate-400 hover:text-slate-600 p-1.5 hover:bg-slate-100 rounded-xl transition cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSaveDetach} className="flex flex-col flex-1 overflow-hidden min-h-0">
              <div className="p-5 overflow-y-auto flex-1 space-y-3.5 text-xs overscroll-contain">
                <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">رصيد المحفظة (لا يتغير):</span>
                    <span className="font-mono font-bold text-slate-900">{balanceOf(detachWallet).toLocaleString('en-US')} {currencyOf(detachWallet.currency)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">الحساب البنكي المربوط:</span>
                    <span className="font-bold text-slate-900">{detachBank ? `${detachBank.name} — ${balanceOf(detachBank).toLocaleString('en-US')} ${currencyOf(detachBank.currency)}` : 'غير موجود'}</span>
                  </div>
                  <div className="flex items-center justify-between pt-1.5 border-t border-slate-200/70">
                    <span className="text-slate-500">دخل المحفظة أثناء الربط:</span>
                    <span className="font-mono font-bold text-emerald-700">+{detachTotals.totalIn.toLocaleString('en-US')}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">خرج من المحفظة أثناء الربط:</span>
                    <span className="font-mono font-bold text-rose-700">-{detachTotals.totalOut.toLocaleString('en-US')}</span>
                  </div>
                </div>

                <p className="text-slate-600 leading-relaxed">
                  طوال فترة الربط كان كل مبلغ يدخل المحفظة يُضاف للبنك أيضاً، وكل مبلغ يخرج منها يُخصم من البنك أيضاً.
                  لإلغاء هذا الأثر يُقترح{' '}
                  {detachSuggested === 0
                    ? <span className="font-bold">عدم تعديل رصيد البنك (الأثر الصافي صفر)</span>
                    : <span className="font-bold">{detachSuggested > 0 ? 'إضافة' : 'خصم'} {Math.abs(detachSuggested).toLocaleString('en-US')} {currencyOf(detachWallet.currency)} {detachSuggested > 0 ? 'إلى' : 'من'} رصيد البنك</span>}.
                  إن كنت صححت رصيد البنك يدوياً من قبل، اختر الفصل بدون تعديل.
                </p>

                <div className="space-y-1.5">
                  {([
                    ['suggested', detachSuggested === 0 ? 'الفصل (لا يلزم تعديل رصيد البنك)' : `تطبيق التصحيح المقترح (${detachSuggested > 0 ? '+' : '-'}${Math.abs(detachSuggested).toLocaleString('en-US')})`],
                    ['custom', 'تحديد مبلغ تصحيح آخر'],
                    ['none', 'الفصل فقط بدون تعديل رصيد البنك'],
                  ] as const).map(([mode, label]) => (
                    <label key={mode} className={`flex items-center gap-2 p-2.5 rounded-xl border cursor-pointer transition ${detachMode === mode ? 'border-amber-400 bg-amber-50' : 'border-slate-200 hover:bg-slate-50'}`}>
                      <input
                        type="radio"
                        name="detach-mode"
                        checked={detachMode === mode}
                        onChange={() => {
                          setDetachMode(mode);
                          setDetachError('');
                        }}
                        className="accent-amber-600"
                      />
                      <span className="font-bold text-slate-800">{label}</span>
                    </label>
                  ))}
                </div>

                {detachMode === 'custom' && (
                  <div className="grid grid-cols-2 gap-2">
                    <select
                      value={detachDirection}
                      onChange={(e) => setDetachDirection(e.target.value as TransactionType)}
                      className="p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-900 text-xs"
                    >
                      <option value="in">إضافة إلى البنك (+)</option>
                      <option value="out">خصم من البنك (-)</option>
                    </select>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={detachAmount}
                      onKeyDown={(e) => handleNumericKeyDown(e, true)}
                      onChange={(e) => {
                        setDetachAmount(sanitizeAmount(e.target.value));
                        setDetachError('');
                      }}
                      placeholder="0.00"
                      className="p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold font-mono text-sm"
                    />
                  </div>
                )}

                <div className="space-y-1.5">
                  <label className="block font-bold text-slate-700">ملاحظة (اختياري)</label>
                  <input
                    type="text"
                    value={detachNote}
                    onChange={(e) => setDetachNote(e.target.value)}
                    placeholder="مثال: مطابقة مع كشف حساب البنك"
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                  />
                </div>

                {detachBank && detachCorrection !== 0 && (
                  <div className="bg-amber-50/70 border border-amber-200 rounded-xl p-3 flex items-center justify-between gap-2">
                    <span className="font-bold text-amber-900 truncate">رصيد {detachBank.name} بعد التصحيح:</span>
                    <span className="font-mono font-bold whitespace-nowrap">
                      <span className="text-slate-400">{balanceOf(detachBank).toLocaleString('en-US')}</span>
                      <span className="text-slate-400 mx-1">←</span>
                      <span className={detachCorrection > 0 ? 'text-emerald-700' : 'text-rose-700'}>{toMoney(balanceOf(detachBank) + detachCorrection).toLocaleString('en-US')}</span>
                    </span>
                  </div>
                )}

                {detachError && (
                  <div className="bg-rose-50 border border-rose-200 text-rose-700 p-2.5 rounded-xl font-bold leading-relaxed">
                    {detachError}
                  </div>
                )}
              </div>

              <div className="flex items-center justify-end gap-2.5 p-4 sm:px-6 border-t border-slate-100 shrink-0 bg-slate-50/90 rounded-b-3xl">
                <button
                  type="button"
                  onClick={() => setDetachWalletId('')}
                  className="px-4 py-2 text-slate-600 hover:bg-slate-200/60 rounded-xl font-bold transition cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={detachGuard.pending}
                  className="px-5 py-2.5 bg-amber-600 hover:bg-amber-700 text-white rounded-xl font-bold shadow-md transition cursor-pointer active:scale-98 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {detachGuard.pending ? 'جاري الفصل...' : 'تأكيد فصل المحفظة'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};
