import { TYPES, TYPE_ORDER, SECTION_PRESETS, blockLabel } from './schema.js';
import { renderResume, renderMarkdown, esc, dateRange } from './render.js';
import { parseResume } from './importer.js';
import { buildWorkPrompt, parseClaudeReply } from './work.js';
import { tailorResume, trimOnce, buildTailorPrompt, applyTailorReply, termLabel } from './tailor.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const DEFAULT_SETTINGS = { theme: 'classic', paper: 'letter', accent: '#1f4e79', fontScale: 1 };
const PAPER_IN = { letter: { w: 8.5, h: 11 }, a4: { w: 8.27, h: 11.69 } };
const PAD_V_IN = 0.5;
const PAD_H_IN = 0.6;
const LS_LAST = 'resume-bricks:last';

// ---------------------------------------------------------------- api

const api = {
  async get(p) {
    const r = await fetch(p);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || r.statusText);
    return j;
  },
  async send(method, p, body) {
    const r = await fetch(p, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || r.statusText);
    return j;
  },
};

// ---------------------------------------------------------------- state

const state = {
  blocks: [],
  byId: new Map(),
  resumes: [],
  currentId: null,
  comp: null,
  dirty: false,
  filter: { q: '', type: 'all' },
  expanded: new Set(), // "sec:idx" keys whose bullet list is open
};

function newComp(name = 'Untitled resume') {
  return {
    name,
    settings: { ...DEFAULT_SETTINGS },
    header: null,
    sections: [
      { title: 'Summary', items: [] },
      { title: 'Experience', items: [] },
      { title: 'Education', items: [] },
      { title: 'Skills', items: [] },
    ],
  };
}

function normalize(c) {
  const comp = { ...c };
  delete comp.id;
  comp.name = comp.name || 'Untitled resume';
  comp.settings = { ...DEFAULT_SETTINGS, ...(comp.settings || {}) };
  comp.header = comp.header || null;
  comp.sections = (Array.isArray(comp.sections) ? comp.sections : []).map((s) => ({
    title: s?.title ?? '',
    items: (Array.isArray(s?.items) ? s.items : [])
      .map((it) => (typeof it === 'string' ? { block: it } : it))
      .filter((it) => it && it.block),
  }));
  return comp;
}

function serialize() {
  const c = structuredClone(state.comp);
  for (const s of c.sections) {
    for (const it of s.items) if (!it.hide?.length) delete it.hide;
  }
  return c;
}

function usageCount(id) {
  let n = state.comp.header === id ? 1 : 0;
  for (const s of state.comp.sections) for (const it of s.items) if (it.block === id) n++;
  return n;
}

// ---------------------------------------------------------------- helpers

function toast(msg, isErr = false, ms = 0) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('err', isErr);
  t.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove('show'), ms || (isErr ? 4000 : 1800));
}

async function guard(fn) {
  try {
    return await fn();
  } catch (e) {
    console.error(e);
    toast(e.message || String(e), true);
  }
}

function setDirty(v = true) {
  state.dirty = v;
  $('#dirty-dot').hidden = !v;
  $('#btn-save').classList.toggle('dirty', v);
}

/** Call after any change to the layout. */
function changed() {
  setDirty(true);
  renderLayout();
  renderPreview();
  renderLibrary();
}

// Where the app runs can change how files leave it (see RB_HOST in a host build).
const host = window.RB_HOST || {};

/** In-page replacement for confirm()/prompt(), which some hosts block. */
function ask({ title, message = '', input = null, ok = 'OK', danger = false }) {
  return new Promise((resolve) => {
    const d = $('#ask');
    $('#ask-title').textContent = title;
    $('#ask-msg').textContent = message;
    $('#ask-msg').hidden = !message;
    const field = $('#ask-input');
    field.hidden = input === null;
    field.value = input ?? '';
    const okBtn = $('#ask-ok');
    okBtn.textContent = ok;
    okBtn.classList.toggle('danger-fill', danger);
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      d.close();
      resolve(v);
    };
    $('#ask-form').onsubmit = (e) => {
      e.preventDefault();
      if (input === null) return finish(true);
      const v = field.value.trim();
      if (v) finish(v);
      else field.focus();
    };
    $('#ask-cancel').onclick = () => finish(input === null ? false : null);
    d.oncancel = (e) => {
      e.preventDefault();
      finish(input === null ? false : null);
    };
    d.showModal();
    (input === null ? okBtn : field).focus();
    if (input !== null) field.select();
  });
}

async function saveFile(filename, text, type = 'text/plain') {
  if (host.saveFile) return host.saveFile(filename, text);
  download(filename, text, type);
  return true;
}

/** A standalone page with just the resume; opens the print dialog when loaded. */
function printDocument() {
  const s = state.comp.settings;
  const css = $$('style, link[rel=stylesheet]')
    .map((el) => (el.tagName === 'STYLE' ? el.textContent : ''))
    .join('\n');
  const resumeCss = host.resumeCss || css;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(state.comp.name)}</title>
<style>${resumeCss}
@page { size: ${s.paper === 'a4' ? 'A4' : 'letter'}; margin: ${PAD_V_IN}in ${PAD_H_IN}in; }
body { margin: 0; background: #fff; }
.resume { width: auto !important; min-height: 0 !important; padding: 0 !important; }
@media screen { body { padding: 24px; background: #eee; } .resume { max-width: 8.5in; margin: 0 auto; padding: ${PAD_V_IN}in ${PAD_H_IN}in !important; background: #fff; } }
</style></head><body>
<div class="resume theme-${esc(s.theme)} paper-${esc(s.paper)}" style="--accent:${esc(s.accent)};--fs:${Number(s.fontScale) || 1}">${renderResume(state.comp, state.byId)}</div>
<script>window.addEventListener('load', () => setTimeout(() => window.print(), 300));<\/script>
</body></html>`;
}

function download(filename, text, type = 'text/markdown') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const typeColor = (t) => TYPES[t]?.color || '#888';

// ---------------------------------------------------------------- data loading

async function loadBlocks() {
  state.blocks = await api.get('/api/blocks');
  state.byId = new Map(state.blocks.filter((b) => b.type !== '_error').map((b) => [b.id, b]));
}

async function loadResumes() {
  state.resumes = await api.get('/api/resumes');
}

async function openResume(id) {
  const doc = await api.get(`/api/resumes/${encodeURIComponent(id)}`);
  state.comp = normalize(doc);
  state.currentId = id;
  state.expanded.clear();
  try { localStorage.setItem(LS_LAST, id); } catch { /* storage can be unavailable */ }
  setDirty(false);
  renderAll();
}

async function confirmDiscard() {
  if (!state.dirty) return true;
  return ask({ title: 'Discard unsaved changes?', message: 'Your latest edits to this resume have not been saved.', ok: 'Discard', danger: true });
}

// ---------------------------------------------------------------- render: top bar

function renderTopbar() {
  const sel = $('#resume-select');
  const opts = state.resumes.map(
    (r) => `<option value="${esc(r.id)}">${esc(r.name || r.id)}</option>`,
  );
  if (!state.currentId) opts.unshift('<option value="">(new, unsaved)</option>');
  sel.innerHTML = opts.join('');
  sel.value = state.currentId || '';

  $('#resume-name').value = state.comp.name;
  const s = state.comp.settings;
  $('#set-theme').value = s.theme;
  $('#set-paper').value = s.paper;
  $('#set-accent').value = s.accent;
  $('#set-scale').value = s.fontScale;
  $('#btn-delete').disabled = !state.currentId;
}

// ---------------------------------------------------------------- render: library

function renderLibrary() {
  const { q, type } = state.filter;
  const needle = q.trim().toLowerCase();

  // filter chips
  const counts = {};
  for (const b of state.blocks) counts[b.type] = (counts[b.type] || 0) + 1;
  $('#lib-filters').innerHTML =
    `<button class="chip ${type === 'all' ? 'on' : ''}" data-filter="all">All</button>` +
    TYPE_ORDER.filter((t) => counts[t])
      .map(
        (t) =>
          `<button class="chip ${type === t ? 'on' : ''}" data-filter="${t}"><span class="swatch" style="background:${typeColor(t)}"></span>${TYPES[t].label} ${counts[t]}</button>`,
      )
      .join('');

  const match = (b) => {
    if (type !== 'all' && b.type !== type) return false;
    if (!needle) return true;
    return JSON.stringify(b).toLowerCase().includes(needle);
  };

  const errors = state.blocks.filter((b) => b.type === '_error');
  const html = [];
  for (const t of [...TYPE_ORDER, ...new Set(state.blocks.map((b) => b.type))]) {
    if (html.some((h) => h.key === t)) continue;
    const list = state.blocks.filter((b) => b.type === t && match(b));
    if (!list.length || t === '_error') continue;
    const cards = list
      .map((b) => {
        const used = usageCount(b.id);
        const tags = (b.tags || []).map((x) => `<span>#${esc(x)}</span>`).join('');
        return `<div class="brick" draggable="true" data-id="${esc(b.id)}" style="--c:${typeColor(b.type)}">
          <div class="b-type">${esc(TYPES[b.type]?.label || b.type)}</div>
          <div class="b-title">${esc(blockLabel(b))}</div>
          ${tags ? `<div class="b-tags">${tags}</div>` : ''}
          <div class="b-actions">
            <button class="ghost" data-act="edit" title="Edit">✎</button>
            <button class="ghost" data-act="add" title="Add to layout">＋</button>
          </div>
          ${used ? `<div class="used">used ×${used}</div>` : ''}
        </div>`;
      })
      .join('');
    html.push({ key: t, html: `<div class="lib-group-title">${esc(TYPES[t]?.label || t)}</div>${cards}` });
  }
  const errHtml = errors
    .map((e) => `<div class="brick error"><div class="b-type">YAML error</div><div class="b-title">${esc(e.error)}</div></div>`)
    .join('');
  $('#lib-list').innerHTML =
    errHtml + (html.map((h) => h.html).join('') || '<p class="hint">No bricks match.</p>');
  $('#brick-count').textContent = `(${state.byId.size})`;
}

