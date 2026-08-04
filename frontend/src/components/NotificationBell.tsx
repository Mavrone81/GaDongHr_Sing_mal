'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
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
const CATEGORY_COLORS: Record<string, string> = {
  COMPLIANCE:  'bg-ink text-paper',
  PAYROLL:     'bg-accent text-paper',
  LEAVE:       'bg-paper text-accent border border-accent',
  ATTENDANCE:  'bg-paper text-ink border border-ink',
  CLAIMS:      'bg-paper text-ink border border-highlight',
  PERFORMANCE: 'bg-highlight text-ink',
  ONBOARDING:  'bg-page text-accent',
  SYSTEM:      'bg-page text-muted border border-rule',
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
      {/* Bell button */}
      <button
        onClick={openDropdown}
        className="relative w-8 h-8 flex items-center justify-center hover:bg-page transition-colors"
        aria-label="Notifications"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
          <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
        </svg>
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-0.5 bg-ink text-paper text-[9px] font-black flex items-center justify-center leading-none">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute right-0 top-10 w-80 bg-paper border border-rule z-50 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-rule">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-black text-ink uppercase tracking-widest">Notifications</span>
              {unreadCount > 0 && (
                <span className="text-[9px] font-black px-1.5 py-0.5 bg-ink text-paper ">
                  {unreadCount} new
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {unreadCount > 0 && (
                <button
                  onClick={markAllRead}
                  className="text-[9px] font-bold text-accent hover:text-accent uppercase tracking-wide"
                >
                  Mark all read
                </button>
              )}
            </div>
          </div>

          {/* Notification list */}
          <div className="max-h-80 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <div className="w-5 h-5 border-2 border-accent border-t-accent animate-spin rounded-full" />
              </div>
            ) : notifications.length === 0 ? (
              <div className="py-8 text-center">
                <p className="text-[11px] font-bold text-muted uppercase tracking-widest">No notifications</p>
              </div>
            ) : (
              notifications.map(notif => (
                <button
                  key={notif.id}
                  onClick={() => markRead(notif)}
                  className={`w-full text-left px-4 py-3 border-b border-rule hover:bg-page transition-colors group ${
                    !notif.isRead ? 'bg-page' : ''
                  }`}
                >
                  <div className="flex items-start gap-2.5">
                    {/* Unread dot */}
                    <div className={`mt-1.5 w-1.5 h-1.5  shrink-0 ${!notif.isRead ? 'bg-accent' : 'bg-transparent'}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                        {notif.category && (
                          <span className={`text-[8px] font-black uppercase tracking-wider px-1.5 py-0.5  ${CATEGORY_COLORS[notif.category] ?? CATEGORY_COLORS.SYSTEM}`}>
                            {notif.category}
                          </span>
                        )}
                        <span className="text-[8px] text-muted ml-auto shrink-0">{timeAgo(notif.createdAt)}</span>
                      </div>
                      <p className={`text-[11px] leading-snug truncate ${!notif.isRead ? 'font-black text-ink' : 'font-normal text-muted'}`}>
                        {notif.title}
                      </p>
                      <p className="text-[10px] text-muted leading-snug mt-0.5 line-clamp-2">
                        {notif.body}
                      </p>
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>

          {/* Footer */}
          <div className="px-4 py-2.5 bg-page border-t border-rule">
            <button
              onClick={() => { setIsOpen(false); router.push('/notifications'); }}
              className="w-full text-center text-[10px] font-black text-accent hover:text-accent uppercase tracking-widest py-0.5"
            >
              View all notifications →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
