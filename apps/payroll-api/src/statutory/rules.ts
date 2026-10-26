import { z } from 'zod';
import { Dec, dec } from '@nexzi/server-core';
import type { FormulaContext, FormulaRegistry } from '../payroll/formulas';

/**
 * Statutory payroll — PF, ESI and TDS.
 *
 * NO STATUTORY RATE IS BUILT IN. Rates, wage ceilings, eligibility limits and tax slabs change by
 * notification and differ by establishment, so every figure is entered by the payroll team in
 * Statutory settings from the current EPFO / ESIC / Income-tax rules, together with who confirmed
 * them. Until a section is switched on and complete, a component that uses it raises a blocking
 * exception instead of producing an amount.
 *
 * The calculations are deliberately simple and documented in docs/statutory-bank-attendance.md:
 *  - PF  (employee): rate × PF wages, where PF wages = Σ chosen components, optionally capped at the ceiling.
 *  - ESI (employee): rate × ESI wages, only when ESI wages ≤ the eligibility limit (else 0).
 *  - TDS: (Σ chosen monthly earnings × 12 − standard deduction) taxed by the slabs, zero up to the
 *         rebate limit, plus cess, divided by 12. A monthly override input, when entered, wins
 *         (use it for declarations, previous employment, arrears or anything this projection omits).
 *  - Wage band (when on): employees whose gross (ESI wages) is at or below the threshold pay ESI
 *         and no PF; above the threshold they pay PF and no ESI. The threshold then replaces the
 *         ESI eligibility limit.
 * Employer PF / ESI contributions are not deductions from pay; they are recorded on the line for
 * the statutory report.
 */

const pct = z.number().min(0).max(100).nullable();
const amount = z.number().min(0).max(1_000_000_000).nullable();
const codes = z.array(z.string().min(1).max(40)).max(50);

export const statutorySchema = z.object({
  /** Who confirmed the figures below, when, and against which notification/circular. */
  confirmedBy: z.string().max(120).nullable(),
  confirmedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  reference: z.string().max(500).nullable(),
  pf: z.object({
    enabled: z.boolean(),
    employeeRatePercent: pct,
    employerRatePercent: pct,
    wageComponents: codes,
    wageCeiling: amount,
    capAtCeiling: z.boolean(),
  }),
  esi: z.object({
    enabled: z.boolean(),
    employeeRatePercent: pct,
    employerRatePercent: pct,
    wageComponents: codes,
    eligibilityLimit: amount,
  }),
  /**
   * ESI at or below the threshold, PF above it (gross measured on the ESI wage components).
   * Settings saved before the band existed keep their behaviour: a missing band is off.
   */
  wageBand: z.object({ enabled: z.boolean(), threshold: amount }).default({ enabled: false, threshold: 20000 }),
  tds: z.object({
    enabled: z.boolean(),
    taxableComponents: codes,
    standardDeduction: amount,
    /** Progressive slabs in ascending order; the last slab has upTo = null (no upper limit). */
    slabs: z.array(z.object({ upTo: amount, ratePercent: z.number().min(0).max(100) })).max(20),
    rebateLimit: amount,
    cessPercent: pct,
    overrideInputKey: z.string().max(40).nullable(),
  }),
});
export type StatutorySettings = z.infer<typeof statutorySchema>;

export const DEFAULT_STATUTORY: StatutorySettings = {
  confirmedBy: null,
  confirmedOn: null,
  reference: null,
  pf: { enabled: false, employeeRatePercent: null, employerRatePercent: null, wageComponents: [], wageCeiling: null, capAtCeiling: true },
  esi: { enabled: false, employeeRatePercent: null, employerRatePercent: null, wageComponents: [], eligibilityLimit: null },
  wageBand: { enabled: true, threshold: 20000 },
  tds: { enabled: false, taxableComponents: [], standardDeduction: null, slabs: [], rebateLimit: null, cessPercent: null, overrideInputKey: null },
};

export const STATUTORY_REFS = { PF: 'STATUTORY_PF', ESI: 'STATUTORY_ESI', TDS: 'STATUTORY_TDS' } as const;
export type StatutoryKind = keyof typeof STATUTORY_REFS;

