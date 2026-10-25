import { readFile } from 'node:fs/promises';
import { ActionRowBuilder, ButtonBuilder, EmbedBuilder, Module, codeBlock, formatDuration, version as yapinVersion } from 'yapin.js';
import { config, links } from '../config.js';
import { sourceLabel } from '../lib/docs/render.js';
import { truncate } from '../lib/markdown.js';
import { formatBytes, lookupPackage } from '../lib/npm.js';
import { docs, store } from '../lib/shared.js';

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

const STARTER = `import { Client, Events } from 'yapin.js';

const client = new Client({ commands: { help: true } });

client.command('ping', 'Is the bot alive?', (ctx) => ctx.reply('pong 🏓'));
client.on(Events.ClientReady, (c) => console.log(\`Logged in as \${c.user.displayName}\`));

client.login(); // reads YAPIN_TOKEN`;

export default class Utility extends Module {
  commands = [
    {
      name: 'ping',
      description: 'Check that I\'m alive, and how fast',
      category: 'Utility',
      run: (ctx) => this.ping(ctx),
    },
    {
      name: 'about',
      description: 'What I am, what I run on, and how long I\'ve been up',
      category: 'Utility',
      aliases: ['info', 'stats'],
      run: (ctx) => this.about(ctx),
    },
    {
      name: 'npm',
      description: 'Look up any package on npm',
      category: 'Utility',
      options: [{ name: 'package', required: true, description: 'Like yapin.js, ws or @livekit/rtc-node' }],
      cooldown: { seconds: 10, uses: 3 },
      examples: ['/npm yapin.js', '/npm @livekit/rtc-node'],
      run: (ctx) => this.npm(ctx, ctx.values.package),
    },
    {
      name: 'install',
      description: 'How to install yapin.js and start a bot',
      category: 'Utility',
      aliases: ['starter', 'quickstart'],
      run: (ctx) => this.install(ctx),
    },
  ];

  async ping(ctx) {
    const started = Date.now();
    const reply = await ctx.reply('🏓 Pinging…');
    const roundTrip = Date.now() - started;
    const gateway = this.client.ping == null ? `polling (no heartbeat)` : `${this.client.ping}ms`;
    return reply.edit(`🏓 Pong! Round trip **${roundTrip}ms** · gateway ${gateway} · events via \`${this.client.transport}\``);
  }

  about(ctx) {
    const memory = formatBytes(process.memoryUsage().rss);
    const embed = new EmbedBuilder()
      .setColor('Yapin')
      .setAuthor({ name: this.client.user.displayName, iconURL: links.icon() })
      .setTitle('yapin.js utilities')
      .setDescription(`I announce new **${config.packageName}** releases and answer questions from its docs. Start with \`${ctx.prefix}help\`.`)
      .addFields(
        { name: 'Uptime', value: formatDuration(this.client.uptime ?? 0) || 'just now', inline: true },
        { name: 'Servers', value: String(this.client.servers.cache.size), inline: true },
        { name: 'Commands', value: String([...this.client.commands.registry.values()].filter((c) => !c.hidden).length), inline: true },
        { name: 'Running', value: `yapin.js \`${yapinVersion}\``, inline: true },
        { name: 'Latest on npm', value: store.data.releases.latest ? `\`${store.data.releases.latest}\`` : 'checking…', inline: true },
        { name: 'Node', value: `\`${process.version}\``, inline: true },
        { name: 'Events via', value: this.client.transport ?? 'starting', inline: true },
        { name: 'Memory', value: memory, inline: true },
        { name: 'Docs', value: `${docs.source?.pages ?? 0} pages · ${sourceLabel(docs)}`, inline: true },
      )
      .setFooter({ text: `${pkg.name} ${pkg.version}` });
    return ctx.reply({
      embeds: [embed],
      components: [new ActionRowBuilder(ButtonBuilder.link('yapin.js on GitHub', links.repo()), ButtonBuilder.link('npm', links.npm()))],
    });
  }

  async npm(ctx, name) {
    const info = await lookupPackage(name.trim().toLowerCase());
    if (!info) return ctx.reply(`There's no package called \`${truncate(name, 100)}\` on npm.`);
    const url = links.npm().replace(config.packageName, info.name);
    const repo = typeof info.repository === 'string' ? info.repository : info.repository?.url;
    const repoURL = repo?.replace(/^git\+/, '').replace(/\.git$/, '').replace(/^git:\/\//, 'https://');
    const embed = new EmbedBuilder()
      .setColor('Red')
      .setTitle(`${info.name} ${info.version}`)
      .setURL(url)
      .setDescription(truncate(info.description ?? 'No description.', 1000))
      .addFields(
        { name: 'License', value: String(info.license ?? 'none'), inline: true },
        { name: 'Dependencies', value: String(Object.keys(info.dependencies ?? {}).length), inline: true },
        { name: 'Size', value: formatBytes(info.dist?.unpackedSize) ?? 'unknown', inline: true },
      );
    if (info.weeklyDownloads != null) embed.addFields({ name: 'Downloads (7 days)', value: info.weeklyDownloads.toLocaleString('en-US'), inline: true });
    if (info.engines?.node) embed.addFields({ name: 'Node', value: `\`${info.engines.node}\``, inline: true });
    embed.addFields({ name: 'Install', value: codeBlock('sh', `npm install ${info.name}`) });
    const buttons = [ButtonBuilder.link('npm', url)];
    if (repoURL?.startsWith('https://')) buttons.push(ButtonBuilder.link('Repository', repoURL));
    if (info.homepage?.startsWith('https://') && info.homepage !== repoURL) buttons.push(ButtonBuilder.link('Homepage', info.homepage));
    return ctx.reply({ embeds: [embed], components: [new ActionRowBuilder(...buttons)] });
  }

  install(ctx) {
    const embed = new EmbedBuilder()
      .setColor('Yapin')
      .setTitle('Start a yapin.js bot')
      .setDescription([
        '**1.** Make a bot in **Settings → Developer**, then copy its token from the **Token** tab.',
        '**2.** Set up a project:',
        codeBlock('sh', 'mkdir my-bot && cd my-bot\nnpm init -y\nnpm install yapin.js'),
        'Add `"type": "module"` to package.json, and put the token in `YAPIN_TOKEN`.',
        '**3.** Write `bot.js`:',
        codeBlock('js', STARTER),
        '**4.** Run it with `node bot.js`, then type `/ping` in your server.',
      ].join('\n'))
      .setFooter({ text: `More: ${ctx.prefix}help getting-started` });
    return ctx.reply({
      embeds: [embed],
      components: [new ActionRowBuilder(ButtonBuilder.link('Getting started guide', links.docs('getting-started.md')))],
    });
  }
}
