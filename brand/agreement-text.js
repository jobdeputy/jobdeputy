// The JobDeputy User Agreement: every published version's text, key points, what changed, and
// fingerprint (round 5 brief, section 3.4; decision G1). A draft for counsel review, not legal
// advice: every [Owner: ...] and [Counsel: ...] placeholder must be completed before launch.
//
// A classic script with one global, window.JobDeputyAgreementText (also module.exports for Node):
//   current   '2026.10', the version people sign now
//   order     ['2026.10', '2026.09'], newest first
//   consents  the three things a signature confirms: [{ id: 'read' | 'act' | 'keep', label }]
//   versions  { [version]: { version, title, publishedAt, publishedText, summary, sections,
//               changes, markdown, sha256, words, readMinutes } }
//     summary   [{ id, number, title, point }]: each section's key point in one plain sentence
//     sections  the same, plus anchor (the page's id for the section: section-<id>)
//     changes   what is new in this version: [{ id, title, text, sections: [section ids] }]
//     markdown  the full text people read and sign; sha256 is the SHA-256 of its UTF-8 bytes
//   sentence(version)  the one sentence above Sign and continue (round 7, G3: signing is one
//               step), which says what a signature confirms
//   signedCopy(record)  the copy to download for a signed record (JobDeputyStore.agreements()
//               .signed): { version, title, markdown }, the text then its signature record (with
//               the home Region when the record keeps one, round 6)
//   dateText(value), dateTimeText(value)  "Mon, Sep 14, 2026" and "..., 19:20 Pacific"
//
// One list of sections makes every version. A block marked since: '2026.10' is new in 2026.10; a
// block marked until: '2026.09' is 2026.09's wording that 2026.10 replaced; a section marked since
// is new as a whole. A published text never changes: tests/prototype/agreement.test.ts rebuilds
// each version, recomputes its SHA-256 with Node's crypto, and compares it with the sha256 below,
// so an edit to a published version fails until it ships as a new version.
//
// The writing rules: plain second person, "your deputy" for the work it does, no promise the
// product does not keep, and no em or en dashes.
(() => {
  const root = typeof window === 'undefined' ? globalThis : window;
  if (root.JobDeputyAgreementText) return;

  const VERSIONS = [
    {
      version: '2026.09',
      publishedAt: '2026-09-01T00:00:00-07:00',
      published: 'September 1, 2026',
    },
    { version: '2026.10', publishedAt: '2026-10-01T00:00:00-07:00', published: 'October 1, 2026' },
  ];
  const TITLE = 'JobDeputy User Agreement';
  const NOTE =
    'This is a draft for counsel review. It is not legal advice and is not final. Text in square brackets, such as [Owner: refund window], is a placeholder that the owner or counsel must complete before launch.';

  const CONSENTS = [
    { id: 'read', label: 'I read the agreement' },
    { id: 'act', label: 'I allow my deputy to act for me as it describes' },
    {
      id: 'keep',
      label:
        'I understand JobDeputy keeps a permanent copy of what I sign, even after I delete my account',
    },
  ];

  // Each section: id, title, point (one plain sentence, or { version: sentence } where versions
  // differ), and blocks: a string is a paragraph, { list: [...] } is a bulleted list. Any block or
  // list item may be { text | list, since, until }.
  const S10 = '2026.10';
  const S09 = '2026.09';
  const SECTIONS = [
    {
      id: 'who',
      title: 'Who we are',
      point:
        'JobDeputy is run by [Owner: legal entity name], and this agreement is between you and us.',
      blocks: [
        'JobDeputy is a service that looks for jobs for you and helps you apply. In this agreement, “JobDeputy”, “we”, and “us” mean [Owner: legal entity name], [Owner: registered address and company number]. “You” means the person who signs this agreement and uses the account.',
        'Your deputy is the part of JobDeputy that works for you. It searches, reads, scores, drafts, fills in forms, and keeps track, within the limits that this agreement and your settings set.',
        'This agreement applies whenever you use JobDeputy, on any device. [Counsel: confirm the contracting entity for each home Region: the United States, India, and the United Kingdom.]',
      ],
    },
    {
      id: 'eligibility',
      title: 'Who can use JobDeputy',
      point: 'You must be 18 or older, and your account is for your own job search only.',
      blocks: [
        {
          list: [
            'You must be 18 or older.',
            'You must be able to make a binding agreement where you live.',
            'An account is for one person: you. Don’t share it, and don’t create an account for someone else.',
            'Use JobDeputy for your own job search. Don’t use it to recruit, to screen candidates, or to collect job data for others.',
            '[Counsel: the countries where JobDeputy is offered, and any sanctions or export rules that apply.]',
          ],
        },
      ],
    },
    {
      id: 'account',
      title: 'Your account and signing in',
      point: {
        [S09]:
          'Keep your sign-in safe; signing in with Google shares only your name, email address, and photo with us.',
        [S10]:
          'Keep your sign-in safe; signing in with Google or LinkedIn shares only your name, email address, and photo with us.',
      },
      blocks: [
        { text: 'You sign in with your email address and a password, or with Google.', until: S09 },
        {
          text: 'You sign in with your email address and a password, with Google, or with LinkedIn.',
          since: S10,
        },
        'Keep your password safe, and tell us at once if you think someone else has used your account. You’re responsible for what happens in your account, unless it happened because we failed to protect it. [Counsel: confirm this allocation of responsibility.]',
        'Your account lives in one home Region that you choose when you sign up: the United States, India, or the United Kingdom. You can’t change it later. [Owner: whether Region moves will be offered.]',
        'When you sign in with Google, Google shares your name, email address, and profile photo with us, and nothing else.',
        {
          text: 'When you sign in with LinkedIn, LinkedIn shares your name, email address, and profile photo with us, and nothing else.',
          since: S10,
        },
        'We never post anything to Google or LinkedIn for you, and we never see your passwords for those services.',
      ],
    },
    {
      id: 'deputy',
      title: 'What your deputy does for you',
      point: {
        [S09]:
          'Your deputy searches, scores, tailors, and fills in applications for you, only as your settings allow.',
        [S10]:
          'Your deputy searches, scores, tailors, applies, creates site accounts, and reads job email for you, only as your settings allow, and it never sends email.',
      },
      blocks: [
        'You decide where your deputy looks, what it looks for, and how far it goes. Within those choices, your deputy:',
        {
          list: [
            'searches the careers sites and job boards you add: when you ask, and every night for the sources you put on Keep watch;',
            'reads the job postings it finds;',
            'scores how well each role fits you, with AI (Deputy Assist) or with keyword filtering, as you choose;',
            'tailors your résumé, and drafts cover letters and answers to application questions, from what you gave it;',
            'fills in application forms and applies for you, only as your settings allow;',
            {
              text: 'creates accounts on employers’ sites in your name when an application needs one, and keeps their passwords in your vault ({s:site-accounts});',
              since: S10,
            },
            'reads one-time sign-in codes and employers’ status emails through read-only access to your Gmail, if you connect it ({s:email});',
            {
              text: 'moves your applications to their next stage when an employer’s email says so, which you can undo;',
              since: S10,
            },
            {
              text: 'drafts replies to employers’ emails, which you edit and send yourself (your deputy never sends email);',
              since: S10,
            },
            'keeps track of your applications and reminds you of what is next.',
          ],
        },
        {
          text: 'How your deputy applies is your setting in Profile. With Off, your deputy doesn’t fill in forms and you apply yourself. With Review each one (the starting setting), your deputy fills in each form and waits for your OK before it submits. Within your rules, when it becomes available, will let your deputy submit applications that match rules you set, without asking each time; it is planned and is off until you turn it on.',
          until: S09,
        },
        {
          text: 'How your deputy applies is your setting in Applications. With Review, then auto-apply (the starting setting), your deputy drafts and reviews your materials, you approve each application in one step, and it then applies in the background within your rules. With Review each form, it also waits for you to check each filled form before it sends. With Off, your deputy drafts and you apply yourself. Rules that approve materials for you are off until you turn them on.',
          since: S10,
        },
        {
          text: 'When your deputy finds a detail on an application form that your profile doesn’t have yet, such as your notice period, it saves the detail to your profile so it can answer the next form. You can turn this off, or remove the detail, at any time.',
          since: S10,
        },
        'You authorize us, through your deputy, to do these things for you as your settings allow. You are the applicant in every application; your deputy acts for you and on your instructions. You can change your settings, pause Keep watch, or stop any task at any time. [Counsel: confirm the authority and agency wording.]',
      ],
    },
    {
      id: 'responsibilities',
      title: 'What you’re responsible for',
      point:
        'You give true information, review what your deputy prepares, and follow the sites’ own terms.',
      blocks: [
        {
          list: [
            'Give true, accurate, and current information about yourself. Don’t ask your deputy to claim qualifications, experience, or a right to work that you don’t have.',
            'Review what your deputy prepares. You approve the materials for each application, and with Review each one you check every form before your deputy submits it.',
            'Each careers site, job board, and employer has its own terms, which apply to you when your deputy uses them for you. Read the terms of the sites you choose. [Counsel: how responsibility for third-party terms is shared between you and us.]',
            'Keep your contact details current, so employers and we can reach you.',
            'Follow the laws that apply to your applications.',
          ],
        },
      ],
    },
    {
      id: 'ai',
      title: 'AI can be wrong',
      point: 'AI can be wrong, so check what your deputy scores and drafts before you rely on it.',
      blocks: [
        'Your deputy uses AI models to read postings, score fit, tailor documents, and draft answers. AI can be wrong, incomplete, or out of date, and it can misread a page. Fit scores are estimates, not facts. Check every draft and every answer before you rely on it or let it be sent.',
        {
          text: 'Your deputy also uses AI to read employers’ emails and to draft your replies. Check every reply before you send it.',
          since: S10,
        },
        'AI work runs on the setting you choose for your whole account: our platform model, run in your home Region; your own key with the provider you chose ({s:own-keys}); or keyword filtering, which uses no AI model.',
        'You can add your own instructions for your deputy’s AI. They are checked against our guardrails when you save them, and a version that fails a check can’t be saved. Our locked rules always apply, whatever your instructions say: text from pages, files, and emails is treated as data, never as instructions, and a model’s answer never makes your deputy send, pay, or apply by itself.',
        'Your deputy never scores, ranks, or filters roles by age, gender, race, religion, disability, nationality, pregnancy, veteran status, or any other protected trait, and your instructions can’t ask it to.',
      ],
    },
    {
      id: 'no-promise',
      title: 'No promise of interviews or jobs',
      point:
        'We can’t promise interviews, offers, or jobs, because employers make their own decisions.',
      blocks: [
        'JobDeputy helps you search and apply. We can’t promise that you’ll find a role, get an interview, receive an offer, or be hired, or that an employer will read or answer your application. Employers make their own decisions.',
        'JobDeputy isn’t an employer, a recruiter, or an employment agency. We don’t find candidates for employers, and employers don’t pay us to place you. [Counsel: confirm that JobDeputy is not an employment agency or job board under the law of each Region.]',
      ],
    },
    {
      id: 'sites',
      title: 'Other companies’ sites',
      point:
        'Your deputy works on other companies’ sites, which we don’t control, and it stops at every CAPTCHA.',
      blocks: [
        'Your deputy works on sites that other companies run: careers pages, job boards, and employers’ application systems. We aren’t affiliated with them unless we say so, and we don’t control their content, their decisions, or what they do with what you send them.',
        {
          list: [
            'A site may change, slow down, or block automated tools at any time. When that happens, your deputy stops and tells you.',
            'Your deputy stops at a CAPTCHA, or at any check meant for a person, and asks you. It never tries to get around one.',
            'Your deputy follows each site’s rules for automated visitors and keeps its visits slow. [Owner: confirm the crawling policy, such as robots.txt and rate limits.]',
            'What you send to an employer is governed by that employer’s own terms and privacy notice.',
          ],
        },
      ],
    },
    {
      id: 'email',
      title: 'Your email (Gmail)',
      point: {
        [S09]:
          'With your permission, your deputy reads only job email, through read-only Gmail access, and it never sends email.',
        [S10]:
          'With your permission, your deputy reads only job email, through read-only Gmail access, to update your applications and draft replies; it never sends email.',
      },
      blocks: [
        'If you connect Gmail, your deputy gets read-only access to it. Read-only means it can’t send, delete, move, label, or change any message.',
        {
          list: [
            'What your deputy reads: one-time sign-in codes from job sites, and emails from employers and job sites about your applications, such as “application received”, interview invitations, decisions, and questions for you. [Owner: confirm how messages are matched to your applications.]',
            'What it never reads: other email. It doesn’t open personal messages, newsletters, or anything that isn’t about your job search. [Counsel: wording that matches what the code can guarantee with this access.]',
            'What it never sends: anything. Your deputy never sends email from your account.',
            'What it keeps: only the facts it needs, such as the employer, the new status, any interview time, the date, the subject line, and a short excerpt that you can see in Applications. It never keeps one-time codes: a code is shown once, then deleted.',
            {
              text: 'When an employer’s email says your application moved forward or closed, your deputy moves it in Applications and tells you. You can undo any move.',
              since: S10,
            },
            {
              text: 'When an email needs an answer, your deputy can draft a reply. You edit it and send it yourself, from your own email.',
              since: S10,
            },
            'To understand an email, your deputy may send its text to the AI your account uses ({s:ai,own-keys}).',
            {
              text: 'Your deputy checks your job email once a day, reading the last 48 hours of it, and whenever you choose Scan now. Each check uses one run ({s:prices}).',
              since: S10,
            },
            {
              text: 'You can disconnect Gmail at any time in Profile, and you can remove our access in your Google account.',
              until: S09,
            },
            {
              text: 'You can disconnect Gmail at any time in Settings, Connections, and you can remove our access in your Google account.',
              since: S10,
            },
          ],
        },
        'Our use of information we receive from Google APIs will follow the Google API Services User Data Policy, including its Limited Use requirements. [Counsel: confirm before launch.]',
      ],
    },
    {
      id: 'site-accounts',
      title: 'Site accounts and your password vault',
      since: S10,
      point:
        'When an application needs a site account, your deputy can create it in your name and keep its password, encrypted, in your vault.',
      blocks: [
        'Some employers’ sites ask you to create an account before you can apply. When that happens in an application you started, your deputy can create the account for you, in your name and with your email address.',
        {
          list: [
            'You choose the password: your deputy generates a strong one (20 random characters), or you choose your own (at least 12 characters, and not a common password).',
            'The one-time code that confirms the account is read from your Gmail, shown once, and never stored.',
            'Passwords are kept encrypted in your vault, in your home Region. Your deputy uses each one only to sign in to that site for your applications. [Owner: confirm the encryption and key management.]',
            'You can see any of these passwords at any time in Settings, Connections, after you confirm it’s you. A password stays hidden until you choose Show, and every time one is shown, the vault log records when.',
            'Each site account belongs to you, under that site’s terms. Deleting your JobDeputy account deletes your vault, but not the accounts on employers’ sites: close those on each site if you want them gone.',
            'If you think a site password was exposed, change it on that site and tell us.',
          ],
        },
      ],
    },
    {
      id: 'own-keys',
      title: 'Your own AI keys',
      point:
        'Your own AI key stays yours; when you use it, your data goes to that provider, and we never charge you for it.',
      blocks: [
        'You can use your own key from an AI provider, such as OpenAI or Anthropic, instead of our platform.',
        {
          list: [
            'Your key stays yours. We keep it encrypted, never show it again in full, never write it to logs, and never share it with anyone.',
            'Your deputy uses your key only for work you start or turn on, such as a search, a Keep watch check, or a draft.',
            {
              text: 'When your key is used, the text your deputy sends (for example job postings, your résumé, and your profile) goes to that provider, outside your home Region, under the provider’s terms and privacy policy.',
              until: S09,
            },
            {
              text: 'When your key is used, the text your deputy sends (for example job postings, your résumé, your profile, and job emails) goes to that provider, outside your home Region, under the provider’s terms and privacy policy.',
              since: S10,
            },
            'The provider charges you for what your key uses. We never charge you for using your own key.',
            'You can set a token limit for your key. When it is reached, your deputy pauses its AI work or uses our platform instead, as you choose.',
            'If the provider rejects your key, your deputy stops and tells you. It switches to our platform only if your setting allows it.',
          ],
        },
      ],
    },
    {
      id: 'linkedin',
      title: 'Importing from LinkedIn',
      since: S10,
      point:
        'You can import your details from a LinkedIn file, and nothing is saved until you choose what to keep.',
      blocks: [
        'You can import your details from LinkedIn. Your deputy reads a file you download from LinkedIn yourself: your data export (the ZIP file from Settings, Data privacy, Get a copy of your data) or your profile saved as a PDF.',
        {
          list: [
            'Your deputy shows every detail it found next to what your profile already has, and saves only the details you choose.',
            'We don’t connect to your LinkedIn account to read your data, and we never post to LinkedIn for you.',
            'The file is read to find your details, and we don’t keep the file after the import. [Owner: confirm.]',
          ],
        },
      ],
    },
    {
      id: 'prices',
      title: {
        [S09]: 'Free allowances and prices',
        [S10]: 'Credits, runs, and prices',
      },
      point: {
        [S09]:
          'Some features have a free allowance each month, and you’ll see a price and its terms before you can buy anything.',
        [S10]:
          'AI credits cost Amazon’s Bedrock rate plus a margin, bundles discount only runs, and tax is added at checkout.',
      },
      blocks: [
        {
          text: 'Some features have a free allowance each month, which the app shows with what is used and what is left. Nothing is on sale yet. Before you can buy anything, we’ll show you its price and ask you to agree to its terms.',
          until: S09,
        },
        { text: 'JobDeputy sells AI credits and runs, and bundles of both.', since: S10 },
        {
          since: S10,
          list: [
            'AI credits pay for AI on our platform. Their price is the Amazon Bedrock on-demand rate for your model in your home Region, plus a margin of [Owner: margin, proposed 10%]. The app shows the AWS rate, our rate, the margin, the date we last checked the AWS rate, and a link to Amazon’s price page.',
            'Credits are prepaid value. The app shows them as tokens on the model your account uses, so if you change the model, or Amazon changes its rate, the same credits show a different number of tokens.',
            'Each month you get free credits worth [Owner: free monthly amount, proposed 250,000 tokens at Ministral 3 14B’s rate], refreshed on the 1st (UTC). Free credits don’t carry over to the next month.',
            'When a friend you invited runs their first search, you both get bonus credits. [Owner: amount, proposed 100,000 tokens’ worth each, and any yearly limit and expiry.]',
            'Runs pay for the work your deputy does when you ask or on a schedule you turn on: each search you start, each source Keep watch checks at night, each check of your job email (daily, or when you choose Scan now), and each daily summary email you subscribe to use one run. AI work uses tokens, from your credits or your own key. Each month includes [Owner: free runs, proposed 10]. You can buy more in packs.',
            'Bundles combine credits and runs. Their discount is on the runs only: credits always cost the AWS rate plus the margin.',
            'Credits are used in this order: free, then bonus, then bought.',
            'Prices are in US dollars. Tax is added at checkout, based on your billing address. [Owner: other currencies.]',
            'Payments are handled by [Owner: payment provider]. We don’t store your full card number. [Owner: confirm.]',
            'Refunds: [Owner: refund window and conditions]. [Counsel: cancellation rights for digital purchases in each Region, such as the 14-day right in the United Kingdom.]',
            'Expiry: [Owner: whether and when bought credits, bonus credits, and runs expire].',
            'We may change prices for future purchases. You’ll always see the price before you buy, and a change never affects what you already bought.',
            'Credits and runs have no cash value, and you can’t sell or transfer them.',
          ],
        },
      ],
    },
    {
      id: 'support',
      title: 'Supporting JobDeputy',
      point: {
        [S09]:
          'Support is optional, and it isn’t tax deductible because JobDeputy isn’t a charity.',
        [S10]:
          'Support is optional and isn’t tax deductible, and its benefits are a planned thank-you, not something you buy.',
      },
      blocks: [
        'You can choose to support JobDeputy, once or every month. JobDeputy isn’t a charity, so support isn’t tax deductible. [Counsel: the legal nature of support payments.]',
        {
          text: 'As thanks, supporters can have these benefits, which are planned and may change:',
          since: S10,
        },
        {
          since: S10,
          list: [
            'a place on the supporters list on our website, only if you opt in, with your name shown as you choose (your full name, your first name and initial, or anonymous), which you can change or leave at any time;',
            'a quarterly online question and answer session with the team;',
            'early access to new features;',
            'a vote on what we build next.',
          ],
        },
        { text: 'Benefits are a thank-you, not something you buy.', since: S10 },
        '[Owner: how monthly support is cancelled, and whether support is refundable.]',
      ],
    },
    {
      id: 'privacy',
      title: 'Your privacy and your data',
      point:
        'Your data stays in your home Region, you can export it at any time, and deleting your account deletes it.',
      blocks: [
        {
          list: [
            {
              text: 'Your data stays in your home Region: the United States (AWS us-east-1), India (ap-south-1), or the United Kingdom (eu-west-2). It leaves your Region only for what you choose to use: the text your deputy sends to your own AI key’s provider, and the applications you send to employers.',
              until: S09,
            },
            {
              text: 'Your data stays in your home Region: the United States (AWS us-east-1), India (ap-south-1), or the United Kingdom (eu-west-2). It leaves your Region only for what you choose to use: the text your deputy sends to your own AI key’s provider, the applications you send to employers, and your payments, which our payment provider handles. [Owner: confirm where payment data is processed.]',
              since: S10,
            },
            'We use your data only to provide JobDeputy to you. We never sell your personal data, and we don’t use your résumé, profile, or email to train AI models. [Owner: confirm both before launch.]',
            'Voluntary self-identification answers, such as gender or veteran status, are optional. Your deputy uses them only to answer an employer’s voluntary questions, as you choose, and never to score, rank, or filter roles.',
            {
              text: 'You can export your data at any time in Profile. [Owner: export is planned, and it must work before launch.]',
              until: S09,
            },
            {
              text: 'You can export your data at any time in Settings, Account. [Owner: export is planned, and it must work before launch.]',
              since: S10,
            },
            {
              text: 'You can delete your account at any time in Profile. We then delete your data [Owner: within how many days, and from backups within how many days], except what the law requires us to keep. [Counsel: retention periods.]',
              until: S09,
            },
            {
              text: 'You can delete your account at any time in Settings, Account. We then delete your data [Owner: within how many days, and from backups within how many days], except your agreement records ({s:record}) and what the law requires us to keep, such as payment records for tax. [Counsel: retention periods.]',
              since: S10,
            },
            'Our Privacy Notice explains what we collect, why, how long we keep it, and your rights. [Counsel: link the Privacy Notice and confirm how it relates to this agreement.]',
          ],
        },
      ],
    },
    {
      id: 'record',
      title: 'The record of what you sign',
      since: S10,
      point:
        'We keep a permanent record of each version you sign, even after you delete your account, so what you agreed to can always be shown.',
      blocks: [
        'When you sign this agreement, we keep a record of it:',
        {
          list: [
            'the version you signed and the fingerprint of its text (a SHA-256 hash that identifies the exact text you saw);',
            'the name you signed with, your email address, and the date and time;',
            'how you signed and the three things you confirmed.',
          ],
        },
        'We keep these records permanently, apart from your account. When you delete your account, we delete everything else, but never these records. If you create a new account later, you sign the agreement again.',
        'We keep them so that you and we can always show what you agreed to, when, and which version it was, if a question or a dispute ever comes up. A record holds only what that needs. You can see and download your signed copies at any time in Settings, Account. [Counsel: confirm that permanent retention is lawful in each Region, for example under UK GDPR’s storage limitation and India’s Digital Personal Data Protection Act, or set a retention period.]',
      ],
    },
    {
      id: 'changes',
      title: 'Changes to this agreement',
      point: {
        [S09]:
          'We’ll tell you when this agreement changes and ask you to agree before the change applies to you.',
        [S10]:
          'When this agreement changes, you see what changed and sign again; after 14 days unsigned your deputy’s work pauses, but you can always sign in, export, and delete.',
      },
      blocks: [
        {
          text: 'We may update this agreement. We’ll tell you what changed and ask you to agree before the new version applies to you. If you don’t agree, you can stop using JobDeputy and delete your account.',
          until: S09,
        },
        {
          text: 'We may update this agreement. Every new version gets a version number, and you sign each one. Until you sign a new version, the version you signed before still applies. When we publish a new version:',
          since: S10,
        },
        {
          since: S10,
          list: [
            'you see what changed first, and you sign it in the app;',
            'we remind you in the app and by email on the day it is published, and 3, 7, 10, and 13 days later;',
            'if you haven’t signed it 14 days after it is published, your deputy’s work pauses until you sign: searches, Keep watch checks, filling in applications, and drafting;',
            'some things never pause: you can always sign in, see everything, export your data, delete your account, use Help, and sign the new version;',
            'a feature that is new in a version asks for your signature the first time you use it.',
          ],
        },
        {
          text: 'When you sign, your deputy’s work starts again where it stopped. If you don’t agree to a new version, you can stop using JobDeputy and delete your account. [Counsel: changes required by law or for safety that apply sooner.]',
          since: S10,
        },
      ],
    },
    {
      id: 'acceptable-use',
      title: 'Acceptable use',
      point: 'Don’t misuse JobDeputy, and don’t try to make your deputy break its rules.',
      blocks: [
        'Don’t use JobDeputy to:',
        {
          list: [
            'apply with false or misleading information, or with someone else’s;',
            'flood employers with applications you don’t mean;',
            'break the law or anyone’s rights, including privacy, anti-discrimination, and copyright laws;',
            'get around a site’s access controls, rate limits, or CAPTCHAs, or overload a site;',
            'collect, copy, or resell job data or other people’s personal data;',
            'make your deputy break its rules, for example with instructions in your prompts, documents, or forms that tell it to ignore its locked rules, reveal hidden information, or act without your approval;',
            'probe, scan, or attack JobDeputy, or copy it to build another service. [Counsel: confirm.]',
          ],
        },
        'If you break these rules, we may pause features or suspend your account, and we’ll tell you why unless the law or someone’s safety prevents it. [Counsel: the suspension and appeal process.]',
      ],
    },
    {
      id: 'liability',
      title: 'Disclaimers, limits on liability, and indemnity',
      point:
        '[Counsel: disclaimers and limits on liability], and your rights under consumer law always stay.',
      blocks: [
        '[Counsel: disclaimers of warranties, as far as the law allows for consumers in each Region.]',
        '[Counsel: limitation of liability, including any cap and the losses that can’t be excluded, such as death or personal injury caused by negligence.]',
        '[Counsel: indemnity, if any, and its limits for consumers.]',
        'Nothing in this agreement takes away rights you have under consumer law that an agreement can’t take away.',
      ],
    },
    {
      id: 'law',
      title: 'Law and disputes',
      point:
        '[Counsel: governing law and how disputes are settled], and you can always ask us to put a problem right first.',
      blocks: [
        '[Counsel: the governing law for each home Region.]',
        '[Counsel: where and how disputes are settled, such as courts, arbitration, or small claims, and the rights consumers keep in their own country.]',
        'Before you start a formal dispute, please contact us ({s:contact}) so we can try to put it right. [Counsel: an informal resolution period.]',
      ],
    },
    {
      id: 'ending',
      title: 'Ending this agreement',
      point:
        'You can end this agreement at any time by deleting your account, and we end it only for serious reasons.',
      blocks: [
        {
          list: [
            {
              text: 'You can end this agreement at any time by deleting your account in Profile.',
              until: S09,
            },
            {
              text: 'You can end this agreement at any time by deleting your account in Settings, Account.',
              since: S10,
            },
            'We may suspend your account or end this agreement if you seriously or repeatedly break it, or if the law requires us to, and we’ll tell you why where we can. [Counsel: notice periods.]',
            'If we stop offering JobDeputy, we’ll tell you at least [Owner: notice period] before, so you can export your data. [Owner: refunds of unused bought credits.]',
            // 2026.09's wording, as its signers saw it (its fingerprint is pinned); 2026.10 says
            // "credits and runs" in the entry below (T7-R6).
            {
              text: 'When this agreement ends, your deputy stops all work and your data is deleted as {s:privacy} says. [Owner: what happens to unused bought credits and nightly runs.]',
              until: S09,
            },
            {
              text: 'When this agreement ends, your deputy stops all work and your data is deleted as {s:privacy} says. [Owner: what happens to unused bought credits and runs.]',
              since: S10,
            },
            'Some parts keep applying after the agreement ends because of what they are, such as the limits on liability and the parts about disputes.',
          ],
        },
        {
          text: 'Your agreement records stay, as {s:record} says.',
          since: S10,
        },
      ],
    },
    {
      id: 'contact',
      title: 'Contact',
      point: 'You can reach us at [Owner: contact email address] or through Help in the app.',
      blocks: [
        'Questions about this agreement: write to [Owner: contact email address], or use Help, Contact, in the app. By post: [Owner: postal address]. [Counsel: the address for formal legal notices.]',
      ],
    },
  ];

  // What 2026.10 adds (brief section 3.1 item 4), each linked to the sections that say it.
  const CHANGES = {
    [S10]: [
      {
        id: 'credits',
        title: 'Credits with prices, and bundles',
        text: 'AI credits are priced at Amazon’s Bedrock rate plus a margin, runs come in packs, and bundles discount the runs.',
        sections: ['prices'],
      },
      {
        id: 'site-accounts',
        title: 'Accounts on employers’ sites',
        text: 'Your deputy can create accounts on employers’ sites in your name and keep their passwords in your vault.',
        sections: ['site-accounts', 'deputy'],
      },
      {
        id: 'email',
        title: 'Updates from your email, and reply drafts',
        text: 'Your deputy moves your applications when an employer’s email says so, and drafts replies that you send yourself.',
        sections: ['email', 'deputy'],
      },
      {
        id: 'linkedin',
        title: 'LinkedIn sign-in and import',
        text: 'You can sign in with LinkedIn and import your details from a LinkedIn file.',
        sections: ['account', 'linkedin'],
      },
      {
        id: 'support',
        title: 'Supporter benefits',
        text: 'Supporters can have planned benefits, such as the supporters list and early access.',
        sections: ['support'],
      },
      {
        id: 'record',
        title: 'Permanent agreement records, and signing again',
        text: 'Your signed records are kept permanently, a new account signs again, and an unsigned new version pauses your deputy’s work after 14 days.',
        sections: ['record', 'changes'],
      },
    ],
  };

  // The SHA-256 of each version's markdown (UTF-8). Pinned: see the header.
  // 2026.10's draft was amended before launch in round 7 (an owner question: a published text
  // should otherwise ship as a new version). G3: signing became one step, so its record section
  // says "the name you signed with" and "how you signed" instead of a typed name. T7-13 (R10-9
  // and the Settings tabs): runs pay for every search you start, each Keep watch check, each
  // Gmail check, and each daily email (no more "nightly runs" for Keep watch only); Gmail, site
  // passwords, export, deletion, and your signed copies are where the app now keeps them
  // (Settings, Connections and Account), and How your deputy applies has its round 6 modes, in
  // Applications. 2026.09 is unchanged. The sample's seeded records keep no fingerprint of their
  // own, so they read this one; a copy signed in a browser before the amendment keeps the old one
  // and shows the mismatch.
  const SHA256 = {
    [S09]: '5eeeec084a223e8460acd4de98f34bfa7193763ad7abef7086c05b16889a0eed',
    [S10]: '87e7340ddb4b8f260721877a70368beb335c319680f9ac1a0af0d48299014fd4',
  };

  const order = VERSIONS.map((entry) => entry.version);
  // A block or a section belongs to a version when it started at or before it and ended at or
  // after it (versions compare in publication order).
  const includes = (item, version) => {
    if (typeof item === 'string') return true;
    const at = order.indexOf(version);
    if (item.since && order.indexOf(item.since) > at) return false;
    if (item.until && order.indexOf(item.until) < at) return false;
    return true;
  };
  const pick = (value, version) =>
    value && typeof value === 'object' && !Array.isArray(value) ? value[version] : value;
  const textOf = (item) => (typeof item === 'string' ? item : item.text);
  // A reference such as {s:own-keys} reads "section 11" in the version that numbers it 11, and
  // {s:ai,own-keys} reads "sections 6 and 11". A reference to a section the version lacks is a
  // mistake in this file, so it throws.
  const resolve = (text, numbers, version) =>
    text.replace(/\{s:([a-z,-]+)\}/g, (_, ids) => {
      const found = ids.split(',').map((id) => {
        if (!numbers.has(id)) {
          throw new Error(`Agreement ${version} refers to a missing section: ${id}`);
        }
        return numbers.get(id);
      });
      return found.length === 1
        ? `section ${found[0]}`
        : `sections ${found.slice(0, -1).join(', ')} and ${found.at(-1)}`;
    });

  const build = ({ version, publishedAt, published }) => {
    const sections = SECTIONS.filter((section) => includes(section, version)).map(
      (section, index) => ({
        id: section.id,
        number: index + 1,
        title: pick(section.title, version),
        point: pick(section.point, version),
        anchor: `section-${section.id}`,
        blocks: section.blocks.filter((block) => includes(block, version)),
      }),
    );
    const numbers = new Map(sections.map((section) => [section.id, section.number]));
    const say = (item) => resolve(textOf(item), numbers, version);
    const lines = [`# ${TITLE}`, '', `Version ${version} · Published ${published}`, '', NOTE];
    for (const section of sections) {
      lines.push('', `## ${section.number}. ${section.title}`);
      for (const block of section.blocks) {
        lines.push('');
        if (block.list) {
          for (const item of block.list.filter((entry) => includes(entry, version))) {
            lines.push(`- ${say(item)}`);
          }
        } else {
          lines.push(say(block));
        }
      }
    }
    const markdown = `${lines.join('\n')}\n`;
    const words = markdown.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
    const summary = sections.map(({ id, number, title, point }) => ({ id, number, title, point }));
    return Object.freeze({
      version,
      title: TITLE,
      publishedAt,
      publishedText: published,
      summary: Object.freeze(summary.map((entry) => Object.freeze(entry))),
      sections: Object.freeze(
        sections.map(({ id, number, title, point, anchor }) =>
          Object.freeze({ id, number, title, point, anchor }),
        ),
      ),
      changes: Object.freeze(
        (CHANGES[version] ?? []).map((change) =>
          Object.freeze({ ...change, sections: Object.freeze([...change.sections]) }),
        ),
      ),
      markdown,
      sha256: SHA256[version],
      words,
      // About 238 words a minute, rounded up.
      readMinutes: Math.max(1, Math.ceil(words / 238)),
    });
  };

  const versions = Object.freeze(
    Object.fromEntries(VERSIONS.map((entry) => [entry.version, build(entry)])),
  );

  // Dates as a signature shows them, in Pacific time like the rest of the sample world:
  // "Mon, Sep 14, 2026" and "Mon, Sep 14, 2026, 19:20 Pacific".
  const ZONE = 'America/Los_Angeles';
  const dateText = (value) =>
    new Intl.DateTimeFormat('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: ZONE,
    }).format(new Date(value));
  const timeText = (value) =>
    new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZone: ZONE,
    }).format(new Date(value));
  const dateTimeText = (value) => `${dateText(value)}, ${timeText(value)} Pacific`;

  // The home Regions a record can name (round 6, G3: a new account keeps the one it chose).
  const REGION_NAMES = Object.freeze({
    US: 'United States (US)',
    IN: 'India (IN)',
    UK: 'United Kingdom (UK)',
  });

  // Signing in one step (round 7, G3): the one sentence above Sign and continue says what a
  // signature confirms (the three consents, in one sentence). The page shows it and a one-step
  // record's signed copy repeats it, word for word.
  const sentence = (version) =>
    `By signing, you agree to User Agreement version ${version}, allow your deputy to act for you as it describes, and understand JobDeputy keeps a permanent copy of what you sign, even after you delete your account.`;

  // How a record was signed: one step with Sign and continue (round 7, G3), or, before it, by
  // typing the account's name.
  const METHODS = Object.freeze({
    'one-step': 'Sign and continue (one step)',
    'typed-name': 'typed name',
  });

  // The signed copy, one builder for every page that offers it (the agreement page's record and
  // Help's Your agreements), so both save the same file: the text that was signed, then its
  // signature record, whose fingerprint is the SHA-256 of the text above it. It takes a record
  // as JobDeputyStore.agreements().signed lists it and returns { version, title, markdown }, the
  // document JobDeputyComponents.download and downloadMenu save ("JobDeputy User Agreement
  // 2026.10, signed.pdf"); null for a version this file lacks or a record without a valid date.
  const signedCopy = (record) => {
    const text = versions[record?.version];
    if (!text || !Number.isFinite(Date.parse(record.signedAt))) return null;
    const ticked = Array.isArray(record.consents)
      ? record.consents
      : CONSENTS.map((consent) => consent.id);
    // A record from before round 7 says no method: those were all signed by typing the name.
    const method = Object.hasOwn(METHODS, String(record.method)) ? record.method : 'typed-name';
    const lines = [
      text.markdown.trimEnd(),
      '',
      '## Signature record',
      '',
      `- Version: ${record.version}`,
      `- Signed: ${dateTimeText(record.signedAt)}`,
      method === 'typed-name'
        ? `- Name typed as the signature: ${record.name}`
        : `- Signed as: ${record.name}`,
      `- Email: ${record.email}`,
      ...(Object.hasOwn(REGION_NAMES, String(record.homeRegion ?? ''))
        ? [`- Home Region: ${REGION_NAMES[record.homeRegion]}`]
        : []),
      `- Method: ${METHODS[method]}`,
      `- Fingerprint of the text above (SHA-256): ${record.fingerprint || text.sha256}`,
      '- Kept: permanently, apart from the account',
      '',
      'What the signature confirms:',
      '',
      ...(method === 'one-step'
        ? [sentence(record.version)]
        : CONSENTS.filter((consent) => ticked.includes(consent.id)).map(
            (consent) => `- ${consent.label}`,
          )),
    ];
    return Object.freeze({
      version: record.version,
      title: `${TITLE} ${record.version}, signed`,
      markdown: `${lines.join('\n')}\n`,
    });
  };

  const api = Object.freeze({
    current: S10,
    order: Object.freeze([...order].reverse()),
    consents: Object.freeze(CONSENTS.map((consent) => Object.freeze({ ...consent }))),
    versions,
    sentence,
    signedCopy,
    dateText,
    dateTimeText,
  });

  root.JobDeputyAgreementText = api;
  if (typeof module === 'object' && module && typeof module.exports === 'object') {
    module.exports = api;
  }
})();
