'use client';
import { useState } from 'react';

interface Result {
  BLK_NO: string;
  ROAD_NAME: string;
  BUILDING: string;
  POSTAL: string;
  ADDRESS: string;
}

interface Props {
  value: string;
  onChange: (v: string) => void;
}

export function PostalLookup({ value, onChange }: Props) {
  const [postal, setPostal] = useState('');
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [searched, setSearched] = useState(false);

  const lookup = async () => {
    const code = postal.trim().replace(/\s/g, '');
    if (!code || code.length < 4) { setError('Enter a valid postal code'); return; }
    setLoading(true);
    setError('');
    setResults([]);
    setSearched(false);
    try {
      const res = await fetch(
        `https://www.onemap.gov.sg/api/common/elastic/search?searchVal=${code}&returnGeom=N&getAddrDetails=Y&pageNum=1`,
        { headers: { 'Accept': 'application/json' } }
      );
      const data = await res.json();
      if (data.results && data.results.length > 0) {
        setResults(data.results.slice(0, 5));
      } else {
        setError('No address found. Please type your address manually below.');
      }
    } catch {
      setError('Lookup unavailable. Please type your address manually.');
    } finally {
      setLoading(false);
      setSearched(true);
    }
  };

  const pick = (r: Result) => {
    // Format: BLK_NO ROAD_NAME, Singapore POSTAL
    const parts = [r.BLK_NO, r.ROAD_NAME].filter(Boolean).join(' ');
    const full = r.BUILDING && r.BUILDING !== 'NIL'
      ? `${parts}, ${r.BUILDING}, Singapore ${r.POSTAL}`
      : `${parts}, Singapore ${r.POSTAL}`;
    onChange(full.trim());
    setResults([]);
    setPostal('');
    setSearched(false);
  };

  return (
    <div className="flex flex-col gap-2">
      {/* Postal code search row */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <input
            type="text"
            value={postal}
            onChange={e => { setPostal(e.target.value); setError(''); }}
            onKeyDown={e => e.key === 'Enter' && lookup()}
            placeholder="SG Postal code (e.g. 238859)"
            maxLength={8}
            className="w-full px-4 py-2.5 text-sm border border-accent focus:outline-none focus:ring-2 focus:ring-accent focus:border-accent font-bold bg-paper transition-all"
          />
        </div>
        <button
          type="button"
          onClick={lookup}
          disabled={loading}
          className="px-4 py-2.5 bg-accent text-paper text-[10px] font-black uppercase tracking-wider hover:bg-accent transition-all disabled:opacity-50 shrink-0 flex items-center gap-2"
        >
          {loading ? (
            <svg className="w-3.5 h-3.5 animate-spin rounded-full" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
          ) : (
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          )}
          Lookup
        </button>
      </div>

      {/* Results dropdown */}
      {results.length > 0 && (
        <div className="bg-paper border border-accent overflow-hidden">
          <div className="px-3 py-2 bg-page border-b border-accent">
            <p className="text-[9px] font-black text-accent uppercase tracking-widest">Select matching address</p>
          </div>
          {results.map((r, i) => {
            const line1 = [r.BLK_NO, r.ROAD_NAME].filter(Boolean).join(' ');
            const line2 = r.BUILDING && r.BUILDING !== 'NIL' ? r.BUILDING : null;
            return (
              <button
                key={i}
                type="button"
                onClick={() => pick(r)}
                className="w-full text-left px-4 py-3 hover:bg-page transition-all border-b border-rule last:border-0"
              >
                <p className="text-xs font-black text-ink">{line1}</p>
                {line2 && <p className="text-[10px] font-bold text-muted mt-0.5">{line2}</p>}
                <p className="text-[10px] font-bold text-muted mt-0.5">Singapore {r.POSTAL}</p>
              </button>
            );
          })}
        </div>
      )}

      {error && (
        <p className="text-[10px] font-bold text-ink flex items-center gap-1.5">
          <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          {error}
        </p>
      )}

      {/* Manual address input */}
      <div className="relative">
        <input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={searched ? 'Type address manually…' : 'Auto-filled by postal lookup or type manually…'}
          className="w-full px-4 py-2.5 text-sm border border-accent focus:outline-none focus:ring-2 focus:ring-accent focus:border-accent font-bold bg-paper transition-all"
        />
        {value && (
          <button
            type="button"
            onClick={() => onChange('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-muted transition-all"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
