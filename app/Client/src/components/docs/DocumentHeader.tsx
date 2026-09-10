import { useRef } from 'react';
import { ScreenHeader } from '../shell/ScreenHeader.js';
import {
  markdownFileName,
  titleFromMarkdown,
  type DesignDocView,
  type OpenDocument,
} from '@lpm/shared';

import { describeFailure } from '../../api/failure-messages.js';
import { Button, ButtonIcon, PencilIcon, TrashIcon, useDisplay } from '../ui/index.js';
import { formatInstantDate } from '../../logic/projects/index.js';
import { downloadMarkdown } from '../../logic/docs/markdown-file.js';
import { ExportIcon, FullScreenIcon, ImportIcon, SafeModeIcon, TagIcon } from './doc-icons.js';
import {
  useCreateDesignDoc,
  useDeleteDesignDoc,
  useRenameDesignDoc,
} from '../../logic/docs/use-design-doc.js';
import styles from './DesignDocScreen.module.css';

export interface DocumentHeaderProps {
  readonly view: DesignDocView;
  /** The document open under it, or null while the project keeps none. */
  readonly document: OpenDocument | null;
  /** How long it is now, which while it is being written is the draft. */
  readonly wordCount: number;
  readonly isWriting: boolean;
  readonly isSaving: boolean;
  readonly isFullScreen: boolean;
  readonly onOpen: (docId: string) => void;
  readonly onEdit: () => void;
  readonly onSave: () => void;
  readonly onCancel: () => void;
  readonly onToggleFullScreen: () => void;
}

/**
 * The bar across the top of the design doc, the shape every other screen's is.
 *
 * The document's name, what is true of it underneath, and what you can do to it
 * on the right — the same three parts in the same three places as the board and
 * the library, because somebody who has learnt where the button is on one screen
 * has learnt it for all of them.
 *
 * It runs the full width even when the prose below is held to a reading measure.
 * A header that narrowed with the text would put its controls somewhere
 * different depending on how wide the document happened to be set.
 */
export function DocumentHeader({
  view,
  document,
  wordCount,
  isWriting,
  isSaving,
  isFullScreen,
  onOpen,
  onEdit,
  onSave,
  onCancel,
  onToggleFullScreen,
}: DocumentHeaderProps): React.JSX.Element {
  return (
    // What the screen is, until there is a document to name. It said the
    // project's name, which the sidebar beside it is already saying — so the
    // one heading on the page repeated the one word that was never in doubt
    // and never said which of the project's screens this is.
    <ScreenHeader
      title={document?.title ?? 'Documents'}
      beside={document !== null && <LastUpdated document={document} />}
      facts={
        <>
          <span>
            {view.documents.length} {view.documents.length === 1 ? 'document' : 'documents'}
          </span>
          {document !== null && <span>{wordCount} words</span>}
        </>
      }
      actions={
        <>
          {!view.canWrite && <span className={styles.readOnly}>Read only</span>}

          {isWriting ? (
            <>
              <Button tone="stop" onClick={onCancel}>
                Cancel
              </Button>
              <WidthToggle isFullScreen={isFullScreen} onToggle={onToggleFullScreen} />
              <Button tone="go" busy={isSaving} busyLabel="Saving…" onClick={onSave}>
                Save
              </Button>
            </>
          ) : (
            <DocumentActions
              view={view}
              document={document}
              isFullScreen={isFullScreen}
              onOpen={onOpen}
              onEdit={onEdit}
              onToggleFullScreen={onToggleFullScreen}
            />
          )}
        </>
      }
    />
  );
}

/**
 * When it last changed, and who changed it.
 *
 * The day rather than how long ago, because this is the line somebody reads
 * against a meeting they remember being in. The name is the question a studio
 * actually asks of a design document: a paragraph that moved under you means
 * something different depending on who moved it.
 */
function LastUpdated({ document }: { document: OpenDocument }): React.JSX.Element {
  return (
    <span className={styles.updated}>
      Last updated {formatInstantDate(document.updatedAt)}
      {document.updatedBy !== null && ` · ${document.updatedBy}`}
    </span>
  );
}

/**
 * What can be done to the document being read.
 *
 * Import sits here with no document open as well, because an empty project is
 * exactly where somebody arrives holding a file.
 */
