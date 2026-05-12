'use client';

import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { apiFetch, getAccessToken } from '@/lib/api';

type SortKey = 'fullName' | 'employeeCode' | 'department' | 'employmentType' | 'isActive';
type SortDir = 'asc' | 'desc';

interface Employee {
  id: string;
  employeeCode: string;
  fullName: string;
  department: string;
  designation: string;
  employmentType: string;
  isActive: boolean;
  citizenshipStatus: string;
  workEmail?: string;
}

interface ParsedRow { [key: string]: string }

// ─── CSV helpers ───────────────────────────────────────────────────────────────

const CSV_HEADERS = ['fullName','email','dateOfBirth','startDate','gender','department','designation','employmentType','citizenshipStatus','nationality','phone','nric','basicSalary','bankCode','bankAccount'];

const CSV_NOTES: Record<string, string> = {
  dateOfBirth: 'YYYY-MM-DD',
  startDate:   'YYYY-MM-DD',
  gender:      'MALE | FEMALE | PREFER_NOT_TO_SAY',
  employmentType: 'FULL_TIME | PART_TIME | CONTRACT | INTERN',
  citizenshipStatus: 'SC | PR_YEAR1 | PR_YEAR2 | FOREIGNER',
  bankCode: '7171=DBS 7339=OCBC 7375=UOB',
};

const SAMPLE_ROW = ['John Tan Wei Ming','john.tan@company.com','1990-04-15','2026-05-01','MALE','Engineering','Software Engineer','FULL_TIME','SC','Singaporean','+6591234567','S1234567A','5000','7171','0123456789'];

function buildCsvTemplate(): string {
  const noteRow = CSV_HEADERS.map(h => CSV_NOTES[h] ? `[${CSV_NOTES[h]}]` : '');
  return [CSV_HEADERS.join(','), noteRow.join(','), SAMPLE_ROW.join(',')].join('\n');
}

function parseCsv(text: string): ParsedRow[] {
  const lines = text.replace(/\r/g, '').split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  return lines.slice(1)
    .filter(l => !l.startsWith('['))  // skip note row
    .map(line => {
      const vals = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''));
      const row: ParsedRow = {};
      headers.forEach((h, i) => { row[h] = vals[i] ?? ''; });
      return row;
    })
    .filter(row => Object.values(row).some(v => v));
}

function downloadBlob(content: string, filename: string, mime = 'text/csv') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ─── Main page ─────────────────────────────────────────────────────────────────

