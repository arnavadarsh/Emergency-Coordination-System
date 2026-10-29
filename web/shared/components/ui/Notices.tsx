import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon, type IconName } from './Icon';
import { toneClass, type Tone } from './Status';

/**
 * In-page notices, replacing window.alert().
 *
 * alert() stops the whole page — including the socket handlers that deliver
 * the next pre-arrival — until someone clicks OK. These stack in the corner
 * instead, are announced to screen readers, and clear themselves unless they
 * need a decision (sticky).
 */

export interface Notice {
  id: number;
  tone: Tone;
  title?: string;
  text: string;
  sticky?: boolean;
}

const ICON_FOR: Partial<Record<Tone, IconName>> = {
  danger: 'alertOctagon',
  warning: 'alertTriangle',
  success: 'checkCircle',
  info: 'info',
};

export function useNotices(autoDismissMs = 6000) {
  const [notices, setNotices] = useState<Notice[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    setNotices(list => list.filter(n => n.id !== id));
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
  }, []);

  const notify = useCallback(
    (notice: Omit<Notice, 'id'>) => {
      const id = nextId.current++;
      setNotices(list => [...list.slice(-3), { ...notice, id }]);
      if (!notice.sticky) timers.current.set(id, setTimeout(() => dismiss(id), autoDismissMs));
    },
    [autoDismissMs, dismiss],
  );

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);

  return { notices, notify, dismiss };
}

export function NoticeStack({ notices, onDismiss }: { notices: Notice[]; onDismiss: (id: number) => void }) {
  return (
    <div className="ui-notices" aria-live="assertive" aria-relevant="additions">
      {notices.map(n => (
        <div key={n.id} className={`ui-alert ui-notice ${toneClass(n.tone)}`} role={n.tone === 'danger' ? 'alert' : 'status'}>
          <Icon name={ICON_FOR[n.tone] ?? 'info'} size={18} />
          <div style={{ flex: 1, minWidth: 0 }}>
            {n.title && <div className="ui-alert__title">{n.title}</div>}
            <div>{n.text}</div>
          </div>
          <button type="button" className="ui-btn ui-btn--ghost ui-btn--icon ui-btn--sm" onClick={() => onDismiss(n.id)} aria-label="Dismiss">
            <Icon name="x" size={16} />
          </button>
        </div>
      ))}
    </div>
  );
}
