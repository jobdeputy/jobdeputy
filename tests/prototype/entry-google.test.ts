import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Page guarantees for the two entry experiences (brand/login-preview.html and
// brand/access-preview.html): first time (Create account by email, Google, or LinkedIn) signs the
// User Agreement (agreement-preview.html?mode=new) and then goes to setup; returning (Sign in by
// email, Google, LinkedIn, or one tap) goes straight to the Dashboard. Google and LinkedIn are
// simulated by small JobDeputy dialogs, and no Google or LinkedIn request is made. The rendered
// flows are checked in headless Chrome; these static guards keep the contract from drifting.

const brandDirectory = resolve(import.meta.dirname, '../../brand');
const sourceFor = (file: string): string => readFileSync(resolve(brandDirectory, file), 'utf8');

const login = sourceFor('login-preview.html');
const access = sourceFor('access-preview.html');
const agreement = sourceFor('agreement-preview.html');

const compact = (value: string): string => value.replace(/\s+/g, '');

const inlineScript = (source: string): string =>
  [...source.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1] ?? '').join('\n');

// A top-level arrow function, from `const name =` to its closing `};`.
function arrowFunction(source: string, name: string): string {
  const start = source.indexOf(`const ${name} = `);
  expect(start, `${name} must exist`).toBeGreaterThanOrEqual(0);
  const end = source.indexOf('\n      };\n', start);
  return source.slice(start, end + '\n      };'.length);
}

// The text from a start marker through its end marker; the start must appear exactly once.
function block(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  expect(from, `${start} must exist`).toBeGreaterThanOrEqual(0);
  expect(source.indexOf(start, from + start.length), `${start} must appear once`).toBe(-1);
  const to = source.indexOf(end, from);
  expect(to, `${end} must follow ${start}`).toBeGreaterThan(from);
  return source.slice(from, to + end.length);
}

const chooserMarkup = (source: string): string =>
  block(source, '<!-- Google chooser: start', '<!-- Google chooser: end -->');
const chooserScript = (source: string): string =>
  block(source, '// Google chooser script: start', '// Google chooser script: end');
const googleStyles = (source: string): string =>
  block(source, '/* Google entry styles: start', '/* Google entry styles: end */');
const linkedinEntry = (source: string): string =>
  block(source, '<!-- LinkedIn entry: start', '<!-- LinkedIn entry: end -->');
const linkedinChooser = (source: string): string =>
  block(source, '<!-- LinkedIn chooser: start', '<!-- LinkedIn chooser: end -->');
const linkedinScript = (source: string): string =>
  block(source, '// LinkedIn chooser script: start', '// LinkedIn chooser script: end');
const linkedinStyles = (source: string): string =>
  block(source, '/* LinkedIn entry styles: start', '/* LinkedIn entry styles: end */');
// The provider label: "Continue with" stays in the accessible name when a narrow row hides it.
const socialLabel = (provider: string): string =>
  `<span class="social-label"><span class="social-prefix">Continue with </span>${provider}</span>`;

const loginScript = inlineScript(login);
const accessScript = inlineScript(access);