// ---------------------------------------------------------------- render: layout

function placedCard(b, it, si, ii) {
  if (!b) {
    return `<div class="placed missing" draggable="true" data-sec="${si}" data-idx="${ii}">
      <div class="p-row"><span class="p-title">Missing brick: ${esc(it.block)}</span>
      <span class="p-actions"><button class="ghost" data-act="remove" title="Remove">✕</button></span></div></div>`;
  }
  const all = Array.isArray(b.bullets) ? b.bullets.map(String) : [];
  const hide = new Set(it.hide || []);
  const shown = all.filter((x) => !hide.has(x)).length;
  const key = `${si}:${ii}`;
  const open = state.expanded.has(key);
  const toggles =
    open && all.length
      ? `<div class="bullet-toggles">${all
          .map(
            (x, k) =>
              `<label class="${hide.has(x) ? 'off' : ''}"><input type="checkbox" data-bullet="${k}" ${
                hide.has(x) ? '' : 'checked'
              }/>${esc(x)}</label>`,
          )
          .join('')}</div>`
      : '';
  return `<div class="placed" draggable="true" data-sec="${si}" data-idx="${ii}" style="--c:${typeColor(b.type)}">
    <div class="p-row">
      <span class="p-title">${esc(blockLabel(b))}</span>
      <span class="p-actions">
        ${all.length ? `<button class="ghost" data-act="bullets" title="Choose bullets for this resume">${shown}/${all.length} ${open ? '▴' : '▾'}</button>` : ''}
        <button class="ghost" data-act="edit" title="Edit brick">✎</button>
        <button class="ghost" data-act="remove" title="Remove from this resume">✕</button>
      </span>
    </div>${toggles}</div>`;
}

function renderLayout() {
  const c = state.comp;
  const hb = c.header ? state.byId.get(c.header) : null;
  $('#header-slot').innerHTML = c.header
    ? `<div class="placed ${hb ? '' : 'missing'}" style="--c:${typeColor('header')}" data-header="1">
        <div class="p-row"><span class="p-title">${esc(hb ? blockLabel(hb) : `Missing brick: ${c.header}`)}</span>
        <span class="p-actions">${hb ? '<button class="ghost" data-act="edit" title="Edit">✎</button>' : ''}
        <button class="ghost" data-act="remove-header" title="Remove">✕</button></span></div></div>`
    : '<div class="empty">Drop a <b>Header</b> brick here</div>';

  $('#sections').innerHTML = c.sections
    .map(
      (s, si) => `<div class="sec" data-sec="${si}">
        <div class="sec-head">
          <span class="handle" draggable="true" data-sec-handle="${si}" title="Drag to reorder section">⋮⋮</span>
          <input value="${esc(s.title)}" data-sec-title="${si}" aria-label="Section title" />
          <button class="ghost small" data-sec-del="${si}" title="Delete section">✕</button>
        </div>
        <div class="sec-items" data-drop="sec" data-sec="${si}">
          ${s.items.map((it, ii) => placedCard(state.byId.get(it.block), it, si, ii)).join('') || '<div class="empty">Drop bricks here</div>'}
        </div>
      </div>`,
    )
    .join('');
}

// ---------------------------------------------------------------- render: preview

function renderPreview() {
  const s = state.comp.settings;
  const page = $('#page');
  page.className = `resume theme-${s.theme} paper-${s.paper}`;
  page.style.setProperty('--accent', s.accent);
  page.style.setProperty('--fs', s.fontScale);
  page.innerHTML =
    renderResume(state.comp, state.byId) ||
    '<p style="color:#999;text-align:center;margin-top:3in">Add some bricks to see your resume here.</p>';

  const paper = PAPER_IN[s.paper] || PAPER_IN.letter;
  $('#page-style').textContent = `@page { size: ${s.paper === 'a4' ? 'A4' : 'letter'}; margin: ${PAD_V_IN}in ${PAD_H_IN}in; }`;

  // Page-break guides: printed pages each hold (paper height - top/bottom margin) of content.
  const px = 96;
  const usable = (paper.h - 2 * PAD_V_IN) * px;
  const contentH = page.scrollHeight - 2 * PAD_V_IN * px;
  const pages = Math.max(1, contentH / usable);
  for (let k = 1; k < Math.ceil(pages - 0.001); k++) {
    const g = document.createElement('div');
    g.className = 'page-break';
    g.style.top = `${PAD_V_IN * px + k * usable}px`;
    g.innerHTML = `<span>page ${k + 1} ↓</span>`;
    page.appendChild(g);
  }
  state.pages = pages;
  const pc = $('#page-count');
  pc.textContent = pages <= 1.001 ? '1 page' : `${pages.toFixed(1)} pages`;
  pc.classList.toggle('warn', pages > 1.001 && pages < 1.35);
  pc.title = pages > 1.001 && pages < 1.35 ? 'Just over one page: hide a bullet or lower the text size' : '';
  fitPreview();
}

// Preview zoom: "page" shows the whole resume in the pane, "width" fills the column, "actual" is 100%.
let zoomMode = 'page';
try { zoomMode = localStorage.getItem('resume-bricks:zoom') || 'page'; } catch { /* ignore */ }

