'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';

export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuth();
  const [email, setEmail] = useState('admin@ezyhrm.sg');
  const [password, setPassword] = useState('***REMOVED***');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || `http://${window.location.hostname}:4000/api`;
      const res = await fetch(`${apiUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (data.mfaRequired) {
          setError('MFA is currently active. The dashboard does not yet implement the MFA hook.');
        } else {
          setError(data.error || 'Invalid credentials');
        }
        return;
      }

      // Store token + hydrate AuthContext before navigating so the dashboard
      // never sees user=null on first render
      await login(data.accessToken);
      router.push('/');

    } catch (err) {
      setError(`Connection refused. Is the API Gateway running on ${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api'}?`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen w-full bg-white font-sans">
      {/* 1. BRAND INTELLIGENCE PANEL (Left) */}
      <div className="hidden lg:flex w-[45%] bg-slate-950 border-r border-slate-900 p-16 flex-col justify-between relative overflow-hidden">
        {/* Abstract Ambient Glow */}
        <div className="absolute top-[-10%] left-[-10%] w-[500px] h-[500px] bg-indigo-600/10 rounded-full blur-[120px]"></div>
        <div className="absolute bottom-[-10%] right-[-10%] w-[400px] h-[400px] bg-indigo-500/5 rounded-full blur-[100px]"></div>
        
        <div className="relative z-10 space-y-10">
          <div className="flex items-center gap-4">
             <div className="w-12 h-12 bg-indigo-600 rounded-xl flex items-center justify-center shadow-2xl shadow-indigo-500/40">
                <img src="/logo.png" alt="EzyHRM" className="w-8 h-8 object-contain brightness-0 invert" />
             </div>
             <span className="text-2xl font-black text-white tracking-[0.2em] uppercase">EzyHRM</span>
          </div>
          
          <div className="space-y-6">
            <h1 className="text-5xl font-black text-white tracking-tighter leading-[0.9]">
              Enterprise <br/>
              <span className="text-indigo-500 underline decoration-indigo-500/30 underline-offset-8">Intelligence</span> Suite
            </h1>
            <p className="text-slate-400 max-w-sm leading-relaxed text-[13px] font-bold uppercase tracking-widest opacity-80">
              Operational Command Center for modern personnel management, payroll terminal, and departmental auditing.
            </p>
          </div>

          <div className="flex flex-col gap-4 pt-10">
             {[
               { icon: '🔒', text: 'Military-Grade Encryption' },
               { icon: '📋', text: 'Section 2 RBAC Compliant' },
               { icon: '⏱️', text: 'Real-time Analytics Feed' }
             ].map((feature, i) => (
               <div key={i} className="flex items-center gap-3 text-slate-500 font-black text-[10px] tracking-widest uppercase">
                  <span className="opacity-50">{feature.icon}</span>
                  {feature.text}
               </div>
             ))}
          </div>
        </div>

        <div className="relative z-10 text-[10px] text-slate-600 font-black tracking-[0.3em] uppercase">
          © 2026 RMA Group SG • RM-HRMS-001 • v1.1.0-STABLE
        </div>
      </div>

      {/* 2. AUTHENTICATION MODULE (Right) */}
      <div className="flex-1 flex flex-col justify-center items-center px-6 sm:px-12 lg:px-24 bg-slate-50/30">
        <div className="w-full max-w-sm space-y-10">
          <div>
            <h2 className="text-sm font-black text-slate-900 tracking-[0.2em] uppercase mb-3">System Access Required</h2>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest leading-relaxed">Identity verification protocol for internal HRMS personnel.</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-6">
            {error && (
              <div className="bg-red-500/5 border border-red-500/20 text-red-600 px-4 py-3 rounded-xl text-[11px] font-black uppercase tracking-widest animate-pulse">
                ERR: {error}
              </div>
            )}
            
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] ml-1">Terminal Email ID</label>
              <input 
                type="email" 
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-5 py-4 text-xs font-bold text-slate-900 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/5 transition-all outline-none shadow-sm"
                placeholder="EMAIL_ADDRESS"
                required
              />
            </div>
            
            <div className="space-y-2">
              <div className="flex items-center justify-between ml-1">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">Secure Access Key</label>
                <a href="#" className="text-[10px] font-black text-indigo-600 hover:text-indigo-700 tracking-widest">RESET KEY</a>
              </div>
              <input 
                type="password" 
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-5 py-4 text-xs font-bold text-slate-900 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/5 transition-all outline-none shadow-sm"
                placeholder="PASSWORD_TERMINAL"
                required
              />
            </div>

            <button 
              type="submit" 
              disabled={loading}
              className={`w-full flex justify-center py-5 px-4 rounded-xl shadow-xl shadow-indigo-600/20 text-[11px] font-black text-white bg-indigo-600 hover:bg-indigo-700 hover:translate-y-[-2px] focus:outline-none transition-all uppercase tracking-[0.3em] ${loading ? 'opacity-70 cursor-not-allowed' : ''} active:scale-95`}
            >
              {loading ? (
                <div className="flex items-center gap-3">
                  <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                  <span>VERIFYING...</span>
                </div>
              ) : 'Initialize Session'}
            </button>
          </form>
          
          <div className="mt-12 text-center text-[9px] font-black text-slate-400 uppercase tracking-[0.4em] opacity-40">
            SECURE PORTAL ENTRY
          </div>
        </div>
      </div>
    </div>
  );
}
