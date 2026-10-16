/**
 * Explainable payroll anomaly rules (change request A).
 *
 * Transparent, configurable checks that compare a payroll run with the employee's earlier
 * finalised months. Every alert carries a plain-language reason and the numbers behind it. The
 * rules never change payroll results; they only point a reviewer at something worth a second look.
 * Thresholds are business settings (Payroll settings → Anomaly alerts), not calculation rules.
 */
import { createHash } from 'node:crypto';
import { dec, formatIndianAmount, money, type Dec } from '@nexzi/server-core';

export interface AnomalyRuleSettings {
  enabled: boolean;
  /** Net pay change vs the last finalised month that raises an alert (percent). */
  netChangePercent: number;
  /** Change of a fixed / percentage / formula component vs the last finalised month (percent). */
  componentChangePercent: number;
  /** Ignore differences smaller than this amount (avoids noise from rounding and small items). */
  minAbsoluteChange: number;
  /** How many earlier finalised months to use as history for monthly-entered amounts. */
  historyMonths: number;
  /** Minimum months of history before the outlier rule applies. */
  minHistoryMonths: number;
  /** A monthly-entered amount above (largest earlier value × this) is an outlier. */
  outlierMultiplier: number;
}

export const DEFAULT_ANOMALY_RULES: AnomalyRuleSettings = {
  enabled: true,
  netChangePercent: 20,
  componentChangePercent: 25,
  minAbsoluteChange: 100,
  historyMonths: 6,
  minHistoryMonths: 3,
  outlierMultiplier: 2,
};

export type AnomalySeverity = 'LOW' | 'MEDIUM' | 'HIGH';

export type AnomalyRule =
  | 'NET_CHANGE'
  | 'COMPONENT_CHANGE'
  | 'COMPONENT_NEW'
  | 'COMPONENT_REMOVED'
  | 'ADJUSTMENT_OUTLIER'
  | 'ADJUSTMENT_FIRST_TIME'
  | 'REPEATED_ADJUSTMENT'
  | 'DUPLICATE_EMPLOYEE';

export const RULE_LABELS: Record<AnomalyRule, string> = {
  NET_CHANGE: 'Net pay changed sharply',
  COMPONENT_CHANGE: 'Salary component changed',
  COMPONENT_NEW: 'New salary component',
  COMPONENT_REMOVED: 'Salary component missing',
  ADJUSTMENT_OUTLIER: 'Unusual monthly amount',
  ADJUSTMENT_FIRST_TIME: 'First monthly amount in a while',
  REPEATED_ADJUSTMENT: 'Same monthly amount as last month',
  DUPLICATE_EMPLOYEE: 'Possible duplicate employee',
};

export interface LineSnapshot {
  code: string;
  name: string;
  type: 'EARNING' | 'DEDUCTION';
  basis: 'FIXED' | 'PERCENTAGE' | 'INPUT' | 'FORMULA';
  amount: string;
}

export interface EmployeeResult {
  employeeId: string;
  code: string;
  name: string;
  salaryVersionId: string | null;
  salaryVersionNo?: number | null;
  salaryEffectiveFrom?: string | null;
  net: string | null;
  lines: LineSnapshot[];
}

export interface PeriodResult {
  period: string;
  employees: Map<string, EmployeeResult>;
}

export interface Detection {
  rule: AnomalyRule;
  severity: AnomalySeverity;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  componentCode: string | null;
  message: string;
  details: Record<string, unknown>;
  fingerprint: string;
  signature: string;
}

const fmt = (d: Dec) => formatIndianAmount(money(d, 2));
const pct = (d: Dec) => `${d.isNegative() ? '' : '+'}${d.toFixed(1)}%`;
const lower = (s: AnomalySeverity): AnomalySeverity => (s === 'HIGH' ? 'MEDIUM' : 'LOW');

function make(rule: AnomalyRule, severity: AnomalySeverity, e: EmployeeResult, componentCode: string | null, message: string, details: Record<string, unknown>, extraKey = ''): Detection {
  const fingerprint = [rule, e.employeeId, componentCode ?? '', extraKey].join(':');
  const signature = createHash('sha256').update(JSON.stringify({ rule, severity, details })).digest('hex').slice(0, 32);
  return { rule, severity, employeeId: e.employeeId, employeeCode: e.code, employeeName: e.name, componentCode, message, details, fingerprint, signature };
}

