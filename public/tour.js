// A short guided tour: dims the app, spotlights one part at a time and explains it.
// No dependencies. Steps whose target is missing or hidden are skipped.

/**
 * Steps run in order; pass only the steps that apply (filter beforehand).
 * @param {Array<{target?: string|(() => Element|null), title: string, body: string, before?: () => void, centerIfMissing?: boolean}>} steps
 * @param {{ onDone?: (finished: boolean) => void }} opts
 */
export function startTour(steps, { onDone } = {}) {
  document.querySelector('.tour')?.remove();
  const root = document.createElement('div');
  root.className = 'tour';
  root.innerHTML = `
    <div class="tour-spot" aria-hidden="true"></div>
    <div class="tour-pop" role="dialog" aria-modal="true" aria-labelledby="tour-title">
      <div class="tour-count"></div>
      <h3 id="tour-title"></h3>
      <p class="tour-body"></p>
      <div class="tour-foot">
        <button type="button" class="ghost tour-skip">Skip tour</button>
        <span class="spacer"></span>
        <button type="button" class="tour-back">Back</button>
        <button type="button" class="primary tour-next">Next</button>
      </div>
    </div>`;
  document.body.append(root);
  const spot = root.querySelector('.tour-spot');
  const pop = root.querySelector('.tour-pop');
  const prevFocus = document.activeElement;
  let i = 0;
  let target = null;

  const find = (s) => {
    const el = typeof s.target === 'function' ? s.target() : s.target ? document.querySelector(s.target) : null;
    return el && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden' ? el : null;
  };
  // Only steps that can be shown right now (a step without a target is a centered card).
  const usable = (k) => {
    const s = steps[k];
    s.before?.();
    return !s.target || !!find(s) || !!s.centerIfMissing; // centerIfMissing: show as a centered card instead
  };

  function place() {
    const pad = 6;
    const vw = innerWidth;
    const vh = innerHeight;
    if (!target) {
      spot.style.cssText = `left:${vw / 2}px;top:${vh / 2}px;width:0;height:0`;
      pop.style.left = `${Math.max(12, (vw - pop.offsetWidth) / 2)}px`;
      pop.style.top = `${Math.max(12, (vh - pop.offsetHeight) / 2)}px`;
      return;
    }
    const r = target.getBoundingClientRect();
    const top = Math.max(4, r.top - pad);
    const bottom = Math.min(vh - 4, r.bottom + pad);
    spot.style.cssText = `left:${r.left - pad}px;top:${top}px;width:${r.width + pad * 2}px;height:${Math.max(0, bottom - top)}px`;
    const pw = pop.offsetWidth;
    const ph = pop.offsetHeight;
    const gap = 12;
    let x;
    let y;
    if (vh - bottom >= ph + gap) [x, y] = [r.left, bottom + gap]; // below
    else if (top >= ph + gap) [x, y] = [r.left, top - ph - gap]; // above
    else if (vw - r.right >= pw + gap) [x, y] = [r.right + gap, Math.max(12, r.top)]; // right
    else if (r.left >= pw + gap) [x, y] = [r.left - pw - gap, Math.max(12, r.top)]; // left
    else [x, y] = [(vw - pw) / 2, vh - ph - 12]; // big target: pin to the bottom
    pop.style.left = `${Math.min(Math.max(12, x), vw - pw - 12)}px`;
    pop.style.top = `${Math.min(Math.max(12, y), vh - ph - 12)}px`;
  }

  function show(k, dir = 1) {
    while (k >= 0 && k < steps.length && !usable(k)) k += dir;
    if (k < 0) k = i;
    if (k >= steps.length) return end(true);
    i = k;
    const s = steps[i];
    target = s.target ? find(s) : null;
    root.querySelector('.tour-count').textContent = `${i + 1} / ${steps.length}`;
    root.querySelector('#tour-title').textContent = s.title;
    root.querySelector('.tour-body').innerHTML = s.body;
    root.querySelector('.tour-back').hidden = i === 0;
    root.querySelector('.tour-next').textContent = i === steps.length - 1 ? 'Done' : 'Next';
    root.classList.toggle('centered', !target);
    target?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    requestAnimationFrame(place);
    root.querySelector('.tour-next').focus({ preventScroll: true });
  }

  function end(finished) {
    removeEventListener('resize', place);
    removeEventListener('scroll', place, true);
    removeEventListener('keydown', onKey, true);
    root.remove();
    prevFocus?.focus?.({ preventScroll: true });
    onDone?.(finished);
  }

  function onKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      end(false);
    } else if (e.key === 'ArrowRight') show(i + 1, 1);
    else if (e.key === 'ArrowLeft' && i > 0) show(i - 1, -1);
  }

  root.querySelector('.tour-next').addEventListener('click', () => show(i + 1, 1));
  root.querySelector('.tour-back').addEventListener('click', () => show(i - 1, -1));
  root.querySelector('.tour-skip').addEventListener('click', () => end(false));
  addEventListener('resize', place);
  addEventListener('scroll', place, true);
  addEventListener('keydown', onKey, true);
  show(0);
}
