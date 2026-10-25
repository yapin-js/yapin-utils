import { chunkMarkdown, createSlugger, isTableDivider, isTableRow, plainText, splitRow, toChatMarkdown } from '../markdown.js';

/**
 * One docs file → a page made of units: the intro, then one unit per `##` and `###` heading.
 * Each unit keeps its chat-ready markdown, its plain text for search, and is cut into chunks
 * that fit an embed description. Table rows are pulled out as API reference entries.
 */
export function parsePage(markdown, { slug, path, fileURL }) {
  const slugger = createSlugger();
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  let title = slug;
  const raw = [{ heading: null, level: 1, anchor: '', lines: [] }];
  let fence = null;

  for (const line of lines) {
    const opener = /^\s*(```+|~~~+)/.exec(line);
    if (fence) {
      if (opener && opener[1].startsWith(fence)) fence = null;
      raw.at(-1).lines.push(line);
      continue;
    }
    if (opener) {
      fence = opener[1];
      raw.at(-1).lines.push(line);
      continue;
    }
    const heading = /^(#{1,3})\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading?.[1] === '#' && raw.length === 1 && !raw[0].heading) {
      title = heading[2];
      slugger(title);
      continue;
    }
    if (heading && heading[1].length >= 2) {
      raw.push({ heading: heading[2], level: heading[1].length, anchor: slugger(heading[2]), lines: [] });
      continue;
    }
    raw.at(-1).lines.push(line);
  }

  const page = { slug, path, title, fileURL, url: fileURL, units: [], chunks: [], entries: [] };
  let parent = null;
  for (const section of raw) {
    const source = section.lines.join('\n').trim();
    if (section.level === 2) parent = section.heading;
    if (!source && section.level !== 2) continue;
    const trail = [title];
    if (section.level === 3 && parent) trail.push(parent);
    if (section.heading) trail.push(section.heading);
    const unit = {
      page,
      index: page.units.length,
      heading: section.heading ?? title,
      level: section.level,
      anchor: section.anchor,
      trail: trail.join(' › '),
      url: section.anchor ? `${fileURL}#${section.anchor}` : fileURL,
      body: toChatMarkdown(source, fileURL),
      text: plainText(source),
      firstChunk: page.chunks.length,
    };
    // A `##` with nothing but `###`s under it still gets a card listing them.
    if (!unit.body) unit.body = '_See the sections below._';
    page.units.push(unit);
    const parts = chunkMarkdown(unit.body);
    parts.forEach((text, part) => page.chunks.push({ unit, text, part, parts: parts.length }));
    page.entries.push(...tableEntries(source, unit));
  }
  return page;
}

/** Every row of every table in a section, keyed by the names in its first cell. */
function tableEntries(source, unit) {
  const entries = [];
  const lines = source.split('\n');
  let fence = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(```|~~~)/.test(lines[i])) fence = !fence;
    if (fence || !isTableRow(lines[i]) || !isTableDivider(lines[i + 1] ?? '')) continue;
    const headers = splitRow(lines[i]);
    i += 2;
    for (; i < lines.length && isTableRow(lines[i]); i++) {
      const cells = splitRow(lines[i]);
      const names = entryNames(cells[0]);
      if (!names.length) continue;
      entries.push({ names, label: cells[0], headers, cells, unit });
    }
    i--;
  }
  return entries;
}

/**
 * `ctx.reply(payload)` → ctx.reply(payload), ctx.reply, reply.
 * `ready` (`Events.ClientReady`) → ready, Events.ClientReady, ClientReady.
 * A first cell without code is used as plain text (`Messages`, `Gateway`).
 */
export function entryNames(cell) {
  const spans = [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
  const bases = spans.length ? spans : [plainText(cell)].filter((t) => t && t.length <= 40);
  const names = new Set();
  for (const base of bases) {
    const bare = base.replace(/\(.*\)$/, '').trim();
    for (const name of [base, bare, bare.split('.').at(-1)]) {
      const key = normalizeName(name);
      if (key.length > 1) names.add(key);
    }
  }
  return [...names];
}

export const normalizeName = (name) => name.toLowerCase().replace(/^[/!]/, '').replace(/[`'"]/g, '').replace(/\s+/g, ' ').trim();
