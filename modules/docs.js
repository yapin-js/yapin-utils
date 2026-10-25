import { ActionRowBuilder, ButtonBuilder, EmbedBuilder, Events, Module, codeBlock } from 'yapin.js';
import { links } from '../config.js';
import { truncate } from '../lib/markdown.js';
import { docs } from '../lib/shared.js';
import { exampleSummary, findExample, listExamples } from '../lib/examples.js';
import {
  COLOR, DOCS_BUTTON, chunkComponents, chunkEmbed, commandEmbed, entryEmbed, homeComponents, homeEmbed,
  resultsComponents, resultsEmbed, sourceLabel,
} from '../lib/docs/render.js';

/** The help desk: browse, search and look things up in the yapin.js docs. */
export default class Docs extends Module {
  commands = [
    {
      name: 'help',
      description: 'Browse the yapin.js docs, or explain one of my commands',
      category: 'Help',
      aliases: ['guide', 'topic'],
      options: [{ name: 'topic', rest: true, description: 'A docs topic (and section), a question, or one of my commands' }],
      examples: ['/help', '/help commands', '/help commands cooldowns', '/help buttons', '/help release'],
      run: (ctx) => this.help(ctx),
    },
    {
      name: 'docs',
      description: 'Search the yapin.js docs',
      category: 'Help',
      aliases: ['search', 'ask'],
      options: [{ name: 'question', rest: true, required: true, description: 'What you want to know, in your own words' }],
      examples: ['/docs how do I wait for a reply', '/docs per-server prefixes'],
      cooldown: { seconds: 10, uses: 4 },
      run: (ctx) => this.search(ctx, ctx.values.question),
    },
    {
      name: 'api',
      description: 'Look up an option, event, method or error code',
      category: 'Help',
      aliases: ['ref', 'lookup'],
      options: [{ name: 'name', rest: true, required: true, description: 'Like messageCreate, ctx.reply, setTitle, TokenInvalid' }],
      examples: ['/api messageCreate', '/api ctx.reply', '/api cache.messages', '/api TokenInvalid'],
      run: (ctx) => this.lookup(ctx, ctx.values.name),
    },
    {
      name: 'example',
      description: 'Show one of the runnable example bots',
      category: 'Help',
      aliases: ['examples'],
      options: [{ name: 'name', description: 'Like poll, music, reaction-roles. Leave out to list them.' }],
      cooldown: { seconds: 10, uses: 3 },
      run: (ctx) => this.example(ctx, ctx.values.name),
    },
    {
      name: 'docsync',
      description: 'Reload the docs from GitHub',
      category: 'Admin',
      ownerOnly: true,
      hidden: true,
      options: [{ name: 'ref', description: 'A branch or tag (default: the main branch). "package" uses the installed copy.' }],
      run: (ctx) => this.sync(ctx, ctx.values.ref),
    },
  ];

  buttons = {
    [DOCS_BUTTON]: (i) => this.click(i),
  };

  events = {
    [Events.MessageCreate]: (message) => this.answerMention(message),
  };

  // /help, /help <topic> [section], /help <command>, /help <anything else> → best search hit.
  async help(ctx) {
    const query = ctx.values.topic?.trim();
    if (!query) return ctx.reply({ embeds: [this.home(ctx.prefix)], components: homeComponents(docs, ctx.authorId) });

    const command = this.client.commands.get(query.replace(/^[/!]/, '').split(/\s+/)[0]);
    if (command && !command.hidden) {
      let target = command;
      for (const word of query.split(/\s+/).slice(1)) target = target.findSubcommand(word) ?? target;
      return ctx.reply({ embeds: [commandEmbed(target, ctx.prefix)] });
    }

    const [first, ...rest] = query.split(/\s+/);
    const page = docs.resolvePage(query) ?? docs.resolvePage(first);
    if (page) {
      const wanted = docs.resolvePage(query) ? '' : rest.join(' ');
      const unit = wanted ? docs.resolveSection(page, wanted) ?? docs.search(`${page.title} ${wanted}`, { limit: 20 }).find((r) => r.unit.page === page)?.unit : null;
      return this.showChunk(ctx, page, unit?.firstChunk ?? 0);
    }

    const [best] = docs.search(query, { limit: 1 });
    if (!best) return ctx.reply(`I couldn't find **${truncate(query, 100)}** in the docs. Browse the topics with \`${ctx.prefix}help\`.`);
    return this.showChunk(ctx, best.unit.page, best.unit.firstChunk);
  }

  showChunk(ctx, page, n) {
    return ctx.reply({ embeds: [chunkEmbed(docs, page, n)], components: chunkComponents(page, n, ctx.authorId) });
  }

  home(prefix = '/') {
    return homeEmbed(docs, this.client.commands.registry.values(), prefix);
  }

  async search(ctx, query) {
    const results = docs.search(query, { limit: 5 });
    return ctx.reply({ embeds: [resultsEmbed(docs, query, results)], components: resultsComponents(results, ctx.authorId) });
  }

