import { config } from '../config.js';

const USER_AGENT = 'yapin-utils (+https://github.com/yapin-js/yapin-utils)';

/** GET a URL as JSON or text, with a timeout. Returns null on 404. */
export async function get(url, { as = 'json', headers = {}, timeout = 15_000 } = {}) {
  const res = await fetch(url, {
    headers: { 'user-agent': USER_AGENT, ...headers },
    signal: AbortSignal.timeout(timeout),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GET ${url} answered ${res.status} ${res.statusText}`);
  return as === 'text' ? res.text() : res.json();
}

let githubTokenRejected = false;

/**
 * The GitHub REST API, with the token from GITHUB_TOKEN when there is one. If GitHub rejects
 * the token, it's dropped and the request goes again without it (60 requests an hour).
 */
export async function github(path, options = {}) {
  const headers = { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', ...options.headers };
  const url = `https://api.github.com${path}`;
  if (config.githubToken && !githubTokenRejected) {
    try {
      return await get(url, { ...options, headers: { ...headers, authorization: `Bearer ${config.githubToken}` } });
    } catch (error) {
      if (!/ answered 401 /.test(error.message)) throw error;
      githubTokenRejected = true;
      console.warn('[yapin-utils] GitHub rejected GITHUB_TOKEN; carrying on without it. Fix or remove it in .env.');
    }
  }
  return get(url, { ...options, headers });
}

/** A file from the repo at a branch or tag. */
export function githubRaw(path, ref = config.branch) {
  return get(`https://raw.githubusercontent.com/${config.repo}/${encodeURIComponent(ref)}/${path}`, { as: 'text' });
}
