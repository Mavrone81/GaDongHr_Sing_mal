'use client';

import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '@/lib/api';
import { PageHeader, Card, CardHeader, Badge, Button, Field, Select, Textarea, Stat, EmptyState, SplitPane } from '@/components/ui';
import type { BadgeTone } from '@/components/ui';

type TicketStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';
type TicketPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
type TicketCategory = 'GENERAL' | 'PAYROLL' | 'LEAVE' | 'CLAIMS' | 'IT_ACCESS' | 'OTHER';

interface TicketMessage {
  id: string;
  authorId: string;
  authorRole: string;
  authorName: string;
  body: string;
  createdAt: string;
}

interface Ticket {
  id: string;
  employeeId: string;
  category: TicketCategory;
  subject: string;
  status: TicketStatus;
  priority: TicketPriority;
  createdAt: string;
  updatedAt: string;
  messages: TicketMessage[];
}

/** Four states, four appearances; the label is always printed beside it. */
const STATUS_TONE: Record<TicketStatus, BadgeTone> = {
  OPEN:        'warn',     // nobody has picked it up yet
  IN_PROGRESS: 'accent',
  RESOLVED:    'ok',       // fixed, but the reporter has not confirmed
  CLOSED:      'neutral',
};

/**
 * Only the two priorities that change what HR does today get a colour. Low
 * and normal share the quiet neutral on purpose — neither needs attention —
 * and the printed word tells them apart.
 */
const PRIORITY_TONE: Record<TicketPriority, BadgeTone> = {
  LOW:    'neutral',
  NORMAL: 'neutral',
  HIGH:   'warn',
  URGENT: 'danger',
};

const STATUS_LABEL: Record<TicketStatus, string> = {
  OPEN: 'Open', IN_PROGRESS: 'In progress', RESOLVED: 'Resolved', CLOSED: 'Closed',
};

const PRIORITY_LABEL: Record<TicketPriority, string> = {
  LOW: 'Low', NORMAL: 'Normal', HIGH: 'High', URGENT: 'Urgent',
};

const CATEGORY_LABELS: Record<TicketCategory, string> = {
  GENERAL: 'General', PAYROLL: 'Payroll', LEAVE: 'Leave',
  CLAIMS: 'Claims', IT_ACCESS: 'IT access', OTHER: 'Other',
};

/** SUPER_ADMIN → "Super admin", HR_ADMIN → "HR admin" (sentence case, acronym kept). */
function roleLabel(role: string): string {
  const words = role.split('_').map(w => (w === 'HR' ? 'HR' : w.toLowerCase()));
  const first = words[0] ?? '';
  words[0] = first === 'HR' ? first : first.charAt(0).toUpperCase() + first.slice(1);
  return words.join(' ');
}

const STATUSES: TicketStatus[] = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];
const PRIORITIES: TicketPriority[] = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];

