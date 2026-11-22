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

/** A pencil: a group's Edit button on the Profile page. */
export function EditIcon({ className = 'size-4' }: { className?: string }) {
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
      <path d="M14.5 5.5 18.5 9.5M4.5 19.5l1-4.5 10-10a2.1 2.1 0 0 1 3 3l-10 10z" />
    </svg>
  );
}
