import type { Locator } from '@playwright/test';

/** One element that the layout cuts off or squeezes, as the user would see it. */
export interface LayoutFault {
  kind: 'clipped-sideways' | 'truncated' | 'outside-viewport';
  element: string;
  text: string;
  detail: string;
}

/**
 * Finds what a person would call "cut off" inside `root`: text or controls that run past the edge of the box that
 * clips them, text truncated with an ellipsis, and anything that sticks out of the window. Vertical overflow is
 * not a fault — a scrolling panel is allowed to be taller than itself — but a sideways overflow never scrolls
 * by design, so it always hides something (`~/.claude/settings.json` cut to `settings.jso`).
 *
 * `allowTruncation` lists test ids whose descendants may end in an ellipsis on purpose (a long session name).
 */
export async function findLayoutFaults(root: Locator, options: { allowTruncation?: string[] } = {}): Promise<LayoutFault[]> {
  return root.evaluate((rootEl, allow) => {
    const faults: LayoutFault[] = [];
    const describe = (el: Element): string => {
      const id = el.getAttribute('data-testid');
      return id ? `[data-testid=${id}]` : `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? `.${el.className.split(' ')[0]}` : ''}`;
    };
    const textOf = (el: Element): string => (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 60);
    const clipsSideways = (el: Element): boolean => {
      const { overflowX } = getComputedStyle(el);
      return overflowX !== 'visible';
    };
    const clipperOf = (el: Element): Element | null => {
      for (let p = el.parentElement; p; p = p.parentElement) if (clipsSideways(p)) return p;
      return null;
    };
    const isAllowed = (el: Element): boolean => allow.some((id) => el.closest(`[data-testid^="${id}"]`) !== null);
    const all = [rootEl, ...Array.from(rootEl.querySelectorAll('*'))];

    for (const el of all) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const style = getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none') continue;

      if (style.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1 && !isAllowed(el)) {
        faults.push({ kind: 'truncated', element: describe(el), text: textOf(el), detail: `${el.scrollWidth}px of text in ${el.clientWidth}px` });
      }
      const clipper = clipperOf(el);
      if (clipper) {
        const box = clipper.getBoundingClientRect();
        if (rect.right > box.right + 1 || rect.left < box.left - 1) {
          faults.push({
            kind: 'clipped-sideways',
            element: describe(el),
            text: textOf(el),
            detail: `spans ${Math.round(rect.left)}–${Math.round(rect.right)}px, its ${describe(clipper)} shows ${Math.round(box.left)}–${Math.round(box.right)}px`,
          });
        }
      }
      if (rect.right > window.innerWidth + 1 || rect.left < -1) {
        faults.push({ kind: 'outside-viewport', element: describe(el), text: textOf(el), detail: `spans ${Math.round(rect.left)}–${Math.round(rect.right)}px of a ${window.innerWidth}px window` });
      }
    }
    // A child cut off by its parent also cuts every descendant: keep the outermost report per element only.
    return faults.filter((f, i) => faults.findIndex((o) => o.element === f.element && o.kind === f.kind) === i);
  }, options.allowTruncation ?? []);
}

/** Readable failure message: one line per fault. */
export function formatFaults(faults: LayoutFault[]): string {
  return faults.map((f) => `${f.kind}: ${f.element} "${f.text}" — ${f.detail}`).join('\n');
}
