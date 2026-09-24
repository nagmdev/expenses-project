import React, { useState } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { LoginPage } from './components/LoginPage';
import { Header } from './components/Header';
import { Navbar } from './components/Navbar';
import { DashboardAnalytics } from './components/DashboardAnalytics';
import { ExpenseRequestsList } from './components/ExpenseRequestsList';
import { RequesterTracker } from './components/RequesterTracker';
import { ServicesManagement } from './components/ServicesManagement';
import { VendorsManagement } from './components/VendorsManagement';
import { OrganizationsManagement } from './components/OrganizationsManagement';
import { TreasuryManagement } from './components/TreasuryManagement';
import { CustodyManagement } from './components/CustodyManagement';
import { NewRequestModal } from './components/NewRequestModal';
import { RequestDetailModal } from './components/RequestDetailModal';
import { FirebaseConfigModal } from './components/FirebaseConfigModal';
import { UserProfileModal } from './components/UserProfileModal';
import { SettingsManagement } from './components/SettingsManagement';
import { ProfileManagement } from './components/ProfileManagement';
import { ExpenseRequest, SUPPORTED_CURRENCIES } from './types';
import { Building2, X, AlertTriangle, Loader2, Wallet } from 'lucide-react';
import { sanitizeDigitsOnly, sanitizeCode, handleNumericKeyDown } from './utils/validation';

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
  } = useApp();

  const [isNewRequestModalOpen, setIsNewRequestModalOpen] = useState(false);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<ExpenseRequest | null>(null);
  
  // Quick Org modal for super admin
  const [isQuickOrgModalOpen, setIsQuickOrgModalOpen] = useState(false);
  const [newOrgName, setNewOrgName] = useState('');
  const [newOrgCode, setNewOrgCode] = useState('');
  const [newOrgCurrency, setNewOrgCurrency] = useState('EGP');
  const [newOrgBudget, setNewOrgBudget] = useState('500000');
  const [isQuickOrgSubmitting, setIsQuickOrgSubmitting] = useState(false);
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

  const handleQuickAddOrg = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newOrgName.trim() || isQuickOrgSubmitting) return;

    setQuickOrgError(null);
    setIsQuickOrgSubmitting(true);

    try {
      const res = await addOrganization({
        name: newOrgName.trim(),
        code: newOrgCode.trim().toUpperCase() || newOrgName.trim().slice(0, 3).toUpperCase() || 'ORG',
        currency: newOrgCurrency,
        budget: Number(newOrgBudget) || 0,
        description: 'مؤسسة جديدة أضيفت للنظام.',
      });

      if (!res.success) {
        setQuickOrgError(res.message || 'تعذر إضافة الشركة.');
        setIsQuickOrgSubmitting(false);
        return;
      }

      setNewOrgName('');
      setNewOrgCode('');
      setQuickOrgError(null);
      setIsQuickOrgModalOpen(false);
    } catch {
      setQuickOrgError('حدث خطأ غير متوقع أثناء إضافة الشركة.');
    } finally {
      setIsQuickOrgSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col antialiased selection:bg-emerald-100 selection:text-emerald-900">
      
      {/* Top Application Header */}
      <Header 
        onOpenNewRequest={() => setIsNewRequestModalOpen(true)}
        onOpenNewOrg={() => setIsQuickOrgModalOpen(true)}
        onOpenProfile={() => setActiveTab('profile')}
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

      {/* Navigation Bar */}
      <Navbar />

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {!loading && organizations.length === 0 && currentRole === 'super_admin' && activeTab === 'dashboard' ? (
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
            <div className="mt-6 flex justify-center">
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-xl transition cursor-pointer"
              >
                تحديث الحالة الآن
              </button>
            </div>
          </div>
        ) : currentRole === 'employee' ? (
          /* Employee Experience: Dedicated Banking Tracker, Profile, or Petty Cash Custodies */
          activeTab === 'profile' ? (
            <ProfileManagement />
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

            {activeTab === 'organizations' && (
              <OrganizationsManagement />
            )}

            {activeTab === 'settings' && (currentRole === 'org_admin' || currentRole === 'super_admin') && (
              <SettingsManagement />
            )}
          </>
        )}
      </main>

      {/* Modals */}
      <NewRequestModal 
        isOpen={isNewRequestModalOpen}
        onClose={() => setIsNewRequestModalOpen(false)}
      />

      <RequestDetailModal 
        request={selectedRequest}
        onClose={() => setSelectedRequest(null)}
      />

      {/* Firebase Cloud Firestore Modal */}
      <FirebaseConfigModal 
        isOpen={isFirebaseModalOpen}
        onClose={closeFirebaseModal}
      />

      {/* User Profile & Password Change Modal */}
      <UserProfileModal 
        isOpen={isProfileModalOpen}
        onClose={() => setIsProfileModalOpen(false)}
      />

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
