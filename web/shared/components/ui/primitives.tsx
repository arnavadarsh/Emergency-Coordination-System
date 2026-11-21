import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import { toneClass, type Tone } from './Status';

/** Small presentational building blocks shared by every dashboard. */

/** The ECS mark: a shield with a cross, on the brand gradient. */
export function BrandMark({ large = false }: { large?: boolean }) {
  return (
    <span className={`ui-brandmark${large ? ' ui-brandmark--lg' : ''}`} aria-hidden="true">
      <Icon name="shieldPlus" size={large ? 26 : 21} strokeWidth={2.1} />
    </span>
  );
}

export const initialsOf = (name?: string | null) =>
  (name || '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase())
    .join('') || '?';

interface EmptyStateProps {
  icon: IconName;
  title: string;
  children?: ReactNode;
  tone?: Tone;
  actions?: ReactNode;
  dashed?: boolean;
  className?: string;
}

export function EmptyState({ icon, title, children, tone, actions, dashed, className }: EmptyStateProps) {
  return (
    <div className={`ui-empty${dashed ? ' ui-empty--dashed' : ''}${tone ? ` ${toneClass(tone)}` : ''}${className ? ` ${className}` : ''}`}>
      <div className="ui-empty__icon">
        <Icon name={icon} size={24} />
      </div>
      <div className="ui-empty__title">{title}</div>
      {children && <div className="ui-empty__text">{children}</div>}
      {actions && <div className="ui-empty__actions">{actions}</div>}
    </div>
  );
}

/** Full-screen loading state with a skeleton hint of the layout to come. */
export function PageLoading({ label = 'Loading dashboard…' }: { label?: string }) {
  return (
    <div className="ui-page-state" role="status" aria-live="polite">
      <BrandMark large />
      <div className="ui-row" style={{ color: 'var(--text-2)', fontWeight: 500 }}>
        <span className="ui-spinner" style={{ color: 'var(--brand-600)' }} aria-hidden="true" />
        {label}
      </div>
      <div style={{ width: 'min(440px, 90vw)', display: 'grid', gap: 10, marginTop: 6 }} aria-hidden="true">
        {[0, 1, 2].map(i => (
          <span key={i} className="ui-skeleton" style={{ height: 64, borderRadius: 12, opacity: 1 - i * 0.22 }} />
        ))}
      </div>
    </div>
  );
}

/** Full-screen error state with a retry. */
export function PageError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="ui-page-state">
      <div className="ui-card ui-page-state__card" role="alert">
        <div className="ui-empty__icon tone-danger" style={{ margin: '0 auto 14px' }}>
          <Icon name="alertTriangle" size={24} />
        </div>
        <div className="ui-page-state__title">We couldn't load this dashboard</div>
        <p className="ui-page-state__text" style={{ margin: '6px 0 18px' }}>{message}</p>
        <button type="button" className="ui-btn ui-btn--primary" onClick={onRetry}>
          <Icon name="refresh" size={16} />
          Try again
        </button>
      </div>
    </div>
  );
}

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * Counts up to `value` on first paint and eases between values when it changes.
 * Purely visual — it renders the final value immediately when motion is reduced.
 */
export function AnimatedNumber({ value, duration = 650 }: { value: number; duration?: number }) {
  const safe = Number.isFinite(value) ? value : 0;
  const [display, setDisplay] = useState(() => (prefersReducedMotion() ? safe : 0));
  const currentRef = useRef(display);

  useEffect(() => {
    const from = currentRef.current;
    if (from === safe || prefersReducedMotion()) {
      currentRef.current = safe;
      setDisplay(safe);
      return;
    }
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const next = Math.round(from + (safe - from) * eased);
      currentRef.current = next;
      setDisplay(next);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [safe, duration]);

  return <>{display}</>;
}
