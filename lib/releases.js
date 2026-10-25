import { ActionRowBuilder, ButtonBuilder, EmbedBuilder, codeBlock } from 'yapin.js';
import { config, links } from '../config.js';
import { github } from './http.js';
import { releaseNotesToChat, truncate } from './markdown.js';
import { formatBytes } from './npm.js';

/** The GitHub release for a version, tagged `v1.2.3` or `1.2.3`. Null when there's none (yet). */
export async function fetchRelease(version) {
  for (const tag of [`v${version}`, version]) {
    const release = await github(`/repos/${config.repo}/releases/tags/${encodeURIComponent(tag)}`);
    if (release && !release.draft) return release;
  }
  return null;
}

/** The git tag for a version, if the repo has one. */
export async function findTag(version) {
  for (const tag of [`v${version}`, version]) {
    if (await github(`/repos/${config.repo}/git/ref/tags/${encodeURIComponent(tag)}`)) return tag;
  }
  return null;
}

/** Everything a release post needs, gathered once and shared by every channel it goes to. */
export async function gatherRelease(info) {
  const [release, previousTag] = await Promise.all([
    fetchRelease(info.version).catch(() => null),
    info.previous ? findTag(info.previous).catch(() => null) : null,
  ]);
  const tag = release?.tag_name ?? null;
  return {
    ...info,
    notes: releaseNotesToChat(release?.body, config.repo),
    releaseURL: release?.html_url ?? null,
    compareURL: tag && previousTag ? links.compare(previousTag, tag) : null,
  };
}

const date = (d) => d.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC';

export function releaseEmbed(release) {
  const kind = release.deprecated ? 'Deprecated' : release.prerelease ? 'Pre-release' : 'Stable';
  const color = release.deprecated ? 'Red' : release.prerelease ? 'Yellow' : 'Green';
  const embed = new EmbedBuilder()
    .setColor(color)
    .setAuthor({ name: `${release.name} on npm`, iconURL: links.icon(), url: links.npm() })
    .setTitle(`📦 ${release.name} ${release.version} is out`)
    .setURL(links.npm(release.version))
    .setThumbnail(links.icon());

  const intro = release.deprecated ? `⚠️ **Deprecated:** ${release.deprecated}` : release.description ?? '';
  const notes = release.notes ? `\n\n${release.notes}` : '';
  embed.setDescription(truncate(`${intro}${notes}`, 2500) || null);

  const size = [formatBytes(release.unpackedSize), release.fileCount ? `${release.fileCount} files` : null].filter(Boolean).join(' · ');
  embed.addFields(
    { name: 'Version', value: `\`${release.version}\``, inline: true },
    { name: 'Channel', value: release.tags.length ? release.tags.map((t) => `\`${t}\``).join(', ') : kind, inline: true },
    { name: 'Type', value: kind, inline: true },
  );
  if (release.publishedAt) embed.addFields({ name: 'Published', value: date(release.publishedAt), inline: true });
  if (release.previous) embed.addFields({ name: 'Previous', value: `\`${release.previous}\``, inline: true });
  if (release.node) embed.addFields({ name: 'Node', value: `\`${release.node}\``, inline: true });
  if (size) embed.addFields({ name: 'Size', value: size, inline: true });
  embed.addFields({ name: 'Install', value: codeBlock('sh', `npm install ${release.name}@${release.version}`) });
  if (release.publisher) embed.setFooter({ text: `Published by ${release.publisher}` });
  if (release.publishedAt) embed.setTimestamp(release.publishedAt);
  return embed;
}

export function releaseComponents(release) {
  const buttons = [ButtonBuilder.link('View on npm', links.npm(release.version)).setEmoji('📦')];
  if (release.releaseURL) buttons.push(ButtonBuilder.link('Release notes', release.releaseURL).setEmoji('📝'));
  if (release.compareURL) buttons.push(ButtonBuilder.link('Compare changes', release.compareURL).setEmoji('🔍'));
  buttons.push(ButtonBuilder.secondary('Install', `release:install:${release.version}`).setEmoji('📋'));
  return [new ActionRowBuilder(...buttons)];
}

/** The ephemeral answer to the Install button. */
export function installEmbed(name, version) {
  return new EmbedBuilder()
    .setColor('Yapin')
    .setTitle(`Installing ${name} ${version}`)
    .setDescription([
      codeBlock('sh', [`npm install ${name}@${version}`, `pnpm add ${name}@${version}`, `yarn add ${name}@${version}`, `bun add ${name}@${version}`].join('\n')),
      'Upgrading? Read the release notes first, then run your bot with `logger: \'debug\'` once to check everything connects.',
    ].join('\n'));
}
