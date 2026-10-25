import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fakeWeb } from './helpers/fakeWeb.js';
import { startMockYapin, until } from './helpers/mockYapin.js';

const SERVER = randomUUID();
const GENERAL = randomUUID();
const ANNOUNCE = randomUUID();
const NEWS = randomUUID();
const ALICE = randomUUID(); // has Manage Server
const BOB = randomUUID(); // has no roles

let web;
let mock;
let client;
let store;
let docs;
let releases;
const errors = [];

const message = (content, { author = ALICE, ...extra } = {}) => ({
  id: randomUUID(),
  channel_id: GENERAL,
  channel_name: 'general',
  server_id: SERVER,
  author_id: author,
  author: { id: author, username: author === ALICE ? 'alice' : 'bob', display_name: null },
  content,
  created_at: new Date().toISOString(),
  mentioned: false,
  author_bot: false,
  ...extra,
});

/** Sends a message as someone and waits for the bot's next post in that channel. */
async function say(content, options) {
  const before = mock.state.sent.length;
  mock.push('message', message(content, options));
  return until(() => mock.state.sent.slice(before).find((s) => s.channelId === GENERAL));
}

function click(customId, user = ALICE) {
  const id = randomUUID();
  mock.push('interaction', { id, token: 'tok', type: 'button', custom_id: customId, message_id: randomUUID(), channel_id: GENERAL, server_id: SERVER, user_id: user, username: 'x', expires_at: new Date(Date.now() + 900_000).toISOString() });
  return until(() => mock.state.callbacks.find((c) => c.id === id));
}

const buttonIds = (body) => (body.components ?? []).flatMap((row) => row.components).map((b) => b.custom_id ?? b.url);

before(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'yapin-utils-'));
  process.env.DATA_FILE = join(dir, 'state.json');
  process.env.RELEASE_CHANNEL_IDS = ANNOUNCE;
  web = fakeWeb();

  mock = await startMockYapin();
  const member = (id, roles) => ({ id, username: id === ALICE ? 'alice' : 'bob', display_name: null, nickname: null, joined_at: new Date().toISOString(), roles });
  mock.state.members.set(ALICE, member(ALICE, ['r-admin']));
  mock.state.members.set(BOB, member(BOB, []));
  mock.state.roles = [{ id: 'r-admin', name: 'Admin', color: null, position: 1, manage_server: true, manage_messages: true, perms: {} }];
  mock.state.channels.set(NEWS, { id: NEWS, name: 'news', type: 'text', server_id: SERVER });

  const { Client, Events } = await import('yapin.js');
  ({ docs, store } = await import('../lib/shared.js'));
  await docs.loadPackage();

  client = new Client({ baseURL: mock.baseURL, transport: 'polling', logger: false, components: { autoAckAfter: 150 } });
  client.on(Events.Error, (e) => errors.push(e));
  client.on(Events.CommandError, (e) => errors.push(e));
  await client.modules.load(fileURLToPath(new URL('../modules', import.meta.url)));
  await client.login('yb_test');
  releases = client.modules.get('releases').instances[0];
});

after(async () => {
  for (const name of ['docs', 'releases', 'utility']) await client.modules.unload(name).catch(() => {});
  await client.destroy();
  await mock.close();
  web.restore();
});

test('commands are registered with Yapin’, hidden ones left out', async () => {
  await until(() => mock.state.commands);
  const names = mock.state.commands.map((c) => c.name).sort();
  for (const name of ['about', 'api', 'docs', 'example', 'help', 'install', 'npm', 'ping', 'release', 'releases']) assert.ok(names.includes(name), name);
  assert.ok(!names.includes('announce') && !names.includes('docsync'));
});

test('/help shows every topic and the bot’s commands', async () => {
  const { body } = await say('/help');
  const [embed] = body.embeds;
  assert.equal(embed.title, 'What do you need help with?');
  assert.match(embed.description, /\/help getting-started/);
  assert.ok(embed.fields.some((f) => f.name.includes('Releases') && f.value.includes('/release')));
  assert.ok(buttonIds(body).includes(`docs:go:getting-started:0:${ALICE}`));
});

