/**
 * Turns a silent boot failure into something a player can screenshot.
 *
 * Imported before every other module in main.ts, with no imports of its own,
 * so it is already listening while the rest of the bundle evaluates. It only
 * speaks while the static fallback from index.html is still on screen: once
 * the first render has replaced that, the game is running and later errors are
 * the app's own business. The browser line is what turns a report of "it's
 * broken" into a version number.
 */

let shown = false;

function show(detail: string): void {
  if (shown) return;
  const app = document.getElementById('app');
  if (!app || !app.querySelector('.bootfallback')) return;
  shown = true;
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // Styled inline, because the page dying this early may mean the stylesheet
  // never arrived either.
  app.innerHTML = `<div style="max-width:640px;margin:18vh auto 0;padding:0 24px;font:15px/1.5 system-ui,sans-serif;color:#dfe6ff">
    <p style="font-size:19px;font-weight:700">Ernum Rites could not start.</p>
    <p>Reloading usually fixes this. If it keeps happening, please screenshot this screen and send it in.</p>
    <p style="opacity:0.75;word-break:break-word">${esc(detail)}</p>
    <p style="opacity:0.75;word-break:break-word">${esc(navigator.userAgent)}</p>
  </div>`;
}

window.addEventListener('error', (ev) => {
  show(ev.message || String(ev.error ?? 'Unknown script error'));
});
window.addEventListener('unhandledrejection', (ev) => {
  show(`Unhandled rejection: ${String(ev.reason)}`);
});

export {};
