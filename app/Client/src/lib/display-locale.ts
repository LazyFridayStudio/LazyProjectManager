/**
 * The locales every screen formats against.
 *
 * Fixed rather than taken from the browser, so two people looking at the same
 * project read the same string — a budget or a due date nobody can compare
 * across machines is worse than one written in an unfamiliar order.
 *
 * Dates use `en-AU`, which writes `18 Aug 2026` the way the design does. Money
 * uses `en-US`, because it is the one that names the currency in the symbol —
 * `A$640,000` against `US$640,000` — where `en-AU` renders AUD as a bare `$`
 * that a studio billing in two currencies could not tell apart.
 */
export const DATE_LOCALE = 'en-AU';
export const MONEY_LOCALE = 'en-US';
