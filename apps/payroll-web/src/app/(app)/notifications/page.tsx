'use client';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCheck } from 'lucide-react';
import { Badge, Button, Card, EmptyState, ErrorState, PageHeader, RequirePermission, Spinner, errorMessage, formatDateTime, get, post, useToast } from '@nexzi/ui';

interface NotificationItem {
  id: string;
  title: string;
  message: string;
  kind: string;
  targetUrl: string | null;
  isRead: boolean;
  createdAt: string;
}
interface NotificationList {
  unreadCount: number;
  items: NotificationItem[];
}

export default function NotificationsPage() {
  return (
    <RequirePermission permission="notifications.view">
      <PageHeader title="Notifications" description="Updates for your linked employee profile. Notifications never include payroll amounts." breadcrumbs={[{ label: 'Dashboard', href: '/' }, { label: 'Notifications' }]} />
      <NotificationWorkspace />
    </RequirePermission>
  );
}

function NotificationWorkspace() {
  const toast = useToast();
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ['employee-notifications'], queryFn: () => get<NotificationList>('/employee-notifications') });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['employee-notifications'] });
    qc.invalidateQueries({ queryKey: ['notifications'] });
  };
  const readOne = useMutation({
    mutationFn: (item: NotificationItem) => post(`/notifications/${item.id}/read`, {}),
    onSuccess: refresh,
    onError: (e) => toast.error(errorMessage(e)),
  });
  const readAll = useMutation({
    mutationFn: () => post<{ updated: number }>('/notifications/read-all', {}),
    onSuccess: (result) => { toast.success(`${result.updated} notification${result.updated === 1 ? '' : 's'} marked as read.`); refresh(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (query.isLoading) return <Spinner />;
  if (query.error) return <ErrorState message={errorMessage(query.error)} onRetry={() => query.refetch()} />;
  const data = query.data!;
  return (
    <Card title={`Inbox · ${data.unreadCount} unread`} actions={data.unreadCount > 0 && <Button size="sm" variant="secondary" icon={<CheckCheck className="h-4 w-4" />} loading={readAll.isPending} onClick={() => readAll.mutate()}>Mark all read</Button>}>
      {data.items.length === 0 ? (
        <EmptyState icon={<Bell className="h-6 w-6" />} title="No notifications" hint="Calendar updates and relevant work assignment changes will appear here." />
      ) : (
        <ul className="divide-y divide-line">
          {data.items.map((item) => (
            <li key={item.id} className="flex items-start gap-3 py-4 first:pt-0 last:pb-0">
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${item.isRead ? 'bg-line' : 'bg-accent'}`} aria-label={item.isRead ? 'Read' : 'Unread'} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2"><h2 className="font-medium text-ink">{item.title}</h2><Badge tone="neutral">{item.kind.replaceAll('_', ' ').toLowerCase()}</Badge></div>
                <p className="mt-1 whitespace-pre-wrap text-sm text-muted">{item.message}</p>
                <p className="mt-1 text-xs text-muted">{formatDateTime(item.createdAt)}</p>
                {item.targetUrl && <Link className="mt-2 inline-block text-sm text-accent underline" href={item.targetUrl}>Open related page</Link>}
              </div>
              {!item.isRead && <Button size="sm" variant="ghost" loading={readOne.isPending && readOne.variables?.id === item.id} onClick={() => readOne.mutate(item)}>Mark read</Button>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
