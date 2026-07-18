import type { ButtonHTMLAttributes, ReactNode } from 'react';

export function SettingsIconButton({
  children,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }) {
  return (
    <button
      type="button"
      {...props}
      className={`flex h-[26px] w-[26px] items-center justify-center rounded-lg text-studio-muted transition-colors hover:bg-[var(--console-hover-bg)] hover:text-studio-accent${className ? ` ${className}` : ''}`}
    >
      {children}
    </button>
  );
}
