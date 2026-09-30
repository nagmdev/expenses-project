import { useCallback, useMemo, useState } from 'react';
import { useApp } from '../context/AppContext';
import { AppNotification, buildNotifications, countUnread } from '../utils/notifications';

export interface NotificationsFeed {
  notifications: AppNotification[];
  unreadCount: number;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
}

const READ_NOTIFS_STORAGE_KEY = 'expenses_read_notifications_v4';
const MAX_STORED_READ_IDS = 500;

// Read state: one set per signed-in user. The in-memory copy is the source of truth, so
// "mark as read" still works when the browser refuses storage (private mode, blocked site data).
const readIdsCache = new Map<string, Set<string>>();

const loadReadIds = (storageKey: string): Set<string> => {
  const cached = readIdsCache.get(storageKey);
  if (cached) return cached;
  let ids = new Set<string>();
  try {
    const saved = localStorage.getItem(storageKey);
    const parsed = saved ? JSON.parse(saved) : [];
    if (Array.isArray(parsed)) ids = new Set(parsed.filter((v): v is string => typeof v === 'string'));
  } catch {
    // Storage unavailable: keep the read state for this session only.
  }
  readIdsCache.set(storageKey, ids);
  return ids;
};

const saveReadIds = (storageKey: string, ids: Set<string>): Set<string> => {
  // Keep the most recent entries only (a Set iterates in insertion order).
  const trimmed = new Set(Array.from(ids).slice(-MAX_STORED_READ_IDS));
  readIdsCache.set(storageKey, trimmed);
  try {
    localStorage.setItem(storageKey, JSON.stringify(Array.from(trimmed)));
  } catch {
    // Storage unavailable: the in-memory copy above still applies for this session.
  }
  return trimmed;
};

/**
 * The notification feed of the signed-in user (rules in src/utils/notifications.ts).
 * Computed once (in the header) and shared with the dropdown, so the bell badge counts
 * exactly the unread items the list shows, and clears when they are marked as read.
 */
export function useAppNotifications(): NotificationsFeed {
  const { requests, visaRequests, auditLogs, currentRole, currentUser } = useApp();

  const storageKey = `${READ_NOTIFS_STORAGE_KEY}:${currentUser.id}`;
  const [readState, setReadState] = useState(() => ({ key: storageKey, ids: loadReadIds(storageKey) }));
  // Another user signed in on this browser: their own read state (cached lookup, no effect needed).
  const readIds = readState.key === storageKey ? readState.ids : loadReadIds(storageKey);

  const notifications = useMemo(
    () => buildNotifications(
      { requests, visaRequests, auditLogs },
      { id: currentUser.id, email: currentUser.email, role: currentRole },
      readIds,
    ),
    [requests, visaRequests, auditLogs, currentRole, currentUser.id, currentUser.email, readIds],
  );

  const unreadCount = countUnread(notifications);

  const markAsRead = useCallback((id: string) => {
    const current = loadReadIds(storageKey);
    if (current.has(id)) return;
    setReadState({ key: storageKey, ids: saveReadIds(storageKey, new Set([...current, id])) });
  }, [storageKey]);

  const markAllAsRead = useCallback(() => {
    const current = loadReadIds(storageKey);
    setReadState({ key: storageKey, ids: saveReadIds(storageKey, new Set([...current, ...notifications.map((n) => n.id)])) });
  }, [storageKey, notifications]);

  return { notifications, unreadCount, markAsRead, markAllAsRead };
}
