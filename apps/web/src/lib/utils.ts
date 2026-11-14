import { type ClassValue, clsx } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// Our theme adds shadow and easing names Tailwind does not have; without them, `shadow-none`
// would not replace `shadow-control`. Add a name here when tokens.css adds one to these scales.
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      shadow: ['control', 'panel'],
      ease: ['settle', 'spring'],
    },
  },
});

/** Joins class names, and lets a later Tailwind class override an earlier one (shadcn/ui's helper). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