/** Problems that stop a section from being switched on. Empty = complete. */
export function statutoryProblems(s: StatutorySettings): Record<StatutoryKind, string[]> {
  const out: Record<StatutoryKind, string[]> = { PF: [], ESI: [], TDS: [] };
  for (const k of ['PF', 'ESI', 'TDS'] as const) {
    const on = k === 'PF' ? s.pf.enabled : k === 'ESI' ? s.esi.enabled : s.tds.enabled;
    if (on && (!s.confirmedBy || !s.confirmedOn)) out[k].push('Record who confirmed the statutory figures and when.');
  }
  if (s.pf.enabled) {
    if (s.pf.employeeRatePercent === null) out.PF.push('Employee PF rate is required.');
    if (s.pf.employerRatePercent === null) out.PF.push('Employer PF rate is required.');
    if (!s.pf.wageComponents.length) out.PF.push('Choose the components that make up PF wages.');
    if (s.pf.capAtCeiling && s.pf.wageCeiling === null) out.PF.push('Enter the PF wage ceiling, or turn off capping.');
  }
  if (s.esi.enabled) {
    if (s.esi.employeeRatePercent === null) out.ESI.push('Employee ESI rate is required.');
    if (s.esi.employerRatePercent === null) out.ESI.push('Employer ESI rate is required.');
    if (!s.esi.wageComponents.length) out.ESI.push('Choose the components that make up ESI wages.');
    if (s.esi.eligibilityLimit === null && !s.wageBand.enabled) out.ESI.push('Enter the ESI wage eligibility limit.');
  }
  if (s.wageBand.enabled && (s.pf.enabled || s.esi.enabled)) {
    const k = s.esi.enabled ? 'ESI' : 'PF';
    if (s.wageBand.threshold === null) out[k].push('Enter the PF / ESI wage band threshold.');
    if (!s.esi.wageComponents.length && !out.ESI.length) out[k].push('Choose the ESI wage components: the wage band measures gross on them.');
  }
  if (s.tds.enabled) {
    if (!s.tds.taxableComponents.length) out.TDS.push('Choose the taxable earning components.');
    if (!s.tds.slabs.length) out.TDS.push('Enter the income-tax slabs.');
    else {
      const last = s.tds.slabs[s.tds.slabs.length - 1];
      if (last.upTo !== null) out.TDS.push('The last tax slab must have no upper limit.');
      for (let i = 0; i < s.tds.slabs.length - 1; i++) {
        const a = s.tds.slabs[i].upTo;
        const b = s.tds.slabs[i + 1].upTo;
        if (a === null) out.TDS.push('Only the last tax slab may have no upper limit.');
        else if (b !== null && b <= a) out.TDS.push('Tax slab limits must increase.');
      }
    }
  }
  return out;
}

const sumOf = (ctx: FormulaContext, list: string[]) => list.reduce((acc, c) => acc.add(ctx.componentOrNull(c) ?? new Dec(0)), new Dec(0));
const pctOf = (base: Dec, rate: number) => base.mul(dec(String(rate))).div(100);

/** true = ESI side of the wage band (gross at or below the threshold); null = band switched off. */
function inEsiBand(ctx: FormulaContext, s: StatutorySettings): { esi: boolean; gross: Dec } | null {
  if (!s.wageBand.enabled || s.wageBand.threshold === null) return null;
  const gross = sumOf(ctx, s.esi.wageComponents);
  return { esi: gross.lte(dec(String(s.wageBand.threshold))), gross };
}

/** Annual tax on taxable income by progressive slabs, rebate and cess. Exported for tests. */
export function annualTax(taxable: Dec, t: StatutorySettings['tds']): Dec {
  if (taxable.lte(0)) return new Dec(0);
  if (t.rebateLimit !== null && taxable.lte(dec(String(t.rebateLimit)))) return new Dec(0);
  let tax = new Dec(0);
  let lower = new Dec(0);
  for (const s of t.slabs) {
    const upper = s.upTo === null ? taxable : Dec.min(taxable, dec(String(s.upTo)));
    if (upper.gt(lower)) tax = tax.add(pctOf(upper.sub(lower), s.ratePercent));
    if (s.upTo === null || taxable.lte(dec(String(s.upTo)))) break;
    lower = dec(String(s.upTo));
  }
  return tax.add(pctOf(tax, t.cessPercent ?? 0));
}

