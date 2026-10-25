import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

/**
 * A small JSON file store. Reads once, keeps the data in memory, and writes the whole file
 * atomically (write to a temp file, then rename) so a crash mid-write can't corrupt it.
 *
 *   const store = await Store.open('./data/state.json', { servers: {} });
 *   store.data.servers[id] = { channelId };
 *   await store.save();
 */
export class Store {
  #queue = Promise.resolve();

  constructor(file, data) {
    this.file = file;
    this.data = data;
  }

  static async open(file, defaults = {}) {
    const path = resolve(file);
    let data = structuredClone(defaults);
    try {
      data = { ...data, ...JSON.parse(await readFile(path, 'utf8')) };
    } catch (error) {
      if (error.code !== 'ENOENT') throw new Error(`Couldn't read ${path}: ${error.message}`);
    }
    return new Store(path, data);
  }

  /** Saves are queued, so two quick saves never interleave. */
  save() {
    this.#queue = this.#queue.then(async () => {
      await mkdir(dirname(this.file), { recursive: true });
      const temp = `${this.file}.${process.pid}.tmp`;
      await writeFile(temp, `${JSON.stringify(this.data, null, 2)}\n`);
      await rename(temp, this.file);
    });
    return this.#queue;
  }
}
