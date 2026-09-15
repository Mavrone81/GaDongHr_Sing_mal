'use client';

import { useState, useEffect, type ReactNode } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { PageHeader, Stat, Badge, Button, Card, CardHeader, EmptyState, useToast, SplitPane, InboxList, Avatar } from '@/components/ui';

const ALLOWED_ROLES = ['SUPER_ADMIN', 'HR_ADMIN', 'HR_MANAGER', 'FINANCE_ADMIN', 'PAYROLL_OFFICER'];

function fmtSGD(n: number) {
  return n.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(d: string) {
  if (!d) return '—';
  const dt = new Date(d + 'T00:00:00');
  return isNaN(dt.getTime()) ? d : dt.toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' });
}

interface PendingClaim {
  id: string;
  employeeId: string;
  employeeName: string;
  dept: string;
  categoryName: string;
  title: string;
  claimDate: string;
  totalAmount: number;
  gstAmount: number;
}

export default function ClaimsRegistryPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-10 h-10 border-4 border-accent border-t-accent animate-spin rounded-full" />
      </div>
    );
  }

  const role = user?.role?.toUpperCase() ?? '';
  if (!ALLOWED_ROLES.includes(role)) {
    router.replace('/claims');
    return null;
  }

  return <AdminClaimsView />;
}

/**
 * Approvals inbox (spec screen type 6): the queue on the left, the selected
 * claim on the right at ≥1280px, stacked below that. Approve / reject act on
 * the row directly so a reviewer never has to open a claim to clear it.
 *
 * The old version also showed "Avg. processing 48h" and "Policy compliance
 * 98.2%". Those were string literals — never computed from anything — and a
 * finance screen must not print numbers it did not measure. They are gone.
 */
