import { EmbedBuilder, Module } from 'yapin.js';
import { config } from '../config.js';
import { resolveChannels } from '../lib/channels.js';
import { PackageWatcher, describeVersion, publishedVersions } from '../lib/npm.js';
import { gatherRelease, installEmbed, releaseComponents, releaseEmbed } from '../lib/releases.js';
import { docs, store } from '../lib/shared.js';

/** How long to hold an announcement while waiting for its GitHub release notes to appear. */
const NOTES_GRACE_MS = 15 * 60_000;
/** Never post more than this many versions in one go (say, after the bot was off for a while). */
const MAX_PER_CHECK = 5;
/** Channel names from RELEASE_CHANNELS are looked up again after this, in case they're renamed. */
const CHANNEL_NAMES_TTL_MS = 10 * 60_000;

/**
 * Watches npm for new versions and posts a release card, with links, to every channel
 * that asked for them. Settings live in data/state.json.
 */
export default class Releases extends Module {
  watcher = new PackageWatcher(config.packageName);
  checking = null;
  configured = null;

  commands = [
    {
      name: 'release',
      description: `Show the latest ${config.packageName} release, or a given version`,
      category: 'Releases',
      aliases: ['version', 'latest'],
      options: [{ name: 'version', description: 'Like 0.1.0 (default: the latest)' }],
      cooldown: { seconds: 10, uses: 3 },
      run: (ctx) => this.show(ctx, ctx.values.version),
    },
    {
      name: 'releases',
      description: 'Choose where new release announcements go',
      category: 'Releases',
      serverOnly: true,
      permissions: ['manage_server'],
      subcommands: [
        {
          name: 'channel',
          description: 'Post new releases in this channel',
          options: [{ name: 'channel', type: 'channel', channelTypes: ['text'], required: true, description: 'Where to post them' }],
          run: (ctx) => this.setChannel(ctx, ctx.values.channel),
        },
        { name: 'off', description: 'Stop posting releases in this server', run: (ctx) => this.setChannel(ctx, null) },
        { name: 'status', description: 'Show the settings and the last check', run: (ctx) => this.status(ctx) },
        { name: 'test', description: 'Post the latest release in the set channel now', run: (ctx) => this.test(ctx) },
      ],
      examples: ['/releases channel #announcements', '/releases status', '/releases off'],
    },
    {
      name: 'announce',
      description: 'Announce a version everywhere, even if it was already posted',
      category: 'Admin',
      ownerOnly: true,
      hidden: true,
      options: [{ name: 'version', required: true }],
      run: (ctx) => this.forceAnnounce(ctx, ctx.values.version),
    },
  ];

  buttons = {
    'release:install:{version}': (i) => i.ephemeral({ embeds: [installEmbed(config.packageName, i.params.version)] }),
  };

  load() {
    // Wait for login so channels can be sent to, then check on a timer.
    const start = () => {
      // Look the configured channels up now, so a typo in RELEASE_CHANNELS shows at startup.
      this.configuredChannels({ log: true }).catch((error) => this.logger.warn(`Couldn't look up RELEASE_CHANNELS: ${error.message}`));
      this.setTimeout(() => this.check(), 5_000);
      this.setInterval(() => this.check(), config.pollMinutes * 60_000);
    };
    if (this.client.isReady()) start();
    else this.once('ready', start);
  }

  /** One check of npm. Overlapping calls share the same run. */
  check() {
    this.checking ??= this.#check()
      .catch((error) => this.logger.warn(`Release check failed: ${error.message}`))
      .finally(() => { this.checking = null; });
    return this.checking;
  }

  async #check() {
    const packument = await this.watcher.fetch();
    const versions = publishedVersions(packument);
    const state = store.data.releases;
    state.lastCheck = new Date().toISOString();
    state.latest = packument['dist-tags']?.latest ?? versions.at(-1)?.version ?? null;

    // First run: remember what's already out instead of announcing the whole history.
    if (!Array.isArray(state.seen)) {
      state.seen = versions.map((v) => v.version);
      await store.save();
      this.logger.info(`Watching ${config.packageName}: ${state.seen.length} versions known, latest ${state.latest}`);
      return [];
    }

    const seen = new Set(state.seen);
    const fresh = versions.filter((v) => !seen.has(v.version)).slice(-MAX_PER_CHECK);
    const posted = [];
    for (const { version, time } of fresh) {
      const release = await gatherRelease(describeVersion(packument, version));
      const age = Date.now() - new Date(time ?? 0).getTime();
      if (!release.notes && age < NOTES_GRACE_MS) {
        this.logger.info(`${version} is on npm; waiting up to ${NOTES_GRACE_MS / 60_000} minutes for its release notes`);
        continue;
      }
      await this.announce(release);
      state.seen.push(version);
      state.lastPosted = version;
      await store.save();
      posted.push(version);
    }
    // Skipped ones (older than the cap) are marked seen too, so they don't trickle out later.
    for (const v of versions) if (!state.seen.includes(v.version) && !fresh.includes(v)) state.seen.push(v.version);
    await store.save();

