import { createContext, type ReactNode, useContext } from 'react';
import { createPortal } from 'react-dom';

/** Where a signed-in page's header extras go (set by SignedInLayout). */
export const HeaderAsideSlot = createContext<HTMLElement | null>(null);

/**
 * Puts its children in the signed-in layout's header, beside Sign out, for as long as the page
 * that renders it is on screen (the set-up's step bar), so the header always matches the page.
 */
export function HeaderAside({ children }: { children: ReactNode }) {
  const slot = useContext(HeaderAsideSlot);
  return slot ? createPortal(children, slot) : null;
}
