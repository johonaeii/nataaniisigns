import { useEffect, type ReactNode } from 'react';
import { ORDER_STATUS_LABEL, PAYMENT_STATUS_LABEL } from '../../shared/orderStatus';
import type { OrderStatus, PaymentStatus } from '../../shared/types';
import { photoUrl } from '../lib/catalog';
import { SHOP_NAME } from '../config';

export function useDocumentTitle(title: string | null) {
  useEffect(() => {
    document.title = title ? `${title} · ${SHOP_NAME}` : SHOP_NAME;
  }, [title]);
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="spinner-row" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

type NoticeTone = 'info' | 'success' | 'warning' | 'error';

export function Notice({
  tone = 'info',
  title,
  children,
  action,
}: {
  tone?: NoticeTone;
  title?: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className={`notice notice-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      {title && <p className="notice-title">{title}</p>}
      {children && <div className="notice-body">{children}</div>}
      {action && <div className="notice-action">{action}</div>}
    </div>
  );
}

export function SignImage({
  path,
  alt,
  className,
  eager = false,
}: {
  path: string | null | undefined;
  alt: string;
  className?: string;
  eager?: boolean;
}) {
  if (!path) {
    return (
      <div className={`sign-image placeholder ${className ?? ''}`} role="img" aria-label={`${alt} (no photo yet)`}>
        <span aria-hidden="true">🪧</span>
      </div>
    );
  }
  return (
    <img
      className={`sign-image ${className ?? ''}`}
      src={photoUrl(path)}
      alt={alt}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
    />
  );
}

const STATUS_TONE: Record<OrderStatus, string> = {
  checkout_pending: 'pending',
  requested: 'pending',
  confirmed: 'good',
  completed: 'done',
  canceled: 'muted',
  expired: 'muted',
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return (
    <span className={`badge badge-${STATUS_TONE[status]}`}>
      <span className="visually-hidden">Order status: </span>
      {ORDER_STATUS_LABEL[status]}
    </span>
  );
}

export function PaymentBadge({ status }: { status: PaymentStatus }) {
  return (
    <span className={`badge ${status === 'paid' ? 'badge-good' : 'badge-outline'}`}>
      <span className="visually-hidden">Payment: </span>
      {PAYMENT_STATUS_LABEL[status]}
    </span>
  );
}

export function QuantityStepper({
  value,
  max,
  onChange,
  label,
}: {
  value: number;
  max: number;
  onChange: (next: number) => void;
  label: string;
}) {
  return (
    <div className="stepper" role="group" aria-label={label}>
      <button type="button" onClick={() => onChange(value - 1)} aria-label={value <= 1 ? 'Remove' : 'Decrease quantity'}>
        −
      </button>
      <output aria-live="polite">{value}</output>
      <button type="button" onClick={() => onChange(value + 1)} disabled={value >= max} aria-label="Increase quantity">
        +
      </button>
    </div>
  );
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}
