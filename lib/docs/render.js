import { ActionRowBuilder, ButtonBuilder, EmbedBuilder } from 'yapin.js';
import { links } from '../../config.js';
import { truncate } from '../markdown.js';

export const COLOR = 'Yapin';

/**
 * Button ids carry everything a click needs: `docs:<action>:<page>:<chunk>:<userId>`.
 * The person who asked can page through in place; anyone else gets their own private copy.
 */
export const docsButtonId = (action, slug, n, userId) => `docs:${action}:${slug}:${n}:${userId}`;
export const DOCS_BUTTON = 'docs:{action}:{slug}:{n}:{userId}';

/** One chunk of a docs page as a card. */
export function chunkEmbed(docs, page, n) {
  const chunk = page.chunks[n];
  const { unit } = chunk;
  const embed = new EmbedBuilder()
    .setColor(COLOR)
    .setAuthor({ name: `yapin.js docs · ${page.title}`, iconURL: links.icon(), url: page.url })
    .setTitle(truncate(`${unit.trail}${chunk.parts > 1 ? ` (${chunk.part + 1}/${chunk.parts})` : ''}`, 256))
    .setURL(unit.url)
    .setDescription(chunk.text)
    .setFooter({ text: `Page ${n + 1} of ${page.chunks.length} · ${sourceLabel(docs)}` });

  if (n === 0 && page.units.length > 1) {
    const sections = page.units.filter((u) => u.level === 2).map((u) => `• ${u.heading}`);
    if (sections.length) {
      const hint = `\n\nJump to one with \`/help ${page.slug} <section>\``;
      embed.addFields({ name: 'On this page', value: `${truncate(sections.join('\n'), 1024 - hint.length)}${hint}` });
    }
  }
  return embed;
}

/** Paging buttons and a link to the section on GitHub. */
export function chunkComponents(page, n, userId) {
  const last = page.chunks.length - 1;
  const rows = [];
  if (last > 0) {
    rows.push(new ActionRowBuilder(
      ButtonBuilder.secondary('⏮', docsButtonId('first', page.slug, 0, userId)).setDisabled(n === 0),
      ButtonBuilder.primary('◀ Back', docsButtonId('prev', page.slug, Math.max(0, n - 1), userId)).setDisabled(n === 0),
      ButtonBuilder.primary('Next ▶', docsButtonId('next', page.slug, Math.min(last, n + 1), userId)).setDisabled(n === last),
      ButtonBuilder.secondary('⏭', docsButtonId('last', page.slug, last, userId)).setDisabled(n === last),
      ButtonBuilder.secondary('🏠 Topics', docsButtonId('home', 'overview', 0, userId)),
    ));
  }
  rows.push(new ActionRowBuilder(
    ButtonBuilder.link('Read on GitHub', page.chunks[n].unit.url),
    ...(last > 0 ? [] : [ButtonBuilder.secondary('🏠 Topics', docsButtonId('home', 'overview', 0, userId))]),
  ));
  return rows;
}

/** The front page of /help: every docs topic, and what this bot can do. */
export function homeEmbed(docs, commands, prefix = '/') {
  const topics = docs.order.map((slug) => {
    const page = docs.pages.get(slug);
    return `\`${prefix}help ${slug}\` **${page.title}**${page.blurb ? ` — ${page.blurb}` : ''}`;
  });
  const embed = new EmbedBuilder()
    .setColor(COLOR)
    .setAuthor({ name: 'yapin.js help desk', iconURL: links.icon(), url: links.repo() })
    .setTitle('What do you need help with?')
    .setURL(links.repo())
    .setDescription(truncate([
      `I know the whole **yapin.js** documentation. Open a topic below, ask \`${prefix}docs <question>\`, `
        + `look up a name with \`${prefix}api <name>\`, or just @mention me with a question.`,
      '',
      '**📚 Topics**',
      ...topics,
    ].join('\n'), 4096))
    .setFooter({ text: sourceLabel(docs) });

  const groups = new Map();
  for (const command of commands) {
    if (command.hidden) continue;
    const group = command.category ?? 'Other';
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(`\`${prefix}${command.name}\` ${command.description}`);
  }
  for (const [group, lines] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    embed.addFields({ name: `🛠️ ${group}`, value: truncate(lines.join('\n'), 1024) });
  }
  return embed;
}

