'use client';

/**
 * The payslip register — the reference implementation for the conversion.
 *
 * A payslip is the artefact this design system exists for: a figure someone may
 * have to defend. So the statutory numbers carry their authority (CPF Act s.7),
 * the arithmetic is checkable down a column of tabular figures, and an action
 * that is unavailable says why instead of vanishing.
 *
 * Rebuilt to the "Clean workspace" kit (2026-09). Presentation only: every
 * fetch, sort, filter and download below is unchanged. The seal stays — it is
 * the whole point of the screen — and rides in the CPF summary tile.
 *
 * On the seals: only CPF and the EA s.21 payment deadline belong here. SDL is
 * an EMPLOYER levy, not withheld from the employee, so it is not on this
 * statement and carries no seal here.
 */

import React, { useState, useEffect, useMemo } from 'react';
import { apiFetch, apiFetchRaw } from '@/lib/api';
import { Seal } from '@/components/official';
import { PageHeader, Card, Stat, DataTable, Button, EmptyState, Icon } from '@/components/ui';
import { fmtSGD, fmtPeriod } from './format';

interface Payslip {
  id: string;
  period: string;
  basicSalary: number;
  grossPay: number;
  netPay: number;
  employeeCpf: number;
  ytdGross: number | null;
  ytdEmployeeCpf: number | null;
}

type SortCol = 'period' | 'basic' | 'gross' | 'cpf' | 'net';

