import { Icon } from './Icon';

export type StepState = 'done' | 'now' | 'todo';

/** Process screens: numbered circles joined by a rail; done = filled tick, now = bold, todo = muted. */
export function Stepper({ steps, className = '' }: { steps: { label: string; state: StepState }[]; className?: string }) {
  return (
    <ol className={`flex items-center gap-2 overflow-x-auto ${className}`} aria-label="Progress">
      {steps.map((s, i) => (
        <li key={s.label} className="flex items-center gap-2.5 flex-1 min-w-max" aria-current={s.state === 'now' ? 'step' : undefined}>
          <span className={`flex items-center justify-center w-6 h-6 rounded-full shrink-0 text-xs font-bold border-2 ${
            s.state === 'done' ? 'bg-accent border-accent text-on-accent' : s.state === 'now' ? 'bg-paper border-accent text-accent' : 'bg-paper border-rule text-muted'
          }`} aria-hidden="true">
            {s.state === 'done' ? <Icon name="check" size={13} strokeWidth={3} /> : i + 1}
          </span>
          <span className={`text-[13px] whitespace-nowrap ${s.state === 'now' ? 'font-bold text-ink' : s.state === 'done' ? 'font-medium text-ink' : 'font-medium text-muted'}`}>
            <span className="sr-only">{s.state === 'done' ? 'Completed: ' : s.state === 'now' ? 'Current: ' : ''}</span>{s.label}
          </span>
          {i < steps.length - 1 && <span className={`flex-1 h-0.5 min-w-[24px] mx-1.5 ${s.state === 'done' ? 'bg-accent' : 'bg-rule'}`} aria-hidden="true" />}
        </li>
      ))}
    </ol>
  );
}
