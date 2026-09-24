import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { ExpenseRequest } from '../types';
import { 
  Bell, 
  Check, 
  CheckCheck, 
  Clock, 
  AlertCircle, 
  CheckCircle2, 
  XCircle, 
  ArrowLeft, 
  ExternalLink,
  Wallet,
  FileText,
  ShieldAlert,
  X
} from 'lucide-react';

interface NotificationsDropdownProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectRequest?: (req: ExpenseRequest) => void;
}

export interface AppNotification {
  id: string;
  type: 'request' | 'custody' | 'audit' | 'system';
  title: string;
  description: string;
  timestamp: string;
  timeAgo: string;
  isRead: boolean;
  status?: string;
  urgency?: 'high' | 'medium' | 'low';
  targetTab: string;
  requestObj?: ExpenseRequest;
}

const READ_NOTIFS_STORAGE_KEY = 'expenses_read_notifications_v3';

const formatTimeAgo = (dateStr?: string): string => {
  if (!dateStr) return 'الآن';
  try {
    const time = new Date(dateStr).getTime();
    if (isNaN(time)) return 'مؤخراً';
    const diffMs = Date.now() - time;
    const diffSec = Math.floor(diffMs / 1000);
    if (diffSec < 60) return 'الآن';
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `منذ ${diffMin} دقيقة`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `منذ ${diffHours} ساعة`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays === 1) return 'أمس';
    if (diffDays < 7) return `منذ ${diffDays} أيام`;
    return new Date(dateStr).toLocaleDateString('ar-EG');
  } catch {
    return 'مؤخراً';
  }
};

