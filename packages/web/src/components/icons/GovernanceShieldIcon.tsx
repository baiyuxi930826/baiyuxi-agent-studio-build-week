/** Governance shield icon — shield with review nodes inside. */
export function GovernanceShieldIcon({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <title>治理保护</title>
      {/* Shield outline */}
      <path d="M12 2L4 6v5c0 5.25 3.4 10.15 8 11.5 4.6-1.35 8-6.25 8-11.5V6L12 2z" opacity="0.15" />
      <path
        d="M12 2L4 6v5c0 5.25 3.4 10.15 8 11.5 4.6-1.35 8-6.25 8-11.5V6L12 2z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      {/* Review nodes inside shield */}
      <circle cx="9" cy="11" r="1.4" />
      <circle cx="15" cy="11" r="1.4" />
      <circle cx="12" cy="16" r="1.4" />
      <path d="M10.3 11h3.4M9.9 12.2l1.4 2.6M14.1 12.2l-1.4 2.6" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}
