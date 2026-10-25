// Ranked search over docs units: a small TF-IDF with extra weight for headings,
// so "how do I add buttons" finds the Buttons section and not every page that says "button".

// Question words, plus the verbs people wrap a question in ("how do I make/add/create …"),
// which say nothing about which section they want.
const STOPWORDS = new Set(
  ('a an and are as at be by can could do does for from get how i if in is it its me my of on or so the then this to '
    + 'use using want what when where which with would you your make add create need way should there like some').split(' '),
);

/** Lowercase words and identifiers, with simple plural stripping and camelCase split out. */
export function tokenize(text) {
  const tokens = [];
  for (const raw of text.match(/[\p{L}\p{N}_.$]+/gu) ?? []) {
    const word = raw.replace(/^[.]+|[.]+$/g, '');
    if (!word) continue;
    const parts = new Set([word, ...word.split('.'), ...word.split(/(?<=[a-z])(?=[A-Z])/)]);
    for (const part of parts) {
      const t = stem(part.toLowerCase());
      if (t.length > 1 && !STOPWORDS.has(t)) tokens.push(t);
    }
  }
  return tokens;
}

function stem(word) {
  if (/\d/.test(word) || word.includes('.')) return word;
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && /(x|ch|sh|ss)es$/.test(word)) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  if (word.length > 5 && word.endsWith('ing')) return undouble(word.slice(0, -3));
  if (word.length > 4 && word.endsWith('ed')) return undouble(word.slice(0, -2));
  return word;
}

/** running → runn → run, stopped → stopp → stop. */
const undouble = (word) => (/([bdgklmnprt])\1$/.test(word) ? word.slice(0, -1) : word);

/** Pages that repeat the rest of the docs in passing rank a little lower than the pages themselves. */
const PAGE_WEIGHT = { overview: 0.75, 'migrating-from-discord-js': 0.7, 'migrating-from-yapper': 0.7 };

const counts = (tokens) => {
  const map = new Map();
  for (const t of tokens) map.set(t, (map.get(t) ?? 0) + 1);
  return map;
};

export class SearchIndex {
  constructor(units) {
    this.units = units.map((unit) => ({
      unit,
      body: counts(tokenize(`${unit.text}`)),
      heading: new Set(tokenize(unit.heading)),
      page: new Set(tokenize(`${unit.page.title} ${unit.page.blurb ?? ''}`)),
      weight: PAGE_WEIGHT[unit.page.slug] ?? 1,
      lower: unit.text.toLowerCase(),
    }));
    for (const doc of this.units) doc.length = [...doc.body.values()].reduce((a, b) => a + b, 0);
    this.avgLength = this.units.reduce((a, d) => a + d.length, 0) / (this.units.length || 1);
    this.df = new Map();
    for (const doc of this.units) {
      for (const t of new Set([...doc.body.keys(), ...doc.heading])) this.df.set(t, (this.df.get(t) ?? 0) + 1);
    }
  }

  idf(term) {
    return Math.log(1 + this.units.length / (this.df.get(term) ?? 0.5));
  }

  search(query, { limit = 5 } = {}) {
    const terms = [...new Set(tokenize(query))];
    if (!terms.length) return [];
    const phrase = query.toLowerCase().replace(/[^\p{L}\p{N}\s._]/gu, '').trim();
    const results = [];
    for (const doc of this.units) {
      let score = 0;
      let matched = 0;
      for (const term of terms) {
        const idf = this.idf(term);
        const tf = doc.body.get(term) ?? 0;
        const inHeading = doc.heading.has(term);
        const inPage = doc.page.has(term);
        if (tf || inHeading || inPage) matched++;
        // BM25 for the body, so a long section that says a word often doesn't beat a short one about it.
        const body = tf ? (tf * 2.2) / (tf + 1.2 * (0.25 + 0.75 * (doc.length / this.avgLength))) : 0;
        score += idf * (body + (inHeading ? 3 : 0) + (inPage ? 1 : 0));
      }
      if (!matched) continue;
      // Reward covering more of the question, and the exact wording.
      score *= 0.5 + matched / terms.length;
      if (phrase.length > 3 && phrase.includes(' ') && doc.lower.includes(phrase)) score += 6;
      score *= doc.weight;
      results.push({ unit: doc.unit, score, snippet: snippet(doc.unit.text, terms) });
    }
    return results.sort((a, b) => b.score - a.score).slice(0, limit);
  }
}

/** The sentence-ish stretch of text around the first matching term. */
function snippet(text, terms, size = 160) {
  const lower = text.toLowerCase();
  let at = -1;
  for (const term of terms) {
    const i = lower.indexOf(term);
    if (i !== -1 && (at === -1 || i < at)) at = i;
  }
  if (at === -1) at = 0;
  const start = Math.max(0, at - 40);
  const piece = text.slice(start, start + size).trim();
  return `${start > 0 ? '…' : ''}${piece}${start + size < text.length ? '…' : ''}`;
}
