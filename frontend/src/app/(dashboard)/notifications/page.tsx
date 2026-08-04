'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';

interface Notification {
  id: string;
  title: string;
  body: string;
  category?: string;
  link?: string;
  isRead: boolean;
  createdAt: string;
}

const CATEGORY_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  PAYROLL:     { bg: 'bg-page border-accent', text: 'text-accent', dot: 'bg-accent' },
  LEAVE:       { bg: 'bg-page border-accent',     text: 'text-accent',   dot: 'bg-accent'   },
  ONBOARDING:  { bg: 'bg-page border-accent', text: 'text-accent', dot: 'bg-accent' },
  ATTENDANCE:  { bg: 'bg-page border-highlight',   text: 'text-ink',  dot: 'bg-highlight'  },
  COMPLIANCE:  { bg: 'bg-page border-ink',       text: 'text-ink',    dot: 'bg-ink'    },
  PERFORMANCE: { bg: 'bg-page border-accent', text: 'text-accent', dot: 'bg-accent' },
  CLAIMS:      { bg: 'bg-page border-accent',       text: 'text-accent',    dot: 'bg-accent'    },
  SYSTEM:      { bg: 'bg-page border-rule',   text: 'text-ink',  dot: 'bg-muted'  },
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
    <div className="max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-black text-ink uppercase tracking-widest">Notifications</h1>
          {unreadCount > 0 && (
            <p className="text-[10px] font-bold text-muted mt-0.5 uppercase tracking-wider">
              {unreadCount} unread
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          {/* Filter tabs */}
          <div className="flex bg-page p-1 gap-0.5">
            {(['all', 'unread'] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1.5  text-[10px] font-black uppercase tracking-wider transition-all ${
                  filter === f
                    ? 'bg-paper text-ink '
                    : 'text-muted hover:text-ink'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
          {unreadCount > 0 && (
            <button
              onClick={markAllRead}
              disabled={markingAll}
              className="px-3 py-1.5 text-[10px] font-black text-accent border border-accent uppercase tracking-wider hover:bg-page transition-colors disabled:opacity-50"
            >
              {markingAll ? 'Marking…' : 'Mark all read'}
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-accent border-t-accent animate-spin rounded-full" />
        </div>
      ) : notifications.length === 0 ? (
        <div className="text-center py-20">
          <div className="w-16 h-16 bg-page flex items-center justify-center mx-auto mb-4">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-muted">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
              <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
            </svg>
          </div>
          <p className="text-[11px] font-black text-muted uppercase tracking-widest">
            {filter === 'unread' ? 'No unread notifications' : 'No notifications yet'}
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map(({ label, items }) => (
            <div key={label}>
              <p className="text-[9px] font-black text-muted uppercase tracking-[0.3em] mb-2 px-1">{label}</p>
              <div className="space-y-1">
                {items.map(notif => {
                  const colors = CATEGORY_COLORS[notif.category ?? 'SYSTEM'] ?? CATEGORY_COLORS.SYSTEM;
                  return (
                    <button
                      key={notif.id}
                      onClick={() => handleMarkRead(notif)}
                      className={`w-full text-left p-4  border transition-all hover: group ${
                        !notif.isRead
                          ? `${colors.bg} border-opacity-80`
                          : 'bg-paper border-rule hover:border-rule'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        {/* Category dot */}
                        <div className={`mt-1.5 w-2 h-2  shrink-0 ${!notif.isRead ? colors.dot : 'bg-rule'}`} />

                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2 mb-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              {notif.category && (
                                <span className={`text-[8px] font-black uppercase tracking-wider px-1.5 py-0.5  ${colors.bg} ${colors.text} border`}>
                                  {notif.category}
                                </span>
                              )}
                              {!notif.isRead && (
                                <span className="text-[8px] font-black text-accent uppercase tracking-wider">New</span>
                              )}
                            </div>
                            <span className="text-[9px] text-muted shrink-0">{formatTime(notif.createdAt)}</span>
                          </div>
                          <p className={`text-[12px] font-bold leading-snug mb-1 ${!notif.isRead ? 'text-ink' : 'text-ink'}`}>
                            {notif.title}
                          </p>
                          <p className="text-[11px] text-muted leading-relaxed">
                            {notif.body}
                          </p>
                          {notif.link && (
                            <p className={`text-[9px] font-bold mt-1.5 uppercase tracking-wider ${colors.text} group-hover:underline`}>
                              View details →
                            </p>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
