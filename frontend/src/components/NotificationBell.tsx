'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { Badge, Icon } from '@/components/ui';

type BadgeTone = 'neutral' | 'ok' | 'warn' | 'danger' | 'accent' | 'brass';

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
 * Eight notification categories, eight distinguishable chips.
 *
 * This was eight hues; mapped onto the tokens it became two appearances, so
 * six of the eight categories stopped being distinguishable in the dropdown.
 * Varying fill and border restores the distinction without inventing colour.
 *
 * COMPLIANCE is the one that is filled: a compliance notice is the only
 * category here with a statutory deadline behind it, and it should be the
 * thing the eye lands on first. The category name is printed inside every
 * chip regardless, so nothing rests on telling the shades apart.
 */
const CATEGORY_TONES: Record<string, BadgeTone> = {
  COMPLIANCE:  'danger',
  PAYROLL:     'accent',
  LEAVE:       'ok',
  ATTENDANCE:  'neutral',
  CLAIMS:      'warn',
  PERFORMANCE: 'brass',
  ONBOARDING:  'accent',
  SYSTEM:      'neutral',
};

function timeAgo(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60)  return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default function NotificationBell() {
  const router = useRouter();
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchUnreadCount = useCallback(async () => {
    try {
      const data = await apiFetch('/notifications/me/unread-count');
      setUnreadCount(data.count ?? 0);
    } catch {
      // silently ignore — bell is non-critical
    }
  }, []);

  const fetchNotifications = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch('/notifications/me?limit=10');
      setNotifications(data);
    } catch {
      //
    } finally {
      setLoading(false);
    }
  }, []);

  // Poll unread count every 30 seconds
  useEffect(() => {
    fetchUnreadCount();
    intervalRef.current = setInterval(fetchUnreadCount, 30_000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [fetchUnreadCount]);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isOpen]);

  function openDropdown() {
    setIsOpen(v => !v);
    if (!isOpen) fetchNotifications();
  }

  async function markRead(notif: Notification) {
    if (!notif.isRead) {
      try {
        await apiFetch(`/notifications/${notif.id}/read`, { method: 'PUT' });
        setNotifications(prev => prev.map(n => n.id === notif.id ? { ...n, isRead: true } : n));
        setUnreadCount(c => Math.max(0, c - 1));
      } catch { /* best-effort */ }
    }
    setIsOpen(false);
    if (notif.link) router.push(notif.link);
  }

  async function markAllRead() {
    try {
      await apiFetch('/notifications/me/read-all', { method: 'PUT' });
      setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
      setUnreadCount(0);
    } catch { /* best-effort */ }
  }

  return (
    <div ref={dropdownRef} className="relative">
      <button
        onClick={openDropdown}
        className="relative w-9 h-9 flex items-center justify-center rounded-control text-ink hover:bg-page transition-colors"
        aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
        aria-expanded={isOpen}
      >
        <Icon name="bell" size={20} />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-danger text-white text-xs font-bold flex items-center justify-center leading-none">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 top-11 w-[360px] max-w-[calc(100vw-2rem)] bg-paper border border-rule rounded-card shadow-card z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 h-12 border-b border-rule">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-ink">Notifications</span>
              {unreadCount > 0 && <Badge tone="danger">{unreadCount} new</Badge>}
            </div>
            {unreadCount > 0 && (
              <button onClick={markAllRead} className="text-[13px] font-semibold text-accent hover:underline">
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <div className="w-5 h-5 border-2 border-rule border-t-accent animate-spin rounded-full" />
              </div>
            ) : notifications.length === 0 ? (
              <div className="py-10 px-6 text-center">
                <p className="text-sm font-semibold text-ink">You&apos;re all caught up</p>
                <p className="text-[13px] text-muted mt-1">New approvals, payroll and compliance notices will appear here.</p>
              </div>
            ) : (
              notifications.map(notif => (
                <button
                  key={notif.id}
                  onClick={() => markRead(notif)}
                  className={`w-full text-left px-4 py-3 border-b border-rule hover:bg-page transition-colors ${!notif.isRead ? 'bg-tint/40' : ''}`}
                >
                  <div className="flex items-start gap-2.5">
                    <div className={`mt-2 w-2 h-2 rounded-full shrink-0 ${!notif.isRead ? 'bg-accent' : 'bg-transparent'}`} aria-hidden="true" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        {notif.category && <Badge tone={CATEGORY_TONES[notif.category] ?? 'neutral'}>{notif.category.charAt(0) + notif.category.slice(1).toLowerCase()}</Badge>}
                        <span className="text-xs text-faint ml-auto shrink-0">{timeAgo(notif.createdAt)}</span>
                      </div>
                      <p className={`text-sm leading-snug truncate ${!notif.isRead ? 'font-bold text-ink' : 'font-medium text-ink'}`}>
                        {notif.title}
                      </p>
                      <p className="text-[13px] text-muted leading-snug mt-0.5 line-clamp-2">
                        {notif.body}
                      </p>
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>

          <div className="px-4 h-11 flex items-center bg-page border-t border-rule">
            <button
              onClick={() => { setIsOpen(false); router.push('/notifications'); }}
              className="w-full flex items-center justify-center gap-1.5 text-[13px] font-semibold text-accent hover:underline"
            >
              View all notifications <Icon name="arrowRight" size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
