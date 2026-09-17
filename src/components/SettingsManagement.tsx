import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { 
  Bell, 
  Mail, 
  Send, 
  ShieldCheck, 
  CheckCircle2, 
  AlertCircle, 
  Loader2, 
  Flame, 
  User, 
  KeyRound, 
  Trash2, 
  Building2, 
  History, 
  Settings, 
  Check, 
  RefreshCw,
  Clock,
  ArrowUpRight,
  Receipt,
  FileCheck2,
  HelpCircle,
  XCircle,
  Database
} from 'lucide-react';
import { EmailEventType, Role } from '../types';

export const SettingsManagement: React.FC = () => {
  const { 
    currentUser, 
    currentRole, 
    activeOrg, 
    organizations, 
    setActiveTab, 
    openFirebaseModal,
    isFirebaseConnected,
    emailSettings,
    updateEmailSettings,
    emailLogs,
    sendTestEmail,
    clearEmailLogs,
    auditLogs,
    updateUserProfileInfo,
    changeCurrentUserPassword,
  } = useApp();

  const [activeSubTab, setActiveSubTab] = useState<'email' | 'general' | 'cloud' | 'profile' | 'audit'>('email');

  // Email Test state
  const [testRecipient, setTestRecipient] = useState(currentUser.email || '');
  const [testTemplate, setTestTemplate] = useState<EmailEventType>('request_approved');
  const [isSendingTest, setIsSendingTest] = useState(false);
  const [testFeedback, setTestFeedback] = useState<{ msg: string; isError?: boolean } | null>(null);

  // Email Settings Form state
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [settingsFeedback, setSettingsFeedback] = useState<string | null>(null);
  const [formSettings, setFormSettings] = useState(emailSettings);

  // Profile Form state
  const [displayName, setDisplayName] = useState(currentUser.name || '');
  const [phoneNumber, setPhoneNumber] = useState(currentUser.phone || '');
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [profileFeedback, setProfileFeedback] = useState<{ msg: string; isError?: boolean } | null>(null);

  // Password Change state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isChangingPass, setIsChangingPass] = useState(false);
  const [passFeedback, setPassFeedback] = useState<{ msg: string; isError?: boolean } | null>(null);

  // Synchronize local form settings when context settings change
  React.useEffect(() => {
    setFormSettings(emailSettings);
  }, [emailSettings]);

  const handleSaveEmailSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingSettings(true);
    setSettingsFeedback(null);
    try {
      await updateEmailSettings(formSettings);
      setSettingsFeedback('تم حفظ وتطبيق إعدادات الإشعارات بنجاح!');
      setTimeout(() => setSettingsFeedback(null), 4000);
    } catch {
      setSettingsFeedback('حدث خطأ أثناء حفظ الإعدادات.');
    } finally {
      setIsSavingSettings(false);
    }
  };

  const handleTriggerTestEmail = async () => {
    if (!testRecipient || !testRecipient.includes('@')) {
      setTestFeedback({ msg: 'يرجى إدخال عنوان بريد إلكتروني صحيح لإجراء الاختبار.', isError: true });
      return;
    }

    setIsSendingTest(true);
    setTestFeedback(null);
    try {
      const res = await sendTestEmail(testRecipient, testTemplate);
      setTestFeedback({ msg: res.message, isError: !res.success });
    } catch (err: any) {
      setTestFeedback({ msg: err?.message || 'فشل إرسال البريد التجريبي.', isError: true });
    } finally {
      setIsSendingTest(false);
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!displayName.trim()) {
      setProfileFeedback({ msg: 'يرجى إدخال الاسم.', isError: true });
      return;
    }
    setIsSavingProfile(true);
    setProfileFeedback(null);
    try {
      const res = await updateUserProfileInfo(displayName.trim(), phoneNumber.trim());
      if (res.success) {
        setProfileFeedback({ msg: 'تم تحديث البيانات الشخصية بنجاح!' });
        setTimeout(() => setProfileFeedback(null), 4000);
      } else {
        setProfileFeedback({ msg: res.error || 'حدث خطأ أثناء التحديث.', isError: true });
      }
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentPassword || !newPassword) {
      setPassFeedback({ msg: 'يرجى ملء جميع حقول كلمة المرور.', isError: true });
      return;
    }
    if (newPassword !== confirmPassword) {
      setPassFeedback({ msg: 'كلمة المرور الجديدة غير متطابقة.', isError: true });
      return;
    }
    if (newPassword.length < 6) {
      setPassFeedback({ msg: 'كلمة المرور الجديدة يجب ألا تقل عن 6 أحرف.', isError: true });
      return;
    }

    setIsChangingPass(true);
    setPassFeedback(null);
    try {
      const res = await changeCurrentUserPassword(currentPassword, newPassword);
      if (res.success) {
        setPassFeedback({ msg: 'تم تغيير كلمة المرور بنجاح!' });
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
        setTimeout(() => setPassFeedback(null), 4000);
      } else {
        setPassFeedback({ msg: res.error || 'تعذر تغيير كلمة المرور.', isError: true });
      }
    } finally {
      setIsChangingPass(false);
    }
  };

  const getEventBadge = (type: EmailEventType) => {
    switch (type) {
      case 'new_request':
        return <span className="bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full text-xs font-bold">طلب جديد</span>;
      case 'request_approved':
        return <span className="bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full text-xs font-bold">تم الاعتماد</span>;
      case 'request_paid':
        return <span className="bg-sky-100 text-sky-800 px-2 py-0.5 rounded-full text-xs font-bold">تم الصرف</span>;
      case 'clarification_requested':
        return <span className="bg-indigo-100 text-indigo-800 px-2 py-0.5 rounded-full text-xs font-bold">مطلوب توضيح</span>;
      case 'clarification_replied':
        return <span className="bg-teal-100 text-teal-800 px-2 py-0.5 rounded-full text-xs font-bold">رد توضيح</span>;
      case 'request_rejected':
        return <span className="bg-rose-100 text-rose-800 px-2 py-0.5 rounded-full text-xs font-bold">مرفوض</span>;
      case 'test_email':
      default:
        return <span className="bg-purple-100 text-purple-800 px-2 py-0.5 rounded-full text-xs font-bold">اختباري</span>;
    }
  };

  return (
    <div className="space-y-6 pb-12">
      
      {/* Top Banner & Title */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-xl bg-gradient-to-tr from-slate-800 to-slate-700 text-white flex items-center justify-center shadow-md">
              <Settings className="h-6 w-6 text-emerald-400" />
            </div>
            <div>
              <h2 className="text-xl font-extrabold text-slate-900">مركز الإعدادات والتحكم الشامل</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                تخصيص إشعارات البريد التلقائية، ربط Firebase السحابي، الملف الشخصي، وإعدادات المؤسسة
              </p>
            </div>
          </div>
        </div>

        {/* Global Connection Status Pill */}
        <div className="flex items-center gap-2">
          {isFirebaseConnected ? (
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-xl text-xs font-bold">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></span>
              <span>🔥 السحابة متصلة ونشطة</span>
            </div>
          ) : (
            <button
              type="button"
              onClick={openFirebaseModal}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 text-amber-800 border border-amber-200 rounded-xl text-xs font-bold hover:bg-amber-100 transition"
            >
              <Flame className="h-4 w-4 text-amber-600" />
              <span>ضبط اتصال Firebase</span>
            </button>
          )}
        </div>
      </div>

      {/* Tabs Bar */}
      <div className="flex space-x-reverse space-x-2 border-b border-slate-200 overflow-x-auto pb-2 scrollbar-none">
        <button
          type="button"
          onClick={() => setActiveSubTab('email')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-sm transition cursor-pointer whitespace-nowrap ${
            activeSubTab === 'email'
              ? 'bg-emerald-600 text-white shadow-sm'
              : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
          }`}
        >
          <Mail className="h-4 w-4" />
          <span>🔔 إشعارات البريد الإلكتروني (Email Notifications)</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveSubTab('cloud')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-sm transition cursor-pointer whitespace-nowrap ${
            activeSubTab === 'cloud'
              ? 'bg-emerald-600 text-white shadow-sm'
              : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
          }`}
        >
          <Flame className="h-4 w-4" />
          <span>🔥 الاتصال السحابي وقاعدة البيانات</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveSubTab('profile')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-sm transition cursor-pointer whitespace-nowrap ${
            activeSubTab === 'profile'
              ? 'bg-emerald-600 text-white shadow-sm'
              : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
          }`}
        >
          <User className="h-4 w-4" />
          <span>👤 الملف الشخصي والأمان</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveSubTab('general')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-sm transition cursor-pointer whitespace-nowrap ${
            activeSubTab === 'general'
              ? 'bg-emerald-600 text-white shadow-sm'
              : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
          }`}
        >
          <Building2 className="h-4 w-4" />
          <span>🏢 تفضيلات المؤسسة والعمليات</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveSubTab('audit')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-sm transition cursor-pointer whitespace-nowrap ${
            activeSubTab === 'audit'
              ? 'bg-emerald-600 text-white shadow-sm'
              : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
          }`}
        >
          <History className="h-4 w-4" />
          <span>📜 سجل التدقيق والرقابة</span>
        </button>
      </div>

      {/* ========================================================================= */}
      {/* TAB 1: EMAIL & NOTIFICATIONS */}
      {/* ========================================================================= */}
      {activeSubTab === 'email' && (
        <div className="space-y-6 animate-in fade-in duration-200">
          
          {/* Main Email Config Form */}
          <form onSubmit={handleSaveEmailSettings} className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-100 gap-3">
              <div>
                <h3 className="font-extrabold text-base text-slate-900 flex items-center gap-2">
                  <Bell className="h-5 w-5 text-emerald-600" />
                  <span>محرك الإشعارات البريدية التلقائي</span>
                </h3>
                <p className="text-xs text-slate-500 mt-1">
                  إرسال إيميلات آلية لكافة أطراف الطلب (المديرون عند الإنشاء، والموظفون عند المراجعة والاعتماد والصرف).
                </p>
              </div>

              {/* Master Toggle */}
              <label className="relative inline-flex items-center cursor-pointer select-none">
                <input 
                  type="checkbox" 
                  checked={formSettings.enabled}
                  onChange={(e) => setFormSettings({ ...formSettings, enabled: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-12 h-6.5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[3px] after:left-[3px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-600"></div>
                <span className="mr-3 text-xs font-bold text-slate-800">
                  {formSettings.enabled ? 'الإشعارات مفعلة' : 'الإشعارات معطلة'}
                </span>
              </label>
            </div>

            {/* Notification Event Toggles */}
            <div className="space-y-3">
              <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                الأحداث التي يتم إرسال إشعار بريدي تلقائي عندها:
              </h4>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                
                {/* New Request */}
                <div className="flex items-start justify-between p-3.5 rounded-xl border border-slate-200/80 bg-slate-50/60 hover:bg-slate-50 transition">
                  <div className="flex items-start gap-3">
                    <div className="h-8 w-8 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center shrink-0 mt-0.5 font-bold">
                      <Receipt className="h-4 w-4" />
                    </div>
                    <div>
                      <div className="text-xs font-bold text-slate-900">إنشاء وتقديم طلب صرف جديد</div>
                      <div className="text-[11px] text-slate-500 mt-0.5">يُرسل فوراً إلى مدير المؤسسة والمشرفين العامين مع كافة التفاصيل والمبلغ.</div>
                    </div>
                  </div>
                  <input 
                    type="checkbox"
                    checked={formSettings.notifyOnNewRequest}
                    onChange={(e) => setFormSettings({ ...formSettings, notifyOnNewRequest: e.target.checked })}
                    className="h-4.5 w-4.5 text-emerald-600 rounded-md border-slate-300 focus:ring-emerald-500 mt-1 cursor-pointer"
                  />
                </div>

                {/* Approved */}
                <div className="flex items-start justify-between p-3.5 rounded-xl border border-slate-200/80 bg-slate-50/60 hover:bg-slate-50 transition">
                  <div className="flex items-start gap-3">
                    <div className="h-8 w-8 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0 mt-0.5 font-bold">
                      <CheckCircle2 className="h-4 w-4" />
                    </div>
                    <div>
                      <div className="text-xs font-bold text-slate-900">اعتماد الطلب والموافقة عليه</div>
                      <div className="text-[11px] text-slate-500 mt-0.5">يُرسل للموظف طالب الصرف لإبلاغه بالموافقة وجاهزية الطلب للصرف.</div>
                    </div>
                  </div>
                  <input 
                    type="checkbox"
                    checked={formSettings.notifyOnApproval}
                    onChange={(e) => setFormSettings({ ...formSettings, notifyOnApproval: e.target.checked })}
                    className="h-4.5 w-4.5 text-emerald-600 rounded-md border-slate-300 focus:ring-emerald-500 mt-1 cursor-pointer"
                  />
                </div>

                {/* Disbursed / Paid */}
                <div className="flex items-start justify-between p-3.5 rounded-xl border border-slate-200/80 bg-slate-50/60 hover:bg-slate-50 transition">
                  <div className="flex items-start gap-3">
                    <div className="h-8 w-8 rounded-lg bg-sky-100 text-sky-700 flex items-center justify-center shrink-0 mt-0.5 font-bold">
                      <FileCheck2 className="h-4 w-4" />
                    </div>
                    <div>
                      <div className="text-xs font-bold text-slate-900">الصرف الفعلي والانتهاء من الطلب</div>
                      <div className="text-[11px] text-slate-500 mt-0.5">يُرسل للموظف مع بيانات التحويل (إنستاباي/بنك)، الخزينة، ورقم الإيصال.</div>
                    </div>
                  </div>
                  <input 
                    type="checkbox"
                    checked={formSettings.notifyOnDisbursement}
                    onChange={(e) => setFormSettings({ ...formSettings, notifyOnDisbursement: e.target.checked })}
                    className="h-4.5 w-4.5 text-emerald-600 rounded-md border-slate-300 focus:ring-emerald-500 mt-1 cursor-pointer"
                  />
                </div>

                {/* Clarification */}
                <div className="flex items-start justify-between p-3.5 rounded-xl border border-slate-200/80 bg-slate-50/60 hover:bg-slate-50 transition">
                  <div className="flex items-start gap-3">
                    <div className="h-8 w-8 rounded-lg bg-indigo-100 text-indigo-700 flex items-center justify-center shrink-0 mt-0.5 font-bold">
                      <HelpCircle className="h-4 w-4" />
                    </div>
                    <div>
                      <div className="text-xs font-bold text-slate-900">طلب استفسار أو مراجعة توضيحات</div>
                      <div className="text-[11px] text-slate-500 mt-0.5">يُرسل للموظف مع سؤال المدير وروابط الرد الفوري بالمستندات.</div>
                    </div>
                  </div>
                  <input 
                    type="checkbox"
                    checked={formSettings.notifyOnClarification}
                    onChange={(e) => setFormSettings({ ...formSettings, notifyOnClarification: e.target.checked })}
                    className="h-4.5 w-4.5 text-emerald-600 rounded-md border-slate-300 focus:ring-emerald-500 mt-1 cursor-pointer"
                  />
                </div>

                {/* Rejection */}
                <div className="flex items-start justify-between p-3.5 rounded-xl border border-slate-200/80 bg-slate-50/60 hover:bg-slate-50 transition">
                  <div className="flex items-start gap-3">
                    <div className="h-8 w-8 rounded-lg bg-rose-100 text-rose-700 flex items-center justify-center shrink-0 mt-0.5 font-bold">
                      <XCircle className="h-4 w-4" />
                    </div>
                    <div>
                      <div className="text-xs font-bold text-slate-900">رفض طلب الصرف</div>
                      <div className="text-[11px] text-slate-500 mt-0.5">يُرسل للموظف موضحاً سبب الرفض المحدد من قبل الإدارة.</div>
                    </div>
                  </div>
                  <input 
                    type="checkbox"
                    checked={formSettings.notifyOnRejection}
                    onChange={(e) => setFormSettings({ ...formSettings, notifyOnRejection: e.target.checked })}
                    className="h-4.5 w-4.5 text-emerald-600 rounded-md border-slate-300 focus:ring-emerald-500 mt-1 cursor-pointer"
                  />
                </div>

              </div>
            </div>

            {/* Delivery Methods & Sender Details */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-3 border-t border-slate-100">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">اسم المرسل (Sender Name):</label>
                <input 
                  type="text"
                  value={formSettings.senderName}
                  onChange={(e) => setFormSettings({ ...formSettings, senderName: e.target.value })}
                  placeholder="مثال: نظام مصروفي"
                  className="w-full text-xs px-3 py-2 rounded-xl border border-slate-200 focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">البريد المعتمد للإرسال (Sender Email):</label>
                <input 
                  type="email"
                  value={formSettings.senderEmail || 'awadhsaudi2030@gmail.com'}
                  onChange={(e) => setFormSettings({ ...formSettings, senderEmail: e.target.value })}
                  placeholder="awadhsaudi2030@gmail.com"
                  className="w-full text-xs px-3 py-2 rounded-xl border border-slate-200 focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 bg-emerald-50/20 font-medium"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">بريد الرد (Reply-To Email):</label>
                <input 
                  type="email"
                  value={formSettings.replyToEmail || 'awadhsaudi2030@gmail.com'}
                  onChange={(e) => setFormSettings({ ...formSettings, replyToEmail: e.target.value })}
                  placeholder="awadhsaudi2030@gmail.com"
                  className="w-full text-xs px-3 py-2 rounded-xl border border-slate-200 focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                />
              </div>

              {/* Verified Sender Notice Badge */}
              <div className="md:col-span-3 bg-emerald-50/80 border border-emerald-200/80 rounded-xl p-3 flex items-center gap-3">
                <div className="h-7 w-7 rounded-lg bg-emerald-600 text-white flex items-center justify-center shrink-0">
                  <Mail className="h-4 w-4" />
                </div>
                <div className="text-xs text-emerald-950">
                  <span className="font-bold">البريد الإلكتروني المعتمد لكافة إشعارات النظام: </span>
                  <span className="font-mono bg-white px-2 py-0.5 rounded-md border border-emerald-200 text-emerald-800 font-bold ml-1">awadhsaudi2030@gmail.com</span>
                  <span className="text-slate-600 mr-2">- تصدر كافة رسائل الاعتماد والصرف وتستقبل الردود مباشرة عبر هذا العنوان.</span>
                </div>
              </div>

              <div className="md:col-span-2">
                <label className="block text-xs font-bold text-slate-700 mb-1">طريقة توجيه وتسليم البريد (Delivery Method):</label>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {/* Option 1: Direct Serverless API (Recommended & Free) */}
                  <label className={`flex items-start gap-3 p-3.5 rounded-xl border cursor-pointer transition ${
                    formSettings.deliveryMethod === 'direct_api' || !formSettings.deliveryMethod
                      ? 'border-emerald-500 bg-emerald-50/40 text-emerald-900 font-bold'
                      : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                  }`}>
                    <input 
                      type="radio"
                      name="deliveryMethod"
                      value="direct_api"
                      checked={formSettings.deliveryMethod === 'direct_api' || !formSettings.deliveryMethod}
                      onChange={() => setFormSettings({ ...formSettings, deliveryMethod: 'direct_api' })}
                      className="mt-1 text-emerald-600"
                    />
                    <div>
                      <div className="text-xs font-bold flex items-center gap-1">
                        <span>⚡ إرسال مباشر للإنبوكس (Vercel Serverless)</span>
                        <span className="bg-emerald-600 text-white text-[9px] px-1.5 py-0.2 rounded-full">مجاني 100%</span>
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        يطير فوراً لصندوق البريد الحقيقي (Inbox) عبر Resend أو Brevo بدون الحاجة لترقية فايربيز أو كارت بنكي.
                      </div>
                    </div>
                  </label>

                  {/* Option 2: Firebase Trigger Email */}
                  <label className={`flex items-start gap-3 p-3.5 rounded-xl border cursor-pointer transition ${
                    formSettings.deliveryMethod === 'firestore_mail'
                      ? 'border-emerald-500 bg-emerald-50/40 text-emerald-900 font-bold'
                      : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                  }`}>
                    <input 
                      type="radio"
                      name="deliveryMethod"
                      value="firestore_mail"
                      checked={formSettings.deliveryMethod === 'firestore_mail'}
                      onChange={() => setFormSettings({ ...formSettings, deliveryMethod: 'firestore_mail' })}
                      className="mt-1 text-emerald-600"
                    />
                    <div>
                      <div className="text-xs font-bold">🔥 مجموعة `mail` في Firestore</div>
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        الحل عبر Firebase Extensions. يتطلب الترقية لخطة Blaze في فايربيز.
                      </div>
                    </div>
                  </label>

                  {/* Option 3: Webhook */}
                  <label className={`flex items-start gap-3 p-3.5 rounded-xl border cursor-pointer transition ${
                    formSettings.deliveryMethod === 'webhook'
                      ? 'border-emerald-500 bg-emerald-50/40 text-emerald-900 font-bold'
                      : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                  }`}>
                    <input 
                      type="radio"
                      name="deliveryMethod"
                      value="webhook"
                      checked={formSettings.deliveryMethod === 'webhook'}
                      onChange={() => setFormSettings({ ...formSettings, deliveryMethod: 'webhook' })}
                      className="mt-1 text-emerald-600"
                    />
                    <div>
                      <div className="text-xs font-bold">🌐 رابط ويب هوك مخصص (Webhook)</div>
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        إرسال كائن JSON عبر POST إلى رابط خارجي (Zapier / Make / n8n).
                      </div>
                    </div>
                  </label>
                </div>

                {/* Sub-settings for Direct Serverless API */}
                {(formSettings.deliveryMethod === 'direct_api' || !formSettings.deliveryMethod) && (
                  <div className="mt-4 p-4 rounded-xl bg-slate-50 border border-slate-200/80 space-y-3 animate-in fade-in">
                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                      <div className="sm:col-span-5">
                        <label className="block text-xs font-bold text-slate-700 mb-1">المزود المعتمد (Email Provider):</label>
                        <select
                          value={formSettings.directProvider || 'auto'}
                          onChange={(e) => setFormSettings({ ...formSettings, directProvider: e.target.value as any })}
                          className="w-full text-xs px-3 py-2 rounded-xl border border-slate-200 bg-white focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 font-medium"
                        >
                          <option value="auto">⚡ تلقائي ذكي (Auto-Detect من Vercel أو الإعدادات)</option>
                          <option value="gmail">📨 جوجل الرسمي (Gmail App Password - 500 يومياً لأي إيميل)</option>
                          <option value="brevo">🌐 Brevo / Sendinblue (300 يومياً لأي إيميل بدون دومين)</option>
                          <option value="resend">✉️ Resend (3,000 إيميل شهرياً)</option>
                        </select>
                      </div>

                      <div className="sm:col-span-7">
                        <label className="block text-xs font-bold text-slate-700 mb-1">
                          مفتاح الربط أو كلمة مرور التطبيقات (API Key / Password):
                        </label>
                        <input 
                          type="password"
                          value={formSettings.directApiKey || ''}
                          onChange={(e) => setFormSettings({ ...formSettings, directApiKey: e.target.value })}
                          placeholder={
                            formSettings.directProvider === 'gmail' 
                              ? 'كلمة مرور التطبيق من Google (16 حرفاً)...' 
                              : formSettings.directProvider === 'brevo' 
                                ? 'xkeysib-...' 
                                : 're_123456789...'
                          }
                          className="w-full text-xs px-3 py-2 rounded-xl border border-slate-200 bg-white focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 font-mono"
                        />
                      </div>
                    </div>

                    <div className="p-3 bg-indigo-50/70 border border-indigo-200/60 rounded-xl text-[11px] text-indigo-900 leading-relaxed flex items-start gap-2">
                      <div className="shrink-0 mt-0.5">💡</div>
                      <div>
                        <strong>خيارات إرسال الإيميلات لكافة الموظفين والمديرين (مثل mahmoud@tieapps.com):</strong>
                        <div className="mt-1.5 text-indigo-800 space-y-1">
                          <div>
                            <strong>1. عبر Gmail مباشرة (موصى به لحسابات جوجل):</strong> أنشئ "كلمة مرور تطبيق" (App Password من 16 حرف) من إعدادات حساب جوجل لبريد <code>awadhsaudi2030@gmail.com</code> (قسم الأمان &gt; التحقق بخطوتين)، وضعها في الحقل أعلاه أو كـ <code>GMAIL_APP_PASSWORD</code> في Vercel. يرسل مباشرة حتى 500 إيميل يومياً لأي مستقبل.
                          </div>
                          <div>
                            <strong>2. عبر Brevo (Sendinblue):</strong> سجل مجاناً في <a href="https://brevo.com" target="_blank" rel="noreferrer" className="underline font-bold text-indigo-600">brevo.com</a>، وانسخ مفتاح API Key (يبدأ بـ <code>xkeysib-</code>). يعطيك 300 إيميل يومياً لأي إيميل في العالم بدون الحاجة لدومين.
                          </div>
                          <div>
                            <strong>3. عبر Resend:</strong> يرسل 3,000 إيميل شهرياً، ويتطلب توثيق دومين (مثل <code>tieapps.com</code>) من صفحة <a href="https://resend.com/domains" target="_blank" rel="noreferrer" className="underline font-bold text-indigo-600">resend.com/domains</a> للإرسال لغير صاحب الحساب.
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Sub-settings for Webhook */}
                {formSettings.deliveryMethod === 'webhook' && (
                  <div className="mt-3">
                    <label className="block text-xs font-bold text-slate-700 mb-1">رابط الـ Webhook (Endpoint URL):</label>
                    <input 
                      type="url"
                      value={formSettings.webhookUrl || ''}
                      onChange={(e) => setFormSettings({ ...formSettings, webhookUrl: e.target.value })}
                      placeholder="https://api.resend.com/emails أو https://hooks.zapier.com/..."
                      className="w-full text-xs px-3 py-2 rounded-xl border border-slate-200 focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 font-mono"
                    />
                  </div>
                )}
              </div>
            </div>

            {/* Feedback Message */}
            {settingsFeedback && (
              <div className="p-3 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-xl text-xs font-bold flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                <span>{settingsFeedback}</span>
              </div>
            )}

            {/* Submit Button */}
            <div className="flex justify-end pt-2">
              <button
                type="submit"
                disabled={isSavingSettings}
                className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-md shadow-emerald-600/20 transition cursor-pointer disabled:opacity-50"
              >
                {isSavingSettings ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>جاري الحفظ...</span>
                  </>
                ) : (
                  <>
                    <Check className="h-4 w-4" />
                    <span>حفظ إعدادات الإشعارات</span>
                  </>
                )}
              </button>
            </div>
          </form>

          {/* Test Email Dispatch Card */}
          <div className="bg-gradient-to-br from-indigo-900 via-slate-900 to-slate-950 text-white p-6 rounded-2xl border border-indigo-500/30 shadow-lg space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="h-9 w-9 rounded-xl bg-indigo-500/20 border border-indigo-400/30 text-indigo-300 flex items-center justify-center font-bold">
                  <Send className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-white">🧪 فحص وإرسال بريد تجريبي مباشر</h3>
                  <p className="text-[11px] text-slate-300">
                    أرسل بريداً تجريبياً فورياً لأي إيميل للتحقق من وصول الإشعارات وشكل القالب العربي.
                  </p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 pt-2">
              <div className="sm:col-span-6">
                <label className="block text-[11px] font-bold text-slate-300 mb-1">البريد الإلكتروني المستلم:</label>
                <input 
                  type="email"
                  value={testRecipient}
                  onChange={(e) => setTestRecipient(e.target.value)}
                  placeholder="name@example.com"
                  className="w-full text-xs px-3 py-2 bg-slate-800/80 border border-slate-700 text-white rounded-xl focus:ring-2 focus:ring-indigo-400 focus:outline-none placeholder:text-slate-500"
                />
              </div>

              <div className="sm:col-span-4">
                <label className="block text-[11px] font-bold text-slate-300 mb-1">نوع قالب الإشعار للتجربة:</label>
                <select 
                  value={testTemplate}
                  onChange={(e) => setTestTemplate(e.target.value as EmailEventType)}
                  className="w-full text-xs px-3 py-2 bg-slate-800/80 border border-slate-700 text-white rounded-xl focus:ring-2 focus:ring-indigo-400 focus:outline-none"
                >
                  <option value="request_approved">✅ تم الاعتماد (Approved)</option>
                  <option value="new_request">🔔 طلب صرف جديد (New Request)</option>
                  <option value="request_paid">💰 تم الصرف والتحويل (Paid/Finished)</option>
                  <option value="clarification_requested">💬 استفسار ومراجعة (Clarification)</option>
                  <option value="request_rejected">❌ رفض الطلب (Rejected)</option>
                  <option value="test_email">🧪 بريد اختباري عام (General Test)</option>
                </select>
              </div>

              <div className="sm:col-span-2 flex items-end">
                <button
                  type="button"
                  onClick={handleTriggerTestEmail}
                  disabled={isSendingTest}
                  className="w-full flex items-center justify-center gap-1.5 px-4 py-2 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 text-white rounded-xl text-xs font-bold transition shadow-md cursor-pointer disabled:opacity-50"
                >
                  {isSendingTest ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      <span>إرسال...</span>
                    </>
                  ) : (
                    <>
                      <Send className="h-3.5 w-3.5" />
                      <span>إرسال الآن</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {testFeedback && (
              <div className={`p-3 rounded-xl text-xs font-bold flex items-center gap-2 ${
                testFeedback.isError ? 'bg-rose-500/20 text-rose-200 border border-rose-500/40' : 'bg-emerald-500/20 text-emerald-200 border border-emerald-500/40'
              }`}>
                {testFeedback.isError ? <AlertCircle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
                <span>{testFeedback.msg}</span>
              </div>
            )}
          </div>

          {/* Email Outbox & Delivery History */}
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-slate-500" />
                <h3 className="font-bold text-sm text-slate-900">سجل الإشعارات البريدية المرسلة حديثاً ({emailLogs.length})</h3>
              </div>

              {emailLogs.length > 0 && (
                <button
                  type="button"
                  onClick={clearEmailLogs}
                  className="text-xs text-rose-600 hover:text-rose-800 flex items-center gap-1 font-bold cursor-pointer transition"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>مسح السجل</span>
                </button>
              )}
            </div>

            {emailLogs.length === 0 ? (
              <div className="p-8 text-center bg-slate-50 rounded-xl border border-dashed border-slate-200 text-xs text-slate-500">
                لم يتم إرسال أي إشعارات بريدية بعد. ستظهر هنا كافة الرسائل المرسلة تلقائياً عند تغيير حالات طلبات الصرف.
              </div>
            ) : (
              <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                {emailLogs.map((log) => (
                  <div key={log.id} className="flex flex-col sm:flex-row sm:items-center justify-between p-3.5 bg-slate-50 hover:bg-slate-100/80 rounded-xl border border-slate-200/80 text-xs gap-3 transition">
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-8 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                        <Mail className="h-4 w-4" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          {getEventBadge(log.eventType)}
                          <span className="font-bold text-slate-900 truncate max-w-[240px]">{log.subject}</span>
                        </div>
                        <div className="text-[11px] text-slate-500 mt-1 flex items-center gap-2">
                          <span className="font-mono text-slate-700 font-semibold">{log.recipientEmail}</span>
                          <span>•</span>
                          <span>{new Date(log.timestamp).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 justify-end shrink-0">
                      {log.status === 'sent' ? (
                        <span className="bg-emerald-100 text-emerald-800 font-bold px-2 py-0.5 rounded-full text-[10px] flex items-center gap-1">
                          <CheckCircle2 className="h-3 w-3" /> تم الإرسال
                        </span>
                      ) : (
                        <span className="bg-rose-100 text-rose-800 font-bold px-2 py-0.5 rounded-full text-[10px] flex items-center gap-1">
                          <AlertCircle className="h-3 w-3" /> تعذر الإرسال
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 2: CLOUD & DATABASE */}
      {/* ========================================================================= */}
      {activeSubTab === 'cloud' && (
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-6 animate-in fade-in duration-200">
          <div className="flex items-center justify-between pb-4 border-b border-slate-100">
            <div>
              <h3 className="font-extrabold text-base text-slate-900 flex items-center gap-2">
                <Database className="h-5 w-5 text-amber-500" />
                <span>إعدادات السحابة المشفرة وقاعدة بيانات Firebase</span>
              </h3>
              <p className="text-xs text-slate-500 mt-1">
                حالة الربط اللحظي بالسحابة والمجموعات المخزنة والتحديثات الحية
              </p>
            </div>

            <button
              type="button"
              onClick={openFirebaseModal}
              className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-xl text-xs font-bold shadow-md hover:from-amber-600 hover:to-orange-600 transition cursor-pointer"
            >
              <Flame className="h-4 w-4" />
              <span>إدارة تكوين Firebase</span>
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
              <div className="text-xs text-slate-500 font-bold">حالة المزامنة السحابية:</div>
              <div className="text-sm font-extrabold text-emerald-700 mt-1 flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
                <span>{isFirebaseConnected ? 'نشط ومتصل لحظياً' : 'غير متصل'}</span>
              </div>
            </div>

            <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
              <div className="text-xs text-slate-500 font-bold">معرف المشروع (Project ID):</div>
              <div className="text-sm font-mono font-bold text-slate-800 mt-1 truncate">
                expenses-project-ce1f9
              </div>
            </div>

            <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
              <div className="text-xs text-slate-500 font-bold">مجموعة إرسال البريد (Trigger Email):</div>
              <div className="text-sm font-mono font-bold text-indigo-700 mt-1">
                collection('mail')
              </div>
            </div>
          </div>

          <div className="p-4 bg-amber-50/70 border border-amber-200 rounded-xl text-xs text-amber-900 leading-relaxed">
            💡 <strong>تنبيه للمدير:</strong> نظام الإشعارات يقوم تلقائياً بكتابة مستند في مجموعة <code className="bg-amber-100 px-1 py-0.5 rounded font-mono font-bold">mail</code> عند كل عملية صرف أو اعتماد.
            لتصل الرسائل إلى صندوق البريد الوارد الفعلي للمستخدمين، تأكد من تثبيت إضافة <strong>Trigger Email from Firestore</strong> في Firebase Console وربطها مع مزود بريد (مثل SendGrid أو Gmail SMTP أو Resend).
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 3: USER PROFILE & SECURITY */}
      {/* ========================================================================= */}
      {activeSubTab === 'profile' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 animate-in fade-in duration-200">
          
          {/* Profile Form */}
          <form onSubmit={handleSaveProfile} className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4">
            <h3 className="font-extrabold text-base text-slate-900 flex items-center gap-2 pb-3 border-b border-slate-100">
              <User className="h-5 w-5 text-emerald-600" />
              <span>البيانات الشخصية</span>
            </h3>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">البريد الإلكتروني الحساب:</label>
              <input 
                type="email"
                value={currentUser.email || ''}
                disabled
                className="w-full text-xs px-3 py-2 bg-slate-100 border border-slate-200 text-slate-500 rounded-xl font-mono cursor-not-allowed"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">الاسم المعروض:</label>
              <input 
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="الاسم الكامل"
                className="w-full text-xs px-3 py-2 rounded-xl border border-slate-200 focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">رقم الهاتف:</label>
              <input 
                type="tel"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                placeholder="010xxxxxxxx"
                className="w-full text-xs px-3 py-2 rounded-xl border border-slate-200 focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
              />
            </div>

            {profileFeedback && (
              <div className={`p-3 rounded-xl text-xs font-bold flex items-center gap-2 ${
                profileFeedback.isError ? 'bg-rose-50 text-rose-800 border border-rose-200' : 'bg-emerald-50 text-emerald-800 border border-emerald-200'
              }`}>
                {profileFeedback.isError ? <AlertCircle className="h-4 w-4 text-rose-600" /> : <CheckCircle2 className="h-4 w-4 text-emerald-600" />}
                <span>{profileFeedback.msg}</span>
              </div>
            )}

            <div className="flex justify-end pt-2">
              <button
                type="submit"
                disabled={isSavingProfile}
                className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition shadow-xs cursor-pointer disabled:opacity-50"
              >
                {isSavingProfile ? 'جاري الحفظ...' : 'حفظ التعديلات'}
              </button>
            </div>
          </form>

          {/* Password Change Form */}
          <form onSubmit={handleChangePassword} className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4">
            <h3 className="font-extrabold text-base text-slate-900 flex items-center gap-2 pb-3 border-b border-slate-100">
              <KeyRound className="h-5 w-5 text-indigo-600" />
              <span>تغيير كلمة المرور والأمان</span>
            </h3>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">كلمة المرور الحالية:</label>
              <input 
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full text-xs px-3 py-2 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">كلمة المرور الجديدة:</label>
              <input 
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full text-xs px-3 py-2 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">تأكيد كلمة المرور الجديدة:</label>
              <input 
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full text-xs px-3 py-2 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
              />
            </div>

            {passFeedback && (
              <div className={`p-3 rounded-xl text-xs font-bold flex items-center gap-2 ${
                passFeedback.isError ? 'bg-rose-50 text-rose-800 border border-rose-200' : 'bg-emerald-50 text-emerald-800 border border-emerald-200'
              }`}>
                {passFeedback.isError ? <AlertCircle className="h-4 w-4 text-rose-600" /> : <CheckCircle2 className="h-4 w-4 text-emerald-600" />}
                <span>{passFeedback.msg}</span>
              </div>
            )}

            <div className="flex justify-end pt-2">
              <button
                type="submit"
                disabled={isChangingPass}
                className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition shadow-xs cursor-pointer disabled:opacity-50"
              >
                {isChangingPass ? 'جاري التغيير...' : 'تحديث كلمة المرور'}
              </button>
            </div>
          </form>

        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 4: GENERAL PREFERENCES & SHORTCUTS */}
      {/* ========================================================================= */}
      {activeSubTab === 'general' && (
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-6 animate-in fade-in duration-200">
          <div>
            <h3 className="font-extrabold text-base text-slate-900 flex items-center gap-2">
              <Building2 className="h-5 w-5 text-emerald-600" />
              <span>تفضيلات المؤسسة والعمليات الإدارية</span>
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              الوصول السريع لإدارة الشركات، الخزن، الأقسام، وبنود الصرف
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            <button
              type="button"
              onClick={() => setActiveTab('organizations')}
              className="p-5 text-right rounded-2xl border border-slate-200 hover:border-emerald-500 hover:shadow-md transition bg-slate-50/50 group cursor-pointer"
            >
              <div className="h-10 w-10 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold mb-3 group-hover:scale-105 transition">
                <Building2 className="h-5 w-5" />
              </div>
              <h4 className="font-bold text-sm text-slate-900 group-hover:text-emerald-700">🏢 الشركات والفروع</h4>
              <p className="text-xs text-slate-500 mt-1">تعديل الميزانيات، العملات، وأسماء الشركات والكود التعريفي.</p>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('organizations')}
              className="p-5 text-right rounded-2xl border border-slate-200 hover:border-emerald-500 hover:shadow-md transition bg-slate-50/50 group cursor-pointer"
            >
              <div className="h-10 w-10 rounded-xl bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold mb-3 group-hover:scale-105 transition">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <h4 className="font-bold text-sm text-slate-900 group-hover:text-indigo-700">👥 إدارة المستخدمين والصلاحيات</h4>
              <p className="text-xs text-slate-500 mt-1">إضافة موظفين، تغيير الأدوار، وتجميد أو إعادة تفعيل الحسابات.</p>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('services')}
              className="p-5 text-right rounded-2xl border border-slate-200 hover:border-emerald-500 hover:shadow-md transition bg-slate-50/50 group cursor-pointer"
            >
              <div className="h-10 w-10 rounded-xl bg-sky-100 text-sky-700 flex items-center justify-center font-bold mb-3 group-hover:scale-105 transition">
                <Receipt className="h-5 w-5" />
              </div>
              <h4 className="font-bold text-sm text-slate-900 group-hover:text-sky-700">📋 بنود الصرف والخدمات</h4>
              <p className="text-xs text-slate-500 mt-1">إدارة مسميات الخدمات وميزانياتها المخصصة لكل شركة.</p>
            </button>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 5: AUDIT LOG */}
      {/* ========================================================================= */}
      {activeSubTab === 'audit' && (
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4 animate-in fade-in duration-200">
          <div>
            <h3 className="font-extrabold text-base text-slate-900 flex items-center gap-2">
              <History className="h-5 w-5 text-slate-700" />
              <span>سجل العمليات والرقابة الإدارية (Audit Trail)</span>
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              متابعة حية لكافة الأنشطة من تعديل الأدوار، حذف المستندات، وتغيير الإعدادات
            </p>
          </div>

          <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
            {auditLogs.slice(0, 30).map((log) => (
              <div key={log.id} className="p-3.5 bg-slate-50 rounded-xl border border-slate-200/80 text-xs flex items-center justify-between gap-3">
                <div>
                  <div className="font-bold text-slate-900">{log.details}</div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    المنفذ: <span className="font-semibold text-slate-700">{log.actorName}</span> ({log.actorEmail})
                  </div>
                </div>
                <span className="text-[10px] text-slate-400 font-mono shrink-0">
                  {new Date(log.timestamp).toLocaleString('ar-EG')}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  );
};
