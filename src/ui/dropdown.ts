/**
 * A dropdown that belongs to the page rather than to the browser.
 *
 * Chrome draws the option list of a native `<select>` in its own layer, which no
 * page stylesheet reaches: the button can be themed and the list that opens off
 * it cannot. On a dark page that means a system-grey panel landing on top of the
 * felt. So the list is drawn here instead, as ordinary elements.
 *
 * Two things decide the shape of this. The list is `position: fixed` and placed
 * from script, the way `#cardtip` is, because `.deckpanel` sets
 * `overflow: hidden` and would otherwise crop it. And opening, closing and
 * arrowing never call the app's `render()`: they touch the DOM directly, so the
 * whole-screen rebuild only happens when a value is actually picked. `sync()`
 * exists for the rebuilds that happen for other reasons while a list is open.
 */

export interface DropdownOption {
  value: string;
  label: string;
}

export interface DropdownGroup {
  /** Omitted for a run of ungrouped options, which renders with no header. */
  label?: string;
  options: DropdownOption[];
}

interface Wiring {
  root: HTMLElement;
  onPick: (name: string, value: string) => void;
}

/** The one open list, by dropdown name, and which option the keyboard is on. */
let open: { name: string; active: number } | null = null;
let wiring: Wiring | null = null;
/** Letters typed in the last moment, for jump-to-option. */
let typed = '';
let typedAt = 0;

const TYPE_WINDOW = 900;
/** Kept this far off the viewport edges when the list is placed. */
const MARGIN = 8;