/** Builds the PF / ESI / TDS formulas from the confirmed settings for the calculation engine. */
export function buildStatutoryFormulas(s: StatutorySettings): FormulaRegistry {
  const problems = statutoryProblems(s);
  const guard = (k: StatutoryKind, enabled: boolean) => {
    if (!enabled) throw new Error(`statutory ${k} is switched off in Statutory settings`);
    if (problems[k].length) throw new Error(`statutory ${k} settings are incomplete — ${problems[k][0]}`);
  };
  const source = `Statutory settings${s.confirmedBy ? `, confirmed by ${s.confirmedBy} on ${s.confirmedOn}` : ' (not confirmed)'}`;
  return {
    [STATUTORY_REFS.PF]: {
      label: 'Provident Fund — employee contribution',
      description: 'Employee rate × PF wages (capped at the ceiling when set)',
      workbookReference: source,
      dependsOn: [...new Set([...s.pf.wageComponents, ...(s.wageBand.enabled ? s.esi.wageComponents : [])])],
      appliesToAll: s.pf.enabled,
      fingerprint: JSON.stringify(['PF', s.pf, s.wageBand, s.wageBand.enabled ? s.esi.wageComponents : null, s.confirmedBy, s.confirmedOn]),
      evaluate: (ctx) => {
        guard('PF', s.pf.enabled);
        const band = inEsiBand(ctx, s);
        if (band?.esi) {
          ctx.note('wageBand', `gross ${band.gross.toFixed(2)} <= ${s.wageBand.threshold}: ESI applies instead of PF`);
          ctx.note('pfWages', '0.00');
          ctx.note('employerContribution', '0.00');
          return new Dec(0);
        }
        if (band) ctx.note('wageBand', `gross ${band.gross.toFixed(2)} > ${s.wageBand.threshold}: PF applies`);
        const wages = sumOf(ctx, s.pf.wageComponents);
        const base = s.pf.capAtCeiling && s.pf.wageCeiling !== null ? Dec.min(wages, dec(String(s.pf.wageCeiling))) : wages;
        ctx.note('pfWages', base.toFixed(2));
        ctx.note('employerContribution', pctOf(base, s.pf.employerRatePercent!).toFixed(2));
        return pctOf(base, s.pf.employeeRatePercent!);
      },
    },
    [STATUTORY_REFS.ESI]: {
      label: 'ESI — employee contribution',
      description: 'Employee rate × ESI wages when wages are within the eligibility limit',
      workbookReference: source,
      dependsOn: s.esi.wageComponents,
      appliesToAll: s.esi.enabled,
      fingerprint: JSON.stringify(['ESI', s.esi, s.wageBand, s.confirmedBy, s.confirmedOn]),
      evaluate: (ctx) => {
        guard('ESI', s.esi.enabled);
        const wages = sumOf(ctx, s.esi.wageComponents);
        const band = inEsiBand(ctx, s);
        const covered = band ? band.esi : wages.lte(dec(String(s.esi.eligibilityLimit)));
        if (band) ctx.note('wageBand', band.esi ? `gross ${wages.toFixed(2)} <= ${s.wageBand.threshold}: ESI applies` : `gross ${wages.toFixed(2)} > ${s.wageBand.threshold}: PF applies instead of ESI`);
        ctx.note('esiWages', wages.toFixed(2));
        ctx.note('esiCovered', covered ? 'yes' : 'no');
        ctx.note('employerContribution', covered ? pctOf(wages, s.esi.employerRatePercent!).toFixed(2) : '0.00');
        return covered ? pctOf(wages, s.esi.employeeRatePercent!) : new Dec(0);
      },
    },
    [STATUTORY_REFS.TDS]: {
      label: 'TDS — income tax deducted at source',
      description: 'Annual projection taxed by the slabs ÷ 12, or the monthly override input when entered',
      workbookReference: source,
      dependsOn: s.tds.taxableComponents,
      appliesToAll: s.tds.enabled,
      fingerprint: JSON.stringify(['TDS', s.tds, s.confirmedBy, s.confirmedOn]),
      evaluate: (ctx) => {
        guard('TDS', s.tds.enabled);
        const override = s.tds.overrideInputKey ? ctx.input(s.tds.overrideInputKey) : null;
        if (override !== null) {
          ctx.note('method', 'override input');
          return override;
        }
        const monthly = sumOf(ctx, s.tds.taxableComponents);
        const annualIncome = monthly.mul(12).sub(dec(String(s.tds.standardDeduction ?? 0)));
        const taxable = annualIncome.isNegative() ? new Dec(0) : annualIncome;
        const tax = annualTax(taxable, s.tds);
        ctx.note('method', 'annual projection');
        ctx.note('projectedTaxableIncome', taxable.toFixed(2));
        ctx.note('projectedAnnualTax', tax.toFixed(2));
        return tax.div(12);
      },
    },
  };
}
