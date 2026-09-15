'use client';

import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { apiFetch } from '@/lib/api';
import {
  Badge, Button, Card, DataTable, EmptyState, Field, Icon, Input, Modal, PageHeader, SearchInput, Select, Textarea, type Column,
} from '@/components/ui';
import { Detail, Notice, PageLoading, PersonAvatar, Spinner } from '@/components/employee/RecordParts';

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
  const router = useRouter();
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

  // Load pending count on mount so the pending count shows without clicking
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

  const pendingCount = applications.length + pendingInvites.length;
  const fmtShort = (d: string) => new Date(d).toLocaleDateString('en-SG', { day: '2-digit', month: 'short', year: 'numeric' });

  const columns: Column<Employee>[] = [
    {
      key: 'fullName', width: 'minmax(0, 1.7fr)',
      label: <SortHeader label="Employee" active={sortKey === 'fullName'} dir={sortDir} onClick={() => handleSort('fullName')} />,
      render: emp => (
        <div className="flex items-center gap-3 min-w-0">
          <PersonAvatar name={emp.fullName} photoUrl={emp.profilePhotoUrl} size={32} />
          <div className="flex flex-col min-w-0">
            <span className="font-semibold text-ink truncate">{emp.fullName}</span>
            <span className="text-xs text-muted tabular-nums">{emp.employeeCode}</span>
          </div>
        </div>
      ),
    },
    {
      key: 'department', width: 'minmax(0, 1fr)',
      label: <SortHeader label="Department" active={sortKey === 'department'} dir={sortDir} onClick={() => handleSort('department')} />,
      render: emp => <span className="text-ink">{emp.department || '—'}</span>,
    },
    { key: 'designation', label: 'Role', width: 'minmax(0, 1.1fr)', render: emp => <span className="text-ink">{emp.designation || '—'}</span> },
    {
      key: 'employmentType', width: '120px',
      label: <SortHeader label="Type" active={sortKey === 'employmentType'} dir={sortDir} onClick={() => handleSort('employmentType')} />,
      render: emp => <span className="text-muted">{typeLabel(emp.employmentType)}</span>,
    },
    { key: 'residency', label: 'Residency', width: '120px', render: emp => <Badge tone="neutral">{RESIDENCY_LABEL[emp.citizenshipStatus] ?? (emp.citizenshipStatus || '—')}</Badge> },
    {
      key: 'isActive', width: '110px',
      label: <SortHeader label="Status" active={sortKey === 'isActive'} dir={sortDir} onClick={() => handleSort('isActive')} />,
      render: emp => <Badge tone={emp.isActive ? 'ok' : 'neutral'}>{emp.isActive ? 'Active' : 'Inactive'}</Badge>,
    },
    { key: 'go', label: <span className="sr-only">Open</span>, width: '28px', align: 'right', render: () => <Icon name="chevronRight" size={16} className="text-muted" /> },
  ];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Employees"
        subtitle={
          <span className="tabular-nums">
            {total} employee{total === 1 ? '' : 's'}
            {pendingCount > 0 && <> · {pendingCount} profile{pendingCount === 1 ? '' : 's'} waiting</>}
          </span>
        }
        actions={
          <div className="flex flex-wrap gap-2.5">
            <Button variant="secondary" icon="upload" onClick={() => { setUploadResult(null); setCsvRows([]); setCsvFile(''); setBulkOpen(true); }}>
              Bulk upload
            </Button>
            <Button variant="secondary" icon="users" onClick={() => { loadApplications(); setApplicationsOpen(true); }}>
              Pending profiles
              {pendingCount > 0 && <Badge tone="warn" className="tabular-nums">{pendingCount}</Badge>}
            </Button>
            <Button icon="plus" onClick={() => { setProvisionResult(null); setInviteSent(false); openProvision(); }}>
              Add employee
            </Button>
          </div>
        }
      />

      {/* Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SearchInput
          className="w-full sm:w-80"
          placeholder="Search name, ID or role…"
          aria-label="Search employees"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
        />
        {!loading && (
          <span className="text-[13px] text-muted tabular-nums">Showing {employees.length} of {total}</span>
        )}
      </div>

      {loading ? (
        <Card padding="p-0" aria-hidden>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-5 h-[52px] border-b border-rule last:border-0 animate-pulse">
              <div className="h-[30px] w-[30px] rounded-full bg-pill" />
              <div className="h-3 w-1/4 rounded bg-pill" />
              <div className="ml-auto h-3 w-1/6 rounded bg-pill" />
            </div>
          ))}
        </Card>
      ) : (
        <DataTable
          aria-label="Employees"
          columns={columns}
          rows={sorted}
          rowKey={emp => emp.id}
          onRowClick={emp => router.push(`/employees/${emp.id}`)}
          mobileCard={emp => (
            <div className="flex items-center gap-3">
              <PersonAvatar name={emp.fullName} photoUrl={emp.profilePhotoUrl} size={36} />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-semibold text-ink">{emp.fullName}</span>
                <span className="truncate text-xs text-muted">{emp.designation || '—'} · {emp.department || '—'}</span>
              </div>
              <Badge tone={emp.isActive ? 'ok' : 'neutral'}>{emp.isActive ? 'Active' : 'Inactive'}</Badge>
            </div>
          )}
          empty={searchQuery ? (
            <EmptyState
              icon="search"
              title={`No employees match “${searchQuery}”`}
              description="Check the spelling, or search by employee ID."
              action={<Button variant="secondary" onClick={() => setSearchQuery('')}>Clear search</Button>}
            />
          ) : (
            <EmptyState
              icon="users"
              title="No employees yet"
              description="Add people one at a time, or upload a CSV for many at once."
              action={
                <div className="flex flex-wrap justify-center gap-2.5">
                  <Button variant="secondary" icon="upload" onClick={() => { setUploadResult(null); setCsvRows([]); setCsvFile(''); setBulkOpen(true); }}>Bulk upload</Button>
                  <Button icon="plus" onClick={() => { setProvisionResult(null); setInviteSent(false); openProvision(); }}>Add employee</Button>
                </div>
              }
            />
          )}
          footer={<span className="tabular-nums">Showing {employees.length} of {total} employees</span>}
        />
      )}

      {/* ── Bulk upload ─────────────────────────────────────────────────────── */}
      <Modal
        open={bulkOpen}
        onClose={resetModal}
        size="lg"
        title="Bulk import employees"
        caption="CSV file, up to 500 people per upload"
        footer={
          <>
            <Button variant="secondary" onClick={resetModal}>{uploadResult ? 'Close' : 'Cancel'}</Button>
            {!uploadResult && (
              <Button
                icon={uploading ? undefined : 'upload'}
                onClick={submitBulk}
                disabled={csvRows.length === 0 || uploading}
                reason={csvRows.length === 0 && !uploading ? 'Choose a CSV file first' : undefined}
              >
                {uploading && <Spinner />}
                {csvRows.length > 0 ? `Import ${csvRows.length} ${csvRows.length === 1 ? 'person' : 'people'}` : 'Import'}
              </Button>
            )}
          </>
        }
      >
        <div className="flex flex-col gap-5">
          {/* Step 1 — template */}
          <div className="flex flex-col gap-3 rounded-control bg-page px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-ink">1. Download the template</p>
              <p className="text-[13px] text-muted">The required columns, with one sample row</p>
            </div>
            <Button variant="secondary" size="sm" icon="download" onClick={() => downloadBlob(buildCsvTemplate(), 'employee-import-template.csv')}>
              Template.csv
            </Button>
          </div>

          {/* Step 2 — upload */}
          <div className="flex flex-col gap-2">
            <p className="text-sm font-semibold text-ink">2. Upload the completed file</p>
            <label className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-control border-2 border-dashed py-8 text-center transition-colors focus-within:ring-2 focus-within:ring-accent/30 ${csvFile ? 'border-accent bg-tint' : 'border-rule hover:border-accent hover:bg-page'}`}>
              <Icon name="file" size={28} className={csvFile ? 'text-accent' : 'text-muted'} />
              {csvFile ? (
                <span className="text-sm font-semibold text-accent tabular-nums">{csvFile} · {csvRows.length} rows read</span>
              ) : (
                <span className="text-sm text-muted">Choose a CSV file</span>
              )}
              <input ref={fileInputRef} type="file" accept=".csv,text/csv" className="sr-only" onChange={onFileChange} />
            </label>
          </div>

          {/* Preview */}
          {csvRows.length > 0 && !uploadResult && (
            <div className="flex flex-col gap-2">
              <p className="text-[13px] font-semibold text-muted tabular-nums">Preview — first {Math.min(3, csvRows.length)} of {csvRows.length} rows</p>
              <div className="overflow-x-auto rounded-control border border-rule">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="bg-pill">
                      {PREVIEW_COLS.map(([h, label]) => (
                        <th key={h} className="px-3 py-2 text-left text-xs font-bold text-muted whitespace-nowrap">{label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-rule">
                    {csvRows.slice(0, 3).map((row, i) => (
                      <tr key={i}>
                        {PREVIEW_COLS.map(([h]) => (
                          <td key={h} className="px-3 py-2 text-ink whitespace-nowrap max-w-[160px] truncate">{row[h] || '—'}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Result — the outcome is stated in words; the tone only supports it. */}
          {uploadResult && (
            <Notice
              tone={uploadResult.failed === 0 ? 'ok' : uploadResult.created === 0 ? 'danger' : 'warn'}
              title={
                <span className="tabular-nums">
                  {uploadResult.failed === 0
                    ? 'All rows imported'
                    : uploadResult.created === 0
                      ? 'Import failed — no rows created'
                      : 'Imported with errors'}
                  {' · '}{uploadResult.created} created · {uploadResult.failed} failed
                </span>
              }
            >
              {uploadResult.results.failed.length > 0 && (
                <ul className="mt-1 flex flex-col gap-0.5 text-[13px]">
                  {uploadResult.results.failed.map((f, i) => (
                    <li key={i}>Row {f.row}: {f.name} — {f.error}</li>
                  ))}
                </ul>
              )}
            </Notice>
          )}
        </div>
      </Modal>

      {/* ── Add employee (provision a login) ────────────────────────────────── */}
      <Modal
        open={provisionOpen}
        onClose={() => { resetProvision(); setInviteSent(false); }}
        title="Add an employee login"
        caption="Create their sign-in details, then send the onboarding form so they can fill in their profile."
        footer={
          <>
            <Button variant="secondary" onClick={() => { resetProvision(); setInviteSent(false); }}>
              {provisionResult?.ok ? 'Close' : 'Cancel'}
            </Button>
            {!provisionResult?.ok && (
              <Button
                onClick={submitProvision}
                disabled={provisioning || !provisionEmail || !provisionPassword || !provisionName}
                reason={!provisioning && (!provisionEmail || !provisionPassword || !provisionName) ? 'Enter a name, email and password' : undefined}
              >
                {provisioning && <Spinner />}
                {provisioning ? 'Creating…' : templateEmpId ? 'Create login and pre-fill profile' : 'Create login'}
              </Button>
            )}
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Field label="Copy job details from" help="Optional. Copies department, designation and employment type into a new, separate employee record.">
            <Select value={templateEmpId} onChange={e => onTemplateSelect(e.target.value)}>
              <option value="">None — create a login only</option>
              {allEmployeesForDropdown.length === 0 && (
                <option disabled value="">Loading…</option>
              )}
              {allEmployeesForDropdown.map(emp => (
                <option key={emp.id} value={emp.id}>
                  {emp.fullName} · {emp.employeeCode} · {emp.department}
                </option>
              ))}
            </Select>
          </Field>

          {templateEmpId && templatePreview && (
            <div className="rounded-control bg-tint px-4 py-3">
              <p className="mb-2 text-[13px] font-semibold text-accent">These details will be copied</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                {[
                  ['Department', templatePreview.department],
                  ['Designation', templatePreview.designation],
                  ['Employment type', typeLabel(templatePreview.employmentType)],
                  ['Residency', RESIDENCY_LABEL[templatePreview.citizenshipStatus] ?? templatePreview.citizenshipStatus],
                ].map(([label, val]) => (
                  <Detail key={label} label={label} value={val || '—'} />
                ))}
              </div>
            </div>
          )}

          {templateEmpId && !templatePreview && (
            <p className="flex items-center gap-2 text-[13px] text-muted" role="status">
              <Spinner /> Loading their details…
            </p>
          )}

          <Field label="Display name" required>
            <Input value={provisionName} onChange={e => setProvisionName(e.target.value)} placeholder="Full name" autoComplete="off" />
          </Field>

          <Field
            label="Login email"
            required
            error={provisionEmail && !provisionEmail.includes('@') ? 'Enter a full email address' : undefined}
          >
            <Input
              type="email"
              value={provisionEmail}
              onChange={e => setProvisionEmail(e.target.value)}
              placeholder="name@company.com"
              invalid={!!provisionEmail && !provisionEmail.includes('@')}
              autoComplete="off"
            />
          </Field>

          <Field
            label="Temporary password"
            required
            help="At least 8 characters. They will be asked to change it."
            error={provisionPassword && provisionPassword.length < 8 ? 'Use at least 8 characters' : undefined}
          >
            <div className="relative">
              <Input
                type={provisionShowPass ? 'text' : 'password'}
                value={provisionPassword}
                onChange={e => setProvisionPassword(e.target.value)}
                invalid={!!provisionPassword && provisionPassword.length < 8}
                autoComplete="new-password"
                className="pr-16"
              />
              <button
                type="button"
                onClick={() => setProvisionShowPass(s => !s)}
                aria-label={provisionShowPass ? 'Hide password' : 'Show password'}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 h-8 px-2.5 rounded-control text-[13px] font-semibold text-accent hover:bg-tint"
              >
                {provisionShowPass ? 'Hide' : 'Show'}
              </button>
            </div>
          </Field>

          <Field label="System role">
            <Select value={provisionRole} onChange={e => setProvisionRole(e.target.value)}>
              <option value="EMPLOYEE">Employee</option>
              <option value="LINE_MANAGER">Line manager</option>
              <option value="RECRUITER">Recruiter</option>
              <option value="HR_MANAGER">HR manager</option>
              <option value="HR_ADMIN">HR admin</option>
              <option value="PAYROLL_OFFICER">Payroll officer</option>
              <option value="FINANCE_ADMIN">Finance admin</option>
              <option value="IT_ADMIN">IT admin</option>
              <option value="SUPER_ADMIN">Super admin</option>
            </Select>
          </Field>

          {provisionResult && (
            <Notice tone={provisionResult.ok ? 'ok' : 'danger'}>{provisionResult.message}</Notice>
          )}

          {provisionResult?.ok && provisionResult.userId && !inviteSent && (
            <div className="flex flex-col gap-3 rounded-control border border-rule p-4">
              <div>
                <p className="text-sm font-semibold text-ink">Send the onboarding form</p>
                <p className="text-[13px] text-muted">Emails a secure link so they can fill in their personal details for HR to check.</p>
              </div>
              <Button icon={sendingInvite ? undefined : 'mail'} onClick={() => sendOnboardingInvite(provisionResult.userId!)} disabled={sendingInvite}>
                {sendingInvite && <Spinner />}
                {sendingInvite ? 'Sending…' : 'Send onboarding email'}
              </Button>
            </div>
          )}

          {inviteSent && (
            <Notice tone="ok">Onboarding invite sent to {provisionEmail}</Notice>
          )}
        </div>
      </Modal>

      {/* ── Pending profiles ────────────────────────────────────────────────── */}
      <Modal
        open={applicationsOpen}
        onClose={() => setApplicationsOpen(false)}
        size="lg"
        title="Pending profiles"
        caption={
          <span className="tabular-nums">
            {pendingInvites.length} waiting for the employee · {applications.length} waiting for HR
          </span>
        }
        footer={<Button variant="secondary" onClick={() => setApplicationsOpen(false)}>Close</Button>}
      >
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

          if (appLoading) return <PageLoading label="Loading pending profiles…" />;
          if (pendingInvites.length === 0 && applications.length === 0) {
            return (
              <EmptyState
                icon="users"
                title="No pending profiles"
                description="Add an employee login and send the onboarding form to get started."
              />
            );
          }

          type PendingRow =
            | { kind: 'invite'; id: string; u: (typeof pendingInvites)[number] }
            | { kind: 'app'; id: string; app: (typeof applications)[number] };
          const rows: PendingRow[] = [
            ...sortedInvites.map(u => ({ kind: 'invite' as const, id: `i-${u.id}`, u })),
            ...sortedApps.map(app => ({ kind: 'app' as const, id: `a-${app.id}`, app })),
          ];

          const openEdit = (app: (typeof applications)[number]) => {
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
          };

          const actions = (r: PendingRow) => r.kind === 'invite' ? (
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button size="sm" variant="secondary" onClick={() => { setHrFillData({ fullName: r.u.name }); setHrFillUser({ id: r.u.id, name: r.u.name, email: r.u.email }); }}>
                Fill in for them
              </Button>
              <Button size="sm" variant="ghost" icon="mail" onClick={() => retriggerInvite(r.u.id)} disabled={retriggeringId === r.u.id}>
                {retriggeringId === r.u.id ? 'Sending…' : 'Resend email'}
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => openEdit(r.app)}>Edit</Button>
              <Button size="sm" variant="ghost" icon="mail" onClick={() => retriggerInvite(r.app.userId)} disabled={retriggeringId === r.app.userId}>
                {retriggeringId === r.app.userId ? 'Sending…' : 'Resend'}
              </Button>
              <Button size="sm" onClick={() => setReviewingApp(r.app)}>Review</Button>
            </div>
          );

          const status = (r: PendingRow) => r.kind === 'invite' ? (
            <span className="flex flex-wrap items-center gap-1.5">
              <Badge tone="warn">Waiting for employee</Badge>
              {r.u.inviteExpiry && new Date(r.u.inviteExpiry) < new Date() && <Badge tone="danger">Link expired</Badge>}
            </span>
          ) : <Badge tone="accent">Needs HR review</Badge>;

          const SORT_LABEL = { name: 'Name', dept: 'Department', date: 'Date' } as const;

          return (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Sort pending profiles">
                <span className="text-[13px] text-muted">Sort by</span>
                {(['name', 'dept', 'date'] as const).map(c => {
                  const on = pendingSort.col === c;
                  return (
                    <button
                      key={c}
                      type="button"
                      onClick={() => togglePendingSort(c)}
                      aria-pressed={on}
                      aria-label={`Sort by ${SORT_LABEL[c]}${on ? (pendingSort.dir === 'asc' ? ', ascending' : ', descending') : ''}`}
                      className={`inline-flex h-8 items-center gap-1 rounded-full border px-3 text-[13px] font-semibold transition-colors ${on ? 'border-accent bg-tint text-accent' : 'border-rule text-muted hover:text-ink'}`}
                    >
                      {SORT_LABEL[c]}
                      {on && <Icon name="chevronDown" size={13} strokeWidth={2.25} className={pendingSort.dir === 'asc' ? 'rotate-180' : ''} />}
                    </button>
                  );
                })}
              </div>

              <ul className="flex flex-col divide-y divide-rule rounded-control border border-rule" aria-label="Pending profiles">
                {rows.map(r => (
                  <li key={r.id} className="flex flex-col gap-3 px-4 py-3 md:flex-row md:items-center md:justify-between">
                    <div className="flex min-w-0 flex-col gap-1.5">
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate font-semibold text-ink">{r.kind === 'invite' ? r.u.name : r.app.fullName}</span>
                        <span className="truncate text-xs text-muted">{r.kind === 'invite' ? r.u.email : r.app.email}</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted tabular-nums">
                        {status(r)}
                        {r.kind === 'app' && (r.app.department || r.app.designation) && (
                          <span>{[r.app.department, r.app.designation].filter(Boolean).join(' · ')}</span>
                        )}
                        <span>{r.kind === 'invite' ? `Invited ${fmtShort(r.u.createdAt)}` : `Submitted ${fmtShort(r.app.createdAt)}`}</span>
                      </div>
                    </div>
                    <div className="shrink-0 [&>div]:justify-start md:[&>div]:justify-end">{actions(r)}</div>
                  </li>
                ))}
              </ul>

              <p className="text-[13px] text-muted">
                <strong className="font-semibold text-ink">Waiting for employee</strong> — they have the link but have not filled it in.{' '}
                <strong className="font-semibold text-ink">Needs HR review</strong> — submitted; check and approve to create the employee.
              </p>
            </div>
          );
        })()}
      </Modal>

      {/* ── Review a submitted profile (opens over Pending profiles) ─────────── */}
      <Modal
        open={!!reviewingApp}
        onClose={() => setReviewingApp(null)}
        size="lg"
        title={reviewingApp ? reviewingApp.fullName : ''}
        caption={reviewingApp ? <>Needs HR review · {reviewingApp.email} · submitted {fmtShort(reviewingApp.createdAt)}</> : undefined}
        footer={reviewingApp ? (
          <>
            <Button variant="danger" className="sm:mr-auto" onClick={() => { rejectApplication(reviewingApp.id); setReviewingApp(null); }}>
              Reject
            </Button>
            <Button variant="secondary" onClick={() => setReviewingApp(null)}>Cancel</Button>
            <Button
              icon={approvingId === reviewingApp.id ? undefined : 'check'}
              onClick={() => { approveApplication(reviewingApp.id); setReviewingApp(null); }}
              disabled={approvingId === reviewingApp.id}
            >
              {approvingId === reviewingApp.id && <Spinner />}
              Approve and create employee
            </Button>
          </>
        ) : undefined}
      >
        {reviewingApp && (
          <div className="flex flex-col gap-5">
            <ReviewSection title="Personal details" rows={[
              ['Full legal name', reviewingApp.fullName],
              ['Preferred name', reviewingApp.preferredName || '—'],
              ['Gender', reviewingApp.gender || '—'],
              ['Date of birth', reviewingApp.dateOfBirth ? new Date(reviewingApp.dateOfBirth).toLocaleDateString('en-SG') : '—'],
              ['Nationality', reviewingApp.nationality || '—'],
              ['NRIC / FIN', reviewingApp.nricFin || '—'],
            ]} />
            <ReviewSection title="Contact and address" rows={[
              ['Mobile', reviewingApp.personalPhone || '—'],
              ['Home address', reviewingApp.homeAddress || '—', true],
            ]} />
            <ReviewSection title="Employment" rows={[
              ['Department', reviewingApp.department || '—'],
              ['Designation', reviewingApp.designation || '—'],
              ['Employment type', reviewingApp.employmentType ? typeLabel(reviewingApp.employmentType) : '—'],
              ['Start date', reviewingApp.startDate ? new Date(reviewingApp.startDate).toLocaleDateString('en-SG') : '—'],
            ]} />
            <ReviewSection title="Bank" rows={[
              ['Bank', reviewingApp.bankName || '—'],
              ['Account number', reviewingApp.bankAccount || '—'],
            ]} />
            {reviewingApp.notes && (
              <section>
                <h3 className="mb-2 text-[14px] font-bold text-ink">Notes from the employee</h3>
                <p className="rounded-control bg-page px-4 py-3 text-sm text-ink whitespace-pre-wrap">{reviewingApp.notes}</p>
              </section>
            )}
          </div>
        )}
      </Modal>

      {/* ── Fill in on the employee's behalf ────────────────────────────────── */}
      <Modal
        open={!!hrFillUser}
        onClose={() => { setHrFillUser(null); setHrFillData({}); setHrFillError(''); }}
        size="lg"
        title="Fill in for the employee"
        caption={hrFillUser ? `${hrFillUser.name} · ${hrFillUser.email}` : undefined}
        footer={
          <>
            <Button variant="secondary" onClick={() => { setHrFillUser(null); setHrFillData({}); setHrFillError(''); }}>Cancel</Button>
            <Button
              onClick={submitHrFill}
              disabled={hrFillSubmitting || !hrFillData.fullName}
              reason={!hrFillSubmitting && !hrFillData.fullName ? 'Full legal name is required' : undefined}
            >
              {hrFillSubmitting && <Spinner />}
              Submit for HR review
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-6">
          <section className="flex flex-col gap-3">
            <h3 className="text-[14px] font-bold text-ink">Personal details</h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {[
                { key: 'fullName', label: 'Full legal name', required: true },
                { key: 'preferredName', label: 'Preferred name' },
                { key: 'nricFin', label: 'NRIC / FIN' },
                { key: 'dateOfBirth', label: 'Date of birth', type: 'date' },
                { key: 'nationality', label: 'Nationality' },
                { key: 'personalPhone', label: 'Mobile' },
              ].map(f => (
                <Field key={f.key} label={f.label} required={f.required} error={f.required && !hrFillData[f.key] ? 'Required' : undefined}>
                  <Input
                    type={f.type || 'text'}
                    value={hrFillData[f.key] || ''}
                    onChange={e => setHrFillData(p => ({ ...p, [f.key]: e.target.value }))}
                    invalid={f.required && !hrFillData[f.key]}
                  />
                </Field>
              ))}
              <Field label="Gender">
                <Select value={hrFillData.gender || ''} onChange={e => setHrFillData(p => ({ ...p, gender: e.target.value }))}>
                  <option value="">Select</option>
                  <option value="MALE">Male</option>
                  <option value="FEMALE">Female</option>
                  <option value="PREFER_NOT_TO_SAY">Prefer not to say</option>
                </Select>
              </Field>
              <Field label="Home address" className="sm:col-span-2">
                <Input value={hrFillData.homeAddress || ''} onChange={e => setHrFillData(p => ({ ...p, homeAddress: e.target.value }))} placeholder="Block, street, unit, postal code" />
              </Field>
            </div>
          </section>

          <section className="flex flex-col gap-3">
            <h3 className="text-[14px] font-bold text-ink">Employment</h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {[
                { key: 'department', label: 'Department' },
                { key: 'designation', label: 'Designation' },
                { key: 'startDate', label: 'Start date', type: 'date' },
              ].map(f => (
                <Field key={f.key} label={f.label}>
                  <Input type={f.type || 'text'} value={hrFillData[f.key] || ''} onChange={e => setHrFillData(p => ({ ...p, [f.key]: e.target.value }))} />
                </Field>
              ))}
              <Field label="Employment type">
                <Select value={hrFillData.employmentType || ''} onChange={e => setHrFillData(p => ({ ...p, employmentType: e.target.value }))}>
                  <option value="">Select</option>
                  <option value="FULL_TIME">Full time</option>
                  <option value="PART_TIME">Part time</option>
                  <option value="CONTRACT">Contract</option>
                  <option value="INTERN">Intern</option>
                </Select>
              </Field>
            </div>
          </section>

          <section className="flex flex-col gap-3">
            <h3 className="text-[14px] font-bold text-ink">Bank</h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {[
                { key: 'bankName', label: 'Bank' },
                { key: 'bankAccount', label: 'Account number' },
              ].map(f => (
                <Field key={f.key} label={f.label}>
                  <Input type="text" value={hrFillData[f.key] || ''} onChange={e => setHrFillData(p => ({ ...p, [f.key]: e.target.value }))} />
                </Field>
              ))}
            </div>
          </section>

          <Field label="Notes" help="Optional notes for HR">
            <Textarea rows={2} value={hrFillData.notes || ''} onChange={e => setHrFillData(p => ({ ...p, notes: e.target.value }))} />
          </Field>

          {hrFillError && <Notice tone="danger">{hrFillError}</Notice>}
        </div>
      </Modal>
    </div>
  );
}

// ─── Presentation helpers ──────────────────────────────────────────────────────

const RESIDENCY_LABEL: Record<string, string> = {
  SC: 'Citizen',
  PR_YEAR1: 'PR · year 1',
  PR_YEAR2: 'PR · year 2',
  PR_YEAR3: 'PR · year 3+',
  PR: 'PR',
  FOREIGNER: 'Foreigner',
};

const PREVIEW_COLS: [string, string][] = [
  ['fullName', 'Full name'], ['email', 'Email'], ['department', 'Department'],
  ['designation', 'Designation'], ['employmentType', 'Type'], ['citizenshipStatus', 'Residency'],
];

function typeLabel(t?: string) {
  if (!t) return '—';
  const s = t.replace(/_/g, ' ').toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Column header that sorts. Says its state to screen readers; the chevron shows it. */
function SortHeader({ label, active, dir, onClick }: { label: string; active: boolean; dir: 'asc' | 'desc'; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Sort by ${label}${active ? (dir === 'asc' ? ', currently A to Z' : ', currently Z to A') : ''}`}
      className={`inline-flex items-center gap-1 rounded hover:text-ink ${active ? 'text-ink' : ''}`}
    >
      {label}
      <Icon name="chevronDown" size={13} strokeWidth={2.25} className={active ? (dir === 'asc' ? 'rotate-180' : '') : 'opacity-40'} />
    </button>
  );
}

function ReviewSection({ title, rows }: { title: string; rows: ([string, string] | [string, string, boolean])[] }) {
  return (
    <section>
      <h3 className="mb-3 border-b border-rule pb-2 text-[14px] font-bold text-ink">{title}</h3>
      <div className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
        {rows.map(([label, val, wide]) => (
          <Detail key={label} label={label} value={val} className={wide ? 'sm:col-span-2' : ''} />
        ))}
      </div>
    </section>
  );
}
