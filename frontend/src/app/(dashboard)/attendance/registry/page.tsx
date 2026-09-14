'use client';

import React, { useState, useEffect, useCallback, useRef, memo } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { Seal } from '@/components/official';
import { addDays, toISODate as isoDate, todayISO, formatCivil } from '@/lib/timezone';
import { getMondayOf } from '@/lib/attendanceUtils';
import { PageHeader, Stat, Card, CardHeader, Tabs, DataTable, Badge, Button, Field, Input, Select, Textarea, SearchInput, EmptyState, Modal, Avatar, Icon, type Column } from '@/components/ui';

const ALLOWED_ROLES = ['SUPER_ADMIN', 'HR_ADMIN', 'HR_MANAGER', 'PAYROLL_OFFICER', 'LINE_MANAGER'];

interface AttRecord {
  id: string; employeeId: string; date: string;
  clockIn: string | null; clockOut: string | null;
  hoursWorked: number | null; otHours: number; status: string;
  clockInLat?: number | null; clockInLng?: number | null;
  withinGeofence?: boolean | null; locationName?: string | null;
}
interface EmployeeInfo { id: string; fullName: string; department: string; designation: string; employeeCode: string; }
interface RosterRow {
  employeeId: string; name: string; dept: string; designation: string;
  clockIn: string | null; clockOut: string | null; hoursWorked: number | null; otHours: number;
  status: string; withinGeofence?: boolean | null; locationName?: string | null;
  clockInLat?: number | null; clockInLng?: number | null; recordId?: string;
}
interface WorkLocation {
  id: string; name: string; postalCode: string; address: string;
  latitude: number; longitude: number; radiusMetres: number; isActive: boolean;
  _count?: { employeeLocations: number };
}
interface EmpAssignment { id: string; employeeId: string; workLocationId: string; isPrimary: boolean; workLocation: WorkLocation; }
interface ShiftTemplate { id: string; name: string; startTime: string; endTime: string; breakMinutes: number; hoursPerDay: number; color: string; isActive: boolean; }
interface UnifiedShift extends ShiftTemplate { _type: 'template' | 'working'; projectName: string | null; projectId: string | null; }
interface RosterEntry { id: string; employeeId: string; date: string; shiftTemplateId: string | null; workingShiftId: string | null; shiftPatternId?: string | null; note: string | null; shiftTemplate: ShiftTemplate | null; workingShift: WorkingShift | null; shiftPattern?: { id: string; name: string; color: string; startTime: string; endTime: string; hoursPerShift: number } | null; }

function fmtTime(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit', hour12: true });
}
function getRowStatus(r: AttRecord): string {
  if (!r.clockIn) return 'Absent';
  const clockIn = new Date(r.clockIn);
  const cutoff = new Date(clockIn); cutoff.setHours(9, 15, 0, 0);
  if (r.clockOut) return 'Clocked Out';
  if (clockIn > cutoff) return 'Late';
  return 'On Time';
}

async function geocodePostal(postal: string): Promise<{ lat: number; lng: number; address: string } | null> {
  try {
    const r = await fetch(`https://www.onemap.gov.sg/api/common/elastic/search?searchVal=${postal}&returnGeom=Y&getAddrDetails=Y&pageNum=1`);
    const d = await r.json();
    if (!d.results?.length) return null;
    const hit = d.results[0];
    return { lat: parseFloat(hit.LATITUDE), lng: parseFloat(hit.LONGITUDE), address: hit.ADDRESS };
  } catch { return null; }
}

// getMondayOf, addDays, isoDate (toISODate) and todayISO come from the shared
// business-timezone helpers so date keys stay consistent and TZ-independent.
function fmtShortDate(d: Date) { return formatCivil(d, { weekday: 'short', day: 'numeric', month: 'short' }); }

/**
 * The shift-colour PICKER — user-chosen, not design tokens.
 *
 * These hexes are persisted on every existing shift, so the list cannot be
 * swapped for tokens without orphaning the colour on rosters already saved.
 * A roster genuinely needs many distinguishable colours, which eight tokens
 * cannot supply. Only the default (first entry) moves off the retired brand
 * indigo onto the accent, so new shifts start on-brand.
 */
const SHIFT_COLORS = [
  '#1B4A3C','#8b5cf6','#ec4899','#f59e0b','#10b981','#3b82f6','#ef4444','#14b8a6','#f97316','#6b7280',
];

// New types for shift management
interface ShiftProject { id: string; name: string; description?: string | null; isActive: boolean; _count?: { workingShifts: number; shiftPatterns: number; members: number }; }
interface WorkingShift { id: string; projectId: string; name: string; workMon: boolean; workTue: boolean; workWed: boolean; workThu: boolean; workFri: boolean; workSat: boolean; workSun: boolean; startTime: string; endTime: string; breakMinutes: number; hoursPerDay: number; color: string; isRecurring: boolean; assignments?: ShiftAssignment[]; }
interface ShiftPattern { id: string; projectId: string; name: string; patternType: string; workDays: number; offDays: number; startTime: string; endTime: string; breakMinutes: number; hoursPerShift: number; color: string; assignments?: ShiftAssignment[]; }
interface ShiftAssignment { id: string; employeeId: string; workingShiftId?: string | null; shiftPatternId?: string | null; startDate: string; }
interface ProjectMember { id: string; projectId: string; employeeId: string; workingShiftId: string | null; shiftPatternId: string | null; startDate: string; workingShift?: { id: string; name: string; color: string; startTime: string; endTime: string; hoursPerDay: number } | null; shiftPattern?: { id: string; name: string; color: string } | null; }

function calcHours(startTime: string, endTime: string, breakMinutes: number): number {
  if (!startTime || !endTime) return 0;
  const [h1, m1] = startTime.split(':').map(Number);
  const [h2, m2] = endTime.split(':').map(Number);
  let mins = (h2 * 60 + m2) - (h1 * 60 + m1);
  if (mins < 0) mins += 24 * 60;
  return Math.max(0, (mins - breakMinutes) / 60);
}

function workDayLabel(s: WorkingShift): string {
  const days = [s.workMon&&'Mon',s.workTue&&'Tue',s.workWed&&'Wed',s.workThu&&'Thu',s.workFri&&'Fri',s.workSat&&'Sat',s.workSun&&'Sun'].filter(Boolean) as string[];
  if (!days.length) return 'No days set';
  if (days.length === 7) return 'Daily (7 days)';
  if (days.length === 5 && !s.workSat && !s.workSun) return 'Mon – Fri';
  return days.join(' · ');
}

// Isolated clock component — only this re-renders every second
function LiveClock() {
  const [t, setT] = useState(new Date());
  useEffect(() => { const id = setInterval(() => setT(new Date()), 1000); return () => clearInterval(id); }, []);
  return <>{t.toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })}</>;
}

// ── Small presentational helpers shared by the tabs ───────────────────────────

/** A shift's user-chosen colour, shown as a dot beside its name. */
function ColorDot({ color, className = '' }: { color: string; className?: string }) {
  return <span className={`inline-block w-2.5 h-2.5 rounded-full shrink-0 ${className}`} style={{ backgroundColor: color }} aria-hidden="true" />;
}

/** Swatch picker for the shift-colour field. */
function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Colour">
      {SHIFT_COLORS.map(c => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          aria-label={c}
          onClick={() => onChange(c)}
          className={`w-7 h-7 rounded-full transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${value === c ? 'ring-2 ring-offset-2 ring-ink scale-110' : 'hover:scale-105'}`}
          style={{ backgroundColor: c }}
        />
      ))}
    </div>
  );
}

/** Small error notice inside a form. */
function FormError({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 px-3.5 py-3 rounded-control bg-danger-bg text-sm text-danger">
      <Icon name="alert" size={16} className="mt-0.5 shrink-0" />{children}
    </div>
  );
}

/** Explanatory callout for the effective-date fields. */
function DateNote({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-muted leading-relaxed">{children}</p>;
}

const Spinner = ({ className = '' }: { className?: string }) => (
  <div className={`flex items-center justify-center py-12 ${className}`}><div className="w-8 h-8 border-4 border-accent border-t-accent animate-spin rounded-full" /></div>
);

export default function AttendanceRegistryPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  if (loading) return <div className="flex items-center justify-center h-64"><div className="w-10 h-10 border-4 border-t-accent border-accent animate-spin rounded-full" /></div>;
  const role = user?.role?.toUpperCase() ?? '';
  if (!ALLOWED_ROLES.includes(role)) { router.replace('/attendance'); return null; }
  return <AdminAttendanceView userRole={role} />;
}

