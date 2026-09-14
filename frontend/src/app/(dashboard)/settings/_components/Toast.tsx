import { Icon } from '@/components/ui';

/**
 * Transient confirmation for settings actions. Sits above the mobile bottom
 * bar, bottom-right on desktop. The icon and wording carry success vs error,
 * not colour alone.
 */
export function Toast({ toast }: { toast: { msg: string; type: 'success' | 'error' } | null }) {
  if (!toast) return null;
  const ok = toast.type === 'success';
  return (
    <div
      role={ok ? 'status' : 'alert'}
      className="fixed bottom-24 left-4 right-4 z-[200] flex items-start gap-2.5 rounded-control border border-rule bg-paper px-4 py-3 text-sm text-ink shadow-card animate-in slide-in-from-bottom-4 duration-300 sm:left-auto sm:max-w-sm lg:bottom-6 lg:right-6"
    >
      <Icon name={ok ? 'check' : 'alert'} size={16} strokeWidth={2} className={`mt-0.5 ${ok ? 'text-ok' : 'text-danger'}`} />
      <span>{toast.msg}</span>
    </div>
  );
}
