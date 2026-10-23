'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardList, Plus } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  DataTable,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  Input,
  PageHeader,
  RequirePermission,
  Select,
  Spinner,
  Textarea,
  errorMessage,
  formatDate,
  formatDateTime,
  get,
  post,
  put,
  useAuth,
  useToast,
} from '@nexzi/ui';
import { useEmployeeOptions } from '@/lib/hooks';

type AssignmentStatus = 'OPEN' | 'CLOSED';
type SubmissionStatus = 'SUBMITTED' | 'NEEDS_CHANGES' | 'ACCEPTED';
interface WorkSubmission {
  id: string;
  revision: number;
  submissionText: string | null;
  submissionUrl: string | null;
  status: SubmissionStatus;
  submittedAt: string;
  reviewedAt: string | null;
  reviewerFeedback: string | null;
}
interface WorkAssignment {
  id: string;
  employee: { id: string; employeeCode: string; fullName: string };
  title: string;
  description: string | null;
  dueDate: string | null;
  status: AssignmentStatus;
  submissions: WorkSubmission[];
}

const assignmentTone = { OPEN: 'success', CLOSED: 'neutral' } as const;
const assignmentLabel = { OPEN: 'Open', CLOSED: 'Closed' } as const;
const submissionTone = { SUBMITTED: 'warning', NEEDS_CHANGES: 'danger', ACCEPTED: 'success' } as const;
const submissionLabel = { SUBMITTED: 'Awaiting review', NEEDS_CHANGES: 'Changes requested', ACCEPTED: 'Accepted' } as const;

export default function AssignmentsPage() {
  return (
    <RequirePermission permission={['workforce.view', 'workforce.submit']}>
      <PageHeader
        title="Work assignments"
        description="Assign and review employee work, or submit work assigned to your linked employee account. Payroll calculations are not affected."
        breadcrumbs={[{ label: 'Dashboard', href: '/' }, { label: 'Work assignments' }]}
      />
      <AssignmentWorkspace />
    </RequirePermission>
  );
}

