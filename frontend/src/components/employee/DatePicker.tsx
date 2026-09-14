'use client';
import { useState, useRef, useEffect } from 'react';
import { Icon } from '@/components/ui';

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

  const NAV = 'w-8 h-8 flex items-center justify-center rounded-control text-muted hover:bg-page hover:text-ink';
  const HEAD = 'text-sm font-bold text-ink px-2 py-1 rounded-control hover:bg-page hover:text-accent';
  const BACK = 'inline-flex items-center gap-1 text-[13px] font-semibold text-muted hover:text-accent';

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => !disabled && setOpen(o => !o)}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="w-full h-[42px] px-3 rounded-control border border-rule bg-paper text-left text-sm text-ink flex items-center justify-between gap-2 transition-colors hover:border-accent focus:outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/20 disabled:bg-pill disabled:text-muted"
      >
        <span className={`tabular-nums ${displayValue ? 'text-ink' : 'text-muted'}`}>{displayValue || placeholder}</span>
        <Icon name="calendar" size={16} className="text-muted" />
      </button>

      {open && (
        <div className="absolute top-full left-0 z-50 mt-1.5 bg-paper border border-rule rounded-card shadow-card p-4 w-72 max-w-[calc(100vw-2rem)]" role="dialog" aria-label="Choose a date">

          {/* Day picker */}
          {mode === 'days' && (
            <>
              <div className="flex items-center justify-between mb-3">
                <button type="button" onClick={prevMonth} className={NAV} aria-label="Previous month">
                  <Icon name="chevronRight" size={16} className="rotate-180" />
                </button>
                <button type="button" onClick={() => setMode('months')} className={HEAD}>
                  {MONTHS[viewMonth]} {viewYear}
                </button>
                <button type="button" onClick={nextMonth} className={NAV} aria-label="Next month">
                  <Icon name="chevronRight" size={16} />
                </button>
              </div>

              <div className="grid grid-cols-7 mb-1">
                {DAYS_SHORT.map(d => (
                  <div key={d} className="text-center text-xs font-semibold text-muted py-1.5">{d}</div>
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
                      aria-pressed={!!isSel}
                      aria-current={isToday ? 'date' : undefined}
                      className={`h-8 w-full flex items-center justify-center rounded-control text-sm tabular-nums transition-colors ${
                        isSel ? 'bg-accent text-on-accent font-bold' :
                        isToday ? 'text-accent font-bold ring-1 ring-inset ring-accent' :
                        'text-ink hover:bg-page'
                      }`}
                    >
                      {day}
                    </button>
                  );
                })}
              </div>

              {value && (
                <button
                  type="button"
                  onClick={() => { onChange(''); setOpen(false); }}
                  className="w-full mt-3 pt-3 border-t border-rule text-[13px] font-semibold text-danger hover:underline"
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
                <button type="button" onClick={() => setMode('days')} className={BACK}><Icon name="chevronRight" size={14} className="rotate-180" />Back</button>
                <button type="button" onClick={() => setMode('years')} className={HEAD}>{viewYear}</button>
                <span className="w-12" />
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {MONTHS.map((m, i) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => { setViewMonth(i); setMode('days'); }}
                    className={`h-9 rounded-control text-[13px] font-semibold transition-colors ${
                      i === viewMonth ? 'bg-accent text-on-accent' : 'text-ink hover:bg-page'
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
                <button type="button" onClick={() => setMode('months')} className={BACK}><Icon name="chevronRight" size={14} className="rotate-180" />Back</button>
                <span className="text-sm font-bold text-muted">Choose a year</span>
                <span className="w-12" />
              </div>
              <div className="max-h-48 overflow-y-auto grid grid-cols-3 gap-1.5">
                {years.map(y => (
                  <button
                    key={y}
                    type="button"
                    onClick={() => { setViewYear(y); setMode('months'); }}
                    className={`h-9 rounded-control text-[13px] font-semibold tabular-nums transition-colors ${
                      y === viewYear ? 'bg-accent text-on-accent' : 'text-ink hover:bg-page'
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
