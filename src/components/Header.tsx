import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { ExpenseRequest } from '../types';
import { can } from '../utils/permissions';
import { NotificationsDropdown } from './NotificationsDropdown';
import { useAppNotifications } from '../hooks/useAppNotifications';
import {
  Building2,
  Plus,
  ChevronDown,
  Wallet,
  LogOut,
  Bell,
  Menu
} from 'lucide-react';

interface HeaderProps {
  onOpenNewRequest: () => void;
  onOpenNewOrg: () => void;
  onToggleSidebar?: () => void;
  onSelectRequest?: (req: ExpenseRequest) => void;
}

export const Header: React.FC<HeaderProps> = ({
  onOpenNewRequest,
  onOpenNewOrg,
  onToggleSidebar,
  onSelectRequest,
}) => {
  const {
    organizations,
    activeOrgId,
    activeOrg,
    setActiveOrgId,
    currentRole,
    logoutUser,
    companyChoices,
    switchOwnCompany,
    effectiveOrgId,
  } = useApp();

  const [isAuthProcessing, setIsAuthProcessing] = useState(false);
  const [showOrgDropdown, setShowOrgDropdown] = useState(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [notificationsOpenedAt, setNotificationsOpenedAt] = useState(0);

  // One feed for the badge and the list: the badge is exactly the unread items the panel shows.
  const notificationsFeed = useAppNotifications();
  const unreadCount = notificationsFeed.unreadCount;

  // The platform owner works across companies. Anyone else who belongs to several companies
  // picks the one it works in (its own profile follows: AppContext.switchOwnCompany).
  const canSwitchCompany = can(currentRole, 'manageCompanies');
  const canSwitchOwnCompany = !canSwitchCompany && companyChoices.length > 1;
  const [switchError, setSwitchError] = useState('');
  const handleSwitchOwnCompany = (orgId: string) => {
    if (orgId === effectiveOrgId) return;
    setSwitchError('');
    switchOwnCompany(orgId).catch(err => {
      console.warn('[Company switch]', err?.message || err);
      setSwitchError('تعذر التبديل إلى هذه الشركة. أعد المحاولة.');
    });
  };
  const companyLabel = activeOrgId === 'all' ? 'جميع المؤسسات' : (activeOrg?.name || 'لم يتم تحميل الشركة');

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

  const companyBadge = (
    <>
      <div className="text-center min-w-0">
        <span className="block font-bold text-xs text-slate-900 leading-tight truncate">
          {companyLabel}
        </span>
        {(canSwitchCompany || canSwitchOwnCompany) && (
          <span className="hidden sm:block text-[10px] text-slate-400 font-medium leading-none mt-0.5">
            اضغط لتبديل المؤسسة
          </span>
        )}
        {switchError && <span className="block text-[10px] text-rose-600 font-bold leading-none mt-0.5">{switchError}</span>}
      </div>
      <div className="hidden sm:flex h-7 w-7 rounded-lg bg-emerald-50 text-emerald-600 items-center justify-center shrink-0">
        <Building2 className="h-4 w-4" />
      </div>
    </>
  );

  return (
    <header className="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-xs">
      <div className="w-full px-3 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between gap-2 h-18">

          {/* Right Section (in RTL): Logo and Title */}
          <div className="flex items-center gap-3 shrink-0">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-500 flex items-center justify-center text-white shadow-md shadow-emerald-500/20">
              <Wallet className="h-5 w-5" />
            </div>
            <div className="hidden sm:block">
              <span className="font-extrabold text-lg tracking-tight text-slate-900 block leading-tight">مصروفي</span>
              <p className="text-[11px] text-slate-500 font-medium leading-none mt-0.5">نظام إدارة المصروفات والعهد</p>
            </div>
          </div>

          {/* Center: current company (switchable by the platform owner only) + sidebar toggle on small screens */}
          <div className="flex items-center justify-center min-w-0 flex-1">
            <div className="relative min-w-0 max-w-full">
              <div className="flex items-center bg-white border border-slate-200 rounded-2xl p-1 shadow-2xs hover:border-slate-300 transition min-w-0">
                {canSwitchCompany || canSwitchOwnCompany ? (
                  <button
                    type="button"
                    onClick={() => setShowOrgDropdown(!showOrgDropdown)}
                    className="flex items-center gap-2 px-2 sm:px-3 py-1 cursor-pointer min-w-0"
                    title="اختر الشركة / المؤسسة"
                    aria-haspopup="listbox"
                    aria-expanded={showOrgDropdown}
                  >
                    <ChevronDown className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                    {companyBadge}
                  </button>
                ) : (
                  <div className="flex items-center gap-2 px-2 sm:px-3 py-1 min-w-0" title={companyLabel}>
                    {companyBadge}
                  </div>
                )}

                {/* Sidebar toggle (the sidebar is always visible from the lg breakpoint) */}
                {onToggleSidebar && (
                  <>
                    <div className="h-6 w-[1px] bg-slate-200 mx-1 shrink-0 lg:hidden"></div>
                    <button
                      type="button"
                      onClick={onToggleSidebar}
                      className="p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-xl transition cursor-pointer shrink-0 lg:hidden"
                      title="القائمة الجانبية"
                      aria-label="فتح القائمة الجانبية"
                    >
                      <Menu className="h-4 w-4" />
                    </button>
                  </>
                )}
              </div>

              {/* A member's own companies */}
              {showOrgDropdown && canSwitchOwnCompany && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowOrgDropdown(false)} />
                  <div
                    className="absolute right-0 mt-2 w-64 max-w-[calc(100vw-1.5rem)] bg-white rounded-2xl shadow-xl border border-slate-100 py-2 z-50 animate-in fade-in slide-in-from-top-2 duration-150 text-right max-h-[70vh] overflow-y-auto"
                    onClick={() => setShowOrgDropdown(false)}
                  >
                    <div className="px-3 py-1.5 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                      شركاتك
                    </div>
                    {companyChoices.map(choice => (
                      <button
                        key={choice.orgId}
                        type="button"
                        onClick={() => handleSwitchOwnCompany(choice.orgId)}
                        className={`w-full text-right px-3 py-2 text-xs flex items-center justify-between hover:bg-slate-50 cursor-pointer ${
                          effectiveOrgId === choice.orgId ? 'text-emerald-600 font-bold bg-emerald-50/50' : 'text-slate-700'
                        }`}
                      >
                        <span className="font-bold text-slate-800 truncate">{choice.name}</span>
                        {effectiveOrgId === choice.orgId && <span className="h-2 w-2 rounded-full bg-emerald-500 shrink-0"></span>}
                      </button>
                    ))}
                  </div>
                </>
              )}

              {/* Organization Dropdown Popup (platform owner only) */}
              {showOrgDropdown && canSwitchCompany && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowOrgDropdown(false)} />
                  <div
                    className="absolute right-0 mt-2 w-72 max-w-[calc(100vw-1.5rem)] bg-white rounded-2xl shadow-xl border border-slate-100 py-2 z-50 animate-in fade-in slide-in-from-top-2 duration-150 text-right max-h-[70vh] overflow-y-auto"
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
                        <div className="min-w-0">
                          <div className="font-bold text-slate-800 truncate">{org.name}</div>
                          <div className="text-[10px] text-slate-400 font-mono">{org.code} • الميزانية: {Number(org.budget || 0).toLocaleString('en-US')} {org.currency}</div>
                        </div>
                        {activeOrgId === org.id && <span className="h-2 w-2 rounded-full bg-emerald-500 shrink-0"></span>}
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
                </>
              )}
            </div>
          </div>

          {/* Left Section (in RTL): Logout + Bell + New Request Button */}
          <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
            <button
              type="button"
              onClick={handleLogout}
              disabled={isAuthProcessing}
              className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition cursor-pointer disabled:opacity-50"
              title="تسجيل خروج"
              aria-label="تسجيل خروج"
            >
              <LogOut className="h-5 w-5" />
            </button>

            {/* Notification Bell with Dropdown Popover */}
            <div className="relative">
              <button
                type="button"
                data-notifications-toggle
                onClick={() => {
                  setNotificationsOpenedAt(Date.now());
                  setIsNotificationsOpen(!isNotificationsOpen);
                }}
                className={`relative px-2.5 sm:px-3 py-2 rounded-xl border text-xs font-bold shadow-2xs transition cursor-pointer flex items-center gap-2 ${
                  isNotificationsOpen
                    ? 'border-emerald-500 bg-emerald-50 text-emerald-800 ring-2 ring-emerald-500/20'
                    : 'border-slate-200 text-slate-700 hover:bg-slate-50'
                }`}
                title="التنبيهات والأحداث"
                aria-label={unreadCount > 0 ? `التنبيهات (${unreadCount} غير مقروء)` : 'التنبيهات'}
              >
                <div className="relative">
                  <Bell className={`h-4 w-4 ${isNotificationsOpen ? 'text-emerald-600' : 'text-slate-500'}`} />
                  {unreadCount > 0 && (
                    <span className="absolute -top-1.5 -left-1.5 h-4 min-w-[16px] px-1 rounded-full bg-rose-500 text-white text-[9px] font-black flex items-center justify-center">
                      {unreadCount > 9 ? '9+' : unreadCount}
                    </span>
                  )}
                </div>
                <span className="hidden sm:inline">التنبيهات</span>
              </button>

              <NotificationsDropdown
                isOpen={isNotificationsOpen}
                onClose={() => setIsNotificationsOpen(false)}
                onSelectRequest={onSelectRequest}
                feed={notificationsFeed}
                openedAt={notificationsOpenedAt}
              />
            </div>

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
              className="flex items-center gap-1.5 bg-[#0d9488] hover:bg-[#0f766e] text-white font-bold text-xs sm:text-sm px-2.5 sm:px-4 py-2 rounded-xl shadow-xs transition cursor-pointer active:scale-98"
              title="طلب صرف جديد"
              aria-label="طلب صرف جديد"
            >
              <Plus className="h-4 w-4 stroke-[2.5]" />
              <span className="hidden sm:inline">طلب صرف جديد</span>
            </button>
          </div>

        </div>
      </div>
    </header>
  );
};
