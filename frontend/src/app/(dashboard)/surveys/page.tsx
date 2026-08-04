'use client';

import React, { useEffect, useState } from 'react';
import { TONES } from '@/lib/statusTone';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';

interface Survey {
  id: string;
  code: string;
  title: string;
  description: string | null;
  type: 'ANNUAL' | 'PULSE' | 'EXIT' | 'CUSTOM';
  status: 'DRAFT' | 'ACTIVE' | 'CLOSED';
  anonymous: boolean;
  openedAt: string | null;
  closedAt: string | null;
  dueDate: string | null;
  createdByName: string | null;
  _count?: { responses: number; questions: number };
}

const HR_ROLES = ['HR_ADMIN', 'HR_MANAGER', 'SUPER_ADMIN'];

const TYPE_COLORS: Record<string, string> = {
  ANNUAL: 'bg-page text-accent',
  PULSE:  'bg-page text-accent',
  EXIT:   'bg-page text-ink',
  CUSTOM: 'bg-page text-ink',
};

const STATUS_COLORS: Record<string, string> = {
  DRAFT: TONES.neutral,
  ACTIVE: TONES.approved,
  CLOSED: TONES.done,
};

export default function SurveysPage() {
  const { user } = useAuth();
  const role = (user?.role || '').toUpperCase();
  const isHr = HR_ROLES.includes(role);

  const [surveys, setSurveys] = useState<Survey[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  async function loadData() {
    setLoading(true);
    try {
      const res = await apiFetch('/surveys').then(r => r.json());
      setSurveys(res.surveys || []);
    } catch (err) { console.error('[surveys]', err); }
    finally { setLoading(false); }
  }
  useEffect(() => { if (user) loadData(); }, [user]);

  if (loading) {
    return <div className="flex items-center justify-center min-h-[400px]"><div className="w-10 h-10 border-4 border-accent border-t-accent animate-spin rounded-full" /></div>;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-black text-ink">{isHr ? 'Employee Surveys' : 'My Surveys'}</h1>
          <p className="text-xs text-muted mt-0.5 uppercase tracking-widest font-bold">Engagement · Pulse · Exit feedback</p>
        </div>
        {isHr && (
          <button
            onClick={() => setShowCreate(true)}
            className="px-4 py-2 bg-accent text-paper text-xs font-black uppercase tracking-widest hover:bg-accent transition-all"
          >
            + New Survey
          </button>
        )}
      </div>

      {surveys.length === 0 ? (
        <div className="bg-paper border border-rule p-12 text-center">
          <p className="text-sm text-muted">{isHr ? 'No surveys yet. Create one to get started.' : 'No active surveys. Check back later.'}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
          {surveys.map(s => (
            <SurveyCard key={s.id} survey={s} isHr={isHr} />
          ))}
        </div>
      )}

      {showCreate && (
        <CreateSurveyModal onClose={() => setShowCreate(false)} onSuccess={() => { setShowCreate(false); loadData(); }} />
      )}
    </div>
  );
}

function SurveyCard({ survey, isHr }: { survey: Survey; isHr: boolean }) {
  const href = isHr ? `/surveys/${survey.id}` : `/surveys/${survey.id}/take`;
  return (
    <Link href={href} className="block bg-paper border border-rule p-4 sm:p-5 hover: hover:border-accent transition-all">
      <div className="flex items-center gap-2 flex-wrap mb-2">
        <span className="text-xs font-mono font-black text-muted">{survey.code}</span>
        <span className={`px-2 py-0.5 text-[10px] font-black uppercase tracking-widest  ${TYPE_COLORS[survey.type]}`}>{survey.type}</span>
        <span className={`px-2 py-0.5 text-[10px] font-black uppercase tracking-widest  ${STATUS_COLORS[survey.status]}`}>{survey.status}</span>
        {survey.anonymous && <span className="px-2 py-0.5 text-[10px] font-black uppercase tracking-widest bg-page text-accent">Anonymous</span>}
      </div>
      <h3 className="text-base font-black text-ink mb-1">{survey.title}</h3>
      {survey.description && <p className="text-sm text-muted line-clamp-2">{survey.description}</p>}
      <div className="flex items-center justify-between mt-3 text-xs text-muted">
        <span>{survey._count?.questions || 0} questions</span>
        {isHr && <span>{survey._count?.responses || 0} responses</span>}
        {survey.dueDate && <span className="font-bold">Due {new Date(survey.dueDate).toLocaleDateString('en-SG')}</span>}
      </div>
    </Link>
  );
}

// ─── Create Survey Modal ─────────────────────────────────────────────────────
function CreateSurveyModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [form, setForm] = useState({
    code: '', title: '', description: '', type: 'PULSE',
    anonymous: true, minResponsesToShow: 3, dueDate: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    setSaving(true); setError('');
    const body: any = { ...form, minResponsesToShow: parseInt(String(form.minResponsesToShow)) };
    if (!body.dueDate) delete body.dueDate;
    const res = await apiFetch('/surveys', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (res.ok) onSuccess();
    else { const e = await res.json(); setError(e.error || 'Failed'); }
    setSaving(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-shadow/40 backdrop- p-4">
      <div className="bg-paper w-full max-w-lg border border-rule max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-rule sticky top-0 bg-paper flex items-center justify-between">
          <h3 className="text-sm font-black text-ink">New Survey</h3>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center hover:bg-page text-muted text-lg">×</button>
        </div>
        <div className="p-6 space-y-4">
          <Field label="Code" required><input value={form.code} onChange={e => setForm({...form, code: e.target.value})} className="input" placeholder="e.g. PULSE-Q2-2026" /></Field>
          <Field label="Title" required><input value={form.title} onChange={e => setForm({...form, title: e.target.value})} className="input" /></Field>
          <Field label="Description"><textarea rows={3} value={form.description} onChange={e => setForm({...form, description: e.target.value})} className="input resize-none" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Type" required>
              <select value={form.type} onChange={e => setForm({...form, type: e.target.value})} className="input">
                <option value="ANNUAL">Annual Engagement</option>
                <option value="PULSE">Pulse</option>
                <option value="EXIT">Exit</option>
                <option value="CUSTOM">Custom</option>
              </select>
            </Field>
            <Field label="Min Responses to Show">
              <input type="number" min={1} value={form.minResponsesToShow} onChange={e => setForm({...form, minResponsesToShow: parseInt(e.target.value) || 3})} className="input" />
            </Field>
          </div>
          <Field label="Due Date">
            <input type="date" value={form.dueDate} onChange={e => setForm({...form, dueDate: e.target.value})} className="input" />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.anonymous} onChange={e => setForm({...form, anonymous: e.target.checked})} />
            Anonymous responses (recommended)
          </label>
          {error && <div className="p-3 bg-page border border-ink text-sm text-ink font-bold">{error}</div>}
          <div className="flex gap-3 pt-1">
            <button onClick={save} disabled={saving || !form.code || !form.title} className="flex-1 py-2.5 bg-accent text-paper text-xs font-black uppercase tracking-widest hover:bg-accent disabled:opacity-50">
              {saving ? 'Creating…' : 'Create as Draft'}
            </button>
            <button onClick={onClose} className="px-5 py-2.5 border border-rule text-ink text-xs font-black uppercase tracking-widest hover:bg-page">Cancel</button>
          </div>
        </div>
      </div>
      <style jsx>{`
        :global(.input) { width: 100%; border: 1px solid var(--rule); padding: 0.6rem 0.9rem; font-size: 0.875rem; outline: none; }
        :global(.input:focus) { border-color: var(--accent); box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 20%, transparent); }
      `}</style>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-black text-ink uppercase tracking-wider mb-1.5">
        {label}{required && <span className="text-ink"> *</span>}
      </label>
      {children}
    </div>
  );
}
