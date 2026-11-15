/**
 * Keeps Radix's scroll lock working under the site's CSP (style-src 'self'). When a drawer or
 * dialog opens, Radix marks <body> with data-scroll-locked and injects a <style> that hides the
 * page's overflow and pads for the scrollbar it removes; the CSP blocks that <style>. Here the
 * scrollbar's width is measured first and handed over as a CSS variable (through the style API,
 * which the CSP allows), then data-scroll-gap tells base.css to lock: overflow hidden, and that
 * width as margin, so the page neither scrolls nor shifts. Where Radix's <style> is allowed, it
 * has locked already, and this stands aside. Radix's other offsets (its
 * right-scroll-bar-position and width-before-scroll-bar classes) are not used in the app.
 */
export function keepScrollLock(body: HTMLElement = document.body): () => void {
  const sync = () => {
    const locked = body.hasAttribute('data-scroll-locked');
    if (locked && !body.hasAttribute('data-scroll-gap')) {
      // Where Radix's <style> was allowed (no CSP: local dev, the test build), it has locked
      // already, with the right gap (its own variable is set): nothing to add.
      if (getComputedStyle(body).getPropertyValue('--removed-body-scroll-bar-size') !== '') return;
      // Measured before the lock applies (base.css waits for data-scroll-gap).
      const gap = Math.max(0, window.innerWidth - document.documentElement.clientWidth);
      body.style.setProperty('--scroll-gap', `${gap}px`);
      body.setAttribute('data-scroll-gap', '');
    } else if (!locked && body.hasAttribute('data-scroll-gap')) {
      body.removeAttribute('data-scroll-gap');
      body.style.removeProperty('--scroll-gap');
    }
  };
  const observer = new MutationObserver(sync);
  observer.observe(body, { attributes: true, attributeFilter: ['data-scroll-locked'] });
  return () => observer.disconnect();
}
