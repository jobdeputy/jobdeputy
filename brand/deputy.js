// Deputy companion: the panda teammate on every signed-in page (docs/design-system.md, "Panda
// drawing" and "Deputy companion"; round 3 brief section 3.5, R3-2, and R3-8). The cast sheet,
// brand/deputy-preview.html, shows every state, reaction, gesture, and size.
//
// A classic script with one global, window.JobDeputyDeputy. It renders the approved panda drawing
// into every [data-deputy-art], prop-only illustrations into every [data-deputy-prop], and drives
// every [data-deputy] host: the state in data-deputy-state, its duty and speech copy, the blink, an
// idle gesture every 13 to 21s at rest, the one-time motion of each state, one-shot reactions to the
// person's actions (react), a moment held through a multi-step task such as a tour (hold and
// release), the loops that run only while work is in progress (data-deputy-working), Pause motion
// (kept in localStorage), reduced motion, and one arrive per browser session. brand/deputy.css owns
// every pose, motion, and size.
//
// Round 6 (the owner's G1, G2, G5, and G6): the panda smiles everywhere; the right paw always holds
// the tool of the moment (the tools table, shown on a badge where only the face shows), the left
// paw is free, and the bamboo leans beside him; and guide() puts the deputy in the tour card while
// the dock's panda steps out.
//
// Pause motion is page-wide: html[data-motion] is "on" while motion may run and "paused" while the
// person has paused it or prefers reduced motion. brand/app-chrome.css stops every page animation on
// it, and it follows Pause and Play, other tabs (the storage event), and the reduced-motion setting.
//
// Host attributes written here: data-deputy-mode (on, paused, or reduce), data-deputy-play (the
// state's one-time motion may run), data-deputy-gesture (an idle gesture is playing),
// data-deputy-held, data-deputy-blink, data-deputy-ready, data-deputy-agreement ("paused" while the
// deputy waits for the updated agreement), --deputy-look-x/y (only for notice, or an explicit
// look), and a gesture's aim (--deputy-glance-x/y, --deputy-turn, and --deputy-tilt).
(() => {
  if (window.JobDeputyDeputy) {
    return;
  }

  const MOTION_KEY = 'jobdeputy.deputyMotion';
  const ARRIVE_KEY = 'jobdeputy.deputyArrived';
  const LAST_KEY = 'jobdeputy.deputyLast';
  const ARRIVE_MS = 2605;
  const FLASH_MS = 1618;
  const REACT_MS = 2605;
  const SETTLE_MS = 618;
  const BLINK_MIN_MS = 5236;
  const BLINK_MAX_MS = 8472;
  const GESTURE_MIN_MS = 13000;
  const GESTURE_MAX_MS = 21000;
  // The first gesture after a page shows (or after Play, or when the tab is shown again) comes a
  // little sooner, 13 to 17s, so the deputy is seen to come alive well within 21s.
  const GESTURE_FIRST_MAX_MS = 17000;
  // A gesture waits this long after any other motion ends, so the deputy never fidgets.
  const QUIET_MS = 2605;
  const PAUSED_DUTY = 'Motion paused';
  // While your deputy is paused for an unsigned agreement (round 5, G1:
  // JobDeputyStore.agreements().paused), every duty the deputy can show gives way to these words,
  // which match the page's pause banner, and its resting line says why; signing brings each page's
  // own words back (round 5 acceptance, D-10). The cast sheet and the public Help never pause.
  const AGREEMENT_DUTY = 'Paused until you sign';
  const AGREEMENT_SPEECH = 'I wait until you sign.';
  // While the tour panda is in the tour card (guide(), round 6, G6), the dock's panda steps out:
  // the ledge and the leaning bamboo stay, with these words.
  const AWAY_DUTY = 'Showing you around';
  const AWAY_SPEECH = 'I’m in the tour card.';
  const POINTS = ['left', 'right', 'up', 'down'];
  // A background notice (a prompt test that finished, a run that needs answers) lives with the
  // deputy until you open Activity (round 6, UAT M-19): its duty says it in three words or fewer
  // and its dot becomes the matching mark, so on phones the notice sits in the app bar's chip and
  // never over the page. Done notices clear on their own after 13s.
  const NOTICE_DUTY = { 'needs-you': 'Needs you', stopped: 'Job stopped', done: 'Done' };
  const NOTICE_DONE_MS = 13000;
  const NOTICE_SEEN_KEY = 'jobdeputy.deputyNoticesSeen';

  // Every state in the round 1 brief (section 4), with fill (the autofill preview) and invite
  // (Invite friends) from round 2 (section 3.8), and guide (a tour) from round 3. duty is 3 words or
  // fewer and speech 6 words or fewer. A page state can become the page's own state; a moment shows
  // over it (arrive and success return to it on their own). motion is the one-time motion in ms
  // after the 618ms settle; loop marks the states that repeat every 5.236s, and only while the page
  // flags work in progress.
  const states = {
    idle: { duty: 'Ready', speech: 'Here when you need me.', kind: 'page', motion: 0 },
    arrive: {
      duty: 'Joining you',
      speech: 'Hi, Alex. Let’s get going.',
      kind: 'moment',
      motion: 1350,
    },
    report: { duty: 'Reporting in', speech: 'Here’s what I found.', kind: 'page', motion: 987 },
    search: {
      duty: 'Searching',
      speech: 'Checking your sources now.',
      kind: 'page',
      motion: 2605,
      loop: true,
    },
    filter: { duty: 'Filtering', speech: 'I set weak fits aside.', kind: 'page', motion: 1618 },
    rank: { duty: 'Ranking', speech: 'Best fits are on top.', kind: 'page', motion: 1618 },
    choose: { duty: 'Waiting on you', speech: 'Your call on these.', kind: 'page', motion: 987 },
    tailor: {
      duty: 'Tailoring',
      speech: 'Drafting for this role.',
      kind: 'page',
      motion: 2605,
      loop: true,
    },
    approve: {
      duty: 'Awaiting approval',
      speech: 'Nothing sends without you.',
      kind: 'page',
      motion: 987,
    },
    track: { duty: 'Keeping track', speech: 'I log every step.', kind: 'page', motion: 1618 },
    watch: { duty: 'Keeping watch', speech: 'I only watch if asked.', kind: 'page', motion: 2605 },
    'protect-data': {
      duty: 'Guarding your data',
      speech: 'Your data stays in the US.',
      kind: 'page',
      motion: 618,
    },
    'hold-key': {
      duty: 'Holding your key',
      speech: 'Your key stays yours.',
      kind: 'page',
      motion: 987,
    },
    // True in every applying mode (T3-R5): Review, then auto-apply sends what you approved once,
    // with no check of each form; Review each form adds that check, which its page says.
    fill: {
      duty: 'Filling forms',
      speech: 'I fill what you approved.',
      kind: 'page',
      motion: 1618,
      loop: true,
    },
    invite: {
      duty: 'Inviting friends',
      speech: 'Bring a friend along.',
      kind: 'page',
      motion: 987,
    },
    // Round 6 (S1): the Prompts page. Its checks tick in turn, and loop only while a prompt test
    // runs; the duty then reads workingDuty.
    test: {
      duty: 'Checking prompts',
      workingDuty: 'Testing prompts',
      speech: 'I test before I switch.',
      kind: 'page',
      motion: 1618,
      loop: true,
    },
    notice: { duty: 'Listening', speech: 'Take your time.', kind: 'moment', motion: 0 },
    pending: { duty: 'Working', speech: 'On it.', kind: 'moment', motion: 0, loop: true },
    success: { duty: 'Done', speech: 'All set.', kind: 'moment', motion: 618 },
    error: {
      duty: 'Needs attention',
      speech: 'Let’s fix this together.',
      kind: 'moment',
      motion: 987,
    },
    guide: {
      duty: 'Showing you around',
      speech: 'Let me show you around.',
      kind: 'moment',
      motion: 987,
    },
  };

  // Reactions (R3-8): react(name) answers one of the person's actions. Each has a pose of its own
  // (error shares the error state's), a duty, and a speech line. Its motion starts as the pose
  // settles and ends by motion ms (1.605s: a 618ms settle, then 987ms); the pose and the line stay
  // for REACT_MS (2.605s, time to read the line), and the deputy settles back into the page state.
  // Paused and reduced motion swap the pose at once and show the line.
  const reactions = {
    added: { duty: 'Added', speech: 'Added to Applications.', motion: 1605 },
    dismissed: { duty: 'Set aside', speech: 'I set that one aside.', motion: 1605 },
    saved: { duty: 'Saved', speech: 'Saved. I’ll use this.', motion: 1605 },
    sent: { duty: 'Sent', speech: 'Sent. Thank you.', motion: 1605 },
    copied: { duty: 'Copied', speech: 'Copied. Ready to paste.', motion: 1605 },
    archived: { duty: 'Archived', speech: 'Archived. History kept.', motion: 1605 },
    deleted: { duty: 'Deleted', speech: 'Deleted, as you asked.', motion: 1605 },
    started: { duty: 'Starting', speech: 'Starting your search.', motion: 1605 },
    found: { duty: 'Found roles', speech: 'I found new roles.', motion: 1605 },
    approved: { duty: 'Approved', speech: 'Approved. Thank you.', motion: 1605 },
    submitted: { duty: 'Submitted', speech: 'Submitted. I’ll track it.', motion: 1605 },
    celebrate: { duty: 'Well done', speech: 'Nicely done, Alex.', motion: 1605 },
    // Round 7 (G3): the signing moment, the pen raised in the right paw and a cheer.
    signed: { duty: 'Signed', speech: 'Signed. Thank you.', motion: 1605 },
    error: {
      duty: 'Needs attention',
      speech: 'Let’s fix this together.',
      motion: 1605,
      pose: 'error',
    },
  };

  // Idle gestures (R3-2): at rest the deputy blinks and makes one small move every 13 to 21s,
  // picked from its state's set so that it suits the work: it glances up at you from its work (or
  // back at the work), tilts its head, nods, twitches an ear, sways the leaning bamboo, or lifts what it
  // holds. Body gestures need the arms, which the rail medallion and the chip do not show, so those
  // sizes pick from the head gestures. glance is where the eyes go (x within ±5 and y within ±3
  // viewBox units, inside the eye-whites) and turn is the head's follow in degrees.
  const gestures = {
    glance: { ms: 1618, body: false },
    tilt: { ms: 1618, body: false },
    nod: { ms: 987, body: false },
    ear: { ms: 987, body: false },
    sway: { ms: 1618, body: true },
    lift: { ms: 987, body: true },
  };

  const gestureSets = {
    idle: { gestures: ['sway', 'ear', 'glance', 'tilt'], glance: [-5, 0], turn: -3 },
    report: { gestures: ['lift', 'glance', 'nod', 'ear'], glance: [0, 1], turn: -3 },
    search: { gestures: ['lift', 'glance', 'ear'], glance: [-5, -1], turn: -3 },
    filter: { gestures: ['lift', 'glance', 'ear'], glance: [0, 1], turn: -3 },
    rank: { gestures: ['sway', 'glance', 'nod'], glance: [1, 1], turn: 3 },
    choose: { gestures: ['lift', 'glance', 'tilt'], glance: [4, 2], turn: 3 },
    tailor: { gestures: ['lift', 'glance', 'tilt'], glance: [0, 0], turn: -3 },
    approve: { gestures: ['lift', 'glance', 'nod'], glance: [4, 1], turn: 3 },
    track: { gestures: ['lift', 'glance', 'nod'], glance: [0, 0], turn: -3 },
    watch: { gestures: ['glance', 'ear', 'tilt'], glance: [1, 0], turn: 3 },
    'protect-data': { gestures: ['lift', 'glance', 'ear'], glance: [4, 2], turn: 3 },
    'hold-key': { gestures: ['lift', 'glance', 'ear'], glance: [4, -1], turn: 3 },
    fill: { gestures: ['sway', 'glance', 'tilt'], glance: [0, 0], turn: -3 },
    invite: { gestures: ['lift', 'glance', 'ear'], glance: [5, -2], turn: 3 },
    test: { gestures: ['lift', 'glance', 'nod'], glance: [0, 1], turn: -3 },
    guide: { gestures: ['lift', 'glance', 'nod'], glance: [0, 1], turn: -3 },
  };

  // Pause motion's icon: two bars to pause, a triangle to play (24-unit line icons, as in AppNav).
  const motionIcons = {
    pause: '<path d="M9 6.5v11M15 6.5v11" />',
    play: '<path d="M8.5 5.5v13l10-6.5Z" />',
  };

  // The shield shows the home Region code; protect-data's default speech names the Region.
  const regions = { US: 'the US', IN: 'India', UK: 'the UK' };

  // Prop geometry is drawn around a grip point at (0, 0), so the paw holds the same shapes
  // (translated to the paw grip at 281 326) that renderProp draws alone.
  const reportCard = `<rect x="-10" y="-74" width="96" height="68" rx="11" fill="#faf8f3" stroke="rgba(27, 26, 24, 0.24)" stroke-width="2.5" data-token="paper / line-strong" />
        <path d="M4 -58H40" fill="none" stroke="#2d2b27" stroke-width="6" stroke-linecap="round" data-token="ink-soft" />
        <path d="M4 -44H62M4 -32H42" fill="none" stroke="#98948b" stroke-width="4.5" stroke-linecap="round" stroke-opacity="0.7" data-token="quiet (70%)" />
        <path d="M54 -16V-24M64 -16V-30M74 -16V-38" fill="none" stroke="#526fe5" stroke-width="6" stroke-linecap="round" data-token="blue" />
        <circle cx="82" cy="-72" r="14" fill="#2f9e77" stroke="#faf8f3" stroke-width="3" data-token="green / paper" />
        <path d="M75.5 -72.5L80 -68L88.5 -76.5" fill="none" stroke="#faf8f3" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" data-token="paper" />`;

  const jobCard = `<rect x="-10" y="-56" width="88" height="50" rx="10" fill="#faf8f3" stroke="rgba(27, 26, 24, 0.24)" stroke-width="2.5" data-token="paper / line-strong" />
        <rect x="0" y="-46" width="17" height="17" rx="5" fill="#d9def8" data-token="blue-soft" />
        <path d="M25 -41H64" fill="none" stroke="#2d2b27" stroke-width="5" stroke-linecap="round" stroke-opacity="0.85" data-token="ink-soft (85%)" />
        <path d="M25 -29H50" fill="none" stroke="#98948b" stroke-width="4.5" stroke-linecap="round" stroke-opacity="0.7" data-token="quiet (70%)" />`;

  const bestCard = `<rect x="-10" y="-56" width="88" height="50" rx="10" fill="#ccebdc" stroke="#2f9e77" stroke-width="2.5" data-token="green-soft / green" />
        <rect x="0" y="-46" width="17" height="17" rx="5" fill="#faf8f3" data-token="paper" />
        <path d="M25 -41H64" fill="none" stroke="#2d2b27" stroke-width="5" stroke-linecap="round" stroke-opacity="0.85" data-token="ink-soft (85%)" />
        <path d="M25 -29H50" fill="none" stroke="#23795b" stroke-width="4.5" stroke-linecap="round" stroke-opacity="0.55" data-token="green-ink (55%)" />
        <circle cx="76" cy="-54" r="11" fill="#2f9e77" stroke="#faf8f3" stroke-width="3" data-token="green / paper" />
        <path d="M71 -54.5L74.5 -51L81 -57.5" fill="none" stroke="#faf8f3" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" data-token="paper" />`;

  // choose: three job cards fanned in the paw, held out toward the person.
  const fanCard = (
    tile,
    token,
  ) => `<rect x="-8" y="-52" width="70" height="46" rx="9" fill="#faf8f3" stroke="rgba(27, 26, 24, 0.24)" stroke-width="2.5" data-token="paper / line-strong" />
          <rect x="1" y="-43" width="15" height="15" rx="4.5" fill="${tile}" data-token="${token}" />
          <path d="M22 -38H52" fill="none" stroke="#2d2b27" stroke-width="4.5" stroke-linecap="round" stroke-opacity="0.85" data-token="ink-soft (85%)" />
          <path d="M22 -27H44" fill="none" stroke="#98948b" stroke-width="4" stroke-linecap="round" stroke-opacity="0.7" data-token="quiet (70%)" />`;

  const offerFan = `<g transform="rotate(-20)">${fanCard('#ffd5c6', 'orange-soft')}</g>
        <g transform="rotate(-5)">${fanCard('#d9def8', 'blue-soft')}</g>
        <g transform="rotate(10)">${fanCard('#f0ece3', 'paper-deep')}</g>`;

  const approvalCard = `<rect x="-12" y="-110" width="80" height="104" rx="13" fill="#faf8f3" stroke="rgba(27, 26, 24, 0.24)" stroke-width="2.5" data-token="paper / line-strong" />
        <path d="M2 -92H36" fill="none" stroke="#2d2b27" stroke-width="6" stroke-linecap="round" data-token="ink-soft" />
        <path d="M2 -78H52M2 -66H34" fill="none" stroke="#98948b" stroke-width="4.5" stroke-linecap="round" stroke-opacity="0.7" data-token="quiet (70%)" />
        <g class="deputy-approval-check"><circle cx="28" cy="-34" r="17" fill="#ccebdc" stroke="#2f9e77" stroke-width="4" data-token="green-soft / green" />
          <path d="M19.5 -34.5L25.5 -28.5L37 -40" fill="none" stroke="#23795b" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round" data-token="green-ink" /></g>`;

  const clipboard = `<rect x="-12" y="-114" width="82" height="108" rx="11" fill="#ffd5c6" stroke="#f36b3f" stroke-width="2.5" stroke-opacity="0.5" data-token="orange-soft / orange (50%)" />
        <rect x="-3" y="-101" width="64" height="86" rx="6" fill="#faf8f3" data-token="paper" />
        <rect x="14" y="-121" width="30" height="15" rx="5" fill="#1b1a18" data-token="ink" />
        <circle cx="29" cy="-116" r="2.6" fill="#faf8f3" data-token="paper" />
        <path d="M5 -88H18V-75H5ZM5 -64H18V-51H5ZM5 -40H18V-27H5Z" fill="none" stroke="#98948b" stroke-width="2" stroke-linejoin="round" data-token="quiet" />
        <path d="M26 -81.5H51M26 -57.5H47M26 -33.5H50" fill="none" stroke="#98948b" stroke-width="4.5" stroke-linecap="round" stroke-opacity="0.7" data-token="quiet (70%)" />
        <g class="deputy-tick deputy-tick-1"><path d="M8 -82L11 -78.5L16 -86" pathLength="1" fill="none" stroke="#23795b" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" data-token="green-ink" /></g>
        <g class="deputy-tick deputy-tick-2"><path d="M8 -58L11 -54.5L16 -62" pathLength="1" fill="none" stroke="#23795b" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" data-token="green-ink" /></g>
        <g class="deputy-tick deputy-tick-3"><path d="M8 -34L11 -30.5L16 -38" pathLength="1" fill="none" stroke="#23795b" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" data-token="green-ink" /></g>`;

  const shield = `<path d="M30 -102L72 -88V-52C72 -22 52 -2 30 8C8 -2 -12 -22 -12 -52V-88Z" fill="#d9def8" stroke="#526fe5" stroke-width="5" stroke-linejoin="round" data-token="blue-soft / blue" />
        <path d="M30 -90L62 -79.5V-52C62 -29 47 -14 30 -6C13 -14 -2 -29 -2 -52V-79.5Z" fill="#faf8f3" data-token="paper" />
        <text class="deputy-region-code" x="30" y="-37" text-anchor="middle" fill="#1b1a18" data-token="ink">US</text>`;

  const page = `<path d="M-32 -42H16L32 -26V44H-32Z" fill="#faf8f3" stroke="rgba(27, 26, 24, 0.24)" stroke-width="2.5" stroke-linejoin="round" data-token="paper / line-strong" />
        <path d="M16 -42V-26H32" fill="#f0ece3" stroke="rgba(27, 26, 24, 0.24)" stroke-width="2.5" stroke-linejoin="round" data-token="paper-deep / line-strong" />
        <path d="M-21 -24H6M-21 -10H20M-21 4H14M-21 33H8" fill="none" stroke="#98948b" stroke-width="4.5" stroke-linecap="round" stroke-opacity="0.7" data-token="quiet (70%)" />
        <g class="deputy-page-line"><path d="M-21 19H20" pathLength="1" fill="none" stroke="#2f9e77" stroke-width="5" stroke-linecap="round" data-token="green" /></g>`;

  const rankCard = `<rect x="0" y="0" width="86" height="30" rx="8" fill="#faf8f3" stroke="rgba(27, 26, 24, 0.24)" stroke-width="2.5" data-token="paper / line-strong" />
            <path d="M13 11H55M13 20H40" fill="none" stroke="#98948b" stroke-width="4" stroke-linecap="round" stroke-opacity="0.7" data-token="quiet (70%)" />`;

  const rankBest = `<rect x="0" y="0" width="86" height="30" rx="8" fill="#ccebdc" stroke="#2f9e77" stroke-width="2.5" data-token="green-soft / green" />
            <path d="M15 11H57M15 20H42" fill="none" stroke="#23795b" stroke-width="4" stroke-linecap="round" stroke-opacity="0.6" data-token="green-ink (60%)" />
            <g class="deputy-rank-rule"><path d="M6.5 7V23" fill="none" stroke="#2f9e77" stroke-width="5" stroke-linecap="round" data-token="green" /></g>`;

  const rankStack = `<g class="deputy-rank-card deputy-rank-second"><g transform="translate(0 38)">${rankCard}</g></g>
          <g class="deputy-rank-card deputy-rank-third"><g transform="translate(0 76)">${rankCard}</g></g>
          <g class="deputy-rank-card deputy-rank-best"><g transform="translate(0 0)">${rankBest}</g></g>`;

  // watch: an alarm clock held in the paw (round 6, R6-1; it used to stand beside the head), with
  // two bells and two legs; its minute hand is the part that turns.
  const clock = `<circle cx="10" cy="-64" r="9" fill="#526fe5" data-token="blue" />
        <circle cx="50" cy="-64" r="9" fill="#526fe5" data-token="blue" />
        <path d="M14 -14L8 -4M46 -14L52 -4" fill="none" stroke="#2d2b27" stroke-width="5" stroke-linecap="round" data-token="ink-soft" />
        <circle cx="30" cy="-40" r="27" fill="#faf8f3" stroke="#526fe5" stroke-width="5" data-token="paper / blue" />
        <path d="M30 -59V-55M49 -40H45M30 -21V-25M11 -40H15" fill="none" stroke="#526fe5" stroke-width="3" stroke-linecap="round" stroke-opacity="0.55" data-token="blue (55%)" />
        <path d="M30 -40L39 -34" fill="none" stroke="#1b1a18" stroke-width="4" stroke-linecap="round" data-token="ink" />
        <g class="deputy-clock-hand"><path d="M30 -40V-55" fill="none" stroke="#1b1a18" stroke-width="4" stroke-linecap="round" data-token="ink" /></g>
        <circle cx="30" cy="-40" r="3.5" fill="#f36b3f" data-token="orange" />`;

  const glint = `<path d="M13 -31L15 -25L21 -23L15 -21L13 -15L11 -21L5 -23L11 -25Z" fill="#faf8f3" stroke="#f36b3f" stroke-width="1.5" stroke-linejoin="round" data-token="paper / orange" />`;

  const magnifier = `<path d="M3 -4L20 -26" fill="none" stroke="#526fe5" stroke-width="11" stroke-linecap="round" data-token="blue" />
                    <circle cx="34" cy="-43" r="22" fill="#d9def8" fill-opacity="0.52" stroke="#526fe5" stroke-width="8" data-token="blue-soft (52%) / blue" />
                    <path d="M23 -48Q31 -57 41 -51" fill="none" stroke="#faf8f3" stroke-width="4" stroke-linecap="round" opacity="0.85" data-token="paper" />`;

  const key = `<path d="M0 -26V-62M0 -55H9M0 -46H7" fill="none" stroke="#f36b3f" stroke-width="6.5" stroke-linecap="round" stroke-linejoin="round" data-token="orange" />
                    <circle cx="0" cy="-15" r="11.5" fill="#faf8f3" stroke="#f36b3f" stroke-width="6.5" data-token="paper / orange" />`;

  // fill: a pen held under the paw grip like the pencil (a blue barrel, a clip, a dark nib), and a
  // form card that stands beside the panda like the tailor page: a header and three fields, each
  // filled in turn (its value line draws) and then ticked.
  const pen = `<path d="M-9 10L27 -26" fill="none" stroke="#526fe5" stroke-width="9" stroke-linecap="round" data-token="blue" />
        <path d="M-9 10L-13 14" fill="none" stroke="#2d2b27" stroke-width="9" stroke-linecap="round" data-token="ink-soft" />
        <path d="M-1 -5.8L12 -18.8" fill="none" stroke="#2d2b27" stroke-width="2.5" stroke-linecap="round" data-token="ink-soft" />
        <path d="M27 -26L30 -29" fill="none" stroke="#f0ece3" stroke-width="9" data-token="paper-deep" />
        <path d="M29 -32.5L42 -42L32.5 -29Z" fill="#2d2b27" stroke="#2d2b27" stroke-width="2" stroke-linejoin="round" data-token="ink-soft" />
        <path d="M39 -40L42 -42L40 -39Z" fill="#1b1a18" stroke="#1b1a18" stroke-width="2.4" stroke-linejoin="round" data-token="ink" />`;

  const formField = (
    y,
    end,
    n,
  ) => `<rect x="-25" y="${y - 6.5}" width="52" height="13" rx="4.5" fill="#faf8f3" stroke="rgba(27, 26, 24, 0.24)" stroke-width="2" data-token="paper / line-strong" />
        <g class="deputy-fill-value deputy-fill-value-${n}"><path d="M-19.5 ${y}H${end}" pathLength="1" fill="none" stroke="#2d2b27" stroke-width="4" stroke-linecap="round" stroke-opacity="0.85" data-token="ink-soft (85%)" /></g>
        <g class="deputy-fill-tick deputy-fill-tick-${n}"><circle cx="19.5" cy="${y}" r="5" fill="#2f9e77" data-token="green" /><path d="M17.3 ${y}L18.9 ${y + 1.6}L21.8 ${y - 1.7}" fill="none" stroke="#faf8f3" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" data-token="paper" /></g>`;

  const form = `<rect x="-33" y="-42" width="66" height="84" rx="9" fill="#faf8f3" stroke="rgba(27, 26, 24, 0.24)" stroke-width="2.5" data-token="paper / line-strong" />
        <rect x="-23" y="-34" width="10" height="10" rx="3" fill="#d9def8" data-token="blue-soft" />
        <path d="M-8 -29H14" fill="none" stroke="#2d2b27" stroke-width="5" stroke-linecap="round" data-token="ink-soft" />
        ${formField(-12, 7, 1)}
        ${formField(8, 2, 2)}
        ${formField(28, 9, 3)}`;

  // invite: an envelope held at its corner, the flap open, and a small ticket that slides up out
  // of the pocket: the bonus AI credits a friend's first search earns you (100,000 tokens' worth),
  // drawn as the AI credits sparkle rather than a figure, which reads at every size the pose shows
  // and never repeats or contradicts the page's numbers (round 5 acceptance, fix 15; the variants
  // the owner can choose from are on a cast sheet in the round's work folder).
  const envelope = `<rect x="6" y="-60" width="78" height="54" rx="7" fill="#f0ece3" stroke="rgba(27, 26, 24, 0.24)" stroke-width="2.5" data-token="paper-deep / line-strong" />
        <path d="M8 -58L45 -82L82 -58Z" fill="#faf8f3" stroke="rgba(27, 26, 24, 0.24)" stroke-width="2.5" stroke-linejoin="round" data-token="paper / line-strong" />
        <g class="deputy-letter" opacity="0"><rect x="20" y="-70" width="50" height="40" rx="5" fill="#faf8f3" stroke="rgba(27, 26, 24, 0.24)" stroke-width="2" data-token="paper / line-strong" />
          <path d="M28 -60H58M28 -50H50" fill="none" stroke="#98948b" stroke-width="3.5" stroke-linecap="round" stroke-opacity="0.7" data-token="quiet (70%)" /></g>
        <g class="deputy-ticket"><rect x="26" y="-70" width="38" height="32" rx="6" fill="#ccebdc" stroke="#2f9e77" stroke-width="2.5" data-token="green-soft / green" />
          <path class="deputy-ticket-mark" d="M45 -66.5Q46.6 -57.6 54 -55.5Q46.6 -53.4 45 -44.5Q43.4 -53.4 36 -55.5Q43.4 -57.6 45 -66.5Z" fill="#23795b" data-token="green-ink" /></g>
        <path d="M6 -40H84V-12Q84 -6 78 -6H12Q6 -6 6 -12Z" fill="#faf8f3" stroke="rgba(27, 26, 24, 0.24)" stroke-width="2.5" stroke-linejoin="round" data-token="paper / line-strong" />
        <path d="M10 -10L45 -29L80 -10" fill="none" stroke="#98948b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" stroke-opacity="0.7" data-token="quiet (70%)" />`;

  // saved: a green check badge raised beside the head, clear of the face.
  const checkBadge = `<circle cx="18" cy="-42" r="22" fill="#ccebdc" stroke="#2f9e77" stroke-width="4" data-token="green-soft / green" />
        <path d="M8 -42.5L15 -35.5L29 -49.5" fill="none" stroke="#23795b" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" data-token="green-ink" />`;

  // copied: a card and its copy; the copy (front, with a green tick) slides out from behind it.
  const copyCards = `<rect x="0" y="-74" width="60" height="44" rx="9" fill="#f0ece3" stroke="rgba(27, 26, 24, 0.24)" stroke-width="2.5" data-token="paper-deep / line-strong" />
        <path d="M11 -60H40M11 -48H30" fill="none" stroke="#98948b" stroke-width="4" stroke-linecap="round" stroke-opacity="0.7" data-token="quiet (70%)" />
        <g class="deputy-copy-front"><rect x="14" y="-60" width="60" height="44" rx="9" fill="#faf8f3" stroke="rgba(27, 26, 24, 0.24)" stroke-width="2.5" data-token="paper / line-strong" />
          <path d="M25 -46H54" fill="none" stroke="#2d2b27" stroke-width="4.5" stroke-linecap="round" stroke-opacity="0.85" data-token="ink-soft (85%)" />
          <path d="M25 -34H46" fill="none" stroke="#98948b" stroke-width="4" stroke-linecap="round" stroke-opacity="0.7" data-token="quiet (70%)" />
          <circle cx="70" cy="-58" r="10" fill="#2f9e77" stroke="#faf8f3" stroke-width="3" data-token="green / paper" />
          <path d="M65.5 -58.5L68.7 -55.3L74.5 -61.1" fill="none" stroke="#faf8f3" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" data-token="paper" /></g>`;

  // archived: an archive box (paper-deep, a paper rim, and a handle slot) held in front. The card
  // rests inside it, hidden by the box front and rim drawn over it, and drops in from above.
  const archiveBox = `<g class="deputy-archive-card"><rect x="8" y="-58" width="56" height="40" rx="8" fill="#faf8f3" stroke="rgba(27, 26, 24, 0.24)" stroke-width="2.5" data-token="paper / line-strong" />
          <path d="M18 -46H46" fill="none" stroke="#2d2b27" stroke-width="4.5" stroke-linecap="round" stroke-opacity="0.85" data-token="ink-soft (85%)" />
          <path d="M18 -34H38" fill="none" stroke="#98948b" stroke-width="4" stroke-linecap="round" stroke-opacity="0.7" data-token="quiet (70%)" /></g>
        <path d="M-8 -50H80V-12Q80 -4 72 -4H0Q-8 -4 -8 -12Z" fill="#f0ece3" stroke="rgba(27, 26, 24, 0.24)" stroke-width="2.5" stroke-linejoin="round" data-token="paper-deep / line-strong" />
        <path d="M26 -30H46" fill="none" stroke="#2d2b27" stroke-width="5" stroke-linecap="round" stroke-opacity="0.85" data-token="ink-soft (85%)" />
        <rect x="-14" y="-62" width="100" height="14" rx="5" fill="#faf8f3" stroke="rgba(27, 26, 24, 0.24)" stroke-width="2.5" data-token="paper / line-strong" />`;

  // deleted: a bin held in the paw; the card drops into it, behind the bin's front and rim.
  const bin = `<g class="deputy-drop-card"><g transform="translate(0 8)">${jobCard}</g></g>
        <path d="M-12 -46H80L74 -4Q73 2 67 2H1Q-5 2 -6 -4Z" fill="#f0ece3" stroke="rgba(27, 26, 24, 0.24)" stroke-width="2.5" stroke-linejoin="round" data-token="paper-deep / line-strong" />
        <path d="M14 -36V-10M34 -36V-10M54 -36V-10" fill="none" stroke="#98948b" stroke-width="3.5" stroke-linecap="round" stroke-opacity="0.7" data-token="quiet (70%)" />
        <rect x="-18" y="-58" width="104" height="13" rx="5" fill="#faf8f3" stroke="rgba(27, 26, 24, 0.24)" stroke-width="2.5" data-token="paper / line-strong" />`;

  // Round 6 (R6-1, one hand rule): the right paw always holds the tool of the moment. idle and
  // error hold a help card (a question mark in a blue-soft circle beside two lines).
  const helpCard = `<rect x="-10" y="-66" width="82" height="60" rx="11" fill="#faf8f3" stroke="rgba(27, 26, 24, 0.24)" stroke-width="2.5" data-token="paper / line-strong" />
        <circle cx="16" cy="-42" r="14" fill="#d9def8" stroke="#526fe5" stroke-width="3" data-token="blue-soft / blue" />
        <path d="M11.2 -46.4Q11.8 -52.4 16.4 -52.2Q21.2 -52 21 -47.2Q20.8 -43.8 16.4 -41.8V-39.2" fill="none" stroke="#1b1a18" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round" data-token="ink" />
        <circle cx="16.4" cy="-33.4" r="2.4" fill="#1b1a18" data-token="ink" />
        <path d="M38 -48H60M38 -36H54M2 -16H58" fill="none" stroke="#98948b" stroke-width="4.5" stroke-linecap="round" stroke-opacity="0.7" data-token="quiet (70%)" />`;

  // pending: an hourglass, its sand running into an orange heap.
  const hourglass = `<path d="M2 -84H46Q46 -62 30 -47Q46 -32 46 -10H2Q2 -32 18 -47Q2 -62 2 -84Z" fill="#faf8f3" stroke="rgba(27, 26, 24, 0.24)" stroke-width="2.5" stroke-linejoin="round" data-token="paper / line-strong" />
        <path d="M11 -76H37Q35 -64 24 -56Q13 -64 11 -76Z" fill="#ffd5c6" data-token="orange-soft" />
        <path d="M24 -55V-28" fill="none" stroke="#f36b3f" stroke-width="2.5" stroke-linecap="round" data-token="orange" />
        <path d="M7 -12Q10 -25 24 -28Q38 -25 41 -12Z" fill="#f36b3f" data-token="orange" />
        <rect x="-4" y="-94" width="56" height="10" rx="5" fill="#2d2b27" data-token="ink-soft" />
        <rect x="-4" y="-10" width="56" height="10" rx="5" fill="#2d2b27" data-token="ink-soft" />`;

  // guide, rank, and the entry's explain-region: a pointer, a slim stick with a green tip, drawn
  // pointing up from the paw; each pose turns it toward what it shows.
  const pointer = `<path d="M0 10V-112" fill="none" stroke="#2d2b27" stroke-width="6" stroke-linecap="round" data-token="ink-soft" />
        <circle cx="0" cy="-118" r="8.5" fill="#2f9e77" stroke="#faf8f3" stroke-width="3" data-token="green / paper" />`;

  // The tour panda's pointer (guide()): the same pointer drawn bolder, so it reads in the small
  // tour bust.
  const tourPointer = `<path d="M0 8V-92" fill="none" stroke="#2d2b27" stroke-width="11" stroke-linecap="round" data-token="ink-soft" />
        <circle cx="0" cy="-100" r="13" fill="#2f9e77" stroke="#faf8f3" stroke-width="4" data-token="green / paper" />`;

  // test (round 6, the Prompts page): a test card, a blue-soft header with a play mark, and three
  // checks that tick in turn while a prompt test runs.
  const testRow = (
    y,
    end,
    n,
  ) => `<circle cx="5" cy="${y}" r="7.5" fill="#faf8f3" stroke="rgba(27, 26, 24, 0.24)" stroke-width="2.2" data-token="paper / line-strong" />
        <path d="M20 ${y}H${end}" fill="none" stroke="#98948b" stroke-width="4.5" stroke-linecap="round" stroke-opacity="0.7" data-token="quiet (70%)" />
        <g class="deputy-test-tick deputy-test-tick-${n}"><path d="M1.4 ${y - 0.2}L4 ${y + 2.8}L9 ${y - 3.6}" pathLength="1" fill="none" stroke="#23795b" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round" data-token="green-ink" /></g>`;

  const testCard = `<rect x="-12" y="-110" width="86" height="104" rx="12" fill="#faf8f3" stroke="rgba(27, 26, 24, 0.24)" stroke-width="2.5" data-token="paper / line-strong" />
        <path d="M-10.75 -86V-97Q-10.75 -108.75 1 -108.75H61Q72.75 -108.75 72.75 -97V-86Z" fill="#d9def8" data-token="blue-soft" />
        <path d="M2 -97H38" fill="none" stroke="#2d2b27" stroke-width="5.5" stroke-linecap="round" data-token="ink-soft" />
        <path d="M54 -102.5L63 -97L54 -91.5Z" fill="#526fe5" stroke="#526fe5" stroke-width="1.5" stroke-linejoin="round" data-token="blue" />
        ${testRow(-70, 58, 1)}
        ${testRow(-48, 50, 2)}
        ${testRow(-26, 56, 3)}`;

  // The soft static fields and the ledge behind the drawing (styled by deputy.css).
  const stage =
    '<span class="deputy-field deputy-field-one"></span><span class="deputy-field deputy-field-two"></span><span class="deputy-field deputy-field-three"></span><span class="deputy-ledge"></span>';

  // Panda drawing: start. The approved "Polished" panda, shared with the entry Panda teammate layer
  // (brand/login-preview.html and brand/access-preview.html carry the same head, body, bamboo, and
  // the props the entry story uses); only the clip-path and gradient ids take a per-instance prefix
  // (__NS__). Round 6 (R6-1): the face smiles (an open smile with a small tongue, lifted lower lids,
  // lifted cheeks, and a second catchlight); the bamboo leans on the ledge beside the panda, a little
  // behind his left side, in no arm; the left paw is free; and every tool sits inside arm-right,
  // under the paw grip. The scene props stand behind the panda. Geometry transforms stay on child
  // groups; deputy.css moves only the wrappers.
  const drawing = `<svg class="deputy-panda" viewBox="0 0 420 420" aria-hidden="true" focusable="false">
            <defs>
              <clipPath id="__NS__-eye-l"><ellipse cx="167" cy="162" rx="13.6" ry="14.4" /></clipPath>
              <clipPath id="__NS__-eye-r"><ellipse cx="253" cy="162" rx="13.6" ry="14.4" /></clipPath>
              <radialGradient id="__NS__-ear-felt" cx="0.38" cy="0.3" r="0.62"><stop offset="0" stop-color="#2d2b27" stop-opacity="1" data-token="ink-soft" /><stop offset="0.55" stop-color="#2d2b27" stop-opacity="0.45" data-token="ink-soft (45%)" /><stop offset="1" stop-color="#2d2b27" stop-opacity="0" data-token="ink-soft (0%)" /></radialGradient>
            </defs>

            <ellipse class="panda-shadow" cx="210" cy="386" rx="118" ry="14" fill="#1b1a18" opacity="0.12" data-token="ink (12%)" />

            <g class="deputy-scene-props">
              <g class="deputy-prop deputy-rank" opacity="0">
                <g transform="translate(318 132)">
          ${rankStack}
                </g>
              </g>
              <g class="deputy-ledge-prop">
                <g class="deputy-prop deputy-weak" opacity="0">
                  <g transform="translate(330 380) rotate(9 34 -31)">
        ${jobCard}
                  </g>
                </g>
              </g>
              <g class="deputy-prop deputy-page" opacity="0">
                <g transform="translate(386 282) rotate(4)">
        ${page}
                </g>
              </g>
              <g class="deputy-prop deputy-form" opacity="0">
                <g transform="translate(391 256)">
        ${form}
                </g>
              </g>
            </g>

            <g class="bamboo-lean">
              <g class="bamboo">
                <g transform="translate(-69 0) rotate(13 117 386) translate(117 386) scale(0.72) translate(-117 -386)">
                  <path d="M122 220L117 386" fill="none" stroke="#2f9e77" stroke-width="12" stroke-linecap="round" data-token="green" />
                  <path d="M113.73 262H127.73M112.47 304H126.47M111.14 348H125.14" fill="none" stroke="#23795b" stroke-width="2.6" stroke-linecap="round" data-token="green-ink" />
                  <path d="M121.46 238C100.46 216 78.46 222 82.46 242C96.46 248 110.46 246 121.46 238Z" fill="#2f9e77" data-token="green" />
                  <path d="M120.46 252C98.46 252 86.46 268 94.46 280C108.46 278 118.46 266 120.46 252Z" fill="#ccebdc" data-token="green-soft" />
                  <circle cx="122" cy="220" r="9" fill="#ccebdc" data-token="green-soft" />
                  <circle cx="122" cy="220" r="3.6" fill="#2f9e77" data-token="green" />
                </g>
              </g>
            </g>

            <g class="panda-body">
              <g class="panda-torso">
                <ellipse cx="210" cy="304" rx="80" ry="84" fill="#2d2b27" data-token="ink-soft" />
                <ellipse cx="210" cy="324" rx="70" ry="58" fill="#f0ece3" data-token="paper-deep" />
                <ellipse cx="210" cy="318" rx="67" ry="52" fill="#faf8f3" data-token="paper" />
              </g>

              <g class="panda-feet">
                <g class="panda-foot foot-left">
                  <g transform="rotate(-12 150 368)">
                    <ellipse cx="150" cy="368" rx="45" ry="25" fill="#1b1a18" data-token="ink" />
                  </g>
                </g>
                <g class="panda-foot foot-right">
                  <g transform="rotate(12 270 368)">
                    <ellipse cx="270" cy="368" rx="45" ry="25" fill="#1b1a18" data-token="ink" />
                  </g>
                </g>
              </g>

              <g class="panda-head">
                <g class="panda-ears">
                  <g class="panda-ear ear-left"><circle cx="139" cy="96.5" r="33.22" fill="#1b1a18" data-token="ink" />
                    <circle class="ear-inner" cx="136.23" cy="100.19" r="18.6" fill="#2d2b27" data-token="ink-soft" />
                    <circle class="ear-sheen" cx="139" cy="96.5" r="33.22" fill="url(#__NS__-ear-felt)" data-token="ink-soft sheen (gradient)" /></g>
                  <g class="panda-ear ear-right"><circle cx="281" cy="96.5" r="33.22" fill="#1b1a18" data-token="ink" />
                    <circle class="ear-inner" cx="283.77" cy="100.19" r="18.6" fill="#2d2b27" data-token="ink-soft" />
                    <circle class="ear-sheen" cx="281" cy="96.5" r="33.22" fill="url(#__NS__-ear-felt)" data-token="ink-soft sheen (gradient)" /></g>
                </g>
                <g class="panda-face">
                  <path class="face-shape" d="M210 72C266 72 310 103.16 310 154C310 208 267 244 210 244C153 244 110 208 110 154C110 103.16 154 72 210 72Z" fill="#faf8f3" stroke="rgba(27, 26, 24, 0.24)" stroke-width="2" data-token="paper / line-strong" />
                  <path class="face-shade" d="M118 183.7C128 222 165 244 210 244C255 244 292 222 302 183.7C288 216 265 232 210 232C155 232 132 216 118 183.7Z" fill="#f0ece3" data-token="paper-deep" />
                  <ellipse class="patch patch-left" cx="166" cy="163" rx="28" ry="33" fill="#1b1a18" transform="rotate(16 166 163)" data-token="ink" />
                  <ellipse class="patch patch-right" cx="254" cy="163" rx="28" ry="33" fill="#1b1a18" transform="rotate(-16 254 163)" data-token="ink" />
                  <g class="panda-cheeks">
                    <ellipse cx="141.5" cy="199" rx="14.5" ry="8.6" fill="#ffd5c6" data-token="orange-soft" />
                    <ellipse cx="278.5" cy="199" rx="14.5" ry="8.6" fill="#ffd5c6" data-token="orange-soft" />
                  </g>
                  <g class="eye panda-eye eye-left">
                    <ellipse class="eye-white" cx="167" cy="162" rx="13.6" ry="14.4" fill="#faf8f3" data-token="paper" />
                    <g clip-path="url(#__NS__-eye-l)">
                      <ellipse class="eye-lid" cx="167" cy="141.12" rx="21.76" ry="9.5" fill="#f0ece3" data-token="paper-deep" />
                      <g class="pupil">
                        <circle cx="167" cy="162" r="7.2" fill="#1b1a18" data-token="ink" />
                        <circle class="catchlight" cx="164.3" cy="158.9" r="3.1" fill="#faf8f3" data-token="paper" />
                        <circle class="catchlight catchlight-small" cx="170.4" cy="165.6" r="1.3" fill="#faf8f3" data-token="paper" />
                      </g>
                      <ellipse class="eye-lower" cx="167" cy="179.6" rx="17.5" ry="8.8" fill="#1b1a18" data-token="ink" />
                    </g>
                  </g>
                  <g class="eye panda-eye eye-right">
                    <ellipse class="eye-white" cx="253" cy="162" rx="13.6" ry="14.4" fill="#faf8f3" data-token="paper" />
                    <g clip-path="url(#__NS__-eye-r)">
                      <ellipse class="eye-lid" cx="253" cy="141.12" rx="21.76" ry="9.5" fill="#f0ece3" data-token="paper-deep" />
                      <g class="pupil">
                        <circle cx="253" cy="162" r="7.2" fill="#1b1a18" data-token="ink" />
                        <circle class="catchlight" cx="250.3" cy="158.9" r="3.1" fill="#faf8f3" data-token="paper" />
                        <circle class="catchlight catchlight-small" cx="256.4" cy="165.6" r="1.3" fill="#faf8f3" data-token="paper" />
                      </g>
                      <ellipse class="eye-lower" cx="253" cy="179.6" rx="17.5" ry="8.8" fill="#1b1a18" data-token="ink" />
                    </g>
                  </g>
                  <g class="eye-happy" opacity="0">
                    <path d="M154.4 165Q167 148.32 179.6 165M240.4 165Q253 148.32 265.6 165" fill="none" stroke="#faf8f3" stroke-width="4" stroke-linecap="round" data-token="paper" />
                  </g>
                  <path class="panda-nose" d="M200 185.6Q210 179.65 220 185.6Q219 195.12 210 197.5Q201 195.12 200 185.6Z" fill="#1b1a18" data-token="ink" />
                  <ellipse class="nose-shine" cx="206.6" cy="185.6" rx="3.2" ry="1.87" fill="#faf8f3" opacity="0.5" data-token="paper (50%)" />
                  <g class="panda-mouth">
                    <g class="mouth mouth-idle">
                      <path d="M210 197.5V202.6" fill="none" stroke="#1b1a18" stroke-width="3.4" stroke-linecap="round" data-token="ink" />
                      <path d="M194 202.6Q210 207.6 226 202.6Q224.5 222 210 223.5Q195.5 222 194 202.6Z" fill="#1b1a18" stroke="#1b1a18" stroke-width="2.4" stroke-linejoin="round" data-token="ink" />
                      <path d="M200.5 216.8Q210 209.8 219.5 216.8Q215 222.4 210 222.6Q205 222.4 200.5 216.8Z" fill="#ffd5c6" data-token="orange-soft" />
                      <path d="M190.6 199.6Q192.4 203.4 195.2 203.4M229.4 199.6Q227.6 203.4 224.8 203.4" fill="none" stroke="#1b1a18" stroke-width="2.6" stroke-linecap="round" data-token="ink" />
                    </g>
                    <g class="mouth mouth-happy" opacity="0">
                      <path d="M210 197.5V202" fill="none" stroke="#1b1a18" stroke-width="3.4" stroke-linecap="round" data-token="ink" />
                      <path d="M190 202Q210 209 230 202Q228 228.5 210 230Q192 228.5 190 202Z" fill="#1b1a18" stroke="#1b1a18" stroke-width="2.4" stroke-linejoin="round" data-token="ink" />
                      <path d="M198.5 221Q210 212 221.5 221Q216 229 210 229.2Q204 229 198.5 221Z" fill="#ffd5c6" data-token="orange-soft" />
                      <path d="M186.4 198.6Q188.2 202.8 191.2 202.8M233.6 198.6Q231.8 202.8 228.8 202.8" fill="none" stroke="#1b1a18" stroke-width="2.6" stroke-linecap="round" data-token="ink" />
                    </g>
                    <g class="mouth mouth-concern" opacity="0">
                      <path d="M210 197.5V203" fill="none" stroke="#1b1a18" stroke-width="3.4" stroke-linecap="round" data-token="ink" />
                      <path d="M199 203.6Q210 212.4 221 203.6" fill="none" stroke="#1b1a18" stroke-width="3.6" stroke-linecap="round" data-token="ink" />
                    </g>
                  </g>
                </g>
              </g>

              <g class="panda-arm panda-arm-left arm-left">
                <ellipse class="arm-shape" cx="153" cy="295" rx="28" ry="44" fill="#1b1a18" transform="rotate(16 153 295)" data-token="ink" />
                <ellipse class="paw" cx="141" cy="330" rx="25" ry="23" fill="#1b1a18" data-token="ink" />
              </g>

              <g class="panda-arm panda-arm-right arm-right">
                <ellipse class="arm-shape" cx="267" cy="295" rx="28" ry="44" fill="#1b1a18" transform="rotate(-16 267 295)" data-token="ink" />
                <ellipse class="paw" cx="279" cy="330" rx="25" ry="23" fill="#1b1a18" data-token="ink" />
                <g class="panda-magnifier" opacity="0">
                  <g transform="translate(281 326) scale(1)">${magnifier}</g>
                </g>
                <g class="panda-pencil" opacity="0">
                  <g transform="translate(281 326) scale(1)"><path d="M-8 9L34 -33" fill="none" stroke="#f36b3f" stroke-width="10" stroke-linecap="round" data-token="orange" />
                    <path d="M-8 9L-12 13" fill="none" stroke="#ffd5c6" stroke-width="10" stroke-linecap="round" data-token="orange-soft" />
                    <path d="M30.5 -37.5L46 -45L38.5 -29.5Z" fill="#f0ece3" stroke="#f0ece3" stroke-width="2" stroke-linejoin="round" data-token="paper-deep" />
                    <path d="M42 -43L46 -45L44 -41Z" fill="#1b1a18" stroke="#1b1a18" stroke-width="2.4" stroke-linejoin="round" data-token="ink" /></g>
                </g>
                <g class="panda-key" opacity="0">
                  <g transform="translate(281 326) scale(1)">${key}</g>
                </g>
                <g class="deputy-prop deputy-glint" opacity="0">
                  <g transform="translate(281 326)">${glint}</g>
                </g>
                <g class="deputy-prop deputy-help" opacity="0">
                  <g transform="translate(281 326)">
        ${helpCard}
                  </g>
                </g>
                <g class="deputy-prop deputy-card" opacity="0">
                  <g transform="translate(281 326)">
        ${jobCard}
                  </g>
                </g>
                <g class="deputy-prop deputy-report" opacity="0">
                  <g transform="translate(281 326)">
        ${reportCard}
                  </g>
                </g>
                <g class="deputy-prop deputy-best" opacity="0">
                  <g transform="translate(281 326)">
        ${bestCard}
                  </g>
                </g>
                <g class="deputy-prop deputy-offer" opacity="0">
                  <g transform="translate(281 326)">
        ${offerFan}
                  </g>
                </g>
                <g class="deputy-prop deputy-approval" opacity="0">
                  <g transform="translate(281 326)">
        ${approvalCard}
                  </g>
                </g>
                <g class="deputy-prop deputy-clipboard" opacity="0">
                  <g transform="translate(281 326)">
        ${clipboard}
                  </g>
                </g>
                <g class="deputy-prop deputy-clock" opacity="0">
                  <g transform="translate(281 326)">
        ${clock}
                  </g>
                </g>
                <g class="deputy-prop deputy-shield" opacity="0">
                  <g transform="translate(281 326)">
        ${shield}
                  </g>
                </g>
                <g class="deputy-prop deputy-pen" opacity="0">
                  <g transform="translate(281 326)">
        ${pen}
                  </g>
                </g>
                <g class="deputy-prop deputy-envelope" opacity="0">
                  <g transform="translate(281 326)">
        ${envelope}
                  </g>
                </g>
                <g class="deputy-prop deputy-check" opacity="0">
                  <g transform="translate(281 326)">
        ${checkBadge}
                  </g>
                </g>
                <g class="deputy-prop deputy-copy" opacity="0">
                  <g transform="translate(281 326)">
        ${copyCards}
                  </g>
                </g>
                <g class="deputy-prop deputy-archive" opacity="0">
                  <g transform="translate(281 326)">
        ${archiveBox}
                  </g>
                </g>
                <g class="deputy-prop deputy-drop" opacity="0">
                  <g transform="translate(281 326)">
        ${bin}
                  </g>
                </g>
                <g class="deputy-prop deputy-hourglass" opacity="0">
                  <g transform="translate(281 326)">
        ${hourglass}
                  </g>
                </g>
                <g class="deputy-prop deputy-pointer" opacity="0">
                  <g transform="translate(281 326)">
        ${pointer}
                  </g>
                </g>
                <g class="deputy-prop deputy-tour-pointer" opacity="0">
                  <g transform="translate(281 326)">
        ${tourPointer}
                  </g>
                </g>
                <g class="deputy-prop deputy-test" opacity="0">
                  <g transform="translate(281 326)">
        ${testCard}
                  </g>
                </g>
                <ellipse class="paw-grip" cx="281" cy="326" rx="15" ry="12.88" fill="#1b1a18" data-token="ink" />
              </g>
            </g>
          </svg>`;
  // Panda drawing: end

  // Prop-only illustrations for empty states ([data-deputy-prop]): the same geometry, standing alone
  // in a 160 x 160 box on a soft static field, with nothing that moves.
  const field = (fill, token) =>
    `<path d="M80 22C112 20 140 42 140 78C140 114 114 140 78 139C44 138 20 114 21 80C22 46 48 24 80 22Z" fill="${fill}" fill-opacity="0.6" data-token="${token} (60%)" />
      <ellipse cx="80" cy="140" rx="44" ry="6" fill="#1b1a18" opacity="0.08" data-token="ink (8%)" />`;
  const props = {
    clipboard: `${field('#d9def8', 'blue-soft')}<g transform="translate(51 140)">${clipboard}</g>`,
    page: `${field('#ffd5c6', 'orange-soft')}<g transform="translate(80 84) scale(1.25)">${page}</g>`,
    cards: `${field('#d9def8', 'blue-soft')}<g transform="translate(37 30)">${rankStack}</g>`,
    shield: `${field('#ffd5c6', 'orange-soft')}<g transform="translate(46 132) scale(1.1)">${shield}</g>`,
    key: `${field('#ccebdc', 'green-soft')}<g transform="translate(80 132) scale(1.6)">${key}</g>`,
    magnifier: `${field('#ffd5c6', 'orange-soft')}<g transform="translate(40 128) scale(1.4)">${magnifier}</g>`,
    form: `${field('#d9def8', 'blue-soft')}<g transform="translate(70 80) scale(1.3)">${form}</g><g transform="translate(146 82) rotate(180) scale(0.9)">${pen}</g>`,
    envelope: `${field('#ccebdc', 'green-soft')}<g transform="translate(22 136) scale(1.28)">${envelope}</g>`,
  };

  // The hand rule as data (round 6, R6-1): the tool in the right paw for every state and reaction.
  // Each name is a group inside arm-right (panda-magnifier, panda-pencil, and panda-key, or
  // deputy-<name>); deputy.css shows it in that pose, the host carries it as data-deputy-tool, and
  // the rail medallion and the chip show it on their tool badge. The left paw never holds one.
  const tools = {
    idle: 'help',
    arrive: 'card',
    report: 'report',
    search: 'magnifier',
    filter: 'best',
    rank: 'pointer',
    choose: 'offer',
    tailor: 'pencil',
    approve: 'approval',
    track: 'clipboard',
    watch: 'clock',
    'protect-data': 'shield',
    'hold-key': 'key',
    fill: 'pen',
    invite: 'envelope',
    test: 'test',
    notice: 'magnifier',
    pending: 'hourglass',
    success: 'key',
    error: 'help',
    guide: 'pointer',
    added: 'clipboard',
    dismissed: 'best',
    saved: 'check',
    sent: 'envelope',
    copied: 'copy',
    archived: 'archive',
    deleted: 'drop',
    started: 'magnifier',
    found: 'best',
    approved: 'approval',
    submitted: 'pen',
    celebrate: 'best',
    signed: 'pen',
  };

  // The tool badge (rail medallion and chip): the tool, upright, in a small paper disc with the paw
  // at its grip. Each box is the tool's extent around the grip, in drawing units.
  const pencil = `<path d="M-8 9L34 -33" fill="none" stroke="#f36b3f" stroke-width="10" stroke-linecap="round" data-token="orange" />
        <path d="M-8 9L-12 13" fill="none" stroke="#ffd5c6" stroke-width="10" stroke-linecap="round" data-token="orange-soft" />
        <path d="M30.5 -37.5L46 -45L38.5 -29.5Z" fill="#f0ece3" stroke="#f0ece3" stroke-width="2" stroke-linejoin="round" data-token="paper-deep" />
        <path d="M42 -43L46 -45L44 -41Z" fill="#1b1a18" stroke="#1b1a18" stroke-width="2.4" stroke-linejoin="round" data-token="ink" />`;
  const toolArt = {
    help: [helpCard, [-11, -67, 73, -5]],
    card: [jobCard, [-11, -57, 79, -5]],
    report: [reportCard, [-11, -87, 97, -5]],
    magnifier: [magnifier, [-3, -70, 61, 3]],
    best: [bestCard, [-11, -66, 88, -5]],
    pointer: [tourPointer, [-14, -114, 14, 14]],
    offer: [offerFan, [-42, -84, 72, 12]],
    pencil: [pencil, [-15, -47, 48, 16]],
    approval: [approvalCard, [-13, -111, 69, -5]],
    clipboard: [clipboard, [-13, -122, 71, -5]],
    clock: [clock, [0, -74, 60, -2]],
    shield: [shield, [-15, -105, 75, 11]],
    key: [key, [-16, -66, 13, 0]],
    pen: [pen, [-16, -45, 45, 17]],
    envelope: [envelope, [5, -83, 85, -5]],
    test: [testCard, [-13, -111, 75, -5]],
    hourglass: [hourglass, [-5, -95, 53, 1]],
    check: [checkBadge, [-6, -66, 42, -18]],
    copy: [copyCards, [-1, -75, 81, -15]],
    archive: [archiveBox, [-16, -63, 88, -3]],
    drop: [bin, [-19, -59, 87, 3]],
  };
  const badgeTool = (tool) => {
    const entry = toolArt[tool];
    if (!entry) {
      return '';
    }
    const [art, [x0, y0, x1, y1]] = entry;
    const s = 28 / Math.max(x1 - x0, y1 - y0);
    const tx = 24 - (s * (x0 + x1)) / 2;
    const ty = 24 - (s * (y0 + y1)) / 2;
    const round = (value) => Math.round(value * 100) / 100;
    return `<g transform="translate(${round(tx)} ${round(ty)}) scale(${round(s)})">${art}</g><ellipse cx="${round(tx)}" cy="${round(ty)}" rx="5.2" ry="4.6" fill="#1b1a18" data-token="ink" />`;
  };
  const badge =
    '<svg class="deputy-badge" viewBox="0 0 48 48" aria-hidden="true" focusable="false"><circle cx="24" cy="24" r="22.5" fill="#faf8f3" stroke="rgba(27, 26, 24, 0.24)" stroke-width="2" data-token="paper / line-strong" /><g class="deputy-badge-tool"></g></svg>';

  const instances = [];
  const byElement = new WeakMap();
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const has = (table, name) => typeof name === 'string' && Object.hasOwn(table, name);
  const nowMs = () =>
    typeof window.performance?.now === 'function' ? window.performance.now() : Date.now();
  let serial = 0;
  let previewReduced = false;
  let arrivalChecked = false;
  // The moment every live deputy holds (hold), kept for a dock adopted later: a tour can start
  // before this script adopts the dock on DOMContentLoaded.
  let held = null;
  // The background notice the live deputies show (notice), or null.
  let noticeShown = null;
  let noticeTimer = 0;
  // The active tour panda (guide), or null; a dock adopted later steps out for it too.
  let guided = null;

  const readPaused = () => {
    try {
      return window.localStorage.getItem(MOTION_KEY) === 'paused';
    } catch {
      return false;
    }
  };
  let paused = readPaused();

  // The page's mode. reduce: the reduced-motion preference (or the cast sheet's preview of it).
  // paused: Pause motion. on: motion runs. Both still modes swap poses instantly and run no timers
  // but state ones. A cast-sheet demo may pin its own paused or on (data-deputy-preview-mode).
  const pageMode = () =>
    reducedMotion.matches || previewReduced ? 'reduce' : paused ? 'paused' : 'on';
  const modeOf = (deputy) => {
    const page = pageMode();
    return page !== 'reduce' && deputy?.pin ? deputy.pin : page;
  };
  const moving = (deputy) => modeOf(deputy) === 'on';

  // The page-wide switch (R3-2): "on" while motion may run, "paused" while the person paused it or
  // prefers reduced motion. Written as this script runs and on every change.
  const syncRoot = () => {
    const root = document.documentElement;
    if (!root?.dataset) {
      return;
    }
    const value = pageMode() === 'on' ? 'on' : 'paused';
    if (root.dataset.motion !== value) {
      root.dataset.motion = value;
    }
  };

  const warnUnknown = (kind, name) => {
    console.warn(`JobDeputyDeputy: unknown ${kind} "${name}" was ignored.`);
  };

  const clear = (deputy, ...names) => {
    for (const name of names) {
      window.clearTimeout(deputy.timers[name]);
      delete deputy.timers[name];
    }
  };

  // The account's home Region, from its latest signed agreement record (R9-6,
  // JobDeputyStore.homeRegion(), feature-detected); the usual sample's US until the store has it.
  // The public Help page shows no account state, so it keeps the US default.
  const storeRegion = () => {
    if (document.documentElement?.dataset?.helpView === 'public') return '';
    try {
      const store = window.JobDeputyStore;
      const code = typeof store?.homeRegion === 'function' ? store.homeRegion()?.code : '';
      return String(code ?? '').toUpperCase();
    } catch {
      return '';
    }
  };

  // A page that names the Region itself (Account's locked row, setup) wins; else the store says.
  const regionOf = (element) => {
    const code = (
      element.closest('[data-deputy-region]')?.dataset.deputyRegion ||
      storeRegion() ||
      'US'
    ).toUpperCase();
    return regions[code] ? code : 'US';
  };

  // Where a speech says where your data stays, it says the account's home Region (round 7,
  // T7-11): a page's written line ("Your data stays in the US.") reads "the UK" for a UK account,
  // so no page copy changes.
  const REGION_PLACE = /\b(stays|stored|kept|lives) in (?:the US|the UK|India)\b/g;
  const inRegion = (deputy, words) =>
    typeof words === 'string'
      ? words.replace(REGION_PLACE, (_, verb) => `${verb} in ${regions[regionOf(deputy.host)]}`)
      : words;

  // A state's duty while its work runs (test: "Testing prompts") replaces its resting duty.
  const copyFor = (deputy, state, options = {}) => {
    const entry = states[state];
    const speech =
      state === 'protect-data'
        ? `Your data stays in ${regions[regionOf(deputy.host)]}.`
        : entry.speech;
    const duty = options.working === true && entry.workingDuty ? entry.workingDuty : entry.duty;
    return { duty: options.duty ?? duty, speech: inRegion(deputy, options.speech ?? speech) };
  };

  // The copy of a state or a reaction, and the pose a name shows (data-deputy-state).
  const copyOf = (deputy, name, options = {}) => {
    if (!has(reactions, name)) {
      return copyFor(deputy, name, options);
    }
    const entry = reactions[name];
    return { duty: options.duty ?? entry.duty, speech: options.speech ?? entry.speech };
  };
  const poseOf = (name) => (has(reactions, name) ? (reactions[name].pose ?? name) : name);

  // How long a pose's one-time motion runs, from the moment it is shown.
  const motionOf = (pose) => {
    if (has(states, pose)) {
      return SETTLE_MS + states[pose].motion;
    }
    return has(reactions, pose) ? reactions[pose].motion : 0;
  };

  // The state the deputy rests in: a held moment (a tour), else the page state.
  const restOf = (deputy) => deputy.held ?? deputy.page;
  const isResting = (deputy) => deputy.state === restOf(deputy).state;

  const finishSpeech = (deputy) => {
    if (deputy.timers.speech === undefined) {
      return;
    }
    clear(deputy, 'speech');
    deputy.speech.textContent = deputy.nextSpeech;
    deputy.speech.classList.remove('is-changing');
  };

  // Is the deputy's work paused until the person signs the updated agreement?
  const agreementPaused = () => {
    if (document.documentElement?.dataset?.helpView === 'public') {
      return false;
    }
    try {
      const store = window.JobDeputyStore;
      return Boolean(typeof store?.agreements === 'function' && store.agreements()?.paused);
    } catch {
      return false;
    }
  };
  const heldForAgreement = (deputy) => !deputy.demo && agreementPaused();

  // While the person has paused motion, the resting duty reads "Motion paused"; a moment or a
  // reaction still names itself, so the chip answers an action even when nothing moves. While the
  // agreement pause is on, every duty reads "Paused until you sign".
  const writeDuty = (deputy) => {
    const held = heldForAgreement(deputy);
    // The duty's dot becomes the pause mark, as Pause motion's does (deputy.css).
    if (held) {
      deputy.host.setAttribute('data-deputy-agreement', 'paused');
    } else {
      deputy.host.removeAttribute('data-deputy-agreement');
    }
    const notice = !held && !deputy.demo && noticeShown ? noticeShown.kind : null;
    if (notice) {
      deputy.host.setAttribute('data-deputy-notice', notice);
    } else {
      deputy.host.removeAttribute('data-deputy-notice');
    }
    const duty = held
      ? AGREEMENT_DUTY
      : notice
        ? NOTICE_DUTY[notice]
        : deputy.away
          ? AWAY_DUTY
          : modeOf(deputy) === 'paused' && isResting(deputy)
            ? PAUSED_DUTY
            : (deputy.copy?.duty ?? '');
    if (deputy.duty && deputy.duty.textContent !== duty) {
      deputy.duty.textContent = duty;
    }
    for (const echo of deputy.dutyEchoes) {
      if (echo.textContent !== `${duty}, `) {
        echo.textContent = `${duty}, `;
      }
    }
  };

  // Speech and duty are plain visible text, never live regions; pages announce their own events.
  // Resting on its page state while the agreement pause is on, the deputy says why it waits; a
  // reaction or a held moment (a tour) keeps its own line.
  const writeCopy = (deputy, copy, instant = false) => {
    deputy.copy = copy;
    writeDuty(deputy);
    const said = deputy.away
      ? AWAY_SPEECH
      : heldForAgreement(deputy) && !deputy.held && isResting(deputy)
        ? AGREEMENT_SPEECH
        : copy.speech;
    for (const echo of deputy.speechEchoes) {
      echo.textContent = said;
    }
    const { speech } = deputy;
    if (!speech) {
      return;
    }
    finishSpeech(deputy);
    if (speech.textContent === said) {
      return;
    }
    if (instant || !moving(deputy)) {
      speech.textContent = said;
      return;
    }
    deputy.nextSpeech = said;
    speech.classList.add('is-changing');
    deputy.timers.speech = window.setTimeout(() => finishSpeech(deputy), 180);
  };

  // Restarts the pose's one-time motion. The style flush between removing and adding
  // data-deputy-play lets a replay of the same pose start again.
  const replay = (deputy) => {
    const { host } = deputy;
    host.removeAttribute('data-deputy-play');
    if (!moving(deputy)) {
      return;
    }
    host.getBoundingClientRect();
    host.setAttribute('data-deputy-play', '');
    deputy.busyUntil = nowMs() + motionOf(deputy.state);
    if (isResting(deputy)) {
      deputy.restShown = deputy.state;
    }
  };

  // Pupil travel stays inside the eye-whites: x ±5 and y ±3 viewBox units.
  const clampLook = ([x = 0, y = 0]) => [
    Math.max(-5, Math.min(5, Number(x) || 0)),
    Math.max(-3, Math.min(3, Number(y) || 0)),
  ];

  // notice turns the head and eyes toward the focused field; other states look where their pose
  // in deputy.css looks, unless the page passes an explicit look.
  const lookFor = (deputy, state, options) => {
    if (Array.isArray(options.look)) {
      return clampLook(options.look);
    }
    if (state !== 'notice') {
      return null;
    }
    const target = document.activeElement;
    if (!deputy.svg || !target || target === document.body || deputy.host.contains(target)) {
      return [5, 1];
    }
    const from = deputy.svg.getBoundingClientRect();
    const to = target.getBoundingClientRect();
    const dx = to.left + to.width / 2 - (from.left + from.width / 2);
    const dy = to.top + to.height / 2 - (from.top + (from.height * 158) / 420);
    const length = Math.hypot(dx, dy) || 1;
    return clampLook([(dx / length) * 5, (dy / length) * 3]);
  };

  const endGesture = (deputy) => {
    clear(deputy, 'gestureEnd');
    deputy.host.removeAttribute('data-deputy-gesture');
  };

  const show = (
    deputy,
    pose,
    copy,
    { working = false, look = null, play = true, instant = false } = {},
  ) => {
    const { host } = deputy;
    endGesture(deputy);
    deputy.state = pose;
    host.dataset.deputyState = pose;
    showTool(deputy, pose);
    host.toggleAttribute('data-deputy-working', working);
    if (look) {
      host.style.setProperty('--deputy-look-x', String(look[0]));
      host.style.setProperty('--deputy-look-y', String(look[1]));
    } else {
      host.style.removeProperty('--deputy-look-x');
      host.style.removeProperty('--deputy-look-y');
    }
    writeCopy(deputy, copy, instant);
    if (play) {
      replay(deputy);
    } else {
      host.removeAttribute('data-deputy-play');
    }
  };

  // Back to the resting state (the held moment, or the page state). Its one-time motion plays again
  // only when that state is new since it last played, so a reaction settles back quietly.
  const settle = (deputy, { play } = {}) => {
    clear(deputy, 'flash');
    const rest = restOf(deputy);
    show(deputy, rest.state, rest.copy, {
      working: rest.working,
      play: play ?? rest.state !== deputy.restShown,
    });
  };

  // A temporary state, then the resting state. arrive is skipped while nothing may move.
  const flash = (deputy, state, options = {}) => {
    if (!has(states, state)) {
      warnUnknown('state', state);
      return;
    }
    clear(deputy, 'flash');
    if (state === 'arrive' && !moving(deputy)) {
      settle(deputy);
      return;
    }
    const fallback = state === 'arrive' ? ARRIVE_MS : FLASH_MS;
    const ms = Number.isFinite(options.ms) && options.ms > 0 ? options.ms : fallback;
    show(deputy, state, copyFor(deputy, state, options), { look: lookFor(deputy, state, options) });
    deputy.timers.flash = window.setTimeout(() => settle(deputy), ms);
  };

  // A one-shot reaction to the person's action: its pose and line for REACT_MS (or options.ms),
  // then the resting state. In paused and reduced motion the pose swaps at once.
  const react = (deputy, name, options = {}) => {
    clear(deputy, 'flash');
    const ms = Number.isFinite(options.ms) && options.ms > 0 ? options.ms : REACT_MS;
    show(deputy, poseOf(name), copyOf(deputy, name, options), {
      look: Array.isArray(options.look) ? clampLook(options.look) : null,
    });
    deputy.timers.flash = window.setTimeout(() => settle(deputy), ms);
  };

  const set = (deputy, state, options = {}) => {
    if (!has(states, state)) {
      warnUnknown('state', state);
      return;
    }
    if (state === 'success' || state === 'arrive') {
      flash(deputy, state, options);
      return;
    }
    const copy = copyFor(deputy, state, options);
    const working = options.working === true;
    if (states[state].kind === 'page') {
      deputy.page = { state, copy, working };
      rememberPage(deputy);
      // A held moment keeps showing; the new page state shows when it is released.
      if (deputy.held) {
        if (deputy.timers.flash === undefined && deputy.state !== deputy.held.state) {
          settle(deputy);
        }
        return;
      }
    }
    clear(deputy, 'flash');
    show(deputy, state, copy, { working, look: lookFor(deputy, state, options) });
  };

  // A new page state shows now, or when a running flash or reaction ends (or a hold is released).
  const setPageState = (deputy, state, options = {}) => {
    deputy.page = {
      state,
      copy: copyFor(deputy, state, options),
      working: options.working === true,
    };
    rememberPage(deputy);
    if (deputy.timers.flash === undefined && !(deputy.held && deputy.state === deputy.held.state)) {
      settle(deputy);
    }
  };

  // Holds a moment (the tour's guide, or any state) until release: reactions and flashes return to
  // it, and page states set meanwhile show on release.
  const hold = (deputy, state, options = {}) => {
    clear(deputy, 'flash');
    const copy = copyFor(deputy, state, options);
    const working = options.working === true;
    deputy.held = { state, copy, working };
    deputy.host.setAttribute('data-deputy-held', '');
    show(deputy, state, copy, { working, look: lookFor(deputy, state, options) });
  };

  const release = (deputy) => {
    if (!deputy.held) {
      return;
    }
    deputy.held = null;
    deputy.host.removeAttribute('data-deputy-held');
    if (deputy.timers.flash === undefined) {
      settle(deputy);
    }
  };

  // A blink every 5.236 to 8.472s, only while motion is on and the page is visible.
  const scheduleBlink = (
    deputy,
    wait = BLINK_MIN_MS + Math.random() * (BLINK_MAX_MS - BLINK_MIN_MS),
  ) => {
    clear(deputy, 'blink', 'blinkEnd');
    deputy.host.removeAttribute('data-deputy-blink');
    if (!moving(deputy) || document.hidden || !deputy.svg) {
      return;
    }
    deputy.timers.blink = window.setTimeout(() => {
      deputy.host.setAttribute('data-deputy-blink', '');
      deputy.timers.blinkEnd = window.setTimeout(() => scheduleBlink(deputy), 380);
    }, wait);
  };

  // The arms (and the props they hold) show in the dock and the scene, not in the rail or the chip.
  const bodyShown = (deputy) => {
    const arm = deputy.svg?.querySelector('.panda-arm-right');
    if (!arm || typeof window.getComputedStyle !== 'function') {
      return true;
    }
    return window.getComputedStyle(arm).display !== 'none';
  };

  // One gesture from the resting state's set: never the last one twice, head-only where the arms
  // are hidden.
  const pickGesture = (deputy, set) => {
    const body = bodyShown(deputy);
    const fits = set.gestures.filter((name) => body || !gestures[name].body);
    const fresh = fits.filter((name) => name !== deputy.lastGesture);
    const pool = fresh.length ? fresh : fits;
    return pool[Math.floor(Math.random() * pool.length)] ?? 'glance';
  };

  const playGesture = (deputy, name) => {
    const { host } = deputy;
    const set = gestureSets[deputy.state] ?? gestureSets.idle;
    let value = name;
    if (name === 'ear') {
      value = Math.random() < 0.5 ? 'ear-left' : 'ear-right';
    } else if (name === 'glance') {
      const [x, y] = clampLook(set.glance);
      host.style.setProperty('--deputy-glance-x', String(x));
      host.style.setProperty('--deputy-glance-y', String(y));
      host.style.setProperty('--deputy-turn', `${set.turn}deg`);
    } else if (name === 'tilt') {
      host.style.setProperty('--deputy-tilt', Math.random() < 0.5 ? '-6deg' : '6deg');
    }
    // The pose's one-time motion has ended; without its attribute the gesture's rules apply alone.
    host.removeAttribute('data-deputy-play');
    endGesture(deputy);
    host.getBoundingClientRect();
    host.setAttribute('data-deputy-gesture', value);
    deputy.lastGesture = name;
    deputy.busyUntil = nowMs() + gestures[name].ms;
    deputy.timers.gestureEnd = window.setTimeout(() => endGesture(deputy), gestures[name].ms + 180);
  };

  const firstGestureWait = () =>
    GESTURE_MIN_MS + Math.random() * (GESTURE_FIRST_MAX_MS - GESTURE_MIN_MS);

  // The idle gesture timer: every 13 to 21s, only at rest, while motion is on, and while the page is
  // visible. A moment, a reaction, or other motion postpones it; a work loop replaces it.
  const scheduleGesture = (
    deputy,
    wait = GESTURE_MIN_MS + Math.random() * (GESTURE_MAX_MS - GESTURE_MIN_MS),
  ) => {
    clear(deputy, 'gesture');
    if (!deputy.idle || !deputy.started || !moving(deputy) || document.hidden || !deputy.svg) {
      return;
    }
    deputy.timers.gesture = window.setTimeout(() => {
      delete deputy.timers.gesture;
      if (!moving(deputy) || document.hidden) {
        return;
      }
      const rest = restOf(deputy);
      const set = gestureSets[deputy.state];
      if (!isResting(deputy) || !set || deputy.away) {
        scheduleGesture(deputy, QUIET_MS);
        return;
      }
      if (rest.working && states[rest.state]?.loop) {
        scheduleGesture(deputy);
        return;
      }
      const quiet = deputy.busyUntil + QUIET_MS - nowMs();
      if (quiet > 0) {
        scheduleGesture(deputy, quiet);
        return;
      }
      playGesture(deputy, pickGesture(deputy, set));
      scheduleGesture(deputy);
    }, wait);
  };

  const deputyOf = (element) => byElement.get(element?.closest?.('[data-deputy]'));

  // Pause motion shows its state: an icon with its label, Pause motion or Play motion. The accessible
  // name is the label, and the button carries no pressed state.
  const renderMotion = (button) => {
    const deputy = deputyOf(button);
    const stopped = deputy?.pin ? deputy.pin === 'paused' : paused;
    const label = stopped ? 'Play motion' : 'Pause motion';
    const shape = stopped ? 'play' : 'pause';
    if (
      button.querySelector('.deputy-motion-label')?.textContent === label &&
      button.querySelector(`.deputy-motion-icon[data-shape="${shape}"]`)
    ) {
      return;
    }
    // The dock's own button shows "Pause" or "Play" (deputy.css hides the rest in its narrow row);
    // its accessible name, and every other button's visible label, is the whole label.
    const [verb, ...rest] = label.split(' ');
    button.innerHTML = `<svg class="deputy-motion-icon" data-shape="${shape}" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${motionIcons[shape]}</svg><span class="deputy-motion-label">${verb}<span class="deputy-motion-more"> ${rest.join(' ')}</span></span>`;
  };

  // Applies the motion mode to the page, every host, and every Pause motion control. Pausing stops
  // every animation (deputy.css, and app-chrome.css on html[data-motion]) and every motion timer; a
  // flash or a reaction still returns to the resting state. Play restarts what should run: a live
  // work loop (the CSS rule matches again), the blink, and the gestures. Finished one-time motion
  // does not replay.
  const applyMode = () => {
    syncRoot();
    for (const deputy of instances) {
      const current = modeOf(deputy);
      const previous = deputy.host.dataset.deputyMode;
      deputy.host.dataset.deputyMode = current;
      if (current === 'on') {
        if (previous && previous !== 'on') {
          scheduleBlink(deputy, 380);
          scheduleGesture(deputy, firstGestureWait());
        } else if (deputy.timers.blink === undefined && deputy.timers.blinkEnd === undefined) {
          scheduleBlink(deputy);
        }
      } else {
        clear(deputy, 'blink', 'blinkEnd', 'gesture');
        deputy.host.removeAttribute('data-deputy-blink');
        deputy.host.removeAttribute('data-deputy-play');
        endGesture(deputy);
        finishSpeech(deputy);
        // A live greeting ends when motion stops; the cast sheet keeps showing its arrive pose.
        if (deputy.state === 'arrive' && !deputy.demo) {
          settle(deputy, { play: false });
        }
      }
      writeDuty(deputy);
    }
    for (const button of document.querySelectorAll('[data-deputy-motion]')) {
      renderMotion(button);
    }
  };

  // One announcement per change, through the nearest [data-deputy-announce] channel.
  const announce = (source, message) => {
    const host = source?.closest?.('[data-deputy]');
    const channel =
      host?.querySelector('[data-deputy-announce]') ??
      document.querySelector('[data-deputy-announce]');
    if (channel) {
      channel.textContent = message;
    }
  };

  const setPaused = (next, source) => {
    if (paused === next) {
      return;
    }
    paused = next;
    try {
      if (next) {
        window.localStorage.setItem(MOTION_KEY, 'paused');
      } else {
        window.localStorage.removeItem(MOTION_KEY);
      }
    } catch {
      // Storage is unavailable; the choice still holds for this page.
    }
    applyMode();
    announce(source, next ? 'Deputy motion paused.' : 'Deputy motion on.');
  };

  // The stage, the drawing, and the tool badge the rail medallion and the chip show.
  const renderArt = (art, region) => {
    serial += 1;
    const ns = `jdd${serial}`;
    art.innerHTML = stage + drawing.replaceAll('__NS__', ns) + badge;
    art.setAttribute('data-deputy-drawn', ns);
    for (const code of art.querySelectorAll('.deputy-region-code')) {
      code.textContent = region;
    }
    return art.querySelector('.deputy-panda');
  };

  // The tool in the right paw (the hand rule) names itself on the host, and the badge draws it.
  const showTool = (deputy, pose) => {
    const tool = tools[pose] ?? '';
    if (deputy.host.dataset.deputyTool === tool) {
      return;
    }
    deputy.host.dataset.deputyTool = tool;
    const slot = deputy.art?.querySelector('.deputy-badge-tool');
    if (slot) {
      slot.innerHTML = badgeTool(tool);
      for (const code of slot.querySelectorAll('.deputy-region-code')) {
        code.textContent = regionOf(deputy.host);
      }
    }
  };

  const renderProp = (element, name) => {
    if (!element || !has(props, name)) {
      warnUnknown('prop', name);
      return;
    }
    element.innerHTML = `<svg class="deputy-prop-art" viewBox="0 0 160 160" aria-hidden="true" focusable="false">${props[name]}</svg>`;
    element.setAttribute('data-deputy-prop-drawn', name);
    const code = element.querySelector('.deputy-region-code');
    if (code) {
      code.textContent = regionOf(element);
    }
  };

  // The host's markup, completed once, as this script runs (so the tour engine finds the Show me
  // around button on DOMContentLoaded) and again when the host is adopted. The rail and the chip
  // show the speech line, Pause motion, and Show me around inside the Activity panel; the dock shows
  // Show me around there too, once the tour engine reveals it. The chip's toggle carries the duty in
  // its accessible name (its visible label).
  const prepare = (host) => {
    const summary = host.querySelector('.deputy-activity-toggle');
    if (summary && !summary.querySelector('.deputy-activity-name')) {
      const label = document.createElement('span');
      label.className = 'deputy-activity-name';
      label.append(...summary.childNodes);
      const duty = document.createElement('span');
      duty.className = 'deputy-toggle-duty';
      summary.append(duty, label);
    }
    const panel = host.querySelector('.deputy-activity-panel');
    if (panel && !panel.querySelector('.deputy-panel-status')) {
      const status = document.createElement('div');
      status.className = 'deputy-panel-status';
      const speech = document.createElement('p');
      speech.className = 'deputy-panel-speech';
      const actions = document.createElement('div');
      actions.className = 'deputy-panel-actions';
      const motion = document.createElement('button');
      motion.type = 'button';
      motion.className = 'deputy-motion deputy-panel-motion';
      motion.setAttribute('data-deputy-motion', '');
      // Hidden until the tour engine (app-components.js) finds this page's tour steps.
      const tour = document.createElement('button');
      tour.type = 'button';
      tour.className = 'deputy-panel-action';
      tour.setAttribute('data-tour-open', '');
      tour.hidden = true;
      tour.textContent = 'Show me around';
      actions.append(motion, tour);
      status.append(speech, actions);
      panel.prepend(status);
    }
    // Round 7 (SE1): the whole trail is Settings, Activity; the panel ends with a way there that
    // keeps your place (data-return-link). The Activity page itself leaves it out.
    const here = String(window.location?.pathname ?? '')
      .split('/')
      .pop();
    if (panel && host.matches('.deputy-dock') && here !== 'activity-preview.html') {
      if (!panel.querySelector('.deputy-activity-all')) {
        const more = document.createElement('p');
        more.className = 'deputy-activity-more';
        const link = document.createElement('a');
        link.className = 'deputy-activity-all';
        link.setAttribute('href', './activity-preview.html');
        link.setAttribute('data-return-link', '');
        link.textContent = 'See all activity';
        more.append(link);
        const note = panel.querySelector('.sample-note');
        if (note?.parentNode === panel && typeof panel.insertBefore === 'function') {
          panel.insertBefore(more, note);
        } else panel.append(more);
      }
    }
    for (const button of host.querySelectorAll('[data-deputy-motion]')) {
      renderMotion(button);
    }
    // The first frame is the settled one (round 7, T3-1): the drawing, and the duty and speech the
    // markup says (the Region the account's), drawn as this script runs, before the page shows;
    // adopting the host on DOMContentLoaded keeps them.
    const art = host.querySelector('[data-deputy-art]');
    if (art && !art.hasAttribute('data-deputy-drawn')) renderArt(art, regionOf(host));
    const said = host.querySelector('[data-deputy-speech]');
    if (said) {
      const words = inRegion({ host }, said.textContent);
      if (words !== said.textContent) said.textContent = words;
    }
    const dutyWords = host.querySelector('[data-deputy-duty]')?.textContent.trim() ?? '';
    const speechWords = said?.textContent.trim() ?? '';
    for (const echo of host.querySelectorAll('.deputy-toggle-duty')) {
      if (!echo.textContent && dutyWords) echo.textContent = dutyWords;
    }
    for (const echo of host.querySelectorAll('.deputy-panel-speech')) {
      if (!echo.textContent && speechWords) echo.textContent = speechWords;
    }
    host.setAttribute('data-deputy-ready', '');
  };

  // The opening loader (home) covers the page; the first motion waits until it is revealed.
  const whenRevealed = (callback) => {
    const { body } = document;
    if (!body.classList.contains('loader-active')) {
      callback();
      return;
    }
    let failsafe;
    const observer = new MutationObserver(() => {
      if (!body.classList.contains('loader-active')) {
        observer.disconnect();
        window.clearTimeout(failsafe);
        callback();
      }
    });
    observer.observe(body, { attributes: true, attributeFilter: ['class'] });
    failsafe = window.setTimeout(() => {
      observer.disconnect();
      callback();
    }, 4500);
  };

  const readSession = () => {
    try {
      return window.sessionStorage.getItem(ARRIVE_KEY) === 'done';
    } catch {
      return true;
    }
  };

  const markSession = () => {
    try {
      window.sessionStorage.setItem(ARRIVE_KEY, 'done');
    } catch {
      // Storage is unavailable; the deputy arrives on this page only.
    }
  };

  // The page state the deputy last held in this tab, so the next page can settle from it.
  const readLast = () => {
    try {
      const last = window.sessionStorage.getItem(LAST_KEY);
      return has(states, last) && states[last].kind === 'page' ? last : null;
    } catch {
      return null;
    }
  };

  const rememberPage = (deputy) => {
    if (deputy.demo || deputy !== live()[0]) {
      return;
    }
    try {
      window.sessionStorage.setItem(LAST_KEY, deputy.page.state);
    } catch {
      // Storage is unavailable; the next page starts on its own pose.
    }
  };

  const pinOf = (host) => {
    const pin = host.dataset.deputyPreviewMode;
    return pin === 'paused' || pin === 'on' ? pin : null;
  };

  const adopt = (host) => {
    const art = host.matches('[data-deputy-art]') ? host : host.querySelector('[data-deputy-art]');
    if (host.matches('[data-deputy]')) {
      prepare(host);
    }
    // Round 7 (G3): a moment's host (data-deputy-moment, the signing moment) is driven only by
    // its handle, like a cast-sheet demo: it never greets, never marks the session's arrival,
    // takes no idle gestures, and the page-wide calls and the boot's hold never reach it.
    const demo = host.hasAttribute('data-deputy-demo') || host.hasAttribute('data-deputy-moment');
    const deputy = {
      host,
      art,
      svg: null,
      speech: host.querySelector('[data-deputy-speech]'),
      duty: host.querySelector('[data-deputy-duty]'),
      demo,
      // Live deputies gesture at rest; a cast-sheet demo only with data-deputy-idle.
      idle: !demo || host.hasAttribute('data-deputy-idle'),
      pin: demo ? pinOf(host) : null,
      dutyEchoes: [...host.querySelectorAll('.deputy-toggle-duty')],
      speechEchoes: [...host.querySelectorAll('.deputy-panel-speech')],
      timers: {},
      state: null,
      page: null,
      held: null,
      copy: null,
      nextSpeech: '',
      busyUntil: 0,
      restShown: null,
      lastGesture: null,
      started: false,
      away: false,
    };
    if (art) {
      // Drawn as the script ran (prepare): kept, its Region badge brought up to date.
      const drawn = art.hasAttribute('data-deputy-drawn')
        ? art.querySelector('.deputy-panda')
        : null;
      if (drawn) {
        for (const code of art.querySelectorAll('.deputy-region-code')) {
          code.textContent = regionOf(host);
        }
      }
      deputy.svg = drawn ?? renderArt(art, regionOf(host));
    }
    const requested = host.dataset.deputyState;
    const known = has(states, requested) || has(reactions, requested);
    if (requested && !known) {
      warnUnknown('state', requested);
    }
    const initial = known ? requested : 'idle';
    const pageState = has(states, initial) && states[initial].kind === 'page' ? initial : 'idle';
    const written = {
      duty: deputy.duty?.textContent.trim() || undefined,
      speech: deputy.speech?.textContent.trim() || undefined,
    };
    const working = host.hasAttribute('data-deputy-working');
    deputy.page = {
      state: pageState,
      copy: copyFor(deputy, pageState, { ...(pageState === initial ? written : {}), working }),
      working,
    };
    instances.push(deputy);
    byElement.set(host, deputy);
    if (art) {
      byElement.set(art, deputy);
    }
    host.dataset.deputyMode = modeOf(deputy);
    // A tour that started before this dock was adopted keeps its panda in the tour card; a cast
    // sheet demo can be pinned stepped out with data-deputy-away.
    if ((guided && !demo) || (demo && host.hasAttribute('data-deputy-away'))) {
      deputy.away = true;
      host.setAttribute('data-deputy-away', '');
    }
    if (initial === pageState) {
      settle(deputy, { play: false });
    } else {
      show(deputy, poseOf(initial), copyOf(deputy, initial, written), { play: false });
    }
    return deputy;
  };

  // The first page view of a browser session greets the person once: one wave, then the page state.
  // Later pages start on the pose the deputy held on the previous page and settle into this page's
  // (618ms), so it visibly moves on to the new work. A moment held before the dock was adopted (a
  // tour that started first) replaces both. Demo hosts (the cast sheet) start still, on their final
  // pose. Idle gestures start once the page is revealed.
  const start = (fresh) => {
    const live = fresh.filter((deputy) => !deputy.demo);
    const greeter = arrivalChecked ? null : live[0];
    if (live.length) {
      arrivalChecked = true;
    }
    const holding = held;
    const greet = greeter && !holding && !readSession() && moving(greeter);
    const last = greeter && !greet && !holding && moving(greeter) ? readLast() : null;
    if (greeter) {
      markSession();
    }
    if (greet) {
      show(greeter, 'arrive', copyFor(greeter, 'arrive'), { play: false, instant: true });
    }
    const settler = greeter && last && last !== greeter.page.state ? greeter : null;
    if (settler) {
      show(settler, last, settler.page.copy, { play: false });
      settler.host.getBoundingClientRect();
    }
    if (greeter) {
      rememberPage(greeter);
    }
    // A state the page set while the loader covered it wins over the greeting and the settle.
    whenRevealed(() => {
      for (const deputy of live) {
        if (holding && held === holding) {
          hold(deputy, holding.state, holding.options);
        } else if (deputy === greeter && greet && deputy.state === 'arrive') {
          flash(deputy, 'arrive');
        } else if (deputy === settler && deputy.state === last) {
          settle(deputy, { play: true });
        } else {
          replay(deputy);
        }
      }
      for (const deputy of fresh) {
        deputy.started = true;
        scheduleGesture(deputy, firstGestureWait());
      }
    });
  };

  const init = (root = document) => {
    const hosts = [...root.querySelectorAll('[data-deputy]')];
    for (const art of root.querySelectorAll('[data-deputy-art]')) {
      if (!art.closest('[data-deputy]')) {
        hosts.push(art);
      }
    }
    const fresh = hosts.filter((host) => !byElement.has(host)).map(adopt);
    for (const element of root.querySelectorAll('[data-deputy-prop]')) {
      if (!element.hasAttribute('data-deputy-prop-drawn')) {
        renderProp(element, element.dataset.deputyProp);
      }
    }
    applyMode();
    start(fresh);
    hookActivity();
    hookAgreement();
  };

  const live = () => instances.filter((deputy) => !deputy.demo);

  // The agreement pause follows the store: signing (or the overdue demo) rewrites each deputy's
  // duty and resting line at once.
  let agreementHooked = false;
  let agreementWas = null;
  const syncAgreement = () => {
    const now = agreementPaused();
    if (now === agreementWas) {
      return;
    }
    agreementWas = now;
    for (const deputy of live()) {
      if (deputy.copy) {
        writeCopy(deputy, deputy.copy, true);
      }
    }
  };
  const hookAgreement = () => {
    const store = window.JobDeputyStore;
    if (agreementHooked || typeof store?.agreements !== 'function' || !live().length) {
      return;
    }
    agreementHooked = true;
    agreementWas = agreementPaused();
    store.subscribe?.(syncAgreement);
  };

  // The Activity panel's three lists come from the sample world when the store offers it
  // (JobDeputyStore.activity(), round 3 R3-3): what runs now (a link to the live run), what needs
  // you (the To-do, by title), and what was done recently (with when). They follow every store
  // change and every live tick, updating in place while the items stay the same, so focus in the
  // panel survives; the markup's seed lists remain for a page without the store.
  const ACTIVITY_EMPTY = [
    'Nothing running right now.',
    'Nothing needs you right now.',
    'Nothing yet.',
  ];
  let activityHooked = false;

  const activityItems = (activity) => [
    (activity.now ?? []).map((item) => ({
      key: String(item.id),
      href: item.href,
      text: item.detail ? `${item.text} · ${item.detail}` : item.text,
    })),
    (activity.needsYou ?? []).map((item) => ({
      key: String(item.id),
      href: item.href,
      text: item.title,
    })),
    (activity.done ?? []).map((item) => ({
      key: String(item.id),
      text: item.when ? `${item.text} · ${item.when}` : item.text,
    })),
  ];

  const renderActivityList = (list, items, empty) => {
    const rows = items.length ? items : [{ key: 'empty', text: empty }];
    const current = list.children ? [...list.children] : [];
    const same =
      list.hasAttribute('data-deputy-rendered') &&
      current.length === rows.length &&
      current.every(
        (row, index) =>
          row.getAttribute('data-deputy-key') === rows[index].key &&
          Boolean(row.querySelector('a')) === Boolean(rows[index].href),
      );
    if (same) {
      rows.forEach((item, index) => {
        const target = current[index].querySelector('a') ?? current[index];
        if (target.textContent !== item.text) {
          target.textContent = item.text;
        }
        if (item.href && target.getAttribute('href') !== item.href) {
          target.setAttribute('href', item.href);
        }
      });
      return;
    }
    const focused = list.contains(document.activeElement)
      ? document.activeElement.closest('[data-deputy-key]')?.getAttribute('data-deputy-key')
      : null;
    list.textContent = '';
    for (const item of rows) {
      const row = document.createElement('li');
      row.setAttribute('data-deputy-key', item.key);
      if (item.href) {
        const link = document.createElement('a');
        link.setAttribute('href', item.href);
        link.textContent = item.text;
        row.append(link);
      } else {
        row.textContent = item.text;
      }
      list.append(row);
    }
    list.setAttribute('data-deputy-rendered', '');
    if (focused) {
      [...list.querySelectorAll('[data-deputy-key]')]
        .find((row) => row.getAttribute('data-deputy-key') === focused)
        ?.querySelector('a')
        ?.focus();
    }
  };

  // Background notices (round 6, UAT M-19 and RM-3). notice({ id, kind, text, href, source })
  // shows one on every live deputy until Activity (where it is listed) opens, or the page clears it
  // (clearNotice(id)); a done notice clears itself after 13s. Notices in the store's Activity (what
  // addNotice records, and an apply job waiting for you) are picked up as they arrive and clear
  // when they leave it; the ones already there when the page opens, or seen on an earlier page of
  // this tab, never show again. A page's own notice (source 'page', the default) is never cleared
  // by the store, since the store may not list it.
  const NOTICE_RANK = { 'needs-you': 2, stopped: 1, done: 0 };

  const writeNotice = () => {
    for (const deputy of live()) {
      writeDuty(deputy);
    }
  };

  const dismissNotice = () => {
    window.clearTimeout(noticeTimer);
    if (!noticeShown) {
      return;
    }
    noticeShown = null;
    writeNotice();
  };

  // The page clears the notice it showed (Applications, when the job moves on): only that one.
  const clearNotice = (id) => {
    if (noticeShown && id !== undefined && id !== null && String(id) === noticeShown.id) {
      dismissNotice();
    }
  };

  const notice = (options = {}) => {
    const kind = Object.hasOwn(NOTICE_DUTY, options.kind) ? options.kind : 'done';
    const text = String(options.text ?? '').trim();
    if (!text) {
      return;
    }
    window.clearTimeout(noticeTimer);
    noticeShown = {
      id: String(options.id ?? ''),
      kind,
      text,
      href: options.href ?? null,
      source: options.source === 'store' ? 'store' : 'page',
    };
    writeNotice();
    if (kind === 'done') {
      noticeTimer = window.setTimeout(dismissNotice, NOTICE_DONE_MS);
    }
  };

  const readSeen = () => {
    try {
      const saved = JSON.parse(window.sessionStorage.getItem(NOTICE_SEEN_KEY) ?? '[]');
      return new Set(Array.isArray(saved) ? saved.map(String) : []);
    } catch {
      return new Set();
    }
  };
  let noticesSeen = null;

  // The notices in the store's Activity: needs you (a recorded notice, or an apply job waiting for
  // your answers or your check), and done or stopped.
  const noticesIn = (activity) => [
    ...(activity.needsYou ?? [])
      .filter((item) => item?.kind === 'notice' || item?.kind === 'apply-job')
      .map((item) => ({
        id: String(item.id),
        kind: 'needs-you',
        text: item.title,
        href: item.href,
      })),
    ...(activity.done ?? [])
      .filter((item) => item?.kind === 'done' || item?.kind === 'stopped')
      .map((item) => ({ id: String(item.id), kind: item.kind, text: item.text, href: item.href })),
  ];

  const pickUpNotices = (activity) => {
    const found = noticesIn(activity);
    if (!noticesSeen) {
      noticesSeen = readSeen();
      for (const item of found) {
        noticesSeen.add(item.id);
      }
    } else {
      // A notice already showing is not shown twice.
      const fresh = found.filter(
        (item) => !noticesSeen.has(item.id) && item.id !== (noticeShown?.id || null),
      );
      for (const item of fresh) {
        noticesSeen.add(item.id);
      }
      // Needs you outranks stopped, which outranks done; a new one never hides a weightier one.
      const newest = fresh.sort((a, b) => NOTICE_RANK[b.kind] - NOTICE_RANK[a.kind])[0];
      if (newest && (!noticeShown || NOTICE_RANK[newest.kind] >= NOTICE_RANK[noticeShown.kind])) {
        notice({ ...newest, source: 'store' });
      }
    }
    // A needs-you notice from the store that has been dealt with (gone from the list) clears.
    if (noticeShown?.kind === 'needs-you' && noticeShown.source === 'store') {
      if (!found.some((item) => item.id === noticeShown.id)) {
        dismissNotice();
      }
    }
    try {
      window.sessionStorage.setItem(NOTICE_SEEN_KEY, JSON.stringify([...noticesSeen].slice(-60)));
    } catch {
      // Storage is unavailable; this page still remembers.
    }
  };

  const syncActivity = () => {
    const store = window.JobDeputyStore;
    if (typeof store?.activity !== 'function') {
      return;
    }
    let activity;
    try {
      activity = store.activity();
    } catch {
      return;
    }
    pickUpNotices(activity ?? {});
    const lists = activityItems(activity ?? {});
    for (const deputy of live()) {
      const found = deputy.host.querySelectorAll('.deputy-activity-panel .deputy-activity-list');
      if (found.length !== 3) {
        continue;
      }
      for (const [index, items] of lists.entries()) {
        renderActivityList(found[index], items, ACTIVITY_EMPTY[index]);
      }
    }
  };

  const hookActivity = () => {
    const store = window.JobDeputyStore;
    if (activityHooked || typeof store?.activity !== 'function' || !live().length) {
      return;
    }
    activityHooked = true;
    syncActivity();
    store.subscribe?.(syncActivity);
    store.onTick?.(syncActivity);
  };

  // ------------------------------------------------------------------ guide (round 6, G6, R6-2)
  // The tour panda: a smiling bust in the tour card, the right paw's pointer aimed at the step's
  // target (left, right, up, or down), the left paw free. While it is out, every live deputy host
  // steps out (data-deputy-away): the ledge and the leaning bamboo stay, so one panda per viewport
  // holds. Pause motion and reduced motion change its pose at once (deputy.css).
  const setAway = (deputy, on) => {
    if (deputy.away === on) {
      return;
    }
    deputy.away = on;
    deputy.host.toggleAttribute('data-deputy-away', on);
    if (on) {
      endGesture(deputy);
    }
    writeCopy(deputy, deputy.copy ?? restOf(deputy).copy, true);
  };

  const guideSpeechSlot = (host) =>
    host.querySelector('[data-deputy-guide-speech]') ??
    host.closest('[data-deputy-guide-card]')?.querySelector('[data-deputy-guide-speech]') ??
    null;

  const inertGuide = Object.freeze({
    element: null,
    point: null,
    speech: '',
    active: false,
    update() {},
    release() {},
  });

  const guide = (host, options = {}) => {
    if (!host || typeof host.append !== 'function' || typeof host.querySelector !== 'function') {
      warnUnknown('guide host', String(host));
      return inertGuide;
    }
    // A demo (the cast sheet) draws the tour panda only: the docks stay, and several may show.
    const demo = options.demo === true;
    if (!demo) {
      guided?.release();
    }
    serial += 1;
    const root = document.createElement('span');
    root.className = 'deputy-guide';
    root.setAttribute('aria-hidden', 'true');
    root.innerHTML = drawing.replaceAll('__NS__', `jdg${serial}`);
    const state = {
      root,
      host,
      point: POINTS.includes(options.point) ? options.point : 'right',
      speech: typeof options.speech === 'string' ? options.speech : '',
      active: true,
    };
    if (options.point !== undefined && !POINTS.includes(options.point)) {
      warnUnknown('point', options.point);
    }
    root.dataset.point = state.point;
    host.append(root);
    const writeSpeech = () => {
      const slot = guideSpeechSlot(host);
      if (slot && slot.textContent !== state.speech) {
        slot.textContent = state.speech;
      }
    };
    if (state.speech) {
      writeSpeech();
    }
    const release = ({ finished = false } = {}) => {
      if (!state.active) {
        return;
      }
      state.active = false;
      root.remove();
      if (demo) {
        return;
      }
      if (guided === state) {
        guided = null;
      }
      for (const deputy of live()) {
        setAway(deputy, false);
        if (finished) {
          react(deputy, 'celebrate');
        } else {
          settle(deputy, { play: false });
        }
      }
    };
    state.release = release;
    if (!demo) {
      guided = state;
      for (const deputy of live()) {
        setAway(deputy, true);
      }
    }
    return Object.freeze({
      element: root,
      get point() {
        return state.point;
      },
      get speech() {
        return state.speech;
      },
      get active() {
        return state.active;
      },
      update(next = {}) {
        if (!state.active) {
          return;
        }
        if (next.point !== undefined) {
          if (POINTS.includes(next.point)) {
            state.point = next.point;
            root.dataset.point = next.point;
          } else {
            warnUnknown('point', next.point);
          }
        }
        if (typeof next.speech === 'string') {
          state.speech = next.speech;
          writeSpeech();
        }
      },
      release,
    });
  };

  const handle = (deputy) =>
    Object.freeze({
      element: deputy.host,
      get state() {
        return deputy.state;
      },
      get pageState() {
        return deputy.page.state;
      },
      get working() {
        return deputy.host.hasAttribute('data-deputy-working');
      },
      get held() {
        return deputy.held?.state ?? null;
      },
      get mode() {
        return modeOf(deputy);
      },
      set: (state, options) => set(deputy, state, options),
      flash: (state, options) => flash(deputy, state, options),
      react: (name, options) => {
        if (has(reactions, name)) {
          react(deputy, name, options);
        } else {
          warnUnknown('reaction', name);
        }
      },
      hold: (state = 'guide', options = {}) => {
        if (has(states, state)) {
          hold(deputy, state, options);
        } else {
          warnUnknown('state', state);
        }
      },
      release: () => release(deputy),
      // Plays one idle gesture now (the cast sheet), when motion is on.
      gesture: (name) => {
        if (!has(gestures, name)) {
          warnUnknown('gesture', name);
        } else if (moving(deputy)) {
          playGesture(deputy, name);
        }
      },
      // Shows any state or reaction pose and holds it, success and arrive included (the cast
      // sheet). options.play: false shows it without its one-time motion.
      show: (name, options = {}) => {
        if (!has(states, name) && !has(reactions, name)) {
          warnUnknown('state', name);
          return;
        }
        clear(deputy, 'flash');
        const copy = copyOf(deputy, name, options);
        const working = options.working === true;
        if (has(states, name) && states[name].kind === 'page') {
          deputy.page = { state: name, copy, working };
        }
        show(deputy, poseOf(name), copy, {
          working,
          look: lookFor(deputy, name, options),
          play: options.play !== false,
        });
      },
      replay: () => replay(deputy),
      // Shows this host stepped out (the cast sheet's tour demo), or back.
      away: (on = true) => setAway(deputy, Boolean(on)),
    });

  // Keeps an open Activity panel inside the viewport (13px margins) by shifting it sideways.
  const keepPanelInView = (details) => {
    const panel = details.querySelector('.deputy-activity-panel');
    if (!panel) {
      return;
    }
    panel.style.removeProperty('--deputy-panel-shift');
    if (!details.open) {
      return;
    }
    let rect = panel.getBoundingClientRect();
    // Chrome can lay out the fixed panel against an empty box the first time a <details> opens
    // (the panel then sits above the viewport, out of reach); one forced re-layout places it
    // against the viewport.
    if (rect.bottom <= 0 || rect.top >= window.innerHeight) {
      panel.style.display = 'none';
      void panel.offsetHeight;
      panel.style.removeProperty('display');
      rect = panel.getBoundingClientRect();
    }
    const viewport = document.documentElement.clientWidth;
    let shift = 0;
    if (rect.right > viewport - 13) {
      shift = viewport - 13 - rect.right;
    }
    if (rect.left + shift < 13) {
      shift = 13 - rect.left;
    }
    if (shift) {
      panel.style.setProperty('--deputy-panel-shift', `${Math.round(shift)}px`);
    }
  };

  document.addEventListener('click', (event) => {
    // An outside click closes an open Activity panel. Checked first: Pause motion re-renders its
    // own label, and a click inside the panel must still count as inside.
    for (const details of document.querySelectorAll('.deputy-activity[open]')) {
      if (!details.contains(event.target)) {
        details.open = false;
      }
    }
    const motion = event.target.closest?.('[data-deputy-motion]');
    if (motion) {
      const deputy = deputyOf(motion);
      if (deputy?.pin) {
        // A cast-sheet demo pinned paused (or on) toggles itself, not the whole page.
        deputy.pin = deputy.pin === 'paused' ? 'on' : 'paused';
        applyMode();
        announce(motion, deputy.pin === 'paused' ? 'Deputy motion paused.' : 'Deputy motion on.');
      } else {
        setPaused(!paused, motion);
      }
    }
    // Show me around starts the tour (app-components.js); the panel closes so it never covers it.
    const tour = event.target.closest?.('.deputy-panel-action[data-tour-open]');
    tour?.closest('.deputy-activity[open]')?.removeAttribute('open');
  });

  // Focus that leaves an open Activity panel closes it, so the panel never covers what has focus.
  document.addEventListener('focusout', (event) => {
    const details = event.target.closest?.('.deputy-activity[open]');
    const next = event.relatedTarget;
    if (details && next && !details.contains(next)) {
      details.open = false;
    }
  });

  // Escape closes an open Activity panel and returns focus to its toggle.
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') {
      return;
    }
    const details = event.target.closest?.('.deputy-activity[open]');
    if (details) {
      details.open = false;
      details.querySelector('summary')?.focus();
    }
  });

  document.addEventListener(
    'toggle',
    (event) => {
      if (event.target.matches?.('.deputy-activity')) {
        keepPanelInView(event.target);
        // Opening Activity, where the notice is listed, means it has been seen.
        if (event.target.open) {
          dismissNotice();
        }
      }
    },
    true,
  );

  window.addEventListener('resize', () => {
    for (const details of document.querySelectorAll('.deputy-activity[open]')) {
      keepPanelInView(details);
    }
  });

  // A hidden tab runs no blink and no gesture; both start again when it shows.
  document.addEventListener('visibilitychange', () => {
    for (const deputy of instances) {
      scheduleBlink(deputy);
      if (document.hidden) {
        clear(deputy, 'gesture');
        endGesture(deputy);
      } else {
        scheduleGesture(deputy, firstGestureWait());
      }
    }
  });

  // Another tab's Pause motion (or a cleared storage) applies here too, without a second
  // announcement; so does a page restored from the back-forward cache.
  const syncPaused = () => {
    const next = readPaused();
    if (next !== paused) {
      paused = next;
      applyMode();
    }
  };

  window.addEventListener('storage', (event) => {
    if (event.key === MOTION_KEY || event.key === null) {
      syncPaused();
    }
  });

  window.addEventListener('pageshow', (event) => {
    if (event.persisted) {
      syncPaused();
    }
  });

  reducedMotion.addEventListener('change', applyMode);

  const api = {
    // The state names, in brief order.
    states: Object.freeze(Object.keys(states)),
    // The hand rule (round 6): the tool in the right paw for every state and reaction.
    tools: Object.freeze({ ...tools }),
    // The reaction names (R3-8) and the idle gestures (R3-2).
    reactions: Object.freeze(Object.keys(reactions)),
    gestures: Object.freeze(Object.keys(gestures)),
    // Default copy and motion lengths per state and per reaction, for the cast sheet and tests.
    defaults: Object.freeze(
      Object.fromEntries(
        Object.entries(states).map(([name, entry]) => [name, Object.freeze({ ...entry })]),
      ),
    ),
    reactionDefaults: Object.freeze(
      Object.fromEntries(
        Object.entries(reactions).map(([name, entry]) => [
          name,
          Object.freeze({ pose: poseOf(name), ...entry, hold: REACT_MS }),
        ]),
      ),
    ),
    props: Object.freeze(Object.keys(props)),
    get paused() {
      return paused;
    },
    get reduced() {
      return pageMode() === 'reduce';
    },
    // The moment held for a multi-step task (a tour), or null.
    get held() {
      return held?.state ?? null;
    },
    // The tour panda (round 6, G6): guide(host, { point, speech }) returns { element, point,
    // speech, active, update({ point, speech }), release({ finished }) }. See guide-api.md in the
    // round's work folder and docs/design-system.md, "Deputy companion".
    guide,
    // The active tour panda's direction, or null.
    get guiding() {
      return guided?.active ? guided.point : null;
    },
    // A background notice with the deputy (round 6, UAT M-19): notice({ id, kind: 'done' |
    // 'needs-you' | 'stopped', text, href, source }). On phones the app bar's chip carries it, so
    // nothing floats over the page; opening Activity clears it, and so does clearNotice(id) from
    // the page that showed it (only when the id matches the notice shown).
    notice,
    clearNotice,
    // The notice the deputy shows, or null.
    get noticed() {
      return noticeShown ? { ...noticeShown } : null;
    },
    // The page state of the page's own deputy (the first host that is not a cast-sheet demo).
    get pageState() {
      return live()[0]?.page.state ?? null;
    },
    set pageState(state) {
      if (!has(states, state) || states[state].kind !== 'page') {
        warnUnknown('page state', state);
        return;
      }
      for (const deputy of live()) {
        setPageState(deputy, state);
      }
    },
    // Unknown states warn once and change nothing, whether or not the page has a deputy.
    set(state, options) {
      if (!has(states, state)) {
        warnUnknown('state', state);
        return;
      }
      for (const deputy of live()) {
        set(deputy, state, options);
      }
    },
    flash(state, options) {
      if (!has(states, state)) {
        warnUnknown('state', state);
        return;
      }
      for (const deputy of live()) {
        flash(deputy, state, options);
      }
    },
    // A one-shot reaction to the person's action (R3-8): react('added') or, with its own line,
    // react('added', { speech: 'Added. It’s in Applications.' }). Unknown names warn once and
    // change nothing.
    react(name, options) {
      if (!has(reactions, name)) {
        warnUnknown('reaction', name);
        return;
      }
      for (const deputy of live()) {
        react(deputy, name, options);
      }
    },
    // Holds a moment through a multi-step task (the tour engine: hold('guide') at the start,
    // release() at the end). Reactions return to it; page states set meanwhile show on release.
    hold(state = 'guide', options = {}) {
      if (!has(states, state)) {
        warnUnknown('state', state);
        return;
      }
      held = { state, options };
      for (const deputy of live()) {
        hold(deputy, state, options);
      }
    },
    release() {
      held = null;
      for (const deputy of live()) {
        release(deputy);
      }
    },
    pause() {
      setPaused(true, null);
    },
    play() {
      setPaused(false, null);
    },
    renderProp,
    // A handle for one host (or its art), for pages with several deputies such as the cast sheet.
    get(element) {
      const target = element?.closest?.('[data-deputy], [data-deputy-art]');
      const deputy = byElement.get(element) ?? (target ? byElement.get(target) : undefined);
      return deputy ? handle(deputy) : null;
    },
    // The cast sheet's reduced-motion preview: the same still mode as the preference.
    previewReducedMotion(on) {
      previewReduced = Boolean(on);
      applyMode();
    },
    init,
  };

  window.JobDeputyDeputy = Object.freeze(api);

  // As this script runs: the chrome's store-backed words (T3-1), the page-wide motion switch,
  // and the hosts' markup.
  window.JobDeputyComponents?.storeReady?.();
  syncRoot();
  for (const host of document.querySelectorAll('[data-deputy]')) {
    prepare(host);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => init(), { once: true });
  } else {
    init();
  }
})();
