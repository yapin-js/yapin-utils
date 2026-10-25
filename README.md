# yapin-utils

The utility bot for [yapin.js](https://github.com/yapin-js/yapin.js), built with yapin.js. It does two jobs:

- **Release announcements.** It checks npm every few minutes. When a new version of `yapin.js` comes out, it posts a card with the GitHub release notes, version details and an install command. The card has buttons to **View on npm**, read the **Release notes**, **Compare changes** with the previous version, and get the **Install** commands.
- **Help desk.** It reads every page of the yapin.js docs and serves them in chat. You can browse by topic, search with a question, look up any option, event, method or error code, or @mention it with a question.

## Commands

| Command | What it does |
| --- | --- |
| `/help` | All docs topics and this bot's commands, with shortcut buttons |
| `/help <topic> [section]` | Opens a docs page with ◀ ▶ paging, like `/help commands cooldowns` or `/help buttons` |
| `/help <command>` | Explains one of this bot's commands |
| `/docs <question>` | Searches the docs, like `/docs how do I wait for a reply` |
| `/api <name>` | Looks up a reference entry, like `/api messageCreate`, `/api ctx.reply` or `/api TokenInvalid` |
| `/example [name]` | Lists the example bots, or shows the code for one |
| `@bot <question>` | Answers with the docs section that matches best |
| `/release [version]` | Shows the release card for the latest version, a version, or a dist-tag (`/release next`) |
| `/releases channel #channel` | Posts new releases in that channel (needs Manage Server) |
| `/releases status` · `off` · `test` | Shows the settings, turns posts off, or posts the latest release now |
| `/npm <package>` | Shows any npm package |
| `/install` | How to install yapin.js, with a starter bot |
| `/channelid [#channel]` | Shows a channel's id, or lists every text channel in this server with its id |
| `/ping` · `/about` | Shows latency, uptime and versions |
| `/announce <version>` · `/docsync [ref]` | Owner only, hidden: re-post a release everywhere, or reload the docs from GitHub |

If someone else clicks the paging buttons on your `/help`, they get their own private copy, so your message doesn't change under you.

## Running it

```sh
npm install
cp .env.example .env     # then fill in YAPIN_TOKEN
npm run dev              # node --env-file=.env bot.js
```

Get the token from **Settings → Developer → your bot → Token**. Every setting is in [.env.example](.env.example). The ones you're most likely to change are:

- **`RELEASE_CHANNELS`:** channels that always get release posts. Use channel names (`announcements`), or `My Server/announcements` if more than one of the bot's servers has that name. Ids work too. At startup the bot logs which channel each name resolved to, and warns about any it couldn't find.
- **`GITHUB_TOKEN`:** a GitHub personal access token. It raises the API limit from 60 to 5000 requests an hour. If GitHub rejects it, the bot warns once and carries on without it.

`/channelid` lists every text channel in the current server with its id.

On first start the bot records the versions that are already published and doesn't announce them. After that, each new version is posted once. If a version is on npm but its GitHub release isn't up yet, the bot waits up to 15 minutes for the notes before posting. After a release, the docs are reloaded from the release's git tag, so `/help` matches the new version.

Settings and the list of seen versions are saved in `data/state.json`.

### Yapin’ bot hosting

The project is set up for it: `"start": "node bot.js"`, and the hosting token (`YAPPER_BOT_TOKEN`) is read automatically. Hosting disks may be reset when you redeploy. If that happens, the bot treats its next start as a first start: it records the versions already out without announcing them, and it forgets channels set with `/releases channel`. Put your announcement channels in `RELEASE_CHANNELS` so they survive.

## How the docs work

[lib/docs/](lib/docs/) turns the markdown into chat-sized cards:

- **Pages.** It reads `README.md` and `docs/*.md` from the installed `yapin.js` package, so there's always a copy that matches the version installed. On startup it also tries to load a newer copy from GitHub.
- **Sections.** Each page is split on its `##` and `###` headings. Long sections are cut into chunks that fit an embed, and code blocks are never split down the middle. Tables become bullet lists, and relative links become GitHub links.
- **Search.** `/docs` uses TF-IDF/BM25 ranking with extra weight for headings.
- **Reference.** `/api` reads every table row in the docs, keyed by the names in its first cell.

## Tests

```sh
npm test
```

The tests run offline. They start the real bot modules against a mock Yapin’ API (vendored from yapin.js's own test helpers) and a fake npm and GitHub. They cover every command, the paging buttons, permission checks, and the full release flow: first run, a new version, waiting for notes, and no double posts. They also build every docs chunk as an embed, so a docs change that breaks a Yapin’ limit fails the tests.

## Layout

```text
bot.js               client setup, loads ./modules
config.js            environment settings and links
modules/docs.js      /help /docs /api /example, @mention answers, paging buttons
modules/releases.js  the npm watcher and /release, /releases, /announce
modules/utility.js   /ping /about /npm /install
lib/docs/            markdown parsing, search, embeds
lib/releases.js      GitHub release notes and the release card
lib/npm.js           registry client (uses ETags, so a check with nothing new is cheap)
lib/store.js         JSON file storage with atomic writes
assets/logo.svg      the logo
assets/avatar.png    the logo as a 512×512 PNG, for the bot's picture
```

To use the logo as the bot's picture, run `await client.user.setAvatar('./assets/avatar.png')` once. Yapin’ only takes PNG, JPG, GIF or WebP, so use the PNG, not the SVG. The picture stays set after that.
