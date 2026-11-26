import type { ReactNode } from 'react';

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

/** A target: the Profile page's Job preferences section. */
export function TargetIcon({ className = 'size-5' }: { className?: string }) {
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
      <circle cx="12" cy="12" r="8.25" />
      <circle cx="12" cy="12" r="4.5" />
      <circle cx="12" cy="12" r="1" />
    </svg>
  );
}

/** A document: a résumé's line (the set-up's step 3, the Résumés page) and the sidebar. */
export function DocumentIcon({ className = 'size-5' }: { className?: string }) {
  return (
    <LineIcon className={className}>
      <path d="M14 3.5H7.5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V8z" />
      <path d="M14 3.5V8h4.5M9 12.5h6M9 16h4" />
    </LineIcon>
  );
}

/** A briefcase: the Job matches page, in the sidebar (the round 7 prototype's nav icon). */
export function BriefcaseIcon({ className = 'size-5' }: { className?: string }) {
  return (
    <LineIcon className={className}>
      <rect x="3.5" y="7.25" width="17" height="12.5" rx="2" />
      <path d="M8.75 7.25V5.5c0-.83.67-1.5 1.5-1.5h3.5c.83 0 1.5.67 1.5 1.5v1.75M3.5 12.5h17" />
    </LineIcon>
  );
}

/** A chevron pointing down: a select's own arrow (the jobs table's stage). */
export function ChevronDownIcon({ className = 'size-4' }: { className?: string }) {
  return (
    <LineIcon className={className}>
      <path d="m6.5 9.5 5.5 5.5 5.5-5.5" />
    </LineIcon>
  );
}

/** Two links of a chain: a link to read (the Find jobs section). */
export function LinkIcon({ className = 'size-5' }: { className?: string }) {
  return (
    <LineIcon className={className}>
      <path d="M10 13.5a3.75 3.75 0 0 0 5.3.2l2.75-2.75a3.75 3.75 0 0 0-5.3-5.3L11.5 6.9" />
      <path d="M14 10.5a3.75 3.75 0 0 0-5.3-.2L5.95 13.05a3.75 3.75 0 0 0 5.3 5.3l1.25-1.25" />
    </LineIcon>
  );
}

/** A file the server couldn't use. */
export function AlertIcon({ className = 'size-5' }: { className?: string }) {
  return (
    <LineIcon className={className}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V13M12 16.5h.01" />
    </LineIcon>
  );
}

/** A file going up: the résumé drop zone. */
export function UploadIcon({ className = 'size-6' }: { className?: string }) {
  return (
    <LineIcon className={className}>
      <path d="M12 15.5v-11M7.5 9 12 4.5 16.5 9M4.5 14.5V18a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-3.5" />
    </LineIcon>
  );
}

function LineIcon({ className, children }: { className: string; children: ReactNode }) {
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
      {children}
    </svg>
  );
}
