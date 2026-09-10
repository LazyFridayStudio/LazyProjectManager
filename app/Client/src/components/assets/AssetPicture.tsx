import { useEffect, useState } from 'react';

export interface AssetPictureProps {
  /** Null while the upload has not been confirmed. */
  readonly url: string | null;
  readonly alt: string;
  /** Drawn instead when there is nothing to show, or nothing that will draw. */
  readonly fallback: string;
  /** `string | undefined`, because that is what a CSS module hands out. */
  readonly imageClassName: string | undefined;
  readonly fallbackClassName: string | undefined;
}

/**
 * A picture of an asset, or the words to put where one would be.
 *
 * The server hands back the original until the worker has made a thumbnail, so
 * something uploaded a second ago appears immediately. That leaves one case
 * this has to handle: `image/*` is broader than what a browser will actually
 * draw. An `.exr` or a 32-bit `.tga` is genuinely an image and genuinely not
 * something Chrome can paint, and until a thumbnail exists there is no way to
 * know except to try.
 *
 * So it tries, and falls back to the filename — which is what the sheet showed
 * before any of this and is still the honest answer.
 */
export function AssetPicture({
  url,
  alt,
  fallback,
  imageClassName,
  fallbackClassName,
}: AssetPictureProps): React.JSX.Element {
  const [isBroken, setIsBroken] = useState(false);

  // A different picture deserves its own attempt: this component is reused
  // across a strip, and one that failed should not condemn the next one into
  // the same slot.
  useEffect(() => {
    setIsBroken(false);
  }, [url]);

  if (url === null || isBroken) {
    return <span className={fallbackClassName}>{fallback}</span>;
  }

  return (
    <img
      className={imageClassName}
      src={url}
      alt={alt}
      onError={() => {
        setIsBroken(true);
      }}
    />
  );
}
