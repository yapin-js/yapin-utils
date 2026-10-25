// yapin-utils: announces new yapin.js releases and answers questions from its docs.
// Run: YAPIN_TOKEN=yb_… node bot.js   (or npm run dev with a .env file)
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Client, ErrorCodes, Events, Intents } from 'yapin.js';
import { config } from './config.js';
import { docs } from './lib/shared.js';

// The event cursor sits next to the settings, so a restart catches up on what it missed.
const dataDir = dirname(config.dataFile);
await mkdir(dataDir, { recursive: true });

const client = new Client({
  intents: [Intents.Messages, Intents.Interactions],
  sequenceStore: join(dataDir, '.yapin-seq'),
  maxEventAge: 300,
  presence: { status: 'online', activity: '/help · yapin.js docs' },
  commands: { owners: config.owners },
});

await docs.loadPackage();
client.logger.info(`Docs: ${docs.source.pages} pages, ${docs.source.sections} sections (yapin.js ${docs.source.version})`);
// The copy in node_modules is there instantly; the one on GitHub may be newer.
docs.loadGitHub().then(
  () => client.logger.info(`Docs refreshed from GitHub @ ${docs.source.ref}`),
  (error) => client.logger.warn(`Using the packaged docs; GitHub refresh failed: ${error.message}`),
);

client.on(Events.CommandError, (error, ctx) => {
  client.logger.error(`/${ctx.command.path} failed for ${ctx.author?.username ?? ctx.authorId}:`, error);
});

await client.modules.load('./modules');
if (process.env.NODE_ENV === 'development') client.modules.watch();

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    await client.destroy();
    process.exit(0);
  });
}

try {
  await client.login();
} catch (error) {
  if (error.code !== ErrorCodes.TokenMissing && error.code !== ErrorCodes.TokenInvalid) throw error;
  client.logger.error(`${error.message}\nSet YAPIN_TOKEN in .env (copy .env.example), then start the bot again.`);
  process.exit(1);
}
