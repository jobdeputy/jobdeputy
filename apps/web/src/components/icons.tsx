/** The prototype's line icons (24 viewBox, 1.75 stroke), shared where they repeat. */

/** A person: the Profile page, in the sidebar and on its About you section. */
export function PersonIcon({ className = 'size-5' }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
    >
      <circle cx="12" cy="8.25" r="3.75" />
      <path d="M4.75 20c.6-3.75 3.4-6 7.25-6s6.65 2.25 7.25 6" />
    </svg>
  );
}
