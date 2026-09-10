const MAXIMUM_INITIALS = 2;

/**
 * Shown when a display name contains no letters at all — an emoji-only name, or
 * punctuation. The column is NOT NULL and a blank avatar reads as a rendering
 * bug, so there is always something to draw.
 */
const FALLBACK_INITIALS = '?';

/**
 * Derives the initials shown on card avatars across the board.
 *
 * Two letters, because the avatar is a 22px square on a card chip and three
 * letters stop being legible at that size. Names that are one word fall back to
 * their first two letters rather than a single lonely capital.
 */
export function deriveInitials(displayName: string): string {
  // Split on whitespace only. A hyphenated surname is one name: "Ana
  // Ruiz-Mendez" is AR, not AM.
  const words = displayName
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0);

  if (words.length === 0) {
    return FALLBACK_INITIALS;
  }

  if (words.length === 1) {
    return takeLeadingLetters(words[0] ?? '', MAXIMUM_INITIALS) || FALLBACK_INITIALS;
  }

  const firstWord = words[0] ?? '';
  const lastWord = words[words.length - 1] ?? '';

  return takeLeadingLetters(firstWord, 1) + takeLeadingLetters(lastWord, 1) || FALLBACK_INITIALS;
}

/**
 * Takes leading letters, skipping anything that is not one.
 *
 * Studio display names carry punctuation and emoji often enough that slicing
 * blindly would produce initials like "(J" or a broken surrogate pair.
 */
function takeLeadingLetters(word: string, count: number): string {
  const letters = Array.from(word).filter((character) => /\p{L}/u.test(character));
  return letters.slice(0, count).join('').toUpperCase();
}
