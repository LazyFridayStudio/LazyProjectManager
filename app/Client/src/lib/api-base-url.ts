const STORAGE_KEY = 'lpm.apiBaseUrl';

/**
 * Which server this client is pointed at.
 *
 * Resolution order matters. A URL the user typed into the connect screen wins,
 * because that is the whole point of the screen. Failing that, a build-time
 * default covers the packaged self-host image. Failing that, the page's own
 * origin covers the normal case where the API and the web app are served through
 * the same Cloudflare tunnel.
 */
export function readApiBaseUrl(): string {
  const chosenByUser = readStoredBaseUrl();

  if (chosenByUser !== null) {
    return chosenByUser;
  }

  const buildTimeDefault = import.meta.env.VITE_API_BASE_URL;

  if (buildTimeDefault !== undefined && buildTimeDefault !== '') {
    return buildTimeDefault;
  }

  return window.location.origin;
}

/** Records the server the user chose on the connect screen. */
export function rememberApiBaseUrl(baseUrl: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, baseUrl);
  } catch {
    // Storage is unavailable in private-browsing modes and inside some embedded
    // web views. Forgetting the choice on reload beats failing to connect.
  }
}

function readStoredBaseUrl(): string | null {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === null || stored === '' ? null : stored;
  } catch {
    return null;
  }
}
