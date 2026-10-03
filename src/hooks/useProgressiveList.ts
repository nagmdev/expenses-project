import { useMemo, useState } from 'react';
import { RENDER_STEP, nextVisibleCount } from '../lib/pagination';

/**
 * Progressive rendering of a list that stays fully loaded (requests, custodies, settlements,
 * visas: the dashboard and the KPIs need all of them, so only the RENDERING is cut): the first
 * `step` rows, then "عرض المزيد" (ShowMoreButton). Back to the first rows whenever `resetKey`
 * changes (a new filter / search / tab).
 */
export function useProgressiveList<T>(items: T[], resetKey: string, step: number = RENDER_STEP) {
  const [state, setState] = useState({ key: resetKey, count: step });
  // A new filter starts from the first rows again (derived during render, no extra pass).
  const count = state.key === resetKey ? state.count : step;
  const visible = useMemo(() => items.slice(0, count), [items, count]);
  return {
    visible,
    remaining: Math.max(0, items.length - visible.length),
    showMore: () => setState({ key: resetKey, count: nextVisibleCount(count, items.length, step) }),
  };
}