export function EmployeePayslipsView() {
  const [payslips, setPayslips] = useState<Payslip[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedYear, setSelectedYear] = useState<string>('all');
  const [downloading, setDownloading] = useState<string | null>(null);
  const [bulkDownloading, setBulkDownloading] = useState(false);
  const [dlToast, setDlToast] = useState<string | null>(null);
  const [psSort, setPsSort] = useState<{ col: SortCol; dir: 'asc' | 'desc' }>({ col: 'period', dir: 'desc' });

  useEffect(() => {
    const load = async () => {
      try {
        const data = await apiFetch('/payroll/payslips/me');
        setPayslips(data.payslips ?? []);
      } catch (e: any) {
        setError(e.message || 'Failed to load payslips');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const years = useMemo(() => {
    const s = new Set(payslips.map(p => p.period.slice(0, 4)));
    return Array.from(s).sort((a, b) => b.localeCompare(a));
  }, [payslips]);

  const filtered = useMemo(() => {
    const base = selectedYear === 'all' ? payslips : payslips.filter(p => p.period.startsWith(selectedYear));
    const d = psSort.dir === 'asc' ? 1 : -1;
    return [...base].sort((a, b) => {
      switch (psSort.col) {
        case 'period': return d * a.period.localeCompare(b.period);
        case 'basic':  return d * (a.basicSalary - b.basicSalary);
        case 'gross':  return d * (a.grossPay - b.grossPay);
        case 'cpf':    return d * (a.employeeCpf - b.employeeCpf);
        case 'net':    return d * (a.netPay - b.netPay);
        default: return 0;
      }
    });
  }, [payslips, selectedYear, psSort]);

  const totals = useMemo(() => ({
    gross: filtered.reduce((s, p) => s + p.grossPay, 0),
    net:   filtered.reduce((s, p) => s + p.netPay, 0),
    cpf:   filtered.reduce((s, p) => s + p.employeeCpf, 0),
  }), [filtered]);

  function togglePsSort(col: SortCol) {
    setPsSort(prev => prev.col === col ? { col, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'asc' });
  }

  /** A sortable column heading. Sentence case; the caret only annotates it. */
  function SortHeader({ col, label }: { col: SortCol; label: string }) {
    const active = psSort.col === col;
    return (
      <button
        type="button"
        onClick={() => togglePsSort(col)}
        aria-label={`Sort by ${label}`}
        className={`inline-flex items-center gap-1 font-bold ${active ? 'text-ink' : 'hover:text-ink'}`}
      >
        {label}
        {active && <Icon name="chevronDown" size={12} className={psSort.dir === 'asc' ? 'rotate-180' : ''} />}
      </button>
    );
  }

  const downloadPdf = async (period: string, label?: string) => {
    setDownloading(period);
    try {
      const res = await apiFetchRaw(`/payroll/payslips/me/${period}`);
      if (!res.ok) throw new Error('Download failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `payslip-${period}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      setDlToast(`Downloaded: ${label || period}`);
      setTimeout(() => setDlToast(null), 2500);
    } catch {
      setDlToast('Download failed — payslip may not be available yet');
      setTimeout(() => setDlToast(null), 3000);
    } finally {
      setDownloading(null);
    }
  };

  const bulkDownload = async () => {
    if (!filtered.length) return;
    setBulkDownloading(true);
    for (let i = 0; i < filtered.length; i++) {
      await downloadPdf(filtered[i].period);
      if (i < filtered.length - 1) await new Promise(r => setTimeout(r, 400));
    }
    setBulkDownloading(false);
    setDlToast(`Downloaded ${filtered.length} payslip${filtered.length > 1 ? 's' : ''}`);
    setTimeout(() => setDlToast(null), 3000);
  };

  if (loading) {
    return <div className="py-16 text-center text-sm text-muted">Loading payslips…</div>;
  }

  const scope = selectedYear === 'all' ? 'All years' : selectedYear;

  return (
    <div className="flex flex-col gap-8 max-w-5xl mx-auto pb-16">

      {/* eyebrow:the statutory form number (IR8A) rides above the page title */}
      <div className="flex flex-col gap-1">
        <p className="text-[12.5px] font-semibold text-accent">Employee self-service · IR8A</p>
        <PageHeader
          title="My payslips"
          subtitle="Salary statements and CPF contribution history — the figures your year-end IR8A is built from."
        />
      </div>

      {/* Period filter */}
      <div className="flex flex-col gap-2">
        <span className="text-[12.5px] font-semibold text-muted">Period</span>
        <div className="flex items-center gap-2 flex-wrap">
          <Button size="sm" variant={selectedYear === 'all' ? 'primary' : 'secondary'} onClick={() => setSelectedYear('all')}>
            All years
          </Button>
          {years.map(y => (
            <Button key={y} size="sm" variant={selectedYear === y ? 'primary' : 'secondary'} onClick={() => setSelectedYear(y)}>
              {y}
            </Button>
          ))}
        </div>
      </div>

      {error && (
        <Card>
          <p className="text-[15.5px] font-bold text-ink">Payslips could not be loaded</p>
          <p className="text-sm text-muted mt-1">{error}</p>
        </Card>
      )}

      {!error && (
        <>
          {/* Summary — the CPF tile carries the seal */}
          <div className="grid gap-4 sm:grid-cols-3">
            <Stat label="Gross pay" value={`SGD ${fmtSGD(totals.gross)}`} note={`${scope} · ${filtered.length} statement${filtered.length === 1 ? '' : 's'}`} />
            <Stat
              label="Employee CPF"
              value={`− SGD ${fmtSGD(totals.cpf)}`}
              note={<span className="inline-flex items-center gap-1.5">Withheld from gross <Seal cite="CPF Act s.7 · Jan 2026 table" /></span>}
            />
            <Stat label="Net pay" value={`SGD ${fmtSGD(totals.net)}`} note={scope} />
          </div>

          {/* The register */}
          <section className="flex flex-col gap-4">
            <div className="flex items-end justify-between gap-4 flex-wrap">
              <div className="flex flex-col gap-0.5">
                <h2 className="text-[18px] font-bold text-ink">Statements</h2>
                <p className="text-[13px] text-muted">Published payslips only</p>
              </div>
              <Button
                variant="secondary"
                icon="download"
                onClick={bulkDownload}
                disabled={bulkDownloading || filtered.length === 0}
                reason={
                  bulkDownloading ? 'Download in progress'
                    : filtered.length === 0 ? 'No published payslips in this period'
                    : undefined
                }
              >
                {bulkDownloading ? 'Downloading…' : `Download all (${filtered.length})`}
              </Button>
            </div>

            {filtered.length === 0 ? (
              <EmptyState
                icon="receipt"
                title="No payslips in this period"
                description="Published payslips appear here once payroll has been processed and released."
              />
            ) : (
              <DataTable<Payslip>
                columns={[
                  { key: 'period', label: <SortHeader col="period" label="Pay period" />, width: 'minmax(0, 1.7fr)',
                    render: (ps) => (
                      <span>{fmtPeriod(ps.period)}<span className="text-faint tabular-nums"> · {ps.period}</span></span>
                    ) },
                  { key: 'basic', label: <SortHeader col="basic" label="Basic" />, numeric: true, align: 'right',
                    render: (ps) => fmtSGD(ps.basicSalary) },
                  { key: 'gross', label: <SortHeader col="gross" label="Gross" />, numeric: true, align: 'right',
                    render: (ps) => fmtSGD(ps.grossPay) },
                  // The minus sign, not a colour, says "deduction" — a figure that
                  // only reads as negative in red is one half the readers misread.
                  { key: 'cpf', label: <SortHeader col="cpf" label="CPF (employee)" />, numeric: true, align: 'right',
                    render: (ps) => `− ${fmtSGD(ps.employeeCpf)}` },
                  { key: 'net', label: <SortHeader col="net" label="Net pay" />, numeric: true, align: 'right',
                    render: (ps) => <span className="font-semibold text-ink">{fmtSGD(ps.netPay)}</span> },
                  { key: 'pdf', label: 'Statement', width: '128px', align: 'right',
                    render: (ps) => (
                      <Button
                        variant="ghost"
                        size="sm"
                        icon="download"
                        onClick={() => downloadPdf(ps.period, fmtPeriod(ps.period))}
                        disabled={downloading === ps.period}
                        reason={downloading === ps.period ? 'Preparing…' : undefined}
                      >
                        PDF
                      </Button>
                    ) },
                ]}
                rows={filtered}
                rowKey={(ps) => ps.id}
                footer={
                  <>
                    <span>Net pay · {scope}</span>
                    <span className="font-bold text-ink tabular-nums">SGD {fmtSGD(totals.net)}</span>
                  </>
                }
              />
            )}

            <p className="text-xs text-muted flex items-center gap-2 flex-wrap">
              Salary is payable within 7 days of the end of the salary period.
              <Seal cite="EA s.21 · within 7 days" />
            </p>
            <p className="text-xs text-muted">
              All amounts in SGD. Figures shown are as published; contact HR if a statement is missing or disputed.
            </p>
          </section>
        </>
      )}

      {/* Download confirmation */}
      {dlToast && (
        <div role="status" className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[200]">
          <p className="bg-shadow text-paper px-6 py-3 text-xs rounded-control shadow-card">{dlToast}</p>
        </div>
      )}
    </div>
  );
}
