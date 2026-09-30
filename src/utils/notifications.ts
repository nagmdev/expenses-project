import type { AuditLogEntry, ExpenseRequest, Role, VisaRequest } from '../types';
import { can, canOpenTab } from './permissions';

/**
 * The in-app notification feed (header bell), derived from the data the signed-in user
 * can read. Pure functions, so the rules below are unit-tested (tests/notifications.test.ts):
 *  - the bell badge is exactly the unread items of the list;
 *  - an item's time is when the EVENT happened (the status change), not the request creation;
 *  - a click opens the page of the thing it is about (a visa opens the visas page);
 *  - only items about an expense request say "open the request".
 */
export interface AppNotification {
  /** Unique per event: a request that returns to the same status later is a NEW (unread) notification. */
  id: string;
  kind: 'request' | 'visa' | 'activity';
  title: string;
  description: string;
  /** When the event happened (the status change), ISO string; '' when unknown. */
  timestamp: string;
  isRead: boolean;
  status?: string;
  urgency?: 'high' | 'medium' | 'low';
  /** Needs something from the current user (approve, disburse, reply, pay). */
  actionable: boolean;
  /** Page the click opens; '' when the role may not open any related page. */
  targetTab: string;
  actionLabel: string;
  requestObj?: ExpenseRequest;
}

export interface NotificationViewer {
  id: string;
  email?: string;
  role: Role;
}

export interface NotificationSources {
  requests: ExpenseRequest[];
  visaRequests: VisaRequest[];
  auditLogs: AuditLogEntry[];
}

/** Informational items older than this drop out of the list; action items always stay. */
export const INFO_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
export const MAX_ACTIVITY_ITEMS = 10;

/** ISO timestamps, and the domain's local "YYYY-MM-DD HH:MM" timeline format. NaN when unknown. */
export const parseEventTime = (value?: string | null): number => {
  if (!value) return NaN;
  const local = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}(?::\d{2})?)$/.exec(value.trim());
  return new Date(local ? `${local[1]}T${local[2]}` : value).getTime();
};

const toIso = (time: number): string => (Number.isFinite(time) ? new Date(time).toISOString() : '');

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Local date as YYYY-MM-DD (browser time zone, Western digits, like the rest of the app). */
const formatLocalDate = (time: number): string => {
  const d = new Date(time);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};

