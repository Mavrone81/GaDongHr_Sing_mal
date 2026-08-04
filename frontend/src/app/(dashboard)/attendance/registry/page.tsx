'use client';

import React, { useState, useEffect, useCallback, useRef, memo } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { Seal } from '@/components/official';
import { addDays, toISODate as isoDate, todayISO, formatCivil } from '@/lib/timezone';
import { getMondayOf } from '@/lib/attendanceUtils';

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
function getInitials(name: string) { return name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase(); }
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

const SHIFT_COLORS = [
  '#6366f1','#8b5cf6','#ec4899','#f59e0b','#10b981','#3b82f6','#ef4444','#14b8a6','#f97316','#6b7280',
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

export default function AttendanceRegistryPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  if (loading) return <div className="flex items-center justify-center h-64"><div className="w-10 h-10 border-4 border-accent border-accent animate-spin" /></div>;
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
  function RosterSortIcon({ col }: { col: typeof rosterSort.col }) {
    return <span className="text-[8px] ml-1">{rosterSort.col === col ? (rosterSort.dir === 'asc' ? '▲' : '▼') : '⇅'}</span>;
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

  return (
    <div className="flex flex-col gap-8 max-w-[1600px] mx-auto pb-12 animate-in fade-in duration-700">
      {/* Header */}
      <div className="bg-paper p-8 border border-rule flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className="w-2 h-2 bg-accent animate-pulse" />
            <span className="text-[10px] font-black text-accent uppercase tracking-[0.4em]">Live Monitoring</span>
          </div>
          <h1 className="text-3xl font-black text-ink tracking-tighter">Attendance <span className="text-accent">Registry</span></h1>
          <p className="text-sm font-bold text-muted mt-1 uppercase tracking-widest"><LiveClock /> · {employees.length} personnel</p>
        </div>
        <div className="flex flex-wrap gap-3 items-center">
          {tab === 'attendance' && <>
            <input type="date" value={selectedDate} max={todayISO()}
              onChange={e => setSelectedDate(e.target.value)}
              className="bg-page border border-rule px-4 py-2.5 text-xs font-bold text-ink outline-none focus:border-accent transition-all" />
            <button onClick={() => loadRoster(selectedDate, employees)} className="px-5 py-2.5 bg-paper border border-rule text-[10px] font-black uppercase tracking-widest text-muted hover:bg-page transition-all">Refresh</button>
          </>}
          {tab === 'locations' && <button onClick={openAddLoc} className="px-6 py-2.5 bg-accent hover:bg-accent text-paper text-[10px] font-black uppercase tracking-widest transition-all">+ Add Location</button>}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 flex-wrap">
        {([
          { key: 'scheduler',  label: 'Daily Roster',        hide: false },
          { key: 'shifts',     label: 'Shift Management',    hide: false },
          { key: 'attendance', label: 'Attendance Records',  hide: isSchedulerOnly },
          { key: 'locations',  label: 'Work Locations',      hide: isSchedulerOnly },
        ] as const).filter(t => !t.hide).map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-6 py-2.5  text-[10px] font-black uppercase tracking-widest transition-all ${tab === t.key ? 'bg-accent text-paper' : 'bg-paper border border-rule text-muted hover:bg-page'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'attendance' && <>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-5">
          {[
            { label: 'Clocked In',  count: clockedIn,  color: 'text-accent', dot: 'bg-accent' },
            { label: 'Clocked Out', count: clockedOut, color: 'text-accent',    dot: 'bg-accent'    },
            { label: 'Late',        count: late,        color: 'text-ink',   dot: 'bg-highlight'   },
            { label: 'Absent',      count: absent,      color: 'text-ink',     dot: 'bg-ink'     },
            { label: 'Out of Zone', count: outOfBound,  color: 'text-ink',    dot: 'bg-ink'    },
          ].map(s => (
            <div key={s.label} className="bg-paper p-7 border border-rule">
              <div className="flex items-center gap-2 mb-4"><div className={`w-2 h-2  ${s.dot}`} /><p className="eyebrow-tight">{s.label}</p></div>
              <p className={`text-4xl font-black tracking-tighter ${s.color}`}>{rosterLoading ? '—' : s.count}</p>
            </div>
          ))}
        </div>
        <div className="bg-paper border border-rule overflow-hidden">
          <div className="px-8 py-6 border-b border-rule bg-page flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div className="flex items-center gap-4">
              <div className="w-2 h-8 bg-accent" />
              <h3 className="text-sm font-black text-ink uppercase tracking-widest">Attendance Records</h3>
              <span className="label-form">{filtered.length} records</span>
            </div>
            <input type="text" placeholder="Filter by name or department…" value={search} onChange={e => setSearch(e.target.value)}
              className="w-full sm:w-64 bg-page border border-rule px-4 py-2.5 text-xs font-bold text-ink placeholder:text-muted outline-none focus:border-accent transition-all" />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead className="text-[10px] text-muted font-black uppercase tracking-[0.2em] border-b border-rule bg-page">
                <tr>
                  {([
                    { col: 'name',    label: 'Employee'   },
                    { col: 'dept',    label: 'Department' },
                    { col: 'clockIn', label: 'Clock In'   },
                    { col: 'clockOut',label: 'Clock Out'  },
                    { col: 'hours',   label: 'Hours'      },
                    { col: null,      label: 'Location'   },
                    { col: 'status',  label: 'Status'     },
                    { col: null,      label: 'Actions'    },
                  ] as const).map(h => (
                    <th key={h.label} className="px-8 py-5">
                      {h.col ? (
                        <button onClick={() => toggleRosterSort(h.col!)} className="flex items-center hover:text-ink transition-colors">
                          {h.label}<RosterSortIcon col={h.col} />
                        </button>
                      ) : h.label}
                      {/* Sealed once in the header, not on every row: the rate
                          governs the whole column, and a seal per row would make
                          the citation ordinary wallpaper. */}
                      {h.col === 'hours' && (
                        <span className="block mt-1 normal-case tracking-normal">
                          <Seal cite="EA s.38 · OT at 1.5x" />
                        </span>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-rule">
                {rosterLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i} className="animate-pulse"><td colSpan={8} className="px-8 py-5"><div className="h-8 bg-page w-full" /></td></tr>
                  ))
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={8} className="px-8 py-16 text-center"><p className="text-sm font-black text-muted uppercase tracking-widest">No records found</p></td></tr>
                ) : sortedRoster.map(row => (
                  <tr key={row.employeeId} className="hover:bg-page transition-all">
                    <td className="px-8 py-5">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 bg-shadow flex items-center justify-center text-[10px] font-black text-accent shrink-0">{getInitials(row.name)}</div>
                        <div>
                          <p className="text-sm font-black text-ink uppercase tracking-tight">{row.name}</p>
                          <p className="text-[9px] font-bold text-muted uppercase mt-0.5">{row.designation || '—'}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-8 py-5 text-[11px] font-bold text-muted uppercase tracking-widest">{row.dept || '—'}</td>
                    <td className="px-8 py-5 text-xs font-black text-ink tabular-nums">{fmtTime(row.clockIn)}</td>
                    <td className="px-8 py-5 text-xs font-black text-muted tabular-nums">{fmtTime(row.clockOut)}</td>
                    <td className="px-8 py-5 text-xs font-black text-ink tabular-nums">
                      {row.hoursWorked != null ? `${row.hoursWorked.toFixed(1)}h` : '—'}
                      {row.otHours > 0 && <span className="ml-1.5 text-[9px] font-black text-ink uppercase">+{row.otHours.toFixed(1)}OT</span>}
                    </td>
                    <td className="px-8 py-5">
                      {row.withinGeofence === true && <span className="inline-flex items-center gap-1.5 text-[9px] font-black uppercase px-2.5 py-1 bg-page text-accent border border-accent tracking-widest">{row.locationName || 'In Zone'}</span>}
                      {row.withinGeofence === false && <span className="inline-flex items-center gap-1.5 text-[9px] font-black uppercase px-2.5 py-1 bg-page text-ink border border-ink tracking-widest">Out of Zone</span>}
                      {row.withinGeofence == null && row.clockIn && <span className="text-[9px] text-muted font-bold uppercase tracking-widest">No GPS</span>}
                      {!row.clockIn && <span className="text-[9px] text-paper font-bold">—</span>}
                    </td>
                    <td className="px-8 py-5">
                      <span className={`text-[9px] font-black uppercase px-3 py-1  border tracking-widest ${row.status === 'On Time' ? 'bg-page text-accent border-accent' : row.status === 'Clocked Out' ? 'bg-page text-accent border-accent' : row.status === 'Late' ? 'bg-page text-ink border-highlight' : 'bg-page text-ink border-ink'}`}>{row.status}</span>
                    </td>
                    <td className="px-8 py-5">
                      <button onClick={() => openAssign(row.employeeId, row.name)} className="text-[9px] font-black uppercase text-accent hover:text-accent tracking-widest transition-all">Locations</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </>}

      {tab === 'scheduler' && (
        <ShiftScheduler employees={employees} />
      )}

      {tab === 'shifts' && (
        <ShiftManagement employees={employees} />
      )}

      {tab === 'locations' && (
        <div className="bg-paper border border-rule overflow-hidden">
          <div className="px-8 py-6 border-b border-rule bg-page">
            <div className="flex items-center gap-4">
              <div className="w-2 h-8 bg-accent" />
              <h3 className="text-sm font-black text-ink uppercase tracking-widest">Work Locations</h3>
              <span className="label-form">{locations.length} locations</span>
            </div>
            <p className="text-[10px] font-bold text-muted uppercase tracking-widest mt-2 ml-6">Geofence zones — employees must clock in within the configured radius</p>
          </div>
          {locLoading ? <div className="p-12 text-center"><div className="w-8 h-8 border-4 border-accent border-accent animate-spin mx-auto" /></div>
          : locations.length === 0 ? <div className="p-16 text-center"><p className="text-sm font-black text-muted uppercase tracking-widest mb-2">No work locations configured</p></div>
          : (
            <div className="divide-y divide-rule">
              {locations.map(loc => (
                <div key={loc.id} className="flex items-center gap-5 px-8 py-6 hover:bg-page transition-all">
                  <div className={`w-3 h-3  shrink-0 ${loc.isActive ? 'bg-accent' : 'bg-rule'}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 flex-wrap">
                      <p className="text-sm font-black text-ink uppercase tracking-tight">{loc.name}</p>
                      <span className="text-[9px] font-black px-2 py-0.5 bg-page text-accent border border-accent tracking-widest uppercase">{loc.radiusMetres}m radius</span>
                      <span className="text-[9px] font-bold text-muted uppercase tracking-widest">{loc._count?.employeeLocations ?? 0} assigned</span>
                    </div>
                    <p className="text-[10px] font-bold text-muted mt-1">{loc.address || `Postal: ${loc.postalCode}`}</p>
                    <p className="text-[9px] text-muted font-mono mt-0.5">{loc.latitude.toFixed(6)}, {loc.longitude.toFixed(6)}</p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button onClick={() => openEditLoc(loc)} className="px-4 py-2 text-[9px] font-black uppercase tracking-widest border border-rule text-muted hover:border-accent hover:text-accent transition-all">Edit</button>
                    <button onClick={() => deleteLocation(loc.id)} className="px-4 py-2 text-[9px] font-black uppercase tracking-widest border border-ink text-ink hover:bg-page transition-all">Delete</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {locModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-shadow backdrop-">
          <div className="w-full max-w-md bg-paper overflow-hidden">
            <div className="flex items-center justify-between px-8 py-6 border-b border-rule">
              <h2 className="text-lg font-black text-ink tracking-tighter">{locModal === 'add' ? 'Add Work Location' : 'Edit Work Location'}</h2>
              <button onClick={() => setLocModal(null)} className="w-9 h-9 flex items-center justify-center text-muted hover:bg-page transition-all text-lg">✕</button>
            </div>
            <div className="flex flex-col gap-4 p-8">
              {[{ key: 'name', label: 'Location Name', placeholder: 'e.g. Main Office' }, { key: 'address', label: 'Address', placeholder: 'Auto-filled from postal code' }].map(f => (
                <div key={f.key} className="flex flex-col gap-2">
                  <label className="text-[10px] font-black text-muted uppercase tracking-widest">{f.label}</label>
                  <input value={locForm[f.key as keyof typeof locForm]} onChange={e => setLocForm(x => ({ ...x, [f.key]: e.target.value }))} placeholder={f.placeholder}
                    className="w-full px-4 py-3 bg-page border border-rule text-sm font-bold text-ink outline-none focus:border-accent transition-all" />
                </div>
              ))}
              <div className="flex flex-col gap-2">
                <label className="text-[10px] font-black text-muted uppercase tracking-widest">Singapore Postal Code</label>
                <div className="flex gap-2">
                  <input value={locForm.postalCode} onChange={e => setLocForm(f => ({ ...f, postalCode: e.target.value }))} placeholder="e.g. 238859"
                    className="flex-1 px-4 py-3 bg-page border border-rule text-sm font-bold text-ink outline-none focus:border-accent transition-all" />
                  <button onClick={handlePostalLookup} disabled={locPostalSearching || !locForm.postalCode}
                    className="px-4 py-3 bg-accent hover:bg-accent disabled:opacity-50 text-paper text-[9px] font-black uppercase tracking-widest transition-all whitespace-nowrap">
                    {locPostalSearching ? '…' : 'Detect'}
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {[{ key: 'latitude', placeholder: '1.3521' }, { key: 'longitude', placeholder: '103.8198' }].map(f => (
                  <div key={f.key} className="flex flex-col gap-2">
                    <label className="text-[10px] font-black text-muted uppercase tracking-widest">{f.key}</label>
                    <input value={locForm[f.key as keyof typeof locForm]} onChange={e => setLocForm(x => ({ ...x, [f.key]: e.target.value }))} placeholder={f.placeholder}
                      className="w-full px-4 py-3 bg-page border border-rule text-sm font-bold text-ink outline-none focus:border-accent transition-all font-mono" />
                  </div>
                ))}
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-[10px] font-black text-muted uppercase tracking-widest">Geofence Radius (metres)</label>
                <input type="number" min="50" max="5000" value={locForm.radiusMetres} onChange={e => setLocForm(f => ({ ...f, radiusMetres: e.target.value }))}
                  className="w-full px-4 py-3 bg-page border border-rule text-sm font-bold text-ink outline-none focus:border-accent transition-all" />
              </div>
              {locError && <p className="text-xs font-bold text-ink bg-page border border-ink px-4 py-3">{locError}</p>}
              <div className="flex gap-3 pt-1">
                <button onClick={() => setLocModal(null)} className="flex-1 py-3 border border-rule text-[10px] font-black uppercase tracking-widest text-muted hover:bg-page transition-all">Cancel</button>
                <button onClick={saveLocation} disabled={locSaving} className="flex-1 py-3 bg-accent hover:bg-accent disabled:opacity-50 text-paper text-[10px] font-black uppercase tracking-widest transition-all">
                  {locSaving ? 'Saving…' : 'Save Location'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {assignModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-shadow backdrop-">
          <div className="w-full max-w-lg bg-paper overflow-hidden">
            <div className="flex items-center justify-between px-8 py-6 border-b border-rule">
              <div>
                <h2 className="text-lg font-black text-ink tracking-tighter">Work Locations</h2>
                <p className="eyebrow-tight mt-0.5">{assignModal.empName}</p>
              </div>
              <button onClick={() => setAssignModal(null)} className="w-9 h-9 flex items-center justify-center text-muted hover:bg-page transition-all text-lg">✕</button>
            </div>
            <div className="flex flex-col gap-4 p-8">
              {empAssignments.length > 0 ? (
                <div className="flex flex-col gap-2">
                  <p className="text-[10px] font-black text-muted uppercase tracking-widest">Assigned Locations</p>
                  {empAssignments.map(a => (
                    <div key={a.id} className="flex items-center justify-between bg-page px-4 py-3 border border-rule">
                      <div>
                        <span className="text-xs font-black text-ink">{a.workLocation.name}</span>
                        {a.isPrimary && <span className="ml-2 text-[9px] font-black uppercase px-2 py-0.5 bg-page text-accent border border-accent tracking-widest">Primary</span>}
                        <p className="text-[9px] font-bold text-muted mt-0.5 uppercase">{a.workLocation.radiusMetres}m radius · {a.workLocation.postalCode}</p>
                      </div>
                      <button onClick={() => removeAssignment(a.id, assignModal.empId)} className="text-[9px] font-black uppercase text-ink hover:text-ink tracking-widest transition-all">Remove</button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="px-4 py-3 bg-page border border-highlight">
                  <p className="text-[10px] font-bold text-ink uppercase tracking-widest">No locations assigned — this employee can clock in from anywhere</p>
                </div>
              )}
              <div className="flex flex-col gap-3 pt-2 border-t border-rule">
                <p className="text-[10px] font-black text-muted uppercase tracking-widest">Add Location</p>
                <select value={assignLocId} onChange={e => setAssignLocId(e.target.value)}
                  className="w-full px-4 py-3 bg-page border border-rule text-sm font-bold text-ink outline-none focus:border-accent transition-all">
                  <option value="">— Select a work location —</option>
                  {locations.filter(l => l.isActive && !empAssignments.find(a => a.workLocationId === l.id)).map(l => (
                    <option key={l.id} value={l.id}>{l.name} ({l.radiusMetres}m)</option>
                  ))}
                </select>
                <label className="flex items-center gap-3 cursor-pointer">
                  <input type="checkbox" checked={assignPrimary} onChange={e => setAssignPrimary(e.target.checked)} className="w-4 h-4 accent-accent" />
                  <span className="text-[10px] font-black text-muted uppercase tracking-widest">Set as primary location</span>
                </label>
                <button onClick={saveAssignment} disabled={assignSaving || !assignLocId}
                  className="w-full py-3 bg-accent hover:bg-accent disabled:opacity-50 text-paper text-[10px] font-black uppercase tracking-widest transition-all">
                  {assignSaving ? 'Assigning…' : 'Assign Location'}
                </button>
              </div>
            </div>
          </div>
        </div>
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
  weekly: 'Weekly', workweek: 'Work Week', biweekly: 'Bi-weekly', monthly: 'Monthly',
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

  return (
    <div className="flex flex-col gap-5">
      {/* Scheduler header */}
      <div className="bg-paper border border-rule p-6 flex flex-wrap items-center gap-4">
        {/* View mode selector */}
        <div className="flex items-center gap-1 bg-page p-1">
          {(['weekly','workweek','biweekly','monthly'] as ViewMode[]).map(m => (
            <button key={m} onClick={() => switchMode(m)}
              className={`px-3 py-1.5  text-[9px] font-black uppercase tracking-widest transition-all ${viewMode === m ? 'bg-paper text-accent border border-rule' : 'text-muted hover:text-ink'}`}>
              {VIEW_LABELS[m]}
            </button>
          ))}
        </div>

        {/* Period nav */}
        <div className="flex items-center gap-2">
          <button onClick={() => navigate(-1)} className="w-9 h-9 flex items-center justify-center border border-rule text-muted hover:bg-page font-black text-sm transition-all">‹</button>
          <span className="text-sm font-black text-ink tracking-tight min-w-[200px] text-center">{periodLabel}</span>
          <button onClick={() => navigate(1)} className="w-9 h-9 flex items-center justify-center border border-rule text-muted hover:bg-page font-black text-sm transition-all">›</button>
          <button onClick={goToToday} className="px-3 py-1.5 text-[9px] font-black uppercase tracking-widest border border-accent text-accent bg-page hover:bg-page transition-all">Today</button>
        </div>

        <div className="flex items-center gap-2 ml-auto flex-wrap">
          {/* Bulk bar — visible only when employees are selected */}
          {selectedEmps.size > 0 && (
            <div className="flex items-center gap-2 bg-page border border-accent px-4 py-2">
              <span className="text-[9px] font-black text-accent uppercase tracking-widest">{selectedEmps.size} selected</span>
              <select value={bulkShift} onChange={e => setBulkShift(e.target.value)}
                className="text-[9px] font-black text-ink bg-paper border border-rule px-2 py-1 uppercase tracking-widest">
                <option value="">— Clear shift —</option>
                {shifts.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              {/* Weekday toggles — Mon=0 … Sun=6; applies to all matching dates in view */}
              <div className="flex gap-1">
                {['M','T','W','T','F','S','S'].map((lbl, i) => (
                  <button key={i} onClick={() => setBulkDays(prev => { const s = new Set(prev); s.has(i) ? s.delete(i) : s.add(i); return s; })}
                    className={`w-7 h-7  text-[8px] font-black transition-all ${bulkDays.has(i) ? 'bg-accent text-paper' : 'bg-paper border border-rule text-muted'}`}>
                    {lbl}
                  </button>
                ))}
              </div>
              <button onClick={bulkAssign} disabled={bulkSaving || !bulkDays.size}
                className="px-3 py-1.5 bg-accent text-paper text-[9px] font-black uppercase tracking-widest disabled:opacity-50 hover:bg-accent transition-all">
                {bulkSaving ? '…' : 'Apply'}
              </button>
            </div>
          )}
          {viewMode === 'weekly' && (
            <button onClick={() => setCopyModal(true)} className="px-4 py-2 text-[9px] font-black uppercase tracking-widest border border-rule text-muted bg-paper hover:bg-page transition-all">Copy Week</button>
          )}
          <button onClick={() => { setShowShiftPanel(p => !p); }} className="px-4 py-2 text-[9px] font-black uppercase tracking-widest border border-accent text-accent bg-page hover:bg-page transition-all">Shift Templates</button>
        </div>
      </div>

      <div className="flex gap-5 items-start">
        {/* Main grid */}
        <div className="flex-1 min-w-0 bg-paper border border-rule overflow-hidden">
          {/* Filter bar */}
          <div className="px-6 py-4 border-b border-rule bg-page flex items-center gap-4">
            <input value={empSearch} onChange={e => setEmpSearch(e.target.value)} placeholder="Search employees…"
              className="bg-paper border border-rule px-3 py-2 text-xs font-bold text-ink outline-none focus:border-accent w-48 transition-all" />
            <select value={deptFilter} onChange={e => setDeptFilter(e.target.value)}
              className="bg-paper border border-rule px-3 py-2 text-[10px] font-black text-ink uppercase tracking-widest outline-none focus:border-accent transition-all">
              <option value="">All Departments</option>
              {depts.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
            <span className="label-form ml-auto">{filteredEmps.length} employees</span>
          </div>

          {loading ? (
            <div className="p-16 text-center"><div className="w-8 h-8 border-4 border-accent border-accent animate-spin mx-auto" /></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse" style={{ minWidth: viewMode === 'monthly' ? `${44 * viewDays.length + 240}px` : viewMode === 'biweekly' ? `${80 * 14 + 240}px` : '900px' }}>
                <thead>
                  <tr className="border-b border-rule bg-page">
                    <th className="w-10 px-4 py-4">
                      <input type="checkbox" checked={allSelected} onChange={e => setSelectedEmps(e.target.checked ? new Set(filteredEmps.map(x => x.id)) : new Set())} className="w-3.5 h-3.5 accent-accent" />
                    </th>
                    <th className="px-4 py-4 text-left label-form min-w-[180px]">Employee</th>
                    {viewDays.map((d, i) => {
                      const todayStr = todayISO();
                      const isToday = isoDate(d) === todayStr;
                      const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                      const DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
                      const colW = viewMode === 'monthly' ? 'min-w-[44px]' : viewMode === 'biweekly' ? 'min-w-[80px]' : 'min-w-[110px]';
                      return (
                        <th key={i} className={`px-1 py-4 text-center text-[9px] font-black uppercase tracking-widest ${colW} ${isToday ? 'text-accent font-black' : 'text-muted'} ${isWeekend ? 'bg-page' : ''}`}>
                          {viewMode !== 'monthly' && <div>{DAY_NAMES[d.getDay()]}</div>}
                          <div className={`${viewMode === 'monthly' ? 'text-[9px]' : 'text-sm'} font-black mt-0.5 ${isToday ? 'text-accent' : isWeekend ? 'text-muted' : 'text-ink'}`}>{d.getDate()}</div>
                          {viewMode === 'monthly' && <div className="text-[7px] font-bold text-muted">{DAY_NAMES[d.getDay()][0]}</div>}
                          {viewMode !== 'monthly' && <div className="text-[8px] font-bold text-muted mt-0.5">{d.toLocaleDateString('en-SG', { month: 'short' })}</div>}
                        </th>
                      );
                    })}
                    <th className="px-4 py-4 text-center label-form">
                      {viewMode === 'monthly' ? 'Hrs/Mo' : viewMode === 'biweekly' ? 'Hrs/2Wk' : 'Hrs/Wk'}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-rule">
                  {filteredEmps.length === 0 ? (
                    <tr><td colSpan={viewDays.length + 3} className="px-8 py-16 text-center text-sm font-black text-muted uppercase tracking-widest">No employees found</td></tr>
                  ) : filteredEmps.map(emp => {
                    const hrs = periodHours(emp.id);
                    const isCompact = viewMode === 'monthly';
                    return (
                      <tr key={emp.id} className={`hover:bg-page transition-all ${selectedEmps.has(emp.id) ? 'bg-page' : ''}`}>
                        <td className="px-4 py-3 text-center">
                          <input type="checkbox" checked={selectedEmps.has(emp.id)} onChange={e => setSelectedEmps(prev => { const s = new Set(prev); e.target.checked ? s.add(emp.id) : s.delete(emp.id); return s; })} className="w-3.5 h-3.5 accent-accent" />
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2.5 group/emprow">
                            <div className="w-7 h-7 bg-shadow flex items-center justify-center text-[9px] font-black text-accent shrink-0">{getInitials(emp.fullName)}</div>
                            <div className="flex-1 min-w-0">
                              <p className="text-[11px] font-black text-ink tracking-tight">{emp.fullName}</p>
                              <p className="text-[8px] font-bold text-muted uppercase tracking-widest">{emp.department}</p>
                            </div>
                            <button
                              onClick={() => setResetConfirm({ empId: emp.id, empName: emp.fullName })}
                              disabled={resettingEmpId === emp.id}
                              title="Reset schedule for this period"
                              className="opacity-0 group-hover/emprow:opacity-100 transition-opacity w-6 h-6 flex items-center justify-center border border-ink text-ink hover:bg-page hover:text-ink shrink-0 disabled:opacity-30"
                            >
                              {resettingEmpId === emp.id
                                ? <div className="w-3 h-3 border-2 border-ink border-ink animate-spin" />
                                : <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" /></svg>
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
                            <td key={i} className={`${isCompact ? 'px-0.5 py-1' : 'px-2 py-2'} text-center ${isWeekend ? 'bg-page' : ''}`}>
                              <button
                                onClick={e => {
                                  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                                  setCellPopover({ empId: emp.id, date: dateStr, x: rect.left, y: rect.bottom + 4 });
                                }}
                                disabled={isSaving}
                                title={shift ? `${shift.name} · ${shift.startTime}–${shift.endTime}` : dateStr}
                                className={`w-full  border transition-all group relative ${isCompact ? 'min-h-[32px]' : 'min-h-[52px]'} ${isToday && !shift ? 'border-accent bg-page' : ''}`}
                                style={shift ? { backgroundColor: shift.color + '22', borderColor: shift.color + '55' } : { backgroundColor: 'transparent', borderColor: isToday ? undefined : '#e2e8f0' }}
                              >
                                {isSaving ? (
                                  <div className="flex items-center justify-center h-full"><div className="w-3 h-3 border-2 border-rule border-rule animate-spin" /></div>
                                ) : shift ? (
                                  isCompact ? (
                                    <div className="flex items-center justify-center h-full py-1">
                                      <div className="w-2 h-2" style={{ backgroundColor: shift.color }} />
                                    </div>
                                  ) : (
                                    <div className="px-1.5 py-1">
                                      <div className="w-1.5 h-1.5 mx-auto mb-1" style={{ backgroundColor: shift.color }} />
                                      <p className="text-[9px] font-black tracking-tight truncate" style={{ color: shift.color }}>{shift.name}</p>
                                      <p className="text-[8px] font-bold text-muted">{shift.startTime}–{shift.endTime}</p>
                                    </div>
                                  )
                                ) : (
                                  <span className={`text-paper group-hover:text-muted transition-colors ${isCompact ? 'text-sm' : 'text-lg'}`}>+</span>
                                )}
                              </button>
                            </td>
                          );
                        })}
                        <td className="px-4 py-3 text-center">
                          <span className={`text-[10px] font-black tabular-nums ${hrs >= 160 ? 'text-ink' : hrs >= 80 ? 'text-ink' : hrs >= 40 ? 'text-ink' : hrs > 0 ? 'text-ink' : 'text-muted'}`}>
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
        </div>

        {/* Shift Templates Panel */}
        {showShiftPanel && (
          <div className="w-72 shrink-0 bg-paper border border-rule overflow-hidden">
            <div className="px-6 py-5 border-b border-rule flex items-center justify-between">
              <h3 className="text-[10px] font-black text-ink uppercase tracking-widest">Shift Templates</h3>
              <button onClick={() => { setEditShift(null); setShiftForm({ name: '', startTime: '09:00', endTime: '18:00', breakMinutes: '60', color: SHIFT_COLORS[0] }); setShiftModal('add'); }}
                className="px-3 py-1.5 bg-accent text-paper text-[9px] font-black uppercase tracking-widest hover:bg-accent transition-all">
                + New
              </button>
            </div>
            {shifts.length === 0 ? (
              <div className="p-8 text-center"><p className="text-[10px] font-bold text-muted uppercase tracking-widest">No shift templates yet</p></div>
            ) : (
              <div className="divide-y divide-rule">
                {shifts.map(s => (
                  <div key={s.id} className="px-5 py-4 flex items-start gap-3 hover:bg-page transition-all">
                    <div className="w-3 h-3 mt-1 shrink-0" style={{ backgroundColor: s.color }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-black text-ink tracking-tight">{s.name}</p>
                      <p className="text-[9px] font-bold text-muted mt-0.5">{s.startTime} – {s.endTime}</p>
                      <p className="text-[8px] font-bold text-muted uppercase tracking-widest">{s.hoursPerDay.toFixed(1)}h · {s.breakMinutes}min break</p>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <button onClick={() => openShiftEdit(s)} className="w-7 h-7 flex items-center justify-center border border-rule text-[10px] text-muted hover:border-accent hover:text-accent transition-all">✎</button>
                      <button onClick={() => deleteShift(s.id)} className="w-7 h-7 flex items-center justify-center border border-ink text-[10px] text-ink hover:bg-page transition-all">✕</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Cell Popover */}
      {cellPopover && (
        <div ref={popoverRef} className="fixed z-50 bg-paper border border-rule p-3 w-56" style={{ top: Math.min(cellPopover.y, window.innerHeight - 260), left: Math.min(cellPopover.x, window.innerWidth - 240) }}>
          <p className="label-form mb-2">Assign Shift</p>
          <div className="flex flex-col gap-1 max-h-64 overflow-y-auto">
            {shifts.filter(s => s._type === 'template').length > 0 && (
              <p className="text-[8px] font-black text-muted uppercase tracking-widest px-3 pt-1">Templates</p>
            )}
            {shifts.filter(s => s._type === 'template').map(s => (
              <button key={s.id} onClick={() => assignShift(cellPopover.empId, cellPopover.date, s)}
                className="flex items-center gap-2.5 px-3 py-2 hover:bg-page transition-all text-left w-full">
                <div className="w-2.5 h-2.5 shrink-0" style={{ backgroundColor: s.color }} />
                <div>
                  <p className="text-[10px] font-black text-ink">{s.name}</p>
                  <p className="text-[8px] text-muted font-bold">{s.startTime} – {s.endTime}</p>
                </div>
              </button>
            ))}
            {shifts.filter(s => s._type === 'working').length > 0 && (
              <p className="text-[8px] font-black text-muted uppercase tracking-widest px-3 pt-2">Working Shifts</p>
            )}
            {shifts.filter(s => s._type === 'working').map(s => (
              <button key={s.id} onClick={() => assignShift(cellPopover.empId, cellPopover.date, s)}
                className="flex items-center gap-2.5 px-3 py-2 hover:bg-page transition-all text-left w-full">
                <div className="w-2.5 h-2.5 shrink-0" style={{ backgroundColor: s.color }} />
                <div>
                  <p className="text-[10px] font-black text-ink">{s.name}</p>
                  <p className="text-[8px] text-muted font-bold">{s.startTime} – {s.endTime} · {s.projectName}</p>
                </div>
              </button>
            ))}
            {shifts.length === 0 && <p className="text-[10px] text-muted px-3 py-2 font-bold">No shifts yet.</p>}
            <div className="border-t border-rule mt-1 pt-1">
              <button onClick={() => clearShift(cellPopover.empId, cellPopover.date)}
                className="w-full px-3 py-2 hover:bg-page text-left text-[10px] font-black text-ink uppercase tracking-widest transition-all">
                Clear Shift
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Copy Week Modal */}
      {copyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-shadow backdrop-">
          <div className="w-full max-w-sm bg-paper p-8">
            <h3 className="text-base font-black text-ink tracking-tighter mb-1">Copy Roster Week</h3>
            <p className="text-[10px] font-bold text-muted uppercase tracking-widest mb-6">Copy all shifts from {periodLabel} to another week</p>
            <div className="flex flex-col gap-2 mb-6">
              <label className="text-[9px] font-black text-muted uppercase tracking-widest">Target Week (select any day)</label>
              <input type="date" value={copyToWeek} onChange={e => setCopyToWeek(isoDate(getMondayOf(new Date(e.target.value))))}
                className="w-full px-4 py-3 bg-page border border-rule text-sm font-bold text-ink outline-none focus:border-accent transition-all" />
              {copyToWeek && <p className="text-[9px] font-bold text-muted">Will copy to week of {copyToWeek}</p>}
            </div>
            <div className="flex gap-3">
              <button onClick={() => setCopyModal(false)} className="flex-1 py-3 border border-rule text-[10px] font-black uppercase tracking-widest text-muted hover:bg-page">Cancel</button>
              <button onClick={copyWeek} disabled={copySaving || !copyToWeek}
                className="flex-1 py-3 bg-accent hover:bg-accent disabled:opacity-50 text-paper text-[10px] font-black uppercase tracking-widest transition-all">
                {copySaving ? 'Copying…' : 'Copy'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reset Schedule Confirmation Modal */}
      {resetConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-shadow backdrop-">
          <div className="w-full max-w-sm bg-paper p-8">
            <div className="w-12 h-12 bg-page border border-ink flex items-center justify-center mb-5">
              <svg className="w-5 h-5 text-ink" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" /></svg>
            </div>
            <h3 className="text-base font-black text-ink tracking-tighter mb-1">Reset Schedule</h3>
            <p className="text-[10px] font-bold text-muted uppercase tracking-widest mb-1">{resetConfirm.empName}</p>
            <p className="text-xs font-bold text-muted mb-6">
              This will clear all {viewDays.length} shift assignments for <span className="text-ink">{periodLabel}</span>. The employee will show as unscheduled for this period.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setResetConfirm(null)}
                className="flex-1 py-3 border border-rule text-[10px] font-black uppercase tracking-widest text-muted hover:bg-page transition-all"
              >
                Cancel
              </button>
              <button
                onClick={() => resetEmployeeSchedule(resetConfirm.empId)}
                disabled={resettingEmpId === resetConfirm.empId}
                className="flex-1 py-3 bg-ink hover:bg-ink disabled:opacity-50 text-paper text-[10px] font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2"
              >
                {resettingEmpId === resetConfirm.empId && <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white animate-spin" />}
                Reset
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Shift Template Modal */}
      {shiftModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-shadow backdrop-">
          <div className="w-full max-w-sm bg-paper p-8">
            <h3 className="text-base font-black text-ink tracking-tighter mb-5">{shiftModal === 'add' ? 'New Shift Template' : 'Edit Shift'}</h3>
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-[9px] font-black text-muted uppercase tracking-widest">Shift Name *</label>
                <input value={shiftForm.name} onChange={e => setShiftForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Morning, Afternoon, Night"
                  className="w-full px-4 py-3 bg-page border border-rule text-sm font-bold text-ink outline-none focus:border-accent transition-all" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[9px] font-black text-muted uppercase tracking-widest">Start Time</label>
                  <input type="time" value={shiftForm.startTime} onChange={e => setShiftForm(f => ({ ...f, startTime: e.target.value }))}
                    className="w-full px-4 py-3 bg-page border border-rule text-sm font-bold text-ink outline-none focus:border-accent transition-all" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[9px] font-black text-muted uppercase tracking-widest">End Time</label>
                  <input type="time" value={shiftForm.endTime} onChange={e => setShiftForm(f => ({ ...f, endTime: e.target.value }))}
                    className="w-full px-4 py-3 bg-page border border-rule text-sm font-bold text-ink outline-none focus:border-accent transition-all" />
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[9px] font-black text-muted uppercase tracking-widest">Break Duration (minutes)</label>
                <input type="number" min="0" max="120" value={shiftForm.breakMinutes} onChange={e => setShiftForm(f => ({ ...f, breakMinutes: e.target.value }))}
                  className="w-full px-4 py-3 bg-page border border-rule text-sm font-bold text-ink outline-none focus:border-accent transition-all" />
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-[9px] font-black text-muted uppercase tracking-widest">Colour</label>
                <div className="flex flex-wrap gap-2">
                  {SHIFT_COLORS.map(c => (
                    <button key={c} onClick={() => setShiftForm(f => ({ ...f, color: c }))}
                      className={`w-7 h-7  transition-all ${shiftForm.color === c ? 'ring-2 ring-offset-1 ring-rule scale-110' : 'hover:scale-105'}`}
                      style={{ backgroundColor: c }} />
                  ))}
                </div>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setShiftModal(null)} className="flex-1 py-3 border border-rule text-[10px] font-black uppercase tracking-widest text-muted hover:bg-page">Cancel</button>
              <button onClick={saveShift} disabled={shiftSaving || !shiftForm.name}
                className="flex-1 py-3 bg-accent hover:bg-accent disabled:opacity-50 text-paper text-[10px] font-black uppercase tracking-widest transition-all">
                {shiftSaving ? 'Saving…' : 'Save Shift'}
              </button>
            </div>
          </div>
        </div>
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

  if (!selProject) {
    return (
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-black text-ink tracking-tighter">Shift Management</h2>
            <p className="text-[10px] font-bold text-muted uppercase tracking-widest mt-1">Organise working shifts and rotation patterns by project</p>
          </div>
          <button onClick={openAddProject} className="px-6 py-2.5 bg-accent hover:bg-accent text-paper text-[10px] font-black uppercase tracking-widest transition-all">+ New Project</button>
        </div>
        {projLoading ? (
          <div className="p-16 text-center"><div className="w-8 h-8 border-4 border-accent border-accent animate-spin mx-auto" /></div>
        ) : projects.length === 0 ? (
          <div className="bg-paper border border-dashed border-rule p-16 text-center">
            <p className="text-sm font-black text-muted uppercase tracking-widest mb-2">No projects yet</p>
            <p className="text-[10px] font-bold text-muted uppercase tracking-widest">Create a project to start defining shifts and rotation patterns</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {projects.map(p => (
              <button key={p.id} onClick={() => { setSelProject(p); setSubTab('working'); }}
                className="text-left bg-paper border border-rule p-7 hover:border-accent hover: transition-all group">
                <div className="flex items-start justify-between mb-4">
                  <div className="w-10 h-10 bg-accent flex items-center justify-center text-paper font-black text-sm">{p.name[0].toUpperCase()}</div>
                  <span className={`text-[9px] font-black uppercase px-2 py-1  tracking-widest ${p.isActive ? 'bg-page text-accent' : 'bg-page text-muted'}`}>{p.isActive ? 'Active' : 'Archived'}</span>
                </div>
                <p className="text-base font-black text-ink tracking-tight group-hover:text-accent transition-colors">{p.name}</p>
                {p.description && <p className="text-[10px] font-bold text-muted mt-1 line-clamp-2">{p.description}</p>}
                <div className="flex gap-4 mt-5">
                  <div><p className="text-xl font-black text-ink">{p._count?.workingShifts ?? 0}</p><p className="label-form">Working Shifts</p></div>
                  <div><p className="text-xl font-black text-ink">{p._count?.shiftPatterns ?? 0}</p><p className="label-form">Patterns</p></div>
                  <div><p className="text-xl font-black text-ink">{p._count?.members ?? 0}</p><p className="label-form">Members</p></div>
                </div>
              </button>
            ))}
          </div>
        )}
        {projModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-shadow backdrop-">
            <div className="w-full max-w-sm bg-paper p-8">
              <h3 className="text-base font-black text-ink tracking-tighter mb-5">{projModal === 'add' ? 'New Project' : 'Edit Project'}</h3>
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[9px] font-black text-muted uppercase tracking-widest">Project Name *</label>
                  <input value={projForm.name} onChange={e => setProjForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Night Operations"
                    className="w-full px-4 py-3 bg-page border border-rule text-sm font-bold text-ink outline-none focus:border-accent transition-all" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[9px] font-black text-muted uppercase tracking-widest">Description</label>
                  <textarea value={projForm.description} onChange={e => setProjForm(f => ({ ...f, description: e.target.value }))} rows={3} placeholder="Optional description"
                    className="w-full px-4 py-3 bg-page border border-rule text-sm font-bold text-ink outline-none focus:border-accent transition-all resize-none" />
                </div>
              </div>
              <div className="flex gap-3 mt-6">
                <button onClick={() => setProjModal(null)} className="flex-1 py-3 border border-rule text-[10px] font-black uppercase tracking-widest text-muted hover:bg-page">Cancel</button>
                <button onClick={saveProject} disabled={projSaving || !projForm.name}
                  className="flex-1 py-3 bg-accent hover:bg-accent disabled:opacity-50 text-paper text-[10px] font-black uppercase tracking-widest transition-all">
                  {projSaving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Project detail view
  return (
    <div className="flex flex-col gap-5">
      {/* Breadcrumb header */}
      <div className="bg-paper border border-rule px-8 py-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button onClick={() => setSelProject(null)} className="eyebrow-tight hover:text-accent transition-colors">← Projects</button>
          <span className="text-paper">/</span>
          <h2 className="text-base font-black text-ink tracking-tight">{selProject.name}</h2>
        </div>
        <div className="flex gap-2">
          <button onClick={() => openEditProject(selProject)} className="px-4 py-2 text-[9px] font-black uppercase tracking-widest border border-rule text-muted hover:border-accent hover:text-accent transition-all">Edit</button>
          <button onClick={() => deleteProject(selProject.id)} className="px-4 py-2 text-[9px] font-black uppercase tracking-widest border border-ink text-ink hover:bg-page transition-all">Archive</button>
        </div>
      </div>

      {/* Sub-tabs */}
      <div className="flex gap-2">
        {(['working','patterns','members'] as const).map(k => (
          <button key={k} onClick={() => setSubTab(k)}
            className={`px-6 py-2.5  text-[10px] font-black uppercase tracking-widest transition-all ${subTab === k ? 'bg-accent text-paper' : 'bg-paper border border-rule text-muted hover:bg-page'}`}>
            {k === 'working' ? 'Working Shifts' : k === 'patterns' ? 'Shift Patterns' : 'Members'}
          </button>
        ))}
      </div>

      {/* Working Shifts */}
      {subTab === 'working' && (
        <div className="flex flex-col gap-4">
          <div className="flex justify-between items-center">
            <p className="eyebrow-tight">Define specific working days and hours for this project</p>
            <button onClick={openAddWs} className="px-5 py-2 bg-accent hover:bg-accent text-paper text-[9px] font-black uppercase tracking-widest transition-all">+ New Working Shift</button>
          </div>
          {wsLoading ? <div className="p-12 text-center"><div className="w-7 h-7 border-4 border-accent border-accent animate-spin mx-auto" /></div>
          : workingShifts.length === 0 ? (
            <div className="bg-paper border border-dashed border-rule p-12 text-center">
              <p className="text-sm font-black text-muted uppercase tracking-widest">No working shifts yet</p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {workingShifts.map(ws => {
                const hrs = calcHours(ws.startTime, ws.endTime, ws.breakMinutes);
                const assigned = ws.assignments?.length ?? 0;
                return (
                  <div key={ws.id} className="bg-paper border border-rule px-8 py-6">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-3 h-3 shrink-0" style={{ backgroundColor: ws.color }} />
                        <div>
                          <p className="text-sm font-black text-ink tracking-tight">{ws.name}</p>
                          <p className="text-[10px] font-bold text-muted mt-0.5 uppercase tracking-widest">{workDayLabel(ws)}</p>
                          <p className="text-[10px] font-bold text-muted mt-1">{ws.startTime} – {ws.endTime} · <span className="font-black text-ink">{hrs.toFixed(1)}h/day</span> · {ws.breakMinutes}min break · {ws.isRecurring ? 'Recurring' : 'One-time'}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                        <span className="label-form">{assigned} assigned</span>
                        <button onClick={() => openAssign('working', ws.id, ws.name)} className="px-3 py-1.5 text-[9px] font-black uppercase tracking-widest bg-page text-accent border border-accent hover:bg-page transition-all">Assign Employees</button>
                        <button onClick={() => openEditWs(ws)} className="px-3 py-1.5 text-[9px] font-black uppercase tracking-widest border border-rule text-muted hover:border-accent hover:text-accent transition-all">Edit</button>
                        <button onClick={() => deleteWs(ws.id)} className="px-3 py-1.5 text-[9px] font-black uppercase tracking-widest border border-ink text-ink hover:bg-page transition-all">Delete</button>
                      </div>
                    </div>
                    <div className="flex gap-1.5 mt-4 flex-wrap">
                      {DAY_KEYS.map((k, i) => (
                        <span key={k} className={`text-[9px] font-black px-2.5 py-1  tracking-widest uppercase ${ws[k] ? 'bg-accent text-paper' : 'bg-page text-muted'}`}>{DAY_LABELS[i]}</span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Shift Patterns */}
      {subTab === 'patterns' && (
        <div className="flex flex-col gap-4">
          <div className="flex justify-between items-center">
            <p className="eyebrow-tight">Cyclical rotation patterns — define work days and off days</p>
            <button onClick={openAddPat} className="px-5 py-2 bg-accent hover:bg-accent text-paper text-[9px] font-black uppercase tracking-widest transition-all">+ New Pattern</button>
          </div>
          {patLoading ? <div className="p-12 text-center"><div className="w-7 h-7 border-4 border-accent border-accent animate-spin mx-auto" /></div>
          : patterns.length === 0 ? (
            <div className="bg-paper border border-dashed border-rule p-12 text-center">
              <p className="text-sm font-black text-muted uppercase tracking-widest">No patterns yet</p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {patterns.map(pat => {
                const cycle = pat.workDays + pat.offDays;
                const assigned = pat.assignments?.length ?? 0;
                return (
                  <div key={pat.id} className="bg-paper border border-rule px-8 py-6 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-3 h-3 shrink-0" style={{ backgroundColor: pat.color }} />
                      <div>
                        <p className="text-sm font-black text-ink tracking-tight">{pat.name}</p>
                        <p className="text-[10px] font-bold text-muted mt-0.5 uppercase tracking-widest">
                          {pat.patternType === 'CUSTOM' ? 'Custom' : pat.patternType + ' Shift'} · {pat.workDays} on / {pat.offDays} off → {cycle}-day cycle
                        </p>
                        <p className="text-[10px] font-bold text-muted mt-1">{pat.startTime} – {pat.endTime} · <span className="font-black text-ink">{pat.hoursPerShift.toFixed(1)}h/shift</span> · {pat.breakMinutes}min break</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                      <span className="label-form">{assigned} assigned</span>
                      <button onClick={() => openAssign('pattern', pat.id, pat.name)} className="px-3 py-1.5 text-[9px] font-black uppercase tracking-widest bg-page text-accent border border-accent hover:bg-page transition-all">Assign Employees</button>
                      <button onClick={() => openEditPat(pat)} className="px-3 py-1.5 text-[9px] font-black uppercase tracking-widest border border-rule text-muted hover:border-accent hover:text-accent transition-all">Edit</button>
                      <button onClick={() => deletePat(pat.id)} className="px-3 py-1.5 text-[9px] font-black uppercase tracking-widest border border-ink text-ink hover:bg-page transition-all">Delete</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Members Tab */}
      {subTab === 'members' && (
        <div className="flex flex-col gap-4">
          <div className="flex justify-between items-center">
            <p className="eyebrow-tight">Employees assigned to this project</p>
            <button onClick={() => { setMemberForm({ employeeId: '', shiftId: '', shiftType: '', startDate: todayISO(), autoPopulate: true }); setMemberModal(true); }}
              className="px-5 py-2 bg-accent hover:bg-accent text-paper text-[9px] font-black uppercase tracking-widest transition-all">+ Add Member</button>
          </div>
          {membersLoading ? <div className="p-12 text-center"><div className="w-7 h-7 border-4 border-accent border-accent animate-spin mx-auto" /></div>
          : members.length === 0 ? (
            <div className="bg-paper border border-dashed border-rule p-12 text-center">
              <p className="text-sm font-black text-muted uppercase tracking-widest">No members yet</p>
              <p className="text-[10px] font-bold text-muted mt-1">Add employees and auto-populate their roster</p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {members.map(m => {
                const emp = employees.find(e => e.id === m.employeeId);
                const shift = m.workingShift;
                const pat = m.shiftPattern;
                return (
                  <div key={m.id} className="bg-paper border border-rule px-8 py-5 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-8 h-8 bg-shadow flex items-center justify-center text-[9px] font-black text-accent shrink-0">{getInitials(emp?.fullName ?? '?')}</div>
                      <div>
                        <p className="text-sm font-black text-ink tracking-tight">{emp?.fullName ?? m.employeeId}</p>
                        <p className="text-[9px] font-bold text-muted uppercase tracking-widest">{emp?.department} · {emp?.designation}</p>
                        {shift && (
                          <div className="flex items-center gap-1.5 mt-1">
                            <div className="w-2 h-2 shrink-0" style={{ backgroundColor: shift.color }} />
                            <p className="text-[9px] font-bold text-muted">{shift.name} · {shift.startTime}–{shift.endTime}</p>
                          </div>
                        )}
                        {pat && !shift && (
                          <div className="flex items-center gap-1.5 mt-1">
                            <div className="w-2 h-2 shrink-0" style={{ backgroundColor: pat.color }} />
                            <p className="text-[9px] font-bold text-muted">{pat.name} · Pattern</p>
                          </div>
                        )}
                        {!shift && !pat && <p className="text-[9px] font-bold text-muted mt-0.5">No shift assigned</p>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[8px] font-bold text-muted uppercase">Since {new Date(m.startDate).toLocaleDateString('en-SG', { day: 'numeric', month: 'short' })}</span>
                      <button onClick={() => removeMember(m.id)} className="px-3 py-1.5 text-[9px] font-black uppercase tracking-widest border border-ink text-ink hover:bg-page transition-all">Remove</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Add Member Modal */}
      {memberModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-shadow backdrop-">
          <div className="w-full max-w-sm bg-paper p-8">
            <h3 className="text-base font-black text-ink tracking-tighter mb-5">Add Member</h3>
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-[9px] font-black text-muted uppercase tracking-widest">Employee *</label>
                <select value={memberForm.employeeId} onChange={e => setMemberForm(f => ({ ...f, employeeId: e.target.value }))}
                  className="w-full px-4 py-3 bg-page border border-rule text-sm font-bold text-ink outline-none focus:border-accent transition-all">
                  <option value="">— Select employee —</option>
                  {employees.filter(e => !members.find(m => m.employeeId === e.id)).map(e => (
                    <option key={e.id} value={e.id}>{e.fullName} ({e.department})</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[9px] font-black text-muted uppercase tracking-widest">Assign Shift</label>
                <select
                  value={memberForm.shiftType ? `${memberForm.shiftType}:${memberForm.shiftId}` : ''}
                  onChange={e => {
                    const val = e.target.value;
                    if (!val) { setMemberForm(f => ({ ...f, shiftId: '', shiftType: '' })); return; }
                    const [type, id] = val.split(':');
                    setMemberForm(f => ({ ...f, shiftId: id, shiftType: type as 'working' | 'pattern' }));
                  }}
                  className="w-full px-4 py-3 bg-page border border-rule text-sm font-bold text-ink outline-none focus:border-accent transition-all">
                  <option value="">— None —</option>
                  {workingShifts.length > 0 && (
                    <optgroup label="Working Shifts">
                      {workingShifts.map(ws => <option key={ws.id} value={`working:${ws.id}`}>{ws.name} ({ws.startTime}–{ws.endTime})</option>)}
                    </optgroup>
                  )}
                  {patterns.length > 0 && (
                    <optgroup label="Shift Patterns">
                      {patterns.map(p => <option key={p.id} value={`pattern:${p.id}`}>{p.name} ({p.workDays} on / {p.offDays} off)</option>)}
                    </optgroup>
                  )}
                </select>
              </div>
              <div className="bg-page border border-accent px-4 py-3 flex flex-col gap-2">
                <label className="text-[9px] font-black text-accent uppercase tracking-widest">Effective Start Date *</label>
                <input type="date" value={memberForm.startDate} onChange={e => setMemberForm(f => ({ ...f, startDate: e.target.value }))}
                  className="w-full px-4 py-2.5 bg-paper border border-accent text-sm font-bold text-ink outline-none focus:border-accent transition-all" />
                <p className="text-[9px] font-bold text-accent">
                  Roster entries before this date are preserved. If re-assigning, the previous shift closes the day before.
                </p>
              </div>
              {memberForm.shiftType === 'working' && (
                <label className="flex items-center gap-3 cursor-pointer">
                  <input type="checkbox" checked={memberForm.autoPopulate} onChange={e => setMemberForm(f => ({ ...f, autoPopulate: e.target.checked }))} className="w-4 h-4 accent-accent" />
                  <span className="text-[10px] font-black text-muted uppercase tracking-widest">Auto-fill roster for next 4 weeks from start date</span>
                </label>
              )}
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setMemberModal(false)} className="flex-1 py-3 border border-rule text-[10px] font-black uppercase tracking-widest text-muted hover:bg-page">Cancel</button>
              <button onClick={addMember} disabled={memberSaving || !memberForm.employeeId}
                className="flex-1 py-3 bg-accent hover:bg-accent disabled:opacity-50 text-paper text-[10px] font-black uppercase tracking-widest transition-all">
                {memberSaving ? 'Adding…' : 'Add'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Working Shift Modal */}
      {wsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-shadow backdrop-">
          <div className="w-full max-w-md bg-paper overflow-y-auto max-h-[90vh]">
            <div className="flex items-center justify-between px-8 py-6 border-b border-rule">
              <h3 className="text-base font-black text-ink tracking-tighter">{wsModal === 'add' ? 'New Working Shift' : 'Edit Working Shift'}</h3>
              <button onClick={() => setWsModal(null)} className="w-8 h-8 flex items-center justify-center text-muted hover:bg-page transition-all">✕</button>
            </div>
            <div className="p-8 flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-[9px] font-black text-muted uppercase tracking-widest">Shift Name *</label>
                <input value={wsForm.name} onChange={e => setWsForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Morning Shift"
                  className="w-full px-4 py-3 bg-page border border-rule text-sm font-bold text-ink outline-none focus:border-accent transition-all" />
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-[9px] font-black text-muted uppercase tracking-widest">Working Days</label>
                <div className="flex gap-1.5 flex-wrap">
                  {DAY_KEYS.map((k, i) => (
                    <button key={k} type="button" onClick={() => setWsForm(f => ({ ...f, [k]: !f[k] }))}
                      className={`px-3 py-2  text-[9px] font-black uppercase tracking-widest transition-all ${wsForm[k] ? 'bg-accent text-paper' : 'bg-page text-muted hover:bg-rule'}`}>
                      {DAY_LABELS[i]}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[9px] font-black text-muted uppercase tracking-widest">Start Time</label>
                  <input type="time" value={wsForm.startTime} onChange={e => setWsForm(f => ({ ...f, startTime: e.target.value }))}
                    className="w-full px-4 py-3 bg-page border border-rule text-sm font-bold text-ink outline-none focus:border-accent transition-all" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[9px] font-black text-muted uppercase tracking-widest">End Time</label>
                  <input type="time" value={wsForm.endTime} onChange={e => setWsForm(f => ({ ...f, endTime: e.target.value }))}
                    className="w-full px-4 py-3 bg-page border border-rule text-sm font-bold text-ink outline-none focus:border-accent transition-all" />
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[9px] font-black text-muted uppercase tracking-widest">Break Duration (minutes)</label>
                <input type="number" min="0" max="120" value={wsForm.breakMinutes} onChange={e => setWsForm(f => ({ ...f, breakMinutes: e.target.value }))}
                  className="w-full px-4 py-3 bg-page border border-rule text-sm font-bold text-ink outline-none focus:border-accent transition-all" />
              </div>
              <label className="flex items-center gap-3 cursor-pointer">
                <input type="checkbox" checked={wsForm.isRecurring} onChange={e => setWsForm(f => ({ ...f, isRecurring: e.target.checked }))} className="w-4 h-4 accent-accent" />
                <span className="text-[10px] font-black text-muted uppercase tracking-widest">Recurring weekly schedule</span>
              </label>
              <div className="flex flex-col gap-2">
                <label className="text-[9px] font-black text-muted uppercase tracking-widest">Colour</label>
                <div className="flex flex-wrap gap-2">{SHIFT_COLORS.map(c => (
                  <button key={c} type="button" onClick={() => setWsForm(f => ({ ...f, color: c }))}
                    className={`w-7 h-7  transition-all ${wsForm.color === c ? 'ring-2 ring-offset-1 ring-rule scale-110' : 'hover:scale-105'}`}
                    style={{ backgroundColor: c }} />
                ))}</div>
              </div>
              {wsForm.startTime && wsForm.endTime && (
                <div className="bg-page px-4 py-3 border border-rule">
                  <p className="text-[10px] font-black text-muted uppercase tracking-widest">Preview</p>
                  <p className="text-xs font-bold text-ink mt-1">{workDayLabel(wsForm as unknown as WorkingShift)} · {wsForm.startTime}–{wsForm.endTime} · {calcHours(wsForm.startTime, wsForm.endTime, Number(wsForm.breakMinutes)).toFixed(1)}h/day</p>
                </div>
              )}
              {wsModal === 'add' && (
                <div className="flex flex-col gap-1.5 pt-1 border-t border-rule">
                  <label className="text-[9px] font-black text-muted uppercase tracking-widest">Schedule Start Date *</label>
                  <input type="date" value={wsForm.scheduleStartDate} onChange={e => setWsForm(f => ({ ...f, scheduleStartDate: e.target.value }))}
                    className="w-full px-4 py-3 bg-page border border-accent text-sm font-bold text-ink outline-none focus:border-accent transition-all" />
                  <p className="text-[9px] font-bold text-accent uppercase tracking-widest">The schedule becomes effective from this date</p>
                </div>
              )}
              <div className="flex gap-3 pt-1">
                <button onClick={() => setWsModal(null)} className="flex-1 py-3 border border-rule text-[10px] font-black uppercase tracking-widest text-muted hover:bg-page">Cancel</button>
                <button onClick={saveWs} disabled={wsSaving || !wsForm.name || (wsModal === 'add' && !wsForm.scheduleStartDate)}
                  className="flex-1 py-3 bg-accent hover:bg-accent disabled:opacity-50 text-paper text-[10px] font-black uppercase tracking-widest transition-all">
                  {wsSaving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Shift Pattern Modal */}
      {patModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-shadow backdrop-">
          <div className="w-full max-w-md bg-paper overflow-y-auto max-h-[90vh]">
            <div className="flex items-center justify-between px-8 py-6 border-b border-rule">
              <h3 className="text-base font-black text-ink tracking-tighter">{patModal === 'add' ? 'New Shift Pattern' : 'Edit Shift Pattern'}</h3>
              <button onClick={() => setPatModal(null)} className="w-8 h-8 flex items-center justify-center text-muted hover:bg-page transition-all">✕</button>
            </div>
            <div className="p-8 flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-[9px] font-black text-muted uppercase tracking-widest">Pattern Name *</label>
                <input value={patForm.name} onChange={e => setPatForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Continental 12H"
                  className="w-full px-4 py-3 bg-page border border-rule text-sm font-bold text-ink outline-none focus:border-accent transition-all" />
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-[9px] font-black text-muted uppercase tracking-widest">Shift Duration</label>
                <div className="flex gap-2 flex-wrap">
                  {(['12H','8H','6H','CUSTOM'] as const).map(pt => (
                    <button key={pt} type="button"
                      onClick={() => {
                        const preset = PATTERN_PRESETS[pt];
                        setPatForm(f => ({ ...f, patternType: pt, ...(pt !== 'CUSTOM' ? preset : {}) }));
                      }}
                      className={`px-4 py-2  text-[9px] font-black uppercase tracking-widest transition-all ${patForm.patternType === pt ? 'bg-accent text-paper' : 'bg-page text-muted hover:bg-rule'}`}>
                      {pt === 'CUSTOM' ? 'Custom' : pt + ' Shift'}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[9px] font-black text-muted uppercase tracking-widest">Work Days</label>
                  <input type="number" min="1" max="30" value={patForm.workDays} onChange={e => setPatForm(f => ({ ...f, workDays: e.target.value }))}
                    className="w-full px-4 py-3 bg-page border border-rule text-sm font-bold text-ink outline-none focus:border-accent transition-all" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[9px] font-black text-muted uppercase tracking-widest">Off Days</label>
                  <input type="number" min="1" max="30" value={patForm.offDays} onChange={e => setPatForm(f => ({ ...f, offDays: e.target.value }))}
                    className="w-full px-4 py-3 bg-page border border-rule text-sm font-bold text-ink outline-none focus:border-accent transition-all" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[9px] font-black text-muted uppercase tracking-widest">Start Time</label>
                  <input type="time" value={patForm.startTime} onChange={e => setPatForm(f => ({ ...f, startTime: e.target.value }))}
                    className="w-full px-4 py-3 bg-page border border-rule text-sm font-bold text-ink outline-none focus:border-accent transition-all" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[9px] font-black text-muted uppercase tracking-widest">End Time</label>
                  <input type="time" value={patForm.endTime} onChange={e => setPatForm(f => ({ ...f, endTime: e.target.value }))}
                    className="w-full px-4 py-3 bg-page border border-rule text-sm font-bold text-ink outline-none focus:border-accent transition-all" />
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[9px] font-black text-muted uppercase tracking-widest">Break Duration (minutes)</label>
                <input type="number" min="0" max="120" value={patForm.breakMinutes} onChange={e => setPatForm(f => ({ ...f, breakMinutes: e.target.value }))}
                  className="w-full px-4 py-3 bg-page border border-rule text-sm font-bold text-ink outline-none focus:border-accent transition-all" />
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-[9px] font-black text-muted uppercase tracking-widest">Colour</label>
                <div className="flex flex-wrap gap-2">{SHIFT_COLORS.map(c => (
                  <button key={c} type="button" onClick={() => setPatForm(f => ({ ...f, color: c }))}
                    className={`w-7 h-7  transition-all ${patForm.color === c ? 'ring-2 ring-offset-1 ring-rule scale-110' : 'hover:scale-105'}`}
                    style={{ backgroundColor: c }} />
                ))}</div>
              </div>
              {patForm.workDays && patForm.offDays && patForm.startTime && patForm.endTime && (
                <div className="bg-page px-4 py-3 border border-rule">
                  <p className="text-[10px] font-black text-muted uppercase tracking-widest">Preview</p>
                  <p className="text-xs font-bold text-ink mt-1">
                    {patForm.workDays} on / {patForm.offDays} off → {Number(patForm.workDays) + Number(patForm.offDays)}-day cycle · {calcHours(patForm.startTime, patForm.endTime, Number(patForm.breakMinutes)).toFixed(1)}h/shift
                  </p>
                </div>
              )}
              {patModal === 'add' && (
                <div className="flex flex-col gap-1.5 pt-1 border-t border-rule">
                  <label className="text-[9px] font-black text-muted uppercase tracking-widest">Schedule Start Date *</label>
                  <input type="date" value={patForm.scheduleStartDate} onChange={e => setPatForm(f => ({ ...f, scheduleStartDate: e.target.value }))}
                    className="w-full px-4 py-3 bg-page border border-accent text-sm font-bold text-ink outline-none focus:border-accent transition-all" />
                  <p className="text-[9px] font-bold text-accent uppercase tracking-widest">The schedule becomes effective from this date</p>
                </div>
              )}
              <div className="flex gap-3 pt-1">
                <button onClick={() => setPatModal(null)} className="flex-1 py-3 border border-rule text-[10px] font-black uppercase tracking-widest text-muted hover:bg-page">Cancel</button>
                <button onClick={savePat} disabled={patSaving || !patForm.name || (patModal === 'add' && !patForm.scheduleStartDate)}
                  className="flex-1 py-3 bg-accent hover:bg-accent disabled:opacity-50 text-paper text-[10px] font-black uppercase tracking-widest transition-all">
                  {patSaving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Employee Assignment Modal */}
      {assignTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-shadow backdrop-">
          <div className="w-full max-w-lg bg-paper overflow-hidden flex flex-col max-h-[85vh]">
            <div className="flex items-center justify-between px-8 py-6 border-b border-rule shrink-0">
              <div>
                <h3 className="text-base font-black text-ink tracking-tighter">Assign Employees</h3>
                <p className="eyebrow-tight mt-0.5">{assignTarget.name}</p>
              </div>
              <button onClick={() => setAssignTarget(null)} className="w-8 h-8 flex items-center justify-center text-muted hover:bg-page transition-all">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto p-8 flex flex-col gap-4">
              {/* Start Date — top of form so it's set before selecting employees */}
              <div className="bg-page border border-accent px-5 py-4 flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-[9px] font-black text-accent uppercase tracking-widest">Effective Start Date *</span>
                </div>
                <input type="date" value={assignDate} onChange={e => setAssignDate(e.target.value)}
                  className="w-full px-4 py-2.5 bg-paper border border-accent text-sm font-bold text-ink outline-none focus:border-accent transition-all" />
                <p className="text-[9px] font-bold text-accent">
                  Roster from this date onwards will be set to this shift.
                  All entries <span className="font-black">before</span> this date are kept as-is. Previous shift assignments will be automatically closed on the day before.
                </p>
              </div>

              {existingAssignments.length > 0 && (
                <div className="flex flex-col gap-2">
                  <p className="text-[9px] font-black text-muted uppercase tracking-widest">Currently Assigned ({existingAssignments.length})</p>
                  {existingAssignments.map(a => {
                    const emp = employees.find(e => e.id === a.employeeId);
                    return (
                      <div key={a.id} className="flex items-center justify-between bg-page px-4 py-2.5 border border-rule">
                        <div className="flex items-center gap-2.5">
                          <div className="w-6 h-6 bg-shadow flex items-center justify-center text-[8px] font-black text-accent">{getInitials(emp?.fullName || '?')}</div>
                          <div>
                            <p className="text-[11px] font-black text-ink">{emp?.fullName ?? a.employeeId}</p>
                            <p className="text-[9px] font-bold text-muted uppercase">{emp?.department} · Since {new Date(a.startDate).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
                          </div>
                        </div>
                        <button onClick={() => removeAssignment(a.id)} className="text-[9px] font-black uppercase text-ink hover:text-ink tracking-widest transition-all">Remove</button>
                      </div>
                    );
                  })}
                </div>
              )}
              <div className="flex flex-col gap-3 pt-2 border-t border-rule">
                <p className="text-[9px] font-black text-muted uppercase tracking-widest">Select Employees to Assign</p>
                <input value={assignSearch} onChange={e => setAssignSearch(e.target.value)} placeholder="Search by name…"
                  className="w-full px-4 py-2.5 bg-page border border-rule text-xs font-bold text-ink outline-none focus:border-accent transition-all" />
                <div className="flex flex-col gap-1 max-h-48 overflow-y-auto">
                  {availableEmps.length === 0 ? (
                    <p className="text-[10px] font-bold text-muted text-center py-4 uppercase tracking-widest">All employees already assigned</p>
                  ) : availableEmps.map(e => (
                    <label key={e.id} className="flex items-center gap-3 px-3 py-2 hover:bg-page cursor-pointer transition-all">
                      <input type="checkbox" checked={assignSelected.has(e.id)} onChange={ev => setAssignSelected(prev => { const s = new Set(prev); ev.target.checked ? s.add(e.id) : s.delete(e.id); return s; })} className="w-4 h-4 accent-accent" />
                      <div className="w-6 h-6 bg-shadow flex items-center justify-center text-[8px] font-black text-accent shrink-0">{getInitials(e.fullName)}</div>
                      <div>
                        <p className="text-[11px] font-black text-ink">{e.fullName}</p>
                        <p className="text-[9px] font-bold text-muted uppercase">{e.department}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <div className="shrink-0 px-8 py-5 border-t border-rule">
              <button onClick={saveAssignments} disabled={assignSaving || !assignSelected.size || !assignDate}
                className="w-full py-3 bg-accent hover:bg-accent disabled:opacity-50 text-paper text-[10px] font-black uppercase tracking-widest transition-all">
                {assignSaving ? 'Assigning…' : `Assign ${assignSelected.size > 0 ? assignSelected.size + ' ' : ''}Employee${assignSelected.size !== 1 ? 's' : ''} from ${assignDate || '—'}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Project edit modal when inside project detail */}
      {projModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-shadow backdrop-">
          <div className="w-full max-w-sm bg-paper p-8">
            <h3 className="text-base font-black text-ink tracking-tighter mb-5">Edit Project</h3>
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-[9px] font-black text-muted uppercase tracking-widest">Project Name *</label>
                <input value={projForm.name} onChange={e => setProjForm(f => ({ ...f, name: e.target.value }))}
                  className="w-full px-4 py-3 bg-page border border-rule text-sm font-bold text-ink outline-none focus:border-accent transition-all" />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[9px] font-black text-muted uppercase tracking-widest">Description</label>
                <textarea value={projForm.description} onChange={e => setProjForm(f => ({ ...f, description: e.target.value }))} rows={3}
                  className="w-full px-4 py-3 bg-page border border-rule text-sm font-bold text-ink outline-none focus:border-accent transition-all resize-none" />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setProjModal(null)} className="flex-1 py-3 border border-rule text-[10px] font-black uppercase tracking-widest text-muted hover:bg-page">Cancel</button>
              <button onClick={saveProject} disabled={projSaving || !projForm.name}
                className="flex-1 py-3 bg-accent hover:bg-accent disabled:opacity-50 text-paper text-[10px] font-black uppercase tracking-widest transition-all">
                {projSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
