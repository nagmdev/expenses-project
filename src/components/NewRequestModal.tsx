import React, { useState, useEffect, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { 
  X, 
  CreditCard,
  Building2,
  AlertCircle,
  Layers,
  Building
} from 'lucide-react';
import { PaymentMethod, SUPPORTED_CURRENCIES, isServiceMatchingOrg } from '../types';
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

const TITLE_TEMPLATES = [
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

const JUSTIFICATION_TEMPLATES = [
  'دعم استمرارية العمليات اليومية وتفادي انقطاع الخدمة',
  'تنفيذ مهام عمل رسمية معتمدة من الإدارة لصالح الشركة',
  'زيادة كفاءة الإنتاجية وتطوير أدوات فريق العمل',
  'تغطية تكاليف سفر ومهمة عمل رسمية خارج المقر',
  'تجديد دوري سنوي/شهري متفق عليه في الميزانية التشغيلية',
  'متطلبات عاجلة للمشروع لضمان التسليم في الموعد المحدد',
  '✏️ كتابة مبرر مالي مخصص يدوي...',
];

const DESCRIPTION_TEMPLATES = [
  'تمت مراجعة التكلفة ومطابقة العروض المقدمة للحصول على أفضل سعر وأعلى كفاءة.',
  'شراء وتفعيل الخدمة فوراً لخدمة أهداف ومشاريع الشركة المعتمدة.',
  'سداد مباشر للفواتير والمستحقات المرفقة مع الطلب بعد التحقق منها.',
  'تغطية مصاريف الرحلة الرسمية والانتقالات بموجب الإيصالات والتفويض.',
  '✏️ كتابة تفاصيل ومواصفات مخصصة...',
];

export const NewRequestModal: React.FC<NewRequestModalProps> = ({ isOpen, onClose }) => {
  const { 
    organizations,
    allOrganizations,
    services, 
    allServices,
    providers, 
    allProviders,
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

  const availableServices = useMemo(() => {
    if (!selectedOrgId) return [];
    return sourceServices.filter(s => isServiceMatchingOrg(s, selectedOrgId));
  }, [sourceServices, selectedOrgId]);

  const availableProviders = useMemo(() => {
    if (!selectedOrgId) return [];
    return sourceProviders.filter(p => p.orgId === selectedOrgId);
  }, [sourceProviders, selectedOrgId]);

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
  const [selectedTitlePreset, setSelectedTitlePreset] = useState(TITLE_TEMPLATES[0]);
  const [customTitle, setCustomTitle] = useState('');

  // Description & Justification (Dropdown or Custom)
  const [isCustomJustification, setIsCustomJustification] = useState(false);
  const [selectedJustPreset, setSelectedJustPreset] = useState(JUSTIFICATION_TEMPLATES[0]);
  const [customJustification, setCustomJustification] = useState('');

  const [isCustomDescription, setIsCustomDescription] = useState(false);
  const [selectedDescPreset, setSelectedDescPreset] = useState(DESCRIPTION_TEMPLATES[0]);
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

  if (!isOpen) return null;

  // Computed Values - Never duplicate controls
  const effectiveTitle = isCustomTitle 
    ? customTitle 
    : (selectedTitlePreset === '✏️ كتابة موضوع وعنوان مخصص يدوي...' ? customTitle : selectedTitlePreset);

  const effectiveJustification = isCustomJustification 
    ? customJustification 
    : (selectedJustPreset === '✏️ كتابة مبرر مالي مخصص يدوي...' ? customJustification : selectedJustPreset);

  const effectiveDescription = isCustomDescription 
    ? customDescription 
    : (selectedDescPreset === '✏️ كتابة تفاصيل ومواصفات مخصصة...' ? customDescription : selectedDescPreset);

  const handleClose = () => {
    setIsCustomTitle(false);
    setIsCustomJustification(false);
    setIsCustomDescription(false);
    setCustomTitle('');
    setCustomJustification('');
    setCustomDescription('');
    setAmount('');
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!effectiveTitle.trim() || !amount || Number(amount) <= 0 || submitting) return;

    const selectedService = availableServices.find(s => s.id === selectedServiceId);
    const selectedProvider = availableProviders.find(p => p.id === selectedProviderId);

    if (!selectedService) {
      alert('يرجى اختيار بند خدمة معتمد ومسجل لدى المؤسسة للمتابعة.');
      return;
    }
    if (!selectedProvider) {
      alert('يرجى اختيار مورد معتمد ومسجل لدى المؤسسة للمتابعة.');
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
        serviceCategoryId: selectedService.id,
        serviceCategoryName: selectedService.name,
        providerId: selectedProvider.id,
        providerName: selectedProvider.name,
        urgency,
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
        <div className="shrink-0 flex items-center justify-between p-4 sm:p-5 border-b border-slate-100 bg-slate-50/80 sticky top-0 z-10">
          <div>
            <h3 className="text-base font-bold text-slate-900">إنشاء طلب صرف ومطالبة مالية</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              اختر النماذج الجاهزة أو اكتب بياناتك المخصصة بنقرة واحدة
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
                <label className="font-bold text-slate-700">موضوع وعنوان الطلب *</label>
                <button
                  type="button"
                  onClick={() => {
                    setIsCustomTitle(!isCustomTitle);
                    if (!isCustomTitle && !customTitle) {
                      setCustomTitle(selectedTitlePreset !== '✏️ كتابة موضوع وعنوان مخصص يدوي...' ? selectedTitlePreset : '');
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
                  placeholder="اكتب موضوع وعنوان الطلب بالتفصيل هنا..."
                  className="w-full p-2.5 bg-white border border-emerald-400 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 text-slate-900 font-medium text-xs shadow-xs animate-in fade-in"
                />
              ) : (
                <select
                  value={selectedTitlePreset}
                  onChange={(e) => {
                    if (e.target.value === '✏️ كتابة موضوع وعنوان مخصص يدوي...') {
                      setIsCustomTitle(true);
                      setCustomTitle('');
                    } else {
                      setSelectedTitlePreset(e.target.value);
                    }
                  }}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 font-bold text-slate-900"
                >
                  {TITLE_TEMPLATES.map((tpl) => (
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
                    <span>بند الخدمة / مركز التكلفة *</span>
                  </label>
                  <span className="text-[10px] text-slate-400 font-bold">
                    ({availableServices.length} بند معتمد)
                  </span>
                </div>

                {availableServices.length > 0 ? (
                  <select
                    required
                    value={selectedServiceId}
                    onChange={(e) => setSelectedServiceId(e.target.value)}
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
                    <span>لا توجد بنود خدمة معتمدة لهذه المؤسسة حتى الآن.</span>
                  </div>
                )}
              </div>

              {/* Provider Dropdown */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="font-bold text-slate-700 flex items-center gap-1">
                    <Building className="h-3.5 w-3.5 text-emerald-600" />
                    <span>مقدم الخدمة / المورد *</span>
                  </label>
                  <span className="text-[10px] text-slate-400 font-bold">
                    ({availableProviders.length} مورد معتمد)
                  </span>
                </div>

                {availableProviders.length > 0 ? (
                  <select
                    required
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
                    <span>لا يوجد موردون معتمدون مسجلون لهذه المؤسسة.</span>
                  </div>
                )}
              </div>
            </div>

            {/* Warning if company has no services or providers */}
            {(availableServices.length === 0 || availableProviders.length === 0) && (
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
                  المبلغ المطلوب *
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
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 font-bold text-slate-900 pl-16 text-sm"
                  />
                  <span className="absolute left-2.5 top-2.5 px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded-lg text-xs font-black select-none pointer-events-none">
                    {currency}
                  </span>
                </div>
              </div>

              <div className="sm:col-span-4">
                <label className="block font-bold text-slate-700 mb-1">
                  عملة الصرف *
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

            {/* 4. InstaPay / Transfer Details Section */}
            <div className="bg-emerald-50/70 p-4 rounded-2xl border border-emerald-200/80 space-y-3">
              <div className="flex items-center gap-2 font-bold text-emerald-950 text-xs">
                <CreditCard className="h-4 w-4 text-emerald-600" />
                <span>بيانات الصرف والتحويل المصرفي (InstaPay / Bank Transfer)</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">طريقة التحويل المفضلة *</label>
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
              </div>
            </div>

            {/* 5. Justification Selection (Single clean control, zero duplicate inputs) */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="font-bold text-slate-700">المبرر المالي للطلب *</label>
                <button
                  type="button"
                  onClick={() => {
                    setIsCustomJustification(!isCustomJustification);
                    if (!isCustomJustification && !customJustification) {
                      setCustomJustification(selectedJustPreset !== '✏️ كتابة مبرر مالي مخصص يدوي...' ? selectedJustPreset : '');
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
                  placeholder="اكتب المبرر المالي والتشغيلي للطلب بالتفصيل هنا..."
                  className="w-full p-2.5 bg-white border border-emerald-400 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 text-slate-900 text-xs shadow-xs animate-in fade-in"
                />
              ) : (
                <select
                  value={selectedJustPreset}
                  onChange={(e) => {
                    if (e.target.value === '✏️ كتابة مبرر مالي مخصص يدوي...') {
                      setIsCustomJustification(true);
                      setCustomJustification('');
                    } else {
                      setSelectedJustPreset(e.target.value);
                    }
                  }}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none font-semibold text-slate-900"
                >
                  {JUSTIFICATION_TEMPLATES.map((tpl) => (
                    <option key={tpl} value={tpl}>{tpl}</option>
                  ))}
                </select>
              )}
            </div>

            {/* 6. Description Selection (Single clean control, zero duplicate inputs) */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="font-bold text-slate-700">تفاصيل ومواصفات الطلب</label>
                <button
                  type="button"
                  onClick={() => {
                    setIsCustomDescription(!isCustomDescription);
                    if (!isCustomDescription && !customDescription) {
                      setCustomDescription(selectedDescPreset !== '✏️ كتابة تفاصيل ومواصفات مخصصة...' ? selectedDescPreset : '');
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
                  placeholder="اكتب مواصفات وتفاصيل الخدمة أو السلعة المطلوبة هنا..."
                  className="w-full p-2.5 bg-white border border-emerald-400 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 text-slate-900 text-xs shadow-xs animate-in fade-in"
                />
              ) : (
                <select
                  value={selectedDescPreset}
                  onChange={(e) => {
                    if (e.target.value === '✏️ كتابة تفاصيل ومواصفات مخصصة...') {
                      setIsCustomDescription(true);
                      setCustomDescription('');
                    } else {
                      setSelectedDescPreset(e.target.value);
                    }
                  }}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none font-semibold text-slate-900"
                >
                  {DESCRIPTION_TEMPLATES.map((tpl) => (
                    <option key={tpl} value={tpl}>{tpl}</option>
                  ))}
                </select>
              )}
            </div>

          </div>

          {/* Footer Buttons */}
          <div className="shrink-0 flex items-center justify-end gap-3 p-4 border-t border-slate-100 bg-slate-50/80">
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-xl transition cursor-pointer font-medium"
            >
              إلغاء
            </button>
            <button
              type="submit"
              disabled={submitting || availableServices.length === 0 || availableProviders.length === 0 || !effectiveTitle.trim() || !amount || Number(amount) <= 0}
              className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-md transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {submitting ? 'جاري الإرسال...' : 'إرسال الطلب للاعتماد'}
            </button>
          </div>

        </form>
      </div>
    </div>
  );
};