export default function EmployeeDirectoryPage() {
  const { hasPermission } = useAuth();
  const [searchQuery, setSearchQuery] = useState('');
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [sortKey, setSortKey] = useState<SortKey>('fullName');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  // Bulk upload state
  const [bulkOpen, setBulkOpen] = useState(false);
  const [csvRows, setCsvRows] = useState<ParsedRow[]>([]);
  const [csvFile, setCsvFile] = useState<string>('');
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<{ created: number; failed: number; results: { created: { row: number; employeeCode: string; name: string }[]; failed: { row: number; name: string; error: string }[] } } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Provision identity state
  const [provisionOpen, setProvisionOpen] = useState(false);
  const [provisionEmpId, setProvisionEmpId] = useState('');
  const [provisionEmail, setProvisionEmail] = useState('');
  const [provisionName, setProvisionName] = useState('');
  const [provisionPassword, setProvisionPassword] = useState('');
  const [provisionRole, setProvisionRole] = useState('EMPLOYEE');
  const [provisioning, setProvisioning] = useState(false);
  const [provisionResult, setProvisionResult] = useState<{ ok: boolean; message: string; userId?: string } | null>(null);
  const [sendingInvite, setSendingInvite] = useState(false);
  const [inviteSent, setInviteSent] = useState(false);

  // Applications state
  const [applicationsOpen, setApplicationsOpen] = useState(false);
  type Application = { id: string; fullName: string; preferredName?: string; email: string; userId: string; gender?: string; dateOfBirth?: string; nationality?: string; nricFin?: string; personalPhone?: string; homeAddress?: string; department?: string; designation?: string; employmentType?: string; startDate?: string; bankName?: string; bankAccount?: string; notes?: string; status: string; createdAt: string };
  const [applications, setApplications] = useState<Application[]>([]);
  const [pendingInvites, setPendingInvites] = useState<{ id: string; name: string; email: string; inviteExpiry: string; createdAt: string }[]>([]);
  const [appLoading, setAppLoading] = useState(false);
  const [approvingId, setApprovingId] = useState('');
  const [retriggeringId, setRetriggeringId] = useState('');
  const [reviewingApp, setReviewingApp] = useState<Application | null>(null);

  const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

  const handleSort = (key: SortKey) => {
    if (key === sortKey) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  };

  const sorted = useMemo(() => {
    return [...employees].sort((a, b) => {
      let av: number | string, bv: number | string;
      if (typeof a[sortKey] === 'boolean') {
        av = (a[sortKey] as unknown as boolean) ? 0 : 1;
        bv = (b[sortKey] as unknown as boolean) ? 0 : 1;
      } else {
        av = String(a[sortKey]).toLowerCase();
        bv = String(b[sortKey]).toLowerCase();
      }
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
  }, [employees, sortKey, sortDir]);

  const fetchEmployees = useCallback(async () => {
    try {
      const data = await apiFetch(`/employees?search=${searchQuery}`);
      setEmployees(data.employees || []);
      setTotal(data.total || 0);
    } catch (err) {
      console.error('Failed to fetch employees:', err);
    } finally {
      setLoading(false);
    }
  }, [searchQuery]);

  useEffect(() => {
    const t = setTimeout(fetchEmployees, 300);
    return () => clearTimeout(t);
  }, [fetchEmployees]);

  // Load pending count on mount so badge shows without clicking
  useEffect(() => { loadApplications(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvFile(file.name);
    setUploadResult(null);
    const reader = new FileReader();
    reader.onload = ev => {
      const text = ev.target?.result as string;
      setCsvRows(parseCsv(text));
    };
    reader.readAsText(file);
  };

  const submitBulk = async () => {
    if (!csvRows.length) return;
    setUploading(true);
    try {
      const res = await fetch(`${apiBaseUrl}/employees/bulk-import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getAccessToken()}` },
        body: JSON.stringify(csvRows),
      });
      const data = await res.json();
      if (!res.ok && res.status !== 207) throw new Error(data.error ?? `HTTP ${res.status}`);
      setUploadResult(data);
      if (data.created > 0) fetchEmployees();
    } catch (e: any) {
      setUploadResult({ created: 0, failed: csvRows.length, results: { created: [], failed: [{ row: 0, name: 'All rows', error: e.message }] } });
    } finally {
      setUploading(false);
    }
  };

  const resetModal = () => {
    setBulkOpen(false);
    setCsvRows([]);
    setCsvFile('');
    setUploadResult(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const resetProvision = () => {
    setProvisionOpen(false);
    setProvisionEmpId('');
    setProvisionEmail('');
    setProvisionName('');
    setProvisionPassword('');
    setProvisionRole('EMPLOYEE');
    setProvisionResult(null);
  };

  const submitProvision = async () => {
    if (!provisionEmail || !provisionPassword || !provisionName) return;
    setProvisioning(true);
    setProvisionResult(null);
    try {
      const data = await apiFetch('/users', {
        method: 'POST',
        body: JSON.stringify({
          email: provisionEmail,
          password: provisionPassword,
          name: provisionName,
          role: provisionRole,
          employeeId: provisionEmpId || undefined,
        }),
      });
      setProvisionResult({ ok: true, message: `Login account created for ${provisionName}`, userId: data.id });
    } catch (e: any) {
      setProvisionResult({ ok: false, message: e.message });
    } finally {
      setProvisioning(false);
    }
  };

  const sendOnboardingInvite = async (userId: string) => {
    setSendingInvite(true);
    try {
      await apiFetch(`/users/${userId}/send-invite`, { method: 'POST' });
      setInviteSent(true);
    } catch (e: any) {
      alert(e.message);
    } finally {
      setSendingInvite(false);
    }
  };

  const loadApplications = async () => {
    setAppLoading(true);
    try {
      const token = getAccessToken();
      const [appRes, inviteRes] = await Promise.all([
        fetch(`${apiBaseUrl}/employees/applications`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${apiBaseUrl}/users/pending-invites`, { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      const apps = appRes.ok ? await appRes.json() : [];
      const invites = inviteRes.ok ? await inviteRes.json() : [];
      setApplications(apps);
      // Filter out users who already submitted an application
      const submittedUserIds = new Set((apps as { userId: string }[]).map(a => a.userId));
      setPendingInvites(invites.filter((u: { id: string }) => !submittedUserIds.has(u.id)));
    } finally {
      setAppLoading(false);
    }
  };

  const retriggerInvite = async (userId: string) => {
    setRetriggeringId(userId);
    try {
      await apiFetch(`/users/${userId}/send-invite`, { method: 'POST' });
      alert('Invite re-sent successfully.');
    } catch (e: any) {
      alert(e.message);
    } finally {
      setRetriggeringId('');
    }
  };

  const approveApplication = async (id: string) => {
    setApprovingId(id);
    try {
      await apiFetch(`/employees/applications/${id}/approve`, { method: 'POST' });
      await loadApplications();
      await fetchEmployees();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setApprovingId('');
    }
  };

  const rejectApplication = async (id: string) => {
    if (!confirm('Reject this application?')) return;
    try {
      await apiFetch(`/employees/applications/${id}/reject`, { method: 'PATCH' });
      await loadApplications();
    } catch {}
  };

  return (
    <div className="flex flex-col gap-10 max-w-[1600px] mx-auto pb-20 animate-in fade-in duration-700">

      {/* Bulk Upload Modal */}
      {bulkOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
          <div className="w-full max-w-2xl bg-white rounded-[2rem] shadow-2xl shadow-slate-900/20 flex flex-col max-h-[90vh] overflow-hidden">

            {/* Modal header */}
            <div className="flex items-center justify-between px-8 py-6 border-b border-slate-100">
              <div>
                <h2 className="text-lg font-black text-slate-900 tracking-tighter">Bulk Employee Import</h2>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-0.5">CSV · Max 500 records per batch</p>
              </div>
              <button onClick={resetModal} className="w-9 h-9 flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-all text-lg">✕</button>
            </div>

            <div className="flex flex-col gap-5 p-8 overflow-y-auto">

              {/* Step 1 — template */}
              <div className="flex items-center justify-between bg-slate-50 px-5 py-4 rounded-2xl border border-slate-100">
                <div>
                  <p className="text-xs font-black text-slate-700">Step 1 — Download Template</p>
                  <p className="text-[10px] text-slate-400 mt-0.5">CSV with required columns and a sample row</p>
                </div>
                <button
                  onClick={() => downloadBlob(buildCsvTemplate(), 'employee-import-template.csv')}
                  className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-xl text-[10px] font-black text-slate-600 uppercase tracking-widest hover:border-indigo-400 hover:text-indigo-600 transition-all shadow-sm"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  Template.csv
                </button>
              </div>

              {/* Step 2 — upload */}
              <div>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Step 2 — Upload Completed CSV</p>
                <label className={`flex flex-col items-center justify-center gap-3 border-2 border-dashed rounded-2xl py-8 cursor-pointer transition-all ${csvFile ? 'border-indigo-300 bg-indigo-50/50' : 'border-slate-200 hover:border-indigo-300 hover:bg-slate-50'}`}>
                  <svg className={`w-8 h-8 ${csvFile ? 'text-indigo-500' : 'text-slate-300'}`} fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                  </svg>
                  <span className="text-xs font-bold text-slate-500">
                    {csvFile ? <span className="text-indigo-600 font-black">{csvFile} · {csvRows.length} rows parsed</span> : 'Click to select CSV file'}
                  </span>
                  <input ref={fileInputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={onFileChange} />
                </label>
              </div>

              {/* Preview */}
              {csvRows.length > 0 && !uploadResult && (
                <div>
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Preview — first {Math.min(3, csvRows.length)} of {csvRows.length} rows</p>
                  <div className="rounded-2xl border border-slate-100 overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-[10px]">
                        <thead>
                          <tr className="bg-slate-50 border-b border-slate-100">
                            {['fullName','email','department','designation','employmentType','citizenshipStatus'].map(h => (
                              <th key={h} className="px-4 py-2 text-left font-black text-slate-400 uppercase tracking-wider whitespace-nowrap">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                          {csvRows.slice(0, 3).map((row, i) => (
                            <tr key={i}>
                              {['fullName','email','department','designation','employmentType','citizenshipStatus'].map(h => (
                                <td key={h} className="px-4 py-2.5 font-bold text-slate-600 whitespace-nowrap max-w-[120px] truncate">{row[h] || '—'}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              {/* Upload result */}
              {uploadResult && (
                <div className={`rounded-2xl border p-5 ${uploadResult.failed === 0 ? 'bg-emerald-50 border-emerald-200' : uploadResult.created === 0 ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-200'}`}>
                  <p className={`text-xs font-black ${uploadResult.failed === 0 ? 'text-emerald-700' : uploadResult.created === 0 ? 'text-red-700' : 'text-amber-700'}`}>
                    {uploadResult.created} created · {uploadResult.failed} failed
                  </p>
                  {uploadResult.results.failed.length > 0 && (
                    <ul className="mt-3 space-y-1">
                      {uploadResult.results.failed.map((f, i) => (
                        <li key={i} className="text-[10px] font-bold text-red-600">Row {f.row}: {f.name} — {f.error}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>

            {/* Modal footer */}
            <div className="flex items-center justify-between px-8 py-5 border-t border-slate-100 bg-slate-50/50">
              <button onClick={resetModal} className="text-[10px] font-black text-slate-400 uppercase tracking-widest hover:text-slate-600 transition-colors">
                {uploadResult ? 'Close' : 'Cancel'}
              </button>
              {!uploadResult && (
                <button
                  onClick={submitBulk}
                  disabled={csvRows.length === 0 || uploading}
                  className="flex items-center gap-2 px-6 py-3 bg-indigo-600 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-indigo-700 disabled:opacity-40 transition-all shadow-lg shadow-indigo-200"
                >
                  {uploading && <span className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" />}
                  Import {csvRows.length > 0 ? `${csvRows.length} Records` : ''}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 1. Header */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-8 bg-white p-10 rounded-[2.5rem] border border-slate-100 shadow-2xl shadow-indigo-500/5 relative overflow-hidden group">
        <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
          <div className="w-32 h-32 bg-indigo-600 rounded-full blur-3xl" />
        </div>

        <div className="flex flex-col gap-2 relative z-10">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-2 h-2 bg-indigo-600 rounded-full" />
            <span className="text-[10px] font-black text-indigo-600 uppercase tracking-[0.4em]">Operational Resource Layer</span>
          </div>
          <h1 className="text-4xl font-black text-slate-900 tracking-tighter">Workforce <span className="text-indigo-600">Inventory</span></h1>
          <p className="text-sm font-bold text-slate-400 mt-2 uppercase tracking-widest leading-relaxed max-w-xl">
            Sovereign personnel management and statutory compliance monitoring for the enterprise.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-4 relative z-10">
          <div className="relative">
            <input
              type="text"
              placeholder="Filter by Name, ID, or Role..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full sm:w-80 bg-slate-50 border border-slate-200 rounded-2xl px-6 py-4 text-xs font-bold text-slate-900 placeholder:text-slate-300 focus:border-indigo-600 focus:ring-4 focus:ring-indigo-600/5 outline-none transition-all"
            />
            <div className="absolute right-5 top-1/2 -translate-y-1/2 text-slate-300">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
            </div>
          </div>

          <button
            onClick={() => { setUploadResult(null); setCsvRows([]); setCsvFile(''); setBulkOpen(true); }}
            className="px-8 py-4 bg-slate-900 text-white rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] hover:bg-slate-800 transition-all shadow-xl shadow-slate-900/10 active:scale-95 flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
            </svg>
            Bulk Upload
          </button>

          <button
            onClick={() => { loadApplications(); setApplicationsOpen(true); }}
            className="px-8 py-4 bg-amber-500 text-white rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] hover:bg-amber-600 shadow-xl shadow-amber-500/20 transition-all active:scale-95 flex items-center gap-2 relative"
          >
            Pending Profiles
            {(applications.length + pendingInvites.length) > 0 && (
              <span className="ml-1 bg-white text-amber-600 rounded-full text-[9px] font-black w-5 h-5 flex items-center justify-center">
                {applications.length + pendingInvites.length}
              </span>
            )}
          </button>

          <button
            onClick={() => { setProvisionResult(null); setInviteSent(false); setProvisionOpen(true); }}
            className="px-8 py-4 bg-indigo-600 text-white rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] hover:bg-indigo-700 shadow-xl shadow-indigo-500/30 transition-all active:scale-95 flex items-center gap-3"
          >
            <span>+</span> Provision Identity
          </button>
        </div>
      </div>

      {/* 2. Personnel Matrix */}
      <section className="bg-white rounded-[2.5rem] border border-slate-100 shadow-2xl shadow-indigo-500/5 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/50 text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] border-b border-slate-100">
                {([
                  { key: 'fullName',       label: 'Identity Reference' },
                  { key: 'department',     label: 'Structural Unit' },
                  { key: 'employmentType', label: 'Contract Class' },
                  { key: 'isActive',       label: 'Status Registry' },
                ] as { key: SortKey; label: string }[]).map(col => (
                  <th key={col.key} className="px-10 py-8">
                    <button onClick={() => handleSort(col.key)} className="flex items-center gap-2 hover:text-indigo-600 transition-colors group">
                      {col.label}
                      <span className="flex flex-col gap-[2px] opacity-40 group-hover:opacity-100 transition-opacity">
                        <svg className={`w-2.5 h-2.5 ${sortKey === col.key && sortDir === 'asc' ? 'text-indigo-600 opacity-100' : ''}`} viewBox="0 0 10 6" fill="currentColor"><path d="M5 0L10 6H0z" /></svg>
                        <svg className={`w-2.5 h-2.5 ${sortKey === col.key && sortDir === 'desc' ? 'text-indigo-600 opacity-100' : ''}`} viewBox="0 0 10 6" fill="currentColor"><path d="M5 6L0 0H10z" /></svg>
                      </span>
                    </button>
                  </th>
                ))}
                <th className="px-10 py-8 text-right">Governance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    <td colSpan={5} className="px-10 py-6"><div className="h-10 bg-slate-100 rounded-xl w-full" /></td>
                  </tr>
                ))
              ) : sorted.map(emp => (
                <tr key={emp.id} className="group hover:bg-slate-50/50 transition-all duration-300">
                  <td className="px-10 py-6">
                    <div className="flex items-center gap-5">
                      <div className="h-14 w-14 rounded-2xl bg-slate-950 border border-slate-800 flex items-center justify-center text-xs font-black text-indigo-400 shadow-xl group-hover:scale-110 transition-transform duration-500 relative overflow-hidden">
                        <div className="absolute inset-0 bg-indigo-600/10 opacity-0 group-hover:opacity-100 transition-opacity" />
                        {emp.fullName.split(' ').map(n => n[0]).join('')}
                      </div>
                      <div className="flex flex-col">
                        <span className="text-sm font-black text-slate-900 group-hover:text-indigo-600 transition-colors uppercase tracking-tight">{emp.fullName}</span>
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1.5">{emp.employeeCode} • {emp.designation}</span>
                      </div>
                    </div>
                  </td>
                  <td className="px-10 py-6 uppercase">
                    <span className="text-[10px] font-black text-slate-600 tracking-widest bg-slate-100 px-3 py-1.5 rounded-lg">{emp.department}</span>
                  </td>
                  <td className="px-10 py-6">
                    <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{emp.employmentType.replace(/_/g, ' ')}</span>
                  </td>
                  <td className="px-10 py-6">
                    <div className="flex items-center gap-3">
                      <div className={`w-2 h-2 rounded-full ${emp.isActive ? 'bg-emerald-500 animate-pulse' : 'bg-slate-300'}`} />
                      <span className={`text-[10px] font-black uppercase tracking-[0.2em] ${emp.isActive ? 'text-emerald-600' : 'text-slate-400'}`}>
                        {emp.isActive ? 'Active Duty' : 'Deactivated'}
                      </span>
                    </div>
                  </td>
                  <td className="px-10 py-6 text-right">
                    <Link
                      href={`/employees/${emp.id}`}
                      className="inline-flex items-center gap-3 px-6 py-2.5 bg-white border border-slate-200 rounded-xl text-[9px] font-black text-slate-600 uppercase tracking-widest hover:border-indigo-600 hover:text-indigo-600 hover:bg-indigo-50 shadow-sm transition-all active:scale-95"
                    >
                      Audit Profile
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>
                    </Link>
                  </td>
                </tr>
              ))}
              {employees.length === 0 && !loading && (
                <tr>
                  <td colSpan={5} className="px-10 py-20 text-center">
                    <div className="flex flex-col items-center gap-4 opacity-30 grayscale">
                      <span className="text-4xl">📁</span>
                      <p className="text-[10px] font-black text-slate-500 uppercase tracking-[0.3em]">No personnel records detected in sector</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="p-8 bg-slate-50/50 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Global Aggregation</span>
            <div className="h-6 w-[1px] bg-slate-200" />
            <span className="text-[10px] font-black text-slate-900 uppercase">Total Workforce: <span className="text-indigo-600">{total} Entities</span></span>
          </div>
          <div className="flex items-center gap-2">
            <button className="w-10 h-10 flex items-center justify-center bg-white border border-slate-200 rounded-xl text-slate-400 hover:text-indigo-600 hover:border-indigo-600 transition-all disabled:opacity-30" disabled>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M15 19l-7-7 7-7" /></svg>
            </button>
            <div className="px-5 py-2 bg-slate-950 rounded-xl text-[10px] font-black text-indigo-400 uppercase tracking-widest">Sector 1</div>
            <button className="w-10 h-10 flex items-center justify-center bg-white border border-slate-200 rounded-xl text-slate-400 hover:text-indigo-600 hover:border-indigo-600 transition-all">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M9 5l7 7-7 7" /></svg>
            </button>
          </div>
        </div>
      </section>

      {/* Provision Identity Modal */}
      {provisionOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
          <div className="w-full max-w-md bg-white rounded-[2rem] shadow-2xl shadow-slate-900/20 flex flex-col overflow-hidden">

            <div className="flex items-center justify-between px-8 py-6 border-b border-slate-100">
              <div>
                <h2 className="text-lg font-black text-slate-900 tracking-tighter">Provision Identity</h2>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-0.5">Create login credentials for an employee</p>
              </div>
              <button onClick={resetProvision} className="w-9 h-9 flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-all text-lg">✕</button>
            </div>

            <div className="flex flex-col gap-5 p-8">

              {/* Link to employee */}
              <div className="flex flex-col gap-2">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Link to Employee</label>
                <select
                  value={provisionEmpId}
                  onChange={e => {
                    const emp = employees.find(em => em.id === e.target.value);
                    setProvisionEmpId(e.target.value);
                    if (emp) {
                      setProvisionName(emp.fullName);
                      setProvisionEmail(emp.workEmail || '');
                    }
                  }}
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/10 transition-all appearance-none"
                >
                  <option value="">— Standalone account (no employee record) —</option>
                  {employees.map(emp => (
                    <option key={emp.id} value={emp.id}>{emp.fullName} · {emp.employeeCode}</option>
                  ))}
                </select>
                <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">
                  When linked, this login inherits the employee's contractual details — leave entitlements, compliance status, payroll &amp; attendance records
                </p>
              </div>

              {/* Display name */}
              <div className="flex flex-col gap-2">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Display Name</label>
                <input
                  type="text"
                  value={provisionName}
                  onChange={e => setProvisionName(e.target.value)}
                  placeholder="Full name"
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/10 transition-all placeholder:font-normal placeholder:text-slate-300"
                />
              </div>

              {/* Email */}
              <div className="flex flex-col gap-2">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Login Email</label>
                <input
                  type="email"
                  value={provisionEmail}
                  onChange={e => setProvisionEmail(e.target.value)}
                  placeholder="user@company.com"
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/10 transition-all placeholder:font-normal placeholder:text-slate-300"
                />
              </div>

              {/* Temporary password */}
              <div className="flex flex-col gap-2">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Temporary Password</label>
                <input
                  type="text"
                  value={provisionPassword}
                  onChange={e => setProvisionPassword(e.target.value)}
                  placeholder="Min 8 characters"
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/10 transition-all placeholder:font-normal placeholder:text-slate-300"
                />
              </div>

              {/* Role */}
              <div className="flex flex-col gap-2">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">System Role</label>
                <select
                  value={provisionRole}
                  onChange={e => setProvisionRole(e.target.value)}
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/10 transition-all appearance-none"
                >
                  <option value="EMPLOYEE">Employee</option>
                  <option value="HR_ADMIN">HR Admin</option>
                  <option value="PAYROLL_OFFICER">Payroll Officer</option>
                  <option value="ADMIN">Admin</option>
                  <option value="SUPER_ADMIN">Super Admin</option>
                </select>
              </div>

              {/* Result banner */}
              {provisionResult && (
                <div className={`px-4 py-3 rounded-xl text-xs font-bold ${provisionResult.ok ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' : 'bg-red-50 text-red-700 border border-red-100'}`}>
                  {provisionResult.message}
                </div>
              )}

              {provisionResult?.ok && provisionResult.userId && !inviteSent && (
                <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-4">
                  <p className="text-xs font-black text-indigo-700 mb-1">Send Onboarding Invitation</p>
                  <p className="text-[10px] font-bold text-indigo-500 mb-3">Send a secure link so the user can fill in their personal details for HR clearance.</p>
                  <button onClick={() => sendOnboardingInvite(provisionResult.userId!)} disabled={sendingInvite}
                    className="w-full px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl text-[10px] font-black uppercase tracking-widest transition-all">
                    {sendingInvite ? 'Sending…' : 'Send Onboarding Email'}
                  </button>
                </div>
              )}

              {inviteSent && (
                <div className="bg-emerald-50 border border-emerald-100 rounded-xl px-4 py-3 text-xs font-bold text-emerald-700">
                  Onboarding invite sent to {provisionEmail}
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-3 pt-1">
                <button
                  onClick={() => { resetProvision(); setInviteSent(false); }}
                  className="flex-1 px-4 py-3 border border-slate-200 rounded-xl text-[10px] font-black text-slate-600 uppercase tracking-widest hover:bg-slate-50 transition-all"
                >
                  {provisionResult?.ok ? 'Close' : 'Cancel'}
                </button>
                {!provisionResult?.ok && (
                  <button
                    onClick={submitProvision}
                    disabled={provisioning || !provisionEmail || !provisionPassword || !provisionName}
                    className="flex-1 px-4 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl text-[10px] font-black uppercase tracking-widest transition-all"
                  >
                    {provisioning ? 'Provisioning…' : 'Create Account'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Application Review Panel ─────────────────────────────────────────── */}
      {reviewingApp && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
          <div className="w-full max-w-2xl bg-white rounded-[2rem] shadow-2xl shadow-slate-900/20 flex flex-col max-h-[90vh] overflow-hidden">
            {/* Header */}
            <div className="px-8 pt-8 pb-6 border-b border-slate-100 flex items-start justify-between flex-shrink-0">
              <div>
                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Pending HR Verification</p>
                <h2 className="text-xl font-black text-slate-900 tracking-tighter">{reviewingApp.fullName}</h2>
                <p className="text-xs font-bold text-slate-400 mt-0.5">{reviewingApp.email} · Submitted {new Date(reviewingApp.createdAt).toLocaleDateString('en-SG', { day: '2-digit', month: 'short', year: 'numeric' })}</p>
              </div>
              <button onClick={() => setReviewingApp(null)} className="text-slate-300 hover:text-slate-600 transition-colors text-xl leading-none">✕</button>
            </div>

            {/* Body */}
            <div className="overflow-y-auto flex-1 px-8 py-6 flex flex-col gap-6">

              {/* Personal Details */}
              <section>
                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-3 border-b border-slate-100 pb-2">Personal Details</p>
                <div className="grid grid-cols-2 gap-x-8 gap-y-3">
                  {[
                    ['Full Legal Name', reviewingApp.fullName],
                    ['Preferred Name', reviewingApp.preferredName || '—'],
                    ['Gender', reviewingApp.gender || '—'],
                    ['Date of Birth', reviewingApp.dateOfBirth ? new Date(reviewingApp.dateOfBirth).toLocaleDateString('en-SG') : '—'],
                    ['Nationality', reviewingApp.nationality || '—'],
                    ['NRIC / FIN', reviewingApp.nricFin || '—'],
                  ].map(([label, val]) => (
                    <div key={label}>
                      <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{label}</p>
                      <p className="text-sm font-bold text-slate-800 mt-0.5">{val}</p>
                    </div>
                  ))}
                </div>
              </section>

              {/* Contact */}
              <section>
                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-3 border-b border-slate-100 pb-2">Contact & Address</p>
                <div className="grid grid-cols-2 gap-x-8 gap-y-3">
                  {[
                    ['Mobile', reviewingApp.personalPhone || '—'],
                    ['Home Address', reviewingApp.homeAddress || '—'],
                  ].map(([label, val]) => (
                    <div key={label} className={label === 'Home Address' ? 'col-span-2' : ''}>
                      <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{label}</p>
                      <p className="text-sm font-bold text-slate-800 mt-0.5">{val}</p>
                    </div>
                  ))}
                </div>
              </section>

              {/* Employment */}
              <section>
                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-3 border-b border-slate-100 pb-2">Employment</p>
                <div className="grid grid-cols-2 gap-x-8 gap-y-3">
                  {[
                    ['Department', reviewingApp.department || '—'],
                    ['Designation', reviewingApp.designation || '—'],
                    ['Employment Type', reviewingApp.employmentType?.replace('_', ' ') || '—'],
                    ['Start Date', reviewingApp.startDate ? new Date(reviewingApp.startDate).toLocaleDateString('en-SG') : '—'],
                  ].map(([label, val]) => (
                    <div key={label}>
                      <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{label}</p>
                      <p className="text-sm font-bold text-slate-800 mt-0.5">{val}</p>
                    </div>
                  ))}
                </div>
              </section>

              {/* Banking */}
              <section>
                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-3 border-b border-slate-100 pb-2">Banking</p>
                <div className="grid grid-cols-2 gap-x-8 gap-y-3">
                  {[
                    ['Bank', reviewingApp.bankName || '—'],
                    ['Account Number', reviewingApp.bankAccount || '—'],
                  ].map(([label, val]) => (
                    <div key={label}>
                      <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{label}</p>
                      <p className="text-sm font-bold text-slate-800 mt-0.5">{val}</p>
                    </div>
                  ))}
                </div>
              </section>

              {reviewingApp.notes && (
                <section>
                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2">Notes from Employee</p>
                  <p className="text-sm font-bold text-slate-700 bg-slate-50 border border-slate-100 rounded-xl px-4 py-3">{reviewingApp.notes}</p>
                </section>
              )}
            </div>

            {/* Actions */}
            <div className="px-8 py-5 border-t border-slate-100 flex items-center justify-between flex-shrink-0">
              <button onClick={() => { rejectApplication(reviewingApp.id); setReviewingApp(null); }}
                className="px-5 py-2.5 text-[10px] font-black text-red-500 border border-red-200 bg-red-50 rounded-xl uppercase tracking-widest hover:bg-red-100 transition-all">
                Reject Application
              </button>
              <div className="flex items-center gap-3">
                <button onClick={() => setReviewingApp(null)}
                  className="px-5 py-2.5 text-[10px] font-black text-slate-500 border border-slate-200 rounded-xl uppercase tracking-widest hover:bg-slate-50 transition-all">
                  Cancel
                </button>
                <button
                  onClick={() => { approveApplication(reviewingApp.id); setReviewingApp(null); }}
                  disabled={approvingId === reviewingApp.id}
                  className="px-6 py-2.5 text-[10px] font-black text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 rounded-xl uppercase tracking-widest shadow-lg shadow-emerald-500/20 transition-all flex items-center gap-2">
                  {approvingId === reviewingApp.id && <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                  Approve & Create Employee
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Pending Profiles Modal */}
      {applicationsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
          <div className="w-full max-w-4xl bg-white rounded-[2rem] shadow-2xl flex flex-col max-h-[85vh] overflow-hidden">
            <div className="flex items-center justify-between px-8 py-6 border-b border-slate-100">
              <div>
                <h2 className="text-lg font-black text-slate-900 tracking-tighter">Pending Employee Profiles</h2>
                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mt-1">
                  {pendingInvites.length} awaiting submission · {applications.length} awaiting HR verification
                </p>
              </div>
              <button onClick={() => setApplicationsOpen(false)} className="text-slate-400 hover:text-slate-600 text-xl font-black transition-colors">✕</button>
            </div>

            <div className="overflow-y-auto flex-1">
              {appLoading ? (
                <div className="p-16 text-center text-slate-400 text-sm font-bold">Loading…</div>
              ) : pendingInvites.length === 0 && applications.length === 0 ? (
                <div className="p-16 flex flex-col items-center gap-4">
                  <div className="w-14 h-14 bg-slate-50 border border-slate-200 rounded-2xl flex items-center justify-center text-2xl">📋</div>
                  <p className="text-sm font-black text-slate-400 uppercase tracking-widest">No pending profiles</p>
                  <p className="text-xs font-bold text-slate-300 text-center max-w-sm">Provision a user and send them an onboarding invite to get started.</p>
                </div>
              ) : (
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-slate-50 text-slate-400 text-[9px] font-black uppercase tracking-[0.18em] border-b border-slate-100">
                      <th className="px-8 py-4">Name / Email</th>
                      <th className="px-4 py-4">Status</th>
                      <th className="px-4 py-4">Department</th>
                      <th className="px-4 py-4">Date</th>
                      <th className="px-8 py-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">

                    {/* ── Pending User Submission (invited, not yet filled form) ── */}
                    {pendingInvites.map(u => (
                      <tr key={u.id} className="hover:bg-slate-50/60 transition-all">
                        <td className="px-8 py-5">
                          <p className="text-sm font-black text-slate-900">{u.name}</p>
                          <p className="text-[9px] font-bold text-slate-400 mt-0.5">{u.email}</p>
                        </td>
                        <td className="px-4 py-5">
                          <span className="inline-flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest border px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 border-amber-200">
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                            Pending User Submission
                          </span>
                        </td>
                        <td className="px-4 py-5">
                          <span className="text-[9px] text-slate-400 font-bold">—</span>
                        </td>
                        <td className="px-4 py-5">
                          <div>
                            <span className="text-[9px] font-bold text-slate-400">Invited {new Date(u.createdAt).toLocaleDateString('en-SG', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
                            {u.inviteExpiry && new Date(u.inviteExpiry) < new Date() && (
                              <p className="text-[9px] font-black text-red-500 mt-0.5">Link expired</p>
                            )}
                          </div>
                        </td>
                        <td className="px-8 py-5 text-right">
                          <button
                            onClick={() => retriggerInvite(u.id)}
                            disabled={retriggeringId === u.id}
                            className="text-[9px] font-black text-indigo-600 border border-indigo-200 bg-indigo-50 px-3 py-1.5 rounded-lg uppercase tracking-widest hover:bg-indigo-100 disabled:opacity-50 transition-all"
                          >
                            {retriggeringId === u.id ? 'Sending…' : 'Re-send Invite'}
                          </button>
                        </td>
                      </tr>
                    ))}

                    {/* ── Pending HR Verification (submitted, waiting for HR) ── */}
                    {applications.map(app => (
                      <tr key={app.id} className="hover:bg-slate-50/60 transition-all">
                        <td className="px-8 py-5">
                          <p className="text-sm font-black text-slate-900">{app.fullName}</p>
                          <p className="text-[9px] font-bold text-slate-400 mt-0.5">{app.email}</p>
                        </td>
                        <td className="px-4 py-5">
                          <span className="inline-flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest border px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 border-blue-200">
                            <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                            Pending HR Verification
                          </span>
                        </td>
                        <td className="px-4 py-5">
                          <span className="text-[9px] font-black text-slate-600 uppercase tracking-widest">{app.department || '—'}</span>
                          {app.designation && <p className="text-[9px] font-bold text-slate-400 mt-0.5">{app.designation}</p>}
                        </td>
                        <td className="px-4 py-5">
                          <span className="text-[9px] font-bold text-slate-400">{new Date(app.createdAt).toLocaleDateString('en-SG', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
                        </td>
                        <td className="px-8 py-5 text-right">
                          <button onClick={() => setReviewingApp(app)}
                            className="text-[9px] font-black text-indigo-600 border border-indigo-200 bg-indigo-50 px-3 py-1.5 rounded-lg uppercase tracking-widest hover:bg-indigo-100 transition-all">
                            Review →
                          </button>
                        </td>
                      </tr>
                    ))}

                  </tbody>
                </table>
              )}
            </div>

            <div className="px-8 py-5 border-t border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-6 text-[9px] font-black uppercase tracking-widest text-slate-400">
                <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-amber-400" /> Pending User Submission — awaiting employee self-fill</span>
                <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-blue-500" /> Pending HR Verification — HR action required</span>
              </div>
              <button onClick={() => setApplicationsOpen(false)}
                className="text-[10px] font-black text-slate-400 uppercase tracking-widest hover:text-slate-600 transition-colors">
                Close
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
