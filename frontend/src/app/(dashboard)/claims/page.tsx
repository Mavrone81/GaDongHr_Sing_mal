'use client';

import { useState, useEffect, useRef, type ReactNode, type ChangeEvent } from 'react';
import { useAuth } from '@/context/AuthContext';
import { apiFetch } from '@/lib/api';
import { PageHeader, Stat, Card, DataTable, Badge, Button, Field, Input, Select, Textarea, EmptyState, Modal, useToast, Icon, type Column, type IconName } from '@/components/ui';

// ─── Types ────────────────────────────────────────────────────────────────────
interface ClaimCategory { id: string; code: string; name: string; maxAmount: number | null; isGstClaimable: boolean; }
interface Claim {
  id: string; date: string; category: string; categoryCode: string;
  merchant: string; amount: number; gst: number;
  description: string; receipt: string | null;
  status: 'Pending' | 'Approved' | 'Rejected'; submittedOn: string;
}

/** Category glyphs come from the shared icon set (spec: Icon, never emoji). */
const CATEGORY_ICONS: Record<string, IconName> = {
  TRANSPORT: 'arrowRight', MEAL: 'receipt', TRAVEL: 'briefcase', ACCOMMODATION: 'building',
  TRAINING: 'book', MEDICAL: 'shield', OFFICE: 'paperclip', TELECOM: 'bell',
  ENTERTAINMENT: 'star', OTHER: 'tag',
};
const categoryIcon = (code: string): IconName => CATEGORY_ICONS[code] ?? 'tag';

