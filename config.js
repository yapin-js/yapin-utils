// Everything the bot can be told from the environment. See .env.example.

const list = (value) => (value ?? '').split(',').map((s) => s.trim()).filter(Boolean);

export const config = {
  /** The npm package to watch and the GitHub repo its docs and release notes live in. */
  packageName: process.env.WATCH_PACKAGE ?? 'yapin.js',
  repo: process.env.WATCH_REPO ?? 'yapin-js/yapin.js',
  branch: process.env.WATCH_BRANCH ?? 'main',

  /** How often to check npm for a new version, in minutes. */
  pollMinutes: Math.max(1, Number(process.env.RELEASE_POLL_MINUTES ?? 5)),
  /** Channels that get every release, on top of the ones set with /releases channel. */
  releaseChannels: list(process.env.RELEASE_CHANNEL_IDS),

  /** Optional: raises the GitHub API limit from 60 to 5000 requests an hour. */
  githubToken: process.env.GITHUB_TOKEN || null,

  /** Extra user ids allowed to run owner-only commands. */
  owners: list(process.env.BOT_OWNERS),

  /** Where settings and the last seen version are kept. */
  dataFile: process.env.DATA_FILE ?? './data/state.json',
};

export const links = {
  npm: (version) => `https://www.npmjs.com/package/${config.packageName}${version ? `/v/${version}` : ''}`,
  repo: () => `https://github.com/${config.repo}`,
  release: (tag) => `https://github.com/${config.repo}/releases/tag/${encodeURIComponent(tag)}`,
  compare: (from, to) => `https://github.com/${config.repo}/compare/${encodeURIComponent(from)}...${encodeURIComponent(to)}`,
  docs: (file = '', anchor = '') => `https://github.com/${config.repo}/blob/${config.branch}/docs/${file}${anchor ? `#${anchor}` : ''}`,
  blob: (path) => `https://github.com/${config.repo}/blob/${config.branch}/${path}`,
  /** raw.githubusercontent.com is one of Yapin’s allowed embed picture hosts. */
  icon: () => `https://raw.githubusercontent.com/${config.repo}/${config.branch}/YapinAssets/yapinjsicon.png`,
};
