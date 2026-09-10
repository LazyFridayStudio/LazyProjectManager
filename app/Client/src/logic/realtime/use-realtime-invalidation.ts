import { serverFrameSchema, type InvalidationScope } from '@lpm/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { useApiClient } from '../../components/ApiClientProvider.js';
import { toSocketUrl } from './socket-url.js';

/** How long to wait before opening a socket again after one drops. */
const RECONNECT_DELAY_MS = 2_000;

/**
 * Keeps what is on screen in step with what other people are doing.
 *
 * The socket only ever says which caches went stale; the refetch goes through
 * the same query the screen already uses, so there is one path to the data
 * rather than a live one and a loaded one that can disagree.
 *
 * A dropped connection is reopened rather than left silent — a board that has
 * quietly stopped updating is worse than one that never claimed to.
 */
export function useRealtimeInvalidation(projectId: string | null): void {
  const { baseUrl } = useApiClient();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (projectId === null) {
      return;
    }

    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let closedOnPurpose = false;

    const invalidate = (scopes: readonly InvalidationScope[]): void => {
      for (const scope of scopes) {
        void queryClient.invalidateQueries({ queryKey: [scopeToKey(scope), baseUrl] });
      }
    };

    const connect = (): void => {
      socket = new WebSocket(toSocketUrl(baseUrl));

      socket.addEventListener('open', () => {
        socket?.send(JSON.stringify({ type: 'watch', projectId }));
      });

      socket.addEventListener('message', (event: MessageEvent<string>) => {
        const frame = serverFrameSchema.safeParse(readJson(event.data));

        if (frame.success && frame.data.type === 'invalidate') {
          invalidate(frame.data.scopes);
        }
      });

      socket.addEventListener('close', () => {
        if (!closedOnPurpose) {
          reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
        }
      });
    };

    connect();

    return () => {
      closedOnPurpose = true;

      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer);
      }

      socket?.close();
    };
  }, [baseUrl, projectId, queryClient]);
}

/**
 * The query key family a scope stands for.
 *
 * The names are deliberately the same ones the hooks build their keys from, so
 * a scope invalidates exactly what a command would have.
 */
function scopeToKey(scope: InvalidationScope): string {
  return scope === 'projects' ? 'projects' : scope;
}

function readJson(payload: string): unknown {
  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
}
