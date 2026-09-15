import { Icon } from './Icon';

export type StepState = 'done' | 'now' | 'todo';
export interface Step { label: string; state: StepState; detail?: string }

/**
 * Process screens: numbered circles joined by a rail; done = filled tick,
 * now = bold, todo = muted. Give `onSelect` and each step becomes a button
 * (non-sequential processes such as offboarding); `detail` prints a short
 * caption under the label.
 */
export function Stepper({ steps, onSelect, className = '' }: { steps: Step[]; onSelect?: (index: number) => void; className?: string }) {
  return (
    // `relative` contains the sr-only labels (absolutely positioned) inside the
    // scroller; without it they escaped the clip and widened phone pages.
    <ol className={`relative flex items-start gap-2 overflow-x-auto ${className}`} aria-label="Progress">
      {steps.map((s, i) => {
        const circle = (
          <span className={`flex items-center justify-center w-6 h-6 rounded-full shrink-0 text-xs font-bold border-2 ${
            s.state === 'done' ? 'bg-accent border-accent text-on-accent' : s.state === 'now' ? 'bg-paper border-accent text-accent' : 'bg-paper border-rule text-muted'
          }`} aria-hidden="true">
            {s.state === 'done' ? <Icon name="check" size={13} strokeWidth={3} /> : i + 1}
          </span>
        );
        const text = (
          <span className="flex flex-col min-w-0">
            <span className={`text-[13px] whitespace-nowrap ${s.state === 'now' ? 'font-bold text-ink' : s.state === 'done' ? 'font-medium text-ink' : 'font-medium text-muted'}`}>
              <span className="sr-only">{s.state === 'done' ? 'Completed: ' : s.state === 'now' ? 'Current: ' : ''}</span>{s.label}
            </span>
            {s.detail && <span className="text-xs text-muted whitespace-nowrap">{s.detail}</span>}
          </span>
        );
        return (
          <li key={s.label} className="flex items-start gap-2.5 flex-1 min-w-max" aria-current={s.state === 'now' ? 'step' : undefined}>
            {onSelect ? (
              <button type="button" onClick={() => onSelect(i)} className="flex items-center gap-2.5 rounded-control px-1 -mx-1 hover:bg-page text-left">
                {circle}{text}
              </button>
            ) : (
              <span className="flex items-center gap-2.5">{circle}{text}</span>
            )}
            {i < steps.length - 1 && <span className={`flex-1 h-0.5 min-w-[24px] mt-3 mx-1.5 ${s.state === 'done' ? 'bg-accent' : 'bg-rule'}`} aria-hidden="true" />}
          </li>
        );
      })}
    </ol>
  );
}
