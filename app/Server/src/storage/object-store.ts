import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { Readable } from 'node:stream';

/**
 * The object store, which is where every byte lives.
 *
 * S3-compatible rather than S3: the self-hosted compose runs MinIO, and a studio
 * that already has a bucket somewhere points at that instead. Nothing here
 * assumes Amazon.
 *
 * **Nothing outside this process ever addresses the store.** It used to: the API
 * signed a URL, the browser uploaded straight to MinIO, and the API was told
 * afterwards — which kept a four-gigabyte source file from going through Node.
 * It also meant an install needed a second address that a browser could resolve,
 * and a release shipped one nothing was listening on, so every upload and every
 * image on an installed copy failed (#172). A signature covers the host it was
 * signed for, so that address could not be corrected after the fact.
 *
 * Now the API is the only thing that talks to the store, and the browser talks
 * only to the API — one hostname to configure, and behind a tunnel one route
 * rather than two. The bytes stream through this process rather than into it:
 * `openStream` and `writeStream` hand the socket on without buffering, so a
 * forty-megabyte attachment costs a pipe rather than forty megabytes of heap.
 */
export interface ObjectStoreOptions {
  /** How this server reaches the store. Inside compose, that is `minio:9000`. */
  readonly endpoint: string;
  readonly bucket: string;
  readonly accessKey: string;
  readonly secretKey: string;
  /**
   * MinIO addresses buckets by path rather than by subdomain, which is what a
   * self-hosted store on a bare hostname needs.
   */
  readonly forcePathStyle: boolean;
  readonly region?: string;
}

export interface StoredObject {
  readonly bytes: number;
  readonly mime: string;
}

/** An object, open for reading, with the two headers a response needs. */
export interface ObjectStream extends StoredObject {
  readonly body: Readable;
}

/** An object on its way in, still arriving. */
export interface StreamedUpload extends StoredObject {
  readonly storageKey: string;
  readonly body: Readable;
}

export class ObjectStore {
  private readonly client: S3Client;

  constructor(private readonly options: ObjectStoreOptions) {
    this.client = createClient(options);
  }

  /**
   * Makes sure the bucket is there.
   *
   * Called once at start-up. A self-hosted install should not need somebody to
   * open a console and create a bucket before the first upload works.
   */
  async ensureBucket(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.options.bucket }));
    } catch {
      await this.client.send(new CreateBucketCommand({ Bucket: this.options.bucket }));
    }
  }

  /**
   * Opens an object for reading, or null if it is not there.
   *
   * A stream rather than a buffer: this is what `/api/f/<id>` pipes to the
   * browser, and an attachment can be a source file. Nothing here waits for the
   * whole object, so the memory this costs is one pipe however large the file
   * is.
   */
  async openStream(storageKey: string): Promise<ObjectStream | null> {
    try {
      const object = await this.client.send(
        new GetObjectCommand({ Bucket: this.options.bucket, Key: storageKey }),
      );

      if (object.Body === undefined) {
        return null;
      }

      return {
        // The SDK returns a Node `Readable` on this platform. It is typed as the
        // union of every runtime's stream, and narrowing it here is the one
        // place that has to know which one we are on.
        body: object.Body as Readable,
        bytes: object.ContentLength ?? 0,
        mime: object.ContentType ?? 'application/octet-stream',
      };
    } catch {
      return null;
    }
  }

  /**
   * Writes an object straight from the request that is carrying it.
   *
   * `bytes` is required rather than optional: without it the SDK has to buffer
   * the whole stream to work out what to put in the header, which is the thing
   * this exists to avoid.
   */
  async writeStream(upload: StreamedUpload): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.options.bucket,
        Key: upload.storageKey,
        Body: upload.body,
        ContentType: upload.mime,
        ContentLength: upload.bytes,
      }),
    );
  }

  /**
   * Reads an object back into memory, or null if it is not there.
   *
   * Only the worker uses this, and only for files small enough to be worth
   * making a thumbnail of. Anything on a request path wants `openStream`.
   */
  async read(storageKey: string): Promise<Buffer | null> {
    try {
      const object = await this.client.send(
        new GetObjectCommand({ Bucket: this.options.bucket, Key: storageKey }),
      );

      const body = await object.Body?.transformToByteArray();

      return body === undefined ? null : Buffer.from(body);
    } catch {
      return null;
    }
  }

  /** Writes an object this server made, rather than one somebody uploaded. */
  async write(storageKey: string, body: Buffer, mime: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.options.bucket,
        Key: storageKey,
        Body: body,
        ContentType: mime,
      }),
    );
  }

  /**
   * What the store actually received, or null if nothing did.
   *
   * The browser says an upload finished; this is what checks. A size taken from
   * the client would be a number anybody could type.
   */
  async describe(storageKey: string): Promise<StoredObject | null> {
    try {
      const head = await this.client.send(
        new HeadObjectCommand({ Bucket: this.options.bucket, Key: storageKey }),
      );

      return {
        bytes: head.ContentLength ?? 0,
        mime: head.ContentType ?? 'application/octet-stream',
      };
    } catch {
      return null;
    }
  }
}

function createClient(options: ObjectStoreOptions): S3Client {
  return new S3Client({
    endpoint: options.endpoint,
    // A store that is not Amazon still wants a region in the signature.
    region: options.region ?? 'us-east-1',
    forcePathStyle: options.forcePathStyle,
    credentials: { accessKeyId: options.accessKey, secretAccessKey: options.secretKey },
  });
}
