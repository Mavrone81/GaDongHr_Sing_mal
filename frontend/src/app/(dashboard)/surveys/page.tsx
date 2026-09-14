'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetchRaw } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { PageHeader, DataTable, Badge, Button, Modal, Field, Input, Select, Textarea, EmptyState } from '@/components/ui';
import type { BadgeTone, Column } from '@/components/ui';

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

/** Survey type is a kind of survey, not a state: printed as a neutral Badge. */
const TYPE_LABEL: Record<Survey['type'], string> = {
  ANNUAL: 'Annual engagement',
  PULSE:  'Pulse',
  EXIT:   'Exit',
  CUSTOM: 'Custom',
};

const STATUS_TONE: Record<Survey['status'], BadgeTone> = {
  DRAFT:  'neutral',
  ACTIVE: 'ok',
  CLOSED: 'accent',
};

const STATUS_LABEL: Record<Survey['status'], string> = {
  DRAFT: 'Draft', ACTIVE: 'Active', CLOSED: 'Closed',
};

const fmt = (iso: string) => new Date(iso).toLocaleDateString('en-SG');

export default function SurveysPage() {
  const router = useRouter();
  const { user } = useAuth();
  const role = (user?.role || '').toUpperCase();
  const isHr = HR_ROLES.includes(role);

  const [surveys, setSurveys] = useState<Survey[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  async function loadData() {
    setLoading(true);
    try {
      const res = await apiFetchRaw('/surveys').then(r => r.json());
      setSurveys(res.surveys || []);
    } catch (err) { console.error('[surveys]', err); }
    finally { setLoading(false); }
  }
  useEffect(() => { if (user) loadData(); }, [user]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="w-9 h-9 border-2 border-rule border-t-accent animate-spin rounded-full" role="status" aria-label="Loading surveys" />
      </div>
    );
  }

  const hrefFor = (s: Survey) => (isHr ? `/surveys/${s.id}` : `/surveys/${s.id}/take`);

  const columns: Column<Survey>[] = [
    {
      key: 'survey', label: 'Survey', width: 'minmax(0, 2fr)',
      render: s => (
        <div className="flex flex-col min-w-0">
          <span className="font-semibold text-ink truncate">{s.title}</span>
          <span className="text-xs text-muted truncate">{s.code}{s.anonymous ? ' · Anonymous' : ''}</span>
        </div>
      ),
    },
    { key: 'type', label: 'Type', width: '150px', render: s => <Badge tone="neutral">{TYPE_LABEL[s.type]}</Badge> },
    { key: 'status', label: 'Status', width: '100px', render: s => <Badge tone={STATUS_TONE[s.status]}>{STATUS_LABEL[s.status]}</Badge> },
    { key: 'questions', label: 'Questions', width: '90px', align: 'right', numeric: true, render: s => s._count?.questions || 0 },
    ...(isHr ? [{ key: 'responses', label: 'Responses', width: '100px', align: 'right' as const, numeric: true, render: (s: Survey) => s._count?.responses || 0 }] : []),
    { key: 'due', label: 'Due', width: '110px', numeric: true, render: s => (s.dueDate ? fmt(s.dueDate) : <span className="text-faint">—</span>) },
  ];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={isHr ? 'Employee surveys' : 'My surveys'}
        subtitle={isHr ? 'Engagement, pulse and exit surveys. Draft one, publish it, then read the results.' : 'Surveys that are open for you to answer.'}
        actions={isHr ? <Button icon="plus" onClick={() => setShowCreate(true)}>New survey</Button> : undefined}
      />

      <DataTable
        aria-label="Surveys"
        columns={columns}
        rows={surveys}
        rowKey={s => s.id}
        onRowClick={s => router.push(hrefFor(s))}
        mobileCard={s => (
          <div className="flex flex-col gap-2">
            <div className="flex items-start justify-between gap-3">
              <span className="font-semibold text-ink">{s.title}</span>
              <Badge tone={STATUS_TONE[s.status]}>{STATUS_LABEL[s.status]}</Badge>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted">
              <span>{TYPE_LABEL[s.type]}</span>
              <span className="tabular-nums">{s._count?.questions || 0} questions</span>
              {isHr && <span className="tabular-nums">{s._count?.responses || 0} responses</span>}
              {s.dueDate && <span className="tabular-nums">Due {fmt(s.dueDate)}</span>}
            </div>
          </div>
        )}
        empty={
          <EmptyState
            icon="list"
            title={isHr ? 'No surveys yet' : 'No surveys open right now'}
            description={isHr ? 'Create a survey, add questions, then publish it to employees.' : 'When HR opens a survey for you it will appear here.'}
            action={isHr ? <Button variant="secondary" icon="plus" onClick={() => setShowCreate(true)}>New survey</Button> : undefined}
          />
        }
      />

      {showCreate && (
        <CreateSurveyModal onClose={() => setShowCreate(false)} onSuccess={() => { setShowCreate(false); loadData(); }} />
      )}
    </div>
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
    const res = await apiFetchRaw('/surveys', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (res.ok) onSuccess();
    else { const e = await res.json(); setError(e.error || 'Failed'); }
    setSaving(false);
  }

  const missing = !form.code || !form.title;

  return (
    <Modal
      open
      onClose={onClose}
      title="New survey"
      caption="It is saved as a draft. Add questions, then publish it."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            onClick={save}
            disabled={saving || missing}
            reason={!saving && missing ? 'Add a code and a title' : undefined}
          >
            {saving ? 'Creating…' : 'Create as draft'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Code" required help="A short reference, for example PULSE-Q2-2026.">
          <Input value={form.code} onChange={e => setForm({...form, code: e.target.value})} placeholder="PULSE-Q2-2026" />
        </Field>
        <Field label="Title" required>
          <Input value={form.title} onChange={e => setForm({...form, title: e.target.value})} />
        </Field>
        <Field label="Description">
          <Textarea rows={3} value={form.description} onChange={e => setForm({...form, description: e.target.value})} />
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Type" required>
            <Select value={form.type} onChange={e => setForm({...form, type: e.target.value})}>
              <option value="ANNUAL">Annual engagement</option>
              <option value="PULSE">Pulse</option>
              <option value="EXIT">Exit</option>
              <option value="CUSTOM">Custom</option>
            </Select>
          </Field>
          <Field label="Minimum responses to show" help="Results stay hidden below this many.">
            <Input type="number" min={1} value={form.minResponsesToShow} onChange={e => setForm({...form, minResponsesToShow: parseInt(e.target.value) || 3})} />
          </Field>
        </div>
        <Field label="Due date">
          <Input type="date" value={form.dueDate} onChange={e => setForm({...form, dueDate: e.target.value})} />
        </Field>
        <label className="flex items-start gap-2.5 text-sm text-ink cursor-pointer">
          <input type="checkbox" className="mt-0.5 w-4 h-4 accent-accent" checked={form.anonymous} onChange={e => setForm({...form, anonymous: e.target.checked})} />
          <span>Anonymous responses <span className="text-muted">(recommended)</span></span>
        </label>
        {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
      </div>
    </Modal>
  );
}