test('/help <topic> <section> opens that section', async () => {
  const { body } = await say('/help commands cooldowns');
  assert.match(body.embeds[0].title, /Commands › Preconditions › Cooldowns/);
  assert.match(body.embeds[0].url, /docs\/commands\.md#cooldowns$/);
});

test('/help <command> explains one of the bot’s commands', async () => {
  const { body } = await say('/help releases');
  assert.equal(body.embeds[0].title, '/releases');
  assert.ok(body.embeds[0].fields.some((f) => f.name === 'Subcommands' && f.value.includes('channel')));
});

test('/help with a question falls back to the best section', async () => {
  const { body } = await say('/help how do I make an embed');
  assert.match(body.embeds[0].title, /Embed|What you can send/);
});

test('paging buttons update for the asker and send a private copy to anyone else', async () => {
  const mine = await click(`docs:next:commands:1:${ALICE}`, ALICE);
  assert.equal(mine.body.type, 'update');
  assert.match(mine.body.embeds[0].footer.text, /^Page 2 of/);
  const theirs = await click(`docs:next:commands:1:${ALICE}`, BOB);
  assert.equal(theirs.body.type, 'ephemeral');
  assert.equal(theirs.body.components, undefined);
  const home = await click(`docs:home:overview:0:${ALICE}`, ALICE);
  assert.equal(home.body.embeds[0].title, 'What do you need help with?');
});

test('/docs searches and offers a button per result', async () => {
  const { body } = await say('/docs how do I wait for a reply');
  assert.match(body.embeds[0].title, /Results for/);
  assert.ok(buttonIds(body).some((id) => id.startsWith('docs:go:collectors:')));
});

test('/api looks up reference entries, and falls back to search', async () => {
  const hit = await say('/api messageCreate');
  assert.equal(hit.body.embeds[0].title, '`messageCreate`');
  assert.match(hit.body.embeds[0].description, /\*\*Arguments:\*\*/);
  const miss = await say('/api how to shard');
  assert.match(miss.body.embeds[0].title, /No API entry/);
});

test('@mentioning the bot with a question answers from the docs', async () => {
  const { body } = await say(`<@${mock.state.botId}> how do I catch up after a restart?`, { mentioned: true });
  assert.match(body.embeds[0].title, /Catching up after a restart/);
});

test('@mention + a command name is left to the command', async () => {
  const { body } = await say(`<@${mock.state.botId}> install`, { mentioned: true });
  assert.equal(body.embeds[0].title, 'Start a yapin.js bot');
});

test('/example lists and shows the example bots', async () => {
  const list = await say('/example');
  assert.match(list.body.embeds[0].description, /`poll`/);
  const one = await say('/example poll');
  assert.match(one.body.embeds[0].description, /A poll with buttons/);
});

test('/ping, /about and /npm answer', async () => {
  const ping = await say('/ping');
  await until(() => mock.state.edits.find((e) => e.messageId === ping.message.id));
  const about = await say('/about');
  assert.equal(about.body.embeds[0].title, 'yapin.js utilities');
  const npm = await say('/npm yapin.js');
  assert.equal(npm.body.embeds[0].title, 'yapin.js 0.1.0-beta.1');
});

test('the first check remembers existing versions instead of announcing them', async () => {
  const before = mock.state.sent.length;
  assert.deepEqual(await releases.check(), []);
  assert.deepEqual(store.data.releases.seen, ['0.1.0-beta.1']);
  assert.equal(mock.state.sent.length, before);
});

test('a new version is announced with its notes and link buttons', async () => {
  web.publish('0.2.0', { time: new Date(Date.now() - 3_600_000) });
  web.releases['v0.2.0'] = { tag_name: 'v0.2.0', draft: false, html_url: 'https://github.com/yapin-js/yapin.js/releases/tag/v0.2.0', body: '## What\'s Changed\n* Select menus by @someone in https://github.com/yapin-js/yapin.js/pull/7' };
  web.tags.add('v0.2.0');

  assert.deepEqual(await releases.check(), ['0.2.0']);
  const post = mock.state.sent.find((s) => s.channelId === ANNOUNCE);
  const [embed] = post.body.embeds;
  assert.equal(embed.title, '📦 yapin.js 0.2.0 is out');
  assert.equal(embed.url, 'https://www.npmjs.com/package/yapin.js/v/0.2.0');
  assert.match(embed.description, /Select menus by \[@someone\]/);
  assert.ok(embed.fields.some((f) => f.name === 'Previous' && f.value === '`0.1.0-beta.1`'));
  assert.deepEqual(buttonIds(post.body), [
    'https://www.npmjs.com/package/yapin.js/v/0.2.0',
    'https://github.com/yapin-js/yapin.js/releases/tag/v0.2.0',
    'https://github.com/yapin-js/yapin.js/compare/v0.1.0-beta.1...v0.2.0',
    'release:install:0.2.0',
  ]);
  // Seen versions are saved, and the docs are reloaded from the release's tag.
  const saved = JSON.parse(await readFile(process.env.DATA_FILE, 'utf8'));
  assert.ok(saved.releases.seen.includes('0.2.0'));
  await until(() => docs.source.kind === 'github');
  assert.equal(docs.source.ref, 'v0.2.0');
  assert.deepEqual(await releases.check(), [], 'not announced twice');
});

test('a fresh version waits for its release notes, then posts', async () => {
  web.publish('0.3.0-beta.1', { tag: 'next' });
  assert.deepEqual(await releases.check(), []);
  web.releases['v0.3.0-beta.1'] = { tag_name: 'v0.3.0-beta.1', draft: false, html_url: 'https://github.com/yapin-js/yapin.js/releases/tag/v0.3.0-beta.1', body: 'Beta notes' };
  assert.deepEqual(await releases.check(), ['0.3.0-beta.1']);
  const post = mock.state.sent.filter((s) => s.channelId === ANNOUNCE).at(-1);
  assert.ok(post.body.embeds[0].fields.some((f) => f.name === 'Channel' && f.value === '`next`'));
  assert.ok(post.body.embeds[0].fields.some((f) => f.name === 'Type' && f.value === 'Pre-release'));
});

test('the Install button answers privately', async () => {
  const cb = await click('release:install:0.2.0');
  assert.equal(cb.body.type, 'ephemeral');
  assert.match(cb.body.embeds[0].description, /npm install yapin\.js@0\.2\.0/);
});

test('/release shows the latest, or a version or dist-tag', async () => {
  assert.equal((await say('/release')).body.embeds[0].title, '📦 yapin.js 0.2.0 is out');
  assert.equal((await say('/release next')).body.embeds[0].title, '📦 yapin.js 0.3.0-beta.1 is out');
  assert.match((await say('/release 9.9.9')).body.content, /no yapin\.js version `9\.9\.9`/);
});

test('/releases channel needs Manage Server, and saves the channel', async () => {
  const denied = await say(`/releases channel <#${NEWS}>`, { author: BOB });
  assert.doesNotMatch(denied.body.content ?? '', /Done/);
  assert.equal(store.data.servers[SERVER]?.releaseChannelId, undefined);

  const before = mock.state.sent.length;
  mock.push('message', message(`/releases channel <#${NEWS}>`));
  await until(() => mock.state.sent.slice(before).some((s) => s.body.content?.startsWith('Done.')));
  assert.ok(mock.state.sent.slice(before).some((s) => s.channelId === NEWS && /will be posted here/.test(s.body.content)));
  assert.equal(store.data.servers[SERVER].releaseChannelId, NEWS);
  assert.deepEqual(releases.targets().sort(), [ANNOUNCE, NEWS].sort());

  const status = await say('/releases status');
  assert.ok(status.body.embeds[0].fields.some((f) => f.name === 'Posting in' && f.value === `<#${NEWS}>`));
  await say('/releases off');
  assert.equal(store.data.servers[SERVER].releaseChannelId, undefined);
});

test('no unexpected errors were reported', () => {
  assert.deepEqual(errors.map((e) => e.message), []);
});
