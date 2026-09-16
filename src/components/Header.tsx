import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { 
  Building2, 
  Plus, 
  RotateCcw, 
  ChevronDown, 
  FilePlus, 
  Wallet,
  ShieldAlert,
  User as UserIcon,
  Flame,
  LogOut,
  Crown
} from 'lucide-react';

interface HeaderProps {
  onOpenNewRequest: () => void;
  onOpenNewOrg: () => void;
  onOpenProfile?: () => void;
}

export const Header: React.FC<HeaderProps> = ({ onOpenNewRequest, onOpenNewOrg, onOpenProfile }) => {
  const { 
    organizations, 
    activeOrgId, 
    activeOrg, 
    setActiveOrgId, 
    currentRole, 
    currentUser,
    firebaseUser,
    logoutUser,
    refreshData,
    requests,
    isBackendConnected,
    isFirebaseConnected,
    openFirebaseModal,
  } = useApp();

  const [isAuthProcessing, setIsAuthProcessing] = useState(false);
  const [showOrgDropdown, setShowOrgDropdown] = useState(false);

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
              <p className="text-xs text-slate-500">إدارة متعددة المؤسسات، تتبع الصرف، وعزل بيانات بنكي 100%</p>
            </div>
          </div>

          {/* Org Switcher & Official Role Badge & Actions */}
          <div className="flex items-center gap-3">
            
            {/* Organization Selector (Visible ONLY to Super Admin) */}
            {currentRole === 'super_admin' ? (
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
                      الشركات المتاحة للسوبر أدمن
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
                      className="w-full text-right px-3 py-2 text-xs font-semibold text-emerald-600 hover:bg-emerald-50 flex items-center gap-1.5 cursor-pointer"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      <span>إضافة مؤسسة جديدة</span>
                    </button>
                  </div>
                )}
              </div>
            ) : (
              /* For Org Admin and Employee: strictly locked label to their company */
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl border border-slate-200 bg-slate-50 text-slate-800 text-xs font-bold shadow-2xs">
                <Building2 className="h-4 w-4 text-emerald-600" />
                <span>{activeOrg?.name || 'الشركة التابع لها'}</span>
              </div>
            )}

            {/* Official Role Badge */}
            {currentRole === 'super_admin' && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 text-amber-900 border border-amber-300 rounded-xl text-xs font-black shadow-2xs">
                <Crown className="h-4 w-4 text-amber-600" />
                <span>🛡️ سوبر أدمن المنصة</span>
              </div>
            )}

            {currentRole === 'org_admin' && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 text-indigo-900 border border-indigo-200 rounded-xl text-xs font-bold shadow-2xs">
                <ShieldAlert className="h-4 w-4 text-indigo-600" />
                <span>🏢 مدير الشركة</span>
                {pendingCount > 0 && (
                  <span className="bg-amber-500 text-white text-[10px] px-1.5 py-0.2 rounded-full font-black">
                    {pendingCount}
                  </span>
                )}
              </div>
            )}

            {currentRole === 'employee' && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 text-emerald-900 border border-emerald-200 rounded-xl text-xs font-bold shadow-2xs">
                <UserIcon className="h-4 w-4 text-emerald-600" />
                <span>👤 موظف</span>
              </div>
            )}

            {/* Authenticated User Profile & Logout */}
            {firebaseUser && (
              <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl border border-slate-200 bg-slate-50/90 hover:bg-slate-100 shadow-2xs transition">
                <button
                  type="button"
                  onClick={onOpenProfile}
                  className="flex items-center gap-2 text-right cursor-pointer group"
                  title="فتح الملف الشخصي وتغيير كلمة المرور"
                >
                  {firebaseUser.photoURL ? (
                    <img
                      src={firebaseUser.photoURL}
                      alt={currentUser.name}
                      className="h-7 w-7 rounded-full object-cover ring-2 ring-emerald-500/30 group-hover:ring-emerald-500 transition"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div className="h-7 w-7 rounded-full bg-emerald-600 group-hover:bg-emerald-700 text-white flex items-center justify-center font-bold text-xs shadow-2xs transition">
                      {(currentUser.name || firebaseUser.email || 'U').slice(0, 2).toUpperCase()}
                    </div>
                  )}
                  <div className="text-right flex flex-col justify-center leading-tight hidden sm:flex">
                    <span className="font-bold text-xs text-slate-900 max-w-[120px] truncate group-hover:text-emerald-700 transition">
                      {currentUser.name}
                    </span>
                    <span className="text-[10px] text-slate-500 max-w-[120px] truncate font-mono">
                      {firebaseUser.email}
                    </span>
                  </div>
                </button>

                <div className="h-4 w-[1px] bg-slate-200 mx-0.5"></div>

                <button
                  type="button"
                  onClick={handleLogout}
                  disabled={isAuthProcessing}
                  className="flex items-center gap-1 px-2 py-1 text-xs font-semibold text-rose-600 hover:text-rose-700 bg-rose-50 hover:bg-rose-100 rounded-lg border border-rose-200/60 transition cursor-pointer disabled:opacity-50"
                  title="تسجيل الخروج من الحساب"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  <span className="hidden md:inline">خروج</span>
                </button>
              </div>
            )}

            {/* Firebase Real-Time Status Badge */}
            {isFirebaseConnected ? (
              <button
                type="button"
                onClick={openFirebaseModal}
                className="hidden lg:flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 shadow-2xs transition cursor-pointer"
                title="متصل بالسحابة المشفرة"
              >
                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></span>
                <span>🔥 متصل سحابياً</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={openFirebaseModal}
                className="hidden lg:flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-800 shadow-2xs transition cursor-pointer"
              >
                <Flame className="h-3.5 w-3.5 text-amber-600 animate-pulse" />
                <span>إعداد Firebase</span>
              </button>
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
                if (organizations.length === 0 && currentRole === 'super_admin') {
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
