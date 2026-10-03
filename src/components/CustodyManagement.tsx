import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import {
  PettyCashCustody,
  PaymentAccount,
  isServiceMatchingOrg
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
  FileText, 
  RefreshCw, 
  X, 
  Eye, 
  UploadCloud,
  Image as ImageIcon,
  Undo2,
  Landmark,
  Loader2,
  Trash2
} from 'lucide-react';
import { 
  handleNumericKeyDown, 
  sanitizeAmount, 
  sanitizePhone 
} from '../utils/validation';
import { InvoiceViewerModal } from './InvoiceViewerModal';
import { useSubmitGuard } from '../hooks/useSubmitGuard';
import { useProgressiveList } from '../hooks/useProgressiveList';
import { ShowMoreButton } from './ListPaging';
import { useAttachmentPreview } from '../hooks/useAttachmentPreview';
import { formatFileSize } from '../utils/fileUpload';
import type { StoredAttachment } from '../lib/attachments';
import {
  ATTACHMENT_ACCEPT,
  ATTACHMENT_LIMIT_LABEL,
  UNSUPPORTED_ATTACHMENT_MESSAGE,
  acceptedAttachmentMime,
  discardStoredAttachment,
  storeRecordAttachment,
} from '../utils/recordAttachments';
import { newId } from '../utils/ids';
import { isArchivedOrg, toMoney } from '../domain/common';
import { can } from '../utils/permissions';
import { accountTypeLabel, formatLocalDate, spendableBalance } from '../utils/requestUi';