function statusTone(s: Claim['status']): 'ok' | 'danger' | 'warn' {
  if (s === 'Approved') return 'ok';
  if (s === 'Rejected') return 'danger';
  return 'warn';
}
function fmtDate(d: string) {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' });
}
function fmtSGD(n: number) {
  return n.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ─── Shared claim form fields ─────────────────────────────────────────────────
interface ClaimFormState { date: string; categoryId: string; merchant: string; amount: string; description: string; }

/**
 * The fields both the submit and the amend form share, laid out to the
 * "Claims — submit" artboard: one column, ≤640px, the GST line computed from
 * the category, the policy limit named where one exists. Presentation only —
 * the calling modal owns state, validation and the request.
 */
function ClaimFields({ form, set, categories, selectedCat, gst, extra }: {
  form: ClaimFormState; set: (k: string, v: string) => void; categories: ClaimCategory[];
  selectedCat: ClaimCategory | undefined; gst: number; extra?: ReactNode;
}) {
  const amountNum = parseFloat(form.amount) || 0;
  const overLimit = !!selectedCat?.maxAmount && amountNum > selectedCat.maxAmount;
  return (
    <div className="flex flex-col gap-5">
      <Field label="Category" required help={selectedCat?.maxAmount ? `Policy limit S$${fmtSGD(selectedCat.maxAmount)} per claim` : undefined}>
        <Select value={form.categoryId} onChange={e => set('categoryId', e.target.value)}>
          {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
      </Field>

      <Field label="Expense date" required>
        <Input type="date" value={form.date} max={new Date().toISOString().slice(0, 10)} onChange={e => set('date', e.target.value)} />
      </Field>

      <Field label="Merchant or payee" required>
        <Input type="text" value={form.merchant} onChange={e => set('merchant', e.target.value)} placeholder="e.g. Grab, Singapore Airlines, NTUC FairPrice" />
      </Field>

      <Field
        label="Amount, incl. GST"
        required
        error={overLimit ? `Above the S$${fmtSGD(selectedCat!.maxAmount!)} policy limit for this category` : undefined}
      >
        <div className="relative">
          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-semibold text-muted">S$</span>
          <Input type="number" value={form.amount} onChange={e => set('amount', e.target.value)} placeholder="0.00" min="0" step="0.01" className="pl-10" invalid={overLimit} />
        </div>
      </Field>

      <div className="flex items-center justify-between gap-3 px-3.5 py-3 rounded-control bg-pill text-sm">
        <span className="text-muted">{selectedCat?.isGstClaimable ? 'GST at 9%, included in the amount' : 'GST not claimable for this category'}</span>
        <span className="font-bold text-ink tabular-nums">S${fmtSGD(gst)}</span>
      </div>

      <Field label="Business purpose" required>
        <Textarea
          value={form.description}
          onChange={e => set('description', e.target.value)}
          rows={3}
          placeholder="What was this expense for?"
          className="resize-none"
        />
      </Field>

      {extra}
    </div>
  );
}

function FormError({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 px-3.5 py-3 rounded-control bg-danger-bg text-sm text-danger">
      <Icon name="alert" size={16} className="mt-0.5 shrink-0" />{children}
    </div>
  );
}

// ─── Submit Claim Modal ───────────────────────────────────────────────────────
interface SubmitModalProps {
  onClose: () => void;
  onCreated: (c: Claim) => void;
  categories: ClaimCategory[];
}

function SubmitClaimModal({ onClose, onCreated, categories }: SubmitModalProps) {
  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    categoryId: categories[0]?.id ?? '',
    merchant: '',
    amount: '',
    description: '',
  });
  const [receipt, setReceipt] = useState<string | null>(null);
  const [receiptName, setReceiptName] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!form.categoryId && categories.length > 0) setForm(f => ({ ...f, categoryId: categories[0].id }));
  }, [categories]);

  const set = (k: string, v: string) => setForm(prev => ({ ...prev, [k]: v }));
  const amountNum = parseFloat(form.amount) || 0;
  const selectedCat = categories.find(c => c.id === form.categoryId);
  const gst = selectedCat?.isGstClaimable ? parseFloat((amountNum * 0.09 / 1.09).toFixed(2)) : 0;

  const handleFile = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setReceiptName(f.name);
    const reader = new FileReader();
    reader.onload = ev => setReceipt(ev.target?.result as string);
    reader.readAsDataURL(f);
  };

  const handleSubmit = async () => {
    if (!form.merchant.trim() || !form.amount || !form.description.trim() || !form.categoryId) return;
    setSubmitting(true); setError(null);
    try {
      const saved = await apiFetch('/claims', {
        method: 'POST',
        body: JSON.stringify({
          categoryId: form.categoryId,
          title: form.merchant,
          description: form.description,
          claimDate: form.date,
          totalAmount: amountNum,
          gstAmount: gst,
        }),
      });
      onCreated({
        id: saved.id,
        date: saved.claimDate.slice(0, 10),
        category: selectedCat?.name ?? form.categoryId,
        categoryCode: selectedCat?.code ?? '',
        merchant: saved.title,
        amount: saved.totalAmount,
        gst: saved.gstAmount ?? 0,
        description: saved.description ?? '',
        receipt: null,
        status: saved.status === 'SUBMITTED' ? 'Pending' : saved.status === 'APPROVED' ? 'Approved' : 'Rejected',
        submittedOn: (saved.submittedAt ?? saved.createdAt).slice(0, 10),
      });
      onClose();
    } catch (e: any) {
      setError(e.message ?? 'Submission failed');
    } finally {
      setSubmitting(false);
    }
  };

  const incomplete = !form.merchant.trim() || !form.amount || !form.description.trim() || !form.categoryId;

  return (
    <Modal open
      title="Submit a claim"
      caption="Expense reimbursement · paid with the next payroll once approved"
      onClose={onClose}
      footer={
        <>
          <span className="mr-auto text-sm text-muted">Total <span className="font-bold text-ink tabular-nums">S${fmtSGD(amountNum)}</span></span>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon="arrowRight" onClick={handleSubmit} disabled={incomplete || submitting} reason={!submitting && incomplete ? 'Fill in every required field' : undefined}>
            {submitting ? 'Submitting…' : 'Submit claim'}
          </Button>
        </>
      }
    >
      <ClaimFields
        form={form} set={set} categories={categories} selectedCat={selectedCat} gst={gst}
        extra={
          <>
            <div className="flex flex-col gap-1.5">
              <span className="text-[12.5px] font-semibold text-muted">Receipt <span className="font-normal">· optional, JPG, PNG or PDF</span></span>
              {receipt ? (
                <div className="flex items-center justify-between gap-3 px-3.5 py-3 rounded-control border border-accent bg-tint">
                  <div className="flex items-center gap-3 min-w-0">
                    <Icon name="paperclip" size={18} className="text-accent shrink-0" />
                    <p className="text-sm font-semibold text-ink truncate">{receiptName ?? 'Receipt attached'}</p>
                  </div>
                  <Button size="sm" variant="secondary" onClick={() => { setReceipt(null); setReceiptName(null); }}>Remove</Button>
                </div>
              ) : (
                <button type="button" onClick={() => fileRef.current?.click()}
                  className="flex items-center justify-center gap-2.5 px-4 py-5 rounded-control border border-dashed border-rule bg-pill text-sm font-semibold text-muted hover:border-accent hover:text-ink transition-colors">
                  <Icon name="upload" size={18} />
                  Attach receipt
                </button>
              )}
              <input ref={fileRef} type="file" accept="image/*,.pdf" className="hidden" onChange={handleFile} />
            </div>
            {error && <FormError>{error}</FormError>}
          </>
        }
      />
    </Modal>
  );
}

