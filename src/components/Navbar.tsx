import React from 'react';
import { useApp } from '../context/AppContext';
import { 
  BarChart3, 
  Receipt, 
  Layers, 
  Users2, 
  Building, 
  Clock3,
  BadgeAlert
} from 'lucide-react';

export const Navbar: React.FC = () => {
  const { activeTab, setActiveTab, requests, activeOrgId, currentRole, currentUser } = useApp();

  // Requests that need attention
  const filteredRequests = requests.filter(r => activeOrgId === 'all' || r.orgId === activeOrgId);
  const pendingRequestsCount = filteredRequests.filter(r => r.status === 'pending').length;
  
  // My requests count
  const myRequests = requests.filter(r => r.requesterId === currentUser.id);
  const myClarificationCount = myRequests.filter(r => r.status === 'clarification_requested').length;

  const navItems = [
    {
      id: 'dashboard',
      label: 'لوحة التحكم والتحليلات',
      icon: BarChart3,
      badge: null,
    },
    {
      id: 'requests',
      label: 'سجل طلبات المصروفات',
      icon: Receipt,
      badge: pendingRequestsCount > 0 && currentRole === 'org_admin' ? (
        <span className="bg-amber-100 text-amber-800 text-xs px-2 py-0.5 rounded-full font-bold">
          {pendingRequestsCount} للاعتماد
        </span>
      ) : null,
    },
    {
      id: 'my-requests',
      label: 'تتبع طلباتي (شاشة الموظف)',
      icon: Clock3,
      badge: myClarificationCount > 0 ? (
        <span className="bg-red-100 text-red-700 text-xs px-2 py-0.5 rounded-full font-bold flex items-center gap-1 animate-pulse">
          <BadgeAlert className="h-3 w-3" />
          {myClarificationCount} بحاجة لتوضيح
        </span>
      ) : null,
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
      id: 'organizations',
      label: 'المؤسسات والأعضاء',
      icon: Users2,
      badge: null,
    },
  ];

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
