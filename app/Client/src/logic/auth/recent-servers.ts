const STORAGE_KEY = 'lpm.recentServers';
const MAXIMUM_REMEMBERED = 4;

export interface RecentServer {
  readonly url: string;
  /** A short human note, e.g. `2 days ago`, shown right-aligned on the row. */
  readonly note: string;
  readonly lastConnectedAt: number;
}

/**
 * Servers this browser has connected to before.
 *
 * Kept in local storage rather than on a server, because the whole point of the
 * list is to help someone reach a server they are not currently connected to.
 */
export function readRecentServers(): readonly RecentServer[] {
  const stored = readStoredList();

  return stored
    .slice()
    .sort((left, right) => right.lastConnectedAt - left.lastConnectedAt)
    .map((server) => ({ ...server, note: describeElapsed(server.lastConnectedAt) }));
}

export function rememberRecentServer(url: string, now: number = Date.now()): void {
  const others = readStoredList().filter((server) => server.url !== url);
  const updated = [{ url, note: '', lastConnectedAt: now }, ...others].slice(0, MAXIMUM_REMEMBERED);

  writeStoredList(updated);
}

function readStoredList(): RecentServer[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw === null ? [] : JSON.parse(raw);

    return Array.isArray(parsed) ? parsed.filter(isRecentServer) : [];
  } catch {
    // Unavailable storage or malformed JSON both mean "no history", which is a
    // fine state to be in. Losing the list must never block signing in.
    return [];
  }
}

function writeStoredList(servers: readonly RecentServer[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(servers));
  } catch {
    // Private-browsing modes reject writes. Forgetting is acceptable.
  }
}

function isRecentServer(candidate: unknown): candidate is RecentServer {
  if (typeof candidate !== 'object' || candidate === null) {
    return false;
  }

  const server = candidate as Partial<RecentServer>;

  return typeof server.url === 'string' && typeof server.lastConnectedAt === 'number';
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * A coarse "how long ago", matching the prototype's short notes. Precision past
 * "days" is not useful for choosing which server you meant.
 */
function describeElapsed(timestamp: number, now: number = Date.now()): string {
  const elapsed = Math.max(0, now - timestamp);

  if (elapsed < HOUR) {
    return 'just now';
  }

  if (elapsed < DAY) {
    const hours = Math.floor(elapsed / HOUR);
    return hours === 1 ? '1 hour ago' : `${String(hours)} hours ago`;
  }

  const days = Math.floor(elapsed / DAY);

  return days === 1 ? 'yesterday' : `${String(days)} days ago`;
}
