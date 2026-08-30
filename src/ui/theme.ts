/**
 * Light or dark ground, remembered between visits.
 *
 * The whole scheme is a token swap in styles.css, keyed off `data-theme` on the
 * root element, so nothing here knows a colour. The attribute is set a second
 * time by an inline script in index.html: that one runs before first paint and
 * stops the page flashing the dark ground on its way to the light one, and this
 * module is what the toggle talks to afterwards.
 */

export type Theme = 'dark' | 'light';

const KEY = 'ernum.theme';
/** What the page is when nobody has said otherwise. */
const DEFAULT: Theme = 'dark';

function stored(): Theme | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    // Private mode and blocked storage both throw rather than return null.
    return null;
  }
}

export function currentTheme(): Theme {
  const attr = document.documentElement.dataset.theme;
  if (attr === 'light' || attr === 'dark') return attr;
  return stored() ?? DEFAULT;
}

export function setTheme(t: Theme): void {
  document.documentElement.dataset.theme = t;
  try {
    localStorage.setItem(KEY, t);
  } catch {
    // Not being able to remember it is not a reason to refuse to change it.
  }
}

/** Puts the remembered choice on the element, for the paths the inline script missed. */
export function initTheme(): void {
  setTheme(currentTheme());
}
