import { CARD_TYPES, type CardType } from '@lpm/shared';

/**
 * Every card on the board carries a type chip, and the chip colour is how the
 * board is read at a glance. The types themselves are shared vocabulary — this
 * file only says what colour each one is.
 */
export const cardTypes = CARD_TYPES;

export type { CardType };

export const colorByCardType: Readonly<Record<CardType, string>> = {
  art: '#eda363',
  task: '#63aeeb',
  bug: '#eb7d73',
  build: '#63eba3',
};

/**
 * Returns the chip colour for a card type.
 *
 * Prefer this over reading `colorByCardType` directly so the fallback for an
 * unrecognised type lives in exactly one place.
 */
export function getColorForCardType(cardType: CardType): string {
  return colorByCardType[cardType];
}
