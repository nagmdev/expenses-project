import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import { 
  X, 
  CreditCard,
  Building2,
  AlertCircle,
  Layers,
  Building,
  Landmark,
  ArrowDownLeft,
  ArrowUpRight,
  Zap,
  Smartphone,
  Wallet,
  Banknote,
  CheckCircle2,
  Receipt,
  Upload,
  Trash2,
  Eye,
  Paperclip,
  Calendar,
  Hash
} from 'lucide-react';
import { 
  PaymentMethod, 
  SUPPORTED_CURRENCIES, 
  isServiceMatchingOrg, 
  RequestType, 
  ServiceCategory,
  ExpenseRequest,
  RequestAttachment 
} from '../types';
import { 
  sanitizeAmount, 
  sanitizeDigitalWallet, 
  sanitizeIBAN, 
  sanitizeInstaPay, 
  handleNumericKeyDown 
} from '../utils/validation';

interface NewRequestModalProps {
  isOpen: boolean;
  onClose: () => void;
  editingRequest?: ExpenseRequest | null;
}

export type IncomeShape = 'instapay' | 'wallet' | 'bank' | 'cash';

export const INCOME_PAYMENT_SHAPES = [
  {
    id: 'instapay' as IncomeShape,
    title: 'إنستاباي',
    subtitle: 'InstaPay IPA / رقم الهاتف',
    icon: Smartphone,
    badge: 'لحظي ⚡',
    method: 'instapay' as PaymentMethod,
    accountType: 'instapay' as const,
  },
  {
    id: 'wallet' as IncomeShape,
    title: 'محفظة كاش',
    subtitle: 'فودافون / اتصالات / أورانج / وي',
    icon: Wallet,
    badge: 'محفظة ذكية 📱',
    method: 'digital_wallet' as PaymentMethod,
    accountType: 'wallet' as const,
  },
  {
    id: 'bank' as IncomeShape,
    title: 'حساب بنكي',
    subtitle: 'تحويل أو إيداع بنكي مباشر',
    icon: Landmark,
    badge: 'بنك 🏦',
    method: 'bank_transfer' as PaymentMethod,
    accountType: 'bank' as const,
  },
  {
    id: 'cash' as IncomeShape,
    title: 'خزينة نقدية',
    subtitle: 'مقبوضات كاش بمقر الشركة',
    icon: Banknote,
    badge: 'كاش 💵',
    method: 'cash' as PaymentMethod,
    accountType: 'cash' as const,
  },
];

const EXPENSE_QUICK_TEMPLATES = [
  {
    label: '⚡ شحن كارت كهرباء',
    title: 'شحن كارت كهرباء المقر',
    description: 'شحن كارت عداد الكهرباء الدوري للمقر',
    keywords: ['كهرباء', 'طاقة', 'عداد', 'مرافق'],
  },
  {
    label: '⚡ فواتير إنترنت وهاتف',
    title: 'سداد فاتورة الإنترنت الشهرية',
    description: 'سداد فاتورة واشتراك الإنترنت والاتصالات للأعمال',
    keywords: ['إنترنت', 'انترنت', 'اتصالات', 'هاتف', 'شبكات', 'سحابية'],
  },
  {
    label: '⚡ بوفيه ومستلزمات مقر',
    title: 'شراء مستلزمات بوفيه وضيافة',
    description: 'شراء مستلزمات بوفيه وضيافة ومستلزمات نظافة دورية للمقر',
    keywords: ['بوفيه', 'ضيافة', 'مستلزمات', 'أدوات مكتبية', 'نثريات', 'تشغيل'],
  },
  {
    label: '⚡ شحن محفظة مندوب',
    title: 'شحن رصيد محفظة للمندوب / مأمورية',
    description: 'شحن رصيد محفظة إلكترونية للمندوب لتغطية مصاريف المأمورية والانتقالات',
    keywords: ['مندوب', 'محفظة', 'مأمورية', 'سفر', 'انتقالات', 'عهدة'],
  },
  {
    label: '⚡ وقود وانتقالات',
    title: 'بدل وقود ومصروفات انتقالات مأمورية',
    description: 'سداد فواتير وقود وبنزين ومصروفات انتقالات مأمورية رسمية',
    keywords: ['وقود', 'بنزين', 'انتقالات', 'سفر', 'سيارات', 'مهمة'],
  },
];

const EXPENSE_TITLE_TEMPLATES = [
  'شراء مستلزمات بوفيه وضيافة',
  'شراء تراخيص برمجيات واشتراكات سحابية',
  'بدل انتقالات ومصروفات سفر ومهمات عمل',
  'تجديد باقات اتصالات وإنترنت للأعمال',
  'صيانة دورية للأجهزة والمعدات التشغيلية',
  'شراء أدوات مكتبية ومستلزمات تشغيل',
  'سداد رسوم حكومية وخدمات قانونية وتراخيص',
  'ضيافة واجتماعات عملاء ومناسبات عمل',
  'حملة تسويقية وإعلانات ممولة على المنصات',
  'شراء أجهزة ومعدات تقنية جديدة لفريق العمل',
  'مستحقات عهدة نقدية للمصروفات النثرية',
  '✏️ كتابة موضوع وعنوان مخصص يدوي...',
];

const EXPENSE_JUSTIFICATION_TEMPLATES = [
  'زيادة كفاءة الإنتاجية وتطوير أدوات فريق العمل',
  'دعم استمرارية العمليات اليومية وتفادي انقطاع الخدمة',
  'تنفيذ مهام عمل رسمية معتمدة من الإدارة لصالح الشركة',
  'تغطية تكاليف سفر ومهمة عمل رسمية خارج المقر',
  'تجديد دوري سنوي/شهري متفق عليه في الميزانية التشغيلية',
  'متطلبات عاجلة للمشروع لضمان التسليم في الموعد المحدد',
  '✏️ كتابة مبرر مالي مخصص يدوي...',
];

const EXPENSE_DESCRIPTION_TEMPLATES = [
  'شراء مستلزمات بوفيه وضيافة ومستلزمات نظافة دورية للمقر',
  'تمت مراجعة التكلفة ومطابقة العروض المقدمة للحصول على أفضل سعر وأعلى كفاءة.',
  'شراء وتفعيل الخدمة فوراً لخدمة أهداف ومشاريع الشركة المعتمدة.',
  'سداد مباشر للفواتير والمستحقات المرفقة مع الطلب بعد التحقق منها.',
  'تغطية مصاريف الرحلة الرسمية والانتقالات بموجب الإيصالات والتفويض.',
  '✏️ كتابة تفاصيل ومواصفات مخصصة...',
];

