import React, { useState, useMemo, useEffect } from 'react';
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
  Building,
  CreditCard,
  Copy,
  Printer,
  Smartphone,
  ShieldCheck,
  HelpCircle,
  X,
  FileText,
  User as UserIcon,
  Flame,
  Download,
  QrCode,
  Zap,
  FileSpreadsheet,
  ArrowDownLeft,
  Landmark,
  Pencil,
  Receipt,
  ChevronDown
} from 'lucide-react';
import { NewRequestModal } from './NewRequestModal';
import { InvoiceViewerModal, InvoiceViewerAttachment, AttachmentImage } from './InvoiceViewerModal';
import { useSubmitGuard, useKeyedSubmitGuard } from '../hooks/useSubmitGuard';
import { useEscapeToClose } from '../hooks/useEscapeToClose';
import { newOperationKey } from '../utils/ids';
import { showToast } from '../utils/toast';
import { can } from '../utils/permissions';
import {
  accountBalance,
  accountTypeLabel,
  accountTypeToPaymentMethod,
  accountsForRequest,
  copyTextToClipboard,
  currencyCode,
  fmtMoney,
  formatLocalDate,
  formatLocalDateTime,
  incomeMethodLabel,
  insufficientBalanceMessage,
  localToday,
  paymentMethodLabel,
  pickDisbursementAccount,
  resolveRequestPaymentMethod,
} from '../utils/requestUi';

const errorText = (err: unknown, fallback: string) =>
  err instanceof Error && err.message ? err.message : fallback;

const newBatchRef = (key: string = newOperationKey()) => `BATCH-${key.replace(/-/g, '').slice(0, 8).toUpperCase()}`;

/** Deterministic per-request idempotency key inside one batch (must match /^[A-Za-z0-9_-]{8,128}$/). */
const batchItemKey = (batchKey: string, requestId: string) =>
  `${batchKey}__${requestId}`.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 128);

type QrModule = typeof import('qrcode');

/**
 * The payment QR code, drawn in the browser by the "qrcode" package (loaded on first
 * use). The payee's account data never leaves the app — no third-party QR service.
 * Rendered with key={value}, so a new value starts from a fresh (loading) state.
 */
