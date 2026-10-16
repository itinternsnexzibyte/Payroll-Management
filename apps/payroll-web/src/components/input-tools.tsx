'use client';
import { useRef, useState } from 'react';
import { FileDown, FileUp, Wand2 } from 'lucide-react';
import { Alert, Button, Dialog, download, errorMessage, post, useAuth, useToast } from '@nexzi/ui';

interface ImportResult {
  saved: number;
  errors: { employeeCode: string; inputKey: string; message: string }[];
  unmatchedEmployees: { row: number; employeeCode: string }[];
  unknownColumns: string[];
  columns: string[];
}
interface FillResult {
  summary: Record<string, { inputKey: string; employees: number; total: string }>;
  saved: number;
  errors: { employeeId: string; inputKey: string; message: string }[];
}
const SOURCE_LABEL: Record<string, string> = { unpaidLeaveDays: 'Unpaid leave days', advanceRecovery: 'Advance recovery', bonus: 'Bonus', incentive: 'Incentive' };

/** Template download, file import and "fill from modules" for a payroll run's monthly inputs. */
export function InputTools({ runId, onChanged, hasUnsaved }: { runId: string; onChanged: () => void; hasUnsaved: boolean }) {
  const toast = useToast();
  const { can } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [imported, setImported] = useState<ImportResult | null>(null);
  const [filled, setFilled] = useState<FillResult | null>(null);
  if (!can('payroll.input')) return null;

  const guard = () => {
    if (hasUnsaved) {
      toast.error('Save or discard your unsaved changes first.');
      return false;
    }
    return true;
  };
  const upload = async (f: File) => {
    setBusy('import');
    try {
      const fd = new FormData();
      fd.append('file', f);
      const res = await fetch(`/api/payroll-runs/${runId}/inputs/import`, { method: 'POST', body: fd, credentials: 'same-origin' });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? 'The file could not be imported.');
      setImported(body);
      onChanged();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  };
  const fill = async () => {
    if (!guard()) return;
    setBusy('fill');
    try {
      const r = await post<FillResult>(`/payroll-runs/${runId}/inputs/fill`);
      setFilled(r);
      onChanged();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <Button size="sm" variant="ghost" icon={<FileDown className="h-4 w-4" />} loading={busy === 'template'} onClick={async () => {
        setBusy('template');
        try {
          await download(`/payroll-runs/${runId}/inputs/template`, 'inputs.xlsx');
        } catch (e) {
          toast.error(errorMessage(e));
        } finally {
          setBusy(null);
        }
      }}>
        Template
      </Button>
      <Button size="sm" variant="secondary" icon={<FileUp className="h-4 w-4" />} loading={busy === 'import'} onClick={() => guard() && fileRef.current?.click()}>
        Import file
      </Button>
      <input ref={fileRef} type="file" accept=".csv,.xlsx" className="hidden" aria-label="Import monthly inputs file" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
      <Button size="sm" variant="secondary" icon={<Wand2 className="h-4 w-4" />} loading={busy === 'fill'} onClick={fill} title="Fill the mapped columns from approved leave, active advances and approved bonuses">
        Fill from leave, advances &amp; bonuses
      </Button>

      {imported && (
        <Dialog open onClose={() => setImported(null)} title="Import result" footer={<Button onClick={() => setImported(null)}>Close</Button>}>
          <div className="space-y-3 text-sm">
            <Alert tone={imported.errors.length || imported.unmatchedEmployees.length ? 'warning' : 'success'}>
              {imported.saved} value(s) saved into {imported.columns.join(', ')}.
            </Alert>
            {imported.errors.length > 0 && (
              <div>
                <p className="mb-1 font-medium text-ink">Not saved ({imported.errors.length})</p>
                <ul className="max-h-40 space-y-1 overflow-y-auto text-xs text-muted">
                  {imported.errors.map((e, i) => (
                    <li key={i}>
                      {e.employeeCode} · {e.inputKey}: {e.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {imported.unmatchedEmployees.length > 0 && <p className="text-xs text-muted">Not in this payroll: {imported.unmatchedEmployees.map((u) => `${u.employeeCode} (row ${u.row})`).join(', ')}</p>}
            {imported.unknownColumns.length > 0 && <p className="text-xs text-muted">Ignored columns: {imported.unknownColumns.join(', ')}</p>}
          </div>
        </Dialog>
      )}
      {filled && (
        <Dialog open onClose={() => setFilled(null)} title="Filled from other modules" footer={<Button onClick={() => setFilled(null)}>Close</Button>}>
          <div className="space-y-3 text-sm">
            <ul className="space-y-1">
              {Object.entries(filled.summary).map(([src, s]) => (
                <li key={src} className="flex justify-between gap-4 border-b border-line pb-1">
                  <span>
                    {SOURCE_LABEL[src] ?? src} <span className="text-xs text-muted">→ {s.inputKey}</span>
                  </span>
                  <span className="text-muted">
                    {s.employees} employee(s) · total {s.total}
                  </span>
                </li>
              ))}
            </ul>
            {filled.errors.length > 0 && <Alert tone="warning">{filled.errors.length} value(s) were not saved. Check the input column settings.</Alert>}
            <p className="text-xs text-muted">Only the mapped columns were overwritten. Recalculate the payroll to use the new values.</p>
          </div>
        </Dialog>
      )}
    </>
  );
}
