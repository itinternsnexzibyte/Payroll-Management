import type { Dec } from '@nexzi/server-core';

/**
 * Registry of client-approved payroll formulas.
 *
 * Each FORMULA-basis salary component references one entry by `formulaRef`. Formulas must be
 * implemented one-to-one from the client's Excel workbook, each as a named function with unit
 * tests built from the client's completed sample months (see docs/payroll-business-rules.md).
 *
 * STATUS: EMPTY BY DESIGN. The client workbook has not been received, so no formula has been
 * implemented. A component that references an unregistered formula produces a blocking
 * FORMULA_NOT_CONFIGURED exception instead of an invented amount.
 */
export interface FormulaContext {
  year: number;
  month: number;
  daysInMonth: number;
  /** Employee-specific parameter value from the salary version (if any). */
  parameter: Dec | null;
  /** Amount of another component already calculated for this employee (throws if missing). */
  component(code: string): Dec;
  /** Numeric monthly input value (null when not entered). */
  input(key: string): Dec | null;
}

export interface FormulaDefinition {
  label: string;
  description: string;
  /** Excel cell/column reference this implements, for traceability. */
  workbookReference: string;
  /** Component codes this formula reads (used for dependency ordering). */
  dependsOn: string[];
  evaluate(ctx: FormulaContext): Dec;
}

export type FormulaRegistry = Record<string, FormulaDefinition>;

export const FORMULA_REGISTRY: FormulaRegistry = {
  // Example of how an approved formula is registered (DO NOT enable without client sign-off):
  // LOP_DEDUCTION: {
  //   label: 'Loss of pay deduction',
  //   description: 'As per workbook column X',
  //   workbookReference: 'Payroll.xlsx!Sheet1!X:X',
  //   dependsOn: ['BASIC'],
  //   evaluate: (ctx) => ...,
  // },
};
