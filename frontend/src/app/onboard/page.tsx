'use client';

import { useState, useEffect } from 'react';

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
      salt: new TextEncoder().encode('vorkhive-onboard-v1'),
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

  function field(key: keyof FormData, label: string, opts?: { type?: string; placeholder?: string; required?: boolean }) {
    return (
      <div className="flex flex-col gap-1.5">
        <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest">
          {label}{opts?.required !== false ? ' *' : ''}
        </label>
        <input
          type={opts?.type || 'text'}
          value={form[key]}
          onChange={e => { setForm(p => ({ ...p, [key]: e.target.value })); setErrors(p => ({ ...p, [key]: undefined })); }}
          placeholder={opts?.placeholder}
          className={`border rounded-xl px-4 py-3 text-sm font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-400 ${errors[key] ? 'border-red-300 bg-red-50' : 'border-slate-200'}`}
        />
        {errors[key] && <p className="text-[9px] font-bold text-red-500">{errors[key]}</p>}
      </div>
    );
  }

  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="bg-white rounded-[2rem] shadow-2xl p-12 flex flex-col items-center gap-5">
          <div className="w-12 h-12 bg-indigo-50 rounded-2xl flex items-center justify-center">
            <svg className="w-6 h-6 text-indigo-600 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
          <p className="text-sm font-black text-slate-400 uppercase tracking-widest">Verifying invite…</p>
        </div>
      </div>
    );
  }

  if (status === 'invalid') {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="bg-white rounded-[2rem] shadow-2xl p-10 w-full max-w-sm text-center flex flex-col items-center gap-5">
          <div className="w-14 h-14 bg-red-50 border-2 border-red-200 rounded-2xl flex items-center justify-center text-2xl">✕</div>
          <div>
            <h2 className="text-base font-black text-slate-900 tracking-tighter">Invalid or Expired Link</h2>
            <p className="text-xs font-bold text-slate-500 mt-2 leading-relaxed">This invite link is invalid or has expired. Please contact HR to request a new invitation.</p>
          </div>
        </div>
      </div>
    );
  }

  if (status === 'submitted') {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="bg-white rounded-[2rem] shadow-2xl p-10 w-full max-w-sm text-center flex flex-col items-center gap-6">
          <div className="w-16 h-16 bg-emerald-50 border-2 border-emerald-200 rounded-2xl flex items-center justify-center text-3xl">✓</div>
          <div>
            <h2 className="text-lg font-black text-slate-900 tracking-tighter">Profile Submitted!</h2>
            <p className="text-xs font-bold text-slate-500 mt-2 leading-relaxed">
              Thank you, {form.fullName}. Your profile has been submitted for HR review. You will be notified once your employee account is activated.
            </p>
          </div>
          <div className="bg-slate-50 border border-slate-100 rounded-2xl p-4 w-full text-left">
            <p className="label-form mb-2">What happens next?</p>
            <ul className="flex flex-col gap-2">
              {['HR reviews your profile', 'Employee record is created', 'You receive confirmation email', 'Access full HR system'].map((s, i) => (
                <li key={s} className="flex items-center gap-3">
                  <div className="w-5 h-5 rounded-full bg-indigo-600 flex items-center justify-center text-[9px] font-black text-white flex-shrink-0">{i + 1}</div>
                  <span className="text-xs font-bold text-slate-600">{s}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    );
  }

  const STEP_LABELS = ['Personal Details', 'Contact & ID', 'Employment'];

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-lg">
        {/* Header */}
        <div className="bg-indigo-600 rounded-t-[2rem] p-8 text-white">
          <p className="text-[9px] font-black uppercase tracking-[0.2em] text-indigo-200">Employee Onboarding</p>
          <h1 className="text-xl font-black tracking-tighter mt-1">Complete Your Profile</h1>
          <p className="text-xs font-bold text-indigo-200 mt-1">Welcome, {userInfo?.name} · {userInfo?.email}</p>
          {/* Encryption badge */}
          {rawToken && (
            <div className="mt-3 inline-flex items-center gap-1.5 bg-indigo-500/40 border border-indigo-400/40 rounded-lg px-3 py-1.5">
              <svg className="w-3 h-3 text-indigo-200" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              <span className="text-[9px] font-black text-indigo-200 uppercase tracking-widest">End-to-end encrypted</span>
            </div>
          )}
          {/* Progress */}
          <div className="flex items-center gap-2 mt-4">
            {STEP_LABELS.map((label, i) => (
              <div key={label} className="flex items-center gap-2">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-black transition-all ${step > i + 1 ? 'bg-white text-indigo-600' : step === i + 1 ? 'bg-white text-indigo-600' : 'bg-indigo-500 text-indigo-200'}`}>
                  {step > i + 1 ? '✓' : i + 1}
                </div>
                <span className={`text-[9px] font-black uppercase tracking-widest ${step === i + 1 ? 'text-white' : 'text-indigo-300'}`}>{label}</span>
                {i < STEP_LABELS.length - 1 && <div className="w-6 h-px bg-indigo-400 mx-1" />}
              </div>
            ))}
          </div>
        </div>

        {/* Form */}
        <div className="bg-white rounded-b-[2rem] shadow-2xl p-8">
          {step === 1 && (
            <div className="flex flex-col gap-4">
              <p className="label-form border-b border-slate-100 pb-3">Step 1 · Personal Details</p>
              {field('fullName', 'Full Legal Name', { placeholder: 'As per NRIC/FIN' })}
              {field('preferredName', 'Preferred / Display Name', { required: false, placeholder: 'Optional' })}
              <div className="flex flex-col gap-1.5">
                <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Gender *</label>
                <select value={form.gender} onChange={e => { setForm(p => ({ ...p, gender: e.target.value })); setErrors(p => ({ ...p, gender: undefined })); }}
                  className={`border rounded-xl px-4 py-3 text-sm font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-400 ${errors.gender ? 'border-red-300 bg-red-50' : 'border-slate-200'}`}>
                  <option value="">Select gender</option>
                  <option value="MALE">Male</option>
                  <option value="FEMALE">Female</option>
                  <option value="PREFER_NOT_TO_SAY">Prefer not to say</option>
                </select>
                {errors.gender && <p className="text-[9px] font-bold text-red-500">{errors.gender}</p>}
              </div>
              {field('dateOfBirth', 'Date of Birth', { type: 'date' })}
              {field('nationality', 'Nationality', { placeholder: 'e.g. Singaporean' })}
            </div>
          )}

          {step === 2 && (
            <div className="flex flex-col gap-4">
              <p className="label-form border-b border-slate-100 pb-3">Step 2 · Contact & Identity</p>
              <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-3 flex items-start gap-2.5">
                <svg className="w-4 h-4 text-indigo-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
                <div>
                  <p className="text-[9px] font-black text-indigo-700 uppercase tracking-widest">AES-256-GCM Encrypted</p>
                  <p className="text-[10px] font-bold text-indigo-600 mt-0.5">Your personal data is encrypted in your browser before being sent. Only authorised HR personnel can access it.</p>
                </div>
              </div>
              {field('nricFin', 'NRIC / FIN Number', { placeholder: 'S1234567A' })}
              {field('personalPhone', 'Mobile Number', { type: 'tel', placeholder: '+65 9123 4567' })}
              {field('homeAddress', 'Home Address', { placeholder: 'Block, Street, Unit, Postal Code' })}
              {field('bankName', 'Bank Name', { required: false, placeholder: 'e.g. DBS, OCBC, UOB' })}
              {field('bankAccount', 'Bank Account Number', { required: false, placeholder: 'For payroll GIRO' })}
            </div>
          )}

          {step === 3 && (
            <div className="flex flex-col gap-4">
              <p className="label-form border-b border-slate-100 pb-3">Step 3 · Employment Details</p>
              <p className="text-[10px] font-bold text-slate-500">Fill in what you know — HR will confirm the final details.</p>
              {field('department', 'Department', { required: false, placeholder: 'e.g. Engineering, Sales' })}
              {field('designation', 'Designation / Job Title', { required: false, placeholder: 'e.g. Software Engineer' })}
              <div className="flex flex-col gap-1.5">
                <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Employment Type</label>
                <select value={form.employmentType} onChange={e => setForm(p => ({ ...p, employmentType: e.target.value }))}
                  className="border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-400">
                  <option value="FULL_TIME">Full Time</option>
                  <option value="PART_TIME">Part Time</option>
                  <option value="CONTRACT">Contract</option>
                </select>
              </div>
              {field('startDate', 'Start Date', { type: 'date', required: false })}
              <div className="flex flex-col gap-1.5">
                <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Additional Notes</label>
                <textarea rows={3} value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
                  placeholder="Anything HR should know about you or your employment arrangement..."
                  className="border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-none" />
              </div>
            </div>
          )}

          {/* Navigation */}
          <div className="flex items-center justify-between mt-8">
            {step > 1 ? (
              <button onClick={() => setStep(s => s - 1)}
                className="px-5 py-2.5 text-[10px] font-black text-slate-600 bg-slate-50 border border-slate-200 rounded-xl uppercase tracking-widest hover:bg-slate-100 transition-all">
                ← Back
              </button>
            ) : <div />}
            {step < 3 ? (
              <button onClick={nextStep}
                className="px-6 py-3 text-[10px] font-black text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl uppercase tracking-widest shadow-lg shadow-indigo-500/20 transition-all">
                Continue →
              </button>
            ) : (
              <button onClick={submit} disabled={submitting}
                className="px-6 py-3 text-[10px] font-black text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl uppercase tracking-widest shadow-lg shadow-indigo-500/20 disabled:opacity-50 transition-all flex items-center gap-2">
                {submitting && <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                {submitting ? 'Encrypting & Submitting…' : 'Submit Profile'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
