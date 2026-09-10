import { getInvalidationChannel, invalidationFrameSchema, type ServerFrame } from '@lpm/shared';
import type { Redis } from 'ioredis';

/** Anything that can be sent a frame. A socket, or a test's stand-in for one. */
export interface FrameSink {
  send(payload: string): void;
}

interface Watcher {
  readonly sink: FrameSink;
  readonly accountId: string;
  readonly projectId: string;
}

/**
 * Keeps track of who is looking at which board, and tells them when it changes.
 *
 * The worker publishes to Redis rather than reaching a socket directly, because
 * the two are separate processes. This is the other end: one subscription per
 * account, however many tabs are open on it, fanned out in memory.
 */
export class InvalidationHub {
  private readonly watchers = new Set<Watcher>();
  private readonly subscribedAccounts = new Set<string>();

  constructor(private readonly subscriber: Redis) {
    this.subscriber.on('message', (channel: string, payload: string) => {
      this.fanOut(channel, payload);
    });
  }

  /**
   * Starts sending one socket the changes to one project.
   *
   * The caller has already checked that this actor may see it; the hub only
   * decides who hears about what, never who is allowed to.
   */
  async watch(watcher: Watcher): Promise<void> {
    this.watchers.add(watcher);

    if (!this.subscribedAccounts.has(watcher.accountId)) {
      this.subscribedAccounts.add(watcher.accountId);
      await this.subscriber.subscribe(getInvalidationChannel(watcher.accountId));
    }

    send(watcher.sink, { type: 'watching', projectId: watcher.projectId });
  }

  /**
   * Forgets a socket that has gone.
   *
   * The account stays subscribed. A studio has one, so unsubscribing on the last
   * tab closing would mean resubscribing the moment somebody opened another.
   */
  forget(sink: FrameSink): void {
    for (const watcher of this.watchers) {
      if (watcher.sink === sink) {
        this.watchers.delete(watcher);
      }
    }
  }

  /** How many sockets are listening. Exposed so a test can be sure of cleanup. */
  get watcherCount(): number {
    return this.watchers.size;
  }

  private fanOut(channel: string, payload: string): void {
    const frame = invalidationFrameSchema.safeParse(readJson(payload));

    if (!frame.success) {
      // A malformed message is a bug somewhere else; dropping it is better than
      // taking every socket down over it.
      return;
    }

    for (const watcher of this.watchers) {
      if (
        getInvalidationChannel(watcher.accountId) === channel &&
        watcher.projectId === frame.data.projectId
      ) {
        send(watcher.sink, frame.data);
      }
    }
  }
}

function send(sink: FrameSink, frame: ServerFrame): void {
  sink.send(JSON.stringify(frame));
}

function readJson(payload: string): unknown {
  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
}