export const NewRequestModal: React.FC<NewRequestModalProps> = ({ isOpen, onClose, editingRequest }) => {
  const { 
    organizations,
    allOrganizations,
    services, 
    allServices,
    providers, 
    allProviders,
    paymentAccounts,
    allPaymentAccounts,
    currentUser, 
    currentRole,
    activeOrg,
    activeOrgId,
    createRequest,
    updateRequest
  } = useApp();

  const isEditMode = Boolean(editingRequest);

  const isSuperAdmin = currentRole === 'super_admin' || currentUser.role === 'super_admin';
  const orgList = useMemo(() => {
    return (allOrganizations && allOrganizations.length > 0) ? allOrganizations : organizations;
  }, [allOrganizations, organizations]);

  const [selectedOrgId, setSelectedOrgId] = useState<string>(() => {
    if (activeOrgId && activeOrgId !== 'all') return activeOrgId;
    if (activeOrg?.id) return activeOrg.id;
    return orgList[0]?.id || '';
  });

  useEffect(() => {
    if (activeOrgId && activeOrgId !== 'all') {
      setSelectedOrgId(activeOrgId);
    } else if (activeOrg?.id) {
      setSelectedOrgId(activeOrg.id);
    } else if (orgList.length > 0 && !selectedOrgId) {
      setSelectedOrgId(orgList[0].id);
    }
  }, [activeOrgId, activeOrg, orgList, selectedOrgId]);

  const currentOrg = useMemo(() => {
    return orgList.find(o => o.id === selectedOrgId) || activeOrg || orgList[0];
  }, [orgList, selectedOrgId, activeOrg]);

  const sourceServices = (allServices && allServices.length > 0) ? allServices : services;
  const availableServices = useMemo(() => {
    if (!selectedOrgId) return sourceServices;
    return sourceServices.filter(s => isServiceMatchingOrg(s, selectedOrgId));
  }, [sourceServices, selectedOrgId]);

  // Guaranteed fallback service so no organization is ever blocked
  const FALLBACK_SERVICE: ServiceCategory = useMemo(() => ({
    id: 'srv-general',
    orgId: selectedOrgId || 'general',
    orgIds: [selectedOrgId],
    name: 'مصروفات وتشغيل عام / نثريات',
    code: 'GEN',
    description: 'بند المصروفات والنثريات العامة والتشغيلية',
    budgetLimit: 50000,
    spentAmount: 0,
    color: '#4f46e5',
    iconName: 'Layers',
    active: true,
  }), [selectedOrgId]);

  const effectiveServices = useMemo(() => {
    const list = [...availableServices];
    if (!list.some(s => s.id === 'srv-general')) {
      list.push(FALLBACK_SERVICE);
    }
    return list;
  }, [availableServices, FALLBACK_SERVICE]);

  const sourceProviders = (allProviders && allProviders.length > 0) ? allProviders : providers;
  const availableProviders = useMemo(() => {
    if (!selectedOrgId) return sourceProviders;
    return sourceProviders.filter(p => {
      const pAny = p as any;
      if (pAny.orgIds && Array.isArray(pAny.orgIds)) {
        return pAny.orgIds.includes(selectedOrgId);
      }
      return p.orgId === selectedOrgId || !p.orgId;
    });
  }, [sourceProviders, selectedOrgId]);

  // Guaranteed fallback provider so purchases (like office groceries) are never blocked
  const FALLBACK_PROVIDER = useMemo(() => ({
    id: 'prov-direct-purchase',
    name: 'شراء مباشر / بدون مورد محدد (سوبرماركت / محلات تجارية)',
    code: 'DIRECT',
    orgIds: [selectedOrgId],
    active: true,
  }), [selectedOrgId]);

  const effectiveProviders = useMemo(() => {
    const list = [...availableProviders];
    if (!list.some(p => p.id === 'prov-direct-purchase')) {
      list.push(FALLBACK_PROVIDER as any);
    }
    return list;
  }, [availableProviders, FALLBACK_PROVIDER]);

  const sourcePaymentAccounts = (allPaymentAccounts && allPaymentAccounts.length > 0) ? allPaymentAccounts : paymentAccounts;
  const availableAccounts = useMemo(() => {
    if (!selectedOrgId) return sourcePaymentAccounts.filter(a => a.active !== false);
    return sourcePaymentAccounts.filter(a => a.orgId === selectedOrgId && a.active !== false);
  }, [sourcePaymentAccounts, selectedOrgId]);

  // Request Type & Income Shape
  const [requestType, setRequestType] = useState<RequestType>('expense');
  const [selectedIncomeShape, setSelectedIncomeShape] = useState<IncomeShape>('instapay');
  const [targetAccountId, setTargetAccountId] = useState<string>('');
  const [itemsDetail, setItemsDetail] = useState('');

  // Selected Service & Provider IDs (for Expense)
  const [selectedServiceId, setSelectedServiceId] = useState<string>('');
  const [selectedProviderId, setSelectedProviderId] = useState<string>('');

  useEffect(() => {
    if (effectiveServices.length > 0) {
      if (!selectedServiceId || !effectiveServices.some(s => s.id === selectedServiceId)) {
        setSelectedServiceId(effectiveServices[0].id);
      }
    }
  }, [effectiveServices, selectedServiceId]);

  useEffect(() => {
    if (effectiveProviders.length > 0) {
      if (!selectedProviderId || !effectiveProviders.some(p => p.id === selectedProviderId)) {
        setSelectedProviderId(effectiveProviders[0].id);
      }
    }
  }, [effectiveProviders, selectedProviderId]);

  // Title State (for Expense)
  const [isCustomTitle, setIsCustomTitle] = useState(false);
  const [selectedTitlePreset, setSelectedTitlePreset] = useState(EXPENSE_TITLE_TEMPLATES[0]);
  const [customTitle, setCustomTitle] = useState('');

  // Description & Justification (for Expense)
  const [isCustomJustification, setIsCustomJustification] = useState(false);
  const [selectedJustPreset, setSelectedJustPreset] = useState(EXPENSE_JUSTIFICATION_TEMPLATES[0]);
  const [customJustification, setCustomJustification] = useState('');

  const [isCustomDescription, setIsCustomDescription] = useState(false);
  const [selectedDescPreset, setSelectedDescPreset] = useState(EXPENSE_DESCRIPTION_TEMPLATES[0]);
  const [customDescription, setCustomDescription] = useState('');

  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState(currentOrg?.currency || activeOrg?.currency || 'EGP');
  const [urgency, setUrgency] = useState<'low' | 'medium' | 'high'>('medium');
  const [preferredPaymentMethod, setPreferredPaymentMethod] = useState<PaymentMethod>(
    (currentUser.preferredPaymentMethod as PaymentMethod) || 'instapay'
  );
  const [paymentAccountDetails, setPaymentAccountDetails] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Dedicated Invoice & Prepayment States
  const [isPrepaidByRequester, setIsPrepaidByRequester] = useState<boolean>(false);
  const [invoiceNumber, setInvoiceNumber] = useState<string>('');
  const [invoiceDate, setInvoiceDate] = useState<string>('');
  const [invoiceAttachment, setInvoiceAttachment] = useState<RequestAttachment | null>(null);
  const [previewModalUrl, setPreviewModalUrl] = useState<{ url: string; name: string; type: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
      alert('حجم الملف كبير جداً، يرجى اختيار ملف أقل من 10 ميجابايت');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      const formatSize = (bytes: number) => {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
      };

      const now = new Date();
      const dateFormatted = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

      const newAttachment: RequestAttachment = {
        id: `att-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        name: file.name,
        size: formatSize(file.size),
        type: file.type.includes('pdf') ? 'pdf' : (file.type.includes('png') ? 'png' : 'jpg'),
        url: dataUrl,
        uploadedAt: dateFormatted,
      };

      setInvoiceAttachment(newAttachment);
    };

    reader.readAsDataURL(file);
    e.target.value = '';
  };

  // Helper to get auto-fill details from profile for a given payment method
  const getProfilePayoutDetail = useCallback((method: PaymentMethod | string) => {
    switch (method) {
      case 'instapay':
        return currentUser.instapay || currentUser.phone || '';
      case 'wallet':
      case 'digital_wallet':
        return currentUser.wallet || currentUser.phone || '';
      case 'bank_transfer':
        return currentUser.iban 
          ? (currentUser.bankName ? `${currentUser.bankName} - ${currentUser.iban}` : currentUser.iban) 
          : '';
      case 'cash':
        return 'خزينة المقر الرئيسي';
      default:
        return '';
    }
  }, [currentUser]);

  // Auto-fill from profile when modal opens or prefill when editing
  useEffect(() => {
    if (isOpen) {
      if (editingRequest) {
        setRequestType(editingRequest.requestType || 'expense');
        setAmount(editingRequest.amount ? String(editingRequest.amount) : '');
        setCurrency(editingRequest.currency || currentOrg?.currency || 'EGP');
        setUrgency(editingRequest.urgency || 'medium');
        if (editingRequest.orgId) setSelectedOrgId(editingRequest.orgId);
        if (editingRequest.serviceCategoryId) setSelectedServiceId(editingRequest.serviceCategoryId);
        if (editingRequest.providerId) setSelectedProviderId(editingRequest.providerId);
        setItemsDetail(editingRequest.itemsDetail || '');
        setTargetAccountId(editingRequest.targetAccountId || '');

        setIsCustomTitle(true);
        setCustomTitle(editingRequest.title || '');

        setIsCustomJustification(true);
        setCustomJustification(editingRequest.justification || '');

        setIsCustomDescription(true);
        setCustomDescription(editingRequest.description || '');

        if (editingRequest.preferredPaymentMethod) {
          setPreferredPaymentMethod(editingRequest.preferredPaymentMethod);
        }
        setPaymentAccountDetails(editingRequest.paymentAccountDetails || '');

        setIsPrepaidByRequester(Boolean(editingRequest.isPrepaidByRequester));
        setInvoiceNumber(editingRequest.invoiceNumber || '');
        setInvoiceDate(editingRequest.invoiceDate || '');
        if (editingRequest.invoiceAttachment) {
          setInvoiceAttachment(editingRequest.invoiceAttachment);
        } else if (editingRequest.attachments && editingRequest.attachments.length > 0) {
          setInvoiceAttachment(editingRequest.attachments[0]);
        } else {
          setInvoiceAttachment(null);
        }
      } else {
        const defaultMethod = (currentUser.preferredPaymentMethod as PaymentMethod) || 'instapay';
        setPreferredPaymentMethod(defaultMethod);
        const detail = getProfilePayoutDetail(defaultMethod);
        if (detail) {
          setPaymentAccountDetails(detail);
        }
        setIsPrepaidByRequester(false);
        setInvoiceNumber('');
        setInvoiceDate('');
        setInvoiceAttachment(null);
      }
    }
  }, [isOpen, editingRequest, currentUser, getProfilePayoutDetail, currentOrg]);

  // Validation & Error Handling States
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldHighlight, setFieldHighlight] = useState<'amount' | 'title' | 'paymentDetails' | null>(null);

  // Element Refs for Auto-Scrolling and Auto-Focus
  const amountInputRef = useRef<HTMLInputElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const paymentInputRef = useRef<HTMLInputElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (currentOrg?.currency) {
      setCurrency(currentOrg.currency);
    }
  }, [currentOrg]);

  // Accounts matching currently selected income shape
  const activeShapeObj = useMemo(() => {
    return INCOME_PAYMENT_SHAPES.find(s => s.id === selectedIncomeShape) || INCOME_PAYMENT_SHAPES[0];
  }, [selectedIncomeShape]);

  const matchingShapeAccounts = useMemo(() => {
    return availableAccounts.filter(a => a.type === activeShapeObj.accountType);
  }, [availableAccounts, activeShapeObj]);

  useEffect(() => {
    if (requestType === 'income') {
      if (matchingShapeAccounts.length > 0) {
        if (!targetAccountId || !matchingShapeAccounts.some(a => a.id === targetAccountId)) {
          setTargetAccountId(matchingShapeAccounts[0].id);
        }
      } else {
        setTargetAccountId('');
      }
    }
  }, [matchingShapeAccounts, requestType, targetAccountId]);

  const handleSelectIncomeShape = (shapeId: IncomeShape) => {
    setSelectedIncomeShape(shapeId);
    setFormError(null);
    const shape = INCOME_PAYMENT_SHAPES.find(s => s.id === shapeId) || INCOME_PAYMENT_SHAPES[0];
    setPreferredPaymentMethod(shape.method);
    const matching = availableAccounts.filter(a => a.type === shape.accountType);
    if (matching.length > 0) {
      setTargetAccountId(matching[0].id);
    } else {
      setTargetAccountId('');
    }
  };

  // Switch between Expense (Outflow) and Income (Inflow)
  const handleSwitchRequestType = (type: RequestType) => {
    if (type === requestType) return;
    setRequestType(type);
    setFormError(null);
    setFieldHighlight(null);
    setIsCustomTitle(false);
    setIsCustomJustification(false);
    setIsCustomDescription(false);
    setCustomTitle('');
    setCustomJustification('');
    setCustomDescription('');

    if (type === 'income') {
      const defaultShape = INCOME_PAYMENT_SHAPES[0];
      setSelectedIncomeShape(defaultShape.id);
      setPreferredPaymentMethod(defaultShape.method);
      const matching = availableAccounts.filter(a => a.type === defaultShape.accountType);
      if (matching.length > 0) {
        setTargetAccountId(matching[0].id);
      } else {
        setTargetAccountId('');
      }
      setPaymentAccountDetails('');
    } else {
      setSelectedTitlePreset(EXPENSE_TITLE_TEMPLATES[0]);
      setSelectedJustPreset(EXPENSE_JUSTIFICATION_TEMPLATES[0]);
      const defaultMethod = (currentUser.preferredPaymentMethod as PaymentMethod) || 'instapay';
      setPreferredPaymentMethod(defaultMethod);
      setPaymentAccountDetails(getProfilePayoutDetail(defaultMethod));
    }
  };

  // Close on Escape key press for accessibility
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  if (!isOpen) return null;

  // Computed Values for Expense
  const effectiveTitle = isCustomTitle 
    ? customTitle 
    : (selectedTitlePreset.startsWith('✏️') ? customTitle : selectedTitlePreset);

  const effectiveJustification = isCustomJustification 
    ? customJustification 
    : (selectedJustPreset.startsWith('✏️') ? customJustification : selectedJustPreset);

  const effectiveDescription = isCustomDescription 
    ? customDescription 
    : (selectedDescPreset.startsWith('✏️') ? customDescription : selectedDescPreset);

  // Auto-fill logic when a Service Category is selected
  const applyServiceCategoryDefaults = (srv: ServiceCategory) => {
    if (srv.fixedAccountRef) {
      const refTag = `(الرقم المرجعي / كود العداد: ${srv.fixedAccountRef})`;
      setItemsDetail(prev => {
        if (!prev) return refTag;
        if (prev.includes(srv.fixedAccountRef!)) return prev;
        return `${prev} - ${refTag}`;
      });
    }

    if (srv.vendorId && effectiveProviders.some(p => p.id === srv.vendorId)) {
      setSelectedProviderId(srv.vendorId);
    }

    if (srv.defaultPaymentMethod) {
      setPreferredPaymentMethod(srv.defaultPaymentMethod);
    }

    if (srv.defaultAccountId && availableAccounts.some(a => a.id === srv.defaultAccountId)) {
      setTargetAccountId(srv.defaultAccountId);
    }
  };

  // Quick Template Activation for Expense
  const applyQuickTemplate = (tpl: { label: string; title: string; description: string; keywords: string[] }) => {
    setIsCustomTitle(true);
    setCustomTitle(tpl.title);
    setIsCustomDescription(true);
    setCustomDescription(tpl.description);
    setFormError(null);
    setFieldHighlight(null);

    const matched = effectiveServices.find(s => {
      const sName = s.name.toLowerCase();
      const sDesc = (s.description || '').toLowerCase();
      return tpl.keywords.some(k => sName.includes(k.toLowerCase()) || sDesc.includes(k.toLowerCase()));
    });

    if (matched) {
      setSelectedServiceId(matched.id);
      applyServiceCategoryDefaults(matched);
    }

    // Auto-focus amount input so the user can easily enter the cost!
    setTimeout(() => {
      amountInputRef.current?.focus();
    }, 100);
  };

  const handleClose = () => {
    setRequestType('expense');
    setSelectedIncomeShape('instapay');
    setIsCustomTitle(false);
    setIsCustomJustification(false);
    setIsCustomDescription(false);
    setSelectedTitlePreset(EXPENSE_TITLE_TEMPLATES[0]);
    setSelectedJustPreset(EXPENSE_JUSTIFICATION_TEMPLATES[0]);
    setSelectedDescPreset(EXPENSE_DESCRIPTION_TEMPLATES[0]);
    setCustomTitle('');
    setCustomJustification('');
    setCustomDescription('');
    setAmount('');
    setItemsDetail('');
    setTargetAccountId('');
    setPaymentAccountDetails('');
    setIsPrepaidByRequester(false);
    setInvoiceNumber('');
    setInvoiceDate('');
    setInvoiceAttachment(null);
    setPreviewModalUrl(null);
    setFormError(null);
    setFieldHighlight(null);
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setFieldHighlight(null);

    // ==========================================
    // 0. EDIT MODE SUBMISSION (تعديل طلب موجود)
    // ==========================================
    if (isEditMode && editingRequest) {
      if (!amount || Number(amount) <= 0) {
        setFormError('⚠️ يرجى إدخال المبلغ أولاً للمتابعة');
        setFieldHighlight('amount');
        amountInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        amountInputRef.current?.focus();
        return;
      }

      const activeTitle = requestType === 'income'
        ? (paymentAccountDetails.trim() ? `توريد مالي - ${paymentAccountDetails.trim()}` : `توريد مالي (+ IN)`)
        : effectiveTitle.trim();

      if (!activeTitle) {
        setFormError('⚠️ يرجى كتابة أو اختيار موضوع وعنوان الطلب');
        setFieldHighlight('title');
        titleInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        titleInputRef.current?.focus();
        return;
      }

      if (requestType === 'expense' && preferredPaymentMethod !== 'cash' && !paymentAccountDetails.trim()) {
        setFormError(
          preferredPaymentMethod === 'instapay'
            ? '⚠️ يرجى إدخال عنوان إنستاباي أو رقم الهاتف للمستفيد'
            : preferredPaymentMethod === 'digital_wallet'
            ? '⚠️ يرجى إدخال رقم المحفظة الإلكترونية للمستفيد'
            : '⚠️ يرجى إدخال رقم الحساب البنكي / الآيبان للمستفيد'
        );
        setFieldHighlight('paymentDetails');
        paymentInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        paymentInputRef.current?.focus();
        return;
      }

      if (submitting) return;

      const selectedService = effectiveServices.find(s => s.id === selectedServiceId) || effectiveServices[0];
      const serviceId = selectedService?.id || editingRequest.serviceCategoryId;
      const serviceName = selectedService?.name || editingRequest.serviceCategoryName;

      const selectedProvider = effectiveProviders.find(p => p.id === selectedProviderId) || effectiveProviders[0];
      const providerId = selectedProvider?.id || editingRequest.providerId;
      const providerName = selectedProvider?.name || editingRequest.providerName;

      const otherAttachments = (editingRequest.attachments || []).filter(
        a => !invoiceAttachment || a.id !== invoiceAttachment.id
      );
      const finalAttachments = invoiceAttachment 
        ? [invoiceAttachment, ...otherAttachments] 
        : otherAttachments;

      setSubmitting(true);
      try {
        await updateRequest(editingRequest.id, {
          title: activeTitle,
          description: requestType === 'income'
            ? `طلب توريد مالي بقيمة ${Number(amount).toLocaleString()} ${currency}`
            : (effectiveDescription.trim() || editingRequest.description),
          justification: requestType === 'income'
            ? 'إيداع وتوريد مالي مباشر'
            : (effectiveJustification.trim() || editingRequest.justification),
          amount: Number(amount),
          currency: currency || currentOrg?.currency || 'EGP',
          serviceCategoryId: serviceId,
          serviceCategoryName: serviceName,
          providerId: providerId,
          providerName: providerName,
          urgency,
          requestType,
          targetAccountId: targetAccountId || undefined,
          itemsDetail: itemsDetail.trim() || undefined,
          isPrepaidByRequester,
          invoiceNumber: invoiceNumber.trim() || undefined,
          invoiceDate: invoiceDate || undefined,
          invoiceAttachment: invoiceAttachment || undefined,
          attachments: finalAttachments,
          preferredPaymentMethod,
          paymentAccountDetails: paymentAccountDetails.trim(),
          orgId: selectedOrgId,
        });

        handleClose();
      } catch (err: any) {
        console.error('[NewRequestModal] Error updating request:', err);
        setFormError(err?.message || 'حدث خطأ أثناء حفظ التعديلات على الطلب، يرجى المحاولة ثانية');
      } finally {
        setSubmitting(false);
      }
      return;
    }

    // ==========================================
    // 1. INFLOW (توريد مالي مباشر)
    // ==========================================
    if (requestType === 'income') {
      if (!amount || Number(amount) <= 0) {
        setFormError('⚠️ يرجى إدخال المبلغ المطلوب توريده (+ IN) أولاً للمتابعة');
        setFieldHighlight('amount');
        amountInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        amountInputRef.current?.focus();
        return;
      }

      if (submitting) return;

      const shapeObj = INCOME_PAYMENT_SHAPES.find(s => s.id === selectedIncomeShape) || INCOME_PAYMENT_SHAPES[0];
      const matchingAccount = availableAccounts.find(a => a.id === targetAccountId) || 
        availableAccounts.find(a => a.type === shapeObj.accountType);

      const titleText = paymentAccountDetails.trim()
        ? `توريد مالي - ${paymentAccountDetails.trim()}`
        : `توريد مالي عبر ${shapeObj.title} (+ IN)`;

      setSubmitting(true);
      try {
        await createRequest({
          title: titleText,
          description: `طلب توريد مالي بقيمة ${Number(amount).toLocaleString()} ${currency} عبر ${shapeObj.title}`,
          justification: 'إيداع وتوريد مالي مباشر لحساب وخزينة الشركة',
          amount: Number(amount),
          currency: currency || currentOrg?.currency || 'EGP',
          serviceCategoryId: 'srv-income-general',
          serviceCategoryName: 'توريدات ومتحصلات نقدية',
          providerId: 'prov-income-general',
          providerName: paymentAccountDetails.trim() ? `المودع: ${paymentAccountDetails.trim()}` : 'توريد مباشر / عميل',
          urgency: 'medium',
          requestType: 'income',
          targetAccountId: matchingAccount?.id || targetAccountId || undefined,
          isPrepaidByRequester,
          invoiceNumber: invoiceNumber.trim() || undefined,
          invoiceDate: invoiceDate || undefined,
          invoiceAttachment: invoiceAttachment || undefined,
          attachments: invoiceAttachment ? [invoiceAttachment] : [],
          preferredPaymentMethod: shapeObj.method,
          paymentAccountDetails: paymentAccountDetails.trim(),
          orgId: selectedOrgId,
        });

        handleClose();
      } catch (err: any) {
        console.error('[NewRequestModal] Error creating income request:', err);
        setFormError(err?.message || 'حدث خطأ أثناء إرسال طلب التوريد، يرجى المحاولة ثانية');
      } finally {
        setSubmitting(false);
      }
      return;
    }

    // ==========================================
    // 2. OUTFLOW (طلب صرف ومصروف مالي)
    // ==========================================
    // Validation 1: Amount
    if (!amount || Number(amount) <= 0) {
      setFormError('⚠️ يرجى إدخال المبلغ المطلوب صرفه (- OUT) أولاً للمتابعة');
      setFieldHighlight('amount');
      amountInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      amountInputRef.current?.focus();
      return;
    }

    // Validation 2: Title
    if (!effectiveTitle.trim()) {
      setFormError('⚠️ يرجى كتابة أو اختيار موضوع وعنوان الطلب');
      setFieldHighlight('title');
      titleInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      titleInputRef.current?.focus();
      return;
    }

    // Validation 3: Payment details
    if (preferredPaymentMethod !== 'cash' && !paymentAccountDetails.trim()) {
      setFormError(
        preferredPaymentMethod === 'instapay'
          ? '⚠️ يرجى إدخال عنوان إنستاباي أو رقم الهاتف للمستفيد'
          : preferredPaymentMethod === 'digital_wallet'
          ? '⚠️ يرجى إدخال رقم المحفظة الإلكترونية للمستفيد'
          : '⚠️ يرجى إدخال رقم الحساب البنكي / الآيبان للمستفيد'
      );
      setFieldHighlight('paymentDetails');
      paymentInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      paymentInputRef.current?.focus();
      return;
    }

    if (submitting) return;

    // Resolve Service (with safe fallbacks so no submission is ever blocked)
    const selectedService = effectiveServices.find(s => s.id === selectedServiceId) || effectiveServices[0];
    const serviceId = selectedService?.id || 'srv-general';
    const serviceName = selectedService?.name || 'مصروفات وتشغيل عام / نثريات';

    // Resolve Provider (with safe fallbacks so direct market purchases are supported)
    const selectedProvider = effectiveProviders.find(p => p.id === selectedProviderId) || effectiveProviders[0];
    const providerId = selectedProvider?.id || 'prov-direct-purchase';
    const providerName = selectedProvider?.name || 'شراء مباشر / بدون مورد محدد';

    setSubmitting(true);
    try {
      await createRequest({
        title: effectiveTitle.trim(),
        description: effectiveDescription.trim() || 'سداد مباشر للمصروفات الموضحة بالطلب',
        justification: effectiveJustification.trim() || 'دعم استمرارية العمليات والتشغيل',
        amount: Number(amount),
        currency: currency || currentOrg?.currency || 'EGP',
        serviceCategoryId: serviceId,
        serviceCategoryName: serviceName,
        providerId: providerId,
        providerName: providerName,
        urgency,
        requestType: 'expense',
        targetAccountId: targetAccountId || undefined,
        itemsDetail: itemsDetail.trim() || undefined,
        isPrepaidByRequester,
        invoiceNumber: invoiceNumber.trim() || undefined,
        invoiceDate: invoiceDate || undefined,
        invoiceAttachment: invoiceAttachment || undefined,
        attachments: invoiceAttachment ? [invoiceAttachment] : [],
        preferredPaymentMethod,
        paymentAccountDetails: paymentAccountDetails.trim(),
        orgId: selectedOrgId,
      });

      handleClose();
    } catch (err: any) {
      console.error('[NewRequestModal] Error creating expense request:', err);
      setFormError(err?.message || 'حدث خطأ أثناء حفظ طلب الصرف، يرجى المحاولة ثانية');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-3 sm:p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-request-modal-title"
    >
      <div 
        className="bg-white rounded-3xl max-w-2xl w-full max-h-[92vh] shadow-2xl border border-slate-100 flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150 my-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className={`shrink-0 flex items-center justify-between p-4 sm:p-5 border-b sticky top-0 z-10 transition-colors ${
          isEditMode
            ? 'border-indigo-100 bg-gradient-to-r from-indigo-50/95 via-purple-50/50 to-white'
            : requestType === 'income'
            ? 'border-emerald-100 bg-gradient-to-r from-emerald-50/95 via-teal-50/50 to-white'
            : 'border-rose-100 bg-gradient-to-r from-rose-50/95 via-pink-50/40 to-white'
        }`}>
          <div>
            <div className="flex items-center gap-2">
              <h3 id="new-request-modal-title" className="text-base font-bold text-slate-900">
                {isEditMode 
                  ? `✏️ تعديل طلب المصروفات (${editingRequest?.requestNumber})` 
                  : (requestType === 'income' ? '📥 توريد وتحصيل مالي (Inflow)' : '💸 طلب صرف ومطالبة مالية (Outflow)')}
              </h3>
              <span className={`px-2 py-0.5 rounded-md text-[10px] font-black ${
                isEditMode
                  ? 'bg-indigo-100 text-indigo-800 border border-indigo-300'
                  : requestType === 'income'
                  ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                  : 'bg-rose-100 text-rose-800 border border-rose-300'
              }`}>
                {isEditMode ? 'وضع التعديل' : (requestType === 'income' ? '+ إيداع وتوريد' : '- منصرف مالي')}
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              {isEditMode
                ? 'يمكنك تعديل تفاصيل ومبالغ وبنود الطلب والمرفقات قبل اعتماده وصرفه'
                : requestType === 'income'
                ? 'حدد المبلغ وشكل التوريد لإيداعه في كارت الخزينة وتحديث الرصيد فور الاستلام'
                : 'اكتب المبلغ والبيانات المطلوبة لتقديم طلب الصرف للاعتماد الفوري'}
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label="إغلاق النافذة"
            className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Form Container */}
        <form onSubmit={handleSubmit} className="flex-1 flex flex-col min-h-0 overflow-hidden">
          
          {/* Scrollable Form Body */}
          <div ref={scrollContainerRef} className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-4 text-xs">
          
            {/* Primary Operation Switcher (Always at the very top) */}
            <div className="bg-slate-100/90 p-1.5 rounded-2xl flex gap-2">
              <button
                type="button"
                onClick={() => handleSwitchRequestType('expense')}
                className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-xl font-bold transition cursor-pointer text-xs ${
                  requestType === 'expense'
                    ? 'bg-white text-rose-800 shadow-xs border border-rose-200 ring-2 ring-rose-500/20'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
                }`}
              >
                <ArrowUpRight className="h-4 w-4 text-rose-600" />
                <span>💸 طلب صرف مالي (Outflow)</span>
              </button>
              <button
                type="button"
                onClick={() => handleSwitchRequestType('income')}
                className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-xl font-bold transition cursor-pointer text-xs ${
                  requestType === 'income'
                    ? 'bg-white text-emerald-800 shadow-xs border border-emerald-200 ring-2 ring-emerald-500/20'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
                }`}
              >
                <ArrowDownLeft className="h-4 w-4 text-emerald-600" />
                <span>📥 توريد / تحصيل مالي (Inflow)</span>
              </button>
            </div>

            {/* Organization Selector / Scope Badge */}
            {isSuperAdmin && (!activeOrgId || activeOrgId === 'all') ? (
              <div className="bg-slate-50 p-3.5 rounded-2xl border border-slate-200">
                <div className="flex items-center justify-between mb-1.5">
                  <label className="font-bold text-slate-800 text-xs flex items-center gap-1.5">
                    <Building2 className="h-4 w-4 text-indigo-600" />
                    المؤسسة / الشركة المستهدفة بالطلب *
                  </label>
                  <span className="text-[10px] text-indigo-700 bg-indigo-100/70 font-bold px-2 py-0.5 rounded-full">
                    تحديد بصلاحية مدير النظام
                  </span>
                </div>
                <select
                  value={selectedOrgId}
                  onChange={(e) => setSelectedOrgId(e.target.value)}
                  className="w-full p-2.5 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 font-bold text-slate-900 text-xs"
                >
                  {orgList.map((org) => (
                    <option key={org.id} value={org.id}>
                      {org.name} ({org.code}) - العملة: {org.currency}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="flex items-center justify-between p-3 bg-slate-50 border border-slate-200/80 rounded-2xl text-xs">
                <div className="flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-indigo-600" />
                  <span className="text-slate-600 font-semibold">المؤسسة التابع لها الطلب:</span>
                  <span className="font-bold text-slate-900">{currentOrg?.name || 'المؤسسة المعتمدة'}</span>
                </div>
                {currentOrg?.code && (
                  <span className="px-2.5 py-1 bg-indigo-100 text-indigo-800 rounded-lg font-black text-[11px]">
                    {currentOrg.code}
                  </span>
                )}
              </div>
            )}

            {/* =========================================================================
                INFLOW FORM (توريد مالي مباشر)
                PURE MONEY: Amount + Shape (Bank / InstaPay / Wallet / Cash) + Target Card + Optional Note
               ========================================================================= */}
            {requestType === 'income' ? (
              <div className="space-y-4 animate-in fade-in duration-150">
                {/* 1. Amount to Inflow */}
                <div className={`bg-gradient-to-br from-emerald-50/80 via-teal-50/40 to-white p-4 sm:p-5 rounded-2xl border-2 transition-all shadow-xs space-y-2 ${
                  fieldHighlight === 'amount' 
                    ? 'border-emerald-500 ring-4 ring-emerald-500/20' 
                    : 'border-emerald-300/80'
                }`}>
                  <div className="flex items-center justify-between">
                    <label className="font-black text-slate-800 text-sm flex items-center gap-2">
                      <span className="p-1.5 bg-emerald-600 text-white rounded-lg">
                        <ArrowDownLeft className="h-4 w-4" />
                      </span>
                      <span>المبلغ المطلوب توريده (+ IN) *</span>
                    </label>
                    <span className="text-[11px] font-bold text-emerald-700 bg-emerald-100/90 px-2.5 py-0.5 rounded-full">
                      وارد إلى الخزينة
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 pt-1">
                    <div className="sm:col-span-8 relative">
                      <input
                        ref={amountInputRef}
                        type="text"
                        inputMode="decimal"
                        autoFocus
                        value={amount}
                        onKeyDown={(e) => handleNumericKeyDown(e, true)}
                        onChange={(e) => {
                          setAmount(sanitizeAmount(e.target.value));
                          if (formError) setFormError(null);
                          if (fieldHighlight === 'amount') setFieldHighlight(null);
                        }}
                        placeholder="0.00"
                        className="w-full p-3.5 bg-white border-2 border-emerald-400 rounded-xl focus:outline-none focus:ring-4 focus:ring-emerald-500/20 font-black text-slate-900 pl-24 text-xl shadow-xs"
                      />
                      <span className="absolute left-3 top-3.5 px-2.5 py-1 rounded-lg text-xs font-black bg-emerald-100 text-emerald-800 border border-emerald-300 flex items-center gap-1 pointer-events-none">
                        <span>+</span>
                        <span>{currency}</span>
                      </span>
                    </div>

                    <div className="sm:col-span-4">
                      <select
                        value={currency}
                        onChange={(e) => setCurrency(e.target.value)}
                        className="w-full p-3.5 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 font-bold text-xs shadow-xs h-full"
                      >
                        {SUPPORTED_CURRENCIES.map((c) => (
                          <option key={c.code} value={c.code}>
                            {c.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>

                {/* 2. Shape / Payment Method: The 4 fundamental shapes (Bank, InstaPay, Wallet, Cash) */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="font-black text-slate-800 text-xs flex items-center gap-1.5">
                      <Landmark className="h-4 w-4 text-emerald-600" />
                      <span>طريقة وشكل التوريد (اختر الشكل المناسب) *</span>
                    </label>
                    <span className="text-[11px] text-slate-500 font-semibold">
                      يحدد كارت الاستلام المالي
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                    {INCOME_PAYMENT_SHAPES.map((shape) => {
                      const ShapeIcon = shape.icon;
                      const isSelected = selectedIncomeShape === shape.id;
                      return (
                        <button
                          key={shape.id}
                          type="button"
                          onClick={() => handleSelectIncomeShape(shape.id)}
                          className={`p-3.5 rounded-2xl border-2 text-right transition-all cursor-pointer flex flex-col justify-between gap-2.5 relative ${
                            isSelected
                              ? 'border-emerald-600 bg-emerald-50/90 shadow-md ring-2 ring-emerald-500/20'
                              : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/80 shadow-2xs'
                          }`}
                        >
                          <div className="flex items-center justify-between w-full">
                            <div className={`p-2 rounded-xl ${isSelected ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-600'}`}>
                              <ShapeIcon className="h-4 w-4" />
                            </div>
                            <span className={`text-[10px] font-black px-1.5 py-0.5 rounded-md ${isSelected ? 'bg-emerald-200 text-emerald-900' : 'bg-slate-100 text-slate-600'}`}>
                              {shape.badge}
                            </span>
                          </div>
                          <div>
                            <div className={`font-black text-xs ${isSelected ? 'text-emerald-950' : 'text-slate-800'}`}>
                              {shape.title}
                            </div>
                            <div className="text-[10px] text-slate-500 font-medium truncate mt-0.5">
                              {shape.subtitle}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  {/* Target Account / Card Selector for this Shape */}
                  <div className="p-3.5 bg-slate-50 border border-slate-200/80 rounded-2xl space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                        <span>الكارت / الحساب المستلم المحدد في المؤسسة:</span>
                      </span>
                      {matchingShapeAccounts.length > 0 && (
                        <span className="text-[11px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">
                          جاهز ({matchingShapeAccounts.length} كارت)
                        </span>
                      )}
                    </div>

                    {matchingShapeAccounts.length > 0 ? (
                      <div className="space-y-2">
                        {matchingShapeAccounts.map((acc) => {
                          const isCardChosen = (targetAccountId === acc.id) || (matchingShapeAccounts.length === 1 && !targetAccountId);
                          return (
                            <div
                              key={acc.id}
                              onClick={() => setTargetAccountId(acc.id)}
                              className={`p-3 rounded-xl border transition-all cursor-pointer flex items-center justify-between ${
                                isCardChosen
                                  ? 'bg-white border-emerald-500 ring-2 ring-emerald-500/20 shadow-xs'
                                  : 'bg-white/60 border-slate-200 hover:bg-white'
                              }`}
                            >
                              <div className="flex items-center gap-2.5">
                                <div className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center ${isCardChosen ? 'border-emerald-600 bg-emerald-600' : 'border-slate-300'}`}>
                                  {isCardChosen && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                                </div>
                                <div>
                                  <div className="font-bold text-slate-900 text-xs">{acc.name}</div>
                                  <div className="text-[11px] text-slate-500 font-mono">{acc.accountIdentifier}</div>
                                </div>
                              </div>
                              <div className="text-left">
                                <div className="text-[10px] text-slate-400 font-medium">الرصيد الحالي</div>
                                <div className="text-xs font-black text-emerald-700">
                                  {Number(acc.currentBalance ?? acc.balance ?? 0).toLocaleString()} {acc.currency}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="p-3 bg-emerald-50/80 border border-emerald-200 rounded-xl text-xs text-emerald-900 flex items-center gap-2">
                        <div className="p-1 bg-emerald-200 text-emerald-800 rounded-lg shrink-0">
                          <Zap className="h-3.5 w-3.5" />
                        </div>
                        <div>
                          <span className="font-bold">تجهيز آلي: </span>
                          <span>سيتم إيداع المبلغ وتحديث رصيد كارت ({activeShapeObj?.title}) التابع للمؤسسة فوراً عند تأكيد الاستلام.</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* 3. Depositor Name or Note (Optional) */}
                <div className="space-y-1.5">
                  <label className="block font-bold text-slate-700 text-xs">
                    اسم المودع / العميل أو ملاحظات التوريد (اختياري)
                  </label>
                  <input
                    type="text"
                    value={paymentAccountDetails}
                    onChange={(e) => setPaymentAccountDetails(e.target.value)}
                    placeholder="مثال: توريد نقدية من المندوب أحمد محمود، أو سداد دفعة مبيعات..."
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 text-slate-900 font-medium text-xs shadow-2xs"
                  />
                </div>
              </div>
            ) : (
              /* =========================================================================
                  OUTFLOW FORM (طلب صرف ومصروف مالي)
                 ========================================================================= */
              <div className="space-y-4 animate-in fade-in duration-150">
                {/* 1. Quick Request Templates Bar */}
                <div className="p-3.5 rounded-2xl border shadow-2xs space-y-2 bg-gradient-to-r from-indigo-50/90 via-purple-50/70 to-blue-50/90 border-indigo-100/90">
                  <div className="flex items-center justify-between">
                    <span className="font-black text-xs flex items-center gap-1.5 text-indigo-950">
                      <Zap className="h-4 w-4 text-indigo-600 fill-indigo-600" />
                      <span>قوالب سريعة لمصروفات متكررة (- OUT):</span>
                    </span>
                    <span className="text-[10px] font-bold text-indigo-600/80">
                      تعبئة وتحديد آلي للبنود بنقرة واحدة
                    </span>
                  </div>

                  <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-thin">
                    {EXPENSE_QUICK_TEMPLATES.map((tpl) => (
                      <button
                        key={tpl.label}
                        type="button"
                        onClick={() => applyQuickTemplate(tpl)}
                        className="shrink-0 px-3.5 py-2 bg-white rounded-xl text-xs font-bold transition-all duration-150 shadow-2xs hover:shadow-xs cursor-pointer active:scale-95 flex items-center gap-1.5 border hover:bg-indigo-600 hover:text-white text-indigo-900 border-indigo-200/80"
                        title={`تطبيق قالب سريع: ${tpl.title}`}
                      >
                        <span>{tpl.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* 2. Amount, Currency & Urgency Card (Prominent & Easy to Fill) */}
                <div 
                  className={`bg-gradient-to-br from-rose-50/90 via-pink-50/40 to-white p-4 sm:p-5 rounded-2xl border-2 transition-all shadow-xs space-y-2.5 ${
                    fieldHighlight === 'amount' 
                      ? 'border-rose-500 ring-4 ring-rose-500/20' 
                      : 'border-rose-300/90'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <label className="font-black text-slate-800 text-sm flex items-center gap-2">
                      <span className="p-1.5 bg-rose-600 text-white rounded-lg">
                        <ArrowUpRight className="h-4 w-4" />
                      </span>
                      <span>المبلغ المطلوب صرفه (- OUT) *</span>
                    </label>
                    <div className="flex items-center gap-2">
                      {fieldHighlight === 'amount' && (
                        <span className="text-[11px] font-black text-rose-700 bg-rose-100 border border-rose-300 px-2.5 py-0.5 rounded-full animate-pulse">
                          ⚠️ يرجى إدخال المبلغ هنا
                        </span>
                      )}
                      <span className="text-[11px] font-bold text-rose-800 bg-rose-100/90 px-2.5 py-0.5 rounded-full">
                        منصرف مالي
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 pt-1">
                    <div className="sm:col-span-8 relative">
                      <input
                        ref={amountInputRef}
                        type="text"
                        inputMode="decimal"
                        value={amount}
                        onKeyDown={(e) => handleNumericKeyDown(e, true)}
                        onChange={(e) => {
                          setAmount(sanitizeAmount(e.target.value));
                          if (formError) setFormError(null);
                          if (fieldHighlight === 'amount') setFieldHighlight(null);
                        }}
                        placeholder="0.00"
                        className={`w-full p-3.5 bg-white border-2 rounded-xl focus:outline-none focus:ring-4 font-black text-slate-900 pl-24 text-xl shadow-xs transition-all ${
                          fieldHighlight === 'amount'
                            ? 'border-rose-500 focus:ring-rose-500/30 ring-2 ring-rose-500/20'
                            : 'border-rose-400 focus:ring-rose-500/20'
                        }`}
                      />
                      <span className="absolute left-3 top-3.5 px-2.5 py-1 rounded-lg text-xs font-black bg-rose-100 text-rose-800 border border-rose-300 flex items-center gap-1 pointer-events-none select-none">
                        <span>-</span>
                        <span>{currency}</span>
                      </span>
                    </div>

                    <div className="sm:col-span-4">
                      <select
                        value={currency}
                        onChange={(e) => setCurrency(e.target.value)}
                        className="w-full p-3.5 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-rose-500/20 font-bold text-xs shadow-xs h-full"
                      >
                        {SUPPORTED_CURRENCIES.map((c) => (
                          <option key={c.code} value={c.code}>
                            {c.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Urgency selector buttons */}
                  <div className="pt-2 flex items-center justify-between border-t border-rose-100/80 text-xs">
                    <span className="font-bold text-slate-600">درجة الأولوية:</span>
                    <div className="flex items-center gap-2">
                      {[
                        { id: 'low', label: '🟢 عادي' },
                        { id: 'medium', label: '🟡 متوسط الأهمية' },
                        { id: 'high', label: '🔴 عاجل جداً' },
                      ].map((u) => (
                        <button
                          key={u.id}
                          type="button"
                          onClick={() => setUrgency(u.id as any)}
                          className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                            urgency === u.id
                              ? 'bg-rose-600 text-white shadow-xs'
                              : 'bg-white/80 text-slate-600 hover:bg-white border border-slate-200'
                          }`}
                        >
                          {u.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* 3. Title Selection */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="font-bold text-slate-700">موضوع وعنوان الطلب *</label>
                    <button
                      type="button"
                      onClick={() => {
                        setIsCustomTitle(!isCustomTitle);
                        if (!isCustomTitle && !customTitle) {
                          setCustomTitle(selectedTitlePreset.startsWith('✏️') ? '' : selectedTitlePreset);
                        }
                      }}
                      className="text-[11px] text-indigo-600 hover:text-indigo-700 font-bold flex items-center gap-1 cursor-pointer transition hover:underline"
                    >
                      {isCustomTitle ? '📋 اختيار من القائمة المنسدلة' : '✏️ كتابة عنوان مخصص'}
                    </button>
                  </div>

                  {isCustomTitle ? (
                    <input
                      ref={titleInputRef}
                      type="text"
                      value={customTitle}
                      onChange={(e) => {
                        setCustomTitle(e.target.value);
                        if (formError) setFormError(null);
                        if (fieldHighlight === 'title') setFieldHighlight(null);
                      }}
                      placeholder="اكتب موضوع وعنوان الطلب بالتفصيل هنا..."
                      className={`w-full p-2.5 bg-white border rounded-xl focus:outline-none focus:ring-2 font-medium text-xs shadow-xs ${
                        fieldHighlight === 'title' 
                          ? 'border-rose-500 ring-2 ring-rose-500/20' 
                          : 'border-indigo-400 focus:ring-indigo-500/20 text-slate-900'
                      }`}
                    />
                  ) : (
                    <select
                      value={selectedTitlePreset}
                      onChange={(e) => {
                        if (e.target.value.startsWith('✏️')) {
                          setIsCustomTitle(true);
                          setCustomTitle('');
                        } else {
                          setSelectedTitlePreset(e.target.value);
                        }
                        if (formError) setFormError(null);
                        if (fieldHighlight === 'title') setFieldHighlight(null);
                      }}
                      className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 font-bold text-slate-900"
                    >
                      {EXPENSE_TITLE_TEMPLATES.map((tpl) => (
                        <option key={tpl} value={tpl}>{tpl}</option>
                      ))}
                    </select>
                  )}
                </div>

                {/* 4. Service & Provider Dropdowns (With Auto Fallbacks) */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="font-bold text-slate-700 flex items-center gap-1">
                        <Layers className="h-3.5 w-3.5 text-indigo-600" />
                        <span>بند الخدمة / مركز التكلفة *</span>
                      </label>
                      <span className="text-[10px] text-slate-400 font-bold">
                        ({effectiveServices.length} بند متاح)
                      </span>
                    </div>

                    <select
                      value={selectedServiceId}
                      onChange={(e) => {
                        const sId = e.target.value;
                        setSelectedServiceId(sId);
                        const srv = effectiveServices.find(s => s.id === sId);
                        if (srv) {
                          applyServiceCategoryDefaults(srv);
                        }
                      }}
                      className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 font-bold text-slate-900 text-xs"
                    >
                      {effectiveServices.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name} {s.code ? `(${s.code})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="font-bold text-slate-700 flex items-center gap-1">
                        <Building className="h-3.5 w-3.5 text-indigo-600" />
                        <span>مقدم الخدمة / المورد *</span>
                      </label>
                      <span className="text-[10px] text-slate-400 font-bold">
                        ({effectiveProviders.length} مورد متاح)
                      </span>
                    </div>

                    <select
                      value={selectedProviderId}
                      onChange={(e) => setSelectedProviderId(e.target.value)}
                      className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 font-bold text-slate-900 text-xs"
                    >
                      {effectiveProviders.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} {p.contactPerson ? `(مسؤول: ${p.contactPerson})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* 5. Expense Recipient Payment Details */}
                <div className={`p-4 rounded-2xl border space-y-3 transition-all ${
                  fieldHighlight === 'paymentDetails'
                    ? 'bg-rose-50 border-rose-500 ring-2 ring-rose-500/20'
                    : 'bg-rose-50/60 border-rose-200/80'
                }`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 font-bold text-rose-950 text-xs">
                      <CreditCard className="h-4 w-4 text-rose-600" />
                      <span>بيانات تحويل المبلغ للمستفيد (- OUT) *</span>
                    </div>
                    {/* Auto-fill badge if details match profile */}
                    {paymentAccountDetails && (
                      paymentAccountDetails === currentUser.instapay || 
                      paymentAccountDetails === currentUser.wallet || 
                      paymentAccountDetails === currentUser.phone ||
                      paymentAccountDetails === currentUser.iban ||
                      (currentUser.iban && paymentAccountDetails.includes(currentUser.iban)) ||
                      paymentAccountDetails === 'خزينة المقر الرئيسي'
                    ) ? (
                      <span className="text-[10px] font-bold text-emerald-800 bg-emerald-100/90 border border-emerald-300 px-2 py-0.5 rounded-full flex items-center gap-1">
                        <span>⚡ معبأة تلقائياً من بروفايلك</span>
                      </span>
                    ) : (
                      <span className="text-[10px] font-bold text-rose-800 bg-rose-100 px-2 py-0.5 rounded-md">
                        صرف خارج (- OUT)
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block font-bold text-slate-700 mb-1">طريقة التحويل المفضلة للمستفيد *</label>
                      <select
                        value={preferredPaymentMethod}
                        onChange={(e: any) => {
                          const newMethod = e.target.value as PaymentMethod;
                          setPreferredPaymentMethod(newMethod);
                          const detail = getProfilePayoutDetail(newMethod);
                          setPaymentAccountDetails(detail);
                          if (formError) setFormError(null);
                          if (fieldHighlight === 'paymentDetails') setFieldHighlight(null);
                        }}
                        className="w-full p-2.5 bg-white border border-slate-200 rounded-xl font-bold text-xs"
                      >
                        <option value="instapay">انستاباي (InstaPay)</option>
                        <option value="bank_transfer">تحويل بنكي فوري (IBAN)</option>
                        <option value="digital_wallet">محفظة إلكترونية (فودافون كاش / اتصالات / أورانج)</option>
                        <option value="cash">نقداً من الخزينة</option>
                      </select>
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="font-bold text-slate-700">
                          {preferredPaymentMethod === 'instapay' ? 'عنوان انستاباي (IPA / رقم الهاتف) *' :
                           preferredPaymentMethod === 'digital_wallet' ? 'رقم المحفظة الإلكترونية (أرقام فقط) *' :
                           preferredPaymentMethod === 'bank_transfer' ? 'رقم الآيبان (IBAN) *' : 'جهة الاستلام'}
                        </label>
                        {!paymentAccountDetails && getProfilePayoutDetail(preferredPaymentMethod) && (
                          <button
                            type="button"
                            onClick={() => setPaymentAccountDetails(getProfilePayoutDetail(preferredPaymentMethod))}
                            className="text-[10px] text-purple-700 font-bold hover:underline cursor-pointer flex items-center gap-1"
                          >
                            ⚡ ملء من بروفايلي
                          </button>
                        )}
                      </div>
                      <input
                        ref={paymentInputRef}
                        type="text"
                        inputMode={preferredPaymentMethod === 'digital_wallet' ? 'numeric' : 'text'}
                        value={paymentAccountDetails}
                        onKeyDown={(e) => {
                          if (preferredPaymentMethod === 'digital_wallet') {
                            handleNumericKeyDown(e, false);
                          }
                        }}
                        onChange={(e) => {
                          const raw = e.target.value;
                          if (preferredPaymentMethod === 'digital_wallet') {
                            setPaymentAccountDetails(sanitizeDigitalWallet(raw));
                          } else if (preferredPaymentMethod === 'bank_transfer') {
                            setPaymentAccountDetails(sanitizeIBAN(raw));
                          } else if (preferredPaymentMethod === 'instapay') {
                            setPaymentAccountDetails(sanitizeInstaPay(raw));
                          } else {
                            setPaymentAccountDetails(raw);
                          }
                          if (formError) setFormError(null);
                          if (fieldHighlight === 'paymentDetails') setFieldHighlight(null);
                        }}
                        placeholder={
                          preferredPaymentMethod === 'instapay' ? 'user@instapay أو رقم الهاتف' :
                          preferredPaymentMethod === 'digital_wallet' ? '010xxxxxxxx (أرقام فقط)' :
                          preferredPaymentMethod === 'bank_transfer' ? 'EG... / SA... (حروف وأرقام)' : 'الفرع أو الخزينة'
                        }
                        className={`w-full p-2.5 bg-white border rounded-xl font-mono text-xs ${
                          fieldHighlight === 'paymentDetails' ? 'border-rose-500 ring-2 ring-rose-500/20' : 'border-slate-200'
                        }`}
                      />
                    </div>
                  </div>
                </div>

                {/* 🧾 DEDICATED INVOICE / RECEIPT ATTACHMENT SECTION */}
                <div className="bg-gradient-to-br from-amber-50/80 via-orange-50/30 to-white p-4 sm:p-5 rounded-2xl border-2 border-amber-300 shadow-xs space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-amber-200/70">
                    <div className="flex items-center gap-2.5">
                      <div className="p-2.5 bg-amber-500 text-white rounded-xl shadow-xs shrink-0">
                        <Receipt className="h-5 w-5" />
                      </div>
                      <div>
                        <h4 className="font-black text-slate-900 text-xs sm:text-sm">
                          🧾 إرفاق فاتورة / إيصال سداد (في حال الدفع المسبق من طرفك)
                        </h4>
                        <p className="text-[11px] text-slate-500 mt-0.5">
                          إثبات للمصداقية وحفظ حقوق السداد في حال قيامك بدفع القيمة مقدماً لصالح الشركة
                        </p>
                      </div>
                    </div>
                    
                    {/* Toggle: Personal Payment / Reimbursement */}
                    <div className="flex items-center gap-2 self-start sm:self-auto bg-white/95 p-1.5 px-2.5 rounded-xl border border-amber-200 shadow-2xs">
                      <span className="text-[11px] font-bold text-slate-700">سداد من جيبي الخاص:</span>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={isPrepaidByRequester}
                        onClick={() => setIsPrepaidByRequester(!isPrepaidByRequester)}
                        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                          isPrepaidByRequester ? 'bg-amber-600' : 'bg-slate-300'
                        }`}
                      >
                        <span
                          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${
                            isPrepaidByRequester ? 'translate-x-0' : '-translate-x-5'
                          }`}
                        />
                      </button>
                      <span className={`text-[10px] font-black px-2 py-0.5 rounded-md ${
                        isPrepaidByRequester ? 'bg-amber-100 text-amber-900 border border-amber-300' : 'bg-slate-100 text-slate-600'
                      }`}>
                        {isPrepaidByRequester ? 'نعم (استرداد شخصي)' : 'لا (دفع مباشر)'}
                      </span>
                    </div>
                  </div>

                  {/* Clarification banner when personal payment is toggled */}
                  {isPrepaidByRequester && (
                    <div className="p-3 bg-amber-100/90 border border-amber-300 rounded-xl text-xs text-amber-950 flex items-start gap-2 animate-in fade-in">
                      <AlertCircle className="h-4 w-4 text-amber-700 shrink-0 mt-0.5" />
                      <div>
                        <strong className="block font-black">طلب استرداد مصروفات شخصية (Reimbursement):</strong>
                        <span>أنت تؤكد أنك قمت بسداد المبلغ من جيبك الخاص، وسيتم تحويل قيمة الفاتورة لحسابك الموضح كاسترداد للمصروفات بعد الاعتماد.</span>
                      </div>
                    </div>
                  )}

                  {/* Invoice Fields: Number & Date */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    {/* 1. Invoice / Receipt Number */}
                    <div>
                      <label className="block font-bold text-slate-700 mb-1 flex items-center gap-1.5 text-xs">
                        <Hash className="h-3.5 w-3.5 text-amber-600" />
                        <span>رقم الفاتورة / الإيصال (اختياري)</span>
                      </label>
                      <input
                        type="text"
                        value={invoiceNumber}
                        onChange={(e) => setInvoiceNumber(e.target.value)}
                        placeholder="مثال: INV-2026-0899 أو رقم إيصال الدفع..."
                        className="w-full p-2.5 bg-white border border-slate-200 rounded-xl font-medium text-slate-900 text-xs focus:outline-none focus:ring-2 focus:ring-amber-500/20"
                      />
                    </div>

                    {/* 2. Invoice Date */}
                    <div>
                      <label className="block font-bold text-slate-700 mb-1 flex items-center gap-1.5 text-xs">
                        <Calendar className="h-3.5 w-3.5 text-amber-600" />
                        <span>تاريخ الفاتورة / السداد (اختياري)</span>
                      </label>
                      <input
                        type="date"
                        value={invoiceDate}
                        onChange={(e) => setInvoiceDate(e.target.value)}
                        className="w-full p-2.5 bg-white border border-slate-200 rounded-xl font-medium text-slate-900 text-xs focus:outline-none focus:ring-2 focus:ring-amber-500/20"
                      />
                    </div>
                  </div>

                  {/* 3. File Upload Button & Preview / Delete Area */}
                  <div className="pt-1">
                    <label className="block font-bold text-slate-700 mb-1.5 flex items-center justify-between text-xs">
                      <span className="flex items-center gap-1.5">
                        <Paperclip className="h-3.5 w-3.5 text-amber-600" />
                        <span>مرفق الفاتورة أو إيصال السداد (صورة JPG, PNG أو مستند PDF)</span>
                      </span>
                      <span className="text-[10px] text-slate-400 font-semibold">بحد أقصى 10 ميجابايت</span>
                    </label>

                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf"
                      onChange={handleFileUpload}
                      className="hidden"
                      id="invoice-file-upload-input"
                    />

                    {!invoiceAttachment ? (
                      <div 
                        onClick={() => fileInputRef.current?.click()}
                        className="border-2 border-dashed border-amber-300 hover:border-amber-500 bg-amber-50/40 hover:bg-amber-50/80 rounded-2xl p-4 sm:p-5 text-center transition cursor-pointer flex flex-col items-center justify-center gap-2"
                      >
                        <div className="p-3 bg-amber-100 text-amber-700 rounded-2xl shadow-2xs">
                          <Upload className="h-6 w-6" />
                        </div>
                        <div>
                          <span className="text-xs font-bold text-slate-800 block">
                            انقر هنا لرفع وتحديد ملف الفاتورة أو الإيصال
                          </span>
                          <span className="text-[11px] text-slate-500 mt-0.5 block">
                            يدعم صور الفواتير الورقية (JPG, PNG) والمستندات الإلكترونية (PDF)
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            fileInputRef.current?.click();
                          }}
                          className="mt-1 px-4 py-1.5 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs rounded-xl shadow-xs transition flex items-center gap-1.5 cursor-pointer"
                        >
                          <Upload className="h-3.5 w-3.5" />
                          <span>اختيار ملف الفاتورة</span>
                        </button>
                      </div>
                    ) : (
                      <div className="bg-white border-2 border-emerald-300 rounded-2xl p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
                        <div className="flex items-center gap-3 min-w-0">
                          {/* Thumbnail / Icon */}
                          {invoiceAttachment.url && (invoiceAttachment.type === 'png' || invoiceAttachment.type === 'jpg' || invoiceAttachment.type.startsWith('image/')) ? (
                            <img 
                              src={invoiceAttachment.url} 
                              alt="معاينة الفاتورة" 
                              className="w-12 h-12 rounded-xl object-cover border border-slate-200 shadow-2xs shrink-0 cursor-pointer hover:opacity-90 transition"
                              onClick={() => setPreviewModalUrl({ url: invoiceAttachment.url!, name: invoiceAttachment.name, type: invoiceAttachment.type })}
                              title="انقر للمعاينة بحجم كبير"
                            />
                          ) : (
                            <div className="w-12 h-12 rounded-xl bg-rose-100 text-rose-700 flex items-center justify-center font-bold text-xs shrink-0">
                              PDF
                            </div>
                          )}
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-slate-900 text-xs truncate block max-w-[200px] sm:max-w-xs" title={invoiceAttachment.name}>
                                {invoiceAttachment.name}
                              </span>
                              <span className="text-[10px] font-black text-emerald-800 bg-emerald-100 border border-emerald-300 px-2 py-0.5 rounded-full shrink-0">
                                مرفق جاهز ✓
                              </span>
                            </div>
                            <div className="text-[11px] text-slate-400 mt-0.5 flex items-center gap-2">
                              <span>الحجم: {invoiceAttachment.size}</span>
                              <span>•</span>
                              <span>النوع: {invoiceAttachment.type.toUpperCase()}</span>
                            </div>
                          </div>
                        </div>

                        {/* Action Buttons: Preview & Delete */}
                        <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
                          {invoiceAttachment.url && (
                            <button
                              type="button"
                              onClick={() => {
                                if (invoiceAttachment.url) {
                                  setPreviewModalUrl({ url: invoiceAttachment.url, name: invoiceAttachment.name, type: invoiceAttachment.type });
                                }
                              }}
                              className="px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold text-xs rounded-xl border border-indigo-200 flex items-center gap-1.5 transition cursor-pointer"
                            >
                              <Eye className="h-3.5 w-3.5" />
                              <span>معاينة المرفق</span>
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => setInvoiceAttachment(null)}
                            className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold text-xs rounded-xl border border-rose-200 flex items-center gap-1.5 transition cursor-pointer"
                            title="حذف هذا المرفق"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            <span>حذف</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* 6. Items Detail (Optional) */}
                <div className="bg-slate-50 p-3.5 rounded-2xl border border-slate-200/80">
                  <label className="block font-bold text-slate-800 mb-1">
                    📦 بيانات البضاعة أو الأصناف (اختياري - اسم الصنف، الكمية، سعر الوحدة)
                  </label>
                  <input
                    type="text"
                    value={itemsDetail}
                    onChange={(e) => setItemsDetail(e.target.value)}
                    placeholder="مثال: فطار مجمع وحليب ومستلزمات، أو 10 كراتين بضاعة x 150 ج.م..."
                    className="w-full p-2.5 bg-white border border-slate-200 rounded-xl font-medium text-slate-800 text-xs outline-hidden"
                  />
                </div>

                {/* 7. Justification */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="font-bold text-slate-700">المبرر المالي للطلب *</label>
                    <button
                      type="button"
                      onClick={() => {
                        setIsCustomJustification(!isCustomJustification);
                        if (!isCustomJustification && !customJustification) {
                          setCustomJustification(selectedJustPreset.startsWith('✏️') ? '' : selectedJustPreset);
                        }
                      }}
                      className="text-[11px] text-indigo-600 hover:text-indigo-700 font-bold flex items-center gap-1 cursor-pointer transition hover:underline"
                    >
                      {isCustomJustification ? '📋 اختيار من القائمة المنسدلة' : '✏️ كتابة مبرر مخصص'}
                    </button>
                  </div>

                  {isCustomJustification ? (
                    <textarea
                      rows={2}
                      value={customJustification}
                      onChange={(e) => setCustomJustification(e.target.value)}
                      placeholder="اكتب المبرر المالي والتشغيلي للطلب بالتفصيل هنا..."
                      className="w-full p-2.5 bg-white border border-indigo-400 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 text-slate-900 text-xs shadow-xs"
                    />
                  ) : (
                    <select
                      value={selectedJustPreset}
                      onChange={(e) => {
                        if (e.target.value.startsWith('✏️')) {
                          setIsCustomJustification(true);
                          setCustomJustification('');
                        } else {
                          setSelectedJustPreset(e.target.value);
                        }
                      }}
                      className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none font-semibold text-slate-900"
                    >
                      {EXPENSE_JUSTIFICATION_TEMPLATES.map((tpl) => (
                        <option key={tpl} value={tpl}>{tpl}</option>
                      ))}
                    </select>
                  )}
                </div>

                {/* 8. Description */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="font-bold text-slate-700">تفاصيل ومواصفات الطلب</label>
                    <button
                      type="button"
                      onClick={() => {
                        setIsCustomDescription(!isCustomDescription);
                        if (!isCustomDescription && !customDescription) {
                          setCustomDescription(selectedDescPreset.startsWith('✏️') ? '' : selectedDescPreset);
                        }
                      }}
                      className="text-[11px] text-indigo-600 hover:text-indigo-700 font-bold flex items-center gap-1 cursor-pointer transition hover:underline"
                    >
                      {isCustomDescription ? '📋 اختيار من القائمة المنسدلة' : '✏️ كتابة تفاصيل مخصصة'}
                    </button>
                  </div>

                  {isCustomDescription ? (
                    <textarea
                      rows={2}
                      value={customDescription}
                      onChange={(e) => setCustomDescription(e.target.value)}
                      placeholder="اكتب مواصفات وتفاصيل الخدمة أو السلعة المطلوبة هنا..."
                      className="w-full p-2.5 bg-white border border-indigo-400 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 text-slate-900 text-xs shadow-xs"
                    />
                  ) : (
                    <select
                      value={selectedDescPreset}
                      onChange={(e) => {
                        if (e.target.value.startsWith('✏️')) {
                          setIsCustomDescription(true);
                          setCustomDescription('');
                        } else {
                          setSelectedDescPreset(e.target.value);
                        }
                      }}
                      className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none font-semibold text-slate-900"
                    >
                      {EXPENSE_DESCRIPTION_TEMPLATES.map((tpl) => (
                        <option key={tpl} value={tpl}>{tpl}</option>
                      ))}
                    </select>
                  )}
                </div>
              </div>
            )}

          </div>

          {/* Validation & Error Message Banner (Always visible above footer buttons) */}
          {formError && (
            <div className="shrink-0 px-5 py-3 bg-rose-50 border-t border-rose-200 flex items-center justify-between text-xs text-rose-800 font-bold animate-in fade-in">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-rose-600 shrink-0" />
                <span>{formError}</span>
              </div>
              <button
                type="button"
                onClick={() => setFormError(null)}
                className="text-rose-600 hover:text-rose-800 p-1 rounded-lg cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          {/* Footer Buttons */}
          <div className="shrink-0 flex items-center justify-between gap-3 p-4 border-t border-slate-100 bg-slate-50/80">
            <div className="text-[11px] font-bold text-slate-500 flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${requestType === 'income' ? 'bg-emerald-500' : 'bg-rose-500'}`} />
              <span>العملية: {requestType === 'income' ? 'توريد مالي (+ IN)' : 'صرف ومصروف (- OUT)'}</span>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleClose}
                className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-xl transition cursor-pointer font-medium"
              >
                إلغاء
              </button>
              <button
                type="submit"
                disabled={submitting}
                className={`px-6 py-2.5 text-white font-bold rounded-xl shadow-md transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 ${
                  isEditMode
                    ? 'bg-indigo-600 hover:bg-indigo-700 shadow-indigo-500/20'
                    : requestType === 'income'
                    ? 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-500/20'
                    : 'bg-rose-600 hover:bg-rose-700 shadow-rose-500/20'
                }`}
              >
                {submitting ? (
                  'جاري الحفظ...'
                ) : isEditMode ? (
                  <>
                    <CheckCircle2 className="h-4 w-4" />
                    <span>حفظ التعديلات على الطلب</span>
                  </>
                ) : requestType === 'income' ? (
                  <>
                    <ArrowDownLeft className="h-4 w-4" />
                    <span>📥 إرسال طلب التوريد للمراجعة والاستلام (+ IN)</span>
                  </>
                ) : (
                  <>
                    <ArrowUpRight className="h-4 w-4" />
                    <span>إرسال طلب الصرف للاعتماد (- OUT)</span>
                  </>
                )}
              </button>
            </div>
          </div>

        </form>
      </div>

      {/* Preview Modal for Invoice Attachment */}
      {previewModalUrl && (
        <div 
          className="fixed inset-0 z-60 flex items-center justify-center bg-slate-950/80 backdrop-blur-xs p-4 animate-in fade-in"
          onClick={() => setPreviewModalUrl(null)}
        >
          <div 
            className="bg-white rounded-3xl max-w-3xl w-full max-h-[90vh] overflow-hidden shadow-2xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-4 border-b border-slate-200 bg-slate-50">
              <div className="flex items-center gap-2">
                <Receipt className="h-5 w-5 text-amber-600" />
                <span className="font-bold text-slate-800 text-sm truncate max-w-md">{previewModalUrl.name}</span>
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={previewModalUrl.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3 py-1 text-xs font-bold text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 rounded-lg transition"
                >
                  فتح في نافذة منفصلة ↗
                </a>
                <button
                  type="button"
                  onClick={() => setPreviewModalUrl(null)}
                  className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-200 rounded-lg transition cursor-pointer"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>
            <div className="p-4 flex-1 overflow-auto flex items-center justify-center bg-slate-100 min-h-[300px]">
              {previewModalUrl.type === 'pdf' || previewModalUrl.name.toLowerCase().endsWith('.pdf') ? (
                <iframe
                  src={previewModalUrl.url}
                  title="PDF Preview"
                  className="w-full h-[65vh] rounded-xl border border-slate-300"
                />
              ) : (
                <img
                  src={previewModalUrl.url}
                  alt="Preview"
                  className="max-h-[70vh] max-w-full object-contain rounded-xl shadow-md"
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
