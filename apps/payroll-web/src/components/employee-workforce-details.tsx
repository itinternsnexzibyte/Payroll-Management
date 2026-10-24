'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FileText, Plus, Trash2 } from 'lucide-react';
import {
  Button,
  Card,
  DataTable,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Select,
  Spinner,
  Textarea,
  del,
  download,
  errorMessage,
  formatDate,
  formatDateTime,
  get,
  post,
  put,
  useToast,
} from '@nexzi/ui';

interface WorkforceProfile {
  teamsId: string | null;
  college: string | null;
  course: string | null;
  internshipRole: string | null;
  durationMonths: number | null;
}

interface EmployeeRating {
  id: string;
  ratingDate: string;
  rating: number;
  feedback: string | null;
  createdAt: string;
}

interface EmployeeDocument {
  id: string;
  category: 'OFFER_LETTER' | 'PROFILE_PHOTO' | 'OTHER';
  originalName: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
}

const emptyProfile: WorkforceProfile = { teamsId: null, college: null, course: null, internshipRole: null, durationMonths: null };
const today = () => new Date().toISOString().slice(0, 10);
const documentLabel = (category: EmployeeDocument['category']) => category === 'OFFER_LETTER' ? 'Offer letter' : category === 'PROFILE_PHOTO' ? 'Profile photo' : 'Other';

