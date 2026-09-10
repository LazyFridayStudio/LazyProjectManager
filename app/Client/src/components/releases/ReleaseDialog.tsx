import { useState } from 'react';
import { describeFileSize, readFileSize, type Release, type ReleaseAsset } from '@lpm/shared';

import { describeFailure, readFieldProblems } from '../../api/failure-messages.js';
import { Button, Field, useDisplay, useModalDialog } from '../ui/index.js';
import { MarkdownToolbar } from '../markdown/index.js';
import { useMarkdownCommands } from '../../logic/markdown/index.js';
import { useRecordRelease, useUpdateRelease } from '../../logic/releases/use-releases.js';
import styles from './BuildsScreen.module.css';

export interface ReleaseDialogProps {
  readonly projectId: string;
  /** The release being changed, or null for one that does not exist yet. */
  readonly release: Release | null;
  readonly onDone: () => void;
}

/** A download being typed, before it is a number of bytes. */
interface TypedAsset {
  readonly name: string;
  /** As somebody types it: `4.2 GB`. Read into bytes when it is sent. */
  readonly size: string;
  readonly downloads: string;
  /** Where the file is. Empty is "nobody said", and the row then offers nothing. */
  readonly url: string;
}

/**
 * A release as it is being typed.
 *
 * One piece of state rather than eleven, because every field of it travels
 * together: it is filled from a release, sent as a release, and nothing here
 * ever changes one of them without the rest being what they were.
 */
interface Draft {
  readonly tag: string;
  readonly name: string;
  readonly publishedOn: string;
  readonly author: string;
  readonly commitSha: string;
  readonly runLabel: string;
  readonly url: string;
  readonly isPrerelease: boolean;
  readonly isDraft: boolean;
  readonly notes: string;
  readonly assets: readonly TypedAsset[];
}

type Change = (part: Partial<Draft>) => void;

type Problems = Readonly<Record<string, string>>;

/**
 * Records what shipped, or changes what was recorded.
 *
 * One dialog for both, because the fields are the same ones and a studio
 * correcting a tag it typed wrong should not meet a different form from the one
 * it typed into.
 */
export function ReleaseDialog({
  projectId,
  release,
  onDone,
}: ReleaseDialogProps): React.JSX.Element {
  const dialog = useModalDialog(onDone);
  const record = useRecordRelease();
  const change = useUpdateRelease();
  const { showError } = useDisplay();
  const [draft, setDraft] = useState<Draft>(() => draftFrom(release));

  const saving = release === null ? record : change;
  const problems = readFieldProblems(saving.error);
  const heading = release === null ? 'Record a release' : `Edit ${release.tag}`;

  const edit: Change = (part) => {
    setDraft((current) => ({ ...current, ...part }));
  };

  const save = (): void => {
    const complain = {
      onSuccess: () => {
        dialog.close();
      },
      onError: (error: Error) => {
        // Field problems are drawn on their fields; anything else is said once
        // where every other failure in this product is said.
        if (Object.keys(readFieldProblems(error)).length === 0) {
          showError(describeFailure(error));
        }
      },
    };

    if (release === null) {
      record.mutate({ projectId, ...asCommand(draft) }, complain);
    } else {
      change.mutate({ releaseId: release.id, ...asCommand(draft) }, complain);
    }
  };

  return (
    <dialog {...dialog.dialogProps} className={styles.dialog} aria-label={heading}>
      <form
        className={styles.dialogBody}
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <h2 className={styles.dialogHeading}>{heading}</h2>

        <WhatItIs draft={draft} problems={problems} onChange={edit} />
        <WhereItCameFrom draft={draft} problems={problems} onChange={edit} />
        <WhatChanged notes={draft.notes} onChange={edit} />
        <Downloads
          assets={draft.assets}
          onChange={(assets) => {
            edit({ assets });
          }}
        />

        <div className={styles.dialogActions}>
          <Button tone="stop" onClick={dialog.close}>
            Cancel
          </Button>
          <Button tone="go" type="submit" busy={saving.isPending} busyLabel="Saving…">
            {release === null ? 'Record it' : 'Save changes'}
          </Button>
        </div>
      </form>
    </dialog>
  );
}

