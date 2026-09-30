import React from 'react';
import { useApp } from '../context/AppContext';
import { Role } from '../types';
import { can, canOpenTab, HOME_TAB } from '../utils/permissions';
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

const ROLE_LABELS: Record<Role, string> = {
  super_admin: 'مشرف عام',
  org_admin: 'مدير شركة',
  finance: 'مسؤول مالي',
  data_entry: 'مدخل بيانات',
  employee: 'موظف',
};

interface NavItem {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: number;
}

export const Sidebar: React.FC<SidebarProps> = ({ isOpen = true, onClose }) => {
  const {
    activeTab,
    setActiveTab,
    requests,
    currentRole,
    currentUser,
  } = useApp();

  // The page actually shown (App.tsx falls back to the role's home page for any other tab).
  const shownTab = canOpenTab(currentRole, activeTab) ? activeTab : HOME_TAB[currentRole];

  const pendingRequestsCount = can(currentRole, 'viewAllRequests')
    ? requests.filter(r => r.status === 'pending').length
    : 0;

  // Roles that see only their own custodies / requests get "my ..." wording.
  const ownCustodyOnly = !can(currentRole, 'viewAllCustodies');
  const isEmployee = currentRole === 'employee';

  // Every page, grouped; each role sees exactly the pages TAB_ACCESS allows it.
  const groups: { title: string; items: NavItem[] }[] = [
    {
      title: 'العمليات الأساسية',
      items: [
        { id: 'dashboard', label: 'لوحة المؤشرات', icon: LayoutDashboard },
        { id: 'requests', label: 'طلبات الصرف', icon: Receipt, badge: pendingRequestsCount },
        { id: 'my-requests', label: 'طلباتي ومتابعة الصرف', icon: Clock3 },
        { id: 'custody', label: ownCustodyOnly ? 'عُهدي النقدية وتصفيتها' : 'العهد النقدية', icon: Briefcase },
        { id: 'treasury', label: 'الخزائن وحسابات الدفع', icon: CreditCard },
        { id: 'visas', label: 'طلبات وإصدار التأشيرات', icon: Plane },
      ],
    },
    {
      title: 'الإدارة',
      items: [
        { id: 'users', label: 'المستخدمون والموظفون', icon: Users },
        {
          id: 'organizations',
          label: can(currentRole, 'manageCompanies') || currentRole === 'org_admin' ? 'الشركات والمؤسسات' : 'الأقسام والهيكل',
          icon: Building2,
        },
        { id: 'services', label: 'بنود ومراكز الصرف', icon: Layers },
        { id: 'providers', label: 'الموردين ومقدمي الخدمات', icon: Truck },
      ],
    },
    {
      title: 'النظام والحساب',
      items: [
        { id: 'profile', label: isEmployee ? 'بياناتي وحساباتي البنكية' : 'الملف الشخصي وبيانات الحساب', icon: UserCheck },
        { id: 'audit', label: 'سجل التدقيق والعمليات', icon: FileText },
        { id: 'settings', label: 'إعدادات النظام', icon: Settings },
      ],
    },
  ]
    .map(group => ({ ...group, items: group.items.filter(item => canOpenTab(currentRole, item.id)) }))
    .filter(group => group.items.length > 0);

  const renderItem = (item: NavItem) => {
    const Icon = item.icon;
    const isActive = shownTab === item.id;
    return (
      <button
        key={item.id}
        type="button"
        onClick={() => { setActiveTab(item.id); onClose?.(); }}
        aria-current={isActive ? 'page' : undefined}
        className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-bold transition cursor-pointer ${
          isActive
            ? 'bg-slate-100 text-slate-900 shadow-2xs font-extrabold'
            : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
        }`}
      >
        <div className="flex items-center gap-2.5">
          <Icon className="h-4 w-4 text-slate-500" />
          <span>{item.label}</span>
        </div>
        {item.badge ? (
          <span className="bg-slate-200 text-slate-700 text-[10px] font-mono px-2 py-0.5 rounded-full font-bold">
            {item.badge}
          </span>
        ) : null}
      </button>
    );
  };

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
              <button onClick={onClose} aria-label="إغلاق القائمة" className="p-1 rounded-lg text-slate-400 hover:bg-slate-100">
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
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="relative shrink-0">
                <div className="h-9 w-9 rounded-full bg-slate-200 text-slate-700 flex items-center justify-center font-bold text-xs">
                  <UserIcon className="h-4 w-4 text-slate-600" />
                </div>
                <span className="absolute bottom-0 right-0 h-2 w-2 rounded-full bg-emerald-500 ring-2 ring-white"></span>
              </div>
              <div className="min-w-0">
                <div className="font-bold text-xs text-slate-900 leading-tight truncate">
                  {currentUser.name}
                </div>
                <div className="text-[10px] text-slate-500 font-semibold leading-tight mt-0.5">
                  {ROLE_LABELS[currentRole] || ROLE_LABELS.employee}
                </div>
              </div>
            </div>
            <span className="h-2 w-2 rounded-full bg-emerald-500 shrink-0"></span>
          </button>

          {isEmployee ? (
            /* Employees: one short flat list */
            <div className="space-y-1">
              {groups.flatMap(group => group.items).map(renderItem)}
            </div>
          ) : (
            <div className="space-y-4">
              {groups.map(group => (
                <div key={group.title}>
                  <div className="px-3 py-1 mb-1">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      {group.title}
                    </span>
                  </div>
                  <div className="space-y-0.5">
                    {group.items.map(renderItem)}
                  </div>
                </div>
              ))}
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
