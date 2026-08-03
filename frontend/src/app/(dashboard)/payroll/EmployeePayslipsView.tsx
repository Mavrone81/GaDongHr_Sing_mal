'use client';

/**
 * The payslip register — the reference implementation for the conversion.
 *
 * A payslip is the artefact this design system exists for: a figure someone may
 * have to defend. So the statutory numbers carry their authority (CPF Act s.7),
 * the arithmetic is checkable down a column of tabular figures, and the actions
 * that are unavailable say why instead of vanishing.
 *
 * On the seals: the spec's §4.1 list named CPF, SDL and the EA s.21 payment
 * deadline. Only two of the three belong here. SDL is an EMPLOYER levy — it is
 * not withheld from the employee and does not appear on this statement, so a
 * seal for it would cite an authority for a figure that is not on the page,
 * which is exactly the decoration the reservation rule exists to prevent.
 */

import React, { useState, useEffect, useMemo } from 'react';
import { apiFetch, apiFetchRaw } from '@/lib/api';
import { Field, Seal, Button, DataTable, Notice } from '@/components/official';
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

  /** A column heading that sorts. The word stays; the arrow only annotates it. */
  function SortHeader({ col, label }: { col: SortCol; label: string }) {
    const active = psSort.col === col;
    return (
      <button
        type="button"
        onClick={() => togglePsSort(col)}
        aria-label={`Sort by ${label}`}
        className="inline-flex items-center gap-1 uppercase tracking-[0.08em] hover:text-ink"
      >
        {label}
        <span aria-hidden className="text-[0.5rem]">{active ? (psSort.dir === 'asc' ? '▲' : '▼') : '⇅'}</span>
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
    return <p className="eyebrow-tight py-16 text-center">Loading payslips…</p>;
  }

  const scope = selectedYear === 'all' ? 'All years' : selectedYear;

  return (
    <div className="flex flex-col gap-10 max-w-[64rem] mx-auto pb-20">

      {/* ── Statement head ─────────────────────────────────────────────── */}
      <header>
        <p className="eyebrow">Employee Self-Service · IR8A</p>
        <h1 className="text-3xl font-semibold text-ink mt-1">My Payslips</h1>
        <p className="text-sm text-muted mt-1">
          Salary statements and CPF contribution history. These are the figures your
          year-end IR8A is built from.
        </p>
      </header>

      {/* ── Period selector ────────────────────────────────────────────── */}
      <section className="border-b border-rule pb-4">
        <p className="label-form mb-2">Period</p>
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant={selectedYear === 'all' ? 'accent' : 'quiet'}
            onClick={() => setSelectedYear('all')}
          >
            All years
          </Button>
          {years.map(y => (
            <Button
              key={y}
              variant={selectedYear === y ? 'accent' : 'quiet'}
              onClick={() => setSelectedYear(y)}
            >
              {y}
            </Button>
          ))}
        </div>
      </section>

      {error && (
        <Notice heading="Payslips could not be loaded">{error}</Notice>
      )}

      {!error && (
        <>
          {/* ── Summary ──────────────────────────────────────────────── */}
          <section>
            <h2 className="text-lg font-semibold text-ink">Summary</h2>
            <p className="eyebrow mt-0.5">{scope} · {filtered.length} statement{filtered.length === 1 ? '' : 's'}</p>
            <div className="mt-4 border-t border-rule">
              <Field label="Gross pay" hint={scope} value={`SGD ${fmtSGD(totals.gross)}`} />
              <Field
                label="Employee CPF"
                hint="Withheld from gross"
                value={`− SGD ${fmtSGD(totals.cpf)}`}
                seal={<Seal cite="CPF Act s.7 · Jan 2026 table" />}
              />
              <Field label="Net pay" hint={scope} value={`SGD ${fmtSGD(totals.net)}`} />
            </div>
          </section>

          {/* ── The register ─────────────────────────────────────────── */}
          <section>
            <div className="flex items-end justify-between gap-4 flex-wrap">
              <div>
                <h2 className="text-lg font-semibold text-ink">Statements</h2>
                <p className="eyebrow mt-0.5">Published payslips only</p>
              </div>
              <Button
                variant="secondary"
                onClick={bulkDownload}
                disabled={bulkDownloading || filtered.length === 0}
                reason={
                  bulkDownloading ? 'Download in progress'
                    : filtered.length === 0 ? 'No published payslips in this period'
                    : undefined
                }
              >
                {bulkDownloading ? 'Downloading…' : `Download all (${filtered.length}) PDF`}
              </Button>
            </div>

            <div className="mt-4">
              {filtered.length === 0 ? (
                <Notice heading="No payslips in this period">
                  Published payslips appear here once payroll has been processed and released.
                </Notice>
              ) : (
                <DataTable
                  columns={[
                    { key: 'period', label: <SortHeader col="period" label="Pay period" /> },
                    { key: 'basic',  label: <SortHeader col="basic"  label="Basic" />, numeric: true },
                    { key: 'gross',  label: <SortHeader col="gross"  label="Gross" />, numeric: true },
                    { key: 'cpf',    label: <SortHeader col="cpf"    label="CPF (employee)" />, numeric: true },
                    { key: 'net',    label: <SortHeader col="net"    label="Net pay" />, numeric: true },
                    { key: 'pdf',    label: 'Statement' },
                  ]}
                  rows={filtered.map(ps => ({
                    period: (
                      <span>
                        {fmtPeriod(ps.period)}
                        <span className="text-muted tabular-nums"> · {ps.period}</span>
                      </span>
                    ),
                    basic: fmtSGD(ps.basicSalary),
                    gross: fmtSGD(ps.grossPay),
                    // The minus sign, not a colour, says "deduction" — a figure
                    // that only reads as negative when you can see red is a
                    // figure half the readers get wrong.
                    cpf: `− ${fmtSGD(ps.employeeCpf)}`,
                    net: fmtSGD(ps.netPay),
                    pdf: (
                      <Button
                        variant="quiet"
                        onClick={() => downloadPdf(ps.period, fmtPeriod(ps.period))}
                        disabled={downloading === ps.period}
                        reason={downloading === ps.period ? 'Preparing…' : undefined}
                      >
                        PDF
                      </Button>
                    ),
                  }))}
                  total={{ label: `Net pay — ${scope}`, value: `SGD ${fmtSGD(totals.net)}` }}
                />
              )}
            </div>

            <p className="text-xs text-muted mt-4 flex items-center gap-2 flex-wrap">
              Salary is payable within 7 days of the end of the salary period.
              <Seal cite="EA s.21 · within 7 days" />
            </p>
            <p className="text-xs text-muted mt-1">
              All amounts in SGD. Figures shown are as published; contact HR if a
              statement is missing or disputed.
            </p>
          </section>
        </>
      )}

      {/* ── Download confirmation ──────────────────────────────────────── */}
      {dlToast && (
        <div role="status" className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[200]">
          {/* Square: the spec gives the 2px radius to buttons and seals only. */}
          <p className="bg-shadow text-paper px-6 py-3 text-xs tracking-wide">
            {dlToast}
          </p>
        </div>
      )}
    </div>
  );
}