function fitPreview() {
  const wrap = $('#paper-wrap');
  const page = $('#page');
  const pane = $('#preview-pane');
  if (!wrap || !page || !pane) return;
  const byWidth = (wrap.clientWidth - 2) / page.offsetWidth;
  // Room left in the pane under its header, so the whole page fits without scrolling.
  const cs = getComputedStyle(pane);
  const free = pane.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)
    - pane.querySelector('.pane-head').offsetHeight - parseFloat(cs.rowGap || cs.gap || 0) - 6;
  const byHeight = free / page.offsetHeight;
  let scale = zoomMode === 'actual' ? 1 : zoomMode === 'width' ? Math.min(1, byWidth) : Math.min(1, byWidth, byHeight);
  scale = Math.max(scale, 0.2);
  const left = Math.max(0, (wrap.clientWidth - page.offsetWidth * scale) / 2);
  page.style.transform = `translate(${left}px, 0) scale(${scale})`;
  wrap.style.height = `${page.offsetHeight * scale + 4}px`;
  wrap.style.overflowX = zoomMode === 'actual' && byWidth < 1 ? 'auto' : 'hidden';
  $$('.zoom-toggle [data-zoom]').forEach((btn) => btn.setAttribute('aria-pressed', String(btn.dataset.zoom === zoomMode)));
}

function renderAll() {
  renderTopbar();
  renderLibrary();
  renderLayout();
  renderPreview();
}

// ---------------------------------------------------------------- layout mutations

function addBlockToLayout(id) {
  const b = state.byId.get(id);
  if (!b) return;
  const c = state.comp;
  if (b.type === 'header') {
    c.header = id;
    return changed();
  }
  const want = TYPES[b.type]?.section;
  let sec = want ? c.sections.find((s) => s.title.toLowerCase() === want.toLowerCase()) : null;
  if (!sec) {
    if (want) {
      sec = { title: want, items: [] };
      c.sections.push(sec);
    } else {
      sec = c.sections[c.sections.length - 1] || (c.sections.push({ title: 'Other', items: [] }), c.sections[0]);
    }
  }
  sec.items.push({ block: id });
  toast(`Added to “${sec.title}”`);
  changed();
}

function insertBlock(id, si, index) {
  state.comp.sections[si].items.splice(index, 0, { block: id });
  changed();
}

function movePlaced(fromSi, fromIi, toSi, toIndex) {
  const c = state.comp;
  const [item] = c.sections[fromSi].items.splice(fromIi, 1);
  if (fromSi === toSi && toIndex > fromIi) toIndex--;
  c.sections[toSi].items.splice(toIndex, 0, item);
  state.expanded.clear();
  changed();
}

function removePlaced(si, ii) {
  state.comp.sections[si].items.splice(ii, 1);
  state.expanded.clear();
  changed();
}

function moveSection(from, to) {
  const c = state.comp;
  const [s] = c.sections.splice(from, 1);
  if (to > from) to--;
  c.sections.splice(to, 0, s);
  state.expanded.clear();
  changed();
}

// ---------------------------------------------------------------- drag & drop

let drag = null;
let indicator = null;

function clearIndicator() {
  indicator?.remove();
  indicator = null;
  $$('.drop-ok').forEach((el) => el.classList.remove('drop-ok'));
}

function insertIndex(container, y, selector) {
  const els = $$(`:scope > ${selector}`, container);
  for (let i = 0; i < els.length; i++) {
    const r = els[i].getBoundingClientRect();
    if (y < r.top + r.height / 2) return { index: i, before: els[i] };
  }
  return { index: els.length, before: null };
}

function showIndicator(container, before) {
  if (!indicator) {
    indicator = document.createElement('div');
    indicator.className = 'drop-indicator';
  }
  if (before) container.insertBefore(indicator, before);
  else container.appendChild(indicator);
}

/** Work out where the current drag would land, or null if nowhere. */
function dropTarget(e) {
  if (!drag) return null;
  if (drag.kind === 'section') {
    const container = $('#sections');
    if (!e.target.closest('#sections')) return null;
    const { index, before } = insertIndex(container, e.clientY, '.sec');
    return { zone: 'sections', container, index, before };
  }
  const dragType = drag.kind === 'lib' ? state.byId.get(drag.id)?.type : null;
  const zoneEl = e.target.closest('[data-drop]');
  if (!zoneEl) return null;
  const zone = zoneEl.dataset.drop;
  if (zone === 'library') return drag.kind === 'placed' ? { zone, container: zoneEl } : null;
  if (zone === 'header') return dragType === 'header' ? { zone, container: zoneEl } : null;
  if (zone === 'sec') {
    if (dragType === 'header') return null;
    const { index, before } = insertIndex(zoneEl, e.clientY, '.placed');
    return { zone, container: zoneEl, si: +zoneEl.dataset.sec, index, before };
  }
  return null;
}

document.addEventListener('dragstart', (e) => {
  const handle = e.target.closest?.('[data-sec-handle]');
  const placed = e.target.closest?.('.placed[data-sec]');
  const brick = e.target.closest?.('.brick[data-id]');
  if (handle) {
    drag = { kind: 'section', idx: +handle.dataset.secHandle };
    const secEl = handle.closest('.sec');
    e.dataTransfer.setDragImage(secEl, 16, 16);
    secEl.classList.add('is-dragging');
  } else if (placed) {
    drag = { kind: 'placed', si: +placed.dataset.sec, ii: +placed.dataset.idx };
    placed.classList.add('is-dragging');
  } else if (brick) {
    drag = { kind: 'lib', id: brick.dataset.id };
  } else {
    return;
  }
  e.dataTransfer.effectAllowed = 'copyMove';
  e.dataTransfer.setData('text/plain', 'resume-brick');
  document.body.classList.add('dragging', `drag-${drag.kind}`);
});

document.addEventListener('dragover', (e) => {
  const t = dropTarget(e);
  clearIndicator();
  if (!t) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = drag.kind === 'lib' ? 'copy' : 'move';
  if (t.zone === 'sec' || t.zone === 'sections') showIndicator(t.container, t.before);
  else t.container.classList.add('drop-ok');
});

document.addEventListener('drop', (e) => {
  const t = dropTarget(e);
  clearIndicator();
  if (!t) return;
  e.preventDefault();
  const d = drag;
  if (t.zone === 'sections') return moveSection(d.idx, t.index);
  if (t.zone === 'library') return removePlaced(d.si, d.ii);
  if (t.zone === 'header') {
    state.comp.header = d.id;
    return changed();
  }
  if (t.zone === 'sec') {
    if (d.kind === 'lib') return insertBlock(d.id, t.si, t.index);
    if (d.kind === 'placed') return movePlaced(d.si, d.ii, t.si, t.index);
  }
});

document.addEventListener('dragend', () => {
  drag = null;
  clearIndicator();
  document.body.classList.remove('dragging', 'drag-lib', 'drag-placed', 'drag-section');
  $$('.is-dragging').forEach((el) => el.classList.remove('is-dragging'));
});

// ---------------------------------------------------------------- click handlers

