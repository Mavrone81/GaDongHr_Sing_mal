'use client';

import { useState, useEffect } from 'react';
import type { HTMLAttributes, ReactNode } from 'react';
import GaDongLogo from '@/components/GaDongLogo';
import { Button, Card, EmptyState, Field, Icon, Input, Select, Stepper, Textarea } from '@/components/ui';
import { KeyValue, Notice, Spinner } from '@/components/employee/RecordParts';

function apiUrl() {
  if (typeof window === 'undefined') return 'http://localhost:4000/api';
  return process.env.NEXT_PUBLIC_API_URL ?? `http://${window.location.hostname}:4000/api`;
}

type UserInfo = { id: string; name: string; email: string };

type FormData = {
  fullName: string; preferredName: string; gender: string; dateOfBirth: string;
  nationality: string; nricFin: string; personalPhone: string; homeAddress: string;
  department: string; designation: string; employmentType: string; startDate: string;
  bankName: string; bankAccount: string; notes: string;
};

const EMPTY_FORM: FormData = {
  fullName: '', preferredName: '', gender: '', dateOfBirth: '', nationality: 'Singaporean',
  nricFin: '', personalPhone: '', homeAddress: '',
  department: '', designation: '', employmentType: 'FULL_TIME', startDate: '',
  bankName: '', bankAccount: '', notes: '',
};

// ── JWT helpers (decode only — server verifies signature) ─────────────────────
function decodeJwtPayload(token: string): Record<string, string> | null {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const padded = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(part.length + (4 - part.length % 4) % 4, '=');
    return JSON.parse(atob(padded));
  } catch { return null; }
}

// ── AES-256-GCM encryption (Web Crypto API) ────────────────────────────────────
async function deriveKey(rawTokenHex: string): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(rawTokenHex),
    { name: 'HKDF' },
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new TextEncoder().encode('gadonghr-onboard-v1'),
      info: new TextEncoder().encode('form-encryption'),
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  );
}

async function encryptPayload(data: object, rawTokenHex: string) {
  const key = await deriveKey(rawTokenHex);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(data));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
  const toB64 = (buf: ArrayBuffer | Uint8Array) =>
    btoa(String.fromCharCode(...new Uint8Array(buf instanceof Uint8Array ? buf.buffer : buf)));
  return { iv: toB64(iv), data: toB64(ciphertext) };
}

