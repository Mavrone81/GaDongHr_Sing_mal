'use client';

import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '@/lib/api';
import { PageHeader, Card, CardHeader, Badge, Button, Field, Input, Select, EmptyState, Icon } from '@/components/ui';

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

/** Four states, four appearances; the label is always printed beside it. */
const STATUS_TONE: Record<TicketStatus, 'warn' | 'accent' | 'ok' | 'neutral'> = {
  OPEN:        'warn',     // nobody has picked it up yet
  IN_PROGRESS: 'accent',
  RESOLVED:    'ok',       // fixed, but the reporter has not confirmed
  CLOSED:      'neutral',
};

const STATUS_LABEL: Record<TicketStatus, string> = {
  OPEN: 'Open', IN_PROGRESS: 'In progress', RESOLVED: 'Resolved', CLOSED: 'Closed',
};

const CATEGORY_LABELS: Record<TicketCategory, string> = {
  GENERAL: 'General', PAYROLL: 'Payroll issue', LEAVE: 'Leave problem',
  CLAIMS: 'Claims issue', IT_ACCESS: 'IT / system access', OTHER: 'Other',
};

const FAQS = [
  { q: 'How do I apply for leave?', a: 'Go to My leave → Apply leave. Pick the leave type and dates, then submit it for approval.' },
  { q: 'How do I view my payslip?', a: 'Go to My payslips and choose the pay period to download that month’s PDF.' },
  { q: 'How do I submit an expense claim?', a: 'Go to My claims → New claim. Enter the amount and category, and attach your receipt.' },
  { q: 'How do I update my personal details?', a: 'Ask your HR admin to change details such as your bank account or emergency contact.' },
  { q: 'Who approves my leave?', a: 'Your line manager gives the first approval and HR the second. Longer leave needs both.' },
];

const REQUIRED_MSG = 'Subject and details are required';

