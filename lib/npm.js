import { get } from './http.js';

const REGISTRY = 'https://registry.npmjs.org';

/** `@scope/name` has to be sent as `@scope%2Fname`. */
const encodeName = (name) => name.replace('/', '%2F');

/**
 * Watches one package's registry document. Repeated fetches send the last ETag,
 * so an unchanged package costs a 304 and no body.
 */
export class PackageWatcher {
  #etag = null;
  #packument = null;

  constructor(name) {
    this.name = name;
  }

  /** The full registry document ("packument"): every version, dist-tag and publish time. */
  async fetch() {
    const headers = { accept: 'application/json', 'user-agent': 'yapin-utils' };
    if (this.#etag) headers['if-none-match'] = this.#etag;
    const res = await fetch(`${REGISTRY}/${encodeName(this.name)}`, { headers, signal: AbortSignal.timeout(15_000) });
    if (res.status === 304 && this.#packument) return this.#packument;
    if (!res.ok) throw new Error(`npm answered ${res.status} for ${this.name}`);
    this.#etag = res.headers.get('etag');
    this.#packument = await res.json();
    return this.#packument;
  }
}

/** Real versions, oldest first. Placeholder versions from staged publishing are left out. */
export function publishedVersions(packument) {
  return Object.values(packument.versions ?? {})
    .filter((manifest) => !manifest.stub)
    .map((manifest) => ({ version: manifest.version, time: packument.time?.[manifest.version] ?? null }))
    .sort((a, b) => new Date(a.time ?? 0) - new Date(b.time ?? 0));
}

export const isPrerelease = (version) => version.includes('-');

/** Everything the release embed shows about one version. */
export function describeVersion(packument, version) {
  const manifest = packument.versions?.[version];
  if (!manifest) return null;
  const all = publishedVersions(packument).map((v) => v.version);
  const index = all.indexOf(version);
  return {
    name: packument.name,
    version,
    description: manifest.description ?? packument.description ?? null,
    publishedAt: packument.time?.[version] ? new Date(packument.time[version]) : null,
    tags: Object.entries(packument['dist-tags'] ?? {}).filter(([, v]) => v === version).map(([tag]) => tag),
    prerelease: isPrerelease(version),
    previous: index > 0 ? all[index - 1] : null,
    node: manifest.engines?.node ?? null,
    license: manifest.license ?? null,
    publisher: manifest._npmUser?.name ?? null,
    unpackedSize: manifest.dist?.unpackedSize ?? null,
    fileCount: manifest.dist?.fileCount ?? null,
    dependencies: Object.keys(manifest.dependencies ?? {}).length,
    gitHead: manifest.gitHead ?? null,
    deprecated: manifest.deprecated ?? null,
  };
}

/** A quick look at any package, for /npm. Returns null when it doesn't exist. */
export async function lookupPackage(name) {
  const latest = await get(`${REGISTRY}/${encodeName(name)}/latest`);
  if (!latest) return null;
  const downloads = await get(`https://api.npmjs.org/downloads/point/last-week/${name}`).catch(() => null);
  return { ...latest, weeklyDownloads: downloads?.downloads ?? null };
}

export function formatBytes(bytes) {
  if (bytes == null) return null;
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(i ? 1 : 0)} ${units[i]}`;
}
