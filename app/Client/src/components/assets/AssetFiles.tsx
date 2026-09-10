import type { AssetFile } from '@lpm/shared';
import { useRef, useState } from 'react';

import { readFieldProblems } from '../../api/failure-messages.js';
import { Button, ButtonIcon, Field, PlusIcon, useDisplay } from '../ui/index.js';
import { joinClassNames } from '../../lib/join-class-names.js';
import {
  useAddAssetFiles,
  useLinkAssetFile,
  useRemoveAssetFile,
} from '../../logic/assets/use-assets.js';
import { useFileDrop } from '../../logic/assets/use-file-drop.js';
import styles from './AssetFiles.module.css';

export interface AssetFilesProps {
  readonly assetId: string;
  readonly projectSlug: string;
  readonly files: readonly AssetFile[];
  readonly canWrite: boolean;
}

/**
 * What the asset is made of: the source, not the picture of it.
 *
 * The reference sheet holds what a thing looks like. This holds the `.blend`,
 * the `.psd`, the Substance graph, the FBX handed to engineering — anything
 * with no picture in it, which is most of what a studio actually works on.
 *
 * Either the bytes are here or they are somewhere else, and both are first
 * class. A studio with a Perforce depot is never going to upload a four-
 * gigabyte source file into a project manager, and a tool that only accepted
 * uploads would be a tool holding an out-of-date copy of everything.
 */
export function AssetFiles({
  assetId,
  projectSlug,
  files,
  canWrite,
}: AssetFilesProps): React.JSX.Element {
  const [isLinking, setIsLinking] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const add = useAddAssetFiles(projectSlug, assetId);

  // Anything at all: this is the list for what a studio actually works in.
  const upload = (chosen: FileList | null): void => {
    const files = Array.from(chosen ?? []);

    if (files.length > 0) {
      add.mutate(files, {});
    }
  };

  const drop = useFileDrop(canWrite, upload);

  return (
    <section
      className={joinClassNames(styles.files, drop.isOver && styles.filesOver)}
      // Named, so it is a landmark somebody can jump to rather than an
      // anonymous box in the middle of the panel.
      aria-label="Files"
      {...drop.dropProps}
    >
      <div className={styles.head}>
        <h3 className={styles.heading}>Files</h3>
      </div>

      {files.length === 0 ? (
        <p className={styles.empty}>
          {canWrite
            ? 'Nothing yet. Upload the source, or link to where it already lives.'
            : 'Nothing yet.'}
        </p>
      ) : (
        <ul className={styles.list}>
          {files.map((file) => (
            <FileRow
              key={file.id}
              file={file}
              assetId={assetId}
              projectSlug={projectSlug}
              canWrite={canWrite}
            />
          ))}
        </ul>
      )}

      {/* Under the list, where the reference sheet keeps its buttons too: the
          thing being acted on comes first, and what you can do to it follows. */}
      {canWrite && (
        <div className={styles.actions}>
          <Button
            tone="go"
            busy={add.isPending}
            busyLabel="Uploading…"
            onClick={() => {
              picker.current?.click();
            }}
          >
            Add file
          </Button>
          <Button
            tone="go"
            onClick={() => {
              setIsLinking((linking) => !linking);
            }}
          >
            Add link
          </Button>
        </div>
      )}

      {isLinking && (
        <LinkForm
          assetId={assetId}
          projectSlug={projectSlug}
          onDone={() => {
            setIsLinking(false);
          }}
        />
      )}

      <input
        ref={picker}
        type="file"
        multiple
        className={styles.hiddenPicker}
        aria-label="Upload files"
        onChange={(event) => {
          upload(event.target.files);

          // Cleared so choosing the same file twice in a row still fires.
          event.target.value = '';
        }}
      />
    </section>
  );
}

interface FileRowProps {
  readonly file: AssetFile;
  readonly assetId: string;
  readonly projectSlug: string;
  readonly canWrite: boolean;
}

/**
 * One file, and where it is.
 *
 * The row says whether it is held here or somewhere else, because "downloads
 * 900MB" and "opens somebody else's website" are different things to be about
 * to do, and the link on its own does not say which.
 */
function FileRow({ file, assetId, projectSlug, canWrite }: FileRowProps): React.JSX.Element {
  const display = useDisplay();
  const remove = useRemoveAssetFile(projectSlug, assetId);

  return (
    <li className={styles.row}>
      <a
        className={styles.link}
        href={file.href}
        target="_blank"
        // A link somebody typed points at a site this app has no say over.
        rel="noreferrer noopener"
      >
        {file.label}
      </a>

      <span className={styles.where}>{file.stored ? describeSize(file.bytes) : 'linked'}</span>

      {canWrite && (
        <button
          type="button"
          className={styles.rowAction}
          disabled={remove.isPending}
          onClick={() => {
            void (async () => {
              const said = await display.askToConfirm({
                question: `Remove ${file.label}?`,
                // Two acts behind one button and only one of them destroys
                // anything: a file held here is thrown away, a link is only
                // forgotten. The question says which this one is.
                consequence: file.stored
                  ? 'The file is thrown away. It is not kept anywhere else.'
                  : 'The link is forgotten. Whatever it points at is untouched.',
                confirmLabel: 'Remove',
              });

              if (!said) return;

              remove.mutate({ assetFileId: file.id }, {});
            })();
          }}
        >
          remove
        </button>
      )}
    </li>
  );
}

/**
 * How big it is, in the unit somebody would say out loud.
 *
 * Powers of two, which is what a file manager shows and therefore what anybody
 * comparing the two would expect.
 */
function describeSize(bytes: number | null): string {
  if (bytes === null) {
    return 'uploading…';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let unit = 0;

  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }

  // No decimal on bytes and kilobytes: "1.0 KB" is noise where "1 KB" is not.
  return `${size.toFixed(unit < 2 ? 0 : 1)} ${units[unit] ?? 'B'}`;
}

/**
 * Where a file lives, when it does not live here.
 *
 * A label as well as an address, because a depot path or a signed storage URL
 * is unreadable, and a list of those is a list nobody can use.
 */
function LinkForm({
  assetId,
  projectSlug,
  onDone,
}: {
  assetId: string;
  projectSlug: string;
  onDone: () => void;
}): React.JSX.Element {
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');
  const link = useLinkAssetFile(projectSlug, assetId);
  const problems = readFieldProblems(link.error);

  const submit = (): void => {
    link.mutate(
      { assetId, label: label.trim(), url: url.trim() },
      {
        onSuccess: () => {
          setLabel('');
          setUrl('');
          onDone();
        },
        // A problem with a field stays on that field, where the thing to change
        // is. Anything else has nowhere to be but the display.
      },
    );
  };

  return (
    <div className={styles.linkForm}>
      <Field
        label="What it is"
        autoFocus
        placeholder="Source file — model_hi.blend"
        value={label}
        onChange={(event) => {
          setLabel(event.target.value);
        }}
        problem={problems.label}
      />
      <Field
        label="Where it lives"
        placeholder="https://…"
        value={url}
        onChange={(event) => {
          setUrl(event.target.value);
        }}
        problem={problems.url}
      />

      <div className={styles.linkActions}>
        {/* "Add", not "Add link": the button that opened this form already
            said that, and two of them reading the same is two of them nobody
            can tell apart. */}
        <Button
          tone="go"
          aria-label="Add"
          title="Add"
          busy={link.isPending}
          disabled={label.trim() === '' || url.trim() === ''}
          onClick={submit}
        >
          <ButtonIcon>
            <PlusIcon size={14} />
          </ButtonIcon>
        </Button>
        <Button tone="stop" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
