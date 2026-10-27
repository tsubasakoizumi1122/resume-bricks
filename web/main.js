// Entry point of the web version: install the in-browser API first, then start the app.
import './shim.js';

/* global __RB_BUILD__ */
// GitHub Pages lets browsers reuse files for a few minutes. Right after an update a browser can pair a
// cached page with new code (or the reverse); the app would then look for buttons that are not there.
// index.html names its build; if it differs from this code's build, reload once to get a matching pair.
function staleBuild() {
  const page = document.querySelector('meta[name="rb-build"]')?.content;
  if (!page || page === __RB_BUILD__) return false;
  const KEY = 'resume-bricks:reloaded-for';
  let tried = null;
  try { tried = sessionStorage.getItem(KEY); } catch { /* ignore */ }
  if (tried === `${page}>${__RB_BUILD__}`) return false; // already reloaded once: start anyway
  try { sessionStorage.setItem(KEY, `${page}>${__RB_BUILD__}`); } catch { return false; }
  location.reload();
  return true;
}

if (!staleBuild()) import('../public/app.js');
