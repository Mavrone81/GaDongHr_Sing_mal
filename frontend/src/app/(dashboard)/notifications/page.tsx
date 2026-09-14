'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { PageHeader, Tabs, Card, Badge, Button, EmptyState, Icon } from '@/components/ui';

interface Notification {
  id: string;
  title: string;
  body: string;
  category?: string;
  link?: string;
  isRead: boolean;
  createdAt: string;
}

/**
 * Category is a topic, not a state: it is printed as a plain neutral Badge and
 * the word does the work. Unread-ness is what the eye needs to find, so that is
 * carried by the tinted row, the accent dot, the "New" Badge and the bolder
 * title — never by colour alone.
 */
const CATEGORY_LABEL: Record<string, string> = {
  PAYROLL: 'Payroll',
  LEAVE: 'Leave',
  ONBOARDING: 'Onboarding',
  ATTENDANCE: 'Attendance',
  COMPLIANCE: 'Compliance',
  PERFORMANCE: 'Performance',
  CLAIMS: 'Claims',
  SYSTEM: 'System',
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  const today    = new Date(); today.setHours(0,0,0,0);
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
  const dt = new Date(d); dt.setHours(0,0,0,0);
  if (dt.getTime() === today.getTime()) return 'Today';
  if (dt.getTime() === yesterday.getTime()) return 'Yesterday';
  return d.toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit' });
}

function groupByDate(notifs: Notification[]): { label: string; items: Notification[] }[] {
  const map = new Map<string, Notification[]>();
  for (const n of notifs) {
    const label = formatDate(n.createdAt);
    if (!map.has(label)) map.set(label, []);
    map.get(label)!.push(n);
  }
  return Array.from(map.entries()).map(([label, items]) => ({ label, items }));
}

export default function NotificationsPage() {
  const router = useRouter();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [markingAll, setMarkingAll] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = filter === 'unread' ? '?unread=true&limit=100' : '?limit=100';
      const data = await apiFetch(`/notifications/me${params}`);
      setNotifications(data);
    } catch {
      //
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  async function handleMarkRead(notif: Notification) {
    if (!notif.isRead) {
      try {
        await apiFetch(`/notifications/${notif.id}/read`, { method: 'PUT' });
        setNotifications(prev => prev.map(n => n.id === notif.id ? { ...n, isRead: true } : n));
      } catch { /* best-effort */ }
    }
    if (notif.link) router.push(notif.link);
  }

  async function markAllRead() {
    setMarkingAll(true);
    try {
      await apiFetch('/notifications/me/read-all', { method: 'PUT' });
      setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
    } catch { /* best-effort */ }
    setMarkingAll(false);
  }

  const unreadCount = notifications.filter(n => !n.isRead).length;
  const groups = groupByDate(notifications);

  return (
    <div className="flex flex-col gap-5 max-w-[760px] mx-auto w-full">
      <PageHeader
        title="Notifications"
        subtitle={unreadCount > 0 ? `${unreadCount} unread` : 'You are all caught up.'}
        actions={unreadCount > 0 ? (
          <Button variant="secondary" icon="check" onClick={markAllRead} disabled={markingAll}>
            {markingAll ? 'Marking…' : 'Mark all read'}
          </Button>
        ) : undefined}
      />

      <Tabs
        items={[{ id: 'all', label: 'All' }, { id: 'unread', label: 'Unread' }]}
        active={filter}
        onChange={setFilter}
      />

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-rule border-t-accent animate-spin rounded-full" role="status" aria-label="Loading notifications" />
        </div>
      ) : notifications.length === 0 ? (
        <Card padding="p-0">
          <EmptyState
            icon="bell"
            title={filter === 'unread' ? 'No unread notifications' : 'No notifications yet'}
            description={filter === 'unread'
              ? 'Everything has been read. Switch to All to see earlier notifications.'
              : 'Payroll, leave, claims and approval updates will appear here.'}
          />
        </Card>
      ) : (
        <div className="flex flex-col gap-5">
          {groups.map(({ label, items }) => (
            <section key={label} className="flex flex-col gap-2" aria-label={label}>
              <h2 className="text-[13px] font-semibold text-muted px-1">{label}</h2>
              <Card padding="p-0" className="overflow-hidden">
                {items.map((notif, i) => (
                  <button
                    key={notif.id}
                    type="button"
                    onClick={() => handleMarkRead(notif)}
                    className={`group w-full text-left flex items-start gap-3 px-4 py-3.5 sm:px-5 transition-colors ${i > 0 ? 'border-t border-rule' : ''} ${!notif.isRead ? 'bg-tint/50 hover:bg-tint' : 'hover:bg-page'}`}
                  >
                    <span
                      className={`mt-2 w-2 h-2 rounded-full shrink-0 ${!notif.isRead ? 'bg-accent' : 'bg-transparent'}`}
                      aria-hidden="true"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-2 flex-wrap min-w-0">
                          {notif.category && (
                            <Badge tone="neutral">{CATEGORY_LABEL[notif.category] ?? notif.category}</Badge>
                          )}
                          {!notif.isRead && <Badge tone="accent">New</Badge>}
                        </div>
                        <span className="text-xs text-faint shrink-0 tabular-nums">{formatTime(notif.createdAt)}</span>
                      </div>
                      <p className={`mt-1.5 text-sm leading-snug text-ink ${!notif.isRead ? 'font-bold' : 'font-semibold'}`}>
                        {notif.title}
                      </p>
                      <p className="mt-0.5 text-[13px] text-muted leading-relaxed">{notif.body}</p>
                      {notif.link && (
                        <span className="mt-1.5 inline-flex items-center gap-1 text-[13px] font-semibold text-accent group-hover:underline">
                          View details <Icon name="arrowRight" size={14} />
                        </span>
                      )}
                    </div>
                  </button>
                ))}
              </Card>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
