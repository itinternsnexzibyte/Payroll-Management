import Decimal from 'decimal.js';

/** Isolated Decimal constructor with high precision so intermediate results never lose digits. */
export const Dec = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export type Dec = Decimal;

export type RoundingMode = 'HALF_UP' | 'HALF_EVEN' | 'UP' | 'DOWN' | 'CEIL' | 'FLOOR';

const MODES: Record<RoundingMode, Decimal.Rounding> = {
  HALF_UP: Decimal.ROUND_HALF_UP,
  HALF_EVEN: Decimal.ROUND_HALF_EVEN,
  UP: Decimal.ROUND_UP,
  DOWN: Decimal.ROUND_DOWN,
  CEIL: Decimal.ROUND_CEIL,
  FLOOR: Decimal.ROUND_FLOOR,
};

export function dec(value: Decimal.Value | { toString(): string } | null | undefined): Decimal {
  if (value === null || value === undefined || value === '') return new Dec(0);
  return new Dec(typeof value === 'object' && !(value instanceof Decimal) ? value.toString() : (value as Decimal.Value));
}

export function roundTo(value: Decimal, scale: number, mode: RoundingMode): Decimal {
  return value.toDecimalPlaces(scale, MODES[mode]);
}

/** Fixed-scale string representation suitable for DECIMAL columns and JSON responses. */
export function money(value: Decimal, scale = 2): string {
  return value.toFixed(scale);
}

/** Strict decimal string validator for API input (no exponent, no floats from JS numbers). */
export const DECIMAL_RE = /^-?\d{1,13}(\.\d{1,6})?$/;