// ─── Edit Claim Modal ─────────────────────────────────────────────────────────
interface EditModalProps {
  claim: Claim;
  onClose: () => void;
  onSaved: (updated: Claim) => void;
  categories: ClaimCategory[];
}

function EditClaimModal({ claim, onClose, onSaved, categories }: EditModalProps) {
  const [form, setForm] = useState<ClaimFormState>({
    date: claim.date,
    categoryId: categories.find(c => c.name === claim.category)?.id ?? categories[0]?.id ?? '',
    merchant: claim.merchant,
    amount: String(claim.amount),
    description: claim.description,
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (k: string, v: string) => setForm(prev => ({ ...prev, [k]: v }));
  const amountNum = parseFloat(form.amount) || 0;
  const selectedCat = categories.find(c => c.id === form.categoryId);
  const gst = selectedCat?.isGstClaimable ? parseFloat((amountNum * 0.09 / 1.09).toFixed(2)) : 0;

  const handleSave = async () => {
    if (!form.merchant.trim() || !form.amount || !form.description.trim()) return;
    setSubmitting(true); setError(null);
    try {
      const saved = await apiFetch(`/claims/${claim.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          categoryId: form.categoryId,
          title: form.merchant,
          description: form.description,
          claimDate: form.date,
          totalAmount: amountNum,
          gstAmount: gst,
        }),
      });
      onSaved({
        ...claim,
        date: saved.claimDate.slice(0, 10),
        category: selectedCat?.name ?? claim.category,
        categoryCode: selectedCat?.code ?? claim.categoryCode,
        merchant: saved.title,
        amount: saved.totalAmount,
        gst: saved.gstAmount ?? 0,
        description: saved.description ?? '',
      });
      onClose();
    } catch (e: any) {
      setError(e.message ?? 'Update failed');
    } finally {
      setSubmitting(false);
    }
  };

  const incomplete = !form.merchant.trim() || !form.amount || !form.description.trim();

  return (
    <Modal open
      title="Amend claim"
      caption="Changes to a pending claim are saved straight away"
      onClose={onClose}
      footer={
        <>
          <span className="mr-auto text-sm text-muted">Total <span className="font-bold text-ink tabular-nums">S${fmtSGD(amountNum)}</span></span>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={handleSave} disabled={incomplete || submitting}>
            {submitting ? 'Saving…' : 'Save changes'}
          </Button>
        </>
      }
    >
      <ClaimFields form={form} set={set} categories={categories} selectedCat={selectedCat} gst={gst} extra={error ? <FormError>{error}</FormError> : undefined} />
    </Modal>
  );
}

// ─── Employee Claims View ─────────────────────────────────────────────────────
function EmployeeClaimsView() {
  const { user } = useAuth();
  const [showModal, setShowModal] = useState(false);
  const [editClaim, setEditClaim] = useState<Claim | null>(null);
  const [categories, setCategories] = useState<ClaimCategory[]>([]);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    async function load() {
      try {
        const [cats, claimsRes] = await Promise.allSettled([
          apiFetch('/claims/categories'),
          user?.employeeId
            ? apiFetch(`/claims?employeeId=${user.employeeId}&limit=100`)
            : apiFetch('/claims?limit=100'),
        ]);
        if (cats.status === 'fulfilled') setCategories((cats.value as ClaimCategory[]).filter((c: any) => c.isActive !== false));
        if (claimsRes.status === 'fulfilled') {
          const list = claimsRes.value.claims ?? [];
          setClaims(list.map((c: any) => ({
            id: c.id,
            date: c.claimDate.slice(0, 10),
            category: c.category?.name ?? c.categoryId,
            categoryCode: c.category?.code ?? '',
            merchant: c.title,
            amount: c.totalAmount,
            gst: c.gstAmount ?? 0,
            description: c.description ?? '',
            receipt: null,
            status: c.status === 'SUBMITTED' ? 'Pending' : c.status === 'APPROVED' ? 'Approved' : c.status === 'REJECTED' ? 'Rejected' : 'Pending',
            submittedOn: (c.submittedAt ?? c.createdAt).slice(0, 10),
          })));
        }
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [user?.employeeId]);

  const totalApproved = claims.filter(c => c.status === 'Approved').reduce((s, c) => s + c.amount, 0);
  const totalPending  = claims.filter(c => c.status === 'Pending').reduce((s, c) => s + c.amount, 0);
  const totalGst      = claims.filter(c => c.status === 'Approved').reduce((s, c) => s + c.gst, 0);
  const pendingCount  = claims.filter(c => c.status === 'Pending').length;

  const handleCreated = (c: Claim) => {
    setClaims(prev => [c, ...prev]);
    toast(`Claim of S$${fmtSGD(c.amount)} submitted for approval`, 'ok');
  };

  const handleSaved = (updated: Claim) => {
    setClaims(prev => prev.map(c => c.id === updated.id ? updated : c));
    toast(`Claim updated — S$${fmtSGD(updated.amount)}`, 'ok');
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-10 h-10 border-4 border-accent border-t-accent animate-spin rounded-full" />
      </div>
    );
  }

  const columns: Column<Claim>[] = [
    {
      key: 'merchant', label: 'Claim', width: 'minmax(0, 1.8fr)',
      render: (c) => (
        <span className="flex items-center gap-3 min-w-0">
          <span className="flex items-center justify-center w-9 h-9 rounded-control bg-tint text-accent shrink-0"><Icon name={categoryIcon(c.categoryCode)} size={17} /></span>
          <span className="flex flex-col min-w-0">
            <span className="font-semibold truncate">{c.merchant}</span>
            <span className="text-xs text-muted truncate">{c.description}</span>
          </span>
        </span>
      ),
    },
    { key: 'category', label: 'Category', width: 'minmax(0, 0.9fr)', render: (c) => <Badge tone="neutral">{c.category}</Badge> },
    { key: 'date', label: 'Expense date', width: '130px', numeric: true, render: (c) => fmtDate(c.date) },
    {
      key: 'amount', label: 'Amount', width: '130px', align: 'right', numeric: true,
      render: (c) => (
        <span className="flex flex-col items-end">
          <span className="font-semibold">S${fmtSGD(c.amount)}</span>
          {c.gst > 0 && <span className="text-xs text-muted">GST {fmtSGD(c.gst)}</span>}
        </span>
      ),
    },
    { key: 'status', label: 'Status', width: '110px', render: (c) => <Badge tone={statusTone(c.status)}>{c.status}</Badge> },
    {
      key: 'actions', label: '', width: '80px', align: 'right',
      render: (c) => c.status === 'Pending'
        ? <span onClick={(e) => e.stopPropagation()}><Button size="sm" variant="secondary" onClick={() => setEditClaim(c)}>Edit</Button></span>
        : null,
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="My claims"
        subtitle={pendingCount > 0 ? `${pendingCount} claim${pendingCount === 1 ? '' : 's'} waiting for approval` : 'Submit and track expense reimbursements'}
        actions={<Button variant="primary" icon="plus" onClick={() => setShowModal(true)}>Submit a claim</Button>}
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Stat label="Approved" value={`S$${fmtSGD(totalApproved)}`} note="Ready for payout with payroll" />
        <Stat label="Pending review" value={`S$${fmtSGD(totalPending)}`} note={`${pendingCount} awaiting approval`} />
        <Stat label="GST on approved claims" value={`S$${fmtSGD(totalGst)}`} note="Captured at 9%" />
      </div>

      {categories.length > 0 && (
        <Card padding="px-5 py-4">
          <p className="text-[12.5px] font-semibold text-muted mb-2.5">Categories you can claim</p>
          <div className="flex flex-wrap gap-2">
            {categories.map(c => (
              <span key={c.id} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full bg-pill text-[12.5px] font-semibold text-ink">
                <Icon name={categoryIcon(c.code)} size={14} className="text-muted" />
                {c.name}
                {c.maxAmount != null && <span className="text-muted font-normal tabular-nums">· up to S${fmtSGD(c.maxAmount)}</span>}
              </span>
            ))}
          </div>
        </Card>
      )}

      <DataTable
        columns={columns}
        rows={claims}
        rowKey={(c) => c.id}
        rowHeight={60}
        aria-label="My claims"
        mobileCard={(c) => (
          <div className="flex items-start gap-3">
            <span className="flex items-center justify-center w-9 h-9 rounded-control bg-tint text-accent shrink-0"><Icon name={categoryIcon(c.categoryCode)} size={17} /></span>
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-semibold text-ink truncate">{c.merchant}</span>
                <span className="text-sm font-semibold text-ink tabular-nums shrink-0">S${fmtSGD(c.amount)}</span>
              </div>
              <p className="text-xs text-muted truncate mt-0.5">{c.category} · {fmtDate(c.date)}{c.description ? ` · ${c.description}` : ''}</p>
              <div className="flex items-center justify-between gap-3 mt-2">
                <Badge tone={statusTone(c.status)}>{c.status}</Badge>
                {c.status === 'Pending' && <Button size="sm" variant="secondary" onClick={(e) => { e.stopPropagation(); setEditClaim(c); }}>Edit</Button>}
              </div>
            </div>
          </div>
        )}
        footer={claims.length > 0 ? <><span>{claims.length} claim{claims.length === 1 ? '' : 's'}</span><span>Approved claims are reimbursed with monthly payroll</span></> : undefined}
        empty={
          <EmptyState
            icon="receipt"
            title="No claims yet"
            description="Expenses you submit appear here with their approval status."
            action={<Button variant="primary" icon="plus" onClick={() => setShowModal(true)}>Submit a claim</Button>}
          />
        }
      />

      {showModal && <SubmitClaimModal onClose={() => setShowModal(false)} onCreated={handleCreated} categories={categories} />}
      {editClaim && <EditClaimModal claim={editClaim} onClose={() => setEditClaim(null)} onSaved={handleSaved} categories={categories} />}

    </div>
  );
}

// ─── Entry point ──────────────────────────────────────────────────────────────
export default function ClaimsPage() {
  return <EmployeeClaimsView />;
}
