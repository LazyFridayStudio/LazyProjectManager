import { useMemo, useState } from 'react';
import { countWords, type DesignDocView, type OpenDocument } from '@lpm/shared';

import { describeFailure } from '../../api/failure-messages.js';
import { joinClassNames } from '../../lib/join-class-names.js';
import { MarkdownToolbar } from '../markdown/index.js';
import { readOutline, renderMarkdown, useMarkdownCommands } from '../../logic/markdown/index.js';
import { LoadingProject } from '../shell/LoadingProject.js';
import { ProjectShell } from '../shell/ProjectShell.js';
import { DocumentHeader } from './DocumentHeader.js';
import { DocumentTabs } from './DocumentTabs.js';
import { useDesignDoc, useUpdateDesignDoc } from '../../logic/docs/use-design-doc.js';
import styles from './DesignDocScreen.module.css';

/**
 * A project's documents: a header, a row of tabs, and one document under them.
 *
 * Each is written top to bottom in one field, the way a document is written.
 * Its structure comes from the headings in the prose, which is where the
 * contents list beside it comes from too, so the two cannot fall out of step.
 *
 * It opens to be read. Most times a document is opened it is to find something
 * out, and a page that arrives as a text box is one people stop opening to
 * read — so `Edit document` is the only way into writing it.
 */
export function DesignDocScreen({ slug }: { slug: string }): React.JSX.Element {
  const [openId, setOpenId] = useState<string | undefined>(undefined);
  const doc = useDesignDoc(slug, openId);

  if (doc.isPending) {
    return <LoadingProject slug={slug} active="docs" />;
  }

  if (doc.isError) {
    return (
      <p className={styles.problem} role="alert">
        {describeFailure(doc.error)}
      </p>
    );
  }

  return <Documents view={doc.data} onOpen={setOpenId} />;
}

function Documents({
  view,
  onOpen,
}: {
  view: DesignDocView;
  onOpen: (docId: string) => void;
}): React.JSX.Element {
  /** The document as it is being typed, or null while it is being read. */
  const [draft, setDraft] = useState<string | null>(null);
  /**
   * How wide the document runs.
   *
   * The measure to begin with.
   *
   * It opened full width, on the reasoning that a design document is not prose
   * alone — the tables of frame budgets and the diagrams wider than a paragraph
   * are cut off by a measure set for paragraphs. The measure is set wider than
   * a paragraph now, which answers most of that, and the whole screen is one
   * press away for what it still does not fit.
   *
   * The other way round meant everybody got the wide layout so that some people
   * would not have to ask for it, which is a default set by the exception.
   *
   * The nav and the header stay either way. This is a document inside a
   * workspace rather than a document instead of one, and what changes is only
   * how wide the prose runs.
   */
  const [isFullScreen, setIsFullScreen] = useState(false);
  const save = useUpdateDesignDoc();
  const document = view.document;

  // Rendered once per change rather than per keystroke, and the outline comes
  // off the same pass so an anchor cannot point at nothing.
  const rendered = useMemo(
    () => readOutline(renderMarkdown(document?.body ?? '')),
    [document?.body],
  );

  /*
   * Saving lives here rather than beside the text box.
   *
   * `Save` stands where `Edit document` stood, which is what makes the two read
   * as one control that changed its mind — and the draft it writes is already
   * held at this level, so nothing has to be passed back up to reach it.
   */
  const saveDraft = (): void => {
    if (document === null || draft === null) return;

    save.mutate(
      { docId: document.id, body: draft },
      {
        onSuccess: () => {
          setDraft(null);
        },
      },
    );
  };

  return (
    <ProjectShell project={view.project} active="docs" outline={rendered.outline}>
      <div className={styles.screen}>
        <DocumentHeader
          view={view}
          document={document}
          wordCount={draft === null ? (document?.wordCount ?? 0) : countWords(draft)}
          isWriting={draft !== null}
          isSaving={save.isPending}
          isFullScreen={isFullScreen}
          onOpen={(docId) => {
            setDraft(null);
            onOpen(docId);
          }}
          onEdit={() => {
            setDraft(document?.body ?? '');
          }}
          onSave={saveDraft}
          onCancel={() => {
            setDraft(null);
          }}
          onToggleFullScreen={() => {
            setIsFullScreen(!isFullScreen);
          }}
        />

        <DocumentTabs
          projectId={view.project.id}
          documents={view.documents}
          openId={document?.id ?? null}
          canWrite={view.canWrite}
          isFullScreen={isFullScreen}
          onOpen={(docId) => {
            setDraft(null);
            onOpen(docId);
          }}
        />

        {/* The only part the measure applies to. The header and the tabs above
            it are furniture and stay where they are in both modes. */}
        <div
          className={joinClassNames(styles.column, isFullScreen && styles.columnFull)}
          data-full-screen={isFullScreen}
        >
          {document === null ? (
            <p className={styles.empty}>
              No documents yet. A studio keeps several — a game design, an art direction, an audio
              bible — so this starts empty rather than with one nobody named.
            </p>
          ) : (
            <OneDocument
              document={document}
              html={rendered.html}
              draft={draft}
              onDraft={setDraft}
            />
          )}
        </div>
      </div>
    </ProjectShell>
  );
}

function OneDocument({
  document,
  html,
  draft,
  onDraft,
}: {
  document: OpenDocument;
  html: string;
  draft: string | null;
  onDraft: (body: string) => void;
}): React.JSX.Element {
  return draft === null ? (
    <Reading body={document.body} html={html} />
  ) : (
    <Writing draft={draft} onChange={onDraft} />
  );
}

function Reading({ body, html }: { body: string; html: string }): React.JSX.Element {
  if (body.trim() === '') {
    return (
      <p className={styles.empty}>
        Nothing written here yet. Write it top to bottom — the headings you use become the contents
        list beside it.
      </p>
    );
  }

  return (
    <article
      className={styles.document}
      // Sanitised in `renderMarkdown`, and given its anchors by `readOutline`
      // on the same pass.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/**
 * The document, being written.
 *
 * One text box for the whole thing. The toolbar above it is the same one a card
 * description uses, so the shortcuts somebody already knows work here too. What
 * to do when the writing is finished is in the header, where the button that
 * started it was.
 */
function Writing({
  draft,
  onChange,
}: {
  draft: string;
  onChange: (body: string) => void;
}): React.JSX.Element {
  const commands = useMarkdownCommands(draft, onChange);

  return (
    <>
      <div className={styles.actions}>
        <MarkdownToolbar onCommand={commands.run} active={commands.active} />
        <span className={styles.hint}>
          # Title, ## Heading and ### Heading become the contents list
        </span>
      </div>

      <textarea
        ref={commands.box}
        className={styles.bodyBox}
        value={draft}
        aria-label="Document body"
        onChange={(event) => {
          onChange(event.target.value);
        }}
        onKeyDown={commands.onKeyDown}
        onSelect={commands.onSelect}
      />
    </>
  );
}
