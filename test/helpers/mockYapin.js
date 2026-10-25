// Vendored from yapin.js (MIT, https://github.com/yapin-js/yapin.js/blob/main/test/helpers/mockYapin.js),
// with routes added for fetching a channel and a server, which this bot uses.
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

/**
 * A tiny stand-in for the Yapin’ Bot API: enough to log in, long-poll events, send messages,
 * answer clicks and look up members. Tests push events with `push()` and read what the bot did
 * from `sent`, `callbacks` and `commands`.
 */
export async function startMockYapin({ botId = randomUUID(), ownerId = randomUUID() } = {}) {
  const state = {
    botId,
    ownerId,
    events: [],
    nextId: 100,
    waiters: [],
    sent: [],
    edits: [],
    callbacks: [],
    commands: null,
    requests: [],
    members: new Map(),
    roles: [],
    rateLimitNext: 0,
    channels: new Map(),
    serverOwnerId: randomUUID(),
  };

  const json = (res, status, body, headers = {}) => {
    res.writeHead(status, { 'content-type': 'application/json', ...headers });
    res.end(JSON.stringify(body));
  };

  const readBody = async (req) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const text = Buffer.concat(chunks).toString('utf8');
    return text ? JSON.parse(text) : undefined;
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname.replace(/^\/api\/bot\/v1/, '');
    state.requests.push(`${req.method} ${path}`);
    if (req.headers.authorization !== 'Bot yb_test') return json(res, 401, { error: 'Missing or wrong token' });
    const body = req.method === 'GET' ? undefined : await readBody(req);
    let m;

    if (req.method === 'GET' && path === '/me') {
      return json(res, 200, { id: botId, username: 'testbot', display_name: 'Test Bot', bio: null, avatar_url: null, banner_url: null, created_at: new Date().toISOString(), bot: { name: 'Test Bot', public: false, owner_id: ownerId } });
    }
    if (req.method === 'PUT' && path === '/commands') {
      state.commands = body.commands;
      return json(res, 200, { ok: true });
    }
    if (req.method === 'GET' && path === '/events') {
      const after = Number(url.searchParams.get('after'));
      const wait = Number(url.searchParams.get('wait'));
      if (after === 0) return json(res, 200, { events: [], last: state.nextId - 1 });
      const respond = () => {
        const events = state.events.filter((e) => e.id > after).slice(0, 100);
        json(res, 200, { events, last: events.length ? events.at(-1).id : Math.max(after, state.nextId - 1) });
      };
      if (state.events.some((e) => e.id > after) || !wait) return respond();
      const waiter = { respond, timer: setTimeout(() => { state.waiters = state.waiters.filter((w) => w !== waiter); respond(); }, Math.min(wait, 2) * 1000) };
      state.waiters.push(waiter);
      req.on('close', () => clearTimeout(waiter.timer));
      return undefined;
    }
    if (req.method === 'POST' && (m = /^\/channels\/([^/]+)\/messages$/.exec(path))) {
      if (state.rateLimitNext > 0) {
        state.rateLimitNext--;
        return json(res, 429, { error: '30 messages a minute in this server', retry_after: 0.05 }, { 'retry-after': '0.05' });
      }
      const message = { id: randomUUID(), channel_id: m[1], author_id: botId, content: body.content ?? '', embeds: body.embeds ?? null, components: body.components ?? null, created_at: new Date().toISOString(), edited_at: null, attachment_path: null, reply_to_id: body.reply_to ?? null, pinned_at: null };
      state.sent.push({ channelId: m[1], body, message });
      return json(res, 201, { message });
    }
    if (req.method === 'PATCH' && (m = /^\/channels\/([^/]+)\/messages\/([^/]+)$/.exec(path))) {
      state.edits.push({ channelId: m[1], messageId: m[2], body });
      return json(res, 200, { message: { id: m[2], channel_id: m[1], author_id: botId, content: body.content ?? '', created_at: new Date().toISOString() } });
    }
    if (req.method === 'POST' && (m = /^\/interactions\/([^/]+)\/([^/]+)\/callback$/.exec(path))) {
      state.callbacks.push({ id: m[1], token: m[2], body });
      return json(res, 200, {});
    }
    if (req.method === 'GET' && (m = /^\/servers\/([^/]+)\/members\/([^/]+)$/.exec(path))) {
      const member = state.members.get(m[2]);
      return member ? json(res, 200, { member }) : json(res, 404, { error: 'Not a member' });
    }
    if (req.method === 'GET' && (m = /^\/servers\/([^/]+)\/roles$/.exec(path))) {
      return json(res, 200, { roles: state.roles });
    }
    if (req.method === 'GET' && (m = /^\/users\/([^/]+)$/.exec(path))) {
      return json(res, 200, { user: { id: m[1], username: `user-${m[1].slice(0, 4)}`, display_name: null, avatar_path: null, badges: [] } });
    }
    if (req.method === 'PUT' && path === '/me/status') return json(res, 200, { ok: true });
    if (req.method === 'GET' && (m = /^\/channels\/([^/]+)$/.exec(path))) {
      const channel = state.channels.get(m[1]);
      return channel ? json(res, 200, { channel }) : json(res, 404, { error: 'Unknown channel' });
    }
    if (req.method === 'GET' && (m = /^\/servers\/([^/]+)$/.exec(path))) {
      return json(res, 200, { server: { id: m[1], name: 'Test server', owner_id: state.serverOwnerId, member_count: 3 } });
    }
    return json(res, 404, { error: `No route ${req.method} ${path}` });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  return {
    state,
    baseURL: `http://127.0.0.1:${port}/api/bot/v1`,
    /** Queues an event and wakes any waiting long poll. Returns its id. */
    push(type, data) {
      const event = { id: state.nextId++, type, data, created_at: new Date().toISOString() };
      state.events.push(event);
      const waiters = state.waiters;
      state.waiters = [];
      for (const w of waiters) {
        clearTimeout(w.timer);
        w.respond();
      }
      return event.id;
    },
    close() {
      for (const w of state.waiters) clearTimeout(w.timer);
      server.closeAllConnections?.();
      return new Promise((resolve) => server.close(resolve));
    },
  };
}

/** Resolves when `fn()` is truthy, polling every 10 ms; rejects after `timeout`. */
export async function until(fn, timeout = 3000) {
  const start = Date.now();
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() - start > timeout) throw new Error('Timed out waiting for condition');
    await new Promise((r) => setTimeout(r, 10));
  }
}
