import React, { useState, useEffect, useMemo } from 'react';
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
  Zap
} from 'lucide-react';
import { PaymentMethod, SUPPORTED_CURRENCIES, isServiceMatchingOrg, RequestType, ServiceCategory } from '../types';
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
}

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

const INCOME_QUICK_TEMPLATES = [
  {
    label: '⚡ توريد مبيعات مندوب',
    title: 'توريد مبيعات نقدية من المندوب',
    description: 'توريد وتحصيل مبيعات نقدية محصلة من العملاء عبر المندوب',
    keywords: ['مبيعات', 'تحصيل', 'توريد', 'مندوب', 'نقدية', 'إيراد'],
  },
  {
    label: '⚡ تحصيل دفعة عميل',
    title: 'تحصيل دفعة مالية من حساب عميل',
    description: 'تحصيل وسداد دفعة مستحقة عن فاتورة مبيعات أو تعاقد',
    keywords: ['عميل', 'تحصيل', 'دفعة', 'فاتورة', 'مستحقات', 'تعاقد'],
  },
  {
    label: '⚡ إيداع نقدي بالخزينة',
    title: 'إيداع نقدي في خزينة الشركة',
    description: 'إيداع سيولة نقدية مباشرة في الخزينة أو الحساب البنكي',
    keywords: ['إيداع', 'خزينة', 'سيولة', 'كاش', 'بنك'],
  },
  {
    label: '⚡ توريد متبقي عهدة',
    title: 'توريد وتصفية متبقي عهدة نقدية',
    description: 'إرجاع وتوريد الفائض النقدي المتبقي من عهدة سابقة لموظف',
    keywords: ['عهدة', 'متبقي', 'تصفية', 'فائض', 'استرداد'],
  },
  {
    label: '⚡ استرداد مالي / مرتجع',
    title: 'استرداد مالي لمشتريات أو تأمين مسترد',
    description: 'تحصيل قيمة مرتجع بضاعة أو استرداد تأمين معتمد',
    keywords: ['استرداد', 'مرتجع', 'تأمين', 'مردودات'],
  },
];

