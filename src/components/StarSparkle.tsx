interface StarSparkleProps {
  className?: string;
  size?: number;
}

export function StarSparkle({ className, size = 32 }: StarSparkleProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <path
        d="M12 2.5l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16l-5.4 3 1.2-6L3.3 8.8l6.1-.7L12 2.5z"
        fill="currentColor"
        stroke="oklch(0.27 0.06 260)"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}
