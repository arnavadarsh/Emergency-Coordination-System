import { useEffect, useRef, type ReactNode } from 'react';

/**
 * Accessible dialog shell.
 *
 * Handles what every overlay here needs and none of them did on their own:
 * dialog semantics, focus moved in on open and returned on close, Tab kept
 * inside, Escape to dismiss, and the page behind held still. Parents keep
 * deciding when it is shown — mount it to open, unmount it to close.
 *
 * Leave `onClose` undefined while a close would be unsafe (e.g. mid-submit);
 * Escape and the backdrop then do nothing.
 */

interface ModalProps {
  onClose?: () => void;
  /** Close when the dimmed backdrop is clicked. Off for forms holding unsaved input. */
  closeOnBackdrop?: boolean;
  /** id of the element that titles the dialog. */
  labelledBy?: string;
  /** Accessible name when there is no visible title element. */
  label?: string;
  describedBy?: string;
  size?: 'sm' | 'md' | 'lg';
  /** Pin to the top instead of centring — for tall, scrolling content. */
  align?: 'center' | 'top';
  /** alertdialog for confirmations that interrupt. */
  role?: 'dialog' | 'alertdialog';
  className?: string;
  children: ReactNode;
}

const FOCUSABLE =
  'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), iframe, [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

export function Modal({
  onClose,
  closeOnBackdrop = true,
  labelledBy,
  label,
  describedBy,
  size = 'sm',
  align = 'center',
  role = 'dialog',
  className,
  children,
}: ModalProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Focus in on open, back out on close; hold the page still underneath.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const node = dialogRef.current;
    const first = node?.querySelector<HTMLElement>('[data-autofocus]') ?? node?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? node)?.focus({ preventScroll: true });

    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = overflow;
      if (previouslyFocused && document.contains(previouslyFocused)) previouslyFocused.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const node = dialogRef.current;
      if (!node) return;

      if (event.key === 'Escape' && onCloseRef.current) {
        event.stopPropagation();
        onCloseRef.current();
        return;
      }

      if (event.key === 'Tab') {
        const items = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
          el => el.offsetParent !== null || el === document.activeElement,
        );
        if (items.length === 0) {
          event.preventDefault();
          node.focus();
          return;
        }
        const firstItem = items[0];
        const lastItem = items[items.length - 1];
        if (event.shiftKey && (document.activeElement === firstItem || document.activeElement === node)) {
          event.preventDefault();
          lastItem.focus();
        } else if (!event.shiftKey && document.activeElement === lastItem) {
          event.preventDefault();
          firstItem.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const sizeClass = size === 'lg' ? ' ui-modal--lg' : size === 'md' ? ' ui-modal--md' : '';

  return (
    <div
      className={`ui-modal-scrim${align === 'top' ? ' ui-modal-scrim--top' : ''}`}
      onMouseDown={event => {
        if (event.target === event.currentTarget && closeOnBackdrop) onCloseRef.current?.();
      }}
    >
      <div
        ref={dialogRef}
        role={role}
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-label={labelledBy ? undefined : label}
        aria-describedby={describedBy}
        tabIndex={-1}
        className={`ui-modal${sizeClass}${className ? ` ${className}` : ''}`}
      >
        {children}
      </div>
    </div>
  );
}

export default Modal;
