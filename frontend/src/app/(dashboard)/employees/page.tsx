'use client';

import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { apiFetch } from '@/lib/api';

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
  profilePhotoUrl?: string | null;
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
  const [templateEmpId, setTemplateEmpId] = useState('');
  const [templatePreview, setTemplatePreview] = useState<{ department: string; designation: string; employmentType: string; citizenshipStatus: string; basicSalary?: string } | null>(null);
  const [provisionEmail, setProvisionEmail] = useState('');
  const [provisionName, setProvisionName] = useState('');
  const [provisionPassword, setProvisionPassword] = useState('');
  const [provisionShowPass, setProvisionShowPass] = useState(false);
  const [provisionRole, setProvisionRole] = useState('EMPLOYEE');
  const [provisioning, setProvisioning] = useState(false);
  const [provisionResult, setProvisionResult] = useState<{ ok: boolean; message: string; userId?: string } | null>(null);
  const [sendingInvite, setSendingInvite] = useState(false);
  const [inviteSent, setInviteSent] = useState(false);
  const [allEmployeesForDropdown, setAllEmployeesForDropdown] = useState<Employee[]>([]);

  // Applications state
  const [applicationsOpen, setApplicationsOpen] = useState(false);
  type Application = { id: string; fullName: string; preferredName?: string; email: string; userId: string; gender?: string; dateOfBirth?: string; nationality?: string; nricFin?: string; personalPhone?: string; homeAddress?: string; department?: string; designation?: string; employmentType?: string; startDate?: string; bankName?: string; bankAccount?: string; basicSalary?: string; notes?: string; status: string; createdAt: string };
  const [applications, setApplications] = useState<Application[]>([]);
  const [pendingInvites, setPendingInvites] = useState<{ id: string; name: string; email: string; inviteExpiry: string; createdAt: string }[]>([]);
  const [pendingSort, setPendingSort] = useState<{ col: 'name' | 'dept' | 'date'; dir: 'asc' | 'desc' }>({ col: 'date', dir: 'desc' });
  const [appLoading, setAppLoading] = useState(false);
  const [approvingId, setApprovingId] = useState('');
  const [retriggeringId, setRetriggeringId] = useState('');
  const [reviewingApp, setReviewingApp] = useState<Application | null>(null);
  const [hrFillUser, setHrFillUser] = useState<{ id: string; name: string; email: string } | null>(null);
  const [hrFillData, setHrFillData] = useState<Record<string, string>>({});
  const [hrFillSubmitting, setHrFillSubmitting] = useState(false);
  const [hrFillError, setHrFillError] = useState('');


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

  // Preload full employee list for the provision dropdown — runs once on mount
  useEffect(() => {
    apiFetch('/employees?limit=500&isActive=true')
      .then(d => setAllEmployeesForDropdown(d.employees ?? []))
      .catch(() => {});
  }, []);

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
      // 207 Multi-Status (partial success) is in the 2xx range, so apiFetch
      // returns its body normally; only true 4xx/5xx failures throw.
      const data = await apiFetch(`/employees/bulk-import`, {
        method: 'POST',
        body: JSON.stringify(csvRows),
      });
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
    setTemplateEmpId('');
    setTemplatePreview(null);
    setProvisionEmail('');
    setProvisionName('');
    setProvisionPassword('');
    setProvisionShowPass(false);
    setProvisionRole('EMPLOYEE');
    setProvisionResult(null);
    // allEmployeesForDropdown intentionally kept — preloaded once at mount
  };

  const openProvision = () => setProvisionOpen(true);

  const onTemplateSelect = async (empId: string) => {
    setTemplateEmpId(empId);
    setTemplatePreview(null);
    if (!empId) return;
    try {
      const emp = await apiFetch(`/employees/${empId}`);
      setTemplatePreview({
        department: emp.department,
        designation: emp.designation,
        employmentType: emp.employmentType,
        citizenshipStatus: emp.citizenshipStatus,
        basicSalary: emp.basicSalary,
      });
    } catch { /* non-critical */ }
  };

  const submitProvision = async () => {
    if (!provisionEmail || !provisionPassword || !provisionName) return;
    setProvisioning(true);
    setProvisionResult(null);
    try {
      // Step 1: Create login account
      let data;
      try {
        data = await apiFetch(`/users`, {
          method: 'POST',
          body: JSON.stringify({ email: provisionEmail, password: provisionPassword, name: provisionName, role: provisionRole }),
        });
      } catch (e: any) {
        setProvisionResult({ ok: false, message: e.message || 'Creation failed.' });
        return;
      }

      // Step 2: If a template was selected, create a pre-filled application
      // so the employee appears in Pending HR Verification immediately.
      if (templateEmpId && templatePreview) {
        await apiFetch(`/employees/applications/prefill`, {
          method: 'POST',
          body: JSON.stringify({
            userId: data.id,
            email: provisionEmail,
            fullName: provisionName,
            department: templatePreview.department,
            designation: templatePreview.designation,
            employmentType: templatePreview.employmentType,
            citizenshipStatus: templatePreview.citizenshipStatus,
            basicSalary: templatePreview.basicSalary,
          }),
        }).catch(() => {}); // non-critical — login was already created
      }

      setProvisionResult({ ok: true, message: `Login account created for ${provisionName}`, userId: data.id });
    } catch {
      setProvisionResult({ ok: false, message: 'Network error. Please try again.' });
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

  const submitHrFill = async () => {
    if (!hrFillUser || !hrFillData.fullName) return;
    setHrFillSubmitting(true);
    setHrFillError('');
    try {
      await apiFetch(`/employees/applications/prefill`, {
        method: 'POST',
        body: JSON.stringify({ userId: hrFillUser.id, email: hrFillUser.email, ...hrFillData }),
      });
      setHrFillUser(null);
      setHrFillData({});
      await loadApplications();
    } catch (e: any) { setHrFillError(e.message || 'Network error. Please try again.'); }
    finally { setHrFillSubmitting(false); }
  };

  const loadApplications = async () => {
    setAppLoading(true);
    try {
      const [appRes, inviteRes] = await Promise.allSettled([
        apiFetch(`/employees/applications`),
        apiFetch(`/users/pending-invites`),
      ]);
      const apps = appRes.status === 'fulfilled' ? appRes.value : [];
      const invites = inviteRes.status === 'fulfilled' ? inviteRes.value : [];
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-shadow backdrop-">
          <div className="w-full max-w-2xl bg-paper flex flex-col max-h-[90vh] overflow-hidden">

            {/* Modal header */}
            <div className="flex items-center justify-between px-8 py-6 border-b border-rule">
              <div>
                <h2 className="text-lg font-black text-ink tracking-tighter">Bulk Employee Import</h2>
                <p className="eyebrow-tight mt-0.5">CSV · Max 500 records per batch</p>
              </div>
              <button onClick={resetModal} className="w-9 h-9 flex items-center justify-center text-muted hover:text-ink hover:bg-page transition-all text-lg">✕</button>
            </div>

            <div className="flex flex-col gap-5 p-8 overflow-y-auto">

              {/* Step 1 — template */}
              <div className="flex items-center justify-between bg-page px-5 py-4 border border-rule">
                <div>
                  <p className="text-xs font-black text-ink">Step 1 — Download Template</p>
                  <p className="text-[10px] text-muted mt-0.5">CSV with required columns and a sample row</p>
                </div>
                <button
                  onClick={() => downloadBlob(buildCsvTemplate(), 'employee-import-template.csv')}
                  className="flex items-center gap-2 px-4 py-2 bg-paper border border-rule text-[10px] font-black text-ink uppercase tracking-widest hover:border-accent hover:text-accent transition-all"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  Template.csv
                </button>
              </div>

              {/* Step 2 — upload */}
              <div>
                <p className="eyebrow-tight mb-2">Step 2 — Upload Completed CSV</p>
                <label className={`flex flex-col items-center justify-center gap-3 border-2 border-dashed  py-8 cursor-pointer transition-all ${csvFile ? 'border-accent bg-page' : 'border-rule hover:border-accent hover:bg-page'}`}>
                  <svg className={`w-8 h-8 ${csvFile ? 'text-accent' : 'text-muted'}`} fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                  </svg>
                  <span className="text-xs font-bold text-muted">
                    {csvFile ? <span className="text-accent font-black">{csvFile} · {csvRows.length} rows parsed</span> : 'Click to select CSV file'}
                  </span>
                  <input ref={fileInputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={onFileChange} />
                </label>
              </div>

              {/* Preview */}
              {csvRows.length > 0 && !uploadResult && (
                <div>
                  <p className="eyebrow-tight mb-2">Preview — first {Math.min(3, csvRows.length)} of {csvRows.length} rows</p>
                  <div className="border border-rule overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-[10px]">
                        <thead>
                          <tr className="bg-page border-b border-rule">
                            {['fullName','email','department','designation','employmentType','citizenshipStatus'].map(h => (
                              <th key={h} className="px-4 py-2 text-left font-black text-muted uppercase tracking-wider whitespace-nowrap">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-rule">
                          {csvRows.slice(0, 3).map((row, i) => (
                            <tr key={i}>
                              {['fullName','email','department','designation','employmentType','citizenshipStatus'].map(h => (
                                <td key={h} className="px-4 py-2.5 font-bold text-ink whitespace-nowrap max-w-[120px] truncate">{row[h] || '—'}</td>
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
                <div className={` border p-5 ${uploadResult.failed === 0 ? 'bg-page border-accent' : uploadResult.created === 0 ? 'bg-page border-ink' : 'bg-page border-highlight'}`}>
                  {/* Total failure and partial failure had collapsed onto the
                      same colour. The outcome is now stated as a word, which is
                      what the colour was standing in for. */}
                  <p className="text-xs font-black text-ink tabular-nums">
                    {uploadResult.failed === 0
                      ? 'All rows imported'
                      : uploadResult.created === 0
                        ? 'Import failed — no rows created'
                        : 'Imported with errors'}
                    {' · '}{uploadResult.created} created · {uploadResult.failed} failed
                  </p>
                  {uploadResult.results.failed.length > 0 && (
                    <ul className="mt-3 space-y-1">
                      {uploadResult.results.failed.map((f, i) => (
                        <li key={i} className="text-[10px] font-bold text-ink">Row {f.row}: {f.name} — {f.error}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>

            {/* Modal footer */}
            <div className="flex items-center justify-between px-8 py-5 border-t border-rule bg-page">
              <button onClick={resetModal} className="eyebrow-tight hover:text-ink transition-colors">
                {uploadResult ? 'Close' : 'Cancel'}
              </button>
              {!uploadResult && (
                <button
                  onClick={submitBulk}
                  disabled={csvRows.length === 0 || uploading}
                  className="flex items-center gap-2 px-6 py-3 bg-accent text-paper text-[10px] font-black uppercase tracking-widest hover:bg-accent disabled:opacity-40 transition-all"
                >
                  {uploading && <span className="w-3 h-3 border-2 border-paper/40 border-t-paper animate-spin rounded-full" />}
                  Import {csvRows.length > 0 ? `${csvRows.length} Records` : ''}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 1. Header */}
      <div className="flex flex-col xl:flex-row xl:items-end xl:justify-between gap-6 xl:gap-8 bg-paper p-4 sm:p-6 lg:p-10 border border-rule relative overflow-hidden group">
        <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
          <div className="w-32 h-32 bg-accent" />
        </div>

        <div className="flex flex-col gap-2 relative z-10">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-2 h-2 bg-accent" />
            <span className="text-[10px] font-black text-accent uppercase tracking-[0.4em]">Operational Resource Layer</span>
          </div>
          <h1 className="text-4xl font-black text-ink tracking-tighter">Workforce <span className="text-accent">Inventory</span></h1>
          <p className="text-sm font-bold text-muted mt-2 uppercase tracking-widest leading-relaxed max-w-xl">
            Sovereign personnel management and statutory compliance monitoring for the enterprise.
          </p>
        </div>

        {/*
          Tablet-safe toolbar: search sits on its own full-width row, and the
          three action buttons live in a wrapping row where each can grow to
          fill / wrap to a new line. This guarantees the rightmost button
          (Provision Identity) is never pushed off-screen and clipped by the
          header's overflow-hidden on narrow/tablet widths.
        */}
        <div className="flex flex-col gap-3 sm:gap-4 relative z-10 w-full xl:w-auto">
          <div className="relative w-full xl:w-80">
            <input
              type="text"
              placeholder="Filter by Name, ID, or Role..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full bg-page border border-rule px-4 sm:px-6 py-3 sm:py-4 text-xs font-bold text-ink placeholder:text-muted focus:border-accent focus:ring-4 focus:ring-accent outline-none transition-all"
            />
            <div className="absolute right-5 top-1/2 -translate-y-1/2 text-muted">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
            </div>
          </div>

          <div className="flex flex-wrap gap-3 sm:gap-4">
            <button
              onClick={() => { setUploadResult(null); setCsvRows([]); setCsvFile(''); setBulkOpen(true); }}
              className="flex-1 min-w-[140px] xl:flex-none px-4 sm:px-6 lg:px-8 py-3 sm:py-4 bg-shadow text-paper text-[10px] font-black uppercase tracking-[0.2em] hover:bg-shadow transition-all active:scale-95 flex items-center gap-2 justify-center"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
              </svg>
              Bulk Upload
            </button>

            <button
              onClick={() => { loadApplications(); setApplicationsOpen(true); }}
              className="flex-1 min-w-[140px] xl:flex-none px-4 sm:px-6 lg:px-8 py-3 sm:py-4 bg-highlight text-paper text-[10px] font-black uppercase tracking-[0.2em] hover:bg-highlight transition-all active:scale-95 flex items-center gap-2 justify-center relative"
            >
              Pending Profiles
              {(applications.length + pendingInvites.length) > 0 && (
                <span className="ml-1 bg-paper text-ink text-[9px] font-black w-5 h-5 flex items-center justify-center">
                  {applications.length + pendingInvites.length}
                </span>
              )}
            </button>

            <button
              onClick={() => { setProvisionResult(null); setInviteSent(false); openProvision(); }}
              className="flex-1 min-w-[140px] xl:flex-none px-4 sm:px-6 lg:px-8 py-3 sm:py-4 bg-accent text-paper text-[10px] font-black uppercase tracking-[0.2em] hover:bg-accent transition-all active:scale-95 flex items-center gap-3 justify-center"
            >
              <span>+</span> Provision Identity
            </button>
          </div>
        </div>
      </div>

      {/* 2. Personnel Matrix */}
      <section className="bg-paper border border-rule overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-page text-[10px] font-black text-muted uppercase tracking-[0.2em] border-b border-rule">
                {([
                  { key: 'fullName',       label: 'Identity Reference' },
                  { key: 'department',     label: 'Structural Unit' },
                  { key: 'employmentType', label: 'Contract Class' },
                  { key: 'isActive',       label: 'Status Registry' },
                ] as { key: SortKey; label: string }[]).map(col => (
                  <th key={col.key} className="px-10 py-8">
                    <button onClick={() => handleSort(col.key)} className="flex items-center gap-2 hover:text-accent transition-colors group">
                      {col.label}
                      <span className="flex flex-col gap-[2px] opacity-40 group-hover:opacity-100 transition-opacity">
                        <svg className={`w-2.5 h-2.5 ${sortKey === col.key && sortDir === 'asc' ? 'text-accent opacity-100' : ''}`} viewBox="0 0 10 6" fill="currentColor"><path d="M5 0L10 6H0z" /></svg>
                        <svg className={`w-2.5 h-2.5 ${sortKey === col.key && sortDir === 'desc' ? 'text-accent opacity-100' : ''}`} viewBox="0 0 10 6" fill="currentColor"><path d="M5 6L0 0H10z" /></svg>
                      </span>
                    </button>
                  </th>
                ))}
                <th className="px-10 py-8 text-right">Governance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-rule">
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    <td colSpan={5} className="px-10 py-6"><div className="h-10 bg-page w-full" /></td>
                  </tr>
                ))
              ) : sorted.map(emp => (
                <tr key={emp.id} className="group hover:bg-page transition-all duration-300">
                  <td className="px-10 py-6">
                    <div className="flex items-center gap-5">
                      <div className="h-14 w-14 bg-shadow border border-shadow flex items-center justify-center text-xs font-black text-accent group-hover:scale-110 transition-transform duration-500 relative overflow-hidden flex-shrink-0">
                        {emp.profilePhotoUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={emp.profilePhotoUrl} alt={emp.fullName} className="absolute inset-0 w-full h-full object-cover" />
                        ) : (
                          <>
                            <div className="absolute inset-0 bg-accent opacity-0 group-hover:opacity-100 transition-opacity" />
                            {emp.fullName.split(' ').map(n => n[0]).join('')}
                          </>
                        )}
                      </div>
                      <div className="flex flex-col">
                        <span className="text-sm font-black text-ink group-hover:text-accent transition-colors uppercase tracking-tight">{emp.fullName}</span>
                        <span className="text-[10px] font-bold text-muted uppercase tracking-widest mt-1.5">{emp.employeeCode} • {emp.designation}</span>
                      </div>
                    </div>
                  </td>
                  <td className="px-10 py-6 uppercase">
                    <span className="text-[10px] font-black text-ink tracking-widest bg-page px-3 py-1.5">{emp.department}</span>
                  </td>
                  <td className="px-10 py-6">
                    <span className="text-[10px] font-black text-muted uppercase tracking-widest">{emp.employmentType.replace(/_/g, ' ')}</span>
                  </td>
                  <td className="px-10 py-6">
                    <div className="flex items-center gap-3">
                      <div className={`w-2 h-2  ${emp.isActive ? 'bg-accent animate-pulse' : 'bg-rule'}`} />
                      <span className={`text-[10px] font-black uppercase tracking-[0.2em] ${emp.isActive ? 'text-accent' : 'text-muted'}`}>
                        {emp.isActive ? 'Active Duty' : 'Deactivated'}
                      </span>
                    </div>
                  </td>
                  <td className="px-10 py-6 text-right">
                    <Link
                      href={`/employees/${emp.id}`}
                      className="inline-flex items-center gap-3 px-6 py-2.5 bg-paper border border-rule text-[9px] font-black text-ink uppercase tracking-widest hover:border-accent hover:text-accent hover:bg-page transition-all active:scale-95"
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
                      <p className="text-[10px] font-black text-muted uppercase tracking-[0.3em]">No personnel records detected in sector</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="p-8 bg-page border-t border-rule flex flex-col sm:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <span className="eyebrow-tight">Global Aggregation</span>
            <div className="h-6 w-[1px] bg-rule" />
            <span className="text-[10px] font-black text-ink uppercase">Total Workforce: <span className="text-accent">{total} Entities</span></span>
          </div>
          <div className="flex items-center gap-2">
            <button className="w-10 h-10 flex items-center justify-center bg-paper border border-rule text-muted hover:text-accent hover:border-accent transition-all disabled:opacity-30" disabled>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M15 19l-7-7 7-7" /></svg>
            </button>
            <div className="px-5 py-2 bg-shadow text-[10px] font-black text-accent uppercase tracking-widest">Sector 1</div>
            <button className="w-10 h-10 flex items-center justify-center bg-paper border border-rule text-muted hover:text-accent hover:border-accent transition-all">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M9 5l7 7-7 7" /></svg>
            </button>
          </div>
        </div>
      </section>

      {/* Provision Identity Modal */}
      {provisionOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-shadow backdrop-">
          <div className="w-full max-w-md bg-paper flex flex-col overflow-hidden">

            <div className="flex items-center justify-between px-8 py-6 border-b border-rule">
              <div>
                <h2 className="text-lg font-black text-ink tracking-tighter">Provision Identity</h2>
                <p className="eyebrow-tight mt-0.5">Create login credentials for an employee</p>
              </div>
              <button onClick={resetProvision} className="w-9 h-9 flex items-center justify-center text-muted hover:text-ink hover:bg-page transition-all text-lg">✕</button>
            </div>

            <div className="flex flex-col gap-5 p-8">

              {/* Copy from Employee (Template) */}
              <div className="flex flex-col gap-2">
                <label className="text-[10px] font-black text-muted uppercase tracking-widest">Copy from Employee <span className="text-accent">(Template)</span></label>
                <select
                  value={templateEmpId}
                  onChange={e => onTemplateSelect(e.target.value)}
                  className="w-full px-4 py-3 bg-page border border-rule text-sm font-bold text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent transition-all appearance-none"
                >
                  <option value="">— Standalone account only (no employee record) —</option>
                  {allEmployeesForDropdown.length === 0 && (
                    <option disabled value="">Loading…</option>
                  )}
                  {allEmployeesForDropdown.map(emp => (
                    <option key={emp.id} value={emp.id}>
                      {emp.fullName} · {emp.employeeCode} · {emp.department}
                    </option>
                  ))}
                </select>
                <p className="text-[9px] font-bold text-muted uppercase tracking-widest">
                  Copies department, designation &amp; employment type — creates a new independent employee record.
                </p>
              </div>

              {/* Template preview */}
              {templateEmpId && templatePreview && (
                <div className="flex flex-col gap-2 px-4 py-3 bg-page border border-accent">
                  <p className="text-[9px] font-black text-accent uppercase tracking-widest">Will copy from template</p>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                    {[
                      ['Department', templatePreview.department],
                      ['Designation', templatePreview.designation],
                      ['Employment Type', templatePreview.employmentType?.replace(/_/g, ' ')],
                      ['Citizenship', templatePreview.citizenshipStatus],
                    ].map(([label, val]) => (
                      <div key={label}>
                        <p className="text-[8px] font-black text-accent uppercase tracking-widest">{label}</p>
                        <p className="text-[10px] font-bold text-accent">{val || '—'}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {templateEmpId && !templatePreview && (
                <div className="flex items-center gap-2 px-4 py-2 text-[10px] font-bold text-muted">
                  <span className="w-3 h-3 border-2 border-t-rule border-rule animate-spin rounded-full" />
                  Loading template data…
                </div>
              )}

              {/* Display name */}
              <div className="flex flex-col gap-2">
                <label className="text-[10px] font-black text-muted uppercase tracking-widest">Display Name</label>
                <input
                  type="text"
                  value={provisionName}
                  onChange={e => setProvisionName(e.target.value)}
                  placeholder="Full name"
                  className="w-full px-4 py-3 bg-page border border-rule text-sm font-bold text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent transition-all placeholder:font-normal placeholder:text-muted"
                />
              </div>

              {/* Email */}
              <div className="flex flex-col gap-2">
                <label className="text-[10px] font-black text-muted uppercase tracking-widest">Login Email</label>
                <input
                  type="email"
                  value={provisionEmail}
                  onChange={e => setProvisionEmail(e.target.value)}
                  placeholder="user@company.com"
                  className="w-full px-4 py-3 bg-page border border-rule text-sm font-bold text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent transition-all placeholder:font-normal placeholder:text-muted"
                />
              </div>

              {/* Temporary password */}
              <div className="flex flex-col gap-2">
                <label className="text-[10px] font-black text-muted uppercase tracking-widest">Temporary Password</label>
                <div className="relative">
                  <input
                    type={provisionShowPass ? 'text' : 'password'}
                    value={provisionPassword}
                    onChange={e => setProvisionPassword(e.target.value)}
                    placeholder="Min 8 characters"
                    className="w-full px-4 py-3 pr-12 bg-page border border-rule text-sm font-bold text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent transition-all placeholder:font-normal placeholder:text-muted"
                  />
                  <button
                    type="button"
                    onClick={() => setProvisionShowPass(s => !s)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-ink transition-colors text-xs font-black uppercase tracking-widest px-1"
                  >
                    {provisionShowPass ? 'Hide' : 'Show'}
                  </button>
                </div>
              </div>

              {/* Role */}
              <div className="flex flex-col gap-2">
                <label className="text-[10px] font-black text-muted uppercase tracking-widest">System Role</label>
                <select
                  value={provisionRole}
                  onChange={e => setProvisionRole(e.target.value)}
                  className="w-full px-4 py-3 bg-page border border-rule text-sm font-bold text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent transition-all appearance-none"
                >
                  <option value="EMPLOYEE">Employee</option>
                  <option value="LINE_MANAGER">Line Manager</option>
                  <option value="RECRUITER">Recruiter</option>
                  <option value="HR_MANAGER">HR Manager</option>
                  <option value="HR_ADMIN">HR Admin</option>
                  <option value="PAYROLL_OFFICER">Payroll Officer</option>
                  <option value="FINANCE_ADMIN">Finance Admin</option>
                  <option value="IT_ADMIN">IT Admin</option>
                  <option value="SUPER_ADMIN">Super Admin</option>
                </select>
              </div>

              {/* Result banner */}
              {provisionResult && (
                <div className={`px-4 py-3  text-xs font-bold ${provisionResult.ok ? 'bg-page text-accent border border-accent' : 'bg-page text-ink border border-ink'}`}>
                  {provisionResult.message}
                </div>
              )}

              {provisionResult?.ok && provisionResult.userId && !inviteSent && (
                <div className="bg-page border border-accent p-4">
                  <p className="text-xs font-black text-accent mb-1">Send Onboarding Invitation</p>
                  <p className="text-[10px] font-bold text-accent mb-3">Send a secure link so the user can fill in their personal details for HR clearance.</p>
                  <button onClick={() => sendOnboardingInvite(provisionResult.userId!)} disabled={sendingInvite}
                    className="w-full px-4 py-2.5 bg-accent hover:bg-accent disabled:opacity-50 text-paper text-[10px] font-black uppercase tracking-widest transition-all">
                    {sendingInvite ? 'Sending…' : 'Send Onboarding Email'}
                  </button>
                </div>
              )}

              {inviteSent && (
                <div className="bg-page border border-accent px-4 py-3 text-xs font-bold text-accent">
                  Onboarding invite sent to {provisionEmail}
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-3 pt-1">
                <button
                  onClick={() => { resetProvision(); setInviteSent(false); }}
                  className="flex-1 px-4 py-3 border border-rule text-[10px] font-black text-ink uppercase tracking-widest hover:bg-page transition-all"
                >
                  {provisionResult?.ok ? 'Close' : 'Cancel'}
                </button>
                {!provisionResult?.ok && (
                  <button
                    onClick={submitProvision}
                    disabled={provisioning || !provisionEmail || !provisionPassword || !provisionName}
                    className="flex-1 px-4 py-3 bg-accent hover:bg-accent disabled:opacity-50 text-paper text-[10px] font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2"
                  >
                    {provisioning && <span className="w-3 h-3 border-2 border-paper/40 border-t-paper animate-spin rounded-full" />}
                    {provisioning ? 'Provisioning…' : templateEmpId ? 'Create Account + Pre-fill Profile' : 'Create Account'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Application Review Panel ─────────────────────────────────────────── */}
      {reviewingApp && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-shadow backdrop-">
          <div className="w-full max-w-2xl bg-paper flex flex-col max-h-[90vh] overflow-hidden">
            {/* Header */}
            <div className="px-8 pt-8 pb-6 border-b border-rule flex items-start justify-between flex-shrink-0">
              <div>
                <p className="label-form mb-1">Pending HR Verification</p>
                <h2 className="text-xl font-black text-ink tracking-tighter">{reviewingApp.fullName}</h2>
                <p className="text-xs font-bold text-muted mt-0.5">{reviewingApp.email} · Submitted {new Date(reviewingApp.createdAt).toLocaleDateString('en-SG', { day: '2-digit', month: 'short', year: 'numeric' })}</p>
              </div>
              <button onClick={() => setReviewingApp(null)} className="text-muted hover:text-ink transition-colors text-xl leading-none">✕</button>
            </div>

            {/* Body */}
            <div className="overflow-y-auto flex-1 px-8 py-6 flex flex-col gap-6">

              {/* Personal Details */}
              <section>
                <p className="label-form mb-3 border-b border-rule pb-2">Personal Details</p>
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
                      <p className="label-form">{label}</p>
                      <p className="text-sm font-bold text-ink mt-0.5">{val}</p>
                    </div>
                  ))}
                </div>
              </section>

              {/* Contact */}
              <section>
                <p className="label-form mb-3 border-b border-rule pb-2">Contact & Address</p>
                <div className="grid grid-cols-2 gap-x-8 gap-y-3">
                  {[
                    ['Mobile', reviewingApp.personalPhone || '—'],
                    ['Home Address', reviewingApp.homeAddress || '—'],
                  ].map(([label, val]) => (
                    <div key={label} className={label === 'Home Address' ? 'col-span-2' : ''}>
                      <p className="label-form">{label}</p>
                      <p className="text-sm font-bold text-ink mt-0.5">{val}</p>
                    </div>
                  ))}
                </div>
              </section>

              {/* Employment */}
              <section>
                <p className="label-form mb-3 border-b border-rule pb-2">Employment</p>
                <div className="grid grid-cols-2 gap-x-8 gap-y-3">
                  {[
                    ['Department', reviewingApp.department || '—'],
                    ['Designation', reviewingApp.designation || '—'],
                    ['Employment Type', reviewingApp.employmentType?.replace('_', ' ') || '—'],
                    ['Start Date', reviewingApp.startDate ? new Date(reviewingApp.startDate).toLocaleDateString('en-SG') : '—'],
                  ].map(([label, val]) => (
                    <div key={label}>
                      <p className="label-form">{label}</p>
                      <p className="text-sm font-bold text-ink mt-0.5">{val}</p>
                    </div>
                  ))}
                </div>
              </section>

              {/* Banking */}
              <section>
                <p className="label-form mb-3 border-b border-rule pb-2">Banking</p>
                <div className="grid grid-cols-2 gap-x-8 gap-y-3">
                  {[
                    ['Bank', reviewingApp.bankName || '—'],
                    ['Account Number', reviewingApp.bankAccount || '—'],
                  ].map(([label, val]) => (
                    <div key={label}>
                      <p className="label-form">{label}</p>
                      <p className="text-sm font-bold text-ink mt-0.5">{val}</p>
                    </div>
                  ))}
                </div>
              </section>

              {reviewingApp.notes && (
                <section>
                  <p className="label-form mb-2">Notes from Employee</p>
                  <p className="text-sm font-bold text-ink bg-page border border-rule px-4 py-3">{reviewingApp.notes}</p>
                </section>
              )}
            </div>

            {/* Actions */}
            <div className="px-8 py-5 border-t border-rule flex items-center justify-between flex-shrink-0">
              <button onClick={() => { rejectApplication(reviewingApp.id); setReviewingApp(null); }}
                className="px-5 py-2.5 text-[10px] font-black text-ink border border-ink bg-page uppercase tracking-widest hover:bg-page transition-all">
                Reject Application
              </button>
              <div className="flex items-center gap-3">
                <button onClick={() => setReviewingApp(null)}
                  className="px-5 py-2.5 text-[10px] font-black text-muted border border-rule uppercase tracking-widest hover:bg-page transition-all">
                  Cancel
                </button>
                <button
                  onClick={() => { approveApplication(reviewingApp.id); setReviewingApp(null); }}
                  disabled={approvingId === reviewingApp.id}
                  className="px-6 py-2.5 text-[10px] font-black text-paper bg-accent hover:bg-accent disabled:opacity-50 uppercase tracking-widest transition-all flex items-center gap-2">
                  {approvingId === reviewingApp.id && <span className="w-3.5 h-3.5 border-2 border-paper/30 border-t-paper animate-spin rounded-full" />}
                  Approve & Create Employee
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* HR Fill-on-Behalf Modal */}
      {hrFillUser && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-shadow backdrop-">
          <div className="w-full max-w-2xl bg-paper flex flex-col max-h-[90vh] overflow-hidden">
            <div className="flex items-center justify-between px-8 py-6 border-b border-rule flex-shrink-0">
              <div>
                <h2 className="text-lg font-black text-ink tracking-tighter">Fill on Behalf</h2>
                <p className="eyebrow-tight mt-0.5">{hrFillUser.name} · {hrFillUser.email}</p>
              </div>
              <button onClick={() => { setHrFillUser(null); setHrFillData({}); setHrFillError(''); }} className="w-9 h-9 flex items-center justify-center text-muted hover:text-ink hover:bg-page transition-all text-lg">✕</button>
            </div>

            <div className="overflow-y-auto flex-1 px-8 py-6 flex flex-col gap-6">
              {/* Personal */}
              <section>
                <p className="label-form mb-4 border-b border-rule pb-2">Personal Details</p>
                <div className="grid grid-cols-2 gap-4">
                  {[
                    { key: 'fullName', label: 'Full Legal Name', required: true },
                    { key: 'preferredName', label: 'Preferred Name' },
                    { key: 'nricFin', label: 'NRIC / FIN' },
                    { key: 'dateOfBirth', label: 'Date of Birth', type: 'date' },
                    { key: 'nationality', label: 'Nationality' },
                    { key: 'personalPhone', label: 'Mobile' },
                  ].map(f => (
                    <div key={f.key}>
                      <label className="label-form block mb-1.5">{f.label}{f.required && <span className="text-ink ml-0.5">*</span>}</label>
                      <input
                        type={f.type || 'text'}
                        value={hrFillData[f.key] || ''}
                        onChange={e => setHrFillData(p => ({ ...p, [f.key]: e.target.value }))}
                        className="w-full px-3 py-2.5 border border-rule text-sm font-bold text-ink bg-page outline-none focus:border-accent focus:ring-2 focus:ring-accent transition-all"
                        placeholder={f.required ? 'Required' : 'Optional'}
                      />
                    </div>
                  ))}
                  <div>
                    <label className="label-form block mb-1.5">Gender</label>
                    <select value={hrFillData.gender || ''} onChange={e => setHrFillData(p => ({ ...p, gender: e.target.value }))} className="w-full px-3 py-2.5 border border-rule text-sm font-bold text-ink bg-page outline-none focus:border-accent appearance-none">
                      <option value="">— Select —</option>
                      <option value="MALE">Male</option>
                      <option value="FEMALE">Female</option>
                      <option value="PREFER_NOT_TO_SAY">Prefer not to say</option>
                    </select>
                  </div>
                  <div className="col-span-2">
                    <label className="label-form block mb-1.5">Home Address</label>
                    <input type="text" value={hrFillData.homeAddress || ''} onChange={e => setHrFillData(p => ({ ...p, homeAddress: e.target.value }))} className="w-full px-3 py-2.5 border border-rule text-sm font-bold text-ink bg-page outline-none focus:border-accent focus:ring-2 focus:ring-accent transition-all" placeholder="Block, Street, Unit, Postal Code" />
                  </div>
                </div>
              </section>

              {/* Employment */}
              <section>
                <p className="label-form mb-4 border-b border-rule pb-2">Employment</p>
                <div className="grid grid-cols-2 gap-4">
                  {[
                    { key: 'department', label: 'Department' },
                    { key: 'designation', label: 'Designation' },
                    { key: 'startDate', label: 'Start Date', type: 'date' },
                  ].map(f => (
                    <div key={f.key}>
                      <label className="label-form block mb-1.5">{f.label}</label>
                      <input type={f.type || 'text'} value={hrFillData[f.key] || ''} onChange={e => setHrFillData(p => ({ ...p, [f.key]: e.target.value }))} className="w-full px-3 py-2.5 border border-rule text-sm font-bold text-ink bg-page outline-none focus:border-accent focus:ring-2 focus:ring-accent transition-all" placeholder="Optional" />
                    </div>
                  ))}
                  <div>
                    <label className="label-form block mb-1.5">Employment Type</label>
                    <select value={hrFillData.employmentType || ''} onChange={e => setHrFillData(p => ({ ...p, employmentType: e.target.value }))} className="w-full px-3 py-2.5 border border-rule text-sm font-bold text-ink bg-page outline-none focus:border-accent appearance-none">
                      <option value="">— Select —</option>
                      <option value="FULL_TIME">Full Time</option>
                      <option value="PART_TIME">Part Time</option>
                      <option value="CONTRACT">Contract</option>
                      <option value="INTERN">Intern</option>
                    </select>
                  </div>
                </div>
              </section>

              {/* Banking */}
              <section>
                <p className="label-form mb-4 border-b border-rule pb-2">Banking</p>
                <div className="grid grid-cols-2 gap-4">
                  {[
                    { key: 'bankName', label: 'Bank Name' },
                    { key: 'bankAccount', label: 'Account Number' },
                  ].map(f => (
                    <div key={f.key}>
                      <label className="label-form block mb-1.5">{f.label}</label>
                      <input type="text" value={hrFillData[f.key] || ''} onChange={e => setHrFillData(p => ({ ...p, [f.key]: e.target.value }))} className="w-full px-3 py-2.5 border border-rule text-sm font-bold text-ink bg-page outline-none focus:border-accent focus:ring-2 focus:ring-accent transition-all" placeholder="Optional" />
                    </div>
                  ))}
                </div>
              </section>

              {/* Notes */}
              <section>
                <label className="label-form block mb-1.5">Notes</label>
                <textarea value={hrFillData.notes || ''} onChange={e => setHrFillData(p => ({ ...p, notes: e.target.value }))} rows={2} className="w-full px-3 py-2.5 border border-rule text-sm font-bold text-ink bg-page outline-none focus:border-accent focus:ring-2 focus:ring-accent transition-all resize-none" placeholder="Optional notes for HR" />
              </section>

              {hrFillError && <p className="text-[11px] font-bold text-ink bg-page border border-ink px-4 py-2.5">{hrFillError}</p>}
            </div>

            <div className="px-8 py-5 border-t border-rule flex items-center justify-between flex-shrink-0">
              <button onClick={() => { setHrFillUser(null); setHrFillData({}); setHrFillError(''); }} className="eyebrow-tight hover:text-ink transition-colors">Cancel</button>
              <button
                onClick={submitHrFill}
                disabled={hrFillSubmitting || !hrFillData.fullName}
                className="px-6 py-2.5 bg-accent hover:bg-accent disabled:opacity-50 text-paper text-[10px] font-black uppercase tracking-widest flex items-center gap-2 transition-all"
              >
                {hrFillSubmitting && <span className="w-3.5 h-3.5 border-2 border-paper/30 border-t-paper animate-spin rounded-full" />}
                Submit for HR Review
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pending Profiles Modal */}
      {applicationsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-shadow backdrop-">
          <div className="w-full max-w-4xl bg-paper flex flex-col max-h-[85vh] overflow-hidden">
            <div className="flex items-center justify-between px-8 py-6 border-b border-rule">
              <div>
                <h2 className="text-lg font-black text-ink tracking-tighter">Pending Employee Profiles</h2>
                <p className="label-form mt-1">
                  {pendingInvites.length} awaiting submission · {applications.length} awaiting HR verification
                </p>
              </div>
              <button onClick={() => setApplicationsOpen(false)} className="text-muted hover:text-ink text-xl font-black transition-colors">✕</button>
            </div>

            {(() => {
              const sortInvites = (arr: typeof pendingInvites) => [...arr].sort((a, b) => {
                const d = pendingSort.dir === 'asc' ? 1 : -1;
                if (pendingSort.col === 'name') return d * a.name.localeCompare(b.name);
                if (pendingSort.col === 'date') return d * (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
                return 0;
              });
              const sortApps = (arr: typeof applications) => [...arr].sort((a, b) => {
                const d = pendingSort.dir === 'asc' ? 1 : -1;
                if (pendingSort.col === 'name') return d * (a.fullName || '').localeCompare(b.fullName || '');
                if (pendingSort.col === 'dept') return d * (a.department || '').localeCompare(b.department || '');
                if (pendingSort.col === 'date') return d * (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
                return 0;
              });
              const sortedInvites = sortInvites(pendingInvites);
              const sortedApps = sortApps(applications);
              function togglePendingSort(col: typeof pendingSort.col) {
                setPendingSort(prev => prev.col === col ? { col, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'asc' });
              }
              function PendingSortIcon({ col }: { col: typeof pendingSort.col }) {
                return <span className="text-[8px] ml-1">{pendingSort.col === col ? (pendingSort.dir === 'asc' ? '▲' : '▼') : '⇅'}</span>;
              }
              return (
            <div className="overflow-y-auto flex-1">
              {appLoading ? (
                <div className="p-16 text-center text-muted text-sm font-bold">Loading…</div>
              ) : pendingInvites.length === 0 && applications.length === 0 ? (
                <div className="p-16 flex flex-col items-center gap-4">
                  <div className="w-14 h-14 bg-page border border-rule flex items-center justify-center text-2xl">📋</div>
                  <p className="text-sm font-black text-muted uppercase tracking-widest">No pending profiles</p>
                  <p className="text-xs font-bold text-muted text-center max-w-sm">Provision a user and send them an onboarding invite to get started.</p>
                </div>
              ) : (
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-page text-muted text-[9px] font-black uppercase tracking-[0.18em] border-b border-rule">
                      {([
                        { col: 'name', label: 'Name / Email', cls: 'px-8 py-4' },
                        { col: null,   label: 'Status',       cls: 'px-4 py-4' },
                        { col: 'dept', label: 'Department',   cls: 'px-4 py-4' },
                        { col: 'date', label: 'Date',         cls: 'px-4 py-4' },
                        { col: null,   label: 'Actions',      cls: 'px-8 py-4 text-right' },
                      ] as const).map(h => (
                        <th key={h.label} className={h.cls}>
                          {h.col ? (
                            <button onClick={() => togglePendingSort(h.col!)} className="flex items-center hover:text-ink transition-colors">
                              {h.label}<PendingSortIcon col={h.col} />
                            </button>
                          ) : h.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-rule">

                    {/* ── Pending User Submission (invited, not yet filled form) ── */}
                    {sortedInvites.map(u => (
                      <tr key={u.id} className="hover:bg-page transition-all">
                        <td className="px-8 py-5">
                          <p className="text-sm font-black text-ink">{u.name}</p>
                          <p className="text-[9px] font-bold text-muted mt-0.5">{u.email}</p>
                        </td>
                        <td className="px-4 py-5">
                          <span className="inline-flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest border px-2.5 py-1 bg-page text-ink border-highlight">
                            <span className="w-1.5 h-1.5 bg-highlight animate-pulse" />
                            Pending User Submission
                          </span>
                        </td>
                        <td className="px-4 py-5">
                          <span className="text-[9px] text-muted font-bold">—</span>
                        </td>
                        <td className="px-4 py-5">
                          <div>
                            <span className="text-[9px] font-bold text-muted">Invited {new Date(u.createdAt).toLocaleDateString('en-SG', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
                            {u.inviteExpiry && new Date(u.inviteExpiry) < new Date() && (
                              <p className="text-[9px] font-black text-ink mt-0.5">Link expired</p>
                            )}
                          </div>
                        </td>
                        <td className="px-8 py-5 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => { setHrFillData({ fullName: u.name }); setHrFillUser({ id: u.id, name: u.name, email: u.email }); }}
                              className="text-[9px] font-black text-accent border border-accent bg-page px-3 py-1.5 uppercase tracking-widest hover:bg-page transition-all"
                            >
                              Fill on Behalf
                            </button>
                            <button
                              onClick={() => retriggerInvite(u.id)}
                              disabled={retriggeringId === u.id}
                              className="text-[9px] font-black text-accent border border-accent bg-page px-3 py-1.5 uppercase tracking-widest hover:bg-page disabled:opacity-50 transition-all"
                            >
                              {retriggeringId === u.id ? 'Sending…' : 'Re-send Email'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}

                    {/* ── Pending HR Verification (submitted, waiting for HR) ── */}
                    {sortedApps.map(app => (
                      <tr key={app.id} className="hover:bg-page transition-all">
                        <td className="px-8 py-5">
                          <p className="text-sm font-black text-ink">{app.fullName}</p>
                          <p className="text-[9px] font-bold text-muted mt-0.5">{app.email}</p>
                        </td>
                        <td className="px-4 py-5">
                          <span className="inline-flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest border px-2.5 py-1 bg-page text-accent border-accent">
                            <span className="w-1.5 h-1.5 bg-accent" />
                            Pending HR Verification
                          </span>
                        </td>
                        <td className="px-4 py-5">
                          <span className="text-[9px] font-black text-ink uppercase tracking-widest">{app.department || '—'}</span>
                          {app.designation && <p className="text-[9px] font-bold text-muted mt-0.5">{app.designation}</p>}
                        </td>
                        <td className="px-4 py-5">
                          <span className="text-[9px] font-bold text-muted">{new Date(app.createdAt).toLocaleDateString('en-SG', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
                        </td>
                        <td className="px-8 py-5 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => {
                                setHrFillData({
                                  fullName: app.fullName || '',
                                  preferredName: app.preferredName || '',
                                  gender: app.gender || '',
                                  dateOfBirth: app.dateOfBirth ? app.dateOfBirth.slice(0, 10) : '',
                                  nationality: app.nationality || '',
                                  nricFin: app.nricFin || '',
                                  personalPhone: app.personalPhone || '',
                                  homeAddress: app.homeAddress || '',
                                  department: app.department || '',
                                  designation: app.designation || '',
                                  employmentType: app.employmentType || '',
                                  startDate: app.startDate ? app.startDate.slice(0, 10) : '',
                                  bankName: app.bankName || '',
                                  bankAccount: app.bankAccount || '',
                                  basicSalary: app.basicSalary || '',
                                  notes: app.notes || '',
                                });
                                setHrFillUser({ id: app.userId, name: app.fullName, email: app.email });
                              }}
                              className="text-[9px] font-black text-accent border border-accent bg-page px-3 py-1.5 uppercase tracking-widest hover:bg-page transition-all"
                            >
                              Edit Details
                            </button>
                            <button
                              onClick={() => retriggerInvite(app.userId)}
                              disabled={retriggeringId === app.userId}
                              className="text-[9px] font-black text-muted border border-rule bg-page px-3 py-1.5 uppercase tracking-widest hover:bg-page disabled:opacity-50 transition-all"
                            >
                              {retriggeringId === app.userId ? 'Sending…' : 'Re-send Email'}
                            </button>
                            <button onClick={() => setReviewingApp(app)}
                              className="text-[9px] font-black text-accent border border-accent bg-page px-3 py-1.5 uppercase tracking-widest hover:bg-page transition-all">
                              Review →
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}

                  </tbody>
                </table>
              )}
            </div>
              ); })()}

            <div className="px-8 py-5 border-t border-rule flex items-center justify-between">
              <div className="flex items-center gap-6 text-[9px] font-black uppercase tracking-widest text-muted">
                <span className="flex items-center gap-1.5"><span className="w-2 h-2 bg-highlight" /> Pending User Submission — awaiting employee self-fill</span>
                <span className="flex items-center gap-1.5"><span className="w-2 h-2 bg-accent" /> Pending HR Verification — HR action required</span>
              </div>
              <button onClick={() => setApplicationsOpen(false)}
                className="eyebrow-tight hover:text-ink transition-colors">
                Close
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