  async lookup(ctx, query) {
    const matches = docs.lookup(query);
    if (matches.length) return ctx.reply({ embeds: [entryEmbed(docs, matches, query)] });
    // Not a name in any table: fall back to search, which also reads code.
    const results = docs.search(query, { limit: 5 });
    const embed = resultsEmbed(docs, query, results).setTitle(truncate(`No API entry called “${query}”. Closest docs:`, 256));
    return ctx.reply({ embeds: [embed], components: resultsComponents(results, ctx.authorId) });
  }

  async example(ctx, name) {
    let list;
    try {
      list = await listExamples();
    } catch (error) {
      this.logger.warn(`Couldn't list examples: ${error.message}`);
      return ctx.reply(`I couldn't reach GitHub just now. The examples are at ${links.repo()}/tree/main/examples`);
    }
    if (!name) {
      const embed = new EmbedBuilder()
        .setColor(COLOR)
        .setTitle('Example bots')
        .setURL(`${links.repo()}/tree/main/examples`)
        .setDescription(list.map((e) => `• \`${e.name}\`${e.dir ? ' (a folder)' : ''}`).join('\n') || 'No examples found.')
        .setFooter({ text: `${ctx.prefix}example <name> to see one` });
      return ctx.reply({ embeds: [embed] });
    }
    const example = await findExample(name);
    if (!example) return ctx.reply(`There's no example called \`${truncate(name, 50)}\`. Try \`${ctx.prefix}example\` for the list.`);
    const button = new ActionRowBuilder(ButtonBuilder.link('Open on GitHub', example.url));
    const embed = new EmbedBuilder().setColor(COLOR).setTitle(`examples/${example.name}${example.dir ? '/' : '.js'}`).setURL(example.url);
    if (!example.code) {
      embed.setDescription('This one is a whole project folder. Open it on GitHub to see every file.');
      return ctx.reply({ embeds: [embed], components: [button] });
    }
    const summary = exampleSummary(example.code);
    const room = 4000 - summary.length - 20;
    const code = example.code.length > room ? `${example.code.slice(0, example.code.lastIndexOf('\n', room - 30))}\n// … the rest is on GitHub` : example.code;
    embed.setDescription(`${summary ? `${summary}\n` : ''}${codeBlock('js', code)}`);
    return ctx.reply({ embeds: [embed], components: [button] });
  }

  async sync(ctx, ref) {
    const before = sourceLabel(docs);
    try {
      if (ref === 'package') await docs.loadPackage();
      else await docs.loadGitHub(ref ?? undefined);
    } catch (error) {
      return ctx.reply(`Couldn't reload the docs: ${error.message}. Still using ${before}.`);
    }
    return ctx.reply(`Reloaded ${docs.source.pages} pages (${docs.source.sections} sections), ${sourceLabel(docs)}.`);
  }

  // docs:<action>:<page>:<chunk>:<userId>
  async click(i) {
    const { action, slug, userId } = i.params;
    const own = i.userId === userId;
    if (action === 'home') {
      const payload = { embeds: [this.home()], components: homeComponents(docs, userId) };
      return own ? i.update(payload) : i.ephemeral({ embeds: payload.embeds });
    }
    const page = docs.pages.get(slug);
    if (!page) return i.ephemeral('That page is gone from the docs since this was posted. Try `/help` again.');
    const n = Math.min(Math.max(0, Number(i.params.n) || 0), page.chunks.length - 1);
    const embed = chunkEmbed(docs, page, n);
    // Someone else's /help: give the clicker their own copy rather than flipping it under the asker.
    return own ? i.update({ embeds: [embed], components: chunkComponents(page, n, userId) }) : i.ephemeral({ embeds: [embed] });
  }

  /** "@utils how do I add buttons?" answers with the best matching section. */
  async answerMention(message) {
    if (!message.mentioned || !this.client.user) return;
    const content = message.content ?? '';
    if (/^[/!]/.test(content)) return;
    const mention = new RegExp(`<@!?${this.client.user.id}>`, 'g');
    const question = content.replace(mention, '').replace(/\s+/g, ' ').trim();
    // "@bot ping" is a command, and the command handler has it.
    if (content.trimStart().startsWith('<@') && this.client.commands.get(question.split(' ')[0] ?? '')) return;
    if (question.length < 3) {
      return message.reply('Hi! Ask me anything about yapin.js, like “@me how do I add buttons?”, or try `/help`.');
    }
    const results = docs.search(question, { limit: 4 });
    if (!results.length) return message.reply(`I couldn't find that in the docs. Try \`/docs\` with other words, or browse \`/help\`.`);
    const [best, ...others] = results;
    const embed = chunkEmbed(docs, best.unit.page, best.unit.firstChunk);
    const also = truncate(others.map((r) => `• [${r.unit.trail}](${r.unit.url})`).join('\n'), 1024);
    // An embed holds 6000 characters in all; a long section leaves no room for the extras.
    if (others.length && embed.length + also.length + 10 <= 6000) embed.addFields({ name: 'Also see', value: also });
    return message.reply({ embeds: [embed], components: chunkComponents(best.unit.page, best.unit.firstChunk, message.authorId) });
  }
}
