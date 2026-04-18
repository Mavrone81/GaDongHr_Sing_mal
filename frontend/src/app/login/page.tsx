'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('admin@ezyhrm.sg');
  const [password, setPassword] = useState('***REMOVED***');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/auth/login`, {
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

      // Successful Auth: Store token in cookie so Next.js Middleware detects it
      document.cookie = `ezyhrm_token=${data.accessToken}; path=/; max-age=3600; SameSite=Lax`;
      
      // Redirect to protected dashboard entry point
      router.push('/');
      router.refresh();
      
    } catch (err) {
      setError(`Connection refused. Is the API Gateway running on ${process.env.NEXT_PUBLIC_API_URL}?`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen w-full bg-white">
      {/* Left Branding Panel */}
      <div className="hidden lg:flex w-[45%] bg-gradient-to-br from-brand-600 to-emerald-900 border-r border-brand-800 p-12 flex-col justify-between relative overflow-hidden">
        <div className="absolute top-[-20%] left-[-10%] w-96 h-96 bg-brand-500 rounded-full mix-blend-multiply filter blur-3xl opacity-50"></div>
        <div className="absolute bottom-[-10%] right-[-10%] w-96 h-96 bg-emerald-500 rounded-full mix-blend-multiply filter blur-3xl opacity-30"></div>
        
        <div className="relative z-10">
          <h1 className="text-4xl font-extrabold text-white tracking-tight">Ezy<span className="text-emerald-300">HRM</span></h1>
          <p className="mt-4 text-emerald-100/80 max-w-sm leading-relaxed text-sm">
            The next generation Enterprise Resource Planning suite for managing personnel, claims, payroll, and corporate infrastructure seamlessly.
          </p>
        </div>
        <div className="relative z-10 text-xs text-brand-200/60 font-medium">
          © 2026 UrbanWerkz Group SG. SOC2 Compliant.
        </div>
      </div>

      {/* Right Login Form */}
      <div className="flex-1 flex flex-col justify-center items-center px-6 sm:px-12 lg:px-24 bg-gray-50/50">
        <div className="w-full max-w-sm space-y-8">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 tracking-tight">Sign in to your account</h2>
            <p className="mt-2 text-sm text-gray-500">Provide your corporate credentials to access the internal dashboard.</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-5">
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-lg text-sm font-medium animate-pulse">
                {error}
              </div>
            )}
            
            <div className="space-y-1">
              <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Work Email</label>
              <input 
                type="email" 
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-900 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 transition-shadow outline-none"
                placeholder="admin@ezyhrm.sg"
                required
              />
            </div>
            
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Password</label>
                <a href="#" className="text-xs font-medium text-brand-600 hover:text-brand-500">Forgot password?</a>
              </div>
              <input 
                type="password" 
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-900 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 transition-shadow outline-none"
                placeholder="••••••••"
                required
              />
            </div>

            <button 
              type="submit" 
              disabled={loading}
              className={`w-full flex justify-center py-2.5 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-brand-600 hover:bg-brand-500 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-brand-500 transition-all ${loading ? 'opacity-70 cursor-not-allowed' : ''}`}
            >
              {loading ? (
                <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
              ) : 'Authenticate Session'}
            </button>
          </form>
          
          <div className="mt-8 text-center text-xs text-gray-400">
            Protected by Advanced Microservice Encryption
          </div>
        </div>
      </div>
    </div>
  );
}
