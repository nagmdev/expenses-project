import React, { useState, useMemo, useRef } from 'react';
import { useApp } from '../context/AppContext';
import { 
  VisaRequest, 
  VisaPaymentRecord, 
  VisaType, 
  VisaStatus, 
  VISA_TYPE_LABELS, 
  VISA_STATUS_LABELS,
  PaymentMethod,
  SUPPORTED_CURRENCIES
} from '../types';
import { compressImage } from '../utils/fileUpload';
import { 
  Plane, 
  Plus, 
  Search, 
  Filter, 
  CheckCircle2, 
  XCircle, 
  Clock, 
  AlertTriangle, 
  CreditCard, 
  FileText, 
  UploadCloud, 
  Trash2, 
  Eye, 
  User as UserIcon, 
  Building2, 
  Calendar, 
  Wallet, 
  Lock, 
  ShieldCheck, 
  X, 
  ArrowLeft,
  ChevronDown,
  Paperclip,
  Check,
  Receipt,
  FileCheck2,
  DollarSign
} from 'lucide-react';

export const VisaManagement: React.FC = () => {
  const { 
    visaRequests, 
    createVisaRequest, 
    updateVisaRequest, 
    approveVisaRequest, 
    rejectVisaRequest, 
    addVisaPayment, 
    deleteVisaRequest,
    providers,
    paymentAccounts,
    currentUser,
    currentRole,
    effectiveOrgId,
    organizations
  } = useApp();

  // Modal states
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [selectedVisa, setSelectedVisa] = useState<VisaRequest | null>(null);

  // Search & Filter state
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedTypeFilter, setSelectedTypeFilter] = useState<string>('all');
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<string>('all');

  // User Permissions
  const isPrivilegedUser = currentRole === 'org_admin' || currentRole === 'finance' || currentRole === 'super_admin';
  const canApprove = isPrivilegedUser || Boolean(
    currentUser?.name && 
    selectedVisa?.assignedApprover && 
    currentUser.name.trim().toLowerCase().includes(selectedVisa.assignedApprover.trim().toLowerCase())
  );
  const canManagePayments = isPrivilegedUser;

  // Form State for New Visa Request
  const [travelerName, setTravelerName] = useState('');
  const [passportNumber, setPassportNumber] = useState('');
  const [destinationCountry, setDestinationCountry] = useState('');
  const [hasTraveledBefore, setHasTraveledBefore] = useState(false);
  const [expectedTravelDate, setExpectedTravelDate] = useState('');
  const [visaType, setVisaType] = useState<VisaType>('tourist');
  const [totalAmount, setTotalAmount] = useState<number | ''>('');
  const [initialPayment, setInitialPayment] = useState<number | ''>('');
  const [currency, setCurrency] = useState('EGP');
  const [paymentMode, setPaymentMode] = useState<'full' | 'installments'>('full');
  const [visaAttachmentUrl, setVisaAttachmentUrl] = useState<string>('');
  const [visaAttachmentName, setVisaAttachmentName] = useState<string>('');
  const [visaAttachmentSize, setVisaAttachmentSize] = useState<number>(0);
  const [serviceProviderId, setServiceProviderId] = useState('');
  const [notes, setNotes] = useState('');

  // Validation & feedback state for create modal
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Detail Modal Action states
  const [rejectionReason, setRejectionReason] = useState('');
  const [isRejecting, setIsRejecting] = useState(false);
  const [isAddingPayment, setIsAddingPayment] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState<number | ''>('');
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().split('T')[0]);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('bank_transfer');
  const [paymentAccountId, setPaymentAccountId] = useState('');
  const [receiptReference, setReceiptReference] = useState('');
  const [paymentNotes, setPaymentNotes] = useState('');
  const [paymentError, setPaymentError] = useState('');
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);

  // Active Visa Provider Options (filtered by current org)
  const availableProviders = useMemo(() => {
    return providers.filter(p => !effectiveOrgId || p.orgId === effectiveOrgId || !p.orgId);
  }, [providers, effectiveOrgId]);

  // Available Treasury Accounts
  const availableAccounts = useMemo(() => {
    return paymentAccounts.filter(a => !effectiveOrgId || a.orgId === effectiveOrgId);
  }, [paymentAccounts, effectiveOrgId]);

  // Filtered Visa Requests
  const filteredVisaRequests = useMemo(() => {
    return visaRequests.filter(req => {
      const matchSearch = 
        !searchTerm.trim() ||
        req.travelerName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        req.passportNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (req.destinationCountry && req.destinationCountry.toLowerCase().includes(searchTerm.toLowerCase())) ||
        req.requestNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
        req.serviceProviderName.toLowerCase().includes(searchTerm.toLowerCase());

      const matchType = selectedTypeFilter === 'all' || req.visaType === selectedTypeFilter;
      const matchStatus = selectedStatusFilter === 'all' || req.status === selectedStatusFilter;

      return matchSearch && matchType && matchStatus;
    });
  }, [visaRequests, searchTerm, selectedTypeFilter, selectedStatusFilter]);

  // Overall Financial Metrics
  const metrics = useMemo(() => {
    const totalCount = visaRequests.length;
    const totalCost = visaRequests.reduce((sum, r) => sum + Number(r.totalAmount || 0), 0);
    const totalPaid = visaRequests.reduce((sum, r) => sum + Number(r.paidAmount || 0), 0);
    const totalRemaining = visaRequests.reduce((sum, r) => sum + Number(r.remainingBalance || 0), 0);
    const pendingCount = visaRequests.filter(r => r.status === 'pending').length;

    return { totalCount, totalCost, totalPaid, totalRemaining, pendingCount };
  }, [visaRequests]);

  // Today's date string formatted for comparisons (YYYY-MM-DD)
  const todayStr = useMemo(() => {
    return new Date().toISOString().split('T')[0];
  }, []);

  // Strict Passport validation: 6 to 12 alphanumeric characters, uppercase standard
  const validatePassport = (val: string): boolean => {
    const clean = val.trim();
    const passportRegex = /^[A-Z0-9]{6,12}$/i;
    return passportRegex.test(clean);
  };

  // Handle File Upload with Strict validations (.pdf, .png, .jpeg, max 5MB)
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate size (max 5MB)
    const maxSize = 5 * 1024 * 1024;
    if (file.size > maxSize) {
      setFormErrors(prev => ({ ...prev, visaAttachment: 'حجم الملف يتجاوز الحد الأقصى المسموح (5 ميجابايت)' }));
      return;
    }

    // Validate type (.pdf, .png, .jpg, .jpeg)
    const allowedTypes = ['application/pdf', 'image/png', 'image/jpeg', 'image/jpg'];
    if (!allowedTypes.includes(file.type)) {
      setFormErrors(prev => ({ ...prev, visaAttachment: 'صيغة الملف غير مدعومة. يسمح فقط بـ PDF أو الصور (PNG, JPG)' }));
      return;
    }

    // Auto-compress phone images before saving
    if (file.type.startsWith('image/')) {
      compressImage(file)
        .then(compressed => {
          setVisaAttachmentUrl(compressed.dataUrl);
          setVisaAttachmentName(file.name);
          setVisaAttachmentSize(compressed.byteSize);
          setFormErrors(prev => {
            const copy = { ...prev };
            delete copy.visaAttachment;
            return copy;
          });
        })
        .catch(err => {
          console.warn('[Visa Upload] Image compression fallback to FileReader:', err);
          const reader = new FileReader();
          reader.onload = () => {
            setVisaAttachmentUrl(reader.result as string);
            setVisaAttachmentName(file.name);
            setVisaAttachmentSize(file.size);
            setFormErrors(prev => {
              const copy = { ...prev };
              delete copy.visaAttachment;
              return copy;
            });
          };
          reader.readAsDataURL(file);
        });
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setVisaAttachmentUrl(reader.result as string);
      setVisaAttachmentName(file.name);
      setVisaAttachmentSize(file.size);
      setFormErrors(prev => {
        const copy = { ...prev };
        delete copy.visaAttachment;
        return copy;
      });
    };
    reader.readAsDataURL(file);
  };

  // Reset Create Form
  const resetCreateForm = () => {
    setTravelerName('');
    setPassportNumber('');
    setDestinationCountry('');
    setHasTraveledBefore(false);
    setExpectedTravelDate('');
    setVisaType('tourist');
    setTotalAmount('');
    setInitialPayment('');
    setCurrency('EGP');
    setPaymentMode('full');
    setVisaAttachmentUrl('');
    setVisaAttachmentName('');
    setVisaAttachmentSize(0);
    setServiceProviderId('');
    setNotes('');
    setFormErrors({});
  };

  // Validate and Submit Create Form
  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errors: Record<string, string> = {};

    // 1. Traveler Name (إجباري)
    if (!travelerName.trim()) {
      errors.travelerName = 'يرجى إدخال اسم المسافر بالكامل (إجباري)';
    }

    // 2. Passport Number (رقم الباسبور - إجباري)
    if (!passportNumber.trim()) {
      errors.passportNumber = 'رقم جواز السفر مطلوب للمسافر (إجباري)';
    } else if (!validatePassport(passportNumber)) {
      errors.passportNumber = 'رقم جواز السفر غير صالح (يجب أن يتكون من 6-12 حرفاً ورقم بدون رموز)';
    }

    // 3. Destination Country (البلد / الوجهة - إجباري)
    if (!destinationCountry.trim()) {
      errors.destinationCountry = 'البلد (الوجهة) مطلوبة للمسافر (إجباري)';
    }

    // 4. Visa Type (نوع التأشيرة - إجباري)
    if (!visaType) {
      errors.visaType = 'نوع التأشيرة مطلوب (إجباري)';
    }

    // 5. Expected Travel Date (تاريخ السفر المتوقع - إجباري)
    if (!expectedTravelDate) {
      errors.expectedTravelDate = 'يرجى تحديد تاريخ السفر المتوقع (إجباري)';
    } else if (expectedTravelDate <= todayStr) {
      errors.expectedTravelDate = 'تاريخ السفر يجب أن يكون في المستقبل (بعد اليوم)';
    }

    // 6. Visa File Upload (صورة مستند التأشيرة أو الجواز - إجباري)
    if (!visaAttachmentUrl) {
      errors.visaAttachment = 'صورة مستند التأشيرة أو الجواز مطلوبة (إجباري)';
    }

    // 7. Service Provider (مورد التأشيرات المختص - إجباري)
    if (!serviceProviderId) {
      errors.serviceProviderId = 'يرجى اختيار مورد التأشيرات المختص (إجباري)';
    }

    // 8. Total Amount (تكلفة التأشيرة الإجمالية - إجباري)
    if (!totalAmount || Number(totalAmount) <= 0) {
      errors.totalAmount = 'تكلفة التأشيرة الإجمالية مطلوبة ويجب أن تكون أكبر من 0 (إجباري)';
    }

    // 9. Initial Payment (دفعة السداد - إجباري)
    if (!initialPayment || Number(initialPayment) <= 0) {
      errors.initialPayment = 'قيمة دفعة السداد مطلوبة ويجب أن تكون أكبر من 0 (إجباري)';
    } else if (totalAmount && Number(initialPayment) > Number(totalAmount)) {
      errors.initialPayment = 'قيمة دفعة السداد لا يمكن أن تتجاوز تكلفة التأشيرة الإجمالية';
    }

    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }

    setIsSubmitting(true);
    try {
      const selectedProviderObj = availableProviders.find(p => p.id === serviceProviderId);
      const targetOrgId = effectiveOrgId === 'all' ? (organizations[0]?.id || 'org-main') : (effectiveOrgId || 'org-main');

      await createVisaRequest({
        orgId: targetOrgId,
        requestDate: new Date().toISOString(),
        travelerName: travelerName.trim(),
        passportNumber: passportNumber.trim().toUpperCase(),
        destinationCountry: destinationCountry.trim(),
        hasTraveledBefore,
        expectedTravelDate,
        visaType,
        visaAttachmentUrl,
        visaAttachmentName,
        visaAttachmentSize,
        serviceProviderId,
        serviceProviderName: selectedProviderObj?.name || 'مورد تأشيرات معتمد',
        assignedApprover: 'محمود', // Explicitly assigned to Mahmoud
        totalAmount: Number(totalAmount),
        initialPayment: Number(initialPayment),
        currency,
        paymentMode,
        requesterId: currentUser.id,
        requesterName: currentUser.name,
        requesterEmail: currentUser.email,
        notes: notes.trim() || undefined,
      });

      setIsCreateModalOpen(false);
      resetCreateForm();
    } catch (err: any) {
      alert(`حدث خطأ أثناء حفظ الطلب: ${err?.message || 'تعذر الاتصال'}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Approval Handlers
  const handleApprove = async (visaId: string) => {
    try {
      await approveVisaRequest(visaId, 'محمود');
      if (selectedVisa && selectedVisa.id === visaId) {
        setSelectedVisa(prev => prev ? { ...prev, status: prev.paidAmount > 0 ? 'partially_paid' : 'approved', approvedByName: 'محمود', approvedAt: new Date().toISOString() } : null);
      }
    } catch (err: any) {
      alert(`فشل اعتماد الطلب: ${err?.message}`);
    }
  };

  const handleReject = async (visaId: string) => {
    if (!rejectionReason.trim()) {
      alert('يرجى ذكر سبب الرفض');
      return;
    }
    try {
      await rejectVisaRequest(visaId, rejectionReason.trim(), 'محمود');
      setIsRejecting(false);
      setRejectionReason('');
      if (selectedVisa && selectedVisa.id === visaId) {
        setSelectedVisa(prev => prev ? { ...prev, status: 'rejected', rejectionReason } : null);
      }
    } catch (err: any) {
      alert(`فشل رفض الطلب: ${err?.message}`);
    }
  };

  // Add Payment / Installment Handler
  const handleAddPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedVisa) return;
    setPaymentError('');

    const numericAmount = Number(paymentAmount);
    if (!numericAmount || numericAmount <= 0) {
      setPaymentError('مبلغ السداد يجب أن يكون أكبر من الصفر.');
      return;
    }

    if (numericAmount > selectedVisa.remainingBalance) {
      setPaymentError(`المبلغ المدخل (${numericAmount.toLocaleString()}) يتجاوز الرصيد المتبقي المطلوب سداده (${selectedVisa.remainingBalance.toLocaleString()} ${selectedVisa.currency}).`);
      return;
    }

    setIsProcessingPayment(true);
    try {
      const selectedAcc = availableAccounts.find(a => a.id === paymentAccountId);
      await addVisaPayment(selectedVisa.id, {
        amount: numericAmount,
        currency: selectedVisa.currency,
        date: paymentDate,
        paymentMethod,
        accountId: paymentAccountId || undefined,
        accountName: selectedAcc?.name || undefined,
        receiptReference: receiptReference.trim() || undefined,
        notes: paymentNotes.trim() || undefined,
      });

      // Update local modal view
      const newPaid = Number(selectedVisa.paidAmount || 0) + numericAmount;
      const newRemaining = selectedVisa.totalAmount - newPaid;
      setSelectedVisa(prev => prev ? {
        ...prev,
        paidAmount: newPaid,
        remainingBalance: newRemaining,
        status: newRemaining === 0 ? 'paid' : 'partially_paid',
        payments: [
          ...(prev.payments || []),
          {
            id: `vpay_${Date.now()}`,
            visaRequestId: prev.id,
            amount: numericAmount,
            currency: prev.currency,
            date: paymentDate,
            paymentMethod,
            accountName: selectedAcc?.name,
            receiptReference: receiptReference.trim() || undefined,
            recordedBy: currentUser.id,
            recordedByName: currentUser.name,
            recordedAt: new Date().toISOString(),
          }
        ]
      } : null);

      setIsAddingPayment(false);
      setPaymentAmount('');
      setReceiptReference('');
      setPaymentNotes('');
    } catch (err: any) {
      setPaymentError(err?.message || 'فشل تسجيل الدفعة');
    } finally {
      setIsProcessingPayment(false);
    }
  };

  return (
    <div className="space-y-6 text-right" dir="rtl">
      
      {/* Page Header */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-2xs flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="h-12 w-12 rounded-2xl bg-gradient-to-tr from-teal-600 to-emerald-500 text-white flex items-center justify-center shadow-md shadow-emerald-500/20">
            <Plane className="h-6 w-6 stroke-[2]" />
          </div>
          <div>
            <h1 className="text-lg sm:text-xl font-extrabold text-slate-900 tracking-tight">
              {currentRole === 'employee' ? 'طلبات وإصدار التأشيرات' : 'إدارة طلبات وإصدار التأشيرات ومصروفاتها'}
            </h1>
            <p className="text-xs text-slate-500 font-medium mt-0.5">
              {currentRole === 'employee' 
                ? 'تقديم طلبات استخراج التأشيرات، رفع وثائق السفر، ومتابعة حالة الاعتماد والدفعات' 
                : 'متابعة إصدار التأشيرات، الموردين المعتمدين، واعتماد الصرف وجدول الأقساط'}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => { resetCreateForm(); setIsCreateModalOpen(true); }}
          className="bg-[#0d9488] hover:bg-[#0f766e] text-white px-5 py-2.5 rounded-xl font-bold text-xs sm:text-sm flex items-center justify-center gap-2 shadow-xs transition cursor-pointer active:scale-98"
        >
          <Plus className="h-4 w-4 stroke-[2.5]" />
          <span>طلب تأشيرة جديد</span>
        </button>
      </div>

      {/* Metrics Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        
        {/* Metric 1: Total Visas */}
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-500 font-bold">إجمالي التأشيرات</span>
            <div className="h-8 w-8 rounded-xl bg-teal-50 text-teal-600 flex items-center justify-center">
              <FileCheck2 className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-black text-slate-900">{metrics.totalCount}</span>
            <span className="text-[11px] text-slate-400 font-semibold">طلب</span>
          </div>
          {metrics.pendingCount > 0 && (
            <span className="inline-block mt-1 text-[10px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-md">
              {metrics.pendingCount} بانتظار الاعتماد
            </span>
          )}
        </div>

        {/* Metric 2: Total Cost */}
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-500 font-bold">التكلفة الإجمالية</span>
            <div className="h-8 w-8 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center">
              <DollarSign className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-1">
            <span className="text-2xl font-black text-slate-900">{metrics.totalCost.toLocaleString()}</span>
            <span className="text-xs text-slate-400 font-semibold">EGP</span>
          </div>
          <span className="text-[10px] text-slate-400 mt-1 block">إجمالي قيمة التأشيرات المطلوبة</span>
        </div>

        {/* Metric 3: Total Paid */}
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-500 font-bold">المبالغ المسددة</span>
            <div className="h-8 w-8 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <CheckCircle2 className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-1">
            <span className="text-2xl font-black text-emerald-700">{metrics.totalPaid.toLocaleString()}</span>
            <span className="text-xs text-emerald-500 font-semibold">EGP</span>
          </div>
          <span className="text-[10px] text-emerald-600 mt-1 block font-medium">سداد مكتمل أو دفعات جزئية</span>
        </div>

        {/* Metric 4: Remaining Balance */}
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-500 font-bold">المتبقي المطلوب سداده</span>
            <div className="h-8 w-8 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center">
              <Clock className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-1">
            <span className="text-2xl font-black text-rose-700">{metrics.totalRemaining.toLocaleString()}</span>
            <span className="text-xs text-rose-500 font-semibold">EGP</span>
          </div>
          <span className="text-[10px] text-rose-600 mt-1 block font-medium">مستحقات معلقة على الطلبات المعتمدة</span>
        </div>

      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs flex flex-col md:flex-row items-center gap-3">
        <div className="relative flex-1 w-full">
          <Search className="absolute right-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="بحث باسم المسافر، رقم الجواز، رقم الطلب، أو المورد..."
            className="w-full pr-10 pl-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition"
          />
        </div>

        {/* Visa Type Filter */}
        <div className="flex items-center gap-2 w-full md:w-auto">
          <select
            value={selectedTypeFilter}
            onChange={(e) => setSelectedTypeFilter(e.target.value)}
            className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 focus:outline-none cursor-pointer"
          >
            <option value="all">جميع أنواع التأشيرات</option>
            <option value="tourist">سياحية</option>
            <option value="umrah_barcode">عمرة باركود</option>
            <option value="external_umrah">عمرة خارجي</option>
          </select>

          {/* Status Filter */}
          <select
            value={selectedStatusFilter}
            onChange={(e) => setSelectedStatusFilter(e.target.value)}
            className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 focus:outline-none cursor-pointer"
          >
            <option value="all">جميع الحالات</option>
            <option value="pending">قيد الاعتماد</option>
            <option value="approved">معتمد</option>
            <option value="partially_paid">مسدد جزئياً</option>
            <option value="paid">تم السداد بالكامل</option>
            <option value="rejected">مرفوض</option>
          </select>
        </div>
      </div>

      {/* Visa Requests Table / Cards */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
        {filteredVisaRequests.length === 0 ? (
          <div className="py-16 text-center text-slate-400">
            <Plane className="h-12 w-12 mx-auto text-slate-300 stroke-[1.2] mb-3" />
            <p className="text-sm font-bold text-slate-600">لا توجد طلبات تأشيرات مطابقة</p>
            <p className="text-xs text-slate-400 mt-1">ابدأ بإنشاء طلب تأشيرة جديد أو عدّل شروط التصفية</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead className="bg-slate-50/80 border-b border-slate-200 text-slate-500 font-bold">
                <tr>
                  <th className="py-3.5 px-4">رقم الطلب</th>
                  <th className="py-3.5 px-4">اسم المسافر</th>
                  <th className="py-3.5 px-4">رقم الجواز</th>
                  <th className="py-3.5 px-4">نوع التأشيرة</th>
                  <th className="py-3.5 px-4">المورد المختص</th>
                  <th className="py-3.5 px-4">تاريخ السفر</th>
                  <th className="py-3.5 px-4">التكلفة الإجمالية</th>
                  <th className="py-3.5 px-4">المسدد / المتبقي</th>
                  <th className="py-3.5 px-4">الحالة</th>
                  <th className="py-3.5 px-4 text-center">الإجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium">
                {filteredVisaRequests.map((req) => {
                  const statusConfig = VISA_STATUS_LABELS[req.status] || VISA_STATUS_LABELS.pending;
                  const progressPct = req.totalAmount > 0 ? Math.min(100, Math.round((req.paidAmount / req.totalAmount) * 100)) : 0;

                  return (
                    <tr 
                      key={req.id} 
                      className="hover:bg-slate-50/70 transition cursor-pointer"
                      onClick={() => setSelectedVisa(req)}
                    >
                      <td className="py-3 px-4 font-mono font-bold text-slate-800">
                        {req.requestNumber}
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-bold text-slate-900">{req.travelerName}</div>
                        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                          {req.destinationCountry && (
                            <span className="text-[10px] font-bold text-teal-700 bg-teal-50 px-1.5 py-0.5 rounded">
                              ✈️ {req.destinationCountry}
                            </span>
                          )}
                          {req.hasTraveledBefore && (
                            <span className="text-[10px] text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">سافر مسبقاً</span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4 font-mono uppercase text-slate-700 font-bold">
                        {req.passportNumber}
                      </td>
                      <td className="py-3 px-4 text-slate-700 font-semibold">
                        {VISA_TYPE_LABELS[req.visaType] || req.visaType}
                      </td>
                      <td className="py-3 px-4 text-slate-700">
                        <div className="truncate max-w-[140px]" title={req.serviceProviderName}>
                          {req.serviceProviderName}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-slate-600 font-mono">
                        {req.expectedTravelDate}
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-bold text-slate-900">
                          {req.totalAmount.toLocaleString()} {req.currency}
                        </div>
                        {req.initialPayment !== undefined && req.initialPayment > 0 && (
                          <div className="text-[10px] text-teal-700 font-semibold mt-0.5">
                            دفعة: {req.initialPayment.toLocaleString()} {req.currency}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-1.5">
                          <div className="w-16 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                            <div 
                              className={`h-full rounded-full ${req.status === 'paid' ? 'bg-emerald-500' : 'bg-teal-500'}`} 
                              style={{ width: `${progressPct}%` }}
                            />
                          </div>
                          <span className="text-[10px] text-slate-500 font-mono">{progressPct}%</span>
                        </div>
                        <div className="text-[10px] text-slate-400 mt-0.5 font-mono">
                          متبقي: {req.remainingBalance.toLocaleString()} {req.currency}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-lg text-[10px] font-bold border ${statusConfig.bg} ${statusConfig.color}`}>
                          {statusConfig.label}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-center" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          onClick={() => setSelectedVisa(req)}
                          className="px-2.5 py-1 text-xs font-bold text-teal-700 hover:text-teal-800 bg-teal-50 hover:bg-teal-100 rounded-lg transition cursor-pointer"
                        >
                          عرض ومعالجة
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ======================================================== */}
      {/* MODAL 1: CREATE NEW VISA REQUEST                         */}
      {/* ======================================================== */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto animate-in fade-in duration-150">
          <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-2xl overflow-hidden my-6">
            
            {/* Modal Header */}
            <div className="bg-slate-50/80 px-6 py-4 border-b border-slate-200/80 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-teal-50 text-teal-600 flex items-center justify-center">
                  <Plane className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="font-extrabold text-base text-slate-900">تسجيل طلب إصدار تأشيرة جديد</h3>
                  <p className="text-[11px] text-slate-500 font-medium mt-0.5">تاريخ الطلب: {todayStr} (نظامي)</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsCreateModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-xl hover:bg-slate-100 transition cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Modal Form */}
            <form onSubmit={handleCreateSubmit} className="p-6 space-y-6 max-h-[80vh] overflow-y-auto">
              
              {/* STEP 1: Traveler & Passenger Information */}
              <div className="bg-slate-50/70 p-4 rounded-2xl border border-slate-200/70 space-y-4">
                <div className="flex items-center gap-2 text-xs font-black text-slate-800 pb-2 border-b border-slate-200/60">
                  <span className="h-5 w-5 rounded-full bg-teal-600 text-white flex items-center justify-center text-[11px]">1</span>
                  <span>بيانات المسافر والجواز (Traveler & Passport Info)</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Traveler Name */}
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      اسم المسافر بالكامل <span className="text-rose-500 font-extrabold">* (إجباري)</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={travelerName}
                      onChange={(e) => {
                        setTravelerName(e.target.value);
                        if (formErrors.travelerName) setFormErrors(prev => ({ ...prev, travelerName: '' }));
                      }}
                      placeholder="مثال: أحمد محمد عبد الله"
                      className={`w-full px-3 py-2 bg-white border rounded-xl text-xs font-medium focus:outline-none focus:ring-2 focus:ring-teal-500/20 ${
                        formErrors.travelerName ? 'border-rose-400 bg-rose-50/20' : 'border-slate-200 focus:border-teal-500'
                      }`}
                    />
                    {formErrors.travelerName && (
                      <span className="text-[10px] text-rose-600 font-bold mt-1 block">{formErrors.travelerName}</span>
                    )}
                  </div>

                  {/* Passport Number */}
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      رقم جواز السفر <span className="text-rose-500 font-extrabold">* (إجباري)</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={passportNumber}
                      onChange={(e) => {
                        setPassportNumber(e.target.value.toUpperCase());
                        if (formErrors.passportNumber) setFormErrors(prev => ({ ...prev, passportNumber: '' }));
                      }}
                      placeholder="مثال: A12345678"
                      className={`w-full px-3 py-2 bg-white border rounded-xl text-xs font-mono uppercase focus:outline-none focus:ring-2 focus:ring-teal-500/20 ${
                        formErrors.passportNumber ? 'border-rose-400 bg-rose-50/20' : 'border-slate-200 focus:border-teal-500'
                      }`}
                    />
                    {formErrors.passportNumber && (
                      <span className="text-[10px] text-rose-600 font-bold mt-1 block">{formErrors.passportNumber}</span>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Destination Country / البلد (الوجهة) */}
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      البلد (الوجهة) <span className="text-rose-500 font-extrabold">* (إجباري)</span>
                    </label>
                    <input
                      type="text"
                      list="country-suggestions"
                      required
                      value={destinationCountry}
                      onChange={(e) => {
                        setDestinationCountry(e.target.value);
                        if (formErrors.destinationCountry) setFormErrors(prev => ({ ...prev, destinationCountry: '' }));
                      }}
                      placeholder="مثال: المملكة العربية السعودية، الإمارات، تركيا..."
                      className={`w-full px-3 py-2 bg-white border rounded-xl text-xs font-medium focus:outline-none focus:ring-2 focus:ring-teal-500/20 ${
                        formErrors.destinationCountry ? 'border-rose-400 bg-rose-50/20' : 'border-slate-200 focus:border-teal-500'
                      }`}
                    />
                    <datalist id="country-suggestions">
                      <option value="المملكة العربية السعودية" />
                      <option value="الإمارات العربية المتحدة" />
                      <option value="قطر" />
                      <option value="الكويت" />
                      <option value="سلطنة عمان" />
                      <option value="تركيا" />
                      <option value="الأردن" />
                      <option value="المملكة المتحدة (بريطانيا)" />
                      <option value="دول الاتحاد الأوروبي (شنغن)" />
                      <option value="الولايات المتحدة الأمريكية" />
                      <option value="الصين" />
                      <option value="روسيا" />
                      <option value="ماليزيا" />
                      <option value="تايلاند" />
                    </datalist>
                    {formErrors.destinationCountry && (
                      <span className="text-[10px] text-rose-600 font-bold mt-1 block">{formErrors.destinationCountry}</span>
                    )}
                  </div>

                  {/* Visa Type */}
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      نوع التأشيرة <span className="text-rose-500 font-extrabold">* (إجباري)</span>
                    </label>
                    <select
                      value={visaType}
                      onChange={(e) => setVisaType(e.target.value as VisaType)}
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-700 focus:outline-none focus:border-teal-500"
                    >
                      <option value="tourist">سياحية (Tourist)</option>
                      <option value="umrah_barcode">عمرة باركود (Umrah Barcode)</option>
                      <option value="external_umrah">عمرة خارجي (External Umrah)</option>
                      <option value="work">عمل / إقامة (Work / Residence)</option>
                      <option value="family_visit">زيارة عائلية / شخصية (Family Visit)</option>
                      <option value="transit">ترانزيت / مرور (Transit)</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Expected Travel Date */}
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      تاريخ السفر المتوقع <span className="text-rose-500 font-extrabold">* (إجباري)</span>
                    </label>
                    <input
                      type="date"
                      required
                      min={todayStr}
                      value={expectedTravelDate}
                      onChange={(e) => {
                        setExpectedTravelDate(e.target.value);
                        if (formErrors.expectedTravelDate) setFormErrors(prev => ({ ...prev, expectedTravelDate: '' }));
                      }}
                      className={`w-full px-3 py-2 bg-white border rounded-xl text-xs font-mono focus:outline-none focus:ring-2 focus:ring-teal-500/20 ${
                        formErrors.expectedTravelDate ? 'border-rose-400 bg-rose-50/20' : 'border-slate-200 focus:border-teal-500'
                      }`}
                    />
                    {formErrors.expectedTravelDate && (
                      <span className="text-[10px] text-rose-600 font-bold mt-1 block">{formErrors.expectedTravelDate}</span>
                    )}
                  </div>
                </div>

                {/* Has Traveled Before Toggle */}
                <div className="flex items-center justify-between p-2.5 bg-white rounded-xl border border-slate-200">
                  <div>
                    <span className="text-xs font-bold text-slate-800 block">هل سبق له السفر من قبل؟</span>
                    <span className="text-[10px] text-slate-400">تساعد في تسريع استخراج باركود العمرة والتأشيرات السياحية</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setHasTraveledBefore(!hasTraveledBefore)}
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                      hasTraveledBefore ? 'bg-teal-600' : 'bg-slate-200'
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                        hasTraveledBefore ? '-translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>

              </div>

              {/* STEP 2: Attachment & Service Provider Assignment */}
              <div className="bg-slate-50/70 p-4 rounded-2xl border border-slate-200/70 space-y-4">
                <div className="flex items-center gap-2 text-xs font-black text-slate-800 pb-2 border-b border-slate-200/60">
                  <span className="h-5 w-5 rounded-full bg-teal-600 text-white flex items-center justify-center text-[11px]">2</span>
                  <span>المرفقات وتعيين المورد (Visa Attachment & Provider)</span>
                </div>

                {/* Visa File Upload Dropzone */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    صورة مستند التأشيرة أو الجواز (PDF أو صورة) <span className="text-rose-500 font-extrabold">* (إجباري)</span>
                  </label>
                  
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.png,.jpg,.jpeg"
                    onChange={handleFileUpload}
                    className="hidden"
                  />

                  {!visaAttachmentUrl ? (
                    <div 
                      onClick={() => fileInputRef.current?.click()}
                      className={`border-2 border-dashed rounded-2xl p-4 text-center cursor-pointer transition hover:bg-teal-50/30 ${
                        formErrors.visaAttachment ? 'border-rose-300 bg-rose-50/20' : 'border-slate-300 hover:border-teal-500'
                      }`}
                    >
                      <UploadCloud className="h-7 w-7 text-slate-400 mx-auto mb-1.5" />
                      <span className="text-xs font-bold text-slate-700 block">انقر لرفع مستند التأشيرة أو الجواز</span>
                      <span className="text-[10px] text-slate-400">ملفات PDF أو صور (PNG, JPG) حتى 5 ميجابايت كحد أقصى (ضغط تلقائي للصور)</span>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between p-3 bg-white rounded-xl border border-teal-200">
                      <div className="flex items-center gap-2.5">
                        <div className="h-8 w-8 rounded-lg bg-teal-50 text-teal-600 flex items-center justify-center">
                          <Paperclip className="h-4 w-4" />
                        </div>
                        <div>
                          <span className="text-xs font-bold text-slate-900 block truncate max-w-[200px]">{visaAttachmentName}</span>
                          <span className="text-[10px] text-slate-400">{(visaAttachmentSize / 1024).toFixed(1)} KB • جاهز للمراجعة</span>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setVisaAttachmentUrl('');
                          setVisaAttachmentName('');
                          setVisaAttachmentSize(0);
                        }}
                        className="text-rose-500 hover:text-rose-700 p-1.5 rounded-lg hover:bg-rose-50 transition cursor-pointer"
                        title="حذف المرفق"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                  {formErrors.visaAttachment && (
                    <span className="text-[10px] text-rose-600 font-bold mt-1 block">{formErrors.visaAttachment}</span>
                  )}
                </div>

                {/* Service Provider Selection */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    شركة / مورد التأشيرات المختص <span className="text-rose-500 font-extrabold">* (إجباري)</span>
                  </label>
                  <select
                    disabled={!visaAttachmentUrl}
                    value={serviceProviderId}
                    onChange={(e) => {
                      setServiceProviderId(e.target.value);
                      if (formErrors.serviceProviderId) setFormErrors(prev => ({ ...prev, serviceProviderId: '' }));
                    }}
                    className={`w-full px-3 py-2 bg-white border rounded-xl text-xs font-bold focus:outline-none focus:ring-2 focus:ring-teal-500/20 ${
                      !visaAttachmentUrl ? 'opacity-60 bg-slate-100 cursor-not-allowed' : 'cursor-pointer'
                    } ${
                      formErrors.serviceProviderId ? 'border-rose-400 bg-rose-50/20' : 'border-slate-200 focus:border-teal-500'
                    }`}
                  >
                    <option value="">{visaAttachmentUrl ? '-- اختر مورد التأشيرات --' : '🔒 يرجى رفع مرفق التأشيرة أولاً لتفعيل اختيار المورد'}</option>
                    {availableProviders.map(prov => (
                      <option key={prov.id} value={prov.id}>
                        {prov.name} ({prov.serviceCategoryNames?.length ? prov.serviceCategoryNames.join(', ') : 'مورد معتمد'})
                      </option>
                    ))}
                  </select>
                  {formErrors.serviceProviderId && (
                    <span className="text-[10px] text-rose-600 font-bold mt-1 block">{formErrors.serviceProviderId}</span>
                  )}
                </div>

              </div>

              {/* STEP 3: Financial Details & Payment Mode */}
              <div className="bg-slate-50/70 p-4 rounded-2xl border border-slate-200/70 space-y-4">
                <div className="flex items-center gap-2 text-xs font-black text-slate-800 pb-2 border-b border-slate-200/60">
                  <span className="h-5 w-5 rounded-full bg-teal-600 text-white flex items-center justify-center text-[11px]">3</span>
                  <span>المصروفات وطريقة السداد (Financial & Payment Setup)</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Total Amount & Currency */}
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      تكلفة التأشيرة الإجمالية <span className="text-rose-500 font-extrabold">* (إجباري)</span>
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min="1"
                        step="any"
                        required
                        value={totalAmount}
                        onChange={(e) => {
                          const val = e.target.value === '' ? '' : Number(e.target.value);
                          setTotalAmount(val);
                          if (paymentMode === 'full') {
                            setInitialPayment(val);
                          }
                          if (formErrors.totalAmount) setFormErrors(prev => ({ ...prev, totalAmount: '' }));
                        }}
                        placeholder="0.00"
                        className={`flex-1 px-3 py-2 bg-white border rounded-xl text-xs font-bold focus:outline-none focus:ring-2 focus:ring-teal-500/20 ${
                          formErrors.totalAmount ? 'border-rose-400 bg-rose-50/20' : 'border-slate-200 focus:border-teal-500'
                        }`}
                      />
                      <select
                        value={currency}
                        onChange={(e) => setCurrency(e.target.value)}
                        className="px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-700 cursor-pointer"
                      >
                        {SUPPORTED_CURRENCIES.map(c => (
                          <option key={c.code} value={c.code}>{c.code}</option>
                        ))}
                      </select>
                    </div>
                    {formErrors.totalAmount && (
                      <span className="text-[10px] text-rose-600 font-bold mt-1 block">{formErrors.totalAmount}</span>
                    )}
                  </div>

                  {/* Payment Mode */}
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      نظام سداد المصروفات <span className="text-rose-500 font-extrabold">*</span>
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setPaymentMode('full');
                          if (totalAmount) setInitialPayment(totalAmount);
                        }}
                        className={`py-2 px-3 rounded-xl text-xs font-bold border transition cursor-pointer flex items-center justify-center gap-1.5 ${
                          paymentMode === 'full' 
                            ? 'bg-teal-50 border-teal-500 text-teal-800 shadow-2xs' 
                            : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-100'
                        }`}
                      >
                        <CreditCard className="h-3.5 w-3.5" />
                        <span>سداد كامل</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setPaymentMode('installments');
                          if (totalAmount && initialPayment === totalAmount) {
                            setInitialPayment(Math.round(Number(totalAmount) / 2));
                          }
                        }}
                        className={`py-2 px-3 rounded-xl text-xs font-bold border transition cursor-pointer flex items-center justify-center gap-1.5 ${
                          paymentMode === 'installments' 
                            ? 'bg-teal-50 border-teal-500 text-teal-800 shadow-2xs' 
                            : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-100'
                        }`}
                      >
                        <Wallet className="h-3.5 w-3.5" />
                        <span>أقساط / دفعات</span>
                      </button>
                    </div>
                  </div>
                </div>

                {/* Initial Payment / دفعة السداد (إجباري) */}
                <div className="bg-white p-3.5 rounded-xl border border-slate-200/80 space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="block text-xs font-bold text-slate-800">
                      قيمة دفعة السداد <span className="text-rose-500 font-extrabold">* (إجباري)</span>
                    </label>
                    <span className="text-[11px] text-slate-400 font-medium">
                      {paymentMode === 'full' ? 'سداد كامل المبلغ دفعة واحدة' : 'المبلغ المطلوب سداده كدفعة أولى'}
                    </span>
                  </div>
                  
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min="1"
                      max={totalAmount || undefined}
                      step="any"
                      required
                      value={initialPayment}
                      onChange={(e) => {
                        const val = e.target.value === '' ? '' : Number(e.target.value);
                        setInitialPayment(val);
                        if (val && totalAmount && Number(val) < Number(totalAmount)) {
                          setPaymentMode('installments');
                        } else if (val && totalAmount && Number(val) === Number(totalAmount)) {
                          setPaymentMode('full');
                        }
                        if (formErrors.initialPayment) setFormErrors(prev => ({ ...prev, initialPayment: '' }));
                      }}
                      placeholder="0.00"
                      className={`flex-1 px-3 py-2 bg-slate-50 border rounded-xl text-xs font-bold focus:outline-none focus:ring-2 focus:ring-teal-500/20 ${
                        formErrors.initialPayment ? 'border-rose-400 bg-rose-50/20' : 'border-slate-200 focus:border-teal-500'
                      }`}
                    />
                    <span className="px-3 py-2 bg-slate-100 border border-slate-200 rounded-xl text-xs font-bold text-slate-700">
                      {currency}
                    </span>
                  </div>
                  {formErrors.initialPayment && (
                    <span className="text-[10px] text-rose-600 font-bold mt-1 block">{formErrors.initialPayment}</span>
                  )}

                  {/* Financial calculation breakdown */}
                  {totalAmount && initialPayment !== '' && (
                    <div className="mt-2 pt-2 border-t border-slate-100 grid grid-cols-3 gap-2 text-center text-[11px]">
                      <div className="bg-slate-50 p-2 rounded-lg">
                        <span className="text-slate-400 block text-[10px]">التكلفة الإجمالية</span>
                        <strong className="text-slate-800">{Number(totalAmount).toLocaleString()} {currency}</strong>
                      </div>
                      <div className="bg-teal-50 p-2 rounded-lg">
                        <span className="text-teal-700 block text-[10px]">دفعة السداد</span>
                        <strong className="text-teal-900">{Number(initialPayment).toLocaleString()} {currency}</strong>
                      </div>
                      <div className="bg-amber-50 p-2 rounded-lg">
                        <span className="text-amber-700 block text-[10px]">المتبقي بعد الدفعة</span>
                        <strong className="text-amber-900">
                          {Math.max(0, Number(totalAmount) - Number(initialPayment)).toLocaleString()} {currency}
                        </strong>
                      </div>
                    </div>
                  )}
                </div>

                {/* Additional Notes */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    ملاحظات وتعليمات إضافية (اختياري)
                  </label>
                  <input
                    type="text"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="أي تفاصيل خاصة بتسليم الجواز أو الموعد..."
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-medium focus:outline-none focus:border-teal-500"
                  />
                </div>

                {/* Approver Notice */}
                <div className="p-3 bg-amber-50/60 rounded-xl border border-amber-200 text-amber-900 text-xs flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-amber-600 shrink-0" />
                  <span>
                    الطلب سيحال فور تسجيله للمسؤول <strong>محمود (Mahmoud)</strong> للاعتماد المالي والإداري قبل فتح إمكانية تسجيل وتفريغ المدفوعات.
                  </span>
                </div>

              </div>

              {/* Submit / Cancel Buttons */}
              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="bg-[#0d9488] hover:bg-[#0f766e] text-white px-6 py-2 rounded-xl font-bold text-xs shadow-xs transition cursor-pointer disabled:opacity-50 flex items-center gap-2"
                >
                  {isSubmitting ? (
                    <span>جاري تسجيل الطلب...</span>
                  ) : (
                    <>
                      <Check className="h-4 w-4 stroke-[2.5]" />
                      <span>حفظ وإرسال الطلب للاعتماد</span>
                    </>
                  )}
                </button>
              </div>

            </form>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* MODAL 2: VISA DETAIL, APPROVAL & PAYMENT LEDGER MODAL    */}
      {/* ======================================================== */}
      {selectedVisa && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto animate-in fade-in duration-150">
          <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-3xl overflow-hidden my-6">
            
            {/* Header */}
            <div className="bg-slate-50 px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-teal-100 text-teal-700 flex items-center justify-center">
                  <Plane className="h-5 w-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-extrabold text-base text-slate-900">{selectedVisa.travelerName}</span>
                    <span className="font-mono text-xs text-slate-500 font-bold bg-slate-200/80 px-2 py-0.5 rounded-md">
                      {selectedVisa.requestNumber}
                    </span>
                  </div>
                  <span className="text-xs text-slate-500 font-medium">
                    جواز: {selectedVisa.passportNumber} • {VISA_TYPE_LABELS[selectedVisa.visaType]}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedVisa(null)}
                  className="p-1.5 text-slate-400 hover:text-slate-600 rounded-xl hover:bg-slate-200/60 transition cursor-pointer"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            {/* Modal Content: 4-Card Multi-step layout */}
            <div className="p-6 space-y-5 max-h-[82vh] overflow-y-auto">
              
              {/* CARD 1: Basic Traveler Info */}
              <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs space-y-3">
                <div className="text-xs font-black text-slate-800 pb-2 border-b border-slate-100 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <UserIcon className="h-4 w-4 text-teal-600" />
                    <span>بيانات المسافر والرحلة (Traveler & Trip Info)</span>
                  </div>
                  <span className="text-[10px] text-slate-400 font-mono">
                    تاريخ الطلب: {selectedVisa.requestDate ? new Date(selectedVisa.requestDate).toLocaleDateString('ar-EG') : 'غير محدد'}
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs">
                  <div>
                    <span className="text-slate-400 text-[11px] block">اسم المسافر:</span>
                    <span className="font-bold text-slate-800">{selectedVisa.travelerName}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 text-[11px] block">رقم الجواز:</span>
                    <span className="font-mono font-bold text-slate-800">{selectedVisa.passportNumber}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 text-[11px] block">البلد (الوجهة):</span>
                    <span className="font-bold text-teal-800 bg-teal-50 px-2 py-0.5 rounded-md inline-block">
                      ✈️ {selectedVisa.destinationCountry || 'غير محدد'}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 text-[11px] block">تاريخ السفر:</span>
                    <span className="font-mono font-bold text-slate-800">{selectedVisa.expectedTravelDate}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 text-[11px] block">سافر مسبقاً؟</span>
                    <span className={`font-bold ${selectedVisa.hasTraveledBefore ? 'text-teal-600' : 'text-slate-600'}`}>
                      {selectedVisa.hasTraveledBefore ? 'نعم (سافر مسبقاً)' : 'لا (أول مرة)'}
                    </span>
                  </div>
                </div>
              </div>

              {/* CARD 2: Attachment & Provider */}
              <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs space-y-3">
                <div className="text-xs font-black text-slate-800 pb-2 border-b border-slate-100 flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-teal-600" />
                  <span>المرفق والمورد المعتمد (Attachment & Service Provider)</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* Provider Info */}
                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/70">
                    <span className="text-[10px] text-slate-400 font-bold block mb-1">المورد المسند إليه:</span>
                    <span className="text-xs font-bold text-slate-900 block">{selectedVisa.serviceProviderName}</span>
                  </div>

                  {/* Attachment Preview / Action */}
                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/70 flex items-center justify-between">
                    <div>
                      <span className="text-[10px] text-slate-400 font-bold block">مستند التأشيرة المرفق:</span>
                      <span className="text-xs font-bold text-slate-900 truncate max-w-[160px] block">
                        {selectedVisa.visaAttachmentName || 'مستند مرفق'}
                      </span>
                    </div>
                    {selectedVisa.visaAttachmentUrl && (
                      <a
                        href={selectedVisa.visaAttachmentUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="px-3 py-1.5 bg-teal-50 hover:bg-teal-100 text-teal-700 font-bold text-xs rounded-lg transition flex items-center gap-1 cursor-pointer"
                      >
                        <Eye className="h-3.5 w-3.5" />
                        <span>معاينة</span>
                      </a>
                    )}
                  </div>
                </div>
              </div>

              {/* CARD 3: Approval Status & Mahmoud's Approval Step */}
              <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs space-y-3">
                <div className="text-xs font-black text-slate-800 pb-2 border-b border-slate-100 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 text-teal-600" />
                    <span>حالة الاعتماد والموافقة الإدارية (Approval Workflow)</span>
                  </div>
                  <span className="text-[10px] text-slate-500 font-bold">
                    المعتمد المحدد: <strong>{selectedVisa.assignedApprover || 'محمود'}</strong>
                  </span>
                </div>

                {/* Status Banner */}
                {selectedVisa.status === 'pending' ? (
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Clock className="h-4 w-4 text-amber-600 shrink-0" />
                      <div>
                        <span className="text-xs font-bold text-amber-900 block">طلب التأشيرة قيد الاعتماد والمراجعة</span>
                        <span className="text-[10px] text-amber-700">بانتظار موافقة <strong>محمود</strong> لتفعيل تسجيل الصرف المالي والدفعات.</span>
                      </div>
                    </div>
                    
                    {/* Action buttons for Approver */}
                    {canApprove ? (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleApprove(selectedVisa.id)}
                          className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-lg shadow-2xs transition flex items-center gap-1 cursor-pointer"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          <span>اعتماد الطلب</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => setIsRejecting(!isRejecting)}
                          className="px-3.5 py-1.5 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs rounded-lg shadow-2xs transition flex items-center gap-1 cursor-pointer"
                        >
                          <XCircle className="h-3.5 w-3.5" />
                          <span>رفض</span>
                        </button>
                      </div>
                    ) : (
                      <span className="text-xs font-bold text-amber-800 bg-amber-100/80 px-2.5 py-1 rounded-lg">
                        قيد انتظار الموافقة ⏳
                      </span>
                    )}
                  </div>
                ) : selectedVisa.status === 'rejected' ? (
                  <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl space-y-1">
                    <div className="flex items-center gap-2 text-rose-800 font-bold text-xs">
                      <XCircle className="h-4 w-4 text-rose-600" />
                      <span>تم رفض هذا الطلب بواسطة {selectedVisa.approvedByName || 'محمود'}</span>
                    </div>
                    {selectedVisa.rejectionReason && (
                      <p className="text-[11px] text-rose-700 pr-6">سبب الرفض: {selectedVisa.rejectionReason}</p>
                    )}
                  </div>
                ) : (
                  <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center justify-between">
                    <div className="flex items-center gap-2 text-emerald-800 font-bold text-xs">
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                      <div>
                        <span>معتمد ومصرح للصرف بواسطة {selectedVisa.approvedByName || 'محمود'}</span>
                        <span className="text-[10px] text-emerald-600 font-normal block font-mono">
                          تاريخ الاعتماد: {selectedVisa.approvedAt ? new Date(selectedVisa.approvedAt).toLocaleString('ar-EG') : 'تم الاعتماد'}
                        </span>
                      </div>
                    </div>
                    <span className="text-xs font-black text-emerald-700 bg-emerald-100/60 px-2.5 py-1 rounded-lg">
                      معتمد ✅
                    </span>
                  </div>
                )}

                {/* Sub-form: Rejection form */}
                {isRejecting && (
                  <div className="p-3 bg-rose-50/50 border border-rose-200 rounded-xl space-y-2 mt-2">
                    <label className="block text-xs font-bold text-rose-900">اذكر سبب رفض التأشيرة:</label>
                    <input
                      type="text"
                      value={rejectionReason}
                      onChange={(e) => setRejectionReason(e.target.value)}
                      placeholder="مثال: المستند غير واضح، أو الجواز منتهي الصلاحية..."
                      className="w-full px-3 py-2 bg-white border border-rose-300 rounded-lg text-xs"
                    />
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setIsRejecting(false)}
                        className="px-3 py-1 text-xs text-slate-600 hover:bg-slate-100 rounded-lg"
                      >
                        إلغاء
                      </button>
                      <button
                        type="button"
                        onClick={() => handleReject(selectedVisa.id)}
                        className="px-4 py-1 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs rounded-lg"
                      >
                        تأكيد الرفض
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* CARD 4: Financial & Installment Payment Management */}
              <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs space-y-4">
                <div className="text-xs font-black text-slate-800 pb-2 border-b border-slate-100 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CreditCard className="h-4 w-4 text-teal-600" />
                    <span>إدارة المدفوعات وسجل الأقساط (Expense & Payment Ledger)</span>
                  </div>
                  <span className="text-xs font-bold text-slate-700">
                    نظام السداد: {selectedVisa.paymentMode === 'full' ? 'دفعة كاملة' : 'دفعات متعددة / أقساط'}
                  </span>
                </div>

                {/* Progress Card */}
                <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 space-y-2">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                    <div>
                      <span className="text-slate-400 block text-[10px]">إجمالي التكلفة:</span>
                      <span className="font-bold text-slate-900 text-sm">{selectedVisa.totalAmount.toLocaleString()} {selectedVisa.currency}</span>
                    </div>
                    <div>
                      <span className="text-teal-700 block text-[10px]">دفعة السداد المحددة:</span>
                      <span className="font-bold text-teal-800 text-sm">
                        {(selectedVisa.initialPayment !== undefined ? selectedVisa.initialPayment : selectedVisa.totalAmount).toLocaleString()} {selectedVisa.currency}
                      </span>
                    </div>
                    <div>
                      <span className="text-emerald-600 block text-[10px]">المسدد حتى الآن:</span>
                      <span className="font-bold text-emerald-700 text-sm">{selectedVisa.paidAmount.toLocaleString()} {selectedVisa.currency}</span>
                    </div>
                    <div>
                      <span className="text-rose-600 block text-[10px]">الرصيد المتبقي:</span>
                      <span className="font-bold text-rose-700 text-sm">{selectedVisa.remainingBalance.toLocaleString()} {selectedVisa.currency}</span>
                    </div>
                  </div>

                  {/* Progress Bar */}
                  <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
                    <div 
                      className={`h-full transition-all duration-300 ${
                        selectedVisa.remainingBalance === 0 ? 'bg-emerald-500' : 'bg-teal-500'
                      }`} 
                      style={{ 
                        width: `${selectedVisa.totalAmount > 0 ? Math.min(100, Math.round((selectedVisa.paidAmount / selectedVisa.totalAmount) * 100)) : 0}%` 
                      }}
                    />
                  </div>
                </div>

                {/* Lock Alert if NOT Approved */}
                {selectedVisa.status === 'pending' || selectedVisa.status === 'rejected' ? (
                  <div className="p-4 bg-slate-50 border border-dashed border-slate-300 rounded-xl text-center text-slate-500 space-y-1">
                    <Lock className="h-6 w-6 mx-auto text-slate-400 mb-1" />
                    <span className="text-xs font-bold text-slate-700 block">قسم المدفوعات مقفل</span>
                    <span className="text-[11px] text-slate-400 block">
                      {selectedVisa.status === 'rejected' 
                        ? 'الطلب مرفوض، لا يمكن تسجيل أي مدفوعات مالية.' 
                        : 'يتطلب اعتماد الإدارة أولاً لتفعيل تسجيل الصرف المالي والدفعات.'}
                    </span>
                  </div>
                ) : (
                  /* Payments Section (Unlocked) */
                  <div className="space-y-3">
                    
                    {/* Header with Add Payment Button */}
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-800">
                        سجل الدفعات المسددة ({selectedVisa.payments?.length || 0})
                      </span>

                      {canManagePayments && selectedVisa.remainingBalance > 0 && !isAddingPayment && (
                        <button
                          type="button"
                          onClick={() => {
                            const defaultPay = selectedVisa.initialPayment && selectedVisa.paidAmount === 0
                              ? Math.min(selectedVisa.initialPayment, selectedVisa.remainingBalance)
                              : selectedVisa.remainingBalance;
                            setPaymentAmount(defaultPay);
                            setPaymentError('');
                            setIsAddingPayment(true);
                          }}
                          className="px-3 py-1.5 bg-[#0d9488] hover:bg-[#0f766e] text-white font-bold text-xs rounded-xl shadow-xs transition flex items-center gap-1.5 cursor-pointer"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          <span>تسجيل دفعة / قسط مالي</span>
                        </button>
                      )}
                    </div>

                    {/* Add Payment Form */}
                    {isAddingPayment && (
                      <form onSubmit={handleAddPayment} className="p-4 bg-teal-50/50 border border-teal-200 rounded-2xl space-y-3 animate-in fade-in">
                        <div className="flex items-center justify-between pb-1 border-b border-teal-200/60">
                          <span className="text-xs font-bold text-teal-950">تسجيل سداد دفعة جديدة</span>
                          <span className="text-[11px] text-teal-700 font-mono">
                            المتبقي الأقصى: {selectedVisa.remainingBalance.toLocaleString()} {selectedVisa.currency}
                          </span>
                        </div>

                        {paymentError && (
                          <div className="p-2 bg-rose-50 border border-rose-200 rounded-lg text-rose-700 text-xs font-bold">
                            {paymentError}
                          </div>
                        )}

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                          <div>
                            <label className="block text-[11px] font-bold text-slate-700 mb-1">المبلغ المراد صرفه/سداده:</label>
                            <input
                              type="number"
                              min="1"
                              max={selectedVisa.remainingBalance}
                              step="any"
                              required
                              value={paymentAmount}
                              onChange={(e) => setPaymentAmount(e.target.value === '' ? '' : Number(e.target.value))}
                              className="w-full px-3 py-1.5 bg-white border border-teal-300 rounded-xl text-xs font-bold"
                            />
                          </div>

                          <div>
                            <label className="block text-[11px] font-bold text-slate-700 mb-1">تاريخ السداد:</label>
                            <input
                              type="date"
                              required
                              value={paymentDate}
                              onChange={(e) => setPaymentDate(e.target.value)}
                              className="w-full px-3 py-1.5 bg-white border border-teal-300 rounded-xl text-xs font-mono"
                            />
                          </div>

                          <div>
                            <label className="block text-[11px] font-bold text-slate-700 mb-1">طريقة التحويل / السداد:</label>
                            <select
                              value={paymentMethod}
                              onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                              className="w-full px-3 py-1.5 bg-white border border-teal-300 rounded-xl text-xs font-bold"
                            >
                              <option value="bank_transfer">تحويل بنكي (Bank Transfer)</option>
                              <option value="instapay">إنستاباي (InstaPay)</option>
                              <option value="digital_wallet">محفظة إلكترونية (Wallet)</option>
                              <option value="cash">نقداً (Cash)</option>
                            </select>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <label className="block text-[11px] font-bold text-slate-700 mb-1">خصم من خزينة / حساب الشركة (اختياري):</label>
                            <select
                              value={paymentAccountId}
                              onChange={(e) => setPaymentAccountId(e.target.value)}
                              className="w-full px-3 py-1.5 bg-white border border-teal-300 rounded-xl text-xs font-bold"
                            >
                              <option value="">-- بدون خصم آلي من الخزينة --</option>
                              {availableAccounts.map(acc => (
                                <option key={acc.id} value={acc.id}>
                                  {acc.name} (رصيد: {Number(acc.currentBalance ?? acc.balance ?? 0).toLocaleString()} {acc.currency || 'EGP'})
                                </option>
                              ))}
                            </select>
                          </div>

                          <div>
                            <label className="block text-[11px] font-bold text-slate-700 mb-1">رقم الإيصال / المرجع البنكي:</label>
                            <input
                              type="text"
                              value={receiptReference}
                              onChange={(e) => setReceiptReference(e.target.value)}
                              placeholder="مثال: TXN-8948194"
                              className="w-full px-3 py-1.5 bg-white border border-teal-300 rounded-xl text-xs font-mono"
                            />
                          </div>
                        </div>

                        <div className="flex items-center justify-end gap-2 pt-1">
                          <button
                            type="button"
                            onClick={() => setIsAddingPayment(false)}
                            className="px-3 py-1 text-xs text-slate-600 hover:bg-slate-200/50 rounded-lg"
                          >
                            إلغاء
                          </button>
                          <button
                            type="submit"
                            disabled={isProcessingPayment}
                            className="px-4 py-1.5 bg-teal-700 hover:bg-teal-800 text-white font-bold text-xs rounded-xl shadow-xs transition"
                          >
                            {isProcessingPayment ? 'جاري التسجيل...' : 'تأكيد وحفظ الدفعة'}
                          </button>
                        </div>
                      </form>
                    )}

                    {/* Payments List Table */}
                    {(!selectedVisa.payments || selectedVisa.payments.length === 0) ? (
                      <div className="py-6 text-center text-slate-400 text-xs">
                        لم يتم تسجيل أي دفعات مالية بعد لهذا الطلب
                      </div>
                    ) : (
                      <div className="overflow-x-auto border border-slate-100 rounded-xl">
                        <table className="w-full text-right text-xs">
                          <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-100">
                            <tr>
                              <th className="py-2 px-3">المبلغ</th>
                              <th className="py-2 px-3">تاريخ الدفعة</th>
                              <th className="py-2 px-3">طريقة الدفع</th>
                              <th className="py-2 px-3">الخزينة المخصومة</th>
                              <th className="py-2 px-3">رقم المرجع / الإيصال</th>
                              <th className="py-2 px-3">المسؤول</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {selectedVisa.payments.map((p, idx) => (
                              <tr key={p.id || idx} className="hover:bg-slate-50/50 font-medium">
                                <td className="py-2.5 px-3 font-bold text-emerald-700 font-mono">
                                  {p.amount.toLocaleString()} {p.currency}
                                </td>
                                <td className="py-2.5 px-3 font-mono text-slate-600">
                                  {p.date}
                                </td>
                                <td className="py-2.5 px-3 text-slate-700">
                                  {p.paymentMethod === 'bank_transfer' ? 'تحويل بنكي' :
                                   p.paymentMethod === 'instapay' ? 'إنستاباي' :
                                   p.paymentMethod === 'digital_wallet' ? 'محفظة إلكترونية' : 'نقداً'}
                                </td>
                                <td className="py-2.5 px-3 text-slate-600">
                                  {p.accountName || '—'}
                                </td>
                                <td className="py-2.5 px-3 font-mono text-slate-500">
                                  {p.receiptReference || '—'}
                                </td>
                                <td className="py-2.5 px-3 text-slate-500 text-[11px]">
                                  {p.recordedByName || 'المسؤول المالي'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                  </div>
                )}
              </div>

            </div>

            {/* Modal Footer */}
            <div className="bg-slate-50 px-6 py-3 border-t border-slate-200 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setSelectedVisa(null)}
                className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold text-xs rounded-xl transition cursor-pointer"
              >
                إغلاق النافذة
              </button>

              {/* Delete button (Super admin or requester while pending) */}
              {(currentRole === 'super_admin' || (selectedVisa.requesterId === currentUser.id && selectedVisa.status === 'pending')) && (
                <button
                  type="button"
                  onClick={async () => {
                    if (confirm(`هل أنت متأكد من حذف طلب تأشيرة المسافر "${selectedVisa.travelerName}"؟`)) {
                      await deleteVisaRequest(selectedVisa.id);
                      setSelectedVisa(null);
                    }
                  }}
                  className="text-rose-600 hover:text-rose-700 text-xs font-bold px-3 py-1.5 rounded-lg hover:bg-rose-50 transition cursor-pointer flex items-center gap-1.5"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>حذف الطلب</span>
                </button>
              )}
            </div>

          </div>
        </div>
      )}

    </div>
  );
};
