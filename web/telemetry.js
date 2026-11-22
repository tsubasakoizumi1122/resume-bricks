// Web version only: a feedback link and anonymous step counts, so we can see whether
// people get from "opened the app" to "printed a resume", and hear why not.
// What is sent: the step name, the referring site and campaign tag (?ref=…), nothing else.
// Never sent: resume or brick content, names, file names, job posts.

// Clicks on these buttons count as a step (button id → step name).
export const STEPS = {
  'btn-start-own': 'start-own', // left the sample data to start their own
  'btn-import': 'import', // opened Import
  'tailor-go': 'tailor', // built a resume from a job post
  'btn-backup': 'backup',
};

const ASKED = 'resume-bricks:feedback-asked';

export function trackingAllowed(nav = {}, loc = {}) {
  if (nav.doNotTrack === '1' || nav.globalPrivacyControl === true) return false;
  const host = loc.hostname || '';
  return !(host === '' || host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local'));
}

// The GoatCounter "pixel" address for one hit. Events use their name as the path.
export function countUrl(code, { path, title = '', referrer = '', query = '', event = false }) {
  if (!/^[a-z0-9-]+$/i.test(code || '')) return null;
  const p = new URLSearchParams({ p: path, t: title });
  if (referrer) p.set('r', referrer);
  if (query) p.set('q', query);
  if (event) p.set('e', 'true');
  p.set('rnd', Math.random().toString(36).slice(2, 8)); // stop browsers serving a cached image
  return `https://${code}.goatcounter.com/count?${p}`;
}

// Only the campaign tag survives (?ref=reddit, ?utm_source=…), never other parts of the address.
export function campaignQuery(search = '') {
  const s = new URLSearchParams(search);
  const keep = new URLSearchParams();
  for (const k of ['ref', 'utm_source', 'utm_medium', 'utm_campaign']) if (s.get(k)) keep.set(k, s.get(k).slice(0, 60));
  const q = keep.toString();
  return q ? `?${q}` : '';
}

export const isFeedbackLink = (href = '') => /github\.com\/[^/]+\/resume-bricks\/issues\/new/.test(href || '');

const CSS = `
.rb-feedback-fab { position: fixed; right: 18px; bottom: 18px; z-index: 15; text-decoration: none;
  background: var(--primary); color: var(--primary-ink); border-radius: 999px; padding: 8px 16px;
  font-weight: 600; box-shadow: 0 4px 16px rgba(0,0,0,.2); }
.rb-feedback-fab:hover { filter: brightness(1.08); }
.rb-feedback-fab:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
.rb-ask { position: fixed; right: 18px; bottom: 66px; z-index: 20; max-width: 320px;
  background: var(--panel); color: var(--text); border: 1px solid var(--line); border-radius: var(--radius);
  box-shadow: 0 6px 24px rgba(0,0,0,.15); padding: 14px 16px; }
.rb-ask p { margin: 0 0 10px; line-height: 1.45; }
.rb-ask .rb-ask-actions { display: flex; gap: 8px; justify-content: flex-end; }
.rb-ask a { text-decoration: none; border-radius: 8px; padding: 6px 12px; background: var(--primary); color: var(--primary-ink); }
@media print { .rb-ask, .rb-feedback-fab { display: none !important; } }
`;

export function start({ feedbackUrl, goatcounter, win = window, doc = document }) {
  const store = (() => { try { return win.localStorage; } catch { return null; } })();
  const counting = !!goatcounter && trackingAllowed(win.navigator, win.location);
  const sent = new Set();
  const query = campaignQuery(win.location.search);

  function hit(path, { event = true, once = true } = {}) {
    if (!counting || (once && sent.has(path))) return;
    sent.add(path);
    const url = countUrl(goatcounter, {
      path,
      title: event ? path : doc.title,
      referrer: event ? '' : doc.referrer,
      query: event ? '' : query,
      event,
    });
    if (url) new win.Image().src = url;
  }

  if (feedbackUrl) {
    const style = doc.createElement('style');
    style.textContent = CSS;
    doc.head.append(style);
  }

  hit('/app', { event: false });

  doc.addEventListener('click', (e) => {
    const id = e.target.closest?.('button[id], a[id]')?.id;
    if (id && STEPS[id]) hit(STEPS[id]);
  }, true);

  // The app's "Send feedback" links (library, end of the tour) point at GitHub Issues, which most
  // students cannot use without an account. In the web version they open the feedback form instead.
  // Not a top-bar button: one more button wraps the bar onto a second row at 1440px. So a small
  // button floats in the corner instead, always visible (the library link sits below every brick).
  if (feedbackUrl) {
    const fab = doc.createElement('a');
    fab.className = 'rb-feedback-fab';
    fab.href = feedbackUrl;
    fab.target = '_blank';
    fab.rel = 'noopener';
    fab.textContent = 'Feedback';
    fab.title = 'Tell me what works and what doesn’t (1 minute)';
    fab.addEventListener('click', () => hit('feedback'));
    doc.body.append(fab);

    doc.addEventListener('click', (e) => {
      const a = e.target.closest?.('a[href]');
      if (!a || !isFeedbackLink(a.getAttribute('href'))) return;
      a.href = feedbackUrl;
      hit('feedback');
    }, true);
    for (const a of doc.querySelectorAll('a[href]')) if (isFeedbackLink(a.getAttribute('href'))) a.href = feedbackUrl;
  }

  // Printing (or saving a PDF) is the moment the app did its job: count it, then ask once.
  win.addEventListener('beforeprint', () => hit('pdf'));
  win.addEventListener('afterprint', () => {
    if (!feedbackUrl || store?.getItem(ASKED)) return;
    try { store?.setItem(ASKED, new Date().toISOString()); } catch { /* ignore */ }
    const box = doc.createElement('div');
    box.className = 'rb-ask';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', 'Feedback');
    box.innerHTML = '<p><b>Got your resume?</b> I built Resume Bricks on my own. One minute of honest feedback would help a lot.</p>'
      + '<div class="rb-ask-actions"><button type="button" class="small ghost">Not now</button></div>';
    const go = doc.createElement('a');
    go.href = feedbackUrl;
    go.target = '_blank';
    go.rel = 'noopener';
    go.textContent = 'Give feedback';
    go.addEventListener('click', () => { hit('feedback-after-pdf'); box.remove(); });
    box.querySelector('.rb-ask-actions').append(go);
    box.querySelector('button').addEventListener('click', () => box.remove());
    doc.body.append(box);
  });

  return { hit };
}
