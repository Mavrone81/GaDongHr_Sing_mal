'use client';

import { useState, useEffect, useCallback } from 'react';
import { TONES } from '@/lib/statusTone';
import { apiFetch } from '@/lib/api';

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

const STATUS_COLORS: Record<TicketStatus, string> = {
  OPEN:        TONES.warning,   // nobody has picked it up yet
  IN_PROGRESS: TONES.active,
  RESOLVED:    TONES.approved,  // fixed, but the reporter has not confirmed
  CLOSED:      TONES.done,
};

const PRIORITY_COLORS: Record<TicketPriority, string> = {
  LOW:    TONES.neutral,
  NORMAL: TONES.pending,
  HIGH:   TONES.warning,
  URGENT: TONES.critical,
};

const CATEGORY_LABELS: Record<TicketCategory, string> = {
  GENERAL: 'General', PAYROLL: 'Payroll', LEAVE: 'Leave',
  CLAIMS: 'Claims', IT_ACCESS: 'IT Access', OTHER: 'Other',
};

const STATUSES: TicketStatus[] = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];
const PRIORITIES: TicketPriority[] = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];

// ─────────────────────────────────────────────────────────────────────────────
// Thread view
// ─────────────────────────────────────────────────────────────────────────────
function AdminThread({ ticket: initial, onBack, onUpdated }: { ticket: Ticket; onBack: () => void; onUpdated: (t: Ticket) => void }) {
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
    <div className="flex flex-col gap-6 max-w-[860px]">
      {/* Back + meta */}
      <div className="flex items-start gap-4">
        <button onClick={onBack} className="eyebrow-tight hover:text-accent transition-colors mt-1">← Back</button>
        <div className="flex-1">
          <h2 className="text-xl font-black text-ink">{ticket.subject}</h2>
          <div className="flex flex-wrap items-center gap-3 mt-2">
            <span className={`px-2.5 py-0.5  text-[9px] font-black uppercase tracking-widest ${STATUS_COLORS[ticket.status]}`}>{ticket.status.replace('_', ' ')}</span>
            <span className={`text-[9px] font-black uppercase tracking-widest ${PRIORITY_COLORS[ticket.priority]}`}>{ticket.priority}</span>
            <span className="label-form">{CATEGORY_LABELS[ticket.category]}</span>
            <span className="label-form">Emp: {ticket.employeeId.slice(0, 8)}…</span>
            <span className="label-form">{new Date(ticket.createdAt).toLocaleDateString()}</span>
          </div>
        </div>

        {/* Status + Priority controls */}
        <div className="flex items-center gap-3 shrink-0">
          <select
            value={ticket.status}
            onChange={e => updateField({ status: e.target.value as TicketStatus })}
            disabled={updating}
            className="border border-rule px-3 py-2 text-[10px] font-black text-ink outline-none focus:border-accent disabled:opacity-60"
          >
            {STATUSES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
          </select>
          <select
            value={ticket.priority}
            onChange={e => updateField({ priority: e.target.value as TicketPriority })}
            disabled={updating}
            className="border border-rule px-3 py-2 text-[10px] font-black text-ink outline-none focus:border-accent disabled:opacity-60"
          >
            {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
      </div>

      {/* Messages */}
      <div className="flex flex-col gap-4">
        {ticket.messages.map(msg => {
          const isHR = ['SUPER_ADMIN', 'HR_ADMIN'].includes(msg.authorRole);
          return (
            <div key={msg.id} className={`flex ${isHR ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[75%]  px-6 py-4 ${isHR ? 'bg-accent text-paper' : 'bg-page border border-rule'}`}>
                <p className={`text-[9px] font-black uppercase tracking-widest mb-2 ${isHR ? 'text-paper' : 'text-muted'}`}>
                  {msg.authorName} · {msg.authorRole.replace('_', ' ')} · {new Date(msg.createdAt).toLocaleString()}
                </p>
                <p className={`text-sm font-bold leading-relaxed whitespace-pre-wrap ${isHR ? 'text-paper' : 'text-ink'}`}>{msg.body}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Reply */}
      {ticket.status !== 'CLOSED' && (
        <div className="bg-paper border border-rule p-6 flex flex-col gap-4">
          <label className="label-form">Reply to Employee</label>
          <textarea
            value={reply}
            onChange={e => setReply(e.target.value)}
            rows={3}
            placeholder="Type your response…"
            className="w-full border border-rule px-4 py-3 text-sm font-bold text-ink placeholder:text-muted outline-none focus:border-accent resize-none"
          />
          {error && <p className="text-xs font-black text-ink">{error}</p>}
          <button
            onClick={sendReply}
            disabled={sending || !reply.trim()}
            className="self-end px-8 py-3 bg-accent text-paper text-[10px] font-black uppercase tracking-widest hover:bg-accent disabled:opacity-50 transition-all"
          >
            {sending ? 'Sending…' : 'Send Reply'}
          </button>
        </div>
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

  if (activeTicket) {
    return (
      <div className="max-w-[900px] mx-auto pb-20 animate-in fade-in duration-500">
        <AdminThread
          ticket={activeTicket}
          onBack={() => { setActiveTicket(null); load(); }}
          onUpdated={t => setActiveTicket(t)}
        />
      </div>
    );
  }

  const openCount = tickets.filter(t => t.status === 'OPEN').length;
  const urgentCount = tickets.filter(t => t.priority === 'URGENT').length;
  const inProgressCount = tickets.filter(t => t.status === 'IN_PROGRESS').length;

  return (
    <div className="flex flex-col gap-8 max-w-[1100px] mx-auto pb-20 animate-in fade-in duration-700">

      {/* Header */}
      <div className="bg-paper p-10 border border-rule relative overflow-hidden">
        <div className="absolute top-0 right-0 w-32 h-32 bg-accent " />
        <div className="flex items-center gap-3 mb-2">
          <div className="w-2 h-2 bg-accent " />
          <span className="text-[10px] font-black text-accent uppercase tracking-[0.4em]">HR Support Inbox</span>
        </div>
        <h1 className="text-4xl font-black text-ink tracking-tighter">Support <span className="text-accent">Tickets</span></h1>
        <p className="text-sm font-bold text-muted mt-2 uppercase tracking-widest">View and respond to employee-raised tickets.</p>

        {/* KPI strip */}
        <div className="flex gap-8 mt-8">
          {[
            { label: 'Total', value: total },
            { label: 'Open', value: openCount, color: 'text-accent' },
            { label: 'In Progress', value: inProgressCount, color: 'text-ink' },
            { label: 'Urgent', value: urgentCount, color: 'text-ink' },
          ].map(k => (
            <div key={k.label}>
              <p className={`text-3xl font-black ${k.color ?? 'text-ink'}`}>{k.value}</p>
              <p className="label-form mt-1">{k.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value as TicketStatus | '')} className="border border-rule px-5 py-3 text-[10px] font-black text-ink outline-none focus:border-accent bg-paper">
          <option value="">All Statuses</option>
          {STATUSES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
        </select>
        <select value={filterCategory} onChange={e => setFilterCategory(e.target.value as TicketCategory | '')} className="border border-rule px-5 py-3 text-[10px] font-black text-ink outline-none focus:border-accent bg-paper">
          <option value="">All Categories</option>
          {Object.entries(CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={filterPriority} onChange={e => setFilterPriority(e.target.value as TicketPriority | '')} className="border border-rule px-5 py-3 text-[10px] font-black text-ink outline-none focus:border-accent bg-paper">
          <option value="">All Priorities</option>
          {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <button onClick={load} className="px-5 py-3 border border-rule text-[10px] font-black text-muted uppercase tracking-widest hover:bg-page transition-all">Refresh</button>
      </div>

      {/* Ticket table */}
      <div className="bg-paper border border-rule overflow-hidden">
        {loading ? (
          <div className="p-16 text-center text-[10px] font-black text-muted uppercase tracking-widest animate-pulse">Loading tickets…</div>
        ) : tickets.length === 0 ? (
          <div className="p-16 text-center text-[10px] font-black text-muted uppercase tracking-widest">No tickets found</div>
        ) : (
          <div className="divide-y divide-rule">
            {/* Column header */}
            <div className="grid grid-cols-[1fr_120px_100px_80px_100px] gap-4 px-7 py-3 bg-page">
              {['Subject / Employee', 'Category', 'Priority', 'Status', 'Updated'].map(h => (
                <span key={h} className="label-form">{h}</span>
              ))}
            </div>
            {tickets.map(t => (
              <button
                key={t.id}
                onClick={() => setActiveTicket(t)}
                className="w-full grid grid-cols-[1fr_120px_100px_80px_100px] gap-4 px-7 py-4 items-center hover:bg-page transition-colors text-left"
              >
                <div className="min-w-0">
                  <p className="text-sm font-black text-ink truncate">{t.subject}</p>
                  <p className="label-form mt-0.5">{t.messages.length} msg{t.messages.length !== 1 ? 's' : ''}</p>
                </div>
                <span className="text-[9px] font-black text-muted uppercase tracking-widest">{CATEGORY_LABELS[t.category]}</span>
                <span className={`text-[9px] font-black uppercase tracking-widest ${PRIORITY_COLORS[t.priority]}`}>{t.priority}</span>
                <span className={`inline-flex justify-center px-2.5 py-1  text-[9px] font-black uppercase tracking-widest ${STATUS_COLORS[t.status]}`}>
                  {t.status.replace('_', ' ')}
                </span>
                <span className="label-form">{new Date(t.updatedAt).toLocaleDateString()}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
