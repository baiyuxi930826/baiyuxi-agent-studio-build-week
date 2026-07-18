/** Legacy export name retained while the visual mark becomes a dev-team orchestration symbol. */
export function AgentStudioLogo({ className = 'w-6 h-6' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="agent-studio-agent-mark" x1="8" y1="8" x2="56" y2="56" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#3F6FE5" />
          <stop offset="58%" stopColor="#14A0B8" />
          <stop offset="100%" stopColor="#2F9E69" />
        </linearGradient>
      </defs>
      <rect x="6" y="6" width="52" height="52" rx="14" fill="url(#agent-studio-agent-mark)" />
      <path
        d="M20 24h24M20 40h24M24 20v24M40 20v24"
        fill="none"
        stroke="rgba(255,255,255,0.46)"
        strokeLinecap="round"
        strokeWidth="3"
      />
      <circle cx="20" cy="24" r="5" fill="#F8FAFC" />
      <circle cx="44" cy="24" r="5" fill="#E0F2FE" />
      <circle cx="20" cy="40" r="5" fill="#E0F2FE" />
      <circle cx="44" cy="40" r="5" fill="#F8FAFC" />
      <circle cx="32" cy="32" r="6" fill="#0F172A" fillOpacity="0.72" />
      <circle cx="32" cy="32" r="2.4" fill="#FFFFFF" />
    </svg>
  );
}
