'use client';

import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '@/lib/api';
import {
  PageHeader, Stat, DataTable, Card, CardHeader, Button, Badge, EmptyState, Field, Input, Select, Textarea, Modal, Tabs,
  SearchInput, Icon, Avatar,
  type Column, type BadgeTone,
} from '@/components/ui';

function resolveApiBase() {
  if (typeof window === 'undefined') return 'http://localhost:4000/api';
  return process.env.NEXT_PUBLIC_API_URL ?? `http://${window.location.hostname}:4000/api`;
}

type Job = {
  id: string; title: string; department: string; headcount: number; jobDescription: string;
  requirements?: string; salaryMin?: number; salaryMax?: number; jobType: string; location?: string;
  status: string; mcfJobId?: string; mcfPostedAt?: string; mcfExpiredAt?: string; fcfCompliant: boolean;
  postedById: string; createdAt: string;
  _count?: { candidates: number };
  candidates?: { stage: string }[];
};

type Candidate = {
  id: string; jobId?: string | null; firstName: string; lastName: string; email: string; phone?: string;
  currentEmployer?: string; currentTitle?: string; noticePeriod?: number; expectedSalary?: number;
  stage: string; isOfferMade: boolean; isHired: boolean; notes?: string; createdAt: string;
  resumePath?: string | null; resumeName?: string | null;
  job?: { title: string; department?: string };
  interviewRounds?: InterviewRound[];
  stageEvents?: StageEvent[];
};

type InterviewRound = {
  id: string; candidateId: string; roundName: string; scheduledAt: string;
  interviewerIds: string[]; notes?: string; result?: string; createdAt: string;
};

type StageEvent = {
  id: string; candidateId: string; fromStage?: string | null; toStage: string;
  note?: string | null; changedBy?: string | null; createdAt: string;
};

const PIPELINE_STAGES = ['APPLIED', 'SCREENING', 'INTERVIEW_1', 'INTERVIEW_2', 'ASSESSMENT', 'OFFER', 'HIRED', 'REJECTED', 'WITHDRAWN'];
const ACTIVE_STAGES   = ['APPLIED', 'SCREENING', 'INTERVIEW_1', 'INTERVIEW_2', 'ASSESSMENT', 'OFFER', 'HIRED'];

const STAGE_LABELS: Record<string, string> = {
  APPLIED: 'Applied', SCREENING: 'Screening', INTERVIEW_1: 'Interview 1', INTERVIEW_2: 'Interview 2',
  ASSESSMENT: 'Assessment', OFFER: 'Offer', HIRED: 'Hired', REJECTED: 'Rejected', WITHDRAWN: 'Withdrawn',
};

/**
 * Stage chips. The two interview rounds share a tone on purpose (same kind of
 * state, the label tells them apart), as do applied/withdrawn (both inert);
 * everything with a different consequence — an offer out, a hire, a rejection
 * — looks different.
 */
const STAGE_TONE: Record<string, BadgeTone> = {
  APPLIED:     'neutral',
  SCREENING:   'accent',
  INTERVIEW_1: 'brass',
  INTERVIEW_2: 'brass',
  ASSESSMENT:  'warn',
  OFFER:       'accent',
  HIRED:       'ok',
  REJECTED:    'danger',
  WITHDRAWN:   'neutral',
};

/**
 * A pure fill per stage for the funnel bars, column dots and tracker. It runs
 * pale to saturated along the pipeline; rejection is the danger fill and
 * withdrawal recedes into the page.
 */
const STAGE_DOT: Record<string, string> = {
  APPLIED:     'bg-rule',
  SCREENING:   'bg-faint',
  INTERVIEW_1: 'bg-accent/40',
  INTERVIEW_2: 'bg-accent/70',
  ASSESSMENT:  'bg-warn',
  OFFER:       'bg-accent',
  HIRED:       'bg-ok',
  REJECTED:    'bg-danger',
  WITHDRAWN:   'bg-pill',
};

const JOB_STATUS_LABEL: Record<string, string> = { DRAFT: 'Draft', OPEN: 'Open', FILLED: 'Filled', CANCELLED: 'Archived' };
const JOB_STATUS_TONE: Record<string, BadgeTone> = {
  DRAFT: 'brass',
  OPEN: 'ok',
  FILLED: 'accent',
  CANCELLED: 'neutral',
};

const JOB_TYPE_LABEL: Record<string, string> = { FULL_TIME: 'Full-time', PART_TIME: 'Part-time', CONTRACT: 'Contract' };

const EMPTY_JOB = { title: '', department: '', headcount: 1, jobDescription: '', requirements: '', salaryMin: '', salaryMax: '', jobType: 'FULL_TIME', location: '' };
const EMPTY_CANDIDATE = { firstName: '', lastName: '', email: '', phone: '', currentEmployer: '', currentTitle: '', noticePeriod: '', expectedSalary: '' };
const EMPTY_INTERVIEW = { roundName: '', scheduledAt: '', notes: '' };
const EMPTY_MCF = { mcfJobId: '', mcfPostedAt: '' };

const PIPELINE_SORTS = [
  { id: 'applied:desc', label: 'Newest first' },
  { id: 'applied:asc', label: 'Oldest first' },
  { id: 'name:asc', label: 'Name' },
  { id: 'salary:desc', label: 'Expected salary, high to low' },
  { id: 'notice:asc', label: 'Notice, shortest first' },
] as const;

const TAB_LABELS = { jobs: 'job openings', candidates: 'candidates', pipeline: 'pipeline', interviews: 'interviews' } as const;

