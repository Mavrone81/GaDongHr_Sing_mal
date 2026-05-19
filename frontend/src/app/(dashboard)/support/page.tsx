'use client';

import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '@/lib/api';

type TicketStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';
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
  category: TicketCategory;
  subject: string;
  status: TicketStatus;
  priority: string;
  createdAt: string;
  updatedAt: string;
  messages: TicketMessage[];
}

const STATUS_COLORS: Record<TicketStatus, string> = {
  OPEN: 'bg-blue-100 text-blue-700',
  IN_PROGRESS: 'bg-amber-100 text-amber-700',
  RESOLVED: 'bg-emerald-100 text-emerald-700',
  CLOSED: 'bg-slate-100 text-slate-500',
};

const CATEGORY_LABELS: Record<TicketCategory, string> = {
  GENERAL: 'General', PAYROLL: 'Payroll Issue', LEAVE: 'Leave Problem',
  CLAIMS: 'Claims Issue', IT_ACCESS: 'IT / System Access', OTHER: 'Other',
};

const FAQS = [
  { q: 'How do I apply for leave?', a: 'Navigate to My Leave → Apply Leave. Select leave type, dates, and submit for approval.' },
  { q: 'How do I view my payslip?', a: 'Go to My Payslips and select the relevant pay period to download your PDF payslip.' },
  { q: 'How do I submit an expense claim?', a: 'Go to My Claims → New Claim. Fill in the amount, category, and upload your receipt.' },
  { q: 'How do I update my personal details?', a: 'Contact HR Admin to update personal information such as bank account or emergency contact.' },
  { q: 'Who approves my leave?', a: 'L1 approval is your Line Manager. L2 approval is HR. Both must approve for long-duration leaves.' },
];

