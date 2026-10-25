import { readdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const REPO = 'yapin-js/yapin.js';
const docsRoot = dirname(createRequire(import.meta.url).resolve('yapin.js/package.json'));

/**
 * Stands in for npm and GitHub by replacing global fetch for those hosts only;
 * everything else (the mock Yapin’ API on localhost) goes through untouched.
 * Tests change `web.packument`, `web.releases` and `web.tags` to simulate a publish.
 */
export function fakeWeb() {
  const real = globalThis.fetch;
  const web = {
    calls: [],
    packument: {
      name: 'yapin.js',
      description: 'A fast, modular, zero-dependency framework for building Yapin’ bots.',
      'dist-tags': { latest: '0.1.0-beta.1' },
      time: { '0.0.0-stage': '2026-10-25T00:58:59.907Z', '0.1.0-beta.1': '2026-10-25T01:00:16.335Z' },
      versions: {
        '0.0.0-stage': { name: 'yapin.js', version: '0.0.0-stage', stub: true },
        '0.1.0-beta.1': manifest('0.1.0-beta.1'),
      },
    },
    releases: {
      'v0.1.0-beta.1': { tag_name: 'v0.1.0-beta.1', draft: false, html_url: `https://github.com/${REPO}/releases/tag/v0.1.0-beta.1`, body: '## What\'s Changed\n* First release by @ChristianRelf in https://github.com/yapin-js/yapin.js/pull/1' },
    },
    tags: new Set(['v0.1.0-beta.1']),
    /** Publishes a version to the fake registry. */
    publish(version, { time = new Date(), tag = 'latest' } = {}) {
      this.packument.versions[version] = manifest(version);
      this.packument.time[version] = time.toISOString();
      this.packument['dist-tags'][tag] = version;
    },
    restore() {
      globalThis.fetch = real;
    },
  };

  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input?.url ?? input));
    if (!['registry.npmjs.org', 'api.npmjs.org', 'api.github.com', 'raw.githubusercontent.com'].includes(url.hostname)) return real(input, init);
    web.calls.push(url.href);
    return route(web, url);
  };
  return web;
}

function manifest(version) {
  return {
    name: 'yapin.js',
    version,
    description: 'A fast, modular, zero-dependency framework for building Yapin’ bots.',
    license: 'MIT',
    engines: { node: '>=18.17' },
    dist: { unpackedSize: 443_934, fileCount: 86 },
    _npmUser: { name: 'christianrelf' },
  };
}

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const notFound = () => json({ message: 'Not Found' }, 404);

async function route(web, url) {
  const path = decodeURIComponent(url.pathname);
  if (url.hostname === 'registry.npmjs.org') {
    if (path === '/yapin.js') return json(web.packument);
    if (path === '/yapin.js/latest') return json(web.packument.versions[web.packument['dist-tags'].latest]);
    return notFound();
  }
  if (url.hostname === 'api.npmjs.org') return notFound();
  if (url.hostname === 'api.github.com') {
    let m;
    if ((m = /^\/repos\/[^/]+\/[^/]+\/releases\/tags\/(.+)$/.exec(path))) return web.releases[m[1]] ? json(web.releases[m[1]]) : notFound();
    if ((m = /^\/repos\/[^/]+\/[^/]+\/git\/ref\/tags\/(.+)$/.exec(path))) return web.tags.has(m[1]) ? json({ ref: `refs/tags/${m[1]}` }) : notFound();
    if (/^\/repos\/[^/]+\/[^/]+\/contents\/docs$/.test(path)) {
      const names = await readdir(join(docsRoot, 'docs'));
      return json(names.filter((n) => n.endsWith('.md')).map((name) => ({ name, type: 'file', path: `docs/${name}` })));
    }
    if (/^\/repos\/[^/]+\/[^/]+\/contents\/examples$/.test(path)) {
      return json([{ name: 'poll.js', type: 'file', path: 'examples/poll.js', html_url: `https://github.com/${REPO}/blob/main/examples/poll.js` }]);
    }
    return notFound();
  }
  // raw.githubusercontent.com/<owner>/<repo>/<ref>/<path>
  const [, , , , ...rest] = path.split('/');
  const file = rest.join('/');
  if (file === 'examples/poll.js') return new Response('// A poll with buttons.\nimport { Client } from \'yapin.js\';\n');
  try {
    return new Response(await readFile(join(docsRoot, file), 'utf8'));
  } catch {
    return notFound();
  }
}
