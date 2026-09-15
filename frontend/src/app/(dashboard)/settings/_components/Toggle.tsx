/**
 * On/off switch from the Settings artboard: 40×22 track, accent when on.
 * A real `role="switch"` button, so it is keyboard- and screen-reader-operable,
 * and the state is carried by the knob position as well as the colour.
 */
export function Toggle({ on, onChange, disabled, label }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative h-[22px] w-10 shrink-0 rounded-full transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-offset-2 ${
        on ? 'bg-accent' : 'bg-rule'
      } ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
    >
      <span
        className={`absolute left-0 top-0.5 h-[18px] w-[18px] rounded-full bg-paper shadow-card transition-transform duration-200 ${on ? 'translate-x-[20px]' : 'translate-x-0.5'}`}
      />
    </button>
  );
}
