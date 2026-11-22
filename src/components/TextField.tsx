import type { ReactNode } from 'react';

/** Labeled text input with optional hint and error, wired up for screen readers. */
export function TextField(props: {
  id: string;
  field: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: ReactNode;
  type?: string;
  inputMode?: 'email' | 'tel' | 'text';
  autoComplete?: string;
  required?: boolean;
}) {
  const describedBy = [props.hint ? `${props.id}-hint` : null, props.error ? `${props.id}-error` : null]
    .filter(Boolean)
    .join(' ');
  return (
    <div className="field">
      <label htmlFor={props.id}>
        {props.label}
        {props.required && <span className="required" aria-hidden="true"> *</span>}
      </label>
      {props.hint && (
        <p id={`${props.id}-hint`} className="hint">
          {props.hint}
        </p>
      )}
      <input
        id={props.id}
        data-field={props.field}
        type={props.type ?? 'text'}
        inputMode={props.inputMode}
        autoComplete={props.autoComplete}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        required={props.required}
        aria-invalid={Boolean(props.error)}
        aria-describedby={describedBy || undefined}
      />
      {props.error && (
        <p id={`${props.id}-error`} className="field-error">
          {props.error}
        </p>
      )}
    </div>
  );
}