const EXPENSE_TITLE_TEMPLATES = [
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

const INCOME_TITLE_TEMPLATES = [
  'توريد مبيعات نقدية من المندوب',
  'تحصيل دفعة مالية من حساب عميل',
  'إيداع مالي مباشر في حساب إنستاباي / البنك للشركة',
  'توريد وتصفية متبقي عهدة نقدية من موظف',
  'استرداد قيمة مرتجع بضاعة ومشتريات من مورد',
  'تحصيل شيك أو مستحقات مبيعات آجلة',
  'إيرادات خدمات واستشارات محصلة',
  '✏️ كتابة موضوع وعنوان توريد مخصص يدوي...',
];

const EXPENSE_JUSTIFICATION_TEMPLATES = [
  'دعم استمرارية العمليات اليومية وتفادي انقطاع الخدمة',
  'تنفيذ مهام عمل رسمية معتمدة من الإدارة لصالح الشركة',
  'زيادة كفاءة الإنتاجية وتطوير أدوات فريق العمل',
  'تغطية تكاليف سفر ومهمة عمل رسمية خارج المقر',
  'تجديد دوري سنوي/شهري متفق عليه في الميزانية التشغيلية',
  'متطلبات عاجلة للمشروع لضمان التسليم في الموعد المحدد',
  '✏️ كتابة مبرر مالي مخصص يدوي...',
];

const INCOME_JUSTIFICATION_TEMPLATES = [
  'توريد مبالغ نقدية محصلة عن مبيعات الفترة',
  'سداد مستحقات فاتورة بيع للعميل المعتمد',
  'إرجاع وتسوية فائض مالي متبقي من عهدة سابقة',
  'تعزيز السيولة النقدية في حساب وخزينة الشركة',
  'استرداد مالي بموجب إشعار تسوية رسمي',
  '✏️ كتابة مبرر توريد مخصص يدوي...',
];

const EXPENSE_DESCRIPTION_TEMPLATES = [
  'تمت مراجعة التكلفة ومطابقة العروض المقدمة للحصول على أفضل سعر وأعلى كفاءة.',
  'شراء وتفعيل الخدمة فوراً لخدمة أهداف ومشاريع الشركة المعتمدة.',
  'سداد مباشر للفواتير والمستحقات المرفقة مع الطلب بعد التحقق منها.',
  'تغطية مصاريف الرحلة الرسمية والانتقالات بموجب الإيصالات والتفويض.',
  '✏️ كتابة تفاصيل ومواصفات مخصصة...',
];

const INCOME_DESCRIPTION_TEMPLATES = [
  'تم استلام المبلغ نقداً / عبر تحويل وسيتم توريده وتأكيده في حساب الخزينة المعتمد.',
  'تحصيل مستحقات مبيعات وفقاً لدفاتر وأذونات التسليم والفواتير الرسمية.',
  'إيداع بنكي مباشر بموجب إشعار التحويل المرفق لتعزيز الأرصدة.',
  'تصفية عهدة نقدية وتسليم المتبقي غير المنصرف لأمين الخزينة.',
  '✏️ كتابة تفاصيل وبيان توريد مخصص...',
];

export const NewRequestModal: React.FC<NewRequestModalProps> = ({ isOpen, onClose }) => {
  const { 
    organizations,
    allOrganizations,
    services, 
    allServices,
    providers, 
    allProviders,
    paymentAccounts,
    allPaymentAccounts,
    activeOrg, 
    activeOrgId, 
    createRequest, 
    currentUser,
    currentRole
  } = useApp();

  const isSuperAdmin = currentRole === 'super_admin';
  const orgList = isSuperAdmin ? (allOrganizations?.length ? allOrganizations : organizations) : organizations;

  // Selected target organization
  const [selectedOrgId, setSelectedOrgId] = useState<string>(() => {
    if (activeOrgId && activeOrgId !== 'all') return activeOrgId;
    if (currentUser?.orgId) return currentUser.orgId;
    return orgList[0]?.id || '';
  });

  useEffect(() => {
    if (activeOrgId && activeOrgId !== 'all') {
      setSelectedOrgId(activeOrgId);
    } else if (!selectedOrgId && orgList.length > 0) {
      setSelectedOrgId(currentUser?.orgId || orgList[0].id);
    }
  }, [activeOrgId, orgList, currentUser]);

  const currentOrg = orgList.find(o => o.id === selectedOrgId) || activeOrg;

  // Real, Approved Services and Providers strictly linked to this organization
  const sourceServices = isSuperAdmin ? (allServices?.length ? allServices : services) : services;
  const sourceProviders = isSuperAdmin ? (allProviders?.length ? allProviders : providers) : providers;
  const sourcePaymentAccounts = isSuperAdmin ? (allPaymentAccounts?.length ? allPaymentAccounts : paymentAccounts) : paymentAccounts;

  const availableServices = useMemo(() => {
    if (!selectedOrgId) return [];
    return sourceServices.filter(s => isServiceMatchingOrg(s, selectedOrgId));
  }, [sourceServices, selectedOrgId]);

  const availableProviders = useMemo(() => {
    if (!selectedOrgId) return [];
    return sourceProviders.filter(p => p.orgId === selectedOrgId);
  }, [sourceProviders, selectedOrgId]);

  const availableAccounts = useMemo(() => {
    if (!selectedOrgId) return [];
    return sourcePaymentAccounts.filter(a => a.orgId === selectedOrgId && a.active);
  }, [sourcePaymentAccounts, selectedOrgId]);

  // Request Type & Target Account & Goods details
  const [requestType, setRequestType] = useState<RequestType>('expense');
  const [targetAccountId, setTargetAccountId] = useState<string>('');
  const [itemsDetail, setItemsDetail] = useState('');

  // Selected Service & Provider IDs
  const [selectedServiceId, setSelectedServiceId] = useState<string>('');
  const [selectedProviderId, setSelectedProviderId] = useState<string>('');

  useEffect(() => {
    if (availableServices.length > 0) {
      if (!availableServices.some(s => s.id === selectedServiceId)) {
        setSelectedServiceId(availableServices[0].id);
      }
    } else {
      setSelectedServiceId('');
    }
  }, [availableServices, selectedServiceId]);

  useEffect(() => {
    if (availableProviders.length > 0) {
      if (!availableProviders.some(p => p.id === selectedProviderId)) {
        setSelectedProviderId(availableProviders[0].id);
      }
    } else {
      setSelectedProviderId('');
    }
  }, [availableProviders, selectedProviderId]);

  // Title State (Dropdown or Custom)
  const [isCustomTitle, setIsCustomTitle] = useState(false);
  const [selectedTitlePreset, setSelectedTitlePreset] = useState(EXPENSE_TITLE_TEMPLATES[0]);
  const [customTitle, setCustomTitle] = useState('');

  // Description & Justification (Dropdown or Custom)
  const [isCustomJustification, setIsCustomJustification] = useState(false);
  const [selectedJustPreset, setSelectedJustPreset] = useState(EXPENSE_JUSTIFICATION_TEMPLATES[0]);
  const [customJustification, setCustomJustification] = useState('');

  const [isCustomDescription, setIsCustomDescription] = useState(false);
  const [selectedDescPreset, setSelectedDescPreset] = useState(EXPENSE_DESCRIPTION_TEMPLATES[0]);
  const [customDescription, setCustomDescription] = useState('');

  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState(currentOrg?.currency || activeOrg?.currency || 'EGP');
  const [urgency, setUrgency] = useState<'low' | 'medium' | 'high'>('medium');
  const [preferredPaymentMethod, setPreferredPaymentMethod] = useState<PaymentMethod>('instapay');
  const [paymentAccountDetails, setPaymentAccountDetails] = useState(currentUser.phone || '');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (currentOrg?.currency) {
      setCurrency(currentOrg.currency);
    }
  }, [currentOrg]);

  // Active Template Sets based on operation type
  const activeQuickTemplates = requestType === 'income' ? INCOME_QUICK_TEMPLATES : EXPENSE_QUICK_TEMPLATES;
  const activeTitleTemplates = requestType === 'income' ? INCOME_TITLE_TEMPLATES : EXPENSE_TITLE_TEMPLATES;
  const activeJustificationTemplates = requestType === 'income' ? INCOME_JUSTIFICATION_TEMPLATES : EXPENSE_JUSTIFICATION_TEMPLATES;
  const activeDescriptionTemplates = requestType === 'income' ? INCOME_DESCRIPTION_TEMPLATES : EXPENSE_DESCRIPTION_TEMPLATES;

  // Responsive switch between Expense (Outflow) and Income (Inflow)
  const handleSwitchRequestType = (type: RequestType) => {
    if (type === requestType) return;
    setRequestType(type);
    setIsCustomTitle(false);
    setIsCustomJustification(false);
    setIsCustomDescription(false);
    setCustomTitle('');
    setCustomJustification('');
    setCustomDescription('');

    if (type === 'income') {
      setSelectedTitlePreset(INCOME_TITLE_TEMPLATES[0]);
      setSelectedJustPreset(INCOME_JUSTIFICATION_TEMPLATES[0]);
      setSelectedDescPreset(INCOME_DESCRIPTION_TEMPLATES[0]);
      if (availableAccounts.length > 0 && !targetAccountId) {
        setTargetAccountId(availableAccounts[0].id);
      }
      setPreferredPaymentMethod('cash');
      setPaymentAccountDetails(currentUser.name ? `المودع: ${currentUser.name}` : 'استلام نقدي بالخزينة');
    } else {
      setSelectedTitlePreset(EXPENSE_TITLE_TEMPLATES[0]);
      setSelectedJustPreset(EXPENSE_JUSTIFICATION_TEMPLATES[0]);
      setSelectedDescPreset(EXPENSE_DESCRIPTION_TEMPLATES[0]);
      setPreferredPaymentMethod('instapay');
      setPaymentAccountDetails(currentUser.phone || '');
    }
  };

  if (!isOpen) return null;

  // Computed Values - Never duplicate controls
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
    // 1. If it has fixedAccountRef, auto-set or append to itemsDetail
    if (srv.fixedAccountRef) {
      const refTag = `(الرقم المرجعي / كود العداد: ${srv.fixedAccountRef})`;
      setItemsDetail(prev => {
        if (!prev) return refTag;
        if (prev.includes(srv.fixedAccountRef!)) return prev;
        return `${prev} - ${refTag}`;
      });
    }

    // 2. If it has vendorId and matching provider exists in providers list, auto-select that provider!
    if (srv.vendorId && availableProviders.some(p => p.id === srv.vendorId)) {
      setSelectedProviderId(srv.vendorId);
    }

    // 3. If it has defaultPaymentMethod, auto-select preferredPaymentMethod!
    if (srv.defaultPaymentMethod) {
      setPreferredPaymentMethod(srv.defaultPaymentMethod);
    }

    // 4. If it has defaultAccountId and matching account exists, auto-select targetAccountId!
    if (srv.defaultAccountId && availableAccounts.some(a => a.id === srv.defaultAccountId)) {
      setTargetAccountId(srv.defaultAccountId);
    }
  };

  // Quick Template Activation
  const applyQuickTemplate = (tpl: { label: string; title: string; description: string; keywords: string[] }) => {
    setIsCustomTitle(true);
    setCustomTitle(tpl.title);
    setIsCustomDescription(true);
    setCustomDescription(tpl.description);

    // Automatically match service category
    const matched = availableServices.find(s => {
      const sName = s.name.toLowerCase();
      const sDesc = (s.description || '').toLowerCase();
      return tpl.keywords.some(k => sName.includes(k.toLowerCase()) || sDesc.includes(k.toLowerCase()));
    });

    if (matched) {
      setSelectedServiceId(matched.id);
      applyServiceCategoryDefaults(matched);
    }
  };

  const handleClose = () => {
    setRequestType('expense');
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
    setPaymentAccountDetails(currentUser.phone || '');
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!effectiveTitle.trim() || !amount || Number(amount) <= 0 || submitting) return;

    const isIncome = requestType === 'income';

    let serviceId = selectedServiceId;
    let serviceName = '';
    const selectedService = availableServices.find(s => s.id === selectedServiceId);
    if (selectedService) {
      serviceName = selectedService.name;
    } else if (isIncome) {
      serviceId = availableServices[0]?.id || 'income-service';
      serviceName = availableServices[0]?.name || 'توريدات ومتحصلات نقدية';
    } else {
      alert('يرجى اختيار بند خدمة معتمد ومسجل لدى المؤسسة للمتابعة.');
      return;
    }

    let providerId = selectedProviderId;
    let providerName = '';
    const selectedProvider = availableProviders.find(p => p.id === selectedProviderId);
    if (selectedProvider) {
      providerName = selectedProvider.name;
    } else if (isIncome) {
      providerId = availableProviders[0]?.id || 'income-source';
      providerName = availableProviders[0]?.name || (paymentAccountDetails ? `المودع: ${paymentAccountDetails}` : 'توريد مباشر / عميل');
    } else {
      alert('يرجى اختيار مورد معتمد ومسجل لدى المؤسسة للمتابعة.');
      return;
    }

    // For Income, verify target account if accounts exist
    if (isIncome && availableAccounts.length > 0 && !targetAccountId) {
      alert('يرجى تحديد حساب أو خزينة الشركة المستلمة للتوريد.');
      return;
    }

    setSubmitting(true);
    try {
      await createRequest({
        title: effectiveTitle.trim(),
        description: effectiveDescription.trim(),
        justification: effectiveJustification.trim(),
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
        attachmentNames: [],
        preferredPaymentMethod,
        paymentAccountDetails: paymentAccountDetails.trim(),
        orgId: selectedOrgId,
      });

      handleClose();
    } catch (err) {
      console.error('[NewRequestModal] Error creating request:', err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-3 sm:p-4 overflow-y-auto">
      <div 
        className="bg-white rounded-3xl max-w-2xl w-full max-h-[92vh] shadow-2xl border border-slate-100 flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150 my-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className={`shrink-0 flex items-center justify-between p-4 sm:p-5 border-b sticky top-0 z-10 transition-colors ${
          requestType === 'income'
            ? 'border-emerald-100 bg-gradient-to-r from-emerald-50/95 via-teal-50/50 to-white'
            : 'border-slate-100 bg-slate-50/80'
        }`}>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-bold text-slate-900">
                {requestType === 'income' ? '📥 إنشاء طلب توريد وتحصيل مالي (Inflow)' : '💸 إنشاء طلب صرف ومطالبة مالية (Outflow)'}
              </h3>
              <span className={`px-2 py-0.5 rounded-md text-[10px] font-black ${
                requestType === 'income'
                  ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                  : 'bg-rose-100 text-rose-800 border border-rose-300'
              }`}>
                {requestType === 'income' ? '+ إيداع وتوريد' : '- منصرف مالي'}
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              {requestType === 'income'
                ? 'تسجيل وإيداع مبالغ نقدية أو مبيعات أو عهد مستردة لحساب وخزينة الشركة'
                : 'اختر النماذج الجاهزة أو اكتب بياناتك المخصصة لصرف المبلغ بنقرة واحدة'}
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Form Container */}
        <form onSubmit={handleSubmit} className="flex-1 flex flex-col min-h-0 overflow-hidden">
          
          {/* Scrollable Form Body */}
          <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-4 text-xs">
          
            {/* Quick Request Templates Bar (قوالب سريعة للطلبات المتكررة) */}
            <div className={`p-3.5 rounded-2xl border shadow-2xs space-y-2 transition-all ${
              requestType === 'income'
                ? 'bg-gradient-to-r from-emerald-50/90 via-teal-50/70 to-blue-50/90 border-emerald-200/90'
                : 'bg-gradient-to-r from-indigo-50/90 via-purple-50/70 to-blue-50/90 border-indigo-100/90'
            }`}>
              <div className="flex items-center justify-between">
                <span className={`font-black text-xs flex items-center gap-1.5 ${
                  requestType === 'income' ? 'text-emerald-950' : 'text-indigo-950'
                }`}>
                  <Zap className={`h-4 w-4 ${requestType === 'income' ? 'text-emerald-600 fill-emerald-600' : 'text-indigo-600 fill-indigo-600'}`} />
                  <span>{requestType === 'income' ? 'قوالب سريعة لتوريدات ومتحصلات نقدية (+ IN):' : 'قوالب سريعة لمصروفات متكررة (- OUT):'}</span>
                </span>
                <span className={`text-[10px] font-bold ${requestType === 'income' ? 'text-emerald-700' : 'text-indigo-600/80'}`}>
                  تعبئة وتحديد آلي للبنود بنقرة واحدة
                </span>
              </div>

              <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-thin">
                {activeQuickTemplates.map((tpl) => (
                  <button
                    key={tpl.label}
                    type="button"
                    onClick={() => applyQuickTemplate(tpl)}
                    className={`shrink-0 px-3.5 py-2 bg-white rounded-xl text-xs font-bold transition-all duration-150 shadow-2xs hover:shadow-xs cursor-pointer active:scale-95 flex items-center gap-1.5 border ${
                      requestType === 'income'
                        ? 'hover:bg-emerald-600 hover:text-white text-emerald-900 border-emerald-200/80'
                        : 'hover:bg-indigo-600 hover:text-white text-indigo-900 border-indigo-200/80'
                    }`}
                    title={`تطبيق قالب سريع: ${tpl.title}`}
                  >
                    <span>{tpl.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Operation / Request Type Selector (Inflow vs Outflow) */}
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
                    <Building2 className="h-4 w-4 text-emerald-600" />
                    المؤسسة / الشركة المستهدفة بالطلب *
                  </label>
                  <span className="text-[10px] text-emerald-700 bg-emerald-100/70 font-bold px-2 py-0.5 rounded-full">
                    تحديد بصلاحية مدير النظام
                  </span>
                </div>
                <select
                  value={selectedOrgId}
                  onChange={(e) => setSelectedOrgId(e.target.value)}
                  className="w-full p-2.5 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 font-bold text-slate-900 text-xs"
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
                  <Building2 className="h-4 w-4 text-emerald-600" />
                  <span className="text-slate-600 font-semibold">المؤسسة التابع لها الطلب:</span>
                  <span className="font-bold text-slate-900">{currentOrg?.name || 'المؤسسة المعتمدة'}</span>
                </div>
                {currentOrg?.code && (
                  <span className="px-2.5 py-1 bg-emerald-100 text-emerald-800 rounded-lg font-black text-[11px]">
                    {currentOrg.code}
                  </span>
                )}
              </div>
            )}

            {/* 1. Title Selection (Single clean control, zero duplicate inputs) */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="font-bold text-slate-700">
                  {requestType === 'income' ? 'موضوع وبيان التوريد / التحصيل *' : 'موضوع وعنوان الطلب *'}
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setIsCustomTitle(!isCustomTitle);
                    if (!isCustomTitle && !customTitle) {
                      setCustomTitle(selectedTitlePreset.startsWith('✏️') ? '' : selectedTitlePreset);
                    }
                  }}
                  className="text-[11px] text-emerald-600 hover:text-emerald-700 font-bold flex items-center gap-1 cursor-pointer transition hover:underline"
                >
                  {isCustomTitle ? '📋 اختيار من القائمة المنسدلة' : '✏️ كتابة عنوان مخصص'}
                </button>
              </div>

              {isCustomTitle ? (
                <input
                  type="text"
                  required
                  autoFocus
                  value={customTitle}
                  onChange={(e) => setCustomTitle(e.target.value)}
                  placeholder={requestType === 'income' ? 'اكتب موضوع وبيان التوريد أو التحصيل هنا...' : 'اكتب موضوع وعنوان الطلب بالتفصيل هنا...'}
                  className="w-full p-2.5 bg-white border border-emerald-400 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 text-slate-900 font-medium text-xs shadow-xs animate-in fade-in"
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
                  }}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 font-bold text-slate-900"
                >
                  {activeTitleTemplates.map((tpl) => (
                    <option key={tpl} value={tpl}>{tpl}</option>
                  ))}
                </select>
              )}
            </div>

            {/* 2. Service & Provider Dropdowns (Strictly real approved company records) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Service Category Dropdown */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="font-bold text-slate-700 flex items-center gap-1">
                    <Layers className="h-3.5 w-3.5 text-emerald-600" />
                    <span>{requestType === 'income' ? 'بند الإيراد / التوريد' : 'بند الخدمة / مركز التكلفة *'}</span>
                  </label>
                  <span className="text-[10px] text-slate-400 font-bold">
                    ({availableServices.length} بند معتمد)
                  </span>
                </div>

                {availableServices.length > 0 ? (
                  <select
                    required={requestType === 'expense'}
                    value={selectedServiceId}
                    onChange={(e) => {
                      const sId = e.target.value;
                      setSelectedServiceId(sId);
                      const srv = availableServices.find(s => s.id === sId);
                      if (srv) {
                        applyServiceCategoryDefaults(srv);
                      }
                    }}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 font-bold text-slate-900 text-xs"
                  >
                    {availableServices.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} {s.code ? `(${s.code})` : ''}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 text-[11px] font-semibold flex items-center gap-1.5">
                    <AlertCircle className="h-4 w-4 shrink-0 text-amber-600" />
                    <span>{requestType === 'income' ? 'سيتم تسجيل التوريد كإيراد عام مباشر للمؤسسة.' : 'لا توجد بنود خدمة معتمدة لهذه المؤسسة حتى الآن.'}</span>
                  </div>
                )}
              </div>

              {/* Provider Dropdown */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="font-bold text-slate-700 flex items-center gap-1">
                    <Building className="h-3.5 w-3.5 text-emerald-600" />
                    <span>{requestType === 'income' ? 'العميل / جهة التوريد' : 'مقدم الخدمة / المورد *'}</span>
                  </label>
                  <span className="text-[10px] text-slate-400 font-bold">
                    ({availableProviders.length} مورد معتمد)
                  </span>
                </div>

                {availableProviders.length > 0 ? (
                  <select
                    required={requestType === 'expense'}
                    value={selectedProviderId}
                    onChange={(e) => setSelectedProviderId(e.target.value)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 font-bold text-slate-900 text-xs"
                  >
                    {availableProviders.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} {p.contactPerson ? `(مسؤول: ${p.contactPerson})` : ''}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 text-[11px] font-semibold flex items-center gap-1.5">
                    <AlertCircle className="h-4 w-4 shrink-0 text-amber-600" />
                    <span>{requestType === 'income' ? 'توريد نقدي مباشر لحساب الخزينة بدون وسيط.' : 'لا يوجد موردون معتمدون مسجلون لهذه المؤسسة.'}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Warning if company has no services or providers (Only for Outflow Expense) */}
            {requestType === 'expense' && (availableServices.length === 0 || availableProviders.length === 0) && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-2xl flex items-start gap-2 text-amber-900 text-xs animate-in fade-in">
                <AlertCircle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                <div>
                  <span className="font-bold">تنبيه الحوكمة المالية: </span>
                  <span>
                    يجب أن تحتوي الشركة على بنود صرف وموردين معتمدين مسبقاً مسجلين من قبل مدير النظام (Admin) قبل تقديم الطلب. بصفتك موظفاً، لا يمكنك إنشاء بنود أو موردين مباشرة من نموذج الطلب؛ يرجى التواصل مع مدير النظام لاعتمادها أولاً.
                  </span>
                </div>
              </div>
            )}

            {/* 3. Amount, Currency & Urgency */}
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
              <div className="sm:col-span-5">
                <label className="block font-bold text-slate-700 mb-1">
                  {requestType === 'income' ? 'المبلغ المورد والمحصل (+ IN) *' : 'المبلغ المطلوب صرفه (- OUT) *'}
                </label>
                <div className="relative">
                  <input
                    type="text"
                    inputMode="decimal"
                    required
                    value={amount}
                    onKeyDown={(e) => handleNumericKeyDown(e, true)}
                    onChange={(e) => setAmount(sanitizeAmount(e.target.value))}
                    placeholder="0.00"
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 font-bold text-slate-900 pl-20 text-sm"
                  />
                  <span className={`absolute left-2.5 top-2.5 px-2 py-0.5 rounded-lg text-xs font-black select-none pointer-events-none flex items-center gap-1 ${
                    requestType === 'income'
                      ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                      : 'bg-rose-100 text-rose-800 border border-rose-300'
                  }`}>
                    <span>{requestType === 'income' ? '+' : '-'}</span>
                    <span>{currency}</span>
                  </span>
                </div>
              </div>

              <div className="sm:col-span-4">
                <label className="block font-bold text-slate-700 mb-1">
                  {requestType === 'income' ? 'عملة التوريد *' : 'عملة الصرف *'}
                </label>
                <select
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none font-bold text-xs"
                >
                  {SUPPORTED_CURRENCIES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="sm:col-span-3">
                <label className="block font-bold text-slate-700 mb-1">مستوى السرعة والأولوية *</label>
                <select
                  value={urgency}
                  onChange={(e: any) => setUrgency(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none font-bold"
                >
                  <option value="low">🟢 عادي / روتيني</option>
                  <option value="medium">🟡 متوسط الأهمية</option>
                  <option value="high">🔴 عاجل وهام جداً</option>
                </select>
              </div>
            </div>

            {/* 4. Inflow vs Outflow Payment & Destination Details */}
            {requestType === 'income' ? (
              <div className="bg-emerald-50/70 p-4 rounded-2xl border border-emerald-200/90 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 font-bold text-emerald-950 text-xs">
                    <Landmark className="h-4 w-4 text-emerald-600" />
                    <span>📥 بيانات إيداع وتوريد المبلغ في خزينة / حساب الشركة</span>
                  </div>
                  <span className="text-[10px] font-bold text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded-md">
                    توريد داخل (+ IN)
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* Target Treasury Account (Required for Inflow) */}
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">
                      حساب / خزينة الشركة المودع بها *
                    </label>
                    {availableAccounts.length > 0 ? (
                      <select
                        required
                        value={targetAccountId}
                        onChange={(e) => setTargetAccountId(e.target.value)}
                        className="w-full p-2.5 bg-white border border-emerald-300 rounded-xl font-bold text-slate-800 text-xs focus:ring-2 focus:ring-emerald-500/20"
                      >
                        <option value="">-- اختر حساب أو خزينة الشركة المستلمة --</option>
                        {availableAccounts.map(acc => (
                          <option key={acc.id} value={acc.id}>
                            {acc.name} ({acc.accountIdentifier}) - رصيد: {Number(acc.currentBalance ?? acc.balance ?? 0).toLocaleString()} {acc.currency}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <div className="p-2 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 text-[11px]">
                        لا توجد حسابات خزينة معرفة لهذه المؤسسة. يرجى إضافتها من إدارة الخزينة.
                      </div>
                    )}
                  </div>

                  {/* Deposit Method */}
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">طريقة استلام التوريد *</label>
                    <select
                      value={preferredPaymentMethod}
                      onChange={(e: any) => {
                        setPreferredPaymentMethod(e.target.value);
                      }}
                      className="w-full p-2.5 bg-white border border-slate-200 rounded-xl font-bold text-xs"
                    >
                      <option value="cash">نقداً في خزينة الشركة (كاش)</option>
                      <option value="instapay">تحويل إنستاباي لحساب الشركة</option>
                      <option value="bank_transfer">إيداع / تحويل بنكي فوري للشركة</option>
                      <option value="digital_wallet">تحويل محفظة إلكترونية (فودافون كاش / اتصالات)</option>
                    </select>
                  </div>

                  {/* Depositor / Client Name */}
                  <div className="sm:col-span-2">
                    <label className="block font-bold text-slate-700 mb-1">
                      اسم المودع / العميل / المندوب المسلم للمبلغ *
                    </label>
                    <input
                      type="text"
                      required
                      value={paymentAccountDetails}
                      onChange={(e) => setPaymentAccountDetails(e.target.value)}
                      placeholder="مثال: المندوب أحمد محمود - فرع المعادي أو شركة النور للتوزيع..."
                      className="w-full p-2.5 bg-white border border-slate-200 rounded-xl text-slate-900 font-medium text-xs"
                    />
                  </div>
                </div>
              </div>
            ) : (
              /* Expense / Outflow Payment Details */
              <div className="bg-rose-50/60 p-4 rounded-2xl border border-rose-200/80 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 font-bold text-rose-950 text-xs">
                    <CreditCard className="h-4 w-4 text-rose-600" />
                    <span>💸 بيانات المستفيد والتحويل المصرفي (- OUT)</span>
                  </div>
                  <span className="text-[10px] font-bold text-rose-800 bg-rose-100 px-2 py-0.5 rounded-md">
                    صرف خارج (- OUT)
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">طريقة التحويل المفضلة للمستفيد *</label>
                    <select
                      value={preferredPaymentMethod}
                      onChange={(e: any) => {
                        setPreferredPaymentMethod(e.target.value);
                        setPaymentAccountDetails('');
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
                    <label className="block font-bold text-slate-700 mb-1">
                      {preferredPaymentMethod === 'instapay' ? 'عنوان انستاباي (IPA / رقم الهاتف)' :
                       preferredPaymentMethod === 'digital_wallet' ? 'رقم المحفظة الإلكترونية (أرقام فقط)' :
                       preferredPaymentMethod === 'bank_transfer' ? 'رقم الآيبان (IBAN)' : 'جهة الاستلام'}
                    </label>
                    <input
                      type="text"
                      required
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
                      }}
                      placeholder={
                        preferredPaymentMethod === 'instapay' ? 'user@instapay أو رقم الهاتف' :
                        preferredPaymentMethod === 'digital_wallet' ? '010xxxxxxxx (أرقام فقط)' :
                        preferredPaymentMethod === 'bank_transfer' ? 'EG... / SA... (حروف وأرقام)' : 'الفرع أو الخزينة'
                      }
                      className="w-full p-2.5 bg-white border border-slate-200 rounded-xl font-mono text-xs"
                    />
                  </div>

                  {/* Target Treasury Account for Expense */}
                  {availableAccounts.length > 0 && (
                    <div className="sm:col-span-2">
                      <label className="block font-bold text-slate-800 mb-1 flex items-center gap-1.5">
                        <Landmark className="h-3.5 w-3.5 text-rose-600" />
                        <span>حساب / خزينة الصرف المحول منها (اختياري)</span>
                      </label>
                      <select
                        value={targetAccountId}
                        onChange={(e) => setTargetAccountId(e.target.value)}
                        className="w-full p-2.5 bg-white border border-slate-200 rounded-xl font-bold text-slate-800 text-xs outline-hidden"
                      >
                        <option value="">-- اختياري: سيقوم مسؤول الصرف بتحديده وتأكيده عند التنفيذ --</option>
                        {availableAccounts.map(acc => (
                          <option key={acc.id} value={acc.id}>
                            {acc.name} ({acc.accountIdentifier}) - الرصيد المتاح: {Number(acc.currentBalance ?? acc.balance ?? 0).toLocaleString()} {acc.currency}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Goods / Items Detail (بيانات البضاعة أو الأصناف أو التوريد) */}
            <div className="bg-slate-50 p-3.5 rounded-2xl border border-slate-200/80">
              <label className="block font-bold text-slate-800 mb-1">
                {requestType === 'income'
                  ? '📦 بيانات الفاتورة أو البضاعة المورد قيمتها (اختياري - رقم الفاتورة، الكمية، الصنف)'
                  : '📦 بيانات البضاعة أو الأصناف (اختياري - اسم الصنف، الكمية، سعر الوحدة)'}
              </label>
              <input
                type="text"
                value={itemsDetail}
                onChange={(e) => setItemsDetail(e.target.value)}
                placeholder={
                  requestType === 'income'
                    ? 'مثال: توريد دفعة فاتورة مبيعات #1042، عدد 5 كراتين...'
                    : 'مثال: 10 كراتين بضاعة x 150 ج.م، كود الصنف #205...'
                }
                className="w-full p-2.5 bg-white border border-slate-200 rounded-xl font-medium text-slate-800 text-xs outline-hidden"
              />
            </div>

            {/* 5. Justification Selection (Single clean control, zero duplicate inputs) */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="font-bold text-slate-700">
                  {requestType === 'income' ? 'المبرر والبيان المالي للتوريد *' : 'المبرر المالي للطلب *'}
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setIsCustomJustification(!isCustomJustification);
                    if (!isCustomJustification && !customJustification) {
                      setCustomJustification(selectedJustPreset.startsWith('✏️') ? '' : selectedJustPreset);
                    }
                  }}
                  className="text-[11px] text-emerald-600 hover:text-emerald-700 font-bold flex items-center gap-1 cursor-pointer transition hover:underline"
                >
                  {isCustomJustification ? '📋 اختيار من القائمة المنسدلة' : '✏️ كتابة مبرر مخصص'}
                </button>
              </div>

              {isCustomJustification ? (
                <textarea
                  rows={2}
                  required
                  autoFocus
                  value={customJustification}
                  onChange={(e) => setCustomJustification(e.target.value)}
                  placeholder={requestType === 'income' ? 'اكتب المبرر والبيان المالي للتوريد بالتفصيل هنا...' : 'اكتب المبرر المالي والتشغيلي للطلب بالتفصيل هنا...'}
                  className="w-full p-2.5 bg-white border border-emerald-400 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 text-slate-900 text-xs shadow-xs animate-in fade-in"
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
                  {activeJustificationTemplates.map((tpl) => (
                    <option key={tpl} value={tpl}>{tpl}</option>
                  ))}
                </select>
              )}
            </div>

            {/* 6. Description Selection (Single clean control, zero duplicate inputs) */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="font-bold text-slate-700">
                  {requestType === 'income' ? 'تفاصيل ومواصفات التوريد والتحصيل' : 'تفاصيل ومواصفات الطلب'}
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setIsCustomDescription(!isCustomDescription);
                    if (!isCustomDescription && !customDescription) {
                      setCustomDescription(selectedDescPreset.startsWith('✏️') ? '' : selectedDescPreset);
                    }
                  }}
                  className="text-[11px] text-emerald-600 hover:text-emerald-700 font-bold flex items-center gap-1 cursor-pointer transition hover:underline"
                >
                  {isCustomDescription ? '📋 اختيار من القائمة المنسدلة' : '✏️ كتابة تفاصيل مخصصة'}
                </button>
              </div>

              {isCustomDescription ? (
                <textarea
                  rows={2}
                  autoFocus
                  value={customDescription}
                  onChange={(e) => setCustomDescription(e.target.value)}
                  placeholder={requestType === 'income' ? 'اكتب مواصفات وتفاصيل عملية التوريد أو التحصيل هنا...' : 'اكتب مواصفات وتفاصيل الخدمة أو السلعة المطلوبة هنا...'}
                  className="w-full p-2.5 bg-white border border-emerald-400 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 text-slate-900 text-xs shadow-xs animate-in fade-in"
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
                  {activeDescriptionTemplates.map((tpl) => (
                    <option key={tpl} value={tpl}>{tpl}</option>
                  ))}
                </select>
              )}
            </div>

          </div>

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
                disabled={
                  submitting || 
                  (!effectiveTitle.trim()) || 
                  (!amount || Number(amount) <= 0) ||
                  (requestType === 'expense' && (availableServices.length === 0 || availableProviders.length === 0)) ||
                  (requestType === 'income' && availableAccounts.length > 0 && !targetAccountId)
                }
                className={`px-6 py-2.5 text-white font-bold rounded-xl shadow-md transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 ${
                  requestType === 'income'
                    ? 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-500/20'
                    : 'bg-rose-600 hover:bg-rose-700 shadow-rose-500/20'
                }`}
              >
                {submitting ? (
                  'جاري الإرسال...'
                ) : requestType === 'income' ? (
                  <>
                    <ArrowDownLeft className="h-4 w-4" />
                    <span>إرسال طلب التوريد والتحصيل للاعتماد (+ IN)</span>
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
    </div>
  );
};
