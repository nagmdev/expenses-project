import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import { 
  X,
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
  Hash,
  Loader2
} from 'lucide-react';
import { processAndUploadInvoice } from '../utils/fileUpload';
import { useSubmitGuard } from '../hooks/useSubmitGuard';
import { useEscapeToClose } from '../hooks/useEscapeToClose';
import { isArchivedOrg } from '../domain/common';
import { InvoiceViewerModal } from './InvoiceViewerModal';
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
  handleNumericKeyDown,
  ibanError,
  walletNumberError,
  beneficiaryNameError,
  instapayAddressError
} from '../utils/validation';
import { resolveRequestPaymentMethod, normalizePaymentMethod, extractIban, fmtMoney, accountBalance, currencyCode } from '../utils/requestUi';

/** Largest attachment accepted by the form (the same number the upload hint shows). */
const MAX_UPLOAD_MB = 15;
const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;
const FILE_TOO_LARGE = `حجم الملف كبير جداً، يرجى اختيار ملف أقل من ${MAX_UPLOAD_MB} ميجابايت`;

/**
 * Normalises text for keyword matching: lower case, Arabic letter variants unified
 * (أ/إ/آ → ا, ة → ه, ى → ي) and diacritics removed.
 */
const normalizeForMatch = (s: string) =>
  (s || '')
    .toLowerCase()
    .replace(/[ً-ْ]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي');

/** A keyword hit: Latin keywords must match a whole word ("we" is not "wedding"). */
const keywordHits = (text: string, keyword: string) => {
  const t = normalizeForMatch(text);
  const k = normalizeForMatch(keyword).trim();
  if (!k) return false;
  if (/^[a-z0-9 ]+$/.test(k)) {
    return new RegExp(`(^|[^a-z0-9])${k.replace(/ /g, '\\s*')}([^a-z0-9]|$)`).test(t);
  }
  return t.includes(k);
};

/**
 * The service a quick template means: the one whose name (worth more) or code /
 * description matches most of the template's keywords, Arabic or English.
 */
function matchServiceForTemplate(services: ServiceCategory[], keywords: string[]): ServiceCategory | undefined {
  let best: ServiceCategory | undefined;
  let bestScore = 0;
  for (const s of services) {
    let score = 0;
    for (const k of keywords) {
      if (keywordHits(s.name, k)) score += 3;
      else if (keywordHits(`${s.code || ''} ${s.serviceNature || ''}`, k)) score += 2;
      else if (keywordHits(s.description || '', k)) score += 1;
    }
    if (score > bestScore) {
      best = s;
      bestScore = score;
    }
  }
  return best;
}

interface NewRequestModalProps {
  isOpen: boolean;
  onClose: () => void;
  editingRequest?: ExpenseRequest | null;
}

export type IncomeShape = 'instapay' | 'wallet' | 'bank' | 'cash';

const INCOME_PAYMENT_SHAPES = [
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

interface InstallmentDevicePreset {
  id: string;
  name: string;
  badge: string;
  category: string;
  description: string;
}

const INSTALLMENT_DEVICE_PRESETS: InstallmentDevicePreset[] = [
  {
    id: 'okka_espresso',
    name: 'ماكينة أوكا اسبريسو كافيه (Okka Espresso)',
    badge: '☕ أوكا اسبريسو كافيه',
    category: 'معدات القهوة والمشروبات',
    description: 'ماكينة تحضير قهوة اسبريسو وكابتشينو ماركة أوكا (Okka Espresso Coffee Machine) - قسط شهري لمعدات الضيافة ومشروبات المقر',
  },
  {
    id: 'turkish_coffee',
    name: 'ماكينة قهوة تركي (Turkish Coffee Machine)',
    badge: '🇹🇷 ماكينة قهوة تركي',
    category: 'معدات القهوة والمشروبات',
    description: 'ماكينة إعداد قهوة تركي أوتوماتيكية ماركة أوكا / بيكو (Turkish Coffee Machine) - قسط شهري لمعدات البوفيه',
  },
  {
    id: 'coffee_machine',
    name: 'كافي ماشين / صانعة قهوة (Coffee Machine)',
    badge: '☕ كافي ماشين مدمجة',
    category: 'معدات القهوة والمشروبات',
    description: 'صانعة قهوة ومشروبات ساخنة مفلترة للمقر (All-in-One Coffee Machine) - سداد قسط شهري',
  },
  {
    id: 'water_dispenser',
    name: 'مبرد مياه ساخن وبارد (Water Dispenser)',
    badge: '💧 مبرد مياه',
    category: 'أجهزة التبريد والضيافة',
    description: 'مبرد وموزع مياه نقي ساخن وبارد مع كابينة سفلية (Water Dispenser) - قسط شهري لتجهيزات المقر',
  },
  {
    id: 'air_conditioner',
    name: 'تكييف هواء سبليت (Air Conditioner)',
    badge: '❄️ تكييف هواء',
    category: 'التكييف والتهوية',
    description: 'جهاز تكييف هواء سبليت موفر للطاقة لتبريد وتكييف مكاتب العمل والاجتماعات - قسط شهري',
  },
  {
    id: 'printer_copier',
    name: 'طابعة وماكينة تصوير مستندات (Printer & Copier)',
    badge: '🖨️ طابعة وتصوير مستندات',
    category: 'أجهزة مكتبية ومستندات',
    description: 'ماكينة تصوير مستندات وطابعة ليزر متعددة الوظائف والمسح الضوئي (Multi-Function Printer) - قسط شهري',
  },
  {
    id: 'computers_laptops',
    name: 'أجهزة كمبيوتر ولابتوب (Laptops & Computers)',
    badge: '💻 كمبيوتر ولابتوب',
    category: 'تكنولوجيا المعلومات',
    description: 'أجهزة حاسب آلي ولابتوبات عمل للموظفين وفريق العمل - قسط شهري للأجهزة المكتبية',
  },
  {
    id: 'smart_tv',
    name: 'شاشة عرض وتلفزيون ذكي (Smart TV / Display)',
    badge: '📺 شاشة عرض واجتماعات',
    category: 'شاشات وعرض',
    description: 'شاشة عرض تفاعلية ذكية فائقة الدقة لغرف الاجتماعات والعرض التقديمي - قسط شهري',
  },
  {
    id: 'refrigerator',
    name: 'ثلاجة مكتبية وبوفيه (Office Refrigerator)',
    badge: '🧊 ثلاجة مكتبية',
    category: 'أجهزة البوفيه',
    description: 'ثلاجة حفظ وتبريد الأطعمة والمشروبات لمطبخ وبوفيه مقر الشركة - قسط شهري',
  },
  {
    id: 'other_device',
    name: 'جهاز أو معدات أخرى (تحديد يدوي)',
    badge: '⚙️ جهاز آخر مخصص',
    category: 'أخرى',
    description: 'سداد القسط الشهري لأجهزة ومعدات تشغيلية معتمدة بالمقر',
  },
];

const EXPENSE_QUICK_TEMPLATES = [
  {
    label: '✈️ استخراج تأشيرة',
    title: 'طلب سداد رسوم استخراج تأشيرة',
    description: 'سداد تكاليف ورسوم استخراج تأشيرة سفر رسمية ومستندات المسافر',
    keywords: ['تأشيرة', 'فيزا', 'جواز', 'عمرة', 'تأشيرات', 'visa', 'visas', 'passport', 'umrah'],
    templateType: 'visa' as const,
  },
  {
    label: '📅 سداد قسط شهري',
    title: 'سداد القسط الشهري للأجهزة والمعدات',
    description: 'سداد القسط الشهري المستحق لماكينات وأجهزة المقر التشغيلية',
    keywords: ['قسط', 'أقساط', 'جهاز', 'ماكينة', 'أجهزة', 'installment', 'installments', 'instalment', 'lease', 'leasing'],
    templateType: 'installment' as const,
  },
  {
    label: '⚡ شحن محفظة مندوب',
    title: 'شحن رصيد محفظة للمندوب / مأمورية',
    description: 'شحن رصيد محفظة إلكترونية للمندوب لتغطية مصاريف المأمورية والانتقالات',
    keywords: ['مندوب', 'محفظة', 'مأمورية', 'شحن', 'wallet', 'top up', 'topup', 'mission', 'courier'],
    templateType: 'wallet_topup' as const,
  },
  {
    label: '⚡ شحن كارت كهرباء',
    title: 'شحن كارت كهرباء المقر',
    description: 'شحن كارت عداد الكهرباء الدوري للمقر',
    keywords: ['كهرباء', 'طاقة', 'عداد', 'مرافق', 'electricity', 'electric', 'power', 'meter', 'utility', 'utilities'],
    templateType: null,
  },
  {
    label: '⚡ فواتير إنترنت وهاتف',
    title: 'سداد فاتورة الإنترنت الشهرية',
    description: 'سداد فاتورة واشتراك الإنترنت والاتصالات للأعمال',
    keywords: ['إنترنت', 'انترنت', 'اتصالات', 'هاتف', 'شبكات', 'راوتر', 'internet', 'we', 'telecom', 'phone', 'mobile', 'landline', 'adsl', 'vdsl', 'fiber', 'wifi', 'broadband', 'vodafone', 'etisalat', 'orange'],
    templateType: null,
  },
  {
    label: '⚡ بوفيه ومستلزمات مقر',
    title: 'شراء مستلزمات بوفيه وضيافة',
    description: 'شراء مستلزمات بوفيه وضيافة ومستلزمات نظافة دورية للمقر',
    keywords: ['بوفيه', 'ضيافة', 'مستلزمات', 'أدوات مكتبية', 'نثريات', 'نظافة', 'catering', 'buffet', 'hospitality', 'pantry', 'supplies', 'cleaning', 'kitchen'],
    templateType: null,
  },
  {
    label: '⚡ وقود وانتقالات',
    title: 'بدل وقود ومصروفات انتقالات مأمورية',
    description: 'سداد فواتير وقود وبنزين ومصروفات انتقالات مأمورية رسمية',
    keywords: ['وقود', 'بنزين', 'سولار', 'انتقالات', 'سيارات', 'مهمة', 'fuel', 'petrol', 'gasoline', 'diesel', 'transport', 'transportation', 'car', 'cars', 'uber', 'taxi'],
    templateType: null,
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
  // Companies offered for the request: active ones only (an archived one takes no new records);
  // an edited request keeps its own company listed.
  const creatableOrgs = useMemo(
    () => orgList.filter(o => !isArchivedOrg(o) || o.id === editingRequest?.orgId),
    [orgList, editingRequest?.orgId]
  );

  const [selectedOrgId, setSelectedOrgId] = useState<string>(() => {
    if (activeOrgId && activeOrgId !== 'all') return activeOrgId;
    if (activeOrg?.id) return activeOrg.id;
    return creatableOrgs[0]?.id || '';
  });

  useEffect(() => {
    if (activeOrgId && activeOrgId !== 'all') {
      setSelectedOrgId(activeOrgId);
    } else if (activeOrg?.id) {
      setSelectedOrgId(activeOrg.id);
    } else if (creatableOrgs.length > 0 && !selectedOrgId) {
      setSelectedOrgId(creatableOrgs[0].id);
    }
  }, [activeOrgId, activeOrg, creatableOrgs, selectedOrgId]);

  const currentOrg = useMemo(() => {
    return orgList.find(o => o.id === selectedOrgId) || activeOrg || orgList[0];
  }, [orgList, selectedOrgId, activeOrg]);

  // A deactivated service / provider (one that old requests still point to) is never
  // offered for a new request; an edited request keeps the one it already has.
  const keptServiceId = editingRequest?.serviceCategoryId;
  const keptProviderId = editingRequest?.providerId;
  const sourceServices = (allServices && allServices.length > 0) ? allServices : services;
  const availableServices = useMemo(() => {
    const usable = sourceServices.filter(s => s.active !== false || s.id === keptServiceId);
    if (!selectedOrgId) return usable;
    return usable.filter(s => isServiceMatchingOrg(s, selectedOrgId));
  }, [sourceServices, selectedOrgId, keptServiceId]);

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
    const usable = sourceProviders.filter(p => p.active !== false || p.id === keptProviderId);
    if (!selectedOrgId) return usable;
    return usable.filter(p => {
      const pAny = p as any;
      if (pAny.orgIds && Array.isArray(pAny.orgIds)) {
        return pAny.orgIds.includes(selectedOrgId);
      }
      return p.orgId === selectedOrgId || !p.orgId;
    });
  }, [sourceProviders, selectedOrgId, keptProviderId]);

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
  // The profile's preferred payout method ('wallet' is the legacy code of the e-wallet).
  const profileDefaultMethod: PaymentMethod = normalizePaymentMethod(currentUser.preferredPaymentMethod) || 'instapay';
  const [preferredPaymentMethod, setPreferredPaymentMethod] = useState<PaymentMethod>(profileDefaultMethod);
  const [paymentAccountDetails, setPaymentAccountDetails] = useState('');
  const [beneficiaryName, setBeneficiaryName] = useState('');
  const [activeTemplateType, setActiveTemplateType] = useState<'visa' | 'installment' | 'wallet_topup' | null>(null);
  // Synchronous submit lock + idempotency key (a retry of the same submission reuses the key)
  const submitGuard = useSubmitGuard();
  const submitting = submitGuard.pending;
  const { rotateKey: rotateSubmitKey } = submitGuard;

  // Dedicated Invoice & Prepayment States
  const [isPrepaidByRequester, setIsPrepaidByRequester] = useState<boolean>(false);
  const [invoiceNumber, setInvoiceNumber] = useState<string>('');
  const [invoiceDate, setInvoiceDate] = useState<string>('');
  const [invoiceAttachment, setInvoiceAttachment] = useState<RequestAttachment | null>(null);
  const [previewModalUrl, setPreviewModalUrl] = useState<{ url: string; name: string; type: string } | null>(null);
  const [isUploadingInvoice, setIsUploadingInvoice] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Dedicated Visa Document Attachment States
  const [visaDocumentAttachment, setVisaDocumentAttachment] = useState<RequestAttachment | null>(null);
  const [isUploadingVisaDoc, setIsUploadingVisaDoc] = useState<boolean>(false);
  const visaFileInputRef = useRef<HTMLInputElement>(null);

  // Dedicated Installment Transfer & Device States
  const [installmentTransferAttachment, setInstallmentTransferAttachment] = useState<RequestAttachment | null>(null);
  const [isUploadingInstallmentTransfer, setIsUploadingInstallmentTransfer] = useState<boolean>(false);
  const installmentFileInputRef = useRef<HTMLInputElement>(null);
  const [installmentDeviceType, setInstallmentDeviceType] = useState<string>(INSTALLMENT_DEVICE_PRESETS[0].name);
  const [installmentDeviceDescription, setInstallmentDeviceDescription] = useState<string>(INSTALLMENT_DEVICE_PRESETS[0].description);

  // Dedicated Wallet Top-up Screenshot Attachment States
  const [walletTransferAttachment, setWalletTransferAttachment] = useState<RequestAttachment | null>(null);
  const [isUploadingWalletTransfer, setIsUploadingWalletTransfer] = useState<boolean>(false);
  const walletFileInputRef = useRef<HTMLInputElement>(null);

  // Whether the user changed anything since the form opened (Esc then asks before discarding).
  const [touched, setTouched] = useState(false);
  const markTouched = () => setTouched(true);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > MAX_UPLOAD_BYTES) {
      alert(FILE_TOO_LARGE);
      e.target.value = '';
      return;
    }
    markTouched();

    const uploadOrgId = selectedOrgId || (activeOrgId && activeOrgId !== 'all' ? activeOrgId : '') || activeOrg?.id || (creatableOrgs[0]?.id || '');
    if (!uploadOrgId) {
      alert('يرجى اختيار الشركة أولاً قبل إرفاق المستندات.');
      e.target.value = '';
      return;
    }

    setIsUploadingInvoice(true);
    try {
      const attachment = await processAndUploadInvoice(file, uploadOrgId);
      setInvoiceAttachment(attachment);
    } catch (err: any) {
      console.error('[FileUpload Error]', err);
      alert(err?.message || 'تعذر معالجة أو رفع الملف، يرجى المحاولة ثانية');
    } finally {
      setIsUploadingInvoice(false);
      e.target.value = '';
    }
  };

  const handleVisaDocUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > MAX_UPLOAD_BYTES) {
      alert(FILE_TOO_LARGE);
      e.target.value = '';
      return;
    }
    markTouched();

    const uploadOrgId = selectedOrgId || (activeOrgId && activeOrgId !== 'all' ? activeOrgId : '') || activeOrg?.id || (creatableOrgs[0]?.id || '');
    if (!uploadOrgId) {
      alert('يرجى اختيار الشركة أولاً قبل إرفاق المستندات.');
      e.target.value = '';
      return;
    }

    setIsUploadingVisaDoc(true);
    try {
      const attachment = await processAndUploadInvoice(file, uploadOrgId);
      setVisaDocumentAttachment(attachment);
    } catch (err: any) {
      console.error('[VisaDocUpload Error]', err);
      alert(err?.message || 'تعذر رفع مستند التأشيرة، يرجى المحاولة ثانية');
    } finally {
      setIsUploadingVisaDoc(false);
      e.target.value = '';
    }
  };

  const handleInstallmentTransferUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > MAX_UPLOAD_BYTES) {
      alert(FILE_TOO_LARGE);
      e.target.value = '';
      return;
    }
    markTouched();

    const uploadOrgId = selectedOrgId || (activeOrgId && activeOrgId !== 'all' ? activeOrgId : '') || activeOrg?.id || (creatableOrgs[0]?.id || '');
    if (!uploadOrgId) {
      alert('يرجى اختيار الشركة أولاً قبل إرفاق المستندات.');
      e.target.value = '';
      return;
    }

    setIsUploadingInstallmentTransfer(true);
    try {
      const attachment = await processAndUploadInvoice(file, uploadOrgId);
      setInstallmentTransferAttachment(attachment);
    } catch (err: any) {
      console.error('[InstallmentTransferUpload Error]', err);
      alert(err?.message || 'تعذر رفع سكرين تحويل سداد القسط، يرجى المحاولة ثانية');
    } finally {
      setIsUploadingInstallmentTransfer(false);
      e.target.value = '';
    }
  };

  const handleWalletTransferUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > MAX_UPLOAD_BYTES) {
      alert(FILE_TOO_LARGE);
      e.target.value = '';
      return;
    }
    markTouched();

    const uploadOrgId = selectedOrgId || (activeOrgId && activeOrgId !== 'all' ? activeOrgId : '') || activeOrg?.id || (creatableOrgs[0]?.id || '');
    if (!uploadOrgId) {
      alert('يرجى اختيار الشركة أولاً قبل إرفاق المستندات.');
      e.target.value = '';
      return;
    }

    setIsUploadingWalletTransfer(true);
    try {
      const attachment = await processAndUploadInvoice(file, uploadOrgId);
      setWalletTransferAttachment(attachment);
    } catch (err: any) {
      console.error('[WalletTransferUpload Error]', err);
      alert(err?.message || 'تعذر رفع سكرين شحن المحفظة، يرجى المحاولة ثانية');
    } finally {
      setIsUploadingWalletTransfer(false);
      e.target.value = '';
    }
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

        // The same method the list / detail screens show for this request (older records
        // have none stored), so saving an edit never switches it silently.
        setPreferredPaymentMethod(resolveRequestPaymentMethod(editingRequest));
        setPaymentAccountDetails(editingRequest.paymentAccountDetails || '');
        setBeneficiaryName(editingRequest.beneficiaryName || '');

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

        setVisaDocumentAttachment(editingRequest.visaDocumentAttachment || null);
        setInstallmentTransferAttachment(editingRequest.installmentTransferAttachment || null);
        setInstallmentDeviceType(editingRequest.installmentDeviceType || INSTALLMENT_DEVICE_PRESETS[0].name);
        setInstallmentDeviceDescription(editingRequest.installmentDeviceDescription || '');
        setWalletTransferAttachment(editingRequest.walletTransferAttachment || null);
      } else {
        const defaultMethod = profileDefaultMethod;
        setPreferredPaymentMethod(defaultMethod);
        const detail = getProfilePayoutDetail(defaultMethod);
        if (detail) {
          setPaymentAccountDetails(detail);
        }
        setBeneficiaryName('');
        setActiveTemplateType(null);
        setIsPrepaidByRequester(false);
        setInvoiceNumber('');
        setInvoiceDate('');
        setInvoiceAttachment(null);
        setVisaDocumentAttachment(null);
        setInstallmentTransferAttachment(null);
        setInstallmentDeviceType(INSTALLMENT_DEVICE_PRESETS[0].name);
        setInstallmentDeviceDescription(INSTALLMENT_DEVICE_PRESETS[0].description);
        setWalletTransferAttachment(null);
      }
      setTouched(false);
    }
    // Runs only when the form is (re)opened or switches to another request. Real-time
    // snapshots create new object identities on every change; depending on the objects
    // themselves would wipe what the user is typing / an invoice they just uploaded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, editingRequest?.id]);

  // Each new opening of the form is a new submission intent → fresh idempotency key
  useEffect(() => {
    if (isOpen) rotateSubmitKey();
  }, [isOpen, editingRequest?.id, rotateSubmitKey]);

  // Validation & Error Handling States
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldHighlight, setFieldHighlight] = useState<'amount' | 'title' | 'paymentDetails' | 'beneficiary' | null>(null);

  // Element Refs for Auto-Scrolling and Auto-Focus
  const amountInputRef = useRef<HTMLInputElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const paymentInputRef = useRef<HTMLInputElement>(null);
  const beneficiaryInputRef = useRef<HTMLInputElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const dialogRootRef = useRef<HTMLDivElement>(null);

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
      const defaultMethod = profileDefaultMethod;
      setPreferredPaymentMethod(defaultMethod);
      setPaymentAccountDetails(getProfilePayoutDetail(defaultMethod));
    }
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
    setBeneficiaryName('');
    setActiveTemplateType(null);
    setIsPrepaidByRequester(false);
    setInvoiceNumber('');
    setInvoiceDate('');
    setInvoiceAttachment(null);
    setVisaDocumentAttachment(null);
    setInstallmentTransferAttachment(null);
    setInstallmentDeviceType(INSTALLMENT_DEVICE_PRESETS[0].name);
    setInstallmentDeviceDescription(INSTALLMENT_DEVICE_PRESETS[0].description);
    setWalletTransferAttachment(null);
    setPreviewModalUrl(null);
    setFormError(null);
    setFieldHighlight(null);
    setTouched(false);
    onClose();
  };

  // Esc closes this form only when it is the top-most dialog (an attachment preview
  // opened from it closes first), and never discards what the user typed without asking.
  const handleEscape = () => {
    if (submitGuard.pending) return;
    const hasNewAttachment =
      !isEditMode && Boolean(invoiceAttachment || visaDocumentAttachment || installmentTransferAttachment || walletTransferAttachment);
    const hasUnsavedInput = touched || hasNewAttachment;
    if (hasUnsavedInput && !window.confirm('إغلاق النموذج؟ ستُفقد البيانات والمرفقات التي أدخلتها ولم تُحفظ بعد.')) return;
    handleClose();
  };
  useEscapeToClose(isOpen, handleEscape, dialogRootRef);

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

    if (srv.defaultPaymentMethod && srv.defaultPaymentMethod !== preferredPaymentMethod) {
      setPreferredPaymentMethod(srv.defaultPaymentMethod);
      // The payout details belong to the method: fill the new method's details from the profile.
      setPaymentAccountDetails(getProfilePayoutDetail(srv.defaultPaymentMethod));
    }

    if (srv.defaultAccountId && availableAccounts.some(a => a.id === srv.defaultAccountId)) {
      setTargetAccountId(srv.defaultAccountId);
    }
  };

  // Quick Template Activation for Expense
  const applyQuickTemplate = (tpl: { label: string; title: string; description: string; keywords: string[]; templateType?: any }) => {
    setIsCustomTitle(true);
    setCustomTitle(tpl.title);
    setIsCustomDescription(true);
    setCustomDescription(tpl.description);
    setFormError(null);
    setFieldHighlight(null);
    setActiveTemplateType(tpl.templateType || null);
    markTouched();

    // Services are often named in English ("WE Internet"), so the keywords are both.
    const matched = matchServiceForTemplate(effectiveServices, tpl.keywords);

    if (matched) {
      setSelectedServiceId(matched.id);
      applyServiceCategoryDefaults(matched);
    }

    if (tpl.templateType === 'installment') {
      setInstallmentDeviceType(INSTALLMENT_DEVICE_PRESETS[0].name);
      setInstallmentDeviceDescription(INSTALLMENT_DEVICE_PRESETS[0].description);
    }

    // Auto-focus amount input so the user can easily enter the cost!
    setTimeout(() => {
      amountInputRef.current?.focus();
    }, 100);
  };


  const selectedServiceName = (effectiveServices.find(s => s.id === selectedServiceId)?.name || '').toLowerCase();
  const currentTitleLower = (isCustomTitle ? customTitle : selectedTitlePreset).toLowerCase();
  
  const isVisaRequest = 
    activeTemplateType === 'visa' ||
    selectedServiceName.includes('تأشير') ||
    selectedServiceName.includes('فيزا') ||
    currentTitleLower.includes('تأشير') ||
    currentTitleLower.includes('فيزا') ||
    Boolean(editingRequest?.visaDocumentAttachment) ||
    Boolean(visaDocumentAttachment);

  const isInstallmentRequest = 
    activeTemplateType === 'installment' ||
    selectedServiceName.includes('قسط') ||
    currentTitleLower.includes('قسط') ||
    Boolean(editingRequest?.installmentDeviceType) ||
    Boolean(editingRequest?.installmentTransferAttachment) ||
    Boolean(installmentTransferAttachment);

  const isWalletTopupRequest = 
    activeTemplateType === 'wallet_topup' ||
    selectedServiceName.includes('محفظة') ||
    currentTitleLower.includes('محفظة') ||
    Boolean(editingRequest?.walletTransferAttachment) ||
    Boolean(walletTransferAttachment);

  const isAnyUploadInProgress =
    isUploadingInvoice || isUploadingVisaDoc || isUploadingInstallmentTransfer || isUploadingWalletTransfer;

  // Payout details of an expense request: the format the chosen method needs, and the
  // beneficiary's registered name for InstaPay (the field is required, marked *).
  const payoutProblem = (): { message: string; field: 'paymentDetails' | 'beneficiary' } | null => {
    const details = paymentAccountDetails.trim();
    switch (preferredPaymentMethod) {
      case 'cash':
        return null;
      case 'instapay': {
        const addressError = instapayAddressError(details);
        if (addressError) return { message: addressError, field: 'paymentDetails' };
        const nameError = beneficiaryNameError(beneficiaryName);
        return nameError ? { message: nameError, field: 'beneficiary' } : null;
      }
      case 'digital_wallet':
      case 'wallet': {
        const walletError = walletNumberError(details);
        return walletError ? { message: walletError, field: 'paymentDetails' } : null;
      }
      case 'bank_transfer': {
        const error = ibanError(extractIban(details));
        return error ? { message: error, field: 'paymentDetails' } : null;
      }
      default:
        return details ? null : { message: '⚠️ يرجى إدخال بيانات جهة الاستلام للمستفيد', field: 'paymentDetails' };
    }
  };

  const checkPayoutDetails = (): boolean => {
    const problem = payoutProblem();
    if (!problem) return true;
    setFormError(problem.message);
    setFieldHighlight(problem.field);
    const target = problem.field === 'beneficiary' ? beneficiaryInputRef.current : paymentInputRef.current;
    target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target?.focus();
    return false;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setFieldHighlight(null);

    // Never submit while an attachment is still uploading (it would be silently missing).
    if (isAnyUploadInProgress) {
      setFormError('⚠️ يرجى الانتظار حتى يكتمل رفع المرفقات قبل إرسال الطلب');
      return;
    }

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

      // Same payout checks as a new request (address / IBAN / wallet format, beneficiary name).
      if (requestType === 'expense' && !checkPayoutDetails()) return;

      const selectedService = effectiveServices.find(s => s.id === selectedServiceId) || effectiveServices[0];
      const serviceId = selectedService?.id || editingRequest.serviceCategoryId;
      const serviceName = selectedService?.name || editingRequest.serviceCategoryName;

      const selectedProvider = effectiveProviders.find(p => p.id === selectedProviderId) || effectiveProviders[0];
      const providerId = selectedProvider?.id || editingRequest.providerId;
      const providerName = selectedProvider?.name || editingRequest.providerName;

      const additionalAtts = [
        invoiceAttachment, 
        visaDocumentAttachment, 
        installmentTransferAttachment, 
        walletTransferAttachment
      ].filter(Boolean) as RequestAttachment[];

      const otherAttachments = (editingRequest.attachments || []).filter(
        a => !additionalAtts.some(na => na.id === a.id)
      );
      const finalAttachments = [...additionalAtts, ...otherAttachments];

      await submitGuard.run(async (idempotencyKey) => {
        try {
          await updateRequest(editingRequest.id, {
            title: activeTitle,
            description: requestType === 'income'
              ? `طلب توريد مالي بقيمة ${fmtMoney(amount)} ${currency}`
              : (effectiveDescription.trim() || editingRequest.description),
            justification: requestType === 'income'
              ? 'إيداع وتوريد مالي مباشر'
              : (isVisaRequest ? (effectiveJustification.trim() || 'استخراج وتخليص تأشيرة سفر رسمية معتمدة') : (effectiveJustification.trim() || editingRequest.justification)),
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
            visaDocumentAttachment: visaDocumentAttachment || undefined,
            installmentTransferAttachment: installmentTransferAttachment || undefined,
            installmentDeviceType: isInstallmentRequest ? installmentDeviceType : undefined,
            installmentDeviceDescription: isInstallmentRequest ? installmentDeviceDescription.trim() : undefined,
            walletTransferAttachment: walletTransferAttachment || undefined,
            attachments: finalAttachments,
            preferredPaymentMethod,
            paymentAccountDetails: paymentAccountDetails.trim(),
            beneficiaryName: preferredPaymentMethod === 'instapay' ? beneficiaryName.trim() : undefined,
            orgId: selectedOrgId,
          }, { idempotencyKey });

          submitGuard.rotateKey();
          handleClose();
        } catch (err: any) {
          // Keep the idempotency key so a retry resolves to the same operation
          console.error('[NewRequestModal] Error updating request:', err);
          setFormError(err?.message || 'حدث خطأ أثناء حفظ التعديلات على الطلب، يرجى المحاولة ثانية');
        }
      });
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

      const shapeObj = INCOME_PAYMENT_SHAPES.find(s => s.id === selectedIncomeShape) || INCOME_PAYMENT_SHAPES[0];
      const matchingAccount = availableAccounts.find(a => a.id === targetAccountId) || 
        availableAccounts.find(a => a.type === shapeObj.accountType);

      const titleText = paymentAccountDetails.trim()
        ? `توريد مالي - ${paymentAccountDetails.trim()}`
        : `توريد مالي عبر ${shapeObj.title} (+ IN)`;

      await submitGuard.run(async (idempotencyKey) => {
        try {
          await createRequest({
            title: titleText,
            description: `طلب توريد مالي بقيمة ${fmtMoney(amount)} ${currency} عبر ${shapeObj.title}`,
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
            idempotencyKey,
          });

          submitGuard.rotateKey();
          handleClose();
        } catch (err: any) {
          // Keep the idempotency key so a retry resolves to the same record
          console.error('[NewRequestModal] Error creating income request:', err);
          setFormError(err?.message || 'حدث خطأ أثناء إرسال طلب التوريد، يرجى المحاولة ثانية');
        }
      });
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

    // Validation 3: Payment details (format) and the InstaPay beneficiary name
    if (!checkPayoutDetails()) return;

    // Resolve Service (with safe fallbacks so no submission is ever blocked)
    const selectedService = effectiveServices.find(s => s.id === selectedServiceId) || effectiveServices[0];
    const serviceId = selectedService?.id || 'srv-general';
    const serviceName = selectedService?.name || 'مصروفات وتشغيل عام / نثريات';

    // Resolve Provider (with safe fallbacks so direct market purchases are supported)
    const selectedProvider = effectiveProviders.find(p => p.id === selectedProviderId) || effectiveProviders[0];
    const providerId = selectedProvider?.id || 'prov-direct-purchase';
    const providerName = selectedProvider?.name || 'شراء مباشر / بدون مورد محدد';

    // 🟡 Validation: Service Budget Limit Check
    if (selectedService && Number(selectedService.budgetLimit) > 0) {
      const numericAmount = Number(amount);
      const currentSpent = Number(selectedService.spentAmount || 0);
      const remaining = Number(selectedService.budgetLimit) - currentSpent;
      if (numericAmount > remaining) {
        setFormError(`⚠️ الميزانية المتبقية لبند (${selectedService.name}): ${fmtMoney(remaining)} ${currency || 'EGP'}، ولا تكفي لتغطية مبلغ الطلب (${fmtMoney(numericAmount)}). يرجى تعديل المبلغ أو مراجعة الإدارة.`);
        setFieldHighlight('amount');
        amountInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
    }

    const finalNewAttachments = [
      invoiceAttachment,
      visaDocumentAttachment,
      installmentTransferAttachment,
      walletTransferAttachment
    ].filter(Boolean) as RequestAttachment[];

    await submitGuard.run(async (idempotencyKey) => {
      try {
        await createRequest({
          title: effectiveTitle.trim(),
          description: effectiveDescription.trim() || 'سداد مباشر للمصروفات الموضحة بالطلب',
          justification: isVisaRequest
            ? (effectiveJustification.trim() || 'استخراج وتخليص تأشيرة سفر رسمية معتمدة')
            : (effectiveJustification.trim() || 'دعم استمرارية العمليات والتشغيل'),
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
          visaDocumentAttachment: visaDocumentAttachment || undefined,
          installmentTransferAttachment: installmentTransferAttachment || undefined,
          installmentDeviceType: isInstallmentRequest ? installmentDeviceType : undefined,
          installmentDeviceDescription: isInstallmentRequest ? installmentDeviceDescription.trim() : undefined,
          walletTransferAttachment: walletTransferAttachment || undefined,
          attachments: finalNewAttachments,
          preferredPaymentMethod,
          paymentAccountDetails: paymentAccountDetails.trim(),
          beneficiaryName: preferredPaymentMethod === 'instapay' ? beneficiaryName.trim() : undefined,
          orgId: selectedOrgId,
          idempotencyKey,
        });

        submitGuard.rotateKey();
        handleClose();
      } catch (err: any) {
        // Keep the idempotency key so a retry resolves to the same record
        console.error('[NewRequestModal] Error creating expense request:', err);
        setFormError(err?.message || 'حدث خطأ أثناء حفظ طلب الصرف، يرجى المحاولة ثانية');
      }
    });
  };

  return (
    <div 
      ref={dialogRootRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-3 sm:p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-request-modal-title"
    >
      <div 
        className="bg-white rounded-3xl max-w-3xl lg:max-w-4xl w-full max-h-[92vh] shadow-2xl border border-slate-100 flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150 my-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between p-4 sm:p-5 border-b border-slate-100 bg-white sticky top-0 z-10">
          <div className="flex items-center gap-3">
            <div className={`h-11 w-11 rounded-2xl flex items-center justify-center text-white shadow-md ${
              isEditMode 
                ? 'bg-gradient-to-tr from-indigo-600 to-purple-500 shadow-indigo-500/20' 
                : requestType === 'income'
                ? 'bg-gradient-to-tr from-emerald-600 to-teal-500 shadow-emerald-500/20'
                : 'bg-gradient-to-tr from-[#0d9488] to-teal-500 shadow-teal-500/20'
            }`}>
              {isEditMode ? <Receipt className="h-5 w-5" /> : requestType === 'income' ? <ArrowDownLeft className="h-5 w-5" /> : <Wallet className="h-5 w-5" />}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 id="new-request-modal-title" className="text-base sm:text-lg font-black text-slate-900 tracking-tight">
                  {isEditMode 
                    ? `تعديل طلب المصروفات (${editingRequest?.requestNumber})` 
                    : (requestType === 'income' ? 'توريد وتحصيل مالي (Inflow)' : 'طلب صرف ومطالبة مالية')}
                </h3>
                <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-black ${
                  isEditMode
                    ? 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                    : requestType === 'income'
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    : 'bg-teal-50 text-teal-700 border border-teal-200'
                }`}>
                  {isEditMode ? 'وضع التعديل' : (requestType === 'income' ? '+ إيداع وتوريد' : '- منصرف مالي')}
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5 font-medium">
                {isEditMode
                  ? 'يمكنك تعديل تفاصيل ومبالغ وبنود الطلب والمرفقات قبل اعتماده وصرفه'
                  : requestType === 'income'
                  ? 'حدد المبلغ وشكل التوريد لإيداعه في كارت الخزينة وتحديث الرصيد فور الاستلام'
                  : 'أدخل تفاصيل المصروف والمبلغ، وأرفق الفاتورة أو إيصال السداد للاعتماد الفوري'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label="إغلاق النافذة"
            className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Form Container */}
        <form onSubmit={handleSubmit} onChange={markTouched} className="flex-1 flex flex-col min-h-0 overflow-hidden">
          
          {/* Scrollable Form Body */}
          <div ref={scrollContainerRef} className="flex-1 overflow-y-auto p-5 sm:p-7 space-y-5 text-xs">
          
            {/* Primary Operation Switcher (Always at the very top) */}
            <div className="bg-slate-100/80 p-1.5 rounded-2xl flex gap-2 border border-slate-200/60">
              <button
                type="button"
                onClick={() => handleSwitchRequestType('expense')}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl font-extrabold transition cursor-pointer text-xs ${
                  requestType === 'expense'
                    ? 'bg-white text-teal-900 shadow-xs border border-teal-200/80 ring-2 ring-teal-500/10'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
                }`}
              >
                <ArrowUpRight className="h-4 w-4 text-teal-600 stroke-[2.5]" />
                <span>طلب صرف مالي (- OUT)</span>
              </button>
              <button
                type="button"
                onClick={() => handleSwitchRequestType('income')}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl font-extrabold transition cursor-pointer text-xs ${
                  requestType === 'income'
                    ? 'bg-white text-emerald-900 shadow-xs border border-emerald-200/80 ring-2 ring-emerald-500/10'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
                }`}
              >
                <ArrowDownLeft className="h-4 w-4 text-emerald-600 stroke-[2.5]" />
                <span>توريد / تحصيل مالي (+ IN)</span>
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
                  {creatableOrgs.map((org) => (
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
                                  {fmtMoney(accountBalance(acc))} {currencyCode(acc.currency)}
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
                  OUTFLOW FORM (طلب صرف ومصروف مالي) - MODERN 3-CARD FRIENDLY LAYOUT
                 ========================================================================= */
              <div className="space-y-5 animate-in fade-in duration-150">
                {/* 1. Quick Request Templates Bar (Soft & Friendly) */}
                <div className="p-3 sm:p-3.5 rounded-2xl border border-slate-200/80 bg-slate-50/70 shadow-2xs space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-extrabold text-xs flex items-center gap-1.5 text-slate-800">
                      <Zap className="h-3.5 w-3.5 text-teal-600 fill-teal-600" />
                      <span>قوالب سريعة للمصروفات المتكررة:</span>
                    </span>
                    <span className="text-[10px] font-bold text-teal-700 bg-teal-50 px-2 py-0.5 rounded-full border border-teal-200/60">
                      تعبئة بنقرة واحدة
                    </span>
                  </div>

                  <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-thin">
                    {EXPENSE_QUICK_TEMPLATES.map((tpl) => (
                      <button
                        key={tpl.label}
                        type="button"
                        onClick={() => applyQuickTemplate(tpl)}
                        className="shrink-0 px-3 py-1.5 bg-white rounded-xl text-xs font-bold transition-all duration-150 shadow-2xs hover:shadow-xs cursor-pointer active:scale-95 flex items-center gap-1.5 border border-slate-200 hover:border-teal-500 hover:bg-teal-50/50 hover:text-teal-900 text-slate-700"
                        title={`تطبيق قالب سريع: ${tpl.title}`}
                      >
                        <span>{tpl.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* =====================================================================
                    CARD 1: بيانات الطلب والمبلغ (Request & Amount Data)
                   ===================================================================== */}
                <div className="bg-slate-50/60 border border-slate-200/90 rounded-3xl p-5 sm:p-6 space-y-4">
                  {/* Step Header */}
                  <div className="flex items-center justify-between pb-3 border-b border-slate-200/70">
                    <div className="flex items-center gap-2.5">
                      <span className="w-7 h-7 rounded-xl bg-teal-600 text-white flex items-center justify-center font-black text-xs shadow-xs">
                        1
                      </span>
                      <div>
                        <h4 className="font-black text-slate-900 text-sm">بيانات الطلب والمبلغ المطلوب</h4>
                        <p className="text-[11px] text-slate-500">أدخل القيمة المراد صرفها، العملة، ودرجة الأولوية وبند المصروف</p>
                      </div>
                    </div>
                    <span className="text-[11px] font-bold text-teal-800 bg-teal-50 border border-teal-200/80 px-2.5 py-0.5 rounded-full">
                      منصرف مالي (- OUT)
                    </span>
                  </div>

                  {/* Amount & Currency Fields */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="font-extrabold text-slate-800 text-xs flex items-center gap-1.5">
                        <Wallet className="h-3.5 w-3.5 text-teal-600" />
                        <span>المبلغ المطلوب صرفه *</span>
                      </label>
                      {fieldHighlight === 'amount' && (
                        <span className="text-[11px] font-black text-rose-700 bg-rose-50 border border-rose-200 px-2.5 py-0.5 rounded-full animate-pulse">
                          ⚠️ يرجى إدخال المبلغ هنا
                        </span>
                      )}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
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
                          className={`w-full p-3.5 bg-white border-2 rounded-2xl focus:outline-none font-black text-slate-900 pl-24 text-2xl sm:text-3xl shadow-xs transition-all ${
                            fieldHighlight === 'amount'
                              ? 'border-rose-500 ring-4 ring-rose-500/20'
                              : 'border-slate-200 focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10'
                          }`}
                        />
                        <span className="absolute left-3 top-3.5 px-2.5 py-1.5 rounded-xl text-xs font-black bg-slate-100 text-slate-700 border border-slate-200 flex items-center gap-1 pointer-events-none select-none">
                          <span>-</span>
                          <span>{currency}</span>
                        </span>
                      </div>

                      <div className="sm:col-span-4">
                        <select
                          value={currency}
                          onChange={(e) => setCurrency(e.target.value)}
                          className="w-full p-3.5 bg-white border border-slate-200 rounded-2xl focus:outline-none focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10 font-bold text-xs text-slate-800 shadow-xs h-full"
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

                  {/* Urgency Selector (Segmented Pills) */}
                  <div className="pt-1 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                    <span className="font-extrabold text-slate-700">درجة الأولوية:</span>
                    <div className="grid grid-cols-3 gap-2 sm:flex sm:items-center">
                      {[
                        { id: 'low', label: '🟢 عادي' },
                        { id: 'medium', label: '🟡 متوسط الأهمية' },
                        { id: 'high', label: '🔴 عاجل جداً' },
                      ].map((u) => (
                        <button
                          key={u.id}
                          type="button"
                          onClick={() => { setUrgency(u.id as any); markTouched(); }}
                          className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer text-center ${
                            urgency === u.id
                              ? 'bg-white text-slate-900 border-2 border-teal-600 shadow-xs ring-2 ring-teal-500/10'
                              : 'bg-white/80 text-slate-600 hover:bg-white border border-slate-200/90'
                          }`}
                        >
                          {u.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Category & Provider Grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="font-extrabold text-slate-700 flex items-center gap-1.5">
                          <Layers className="h-3.5 w-3.5 text-teal-600" />
                          <span>بند الخدمة / مركز التكلفة *</span>
                        </label>
                        <span className="text-[10px] text-slate-400 font-bold">
                          ({effectiveServices.length} متاح)
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
                        className="w-full p-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/10 font-bold text-slate-900 text-xs shadow-2xs"
                      >
                        {effectiveServices.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name} {s.code ? `(${s.code})` : ''}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="font-extrabold text-slate-700 flex items-center gap-1.5">
                          <Building className="h-3.5 w-3.5 text-teal-600" />
                          <span>مقدم الخدمة / المورد *</span>
                        </label>
                        <span className="text-[10px] text-slate-400 font-bold">
                          ({effectiveProviders.length} متاح)
                        </span>
                      </div>

                      <select
                        value={selectedProviderId}
                        onChange={(e) => setSelectedProviderId(e.target.value)}
                        className="w-full p-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/10 font-bold text-slate-900 text-xs shadow-2xs"
                      >
                        {effectiveProviders.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} {p.contactPerson ? `(مسؤول: ${p.contactPerson})` : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Title / Subject Selection */}
                  <div className="pt-1">
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="font-extrabold text-slate-700">موضوع وعنوان الطلب *</label>
                      <button
                        type="button"
                        onClick={() => {
                          setIsCustomTitle(!isCustomTitle);
                          if (!isCustomTitle && !customTitle) {
                            setCustomTitle(selectedTitlePreset.startsWith('✏️') ? '' : selectedTitlePreset);
                          }
                        }}
                        className="text-[11px] text-teal-700 hover:text-teal-800 font-bold flex items-center gap-1 cursor-pointer transition hover:underline"
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
                        className={`w-full p-3 bg-white border rounded-xl focus:outline-none font-medium text-xs shadow-2xs ${
                          fieldHighlight === 'title' 
                            ? 'border-rose-500 ring-2 ring-rose-500/20' 
                            : 'border-slate-200 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/10 text-slate-900'
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
                        className="w-full p-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/10 font-bold text-slate-900 text-xs shadow-2xs"
                      >
                        {EXPENSE_TITLE_TEMPLATES.map((tpl) => (
                          <option key={tpl} value={tpl}>{tpl}</option>
                        ))}
                      </select>
                    )}
                  </div>
                </div>

                {/* =====================================================================
                    CARD 2: تفاصيل الفاتورة وسند السداد (Invoice & Voucher Details)
                   ===================================================================== */}
                <div className="bg-white border border-slate-200/90 rounded-3xl p-5 sm:p-6 space-y-4 shadow-xs">
                  {/* Step Header */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
                    <div className="flex items-center gap-2.5">
                      <span className="w-7 h-7 rounded-xl bg-teal-600 text-white flex items-center justify-center font-black text-xs shadow-xs">
                        2
                      </span>
                      <div>
                        <h4 className="font-black text-slate-900 text-sm">تفاصيل الفاتورة وسند السداد</h4>
                        <p className="text-[11px] text-slate-500">إرفاق إيصال السداد أو الفاتورة لتوثيق المصداقية وحفظ الحقوق</p>
                      </div>
                    </div>

                    {/* Toggle: Personal Payment / Reimbursement */}
                    <div className="flex items-center gap-2.5 bg-slate-50 border border-slate-200/80 px-3 py-1.5 rounded-2xl self-start sm:self-auto shadow-2xs">
                      <span className="text-[11px] font-bold text-slate-700">سداد من جيبي الخاص:</span>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={isPrepaidByRequester}
                        onClick={() => { setIsPrepaidByRequester(!isPrepaidByRequester); markTouched(); }}
                        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                          isPrepaidByRequester ? 'bg-teal-600' : 'bg-slate-300'
                        }`}
                      >
                        <span
                          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${
                            isPrepaidByRequester ? 'translate-x-0' : '-translate-x-5'
                          }`}
                        />
                      </button>
                      <span className={`text-[10px] font-black px-2 py-0.5 rounded-lg ${
                        isPrepaidByRequester ? 'bg-teal-100 text-teal-900 border border-teal-300' : 'bg-slate-200 text-slate-600'
                      }`}>
                        {isPrepaidByRequester ? 'نعم (استرداد شخصي)' : 'لا (دفع مباشر)'}
                      </span>
                    </div>
                  </div>

                  {/* Clarification banner when personal payment is toggled */}
                  {isPrepaidByRequester && (
                    <div className="p-3.5 bg-teal-50/80 border border-teal-200/80 rounded-2xl text-xs text-teal-950 flex items-start gap-2.5 animate-in fade-in">
                      <CheckCircle2 className="h-4 w-4 text-teal-700 shrink-0 mt-0.5" />
                      <div>
                        <strong className="block font-bold">طلب استرداد مصروفات شخصية (Reimbursement):</strong>
                        <span className="text-[11px] text-teal-900 mt-0.5 block">
                          أنت تؤكد أنك قمت بسداد المبلغ من جيبك الخاص، وسيتم تحويل قيمة الفاتورة لحسابك الموضح كاسترداد للمصروفات بعد الاعتماد.
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Invoice Fields: Number & Date */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    <div>
                      <label className="block font-extrabold text-slate-700 mb-1.5 flex items-center gap-1.5 text-xs">
                        <Hash className="h-3.5 w-3.5 text-teal-600" />
                        <span>رقم الفاتورة / الإيصال (اختياري)</span>
                      </label>
                      <input
                        type="text"
                        value={invoiceNumber}
                        onChange={(e) => setInvoiceNumber(e.target.value)}
                        placeholder="مثال: INV-2026-0899 أو رقم إيصال الدفع..."
                        className="w-full p-3 bg-slate-50/70 border border-slate-200 rounded-xl font-medium text-slate-900 text-xs focus:bg-white focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/10 transition-all shadow-2xs"
                      />
                    </div>

                    <div>
                      <label className="block font-extrabold text-slate-700 mb-1.5 flex items-center gap-1.5 text-xs">
                        <Calendar className="h-3.5 w-3.5 text-teal-600" />
                        <span>تاريخ الفاتورة / السداد (اختياري)</span>
                      </label>
                      <input
                        type="date"
                        value={invoiceDate}
                        onChange={(e) => setInvoiceDate(e.target.value)}
                        className="w-full p-3 bg-slate-50/70 border border-slate-200 rounded-xl font-medium text-slate-900 text-xs focus:bg-white focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/10 transition-all shadow-2xs"
                      />
                    </div>
                  </div>

                  {/* File Upload Dropzone & Preview Area */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="font-extrabold text-slate-700 flex items-center gap-1.5 text-xs">
                        <Paperclip className="h-3.5 w-3.5 text-teal-600" />
                        <span>مرفق الفاتورة أو إيصال السداد</span>
                      </label>
                      <span className="text-[10px] text-slate-400 font-medium">بحد أقصى {MAX_UPLOAD_MB} ميجابايت (JPG, PNG, PDF)</span>
                    </div>

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
                        onClick={() => !isUploadingInvoice && fileInputRef.current?.click()}
                        className={`border-2 border-dashed border-slate-200 hover:border-teal-500 bg-slate-50/60 hover:bg-teal-50/30 rounded-2xl p-6 text-center cursor-pointer transition-all duration-200 flex flex-col items-center justify-center gap-2 group ${
                          isUploadingInvoice ? 'opacity-70 pointer-events-none' : ''
                        }`}
                      >
                        <div className="w-12 h-12 rounded-2xl bg-teal-50 group-hover:bg-teal-100 text-teal-700 flex items-center justify-center transition-colors shadow-2xs">
                          {isUploadingInvoice ? (
                            <Loader2 className="h-5 w-5 animate-spin" />
                          ) : (
                            <Upload className="h-5 w-5" />
                          )}
                        </div>
                        <div className="space-y-0.5">
                          <span className="text-xs font-bold text-slate-800 block group-hover:text-teal-900 transition-colors">
                            {isUploadingInvoice ? 'جاري ضغط ورفع مستند الفاتورة...' : 'انقر هنا لرفع صورة الفاتورة أو إيصال السداد'}
                          </span>
                          <span className="text-[11px] text-slate-500 block">
                            يدعم ملفات الصور (JPG, PNG) والمستندات الإلكترونية (PDF)
                          </span>
                        </div>
                        {!isUploadingInvoice && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              fileInputRef.current?.click();
                            }}
                            className="mt-1 px-4 py-1.5 bg-white hover:bg-slate-50 text-slate-700 hover:text-slate-900 font-bold text-xs rounded-xl border border-slate-200 shadow-2xs transition flex items-center gap-1.5 cursor-pointer"
                          >
                            <Paperclip className="h-3.5 w-3.5 text-slate-500" />
                            <span>اختيار ملف من جهازك</span>
                          </button>
                        )}
                      </div>
                    ) : (
                      <div className="bg-white border-2 border-teal-300 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
                        <div className="flex items-center gap-3 min-w-0">
                          {invoiceAttachment.url && (invoiceAttachment.type === 'png' || invoiceAttachment.type === 'jpg' || invoiceAttachment.type.startsWith('image/')) ? (
                            <img 
                              src={invoiceAttachment.url} 
                              alt="معاينة الفاتورة" 
                              className="w-12 h-12 rounded-xl object-cover border border-slate-200 shadow-2xs shrink-0 cursor-pointer hover:opacity-90 transition"
                              onClick={() => setPreviewModalUrl({ url: invoiceAttachment.url!, name: invoiceAttachment.name, type: invoiceAttachment.type })}
                              title="انقر للمعاينة بحجم كبير"
                            />
                          ) : (
                            <div className="w-12 h-12 rounded-xl bg-teal-50 text-teal-700 flex items-center justify-center font-bold text-xs shrink-0 border border-teal-200">
                              PDF
                            </div>
                          )}
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-slate-900 text-xs truncate block max-w-[200px] sm:max-w-xs" title={invoiceAttachment.name}>
                                {invoiceAttachment.name}
                              </span>
                              <span className="text-[10px] font-black text-teal-800 bg-teal-50 border border-teal-200 px-2 py-0.5 rounded-full shrink-0">
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
                              className="px-3 py-1.5 bg-slate-50 hover:bg-slate-100 text-slate-700 font-bold text-xs rounded-xl border border-slate-200 flex items-center gap-1.5 transition cursor-pointer"
                            >
                              <Eye className="h-3.5 w-3.5 text-slate-500" />
                              <span>معاينة المرفق</span>
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => { setInvoiceAttachment(null); markTouched(); }}
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

                  {/* Visa Document / Passport Attachment Area (When isVisaRequest) */}
                  {isVisaRequest && (
                    <div className="pt-3 border-t border-slate-100 space-y-2">
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="font-extrabold text-slate-800 flex items-center gap-1.5 text-xs">
                          <Paperclip className="h-3.5 w-3.5 text-teal-600" />
                          <span>مرفق مستند التأشيرة أو جواز السفر (اختياري)</span>
                        </label>
                        <span className="text-[10px] text-teal-800 bg-teal-50 px-2 py-0.5 rounded-full border border-teal-200 font-bold">اختياري</span>
                      </div>

                      <input
                        ref={visaFileInputRef}
                        type="file"
                        accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf"
                        onChange={handleVisaDocUpload}
                        className="hidden"
                        id="visa-doc-file-upload-input"
                      />

                      {!visaDocumentAttachment ? (
                        <div 
                          onClick={() => !isUploadingVisaDoc && visaFileInputRef.current?.click()}
                          className={`border-2 border-dashed border-teal-200 hover:border-teal-500 bg-teal-50/40 hover:bg-teal-50/70 rounded-2xl p-5 text-center cursor-pointer transition-all duration-200 flex flex-col items-center justify-center gap-2 group ${
                            isUploadingVisaDoc ? 'opacity-70 pointer-events-none' : ''
                          }`}
                        >
                          <div className="w-10 h-10 rounded-xl bg-teal-100 text-teal-700 flex items-center justify-center transition-colors shadow-2xs">
                            {isUploadingVisaDoc ? (
                              <Loader2 className="h-5 w-5 animate-spin" />
                            ) : (
                              <Upload className="h-5 w-5" />
                            )}
                          </div>
                          <div className="space-y-0.5">
                            <span className="text-xs font-bold text-slate-800 block group-hover:text-teal-950 transition-colors">
                              {isUploadingVisaDoc ? 'جاري ضغط ورفع مستند التأشيرة...' : 'انقر هنا لرفع صورة مستند التأشيرة أو جواز السفر'}
                            </span>
                            <span className="text-[11px] text-slate-500 block">
                              يدعم صور التأشيرة (JPG, PNG) أو ملف التأشيرة الإلكتروني (PDF)
                            </span>
                          </div>
                        </div>
                      ) : (
                        <div className="bg-white border-2 border-teal-400 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
                          <div className="flex items-center gap-3 min-w-0">
                            {visaDocumentAttachment.url && (visaDocumentAttachment.type === 'png' || visaDocumentAttachment.type === 'jpg' || visaDocumentAttachment.type.startsWith('image/')) ? (
                              <img 
                                src={visaDocumentAttachment.url} 
                                alt="مستند التأشيرة" 
                                className="w-12 h-12 rounded-xl object-cover border border-teal-200 shadow-2xs shrink-0 cursor-pointer hover:opacity-90 transition"
                                onClick={() => setPreviewModalUrl({ url: visaDocumentAttachment.url!, name: visaDocumentAttachment.name, type: visaDocumentAttachment.type })}
                                title="انقر للمعاينة"
                              />
                            ) : (
                              <div className="w-12 h-12 rounded-xl bg-teal-50 text-teal-700 flex items-center justify-center font-bold text-xs shrink-0 border border-teal-200">
                                PDF
                              </div>
                            )}
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-slate-900 text-xs truncate block max-w-[200px] sm:max-w-xs" title={visaDocumentAttachment.name}>
                                  {visaDocumentAttachment.name}
                                </span>
                                <span className="text-[10px] font-black text-teal-800 bg-teal-50 border border-teal-200 px-2 py-0.5 rounded-full shrink-0">
                                  مستند التأشيرة ✓
                                </span>
                              </div>
                              <div className="text-[11px] text-slate-400 mt-0.5 flex items-center gap-2">
                                <span>الحجم: {visaDocumentAttachment.size}</span>
                                <span>•</span>
                                <span>النوع: {visaDocumentAttachment.type.toUpperCase()}</span>
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
                            {visaDocumentAttachment.url && (
                              <button
                                type="button"
                                onClick={() => {
                                  if (visaDocumentAttachment.url) {
                                    setPreviewModalUrl({ url: visaDocumentAttachment.url, name: visaDocumentAttachment.name, type: visaDocumentAttachment.type });
                                  }
                                }}
                                className="px-3 py-1.5 bg-slate-50 hover:bg-slate-100 text-slate-700 font-bold text-xs rounded-xl border border-slate-200 flex items-center gap-1.5 transition cursor-pointer"
                              >
                                <Eye className="h-3.5 w-3.5 text-slate-500" />
                                <span>معاينة المستند</span>
                              </button>
                            )}

                            <button
                              type="button"
                              onClick={() => { setVisaDocumentAttachment(null); markTouched(); }}
                              className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold text-xs rounded-xl border border-rose-200 flex items-center gap-1.5 transition cursor-pointer"
                              title="حذف مستند التأشيرة"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              <span>حذف</span>
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Installment Transfer Screenshot Area (When isInstallmentRequest) */}
                  {isInstallmentRequest && (
                    <div className="pt-3 border-t border-slate-100 space-y-2">
                      <div className="flex items-center justify-between mb-1.5 flex-wrap gap-1">
                        <label className="font-extrabold text-slate-800 flex items-center gap-1.5 text-xs">
                          <Paperclip className="h-3.5 w-3.5 text-blue-600" />
                          <span>مرفق سكرين التحويل أو إثبات السداد (انستاباي أو سداد بنكي) (اختياري)</span>
                        </label>
                        <div className="flex items-center gap-1">
                          <span className="text-[10px] text-blue-900 bg-blue-100/80 px-2 py-0.5 rounded-full border border-blue-200 font-bold">⚡ انستاباي</span>
                          <span className="text-[10px] text-indigo-900 bg-indigo-100/80 px-2 py-0.5 rounded-full border border-indigo-200 font-bold">🏦 سداد بنكي</span>
                          <span className="text-[10px] text-slate-600 bg-slate-100 px-2 py-0.5 rounded-full border border-slate-200 font-bold">اختياري</span>
                        </div>
                      </div>

                      <input
                        ref={installmentFileInputRef}
                        type="file"
                        accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf"
                        onChange={handleInstallmentTransferUpload}
                        className="hidden"
                        id="installment-transfer-file-upload-input"
                      />

                      {!installmentTransferAttachment ? (
                        <div 
                          onClick={() => !isUploadingInstallmentTransfer && installmentFileInputRef.current?.click()}
                          className={`border-2 border-dashed border-blue-300 hover:border-blue-500 bg-blue-50/50 hover:bg-blue-50/80 rounded-2xl p-5 text-center cursor-pointer transition-all duration-200 flex flex-col items-center justify-center gap-2 group ${
                            isUploadingInstallmentTransfer ? 'opacity-70 pointer-events-none' : ''
                          }`}
                        >
                          <div className="w-10 h-10 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center transition-colors shadow-2xs">
                            {isUploadingInstallmentTransfer ? (
                              <Loader2 className="h-5 w-5 animate-spin" />
                            ) : (
                              <Upload className="h-5 w-5" />
                            )}
                          </div>
                          <div className="space-y-0.5">
                            <span className="text-xs font-bold text-slate-800 block group-hover:text-blue-950 transition-colors">
                              {isUploadingInstallmentTransfer ? 'جاري ضغط ورفع سكرين التحويل...' : 'انقر هنا لرفع سكرين شوت تحويل أو سداد مبلغ القسط'}
                            </span>
                            <span className="text-[11px] text-slate-500 block">
                              إشعار تحويل بنكي (Bank Transfer) أو سكرين شوت إنستاباي (InstaPay) لمبلغ القسط
                            </span>
                          </div>
                        </div>
                      ) : (
                        <div className="bg-white border-2 border-blue-400 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
                          <div className="flex items-center gap-3 min-w-0">
                            {installmentTransferAttachment.url && (installmentTransferAttachment.type === 'png' || installmentTransferAttachment.type === 'jpg' || installmentTransferAttachment.type.startsWith('image/')) ? (
                              <img 
                                src={installmentTransferAttachment.url} 
                                alt="سكرين سداد القسط" 
                                className="w-12 h-12 rounded-xl object-cover border border-blue-200 shadow-2xs shrink-0 cursor-pointer hover:opacity-90 transition"
                                onClick={() => setPreviewModalUrl({ url: installmentTransferAttachment.url!, name: installmentTransferAttachment.name, type: installmentTransferAttachment.type })}
                                title="انقر للمعاينة"
                              />
                            ) : (
                              <div className="w-12 h-12 rounded-xl bg-blue-50 text-blue-700 flex items-center justify-center font-bold text-xs shrink-0 border border-blue-200">
                                PDF
                              </div>
                            )}
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-slate-900 text-xs truncate block max-w-[200px] sm:max-w-xs" title={installmentTransferAttachment.name}>
                                  {installmentTransferAttachment.name}
                                </span>
                                <span className="text-[10px] font-black text-blue-800 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-full shrink-0">
                                  سكرين القسط ✓
                                </span>
                              </div>
                              <div className="text-[11px] text-slate-400 mt-0.5 flex items-center gap-2">
                                <span>الحجم: {installmentTransferAttachment.size}</span>
                                <span>•</span>
                                <span>النوع: {installmentTransferAttachment.type.toUpperCase()}</span>
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
                            {installmentTransferAttachment.url && (
                              <button
                                type="button"
                                onClick={() => {
                                  if (installmentTransferAttachment.url) {
                                    setPreviewModalUrl({ url: installmentTransferAttachment.url, name: installmentTransferAttachment.name, type: installmentTransferAttachment.type });
                                  }
                                }}
                                className="px-3 py-1.5 bg-slate-50 hover:bg-slate-100 text-slate-700 font-bold text-xs rounded-xl border border-slate-200 flex items-center gap-1.5 transition cursor-pointer"
                              >
                                <Eye className="h-3.5 w-3.5 text-slate-500" />
                                <span>معاينة السكرين</span>
                              </button>
                            )}

                            <button
                              type="button"
                              onClick={() => { setInstallmentTransferAttachment(null); markTouched(); }}
                              className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold text-xs rounded-xl border border-rose-200 flex items-center gap-1.5 transition cursor-pointer"
                              title="حذف سكرين القسط"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              <span>حذف</span>
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Wallet Top-up Screenshot Area (When isWalletTopupRequest) */}
                  {isWalletTopupRequest && (
                    <div className="pt-3 border-t border-slate-100 space-y-2">
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="font-extrabold text-slate-800 flex items-center gap-1.5 text-xs">
                          <Paperclip className="h-3.5 w-3.5 text-purple-600" />
                          <span>مرفق سكرين شوت الشحن والتحويل للمحفظة (اختياري)</span>
                        </label>
                        <span className="text-[10px] text-purple-800 bg-purple-50 px-2 py-0.5 rounded-full border border-purple-200 font-bold">اختياري</span>
                      </div>

                      <input
                        ref={walletFileInputRef}
                        type="file"
                        accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf"
                        onChange={handleWalletTransferUpload}
                        className="hidden"
                        id="wallet-transfer-file-upload-input"
                      />

                      {!walletTransferAttachment ? (
                        <div 
                          onClick={() => !isUploadingWalletTransfer && walletFileInputRef.current?.click()}
                          className={`border-2 border-dashed border-purple-200 hover:border-purple-500 bg-purple-50/40 hover:bg-purple-50/70 rounded-2xl p-5 text-center cursor-pointer transition-all duration-200 flex flex-col items-center justify-center gap-2 group ${
                            isUploadingWalletTransfer ? 'opacity-70 pointer-events-none' : ''
                          }`}
                        >
                          <div className="w-10 h-10 rounded-xl bg-purple-100 text-purple-700 flex items-center justify-center transition-colors shadow-2xs">
                            {isUploadingWalletTransfer ? (
                              <Loader2 className="h-5 w-5 animate-spin" />
                            ) : (
                              <Upload className="h-5 w-5" />
                            )}
                          </div>
                          <div className="space-y-0.5">
                            <span className="text-xs font-bold text-slate-800 block group-hover:text-purple-950 transition-colors">
                              {isUploadingWalletTransfer ? 'جاري ضغط ورفع سكرين الشحن...' : 'انقر هنا لرفع سكرين شوت إثبات الشحن والتحويل للمحفظة'}
                            </span>
                            <span className="text-[11px] text-slate-500 block">
                              صورة رسالة التأكيد أو إشعار التحويل لرقم محفظة المندوب
                            </span>
                          </div>
                        </div>
                      ) : (
                        <div className="bg-white border-2 border-purple-400 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
                          <div className="flex items-center gap-3 min-w-0">
                            {walletTransferAttachment.url && (walletTransferAttachment.type === 'png' || walletTransferAttachment.type === 'jpg' || walletTransferAttachment.type.startsWith('image/')) ? (
                              <img 
                                src={walletTransferAttachment.url} 
                                alt="سكرين شحن المحفظة" 
                                className="w-12 h-12 rounded-xl object-cover border border-purple-200 shadow-2xs shrink-0 cursor-pointer hover:opacity-90 transition"
                                onClick={() => setPreviewModalUrl({ url: walletTransferAttachment.url!, name: walletTransferAttachment.name, type: walletTransferAttachment.type })}
                                title="انقر للمعاينة"
                              />
                            ) : (
                              <div className="w-12 h-12 rounded-xl bg-purple-50 text-purple-700 flex items-center justify-center font-bold text-xs shrink-0 border border-purple-200">
                                PDF
                              </div>
                            )}
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-slate-900 text-xs truncate block max-w-[200px] sm:max-w-xs" title={walletTransferAttachment.name}>
                                  {walletTransferAttachment.name}
                                </span>
                                <span className="text-[10px] font-black text-purple-800 bg-purple-50 border border-purple-200 px-2 py-0.5 rounded-full shrink-0">
                                  سكرين المحفظة ✓
                                </span>
                              </div>
                              <div className="text-[11px] text-slate-400 mt-0.5 flex items-center gap-2">
                                <span>الحجم: {walletTransferAttachment.size}</span>
                                <span>•</span>
                                <span>النوع: {walletTransferAttachment.type.toUpperCase()}</span>
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
                            {walletTransferAttachment.url && (
                              <button
                                type="button"
                                onClick={() => {
                                  if (walletTransferAttachment.url) {
                                    setPreviewModalUrl({ url: walletTransferAttachment.url, name: walletTransferAttachment.name, type: walletTransferAttachment.type });
                                  }
                                }}
                                className="px-3 py-1.5 bg-slate-50 hover:bg-slate-100 text-slate-700 font-bold text-xs rounded-xl border border-slate-200 flex items-center gap-1.5 transition cursor-pointer"
                              >
                                <Eye className="h-3.5 w-3.5 text-slate-500" />
                                <span>معاينة السكرين</span>
                              </button>
                            )}

                            <button
                              type="button"
                              onClick={() => { setWalletTransferAttachment(null); markTouched(); }}
                              className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold text-xs rounded-xl border border-rose-200 flex items-center gap-1.5 transition cursor-pointer"
                              title="حذف سكرين المحفظة"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              <span>حذف</span>
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* =====================================================================
                    CARD 3: المستفيد وطريقة التحويل (Beneficiary & Payout Method)
                   ===================================================================== */}
                <div className="bg-slate-50/60 border border-slate-200/90 rounded-3xl p-5 sm:p-6 space-y-4">
                  {/* Step Header */}
                  <div className="flex items-center justify-between pb-3 border-b border-slate-200/70">
                    <div className="flex items-center gap-2.5">
                      <span className="w-7 h-7 rounded-xl bg-teal-600 text-white flex items-center justify-center font-black text-xs shadow-xs">
                        3
                      </span>
                      <div>
                        <h4 className="font-black text-slate-900 text-sm">المستفيد وطريقة التحويل</h4>
                        <p className="text-[11px] text-slate-500">طريقة سداد واستلام المبلغ لحساب المستفيد</p>
                      </div>
                    </div>

                    {/* Auto-fill badge if details match profile */}
                    {paymentAccountDetails && (
                      paymentAccountDetails === currentUser.instapay || 
                      paymentAccountDetails === currentUser.wallet || 
                      paymentAccountDetails === currentUser.phone ||
                      paymentAccountDetails === currentUser.iban ||
                      (currentUser.iban && paymentAccountDetails.includes(currentUser.iban)) ||
                      paymentAccountDetails === 'خزينة المقر الرئيسي'
                    ) && (
                      <span className="text-[10px] font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-full flex items-center gap-1">
                        <Zap className="h-3 w-3 text-emerald-600 fill-emerald-600" />
                        <span>معبأة تلقائياً من بروفايلك</span>
                      </span>
                    )}
                  </div>

                  {/* Payment Method Selector */}
                  <div>
                    <label className="block font-extrabold text-slate-700 mb-1.5 text-xs">
                      طريقة التحويل المفضلة للمستفيد *
                    </label>
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
                      className="w-full p-3 bg-white border border-slate-200 rounded-xl font-bold text-xs text-slate-900 focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/10 shadow-2xs"
                    >
                      <option value="instapay">انستاباي (InstaPay)</option>
                      <option value="bank_transfer">تحويل بنكي فوري (IBAN)</option>
                      <option value="digital_wallet">محفظة إلكترونية (فودافون كاش / اتصالات / أورانج)</option>
                      <option value="cash">نقداً من الخزينة</option>
                      {preferredPaymentMethod === 'cheque' && <option value="cheque">شيك مصرفي</option>}
                    </select>
                  </div>

                  {/* Payout Details Grid (With dedicated Beneficiary Name for InstaPay) */}
                  {preferredPaymentMethod === 'instapay' ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 bg-emerald-50/50 p-4 rounded-2xl border border-emerald-200/90 shadow-2xs">
                      {/* 1. InstaPay Address / Mobile */}
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <label className="font-extrabold text-slate-800 text-xs">
                            عنوان انستاباي (IPA / رقم الهاتف) *
                          </label>
                          {!paymentAccountDetails && getProfilePayoutDetail('instapay') && (
                            <button
                              type="button"
                              onClick={() => setPaymentAccountDetails(getProfilePayoutDetail('instapay'))}
                              className="text-[10px] text-teal-700 font-bold hover:underline cursor-pointer flex items-center gap-1"
                            >
                              ⚡ ملء من بروفايلي
                            </button>
                          )}
                        </div>
                        <input
                          ref={paymentInputRef}
                          type="text"
                          value={paymentAccountDetails}
                          onChange={(e) => {
                            setPaymentAccountDetails(sanitizeInstaPay(e.target.value));
                            if (formError) setFormError(null);
                            if (fieldHighlight === 'paymentDetails') setFieldHighlight(null);
                          }}
                          placeholder="user@instapay أو 010xxxxxxxx"
                          className={`w-full p-3 bg-white border rounded-xl font-mono text-xs shadow-2xs transition-all ${
                            fieldHighlight === 'paymentDetails' 
                              ? 'border-rose-500 ring-2 ring-rose-500/20' 
                              : 'border-slate-200 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/10 text-slate-900'
                          }`}
                        />
                      </div>

                      {/* 2. Beneficiary Full Name */}
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <label className="font-extrabold text-slate-800 text-xs">
                            اسم المستفيد الرباعي (المسجل في انستاباي) *
                          </label>
                          <span className="text-[10px] text-emerald-800 font-bold bg-white px-2 py-0.5 rounded-md border border-emerald-200">
                            لمطابقة التحويل
                          </span>
                        </div>
                        <input
                          ref={beneficiaryInputRef}
                          type="text"
                          value={beneficiaryName}
                          onChange={(e) => {
                            setBeneficiaryName(e.target.value);
                            if (formError) setFormError(null);
                            if (fieldHighlight === 'beneficiary') setFieldHighlight(null);
                          }}
                          placeholder="مثال: أحمد محمد عبد الرحمن علي"
                          aria-required="true"
                          aria-invalid={fieldHighlight === 'beneficiary'}
                          className={`w-full p-3 bg-white border rounded-xl font-bold text-xs text-slate-900 shadow-2xs transition-all ${
                            fieldHighlight === 'beneficiary'
                              ? 'border-rose-500 ring-2 ring-rose-500/20'
                              : 'border-slate-200 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/10'
                          }`}
                        />
                      </div>
                    </div>
                  ) : (
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="font-extrabold text-slate-700 text-xs">
                          {preferredPaymentMethod === 'digital_wallet' ? 'رقم المحفظة الإلكترونية (أرقام فقط) *' :
                           preferredPaymentMethod === 'bank_transfer' ? 'رقم الآيبان (IBAN) *' : 'جهة الاستلام'}
                        </label>
                        {!paymentAccountDetails && getProfilePayoutDetail(preferredPaymentMethod) && (
                          <button
                            type="button"
                            onClick={() => setPaymentAccountDetails(getProfilePayoutDetail(preferredPaymentMethod))}
                            className="text-[10px] text-teal-700 font-bold hover:underline cursor-pointer flex items-center gap-1"
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
                          } else {
                            setPaymentAccountDetails(raw);
                          }
                          if (formError) setFormError(null);
                          if (fieldHighlight === 'paymentDetails') setFieldHighlight(null);
                        }}
                        placeholder={
                          preferredPaymentMethod === 'digital_wallet' ? '010xxxxxxxx (أرقام فقط)' :
                          preferredPaymentMethod === 'bank_transfer' ? 'EG... / SA... (حروف وأرقام)' : 'الفرع أو الخزينة'
                        }
                        className={`w-full p-3 bg-white border rounded-xl font-mono text-xs shadow-2xs transition-all ${
                          fieldHighlight === 'paymentDetails' 
                            ? 'border-rose-500 ring-2 ring-rose-500/20' 
                            : 'border-slate-200 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/10 text-slate-900'
                        }`}
                      />
                    </div>
                  )}

                  {/* Installment Device Selector Box (When isInstallmentRequest) */}
                  {isInstallmentRequest && (
                    <div className="bg-blue-50/70 border-2 border-blue-200/90 rounded-2xl p-4 space-y-3.5 shadow-2xs">
                      <div className="flex items-center justify-between border-b border-blue-200/70 pb-2">
                        <div className="flex items-center gap-1.5 font-black text-xs text-blue-950">
                          <span>⚙️ نوع وتفاصيل الجهاز المقسط له (اختيار وتعبئة بنقرة واحدة One-Touch) *</span>
                        </div>
                        <span className="text-[10px] font-bold text-blue-800 bg-blue-100/90 px-2.5 py-0.5 rounded-full border border-blue-300">
                          سداد قسط شهري
                        </span>
                      </div>

                      {/* One-Touch Quick Preset Buttons */}
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-bold text-slate-700 flex items-center gap-1">
                            <span>👇 اختيارات الأجهزة الجاهزة (One-Touch):</span>
                            <span className="text-[10px] text-blue-700 font-normal">اضغطي لتحديد الجهاز ووصفه الكامل فوراً</span>
                          </span>
                          <span className="text-[10px] font-extrabold text-blue-800 bg-blue-100 px-2 py-0.5 rounded-md">
                            جاهز بالوصف آلياً
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {INSTALLMENT_DEVICE_PRESETS.map((preset) => {
                            const isSelected = installmentDeviceType === preset.name;
                            return (
                              <button
                                key={preset.id}
                                type="button"
                                onClick={() => {
                                  setInstallmentDeviceType(preset.name);
                                  setInstallmentDeviceDescription(preset.description);
                                }}
                                className={`px-2.5 py-1.5 rounded-xl text-xs font-bold transition-all duration-150 flex items-center gap-1.5 cursor-pointer border shadow-2xs ${
                                  isSelected 
                                    ? 'bg-blue-700 text-white border-blue-800 shadow-xs ring-2 ring-blue-400/30 scale-[1.02]' 
                                    : 'bg-white hover:bg-blue-100/70 text-slate-700 border-blue-200 hover:border-blue-400'
                                }`}
                                title={preset.description}
                              >
                                <span>{preset.badge}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                        <div>
                          <label className="block font-extrabold text-slate-800 text-xs mb-1.5">
                            نوع وعمل الجهاز المقسط له *
                          </label>
                          <select
                            value={installmentDeviceType}
                            onChange={(e) => {
                              const val = e.target.value;
                              setInstallmentDeviceType(val);
                              const match = INSTALLMENT_DEVICE_PRESETS.find(p => p.name === val);
                              if (match) {
                                setInstallmentDeviceDescription(match.description);
                              }
                            }}
                            className="w-full p-3 bg-white border border-blue-200 rounded-xl font-bold text-xs text-slate-900 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10 shadow-2xs"
                          >
                            {INSTALLMENT_DEVICE_PRESETS.map((preset) => (
                              <option key={preset.id} value={preset.name}>
                                {preset.name}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label className="block font-extrabold text-slate-800 text-xs mb-1.5 flex items-center justify-between">
                            <span>وصف وموديل الجهاز ومواصفات القسط *</span>
                            <span className="text-[10px] text-blue-700 font-bold">تعبئة آلية وقابل للتعديل</span>
                          </label>
                          <input
                            type="text"
                            value={installmentDeviceDescription}
                            onChange={(e) => setInstallmentDeviceDescription(e.target.value)}
                            placeholder="وصف ومواصفات الجهاز وموديله ورقم القسط..."
                            className="w-full p-3 bg-white border border-blue-200 rounded-xl font-medium text-xs text-slate-900 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10 shadow-2xs"
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Items Detail or Visa Details (Dynamic Label & Quick Suggestions) */}
                  <div className="pt-1">
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="block font-extrabold text-slate-800 text-xs flex items-center gap-1.5">
                        {isVisaRequest ? (
                          <>
                            <span className="text-teal-700 font-black">✈️ نوع التأشيرة وبيانات المسافر *</span>
                            <span className="text-[10px] text-teal-800 bg-teal-50 px-2 py-0.5 rounded-full border border-teal-200 font-bold">بند التأشيرات</span>
                          </>
                        ) : (
                          <span>بيانات البضاعة أو الأصناف (اختياري - اسم الصنف، الكمية، سعر الوحدة)</span>
                        )}
                      </label>
                    </div>

                    {isVisaRequest && (
                      <div className="flex flex-wrap gap-1.5 mb-2">
                        {['سياحية', 'عمرة باركود', 'عمرة خارجي', 'عمل / إقامة', 'زيارة عائلية', 'ترانزيت'].map((vType) => (
                          <button
                            key={vType}
                            type="button"
                            onClick={() => {
                              if (!itemsDetail.includes(vType)) {
                                setItemsDetail(prev => prev ? `${vType} - ${prev}` : `تأشيرة ${vType}`);
                              }
                            }}
                            className="px-2.5 py-1 text-[11px] font-bold rounded-lg bg-teal-50 hover:bg-teal-100 text-teal-800 border border-teal-200 transition cursor-pointer"
                          >
                            +{vType}
                          </button>
                        ))}
                      </div>
                    )}

                    <input
                      type="text"
                      value={itemsDetail}
                      onChange={(e) => setItemsDetail(e.target.value)}
                      placeholder={
                        isVisaRequest 
                          ? "مثال: تأشيرة سياحية للسعودية - المسافر: أحمد محمد - رقم الجواز: A12345678" 
                          : "مثال: فطار مجمع وحليب ومستلزمات، أو 10 كراتين بضاعة x 150 ج.م..."
                      }
                      className="w-full p-3 bg-white border border-slate-200 rounded-xl font-medium text-slate-800 text-xs focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/10 shadow-2xs"
                    />
                  </div>

                  {/* Justification Field (Hidden when isVisaRequest per requirements) */}
                  {!isVisaRequest && (
                    <div className="pt-1">
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="font-extrabold text-slate-700 text-xs">المبرر المالي للطلب *</label>
                        <button
                          type="button"
                          onClick={() => {
                            setIsCustomJustification(!isCustomJustification);
                            if (!isCustomJustification && !customJustification) {
                              setCustomJustification(selectedJustPreset.startsWith('✏️') ? '' : selectedJustPreset);
                            }
                          }}
                          className="text-[11px] text-teal-700 hover:text-teal-800 font-bold flex items-center gap-1 cursor-pointer transition hover:underline"
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
                          className="w-full p-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/10 text-slate-900 text-xs shadow-2xs"
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
                          className="w-full p-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/10 font-semibold text-slate-900 text-xs shadow-2xs"
                        >
                          {EXPENSE_JUSTIFICATION_TEMPLATES.map((tpl) => (
                            <option key={tpl} value={tpl}>{tpl}</option>
                          ))}
                        </select>
                      )}
                    </div>
                  )}

                  {/* Description Field */}
                  <div className="pt-1">
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="font-extrabold text-slate-700 text-xs">تفاصيل ومواصفات الطلب</label>
                      <button
                        type="button"
                        onClick={() => {
                          setIsCustomDescription(!isCustomDescription);
                          if (!isCustomDescription && !customDescription) {
                            setCustomDescription(selectedDescPreset.startsWith('✏️') ? '' : selectedDescPreset);
                          }
                        }}
                        className="text-[11px] text-teal-700 hover:text-teal-800 font-bold flex items-center gap-1 cursor-pointer transition hover:underline"
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
                        className="w-full p-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/10 text-slate-900 text-xs shadow-2xs"
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
                        className="w-full p-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/10 font-semibold text-slate-900 text-xs shadow-2xs"
                      >
                        {EXPENSE_DESCRIPTION_TEMPLATES.map((tpl) => (
                          <option key={tpl} value={tpl}>{tpl}</option>
                        ))}
                      </select>
                    )}
                  </div>
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

          {/* Sticky Footer Buttons with Amount Summary */}
          <div className="shrink-0 flex items-center justify-between gap-3 p-4 sm:p-5 border-t border-slate-100 bg-white sticky bottom-0 z-10 shadow-lg">
            <div className="flex items-center gap-3">
              <div className="text-right">
                <span className="text-[10px] text-slate-400 font-bold block">إجمالي مبلغ الطلب</span>
                <span className="text-base sm:text-lg font-black text-slate-900 flex items-center gap-1">
                  <span>{amount ? fmtMoney(amount) : '0.00'}</span>
                  <span className="text-xs font-bold text-teal-700">{currency}</span>
                </span>
              </div>
              <div className="h-8 w-px bg-slate-200 hidden sm:block" />
              <div className="text-[11px] font-semibold text-slate-500 hidden sm:flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${requestType === 'income' ? 'bg-emerald-500' : 'bg-teal-500'}`} />
                <span>{requestType === 'income' ? 'توريد مالي (+ IN)' : 'صرف ومصروف (- OUT)'}</span>
              </div>
            </div>

            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={handleClose}
                className="px-4 py-2.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-xl transition cursor-pointer font-bold text-xs"
              >
                إلغاء
              </button>
              <button
                type="submit"
                disabled={submitting || isAnyUploadInProgress}
                className={`px-6 py-2.5 text-white font-extrabold rounded-xl shadow-md transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 text-xs ${
                  isEditMode
                    ? 'bg-indigo-600 hover:bg-indigo-700 shadow-indigo-600/20'
                    : requestType === 'income'
                    ? 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-600/20'
                    : 'bg-[#0d9488] hover:bg-[#0f766e] shadow-teal-700/20'
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
                    <span>إرسال طلب التوريد للمراجعة (+ IN)</span>
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
        <InvoiceViewerModal
          attachment={previewModalUrl}
          onClose={() => setPreviewModalUrl(null)}
        />
      )}
    </div>
  );
};
