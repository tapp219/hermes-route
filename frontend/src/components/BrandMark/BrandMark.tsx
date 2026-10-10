import './BrandMark.css';

export default function BrandMark({ size = 36 }: { size?: number }) {
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="9" fill="currentColor" />
      <path d="M9 22C9 14 23 18 23 10" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="9" cy="22" r="3" fill="#fff" />
      <circle cx="23" cy="10" r="3" fill="#fff" />
    </svg>
  );
}
