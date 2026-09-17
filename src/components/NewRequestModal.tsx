import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { 
  X, 
  CreditCard 
} from 'lucide-react';
import { PaymentMethod, SUPPORTED_CURRENCIES } from '../types';
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

const DEFAULT_SERVICE_OPTIONS = [
  'اشتراكات وتراخيص برمجيات وسحابية (SaaS & Cloud)',
  'أجهزة إلكترونية وتجهيزات مكتبية وتقنية',
  'بدلات سفر وانتقالات ومهمات عمل رسمية',
  'حملات تسويق ودعاية وإعلانات ممولة',
  'صيانة ومرافق وضيافة ومصروفات تشغيلية',
  'استشارات قانونية ومهنية ورسوم حكومية',
  'بند خدمة مخصص آخر...',
];

const DEFAULT_PROVIDER_OPTIONS = [
  'شركة اتصالات وإنترنت (فودافون / اتصالات / أورانج)',
  'أمازون للتجارة والتوريدات (Amazon)',
  'مكتبة سمير وعلي / جرير (مستلزمات وأدوات)',
  'شركة مايكروسوفت (Microsoft)',
  'شركة جوجل السحابية (Google Cloud)',
  'خدمات تنقل ومواصلات (أوبر / كريم / تاكسي)',
  'مورد / جهة خارجية مخصصة أخرى...',
];

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
  'موضوع وعنوان مخصص آخر...',
];

const JUSTIFICATION_TEMPLATES = [
  'دعم استمرارية العمليات اليومية وتفادي انقطاع الخدمة',
  'تنفيذ مهام عمل رسمية معتمدة من الإدارة لصالح الشركة',
  'زيادة كفاءة الإنتاجية وتطوير أدوات فريق العمل',
  'تغطية تكاليف سفر ومهمة عمل رسمية خارج المقر',
  'تجديد دوري سنوي/شهري متفق عليه في الميزانية التشغيلية',
  'متطلبات عاجلة للمشروع لضمان التسليم في الموعد المحدد',
  'مبرر مالي مخصص آخر...',
];

const DESCRIPTION_TEMPLATES = [
  'تمت مراجعة التكلفة ومطابقة العروض المقدمة للحصول على أفضل سعر وأعلى كفاءة.',
  'شراء وتفعيل الخدمة فوراً لخدمة أهداف ومشاريع الشركة المعتمدة.',
  'سداد مباشر للفواتير والمستحقات المرفقة مع الطلب بعد التحقق منها.',
  'تغطية مصاريف الرحلة الرسمية والانتقالات بموجب الإيصالات والتفويض.',
  'كتابة تفاصيل ومواصفات مخصصة...',
];

