import React from 'react';
import { useApp } from '../context/AppContext';
import { 
  LayoutDashboard, 
  Receipt, 
  Briefcase, 
  CreditCard, 
  Users, 
  Building2, 
  Layers, 
  Truck, 
  FileText, 
  Settings, 
  Clock3, 
  UserCheck, 
  User as UserIcon,
  Plane,
  X
} from 'lucide-react';

interface SidebarProps {
  isOpen?: boolean;
  onClose?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ isOpen = true, onClose }) => {
  const { 
    activeTab, 
    setActiveTab, 
    requests, 
    currentRole, 
    currentUser, 
    firebaseUser 
  } = useApp();

  const pendingRequestsCount = requests.filter(r => r.status === 'pending').length;

  const isSuperOrOrgAdmin = currentRole === 'super_admin' || currentRole === 'org_admin';

  return (
    <>
      {/* Mobile Backdrop */}
      {isOpen && onClose && (
        <div 
          onClick={onClose} 
          className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs z-40 lg:hidden"
        />
      )}

      {/* Sidebar Container (Sticky on Desktop, Slide-in on Mobile) */}
      <aside className={`
        fixed top-0 bottom-0 right-0 z-50 w-64 bg-white border-l border-slate-200 
        transition-transform duration-200 ease-in-out flex flex-col justify-between
        lg:static lg:z-10 lg:translate-x-0
        ${isOpen ? 'translate-x-0' : 'translate-x-full lg:translate-x-0'}
      `}>
        <div className="flex-1 overflow-y-auto py-5 px-3 space-y-4">
          
          {/* Mobile Header / Close Button */}
          <div className="flex items-center justify-between pb-2 border-b border-slate-100 lg:hidden">
            <span className="font-extrabold text-sm text-slate-800">القائمة الرئيسية</span>
            {onClose && (
              <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:bg-slate-100">
                <X className="h-5 w-5" />
              </button>
            )}
          </div>

          {/* User Profile Card at Top of Sidebar — clickable to open Profile page */}
          <button
            type="button"
            onClick={() => { setActiveTab('profile'); onClose?.(); }}
            className="w-full bg-slate-50/80 p-3 rounded-2xl border border-slate-200/60 flex items-center justify-between gap-3 hover:bg-slate-100/80 transition cursor-pointer text-right"
            title="فتح الملف الشخصي"
          >
            <div className="flex items-center gap-2.5">
              <div className="relative">
                <div className="h-9 w-9 rounded-full bg-slate-200 text-slate-700 flex items-center justify-center font-bold text-xs">
                  <UserIcon className="h-4 w-4 text-slate-600" />
                </div>
                <span className="absolute bottom-0 right-0 h-2 w-2 rounded-full bg-emerald-500 ring-2 ring-white"></span>
              </div>
              <div>
                <div className="font-bold text-xs text-slate-900 leading-tight">
                  {currentUser.name} {currentRole === 'super_admin' ? '(Super)' : ''}
                </div>
                <div className="text-[10px] text-slate-500 font-semibold leading-tight mt-0.5">
                  {currentRole === 'super_admin' ? 'مشرف عام' :
                   currentRole === 'org_admin' ? 'مدير شركة' :
                   currentRole === 'finance' ? 'مسؤول مالي' : 'موظف'}
                </div>
              </div>
            </div>
            <span className="h-2 w-2 rounded-full bg-emerald-500 shrink-0"></span>
          </button>

          {/* Nav Item Component */}
          {currentRole === 'employee' ? (
            /* Employee Navigation */
            <div className="space-y-1">
              <button
                type="button"
                onClick={() => { setActiveTab('my-requests'); onClose?.(); }}
                className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                  activeTab === 'my-requests'
                    ? 'bg-slate-100 text-slate-900 shadow-2xs font-extrabold'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <Clock3 className="h-4 w-4 text-slate-500" />
                  <span>طلباتي ومتابعة الصرف</span>
                </div>
              </button>

              <button
                type="button"
                onClick={() => { setActiveTab('custody'); onClose?.(); }}
                className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                  activeTab === 'custody'
                    ? 'bg-slate-100 text-slate-900 shadow-2xs font-extrabold'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <Briefcase className="h-4 w-4 text-slate-500" />
                  <span>عُهدي النقدية وتصفيتها</span>
                </div>
              </button>

              <button
                type="button"
                onClick={() => { setActiveTab('visas'); onClose?.(); }}
                className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                  activeTab === 'visas'
                    ? 'bg-slate-100 text-slate-900 shadow-2xs font-extrabold'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <Plane className="h-4 w-4 text-slate-500" />
                  <span>طلبات وإصدار التأشيرات</span>
                </div>
              </button>

              <button
                type="button"
                onClick={() => { setActiveTab('profile'); onClose?.(); }}
                className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                  activeTab === 'profile'
                    ? 'bg-slate-100 text-slate-900 shadow-2xs font-extrabold'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <UserCheck className="h-4 w-4 text-slate-500" />
                  <span>بياناتي وحساباتي البنكية</span>
                </div>
              </button>
            </div>
          ) : (
            /* Admin / Finance / Super Admin Navigation */
            <div className="space-y-4">
              
              {/* Group 1: العمليات الأساسية */}
              <div>
                <div className="px-3 py-1 mb-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    العمليات الأساسية
                  </span>
                </div>
                <div className="space-y-0.5">
                  {/* 1. Dashboard */}
                  <button
                    type="button"
                    onClick={() => { setActiveTab('dashboard'); onClose?.(); }}
                    className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                      activeTab === 'dashboard'
                        ? 'bg-slate-100 text-slate-900 shadow-2xs font-extrabold'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <LayoutDashboard className="h-4 w-4 text-slate-500" />
                      <span>لوحة المؤشرات</span>
                    </div>
                  </button>

                  {/* 2. All Requests */}
                  <button
                    type="button"
                    onClick={() => { setActiveTab('requests'); onClose?.(); }}
                    className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                      activeTab === 'requests'
                        ? 'bg-slate-100 text-slate-900 shadow-2xs font-extrabold'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <Receipt className="h-4 w-4 text-slate-500" />
                      <span>طلبات الصرف</span>
                    </div>
                    {pendingRequestsCount > 0 && (
                      <span className="bg-slate-200 text-slate-700 text-[10px] font-mono px-2 py-0.5 rounded-full font-bold">
                        {pendingRequestsCount}
                      </span>
                    )}
                  </button>

                  {/* 3. My Requests */}
                  <button
                    type="button"
                    onClick={() => { setActiveTab('my-requests'); onClose?.(); }}
                    className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                      activeTab === 'my-requests'
                        ? 'bg-slate-100 text-slate-900 shadow-2xs font-extrabold'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <Clock3 className="h-4 w-4 text-slate-500" />
                      <span>طلباتي ومتابعة الصرف</span>
                    </div>
                  </button>

                  {/* 4. Custody */}
                  <button
                    type="button"
                    onClick={() => { setActiveTab('custody'); onClose?.(); }}
                    className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                      activeTab === 'custody'
                        ? 'bg-slate-100 text-slate-900 shadow-2xs font-extrabold'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <Briefcase className="h-4 w-4 text-slate-500" />
                      <span>العهد النقدية</span>
                    </div>
                  </button>

                  {/* 5. Treasury */}
                  <button
                    type="button"
                    onClick={() => { setActiveTab('treasury'); onClose?.(); }}
                    className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                      activeTab === 'treasury'
                        ? 'bg-slate-100 text-slate-900 shadow-2xs font-extrabold'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <CreditCard className="h-4 w-4 text-slate-500" />
                      <span>الخزائن وحسابات الدفع</span>
                    </div>
                  </button>

                  {/* 6. Visa Requests & Expense Ledger */}
                  <button
                    type="button"
                    onClick={() => { setActiveTab('visas'); onClose?.(); }}
                    className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                      activeTab === 'visas'
                        ? 'bg-slate-100 text-slate-900 shadow-2xs font-extrabold'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <Plane className="h-4 w-4 text-slate-500" />
                      <span>طلبات وإصدار التأشيرات</span>
                    </div>
                  </button>
                </div>
              </div>

              {/* Group 2: الإدارة */}
              <div>
                <div className="px-3 py-1 mb-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    الإدارة
                  </span>
                </div>
                <div className="space-y-0.5">
                  {/* 6. Users & Employees */}
                  <button
                    type="button"
                    onClick={() => { setActiveTab('users'); onClose?.(); }}
                    className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                      activeTab === 'users'
                        ? 'bg-slate-100 text-slate-900 shadow-2xs font-extrabold'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <Users className="h-4 w-4 text-slate-700" />
                      <span>المستخدمون والموظفون</span>
                    </div>
                  </button>

                  {/* 7. Companies & Organizations */}
                  <button
                    type="button"
                    onClick={() => { setActiveTab('organizations'); onClose?.(); }}
                    className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                      activeTab === 'organizations'
                        ? 'bg-slate-100 text-slate-900 shadow-2xs font-extrabold'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <Building2 className="h-4 w-4 text-slate-500" />
                      <span>الشركات والمؤسسات</span>
                    </div>
                  </button>

                  {/* 8. Services & Expense Bands */}
                  <button
                    type="button"
                    onClick={() => { setActiveTab('services'); onClose?.(); }}
                    className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                      activeTab === 'services'
                        ? 'bg-slate-100 text-slate-900 shadow-2xs font-extrabold'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <Layers className="h-4 w-4 text-slate-500" />
                      <span>بنود ومراكز الصرف</span>
                    </div>
                  </button>

                  {/* 9. Vendors & Providers */}
                  <button
                    type="button"
                    onClick={() => { setActiveTab('providers'); onClose?.(); }}
                    className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                      activeTab === 'providers'
                        ? 'bg-slate-100 text-slate-900 shadow-2xs font-extrabold'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <Truck className="h-4 w-4 text-slate-500" />
                      <span>الموردين ومقدمي الخدمات</span>
                    </div>
                  </button>
                </div>
              </div>

              {/* Group 3: النظام والحساب */}
              <div>
                <div className="px-3 py-1 mb-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    النظام والحساب
                  </span>
                </div>
                <div className="space-y-0.5">
                  {/* 10. Profile — 🟡 FIX: Now visible for ALL roles */}
                  <button
                    type="button"
                    onClick={() => { setActiveTab('profile'); onClose?.(); }}
                    className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                      activeTab === 'profile'
                        ? 'bg-slate-100 text-slate-900 shadow-2xs font-extrabold'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <UserCheck className="h-4 w-4 text-slate-500" />
                      <span>الملف الشخصي وبيانات الحساب</span>
                    </div>
                  </button>

                  {/* 11. Audit Logs */}
                  {isSuperOrOrgAdmin && (
                    <button
                      type="button"
                      onClick={() => { setActiveTab('audit'); onClose?.(); }}
                      className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                        activeTab === 'audit'
                          ? 'bg-slate-100 text-slate-900 shadow-2xs font-extrabold'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <FileText className="h-4 w-4 text-slate-500" />
                        <span>سجل التدقيق والعمليات</span>
                      </div>
                    </button>
                  )}

                  {/* 12. Settings */}
                  {isSuperOrOrgAdmin && (
                    <button
                      type="button"
                      onClick={() => { setActiveTab('settings'); onClose?.(); }}
                      className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                        activeTab === 'settings'
                          ? 'bg-slate-100 text-slate-900 shadow-2xs font-extrabold'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <Settings className="h-4 w-4 text-slate-500" />
                        <span>إعدادات النظام</span>
                      </div>
                    </button>
                  )}
                </div>
              </div>

            </div>
          )}

        </div>

        {/* Sidebar Footer info */}
        <div className="p-3 border-t border-slate-100 text-center">
          <p className="text-[10px] text-slate-400 font-mono">مصروفي v2.5 Enterprise</p>
        </div>
      </aside>
    </>
  );
};
