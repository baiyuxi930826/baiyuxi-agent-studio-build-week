/** F087: Bootcamp icon — onboarding cap with agent orchestration nodes. */
export function BootcampIcon({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className={className}
      aria-hidden="true"
    >
      <title>Agent 新手工作流</title>
      <path d="M12 3 3 7.5l9 4.5 9-4.5L12 3Z" strokeLinejoin="round" />
      <path d="M6.5 10v3.4c0 1.8 2.5 3.1 5.5 3.1s5.5-1.3 5.5-3.1V10" strokeLinecap="round" />
      <path d="M19 8v5" strokeLinecap="round" />
      <circle cx="7" cy="19" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="12" cy="19" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="17" cy="19" r="1.6" fill="currentColor" stroke="none" />
      <path d="M8.6 19h1.8m3.2 0h1.8" strokeLinecap="round" />
    </svg>
  );
}
