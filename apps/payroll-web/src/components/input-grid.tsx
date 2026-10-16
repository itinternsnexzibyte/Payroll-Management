'use client';
import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Save, Undo2 } from 'lucide-react';
import { Alert, Button, EmptyState, ErrorState, Input, Spinner, cn, errorMessage, get, put, useToast } from '@nexzi/ui';
import type { InputDefinition } from '@/lib/types';

interface GridData {
  status: string;
  columns: Pick<InputDefinition, 'key' | 'label' | 'dataType' | 'mandatory' | 'minValue' | 'maxValue'>[];
  rows: { employeeId: string; employeeCode: string; employeeName: string; department: string | null; values: Record<string, string> }[];
}

const k = (emp: string, key: string) => `${emp}|${key}`;
const NUM = /^-?\d{1,13}(\.\d{1,6})?$/;

/**
 * Excel-like monthly input grid: arrow/Enter/Tab navigation, multi-cell paste from Excel,
 * client-side format hints and server validation per cell. Invalid cells keep the typed value.
 */
export function InputGrid({ runId, editable, onSaved }: { runId: string; editable: boolean; onSaved: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['run-inputs', runId], queryFn: () => get<GridData>(`/payroll-runs/${runId}/inputs`) });
  const [values, setValues] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState('');
  const refs = useRef<Map<string, HTMLInputElement>>(new Map());

  useEffect(() => {
    if (!q.data) return;
    const v: Record<string, string> = {};
    for (const r of q.data.rows) for (const c of q.data.columns) v[k(r.employeeId, c.key)] = r.values[c.key] ?? '';
    setValues(v);
    setDirty(new Set());
  }, [q.data]);

  useEffect(() => {
    if (!dirty.size) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty.size]);

  const rows = useMemo(() => (q.data?.rows ?? []).filter((r) => !filter || `${r.employeeCode} ${r.employeeName}`.toLowerCase().includes(filter.toLowerCase())), [q.data, filter]);
  const cols = q.data?.columns ?? [];

  const localCheck = useCallback(
    (col: GridData['columns'][number], v: string) => {
      if (!v.trim() || col.dataType === 'TEXT') return null;
      if (!NUM.test(v.trim())) return 'Enter a number.';
      if (col.minValue !== null && Number(v) < Number(col.minValue)) return `Minimum ${col.minValue}.`;
      if (col.maxValue !== null && Number(v) > Number(col.maxValue)) return `Maximum ${col.maxValue}.`;
      return null;
    },
    [],
  );

  const setCell = (emp: string, key: string, v: string) => {
    const id = k(emp, key);
    setValues((x) => ({ ...x, [id]: v }));
    setDirty((d) => new Set(d).add(id));
    const col = cols.find((c) => c.key === key)!;
    setErrors((e) => {
      const n = { ...e };
      const msg = localCheck(col, v);
      if (msg) n[id] = msg;
      else delete n[id];
      return n;
    });
  };

  const focus = (ri: number, ci: number) => {
    const r = rows[Math.max(0, Math.min(rows.length - 1, ri))];
    const c = cols[Math.max(0, Math.min(cols.length - 1, ci))];
    if (r && c) refs.current.get(k(r.employeeId, c.key))?.focus();
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>, ri: number, ci: number) => {
    const el = e.currentTarget;
    if (e.key === 'ArrowDown' || (e.key === 'Enter' && !e.shiftKey)) {
      e.preventDefault();
      focus(ri + 1, ci);
    } else if (e.key === 'ArrowUp' || (e.key === 'Enter' && e.shiftKey)) {
      e.preventDefault();
      focus(ri - 1, ci);
    } else if (e.key === 'ArrowRight' && el.selectionStart === el.value.length) {
      e.preventDefault();
      focus(ri, ci + 1);
    } else if (e.key === 'ArrowLeft' && el.selectionStart === 0 && el.selectionEnd === 0) {
      e.preventDefault();
      focus(ri, ci - 1);
    } else if (e.key === 's' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void save();
    }
  };

  const onPaste = (e: ClipboardEvent<HTMLInputElement>, ri: number, ci: number) => {
    const text = e.clipboardData.getData('text/plain');
    if (!text.includes('\t') && !text.includes('\n')) return;
    e.preventDefault();
    const lines = text.replace(/\r/g, '').replace(/\n$/, '').split('\n');
    let count = 0;
    lines.forEach((line, dr) => {
      line.split('\t').forEach((cell, dc) => {
        const r = rows[ri + dr];
        const c = cols[ci + dc];
        if (r && c) {
          setCell(r.employeeId, c.key, cell.trim());
          count++;
        }
      });
    });
    toast.info(`Pasted ${count} cell(s). Remember to save.`);
  };

  const save = async () => {
    if (!dirty.size) return;
    setSaving(true);
    try {
      const entries = [...dirty].map((id) => {
        const [employeeId, inputKey] = id.split('|');
        return { employeeId, inputKey, value: values[id] ?? '' };
      });
      const res = await put<{ saved: number; errors: { employeeId: string; inputKey: string; message: string }[] }>(`/payroll-runs/${runId}/inputs`, { entries });
      const failed = new Set(res.errors.map((x) => k(x.employeeId, x.inputKey)));
      setErrors((prev) => {
        const n: Record<string, string> = {};
        for (const [id, msg] of Object.entries(prev)) if (failed.has(id)) n[id] = msg;
        for (const x of res.errors) n[k(x.employeeId, x.inputKey)] = x.message;
        return n;
      });
      // Keep failed cells dirty (with the typed value) so nothing is lost.
      setDirty(failed);
      if (res.saved) toast.success(`${res.saved} cell(s) saved.${res.errors.length ? ` ${res.errors.length} need correction.` : ''}`);
      else if (res.errors.length) toast.error(`${res.errors.length} cell(s) could not be saved — see the highlighted cells.`);
      await qc.invalidateQueries({ queryKey: ['run', runId] });
      onSaved();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const discard = () => {
    if (!q.data) return;
    const v: Record<string, string> = {};
    for (const r of q.data.rows) for (const c of q.data.columns) v[k(r.employeeId, c.key)] = r.values[c.key] ?? '';
    setValues(v);
    setDirty(new Set());
    setErrors({});
  };

  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  if (!cols.length) return <EmptyState title="No monthly input columns are configured" hint="Configure them under Payroll settings → Monthly input columns (taken from the client's workbook)." />;

  const missingMandatory = rows.reduce((n, r) => n + cols.filter((c) => c.mandatory && !(values[k(r.employeeId, c.key)] ?? '').trim()).length, 0);

  return (
    <div>
      <div className="no-print flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
        <Input className="h-9 max-w-xs" aria-label="Filter employees" placeholder="Filter employees" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <p className="text-xs text-muted">Arrow keys / Enter move between cells · paste a block straight from Excel · Ctrl+S saves</p>
        <div className="flex-1" />
        {dirty.size > 0 && <span className="text-xs font-medium text-wine">{dirty.size} unsaved change(s)</span>}
        {editable && (
          <>
            <Button size="sm" variant="secondary" icon={<Undo2 className="h-4 w-4" />} disabled={!dirty.size || saving} onClick={discard}>
              Discard
            </Button>
            <Button size="sm" icon={<Save className="h-4 w-4" />} disabled={!dirty.size} loading={saving} onClick={save}>
              Save inputs
            </Button>
          </>
        )}
      </div>
      {!editable && <Alert tone="info" className="m-4">Inputs are read-only in the current status{q.data?.status === 'FINALISED' ? ' (finalised — re-open to change)' : ''}.</Alert>}
      {missingMandatory > 0 && (
        <Alert tone="warning" className="m-4">
          {missingMandatory} mandatory value(s) are still empty. Calculation will list them as exceptions.
        </Alert>
      )}
      <div className="max-h-[60vh] overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-blush">
            <tr>
              <th className="sticky left-0 z-20 min-w-56 border-b border-r border-line bg-blush px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-burgundy">Employee</th>
              {cols.map((c) => (
                <th key={c.key} className="min-w-36 border-b border-line px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-burgundy" title={c.key}>
                  {c.label}
                  {c.mandatory && <span className="ml-0.5 text-wine">*</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={r.employeeId} className="hover:bg-blush/15">
                <th scope="row" className="sticky left-0 z-[1] border-b border-r border-line bg-white px-3 py-1.5 text-left font-normal">
                  <span className="font-medium text-ink">{r.employeeCode}</span> <span className="text-muted">· {r.employeeName}</span>
                </th>
                {cols.map((c, ci) => {
                  const id = k(r.employeeId, c.key);
                  const err = errors[id];
                  const missing = c.mandatory && !(values[id] ?? '').trim();
                  return (
                    <td key={c.key} className="border-b border-line p-0">
                      <input
                        ref={(el) => {
                          if (el) refs.current.set(id, el);
                          else refs.current.delete(id);
                        }}
                        aria-label={`${c.label} for ${r.employeeCode}`}
                        aria-invalid={!!err || undefined}
                        title={err}
                        readOnly={!editable}
                        inputMode={c.dataType === 'NUMBER' ? 'decimal' : 'text'}
                        value={values[id] ?? ''}
                        onChange={(e) => setCell(r.employeeId, c.key, e.target.value)}
                        onKeyDown={(e) => onKey(e, ri, ci)}
                        onPaste={(e) => editable && onPaste(e, ri, ci)}
                        className={cn(
                          'h-9 w-full border-0 bg-transparent px-3 text-ink outline-none focus:bg-white focus:ring-2 focus:ring-inset focus:ring-wine',
                          c.dataType === 'NUMBER' && 'text-right tabular-nums',
                          dirty.has(id) && 'bg-blush/40',
                          missing && !err && 'bg-warning-bg/70',
                          err && 'bg-danger-bg ring-1 ring-inset ring-danger',
                        )}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {Object.keys(errors).length > 0 && (
        <div className="border-t border-line px-4 py-3 text-xs text-danger" role="alert">
          {Object.keys(errors).length} cell(s) have problems — hover a red cell for details. Your typed values are kept.
        </div>
      )}
    </div>
  );
}
