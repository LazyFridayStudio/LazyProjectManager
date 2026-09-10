import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type Modifier,
} from '@dnd-kit/core';
import {
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  isImageMime,
  notAnImageMessage,
  IMAGE_FILE_ACCEPT,
  type AssetReference,
} from '@lpm/shared';
import { useEffect, useRef, useState } from 'react';

import { describeFailure } from '../../api/failure-messages.js';
import {
  inDroppedOrder,
  isDroppedOrder,
  keepWithin,
  resolveDrop,
} from '../../logic/dragging/index.js';
import { AssetPicture } from './AssetPicture.js';
import { Button, ButtonIcon, PlusIcon, TrashIcon, useDisplay } from '../ui/index.js';
import { joinClassNames } from '../../lib/join-class-names.js';
import {
  useAddAssetReferences,
  useMoveAssetReference,
  usePromoteAssetReference,
  useRemoveAssetReference,
} from '../../logic/assets/use-assets.js';
import { useFileDrop } from '../../logic/assets/use-file-drop.js';
import styles from './AssetReferenceSheet.module.css';

export interface AssetReferenceSheetProps {
  readonly assetId: string;
  readonly projectSlug: string;
  readonly references: readonly AssetReference[];
  readonly canWrite: boolean;
}

/**
 * Every picture of an asset: one large, the rest as a strip under it.
 *
 * An asset is not a thing with a portrait. It accumulates a silhouette, colour
 * keys, a material study, a scale reference and a render, and the point of
 * opening one is usually to look at those together — which is why replacing a
 * single image was the wrong control to give anybody.
 *
 * Pressing a thumbnail shows it large and writes nothing. Looking at a picture
 * is not a change to the asset, and a panel where browsing the sheet quietly
 * reorders it is one people learn to stop touching. Dragging one is the change,
 * and it takes the deliberate movement a drag already requires.
 */
export function AssetReferenceSheet({
  assetId,
  projectSlug,
  references,
  canWrite,
}: AssetReferenceSheetProps): React.JSX.Element {
  const [shownId, setShownId] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const display = useDisplay();
  const add = useAddAssetReferences(projectSlug, assetId);

  /**
   * Pictures only.
   *
   * `accept` on the input is a hint the file dialog honours and a drag ignores,
   * so somebody dragging a folder of a finished pass gets the renders here and
   * is told what was left behind — rather than the whole drop being refused, or
   * a `.blend` becoming the asset's thumbnail.
   */
  const upload = (files: readonly File[] | FileList | null): void => {
    const chosen = Array.from(files ?? []);
    const pictures = chosen.filter((file) => isImageMime(file.type));
    const skipped = chosen.filter((file) => !isImageMime(file.type));

    // One message naming all of them, rather than one message each: a drop is
    // one thing somebody did.
    if (skipped.length > 0) {
      display.showError(notAnImageMessage(skipped.map((file) => file.name).join(', ')));
    }

    if (pictures.length > 0) {
      add.mutate(pictures, {});
    }
  };

  // Dropping onto the sheet is the fastest way to fill it: nothing about a
  // rectangle announces that it takes files, but everybody tries it anyway.
  const drop = useFileDrop(canWrite, upload);

  // Read inside a document listener that outlives the render it was made in.
  const latest = useRef(upload);

  latest.current = upload;

  /**
   * A screenshot, straight onto the sheet.
   *
   * Half of what ends up on a reference sheet was never a file: it is a crop of
   * a photograph, a frame of a video, or something somebody just cut out of
   * another program. Saving that to disk to pick it back up is a step that only
   * exists because the software asked for it.
   *
   * Listened for on the document rather than on the sheet, because a paste goes
   * to whatever has focus — and somebody who has just opened an asset and hit
   * Ctrl+V has focus on the panel, or on nothing. A handler on the rectangle
   * would only work for people who thought to click it first, which is nobody.
   *
   * Files only. Pasting words into the description carries no files, so the
   * fields inside the panel keep working exactly as they did.
   */
  useEffect(() => {
    if (!canWrite) return undefined;

    const onPaste = (event: globalThis.ClipboardEvent): void => {
      const pasted = Array.from(event.clipboardData?.files ?? []);

      if (pasted.length === 0) return;

      event.preventDefault();
      latest.current(pasted);
    };

    document.addEventListener('paste', onPaste);

    return () => {
      document.removeEventListener('paste', onPaste);
    };
  }, [canWrite]);

  // The one being looked at, or the first — which is also what a tile shows. A
  // reference that has just been removed falls back the same way, rather than
  // leaving the large frame pointed at nothing.
  const shown = references.find((reference) => reference.id === shownId) ?? references[0];

  // Somebody who just uploaded four images wants to see them, and the sheet has
  // grown by the time this runs.
  const lastAdded = add.data?.at(-1);

  useEffect(() => {
    if (lastAdded !== undefined) {
      setShownId(null);
    }
  }, [lastAdded]);

  return (
    <div
      className={joinClassNames(styles.sheet, drop.isOver && styles.sheetOver)}
      {...drop.dropProps}
    >
      <Frame shown={shown} />

      {references.length > 0 && (
        <Strip
          assetId={assetId}
          projectSlug={projectSlug}
          references={references}
          shownId={shown?.id}
          canWrite={canWrite}
          onShow={setShownId}
        />
      )}

      {canWrite && (
        <Actions
          assetId={assetId}
          projectSlug={projectSlug}
          shown={shown}
          isUploading={add.isPending}
          onUpload={() => {
            picker.current?.click();
          }}
        />
      )}

      <input
        ref={picker}
        type="file"
        multiple
        accept={IMAGE_FILE_ACCEPT}
        className={styles.hiddenPicker}
        aria-label="Reference images"
        onChange={(event) => {
          upload(event.target.files);

          // Cleared so choosing the same file twice in a row still fires.
          event.target.value = '';
        }}
      />
    </div>
  );
}

