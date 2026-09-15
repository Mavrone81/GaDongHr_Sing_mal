'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { apiFetchRaw } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { Card, Badge, Button, Textarea, EmptyState, Icon } from '@/components/ui';

interface Question {
  id: string;
  type: 'LIKERT_5' | 'NPS' | 'TEXT' | 'MULTI_CHOICE';
  text: string;
  required: boolean;
  displayOrder: number;
  choices: string[];
  scaleLabels: string[];
  category: string | null;
}

interface Survey {
  id: string;
  code: string;
  title: string;
  description: string | null;
  type: string;
  status: string;
  anonymous: boolean;
  questions: Question[];
}

const LIKERT_DEFAULT_LABELS = ['Strongly disagree', 'Disagree', 'Neutral', 'Agree', 'Strongly agree'];

const LINK_BUTTON = 'inline-flex items-center justify-center gap-2 h-10 px-4 rounded-control border border-rule bg-paper text-sm font-semibold text-ink whitespace-nowrap hover:bg-pill';

export default function TakeSurveyPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();

  const [survey, setSurvey] = useState<Survey | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [answers, setAnswers] = useState<Record<string, { numericValue?: number; textValue?: string }>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [alreadySubmitted, setAlreadySubmitted] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [sRes, meRes] = await Promise.all([
        apiFetchRaw(`/surveys/${id}`).then(r => r.json()),
        apiFetchRaw(`/surveys/${id}/responses/me`).then(r => r.json()).catch(() => ({ submitted: false })),
      ]);
      if (sRes.error) { setError(sRes.error); return; }
      setSurvey(sRes);
      if (meRes.submitted) setAlreadySubmitted(true);
    } catch { setError('Failed to load survey'); }
    finally { setLoading(false); }
  }
  useEffect(() => { if (id) load(); }, [id]);

  function setAnswer(qid: string, value: { numericValue?: number; textValue?: string }) {
    setAnswers(prev => ({ ...prev, [qid]: { ...prev[qid], ...value } }));
  }

  async function submit() {
    if (!survey) return;
    setSubmitting(true); setError('');
    const payload = {
      department: (user as any)?.department || null,
      tenureMonths: null,
      answers: survey.questions.map(q => ({
        questionId: q.id,
        numericValue: answers[q.id]?.numericValue,
        textValue: answers[q.id]?.textValue,
      })).filter(a => a.numericValue !== undefined || a.textValue),
    };
    const res = await apiFetchRaw(`/surveys/${id}/responses`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (res.ok) {
      setSubmitted(true);
      setTimeout(() => router.push('/surveys'), 2500);
    } else {
      setError(data.error || 'Submission failed');
    }
    setSubmitting(false);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="w-9 h-9 border-2 border-rule border-t-accent animate-spin rounded-full" role="status" aria-label="Loading survey" />
      </div>
    );
  }
  if (error && !survey) {
    return (
      <Card padding="p-0" className="max-w-[640px] mx-auto mt-10">
        <EmptyState
          icon="alert"
          title="Survey not found"
          description={error}
          action={<Link href="/surveys" className={LINK_BUTTON}>Back to surveys</Link>}
        />
      </Card>
    );
  }
  if (!survey) {
    return (
      <Card padding="p-0" className="max-w-[640px] mx-auto mt-10">
        <EmptyState
          icon="alert"
          title="Survey not found"
          action={<Link href="/surveys" className={LINK_BUTTON}>Back to surveys</Link>}
        />
      </Card>
    );
  }
  if (submitted) {
    return (
      <Card padding="p-0" className="max-w-[640px] mx-auto mt-10">
        <EmptyState
          icon="check"
          title="Thank you"
          description={<>Your response has been recorded{survey.anonymous ? ' anonymously' : ''}. Taking you back to your surveys…</>}
        />
      </Card>
    );
  }
  if (alreadySubmitted) {
    return (
      <Card padding="p-0" className="max-w-[640px] mx-auto mt-10">
        <EmptyState
          icon="check"
          title="Already submitted"
          description="You have already answered this survey. Thank you."
          action={<Link href="/surveys" className={LINK_BUTTON}>Back to surveys</Link>}
        />
      </Card>
    );
  }

  const total = survey.questions.length;

  return (
    <div className="flex flex-col gap-4 max-w-[640px] mx-auto w-full">
      <Link href="/surveys" className="self-start inline-flex items-center gap-1.5 h-8 -ml-1 px-1 rounded-control text-[13px] font-semibold text-muted hover:text-accent">
        <Icon name="chevronRight" size={16} className="rotate-180" /> All surveys
      </Link>

      <Card padding="p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <span className="text-[13px] text-muted">{survey.code}</span>
          {survey.anonymous && <Badge tone="accent">Anonymous</Badge>}
        </div>
        <h1 className="text-[26px] font-extrabold tracking-[-0.02em] leading-[1.15] text-ink">{survey.title}</h1>
        {survey.description && <p className="text-sm text-muted mt-2">{survey.description}</p>}
        {survey.anonymous && (
          <div className="flex items-start gap-2.5 mt-4 px-3.5 py-3 rounded-control bg-tint text-[13px] text-ink">
            <Icon name="shield" size={17} className="text-accent mt-px" />
            <p>
              <strong className="font-semibold">This survey is anonymous.</strong> Your name and ID are not linked to your answers.
              Your department and length of service may be recorded so results can be grouped.
            </p>
          </div>
        )}
      </Card>

      {survey.questions.map((q, idx) => (
        <QuestionCard
          key={q.id}
          num={idx + 1}
          total={total}
          question={q}
          value={answers[q.id]}
          onChange={(v) => setAnswer(q.id, v)}
        />
      ))}

      {error && (
        <div role="alert" className="flex items-start gap-2.5 px-3.5 py-3 rounded-control bg-danger-bg text-[13px] text-danger">
          <Icon name="alert" size={17} className="mt-px" />
          {error}
        </div>
      )}

      {/* Sticky on phones so Submit is never below the fold; clears the shell's bottom bar. */}
      <div className="sticky bottom-16 lg:bottom-0 z-10 -mx-4 sm:mx-0 px-4 sm:px-5 py-3 sm:py-4 bg-paper border-t sm:border border-rule sm:rounded-card sm:shadow-card flex items-center justify-between gap-3">
        <p className="text-[13px] text-muted">Questions marked Required need an answer.</p>
        <Button onClick={submit} disabled={submitting}>
          {submitting ? 'Submitting…' : 'Submit response'}
        </Button>
      </div>
    </div>
  );
}

