'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FileText, Pencil, Plus, Trash2, Upload } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  DataTable,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  Input,
  PageHeader,
  RequirePermission,
  SearchInput,
  Select,
  Spinner,
  Textarea,
  del,
  download,
  errorMessage,
  get,
  post,
  put,
  useAuth,
  useToast,
} from '@nexzi/ui';

type ClientAvailability = 'AVAILABLE' | 'UNAVAILABLE';
type ClientDocumentCategory = 'PHOTO' | 'AADHAAR' | 'MOU';

interface ClientRecord {
  id: string;
  clientName: string;
  phoneCountryCode: string | null;
  phoneNumber: string | null;
  country: string | null;
  stateRegion: string | null;
  city: string | null;
  address: string | null;
  availability: ClientAvailability;
  availableFrom: string | null;
  availableTo: string | null;
  referenceEmail: string | null;
  notes: string | null;
}

interface ClientDocument {
  id: string;
  clientId: string;
  category: ClientDocumentCategory;
  originalName: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
}

type ClientForm = Omit<ClientRecord, 'id'>;
const blankForm: ClientForm = {
  clientName: '',
  phoneCountryCode: '',
  phoneNumber: '',
  country: '',
  stateRegion: '',
  city: '',
  address: '',
  availability: 'AVAILABLE',
  availableFrom: '',
  availableTo: '',
  referenceEmail: '',
  notes: '',
};
const categoryLabel: Record<ClientDocumentCategory, string> = { PHOTO: 'Photo', AADHAAR: 'Identity document', MOU: 'MOU / agreement' };

export default function ClientsPage() {
  return (
    <RequirePermission permission="clients.view">
      <ClientWorkspace />
    </RequirePermission>
  );
}

function ClientWorkspace() {
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<ClientRecord | null>(null);
  const [creating, setCreating] = useState(false);
  const [documentsFor, setDocumentsFor] = useState<ClientRecord | null>(null);
  const [deleting, setDeleting] = useState<ClientRecord | null>(null);
  const clients = useQuery({ queryKey: ['clients'], queryFn: () => get<ClientRecord[]>('/clients') });
  const rows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (clients.data ?? []).filter((client) => !query || [client.clientName, client.country, client.stateRegion, client.city, client.referenceEmail].some((value) => value?.toLowerCase().includes(query)));
  }, [clients.data, search]);
  const refresh = () => qc.invalidateQueries({ queryKey: ['clients'] });
  const remove = useMutation({
    mutationFn: (client: ClientRecord) => del(`/clients/${client.id}`),
    onSuccess: () => { setDeleting(null); setDocumentsFor(null); toast.success('Client and its private documents deleted.'); refresh(); },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <>
      <PageHeader
        title="Clients"
        description="Manage client details and availability. Identity and agreement files are encrypted at rest and access is separately permissioned."
        breadcrumbs={[{ label: 'Dashboard', href: '/' }, { label: 'Clients' }]}
        actions={can('clients.manage') && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>Add client</Button>}
      />
      <Card padded={false}>
        <div className="border-b border-line p-4">
          <SearchInput value={search} onChange={setSearch} placeholder="Search clients" label="Search clients" />
        </div>
        {clients.isLoading ? <Spinner /> : clients.error ? <ErrorState message={errorMessage(clients.error)} onRetry={() => clients.refetch()} /> : (
          <DataTable<ClientRecord>
            rows={rows}
            rowKey={(client) => client.id}
            empty={<EmptyState title={search ? 'No clients match your search' : 'No clients added'} hint={can('clients.manage') ? 'Add a client record to track details and availability.' : undefined} />}
            columns={[
              { key: 'name', header: 'Client', render: (client) => <span className="font-medium">{client.clientName}</span> },
              { key: 'location', header: 'Location', render: (client) => [client.city, client.stateRegion, client.country].filter(Boolean).join(', ') || '—' },
              { key: 'contact', header: 'Contact', render: (client) => <>{client.phoneNumber ? `${client.phoneCountryCode ?? ''} ${client.phoneNumber}` : '—'}{client.referenceEmail && <span className="block text-xs text-muted">{client.referenceEmail}</span>}</> },
              { key: 'availability', header: 'Availability', render: (client) => <><Badge tone={client.availability === 'AVAILABLE' ? 'success' : 'neutral'}>{client.availability === 'AVAILABLE' ? 'Available' : 'Unavailable'}</Badge>{client.availability === 'AVAILABLE' && client.availableFrom && <span className="mt-1 block text-xs text-muted">{client.availableFrom}–{client.availableTo}</span>}</> },
              {
                key: 'actions',
                header: '',
                align: 'right',
                render: (client) => <span className="flex justify-end gap-1">
                  <Button size="sm" variant="secondary" onClick={() => setDocumentsFor(client)} icon={<FileText className="h-4 w-4" />}>Documents</Button>
                  {can('clients.manage') && <>
                    <Button size="sm" variant="ghost" aria-label={`Edit ${client.clientName}`} onClick={() => setEditing(client)} icon={<Pencil className="h-4 w-4" />} />
                    <Button size="sm" variant="ghost" aria-label={`Delete ${client.clientName}`} onClick={() => setDeleting(client)} icon={<Trash2 className="h-4 w-4" />} />
                  </>}
                </span>,
              },
            ]}
          />
        )}
      </Card>
      {(creating || editing) && <ClientDialog client={editing} onClose={() => { setCreating(false); setEditing(null); }} onSaved={() => { setCreating(false); setEditing(null); refresh(); }} />}
      {documentsFor && <ClientDocumentsDialog client={documentsFor} canManage={can('clients.manage')} canViewSensitive={can('clients.sensitive.view')} onClose={() => setDocumentsFor(null)} />}
      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting)}
        loading={remove.isPending}
        title="Delete client"
        message={deleting ? `Delete ${deleting.clientName} and all associated private documents? This cannot be undone.` : ''}
        confirmLabel="Delete client"
        tone="danger"
      />
    </>
  );
}

