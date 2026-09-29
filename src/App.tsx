import React, { useState, Suspense, lazy } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { LoginPage } from './components/LoginPage';
import { Header } from './components/Header';
import { Navbar } from './components/Navbar';
import { Sidebar } from './components/Sidebar';
import { ExpenseRequest, SUPPORTED_CURRENCIES } from './types';
import { Building2, X, AlertTriangle, Loader2, Wallet, Ban, ShieldAlert, MailCheck, RefreshCw, Copy } from 'lucide-react';
import { sanitizeDigitsOnly, sanitizeCode, handleNumericKeyDown } from './utils/validation';
import { useSubmitGuard } from './hooks/useSubmitGuard';

// Code-split heavy page views and modals (loads only what the user actively visits)
const DashboardAnalytics = lazy(() => import('./components/DashboardAnalytics').then(m => ({ default: m.DashboardAnalytics })));
const ExpenseRequestsList = lazy(() => import('./components/ExpenseRequestsList').then(m => ({ default: m.ExpenseRequestsList })));
const RequesterTracker = lazy(() => import('./components/RequesterTracker').then(m => ({ default: m.RequesterTracker })));
const ServicesManagement = lazy(() => import('./components/ServicesManagement').then(m => ({ default: m.ServicesManagement })));
const VendorsManagement = lazy(() => import('./components/VendorsManagement').then(m => ({ default: m.VendorsManagement })));
const OrganizationsManagement = lazy(() => import('./components/OrganizationsManagement').then(m => ({ default: m.OrganizationsManagement })));
const TreasuryManagement = lazy(() => import('./components/TreasuryManagement').then(m => ({ default: m.TreasuryManagement })));
const CustodyManagement = lazy(() => import('./components/CustodyManagement').then(m => ({ default: m.CustodyManagement })));
const NewRequestModal = lazy(() => import('./components/NewRequestModal').then(m => ({ default: m.NewRequestModal })));
const RequestDetailModal = lazy(() => import('./components/RequestDetailModal').then(m => ({ default: m.RequestDetailModal })));
const FirebaseConfigModal = lazy(() => import('./components/FirebaseConfigModal').then(m => ({ default: m.FirebaseConfigModal })));
const UserProfileModal = lazy(() => import('./components/UserProfileModal').then(m => ({ default: m.UserProfileModal })));
const SettingsManagement = lazy(() => import('./components/SettingsManagement').then(m => ({ default: m.SettingsManagement })));
const ProfileManagement = lazy(() => import('./components/ProfileManagement').then(m => ({ default: m.ProfileManagement })));
const VisaManagement = lazy(() => import('./components/VisaManagement').then(m => ({ default: m.VisaManagement })));
const UsersManagement = lazy(() => import('./components/UsersManagement').then(m => ({ default: m.UsersManagement })));

// Ultra-fast lightweight tab loading skeleton
const TabLoadingFallback: React.FC = () => (
  <div className="flex flex-col items-center justify-center min-h-[360px] p-8 text-center animate-in fade-in duration-150">
    <div className="h-11 w-11 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center mb-3 shadow-2xs border border-emerald-100">
      <Loader2 className="h-5 w-5 animate-spin text-emerald-600" />
    </div>
    <span className="text-xs font-bold text-slate-700">جاري معالجة الشاشة وتحميل البيانات...</span>
    <span className="text-[11px] text-slate-400 mt-0.5">تحميل ذكي فائق السرعة</span>
  </div>
);

