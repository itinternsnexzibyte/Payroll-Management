/**
 * Month-vs-month payroll reconciliation (change request B). Pure functions over calculated
 * results: no formulas are applied here, only differences between stored amounts.
 */
import { dec, money, type Dec } from '@nexzi/server-core';
import type { RunEmployeeResult, RunResult } from '../analysis/run-data';

export type ChangeKind = 'NEW' | 'MISSING' | 'CHANGED' | 'UNCHANGED';

export interface Amounts {
  gross: string;
  deductions: string;
  net: string;
}

export interface ComponentDiff {
  code: string;
  name: string;
  type: 'EARNING' | 'DEDUCTION';
  base: string | null;
  compare: string | null;
  difference: string;
  changePercent: string | null;
  change: ChangeKind;
}

export interface EmployeeDiff {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  departmentName: string | null;
  change: ChangeKind;
  base: Amounts | null;
  compare: Amounts | null;
  difference: Amounts;
  netChangePercent: string | null;
  components: ComponentDiff[];
}

export interface ComponentTotal {
  code: string;
  name: string;
  type: 'EARNING' | 'DEDUCTION';
  base: string;
  compare: string;
  difference: string;
  changePercent: string | null;
}

export interface Reconciliation {
  employees: EmployeeDiff[];
  components: ComponentTotal[];
  totals: { base: Amounts; compare: Amounts; difference: Amounts; netChangePercent: string | null };
  counts: Record<ChangeKind, number>;
}

const pctChange = (before: Dec, after: Dec): string | null => (before.isZero() ? null : after.sub(before).div(before.abs()).mul(100).toFixed(2));
const amounts = (e: RunEmployeeResult | undefined): Amounts | null => (e ? { gross: money(dec(e.gross)), deductions: money(dec(e.deductions)), net: money(dec(e.net)) } : null);
const sub = (a: Amounts | null, b: Amounts | null): Amounts => ({
  gross: money(dec(b?.gross ?? 0).sub(dec(a?.gross ?? 0))),
  deductions: money(dec(b?.deductions ?? 0).sub(dec(a?.deductions ?? 0))),
  net: money(dec(b?.net ?? 0).sub(dec(a?.net ?? 0))),
});

/** Compares two runs. `base` is the earlier/reference month, `compare` the month being checked. */
export function reconcile(base: RunResult, compare: RunResult): Reconciliation {
  const ids = new Set([...base.employees.keys(), ...compare.employees.keys()]);
  const employees: EmployeeDiff[] = [];
  const compTotals = new Map<string, { code: string; name: string; type: 'EARNING' | 'DEDUCTION'; base: Dec; compare: Dec; order: number }>();
  const counts: Record<ChangeKind, number> = { NEW: 0, MISSING: 0, CHANGED: 0, UNCHANGED: 0 };

  for (const id of ids) {
    const b = base.employees.get(id);
    const c = compare.employees.get(id);
    const who = (c ?? b)!;
    const bl = new Map((b?.lines ?? []).map((l, i) => [l.code, { ...l, order: i }]));
    const cl = new Map((c?.lines ?? []).map((l, i) => [l.code, { ...l, order: i }]));
    const components: (ComponentDiff & { order: number })[] = [];
    for (const code of new Set([...bl.keys(), ...cl.keys()])) {
      const x = bl.get(code);
      const y = cl.get(code);
      const meta = (y ?? x)!;
      const before = dec(x?.amount ?? 0);
      const after = dec(y?.amount ?? 0);
      // A component that is absent in one month counts as zero, so absent ↔ 0.00 is unchanged.
      const change: ChangeKind = before.eq(after) ? 'UNCHANGED' : !x ? 'NEW' : !y ? 'MISSING' : 'CHANGED';
      components.push({
        code,
        name: meta.name,
        type: meta.type,
        base: x ? money(before) : null,
        compare: y ? money(after) : null,
        difference: money(after.sub(before)),
        changePercent: x ? pctChange(before, after) : null,
        change,
        order: meta.order,
      });
      const t = compTotals.get(code) ?? { code, name: meta.name, type: meta.type, base: dec(0), compare: dec(0), order: meta.order };
      t.base = t.base.add(before);
      t.compare = t.compare.add(after);
      compTotals.set(code, t);
    }
    // Same order as the payslip: earnings, then deductions, each in component order.
    components.sort((p, q) => (p.type === q.type ? 0 : p.type === 'EARNING' ? -1 : 1) || p.order - q.order || p.code.localeCompare(q.code));
    const change: ChangeKind = !b ? 'NEW' : !c ? 'MISSING' : components.every((x) => x.change === 'UNCHANGED') && dec(b.net).eq(dec(c.net)) ? 'UNCHANGED' : 'CHANGED';
    counts[change]++;
    const ba = amounts(b);
    const ca = amounts(c);
    employees.push({
      employeeId: id,
      employeeCode: who.code,
      employeeName: who.name,
      departmentName: c?.departmentName ?? b?.departmentName ?? null,
      change,
      base: ba,
      compare: ca,
      difference: sub(ba, ca),
      netChangePercent: ba && ca ? pctChange(dec(ba.net), dec(ca.net)) : null,
      components: components.map(({ order: _order, ...c }) => c),
    });
  }
  employees.sort((p, q) => p.employeeCode.localeCompare(q.employeeCode));

  const sum = (r: RunResult) => {
    let g = dec(0), d = dec(0), n = dec(0);
    for (const e of r.employees.values()) {
      g = g.add(dec(e.gross));
      d = d.add(dec(e.deductions));
      n = n.add(dec(e.net));
    }
    return { gross: money(g), deductions: money(d), net: money(n) };
  };
  const tb = sum(base);
  const tc = sum(compare);
  const components = [...compTotals.values()]
    .sort((p, q) => (p.type === q.type ? 0 : p.type === 'EARNING' ? -1 : 1) || p.order - q.order || p.code.localeCompare(q.code))
    .map((t) => ({ code: t.code, name: t.name, type: t.type, base: money(t.base), compare: money(t.compare), difference: money(t.compare.sub(t.base)), changePercent: pctChange(t.base, t.compare) }));

  return { employees, components, totals: { base: tb, compare: tc, difference: sub(tb, tc), netChangePercent: pctChange(dec(tb.net), dec(tc.net)) }, counts };
}

export type Explanation = 'UNEXPLAINED' | 'EXPECTED' | 'DISCREPANCY' | 'RESOLVED';

/**
 * Status of a difference for the reviewer: unchanged rows need nothing; changed rows are
 * "unresolved" until explained as expected or resolved.
 */
export function explanationStatus(change: ChangeKind, classification: 'EXPECTED' | 'DISCREPANCY' | 'RESOLVED' | undefined): Explanation | null {
  if (change === 'UNCHANGED') return classification ?? null;
  return classification ?? 'UNEXPLAINED';
}