function AdminAttendanceView({ userRole }: { userRole: string }) {
  const [tab, setTab] = useState<'scheduler' | 'shifts' | 'attendance' | 'locations'>('scheduler');
  const [selectedDate, setSelectedDate] = useState(() => todayISO());
  const [roster, setRoster] = useState<RosterRow[]>([]);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [rosterSort, setRosterSort] = useState<{ col: 'name' | 'dept' | 'clockIn' | 'clockOut' | 'hours' | 'status'; dir: 'asc' | 'desc' }>({ col: 'status', dir: 'asc' });
  const [locations, setLocations] = useState<WorkLocation[]>([]);
  const [locLoading, setLocLoading] = useState(false);
  const [locModal, setLocModal] = useState<'add' | 'edit' | null>(null);
  const [editLoc, setEditLoc] = useState<WorkLocation | null>(null);
  const [locForm, setLocForm] = useState({ name: '', postalCode: '', address: '', latitude: '', longitude: '', radiusMetres: '200' });
  const [locPostalSearching, setLocPostalSearching] = useState(false);
  const [locSaving, setLocSaving] = useState(false);
  const [locError, setLocError] = useState('');
  const [assignModal, setAssignModal] = useState<{ empId: string; empName: string } | null>(null);
  const [empAssignments, setEmpAssignments] = useState<EmpAssignment[]>([]);
  const [employees, setEmployees] = useState<EmployeeInfo[]>([]);
  const [assignLocId, setAssignLocId] = useState('');
  const [assignPrimary, setAssignPrimary] = useState(false);
  const [assignSaving, setAssignSaving] = useState(false);

  const loadEmployees = useCallback(async () => {
    try { const d = await apiFetch('/employees?limit=500&isActive=true'); setEmployees(d.employees ?? []); } catch {}
  }, []);

  const loadRoster = useCallback(async (date: string, emps: EmployeeInfo[]) => {
    setRosterLoading(true);
    try {
      const attData = await apiFetch(`/attendance/admin/records?date=${date}`);
      const recs: AttRecord[] = attData.records ?? [];
      const recMap = new Map(recs.map((r: AttRecord) => [r.employeeId, r]));
      const rows: RosterRow[] = emps.map(emp => {
        const rec = recMap.get(emp.id);
        return {
          employeeId: emp.id, name: emp.fullName, dept: emp.department, designation: emp.designation,
          clockIn: rec?.clockIn ?? null, clockOut: rec?.clockOut ?? null,
          hoursWorked: rec?.hoursWorked ?? null, otHours: rec?.otHours ?? 0,
          status: rec ? getRowStatus(rec) : 'Absent',
          withinGeofence: rec?.withinGeofence, locationName: rec?.locationName,
          clockInLat: rec?.clockInLat, clockInLng: rec?.clockInLng, recordId: rec?.id,
        };
      });
      rows.sort((a, b) => ['On Time','Late','Clocked Out','Absent'].indexOf(a.status) - ['On Time','Late','Clocked Out','Absent'].indexOf(b.status));
      setRoster(rows);
    } finally { setRosterLoading(false); }
  }, []);

  const loadLocations = useCallback(async () => {
    setLocLoading(true);
    try { setLocations(await apiFetch('/attendance/locations')); }
    catch {} finally { setLocLoading(false); }
  }, []);

  useEffect(() => { loadEmployees(); }, [loadEmployees]);
  useEffect(() => { if (tab === 'attendance' && employees.length) loadRoster(selectedDate, employees); }, [selectedDate, tab, employees, loadRoster]);
  useEffect(() => { loadLocations(); }, [loadLocations]);

  const STATUS_ORDER = ['On Time', 'Late', 'Clocked Out', 'Absent'];
  const filtered = roster.filter(r => {
    const q = search.toLowerCase();
    return !q || r.name.toLowerCase().includes(q) || r.dept?.toLowerCase().includes(q);
  });
  const sortedRoster = [...filtered].sort((a, b) => {
    const d = rosterSort.dir === 'asc' ? 1 : -1;
    switch (rosterSort.col) {
      case 'name':    return d * a.name.localeCompare(b.name);
      case 'dept':    return d * (a.dept || '').localeCompare(b.dept || '');
      case 'clockIn': return d * ((a.clockIn ? new Date(a.clockIn).getTime() : 0) - (b.clockIn ? new Date(b.clockIn).getTime() : 0));
      case 'clockOut':return d * ((a.clockOut ? new Date(a.clockOut).getTime() : 0) - (b.clockOut ? new Date(b.clockOut).getTime() : 0));
      case 'hours':   return d * ((a.hoursWorked ?? -1) - (b.hoursWorked ?? -1));
      case 'status':  return d * (STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status));
      default: return 0;
    }
  });
  function toggleRosterSort(col: typeof rosterSort.col) {
    setRosterSort(prev => prev.col === col ? { col, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'asc' });
  }
  /** A sortable column header: the label plus a chevron that shows direction. */
  function SortHead({ col, children }: { col: typeof rosterSort.col; children: React.ReactNode }) {
    const on = rosterSort.col === col;
    return (
      <button type="button" onClick={() => toggleRosterSort(col)} className={`inline-flex items-center gap-1 hover:text-ink ${on ? 'text-ink' : ''}`} aria-sort={on ? (rosterSort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
        {children}
        <Icon name="chevronDown" size={13} className={`transition-transform ${on ? (rosterSort.dir === 'asc' ? 'rotate-180' : '') : 'opacity-40'}`} />
      </button>
    );
  }
  const clockedIn  = roster.filter(r => r.clockIn && !r.clockOut).length;
  const late       = roster.filter(r => r.status === 'Late').length;
  const clockedOut = roster.filter(r => r.status === 'Clocked Out').length;
  const absent     = roster.filter(r => r.status === 'Absent').length;
  const outOfBound = roster.filter(r => r.withinGeofence === false).length;
  const handlePostalLookup = async () => {
    if (!locForm.postalCode) return;
    setLocPostalSearching(true);
    const result = await geocodePostal(locForm.postalCode);
    setLocPostalSearching(false);
    if (result) setLocForm(f => ({ ...f, address: result.address, latitude: String(result.lat), longitude: String(result.lng) }));
    else setLocError('Postal code not found. Please enter coordinates manually.');
  };
  const openAddLoc = () => { setEditLoc(null); setLocError(''); setLocForm({ name: '', postalCode: '', address: '', latitude: '', longitude: '', radiusMetres: '200' }); setLocModal('add'); };
  const openEditLoc = (loc: WorkLocation) => { setEditLoc(loc); setLocError(''); setLocForm({ name: loc.name, postalCode: loc.postalCode, address: loc.address, latitude: String(loc.latitude), longitude: String(loc.longitude), radiusMetres: String(loc.radiusMetres) }); setLocModal('edit'); };
  const saveLocation = async () => {
    if (!locForm.name || !locForm.postalCode || !locForm.latitude || !locForm.longitude) { setLocError('Name, postal code, and coordinates are required'); return; }
    setLocSaving(true); setLocError('');
    try {
      const body = { name: locForm.name, postalCode: locForm.postalCode, address: locForm.address, latitude: parseFloat(locForm.latitude), longitude: parseFloat(locForm.longitude), radiusMetres: parseInt(locForm.radiusMetres) || 200 };
      if (locModal === 'add') await apiFetch('/attendance/locations', { method: 'POST', body: JSON.stringify(body) });
      else if (editLoc) await apiFetch(`/attendance/locations/${editLoc.id}`, { method: 'PUT', body: JSON.stringify(body) });
      setLocModal(null); loadLocations();
    } catch (e: unknown) { setLocError(e instanceof Error ? e.message : 'Error'); }
    finally { setLocSaving(false); }
  };
  const deleteLocation = async (id: string) => {
    if (!confirm('Delete this work location? Employee assignments will also be removed.')) return;
    try { await apiFetch(`/attendance/locations/${id}`, { method: 'DELETE' }); loadLocations(); }
    catch (e: unknown) { alert(e instanceof Error ? e.message : 'Error'); }
  };
  const openAssign = async (empId: string, empName: string) => {
    setAssignModal({ empId, empName }); setAssignLocId(''); setAssignPrimary(false);
    try { setEmpAssignments(await apiFetch(`/attendance/locations/employee/${empId}`)); } catch {}
  };
  const saveAssignment = async () => {
    if (!assignModal || !assignLocId) return;
    setAssignSaving(true);
    try {
      await apiFetch('/attendance/locations/employee', { method: 'POST', body: JSON.stringify({ employeeId: assignModal.empId, workLocationId: assignLocId, isPrimary: assignPrimary }) });
      setEmpAssignments(await apiFetch(`/attendance/locations/employee/${assignModal.empId}`));
      setAssignLocId(''); setAssignPrimary(false);
    } catch (e: unknown) { alert(e instanceof Error ? e.message : 'Error'); }
    finally { setAssignSaving(false); }
  };
  const removeAssignment = async (id: string, empId: string) => {
    try { await apiFetch(`/attendance/locations/employee/${id}`, { method: 'DELETE' }); setEmpAssignments(await apiFetch(`/attendance/locations/employee/${empId}`)); }
    catch (e: unknown) { alert(e instanceof Error ? e.message : 'Error'); }
  };

  const isSchedulerOnly = userRole === 'LINE_MANAGER';

  /**
   * Status → tone. Every state keeps its own tone AND its word: on time is the
   * quiet ok, late is a warning, a completed day is neutral, and absent is the
   * only red on the screen.
   */
  const statusTone = (s: string): 'ok' | 'warn' | 'neutral' | 'danger' =>
    s === 'On Time' ? 'ok' : s === 'Late' ? 'warn' : s === 'Clocked Out' ? 'neutral' : 'danger';
  const statusLabel = (s: string) => s === 'On Time' ? 'On time' : s === 'Clocked Out' ? 'Clocked out' : s;

  const rosterColumns: Column<RosterRow>[] = [
    {
      key: 'name', label: <SortHead col="name">Employee</SortHead>, width: 'minmax(0, 1.6fr)',
      render: (row) => (
        <span className="flex items-center gap-3 min-w-0">
          <Avatar name={row.name} tone="soft" />
          <span className="flex flex-col min-w-0">
            <span className="font-semibold truncate">{row.name}</span>
            <span className="text-xs text-muted truncate">{row.designation || '—'}</span>
          </span>
        </span>
      ),
    },
    { key: 'dept', label: <SortHead col="dept">Department</SortHead>, width: 'minmax(0, 1fr)', render: (row) => <span className="text-muted">{row.dept || '—'}</span> },
    { key: 'clockIn', label: <SortHead col="clockIn">Clock in</SortHead>, width: '104px', numeric: true, render: (row) => <span className="font-semibold">{fmtTime(row.clockIn)}</span> },
    { key: 'clockOut', label: <SortHead col="clockOut">Clock out</SortHead>, width: '104px', numeric: true, render: (row) => <span className="text-muted">{fmtTime(row.clockOut)}</span> },
    {
      /* Sealed once in the header, not on every row: the rate governs the
         whole column, and a seal per row would make the citation ordinary
         wallpaper. */
      key: 'hours',
      label: <span className="flex flex-col items-start gap-1"><SortHead col="hours">Hours</SortHead><Seal cite="EA s.38 · OT at 1.5x" /></span>,
      width: '132px', numeric: true,
      render: (row) => (
        <span>
          <span className="font-semibold">{row.hoursWorked != null ? `${row.hoursWorked.toFixed(1)}h` : '—'}</span>
          {row.otHours > 0 && <span className="ml-1.5 text-xs font-semibold text-warn">+{row.otHours.toFixed(1)} OT</span>}
        </span>
      ),
    },
    {
      key: 'location', label: 'Location', width: 'minmax(0, 1fr)',
      render: (row) => (
        <>
          {row.withinGeofence === true && <Badge tone="ok">{row.locationName || 'In zone'}</Badge>}
          {row.withinGeofence === false && <Badge tone="danger">Out of zone</Badge>}
          {row.withinGeofence == null && row.clockIn && <span className="text-xs text-muted">No GPS</span>}
          {!row.clockIn && <span className="text-faint">—</span>}
        </>
      ),
    },
    { key: 'status', label: <SortHead col="status">Status</SortHead>, width: '120px', render: (row) => <Badge tone={statusTone(row.status)}>{statusLabel(row.status)}</Badge> },
    {
      key: 'actions', label: '', width: '110px', align: 'right',
      render: (row) => <Button size="sm" variant="secondary" onClick={() => openAssign(row.employeeId, row.name)}>Locations</Button>,
    },
  ];

  const tabItems = ([
    { id: 'scheduler',  label: 'Daily roster',       hide: false },
    { id: 'shifts',     label: 'Shift management',   hide: false },
    { id: 'attendance', label: 'Attendance records', hide: isSchedulerOnly },
    { id: 'locations',  label: 'Work locations',     hide: isSchedulerOnly },
  ] as const).filter(t => !t.hide).map(({ id, label }) => ({ id, label }));

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Attendance registry"
        subtitle={<span className="tabular-nums"><LiveClock /> · {employees.length} active employee{employees.length === 1 ? '' : 's'}</span>}
        actions={
          <>
            {tab === 'attendance' && <>
              <Input type="date" value={selectedDate} max={todayISO()} onChange={e => setSelectedDate(e.target.value)} aria-label="Date" className="w-44 h-10" />
              <Button variant="secondary" icon="refresh" onClick={() => loadRoster(selectedDate, employees)} disabled={rosterLoading}>Refresh</Button>
            </>}
            {tab === 'locations' && <Button variant="primary" icon="plus" onClick={openAddLoc}>Add location</Button>}
          </>
        }
      />

      <Tabs items={tabItems} active={tab} onChange={setTab} />

      {tab === 'attendance' && <>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Stat label="Clocked in" value={rosterLoading ? '—' : clockedIn} note="Still on the clock" />
          <Stat label="Clocked out" value={rosterLoading ? '—' : clockedOut} note="Day complete" />
          <Stat label="Late" value={rosterLoading ? '—' : late} note="Clocked in after 9:15 AM" />
          <Stat label="Absent" value={rosterLoading ? '—' : absent} note="No clock-in recorded" />
          <Stat label="Out of zone" value={rosterLoading ? '—' : outOfBound} note="Outside the geofence" />
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <p className="text-sm text-muted tabular-nums">{filtered.length} of {roster.length} employee{roster.length === 1 ? '' : 's'}</p>
            <SearchInput placeholder="Filter by name or department" value={search} onChange={e => setSearch(e.target.value)} className="w-full sm:w-72" />
          </div>
          {rosterLoading ? (
            <Card padding="p-0"><Spinner /></Card>
          ) : (
            <DataTable
              aria-label="Attendance records"
              columns={rosterColumns}
              rows={sortedRoster}
              rowKey={(r) => r.employeeId}
              rowHeight={60}
              mobileCard={(row) => (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-3">
                    <Avatar name={row.name} tone="soft" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-ink truncate">{row.name}</p>
                      <p className="text-xs text-muted truncate">{row.dept || '—'}{row.designation ? ` · ${row.designation}` : ''}</p>
                    </div>
                    <Badge tone={statusTone(row.status)}>{statusLabel(row.status)}</Badge>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-sm tabular-nums">
                    <div><p className="text-xs text-muted">Clock in</p><p className="font-semibold text-ink">{fmtTime(row.clockIn)}</p></div>
                    <div><p className="text-xs text-muted">Clock out</p><p className="text-ink">{fmtTime(row.clockOut)}</p></div>
                    <div><p className="text-xs text-muted">Hours</p><p className="font-semibold text-ink">{row.hoursWorked != null ? `${row.hoursWorked.toFixed(1)}h` : '—'}{row.otHours > 0 && <span className="ml-1 text-xs text-warn">+{row.otHours.toFixed(1)} OT</span>}</p></div>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span>
                      {row.withinGeofence === true && <Badge tone="ok">{row.locationName || 'In zone'}</Badge>}
                      {row.withinGeofence === false && <Badge tone="danger">Out of zone</Badge>}
                      {row.withinGeofence == null && row.clockIn && <span className="text-xs text-muted">No GPS</span>}
                    </span>
                    <Button size="sm" variant="secondary" onClick={() => openAssign(row.employeeId, row.name)}>Locations</Button>
                  </div>
                </div>
              )}
              footer={sortedRoster.length > 0 ? <><span>{sortedRoster.length} record{sortedRoster.length === 1 ? '' : 's'}</span><span>{formatCivil(new Date(selectedDate + 'T00:00:00'), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</span></> : undefined}
              empty={
                <EmptyState
                  icon="clock"
                  title={search ? 'No one matches that search' : 'No records for this day'}
                  description={search ? 'Try a different name or department.' : 'Attendance appears here as employees clock in.'}
                />
              }
            />
          )}
        </div>
      </>}

      {tab === 'scheduler' && (
        <ShiftScheduler employees={employees} />
      )}

      {tab === 'shifts' && (
        <ShiftManagement employees={employees} />
      )}

      {tab === 'locations' && (
        <Card padding="p-0" className="overflow-hidden">
          <div className="px-5 pt-5 sm:px-6">
            <CardHeader title="Work locations" caption="Geofence zones — employees must clock in within the configured radius" action={<span className="text-muted font-normal tabular-nums">{locations.length} location{locations.length === 1 ? '' : 's'}</span>} />
          </div>
          {locLoading ? <Spinner />
          : locations.length === 0 ? (
            <EmptyState
              icon="building"
              title="No work locations yet"
              description="Add an office or site and a radius; clock-ins outside it are flagged as out of zone."
              action={<Button variant="primary" icon="plus" onClick={openAddLoc}>Add location</Button>}
            />
          ) : (
            <div className="flex flex-col divide-y divide-rule border-t border-rule">
              {locations.map(loc => (
                <div key={loc.id} className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-5 px-5 sm:px-6 py-4 hover:bg-page transition-colors">
                  <span className={`hidden sm:block w-2.5 h-2.5 rounded-full shrink-0 ${loc.isActive ? 'bg-ok' : 'bg-faint'}`} aria-hidden="true" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-ink">{loc.name}</p>
                      <Badge tone="accent" className="tabular-nums">{loc.radiusMetres} m radius</Badge>
                      <span className="text-xs text-muted tabular-nums">{loc._count?.employeeLocations ?? 0} assigned</span>
                      {!loc.isActive && <Badge tone="neutral">Inactive</Badge>}
                    </div>
                    <p className="text-[13px] text-muted mt-1 truncate">{loc.address || `Postal code ${loc.postalCode}`}</p>
                    <p className="text-xs text-faint font-mono mt-0.5 tabular-nums">{loc.latitude.toFixed(6)}, {loc.longitude.toFixed(6)}</p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Button size="sm" variant="secondary" onClick={() => openEditLoc(loc)}>Edit</Button>
                    <Button size="sm" variant="danger" onClick={() => deleteLocation(loc.id)}>Delete</Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {locModal && (
        <Modal open
          title={locModal === 'add' ? 'Add work location' : 'Edit work location'}
          caption="Employees assigned here must clock in within the radius."
          onClose={() => setLocModal(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setLocModal(null)}>Cancel</Button>
              <Button variant="primary" onClick={saveLocation} disabled={locSaving}>{locSaving ? 'Saving…' : 'Save location'}</Button>
            </>
          }
        >
          <div className="flex flex-col gap-4">
            <Field label="Location name" required>
              <Input value={locForm.name} onChange={e => setLocForm(x => ({ ...x, name: e.target.value }))} placeholder="e.g. Main office" />
            </Field>
            <Field label="Singapore postal code" required help="Detect fills in the address and coordinates from OneMap.">
              <div className="flex gap-2">
                <Input value={locForm.postalCode} onChange={e => setLocForm(f => ({ ...f, postalCode: e.target.value }))} placeholder="e.g. 238859" className="flex-1" />
                <Button variant="secondary" icon="search" onClick={handlePostalLookup} disabled={locPostalSearching || !locForm.postalCode} className="h-[42px]">
                  {locPostalSearching ? 'Looking up…' : 'Detect'}
                </Button>
              </div>
            </Field>
            <Field label="Address">
              <Input value={locForm.address} onChange={e => setLocForm(x => ({ ...x, address: e.target.value }))} placeholder="Filled in from the postal code" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Latitude" required>
                <Input value={locForm.latitude} onChange={e => setLocForm(x => ({ ...x, latitude: e.target.value }))} placeholder="1.3521" className="font-mono" />
              </Field>
              <Field label="Longitude" required>
                <Input value={locForm.longitude} onChange={e => setLocForm(x => ({ ...x, longitude: e.target.value }))} placeholder="103.8198" className="font-mono" />
              </Field>
            </div>
            <Field label="Geofence radius (metres)" help="Between 50 and 5,000 metres.">
              <Input type="number" min="50" max="5000" value={locForm.radiusMetres} onChange={e => setLocForm(f => ({ ...f, radiusMetres: e.target.value }))} />
            </Field>
            {locError && <FormError>{locError}</FormError>}
          </div>
        </Modal>
      )}

      {assignModal && (
        <Modal open title="Work locations" caption={assignModal.empName} onClose={() => setAssignModal(null)}>
          <div className="flex flex-col gap-5">
            {empAssignments.length > 0 ? (
              <div className="flex flex-col gap-2">
                <p className="text-[12.5px] font-semibold text-muted">Assigned locations</p>
                {empAssignments.map(a => (
                  <div key={a.id} className="flex items-center justify-between gap-3 px-3.5 py-3 rounded-control border border-rule bg-page">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-ink">{a.workLocation.name}</span>
                        {a.isPrimary && <Badge tone="accent">Primary</Badge>}
                      </div>
                      <p className="text-xs text-muted mt-0.5 tabular-nums">{a.workLocation.radiusMetres} m radius · {a.workLocation.postalCode}</p>
                    </div>
                    <Button size="sm" variant="danger" onClick={() => removeAssignment(a.id, assignModal.empId)}>Remove</Button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="px-3.5 py-3 rounded-control bg-warn-bg text-sm text-warn">
                No locations assigned — this employee can clock in from anywhere.
              </div>
            )}
            <div className="flex flex-col gap-3 pt-4 border-t border-rule">
              <Field label="Add a location">
                <Select value={assignLocId} onChange={e => setAssignLocId(e.target.value)}>
                  <option value="">Select a work location</option>
                  {locations.filter(l => l.isActive && !empAssignments.find(a => a.workLocationId === l.id)).map(l => (
                    <option key={l.id} value={l.id}>{l.name} ({l.radiusMetres} m)</option>
                  ))}
                </Select>
              </Field>
              <label className="flex items-center gap-2.5 cursor-pointer text-sm text-ink">
                <input type="checkbox" checked={assignPrimary} onChange={e => setAssignPrimary(e.target.checked)} className="w-4 h-4 accent-accent" />
                Set as primary location
              </label>
              <Button variant="primary" onClick={saveAssignment} disabled={assignSaving || !assignLocId} className="w-full">
                {assignSaving ? 'Assigning…' : 'Assign location'}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Shift Scheduler ────────────────────────────────────────────────────────────

type ViewMode = 'weekly' | 'workweek' | 'biweekly' | 'monthly';

function getFirstOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function getViewDays(start: Date, mode: ViewMode): Date[] {
  if (mode === 'monthly') {
    const daysInMonth = new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate();
    return Array.from({ length: daysInMonth }, (_, i) => new Date(start.getFullYear(), start.getMonth(), i + 1));
  }
  const count = mode === 'biweekly' ? 14 : mode === 'workweek' ? 5 : 7;
  return Array.from({ length: count }, (_, i) => addDays(start, i));
}

const VIEW_LABELS: Record<ViewMode, string> = {
  weekly: 'Week', workweek: 'Work week', biweekly: 'Two weeks', monthly: 'Month',
};

const ShiftScheduler = memo(function ShiftScheduler({ employees }: { employees: EmployeeInfo[] }) {
  const [viewMode, setViewMode] = useState<ViewMode>('weekly');
  const [periodStart, setPeriodStart] = useState(() => getMondayOf(new Date()));
  const [shifts, setShifts] = useState<UnifiedShift[]>([]);
  const [rosterMap, setRosterMap] = useState<Map<string, RosterEntry>>(new Map()); // key: empId|date
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [deptFilter, setDeptFilter] = useState('');
  const [empSearch, setEmpSearch] = useState('');
  const [selectedEmps, setSelectedEmps] = useState<Set<string>>(new Set());
  const [bulkShift, setBulkShift] = useState('');
  const [bulkDays, setBulkDays] = useState<Set<number>>(new Set()); // Mon=0 … Sun=6
  const [bulkSaving, setBulkSaving] = useState(false);
  const [copyModal, setCopyModal] = useState(false);
  const [copyToWeek, setCopyToWeek] = useState('');
  const [copySaving, setCopySaving] = useState(false);
  const [shiftModal, setShiftModal] = useState<'add' | 'edit' | null>(null);
  const [editShift, setEditShift] = useState<ShiftTemplate | null>(null);
  const [shiftForm, setShiftForm] = useState({ name: '', startTime: '09:00', endTime: '18:00', breakMinutes: '60', color: SHIFT_COLORS[0] });
  const [shiftSaving, setShiftSaving] = useState(false);
  const [showShiftPanel, setShowShiftPanel] = useState(false);
  const [cellPopover, setCellPopover] = useState<{ empId: string; date: string; x: number; y: number } | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [resettingEmpId, setResettingEmpId] = useState<string | null>(null);
  const [resetConfirm, setResetConfirm] = useState<{ empId: string; empName: string } | null>(null);

  const viewDays = getViewDays(periodStart, viewMode);
  const periodLabel = viewMode === 'monthly'
    ? periodStart.toLocaleDateString('en-SG', { month: 'long', year: 'numeric' })
    : `${fmtShortDate(viewDays[0])} — ${fmtShortDate(viewDays[viewDays.length - 1])}`;

  const navigate = (dir: -1 | 1) => {
    setPeriodStart(prev => {
      if (viewMode === 'monthly') return new Date(prev.getFullYear(), prev.getMonth() + dir, 1);
      const step = viewMode === 'biweekly' ? 14 : 7;
      return addDays(prev, dir * step);
    });
  };

  const goToToday = () => {
    if (viewMode === 'monthly') {
      const n = new Date();
      setPeriodStart(new Date(n.getFullYear(), n.getMonth(), 1));
    } else {
      setPeriodStart(getMondayOf(new Date()));
    }
  };

  const switchMode = (m: ViewMode) => {
    setViewMode(m);
    // keep anchor in same calendar week / month
    if (m === 'monthly') {
      setPeriodStart(prev => getFirstOfMonth(prev));
    } else {
      // if coming from monthly, snap to Monday of the 1st of that month
      setPeriodStart(prev => getMondayOf(prev));
    }
  };

  // weekStart alias for copy-week (always the Monday of the view)
  const weekStart = viewMode === 'monthly' ? getMondayOf(periodStart) : periodStart;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const from = isoDate(viewDays[0]);
      const to   = isoDate(viewDays[viewDays.length - 1]);
      const [shiftData, rosterData] = await Promise.allSettled([
        apiFetch('/attendance/shifts'),
        apiFetch(`/attendance/roster?from=${from}&to=${to}`),
      ]);
      if (shiftData.status === 'fulfilled') setShifts(shiftData.value ?? []);
      if (rosterData.status === 'fulfilled') {
        const map = new Map<string, RosterEntry>();
        const list: RosterEntry[] = rosterData.value?.entries ?? rosterData.value ?? [];
        list.forEach(e => { map.set(`${e.employeeId}|${e.date.slice(0, 10)}`, e); });
        setRosterMap(map);
      }
    } finally { setLoading(false); }
  }, [periodStart, viewMode]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  // Close popover on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) setCellPopover(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const assignShift = async (empId: string, date: string, shift: UnifiedShift) => {
    const key = `${empId}|${date}`;
    setSaving(key);
    const payload = shift._type === 'working'
      ? { employeeId: empId, date, workingShiftId: shift.id, shiftTemplateId: null }
      : { employeeId: empId, date, shiftTemplateId: shift.id, workingShiftId: null };
    try {
      const entry = await apiFetch('/attendance/roster/entry', { method: 'PUT', body: JSON.stringify(payload) });
      setRosterMap(prev => { const m = new Map(prev); m.set(key, entry); return m; });
    } catch (e: unknown) { alert(e instanceof Error ? e.message : 'Error'); }
    finally { setSaving(null); setCellPopover(null); }
  };

  const clearShift = async (empId: string, date: string) => {
    const key = `${empId}|${date}`;
    setSaving(key);
    try {
      await apiFetch('/attendance/roster/entry', { method: 'DELETE', body: JSON.stringify({ employeeId: empId, date }) });
      setRosterMap(prev => { const m = new Map(prev); m.delete(key); return m; });
    } catch (e: unknown) { alert(e instanceof Error ? e.message : 'Error'); }
    finally { setSaving(null); setCellPopover(null); }
  };

  const bulkAssign = async () => {
    if (!selectedEmps.size || !bulkDays.size) return;
    setBulkSaving(true);
    try {
      // bulkDays stores Mon=0…Sun=6; match against all visible dates
      const dates = viewDays
        .filter(d => bulkDays.has((d.getDay() + 6) % 7))
        .map(d => isoDate(d));
      if (!dates.length) return;
      const selShift = shifts.find(s => s.id === bulkShift);
      const shiftPayload = selShift?._type === 'working'
        ? { workingShiftId: bulkShift, shiftTemplateId: null }
        : { shiftTemplateId: bulkShift || null, workingShiftId: null };
      await apiFetch('/attendance/roster/bulk', { method: 'POST', body: JSON.stringify({ employeeIds: Array.from(selectedEmps), ...shiftPayload, dates }) });
      await load();
      setSelectedEmps(new Set()); setBulkDays(new Set()); setBulkShift('');
    } catch (e: unknown) { alert(e instanceof Error ? e.message : 'Error'); }
    finally { setBulkSaving(false); }
  };

  const copyWeek = async () => {
    if (!copyToWeek) return;
    setCopySaving(true);
    try {
      const result = await apiFetch('/attendance/roster/copy-week', { method: 'POST', body: JSON.stringify({ fromWeekStart: isoDate(weekStart), toWeekStart: copyToWeek }) });
      setCopyModal(false); setCopyToWeek('');
      alert(`Copied ${result.count} roster entries to week of ${copyToWeek}.`);
    } catch (e: unknown) { alert(e instanceof Error ? e.message : 'Error'); }
    finally { setCopySaving(false); }
  };

  const saveShift = async () => {
    if (!shiftForm.name || !shiftForm.startTime || !shiftForm.endTime) return;
    setShiftSaving(true);
    try {
      const [h1, m1] = shiftForm.startTime.split(':').map(Number);
      const [h2, m2] = shiftForm.endTime.split(':').map(Number);
      let mins = (h2 * 60 + m2) - (h1 * 60 + m1);
      if (mins < 0) mins += 24 * 60;
      const hoursPerDay = Math.max(0, (mins - Number(shiftForm.breakMinutes)) / 60);
      const body = { name: shiftForm.name, startTime: shiftForm.startTime, endTime: shiftForm.endTime, breakMinutes: Number(shiftForm.breakMinutes), hoursPerDay, color: shiftForm.color };
      if (shiftModal === 'add') await apiFetch('/attendance/shifts', { method: 'POST', body: JSON.stringify(body) });
      else if (editShift) await apiFetch(`/attendance/shifts/${editShift.id}`, { method: 'PUT', body: JSON.stringify(body) });
      setShiftModal(null);
      const refreshed = await apiFetch('/attendance/shifts');
      setShifts(refreshed);
    } catch (e: unknown) { alert(e instanceof Error ? e.message : 'Error'); }
    finally { setShiftSaving(false); }
  };

  const deleteShift = async (id: string) => {
    if (!confirm('Deactivate this shift template?')) return;
    try {
      await apiFetch(`/attendance/shifts/${id}`, { method: 'DELETE' });
      setShifts(prev => prev.filter(s => s.id !== id));
    } catch (e: unknown) { alert(e instanceof Error ? e.message : 'Error'); }
  };

  const resetEmployeeSchedule = async (empId: string) => {
    const from = isoDate(viewDays[0]);
    const to   = isoDate(viewDays[viewDays.length - 1]);
    setResettingEmpId(empId);
    try {
      await apiFetch(`/attendance/roster/employee/${empId}?from=${from}&to=${to}`, { method: 'DELETE' });
      setRosterMap(prev => {
        const m = new Map(prev);
        viewDays.forEach(d => m.delete(`${empId}|${isoDate(d)}`));
        return m;
      });
    } catch (e: unknown) { alert(e instanceof Error ? e.message : 'Error'); }
    finally { setResettingEmpId(null); setResetConfirm(null); }
  };

  const openShiftEdit = (s: ShiftTemplate) => {
    setEditShift(s);
    setShiftForm({ name: s.name, startTime: s.startTime, endTime: s.endTime, breakMinutes: String(s.breakMinutes), color: s.color });
    setShiftModal('edit');
  };

  const depts = Array.from(new Set(employees.map(e => e.department).filter(Boolean))).sort();
  const filteredEmps = employees.filter(e => {
    if (deptFilter && e.department !== deptFilter) return false;
    if (empSearch && !e.fullName.toLowerCase().includes(empSearch.toLowerCase())) return false;
    return true;
  });

  const entryShift = (entry: RosterEntry | undefined) => {
    if (!entry) return null;
    if (entry.shiftTemplate) return entry.shiftTemplate;
    if (entry.workingShift) return entry.workingShift;
    if (entry.shiftPattern) return { ...entry.shiftPattern, hoursPerDay: entry.shiftPattern.hoursPerShift };
    return null;
  };

  const periodHours = (empId: string) => {
    let total = 0;
    viewDays.forEach(d => {
      const s = entryShift(rosterMap.get(`${empId}|${isoDate(d)}`));
      if (s) total += s.hoursPerDay;
    });
    return total;
  };

  const allSelected = filteredEmps.length > 0 && filteredEmps.every(e => selectedEmps.has(e.id));
  const isCompact = viewMode === 'monthly';
  const DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  return (
    <div className="flex flex-col gap-4">
      {/* Scheduler toolbar */}
      <Card padding="px-4 py-3 sm:px-5" className="gap-3">
        <div className="flex flex-wrap items-center gap-3">
          {/* View mode selector */}
          <div className="flex p-1 rounded-full bg-pill" role="radiogroup" aria-label="View">
            {(['weekly','workweek','biweekly','monthly'] as ViewMode[]).map(m => (
              <button key={m} type="button" role="radio" aria-checked={viewMode === m} onClick={() => switchMode(m)}
                className={`h-8 px-3 rounded-full text-[13px] font-semibold whitespace-nowrap transition-colors ${viewMode === m ? 'bg-paper text-ink shadow-card' : 'text-muted hover:text-ink'}`}>
                {VIEW_LABELS[m]}
              </button>
            ))}
          </div>

          {/* Period nav */}
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" aria-label="Previous period" onClick={() => navigate(-1)}><Icon name="chevronRight" size={15} className="rotate-180" /></Button>
            <span className="text-sm font-semibold text-ink tabular-nums min-w-[150px] sm:min-w-[200px] text-center">{periodLabel}</span>
            <Button variant="secondary" size="sm" aria-label="Next period" onClick={() => navigate(1)}><Icon name="chevronRight" size={15} /></Button>
            <Button variant="secondary" size="sm" onClick={goToToday}>Today</Button>
          </div>

          <div className="flex items-center gap-2 ml-auto flex-wrap">
            {viewMode === 'weekly' && (
              <Button variant="secondary" size="sm" onClick={() => setCopyModal(true)}>Copy week</Button>
            )}
            <Button variant={showShiftPanel ? 'ghost' : 'secondary'} size="sm" icon="clock" onClick={() => { setShowShiftPanel(p => !p); }}>Shift templates</Button>
          </div>
        </div>

        {/* Bulk bar — visible only when employees are selected */}
        {selectedEmps.size > 0 && (
          <div className="flex flex-wrap items-center gap-3 px-3.5 py-2.5 rounded-control bg-tint">
            <Badge tone="accent" className="tabular-nums">{selectedEmps.size} selected</Badge>
            <Select value={bulkShift} onChange={e => setBulkShift(e.target.value)} className="!h-8 w-48 text-[13px]" aria-label="Shift to apply">
              <option value="">Clear shift</option>
              {shifts.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
            {/* Weekday toggles — Mon=0 … Sun=6; applies to all matching dates in view */}
            <div className="flex gap-1" role="group" aria-label="Days of the week">
              {['M','T','W','T','F','S','S'].map((lbl, i) => (
                <button key={i} type="button" aria-pressed={bulkDays.has(i)} aria-label={['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'][i]}
                  onClick={() => setBulkDays(prev => { const s = new Set(prev); s.has(i) ? s.delete(i) : s.add(i); return s; })}
                  className={`w-8 h-8 rounded-full text-xs font-bold transition-colors ${bulkDays.has(i) ? 'bg-accent text-on-accent' : 'bg-paper border border-rule text-muted hover:text-ink'}`}>
                  {lbl}
                </button>
              ))}
            </div>
            <Button variant="primary" size="sm" onClick={bulkAssign} disabled={bulkSaving || !bulkDays.size}>
              {bulkSaving ? 'Applying…' : 'Apply'}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setSelectedEmps(new Set())}>Clear selection</Button>
          </div>
        )}
      </Card>

      <div className="flex flex-col xl:flex-row gap-4 items-start">
        {/* Main grid */}
        <Card padding="p-0" className="flex-1 min-w-0 w-full overflow-hidden">
          {/* Filter bar */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 px-4 py-3 sm:px-5 border-b border-rule">
            <SearchInput value={empSearch} onChange={e => setEmpSearch(e.target.value)} placeholder="Search employees" className="w-full sm:w-56" />
            <Select value={deptFilter} onChange={e => setDeptFilter(e.target.value)} className="!h-10 w-full sm:w-52" aria-label="Department">
              <option value="">All departments</option>
              {depts.map(d => <option key={d} value={d}>{d}</option>)}
            </Select>
            <span className="text-[13px] text-muted sm:ml-auto tabular-nums">{filteredEmps.length} employee{filteredEmps.length === 1 ? '' : 's'}</span>
          </div>

          {loading ? (
            <Spinner />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse" style={{ minWidth: viewMode === 'monthly' ? `${44 * viewDays.length + 240}px` : viewMode === 'biweekly' ? `${80 * 14 + 240}px` : '900px' }}>
                <thead>
                  <tr className="bg-pill border-b border-rule">
                    <th className="w-10 px-3 py-3">
                      <input type="checkbox" checked={allSelected} aria-label="Select all" onChange={e => setSelectedEmps(e.target.checked ? new Set(filteredEmps.map(x => x.id)) : new Set())} className="w-4 h-4 accent-accent" />
                    </th>
                    <th className="px-3 py-3 text-left text-xs font-bold text-muted min-w-[200px]">Employee</th>
                    {viewDays.map((d, i) => {
                      const todayStr = todayISO();
                      const isToday = isoDate(d) === todayStr;
                      const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                      const colW = viewMode === 'monthly' ? 'min-w-[44px]' : viewMode === 'biweekly' ? 'min-w-[80px]' : 'min-w-[110px]';
                      return (
                        <th key={i} className={`px-1 py-2.5 text-center text-xs font-bold ${colW} ${isToday ? 'text-accent' : 'text-muted'} ${isWeekend ? 'bg-page' : ''}`}>
                          {viewMode !== 'monthly' && <div>{DAY_NAMES[d.getDay()]}</div>}
                          <div className={`${viewMode === 'monthly' ? 'text-xs' : 'text-[15px]'} font-bold tabular-nums ${viewMode === 'monthly' ? '' : 'mt-0.5'} ${isToday ? 'text-accent' : isWeekend ? 'text-muted' : 'text-ink'}`}>{d.getDate()}</div>
                          {viewMode === 'monthly' && <div className="text-xs font-semibold text-faint">{DAY_NAMES[d.getDay()][0]}</div>}
                          {viewMode !== 'monthly' && <div className="text-xs font-semibold text-faint">{d.toLocaleDateString('en-SG', { month: 'short' })}</div>}
                        </th>
                      );
                    })}
                    <th className="px-3 py-3 text-right text-xs font-bold text-muted whitespace-nowrap">
                      {viewMode === 'monthly' ? 'Hours / month' : viewMode === 'biweekly' ? 'Hours / 2 weeks' : 'Hours / week'}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-rule">
                  {filteredEmps.length === 0 ? (
                    <tr><td colSpan={viewDays.length + 3}>
                      <EmptyState icon="users" title="No employees match" description={empSearch || deptFilter ? 'Try a different name or department.' : 'Active employees appear here once they are added.'} />
                    </td></tr>
                  ) : filteredEmps.map(emp => {
                    const hrs = periodHours(emp.id);
                    return (
                      <tr key={emp.id} className={`transition-colors ${selectedEmps.has(emp.id) ? 'bg-tint/40' : 'hover:bg-page'}`}>
                        <td className="px-3 py-2 text-center">
                          <input type="checkbox" checked={selectedEmps.has(emp.id)} aria-label={`Select ${emp.fullName}`} onChange={e => setSelectedEmps(prev => { const s = new Set(prev); e.target.checked ? s.add(emp.id) : s.delete(emp.id); return s; })} className="w-4 h-4 accent-accent" />
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2.5 group/emprow">
                            <Avatar name={emp.fullName} tone="soft" />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-semibold text-ink truncate">{emp.fullName}</p>
                              <p className="text-xs text-muted truncate">{emp.department}</p>
                            </div>
                            <button
                              type="button"
                              onClick={() => setResetConfirm({ empId: emp.id, empName: emp.fullName })}
                              disabled={resettingEmpId === emp.id}
                              title="Reset schedule for this period"
                              aria-label={`Reset ${emp.fullName}'s schedule for this period`}
                              className="opacity-0 group-hover/emprow:opacity-100 focus-visible:opacity-100 transition-opacity w-7 h-7 flex items-center justify-center rounded-control border border-rule text-muted hover:text-danger hover:border-danger shrink-0 disabled:opacity-30"
                            >
                              {resettingEmpId === emp.id
                                ? <div className="w-3 h-3 border-2 border-t-muted border-rule animate-spin rounded-full" />
                                : <Icon name="refresh" size={13} strokeWidth={2.25} />
                              }
                            </button>
                          </div>
                        </td>
                        {viewDays.map((d, i) => {
                          const dateStr = isoDate(d);
                          const key = `${emp.id}|${dateStr}`;
                          const entry = rosterMap.get(key);
                          const shift = entryShift(entry);
                          const isSaving = saving === key;
                          const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                          const isToday = dateStr === todayISO();
                          return (
                            <td key={i} className={`${isCompact ? 'px-0.5 py-1' : 'px-1.5 py-1.5'} text-center ${isWeekend ? 'bg-page' : ''}`}>
                              <button
                                type="button"
                                onClick={e => {
                                  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                                  setCellPopover({ empId: emp.id, date: dateStr, x: rect.left, y: rect.bottom + 4 });
                                }}
                                disabled={isSaving}
                                title={shift ? `${shift.name} · ${shift.startTime}–${shift.endTime}` : dateStr}
                                aria-label={shift ? `${DAY_NAMES[d.getDay()]} ${d.getDate()}: ${shift.name}` : `${DAY_NAMES[d.getDay()]} ${d.getDate()}: no shift`}
                                className={`w-full rounded-control border transition-colors group relative focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${isCompact ? 'min-h-[32px]' : 'min-h-[52px]'} ${isToday && !shift ? 'border-accent bg-tint/40' : ''}`}
                                style={shift ? { backgroundColor: shift.color + '1F', borderColor: shift.color + '66' } : { backgroundColor: 'transparent', borderColor: isToday ? undefined : 'var(--rule)' }}
                              >
                                {isSaving ? (
                                  <div className="flex items-center justify-center h-full"><div className="w-3 h-3 border-2 border-t-muted border-rule animate-spin rounded-full" /></div>
                                ) : shift ? (
                                  isCompact ? (
                                    <div className="flex items-center justify-center h-full py-1">
                                      <ColorDot color={shift.color} />
                                    </div>
                                  ) : (
                                    <div className="px-1.5 py-1">
                                      <div className="flex items-center justify-center gap-1.5 min-w-0">
                                        <ColorDot color={shift.color} />
                                        <p className="text-xs font-semibold text-ink truncate">{shift.name}</p>
                                      </div>
                                      <p className="text-xs text-muted tabular-nums mt-0.5">{shift.startTime}–{shift.endTime}</p>
                                    </div>
                                  )
                                ) : (
                                  <span className="flex items-center justify-center text-faint group-hover:text-accent transition-colors"><Icon name="plus" size={isCompact ? 12 : 15} /></span>
                                )}
                              </button>
                            </td>
                          );
                        })}
                        <td className="px-3 py-2 text-right">
                          <span className={`text-sm font-semibold tabular-nums ${hrs > 0 ? 'text-ink' : 'text-faint'}`}>
                            {hrs > 0 ? `${hrs.toFixed(0)}h` : '—'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {/* Shift Templates Panel */}
        {showShiftPanel && (
          <Card padding="p-0" className="w-full xl:w-72 shrink-0 overflow-hidden">
            <div className="px-5 pt-5">
              <CardHeader
                title="Shift templates"
                action={<button type="button" onClick={() => { setEditShift(null); setShiftForm({ name: '', startTime: '09:00', endTime: '18:00', breakMinutes: '60', color: SHIFT_COLORS[0] }); setShiftModal('add'); }} className="inline-flex items-center gap-1 hover:underline"><Icon name="plus" size={14} />New</button>}
              />
            </div>
            {shifts.length === 0 ? (
              <EmptyState icon="clock" title="No shift templates yet" description="Create one to start assigning shifts on the roster." className="py-8" />
            ) : (
              <div className="flex flex-col divide-y divide-rule border-t border-rule">
                {shifts.map(s => (
                  <div key={s.id} className="px-5 py-3.5 flex items-start gap-3 hover:bg-page transition-colors">
                    <ColorDot color={s.color} className="mt-1.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-ink truncate">{s.name}</p>
                      <p className="text-xs text-muted tabular-nums mt-0.5">{s.startTime} – {s.endTime} · {s.hoursPerDay.toFixed(1)}h · {s.breakMinutes} min break</p>
                      {s._type === 'working' && s.projectName && <p className="text-xs text-faint truncate">{s.projectName}</p>}
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <Button size="sm" variant="secondary" onClick={() => openShiftEdit(s)}>Edit</Button>
                      <button type="button" onClick={() => deleteShift(s.id)} aria-label={`Deactivate ${s.name}`} className="flex items-center justify-center w-8 h-8 rounded-control text-muted hover:text-danger hover:bg-pill"><Icon name="x" size={15} /></button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        )}
      </div>

      {/* Cell Popover */}
      {cellPopover && (
        <div ref={popoverRef} role="menu" className="fixed z-50 w-60 p-2 bg-paper border border-rule rounded-card shadow-card" style={{ top: Math.min(cellPopover.y, window.innerHeight - 280), left: Math.min(cellPopover.x, window.innerWidth - 256) }}>
          <p className="px-2.5 pt-1.5 pb-2 text-[12.5px] font-semibold text-muted">Assign a shift · {formatCivil(new Date(cellPopover.date + 'T00:00:00'), { day: 'numeric', month: 'short' })}</p>
          <div className="flex flex-col gap-0.5 max-h-64 overflow-y-auto">
            {shifts.filter(s => s._type === 'template').length > 0 && (
              <p className="text-xs font-semibold text-faint px-2.5 pt-1 pb-0.5">Templates</p>
            )}
            {shifts.filter(s => s._type === 'template').map(s => (
              <button key={s.id} type="button" role="menuitem" onClick={() => assignShift(cellPopover.empId, cellPopover.date, s)}
                className="flex items-center gap-2.5 px-2.5 py-2 rounded-control hover:bg-page transition-colors text-left w-full">
                <ColorDot color={s.color} />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-ink truncate">{s.name}</span>
                  <span className="block text-xs text-muted tabular-nums">{s.startTime} – {s.endTime}</span>
                </span>
              </button>
            ))}
            {shifts.filter(s => s._type === 'working').length > 0 && (
              <p className="text-xs font-semibold text-faint px-2.5 pt-2 pb-0.5">Working shifts</p>
            )}
            {shifts.filter(s => s._type === 'working').map(s => (
              <button key={s.id} type="button" role="menuitem" onClick={() => assignShift(cellPopover.empId, cellPopover.date, s)}
                className="flex items-center gap-2.5 px-2.5 py-2 rounded-control hover:bg-page transition-colors text-left w-full">
                <ColorDot color={s.color} />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-ink truncate">{s.name}</span>
                  <span className="block text-xs text-muted tabular-nums truncate">{s.startTime} – {s.endTime} · {s.projectName}</span>
                </span>
              </button>
            ))}
            {shifts.length === 0 && <p className="text-sm text-muted px-2.5 py-2">No shifts yet.</p>}
            <div className="border-t border-rule mt-1 pt-1">
              <button type="button" role="menuitem" onClick={() => clearShift(cellPopover.empId, cellPopover.date)}
                className="flex items-center gap-2 w-full px-2.5 py-2 rounded-control hover:bg-page text-left text-sm font-semibold text-danger transition-colors">
                <Icon name="x" size={14} />Clear shift
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Copy Week Modal */}
      {copyModal && (
        <Modal open
          title="Copy roster week"
          caption={`Copies every shift from ${periodLabel} to another week.`}
          onClose={() => setCopyModal(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setCopyModal(false)}>Cancel</Button>
              <Button variant="primary" onClick={copyWeek} disabled={copySaving || !copyToWeek}>{copySaving ? 'Copying…' : 'Copy week'}</Button>
            </>
          }
        >
          <Field label="Target week" help={copyToWeek ? `Will copy to the week of ${copyToWeek}.` : 'Pick any day in the target week; it snaps to that Monday.'}>
            <Input type="date" value={copyToWeek} onChange={e => setCopyToWeek(isoDate(getMondayOf(new Date(e.target.value))))} />
          </Field>
        </Modal>
      )}

      {/* Reset Schedule Confirmation Modal */}
      {resetConfirm && (
        <Modal open
          title="Reset schedule"
          caption={resetConfirm.empName}
          onClose={() => setResetConfirm(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setResetConfirm(null)}>Cancel</Button>
              <Button variant="danger" icon="refresh" onClick={() => resetEmployeeSchedule(resetConfirm.empId)} disabled={resettingEmpId === resetConfirm.empId}>
                {resettingEmpId === resetConfirm.empId ? 'Resetting…' : 'Reset schedule'}
              </Button>
            </>
          }
        >
          <p className="text-sm text-muted leading-relaxed">
            This clears all {viewDays.length} shift assignments for <span className="font-semibold text-ink">{periodLabel}</span>. The employee will show as unscheduled for this period.
          </p>
        </Modal>
      )}

      {/* Shift Template Modal */}
      {shiftModal && (
        <Modal open
          title={shiftModal === 'add' ? 'New shift template' : 'Edit shift'}
          onClose={() => setShiftModal(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setShiftModal(null)}>Cancel</Button>
              <Button variant="primary" onClick={saveShift} disabled={shiftSaving || !shiftForm.name}>{shiftSaving ? 'Saving…' : 'Save shift'}</Button>
            </>
          }
        >
          <div className="flex flex-col gap-4">
            <Field label="Shift name" required>
              <Input value={shiftForm.name} onChange={e => setShiftForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Morning, Afternoon, Night" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Start time">
                <Input type="time" value={shiftForm.startTime} onChange={e => setShiftForm(f => ({ ...f, startTime: e.target.value }))} />
              </Field>
              <Field label="End time">
                <Input type="time" value={shiftForm.endTime} onChange={e => setShiftForm(f => ({ ...f, endTime: e.target.value }))} />
              </Field>
            </div>
            <Field label="Break (minutes)">
              <Input type="number" min="0" max="120" value={shiftForm.breakMinutes} onChange={e => setShiftForm(f => ({ ...f, breakMinutes: e.target.value }))} />
            </Field>
            <div className="flex flex-col gap-1.5">
              <span className="text-[12.5px] font-semibold text-muted">Colour</span>
              <ColorPicker value={shiftForm.color} onChange={c => setShiftForm(f => ({ ...f, color: c }))} />
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
});

// ── Shift Management ───────────────────────────────────────────────────────────

const PATTERN_PRESETS: Record<string, { startTime: string; endTime: string; breakMinutes: string }> = {
  '12H':    { startTime: '06:00', endTime: '18:00', breakMinutes: '60' },
  '8H':     { startTime: '09:00', endTime: '18:00', breakMinutes: '60' },
  '6H':     { startTime: '08:00', endTime: '14:00', breakMinutes: '0'  },
  'CUSTOM': { startTime: '',      endTime: '',       breakMinutes: '60' },
};

const DAY_KEYS = ['workMon','workTue','workWed','workThu','workFri','workSat','workSun'] as const;
const DAY_LABELS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

type WShiftForm = {
  name: string; workMon: boolean; workTue: boolean; workWed: boolean; workThu: boolean;
  workFri: boolean; workSat: boolean; workSun: boolean;
  startTime: string; endTime: string; breakMinutes: string; color: string; isRecurring: boolean;
  scheduleStartDate: string;
};
const defaultWShift: WShiftForm = {
  name: '', workMon: true, workTue: true, workWed: true, workThu: true, workFri: true, workSat: false, workSun: false,
  startTime: '09:00', endTime: '18:00', breakMinutes: '60', color: SHIFT_COLORS[0], isRecurring: true,
  scheduleStartDate: todayISO(),
};

type PatternForm = { name: string; patternType: string; workDays: string; offDays: string; startTime: string; endTime: string; breakMinutes: string; color: string; scheduleStartDate: string; };
const defaultPattern: PatternForm = { name: '', patternType: 'CUSTOM', workDays: '5', offDays: '2', startTime: '09:00', endTime: '18:00', breakMinutes: '60', color: SHIFT_COLORS[0], scheduleStartDate: todayISO() };

/** Row of the project list / project detail with the "section" heading and its action. */
function SectionHead({ title, caption, action }: { title: string; caption?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-[17px] font-bold text-ink">{title}</h2>
        {caption && <p className="text-[13px] text-muted mt-0.5">{caption}</p>}
      </div>
      {action && <div className="flex items-center gap-2 shrink-0">{action}</div>}
    </div>
  );
}

/** Pill-shaped toggle used for weekday pickers and duration presets. */
function Chip({ on, onClick, children, ariaLabel }: { on: boolean; onClick: () => void; children: React.ReactNode; ariaLabel?: string }) {
  return (
    <button type="button" aria-pressed={on} aria-label={ariaLabel} onClick={onClick}
      className={`h-8 px-3 rounded-full text-[13px] font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${on ? 'bg-accent text-on-accent' : 'bg-pill text-muted hover:text-ink'}`}>
      {children}
    </button>
  );
}

function ShiftManagement({ employees }: { employees: EmployeeInfo[] }) {
  const [projects, setProjects] = useState<ShiftProject[]>([]);
  const [projLoading, setProjLoading] = useState(true);
  const [selProject, setSelProject] = useState<ShiftProject | null>(null);
  const [subTab, setSubTab] = useState<'working' | 'patterns' | 'members'>('working');

  const [projModal, setProjModal] = useState<'add' | 'edit' | null>(null);
  const [projForm, setProjForm] = useState({ name: '', description: '' });
  const [projSaving, setProjSaving] = useState(false);

  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [memberModal, setMemberModal] = useState(false);
  const [memberForm, setMemberForm] = useState({ employeeId: '', shiftId: '', shiftType: '' as 'working' | 'pattern' | '', startDate: todayISO(), autoPopulate: true });
  const [memberSaving, setMemberSaving] = useState(false);

  const [workingShifts, setWorkingShifts] = useState<WorkingShift[]>([]);
  const [wsLoading, setWsLoading] = useState(false);
  const [wsModal, setWsModal] = useState<'add' | 'edit' | null>(null);
  const [editWs, setEditWs] = useState<WorkingShift | null>(null);
  const [wsForm, setWsForm] = useState<WShiftForm>(defaultWShift);
  const [wsSaving, setWsSaving] = useState(false);

  const [patterns, setPatterns] = useState<ShiftPattern[]>([]);
  const [patLoading, setPatLoading] = useState(false);
  const [patModal, setPatModal] = useState<'add' | 'edit' | null>(null);
  const [editPat, setEditPat] = useState<ShiftPattern | null>(null);
  const [patForm, setPatForm] = useState<PatternForm>(defaultPattern);
  const [patSaving, setPatSaving] = useState(false);

  const [assignTarget, setAssignTarget] = useState<{ type: 'working' | 'pattern'; id: string; name: string } | null>(null);
  const [existingAssignments, setExistingAssignments] = useState<ShiftAssignment[]>([]);
  const [assignSearch, setAssignSearch] = useState('');
  const [assignSelected, setAssignSelected] = useState<Set<string>>(new Set());
  const [assignDate, setAssignDate] = useState(() => todayISO());
  const [assignSaving, setAssignSaving] = useState(false);

  const loadProjects = useCallback(async () => {
    setProjLoading(true);
    try { setProjects(await apiFetch('/attendance/shifts/projects')); } catch {} finally { setProjLoading(false); }
  }, []);

  const loadWorkingShifts = useCallback(async (id: string) => {
    setWsLoading(true);
    try { setWorkingShifts(await apiFetch(`/attendance/shifts/projects/${id}/working`)); } catch {} finally { setWsLoading(false); }
  }, []);

  const loadPatterns = useCallback(async (id: string) => {
    setPatLoading(true);
    try { setPatterns(await apiFetch(`/attendance/shifts/projects/${id}/patterns`)); } catch {} finally { setPatLoading(false); }
  }, []);

  const loadMembers = useCallback(async (id: string) => {
    setMembersLoading(true);
    try { setMembers(await apiFetch(`/attendance/shifts/projects/${id}/members`)); } catch {} finally { setMembersLoading(false); }
  }, []);

  useEffect(() => { loadProjects(); }, [loadProjects]);
  useEffect(() => {
    if (!selProject) return;
    if (subTab === 'working') loadWorkingShifts(selProject.id);
    else if (subTab === 'patterns') loadPatterns(selProject.id);
    else {
      loadMembers(selProject.id);
      // Also load both shift types so the Add Member dropdown is populated
      loadWorkingShifts(selProject.id);
      loadPatterns(selProject.id);
    }
  }, [selProject, subTab, loadWorkingShifts, loadPatterns, loadMembers]);

  // Project CRUD
  const openAddProject = () => { setProjForm({ name: '', description: '' }); setProjModal('add'); };
  const openEditProject = (p: ShiftProject) => { setProjForm({ name: p.name, description: p.description || '' }); setProjModal('edit'); };
  const saveProject = async () => {
    if (!projForm.name) return;
    setProjSaving(true);
    try {
      if (projModal === 'add') await apiFetch('/attendance/shifts/projects', { method: 'POST', body: JSON.stringify(projForm) });
      else if (selProject) await apiFetch(`/attendance/shifts/projects/${selProject.id}`, { method: 'PUT', body: JSON.stringify(projForm) });
      setProjModal(null); loadProjects();
    } catch (e: unknown) { alert(e instanceof Error ? e.message : 'Error'); }
    finally { setProjSaving(false); }
  };
  const deleteProject = async (id: string) => {
    if (!confirm('Archive this project?')) return;
    try { await apiFetch(`/attendance/shifts/projects/${id}`, { method: 'DELETE' }); setSelProject(null); loadProjects(); }
    catch (e: unknown) { alert(e instanceof Error ? e.message : 'Error'); }
  };

  // Working shift CRUD
  const openAddWs = () => { setEditWs(null); setWsForm(defaultWShift); setWsModal('add'); };
  const openEditWs = (s: WorkingShift) => {
    setEditWs(s);
    setWsForm({ name: s.name, workMon: s.workMon, workTue: s.workTue, workWed: s.workWed, workThu: s.workThu, workFri: s.workFri, workSat: s.workSat, workSun: s.workSun, startTime: s.startTime, endTime: s.endTime, breakMinutes: String(s.breakMinutes), color: s.color, isRecurring: s.isRecurring, scheduleStartDate: '' });
    setWsModal('edit');
  };
  const saveWs = async () => {
    if (!wsForm.name || !selProject) return;
    setWsSaving(true);
    try {
      const hrs = calcHours(wsForm.startTime, wsForm.endTime, Number(wsForm.breakMinutes));
      const { scheduleStartDate, ...rest } = wsForm;
      const body = { ...rest, breakMinutes: Number(wsForm.breakMinutes), hoursPerDay: hrs };
      if (wsModal === 'add') {
        const newShift = await apiFetch(`/attendance/shifts/projects/${selProject.id}/working`, { method: 'POST', body: JSON.stringify(body) });
        setWsModal(null);
        loadWorkingShifts(selProject.id);
        openAssign('working', newShift.id, newShift.name, scheduleStartDate || undefined);
      } else if (editWs) {
        await apiFetch(`/attendance/shifts/working/${editWs.id}`, { method: 'PUT', body: JSON.stringify(body) });
        setWsModal(null); loadWorkingShifts(selProject.id);
      }
    } catch (e: unknown) { alert(e instanceof Error ? e.message : 'Error'); }
    finally { setWsSaving(false); }
  };
  const deleteWs = async (id: string) => {
    if (!selProject || !confirm('Remove this shift?')) return;
    try { await apiFetch(`/attendance/shifts/working/${id}`, { method: 'DELETE' }); loadWorkingShifts(selProject.id); }
    catch (e: unknown) { alert(e instanceof Error ? e.message : 'Error'); }
  };

  // Pattern CRUD
  const openAddPat = () => { setEditPat(null); setPatForm(defaultPattern); setPatModal('add'); };
  const openEditPat = (p: ShiftPattern) => {
    setEditPat(p);
    setPatForm({ name: p.name, patternType: p.patternType, workDays: String(p.workDays), offDays: String(p.offDays), startTime: p.startTime, endTime: p.endTime, breakMinutes: String(p.breakMinutes), color: p.color, scheduleStartDate: '' });
    setPatModal('edit');
  };
  const savePat = async () => {
    if (!patForm.name || !selProject) return;
    setPatSaving(true);
    try {
      const hrs = calcHours(patForm.startTime, patForm.endTime, Number(patForm.breakMinutes));
      const { scheduleStartDate, ...rest } = patForm;
      const body = { ...rest, workDays: Number(patForm.workDays), offDays: Number(patForm.offDays), breakMinutes: Number(patForm.breakMinutes), hoursPerShift: hrs };
      if (patModal === 'add') {
        const newPat = await apiFetch(`/attendance/shifts/projects/${selProject.id}/patterns`, { method: 'POST', body: JSON.stringify(body) });
        setPatModal(null);
        loadPatterns(selProject.id);
        openAssign('pattern', newPat.id, newPat.name, scheduleStartDate || undefined);
      } else if (editPat) {
        await apiFetch(`/attendance/shifts/patterns/${editPat.id}`, { method: 'PUT', body: JSON.stringify(body) });
        setPatModal(null); loadPatterns(selProject.id);
      }
    } catch (e: unknown) { alert(e instanceof Error ? e.message : 'Error'); }
    finally { setPatSaving(false); }
  };
  const deletePat = async (id: string) => {
    if (!selProject || !confirm('Remove this pattern?')) return;
    try { await apiFetch(`/attendance/shifts/patterns/${id}`, { method: 'DELETE' }); loadPatterns(selProject.id); }
    catch (e: unknown) { alert(e instanceof Error ? e.message : 'Error'); }
  };

  const addMember = async () => {
    if (!memberForm.employeeId || !selProject) return;
    setMemberSaving(true);
    try {
      const isWorking = memberForm.shiftType === 'working';
      const isPattern = memberForm.shiftType === 'pattern';
      await apiFetch(`/attendance/shifts/projects/${selProject.id}/members`, {
        method: 'POST',
        body: JSON.stringify({
          employeeId: memberForm.employeeId,
          workingShiftId: isWorking ? memberForm.shiftId : null,
          shiftPatternId: isPattern ? memberForm.shiftId : null,
          startDate: memberForm.startDate,
          autoPopulate: memberForm.autoPopulate && isWorking,
        }),
      });
      setMemberModal(false);
      setMemberForm({ employeeId: '', shiftId: '', shiftType: '', startDate: todayISO(), autoPopulate: true });
      loadMembers(selProject.id);
    } catch (e: unknown) { alert(e instanceof Error ? e.message : 'Error'); }
    finally { setMemberSaving(false); }
  };

  const removeMember = async (memberId: string) => {
    if (!selProject || !confirm('Remove this member from the project?')) return;
    try { await apiFetch(`/attendance/shifts/projects/${selProject.id}/members/${memberId}`, { method: 'DELETE' }); loadMembers(selProject.id); }
    catch (e: unknown) { alert(e instanceof Error ? e.message : 'Error'); }
  };

  // Assignments
  const openAssign = async (type: 'working' | 'pattern', id: string, name: string, defaultDate?: string) => {
    setAssignTarget({ type, id, name });
    setAssignSearch(''); setAssignSelected(new Set()); setAssignDate(defaultDate ?? todayISO());
    try {
      const data = await apiFetch(`/attendance/shifts/${type === 'working' ? 'working' : 'patterns'}/${id}/assignments`);
      setExistingAssignments(data);
    } catch { setExistingAssignments([]); }
  };
  const removeAssignment = async (id: string) => {
    try {
      await apiFetch(`/attendance/shifts/assignments/${id}`, { method: 'DELETE' });
      setExistingAssignments(prev => prev.filter(a => a.id !== id));
    } catch (e: unknown) { alert(e instanceof Error ? e.message : 'Error'); }
  };
  const saveAssignments = async () => {
    if (!assignTarget || !assignSelected.size) return;
    setAssignSaving(true);
    try {
      const url = assignTarget.type === 'working' ? `/attendance/shifts/working/${assignTarget.id}/assign` : `/attendance/shifts/patterns/${assignTarget.id}/assign`;
      await apiFetch(url, { method: 'POST', body: JSON.stringify({ employeeIds: Array.from(assignSelected), startDate: assignDate }) });
      const data = await apiFetch(`/attendance/shifts/${assignTarget.type === 'working' ? 'working' : 'patterns'}/${assignTarget.id}/assignments`);
      setExistingAssignments(data);
      setAssignSelected(new Set());
    } catch (e: unknown) { alert(e instanceof Error ? e.message : 'Error'); }
    finally { setAssignSaving(false); }
  };

  const assignedEmpIds = new Set(existingAssignments.map(a => a.employeeId));
  const availableEmps = employees.filter(e => !assignedEmpIds.has(e.id) && (!assignSearch || e.fullName.toLowerCase().includes(assignSearch.toLowerCase())));

  /** The project create/edit form — rendered from both the list and the detail view. */
  const projectModal = projModal && (
    <Modal open
      title={projModal === 'add' ? 'New project' : 'Edit project'}
      caption="A project groups the working shifts, rotation patterns and members of one operation."
      onClose={() => setProjModal(null)}
      footer={
        <>
          <Button variant="secondary" onClick={() => setProjModal(null)}>Cancel</Button>
          <Button variant="primary" onClick={saveProject} disabled={projSaving || !projForm.name}>{projSaving ? 'Saving…' : 'Save project'}</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Project name" required>
          <Input value={projForm.name} onChange={e => setProjForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Night operations" />
        </Field>
        <Field label="Description">
          <Textarea value={projForm.description} onChange={e => setProjForm(f => ({ ...f, description: e.target.value }))} rows={3} placeholder="Optional" />
        </Field>
      </div>
    </Modal>
  );

  if (!selProject) {
    return (
      <div className="flex flex-col gap-4">
        <SectionHead
          title="Shift management"
          caption="Organise working shifts and rotation patterns by project"
          action={<Button variant="primary" icon="plus" onClick={openAddProject}>New project</Button>}
        />
        {projLoading ? (
          <Card padding="p-0"><Spinner /></Card>
        ) : projects.length === 0 ? (
          <Card padding="p-0">
            <EmptyState
              icon="briefcase"
              title="No projects yet"
              description="Create a project to start defining shifts and rotation patterns."
              action={<Button variant="primary" icon="plus" onClick={openAddProject}>New project</Button>}
            />
          </Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {projects.map(p => (
              <button key={p.id} type="button" onClick={() => { setSelProject(p); setSubTab('working'); }}
                className="text-left flex flex-col bg-paper border border-rule rounded-card shadow-card p-5 hover:border-accent transition-colors group focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
                <div className="flex items-start justify-between mb-3">
                  <span className="flex items-center justify-center w-10 h-10 rounded-control bg-tint text-accent font-bold text-[15px]">{p.name[0].toUpperCase()}</span>
                  <Badge tone={p.isActive ? 'ok' : 'neutral'}>{p.isActive ? 'Active' : 'Archived'}</Badge>
                </div>
                <p className="text-[15.5px] font-bold text-ink group-hover:text-accent transition-colors">{p.name}</p>
                {p.description && <p className="text-[13px] text-muted mt-1 line-clamp-2">{p.description}</p>}
                <div className="flex gap-5 mt-4 pt-4 border-t border-rule">
                  <div><p className="text-[22px] font-extrabold tracking-[-0.02em] leading-none text-ink tabular-nums">{p._count?.workingShifts ?? 0}</p><p className="text-xs text-muted mt-1">Working shifts</p></div>
                  <div><p className="text-[22px] font-extrabold tracking-[-0.02em] leading-none text-ink tabular-nums">{p._count?.shiftPatterns ?? 0}</p><p className="text-xs text-muted mt-1">Patterns</p></div>
                  <div><p className="text-[22px] font-extrabold tracking-[-0.02em] leading-none text-ink tabular-nums">{p._count?.members ?? 0}</p><p className="text-xs text-muted mt-1">Members</p></div>
                </div>
              </button>
            ))}
          </div>
        )}
        {projectModal}
      </div>
    );
  }

  // Project detail view
  return (
    <div className="flex flex-col gap-4">
      {/* Breadcrumb header */}
      <Card padding="px-5 py-4" className="flex-row items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <Button variant="ghost" size="sm" onClick={() => setSelProject(null)}><Icon name="chevronRight" size={15} className="rotate-180" />Projects</Button>
          <span className="text-faint">/</span>
          <h2 className="text-[15.5px] font-bold text-ink truncate">{selProject.name}</h2>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={() => openEditProject(selProject)}>Edit</Button>
          <Button size="sm" variant="danger" onClick={() => deleteProject(selProject.id)}>Archive</Button>
        </div>
      </Card>

      {/* Sub-tabs */}
      <Tabs
        items={[{ id: 'working', label: 'Working shifts' }, { id: 'patterns', label: 'Shift patterns' }, { id: 'members', label: 'Members' }]}
        active={subTab}
        onChange={setSubTab}
      />

      {/* Working Shifts */}
      {subTab === 'working' && (
        <div className="flex flex-col gap-3">
          <SectionHead title="Working shifts" caption="Specific working days and hours for this project" action={<Button variant="primary" size="sm" icon="plus" onClick={openAddWs}>New working shift</Button>} />
          {wsLoading ? <Card padding="p-0"><Spinner /></Card>
          : workingShifts.length === 0 ? (
            <Card padding="p-0"><EmptyState icon="clock" title="No working shifts yet" description="Define the days and hours, then assign employees to it." action={<Button variant="primary" size="sm" icon="plus" onClick={openAddWs}>New working shift</Button>} /></Card>
          ) : (
            <div className="flex flex-col gap-3">
              {workingShifts.map(ws => {
                const hrs = calcHours(ws.startTime, ws.endTime, ws.breakMinutes);
                const assigned = ws.assignments?.length ?? 0;
                return (
                  <Card key={ws.id} padding="px-5 py-4">
                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                      <div className="flex items-start gap-3 min-w-0">
                        <ColorDot color={ws.color} className="mt-1.5" />
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-ink">{ws.name}</p>
                          <p className="text-[13px] text-muted mt-0.5">{workDayLabel(ws)}</p>
                          <p className="text-[13px] text-muted mt-0.5 tabular-nums">{ws.startTime} – {ws.endTime} · <span className="font-semibold text-ink">{hrs.toFixed(1)}h/day</span> · {ws.breakMinutes} min break · {ws.isRecurring ? 'Recurring' : 'One-time'}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 flex-wrap">
                        <span className="text-xs text-muted tabular-nums mr-1">{assigned} assigned</span>
                        <Button size="sm" variant="secondary" icon="users" onClick={() => openAssign('working', ws.id, ws.name)}>Assign</Button>
                        <Button size="sm" variant="secondary" onClick={() => openEditWs(ws)}>Edit</Button>
                        <Button size="sm" variant="danger" onClick={() => deleteWs(ws.id)}>Delete</Button>
                      </div>
                    </div>
                    <div className="flex gap-1.5 mt-3 flex-wrap">
                      {DAY_KEYS.map((k, i) => (
                        <Badge key={k} tone={ws[k] ? 'accent' : 'neutral'}>{DAY_LABELS[i]}</Badge>
                      ))}
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Shift Patterns */}
      {subTab === 'patterns' && (
        <div className="flex flex-col gap-3">
          <SectionHead title="Shift patterns" caption="Cyclical rotations — a run of work days followed by a run of off days" action={<Button variant="primary" size="sm" icon="plus" onClick={openAddPat}>New pattern</Button>} />
          {patLoading ? <Card padding="p-0"><Spinner /></Card>
          : patterns.length === 0 ? (
            <Card padding="p-0"><EmptyState icon="refresh" title="No patterns yet" description="Set up a rotation such as 4 on / 2 off and assign employees to it." action={<Button variant="primary" size="sm" icon="plus" onClick={openAddPat}>New pattern</Button>} /></Card>
          ) : (
            <div className="flex flex-col gap-3">
              {patterns.map(pat => {
                const cycle = pat.workDays + pat.offDays;
                const assigned = pat.assignments?.length ?? 0;
                return (
                  <Card key={pat.id} padding="px-5 py-4" className="sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0">
                      <ColorDot color={pat.color} className="mt-1.5" />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-ink">{pat.name}</p>
                        <p className="text-[13px] text-muted mt-0.5 tabular-nums">
                          {pat.patternType === 'CUSTOM' ? 'Custom' : `${pat.patternType} shift`} · {pat.workDays} on / {pat.offDays} off · {cycle}-day cycle
                        </p>
                        <p className="text-[13px] text-muted mt-0.5 tabular-nums">{pat.startTime} – {pat.endTime} · <span className="font-semibold text-ink">{pat.hoursPerShift.toFixed(1)}h/shift</span> · {pat.breakMinutes} min break</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 flex-wrap">
                      <span className="text-xs text-muted tabular-nums mr-1">{assigned} assigned</span>
                      <Button size="sm" variant="secondary" icon="users" onClick={() => openAssign('pattern', pat.id, pat.name)}>Assign</Button>
                      <Button size="sm" variant="secondary" onClick={() => openEditPat(pat)}>Edit</Button>
                      <Button size="sm" variant="danger" onClick={() => deletePat(pat.id)}>Delete</Button>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Members Tab */}
      {subTab === 'members' && (
        <div className="flex flex-col gap-3">
          <SectionHead title="Members" caption="Employees assigned to this project" action={
            <Button variant="primary" size="sm" icon="plus" onClick={() => { setMemberForm({ employeeId: '', shiftId: '', shiftType: '', startDate: todayISO(), autoPopulate: true }); setMemberModal(true); }}>Add member</Button>
          } />
          {membersLoading ? <Card padding="p-0"><Spinner /></Card>
          : members.length === 0 ? (
            <Card padding="p-0"><EmptyState icon="users" title="No members yet" description="Add employees and, for working shifts, auto-fill their roster." /></Card>
          ) : (
            <Card padding="p-0" className="overflow-hidden">
              <div className="flex flex-col divide-y divide-rule">
                {members.map(m => {
                  const emp = employees.find(e => e.id === m.employeeId);
                  const shift = m.workingShift;
                  const pat = m.shiftPattern;
                  return (
                    <div key={m.id} className="flex items-center justify-between gap-3 px-5 py-3.5 hover:bg-page transition-colors">
                      <div className="flex items-center gap-3 min-w-0">
                        <Avatar name={emp?.fullName ?? '?'} tone="soft" />
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-ink truncate">{emp?.fullName ?? m.employeeId}</p>
                          <p className="text-xs text-muted truncate">{emp?.department}{emp?.designation ? ` · ${emp.designation}` : ''}</p>
                          {shift && (
                            <p className="flex items-center gap-1.5 mt-0.5 text-xs text-muted tabular-nums"><ColorDot color={shift.color} className="!w-2 !h-2" />{shift.name} · {shift.startTime}–{shift.endTime}</p>
                          )}
                          {pat && !shift && (
                            <p className="flex items-center gap-1.5 mt-0.5 text-xs text-muted"><ColorDot color={pat.color} className="!w-2 !h-2" />{pat.name} · pattern</p>
                          )}
                          {!shift && !pat && <p className="text-xs text-faint mt-0.5">No shift assigned</p>}
                        </div>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className="hidden sm:inline text-xs text-muted tabular-nums">Since {new Date(m.startDate).toLocaleDateString('en-SG', { day: 'numeric', month: 'short' })}</span>
                        <Button size="sm" variant="danger" onClick={() => removeMember(m.id)}>Remove</Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}
        </div>
      )}

      {/* Add Member Modal */}
      {memberModal && (
        <Modal open
          title="Add member"
          caption={selProject.name}
          onClose={() => setMemberModal(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setMemberModal(false)}>Cancel</Button>
              <Button variant="primary" onClick={addMember} disabled={memberSaving || !memberForm.employeeId}>{memberSaving ? 'Adding…' : 'Add member'}</Button>
            </>
          }
        >
          <div className="flex flex-col gap-4">
            <Field label="Employee" required>
              <Select value={memberForm.employeeId} onChange={e => setMemberForm(f => ({ ...f, employeeId: e.target.value }))}>
                <option value="">Select an employee</option>
                {employees.filter(e => !members.find(m => m.employeeId === e.id)).map(e => (
                  <option key={e.id} value={e.id}>{e.fullName} ({e.department})</option>
                ))}
              </Select>
            </Field>
            <Field label="Shift">
              <Select
                value={memberForm.shiftType ? `${memberForm.shiftType}:${memberForm.shiftId}` : ''}
                onChange={e => {
                  const val = e.target.value;
                  if (!val) { setMemberForm(f => ({ ...f, shiftId: '', shiftType: '' })); return; }
                  const [type, id] = val.split(':');
                  setMemberForm(f => ({ ...f, shiftId: id, shiftType: type as 'working' | 'pattern' }));
                }}
              >
                <option value="">None</option>
                {workingShifts.length > 0 && (
                  <optgroup label="Working shifts">
                    {workingShifts.map(ws => <option key={ws.id} value={`working:${ws.id}`}>{ws.name} ({ws.startTime}–{ws.endTime})</option>)}
                  </optgroup>
                )}
                {patterns.length > 0 && (
                  <optgroup label="Shift patterns">
                    {patterns.map(p => <option key={p.id} value={`pattern:${p.id}`}>{p.name} ({p.workDays} on / {p.offDays} off)</option>)}
                  </optgroup>
                )}
              </Select>
            </Field>
            <Field label="Effective start date" required>
              <Input type="date" value={memberForm.startDate} onChange={e => setMemberForm(f => ({ ...f, startDate: e.target.value }))} />
            </Field>
            <DateNote>Roster entries before this date are kept. If the employee is being re-assigned, the previous shift closes the day before.</DateNote>
            {memberForm.shiftType === 'working' && (
              <label className="flex items-center gap-2.5 cursor-pointer text-sm text-ink">
                <input type="checkbox" checked={memberForm.autoPopulate} onChange={e => setMemberForm(f => ({ ...f, autoPopulate: e.target.checked }))} className="w-4 h-4 accent-accent" />
                Auto-fill the roster for the next 4 weeks from the start date
              </label>
            )}
          </div>
        </Modal>
      )}

      {/* Working Shift Modal */}
      {wsModal && (
        <Modal open
          title={wsModal === 'add' ? 'New working shift' : 'Edit working shift'}
          caption={selProject.name}
          onClose={() => setWsModal(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setWsModal(null)}>Cancel</Button>
              <Button variant="primary" onClick={saveWs} disabled={wsSaving || !wsForm.name || (wsModal === 'add' && !wsForm.scheduleStartDate)}>{wsSaving ? 'Saving…' : 'Save shift'}</Button>
            </>
          }
        >
          <div className="flex flex-col gap-4">
            <Field label="Shift name" required>
              <Input value={wsForm.name} onChange={e => setWsForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Morning shift" />
            </Field>
            <div className="flex flex-col gap-1.5">
              <span className="text-[12.5px] font-semibold text-muted">Working days</span>
              <div className="flex gap-1.5 flex-wrap">
                {DAY_KEYS.map((k, i) => (
                  <Chip key={k} on={wsForm[k]} onClick={() => setWsForm(f => ({ ...f, [k]: !f[k] }))}>{DAY_LABELS[i]}</Chip>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Start time">
                <Input type="time" value={wsForm.startTime} onChange={e => setWsForm(f => ({ ...f, startTime: e.target.value }))} />
              </Field>
              <Field label="End time">
                <Input type="time" value={wsForm.endTime} onChange={e => setWsForm(f => ({ ...f, endTime: e.target.value }))} />
              </Field>
            </div>
            <Field label="Break (minutes)">
              <Input type="number" min="0" max="120" value={wsForm.breakMinutes} onChange={e => setWsForm(f => ({ ...f, breakMinutes: e.target.value }))} />
            </Field>
            <label className="flex items-center gap-2.5 cursor-pointer text-sm text-ink">
              <input type="checkbox" checked={wsForm.isRecurring} onChange={e => setWsForm(f => ({ ...f, isRecurring: e.target.checked }))} className="w-4 h-4 accent-accent" />
              Recurring weekly schedule
            </label>
            <div className="flex flex-col gap-1.5">
              <span className="text-[12.5px] font-semibold text-muted">Colour</span>
              <ColorPicker value={wsForm.color} onChange={c => setWsForm(f => ({ ...f, color: c }))} />
            </div>
            {wsForm.startTime && wsForm.endTime && (
              <div className="px-3.5 py-3 rounded-control bg-pill">
                <p className="text-xs font-semibold text-muted">Preview</p>
                <p className="text-sm text-ink mt-0.5 tabular-nums">{workDayLabel(wsForm as unknown as WorkingShift)} · {wsForm.startTime}–{wsForm.endTime} · {calcHours(wsForm.startTime, wsForm.endTime, Number(wsForm.breakMinutes)).toFixed(1)}h/day</p>
              </div>
            )}
            {wsModal === 'add' && (
              <div className="flex flex-col gap-3 pt-4 border-t border-rule">
                <Field label="Schedule start date" required help="The schedule becomes effective from this date.">
                  <Input type="date" value={wsForm.scheduleStartDate} onChange={e => setWsForm(f => ({ ...f, scheduleStartDate: e.target.value }))} />
                </Field>
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* Shift Pattern Modal */}
      {patModal && (
        <Modal open
          title={patModal === 'add' ? 'New shift pattern' : 'Edit shift pattern'}
          caption={selProject.name}
          onClose={() => setPatModal(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setPatModal(null)}>Cancel</Button>
              <Button variant="primary" onClick={savePat} disabled={patSaving || !patForm.name || (patModal === 'add' && !patForm.scheduleStartDate)}>{patSaving ? 'Saving…' : 'Save pattern'}</Button>
            </>
          }
        >
          <div className="flex flex-col gap-4">
            <Field label="Pattern name" required>
              <Input value={patForm.name} onChange={e => setPatForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Continental 12-hour" />
            </Field>
            <div className="flex flex-col gap-1.5">
              <span className="text-[12.5px] font-semibold text-muted">Shift duration</span>
              <div className="flex gap-1.5 flex-wrap">
                {(['12H','8H','6H','CUSTOM'] as const).map(pt => (
                  <Chip key={pt} on={patForm.patternType === pt} onClick={() => {
                    const preset = PATTERN_PRESETS[pt];
                    setPatForm(f => ({ ...f, patternType: pt, ...(pt !== 'CUSTOM' ? preset : {}) }));
                  }}>
                    {pt === 'CUSTOM' ? 'Custom' : `${pt.replace('H', '')}-hour shift`}
                  </Chip>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Work days">
                <Input type="number" min="1" max="30" value={patForm.workDays} onChange={e => setPatForm(f => ({ ...f, workDays: e.target.value }))} />
              </Field>
              <Field label="Off days">
                <Input type="number" min="1" max="30" value={patForm.offDays} onChange={e => setPatForm(f => ({ ...f, offDays: e.target.value }))} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Start time">
                <Input type="time" value={patForm.startTime} onChange={e => setPatForm(f => ({ ...f, startTime: e.target.value }))} />
              </Field>
              <Field label="End time">
                <Input type="time" value={patForm.endTime} onChange={e => setPatForm(f => ({ ...f, endTime: e.target.value }))} />
              </Field>
            </div>
            <Field label="Break (minutes)">
              <Input type="number" min="0" max="120" value={patForm.breakMinutes} onChange={e => setPatForm(f => ({ ...f, breakMinutes: e.target.value }))} />
            </Field>
            <div className="flex flex-col gap-1.5">
              <span className="text-[12.5px] font-semibold text-muted">Colour</span>
              <ColorPicker value={patForm.color} onChange={c => setPatForm(f => ({ ...f, color: c }))} />
            </div>
            {patForm.workDays && patForm.offDays && patForm.startTime && patForm.endTime && (
              <div className="px-3.5 py-3 rounded-control bg-pill">
                <p className="text-xs font-semibold text-muted">Preview</p>
                <p className="text-sm text-ink mt-0.5 tabular-nums">
                  {patForm.workDays} on / {patForm.offDays} off · {Number(patForm.workDays) + Number(patForm.offDays)}-day cycle · {calcHours(patForm.startTime, patForm.endTime, Number(patForm.breakMinutes)).toFixed(1)}h/shift
                </p>
              </div>
            )}
            {patModal === 'add' && (
              <div className="flex flex-col gap-3 pt-4 border-t border-rule">
                <Field label="Schedule start date" required help="The schedule becomes effective from this date.">
                  <Input type="date" value={patForm.scheduleStartDate} onChange={e => setPatForm(f => ({ ...f, scheduleStartDate: e.target.value }))} />
                </Field>
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* Employee Assignment Modal */}
      {assignTarget && (
        <Modal open
          title="Assign employees"
          caption={assignTarget.name}
          onClose={() => setAssignTarget(null)}
          footer={
            <Button variant="primary" onClick={saveAssignments} disabled={assignSaving || !assignSelected.size || !assignDate} className="w-full sm:w-auto">
              {assignSaving ? 'Assigning…' : `Assign ${assignSelected.size > 0 ? assignSelected.size + ' ' : ''}employee${assignSelected.size !== 1 ? 's' : ''} from ${assignDate || '—'}`}
            </Button>
          }
        >
          <div className="flex flex-col gap-4">
            {/* Start Date — top of form so it's set before selecting employees */}
            <Field label="Effective start date" required>
              <Input type="date" value={assignDate} onChange={e => setAssignDate(e.target.value)} />
            </Field>
            <DateNote>
              The roster from this date onwards is set to this shift. Entries <span className="font-semibold text-ink">before</span> it are kept as-is, and any previous assignment closes the day before.
            </DateNote>

            {existingAssignments.length > 0 && (
              <div className="flex flex-col gap-2">
                <p className="text-[12.5px] font-semibold text-muted tabular-nums">Currently assigned ({existingAssignments.length})</p>
                {existingAssignments.map(a => {
                  const emp = employees.find(e => e.id === a.employeeId);
                  return (
                    <div key={a.id} className="flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-control border border-rule bg-page">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Avatar name={emp?.fullName || '?'} size={24} tone="soft" />
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-ink truncate">{emp?.fullName ?? a.employeeId}</p>
                          <p className="text-xs text-muted truncate tabular-nums">{emp?.department} · since {new Date(a.startDate).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
                        </div>
                      </div>
                      <Button size="sm" variant="danger" onClick={() => removeAssignment(a.id)}>Remove</Button>
                    </div>
                  );
                })}
              </div>
            )}
            <div className="flex flex-col gap-3 pt-4 border-t border-rule">
              <p className="text-[12.5px] font-semibold text-muted">Select employees to assign</p>
              <SearchInput value={assignSearch} onChange={e => setAssignSearch(e.target.value)} placeholder="Search by name" />
              <div className="flex flex-col gap-0.5 max-h-56 overflow-y-auto">
                {availableEmps.length === 0 ? (
                  <p className="text-sm text-muted text-center py-4">{assignSearch ? 'No one matches that search.' : 'Everyone is already assigned.'}</p>
                ) : availableEmps.map(e => (
                  <label key={e.id} className="flex items-center gap-3 px-2.5 py-2 rounded-control hover:bg-page cursor-pointer transition-colors">
                    <input type="checkbox" checked={assignSelected.has(e.id)} onChange={ev => setAssignSelected(prev => { const s = new Set(prev); ev.target.checked ? s.add(e.id) : s.delete(e.id); return s; })} className="w-4 h-4 accent-accent" />
                    <Avatar name={e.fullName} size={24} tone="soft" />
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-ink truncate">{e.fullName}</span>
                      <span className="block text-xs text-muted truncate">{e.department}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        </Modal>
      )}

      {/* Project edit modal when inside project detail */}
      {projectModal}
    </div>
  );
}