export function EmployeeWorkforceProfileTab({ employeeId, canManage }: { employeeId: string; canManage: boolean }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState<WorkforceProfile>(emptyProfile);
  const query = useQuery({ queryKey: ['employee-workforce-profile', employeeId], queryFn: () => get<WorkforceProfile | null>(`/employees/${employeeId}/workforce-profile`) });
  useEffect(() => {
    if (query.data) setForm(query.data);
    else if (query.isSuccess) setForm(emptyProfile);
  }, [query.data, query.isSuccess]);
  const save = useMutation({
    mutationFn: () => put(`/employees/${employeeId}/workforce-profile`, {
      ...form,
      teamsId: form.teamsId?.trim() || null,
      college: form.college?.trim() || null,
      course: form.course?.trim() || null,
      internshipRole: form.internshipRole?.trim() || null,
      durationMonths: form.durationMonths === null ? null : Number(form.durationMonths),
    }),
    onSuccess: () => {
      toast.success('Workforce profile saved.');
      void qc.invalidateQueries({ queryKey: ['employee-workforce-profile', employeeId] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  if (query.isLoading) return <Spinner />;
  if (query.error) return <ErrorState message={errorMessage(query.error)} onRetry={() => query.refetch()} />;
  const update = (key: keyof WorkforceProfile, value: string) => setForm((current) => ({ ...current, [key]: key === 'durationMonths' ? (value ? Number(value) : null) : value }));
  return (
    <Card title="Workforce profile">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Teams ID"><Input disabled={!canManage} value={form.teamsId ?? ''} onChange={(event) => update('teamsId', event.target.value)} maxLength={150} /></Field>
        <Field label="Internship role"><Input disabled={!canManage} value={form.internshipRole ?? ''} onChange={(event) => update('internshipRole', event.target.value)} maxLength={150} /></Field>
        <Field label="College"><Input disabled={!canManage} value={form.college ?? ''} onChange={(event) => update('college', event.target.value)} maxLength={200} /></Field>
        <Field label="Course"><Input disabled={!canManage} value={form.course ?? ''} onChange={(event) => update('course', event.target.value)} maxLength={150} /></Field>
        <Field label="Duration (months)"><Input disabled={!canManage} type="number" min={1} max={60} value={form.durationMonths ?? ''} onChange={(event) => update('durationMonths', event.target.value)} /></Field>
      </div>
      {canManage && <div className="mt-4 flex justify-end"><Button loading={save.isPending} onClick={() => save.mutate()}>Save workforce profile</Button></div>}
    </Card>
  );
}

export function EmployeeRatingsTab({ employeeId, canManage }: { employeeId: string; canManage: boolean }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [ratingDate, setRatingDate] = useState(today);
  const [rating, setRating] = useState('5');
  const [feedback, setFeedback] = useState('');
  const query = useQuery({ queryKey: ['employee-ratings', employeeId], queryFn: () => get<EmployeeRating[]>(`/employees/${employeeId}/ratings`) });
  const save = useMutation({
    mutationFn: () => put(`/employees/${employeeId}/ratings`, { ratingDate, rating: Number(rating), feedback: feedback.trim() || null }),
    onSuccess: () => {
      setFeedback('');
      toast.success('Evaluation saved.');
      void qc.invalidateQueries({ queryKey: ['employee-ratings', employeeId] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  return (
    <div className="space-y-5">
      {canManage && (
        <Card title="Record an evaluation">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Evaluation date" required><Input type="date" value={ratingDate} onChange={(event) => setRatingDate(event.target.value)} /></Field>
            <Field label="Rating (1–5)" required><Select value={rating} onChange={(event) => setRating(event.target.value)}>{[5, 4, 3, 2, 1].map((value) => <option key={value} value={value}>{value} / 5</option>)}</Select></Field>
          </div>
          <Field className="mt-4" label="Feedback"><Textarea value={feedback} onChange={(event) => setFeedback(event.target.value)} maxLength={5000} rows={3} /></Field>
          <div className="mt-4 flex justify-end"><Button icon={<Plus className="h-4 w-4" />} loading={save.isPending} onClick={() => save.mutate()}>Save evaluation</Button></div>
        </Card>
      )}
      <Card title="Evaluation history" padded={false}>
        {query.error ? <ErrorState message={errorMessage(query.error)} onRetry={() => query.refetch()} /> : (
          <DataTable<EmployeeRating>
            rows={query.data}
            loading={query.isLoading}
            rowKey={(row) => row.id}
            empty={<EmptyState title="No evaluations recorded" />}
            columns={[
              { key: 'date', header: 'Date', render: (row) => formatDate(row.ratingDate) },
              { key: 'rating', header: 'Rating', render: (row) => <strong>{row.rating} / 5</strong> },
              { key: 'feedback', header: 'Feedback', render: (row) => row.feedback ?? '—' },
              { key: 'updated', header: 'Updated', render: (row) => formatDateTime(row.createdAt) },
            ]}
          />
        )}
      </Card>
    </div>
  );
}

export function EmployeeDocumentsTab({ employeeId, canManage, canUploadProfilePhoto = false }: { employeeId: string; canManage: boolean; canUploadProfilePhoto?: boolean }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [category, setCategory] = useState<EmployeeDocument['category']>('OFFER_LETTER');
  const [file, setFile] = useState<File | null>(null);
  const query = useQuery({ queryKey: ['employee-documents', employeeId], queryFn: () => get<EmployeeDocument[]>(`/employees/${employeeId}/documents`) });
  const upload = useMutation({
    mutationFn: () => {
      if (!file) throw new Error('Choose a file to upload.');
      const form = new FormData();
      form.set('category', canManage ? category : 'PROFILE_PHOTO');
      form.set('file', file);
      return post<EmployeeDocument>(`/employees/${employeeId}/documents`, form);
    },
    onSuccess: () => {
      setFile(null);
      toast.success('Private employee document uploaded.');
      void qc.invalidateQueries({ queryKey: ['employee-documents', employeeId] });
      void qc.invalidateQueries({ queryKey: ['employee-photo', employeeId] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const remove = useMutation({
    mutationFn: (document: EmployeeDocument) => del(`/employee-documents/${document.id}`),
    onSuccess: () => {
      toast.success('Document deleted.');
      void qc.invalidateQueries({ queryKey: ['employee-documents', employeeId] });
      void qc.invalidateQueries({ queryKey: ['employee-photo', employeeId] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  return (
    <div className="space-y-5">
      {(canManage || canUploadProfilePhoto) && (
        <Card title="Upload a private document">
          <p className="mb-4 text-sm text-muted">PDF, PNG, JPEG and WebP files up to 5 MB are stored outside the public web directory.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            {canManage ? <Field label="Document type"><Select value={category} onChange={(event) => setCategory(event.target.value as EmployeeDocument['category'])}>
              <option value="OFFER_LETTER">Offer letter</option><option value="PROFILE_PHOTO">Profile photo</option><option value="OTHER">Other</option>
            </Select></Field> : <p className="self-center text-sm text-muted">You may upload or replace your own profile photo.</p>}
            <Field label="File"><Input type="file" accept={canManage ? '.pdf,.png,.jpg,.jpeg,.webp' : 'image/png,image/jpeg,image/webp'} onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></Field>
          </div>
          <div className="mt-4 flex justify-end"><Button disabled={!file} loading={upload.isPending} onClick={() => upload.mutate()}>Upload</Button></div>
        </Card>
      )}
      <Card title="Employee documents" padded={false}>
        {query.error ? <ErrorState message={errorMessage(query.error)} onRetry={() => query.refetch()} /> : (
          <DataTable<EmployeeDocument>
            rows={query.data}
            loading={query.isLoading}
            rowKey={(document) => document.id}
            empty={<EmptyState icon={<FileText className="h-6 w-6" />} title="No documents uploaded" />}
            columns={[
              { key: 'name', header: 'File', render: (document) => <span className="font-medium">{document.originalName}</span> },
              { key: 'category', header: 'Type', render: (document) => documentLabel(document.category) },
              { key: 'size', header: 'Size', render: (document) => `${Math.max(1, Math.ceil(document.sizeBytes / 1024))} KB` },
              { key: 'date', header: 'Uploaded', render: (document) => formatDateTime(document.createdAt) },
              {
                key: 'actions',
                header: '',
                align: 'right',
                render: (document) => <span className="flex justify-end gap-1">
                  <Button size="sm" variant="secondary" icon={<Download className="h-4 w-4" />} onClick={() => download(`/employee-documents/${document.id}/download`, document.originalName).catch((error) => toast.error(errorMessage(error)))}>Download</Button>
                  {canManage && <Button size="sm" variant="ghost" aria-label={`Delete ${document.originalName}`} icon={<Trash2 className="h-4 w-4" />} loading={remove.isPending} onClick={() => remove.mutate(document)} />}
                </span>,
              },
            ]}
          />
        )}
      </Card>
    </div>
  );
}

export function EmployeeProfilePhoto({ employeeId, employeeName }: { employeeId: string; employeeName: string }) {
  const photo = useQuery({
    queryKey: ['employee-photo', employeeId],
    queryFn: async () => (await get<EmployeeDocument[]>(`/employees/${employeeId}/documents`)).find((document) => document.category === 'PROFILE_PHOTO') ?? null,
  });
  if (photo.isLoading || !photo.data) return null;
  return (
    <div className="mb-4 flex items-center gap-3">
      <Image
        src={`/api/employee-documents/${photo.data.id}/preview`}
        alt={`${employeeName} profile`}
        width={72}
        height={72}
        unoptimized
        className="h-[72px] w-[72px] rounded-full border border-line object-cover"
      />
      <span className="text-sm text-muted">Profile photo</span>
    </div>
  );
}