function esc(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

/**
 * Markup for one dropdown. `name` is what comes back to `onPick` and is also
 * the handle `openDropdown` and friends take.
 */
export function dropdownHtml(o: {
  name: string;
  value: string;
  placeholder: string;
  groups: DropdownGroup[];
  /**
   * Placeholder for a box that filters the list as you type. Worth having on a
   * list long enough that finding a name in it means reading all of them, which
   * for the leaders is two hundred and twenty.
   */
  search?: string;
}): string {
  const flat = o.groups.flatMap((g) => g.options);
  const chosen = flat.find((opt) => opt.value === o.value);
  const listId = `dd-${o.name}-list`;
  let i = -1;
  const groups = o.groups
    .map((g) => {
      const head = g.label ? `<div class="ddgroup" role="presentation">${esc(g.label)}</div>` : '';
      const opts = g.options
        .map((opt) => {
          i += 1;
          const on = opt.value === o.value;
          return `<div class="ddopt${on ? ' on' : ''}" role="option" tabindex="-1"
            id="dd-${o.name}-${i}" data-ddindex="${i}" data-ddvalue="${esc(opt.value)}"
            aria-selected="${on}">${esc(opt.label)}</div>`;
        })
        .join('');
      return head + opts;
    })
    .join('');
  return `<div class="dropdown" data-dd="${o.name}">
    <button type="button" class="ddbtn" data-ddtoggle="${o.name}"
      aria-haspopup="listbox" aria-expanded="false" aria-controls="${listId}">
      <span class="ddvalue${chosen ? '' : ' placeheld'}">${esc(chosen ? chosen.label : o.placeholder)}</span>
      <span class="ddcaret" aria-hidden="true"></span>
    </button>
    <div class="ddlist" id="${listId}" role="listbox">${
      o.search
        ? `<div class="ddsearch"><input type="text" autocomplete="off" spellcheck="false"
            aria-label="${esc(o.search)}" placeholder="${esc(o.search)}"></div>`
        : ''
    }${groups}<div class="ddempty" hidden>Nothing matches.</div></div>
  </div>`;
}

function wrapOf(name: string): HTMLElement | null {
  return wiring?.root.querySelector<HTMLElement>(`.dropdown[data-dd="${CSS.escape(name)}"]`) ?? null;
}

/**
 * The options the keyboard and the mouse can reach: what the filter has left.
 * Everything that moves a selection goes through here, so hiding a row is
 * enough to take it out of play.
 */
function optionsOf(wrap: HTMLElement): HTMLElement[] {
  return [...wrap.querySelectorAll<HTMLElement>('.ddopt')].filter((el) => !el.hidden);
}

function searchBox(wrap: HTMLElement): HTMLInputElement | null {
  return wrap.querySelector<HTMLInputElement>('.ddsearch input');
}

/**
 * Hide what does not match what has been typed.
 *
 * A group header carries no text of its own worth matching, so it is kept only
 * when something under it survived. Headers come before their options in
 * document order, which is what lets one pass do both.
 */
function applyFilter(wrap: HTMLElement): void {
  const needle = (searchBox(wrap)?.value ?? '').trim().toLowerCase();
  let head: HTMLElement | null = null;
  let headHas = false;
  let shown = 0;
  for (const row of wrap.querySelectorAll<HTMLElement>('.ddopt, .ddgroup')) {
    if (row.classList.contains('ddgroup')) {
      if (head) head.hidden = !headHas;
      head = row;
      headHas = false;
      continue;
    }
    const hit = needle === '' || (row.textContent ?? '').toLowerCase().includes(needle);
    row.hidden = !hit;
    if (hit) {
      headHas = true;
      shown += 1;
    }
  }
  if (head) head.hidden = !headHas;
  const empty = wrap.querySelector<HTMLElement>('.ddempty');
  if (empty) empty.hidden = shown > 0;
}

/** Put every row back, for the next time the list opens. */
function clearFilter(wrap: HTMLElement): void {
  const box = searchBox(wrap);
  if (box) box.value = '';
  for (const row of wrap.querySelectorAll<HTMLElement>('.ddopt, .ddgroup')) row.hidden = false;
  const empty = wrap.querySelector<HTMLElement>('.ddempty');
  if (empty) empty.hidden = true;
}

/** Places the fixed list against its button, flipping above when it would fall off. */
function layout(): void {
  if (!open) return;
  const wrap = wrapOf(open.name);
  const list = wrap?.querySelector<HTMLElement>('.ddlist');
  const btn = wrap?.querySelector<HTMLElement>('.ddbtn');
  if (!wrap || !list || !btn) return;
  const r = btn.getBoundingClientRect();
  // Measured with the cap lifted, so a short list is not told it is tall. Taking
  // the cap off leaves nothing to overflow for that moment, which drops
  // scrollTop to zero, so where the reader had got to is put back afterwards.
  const wasAt = list.scrollTop;
  list.style.maxHeight = '';
  const wanted = list.offsetHeight;
  const below = window.innerHeight - r.bottom - MARGIN * 2;
  const above = r.top - MARGIN * 2;
  const up = wanted > below && above > below;
  list.style.maxHeight = `${Math.max(120, Math.min(wanted, up ? above : below))}px`;
  const h = list.offsetHeight;
  list.style.top = up ? `${Math.max(MARGIN, r.top - h - 4)}px` : `${r.bottom + 4}px`;
  list.style.minWidth = `${r.width}px`;
  const w = list.offsetWidth;
  list.style.left = `${Math.max(MARGIN, Math.min(r.left, window.innerWidth - w - MARGIN))}px`;
  if (wasAt) list.scrollTop = wasAt;
}

function setActive(wrap: HTMLElement, next: number, scroll = true): void {
  const opts = optionsOf(wrap);
  if (!opts.length || !open) return;
  const i = Math.max(0, Math.min(next, opts.length - 1));
  open.active = i;
  // Cleared across every option, not only the ones still on show: a row that was
  // highlighted before the filter hid it would otherwise keep the highlight and
  // two rows would look chosen at once.
  for (const el of wrap.querySelectorAll<HTMLElement>('.ddopt')) el.classList.remove('active');
  opts[i].classList.add('active');
  const list = wrap.querySelector<HTMLElement>('.ddlist');
  if (list) list.setAttribute('aria-activedescendant', opts[i].id);
  if (scroll) opts[i].scrollIntoView({ block: 'nearest' });
}

export function openDropdown(name: string): void {
  const wrap = wrapOf(name);
  if (!wrap) return;
  if (open && open.name !== name) closeDropdown();
  const opts = optionsOf(wrap);
  const chosen = opts.findIndex((el) => el.classList.contains('on'));
  open = { name, active: chosen < 0 ? 0 : chosen };
  wrap.classList.add('open');
  wrap.querySelector('.ddbtn')?.setAttribute('aria-expanded', 'true');
  layout();
  setActive(wrap, open.active);
  // The box takes the focus when there is one, so typing filters rather than
  // jumping. The list still answers the arrow keys, because the keydown handler
  // is on the root and the box is inside the list.
  const box = searchBox(wrap);
  if (box) box.focus({ preventScroll: true });
  else wrap.querySelector<HTMLElement>('.ddlist')?.focus({ preventScroll: true });
}

export function closeDropdown(refocus = false): void {
  if (!open) return;
  const wrap = wrapOf(open.name);
  const btn = wrap?.querySelector<HTMLElement>('.ddbtn');
  wrap?.classList.remove('open');
  btn?.setAttribute('aria-expanded', 'false');
  for (const el of wrap ? optionsOf(wrap) : []) el.classList.remove('active');
  if (wrap) clearFilter(wrap);
  open = null;
  if (refocus) btn?.focus();
}

export function isDropdownOpen(name?: string): boolean {
  return !!open && (name === undefined || open.name === name);
}

/**
 * Reapplies the open list after a whole-screen rebuild. Picking a value closes
 * the list before the rebuild, so this only matters for the renders that happen
 * for some other reason while one is open.
 */
export function syncDropdowns(): void {
  if (!open) return;
  const name = open.name;
  const active = open.active;
  const wrap = wrapOf(name);
  if (!wrap) {
    open = null;
    return;
  }
  open = { name, active };
  wrap.classList.add('open');
  wrap.querySelector('.ddbtn')?.setAttribute('aria-expanded', 'true');
  layout();
  setActive(wrap, active, false);
}

function pick(name: string, el: HTMLElement): void {
  const value = el.dataset.ddvalue ?? '';
  closeDropdown();
  wiring?.onPick(name, value);
}

/** Jump to the next option starting with what was just typed. */
function typeahead(wrap: HTMLElement, key: string): void {
  const now = Date.now();
  typed = now - typedAt > TYPE_WINDOW ? key : typed + key;
  typedAt = now;
  const opts = optionsOf(wrap);
  const from = open ? open.active : 0;
  // A repeat of one letter steps through the matches rather than sticking.
  const start = typed.length === 1 ? from + 1 : from;
  for (let n = 0; n < opts.length; n += 1) {
    const el = opts[(start + n) % opts.length];
    if ((el.textContent ?? '').trim().toLowerCase().startsWith(typed.toLowerCase())) {
      setActive(wrap, opts.indexOf(el));
      return;
    }
  }
}

function onKeydown(ev: KeyboardEvent): void {
  const target = ev.target as HTMLElement | null;
  const toggle = target?.closest<HTMLElement>('[data-ddtoggle]');
  if (!open && toggle) {
    if (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      openDropdown(toggle.dataset.ddtoggle!);
    }
    return;
  }
  if (!open) return;
  const wrap = wrapOf(open.name);
  if (!wrap) return;
  const last = optionsOf(wrap).length - 1;
  switch (ev.key) {
    case 'Escape':
      ev.preventDefault();
      closeDropdown(true);
      return;
    case 'Tab':
      closeDropdown();
      return;
    case 'ArrowDown':
      ev.preventDefault();
      setActive(wrap, open.active + 1);
      return;
    case 'ArrowUp':
      ev.preventDefault();
      setActive(wrap, open.active - 1);
      return;
    case 'Home':
      ev.preventDefault();
      setActive(wrap, 0);
      return;
    case 'End':
      ev.preventDefault();
      setActive(wrap, last);
      return;
    case 'PageDown':
      ev.preventDefault();
      setActive(wrap, open.active + 8);
      return;
    case 'PageUp':
      ev.preventDefault();
      setActive(wrap, open.active - 8);
      return;
    case ' ':
      // A space belongs to the box when there is one: it is part of a name.
      if (searchBox(wrap)) return;
      ev.preventDefault();
      if (optionsOf(wrap)[open.active]) pick(open.name, optionsOf(wrap)[open.active]);
      return;
    case 'Enter': {
      ev.preventDefault();
      const el = optionsOf(wrap)[open.active];
      if (el) pick(open.name, el);
      return;
    }
    default:
      if (searchBox(wrap)) return;
      if (ev.key.length === 1 && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
        ev.preventDefault();
        typeahead(wrap, ev.key);
      }
  }
}

export function mountDropdowns(w: Wiring): void {
  wiring = w;
  // Capture, so a click on an option is not first swallowed by the app's own
  // delegated click handler looking for [data-act].
  w.root.addEventListener(
    'click',
    (ev) => {
      const el = ev.target as HTMLElement;
      const toggle = el.closest<HTMLElement>('[data-ddtoggle]');
      if (toggle) {
        ev.preventDefault();
        ev.stopPropagation();
        const name = toggle.dataset.ddtoggle!;
        if (isDropdownOpen(name)) closeDropdown(true);
        else openDropdown(name);
        return;
      }
      const opt = el.closest<HTMLElement>('.ddopt');
      const wrap = opt?.closest<HTMLElement>('.dropdown');
      if (opt && wrap) {
        ev.preventDefault();
        ev.stopPropagation();
        pick(wrap.dataset.dd!, opt);
      }
    },
    true,
  );
  w.root.addEventListener('keydown', onKeydown);
  // Filtering happens on input rather than on keydown, so held keys, paste and
  // composition all land the same way.
  w.root.addEventListener('input', (ev) => {
    const el = ev.target as HTMLElement;
    if (!el.closest('.ddsearch')) return;
    const wrap = el.closest<HTMLElement>('.dropdown');
    if (!wrap || !open) return;
    applyFilter(wrap);
    setActive(wrap, 0);
    layout();
  });
  // Anywhere else on the page shuts it, including the parts the app owns.
  document.addEventListener(
    'pointerdown',
    (ev) => {
      if (!open) return;
      const el = ev.target as HTMLElement;
      if (el.closest('.dropdown[data-dd="' + CSS.escape(open.name) + '"]')) return;
      closeDropdown();
    },
    true,
  );
  // A scroll under a fixed list would leave it hanging where the button was.
  // Captured, so this sees the list scrolling too, which is not the page moving
  // and needs no placing: it only has to be told where the button went.
  window.addEventListener(
    'scroll',
    (ev) => {
      const t = ev.target;
      if (t instanceof HTMLElement && t.classList.contains('ddlist')) return;
      layout();
    },
    true,
  );
  window.addEventListener('resize', () => layout());
}
