import { formatNaira } from '@app/shared';
import { useEffect, type ButtonHTMLAttributes, type ReactNode } from 'react';

export const cx = (...parts: (string | false | null | undefined)[]) =>
  parts.filter(Boolean).join(' ');

type Variant = 'primary' | 'secondary' | 'ghost' | 'dark';
const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-brand-700 text-white active:bg-brand-800 disabled:bg-stone-300 disabled:text-stone-500',
  secondary:
    'bg-white text-stone-900 ring-1 ring-stone-300 active:bg-stone-100 disabled:text-stone-400',
  ghost: 'text-stone-700 active:bg-stone-100',
  dark: 'bg-stone-900 text-white active:bg-stone-800 disabled:bg-stone-300',
};

export function Button({
  variant = 'primary',
  className,
  busy,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; busy?: boolean }) {
  return (
    <button
      type="button"
      {...props}
      disabled={props.disabled || busy}
      className={cx(
        'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-2xl px-4 py-3 font-semibold transition-colors',
        VARIANTS[variant],
        className,
      )}
    >
      {busy && (
        <span
          className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
          aria-hidden="true"
        />
      )}
      {children}
    </button>
  );
}

export function Money({ kobo, className }: { kobo: number; className?: string }) {
  return <span className={cx('tabular-nums', className)}>{formatNaira(kobo)}</span>;
}

export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    // Centred dialog. The panel is capped to the visible viewport (dvh, so phone browser bars
    // don't hide its bottom) and its body scrolls; the overlay also scrolls as a fallback for
    // browsers without dvh support.
    <div
      className="fixed inset-0 z-50 overflow-y-auto overscroll-contain bg-black/50"
      onClick={onClose}
    >
      <div className="flex min-h-full items-center justify-center p-4 pt-[calc(1rem+env(safe-area-inset-top))] pb-[calc(1rem+env(safe-area-inset-bottom))]">
        <div
          role="dialog"
          aria-modal="true"
          aria-label={title}
          className="flex max-h-[calc(100dvh-2rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] w-full max-w-lg flex-col rounded-3xl bg-white shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex shrink-0 items-start justify-between gap-4 px-5 pb-3 pt-5">
            <h2 className="text-xl font-bold">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="-m-1 rounded-full p-2 text-stone-500 active:bg-stone-100"
            >
              ✕
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

export function Alert({
  children,
  tone = 'red',
}: {
  children: ReactNode;
  tone?: 'red' | 'amber' | 'green' | 'blue';
}) {
  const tones = {
    red: 'bg-red-50 text-red-800 ring-red-200',
    amber: 'bg-amber-50 text-amber-900 ring-amber-200',
    green: 'bg-emerald-50 text-emerald-900 ring-emerald-200',
    blue: 'bg-sky-50 text-sky-900 ring-sky-200',
  };
  return (
    <div
      role={tone === 'red' ? 'alert' : 'status'}
      className={cx('rounded-2xl px-4 py-3 text-sm ring-1', tones[tone])}
    >
      {children}
    </div>
  );
}

export function CenteredMessage({
  title,
  children,
  icon,
}: {
  title: string;
  children?: ReactNode;
  icon?: string;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-8 text-center">
      {icon && (
        <div className="mb-4 text-5xl" aria-hidden="true">
          {icon}
        </div>
      )}
      <h1 className="text-2xl font-bold">{title}</h1>
      {children && <div className="mt-3 max-w-sm text-stone-600">{children}</div>}
    </div>
  );
}

export function MenuSkeleton() {
  return (
    <div className="space-y-4 p-4" aria-busy="true" aria-label="Loading menu">
      <div className="skeleton h-14 w-2/3" />
      <div className="flex gap-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="skeleton h-9 w-24 rounded-full" />
        ))}
      </div>
      {[1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="flex gap-3">
          <div className="skeleton h-20 w-20 shrink-0" />
          <div className="flex-1 space-y-2">
            <div className="skeleton h-4 w-1/2" />
            <div className="skeleton h-3 w-5/6" />
            <div className="skeleton h-4 w-1/4" />
          </div>
        </div>
      ))}
    </div>
  );
}