function AssignmentWorkspace() {
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [submitting, setSubmitting] = useState<WorkAssignment | null>(null);
  const [reviewing, setReviewing] = useState<WorkSubmission | null>(null);
  const managerView = can('workforce.view');
  const canSubmit = can('workforce.submit');
  const all = useQuery({
    queryKey: ['work-assignments'],
    queryFn: () => get<WorkAssignment[]>('/assignments'),
    enabled: managerView,
  });
  const mine = useQuery({
    queryKey: ['my-work-assignments'],
    queryFn: () => get<WorkAssignment[]>('/my/assignments'),
    enabled: canSubmit,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['work-assignments'] });
    qc.invalidateQueries({ queryKey: ['my-work-assignments'] });
  };
  const changeStatus = useMutation({
    mutationFn: ({ assignment, status }: { assignment: WorkAssignment; status: AssignmentStatus }) =>
      put(`/assignments/${assignment.id}`, { status }),
    onSuccess: () => { toast.success('Assignment updated.'); refresh(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const saveSubmission = useMutation({
    mutationFn: ({ assignment, submissionText, submissionUrl }: { assignment: WorkAssignment; submissionText: string; submissionUrl: string }) =>
      post(`/my/assignments/${assignment.id}/submissions`, {
        submissionText: submissionText.trim() || null,
        submissionUrl: submissionUrl.trim() || null,
      }),
    onSuccess: () => { toast.success('Work submitted for review.'); setSubmitting(null); refresh(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const saveReview = useMutation({
    mutationFn: ({ submission, status, reviewerFeedback }: { submission: WorkSubmission; status: 'ACCEPTED' | 'NEEDS_CHANGES'; reviewerFeedback: string }) =>
      put(`/assignments/submissions/${submission.id}/review`, { status, reviewerFeedback: reviewerFeedback.trim() || null }),
    onSuccess: () => { toast.success('Submission reviewed.'); setReviewing(null); refresh(); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if ((managerView && all.isLoading) || (canSubmit && mine.isLoading)) return <Spinner />;
  const error = (managerView && all.error) || (canSubmit && mine.error);
  if (error) return <ErrorState message={errorMessage(error)} onRetry={() => { all.refetch(); mine.refetch(); }} />;

  return (
    <div className="space-y-5">
      {managerView && (
        <Card padded={false} title="All assignments" actions={can('workforce.manage') && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>Assign work</Button>}>
          <AssignmentTable
            rows={all.data ?? []}
            emptyTitle="No assignments yet"
            emptyHint="Assign a task to an active employee to begin tracking submissions."
            canManage={can('workforce.manage')}
            canReview={can('workforce.review')}
            onChangeStatus={(assignment) => changeStatus.mutate({ assignment, status: assignment.status === 'OPEN' ? 'CLOSED' : 'OPEN' })}
            onReview={setReviewing}
          />
        </Card>
      )}
      {canSubmit && (
        <Card padded={false} title="My assigned work">
          <AssignmentTable
            rows={mine.data ?? []}
            emptyTitle="No work assigned"
            emptyHint="Assignments for your linked employee profile will appear here."
            onSubmit={setSubmitting}
          />
        </Card>
      )}
      {creating && <CreateAssignmentDialog onClose={() => setCreating(false)} onSaved={() => { setCreating(false); refresh(); }} />}
      {submitting && <SubmissionDialog assignment={submitting} loading={saveSubmission.isPending} onClose={() => setSubmitting(null)} onSubmit={(text, url) => saveSubmission.mutate({ assignment: submitting, submissionText: text, submissionUrl: url })} />}
      {reviewing && <ReviewDialog submission={reviewing} loading={saveReview.isPending} onClose={() => setReviewing(null)} onReview={(status, feedback) => saveReview.mutate({ submission: reviewing, status, reviewerFeedback: feedback })} />}
    </div>
  );
}

function AssignmentTable({
  rows,
  emptyTitle,
  emptyHint,
  canManage = false,
  canReview = false,
  onChangeStatus,
  onSubmit,
  onReview,
}: {
  rows: WorkAssignment[];
  emptyTitle: string;
  emptyHint: string;
  canManage?: boolean;
  canReview?: boolean;
  onChangeStatus?: (assignment: WorkAssignment) => void;
  onSubmit?: (assignment: WorkAssignment) => void;
  onReview?: (submission: WorkSubmission) => void;
}) {
  return (
    <DataTable<WorkAssignment>
      rows={rows}
      rowKey={(assignment) => assignment.id}
      empty={<EmptyState icon={<ClipboardList className="h-6 w-6" />} title={emptyTitle} hint={emptyHint} />}
      columns={[
        ...(canManage ? [{ key: 'employee', header: 'Employee', render: (assignment: WorkAssignment) => <><span className="block font-medium">{assignment.employee.employeeCode}</span><span className="text-xs text-muted">{assignment.employee.fullName}</span></> }] : []),
        {
          key: 'task',
          header: 'Assignment',
          render: (assignment) => <><span className="block font-medium">{assignment.title}</span>{assignment.description && <span className="mt-1 block max-w-xl whitespace-pre-wrap text-xs text-muted">{assignment.description}</span>}</>,
        },
        { key: 'due', header: 'Due date', render: (assignment) => assignment.dueDate ? formatDate(assignment.dueDate) : '—' },
        { key: 'status', header: 'Status', render: (assignment) => <Badge tone={assignmentTone[assignment.status]}>{assignmentLabel[assignment.status]}</Badge> },
        {
          key: 'submission',
          header: 'Latest submission',
          render: (assignment) => {
            const submission = assignment.submissions[0];
            if (!submission) return <span className="text-muted">Not submitted</span>;
            return (
              <div className="max-w-sm space-y-1">
                <Badge tone={submissionTone[submission.status]}>{submissionLabel[submission.status]} · v{submission.revision}</Badge>
                {submission.submissionText && <p className="whitespace-pre-wrap text-xs">{submission.submissionText}</p>}
                {submission.submissionUrl && <a className="block truncate text-xs text-accent underline" href={submission.submissionUrl} target="_blank" rel="noreferrer">Open submission link</a>}
                {submission.reviewerFeedback && <p className="text-xs text-muted">Review: {submission.reviewerFeedback}</p>}
                <span className="block text-xs text-muted">{formatDateTime(submission.submittedAt)}</span>
              </div>
            );
          },
        },
        {
          key: 'actions',
          header: '',
          align: 'right',
          render: (assignment) => {
            const latest = assignment.submissions[0];
            return (
              <div className="flex justify-end gap-1">
                {canManage && onChangeStatus && <Button size="sm" variant="secondary" onClick={() => onChangeStatus(assignment)}>{assignment.status === 'OPEN' ? 'Close' : 'Reopen'}</Button>}
                {canReview && latest?.status === 'SUBMITTED' && onReview && <Button size="sm" onClick={() => onReview(latest)}>Review</Button>}
                {onSubmit && assignment.status === 'OPEN' && latest?.status !== 'SUBMITTED' && latest?.status !== 'ACCEPTED' && <Button size="sm" onClick={() => onSubmit(assignment)}>{latest ? 'Resubmit' : 'Submit work'}</Button>}
              </div>
            );
          },
        },
      ]}
    />
  );
}

function CreateAssignmentDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const employees = useEmployeeOptions();
  const [employeeId, setEmployeeId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState('');
  const create = useMutation({
    mutationFn: () => post('/assignments', { employeeId, title: title.trim(), description: description.trim() || null, dueDate: dueDate || null }),
    onSuccess: onSaved,
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog open onClose={onClose} title="Assign work" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={create.isPending} disabled={!employeeId || title.trim().length < 2} onClick={() => create.mutate()}>Assign</Button></>}>
      <div className="space-y-3">
        <Field label="Employee" htmlFor="assignment-employee" required>
          <Select id="assignment-employee" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
            <option value="">Choose an active employee…</option>
            {employees.data?.items.map((employee) => <option key={employee.id} value={employee.id}>{employee.employeeCode} · {employee.fullName}</option>)}
          </Select>
        </Field>
        <Field label="Title" htmlFor="assignment-title" required><Input id="assignment-title" maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <Field label="Description"><Textarea rows={4} maxLength={10000} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        <Field label="Due date" htmlFor="assignment-due"><Input id="assignment-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></Field>
      </div>
    </Dialog>
  );
}

function SubmissionDialog({ assignment, loading, onClose, onSubmit }: { assignment: WorkAssignment; loading: boolean; onClose: () => void; onSubmit: (text: string, url: string) => void }) {
  const [text, setText] = useState('');
  const [url, setUrl] = useState('');
  return (
    <Dialog open onClose={onClose} title={`Submit work — ${assignment.title}`} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={loading} disabled={!text.trim() && !url.trim()} onClick={() => onSubmit(text, url)}>Submit for review</Button></>}>
      <div className="space-y-3">
        <p className="text-sm text-muted">Provide a written response, an HTTPS link, or both. File uploads are not enabled.</p>
        <Field label="Submission text"><Textarea rows={5} maxLength={10000} value={text} onChange={(e) => setText(e.target.value)} /></Field>
        <Field label="Link" htmlFor="submission-url"><Input id="submission-url" type="url" maxLength={500} placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} /></Field>
      </div>
    </Dialog>
  );
}

function ReviewDialog({ submission, loading, onClose, onReview }: { submission: WorkSubmission; loading: boolean; onClose: () => void; onReview: (status: 'ACCEPTED' | 'NEEDS_CHANGES', feedback: string) => void }) {
  const [status, setStatus] = useState<'ACCEPTED' | 'NEEDS_CHANGES'>('ACCEPTED');
  const [feedback, setFeedback] = useState('');
  return (
    <Dialog open onClose={onClose} title="Review submission" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={loading} disabled={status === 'NEEDS_CHANGES' && feedback.trim().length < 2} onClick={() => onReview(status, feedback)}>{status === 'ACCEPTED' ? 'Accept' : 'Request changes'}</Button></>}>
      <div className="space-y-3">
        {submission.submissionText && <p className="whitespace-pre-wrap text-sm">{submission.submissionText}</p>}
        {submission.submissionUrl && <a className="break-all text-sm text-accent underline" href={submission.submissionUrl} target="_blank" rel="noreferrer">Open submission link</a>}
        <Field label="Decision" htmlFor="submission-decision">
          <Select id="submission-decision" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            <option value="ACCEPTED">Accept</option><option value="NEEDS_CHANGES">Request changes</option>
          </Select>
        </Field>
        <Field label={status === 'NEEDS_CHANGES' ? 'Required feedback' : 'Feedback'}><Textarea rows={4} maxLength={5000} value={feedback} onChange={(e) => setFeedback(e.target.value)} /></Field>
      </div>
    </Dialog>
  );
}
