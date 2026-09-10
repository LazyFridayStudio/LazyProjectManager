import { Button } from '../ui/index.js';

/**
 * The one control that opens and closes the filter panel.
 *
 * It says what pressing it will do, not what the panel is: `Filters` while the
 * panel is shut and `Close` while it is open. A button whose word never changed
 * would be a button you press twice to find out what it does.
 *
 * How many things are chosen rides along, because the panel can be shut over a
 * board that is still narrowed — and a board quietly hiding half its cards with
 * nothing on screen to say so is the thing this has to prevent.
 */
export function FiltersButton({
  isOpen,
  chosen,
  onToggle,
}: {
  readonly isOpen: boolean;
  readonly chosen: number;
  readonly onToggle: () => void;
}): React.JSX.Element {
  return (
    <Button aria-expanded={isOpen} onClick={onToggle}>
      {isOpen ? 'Close' : 'Filters'}
      {chosen > 0 && ` (${String(chosen)})`}
    </Button>
  );
}
