'use client';
import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FileUp, RotateCcw } from 'lucide-react';
import {
  Alert,
  Button,
  ButtonLink,
  Card,
  DataTable,
  EmptyState,
  Field,
  PageHeader,
  RequirePermission,
  Select,
  StatusBadge,
  api,
  download,
  errorMessage,
  formatDateTime,
  get,
  post,
  useToast,
} from '@nexzi/ui';

interface PreviewRow {
  rowNumber: number;
  raw: Record<string, string>;
  errors: string[];
}
interface Preview {
  jobId: string;
  fileName?: string;
  headers?: string[];
  fields?: { key: string; label: string; required: boolean }[];
  mapping: Record<string, string | undefined>;
  totalRows: number;
  validRows: number;
  rows: PreviewRow[];
}
interface Job {
  id: string;
  fileName: string;
  status: string;
  totalRows: number;
  successRows: number;
  errorRows: number;
  createdAt: string;
}

export default function ImportPage() {
  return (
    <RequirePermission permission="employees.manage">
      <ImportWizard />
    </RequirePermission>
  );
}

function ImportWizard() {
  const toast = useToast();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [meta, setMeta] = useState<{ headers: string[]; fields: { key: string; label: string; required: boolean }[] } | null>(null);
  const [busy, setBusy] = useState<'upload' | 'validate' | 'commit' | null>(null);
  const [result, setResult] = useState<{ jobId: string; status: string; imported: number; failed: number } | null>(null);
  const [showErrorsOnly, setShowErrorsOnly] = useState(false);
  const jobs = useQuery({ queryKey: ['import-jobs'], queryFn: () => get<Job[]>('/import-jobs') });

  const upload = async () => {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) return toast.error('The file exceeds the 5 MB limit.');
    if (!/\.(csv|xlsx)$/i.test(file.name)) return toast.error('Only .csv and .xlsx files are accepted.');
    setBusy('upload');
    setResult(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const p = await api<Preview>('/employees/import/preview', { method: 'POST', body: fd });
      setPreview(p);
      setMeta({ headers: p.headers ?? [], fields: p.fields ?? [] });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const remap = async (key: string, header: string) => {
    if (!preview) return;
    const mapping = { ...preview.mapping, [key]: header || undefined };
    setBusy('validate');
    try {
      const p = await post<Preview>(`/employees/import/${preview.jobId}/validate`, { mapping });
      setPreview({ ...preview, ...p });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const commit = async () => {
    if (!preview) return;
    setBusy('commit');
    try {
      const r = await post<{ jobId: string; status: string; imported: number; failed: number }>(`/employees/import/${preview.jobId}/commit`, { mapping: preview.mapping });
      setResult(r);
      setPreview(null);
      setFile(null);
      if (fileRef.current) fileRef.current.value = '';
      qc.invalidateQueries({ queryKey: ['employees'] });
      qc.invalidateQueries({ queryKey: ['import-jobs'] });
      toast.success(`${r.imported} employee(s) imported${r.failed ? `, ${r.failed} row(s) need correction` : ''}.`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const errorCsv = async (jobId: string) => {
    try {
      await download(`/import-jobs/${jobId}/errors`, 'import-errors.csv');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const rows = preview ? (showErrorsOnly ? preview.rows.filter((r) => r.errors.length) : preview.rows) : [];

  return (
    <>
      <PageHeader
        title="Import employees"
        description="Upload a CSV or XLSX file, check the column mapping and row-level validation, then import the valid rows. Invalid rows can be downloaded, corrected and re-imported."
        breadcrumbs={[{ label: 'Dashboard', href: '/' }, { label: 'Employees', href: '/employees' }, { label: 'Import' }]}
        actions={
          <>
            <Button variant="secondary" icon={<Download className="h-4 w-4" />} onClick={() => download('/employees/import/template?format=xlsx', 'employee-import-template.xlsx').catch((e) => toast.error(errorMessage(e)))}>
              XLSX template
            </Button>
            <Button variant="secondary" onClick={() => download('/employees/import/template?format=csv', 'employee-import-template.csv').catch((e) => toast.error(errorMessage(e)))}>
              CSV template
            </Button>
          </>
        }
      />
      <div className="space-y-6">
        <Card title="1. Choose a file">
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Spreadsheet (.csv or .xlsx, max 5 MB)" htmlFor="file" className="min-w-72 flex-1">
              <input
                ref={fileRef}
                id="file"
                type="file"
                accept=".csv,.xlsx"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="block w-full text-sm text-ink file:mr-3 file:rounded-md file:border-0 file:bg-blush file:px-3 file:py-2 file:text-sm file:font-medium file:text-burgundy hover:file:bg-blush/70"
              />
            </Field>
            <Button icon={<FileUp className="h-4 w-4" />} disabled={!file} loading={busy === 'upload'} onClick={upload}>
              Upload &amp; validate
            </Button>
          </div>
          <p className="mt-3 text-xs text-muted">Dates: YYYY-MM-DD or DD/MM/YYYY. Departments and designations must already exist (Configuration → Departments). Existing Employee IDs are rejected as duplicates.</p>
        </Card>

        {result && (
          <Alert tone={result.failed ? 'warning' : 'success'} title={`Import ${result.status.toLowerCase()}: ${result.imported} imported, ${result.failed} failed`}>
            {result.failed > 0 && (
              <span>
                Download the failed rows, correct them and upload the corrected file.{' '}
                <button className="font-semibold underline" onClick={() => errorCsv(result.jobId)}>
                  Download error report
                </button>
              </span>
            )}
          </Alert>
        )}

        {preview && meta && (
          <>
            <Card title="2. Check column mapping">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {meta.fields.map((f) => (
                  <Field key={f.key} label={f.label} htmlFor={`map-${f.key}`} required={f.required}>
                    <Select id={`map-${f.key}`} value={preview.mapping[f.key] ?? ''} onChange={(e) => remap(f.key, e.target.value)} disabled={busy === 'validate'}>
                      <option value="">— Not in file —</option>
                      {meta.headers.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </Select>
                  </Field>
                ))}
              </div>
            </Card>
            <Card
              title={`3. Review rows — ${preview.validRows} of ${preview.totalRows} valid`}
              actions={
                <>
                  <label className="flex items-center gap-2 text-sm text-ink">
                    <input type="checkbox" className="accent-burgundy" checked={showErrorsOnly} onChange={(e) => setShowErrorsOnly(e.target.checked)} /> Errors only
                  </label>
                  <Button variant="secondary" size="sm" icon={<RotateCcw className="h-4 w-4" />} onClick={() => setPreview(null)}>
                    Start over
                  </Button>
                  <Button size="sm" disabled={preview.validRows === 0} loading={busy === 'commit'} onClick={commit}>
                    Import {preview.validRows} valid row{preview.validRows === 1 ? '' : 's'}
                  </Button>
                </>
              }
              padded={false}
            >
              <DataTable<PreviewRow>
                dense
                rows={rows}
                rowKey={(r) => String(r.rowNumber)}
                empty={<EmptyState title="No rows to show" />}
                columns={[
                  { key: 'row', header: 'Row', render: (r) => r.rowNumber },
                  ...meta.fields.filter((f) => preview.mapping[f.key]).map((f) => ({ key: f.key, header: f.label, render: (r: PreviewRow) => r.raw[preview.mapping[f.key]!] || '—' })),
                  {
                    key: 'status',
                    header: 'Result',
                    render: (r) =>
                      r.errors.length ? (
                        <ul className="space-y-0.5 text-xs text-danger">
                          {r.errors.map((e) => (
                            <li key={e}>{e}</li>
                          ))}
                        </ul>
                      ) : (
                        <StatusBadge status="OK" label="Ready" />
                      ),
                  },
                ]}
              />
              {preview.totalRows > preview.rows.length && <p className="px-4 py-2 text-xs text-muted">Showing the first {preview.rows.length} rows; all rows are validated and imported.</p>}
            </Card>
          </>
        )}

        <Card title="Recent imports" padded={false}>
          <DataTable<Job>
            dense
            rows={jobs.data}
            loading={jobs.isLoading}
            rowKey={(j) => j.id}
            empty={<EmptyState title="No imports yet" />}
            columns={[
              { key: 'file', header: 'File', render: (j) => j.fileName },
              { key: 'when', header: 'Uploaded', render: (j) => formatDateTime(j.createdAt) },
              { key: 'status', header: 'Status', render: (j) => <StatusBadge status={j.status} /> },
              { key: 'rows', header: 'Rows', align: 'right', render: (j) => `${j.successRows} / ${j.totalRows}` },
              { key: 'err', header: '', align: 'right', render: (j) => (j.errorRows > 0 && j.status !== 'PREVIEWED' ? <Button size="sm" variant="ghost" onClick={() => errorCsv(j.id)}>Error report ({j.errorRows})</Button> : null) },
            ]}
          />
        </Card>
        <ButtonLink href="/employees" variant="ghost">
          ← Back to employees
        </ButtonLink>
      </div>
    </>
  );
}