/** Local "YYYY-MM-DD HH:MM" of an event time; '' when unknown. */
export const formatEventDateTime = (time: number): string => {
  if (!Number.isFinite(time)) return '';
  const d = new Date(time);
  return `${formatLocalDate(time)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};

/** "الآن" / "منذ 5 دقيقة" / … relative to `now`, then the local date after a week. */
export const formatTimeAgo = (time: number, now: number = Date.now()): string => {
  if (!Number.isFinite(time)) return 'مؤخراً';
  const diffSec = Math.floor((now - time) / 1000);
  if (diffSec < 60) return 'الآن';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `منذ ${diffMin} دقيقة`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `منذ ${diffHours} ساعة`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return 'أمس';
  if (diffDays < 7) return `منذ ${diffDays} أيام`;
  return formatLocalDate(time);
};

const money = (amount: number, currency: string) =>
  `${Number(amount || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })} ${currency || ''}`.trim();

const TIMELINE_PENDING = new Set(['created', 'clarification_answered', 'pending']);

/**
 * When the request entered its CURRENT status: the last timeline transition into it
 * (edits that keep the status are not transitions). Falls back to the disbursement /
 * creation / update time for records without a usable timeline.
 */
export const requestStatusEvent = (req: ExpenseRequest): { key: string; time: number } => {
  let key = '';
  let time = NaN;
  let previous: string | null = null;
  for (const ev of req.timeline || []) {
    const status = TIMELINE_PENDING.has(ev.status) ? 'pending' : ev.status;
    if (status !== previous) {
      if (status === req.status) {
        key = ev.id || ev.timestamp || '';
        time = parseEventTime(ev.timestamp);
      }
      previous = status;
    }
  }
  if (req.status === 'disbursed') {
    const paidAt = parseEventTime(req.disbursement?.disbursedAt);
    if (Number.isFinite(paidAt)) time = paidAt;
    if (!key) key = req.disbursement?.disbursedAt || '';
  }
  if (!Number.isFinite(time)) {
    time = req.status === 'pending' ? parseEventTime(req.createdAt) : parseEventTime(req.updatedAt);
    if (!Number.isFinite(time)) time = parseEventTime(req.createdAt);
  }
  return { key, time };
};

export const visaStatusEvent = (visa: VisaRequest): { key: string; time: number } => {
  if (visa.status === 'approved' || visa.status === 'rejected') {
    const t = parseEventTime(visa.approvedAt);
    return { key: visa.approvedAt || '', time: Number.isFinite(t) ? t : parseEventTime(visa.updatedAt) };
  }
  if (visa.status === 'paid' || visa.status === 'partially_paid') {
    const payments = visa.payments || [];
    const last = payments[payments.length - 1];
    const t = parseEventTime(last?.recordedAt || last?.date);
    return { key: String(payments.length), time: Number.isFinite(t) ? t : parseEventTime(visa.updatedAt) };
  }
  return { key: '', time: parseEventTime(visa.createdAt || visa.requestDate) };
};

/** Where an audit entry is best looked at (the page of the thing it changed). */
const ACTIVITY_TARGET: Record<string, string> = {
  vault: 'treasury',
  transaction: 'treasury',
  custody: 'custody',
  provider: 'providers',
  service: 'services',
  department: 'organizations',
  organization: 'organizations',
  member: 'users',
  role: 'users',
  payment: 'visas',
  visa_request: 'visas',
  request: 'requests',
};

/** The hint under an item names what the click opens. Only request items talk about "the request". */
export const TAB_ACTION_LABEL: Record<string, string> = {
  requests: 'انقر لفتح الطلب ومراجعته',
  'my-requests': 'انقر لعرض تفاصيل طلبك',
  visas: 'انقر للانتقال إلى طلبات التأشيرات',
  treasury: 'انقر للانتقال إلى الخزائن وحسابات الدفع',
  custody: 'انقر للانتقال إلى العهد النقدية',
  providers: 'انقر للانتقال إلى الموردين',
  services: 'انقر للانتقال إلى بنود الصرف',
  organizations: 'انقر للانتقال إلى الشركة والأقسام',
  users: 'انقر للانتقال إلى المستخدمين',
  audit: 'انقر لعرض سجل العمليات',
};

const reachableTab = (role: Role, preferred: string): string => {
  if (canOpenTab(role, preferred)) return preferred;
  return canOpenTab(role, 'audit') ? 'audit' : '';
};

/**
 * Every notification the viewer should see, newest first. `readIds` marks the ones already read.
 */
export function buildNotifications(
  sources: NotificationSources,
  viewer: NotificationViewer,
  readIds: ReadonlySet<string>,
  now: number = Date.now(),
): AppNotification[] {
  const { requests, visaRequests, auditLogs } = sources;
  const role = viewer.role;
  const list: Omit<AppNotification, 'isRead'>[] = [];
  const myEmail = (viewer.email || '').toLowerCase();
  const isMine = (requesterId?: string, requesterEmail?: string) =>
    requesterId === viewer.id || Boolean(myEmail && requesterEmail && requesterEmail.toLowerCase() === myEmail);

  const canApprove = can(role, 'approveRequests');
  const canDisburse = can(role, 'disburseRequests');
  const requestsTab = canOpenTab(role, 'requests') ? 'requests' : '';
  const myRequestsTab = canOpenTab(role, 'my-requests') ? 'my-requests' : '';

  // 1. Expense requests
  for (const req of requests) {
    const { key, time } = requestStatusEvent(req);
    const base = {
      kind: 'request' as const,
      id: `req_${req.id}_${req.status}_${key}`,
      timestamp: toIso(time),
      status: req.status,
      requestObj: req,
    };
    const number = req.requestNumber || 'طلب صرف';

    if (isMine(req.requesterId, req.requesterEmail)) {
      // The requester hears about decisions on their own request (never as an approver task).
      const own = { ...base, targetTab: myRequestsTab, actionLabel: TAB_ACTION_LABEL['my-requests'] };
      if (req.status === 'approved') {
        list.push({ ...own, actionable: false, title: `تمت الموافقة على طلبك (${number})`, description: `تم اعتماد المبلغ: ${money(req.amount, req.currency)} - ${req.title}` });
      } else if (req.status === 'disbursed') {
        list.push({ ...own, actionable: false, title: `تم صرف وتحويل المبلغ (${number})`, description: `تم تحويل ${money(req.amount, req.currency)} عبر الحساب المعتمد` });
      } else if (req.status === 'clarification_requested') {
        list.push({ ...own, actionable: true, urgency: 'high', title: `مطلوب توضيح على طلبك (${number})`, description: `طُلبت توضيحات إضافية على طلب: ${req.title}`, actionLabel: 'انقر لفتح طلبك والرد على الاستفسار' });
      } else if (req.status === 'rejected') {
        list.push({ ...own, actionable: false, title: `تم رفض الطلب (${number})`, description: req.rejectionReason ? `سبب الرفض: ${req.rejectionReason}` : `لم تتم الموافقة على طلب صرف: ${req.title}` });
      }
      continue;
    }

    // Other people's requests: only roles that act on them.
    if (!requestsTab) continue;
    const other = { ...base, targetTab: requestsTab, actionLabel: TAB_ACTION_LABEL.requests };
    if (req.status === 'pending' && canApprove) {
      list.push({ ...other, actionable: true, urgency: req.urgency || 'medium', title: `طلب صرف بانتظار الاعتماد (${number})`, description: `${req.requesterName} يطلب صرف ${money(req.amount, req.currency)} - ${req.title}` });
    } else if (req.status === 'approved' && canDisburse) {
      // Finance's actual work: approved requests waiting for the money to be sent.
      list.push({ ...other, actionable: true, title: `طلب معتمد بانتظار الصرف (${number})`, description: `مبلغ ${money(req.amount, req.currency)} جاهز للتحويل إلى ${req.requesterName}` });
    } else if (req.status === 'clarification_requested' && canApprove) {
      list.push({ ...other, actionable: false, title: `بانتظار رد مقدم الطلب (${number})`, description: `بانتظار إفادة ${req.requesterName} عن طلب: ${req.title}` });
    }
  }

  // 2. Visa requests: a click opens the visas page (never the audit log).
  const visasTab = canOpenTab(role, 'visas') ? 'visas' : '';
  if (visasTab) {
    const canDecideVisas = can(role, 'decideVisas');
    const canPayVisas = can(role, 'payVisas');
    for (const visa of visaRequests) {
      const { key, time } = visaStatusEvent(visa);
      const base = {
        kind: 'visa' as const,
        id: `visa_${visa.id}_${visa.status}_${key}`,
        timestamp: toIso(time),
        status: visa.status,
        targetTab: visasTab,
        actionLabel: TAB_ACTION_LABEL.visas,
      };
      const number = visa.requestNumber || 'طلب تأشيرة';
      if (isMine(visa.requesterId, visa.requesterEmail)) {
        if (visa.status === 'approved') {
          list.push({ ...base, actionable: false, title: `تم اعتماد طلب التأشيرة (${number})`, description: `اعتمد ${visa.approvedByName || 'المسؤول'} طلب تأشيرة ${visa.travelerName}` });
        } else if (visa.status === 'rejected') {
          list.push({ ...base, actionable: false, title: `تم رفض طلب التأشيرة (${number})`, description: visa.rejectionReason ? `سبب الرفض: ${visa.rejectionReason}` : `طلب تأشيرة ${visa.travelerName}` });
        } else if (visa.status === 'paid') {
          list.push({ ...base, actionable: false, title: `تم سداد تكلفة التأشيرة (${number})`, description: `تم سداد ${money(visa.totalAmount, visa.currency)} لتأشيرة ${visa.travelerName}` });
        }
        continue;
      }
      if (visa.status === 'pending' && canDecideVisas) {
        list.push({ ...base, actionable: true, title: `طلب تأشيرة بانتظار الاعتماد (${number})`, description: `${visa.requesterName} - ${visa.travelerName} - ${money(visa.totalAmount, visa.currency)}` });
      } else if ((visa.status === 'approved' || visa.status === 'partially_paid') && canPayVisas) {
        list.push({ ...base, actionable: true, title: `تأشيرة معتمدة بانتظار السداد (${number})`, description: `المتبقي ${money(visa.remainingBalance, visa.currency)} - ${visa.travelerName}` });
      }
    }
  }

  // 3. Recent activity by OTHER people (requests / visas are covered above), for roles that may read the audit log.
  if (can(role, 'viewAuditLog')) {
    auditLogs
      .filter((log) =>
        log.actorId !== viewer.id &&
        log.entityType !== 'request' &&
        (log.entityType as string) !== 'visa_request',
      )
      .sort((a, b) => (parseEventTime(b.timestamp) || 0) - (parseEventTime(a.timestamp) || 0))
      .slice(0, MAX_ACTIVITY_ITEMS)
      .forEach((log) => {
        const targetTab = reachableTab(role, ACTIVITY_TARGET[log.entityType as string] || 'audit');
        list.push({
          kind: 'activity',
          id: `log_${log.id}`,
          actionable: false,
          title: log.entityName || 'عملية جديدة',
          description: log.details || `تمت عملية بواسطة ${log.actorName || log.actorEmail || 'المسؤول'}`,
          timestamp: toIso(parseEventTime(log.timestamp)),
          targetTab,
          actionLabel: targetTab ? TAB_ACTION_LABEL[targetTab] || 'انقر لعرض التفاصيل' : '',
        });
      });
  }

  const cutoff = now - INFO_WINDOW_MS;
  return list
    .filter((n) => n.actionable || !n.timestamp || parseEventTime(n.timestamp) >= cutoff)
    .map((n) => ({ ...n, isRead: readIds.has(n.id) }))
    .sort((a, b) => (parseEventTime(b.timestamp) || 0) - (parseEventTime(a.timestamp) || 0));
}

/** The bell badge: exactly the unread items the panel lists. */
export const countUnread = (notifications: AppNotification[]): number =>
  notifications.reduce((n, item) => (item.isRead ? n : n + 1), 0);
