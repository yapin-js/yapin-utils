// State shared by every module. ES modules are cached, so these survive module hot reloads.
import { config } from '../config.js';
import { DocsLibrary } from './docs/library.js';
import { Store } from './store.js';

export const docs = new DocsLibrary();

/**
 * servers: { [serverId]: { releaseChannelId, releaseRoleId } }
 * releases: { seen: [versions], lastCheck, lastPosted }
 */
export const store = await Store.open(config.dataFile, {
  servers: {},
  releases: { seen: null, lastCheck: null, lastPosted: null },
});
