import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { PaymentMethod } from '../types';
import { canOpenTab } from '../utils/permissions';
import { copyTextToClipboard } from '../utils/requestUi';
import { useSubmitGuard } from '../hooks/useSubmitGuard';
import { EmailVerificationCard } from './EmailVerificationCard';
import {
  ibanError,
  walletNumberError,
  sanitizeDigitsOnly,
  sanitizeIBAN,
  sanitizeInstaPay,
  sanitizePhone,
  handleNumericKeyDown,
} from '../utils/validation';
import { 
  User as UserIcon, 
  Mail, 
  Building2, 
  ShieldCheck, 
  CreditCard, 
  Smartphone, 
  Lock, 
  Check, 
  Copy, 
  Save, 
  AlertCircle, 
  Sparkles,
  ArrowRight,
  Building
} from 'lucide-react';

// An InstaPay payment address (name@instapay) or the Egyptian mobile number registered on it.
const INSTAPAY_RE = /^[a-z0-9._-]{2,}@instapay$/i;
const EG_MOBILE_RE = /^01[0125]\d{8}$/;

/** The four choices of this page; 'digital_wallet' (same method, newer name) shows as the wallet choice. */
const profileMethod = (method?: PaymentMethod | null): PaymentMethod =>
  method === 'digital_wallet' ? 'wallet' : method === 'cheque' || !method ? 'instapay' : method;