export function homeComponents(docs, userId) {
  const shortcuts = ['getting-started', 'commands', 'components', 'events', 'embeds'].filter((s) => docs.pages.has(s));
  return [
    new ActionRowBuilder(...shortcuts.map((slug) => ButtonBuilder.secondary(docs.pages.get(slug).title.replace(/ and .*/, ''), docsButtonId('go', slug, 0, userId)))),
    new ActionRowBuilder(
      ButtonBuilder.link('GitHub', links.repo()),
      ButtonBuilder.link('npm', links.npm()),
      ButtonBuilder.link('Examples', `${links.repo()}/tree/main/examples`),
    ),
  ];
}

/** /help <command> for one of this bot's own commands. */
export function commandEmbed(command, prefix = '/') {
  const embed = new EmbedBuilder()
    .setColor(COLOR)
    .setTitle(`${prefix}${command.path}`)
    .setDescription(command.description || 'No description.')
    .addFields({ name: 'Usage', value: `\`${command.usage(prefix)}\`` });
  if (command.aliases.length) embed.addFields({ name: 'Aliases', value: command.aliases.map((a) => `\`${a}\``).join(', '), inline: true });
  if (command.cooldown) embed.addFields({ name: 'Cooldown', value: `${command.cooldown.duration / 1000}s`, inline: true });
  const options = command.options.filter((o) => o.description);
  if (options.length) embed.addFields({ name: 'Options', value: truncate(options.map((o) => `\`${o.name}\` ${o.description}`).join('\n'), 1024) });
  if (command.subcommands.size) {
    embed.addFields({ name: 'Subcommands', value: truncate(command.subcommands.map((s) => `\`${s.name}\` ${s.description}`).join('\n'), 1024) });
  }
  if (command.examples.length) embed.addFields({ name: 'Examples', value: truncate(command.examples.map((e) => `\`${e}\``).join('\n'), 1024) });
  return embed;
}

/** /docs <question>: the best matches, each with a button that opens it. */
export function resultsEmbed(docs, query, results) {
  const embed = new EmbedBuilder()
    .setColor(COLOR)
    .setAuthor({ name: 'yapin.js docs search', iconURL: links.icon() })
    .setTitle(truncate(`Results for “${query}”`, 256))
    .setFooter({ text: sourceLabel(docs) });
  if (!results.length) {
    return embed.setDescription('Nothing in the docs matches that. Try other words, or browse the topics with `/help`.');
  }
  embed.setDescription(results.map((r, i) => `**${i + 1}. [${r.unit.trail}](${r.unit.url})**\n${truncate(r.snippet, 220)}`).join('\n\n'));
  return embed;
}

export function resultsComponents(results, userId) {
  if (!results.length) return [];
  return [new ActionRowBuilder(...results.slice(0, 5).map((r, i) => ButtonBuilder.secondary(
    truncate(`${i + 1}. ${r.unit.heading}`, 80),
    docsButtonId('go', r.unit.page.slug, r.unit.firstChunk, userId),
  )))];
}

/** /api <name>: one row of a reference table, with its column names. */
export function entryEmbed(docs, matches, query) {
  const [first] = matches;
  const embed = new EmbedBuilder()
    .setColor(COLOR)
    .setAuthor({ name: 'yapin.js API reference', iconURL: links.icon() })
    .setFooter({ text: sourceLabel(docs) });
  const describe = (entry) => entry.cells.slice(1)
    .map((value, i) => {
      const header = entry.headers[i + 1];
      return value ? `${header ? `**${header}:** ` : ''}${value}` : null;
    })
    .filter(Boolean)
    .join('\n') || '_No description in the table._';

  if (matches.length === 1) {
    return embed
      .setTitle(truncate(plainLabel(first.label), 256))
      .setURL(first.unit.url)
      .setDescription(truncate(absolutize(describe(first), first.unit.page.fileURL), 4096))
      .addFields({ name: 'From', value: `[${first.unit.trail}](${first.unit.url})` });
  }
  embed.setTitle(truncate(`${matches.length} matches for “${query}”`, 256));
  for (const entry of matches.slice(0, 8)) {
    embed.addFields({
      name: truncate(plainLabel(entry.label), 256),
      value: truncate(`${absolutize(describe(entry), entry.unit.page.fileURL)}\n↳ [${entry.unit.trail}](${entry.unit.url})`, 1024),
    });
  }
  return embed;
}

const plainLabel = (label) => label.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');

const absolutize = (text, base) => text.replace(/\]\(([^)\s]+)\)/g, (whole, href) => {
  try {
    return `](${new URL(href, base).href})`;
  } catch {
    return whole;
  }
});

export function sourceLabel(docs) {
  const s = docs.source;
  if (!s) return 'docs not loaded';
  return s.kind === 'package' ? `docs from yapin.js ${s.version}` : `docs from GitHub @ ${s.ref}`;
}