// ─────────────────────────────────────────────────────────────────────────────
// Thread view
// ─────────────────────────────────────────────────────────────────────────────
function AdminThread({ ticket: initial, onUpdated }: { ticket: Ticket; onUpdated: (t: Ticket) => void }) {
  const [ticket, setTicket] = useState(initial);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState('');

  async function sendReply() {
    if (!reply.trim()) return;
    setSending(true); setError('');
    try {
      await apiFetch(`/support/tickets/${ticket.id}/messages`, { method: 'POST', body: JSON.stringify({ body: reply }) });
      const updated = await apiFetch(`/support/tickets/${ticket.id}`);
      setTicket(updated); onUpdated(updated); setReply('');
    } catch (e: any) { setError(e.message || 'Failed to send reply'); }
    finally { setSending(false); }
  }

  async function updateField(patch: { status?: TicketStatus; priority?: TicketPriority }) {
    setUpdating(true); setError('');
    try {
      const updated = await apiFetch(`/support/tickets/${ticket.id}`, { method: 'PUT', body: JSON.stringify(patch) });
      setTicket(updated); onUpdated(updated);
    } catch (e: any) { setError(e.message || 'Failed to update ticket'); }
    finally { setUpdating(false); }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="flex flex-col gap-4">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-ink leading-snug">{ticket.subject}</h2>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mt-2 text-[13px] text-muted">
              <Badge tone={STATUS_TONE[ticket.status]}>{STATUS_LABEL[ticket.status]}</Badge>
              <Badge tone={PRIORITY_TONE[ticket.priority]}>{PRIORITY_LABEL[ticket.priority]} priority</Badge>
              <span>{CATEGORY_LABELS[ticket.category]}</span>
              <span className="tabular-nums" title={ticket.employeeId}>Employee {ticket.employeeId.slice(0, 8)}…</span>
              <span className="tabular-nums">Raised {new Date(ticket.createdAt).toLocaleDateString()}</span>
            </div>
          </div>

          {/* Status + Priority controls */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-4 border-t border-rule">
            <Field label="Status" help={updating ? 'Saving…' : undefined}>
              <Select
                value={ticket.status}
                onChange={e => updateField({ status: e.target.value as TicketStatus })}
                disabled={updating}
              >
                {STATUSES.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
              </Select>
            </Field>
            <Field label="Priority">
              <Select
                value={ticket.priority}
                onChange={e => updateField({ priority: e.target.value as TicketPriority })}
                disabled={updating}
              >
                {PRIORITIES.map(p => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
              </Select>
            </Field>
          </div>
        </div>
      </Card>

      <ol className="flex flex-col gap-3" aria-label="Messages">
        {ticket.messages.map(msg => {
          const isHR = ['SUPER_ADMIN', 'HR_ADMIN'].includes(msg.authorRole);
          return (
            <li key={msg.id} className={`flex ${isHR ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] sm:max-w-[75%] px-4 py-3 rounded-card border ${isHR ? 'bg-tint border-tint text-ink' : 'bg-paper border-rule text-ink'}`}>
                <p className="text-xs text-muted mb-1.5">
                  <span className="font-semibold text-ink">{msg.authorName}</span>
                  {' · '}{roleLabel(msg.authorRole)}
                  {' · '}<span className="tabular-nums">{new Date(msg.createdAt).toLocaleString()}</span>
                </p>
                <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.body}</p>
              </div>
            </li>
          );
        })}
      </ol>

      {ticket.status !== 'CLOSED' ? (
        <Card>
          <Field label="Reply to the employee" error={error || undefined}>
            <Textarea
              value={reply}
              onChange={e => setReply(e.target.value)}
              rows={3}
              placeholder="Type your response…"
            />
          </Field>
          <div className="flex justify-end mt-3">
            <Button
              onClick={sendReply}
              disabled={sending || !reply.trim()}
              reason={!sending && !reply.trim() ? 'Write a reply first' : undefined}
              icon="mail"
            >
              {sending ? 'Sending…' : 'Send reply'}
            </Button>
          </div>
        </Card>
      ) : (
        <>
          {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
          <p className="px-4 py-3 rounded-control bg-pill text-sm text-muted">
            This ticket is closed, so replies are off.
          </p>
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin inbox page
// ─────────────────────────────────────────────────────────────────────────────
export default function SupportAdminPage() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [activeTicket, setActiveTicket] = useState<Ticket | null>(null);
  const [filterStatus, setFilterStatus] = useState<TicketStatus | ''>('');
  const [filterCategory, setFilterCategory] = useState<TicketCategory | ''>('');
  const [filterPriority, setFilterPriority] = useState<TicketPriority | ''>('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (filterStatus) qs.set('status', filterStatus);
      if (filterCategory) qs.set('category', filterCategory);
      if (filterPriority) qs.set('priority', filterPriority);
      const data = await apiFetch(`/support/tickets?${qs}`);
      setTickets(data.tickets ?? []);
      setTotal(data.total ?? 0);
    } catch { setTickets([]); }
    finally { setLoading(false); }
  }, [filterStatus, filterCategory, filterPriority]);

  useEffect(() => { load(); }, [load]);

  const openCount = tickets.filter(t => t.status === 'OPEN').length;
  const urgentCount = tickets.filter(t => t.priority === 'URGENT').length;
  const inProgressCount = tickets.filter(t => t.status === 'IN_PROGRESS').length;
  const filtered = !!(filterStatus || filterCategory || filterPriority);

  const list = (
    <Card padding="p-0" className="overflow-hidden">
      <div className="px-5 pt-5">
        <CardHeader title="Tickets" caption={loading ? 'Loading…' : `${tickets.length} shown`} />
      </div>
      {loading ? (
        <div className="flex items-center justify-center py-14 border-t border-rule">
          <div className="w-7 h-7 border-2 border-rule border-t-accent animate-spin rounded-full" role="status" aria-label="Loading tickets" />
        </div>
      ) : tickets.length === 0 ? (
        <div className="border-t border-rule">
          <EmptyState
            icon="mail"
            title={filtered ? 'No tickets match these filters' : 'No tickets yet'}
            description={filtered ? 'Clear a filter to see more.' : 'Tickets employees raise from Help and support land here.'}
          />
        </div>
      ) : (
        <ul>
          {tickets.map(t => {
            const selected = activeTicket?.id === t.id;
            return (
              <li key={t.id} className="border-t border-rule">
                <button
                  type="button"
                  onClick={() => setActiveTicket(t)}
                  aria-current={selected || undefined}
                  className={`w-full text-left px-5 py-3.5 transition-colors ${selected ? 'bg-tint' : 'hover:bg-page'}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm font-semibold text-ink truncate">{t.subject}</p>
                    <span className="text-xs text-faint shrink-0 tabular-nums">{new Date(t.updatedAt).toLocaleDateString()}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 mt-2">
                    <Badge tone={STATUS_TONE[t.status]}>{STATUS_LABEL[t.status]}</Badge>
                    <Badge tone={PRIORITY_TONE[t.priority]}>{PRIORITY_LABEL[t.priority]}</Badge>
                    <span className="text-[13px] text-muted">
                      {CATEGORY_LABELS[t.category]} · {t.messages.length} message{t.messages.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );

  return (
    <div className="flex flex-col gap-5 pb-10">
      <PageHeader
        title="Support inbox"
        subtitle="Tickets raised by employees. Pick one to reply or change its status."
        actions={<Button variant="secondary" onClick={load} disabled={loading}>Refresh</Button>}
      />

      {/* On a phone the thread takes the screen; the summary and filters come back with the list. */}
      <div className={`${activeTicket ? 'hidden xl:grid' : 'grid'} grid-cols-2 lg:grid-cols-4 gap-3`}>
        <Stat label="Total" value={total} />
        <Stat label="Open" value={openCount} note="not picked up yet" />
        <Stat label="In progress" value={inProgressCount} />
        <Stat label="Urgent" value={urgentCount} />
      </div>

      <div className={`${activeTicket ? 'hidden xl:grid' : 'grid'} grid-cols-1 sm:grid-cols-3 gap-3 max-w-[760px]`}>
        <Select aria-label="Filter by status" value={filterStatus} onChange={e => setFilterStatus(e.target.value as TicketStatus | '')}>
          <option value="">All statuses</option>
          {STATUSES.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </Select>
        <Select aria-label="Filter by category" value={filterCategory} onChange={e => setFilterCategory(e.target.value as TicketCategory | '')}>
          <option value="">All categories</option>
          {Object.entries(CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        <Select aria-label="Filter by priority" value={filterPriority} onChange={e => setFilterPriority(e.target.value as TicketPriority | '')}>
          <option value="">All priorities</option>
          {PRIORITIES.map(p => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
        </Select>
      </div>

      <SplitPane
        list={list}
        hasDetail={!!activeTicket}
        onBack={() => { setActiveTicket(null); load(); }}
        backLabel="All tickets"
        detail={activeTicket && (
          // keyed by id: AdminThread seeds its own copy of the ticket, so picking
          // another ticket from the list must remount it rather than keep the old one
          <AdminThread
            key={activeTicket.id}
            ticket={activeTicket}
            onUpdated={t => {
              setActiveTicket(t);
              // the list sits beside the thread now, so keep its copy of this ticket in step
              setTickets(ts => ts.map(x => (x.id === t.id ? t : x)));
            }}
          />
        )}
      />
    </div>
  );
}