function AdminClaimsView() {
  const [claims, setClaims] = useState<PendingClaim[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const data = await apiFetch('/claims?status=SUBMITTED&limit=100');
        const list: any[] = data.claims ?? data ?? [];
        setClaims(list.map((c: any) => ({
          id: c.id,
          employeeId: c.employeeId,
          employeeName: c.employee?.fullName ?? c.employeeId,
          dept: c.employee?.department ?? '—',
          categoryName: c.category?.name ?? c.categoryId ?? '—',
          title: c.title ?? c.merchant ?? '',
          claimDate: (c.claimDate ?? c.createdAt ?? '').slice(0, 10),
          totalAmount: typeof c.totalAmount === 'number' ? c.totalAmount : parseFloat(c.totalAmount ?? '0'),
          gstAmount: typeof c.gstAmount === 'number' ? c.gstAmount : parseFloat(c.gstAmount ?? '0'),
        })));
      } catch (e: any) {
        console.error('[ClaimsRegistry] load failed:', e.message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const showToast = (msg: string, type: 'success' | 'error') => toast(msg, type === 'success' ? 'ok' : 'danger');

  const handleApprove = async (id: string) => {
    try {
      await apiFetch(`/claims/${id}/approve`, { method: 'PUT' });
      setClaims(prev => prev.filter(c => c.id !== id));
      showToast('Claim approved', 'success');
    } catch (e: any) { showToast(e.message, 'error'); }
  };

  const handleReject = async (id: string) => {
    try {
      await apiFetch(`/claims/${id}/reject`, { method: 'PUT', body: JSON.stringify({ reason: 'Rejected by Finance' }) });
      setClaims(prev => prev.filter(c => c.id !== id));
      showToast('Claim rejected', 'success');
    } catch (e: any) { showToast(e.message, 'error'); }
  };

  const totalPending = claims.reduce((s, c) => s + c.totalAmount, 0);
  const totalGst = claims.reduce((s, c) => s + c.gstAmount, 0);
  const selected = claims.find(c => c.id === selectedId) ?? null;

  const list = loading ? (
    <Card className="items-center py-14"><div className="w-8 h-8 border-4 border-accent border-t-accent animate-spin rounded-full" /></Card>
  ) : (
    <InboxList
      aria-label="Claims waiting for approval"
      items={claims}
      itemKey={(c) => c.id}
      selectedKey={selectedId}
      onSelect={(c) => setSelectedId(c.id === selectedId ? null : c.id)}
      footer={claims.length > 0 ? <><span>{claims.length} of {claims.length}</span><span>Newest first</span></> : undefined}
      empty={<EmptyState icon="receipt" title="No claims to approve" description="Submitted claims from employees will appear here for a decision." />}
      render={(c) => (
        <div className="flex items-start gap-3 min-w-0">
          <Avatar name={c.employeeName} tone="soft" size={36} className="mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm font-semibold text-ink truncate">{c.employeeName}</span>
              <span className="text-sm font-semibold text-ink tabular-nums shrink-0">S${fmtSGD(c.totalAmount)}</span>
            </div>
            <div className="flex items-center justify-between gap-3 mt-0.5">
              <span className="text-xs text-muted truncate">{c.dept} · {c.categoryName}{c.title ? ` · ${c.title}` : ''}</span>
              <span className="text-xs text-muted tabular-nums shrink-0">{fmtDate(c.claimDate)}</span>
            </div>
            {/* Decide from the row: a reviewer never has to open a claim to clear it. */}
            <div className="flex gap-1.5 mt-2.5" onClick={(e) => e.stopPropagation()}>
              <Button size="sm" variant="secondary" onClick={() => handleReject(c.id)}>Reject</Button>
              <Button size="sm" variant="primary" onClick={() => handleApprove(c.id)}>Approve</Button>
            </div>
          </div>
        </div>
      )}
    />
  );

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Claims approvals"
        subtitle={loading ? 'Loading the queue…' : claims.length === 0 ? 'Nothing waiting for a decision' : `${claims.length} claim${claims.length === 1 ? '' : 's'} waiting · S$${fmtSGD(totalPending)} in total`}
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Stat label="Waiting for approval" value={loading ? '—' : claims.length} note="Submitted, not yet decided" />
        <Stat label="Amount pending" value={loading ? '—' : `S$${fmtSGD(totalPending)}`} note={loading ? undefined : `incl. S$${fmtSGD(totalGst)} GST`} />
        <Stat label="Oldest in queue" value={loading || claims.length === 0 ? '—' : fmtDate([...claims].sort((a, b) => a.claimDate.localeCompare(b.claimDate))[0].claimDate)} note="By expense date" />
      </div>

      {/* Inbox (spec screen type 6): queue left, selected claim right at ≥1280px;
          below that the list shows until a row is picked, then the detail with a back link. */}
      <SplitPane
        hasDetail={!!selected}
        onBack={() => setSelectedId(null)}
        backLabel="Back to the queue"
        list={list}
        detail={selected ? (
          <Card>
            <div className="flex items-start gap-3.5 mb-4">
              <Avatar name={selected.employeeName} tone="soft" size={44} />
              <CardHeader className="mb-0 min-w-0" title={selected.employeeName} caption={`${selected.dept} · ${selected.categoryName}`} />
            </div>
            <dl className="flex flex-col divide-y divide-rule text-sm border-y border-rule">
              <Row k="Amount" v={<span className="font-semibold tabular-nums">S${fmtSGD(selected.totalAmount)}</span>} />
              {selected.gstAmount > 0 && <Row k="GST included" v={<span className="tabular-nums">S${fmtSGD(selected.gstAmount)}</span>} />}
              <Row k="Expense date" v={<span className="tabular-nums">{fmtDate(selected.claimDate)}</span>} />
              <Row k="Description" v={selected.title || <span className="text-faint">None given</span>} />
              <Row k="Status" v={<Badge tone="warn">Awaiting decision</Badge>} />
            </dl>
            <div className="flex gap-2.5 mt-5">
              <Button variant="secondary" className="flex-1" onClick={() => handleReject(selected.id)}>Reject</Button>
              <Button variant="primary" className="flex-1" onClick={() => handleApprove(selected.id)}>Approve</Button>
            </div>
          </Card>
        ) : null}
      />
    </div>
  );
}

function Row({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <dt className="text-muted shrink-0">{k}</dt>
      <dd className="text-right text-ink min-w-0">{v}</dd>
    </div>
  );
}