export const ProfileManagement: React.FC = () => {
  const { 
    currentUser, 
    firebaseUser, 
    currentRole, 
    activeOrg,
    updateUserProfileInfo, 
    changeCurrentUserPassword,
    setActiveTab
  } = useApp();

  // Basic Info Form State
  const [name, setName] = useState(currentUser.name || '');
  const [phone, setPhone] = useState(currentUser.phone || '');

  // Payout Details Form State
  const [preferredMethod, setPreferredMethod] = useState<PaymentMethod>(
    profileMethod(currentUser.preferredPaymentMethod)
  );
  const [instapay, setInstapay] = useState(currentUser.instapay || '');
  const [wallet, setWallet] = useState(currentUser.wallet || '');
  const [walletProvider, setWalletProvider] = useState(currentUser.walletProvider || 'فودافون كاش');
  const [bankName, setBankName] = useState(currentUser.bankName || '');
  const [iban, setIban] = useState(currentUser.iban || '');

  // Password Form State
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // UI States
  const saveGuard = useSubmitGuard();
  const isSavingProfile = saveGuard.pending;
  const [isChangingPass, setIsChangingPass] = useState(false);
  const [profileFeedback, setProfileFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [passFeedback, setPassFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [copyState, setCopyState] = useState<{ key: string; ok: boolean } | null>(null);

  // Reload the form when the SAVED profile changes (after a save, or an update from another
  // device) - adjusted during render, and never because of an unrelated re-render while typing.
  const savedProfileKey = JSON.stringify([
    currentUser.id, currentUser.name, currentUser.phone, currentUser.preferredPaymentMethod, currentUser.instapay,
    currentUser.wallet, currentUser.walletProvider, currentUser.bankName, currentUser.iban,
  ]);
  const [syncedProfileKey, setSyncedProfileKey] = useState(savedProfileKey);
  if (savedProfileKey !== syncedProfileKey) {
    setSyncedProfileKey(savedProfileKey);
    setName(currentUser.name || '');
    setPhone(currentUser.phone || '');
    if (currentUser.preferredPaymentMethod) {
      setPreferredMethod(profileMethod(currentUser.preferredPaymentMethod));
    }
    setInstapay(currentUser.instapay || '');
    setWallet(currentUser.wallet || '');
    setWalletProvider(currentUser.walletProvider || 'فودافون كاش');
    setBankName(currentUser.bankName || '');
    setIban(currentUser.iban || '');
  }

  // Never shows "copied" when the browser refused the clipboard write.
  const handleCopy = async (text: string, key: string) => {
    if (!text) return;
    const ok = await copyTextToClipboard(text);
    setCopyState({ key, ok });
    setTimeout(() => setCopyState(null), 2500);
  };

  /** Arabic error for the first invalid payout / contact field, or null. Empty fields are allowed. */
  const validateProfile = (): string | null => {
    if (!name.trim()) return 'يرجى إدخال اسمك بالكامل.';
    const ipa = instapay.trim();
    if (ipa && !INSTAPAY_RE.test(ipa) && !EG_MOBILE_RE.test(ipa)) {
      return '⚠️ عنوان إنستاباي غير صحيح: اكتب العنوان بالشكل name@instapay أو رقم الهاتف المسجل بإنستاباي (11 رقماً يبدأ بـ 01).';
    }
    if (wallet.trim()) {
      const walletError = walletNumberError(wallet);
      if (walletError) return walletError;
      if (wallet.trim().length !== 11) return '⚠️ رقم المحفظة غير صحيح: يجب أن يتكون من 11 رقماً (مثال: 01012345678).';
    }
    if (iban.trim()) {
      const bankError = ibanError(iban);
      if (bankError) return bankError;
    }
    const phoneDigits = phone.replace(/\D/g, '');
    if (phone.trim() && (phoneDigits.length < 8 || phoneDigits.length > 15)) {
      return '⚠️ رقم الهاتف غير صحيح: اكتب رقم الهاتف كاملاً بالأرقام فقط.';
    }
    return null;
  };

  const handleSaveProfile = (e: React.FormEvent) => {
    e.preventDefault();
    const invalid = validateProfile();
    if (invalid) {
      setProfileFeedback({ type: 'error', message: invalid });
      return;
    }

    void saveGuard.run(async () => {
      setProfileFeedback(null);
      try {
        const res = await updateUserProfileInfo({
          name: name.trim(),
          phone: phone.trim(),
          instapay: instapay.trim(),
          wallet: wallet.trim(),
          walletProvider: walletProvider.trim(),
          bankName: bankName.trim(),
          iban: sanitizeIBAN(iban),
          preferredPaymentMethod: preferredMethod,
        });

        if (res.success) {
          setProfileFeedback({
            type: 'success',
            message: 'تم حفظ وتحديث بيانات الملف الشخصي والاستحقاق المالي بنجاح! سيتم استخدامها تلقائياً عند تقديم أي طلب صرف.'
          });
          setTimeout(() => setProfileFeedback(null), 6000);
        } else {
          setProfileFeedback({
            type: 'error',
            message: res.error || 'تعذر حفظ البيانات. يرجى المحاولة مرة أخرى.'
          });
        }
      } catch {
        setProfileFeedback({ type: 'error', message: 'تعذر حفظ البيانات. تحقق من الاتصال ثم أعد المحاولة.' });
      }
    });
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentPassword) {
      setPassFeedback({ type: 'error', message: 'يرجى إدخال كلمة المرور الحالية.' });
      return;
    }
    if (newPassword.length < 6) {
      setPassFeedback({ type: 'error', message: 'يجب أن تتكون كلمة المرور الجديدة من 6 خانات على الأقل.' });
      return;
    }
    if (newPassword !== confirmPassword) {
      setPassFeedback({ type: 'error', message: 'كلمة المرور الجديدة وتأكيدها غير متطابقين.' });
      return;
    }

    setIsChangingPass(true);
    setPassFeedback(null);

    let res: { success: boolean; error?: string };
    try {
      res = await changeCurrentUserPassword(currentPassword, newPassword);
    } catch {
      res = { success: false };
    } finally {
      setIsChangingPass(false);
    }

    if (res.success) {
      setPassFeedback({ type: 'success', message: 'تم تغيير كلمة المرور بنجاح! احتفظ بها في مكان آمن.' });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setTimeout(() => setPassFeedback(null), 6000);
    } else {
      setPassFeedback({ type: 'error', message: res.error || 'تعذر تغيير كلمة المرور.' });
    }
  };

  const isGoogleUser = firebaseUser?.providerData?.some(p => p.providerId === 'google.com');

  const getRoleBadge = (role: string) => {
    switch (role) {
      case 'super_admin':
        return <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-900 border border-amber-300">👑 مدير منصة عام (Super Admin)</span>;
      case 'org_admin':
        return <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-indigo-100 text-indigo-900 border border-indigo-300">🏢 مدير شركة (Company Admin)</span>;
      case 'finance':
        return <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-900 border border-emerald-300">💼 إدارة مالية وخزينة (Finance)</span>;
      case 'data_entry':
        return <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-sky-100 text-sky-900 border border-sky-300">✍️ مدخل بيانات ومساعد</span>;
      default:
        return <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-800 border border-slate-300">👤 موظف (Employee)</span>;
    }
  };

  // Get active payout string for the card display
  const getActivePayoutDisplay = () => {
    switch (preferredMethod) {
      case 'instapay':
        return {
          title: 'إنستاباي (InstaPay IPA)',
          val: instapay || 'لم يتم تسجيل عنوان إنستاباي بعد',
          copyable: Boolean(instapay.trim()),
          icon: <Smartphone className="h-5 w-5 text-purple-400" />,
          color: 'from-purple-900 to-indigo-950',
          badge: 'IPA / لحظي'
        };
      case 'wallet':
        return {
          title: `محفظة إلكترونية (${walletProvider})`,
          val: wallet || 'لم يتم تسجيل رقم المحفظة بعد',
          copyable: Boolean(wallet.trim()),
          icon: <Smartphone className="h-5 w-5 text-amber-400" />,
          color: 'from-amber-900 to-stone-900',
          badge: 'كاش موبايل'
        };
      case 'bank_transfer':
        return {
          title: `تحويل مصرفي (${bankName || 'بنك'})`,
          val: iban || 'لم يتم تسجيل رقم الآيبان بعد',
          copyable: Boolean(iban.trim()),
          icon: <Building className="h-5 w-5 text-emerald-400" />,
          color: 'from-emerald-900 to-slate-900',
          badge: 'IBAN بنكي'
        };
      default:
        return {
          title: 'صرف نقدي من الخزينة',
          val: 'استلام نقدية من أمين الخزينة مباشرة',
          copyable: false,
          icon: <CreditCard className="h-5 w-5 text-slate-400" />,
          color: 'from-slate-800 to-slate-950',
          badge: 'كاش يدوي'
        };
    }
  };

  const payoutDisplay = getActivePayoutDisplay();

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-16 animate-fadeIn text-right" dir="rtl">
      {/* Top Header */}
      <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="h-16 w-16 rounded-2xl bg-gradient-to-tr from-emerald-600 to-teal-500 text-white flex items-center justify-center font-bold text-2xl shadow-md border-2 border-white ring-4 ring-emerald-50">
            {currentUser.name ? currentUser.name.slice(0, 2).toUpperCase() : 'ME'}
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-bold text-slate-900">{currentUser.name || 'الملف الشخصي'}</h1>
              {getRoleBadge(currentRole)}
            </div>
            <p className="text-xs text-slate-500 mt-1 flex items-center gap-2">
              <Mail className="h-3.5 w-3.5 text-slate-400" />
              <span>{currentUser.email || firebaseUser?.email}</span>
              {activeOrg && (
                <>
                  <span className="text-slate-300">•</span>
                  <Building2 className="h-3.5 w-3.5 text-slate-400" />
                  <span>{activeOrg.name}</span>
                </>
              )}
            </p>
            <EmailVerificationCard className="mt-2" />
          </div>
        </div>

        <div className="flex items-center gap-2 self-start md:self-center">
          <button
            type="button"
            onClick={() => setActiveTab(canOpenTab(currentRole, 'requests') ? 'requests' : 'my-requests')}
            className="flex items-center gap-1.5 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition cursor-pointer"
          >
            <ArrowRight className="h-4 w-4" />
            <span>العودة للطلبات</span>
          </button>
        </div>
      </div>

      {/* Hero Financial Payout Card Preview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-1">
          <div className="sticky top-6 space-y-4">
            <div className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
              <Sparkles className="h-4 w-4 text-emerald-600" />
              <span>معاينة بطاقة الاستحقاق المالي (Auto-Fill)</span>
            </div>

            {/* Smart Digital Card */}
            <div className={`rounded-2xl p-5 text-white shadow-xl bg-gradient-to-br ${payoutDisplay.color} border border-white/20 relative overflow-hidden flex flex-col justify-between min-h-[210px]`}>
              {/* Background watermark shapes */}
              <div className="absolute -top-12 -left-12 w-32 h-32 bg-white/10 rounded-full blur-xl pointer-events-none"></div>
              <div className="absolute -bottom-8 -right-8 w-28 h-28 bg-emerald-500/20 rounded-full blur-xl pointer-events-none"></div>

              <div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {payoutDisplay.icon}
                    <span className="text-xs font-semibold text-white/90">{payoutDisplay.title}</span>
                  </div>
                  <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-white/20 text-white backdrop-blur-md">
                    {payoutDisplay.badge}
                  </span>
                </div>
              </div>

              <div className="my-4">
                <div className="text-[10px] text-white/70 mb-1">بيانات الاستلام المالي المسجلة:</div>
                <div className="text-sm font-mono font-bold tracking-wide break-all text-white bg-black/25 p-2 rounded-xl border border-white/10 flex items-center justify-between gap-2">
                  <span className="truncate">{payoutDisplay.val}</span>
                  {payoutDisplay.copyable && (
                    <button
                      type="button"
                      onClick={() => { void handleCopy(payoutDisplay.val, 'card-val'); }}
                      className="p-1 hover:bg-white/20 rounded-md transition text-white/80 hover:text-white shrink-0 cursor-pointer"
                      title="نسخ الحساب"
                      aria-label="نسخ الحساب"
                    >
                      {copyState?.key === 'card-val' && copyState.ok ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                    </button>
                  )}
                </div>
                {copyState?.key === 'card-val' && (
                  <div role="status" className={`text-[10px] font-bold mt-1 ${copyState.ok ? 'text-emerald-300' : 'text-rose-200'}`}>
                    {copyState.ok ? 'تم نسخ الحساب' : 'تعذر النسخ تلقائياً — حدد الرقم وانسخه يدوياً'}
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between text-xs text-white/80 pt-2 border-t border-white/15">
                <div>
                  <div className="text-[9px] text-white/60">اسم المستفيد</div>
                  <div className="font-bold text-white text-xs truncate max-w-[140px]">{name || currentUser.name}</div>
                </div>
                <div className="text-left" dir="ltr">
                  <div className="text-[9px] text-white/60">COMPANY</div>
                  <div className="font-semibold text-[11px] text-white/90 truncate max-w-[100px]">{activeOrg?.name || '—'}</div>
                </div>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-emerald-50/80 border border-emerald-200/80 text-[11px] text-emerald-900 leading-relaxed space-y-1">
              <div className="font-bold flex items-center gap-1.5 text-emerald-800">
                <ShieldCheck className="h-4 w-4 text-emerald-600 shrink-0" />
                <span>ميزة الملء التلقائي (Auto-Fill) مفعلة</span>
              </div>
              <p className="text-slate-600">
                عند إنشاء طلب صرف جديد، سيتعرف النظام فوراً على تفضيلك المالي ويملأ خانة التحويل مباشرة لتوفير وقتك.
              </p>
            </div>
          </div>
        </div>

        {/* Edit Forms Column */}
        <div className="md:col-span-2 space-y-6">
          {/* Section 1: Financial Payout Profile */}
          <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-6">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-emerald-100 text-emerald-700 rounded-xl">
                  <CreditCard className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="font-bold text-base text-slate-900">بيانات الاستحقاق والتحويل المالي التلقائي</h2>
                  <p className="text-xs text-slate-500">اختر طريقتك المفضلة لاستلام مستحقاتك وسجل بياناتها مرة واحدة</p>
                </div>
              </div>
            </div>

            {profileFeedback && (
              <div className={`p-4 rounded-xl text-xs font-bold flex items-center gap-2 ${
                profileFeedback.type === 'success' 
                  ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' 
                  : 'bg-rose-50 text-rose-800 border border-rose-200'
              }`}>
                {profileFeedback.type === 'success' ? (
                  <Check className="h-4 w-4 text-emerald-600 shrink-0" />
                ) : (
                  <AlertCircle className="h-4 w-4 text-rose-600 shrink-0" />
                )}
                <span>{profileFeedback.message}</span>
              </div>
            )}

            <form onSubmit={handleSaveProfile} className="space-y-5">
              {/* Preferred Payment Method */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-2">
                  طريقة التحويل المفضلة افتراضياً عند تقديم الطلبات
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <button
                    type="button"
                    onClick={() => setPreferredMethod('instapay')}
                    className={`p-3 rounded-xl border text-center transition cursor-pointer flex flex-col items-center gap-1.5 ${
                      preferredMethod === 'instapay'
                        ? 'border-purple-600 bg-purple-50 text-purple-900 font-bold shadow-xs ring-2 ring-purple-600/20'
                        : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100 font-medium'
                    }`}
                  >
                    <Smartphone className="h-4 w-4 text-purple-600" />
                    <span className="text-xs">إنستاباي InstaPay</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setPreferredMethod('wallet')}
                    className={`p-3 rounded-xl border text-center transition cursor-pointer flex flex-col items-center gap-1.5 ${
                      preferredMethod === 'wallet'
                        ? 'border-amber-600 bg-amber-50 text-amber-900 font-bold shadow-xs ring-2 ring-amber-600/20'
                        : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100 font-medium'
                    }`}
                  >
                    <Smartphone className="h-4 w-4 text-amber-600" />
                    <span className="text-xs">محفظة هاتف كاش</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setPreferredMethod('bank_transfer')}
                    className={`p-3 rounded-xl border text-center transition cursor-pointer flex flex-col items-center gap-1.5 ${
                      preferredMethod === 'bank_transfer'
                        ? 'border-emerald-600 bg-emerald-50 text-emerald-900 font-bold shadow-xs ring-2 ring-emerald-600/20'
                        : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100 font-medium'
                    }`}
                  >
                    <Building className="h-4 w-4 text-emerald-600" />
                    <span className="text-xs">تحويل بنكي IBAN</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setPreferredMethod('cash')}
                    className={`p-3 rounded-xl border text-center transition cursor-pointer flex flex-col items-center gap-1.5 ${
                      preferredMethod === 'cash'
                        ? 'border-slate-700 bg-slate-100 text-slate-900 font-bold shadow-xs ring-2 ring-slate-700/20'
                        : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100 font-medium'
                    }`}
                  >
                    <CreditCard className="h-4 w-4 text-slate-600" />
                    <span className="text-xs">نقداً (خزينة المقر)</span>
                  </button>
                </div>
              </div>

              {/* InstaPay Section */}
              <div className="p-4 rounded-xl bg-purple-50/50 border border-purple-200/70 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Smartphone className="h-4 w-4 text-purple-700" />
                    <span className="text-xs font-bold text-purple-900">بيانات إنستاباي (InstaPay)</span>
                  </div>
                  {preferredMethod === 'instapay' && (
                    <span className="text-[10px] font-bold px-2 py-0.5 bg-purple-200 text-purple-800 rounded-md">المفضل حالياً ⭐</span>
                  )}
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    عنوان الدفع اللحظي (IPA) أو رقم الهاتف المسجل بإنستاباي:
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      dir="ltr"
                      value={instapay}
                      onChange={e => setInstapay(sanitizeInstaPay(e.target.value))}
                      placeholder="مثال: name@instapay أو 01117333908"
                      className="w-full px-3.5 py-2.5 bg-white border border-purple-200 rounded-xl text-xs text-left focus:outline-hidden focus:ring-2 focus:ring-purple-500 font-mono"
                    />
                  </div>
                </div>
              </div>

              {/* Mobile Wallet Section */}
              <div className="p-4 rounded-xl bg-amber-50/50 border border-amber-200/70 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Smartphone className="h-4 w-4 text-amber-700" />
                    <span className="text-xs font-bold text-amber-900">بيانات محفظة الهاتف (Mobile Wallet)</span>
                  </div>
                  {preferredMethod === 'wallet' && (
                    <span className="text-[10px] font-bold px-2 py-0.5 bg-amber-200 text-amber-800 rounded-md">المفضل حالياً ⭐</span>
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      رقم المحفظة (11 رقم):
                    </label>
                    <input
                      type="tel"
                      dir="ltr"
                      inputMode="numeric"
                      maxLength={11}
                      value={wallet}
                      onKeyDown={e => handleNumericKeyDown(e, false)}
                      onChange={e => setWallet(sanitizeDigitsOnly(e.target.value, 11))}
                      placeholder="01012345678"
                      className="w-full px-3.5 py-2.5 bg-white border border-amber-200 rounded-xl text-xs text-left focus:outline-hidden focus:ring-2 focus:ring-amber-500 font-mono"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      نوع / مزود المحفظة:
                    </label>
                    <select
                      value={walletProvider}
                      onChange={e => setWalletProvider(e.target.value)}
                      className="w-full px-3.5 py-2.5 bg-white border border-amber-200 rounded-xl text-xs focus:outline-hidden focus:ring-2 focus:ring-amber-500 font-medium"
                    >
                      <option value="فودافون كاش">فودافون كاش (Vodafone Cash)</option>
                      <option value="اتصالات كاش">اتصالات كاش (Etisalat Cash)</option>
                      <option value="أورنج كاش">أورنج كاش (Orange Cash)</option>
                      <option value="وي باي">وي باي (WE Pay)</option>
                      <option value="محفظة بنكية">محفظة بنكية (CIB Smart / بنك مصر / الأهلي)</option>
                      <option value="أخرى">أخرى</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Bank Account Section */}
              <div className="p-4 rounded-xl bg-emerald-50/50 border border-emerald-200/70 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Building className="h-4 w-4 text-emerald-700" />
                    <span className="text-xs font-bold text-emerald-900">بيانات الحساب البنكي (Bank Transfer / IBAN)</span>
                  </div>
                  {preferredMethod === 'bank_transfer' && (
                    <span className="text-[10px] font-bold px-2 py-0.5 bg-emerald-200 text-emerald-800 rounded-md">المفضل حالياً ⭐</span>
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      اسم البنك:
                    </label>
                    <input
                      type="text"
                      value={bankName}
                      onChange={e => setBankName(e.target.value)}
                      placeholder="مثال: البنك التجاري الدولي CIB، الأهلي، بنك مصر"
                      className="w-full px-3.5 py-2.5 bg-white border border-emerald-200 rounded-xl text-xs focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      رقم الآيبان (IBAN):
                    </label>
                    <input
                      type="text"
                      dir="ltr"
                      value={iban}
                      onChange={e => setIban(sanitizeIBAN(e.target.value))}
                      placeholder="EG380019000500000000263180002"
                      className="w-full px-3.5 py-2.5 bg-white border border-emerald-200 rounded-xl text-xs text-left focus:outline-hidden focus:ring-2 focus:ring-emerald-500 font-mono"
                    />
                  </div>
                </div>
              </div>

              {/* Section 2: Personal & Contact Information */}
              <div className="pt-4 border-t border-slate-100 space-y-4">
                <h3 className="text-xs font-bold text-slate-900 flex items-center gap-2">
                  <UserIcon className="h-4 w-4 text-slate-600" />
                  <span>البيانات الشخصية ورقم الهاتف</span>
                </h3>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      الاسم بالكامل:
                    </label>
                    <input
                      type="text"
                      value={name}
                      onChange={e => setName(e.target.value)}
                      className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      رقم هاتف الاتصال:
                    </label>
                    <input
                      type="tel"
                      dir="ltr"
                      value={phone}
                      onChange={e => setPhone(sanitizePhone(e.target.value))}
                      placeholder="01117333908"
                      className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-left focus:outline-hidden focus:ring-2 focus:ring-emerald-500 font-mono"
                    />
                  </div>
                </div>
              </div>

              {/* Save Button */}
              <div className="flex justify-end pt-2">
                <button
                  type="submit"
                  disabled={isSavingProfile}
                  className="flex items-center gap-2 px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-sm transition cursor-pointer disabled:opacity-50"
                >
                  <Save className="h-4 w-4" />
                  <span>{isSavingProfile ? 'جارٍ الحفظ...' : 'حفظ التغييرات وبيانات الاستحقاق'}</span>
                </button>
              </div>
            </form>
          </div>

          {/* Section 3: Password & Security */}
          <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-4">
            <div className="flex items-center gap-2.5 border-b border-slate-100 pb-4">
              <div className="p-2 bg-indigo-100 text-indigo-700 rounded-xl">
                <Lock className="h-5 w-5" />
              </div>
              <div>
                <h2 className="font-bold text-base text-slate-900">أمان الحساب وتغيير كلمة المرور</h2>
                <p className="text-xs text-slate-500">قم بتحديث كلمة المرور لحماية حسابك وعملياتك المالية</p>
              </div>
            </div>

            {isGoogleUser ? (
              <div className="p-4 rounded-xl bg-sky-50 border border-sky-200 text-xs text-sky-900 leading-relaxed flex items-start gap-2.5">
                <ShieldCheck className="h-5 w-5 text-sky-600 shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold block">تسجيل الدخول مفعل عبر Google (حساب موثق):</span>
                  <span>حسابك مرتبط ببريدك الإلكتروني عبر Google، وتتم حماية كلمة المرور وإدارتها مباشرة عبر أمان حسابك في Google.</span>
                </div>
              </div>
            ) : (
              <>
                {passFeedback && (
                  <div className={`p-4 rounded-xl text-xs font-bold flex items-center gap-2 ${
                    passFeedback.type === 'success' 
                      ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' 
                      : 'bg-rose-50 text-rose-800 border border-rose-200'
                  }`}>
                    {passFeedback.type === 'success' ? (
                      <Check className="h-4 w-4 text-emerald-600 shrink-0" />
                    ) : (
                      <AlertCircle className="h-4 w-4 text-rose-600 shrink-0" />
                    )}
                    <span>{passFeedback.message}</span>
                  </div>
                )}

                <form onSubmit={handleChangePassword} className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      كلمة المرور الحالية:
                    </label>
                    <input
                      type="password"
                      value={currentPassword}
                      onChange={e => setCurrentPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                      required
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        كلمة المرور الجديدة:
                      </label>
                      <input
                        type="password"
                        value={newPassword}
                        onChange={e => setNewPassword(e.target.value)}
                        placeholder="6 أحرف أو أرقام كحد أدنى"
                        className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        تأكيد كلمة المرور الجديدة:
                      </label>
                      <input
                        type="password"
                        value={confirmPassword}
                        onChange={e => setConfirmPassword(e.target.value)}
                        placeholder="أعد كتابة كلمة المرور"
                        className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                        required
                      />
                    </div>
                  </div>

                  <div className="flex justify-end pt-2">
                    <button
                      type="submit"
                      disabled={isChangingPass}
                      className="flex items-center gap-2 px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-xl shadow-xs transition cursor-pointer disabled:opacity-50"
                    >
                      <Lock className="h-4 w-4" />
                      <span>{isChangingPass ? 'جارٍ التغيير...' : 'تحديث كلمة المرور'}</span>
                    </button>
                  </div>
                </form>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
