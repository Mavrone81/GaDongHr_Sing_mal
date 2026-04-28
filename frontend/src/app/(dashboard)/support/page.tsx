'use client';

import { useState } from 'react';

export default function SupportPage() {
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [category, setCategory] = useState('General');
  const [submitted, setSubmitted] = useState(false);

  const faqs = [
    { q: 'How do I apply for leave?', a: 'Navigate to My Leave → Apply Leave. Select leave type, dates, and submit for approval.' },
    { q: 'How do I view my payslip?', a: 'Go to My Payslips and select the relevant pay period to download your PDF payslip.' },
    { q: 'How do I submit an expense claim?', a: 'Go to My Claims → New Claim. Fill in the amount, category, and upload your receipt.' },
    { q: 'How do I update my personal details?', a: 'Contact HR Admin to update personal information such as bank account or emergency contact.' },
    { q: 'Who approves my leave?', a: 'L1 approval is your Line Manager. L2 approval is HR. Both must approve for long-duration leaves.' },
  ];

  return (
    <div className="flex flex-col gap-10 max-w-[1000px] mx-auto pb-20 animate-in fade-in duration-700">
      {/* Header */}
      <div className="bg-white p-10 rounded-[2.5rem] border border-slate-100 shadow-2xl shadow-indigo-500/5 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-32 h-32 bg-sky-500/5 rounded-full blur-3xl"></div>
        <div className="flex items-center gap-3 mb-2">
          <div className="w-2 h-2 bg-sky-500 rounded-full"></div>
          <span className="text-[10px] font-black text-sky-600 uppercase tracking-[0.4em]">Employee Support</span>
        </div>
        <h1 className="text-4xl font-black text-slate-900 tracking-tighter">Help <span className="text-sky-600">& Support</span></h1>
        <p className="text-sm font-bold text-slate-400 mt-2 uppercase tracking-widest">Raise a ticket or find answers in the knowledge base.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* FAQ */}
        <div className="bg-white rounded-[2rem] border border-slate-100 shadow-2xl shadow-indigo-500/5 overflow-hidden">
          <div className="p-7 border-b border-slate-50 flex items-center gap-4">
            <div className="w-2 h-6 bg-sky-500 rounded-full"></div>
            <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest">Quick Answers</h3>
          </div>
          <div className="divide-y divide-slate-50">
            {faqs.map((f) => (
              <details key={f.q} className="group">
                <summary className="flex items-center justify-between px-7 py-5 cursor-pointer list-none hover:bg-slate-50 transition-all">
                  <span className="text-[11px] font-black text-slate-700 uppercase tracking-tight group-open:text-indigo-600 transition-colors">{f.q}</span>
                  <span className="text-slate-300 group-open:rotate-90 transition-transform duration-300 text-lg">›</span>
                </summary>
                <div className="px-7 pb-5">
                  <p className="text-[10px] font-bold text-slate-500 leading-relaxed">{f.a}</p>
                </div>
              </details>
            ))}
          </div>
        </div>

        {/* Ticket Form */}
        <div className="bg-white rounded-[2rem] border border-slate-100 shadow-2xl shadow-indigo-500/5 overflow-hidden">
          <div className="p-7 border-b border-slate-50 flex items-center gap-4">
            <div className="w-2 h-6 bg-indigo-600 rounded-full"></div>
            <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest">Raise a Ticket</h3>
          </div>
          {submitted ? (
            <div className="p-10 flex flex-col items-center gap-4 text-center">
              <div className="w-16 h-16 bg-emerald-50 border border-emerald-100 rounded-3xl flex items-center justify-center text-2xl">✓</div>
              <h4 className="text-sm font-black text-slate-900 uppercase tracking-widest">Ticket Submitted</h4>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">HR will respond within 1 business day.</p>
              <button onClick={() => setSubmitted(false)} className="mt-4 px-6 py-3 bg-indigo-600 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-indigo-700 transition-all">
                New Ticket
              </button>
            </div>
          ) : (
            <div className="p-7 flex flex-col gap-5">
              <div className="flex flex-col gap-2">
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Category</label>
                <select value={category} onChange={e => setCategory(e.target.value)} className="bg-slate-50 border border-slate-200 rounded-2xl px-5 py-3.5 text-xs font-black text-slate-900 outline-none focus:border-indigo-600 appearance-none cursor-pointer">
                  <option>General</option>
                  <option>Payroll Issue</option>
                  <option>Leave Problem</option>
                  <option>Claims Issue</option>
                  <option>IT / System Access</option>
                  <option>Other</option>
                </select>
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Subject</label>
                <input
                  type="text"
                  value={subject}
                  onChange={e => setSubject(e.target.value)}
                  placeholder="Brief description of your issue..."
                  className="bg-slate-50 border border-slate-200 rounded-2xl px-5 py-3.5 text-xs font-black text-slate-900 placeholder:text-slate-300 outline-none focus:border-indigo-600 transition-all"
                />
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Details</label>
                <textarea
                  value={message}
                  onChange={e => setMessage(e.target.value)}
                  rows={5}
                  placeholder="Describe the issue in detail..."
                  className="bg-slate-50 border border-slate-200 rounded-2xl px-5 py-3.5 text-xs font-black text-slate-900 placeholder:text-slate-300 outline-none focus:border-indigo-600 transition-all resize-none"
                />
              </div>
              <button
                onClick={() => { if (subject && message) setSubmitted(true); }}
                className="w-full py-4 bg-indigo-600 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-indigo-700 shadow-xl shadow-indigo-500/20 transition-all active:scale-95"
              >
                Submit Ticket
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
