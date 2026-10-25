// Describe a public GitHub repository for "From work". Uses only fetch, so it runs
// in Node (the local server) and in the browser (the web version) alike.

const clip = (s, n) => (s.length > n ? `${s.slice(0, n)}\n[...cut to keep the prompt short]` : s);

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

/** Public GitHub repository: description, topics, languages, dates and README. */
export async function githubToText(url) {
  const m = String(url).trim().match(/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:[/?#]|$)/i);
  if (!m) throw httpError(400, 'That does not look like a GitHub repository link (github.com/owner/repo).');
  const [, owner, repo] = m;
  const api = `https://api.github.com/repos/${owner}/${repo}`;
  // Browsers set their own User-Agent; Node needs one for the GitHub API.
  const headers = { accept: 'application/vnd.github+json' };
  if (typeof window === 'undefined') headers['user-agent'] = 'resume-bricks';
  const token = globalThis.process?.env?.GITHUB_TOKEN;
  if (token) headers.authorization = `Bearer ${token}`;
  let info;
  try {
    let r = await fetch(api, { headers });
    if (r.status === 401 && headers.authorization) {
      delete headers.authorization; // a stale GITHUB_TOKEN should not block public repos
      r = await fetch(api, { headers });
    }
    if (r.status === 404) {
      throw httpError(404, 'Repository not found. If it is private, add its folder on your computer instead.');
    }
    if (r.status === 403) throw httpError(429, 'GitHub is rate limiting requests. Try again in a few minutes, or add the local folder.');
    if (!r.ok) throw httpError(502, `GitHub answered ${r.status}.`);
    info = await r.json();
  } catch (e) {
    if (e.status) throw e;
    throw httpError(502, 'Could not reach GitHub. Check your internet connection, or add the local folder instead.');
  }
  const [readme, langs] = await Promise.all([
    fetch(`${api}/readme`, { headers: { ...headers, accept: 'application/vnd.github.raw' } }).then((r) => (r.ok ? r.text() : '')).catch(() => ''),
    fetch(`${api}/languages`, { headers }).then((r) => (r.ok ? r.json() : {})).catch(() => ({})),
  ]);
  const lines = [
    `Repository: ${info.full_name} (${info.html_url})`,
    info.description && `Description: ${info.description}`,
    info.topics?.length && `Topics: ${info.topics.join(', ')}`,
    Object.keys(langs).length && `Languages: ${Object.keys(langs).join(', ')}`,
    `Created: ${info.created_at?.slice(0, 10)}  Last push: ${info.pushed_at?.slice(0, 10)}`,
    info.homepage && `Live site: ${info.homepage}`,
    '',
    'README:',
    clip(readme || '(no README)', 30000),
  ];
  return { title: info.name, link: info.html_url, text: lines.filter((l) => l !== undefined && l !== false && l !== 0).join('\n') };
}
