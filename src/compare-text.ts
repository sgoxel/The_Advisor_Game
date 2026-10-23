/**
 * Locale-independent string order (UTF-16 code units). World generation must never use
 * localeCompare: its order depends on the browser's ICU build and the user's locale, which
 * would let the same SEED produce a different world on a different machine.
 */
export const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