const MainApp: React.FC = () => {
  const { 
    activeTab, 
    setActiveTab, 
    addOrganization, 
    organizations, 
    loading, 
    authLoading,
    firebaseUser,
    currentRole,
    currentUser,
    isFirebaseModalOpen,
    closeFirebaseModal,
    openFirebaseModal,
    firebaseError,
    clearFirebaseError,
    forceRefreshUserState,
    isAccountSuspended,
    superAdminNeedsVerification,
    sendSuperAdminVerificationEmail,
    recheckSuperAdminVerification,
    permissionDeniedSources,
  } = useApp();

  const [isNewRequestModalOpen, setIsNewRequestModalOpen] = useState(false);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<ExpenseRequest | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  
  // Status check state for pending assignment screen
  const [isRefreshingStatus, setIsRefreshingStatus] = useState(false);

  // Super-admin email verification (the security rules only honour verified emails)
  const verifyGuard = useSubmitGuard();
  const [verifyMessage, setVerifyMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const handleSendVerification = () => {
    void verifyGuard.run(async () => {
      const res = await sendSuperAdminVerificationEmail();
      setVerifyMessage({ ok: res.success, text: res.message });
    });
  };
  const handleRecheckVerification = () => {
    void verifyGuard.run(async () => {
      const verified = await recheckSuperAdminVerification();
      setVerifyMessage(verified
        ? { ok: true, text: 'تم تفعيل البريد بنجاح. جاري تحميل جميع الشركات والبيانات...' }
        : { ok: false, text: 'البريد لم يُفعَّل بعد. افتح رابط التفعيل في بريدك أولاً ثم أعد المحاولة.' });
    });
  };
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Manual "check my access now": re-reads the user's profile + memberships once.
  const handleCheckStatusNow = async () => {
    if (!firebaseUser || isRefreshingStatus) return;
    setIsRefreshingStatus(true);
    setStatusMessage(null);
    try {
      const ok = await forceRefreshUserState();
      if (!ok) {
        setStatusMessage('لم يتم ربط الحساب بشركة حتى الآن. يرجى التأكد من قيام مسؤول الشركة بإضافة بريدك الإلكتروني في قائمة الأعضاء.');
      }
    } catch (e: any) {
      console.error('[Status Check Error]', e);
      setStatusMessage('تعذر التحقق من حالة الحساب. أعد المحاولة.');
    } finally {
      setIsRefreshingStatus(false);
    }
  };

  // Quick Org modal for super admin
  const [isQuickOrgModalOpen, setIsQuickOrgModalOpen] = useState(false);
  const [newOrgName, setNewOrgName] = useState('');
  const [newOrgCode, setNewOrgCode] = useState('');
  const [newOrgCurrency, setNewOrgCurrency] = useState('EGP');
  const [newOrgBudget, setNewOrgBudget] = useState('500000');
  const quickOrgGuard = useSubmitGuard();
  const isQuickOrgSubmitting = quickOrgGuard.pending;
  const [quickOrgError, setQuickOrgError] = useState<string | null>(null);

  // 1. Mandatory Loading State
  if (authLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-slate-200">
        <div className="h-14 w-14 rounded-2xl bg-gradient-to-tr from-emerald-500 to-teal-400 flex items-center justify-center text-slate-950 shadow-2xl shadow-emerald-500/30 mb-4 animate-pulse">
          <Wallet className="h-7 w-7 stroke-[2.5]" />
        </div>
        <div className="flex items-center gap-2 text-xs font-bold text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin text-emerald-400" />
          <span>جاري التحقق من أمان الجلسة والشهادة الرقمية...</span>
        </div>
      </div>
    );
  }

  // 2. Mandatory Authentication Gate
  if (!firebaseUser) {
    return <LoginPage />;
  }

  const handleQuickAddOrg = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newOrgName.trim()) return;
    // Synchronous lock: Enter + click / double click can never create two companies.
    void quickOrgGuard.run(async idempotencyKey => {
      setQuickOrgError(null);
      try {
        const res = await addOrganization({
          name: newOrgName.trim(),
          code: newOrgCode.trim().toUpperCase() || newOrgName.trim().slice(0, 3).toUpperCase() || 'ORG',
          currency: newOrgCurrency,
          budget: Number(newOrgBudget) || 0,
          description: 'مؤسسة جديدة أضيفت للنظام.',
        }, { idempotencyKey });

        if (!res.success) {
          setQuickOrgError(res.message || 'تعذر إضافة الشركة.');
          return;
        }
        quickOrgGuard.rotateKey();
        setNewOrgName('');
        setNewOrgCode('');
        setQuickOrgError(null);
        setIsQuickOrgModalOpen(false);
      } catch (err: any) {
        setQuickOrgError(err?.message || 'حدث خطأ غير متوقع أثناء إضافة الشركة.');
      }
    });
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col antialiased selection:bg-emerald-100 selection:text-emerald-900">
      
      {/* Top Application Header */}
      <Header 
        onOpenNewRequest={() => setIsNewRequestModalOpen(true)}
        onOpenNewOrg={() => setIsQuickOrgModalOpen(true)}
        onOpenProfile={() => setActiveTab('profile')}
        onToggleSidebar={() => setIsSidebarOpen(prev => !prev)}
        onSelectRequest={setSelectedRequest}
      />

      {/* Firebase Permission / Connection Alert (Super Admin Only) */}
      {firebaseError && currentRole === 'super_admin' && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-2.5 text-xs text-amber-900 flex items-center justify-between gap-3 shadow-xs">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
            <span className="font-semibold">{firebaseError}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={openFirebaseModal}
              className="px-3 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-bold text-[11px] transition cursor-pointer"
            >
              طريقة فتح الصلاحيات (Rules)
            </button>
            <button
              type="button"
              onClick={clearFirebaseError}
              className="text-amber-700 hover:text-amber-900 p-1 rounded-md hover:bg-amber-100 transition cursor-pointer"
              title="إغلاق التنبيه"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Refused reads are reported, never shown as "no data" */}
      {permissionDeniedSources.length > 0 && !superAdminNeedsVerification && (
        <div className="bg-rose-50 border-b border-rose-200 px-4 py-2.5 text-xs text-rose-900 flex items-center gap-2 shadow-xs">
          <ShieldAlert className="h-4 w-4 text-rose-600 shrink-0" />
          <span className="font-semibold">
            رفضت قاعدة البيانات عرض: {permissionDeniedSources.join('، ')} — البيانات موجودة ولم تُحذف، لكن حسابك لا يملك صلاحية قراءتها حالياً. تواصل مع المشرف العام للمنصة.
          </span>
        </div>
      )}

      {/* Main Layout Container: Right Sidebar + Main Content (in RTL layout) */}
      <div className="flex-1 flex flex-row w-full min-h-[calc(100vh-4.5rem)] relative">
        {/* Right Navigation Sidebar */}
        <Sidebar 
          isOpen={isSidebarOpen} 
          onClose={() => setIsSidebarOpen(false)} 
        />

        {/* Main Content Area */}
        <main className="flex-1 min-w-0 px-4 sm:px-6 lg:px-8 py-6 max-w-7xl mx-auto">
          {superAdminNeedsVerification ? (
            <div className="bg-white rounded-3xl border border-amber-200 p-8 max-w-xl mx-auto text-center shadow-md my-10 animate-in fade-in duration-200">
              <div className="h-16 w-16 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center mx-auto mb-4 border border-amber-200">
                <ShieldAlert className="h-8 w-8" />
              </div>
              <h2 className="text-lg font-bold text-slate-900">تفعيل صلاحية المشرف العام للمنصة</h2>
              <p className="text-xs text-slate-600 mt-3 leading-relaxed">
                حسابك <strong dir="ltr">{currentUser.email}</strong> مسجّل كمشرف عام، لكن بريدك الإلكتروني غير مُفعَّل (غير موثَّق) لدى Firebase.
                قواعد الأمان لا تمنح صلاحيات المشرف العام إلا لبريد مُفعَّل، حتى لا يستطيع أي شخص إنشاء حساب بنفس البريد وانتحال صلاحياتك.
              </p>
              <p className="text-xs font-bold text-emerald-700 mt-3 leading-relaxed">
                الشركات والمستخدمون وكل البيانات موجودة كما هي ولم يُحذف منها شيء — فقط لن تظهر حتى يتم تفعيل البريد.
              </p>
              <div className="mt-6 flex flex-col sm:flex-row items-center justify-center gap-3">
                <button
                  type="button"
                  disabled={verifyGuard.pending}
                  onClick={handleSendVerification}
                  className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold text-xs rounded-xl transition cursor-pointer flex items-center gap-2 shadow-sm"
                >
                  <MailCheck className="h-4 w-4" />
                  إرسال رابط التفعيل إلى بريدي
                </button>
                <button
                  type="button"
                  disabled={verifyGuard.pending}
                  onClick={handleRecheckVerification}
                  className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white font-bold text-xs rounded-xl transition cursor-pointer flex items-center gap-2 shadow-sm"
                >
                  {verifyGuard.pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  فعّلت البريد — تحقق الآن
                </button>
              </div>
              {verifyMessage && (
                <p className={`text-xs mt-4 font-semibold ${verifyMessage.ok ? 'text-emerald-700' : 'text-rose-600'}`}>{verifyMessage.text}</p>
              )}
              <div className="mt-6 text-[11px] text-slate-500 leading-relaxed bg-slate-50 border border-slate-200 rounded-xl p-3 text-right">
                بديل فوري بدون بريد: من Firebase Console ← Firestore ← مجموعة <code>super_admins</code> أضف مستنداً معرّفه (Document ID) هو:
                <span className="flex items-center gap-2 mt-1.5">
                  <code dir="ltr" className="bg-white border border-slate-200 rounded px-2 py-0.5 select-all">{currentUser.id}</code>
                  <button
                    type="button"
                    onClick={() => { void navigator.clipboard?.writeText(currentUser.id); }}
                    className="text-slate-500 hover:text-slate-800 cursor-pointer"
                    title="نسخ"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                </span>
                مع الحقول: <code>email</code> و <code>role = super_admin</code>، ثم اضغط «تحقق الآن».
              </div>
            </div>
          ) : !loading && organizations.length === 0 && currentRole === 'super_admin' && activeTab === 'dashboard' ? (
            <div className="bg-white rounded-3xl border border-slate-200 p-10 max-w-xl mx-auto text-center shadow-md my-8">
              <div className="h-16 w-16 rounded-2xl bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto mb-4">
                <Building2 className="h-8 w-8" />
              </div>
              <h2 className="text-xl font-bold text-slate-900">مرحباً بك في لوحة تحكم المنصة (Super Admin)</h2>
              <p className="text-xs text-slate-500 mt-2 leading-relaxed">
                ابدأ بإنشاء الشركة الأولى وتعيين مدير لها ليبدأ في إضافة الموظفين واعتماد المصروفات.
              </p>
              <div className="flex flex-wrap items-center justify-center gap-3 mt-6">
                <button
                  type="button"
                  onClick={() => setIsQuickOrgModalOpen(true)}
                  className="px-6 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-md transition cursor-pointer"
                >
                  + إنشاء الشركة الأولى الآن
                </button>
              </div>
            </div>
          ) : isAccountSuspended ? (
            <div className="bg-white rounded-3xl border border-slate-200 p-10 max-w-lg mx-auto text-center shadow-md my-12 animate-in fade-in duration-200">
              <div className="h-16 w-16 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center mx-auto mb-4 border border-rose-200">
                <Ban className="h-8 w-8" />
              </div>
              <h2 className="text-lg font-bold text-slate-900">الحساب موقوف</h2>
              <p className="text-xs text-slate-500 mt-2 leading-relaxed">
                مرحباً بك <strong>{currentUser.name}</strong> ({currentUser.email}).
                <br />
                تم إيقاف حسابك من قِبل مسؤول الشركة، ولا يمكنك الوصول إلى بيانات الشركة حالياً. يرجى التواصل مع مدير شركتك لإعادة تفعيله.
              </p>
            </div>
          ) : !loading && currentRole !== 'super_admin' && organizations.length === 0 ? (
            <div className="bg-white rounded-3xl border border-slate-200 p-10 max-w-lg mx-auto text-center shadow-md my-12 animate-in fade-in duration-200">
              <div className="h-16 w-16 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center mx-auto mb-4 border border-amber-200">
                <Building2 className="h-8 w-8" />
              </div>
              <h2 className="text-lg font-bold text-slate-900">الحساب بانتظار التعيين في الشركة</h2>
              <p className="text-xs text-slate-500 mt-2 leading-relaxed">
                مرحباً بك <strong>{currentUser.name}</strong> ({currentUser.email}).
                <br />
                لم يتم ربط حسابك بأي شركة أو مؤسسة بعد، أو أن الحساب بانتظار تفعيل المسؤول. يرجى التواصل مع مدير شركتك لإضافتك وتفعيل صلاحياتك.
              </p>
              <div className="mt-6 flex flex-col items-center gap-3">
                <button
                  type="button"
                  disabled={isRefreshingStatus}
                  onClick={handleCheckStatusNow}
                  className="px-6 py-2.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white font-bold text-xs rounded-xl transition cursor-pointer flex items-center gap-2 shadow-sm"
                >
                  {isRefreshingStatus ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin text-emerald-400" />
                      <span>جاري فحص الصلاحيات وربط المؤسسة فورياً...</span>
                    </>
                  ) : (
                    <span>تحديث الحالة الآن</span>
                  )}
                </button>
                {statusMessage && (
                  <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-lg max-w-sm">
                    {statusMessage}
                  </p>
                )}
              </div>
            </div>
          ) : (
            <Suspense fallback={<TabLoadingFallback />}>
              {currentRole === 'employee' ? (
                /* Employee Experience: Dedicated Banking Tracker, Profile, Visas, or Petty Cash Custodies */
                activeTab === 'profile' ? (
                  <ProfileManagement />
                ) : activeTab === 'visas' ? (
                  <VisaManagement />
                ) : activeTab === 'custody' ? (
                  <CustodyManagement />
                ) : (
                  <RequesterTracker 
                    onOpenNewRequest={() => setIsNewRequestModalOpen(true)}
                    onSelectRequest={setSelectedRequest}
                  />
                )
              ) : (
                /* Admin / Super Admin / Data Entry Multi-Tab View */
                <>
                  {activeTab === 'profile' && (
                    <ProfileManagement />
                  )}

                  {activeTab === 'dashboard' && currentRole !== 'data_entry' && (
                    <DashboardAnalytics 
                      onSelectRequest={setSelectedRequest}
                      onOpenNewRequest={() => setIsNewRequestModalOpen(true)}
                    />
                  )}

                  {activeTab === 'requests' && currentRole !== 'data_entry' && (
                    <ExpenseRequestsList 
                      onSelectRequest={setSelectedRequest}
                      onOpenNewRequest={() => setIsNewRequestModalOpen(true)}
                    />
                  )}

                  {activeTab === 'visas' && (
                    <VisaManagement />
                  )}

                  {activeTab === 'my-requests' && (
                    <RequesterTracker 
                      onOpenNewRequest={() => setIsNewRequestModalOpen(true)}
                      onSelectRequest={setSelectedRequest}
                    />
                  )}

                  {activeTab === 'treasury' && (
                    <TreasuryManagement />
                  )}

                  {activeTab === 'custody' && (
                    <CustodyManagement />
                  )}

                  {activeTab === 'services' && (
                    <ServicesManagement />
                  )}

                  {activeTab === 'providers' && (
                    <VendorsManagement />
                  )}

                  {/* Dedicated Users & Employees tab from screenshot */}
                  {activeTab === 'users' && (
                    <UsersManagement />
                  )}

                  {activeTab === 'organizations' && (
                    <OrganizationsManagement initialSection="companies" />
                  )}

                  {/* Dedicated Audit Log tab */}
                  {activeTab === 'audit' && (
                    <OrganizationsManagement initialSection="audit_log" />
                  )}

                  {activeTab === 'settings' && (currentRole === 'org_admin' || currentRole === 'super_admin') && (
                    <SettingsManagement />
                  )}
                </>
              )}
            </Suspense>
          )}
        </main>
      </div>

      {/* Modals (Loaded lazily on-demand when activated) */}
      {isNewRequestModalOpen && (
        <Suspense fallback={null}>
          <NewRequestModal 
            isOpen={isNewRequestModalOpen}
            onClose={() => setIsNewRequestModalOpen(false)}
          />
        </Suspense>
      )}

      {selectedRequest && (
        <Suspense fallback={null}>
          <RequestDetailModal 
            request={selectedRequest}
            onClose={() => setSelectedRequest(null)}
          />
        </Suspense>
      )}

      {isFirebaseModalOpen && (
        <Suspense fallback={null}>
          <FirebaseConfigModal 
            isOpen={isFirebaseModalOpen}
            onClose={closeFirebaseModal}
          />
        </Suspense>
      )}

      {isProfileModalOpen && (
        <Suspense fallback={null}>
          <UserProfileModal 
            isOpen={isProfileModalOpen}
            onClose={() => setIsProfileModalOpen(false)}
          />
        </Suspense>
      )}

      {/* Quick Add Org Modal (Super Admin Only) */}
      {isQuickOrgModalOpen && currentRole === 'super_admin' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl p-6 border border-slate-100 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                <Building2 className="h-4 w-4 text-emerald-600" />
                <span>إضافة شركة / مؤسسة جديدة</span>
              </h3>
              <button 
                onClick={() => setIsQuickOrgModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleQuickAddOrg} className="mt-4 space-y-3 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">اسم المؤسسة أو الشركة *</label>
                <input
                  type="text"
                  required
                  value={newOrgName}
                  onChange={(e) => setNewOrgName(e.target.value)}
                  placeholder="مثال: شركة الرواد للتجارة..."
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">رمز الشركة (اختياري)</label>
                  <input
                    type="text"
                    value={newOrgCode}
                    onChange={(e) => setNewOrgCode(sanitizeCode(e.target.value, 5))}
                    placeholder="RWD (تلقائي إن ترك فارغاً)"
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono uppercase"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">العملة الأساسية</label>
                  <select
                    value={newOrgCurrency}
                    onChange={(e) => setNewOrgCurrency(e.target.value)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                  >
                    {SUPPORTED_CURRENCIES.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">الميزانية السنوية التقديرية (أرقام فقط)</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={newOrgBudget}
                  onKeyDown={(e) => handleNumericKeyDown(e, false)}
                  onChange={(e) => setNewOrgBudget(sanitizeDigitsOnly(e.target.value, 12))}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono"
                />
              </div>

              {quickOrgError && (
                <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 font-bold rounded-xl text-xs flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-rose-600" />
                  <span>{quickOrgError}</span>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setIsQuickOrgModalOpen(false)}
                  disabled={isQuickOrgSubmitting}
                  className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={isQuickOrgSubmitting}
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  {isQuickOrgSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
                  <span>{isQuickOrgSubmitting ? 'جاري التحقق والإنشاء...' : 'حفظ وإنشاء الشركة'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="border-t border-slate-200 bg-white py-4 text-center text-xs text-slate-400">
        نظام إدارة المصروفات والعهد متعدد الشركات © 2026 — بيئة مشفرة ومعزولة مصرفياً
      </footer>

    </div>
  );
};

export function App() {
  return (
    <AppProvider>
      <MainApp />
    </AppProvider>
  );
}

export default App;