export default function RecruitmentPage() {
  const [activeTab, setActiveTab] = useState<'jobs' | 'candidates' | 'pipeline' | 'interviews'>('jobs');
  const [jobs, setJobs] = useState<Job[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [interviews, setInterviews] = useState<InterviewRound[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [jobModal, setJobModal] = useState(false);
  const [editingJob, setEditingJob] = useState<Job | null>(null);
  const [jobForm, setJobForm] = useState<Record<string, string | number>>(EMPTY_JOB);
  const [jobSaving, setJobSaving] = useState(false);

  const [candidateModal, setCandidateModal] = useState(false);
  const [candidateForm, setCandidateForm] = useState<Record<string, string>>(EMPTY_CANDIDATE);
  const [candidateJobId, setCandidateJobId] = useState('');
  const [candidateSaving, setCandidateSaving] = useState(false);

  const [detailCandidate, setDetailCandidate] = useState<Candidate | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [interviewModal, setInterviewModal] = useState(false);
  const [interviewCandidateId, setInterviewCandidateId] = useState('');
  const [interviewForm, setInterviewForm] = useState<Record<string, string>>(EMPTY_INTERVIEW);
  const [interviewSaving, setInterviewSaving] = useState(false);

  const [mcfModal, setMcfModal] = useState(false);
  const [mcfJobId, setMcfJobId] = useState('');
  const [mcfForm, setMcfForm] = useState<Record<string, string>>(EMPTY_MCF);
  const [mcfSaving, setMcfSaving] = useState(false);

  const [tagJobModal, setTagJobModal] = useState<string | null>(null); // candidateId
  const [tagJobSelected, setTagJobSelected] = useState('');
  const [tagJobSaving, setTagJobSaving] = useState(false);

  const [jobSort, setJobSort]             = useState<{ col: 'title' | 'department' | 'status' | 'mcf' | 'count'; dir: 'asc' | 'desc' }>({ col: 'title', dir: 'asc' });
  const [candidateSort, setCandidateSort] = useState<{ col: 'name' | 'stage' | 'job' | 'salary' | 'notice' | 'added'; dir: 'asc' | 'desc' }>({ col: 'added', dir: 'desc' });
  const [pipelineSort, setPipelineSort]   = useState<{ col: 'name' | 'job' | 'stage' | 'salary' | 'notice' | 'applied'; dir: 'asc' | 'desc' }>({ col: 'applied', dir: 'desc' });
  const [interviewSort, setInterviewSort] = useState<{ col: 'round' | 'candidate' | 'scheduled' | 'result'; dir: 'asc' | 'desc' }>({ col: 'scheduled', dir: 'asc' });

  const [pipelineJob, setPipelineJob] = useState('');
  const [pipelineStage, setPipelineStage] = useState('');
  const [candidateSearch, setCandidateSearch] = useState('');

  const [resumeUploading, setResumeUploading] = useState<string | null>(null); // candidateId

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [jData, cData] = await Promise.all([
        apiFetch('/recruitment/jobs?limit=100'),
        apiFetch('/recruitment/candidates?limit=500'),
      ]);
      setJobs(jData.jobs || []);
      const allCandidates = cData.candidates || [];
      setCandidates(allCandidates);
      const rounds: InterviewRound[] = [];
      allCandidates.forEach((c: Candidate) => { if (c.interviewRounds) rounds.push(...c.interviewRounds); });
      setInterviews(rounds.sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime()));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Load failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function saveJob() {
    setJobSaving(true);
    try {
      const body = { ...jobForm, salaryMin: jobForm.salaryMin ? Number(jobForm.salaryMin) : undefined, salaryMax: jobForm.salaryMax ? Number(jobForm.salaryMax) : undefined, headcount: Number(jobForm.headcount) || 1 };
      const path = editingJob ? `/recruitment/jobs/${editingJob.id}` : '/recruitment/jobs';
      await apiFetch(path, { method: editingJob ? 'PUT' : 'POST', body: JSON.stringify(body) });
      setJobModal(false); setEditingJob(null); setJobForm(EMPTY_JOB);
      await load();
    } catch (e: unknown) { alert(e instanceof Error ? e.message : 'Error'); }
    finally { setJobSaving(false); }
  }

  async function archiveJob(id: string) {
    if (!confirm('Archive this job posting?')) return;
    await apiFetch(`/recruitment/jobs/${id}`, { method: 'DELETE' }).catch(() => {});
    await load();
  }

  async function saveMcf() {
    setMcfSaving(true);
    try {
      await apiFetch(`/recruitment/jobs/${mcfJobId}/fcf-compliance`, { method: 'POST', body: JSON.stringify(mcfForm) });
      setMcfModal(false); setMcfForm(EMPTY_MCF);
      await load();
    } catch (e: unknown) { alert(e instanceof Error ? e.message : 'Error'); }
    finally { setMcfSaving(false); }
  }

  async function saveCandidate() {
    setCandidateSaving(true);
    try {
      const body = { ...candidateForm, jobId: candidateJobId || undefined, noticePeriod: candidateForm.noticePeriod ? Number(candidateForm.noticePeriod) : undefined, expectedSalary: candidateForm.expectedSalary ? Number(candidateForm.expectedSalary) : undefined };
      await apiFetch('/recruitment/candidates', { method: 'POST', body: JSON.stringify(body) });
      setCandidateModal(false); setCandidateForm(EMPTY_CANDIDATE); setCandidateJobId('');
      await load();
    } catch (e: unknown) { alert(e instanceof Error ? e.message : 'Error'); }
    finally { setCandidateSaving(false); }
  }

  async function updateStage(candidateId: string, stage: string) {
    await apiFetch(`/recruitment/candidates/${candidateId}/stage`, { method: 'PUT', body: JSON.stringify({ stage }) }).catch(() => {});
    if (detailCandidate?.id === candidateId) {
      setDetailCandidate(prev => prev ? { ...prev, stage } : prev);
      await loadCandidateDetail(candidateId);
    }
    setCandidates(prev => prev.map(c => c.id === candidateId ? { ...c, stage } : c));
  }

  async function saveInterview() {
    setInterviewSaving(true);
    try {
      await apiFetch(`/recruitment/candidates/${interviewCandidateId}/interviews`, { method: 'POST', body: JSON.stringify(interviewForm) });
      setInterviewModal(false); setInterviewForm(EMPTY_INTERVIEW);
      await load();
      if (detailCandidate?.id === interviewCandidateId) await loadCandidateDetail(interviewCandidateId);
    } catch (e: unknown) { alert(e instanceof Error ? e.message : 'Error'); }
    finally { setInterviewSaving(false); }
  }

  async function loadCandidateDetail(id: string) {
    setDetailLoading(true);
    try {
      setDetailCandidate(await apiFetch(`/recruitment/candidates/${id}`));
    } catch { /* non-critical */ }
    finally { setDetailLoading(false); }
  }

  async function tagJob() {
    if (!tagJobModal) return;
    setTagJobSaving(true);
    try {
      await apiFetch(`/recruitment/candidates/${tagJobModal}/tag-job`, { method: 'POST', body: JSON.stringify({ jobId: tagJobSelected || null }) });
      setTagJobModal(null); setTagJobSelected('');
      await load();
      if (detailCandidate?.id === tagJobModal) await loadCandidateDetail(tagJobModal);
    } catch (e: unknown) { alert(e instanceof Error ? e.message : 'Error'); }
    finally { setTagJobSaving(false); }
  }

  async function uploadResume(candidateId: string, file: File) {
    setResumeUploading(candidateId);
    try {
      const fd = new FormData();
      fd.append('resume', file);
      await apiFetch(`/recruitment/candidates/${candidateId}/resume`, { method: 'POST', body: fd });
      await load();
      if (detailCandidate?.id === candidateId) await loadCandidateDetail(candidateId);
    } catch (e: unknown) { alert(e instanceof Error ? e.message : 'Upload failed'); }
    finally { setResumeUploading(null); }
  }

  async function deleteResume(candidateId: string) {
    if (!confirm('Remove this resume?')) return;
    try {
      await apiFetch(`/recruitment/candidates/${candidateId}/resume`, { method: 'DELETE' });
      await load();
      if (detailCandidate?.id === candidateId) await loadCandidateDetail(candidateId);
    } catch { /* silent */ }
  }

  function downloadResume(candidateId: string) {
    window.open(`${resolveApiBase()}/recruitment/candidates/${candidateId}/resume`, '_blank');
  }

  // ── KPIs ──────────────────────────────────────────────────────────────────
  const openJobs = jobs.filter(j => j.status === 'OPEN').length;
  const totalApplicants = candidates.length;
  const upcomingInterviews = interviews.filter(i => new Date(i.scheduledAt) >= new Date() && !i.result).length;
  const mcfCompliant = jobs.filter(j => j.status === 'OPEN' && j.mcfPostedAt).length;
  const mcfPct = openJobs > 0 ? Math.round((mcfCompliant / openJobs) * 100) : 100;

  const filteredPipeline = candidates.filter(c => {
    if (pipelineJob && c.jobId !== pipelineJob) return false;
    if (pipelineStage && c.stage !== pipelineStage) return false;
    return true;
  });

  const filteredCandidates = candidates.filter(c => {
    if (!candidateSearch) return true;
    const q = candidateSearch.toLowerCase();
    return `${c.firstName} ${c.lastName}`.toLowerCase().includes(q) || c.email.toLowerCase().includes(q) || (c.currentTitle || '').toLowerCase().includes(q) || (c.currentEmployer || '').toLowerCase().includes(q);
  });

  function mkSort<T>(dir: 'asc' | 'desc', fn: (x: T) => string | number | null | undefined) {
    return (a: T, b: T) => {
      const va = fn(a) ?? ''; const vb = fn(b) ?? '';
      const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb));
      return dir === 'asc' ? cmp : -cmp;
    };
  }

  const sortedJobs = [...jobs].sort(mkSort(jobSort.dir, j =>
    jobSort.col === 'title'      ? j.title :
    jobSort.col === 'department' ? j.department :
    jobSort.col === 'status'     ? j.status :
    jobSort.col === 'mcf'        ? (j.mcfPostedAt ? 1 : 0) :
    /* count */                    (j._count?.candidates ?? 0)
  ));

  const sortedCandidates = [...filteredCandidates].sort(mkSort(candidateSort.dir, c =>
    candidateSort.col === 'name'   ? `${c.firstName} ${c.lastName}` :
    candidateSort.col === 'stage'  ? c.stage :
    candidateSort.col === 'job'    ? (c.job?.title ?? '') :
    candidateSort.col === 'salary' ? (c.expectedSalary ?? 0) :
    candidateSort.col === 'notice' ? (c.noticePeriod ?? 0) :
    /* added */                      new Date(c.createdAt).getTime()
  ));

  const sortedPipeline = [...filteredPipeline].sort(mkSort(pipelineSort.dir, c =>
    pipelineSort.col === 'name'    ? `${c.firstName} ${c.lastName}` :
    pipelineSort.col === 'job'     ? (c.job?.title ?? jobs.find(j => j.id === c.jobId)?.title ?? '') :
    pipelineSort.col === 'stage'   ? c.stage :
    pipelineSort.col === 'salary'  ? (c.expectedSalary ?? 0) :
    pipelineSort.col === 'notice'  ? (c.noticePeriod ?? 0) :
    /* applied */                    new Date(c.createdAt).getTime()
  ));

  function toggleSort<C extends string>(
    current: { col: C; dir: 'asc' | 'desc' },
    set: React.Dispatch<React.SetStateAction<{ col: C; dir: 'asc' | 'desc' }>>,
    col: C,
  ) {
    set(prev => prev.col === col ? { col, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'asc' });
  }

  /** Sortable column header: the label is the button; the arrow appears on the active column only. */
  function sortHead<C extends string>(
    current: { col: C; dir: 'asc' | 'desc' },
    set: React.Dispatch<React.SetStateAction<{ col: C; dir: 'asc' | 'desc' }>>,
    col: C,
    label: string,
    alignEnd = false,
  ) {
    const on = current.col === col;
    return (
      <button type="button" onClick={() => toggleSort(current, set, col)} aria-sort={on ? (current.dir === 'asc' ? 'ascending' : 'descending') : undefined}
        className={`inline-flex items-center gap-1 hover:text-ink ${alignEnd ? 'justify-end w-full' : ''}`}>
        {label}
        {on && <Icon name="chevronDown" size={13} strokeWidth={2.25} className={current.dir === 'asc' ? 'rotate-180' : ''} />}
      </button>
    );
  }

  const sortedInterviews = [...interviews].sort((a, b) => {
    const dir = interviewSort.dir === 'asc' ? 1 : -1;
    if (interviewSort.col === 'round') return dir * a.roundName.localeCompare(b.roundName);
    if (interviewSort.col === 'scheduled') return dir * (new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
    if (interviewSort.col === 'result') return dir * (a.result || '').localeCompare(b.result || '');
    if (interviewSort.col === 'candidate') {
      const ca = candidates.find(c => c.id === a.candidateId);
      const cb = candidates.find(c => c.id === b.candidateId);
      const na = ca ? `${ca.firstName} ${ca.lastName}` : '';
      const nb = cb ? `${cb.firstName} ${cb.lastName}` : '';
      return dir * na.localeCompare(nb);
    }
    return 0;
  });


  function fmtDate(d?: string | null) {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-SG', { day: '2-digit', month: 'short', year: 'numeric' });
  }
  function fmtDateTime(d?: string | null) {
    if (!d) return '—';
    return new Date(d).toLocaleString('en-SG', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  }
  function mcfDaysLeft(job: Job) {
    if (!job.mcfPostedAt) return null;
    const expiry = job.mcfExpiredAt ? new Date(job.mcfExpiredAt) : new Date(new Date(job.mcfPostedAt).getTime() + 14 * 864e5);
    return Math.ceil((expiry.getTime() - Date.now()) / 864e5);
  }

  function jobStageCounts(job: Job) {
    const counts: Record<string, number> = {};
    (job.candidates || []).forEach(c => { counts[c.stage] = (counts[c.stage] || 0) + 1; });
    return counts;
  }

  // ── Small shared renderers ────────────────────────────────────────────────
  const money = (n?: number) => (n ? `S$${Number(n).toLocaleString()}` : '—');
  const fullName = (c: Candidate) => `${c.firstName} ${c.lastName}`;
  const jobTitleOf = (c: Candidate) => c.job?.title || jobs.find(j => j.id === c.jobId)?.title;

  const openNewJob = () => { setEditingJob(null); setJobForm(EMPTY_JOB); setJobModal(true); };
  const openNewCandidate = (jobId = '') => { setCandidateForm(EMPTY_CANDIDATE); setCandidateJobId(jobId); setCandidateModal(true); };
  const openInterview = (candidateId: string) => { setInterviewCandidateId(candidateId); setInterviewForm(EMPTY_INTERVIEW); setInterviewModal(true); };
  const openTagJob = (c: Candidate) => { setTagJobSelected(c.jobId || ''); setTagJobModal(c.id); };
  const openEditJob = (job: Job) => { setEditingJob(job); setJobForm({ title: job.title, department: job.department, headcount: job.headcount, jobDescription: job.jobDescription, requirements: job.requirements || '', salaryMin: job.salaryMin ?? '', salaryMax: job.salaryMax ?? '', jobType: job.jobType, location: job.location || '' }); setJobModal(true); };

  function stageSelect(c: Candidate, label = false) {
    const control = (
      <Select value={c.stage} onChange={e => updateStage(c.id, e.target.value)} aria-label={`Stage for ${fullName(c)}`}>
        {PIPELINE_STAGES.map(s => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
      </Select>
    );
    return label ? <Field label="Stage">{control}</Field> : control;
  }

  function resumeControl(c: Candidate) {
    if (c.resumeName) {
      return (
        <span className="inline-flex items-center gap-1 min-w-0">
          <button type="button" onClick={() => downloadResume(c.id)} title={c.resumeName}
            className="inline-flex items-center gap-1.5 min-w-0 text-[13px] font-semibold text-accent hover:underline">
            <Icon name="file" size={15} /><span className="truncate max-w-[110px]">{c.resumeName}</span>
          </button>
          <button type="button" onClick={() => deleteResume(c.id)} aria-label={`Remove resume ${c.resumeName}`}
            className="flex items-center justify-center w-7 h-7 rounded-control text-muted hover:text-danger hover:bg-pill">
            <Icon name="x" size={14} />
          </button>
        </span>
      );
    }
    const busy = resumeUploading === c.id;
    // The input is sr-only rather than hidden so it stays keyboard-reachable; the label draws the ring.
    return (
      <label className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-control border border-rule text-[13px] font-semibold focus-within:ring-2 focus-within:ring-accent ${busy ? 'text-muted bg-pill cursor-wait' : 'text-ink bg-paper hover:bg-pill cursor-pointer'}`}>
        <Icon name="upload" size={14} />{busy ? 'Uploading…' : 'Resume'}
        <input type="file" accept=".pdf,.doc,.docx" className="sr-only" disabled={busy}
          onChange={e => { const f = e.target.files?.[0]; if (f) uploadResume(c.id, f); e.target.value = ''; }} />
      </label>
    );
  }

  function funnel(job: Job) {
    const counts = jobStageCounts(job);
    const total = job._count?.candidates ?? 0;
    if (total === 0) return <span className="text-[13px] text-muted">No candidates yet</span>;
    const furthest = [...ACTIVE_STAGES].reverse().find(s => counts[s]);
    return (
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex items-end gap-0.5 h-6 w-[70px] shrink-0" aria-hidden="true">
          {ACTIVE_STAGES.map(s => {
            const n = counts[s] || 0;
            const pct = total > 0 ? (n / total) * 100 : 0;
            return <div key={s} title={`${STAGE_LABELS[s]}: ${n}`} className={`flex-1 ${STAGE_DOT[s]}`} style={{ height: `${Math.max(pct, n > 0 ? 18 : 6)}%` }} />;
          })}
        </div>
        <span className="text-[13px] text-ink truncate tabular-nums">
          {total} · {furthest ? `${counts[furthest]} at ${STAGE_LABELS[furthest].toLowerCase()}` : `${counts['REJECTED'] || 0} rejected`}
        </span>
      </div>
    );
  }

  function mcfCell(job: Job) {
    const daysLeft = mcfDaysLeft(job);
    if (job.mcfPostedAt) {
      return (
        <span className="inline-flex items-center gap-2">
          <Badge tone="ok">Listed</Badge>
          {daysLeft !== null && <span className="text-xs text-muted tabular-nums">{daysLeft > 0 ? `${daysLeft} days left` : 'Window closed'}</span>}
        </span>
      );
    }
    return <Button size="sm" variant="secondary" onClick={() => { setMcfJobId(job.id); setMcfForm(EMPTY_MCF); setMcfModal(true); }}>Record listing</Button>;
  }

  function jobActions(job: Job) {
    return (
      <span className="inline-flex items-center gap-1">
        <Button size="sm" variant="ghost" onClick={() => openNewCandidate(job.id)}>Add candidate</Button>
        <Button size="sm" variant="ghost" onClick={() => { setPipelineJob(job.id); setPipelineStage(''); setActiveTab('pipeline'); }}>Pipeline</Button>
        <Button size="sm" variant="ghost" onClick={() => openEditJob(job)}>Edit</Button>
        {job.status !== 'CANCELLED' && <Button size="sm" variant="danger" onClick={() => archiveJob(job.id)}>Archive</Button>}
      </span>
    );
  }

  // ── Columns ───────────────────────────────────────────────────────────────
  const jobColumns: Column<Job>[] = [
    {
      key: 'title', label: sortHead(jobSort, setJobSort, 'title', 'Job'), width: 'minmax(0, 1.5fr)',
      render: j => (
        <div className="flex flex-col min-w-0">
          <span className="font-semibold text-ink truncate">{j.title}</span>
          <span className="text-xs text-muted truncate">{j.location || 'Location not set'} · {JOB_TYPE_LABEL[j.jobType] || j.jobType} · {j.headcount} {j.headcount === 1 ? 'hire' : 'hires'}</span>
        </div>
      ),
    },
    { key: 'department', label: sortHead(jobSort, setJobSort, 'department', 'Department'), width: 'minmax(0, 0.8fr)', render: j => j.department },
    { key: 'status', label: sortHead(jobSort, setJobSort, 'status', 'Status'), width: '96px', render: j => <Badge tone={JOB_STATUS_TONE[j.status] || 'neutral'}>{JOB_STATUS_LABEL[j.status] || j.status}</Badge> },
    { key: 'mcf', label: sortHead(jobSort, setJobSort, 'mcf', 'MCF'), width: '170px', render: j => mcfCell(j) },
    { key: 'count', label: sortHead(jobSort, setJobSort, 'count', 'Candidates'), width: 'minmax(0, 1fr)', render: j => funnel(j) },
    { key: 'act', label: '', width: '330px', align: 'right', render: j => jobActions(j) },
  ];

  const nameCell = (c: Candidate) => (
    <div className="flex items-center gap-2.5 min-w-0">
      <Avatar name={fullName(c)} size={30} tone="soft" />
      <div className="flex flex-col min-w-0">
        <button type="button" onClick={() => loadCandidateDetail(c.id)} className="text-left font-semibold text-ink truncate hover:text-accent hover:underline">{fullName(c)}</button>
        <span className="text-xs text-muted truncate">{c.currentTitle ? `${c.currentTitle}${c.currentEmployer ? ` at ${c.currentEmployer}` : ''}` : c.email}</span>
      </div>
    </div>
  );

  const candidateColumns: Column<Candidate>[] = [
    { key: 'name', label: sortHead(candidateSort, setCandidateSort, 'name', 'Candidate'), width: 'minmax(0, 1.5fr)', render: nameCell },
    { key: 'stage', label: sortHead(candidateSort, setCandidateSort, 'stage', 'Stage'), width: '150px', render: c => stageSelect(c) },
    { key: 'job', label: sortHead(candidateSort, setCandidateSort, 'job', 'Job'), width: 'minmax(0, 1fr)', render: c => c.job ? c.job.title : <span className="text-muted">Unassigned</span> },
    { key: 'salary', label: sortHead(candidateSort, setCandidateSort, 'salary', 'Expected', true), width: '100px', align: 'right', numeric: true, render: c => money(c.expectedSalary) },
    { key: 'notice', label: sortHead(candidateSort, setCandidateSort, 'notice', 'Notice', true), width: '72px', align: 'right', numeric: true, render: c => c.noticePeriod ? `${c.noticePeriod}d` : '—' },
    { key: 'added', label: sortHead(candidateSort, setCandidateSort, 'added', 'Added'), width: '104px', numeric: true, render: c => fmtDate(c.createdAt) },
    { key: 'resume', label: 'Resume', width: '160px', render: c => resumeControl(c) },
    {
      key: 'act', label: '', width: '170px', align: 'right',
      render: c => (
        <span className="inline-flex items-center gap-1">
          <Button size="sm" variant="ghost" onClick={() => openTagJob(c)}>{c.jobId ? 'Re-tag' : 'Tag job'}</Button>
          <Button size="sm" variant="ghost" onClick={() => openInterview(c.id)}>Interview</Button>
        </span>
      ),
    },
  ];

  const resultBadge = (r?: string) => r
    ? <Badge tone={r === 'PASS' ? 'ok' : r === 'FAIL' ? 'danger' : 'neutral'}>{r === 'PASS' ? 'Pass' : r === 'FAIL' ? 'Fail' : r.charAt(0) + r.slice(1).toLowerCase()}</Badge>
    : <span className="text-[13px] text-muted">Pending</span>;

  const interviewColumns: Column<InterviewRound>[] = [
    { key: 'round', label: sortHead(interviewSort, setInterviewSort, 'round', 'Round'), width: 'minmax(0, 1fr)', render: ir => <span className="font-semibold">{ir.roundName}</span> },
    {
      key: 'candidate', label: sortHead(interviewSort, setInterviewSort, 'candidate', 'Candidate'), width: 'minmax(0, 1.3fr)',
      render: ir => {
        const cand = candidates.find(c => c.id === ir.candidateId);
        return cand ? (
          <div className="flex flex-col min-w-0">
            <button type="button" onClick={() => loadCandidateDetail(cand.id)} className="text-left font-semibold text-ink truncate hover:text-accent hover:underline">{fullName(cand)}</button>
            <span className="text-xs text-muted truncate">{jobTitleOf(cand) || 'Unassigned'}</span>
          </div>
        ) : <span className="text-muted">Unknown</span>;
      },
    },
    {
      key: 'scheduled', label: sortHead(interviewSort, setInterviewSort, 'scheduled', 'Scheduled'), width: '210px',
      render: ir => {
        const isPast = new Date(ir.scheduledAt) < new Date();
        return <span className="inline-flex items-center gap-2"><span className={`tabular-nums ${isPast ? 'text-muted' : 'text-ink'}`}>{fmtDateTime(ir.scheduledAt)}</span>{!isPast && <Badge tone="accent">Upcoming</Badge>}</span>;
      },
    },
    { key: 'notes', label: 'Notes', width: 'minmax(0, 1.2fr)', render: ir => <span className="text-muted">{ir.notes || '—'}</span> },
    { key: 'result', label: sortHead(interviewSort, setInterviewSort, 'result', 'Result'), width: '100px', render: ir => resultBadge(ir.result) },
  ];

  const noRows = (icon: 'briefcase' | 'users' | 'calendar', title: string, description: string, action?: React.ReactNode) =>
    <EmptyState icon={icon} title={title} description={description} action={action} className="py-6" />;

  // ── Candidate record ──────────────────────────────────────────────────────
  if (detailCandidate || detailLoading) {
    const back = (
      <button type="button" onClick={() => setDetailCandidate(null)} className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-accent hover:underline self-start">
        <Icon name="chevronRight" size={15} strokeWidth={2} className="rotate-180" />Back to {TAB_LABELS[activeTab]}
      </button>
    );
    const d = detailCandidate;
    return (
      <div className="flex flex-col gap-6 max-w-[1400px] mx-auto pb-24 lg:pb-10">
        {back}
        {detailLoading || !d ? (
          <div className="flex flex-col gap-4" aria-busy="true">
            <div className="h-16 rounded-card bg-pill animate-pulse" />
            <div className="h-72 rounded-card bg-pill animate-pulse" />
          </div>
        ) : (
          <>
            {/* Identity band */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-4 min-w-0">
                <Avatar name={fullName(d)} size={56} tone="soft" />
                <div className="flex flex-col gap-1.5 min-w-0">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <h1 className="text-2xl font-extrabold tracking-[-0.02em] text-ink truncate">{fullName(d)}</h1>
                    <Badge tone={STAGE_TONE[d.stage] || 'neutral'}>{STAGE_LABELS[d.stage] || d.stage}</Badge>
                    {d.isHired && <Badge tone="ok">Hired</Badge>}
                    {d.isOfferMade && !d.isHired && <Badge tone="accent">Offer made</Badge>}
                  </div>
                  <p className="text-sm text-muted truncate">
                    {[d.job?.title, d.email, d.phone].filter(Boolean).join(' · ')}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2.5">
                <Button variant="secondary" onClick={() => openTagJob(d)}>{d.jobId ? 'Change job' : 'Tag job'}</Button>
                <Button icon="calendar" onClick={() => openInterview(d.id)}>Schedule interview</Button>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
              {/* Main */}
              <div className="lg:col-span-2 flex flex-col gap-4">
                <Card>
                  <CardHeader title="Stage" caption="Where this candidate is, and when they got there." />
                  <ol className="flex flex-col">
                    {PIPELINE_STAGES.filter(s => s !== 'WITHDRAWN').map((s, i, arr) => {
                      const stageOrder = ['APPLIED', 'SCREENING', 'INTERVIEW_1', 'INTERVIEW_2', 'ASSESSMENT', 'OFFER', 'HIRED', 'REJECTED'];
                      const currentIdx = stageOrder.indexOf(d.stage);
                      const thisIdx = stageOrder.indexOf(s);
                      const isCurrent = d.stage === s;
                      const isPast = thisIdx < currentIdx && !['REJECTED'].includes(d.stage);
                      const event = d.stageEvents?.find(e => e.toStage === s);
                      return (
                        <li key={s} className="flex items-stretch gap-3" aria-current={isCurrent ? 'step' : undefined}>
                          <div className="flex flex-col items-center w-[18px] shrink-0">
                            <span className={`mt-[3px] w-[14px] h-[14px] rounded-full border-2 shrink-0 ${isCurrent ? `${STAGE_DOT[s]} border-transparent ring-2 ring-accent/30` : isPast ? 'bg-accent border-accent' : 'bg-paper border-rule'}`} />
                            {i < arr.length - 1 && <span className={`flex-1 w-0.5 my-0.5 ${isPast ? 'bg-accent' : 'bg-rule'}`} />}
                          </div>
                          <div className="flex-1 min-w-0 pb-3">
                            <div className="flex items-center justify-between gap-3">
                              <span className={`text-sm ${isCurrent ? 'font-bold text-ink' : isPast ? 'text-ink' : 'text-muted'}`}>{STAGE_LABELS[s]}</span>
                              {event ? <span className="text-xs text-muted tabular-nums">{fmtDate(event.createdAt)}</span>
                                : isCurrent ? <span className="text-xs font-semibold text-accent">Current</span> : null}
                            </div>
                            {event?.note && <p className="text-[13px] text-muted mt-0.5">{event.note}</p>}
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                  <div className="flex flex-col gap-2 pt-3 mt-1 border-t border-rule">
                    <span className="text-[12.5px] font-semibold text-muted">Move to</span>
                    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Move to stage">
                      {PIPELINE_STAGES.map(s => {
                        const on = d.stage === s;
                        return (
                          <button key={s} type="button" onClick={() => updateStage(d.id, s)} aria-pressed={on}
                            className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-control border text-[13px] font-semibold transition-colors ${on ? 'border-accent bg-tint text-accent' : 'border-rule bg-paper text-ink hover:bg-pill'}`}>
                            <span className={`w-2 h-2 rounded-full ${STAGE_DOT[s]}`} aria-hidden="true" />{STAGE_LABELS[s]}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </Card>

                <Card>
                  <CardHeader title="Interviews" action={<button type="button" onClick={() => openInterview(d.id)} className="hover:underline">Schedule</button>} />
                  {!d.interviewRounds?.length ? (
                    <p className="text-sm text-muted">No interviews scheduled yet.</p>
                  ) : (
                    <ul className="flex flex-col divide-y divide-rule">
                      {d.interviewRounds.map(ir => (
                        <li key={ir.id} className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
                          <div className="flex flex-col gap-0.5 min-w-0">
                            <span className="text-sm font-semibold text-ink">{ir.roundName}</span>
                            <span className="text-xs text-muted tabular-nums">{fmtDateTime(ir.scheduledAt)}</span>
                            {ir.notes && <span className="text-[13px] text-muted">{ir.notes}</span>}
                          </div>
                          {resultBadge(ir.result)}
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>

                {d.stageEvents && d.stageEvents.length > 1 && (
                  <Card>
                    <CardHeader title="Activity" />
                    <ul className="flex flex-col gap-3">
                      {[...d.stageEvents].reverse().map(ev => (
                        <li key={ev.id} className="flex items-start gap-3">
                          <span className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${STAGE_DOT[ev.toStage] || 'bg-rule'}`} aria-hidden="true" />
                          <div className="flex flex-col gap-0.5">
                            <span className="text-sm text-ink">
                              {ev.fromStage ? `${STAGE_LABELS[ev.fromStage] || ev.fromStage} → ${STAGE_LABELS[ev.toStage] || ev.toStage}` : `Added as ${STAGE_LABELS[ev.toStage] || ev.toStage}`}
                            </span>
                            {ev.note && <span className="text-[13px] text-muted">{ev.note}</span>}
                            <span className="text-xs text-muted tabular-nums">{fmtDateTime(ev.createdAt)}</span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </Card>
                )}
              </div>

              {/* Side */}
              <div className="flex flex-col gap-4">
                <Card>
                  <CardHeader title="Details" />
                  <dl className="flex flex-col text-sm">
                    {[
                      ['Current title', d.currentTitle || '—'],
                      ['Current employer', d.currentEmployer || '—'],
                      ['Expected salary', money(d.expectedSalary)],
                      ['Notice period', d.noticePeriod ? `${d.noticePeriod} days` : '—'],
                      ['Added', fmtDate(d.createdAt)],
                    ].map(([k, v]) => (
                      <div key={k} className="flex justify-between gap-4 py-2.5 border-t border-rule first:border-t-0">
                        <dt className="text-muted">{k}</dt>
                        <dd className="font-semibold text-ink text-right tabular-nums">{v}</dd>
                      </div>
                    ))}
                  </dl>
                </Card>

                <Card>
                  <CardHeader title="Job" action={<button type="button" onClick={() => openTagJob(d)} className="hover:underline">{d.jobId ? 'Change' : 'Tag job'}</button>} />
                  {d.job ? (
                    <div className="flex flex-col gap-0.5">
                      <span className="text-sm font-semibold text-ink">{d.job.title}</span>
                      {d.job.department && <span className="text-[13px] text-muted">{d.job.department}</span>}
                    </div>
                  ) : <p className="text-sm text-muted">In the candidate pool, not tagged to an opening.</p>}
                </Card>

                <Card>
                  <CardHeader title="Resume" action={d.resumeName ? <button type="button" onClick={() => deleteResume(d.id)} className="text-danger hover:underline">Remove</button> : undefined} />
                  {d.resumeName ? (
                    <button type="button" onClick={() => downloadResume(d.id)}
                      className="flex items-center gap-3 p-3 rounded-control border border-rule bg-page hover:border-accent text-left">
                      <span className="flex items-center justify-center w-9 h-9 rounded-control bg-paper border border-rule text-muted shrink-0"><Icon name="file" size={18} /></span>
                      <span className="flex flex-col min-w-0">
                        <span className="text-sm font-semibold text-ink truncate">{d.resumeName}</span>
                        <span className="text-xs text-muted">Download</span>
                      </span>
                    </button>
                  ) : (
                    <label className={`flex flex-col items-center justify-center gap-1 p-5 rounded-control border-2 border-dashed text-center focus-within:ring-2 focus-within:ring-accent ${resumeUploading === d.id ? 'border-rule bg-page cursor-wait' : 'border-rule hover:border-accent cursor-pointer'}`}>
                      <Icon name="upload" size={20} className="text-muted" />
                      <span className={`text-sm font-semibold ${resumeUploading === d.id ? 'text-muted' : 'text-accent'}`}>{resumeUploading === d.id ? 'Uploading…' : 'Upload resume'}</span>
                      <span className="text-xs text-muted">PDF, DOC or DOCX, up to 10 MB</span>
                      <input type="file" accept=".pdf,.doc,.docx" className="sr-only" disabled={resumeUploading === d.id}
                        onChange={e => { const f = e.target.files?.[0]; if (f) uploadResume(d.id, f); e.target.value = ''; }} />
                    </label>
                  )}
                </Card>

                {d.notes && (
                  <Card>
                    <CardHeader title="Notes" />
                    <p className="text-sm text-ink leading-relaxed whitespace-pre-line">{d.notes}</p>
                  </Card>
                )}
              </div>
            </div>
          </>
        )}
        {modals()}
      </div>
    );
  }

  // ── Modals (rendered on both the list and the record) ─────────────────────
  function modals() {
    const interviewCand = candidates.find(x => x.id === interviewCandidateId);
    const jobMissing = !jobForm.title || !jobForm.department || !jobForm.jobDescription;
    const candMissing = !candidateForm.firstName || !candidateForm.lastName || !candidateForm.email;
    const intMissing = !interviewForm.roundName || !interviewForm.scheduledAt;
    return (
      <>
        <Modal
          open={!!tagJobModal}
          onClose={() => setTagJobModal(null)}
          title="Tag to a job opening"
          caption="Choosing no job moves the candidate back to the pool."
          footer={<>
            <Button variant="secondary" onClick={() => setTagJobModal(null)}>Cancel</Button>
            <Button onClick={tagJob} disabled={tagJobSaving}>{tagJobSaving ? 'Saving…' : 'Save'}</Button>
          </>}
        >
          <Field label="Job opening">
            <Select value={tagJobSelected} onChange={e => setTagJobSelected(e.target.value)}>
              <option value="">No job (candidate pool)</option>
              {jobs.filter(j => j.status !== 'CANCELLED').map(j => <option key={j.id} value={j.id}>{j.title} · {j.department}</option>)}
            </Select>
          </Field>
        </Modal>

        <Modal
          open={jobModal}
          size="lg"
          onClose={() => { setJobModal(false); setEditingJob(null); }}
          title={editingJob ? 'Edit job opening' : 'New job opening'}
          footer={<>
            <Button variant="secondary" onClick={() => { setJobModal(false); setEditingJob(null); }}>Cancel</Button>
            <Button onClick={saveJob} disabled={jobSaving || jobMissing} reason={jobMissing && !jobSaving ? 'Title, department and description are required' : undefined}>
              {jobSaving ? 'Saving…' : editingJob ? 'Save changes' : 'Create opening'}
            </Button>
          </>}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Job title" required className="sm:col-span-2">
              <Input value={String(jobForm.title || '')} onChange={e => setJobForm(p => ({ ...p, title: e.target.value }))} placeholder="e.g. Senior software engineer" />
            </Field>
            <Field label="Department" required>
              <Input value={String(jobForm.department || '')} onChange={e => setJobForm(p => ({ ...p, department: e.target.value }))} placeholder="e.g. Engineering" />
            </Field>
            <Field label="Headcount">
              <Input type="number" min={1} value={String(jobForm.headcount || 1)} onChange={e => setJobForm(p => ({ ...p, headcount: e.target.value }))} />
            </Field>
            <Field label="Job type">
              <Select value={String(jobForm.jobType || 'FULL_TIME')} onChange={e => setJobForm(p => ({ ...p, jobType: e.target.value }))}>
                <option value="FULL_TIME">Full-time</option>
                <option value="PART_TIME">Part-time</option>
                <option value="CONTRACT">Contract</option>
              </Select>
            </Field>
            <Field label="Location">
              <Input value={String(jobForm.location || '')} onChange={e => setJobForm(p => ({ ...p, location: e.target.value }))} placeholder="e.g. Singapore CBD" />
            </Field>
            <Field label="Salary from (SGD)">
              <Input type="number" value={String(jobForm.salaryMin || '')} onChange={e => setJobForm(p => ({ ...p, salaryMin: e.target.value }))} placeholder="e.g. 4000" />
            </Field>
            <Field label="Salary to (SGD)">
              <Input type="number" value={String(jobForm.salaryMax || '')} onChange={e => setJobForm(p => ({ ...p, salaryMax: e.target.value }))} placeholder="e.g. 8000" />
            </Field>
            <Field label="Job description" required className="sm:col-span-2" help="The role, the responsibilities, what they will work on.">
              <Textarea rows={5} value={String(jobForm.jobDescription || '')} onChange={e => setJobForm(p => ({ ...p, jobDescription: e.target.value }))} />
            </Field>
            <Field label="Requirements" className="sm:col-span-2" help="Skills, qualifications and experience.">
              <Textarea rows={3} value={String(jobForm.requirements || '')} onChange={e => setJobForm(p => ({ ...p, requirements: e.target.value }))} />
            </Field>
          </div>
        </Modal>

        <Modal
          open={mcfModal}
          onClose={() => setMcfModal(false)}
          title="Record MCF listing"
          caption="Fair Consideration Framework: list on MyCareersFuture for at least 14 days before shortlisting."
          footer={<>
            <Button variant="secondary" onClick={() => setMcfModal(false)}>Cancel</Button>
            <Button onClick={saveMcf} disabled={mcfSaving || !mcfForm.mcfPostedAt} reason={!mcfForm.mcfPostedAt && !mcfSaving ? 'Enter the date posted' : undefined}>{mcfSaving ? 'Saving…' : 'Record listing'}</Button>
          </>}
        >
          <div className="flex flex-col gap-4">
            <Field label="MCF job ID" help="The reference shown on MyCareersFuture">
              <Input value={mcfForm.mcfJobId} onChange={e => setMcfForm(p => ({ ...p, mcfJobId: e.target.value }))} placeholder="MCF-2026-XXXXXX" />
            </Field>
            <Field label="Date posted on MCF" required>
              <Input type="date" value={mcfForm.mcfPostedAt} onChange={e => setMcfForm(p => ({ ...p, mcfPostedAt: e.target.value }))} />
            </Field>
          </div>
        </Modal>

        <Modal
          open={candidateModal}
          onClose={() => setCandidateModal(false)}
          title="Add candidate"
          footer={<>
            <Button variant="secondary" onClick={() => setCandidateModal(false)}>Cancel</Button>
            <Button onClick={saveCandidate} disabled={candidateSaving || candMissing} reason={candMissing && !candidateSaving ? 'Name and email are required' : undefined}>{candidateSaving ? 'Adding…' : 'Add candidate'}</Button>
          </>}
        >
          <div className="flex flex-col gap-4">
            <Field label="Job opening" help="Optional. You can tag a job later.">
              <Select value={candidateJobId} onChange={e => setCandidateJobId(e.target.value)}>
                <option value="">Add to candidate pool</option>
                {jobs.filter(j => j.status !== 'CANCELLED').map(j => <option key={j.id} value={j.id}>{j.title}</option>)}
              </Select>
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {[
                { key: 'firstName', label: 'First name', type: 'text', required: true },
                { key: 'lastName', label: 'Last name', type: 'text', required: true },
                { key: 'email', label: 'Email', type: 'email', required: true },
                { key: 'phone', label: 'Phone', type: 'tel', placeholder: '+65 9123 4567' },
                { key: 'currentTitle', label: 'Current title', type: 'text' },
                { key: 'currentEmployer', label: 'Current employer', type: 'text' },
                { key: 'expectedSalary', label: 'Expected salary (SGD)', type: 'number' },
                { key: 'noticePeriod', label: 'Notice period (days)', type: 'number' },
              ].map(f => (
                <Field key={f.key} label={f.label} required={f.required}>
                  <Input type={f.type} value={candidateForm[f.key] || ''} onChange={e => setCandidateForm(p => ({ ...p, [f.key]: e.target.value }))} placeholder={f.placeholder} />
                </Field>
              ))}
            </div>
          </div>
        </Modal>

        <Modal
          open={interviewModal}
          onClose={() => setInterviewModal(false)}
          title="Schedule interview"
          caption={interviewCand ? `For ${fullName(interviewCand)}` : undefined}
          footer={<>
            <Button variant="secondary" onClick={() => setInterviewModal(false)}>Cancel</Button>
            <Button onClick={saveInterview} disabled={interviewSaving || intMissing} reason={intMissing && !interviewSaving ? 'Round name and time are required' : undefined}>{interviewSaving ? 'Scheduling…' : 'Schedule interview'}</Button>
          </>}
        >
          <div className="flex flex-col gap-4">
            <Field label="Round" required>
              <Input value={interviewForm.roundName} onChange={e => setInterviewForm(p => ({ ...p, roundName: e.target.value }))} placeholder="e.g. Technical screen, final round" />
            </Field>
            <Field label="Date and time" required>
              <Input type="datetime-local" value={interviewForm.scheduledAt} onChange={e => setInterviewForm(p => ({ ...p, scheduledAt: e.target.value }))} />
            </Field>
            <Field label="Notes" help="Location, topics, instructions for the panel.">
              <Textarea rows={3} value={interviewForm.notes} onChange={e => setInterviewForm(p => ({ ...p, notes: e.target.value }))} />
            </Field>
          </div>
        </Modal>
      </>
    );
  }

  // ── Pipeline columns ──────────────────────────────────────────────────────
  const pipelineCols = pipelineStage ? [pipelineStage] : PIPELINE_STAGES;
  const pipelineSortId = `${pipelineSort.col}:${pipelineSort.dir}`;

  return (
    <div className="flex flex-col gap-6 max-w-[1600px] mx-auto pb-24 lg:pb-10">
      <PageHeader
        title="Recruitment"
        subtitle={loading ? 'Loading…' : `${openJobs} open ${openJobs === 1 ? 'position' : 'positions'} · ${totalApplicants} candidates · ${upcomingInterviews} interviews ahead`}
        actions={<>
          <Button variant="secondary" icon="plus" onClick={() => openNewCandidate()}>Add candidate</Button>
          <Button icon="plus" onClick={openNewJob}>New job opening</Button>
        </>}
      />

      {error && (
        <div role="alert" className="flex items-start gap-2.5 p-3.5 rounded-control border border-rule bg-danger-bg text-danger">
          <Icon name="alert" size={18} className="mt-0.5" />
          <div className="flex flex-col gap-1">
            <span className="text-sm font-semibold">Recruitment data did not load</span>
            <span className="text-[13px] text-ink">{error}</span>
          </div>
          <Button size="sm" variant="secondary" className="ml-auto" onClick={load}>Retry</Button>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <Stat label="Open positions" value={loading ? '—' : openJobs} note={`${jobs.filter(j => j.status === 'DRAFT').length} drafts`} />
        <Stat label="Candidates" value={loading ? '—' : totalApplicants} note={`${candidates.filter(c => c.stage === 'HIRED').length} hired · ${candidates.filter(c => !c.jobId).length} in pool`} />
        <Stat label="Upcoming interviews" value={loading ? '—' : upcomingInterviews} note="Scheduled, no result yet" />
        <Stat label="MCF compliance" value={loading ? '—' : `${mcfPct}%`} note={`${mcfCompliant} of ${openJobs} open ads listed`} />
      </div>

      <Tabs
        items={[
          { id: 'jobs' as const, label: 'Job openings', count: jobs.length },
          { id: 'candidates' as const, label: 'Candidates', count: candidates.length },
          { id: 'pipeline' as const, label: 'Pipeline' },
          { id: 'interviews' as const, label: 'Interviews', count: upcomingInterviews || undefined },
        ]}
        active={activeTab}
        onChange={setActiveTab}
      />

      {loading ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          {[1, 2, 3, 4, 5].map(i => <div key={i} className="h-[52px] bg-pill rounded-card animate-pulse" />)}
        </div>
      ) : (
        <>
          {/* ── Job openings ─────────────────────────────────────────────────── */}
          {activeTab === 'jobs' && (
            <DataTable
              aria-label="Job openings"
              columns={jobColumns}
              rows={sortedJobs}
              rowKey={j => j.id}
              rowHeight={60}
              empty={noRows('briefcase', 'No job openings yet', 'Create an opening to start collecting candidates.', <Button icon="plus" onClick={openNewJob}>New job opening</Button>)}
              mobileCard={j => (
                <div className="flex flex-col gap-2.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex flex-col min-w-0">
                      <span className="font-semibold text-ink">{j.title}</span>
                      <span className="text-xs text-muted">{j.department} · {j.location || 'Location not set'} · {j.headcount} {j.headcount === 1 ? 'hire' : 'hires'}</span>
                    </div>
                    <Badge tone={JOB_STATUS_TONE[j.status] || 'neutral'}>{JOB_STATUS_LABEL[j.status] || j.status}</Badge>
                  </div>
                  {funnel(j)}
                  {mcfCell(j)}
                  <div className="-ml-3 flex flex-wrap">{jobActions(j)}</div>
                </div>
              )}
              footer={<span className="tabular-nums">{jobs.length} opening{jobs.length === 1 ? '' : 's'}</span>}
            />
          )}

          {/* ── Candidates ───────────────────────────────────────────────────── */}
          {activeTab === 'candidates' && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <SearchInput value={candidateSearch} onChange={e => setCandidateSearch(e.target.value)} placeholder="Search name, email, title, employer…" aria-label="Search candidates" className="sm:w-80" />
                <span className="sm:ml-auto text-[13px] text-muted tabular-nums">{filteredCandidates.length} shown · {candidates.filter(c => !c.jobId).length} unassigned</span>
              </div>
              <DataTable
                aria-label="Candidates"
                columns={candidateColumns}
                rows={sortedCandidates}
                rowKey={c => c.id}
                empty={candidateSearch
                  ? noRows('users', 'No matching candidates', `Nothing matches “${candidateSearch}”.`, <Button variant="secondary" onClick={() => setCandidateSearch('')}>Clear search</Button>)
                  : noRows('users', 'No candidates yet', 'Add candidates to a job opening or to the general pool.', <Button icon="plus" onClick={() => openNewCandidate()}>Add candidate</Button>)}
                mobileCard={c => (
                  <div className="flex flex-col gap-2.5">
                    <div className="flex items-start justify-between gap-3">
                      {nameCell(c)}
                      <Badge tone={STAGE_TONE[c.stage] || 'neutral'}>{STAGE_LABELS[c.stage] || c.stage}</Badge>
                    </div>
                    <span className="text-xs text-muted tabular-nums">{c.job?.title || 'Unassigned'} · {money(c.expectedSalary)} · {c.noticePeriod ? `${c.noticePeriod}d notice` : 'notice not given'}</span>
                    {stageSelect(c)}
                    <div className="flex flex-wrap items-center gap-1">
                      {resumeControl(c)}
                      <Button size="sm" variant="ghost" onClick={() => openTagJob(c)}>{c.jobId ? 'Re-tag' : 'Tag job'}</Button>
                      <Button size="sm" variant="ghost" onClick={() => openInterview(c.id)}>Interview</Button>
                    </div>
                  </div>
                )}
              />
            </div>
          )}

          {/* ── Pipeline: one column per stage ───────────────────────────────── */}
          {activeTab === 'pipeline' && (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:max-w-[760px]">
                <Field label="Job opening">
                  <Select value={pipelineJob} onChange={e => setPipelineJob(e.target.value)}>
                    <option value="">All job openings</option>
                    {jobs.map(j => <option key={j.id} value={j.id}>{j.title}</option>)}
                  </Select>
                </Field>
                <Field label="Stage">
                  <Select value={pipelineStage} onChange={e => setPipelineStage(e.target.value)}>
                    <option value="">All stages</option>
                    {PIPELINE_STAGES.map(s => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
                  </Select>
                </Field>
                <Field label="Sort">
                  <Select value={pipelineSortId} onChange={e => { const [col, dir] = e.target.value.split(':'); setPipelineSort({ col: col as typeof pipelineSort.col, dir: dir as 'asc' | 'desc' }); }}>
                    {!PIPELINE_SORTS.some(s => s.id === pipelineSortId) && <option value={pipelineSortId}>Custom</option>}
                    {PIPELINE_SORTS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                  </Select>
                </Field>
              </div>

              {filteredPipeline.length === 0 ? (
                <Card>{noRows('users', 'No candidates in the pipeline', pipelineJob || pipelineStage ? 'Nothing matches these filters.' : 'Candidates appear here once they are added.',
                  pipelineJob || pipelineStage ? <Button variant="secondary" onClick={() => { setPipelineJob(''); setPipelineStage(''); }}>Clear filters</Button> : undefined)}</Card>
              ) : (
                <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1 snap-x" aria-label="Pipeline by stage">
                  {pipelineCols.map(s => {
                    const inStage = sortedPipeline.filter(c => c.stage === s);
                    return (
                      <section key={s} aria-label={`${STAGE_LABELS[s]}, ${inStage.length}`} className="flex flex-col gap-2 w-[82vw] sm:w-[264px] shrink-0 snap-start p-2.5 rounded-card bg-pill">
                        <header className="flex items-center justify-between gap-2 px-1.5 py-1">
                          <span className="inline-flex items-center gap-2 text-[13.5px] font-bold text-ink">
                            <span className={`w-2.5 h-2.5 rounded-full ${STAGE_DOT[s]} ring-1 ring-rule`} aria-hidden="true" />{STAGE_LABELS[s]}
                          </span>
                          <span className="text-xs font-semibold text-muted tabular-nums">{inStage.length}</span>
                        </header>
                        {inStage.length === 0 ? (
                          <p className="px-1.5 py-3 text-[13px] text-muted">No one at this stage</p>
                        ) : inStage.map(c => (
                          <Card key={c.id} padding="p-3" className="gap-2.5">
                            <div className="flex items-start gap-2.5 min-w-0">
                              <Avatar name={fullName(c)} size={28} tone="soft" />
                              <div className="flex flex-col min-w-0">
                                <button type="button" onClick={() => loadCandidateDetail(c.id)} className="text-left text-sm font-semibold text-ink truncate hover:text-accent hover:underline">{fullName(c)}</button>
                                <span className="text-xs text-muted truncate">{jobTitleOf(c) || 'Unassigned'}</span>
                              </div>
                            </div>
                            <div className="flex items-center justify-between gap-2 text-xs text-muted tabular-nums">
                              <span>{money(c.expectedSalary)}</span>
                              <span>{c.noticePeriod ? `${c.noticePeriod}d notice` : 'No notice given'}</span>
                              <span>{fmtDate(c.createdAt)}</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <div className="flex-1 min-w-0">{stageSelect(c)}</div>
                              <Button size="sm" variant="ghost" onClick={() => openInterview(c.id)} aria-label={`Schedule interview for ${fullName(c)}`} icon="calendar">
                                <span className="sr-only">Interview</span>
                              </Button>
                            </div>
                          </Card>
                        ))}
                      </section>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── Interviews ───────────────────────────────────────────────────── */}
          {activeTab === 'interviews' && (
            <DataTable
              aria-label="Interviews"
              columns={interviewColumns}
              rows={sortedInterviews}
              rowKey={ir => ir.id}
              empty={noRows('calendar', 'No interviews scheduled', 'Schedule a round from a candidate’s record or the candidates list.')}
              mobileCard={ir => {
                const cand = candidates.find(c => c.id === ir.candidateId);
                const isPast = new Date(ir.scheduledAt) < new Date();
                return (
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex flex-col gap-0.5 min-w-0">
                      <span className="font-semibold text-ink">{ir.roundName}</span>
                      {cand && <button type="button" onClick={() => loadCandidateDetail(cand.id)} className="text-left text-sm text-accent hover:underline truncate">{fullName(cand)}</button>}
                      <span className={`text-xs tabular-nums ${isPast ? 'text-muted' : 'text-ink'}`}>{fmtDateTime(ir.scheduledAt)}{!isPast ? ' · upcoming' : ''}</span>
                    </div>
                    {resultBadge(ir.result)}
                  </div>
                );
              }}
            />
          )}
        </>
      )}

      {modals()}
    </div>
  );
}
