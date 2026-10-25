import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { DocsLibrary } from '../lib/docs/library.js';
import { chunkComponents, chunkEmbed, entryEmbed, homeEmbed, resultsComponents, resultsEmbed } from '../lib/docs/render.js';
import { chunkMarkdown, releaseNotesToChat, slugify, tableToList, toChatMarkdown } from '../lib/markdown.js';

let docs;

before(async () => {
  docs = await new DocsLibrary().loadPackage();
});

test('every docs page is loaded, in the README order', () => {
  assert.ok(docs.pages.size >= 20, `only ${docs.pages.size} pages`);
  assert.deepEqual(docs.order.slice(0, 4), ['overview', 'getting-started', 'client', 'events']);
  assert.equal(docs.pages.get('components').title, 'Buttons and Components V2');
  assert.equal(docs.pages.get('commands').blurb, 'Options and types, checks, cooldowns, subcommands, middleware, files');
});

test('every chunk of every page is a valid embed with valid buttons', () => {
  // The builders throw on any Yapin’ limit, so building them all is the check.
  for (const page of docs.pages.values()) {
    for (let n = 0; n < page.chunks.length; n++) {
      const embed = chunkEmbed(docs, page, n);
      assert.ok(embed.length <= 6000, `${page.slug} #${n} is ${embed.length} characters`);
      chunkComponents(page, n, '00000000-0000-0000-0000-000000000000');
    }
  }
  homeEmbed(docs, [], '/');
});

test('code fences survive chunking intact', () => {
  for (const page of docs.pages.values()) {
    for (const { text } of page.chunks) {
      const fences = text.match(/^\s*```/gm) ?? [];
      assert.equal(fences.length % 2, 0, `unbalanced code fence in ${page.slug}`);
    }
  }
  const long = `intro\n\n\`\`\`js\n${'const x = 1;\n'.repeat(600)}\`\`\``;
  const parts = chunkMarkdown(long, 1000);
  assert.ok(parts.length > 1);
  for (const part of parts) {
    assert.ok(part.length <= 1000);
    assert.equal((part.match(/```/g) ?? []).length % 2, 0);
  }
});

test('topics resolve from slugs, titles and common words', () => {
  const cases = { buttons: 'components', cogs: 'modules', 'discord.js': 'migrating-from-discord-js', 'Getting Started': 'getting-started', intents: 'gateway', embed: 'embeds', yapper: 'migrating-from-yapper' };
  for (const [query, slug] of Object.entries(cases)) assert.equal(docs.resolvePage(query)?.slug, slug, query);
  assert.equal(docs.resolvePage('nonsense words'), null);
  assert.equal(docs.resolveSection(docs.pages.get('commands'), 'cooldowns').heading, 'Cooldowns');
});

test('search finds the section a question is about', () => {
  const top = (q) => docs.search(q, { limit: 3 }).map((r) => r.unit.heading);
  assert.ok(top('how do I add buttons').includes('Buttons'));
  assert.ok(top('wait for a reply').some((h) => /Collectors|Messages/.test(h)));
  assert.equal(top('per-server prefix')[0], 'Prefixes');
  assert.equal(top('catch up after restart')[0], 'Catching up after a restart');
  assert.equal(top('music bot')[0], 'Music bots');
  assert.deepEqual(docs.search('the of and'), []);
});

test('API lookups come from the reference tables', () => {
  const first = (q) => docs.lookup(q)[0];
  assert.equal(first('messageCreate').unit.page.slug, 'events');
  assert.equal(first('ctx.reply').unit.page.slug, 'commands');
  assert.equal(first('TokenInvalid').unit.page.slug, 'errors');
  assert.equal(first('setTitle()').unit.page.slug, 'embeds');
  assert.equal(first('Events.ClientReady').label, '`ready` (`Events.ClientReady`)');
  assert.deepEqual(docs.lookup('definitelyNotAThing'), []);
  entryEmbed(docs, docs.lookup('messageCreate'), 'messageCreate');
  entryEmbed(docs, docs.lookup('fetch'), 'fetch');
});

test('search results build an embed and one button per result', () => {
  const results = docs.search('rate limits', { limit: 5 });
  resultsEmbed(docs, 'rate limits', results);
  const [row] = resultsComponents(results, 'u');
  assert.equal(row.toJSON().components.length, results.length);
});

test('markdown is converted for chat', () => {
  assert.equal(slugify('Coming from discord.js'), 'coming-from-discordjs');
  assert.equal(slugify('`cache.messages` / limits'), 'cachemessages--limits');
  assert.equal(
    tableToList(['| Event | Arguments | When |', '| --- | --- | --- |', '| `ready` | `client` | Once |']),
    '*Event — Arguments — When*\n• `ready` — `client` — Once',
  );
  const md = toChatMarkdown('See [Commands](commands.md#options) and [this](#here).\n\n### Sub\n\n```js\n| not | a table |\n```', 'https://github.com/o/r/blob/main/docs/x.md');
  assert.match(md, /\[Commands\]\(https:\/\/github\.com\/o\/r\/blob\/main\/docs\/commands\.md#options\)/);
  assert.match(md, /\[this\]\(https:\/\/github\.com\/o\/r\/blob\/main\/docs\/x\.md#here\)/);
  assert.match(md, /\*\*Sub\*\*/);
  assert.match(md, /\| not \| a table \|/);
});

test('GitHub release notes are tidied', () => {
  const notes = releaseNotesToChat('<!-- generated -->\n## What\'s Changed\n* Thing by @someone in https://github.com/yapin-js/yapin.js/pull/12\n\n**Full Changelog**: https://github.com/yapin-js/yapin.js/compare/v1...v2', 'yapin-js/yapin.js');
  assert.doesNotMatch(notes, /<!--/);
  assert.match(notes, /\*\*What's Changed\*\*/);
  assert.match(notes, /\[#12\]\(https:\/\/github\.com\/yapin-js\/yapin\.js\/pull\/12\)/);
  assert.match(notes, /\[@someone\]\(https:\/\/github\.com\/someone\)/);
  assert.match(notes, /\[v1\.\.\.v2\]/);
});
