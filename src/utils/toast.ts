export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastMessage {
  id: string;
  message: string;
  type: ToastType;
  duration?: number;
}

type ToastListener = (toast: ToastMessage) => void;
const listeners = new Set<ToastListener>();

export function showToast(message: string, type: ToastType = 'info', duration: number = 4500): void {
  const id = `toast-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const toast: ToastMessage = { id, message, type, duration };
  listeners.forEach(fn => fn(toast));
}

export function subscribeToast(listener: ToastListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
