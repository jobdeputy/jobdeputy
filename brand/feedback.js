// JobDeputy Feedback: one Feedback drawer for every signed-in page (orchestration brief 3.2). A
// classic script, loaded on every internal page after deputy.js and before the page's inline
// script.
//
// It renders dialog.drawer.feedback-drawer#feedback-drawer once and opens it through the shared
// drawer component (window.JobDeputyComponents.openDrawer), which brings focus return, Escape, the
// backdrop close, and the scroll lock. Any [data-feedback-open] control opens it. An optional
// data-feedback-topic (idea, something-broke, confusing, or praise; the visible labels work too)
// and data-feedback-context (for example "Job match: Senior Software Engineer, Search
// Infrastructure") prefill it. While it is open the deputy dock listens (notice). Send saves the
// note with JobDeputyStore.addFeedback, in this browser only, and the deputy says thanks. Nothing
// is sent anywhere. app-chrome.css lays it out, and tints each face by its rating (finding 13).
//
// The only global is window.JobDeputyFeedback: open({ topic, context, opener }).
(() => {
  if (window.JobDeputyFeedback) {
    return;
  }

  const NAME = 'Alex';
  const EMAIL = 'alex.morgan@example.com';
  const ERROR_ID = 'feedback-drawer-error';

  // A five-point rating with line faces (the nav icons' 24-unit grid and 1.75 stroke), and the
  // single-choice topics.
  const EYES = '<path d="M9.25 10h.01M14.75 10h.01" stroke-width="2.5" />';
  const RATINGS = [
    {
      value: 1,
      label: 'Frustrated',
      face: '<path d="m8.25 8.75 2.25 1.25M15.75 8.75 13.5 10" /><path d="M8.75 16.5c.8-1.25 1.9-1.9 3.25-1.9s2.45.65 3.25 1.9" />',
    },
    {
      value: 2,
      label: 'Not great',
      face: `${EYES}<path d="M9.25 15.75c.75-.6 1.67-.9 2.75-.9s2 .3 2.75.9" />`,
    },
    { value: 3, label: 'Okay', face: `${EYES}<path d="M9.25 15.25h5.5" />` },
    {
      value: 4,
      label: 'Good',
      face: `${EYES}<path d="M8.75 14c.8 1.25 1.9 1.9 3.25 1.9s2.45-.65 3.25-1.9" />`,
    },
    {
      value: 5,
      label: 'Love it',
      face: '<path d="M8 10.25c.55-.9 1.85-.9 2.4 0M13.6 10.25c.55-.9 1.85-.9 2.4 0" /><path d="M8.25 13.5h7.5c0 2.07-1.68 3.75-3.75 3.75S8.25 15.57 8.25 13.5Z" />',
    },
  ];
  const TOPICS = [
    { id: 'idea', label: 'Idea' },
    { id: 'something-broke', label: 'Something broke' },
    { id: 'confusing', label: 'Confusing' },
    { id: 'praise', label: 'Praise' },
  ];

  const icon = (paths, size) =>
    `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths}</svg>`;

  // The drawer, in the shared drawer markup. The page name, the email, the context, and the thank
  // you are filled in with textContent when it opens.
  const MARKUP = `
    <div class="drawer-header">
      <p class="eyebrow">Feedback</p>
      <h2 class="drawer-title" id="feedback-drawer-title">How is your deputy doing?</h2>
      <div class="feedback-head-notes">
        <p class="drawer-meta" id="feedback-drawer-about" hidden></p>
        <p class="sample-note feedback-note" id="feedback-drawer-note">Prototype · kept in this browser, nothing is sent</p>
      </div>
      <button class="compact-action drawer-close" type="button" data-drawer-close>Close</button>
    </div>
    <div class="drawer-body">
      <form class="feedback-form" id="feedback-drawer-form" novalidate>
        <fieldset class="feedback-group">
          <legend class="sr-only">Your rating</legend>
          <div class="feedback-rates">${RATINGS.map(
            ({ value, label, face }) =>
              `<label class="feedback-rate"><input type="radio" name="rating" value="${value}" />${icon(`<circle cx="12" cy="12" r="8.75" />${face}`, 34).replace('<svg ', '<svg class="feedback-face" ')}<span>${label}</span></label>`,
          ).join('')}</div>
        </fieldset>
        <p class="feedback-error" id="${ERROR_ID}" hidden>Choose a face or write a note.</p>
        <fieldset class="feedback-group">
          <legend class="field-label">What is it about?</legend>
          <div class="feedback-topic-list">${TOPICS.map(
            ({ id, label }) =>
              `<label class="choice-chip"><input type="radio" name="topic" value="${id}" />${label}</label>`,
          ).join('')}</div>
        </fieldset>
        <div class="feedback-field">
          <label class="field-label" for="feedback-drawer-message">Tell us more (optional)</label>
          <textarea class="field-control" id="feedback-drawer-message" name="message" rows="4" maxlength="1000" aria-describedby="feedback-drawer-count"></textarea>
          <p class="field-help" id="feedback-drawer-count">0 of 1,000 characters</p>
        </div>
        <div class="feedback-checks">
          <label class="feedback-check"><input type="checkbox" name="page" checked /><span>Include this page (<span data-feedback-page>this page</span>)</span></label>
          <label class="feedback-check"><input type="checkbox" name="contact" /><span>You can email me at <span data-feedback-email>${EMAIL}</span></span></label>
        </div>
      </form>
      <section class="feedback-thanks" id="feedback-drawer-thanks" aria-labelledby="feedback-drawer-thanks-title" hidden>
        <span class="feedback-thanks-icon" aria-hidden="true">${icon('<path d="m5.75 12.5 4 4 8.5-9" />', 28)}</span>
        <p class="section-label">Your deputy</p>
        <h3 class="feedback-thanks-title" id="feedback-drawer-thanks-title">Thanks, ${NAME}. I’ve kept your note.</h3>
        <p class="sample-note">Prototype · saved in this browser only, nothing was sent</p>
      </section>
    </div>
    <div class="drawer-footer feedback-actions">
      <button class="primary-action" type="submit" form="feedback-drawer-form" data-feedback-send>Send</button>
      <button class="secondary-action" type="button" data-drawer-close data-feedback-cancel>Cancel</button>
      <button class="primary-action" type="button" data-drawer-close data-feedback-done hidden>Done</button>
    </div>
    <p class="sr-only" id="feedback-drawer-status" role="status" aria-live="polite"></p>`;

  let dialog = null;
  let sent = false;
  let context = '';
  let announceTimer;

  const part = (selector) => dialog.querySelector(selector);
  const form = () => part('#feedback-drawer-form');
  const rates = () => [...dialog.querySelectorAll('input[name="rating"]')];
  const deputy = () => window.JobDeputyDeputy;

  // The visible labels also name a topic: "Something broke" is something-broke.
  const slug = (text) =>
    String(text ?? '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '-');
  const topicFor = (value) =>
    TOPICS.find((topic) => topic.id === slug(value) || slug(topic.label) === slug(value))?.id ??
    null;

  // The page as the person knows it: the current nav section (the Invite page marks the header's
  // Invite link instead; a child route marks its parent section), else the document title.
  const pageName = () => {
    const current =
      document.querySelector('.app-nav-link[aria-current="page"] .app-nav-label') ??
      document.querySelector('.header-action[aria-current="page"] .header-action-label') ??
      document.querySelector('.app-nav-link[aria-current="true"] .app-nav-label');
    const name =
      current?.textContent.trim() || document.title.replace(/^JobDeputy\s*\W\s*/, '').trim();
    return name || 'this page';
  };
  const pagePath = () => `${window.location.pathname.split('/').pop()}${window.location.search}`;

  const person = () => {
    const profile = window.JobDeputyStore?.get().profile ?? {};
    return {
      name: profile.preferredName || profile.firstName || NAME,
      email: profile.email || EMAIL,
    };
  };

  // One announcement through the drawer's own visually hidden channel. Clearing first lets a
  // repeated message be read again.
  const announce = (message) => {
    const channel = part('#feedback-drawer-status');
    window.clearTimeout(announceTimer);
    channel.textContent = '';
    announceTimer = window.setTimeout(() => {
      channel.textContent = message;
    }, 40);
  };

  const updateCount = () => {
    const length = part('#feedback-drawer-message').value.length;
    part('#feedback-drawer-count').textContent =
      `${length.toLocaleString('en-US')} of 1,000 characters`;
  };

  // FieldFeedback for "a rating or a message": the line sits under the faces, every face and the
  // message point to it, and focus moves to the first face.
  const describedBy = (element, on) => {
    const ids = (element.getAttribute('aria-describedby') ?? '')
      .split(/\s+/)
      .filter((id) => id && id !== ERROR_ID);
    if (on) ids.push(ERROR_ID);
    if (ids.length) element.setAttribute('aria-describedby', ids.join(' '));
    else element.removeAttribute('aria-describedby');
  };
  const showError = (on) => {
    part(`#${ERROR_ID}`).hidden = !on;
    for (const input of [...rates(), part('#feedback-drawer-message')]) describedBy(input, on);
  };

  // The deputy listens while the drawer is open. flash() ends by returning to the page's own
  // state, copy, and working flag, so a 1ms notice puts the deputy back as the page left it.
  const listen = () => deputy()?.set('notice');
  const release = () => deputy()?.flash('notice', { ms: 1 });
  // The thank-you follows the rating, and stays honest: sorry for a low one, glad for a high one,
  // plain thanks for Okay or a note alone. Each still says the note is kept (nothing is sent), and
  // the deputy's line (six words or fewer) matches it.
  const THANKS = {
    low: { opener: 'Sorry it fell short', speech: 'I’m sorry it fell short.' },
    plain: { opener: 'Thanks', speech: 'Thanks for telling me.' },
    glad: { opener: 'Glad it’s helping', speech: 'I’m glad it helps.' },
  };
  const thanksFor = (rating) =>
    rating && rating <= 2 ? THANKS.low : rating >= 4 ? THANKS.glad : THANKS.plain;

  // Once the note is kept the deputy reacts once (R3-8): its "sent" reaction when deputy.js has
  // react(), otherwise the success moment.
  const thank = (rating) => {
    const { speech } = thanksFor(rating);
    if (typeof deputy()?.react === 'function') deputy().react('sent', { speech });
    else deputy()?.flash('success', { speech });
  };

  const showThanks = (name, rating) => {
    const title = `${thanksFor(rating).opener}, ${name}. I’ve kept your note.`;
    part('#feedback-drawer-thanks-title').textContent = title;
    form().hidden = true;
    part('#feedback-drawer-note').hidden = true;
    part('#feedback-drawer-thanks').hidden = false;
    part('[data-feedback-send]').hidden = true;
    part('[data-feedback-cancel]').hidden = true;
    const done = part('[data-feedback-done]');
    done.hidden = false;
    dialog.scrollTop = 0;
    done.focus();
    announce(`${title} Prototype: saved in this browser only, nothing was sent.`);
  };

  const send = () => {
    const fields = form().elements;
    const rating = Number(fields.rating.value) || null;
    const message = fields.message.value.trim();
    if (!rating && !message) {
      showError(true);
      rates()[0].focus();
      return;
    }
    const { name, email } = person();
    window.JobDeputyStore?.addFeedback({
      rating,
      topic: fields.topic.value || null,
      message,
      page: fields.page.checked ? { name: pageName(), path: pagePath() } : null,
      context: context || null,
      contact: fields.contact.checked ? email : null,
    });
    sent = true;
    showThanks(name, rating);
    thank(rating);
  };

  // A fresh note every time the drawer opens, prefilled from the opener.
  const reset = ({ topic = null, context: about = null } = {}) => {
    sent = false;
    context = String(about ?? '').trim();
    form().reset();
    const id = topicFor(topic);
    if (id) dialog.querySelector(`input[name="topic"][value="${id}"]`).checked = true;
    showError(false);
    updateCount();
    const aboutLine = part('#feedback-drawer-about');
    aboutLine.textContent = context ? `About: ${context}` : '';
    aboutLine.hidden = !context;
    part('[data-feedback-page]').textContent = pageName();
    part('[data-feedback-email]').textContent = person().email;
    form().hidden = false;
    part('#feedback-drawer-note').hidden = false;
    part('#feedback-drawer-thanks').hidden = true;
    part('[data-feedback-send]').hidden = false;
    part('[data-feedback-cancel]').hidden = false;
    part('[data-feedback-done]').hidden = true;
    part('#feedback-drawer-status').textContent = '';
    dialog.scrollTop = 0;
  };

  const render = () => {
    if (dialog) {
      return dialog;
    }
    dialog = document.createElement('dialog');
    dialog.className = 'drawer feedback-drawer';
    dialog.id = 'feedback-drawer';
    dialog.setAttribute('aria-labelledby', 'feedback-drawer-title');
    dialog.setAttribute('aria-describedby', 'feedback-drawer-note');
    dialog.innerHTML = MARKUP;
    document.body.append(dialog);

    form().addEventListener('submit', (event) => {
      event.preventDefault();
      send();
    });
    form().addEventListener('change', (event) => {
      if (event.target.name === 'rating') showError(false);
    });
    part('#feedback-drawer-message').addEventListener('input', (event) => {
      updateCount();
      if (event.target.value.trim()) showError(false);
    });
    dialog.addEventListener('close', () => {
      if (!sent) release();
    });
    return dialog;
  };

  const open = ({ topic = null, context: about = null, opener = null } = {}) => {
    render();
    if (dialog.open) {
      return dialog;
    }
    reset({ topic, context: about });
    const from = opener instanceof HTMLElement ? opener : document.activeElement;
    const components = window.JobDeputyComponents;
    if (components?.openDrawer) components.openDrawer(dialog, from);
    else dialog.showModal();
    // Focus that moves inside the drawer stays clear of its sticky header and footer (app-panels.js).
    window.JobDeputyPanels?.keepFocusClear?.(dialog);
    // Focus starts on the rating, so a phone does not raise its keyboard.
    rates()[0].focus();
    listen();
    return dialog;
  };

  // Any [data-feedback-open] control opens the drawer. From the account menu, the menu closes and
  // focus later returns to its chip, which stays visible.
  document.addEventListener('click', (event) => {
    const trigger =
      event.target instanceof Element ? event.target.closest('[data-feedback-open]') : null;
    if (!trigger) {
      return;
    }
    event.preventDefault();
    const menu = trigger.closest('details.account-menu');
    if (menu) {
      menu.open = false;
    }
    open({
      topic: trigger.getAttribute('data-feedback-topic'),
      context: trigger.getAttribute('data-feedback-context'),
      opener: menu?.querySelector('summary') ?? trigger,
    });
  });

  window.JobDeputyFeedback = Object.freeze({ open });

  if (document.body) {
    render();
  } else {
    document.addEventListener('DOMContentLoaded', render, { once: true });
  }
})();