function QuestionCard({ num, total, question, value, onChange }: {
  num: number;
  total: number;
  question: Question;
  value: { numericValue?: number; textValue?: string } | undefined;
  onChange: (v: { numericValue?: number; textValue?: string }) => void;
}) {
  const labels = question.scaleLabels?.length === 5 ? question.scaleLabels : LIKERT_DEFAULT_LABELS;
  const headingId = `q-${question.id}-text`;

  const choiceClass = (on: boolean) =>
    `rounded-control border transition-colors ${on ? 'border-accent bg-tint text-accent' : 'border-rule bg-paper text-ink hover:border-accent'}`;

  return (
    <Card padding="p-5 sm:p-6">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[13px] font-semibold text-muted tabular-nums">Question {num} of {total}</span>
        {question.required && <Badge tone="neutral">Required</Badge>}
      </div>
      <h2 id={headingId} className="text-[15.5px] font-bold text-ink mb-4">{question.text}</h2>

      {question.type === 'LIKERT_5' && (
        <div role="radiogroup" aria-labelledby={headingId} className="grid grid-cols-5 gap-2">
          {[1,2,3,4,5].map(n => {
            const on = value?.numericValue === n;
            return (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => onChange({ numericValue: n })}
                className={`flex flex-col items-center gap-1 px-1 py-2.5 sm:py-3 ${choiceClass(on)}`}
              >
                <span className="text-lg sm:text-xl font-extrabold tabular-nums">{n}</span>
                <span className="text-xs font-medium text-center leading-tight">{labels[n - 1]}</span>
              </button>
            );
          })}
        </div>
      )}

      {question.type === 'NPS' && (
        <div>
          <div role="radiogroup" aria-labelledby={headingId} className="grid grid-cols-6 sm:grid-cols-11 gap-1.5">
            {[0,1,2,3,4,5,6,7,8,9,10].map(n => {
              const on = value?.numericValue === n;
              return (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  aria-label={`${n} out of 10`}
                  onClick={() => onChange({ numericValue: n })}
                  className={`h-10 text-sm font-bold tabular-nums ${choiceClass(on)}`}
                >
                  {n}
                </button>
              );
            })}
          </div>
          <div className="flex justify-between mt-2 text-xs text-muted">
            <span>0 — Not at all likely</span>
            <span>10 — Extremely likely</span>
          </div>
        </div>
      )}

      {question.type === 'MULTI_CHOICE' && (
        <div role="radiogroup" aria-labelledby={headingId} className="flex flex-col gap-2">
          {question.choices.map((choice, i) => {
            const on = value?.numericValue === i;
            return (
              <label key={i} className={`flex items-center gap-3 px-3.5 py-3 cursor-pointer ${choiceClass(on)}`}>
                <input
                  type="radio"
                  name={`q-${question.id}`}
                  checked={on}
                  onChange={() => onChange({ numericValue: i, textValue: choice })}
                  className="w-4 h-4 accent-accent"
                />
                <span className="text-sm font-medium text-ink">{choice}</span>
              </label>
            );
          })}
        </div>
      )}

      {question.type === 'TEXT' && (
        <Textarea
          rows={4}
          aria-labelledby={headingId}
          value={value?.textValue || ''}
          onChange={e => onChange({ textValue: e.target.value })}
          placeholder="Type your answer here…"
        />
      )}
    </Card>
  );
}