const PaymentQrCode: React.FC<{ value: string }> = ({ value }) => {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    import('qrcode')
      .then((mod: QrModule & { default?: QrModule }) => (mod.default ?? mod).toDataURL(value, { width: 440, margin: 1, errorCorrectionLevel: 'M' }))
      .then(url => {
        if (!cancelled) setDataUrl(url);
      })
      .catch(err => {
        console.error('[PaymentQrCode] QR generation failed:', err);
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [value]);

  if (failed) {
    return (
      <div role="alert" className="w-48 h-48 sm:w-52 sm:h-52 mx-auto flex items-center justify-center text-center text-xs font-bold text-rose-700 p-3">
        تعذر إنشاء رمز QR على هذا الجهاز. استخدم زر «نسخ البيانات» بالأسفل.
      </div>
    );
  }
  if (!dataUrl) {
    return (
      <div className="w-48 h-48 sm:w-52 sm:h-52 mx-auto flex items-center justify-center text-xs text-slate-400 bg-slate-100 rounded-lg animate-pulse">
        جاري إنشاء الرمز...
      </div>
    );
  }
  return <img src={dataUrl} alt={`رمز QR لبيانات الدفع: ${value}`} className="w-48 h-48 sm:w-52 sm:h-52 mx-auto object-contain" />;
};

interface ExpenseRequestsListProps {
  onSelectRequest: (request: ExpenseRequest) => void;
  onOpenNewRequest: () => void;
  onEditRequest?: (request: ExpenseRequest) => void;
}

export const ExpenseRequestsList: React.FC<ExpenseRequestsListProps> = ({ 
  onSelectRequest, 
  onOpenNewRequest,
  onEditRequest 
}) => {
  const { 
    requests, 
    allRequests,
    organizations,
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
    disburseRequest,
    resolveParentBankAccount
  } = useApp();

  const isSuperAdmin = currentRole === 'super_admin' || currentUser.role === 'super_admin';
  const targetRequests = useMemo(() => {
    return (isSuperAdmin && activeOrgId === 'all') ? (allRequests && allRequests.length > 0 ? allRequests : requests) : requests;
  }, [isSuperAdmin, activeOrgId, allRequests, requests]);

  // Each action only for the roles the domain (and firestore.rules) accept.
  const canApprove = can(currentRole, 'approveRequests');
  const canReject = can(currentRole, 'rejectRequests');
  const canClarify = can(currentRole, 'clarifyRequests');
  const canDisburse = can(currentRole, 'disburseRequests');

  const [editingRequest, setEditingRequest] = useState<ExpenseRequest | null>(null);
  const [selectedReqId, setSelectedReqId] = useState<string | null>(null);
  // Result of the last copy button press (never "copied" when the browser refused it)
  const [copyState, setCopyState] = useState<{ id: string; ok: boolean } | null>(null);
  const [previewInvoice, setPreviewInvoice] = useState<InvoiceViewerAttachment | null>(null);

  // Search and Rich Filter States
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [providerFilter, setProviderFilter] = useState<string>('all');
  const [departmentFilter, setDepartmentFilter] = useState<string>('all');
  const [urgencyFilter, setUrgencyFilter] = useState<string>('all');
  const [paymentMethodFilter, setPaymentMethodFilter] = useState<string>('all');
  const [requesterFilter, setRequesterFilter] = useState<string>('all');
  const [datePeriodFilter, setDatePeriodFilter] = useState<string>('all');
  const [specificDateFilter, setSpecificDateFilter] = useState<string>('');
  
  // Progressive rendering state for instant load and buttery-smooth scrolling
  const [visibleCount, setVisibleCount] = useState(35);

  useEffect(() => {
    setVisibleCount(35);
  }, [
    search, 
    statusFilter, 
    categoryFilter, 
    providerFilter, 
    departmentFilter, 
    urgencyFilter, 
    paymentMethodFilter, 
    requesterFilter, 
    datePeriodFilter, 
    specificDateFilter
  ]);

  // Inline Actions States
  const [activeAction, setActiveAction] = useState<'none' | 'approve' | 'reject' | 'clarify' | 'disburse'>('none');
  const [approvalNote, setApprovalNote] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');
  const [clarificationQuestion, setClarificationQuestion] = useState('');
  // Inline message of the open action panel (an empty reason / question never fails silently)
  const [inlineError, setInlineError] = useState<string | null>(null);

  // Disbursement States
  // '' = the default account picked for the request (pickDisbursementAccount), shown selected.
  const [disburseAccountId, setDisburseAccountId] = useState<string>('');
  const [disburseMethod, setDisburseMethod] = useState<PaymentMethod>('bank_transfer');
  const [disburseRefNumber, setDisburseRefNumber] = useState(`TXN-${Math.floor(10000000 + Math.random() * 90000000)}`);
  const [disburseNotes, setDisburseNotes] = useState('');
  // Per-request action locks + idempotency keys (scope = `${action}:${requestId}`)
  const actionGuard = useKeyedSubmitGuard();

  // Batch Disbursement States (الصرف المجمع)
  const [selectedApprovedIds, setSelectedApprovedIds] = useState<string[]>([]);
  const [isBatchModalOpen, setIsBatchModalOpen] = useState(false);
  const [batchAccountId, setBatchAccountId] = useState<string>('');
  const [batchPaymentMethod, setBatchPaymentMethod] = useState<'auto' | PaymentMethod>('auto');
  const [batchRefNumber, setBatchRefNumber] = useState(() => newBatchRef());
  const [batchNotes, setBatchNotes] = useState('صرف دفعة مجمعة معتمدة');
  // Batch lock; its idempotency key is the batch key (rotated when the batch modal opens)
  const batchGuard = useSubmitGuard();
  const isBatchDisbursing = batchGuard.pending;
  // Stable sequence number per request within the current batch (so retries keep the same reference suffix)
  const batchSeqRef = React.useRef(new Map<string, number>());

  // Instant QR Code Modal State
  const [qrModalRequest, setQrModalRequest] = useState<ExpenseRequest | null>(null);

  // Derive unique departments for filter dropdown
  const uniqueDepartments = useMemo(() => {
    const set = new Set<string>();
    targetRequests.forEach(r => {
      if (r.requesterDepartment) set.add(r.requesterDepartment.trim());
    });
    return Array.from(set);
  }, [targetRequests]);

  // Derive unique requesters for filter dropdown
  const uniqueRequesters = useMemo(() => {
    const set = new Set<string>();
    targetRequests.forEach(r => {
      if (r.requesterName) set.add(r.requesterName.trim());
    });
    return Array.from(set).sort();
  }, [targetRequests]);

  // Strict deduplication & comprehensive multi-filter matching
  const filteredRequests = useMemo(() => {
    const seenIds = new Set<string>();
    const seenNumbers = new Set<string>();
    const now = new Date();

    return targetRequests.filter(req => {
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

      // Payment Method (the same resolved method the badge shows, also for older records without one)
      if (paymentMethodFilter !== 'all' && resolveRequestPaymentMethod(req) !== paymentMethodFilter) return false;

      // Date Period
      if (datePeriodFilter !== 'all') {
        const reqDate = new Date(req.createdAt);
        const diffHours = (now.getTime() - reqDate.getTime()) / (1000 * 60 * 60);
        if (datePeriodFilter === 'today' && diffHours > 24) return false;
        if (datePeriodFilter === 'week' && diffHours > 24 * 7) return false;
        if (datePeriodFilter === 'month' && diffHours > 24 * 30) return false;
        if (datePeriodFilter === 'specific' && specificDateFilter) {
          // Compared as local calendar days (createdAt is stored in UTC).
          const reqCreated = formatLocalDate(req.createdAt) === specificDateFilter;
          const reqDisbursed = req.disbursement?.disbursedAt ? formatLocalDate(req.disbursement.disbursedAt) === specificDateFilter : false;
          if (!reqCreated && !reqDisbursed) return false;
        }
      }

      // Requester (الموظف مقدم الطلب)
      if (requesterFilter !== 'all' && req.requesterName !== requesterFilter) return false;

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
    targetRequests,
    statusFilter,  
    categoryFilter, 
    providerFilter, 
    departmentFilter, 
    urgencyFilter, 
    paymentMethodFilter, 
    requesterFilter,
    datePeriodFilter, 
    specificDateFilter,
    search
  ]);

  // Sliced requests for progressive rendering
  const visibleRequests = useMemo(() => {
    return filteredRequests.slice(0, visibleCount);
  }, [filteredRequests, visibleCount]);

  // Selected Active Request for Deep Tracking Workspace — always one of the listed results
  // (a request the filters hide is not kept on screen next to "0 results").
  const activeRequest: ExpenseRequest | undefined = useMemo(() => {
    if (selectedReqId) {
      const found = filteredRequests.find(r => r.id === selectedReqId);
      if (found) return found;
    }
    return filteredRequests[0];
  }, [selectedReqId, filteredRequests]);

  const canEditActive = useMemo(() => {
    if (!activeRequest) return false;
    return (activeRequest.status === 'pending' || activeRequest.status === 'clarification_requested') &&
      (currentUser.id === activeRequest.requesterId || currentUser.email === activeRequest.requesterEmail || isSuperAdmin || currentRole === 'org_admin');
  }, [activeRequest, currentUser, isSuperAdmin, currentRole]);

  // Another request selected: start its panels fresh, with the method the request asks for
  // and its default account. Keyed on the id only: live balance updates must not reset the
  // account the user picked or close an open panel.
  const activeRequestId = activeRequest?.id;
  const activeRequestMethod = activeRequest ? resolveRequestPaymentMethod(activeRequest) : 'bank_transfer';
  // A card's quick action ("تم الاستلام") selects the request AND opens its panel: the
  // panel to open survives the reset below.
  const openAfterSelectRef = React.useRef<typeof activeAction | null>(null);
  React.useEffect(() => {
    setDisburseMethod(activeRequestMethod);
    setDisburseAccountId('');
    setActiveAction(openAfterSelectRef.current ?? 'none');
    openAfterSelectRef.current = null;
    setInlineError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRequestId]);

  // Accounts this request can be paid from / received into (its company, active, its currency).
  const activeEligibleAccounts = useMemo(
    () => (activeRequest ? accountsForRequest(paymentAccounts, activeRequest) : []),
    [activeRequest, paymentAccounts],
  );
  const activeDisburseAccount = activeRequest
    ? activeEligibleAccounts.find(a => a.id === disburseAccountId) ||
      pickDisbursementAccount(activeEligibleAccounts, activeRequest, resolveParentBankAccount)
    : null;
  const activeDisburseParent = resolveParentBankAccount(activeDisburseAccount);
  // No money operation takes an account below zero: refuse here already (the domain would).
  const activeDisburseShortfall =
    activeRequest && activeRequest.requestType !== 'income'
      ? insufficientBalanceMessage(activeDisburseAccount, activeDisburseParent, activeRequest.amount)
      : null;
  const selectActiveDisburseAccount = (accountId: string) => {
    setDisburseAccountId(accountId);
    setInlineError(null);
    const acc = activeEligibleAccounts.find(a => a.id === accountId);
    if (acc) setDisburseMethod(accountTypeToPaymentMethod(acc.type));
  };

  // Opening an action panel starts a new intent: give it a fresh idempotency key
  // (retries while the panel stays open keep reusing the same key).
  const rotateActionKey = actionGuard.rotateKey; // stable callback
  useEffect(() => {
    if (activeAction !== 'none' && activeRequest?.id) {
      rotateActionKey(`${activeAction}:${activeRequest.id}`);
    }
  }, [activeAction, activeRequest?.id, rotateActionKey]);

  const toggleAction = (action: typeof activeAction) => {
    setInlineError(null);
    setActiveAction(prev => (prev === action ? 'none' : action));
  };

  const disbursing = activeRequest ? actionGuard.isPending(`disburse:${activeRequest.id}`) : false;

  // Copy the payee's account details; the button says "copied" only when the browser
  // really wrote them, and tells the user to copy by hand when it refused.
  const handleCopyAccountDetails = async (text: string, itemId: string) => {
    if (!text) return;
    const ok = await copyTextToClipboard(text);
    setCopyState({ id: itemId, ok });
    window.setTimeout(() => setCopyState(cur => (cur && cur.id === itemId ? null : cur)), ok ? 2500 : 4500);
  };
  const copiedOk = (id: string) => copyState?.id === id && copyState.ok;
  const copyFailed = (id: string) => copyState?.id === id && !copyState.ok;

  // Approved requests currently visible in filtered results
  const approvedRequestsInFilter = useMemo(() => {
    return filteredRequests.filter(r => r.status === 'approved');
  }, [filteredRequests]);

  // Selected approved requests objects for batch payment
  const selectedBatchRequests = useMemo(() => {
    return targetRequests.filter(r => selectedApprovedIds.includes(r.id) && r.status === 'approved');
  }, [targetRequests, selectedApprovedIds]);

  const selectedBatchSum = useMemo(() => {
    return selectedBatchRequests.reduce((sum, r) => sum + r.amount, 0);
  }, [selectedBatchRequests]);

  // The batch is paid from ONE account: of the batch's company and currency, and it must
  // cover every expense in it (no account ever goes below zero).
  const batchOrgIds = new Set(selectedBatchRequests.map(r => r.orgId));
  const batchCurrencies = new Set(selectedBatchRequests.map(r => currencyCode(r.currency)));
  const batchAccounts = paymentAccounts.filter(
    a =>
      a.active !== false &&
      (batchOrgIds.size !== 1 || !a.orgId || batchOrgIds.has(a.orgId)) &&
      (batchCurrencies.size !== 1 || batchCurrencies.has(currencyCode(a.currency))),
  );
  const batchAccount = batchAccounts.find(a => a.id === batchAccountId) || batchAccounts[0] || null;
  const batchOutSum = selectedBatchRequests.filter(r => r.requestType !== 'income').reduce((sum, r) => sum + r.amount, 0);
  const batchShortfall = batchAccount
    ? insufficientBalanceMessage(batchAccount, resolveParentBankAccount(batchAccount), batchOutSum)
    : null;

  const toggleSelectApproved = (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setSelectedApprovedIds(prev => 
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const toggleSelectAllApproved = () => {
    if (approvedRequestsInFilter.length === 0) return;
    const allSelected = approvedRequestsInFilter.every(r => selectedApprovedIds.includes(r.id));
    if (allSelected) {
      const filterIds = new Set(approvedRequestsInFilter.map(r => r.id));
      setSelectedApprovedIds(prev => prev.filter(id => !filterIds.has(id)));
    } else {
      const currentSet = new Set(selectedApprovedIds);
      approvedRequestsInFilter.forEach(r => currentSet.add(r.id));
      setSelectedApprovedIds(Array.from(currentSet));
    }
  };

  // Open batch modal & prefill defaults
  const handleOpenBatchDisburseModal = () => {
    if (selectedApprovedIds.length === 0) return;
    if (!batchGuard.pending) {
      // New batch intent: new batch key (per-request keys derive from it) and a fresh reference.
      batchGuard.rotateKey();
      batchSeqRef.current = new Map();
      setBatchRefNumber(newBatchRef(batchGuard.idempotencyKey));
    }
    setIsBatchModalOpen(true);
  };

  // Execute Batch Pay (الصرف المجمع)
  const handleConfirmBatchDisburse = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedBatchRequests.length === 0) return;
    // The account shown selected is the one paid from; refuse a batch it cannot cover.
    const selectedAccount = batchAccount;
    if (!selectedAccount) {
      showToast('لا يوجد حساب خزينة نشط بعملة الطلبات المحددة. يرجى إضافة حساب أو تفعيله أولاً.', 'warning');
      return;
    }
    if (batchShortfall) {
      showToast(batchShortfall, 'error');
      return;
    }
    const batchRequests = [...selectedBatchRequests];

    await batchGuard.run(async (batchKey) => {
      // Shown to each requester on their payment advice: the account's name, never the company's account number.
      const accName = selectedAccount.name;
      const accountId = selectedAccount.id;

      let paidCount = 0;
      let skippedCount = 0;
      const doneIds = new Set<string>();
      const failures: string[] = [];

      // Process EVERY selected request; one failure must not hide the others' outcome.
      for (const req of batchRequests) {
        let seq = batchSeqRef.current.get(req.id);
        if (!seq) {
          seq = batchSeqRef.current.size + 1;
          batchSeqRef.current.set(req.id, seq);
        }
        const singleRef = `${batchRefNumber.trim()}-${seq}`;
        const methodToUse: PaymentMethod = batchPaymentMethod === 'auto'
          ? resolveRequestPaymentMethod(req)
          : batchPaymentMethod;

        try {
          const outcome = await disburseRequest(req.id, {
            paymentMethod: methodToUse,
            referenceNumber: singleRef,
            bankName: accName,
            accountId: accountId,
            accountName: selectedAccount.name,
            notes: batchNotes.trim()
              ? `${batchNotes.trim()} [دفعة مجمعة ${batchRefNumber.trim()}]`
              : `صرف دفعة مجمعة [${batchRefNumber.trim()}]`,
          }, { idempotencyKey: batchItemKey(batchKey, req.id), batchId: batchKey });

          if (outcome.changed) paidCount++;
          else skippedCount++; // already disbursed (earlier attempt / another user) — never pay again
          doneIds.add(req.id);
        } catch (err) {
          console.error('[Batch Disburse Error]', req.id, err);
          failures.push(`${req.requestNumber || req.id}: ${errorText(err, 'خطأ غير متوقع')}`);
        }
      }

      if (doneIds.size > 0) {
        setSelectedApprovedIds(prev => prev.filter(id => !doneIds.has(id)));
      }

      const summary: string[] = [];
      if (paidCount > 0) summary.push(`تم صرف ${paidCount} طلب`);
      if (skippedCount > 0) summary.push(`تم تخطي ${skippedCount} (مصروف مسبقاً)`);
      if (failures.length > 0) summary.push(`فشل ${failures.length}:\n${failures.join('\n')}`);
      if (summary.length > 0) {
        showToast(summary.join('\n'), failures.length > 0 ? 'warning' : 'success');
      }

      if (failures.length === 0) {
        batchGuard.rotateKey();
        setIsBatchModalOpen(false);
      }
    });
  };

  // Export Filtered Requests to Excel / CSV with UTF-8 BOM
  const exportRequestsToExcel = () => {
    const headers = [
      'رقم الطلب',
      'الشركة',
      'نوع العملية (صرف/توريد)',
      'بند الصرف',
      'المورد',
      'المبلغ',
      'العملة',
      'الأولوية',
      'الحالة',
      'مقدم الطلب',
      'الحساب المالي',
      'رقم المرجع',
      'تاريخ الطلب',
      'تاريخ الصرف'
    ];

    const escapeCsvCell = (cell: any) => {
      if (cell === null || cell === undefined) return '""';
      const str = String(cell).replace(/"/g, '""');
      return `"${str}"`;
    };

    const rows = filteredRequests.map(req => {
      const orgName = organizations?.find(o => o.id === req.orgId)?.name || activeOrg?.name || 'الشركة';
      const opType = req.requestType === 'income' ? 'توريد مالي' : 'صرف مالي';
      const urgencyText = req.urgency === 'high' ? 'عاجل وهام' : req.urgency === 'medium' ? 'متوسط' : 'عادي';
      const statusText = 
        req.status === 'disbursed' ? 'تم الصرف والتحويل' :
        req.status === 'approved' ? 'معتمد للصرف' :
        req.status === 'pending' ? 'قيد المراجعة' :
        req.status === 'clarification_requested' ? 'مطلوب توضيح' : 'مرفوض';

      const accountName = req.disbursement?.accountName || req.disbursement?.bankName || (
        req.targetAccountId ? paymentAccounts.find(a => a.id === req.targetAccountId)?.name : ''
      ) || '';

      // Local time (like every other screen), never the stored UTC value.
      const createdAtStr = formatLocalDateTime(req.createdAt);
      const disbursedAtStr = formatLocalDateTime(req.disbursement?.disbursedAt);

      return [
        req.requestNumber || '',
        orgName,
        opType,
        req.serviceCategoryName || '',
        req.providerName || '',
        req.amount,
        req.currency || 'EGP',
        urgencyText,
        statusText,
        req.requesterName || '',
        accountName,
        req.disbursement?.referenceNumber || '',
        createdAtStr,
        disbursedAtStr
      ].map(escapeCsvCell).join(',');
    });

    const csvContent = '\uFEFF' + [headers.map(escapeCsvCell).join(','), ...rows].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `طلبات_المصروفات_${localToday()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Inline Action Handlers
  const handleApprove = async () => {
    if (!activeRequest) return;
    const requestId = activeRequest.id;
    const scope = `approve:${requestId}`;
    await actionGuard.run(scope, async (idempotencyKey) => {
      try {
        await approveRequest(requestId, approvalNote.trim() || undefined, { idempotencyKey });
        actionGuard.rotateKey(scope);
        setApprovalNote('');
        setActiveAction('none');
      } catch (err) {
        console.error('[Approve Error]', err);
        showToast(errorText(err, 'حدث خطأ أثناء اعتماد الطلب.'), 'error');
      }
    });
  };

  const handleReject = async () => {
    if (!activeRequest) return;
    if (!rejectionReason.trim()) {
      setInlineError('يرجى كتابة سبب الرفض ليصل للموظف.');
      return;
    }
    const requestId = activeRequest.id;
    const scope = `reject:${requestId}`;
    await actionGuard.run(scope, async (idempotencyKey) => {
      try {
        await rejectRequest(requestId, rejectionReason.trim(), { idempotencyKey });
        actionGuard.rotateKey(scope);
        setRejectionReason('');
        setActiveAction('none');
      } catch (err) {
        console.error('[Reject Error]', err);
        showToast(errorText(err, 'حدث خطأ أثناء رفض الطلب.'), 'error');
      }
    });
  };

  const handleClarify = async () => {
    if (!activeRequest) return;
    if (!clarificationQuestion.trim()) {
      setInlineError('يرجى كتابة سؤال الاستيضاح أو المستندات المطلوبة من الموظف.');
      return;
    }
    const requestId = activeRequest.id;
    const scope = `clarify:${requestId}`;
    await actionGuard.run(scope, async (idempotencyKey) => {
      try {
        await requestClarification(requestId, clarificationQuestion.trim(), { idempotencyKey });
        actionGuard.rotateKey(scope);
        setClarificationQuestion('');
        setActiveAction('none');
      } catch (err) {
        console.error('[Clarification Error]', err);
        showToast(errorText(err, 'حدث خطأ أثناء إرسال الاستفسار.'), 'error');
      }
    });
  };

  const handleDisburse = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeRequest) return;
    if (!disburseRefNumber.trim()) {
      setInlineError('يرجى إدخال رقم المرجع / العملية.');
      return;
    }
    // The account shown selected in the form is the one used (never a different fallback).
    const selectedAccount = activeDisburseAccount;
    if (!selectedAccount) {
      setInlineError(`لا يوجد حساب خزينة نشط بعملة الطلب (${currencyCode(activeRequest.currency)}) في هذه الشركة. يرجى إضافة حساب أو تفعيله أولاً.`);
      return;
    }
    if (activeDisburseShortfall) {
      setInlineError(activeDisburseShortfall);
      return;
    }
    setInlineError(null);

    const requestId = activeRequest.id;
    const scope = `disburse:${requestId}`;
    await actionGuard.run(scope, async (idempotencyKey) => {
      try {
        const outcome = await disburseRequest(requestId, {
          paymentMethod: disburseMethod,
          referenceNumber: disburseRefNumber.trim(),
          bankName: selectedAccount.name, // the requester's payment advice shows it: no company account number
          accountId: selectedAccount.id,
          accountName: selectedAccount.name,
          notes: disburseNotes.trim() || undefined,
        }, { idempotencyKey });
        actionGuard.rotateKey(scope);
        setActiveAction('none');
        setDisburseNotes('');
        if (!outcome.changed) {
          showToast('تم صرف هذا الطلب مسبقاً، ولم يتم تنفيذ أي صرف إضافي.', 'info');
        }
      } catch (err) {
        console.error('[Disbursement Error]', err);
        showToast(errorText(err, 'حدث خطأ أثناء تنفيذ الصرف.'), 'error');
      }
    });
  };

  // Account field of the disbursement / receipt forms: only the accounts the request can
  // use (its company, active, its currency), the linked-bank note of an InstaPay channel,
  // and the refusal when the account cannot cover an expense.
  const renderDisburseAccountField = (req: ExpenseRequest) => {
    const isIncomeReq = req.requestType === 'income';
    return (
      <div>
        <label className="block font-bold text-slate-700 mb-1">
          {isIncomeReq ? 'خزينة / حساب الاستلام المودع فيه (+ IN) *' : 'خزينة / حساب الصرف المحول منه (- OUT) *'}
        </label>
        {activeEligibleAccounts.length === 0 ? (
          <div role="alert" className="p-2.5 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-[11px] font-bold">
            لا يوجد حساب خزينة نشط بعملة الطلب ({currencyCode(req.currency)}) في هذه الشركة. يرجى إضافة حساب أو تفعيله من شاشة الخزينة أولاً.
          </div>
        ) : (
          <select
            value={activeDisburseAccount?.id || ''}
            onChange={(e) => selectActiveDisburseAccount(e.target.value)}
            className={`w-full p-2.5 bg-slate-50 border rounded-xl font-bold ${!isIncomeReq && activeDisburseShortfall ? 'border-rose-400' : 'border-slate-200'}`}
          >
            {activeEligibleAccounts.map(acc => (
              <option key={acc.id} value={acc.id}>
                {acc.name} — {accountTypeLabel(acc.type)} ({acc.accountIdentifier}) — الرصيد: {fmtMoney(accountBalance(acc))} {currencyCode(acc.currency)}
              </option>
            ))}
          </select>
        )}
        {activeDisburseAccount && activeDisburseParent && (
          <div className="mt-2 p-2.5 bg-blue-50 border border-blue-200 rounded-xl text-blue-900 text-xs flex items-start gap-2">
            <Landmark className="h-4 w-4 text-blue-600 shrink-0 mt-0.5" />
            <div>
              <span className="font-bold block">{isIncomeReq ? 'إيداع بنكي مزدوج تلقائي:' : 'خصم بنكي مزدوج تلقائي:'}</span>
              <span className="text-[11px] text-blue-800 leading-relaxed">
                {isIncomeReq
                  ? <>حساب ({activeDisburseAccount.name}) مربوط بالحساب البنكي (<strong>{activeDisburseParent.name}</strong>). سيتم إضافة التوريد تلقائياً في هذا الحساب وفي الحساب البنكي الرئيسي معاً.</>
                  : <>حساب ({activeDisburseAccount.name}) مربوط بالحساب البنكي (<strong>{activeDisburseParent.name}</strong> — رصيده {fmtMoney(accountBalance(activeDisburseParent))} {currencyCode(activeDisburseParent.currency)}). سيتم خصم مبلغ الصرف تلقائياً من هذا الحساب ومن الحساب البنكي معاً، ويجب أن يكفي رصيد الاثنين.</>}
              </span>
            </div>
          </div>
        )}
        {!isIncomeReq && activeDisburseShortfall && (
          <div role="alert" className="mt-2 p-2.5 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-[11px] font-bold flex items-start gap-1.5">
            <AlertCircle className="h-3.5 w-3.5 text-rose-600 shrink-0 mt-0.5" />
            <span>{activeDisburseShortfall}</span>
          </div>
        )}
      </div>
    );
  };

  // Esc closes the list's own pop-ups (the QR code, the batch window when not paying).
  useEscapeToClose(Boolean(qrModalRequest), () => setQrModalRequest(null));
  useEscapeToClose(isBatchModalOpen, () => {
    if (!batchGuard.pending) setIsBatchModalOpen(false);
  });

  // Financial KPIs Calculations
  const totalAmount = targetRequests.reduce((sum, r) => sum + r.amount, 0);
  const totalDisbursed = targetRequests
    .filter(r => r.status === 'disbursed')
    .reduce((sum, r) => sum + r.amount, 0);
  const totalApproved = targetRequests
    .filter(r => r.status === 'approved')
    .reduce((sum, r) => sum + r.amount, 0);
  const totalPending = targetRequests
    .filter(r => r.status === 'pending' || r.status === 'clarification_requested')
    .reduce((sum, r) => sum + r.amount, 0);

  const approvedToDisburseCount = targetRequests.filter(r => r.status === 'approved').length;
  const currency = activeOrg?.currency || targetRequests[0]?.currency || 'EGP';

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

  // The payout method badge: the same resolved method (and label) as the method filter,
  // the detail window and the edit form, also for older records that have none stored.
  const getMethodBadge = (req: ExpenseRequest) => {
    const method = resolveRequestPaymentMethod(req);
    const label = paymentMethodLabel(method);
    if (method === 'instapay') {
      return (
        <span className="inline-flex items-center gap-1 text-[11px] font-bold text-teal-700 bg-teal-50 px-2 py-0.5 rounded-md border border-teal-200">
          <Smartphone className="h-3 w-3" />
          <span>{label}</span>
        </span>
      );
    }
    if (method === 'digital_wallet') {
      return (
        <span className="inline-flex items-center gap-1 text-[11px] font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-md border border-indigo-200">
          <Smartphone className="h-3 w-3" />
          <span>{label}</span>
        </span>
      );
    }
    if (method === 'cash' || method === 'cheque') {
      return (
        <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-md border border-amber-200">
          <CreditCard className="h-3 w-3" />
          <span>{label}</span>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-700 bg-slate-100 px-2 py-0.5 rounded-md border border-slate-200">
        <Building className="h-3 w-3" />
        <span>{label}</span>
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

          <div className="flex items-center gap-2.5 flex-wrap self-start md:self-auto shrink-0">
            <button
              type="button"
              onClick={exportRequestsToExcel}
              className="flex items-center gap-2 bg-white/10 hover:bg-white/20 text-white font-bold text-xs sm:text-sm px-4 py-3.5 rounded-2xl shadow-md border border-white/15 transition cursor-pointer active:scale-98"
              title="تصدير النتائج المفلترة الحالية إلى ملف Excel / CSV"
            >
              <Download className="h-4 w-4 text-emerald-400" />
              <span>تصدير إلى Excel</span>
            </button>

            <button
              type="button"
              onClick={onOpenNewRequest}
              className="flex items-center gap-2 bg-gradient-to-r from-emerald-500 to-teal-400 hover:from-emerald-400 hover:to-teal-300 text-slate-950 font-black text-sm px-6 py-3.5 rounded-2xl shadow-xl shadow-emerald-500/20 transition cursor-pointer active:scale-98"
            >
              <Plus className="h-5 w-5 stroke-[2.5]" />
              <span>إنشاء طلب صرف جديد</span>
            </button>
          </div>
        </div>

        {/* 4 Financial KPI Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-6 pt-6 border-t border-slate-800/80">
          <div className="bg-slate-950/60 backdrop-blur-md p-4 rounded-2xl border border-slate-800">
            <span className="text-[11px] text-slate-400 block mb-1">إجمالي المبالغ المنصرفة</span>
            <div className="flex items-baseline gap-1.5 text-lg sm:text-xl font-black text-emerald-400">
              <span>{fmtMoney(totalDisbursed)}</span>
              <span className="text-xs text-slate-400 font-semibold">{currency}</span>
            </div>
          </div>

          <div className="bg-slate-950/60 backdrop-blur-md p-4 rounded-2xl border border-slate-800">
            <span className="text-[11px] text-slate-400 block mb-1">مبالغ معتمدة بانتظار الصرف</span>
            <div className="flex items-baseline gap-1.5 text-lg sm:text-xl font-black text-blue-400">
              <span>{fmtMoney(totalApproved)}</span>
              <span className="text-xs text-slate-400 font-semibold">{currency}</span>
            </div>
          </div>

          <div className="bg-slate-950/60 backdrop-blur-md p-4 rounded-2xl border border-slate-800">
            <span className="text-[11px] text-slate-400 block mb-1">مبالغ قيد فحص الإدارة</span>
            <div className="flex items-baseline gap-1.5 text-lg sm:text-xl font-black text-amber-400">
              <span>{fmtMoney(totalPending)}</span>
              <span className="text-xs text-slate-400 font-semibold">{currency}</span>
            </div>
          </div>

          <div className="bg-slate-950/60 backdrop-blur-md p-4 rounded-2xl border border-slate-800">
            <span className="text-[11px] text-slate-400 block mb-1">إجمالي المطالبات المسجلة</span>
            <div className="flex items-baseline gap-1.5 text-lg sm:text-xl font-black text-white">
              <span>{targetRequests.length}</span>
              <span className="text-xs text-slate-400 font-semibold">طلب ({fmtMoney(totalAmount)} {currency})</span>
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

              {/* Requester Dropdown */}
              <div>
                <label className="block text-[11px] font-bold text-slate-500 mb-1">الموظف / مقدم الطلب:</label>
                <select
                  value={requesterFilter}
                  onChange={(e) => setRequesterFilter(e.target.value)}
                  className="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl outline-none font-semibold text-slate-800"
                >
                  <option value="all">كافة الموظفين</option>
                  {uniqueRequesters.map(name => (
                    <option key={name} value={name}>{name}</option>
                  ))}
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
                  <option value="specific">📅 تاريخ محدد (اختر يوماً)</option>
                </select>
                {datePeriodFilter === 'specific' && (
                  <div className="mt-1.5">
                    <input
                      type="date"
                      value={specificDateFilter}
                      onChange={(e) => setSpecificDateFilter(e.target.value)}
                      className="w-full p-2 bg-indigo-50/50 border border-indigo-200 rounded-xl text-xs font-bold text-indigo-900 outline-none focus:ring-2 focus:ring-indigo-500/20"
                    />
                  </div>
                )}
              </div>
            </div>

            {/* Results count & reset filters */}
            <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-xs text-slate-500">
              <div className="flex items-center gap-2">
                <span>النتائج المعروضة: <strong>{filteredRequests.length}</strong> طلب</span>
                <button
                  type="button"
                  onClick={exportRequestsToExcel}
                  className="inline-flex items-center gap-1 text-[11px] text-emerald-700 hover:text-emerald-900 font-bold bg-emerald-50 px-2 py-0.5 rounded-md hover:bg-emerald-100 transition cursor-pointer"
                  title="تصدير نتائج البحث والفلترة الحالية إلى ملف Excel (CSV)"
                >
                  <FileSpreadsheet className="h-3 w-3" />
                  <span>تصدير Excel</span>
                </button>
              </div>
              {(statusFilter !== 'all' || categoryFilter !== 'all' || providerFilter !== 'all' || departmentFilter !== 'all' || requesterFilter !== 'all' || urgencyFilter !== 'all' || paymentMethodFilter !== 'all' || datePeriodFilter !== 'all' || specificDateFilter || search) && (
                <button
                  type="button"
                  onClick={() => {
                    setStatusFilter('all');
                    setCategoryFilter('all');
                    setProviderFilter('all');
                    setDepartmentFilter('all');
                    setRequesterFilter('all');
                    setUrgencyFilter('all');
                    setPaymentMethodFilter('all');
                    setDatePeriodFilter('all');
                    setSpecificDateFilter('');
                    setSearch('');
                  }}
                  className="text-indigo-600 hover:text-indigo-800 font-bold cursor-pointer"
                >
                  إعادة ضبط الفلاتر ↺
                </button>
              )}
            </div>

          </div>

          {/* Select All Approved for Batch Payment Toggle */}
          {canDisburse && approvedRequestsInFilter.length > 0 && (
            <div className="flex items-center justify-between px-3.5 py-2.5 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200/80 rounded-2xl text-xs shadow-2xs">
              <label className="flex items-center gap-2 cursor-pointer font-bold text-blue-950 select-none">
                <input
                  type="checkbox"
                  checked={approvedRequestsInFilter.length > 0 && approvedRequestsInFilter.every(r => selectedApprovedIds.includes(r.id))}
                  onChange={toggleSelectAllApproved}
                  className="h-4 w-4 rounded border-blue-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer accent-indigo-600"
                />
                <span>تحديد جميع الطلبات المعتمدة للصرف ({approvedRequestsInFilter.length})</span>
              </label>
              {selectedApprovedIds.length > 0 && (
                <span className="text-[11px] font-black text-indigo-700 bg-white/90 px-2.5 py-0.5 rounded-lg border border-indigo-200">
                  تم تحديد: {selectedApprovedIds.length} طلب
                </span>
              )}
            </div>
          )}

          {/* Cards List */}
          <div className="space-y-3">
            {visibleRequests.map((req) => {
              const isSelected = activeRequest?.id === req.id;
              const hasClarification = req.status === 'clarification_requested';
              const isApproved = req.status === 'approved';
              const isBatchSelected = selectedApprovedIds.includes(req.id);

              return (
                <div
                  key={req.id}
                  onClick={() => setSelectedReqId(req.id)}
                  className={`p-4 rounded-2xl border transition cursor-pointer relative ${
                    isSelected
                      ? 'bg-indigo-50/50 border-indigo-500 ring-2 ring-indigo-500/20 shadow-md'
                      : isBatchSelected
                      ? 'bg-indigo-50/40 border-indigo-300 ring-1 ring-indigo-300 shadow-xs'
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
                      {/* Batch Checkbox for Approved Requests (only for who can disburse) */}
                      {isApproved && canDisburse && (
                        <div 
                          className="flex items-center mr-0.5"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input
                            type="checkbox"
                            checked={isBatchSelected}
                            onChange={(e) => toggleSelectApproved(req.id, e as any)}
                            title="تحديد للصرف المجمع"
                            className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer accent-indigo-600"
                          />
                        </div>
                      )}
                      <span className="font-mono text-xs font-bold text-slate-500">{req.requestNumber}</span>
                      {req.requestType === 'income' ? (
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-black bg-emerald-100 text-emerald-800 border border-emerald-300 flex items-center gap-1">
                          <ArrowDownLeft className="h-3 w-3 text-emerald-600" />
                          <span>توريد (+ IN)</span>
                        </span>
                      ) : (
                        getUrgencyBadge(req.urgency)
                      )}
                      {req.isPrepaidByRequester && (
                        <span className="px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-300 flex items-center gap-0.5" title="تم السداد المسبق شخصياً من جيب الموظف (استرداد شخصي)">
                          <Receipt className="h-2.5 w-2.5 text-amber-700" />
                          <span>سداد مسبق</span>
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5">
                      {(() => {
                        const canEditReq = (req.status === 'pending' || req.status === 'clarification_requested') &&
                          (currentUser.id === req.requesterId || currentUser.email === req.requesterEmail || isSuperAdmin || currentRole === 'org_admin');
                        if (canEditReq) {
                          return (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (onEditRequest) onEditRequest(req);
                                else setEditingRequest(req);
                              }}
                              title="يمكنك تعديل بيانات الطلب طالما لم يتم اعتماده بعد"
                              className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-300 rounded-md text-[11px] font-bold transition cursor-pointer active:scale-95 shadow-2xs"
                            >
                              <Pencil className="h-3 w-3 text-amber-600" />
                              <span>تعديل</span>
                            </button>
                          );
                        }
                        if (req.status === 'approved' || req.status === 'disbursed') {
                          return (
                            <span
                              title="لا يمكن تعديل الطلب بعد اعتماده أو صرفه"
                              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] text-slate-400 cursor-help"
                            >
                              🔒 معتمد
                            </span>
                          );
                        }
                        return null;
                      })()}
                      {getStatusBadge(req.status)}
                    </div>
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
                    <span className="text-[11px] text-slate-400">{formatLocalDate(req.createdAt)}</span>
                  </div>

                  <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-100 text-xs">
                    <div className="flex items-center gap-1.5">
                      {getMethodBadge(req)}
                      {req.paymentAccountDetails && (
                        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            onClick={() => handleCopyAccountDetails(req.paymentAccountDetails!, req.id)}
                            className="p-1 hover:bg-slate-100 text-slate-400 hover:text-emerald-700 rounded-lg transition"
                            title={copiedOk(req.id) ? 'تم النسخ بنجاح ✓' : copyFailed(req.id) ? 'تعذر النسخ، انسخ البيانات يدوياً' : 'نسخ بيانات الحساب'}
                          >
                            {copiedOk(req.id) ? (
                              <span className="text-[10px] text-emerald-600 font-bold">تم النسخ ✓</span>
                            ) : copyFailed(req.id) ? (
                              <span className="text-[10px] text-rose-600 font-bold">تعذر النسخ</span>
                            ) : (
                              <Copy className="h-3.5 w-3.5" />
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => setQrModalRequest(req)}
                            className="p-1 hover:bg-slate-100 text-slate-400 hover:text-indigo-700 rounded-lg transition"
                            title="رمز QR للدفع"
                          >
                            <QrCode className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      {req.requestType === 'income' && req.status === 'pending' && canDisburse && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDisburseRefNumber(`IN-${Math.floor(100000 + Math.random() * 900000)}`);
                            setInlineError(null);
                            if (activeRequest?.id === req.id) {
                              setActiveAction('disburse');
                            } else {
                              openAfterSelectRef.current = 'disburse';
                              setSelectedReqId(req.id);
                            }
                          }}
                          className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-[10px] rounded-lg shadow-2xs flex items-center gap-1 transition cursor-pointer active:scale-95"
                          title="تأكيد الاستلام والتوريد في الخزينة"
                        >
                          <CheckCircle2 className="h-3 w-3" />
                          <span>تم الاستلام</span>
                        </button>
                      )}
                      <span className={`font-black text-sm ${req.requestType === 'income' ? 'text-emerald-700' : 'text-slate-900'}`}>
                        {req.requestType === 'income' ? '+' : '-'}{fmtMoney(req.amount)} {req.currency}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}

            {visibleCount < filteredRequests.length && (
              <div className="pt-2 text-center">
                <button
                  type="button"
                  onClick={() => setVisibleCount(prev => prev + 35)}
                  className="w-full py-3 bg-white hover:bg-slate-50 text-slate-700 font-bold text-xs rounded-2xl border border-slate-200 shadow-2xs transition flex items-center justify-center gap-2 cursor-pointer active:scale-98"
                >
                  <span>عرض المزيد من الطلبات (المتبقي: {filteredRequests.length - visibleCount} طلب)</span>
                  <ChevronDown className="h-4 w-4 text-slate-400" />
                </button>
              </div>
            )}

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
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 pb-4 border-b border-slate-100">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-xs font-bold text-slate-500">{activeRequest.requestNumber}</span>
                    <span className="text-xs text-slate-400">• تاريخ التقديم: {formatLocalDate(activeRequest.createdAt)}</span>
                    {getUrgencyBadge(activeRequest.urgency)}
                  </div>
                  <h2 className="text-lg font-black text-slate-900 mt-1 break-words">{activeRequest.title}</h2>
                  <div className="text-xs text-slate-500 mt-1 flex items-center gap-x-2 gap-y-0.5 flex-wrap">
                    <span>مقدم الطلب: <strong className="text-slate-800">{activeRequest.requesterName}</strong></span>
                    {activeRequest.requesterDepartment && <span>• القسم: <strong>{activeRequest.requesterDepartment}</strong></span>}
                    {activeRequest.requesterEmail && <span className="font-mono text-[11px] text-slate-400">({activeRequest.requesterEmail})</span>}
                  </div>
                </div>

                <div className="text-left min-w-0 sm:max-w-[55%]">
                  <div className="text-2xl font-black text-slate-900 whitespace-nowrap">
                    {fmtMoney(activeRequest.amount)} <span className="text-sm font-semibold text-slate-500">{activeRequest.currency}</span>
                  </div>
                  <div className="mt-1 flex items-center justify-end gap-2 flex-wrap">
                    {canEditActive ? (
                      <button
                        type="button"
                        onClick={() => {
                          if (onEditRequest) onEditRequest(activeRequest);
                          else setEditingRequest(activeRequest);
                        }}
                        title="يمكنك تعديل بيانات الطلب طالما لم يتم اعتماده بعد"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-xs font-bold shadow-xs transition cursor-pointer active:scale-95"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        <span>✏️ تعديل الطلب</span>
                      </button>
                    ) : (activeRequest.status === 'approved' || activeRequest.status === 'disbursed') ? (
                      <span
                        title="لا يمكن تعديل الطلب بعد اعتماده أو صرفه"
                        className="inline-flex items-center gap-1 px-2.5 py-1 bg-slate-100 text-slate-500 rounded-xl text-xs font-medium cursor-help"
                      >
                        🔒 لا يمكن تعديل الطلب بعد اعتماده أو صرفه
                      </span>
                    ) : null}
                    {getStatusBadge(activeRequest.status)}
                  </div>
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
                          : activeRequest.status === 'rejected'
                          ? 'bg-slate-400 text-white'
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
                         activeRequest.status === 'pending' ? 'جاري الفحص' : 'تمت المراجعة'}
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

              {/* Bank Account & InstaPay Transfer Box (With 1-Click Copy & Instant QR Modal) */}
              <div className="bg-emerald-50/70 border border-emerald-200 rounded-2xl p-4 sm:p-5 space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2 font-black text-emerald-950 text-xs">
                    <CreditCard className="h-4 w-4 text-emerald-700" />
                    <span>بيانات المستفيد للتحويل البنكي والصرف (Recipient Payment Data)</span>
                  </div>
                  {activeRequest.paymentAccountDetails && (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleCopyAccountDetails(activeRequest.paymentAccountDetails!, activeRequest.id)}
                        className="flex items-center gap-1.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-3 py-1.5 rounded-xl transition cursor-pointer shadow-xs active:scale-95 relative"
                      >
                        {copiedOk(activeRequest.id) ? (
                          <>
                            <Check className="h-3.5 w-3.5 stroke-[3]" />
                            <span className="animate-pulse">تم النسخ بنجاح ✓</span>
                          </>
                        ) : copyFailed(activeRequest.id) ? (
                          <>
                            <AlertCircle className="h-3.5 w-3.5" />
                            <span>تعذر النسخ — انسخ يدوياً</span>
                          </>
                        ) : (
                          <>
                            <Copy className="h-3.5 w-3.5" />
                            <span>نسخ بيانات التحويل</span>
                          </>
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() => setQrModalRequest(activeRequest)}
                        className="flex items-center gap-1.5 text-xs bg-slate-900 hover:bg-slate-800 text-white font-bold px-3 py-1.5 rounded-xl transition cursor-pointer shadow-xs active:scale-95"
                      >
                        <QrCode className="h-3.5 w-3.5 text-emerald-400" />
                        <span>توليد كود الدفع (QR)</span>
                      </button>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                  <div className="bg-white p-3 rounded-xl border border-emerald-100">
                    <span className="text-slate-400 block mb-0.5">وسيلة الدفع المطلوبة:</span>
                    <span className="font-bold text-slate-900">
                      {getMethodBadge(activeRequest)}
                    </span>
                    {activeRequest.beneficiaryName && (
                      <div className="mt-2">
                        <span className="text-slate-400 block mb-0.5">اسم المستفيد (للمطابقة):</span>
                        <span className="font-bold text-emerald-900 break-words">{activeRequest.beneficiaryName}</span>
                      </div>
                    )}
                  </div>

                  <div className="bg-white p-3 rounded-xl border border-emerald-100 sm:col-span-2">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-slate-400 block">
                        {activeRequestMethod === 'instapay' ? 'عنوان انستاباي / رقم الهاتف:' :
                         activeRequestMethod === 'digital_wallet' ? 'رقم المحفظة الإلكترونية:' :
                         activeRequestMethod === 'bank_transfer' ? 'رقم الآيبان (IBAN) / الحساب:' : 'جهة الاستلام:'}
                      </span>
                      {activeRequest.paymentAccountDetails && (
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleCopyAccountDetails(activeRequest.paymentAccountDetails!, activeRequest.id)}
                            className="inline-flex items-center gap-1 text-[11px] text-emerald-700 hover:text-emerald-900 font-bold bg-emerald-50 hover:bg-emerald-100 px-2 py-0.5 rounded-md transition cursor-pointer"
                          >
                            <Copy className="h-3 w-3" />
                            <span>{copiedOk(activeRequest.id) ? 'تم النسخ ✓' : copyFailed(activeRequest.id) ? 'تعذر النسخ' : 'نسخ سريع'}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setQrModalRequest(activeRequest)}
                            className="inline-flex items-center gap-1 text-[11px] text-slate-700 hover:text-slate-900 font-bold bg-slate-100 hover:bg-slate-200 px-2 py-0.5 rounded-md transition cursor-pointer"
                          >
                            <QrCode className="h-3 w-3 text-indigo-600" />
                            <span>كود QR</span>
                          </button>
                        </div>
                      )}
                    </div>
                    <span className="font-mono font-black text-emerald-900 text-xs sm:text-sm select-all break-all">
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

              {/* Invoice & Personal Prepayment Details Card */}
              {(activeRequest.isPrepaidByRequester || activeRequest.invoiceNumber || activeRequest.invoiceDate || activeRequest.invoiceAttachment) && (
                <div className="bg-gradient-to-br from-amber-50/70 via-orange-50/20 to-white border-2 border-amber-200 rounded-2xl p-4 sm:p-5 text-xs space-y-3 shadow-2xs">
                  <div className="flex items-center justify-between border-b border-amber-100 pb-2">
                    <div className="flex items-center gap-2 font-black text-amber-950 text-xs">
                      <Receipt className="h-4 w-4 text-amber-600" />
                      <span>بيانات الفاتورة وإثبات السداد المسبق</span>
                    </div>
                    {activeRequest.isPrepaidByRequester && (
                      <span className="px-2.5 py-1 rounded-full bg-amber-100 text-amber-900 border border-amber-300 font-bold text-[11px] flex items-center gap-1">
                        <Check className="h-3 w-3 text-amber-700" />
                        <span>مسدد مسبقاً من جيب الموظف (استرداد شخصي)</span>
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {activeRequest.invoiceNumber && (
                      <div className="bg-white p-3 rounded-xl border border-amber-100">
                        <span className="text-slate-400 block mb-0.5">رقم الفاتورة / الإيصال:</span>
                        <span className="font-mono font-bold text-slate-800">{activeRequest.invoiceNumber}</span>
                      </div>
                    )}
                    {activeRequest.invoiceDate && (
                      <div className="bg-white p-3 rounded-xl border border-amber-100">
                        <span className="text-slate-400 block mb-0.5">تاريخ الفاتورة:</span>
                        <span className="font-bold text-slate-800">{activeRequest.invoiceDate}</span>
                      </div>
                    )}
                  </div>

                  {activeRequest.invoiceAttachment && (
                    <div className="bg-white p-3 rounded-xl border border-amber-200 flex items-center justify-between flex-wrap gap-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        {activeRequest.invoiceAttachment.url && (activeRequest.invoiceAttachment.type === 'png' || activeRequest.invoiceAttachment.type === 'jpg' || activeRequest.invoiceAttachment.type?.startsWith('image/')) ? (
                          <button
                            type="button"
                            onClick={() => setPreviewInvoice({
                              url: activeRequest.invoiceAttachment!.url,
                              name: activeRequest.invoiceAttachment!.name,
                              size: activeRequest.invoiceAttachment!.size,
                              type: activeRequest.invoiceAttachment!.type
                            })}
                            className="cursor-pointer group shrink-0"
                            title="معاينة الفاتورة"
                          >
                            <AttachmentImage
                              url={activeRequest.invoiceAttachment.url}
                              alt="فاتورة"
                              className="w-10 h-10 rounded-lg object-cover border border-amber-200 shadow-2xs group-hover:scale-105 group-hover:border-amber-400 transition" 
                            />
                          </button>
                        ) : (
                          <div className="w-10 h-10 rounded-lg bg-amber-100 text-amber-800 flex items-center justify-center font-bold text-xs shrink-0 border border-amber-200">
                            PDF
                          </div>
                        )}
                        <div className="min-w-0">
                          <div className="font-bold text-slate-800 text-xs truncate max-w-xs">{activeRequest.invoiceAttachment.name}</div>
                          <div className="text-[10px] text-slate-400">
                            {activeRequest.invoiceAttachment.size} • {activeRequest.invoiceAttachment.type?.toUpperCase()}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {activeRequest.invoiceAttachment.url && (
                          <button
                            type="button"
                            onClick={() => setPreviewInvoice({
                              url: activeRequest.invoiceAttachment!.url,
                              name: activeRequest.invoiceAttachment!.name,
                              size: activeRequest.invoiceAttachment!.size,
                              type: activeRequest.invoiceAttachment!.type
                            })}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-bold text-xs shadow-2xs transition cursor-pointer"
                          >
                            <Eye className="h-3.5 w-3.5" />
                            <span>معاينة وتكبير الفاتورة</span>
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Also render any other authentic attachments in activeRequest */}
                  {(() => {
                    const realAttachments = (activeRequest.attachments || []).filter(att => 
                      att && att.name && 
                      (!activeRequest.invoiceAttachment || att.id !== activeRequest.invoiceAttachment.id) &&
                      !String(att.name).includes('فاتورة_عرض_سعر') && 
                      String(att.name).trim() !== 'fdvbgfbgfb' &&
                      String(att.name).trim().length > 0
                    );
                    if (realAttachments.length === 0) return null;
                    return (
                      <div className="pt-2">
                        <div className="text-[11px] font-bold text-slate-600 mb-1.5">مرفقات ومستندات أخرى ({realAttachments.length}):</div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {realAttachments.map((att) => (
                            <div 
                              key={att.id} 
                              className={`flex items-center justify-between p-2 bg-white border border-slate-200 rounded-lg text-xs transition ${
                                att.url ? 'hover:border-emerald-300 hover:bg-emerald-50/30 cursor-pointer' : ''
                              }`}
                              onClick={() => {
                                if (att.url) {
                                  setPreviewInvoice({
                                    url: att.url,
                                    name: att.name,
                                    size: att.size,
                                    type: att.type,
                                  });
                                }
                              }}
                            >
                              <div className="flex items-center gap-2 truncate min-w-0">
                                <FileText className="h-4 w-4 text-emerald-600 shrink-0" />
                                <span className="font-medium text-slate-800 truncate" title={att.name}>{att.name}</span>
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                <span className="text-slate-400 text-[10px]">{att.size}</span>
                                {att.url && (
                                  <Eye className="h-3.5 w-3.5 text-emerald-600" />
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* Rejection reason (the side panel shows it too, not only the detail window) */}
              {activeRequest.status === 'rejected' && (
                <div className="bg-rose-50 border border-rose-200 rounded-2xl p-4 text-xs text-rose-900">
                  <div className="flex items-center gap-2 font-bold mb-1">
                    <XCircle className="h-4 w-4 text-rose-600" />
                    <span>تم رفض هذا الطلب</span>
                  </div>
                  <p className="leading-relaxed">
                    <span className="font-semibold">سبب الرفض: </span>
                    {activeRequest.rejectionReason || 'لم يُذكر سبب.'}
                  </p>
                </div>
              )}

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
                        {activeRequest.requestType === 'income'
                          ? incomeMethodLabel(activeRequest.disbursement.paymentMethod)
                          : paymentMethodLabel(activeRequest.disbursement.paymentMethod)}
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
                        {formatLocalDateTime(activeRequest.disbursement.disbursedAt)}
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
                
                {/* 1. Under review: each action only for the roles the domain accepts (permissions.ts) */}
                {(activeRequest.status === 'pending' || activeRequest.status === 'clarification_requested') && (
                  activeRequest.requestType === 'income' ? (
                    (canDisburse || canReject) && (
                    <div className="p-5 bg-gradient-to-r from-emerald-50 via-teal-50/60 to-white rounded-2xl border-2 border-emerald-300 shadow-xs space-y-4 animate-in fade-in duration-150">
                      <div className="flex items-center justify-between flex-wrap gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="p-1.5 bg-emerald-600 text-white rounded-lg">
                              <ArrowDownLeft className="h-4 w-4" />
                            </span>
                            <span className="font-black text-emerald-950 text-sm">
                              طلب توريد وتحصيل مالي (+ IN) بانتظار تأكيد الاستلام
                            </span>
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-100 text-emerald-800 border border-emerald-300">
                              تحت المراجعة والاستلام
                            </span>
                          </div>
                          <p className="text-xs text-emerald-800 mt-1 break-words">
                            المبلغ: <strong className="text-emerald-950 font-black">+{fmtMoney(activeRequest.amount)} {activeRequest.currency}</strong> | طريقة التوريد: <strong>{incomeMethodLabel(activeRequestMethod)}</strong> {activeRequest.paymentAccountDetails ? `| المودع: ${activeRequest.paymentAccountDetails}` : ''}
                          </p>
                        </div>

                        <div className="flex items-center gap-2 flex-wrap">
                          {canDisburse && (
                            <button
                              type="button"
                              onClick={() => {
                                if (activeAction !== 'disburse') {
                                  setDisburseRefNumber(`IN-${Math.floor(100000 + Math.random() * 900000)}`);
                                }
                                toggleAction('disburse');
                              }}
                              className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs rounded-xl shadow-md flex items-center gap-2 transition cursor-pointer active:scale-95"
                            >
                              <CheckCircle2 className="h-4 w-4" />
                              <span>📥 تأكيد الاستلام والتوريد في الخزينة (تم الاستلام)</span>
                            </button>
                          )}

                          {canReject && (
                            <button
                              type="button"
                              onClick={() => toggleAction('reject')}
                              className="px-3.5 py-2.5 bg-rose-100 hover:bg-rose-200 text-rose-800 font-bold text-xs rounded-xl transition cursor-pointer flex items-center gap-1.5"
                            >
                              <XCircle className="h-4 w-4" />
                              <span>رفض التوريد ✕</span>
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Disburse Drawer for Income Receipt Confirmation */}
                      {activeAction === 'disburse' && canDisburse && (
                        <form onSubmit={handleDisburse} className="mt-4 p-4 bg-white rounded-2xl border-2 border-emerald-300 space-y-4 animate-in fade-in duration-150">
                          <div className="flex items-center justify-between pb-2 border-emerald-100 border-b">
                            <span className="font-bold text-emerald-950 text-xs flex items-center gap-1.5">
                              <Landmark className="h-4 w-4 text-emerald-600" />
                              <span>تأكيد استلام المبلغ وإضافته لرصيد كارت الخزينة:</span>
                            </span>
                            <button
                              type="button"
                              onClick={() => setActiveAction('none')}
                              aria-label="إغلاق"
                              className="text-slate-400 hover:text-slate-600 p-1 cursor-pointer"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                            {renderDisburseAccountField(activeRequest)}

                            <div>
                              <label className="block font-bold text-slate-700 mb-1">طريقة الاستلام والتوريد *</label>
                              <select
                                value={disburseMethod}
                                onChange={(e) => setDisburseMethod(e.target.value as PaymentMethod)}
                                className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold"
                              >
                                <option value="instapay">انستاباي (InstaPay)</option>
                                <option value="digital_wallet">محفظة إلكترونية</option>
                                <option value="bank_transfer">إيداع / تحويل بنكي</option>
                                <option value="cash">نقداً في خزينة الشركة</option>
                              </select>
                            </div>

                            <div>
                              <div className="flex items-center justify-between mb-1">
                                <label className="font-bold text-slate-700">رقم إيصال الاستلام / المرجع *</label>
                                <button
                                  type="button"
                                  onClick={() => setDisburseRefNumber(`IN-${Math.floor(100000 + Math.random() * 900000)}`)}
                                  className="text-[10px] text-emerald-600 font-bold hover:underline cursor-pointer"
                                >
                                  توليد رقم تلقائي ↺
                                </button>
                              </div>
                              <input
                                type="text"
                                required
                                value={disburseRefNumber}
                                onChange={(e) => setDisburseRefNumber(e.target.value)}
                                placeholder="رقم العملية أو الإشعار..."
                                className="w-full p-2.5 bg-white border border-slate-200 rounded-xl font-mono text-xs"
                              />
                            </div>

                            <div>
                              <label className="block font-bold text-slate-700 mb-1">ملاحظات الاستلام (اختياري)</label>
                              <input
                                type="text"
                                value={disburseNotes}
                                onChange={(e) => setDisburseNotes(e.target.value)}
                                placeholder="أي ملاحظات إضافية على الاستلام والتوريد..."
                                className="w-full p-2.5 bg-white border border-slate-200 rounded-xl text-xs"
                              />
                            </div>
                          </div>

                          {inlineError && (
                            <p role="alert" className="text-[11px] font-bold text-rose-700">⚠️ {inlineError}</p>
                          )}

                          <div className="flex items-center justify-between gap-2 flex-wrap pt-2 border-t border-slate-100">
                            <span className="text-xs font-bold text-emerald-800">
                              سيتم زيادة رصيد الكارت المختار فوراً بمبلغ (+{fmtMoney(activeRequest.amount)} {activeRequest.currency})
                            </span>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => setActiveAction('none')}
                                className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-xl text-xs font-semibold cursor-pointer"
                              >
                                إلغاء
                              </button>
                              <button
                                type="submit"
                                disabled={disbursing || !activeDisburseAccount}
                                className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs rounded-xl shadow-md transition cursor-pointer flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                <CheckCircle2 className="h-4 w-4" />
                                <span>{disbursing ? 'جاري التأكيد وإيداع المبلغ...' : '✓ تأكيد الاستلام والتوريد في الرصيد الآن'}</span>
                              </button>
                            </div>
                          </div>
                        </form>
                      )}

                      {/* Reject Form */}
                      {activeAction === 'reject' && canReject && (
                        <div className="mt-3 p-4 bg-rose-50 rounded-xl border border-rose-200 space-y-3 animate-in fade-in duration-150">
                          <h5 className="font-bold text-rose-950 text-xs">تأكيد رفض طلب التوريد:</h5>
                          <input
                            type="text"
                            required
                            value={rejectionReason}
                            onChange={(e) => {
                              setRejectionReason(e.target.value);
                              if (inlineError) setInlineError(null);
                            }}
                            placeholder="اكتب سبب رفض التوريد بوضوح..."
                            aria-invalid={Boolean(inlineError)}
                            className={`w-full p-2.5 bg-white border rounded-xl text-xs outline-none ${inlineError ? 'border-rose-500 ring-2 ring-rose-500/20' : 'border-rose-200'}`}
                          />
                          {inlineError && (
                            <p role="alert" className="text-[11px] font-bold text-rose-700">⚠️ {inlineError}</p>
                          )}
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
                              disabled={actionGuard.isPending(`reject:${activeRequest.id}`)}
                              className="px-4 py-1.5 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs rounded-lg shadow-xs cursor-pointer disabled:opacity-60"
                            >
                              {actionGuard.isPending(`reject:${activeRequest.id}`) ? 'جاري الرفض...' : 'تأكيد الرفض'}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                    )
                  ) : (
                  (canApprove || canClarify || canReject) && (
                  <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-3">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <span className="text-xs font-bold text-slate-700">اتخاذ إجراء مالي أو إداري على هذا الطلب:</span>

                      <div className="flex items-center gap-2 flex-wrap">
                        {canApprove && (
                          <button
                            type="button"
                            onClick={() => toggleAction('approve')}
                            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-xs flex items-center gap-1.5 transition cursor-pointer"
                          >
                            <CheckCircle2 className="h-4 w-4" />
                            <span>اعتماد الطلب ✓</span>
                          </button>
                        )}

                        {canClarify && (
                          <button
                            type="button"
                            onClick={() => toggleAction('clarify')}
                            className="px-3.5 py-2 bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs rounded-xl shadow-xs flex items-center gap-1.5 transition cursor-pointer"
                          >
                            <HelpCircle className="h-4 w-4" />
                            <span>طلب توضيح ⚠️</span>
                          </button>
                        )}

                        {canReject && (
                          <button
                            type="button"
                            onClick={() => toggleAction('reject')}
                            className="px-3.5 py-2 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs rounded-xl shadow-xs flex items-center gap-1.5 transition cursor-pointer"
                          >
                            <XCircle className="h-4 w-4" />
                            <span>رفض ✕</span>
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Approve Form */}
                    {activeAction === 'approve' && canApprove && (
                      <div className="mt-3 p-4 bg-emerald-50 rounded-xl border border-emerald-200 space-y-3 animate-in fade-in duration-150">
                        <h5 className="font-bold text-emerald-950 text-xs">
                          تأكيد اعتماد الطلب بمبلغ {fmtMoney(activeRequest.amount)} {activeRequest.currency}
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
                            disabled={actionGuard.isPending(`approve:${activeRequest.id}`)}
                            className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-lg shadow-xs cursor-pointer disabled:opacity-60"
                          >
                            {actionGuard.isPending(`approve:${activeRequest.id}`) ? 'جاري الاعتماد...' : 'تأكيد الاعتماد المالي'}
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Clarify Form */}
                    {activeAction === 'clarify' && canClarify && (
                      <div className="mt-3 p-4 bg-amber-50 rounded-xl border border-amber-200 space-y-3 animate-in fade-in duration-150">
                        <h5 className="font-bold text-amber-950 text-xs">طلب مستندات أو استفسار من طالب الصرف:</h5>
                        <textarea
                          rows={2}
                          value={clarificationQuestion}
                          onChange={(e) => {
                            setClarificationQuestion(e.target.value);
                            if (inlineError) setInlineError(null);
                          }}
                          placeholder="اكتب استفسارك بدقة للموظف هنا..."
                          aria-invalid={Boolean(inlineError)}
                          className={`w-full p-2.5 bg-white border rounded-xl text-xs outline-none ${inlineError ? 'border-rose-500 ring-2 ring-rose-500/20' : 'border-amber-200'}`}
                        />
                        {inlineError && (
                          <p role="alert" className="text-[11px] font-bold text-rose-700">⚠️ {inlineError}</p>
                        )}
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
                            disabled={actionGuard.isPending(`clarify:${activeRequest.id}`)}
                            className="px-4 py-1.5 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs rounded-lg shadow-xs cursor-pointer disabled:opacity-60"
                          >
                            {actionGuard.isPending(`clarify:${activeRequest.id}`) ? 'جاري الإرسال...' : 'إرسال الاستفسار'}
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Reject Form */}
                    {activeAction === 'reject' && canReject && (
                      <div className="mt-3 p-4 bg-rose-50 rounded-xl border border-rose-200 space-y-3 animate-in fade-in duration-150">
                        <h5 className="font-bold text-rose-950 text-xs">تأكيد رفض طلب الصرف:</h5>
                        <input
                          type="text"
                          required
                          value={rejectionReason}
                          onChange={(e) => {
                            setRejectionReason(e.target.value);
                            if (inlineError) setInlineError(null);
                          }}
                          placeholder="اكتب سبب الرفض بوضوح للموظف..."
                          aria-invalid={Boolean(inlineError)}
                          className={`w-full p-2.5 bg-white border rounded-xl text-xs outline-none ${inlineError ? 'border-rose-500 ring-2 ring-rose-500/20' : 'border-rose-200'}`}
                        />
                        {inlineError && (
                          <p role="alert" className="text-[11px] font-bold text-rose-700">⚠️ {inlineError}</p>
                        )}
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
                            disabled={actionGuard.isPending(`reject:${activeRequest.id}`)}
                            className="px-4 py-1.5 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs rounded-lg shadow-xs cursor-pointer disabled:opacity-60"
                          >
                            {actionGuard.isPending(`reject:${activeRequest.id}`) ? 'جاري الرفض...' : 'تأكيد الرفض'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                  )
                )
              )}

                {/* 2. Approved → disbursement (finance & admins, permissions.ts: disburseRequests) */}
                {activeRequest.status === 'approved' && canDisburse && (
                  <div className="p-5 bg-gradient-to-r from-blue-50 to-indigo-50 border-2 border-blue-200 rounded-2xl space-y-3">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div className="min-w-0">
                        <span className="font-extrabold text-blue-950 text-sm flex items-center gap-1.5">
                          <CheckCircle2 className="h-4 w-4 text-blue-600 shrink-0" />
                          <span>الطلب معتمد ومصرح بصرفه بمبلغ ({fmtMoney(activeRequest.amount)} {activeRequest.currency})</span>
                        </span>
                        <p className="text-xs text-blue-700 mt-0.5">
                          {activeRequest.requestType === 'income'
                            ? 'طلب التوريد معتمد وجاهز لتأكيد إيداع واستلام المبلغ في حساب وخزينة الشركة.'
                            : 'جاهز الآن للتحويل المصرفي إلى حساب المستفيد الموضح أعلاه.'}
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={() => toggleAction('disburse')}
                        className={`px-5 py-2.5 text-white font-bold text-xs rounded-xl shadow-md flex items-center gap-2 transition cursor-pointer ${
                          activeRequest.requestType === 'income'
                            ? 'bg-emerald-600 hover:bg-emerald-700'
                            : 'bg-blue-600 hover:bg-blue-700'
                        }`}
                      >
                        <CreditCard className="h-4 w-4" />
                        <span>
                          {activeRequest.requestType === 'income'
                            ? '📥 استلام وتأكيد التوريد في الخزينة الآن'
                            : '💸 تنفيذ الصرف والتحويل المالي الآن'}
                        </span>
                      </button>
                    </div>

                    {/* Disbursement Drawer / Form */}
                    {activeAction === 'disburse' && (
                      <form onSubmit={handleDisburse} className="mt-4 p-4 bg-white rounded-2xl border border-blue-200 space-y-4 animate-in fade-in duration-150">
                        <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                          <span className="font-bold text-slate-800 text-xs">
                            {activeRequest.requestType === 'income'
                              ? '📥 بيانات استلام وتوريد المبلغ في الخزينة/الحساب:'
                              : '💸 بيانات تنفيذ العملية والتحويل المصرفي:'}
                          </span>
                          <button
                            type="button"
                            onClick={() => setActiveAction('none')}
                            aria-label="إغلاق"
                            className="text-slate-400 hover:text-slate-600 p-1"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                          {/* Payment Account / Vault */}
                          {renderDisburseAccountField(activeRequest)}

                          {/* Payment Method */}
                          <div>
                            <label className="block font-bold text-slate-700 mb-1">وسيلة التحويل المنفذة *</label>
                            <select
                              value={disburseMethod}
                              onChange={(e) => setDisburseMethod(e.target.value as PaymentMethod)}
                              className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold"
                            >
                              <option value="instapay">انستاباي (InstaPay)</option>
                              <option value="bank_transfer">تحويل بنكي فوري (IBAN)</option>
                              <option value="digital_wallet">محفظة إلكترونية (فودافون كاش / اتصالات / أورانج)</option>
                              <option value="cash">نقداً من الخزينة</option>
                              <option value="cheque">شيك مصرفي</option>
                            </select>
                          </div>

                          {/* Reference Number */}
                          <div>
                            <label className="block font-bold text-slate-700 mb-1">رقم مرجع / كود العملية *</label>
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
                            <label className="block font-bold text-slate-700 mb-1">ملاحظات وبيان العملية</label>
                            <input
                              type="text"
                              value={disburseNotes}
                              onChange={(e) => setDisburseNotes(e.target.value)}
                              placeholder="مثال: تم التأكد من الإيداع ووصول الإشعار البنكي"
                              className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs"
                            />
                          </div>
                        </div>

                        {inlineError && inlineError !== activeDisburseShortfall && (
                          <p role="alert" className="text-[11px] font-bold text-rose-700">⚠️ {inlineError}</p>
                        )}

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
                            disabled={disbursing || !activeDisburseAccount || Boolean(activeDisburseShortfall)}
                            title={activeDisburseShortfall || undefined}
                            className={`px-6 py-2.5 text-white font-bold text-xs rounded-xl shadow-md transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 ${
                              activeRequest.requestType === 'income'
                                ? 'bg-emerald-600 hover:bg-emerald-700'
                                : 'bg-blue-600 hover:bg-blue-700'
                            }`}
                          >
                            {disbursing
                              ? 'جاري الحفظ والتنفيذ...'
                              : (activeRequest.requestType === 'income'
                                  ? '📥 تأكيد إيداع واستلام المبلغ في الخزينة (+ IN)'
                                  : '💸 تأكيد تحويل وصرف المبلغ من الخزينة (- OUT)')}
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

      {/* Sticky/Floating Batch Action Toolbar when >= 1 requests are selected */}
      {selectedApprovedIds.length > 0 && (
        <div className="fixed bottom-6 right-6 left-6 md:right-12 md:left-12 z-40 bg-slate-900/95 backdrop-blur-md text-white p-4 sm:p-5 rounded-3xl shadow-2xl border border-slate-700 flex flex-col sm:flex-row items-center justify-between gap-4 animate-in slide-in-from-bottom-5 duration-200">
          <div className="flex items-center gap-3.5 text-right w-full sm:w-auto">
            <div className="h-11 w-11 rounded-2xl bg-gradient-to-tr from-amber-400 to-amber-500 text-slate-950 flex items-center justify-center font-black shadow-lg shadow-amber-500/20 shrink-0">
              <Zap className="h-6 w-6 fill-slate-950" />
            </div>
            <div>
              <div className="text-sm sm:text-base font-black flex items-center gap-2 flex-wrap">
                <span>تم تحديد {selectedApprovedIds.length} طلبات معتمدة</span>
                <span className="text-emerald-400 font-extrabold bg-emerald-950/60 px-2.5 py-0.5 rounded-lg border border-emerald-500/30">
                  بإجمالي {fmtMoney(selectedBatchSum)} {currency}
                </span>
              </div>
              <p className="text-xs text-slate-300 mt-0.5">
                جاهزة الآن لتنفيذ الصرف والتحويل المجمع بضغطة زر واحدة.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5 w-full sm:w-auto justify-end">
            <button
              type="button"
              onClick={() => setSelectedApprovedIds([])}
              className="px-4 py-2.5 text-xs font-bold text-slate-300 hover:text-white hover:bg-slate-800 rounded-xl transition cursor-pointer"
            >
              إلغاء التحديد
            </button>

            <button
              type="button"
              onClick={handleOpenBatchDisburseModal}
              className="flex-1 sm:flex-initial flex items-center justify-center gap-2 bg-gradient-to-r from-emerald-500 to-teal-400 hover:from-emerald-400 hover:to-teal-300 text-slate-950 font-black text-xs sm:text-sm px-6 py-3 rounded-xl shadow-xl shadow-emerald-500/20 transition cursor-pointer active:scale-95"
            >
              <Zap className="h-4 w-4 fill-slate-950" />
              <span>⚡ صرف الدفعة المحددة دفعة واحدة (Batch Pay)</span>
            </button>
          </div>
        </div>
      )}

      {/* Batch Disbursement Confirmation Modal */}
      {isBatchModalOpen && (
        <div 
          className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
          onClick={() => !isBatchDisbursing && setIsBatchModalOpen(false)}
        >
          <div 
            className="bg-white rounded-3xl max-w-2xl w-full p-6 sm:p-7 shadow-2xl border border-slate-100 max-h-[90vh] flex flex-col my-auto animate-in fade-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="h-11 w-11 rounded-2xl bg-blue-100 text-blue-700 flex items-center justify-center shadow-xs">
                  <Zap className="h-6 w-6 fill-blue-700" />
                </div>
                <div>
                  <h3 className="text-base font-black text-slate-900">
                    صرف الدفعة المجمعة (Batch Disbursement)
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    تنفيذ تحويل مالي فوري لعدد {selectedBatchRequests.length} طلبات معتمدة
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={isBatchDisbursing}
                onClick={() => setIsBatchModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-xl hover:bg-slate-100 transition cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Content Form */}
            <form onSubmit={handleConfirmBatchDisburse} className="flex-1 overflow-y-auto py-4 space-y-4 text-xs">
              
              {/* Batch Financial Summary Card */}
              <div className="bg-gradient-to-r from-blue-50 via-indigo-50 to-emerald-50 border border-blue-200/80 rounded-2xl p-4 flex items-center justify-between">
                <div>
                  <span className="text-[11px] font-bold text-slate-600 block">إجمالي مبالغ الصرف المطلوب:</span>
                  <div className="text-2xl font-black text-indigo-950 mt-0.5">
                    {fmtMoney(selectedBatchSum)} <span className="text-sm font-bold text-indigo-700">{currency}</span>
                  </div>
                </div>
                <div className="text-left bg-white/80 backdrop-blur-xs px-3.5 py-2 rounded-xl border border-indigo-100 text-xs">
                  <span className="text-slate-500 block text-[10px]">عدد الطلبات:</span>
                  <span className="font-extrabold text-slate-900 text-sm">{selectedBatchRequests.length} طلبات معتمدة</span>
                </div>
              </div>

              {/* Source Treasury Account */}
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  خزينة / حساب الصرف المحول منه (- OUT) *
                </label>
                {batchAccounts.length === 0 ? (
                  <div role="alert" className="p-2.5 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-[11px] font-bold">
                    لا يوجد حساب خزينة نشط بعملة الطلبات المحددة. يرجى إضافة حساب أو تفعيله من شاشة الخزينة أولاً.
                  </div>
                ) : (
                  <select
                    required
                    value={batchAccount?.id || ''}
                    onChange={(e) => setBatchAccountId(e.target.value)}
                    className={`w-full p-2.5 bg-slate-50 border rounded-xl font-bold text-slate-800 text-xs focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 ${batchShortfall ? 'border-rose-400' : 'border-slate-200'}`}
                  >
                    {batchAccounts.map(acc => (
                      <option key={acc.id} value={acc.id}>
                        {acc.name} — {accountTypeLabel(acc.type)} ({acc.accountIdentifier}) — الرصيد: {fmtMoney(accountBalance(acc))} {currencyCode(acc.currency)}
                      </option>
                    ))}
                  </select>
                )}
                {batchCurrencies.size > 1 && (
                  <div className="mt-1.5 p-2 bg-amber-50 border border-amber-200 rounded-xl text-amber-900 text-[11px] font-bold flex items-center gap-1.5">
                    <AlertCircle className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                    <span>الطلبات المحددة بعملات مختلفة ({Array.from(batchCurrencies).join('، ')}): يُصرف من الحساب فقط ما يطابق عملته، ويُرفض الباقي. يُفضل تحديد طلبات بعملة واحدة.</span>
                  </div>
                )}
                {batchShortfall && (
                  <div role="alert" className="mt-1.5 p-2 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-[11px] font-bold flex items-start gap-1.5">
                    <AlertCircle className="h-3.5 w-3.5 text-rose-600 shrink-0 mt-0.5" />
                    <span>{batchShortfall} (إجمالي الدفعة {fmtMoney(batchOutSum)})</span>
                  </div>
                )}
                {(() => {
                  const currentAcc = batchAccount;
                  const parentBank = resolveParentBankAccount(currentAcc);
                  if (!parentBank) return null;
                  return (
                    <div className="mt-2 p-2.5 bg-blue-50 border border-blue-200 rounded-xl text-blue-900 text-xs flex items-start gap-2">
                      <Landmark className="h-4 w-4 text-blue-600 shrink-0 mt-0.5" />
                      <div>
                        <span className="font-bold block">خصم مزدوج للدفعة المجمعة:</span>
                        <span className="text-[11px] text-blue-800 leading-relaxed">
                          حساب الصرف المختار ({currentAcc?.name}) مربوط بالحساب البنكي (<strong>{parentBank.name}</strong>). سيتم خصم إجمالي الدفعة تلقائياً من هذا الحساب ومن البنك الرئيسي أيضاً.
                        </span>
                      </div>
                    </div>
                  );
                })()}
              </div>

              {/* Payment Method & Reference */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">طريقة الصرف والتحويل</label>
                  <select
                    value={batchPaymentMethod}
                    onChange={(e: any) => setBatchPaymentMethod(e.target.value)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-semibold text-xs"
                  >
                    <option value="auto">حسب وسيلة كل طلب (افتراضي)</option>
                    <option value="instapay">انستاباي (InstaPay) للجميع</option>
                    <option value="bank_transfer">تحويل بنكي فوري (IBAN)</option>
                    <option value="digital_wallet">محفظة إلكترونية</option>
                    <option value="cash">نقداً من الخزينة</option>
                    <option value="cheque">شيك مصرفي</option>
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">كود / مرجع الدفعة *</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      required
                      value={batchRefNumber}
                      onChange={(e) => setBatchRefNumber(e.target.value)}
                      className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono text-xs font-bold"
                    />
                    <button
                      type="button"
                      onClick={() => setBatchRefNumber(newBatchRef())}
                      className="px-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl text-[11px] font-bold shrink-0 cursor-pointer"
                      title="توليد كود جديد"
                    >
                      توليد ↺
                    </button>
                  </div>
                </div>
              </div>

              {/* Batch Notes */}
              <div>
                <label className="block font-bold text-slate-700 mb-1">ملاحظات وبيان الدفعة</label>
                <input
                  type="text"
                  value={batchNotes}
                  onChange={(e) => setBatchNotes(e.target.value)}
                  placeholder="مثال: صرف دفعة مستحقات المصروفات الدورية المعتمدة"
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs"
                />
              </div>

              {/* Selected Requests Breakdown */}
              <div>
                <label className="block font-bold text-slate-700 mb-1.5">
                  تفاصيل الطلبات المشمولة بالصرف ({selectedBatchRequests.length}):
                </label>
                <div className="max-h-48 overflow-y-auto divide-y divide-slate-100 border border-slate-200 rounded-xl">
                  {selectedBatchRequests.map((req, idx) => (
                    <div key={req.id} className="p-2.5 bg-white flex items-center justify-between gap-2 hover:bg-slate-50/80 transition">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-mono text-[10px] text-slate-400 font-bold w-5">{idx + 1}.</span>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono font-bold text-slate-700 text-xs">{req.requestNumber}</span>
                            <span className="text-slate-400">•</span>
                            <span className="font-semibold text-slate-800 text-xs truncate">{req.title}</span>
                          </div>
                          <div className="text-[11px] text-slate-500 truncate">
                            {req.requesterName} {req.paymentAccountDetails ? `(${req.paymentAccountDetails})` : ''}
                          </div>
                        </div>
                      </div>
                      <div className="text-left shrink-0">
                        <span className="font-bold text-emerald-700 text-xs">
                          {fmtMoney(req.amount)} {req.currency}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Modal Actions */}
              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  disabled={isBatchDisbursing}
                  onClick={() => setIsBatchModalOpen(false)}
                  className="px-4 py-2.5 text-slate-600 hover:bg-slate-100 rounded-xl font-bold text-xs cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={isBatchDisbursing || selectedBatchRequests.length === 0 || !batchAccount || Boolean(batchShortfall)}
                  className="px-6 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-xs rounded-xl shadow-md transition cursor-pointer disabled:opacity-50 flex items-center gap-2 active:scale-95"
                >
                  <Zap className="h-4 w-4 fill-white" />
                  <span>
                    {isBatchDisbursing ? 'جاري تنفيذ الصرف المجمع...' : `تأكيد وصرف جميع الطلبات (${selectedBatchRequests.length})`}
                  </span>
                </button>
              </div>

            </form>
          </div>
        </div>
      )}

      {/* Instant QR Code Modal */}
      {qrModalRequest && (
        <div 
          className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setQrModalRequest(null)}
        >
          <div 
            className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-100 animate-in fade-in zoom-in-95 duration-150 text-center"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
              <div className="flex items-center gap-2.5 text-right">
                <div className="h-9 w-9 rounded-xl bg-slate-900 text-emerald-400 flex items-center justify-center shadow-md">
                  <QrCode className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="font-extrabold text-slate-900 text-sm">رمز الاستجابة السريعة للدفع (QR)</h3>
                  <span className="text-[11px] text-slate-400 font-mono">{qrModalRequest.requestNumber}</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setQrModalRequest(null)}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-xl hover:bg-slate-100 transition cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* QR Code Container */}
            <div className="bg-slate-50 p-5 rounded-2xl border border-slate-200 inline-block mx-auto mb-4 relative shadow-inner">
              <div className="p-3 bg-white rounded-xl shadow-xs border border-slate-100">
                {/* Drawn in the browser: the account data is never sent to an outside QR service. */}
                <PaymentQrCode
                  key={qrModalRequest.paymentAccountDetails || qrModalRequest.requestNumber}
                  value={qrModalRequest.paymentAccountDetails || qrModalRequest.requestNumber}
                />
              </div>
              <div className="mt-2.5 flex items-center justify-center gap-1.5 text-[11px] font-bold text-slate-600">
                <Smartphone className="h-3.5 w-3.5 text-emerald-600" />
                <span>امسح الكود عبر تطبيق البنك أو انستاباي أو المحفظة</span>
              </div>
            </div>

            {/* Payment Details Box */}
            <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200/80 text-right text-xs space-y-2 mb-4">
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-500 shrink-0">المستفيد:</span>
                <span className="font-bold text-slate-800 break-words text-left">{qrModalRequest.beneficiaryName || qrModalRequest.requesterName}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">المبلغ المطلوب:</span>
                <span className="font-black text-emerald-700 text-sm">
                  {fmtMoney(qrModalRequest.amount)} {qrModalRequest.currency}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">وسيلة الصرف:</span>
                <span className="font-bold text-slate-800">
                  {paymentMethodLabel(resolveRequestPaymentMethod(qrModalRequest))}
                </span>
              </div>
              <div className="pt-2 border-t border-slate-200 flex items-center justify-between gap-2">
                <span className="text-slate-500 shrink-0">بيانات الحساب / المعرف:</span>
                <span className="font-mono font-bold text-slate-900 select-all break-all text-left">
                  {qrModalRequest.paymentAccountDetails || '—'}
                </span>
              </div>
            </div>

            {/* Buttons */}
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  if (qrModalRequest.paymentAccountDetails) {
                    handleCopyAccountDetails(qrModalRequest.paymentAccountDetails, qrModalRequest.id);
                  }
                }}
                className="flex items-center justify-center gap-1.5 py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition cursor-pointer shadow-xs active:scale-95"
              >
                <Copy className="h-4 w-4" />
                <span>{copiedOk(qrModalRequest.id) ? 'تم النسخ بنجاح ✓' : copyFailed(qrModalRequest.id) ? 'تعذر النسخ — انسخ يدوياً' : 'نسخ البيانات'}</span>
              </button>

              <button
                type="button"
                onClick={() => window.print()}
                className="flex items-center justify-center gap-1.5 py-2.5 px-4 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition cursor-pointer shadow-xs active:scale-95"
              >
                <Printer className="h-4 w-4" />
                <span>طباعة / حفظ</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {editingRequest && (
        <NewRequestModal
          isOpen={Boolean(editingRequest)}
          onClose={() => setEditingRequest(null)}
          editingRequest={editingRequest}
        />
      )}

      {/* Invoice and Document Full-Screen In-App Lightbox Viewer */}
      {previewInvoice && (
        <InvoiceViewerModal
          attachment={previewInvoice}
          onClose={() => setPreviewInvoice(null)}
        />
      )}
    </div>
  );
};