/** The tag, the day and the name — what somebody calls the release. */
function WhatItIs({
  draft,
  problems,
  onChange,
}: {
  draft: Draft;
  problems: Problems;
  onChange: Change;
}): React.JSX.Element {
  return (
    <>
      <div className={styles.dialogRow}>
        <Field
          label="Tag"
          placeholder="v0.9.4"
          value={draft.tag}
          problem={problems.tag}
          onChange={(event) => {
            onChange({ tag: event.target.value });
          }}
        />
        <Field
          label="Published"
          type="date"
          value={draft.publishedOn}
          problem={problems.publishedOn}
          onChange={(event) => {
            onChange({ publishedOn: event.target.value });
          }}
        />
      </div>

      <Field
        label="Name"
        placeholder="Vertical slice — Example Project"
        value={draft.name}
        problem={problems.name}
        onChange={(event) => {
          onChange({ name: event.target.value });
        }}
      />
    </>
  );
}

/** Who cut it, from what, and where it can be looked at. */
function WhereItCameFrom({
  draft,
  problems,
  onChange,
}: {
  draft: Draft;
  problems: Problems;
  onChange: Change;
}): React.JSX.Element {
  return (
    <>
      <div className={styles.dialogRow}>
        <Field
          label="Published by"
          placeholder="build-bot"
          value={draft.author}
          problem={problems.author}
          onChange={(event) => {
            onChange({ author: event.target.value });
          }}
        />
        <Field
          label="Commit"
          placeholder="4f2ac91"
          value={draft.commitSha}
          onChange={(event) => {
            onChange({ commitSha: event.target.value });
          }}
        />
      </div>

      <div className={styles.dialogRow}>
        <Field
          label="Run"
          placeholder="release.yml · run #218"
          value={draft.runLabel}
          onChange={(event) => {
            onChange({ runLabel: event.target.value });
          }}
        />
        <Field
          label="Link"
          placeholder="https://github.com/…/releases/tag/v0.9.4"
          value={draft.url}
          problem={problems.url}
          onChange={(event) => {
            onChange({ url: event.target.value });
          }}
        />
      </div>

      <div className={styles.flags}>
        {/* Two flags rather than one state, because they are independent: a
            draft of a pre-release is a real thing a studio has. */}
        <label className={styles.flag}>
          <input
            type="checkbox"
            checked={draft.isPrerelease}
            onChange={(event) => {
              onChange({ isPrerelease: event.target.checked });
            }}
          />
          Pre-release
        </label>
        <label className={styles.flag}>
          <input
            type="checkbox"
            checked={draft.isDraft}
            onChange={(event) => {
              onChange({ isDraft: event.target.checked });
            }}
          />
          Draft
        </label>
      </div>
    </>
  );
}

/** The changelog, in the same markdown the rest of the product takes. */
function WhatChanged({ notes, onChange }: { notes: string; onChange: Change }): React.JSX.Element {
  const commands = useMarkdownCommands(notes, (written) => {
    onChange({ notes: written });
  });

  return (
    <div className={styles.notesField}>
      <span className={styles.fieldLabel}>What changed</span>
      <MarkdownToolbar onCommand={commands.run} active={commands.active} />
      <textarea
        ref={commands.box}
        className={styles.notesBox}
        value={notes}
        aria-label="What changed"
        placeholder={'## Added\n- Tier-3 weapon set'}
        onChange={(event) => {
          onChange({ notes: event.target.value });
        }}
        onKeyDown={commands.onKeyDown}
        onSelect={commands.onSelect}
      />
    </div>
  );
}

/**
 * The files somebody can download, typed in.
 *
 * Sizes are typed the way they are said — `4.2 GB` — and read into bytes on the
 * way out. Nobody types a byte count for a game build, and asking them to would
 * be asking them to do arithmetic the product can do.
 */
