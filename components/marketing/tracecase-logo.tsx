type TraceCaseLogoProps = {
  className?: string;
  compact?: boolean;
  wordmarkClassName?: string;
};

export function TraceCaseLogo({
  className,
  compact = false,
  wordmarkClassName,
}: TraceCaseLogoProps) {
  return (
    <span className={`inline-flex items-center gap-3 ${className ?? ""}`}>
      <span className="relative flex size-9 items-center justify-center rounded-2xl border border-black/8 bg-white/90 shadow-[0_12px_30px_rgba(15,23,42,0.08)]">
        <span className="absolute inset-[5px] rounded-[0.9rem] bg-[linear-gradient(145deg,rgba(255,255,255,0.98),rgba(243,244,246,0.92))]" />
        <svg
          aria-hidden="true"
          className="relative z-10 size-5 text-slate-900"
          fill="none"
          viewBox="0 0 24 24"
        >
          <path
            d="M5 7.5H10.5L13.25 12H18.5"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.8"
          />
          <path
            d="M5 16.5H9.5L12 12.75"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.8"
          />
          <path
            d="M14.25 12.75H18.5"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.8"
          />
        </svg>
        <span className="absolute left-[8px] top-[8px] size-1.5 rounded-full bg-sky-500" />
        <span className="absolute right-[8px] top-[11px] size-1.5 rounded-full bg-slate-900" />
        <span className="absolute bottom-[8px] left-[8px] size-1.5 rounded-full bg-emerald-500" />
      </span>

      {compact ? null : (
        <span
          className={`text-sm font-semibold tracking-[0.2em] text-foreground/88 uppercase ${wordmarkClassName ?? ""}`}
        >
          TraceCase
        </span>
      )}
    </span>
  );
}
