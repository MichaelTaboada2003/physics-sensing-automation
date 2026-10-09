interface ProgressBarProps {
  progress: number;   // 0.0 – 1.0
  label?: string;
}

export default function ProgressBar({ progress, label }: ProgressBarProps) {
  const pct = Math.round(Math.max(0, Math.min(1, progress)) * 100);
  return (
    <div className="w-full">
      {label && (
        <div className="flex items-baseline justify-between mb-1.5 text-sm">
          <span className="text-ink-2">{label}</span>
          <span className="figure font-bold">{pct} %</span>
        </div>
      )}
      <div
        className="w-full h-1.5 bg-paper-2 border border-rule rounded-full overflow-hidden"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <div
          className={`h-full rounded-full transition-[width] duration-300 ease-out ${pct >= 100 ? 'bg-veg' : 'bg-stamp'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
