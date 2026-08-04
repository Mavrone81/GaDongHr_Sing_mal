/**
 * Eight distinguishable treatments for workflow state, built from the Official
 * Record tokens.
 *
 * WHY THIS EXISTS
 *
 * The product previously encoded state in hue: amber for pending, blue for
 * submitted, emerald for approved, rose for rejected, slate for cancelled, and
 * so on — a different palette per screen, roughly twenty of them. The Official
 * Record system has eight tokens and no error red (seal red is reserved for
 * authority citations), so mapping those palettes onto tokens collapsed them:
 * on one screen PENDING, REJECTED and CANCELLED all became the same grey chip.
 * Nothing failed; the screens just quietly stopped distinguishing states with
 * very different consequences.
 *
 * So state is carried by FILL and WEIGHT instead of hue. The ordering principle
 * is *how much attention the state deserves*: what needs action today is filled
 * and heaviest, what is settled is outlined, what is inert recedes. A filled
 * chip is loud on a page of outlines, which is the whole point.
 *
 * This does NOT replace the label. Every consumer prints the state word beside
 * the chip; the tone only makes a list scannable. Colour never carries the
 * meaning alone.
 */
export const TONES = {
  /** Rejected, failed, overdue, breached — the exception that needs a human. */
  critical: 'bg-ink text-paper border border-ink font-semibold',

  /** At risk, expiring, escalated — not yet wrong, but on a clock. */
  warning: 'bg-highlight text-ink border border-highlight font-semibold',

  /** In flight: being worked on right now. */
  active: 'bg-paper text-ink border border-ink',

  /** Waiting on someone else — submitted, under review. */
  pending: 'bg-paper text-ink border border-highlight',

  /** Reached its terminal successful state. */
  done: 'bg-accent text-paper border border-accent',

  /** Approved or verified, but not yet finished. */
  approved: 'bg-paper text-accent border border-accent',

  /** Draft, new, not started — real but not yet consequential. */
  neutral: 'bg-page text-muted border border-rule',

  /** Cancelled, void, withdrawn — present for the record only. */
  inert: 'bg-page text-muted border border-rule line-through',
} as const;

export type Tone = keyof typeof TONES;