describe('the simulated Google account chooser', () => {
  it('shares one chooser, its styles, and its script on both entry routes', () => {
    expect(chooserMarkup(access)).toBe(chooserMarkup(login));
    expect(chooserScript(access)).toBe(chooserScript(login));
    expect(googleStyles(access)).toBe(googleStyles(login));
  });

  it('is a small JobDeputy dialog with the sample account, another account, and the sample note', () => {
    const markup = chooserMarkup(login);
    // Round 6 (G3): the chooser also says which Region it signs in to, so its description names
    // that line before the sample note.
    expect(markup).toMatch(
      /<dialog\s+class="account-chooser"\s+id="account-chooser"\s+aria-labelledby="chooser-title"\s+aria-describedby="chooser-region-text chooser-note"\s*>/,
    );
    expect(compact(markup)).toContain(
      compact(
        '<h2 class="chooser-title" id="chooser-title">Choose an account to continue to JobDeputy</h2>',
      ),
    );
    expect(markup).toContain('data-chooser-account="alex"');
    expect(markup).toContain('<span class="chooser-account-name">Alex Morgan</span>');
    expect(markup).toContain('<span class="chooser-account-email">alex.morgan@example.com</span>');
    expect(markup).toContain('data-chooser-account="other"');
    expect(markup).toContain('<span class="chooser-account-name">Use another account</span>');
    expect(markup).toContain(
      '<p class="chooser-note" id="chooser-note">Prototype · no Google request is made</p>',
    );
    expect(markup).toContain('<button class="chooser-cancel" id="chooser-cancel" type="button">');
    // Never a copy of Google's interface: no Google pages, fonts, or images beyond its own G.
    expect(markup).not.toMatch(/https?:|google\.com|googleapis|gstatic/i);
    expect(googleStyles(login)).not.toMatch(/https?:|@import|url\(/);
  });

  it('opens modally, closes with Cancel or the backdrop, and hands the choice to the page', () => {
    const code = chooserScript(login);
    expect(code).toContain('accountChooser.showModal();');
    expect(code).toMatch(/event\.target === accountChooser\) \{[\s\S]*?accountChooser\.close\(\);/);
    expect(code).toMatch(
      /chooserCancel\.addEventListener\('click', \(\) => \{\s*accountChooser\.close\(\);/,
    );
    expect(code).toContain('choose?.(account.dataset.chooserAccount);');
    // The dialog itself has no padding, so a click on it is a click on the backdrop.
    expect(compact(googleStyles(login))).toMatch(/\.account-chooser\{[^}]*padding:0;/);
    // Phones get a bottom sheet clear of the home indicator.
    expect(compact(googleStyles(login))).toContain(
      compact('padding-bottom: max(21px, env(safe-area-inset-bottom));'),
    );
  });

  it('remembers the sample account after every sign-in, and a new account only once it signs', () => {
    // Sign in keeps the remembered account; the shared chooser never writes it.
    expect(loginScript).toContain("const lastAccountKey = 'jobdeputy.lastAccount';");
    expect(loginScript).toContain(
      "const sampleAccount = { name: 'Alex Morgan', email: 'alex.morgan@example.com' };",
    );
    // Round 6 (G3): with the account's home Region, so one tap and the choosers know it.
    expect(compact(loginScript)).toContain(
      compact(
        'window.localStorage.setItem( lastAccountKey, JSON.stringify({ ...sampleAccount, method, region: accountRegion() }), );',
      ),
    );
    for (const shared of [chooserScript(login), linkedinScript(login)]) {
      expect(shared).not.toMatch(/localStorage|rememberAccount/);
    }
    // Sign in by email, Google, LinkedIn, and one tap.
    expect(loginScript.match(/rememberAccount\('email'\)/g)).toHaveLength(1);
    expect(loginScript.match(/rememberAccount\('google'\)/g)).toHaveLength(1);
    expect(loginScript.match(/rememberAccount\('linkedin'\)/g)).toHaveLength(1);
    expect(loginScript).toContain("rememberAccount(returningContinue.dataset.method ?? 'email');");
    expect(loginScript).toMatch(
      /returningContinue\.dataset\.method = \['google', 'linkedin'\]\.includes\(account\.method\)\s*\?\s*account\.method\s*:\s*'email';/,
    );
    // Create account remembers nothing: no account exists until the agreement is signed, so the
    // agreement page remembers it then (decision G1), and never another account (&new=1).
    expect(accessScript).not.toMatch(/rememberAccount|jobdeputy\.lastAccount/);
    expect(agreement).toMatch(
      /const rememberAccount = \(\) => \{\s*if \(mode !== 'new' \|\| isNew\) return;[\s\S]*?window\.localStorage\.setItem\(\s*'jobdeputy\.lastAccount',\s*JSON\.stringify\(\{ name, email, method: door \?\? 'email', region: homeRegion \?\? 'US' \}\),/,
    );
    // Round 7 (G3): remembered as the signing moment starts.
    expect(agreement).toMatch(/rememberAccount\(\);\s*playMoment\(entry\);/);
  });
});

describe('returning people: Sign in', () => {
  const google = arrowFunction(loginScript, 'continueWithGoogle');
  const handOff = arrowFunction(loginScript, 'handOff');

  it('takes a known Google account straight to the Dashboard after a short pending state', () => {
    expect(google).toContain('openAccountChooser((choice) => {');
    // Round 6 (G3): the account signs in only to its home Region; another Region chosen above
    // shows the calm notice first (inHomeRegion), and nothing happens until the person switches.
    expect(google).toMatch(
      /if \(choice === 'alex'\) \{\s*const signIn = \(\) => \{\s*rememberAccount\('google'\);\s*handOff\(\s*googleSignIn,\s*googleLabel,\s*pandaLines\.submit\.signIn\.pending,\s*'\.\/home-preview\.html\?skipLoader&signin=google',[\s\S]*?if \(inHomeRegion\(googleSignIn, signIn\)\) signIn\(\);/,
    );
    expect(google).toContain('setChooserRegion();');
    for (const part of [
      'isSubmitting = true;',
      "control.setAttribute('aria-busy', 'true');",
      'label.textContent = line;',
      "showPandaReaction('pending', line, line);",
      'announceFeedback(line);',
      'window.location.assign(new URL(destination, window.location.href).href);',
      'prefersReducedMotion ? 120 : 618,',
    ]) {
      expect(handOff, part).toContain(part);
    }
  });

  it('sends Use another account, a new Google account, to the agreement before setup', () => {
    // Round 6 (G3): with the Region chosen above, which the signed record keeps.
    expect(google).toMatch(
      /handOff\(\s*googleSignIn,\s*googleLabel,\s*pandaLines\.submit\.create\.pending,\s*withRegion\('\.\/agreement-preview\.html\?mode=new&via=google&new=1'\),/,
    );
    // Sign in never opens setup itself: a new account signs the agreement first.
    expect(loginScript).not.toContain("'./onboarding-preview.html");
  });

  it('offers one tap when this browser signed in before, and Not you? forgets it', () => {
    expect(compact(login)).toContain(
      compact('<div class="returning-card" id="returning-card" hidden>'),
    );
    expect(login).toContain(
      '<span class="returning-name" id="returning-name">Continue as Alex</span>',
    );
    expect(login).toContain(
      '<span class="returning-email" id="returning-email">alex.morgan@example.com</span>',
    );
    expect(login).toMatch(/class="returning-avatar"\s+src="\.\/profile-avatar\.svg"\s+alt=""/);
    expect(login).toMatch(
      /aria-label="Not you\? Forget this account on this browser"\s*>\s*Not you\?/,
    );
    // Round 6 (G3): the card follows the home Region, so the Region is chosen before every way in,
    // one tap included; it still comes before Continue with Google.
    expect(login.indexOf('id="returning-card"')).toBeGreaterThan(
      login.indexOf('id="region-field"'),
    );
    expect(login.indexOf('id="returning-card"')).toBeLessThan(login.indexOf('id="google-sign-in"'));
    const remembered = arrowFunction(loginScript, 'rememberedAccount');
    expect(remembered).toContain("if (returningRequest === '0') {");
    expect(remembered).toContain('window.localStorage.getItem(lastAccountKey)');
    expect(remembered).toContain(
      "return returningRequest === '1' ? { ...sampleAccount, method: 'google' } : null;",
    );
    expect(loginScript).toContain("const returningRequest = previewParameters.get('returning');");
    expect(loginScript).toMatch(
      /handOff\(\s*returningContinue,\s*returningName,\s*pandaLines\.submit\.signIn\.pending,\s*'\.\/home-preview\.html\?skipLoader&signin=onetap',/,
    );
    expect(loginScript).toContain('if (inHomeRegion(returningContinue, signIn)) signIn();');
    expect(loginScript).toMatch(
      // Round 6 (G3): forgetting the account also hands back its Region (the suggestion returns).
      /returningForget\.addEventListener\('click', \(\) => \{[\s\S]*?window\.localStorage\.removeItem\(lastAccountKey\);[\s\S]*?returningCard\.hidden = true;[\s\S]*?selectRegion\(suggestedRegionCode, suggestedRegionResult\.source\);[\s\S]*?loginTitle\.focus\(\);/,
    );
  });

  it('opens the Dashboard with its welcome-back note after an email sign-in', () => {
    expect(loginScript).toMatch(
      /rememberAccount\('email'\);\s*window\.setTimeout\(\(\) => \{[\s\S]*?'\.\/home-preview\.html\?skipLoader&signin=email'/,
    );
  });

  it('keeps the provider-unavailable notice reachable with ?google=unavailable', () => {
    expect(loginScript).toContain(
      "const googleUnavailable = previewParameters.get('google') === 'unavailable';",
    );
    expect(loginScript).toMatch(
      /if \(link === googleSignIn && !googleUnavailable\) \{\s*continueWithGoogle\(\);\s*return;\s*\}\s*if \(link === linkedinButton && !linkedinUnavailable\) \{\s*continueWithLinkedin\(\);\s*return;\s*\}\s*showContextualFeedback\(link\);/,
    );
    expect(login).toContain('data-feedback-title="Google sign-in isn’t available"');
    expect(login).toContain(
      'data-feedback-message="Use your JobDeputy email and password instead."',
    );
    expect(login).toContain(socialLabel('Google'));
  });

  it('restores the controls when Back returns from the Dashboard or setup (the page cache)', () => {
    const reset = arrowFunction(loginScript, 'resetTransientLoginState');
    expect(reset).toContain("googleSignIn.removeAttribute('aria-busy');");
    expect(reset).toContain('restoreGoogleLabel();');
    expect(reset).toContain('accountChooser.close();');
    expect(reset).toContain("linkedinButton.removeAttribute('aria-busy');");
    expect(reset).toContain('restoreLinkedinLabel();');
    expect(reset).toContain('linkedinChooser.close();');
    expect(reset).toContain('showRememberedAccount();');
    // A pending line replaces a label; the keeper puts "Continue with" back for screen readers.
    expect(loginScript).toContain('const restoreGoogleLabel = keepSocialLabel(googleLabel);');
    expect(loginScript).toContain(
      "const googleLabel = googleSignIn.querySelector('.social-label');",
    );
  });
});

describe('first-time people: Create account', () => {
  it('offers Continue with Google above the email form with the same button and divider', () => {
    const button = access.match(/<button\s+id="google-create"[\s\S]*?<\/button>/)?.[0] ?? '';
    expect(button).toContain('class="social-button create-only"');
    expect(button).toContain('type="button"');
    expect(button).toContain(socialLabel('Google'));
    // Google's own G, the same paths as on Sign in.
    const paths = (source: string): string[] =>
      [
        ...(source.match(/<svg\s+class="google-icon"[\s\S]*?<\/svg>/)?.[0] ?? '').matchAll(
          /d="([^"]+)"/g,
        ),
      ].map((match) => match[1] ?? '');
    expect(paths(button)).toEqual(paths(login));
    expect(access).toMatch(
      /<div class="auth-divider create-only">\s*<span>or create your account with email<\/span>/,
    );
    expect(access.indexOf('id="google-create"')).toBeLessThan(access.indexOf('id="email-field"'));
    // Only Create account shows it; the reset request and the new-password step do not.
    expect(compact(access)).toContain(
      compact('html:not([data-access-mode="create"]) .create-only { display: none; }'),
    );
  });

  it('takes a new Google account to the agreement, then setup, after a short pending state', () => {
    expect(accessScript).toContain('openAccountChooser((choice) => {');
    // Round 6 acceptance (G3): the account that already exists (Alex) gets the notice under the
    // Region instead; Use another account is new, so it signs the agreement, with the Region.
    expect(accessScript).toMatch(
      /openAccountChooser\(\(choice\) => \{\s*if \(choice === 'alex'\) \{\s*showExistingAccount\('Google'\);\s*return;\s*\}/,
    );
    expect(accessScript).toContain(
      "const destination = withRegion('./agreement-preview.html?mode=new&via=google&new=1');",
    );
    expect(accessScript).not.toContain("'./agreement-preview.html?mode=new&via=google'");
    // Account access never opens setup itself.
    expect(accessScript).not.toContain("'./onboarding-preview.html");
    expect(accessScript).toContain("googleCreate.setAttribute('aria-busy', 'true');");
    expect(accessScript).toContain('googleCreateLabel.textContent = taskLines.pending;');
    expect(accessScript).toContain(
      "showPandaReaction('pending', taskLines.pending, taskLines.pending);",
    );
    expect(accessScript).toContain('prefersReducedMotion ? 120 : 618,');
  });

  it('opens the agreement straight after Create account by email, as Google and LinkedIn do (D-8)', () => {
    // After the pending beat, the email door goes to the agreement with no extra step or click:
    // the three doors are the same (W1: each opens the agreement before setup). Like sign-in, the
    // success line shows for the 987ms hand-off first, so the panda's success pose matches.
    expect(accessScript).toMatch(
      /if \(mode === 'create'\) \{\s*submitButton\.removeAttribute\('aria-busy'\);\s*submitLabel\.textContent = taskLines\.success;\s*showPandaReaction\('success', sentence\(taskLines\.success\), pandaLines\.status\.complete\);\s*announce\(sentence\(taskLines\.success\)\);\s*window\.setTimeout\(\(\) => \{\s*window\.location\.assign\(\s*new URL\(withRegion\('\.\/agreement-preview\.html\?mode=new&via=email'\), window\.location\.href\)\s*\.href,\s*\);\s*\}, 987\);\s*return;\s*\}/,
    );
    expect(accessScript).not.toContain('Read the agreement');
    expect(accessScript).not.toContain('This prototype didn’t store these details.');
    // The reset request and the new password keep their success panels.
    expect(accessScript).toMatch(
      /mode === 'reset'\s*\?\s*'\.\/access-preview\.html\?mode=set&token=prototype&skipLoader'\s*:\s*'\.\/login-preview\.html\?skipLoader';/,
    );
    expect(accessScript).toContain(
      "mode === 'reset' ? 'Preview the reset link' : 'Continue to sign in';",
    );
    expect(accessScript).toContain(
      "create: { pending: 'One moment…', success: 'Next, your agreement' },",
    );
    expect(`${login}\n${access}`).not.toMatch(/Creating account|account setup is ready/);
    // The pending beat stays; the focused success panel stays for reset and set.
    expect(accessScript).toContain('submitLabel.textContent = taskLines.pending;');
    expect(accessScript).toContain('feedbackTitle.focus();');
  });

  it('keeps the provider-unavailable notice reachable with ?google=unavailable', () => {
    expect(accessScript).toContain(
      "const googleUnavailable = parameters.get('google') === 'unavailable';",
    );
    expect(accessScript).toMatch(/if \(googleUnavailable\) \{\s*googleFeedback\.hidden = false;/);
    expect(access).toMatch(/id="google-feedback-title"\s*>Google sign-in isn’t available<\/strong/);
    expect(access).toMatch(
      /id="google-feedback-message"\s*>Create your account with your email instead\.<\/span/,
    );
    expect(access).toMatch(/id="google-use-email" type="button">\s*Use email instead/);
  });

  it('adds no provider button to password recovery and makes no Google request', () => {
    // Both provider buttons in account access sit in the create-only pair, and nothing calls
    // Google; LinkedIn's entry also hides outside Create account by its own rule.
    expect(access.match(/class="[^"]*social-button[^"]*"/g)).toEqual([
      'class="social-button create-only"',
      'class="social-button"',
    ]);
    const pair = access.indexOf('<div class="social-pair create-only">');
    expect(pair).toBeGreaterThan(-1);
    expect(access.indexOf('id="google-create"')).toBeGreaterThan(pair);
    expect(access.indexOf('id="linkedin-continue"')).toBeGreaterThan(pair);
    expect(access.indexOf('id="linkedin-continue"')).toBeLessThan(
      access.indexOf('<div class="auth-divider create-only">'),
    );
    expect(compact(linkedinStyles(access))).toContain(
      compact(
        'html[data-access-mode]:not([data-access-mode="create"]) .linkedin-entry { display: none; }',
      ),
    );
    for (const source of [login, access]) {
      expect(source).not.toMatch(/accounts\.google|googleapis|gstatic|gsi\/client/i);
    }
  });
});

describe('Continue with LinkedIn', () => {
  it('shares one entry, one chooser, one script, and one style block on both entry routes', () => {
    expect(linkedinEntry(access)).toBe(linkedinEntry(login));
    expect(linkedinChooser(access)).toBe(linkedinChooser(login));
    expect(linkedinScript(access)).toBe(linkedinScript(login));
    expect(linkedinStyles(access)).toBe(linkedinStyles(login));
  });

  it('sits under Continue with Google, before the email divider, with the same button', () => {
    for (const [source, googleId, divider] of [
      [login, 'id="google-sign-in"', '<div class="auth-divider auth-divider-social">'],
      [access, 'id="google-create"', '<div class="auth-divider create-only">'],
    ] as const) {
      const linkedin = source.indexOf('id="linkedin-continue"');
      expect(linkedin).toBeGreaterThan(source.indexOf(googleId));
      expect(linkedin).toBeLessThan(source.indexOf(divider));
    }
    const entry = linkedinEntry(login);
    expect(entry).toMatch(
      /<button\s+id="linkedin-continue"\s+class="social-button"\s+type="button"/,
    );
    expect(entry).toContain(socialLabel('LinkedIn'));
    // The "in" mark keeps LinkedIn's blue, on the button and in the dialog.
    expect(entry).toContain('fill="#0a66c2"');
    expect(linkedinChooser(login)).toContain('fill="#0a66c2"');
    // The provider notice for ?linkedin=unavailable, beside its button, as Google's.
    expect(entry).toMatch(/id="linkedin-feedback"\s+data-kind="notice"\s+hidden/);
    expect(entry).toContain('data-feedback-title="LinkedIn sign-in isn’t available"');
    expect(entry).toContain(
      '<button class="feedback-panel-action" id="linkedin-use-email" type="button">',
    );
  });

  it('is a small JobDeputy dialog that says LinkedIn shares only the name, email, and photo', () => {
    const markup = linkedinChooser(login);
    expect(markup).toMatch(
      /<dialog\s+class="account-chooser linkedin-chooser"\s+id="linkedin-chooser"\s+aria-labelledby="linkedin-chooser-title"\s+aria-describedby="linkedin-chooser-shares linkedin-chooser-region-text linkedin-chooser-note"\s*>/,
    );
    expect(markup).toContain(
      '<h2 class="chooser-title" id="linkedin-chooser-title">Continue as Alex Morgan?</h2>',
    );
    expect(compact(markup)).toContain(
      compact(
        '<p class="chooser-shares" id="linkedin-chooser-shares"> LinkedIn shares your name, email, and photo with JobDeputy. Nothing else. </p>',
      ),
    );
    expect(markup).toContain('data-linkedin-account="alex"');
    expect(markup).toContain('<span class="chooser-account-email">alex.morgan@example.com</span>');
    expect(markup).toContain('data-linkedin-account="other"');
    expect(markup).toContain(
      '<p class="chooser-note" id="linkedin-chooser-note">Prototype · no LinkedIn request is made</p>',
    );
    expect(markup).toContain(
      '<button class="chooser-cancel" id="linkedin-chooser-cancel" type="button">Cancel</button>',
    );
    // Never a copy of LinkedIn's interface, and nothing loads from LinkedIn.
    for (const part of [
      markup,
      linkedinEntry(login),
      linkedinScript(login),
      linkedinStyles(login),
    ]) {
      expect(part).not.toMatch(/https?:|linkedin\.com|licdn|@import|url\(/i);
    }
  });

  it('opens modally, closes with Cancel or the backdrop, and hands the choice to the page', () => {
    const code = linkedinScript(login);
    expect(code).toContain('linkedinChooser.showModal();');
    expect(code).toMatch(
      /event\.target === linkedinChooser\) \{[\s\S]*?linkedinChooser\.close\(\);/,
    );
    expect(code).toMatch(
      /linkedinCancel\.addEventListener\('click', \(\) => \{\s*linkedinChooser\.close\(\);/,
    );
    expect(code).toContain('choose?.(account.dataset.linkedinAccount);');
    expect(code).toContain(
      "new URLSearchParams(window.location.search).get('linkedin') === 'unavailable';",
    );
  });

  it('signs a returning account in to the Dashboard and sends a new one to the agreement', () => {
    const flow = arrowFunction(loginScript, 'continueWithLinkedin');
    expect(flow).toMatch(
      /if \(choice === 'alex'\) \{\s*const signIn = \(\) => \{\s*rememberAccount\('linkedin'\);\s*handOff\(\s*linkedinButton,\s*linkedinLabel,\s*pandaLines\.submit\.signIn\.pending,\s*'\.\/home-preview\.html\?skipLoader&signin=linkedin',[\s\S]*?if \(inHomeRegion\(linkedinButton, signIn\)\) signIn\(\);/,
    );
    expect(flow).toMatch(
      /handOff\(\s*linkedinButton,\s*linkedinLabel,\s*pandaLines\.submit\.create\.pending,\s*withRegion\('\.\/agreement-preview\.html\?mode=new&via=linkedin&new=1'\),/,
    );
    // Create account: the account that already exists gets the notice; a new one signs the
    // agreement, then setup (round 6 acceptance, G3).
    expect(accessScript).toMatch(
      /openLinkedinChooser\(\(choice\) => \{\s*if \(choice === 'alex'\) \{\s*showExistingAccount\('LinkedIn'\);\s*return;\s*\}/,
    );
    expect(accessScript).toContain(
      "const destination = withRegion('./agreement-preview.html?mode=new&via=linkedin&new=1');",
    );
    expect(accessScript).toMatch(
      /if \(linkedinUnavailable\) \{\s*linkedinFeedback\.hidden = false;/,
    );
    expect(accessScript).toContain("linkedinButton.setAttribute('aria-busy', 'true');");
    expect(accessScript).toContain('linkedinLabel.textContent = taskLines.pending;');
    const reset = access.slice(access.indexOf('const resetTransientFormState = () => {'));
    expect(reset).toMatch(
      /restoreLinkedinLabel\(\);\s*hideLinkedinNotice\(\);\s*if \(linkedinChooser\.open\) \{/,
    );
  });

  it('shares one row with Google where height is scarce, keeping the full name for screen readers', () => {
    const css = compact(linkedinStyles(login));
    expect(css).toContain(
      compact('@media (max-width: 720px), (min-width: 881px) and (max-height: 800px) {'),
    );
    expect(css).toContain(
      compact('.social-pair { grid-template-columns: repeat(2, minmax(0, 1fr)); }'),
    );
    expect(css).toContain(compact('.social-pair .social-entry { display: contents; }'));
    expect(css).toContain(compact('.social-pair .feedback-panel { grid-column: 1 / -1; }'));
    // The prefix leaves the row visually only, so each button's name stays "Continue with ...".
    expect(css).toMatch(
      /\.social-prefix\{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect\(0,0,0,0\);/,
    );
  });
});

// Round 6, G3 (R6-7): Region first. On Sign in and Create account the home Region comes before
// every way in (one tap, Google, LinkedIn, and email) and applies to each; the Google and LinkedIn
// choosers say which Region they sign in to or create the account in; a returning account whose
// home Region is another one is caught with a calm notice before anything happens; a new account
// takes the Region to the agreement, whose signed record keeps it; Forgot password keeps its
// Region, and a Region you chose goes with you between the entry routes.
describe('Region first (round 6, G3)', () => {
  const order = (source: string, ids: string[]): number[] =>
    ids.map((id) => {
      const at = source.indexOf(id);
      expect(at, id).toBeGreaterThan(-1);
      return at;
    });

  it('puts the home Region above every sign-in method on both routes', () => {
    const signIn = order(login, [
      'id="region-field"',
      'id="region-mismatch"',
      'id="returning-card"',
      'id="google-sign-in"',
      'id="linkedin-continue"',
      '<div class="auth-divider auth-divider-social">',
      'id="email-field"',
      'id="submit-button"',
    ]);
    expect([...signIn].sort((a, b) => a - b)).toEqual(signIn);
    const create = order(access, [
      'id="region-field"',
      'id="google-create"',
      'id="linkedin-continue"',
      '<div class="auth-divider create-only">',
      'id="email-field"',
      'id="submit-button"',
    ]);
    expect([...create].sort((a, b) => a - b)).toEqual(create);
    // Both are inside their form, so the form's feedback and locking still cover them.
    expect(login.indexOf('id="region-field"')).toBeGreaterThan(login.indexOf('id="login-form"'));
    expect(access.indexOf('id="region-field"')).toBeGreaterThan(access.indexOf('id="access-form"'));
    // Forgot password keeps its Region (the request-only field), first here too.
    expect(access).toMatch(/<fieldset\s+class="region-field request-only"\s+id="region-field"/);
  });

  it('names the Region in both choosers, with Change back to the Region above', () => {
    for (const [markup, id] of [
      [chooserMarkup(login), 'chooser-region-text'],
      [linkedinChooser(login), 'linkedin-chooser-region-text'],
    ] as const) {
      expect(compact(markup)).toContain(
        compact(
          `<span class="chooser-region-text" id="${id}" >Signing in to your account in the United States (US)</span >`,
        ),
      );
      expect(markup).toContain(
        '<button class="chooser-region-change" type="button" data-chooser-region-change>',
      );
      expect(compact(markup)).toContain(compact('Change<span class="sr-only"> home Region</span>'));
    }
    // One set of words, shared by both routes (auth-consistency.test.ts keeps regionCopy equal).
    for (const source of [login, access]) {
      expect(source).toContain(
        "place: { US: 'the United States (US)', IN: 'India (IN)', UK: 'the United Kingdom (UK)' },",
      );
      expect(source).toContain(`signIn: (place) => \`Signing in to your account in \${place}\`,`);
      expect(source).toContain(`create: (place) => \`Creating your account in \${place}\`,`);
    }
    // Each page names the Region before it opens a chooser: Sign in signs in, Create creates.
    expect(arrowFunction(loginScript, 'continueWithGoogle')).toMatch(
      /setChooserRegion\(\);\s*openAccountChooser\(/,
    );
    expect(arrowFunction(loginScript, 'continueWithLinkedin')).toMatch(
      /setChooserRegion\(\);\s*openLinkedinChooser\(/,
    );
    expect(arrowFunction(loginScript, 'setChooserRegion')).toContain('regionCopy.chooser.signIn(');
    expect(
      accessScript.match(/setChooserRegion\(\);\s*open(?:Account|Linkedin)Chooser\(/g),
    ).toHaveLength(2);
    expect(arrowFunction(accessScript, 'setChooserRegion')).toContain('regionCopy.chooser.create(');
    for (const script of [loginScript, accessScript]) {
      expect(script).toMatch(
        /for \(const change of document\.querySelectorAll\('\[data-chooser-region-change\]'\)\) \{[\s\S]*?change\.closest\('dialog'\)\?\.close\(\);/,
      );
    }
  });

  it('catches a returning account in another Region with a calm notice, before anything happens', () => {
    const notice =
      login.match(
        /<section\s+class="feedback-panel has-action entry-notice"\s+id="region-mismatch"[\s\S]*?<\/section>/,
      )?.[0] ?? '';
    expect(notice).toMatch(/id="region-mismatch"\s+data-kind="notice"\s+hidden\s+tabindex="-1"/);
    expect(notice).toContain('aria-labelledby="region-mismatch-title"');
    expect(notice).toContain('aria-describedby="region-mismatch-message"');
    expect(notice).toContain('id="region-mismatch-switch" type="button"');
    const check = arrowFunction(loginScript, 'inHomeRegion');
    expect(check).toContain('const home = accountRegion();');
    expect(check).toContain('if (selectedRegionCode() === home) return true;');
    expect(check).toContain('regionMismatch.focus();');
    expect(check).toContain('return false;');
    // Switch and continue selects the account's Region and only then signs in.
    expect(loginScript).toMatch(
      /regionMismatchSwitch\.addEventListener\('click', \(\) => \{[\s\S]*?selectRegion\(pending\.home, 'manual'\);[\s\S]*?pending\.go\(\);/,
    );
    // Alex's home Region is the United States unless this browser remembers another for him.
    expect(arrowFunction(loginScript, 'accountRegion')).toContain(": 'US';");
    // Email sign-in never says whether an account exists, so it never shows the notice.
    const submit = loginScript.slice(loginScript.indexOf("loginForm.addEventListener('submit'"));
    expect(submit.slice(0, submit.indexOf('window.addEventListener'))).not.toContain(
      'inHomeRegion',
    );
    expect(login).toContain(`title: (place) => \`Your account is in \${place}\`,`);
    expect(login).toContain(
      `message: (place) => \`You chose \${place}. Nothing has happened yet.\`,`,
    );
  });

  it('catches an account that already exists on Create account, whatever the Region', () => {
    const notice =
      access.match(
        /<section\s+class="feedback-panel has-action entry-notice create-only"\s+id="existing-account"[\s\S]*?<\/section>/,
      )?.[0] ?? '';
    expect(notice).toMatch(/id="existing-account"\s+data-kind="notice"\s+hidden\s+tabindex="-1"/);
    expect(notice).toContain('aria-labelledby="existing-account-title"');
    expect(notice).toContain('aria-describedby="existing-account-message"');
    expect(compact(notice)).toContain(
      compact(
        '<a class="feedback-panel-action" id="existing-account-signin" href="./login-preview.html?skipLoader&amp;region=us" >Sign in instead</a >',
      ),
    );
    // In the same place as Sign in's Region notice: under the Region, before every provider.
    const at = order(access, ['id="region-field"', 'id="existing-account"', 'id="google-create"']);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    // The same look on both routes, from one class.
    for (const source of [login, access]) {
      expect(compact(source)).toContain(
        compact('.feedback-panel.entry-notice { grid-template-columns: 24px minmax(0, 1fr);'),
      );
    }
    const show = arrowFunction(accessScript, 'showExistingAccount');
    expect(show).toContain("const home = 'US';");
    expect(show).toContain('regionCopy.existing.message(');
    expect(show).toContain('existingAccount.focus();');
    // Never the Region: it shows for the United States too, and nothing is remembered.
    expect(show).not.toContain('selectedRegionCode');
    expect(accessScript).not.toMatch(/jobdeputy\.lastAccount/);
    for (const source of [login, access]) {
      expect(source).toContain(
        `message: (provider, place) =>\n            \`You already have a JobDeputy account with this \${provider} account, in \${place}. Nothing has happened yet.\`,`,
      );
    }
    // A new provider choice, another Region, or a fresh page view clears it.
    expect(accessScript.match(/hideExistingAccount\(\);/g)?.length).toBeGreaterThanOrEqual(3);
    expect(accessScript).toMatch(/syncRegionLinks\(\);\s*existingAccount\.hidden = true;/);
  });

  it('takes the Region with a new account to the agreement, and between the entry routes', () => {
    expect(arrowFunction(accessScript, 'withRegion')).toContain(
      `\`\${destination}&region=\${selectedRegionCode().toLowerCase()}\``,
    );
    // Google, LinkedIn, and email.
    expect(accessScript.match(/withRegion\(/g)).toHaveLength(3);
    expect(
      loginScript.match(/withRegion\('\.\/agreement-preview\.html\?mode=new&via=/g),
    ).toHaveLength(2);
    for (const script of [loginScript, accessScript]) {
      // A Region you chose on another route comes with you, as yours.
      expect(script).toMatch(
        /const carriedRegion = (?:previewParameters|parameters)\.get\('region'\)\?\.toUpperCase\(\);\s*if \(\['US', 'IN', 'UK'\]\.includes\(carriedRegion\)\) \{\s*return \{ code: carriedRegion, source: 'manual' \};/,
      );
    }
    // Round 6 part 3 (T1-8): How JobDeputy works carries it too, so Help's Back brings it back.
    expect(loginScript).toContain(
      "['#forgot-password-link', '#create-account-link', '.site-header .about-link']",
    );
    expect(login).toContain(
      '<a class="about-link" href="./trust-preview.html?public&amp;from=login">',
    );
    expect(accessScript).toContain(
      "const regionLinks = [alternateLink, document.querySelector('.header-action')]",
    );
    expect(arrowFunction(accessScript, 'syncRegionLinks')).toMatch(
      /regionSelectionSource === 'manual' && mode !== 'set'\s*\? `\$\{base\}&region=\$\{selectedRegionCode\(\)\.toLowerCase\(\)\}`/,
    );
    // The agreement shows and keeps it (agreement.test.ts), and setup's Welcome names it.
    expect(agreement).toContain(
      "const homeRegion = mode === 'new' ? model.regionOf(parameters.get('region')) : null;",
    );
  });
});