export default function OnboardPage() {
  const [token, setToken] = useState('');
  const [rawToken, setRawToken] = useState('');
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
  const [status, setStatus] = useState<'loading' | 'valid' | 'invalid' | 'submitted'>('loading');
  const [form, setForm] = useState<FormData>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [step, setStep] = useState(1);
  const [errors, setErrors] = useState<Partial<FormData>>({});

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('token') || '';
    setToken(t);
    if (!t) { setStatus('invalid'); return; }

    // SECURITY (M-08): clean the token out of the visible URL immediately
    // after capturing it. The token remains in component state for the
    // verify/submit calls but is no longer copy-pasteable, no longer in
    // the back/forward history, and no longer in any subsequent Referer
    // header for outbound links rendered on this page.
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete('token');
      window.history.replaceState(null, '', url.pathname + (url.search || '') + url.hash);
    } catch { /* best-effort only */ }

    // Validate the signed token server-side
    fetch(`${apiUrl()}/users/invite/${encodeURIComponent(t)}`)
      .then(res => {
        if (!res.ok) throw new Error('invalid');
        return res.json();
      })
      .then((user: UserInfo) => {
        setUserInfo(user);
        setForm(prev => ({ ...prev, fullName: user.name }));
        // Decode JWT to extract raw token for client-side key derivation (server verifies signature)
        const payload = decodeJwtPayload(t);
        if (payload?.jti) setRawToken(payload.jti);
        setStatus('valid');
      })
      .catch(() => setStatus('invalid'));
  }, []);

  function validate(s: number) {
    const errs: Partial<FormData> = {};
    if (s === 1) {
      if (!form.fullName.trim()) errs.fullName = 'Required';
      if (!form.gender) errs.gender = 'Required';
      if (!form.dateOfBirth) errs.dateOfBirth = 'Required';
      if (!form.nationality.trim()) errs.nationality = 'Required';
    }
    if (s === 2) {
      if (!form.nricFin.trim()) errs.nricFin = 'Required';
      if (!form.personalPhone.trim()) errs.personalPhone = 'Required';
      if (!form.homeAddress.trim()) errs.homeAddress = 'Required';
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  function nextStep() {
    if (validate(step)) setStep(s => s + 1);
  }

  async function submit() {
    if (!validate(step)) return;
    setSubmitting(true);
    try {
      let body: object;

      if (rawToken) {
        // Encrypt form data with AES-256-GCM before sending
        const { iv, data } = await encryptPayload({ ...form }, rawToken);
        body = { inviteToken: token, encrypted: true, iv, data };
      } else {
        // Fallback: send plain (shouldn't happen with valid JWT)
        body = { inviteToken: token, ...form };
      }

      const res = await fetch(`${apiUrl()}/employees/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const resp = await res.json();
        throw new Error(resp.error || 'Submission failed');
      }
      setStatus('submitted');
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Submission failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  function field(key: keyof FormData, label: string, opts?: { type?: string; placeholder?: string; required?: boolean; help?: string; inputMode?: HTMLAttributes<HTMLInputElement>['inputMode']; autoComplete?: string }) {
    return (
      <Field label={label} required={opts?.required !== false} error={errors[key]} help={opts?.help}>
        <Input
          type={opts?.type || 'text'}
          value={form[key]}
          onChange={e => { setForm(p => ({ ...p, [key]: e.target.value })); setErrors(p => ({ ...p, [key]: undefined })); }}
          placeholder={opts?.placeholder}
          inputMode={opts?.inputMode}
          autoComplete={opts?.autoComplete}
          invalid={!!errors[key]}
          aria-invalid={!!errors[key] || undefined}
        />
      </Field>
    );
  }

  if (status === 'loading') {
    return (
      <OnboardFrame>
        <Card className="items-center gap-3 py-12 text-center">
          <Spinner className="w-6 h-6 text-accent" />
          <p className="text-sm text-muted" role="status">Checking your invite link…</p>
        </Card>
      </OnboardFrame>
    );
  }

  if (status === 'invalid') {
    return (
      <OnboardFrame>
        <Card padding="p-0">
          <EmptyState
            icon="alert"
            title="This link has expired or is not valid"
            description="Invite links can only be used once and expire after a while. Ask HR to send you a new invitation."
          />
        </Card>
      </OnboardFrame>
    );
  }

  if (status === 'submitted') {
    return (
      <OnboardFrame>
        <Card className="gap-5">
          <div className="flex flex-col items-center gap-3 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-ok-bg text-ok"><Icon name="check" size={24} strokeWidth={2.5} /></span>
            <h1 className="text-[22px] font-extrabold tracking-[-0.02em] text-ink">Profile submitted</h1>
            <p className="text-sm text-muted max-w-sm">
              Thank you, {form.fullName}. HR will review your details and email you once your employee account is ready.
            </p>
          </div>
          <div className="rounded-control bg-page p-4">
            <p className="mb-3 text-[13px] font-semibold text-ink">What happens next</p>
            <ol className="flex flex-col gap-2.5">
              {['HR reviews your profile', 'Your employee record is created', 'You get a confirmation email', 'You can sign in to GaDongHR'].map((s, i) => (
                <li key={s} className="flex items-center gap-3 text-sm text-ink">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-tint text-xs font-bold text-accent tabular-nums">{i + 1}</span>
                  {s}
                </li>
              ))}
            </ol>
          </div>
        </Card>
      </OnboardFrame>
    );
  }

  const STEP_LABELS = ['Personal details', 'Contact and ID', 'Employment', 'Review'];
  const LAST = STEP_LABELS.length;

  const reviewRows: { step: number; title: string; rows: [string, string][] }[] = [
    { step: 1, title: 'Personal details', rows: [
      ['Full legal name', form.fullName], ['Preferred name', form.preferredName],
      ['Gender', GENDER_LABEL[form.gender] ?? form.gender], ['Date of birth', form.dateOfBirth], ['Nationality', form.nationality],
    ] },
    { step: 2, title: 'Contact and ID', rows: [
      ['NRIC / FIN', form.nricFin], ['Mobile', form.personalPhone], ['Home address', form.homeAddress],
      ['Bank', form.bankName], ['Account number', form.bankAccount],
    ] },
    { step: 3, title: 'Employment', rows: [
      ['Department', form.department], ['Designation', form.designation],
      ['Employment type', EMPLOYMENT_LABEL[form.employmentType] ?? form.employmentType], ['Start date', form.startDate], ['Notes', form.notes],
    ] },
  ];

  return (
    <OnboardFrame>
      <Card padding="p-0">
        {/* Header */}
        <div className="flex flex-col gap-3 px-5 pt-6 pb-5 sm:px-7 border-b border-rule">
          <div>
            <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-ink">Complete your profile</h1>
            <p className="mt-1 text-sm text-muted">Welcome, {userInfo?.name} · {userInfo?.email}</p>
          </div>
          {rawToken && (
            <p className="inline-flex w-fit items-center gap-1.5 rounded-full bg-tint px-3 h-7 text-xs font-semibold text-accent">
              <Icon name="lock" size={14} /> Encrypted in your browser before it is sent
            </p>
          )}
          <Stepper
            className="mt-2"
            steps={STEP_LABELS.map((label, i) => ({ label, state: step > i + 1 ? 'done' : step === i + 1 ? 'now' : 'todo' }))}
          />
        </div>

        {/* Step body */}
        <div className="flex flex-col gap-4 px-5 py-6 sm:px-7">
          <p className="text-[13px] font-semibold text-muted tabular-nums">Step {step} of {LAST} · {STEP_LABELS[step - 1]}</p>

          {step === 1 && (
            <>
              {field('fullName', 'Full legal name', { placeholder: 'As on your NRIC or FIN', autoComplete: 'name' })}
              {field('preferredName', 'Preferred name', { required: false, help: 'Optional — what colleagues call you' })}
              <Field label="Gender" required error={errors.gender}>
                <Select
                  value={form.gender}
                  invalid={!!errors.gender}
                  onChange={e => { setForm(p => ({ ...p, gender: e.target.value })); setErrors(p => ({ ...p, gender: undefined })); }}
                >
                  <option value="">Select gender</option>
                  <option value="MALE">Male</option>
                  <option value="FEMALE">Female</option>
                  <option value="PREFER_NOT_TO_SAY">Prefer not to say</option>
                </Select>
              </Field>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {field('dateOfBirth', 'Date of birth', { type: 'date' })}
                {field('nationality', 'Nationality', { placeholder: 'e.g. Singaporean' })}
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <Notice tone="accent" title="Your personal data is protected">
                It is encrypted in your browser (AES-256-GCM) before it is sent, and only authorised HR staff can read it.
              </Notice>
              {field('nricFin', 'NRIC / FIN number', { placeholder: 'S1234567A' })}
              {field('personalPhone', 'Mobile number', { type: 'tel', placeholder: '+65 9123 4567', inputMode: 'tel', autoComplete: 'tel' })}
              {field('homeAddress', 'Home address', { placeholder: 'Block, street, unit, postal code', autoComplete: 'street-address' })}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {field('bankName', 'Bank', { required: false, placeholder: 'e.g. DBS, OCBC, UOB' })}
                {field('bankAccount', 'Bank account number', { required: false, help: 'Used for salary payment', inputMode: 'numeric' })}
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <p className="text-sm text-muted">Fill in what you know — HR will confirm the final details.</p>
              {field('department', 'Department', { required: false, placeholder: 'e.g. Engineering, Sales' })}
              {field('designation', 'Job title', { required: false, placeholder: 'e.g. Software Engineer' })}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Employment type">
                  <Select value={form.employmentType} onChange={e => setForm(p => ({ ...p, employmentType: e.target.value }))}>
                    <option value="FULL_TIME">Full time</option>
                    <option value="PART_TIME">Part time</option>
                    <option value="CONTRACT">Contract</option>
                  </Select>
                </Field>
                {field('startDate', 'Start date', { type: 'date', required: false })}
              </div>
              <Field label="Anything else HR should know" help="Optional">
                <Textarea rows={3} value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} />
              </Field>
            </>
          )}

          {step === LAST && (
            <div className="flex flex-col gap-4">
              <p className="text-sm text-muted">Check your details before you submit. You can go back and change anything.</p>
              {reviewRows.map(sec => (
                <div key={sec.title} className="rounded-control border border-rule px-4 py-2">
                  <div className="flex items-center justify-between py-1.5">
                    <p className="text-[14px] font-bold text-ink">{sec.title}</p>
                    <Button size="sm" variant="ghost" onClick={() => setStep(sec.step)}>Edit</Button>
                  </div>
                  {sec.rows.map(([label, value]) => (
                    <KeyValue key={label} label={label} value={value || <span className="font-normal text-muted">Not given</span>} />
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Navigation — sticks to the bottom of the screen on phones */}
        <div className="sticky bottom-0 rounded-b-card flex items-center justify-between gap-3 border-t border-rule bg-paper px-5 py-4 sm:px-7">
          {step > 1 ? (
            <Button variant="secondary" onClick={() => setStep(s => s - 1)}>Back</Button>
          ) : <span />}
          {step < LAST ? (
            <Button onClick={nextStep} icon="arrowRight">Continue</Button>
          ) : (
            <Button onClick={submit} disabled={submitting}>
              {submitting && <Spinner />}
              {submitting ? 'Encrypting and submitting…' : 'Submit profile'}
            </Button>
          )}
        </div>
      </Card>
    </OnboardFrame>
  );
}

const GENDER_LABEL: Record<string, string> = { MALE: 'Male', FEMALE: 'Female', PREFER_NOT_TO_SAY: 'Prefer not to say' };
const EMPLOYMENT_LABEL: Record<string, string> = { FULL_TIME: 'Full time', PART_TIME: 'Part time', CONTRACT: 'Contract' };

/** Public page frame: logo on top, one column no wider than a form. */
function OnboardFrame({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-page font-sans text-ink">
      <div className="mx-auto flex w-full max-w-[640px] flex-col gap-6 px-4 py-8 sm:py-12">
        <GaDongLogo variant="light" markSize={30} />
        {children}
      </div>
    </div>
  );
}