function DocumentActions({
  view,
  document,
  isFullScreen,
  onOpen,
  onEdit,
  onToggleFullScreen,
}: {
  view: DesignDocView;
  document: OpenDocument | null;
  isFullScreen: boolean;
  onOpen: (docId: string) => void;
  onEdit: () => void;
  onToggleFullScreen: () => void;
}): React.JSX.Element {
  const rename = useRenameDesignDoc();
  const remove = useDeleteDesignDoc();
  const { askForText, askToConfirm, showError } = useDisplay();

  // Asked once and read twice: renaming and writing sit between the two rules,
  // and taking the document away sits past the second.
  const mayEdit = view.canWrite && document !== null;

  const complain = {
    onError: (error: Error) => {
      showError(describeFailure(error));
    },
  };

  return (
    <>
      {/* The pair that carries a document across the edge of the app: one out,
          one in. Side by side, because they are the same errand in two
          directions and the rule after them is what marks where the pair
          ends. */}
      {document !== null && (
        <Button
          aria-label="Export MD"
          title="Export MD"
          onClick={() => {
            downloadMarkdown(markdownFileName(document.title), document.body);
          }}
        >
          <ButtonIcon>
            <ExportIcon />
          </ButtonIcon>
        </Button>
      )}

      {view.canWrite && <ImportButton projectId={view.project.id} onOpen={onOpen} />}

      {mayEdit && (
        <>
          {/* Where the pair ends and the open document begins. */}
          <span className={styles.divider} aria-hidden>
            |
          </span>

          <Button
            onClick={() => {
              void (async () => {
                const title = await askForText({
                  question: `Rename ${document.title}`,
                  label: 'Name',
                  value: document.title,
                  confirmLabel: 'Rename',
                });

                if (title === null || title === document.title) return;

                rename.mutate({ docId: document.id, title }, complain);
              })();
            }}
            aria-label="Rename"
            title="Rename"
          >
            <ButtonIcon>
              <TagIcon />
            </ButtonIcon>
          </Button>

          {/* What it is called and what it says: the two ways of changing the
              document itself, so they sit as a pair. A tag and a pencil rather
              than two pencils — see `TagIcon`. */}
          <Button aria-label="Edit document" title="Edit document" onClick={onEdit}>
            <ButtonIcon>
              <PencilIcon />
            </ButtonIcon>
          </Button>
        </>
      )}

      {/* The second rule. Everything before it changes the document — carries
          one in or out, renames it, writes in it. Everything after it does not:
          how wide the page is set, and taking the document away. */}
      {(document !== null || view.canWrite) && (
        <span className={styles.divider} aria-hidden>
          |
        </span>
      )}

      {/* It stays when there is nothing to edit — a document is read far more
          often than it is written, and a reader wants the width too. */}
      <WidthToggle isFullScreen={isFullScreen} onToggle={onToggleFullScreen} />

      {mayEdit && (
        <Button
          tone="stop"
          aria-label="Delete"
          title="Delete"
          onClick={() => {
            void (async () => {
              const said = await askToConfirm({
                question: `Delete ${document.title}?`,
                /*
                 * What goes with it, and that there is a way back.
                 *
                 * This said the prose "cannot be recovered", which stopped
                 * being true when the bin landed: a document waits a week like
                 * everything else, and telling somebody their afternoon is gone
                 * forever is the worst direction for that to be wrong in.
                 */
                consequence:
                  document.wordCount === 0
                    ? 'Nothing is written in it yet. It waits a week in the bin, and can be put back until then.'
                    : `The ${String(document.wordCount)} words written in it go with it. It waits a week in the bin, and can be put back until then.`,
              });

              if (said) remove.mutate({ docId: document.id }, complain);
            })();
          }}
        >
          <ButtonIcon>
            <TrashIcon />
          </ButtonIcon>
        </Button>
      )}
    </>
  );
}

/**
 * How wide the document runs, as one icon.
 *
 * Corner brackets rather than the words, because this is the control a video
 * player puts in the same place and nobody reads the label on that one either.
 * The words are still there for anyone who wants them — as the button's name,
 * which is what a screen reader says and what a hover shows.
 *
 * Next to `Edit document` because that is the button people are already
 * pointing at when they decide the column is too narrow for the table they are
 * looking at.
 */
function WidthToggle({
  isFullScreen,
  onToggle,
}: {
  isFullScreen: boolean;
  onToggle: () => void;
}): React.JSX.Element {
  const label = isFullScreen ? 'Safe mode' : 'Full screen';

  return (
    <Button aria-label={label} title={label} onClick={onToggle}>
      <ButtonIcon>{isFullScreen ? <SafeModeIcon /> : <FullScreenIcon />}</ButtonIcon>
    </Button>
  );
}

/**
 * Reads a markdown file in as a document of its own.
 *
 * A new document rather than the open one overwritten: a file somebody has on
 * disk is something they already own, and importing it over prose written here
 * would be the one action on this screen that destroys work.
 *
 * The input is the browser's, hidden behind a button that looks like the others
 * — a bare file field is the one control on a page that cannot be made to match
 * anything around it.
 */
function ImportButton({
  projectId,
  onOpen,
}: {
  projectId: string;
  onOpen: (docId: string) => void;
}): React.JSX.Element {
  const picker = useRef<HTMLInputElement>(null);
  const create = useCreateDesignDoc();

  const importFile = async (file: File): Promise<void> => {
    const body = await file.text();

    create.mutate(
      { projectId, title: titleFromMarkdown(file.name, body), body },
      {
        onSuccess: (result) => {
          // Opened as soon as it exists. A document that arrives without
          // opening is one the importer has to go and find in the row of tabs.
          if (result.id !== undefined) onOpen(result.id);
        },
      },
    );
  };

  return (
    <>
      <Button
        aria-label="Import"
        title="Import"
        onClick={() => {
          picker.current?.click();
        }}
      >
        <ButtonIcon>
          <ImportIcon />
        </ButtonIcon>
      </Button>

      <input
        ref={picker}
        type="file"
        className={styles.picker}
        accept=".md,.markdown,text/markdown"
        aria-label="Import a markdown file"
        onChange={(event) => {
          const [file] = event.target.files ?? [];

          // Cleared so picking the same file twice imports it twice: an input
          // fires no change for a value it is already holding.
          event.target.value = '';

          if (file !== undefined) void importFile(file);
        }}
      />
    </>
  );
}
