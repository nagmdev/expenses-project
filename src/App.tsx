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
import { NewRequestModal } from './components/NewRequestModal';
import { RequestDetailModal } from './components/RequestDetailModal';
import { FirebaseConfigModal } from './components/FirebaseConfigModal';
import { ExpenseRequest } from './types';
import { Building2, X, AlertTriangle, Loader2, Wallet } from 'lucide-react';

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
  const [selectedRequest, setSelectedRequest] = useState<ExpenseRequest | null>(null);
  
  // Quick Org modal for super admin
  const [isQuickOrgModalOpen, setIsQuickOrgModalOpen] = useState(false);
  const [newOrgName, setNewOrgName] = useState('');
  const [newOrgCode, setNewOrgCode] = useState('');
  const [newOrgCurrency, setNewOrgCurrency] = useState('SAR');
  const [newOrgBudget, setNewOrgBudget] = useState('500000');

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

    addOrganization({
      name: newOrgName.trim(),
      code: newOrgCode.trim().toUpperCase() || 'NEW',
      currency: newOrgCurrency,
      budget: Number(newOrgBudget) || 0,
      description: 'مؤسسة جديدة أضيفت للنظام.',
    });

    setNewOrgName('');
    setNewOrgCode('');
    setIsQuickOrgModalOpen(false);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col antialiased selection:bg-emerald-100 selection:text-emerald-900">
      
      {/* Top Application Header */}
      <Header 
        onOpenNewRequest={() => setIsNewRequestModalOpen(true)}
        onOpenNewOrg={() => setIsQuickOrgModalOpen(true)}
      />

      {/* Firebase Permission / Connection Alert */}
      {firebaseError && (
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
        {!loading && organizations.length === 0 && currentRole === 'super_admin' ? (
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
        ) : currentRole === 'employee' ? (
          /* Employee Experience: Dedicated Banking Tracker */
          <RequesterTracker 
            onOpenNewRequest={() => setIsNewRequestModalOpen(true)}
            onSelectRequest={setSelectedRequest}
          />
        ) : (
          /* Admin / Super Admin Multi-Tab View */
          <>
            {activeTab === 'dashboard' && (
              <DashboardAnalytics 
                onSelectRequest={setSelectedRequest}
                onOpenNewRequest={() => setIsNewRequestModalOpen(true)}
              />
            )}

            {activeTab === 'requests' && (
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

            {activeTab === 'services' && (
              <ServicesManagement />
            )}

            {activeTab === 'providers' && (
              <VendorsManagement />
            )}

            {activeTab === 'organizations' && (
              <OrganizationsManagement />
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
                  <label className="block font-bold text-slate-700 mb-1">رمز الشركة (Code)</label>
                  <input
                    type="text"
                    required
                    value={newOrgCode}
                    onChange={(e) => setNewOrgCode(e.target.value.toUpperCase())}
                    placeholder="RWD"
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono uppercase"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">العملة</label>
                  <select
                    value={newOrgCurrency}
                    onChange={(e) => setNewOrgCurrency(e.target.value)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                  >
                    <option value="SAR">SAR (ريال سعودي)</option>
                    <option value="EGP">EGP (جنيه مصري)</option>
                    <option value="AED">AED (درهم إماراتي)</option>
                    <option value="USD">USD (دولار أمريكي)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">الميزانية السنوية التقديرية</label>
                <input
                  type="number"
                  min="0"
                  value={newOrgBudget}
                  onChange={(e) => setNewOrgBudget(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setIsQuickOrgModalOpen(false)}
                  className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-xl"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl"
                >
                  حفظ وإنشاء الشركة
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