export const NewRequestModal: React.FC<NewRequestModalProps> = ({ isOpen, onClose }) => {
  const { 
    organizations,
    services, 
    providers, 
    activeOrg, 
    activeOrgId, 
    createRequest, 
    addService,
    addProvider,
    currentUser 
  } = useApp();

  const orgServices = activeOrgId && activeOrgId !== 'all' ? services.filter(s => s.orgId === activeOrgId) : services;
  const orgProviders = activeOrgId && activeOrgId !== 'all' ? providers.filter(p => p.orgId === activeOrgId) : providers;

  // Title State (Dropdown + custom text)
  const [selectedTitlePreset, setSelectedTitlePreset] = useState(TITLE_TEMPLATES[0]);
  const [customTitle, setCustomTitle] = useState('');

  // Service State (Dropdown + custom text)
  const [selectedServicePreset, setSelectedServicePreset] = useState<string>(
    orgServices[0]?.id || DEFAULT_SERVICE_OPTIONS[0]
  );
  const [customServiceName, setCustomServiceName] = useState('');

  // Provider State (Dropdown + custom text)
  const [selectedProviderPreset, setSelectedProviderPreset] = useState<string>(
    orgProviders[0]?.id || DEFAULT_PROVIDER_OPTIONS[0]
  );
  const [customProviderName, setCustomProviderName] = useState('');

  // Description & Justification (Dropdown + custom text)
  const [selectedDescPreset, setSelectedDescPreset] = useState(DESCRIPTION_TEMPLATES[0]);
  const [customDescription, setCustomDescription] = useState('');

  const [selectedJustPreset, setSelectedJustPreset] = useState(JUSTIFICATION_TEMPLATES[0]);
  const [customJustification, setCustomJustification] = useState('');

  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState(activeOrg?.currency || 'EGP');
  const [urgency, setUrgency] = useState<'low' | 'medium' | 'high'>('medium');
  const [preferredPaymentMethod, setPreferredPaymentMethod] = useState<PaymentMethod>('instapay');
  const [paymentAccountDetails, setPaymentAccountDetails] = useState(currentUser.phone || '');
  const [submitting, setSubmitting] = useState(false);

  // Sync default selection when services or providers load
  React.useEffect(() => {
    if (orgServices.length > 0 && !services.some(s => s.id === selectedServicePreset)) {
      setSelectedServicePreset(orgServices[0].id);
    }
  }, [orgServices]);

  React.useEffect(() => {
    if (orgProviders.length > 0 && !providers.some(p => p.id === selectedProviderPreset)) {
      setSelectedProviderPreset(orgProviders[0].id);
    }
  }, [orgProviders]);

  React.useEffect(() => {
    if (activeOrg?.currency) {
      setCurrency(activeOrg.currency);
    }
  }, [activeOrg]);

  if (!isOpen) return null;

  const currentEffectiveOrgId = activeOrgId && activeOrgId !== 'all' ? activeOrgId : (organizations[0]?.id || '');

  // Computed Values
  const effectiveTitle = selectedTitlePreset === 'موضوع وعنوان مخصص آخر...' 
    ? customTitle 
    : (customTitle.trim() ? customTitle : selectedTitlePreset);

  const effectiveDescription = selectedDescPreset === 'كتابة تفاصيل ومواصفات مخصصة...'
    ? customDescription
    : (customDescription.trim() ? customDescription : selectedDescPreset);

  const effectiveJustification = selectedJustPreset === 'مبرر مالي مخصص آخر...'
    ? customJustification
    : (customJustification.trim() ? customJustification : selectedJustPreset);

  const isCustomService = selectedServicePreset === 'بند خدمة مخصص آخر...';
  const isCustomProvider = selectedProviderPreset === 'مورد / جهة خارجية مخصصة أخرى...';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!effectiveTitle.trim() || !amount || Number(amount) <= 0 || submitting) return;

    setSubmitting(true);
    try {
      let finalServiceId = '';
      let serviceName = '';

      const matchedExistingService = orgServices.find(s => s.id === selectedServicePreset || s.name === selectedServicePreset);
      if (matchedExistingService) {
        finalServiceId = matchedExistingService.id;
        serviceName = matchedExistingService.name;
      } else {
        serviceName = isCustomService && customServiceName.trim() ? customServiceName.trim() : selectedServicePreset;
        const newSrvId = `srv-${Date.now()}`;
        await addService({
          orgId: currentEffectiveOrgId,
          name: serviceName,
          code: `SRV-${Date.now().toString().slice(-4)}`,
          description: 'بند خدمة مضاف تلقائياً مع الطلب',
          budgetLimit: 50000,
          color: 'emerald',
          iconName: 'folder',
        });
        finalServiceId = newSrvId;
      }

      let finalProviderId = '';
      let providerName = '';

      const matchedExistingProvider = orgProviders.find(p => p.id === selectedProviderPreset || p.name === selectedProviderPreset);
      if (matchedExistingProvider) {
        finalProviderId = matchedExistingProvider.id;
        providerName = matchedExistingProvider.name;
      } else {
        providerName = isCustomProvider && customProviderName.trim() ? customProviderName.trim() : selectedProviderPreset;
        const newProvId = `prov-${Date.now()}`;
        await addProvider({
          orgId: currentEffectiveOrgId,
          name: providerName,
          serviceCategoryIds: finalServiceId ? [finalServiceId] : [],
          serviceCategoryNames: serviceName ? [serviceName] : [],
          contactPerson: 'مسؤول المبيعات',
          phone: currentUser.phone || '+20 100 000 0000',
          email: 'vendor@company.local',
          taxNumber: '300000000',
          crNumber: '101000000',
          bankName: 'المصرف الرئيسي',
          iban: 'EG0000000000000000000000000',
          address: 'جمهورية مصر العربية',
          rating: 5,
          active: true,
        });
        finalProviderId = newProvId;
      }

      await createRequest({
        title: effectiveTitle.trim(),
        description: effectiveDescription.trim(),
        justification: effectiveJustification.trim(),
        amount: Number(amount),
        currency: currency || activeOrg?.currency || 'EGP',
        serviceCategoryId: finalServiceId || 'srv-default',
        providerId: finalProviderId || 'prov-default',
        urgency,
        attachmentNames: [],
        preferredPaymentMethod,
        paymentAccountDetails: paymentAccountDetails.trim(),
        orgId: currentEffectiveOrgId || undefined,
      });

      onClose();
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
              كافة الحقول الأساسية تدعم الاختيار الفوري من القوائم المنسدلة (Dropdown) مع خيار التخصيص
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Form Container */}
        <form onSubmit={handleSubmit} className="flex-1 flex flex-col min-h-0 overflow-hidden">
          
          {/* Scrollable Form Body */}
          <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-4 text-xs">
          
            {/* 1. Title Dropdown */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="font-bold text-slate-700">موضوع وعنوان الطلب (قائمة منسدلة) *</label>
                <span className="text-[11px] text-emerald-600 font-semibold">اختر النموذج المناسب</span>
              </div>
              <select
                value={selectedTitlePreset}
                onChange={(e) => {
                  setSelectedTitlePreset(e.target.value);
                  if (e.target.value !== 'موضوع وعنوان مخصص آخر...') {
                    setCustomTitle(e.target.value);
                  }
                }}
                className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 font-bold text-slate-900"
              >
                {TITLE_TEMPLATES.map((tpl) => (
                  <option key={tpl} value={tpl}>{tpl}</option>
                ))}
              </select>

              {/* Editable or custom title text */}
              <input
                type="text"
                required
                value={customTitle || (selectedTitlePreset !== 'موضوع وعنوان مخصص آخر...' ? selectedTitlePreset : '')}
                onChange={(e) => setCustomTitle(e.target.value)}
                placeholder="تعديل العنوان أو كتابة عنوان مخصص هنا..."
                className="w-full mt-2 p-2.5 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 text-slate-900 text-xs"
              />
            </div>

            {/* 2. Service & Provider Dropdowns */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Service Category Dropdown */}
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  بند الخدمة / مركز التكلفة (قائمة منسدلة) *
                </label>
                <select
                  required
                  value={selectedServicePreset}
                  onChange={(e) => setSelectedServicePreset(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none font-semibold text-slate-900"
                >
                  {orgServices.length > 0 && (
                    <optgroup label="بنود المؤسسة المعتمدة">
                      {orgServices.map((s) => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </optgroup>
                  )}
                  <optgroup label="البنود القياسية الجاهزة">
                    {DEFAULT_SERVICE_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </optgroup>
                </select>

                {isCustomService && (
                  <input
                    type="text"
                    required
                    value={customServiceName}
                    onChange={(e) => setCustomServiceName(e.target.value)}
                    placeholder="اكتب اسم البند المخصص..."
                    className="w-full mt-2 p-2 bg-white border border-emerald-300 rounded-xl text-slate-900"
                  />
                )}
              </div>

              {/* Provider Dropdown */}
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  مقدم الخدمة / المورد (قائمة منسدلة) *
                </label>
                <select
                  required
                  value={selectedProviderPreset}
                  onChange={(e) => setSelectedProviderPreset(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none font-semibold text-slate-900"
                >
                  {orgProviders.length > 0 && (
                    <optgroup label="موردي ومقدمي خدمات المؤسسة">
                      {orgProviders.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </optgroup>
                  )}
                  <optgroup label="الموردين والجهات المعتمدة الشائعة">
                    {DEFAULT_PROVIDER_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </optgroup>
                </select>

                {isCustomProvider && (
                  <input
                    type="text"
                    required
                    value={customProviderName}
                    onChange={(e) => setCustomProviderName(e.target.value)}
                    placeholder="اكتب اسم المورد المخصص..."
                    className="w-full mt-2 p-2 bg-white border border-emerald-300 rounded-xl text-slate-900"
                  />
                )}
              </div>
            </div>

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
                  عملة الصرف (قائمة منسدلة) *
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
                <label className="block font-bold text-slate-700 mb-1">مستوى السرعة (قائمة) *</label>
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
                  <label className="block font-bold text-slate-700 mb-1">طريقة التحويل المفضلة (قائمة) *</label>
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

            {/* 5. Justification Dropdown */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="font-bold text-slate-700">المبرر المالي للطلب (قائمة منسدلة) *</label>
                <span className="text-[11px] text-emerald-600 font-semibold">اختر مبرر الاعتماد</span>
              </div>
              <select
                value={selectedJustPreset}
                onChange={(e) => {
                  setSelectedJustPreset(e.target.value);
                  if (e.target.value !== 'مبرر مالي مخصص آخر...') {
                    setCustomJustification(e.target.value);
                  }
                }}
                className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none font-semibold text-slate-900"
              >
                {JUSTIFICATION_TEMPLATES.map((tpl) => (
                  <option key={tpl} value={tpl}>{tpl}</option>
                ))}
              </select>

              <textarea
                rows={2}
                required
                value={customJustification || (selectedJustPreset !== 'مبرر مالي مخصص آخر...' ? selectedJustPreset : '')}
                onChange={(e) => setCustomJustification(e.target.value)}
                placeholder="تعديل المبرر المالي أو كتابة مبرر إضافي..."
                className="w-full mt-2 p-2.5 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 text-slate-900"
              />
            </div>

            {/* 6. Description Dropdown */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="font-bold text-slate-700">تفاصيل ومواصفات الطلب (قائمة منسدلة) *</label>
                <span className="text-[11px] text-emerald-600 font-semibold">اختر الوصف الجاهز</span>
              </div>
              <select
                value={selectedDescPreset}
                onChange={(e) => {
                  setSelectedDescPreset(e.target.value);
                  if (e.target.value !== 'كتابة تفاصيل ومواصفات مخصصة...') {
                    setCustomDescription(e.target.value);
                  }
                }}
                className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none font-semibold text-slate-900"
              >
                {DESCRIPTION_TEMPLATES.map((tpl) => (
                  <option key={tpl} value={tpl}>{tpl}</option>
                ))}
              </select>

              <textarea
                rows={2}
                required
                value={customDescription || (selectedDescPreset !== 'كتابة تفاصيل ومواصفات مخصصة...' ? selectedDescPreset : '')}
                onChange={(e) => setCustomDescription(e.target.value)}
                placeholder="تعديل تفاصيل المواصفات أو كتابة شرح إضافي..."
                className="w-full mt-2 p-2.5 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 text-slate-900"
              />
            </div>

          </div>

          {/* Footer Buttons */}
          <div className="shrink-0 flex items-center justify-end gap-3 p-4 border-t border-slate-100 bg-slate-50/80">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-xl transition cursor-pointer font-medium"
            >
              إلغاء
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-md transition cursor-pointer disabled:opacity-50 flex items-center gap-2"
            >
              {submitting ? 'جاري الإرسال...' : 'إرسال الطلب للاعتماد'}
            </button>
          </div>

        </form>
      </div>
    </div>
  );
};
