'use client';

import { useState, useEffect, useCallback } from 'react';
import { TONES } from '@/lib/statusTone';
import { apiFetch } from '@/lib/api';

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
const STAGE_COLORS: Record<string, string> = {
  APPLIED:     TONES.neutral,
  SCREENING:   TONES.pending,
  INTERVIEW_1: TONES.active,
  INTERVIEW_2: TONES.active,
  ASSESSMENT:  TONES.warning,
  OFFER:       TONES.approved,
  HIRED:       TONES.done,
  REJECTED:    TONES.critical,
  WITHDRAWN:   TONES.inert,
};
/**
 * A pure FILL per hiring stage — not a TONES chip.
 *
 * STAGE_DOT is used three ways: as a funnel bar, as a step marker that sets its
 * own `border-transparent`, and as a 6px dot. All three need a background and
 * nothing else, so the chip tones (which carry border, text and weight) do not
 * apply here. The ramp runs pale to saturated along the pipeline, with
 * rejection as ink and withdrawal receding into the page.
 */
const STAGE_DOT: Record<string, string> = {
  APPLIED:     'bg-rule',
  SCREENING:   'bg-muted',
  INTERVIEW_1: 'bg-accent/40',
  INTERVIEW_2: 'bg-accent/70',
  ASSESSMENT:  'bg-highlight/70',
  OFFER:       'bg-highlight',
  HIRED:       'bg-accent',
  REJECTED:    'bg-ink',
  WITHDRAWN:   'bg-page',
};

const JOB_STATUS_FLOW = ['DRAFT', 'OPEN', 'FILLED', 'CANCELLED'];
const JOB_STATUS_COLORS: Record<string, string> = {
  DRAFT: TONES.neutral,
  OPEN: TONES.active,
  FILLED: TONES.critical,
  CANCELLED: TONES.inert,
};