// ─────────────────────────────────────────────────────────────────────────────
// Thread view — show a ticket's message thread + reply input
// ─────────────────────────────────────────────────────────────────────────────
function TicketThread({ ticket, onBack, onUpdated }: { ticket: Ticket; onBack: () => void; onUpdated: (t: Ticket) => void }) {
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  async function sendReply() {
    if (!reply.trim()) return;
    setSending(true); setError('');
    try {
      await apiFetch(`/support/tickets/${ticket.id}/messages`, { method: 'POST', body: JSON.stringify({ body: reply }) });
      const updated = await apiFetch(`/support/tickets/${ticket.id}`);
      onUpdated(updated);
      setReply('');
    } catch (e: any) { setError(e.message || 'Failed to send reply'); }
    finally { setSending(false); }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Back + header */}
      <div className="flex items-center gap-4">
        <button onClick={onBack} className="text-[10px] font-black text-slate-400 uppercase tracking-widest hover:text-indigo-600 transition-colors">← Back</button>
        <div className="flex-1">
          <h2 className="text-lg font-black text-slate-900 truncate">{ticket.subject}</h2>
          <div className="flex items-center gap-3 mt-1">
            <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest ${STATUS_COLORS[ticket.status]}`}>{ticket.status.replace('_', ' ')}</span>
            <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{CATEGORY_LABELS[ticket.category]}</span>
            <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{new Date(ticket.createdAt).toLocaleDateString()}</span>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex flex-col gap-4">
        {ticket.messages.map(msg => {
          const isHR = ['SUPER_ADMIN', 'HR_ADMIN'].includes(msg.authorRole);
          return (
            <div key={msg.id} className={`flex ${isHR ? 'justify-start' : 'justify-end'}`}>
              <div className={`max-w-[75%] rounded-2xl px-6 py-4 ${isHR ? 'bg-slate-50 border border-slate-100' : 'bg-indigo-600 text-white'}`}>
                <p className={`text-[9px] font-black uppercase tracking-widest mb-2 ${isHR ? 'text-slate-400' : 'text-indigo-200'}`}>
                  {msg.authorName} · {new Date(msg.createdAt).toLocaleString()}
                </p>
                <p className={`text-sm font-bold leading-relaxed whitespace-pre-wrap ${isHR ? 'text-slate-700' : 'text-white'}`}>{msg.body}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Reply */}
      {ticket.status !== 'CLOSED' && (
        <div className="bg-white rounded-[2rem] border border-slate-100 p-6 flex flex-col gap-4">
          <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Add Reply</label>
          <textarea
            value={reply}
            onChange={e => setReply(e.target.value)}
            rows={3}
            placeholder="Type your message…"
            className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold text-slate-900 placeholder:text-slate-300 outline-none focus:border-indigo-600 resize-none"
          />
          {error && <p className="text-xs font-black text-red-500">{error}</p>}
          <button
            onClick={sendReply}
            disabled={sending || !reply.trim()}
            className="self-end px-8 py-3 bg-indigo-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-indigo-700 disabled:opacity-50 transition-all"
          >
            {sending ? 'Sending…' : 'Send Reply'}
          </button>
        </div>
      )}
      {ticket.status === 'CLOSED' && (
        <div className="bg-slate-50 rounded-2xl p-5 text-center text-[10px] font-black text-slate-400 uppercase tracking-widest border border-slate-100">
          This ticket is closed. Raise a new ticket if you need further assistance.
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────────────────
export default function SupportPage() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTicket, setActiveTicket] = useState<Ticket | null>(null);
  const [showForm, setShowForm] = useState(false);

  // New ticket form
  const [subject, setSubject] = useState('');
  const [category, setCategory] = useState<TicketCategory>('GENERAL');
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  const loadTickets = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch('/support/tickets/my');
      setTickets(data.tickets ?? []);
    } catch { setTickets([]); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadTickets(); }, [loadTickets]);

  async function submitTicket() {
    if (!subject.trim() || !body.trim()) { setFormError('Subject and details are required'); return; }
    setSubmitting(true); setFormError('');
    try {
      await apiFetch('/support/tickets', { method: 'POST', body: JSON.stringify({ subject, category, body }) });
      setSubject(''); setBody(''); setCategory('GENERAL');
      setShowForm(false);
      loadTickets();
    } catch (e: any) { setFormError(e.message || 'Failed to submit ticket'); }
    finally { setSubmitting(false); }
  }

  // ── Thread view ─────────────────────────────────────────────────────────────
  if (activeTicket) {
    return (
      <div className="max-w-[800px] mx-auto pb-20 animate-in fade-in duration-500">
        <TicketThread
          ticket={activeTicket}
          onBack={() => { setActiveTicket(null); loadTickets(); }}
          onUpdated={t => setActiveTicket(t)}
        />
      </div>
    );
  }

  // ── List view ───────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-8 max-w-[1000px] mx-auto pb-20 animate-in fade-in duration-700">

      {/* Header */}
      <div className="bg-white p-10 rounded-[2.5rem] border border-slate-100 shadow-2xl shadow-indigo-500/5 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-32 h-32 bg-sky-500/5 rounded-full blur-3xl" />
        <div className="flex items-center gap-3 mb-2">
          <div className="w-2 h-2 bg-sky-500 rounded-full" />
          <span className="text-[10px] font-black text-sky-600 uppercase tracking-[0.4em]">Employee Support</span>
        </div>
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="text-4xl font-black text-slate-900 tracking-tighter">Help <span className="text-sky-600">&amp; Support</span></h1>
            <p className="text-sm font-bold text-slate-400 mt-2 uppercase tracking-widest">Raise a ticket or browse your ticket history.</p>
          </div>
          <button
            onClick={() => setShowForm(v => !v)}
            className="px-7 py-3.5 bg-indigo-600 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-indigo-700 shadow-xl shadow-indigo-500/20 transition-all shrink-0"
          >
            {showForm ? 'Cancel' : '+ New Ticket'}
          </button>
        </div>
      </div>

      {/* New ticket form */}
      {showForm && (
        <div className="bg-white rounded-[2rem] border border-slate-100 shadow-2xl shadow-indigo-500/5 overflow-hidden animate-in slide-in-from-top-4 duration-300">
          <div className="p-7 border-b border-slate-50 flex items-center gap-4">
            <div className="w-2 h-6 bg-indigo-600 rounded-full" />
            <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest">Raise a Ticket</h3>
          </div>
          <div className="p-7 flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Category</label>
              <select value={category} onChange={e => setCategory(e.target.value as TicketCategory)} className="bg-slate-50 border border-slate-200 rounded-2xl px-5 py-3.5 text-xs font-black text-slate-900 outline-none focus:border-indigo-600 appearance-none cursor-pointer">
                {Object.entries(CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Subject</label>
              <input value={subject} onChange={e => setSubject(e.target.value)} placeholder="Brief description of your issue…" className="bg-slate-50 border border-slate-200 rounded-2xl px-5 py-3.5 text-xs font-black text-slate-900 placeholder:text-slate-300 outline-none focus:border-indigo-600 transition-all" />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Details</label>
              <textarea value={body} onChange={e => setBody(e.target.value)} rows={5} placeholder="Describe the issue in detail…" className="bg-slate-50 border border-slate-200 rounded-2xl px-5 py-3.5 text-xs font-black text-slate-900 placeholder:text-slate-300 outline-none focus:border-indigo-600 transition-all resize-none" />
            </div>
            {formError && <p className="text-xs font-black text-red-500">{formError}</p>}
            <button onClick={submitTicket} disabled={submitting} className="w-full py-4 bg-indigo-600 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-indigo-700 shadow-xl shadow-indigo-500/20 transition-all active:scale-95 disabled:opacity-60">
              {submitting ? 'Submitting…' : 'Submit Ticket'}
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Ticket history */}
        <div className="bg-white rounded-[2rem] border border-slate-100 shadow-2xl shadow-indigo-500/5 overflow-hidden">
          <div className="p-7 border-b border-slate-50 flex items-center gap-4">
            <div className="w-2 h-6 bg-indigo-600 rounded-full" />
            <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest">My Tickets</h3>
            <span className="ml-auto text-[9px] font-black text-slate-400 uppercase tracking-widest">{tickets.length} total</span>
          </div>
          {loading ? (
            <div className="p-10 text-center text-[10px] font-black text-slate-300 uppercase tracking-widest animate-pulse">Loading…</div>
          ) : tickets.length === 0 ? (
            <div className="p-10 text-center text-[10px] font-black text-slate-300 uppercase tracking-widest">No tickets yet. Raise one above.</div>
          ) : (
            <div className="divide-y divide-slate-50">
              {tickets.map(t => (
                <button key={t.id} onClick={() => setActiveTicket(t)} className="w-full text-left px-7 py-5 hover:bg-slate-50 transition-colors">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-black text-slate-900 truncate">{t.subject}</p>
                      <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mt-1">{CATEGORY_LABELS[t.category]} · {new Date(t.updatedAt).toLocaleDateString()}</p>
                    </div>
                    <span className={`shrink-0 px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-widest ${STATUS_COLORS[t.status]}`}>{t.status.replace('_', ' ')}</span>
                  </div>
                  <p className="text-xs font-bold text-slate-400 mt-2 line-clamp-1">{t.messages[0]?.body}</p>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* FAQ */}
        <div className="bg-white rounded-[2rem] border border-slate-100 shadow-2xl shadow-indigo-500/5 overflow-hidden">
          <div className="p-7 border-b border-slate-50 flex items-center gap-4">
            <div className="w-2 h-6 bg-sky-500 rounded-full" />
            <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest">Quick Answers</h3>
          </div>
          <div className="divide-y divide-slate-50">
            {FAQS.map(f => (
              <details key={f.q} className="group">
                <summary className="flex items-center justify-between px-7 py-5 cursor-pointer list-none hover:bg-slate-50 transition-all">
                  <span className="text-[11px] font-black text-slate-700 uppercase tracking-tight group-open:text-indigo-600 transition-colors">{f.q}</span>
                  <span className="text-slate-300 group-open:rotate-90 transition-transform duration-300 text-lg">›</span>
                </summary>
                <div className="px-7 pb-5">
                  <p className="text-[10px] font-bold text-slate-500 leading-relaxed">{f.a}</p>
                </div>
              </details>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
