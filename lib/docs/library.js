import { readdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { config } from '../../config.js';
import { github, githubRaw } from '../http.js';
import { normalizeName, parsePage } from './parse.js';
import { SearchIndex } from './search.js';

/** Extra words people use for a page, on top of the words in its name and title. */
const ALIASES = {
  overview: ['readme', 'intro', 'about', 'yapin.js', 'yapinjs', 'features'],
  'getting-started': ['start', 'setup', 'install', 'quickstart', 'first', 'begin', 'token'],
  client: ['options', 'presence', 'avatar', 'login'],
  events: ['event', 'listeners', 'on'],
  commands: ['command', 'slash', 'prefix', 'prefixes', 'cooldowns', 'subcommands', 'middleware', 'arguments', 'args'],
  components: ['buttons', 'button', 'components-v2', 'v2', 'layouts', 'interactions', 'containers'],
  embeds: ['embed', 'cards', 'embedbuilder'],
  structures: ['message', 'user', 'server', 'member', 'channel', 'role', 'permissions'],
  managers: ['cache', 'caching', 'fetch', 'manager'],
  collectors: ['collector', 'await', 'awaitmessages'],
  modules: ['module', 'cogs', 'cog', 'hot-reload', 'reload', 'plugins'],
  voice: ['music', 'audio', 'livekit'],
  webhooks: ['webhook'],
  oauth2: ['oauth', 'login-with-yapin', 'auth'],
  gateway: ['polling', 'intents', 'websocket', 'ws', 'transport'],
  rest: ['api', 'ratelimits', 'rate-limits', 'routes', 'http'],
  errors: ['error', 'errorcodes', 'exceptions'],
  utilities: ['utils', 'util', 'collection', 'formatters', 'duration'],
  hosting: ['host', 'deploy', 'pm2', 'verified', 'verification'],
  'migrating-from-discord-js': ['discord', 'discord.js', 'discordjs', 'djs'],
  'migrating-from-yapper': ['yapper', 'yapper.js', 'sdk'],
};

/**
 * Every page of the yapin.js docs, searchable. Loads from the installed package first
 * (always there, matches the version you run), and can refresh from GitHub at any branch or tag.
 */
export class DocsLibrary {
  pages = new Map();
  order = [];
  units = [];
  entries = [];
  source = null;
  #names = new Map();
  #index = new SearchIndex([]);

  /** `files`: [{ path: 'docs/commands.md' | 'README.md', markdown }]. Replaces everything at once. */
  build(files, source) {
    const ref = source.ref ?? config.branch;
    const base = `https://github.com/${config.repo}/blob/${ref}/`;
    const readme = files.find((f) => f.path === 'README.md');
    const listed = readme ? readmeTopics(readme.markdown) : [];

    const pages = new Map();
    for (const file of files) {
      const slug = file.path === 'README.md' ? 'overview' : file.path.replace(/^docs\//, '').replace(/\.md$/, '');
      const page = parsePage(file.markdown, { slug, path: file.path, fileURL: `${base}${file.path}` });
      if (slug === 'overview') page.title = 'Overview';
      page.blurb = listed.find((t) => t.slug === slug)?.blurb ?? (slug === 'overview' ? 'What yapin.js is, in one page' : null);
      pages.set(slug, page);
    }

    const ordered = ['overview', ...listed.map((t) => t.slug)].filter((s) => pages.has(s));
    const rest = [...pages.keys()].filter((s) => !ordered.includes(s)).sort();
    this.order = [...new Set([...ordered, ...rest])];
    this.pages = new Map(this.order.map((s) => [s, pages.get(s)]));
    this.units = this.order.flatMap((s) => this.pages.get(s).units);
    this.entries = this.order.flatMap((s) => this.pages.get(s).entries);
    this.#index = new SearchIndex(this.units);
    this.#names = new Map();
    for (const page of this.pages.values()) {
      const words = [page.slug, page.title, ...page.slug.split('-'), ...(ALIASES[page.slug] ?? [])];
      for (const word of words) {
        const key = normalizeName(word).replace(/\s+/g, '-');
        // The page's own name wins over another page's alias.
        if (!this.#names.has(key) || key === page.slug) this.#names.set(key, page);
      }
    }
    this.source = { ...source, ref, loadedAt: new Date(), pages: this.pages.size, sections: this.units.length };
    return this;
  }

  /** The docs that ship inside node_modules/yapin.js. */
  async loadPackage() {
    const require = createRequire(import.meta.url);
    const pkgPath = require.resolve(`${config.packageName}/package.json`);
    const root = dirname(pkgPath);
    const { version } = JSON.parse(await readFile(pkgPath, 'utf8'));
    const files = [{ path: 'README.md', markdown: await readFile(join(root, 'README.md'), 'utf8') }];
    for (const name of await readdir(join(root, 'docs'))) {
      if (!name.endsWith('.md') || name === 'README.md') continue;
      files.push({ path: `docs/${name}`, markdown: await readFile(join(root, 'docs', name), 'utf8') });
    }
    return this.build(files, { kind: 'package', version });
  }

  /** The docs on GitHub at a branch or tag. Leaves the current docs in place if anything fails. */
  async loadGitHub(ref = config.branch) {
    const listing = await github(`/repos/${config.repo}/contents/docs?ref=${encodeURIComponent(ref)}`);
    if (!Array.isArray(listing)) throw new Error(`No docs folder in ${config.repo} at ${ref}`);
    const names = listing.filter((f) => f.type === 'file' && f.name.endsWith('.md') && f.name !== 'README.md').map((f) => f.name);
    const files = await Promise.all([
      githubRaw('README.md', ref).then((markdown) => ({ path: 'README.md', markdown })),
      ...names.map((name) => githubRaw(`docs/${name}`, ref).then((markdown) => ({ path: `docs/${name}`, markdown }))),
    ]);
    if (files.some((f) => f.markdown == null)) throw new Error(`Some docs files at ${ref} couldn't be downloaded`);
    return this.build(files, { kind: 'github', ref });
  }

  /** A page by slug, title or a common word for it: 'buttons' → Buttons and Components V2. */
  resolvePage(query) {
    if (!query) return null;
    const key = normalizeName(query).replace(/\.md$/, '').replace(/\s+/g, '-');
    return this.#names.get(key) ?? this.#names.get(key.replace(/s$/, '')) ?? null;
  }

  /** A section of a page by its heading or anchor, loosely. */
  resolveSection(page, query) {
    const key = normalizeName(query).replace(/\s+/g, '-');
    return page.units.find((u) => u.anchor === key)
      ?? page.units.find((u) => u.anchor.startsWith(key))
      ?? page.units.find((u) => u.anchor.includes(key))
      ?? null;
  }

  search(query, options) {
    return this.#index.search(query, options);
  }

  /** API reference rows by name: `ctx.reply`, `messageCreate`, `TokenInvalid`, `cache.messages`. */
  lookup(query, { limit = 10 } = {}) {
    const key = normalizeName(query).replace(/\(.*\)$/, '');
    if (!key) return [];
    const exact = this.entries.filter((e) => e.names.includes(key));
    if (exact.length) return exact.slice(0, limit);
    const starts = this.entries.filter((e) => e.names.some((n) => n.startsWith(key)));
    const contains = this.entries.filter((e) => !starts.includes(e) && e.names.some((n) => n.includes(key)));
    return [...starts, ...contains].slice(0, limit);
  }
}

/** The README's documentation table: order, and a one-line blurb per page. */
function readmeTopics(markdown) {
  const topics = [];
  for (const m of markdown.matchAll(/^\|\s*\[([^\]]+)\]\(docs\/([\w-]+)\.md\)\s*\|\s*([^|]+?)\s*\|/gm)) {
    topics.push({ title: m[1], slug: m[2], blurb: m[3] });
  }
  return topics;
}
