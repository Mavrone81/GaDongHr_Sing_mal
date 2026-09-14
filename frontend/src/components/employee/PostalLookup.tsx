'use client';
import { useState } from 'react';
import { Button, Icon } from '@/components/ui';
import { Spinner } from './RecordParts';

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
        <input
          type="text"
          value={postal}
          onChange={e => { setPostal(e.target.value); setError(''); }}
          onKeyDown={e => e.key === 'Enter' && lookup()}
          placeholder="Singapore postal code, e.g. 238859"
          aria-label="Postal code"
          inputMode="numeric"
          maxLength={8}
          className="flex-1 min-w-0 h-[42px] px-3 rounded-control border border-rule bg-paper text-sm text-ink placeholder:text-muted outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/20"
        />
        <Button variant="secondary" icon={loading ? undefined : 'search'} onClick={lookup} disabled={loading} className="shrink-0">
          {loading && <Spinner />}
          Find address
        </Button>
      </div>

      {/* Results */}
      {results.length > 0 && (
        <div className="bg-paper border border-rule rounded-control overflow-hidden" role="listbox" aria-label="Matching addresses">
          <p className="px-4 py-2 bg-pill border-b border-rule text-xs font-semibold text-muted">Choose the matching address</p>
          {results.map((r, i) => {
            const line1 = [r.BLK_NO, r.ROAD_NAME].filter(Boolean).join(' ');
            const line2 = r.BUILDING && r.BUILDING !== 'NIL' ? r.BUILDING : null;
            return (
              <button
                key={i}
                type="button"
                role="option"
                aria-selected={false}
                onClick={() => pick(r)}
                className="w-full text-left px-4 py-3 hover:bg-page transition-colors border-b border-rule last:border-0"
              >
                <p className="text-sm font-semibold text-ink">{line1}</p>
                {line2 && <p className="text-xs text-muted mt-0.5">{line2}</p>}
                <p className="text-xs text-muted mt-0.5 tabular-nums">Singapore {r.POSTAL}</p>
              </button>
            );
          })}
        </div>
      )}

      {error && (
        <p className="text-xs text-danger flex items-center gap-1.5" role="alert">
          <Icon name="alert" size={14} />
          {error}
        </p>
      )}

      {/* Manual address input */}
      <div className="relative">
        <input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={searched ? 'Type the address…' : 'Filled in by the lookup, or type it…'}
          aria-label="Address"
          className="w-full h-[42px] pl-3 pr-10 rounded-control border border-rule bg-paper text-sm text-ink placeholder:text-muted outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/20"
        />
        {value && (
          <button
            type="button"
            onClick={() => onChange('')}
            aria-label="Clear address"
            className="absolute right-1.5 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center rounded-control text-muted hover:text-ink hover:bg-page"
          >
            <Icon name="x" size={16} />
          </button>
        )}
      </div>
    </div>
  );
}
