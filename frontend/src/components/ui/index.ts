/**
 * GaDongHR redesign — shared UI (2026-09, "Clean workspace").
 *
 * Every screen is built from these. Rules, in one place:
 *   - Tokens only: bg-paper / bg-page / bg-tint / bg-pill, text-ink / text-muted /
 *     text-faint, border-rule, text-accent, text-danger / text-warn / text-ok,
 *     text-on-accent on any accent fill, bg-*-bg for state chips.
 *     Brass (highlight) is the logo's "HR" and nothing else. Seal is citations only.
 *   - Cards 12px radius (rounded-card), controls 8px (rounded-control), pills
 *     rounded-full, the one shadow is shadow-card. No Tailwind rounded-lg/shadow-md.
 *   - Labels are sentence case at 12.5px+. No all-caps micro-labels. Body 14px.
 *     Nothing user-facing below 12px (a guard test enforces this on migrated paths).
 *   - Icons are inline SVG (<Icon>), never emoji or dingbats.
 *   - Focus is the global :focus-visible outline; never remove it without a visible ring.
 *   - A page = <PageHeader> then content. Lists = <DataTable> (give mobileCard).
 *     Forms = <Field>. Processes = <Stepper>. Inboxes = <SplitPane>.
 *   - A row-click DataTable carries no action column (a button inside a button is
 *     invalid HTML); put actions on the detail screen or a row menu.
 *     Confirmations = <Modal>. Feedback = useToast().
 *
 * The older `components/official/*` set stays for screens not yet migrated;
 * new work imports from here.
 */
export { Button } from './Button';
export { Badge } from './Badge';
export type { BadgeTone } from './Badge';
export { Card, CardHeader } from './Card';
export { PageHeader } from './PageHeader';
export { Field, Input, Select, Textarea } from './Field';
export { Tabs } from './Tabs';
export { DataTable } from './DataTable';
export type { Column } from './DataTable';
export { SearchInput } from './SearchInput';
export { EmptyState } from './EmptyState';
export { Stat } from './Stat';
export { Icon } from './Icon';
export type { IconName } from './Icon';
export { Modal } from './Modal';
export { ToastProvider, useToast } from './Toast';
export type { ToastTone } from './Toast';
export { Stepper } from './Stepper';
export type { StepState, Step } from './Stepper';
export { Avatar } from './Avatar';
export { SplitPane } from './SplitPane';
