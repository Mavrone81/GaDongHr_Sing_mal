'use client';
import { useState, useRef, useEffect } from 'react';

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAYS_SHORT = ['Su','Mo','Tu','We','Th','Fr','Sa'];

interface Props {
  value: string; // YYYY-MM-DD or ISO datetime
  onChange: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
  minYear?: number;
  maxYear?: number;
}

// Safely parse any date string — handles YYYY-MM-DD and full ISO datetimes
function parseDate(value: string): Date | null {
  if (!value) return null;
  // Already a date-only string — append time to avoid timezone shifts
  const dateOnly = value.length === 10 ? value : value.slice(0, 10);
  const d = new Date(dateOnly + 'T00:00:00');
  return isNaN(d.getTime()) ? null : d;
}

export function DatePicker({ value, onChange, disabled, placeholder = 'Select date…', minYear, maxYear }: Props) {
  const parsed = parseDate(value);
  const [open, setOpen] = useState(false);
  const [viewMonth, setViewMonth] = useState(parsed?.getMonth() ?? new Date().getMonth());
  const [viewYear, setViewYear] = useState(parsed?.getFullYear() ?? new Date().getFullYear());
  const [mode, setMode] = useState<'days' | 'months' | 'years'>('days');
  const ref = useRef<HTMLDivElement>(null);

  const yearMin = minYear ?? 1940;
  const yearMax = maxYear ?? new Date().getFullYear() + 10;

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setMode('days');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const displayValue = parsed
    ? parsed.toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })
    : value ? 'Invalid date' : '';

  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const firstDay = new Date(viewYear, viewMonth, 1).getDay();

  const prevMonth = () => {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); }
    else setViewMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); }
    else setViewMonth(m => m + 1);
  };

  const selectDay = (day: number) => {
    const d = new Date(viewYear, viewMonth, day);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    onChange(iso);
    setOpen(false);
    setMode('days');
  };

  const years = Array.from({ length: yearMax - yearMin + 1 }, (_, i) => yearMax - i);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => !disabled && setOpen(o => !o)}
        className="w-full text-left px-4 py-2.5 border border-accent bg-paper text-sm font-bold text-ink flex items-center justify-between hover:border-accent focus:outline-none focus:ring-2 focus:ring-accent transition-all"
      >
        <span className={displayValue ? 'text-ink' : 'text-muted font-normal'}>{displayValue || placeholder}</span>
        <svg className="w-4 h-4 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
        </svg>
      </button>

      {open && (
        <div className="absolute top-full left-0 z-50 mt-1.5 bg-paper border border-rule p-4 w-72">

          {/* Day picker */}
          {mode === 'days' && (
            <>
              <div className="flex items-center justify-between mb-3">
                <button onClick={prevMonth} className="p-1.5 hover:bg-page transition-all text-muted">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
                </button>
                <button
                  onClick={() => setMode('months')}
                  className="text-sm font-black text-ink hover:text-accent px-2 py-1 hover:bg-page transition-all"
                >
                  {MONTHS[viewMonth]} {viewYear}
                </button>
                <button onClick={nextMonth} className="p-1.5 hover:bg-page transition-all text-muted">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                </button>
              </div>

              <div className="grid grid-cols-7 mb-1">
                {DAYS_SHORT.map(d => (
                  <div key={d} className="text-center text-[9px] font-black text-muted uppercase py-1.5">{d}</div>
                ))}
              </div>

              <div className="grid grid-cols-7 gap-0.5">
                {Array.from({ length: firstDay }, (_, i) => <div key={`e${i}`} />)}
                {Array.from({ length: daysInMonth }, (_, i) => {
                  const day = i + 1;
                  const isSel = parsed && parsed.getDate() === day && parsed.getMonth() === viewMonth && parsed.getFullYear() === viewYear;
                  const isToday = new Date().getDate() === day && new Date().getMonth() === viewMonth && new Date().getFullYear() === viewYear;
                  return (
                    <button
                      key={day}
                      type="button"
                      onClick={() => selectDay(day)}
                      className={`h-8 w-full flex items-center justify-center  text-sm font-bold transition-all ${
                        isSel ? 'bg-accent text-paper font-black' :
                        isToday ? 'bg-page text-accent font-black ring-1 ring-accent' :
                        'hover:bg-page text-ink'
                      }`}
                    >
                      {day}
                    </button>
                  );
                })}
              </div>

              {value && (
                <button
                  onClick={() => { onChange(''); setOpen(false); }}
                  className="w-full mt-3 text-[10px] font-black text-ink hover:text-ink uppercase tracking-widest py-1 border-t border-rule pt-3 transition-all"
                >
                  Clear date
                </button>
              )}
            </>
          )}

          {/* Month picker */}
          {mode === 'months' && (
            <>
              <div className="flex items-center justify-between mb-3">
                <button onClick={() => setMode('days')} className="text-[10px] font-black text-muted hover:text-accent uppercase tracking-widest transition-all">← Back</button>
                <button onClick={() => setMode('years')} className="text-sm font-black text-ink hover:text-accent px-2 py-1 hover:bg-page transition-all">{viewYear}</button>
                <div />
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {MONTHS.map((m, i) => (
                  <button
                    key={m}
                    onClick={() => { setViewMonth(i); setMode('days'); }}
                    className={`py-2  text-xs font-black uppercase transition-all ${
                      i === viewMonth ? 'bg-accent text-paper' : 'hover:bg-page text-ink'
                    }`}
                  >
                    {m.slice(0, 3)}
                  </button>
                ))}
              </div>
            </>
          )}

          {/* Year picker */}
          {mode === 'years' && (
            <>
              <div className="flex items-center justify-between mb-3">
                <button onClick={() => setMode('months')} className="text-[10px] font-black text-muted hover:text-accent uppercase tracking-widest transition-all">← Back</button>
                <span className="text-sm font-black text-muted">Select Year</span>
                <div />
              </div>
              <div className="max-h-48 overflow-y-auto grid grid-cols-3 gap-1.5">
                {years.map(y => (
                  <button
                    key={y}
                    onClick={() => { setViewYear(y); setMode('months'); }}
                    className={`py-2  text-xs font-black transition-all ${
                      y === viewYear ? 'bg-accent text-paper' : 'hover:bg-page text-ink'
                    }`}
                  >
                    {y}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
