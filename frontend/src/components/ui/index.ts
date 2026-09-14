/**
 * GaDongHR redesign — shared UI (2026-09, "Clean workspace").
 *
 * Every screen is built from these. Rules, in one place:
 *   - Tokens only: bg-paper / bg-page / bg-tint / bg-pill, text-ink / text-muted /
 *     text-faint, border-rule, text-accent, text-danger / text-warn / text-ok.
 *     Brass (highlight) is the logo's "HR" and nothing else. Seal is citations only.
 *   - Cards 12px radius, controls 8px, buttons 40px tall, table rows ~52px.
 *   - Labels are sentence case at 12.5px+. No all-caps micro-labels. Body 14px.
 *   - Icons are inline SVG (lucide-style strokes), never emoji or dingbats.
 *   - A page = <PageHeader> then content. Lists = <DataTable>. Forms = <Field>.
 *
 * The older `components/official/*` set stays for screens not yet migrated;
 * new work imports from here.
 */
export { Button } from './Button';
export { Badge } from './Badge';
export { Card, CardHeader } from './Card';
export { PageHeader } from './PageHeader';
export { Field, Input, Select } from './Field';
export { Tabs } from './Tabs';
export { DataTable } from './DataTable';
export type { Column } from './DataTable';
export { SearchInput } from './SearchInput';
export { EmptyState } from './EmptyState';
export { Stat } from './Stat';
export { Icon } from './Icon';
export type { IconName } from './Icon';
