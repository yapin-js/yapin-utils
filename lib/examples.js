import { config } from '../config.js';
import { github, githubRaw } from './http.js';

const TTL = 60 * 60_000;
let cache = null;

/** The runnable bots in the repo's examples/ folder, cached for an hour. */
export async function listExamples() {
  if (cache && Date.now() - cache.at < TTL) return cache.list;
  const listing = await github(`/repos/${config.repo}/contents/examples?ref=${encodeURIComponent(config.branch)}`);
  const list = (Array.isArray(listing) ? listing : [])
    .map((f) => ({ name: f.name.replace(/\.js$/, ''), path: f.path, dir: f.type === 'dir', url: f.html_url }))
    .sort((a, b) => a.name.localeCompare(b.name));
  cache = { at: Date.now(), list };
  return list;
}

export async function findExample(name) {
  const key = name.toLowerCase().replace(/\.js$/, '').replace(/[\s_]+/g, '-');
  const list = await listExamples();
  const example = list.find((e) => e.name === key) ?? list.find((e) => e.name.includes(key));
  if (!example) return null;
  const code = example.dir ? null : await githubRaw(example.path);
  return { ...example, code };
}

/** The comment block at the top of an example, which says what it is and how to run it. */
export function exampleSummary(code) {
  const lines = [];
  for (const line of code.split('\n')) {
    const m = /^\s*\/\/\s?(.*)$/.exec(line);
    if (!m) break;
    lines.push(m[1]);
  }
  return lines.join('\n').trim();
}