    if (posted.length) this.refreshDocs(posted.at(-1));
    return posted;
  }

  /** RELEASE_CHANNELS as ids. Names are looked up once, then again every 10 minutes. */
  async configuredChannels({ log = false } = {}) {
    if (this.configured && Date.now() - this.configured.at < CHANNEL_NAMES_TTL_MS) return this.configured.ids;
    const { ids, problems, found } = await resolveChannels(this.client, config.releaseChannels);
    this.configured = { at: Date.now(), ids };
    if (log) for (const { ref, channel, server } of found) this.logger.info(`RELEASE_CHANNELS: "${ref}" is #${channel.name} in ${server} (${channel.id})`);
    for (const problem of problems) this.logger.warn(`RELEASE_CHANNELS: ${problem}`);
    return ids;
  }

  /** Every channel that wants release posts: from /releases channel, plus RELEASE_CHANNELS. */
  async targets() {
    const fromServers = Object.values(store.data.servers).map((s) => s.releaseChannelId).filter(Boolean);
    return [...new Set([...fromServers, ...(await this.configuredChannels())])];
  }

  async announce(release) {
    const payload = { embeds: [releaseEmbed(release)], components: releaseComponents(release) };
    const targets = await this.targets();
    this.logger.info(`Announcing ${release.name} ${release.version} in ${targets.length} channel(s)`);
    const results = await Promise.allSettled(targets.map((id) => this.client.send(id, payload)));
    results.forEach((result, i) => {
      if (result.status === 'rejected') this.logger.warn(`Couldn't post the release in ${targets[i]}: ${result.reason?.message ?? result.reason}`);
    });
    this.client.emit('releasePosted', release, results);
    return results;
  }

  /** New version, new docs: reload them from the release's tag, else the main branch. */
  async refreshDocs(version) {
    for (const ref of [`v${version}`, config.branch]) {
      try {
        await docs.loadGitHub(ref);
        this.logger.info(`Docs reloaded from GitHub @ ${ref}`);
        return;
      } catch (error) {
        this.logger.debug(`Docs at ${ref} not loaded: ${error.message}`);
      }
    }
    this.logger.warn('Couldn\'t reload the docs from GitHub; keeping the current copy');
  }

  async releaseFor(version) {
    const packument = await this.watcher.fetch();
    const wanted = version?.replace(/^v/, '') ?? packument['dist-tags']?.latest;
    const info = wanted && describeVersion(packument, packument['dist-tags']?.[wanted] ?? wanted);
    return info ? gatherRelease(info) : null;
  }

  async show(ctx, version) {
    const release = await this.releaseFor(version);
    if (!release) {
      const all = publishedVersions(await this.watcher.fetch()).map((v) => `\`${v.version}\``).slice(-15).reverse();
      return ctx.reply(`There's no ${config.packageName} version \`${version}\`. Recent ones: ${all.join(', ')}`);
    }
    return ctx.reply({ embeds: [releaseEmbed(release)], components: releaseComponents(release) });
  }

  async setChannel(ctx, channel) {
    const settings = (store.data.servers[ctx.serverId] ??= {});
    if (channel) {
      // Post a short notice first, so a channel the bot can't write to fails now and not on release day.
      try {
        await channel.send(`📦 New **${config.packageName}** releases will be posted here.`);
      } catch (error) {
        return ctx.reply(`I can't post in ${channel}: ${error.message}`);
      }
      settings.releaseChannelId = channel.id;
    } else {
      delete settings.releaseChannelId;
    }
    await store.save();
    return ctx.reply(channel ? `Done. New releases will go to ${channel}.` : 'Release posts are off for this server.');
  }

  async status(ctx) {
    const { lastCheck, latest, lastPosted } = store.data.releases;
    const channelId = store.data.servers[ctx.serverId]?.releaseChannelId;
    const embed = new EmbedBuilder()
      .setColor('Yapin')
      .setTitle('Release announcements')
      .addFields(
        { name: 'Watching', value: `\`${config.packageName}\` every ${config.pollMinutes} min`, inline: true },
        { name: 'Posting in', value: channelId ? `<#${channelId}>` : 'Nowhere yet: `/releases channel #channel`', inline: true },
        { name: 'Latest on npm', value: latest ? `\`${latest}\`` : 'Not checked yet', inline: true },
        { name: 'Last announced', value: lastPosted ? `\`${lastPosted}\`` : 'None since I started watching', inline: true },
        { name: 'Last check', value: lastCheck ? new Date(lastCheck).toUTCString() : 'Not yet', inline: true },
      );
    return ctx.reply({ embeds: [embed] });
  }

  async test(ctx) {
    const channelId = store.data.servers[ctx.serverId]?.releaseChannelId;
    if (!channelId) return ctx.reply('Set a channel first: `/releases channel #channel`.');
    const release = await this.releaseFor();
    await this.client.send(channelId, { embeds: [releaseEmbed(release)], components: releaseComponents(release) });
    return ctx.reply(`Posted ${release.version} in <#${channelId}>.`);
  }

  async forceAnnounce(ctx, version) {
    const release = await this.releaseFor(version);
    if (!release) return ctx.reply(`There's no version \`${version}\` on npm.`);
    const results = await this.announce(release);
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    return ctx.reply(`Announced ${release.version} in ${ok} of ${results.length} channel(s).`);
  }
}
