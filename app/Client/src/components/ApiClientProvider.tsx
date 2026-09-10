import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import { readApiBaseUrl, rememberApiBaseUrl } from '../lib/api-base-url.js';
import { ApiClient } from '../api/api-client.js';

interface ApiClientContextValue {
  readonly client: ApiClient;
  readonly baseUrl: string;
  /** Points this client at a different server and remembers the choice. */
  readonly connectTo: (baseUrl: string) => void;
}

const ApiClientContext = createContext<ApiClientContextValue | null>(null);

/**
 * Holds the server this client is talking to.
 *
 * The base URL is state rather than a constant because choosing a server is a
 * thing the user does on the connect screen — the same build has to work against
 * a Cloudflare tunnel hostname, a LAN address and localhost.
 */
export function ApiClientProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [baseUrl, setBaseUrl] = useState(readApiBaseUrl);

  const connectTo = useCallback((nextBaseUrl: string) => {
    const normalised = nextBaseUrl.trim().replace(/\/+$/, '');
    rememberApiBaseUrl(normalised);
    setBaseUrl(normalised);
  }, []);

  const value = useMemo<ApiClientContextValue>(
    // A new ApiClient per base URL, so nothing can keep talking to the previous
    // server after the user switches.
    () => ({ client: new ApiClient(baseUrl), baseUrl, connectTo }),
    [baseUrl, connectTo],
  );

  return <ApiClientContext.Provider value={value}>{children}</ApiClientContext.Provider>;
}

export function useApiClient(): ApiClientContextValue {
  const value = useContext(ApiClientContext);

  if (value === null) {
    throw new Error('useApiClient must be used inside an ApiClientProvider.');
  }

  return value;
}
