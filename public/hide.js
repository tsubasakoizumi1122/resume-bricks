// A resume hides bullets by their text (item.hide: ["bullet text", ...]), which keeps the
// YAML readable. When a brick's bullets are edited, this carries each hidden choice over
// to the edited line, so rewording a bullet never brings it back into a resume.
// Pure functions: shared by the browser and the tests.

const bulletList = (v) => (Array.isArray(v) ? v : v ? [v] : []).map(String).filter((x) => x.trim());

/** Old line index -> new line index (or -1 if the line was removed). */
export function alignBullets(oldList, newList) {
  const a = bulletList(oldList);
  const b = bulletList(newList);
  // Longest common subsequence of unchanged lines anchors the alignment.
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const map = new Array(n).fill(-1);
  const anchors = [];
  for (let i = 0, j = 0; i < n && j < m; ) {
    if (a[i] === b[j]) {
      anchors.push([i, j]);
      map[i] = j;
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  // Between anchors, changed lines pair up in order (an edited line stays "the same bullet").
  let pi = 0;
  let pj = 0;
  for (const [ai, aj] of [...anchors, [n, m]]) {
    const olds = [];
    const news = [];
    for (let i = pi; i < ai; i++) olds.push(i);
    for (let j = pj; j < aj; j++) news.push(j);
    for (let k = 0; k < Math.min(olds.length, news.length); k++) map[olds[k]] = news[k];
    pi = ai + 1;
    pj = aj + 1;
  }
  return map;
}

/** Carry hidden bullets over an edit. Returns the new hide list (in the new bullet order). */
export function remapHidden(oldList, newList, hide) {
  const a = bulletList(oldList);
  const b = bulletList(newList);
  const hidden = new Set(hide || []);
  if (!hidden.size) return [];
  const map = alignBullets(a, b);
  const keep = new Set();
  a.forEach((text, i) => {
    if (!hidden.has(text)) return;
    if (b.includes(text)) keep.add(text); // unchanged (maybe moved): still hidden
    else if (map[i] >= 0) keep.add(b[map[i]]); // reworded: hide the new wording
  });
  // Hidden lines that never were in the old list but exist now stay hidden too.
  for (const text of hidden) if (b.includes(text)) keep.add(text);
  return b.filter((t, i) => keep.has(t) && b.indexOf(t) === i);
}

/**
 * Apply a brick edit to a resume layout: returns a new layout if any hide list changed, else null.
 * Works on the resume's header and every section item that uses the brick.
 */
export function remapResume(comp, blockId, oldList, newList) {
  let changed = false;
  const sections = (comp.sections || []).map((s) => ({
    ...s,
    items: (s.items || []).map((it) => {
      if (it.block !== blockId || !it.hide?.length) return it;
      const hide = remapHidden(oldList, newList, it.hide);
      const same = hide.length === it.hide.length && hide.every((h, i) => h === it.hide[i]);
      if (same) return it;
      changed = true;
      const { hide: _, ...rest } = it;
      return hide.length ? { ...rest, hide } : rest;
    }),
  }));
  return changed ? { ...comp, sections } : null;
}
