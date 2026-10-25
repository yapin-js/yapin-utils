// Turning GitHub-flavoured markdown into what reads well in a Yapin’ embed:
// no tables, no HTML, no relative links, and headings kept small.

/** GitHub's heading anchors: lowercase, punctuation dropped, spaces to dashes. */
export function slugify(text) {
  return text
    .trim()
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

/** Gives repeated headings GitHub's `-1`, `-2` suffixes. */
export function createSlugger() {
  const seen = new Map();
  return (text) => {
    const base = slugify(text);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count ? `${base}-${count}` : base;
  };
}

/** Splits a table row into cells, respecting `|` inside inline code. */
export function splitRow(line) {
  const cells = [];
  let cell = '';
  let inCode = false;
  const text = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '`') inCode = !inCode;
    if (ch === '\\' && text[i + 1] === '|') {
      cell += '|';
      i++;
      continue;
    }
    if (ch === '|' && !inCode) {
      cells.push(cell.trim());
      cell = '';
      continue;
    }
    cell += ch;
  }
  cells.push(cell.trim());
  return cells;
}

export const isTableRow = (line) => /^\s*\|.*\|\s*$/.test(line);
export const isTableDivider = (line) => /^\s*\|(\s*:?-+:?\s*\|)+\s*$/.test(line);

/** A table becomes a bullet list: `• first — second — third`. */
export function tableToList(rows) {
  const [header, , ...body] = rows.map(splitRow);
  const lines = body.map((cells) => {
    const [first, ...rest] = cells;
    const tail = rest.filter(Boolean).join(' — ');
    if (!first) return `• ${tail}`;
    return tail ? `• ${first} — ${tail}` : `• ${first}`;
  });
  // A header with real names says what the columns are; worth one line when there are 3+.
  if (header?.length > 2 && header.every(Boolean)) lines.unshift(`*${header.join(' — ')}*`);
  return lines.join('\n');
}

/**
 * Rewrites links so they work from a chat message: relative paths and `#anchors` resolve
 * against the file's GitHub URL. Images are dropped (an embed can't show inline images).
 */
export function absolutizeLinks(text, fileURL) {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (whole, label, href) => {
      try {
        return `[${label}](${new URL(href, fileURL).href})`;
      } catch {
        return whole;
      }
    });
}

/**
 * Converts one block of docs markdown for an embed. Code fences are left exactly as they are.
 * `###` and deeper become bold lines so a section reads as one card.
 */
export function toChatMarkdown(markdown, fileURL) {
  const out = [];
  const lines = markdown.split('\n');
  let fence = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const opener = /^\s*(```+|~~~+)/.exec(line);
    if (fence) {
      out.push(line);
      if (opener && opener[1].startsWith(fence)) fence = null;
      continue;
    }
    if (opener) {
      fence = opener[1];
      out.push(line);
      continue;
    }
    if (isTableRow(line) && isTableDivider(lines[i + 1] ?? '')) {
      const rows = [];
      while (i < lines.length && isTableRow(lines[i])) rows.push(lines[i++]);
      i--;
      out.push(absolutizeLinks(tableToList(rows), fileURL));
      continue;
    }
    const heading = /^#{3,6}\s+(.*)$/.exec(line);
    if (heading) {
      out.push(`**${heading[1].trim()}**`);
      continue;
    }
    out.push(absolutizeLinks(line.replace(/<!--[\s\S]*?-->/g, ''), fileURL));
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Splits text into pieces of at most `max` characters, on paragraph boundaries where it can,
 * never inside a code fence unless the fence alone is too long (then it's re-fenced per piece).
 */
export function chunkMarkdown(text, max = 3800) {
  if (text.length <= max) return [text];
  const blocks = [];
  const lines = text.split('\n');
  let current = [];
  let fence = null;
  const flush = () => {
    if (current.length) blocks.push(current.join('\n'));
    current = [];
  };
  for (const line of lines) {
    const opener = /^\s*(```+|~~~+)/.exec(line);
    if (fence) {
      current.push(line);
      if (opener && opener[1].startsWith(fence)) {
        fence = null;
        flush();
      }
      continue;
    }
    if (opener) {
      flush();
      fence = opener[1];
      current.push(line);
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    current.push(line);
  }
  flush();

  const pieces = [];
  let piece = '';
  const push = (block) => {
    if (piece && piece.length + block.length + 2 > max) {
      pieces.push(piece);
      piece = '';
    }
    piece = piece ? `${piece}\n\n${block}` : block;
  };
  for (const block of blocks) {
    if (block.length <= max) {
      push(block);
      continue;
    }
    for (const part of splitOversized(block, max)) push(part);
  }
  if (piece) pieces.push(piece);
  return pieces;
}

function splitOversized(block, max) {
  const lines = block.split('\n');
  const fenced = /^\s*(```+|~~~+)(.*)$/.exec(lines[0]);
  const open = fenced ? lines.shift() : '';
  const close = fenced && /^\s*(```+|~~~+)\s*$/.test(lines.at(-1) ?? '') ? lines.pop() : '';
  const room = max - open.length - close.length - 2;
  const parts = [];
  let part = [];
  let size = 0;
  for (let line of lines) {
    if (line.length > room) line = `${line.slice(0, room - 1)}…`;
    if (size + line.length + 1 > room && part.length) {
      parts.push(part);
      part = [];
      size = 0;
    }
    part.push(line);
    size += line.length + 1;
  }
  if (part.length) parts.push(part);
  return parts.map((p) => (fenced ? [open, ...p, close || fenced[1]].join('\n') : p.join('\n')));
}

/** Plain text for search snippets: no markup, no code fences. */
export function plainText(markdown) {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`>#|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Trims to `max` characters on a word boundary, with an ellipsis. */
export function truncate(text, max) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${space > max * 0.6 ? cut.slice(0, space) : cut}…`;
}

/**
 * GitHub's generated release notes, tidied for chat: comments removed, headings bolded,
 * pull request and compare links shortened, @mentions linked to profiles.
 */
export function releaseNotesToChat(body, repo) {
  if (!body) return '';
  return body
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^#{1,6}\s+(.*)$/gm, '**$1**')
    .replace(new RegExp(`https://github\\.com/${repo.replace(/[.]/g, '\\.')}/pull/(\\d+)`, 'g'), (url, n) => `[#${n}](${url})`)
    .replace(/https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/compare\/(\S+)/g, (url, range) => `[${range}](${url})`)
    .replace(/(^|[\s(])@([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\b/g, '$1[@$2](https://github.com/$2)')
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