function Downloads({
  assets,
  onChange,
}: {
  assets: readonly TypedAsset[];
  onChange: (assets: readonly TypedAsset[]) => void;
}): React.JSX.Element {
  const edit = (index: number, part: Partial<TypedAsset>): void => {
    onChange(assets.map((asset, spot) => (spot === index ? { ...asset, ...part } : asset)));
  };

  return (
    <div className={styles.notesField}>
      <span className={styles.fieldLabel}>Downloads</span>

      {assets.map((asset, index) => (
        <div key={index} className={styles.assetRow}>
          <Field
            label="File"
            placeholder="ExampleProject-VerticalSlice-win64.zip"
            value={asset.name}
            onChange={(event) => {
              edit(index, { name: event.target.value });
            }}
          />
          <Field
            label="Size"
            placeholder="4.2 GB"
            value={asset.size}
            // What it was understood as, so a typo shows before it is saved.
            hint={sizeRead(asset.size)}
            onChange={(event) => {
              edit(index, { size: event.target.value });
            }}
          />
          <Field
            label="Downloads"
            inputMode="numeric"
            value={asset.downloads}
            onChange={(event) => {
              edit(index, { downloads: event.target.value });
            }}
          />
          {/* Where the file is. Optional, because a studio recording what it
              shipped is not always recording where it put it — and a row with
              no link simply offers nothing to press. */}
          {/* Not `Link`: the release itself has one of those, and a form with
              two fields called Link is a form somebody fills in wrongly once
              and then does not trust. */}
          <Field
            label="Where it is"
            placeholder="https://…"
            value={asset.url}
            onChange={(event) => {
              edit(index, { url: event.target.value });
            }}
          />
          <button
            type="button"
            className={styles.danger}
            aria-label={`Remove ${asset.name === '' ? 'this download' : asset.name}`}
            onClick={() => {
              onChange(assets.filter((_, spot) => spot !== index));
            }}
          >
            Remove
          </button>
        </div>
      ))}

      <button
        type="button"
        className={styles.plain}
        onClick={() => {
          onChange([...assets, { name: '', size: '', downloads: '0', url: '' }]);
        }}
      >
        + Add a download
      </button>
    </div>
  );
}

/** What a typed size was understood as, or nothing while there is nothing to say. */
function sizeRead(typed: string): string | undefined {
  const bytes = readFileSize(typed);

  return bytes === null ? undefined : describeFileSize(bytes);
}

/** A release nobody has typed anything into yet. */
const BLANK: Draft = {
  tag: '',
  name: '',
  publishedOn: '',
  author: '',
  commitSha: '',
  runLabel: '',
  url: '',
  isPrerelease: false,
  isDraft: false,
  notes: '',
  assets: [],
};

/**
 * The form's starting state.
 *
 * Two cases rather than eleven fallbacks: a new release is blank apart from the
 * day, and an existing one is itself. The only defaults left are the three
 * columns that are genuinely nullable, where an empty box means "there isn't
 * one".
 */
function draftFrom(release: Release | null): Draft {
  if (release === null) {
    return { ...BLANK, publishedOn: today() };
  }

  return {
    tag: release.tag,
    name: release.name,
    publishedOn: release.publishedOn,
    author: release.author,
    commitSha: release.commitSha ?? '',
    runLabel: release.runLabel ?? '',
    url: release.url ?? '',
    isPrerelease: release.isPrerelease,
    isDraft: release.isDraft,
    notes: release.notes,
    assets: typeAssets(release.assets),
  };
}

interface ReleaseCommandFields {
  tag: string;
  name: string;
  publishedOn: string;
  author: string;
  commitSha: string | null;
  runLabel: string | null;
  url: string | null;
  isPrerelease: boolean;
  isDraft: boolean;
  notes: string;
  assets: {
    name: string;
    sizeBytes: number | null;
    downloadCount: number;
    downloadUrl: string | null;
  }[];
}

/** The draft as the command takes it: blanks become nulls, sizes become bytes. */
function asCommand(draft: Draft): ReleaseCommandFields {
  return {
    tag: draft.tag,
    name: draft.name,
    publishedOn: draft.publishedOn,
    author: draft.author,
    commitSha: blankToNull(draft.commitSha),
    runLabel: blankToNull(draft.runLabel),
    url: blankToNull(draft.url),
    isPrerelease: draft.isPrerelease,
    isDraft: draft.isDraft,
    notes: draft.notes,
    // A row nobody typed a name into is a row nobody meant to add.
    assets: draft.assets
      .filter((asset) => asset.name.trim() !== '')
      .map((asset) => ({
        name: asset.name.trim(),
        sizeBytes: readFileSize(asset.size),
        downloadCount: Number.parseInt(asset.downloads, 10) || 0,
        // Empty is "nobody said", which is not the same as a bad link — the
        // command only judges one that was actually typed.
        downloadUrl: asset.url.trim() === '' ? null : asset.url.trim(),
      })),
  };
}

function typeAssets(assets: readonly ReleaseAsset[] | undefined): readonly TypedAsset[] {
  return (assets ?? []).map((asset) => ({
    name: asset.name,
    size: asset.sizeBytes === null ? '' : describeFileSize(asset.sizeBytes),
    downloads: String(asset.downloadCount),
    url: asset.downloadUrl ?? '',
  }));
}

/** An empty box means "there isn't one", which is null rather than `''`. */
function blankToNull(typed: string): string | null {
  return typed.trim() === '' ? null : typed.trim();
}

/** Today where the reader is, which is the day they mean by "today". */
function today(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');

  return `${String(now.getFullYear())}-${month}-${day}`;
}
