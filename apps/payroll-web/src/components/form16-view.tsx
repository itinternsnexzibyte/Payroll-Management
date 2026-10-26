'use client';
import { Alert, Card, KeyValue, formatDate, formatMoney } from '@nexzi/ui';

export interface Form16 {
  financialYear: string;
  assessmentYear: string;
  regime: 'NEW' | 'OLD';
  employer: { name: string; address: string | null; pan: string | null; tan: string | null };
  employee: { id: string; employeeCode: string; fullName: string; designation: string | null; department: string | null; pan: string | null; periodFrom: string; periodTo: string };
  partA: { quarters: { label: string; amountPaid: string; taxDeducted: string }[]; totalPaid: string; totalTax: string };
  partB: {
    salaryComponents: { name: string; amount: string }[];
    grossSalary: string;
    exemptions: string;
    standardDeduction: string;
    professionalTax: string;
    incomeFromSalary: string;
    section80C: string;
    employeePf: string;
    taxableIncome: string;
    taxOnIncome: string | null;
    tdsDeducted: string;
    balance: string | null;
  };
  months: { label: string; paid: boolean; gross: string; tds: string; pf: string; pt: string; net: string }[];
  monthsPaid: number;
  notes: string[];
}

const Row = ({ label, value, strong, indent }: { label: string; value: string | null; strong?: boolean; indent?: boolean }) => (
  <tr className={`border-t border-line ${strong ? 'bg-surface font-semibold' : ''}`}>
    <td className={`px-3 py-2 ${indent ? 'pl-8 text-muted' : ''}`}>{label}</td>
    <td className="px-3 py-2 text-right tabular-nums">{value === null ? 'Not computed' : formatMoney(value)}</td>
  </tr>
);

export function Form16View({ f }: { f: Form16 }) {
  const b = f.partB;
  return (
    <div className="space-y-6">
      <Card title={`Form 16 · FY ${f.financialYear} (AY ${f.assessmentYear}) · ${f.regime === 'NEW' ? 'New regime' : 'Old regime'}`}>
        <div className="grid gap-6 lg:grid-cols-2">
          <KeyValue
            columns={1}
            items={[
              { label: 'Employer', value: f.employer.name },
              { label: 'Employer PAN / TAN', value: `${f.employer.pan ?? 'Not recorded'} / ${f.employer.tan ?? 'Not recorded'}` },
            ]}
          />
          <KeyValue
            columns={1}
            items={[
              { label: 'Employee', value: `${f.employee.fullName} (${f.employee.employeeCode})${f.employee.designation ? ` · ${f.employee.designation}` : ''}` },
              { label: 'Employee PAN', value: f.employee.pan ?? 'Not recorded' },
              { label: 'Period with employer', value: `${formatDate(f.employee.periodFrom)} – ${formatDate(f.employee.periodTo)}` },
            ]}
          />
        </div>
      </Card>
      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Part A — tax deducted per quarter" padded={false}>
          <table className="w-full text-sm">
            <thead className="bg-mist/35 text-left text-xs uppercase tracking-wide text-primary">
              <tr>
                <th className="px-3 py-2">Quarter</th>
                <th className="px-3 py-2 text-right">Amount paid</th>
                <th className="px-3 py-2 text-right">Tax deducted</th>
              </tr>
            </thead>
            <tbody>
              {f.partA.quarters.map((q) => (
                <tr key={q.label} className="border-t border-line">
                  <td className="px-3 py-2">{q.label}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatMoney(q.amountPaid)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatMoney(q.taxDeducted)}</td>
                </tr>
              ))}
              <tr className="border-t border-line bg-surface font-semibold">
                <td className="px-3 py-2">Total</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatMoney(f.partA.totalPaid)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatMoney(f.partA.totalTax)}</td>
              </tr>
            </tbody>
          </table>
        </Card>
        <Card title="Part B — salary and tax computation" padded={false}>
          <table className="w-full text-sm">
            <tbody>
              <Row label="1. Gross salary u/s 17(1)" value={b.grossSalary} strong />
              {b.salaryComponents.map((c) => (
                <Row key={c.name} label={c.name} value={c.amount} indent />
              ))}
              <Row label="2. Less: exempt allowances u/s 10" value={b.exemptions} />
              <Row label="3. Less: standard deduction u/s 16(ia)" value={b.standardDeduction} />
              <Row label="4. Less: professional tax u/s 16(iii)" value={b.professionalTax} />
              <Row label="5. Income under the head “Salaries”" value={b.incomeFromSalary} strong />
              <Row label={`6. Less: 80C (employee PF ${formatMoney(b.employeePf)})`} value={b.section80C} />
              <Row label="7. Total taxable income" value={b.taxableIncome} strong />
              <Row label="8. Tax on total income (incl. cess)" value={b.taxOnIncome} />
              <Row label="9. Tax deducted at source" value={b.tdsDeducted} />
              <Row label="10. Tax payable / (refundable)" value={b.balance} strong />
            </tbody>
          </table>
        </Card>
      </div>
      <Card title={`Month-wise (${f.monthsPaid} month${f.monthsPaid === 1 ? '' : 's'} paid)`} padded={false}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-mist/35 text-left text-xs uppercase tracking-wide text-primary">
              <tr>
                {['Month', 'Gross', 'PF', 'Prof. tax', 'TDS', 'Net paid'].map((h, i) => (
                  <th key={h} className={`px-3 py-2 ${i ? 'text-right' : ''}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {f.months.map((m) => (
                <tr key={m.label} className={`border-t border-line ${m.paid ? '' : 'text-muted'}`}>
                  <td className="px-3 py-2">{m.label}</td>
                  {m.paid ? (
                    [m.gross, m.pf, m.pt, m.tds, m.net].map((v, i) => (
                      <td key={i} className="px-3 py-2 text-right tabular-nums">
                        {formatMoney(v)}
                      </td>
                    ))
                  ) : (
                    <td colSpan={5} className="px-3 py-2 text-right italic">
                      Not paid through finalised payroll
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Alert tone="info">
        <ul className="ml-4 list-disc space-y-1">
          {f.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      </Alert>
    </div>
  );
}