document.addEventListener('click', (e) => {
  const filter = e.target.closest('[data-filter]');
  if (filter) {
    state.filter.type = filter.dataset.filter;
    return renderLibrary();
  }

  const act = e.target.closest('[data-act]')?.dataset.act;
  const brick = e.target.closest('.brick[data-id]');
  if (brick && act === 'add') return addBlockToLayout(brick.dataset.id);
  if (brick && (act === 'edit' || !act)) return openEditor(state.byId.get(brick.dataset.id));

  if (e.target.closest('[data-header]')) {
    if (act === 'edit') return openEditor(state.byId.get(state.comp.header));
    if (act === 'remove-header') {
      state.comp.header = null;
      return changed();
    }
  }

  const placed = e.target.closest('.placed[data-sec]');
  if (placed && act) {
    const si = +placed.dataset.sec;
    const ii = +placed.dataset.idx;
    const it = state.comp.sections[si].items[ii];
    if (act === 'remove') return removePlaced(si, ii);
    if (act === 'edit') return openEditor(state.byId.get(it.block));
    if (act === 'bullets') {
      const key = `${si}:${ii}`;
      state.expanded.has(key) ? state.expanded.delete(key) : state.expanded.add(key);
      return renderLayout();
    }
  }

  const del = e.target.closest('[data-sec-del]');
  if (del) {
    const si = +del.dataset.secDel;
    const s = state.comp.sections[si];
    const drop = () => {
      state.comp.sections.splice(si, 1);
      state.expanded.clear();
      changed();
    };
    if (!s.items.length) return drop();
    ask({
      title: `Delete section “${s.title}”?`,
      message: `Its ${s.items.length} placed brick(s) leave this resume. The bricks stay in your library.`,
      ok: 'Delete section',
      danger: true,
    }).then((yes) => yes && drop());
    return;
  }
});

document.addEventListener('change', (e) => {
  const cb = e.target.closest('[data-bullet]');
  if (cb) {
    const placed = cb.closest('.placed');
    const it = state.comp.sections[+placed.dataset.sec].items[+placed.dataset.idx];
    const b = state.byId.get(it.block);
    const text = String(b.bullets[+cb.dataset.bullet]);
    const hide = new Set(it.hide || []);
    cb.checked ? hide.delete(text) : hide.add(text);
    it.hide = [...hide];
    return changed();
  }
});

document.addEventListener('input', (e) => {
  const title = e.target.closest('[data-sec-title]');
  if (title) {
    state.comp.sections[+title.dataset.secTitle].title = title.value;
    setDirty(true);
    renderPreview(); // don't re-render the layout: it would steal focus
  }
});

// ---------------------------------------------------------------- top bar actions