/** The picture being looked at. */
function Frame({ shown }: { shown: AssetReference | undefined }): React.JSX.Element {
  return (
    <div className={styles.frame}>
      {shown === undefined ? (
        <span className={styles.frameEmpty}>no reference images yet</span>
      ) : (
        <AssetPicture
          url={shown.url}
          alt={shown.filename}
          fallback={shown.filename}
          imageClassName={styles.frameImage}
          fallbackClassName={styles.frameEmpty}
        />
      )}
    </div>
  );
}

interface StripProps {
  readonly assetId: string;
  readonly projectSlug: string;
  readonly references: readonly AssetReference[];
  readonly shownId: string | undefined;
  readonly canWrite: boolean;
  readonly onShow: (referenceId: string) => void;
}

/**
 * The rest of the sheet, in the order somebody put them in — and can change.
 *
 * Dragging is how the order is set, because the order is a picture of itself:
 * a list of "move up" buttons makes somebody rehearse in their head what the
 * strip will look like afterwards.
 */
function Strip({
  assetId,
  projectSlug,
  references,
  shownId,
  canWrite,
  onShow,
}: StripProps): React.JSX.Element {
  const move = useMoveAssetReference(projectSlug, assetId);
  const display = useDisplay();

  /**
   * Where the pictures went, before the server has been asked.
   *
   * A drag is a promise about where the thing will be, and the round trip that
   * confirms it takes long enough to see. Without this the strip springs back to
   * the old order the moment the pointer is released and jumps forward again
   * when the answer lands — which reads as the move having failed and then
   * happened, or as nothing having moved at all.
   *
   * Dropped as soon as the server's own order says the same thing, so the server
   * stays the authority and two people reordering at once still converge.
   */
  const [placed, setPlaced] = useState<readonly string[] | null>(null);
  const strip = useRef<HTMLUListElement>(null);

  const shown = placed === null ? references : inDroppedOrder(references, placed);

  if (placed !== null && isDroppedOrder(references, placed)) {
    setPlaced(null);
  }

  // The same sensors the board uses. A pointer has to travel a few pixels before
  // a drag begins, which is what lets a click through to open the picture.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = (event: DragEndEvent): void => {
    const { active, over } = event;

    if (over === null) return;

    const drop = resolveDrop(shown, String(active.id), String(over.id));

    if (drop === null) return;

    setPlaced(drop.order);

    move.mutate(
      {
        referenceId: drop.movedId,
        beforeReferenceId: drop.beforeId,
        afterReferenceId: drop.afterId,
      },
      {
        onError: (error) => {
          // Back to whatever the server last said, which is still the truth.
          setPlaced(null);
          display.showError(describeFailure(error));
        },
      },
    );
  };

  /**
   * Keeps the picture inside the strip while it is being carried.
   *
   * Below the strip is the button row, which is not somewhere a picture can be
   * dropped — and a transform reaching down there extends the scrollable
   * overflow of the panel around it, which is the other half of what let a drag
   * scroll the page away underneath itself.
   */
  const withinTheStrip: Modifier = ({ transform, draggingNodeRect }) => {
    const bounds = strip.current?.getBoundingClientRect();

    if (draggingNodeRect === null || bounds === undefined) return transform;

    return { ...transform, ...keepWithin(draggingNodeRect, bounds, transform) };
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[withinTheStrip]}
      /*
       * No auto-scroll. The strip is small and wholly on screen whenever it is
       * being dragged in, so there is nothing to scroll towards — and the panel
       * it sits in does scroll, which turned a drag towards the bottom edge into
       * a loop: the transform extended the scrollable area, auto-scroll chased
       * it, and the extra room let the transform reach further still.
       */
      autoScroll={false}
      onDragEnd={onDragEnd}
    >
      {/* Rect rather than a list strategy: the strip wraps onto as many rows
          as it needs, and a strategy that assumes one row works out the wrong
          offsets for everything below the first — which is what made a picture
          coming up from the bottom row resize and jump rather than travel. */}
      <SortableContext
        items={shown.map((reference) => reference.id)}
        strategy={rectSortingStrategy}
      >
        {/* `display: grid` takes the list role off a `ul` in Chromium, and the
            tiles stop being list items with it. Said explicitly so the strip
            is still announced as a list of pictures. */}
        <ul className={styles.thumbnails} role="list" ref={strip}>
          {shown.map((reference, index) => (
            <Thumbnail
              key={reference.id}
              assetId={assetId}
              projectSlug={projectSlug}
              reference={reference}
              isFirst={index === 0}
              isShown={reference.id === shownId}
              canWrite={canWrite}
              onShow={onShow}
            />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

interface ThumbnailProps {
  readonly assetId: string;
  readonly projectSlug: string;
  readonly reference: AssetReference;
  readonly isFirst: boolean;
  readonly isShown: boolean;
  readonly canWrite: boolean;
  readonly onShow: (referenceId: string) => void;
}

/**
 * One picture in the strip.
 *
 * The whole tile opens it and the whole tile drags it, as a card on the board
 * does. The one extra control is in the corner: on the first picture it says
 * what that picture is, and on the others it offers to make them it.
 */
function Thumbnail({
  assetId,
  projectSlug,
  reference,
  isFirst,
  isShown,
  canWrite,
  onShow,
}: ThumbnailProps): React.JSX.Element {
  const sortable = useSortable({ id: reference.id, disabled: !canWrite });
  const promote = usePromoteAssetReference(projectSlug, assetId);

  return (
    <li
      ref={sortable.setNodeRef}
      className={styles.thumbnailHolder}
      data-dragging={sortable.isDragging}
      style={{
        transform: CSS.Transform.toString(sortable.transform),
        transition: sortable.transition,
      }}
    >
      <button
        type="button"
        className={joinClassNames(styles.thumbnail, isShown && styles.thumbnailShown)}
        // `aria-current` rather than `aria-pressed`: this says which picture is
        // in the frame, and dnd-kit owns `aria-pressed` for the drag itself.
        aria-current={isShown}
        onClick={() => {
          onShow(reference.id);
        }}
        {...sortable.attributes}
        {...sortable.listeners}
      >
        <AssetPicture
          url={reference.url}
          alt={reference.filename}
          fallback={reference.filename}
          imageClassName={styles.thumbnailImage}
          fallbackClassName={styles.thumbnailName}
        />
      </button>

      {/* The first one is what the library tile draws, so which one it is has to
          be visible from here — the tile is not on screen. */}
      {isFirst && <span className={styles.firstMark}>thumbnail</span>}

      {/* On the others it is an offer rather than a label, and it stays out of
          the way until somebody is looking at that picture. */}
      {!isFirst && canWrite && (
        <button
          type="button"
          className={styles.makeThumbnail}
          disabled={promote.isPending}
          onClick={() => {
            promote.mutate({ referenceId: reference.id }, {});
          }}
        >
          make thumbnail
        </button>
      )}
    </li>
  );
}

interface ActionsProps {
  readonly assetId: string;
  readonly projectSlug: string;
  readonly shown: AssetReference | undefined;
  readonly isUploading: boolean;
  readonly onUpload: () => void;
}

/**
 * What can be done to the sheet as a whole.
 *
 * Promoting a picture used to be here and is now in the corner of the picture
 * it is about, where it says which one it would affect without anybody having
 * to work out that it means the one currently shown.
 */
function Actions({
  assetId,
  projectSlug,
  shown,
  isUploading,
  onUpload,
}: ActionsProps): React.JSX.Element {
  const display = useDisplay();
  const remove = useRemoveAssetReference(projectSlug, assetId);

  return (
    <div className={styles.actions}>
      {shown !== undefined && (
        <Button
          tone="stop"
          aria-label="Remove"
          title="Remove"
          busy={remove.isPending}
          onClick={() => {
            void (async () => {
              const said = await display.askToConfirm({
                question: `Remove ${shown.filename}?`,
                consequence: 'The picture is thrown away. It is not kept anywhere else.',
                confirmLabel: 'Remove',
              });

              if (!said) return;

              remove.mutate({ referenceId: shown.id }, {});
            })();
          }}
        >
          <ButtonIcon>
            <TrashIcon size={14} />
          </ButtonIcon>
        </Button>
      )}

      <Button tone="go" aria-label="Upload" title="Upload" busy={isUploading} onClick={onUpload}>
        <ButtonIcon>
          <PlusIcon size={14} />
        </ButtonIcon>
      </Button>
    </div>
  );
}
