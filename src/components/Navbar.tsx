import React from 'react';
import { useApp } from '../context/AppContext';
import { 
  BarChart3, 
  Receipt, 
  Layers, 
  Users2, 
  Building, 
  Clock3,
  BadgeAlert,
  Building2,
  Settings
} from 'lucide-react';

export const Navbar: React.FC = () => {
  const { activeTab, setActiveTab, requests, activeOrgId, currentRole, currentUser } = useApp();

  // Requests that need attention
  const pendingRequestsCount = requests.filter(r => r.status === 'pending').length;
  
  // My requests count
  const myRequests = requests.filter(r => 
    r.requesterId === currentUser.id || 
    (r.requesterEmail && currentUser.email && r.requesterEmail.toLowerCase() === currentUser.email.toLowerCase())
  );
  const myClarificationCount = myRequests.filter(r => r.status === 'clarification_requested').length;

  // Build nav items dynamically based on role
  const navItems = [];

  if (currentRole === 'employee') {
    navItems.push({
      id: 'my-requests',
      label: '💳 طلباتي ومتابعة التحويلات (InstaPay / البنك)',
      icon: Clock3,
      badge: myClarificationCount > 0 ? (
        <span className="bg-red-100 text-red-700 text-xs px-2 py-0.5 rounded-full font-bold flex items-center gap-1 animate-pulse">
          <BadgeAlert className="h-3 w-3" />
          {myClarificationCount} بحاجة لتوضيح
        </span>
      ) : null,
    });
  } else if (currentRole === 'org_admin') {
    navItems.push(
      {
        id: 'dashboard',
        label: 'لوحة تحكم الشركة والتحليلات',
        icon: BarChart3,
        badge: null,
      },
      {
        id: 'requests',
        label: 'طلبات الموظفين للاعتماد والصرف',
        icon: Receipt,
        badge: pendingRequestsCount > 0 ? (
          <span className="bg-amber-100 text-amber-800 text-xs px-2 py-0.5 rounded-full font-bold">
            {pendingRequestsCount} للاعتماد
          </span>
        ) : null,
      },
      {
        id: 'organizations',
        label: '🏛️ إدارة الشركة والموظفين والعمليات',
        icon: Users2,
        badge: null,
      },
      {
        id: 'services',
        label: 'بنود الصرف والميزانيات',
        icon: Layers,
        badge: null,
      },
      {
        id: 'providers',
        label: 'مقدمي الخدمة والموردين',
        icon: Building,
        badge: null,
      },
      {
        id: 'my-requests',
        label: 'طلباتي الشخصية',
        icon: Clock3,
        badge: null,
      }
    );
  } else if (currentRole === 'data_entry') {
    navItems.push(
      {
        id: 'providers',
        label: 'مقدمي الخدمة والموردين',
        icon: Building,
        badge: null,
      },
      {
        id: 'services',
        label: 'الخدمات وبنود الصرف',
        icon: Layers,
        badge: null,
      },
      {
        id: 'organizations',
        label: '🏛️ مركز الإدارة والتحكم',
        icon: Building2,
        badge: null,
      },
      {
        id: 'my-requests',
        label: 'طلباتي الشخصية',
        icon: Clock3,
        badge: null,
      }
    );
  } else {
    // super_admin
    navItems.push(
      {
        id: 'dashboard',
        label: 'لوحة التحكم والتحليلات العامة',
        icon: BarChart3,
        badge: null,
      },
      {
        id: 'requests',
        label: 'سجل طلبات المصروفات',
        icon: Receipt,
        badge: pendingRequestsCount > 0 ? (
          <span className="bg-amber-100 text-amber-800 text-xs px-2 py-0.5 rounded-full font-bold">
            {pendingRequestsCount} بانتظار الإجراء
          </span>
        ) : null,
      },
      {
        id: 'organizations',
        label: '🏛️ مركز الإدارة والتحكم الشامل',
        icon: Building2,
        badge: null,
      },
      {
        id: 'services',
        label: 'الخدمات وبنود الصرف',
        icon: Layers,
        badge: null,
      },
      {
        id: 'providers',
        label: 'مقدمي الخدمة والموردين',
        icon: Building,
        badge: null,
      },
      {
        id: 'my-requests',
        label: 'تتبع الطلبات الفردية',
        icon: Clock3,
        badge: null,
      }
    );
  }

  // Always append Settings tab
  navItems.push({
    id: 'settings',
    label: '⚙️ الإعدادات والإشعارات',
    icon: Settings,
    badge: null,
  });

  return (
    <nav className="bg-white border-b border-slate-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex space-x-reverse space-x-1 overflow-x-auto py-2 scrollbar-none">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition cursor-pointer whitespace-nowrap ${
                  isActive
                    ? 'bg-emerald-50 text-emerald-800 shadow-xs border border-emerald-200/60'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                }`}
              >
                <Icon className={`h-4 w-4 ${isActive ? 'text-emerald-600' : 'text-slate-400'}`} />
                <span>{item.label}</span>
                {item.badge}
              </button>
            );
          })}
        </div>
      </div>
    </nav>
  );
};