// Same rules as the domain (src/domain/treasury.ts): an empty currency counts as EGP.
const currencyOf = (c?: string | null) => ((c || '').trim() || 'EGP').toUpperCase();
const balanceOf = (a: PaymentAccount) => toMoney(a.currentBalance ?? a.balance ?? 0);
// Amounts always in Western digits, whatever the browser locale.
const fmtMoney = (n: unknown) => toMoney(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
const fmtMoney2 = (n: unknown) => toMoney(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const pad2 = (n: number) => String(n).padStart(2, '0');
/** Today in the viewer's local time (YYYY-MM-DD); toISOString() gave the UTC day. */
const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};

type CustodyTotals = { currency: string; issued: number; remaining: number; settled: number; returned: number };

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
    members,
    allMembers,
    activeOrgId,
    activeOrg,
    currentRole,
    issueCustody,
    settleCustodyItem,
    replenishCustody,
    returnCustodyRemainders,
    resolveParentBankAccount,
  } = useApp();

  const isSuperAdmin = currentRole === 'super_admin';
  // Issue / replenish / return a remainder: only the roles the domain and firestore.rules accept
  // (src/utils/permissions.ts). Everyone else sees only their own custodies and can settle them.
  const canIssueCustody = can(currentRole, 'issueCustody');
  const canViewAllCustodies = can(currentRole, 'viewAllCustodies');
  const orgList = isSuperAdmin ? (allOrganizations.length > 0 ? allOrganizations : organizations) : organizations;
  // A custody is issued only in a company that is still active (an archived one takes no new records).
  const creatableOrgs = orgList.filter(o => !isArchivedOrg(o));
  const targetCustodies = isSuperAdmin ? allCustodies : custodies;
  const targetSettlements = isSuperAdmin ? allCustodySettlements : custodySettlements;
  const targetAccounts = isSuperAdmin ? allPaymentAccounts : paymentAccounts;
  const targetMembers = isSuperAdmin ? allMembers : members;
  const targetServices = isSuperAdmin ? allServices : services;

  // Strict deduplication guarantee for Custodies (by ID & Custody Number)
  const cleanTargetCustodies = useMemo(() => {
    const seenIds = new Set<string>();
    const seenNumbers = new Set<string>();
    return targetCustodies.filter(c => {
      const numKey = (c.custodyNumber || '').trim().toUpperCase();
      if (seenIds.has(c.id) || (numKey && seenNumbers.has(numKey))) {
        return false;
      }
      seenIds.add(c.id);
      if (numKey) seenNumbers.add(numKey);
      return true;
    });
  }, [targetCustodies]);

  // Strict deduplication guarantee for Settlements (by ID & unique invoice/amount)
  const cleanTargetSettlements = useMemo(() => {
    const seenIds = new Set<string>();
    const seenKeys = new Set<string>();
    return targetSettlements.filter(s => {
      if (seenIds.has(s.id)) return false;
      const stKey = s.custodyId && s.amount && (s.invoiceNumber || s.invoiceDate)
        ? `${s.custodyId}:::${s.amount}:::${(s.invoiceNumber || '').trim().toUpperCase()}:::${s.invoiceDate || ''}`
        : '';
      if (stKey && seenKeys.has(stKey)) return false;
      seenIds.add(s.id);
      if (stKey) seenKeys.add(stKey);
      return true;
    });
  }, [targetSettlements]);

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
    cleanTargetCustodies.forEach(c => {
      if (c.employeeName) names.add(c.employeeName.trim());
    });
    cleanTargetSettlements.forEach(s => {
      if (s.employeeName) names.add(s.employeeName.trim());
    });
    return Array.from(names).sort();
  }, [cleanTargetCustodies, cleanTargetSettlements]);

  // Modals
  const [isIssueModalOpen, setIsIssueModalOpen] = useState(false);
  const [settlingCustody, setSettlingCustody] = useState<PettyCashCustody | null>(null);
  const [replenishingCustody, setReplenishingCustody] = useState<PettyCashCustody | null>(null);
  const [inspectingCustody, setInspectingCustody] = useState<PettyCashCustody | null>(null);
  const receiptPreview = useAttachmentPreview();

  // Issue Custody Form State
  const [issueOrgId, setIssueOrgId] = useState<string>('');
  const [issueEmployeeMode, setIssueEmployeeMode] = useState<'select' | 'custom'>('select');
  const [issueEmployeeId, setIssueEmployeeId] = useState('');
  const [issueEmployeeName, setIssueEmployeeName] = useState('');
  const [issueEmployeePhone, setIssueEmployeePhone] = useState('');
  const [issueAmount, setIssueAmount] = useState('');
  const [issueSourceAccountId, setIssueSourceAccountId] = useState('');
  const [issueNotes, setIssueNotes] = useState('');
  const issueGuard = useSubmitGuard();
  const isIssuing = issueGuard.pending;
  const [issueError, setIssueError] = useState<string | null>(null);

  // Settle Custody Form State
  const [settleAmount, setSettleAmount] = useState('');
  const [settleServiceCategoryId, setSettleServiceCategoryId] = useState('');
  const [settleVendorName, setSettleVendorName] = useState('');
  const [settleInvoiceNumber, setSettleInvoiceNumber] = useState('');
  const [settleInvoiceDate, setSettleInvoiceDate] = useState(localToday);
  const [settleDescription, setSettleDescription] = useState('');
  // The invoice's document: a link typed by the user, or the fsattach:// link of a file uploaded here
  const [settleReceiptUrl, setSettleReceiptUrl] = useState('');
  // The file uploaded in this form (stored in Firestore under the custody's company)
  const [settleReceiptFile, setSettleReceiptFile] = useState<StoredAttachment | null>(null);
  const [isUploadingReceipt, setIsUploadingReceipt] = useState(false);
  // Each upload gets a number; one that finishes after the form moved on is deleted instead of shown.
  const receiptUploadSeq = useRef(0);
  // The stored copy of the form's file while no saved invoice uses it yet.
  const unsavedReceiptRef = useRef('');
  const settleGuard = useSubmitGuard();
  const isSettling = settleGuard.pending;
  const [settleError, setSettleError] = useState<string | null>(null);
  const receiptFileInputRef = useRef<HTMLInputElement>(null);

  // Replenish Custody Form State
  const [replenishAmount, setReplenishAmount] = useState('');
  const [replenishSourceAccountId, setReplenishSourceAccountId] = useState('');
  const [replenishNotes, setReplenishNotes] = useState('');
  const replenishGuard = useSubmitGuard();
  const isReplenishing = replenishGuard.pending;
  const [replenishError, setReplenishError] = useState<string | null>(null);

  // Return Custody Remainder (إيداع المتبقي للحساب المسحوب منه) State. Only the id is kept:
  // the modal always shows the LIVE custody (an invoice settled meanwhile changes the remainder).
  const [returningCustodyId, setReturningCustodyId] = useState<string | null>(null);
  const [returnAltAccountId, setReturnAltAccountId] = useState('');
  const [returnNotes, setReturnNotes] = useState('');
  const returnGuard = useSubmitGuard();
  const isReturning = returnGuard.pending;
  const [returnError, setReturnError] = useState<string | null>(null);
  // Success feedback after every custody operation (issue, invoice, replenish, return)
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 10000);
    return () => clearTimeout(t);
  }, [notice]);

  // Filtered Custodies
  const filteredCustodies = useMemo(() => {
    return cleanTargetCustodies.filter(item => {
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
  }, [cleanTargetCustodies, selectedOrgFilter, employeeFilter, statusFilter, searchQuery]);

  // Filtered Settlements
  const filteredSettlements = useMemo(() => {
    return cleanTargetSettlements.filter(item => {
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
  }, [cleanTargetSettlements, selectedOrgFilter, employeeFilter, searchQuery]);

  // Custodies and settlements stay fully loaded (the KPIs below and the dashboard need all of
  // them); only their rendering is progressive: the first rows, then "عرض المزيد".
  const listFilterKey = JSON.stringify([selectedOrgFilter, employeeFilter, statusFilter, searchQuery]);
  const custodyRows = useProgressiveList(filteredCustodies, listFilterKey);
  const settlementRows = useProgressiveList(filteredSettlements, listFilterKey);

  // KPI Calculations, per currency (a custody takes the currency of the account it was paid
  // from, so amounts in different currencies are never added under one label).
  const { kpiTotals, activeCount } = useMemo(() => {
    const byCurrency = new Map<string, CustodyTotals>();
    let active = 0;

    filteredCustodies.forEach(c => {
      const cur = currencyOf(c.currency);
      const row = byCurrency.get(cur) || { currency: cur, issued: 0, remaining: 0, settled: 0, returned: 0 };
      row.issued += Number(c.totalAmount || 0);
      row.remaining += Number(c.remainingAmount || 0);
      row.settled += Number(c.settledAmount || 0);
      row.returned += Number(c.returnedAmount || 0);
      byCurrency.set(cur, row);
      if (c.status === 'active') {
        active += 1;
      }
    });

    // The company's own currency first, then the others alphabetically
    const mainCurrency = currencyOf(activeOrg?.currency);
    const totals = Array.from(byCurrency.values()).sort((a, b) =>
      a.currency === mainCurrency ? -1 : b.currency === mainCurrency ? 1 : a.currency.localeCompare(b.currency)
    );
    if (totals.length === 0) totals.push({ currency: mainCurrency, issued: 0, remaining: 0, settled: 0, returned: 0 });
    return { kpiTotals: totals, activeCount: active };
  }, [filteredCustodies, activeOrg?.currency]);
  const totalReturned = kpiTotals.reduce((sum, row) => sum + row.returned, 0);

  // What an account can pay out now: never below zero, and an InstaPay channel's bank must cover it too
  const availableOf = (acc: PaymentAccount) => spendableBalance(acc, resolveParentBankAccount(acc));
  const accountOptionLabel = (acc: PaymentAccount) =>
    `${acc.name} (${accountTypeLabel(acc.type)}) — المتاح: ${fmtMoney(availableOf(acc))} ${currencyOf(acc.currency)}`;
  const insufficientMessage = (acc: PaymentAccount, amount: number) => {
    const cur = currencyOf(acc.currency);
    const bank = resolveParentBankAccount(acc);
    const limitedByBank = bank && balanceOf(bank) < balanceOf(acc);
    return `رصيد الحساب "${acc.name}" غير كافٍ: المتاح ${fmtMoney(availableOf(acc))} ${cur}${
      limitedByBank ? ` (محدود برصيد الحساب البنكي المرتبط "${bank?.name}")` : ''
    } والمبلغ المطلوب ${fmtMoney(amount)} ${cur}. لا يُسمح بأن يصبح رصيد أي حساب بالسالب؛ قم بإيداع المبلغ في الحساب أولاً من صفحة الخزينة أو اختر حساباً آخر.`;
  };

  // A per-currency amount on a KPI card: the first currency big, any other one below it
  const renderKpiAmounts = (pick: (row: CustodyTotals) => number, mainClass: string, unitClass: string) => {
    const [first, ...others] = kpiTotals;
    return (
      <>
        <div className="mt-3 flex items-baseline gap-1.5">
          <span className={`text-2xl font-black tracking-tight ${mainClass}`}>{fmtMoney2(pick(first))}</span>
          <span className={`text-xs font-bold ${unitClass}`}>{first.currency}</span>
        </div>
        {others.map(row => (
          <div key={row.currency} className="flex items-baseline gap-1">
            <span className={`text-sm font-black ${mainClass}`}>+ {fmtMoney2(pick(row))}</span>
            <span className={`text-[10px] font-bold ${unitClass}`}>{row.currency}</span>
          </div>
        ))}
      </>
    );
  };

  // Handle open issue custody modal
  const handleOpenIssueModal = () => {
    const preferredOrg = selectedOrgFilter !== 'all' ? selectedOrgFilter : (activeOrgId && activeOrgId !== 'all' ? activeOrgId : creatableOrgs[0]?.id || '');
    // The super admin's picker lists active companies only: an archived default is left unselected.
    const defaultOrg = isSuperAdmin && !creatableOrgs.some(o => o.id === preferredOrg) ? '' : preferredOrg;
    setIssueOrgId(defaultOrg);
    setIssueEmployeeMode('select');
    setIssueEmployeeId('');
    setIssueEmployeeName('');
    setIssueEmployeePhone('');
    setIssueAmount('');
    setIssueSourceAccountId('');
    setIssueNotes('');
    setIssueError(null);
    issueGuard.rotateKey();
    setIsIssueModalOpen(true);
  };

  // Available employees for the selected org in issue modal
  const availableMembers = useMemo(() => {
    if (!issueOrgId) return targetMembers;
    return targetMembers.filter(m => m.orgId === issueOrgId && m.active !== false);
  }, [targetMembers, issueOrgId]);

  // Available treasury accounts for the selected org in issue modal
  const availableAccountsForIssue = useMemo(() => {
    if (!issueOrgId) return targetAccounts.filter(a => a.active !== false);
    return targetAccounts.filter(a => a.orgId === issueOrgId && a.active !== false);
  }, [targetAccounts, issueOrgId]);

  // No account may go below zero: the chosen source (and the bank behind an InstaPay channel) must cover the custody
  const issueAccount = issueSourceAccountId ? availableAccountsForIssue.find(a => a.id === issueSourceAccountId) || null : null;
  const issueAmountNum = toMoney(parseFloat(issueAmount) || 0);
  const issueExceedsBalance = Boolean(issueAccount) && issueAmountNum > 0 && issueAmountNum > availableOf(issueAccount!);

  // Handle submit issue custody
  const handleSubmitIssue = async (e: React.FormEvent) => {
    e.preventDefault();
    setIssueError(null);

    const amountNum = issueAmountNum;
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
    let finalEmpEmail: string | undefined = undefined;

    if (issueEmployeeMode === 'select') {
      const selectedMember = availableMembers.find(m => m.id === issueEmployeeId || m.userId === issueEmployeeId);
      if (!selectedMember) {
        setIssueError('يرجى اختيار الموظف المستلم للعهدة.');
        return;
      }
      finalEmpId = selectedMember.userId || selectedMember.id;
      finalEmpName = selectedMember.userName;
      finalEmpPhone = selectedMember.phone || '';
      finalEmpEmail = selectedMember.userEmail || undefined;
    } else {
      if (!finalEmpName) {
        setIssueError('يرجى كتابة اسم الموظف أو المندوب.');
        return;
      }
      const matchedMember = availableMembers.find(m =>
        m.userName.trim().toLowerCase() === finalEmpName.toLowerCase() ||
        (m.userEmail && finalEmpName.toLowerCase().includes(m.userEmail.toLowerCase()))
      );
      if (matchedMember) {
        finalEmpId = matchedMember.userId || matchedMember.id;
        finalEmpEmail = matchedMember.userEmail || undefined;
        if (!finalEmpPhone && matchedMember.phone) {
          finalEmpPhone = matchedMember.phone;
        }
      } else if (!finalEmpId) {
        finalEmpId = newId('emp');
      }
    }

    if (!issueSourceAccountId || !issueAccount) {
      setIssueError('يرجى اختيار حساب الخزينة أو المحفظة مصدر الصرف.');
      return;
    }
    if (issueExceedsBalance) {
      setIssueError(insufficientMessage(issueAccount, amountNum));
      return;
    }

    const account = issueAccount;
    await issueGuard.run(async (idempotencyKey) => {
      try {
        const res = await issueCustody(
          issueOrgId,
          finalEmpId,
          finalEmpName,
          finalEmpPhone || undefined,
          amountNum,
          account.id,
          issueNotes.trim() || undefined,
          { idempotencyKey, employeeEmail: finalEmpEmail }
        );

        if (!res || !res.success) {
          setIssueError(res?.message || 'حدث خطأ أثناء صرف العهدة.');
          return;
        }

        issueGuard.rotateKey();
        setIsIssueModalOpen(false);
        setNotice(
          `${res.message || 'تم صرف العهدة بنجاح'}: ${fmtMoney(amountNum)} ${currencyOf(account.currency)} للموظف "${finalEmpName}" من "${account.name}".`
        );
      } catch (err: any) {
        console.error(err);
        setIssueError(err?.message || 'حدث خطأ أثناء صرف العهدة.');
      }
    });
  };

  /**
   * Takes the uploaded file out of the settlement form. Its stored copy is deleted: no saved
   * invoice uses it (an upload still running is deleted as soon as it finishes).
   */
  const discardSettleReceipt = () => {
    receiptUploadSeq.current++;
    setIsUploadingReceipt(false);
    const unsavedUrl = unsavedReceiptRef.current;
    unsavedReceiptRef.current = '';
    setSettleReceiptFile(null);
    if (unsavedUrl) setSettleReceiptUrl(prev => (prev === unsavedUrl ? '' : prev));
    discardStoredAttachment(unsavedUrl);
  };

  // Leaving the page with an unsaved file in the settlement form deletes its stored copy.
  useEffect(() => {
    const uploads = receiptUploadSeq;
    const unsaved = unsavedReceiptRef;
    return () => {
      uploads.current++;
      discardStoredAttachment(unsaved.current);
      unsaved.current = '';
    };
  }, []);

  // Handle open settlement modal
  const handleOpenSettleModal = (custody: PettyCashCustody) => {
    // A file left from an earlier form that was never saved is deleted (not while that form's
    // invoice is still being saved: its outcome decides).
    if (!settleGuard.pending) discardSettleReceipt();
    setSettlingCustody(custody);
    setSettleAmount('');
    setSettleServiceCategoryId('');
    setSettleVendorName('');
    setSettleInvoiceNumber('');
    setSettleInvoiceDate(localToday());
    setSettleDescription('');
    setSettleReceiptUrl('');
    setSettleReceiptFile(null);
    setIsUploadingReceipt(false);
    receiptUploadSeq.current++;
    setSettleError(null);
    settleGuard.rotateKey();
  };

  // A saved invoice's document. An invoice keeps only the link, so a file kept in Firestore is
  // loaded first to know whether it is a PDF or an image; older data: / https links open as before.
  const openSettlementReceipt = (url?: string) => {
    if (url) void receiptPreview.open({ url, name: 'مستند_إيصال_العهدة' });
  };

  // Closing the settlement form without saving drops its uploaded file. While the invoice is
  // being saved the file stays: a saved invoice keeps it, otherwise the next form deletes it.
  const closeSettleModal = () => {
    if (!settleGuard.pending) discardSettleReceipt();
    setSettlingCustody(null);
  };

  // The invoice's document is stored (in Firestore, under the custody's company) as soon as it is
  // picked: PDF, PNG or JPG; images are compressed first; at most 10 MB. The invoice keeps its link.
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    const file = input.files?.[0];
    input.value = ''; // the same file can be picked again after removing it
    if (!file || !settlingCustody) return;

    if (!acceptedAttachmentMime(file)) {
      setSettleError(UNSUPPORTED_ATTACHMENT_MESSAGE);
      return;
    }

    // A new file replaces the one uploaded before (whose stored copy is deleted)
    discardSettleReceipt();
    const upload = ++receiptUploadSeq.current;
    setIsUploadingReceipt(true);
    setSettleError(null);
    try {
      const stored = await storeRecordAttachment(file, settlingCustody.orgId);
      if (upload !== receiptUploadSeq.current) {
        discardStoredAttachment(stored.url);
        return;
      }
      unsavedReceiptRef.current = stored.url;
      setSettleReceiptFile(stored);
      setSettleReceiptUrl(stored.url);
    } catch (err: any) {
      if (upload !== receiptUploadSeq.current) return;
      setSettleError(err?.message || 'تعذر رفع المستند، يرجى المحاولة مرة أخرى.');
    } finally {
      if (upload === receiptUploadSeq.current) setIsUploadingReceipt(false);
    }
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
        `تنبيه: قيمة الفاتورة (${fmtMoney(amountNum)}) أكبر من الرصيد المتبقي من العهدة (${fmtMoney(settlingCustody.remainingAmount)}). هل تريد المتابعة وتصفية كامل العهدة؟`
      );
      if (!confirmExceed) return;
    }

    if (!settleDescription.trim()) {
      setSettleError('يرجى كتابة بيان مختصر أو وصف للفاتورة والمصروف.');
      return;
    }

    if (isUploadingReceipt) {
      setSettleError('يرجى الانتظار حتى يكتمل رفع المستند.');
      return;
    }
    // A typed link must be a web address: a file is never kept inside the invoice record itself
    // (uploaded files are stored apart and the invoice keeps their link).
    const receiptUrl = settleReceiptUrl.trim();
    if (receiptUrl && !settleReceiptFile && !/^https?:\/\//i.test(receiptUrl)) {
      setSettleError('رابط المستند يجب أن يبدأ بـ https:// — أو استخدم زر «رفع صورة المستند» لإرفاق الملف.');
      return;
    }

    const custody = settlingCustody;
    await settleGuard.run(async (idempotencyKey) => {
      try {
        const res = await settleCustodyItem(
          custody.id,
          amountNum,
          settleDescription.trim(),
          settleServiceCategoryId || undefined,
          settleVendorName.trim() || undefined,
          settleInvoiceNumber.trim() || undefined,
          settleInvoiceDate || undefined,
          receiptUrl || undefined,
          { idempotencyKey }
        );

        if (!res || !res.success) {
          setSettleError(res?.message || 'حدث خطأ أثناء تسجيل فاتورة التصفية.');
          return;
        }

        // The saved invoice uses the stored file now: it is no longer deleted with the form.
        if (unsavedReceiptRef.current === receiptUrl) unsavedReceiptRef.current = '';
        setSettleReceiptFile(null);
        settleGuard.rotateKey();
        setSettlingCustody(null);
        setNotice(`تم تسجيل فاتورة تصفية بمبلغ ${fmtMoney(amountNum)} ${currencyOf(custody.currency)} على العهدة ${custody.custodyNumber}.`);
      } catch (err: any) {
        console.error(err);
        setSettleError(err?.message || 'حدث خطأ غير متوقع أثناء تسجيل التصفية.');
      }
    });
  };

  // Accounts a replenishment may come from: active accounts of the custody's company in the
  // custody's currency (the domain refuses another company's account).
  const replenishAccounts = useMemo(() => {
    if (!replenishingCustody) return [];
    const cur = currencyOf(replenishingCustody.currency);
    return targetAccounts.filter(a =>
      a.orgId === replenishingCustody.orgId && a.active !== false && currencyOf(a.currency) === cur
    );
  }, [targetAccounts, replenishingCustody]);
  const replenishAccount = replenishSourceAccountId ? replenishAccounts.find(a => a.id === replenishSourceAccountId) || null : null;
  const replenishAmountNum = toMoney(parseFloat(replenishAmount) || 0);
  const replenishExceedsBalance = Boolean(replenishAccount) && replenishAmountNum > 0 && replenishAmountNum > availableOf(replenishAccount!);

  // Handle open replenish modal
  const handleOpenReplenishModal = (custody: PettyCashCustody) => {
    setReplenishingCustody(custody);
    setReplenishAmount('');
    // The account the custody was paid from, when it can still pay (active, same company and currency)
    const source = targetAccounts.find(a => a.id === custody.sourceAccountId);
    const sourceUsable = Boolean(
      source && source.active !== false && source.orgId === custody.orgId && currencyOf(source.currency) === currencyOf(custody.currency)
    );
    setReplenishSourceAccountId(sourceUsable && source ? source.id : '');
    setReplenishNotes('');
    setReplenishError(null);
    replenishGuard.rotateKey();
  };

  // Submit replenish
  const handleSubmitReplenish = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!replenishingCustody) return;
    setReplenishError(null);

    const amountNum = replenishAmountNum;
    if (!amountNum || amountNum <= 0) {
      setReplenishError('يرجى إدخال مبلغ استعاضة صحيح.');
      return;
    }

    if (!replenishSourceAccountId || !replenishAccount) {
      setReplenishError('يرجى اختيار حساب الخزينة أو المصدر المالي للاستعاضة.');
      return;
    }
    if (replenishExceedsBalance) {
      setReplenishError(insufficientMessage(replenishAccount, amountNum));
      return;
    }

    const custody = replenishingCustody;
    const account = replenishAccount;
    await replenishGuard.run(async (idempotencyKey) => {
      try {
        const res = await replenishCustody(
          custody.id,
          amountNum,
          account.id,
          replenishNotes.trim() || undefined,
          { idempotencyKey }
        );

        if (!res || !res.success) {
          setReplenishError(res?.message || 'حدث خطأ أثناء استعاضة العهدة.');
          return;
        }

        replenishGuard.rotateKey();
        setReplenishingCustody(null);
        setNotice(
          `تمت استعاضة العهدة ${custody.custodyNumber} للموظف "${custody.employeeName}" بمبلغ ${fmtMoney(amountNum)} ${currencyOf(custody.currency)} من "${account.name}".`
        );
      } catch (err: any) {
        console.error(err);
        setReplenishError(err?.message || 'حدث خطأ غير متوقع أثناء استعاضة العهدة.');
      }
    });
  };

  // Every account the context exposes (the custody's source may sit outside the active-org scope).
  const accountPool = useMemo(() => {
    const byId = new Map<string, PaymentAccount>();
    [...targetAccounts, ...allPaymentAccounts].forEach(a => {
      if (a?.id && !byId.has(a.id)) byId.set(a.id, a);
    });
    return Array.from(byId.values());
  }, [targetAccounts, allPaymentAccounts]);

  const returningCustody = useMemo(
    () => (returningCustodyId ? targetCustodies.find(c => c.id === returningCustodyId) ?? null : null),
    [returningCustodyId, targetCustodies]
  );

  // Where the remainder goes: the account the custody was withdrawn from. When that account
  // is gone, disabled, of another company or currency (the domain would refuse it), the user
  // picks another active account of the SAME company and currency instead.
  const returnPlan = useMemo(() => {
    if (!returningCustody) return null;
    const custody = returningCustody;
    const currency = currencyOf(custody.currency);
    const amount = toMoney(Math.max(0, Number(custody.remainingAmount || 0)));
    const source = accountPool.find(a => a.id === custody.sourceAccountId) || null;
    const sourceIssue: string | null = !source
      ? `الحساب المسحوب منه العهدة "${custody.sourceAccountName || 'غير محدد'}" غير موجود أو تم حذفه.`
      : source.active === false
      ? `الحساب المسحوب منه العهدة "${source.name}" معطل حالياً.`
      : source.orgId && custody.orgId && source.orgId !== custody.orgId
      ? `الحساب المسحوب منه العهدة "${source.name}" تابع لشركة أخرى.`
      : currencyOf(source.currency) !== currency
      ? `عملة الحساب المسحوب منه العهدة "${source.name}" (${currencyOf(source.currency)}) لا تطابق عملة العهدة (${currency}).`
      : null;
    const alternatives = sourceIssue
      ? accountPool.filter(a => a.id !== custody.sourceAccountId && a.orgId === custody.orgId && a.active !== false && currencyOf(a.currency) === currency)
      : [];
    const target = sourceIssue ? alternatives.find(a => a.id === returnAltAccountId) || null : source;
    // An InstaPay target mirrors the deposit to its bank; a wallet is standalone (no parent).
    const parent = target ? resolveParentBankAccount(target) : null;
    return { custody, currency, amount, sourceIssue, alternatives, target, parent };
  }, [returningCustody, accountPool, returnAltAccountId, resolveParentBankAccount]);

  const handleOpenReturnModal = (custody: PettyCashCustody) => {
    setReturningCustodyId(custody.id);
    setReturnAltAccountId('');
    setReturnNotes('');
    setReturnError(null);
    returnGuard.rotateKey();
  };

  // Submit return of the remainder (one custody → its source account, or the chosen replacement)
  const handleSubmitReturn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!returnPlan) return;
    setReturnError(null);
    const { custody, currency, amount, sourceIssue, target } = returnPlan;

    if (amount <= 0) {
      setReturnError('لا يوجد متبقٍ في هذه العهدة لرده.');
      return;
    }
    if (sourceIssue && !target) {
      setReturnError(`يرجى اختيار حساب آخر نشط لنفس الشركة والعملة (${currency}) لإيداع المتبقي فيه.`);
      return;
    }

    // No target id → the domain deposits into the custody's own source account.
    const targetAccountId = sourceIssue ? target?.id : undefined;
    const targetName = target?.name || custody.sourceAccountName || 'الخزينة';
    await returnGuard.run(async (idempotencyKey) => {
      try {
        const res = await returnCustodyRemainders([custody.id], targetAccountId, returnNotes.trim(), { idempotencyKey });
        returnGuard.rotateKey();
        setReturningCustodyId(null);
        setNotice(
          res.returnedCount > 0
            ? `تم إيداع المتبقي من العهدة ${custody.custodyNumber} (${fmtMoney(res.totalReturned)} ${currency}) في "${targetName}" وإغلاق العهدة.`
            : `تم إيداع المتبقي من العهدة ${custody.custodyNumber} مسبقاً، ولم يتكرر الإيداع.`
        );
      } catch (err: any) {
        console.error(err);
        setReturnError(err?.message || 'حدث خطأ أثناء إيداع المتبقي من العهدة.');
      }
    });
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
                <h1 className="text-xl font-bold text-slate-900">
                  {canViewAllCustodies ? 'إدارة العُهد النقدية للموظفين والمناديب' : 'عُهدي النقدية'}
                </h1>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                  Petty Cash
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                {canViewAllCustodies
                  ? 'صرف العهد التشغيلية، تسجيل فواتير التصفية الدورية، واستعاضة الأرصدة عبر الخزائن والمحافظ'
                  : 'العُهد النقدية المصروفة لك: سجّل فواتير التصفية وتابع المتبقي طرفك'}
              </p>
            </div>
          </div>

          {/* Action button: issuing a custody is a treasury operation (permissions.ts issueCustody) */}
          {canIssueCustody && (
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

            {/* Employee Filter (only for those who see everyone's custodies) */}
            {canViewAllCustodies && (
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
            )}

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
                الكل ({cleanTargetCustodies.length})
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
                🟢 عهد نشطة ({cleanTargetCustodies.filter(c => c.status === 'active').length})
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
                ✓ تمت تصفيتها بالكامل ({cleanTargetCustodies.filter(c => c.status === 'settled').length})
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
              placeholder={canViewAllCustodies ? 'البحث باسم الموظف، كود العهدة CUS-، رقم الهاتف، أو الخزينة...' : 'البحث بكود العهدة CUS- أو الملاحظات أو الخزينة...'}
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

      {/* Success feedback after issue / invoice / replenish / return */}
      {notice && (
        <div role="status" className="p-3.5 rounded-2xl bg-teal-50 border border-teal-200 text-teal-800 text-xs font-bold flex items-center justify-between gap-3">
          <span className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span className="leading-relaxed">{notice}</span>
          </span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="p-1 rounded-lg text-teal-700 hover:bg-teal-100 cursor-pointer shrink-0"
            aria-label="إغلاق"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* 2. KPI Stat Cards (per currency) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Total Issued Custodies Amount */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500">
              {canViewAllCustodies ? 'إجمالي مبالغ العُهد المصروفة' : 'إجمالي العُهد المصروفة لي'}
            </span>
            <div className="h-9 w-9 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center border border-emerald-100">
              <Wallet className="h-4 w-4" />
            </div>
          </div>
          {renderKpiAmounts(row => row.issued, 'text-slate-900', 'text-slate-400')}
          <p className="text-[11px] text-slate-400 mt-1">
            المجموع الكلي لقيمة العُهد (المصروف + الاستعاضات)
            {totalReturned > 0 && (
              <span className="block text-teal-700 font-bold mt-0.5">
                منها {kpiTotals.filter(row => row.returned > 0).map(row => `${fmtMoney(row.returned)} ${row.currency}`).join(' + ')} مُردة للخزينة
              </span>
            )}
          </p>
          <div className="absolute -bottom-6 -left-6 w-20 h-20 bg-emerald-500/5 rounded-full pointer-events-none" />
        </div>

        {/* Card 2: Remaining Balance in Hand */}
        <div className="bg-white rounded-2xl border border-amber-200 p-5 shadow-xs relative overflow-hidden bg-gradient-to-bl from-white via-white to-amber-50/40">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-amber-800">
              {canViewAllCustodies ? 'الرصيد المتبقي طرف الموظفين' : 'الرصيد المتبقي طرفي'}
            </span>
            <div className="h-9 w-9 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center border border-amber-200">
              <Clock3 className="h-4 w-4" />
            </div>
          </div>
          {renderKpiAmounts(row => row.remaining, 'text-amber-900', 'text-amber-700')}
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
          {renderKpiAmounts(row => row.settled, 'text-blue-950', 'text-slate-400')}
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
            <span className="text-xs font-bold text-slate-400">{canViewAllCustodies ? 'عهدة طرف موظفين' : 'عهدة طرفي'}</span>
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
              {cleanTargetCustodies.length > 0 ? (
                <>
                  <h3 className="text-base font-bold text-slate-800">لا نتائج مطابقة للبحث أو التصفية الحالية</h3>
                  <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                    يوجد {cleanTargetCustodies.length} عهدة مسجلة؛ عدّل كلمة البحث أو فلتر الحالة لعرضها.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery('');
                      setStatusFilter('all');
                      setEmployeeFilter('all');
                    }}
                    className="mt-5 px-5 py-2.5 bg-slate-800 hover:bg-slate-900 text-white font-bold text-xs rounded-xl shadow-sm transition cursor-pointer"
                  >
                    مسح البحث والتصفية
                  </button>
                </>
              ) : (
                <>
                  <h3 className="text-base font-bold text-slate-800">
                    {canViewAllCustodies ? 'لا توجد عُهد نقدية مسجلة بعد' : 'لا توجد عُهد نقدية مصروفة لك'}
                  </h3>
                  <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                    {canIssueCustody
                      ? 'يمكنك صرف عهدة نقدية جديدة لأحد الموظفين أو المناديب للبدء.'
                      : 'عندما يصرف لك المسؤول المالي عهدة نقدية ستظهر هنا لتسجيل فواتير تصفيتها.'}
                  </p>
                  {/* Issuing is a treasury action: never offered to an employee or data entry */}
                  {canIssueCustody && (
                    <button
                      type="button"
                      onClick={handleOpenIssueModal}
                      className="mt-5 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-sm transition cursor-pointer"
                    >
                      + صرف عهدة جديدة الآن
                    </button>
                  )}
                </>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {custodyRows.visible.map((custody) => {
                // totalAmount = settled (invoices) + returned (deposited back) + remaining (cash in hand)
                const remainingAmount = Number(custody.remainingAmount || 0);
                const returnedAmount = Number(custody.returnedAmount || 0);
                const percentSettled = Math.min(
                  100,
                  Math.round(((custody.settledAmount || 0) / (custody.totalAmount || 1)) * 100)
                );
                const percentReturned = Math.min(
                  100 - percentSettled,
                  Math.round((returnedAmount / (custody.totalAmount || 1)) * 100)
                );
                const percentRemaining = remainingAmount > 0 ? 100 - percentSettled - percentReturned : 0;
                const isFullySettled = custody.status === 'settled' || remainingAmount <= 0;
                const isClosedByReturn = remainingAmount <= 0 && returnedAmount > 0;
                const canReturnRemainder = canIssueCustody && remainingAmount > 0;

                return (
                  <div 
                    key={custody.id}
                    role="button"
                    tabIndex={0}
                    aria-label={`عرض كشف حساب العهدة ${custody.custodyNumber}`}
                    onClick={() => setInspectingCustody(custody)}
                    onKeyDown={(e) => {
                      if (e.target !== e.currentTarget) return;
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setInspectingCustody(custody);
                      }
                    }}
                    className="bg-white rounded-3xl border border-slate-200 hover:border-slate-300 p-5 shadow-xs hover:shadow-md transition-all flex flex-col justify-between cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40"
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
                        {isClosedByReturn ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-teal-50 text-teal-700 border border-teal-200 text-center">
                            <Undo2 className="h-3 w-3 shrink-0" />
                            أُغلقت — تم رد المتبقي للخزينة
                          </span>
                        ) : isFullySettled ? (
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
                              <span>{custody.issuedAt ? formatLocalDate(custody.issuedAt) : '—'}</span>
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
                          {percentReturned > 0 && (
                            <div
                              className="bg-teal-500 h-full rounded-full transition-all duration-500"
                              style={{ width: `${percentReturned}%` }}
                              title="مُرد للخزينة"
                            />
                          )}
                          <div
                            className="bg-amber-500 h-full rounded-full transition-all duration-500"
                            style={{ width: `${percentRemaining}%` }}
                          />
                        </div>

                        {/* Amounts Matrix */}
                        <div className="grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-slate-200/60 text-center">
                          <div>
                            <span className="text-[10px] text-slate-400 block font-medium">إجمالي العهدة</span>
                            <span className="text-xs font-black text-slate-900 mt-0.5 block">
                              {fmtMoney(custody.totalAmount)} <span className="text-[9px] font-bold text-slate-400">{currencyOf(custody.currency)}</span>
                            </span>
                          </div>
                          <div>
                            <span className="text-[10px] text-blue-600 block font-medium">المصفى بفواتير</span>
                            <span className="text-xs font-black text-blue-700 mt-0.5 block">
                              {fmtMoney(custody.settledAmount)}
                            </span>
                          </div>
                          <div>
                            <span className="text-[10px] text-amber-600 block font-medium">المتبقي نقداً</span>
                            <span className="text-xs font-black text-amber-700 mt-0.5 block">
                              {fmtMoney(custody.remainingAmount)}
                            </span>
                          </div>
                        </div>

                        {/* Cash returned to a treasury account */}
                        {returnedAmount > 0 && (
                          <div className="mt-2 pt-2 border-t border-slate-200/60 flex items-center justify-between gap-2 text-[11px]">
                            <span className="flex items-center gap-1 font-bold text-teal-700 shrink-0">
                              <Undo2 className="h-3 w-3" />
                              مُرد للخزينة: {fmtMoney(returnedAmount)}
                            </span>
                            {custody.returnedToAccountName && (
                              <span className="text-slate-500 truncate" title={custody.returnedToAccountName}>
                                في: {custody.returnedToAccountName}
                              </span>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Custody Notes */}
                      {custody.notes && (
                        <div className="mt-3 px-3 py-1.5 bg-amber-50/50 rounded-xl border border-amber-100/60 text-[11px] text-amber-800 truncate">
                          💬 {custody.notes}
                        </div>
                      )}
                    </div>

                    {/* Card Actions (their own clicks never open the statement) */}
                    <div className="mt-5 pt-4 border-t border-slate-100 space-y-2" onClick={(e) => e.stopPropagation()}>
                      {/* Return the remaining cash to the account the custody was withdrawn from */}
                      {canReturnRemainder && (
                        <button
                          type="button"
                          onClick={() => handleOpenReturnModal(custody)}
                          className="w-full py-2 px-3 bg-teal-50 hover:bg-teal-100 text-teal-800 border border-teal-200 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition cursor-pointer"
                          title="رد النقدية المتبقية طرف الموظف وإيداعها في الحساب الذي صُرفت منه العهدة، ثم إغلاق العهدة"
                        >
                          <Undo2 className="h-3.5 w-3.5 shrink-0" />
                          <span>إيداع المتبقي للحساب المسحوب منه</span>
                          <span className="font-mono text-teal-700">({fmtMoney(remainingAmount)})</span>
                        </button>
                      )}

                      <div className="flex items-center gap-2">
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
  
                        {/* Replenish Action: a treasury operation (permissions.ts issueCustody) */}
                        {canIssueCustody && (
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
                  </div>
                );
              })}
            </div>
          )}
          <ShowMoreButton remaining={custodyRows.remaining} noun="عهدة" onClick={custodyRows.showMore} />
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
                  {settlementRows.visible.map((item) => (
                    <tr key={item.id} className="hover:bg-slate-50/70 transition">
                      <td className="p-4 text-slate-600 font-mono whitespace-nowrap">
                        {item.invoiceDate || formatLocalDate(item.createdAt)}
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
                        {fmtMoney(item.amount)} {currencyOf(item.currency)}
                      </td>
                      <td className="p-4 text-center whitespace-nowrap">
                        {item.receiptUrl ? (
                          <button
                            type="button"
                            onClick={() => openSettlementReceipt(item.receiptUrl)}
                            disabled={receiptPreview.loadingUrl === item.receiptUrl}
                            className="inline-flex items-center gap-1 px-2.5 py-1 bg-blue-50 text-blue-700 hover:bg-blue-100 rounded-lg text-xs font-bold transition cursor-pointer disabled:opacity-70 disabled:cursor-wait"
                          >
                            {receiptPreview.loadingUrl === item.receiptUrl ? (
                              <>
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                <span>جاري التحميل...</span>
                              </>
                            ) : (
                              <>
                                <FileText className="h-3.5 w-3.5" />
                                <span>عرض الفاتورة</span>
                              </>
                            )}
                          </button>
                        ) : (
                          <span className="text-slate-300 text-[11px]">لا يوجد</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <ShowMoreButton remaining={settlementRows.remaining} noun="فاتورة" onClick={settlementRows.showMore} className="p-3 text-center border-t border-slate-100" />
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 1: صرف عهدة نقدية جديدة لموظف */}
      {/* ========================================================================= */}
      {isIssueModalOpen && canIssueCustody && (
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
                    {creatableOrgs.map(o => (
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
                  <>
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
                    {issueOrgId && availableMembers.length === 0 && (
                      <span className="text-[10px] text-amber-700 font-bold mt-1 block">
                        لا يوجد موظفون نشطون مسجلون في هذه الشركة. استخدم «كتابة اسم يدوي» أو أضف الموظف من صفحة المستخدمين.
                      </span>
                    )}
                  </>
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
                    onChange={(e) => {
                      setIssueAmount(sanitizeAmount(e.target.value));
                      setIssueError(null);
                    }}
                    placeholder="0.00"
                    required
                    className={`w-full pr-4 pl-12 py-2.5 bg-slate-50 border rounded-xl text-sm font-black focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 ${
                      issueExceedsBalance ? 'border-rose-400 text-rose-800' : 'border-slate-200 text-slate-900'
                    }`}
                  />
                  {/* The custody takes the currency of the account it is paid from */}
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">
                    {currencyOf(issueAccount?.currency || activeOrg?.currency)}
                  </span>
                </div>
              </div>

              {/* Source Treasury Account */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">خصم من الخزينة / حساب الدفع *</label>
                <select
                  value={issueSourceAccountId}
                  onChange={(e) => {
                    setIssueSourceAccountId(e.target.value);
                    setIssueError(null);
                  }}
                  required
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  <option value="">-- اختر الخزينة أو الحساب المالي --</option>
                  {availableAccountsForIssue.map(acc => (
                    <option key={acc.id} value={acc.id}>
                      {accountOptionLabel(acc)}
                    </option>
                  ))}
                </select>
                {issueOrgId && availableAccountsForIssue.length === 0 && (
                  <span className="text-[10px] text-amber-700 font-bold mt-1 block">
                    لا توجد خزينة أو حساب دفع نشط لهذه الشركة. أنشئ حساباً من صفحة الخزينة أولاً.
                  </span>
                )}
                {/* No overdraft: say so before the user submits */}
                {issueAccount && issueExceedsBalance && (
                  <p className="text-[11px] text-rose-700 font-bold mt-1.5 leading-relaxed">
                    {insufficientMessage(issueAccount, issueAmountNum)}
                  </p>
                )}
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
                  disabled={isIssuing || issueExceedsBalance}
                  className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-xs transition flex items-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
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
                onClick={closeSettleModal}
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
                  {fmtMoney(settlingCustody.remainingAmount)} {currencyOf(settlingCustody.currency)}
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
                    {/* Services of the custody's own company, incl. services shared with it (orgIds);
                        a deactivated service is not offered for new invoices */}
                    {targetServices
                      .filter(s => isServiceMatchingOrg(s, settlingCustody.orgId) && s.active !== false)
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
                  <div className="flex items-center gap-2 flex-wrap">
                    <input
                      type="file"
                      ref={receiptFileInputRef}
                      onChange={handleFileUpload}
                      accept={ATTACHMENT_ACCEPT}
                      className="hidden"
                    />
                    <button
                      type="button"
                      onClick={() => receiptFileInputRef.current?.click()}
                      disabled={isUploadingReceipt || isSettling}
                      className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold flex items-center gap-1.5 transition cursor-pointer disabled:opacity-60 disabled:cursor-wait"
                    >
                      {isUploadingReceipt ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <UploadCloud className="h-4 w-4" />
                      )}
                      <span>
                        {isUploadingReceipt ? 'جاري رفع المستند...' : settleReceiptFile ? 'استبدال الملف' : 'رفع صورة المستند'}
                      </span>
                    </button>
                    {!settleReceiptFile && !isUploadingReceipt && (
                      <span className="text-[11px] text-slate-400">أو رابط إلكتروني:</span>
                    )}
                  </div>
                  <span className="text-[10px] text-slate-400 block">
                    PDF أو صور (PNG, JPG) حتى {ATTACHMENT_LIMIT_LABEL} كحد أقصى (ضغط تلقائي للصور)
                  </span>

                  {settleReceiptFile ? (
                    <div className="flex items-center justify-between gap-2 p-2.5 bg-blue-50/40 rounded-xl border border-blue-200">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="h-8 w-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                          {settleReceiptFile.mimeType === 'application/pdf' ? (
                            <FileText className="h-4 w-4" />
                          ) : (
                            <ImageIcon className="h-4 w-4" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <span className="text-xs font-bold text-slate-900 block truncate max-w-[220px]" title={settleReceiptFile.name}>
                            {settleReceiptFile.name}
                          </span>
                          <span className="text-[10px] text-blue-700 font-bold">
                            {formatFileSize(settleReceiptFile.size)} • تم إرفاق المستند بنجاح
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => receiptPreview.open({
                            url: settleReceiptFile.url,
                            name: settleReceiptFile.name,
                            size: formatFileSize(settleReceiptFile.size),
                            type: settleReceiptFile.mimeType === 'application/pdf' ? 'pdf' : 'jpg',
                          })}
                          className="text-blue-600 hover:text-blue-800 p-1.5 rounded-lg hover:bg-blue-50 transition cursor-pointer"
                          title="معاينة المستند"
                        >
                          <Eye className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={discardSettleReceipt}
                          disabled={isSettling}
                          className="text-rose-500 hover:text-rose-700 p-1.5 rounded-lg hover:bg-rose-50 transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                          title="حذف المرفق"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  ) : !isUploadingReceipt && (
                    <>
                      <input
                        type="text"
                        value={settleReceiptUrl}
                        onChange={(e) => setSettleReceiptUrl(e.target.value)}
                        placeholder="https://..."
                        className="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-700 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />

                      {settleReceiptUrl && (
                        <div className="flex items-center gap-2 text-xs text-blue-600 font-bold">
                          <ImageIcon className="h-3.5 w-3.5" />
                          <span>تم إرفاق المستند بنجاح</span>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* Submit Buttons */}
              <div className="pt-3 flex items-center justify-end gap-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={closeSettleModal}
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
      {replenishingCustody && canIssueCustody && (
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
                  {fmtMoney(replenishingCustody.remainingAmount)} {currencyOf(replenishingCustody.currency)}
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
                    onChange={(e) => {
                      setReplenishAmount(sanitizeAmount(e.target.value));
                      setReplenishError(null);
                    }}
                    placeholder="0.00"
                    required
                    className={`w-full pr-4 pl-12 py-2.5 bg-slate-50 border rounded-xl text-sm font-black focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500 ${
                      replenishExceedsBalance ? 'border-rose-400 text-rose-800' : 'border-slate-200 text-slate-900'
                    }`}
                  />
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">
                    {currencyOf(replenishingCustody.currency)}
                  </span>
                </div>
              </div>

              {/* Source Treasury Account */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">خصم مبلغ الاستعاضة من خزينة *</label>
                <select
                  value={replenishSourceAccountId}
                  onChange={(e) => {
                    setReplenishSourceAccountId(e.target.value);
                    setReplenishError(null);
                  }}
                  required
                  className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                >
                  <option value="">-- اختر الخزينة أو المحفظة --</option>
                  {/* Active accounts of the custody's company in the custody's currency */}
                  {replenishAccounts.map(acc => (
                    <option key={acc.id} value={acc.id}>
                      {accountOptionLabel(acc)}
                    </option>
                  ))}
                </select>
                {replenishAccounts.length === 0 && (
                  <span className="text-[10px] text-amber-700 font-bold mt-1 block">
                    لا يوجد حساب نشط لشركة هذه العهدة بعملتها ({currencyOf(replenishingCustody.currency)}). أنشئ حساباً أو فعّله من صفحة الخزينة أولاً.
                  </span>
                )}
                {/* No overdraft: say so before the user submits */}
                {replenishAccount && replenishExceedsBalance && (
                  <p className="text-[11px] text-rose-700 font-bold mt-1.5 leading-relaxed">
                    {insufficientMessage(replenishAccount, replenishAmountNum)}
                  </p>
                )}
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
                  disabled={isReplenishing || replenishExceedsBalance}
                  className="px-5 py-2.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-xl shadow-xs transition flex items-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
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
      {/* MODAL 3b: إيداع المتبقي من العهدة للحساب المسحوب منه المال */}
      {/* ========================================================================= */}
      {returnPlan && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl max-w-md w-full p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between gap-3 pb-4 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-2xl bg-teal-100 text-teal-700 flex items-center justify-center shrink-0">
                  <Undo2 className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">إيداع المتبقي من العهدة للحساب المسحوب منه المال</h3>
                  <p className="text-xs text-slate-500">رد النقدية المتبقية طرف الموظف إلى الخزينة وإغلاق العهدة</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setReturningCustodyId(null)}
                disabled={isReturning}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-xl hover:bg-slate-100 cursor-pointer shrink-0"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Custody Info */}
            <div className="mt-4 p-3 bg-slate-50 rounded-2xl border border-slate-200 text-xs flex justify-between gap-3">
              <div className="min-w-0">
                <span className="text-slate-400 block text-[10px]">الموظف:</span>
                <span className="font-bold text-slate-900">{returnPlan.custody.employeeName}</span>
                <span className="text-[10px] text-slate-500 block font-mono">({returnPlan.custody.custodyNumber})</span>
              </div>
              <div className="text-left shrink-0">
                <span className="text-slate-400 block text-[10px]">المتبقي طرف الموظف (سيتم إيداعه):</span>
                <span className="font-black text-sm text-amber-700">
                  {fmtMoney(returnPlan.amount)} {returnPlan.currency}
                </span>
              </div>
            </div>

            {returnPlan.amount <= 0 && !isReturning && (
              <div className="mt-3 p-3 rounded-xl bg-slate-50 border border-slate-200 text-slate-600 text-xs font-bold flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>لا يوجد متبقٍ في هذه العهدة لرده (ربما تمت تصفيتها أو رد المتبقي منها للتو).</span>
              </div>
            )}

            {returnError && (
              <div className="mt-3 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs font-bold flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{returnError}</span>
              </div>
            )}

            <form onSubmit={handleSubmitReturn} className="mt-4 space-y-3.5">

              {/* Target Treasury Account */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">الإيداع في حساب / خزينة</label>
                {returnPlan.sourceIssue ? (
                  <div className="space-y-2">
                    <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs font-bold flex items-start gap-2">
                      <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                      <span>
                        {returnPlan.sourceIssue} يرجى اختيار حساب آخر نشط لنفس الشركة وبنفس العملة ({returnPlan.currency}) لإيداع المتبقي فيه.
                      </span>
                    </div>
                    <select
                      value={returnAltAccountId}
                      onChange={(e) => setReturnAltAccountId(e.target.value)}
                      required
                      className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
                    >
                      <option value="">-- اختر حساب الإيداع البديل --</option>
                      {returnPlan.alternatives.map(acc => (
                        <option key={acc.id} value={acc.id}>
                          {acc.name} (الرصيد: {fmtMoney(balanceOf(acc))} {currencyOf(acc.currency)})
                        </option>
                      ))}
                    </select>
                    {returnPlan.alternatives.length === 0 && (
                      <span className="text-[10px] text-amber-700 font-bold block">
                        لا يوجد حساب نشط آخر لهذه الشركة بنفس العملة. أنشئ حساباً أو فعّله من صفحة الخزينة أولاً.
                      </span>
                    )}
                  </div>
                ) : (
                  <div className="px-3 py-2.5 rounded-xl bg-teal-50/60 border border-teal-200 text-xs flex items-center gap-2">
                    <Landmark className="h-4 w-4 text-teal-700 shrink-0" />
                    <span className="font-bold text-slate-900 truncate">{returnPlan.target?.name || returnPlan.custody.sourceAccountName}</span>
                    <span className="text-[10px] text-teal-700 font-bold shrink-0">(الحساب المسحوب منه العهدة)</span>
                  </div>
                )}

                {/* Balance preview: current → after the deposit (and the InstaPay bank it mirrors to) */}
                {returnPlan.target && (
                  <div className="mt-2 grid grid-cols-2 gap-2 text-center text-xs">
                    <div className="p-2 bg-white rounded-xl border border-slate-200">
                      <span className="text-[10px] text-slate-400 block">الرصيد الحالي</span>
                      <span className="font-black text-slate-800">
                        {fmtMoney(balanceOf(returnPlan.target))} {currencyOf(returnPlan.target.currency)}
                      </span>
                    </div>
                    <div className="p-2 bg-teal-50/60 rounded-xl border border-teal-200">
                      <span className="text-[10px] text-teal-700 block font-bold">الرصيد بعد الإيداع</span>
                      <span className="font-black text-teal-800">
                        {fmtMoney(balanceOf(returnPlan.target) + returnPlan.amount)} {currencyOf(returnPlan.target.currency)}
                      </span>
                    </div>
                  </div>
                )}
                {returnPlan.parent && (
                  <p className="mt-2 p-2.5 rounded-xl bg-blue-50 border border-blue-100 text-[11px] text-blue-800 leading-relaxed">
                    حساب إنستاباي مرتبط ببنك: سينعكس الإيداع تلقائياً على الحساب البنكي «{returnPlan.parent.name}» ويصبح رصيده{' '}
                    <strong>{fmtMoney(balanceOf(returnPlan.parent) + returnPlan.amount)}</strong> بدلاً من {fmtMoney(balanceOf(returnPlan.parent))}.
                  </p>
                )}
              </div>

              <p className="text-[11px] text-slate-500 leading-relaxed">
                سيتم تسجيل حركة إيداع (+ IN) في كشف حساب الخزينة، وتُغلق العهدة بمتبقٍ صفر ويُسجَّل المبلغ كمُرد للخزينة.
              </p>

              {/* Notes */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">ملاحظات (اختياري)</label>
                <textarea
                  rows={2}
                  value={returnNotes}
                  onChange={(e) => setReturnNotes(e.target.value)}
                  placeholder="مثال: تسليم نقدية متبقية بعد انتهاء المهمة، رقم إيصال الاستلام..."
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>

              {/* Submit Buttons */}
              <div className="pt-3 flex items-center justify-end gap-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setReturningCustodyId(null)}
                  disabled={isReturning}
                  className="px-4 py-2.5 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={isReturning || returnPlan.amount <= 0 || (!!returnPlan.sourceIssue && returnPlan.alternatives.length === 0)}
                  className="px-5 py-2.5 bg-teal-600 hover:bg-teal-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white text-xs font-bold rounded-xl shadow-xs transition flex items-center gap-2 cursor-pointer"
                >
                  {isReturning ? (
                    <>
                      <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                      <span>جاري إيداع المتبقي...</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="h-4 w-4 shrink-0" />
                      <span>
                        تأكيد إيداع المتبقي ({fmtMoney(returnPlan.amount)} {returnPlan.currency}) في {returnPlan.target?.name || 'الحساب المختار'}
                      </span>
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
            <div className={`grid gap-3 my-4 ${Number(inspectingCustody.returnedAmount || 0) > 0 ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-3'}`}>
              <div className="bg-slate-50 p-3.5 rounded-2xl border border-slate-100 text-center">
                <span className="text-[11px] text-slate-400 block font-medium">إجمالي المنصرف</span>
                <span className="text-sm font-black text-slate-900 mt-1 block">
                  {fmtMoney(inspectingCustody.totalAmount)} {currencyOf(inspectingCustody.currency)}
                </span>
              </div>
              <div className="bg-blue-50/60 p-3.5 rounded-2xl border border-blue-100 text-center">
                <span className="text-[11px] text-blue-600 block font-medium">تمت تصفيته بالفواتير</span>
                <span className="text-sm font-black text-blue-800 mt-1 block">
                  {fmtMoney(inspectingCustody.settledAmount)} {currencyOf(inspectingCustody.currency)}
                </span>
              </div>
              {Number(inspectingCustody.returnedAmount || 0) > 0 && (
                <div className="bg-teal-50/60 p-3.5 rounded-2xl border border-teal-100 text-center">
                  <span className="text-[11px] text-teal-700 block font-medium">مُرد للخزينة</span>
                  <span className="text-sm font-black text-teal-800 mt-1 block">
                    {fmtMoney(inspectingCustody.returnedAmount)} {currencyOf(inspectingCustody.currency)}
                  </span>
                </div>
              )}
              <div className="bg-amber-50/60 p-3.5 rounded-2xl border border-amber-100 text-center">
                <span className="text-[11px] text-amber-700 block font-medium">المتبقي طرف الموظف</span>
                <span className="text-sm font-black text-amber-900 mt-1 block">
                  {fmtMoney(inspectingCustody.remainingAmount)} {currencyOf(inspectingCustody.currency)}
                </span>
              </div>
            </div>

            {/* Remainder returned to a treasury account */}
            {Number(inspectingCustody.returnedAmount || 0) > 0 && (
              <div className="p-3 rounded-2xl bg-teal-50/60 border border-teal-100 text-xs text-teal-800 flex items-center gap-2">
                <Undo2 className="h-4 w-4 shrink-0" />
                <span>
                  تم رد {fmtMoney(inspectingCustody.returnedAmount)} {currencyOf(inspectingCustody.currency)} من هذه العهدة للخزينة
                  {inspectingCustody.returnedToAccountName ? <> في حساب <strong>«{inspectingCustody.returnedToAccountName}»</strong></> : null}
                  {inspectingCustody.returnedAt ? ` بتاريخ ${formatLocalDate(inspectingCustody.returnedAt)}` : ''}.
                </span>
              </div>
            )}

            {/* Return the remaining cash to the account the custody was withdrawn from */}
            {canIssueCustody && Number(inspectingCustody.remainingAmount || 0) > 0 && (
              <div className="mt-3 p-3 rounded-2xl bg-slate-50 border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                <span className="text-slate-600">
                  المتبقي طرف الموظف: <strong className="text-amber-700">{fmtMoney(inspectingCustody.remainingAmount)} {currencyOf(inspectingCustody.currency)}</strong> — مصدر الصرف: <strong className="text-slate-800">{inspectingCustody.sourceAccountName || 'غير محدد'}</strong>
                </span>
                <button
                  type="button"
                  onClick={() => {
                    const c = inspectingCustody;
                    setInspectingCustody(null);
                    handleOpenReturnModal(c);
                  }}
                  className="py-2 px-3 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition cursor-pointer shrink-0"
                >
                  <Undo2 className="h-3.5 w-3.5" />
                  <span>إيداع المتبقي للحساب المسحوب منه</span>
                </button>
              </div>
            )}

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
                          <span>{item.invoiceDate || formatLocalDate(item.createdAt)}</span>
                          {item.vendorName && <span>• المورد: {item.vendorName}</span>}
                          {item.serviceCategoryName && <span>• البند: {item.serviceCategoryName}</span>}
                        </div>
                      </div>

                      <div className="flex items-center gap-3 shrink-0">
                        <span className="font-black text-slate-900">
                          {fmtMoney(item.amount)} {currencyOf(item.currency)}
                        </span>
                        {item.receiptUrl && (
                          <button
                            type="button"
                            onClick={() => openSettlementReceipt(item.receiptUrl)}
                            disabled={receiptPreview.loadingUrl === item.receiptUrl}
                            className="p-1.5 bg-white border border-slate-200 rounded-lg text-slate-600 hover:text-blue-600 hover:border-blue-300 disabled:cursor-wait"
                            title={receiptPreview.loadingUrl === item.receiptUrl ? 'جاري تحميل الفاتورة...' : 'عرض الفاتورة'}
                          >
                            {receiptPreview.loadingUrl === item.receiptUrl ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Eye className="h-3.5 w-3.5" />
                            )}
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
      {receiptPreview.preview && (
        <InvoiceViewerModal
          attachment={receiptPreview.preview}
          onClose={receiptPreview.close}
        />
      )}

    </div>
  );
};
