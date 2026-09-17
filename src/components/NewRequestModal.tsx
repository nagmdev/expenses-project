import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { 
  X, 
  FileText, 
  Smartphone, 
  Building, 
  DollarSign, 
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

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [justification, setJustification] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState(activeOrg?.currency || 'EGP');
  const [serviceCategoryId, setServiceCategoryId] = useState(orgServices[0]?.id || '');
  const [customServiceName, setCustomServiceName] = useState('');
  const [providerId, setProviderId] = useState(orgProviders[0]?.id || '');
  const [customProviderName, setCustomProviderName] = useState('');
  const [urgency, setUrgency] = useState<'low' | 'medium' | 'high'>('medium');
  const [preferredPaymentMethod, setPreferredPaymentMethod] = useState<PaymentMethod>('instapay');
  const [paymentAccountDetails, setPaymentAccountDetails] = useState(currentUser.phone || '');
  const [submitting, setSubmitting] = useState(false);

  // Sync default selection when services or providers load
  React.useEffect(() => {
    if (!serviceCategoryId && orgServices.length > 0) {
      setServiceCategoryId(orgServices[0].id);
    }
  }, [orgServices, serviceCategoryId]);

  React.useEffect(() => {
    if (!providerId && orgProviders.length > 0) {
      setProviderId(orgProviders[0].id);
    }
  }, [orgProviders, providerId]);

  React.useEffect(() => {
    if (activeOrg?.currency) {
      setCurrency(activeOrg.currency);
    }
  }, [activeOrg]);

  if (!isOpen) return null;

  const currentEffectiveOrgId = activeOrgId && activeOrgId !== 'all' ? activeOrgId : (organizations[0]?.id || '');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !amount || Number(amount) <= 0 || submitting) return;

    setSubmitting(true);
    try {
      let finalServiceId = serviceCategoryId;
      if (!finalServiceId && customServiceName.trim()) {
        const newSrvId = `srv-${Date.now()}`;
        await addService({
          orgId: currentEffectiveOrgId,
          name: customServiceName.trim(),
          code: `SRV-${Date.now().toString().slice(-4)}`,
          description: 'بند خدمة جديد مضاف تلقائياً مع الطلب',
          budgetLimit: 50000,
          color: 'emerald',
          iconName: 'folder',
        });
        finalServiceId = newSrvId;
      }

      let finalProviderId = providerId;
      if (!finalProviderId && customProviderName.trim()) {
        const newProvId = `prov-${Date.now()}`;
        await addProvider({
          orgId: currentEffectiveOrgId,
          name: customProviderName.trim(),
          serviceCategoryIds: finalServiceId ? [finalServiceId] : [],
          serviceCategoryNames: customServiceName.trim() ? [customServiceName.trim()] : [],
          contactPerson: 'مسؤول المبيعات',
          phone: '+966 50 000 0000',
          email: 'vendor@example.sa',
          taxNumber: '300000000000003',
          crNumber: '1010000000',
          bankName: 'مصرف الراجحي',
          iban: 'SA0000000000000000000000',
          address: 'المملكة العربية السعودية',
          rating: 5,
          active: true,
        });
        finalProviderId = newProvId;
      }

      await createRequest({
        title: title.trim(),
        description: description.trim(),
        justification: justification.trim(),
        amount: Number(amount),
        currency: currency || activeOrg?.currency || 'EGP',
        serviceCategoryId: finalServiceId || orgServices[0]?.id || 'srv-default',
        providerId: finalProviderId || orgProviders[0]?.id || 'prov-default',
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
        className="bg-white rounded-3xl max-w-2xl w-full max-h-[90vh] shadow-2xl border border-slate-100 flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150 my-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header - Always visible at top */}
        <div className="shrink-0 flex items-center justify-between p-4 sm:p-5 border-b border-slate-100 bg-slate-50/80 sticky top-0 z-10">
          <div>
            <h3 className="text-base font-bold text-slate-900">إنشاء طلب صرف ومطالبة مالية</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              سيصل الطلب مباشرة إلى مدير شركتك للمراجعة والاعتماد والتحويل المالي
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
          
          {/* Title */}
          <div>
            <label className="block font-bold text-slate-700 mb-1">عنوان وموضوع الطلب *</label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="مثال: شراء تراخيص برمجيات، عهدة مصاريف سفر، صيانة تجهيزات..."
              className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 text-slate-900"
            />
          </div>

          {/* Service & Provider */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block font-bold text-slate-700 mb-1">
                بند الخدمة / مركز التكلفة *
              </label>
              {orgServices.length > 0 ? (
                <select
                  required
                  value={serviceCategoryId}
                  onChange={(e) => setServiceCategoryId(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none"
                >
                  {orgServices.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  required
                  value={customServiceName}
                  onChange={(e) => setCustomServiceName(e.target.value)}
                  placeholder="اكتب اسم البند (مثال: برمجيات، اتصالات، تجهيزات)"
                  className="w-full p-2.5 bg-slate-50 border border-emerald-300 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 text-slate-900"
                />
              )}
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">
                مقدم الخدمة / المورد *
              </label>
              {orgProviders.length > 0 ? (
                <select
                  required
                  value={providerId}
                  onChange={(e) => setProviderId(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none"
                >
                  {orgProviders.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  required
                  value={customProviderName}
                  onChange={(e) => setCustomProviderName(e.target.value)}
                  placeholder="اكتب اسم المورد (مثال: جرير، الاتصالات، أمازون)"
                  className="w-full p-2.5 bg-slate-50 border border-emerald-300 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 text-slate-900"
                />
              )}
            </div>
          </div>

          {/* Amount, Currency & Urgency */}
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
                عملة الصرف والمطالبة *
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
              <label className="block font-bold text-slate-700 mb-1">مستوى السرعة</label>
              <select
                value={urgency}
                onChange={(e: any) => setUrgency(e.target.value)}
                className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none"
              >
                <option value="low">عادي / روتيني</option>
                <option value="medium">متوسط الأهمية</option>
                <option value="high">عاجل وهام جداً</option>
              </select>
            </div>
          </div>

          {/* InstaPay / Transfer Details Section */}
          <div className="bg-emerald-50/70 p-4 rounded-2xl border border-emerald-200/80 space-y-3">
            <div className="flex items-center gap-2 font-bold text-emerald-950 text-xs">
              <CreditCard className="h-4 w-4 text-emerald-600" />
              <span>بيانات الصرف والتحويل المصرفي (InstaPay / Bank)</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-bold text-slate-700 mb-1">طريقة التحويل المفضلة</label>
                <select
                  value={preferredPaymentMethod}
                  onChange={(e: any) => {
                    setPreferredPaymentMethod(e.target.value);
                    setPaymentAccountDetails('');
                  }}
                  className="w-full p-2.5 bg-white border border-slate-200 rounded-xl font-bold"
                >
                  <option value="instapay">انستاباي (InstaPay)</option>
                  <option value="bank_transfer">تحويل بنكي فوري (IBAN)</option>
                  <option value="digital_wallet">محفظة إلكترونية (فودافون كاش / أورانج / اتصالات)</option>
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

          {/* Description */}
          <div>
            <label className="block font-bold text-slate-700 mb-1">تفاصيل ومواصفات الطلب *</label>
            <textarea
              rows={2}
              required
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="اكتب شرحاً دقيقاً لما سيتم شراؤه أو الخدمة المقدمة..."
              className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none"
            />
          </div>

          {/* Justification */}
          <div>
            <label className="block font-bold text-slate-700 mb-1">المبرر المالي للطلب *</label>
            <textarea
              rows={2}
              required
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
              placeholder="كيف تخدم هذه المصروفات سير العمل أو أهداف المؤسسة؟"
              className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none"
            />
          </div>
        </div>

          {/* Footer Buttons - Pinned at bottom */}
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
