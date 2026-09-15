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
  User as UserIcon
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
    refreshData,
    requests
  } = useApp();


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

            {/* User Badge */}
            <div className="hidden lg:flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-slate-100 bg-slate-50/70 text-xs">
              <div className="h-6 w-6 rounded-full bg-slate-200 flex items-center justify-center font-bold text-slate-700 text-[11px]">
                {currentUser.name.slice(0, 2)}
              </div>
              <div>
                <span className="font-semibold text-slate-800">{currentUser.name}</span>
              </div>
            </div>

            {/* Refresh Data */}
            <button
              type="button"
              onClick={refreshData}
              title="تحديث البيانات من الخادم"
              className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition cursor-pointer"
            >
              <RotateCcw className="h-4 w-4" />
            </button>


            {/* New Request Button */}
            <button
              type="button"
              onClick={onOpenNewRequest}
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
