import { useEffect, useRef, type RefObject } from 'react';

/**
 * Esc closes ONLY the top-most open dialog.
 *
 * Each open dialog registers here while it is open. A single capture-phase listener on
 * window hands the key to the top-most one and stops the event there, so a preview
 * opened on top of a form never also closes (and wipes) the form behind it, and the
 * listeners of the dialogs underneath never see the key.
 *
 * "Top-most" is the dialog whose element comes last in the document (a nested dialog is
 * rendered inside / after its parent); dialogs registered without an element fall back
 * to the order in which they opened.
 */
type Entry = { handle: () => void; element: () => HTMLElement | null; order: number };

const entries: Entry[] = [];
let nextOrder = 0;

const isAbove = (a: Entry, b: Entry): boolean => {
  const ea = a.element();
  const eb = b.element();
  if (ea && eb && ea !== eb && ea.isConnected && eb.isConnected) {
    // a follows b in document order (or is inside it) → a is drawn on top.
    return Boolean(eb.compareDocumentPosition(ea) & Node.DOCUMENT_POSITION_FOLLOWING);
  }
  return a.order > b.order;
};

const topEntry = (): Entry | undefined =>
  entries.reduce<Entry | undefined>((top, e) => (!top || isAbove(e, top) ? e : top), undefined);

const onKeyDown = (e: KeyboardEvent) => {
  if (e.key !== 'Escape' || e.isComposing) return;
  const top = topEntry();
  if (!top) return;
  e.preventDefault();
  e.stopPropagation();
  // Holding Esc down must not close one layer after the other.
  if (e.repeat) return;
  top.handle();
};

const register = (entry: Entry) => {
  if (entries.length === 0) window.addEventListener('keydown', onKeyDown, true);
  entries.push(entry);
  return () => {
    const i = entries.indexOf(entry);
    if (i >= 0) entries.splice(i, 1);
    if (entries.length === 0) window.removeEventListener('keydown', onKeyDown, true);
  };
};

/**
 * Registers the calling dialog while `active` is true; `onEscape` runs when Esc is
 * pressed while this dialog is the top-most one. Pass the dialog's root element so
 * nested dialogs are ordered by the document even when they open in the same render.
 */
export function useEscapeToClose(active: boolean, onEscape: () => void, elementRef?: RefObject<HTMLElement | null>) {
  const handlerRef = useRef(onEscape);

  useEffect(() => {
    handlerRef.current = onEscape;
  }, [onEscape]);

  useEffect(() => {
    if (!active) return;
    return register({
      handle: () => handlerRef.current(),
      element: () => elementRef?.current ?? null,
      order: nextOrder++,
    });
  }, [active, elementRef]);
}
