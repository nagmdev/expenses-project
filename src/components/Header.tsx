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
  Crown,
  Bell,
  Menu,
  X
} from 'lucide-react';

interface HeaderProps {
  onOpenNewRequest: () => void;
  onOpenNewOrg: () => void;
  onOpenProfile?: () => void;
  onToggleSidebar?: () => void;
}

export const Header: React.FC<HeaderProps> = ({ 
  onOpenNewRequest, 
  onOpenNewOrg, 
  onOpenProfile,
  onToggleSidebar 
}) => {
  const { 
    organizations, 
    activeOrgId, 
    activeOrg, 
    setActiveOrgId, 
    setActiveTab,
    currentRole, 
    currentUser,
    firebaseUser,
    logoutUser,
    refreshData,
    requests,
    isFirebaseConnected,
    openFirebaseModal,
  } = useApp();

  const [isAuthProcessing, setIsAuthProcessing] = useState(false);
  const [showOrgDropdown, setShowOrgDropdown] = useState(false);
  const [showUserDropdown, setShowUserDropdown] = useState(false);

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
    r.status === 'pending' || r.status === 'clarification_requested'
  ).length;

  return (
    <header className="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-xs">
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-18">
          
          {/* Right Section (in RTL): Logo and Title */}
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-500 flex items-center justify-center text-white shadow-md shadow-emerald-500/20">
              <Wallet className="h-5 w-5" />
            </div>
            <div>
              <span className="font-extrabold text-lg tracking-tight text-slate-900 block leading-tight">مصروفي</span>
              <p className="text-[11px] text-slate-500 font-medium leading-none mt-0.5">نظام إدارة المصروفات والعهد</p>
            </div>
          </div>

          {/* Center-Right Section: Organization Selector with embedded Hamburger Menu matching screenshot */}
          <div className="flex items-center">
            <div className="relative">
              <div className="flex items-center bg-white border border-slate-200 rounded-2xl p-1 shadow-2xs hover:border-slate-300 transition">
                {/* Dropdown Toggle trigger */}
                <button
                  type="button"
                  onClick={() => setShowOrgDropdown(!showOrgDropdown)}
                  className="flex items-center gap-2 px-3 py-1 cursor-pointer"
                  title="اختر الشركة / المؤسسة"
                >
                  <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
                  <div className="text-center">
                    <span className="block font-bold text-xs text-slate-900 leading-tight">
                      {activeOrgId === 'all' ? 'جميع المؤسسات' : (activeOrg?.name || 'Tie-Tanta')}
                    </span>
                    <span className="block text-[10px] text-slate-400 font-medium leading-none mt-0.5">
                      (Dropdown)
                    </span>
                  </div>
                  <div className="h-7 w-7 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
                    <Building2 className="h-4 w-4" />
                  </div>
                </button>

                {/* Vertical Divider */}
                <div className="h-6 w-[1px] bg-slate-200 mx-1"></div>

                {/* Sidebar toggle button inside the box */}
                {onToggleSidebar && (
                  <button
                    type="button"
                    onClick={onToggleSidebar}
                    className="p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-xl transition cursor-pointer"
                    title="القائمة الجانبية"
                  >
                    <Menu className="h-4 w-4" />
                  </button>
                )}
              </div>

              {/* Organization Dropdown Popup */}
              {showOrgDropdown && currentRole === 'super_admin' && (
                <div 
                  className="absolute right-0 mt-2 w-72 bg-white rounded-2xl shadow-xl border border-slate-100 py-2 z-50 animate-in fade-in slide-in-from-top-2 duration-150 text-right"
                  onClick={() => setShowOrgDropdown(false)}
                >
                  <div className="px-3 py-1.5 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                    الشركات المتاحة للسوبر أدمن
                  </div>
                  
                  <button
                    type="button"
                    onClick={() => setActiveOrgId('all')}
                    className={`w-full text-right px-3 py-2 text-xs flex items-center justify-between hover:bg-slate-50 cursor-pointer ${
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
                      className={`w-full text-right px-3 py-2 text-xs flex items-center justify-between hover:bg-slate-50 cursor-pointer ${
                        activeOrgId === org.id ? 'text-emerald-600 font-bold bg-emerald-50/50' : 'text-slate-700'
                      }`}
                    >
                      <div>
                        <div className="font-bold text-slate-800">{org.name}</div>
                        <div className="text-[10px] text-slate-400 font-mono">{org.code} • الميزانية: {org.budget.toLocaleString()} {org.currency}</div>
                      </div>
                      {activeOrgId === org.id && <span className="h-2 w-2 rounded-full bg-emerald-500"></span>}
                    </button>
                  ))}

                  <div className="my-1 border-t border-slate-100"></div>
                  
                  <button
                    type="button"
                    onClick={onOpenNewOrg}
                    className="w-full text-right px-3 py-2 text-xs font-bold text-emerald-600 hover:bg-emerald-50 flex items-center gap-1.5 cursor-pointer"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>إضافة مؤسسة جديدة</span>
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Left Section (in RTL): Bell & New Request Button */}
          <div className="flex items-center gap-3">
            {/* Notification Bell */}
            <button
              type="button"
              onClick={() => setActiveTab('requests')}
              className="relative px-3 py-2 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-50 transition cursor-pointer flex items-center gap-2 text-xs font-bold shadow-2xs"
              title="التنبيهات والطلبات"
            >
              <div className="relative">
                <Bell className="h-4 w-4 text-slate-500" />
                <span className="absolute -top-1.5 -left-1.5 h-4 min-w-[16px] px-1 rounded-full bg-rose-500 text-white text-[9px] font-black flex items-center justify-center">
                  {pendingCount > 0 ? pendingCount : 1}
                </span>
              </div>
              <span>الجرس</span>
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
              className="flex items-center gap-1.5 bg-[#0d9488] hover:bg-[#0f766e] text-white font-bold text-xs sm:text-sm px-4 py-2 rounded-xl shadow-xs transition cursor-pointer active:scale-98"
            >
              <Plus className="h-4 w-4 stroke-[2.5]" />
              <span>طلب صرف جديد</span>
            </button>
          </div>

        </div>
      </div>
    </header>
  );
};
