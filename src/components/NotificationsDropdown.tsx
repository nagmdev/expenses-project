import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { ExpenseRequest } from '../types';
import { canOpenTab } from '../utils/permissions';
import { useEscapeToClose } from '../hooks/useEscapeToClose';
import type { NotificationsFeed } from '../hooks/useAppNotifications';
import { AppNotification, formatEventDateTime, formatTimeAgo, parseEventTime } from '../utils/notifications';
import {
  Bell,
  CheckCheck,
  Clock,
  AlertCircle,
  CheckCircle2,
  XCircle,
  ArrowLeft,
  Wallet,
  FileText,
  Plane,
  X
} from 'lucide-react';

interface NotificationsDropdownProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectRequest?: (req: ExpenseRequest) => void;
  /** The feed computed once by the header (useAppNotifications), so the bell badge and this list always agree. */
  feed: NotificationsFeed;
  /** When the panel was opened: "منذ 5 دقائق" is measured from here to the time of the event itself. */
  openedAt: number;
}

export const NotificationsDropdown: React.FC<NotificationsDropdownProps> = ({
  isOpen,
  onClose,
  onSelectRequest,
  feed,
  openedAt,
}) => {
  const { currentRole, setActiveTab } = useApp();
  const { notifications, unreadCount, markAsRead, markAllAsRead } = feed;

  const dropdownRef = useRef<HTMLDivElement>(null);
  const [filterType, setFilterType] = useState<'all' | 'unread' | 'actionable'>('all');

  // Close when clicking outside (the bell button itself toggles the panel).
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest?.('[data-notifications-toggle]')) return;
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, onClose]);

  // Esc closes the panel (only when it is the top-most dialog).
  useEscapeToClose(isOpen, onClose);

  const displayedNotifications = useMemo(() => {
    if (filterType === 'unread') return notifications.filter((n) => !n.isRead);
    if (filterType === 'actionable') return notifications.filter((n) => n.actionable);
    return notifications;
  }, [notifications, filterType]);

  const actionableCount = notifications.filter((n) => n.actionable).length;

  const handleNotificationClick = (item: AppNotification) => {
    markAsRead(item.id);
    if (item.targetTab) {
      setActiveTab(item.targetTab);
    }
    // Open the request itself when the item is about one.
    if (item.requestObj && onSelectRequest) {
      onSelectRequest(item.requestObj);
    }
    onClose();
  };

  if (!isOpen) return null;

  const listTab = canOpenTab(currentRole, 'requests') ? 'requests' : 'my-requests';

  return (
    <div
      ref={dropdownRef}
      className="fixed inset-x-2 top-[4.75rem] sm:absolute sm:inset-x-auto sm:top-auto sm:left-0 sm:mt-3 sm:w-96 bg-white rounded-2xl shadow-2xl border border-slate-200 z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150 text-right"
    >
      {/* Popover Header */}
      <div className="p-4 bg-slate-50 border-b border-slate-100 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="h-8 w-8 rounded-xl bg-emerald-500/10 text-emerald-600 flex items-center justify-center shrink-0">
            <Bell className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h3 className="font-extrabold text-sm text-slate-900 leading-tight">التنبيهات والأحداث</h3>
            <span className="text-[11px] text-slate-400 font-medium">
              {unreadCount > 0 ? `${unreadCount} تنبيه غير مقروء` : 'لا توجد تنبيهات جديدة'}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={markAllAsRead}
              className="text-[11px] font-bold text-emerald-600 hover:text-emerald-700 bg-emerald-50 hover:bg-emerald-100 px-2 py-1 rounded-lg transition cursor-pointer flex items-center gap-1"
              title="تحديد كل التنبيهات كمقروءة"
            >
              <CheckCheck className="h-3 w-3" />
              <span>تحديد كمقروء</span>
            </button>
          )}

          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق التنبيهات"
            className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-200/50 transition cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="px-3 py-2 border-b border-slate-100 bg-white flex items-center gap-1.5 overflow-x-auto">
        <button
          type="button"
          onClick={() => setFilterType('all')}
          className={`px-3 py-1 rounded-lg text-xs font-bold transition cursor-pointer whitespace-nowrap ${
            filterType === 'all'
              ? 'bg-slate-900 text-white shadow-2xs'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          الكل ({notifications.length})
        </button>

        <button
          type="button"
          onClick={() => setFilterType('unread')}
          className={`px-3 py-1 rounded-lg text-xs font-bold transition cursor-pointer whitespace-nowrap ${
            filterType === 'unread'
              ? 'bg-slate-900 text-white shadow-2xs'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          غير مقروءة ({unreadCount})
        </button>

        <button
          type="button"
          onClick={() => setFilterType('actionable')}
          className={`px-3 py-1 rounded-lg text-xs font-bold transition cursor-pointer whitespace-nowrap ${
            filterType === 'actionable'
              ? 'bg-slate-900 text-white shadow-2xs'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          بانتظار إجرائك ({actionableCount})
        </button>
      </div>

      {/* Notifications List */}
      <div className="max-h-96 overflow-y-auto divide-y divide-slate-100">
        {displayedNotifications.length === 0 ? (
          <div className="py-12 px-4 text-center text-slate-400">
            <Bell className="h-10 w-10 mx-auto text-slate-200 mb-2 stroke-[1.5]" />
            <p className="font-bold text-xs text-slate-600">لا توجد تنبيهات في هذا القسم</p>
            <p className="text-[11px] text-slate-400 mt-0.5">ستظهر هنا أي طلبات أو تحديثات فور وصولها</p>
          </div>
        ) : (
          displayedNotifications.map((notif) => {
            const clickable = Boolean(notif.targetTab || notif.requestObj);
            return (
              <button
                key={notif.id}
                type="button"
                onClick={() => handleNotificationClick(notif)}
                className={`w-full text-right p-3.5 transition flex items-start gap-3 hover:bg-slate-50 cursor-pointer ${
                  !notif.isRead ? 'bg-emerald-50/25' : 'bg-white'
                }`}
              >
                {/* Event Icon */}
                <div className="shrink-0 mt-0.5">
                  {notif.kind === 'visa' ? (
                    <div className="h-8 w-8 rounded-full bg-sky-100 text-sky-600 flex items-center justify-center">
                      <Plane className="h-4 w-4" />
                    </div>
                  ) : notif.status === 'pending' ? (
                    <div className="h-8 w-8 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center">
                      <Clock className="h-4 w-4" />
                    </div>
                  ) : notif.status === 'approved' ? (
                    <div className="h-8 w-8 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center">
                      <CheckCircle2 className="h-4 w-4" />
                    </div>
                  ) : notif.status === 'disbursed' ? (
                    <div className="h-8 w-8 rounded-full bg-teal-100 text-teal-600 flex items-center justify-center">
                      <Wallet className="h-4 w-4" />
                    </div>
                  ) : notif.status === 'clarification_requested' ? (
                    <div className="h-8 w-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center">
                      <AlertCircle className="h-4 w-4" />
                    </div>
                  ) : notif.status === 'rejected' ? (
                    <div className="h-8 w-8 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center">
                      <XCircle className="h-4 w-4" />
                    </div>
                  ) : (
                    <div className="h-8 w-8 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center">
                      <FileText className="h-4 w-4" />
                    </div>
                  )}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-xs text-slate-900 truncate">
                      {notif.title}
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono shrink-0" title={formatEventDateTime(parseEventTime(notif.timestamp)) || undefined}>
                      {formatTimeAgo(parseEventTime(notif.timestamp), openedAt)}
                    </span>
                  </div>

                  <p className="text-xs text-slate-600 line-clamp-2 mt-1 leading-relaxed font-medium">
                    {notif.description}
                  </p>

                  <div className="flex items-center justify-between mt-2 pt-1 border-t border-slate-100/60">
                    {clickable && notif.actionLabel ? (
                      <span className="text-[10px] font-bold text-emerald-600 flex items-center gap-1 hover:underline">
                        <span>{notif.actionLabel}</span>
                        <ArrowLeft className="h-2.5 w-2.5" />
                      </span>
                    ) : (
                      <span />
                    )}

                    {!notif.isRead && (
                      <span className="h-2 w-2 rounded-full bg-emerald-500 ring-2 ring-emerald-100"></span>
                    )}
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>

      {/* Popover Footer */}
      <div className="p-3 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
        <button
          type="button"
          onClick={() => {
            setActiveTab(listTab);
            onClose();
          }}
          className="text-xs font-bold text-slate-700 hover:text-emerald-600 flex items-center gap-1.5 transition cursor-pointer"
        >
          <span>{listTab === 'requests' ? 'الانتقال لكافة طلبات الصرف' : 'الانتقال إلى طلباتي ومتابعة الصرف'}</span>
          <ArrowLeft className="h-3 w-3" />
        </button>

        <span className="text-[10px] text-slate-400 font-medium">نظام التنبيهات المباشر</span>
      </div>
    </div>
  );
};
