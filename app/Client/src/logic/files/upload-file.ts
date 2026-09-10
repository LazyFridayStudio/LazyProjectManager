import { confirmUploadCommand, requestUploadCommand, type UploadTarget } from '@lpm/shared';

import { UploadFailedError, type ApiClient } from '../../api/index.js';

/**
 * The three steps an upload actually takes.
 *
 * Ask the server where to put it, PUT the bytes there, tell the server it
 * arrived. All three go to the same server the rest of the app talks to, which
 * is the point: the middle step used to go straight at the object store, and
 * that needed an address the browser could resolve, supplied by whoever
 * installed it. A release shipped one nothing was listening on (#172).
 *
 * Shared, because a card attachment and a project's key art are the same three
 * steps pointed at different things.
 */
export async function uploadFile(
  client: ApiClient,
  target: UploadTarget,
  file: File,
): Promise<string> {
  // Browsers leave this empty for anything they do not recognise, which is most
  // of what a studio uploads.
  const mime = file.type === '' ? 'application/octet-stream' : file.type;

  const requested = await client.command(requestUploadCommand, {
    target,
    filename: file.name,
    mime,
    bytes: file.size,
  });

  if (requested.uploadUrl === undefined || requested.id === undefined) {
    throw new Error('The server did not say where to put that file.');
  }

  await sendBytes(`${client.baseUrl}${requested.uploadUrl}`, file, mime);

  // Only now does the file exist as far as anything else is concerned. A tab
  // closed between the PUT and this leaves a pending row and nothing pointing
  // at it, which is the state the schema was built for.
  await client.command(confirmUploadCommand, { fileId: requested.id });

  return requested.id;
}

/**
 * Sends the bytes.
 *
 * Not through `ApiClient`, because this is not a command or a query — it is one
 * request whose whole body is a file, and the envelope has nothing to say about
 * it. It carries the session cookie like everything else does, which is what
 * authorises it now that the address is this server's own.
 *
 * A failure here says so rather than becoming "could not reach the server". The
 * server is plainly reachable — the step before this one just answered — and a
 * message that blames the connection is a message that sends somebody to check
 * their wifi.
 */
async function sendBytes(uploadUrl: string, file: File, mime: string): Promise<void> {
  let response: Response;

  try {
    response = await fetch(uploadUrl, {
      method: 'PUT',
      body: file,
      credentials: 'include',
      headers: { 'content-type': mime },
    });
  } catch (cause) {
    // Naming where it went, because that is the sentence that would have made
    // #172 readable off the screen instead of out of a compose file.
    throw new UploadFailedError(
      `The upload of ${file.name} did not reach ${describeHost(uploadUrl)}.`,
      cause,
    );
  }

  if (!response.ok) {
    throw new UploadFailedError(await readRefusal(response, file.name));
  }
}

/**
 * The address the bytes were sent to, short enough to read in a message.
 *
 * The origin rather than the whole URL: what somebody needs to know is which
 * server was tried, and the rest of it is a uuid.
 */
function describeHost(uploadUrl: string): string {
  try {
    return new URL(uploadUrl).origin;
  } catch {
    return uploadUrl;
  }
}

/** What the server said about the refusal, or the status when it said nothing. */
async function readRefusal(response: Response, filename: string): Promise<string> {
  try {
    const body: unknown = await response.json();

    if (typeof body === 'object' && body !== null && 'message' in body) {
      return String(body.message);
    }
  } catch {
    // A refusal with no body, or one from something in front of the server. The
    // status is then the only thing there is to say.
  }

  return `The server refused ${filename} (${String(response.status)}).`;
}
