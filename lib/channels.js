const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const clean = (name) => name.trim().replace(/^#/, '').toLowerCase();

/**
 * Turns channel references from config into ids. Each one can be:
 *   - an id, or a `<#id>` mention
 *   - a name: `announcements` or `#announcements`
 *   - a server and a name, for a name more than one server has: `My Server/announcements`
 * Returns the ids found, plus a readable problem for each reference that didn't resolve.
 */
export async function resolveChannels(client, refs) {
  const ids = [];
  const problems = [];
  const named = [];
  for (const ref of refs) {
    const id = /^<#([^>]+)>$/.exec(ref)?.[1] ?? ref;
    if (UUID.test(id)) ids.push(id);
    else named.push(ref);
  }
  if (!named.length) return { ids, problems, found: [] };

  // Two requests cover every server: one for server names, one for every text channel.
  const servers = await client.servers.fetch();
  const channels = await client.channels.fetchAll({ type: 'text' });
  const found = [];
  for (const ref of named) {
    const slash = ref.lastIndexOf('/');
    const serverName = slash > 0 ? clean(ref.slice(0, slash)) : null;
    const channelName = clean(slash > 0 ? ref.slice(slash + 1) : ref);
    const matches = channels.filter((c) => clean(c.name ?? '') === channelName
      && (!serverName || clean(servers.get(c.serverId)?.name ?? '') === serverName));
    const label = (c) => servers.get(c.serverId)?.name ?? c.serverId;
    if (matches.size === 1) {
      const channel = matches.first();
      ids.push(channel.id);
      found.push({ ref, channel, server: label(channel) });
    } else if (!matches.size) {
      problems.push(`no text channel called "${ref}" in any server I'm in`);
    } else {
      const where = matches.map(label);
      problems.push(`"${ref}" is in ${matches.size} servers (${where.join(', ')}); write it as "${where[0]}/${channelName}"`);
    }
  }
  return { ids: [...new Set(ids)], problems, found };
}