const EMPTY_JOB = { title: '', department: '', headcount: 1, jobDescription: '', requirements: '', salaryMin: '', salaryMax: '', jobType: 'FULL_TIME', location: '' };
const EMPTY_CANDIDATE = { firstName: '', lastName: '', email: '', phone: '', currentEmployer: '', currentTitle: '', noticePeriod: '', expectedSalary: '' };
const EMPTY_INTERVIEW = { roundName: '', scheduledAt: '', notes: '' };
const EMPTY_MCF = { mcfJobId: '', mcfPostedAt: '' };

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

  function SortIcon({ active, dir }: { active: boolean; dir: 'asc' | 'desc' }) {
    return <span className="text-[8px]">{active ? (dir === 'asc' ? '▲' : '▼') : '⇅'}</span>;
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

  return (
    <div className="flex flex-col gap-6 max-w-[1600px] mx-auto pb-12">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 bg-paper p-6 sm:p-8 border border-rule relative overflow-hidden">
        <div className="absolute top-0 left-0 w-1.5 h-full bg-accent rounded-l-[2.5rem]" />
        <div className="pl-4">
          <h2 className="text-2xl font-black text-ink tracking-tighter uppercase">Talent Acquisition & ATS</h2>
          <p className="text-[10px] font-black text-muted mt-1 uppercase tracking-[0.2em]">Job Postings · Candidate Pool · Pipeline · MCF Compliance</p>
        </div>
        <div className="flex flex-wrap gap-3 pl-4 sm:pl-0">
          <button onClick={() => { setCandidateForm(EMPTY_CANDIDATE); setCandidateJobId(''); setCandidateModal(true); }}
            className="px-5 py-2.5 text-[10px] font-black text-ink bg-page border border-rule hover:bg-page uppercase tracking-widest transition-all">
            + Add Candidate
          </button>
          <button onClick={() => { setEditingJob(null); setJobForm(EMPTY_JOB); setJobModal(true); }}
            className="px-5 py-2.5 text-[10px] font-black text-paper bg-accent hover:bg-accent uppercase tracking-widest transition-all">
            + New Job Opening
          </button>
        </div>
      </div>

      {error && <div className="bg-page border border-ink p-4 text-sm font-bold text-ink">{error}</div>}

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Open Positions', value: openJobs, sub: `${jobs.filter(j => j.status === 'DRAFT').length} drafts`, color: 'text-accent' },
          { label: 'Total Candidates', value: totalApplicants, sub: `${candidates.filter(c => c.stage === 'HIRED').length} hired · ${candidates.filter(c => !c.jobId).length} in pool`, color: 'text-accent' },
          { label: 'Upcoming Interviews', value: upcomingInterviews, sub: 'scheduled ahead', color: 'text-ink' },
          { label: 'MCF Compliance', value: `${mcfPct}%`, sub: `${mcfCompliant}/${openJobs} open ads listed`, color: mcfPct === 100 ? 'text-accent' : 'text-ink' },
        ].map(kpi => (
          <div key={kpi.label} className="bg-paper p-6 border border-rule ">
            <p className="label-form">{kpi.label}</p>
            <p className={`text-3xl font-black mt-2 ${kpi.color}`}>{loading ? '—' : kpi.value}</p>
            <p className="text-[9px] font-bold text-muted uppercase tracking-widest mt-2">{kpi.sub}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="bg-paper border border-rule overflow-hidden flex flex-col min-h-[600px]">
        <div className="px-4 sm:px-8 border-b border-rule flex items-center gap-5 sm:gap-8 bg-page overflow-x-auto custom-scrollbar">
          {([
            { key: 'jobs', label: 'Job Openings', count: jobs.length },
            { key: 'candidates', label: 'Candidate Pool', count: candidates.length },
            { key: 'pipeline', label: 'Pipeline' },
            { key: 'interviews', label: 'Interviews', count: upcomingInterviews || undefined },
          ] as const).map(tab => (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)}
              className={`py-5 text-[10px] font-black uppercase tracking-[0.18em] border-b-2 transition-all flex items-center gap-2 shrink-0 whitespace-nowrap ${activeTab === tab.key ? 'border-accent text-accent' : 'border-transparent text-muted hover:text-ink'}`}>
              {tab.label}
              {'count' in tab && tab.count !== undefined && (
                <span className={`text-[8px] font-black px-1.5 py-0.5  ${activeTab === tab.key ? 'bg-page text-accent' : 'bg-page text-muted'}`}>{tab.count}</span>
              )}
            </button>
          ))}
        </div>

        {/* ── Jobs Tab ───────────────────────────────────────────────────────── */}
        {activeTab === 'jobs' && (
          <div className="overflow-x-auto">
            {loading ? (
              <div className="p-16 text-center text-muted text-sm font-bold">Loading…</div>
            ) : jobs.length === 0 ? (
              <div className="p-20 flex flex-col items-center gap-4">
                <div className="w-16 h-16 bg-page border border-rule flex items-center justify-center text-2xl">📋</div>
                <p className="text-sm font-black text-muted uppercase tracking-widest">No job openings yet</p>
                <button onClick={() => { setEditingJob(null); setJobForm(EMPTY_JOB); setJobModal(true); }} className="px-5 py-2.5 bg-accent text-paper text-[10px] font-black uppercase tracking-widest">Create First Opening</button>
              </div>
            ) : (
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-page text-muted text-[9px] font-black uppercase tracking-[0.18em] border-b border-rule">
                    {([
                      { key: 'title',      label: 'Title',            cls: 'px-8 py-4' },
                      { key: 'department', label: 'Department',       cls: 'px-4 py-4' },
                      { key: 'status',     label: 'Status',           cls: 'px-4 py-4' },
                      { key: 'mcf',        label: 'MCF',              cls: 'px-4 py-4' },
                      { key: 'count',      label: 'Candidate Funnel', cls: 'px-4 py-4' },
                      { key: null,         label: 'Actions',          cls: 'px-8 py-4 text-right' },
                    ] as const).map(col => (
                      <th key={col.label} className={col.cls}>
                        {col.key ? (
                          <button onClick={() => toggleSort(jobSort, setJobSort, col.key!)} className="flex items-center gap-1 hover:text-ink transition-colors">
                            {col.label}<SortIcon active={jobSort.col === col.key} dir={jobSort.dir} />
                          </button>
                        ) : col.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-rule">
                  {sortedJobs.map(job => {
                    const daysLeft = mcfDaysLeft(job);
                    const counts = jobStageCounts(job);
                    const total = job._count?.candidates ?? 0;
                    const statusIdx = JOB_STATUS_FLOW.indexOf(job.status);
                    return (
                      <tr key={job.id} className="hover:bg-page transition-all">
                        <td className="px-8 py-5">
                          <p className="text-sm font-black text-ink tracking-tight">{job.title}</p>
                          <p className="text-[9px] text-muted font-bold uppercase tracking-widest mt-1">{job.location || 'Location TBD'} · {job.jobType.replace('_', ' ')} · {job.headcount} HC</p>
                          {/* Job lifecycle bar */}
                          <div className="flex items-center gap-1 mt-2">
                            {JOB_STATUS_FLOW.map((s, i) => (
                              <div key={s} className={`flex items-center gap-1 ${i < JOB_STATUS_FLOW.length - 1 ? 'flex-1' : ''}`}>
                                <div className={`w-2 h-2  flex-shrink-0 ${i <= statusIdx ? (s === 'CANCELLED' ? 'bg-ink' : 'bg-accent') : 'bg-rule'}`} />
                                {i < JOB_STATUS_FLOW.length - 1 && <div className={`flex-1 h-px ${i < statusIdx ? 'bg-accent' : 'bg-rule'}`} />}
                              </div>
                            ))}
                          </div>
                          <div className="flex gap-3 mt-1">
                            {JOB_STATUS_FLOW.map((s, i) => (
                              <span key={s} className={`text-[8px] font-black uppercase tracking-widest ${i === statusIdx ? 'text-accent' : 'text-muted'}`}>{s}</span>
                            ))}
                          </div>
                        </td>
                        <td className="px-4 py-5">
                          <span className="text-[9px] font-black text-muted uppercase tracking-widest border border-rule px-2.5 py-1 ">{job.department}</span>
                        </td>
                        <td className="px-4 py-5">
                          <span className={`text-[9px] px-2.5 py-1  font-black uppercase border tracking-widest ${JOB_STATUS_COLORS[job.status] || 'bg-page text-muted border-rule'}`}>{job.status}</span>
                        </td>
                        <td className="px-4 py-5">
                          {job.mcfPostedAt ? (
                            <div>
                              <div className="flex items-center gap-1.5">
                                <div className="w-1.5 h-1.5 bg-accent" />
                                <span className="text-[9px] font-black text-accent uppercase tracking-widest">Listed</span>
                              </div>
                              {daysLeft !== null && <p className="text-[9px] text-muted font-bold mt-0.5">{daysLeft > 0 ? `${daysLeft}d window` : 'Window closed'}</p>}
                            </div>
                          ) : (
                            <button onClick={() => { setMcfJobId(job.id); setMcfForm(EMPTY_MCF); setMcfModal(true); }}
                              className="text-[9px] font-black text-ink border border-highlight bg-page px-2 py-1 uppercase tracking-widest hover:bg-page transition-all">
                              Record MCF
                            </button>
                          )}
                        </td>
                        <td className="px-4 py-5 min-w-[220px]">
                          {total === 0 ? (
                            <span className="text-[9px] text-muted font-bold">No candidates yet</span>
                          ) : (
                            <div>
                              <div className="flex items-end gap-1 h-7">
                                {ACTIVE_STAGES.map(s => {
                                  const n = counts[s] || 0;
                                  const pct = total > 0 ? (n / total) * 100 : 0;
                                  return (
                                    <div key={s} title={`${STAGE_LABELS[s]}: ${n}`} className="flex-1 flex flex-col justify-end">
                                      <div className={`w-full  ${STAGE_DOT[s]} opacity-80`} style={{ height: `${Math.max(pct, n > 0 ? 15 : 0)}%` }} />
                                    </div>
                                  );
                                })}
                              </div>
                              <div className="flex gap-1 mt-1.5 flex-wrap">
                                {ACTIVE_STAGES.filter(s => counts[s]).map(s => (
                                  <span key={s} className={`text-[8px] font-black border px-1.5 py-0.5  ${STAGE_COLORS[s]}`}>
                                    {counts[s]} {STAGE_LABELS[s]}
                                  </span>
                                ))}
                                {(counts['REJECTED'] || 0) > 0 && <span className="text-[8px] font-black border px-1.5 py-0.5 bg-page text-ink border-ink">{counts['REJECTED']} Rejected</span>}
                              </div>
                            </div>
                          )}
                        </td>
                        <td className="px-8 py-5 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button onClick={() => { setCandidateForm(EMPTY_CANDIDATE); setCandidateJobId(job.id); setCandidateModal(true); }}
                              className="text-[9px] font-black text-accent border border-accent bg-page px-2.5 py-1.5 uppercase tracking-widest hover:bg-page transition-all">
                              + Candidate
                            </button>
                            <button onClick={() => { setPipelineJob(job.id); setPipelineStage(''); setActiveTab('pipeline'); }}
                              className="text-[9px] font-black text-muted border border-rule bg-page px-2.5 py-1.5 uppercase tracking-widest hover:bg-page transition-all">
                              Pipeline
                            </button>
                            <button onClick={() => { setEditingJob(job); setJobForm({ title: job.title, department: job.department, headcount: job.headcount, jobDescription: job.jobDescription, requirements: job.requirements || '', salaryMin: job.salaryMin ?? '', salaryMax: job.salaryMax ?? '', jobType: job.jobType, location: job.location || '' }); setJobModal(true); }}
                              className="text-[9px] font-black text-muted border border-rule bg-page px-2.5 py-1.5 uppercase tracking-widest hover:bg-page transition-all">
                              Edit
                            </button>
                            {job.status !== 'CANCELLED' && (
                              <button onClick={() => archiveJob(job.id)}
                                className="text-[9px] font-black text-ink border border-ink bg-page px-2.5 py-1.5 uppercase tracking-widest hover:bg-page transition-all">
                                Archive
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* ── Candidates Tab ─────────────────────────────────────────────────── */}
        {activeTab === 'candidates' && (
          <div className="flex flex-col">
            <div className="px-8 py-4 border-b border-rule flex items-center gap-4">
              <input value={candidateSearch} onChange={e => setCandidateSearch(e.target.value)}
                placeholder="Search candidates by name, email, title…"
                className="text-[10px] font-bold text-ink bg-page border border-rule px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-accent w-72" />
              <span className="label-form ml-auto">{filteredCandidates.length} candidates</span>
              <span className="text-[9px] font-black text-muted uppercase tracking-widest">{candidates.filter(c => !c.jobId).length} unassigned</span>
            </div>
            {loading ? (
              <div className="p-16 text-center text-muted text-sm font-bold">Loading…</div>
            ) : filteredCandidates.length === 0 ? (
              <div className="p-20 flex flex-col items-center gap-4">
                <div className="w-16 h-16 bg-page border border-rule flex items-center justify-center text-2xl">👤</div>
                <p className="text-sm font-black text-muted uppercase tracking-widest">{candidateSearch ? 'No matching candidates' : 'No candidates yet'}</p>
                {!candidateSearch && <button onClick={() => { setCandidateForm(EMPTY_CANDIDATE); setCandidateJobId(''); setCandidateModal(true); }} className="px-5 py-2.5 bg-accent text-paper text-[10px] font-black uppercase tracking-widest">Add First Candidate</button>}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-page text-muted text-[9px] font-black uppercase tracking-[0.18em] border-b border-rule">
                      {([
                        { key: 'name',   label: 'Candidate',       cls: 'px-8 py-4' },
                        { key: 'stage',  label: 'Stage',           cls: 'px-4 py-4' },
                        { key: 'job',    label: 'Tagged Job',      cls: 'px-4 py-4' },
                        { key: 'salary', label: 'Expected Salary', cls: 'px-4 py-4' },
                        { key: 'notice', label: 'Notice',          cls: 'px-4 py-4' },
                        { key: 'added',  label: 'Added',           cls: 'px-4 py-4' },
                        { key: null,     label: 'Resume',          cls: 'px-4 py-4' },
                        { key: null,     label: 'Actions',         cls: 'px-8 py-4 text-right' },
                      ] as const).map(col => (
                        <th key={col.label} className={col.cls}>
                          {col.key ? (
                            <button onClick={() => toggleSort(candidateSort, setCandidateSort, col.key!)} className="flex items-center gap-1 hover:text-ink transition-colors">
                              {col.label}<SortIcon active={candidateSort.col === col.key} dir={candidateSort.dir} />
                            </button>
                          ) : col.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-rule">
                    {sortedCandidates.map(c => (
                      <tr key={c.id} className="hover:bg-page transition-all cursor-pointer" onClick={() => loadCandidateDetail(c.id)}>
                        <td className="px-8 py-5">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 bg-page border border-accent flex items-center justify-center text-xs font-black text-accent flex-shrink-0">
                              {c.firstName[0]}{c.lastName[0]}
                            </div>
                            <div>
                              <p className="text-sm font-black text-ink">{c.firstName} {c.lastName}</p>
                              <p className="text-[9px] text-muted font-bold mt-0.5">{c.email}</p>
                              {c.currentTitle && <p className="text-[9px] text-muted font-bold">{c.currentTitle}{c.currentEmployer ? ` @ ${c.currentEmployer}` : ''}</p>}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-5" onClick={e => e.stopPropagation()}>
                          <select value={c.stage} onChange={e => updateStage(c.id, e.target.value)}
                            className={`text-[9px] font-black border  px-2.5 py-1.5 uppercase tracking-widest cursor-pointer ${STAGE_COLORS[c.stage] || 'bg-page text-ink border-rule'}`}>
                            {PIPELINE_STAGES.map(s => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
                          </select>
                        </td>
                        <td className="px-4 py-5">
                          {c.job ? (
                            <span className="text-[9px] font-black text-ink border border-rule bg-page px-2 py-1 uppercase tracking-widest">{c.job.title}</span>
                          ) : (
                            <span className="text-[9px] font-bold text-muted italic">Unassigned</span>
                          )}
                        </td>
                        <td className="px-4 py-5"><span className="text-sm font-black text-ink">{c.expectedSalary ? `$${Number(c.expectedSalary).toLocaleString()}` : '—'}</span></td>
                        <td className="px-4 py-5"><span className="text-[9px] font-bold text-muted">{c.noticePeriod ? `${c.noticePeriod}d` : '—'}</span></td>
                        <td className="px-4 py-5"><span className="text-[9px] font-bold text-muted">{fmtDate(c.createdAt)}</span></td>
                        <td className="px-4 py-5" onClick={e => e.stopPropagation()}>
                          {c.resumeName ? (
                            <div className="flex items-center gap-1.5">
                              <button onClick={() => downloadResume(c.id)} title={c.resumeName}
                                className="text-[9px] font-black text-accent border border-accent bg-page px-2 py-1 uppercase tracking-widest hover:bg-page transition-all max-w-[90px] truncate">
                                {c.resumeName.length > 12 ? c.resumeName.slice(0, 10) + '…' : c.resumeName}
                              </button>
                              <button onClick={() => deleteResume(c.id)} title="Remove resume"
                                className="text-[9px] font-black text-ink hover:text-ink transition-colors">✕</button>
                            </div>
                          ) : (
                            <label className={`text-[9px] font-black border  px-2 py-1 uppercase tracking-widest transition-all cursor-pointer ${resumeUploading === c.id ? 'text-muted border-rule bg-page' : 'text-accent border-accent bg-page hover:bg-page'}`}>
                              {resumeUploading === c.id ? 'Uploading…' : '+ Resume'}
                              <input type="file" accept=".pdf,.doc,.docx" className="hidden" disabled={resumeUploading === c.id}
                                onChange={e => { const f = e.target.files?.[0]; if (f) uploadResume(c.id, f); e.target.value = ''; }} />
                            </label>
                          )}
                        </td>
                        <td className="px-8 py-5 text-right" onClick={e => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-2">
                            <button onClick={() => { setTagJobSelected(c.jobId || ''); setTagJobModal(c.id); }}
                              className="text-[9px] font-black text-muted border border-rule bg-page px-2.5 py-1.5 uppercase tracking-widest hover:bg-page transition-all">
                              {c.jobId ? 'Re-tag' : 'Tag Job'}
                            </button>
                            <button onClick={() => { setInterviewCandidateId(c.id); setInterviewForm(EMPTY_INTERVIEW); setInterviewModal(true); }}
                              className="text-[9px] font-black text-accent border border-accent bg-page px-2.5 py-1.5 uppercase tracking-widest hover:bg-page transition-all">
                              + Interview
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── Pipeline Tab ───────────────────────────────────────────────────── */}
        {activeTab === 'pipeline' && (
          <div className="flex flex-col">
            <div className="px-8 py-4 border-b border-rule flex items-center gap-4">
              <select value={pipelineJob} onChange={e => setPipelineJob(e.target.value)}
                className="text-[10px] font-black text-ink bg-page border border-rule px-3 py-2 uppercase tracking-widest">
                <option value="">All Job Openings</option>
                {jobs.map(j => <option key={j.id} value={j.id}>{j.title}</option>)}
              </select>
              <select value={pipelineStage} onChange={e => setPipelineStage(e.target.value)}
                className="text-[10px] font-black text-ink bg-page border border-rule px-3 py-2 uppercase tracking-widest">
                <option value="">All Stages</option>
                {PIPELINE_STAGES.map(s => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
              </select>
              <span className="label-form ml-auto">{filteredPipeline.length} candidates</span>
            </div>

            {/* Stage funnel summary */}
            {!pipelineStage && (
              <div className="px-8 py-4 border-b border-rule grid grid-cols-9 gap-2">
                {PIPELINE_STAGES.map(s => {
                  const n = filteredPipeline.filter(c => c.stage === s).length;
                  return (
                    <button key={s} onClick={() => setPipelineStage(s === pipelineStage ? '' : s)}
                      className={`flex flex-col items-center gap-1.5 p-3  border transition-all hover: ${n > 0 ? STAGE_COLORS[s] : 'bg-page text-muted border-rule'}`}>
                      <span className="text-base font-black">{n}</span>
                      <span className="text-[8px] font-black uppercase tracking-widest text-center leading-tight">{STAGE_LABELS[s]}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {loading ? (
              <div className="p-16 text-center text-muted text-sm font-bold">Loading…</div>
            ) : filteredPipeline.length === 0 ? (
              <div className="p-20 flex flex-col items-center gap-4">
                <div className="w-16 h-16 bg-page border border-rule flex items-center justify-center text-2xl">👤</div>
                <p className="text-sm font-black text-muted uppercase tracking-widest">No candidates in pipeline</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-page text-muted text-[9px] font-black uppercase tracking-[0.18em] border-b border-rule">
                      {([
                        { key: 'name',    label: 'Candidate',  cls: 'px-8 py-4' },
                        { key: 'job',     label: 'Applied For', cls: 'px-4 py-4' },
                        { key: 'stage',   label: 'Stage',      cls: 'px-4 py-4' },
                        { key: 'salary',  label: 'Salary',     cls: 'px-4 py-4' },
                        { key: 'notice',  label: 'Notice',     cls: 'px-4 py-4' },
                        { key: 'applied', label: 'Applied',    cls: 'px-4 py-4' },
                        { key: null,      label: 'Actions',    cls: 'px-8 py-4 text-right' },
                      ] as const).map(col => (
                        <th key={col.label} className={col.cls}>
                          {col.key ? (
                            <button onClick={() => toggleSort(pipelineSort, setPipelineSort, col.key!)} className="flex items-center gap-1 hover:text-ink transition-colors">
                              {col.label}<SortIcon active={pipelineSort.col === col.key} dir={pipelineSort.dir} />
                            </button>
                          ) : col.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-rule">
                    {sortedPipeline.map(c => (
                      <tr key={c.id} className="hover:bg-page transition-all cursor-pointer" onClick={() => loadCandidateDetail(c.id)}>
                        <td className="px-8 py-5">
                          <p className="text-sm font-black text-ink">{c.firstName} {c.lastName}</p>
                          <p className="text-[9px] text-muted font-bold mt-0.5">{c.email}</p>
                          {c.currentTitle && <p className="text-[9px] text-muted font-bold">{c.currentTitle}{c.currentEmployer ? ` @ ${c.currentEmployer}` : ''}</p>}
                        </td>
                        <td className="px-4 py-5">
                          <span className="text-[9px] font-black text-ink uppercase tracking-widest border border-rule px-2 py-1 ">
                            {c.job?.title || jobs.find(j => j.id === c.jobId)?.title || <span className="text-muted normal-case font-bold not-italic">Unassigned</span>}
                          </span>
                        </td>
                        <td className="px-4 py-5" onClick={e => e.stopPropagation()}>
                          <select value={c.stage} onChange={e => updateStage(c.id, e.target.value)}
                            className={`text-[9px] font-black border  px-2.5 py-1.5 uppercase tracking-widest ${STAGE_COLORS[c.stage] || 'bg-page text-ink border-rule'}`}>
                            {PIPELINE_STAGES.map(s => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
                          </select>
                        </td>
                        <td className="px-4 py-5"><span className="text-sm font-black text-ink">{c.expectedSalary ? `$${Number(c.expectedSalary).toLocaleString()}` : '—'}</span></td>
                        <td className="px-4 py-5"><span className="text-[9px] font-bold text-muted">{c.noticePeriod ? `${c.noticePeriod}d` : '—'}</span></td>
                        <td className="px-4 py-5"><span className="text-[9px] font-bold text-muted">{fmtDate(c.createdAt)}</span></td>
                        <td className="px-8 py-5 text-right" onClick={e => e.stopPropagation()}>
                          <button onClick={() => { setInterviewCandidateId(c.id); setInterviewForm(EMPTY_INTERVIEW); setInterviewModal(true); }}
                            className="text-[9px] font-black text-accent border border-accent bg-page px-2.5 py-1.5 uppercase tracking-widest hover:bg-page transition-all">
                            + Interview
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── Interviews Tab ─────────────────────────────────────────────────── */}
        {activeTab === 'interviews' && (
          <div className="overflow-x-auto">
            {loading ? (
              <div className="p-16 text-center text-muted text-sm font-bold">Loading…</div>
            ) : interviews.length === 0 ? (
              <div className="p-20 flex flex-col items-center gap-4">
                <div className="w-16 h-16 bg-page border border-rule flex items-center justify-center text-2xl">📅</div>
                <p className="text-sm font-black text-muted uppercase tracking-widest">No interviews scheduled</p>
              </div>
            ) : (
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-page text-muted text-[9px] font-black uppercase tracking-[0.18em] border-b border-rule">
                    {([
                      { key: 'round', label: 'Round', cls: 'px-8 py-4' },
                      { key: 'candidate', label: 'Candidate', cls: 'px-4 py-4' },
                      { key: 'scheduled', label: 'Scheduled', cls: 'px-4 py-4' },
                      { key: null, label: 'Notes', cls: 'px-4 py-4' },
                      { key: 'result', label: 'Result', cls: 'px-4 py-4' },
                    ] as const).map(col => (
                      <th key={col.label} className={col.cls}>
                        {col.key ? (
                          <button onClick={() => toggleSort(interviewSort, setInterviewSort, col.key!)} className="flex items-center gap-1 hover:text-ink transition-colors">
                            {col.label}
                            <SortIcon active={interviewSort.col === col.key} dir={interviewSort.dir} />
                          </button>
                        ) : col.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-rule">
                  {sortedInterviews.map(ir => {
                    const cand = candidates.find(c => c.id === ir.candidateId);
                    const isPast = new Date(ir.scheduledAt) < new Date();
                    return (
                      <tr key={ir.id} className="hover:bg-page transition-all">
                        <td className="px-8 py-5"><p className="text-sm font-black text-ink">{ir.roundName}</p></td>
                        <td className="px-4 py-5">
                          {cand ? (
                            <button onClick={() => loadCandidateDetail(cand.id)} className="text-left hover:opacity-80">
                              <p className="text-sm font-black text-ink">{cand.firstName} {cand.lastName}</p>
                              <p className="text-[9px] text-muted font-bold">{cand.job?.title || jobs.find(j => j.id === cand.jobId)?.title || '—'}</p>
                            </button>
                          ) : <span className="text-muted text-xs">—</span>}
                        </td>
                        <td className="px-4 py-5">
                          <p className={`text-sm font-black ${isPast ? 'text-muted' : 'text-ink'}`}>{fmtDateTime(ir.scheduledAt)}</p>
                          {!isPast && <span className="text-[9px] font-black text-accent uppercase tracking-widest">Upcoming</span>}
                        </td>
                        <td className="px-4 py-5"><p className="text-xs text-muted max-w-[240px] truncate">{ir.notes || '—'}</p></td>
                        <td className="px-4 py-5">
                          {ir.result ? (
                            <span className={`text-[9px] font-black uppercase border px-2.5 py-1  tracking-widest ${ir.result === 'PASS' ? 'bg-page text-accent border-accent' : ir.result === 'FAIL' ? 'bg-page text-ink border-ink' : 'bg-page text-muted border-rule'}`}>{ir.result}</span>
                          ) : <span className="text-[9px] font-bold text-muted">Pending</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {/* ── Candidate Detail Side Panel ─────────────────────────────────────── */}
      {detailCandidate && (
        <div className="fixed inset-0 z-50 flex justify-end" onClick={() => setDetailCandidate(null)}>
          <div className="absolute inset-0 bg-shadow backdrop-" />
          <div className="relative z-10 w-full max-w-lg bg-paper h-full overflow-y-auto " onClick={e => e.stopPropagation()}>
            {detailLoading ? (
              <div className="p-16 text-center text-muted text-sm font-bold">Loading…</div>
            ) : (
              <>
                <div className="p-8 border-b border-rule">
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="flex items-center gap-3 mb-1">
                        <div className="w-10 h-10 bg-page border border-accent flex items-center justify-center text-sm font-black text-accent">
                          {detailCandidate.firstName[0]}{detailCandidate.lastName[0]}
                        </div>
                        <div>
                          <h3 className="text-lg font-black text-ink tracking-tighter">{detailCandidate.firstName} {detailCandidate.lastName}</h3>
                          <p className="text-xs font-bold text-muted">{detailCandidate.email}</p>
                        </div>
                      </div>
                      {detailCandidate.phone && <p className="text-xs font-bold text-muted mt-1">{detailCandidate.phone}</p>}
                    </div>
                    <button onClick={() => setDetailCandidate(null)} className="text-muted hover:text-ink text-xl font-black">✕</button>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <span className={`text-[9px] font-black border  px-2.5 py-1 uppercase tracking-widest ${STAGE_COLORS[detailCandidate.stage] || ''}`}>
                      {STAGE_LABELS[detailCandidate.stage] || detailCandidate.stage}
                    </span>
                    {detailCandidate.job && (
                      <span className="text-[9px] font-black bg-page text-ink border border-rule px-2.5 py-1 uppercase tracking-widest">{detailCandidate.job.title}</span>
                    )}
                    {detailCandidate.isHired && <span className="text-[9px] font-black bg-page text-accent border border-accent px-2.5 py-1 uppercase tracking-widest">Hired</span>}
                    {detailCandidate.isOfferMade && !detailCandidate.isHired && <span className="text-[9px] font-black bg-page text-ink border border-highlight px-2.5 py-1 uppercase tracking-widest">Offer Made</span>}
                  </div>
                </div>

                <div className="p-8 flex flex-col gap-7">
                  {/* Stage Lifecycle Tracker */}
                  <div>
                    <p className="label-form mb-4">Stage Tracker</p>
                    <div className="relative">
                      {/* Connector line */}
                      <div className="absolute left-[9px] top-2 bottom-2 w-px bg-page" />
                      <div className="flex flex-col gap-0">
                        {PIPELINE_STAGES.filter(s => s !== 'WITHDRAWN').map((s) => {
                          const stageOrder = ['APPLIED', 'SCREENING', 'INTERVIEW_1', 'INTERVIEW_2', 'ASSESSMENT', 'OFFER', 'HIRED', 'REJECTED'];
                          const currentIdx = stageOrder.indexOf(detailCandidate.stage);
                          const thisIdx = stageOrder.indexOf(s);
                          const isCurrent = detailCandidate.stage === s;
                          const isPast = thisIdx < currentIdx && !['REJECTED'].includes(detailCandidate.stage);
                          const isRejected = detailCandidate.stage === 'REJECTED' && s === 'REJECTED';
                          const event = detailCandidate.stageEvents?.find(e => e.toStage === s);
                          return (
                            <div key={s} className="flex items-start gap-4 py-2 relative z-10">
                              <div className={`w-[18px] h-[18px]  flex-shrink-0 flex items-center justify-center mt-0.5 border-2 ${
                                isCurrent || isRejected
                                  ? `${STAGE_DOT[s]} border-transparent`
                                  : isPast
                                  ? 'bg-rule border-transparent'
                                  : 'bg-paper border-rule'
                              }`}>
                                {(isPast) && <div className="w-2 h-2 bg-paper " />}
                                {isCurrent && <div className="w-2 h-2 bg-paper " />}
                              </div>
                              <div className="flex-1 min-w-0 pb-1">
                                <div className="flex items-center justify-between">
                                  <span className={`text-[10px] font-black uppercase tracking-widest ${isCurrent || isRejected ? 'text-ink' : isPast ? 'text-muted' : 'text-muted'}`}>
                                    {STAGE_LABELS[s]}
                                  </span>
                                  {event && <span className="text-[8px] font-bold text-muted">{fmtDate(event.createdAt)}</span>}
                                  {isCurrent && !event && <span className="text-[8px] font-black text-accent uppercase tracking-widest">Current</span>}
                                </div>
                                {event?.note && <p className="text-[9px] text-muted mt-0.5">{event.note}</p>}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  {/* Move Stage */}
                  <div>
                    <p className="label-form mb-3">Move Stage</p>
                    <div className="flex flex-wrap gap-2">
                      {PIPELINE_STAGES.map(s => (
                        <button key={s} onClick={() => updateStage(detailCandidate.id, s)}
                          className={`text-[9px] font-black border  px-2.5 py-1.5 uppercase tracking-widest transition-all ${detailCandidate.stage === s ? 'ring-2 ring-accent ' + STAGE_COLORS[s] : STAGE_COLORS[s] + ' opacity-60 hover:opacity-100'}`}>
                          {STAGE_LABELS[s]}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Employment Details */}
                  <div>
                    <p className="label-form mb-3">Employment Details</p>
                    <div className="grid grid-cols-2 gap-3">
                      {[
                        ['Current Title', detailCandidate.currentTitle || '—'],
                        ['Current Employer', detailCandidate.currentEmployer || '—'],
                        ['Expected Salary', detailCandidate.expectedSalary ? `$${Number(detailCandidate.expectedSalary).toLocaleString()}` : '—'],
                        ['Notice Period', detailCandidate.noticePeriod ? `${detailCandidate.noticePeriod} days` : '—'],
                      ].map(([label, value]) => (
                        <div key={label}>
                          <p className="label-form">{label}</p>
                          <p className="text-xs font-bold text-ink mt-0.5">{value}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Tagged job */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <p className="label-form">Tagged Job</p>
                      <button onClick={() => { setTagJobSelected(detailCandidate.jobId || ''); setTagJobModal(detailCandidate.id); }}
                        className="text-[9px] font-black text-accent border border-accent bg-page px-2 py-1 uppercase tracking-widest hover:bg-page">
                        {detailCandidate.jobId ? 'Change' : 'Tag Job'}
                      </button>
                    </div>
                    {detailCandidate.job ? (
                      <div className="bg-page border border-rule p-3">
                        <p className="text-xs font-black text-ink">{detailCandidate.job.title}</p>
                        {detailCandidate.job.department && <p className="text-[9px] font-bold text-muted uppercase tracking-widest mt-0.5">{detailCandidate.job.department}</p>}
                      </div>
                    ) : <p className="text-xs text-muted font-bold">Not tagged to any job opening</p>}
                  </div>

                  {/* Resume */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <p className="label-form">Resume</p>
                      {detailCandidate.resumeName && (
                        <button onClick={() => deleteResume(detailCandidate.id)}
                          className="text-[9px] font-black text-ink hover:text-ink uppercase tracking-widest transition-colors">
                          Remove
                        </button>
                      )}
                    </div>
                    {detailCandidate.resumeName ? (
                      <button onClick={() => downloadResume(detailCandidate.id)}
                        className="w-full flex items-center gap-3 bg-page hover:bg-page border border-rule hover:border-accent p-3 transition-all group">
                        <div className="w-8 h-8 bg-page border border-ink flex items-center justify-center text-xs font-black text-ink flex-shrink-0">PDF</div>
                        <div className="flex-1 min-w-0 text-left">
                          <p className="text-xs font-black text-ink truncate group-hover:text-accent">{detailCandidate.resumeName}</p>
                          <p className="text-[9px] font-bold text-muted uppercase tracking-widest mt-0.5">Click to download</p>
                        </div>
                      </button>
                    ) : (
                      <label className={`w-full flex items-center justify-center gap-2 border-2 border-dashed  p-4 cursor-pointer transition-all ${resumeUploading === detailCandidate.id ? 'border-rule bg-page' : 'border-accent hover:border-accent hover:bg-page'}`}>
                        <div className="text-center">
                          <p className={`text-[10px] font-black uppercase tracking-widest ${resumeUploading === detailCandidate.id ? 'text-muted' : 'text-accent'}`}>
                            {resumeUploading === detailCandidate.id ? 'Uploading…' : 'Upload Resume'}
                          </p>
                          <p className="text-[8px] font-bold text-muted mt-1">PDF, DOC, DOCX · Max 10 MB</p>
                        </div>
                        <input type="file" accept=".pdf,.doc,.docx" className="hidden" disabled={resumeUploading === detailCandidate.id}
                          onChange={e => { const f = e.target.files?.[0]; if (f) uploadResume(detailCandidate.id, f); e.target.value = ''; }} />
                      </label>
                    )}
                  </div>

                  {detailCandidate.notes && (
                    <div>
                      <p className="label-form mb-2">Notes</p>
                      <p className="text-xs text-ink leading-relaxed">{detailCandidate.notes}</p>
                    </div>
                  )}

                  {/* Interview Rounds */}
                  <div>
                    <div className="flex justify-between items-center mb-3">
                      <p className="label-form">Interview Rounds</p>
                      <button onClick={() => { setInterviewCandidateId(detailCandidate.id); setInterviewForm(EMPTY_INTERVIEW); setInterviewModal(true); }}
                        className="text-[9px] font-black text-accent border border-accent bg-page px-2.5 py-1 uppercase tracking-widest hover:bg-page">
                        + Schedule
                      </button>
                    </div>
                    {!detailCandidate.interviewRounds?.length ? (
                      <p className="text-xs text-muted font-bold">No interviews scheduled yet.</p>
                    ) : (
                      <div className="flex flex-col gap-3">
                        {detailCandidate.interviewRounds.map(ir => (
                          <div key={ir.id} className="bg-page border border-rule p-4">
                            <div className="flex justify-between">
                              <p className="text-xs font-black text-ink">{ir.roundName}</p>
                              {ir.result && (
                                <span className={`text-[9px] font-black uppercase px-2 py-0.5  ${ir.result === 'PASS' ? 'bg-page text-accent' : ir.result === 'FAIL' ? 'bg-page text-ink' : 'bg-page text-muted'}`}>{ir.result}</span>
                              )}
                            </div>
                            <p className="text-[9px] font-bold text-muted mt-1">{fmtDateTime(ir.scheduledAt)}</p>
                            {ir.notes && <p className="text-[10px] text-muted mt-1">{ir.notes}</p>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Stage History */}
                  {detailCandidate.stageEvents && detailCandidate.stageEvents.length > 1 && (
                    <div>
                      <p className="label-form mb-3">Activity Log</p>
                      <div className="flex flex-col gap-2">
                        {[...detailCandidate.stageEvents].reverse().map(ev => (
                          <div key={ev.id} className="flex items-start gap-3">
                            <div className={`w-1.5 h-1.5  mt-1.5 flex-shrink-0 ${STAGE_DOT[ev.toStage] || 'bg-rule'}`} />
                            <div>
                              <p className="text-[10px] font-black text-ink">
                                {ev.fromStage ? `${STAGE_LABELS[ev.fromStage] || ev.fromStage} → ${STAGE_LABELS[ev.toStage] || ev.toStage}` : `Added as ${STAGE_LABELS[ev.toStage] || ev.toStage}`}
                              </p>
                              {ev.note && <p className="text-[9px] text-muted">{ev.note}</p>}
                              <p className="text-[8px] font-bold text-muted mt-0.5">{fmtDateTime(ev.createdAt)}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Tag Job Modal ──────────────────────────────────────────────────────── */}
      {tagJobModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setTagJobModal(null)}>
          <div className="absolute inset-0 bg-shadow backdrop-" />
          <div className="relative z-10 bg-paper w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="p-8 border-b border-rule flex justify-between items-center">
              <div>
                <h3 className="text-base font-black text-ink tracking-tighter">Tag to Job Opening</h3>
                <p className="text-[9px] font-bold text-muted uppercase tracking-widest mt-1">Select a job to link this candidate</p>
              </div>
              <button onClick={() => setTagJobModal(null)} className="text-muted hover:text-ink text-xl font-black">✕</button>
            </div>
            <div className="p-8 flex flex-col gap-4">
              <select value={tagJobSelected} onChange={e => setTagJobSelected(e.target.value)}
                className="border border-rule px-4 py-3 text-sm font-bold text-ink focus:outline-none focus:ring-2 focus:ring-accent">
                <option value="">— No job (candidate pool) —</option>
                {jobs.filter(j => j.status !== 'CANCELLED').map(j => <option key={j.id} value={j.id}>{j.title} · {j.department}</option>)}
              </select>
              <p className="text-[9px] text-muted font-bold">Selecting no job moves the candidate back to the unassigned pool.</p>
            </div>
            <div className="p-8 pt-0 flex gap-3 justify-end">
              <button onClick={() => setTagJobModal(null)} className="px-6 py-3 text-[10px] font-black text-ink bg-page border border-rule uppercase tracking-widest">Cancel</button>
              <button onClick={tagJob} disabled={tagJobSaving}
                className="px-6 py-3 text-[10px] font-black text-paper bg-accent hover:bg-accent uppercase tracking-widest disabled:opacity-50">
                {tagJobSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Job Modal ──────────────────────────────────────────────────────────── */}
      {jobModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => { setJobModal(false); setEditingJob(null); }}>
          <div className="absolute inset-0 bg-shadow backdrop-" />
          <div className="relative z-10 bg-paper w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="p-8 border-b border-rule flex justify-between items-center">
              <h3 className="text-lg font-black text-ink tracking-tighter">{editingJob ? 'Edit Job Opening' : 'New Job Opening'}</h3>
              <button onClick={() => { setJobModal(false); setEditingJob(null); }} className="text-muted hover:text-ink text-xl font-black">✕</button>
            </div>
            <div className="p-8 flex flex-col gap-5">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2 flex flex-col gap-1.5">
                  <label className="text-[9px] font-black text-muted uppercase tracking-widest">Job Title *</label>
                  <input value={String(jobForm.title || '')} onChange={e => setJobForm(p => ({ ...p, title: e.target.value }))} placeholder="e.g. Senior Software Engineer"
                    className="border border-rule px-4 py-3 text-sm font-bold text-ink focus:outline-none focus:ring-2 focus:ring-accent" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[9px] font-black text-muted uppercase tracking-widest">Department *</label>
                  <input value={String(jobForm.department || '')} onChange={e => setJobForm(p => ({ ...p, department: e.target.value }))} placeholder="e.g. Engineering"
                    className="border border-rule px-4 py-3 text-sm font-bold text-ink focus:outline-none focus:ring-2 focus:ring-accent" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[9px] font-black text-muted uppercase tracking-widest">Headcount</label>
                  <input type="number" min={1} value={String(jobForm.headcount || 1)} onChange={e => setJobForm(p => ({ ...p, headcount: e.target.value }))}
                    className="border border-rule px-4 py-3 text-sm font-bold text-ink focus:outline-none focus:ring-2 focus:ring-accent" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[9px] font-black text-muted uppercase tracking-widest">Job Type</label>
                  <select value={String(jobForm.jobType || 'FULL_TIME')} onChange={e => setJobForm(p => ({ ...p, jobType: e.target.value }))}
                    className="border border-rule px-4 py-3 text-sm font-bold text-ink focus:outline-none focus:ring-2 focus:ring-accent">
                    <option value="FULL_TIME">Full Time</option>
                    <option value="PART_TIME">Part Time</option>
                    <option value="CONTRACT">Contract</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[9px] font-black text-muted uppercase tracking-widest">Location</label>
                  <input value={String(jobForm.location || '')} onChange={e => setJobForm(p => ({ ...p, location: e.target.value }))} placeholder="e.g. Singapore CBD"
                    className="border border-rule px-4 py-3 text-sm font-bold text-ink focus:outline-none focus:ring-2 focus:ring-accent" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[9px] font-black text-muted uppercase tracking-widest">Salary Min (SGD)</label>
                  <input type="number" value={String(jobForm.salaryMin || '')} onChange={e => setJobForm(p => ({ ...p, salaryMin: e.target.value }))} placeholder="e.g. 4000"
                    className="border border-rule px-4 py-3 text-sm font-bold text-ink focus:outline-none focus:ring-2 focus:ring-accent" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[9px] font-black text-muted uppercase tracking-widest">Salary Max (SGD)</label>
                  <input type="number" value={String(jobForm.salaryMax || '')} onChange={e => setJobForm(p => ({ ...p, salaryMax: e.target.value }))} placeholder="e.g. 8000"
                    className="border border-rule px-4 py-3 text-sm font-bold text-ink focus:outline-none focus:ring-2 focus:ring-accent" />
                </div>
                <div className="col-span-2 flex flex-col gap-1.5">
                  <label className="text-[9px] font-black text-muted uppercase tracking-widest">Job Description *</label>
                  <textarea rows={5} value={String(jobForm.jobDescription || '')} onChange={e => setJobForm(p => ({ ...p, jobDescription: e.target.value }))}
                    placeholder="Describe the role, responsibilities, and what the candidate will work on..."
                    className="border border-rule px-4 py-3 text-sm font-bold text-ink focus:outline-none focus:ring-2 focus:ring-accent resize-none" />
                </div>
                <div className="col-span-2 flex flex-col gap-1.5">
                  <label className="text-[9px] font-black text-muted uppercase tracking-widest">Requirements</label>
                  <textarea rows={3} value={String(jobForm.requirements || '')} onChange={e => setJobForm(p => ({ ...p, requirements: e.target.value }))}
                    placeholder="List required skills, qualifications, and experience..."
                    className="border border-rule px-4 py-3 text-sm font-bold text-ink focus:outline-none focus:ring-2 focus:ring-accent resize-none" />
                </div>
              </div>
            </div>
            <div className="p-8 pt-0 flex gap-3 justify-end">
              <button onClick={() => { setJobModal(false); setEditingJob(null); }} className="px-6 py-3 text-[10px] font-black text-ink bg-page border border-rule uppercase tracking-widest hover:bg-page">Cancel</button>
              <button onClick={saveJob} disabled={jobSaving || !jobForm.title || !jobForm.department || !jobForm.jobDescription}
                className="px-6 py-3 text-[10px] font-black text-paper bg-accent hover:bg-accent uppercase tracking-widest disabled:opacity-50 transition-all">
                {jobSaving ? 'Saving…' : editingJob ? 'Save Changes' : 'Create Opening'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MCF Compliance Modal ───────────────────────────────────────────────── */}
      {mcfModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setMcfModal(false)}>
          <div className="absolute inset-0 bg-shadow backdrop-" />
          <div className="relative z-10 bg-paper w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="p-8 border-b border-rule flex justify-between items-center">
              <div>
                <h3 className="text-base font-black text-ink tracking-tighter">Record MCF Listing</h3>
                <p className="text-[9px] font-bold text-muted uppercase tracking-widest mt-1">MyCareersFuture 14-Day Compliance</p>
              </div>
              <button onClick={() => setMcfModal(false)} className="text-muted hover:text-ink text-xl font-black">✕</button>
            </div>
            <div className="p-8 flex flex-col gap-4">
              <p className="text-xs text-muted leading-relaxed">Under the Fair Consideration Framework, job postings must be listed on MyCareersFuture for at least 14 days before shortlisting.</p>
              <div className="flex flex-col gap-1.5">
                <label className="text-[9px] font-black text-muted uppercase tracking-widest">MCF Job ID (Reference)</label>
                <input value={mcfForm.mcfJobId} onChange={e => setMcfForm(p => ({ ...p, mcfJobId: e.target.value }))} placeholder="MCF-2026-XXXXXX"
                  className="border border-rule px-4 py-3 text-sm font-bold text-ink focus:outline-none focus:ring-2 focus:ring-accent" />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[9px] font-black text-muted uppercase tracking-widest">Date Posted on MCF *</label>
                <input type="date" value={mcfForm.mcfPostedAt} onChange={e => setMcfForm(p => ({ ...p, mcfPostedAt: e.target.value }))}
                  className="border border-rule px-4 py-3 text-sm font-bold text-ink focus:outline-none focus:ring-2 focus:ring-accent" />
              </div>
            </div>
            <div className="p-8 pt-0 flex gap-3 justify-end">
              <button onClick={() => setMcfModal(false)} className="px-6 py-3 text-[10px] font-black text-ink bg-page border border-rule uppercase tracking-widest">Cancel</button>
              <button onClick={saveMcf} disabled={mcfSaving || !mcfForm.mcfPostedAt}
                className="px-6 py-3 text-[10px] font-black text-paper bg-accent hover:bg-accent uppercase tracking-widest disabled:opacity-50">
                {mcfSaving ? 'Saving…' : 'Record Listing'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Add Candidate Modal ────────────────────────────────────────────────── */}
      {candidateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setCandidateModal(false)}>
          <div className="absolute inset-0 bg-shadow backdrop-" />
          <div className="relative z-10 bg-paper w-full max-w-xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="p-8 border-b border-rule flex justify-between items-center">
              <h3 className="text-lg font-black text-ink tracking-tighter">Add Candidate</h3>
              <button onClick={() => setCandidateModal(false)} className="text-muted hover:text-ink text-xl font-black">✕</button>
            </div>
            <div className="p-8 flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-[9px] font-black text-muted uppercase tracking-widest">Job Opening <span className="text-muted normal-case font-bold">(optional — can be tagged later)</span></label>
                <select value={candidateJobId} onChange={e => setCandidateJobId(e.target.value)}
                  className="border border-rule px-4 py-3 text-sm font-bold text-ink focus:outline-none focus:ring-2 focus:ring-accent">
                  <option value="">— Add to candidate pool —</option>
                  {jobs.filter(j => j.status !== 'CANCELLED').map(j => <option key={j.id} value={j.id}>{j.title}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                {[
                  { key: 'firstName', label: 'First Name *', type: 'text', placeholder: 'John' },
                  { key: 'lastName', label: 'Last Name *', type: 'text', placeholder: 'Doe' },
                  { key: 'email', label: 'Email *', type: 'email', placeholder: 'john@example.com' },
                  { key: 'phone', label: 'Phone', type: 'tel', placeholder: '+65 9123 4567' },
                  { key: 'currentTitle', label: 'Current Title', type: 'text', placeholder: 'e.g. Software Engineer' },
                  { key: 'currentEmployer', label: 'Current Employer', type: 'text', placeholder: 'e.g. Acme Corp' },
                  { key: 'expectedSalary', label: 'Expected Salary (SGD)', type: 'number', placeholder: '5000' },
                  { key: 'noticePeriod', label: 'Notice Period (days)', type: 'number', placeholder: '30' },
                ].map(f => (
                  <div key={f.key} className="flex flex-col gap-1.5">
                    <label className="text-[9px] font-black text-muted uppercase tracking-widest">{f.label}</label>
                    <input type={f.type} value={candidateForm[f.key] || ''} onChange={e => setCandidateForm(p => ({ ...p, [f.key]: e.target.value }))} placeholder={f.placeholder}
                      className="border border-rule px-4 py-3 text-sm font-bold text-ink focus:outline-none focus:ring-2 focus:ring-accent" />
                  </div>
                ))}
              </div>
            </div>
            <div className="p-8 pt-0 flex gap-3 justify-end">
              <button onClick={() => setCandidateModal(false)} className="px-6 py-3 text-[10px] font-black text-ink bg-page border border-rule uppercase tracking-widest">Cancel</button>
              <button onClick={saveCandidate} disabled={candidateSaving || !candidateForm.firstName || !candidateForm.lastName || !candidateForm.email}
                className="px-6 py-3 text-[10px] font-black text-paper bg-accent hover:bg-accent uppercase tracking-widest disabled:opacity-50">
                {candidateSaving ? 'Adding…' : 'Add Candidate'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Schedule Interview Modal ───────────────────────────────────────────── */}
      {interviewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setInterviewModal(false)}>
          <div className="absolute inset-0 bg-shadow backdrop-" />
          <div className="relative z-10 bg-paper w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="p-8 border-b border-rule flex justify-between items-center">
              <h3 className="text-lg font-black text-ink tracking-tighter">Schedule Interview</h3>
              <button onClick={() => setInterviewModal(false)} className="text-muted hover:text-ink text-xl font-black">✕</button>
            </div>
            <div className="p-8 flex flex-col gap-4">
              {(() => { const c = candidates.find(x => x.id === interviewCandidateId); return c ? <p className="text-xs font-bold text-muted">Candidate: <span className="text-ink">{c.firstName} {c.lastName}</span></p> : null; })()}
              <div className="flex flex-col gap-1.5">
                <label className="text-[9px] font-black text-muted uppercase tracking-widest">Round Name *</label>
                <input value={interviewForm.roundName} onChange={e => setInterviewForm(p => ({ ...p, roundName: e.target.value }))} placeholder="e.g. Technical Screen, Culture Fit, Final Round"
                  className="border border-rule px-4 py-3 text-sm font-bold text-ink focus:outline-none focus:ring-2 focus:ring-accent" />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[9px] font-black text-muted uppercase tracking-widest">Scheduled Date & Time *</label>
                <input type="datetime-local" value={interviewForm.scheduledAt} onChange={e => setInterviewForm(p => ({ ...p, scheduledAt: e.target.value }))}
                  className="border border-rule px-4 py-3 text-sm font-bold text-ink focus:outline-none focus:ring-2 focus:ring-accent" />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[9px] font-black text-muted uppercase tracking-widest">Notes</label>
                <textarea rows={3} value={interviewForm.notes} onChange={e => setInterviewForm(p => ({ ...p, notes: e.target.value }))} placeholder="Interview location, topics to cover, or any instructions…"
                  className="border border-rule px-4 py-3 text-sm font-bold text-ink focus:outline-none focus:ring-2 focus:ring-accent resize-none" />
              </div>
            </div>
            <div className="p-8 pt-0 flex gap-3 justify-end">
              <button onClick={() => setInterviewModal(false)} className="px-6 py-3 text-[10px] font-black text-ink bg-page border border-rule uppercase tracking-widest">Cancel</button>
              <button onClick={saveInterview} disabled={interviewSaving || !interviewForm.roundName || !interviewForm.scheduledAt}
                className="px-6 py-3 text-[10px] font-black text-paper bg-accent hover:bg-accent uppercase tracking-widest disabled:opacity-50">
                {interviewSaving ? 'Scheduling…' : 'Schedule Interview'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