function bindTopbar() {
  $('#resume-select').addEventListener('change', (e) =>
    guard(async () => {
      const id = e.target.value;
      if (!id) return;
      if (!(await confirmDiscard())) {
        e.target.value = state.currentId || '';
        return;
      }
      await openResume(id);
    }),
  );

  $('#resume-name').addEventListener('input', (e) => {
    state.comp.name = e.target.value;
    setDirty(true);
  });

  const setting = (sel, key, parse = (v) => v) =>
    $(sel).addEventListener('input', (e) => {
      state.comp.settings[key] = parse(e.target.value);
      setDirty(true);
      renderPreview();
    });
  setting('#set-theme', 'theme');
  setting('#set-paper', 'paper');
  setting('#set-accent', 'accent');
  setting('#set-scale', 'fontScale', Number);

  // Light / night mode for the app (not the resume). "auto" follows the OS.
  const MODE_KEY = 'resume-bricks:mode';
  const dark = matchMedia('(prefers-color-scheme: dark)');
  let mode = new URLSearchParams(location.search).get('mode');
  try { mode ||= localStorage.getItem(MODE_KEY); } catch { /* ignore */ }
  if (!['light', 'dark', 'auto'].includes(mode)) mode = 'auto';
  const applyMode = () => {
    // In auto, an explicit theme on the host page (data-theme) wins over the OS setting.
    const hostTheme = document.documentElement.dataset.theme;
    const sys = hostTheme === 'dark' || hostTheme === 'light' ? hostTheme : dark.matches ? 'dark' : 'light';
    document.body.dataset.mode = mode === 'auto' ? sys : mode;
    $$('.mode-toggle [data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
  };
  dark.addEventListener('change', applyMode);
  new MutationObserver(applyMode).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  $$('.mode-toggle [data-mode]').forEach((b) =>
    b.addEventListener('click', () => {
      mode = b.dataset.mode;
      try { localStorage.setItem(MODE_KEY, mode); } catch { /* ignore */ }
      applyMode();
    }),
  );
  applyMode();

  $('#btn-new').addEventListener('click', async () => {
    if (!(await confirmDiscard())) return;
    state.comp = newComp();
    state.currentId = null;
    state.expanded.clear();
    setDirty(false);
    renderAll();
    $('#resume-name').select();
  });

  $('#btn-save').addEventListener('click', () => guard(() => save(false)));
  $('#btn-saveas').addEventListener('click', () => guard(() => save(true)));

  $('#btn-delete').addEventListener('click', () =>
    guard(async () => {
      if (!state.currentId) return;
      const yes = await ask({
        title: `Delete resume “${state.comp.name}”?`,
        message: host.trashNote || 'It is moved to my-data/.trash, not erased. Your bricks are not affected.',
        ok: 'Delete resume',
        danger: true,
      });
      if (!yes) return;
      await api.send('DELETE', `/api/resumes/${encodeURIComponent(state.currentId)}`);
      await loadResumes();
      setDirty(false);
      if (state.resumes[0]) await openResume(state.resumes[0].id);
      else {
        state.comp = newComp();
        state.currentId = null;
        renderAll();
      }
      toast('Resume deleted');
    }),
  );

  if (host.printLabel) $('#btn-print').textContent = host.printLabel;
  $('#btn-print').addEventListener('click', () =>
    guard(async () => {
      renderPreview();
      if (!host.saveFile) return window.print();
      const ok = await saveFile(`${state.currentId || 'resume'}-print.html`, printDocument());
      if (ok) toast('Open the downloaded file: it opens the print dialog. Choose “Save as PDF”.', false, 6000);
    }),
  );

  $('#btn-md').addEventListener('click', () =>
    guard(async () => {
      const ok = await saveFile(`${state.currentId || 'resume'}.md`, renderMarkdown(state.comp, state.byId), 'text/markdown');
      if (ok && host.saveFile) toast('Markdown saved');
    }),
  );

  $('#lib-search').addEventListener('input', (e) => {
    state.filter.q = e.target.value;
    renderLibrary();
  });

  $('#section-preset').innerHTML =
    SECTION_PRESETS.map((s) => `<option>${s}</option>`).join('') + '<option value="">Custom…</option>';
  $('#btn-add-section').addEventListener('click', async () => {
    let title = $('#section-preset').value;
    if (!title) title = await ask({ title: 'New section', input: 'Leadership', ok: 'Add section' });
    if (!title) return;
    state.comp.sections.push({ title, items: [] });
    changed();
  });

  $('#btn-new-brick').addEventListener('click', () => openEditor(null));

  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      if ($('#ask').open) return;
      if ($('#editor').open) $('#editor-form').requestSubmit();
      else guard(() => save(false));
    }
  });

  window.addEventListener('beforeunload', (e) => {
    if (state.dirty) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  new ResizeObserver(() => fitPreview()).observe($('#paper-wrap'));
  new ResizeObserver(() => fitPreview()).observe($('#preview-pane'));
  $$('.zoom-toggle [data-zoom]').forEach((btn) =>
    btn.addEventListener('click', () => {
      zoomMode = btn.dataset.zoom;
      try { localStorage.setItem('resume-bricks:zoom', zoomMode); } catch { /* ignore */ }
      fitPreview();
    }),
  );
}

async function save(asNew) {
  const body = serialize();
  if (asNew || !state.currentId) {
    const suggested = asNew ? `${body.name} (copy)` : body.name;
    const name =
      asNew || body.name === 'Untitled resume'
        ? await ask({ title: asNew ? 'Save a copy as…' : 'Name this resume', input: suggested, ok: 'Save' })
        : body.name;
    if (!name) return;
    body.name = name;
    state.comp.name = name;
    const { id } = await api.send('POST', '/api/resumes', body);
    state.currentId = id;
  } else {
    await api.send('PUT', `/api/resumes/${encodeURIComponent(state.currentId)}`, body);
  }
  try { localStorage.setItem(LS_LAST, state.currentId); } catch { /* ignore */ }
  await loadResumes();
  setDirty(false);
  renderTopbar();
  toast('Saved');
}

// ---------------------------------------------------------------- brick editor

let editing = null; // { block: original or null, type }

function fieldHTML(f, v) {
  const kind = f.kind || 'text';
  const name = `f_${f.key}`;
  const ph = f.placeholder ? ` placeholder="${esc(f.placeholder)}"` : '';
  if (kind === 'textarea')
    return `<label class="full">${esc(f.label)}<textarea name="${name}" rows="4"${ph}>${esc(v ?? '')}</textarea><small>**bold** and [text](https://url) work.</small></label>`;
  if (kind === 'list')
    return `<label class="full">${esc(f.label)}<textarea name="${name}" rows="6" placeholder="One bullet per line">${esc(
      (Array.isArray(v) ? v : v ? [v] : []).join('\n'),
    )}</textarea><small>One bullet per line. Write every version you might use; pick which ones show per resume in the Layout.</small></label>`;
  if (kind === 'tags')
    return `<label class="full">${esc(f.label)}<input name="${name}" value="${esc(
      (Array.isArray(v) ? v : v ? [v] : []).join(', '),
    )}" placeholder="Comma, separated, items" /></label>`;
  if (kind === 'links')
    return `<label class="full">${esc(f.label)}<textarea name="${name}" rows="3" placeholder="LinkedIn | https://linkedin.com/in/you">${esc(
      (Array.isArray(v) ? v : []).map((l) => `${l.label || ''} | ${l.url || ''}`).join('\n'),
    )}</textarea><small>One per line: Label | URL</small></label>`;
  return `<label>${esc(f.label)}<input name="${name}" value="${esc(v ?? '')}"${ph} /></label>`;
}

function renderEditorFields(values) {
  const t = TYPES[editing.type];
  const typeSelect = editing.block
    ? ''
    : `<label class="full">Brick type<select name="_type">${TYPE_ORDER.map(
        (k) => `<option value="${k}" ${k === editing.type ? 'selected' : ''}>${TYPES[k].label}</option>`,
      ).join('')}</select></label>`;
  $('#editor-fields').innerHTML = `${typeSelect}
    <label>Library label (optional)<input name="_title" value="${esc(values.title ?? '')}" placeholder="Shown only in your library" /></label>
    <label>Tags<input name="_tags" value="${esc((values.tags || []).join(', '))}" placeholder="saas, growth" /></label>
    <hr />
    ${t.fields.map((f) => fieldHTML(f, values[f.key])).join('')}`;
}

function openEditor(block) {
  if (block === undefined) return toast('That brick no longer exists', true);
  editing = { block, type: block?.type || (state.filter.type !== 'all' ? state.filter.type : 'experience') };
  if (!TYPES[editing.type]) editing.type = 'custom';
  $('#editor-title').textContent = block ? `Edit ${TYPES[editing.type].label} brick` : 'New brick';
  $('#ed-delete').hidden = !block;
  $('#ed-duplicate').hidden = !block;
  renderEditorFields(block || {});
  $('#editor').showModal();
  $('#editor-fields input:not([name="_title"]):not([name="_tags"]), #editor-fields textarea')?.focus();
}

function collectEditor() {
  const fd = new FormData($('#editor-form'));
  const t = TYPES[editing.type];
  const out = { ...(editing.block || {}) };
  delete out.id;
  out.type = editing.type;
  const title = String(fd.get('_title') || '').trim();
  const tags = String(fd.get('_tags') || '').split(',').map((s) => s.trim()).filter(Boolean);
  title ? (out.title = title) : delete out.title;
  tags.length ? (out.tags = tags) : delete out.tags;
  for (const f of t.fields) {
    const raw = String(fd.get(`f_${f.key}`) ?? '');
    let v;
    switch (f.kind) {
      case 'list':
        v = raw.split('\n').map((s) => s.trim()).filter(Boolean);
        break;
      case 'tags':
        v = raw.split(',').map((s) => s.trim()).filter(Boolean);
        break;
      case 'links':
        v = raw
          .split('\n')
          .map((line) => {
            const [a, ...rest] = line.split('|');
            const url = rest.join('|').trim();
            return url ? { label: a.trim(), url } : a.trim() ? { label: '', url: a.trim() } : null;
          })
          .filter(Boolean);
        break;
      default:
        v = raw.trim();
    }
    const empty = Array.isArray(v) ? !v.length : v === '';
    if (empty) delete out[f.key];
    else out[f.key] = v;
  }
  // Put type/title/tags first so the YAML reads nicely.
  const { type, title: tt, tags: tg, ...rest } = out;
  return { type, ...(tt ? { title: tt } : {}), ...(tg ? { tags: tg } : {}), ...rest };
}

function bindEditor() {
  const dlg = $('#editor');
  $$('[data-close]', dlg).forEach((b) => b.addEventListener('click', () => dlg.close()));

  $('#editor-fields').addEventListener('change', (e) => {
    if (e.target.name !== '_type') return;
    const keep = collectEditor();
    editing.type = e.target.value;
    renderEditorFields(keep);
  });

  $('#editor-form').addEventListener('submit', (e) => {
    e.preventDefault();
    guard(async () => {
      const body = collectEditor();
      let id;
      if (editing.block) {
        id = editing.block.id;
        await api.send('PUT', `/api/blocks/${encodeURIComponent(id)}`, body);
      } else {
        ({ id } = await api.send('POST', '/api/blocks', body));
      }
      await loadBlocks();
      dlg.close();
      renderLibrary();
      renderLayout();
      renderPreview();
      toast(editing.block ? 'Brick saved' : 'Brick created');
      if (!editing.block) {
        const el = $(`.brick[data-id="${CSS.escape(id)}"]`);
        el?.scrollIntoView({ block: 'nearest' });
      }
    });
  });

  $('#ed-duplicate').addEventListener('click', () =>
    guard(async () => {
      const body = collectEditor();
      body.title = `${blockLabel({ ...body, title: body.title })} (variant)`;
      const { id } = await api.send('POST', '/api/blocks', body);
      await loadBlocks();
      renderLibrary();
      dlg.close();
      openEditor(state.byId.get(id));
      toast('Duplicated. Edit the variant, then save');
    }),
  );

  $('#ed-delete').addEventListener('click', () =>
    guard(async () => {
      const id = editing.block.id;
      const usedIn = state.resumes
        .filter((r) => r.header === id || (r.sections || []).some((s) => (s.items || []).some((it) => it.block === id)))
        .map((r) => r.name || r.id);
      const yes = await ask({
        title: `Delete brick “${blockLabel(editing.block)}”?`,
        message: `${usedIn.length ? `It is used in: ${usedIn.join(', ')}. ` : ''}${host.trashNote || 'It is moved to my-data/.trash, not erased.'}`,
        ok: 'Delete brick',
        danger: true,
      });
      if (!yes) return;
      await api.send('DELETE', `/api/blocks/${encodeURIComponent(id)}`);
      await loadBlocks();
      dlg.close();
      renderAll();
      toast('Brick deleted');
    }),
  );
}

// ---------------------------------------------------------------- import an existing resume

const imp = { drafts: [], parsed: null, fileName: '' };

function impStatus(msg, isErr = false) {
  const el = $('#imp-status');
  el.textContent = msg;
  el.classList.toggle('err', isErr);
}

function openImporter() {
  imp.mode = 'resume';
  $('#imp-title').textContent = 'Import a resume';
  $('#imp-make-row').hidden = false;
  $('#imp-make-resume').checked = true;
  $('#imp-step1').hidden = false;
  $('#imp-step2').hidden = true;
  $('#imp-go').hidden = true;
  $('#imp-back').hidden = true;
  $('#imp-file').value = '';
  impStatus('');
  if (!$('#importer').open) $('#importer').showModal();
}

async function readResumeFile(file) {
  if (!file) return;
  imp.fileName = file.name;
  openImporter();
  impStatus(`Reading ${file.name}…`);
  try {
    let text;
    if (/\.(txt|md)$/i.test(file.name) || file.type.startsWith('text/')) {
      text = await file.text();
    } else {
      let r;
      try {
        r = await fetch('/api/extract', {
          method: 'POST',
          headers: { 'content-type': file.type || 'application/octet-stream', 'x-filename': encodeURIComponent(file.name) },
          body: file,
        });
      } catch {
        throw new Error('Could not reach the app server. Is it still running?');
      }
      const j = await r.json().catch(() => ({}));
      if (r.status === 404 || r.status === 405) throw new Error('Reading PDF and Word files needs the local app. Paste the text instead.');
      if (!r.ok) throw new Error(j.error || 'Could not read that file.');
      text = j.text;
    }
    showDrafts(text);
  } catch (e) {
    impStatus(e.message, true);
    $('#imp-paste').open = true;
  }
}

const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

function showDrafts(text) {
  presentDrafts(parseResume(text), { raw: text });
}

/** Show the review step for any set of draft bricks (from a resume file or from Claude). */
function presentDrafts(parsed, { raw = null, mode = 'resume', notes = [] } = {}) {
  imp.mode = mode;
  imp.parsed = parsed;
  imp.drafts = [];
  // Same type and label counts as "already in your library"; skills must also list the same items.
  const key = (b) => `${b.type}|${norm(blockLabel(b))}${b.type === 'skills' ? `|${norm((b.items || []).join(','))}` : ''}`;
  const existing = new Map(state.blocks.filter((b) => b.type !== '_error').map((b) => [key(b), b.id]));
  const add = (block, sectionIndex) => {
    const dupOf = existing.get(key(block)) || null;
    imp.drafts.push({ block, sectionIndex, dupOf, on: !dupOf });
  };
  if (parsed.header) add(parsed.header, -1);
  parsed.sections.forEach((sec, i) => sec.blocks.forEach((b) => add(b, i)));

  if (raw !== null) $('#imp-raw').value = raw;
  $('.imp-raw').hidden = raw === null;
  $('#imp-make-row').hidden = mode === 'work';
  if (mode === 'work') $('#imp-make-resume').checked = false;
  $('#imp-title').textContent = mode === 'work' ? 'Review bricks from your work' : 'Import a resume';
  const warn = $('#imp-warnings');
  warn.classList.toggle('questions', notes.length > 0);
  warn.innerHTML = notes.length
    ? `<li><b>Claude has questions.</b> Answer them in Claude and paste the new reply, or fix the bricks after importing.</li>${notes.map((q) => `<li>${esc(q)}</li>`).join('')}`
    : parsed.warnings.map((w) => `<li>${esc(w)}</li>`).join('');
  const base = imp.fileName.replace(/\.[^.]+$/, '') || 'Imported resume';
  if (!$('#imp-resume-name').value || $('#imp-step2').hidden) $('#imp-resume-name').value = `${base} (imported)`;
  renderDrafts();
  $('#imp-step1').hidden = true;
  $('#imp-step2').hidden = false;
  $('#imp-go').hidden = false;
  $('#imp-back').hidden = mode === 'work';
  if (!$('#importer').open) $('#importer').showModal();
}

function draftMeta(b) {
  const bits = [];
  const when = b.start || b.end ? dateRange(b.start, b.end) : b.date ? dateRange('', b.date) : '';
  if (b.type === 'experience') bits.push(b.location, when);
  else if (b.type === 'education') bits.push(b.degree, when);
  else if (b.type === 'project') bits.push(b.role, when);
  else if (b.type === 'skills') bits.push((b.items || []).join(', '));
  else if (b.type === 'summary') bits.push(b.text);
  else if (b.type === 'header') bits.push(b.email, b.phone, b.location);
  else bits.push(b.issuer || b.right, when);
  if (b.bullets?.length) bits.push(`${b.bullets.length} bullet${b.bullets.length > 1 ? 's' : ''}`);
  const out = bits.filter(Boolean).join(' · ');
  return out.length > 160 ? `${out.slice(0, 159)}…` : out;
}

function renderDrafts() {
  const groups = [{ title: 'Header', idx: -1 }, ...imp.parsed.sections.map((s, i) => ({ title: s.title, idx: i }))];
  $('#imp-list').innerHTML = groups
    .map((g) => {
      const items = imp.drafts
        .map((d, k) => ({ d, k }))
        .filter(({ d }) => d.sectionIndex === g.idx)
        .map(
          ({ d, k }) => `<label class="imp-item ${d.on ? '' : 'off'}" style="--c:${typeColor(d.block.type)}">
            <input type="checkbox" data-draft="${k}" ${d.on ? 'checked' : ''} />
            <span class="t">${esc(blockLabel(d.block))} <span class="muted">· ${esc(TYPES[d.block.type]?.label || d.block.type)}</span></span>
            <span class="m">${esc(draftMeta(d.block))}${d.dupOf ? ' <span class="dup">Already in your library: the existing brick will be used.</span>' : ''}</span>
          </label>`,
        )
        .join('');
      return items ? `<section class="imp-sec"><h4>${esc(g.title)}</h4>${items}</section>` : '';
    })
    .join('');
  updateImportButton();
}

function updateImportButton() {
  const n = imp.drafts.filter((d) => d.on).length;
  const total = imp.drafts.length;
  $('#imp-summary').textContent = total
    ? `Found ${total} brick${total > 1 ? 's' : ''} in ${imp.parsed.sections.length} section${imp.parsed.sections.length === 1 ? '' : 's'}. Uncheck anything you don't want.`
    : 'No bricks found.';
  const make = $('#imp-make-resume').checked;
  $('#imp-go').textContent = n ? `Import ${n} brick${n > 1 ? 's' : ''}` : make ? 'Create resume' : 'Import';
  $('#imp-go').disabled = !n && !make;
}

async function runImport() {
  const make = $('#imp-make-resume').checked;
  if (make && !(await confirmDiscard())) return;
  const ids = new Map(); // draft index -> brick id
  let created = 0;
  for (const [k, d] of imp.drafts.entries()) {
    if (d.on) {
      const { id } = await api.send('POST', '/api/blocks', d.block);
      ids.set(k, id);
      created++;
    } else if (d.dupOf) {
      ids.set(k, d.dupOf);
    }
  }
  await loadBlocks();
  if (make) {
    const headerK = imp.drafts.findIndex((d) => d.sectionIndex === -1);
    const comp = normalize({
      name: $('#imp-resume-name').value.trim() || 'Imported resume',
      header: (headerK >= 0 && ids.get(headerK)) || state.comp?.header || null,
      sections: imp.parsed.sections
        .map((sec, i) => ({
          title: sec.title,
          items: imp.drafts.map((d, k) => (d.sectionIndex === i && ids.has(k) ? { block: ids.get(k) } : null)).filter(Boolean),
        }))
        .filter((s) => s.items.length),
    });
    const { id } = await api.send('POST', '/api/resumes', comp);
    await loadResumes();
    setDirty(false);
    await openResume(id);
  } else {
    renderAll();
  }
  $('#importer').close();
  state.filter = { q: '', type: 'all' };
  $('#lib-search').value = '';
  renderLibrary();
  const tag = imp.mode === 'work' ? 'from-work' : 'imported';
  toast(`Imported ${created} brick${created === 1 ? '' : 's'}${make ? ' and created a resume' : ''}. They are tagged #${tag}.`, false, 4000);
}

function bindImporter() {
  const dlg = $('#importer');
  $('#btn-import').addEventListener('click', openImporter);
  $$('[data-imp-close]', dlg).forEach((b) => b.addEventListener('click', () => dlg.close()));
  $('#imp-file').addEventListener('change', (e) => readResumeFile(e.target.files[0]));
  $('#imp-parse').addEventListener('click', () => {
    const t = $('#imp-text').value;
    if (!t.trim()) return impStatus('Paste some text first.', true);
    imp.fileName = '';
    showDrafts(t);
  });
  $('#imp-reparse').addEventListener('click', () => showDrafts($('#imp-raw').value));
  $('#imp-back').addEventListener('click', openImporter);
  $('#imp-all').addEventListener('click', () => {
    imp.drafts.forEach((d) => (d.on = true));
    renderDrafts();
  });
  $('#imp-none').addEventListener('click', () => {
    imp.drafts.forEach((d) => (d.on = false));
    renderDrafts();
  });
  $('#imp-list').addEventListener('change', (e) => {
    const cb = e.target.closest('[data-draft]');
    if (!cb) return;
    imp.drafts[+cb.dataset.draft].on = cb.checked;
    cb.closest('.imp-item').classList.toggle('off', !cb.checked);
    updateImportButton();
  });
  $('#imp-make-resume').addEventListener('change', updateImportButton);
  $('#imp-go').addEventListener('click', () => guard(runImport));

  // Drop a file on the drop zone, or anywhere on the app.
  const zone = $('#imp-drop');
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  document.addEventListener('dragover', (e) => {
    if (drag || !hasFiles(e)) return;
    e.preventDefault();
    zone.classList.toggle('over', zone.contains(e.target));
  });
  document.addEventListener('drop', (e) => {
    if (drag || !hasFiles(e)) return;
    e.preventDefault();
    zone.classList.remove('over');
    if ($('#work').open) addWorkFiles(e.dataTransfer.files);
    else readResumeFile(e.dataTransfer.files[0]);
  });
}

// ---------------------------------------------------------------- make bricks from your own work

const work = { sources: [], nextId: 1 };

const workKind = (name) =>
  ({ pdf: 'PDF', docx: 'Word', pptx: 'PowerPoint', txt: 'Text', md: 'Markdown' })[name.split('.').pop().toLowerCase()] || 'File';

function workStatus(msg, isErr = false) {
  const el = $('#work-status');
  el.textContent = msg;
  el.classList.toggle('err', isErr);
}

function workPrompt() {
  const withBullets = state.blocks.filter((b) => ['project', 'experience'].includes(b.type) && b.bullets?.length);
  return buildWorkPrompt({
    sources: work.sources,
    about: {
      name: $('#work-name').value.trim(),
      role: $('#work-role').value.trim(),
      dates: $('#work-dates').value.trim(),
      target: $('#work-target').value.trim(),
      notes: $('#work-notes').value,
    },
    examples: withBullets.map((b) => String(b.bullets[0])).slice(0, 6),
    existing: state.blocks.filter((b) => ['project', 'experience'].includes(b.type)).map((b) => blockLabel(b)),
  });
}

function renderWork() {
  $('#work-sources').innerHTML = work.sources
    .map(
      (s) => `<li><span class="src">${esc(s.label)} <span class="muted">· ${esc(s.kind)} · ${s.text.length.toLocaleString()} characters</span></span>
        <button type="button" class="ghost small" data-src-del="${s.id}" aria-label="Remove ${esc(s.label)}">✕</button></li>`,
    )
    .join('');
  const prompt = workPrompt();
  $('#work-prompt').value = prompt;
  const has = work.sources.length || $('#work-notes').value.trim();
  $('#work-size').textContent = has ? `${Math.round(prompt.length / 1000)}k characters` : 'Add a file, link, folder or notes first';
  $('#work-copy').disabled = !has;
}

function addWorkSource(src) {
  work.sources.push({ id: work.nextId++, ...src });
  if (!$('#work-name').value && work.sources.length === 1 && src.title) $('#work-name').value = src.title;
  renderWork();
}

async function addWorkFiles(fileList) {
  for (const file of [...fileList]) {
    workStatus(`Reading ${file.name}…`);
    try {
      let text;
      if (/\.(txt|md)$/i.test(file.name)) text = await file.text();
      else {
        let r;
        try {
          r = await fetch('/api/extract', {
            method: 'POST',
            headers: { 'content-type': file.type || 'application/octet-stream', 'x-filename': encodeURIComponent(file.name) },
            body: file,
          });
        } catch {
          throw new Error('Could not reach the app server. Is it still running?');
        }
        const j = await r.json().catch(() => ({}));
        if (r.status === 404 || r.status === 405) throw new Error('Reading files needs the local app. Paste the text into Notes instead.');
        if (!r.ok) throw new Error(j.error || `Could not read ${file.name}.`);
        text = j.text;
      }
      addWorkSource({ label: file.name, kind: workKind(file.name), text, title: file.name.replace(/\.[^.]+$/, '') });
      workStatus(`Added ${file.name}.`);
    } catch (e) {
      workStatus(e.message, true);
    }
  }
}

async function addWorkRemote(kind) {
  const input = kind === 'github' ? $('#work-github') : $('#work-folder');
  const value = input.value.trim();
  if (!value) return input.focus();
  workStatus(kind === 'github' ? 'Asking GitHub…' : 'Reading the folder…');
  try {
    const j = await api.send('POST', '/api/source', { [kind]: value });
    addWorkSource({ label: j.link || value, kind: kind === 'github' ? 'GitHub' : 'Folder', text: j.text, title: j.title });
    if (j.link) work.link = j.link;
    input.value = '';
    workStatus(`Added ${j.title}.`);
  } catch (e) {
    workStatus(/not found|405/i.test(e.message) && !/Folder|Repository/.test(e.message) ? 'This needs the local app.' : e.message, true);
  }
}

async function copyWorkPrompt() {
  const text = workPrompt();
  let ok = false;
  try {
    await navigator.clipboard.writeText(text);
    ok = true;
  } catch {
    const ta = $('#work-prompt');
    ta.closest('details').open = true;
    ta.value = text;
    ta.select();
    try { ok = document.execCommand('copy'); } catch { /* ignore */ }
  }
  toast(ok ? 'Prompt copied. Paste it into Claude, then paste the reply in step 4.' : 'Select the prompt text and copy it (⌘C).', !ok, 4000);
}

function reviewWorkReply() {
  const status = $('#work-reply-status');
  try {
    const { bricks, questions } = parseClaudeReply($('#work-reply').value);
    if (work.link) for (const b of bricks) if (b.type === 'project' && !b.link) b.link = work.link;
    const order = ['project', 'experience', 'skills', 'certification', 'award', 'summary', 'custom'];
    const sections = order
      .map((t) => ({ title: TYPES[t].section || TYPES[t].label, type: t, blocks: bricks.filter((b) => b.type === t) }))
      .filter((s) => s.blocks.length);
    status.textContent = '';
    status.classList.remove('err');
    $('#work').close();
    imp.fileName = '';
    presentDrafts({ header: null, sections, warnings: [] }, { mode: 'work', notes: questions });
  } catch (e) {
    status.textContent = e.message;
    status.classList.add('err');
  }
}

function bindWork() {
  const dlg = $('#work');
  $('#btn-work').addEventListener('click', () => {
    renderWork();
    dlg.showModal();
  });
  $$('[data-work-close]', dlg).forEach((b) => b.addEventListener('click', () => dlg.close()));
  $('#work-file').addEventListener('change', (e) => {
    addWorkFiles(e.target.files);
    e.target.value = '';
  });
  $('#work-add-github').addEventListener('click', () => addWorkRemote('github'));
  $('#work-add-folder').addEventListener('click', () => addWorkRemote('folder'));
  $('#work-github').addEventListener('keydown', (e) => e.key === 'Enter' && addWorkRemote('github'));
  $('#work-folder').addEventListener('keydown', (e) => e.key === 'Enter' && addWorkRemote('folder'));
  $('#work-sources').addEventListener('click', (e) => {
    const del = e.target.closest('[data-src-del]');
    if (!del) return;
    work.sources = work.sources.filter((s) => s.id !== +del.dataset.srcDel);
    renderWork();
  });
  ['#work-name', '#work-role', '#work-dates', '#work-target', '#work-notes'].forEach((sel) => $(sel).addEventListener('input', renderWork));
  $('#work-copy').addEventListener('click', copyWorkPrompt);
  $('#work-go').addEventListener('click', reviewWorkReply);
}

// ---------------------------------------------------------------- tailor to a job

const tailor = { report: null, nameTouched: false };

function tailorDefaultName(job) {
  const first = String(job || '').split('\n').map((l) => l.trim()).find((l) => l.length > 2) || '';
  const short = first.length > 48 ? `${first.slice(0, 48).replace(/\s+\S*$/, '')}…` : first;
  return short ? `${short} (tailored)` : 'Tailored resume';
}

function openTailor() {
  const dlg = $('#tailor');
  const job = state.comp?.job?.text || '';
  if (job && !$('#tailor-job').value.trim()) $('#tailor-job').value = job;
  if (!tailor.nameTouched) $('#tailor-name').value = $('#tailor-job').value.trim() ? tailorDefaultName($('#tailor-job').value) : '';
  $('#tailor-reply-status').textContent = '';
  dlg.showModal();
  $('#tailor-job').focus();
}

/** Trim the weakest bullets, then the weakest bricks, until the preview fits one page. */
function fitToOnePage(scores) {
  let steps = 0;
  while (state.pages > 1.001 && steps < 60 && trimOnce(state.comp, scores)) {
    steps++;
    renderPreview();
  }
  return steps;
}

function renderTailorReport(extra = {}) {
  const r = tailor.report;
  if (!r) return;
  const chips = (list) => list.map((c) => `<span>${esc(termLabel(c, r.surface))}</span>`).join('');
  $('#tailor-matched').innerHTML = chips(r.matched);
  $('#tailor-missing').innerHTML = chips(extra.gaps || r.missing);
  $('#tailor-missing-wrap').hidden = !(extra.gaps || r.missing).length;
  const placed = new Set(state.comp.sections.flatMap((s) => s.items.map((it) => it.block)));
  const n = placed.size;
  const pages = state.pages <= 1.001 ? '1 page' : `${state.pages.toFixed(1)} pages`;
  $('#tailor-summary').textContent = extra.why || `Picked ${n} brick${n === 1 ? '' : 's'} (${pages}). Check the preview and adjust anything by hand.`;
  $('#tailor-why').innerHTML = r.why
    .filter((w) => placed.has(w.id))
    .slice(0, 8)
    .map((w) => `<li>${esc(w.label)} <span class="muted">· ${w.top.map((c) => esc(termLabel(c, r.surface))).join(', ')}</span></li>`)
    .join('');
  $('#tailor-why').hidden = !!extra.why;
  $('#tailor-result').hidden = false;
  $('#tailor-refine').hidden = false;
  $('#tailor-prompt').value = buildTailorPrompt({ jobText: state.comp.job?.text || '', bricks: state.blocks, comp: state.comp });
}

async function runTailor() {
  const jobText = $('#tailor-job').value.trim();
  if (jobText.length < 40) return toast('Paste the whole job post first', true);
  if (!state.blocks.length) return toast('Add some bricks first', true);
  if (!(await confirmDiscard())) return;
  const name = $('#tailor-name').value.trim() || tailorDefaultName(jobText);
  const { comp, report } = tailorResume({ jobText, bricks: state.blocks.filter((b) => b.type !== '_error'), base: state.comp || {}, name });
  state.comp = normalize(comp);
  state.currentId = null;
  state.expanded.clear();
  tailor.report = report;
  setDirty(true);
  renderAll();
  const trimmed = $('#tailor-fit').checked ? fitToOnePage(report.scores) : 0;
  if (trimmed) renderAll();
  renderTailorReport();
  $('#tailor-result').scrollIntoView({ behavior: 'smooth', block: 'start' });
  toast(`Built “${name}”. Save it to keep it.`, false, 3500);
}

async function copyTailorPrompt() {
  const ta = $('#tailor-prompt');
  let ok = false;
  try {
    await navigator.clipboard.writeText(ta.value);
    ok = true;
  } catch {
    ta.closest('details').open = true;
    ta.select();
    try { ok = document.execCommand('copy'); } catch { /* ignore */ }
  }
  toast(ok ? 'Prompt copied. Paste it into Claude, then paste the reply below.' : 'Select the prompt text and copy it (⌘C).', !ok, 4000);
}

function applyTailor() {
  const status = $('#tailor-reply-status');
  try {
    const res = applyTailorReply($('#tailor-reply').value, state.blocks.filter((b) => b.type !== '_error'), state.comp);
    state.comp = normalize(res.comp);
    state.expanded.clear();
    setDirty(true);
    renderAll();
    const skipped = res.skipped.length ? ` Skipped unknown ids: ${res.skipped.join(', ')}.` : '';
    status.textContent = `Applied.${skipped}`;
    status.classList.remove('err');
    renderTailorReport({ why: res.why, gaps: res.gaps.length ? res.gaps : null });
  } catch (e) {
    status.textContent = e.message;
    status.classList.add('err');
  }
}

function bindTailor() {
  const dlg = $('#tailor');
  $('#btn-tailor').addEventListener('click', openTailor);
  $$('[data-tailor-close]', dlg).forEach((b) => b.addEventListener('click', () => dlg.close()));
  $('#tailor-job').addEventListener('input', () => {
    if (!tailor.nameTouched) $('#tailor-name').value = tailorDefaultName($('#tailor-job').value);
  });
  $('#tailor-name').addEventListener('input', () => (tailor.nameTouched = !!$('#tailor-name').value.trim()));
  $('#tailor-go').addEventListener('click', () => guard(runTailor));
  $('#tailor-copy').addEventListener('click', copyTailorPrompt);
  $('#tailor-apply').addEventListener('click', applyTailor);
}

// ---------------------------------------------------------------- boot

async function boot() {
  bindTopbar();
  bindEditor();
  bindImporter();
  bindWork();
  bindTailor();
  await Promise.all([loadBlocks(), loadResumes()]);
  let last = null;
  try { last = localStorage.getItem(LS_LAST); } catch { /* ignore */ }
  const pick = state.resumes.find((r) => r.id === last) || state.resumes[0];
  if (pick) await openResume(pick.id);
  else {
    state.comp = newComp();
    renderAll();
  }
}

guard(boot);