/** Normalises a name for duplicate detection: case, spacing and punctuation are ignored. */
export const normaliseName = (n: string) => n.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Runs every rule for the current period.
 * @param previous most recent finalised period before the current one (or null)
 * @param history earlier finalised periods, newest first (includes `previous`)
 */
export function detectAnomalies(current: PeriodResult, previous: PeriodResult | null, history: PeriodResult[], s: AnomalyRuleSettings): Detection[] {
  if (!s.enabled) return [];
  const out: Detection[] = [];
  const minAbs = dec(s.minAbsoluteChange);

  for (const e of current.employees.values()) {
    if (e.net === null) continue;
    const prev = previous?.employees.get(e.employeeId) ?? null;
    const structureChanged = !!prev && prev.salaryVersionId !== e.salaryVersionId;
    const structureNote = structureChanged
      ? `The salary structure changed since ${previous!.period}${e.salaryVersionNo ? ` (version ${e.salaryVersionNo}${e.salaryEffectiveFrom ? `, effective ${e.salaryEffectiveFrom}` : ''})` : ''}, which may explain this.`
      : null;

    // 1. Net pay change vs the last finalised month.
    if (prev?.net != null) {
      const before = dec(prev.net);
      const after = dec(e.net);
      const diff = after.sub(before);
      if (!before.isZero() && diff.abs().gte(minAbs)) {
        const change = diff.div(before.abs()).mul(100);
        if (change.abs().gte(s.netChangePercent)) {
          const sev: AnomalySeverity = change.abs().gte(s.netChangePercent * 2) ? 'HIGH' : 'MEDIUM';
          out.push(
            make(
              'NET_CHANGE',
              structureChanged ? lower(sev) : sev,
              e,
              null,
              `Net pay went from ${fmt(before)} in ${previous!.period} to ${fmt(after)} (${pct(change)}), above the ${s.netChangePercent}% alert level.${structureNote ? ' ' + structureNote : ''}`,
              { comparedWith: previous!.period, previous: money(before), current: money(after), difference: money(diff), changePercent: change.toFixed(2), threshold: s.netChangePercent, salaryStructureChanged: structureChanged },
            ),
          );
        }
      }
    }

    const prevLines = new Map((prev?.lines ?? []).map((l) => [l.code, l]));
    const curLines = new Map(e.lines.map((l) => [l.code, l]));

    // 2–4. Component-level checks for structure-driven components (fixed, percentage, formula).
    if (prev) {
      for (const l of e.lines) {
        if (l.basis === 'INPUT') continue;
        const now = dec(l.amount);
        const p = prevLines.get(l.code);
        const before = p ? dec(p.amount) : dec(0);
        if (before.isZero() && !now.isZero()) {
          if (now.abs().gte(minAbs))
            out.push(
              make('COMPONENT_NEW', structureChanged ? 'LOW' : 'MEDIUM', e, l.code, `${l.name} is ${fmt(now)} this month but was not paid in ${previous!.period}.${structureNote ? ' ' + structureNote : ''}`, {
                comparedWith: previous!.period,
                component: l.name,
                current: money(now),
                salaryStructureChanged: structureChanged,
              }),
            );
          continue;
        }
        if (before.isZero()) continue;
        const diff = now.sub(before);
        if (diff.abs().lt(minAbs)) continue;
        const change = diff.div(before.abs()).mul(100);
        if (change.abs().gte(s.componentChangePercent)) {
          const sev: AnomalySeverity = change.abs().gte(s.componentChangePercent * 3) ? 'HIGH' : 'MEDIUM';
          out.push(
            make(
              'COMPONENT_CHANGE',
              structureChanged ? lower(sev) : sev,
              e,
              l.code,
              `${l.name} went from ${fmt(before)} in ${previous!.period} to ${fmt(now)} (${pct(change)}), above the ${s.componentChangePercent}% alert level.${structureNote ? ' ' + structureNote : ''}`,
              { comparedWith: previous!.period, component: l.name, previous: money(before), current: money(now), difference: money(diff), changePercent: change.toFixed(2), threshold: s.componentChangePercent, salaryStructureChanged: structureChanged },
            ),
          );
        }
      }
      for (const p of prev.lines) {
        if (p.basis === 'INPUT') continue;
        const before = dec(p.amount);
        const c = curLines.get(p.code);
        if (!before.isZero() && (!c || dec(c.amount).isZero()) && before.abs().gte(minAbs)) {
          out.push(
            make('COMPONENT_REMOVED', structureChanged ? 'LOW' : 'MEDIUM', e, p.code, `${p.name} was ${fmt(before)} in ${previous!.period} but is not paid this month.${structureNote ? ' ' + structureNote : ''}`, {
              comparedWith: previous!.period,
              component: p.name,
              previous: money(before),
              salaryStructureChanged: structureChanged,
            }),
          );
        }
      }
    }

    // 5–7. Monthly-entered amounts (adjustments) against the employee's own history.
    for (const l of e.lines) {
      if (l.basis !== 'INPUT') continue;
      const now = dec(l.amount);
      if (now.isZero()) continue;
      const hist = history.filter((h) => h.employees.has(e.employeeId)).slice(0, s.historyMonths);
      const values = hist.map((h) => dec(h.employees.get(e.employeeId)!.lines.find((x) => x.code === l.code)?.amount ?? 0));

      const p = prevLines.get(l.code);
      if (p && dec(p.amount).eq(now)) {
        out.push(
          make('REPEATED_ADJUSTMENT', 'LOW', e, l.code, `${l.name} of ${fmt(now)} is exactly the same as in ${previous!.period}. Check it was meant to repeat and was not carried over by mistake.`, {
            comparedWith: previous!.period,
            component: l.name,
            amount: money(now),
          }),
        );
      }

      if (values.length < s.minHistoryMonths) continue;
      const max = values.reduce((a, b) => (b.abs().gt(a) ? b.abs() : a), dec(0));
      const avg = values.reduce((a, b) => a.add(b), dec(0)).div(values.length);
      const periods = `${hist[hist.length - 1].period} – ${hist[0].period}`;
      if (max.isZero()) {
        if (now.abs().gte(minAbs))
          out.push(
            make('ADJUSTMENT_FIRST_TIME', 'LOW', e, l.code, `${l.name} of ${fmt(now)} is entered for the first time in ${values.length} finalised months (${periods}).`, {
              component: l.name,
              current: money(now),
              monthsChecked: values.length,
              periods,
            }),
          );
        continue;
      }
      const limit = max.mul(s.outlierMultiplier);
      if (now.abs().gt(limit) && now.sub(avg).abs().gte(minAbs)) {
        const sev: AnomalySeverity = now.abs().gt(limit.mul(2)) ? 'HIGH' : 'MEDIUM';
        out.push(
          make(
            'ADJUSTMENT_OUTLIER',
            sev,
            e,
            l.code,
            `${l.name} is ${fmt(now)}. Over the last ${values.length} finalised months (${periods}) it was at most ${fmt(max)} (average ${fmt(avg)}); the alert level is ${s.outlierMultiplier}× the largest earlier amount.`,
            { component: l.name, current: money(now), historicalMax: money(max), historicalAverage: money(avg), monthsChecked: values.length, periods, multiplier: s.outlierMultiplier },
          ),
        );
      }
    }
  }

  // 8. Possible duplicate employees within the run (same name under different Employee IDs).
  const byName = new Map<string, EmployeeResult[]>();
  for (const e of current.employees.values()) {
    const k = normaliseName(e.name);
    if (!k) continue;
    byName.set(k, [...(byName.get(k) ?? []), e]);
  }
  for (const group of byName.values()) {
    if (group.length < 2) continue;
    for (const e of group) {
      const others = group.filter((o) => o.employeeId !== e.employeeId);
      out.push(
        make(
          'DUPLICATE_EMPLOYEE',
          'HIGH',
          e,
          null,
          `${e.name} (${e.code}) has the same name as ${others.map((o) => `${o.name} (${o.code})`).join(', ')} in this payroll. Check this is not the same person paid twice.`,
          { otherEmployees: others.map((o) => ({ id: o.employeeId, code: o.code, name: o.name })).sort((a, b) => a.code.localeCompare(b.code)) },
          others.map((o) => o.employeeId).sort().join(','),
        ),
      );
    }
  }

  return out;
}
