import { useState } from 'react';

import { describeFailure } from '../../api/failure-messages.js';
import { Button, ButtonIcon, PlusIcon, TrashIcon, useDisplay } from '../ui/index.js';
import { useTagAsset, useUntagAsset } from '../../logic/assets/use-assets.js';
import styles from './AssetTags.module.css';

export interface AssetTagsProps {
  readonly assetId: string;
  readonly projectSlug: string;
  readonly tags: readonly string[];
  readonly canWrite: boolean;
}

/**
 * The words an asset is filed under.
 *
 * A category says what kind of thing something is and there is exactly one; a
 * tag says anything else worth finding it by later — `modular`, `act-1`,
 * `outsourced` — and there are as many as are useful.
 *
 * Live outside edit mode, like the stage button above it. Tagging is what
 * somebody does while looking at a thing and realising what it has in common
 * with another one, and a trip through Edit is enough friction to stop them.
 */
export function AssetTags({
  assetId,
  projectSlug,
  tags,
  canWrite,
}: AssetTagsProps): React.JSX.Element {
  const [adding, setAdding] = useState<string | null>(null);
  const display = useDisplay();
  const tag = useTagAsset(projectSlug, assetId);
  const untag = useUntagAsset(projectSlug, assetId);

  const report = {
    onError: (error: Error) => {
      display.showError(describeFailure(error));
    },
  };

  const submit = (): void => {
    const wanted = adding?.trim() ?? '';

    if (wanted === '') {
      setAdding(null);

      return;
    }

    tag.mutate(
      { assetId, tag: wanted },
      {
        ...report,
        // Cleared rather than closed: somebody adding one tag is usually adding
        // three, and reopening the field each time is three extra presses.
        onSuccess: () => {
          setAdding('');
        },
      },
    );
  };

  return (
    <section className={styles.tags} aria-label="Tags">
      <h3 className={styles.heading}>Tags</h3>

      <div className={styles.chips}>
        {tags.map((name) => (
          <span key={name} className={styles.chip}>
            {name}
            {canWrite && (
              <button
                type="button"
                className={styles.remove}
                aria-label={`Remove ${name}`}
                disabled={untag.isPending}
                onClick={() => {
                  untag.mutate({ assetId, tag: name }, report);
                }}
              >
                <TrashIcon size={11} />
              </button>
            )}
          </span>
        ))}

        {canWrite && adding === null && (
          <Button
            tone="go"
            size="compact"
            aria-label="Add tag"
            title="Add tag"
            onClick={() => {
              setAdding('');
            }}
          >
            <span className={styles.addLabel}>
              <ButtonIcon>
                <PlusIcon size={12} />
              </ButtonIcon>
              Add tag
            </span>
          </Button>
        )}

        {canWrite && adding !== null && (
          <input
            className={styles.input}
            aria-label="New tag"
            placeholder="act-1"
            autoFocus
            value={adding}
            disabled={tag.isPending}
            onChange={(event) => {
              setAdding(event.target.value);
            }}
            onKeyDown={(event) => {
              // Enter adds and stays; Escape gives up. The panel is a form, so
              // without this Enter would submit whatever else is on it.
              if (event.key === 'Enter') {
                event.preventDefault();
                submit();
              }

              if (event.key === 'Escape') {
                event.preventDefault();
                setAdding(null);
              }
            }}
            onBlur={() => {
              setAdding(null);
            }}
          />
        )}
      </div>

      {tags.length === 0 && !canWrite && <p className={styles.empty}>None yet.</p>}
    </section>
  );
}