function ClientDialog({ client, onClose, onSaved }: { client: ClientRecord | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState<ClientForm>(() => client ? {
    clientName: client.clientName,
    phoneCountryCode: client.phoneCountryCode ?? '',
    phoneNumber: client.phoneNumber ?? '',
    country: client.country ?? '',
    stateRegion: client.stateRegion ?? '',
    city: client.city ?? '',
    address: client.address ?? '',
    availability: client.availability,
    availableFrom: client.availableFrom ?? '',
    availableTo: client.availableTo ?? '',
    referenceEmail: client.referenceEmail ?? '',
    notes: client.notes ?? '',
  } : blankForm);
  const save = useMutation({
    mutationFn: () => {
      const body = { ...form, clientName: form.clientName.trim(), availableFrom: form.availability === 'AVAILABLE' ? form.availableFrom || null : null, availableTo: form.availability === 'AVAILABLE' ? form.availableTo || null : null };
      return client ? put(`/clients/${client.id}`, body) : post('/clients', body);
    },
    onSuccess: onSaved,
    onError: (error) => toast.error(errorMessage(error)),
  });
  const invalidTimeRange = form.availability === 'AVAILABLE'
    && Boolean(form.availableFrom)
    && Boolean(form.availableTo)
    && form.availableFrom! >= form.availableTo!;
  const update = (field: keyof ClientForm, value: string) => setForm((current) => ({ ...current, [field]: value }));
  return (
    <Dialog open onClose={onClose} title={client ? 'Edit client' : 'Add client'} width="lg" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={save.isPending} disabled={!form.clientName.trim() || (form.availability === 'AVAILABLE' && Boolean(form.availableFrom) !== Boolean(form.availableTo)) || invalidTimeRange} onClick={() => save.mutate()}>{client ? 'Save changes' : 'Create client'}</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Client name" htmlFor="client-name" required><Input id="client-name" value={form.clientName} maxLength={200} onChange={(event) => update('clientName', event.target.value)} /></Field>
        <Field label="Availability" htmlFor="client-availability"><Select id="client-availability" value={form.availability} onChange={(event) => update('availability', event.target.value)}><option value="AVAILABLE">Available</option><option value="UNAVAILABLE">Unavailable</option></Select></Field>
        <Field label="Phone country code" htmlFor="client-phone-country-code"><Input id="client-phone-country-code" value={form.phoneCountryCode ?? ''} maxLength={10} onChange={(event) => update('phoneCountryCode', event.target.value)} /></Field>
        <Field label="Phone number" htmlFor="client-phone-number"><Input id="client-phone-number" value={form.phoneNumber ?? ''} maxLength={30} onChange={(event) => update('phoneNumber', event.target.value)} /></Field>
        <Field label="Country" htmlFor="client-country"><Input id="client-country" value={form.country ?? ''} maxLength={100} onChange={(event) => update('country', event.target.value)} /></Field>
        <Field label="State / region" htmlFor="client-state-region"><Input id="client-state-region" value={form.stateRegion ?? ''} maxLength={150} onChange={(event) => update('stateRegion', event.target.value)} /></Field>
        <Field label="City" htmlFor="client-city"><Input id="client-city" value={form.city ?? ''} maxLength={150} onChange={(event) => update('city', event.target.value)} /></Field>
        <Field label="Reference email" htmlFor="client-reference-email"><Input id="client-reference-email" type="email" value={form.referenceEmail ?? ''} maxLength={255} onChange={(event) => update('referenceEmail', event.target.value)} /></Field>
        {form.availability === 'AVAILABLE' && <>
          <Field label="Available from" htmlFor="client-available-from"><Input id="client-available-from" type="time" value={form.availableFrom ?? ''} onChange={(event) => update('availableFrom', event.target.value)} /></Field>
          <Field label="Available to" htmlFor="client-available-to"><Input id="client-available-to" type="time" value={form.availableTo ?? ''} onChange={(event) => update('availableTo', event.target.value)} /></Field>
        </>}
        <Field className="sm:col-span-2" label="Address" htmlFor="client-address"><Textarea id="client-address" rows={2} maxLength={5000} value={form.address ?? ''} onChange={(event) => update('address', event.target.value)} /></Field>
        <Field className="sm:col-span-2" label="Notes" htmlFor="client-notes"><Textarea id="client-notes" rows={3} maxLength={10000} value={form.notes ?? ''} onChange={(event) => update('notes', event.target.value)} /></Field>
      </div>
      {invalidTimeRange && <p role="alert" className="mt-2 text-sm text-danger">Availability end time must be after the start time.</p>}
    </Dialog>
  );
}

function ClientDocumentsDialog({ client, canManage, canViewSensitive, onClose }: { client: ClientRecord; canManage: boolean; canViewSensitive: boolean; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [category, setCategory] = useState<ClientDocumentCategory>('PHOTO');
  const [file, setFile] = useState<File | null>(null);
  const [deleting, setDeleting] = useState<ClientDocument | null>(null);
  const docs = useQuery({ queryKey: ['client-documents', client.id], queryFn: () => get<ClientDocument[]>(`/clients/${client.id}/documents`) });
  const upload = useMutation({
    mutationFn: () => {
      if (!file) throw new Error('Choose a file first.');
      const form = new FormData();
      form.set('category', category);
      form.set('file', file);
      return post(`/clients/${client.id}/documents`, form);
    },
    onSuccess: () => { setFile(null); toast.success('Encrypted client document uploaded.'); void qc.invalidateQueries({ queryKey: ['client-documents', client.id] }); },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const remove = useMutation({
    mutationFn: (document: ClientDocument) => del(`/client-documents/${document.id}`),
    onSuccess: () => { setDeleting(null); toast.success('Document deleted.'); void qc.invalidateQueries({ queryKey: ['client-documents', client.id] }); },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const saveDownload = async (document: ClientDocument) => {
    try { await download(`/client-documents/${document.id}/download`, document.originalName); }
    catch (error) { toast.error(errorMessage(error)); }
  };
  return (
    <Dialog open onClose={onClose} title={`Client documents · ${client.clientName}`} width="lg">
      {canManage && <Card title="Upload a private document" className="mb-5">
        <div className="grid gap-3 sm:grid-cols-[1fr_2fr_auto] sm:items-end">
          <Field label="Document type" htmlFor="client-document-type"><Select id="client-document-type" value={category} onChange={(event) => setCategory(event.target.value as ClientDocumentCategory)}><option value="PHOTO">Client photo</option><option value="AADHAAR">Identity document</option><option value="MOU">MOU / agreement</option></Select></Field>
          <Field label="PDF or image (maximum 5 MB)" htmlFor="client-document-file"><Input id="client-document-file" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></Field>
          <Button icon={<Upload className="h-4 w-4" />} loading={upload.isPending} disabled={!file} onClick={() => upload.mutate()}>Upload</Button>
        </div>
        <p className="mt-3 text-xs text-muted">Identity and agreement files are encrypted at rest. Access is audited and requires the sensitive-documents permission.</p>
      </Card>}
      <Card title="Stored documents" padded={false}>
        {docs.isLoading ? <Spinner /> : docs.error ? <ErrorState message={errorMessage(docs.error)} onRetry={() => docs.refetch()} /> : (
          <DataTable<ClientDocument>
            rows={docs.data ?? []}
            rowKey={(document) => document.id}
            empty={<EmptyState title="No documents uploaded" />}
            columns={[
              { key: 'type', header: 'Type', render: (document) => <Badge tone={document.category === 'PHOTO' ? 'info' : 'warning'}>{categoryLabel[document.category]}</Badge> },
              { key: 'name', header: 'File', render: (document) => document.originalName },
              { key: 'size', header: 'Size', align: 'right', render: (document) => `${Math.max(1, Math.round(document.sizeBytes / 1024))} KB` },
              { key: 'actions', header: '', align: 'right', render: (document) => <span className="flex justify-end gap-1">
                {(document.category === 'PHOTO' || canViewSensitive) && <Button size="sm" variant="secondary" aria-label={`Download ${document.originalName}`} icon={<Download className="h-4 w-4" />} onClick={() => void saveDownload(document)} />}
                {canManage && <Button size="sm" variant="ghost" aria-label={`Delete ${document.originalName}`} icon={<Trash2 className="h-4 w-4" />} onClick={() => setDeleting(document)} />}
              </span> },
            ]}
          />
        )}
      </Card>
      <ConfirmDialog open={Boolean(deleting)} onClose={() => setDeleting(null)} onConfirm={() => deleting && remove.mutate(deleting)} loading={remove.isPending} title="Delete private document" message={deleting ? `Delete ${deleting.originalName}?` : ''} confirmLabel="Delete document" tone="danger" />
    </Dialog>
  );
}
