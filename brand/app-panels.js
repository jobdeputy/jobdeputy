// JobDeputy panels: the Prompt drawer and the buy dialog (round 4's Get more runs) on every
// signed-in page (orchestration brief 3.3 and 3.5, findings 30 and 17). A classic script, loaded on
// every internal page after feedback.js and before the page's inline script.
//
// Both are shared drawers (dialog.drawer, opened through window.JobDeputyComponents.openDrawer,
// which brings focus return, Escape, the backdrop close, and the scroll lock), rendered once, and
// bottom sheets on phones (app-chrome.css). Each announces its results through its own visually
// hidden channel, the deputy listens while one is open (notice), and it reacts once after a save
// (react('saved') when deputy.js has it, else flash('success')).
//
// - Prompt drawer (dialog.prompt-drawer#prompt-drawer): any [data-prompt-open="<task id>"],
//   JobDeputyPanels.openPrompt(id, { opener, edit, compare }), or ?prompt=<task id> on the page's
//   address, for the eight tasks. Round 6 (S1) puts the prompt control first (Versions and tests:
//   the version dropdown, the two measures, a test as it happens, the result, and the actions),
//   with the rollback rules in one line and the changes; then Your instructions (Edit as a new
//   version lands here, and with the store's lifecycle Save keeps a new draft and tests it at
//   once), with the guardrail checks (brand/prompt-guard.js) updating as you type, debounced and
//   announced once, and Save off while a check blocks; the System prompt (read only, "JobDeputy
//   system prompt, version 2026.10.1", with the full prompt as your deputy receives it); How it
//   runs (where, when, the model once from the one AI setting, R4-2, and the limits); and Stats
//   (Kept by you and Test score by version, the 14-day trend against the minimum, the
//   version in use against the one before, and the rollback history; sample data). Without the
//   guard on the page it says the checks are unavailable and saves nothing (fails closed, R5-5);
//   without a store, or for an unknown task, it shows a notice.
// - The prompt control (round 6, S1): any [data-prompt-control="<task id>"] on a page is drawn
//   and kept in step with the store by this script (its options are listed where its code
//   begins). Its rules ship in CONTROL_STYLES. When a prompt test ends
//   on any page, JobDeputyComponents.notice says so (the store keeps it in the deputy's
//   Activity), and while a test runs the deputy is in its test state.
// - The buy dialog (dialog.topup-drawer#topup-drawer, round 5, brief 3.5): any
//   [data-topup-open="credits" | "nightly"] or JobDeputyPanels.openTopup(kind), the name every
//   caller already uses (round 4's "ai" opens credits). Round 7 (R10-3, T2-6): buying has one
//   home, so off Purchases these go to shop-preview.html#buy (runs) or #credits with return=
//   instead; a page's own buy action is best a link there. On Purchases it lists the three packs
//   of that kind from JobDeputyStore.shopItems(): AI credits as the tokens they buy on the
//   account's platform model and their price, runs as runs, how long they last at your settings
//   (the store's runway), and price. Continue opens the sample checkout
//   for the chosen pack in the same dialog; JobDeputyPanels.checkout(itemId, { opener }), any
//   [data-checkout="<item id>"] (the Shop's Buy buttons), and ?checkout=<item id> on a page's
//   address open it directly. The checkout shows the item, what it adds, the price (a bundle's list
//   price and saving too), the tax line from PRICING, the agreement gate while
//   requiresAgreement('buy') asks for the current version (Review and sign opens
//   agreement-preview.html?mode=update&return=<this page, with ?checkout=, and its anchor>, so
//   signing comes back here and the checkout opens again), and Add to my sample account, which
//   calls JobDeputyStore.buy(itemId): what was bought is added at once, nothing is charged, and the
//   deputy celebrates. "Sample prices · nothing is charged" (PRICING.note) sits by every price,
//   and each view links to its section of the Shop (hidden on the Shop itself).
//
// A trigger inside the account menu closes the menu and returns focus to its chip afterwards.
// Keyboard focus inside either drawer stays clear of its sticky header and footer (keepFocusClear,
// which feedback.js uses too); a pointer press on a button or a box never scrolls the drawer.
// The only global is window.JobDeputyPanels: openPrompt(id, { opener }), openTopup(kind,
// { opener }), checkout(itemId, { opener }), TASKS (the eight task ids), and
// keepFocusClear(dialog).
(() => {
  if (window.JobDeputyPanels) {
    return;
  }

  // The eight LLM tasks (round 5 adds mail, Read application emails, and reply, Draft a reply); the
  // store's own list wins when it has one.
  const TASKS = Object.freeze([
    'read',
    'rank',
    'tailor',
    'letter',
    'answer',
    'check',
    'mail',
    'reply',
  ]);
  const MAX_INSTRUCTIONS = 2000;

  const store = () => window.JobDeputyStore;
  const deputy = () => window.JobDeputyDeputy;
  const has = (name) => typeof store()?.[name] === 'function';
  const taskIds = () => {
    const ids = store()?.PROMPT_IDS;
    return Array.isArray(ids) && ids.length ? ids : TASKS;
  };
  const isElement = (value) => typeof Element !== 'undefined' && value instanceof Element;

  const esc = (value) =>
    String(value ?? '').replace(
      /[&<>"']/g,
      (character) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character],
    );
  const count = (value) => Number(value).toLocaleString('en-US');
  const plural = (n, one, many) => `${count(n)} ${n === 1 ? one : many}`;
  const finite = (value) => (Number.isFinite(value) ? value : null);

  // Dates from the store: an ISO day ("2026-10-06"), a timestamp, or a Date, shown in the
  // prototype's own calendar day ("Tue, Oct 6"). Anything else is shown as it is.
  const dayOf = (value) => {
    if (value == null || value === '') return null;
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return new Date(`${value}T12:00:00Z`);
    }
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  };
  // The store's own formats ("Tue, Oct 6" and "Oct 31") keep every page's dates alike; this file's
  // formatter stands in when the store has none.
  const formatDay = (value, { weekday = true } = {}) => {
    const shared = store()?.format?.[weekday ? 'date' : 'shortDate'];
    if (typeof shared === 'function') {
      const shown = shared(value);
      if (shown) return shown;
    }
    const date = dayOf(value);
    if (!date) return value == null ? '' : String(value);
    const zone =
      typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
        ? 'UTC'
        : 'America/Los_Angeles';
    return date.toLocaleDateString('en-US', {
      ...(weekday ? { weekday: 'short' } : {}),
      month: 'short',
      day: 'numeric',
      timeZone: zone,
    });
  };

  // One announcement through a drawer's own visually hidden channel. Clearing first lets a
  // repeated message be read again.
  const announcer = () => {
    let timer;
    return (channel, message) => {
      window.clearTimeout(timer);
      channel.textContent = '';
      timer = window.setTimeout(() => {
        channel.textContent = message;
      }, 40);
    };
  };

  // The deputy listens while a panel is open; flash() ends by returning to the page's own state,
  // so a 1ms notice puts it back as the page left it. After a save it reacts once.
  const listen = () => deputy()?.set?.('notice');
  const release = () => deputy()?.flash?.('notice', { ms: 1 });
  const celebrate = (speech) => {
    const companion = deputy();
    if (typeof companion?.react === 'function') companion.react('saved', { speech });
    else companion?.flash?.('success', { speech });
  };

  // Focus moving inside a drawer stays clear of its sticky header and footer (WCAG 2.4.11): the
  // drawer's scroll padding is their full height plus 13px of room, kept in step as they change.
  const observed = new WeakSet();
  // A part covers the drawer's content while it sticks; on a short screen the header scrolls with
  // the content while you type (T5-5, app-components.css), and then it covers nothing.
  const covers = (part) => {
    if (!part || part.hidden) return false;
    try {
      return getComputedStyle(part).position !== 'static';
    } catch {
      return true;
    }
  };
  const padFor = (dialog) => {
    if (!dialog.style) return;
    const height = (part) => (covers(part) ? part.offsetHeight : 0);
    dialog.style.scrollPaddingTop = `${height(dialog.querySelector('.drawer-header')) + 13}px`;
    dialog.style.scrollPaddingBottom = `${height(dialog.querySelector('.drawer-footer')) + 13}px`;
  };
  // The browser scrolls a newly focused field only when it is outside the drawer's box, so one
  // that sits partly under the sticky header or footer (its 5px focus ring included: the 2px
  // outline and its 3px offset) is brought clear here, as app-components.js does for page drawers.
  // Only keyboard focus (:focus-visible) and fields you type into scroll: a pointer press on a
  // button, a link, a checkbox, or a radio stays where it is, so a control half under the footer
  // does not move away before the release (which would lose the click).
  const FOCUS_RING = 5;
  const PRESSED_INPUTS = new Set([
    'button',
    'checkbox',
    'color',
    'file',
    'image',
    'radio',
    'range',
    'reset',
    'submit',
  ]);
  const typedInto = (element) => {
    const tag = String(element.tagName).toLowerCase();
    if (tag === 'textarea' || tag === 'select' || element.isContentEditable) return true;
    const type = String(element.getAttribute?.('type') ?? 'text').toLowerCase();
    return tag === 'input' && !PRESSED_INPUTS.has(type);
  };
  const keyboardFocus = (element) => {
    if (typedInto(element)) return true;
    try {
      return element.matches(':focus-visible');
    } catch {
      return true;
    }
  };
  const reveal = (dialog, target) => {
    if (!isElement(target) || target === dialog || typeof target.scrollIntoView !== 'function')
      return;
    if (!keyboardFocus(target)) return;
    const header = dialog.querySelector('.drawer-header');
    const footer = dialog.querySelector('.drawer-footer');
    if (header?.contains(target) || footer?.contains(target)) return;
    const box = target.getBoundingClientRect();
    const frame = dialog.getBoundingClientRect();
    const top = covers(header) ? header.getBoundingClientRect().bottom : frame.top;
    const bottom = covers(footer) ? footer.getBoundingClientRect().top : frame.bottom;
    if (box.top - FOCUS_RING < top || box.bottom + FOCUS_RING > bottom) {
      target.scrollIntoView({ block: 'nearest' });
    }
  };
  const keepFocusClear = (dialog) => {
    if (!dialog) return;
    padFor(dialog);
    if (observed.has(dialog)) return;
    observed.add(dialog);
    // The padding follows the parts as focus moves (app-components.js pads again as focus leaves).
    dialog.addEventListener('focusin', (event) => {
      padFor(dialog);
      reveal(dialog, event.target);
    });
    if (typeof ResizeObserver !== 'function') return;
    const observer = new ResizeObserver(() => padFor(dialog));
    observer.observe(dialog);
    for (const part of dialog.querySelectorAll('.drawer-header, .drawer-footer')) {
      observer.observe(part);
    }
  };

  const openDrawer = (dialog, opener) => {
    const components = window.JobDeputyComponents;
    if (components?.openDrawer) components.openDrawer(dialog, opener);
    else if (!dialog.open) dialog.showModal();
    keepFocusClear(dialog);
  };

  const createDrawer = (className, id, markup, labelledBy, describedBy) => {
    const dialog = document.createElement('dialog');
    dialog.className = `drawer ${className}`;
    dialog.id = id;
    dialog.setAttribute('aria-labelledby', labelledBy);
    dialog.setAttribute('aria-describedby', describedBy);
    dialog.innerHTML = markup;
    document.body.append(dialog);
    return dialog;
  };

  // ---------------------------------------------------------------- prompts

  // The store's record for one task (sample-store.js, round 5: name, purpose, where, runs, model,
  // caps, locked, output, data, defaultInstructions, instructions, isDefault, version, versions,
  // history, system, preview), read so that a missing field leaves a blank line rather than a broken
  // drawer. A store without versions (round 4) still shows the one set of instructions it keeps.
  const text = (value) => (value == null ? '' : String(value));
  const firstText = (...values) => values.map(text).find((value) => value.trim()) ?? '';
  const listWords = (items) =>
    items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;

  const pagesOf = (where) =>
    (Array.isArray(where) ? where : [where])
      .map((item) => (typeof item === 'string' ? item : firstText(item?.page, item?.label)))
      .filter((page) => page.trim());

  const describeModel = (model) => {
    if (!model) return '';
    if (typeof model === 'string') return model;
    return firstText(model.text, [model.label, model.model].map(text).filter(Boolean).join(' · '));
  };

  // The caps as short lines: the turn, token, and time limits, then how many calls and how much
  // input a run may use (decision 0002).
  const describeCaps = (caps) => {
    if (!caps || typeof caps !== 'object') return caps ? [text(caps)] : [];
    const limits = [
      finite(caps.turns) && `up to ${plural(caps.turns, 'turn', 'turns')}`,
      finite(caps.maxOutputTokens) && `${count(caps.maxOutputTokens)} output tokens a call`,
      finite(caps.timeoutSeconds) && `stops after ${count(caps.timeoutSeconds)} seconds`,
    ].filter(Boolean);
    const first = limits.join(', ');
    return [
      first && first.charAt(0).toUpperCase() + first.slice(1),
      text(caps.calls),
      caps.input
        ? `Reads ${text(caps.input).charAt(0).toLowerCase()}${text(caps.input).slice(1)}`
        : '',
    ].filter((line) => line.trim());
  };

  const rulesOf = (rules) =>
    (Array.isArray(rules) ? rules : [])
      .map((rule) => (typeof rule === 'string' ? rule : firstText(rule?.text)))
      .filter((rule) => rule.trim());

  // One AI setting runs every task (round 4, R4-2), so the drawer states the model once and offers
  // no model choice: the store's note for the task (read and rank have one), or this line.
  const ONE_SETTING = 'Every search and draft uses your one AI setting.';
  const SYSTEM_DEFAULT = 'System default';

  // Every check the guard ran, in a shape the drawer can trust whatever the source.
  const STATUSES = ['passed', 'blocked', 'warn'];
  const checksOf = (list) =>
    (Array.isArray(list) ? list : [])
      .filter((item) => item && typeof item === 'object')
      .map((item) => ({
        id: text(item.id),
        label: firstText(item.label, item.id),
        status: STATUSES.includes(item.status) ? item.status : 'blocked',
        detail: text(item.detail),
      }));

  const versionOf = (raw) => ({
    id: text(raw?.id),
    n: finite(Number(raw?.n)) ?? 0,
    label: firstText(raw?.label, raw?.n ? `Version ${raw.n}` : 'Version'),
    instructions: text(raw?.instructions),
    savedAt: raw?.savedAt ?? null,
    checks: checksOf(raw?.checks),
    active: Boolean(raw?.active),
  });

  const readPrompt = (id) => {
    if (!taskIds().includes(id) || !has('prompt') || !has('setPrompt')) return null;
    let raw;
    try {
      raw = store().prompt(id);
    } catch {
      return null;
    }
    if (!raw || typeof raw !== 'object') return null;
    const defaultText = text(raw.defaultInstructions);
    const versions = Array.isArray(raw.versions) ? raw.versions.map(versionOf) : null;
    const isDefault = typeof raw.isDefault === 'boolean' ? raw.isDefault : !raw.customized;
    const current = firstText(raw.instructions, defaultText);
    const active = versions?.find((version) => version.active) ?? null;
    return {
      id,
      name: firstText(raw.name, id),
      purpose: text(raw.purpose),
      where: listWords(pagesOf(raw.where)),
      when: text(raw.runs),
      model: describeModel(raw.model),
      note: firstText(raw.note, raw.model ? ONE_SETTING : ''),
      limits: describeCaps(raw.caps),
      locked: rulesOf(raw.locked),
      output: text(raw.output),
      data: (Array.isArray(raw.data) ? raw.data : [])
        .map((item) => (typeof item === 'string' ? { tag: item, label: '' } : item))
        .filter((item) => text(item?.tag).trim())
        .map((item) => ({ tag: text(item.tag), label: text(item.label) })),
      preview: text(raw.preview),
      system: {
        label: firstText(raw.system?.label, 'JobDeputy system prompt'),
        text: text(raw.system?.text),
      },
      defaultText,
      current,
      isDefault,
      // Which instructions run now: "Yours, version 3" or "System default".
      inUse: firstText(raw.version?.label, isDefault ? SYSTEM_DEFAULT : 'Yours'),
      inUseShort: isDefault
        ? SYSTEM_DEFAULT
        : firstText(active?.label, raw.version?.label, 'Yours'),
      versions,
      history: (Array.isArray(raw.history) ? raw.history : [])
        .filter((entry) => entry && typeof entry === 'object')
        .map((entry) => ({ at: entry.at ?? null, text: text(entry.text) }))
        .filter((entry) => entry.text.trim()),
      maxLength: MAX_INSTRUCTIONS,
    };
  };

  // The full prompt as the model receives it, live as you type: the store's own preview with your
  // new instructions in place of the saved ones; without one, the locked rules, your
  // instructions, and what the task returns.
  const composePrompt = (task, instructions) => {
    const typed = instructions.trim() || '(none)';
    if (task.preview && task.current && task.preview.includes(task.current)) {
      return task.preview.replace(task.current, () => typed);
    }
    return [
      'Rules (locked):',
      ...task.locked.map((rule, index) => `${index + 1}. ${rule}`),
      '',
      'Your instructions:',
      typed,
      ...(task.output ? ['', `Return: ${task.output}`] : []),
    ].join('\n');
  };

  // The guardrail checks (brand/prompt-guard.js, round 5), run as the store runs them before it
  // saves, so what you see while typing is what a save meets. Without the guard on the page, or
  // when it fails, the result is 'unavailable': the drawer says so and nothing can be saved, as the
  // store refuses too (fails closed, R5-5).
  const promptGuard = () => {
    const guard = window.JobDeputyPromptGuard;
    return guard && typeof guard.check === 'function' ? guard : null;
  };
  const UNAVAILABLE = Object.freeze({ status: 'unavailable', checks: [], summary: '' });
  const runChecks = (value, id) => {
    const guard = promptGuard();
    if (!guard) return UNAVAILABLE;
    try {
      const result = guard.check(value, { task: id });
      if (!result || !Array.isArray(result.checks) || !result.checks.length) return UNAVAILABLE;
      const checks = checksOf(result.checks);
      const blocked =
        result.status !== 'passed' || checks.some((item) => item.status === 'blocked');
      return { status: blocked ? 'blocked' : 'passed', checks, summary: text(result.summary) };
    } catch {
      return UNAVAILABLE;
    }
  };
  // A version's own result in a few words ("Passed all 10 checks", "Passed, 1 warning").
  const checksWords = (checks) => {
    if (!checks.length) return 'Checks not recorded';
    const blocked = checks.filter((item) => item.status === 'blocked').length;
    if (blocked) return `Blocked by ${plural(blocked, 'check', 'checks')}`;
    const warned = checks.filter((item) => item.status === 'warn').length;
    if (warned) return `Passed, ${plural(warned, 'warning', 'warnings')}`;
    return `Passed all ${plural(checks.length, 'check', 'checks')}`;
  };
  const summaryOf = (result) => {
    if (result.status === 'unavailable')
      return 'The checks aren’t available, so nothing can be saved.';
    if (result.summary.trim()) return result.summary;
    const blocked = result.checks.filter((item) => item.status === 'blocked');
    return blocked.length
      ? `Blocked by ${plural(blocked.length, 'check', 'checks')}: ${blocked.map((item) => item.label).join('; ')}.`
      : `${checksWords(result.checks)}.`;
  };

  // Dates and times in the store's own words ("Fri, Oct 2, 14:05").
  const formatWhen = (value) => {
    if (value == null || value === '') return '';
    const shared = store()?.format?.dateTime;
    if (typeof shared === 'function') {
      const shown = shared(value);
      if (shown) return shown;
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return text(value);
    return date.toLocaleString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZone: 'America/Los_Angeles',
    });
  };

  const PROMPT_MARKUP = `
    <div class="drawer-header">
      <p class="eyebrow" id="prompt-drawer-eyebrow">See the prompt</p>
      <h2 class="drawer-title" id="prompt-drawer-title">Prompt</h2>
      <p class="drawer-meta" id="prompt-drawer-purpose"></p>
      <button class="compact-action drawer-close" type="button" data-drawer-close>Close</button>
    </div>
    <div class="drawer-body">
      <div class="feedback-panel" data-kind="notice" id="prompt-drawer-missing" hidden>
        <span class="feedback-panel-icon" aria-hidden="true">i</span>
        <span class="feedback-panel-copy"><strong class="feedback-panel-title">This prompt isn’t available here.</strong><span class="feedback-panel-message" id="prompt-drawer-missing-message">Open Settings, Prompts to see every prompt, or reset the sample data in Help.</span></span>
      </div>
      <div class="prompt-content" id="prompt-drawer-content">
        <section class="drawer-section" id="prompt-drawer-versions" aria-labelledby="prompt-drawer-versions-title">
          <h3 class="drawer-section-title" id="prompt-drawer-versions-title">Versions and tests</h3>
          <div class="prompt-control" id="prompt-drawer-control" data-prompt-view="full"></div>
          <p class="prompt-drawer-rules" id="prompt-drawer-rules" hidden></p>
          <button class="compact-action prompt-reset" type="button" data-prompt-reset hidden>Back to the system default</button>
          <details class="prompt-history" id="prompt-drawer-history" hidden>
            <summary class="prompt-rules-toggle"><span>Changes (<span data-prompt-history-count>0</span>)</span></summary>
            <ol class="prompt-history-list" id="prompt-drawer-history-list"></ol>
          </details>
        </section>
        <section class="drawer-section" aria-labelledby="prompt-drawer-text-label">
          <form class="prompt-field" id="prompt-drawer-form" novalidate>
            <div class="prompt-field-head">
              <label class="field-label" id="prompt-drawer-text-label" for="prompt-drawer-text">Your instructions</label>
              <span class="status-pill is-neutral" data-prompt-state>${SYSTEM_DEFAULT}</span>
            </div>
            <p class="prompt-editing" id="prompt-drawer-editing" hidden></p>
            <textarea class="field-control" id="prompt-drawer-text" name="instructions" rows="8" maxlength="${MAX_INSTRUCTIONS}" aria-describedby="prompt-drawer-count prompt-drawer-checks-summary prompt-drawer-applies"></textarea>
            <p class="field-help" id="prompt-drawer-count">0 of ${count(MAX_INSTRUCTIONS)} characters</p>
            <p class="feedback-error" id="prompt-drawer-error" hidden>Write your instructions, or go back to the system default.</p>
            <div class="prompt-guard" id="prompt-drawer-guard">
              <h4 class="prompt-guard-title" id="prompt-drawer-checks-title">Guardrail checks</h4>
              <p class="prompt-guard-summary" id="prompt-drawer-checks-summary"></p>
              <ul class="prompt-checks" id="prompt-drawer-checks" aria-labelledby="prompt-drawer-checks-title"></ul>
              <div class="feedback-panel" data-kind="warning" id="prompt-drawer-unchecked" hidden>
                <span class="feedback-panel-icon" aria-hidden="true">!</span>
                <span class="feedback-panel-copy"><strong class="feedback-panel-title">The checks aren’t available here.</strong><span class="feedback-panel-message">Nothing can be saved until they load. Reload the page to try again.</span></span>
              </div>
              <p class="prompt-guard-note" id="prompt-drawer-server">The same checks run again on our servers, and the locked rules and data blocks apply whatever your instructions say.</p>
            </div>
            <p class="prompt-applies" id="prompt-drawer-applies">Applies to new runs. Your instructions can’t turn off the safety rules.</p>
          </form>
          <div class="feedback-panel" data-kind="error" id="prompt-drawer-failed" hidden>
            <span class="feedback-panel-icon" aria-hidden="true">!</span>
            <span class="feedback-panel-copy"><strong class="feedback-panel-title" id="prompt-drawer-failed-title">We couldn’t save your instructions.</strong><span class="feedback-panel-message" id="prompt-drawer-failed-message">Change what the checks found and try again.</span></span>
          </div>
          <div class="feedback-panel prompt-saved" data-kind="success" id="prompt-drawer-saved" hidden>
            <span class="feedback-panel-icon" aria-hidden="true">✓</span>
            <span class="feedback-panel-copy"><strong class="feedback-panel-title" id="prompt-drawer-saved-title"></strong><span class="feedback-panel-message" id="prompt-drawer-saved-message"></span></span>
          </div>
        </section>
        <section class="drawer-section" aria-labelledby="prompt-drawer-system-title">
          <h3 class="drawer-section-title" id="prompt-drawer-system-title">System prompt</h3>
          <p class="prompt-system-line"><span id="prompt-drawer-system-label">JobDeputy system prompt</span> <span class="status-pill is-neutral">Read only</span></p>
          <ol class="prompt-outline" aria-label="How the prompt fits together">
            <li><span class="prompt-outline-name">Locked rules</span><span class="prompt-outline-meta">First, always. Your instructions can’t change them.</span>
              <details class="prompt-rules">
                <summary class="prompt-rules-toggle"><span>Safety rules your instructions can’t change (<span data-prompt-rule-count>0</span>)</span></summary>
                <ol class="prompt-rules-list" data-prompt-rules></ol>
              </details>
            </li>
            <li><span class="prompt-outline-name">Your instructions</span><span class="prompt-outline-meta" data-prompt-outline-yours></span></li>
            <li><span class="prompt-outline-name">What it returns</span><span class="prompt-outline-meta" data-prompt-outline-returns></span></li>
            <li><span class="prompt-outline-name">Data blocks, never instructions</span><span class="prompt-outline-meta" data-prompt-outline-data></span></li>
          </ol>
          <details class="prompt-full">
            <summary class="prompt-rules-toggle"><span id="prompt-drawer-preview-title">The full prompt, as your deputy receives it</span></summary>
            <pre class="prompt-preview" id="prompt-drawer-preview" role="region" tabindex="0" aria-labelledby="prompt-drawer-preview-title"></pre>
          </details>
        </section>
        <section class="drawer-section" aria-labelledby="prompt-drawer-runs">
          <h3 class="drawer-section-title" id="prompt-drawer-runs">How it runs</h3>
          <dl class="prompt-facts">
            <div><dt>Where</dt><dd data-prompt-where></dd></div>
            <div><dt>When</dt><dd data-prompt-when></dd></div>
            <div><dt>Model</dt><dd data-prompt-model></dd></div>
            <div><dt>Limits</dt><dd data-prompt-caps></dd></div>
          </dl>
        </section>
        <section class="drawer-section" aria-labelledby="prompt-drawer-metrics-title">
          <h3 class="drawer-section-title" id="prompt-drawer-metrics-title">Stats</h3>
          <div class="prompt-control prompt-drawer-stats" id="prompt-drawer-metrics"></div>
        </section>
        <p class="sample-note">Prototype · saved in this browser, nothing is sent</p>
      </div>
    </div>
    <div class="drawer-footer prompt-actions">
      <p class="prompt-save-why" id="prompt-drawer-save-why" hidden></p>
      <p class="prompt-save-next" id="prompt-drawer-save-next" hidden></p>
      <button class="primary-action" type="submit" form="prompt-drawer-form" data-prompt-save>Save</button>
    </div>
    <p class="sr-only" id="prompt-drawer-status" role="status" aria-live="polite"></p>`;

  let promptDialog = null;
  let promptTask = null;
  let promptSaved = false;
  let promptResult = UNAVAILABLE;
  let promptHeard = '';
  let checkTimer = 0;
  // Edit as a new version (round 6): the version whose instructions the editor started from.
  let promptEditFrom = null;
  const CHECK_DELAY = 300;
  const announcePrompt = announcer();
  const promptPart = (selector) => promptDialog.querySelector(selector);
  const promptField = () => promptPart('#prompt-drawer-text');

  const showPromptError = (on) => {
    promptPart('#prompt-drawer-error').hidden = !on;
    const field = promptField();
    const ids = [
      'prompt-drawer-count',
      'prompt-drawer-checks-summary',
      'prompt-drawer-applies',
      ...(on ? ['prompt-drawer-error'] : []),
    ];
    field.setAttribute('aria-describedby', ids.join(' '));
    if (on) field.setAttribute('aria-invalid', 'true');
    else field.removeAttribute('aria-invalid');
  };

  const syncPromptText = () => {
    const field = promptField();
    const max = promptTask?.maxLength ?? MAX_INSTRUCTIONS;
    promptPart('#prompt-drawer-count').textContent =
      `${count(field.value.length)} of ${count(max)} characters`;
    if (promptTask) {
      promptPart('#prompt-drawer-preview').textContent = composePrompt(promptTask, field.value);
    }
  };

  const hidePromptNotes = () => {
    promptPart('#prompt-drawer-saved').hidden = true;
    promptPart('#prompt-drawer-failed').hidden = true;
  };

  const showPromptSaved = (title, message) => {
    promptPart('#prompt-drawer-failed').hidden = true;
    promptPart('#prompt-drawer-saved-title').textContent = title;
    promptPart('#prompt-drawer-saved-message').textContent = message;
    promptPart('#prompt-drawer-saved').hidden = false;
    announcePrompt(promptPart('#prompt-drawer-status'), `${title} ${message}`);
  };

  const showPromptFailed = (title, message) => {
    promptPart('#prompt-drawer-saved').hidden = true;
    promptPart('#prompt-drawer-failed-title').textContent = title;
    promptPart('#prompt-drawer-failed-message').textContent = message;
    promptPart('#prompt-drawer-failed').hidden = false;
    announcePrompt(promptPart('#prompt-drawer-status'), `${title} ${message}`);
  };

  // A fact row shows its lines, or hides when the store has nothing for it.
  const fillFact = (selector, lines, note = '') => {
    const value = promptPart(selector);
    const list = [...lines].filter((line) => text(line).trim());
    value.innerHTML = [
      ...list.map((line) => `<span>${esc(line)}</span>`),
      ...(note ? [`<span class="prompt-facts-note">${esc(note)}</span>`] : []),
    ].join('');
    const row = value.parentElement;
    if (row) row.hidden = !list.length;
  };

  // Why Save can't save the text as it stands, or '' when it can. Shown beside Save in words.
  const saveBlockedBy = () => {
    if (!promptTask) return '';
    const value = promptField().value.trim();
    if (promptResult.status === 'unavailable')
      return 'The checks aren’t loaded, so nothing can be saved.';
    if (!value) return 'Write your instructions, or go back to the system default.';
    if (promptResult.status === 'blocked') return 'Change what the checks found to save.';
    if (promptEditFrom && !promptEditFrom.system && value === promptEditFrom.text.trim()) {
      return `No changes yet: this is ${lowerLabel(promptEditFrom.label)}. Change it to save a new version.`;
    }
    if (value === promptTask.current.trim()) {
      return promptTask.isDefault
        ? 'These are the system default. Change them to save a version of your own.'
        : `No changes yet: this is ${promptTask.inUseShort.charAt(0).toLowerCase()}${promptTask.inUseShort.slice(1)}.`;
    }
    return '';
  };

  // Round 6 (S1): with the store's prompt lifecycle, Save keeps a new version as a draft and
  // tests it at once, so nothing untested runs on every search.
  const savesDrafts = () => has('savePromptDraft') && has('testPrompt');

  const syncSave = () => {
    const save = promptPart('[data-prompt-save]');
    const why = promptPart('#prompt-drawer-save-why');
    const reason = saveBlockedBy();
    why.textContent = reason;
    why.hidden = !reason;
    const next = promptPart('#prompt-drawer-save-next');
    next.textContent = savesDrafts()
      ? 'Save tests it on your last 40 decisions before your deputy uses it.'
      : '';
    next.hidden = Boolean(reason) || !savesDrafts();
    if (reason) {
      save.setAttribute('aria-disabled', 'true');
      save.setAttribute('aria-describedby', 'prompt-drawer-save-why');
    } else {
      save.removeAttribute('aria-disabled');
      save.removeAttribute('aria-describedby');
    }
  };

  // The checks as a list: what blocked first, with its reason (escaped, it quotes your words), then
  // a warning, then each check that passed.
  const CHECK_STATE = { passed: 'Passed', blocked: 'Blocked', warn: 'Warning' };
  const STATUS_ORDER = { blocked: 0, warn: 1, passed: 2 };
  const renderChecks = () => {
    const list = promptPart('#prompt-drawer-checks');
    const missing = promptResult.status === 'unavailable';
    promptPart('#prompt-drawer-unchecked').hidden = !missing;
    promptPart('#prompt-drawer-checks-summary').textContent = summaryOf(promptResult);
    list.hidden = missing;
    list.innerHTML = [...promptResult.checks]
      .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status])
      .map((item) => {
        const passed = item.status === 'passed';
        return `<li class="prompt-check" data-status="${item.status}" data-check="${esc(item.id)}"><span class="prompt-check-icon" aria-hidden="true"></span><span class="prompt-check-copy"><span class="prompt-check-head"><span class="prompt-check-name">${esc(item.label)}</span><span class="prompt-check-state${passed ? ' sr-only' : ''}">${CHECK_STATE[item.status]}</span></span>${passed ? '' : `<span class="prompt-check-detail">${esc(item.detail)}</span>`}</span></li>`;
      })
      .join('');
    syncSave();
  };

  // Runs the checks on the text in the editor. Announced once, politely, when the result changes
  // (never on opening); the visible summary always says it.
  const recheck = ({ speak = true } = {}) => {
    window.clearTimeout(checkTimer);
    if (!promptTask) return;
    promptResult = runChecks(promptField().value, promptTask.id);
    renderChecks();
    const heard = summaryOf(promptResult);
    if (speak && heard !== promptHeard) {
      const after =
        promptResult.status === 'blocked' ? ' Save is off until you change what they found.' : '';
      announcePrompt(promptPart('#prompt-drawer-status'), `Checks: ${heard}${after}`);
    }
    promptHeard = heard;
  };
  const recheckSoon = () => {
    window.clearTimeout(checkTimer);
    checkTimer = window.setTimeout(() => recheck(), CHECK_DELAY);
  };

  const fillSystem = (task) => {
    promptPart('#prompt-drawer-system-label').textContent = task.system.label;
    promptPart('[data-prompt-rule-count]').textContent = String(task.locked.length);
    promptPart('[data-prompt-rules]').innerHTML = task.locked
      .map((rule) => `<li>${esc(rule)}</li>`)
      .join('');
    promptPart('[data-prompt-outline-yours]').textContent = task.isDefault
      ? 'The system default, until you save a version of your own.'
      : `${task.inUse}, in place of the default.`;
    promptPart('[data-prompt-outline-returns]').textContent = task.output;
    promptPart('[data-prompt-outline-data]').textContent = task.data.length
      ? task.data.map((item) => `<${item.tag}>${item.label ? ` ${item.label}` : ''}`).join(' · ')
      : 'The page, posting, or email your deputy reads.';
  };

  // The changes to this prompt (saved, restored, back to the default, and with the round 6 store
  // tested, tried, used, and rolled back), newest first, and Back to the system default under the
  // control (its own line, so it never pushes the drawer sideways) while something else is in use.
  const renderHistory = (task) => {
    promptPart('[data-prompt-reset]').hidden = task.isDefault;
    const history = promptPart('#prompt-drawer-history');
    const entries = task.history.slice(0, 10);
    history.hidden = !entries.length;
    promptPart('[data-prompt-history-count]').textContent = String(entries.length);
    promptPart('#prompt-drawer-history-list').innerHTML = entries
      .map((entry) => {
        const when = formatWhen(entry.at);
        return `<li>${esc(entry.text)}${when ? ` <span class="prompt-history-when">${esc(when)}</span>` : ''}</li>`;
      })
      .join('');
  };

  // The rollback rules this prompt follows, in one line, with the way to change them.
  const rulesLine = (rollout) => {
    if (!isObject(rollout)) return '';
    const share = numberOf(rollout.canarySharePct);
    const days = numberOf(rollout.canaryDays);
    const minimum = numberOf(rollout.minAgreementPct);
    const drop = numberOf(rollout.maxDropPoints);
    const own = Array.isArray(rollout.overridden) && rollout.overridden.length > 0;
    const trial =
      share === 0
        ? 'a version that passes its test is used on every run at once'
        : share == null
          ? ''
          : `a version that passes its test runs on ${count(share)}% of runs${days ? ` for ${plural(days, 'day', 'days')}` : ''} first`;
    const back =
      rollout.autoRollback === false
        ? 'you choose whether to roll back'
        : minimum == null
          ? ''
          : // R9-9: one rule said one way, as the Prompts page says it.
            `it rolls back if Kept by you falls below ${count(minimum)}%${drop ? ` or more than ${plural(drop, 'point', 'points')} below the version in use` : ''}`;
    const said = [trial, back].filter(Boolean).join('; ');
    return said ? `${own ? 'This prompt’s own rules' : 'Your rules'}: ${said}.` : '';
  };
  const renderRules = (task) => {
    const line = promptPart('#prompt-drawer-rules');
    const rollout = ask('rolloutSettings', task.id);
    const said = rulesLine(rollout);
    line.innerHTML = said
      ? `<span>${esc(said)}</span><a class="chart-action prompt-rules-link" href="${RULES_HREF}">Change the rules<span class="sr-only"> in Settings, Prompts</span></a>`
      : '';
    line.hidden = !said;
  };

  // Stats: the same measures as the control, per version, the trend, the version in use against
  // the one before, and the rollback history. Sample data until runs are recorded per version.
  const drawerStats = { heading: 4, open: new Set(), prefix: 'pc-drawer-stats' };
  const renderStats = (task) => {
    const host = promptPart('#prompt-drawer-metrics');
    const data = readControl(task.id);
    if (!data?.metrics?.versions.size) {
      host.innerHTML =
        '<p class="prompt-metrics-empty">How this prompt performs isn’t available on this page yet.</p>';
      return;
    }
    host.innerHTML = `<p class="sample-note">${esc(data.metrics.note)}</p>${statsHtml(drawerStats, data)}`;
    window.JobDeputyComponents?.init?.(host);
  };

  // The control at the top of the drawer, on the prompt the drawer shows.
  let drawerControl = null;
  const renderDrawerControl = (id, { compare = '' } = {}) => {
    const host = promptPart('#prompt-drawer-control');
    if (!drawerControl) {
      drawerControl = makeControl(host, { id, drawer: true });
      drawerControl.prefix = 'pc-drawer';
      controls.add(drawerControl);
      listenTo(drawerControl);
    }
    if (drawerControl.id !== id || compare) {
      drawerControl.id = id;
      drawerControl.compareOpen = false;
      drawerControl.open.clear();
      host.innerHTML = '';
    }
    if (compare) {
      chosenVersions.set(id, compare);
      drawerControl.compareOpen = true;
    }
    renderControl(drawerControl);
  };

  const fillPrompt = (task) => {
    promptPart('#prompt-drawer-title').textContent = task.name;
    const purpose = promptPart('#prompt-drawer-purpose');
    purpose.textContent = task.purpose;
    purpose.hidden = !task.purpose;
    fillFact('[data-prompt-where]', [task.where]);
    fillFact('[data-prompt-when]', [task.when]);
    fillFact('[data-prompt-model]', [task.model], task.note);
    fillFact('[data-prompt-caps]', task.limits);
    fillSystem(task);
    promptPart('[data-prompt-state]').textContent = task.inUse;
    renderDrawerControl(task.id);
    renderRules(task);
    renderHistory(task);
    renderStats(task);
  };

  // After a save, a restore, or going back to the default: the store's record again, the editor
  // holding the instructions in use, and the checks run on them.
  const refreshPrompt = ({ editor = true } = {}) => {
    if (!promptTask) return;
    promptTask = readPrompt(promptTask.id) ?? promptTask;
    fillPrompt(promptTask);
    const field = promptField();
    if (editor) {
      field.value = promptTask.current;
      showEditing(null);
    }
    showPromptError(false);
    syncPromptText();
    recheck({ speak: false });
  };

  // "Editing a copy of version 3": the editor holds that version's words; Save makes a new one.
  // { line: false } keeps the comparison (Save stays off for the same words) without the line,
  // as after a save: the editor then holds the version just saved.
  const showEditing = (entry, { line: shown = true } = {}) => {
    promptEditFrom = entry
      ? { id: entry.id, label: entry.label, text: entry.instructions, system: entry.system }
      : null;
    const line = promptPart('#prompt-drawer-editing');
    line.textContent =
      entry && shown
        ? `Editing a copy of ${entry.system ? 'the system default' : lowerLabel(entry.label)}. Save keeps it as a new version${savesDrafts() ? ' and tests it' : ''}; ${entry.system ? 'the default' : lowerLabel(entry.label)} stays as it is.`
        : '';
    line.hidden = !line.textContent;
  };
  const editInDrawer = (entry) => {
    if (!promptTask || !entry) return;
    const field = promptField();
    field.value = entry.instructions || promptTask.current;
    showEditing(entry);
    hidePromptNotes();
    showPromptError(false);
    syncPromptText();
    recheck({ speak: false });
    if (typeof field.scrollIntoView === 'function') field.scrollIntoView({ block: 'center' });
    field.focus();
    announcePrompt(
      promptPart('#prompt-drawer-status'),
      `${promptEditFrom.system ? 'The system default' : upperFirst(lowerLabel(entry.label))} is in the editor. Change it, then Save.`,
    );
  };

  // Where to find every prompt, in words that never send you to the page you are on (T4-4).
  const missingWords = () => {
    const page = pageFile();
    if (page === 'prompts-preview.html') {
      return 'Every prompt is listed on this page, and Reset sample data in Help brings back the usual ones.';
    }
    if (page === 'trust-preview.html') {
      return 'Open Settings, Prompts to see every prompt, or reset the sample data on this page.';
    }
    return 'Open Settings, Prompts to see every prompt, or reset the sample data in Help.';
  };

  const resetPromptView = (task) => {
    promptSaved = false;
    promptTask = task;
    promptHeard = '';
    window.clearTimeout(checkTimer);
    hidePromptNotes();
    showPromptError(false);
    showEditing(null);
    for (const details of promptDialog.querySelectorAll('.prompt-rules, .prompt-full')) {
      details.open = false;
    }
    promptPart('#prompt-drawer-status').textContent = '';
    // The whole drawer again (an Edit opening shows the editor only, below).
    promptPart('#prompt-drawer-eyebrow').textContent = 'See the prompt';
    promptPart('#prompt-drawer-versions').hidden = false;
    promptPart('#prompt-drawer-missing').hidden = Boolean(task);
    promptPart('#prompt-drawer-content').hidden = !task;
    promptPart('[data-prompt-save]').hidden = !task;
    promptPart('[data-prompt-reset]').hidden = !task || task.isDefault;
    promptPart('#prompt-drawer-save-why').hidden = true;
    promptPart('#prompt-drawer-save-next').hidden = true;
    if (task) {
      fillPrompt(task);
      promptField().maxLength = task.maxLength;
      promptField().value = task.current;
      syncPromptText();
      recheck({ speak: false });
    } else {
      promptPart('#prompt-drawer-title').textContent = 'Prompt';
      promptPart('#prompt-drawer-missing-message').textContent = missingWords();
      promptResult = UNAVAILABLE;
      syncPromptText();
    }
    promptDialog.scrollTop = 0;
  };

  const failureWords = (result) => {
    const checks = checksOf(result?.checks);
    const missing = result?.status === 'unavailable' || checks.some((item) => item.id === 'guard');
    if (missing) {
      return [
        'We couldn’t save your instructions.',
        'The checks aren’t loaded on this page, so nothing was saved.',
      ];
    }
    const blocked = checks.filter((item) => item.status === 'blocked').map((item) => item.label);
    return [
      'We couldn’t save your instructions.',
      blocked.length
        ? `Blocked by ${listWords(blocked)}. Change what the checks found and try again.`
        : 'Change what the checks found and try again.',
    ];
  };

  // Saving the system default's words goes back to the default; with the round 6 store it uses
  // usePromptVersion when it has one, as the control's Use this version does.
  const saveDefault = () => {
    if (has('usePromptVersion')) return store().usePromptVersion(promptTask.id, 'system');
    return store().setPrompt(promptTask.id, null);
  };

  const savePrompt = () => {
    if (!promptTask) return;
    const field = promptField();
    const value = field.value.trim();
    if (!value) {
      showPromptError(true);
      syncSave();
      field.focus();
      return;
    }
    // The checks run again now, so a save never trusts what the list showed a moment ago.
    recheck({ speak: false });
    const reason = saveBlockedBy();
    if (reason) {
      announcePrompt(promptPart('#prompt-drawer-status'), reason);
      return;
    }
    const isDefault = value === promptTask.defaultText.trim();
    const drafting = !isDefault && savesDrafts();
    let outcome;
    try {
      if (isDefault) outcome = saveDefault();
      else if (drafting) outcome = store().savePromptDraft(promptTask.id, value);
      else outcome = store().setPrompt(promptTask.id, value);
    } catch {
      outcome = { ok: false, reason: 'error' };
    }
    if (outcome && outcome.ok === false) {
      if (outcome.reason === 'guardrail-blocked') {
        const checks = checksOf(outcome.checks);
        promptResult =
          outcome.status === 'unavailable' || checks.some((item) => item.id === 'guard')
            ? UNAVAILABLE
            : { status: 'blocked', checks, summary: '' };
        renderChecks();
      }
      const [title, message] =
        outcome.reason === 'guardrail-blocked'
          ? failureWords(outcome)
          : ['We couldn’t save your instructions.', 'Try again in a moment.'];
      showPromptFailed(title, message);
      deputy()?.react?.('error');
      return;
    }
    const versionId = text(outcome?.versionId);
    if (drafting) {
      saveAndTest(versionId);
      return;
    }
    refreshPrompt();
    promptSaved = true;
    if (isDefault) {
      showPromptSaved(
        'Back to the system default.',
        'Your deputy uses it from its next run. Your versions stay here to restore.',
      );
      celebrate('Back to the default.');
      return;
    }
    const saved = promptTask.versions?.find((version) => version.id === versionId);
    showPromptSaved(
      saved
        ? `Saved as ${saved.label.charAt(0).toLowerCase()}${saved.label.slice(1)}.`
        : 'Your instructions are saved.',
      'Your deputy uses them from its next run. Prototype: saved in this browser.',
    );
    celebrate('I’ll use these next run.');
  };

  // A new draft is tested at once: the control above shows the replay as it happens, and the
  // notice says how it went on whichever page is open when it ends.
  const saveAndTest = (versionId) => {
    chosenVersions.set(promptTask.id, versionId);
    const tested = versionId ? ask('testPrompt', promptTask.id, versionId) : null;
    if (tested && tested.ok !== false) testedHere = true;
    promptTask = readPrompt(promptTask.id) ?? promptTask;
    fillPrompt(promptTask);
    const saved = readControl(promptTask.id)?.entries.find((entry) => entry.id === versionId);
    showEditing(saved ?? null, { line: false });
    syncPromptText();
    recheck({ speak: false });
    promptSaved = true;
    const label = firstText(saved?.label, 'A new version');
    if (tested && tested.ok !== false) {
      showPromptSaved(
        `Saved as ${lowerLabel(label)}. Testing it now.`,
        testPlan(readControl(promptTask.id)),
      );
      syncTicker();
      syncDeputy();
      const block =
        typeof promptDialog.querySelector === 'function' ? promptPart('.prompt-test') : null;
      if (block && typeof block.scrollIntoView === 'function')
        block.scrollIntoView({ block: 'nearest' });
      return;
    }
    showPromptSaved(
      `Saved as ${lowerLabel(label)}, a draft.`,
      `${failureOf(tested?.reason)} Test it from Versions and tests when you’re ready.`,
    );
    celebrate('Saved as a draft.');
  };

  const backToDefault = () => {
    if (!promptTask) return;
    let outcome;
    try {
      outcome = has('usePromptVersion')
        ? store().usePromptVersion(promptTask.id, 'system')
        : has('resetPrompt')
          ? store().resetPrompt(promptTask.id)
          : store().setPrompt(promptTask.id, null);
    } catch {
      outcome = { ok: false };
    }
    if (outcome && outcome.ok === false) {
      showPromptFailed('We couldn’t go back to the system default.', 'Try again in a moment.');
      deputy()?.react?.('error');
      return;
    }
    chosenVersions.delete(promptTask.id);
    refreshPrompt();
    promptSaved = true;
    showPromptSaved(
      'Back to the system default.',
      'Your deputy uses it from its next run. Your versions stay here to restore.',
    );
    promptField().focus();
    celebrate('Back to the default.');
  };

  // The store changes that redraw the drawer's own parts (the control follows every change).
  const DRAWER_CHANGES = new Set([
    'prompt',
    'prompt-version',
    'rollback',
    'rollout',
    'reset',
    'external',
    'scale-demo',
  ]);
  const renderPrompt = () => {
    if (promptDialog) return promptDialog;
    promptDialog = createDrawer(
      'prompt-drawer',
      'prompt-drawer',
      PROMPT_MARKUP,
      'prompt-drawer-title',
      'prompt-drawer-purpose',
    );
    promptPart('#prompt-drawer-form').addEventListener('submit', (event) => {
      event.preventDefault();
      savePrompt();
    });
    promptPart('[data-prompt-reset]').addEventListener('click', backToDefault);
    promptField().addEventListener('input', (event) => {
      syncPromptText();
      hidePromptNotes();
      if (event.target.value.trim()) showPromptError(false);
      syncSave();
      recheckSoon();
    });
    promptDialog.addEventListener('close', () => {
      window.clearTimeout(checkTimer);
      if (!promptSaved) release();
      // Opened from a prompt control that redrew meanwhile (a draft saved, a test ended): focus
      // goes back to the same action there, or its dropdown.
      const back = promptReturn;
      promptReturn = null;
      // Focus still on the closed drawer is lost too (T2-7: choosing another version in here
      // redraws the opener away, and the drawer's Close keeps focus as it closes), and a host
      // the page drew again is found by its prompt (R9-3).
      const active = document.activeElement;
      const lost =
        !active ||
        active === document.body ||
        active.isConnected === false ||
        (typeof promptDialog.contains === 'function' && promptDialog.contains(active));
      const host = back?.host?.isConnected ? back.host : hostAgain(back?.id);
      if (host && lost) {
        (
          (back.key && host.querySelector(`[data-pc-key="${back.key}"]`)) ||
          host.querySelector('.prompt-control-select')
        )?.focus();
      }
    });
    // Another tab (or the page) changed this prompt: the history, rules, and stats follow, and the
    // editor keeps what you are typing.
    if (has('subscribe')) {
      // Listeners hear (state, change); a change without a type redraws everything.
      store().subscribe((_state, change) => {
        if (!promptDialog?.open || !promptTask) return;
        if (change?.id && change.id !== promptTask.id && String(change.type).startsWith('prompt'))
          return;
        const finished =
          change?.type === 'prompt-test' && ['passed', 'failed'].includes(change.status);
        if (change?.type && !DRAWER_CHANGES.has(change.type) && !finished) return;
        promptTask = readPrompt(promptTask.id) ?? promptTask;
        promptPart('[data-prompt-state]').textContent = promptTask.inUse;
        fillSystem(promptTask);
        renderRules(promptTask);
        renderHistory(promptTask);
        renderStats(promptTask);
        syncSave();
      });
    }
    return promptDialog;
  };

  // openPrompt(id, { opener, edit, compare }): edit puts that version's words in the editor (Edit
  // as a new version); compare opens the control's comparison with that version chosen.
  // The opener's place, kept by stable keys (R9-3): its prompt control, the control's prompt,
  // and the action's data-pc-key.
  let promptReturn = null;
  const hostAgain = (id) => {
    if (!id || typeof document.querySelectorAll !== 'function') return null;
    return (
      [...document.querySelectorAll('[data-prompt-control]')].find(
        (host) =>
          host.getAttribute('data-prompt-control') === id &&
          !(typeof promptDialog?.contains === 'function' && promptDialog.contains(host)),
      ) ?? null
    );
  };
  // Round 7 (R10-3, R10-5): the Prompt drawer is the Prompts page's editor. Anywhere else, opening
  // a prompt goes to its home, prompts-preview.html?prompt=<id>&return=<this page with its state>
  // (edit= and compare= carried), with your place saved for the way back. On the Prompts page a
  // cancelable jobdeputy:prompt-open event comes first, so the page can open the prompt's row in
  // place; when nothing takes it, the drawer opens as before.
  const promptHome = (id, { edit = '', compare = '' } = {}) => {
    const query = new URLSearchParams({ prompt: text(id) });
    if (edit) query.set('edit', text(edit));
    if (compare) query.set('compare', '1');
    const target = `./prompts-preview.html?${query.toString()}`;
    const place = window.JobDeputyComponents?.place;
    if (typeof place?.href !== 'function') return target;
    place.save?.();
    return place.href(target);
  };
  const goToPrompt = (id, options) => {
    const href = promptHome(id, options);
    if (typeof window.location?.assign === 'function') window.location.assign(href);
    else if (window.location) window.location.href = href;
    return null;
  };
  const promptOpenTaken = (detail) => {
    if (typeof CustomEvent !== 'function' || typeof document.dispatchEvent !== 'function') {
      return false;
    }
    const event = new CustomEvent('jobdeputy:prompt-open', { cancelable: true, detail });
    return document.dispatchEvent(event) === false;
  };
  const openPrompt = (id, { opener = null, edit = '', compare = '' } = {}) => {
    if (!onPromptsPage()) return goToPrompt(id, { edit, compare });
    if (promptOpenTaken({ id: text(id), edit: text(edit), compare: Boolean(compare), opener })) {
      return null;
    }
    renderPrompt();
    if (promptDialog.open) return promptDialog;
    const task = readPrompt(String(id ?? ''));
    resetPromptView(task);
    const from = opener instanceof HTMLElement ? opener : document.activeElement;
    const host = isElement(from) ? from.closest?.('.prompt-control') : null;
    promptReturn = host
      ? {
          host,
          id: host.getAttribute?.('data-prompt-control') ?? '',
          key: from.getAttribute('data-pc-key'),
        }
      : null;
    openDrawer(promptDialog, from);
    listen();
    if (task && compare) renderDrawerControl(task.id, { compare: String(compare) });
    const entry =
      task && edit ? readControl(task.id)?.entries.find((item) => item.id === String(edit)) : null;
    if (entry) {
      // Edit as a new version (T1-17): the drawer is the editor only, titled for it; the page's
      // own row has the versions and their tests, so the drawer does not repeat them.
      promptPart('#prompt-drawer-eyebrow').textContent = 'Edit as a new version';
      promptPart('#prompt-drawer-title').textContent = `New version of ${task.name}`;
      promptPart('#prompt-drawer-versions').hidden = true;
      editInDrawer(entry);
      return promptDialog;
    }
    // Focus starts on Close, so a phone does not raise its keyboard before the person reads.
    promptPart('[data-drawer-close]').focus();
    return promptDialog;
  };

  // ---------------------------------------------------------------- the prompt control (round 6)

  // The shared prompt control (S1): any [data-prompt-control="<task id>"] on a page, and the
  // Prompt drawer's own, show one prompt the same way everywhere: a Version dropdown (the system
  // default and every version, each with its status), the chosen version's status and actions,
  // the two measures (Kept by you, from real use, and Test score, the evaluation), a test
  // as it happens, its result in words, Compare with the one in use, and (data-prompt-stats="on")
  // the stats. Everything it shows comes from the store: prompt(id).lineup and versions,
  // promptMetrics(id), promptTest(id), rolloutSettings(id), and rollbacks(); it acts through
  // usePromptVersion (or restorePrompt and resetPrompt), testPrompt, and rollback. A store with no
  // lifecycle yet (round 5) shows the version in use and your saved versions with what that store
  // can do. Pages write no code: hosts are found when the page starts and when they are added
  // later, and every host follows every store change. A host's options: data-prompt-view="full"
  // (default) or "compact" (Searches, the Dashboard); data-prompt-stats="on" or "folded" (the
  // stats, or the stats in a closed disclosure); data-prompt-see="off" (no See the prompt);
  // data-prompt-metric="off" (no data-metric on the agreement figure, for a page that shows it
  // elsewhere); data-prompt-note="off" (no sample note, for a page that has one over the list);
  // data-prompt-heading="2" to "6" (the stats' headings' level; paragraphs without it). After
  // each action the host fires a bubbling prompt-control event ({ id, versionId, action, ok }).
  const CONTROL_SAMPLE = 'Sample data · real figures start when runs are recorded per version';
  // R9-8: a version whose test didn't pass never ran, so it is "Did not pass", never a rollback;
  // only a version on trial or in use that is taken back is rolled back.
  const LIFECYCLES = ['draft', 'testing', 'canary', 'live', 'failed', 'rolled_back', 'retired'];
  const LIFECYCLE_WORDS = Object.freeze({
    draft: 'Draft',
    testing: 'Testing',
    canary: 'Trying on a share of runs',
    live: 'In use',
    failed: 'Did not pass',
    rolled_back: 'Rolled back',
    retired: 'Retired',
  });
  // The two measures, named and explained the same way wherever a prompt shows.
  const MEASURES = Object.freeze({
    agreement: {
      name: 'Kept by you',
      meaning: 'Of what this prompt produced in real use, the share you kept.',
    },
    test: {
      name: 'Test score',
      meaning: (of) =>
        `A version replayed on your last ${count(of)} decisions: how often it agreed with what you decided, and the guardrail checks.`,
    },
  });
  const DECISIONS = 40;
  const CONTROL_ACTIONS = ['use', 'test', 'compare', 'edit', 'rollback'];
  const ACTION_WORDS = Object.freeze({
    use: 'Use this version',
    test: 'Test it',
    compare: 'Compare with the one in use',
    edit: 'Edit as a new version',
    rollback: 'Roll back',
  });
  const TEST_LEAVE = 'You can leave. I’ll tell you when it’s done.';
  const SHORT_WORDS = Object.freeze({
    compare: 'Compare',
    edit: 'Edit as new',
    rollback: 'Roll back',
  });
  const PRIMARY = Object.freeze({
    draft: 'test',
    canary: 'use',
    rolled_back: 'edit',
    // R9-8: a version that did not pass leads with a new version of it, as a rolled back one did.
    failed: 'edit',
    retired: 'use',
    live: 'edit',
  });
  const RULES_HREF = './prompts-preview.html#rollout';

  const isObject = (value) => value != null && typeof value === 'object' && !Array.isArray(value);
  const numberOf = (value) => (value == null || value === '' ? null : finite(Number(value)));
  // Agreement as a whole percent, from a share (0.79) or a percent (79).
  const agreementOf = (value) => {
    const n = numberOf(value);
    if (n == null) return null;
    return Math.round(n <= 1 ? n * 100 : n);
  };
  const scoreOf = (value) => {
    const n = numberOf(value);
    return n == null ? null : Math.round(n);
  };
  const ask = (name, ...args) => {
    if (!has(name)) return null;
    try {
      return store()[name](...args) ?? null;
    } catch {
      return null;
    }
  };
  const metricWords = (key) => {
    if (!has('metricText')) return '';
    try {
      return text(store().metricText(key)).trim();
    } catch {
      return '';
    }
  };
  const upperFirst = (value) => `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
  const lowerLabel = (label) =>
    /^(?:Version|Yours)\b/.test(label)
      ? `${label.charAt(0).toLowerCase()}${label.slice(1)}`
      : label;

  // A test's guardrail checks tick from pending to pass or fail; the guard's own words (passed,
  // blocked, warn) read the same way.
  const TICKS = { pass: 'pass', passed: 'pass', warn: 'pass', fail: 'fail', blocked: 'fail' };
  const testOf = (raw) => {
    if (!isObject(raw)) return null;
    const status = ['running', 'passed', 'failed'].includes(raw.status) ? raw.status : null;
    if (!status) return null;
    const reason = isObject(raw.reason) ? raw.reason : null;
    return {
      versionId: text(raw.versionId),
      versionLabel: text(raw.versionLabel),
      status,
      replayed: Math.max(0, numberOf(raw.replayed) ?? 0),
      of: Math.max(1, numberOf(raw.of) ?? DECISIONS),
      agreed: numberOf(raw.agreed),
      checks: (Array.isArray(raw.checks) ? raw.checks : []).filter(isObject).map((item) => ({
        id: text(item.id),
        label: firstText(item.label, item.id),
        status: TICKS[item.status] ?? 'pending',
      })),
      score: scoreOf(raw.score),
      inUseScore: scoreOf(raw.inUseScore),
      // T7-11: the version in use when it was tested (the store keeps it on the test).
      inUseId: text(raw.inUseId),
      inUseLabel: text(raw.inUseLabel),
      startedAt: raw.startedAt ?? null,
      finishedAt: raw.finishedAt ?? null,
      elapsed: numberOf(raw.elapsedSeconds),
      reason: firstText(reason?.text, typeof raw.reason === 'string' ? raw.reason : ''),
      canary: isObject(raw.canary) ? raw.canary : null,
      live: raw.live === true,
    };
  };

  const entryOf = (item, version, raw) => {
    const id = text(item.id);
    const system = id === 'system';
    const stage = LIFECYCLES.includes(item.lifecycle)
      ? item.lifecycle
      : item.inUse
        ? 'live'
        : 'retired';
    return {
      id,
      system,
      label: firstText(item.label, version?.label, system ? SYSTEM_DEFAULT : 'Version'),
      lifecycle: stage,
      lifecycleLabel: firstText(
        item.lifecycleLabel,
        version?.lifecycleLabel,
        LIFECYCLE_WORDS[stage],
      ),
      inUse: Boolean(item.inUse),
      actions: CONTROL_ACTIONS.filter(
        (action) => Array.isArray(item.actions) && item.actions.includes(action),
      ),
      rollbackTo:
        isObject(item.rollbackTo) && text(item.rollbackTo.id)
          ? {
              id: text(item.rollbackTo.id),
              label: firstText(item.rollbackTo.label, item.rollbackTo.id),
            }
          : null,
      instructions: system
        ? text(raw.defaultInstructions)
        : firstText(version?.instructions, id === 'yours' ? raw.instructions : ''),
      test: testOf(item.test) ?? testOf(version?.test),
      canary: isObject(item.canary)
        ? item.canary
        : isObject(version?.canary)
          ? version.canary
          : null,
      savedAt: version?.savedAt ?? null,
    };
  };

  // promptMetrics(id) per version, the trend of the version in use, and the version before it.
  const metricsOf = (id) => {
    const raw = ask('promptMetrics', id);
    if (!isObject(raw)) return null;
    const versions = new Map();
    for (const item of Array.isArray(raw.versions) ? raw.versions.filter(isObject) : []) {
      versions.set(text(item.versionId ?? item.id), {
        label: text(item.label),
        runs: numberOf(item.runs),
        agreement: agreementOf(item.agreement ?? item.keepRate),
        testScore: scoreOf(item.testScore),
        tokens: numberOf(item.avgTokens),
        seconds: numberOf(item.avgSeconds),
        blocks: numberOf(item.guardrailBlocks ?? item.rejected),
        injections: numberOf(item.injectionsIgnored),
        active: Boolean(item.active),
      });
    }
    // T7-R2: a day the version did not run (runs 0, or no figure) keeps its place with no value.
    const trend = (Array.isArray(raw.trend) ? raw.trend : []).filter(isObject).map((point) => {
      const runs = numberOf(point.runs);
      return {
        label: firstText(point.label, formatDay(point.date, { weekday: false })),
        runs,
        agreement: runs === 0 ? null : agreementOf(point.agreement ?? point.keepRate),
      };
    });
    const previous = isObject(raw.previous)
      ? text(raw.previous.versionId ?? raw.previous.id)
      : text(raw.previous);
    // The window the versions' runs cover, in the store's words ("in the last 90 days"), when it
    // says (T7-6).
    const window = firstText(
      raw.runsWindow?.label,
      raw.window?.label,
      raw.windowLabel,
      typeof raw.window === 'string' ? raw.window : '',
    );
    return { note: firstText(raw.note, CONTROL_SAMPLE), versions, trend, previous, window };
  };

  // One prompt as the control shows it, or null for an unknown task or a store without prompts.
  const readControl = (id) => {
    if (!taskIds().includes(id) || !has('prompt')) return null;
    const raw = ask('prompt', id);
    if (!isObject(raw)) return null;
    const versions = Array.isArray(raw.versions) ? raw.versions.filter(isObject) : [];
    const byId = new Map(versions.map((version) => [text(version.id), version]));
    const isDefault = typeof raw.isDefault === 'boolean' ? raw.isDefault : !raw.customized;
    const lineup = Array.isArray(raw.lineup)
      ? raw.lineup.filter((item) => isObject(item) && text(item.id))
      : [];
    let items = lineup;
    if (!lineup.length) {
      // A store with no lifecycle (round 5): your saved versions, then the system default, each
      // in use or not, with what that store can do (restore one, or go back to the default).
      items = versions.map((version) => ({
        id: version.id,
        label: version.label,
        lifecycle: version.active ? 'live' : 'retired',
        inUse: Boolean(version.active),
        actions: version.active ? ['edit'] : ['use', 'compare', 'edit'],
      }));
      if (!isDefault && !versions.some((version) => version.active)) {
        items.unshift({ id: 'yours', label: 'Yours', inUse: true, actions: ['edit'] });
      }
      items.push({
        id: 'system',
        label: SYSTEM_DEFAULT,
        lifecycle: isDefault ? 'live' : 'retired',
        inUse: isDefault,
        actions: isDefault ? ['edit'] : ['use', 'compare'],
      });
    }
    const entries = items.map((item) => entryOf(item, byId.get(text(item.id)), raw));
    const inUse =
      entries.find((entry) => entry.inUse) ??
      entries.find((entry) => entry.lifecycle === 'live') ??
      entries.at(-1);
    const rollout = isObject(raw.rollout) ? raw.rollout : ask('rolloutSettings', id);
    const rollbacks = ask('rollbacks', { promptId: id });
    return {
      id,
      name: firstText(raw.name, id),
      lifecycle: lineup.length > 0,
      entries,
      inUse,
      keptMeans: text(raw.keptMeans),
      test: testOf(raw.test) ?? testOf(ask('promptTest', id)),
      metrics: metricsOf(id),
      rollout: isObject(rollout) ? rollout : null,
      rollbacks: (Array.isArray(rollbacks) ? rollbacks : []).filter(
        (item) => isObject(item) && (!item.promptId || item.promptId === id),
      ),
    };
  };

  // The chosen version is remembered per prompt for the page's life, so every host of one prompt
  // (a page card and the drawer) shows the same one. It opens on the version being tested, else
  // the one on trial, else the one in use.
  const chosenVersions = new Map();
  const chosenOf = (data) => {
    const remembered = data.entries.find((entry) => entry.id === chosenVersions.get(data.id));
    if (remembered) return remembered;
    const testing = data.test?.status === 'running' ? data.test.versionId : '';
    return (
      data.entries.find((entry) => entry.id === testing) ??
      data.entries.find((entry) => entry.lifecycle === 'testing') ??
      data.entries.find((entry) => entry.lifecycle === 'canary') ??
      data.inUse
    );
  };

  const percentText = (value) => (value == null ? '' : `${count(value)}%`);
  const untilText = (canary) => {
    const until = canary?.until ?? canary?.endsAt ?? canary?.ends;
    return until ? formatDay(until) : '';
  };
  const shareOf = (canary, rollout) =>
    numberOf(canary?.sharePct ?? canary?.share) ?? numberOf(rollout?.canarySharePct);

  // "In use: System default · Version 2 on 20% of runs until Sun, Oct 4 · testing version 3"
  // Nothing when it would only repeat the chosen version's In use pill.
  const nowLine = (data, chosen = null) => {
    const parts = [`In use: ${data.inUse?.label ?? SYSTEM_DEFAULT}`];
    const trial = data.entries.find((entry) => entry.lifecycle === 'canary');
    if (trial) {
      const share = shareOf(trial.canary, data.rollout);
      const until = untilText(trial.canary);
      parts.push(
        `${trial.label} on ${share == null ? 'a share' : `${count(share)}%`} of runs${until ? ` until ${until}` : ''}`,
      );
    }
    const running = data.test?.status === 'running' ? data.test : null;
    if (running) {
      const tested = data.entries.find((entry) => entry.id === running.versionId);
      parts.push(
        `testing ${lowerLabel(firstText(tested?.label, running.versionLabel, 'a version'))}`,
      );
    }
    if (chosen?.inUse && parts.length === 1) return '';
    return parts.join(' · ');
  };

  // P-7: a row or compact control says one state (its chip); only the full view adds the line.
  const nowFor = (instance, data, chosen) =>
    instance.view === 'full' ? nowLine(data, chosen) : '';

  const heading = (instance, words, className) => {
    const level = instance.heading;
    return level >= 2 && level <= 6
      ? `<h${level} class="${className}">${esc(words)}</h${level}>`
      : `<p class="${className}">${esc(words)}</p>`;
  };

  const pickHtml = (instance, data, chosen) => {
    const p = instance.prefix;
    const label =
      instance.view === 'full'
        ? `<label class="field-label prompt-control-label" for="${p}-version">Version<span class="sr-only"> of ${esc(data.name)}</span></label>`
        : `<label class="sr-only" for="${p}-version">Version of ${esc(data.name)}</label>`;
    return `${label}<div class="prompt-control-choice"><select class="field-control prompt-control-select" id="${p}-version" data-pc-key="version" aria-describedby="${p}-now">${optionsHtml(data, chosen)}</select><span class="status-pill prompt-lifecycle" data-lifecycle="${chosen.lifecycle}">${esc(chosen.lifecycleLabel)}</span></div><p class="prompt-control-now" id="${p}-now">${esc(nowFor(instance, data, chosen))}</p>`;
  };
  // P-7: the dropdown names the version and one chip beside it says its state; the open list
  // groups the versions under their states (in use first), newest first within each.
  const GROUP_ORDER = ['live', 'testing', 'canary', 'draft', 'failed', 'rolled_back', 'retired'];
  const optionsHtml = (data, chosen) => {
    const groups = new Map();
    for (const entry of data.entries) {
      const key = entry.inUse ? 'In use' : entry.lifecycleLabel;
      if (!groups.has(key))
        groups.set(key, {
          rank: entry.inUse ? -1 : GROUP_ORDER.indexOf(entry.lifecycle),
          entries: [],
        });
      groups.get(key).entries.push(entry);
    }
    return [...groups.entries()]
      .sort((a, b) => a[1].rank - b[1].rank)
      .map(
        ([label, group]) =>
          `<optgroup label="${esc(label)}">${group.entries
            .map(
              (entry) =>
                `<option value="${esc(entry.id)}"${entry.id === chosen.id ? ' selected' : ''}>${esc(entry.label)}</option>`,
            )
            .join('')}</optgroup>`,
      )
      .join('');
  };

  // The two measures of the chosen version, with the one in use beside them when it differs.
  const measuresHtml = (instance, data, chosen) => {
    const metrics = data.metrics?.versions ?? new Map();
    const mine = metrics.get(chosen.id) ?? null;
    const used = metrics.get(data.inUse?.id) ?? null;
    const other = !chosen.inUse && data.inUse;
    const metricKey = `prompts.${data.id}.agreement`;
    // T7-6: no Kept by you without runs; each figure says its count (and the store's window).
    const ran = (m) => m?.agreement != null && m.runs > 0;
    const windowWords = text(data.metrics?.window ?? metricsOf(data.id)?.window);
    const noRuns = `<span class="prompt-measure-empty">No runs${windowWords ? ` ${esc(windowWords)}` : ''}</span>`;
    const keyed = instance.metric && chosen.inUse && ran(mine) ? metricWords(metricKey) : '';
    const agreement = keyed
      ? `<span class="prompt-measure-value" data-metric="${esc(metricKey)}">${esc(keyed)}</span>`
      : ran(mine)
        ? `<span class="prompt-measure-value">${percentText(mine.agreement)}</span>`
        : noRuns;
    // Each figure names its window, said one way everywhere (R9-5): "84% of 19 runs", and the
    // version's name only while the one in use is beside it.
    const ofRuns = (m) =>
      m?.runs > 0
        ? ` of ${plural(m.runs, 'run', 'runs')}${windowWords ? ` ${windowWords}` : ''}`
        : '';
    const agreementVs = other
      ? `<span class="prompt-measure-vs">In use: ${ran(used) ? `${percentText(used.agreement)}${ofRuns(used)}` : 'no runs'}</span>`
      : '';
    const runs =
      mine?.runs != null && mine.runs > 0
        ? `<span class="prompt-measure-extra">${esc(ofRuns(mine).trim())}${other ? ` (${esc(lowerLabel(chosen.label))})` : ''}</span>`
        : '';
    const test = chosen.test && chosen.test.status !== 'running' ? chosen.test : null;
    const score = test?.score ?? mine?.testScore ?? null;
    const scoreFigure =
      score != null
        ? `<span class="prompt-measure-value">${percentText(score)}</span>`
        : `<span class="prompt-measure-empty">${chosen.system ? 'Not tested on your decisions yet' : 'Not tested yet'}</span>`;
    const passedChecks = test?.checks.filter((item) => item.status === 'pass').length ?? 0;
    const scoreExtra = test
      ? `<span class="prompt-measure-extra">${test.checks.length ? `${count(passedChecks)} of ${plural(test.checks.length, 'check', 'checks')} passed` : ''}${test.checks.length && test.finishedAt ? ' · ' : ''}${test.finishedAt ? `tested ${esc(formatDay(test.finishedAt))}` : ''}</span>`
      : '';
    const scoreVs =
      other && used?.testScore != null
        ? `<span class="prompt-measure-vs">In use: ${percentText(used.testScore)}</span>`
        : '';
    const of = data.test?.of ?? test?.of ?? DECISIONS;
    const keptWords = data.keptMeans.trim().replace(/[.]$/, '');
    const agreementMeaning = [
      MEASURES.agreement.meaning,
      keptWords ? `Kept: ${lowerFirstWord(keptWords)}.` : '',
    ]
      .filter(Boolean)
      .join(' ');
    const testMeaning = MEASURES.test.meaning(of);
    const compact = instance.view === 'compact';
    const row = instance.view === 'row';
    const meaning = (words) =>
      compact || !instance.meanings ? '' : `<dd class="prompt-measure-meaning">${esc(words)}</dd>`;
    const emptyScore = row
      ? '<span class="prompt-measure-empty">Not tested yet</span>'
      : scoreFigure;
    const kept = `<div class="prompt-measure" data-measure="agreement"><dt>${MEASURES.agreement.name}</dt><dd class="prompt-measure-figure">${agreement}${runs}${agreementVs}</dd>${meaning(agreementMeaning)}</div>`;
    // P-8: a row or a compact control shows Kept by you; its Test score is the trend. UAT-RM
    // RM-14: it says whose runs each figure counts, as the drawer does: "84% of 19 runs (version
    // 2) · in use 79% of 57 runs".
    if (row || compact) {
      const own = ran(mine)
        ? `<span class="prompt-measure-extra">${esc(ofRuns(mine).trim())}${other ? ` (${esc(lowerLabel(chosen.label))})` : ''}</span>`
        : '';
      const inUseToo = other
        ? `<span class="prompt-measure-vs">· in use ${ran(used) ? `${percentText(used.agreement)}${esc(ofRuns(used))}` : 'no runs'}</span>`
        : '';
      return `<dl class="prompt-measures"><div class="prompt-measure" data-measure="agreement"><dt>${MEASURES.agreement.name}</dt><dd class="prompt-measure-figure">${agreement}${own}${inUseToo}</dd></div></dl>`;
    }
    return `<dl class="prompt-measures">${kept}<div class="prompt-measure" data-measure="test"><dt>${MEASURES.test.name}</dt><dd class="prompt-measure-figure">${score == null ? emptyScore : scoreFigure}${scoreVs}${scoreExtra}</dd>${meaning(testMeaning)}</div></dl>`;
  };

  const elapsedOf = (test) => {
    if (test.elapsed != null) return test.elapsed;
    const started = Date.parse(test.startedAt);
    if (!Number.isFinite(started)) return null;
    const now = numberOf(ask('now')) ?? Date.now();
    return Math.max(0, Math.round((now - started) / 1000));
  };
  const elapsedText = (seconds) => {
    const shared = store()?.format?.elapsed;
    if (typeof shared === 'function') {
      try {
        const shown = text(shared(seconds));
        if (shown) return shown;
      } catch {
        // The words below stand in.
      }
    }
    const minutes = Math.floor(seconds / 60);
    return minutes ? `${minutes} min ${seconds % 60} s` : `${seconds} s`;
  };

  // A test as it happens: the decisions replayed (a count and a bar drawn from it, never from
  // time), the time counting up, each guardrail check ticking, and the deputy's line.
  // UAT-RM RM-6: a compact or row control says its test in one visible line: while it runs,
  // "Replaying 17 of 40 · you can leave" (counting up once a second), and after it,
  // "Didn’t pass: 75%, 5 points below your 80% minimum" or "Passed: 90% (36 of your last 40
  // decisions)". A row whose page shows the test itself (data-prompt-details, the Prompts page:
  // its state line and the Details it opens) leaves the line out. The result line is for a test
  // this page watched, or one that didn't pass.
  const watchedTests = new Set();
  const briefCount = (test) => {
    const done = Math.min(test.replayed, test.of);
    return done >= test.of
      ? `Replayed all ${count(test.of)} · checking the guardrails`
      : `Replaying <strong>${count(Math.max(1, done))}</strong> of ${count(test.of)}`;
  };
  const briefHtml = (instance, data, chosen) => {
    if (instance.view === 'full' || instance.details) return '';
    const running = data.test?.status === 'running' ? data.test : null;
    if (running) {
      // The control follows the test it watches, so its result shows here when it ends.
      watchedTests.add(`${data.id}|${running.versionId}`);
      if (!chosenVersions.has(data.id)) chosenVersions.set(data.id, running.versionId);
      return `<p class="prompt-control-brief" data-test-status="running"><span class="prompt-test-dot" aria-hidden="true"></span><span><span data-pc-brief>${briefCount(running)}</span> · you can leave</span></p>`;
    }
    const test = chosen.test && chosen.test.status !== 'running' ? chosen.test : null;
    if (!test || (test.status !== 'failed' && !watchedTests.has(`${data.id}|${chosen.id}`))) {
      return '';
    }
    if (test.status === 'failed') {
      const minimum = numberOf(data.rollout?.minAgreementPct);
      const why =
        test.reason ||
        (test.score != null && minimum != null && test.score < minimum
          ? `${percentText(test.score)}, ${plural(minimum - test.score, 'point', 'points')} below your ${percentText(minimum)} minimum`
          : percentText(test.score));
      return `<p class="prompt-control-brief" data-result="failed">Didn’t pass: ${esc(why)}</p>`;
    }
    const agreed =
      test.agreed != null
        ? ` (${count(test.agreed)} of your last ${count(test.of)} decisions)`
        : '';
    return `<p class="prompt-control-brief" data-result="passed">Passed: ${percentText(test.score)}${agreed}</p>`;
  };
  // A running test's count in words, and how far along it is (0 to 1).
  const testCount = (test) => {
    const done = Math.min(test.replayed, test.of);
    return {
      words:
        done >= test.of
          ? `Replayed all ${count(test.of)} decisions. Checking the guardrails.`
          : `Replaying decision <strong>${count(Math.max(1, done))}</strong> of ${count(test.of)}`,
      share: (done / test.of).toFixed(3),
    };
  };
  const testHtml = (instance, data) => {
    const test = data.test?.status === 'running' ? data.test : null;
    if (!test) return '';
    const tested = data.entries.find((entry) => entry.id === test.versionId);
    const label = firstText(tested?.label, test.versionLabel, 'A new version');
    const { words: counted, share } = testCount(test);
    const seconds = elapsedOf(test);
    const passed = test.checks.filter((item) => item.status === 'pass').length;
    const checks =
      instance.view === 'compact'
        ? `<p class="prompt-test-line">Guardrail checks: ${count(passed)} of ${count(test.checks.length)} passed</p>`
        : test.checks.length
          ? `<ul class="prompt-test-checks" aria-label="Guardrail checks">${test.checks
              .map(
                (item) =>
                  `<li class="prompt-test-check" data-status="${item.status}"><span class="prompt-test-check-icon" aria-hidden="true"></span><span>${esc(item.label)}</span><span class="sr-only">: ${item.status === 'pass' ? 'passed' : item.status === 'fail' ? 'failed' : 'waiting'}</span></li>`,
              )
              .join('')}</ul>`
          : '';
    return `<div class="prompt-test" data-test-status="running" tabindex="-1" data-pc-key="test"><p class="prompt-test-title"><span class="prompt-test-dot" aria-hidden="true"></span>Testing ${esc(lowerLabel(label))}</p><p class="prompt-test-line" data-pc-count>${counted}</p><span class="prompt-test-bar" aria-hidden="true"><span class="prompt-test-fill" style="--value: ${share}"></span></span>${seconds == null ? '' : `<p class="prompt-test-time" data-pc-elapsed>Running for ${esc(elapsedText(seconds))}</p>`}${checks}<p class="prompt-test-leave"><span class="sr-only">Your deputy says: </span>${TEST_LEAVE}</p></div>`;
  };

  // The chosen version's last result in words: what passed or what failed, by which measure and
  // by how much, and what happens next or what stays in use.
  const resultHtml = (instance, data, chosen) => {
    const test = chosen.test && chosen.test.status !== 'running' ? chosen.test : null;
    const rolled = data.rollbacks.find((item) => text(item.fromVersionId) === chosen.id);
    if (!test && !rolled) return '';
    const minimum = numberOf(data.rollout?.minAgreementPct);
    const inUse = data.inUse?.label ?? SYSTEM_DEFAULT;
    const lines = [];
    let kind = 'passed';
    if (test?.status === 'passed') {
      const when = test.finishedAt ? ` ${formatDay(test.finishedAt)}` : '';
      const every =
        test.checks.length && test.checks.every((item) => item.status === 'pass')
          ? ', every check passed'
          : '';
      const agreed =
        test.agreed != null
          ? ` (${count(test.agreed)} of your last ${count(test.of)} decisions)`
          : '';
      lines.push(`Passed${when}: ${percentText(test.score)}${agreed}${every}.`);
      if (chosen.lifecycle === 'canary') {
        const share = shareOf(chosen.canary, data.rollout);
        const until = untilText(chosen.canary);
        const after =
          data.rollout?.autoPromote === false
            ? 'then you choose whether to use it on every run'
            : 'then it’s used on every run if Kept by you holds';
        lines.push(
          `Trying on ${share == null ? 'a share' : `${count(share)}%`} of runs${until ? ` until ${until}` : ''}, ${after}.`,
        );
      } else if (chosen.inUse) {
        lines.push('In use on every run.');
      }
    } else if (test?.status === 'failed') {
      kind = 'failed';
      const when = test.finishedAt ? ` ${formatDay(test.finishedAt)}` : '';
      const why =
        test.reason ||
        (test.score != null && minimum != null && test.score < minimum
          ? `${percentText(test.score)}, ${plural(minimum - test.score, 'point', 'points')} below your ${percentText(minimum)} minimum`
          : percentText(test.score));
      lines.push(`Didn’t pass${when}: ${why}.`);
      // What stayed in use is the version in use when it was tested, as the store keeps it on
      // the test (T7-11), never today's: said in the present while it still is, in the past once
      // another took its place, and not at all for a test that does not say.
      const then = firstText(test.inUseLabel, test.inUseId === 'system' ? SYSTEM_DEFAULT : '');
      const still = then && (test.inUseId ? test.inUseId === data.inUse?.id : then === inUse);
      if (still) lines.push(`${then} stays in use.`);
      else if (then) lines.push(`${then} stayed in use then.`);
    }
    if (rolled && chosen.lifecycle === 'rolled_back' && (!test || test.status === 'passed')) {
      kind = 'failed';
      const when = rolled.at ? ` ${formatDay(rolled.at)}` : '';
      lines.push(
        `Rolled back${when}${rolled.reason ? `: ${lowerFirstWord(text(rolled.reason))}` : ''}${/[.!?]$/.test(text(rolled.reason)) ? '' : '.'}`,
      );
    }
    if (!lines.length) return '';
    // A compact control says the outcome in its first line (the trial is in the In use line), and
    // the rules are a click away on the Prompts page.
    if (instance.view === 'compact') {
      return `<p class="prompt-result" data-result="${kind}"><span class="prompt-result-icon" aria-hidden="true"></span><span class="prompt-result-copy"><span>${esc(lines[0])}</span></span></p>`;
    }
    return `<p class="prompt-result" data-result="${kind}"><span class="prompt-result-icon" aria-hidden="true"></span><span class="prompt-result-copy"><span>${lines.map(esc).join(' ')}</span><a class="chart-action prompt-result-link" href="${RULES_HREF}" data-pc-key="rules">Rollback rules</a></span></p>`;
  };
  // "the system default", "version 2": a version's name inside a sentence.
  const phraseOf = (label) =>
    label === SYSTEM_DEFAULT ? 'the system default' : lowerLabel(text(label));
  // What happens after a test, said before it ends.
  const testPlan = (data) => {
    const share = numberOf(data?.rollout?.canarySharePct);
    const next = share
      ? `If it passes, it’s tried on ${count(share)}% of runs first`
      : 'If it passes, it goes into use';
    return `Your deputy replays it on your last 40 decisions. ${next}; if not, ${phraseOf(data?.inUse?.label ?? SYSTEM_DEFAULT)} stays in use. You can leave; you’ll be told when it’s done.`;
  };
  const lowerFirstWord = (value) =>
    /^[A-Z][a-z]/.test(value) ? `${value.charAt(0).toLowerCase()}${value.slice(1)}` : value;

  // The actions the store allows for the chosen version, in one order, each named for it.
  const actionsHtml = (instance, data, chosen) => {
    const running = data.test?.status === 'running' ? data.test : null;
    const busyWith = running
      ? lowerLabel(
          firstText(
            data.entries.find((entry) => entry.id === running.versionId)?.label,
            running.versionLabel,
            'another version',
          ),
        )
      : '';
    const allowed = chosen.actions.filter((action) => {
      if (action === 'compare') return !chosen.inUse;
      if (action === 'rollback') return Boolean(chosen.rollbackTo) || chosen.lifecycle === 'canary';
      return true;
    });
    // The next step for the chosen version leads (a draft is tested, a trial is used on every
    // run, a version that rolled back is edited); while a test runs nothing leads.
    const main = running ? '' : (PRIMARY[chosen.lifecycle] ?? '');
    const ordered = allowed.includes(main)
      ? [main, ...allowed.filter((action) => action !== main)]
      : allowed;
    // P-8: a compact or row control keeps only the next step (Searches' card and the Prompts
    // page's rows); every other action is in See the prompt or the part a row opens, so Roll back
    // (which asks first, UAT-D-5) is always one of the full view's actions.
    // A row's Details (data-prompt-parts="detail") holds only the rest: the row above it already
    // shows the next step (T7-18).
    const list =
      instance.view !== 'full'
        ? ordered.filter((action) => action === main)
        : instance.detail
          ? ordered.filter((action) => action !== main)
          : ordered;
    // The drawer's column is narrow, so its actions are the compact size too, as a row's are; a
    // row's opened part keeps the full sizes, its next step the page's one primary action.
    const compact = instance.view !== 'full' || instance.drawer;
    const why = [];
    const buttons = list.map((action) => {
      const className =
        compact && !(instance.nextPrimary && action === main)
          ? 'compact-action'
          : action === main
            ? 'primary-action'
            : 'secondary-action';
      const name =
        action === 'rollback' && chosen.rollbackTo
          ? `Roll back to ${chosen.rollbackTo.id === 'system' ? 'the system default' : lowerLabel(chosen.rollbackTo.label)}`
          : ACTION_WORDS[action];
      const blocked = Boolean(running) && ['use', 'test', 'rollback'].includes(action);
      if (blocked && !why.length) why.push(`One test at a time: ${busyWith} is being tested.`);
      const extra =
        action === 'compare' && instance.view !== 'compact'
          ? ` aria-expanded="${instance.compareOpen}" aria-controls="${instance.prefix}-compare"`
          : '';
      // Buttons never wrap their words (the shared rule), so a narrow control (under 360px)
      // shows a shorter name for the three long ones; the context follows for screen readers.
      const short = SHORT_WORDS[action];
      const label =
        short && short !== name
          ? `<span class="prompt-action-long">${esc(name)}</span><span class="prompt-action-short">${esc(short)}</span>`
          : esc(name);
      return `<button type="button" class="${className}" data-prompt-action="${action}" data-pc-key="action:${action}"${blocked ? ` aria-disabled="true" aria-describedby="${instance.prefix}-why"` : ''}${extra}>${label}<span class="sr-only">: ${esc(lowerLabel(chosen.label))} of ${esc(data.name)}</span></button>`;
    });
    if (instance.see && instance.view !== 'row') {
      buttons.push(
        `<button type="button" class="${compact ? 'compact-action' : 'secondary-action'}" data-prompt-open="${esc(data.id)}" data-pc-key="see">See the prompt<span class="sr-only"> for ${esc(data.name)}</span></button>`,
      );
    }
    // UAT D-5: say what a compact control leaves to the drawer.
    const drawerNote =
      instance.view === 'compact' && instance.see
        ? '<p class="prompt-control-why prompt-control-more-note">Every other action, Compare, and the stats are in See the prompt.</p>'
        : '';
    // data-prompt-details="<panel id>": a Details button for the page's own panel (the Prompts
    // page opens one row at a time); its state is read from the panel, so a redraw keeps it.
    if (instance.details) {
      const panel =
        typeof document.getElementById === 'function'
          ? document.getElementById(instance.details)
          : null;
      const open = Boolean(panel) && !panel.hidden;
      buttons.push(
        `<button type="button" class="compact-action prompt-details-toggle" data-prompt-details-toggle="${esc(data.id)}" data-pc-key="details" aria-expanded="${open}" aria-controls="${esc(instance.details)}">Details<span class="sr-only"> of ${esc(data.name)}</span></button>`,
      );
    }
    if (instance.confirming === 'rollback') return confirmHtml(instance, data, chosen, compact);
    if (!buttons.length) return '';
    return `<div class="prompt-control-actions">${buttons.join('')}${why.length ? `<p class="prompt-control-why" id="${instance.prefix}-why">${esc(why[0])}</p>` : ''}${drawerNote}</div>`;
  };

  // UAT D-5: Roll back asks first, in place: one line and two buttons (focus goes to Cancel, the
  // safe choice; Escape cancels). Only Roll back there rolls back.
  const rollbackQuestion = (data, chosen) => {
    const to = chosen.rollbackTo ?? (chosen.lifecycle === 'canary' ? data.inUse : null);
    // In the button's own words ("Roll back to the system default", PG's R7).
    const target =
      !to || to.id === 'system' ? 'the system default' : lowerLabel(text(to.label ?? ''));
    return chosen.lifecycle === 'canary'
      ? `Roll back to ${target}? ${chosen.label}’s trial ends.`
      : `Roll back to ${target}? ${chosen.label} stops being used.`;
  };
  const confirmHtml = (instance, data, chosen, compact) => {
    const p = instance.prefix;
    const main = compact ? 'compact-action' : 'primary-action';
    const other = compact ? 'compact-action' : 'secondary-action';
    return `<div class="prompt-control-confirm" role="group" aria-labelledby="${p}-confirm"><p class="prompt-control-confirm-text" id="${p}-confirm">${esc(rollbackQuestion(data, chosen))}</p><div class="prompt-control-actions"><button type="button" class="${main}" data-prompt-action="rollback-confirm" data-pc-key="action:rollback-confirm">Roll back<span class="sr-only">: ${esc(lowerLabel(chosen.label))} of ${esc(data.name)}</span></button><button type="button" class="${other}" data-prompt-action="rollback-cancel" data-pc-key="action:rollback-cancel">Cancel</button></div></div>`;
  };

  // `words` lists the columns that hold words (left aligned); the rest are figures.
  const tableHtml = (caption, head, rows, { words = [0] } = {}) => {
    const numeric = (index) => (words.includes(index) ? '' : ' class="data-table-numeric"');
    return `<section class="data-table-wrap" tabindex="0" aria-label="${esc(caption)}"><table class="data-table" role="table"><caption class="sr-only">${esc(caption)}</caption><thead role="rowgroup"><tr role="row">${head.map((name, index) => `<th role="columnheader" scope="col"${numeric(index)}>${esc(name)}</th>`).join('')}</tr></thead><tbody role="rowgroup">${rows
      .map(
        (cells) =>
          `<tr role="row">${cells.map((value, index) => `<td role="cell" data-label="${esc(head[index])}"${numeric(index)}>${esc(value)}</td>`).join('')}</tr>`,
      )
      .join('')}</tbody></table></section>`;
  };

  // The figures of one version, as the stats and Compare say them.
  const FIGURES = [
    ['Kept by you', (m) => (m?.agreement == null ? 'Not used yet' : percentText(m.agreement))],
    ['Test score', (m) => (m?.testScore == null ? 'Not tested' : percentText(m.testScore))],
    ['Runs', (m) => (m?.runs == null ? '0' : count(m.runs))],
    ['Tokens a run', (m) => (m?.tokens == null ? 'None yet' : count(m.tokens))],
    [
      'Seconds a run',
      (m) =>
        m?.seconds == null
          ? 'None yet'
          : `${Number(m.seconds).toLocaleString('en-US', { maximumFractionDigits: 1 })} s`,
    ],
    ['Guardrail blocks', (m) => count(m?.blocks ?? 0)],
    ['Injections ignored', (m) => count(m?.injections ?? 0)],
  ];
  const figuresFor = (data, entry) => {
    const metrics = data.metrics?.versions.get(entry.id) ?? null;
    const test = entry.test && entry.test.status !== 'running' ? entry.test : null;
    return test?.score != null ? { ...metrics, testScore: test.score } : metrics;
  };

  const compareHtml = (instance, data, chosen) => {
    if (instance.view === 'compact' || chosen.inUse || !data.inUse) return '';
    const p = instance.prefix;
    const mine = figuresFor(data, chosen);
    const used = figuresFor(data, data.inUse);
    const caption = `${chosen.label} compared with ${data.inUse.label}, in use`;
    const open = instance.open.has('instructions') ? ' open' : '';
    const textOf = (entry) =>
      entry.instructions.trim()
        ? `<p class="prompt-compare-text">${esc(entry.instructions)}</p>`
        : '<p class="prompt-compare-text">No instructions recorded.</p>';
    return `<div class="prompt-compare" id="${p}-compare"${instance.compareOpen ? '' : ' hidden'}>${tableHtml(
      caption,
      ['Measure', chosen.label, `${data.inUse.label}, in use`],
      FIGURES.map(([name, show]) => [name, show(mine), show(used)]),
    )}<details class="prompt-control-more" data-pc-details="instructions"${open}><summary class="prompt-control-toggle" data-pc-key="instructions"><span>Read both instructions</span></summary><div class="prompt-compare-texts"><div><p class="prompt-compare-name">${esc(chosen.label)}</p>${textOf(chosen)}</div><div><p class="prompt-compare-name">${esc(data.inUse.label)}, in use</p>${textOf(data.inUse)}</div></div></details></div>`;
  };

  // The 14-day trend of the version in use, drawn with the rollback minimum as a line, and said
  // in words; the line art is decoration (aria-hidden).
  const trendHtml = (instance, data) => {
    const points = data.metrics?.trend ?? [];
    if (points.length < 2) return '';
    // Only the days it ran have a value (T7-R2); the line breaks over the others.
    const ran = points.filter((point) => point.agreement != null);
    if (!ran.length) return '';
    const values = ran.map((point) => point.agreement);
    const minimum = numberOf(data.rollout?.minAgreementPct);
    const low = Math.max(0, Math.min(...values, minimum ?? 100) - 5);
    const high = Math.min(100, Math.max(...values, minimum ?? 0) + 5);
    const width = 288;
    const height = 72;
    const x = (index) => ((index / (points.length - 1)) * (width - 8) + 4).toFixed(1);
    const y = (value) =>
      (height - 4 - ((value - low) / (high - low || 1)) * (height - 8)).toFixed(1);
    // One polyline a run of days with values; a lone day is a dot.
    const runsOfDays = [];
    for (const [index, point] of points.entries()) {
      if (point.agreement == null) continue;
      const previous = runsOfDays.at(-1);
      if (previous && previous.at(-1).index === index - 1) previous.push({ index, point });
      else runsOfDays.push([{ index, point }]);
    }
    const lines = runsOfDays
      .map((days) =>
        days.length > 1
          ? `<polyline class="prompt-trend-line" points="${days.map(({ index, point }) => `${x(index)},${y(point.agreement)}`).join(' ')}" />`
          : `<circle class="prompt-trend-dot" cx="${x(days[0].index)}" cy="${y(days[0].point.agreement)}" r="2.5" />`,
      )
      .join('');
    const rule =
      minimum == null
        ? ''
        : `<line class="prompt-trend-rule" x1="0" x2="${width}" y1="${y(minimum)}" y2="${y(minimum)}" />`;
    const last = ran.at(-1);
    const lastIndex = points.lastIndexOf(last);
    const every = ran.length === points.length;
    const range =
      values.length > 1
        ? `between ${percentText(Math.min(...values))} and ${percentText(Math.max(...values))}, and ${percentText(last.agreement)} on ${last.label}`
        : `${percentText(last.agreement)} on ${last.label}`;
    const words = `${every ? `Each day from ${points[0].label} to ${points.at(-1).label}` : `It ran on ${plural(ran.length, 'day', 'days')} from ${points[0].label} to ${points.at(-1).label}; no runs the other days`}: ${range}.${minimum == null ? '' : ` A new version needs at least ${percentText(minimum)}.`}`;
    return `<figure class="prompt-trend">${heading(instance, `Kept by you each day, last ${points.length} days (${data.inUse?.label ?? SYSTEM_DEFAULT})`, 'prompt-stats-title')}<svg class="prompt-trend-art" viewBox="0 0 ${width} ${height}" aria-hidden="true" focusable="false">${rule}${lines}<circle class="prompt-trend-dot" cx="${x(lastIndex)}" cy="${y(last.agreement)}" r="3.5" /></svg><figcaption class="prompt-trend-words">${esc(words)}${minimum == null ? '' : ' <span class="prompt-trend-key"><span class="prompt-trend-key-line" aria-hidden="true"></span>Your minimum for a new version</span>'}</figcaption></figure>`;
  };

  // Lists that grow with the account (R6-4) show a first page, then See all N.
  const VERSIONS_SHOWN = 6;
  const ROLLBACKS_SHOWN = 3;
  const seeAllReady = () => typeof window.JobDeputyComponents?.seeAll?.open === 'function';

  const statsHtml = (instance, data) => {
    const used = data.inUse;
    const previous = data.entries.find((entry) => entry.id === data.metrics?.previous) ?? null;
    const parts = [trendHtml(instance, data)];
    if (used) {
      const rows = FIGURES.map(([name, show]) => [
        name,
        show(figuresFor(data, used)),
        previous ? show(figuresFor(data, previous)) : 'None',
      ]);
      parts.push(
        `<div class="prompt-stats-part">${heading(instance, previous ? `${used.label}, in use, against ${lowerLabel(previous.label)} before it` : `${used.label}, in use`, 'prompt-stats-title')}${previous ? tableHtml(`${used.label} against ${previous.label}`, ['Measure', `${used.label}, in use`, `${previous.label}, before`], rows) : '<p class="prompt-stats-empty">No version came before it yet, so there is nothing to compare.</p>'}</div>`,
      );
    }
    const shown = data.entries.slice(0, VERSIONS_SHOWN);
    const more = data.entries.length - shown.length;
    const open = instance.open.has('versions') ? ' open' : '';
    parts.push(
      `<details class="prompt-control-more" data-pc-details="versions"${open}><summary class="prompt-control-toggle" data-pc-key="versions"><span>Every version (${count(data.entries.length)})</span></summary>${tableHtml(
        `${data.name}: every version`,
        ['Version', 'Status', 'Runs', 'Kept by you', 'Test score', 'Tokens a run'],
        shown.map((entry) => {
          const figures = figuresFor(data, entry);
          return [
            entry.label,
            entry.lifecycleLabel,
            FIGURES[2][1](figures),
            FIGURES[0][1](figures),
            FIGURES[1][1](figures),
            FIGURES[3][1](figures),
          ];
        }),
        { words: [0, 1] },
      )}${more > 0 && seeAllReady() ? `<button type="button" class="chart-action see-all-open" data-pc-see-all="versions" data-pc-key="see-all-versions">See all ${count(data.entries.length)}<span class="sr-only"> versions of ${esc(data.name)}</span></button>` : ''}</details>`,
    );
    const rollbacks = data.rollbacks.slice(0, ROLLBACKS_SHOWN);
    parts.push(
      `<div class="prompt-stats-part">${heading(instance, 'Rollback history', 'prompt-stats-title')}${
        rollbacks.length
          ? `<ol class="prompt-rollbacks">${rollbacks.map((item) => `<li><span class="prompt-rollback-what">${esc(firstText(item.fromLabel, item.fromVersionId))} to ${esc(firstText(item.toLabel, item.toVersionId))}</span> <span class="prompt-rollback-when">${esc(formatWhen(item.at))}${item.by === 'you' ? ' · by you' : item.by === 'trial' ? ' · after its trial' : item.by === 'test' ? ' · after its test' : ''}</span>${item.reason ? `<span class="prompt-rollback-why">${esc(text(item.reason))}</span>` : ''}</li>`).join('')}</ol>${data.rollbacks.length > rollbacks.length && seeAllReady() ? `<button type="button" class="chart-action see-all-open" data-pc-see-all="rollbacks" data-pc-key="see-all-rollbacks">See all ${count(data.rollbacks.length)}<span class="sr-only"> rollbacks of ${esc(data.name)}</span></button>` : ''}`
          : '<p class="prompt-stats-empty">No rollbacks yet.</p>'
      }</div>`,
    );
    return `<div class="prompt-stats">${parts.filter(Boolean).join('')}</div>`;
  };

  const ZONES = [
    'pick',
    'trend',
    'measures',
    'test',
    'result',
    'actions',
    'compare',
    'stats',
    'note',
  ];
  // P-8: a compact control's Test score is a small trend of its versions' tests (A3's
  // scoreTrend, drawn after the zones), or "Not tested yet".
  const trendZoneHtml = (instance, data) => {
    if (instance.view !== 'compact') return '';
    const tested = testsFor(data.id);
    return tested?.tests.length || tested?.running
      ? '<div class="prompt-control-trend" data-pc-trend></div>'
      : `<p class="prompt-trend-none"><span class="prompt-trend-none-name">${MEASURES.test.name}</span> Not tested yet</p>`;
  };
  // The store's tests of one prompt (promptTests), as the trend draws them: every finished test
  // in version order, and the test running now.
  const testsFor = (id) => {
    const all = ask('promptTests');
    const entry = Array.isArray(all?.prompts) ? all.prompts.find((item) => item?.id === id) : null;
    return isObject(entry) ? entry : null;
  };
  const trendPoints = (entry) => {
    const points = (Array.isArray(entry?.tests) ? entry.tests : [])
      .filter(isObject)
      .map((test) => ({
        id: text(test.versionId),
        label: text(test.label),
        short: `v${count(test.n)}`,
        score: test.score,
        result: test.status === 'failed' ? 'failed' : 'passed',
        inUse: test.versionId === entry.inUse?.versionId,
        trial: test.versionId === entry.trial?.versionId,
        date: formatDay(test.at),
        note: text(test.reason),
      }));
    const running = isObject(entry?.running) ? entry.running : null;
    if (running && !points.some((point) => point.id === text(running.versionId))) {
      points.push({
        id: text(running.versionId),
        label: firstText(running.versionLabel, running.label, 'A new version'),
        short: running.n ? `v${count(running.n)}` : 'new',
        score: null,
        result: 'testing',
      });
    }
    return points;
  };
  const drawTrend = (instance, data) => {
    const draw = window.JobDeputyComponents?.scoreTrend;
    if (instance.view !== 'compact' || typeof draw !== 'function') return;
    if (typeof instance.host.querySelector !== 'function') return;
    const slot = instance.host.querySelector('[data-pc-trend]');
    const entry = testsFor(data.id);
    if (!slot || !entry) return;
    draw(slot, {
      title: `${MEASURES.test.name} by version`,
      minimum: numberOf(entry.minAgreementPct) ?? numberOf(data.rollout?.minAgreementPct),
      size: 'compact',
      points: trendPoints(entry),
      empty: 'Not tested yet.',
    });
  };
  // A row (data-prompt-view="row") is one line: the dropdown, the two figures, and the next step.
  // A detail host (data-prompt-parts="detail") is the rest, for the part a row opens.
  const zonesOf = (instance, data, chosen) => {
    const row = instance.view === 'row';
    return {
      pick: instance.detail ? '' : pickHtml(instance, data, chosen),
      trend: trendZoneHtml(instance, data),
      measures: instance.detail ? '' : measuresHtml(instance, data, chosen),
      test:
        row || instance.view === 'compact'
          ? briefHtml(instance, data, chosen)
          : testHtml(instance, data),
      result: row || instance.view === 'compact' ? '' : resultHtml(instance, data, chosen),
      actions: actionsHtml(instance, data, chosen),
      compare: row ? '' : compareHtml(instance, data, chosen),
      stats: !row && instance.stats ? foldedStats(instance, statsHtml(instance, data)) : '',
      note:
        !row && instance.note
          ? `<p class="sample-note">${esc(data.metrics?.note ?? CONTROL_SAMPLE)}</p>`
          : '',
    };
  };
  // data-prompt-stats="folded" keeps the stats in a disclosure that starts closed.
  const foldedStats = (instance, html) =>
    instance.stats === 'folded'
      ? `<details class="prompt-control-more" data-pc-details="stats"${instance.open.has('stats') ? ' open' : ''}><summary class="prompt-control-toggle" data-pc-key="stats"><span>Stats and rollback history</span></summary><div class="prompt-control-fold">${html}</div></details>`
      : html;
  // The zones: the dropdown beside the measures, the test, the result, and the actions (side by
  // side when the control is wide), then Compare, the stats, and the sample note across.
  const zoneShell = (zones) => {
    const zone = (name) =>
      `<div class="prompt-control-zone" data-pc-zone="${name}"${zones[name] ? '' : ' hidden'}>${zones[name]}</div>`;
    return `<div class="prompt-control-grid">${zone('pick')}<div class="prompt-control-main">${['trend', 'measures', 'test', 'result', 'actions'].map(zone).join('')}</div>${['compare', 'stats', 'note'].map(zone).join('')}</div>`;
  };

  const controls = new Set();
  let controlCount = 0;
  const zoneMarkup = new WeakMap();
  const focusKey = (scope) => {
    const active = document.activeElement;
    if (!isElement(active) || typeof scope?.contains !== 'function' || !scope.contains(active)) {
      return null;
    }
    return active.getAttribute('data-pc-key');
  };
  const refocus = (scope, key) => {
    if (!key || typeof scope?.querySelector !== 'function') return;
    scope.querySelector(`[data-pc-key="${key}"]`)?.focus({ preventScroll: true });
  };

  // Draws one host: all at once the first time (or where the host can't be searched), then only
  // the zones that changed, keeping the dropdown open, focus where it was, and details as left.
  const renderControl = (instance) => {
    const { host } = instance;
    const data = readControl(instance.id);
    if (!data) {
      instance.data = null;
      host.innerHTML = `<p class="prompt-control-missing">This prompt isn’t available here.</p>`;
      return;
    }
    instance.data = data;
    const chosen = chosenOf(data);
    host.setAttribute('data-prompt-chosen', chosen.id);
    host.setAttribute('data-lifecycle', chosen.lifecycle);
    const zones = zonesOf(instance, data, chosen);
    const searchable = typeof host.querySelector === 'function';
    const built = searchable ? host.querySelector('[data-pc-zone="pick"]') : null;
    if (!built) {
      host.innerHTML = zoneShell(zones);
      drawTrend(instance, data);
      if (searchable) {
        host
          .querySelector('.prompt-control-select')
          ?.setAttribute('data-pc-options', optionsHtml(data, chosen).replace(/ selected/g, ''));
        for (const zone of ZONES.slice(1)) {
          const part = host.querySelector(`[data-pc-zone="${zone}"]`);
          if (part) zoneMarkup.set(part, zones[zone]);
        }
      }
      return;
    }
    // The dropdown itself stays (an open list stays open, focus stays on it); only its options,
    // value, status, and the line under it change.
    const select = host.querySelector('.prompt-control-select');
    const signature = optionsHtml(data, chosen).replace(/ selected/g, '');
    if (select) {
      if (select.getAttribute('data-pc-options') !== signature) {
        select.innerHTML = optionsHtml(data, chosen);
        select.setAttribute('data-pc-options', signature);
      }
      if (select.value !== chosen.id) select.value = chosen.id;
      const pill = host.querySelector('.prompt-lifecycle');
      if (pill) {
        pill.textContent = chosen.lifecycleLabel;
        pill.setAttribute('data-lifecycle', chosen.lifecycle);
      }
      const now = host.querySelector('.prompt-control-now');
      if (now) now.textContent = nowFor(instance, data, chosen);
    } else {
      built.innerHTML = zones.pick;
      built.querySelector('.prompt-control-select')?.setAttribute('data-pc-options', signature);
    }
    for (const zone of ZONES.slice(1)) {
      const part = host.querySelector(`[data-pc-zone="${zone}"]`);
      if (!part || zoneMarkup.get(part) === zones[zone]) continue;
      const key = focusKey(part);
      part.innerHTML = zones[zone];
      part.hidden = !zones[zone];
      zoneMarkup.set(part, zones[zone]);
      if (key) {
        if (part.querySelector(`[data-pc-key="${key}"]`)) refocus(part, key);
        else host.querySelector('.prompt-control-select')?.focus({ preventScroll: true });
      }
    }
    drawTrend(instance, data);
    window.JobDeputyComponents?.init?.(host);
  };

  const fireControl = (instance, detail) => {
    if (typeof CustomEvent !== 'function' || typeof instance.host.dispatchEvent !== 'function') {
      return;
    }
    instance.host.dispatchEvent(new CustomEvent('prompt-control', { bubbles: true, detail }));
  };
  const sayControl = (instance, words) => {
    if (!words) return;
    if (instance.drawer) {
      announcePrompt(promptPart('#prompt-drawer-status'), words);
      return;
    }
    window.JobDeputyComponents?.announce?.(words);
  };

  // While a test runs the deputy is in its test state, working, on the page that started it and
  // on the Prompts page; afterwards it goes back to the page's own state.
  let deputyBefore = null;
  let testedHere = false;
  const anyTestRunning = () =>
    taskIds().some((id) => testOf(ask('promptTest', id))?.status === 'running');
  const onPromptsPage = () => pageFile() === 'prompts-preview.html';
  const syncDeputy = () => {
    const companion = deputy();
    if (typeof companion?.set !== 'function') return;
    const running = anyTestRunning();
    if (running && (testedHere || onPromptsPage())) {
      if (deputyBefore === null) {
        deputyBefore = text(companion.pageState) || (onPromptsPage() ? 'test' : 'idle');
        companion.set('test', { working: true });
      }
      return;
    }
    if (!running && deputyBefore !== null) {
      const back = deputyBefore;
      deputyBefore = null;
      testedHere = false;
      companion.set(back);
    }
  };

  // The time a running test has taken, and the decisions it has replayed, count up once a second
  // (only those lines and the bar change; the store's events redraw the rest every 10 decisions
  // and each check), wherever the test was started.
  let tickTimer = 0;
  const syncTicker = () => {
    const running = [...controls].some((instance) => instance.data?.test?.status === 'running');
    if (running && !tickTimer && typeof window.setInterval === 'function') {
      tickTimer = window.setInterval(() => {
        for (const instance of controls) {
          const test = instance.data?.test;
          if (test?.status !== 'running' || typeof instance.host.querySelector !== 'function') {
            continue;
          }
          const fresh = testOf(ask('promptTest', instance.id));
          const seconds = fresh ? elapsedOf(fresh) : null;
          const line = instance.host.querySelector('[data-pc-elapsed]');
          if (line && seconds != null) line.textContent = `Running for ${elapsedText(seconds)}`;
          if (fresh?.status !== 'running') continue;
          const brief = instance.host.querySelector('[data-pc-brief]');
          const briefWords = briefCount(fresh);
          if (brief && brief.innerHTML !== briefWords) brief.innerHTML = briefWords;
          const now = testCount(fresh);
          const counter = instance.host.querySelector('[data-pc-count]');
          if (counter && counter.innerHTML !== now.words) counter.innerHTML = now.words;
          instance.host
            .querySelector('.prompt-test-fill')
            ?.style?.setProperty('--value', now.share);
        }
      }, 1000);
    } else if (!running && tickTimer) {
      window.clearInterval?.(tickTimer);
      tickTimer = 0;
    }
  };

  const refreshControls = () => {
    for (const instance of [...controls]) {
      if (!instance.drawer && instance.host.isConnected === false) {
        controls.delete(instance);
        continue;
      }
      if (instance.drawer && !promptDialog?.open) continue;
      renderControl(instance);
    }
    syncTicker();
    syncDeputy();
  };

  const failureOf = (reason) =>
    ({
      'already-testing': 'Another version of this prompt is being tested. Try again when it ends.',
      testing: 'A test of this prompt is running. Try again when it ends.',
      'guardrail-blocked':
        'The guardrail checks block this version, so it can’t run. Edit it as a new version.',
      'unknown-version': 'That version isn’t here any more. Choose another one.',
      'unknown-prompt': 'This prompt isn’t available here.',
    })[reason] ?? 'That didn’t work. Try again in a moment.';

  // One action on the chosen version. The store refuses what it can't do and the control says
  // why in words; nothing is pretended.
  // The version menu a finished Roll back returns to (a cancelled one too, when its Roll back is
  // gone): the control's own, else (a Details panel drawn with data-prompt-parts="detail") the
  // same prompt's menu nearest to it.
  const focusMenu = (instance) => {
    const host = instance.host;
    if (typeof host?.querySelector !== 'function') return;
    const own = host.querySelector('.prompt-control-select');
    if (own) {
      own.focus();
      return;
    }
    const selector = `[data-prompt-control="${instance.id}"] .prompt-control-select`;
    let scope = host.parentElement;
    while (scope) {
      const menu = scope.querySelector(selector);
      if (menu) {
        menu.focus();
        return;
      }
      scope = scope.parentElement;
    }
  };
  const act = (instance, action, opener) => {
    const data = readControl(instance.id);
    if (!data) return;
    const chosen = chosenOf(data);
    const running = data.test?.status === 'running';
    const name = data.name;
    const finish = (ok, reason, words, reaction) => {
      sayControl(instance, words);
      if (reaction) deputy()?.react?.(reaction.name, reaction.options);
      fireControl(instance, { id: data.id, versionId: chosen.id, action, ok, reason });
    };
    if (action === 'rollback-cancel') {
      instance.confirming = null;
      renderControl(instance);
      // Cancel and Escape go back to the Roll back that asked (T6-12), still there; else the menu.
      const asked = instance.host.querySelector?.('[data-pc-key="action:rollback"]');
      if (asked) asked.focus();
      else focusMenu(instance);
      sayControl(instance, 'Nothing changed.');
      fireControl(instance, { id: data.id, versionId: chosen.id, action, ok: true });
      return;
    }
    if (running && ['use', 'test', 'rollback', 'rollback-confirm'].includes(action)) {
      instance.confirming = null;
      finish(false, 'testing', failureOf('testing'));
      return;
    }
    if (action === 'compare') {
      if (instance.view !== 'full') {
        openPrompt(data.id, { opener, compare: chosen.id });
        fireControl(instance, { id: data.id, versionId: chosen.id, action, ok: true });
        return;
      }
      instance.compareOpen = !instance.compareOpen;
      renderControl(instance);
      fireControl(instance, { id: data.id, versionId: chosen.id, action, ok: true });
      return;
    }
    if (action === 'edit') {
      if (instance.drawer) editInDrawer(chosen);
      else openPrompt(data.id, { opener, edit: chosen.id });
      fireControl(instance, { id: data.id, versionId: chosen.id, action, ok: true });
      return;
    }
    if (action === 'test') {
      const outcome = ask('testPrompt', data.id, chosen.id);
      if (!outcome || outcome.ok === false) {
        finish(false, outcome?.reason ?? 'unavailable', failureOf(outcome?.reason), {
          name: 'error',
        });
        return;
      }
      testedHere = true;
      chosenVersions.set(data.id, chosen.id);
      refreshControls();
      sayControl(
        instance,
        `Testing ${lowerLabel(chosen.label)} of ${name}: replaying your last ${count(testOf(ask('promptTest', data.id))?.of ?? DECISIONS)} decisions. ${TEST_LEAVE}`,
      );
      if (typeof instance.host.querySelector === 'function') {
        instance.host.querySelector('.prompt-test')?.focus({ preventScroll: false });
      }
      fireControl(instance, { id: data.id, versionId: chosen.id, action, ok: true });
      return;
    }
    if (action === 'use') {
      let outcome;
      if (has('usePromptVersion')) outcome = ask('usePromptVersion', data.id, chosen.id);
      else if (chosen.system) {
        outcome = has('resetPrompt')
          ? ask('resetPrompt', data.id)
          : ask('setPrompt', data.id, null);
      } else outcome = ask('restorePrompt', data.id, chosen.id);
      if (!outcome || outcome.ok === false) {
        finish(false, outcome?.reason ?? 'unavailable', failureOf(outcome?.reason), {
          name: 'error',
        });
        return;
      }
      chosenVersions.set(data.id, chosen.id);
      refreshControls();
      if (instance.drawer) refreshPrompt();
      finish(true, '', `${chosen.label} is in use for ${name} from the next run.`, {
        name: 'saved',
        options: { speech: 'I’ll use this version.' },
      });
      return;
    }
    if (action === 'rollback') {
      instance.confirming = 'rollback';
      renderControl(instance);
      instance.host.querySelector?.('[data-prompt-action="rollback-cancel"]')?.focus();
      sayControl(instance, rollbackQuestion(data, chosen));
      fireControl(instance, { id: data.id, versionId: chosen.id, action, ok: true });
      return;
    }
    if (action === 'rollback-confirm') {
      instance.confirming = null;
      const target = chosen.rollbackTo?.id ?? (chosen.lifecycle === 'canary' ? data.inUse?.id : '');
      const outcome = target ? ask('rollback', data.id, target) : null;
      if (!outcome || outcome.ok === false) {
        finish(false, outcome?.reason ?? 'unavailable', failureOf(outcome?.reason), {
          name: 'error',
        });
        return;
      }
      const back = data.entries.find((entry) => entry.id === target);
      chosenVersions.set(data.id, target);
      refreshControls();
      if (instance.drawer) refreshPrompt();
      finish(
        true,
        '',
        `Rolled back: ${back?.label ?? SYSTEM_DEFAULT} is in use for ${name}. ${chosen.label} stays in the list.`,
        { name: 'saved', options: { speech: 'Rolled back.' } },
      );
      focusMenu(instance);
    }
  };

  const seeAllFor = (instance, kind, opener) => {
    const data = instance.data;
    if (!data || !seeAllReady()) return;
    if (kind === 'versions') {
      window.JobDeputyComponents.seeAll.open(
        {
          title: `${data.name}: every version`,
          noun: ['version', 'versions'],
          countLabel: ['run', 'runs'],
          searchLabel: 'Find a version',
          sorts: [
            { id: 'count', label: 'Most runs' },
            { id: 'name', label: 'Name, A to Z' },
          ],
          items: data.entries.map((entry) => ({
            id: entry.id,
            label: entry.label,
            count: figuresFor(data, entry)?.runs ?? 0,
            meta: entry.lifecycleLabel,
          })),
          note: data.metrics?.note ?? CONTROL_SAMPLE,
        },
        opener,
      );
      return;
    }
    window.JobDeputyComponents.seeAll.open(
      {
        title: `${data.name}: rollbacks`,
        noun: ['rollback', 'rollbacks'],
        countLabel: null,
        searchLabel: 'Find a rollback',
        sorts: [],
        items: data.rollbacks.map((item, index) => ({
          id: text(item.id) || `rollback-${index}`,
          label: `${firstText(item.fromLabel, item.fromVersionId)} to ${firstText(item.toLabel, item.toVersionId)}`,
          count: null,
          meta: [formatWhen(item.at), text(item.reason)].filter(Boolean).join(' · '),
        })),
      },
      opener,
    );
  };

  const listenTo = (instance) => {
    const { host } = instance;
    if (typeof host.addEventListener !== 'function') return;
    host.addEventListener('change', (event) => {
      const select = event.target;
      const chose =
        typeof select?.matches === 'function'
          ? select.matches('.prompt-control-select')
          : select?.getAttribute?.('data-pc-key') === 'version';
      if (!chose) return;
      chosenVersions.set(instance.id, text(select.value));
      instance.compareOpen = false;
      instance.confirming = null;
      refreshControls();
      fireControl(instance, {
        id: instance.id,
        versionId: text(select.value),
        action: 'choose',
        ok: true,
      });
    });
    host.addEventListener('click', (event) => {
      const button = event.target?.closest?.('[data-prompt-action], [data-pc-see-all]');
      if (!button || (typeof host.contains === 'function' && !host.contains(button))) return;
      if (button.hasAttribute?.('data-pc-see-all')) {
        seeAllFor(instance, button.getAttribute('data-pc-see-all'), button);
        return;
      }
      event.preventDefault();
      act(instance, button.getAttribute('data-prompt-action'), button);
    });
    // Escape answers a Roll back question with Cancel (it stays inside the control, so an open
    // drawer does not close with it).
    host.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || instance.confirming !== 'rollback') return;
      event.preventDefault?.();
      event.stopPropagation?.();
      act(instance, 'rollback-cancel', null);
    });
    // Details keep the state you left them in when a zone is drawn again.
    host.addEventListener(
      'toggle',
      (event) => {
        const key = event.target?.getAttribute?.('data-pc-details');
        if (!key) return;
        if (event.target.open) instance.open.add(key);
        else instance.open.delete(key);
      },
      true,
    );
  };

  const makeControl = (host, { id, drawer = false } = {}) => {
    controlCount += 1;
    const asked = host.getAttribute?.('data-prompt-view');
    const view = asked === 'compact' || asked === 'row' ? asked : 'full';
    const safe = text(id).replace(/[^a-z0-9-]/gi, '') || 'prompt';
    return {
      host,
      id: text(id),
      drawer,
      prefix: `pc-${safe}-${controlCount}`,
      view,
      stats: { on: true, folded: 'folded' }[host.getAttribute?.('data-prompt-stats')] ?? false,
      note: drawer || host.getAttribute?.('data-prompt-note') !== 'off',
      see: !drawer && host.getAttribute?.('data-prompt-see') !== 'off',
      metric: !drawer && host.getAttribute?.('data-prompt-metric') !== 'off',
      heading: Number(host.getAttribute?.('data-prompt-heading')) || 0,
      // data-prompt-parts="detail": everything but the dropdown and the measures (for the opened
      // part under a row that shows them); data-prompt-meanings="off": the measures without
      // their definitions (for a page that defines them once).
      detail: host.getAttribute?.('data-prompt-parts') === 'detail',
      details: text(host.getAttribute?.('data-prompt-details')).replace(/[^\w-]/g, ''),
      // data-prompt-next="primary": a row's next step is the page's primary action (the Prompts
      // page, whose rows lead it); elsewhere a row keeps compact actions.
      nextPrimary: host.getAttribute?.('data-prompt-next') === 'primary',
      meanings: view !== 'row' && host.getAttribute?.('data-prompt-meanings') !== 'off',
      compareOpen: false,
      confirming: null,
      open: new Set(),
      data: null,
    };
  };

  const upgradeControl = (host) => {
    if (!isElement(host) || host.hasAttribute('data-prompt-ready')) return;
    if (host.closest?.('dialog.prompt-drawer')) return;
    const instance = makeControl(host, { id: host.getAttribute('data-prompt-control') });
    host.setAttribute('data-prompt-ready', '');
    host.classList?.add('prompt-control');
    host.setAttribute('data-prompt-view', instance.view);
    controls.add(instance);
    listenTo(instance);
    renderControl(instance);
  };
  const upgradeControls = (scope) => {
    if (typeof scope?.querySelectorAll !== 'function') return;
    if (scope.matches?.('[data-prompt-control]')) upgradeControl(scope);
    for (const host of scope.querySelectorAll('[data-prompt-control]')) upgradeControl(host);
  };

  // A finished test is said on whichever page is open: A3's background notice (and its Activity
  // row) when the page has it, else the shared status line; the deputy reacts once.
  const noticeFor = (change) => {
    const id = text(change?.id);
    if (!taskIds().includes(id)) return;
    const data = readControl(id);
    const test = testOf(ask('promptTest', id)) ?? null;
    const versionId = text(change.versionId) || test?.versionId || '';
    const entry = data?.entries.find((item) => item.id === versionId) ?? null;
    const label = firstText(entry?.label, test?.versionLabel, 'A new version');
    const name = firstText(data?.name, id);
    const passed = change.status === 'passed';
    let words;
    if (passed) {
      const share = shareOf(entry?.canary ?? test?.canary, data?.rollout);
      words =
        entry?.lifecycle === 'canary'
          ? `${upperFirst(lowerLabel(label))} of ${name} passed its test and is trying on ${share == null ? 'a share' : `${count(share)}%`} of runs.`
          : `${upperFirst(lowerLabel(label))} of ${name} passed its test and is in use.`;
    } else {
      const why = test?.reason || (test?.score != null ? percentText(test.score) : '');
      words = `${upperFirst(lowerLabel(label))} of ${name} didn’t pass${why ? `: ${why}` : ''}. ${data?.inUse?.label ?? SYSTEM_DEFAULT} stays in use.`;
    }
    const href = `./prompts-preview.html#${id}`;
    const components = window.JobDeputyComponents;
    if (typeof components?.notice === 'function') {
      try {
        components.notice({
          id: `prompt-test-${id}-${versionId}`,
          text: words,
          kind: passed ? 'done' : 'needs-you',
          href,
          action: { label: 'See the result', href },
          toast: true,
          // The store records the test in the deputy's Activity itself (the same id).
          record: false,
        });
      } catch {
        components.announce?.(words);
      }
    } else if (promptDialog?.open) {
      announcePrompt(promptPart('#prompt-drawer-status'), words);
    } else {
      components?.announce?.(words);
    }
    deputy()?.react?.(passed ? 'saved' : 'error', {
      speech: passed ? 'It passed.' : 'It didn’t pass. I kept the one in use.',
    });
  };

  // The control's own rules, every one under .prompt-control and canonical tokens only, added to
  // the head once (the orchestrator may move them into app-chrome.css as they are).
  const CONTROL_STYLES = `
.prompt-control { display: grid; min-width: 0; container: prompt-control / inline-size; color: var(--ink); font-size: 14px; font-weight: 400; line-height: 1.45; }
.prompt-control .prompt-control-grid, .prompt-control .prompt-control-main { display: grid; min-width: 0; grid-template-columns: minmax(0, 1fr); gap: 13px; align-content: start; }
.prompt-control .prompt-control-zone { display: grid; min-width: 0; grid-template-columns: minmax(0, 1fr); gap: 13px; align-content: start; }
.prompt-control [data-pc-zone="pick"] { gap: 0; }
.prompt-control .prompt-control-fold { display: grid; padding: 0 13px 13px; }
@container prompt-control (min-width: 760px) { .prompt-control:not([data-prompt-parts="detail"], [data-prompt-view="row"]) .prompt-control-grid { grid-template-columns: minmax(0, 5fr) minmax(0, 8fr); column-gap: 34px; } .prompt-control .prompt-control-grid > [data-pc-zone="compare"], .prompt-control .prompt-control-grid > [data-pc-zone="stats"], .prompt-control .prompt-control-grid > [data-pc-zone="note"] { grid-column: 1 / -1; } }
.prompt-control .prompt-control-zone[hidden] { display: none; }
.prompt-control .prompt-control-label { margin-bottom: 8px; }
.prompt-control .prompt-control-choice { display: flex; min-width: 0; flex-wrap: wrap; gap: 8px 13px; align-items: center; }
.prompt-control .prompt-control-select { flex: 1 1 100%; width: 100%; min-width: 0; max-width: 100%; cursor: pointer; text-overflow: ellipsis; }
.prompt-control .prompt-control-now { margin: 8px 0 0; color: var(--ink-soft); font-size: 13px; line-height: 1.45; }
.prompt-control .prompt-control-now:empty { display: none; }
.prompt-control .prompt-lifecycle[data-lifecycle="testing"], .prompt-control .prompt-lifecycle[data-lifecycle="canary"] { color: var(--ink); background: var(--blue-soft); }
.prompt-control .prompt-lifecycle[data-lifecycle="testing"]::before, .prompt-control .prompt-lifecycle[data-lifecycle="canary"]::before { width: 8px; height: 8px; border-radius: 50%; background: var(--blue); content: ""; }
.prompt-control .prompt-lifecycle[data-lifecycle="rolled_back"], .prompt-control .prompt-lifecycle[data-lifecycle="failed"] { color: var(--danger-ink); background: var(--orange-soft); }
.prompt-control .prompt-lifecycle[data-lifecycle="draft"], .prompt-control .prompt-lifecycle[data-lifecycle="retired"] { color: var(--ink-soft); background: var(--paper-deep); }
.prompt-control .prompt-measures { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 233px), 1fr)); gap: 13px; margin: 0; }
.prompt-control .prompt-measure { display: grid; min-width: 0; align-content: start; gap: 4px; padding: 13px 15px; border: 1px solid var(--line); border-radius: 13px; background: var(--surface-strong); }
.prompt-control .prompt-measure dt { color: var(--ink); font-size: 13px; font-weight: 700; line-height: 1.3; }
.prompt-control .prompt-measure dd { margin: 0; }
.prompt-control .prompt-measure-figure { display: flex; flex-wrap: wrap; gap: 4px 8px; align-items: baseline; }
.prompt-control .prompt-measure-value { color: var(--ink); font-family: var(--font-display); font-size: 34px; font-variant-numeric: tabular-nums; line-height: 1.1; }
.prompt-control .prompt-measure-empty { color: var(--ink-soft); font-size: 14px; font-weight: 650; line-height: 1.4; }
.prompt-control .prompt-measure-vs, .prompt-control .prompt-measure-extra { color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; line-height: 1.4; }
.prompt-control .prompt-measure-meaning { color: var(--ink-soft); font-size: 12px; line-height: 1.45; }
.prompt-control[data-prompt-view="compact"] .prompt-measures { grid-template-columns: repeat(auto-fit, minmax(min(100%, 144px), 1fr)); gap: 8px; }
.prompt-control[data-prompt-view="compact"] .prompt-measure { padding: 8px 13px; }
.prompt-control[data-prompt-view="compact"] .prompt-measure-value { font-size: 21px; }
.prompt-control .prompt-control-more { border: 1px solid var(--line); border-radius: 13px; background: var(--surface); }
.prompt-control .prompt-control-toggle { display: flex; min-height: 44px; padding: 0 13px; align-items: center; justify-content: space-between; gap: 8px; cursor: pointer; color: var(--ink); font-size: 13px; font-weight: 680; list-style: none; }
.prompt-control .prompt-control-toggle::-webkit-details-marker { display: none; }
.prompt-control .prompt-control-toggle::after { color: var(--muted); content: "⌄" / ""; }
.prompt-control .prompt-control-more[open] > .prompt-control-toggle::after { transform: rotate(180deg); }
.prompt-control .prompt-meanings { display: grid; gap: 8px; margin: 0; padding: 0 13px 13px; }
.prompt-control .prompt-meanings dt { color: var(--ink); font-size: 12px; font-weight: 700; }
.prompt-control .prompt-meanings dd { margin: 0; color: var(--ink-soft); font-size: 12px; line-height: 1.45; }
.prompt-control .prompt-test { display: grid; min-width: 0; gap: 8px; padding: 13px 15px; border: 1px solid var(--blue); border-radius: 13px; background: var(--blue-soft); }
.prompt-control .prompt-test:focus-visible { outline: 2px solid var(--green-ink); outline-offset: 3px; }
.prompt-control .prompt-test-title { display: flex; gap: 8px; margin: 0; align-items: center; color: var(--ink); font-size: 14px; font-weight: 700; line-height: 1.3; }
.prompt-control .prompt-test-dot { width: 10px; height: 10px; flex: 0 0 auto; border-radius: 50%; background: var(--blue); animation: jd-prompt-test-pulse 1618ms ease-in-out infinite; }
.prompt-control .prompt-test-line, .prompt-control .prompt-test-time { margin: 0; color: var(--ink); font-size: 13px; font-variant-numeric: tabular-nums; line-height: 1.4; }
.prompt-control .prompt-test-time { color: var(--ink-soft); }
.prompt-control .prompt-test-bar { display: block; height: 8px; overflow: hidden; border-radius: 999px; background: var(--surface-strong); box-shadow: inset 0 0 0 1px var(--line-strong); }
.prompt-control .prompt-test-fill { display: block; width: calc(var(--value, 0) * 100%); height: 100%; border-radius: inherit; background: var(--blue); transition: width 610ms var(--ease-settle); }
.prompt-control .prompt-test-checks { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 178px), 1fr)); gap: 4px 13px; margin: 0; padding: 0; list-style: none; }
.prompt-control .prompt-test-check { display: flex; min-height: 28px; gap: 8px; align-items: center; color: var(--ink); font-size: 13px; line-height: 1.3; }
.prompt-control .prompt-test-check-icon { display: grid; width: 22px; height: 22px; flex: 0 0 auto; border: 1px solid var(--line-strong); border-radius: 50%; place-items: center; background: var(--surface-strong); font-size: 12px; font-weight: 750; line-height: 1; }
.prompt-control .prompt-test-check[data-status="pass"] .prompt-test-check-icon { border-color: transparent; color: var(--green-ink); background: var(--green-soft); }
.prompt-control .prompt-test-check[data-status="pass"] .prompt-test-check-icon::before { content: "✓" / ""; }
.prompt-control .prompt-test-check[data-status="fail"] .prompt-test-check-icon { border-color: var(--danger-ink); color: var(--danger-ink); background: var(--orange-soft); }
.prompt-control .prompt-test-check[data-status="fail"] .prompt-test-check-icon::before { content: "×" / ""; }
.prompt-control .prompt-test-check[data-status="pending"] { color: var(--ink-soft); }
.prompt-control .prompt-test-leave { margin: 0; color: var(--ink); font-family: var(--font-display); font-size: 15px; font-style: italic; line-height: 1.4; }
.prompt-control .prompt-result { display: flex; gap: 8px; margin: 0; padding: 13px 15px; border-radius: 13px; align-items: start; color: var(--ink); background: var(--green-wash); font-size: 13px; line-height: 1.45; }
.prompt-control .prompt-result[data-result="failed"] { background: var(--orange-soft); }
.prompt-control .prompt-result-icon { display: grid; width: 22px; height: 22px; flex: 0 0 auto; border-radius: 50%; place-items: center; color: var(--green-ink); background: var(--surface-strong); font-size: 12px; font-weight: 750; line-height: 1; }
.prompt-control .prompt-result-icon::before { content: "✓" / ""; }
.prompt-control .prompt-result[data-result="failed"] .prompt-result-icon { color: var(--danger-ink); }
.prompt-control .prompt-result[data-result="failed"] .prompt-result-icon::before { content: "!" / ""; }
.prompt-control .prompt-result-copy { display: grid; min-width: 0; justify-items: start; }
.prompt-control .prompt-control-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.prompt-control .prompt-action-short { display: none; }
@container prompt-control (max-width: 359px) { .prompt-control .prompt-action-long { display: none; } .prompt-control .prompt-action-short { display: inline; } }
.prompt-control .prompt-control-why { flex: 1 0 100%; margin: 0; color: var(--ink-soft); font-size: 12px; font-weight: 600; line-height: 1.4; }
.prompt-control .prompt-compare { display: grid; min-width: 0; gap: 13px; }
.prompt-control .prompt-compare[hidden] { display: none; }
.prompt-control .prompt-compare-texts { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 233px), 1fr)); gap: 13px; padding: 0 13px 13px; }
.prompt-control .prompt-compare-name { margin: 0 0 4px; color: var(--ink); font-size: 12px; font-weight: 700; }
.prompt-control .prompt-compare-text { margin: 0; color: var(--ink-soft); font-size: 13px; line-height: 1.5; overflow-wrap: anywhere; white-space: pre-wrap; }
.prompt-control .prompt-stats { display: grid; min-width: 0; gap: 21px; padding-top: 8px; }
.prompt-control .prompt-stats-part { display: grid; min-width: 0; gap: 8px; }
.prompt-control .prompt-stats-title { margin: 0; color: var(--ink); font-family: var(--font-text); font-size: 13px; font-weight: 700; letter-spacing: 0; line-height: 1.3; }
.prompt-control .prompt-stats-empty { margin: 0; color: var(--ink-soft); font-size: 13px; line-height: 1.45; }
.prompt-control .prompt-trend { display: grid; min-width: 0; gap: 8px; margin: 0; }
.prompt-control .prompt-trend-art { width: 100%; max-width: 377px; height: auto; overflow: visible; }
.prompt-control .prompt-trend-line { fill: none; stroke: var(--green-ink); stroke-linecap: round; stroke-linejoin: round; stroke-width: 2.5; }
.prompt-control .prompt-trend-dot { fill: var(--green-ink); }
.prompt-control .prompt-trend-rule { stroke: var(--danger-ink); stroke-dasharray: 5 4; stroke-width: 1.5; }
.prompt-control .prompt-trend-words { display: flex; flex-wrap: wrap; gap: 4px 13px; align-items: center; color: var(--ink); font-size: 13px; font-variant-numeric: tabular-nums; line-height: 1.45; }
.prompt-control .prompt-trend-key { display: inline-flex; gap: 6px; align-items: center; color: var(--ink-soft); font-size: 12px; }
.prompt-control .prompt-trend-key-line { width: 21px; border-top: 2px dashed var(--danger-ink); }
/* A wide card (the Prompts page's Details, T6-10): the day trend and the words that read it sit
   side by side, each half the card, so the chart uses its room and nothing is left empty. */
@container prompt-control (min-width: 640px) { .prompt-control .prompt-trend { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); column-gap: 21px; align-items: start; } .prompt-control .prompt-trend > .prompt-stats-title { grid-column: 1 / -1; } .prompt-control .prompt-trend-art { max-width: none; } .prompt-control .prompt-trend-words { align-content: start; } }
.prompt-control .prompt-rollbacks { display: grid; gap: 8px; margin: 0; padding: 0 0 0 21px; color: var(--ink); font-size: 13px; line-height: 1.45; }
.prompt-control .prompt-rollback-what { font-weight: 650; }
.prompt-control .prompt-rollback-when { color: var(--muted); font-size: 12px; }
.prompt-control .prompt-rollback-why { display: block; color: var(--ink-soft); font-size: 12px; }
.prompt-control .prompt-control-missing { margin: 0; color: var(--ink-soft); font-size: 13px; }
.prompt-control .prompt-control-confirm { display: grid; min-width: 0; gap: 8px; padding: 13px 15px; border: 1px solid var(--line-strong); border-radius: 13px; background: var(--surface-strong); }
.prompt-control .prompt-control-confirm-text { margin: 0; color: var(--ink); font-size: 14px; font-weight: 650; line-height: 1.4; }
.prompt-control .prompt-control-trend { min-width: 0; }
.prompt-control .prompt-trend-none { margin: 0; color: var(--ink-soft); font-size: 13px; line-height: 1.4; }
.prompt-control .prompt-trend-none-name { display: block; color: var(--ink); font-size: 12px; font-weight: 650; }
.prompt-control[data-prompt-view="compact"] [data-pc-zone="trend"] { flex: 1 1 100%; }
.prompt-control .prompt-control-brief { display: flex; gap: 8px; align-items: baseline; margin: 0; color: var(--ink); font-size: 13px; line-height: 1.4; }
.prompt-control .prompt-control-brief[data-result="failed"] { color: var(--danger-ink); }
.prompt-control[data-prompt-view="row"] [data-pc-zone="test"], .prompt-control[data-prompt-view="compact"] [data-pc-zone="test"] { flex: 1 1 100%; }
.prompt-control[data-prompt-view="compact"] .prompt-measure { padding: 0; border: 0; background: none; }
.prompt-control[data-prompt-view="row"] .prompt-control-grid { display: flex; flex-wrap: wrap; gap: 8px 21px; align-items: center; }
.prompt-control[data-prompt-view="row"] .prompt-control-grid > [data-pc-zone="pick"] { flex: 1 1 260px; min-width: 0; }
.prompt-control[data-prompt-view="row"] .prompt-control-main { display: flex; flex: 1 1 auto; flex-wrap: wrap; gap: 8px 21px; align-items: center; min-width: 0; }
.prompt-control[data-prompt-view="row"] .prompt-control-zone { display: block; }
.prompt-control[data-prompt-view="row"] .prompt-control-zone[hidden] { display: none; }
.prompt-control[data-prompt-view="row"] .prompt-control-choice { gap: 4px 8px; }
.prompt-control[data-prompt-view="row"] .prompt-control-select { flex: 1 1 180px; }
.prompt-control[data-prompt-view="row"] .prompt-control-now { margin-top: 4px; font-size: 12px; }
.prompt-control[data-prompt-view="row"] .prompt-measures { display: flex; flex-wrap: wrap; gap: 4px 21px; }
.prompt-control[data-prompt-view="row"] .prompt-measure { padding: 0; border: 0; background: none; }
.prompt-control[data-prompt-view="row"] .prompt-measure dt { color: var(--ink-soft); font-size: 12px; font-weight: 650; }
.prompt-control[data-prompt-view="row"] .prompt-measure-value { font-size: 24px; }
.prompt-control[data-prompt-view="row"] .prompt-measure-empty { font-size: 13px; }
.prompt-control[data-prompt-view="row"] [data-pc-zone="actions"] { flex: 1 1 auto; }
.prompt-control .prompt-details-toggle { margin-inline-start: auto; }
.prompt-control .prompt-details-toggle::after { color: var(--muted); content: "⌄" / ""; }
.prompt-control .prompt-details-toggle[aria-expanded="true"]::after { transform: rotate(180deg); }
.prompt-drawer .prompt-drawer-rules { display: grid; margin: 13px 0 0; justify-items: start; color: var(--ink-soft); font-size: 13px; line-height: 1.45; }
.prompt-drawer .prompt-editing { margin: 0; padding: 8px 13px; border: 1px solid var(--blue); border-radius: 11px; color: var(--ink); background: var(--blue-soft); font-size: 13px; line-height: 1.45; }
.prompt-drawer .prompt-save-next { flex: 1 0 100%; margin: 0; color: var(--ink-soft); font-size: 12px; font-weight: 600; line-height: 1.4; }
@keyframes jd-prompt-test-pulse { 50% { opacity: 0.35; } }
@media (prefers-reduced-motion: reduce) { .prompt-control .prompt-test-dot { animation: none; } .prompt-control .prompt-test-fill { transition: none; } }
html[data-motion="paused"] .prompt-control .prompt-test-dot { animation: none; }
html[data-motion="paused"] .prompt-control .prompt-test-fill { transition: none; }
@media (forced-colors: active) {
  .prompt-control .prompt-measure, .prompt-control .prompt-test, .prompt-control .prompt-result, .prompt-control .prompt-control-more { border: 1px solid CanvasText; }
  .prompt-control .prompt-test-bar { box-shadow: none; border: 1px solid CanvasText; }
  .prompt-control .prompt-test-fill, .prompt-control .prompt-test-dot { background: Highlight; }
  .prompt-control .prompt-test-check-icon { border-color: CanvasText; }
  .prompt-control .prompt-trend-line { stroke: CanvasText; }
  .prompt-control .prompt-trend-dot { fill: CanvasText; }
  .prompt-control .prompt-trend-rule { stroke: Highlight; }
  .prompt-control .prompt-trend-key-line { border-top-color: Highlight; }
}
`;
  const addControlStyles = () => {
    const head = document.head;
    if (!head || typeof document.getElementById !== 'function') return;
    if (document.getElementById('jd-prompt-control')) return;
    const style = document.createElement('style');
    style.id = 'jd-prompt-control';
    style.textContent = CONTROL_STYLES;
    head.append(style);
  };

  // Hosts on the page now, any added later, and every store change.
  const startControls = () => {
    addControlStyles();
    upgradeControls(document.body);
    if (typeof MutationObserver === 'function' && document.body) {
      new MutationObserver((records) => {
        for (const record of records) {
          if (record.target?.closest?.('.prompt-control')) continue;
          for (const node of record.addedNodes) upgradeControls(node);
        }
      }).observe(document.body, { childList: true, subtree: true });
    }
    syncTicker();
    syncDeputy();
  };
  const CONTROL_CHANGES = new Set([
    'prompt',
    'prompt-test',
    'prompt-version',
    'rollout',
    'rollback',
    'reset',
    'external',
    'scale-demo',
    'platform-model',
    'ai-choice',
  ]);
  const onStoreChange = (change) => {
    if (change?.type === 'prompt-test' && ['passed', 'failed'].includes(change.status)) {
      noticeFor(change);
    }
    if (!change?.type || CONTROL_CHANGES.has(change.type)) refreshControls();
    // Every change may move a summary's figures; each host is drawn again only when they did.
    if (document.querySelector?.('[data-prompt-summary]')) drawPromptSummaries(document);
  };

  // ---------------------------------------------------------------- the prompt summary (round 7)

  // The one way a page shows a prompt outside the Prompts page (R10-5): any
  // [data-prompt-summary="<task id>"] host, data-prompt-size="row" (default) or "card". Read only,
  // the same words and one spacing scale in both sizes: the name, the version in use with its pill
  // and, when a newer one is being tested, on trial, did not pass, or was rolled back, a second
  // pill for it; the Test score trend across its versions (scoreTrend, row or compact; a group,
  // [data-prompt-summaries], draws one key at its end); Kept by you (R9-5 words); its tokens this
  // month with a small bar of its share of every prompt's tokens; the model mix in one line; and
  // Open in Prompts, which carries return= (JobDeputyComponents.place). Every figure comes from the
  // store: promptsOverview() when it has it, else prompt(), promptMetrics(), and promptTests(); a
  // part the store cannot answer is left out, never made up. Hosts in the markup are drawn as this
  // script runs (before the page's own script, so a page's first render includes them), hosts added
  // later when they appear, and each is drawn again only when its own figures change (R9-3).
  // Attributes: data-prompt-heading="2".."6" (the name as a heading), data-prompt-metric="off" (no
  // data-metric on its figures), data-prompt-open="off" (no Open in Prompts).
  const SUMMARY_SIZES = ['row', 'card'];
  const summaryDrawn = new WeakMap();
  const SUMMARY_STATES = new Set(['testing', 'canary', 'failed', 'rolled_back']);

  const overviewOf = (id) => {
    const all = ask('promptsOverview');
    const list = Array.isArray(all?.prompts) ? all.prompts : Array.isArray(all) ? all : [];
    return { entry: list.find((item) => item?.id === id) ?? null, list };
  };

  // One prompt, as its summary says it.
  // The newest version past the one in use, from promptTests() (cheap: the summary shows no
  // prompt text, so it never asks for prompt(id), whose guard checks cost the large demo 90ms).
  const LATEST_STAGES = { canary: 'canary', trial: 'canary', testing: 'testing', failed: 'failed' };
  const latestFromTests = (id, tests, inUseId) => {
    const list = (Array.isArray(tests?.tests) ? tests.tests : []).filter(isObject);
    const inUseN = numberOf(list.find((test) => test.versionId === inUseId)?.n) ?? 0;
    const running = isObject(tests?.running) ? tests.running : null;
    if (running && text(running.versionId) !== inUseId) {
      return {
        label: firstText(running.versionLabel, running.label, 'A new version'),
        lifecycle: 'testing',
        words: LIFECYCLE_WORDS.testing,
      };
    }
    const newer = list
      .filter((test) => test.versionId !== inUseId && (numberOf(test.n) ?? 0) > inUseN)
      .sort((a, b) => (numberOf(b.n) ?? 0) - (numberOf(a.n) ?? 0));
    for (const test of newer) {
      const stage = test.rolledBack
        ? 'rolled_back'
        : (LATEST_STAGES[text(test.lifecycle)] ?? (test.status === 'failed' ? 'failed' : ''));
      if (!SUMMARY_STATES.has(stage)) continue;
      const share =
        stage === 'canary'
          ? (numberOf(tests?.trial?.sharePct) ??
            numberOf(test.trial?.sharePct) ??
            numberOf(ask('rolloutSettings', id)?.canarySharePct))
          : null;
      return {
        label: firstText(test.label, `Version ${count(test.n)}`),
        lifecycle: stage,
        words:
          stage === 'canary'
            ? `Trying on ${share == null ? 'a share' : `${count(share)}%`} of runs`
            : LIFECYCLE_WORDS[stage],
      };
    }
    return null;
  };

  // One window for every usage figure of a summary (the orchestrator's A): the last 30 days, the
  // same as the Prompts summary and Usage's default range, read from usage()'s combinations, so
  // a row's runs, tokens, Kept by you, and models match Usage's table for that range.
  const SUMMARY_RANGE = '30d';
  const SUMMARY_WINDOW = 'Last 30 days';
  const MODEL_TONES = ['blue', 'green', 'orange', 'wine', 'quiet', 'ink', 'indigo'];
  let windowMemo = null;
  const summaryWindow = () => {
    const usage = ask('usage', { range: SUMMARY_RANGE, group: 'task' });
    // Reading job email runs inside each Gmail scan's run (the store's payer "run"): its rows
    // count here too, said as included, never in the tokens you pay for.
    const included = ask('usage', {
      range: SUMMARY_RANGE,
      group: 'task',
      filter: { payer: 'run' },
    });
    const key = usage
      ? `${text(usage.from)}|${text(usage.to)}|${usage.permutations?.length ?? 0}|${usage.totals?.tokens ?? 0}|${included?.permutations?.length ?? 0}`
      : '';
    if (windowMemo && windowMemo.key === key) return windowMemo.value;
    const tasks = new Map();
    const models = new Map();
    let all = 0;
    const rows = [
      ...(Array.isArray(usage?.permutations) ? usage.permutations : []),
      ...(Array.isArray(included?.permutations) ? included.permutations : []).filter(
        (row) => row?.included || row?.payer === 'run',
      ),
    ];
    for (const row of rows) {
      if (!isObject(row)) continue;
      const task = text(row.task);
      const entry = tasks.get(task) ?? {
        tokens: 0,
        calls: 0,
        kept: 0,
        decided: 0,
        models: new Map(),
        included: true,
      };
      const isIncluded = Boolean(row.included || row.payer === 'run');
      entry.included = entry.included && isIncluded;
      const tokens = numberOf(row.tokens) ?? 0;
      const calls = numberOf(row.calls) ?? 0;
      entry.tokens += tokens;
      entry.calls += calls;
      entry.kept += numberOf(row.kept) ?? 0;
      entry.decided += numberOf(row.decided) ?? 0;
      const model = text(row.model);
      const mine = entry.models.get(model) ?? {
        id: model,
        label: firstText(row.modelLabel, model),
        calls: 0,
      };
      mine.calls += calls;
      entry.models.set(model, mine);
      tasks.set(task, entry);
      models.set(model, (models.get(model) ?? 0) + calls);
      if (!isIncluded) all += tokens;
    }
    // One tone a model, the same in every row and as Usage's charts draw it (the store's groups
    // by model), else by its runs over the window.
    const byModel = ask('usage', { range: SUMMARY_RANGE, group: 'model' });
    const storeTones = new Map(
      (Array.isArray(byModel?.groups) ? byModel.groups : [])
        .filter((group) => isObject(group) && !group.other && group.tone)
        .map((group) => [text(group.id), text(group.tone)]),
    );
    const tones = new Map(
      [...models.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([model], index) => [
          model,
          storeTones.get(model) ?? MODEL_TONES[index % MODEL_TONES.length],
        ]),
    );
    const value = usage
      ? {
          tasks,
          all,
          tones,
          includedText: 'Included in Gmail’s scans',
        }
      : null;
    windowMemo = { key, value };
    return value;
  };

  // Whole percentages that add to 100 (T6b-1, largest remainder): each share's floor, then the
  // points left go to the largest remainders, ties to the earlier (larger) one.
  const wholeShares = (counts) => {
    const total = counts.reduce((sum, value) => sum + value, 0);
    if (!(total > 0)) return counts.map(() => 0);
    const exact = counts.map((value) => (value / total) * 100);
    const shares = exact.map(Math.floor);
    let left = 100 - shares.reduce((sum, value) => sum + value, 0);
    const order = exact
      .map((value, index) => ({ index, rest: value - Math.floor(value) }))
      .sort((a, b) => b.rest - a.rest || a.index - b.index);
    for (const { index } of order) {
      if (left <= 0) break;
      shares[index] += 1;
      left -= 1;
    }
    return shares;
  };

  // One prompt, as its summary says it.
  const readSummary = (id) => {
    const { entry: overview } = overviewOf(id);
    const tests = testsFor(id);
    // Without the overview (a store before round 7) the control's own reading answers.
    const data = overview ? null : readControl(id);
    if (!data && !overview) return null;
    const name = firstText(overview?.name, data?.name, id);
    const inUse = {
      label: firstText(overview?.version?.label, data?.inUse?.label, SYSTEM_DEFAULT),
      id: firstText(overview?.version?.id, data?.inUse?.id),
    };
    // The second pill: the newest version past the one in use while it is being tested, on
    // trial, did not pass, or was rolled back, in the control's words.
    // The store's own (promptsOverview().latest, round 7) when it gives one, else from the tests.
    let latest = null;
    if (overview && 'latest' in overview) {
      const given = isObject(overview.latest) ? overview.latest : null;
      const stage = given ? text(given.lifecycle).replace('-', '_') : '';
      latest =
        given && SUMMARY_STATES.has(stage)
          ? {
              label: firstText(given.label, `Version ${count(given.n)}`),
              lifecycle: stage,
              words: firstText(
                given.lifecycleLabel,
                stage === 'canary' && numberOf(given.sharePct) != null
                  ? `Trying on ${count(given.sharePct)}% of runs`
                  : LIFECYCLE_WORDS[stage],
              ),
            }
          : null;
    } else if (overview) latest = latestFromTests(id, tests, inUse.id);
    if (data) {
      // Only a version newer than the one in use (before it in the lineup, which is newest first).
      const running = data.test?.status === 'running' ? data.test.versionId : '';
      const inUseAt = data.entries.indexOf(data.inUse);
      const newer = data.entries.filter(
        (item, index) => !item.inUse && (inUseAt < 0 || index < inUseAt),
      );
      const candidate =
        newer.find((item) => item.id === running) ??
        newer.find((item) => SUMMARY_STATES.has(item.lifecycle));
      if (candidate) {
        const stage = candidate.id === running ? 'testing' : candidate.lifecycle;
        const share = stage === 'canary' ? shareOf(candidate.canary, data.rollout) : null;
        latest = {
          label: candidate.label,
          lifecycle: stage,
          words:
            stage === 'canary'
              ? `Trying on ${share == null ? 'a share' : `${count(share)}%`} of runs`
              : stage === 'testing'
                ? LIFECYCLE_WORDS.testing
                : firstText(candidate.lifecycleLabel, LIFECYCLE_WORDS[stage]),
        };
      }
    }
    // The trend: promptTests() (the same points every trend draws), else the overview's.
    let points = tests ? trendPoints(tests) : [];
    if (!points.length && Array.isArray(overview?.trend)) {
      points = overview.trend.filter(isObject).map((point) => ({
        id: text(point.versionId),
        label: firstText(point.label && `Version ${count(point.n)}`, point.label),
        short: firstText(point.label, point.n ? `v${count(point.n)}` : ''),
        score: point.score ?? null,
        result: ['failed', 'testing'].includes(point.status) ? point.status : 'passed',
        inUse: text(point.versionId) === inUse.id,
        trial: point.status === 'trial' || point.status === 'canary',
        date: point.at ? formatDay(point.at) : '',
      }));
    }
    const minimum =
      numberOf(tests?.minAgreementPct) ??
      numberOf(overview?.minAgreementPct) ??
      numberOf(data?.rollout?.minAgreementPct) ??
      numberOf(ask('rolloutSettings', id)?.minAgreementPct);
    // The version in use (R9-5), said in the Kept by you figure's tip: "Version 3, in use since
    // Oct 2: 88% of 2 runs".
    const used = (data?.metrics ?? metricsOf(id))?.versions?.get(inUse.id) ?? null;
    const versionPct = numberOf(overview?.keptPct) ?? used?.agreement ?? null;
    const versionRuns = numberOf(overview?.keptRuns) ?? (used?.runs > 0 ? used.runs : null);
    const since = overview?.version?.since
      ? formatDay(overview.version.since, { weekday: false })
      : '';
    // T7-6: never a percentage without its runs.
    // T7-R2: the version's runs say their window (the store's, "since Sat, Jul 4"), so a count
    // larger than the 30 days' is never unexplained.
    const runsSince = text((data?.metrics ?? metricsOf(id))?.window);
    const versionWords =
      versionPct == null || !versionRuns
        ? ''
        : `${inUse.label}${since ? `, in use since ${since}` : ', in use'}: ${count(versionPct)}% of ${plural(versionRuns, 'run', 'runs')}${runsSince ? ` ${runsSince}` : ''}.`;
    // The store's own figures for the window when it has them (one formula, from exact counts:
    // T5-3), else the same sums from usage().
    const storedNumber = (key) => {
      const words = metricWords(key);
      const n = Number(String(words).replace(/[^\d.]/g, ''));
      return words && Number.isFinite(n) ? n : null;
    };
    // promptsOverview().last30 first (ST's one formula: kept over decided, whole decisions, the
    // runs Usage counts for the range), then the metric keys, then the same sums from usage().
    const last30 = isObject(overview?.last30) ? overview.last30 : null;
    const storedKept = numberOf(last30?.keptPct) ?? storedNumber(`prompts.${id}.kept.30d`);
    const storedRuns = numberOf(last30?.runs) ?? storedNumber(`prompts.${id}.runs.30d`);
    const storedDecided = numberOf(last30?.decided) ?? storedRuns;
    const storedTokens = numberOf(last30?.tokens) ?? storedNumber(`prompts.${id}.tokens.30d`);
    // The window's figures, from usage(); without it the store's own fields (round 6 stores).
    const window30 = summaryWindow();
    const mine = window30?.tasks.get(id) ?? null;
    const runs30 = storedRuns ?? (window30 ? (mine?.calls ?? 0) : null);
    const keptPct30 =
      storedKept ??
      (mine && mine.decided > 0 ? Math.round((mine.kept / mine.decided) * 100) : null);
    const tokens30 =
      storedTokens ?? (window30 ? (mine?.tokens ?? 0) : numberOf(overview?.tokensMonth));
    const includedOnly = Boolean(mine?.included && mine.calls > 0);
    const share =
      window30 && window30.all > 0 && tokens30 != null && !includedOnly
        ? tokens30 / window30.all
        : null;
    const ranked = mine
      ? [...mine.models.values()]
          .filter((model) => model.calls > 0)
          .sort((a, b) => b.calls - a.calls || a.label.localeCompare(b.label))
      : [];
    const shares = wholeShares(ranked.map((model) => model.calls));
    const mix = ranked.map((model, index) => ({
      ...model,
      pct: shares[index],
      tone: window30?.tones.get(model.id) ?? 'quiet',
    }));
    return {
      id,
      name,
      inUse,
      latest,
      points,
      minimum,
      runs: runs30,
      kept: {
        pct: window30 || storedKept != null ? keptPct30 : versionPct,
        decided: storedDecided ?? (window30 ? (mine?.decided ?? 0) : versionRuns),
        version: versionWords,
        metric: `prompts.${id}.kept.30d`,
        runsMetric: `prompts.${id}.runs.30d`,
        // The store's own words for the 30 days, naming which versions ran them ("75% of 4 runs in
        // the last 30 days, all on the system default"), so they never read as contradicting the
        // version's own count.
        text: text(last30?.text),
      },
      tokens:
        tokens30 == null
          ? null
          : {
              value: tokens30,
              metric: `prompts.${id}.tokens.30d`,
              share,
              included: includedOnly ? window30.includedText : '',
            },
      mix,
      href: `./prompts-preview.html?prompt=${encodeURIComponent(id)}`,
    };
  };

  const pillHtml = (label, lifecycle, words) =>
    `<span class="prompt-summary-pill"><span class="prompt-summary-label">${esc(label)}</span> <span class="status-pill prompt-summary-state" data-lifecycle="${esc(lifecycle)}">${esc(words)}</span></span>`;
  const NO_RUNS = 'No runs';

  // A summary as a row of a table of prompts (in a group, the column names once at its top), or
  // a card: the same parts in every size (round 7, T6-3): the name (the link to its prompt, the
  // one Tab stop of the summary), the versions, the trend with its key (a group's once) and its
  // scores in words for screen readers, the window ("Last 30 days"), Kept by you, Tokens, and Ran
  // on. The name's link (its chevron, "open in Prompts" for screen readers) is the one way to open
  // it (T1-11). On the Prompts page itself the name is plain words.
  // A row narrower than 560px folds to one line (Kept by you, tokens, the top model) with a
  // Details button; the trend and the figures open under it.
  const summaryIds = new WeakMap();
  let summaryCount = 0;
  const summaryHtml = (host, summary, grouped) => {
    const size = SUMMARY_SIZES.includes(host.getAttribute?.('data-prompt-size'))
      ? host.getAttribute('data-prompt-size')
      : 'row';
    if (!summaryIds.has(host)) {
      summaryCount += 1;
      summaryIds.set(host, `ps-${summary.id}-${summaryCount}`);
    }
    const uid = summaryIds.get(host);
    const level = Number(host.getAttribute?.('data-prompt-heading')) || 0;
    const keyed = host.getAttribute?.('data-prompt-metric') !== 'off';
    const linked = !onPromptsPage();
    const nameWords = linked
      ? `<a class="prompt-summary-link" href="${esc(summary.href)}" data-return-link data-focus-key="prompt-summary-open-${esc(summary.id)}" aria-describedby="${uid}-opens">${esc(summary.name)}<span class="prompt-summary-chevron" aria-hidden="true"></span></a>`
      : esc(summary.name);
    const nameHtml =
      level >= 2 && level <= 6
        ? `<h${level} class="prompt-summary-name">${nameWords}</h${level}>`
        : `<p class="prompt-summary-name">${nameWords}</p>`;
    const version = [pillHtml(summary.inUse.label, 'live', LIFECYCLE_WORDS.live)];
    if (summary.latest) {
      version.push(pillHtml(summary.latest.label, summary.latest.lifecycle, summary.latest.words));
    }
    // A figure carries its metric key only when the store has that key with these words.
    const figure = (key, words, extra = '') => {
      const stored = keyed && key ? metricWords(key) : '';
      const metric = stored && stored === words ? ` data-metric="${esc(key)}"` : '';
      return `<span class="prompt-summary-figure"${metric}${extra}>${esc(words)}</span>`;
    };
    const keyedCount = (key, n) => {
      const stored = keyed && key ? metricWords(key) : '';
      return stored && stored === count(n)
        ? `<span data-metric="${esc(key)}">${esc(count(n))}</span>`
        : esc(count(n));
    };
    const empty = `<span class="prompt-summary-empty">${NO_RUNS}</span>`;
    const idle = summary.runs === 0;
    // Kept by you over the window; both windows in its tip (T4-12), and in words for readers.
    const keptPct = summary.kept.pct;
    const windowWords =
      keptPct == null
        ? ''
        : summary.kept.text
          ? `${upperFirst(summary.kept.text)}.`
          : `${SUMMARY_WINDOW}, every version: ${count(keptPct)}%${summary.kept.decided ? ` of ${plural(summary.kept.decided, 'run', 'runs')}` : ''}.`;
    const keptTipWords = [windowWords, summary.kept.version].filter(Boolean).join(' ');
    const keptTip = keptTipWords
      ? ` data-tip-title="${esc(MEASURES.agreement.name)}" data-tip="${esc(keptTipWords)}"`
      : '';
    const kept =
      idle || keptPct == null
        ? idle
          ? empty
          : '<span class="prompt-summary-empty">No decisions yet</span>'
        : `${figure(summary.kept.metric, `${count(keptPct)}%`, keptTip)}${summary.kept.decided ? `<span class="prompt-summary-of">of ${keyedCount(summary.kept.runsMetric, summary.kept.decided)} ${summary.kept.decided === 1 ? 'run' : 'runs'}</span>` : ''}${summary.kept.version ? `<span class="sr-only">. ${esc(summary.kept.version)}</span>` : ''}`;
    // Tokens, with the bar of their share of every prompt's tokens.
    const share = summary.tokens?.share;
    const tokens =
      idle || !(summary.tokens?.value > 0)
        ? empty
        : `${figure(summary.tokens.metric, count(summary.tokens.value))}${
            summary.tokens.included
              ? `<span class="prompt-summary-of">${esc(summary.tokens.included)}</span>`
              : share == null
                ? ''
                : `<span class="prompt-summary-burn" aria-hidden="true"><span class="prompt-summary-burn-fill" style="--share: ${Math.max(0, Math.min(1, share)).toFixed(3)}"></span></span><span class="prompt-summary-of">${count(Math.round(share * 100))}% of all prompts’ tokens</span>`
          }`;
    // The model mix: a small stacked bar (every model in its tip on hover; in words for readers)
    // and the top two models by name, then "+N" (T6-7).
    const mix = Array.isArray(summary.mix) ? summary.mix : [];
    const mixWords = mix.map((model) => `${model.label} ${count(model.pct)}%`).join(', ');
    const models =
      idle || !mix.length
        ? empty
        : `<span class="stack-bar prompt-summary-mix" aria-hidden="true" data-tip-title="Ran on" data-tip="${esc(mixWords)}.">${mix
            .map(
              (model) =>
                `<span class="stack-bar-seg" data-tone="${esc(model.tone)}" style="--share: ${(model.pct / 100).toFixed(3)}"></span>`,
            )
            .join('')}</span><span class="prompt-summary-top">${mix
            .slice(0, 2)
            // Each model's name and share stay whole (T3-26: "claude-" / "haiku-4-5" broke).
            .map(
              (model) =>
                `<span class="prompt-summary-model">${esc(`${model.label} ${count(model.pct)}%`)}</span>`,
            )
            .join(', ')}${
            mix.length > 2
              ? `<span class="prompt-summary-of"> +${count(mix.length - 2)}</span><span class="sr-only">: ${esc(
                  mix
                    .slice(2)
                    .map((model) => `${model.label} ${count(model.pct)}%`)
                    .join(', '),
                )}</span>`
              : ''
          }</span>`;
    const label = (words) => `<dt>${esc(words)}</dt>`;
    // One way to open it, the same in every size (T6-3, T1-11): the name's link and its chevron,
    // focusable, named, and keyed, so Back returns focus to it. Where it goes is its description
    // (T4-26), so the heading's own words stay the prompt's name.
    const go = linked ? `<span id="${uid}-opens" hidden>Opens in Settings, Prompts</span>` : '';
    // data-prompt-window="off" (SP's request 12): a page that names the window once for its
    // summaries leaves out each one's own line.
    const windowLine =
      (grouped && size === 'row') || host.getAttribute?.('data-prompt-window') === 'off'
        ? ''
        : `<p class="prompt-summary-window">${SUMMARY_WINDOW}</p>`;
    // The folded row's one line (phones), and its Details button; data-prompt-fold="off" (SP's
    // request 12: Prompts has its own Details a row) leaves both out, the row drawn whole.
    const foldable = host.getAttribute?.('data-prompt-fold') !== 'off';
    const line =
      size === 'row' && foldable
        ? `<p class="prompt-summary-line">${
            idle
              ? NO_RUNS
              : [
                  keptPct == null ? '' : `${count(keptPct)}% kept`,
                  summary.tokens?.value > 0 ? `${count(summary.tokens.value)} tokens` : '',
                  mix[0] ? `${mix[0].label} ${count(mix[0].pct)}%` : '',
                ]
                  .filter(Boolean)
                  // Each part keeps to one line ("gpt-5-mini 60%" never breaks at its hyphen).
                  .map((part) => `<span class="prompt-summary-bit">${esc(part)}</span>`)
                  .join(' · ')
          }${
            grouped
              ? `<span class="sr-only">, ${esc(SUMMARY_WINDOW.toLowerCase())}</span>`
              : ` · <span class="prompt-summary-bit prompt-summary-line-window">${esc(SUMMARY_WINDOW)}</span>`
          }</p><button type="button" class="compact-action prompt-summary-fold" aria-expanded="${host.hasAttribute?.('data-prompt-unfolded') ? 'true' : 'false'}" aria-controls="${uid}-more" data-pc-key="fold">Details<span class="sr-only"> of ${esc(summary.name)}</span></button>`
        : '';
    return {
      size,
      html: `<div class="prompt-summary-body"><div class="prompt-summary-head">${nameHtml}<p class="prompt-summary-version">${version.join(' ')}</p></div>${line}<div class="prompt-summary-more" id="${uid}-more"><div class="prompt-summary-trend"><div class="prompt-summary-plot" data-ps-trend data-morph-keep></div>${summary.points.length ? `<p class="sr-only" id="${uid}-scores">${esc(trendWords(summary))}</p>` : ''}</div>${windowLine}<dl class="prompt-summary-figures"><div class="prompt-summary-part prompt-summary-kept">${label(MEASURES.agreement.name)}<dd>${kept}</dd></div><div class="prompt-summary-part prompt-summary-tokens">${label('Tokens')}<dd>${tokens}</dd></div><div class="prompt-summary-part prompt-summary-models">${label('Ran on')}<dd>${models}</dd></div></dl></div>${go}</div>`,
    };
  };

  // The column names of a group of rows, once at its top (and the window over the usage
  // columns), on the same tracks as the rows.
  const groupHeadHtml = () =>
    `<span class="prompt-summary-col" data-col="head">Prompt</span><span class="prompt-summary-col" data-col="trend">${MEASURES.test.name} by version</span><span class="prompt-summary-col-window">${SUMMARY_WINDOW}</span><span class="prompt-summary-col" data-col="kept">${MEASURES.agreement.name}</span><span class="prompt-summary-col" data-col="tokens">Tokens</span><span class="prompt-summary-col" data-col="models">Ran on</span>`;

  // The trend's scores in words for screen readers (T4-2): the plot itself is a picture.
  const RESULT_WORDS = { passed: 'passed', failed: 'did not pass', testing: 'testing now' };
  const trendWords = (summary) =>
    `${MEASURES.test.name} by version: ${summary.points
      .map(
        (point) =>
          `${point.short || point.label} ${point.score == null ? 'testing now' : `${count(point.score)}%, ${point.trial ? 'on trial' : (RESULT_WORDS[point.result] ?? 'passed')}`}${point.inUse ? ', in use' : ''}`,
      )
      .join('; ')}${summary.minimum == null ? '' : `; minimum ${count(summary.minimum)}%`}.`;

  const drawSummaryTrend = (host, summary, size, grouped) => {
    const draw = window.JobDeputyComponents?.scoreTrend;
    const slot = host.querySelector?.('[data-ps-trend]');
    if (!slot || typeof draw !== 'function') return;
    if (!summary.points.length) {
      slot.innerHTML = '<p class="prompt-summary-empty">Not tested yet.</p>';
      return;
    }
    // A lone summary draws its own key and Show the numbers; a group draws them once (T6-3).
    draw(slot, {
      title: `${MEASURES.test.name} by version, ${summary.name}`,
      caption: false,
      minimum: summary.minimum,
      size: size === 'card' ? 'compact' : 'row',
      points: summary.points,
      key: !grouped,
      numbers: !grouped,
      empty: 'Not tested yet.',
    });
    // The trend's figure is described by its scores in words (T4-2), the text beside it.
    const words = host.querySelector?.('.prompt-summary-trend > p.sr-only[id]');
    const figure = slot.querySelector?.('figure.score-trend');
    if (words && figure) figure.setAttribute('aria-describedby', words.getAttribute('id'));
  };

  // A group is two or more summaries; one alone draws everything itself (T5-23).
  const isGroup = (group) =>
    typeof group?.querySelectorAll === 'function' &&
    group.querySelectorAll('[data-prompt-summary]').length > 1;

  // The group's one key, every mark its rows show.
  const drawGroupHead = (group) => {
    if (typeof group?.querySelector !== 'function') return;
    const rows = [...group.querySelectorAll('[data-prompt-summary][data-prompt-size="row"]')];
    let head = [...group.children].find((child) =>
      child.classList?.contains('prompt-summary-columns'),
    );
    if (!rows.length || !isGroup(group)) {
      head?.remove();
      return;
    }
    if (!head) {
      head = document.createElement(
        group.tagName === 'UL' || group.tagName === 'OL' ? 'li' : 'div',
      );
      head.className = 'prompt-summary-columns';
      head.setAttribute('aria-hidden', 'true');
      group.prepend(head);
    }
    group.toggleAttribute?.('data-prompt-home', onPromptsPage());
    const markup = `<div class="prompt-summary-columns-row">${groupHeadHtml()}</div>`;
    if (head.innerHTML !== markup) head.innerHTML = markup;
    // Measured once the whole group is in (T3-5: one layout for every row, not one each), still
    // before the page paints.
    const align = () => alignGroupHead(group, head, rows[0]);
    if (typeof queueMicrotask === 'function') queueMicrotask(align);
    else align();
    if (!headWatch.has(group) && typeof ResizeObserver === 'function') {
      const watch = new ResizeObserver(() => {
        const first = group.querySelector('[data-prompt-summary][data-prompt-size="row"]');
        const now = [...group.children].find((child) =>
          child.classList?.contains('prompt-summary-columns'),
        );
        if (first && now) alignGroupHead(group, now, first);
      });
      watch.observe(group);
      headWatch.set(group, watch);
    }
  };

  // The column names sit on the rows' own tracks: where a page holds each summary beside its own
  // control (Prompts' Details), the names take the summary's inset; they show only while the rows
  // are a table (880px and wider).
  const headWatch = new WeakMap();
  const alignGroupHead = (group, head, row) => {
    if (typeof row?.getBoundingClientRect !== 'function') return;
    const line = head.querySelector?.('.prompt-summary-columns-row');
    if (!line?.style) return;
    const rowBox = row.getBoundingClientRect();
    const headBox = head.getBoundingClientRect();
    if (!(rowBox.width > 0) || !(headBox.width > 0)) return;
    const start = Math.max(0, Math.round(rowBox.left - headBox.left));
    const end = Math.max(0, Math.round(headBox.right - rowBox.right));
    line.style.paddingInlineStart = start ? `${start}px` : '';
    line.style.paddingInlineEnd = end ? `${end}px` : '';
    group.toggleAttribute?.('data-prompt-columns', rowBox.width >= 880);
  };

  const drawGroupKey = (group) => {
    drawGroupHead(group);
    const draw = window.JobDeputyComponents?.scoreTrend?.key;
    if (typeof draw !== 'function' || typeof group?.querySelectorAll !== 'function') return;
    const hosts = [...group.querySelectorAll('[data-prompt-summary][data-prompt-ready]')];
    const points = hosts.flatMap((host) => summaryDrawn.get(host)?.summary.points ?? []);
    const minimums = new Set(
      hosts.map((host) => summaryDrawn.get(host)?.summary.minimum).filter((value) => value != null),
    );
    let slot = [...group.children].find((child) => child.classList?.contains('prompt-summary-key'));
    if (!points.length || !isGroup(group)) {
      slot?.remove();
      return;
    }
    if (!slot) {
      slot = document.createElement(
        group.tagName === 'UL' || group.tagName === 'OL' ? 'li' : 'div',
      );
      slot.className = 'prompt-summary-key';
      group.append(slot);
    }
    draw(slot, {
      title: `${MEASURES.test.name} by version`,
      results: [...new Set(points.map((point) => point.result))],
      inUse: points.some((point) => point.inUse),
      trial: points.some((point) => point.trial),
      minimum: minimums.size === 1 ? [...minimums][0] : null,
    });
    // And one Show the numbers for the group: a row a tested version (T6-3).
    const numbers = window.JobDeputyComponents?.scoreTrend?.numbers;
    if (typeof numbers === 'function') {
      numbers(slot, {
        title: `${MEASURES.test.name} by version`,
        rows: hosts.flatMap((host) => {
          const summary = summaryDrawn.get(host)?.summary;
          if (!summary?.points) return [];
          return summary.points.map((point) => ({
            prompt: summary.name,
            href: summary.href,
            version: point.label,
            date: point.date,
            score: point.score,
            result: point.result,
            state: point.inUse ? 'In use' : point.trial ? 'On trial' : '',
          }));
        }),
      });
    }
  };

  // A folded row (phones) opens and closes in place; the host keeps the state across redraws.
  if (typeof document.addEventListener === 'function') {
    document.addEventListener('click', (event) => {
      const button = isElement(event.target) ? event.target.closest('.prompt-summary-fold') : null;
      const host = button?.closest('[data-prompt-summary]');
      if (!host) return;
      const open = !host.hasAttribute('data-prompt-unfolded');
      host.toggleAttribute('data-prompt-unfolded', open);
      button.setAttribute('aria-expanded', String(open));
    });
  }

  const renderSummary = (host) => {
    const id = text(host.getAttribute?.('data-prompt-summary'));
    const summary = taskIds().includes(id) ? readSummary(id) : null;
    host.classList?.add('prompt-summary');
    if (!summary) {
      const missing = '<p class="prompt-summary-missing">This prompt isn’t available here.</p>';
      if (summaryDrawn.get(host)?.html !== missing) host.innerHTML = missing;
      summaryDrawn.set(host, { html: missing, summary: { points: [] } });
      return false;
    }
    // A group of one is a lone row (T5-23): it says its own window, key, and numbers.
    const grouped = isGroup(host.closest?.('[data-prompt-summaries]'));
    const { size, html } = summaryHtml(host, summary, grouped);
    const signature = JSON.stringify([html, summary.points, summary.minimum, grouped]);
    host.setAttribute('data-prompt-size', size);
    if (grouped) host.setAttribute('data-prompt-grouped', '');
    else host.removeAttribute?.('data-prompt-grouped');
    host.setAttribute('data-lifecycle', summary.latest?.lifecycle ?? 'live');
    if (onPromptsPage()) host.setAttribute('data-prompt-home', '');
    else host.removeAttribute?.('data-prompt-home');
    host.setAttribute('data-prompt-ready', '');
    const before = summaryDrawn.get(host);
    if (before?.signature === signature) return false;
    const key = focusKey(host);
    // In place where it can (T3-19, DB's request 13): a store tick sets the new figures in the
    // same elements, so the name's link and Details keep focus; the trend is drawn again only
    // when its points change.
    const morph = window.JobDeputyComponents?.morph;
    const trendKey = JSON.stringify([summary.points, summary.minimum, size, grouped]);
    let morphed = false;
    let kept = false;
    if (before && typeof morph === 'function' && typeof document.createElement === 'function') {
      const template = document.createElement('template');
      if ('content' in template && host.children) {
        template.innerHTML = html;
        kept = morph(host, [...template.content.children]) === true;
        morphed = true;
      }
    }
    if (!morphed) host.innerHTML = html;
    // A new shape swaps the elements in whole, its trend slot empty: drawn again then too.
    if (!kept || before?.trendKey !== trendKey) drawSummaryTrend(host, summary, size, grouped);
    summaryDrawn.set(host, { signature, html, summary, trendKey });
    if (key && !host.contains?.(document.activeElement)) {
      host.querySelector?.(`[data-pc-key="${key}"]`)?.focus({ preventScroll: true });
    }
    return true;
  };

  // Draws every summary in the scope now (the page's first render may call it), and the keys of
  // their groups. Returns the hosts drawn.
  const drawPromptSummaries = (scope = document) => {
    if (typeof scope?.querySelectorAll !== 'function') return [];
    const hosts = [
      ...(scope.matches?.('[data-prompt-summary]') ? [scope] : []),
      ...scope.querySelectorAll('[data-prompt-summary]'),
    ];
    const groups = new Set();
    for (const host of hosts) {
      renderSummary(host);
      const group = host.closest?.('[data-prompt-summaries]');
      if (group) groups.add(group);
    }
    if (typeof scope.querySelectorAll === 'function') {
      for (const group of scope.querySelectorAll('[data-prompt-summaries]')) groups.add(group);
    }
    for (const group of groups) drawGroupKey(group);
    return hosts;
  };

  let summaryObserver = null;
  const startSummaries = () => {
    drawPromptSummaries(document);
    if (summaryObserver || typeof MutationObserver !== 'function' || !document.body) return;
    summaryObserver = new MutationObserver((records) => {
      const added = new Set();
      for (const record of records) {
        if (record.target?.closest?.('.prompt-summary')) continue;
        for (const node of record.addedNodes) {
          if (!isElement(node)) continue;
          if (
            node.matches?.('[data-prompt-summary]') ||
            node.querySelector?.('[data-prompt-summary]')
          )
            added.add(node);
        }
      }
      for (const node of added) drawPromptSummaries(node);
    });
    summaryObserver.observe(document.body, { childList: true, subtree: true });
  };

  // ---------------------------------------------------------------- the buy dialog and checkout

  // Round 5 (brief 3.5, R5-1): what the Shop sells and what it costs come only from the store:
  // shopItems() for the packs and bundles, their prices, and the tokens a credit pack buys on the
  // account's platform model; PRICING for the sample note and the tax line;
  // requiresAgreement('buy') for the gate; and buy(itemId), which adds what was bought at once and
  // charges nothing. Without them the dialog says buying isn't available here.
  const BUY_KINDS = Object.freeze({ credits: 'credits', ai: 'credits', nightly: 'nightly' });
  const kindOf = (kind) => BUY_KINDS[kind] ?? 'nightly';
  const SHOP_PAGE = 'shop-preview.html';
  // The Shop's own section for each kind of item, and for what you bought (round 5 anchors).
  const SHOP_SECTIONS = Object.freeze({
    credits: 'credits',
    nightly: 'nightly',
    bundle: 'bundles',
    purchases: 'purchases',
  });
  const shopHref = (section) => `./${SHOP_PAGE}#${section}`;
  const pageFile = () =>
    String(window.location?.pathname ?? '')
      .split('/')
      .pop() ?? '';
  // On the Shop itself a link to the Shop would lead back to the page that is already open.
  const onShopPage = () => pageFile() === SHOP_PAGE;
  const fromStore = (name, ...args) => {
    if (!has(name)) return null;
    try {
      return store()[name](...args) ?? null;
    } catch {
      return null;
    }
  };

  // The words of a pack, a checkout, and a receipt, from JobDeputyStore.TERMS when it has them.
  const TERM_DEFAULTS = Object.freeze({
    credits: 'AI credits',
    tokens: 'tokens',
    watch: 'Keep watch',
    nightlyRun: 'nightly run',
    nightlyRuns: 'nightly runs',
  });
  const term = (name) => {
    const terms = store()?.TERMS;
    return firstText(terms && typeof terms === 'object' ? terms[name] : '', TERM_DEFAULTS[name]);
  };
  const runsWord = (n) => (n === 1 ? term('nightlyRun') : term('nightlyRuns'));
  const SAMPLE_NOTE = 'Sample prices · nothing is charged';
  const noteOf = (items) => firstText(items?.note, store()?.PRICING?.note, SAMPLE_NOTE);
  // PRICING.tax ("Tax is added at checkout, based on your billing address.") as a receipt row:
  // "Tax: Added at checkout, based on your billing address."
  const taxOf = (items) => {
    const tax = firstText(items?.tax, store()?.PRICING?.tax).trim();
    const rest = /^tax is (.+)$/i.exec(tax)?.[1];
    return rest ? `${rest.charAt(0).toUpperCase()}${rest.slice(1)}` : tax || 'Added at checkout.';
  };
  // Tokens as the store writes them (R5-2: "339,100", "22.7 million").
  const tokensText = (value) => {
    const shared = store()?.format?.tokens;
    if (typeof shared === 'function') {
      const shown = shared(value);
      if (shown) return shown;
    }
    return count(value);
  };
  const lowerFirst = (value) => `${value.charAt(0).toLowerCase()}${value.slice(1)}`;

  const listOf = (items, kind) =>
    Array.isArray(items?.[kind]) ? items[kind].filter((item) => item?.id) : [];
  const itemFor = (items, id) =>
    [...listOf(items, 'credits'), ...listOf(items, 'nightly'), ...listOf(items, 'bundles')].find(
      (item) => item.id === id,
    ) ?? null;
  const perNightOf = (allowance) => finite(allowance?.nightly?.perNight) ?? 0;

  // "15 more nights at 2 runs a night": the store counts a pack's nights at today's runs a night.
  // What a run pack lasts through at your settings, in the chooser's words (round 7, T5-2): every
  // use is a run now, so the store's runway for the pack (runs.ifBuy), never Keep watch's nights.
  // A store before round 7 keeps the nights.
  const nightsText = (item, perNight) => {
    const runway = isObject(item?.runway) ? item.runway : null;
    if (runway?.coversMonth) return 'covers the rest of the month at your settings';
    if (runway?.lastsThrough) {
      const day =
        metricWords(text(runway.metric)) ||
        formatDay(runway.lastsThrough) ||
        text(runway.lastsThrough);
      return `lasts through ${day} at your settings`;
    }
    const nights = finite(item?.nights);
    if (!nights || perNight <= 0) return '';
    return `${plural(nights, 'more night', 'more nights')} at ${plural(perNight, 'run', 'runs')} a night`;
  };

  // A pack as a choice card: what it buys and its price, then where the tokens go or the nights
  // the runs cover.
  const packCard = (item, perNight) =>
    item.kind === 'credits'
      ? {
          label: `${text(item.tokensText)} ${term('tokens')} for ${text(item.priceText)}`,
          meta: `${term('credits')} on ${text(item.model)}`,
        }
      : {
          label: `${text(item.label)} for ${text(item.priceText)}`,
          meta: upperFirst(nightsText(item, perNight)),
        };

  const packMarkup = (kind, list, perNight) =>
    [
      `<legend class="field-label">How many ${esc(kind === 'credits' ? term('tokens') : term('nightlyRuns'))}?</legend>`,
      ...list.map((item) => {
        const card = packCard(item, perNight);
        return `<label class="choice-card"><input type="radio" name="item" value="${esc(item.id)}" /><span class="choice-card-control" aria-hidden="true"></span><span class="choice-card-copy"><span class="choice-card-label">${esc(card.label)}</span>${card.meta ? `<span class="choice-card-meta">${esc(card.meta)}</span>` : ''}</span></label>`;
      }),
    ].join('');

  // Where you stand, for the opening line: the tokens left on your platform model, or (R9-1, T1-R3)
  // the ring's own figure, every run you can still use this month out of free plus bought, the
  // split when anything was bought, and the day they last through.
  const standing = (kind, credits, allowance) => {
    if (kind === 'credits') {
      if (finite(credits?.left) == null) return '';
      const model = firstText(credits.model?.name);
      return `You have ${tokensText(credits.left)} ${term('tokens')} of ${term('credits')} left${model ? ` on ${model}` : ''}.`;
    }
    const nightly = allowance?.nightly;
    if (!nightly || finite(nightly.limit) == null) return '';
    const left = finite(nightly.left) ?? finite(nightly.freeLeft);
    if (left == null) return '';
    const bought = finite(nightly.bought) ?? finite(nightly.topups) ?? 0;
    const all = finite(nightly.limit) + bought;
    const split = bought > 0 ? `: ${count(nightly.limit)} free, ${count(bought)} bought` : '';
    const through = nightly.lastsThrough
      ? ` They last through ${formatDay(nightly.lastsThrough)}.`
      : '';
    return `${count(left)} of ${count(all)} ${term('nightlyRuns')} left this month${split}.${through}`;
  };

  // Titled for what you buy (round 7, T2-6): runs are every use's now, not Keep watch's.
  const chooseTitle = (kind) =>
    kind === 'credits' ? `Buy ${term('credits')}` : `Buy ${term('nightlyRuns')}`;

  // The order, as a receipt: what it adds, a bundle's list price and saving, the price, and tax.
  const addsOf = (item, perNight) => {
    const adds = [];
    if (finite(item.tokens) > 0) {
      adds.push(
        `${text(item.tokensText)} ${term('tokens')} of ${term('credits')} on ${text(item.model)}`,
      );
    }
    if (finite(item.nightlyRuns) > 0) {
      const nights = nightsText(item, perNight);
      adds.push(
        `${count(item.nightlyRuns)} ${runsWord(item.nightlyRuns)}${nights ? `: ${nights}` : ''}`,
      );
    }
    return adds;
  };
  const summaryRows = (item, items, perNight) => {
    const rows = [['What it adds', addsOf(item, perNight)]];
    if (item.kind === 'bundle') {
      rows.push(['List price', [text(item.listPriceText)]]);
      rows.push([
        'You save',
        [`${text(item.savingsText)}: ${count(item.discountPct)}% off the ${term('nightlyRuns')}`],
      ]);
    }
    rows.push(['Price', [text(item.priceText)]]);
    rows.push(['Tax', [taxOf(items)]]);
    return rows.filter(([, values]) => values.some(Boolean));
  };
  const summaryMarkup = (rows) =>
    rows
      .map(
        ([label, values]) =>
          `<div><dt>${esc(label)}</dt><dd>${values
            .filter(Boolean)
            .map((value) => `<span>${esc(value)}</span>`)
            .join('')}</dd></div>`,
      )
      .join('');

  // Back here after signing (A4's agreement page accepts any *-preview.html page in this folder):
  // this page with its own query, less the one-time triggers, plus ?checkout=<item id> so the
  // checkout opens again, and the item's section on the Shop or this page's own anchor elsewhere.
  // The Dashboard keeps ?skipLoader, so its opening loader never replays on the way back.
  const ONE_TIME = new Set(['checkout', 'prompt', 'tour', 'signin']);
  const returnFor = (item) => {
    const own = pageFile();
    const file = /^[a-z][a-z0-9-]*-preview\.html$/i.test(own) ? own : 'home-preview.html';
    const parts = String(window.location?.search ?? '')
      .replace(/^\?/, '')
      .split('&')
      .filter((part) => part && !ONE_TIME.has(part.split('=')[0]));
    if (
      file === 'home-preview.html' &&
      !parts.some((part) => part.split('=')[0] === 'skipLoader')
    ) {
      parts.unshift('skipLoader');
    }
    parts.push(`checkout=${encodeURIComponent(item.id)}`);
    const hash =
      file === SHOP_PAGE
        ? `#${SHOP_SECTIONS[item.kind] ?? SHOP_SECTIONS.credits}`
        : String(window.location?.hash ?? '');
    return `${file}?${parts.join('&')}${hash}`;
  };
  const signHref = (gate, item) => {
    const base = firstText(gate?.href, './agreement-preview.html?mode=update');
    return `${base}${base.includes('?') ? '&' : '?'}return=${encodeURIComponent(returnFor(item))}`;
  };
  const gateMessage = (gate) =>
    `${gate.version ? `Version ${gate.version}` : 'The updated agreement'} covers ${lowerFirst(firstText(gate.label, 'Buying AI credits and runs'))}. Sign it, and you come back here to finish.`;

  // What was added, said once: the title, where your balance stands now, and the deputy's line.
  const doneWords = (item, result) => {
    const credits = result?.credits;
    const nightly = result?.allowance?.nightly;
    const tokens =
      finite(credits?.left) != null
        ? `You have ${tokensText(credits.left)} ${term('tokens')}${credits.model?.name ? ` on ${credits.model.name}` : ''} now.`
        : '';
    const through = nightly?.lastsThrough
      ? `Your ${term('nightlyRuns')} now last through ${formatDay(nightly.lastsThrough)}.`
      : '';
    const message = (...parts) => [...parts, 'Nothing was charged.'].filter(Boolean).join(' ');
    if (item.kind === 'credits') {
      return {
        title: `${text(item.tokensText)} ${term('tokens')} added.`,
        message: message(tokens),
        speech: 'I have more credits now.',
      };
    }
    if (item.kind === 'nightly') {
      return {
        title: `${count(item.nightlyRuns)} ${runsWord(item.nightlyRuns)} added.`,
        message: message(through),
        speech: 'I can keep watch longer.',
      };
    }
    return {
      title: `${text(item.label)} added.`,
      message: message(tokens, through),
      speech: 'I have credits and nights now.',
    };
  };

  // The deputy celebrates a purchase once (R3-8); without react() it flashes success.
  const cheer = (speech) => {
    const companion = deputy();
    if (typeof companion?.react === 'function') companion.react('celebrate', { speech });
    else companion?.flash?.('success', { speech });
  };

  const TOPUP_MARKUP = `
    <div class="drawer-header">
      <p class="eyebrow" id="topup-drawer-eyebrow">Purchases</p>
      <h2 class="drawer-title" id="topup-drawer-title">Buy AI credits</h2>
      <p class="drawer-meta" id="topup-drawer-now"></p>
      <button class="compact-action drawer-close" type="button" data-drawer-close>Close</button>
    </div>
    <div class="drawer-body">
      <form class="topup-form" id="topup-drawer-form" novalidate>
        <fieldset class="choice-cards" id="topup-drawer-packs" aria-describedby="topup-drawer-note"></fieldset>
        <p class="feedback-error" id="topup-drawer-error" hidden>Choose a pack to continue.</p>
        <dl class="prompt-facts topup-summary" id="topup-drawer-summary" hidden></dl>
        <div class="feedback-panel" data-kind="warning" id="topup-drawer-gate" hidden>
          <span class="feedback-panel-icon" aria-hidden="true">!</span>
          <span class="feedback-panel-copy"><strong class="feedback-panel-title" id="topup-drawer-gate-title">Sign the updated agreement first.</strong><span class="feedback-panel-message" id="topup-drawer-gate-message"></span></span>
        </div>
        <p class="sample-note" id="topup-drawer-note">${SAMPLE_NOTE}</p>
        <a class="chart-action" id="topup-drawer-shop" href="./shop-preview.html#credits">See everything in Purchases</a>
      </form>
      <div class="feedback-panel" data-kind="error" id="topup-drawer-failed" hidden>
        <span class="feedback-panel-icon" aria-hidden="true">!</span>
        <span class="feedback-panel-copy"><strong class="feedback-panel-title" id="topup-drawer-failed-title">We couldn’t add that.</strong><span class="feedback-panel-message" id="topup-drawer-failed-message">Try again, or choose a pack in Purchases.</span></span>
      </div>
      <div class="feedback-panel" data-kind="notice" id="topup-drawer-missing" hidden>
        <span class="feedback-panel-icon" aria-hidden="true">i</span>
        <span class="feedback-panel-copy"><strong class="feedback-panel-title">Buying isn’t available here.</strong><span class="feedback-panel-message">Reload the page and try again.</span></span>
      </div>
      <div class="feedback-panel topup-done has-action" data-kind="success" id="topup-drawer-done" hidden>
        <span class="feedback-panel-icon" aria-hidden="true">✓</span>
        <span class="feedback-panel-copy"><strong class="feedback-panel-title" id="topup-drawer-done-title"></strong><span class="feedback-panel-message" id="topup-drawer-done-message"></span></span>
        <a class="feedback-panel-action" id="topup-drawer-purchases" href="./shop-preview.html#purchases">See your purchases</a>
      </div>
    </div>
    <div class="drawer-footer topup-actions">
      <button class="primary-action" type="submit" form="topup-drawer-form" data-topup-continue>Continue</button>
      <button class="primary-action" type="button" data-topup-buy hidden>Add to my sample account</button>
      <a class="primary-action" href="./agreement-preview.html?mode=update" data-topup-sign hidden>Review and sign</a>
      <button class="secondary-action" type="button" data-topup-back hidden>Back</button>
      <button class="secondary-action" type="button" data-drawer-close data-topup-cancel>Cancel</button>
      <button class="primary-action" type="button" data-drawer-close data-topup-done hidden>Done</button>
    </div>
    <p class="sr-only" id="topup-drawer-status" role="status" aria-live="polite"></p>`;

  let topupDialog = null;
  let topupKind = 'credits';
  // 'choose' (the packs), 'checkout' (the order), or 'done' (what was added).
  let topupView = 'choose';
  let topupItem = null;
  let topupGate = null;
  // 'choose' when Continue opened the checkout, so Back returns to the packs.
  let topupFrom = null;
  let topupBought = false;
  const announceTopup = announcer();
  const topupPart = (selector) => topupDialog.querySelector(selector);
  const radios = () => [...topupDialog.querySelectorAll('input[name="item"]')];
  const say = (message) => announceTopup(topupPart('#topup-drawer-status'), message);
  const show = (selector, on) => {
    topupPart(selector).hidden = !on;
  };

  const showTopupError = (on) => {
    show('#topup-drawer-error', on);
    topupPart('#topup-drawer-packs').setAttribute(
      'aria-describedby',
      on ? 'topup-drawer-error topup-drawer-note' : 'topup-drawer-note',
    );
  };

  // The dialog's three views share its parts; each shows only its own.
  const setView = (view) => {
    topupView = view;
    const gated = view === 'checkout' && Boolean(topupGate);
    show('#topup-drawer-form', view !== 'done');
    show('#topup-drawer-packs', view === 'choose');
    if (view !== 'choose') showTopupError(false);
    show('#topup-drawer-summary', view === 'checkout');
    show('#topup-drawer-gate', gated);
    show('#topup-drawer-done', view === 'done');
    show('#topup-drawer-failed', false);
    show('[data-topup-continue]', view === 'choose');
    show('[data-topup-buy]', view === 'checkout' && !gated);
    show('[data-topup-sign]', gated);
    show('[data-topup-back]', view === 'checkout' && topupFrom === 'choose');
    show('[data-topup-cancel]', view !== 'done');
    show('[data-topup-done]', view === 'done');
    topupPart('#topup-drawer-eyebrow').textContent = view === 'choose' ? 'Purchases' : 'Checkout';
    topupDialog.scrollTop = 0;
  };

  const fillShopLink = (section) => {
    const shop = topupPart('#topup-drawer-shop');
    shop.setAttribute('href', shopHref(section));
    shop.hidden = onShopPage();
  };

  // The packs of one kind, as cards; the radio that was chosen stays chosen when they are drawn
  // again (another tab bought something or changed the model).
  const fillChoose = (kind) => {
    topupKind = kind;
    const items = fromStore('shopItems');
    const allowance = fromStore('allowance');
    const list = listOf(items, kind);
    const chosen = radios().find((input) => input.checked)?.value;
    topupPart('#topup-drawer-title').textContent = chooseTitle(kind);
    const now = topupPart('#topup-drawer-now');
    now.textContent = standing(kind, fromStore('credits'), allowance);
    now.hidden = !now.textContent;
    topupPart('#topup-drawer-packs').innerHTML = packMarkup(kind, list, perNightOf(allowance));
    if (chosen) {
      for (const input of radios()) input.checked = input.value === chosen;
    }
    topupPart('#topup-drawer-note').textContent = noteOf(items);
    fillShopLink(SHOP_SECTIONS[kind]);
    const ready = list.length > 0 && has('buy');
    show('#topup-drawer-missing', !ready);
    topupPart('[data-topup-continue]').disabled = !ready;
  };

  // The order for one item, with the agreement gate while the current version isn't signed.
  const fillCheckout = (item) => {
    topupItem = item;
    const items = fromStore('shopItems');
    topupGate = fromStore('requiresAgreement', 'buy');
    topupPart('#topup-drawer-title').textContent = text(item.label);
    show('#topup-drawer-now', false);
    topupPart('#topup-drawer-summary').innerHTML = summaryMarkup(
      summaryRows(item, items, perNightOf(fromStore('allowance'))),
    );
    topupPart('#topup-drawer-note').textContent = noteOf(items);
    fillShopLink(SHOP_SECTIONS[item.kind] ?? SHOP_SECTIONS.credits);
    if (topupGate) {
      topupPart('#topup-drawer-gate-message').textContent = gateMessage(topupGate);
      topupPart('[data-topup-sign]').setAttribute('href', signHref(topupGate, item));
    }
    show('#topup-drawer-missing', !has('buy'));
    topupPart('[data-topup-buy]').disabled = !has('buy');
  };

  const checkoutWords = (item) => {
    const adds = addsOf(item, perNightOf(fromStore('allowance')));
    return `Checkout for ${text(item.label)}, ${text(item.priceText)}${adds.length ? `: ${adds.join(' and ')}` : ''}.${topupGate ? ' Sign the updated agreement first.' : ''} Nothing is charged.`;
  };

  // The checkout's own next step takes focus: Add to my sample account, or Review and sign. It
  // sits in the sticky footer, so focusing it never scrolls the order out of view (preventScroll).
  const focusCheckout = () =>
    topupPart(topupGate ? '[data-topup-sign]' : '[data-topup-buy]').focus({ preventScroll: true });

  const toCheckout = (item, from) => {
    topupFrom = from;
    fillCheckout(item);
    setView('checkout');
    focusCheckout();
    say(checkoutWords(item));
  };

  // ?checkout= has done its work once the checkout opens, so the address drops it when the
  // dialog closes or the purchase is made: a reload shows the page, and the rest of the address
  // stays as written.
  const dropCheckoutParam = () => {
    try {
      const { pathname, search, hash } = window.location;
      if (!/(?:^|[?&])checkout=/.test(String(search ?? ''))) return;
      const kept = String(search)
        .slice(1)
        .split('&')
        .filter((part) => part && part.split('=')[0] !== 'checkout');
      window.history.replaceState(
        window.history.state,
        '',
        `${pathname}${kept.length ? `?${kept.join('&')}` : ''}${hash ?? ''}`,
      );
    } catch {
      // The address keeps the parameter; a reload opens the checkout again.
    }
  };

  const failed = (message) => {
    topupPart('#topup-drawer-failed-message').textContent = message;
    show('#topup-drawer-failed', true);
    say(`We couldn’t add that. ${message}`);
  };

  const continueToCheckout = () => {
    const chosen = radios().find((input) => input.checked);
    if (!chosen) {
      showTopupError(true);
      radios()[0]?.focus();
      say('Choose a pack to continue.');
      return;
    }
    const item = itemFor(fromStore('shopItems'), chosen.value);
    if (!item) {
      failed('That pack isn’t in Purchases now. Choose another one.');
      return;
    }
    toCheckout(item, 'choose');
  };

  const buyChosen = () => {
    if (!topupItem || !has('buy')) return;
    const result = fromStore('buy', topupItem.id);
    if (result?.ok) {
      topupBought = true;
      const words = doneWords(topupItem, result);
      topupPart('#topup-drawer-done-title').textContent = words.title;
      topupPart('#topup-drawer-done-message').textContent = words.message;
      const purchases = topupPart('#topup-drawer-purchases');
      purchases.setAttribute('href', shopHref(SHOP_SECTIONS.purchases));
      purchases.hidden = onShopPage();
      setView('done');
      topupPart('[data-topup-done]').focus({ preventScroll: true });
      say(`${words.title} ${words.message}`);
      cheer(words.speech);
      dropCheckoutParam();
      return;
    }
    if (result?.reason === 'agreement-required') {
      // The agreement changed since the checkout opened: ask for it here, then come back.
      fillCheckout(topupItem);
      setView('checkout');
      focusCheckout();
      say('Sign the updated agreement first, then come back to finish. Nothing was added.');
      return;
    }
    failed('Try again, or choose a pack in Purchases.');
    deputy()?.react?.('error');
  };

  const back = () => {
    const was = topupItem?.id;
    topupItem = null;
    topupGate = null;
    topupFrom = null;
    fillChoose(topupKind);
    for (const input of radios()) input.checked = input.value === was;
    setView('choose');
    (
      radios().find((input) => input.checked) ??
      radios()[0] ??
      topupPart('[data-drawer-close]')
    ).focus();
  };

  const renderTopup = () => {
    if (topupDialog) return topupDialog;
    topupDialog = createDrawer(
      'topup-drawer',
      'topup-drawer',
      TOPUP_MARKUP,
      'topup-drawer-title',
      'topup-drawer-note',
    );
    topupPart('#topup-drawer-form').addEventListener('submit', (event) => {
      event.preventDefault();
      if (topupView === 'choose') continueToCheckout();
    });
    topupPart('#topup-drawer-form').addEventListener('change', (event) => {
      if (event.target?.name === 'item') {
        showTopupError(false);
        show('#topup-drawer-failed', false);
      }
    });
    topupPart('[data-topup-buy]').addEventListener('click', buyChosen);
    topupPart('[data-topup-back]').addEventListener('click', back);
    topupDialog.addEventListener('close', () => {
      if (!topupBought) release();
      dropCheckoutParam();
      // Focus never falls to the page (T5-4): where the opener went with a purchase (a To-do row
      // the purchase settles) and nothing took its key, the page's own Get more runs (or Buy)
      // for that kind takes it.
      const active = document.activeElement;
      const lost = !active || active === document.body || topupDialog.contains(active);
      if (!lost) return;
      const again = topupItem ? openerOnPage(topupItem.id) : null;
      const kind = topupKind === 'nightly' ? 'nightly' : 'credits';
      const fallback =
        again ??
        (typeof document.querySelector === 'function'
          ? document.querySelector(`main [data-topup-open="${kind}"]`)
          : null);
      fallback?.focus?.();
    });
    // Another tab signed the agreement, bought something, or changed the model: the open view
    // follows, and focus stays on a control that is still there.
    if (has('subscribe')) {
      store().subscribe(() => {
        if (!topupDialog?.open) return;
        if (topupView === 'choose') {
          fillChoose(topupKind);
          return;
        }
        if (topupView !== 'checkout' || !topupItem) return;
        const item = itemFor(fromStore('shopItems'), topupItem.id);
        if (!item) return;
        const gated = Boolean(topupGate);
        fillCheckout(item);
        setView('checkout');
        if (gated !== Boolean(topupGate)) focusCheckout();
      });
    }
    return topupDialog;
  };

  // Buying has one home (round 7, R10-3 and T2-6): off Purchases a buy trigger goes to its part of
  // Purchases (runs to #buy, AI credits to #credits) with return=, so Back comes here; the dialog
  // is Purchases' own step.
  const BUY_SECTIONS = Object.freeze({ nightly: 'buy', credits: 'credits' });
  const buyHome = (kind) => {
    const target = shopHref(BUY_SECTIONS[kindOf(kind)] ?? 'buy');
    const place = window.JobDeputyComponents?.place;
    if (typeof place?.href !== 'function') return target;
    place.save?.();
    return place.href(target);
  };
  const openTopup = (kind, { opener = null } = {}) => {
    if (!onShopPage()) {
      const href = buyHome(kind);
      if (typeof window.location?.assign === 'function') window.location.assign(href);
      else if (window.location) window.location.href = href;
      return null;
    }
    renderTopup();
    if (topupDialog.open) return topupDialog;
    topupBought = false;
    topupItem = null;
    topupGate = null;
    topupFrom = null;
    for (const input of radios()) input.checked = false;
    fillChoose(kindOf(kind));
    for (const input of radios()) input.checked = false;
    setView('choose');
    topupPart('#topup-drawer-status').textContent = '';
    openDrawer(topupDialog, opener instanceof HTMLElement ? opener : document.activeElement);
    // Focus starts on the first pack, so the arrow keys choose at once.
    (radios()[0] ?? topupPart('[data-drawer-close]')).focus();
    listen();
    return topupDialog;
  };

  // The sample checkout for one item, straight away (the Shop's Buy buttons, ?checkout=). An item
  // the Shop no longer has opens the credit packs with a notice instead.
  const checkout = (itemId, { opener = null } = {}) => {
    renderTopup();
    if (topupDialog.open) return topupDialog;
    topupBought = false;
    const item = itemFor(fromStore('shopItems'), String(itemId ?? ''));
    topupPart('#topup-drawer-status').textContent = '';
    if (item) {
      topupKind = item.kind === 'nightly' ? 'nightly' : 'credits';
      topupFrom = null;
      fillCheckout(item);
      setView('checkout');
    } else {
      topupItem = null;
      topupGate = null;
      topupFrom = null;
      fillChoose('credits');
      for (const input of radios()) input.checked = false;
      setView('choose');
      topupPart('#topup-drawer-failed-message').textContent =
        'That pack isn’t in Purchases now. Choose one here.';
      show('#topup-drawer-failed', true);
    }
    openDrawer(topupDialog, opener instanceof HTMLElement ? opener : document.activeElement);
    if (item) focusCheckout();
    else (radios()[0] ?? topupPart('[data-drawer-close]')).focus();
    listen();
    if (item) say(checkoutWords(item));
    return topupDialog;
  };

  // The control a ?checkout= link came back to: the item's own Buy button, else its kind's buy
  // action, so focus returns there when the checkout closes.
  const openerOnPage = (itemId) => {
    if (typeof document.querySelector !== 'function' || !/^[a-z0-9-]+$/i.test(itemId)) return null;
    const kind = itemFor(fromStore('shopItems'), itemId)?.kind;
    return (
      document.querySelector(`[data-checkout="${itemId}"]`) ??
      (kind === 'nightly'
        ? document.querySelector('[data-topup-open="nightly"]')
        : document.querySelector('[data-topup-open="credits"], [data-topup-open="ai"]'))
    );
  };

  // ---------------------------------------------------------------- triggers

  // A trigger inside the account menu closes the menu; focus later returns to its chip, which
  // stays visible.
  const openerFor = (trigger) => {
    const menu = trigger.closest('details.account-menu');
    if (!menu) return trigger;
    menu.open = false;
    return menu.querySelector('summary') ?? trigger;
  };

  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    // A summary's own data-prompt-open="off" (no Open in Prompts) is an option, not a trigger.
    const prompt = target?.closest('[data-prompt-open]:not([data-prompt-open="off"])');
    const topup = target?.closest('[data-topup-open]');
    const item = target?.closest('[data-checkout]');
    const trigger = prompt ?? topup ?? item;
    if (!trigger) return;
    event.preventDefault();
    const opener = openerFor(trigger);
    if (prompt) openPrompt(prompt.getAttribute('data-prompt-open'), { opener });
    else if (topup) openTopup(topup.getAttribute('data-topup-open'), { opener });
    else checkout(item.getAttribute('data-checkout'), { opener });
  });

  window.JobDeputyPanels = Object.freeze({
    openPrompt,
    openTopup,
    checkout,
    TASKS,
    keepFocusClear,
    // Round 7 (R10-5): the prompt summaries, drawn now (a page's first render may call it), and
    // the task a ?prompt= value names (its aliases included), for the Prompts page.
    drawPromptSummaries,
    promptFor: (value) => promptFor(value),
  });

  // ?prompt= takes a task id or a name people use (T4-4): score-fit, or any prompt's visible name
  // as a slug (score-fit-and-give-reasons, tailor-the-resume), in any case.
  const PROMPT_ALIASES = Object.freeze({ 'score-fit': 'rank' });
  const slugOf = (value) =>
    text(value)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  const promptFor = (requested) => {
    const wanted = slugOf(requested);
    const ids = taskIds();
    if (!wanted) return '';
    if (ids.includes(wanted)) return wanted;
    if (ids.includes(PROMPT_ALIASES[wanted])) return PROMPT_ALIASES[wanted];
    return ids.find((id) => slugOf(ask('prompt', id)?.name) === wanted) ?? '';
  };
  // A ?prompt= that names no prompt (R9-2): the page as usual, and one calm notice in the shared
  // FeedbackPanel's notice style under the page's intro (and its Settings tabs), said once. Its
  // words never send you to the page you are on.
  const promptMissing = () => {
    if (typeof document.querySelector !== 'function') return;
    const shell = document.querySelector('main .page-shell') ?? document.querySelector('main');
    if (!shell || shell.querySelector('[data-prompt-missing]')) return;
    const here = onPromptsPage();
    const title = here
      ? 'That prompt isn’t one of your deputy’s, so here are all your prompts.'
      : 'That prompt isn’t one of your deputy’s.';
    const action = here
      ? ''
      : '<a class="feedback-panel-action" href="./prompts-preview.html">See your prompts</a>';
    const markup = `<div class="feedback-panel page-link-notice${action ? ' has-action' : ''}" data-kind="notice" data-prompt-missing><span class="feedback-panel-icon" aria-hidden="true">i</span><span class="feedback-panel-copy"><strong class="feedback-panel-title">${esc(title)}</strong></span>${action}</div>`;
    const anchor =
      shell.querySelector(':scope > .settings-tabs') ?? shell.querySelector(':scope > .page-intro');
    if (anchor) anchor.insertAdjacentHTML('afterend', markup);
    else shell.insertAdjacentHTML('afterbegin', markup);
    window.JobDeputyComponents?.announce?.(
      here ? title : `${title} Settings, Prompts lists every one.`,
    );
  };

  // The prompt summaries in the markup are drawn as this script runs, so the page's first render
  // (its own script comes next) already has them (R10-1).
  if (document.body) startSummaries();

  // Render once the body exists, and open ?prompt=<task id> or ?checkout=<item id> (the way back
  // from signing the agreement) after the page's own script has run.
  const start = () => {
    renderPrompt();
    renderTopup();
    startControls();
    startSummaries();
    if (has('subscribe')) store().subscribe((_state, change) => onStoreChange(change));
    const parameters = new URLSearchParams(window.location.search);
    const requested = parameters.get('prompt');
    const wanted = parameters.get('checkout');
    const asked = requested ? promptFor(requested) : '';
    if (requested && !asked) promptMissing();
    if (asked && !onPromptsPage()) {
      // An old ?prompt= link on another page lands on the prompt's home, with the way back here.
      parameters.delete('prompt');
      const here = parameters.toString();
      const back = `./${pageFile()}${here ? `?${here}` : ''}${text(window.location?.hash)}`;
      const home = new URLSearchParams({ prompt: asked, return: back });
      const target = `./prompts-preview.html?${home.toString()}`;
      if (typeof window.location?.replace === 'function') window.location.replace(target);
    } else if (asked) openPrompt(asked);
    else if (wanted && itemFor(fromStore('shopItems'), wanted)) {
      checkout(wanted, { opener: openerOnPage(wanted) });
      // Chrome clears focus when it scrolls to the address's #anchor, just before the load
      // event, so the checkout's next step takes focus again once the page has loaded.
      if (document.readyState !== 'complete' && typeof window.addEventListener === 'function') {
        window.addEventListener(
          'load',
          () => {
            if (topupDialog?.open && topupView === 'checkout') {
              if (!topupDialog.contains(document.activeElement)) focusCheckout();
            }
          },
          { once: true },
        );
      }
    }
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
