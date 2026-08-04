'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';

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

const LIKERT_DEFAULT_LABELS = ['Strongly Disagree', 'Disagree', 'Neutral', 'Agree', 'Strongly Agree'];

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
        apiFetch(`/surveys/${id}`).then(r => r.json()),
        apiFetch(`/surveys/${id}/responses/me`).then(r => r.json()).catch(() => ({ submitted: false })),
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
    const res = await apiFetch(`/surveys/${id}/responses`, {
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
    return <div className="flex items-center justify-center min-h-[400px]"><div className="w-10 h-10 border-4 border-accent border-t-accent animate-spin rounded-full" /></div>;
  }
  if (error || !survey) {
    return (
      <div className="max-w-2xl mx-auto mt-16 text-center">
        <h2 className="text-lg font-black text-ink mb-2">Survey Not Found</h2>
        <p className="text-sm text-muted mb-6">{error}</p>
        <Link href="/surveys" className="text-xs font-bold text-accent hover:text-accent">← Back to Surveys</Link>
      </div>
    );
  }
  if (submitted) {
    return (
      <div className="max-w-2xl mx-auto mt-16 text-center bg-paper border border-accent p-8 sm:p-12">
        <div className="w-16 h-16 bg-page flex items-center justify-center mx-auto mb-4">
          <span className="text-3xl">◉</span>
        </div>
        <h2 className="text-xl font-black text-accent mb-2">Thank you!</h2>
        <p className="text-sm text-muted">Your response has been recorded {survey.anonymous ? 'anonymously' : ''}.</p>
        <p className="text-xs text-muted mt-3">Returning to surveys list…</p>
      </div>
    );
  }
  if (alreadySubmitted) {
    return (
      <div className="max-w-2xl mx-auto mt-16 text-center bg-paper border border-rule p-8 sm:p-12">
        <h2 className="text-lg font-black text-ink mb-2">Already Submitted</h2>
        <p className="text-sm text-muted mb-6">You have already submitted this survey. Thank you!</p>
        <Link href="/surveys" className="text-xs font-bold text-accent hover:text-accent">← Back to Surveys</Link>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <Link href="/surveys" className="text-xs font-bold text-muted hover:text-accent">← Back to Surveys</Link>
        {survey.anonymous && <span className="px-2.5 py-1 text-[10px] font-black uppercase tracking-widest bg-page text-accent">◍ Anonymous</span>}
      </div>

      <div className="bg-paper border border-rule p-4 sm:p-6">
        <p className="text-xs font-mono font-black text-muted mb-1">{survey.code}</p>
        <h1 className="text-xl font-black text-ink mb-1">{survey.title}</h1>
        {survey.description && <p className="text-sm text-ink mt-2">{survey.description}</p>}
        {survey.anonymous && (
          <div className="mt-3 p-3 bg-page border border-accent text-xs text-accent">
            <strong>This survey is anonymous.</strong> Your name and ID will not be linked to your responses. Department/tenure may be captured for segmentation only.
          </div>
        )}
      </div>

      {/* Questions */}
      <div className="space-y-4">
        {survey.questions.map((q, idx) => (
          <QuestionCard
            key={q.id}
            num={idx + 1}
            question={q}
            value={answers[q.id]}
            onChange={(v) => setAnswer(q.id, v)}
          />
        ))}
      </div>

      {error && <div className="p-3 bg-page border border-ink text-sm text-ink font-bold">{error}</div>}

      {/* Submit */}
      <div className="bg-paper border border-rule p-4 sm:p-6 flex flex-col sm:flex-row gap-3 sm:items-center justify-between">
        <p className="text-xs text-muted">Required questions are marked with <span className="text-ink font-bold">*</span></p>
        <button
          onClick={submit}
          disabled={submitting}
          className="px-6 py-3 bg-accent text-paper text-xs font-black uppercase tracking-widest hover:bg-accent disabled:opacity-50 transition-all"
        >
          {submitting ? 'Submitting…' : 'Submit Response'}
        </button>
      </div>
    </div>
  );
}

function QuestionCard({ num, question, value, onChange }: {
  num: number;
  question: Question;
  value: { numericValue?: number; textValue?: string } | undefined;
  onChange: (v: { numericValue?: number; textValue?: string }) => void;
}) {
  const labels = question.scaleLabels?.length === 5 ? question.scaleLabels : LIKERT_DEFAULT_LABELS;

  return (
    <div className="bg-paper border border-rule p-4 sm:p-6">
      <div className="flex items-start gap-2 mb-3">
        <span className="text-xs font-mono font-black text-muted mt-0.5">Q{num}</span>
        <h3 className="text-sm font-black text-ink flex-1">
          {question.text}{question.required && <span className="text-ink"> *</span>}
        </h3>
      </div>

      {question.type === 'LIKERT_5' && (
        <div className="grid grid-cols-5 gap-2">
          {[1,2,3,4,5].map(n => (
            <button
              key={n}
              onClick={() => onChange({ numericValue: n })}
              className={`flex flex-col items-center p-2 sm:p-3  border-2 transition-all ${
                value?.numericValue === n
                  ? 'border-accent bg-page text-accent'
                  : 'border-rule hover:border-accent text-ink'
              }`}
            >
              <span className="text-lg sm:text-2xl font-black">{n}</span>
              <span className="text-[9px] sm:text-[10px] font-bold mt-1 text-center leading-tight">{labels[n - 1]}</span>
            </button>
          ))}
        </div>
      )}

      {question.type === 'NPS' && (
        <div>
          <div className="grid grid-cols-11 gap-1">
            {[0,1,2,3,4,5,6,7,8,9,10].map(n => (
              <button
                key={n}
                onClick={() => onChange({ numericValue: n })}
                className={`py-2 sm:py-3  border-2 text-xs sm:text-sm font-black transition-all ${
                  value?.numericValue === n
                    ? (n >= 9 ? 'border-accent bg-page text-accent' :
                       n >= 7 ? 'border-highlight bg-page text-ink' :
                                'border-ink bg-page text-ink')
                    : 'border-rule hover:border-rule text-ink'
                }`}
              >
                {n}
              </button>
            ))}
          </div>
          <div className="flex justify-between mt-2 text-[10px] font-bold text-muted uppercase tracking-wider">
            <span>Not at all likely</span>
            <span>Extremely likely</span>
          </div>
        </div>
      )}

      {question.type === 'MULTI_CHOICE' && (
        <div className="space-y-2">
          {question.choices.map((choice, i) => (
            <label key={i} className={`flex items-center gap-3 p-3  border-2 cursor-pointer transition-all ${
              value?.numericValue === i ? 'border-accent bg-page' : 'border-rule hover:border-accent'
            }`}>
              <input
                type="radio"
                name={`q-${question.id}`}
                checked={value?.numericValue === i}
                onChange={() => onChange({ numericValue: i, textValue: choice })}
                className="accent-accent"
              />
              <span className="text-sm font-medium text-ink">{choice}</span>
            </label>
          ))}
        </div>
      )}

      {question.type === 'TEXT' && (
        <textarea
          rows={4}
          value={value?.textValue || ''}
          onChange={e => onChange({ textValue: e.target.value })}
          placeholder="Type your answer here…"
          className="w-full border border-rule px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent resize-none"
        />
      )}
    </div>
  );
}
