import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { 
  Building2, 
  Plus, 
  UserCheck, 
  RotateCcw, 
  ChevronDown, 
  FilePlus, 
  Wallet,
  ShieldAlert,
  User as UserIcon,
  Flame,
  LogOut
} from 'lucide-react';

interface HeaderProps {
  onOpenNewRequest: () => void;
  onOpenNewOrg: () => void;
}

export const Header: React.FC<HeaderProps> = ({ onOpenNewRequest, onOpenNewOrg }) => {
  const { 
    organizations, 
    activeOrgId, 
    activeOrg, 
    setActiveOrgId, 
    currentRole, 
    setCurrentRole, 
    currentUser,
    firebaseUser,
    signInWithGoogle,
    logoutUser,
    refreshData,
    requests,
    isBackendConnected,
    isFirebaseConnected,
    openFirebaseModal,
  } = useApp();

  const [isAuthProcessing, setIsAuthProcessing] = useState(false);

  const handleGoogleSignIn = async () => {
    setIsAuthProcessing(true);
    try {
      await signInWithGoogle();
    } catch (err: any) {
      if (err?.code !== 'auth/popup-closed-by-user') {
        console.error('[Google Sign-In Error]', err);
      }
    } finally {
      setIsAuthProcessing(false);
    }
  };

  const handleLogout = async () => {
    setIsAuthProcessing(true);
    try {
      await logoutUser();
    } catch (err) {
      console.error('[Logout Error]', err);
    } finally {
      setIsAuthProcessing(false);
    }
  };



  const [showOrgDropdown, setShowOrgDropdown] = useState(false);

  // Count pending actions for badge
  const pendingCount = requests.filter(r => 
    (activeOrgId === 'all' || r.orgId === activeOrgId) && 
    (r.status === 'pending' || r.status === 'clarification_requested')
  ).length;

  return (
    <header className="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-xs">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-18">
          
          {/* Logo & System Title */}
          <div className="flex items-center gap-4">
            <div className="h-11 w-11 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-500 flex items-center justify-center text-white shadow-md shadow-emerald-500/20">
              <Wallet className="h-6 w-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-xl tracking-tight text-slate-900">مصروفي</span>
                <span className="text-xs bg-emerald-50 text-emerald-700 font-semibold px-2 py-0.5 rounded-full border border-emerald-200">
                  نظام إدارة المصروفات والعهد
                </span>
              </div>
              <p className="text-xs text-slate-500">إدارة متعددة المؤسسات، تتبع الصرف، وتحليلات مالية متقدمة</p>
            </div>
          </div>

          {/* Org Switcher & Role Simulator & Actions */}
          <div className="flex items-center gap-3">
            
            {/* Organization Selector */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowOrgDropdown(!showOrgDropdown)}
                className="flex items-center gap-2.5 px-3.5 py-2 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-800 text-sm font-medium transition cursor-pointer"
              >
                <Building2 className="h-4 w-4 text-emerald-600" />
                <span>{activeOrgId === 'all' ? 'جميع المؤسسات' : (activeOrg?.name || 'اختر مؤسسة')}</span>
                <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
              </button>

              {showOrgDropdown && (
                <div 
                  className="absolute left-0 mt-2 w-72 bg-white rounded-xl shadow-xl border border-slate-100 py-2 z-50 animate-in fade-in slide-in-from-top-2 duration-150"
                  onClick={() => setShowOrgDropdown(false)}
                >
                  <div className="px-3 py-1.5 text-xs font-semibold text-slate-400 uppercase tracking-wider">
                    المؤسسات المتاحة
                  </div>
                  
                  <button
                    type="button"
                    onClick={() => setActiveOrgId('all')}
                    className={`w-full text-right px-3 py-2 text-sm flex items-center justify-between hover:bg-slate-50 ${
                      activeOrgId === 'all' ? 'text-emerald-600 font-bold bg-emerald-50/50' : 'text-slate-700'
                    }`}
                  >
                    <span>عرض موحد (جميع المؤسسات)</span>
                    {activeOrgId === 'all' && <span className="h-2 w-2 rounded-full bg-emerald-500"></span>}
                  </button>

                  <div className="my-1 border-t border-slate-100"></div>

                  {organizations.map((org) => (
                    <button
                      key={org.id}
                      type="button"
                      onClick={() => setActiveOrgId(org.id)}
                      className={`w-full text-right px-3 py-2 text-sm flex items-center justify-between hover:bg-slate-50 ${
                        activeOrgId === org.id ? 'text-emerald-600 font-bold bg-emerald-50/50' : 'text-slate-700'
                      }`}
                    >
                      <div>
                        <div className="font-medium">{org.name}</div>
                        <div className="text-xs text-slate-400">{org.code} • الميزانية: {org.budget.toLocaleString()} {org.currency}</div>
                      </div>
                      {activeOrgId === org.id && <span className="h-2 w-2 rounded-full bg-emerald-500"></span>}
                    </button>
                  ))}

                  <div className="my-1 border-t border-slate-100"></div>
                  
                  <button
                    type="button"
                    onClick={onOpenNewOrg}
                    className="w-full text-right px-3 py-2 text-xs font-semibold text-emerald-600 hover:bg-emerald-50 flex items-center gap-1.5"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>إضافة مؤسسة جديدة</span>
                  </button>
                </div>
              )}
            </div>

            {/* Role Simulation Switcher */}
            <div className="flex items-center bg-slate-100 p-1 rounded-xl border border-slate-200">
              <button
                type="button"
                onClick={() => setCurrentRole('org_admin')}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg transition ${
                  currentRole === 'org_admin'
                    ? 'bg-white text-indigo-700 shadow-xs border border-indigo-100'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
                title="التبديل لدور مدير المؤسسة للتحكم والاعتماد والصرف"
              >
                <ShieldAlert className="h-3.5 w-3.5 text-indigo-600" />
                <span>مدير المؤسسة</span>
                {pendingCount > 0 && currentRole === 'org_admin' && (
                  <span className="bg-amber-500 text-white text-[10px] px-1.5 py-0.2 rounded-full">
                    {pendingCount}
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={() => setCurrentRole('employee')}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg transition ${
                  currentRole === 'employee'
                    ? 'bg-white text-emerald-700 shadow-xs border border-emerald-100'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
                title="التبديل لدور الموظف لطلب المصروف ومتابعة الصرف"
              >
                <UserIcon className="h-3.5 w-3.5 text-emerald-600" />
                <span>طالب الصرف / الموظف</span>
              </button>
            </div>

            {/* Google Authentication Section */}
            {firebaseUser ? (
              <div className="flex items-center gap-2.5 px-3 py-1.5 rounded-xl border border-slate-200 bg-slate-50/90 shadow-xs">
                {firebaseUser.photoURL ? (
                  <img
                    src={firebaseUser.photoURL}
                    alt={firebaseUser.displayName || 'Google User'}
                    className="h-8 w-8 rounded-full object-cover ring-2 ring-emerald-500/30"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="h-8 w-8 rounded-full bg-emerald-600 text-white flex items-center justify-center font-bold text-xs shadow-xs">
                    {(firebaseUser.displayName || firebaseUser.email || 'U').slice(0, 2).toUpperCase()}
                  </div>
                )}
                <div className="text-right flex flex-col justify-center leading-tight">
                  <span className="font-bold text-xs text-slate-900 max-w-[130px] truncate">
                    {firebaseUser.displayName || currentUser.name}
                  </span>
                  <span className="text-[10px] text-slate-500 max-w-[130px] truncate" title={firebaseUser.email || ''}>
                    {firebaseUser.email}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleLogout}
                  disabled={isAuthProcessing}
                  className="mr-1 flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-rose-600 hover:text-rose-700 bg-rose-50 hover:bg-rose-100 rounded-lg border border-rose-200/60 transition cursor-pointer disabled:opacity-50"
                  title="تسجيل الخروج من حساب Google"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  <span>تسجيل الخروج</span>
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={handleGoogleSignIn}
                disabled={isAuthProcessing}
                className="flex items-center gap-2 px-3 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300 text-slate-700 text-xs font-bold shadow-xs hover:shadow transition cursor-pointer active:scale-98 disabled:opacity-60"
                title="تسجيل الدخول بحساب Google لمزامنة الحساب والصلاحيات"
              >
                <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
                </svg>
                <span>تسجيل الدخول بحساب Google</span>
              </button>
            )}

            {/* Firebase Real-Time Status Badge */}
            {isFirebaseConnected ? (
              <button
                type="button"
                onClick={openFirebaseModal}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 shadow-xs transition cursor-pointer"
                title="متصل بقاعدة بيانات Cloud Firestore السحابية — انقر لتعديل الإعدادات"
              >
                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></span>
                <span>🔥 Firebase متصل</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={openFirebaseModal}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-800 shadow-xs transition cursor-pointer hover:scale-102"
                title="ربط التطبيق بقاعدة بيانات Google Cloud Firestore للمزامنة الفورية"
              >
                <Flame className="h-3.5 w-3.5 text-amber-600 animate-pulse" />
                <span>🔥 ربط Firebase</span>
              </button>
            )}

            {/* Local Server Fallback Badge (shown when Firebase is not connected) */}
            {!isFirebaseConnected && (
              <div 
                className={`hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border ${
                  isBackendConnected 
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200' 
                    : 'bg-indigo-50 text-indigo-700 border-indigo-200'
                }`}
                title={isBackendConnected ? 'النظام متصل بقاعدة البيانات SQLite' : 'النظام يعمل بوضع التخزين السحابي المرن (Vercel Ready)'}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${isBackendConnected ? 'bg-emerald-500' : 'bg-indigo-500'}`}></span>
                <span>{isBackendConnected ? 'خادم متصل' : 'تخزين محلي (Local)'}</span>
              </div>
            )}


            {/* Refresh Data */}
            <button
              type="button"
              onClick={refreshData}
              title="تحديث البيانات"
              className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition cursor-pointer"
            >
              <RotateCcw className="h-4 w-4" />
            </button>


            {/* New Request Button */}
            <button
              type="button"
              onClick={() => {
                if (organizations.length === 0) {
                  onOpenNewOrg();
                } else {
                  onOpenNewRequest();
                }
              }}
              className="flex items-center gap-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-bold text-sm px-4 py-2 rounded-xl shadow-md shadow-emerald-600/20 transition cursor-pointer active:scale-98"
            >
              <FilePlus className="h-4 w-4" />
              <span>طلب صرف جديد</span>
            </button>

          </div>
        </div>
      </div>
    </header>
  );
};
