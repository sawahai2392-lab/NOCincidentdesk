import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Check, Search, WandSparkles } from 'lucide-react';
import clsx from 'clsx';
import FloatingSelect from './UnifiedSelect';

export type SelectOption = {
  value: string;
  label: string;
  detail?: string;
};

type ButtonProps = {
  children: ReactNode;
  icon?: ReactNode;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  onClick?: () => void;
  disabled?: boolean;
  type?: 'button' | 'submit';
  className?: string;
};

export function Button({
  children,
  icon,
  variant = 'secondary',
  onClick,
  disabled,
  type = 'button',
  className = '',
}: ButtonProps) {
  return (
    <button
      type={type}
      className={clsx('button', variant, className)}
      onClick={onClick}
      disabled={disabled}
    >
      {icon}
      {children}
    </button>
  );
}

type FieldProps = {
  label: string;
  hint?: string;
  children: ReactNode;
  wide?: boolean;
};

export function Field({ label, hint, children, wide = false }: FieldProps) {
  return (
    <label className={`field ${wide ? 'wide' : ''}`}>
      <span className='field-label'>
        {label}
        {hint && <small>{hint}</small>}
      </span>
      {children}
    </label>
  );
}

type CustomSelectProps = {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  ariaLabel: string;
  compact?: boolean;
};

export function CustomSelect(props: CustomSelectProps) {
  return <FloatingSelect {...props} />;
}

type SmartInputProps = {
  value: string;
  onChange: (value: string) => void;
  suggestions: string[];
  placeholder?: string;
  ariaLabel: string;
};

export function SmartInput({
  value,
  onChange,
  suggestions,
  placeholder,
  ariaLabel,
}: SmartInputProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(
    () =>
      suggestions
        .filter((item) => item.toLowerCase().includes(value.trim().toLowerCase()))
        .filter((item, index, list) => list.indexOf(item) === index)
        .slice(0, 8),
    [suggestions, value],
  );

  useEffect(() => {
    if (!open) return;

    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };

    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  const choose = (next: string) => {
    onChange(next);
    setOpen(false);
    setActiveIndex(0);
  };

  return (
    <div className={`smart-input ${open && filtered.length ? 'open' : ''}`} ref={rootRef}>
      <input
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          setOpen(true);
          setActiveIndex(0);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setOpen(false);

          if (event.key === 'ArrowDown' && filtered.length) {
            event.preventDefault();
            setOpen(true);
            setActiveIndex((index) => Math.min(index + 1, filtered.length - 1));
          }

          if (event.key === 'ArrowUp' && filtered.length) {
            event.preventDefault();
            setActiveIndex((index) => Math.max(0, index - 1));
          }

          if (event.key === 'Enter' && open && filtered[activeIndex]) {
            event.preventDefault();
            choose(filtered[activeIndex]);
          }
        }}
        placeholder={placeholder}
        aria-label={ariaLabel}
        role='combobox'
        aria-autocomplete='list'
        aria-expanded={open && filtered.length > 0}
      />
      <span className='input-spark'>
        <WandSparkles size={13} />
      </span>
      {open && filtered.length > 0 && (
        <div className='combo-menu' role='listbox' aria-label={`${ariaLabel} suggestions`}>
          {filtered.map((item, index) => (
            <button
              type='button'
              role='option'
              aria-selected={item === value}
              className={index === activeIndex ? 'active' : ''}
              key={item}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => choose(item)}
            >
              <span>{item}</span>
              {item === value && <Check size={14} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

type BadgeProps = {
  children: ReactNode;
  tone?: string;
};

export function Badge({ children, tone = 'muted' }: BadgeProps) {
  return (
    <span className={`badge ${tone}`}>
      <i />
      {children}
    </span>
  );
}

type EmptyStateProps = {
  icon: ReactNode;
  title: string;
  text: string;
  action?: ReactNode;
};

export function EmptyState({ icon, title, text, action }: EmptyStateProps) {
  return (
    <div className='empty-state'>
      <span className='empty-icon'>{icon}</span>
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  );
}

type ListEditorProps = {
  label: string;
  value: string[];
  onChange: (next: string[]) => void;
  hint: string;
};

export function ListEditor({ label, value, onChange, hint }: ListEditorProps) {
  return (
    <Field label={label} hint={hint} wide>
      <textarea
        rows={6}
        value={value.join('\n')}
        onChange={(event) =>
          onChange(event.target.value.split('\n').map((item) => item.trim()).filter(Boolean))
        }
      />
    </Field>
  );
}