export const NotificationsDropdown: React.FC<NotificationsDropdownProps> = ({
  isOpen,
  onClose,
  onSelectRequest,
}) => {
  const {
    requests,
    currentRole,
    currentUser,
    setActiveTab,
    auditLogs,
  } = useApp();

  const dropdownRef = useRef<HTMLDivElement>(null);
  const [filterType, setFilterType] = useState<'all' | 'unread' | 'actionable'>('all');

  // Stored read notification IDs
  const [readIds, setReadIds] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem(READ_NOTIFS_STORAGE_KEY);
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch {
      return new Set();
    }
  });

  const markAsRead = (id: string) => {
    setReadIds((prev) => {
      const updated = new Set(prev);
      updated.add(id);
      try {
        localStorage.setItem(READ_NOTIFS_STORAGE_KEY, JSON.stringify(Array.from(updated)));
      } catch {}
      return updated;
    });
  };

  const markAllAsRead = () => {
    const allCurrentIds = rawNotifications.map((n) => n.id);
    setReadIds((prev) => {
      const updated = new Set([...prev, ...allCurrentIds]);
      try {
        localStorage.setItem(READ_NOTIFS_STORAGE_KEY, JSON.stringify(Array.from(updated)));
      } catch {}
      return updated;
    });
  };

  // Close when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
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

  // Compute active notifications
  const rawNotifications = useMemo<AppNotification[]>(() => {
    const list: AppNotification[] = [];
    const isEmployee = currentRole === 'employee';

    // 1. Notifications derived from Requests
    requests.forEach((req) => {
      const reqDate = req.createdAt || new Date().toISOString();
      const isMyRequest =
        req.requesterId === currentUser.id ||
        (req.requesterEmail && req.requesterEmail.toLowerCase() === currentUser.email?.toLowerCase());

      if (isEmployee) {
        // Employee notifications: status updates on their own requests
        if (isMyRequest) {
          if (req.status === 'approved') {
            list.push({
              id: `notif_req_${req.id}_approved`,
              type: 'request',
              title: `تمت الموافقة على طلبك (${req.requestNumber || 'طلب صرف'})`,
              description: `تم اعتماد المبلغ: ${req.amount.toLocaleString()} ${req.currency} - ${req.title}`,
              timestamp: reqDate,
              timeAgo: formatTimeAgo(reqDate),
              isRead: readIds.has(`notif_req_${req.id}_approved`),
              status: 'approved',
              targetTab: 'my-requests',
              requestObj: req,
            });
          } else if (req.status === 'disbursed') {
            list.push({
              id: `notif_req_${req.id}_paid`,
              type: 'request',
              title: `تم صرف وتحويل المبلغ (${req.requestNumber || 'طلب صرف'})`,
              description: `تم تحويل ${req.amount.toLocaleString()} ${req.currency} عبر الحساب المعتمد`,
              timestamp: reqDate,
              timeAgo: formatTimeAgo(reqDate),
              isRead: readIds.has(`notif_req_${req.id}_paid`),
              status: 'disbursed',
              targetTab: 'my-requests',
              requestObj: req,
            });
          } else if (req.status === 'clarification_requested') {
            list.push({
              id: `notif_req_${req.id}_clarif`,
              type: 'request',
              title: `مطلوب توضيح على طلبك (${req.requestNumber || 'طلب صرف'})`,
              description: `طلب المسؤول المالي توضيحات إضافية لطلب: ${req.title}`,
              timestamp: reqDate,
              timeAgo: formatTimeAgo(reqDate),
              isRead: readIds.has(`notif_req_${req.id}_clarif`),
              status: 'clarification_requested',
              urgency: 'high',
              targetTab: 'my-requests',
              requestObj: req,
            });
          } else if (req.status === 'rejected') {
            list.push({
              id: `notif_req_${req.id}_rejected`,
              type: 'request',
              title: `تم رفض الطلب (${req.requestNumber || 'طلب صرف'})`,
              description: `لم تتم الموافقة على طلب صرف: ${req.title}`,
              timestamp: reqDate,
              timeAgo: formatTimeAgo(reqDate),
              isRead: readIds.has(`notif_req_${req.id}_rejected`),
              status: 'rejected',
              targetTab: 'my-requests',
              requestObj: req,
            });
          }
        }
      } else {
        // Admin / Super Admin / Finance notifications
        if (req.status === 'pending') {
          list.push({
            id: `notif_req_${req.id}_pending`,
            type: 'request',
            title: `طلب صرف جديد بانتظار الاعتماد (${req.requestNumber || 'طلب صرف'})`,
            description: `${req.requesterName} يطلب صرف ${req.amount.toLocaleString()} ${req.currency} - ${req.title}`,
            timestamp: reqDate,
            timeAgo: formatTimeAgo(reqDate),
            isRead: readIds.has(`notif_req_${req.id}_pending`),
            status: 'pending',
            urgency: req.urgency || 'medium',
            targetTab: 'requests',
            requestObj: req,
          });
        } else if (req.status === 'clarification_requested') {
          list.push({
            id: `notif_req_${req.id}_clarif_req`,
            type: 'request',
            title: `طلب بانتظار رد الموظف (${req.requestNumber || 'طلب صرف'})`,
            description: `بانتظار إفادة ${req.requesterName} عن طلب: ${req.title}`,
            timestamp: reqDate,
            timeAgo: formatTimeAgo(reqDate),
            isRead: readIds.has(`notif_req_${req.id}_clarif_req`),
            status: 'clarification_requested',
            targetTab: 'requests',
            requestObj: req,
          });
        } else if (req.status === 'approved') {
          list.push({
            id: `notif_req_${req.id}_approved_admin`,
            type: 'request',
            title: `طلب معتمد جاهز للصرف (${req.requestNumber || 'طلب صرف'})`,
            description: `مبلغ ${req.amount.toLocaleString()} ${req.currency} جاهز للتحويل إلى ${req.requesterName}`,
            timestamp: reqDate,
            timeAgo: formatTimeAgo(reqDate),
            isRead: readIds.has(`notif_req_${req.id}_approved_admin`),
            status: 'approved',
            targetTab: 'requests',
            requestObj: req,
          });
        }
      }
    });

    // 2. Notifications derived from Recent Audit Activity
    if (auditLogs && auditLogs.length > 0 && !isEmployee) {
      auditLogs.slice(0, 10).forEach((log) => {
        const logId = `notif_log_${log.id}`;
        list.push({
          id: logId,
          type: 'audit',
          title: log.entityName || 'إجراء تدقيق جديد',
          description: log.details || `تمت عملية بواسطة ${log.actorName || log.actorEmail || 'المسؤول'}`,
          timestamp: log.timestamp || new Date().toISOString(),
          timeAgo: formatTimeAgo(log.timestamp),
          isRead: readIds.has(logId),
          targetTab: 'audit',
        });
      });
    }

    // Sort by newest first
    return list.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [requests, currentRole, currentUser, readIds, auditLogs]);

  // Filtered notifications
  const displayedNotifications = useMemo(() => {
    if (filterType === 'unread') {
      return rawNotifications.filter((n) => !n.isRead);
    }
    if (filterType === 'actionable') {
      return rawNotifications.filter((n) => n.status === 'pending' || n.status === 'clarification_requested');
    }
    return rawNotifications;
  }, [rawNotifications, filterType]);

  const unreadCount = rawNotifications.filter((n) => !n.isRead).length;

  const handleNotificationClick = (item: AppNotification) => {
    markAsRead(item.id);

    // Switch tab
    if (item.targetTab) {
      setActiveTab(item.targetTab);
    }

    // Open request modal if tied to a request
    if (item.requestObj && onSelectRequest) {
      onSelectRequest(item.requestObj);
    }

    onClose();
  };

  if (!isOpen) return null;

  return (
    <div
      ref={dropdownRef}
      className="absolute left-0 mt-3 w-80 sm:w-96 bg-white rounded-2xl shadow-2xl border border-slate-200 z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150 text-right"
    >
      {/* Popover Header */}
      <div className="p-4 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-xl bg-emerald-500/10 text-emerald-600 flex items-center justify-center">
            <Bell className="h-4 w-4" />
          </div>
          <div>
            <h3 className="font-extrabold text-sm text-slate-900 leading-tight">التنبيهات والأحداث</h3>
            <span className="text-[11px] text-slate-400 font-medium">
              {unreadCount > 0 ? `${unreadCount} تنبيه غير مقروء` : 'لا توجد تنبيهات جديدة'}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1">
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
            className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-200/50 transition cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="px-3 py-2 border-b border-slate-100 bg-white flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => setFilterType('all')}
          className={`px-3 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
            filterType === 'all'
              ? 'bg-slate-900 text-white shadow-2xs'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          الكل ({rawNotifications.length})
        </button>

        <button
          type="button"
          onClick={() => setFilterType('unread')}
          className={`px-3 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
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
          className={`px-3 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
            filterType === 'actionable'
              ? 'bg-slate-900 text-white shadow-2xs'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          بانتظار الإجراء
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
                  {notif.status === 'pending' ? (
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
                    <span className="text-[10px] text-slate-400 font-mono shrink-0">
                      {notif.timeAgo}
                    </span>
                  </div>

                  <p className="text-xs text-slate-600 line-clamp-2 mt-1 leading-relaxed font-medium">
                    {notif.description}
                  </p>

                  <div className="flex items-center justify-between mt-2 pt-1 border-t border-slate-100/60">
                    <span className="text-[10px] font-bold text-emerald-600 flex items-center gap-1 hover:underline">
                      <span>انقر لفتح الطلب ومراجعته</span>
                      <ArrowLeft className="h-2.5 w-2.5" />
                    </span>

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
            setActiveTab(currentRole === 'employee' ? 'my-requests' : 'requests');
            onClose();
          }}
          className="text-xs font-bold text-slate-700 hover:text-emerald-600 flex items-center gap-1.5 transition cursor-pointer"
        >
          <span>الانتقال لكافة طلبات الصرف</span>
          <ArrowLeft className="h-3 w-3" />
        </button>

        <span className="text-[10px] text-slate-400 font-medium">نظام التنبيهات المباشر</span>
      </div>
    </div>
  );
};