const TEXTAREA = 'w-full px-3 py-2.5 rounded-control border border-rule bg-paper text-sm text-ink placeholder:text-faint outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/20 resize-none';

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
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        <button
          type="button"
          onClick={onBack}
          className="self-start inline-flex items-center gap-1.5 h-8 -ml-1 px-1 rounded-control text-[13px] font-semibold text-muted hover:text-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          <Icon name="chevronRight" size={16} className="rotate-180" /> All tickets
        </button>
        <PageHeader
          title={ticket.subject}
          subtitle={
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <Badge tone={STATUS_TONE[ticket.status]}>{STATUS_LABEL[ticket.status]}</Badge>
              <span>{CATEGORY_LABELS[ticket.category]}</span>
              <span className="tabular-nums">Raised {new Date(ticket.createdAt).toLocaleDateString()}</span>
            </span>
          }
        />
      </div>

      <ol className="flex flex-col gap-3" aria-label="Messages">
        {ticket.messages.map(msg => {
          const isHR = ['SUPER_ADMIN', 'HR_ADMIN'].includes(msg.authorRole);
          return (
            <li key={msg.id} className={`flex ${isHR ? 'justify-start' : 'justify-end'}`}>
              <div className={`max-w-[85%] sm:max-w-[75%] px-4 py-3 rounded-card border ${isHR ? 'bg-paper border-rule text-ink' : 'bg-tint border-tint text-ink'}`}>
                <p className="text-xs text-muted mb-1.5">
                  <span className="font-semibold text-ink">{msg.authorName}</span>
                  {' · '}
                  <span className="tabular-nums">{new Date(msg.createdAt).toLocaleString()}</span>
                </p>
                <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.body}</p>
              </div>
            </li>
          );
        })}
      </ol>

      {ticket.status !== 'CLOSED' && (
        <Card>
          <Field label="Add a reply" error={error || undefined}>
            <textarea
              value={reply}
              onChange={e => setReply(e.target.value)}
              rows={3}
              placeholder="Type your message…"
              className={TEXTAREA}
            />
          </Field>
          <div className="flex justify-end mt-3">
            <Button
              onClick={sendReply}
              disabled={sending || !reply.trim()}
              reason={!sending && !reply.trim() ? 'Write a message first' : undefined}
              icon="mail"
            >
              {sending ? 'Sending…' : 'Send reply'}
            </Button>
          </div>
        </Card>
      )}
      {ticket.status === 'CLOSED' && (
        <div className="flex items-start gap-3 px-4 py-3 rounded-control bg-pill text-sm text-muted">
          <Icon name="lock" size={18} className="mt-px" />
          This ticket is closed. Raise a new ticket if you need more help.
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
    if (!subject.trim() || !body.trim()) { setFormError(REQUIRED_MSG); return; }
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
      <div className="max-w-[800px] mx-auto w-full pb-10">
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
    <div className="flex flex-col gap-5 max-w-[1040px] mx-auto w-full pb-10">
      <PageHeader
        title="Help and support"
        subtitle="Raise a ticket with HR, or check on one you have already raised."
        actions={
          <Button variant={showForm ? 'secondary' : 'primary'} icon={showForm ? 'x' : 'plus'} onClick={() => setShowForm(v => !v)}>
            {showForm ? 'Cancel' : 'New ticket'}
          </Button>
        }
      />

      {showForm && (
        <Card>
          <CardHeader title="Raise a ticket" />
          <div className="flex flex-col gap-4 max-w-[640px]">
            <Field label="Category">
              <Select value={category} onChange={e => setCategory(e.target.value as TicketCategory)}>
                {Object.entries(CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
            </Field>
            <Field label="Subject" required error={formError === REQUIRED_MSG && !subject.trim() ? 'Add a short subject' : undefined}>
              <Input value={subject} onChange={e => setSubject(e.target.value)} placeholder="A short summary of the issue" invalid={formError === REQUIRED_MSG && !subject.trim()} />
            </Field>
            <Field label="Details" required error={formError === REQUIRED_MSG && !body.trim() ? 'Describe the issue' : undefined}>
              <textarea value={body} onChange={e => setBody(e.target.value)} rows={5} placeholder="What happened, and what did you expect?" className={`${TEXTAREA} ${formError === REQUIRED_MSG && !body.trim() ? 'border-danger' : ''}`} />
            </Field>
            {formError && formError !== REQUIRED_MSG && (
              <p role="alert" className="text-[13px] text-danger">{formError}</p>
            )}
            <div className="flex justify-end">
              <Button onClick={submitTicket} disabled={submitting}>
                {submitting ? 'Submitting…' : 'Submit ticket'}
              </Button>
            </div>
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5 items-start">
        {/* Ticket history */}
        <Card padding="p-0" className="lg:col-span-3 overflow-hidden">
          <div className="px-5 pt-5">
            <CardHeader title="My tickets" caption={`${tickets.length} total`} />
          </div>
          {loading ? (
            <div className="flex items-center justify-center py-14">
              <div className="w-7 h-7 border-2 border-rule border-t-accent animate-spin rounded-full" role="status" aria-label="Loading tickets" />
            </div>
          ) : tickets.length === 0 ? (
            <EmptyState
              icon="mail"
              title="No tickets yet"
              description="When something is not working, raise a ticket and HR will reply here."
              action={!showForm ? <Button variant="secondary" icon="plus" onClick={() => setShowForm(true)}>New ticket</Button> : undefined}
            />
          ) : (
            <ul>
              {tickets.map(t => (
                <li key={t.id} className="border-t border-rule">
                  <button
                    type="button"
                    onClick={() => setActiveTicket(t)}
                    className="w-full text-left px-5 py-4 hover:bg-page transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-ink truncate">{t.subject}</p>
                        <p className="text-[13px] text-muted mt-0.5">
                          {CATEGORY_LABELS[t.category]} · <span className="tabular-nums">Updated {new Date(t.updatedAt).toLocaleDateString()}</span>
                        </p>
                      </div>
                      <Badge tone={STATUS_TONE[t.status]}>{STATUS_LABEL[t.status]}</Badge>
                    </div>
                    {t.messages[0]?.body && <p className="text-[13px] text-muted mt-2 line-clamp-1">{t.messages[0].body}</p>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* FAQ */}
        <Card padding="p-0" className="lg:col-span-2 overflow-hidden">
          <div className="px-5 pt-5">
            <CardHeader title="Quick answers" />
          </div>
          <div>
            {FAQS.map(f => (
              <details key={f.q} className="group border-t border-rule">
                <summary className="flex items-center justify-between gap-3 px-5 py-3.5 cursor-pointer list-none hover:bg-page transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40">
                  <span className="text-sm font-semibold text-ink group-open:text-accent">{f.q}</span>
                  <Icon name="chevronDown" size={16} className="text-muted transition-transform group-open:rotate-180" />
                </summary>
                <p className="px-5 pb-4 text-[13px] text-muted leading-relaxed">{f.a}</p>
              </details>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
