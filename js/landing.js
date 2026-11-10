// Landing page adapted from the modern dark-mode full-bleed design.
window.DINKSLOT_LANDING = `<div id="ds-landing" class="flex flex-col w-full">
<!-- HERO SECTION -->
<section class="landing-search-section relative w-full overflow-hidden bg-surface-container-lowest pt-10 pb-20 px-gutter md:px-margin-desktop">
  <!-- Ambient Kinetic Glow behind hero content -->
  <div class="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[720px] h-[380px] bg-primary/10 rounded-full blur-[130px] pointer-events-none"></div>
  <div class="absolute top-10 right-10 w-72 h-72 bg-tertiary-container/10 rounded-full blur-[90px] pointer-events-none"></div>
  <div class="landing-hero-content relative w-full mx-auto flex flex-col items-center text-center">
    <!-- Badge Pill -->
    <div class="inline-flex items-center gap-space-xs px-space-md py-1.5 rounded-full bg-surface-container-high text-primary font-label-md text-label-md shadow-[0_0_20px_rgba(163,230,53,0.18)] mb-space-md">
      <span class="w-2 h-2 rounded-full bg-primary animate-ping"></span>
      <span class="font-bold tracking-wide uppercase">THE #1 PICKLEBALL RESERVATION &amp; DUPR READY COMMUNITY</span>
    </div>
    <!-- Headline -->
    <h1 class="font-headline-display text-headline-display-mobile md:text-headline-display text-on-surface tracking-tight max-w-4xl mt-space-xs">
      Book Your Slot. <br class="hidden md:inline"/>
      <span class="text-transparent bg-clip-text bg-gradient-to-r from-primary via-tertiary to-secondary-fixed">Own the Court.</span>
    </h1>
    <!-- Subheadline -->
    <p class="font-body-lg text-body-md md:text-body-lg text-on-surface-variant max-w-2xl mt-space-md leading-relaxed">
      Discover premier indoor &amp; outdoor pickleball courts, book hourly slots in seconds, and connect with a DUPR Ready pickleball community.
    </p>
    <!-- MODERN INTERACTIVE QUICK SEARCH BAR -->
    <div class="landing-search-panel w-full max-w-none mt-space-xl p-space-sm md:p-space-md rounded-2xl bg-surface-container-high shadow-2xl">
      <div class="grid grid-cols-1 md:grid-cols-12 gap-space-xs items-center">
        <!-- Venue / Search Input -->
        <div class="landing-search-field md:col-span-4 flex items-center gap-space-sm px-space-md py-3.5 rounded-xl bg-surface-container text-left group transition-all">
          <span class="material-symbols-outlined text-primary text-headline-sm">search</span>
          <div class="flex flex-col flex-1 min-w-0">
            <span class="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider">Search Venue</span>
            <input id="q" aria-label="Search clubs" class="bg-transparent font-body-md text-body-md text-on-surface placeholder:text-outline focus:outline-none w-full truncate border-0 p-0" placeholder="Club name, venue, or zip..." type="text"/>
          </div>
        </div>
        <!-- City / Region Dropdown -->
        <div class="landing-city-field md:col-span-3 flex items-center gap-space-sm px-space-md py-3.5 rounded-xl bg-surface-container text-left transition-colors">
          <span class="material-symbols-outlined text-secondary text-headline-sm">location_on</span>
          <div class="flex flex-col flex-1 min-w-0">
            <span class="font-label-sm text-label-sm text-on-surface-variant tracking-wider">Cities</span>
            <input id="city" type="hidden" value="" />
            <details class="city-menu"><summary aria-label="Cities"><span class="city-selected">All Cities</span><span class="material-symbols-outlined" aria-hidden="true">expand_more</span></summary><div class="city-options"><button type="button" data-city="" aria-pressed="true">All Cities</button></div></details>
          </div>

        </div>
        <!-- Schedule / Date & Time -->
        <div class="md:col-span-3 flex items-center gap-space-sm px-space-md py-3.5 rounded-xl bg-surface-container text-left">
          <span class="material-symbols-outlined text-secondary text-headline-sm">calendar_month</span>
          <div class="flex flex-col flex-1 min-w-0">
            <span class="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider">Schedule</span>
            <span class="font-body-md text-body-md text-on-surface truncate font-semibold">Today • Prime Slots</span>
          </div>
          <span class="material-symbols-outlined text-outline text-label-md">schedule</span>
        </div>
        <!-- CTA Search Button -->
        <div class="md:col-span-2 flex items-center h-full">
          <button id="find-courts-btn" type="button" class="w-full h-full min-h-[52px] rounded-xl bg-primary hover:bg-secondary-fixed text-on-primary font-headline-sm text-label-lg font-bold uppercase tracking-tight flex items-center justify-center gap-space-xs shadow-[0_0_24px_rgba(163,230,53,0.35)] hover:shadow-[0_0_32px_rgba(163,230,53,0.6)] transition-all cursor-pointer border-0">
            <span>Find Courts</span>
            <span class="material-symbols-outlined text-label-lg">arrow_forward</span>
          </button>
        </div>
      </div>
      <!-- Filter Pills Sub-bar -->
      <div class="mt-space-sm pt-space-xs px-space-sm flex flex-wrap items-center justify-between gap-space-sm text-left border-t border-outline-variant/20">
        <div class="flex flex-wrap items-center gap-space-xs font-label-md text-label-md">
          <span class="text-on-surface-variant">Surface:</span>
          <button type="button" class="surf-pill px-space-sm py-1 rounded-full bg-primary/20 text-primary font-medium hover:bg-surface-bright transition-colors flex items-center gap-1 border-0 cursor-pointer" data-filter="all">
            <span class="material-symbols-outlined text-label-md text-primary">check_circle</span> All Courts
          </button>
          <button type="button" class="surf-pill px-space-sm py-1 rounded-full bg-surface-container text-on-surface-variant hover:text-on-surface hover:bg-surface-bright transition-colors border-0 cursor-pointer" data-filter="indoor">
            Indoor Courts
          </button>
          <button type="button" class="surf-pill px-space-sm py-1 rounded-full bg-surface-container text-on-surface-variant hover:text-on-surface hover:bg-surface-bright transition-colors border-0 cursor-pointer" data-filter="outdoor">
            Outdoor Courts
          </button>
        </div>
        <span class="font-label-sm text-label-sm text-outline flex items-center gap-1">
          <span class="material-symbols-outlined text-label-md text-primary">bolt</span> Real-time instant lock activated
        </span>
      </div>
    </div>
    <!-- Trust Proof Stats -->
    <div class="landing-stats grid grid-cols-2 md:grid-cols-4 gap-space-md w-full max-w-4xl mt-space-xl pt-space-md">
      <div class="flex flex-col items-center">
        <span class="font-headline-lg text-headline-lg text-primary font-bold">500+</span>
        <span class="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider mt-0.5">Verified Clubs</span>
      </div>
      <div class="flex flex-col items-center">
        <span class="font-headline-lg text-headline-lg text-on-surface font-bold">45,000+</span>
        <span class="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider mt-0.5">Active Players</span>
      </div>
      <div class="flex flex-col items-center">
        <span class="font-headline-lg text-headline-lg text-primary font-bold">99.8%</span>
        <span class="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider mt-0.5">Booking Reliability</span>
      </div>
      <div class="flex flex-col items-center">
        <span class="font-headline-lg text-headline-lg text-secondary font-bold">DUPR Ready</span>
        <span class="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider mt-0.5">Play at your level</span>
      </div>
    </div>
  </div>
</section>

<!-- FEATURED CLUBS & AVAILABILITY SECTION -->
<section id="clubs-section" class="w-full py-space-xl px-gutter md:px-margin-desktop bg-surface">
  <div class="clubs-content max-w-7xl mx-auto flex flex-col gap-space-xl">
    <!-- Section Header with Filter Badges -->
    <div class="flex flex-col md:flex-row md:items-end justify-between gap-space-md">
      <div>
        <span class="font-label-sm text-label-sm uppercase tracking-widest text-primary font-semibold">Real-Time Court Inventory</span>
        <h2 class="font-headline-lg text-headline-lg text-on-surface mt-1">Trending Pickleball Clubs Near You</h2>
      </div>
      <div class="club-filters" role="group" aria-label="Filter clubs by court type">
        <button type="button" class="club-tab" data-tab="all" aria-pressed="true">All Clubs</button>
        <button type="button" class="club-tab" data-tab="indoor" aria-pressed="false">Indoor Courts</button>
        <button type="button" class="club-tab" data-tab="outdoor" aria-pressed="false">Outdoor Courts</button>
      </div>
    </div>
    <p id="ccount" class="font-label-sm text-label-sm text-on-surface-variant" role="status">Loading clubs...</p>
    <div id="grid" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-space-lg">
      <p class="text-on-surface-variant">Loading clubs...</p>
    </div>
  </div>
</section>

<!-- WHY PLAYERS & CLUB OWNERS CHOOSE DINKSLOT -->
<section id="landing-features" class="w-full py-space-xl px-gutter md:px-margin-desktop bg-surface-container-low">
  <div class="max-w-7xl mx-auto flex flex-col gap-space-xl">
    <div class="text-center max-w-2xl mx-auto">
      <span class="font-label-sm text-label-sm uppercase tracking-widest text-primary font-semibold">Engineered For Performance</span>
      <h2 class="font-headline-lg text-headline-lg text-on-surface mt-1">Why Players &amp; Club Owners Choose DINKSLOT</h2>
      <p class="font-body-md text-body-md text-on-surface-variant mt-2">The complete technological backbone designed to elevate recreational recreation into competitive perfection.</p>
    </div>
    <!-- 3 Glassmorphism Feature Cards -->
    <div class="landing-feature-grid grid grid-cols-1 md:grid-cols-3 gap-space-lg">
      <!-- Card 1 -->
      <div class="relative p-space-xl rounded-2xl bg-surface-container-high backdrop-blur-md shadow-lg flex flex-col justify-between overflow-hidden group hover:translate-y-[-4px] transition-all">
        <div class="absolute -right-8 -top-8 w-32 h-32 bg-primary/10 rounded-full blur-2xl group-hover:bg-primary/20 transition-all"></div>
        <div>
          <div class="w-14 h-14 rounded-2xl bg-surface-container flex items-center justify-center text-primary shadow-[0_0_16px_rgba(163,230,53,0.2)] mb-space-lg">
            <span class="material-symbols-outlined text-headline-md">touch_app</span>
          </div>
          <h3 class="font-headline-md text-headline-md text-on-surface font-bold">Frictionless Booking</h3>
          <p class="font-body-md text-body-md text-on-surface-variant mt-space-sm leading-relaxed">
            Reserve private courts in under 3 taps, effortlessly split fees with doubles partners via QR/SMS, and automatically unlock gate access codes synced to your reservation time.
          </p>
        </div>
        <div class="mt-space-lg pt-space-md flex items-center gap-2 text-primary font-label-md text-label-md font-semibold">
          <span>Learn smart court locks</span>
          <span class="material-symbols-outlined text-label-md group-hover:translate-x-1 transition-transform">arrow_forward</span>
        </div>
      </div>
      <!-- Card 2 -->
      <div class="relative p-space-xl rounded-2xl bg-surface-container-high backdrop-blur-md shadow-lg flex flex-col justify-between overflow-hidden group hover:translate-y-[-4px] transition-all">
        <div class="absolute -right-8 -top-8 w-32 h-32 bg-secondary/15 rounded-full blur-2xl group-hover:bg-secondary/25 transition-all"></div>
        <div>
          <div class="w-14 h-14 rounded-2xl bg-surface-container flex items-center justify-center text-secondary shadow-[0_0_16px_rgba(164,214,76,0.2)] mb-space-lg">
            <span class="material-symbols-outlined text-headline-md">analytics</span>
          </div>
          <h3 class="font-headline-md text-headline-md text-on-surface font-bold">DUPR Ready</h3>
          <p class="font-body-md text-body-md text-on-surface-variant mt-space-sm leading-relaxed">
            Bring your DUPR rating to your club community. Find players at your skill level and get ready for your next competitive match.
          </p>
        </div>
        <div class="mt-space-lg pt-space-md flex items-center gap-2 text-secondary font-label-md text-label-md font-semibold">
          <span>Explore DUPR Ready play</span>
          <span class="material-symbols-outlined text-label-md group-hover:translate-x-1 transition-transform">arrow_forward</span>
        </div>
      </div>
      <!-- Card 3 -->
      <div class="relative p-space-xl rounded-2xl bg-surface-container-high backdrop-blur-md shadow-lg flex flex-col justify-between overflow-hidden group hover:translate-y-[-4px] transition-all">
        <div class="absolute -right-8 -top-8 w-32 h-32 bg-primary-fixed-dim/15 rounded-full blur-2xl group-hover:bg-primary-fixed-dim/25 transition-all"></div>
        <div>
          <div class="w-14 h-14 rounded-2xl bg-surface-container flex items-center justify-center text-primary-fixed-dim shadow-[0_0_16px_rgba(152,218,39,0.2)] mb-space-lg">
            <span class="material-symbols-outlined text-headline-md">domain_add</span>
          </div>
          <h3 class="font-headline-md text-headline-md text-on-surface font-bold">Club Management Suite</h3>
          <p class="font-body-md text-body-md text-on-surface-variant mt-space-sm leading-relaxed">
            Turnkey court operations for facility owners. Dynamic slot yield pricing, automated floodlight control integrations, membership tiered booking windows, and pro shop POS.
          </p>
        </div>
        <div class="mt-space-lg pt-space-md flex items-center gap-2 text-primary font-label-md text-label-md font-semibold">
          <span>Explore Partner Pro features</span>
          <span class="material-symbols-outlined text-label-md group-hover:translate-x-1 transition-transform">arrow_forward</span>
        </div>
      </div>
    </div>
  </div>
</section>

<!-- INTERACTIVE MATCHMAKING & OPEN PLAY PREVIEW -->
<section class="w-full py-space-xl px-gutter md:px-margin-desktop bg-surface">
  <div class="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-space-xl items-center">
    <!-- Left Column text info -->
    <div class="lg:col-span-5 flex flex-col gap-space-md">
      <span class="font-label-sm text-label-sm uppercase tracking-widest text-primary font-semibold">Peer-to-Peer Match Engine</span>
      <h2 class="font-headline-lg text-headline-lg text-on-surface">Looking for players at your exact skill level?</h2>
      <p class="font-body-lg text-body-md md:text-body-lg text-on-surface-variant">
        Never sit on the bench waiting for partners again. Drop into verified open play rotations, connect with players at your skill level, or host private King of the Court lobbies.
      </p>
      <div class="flex flex-col gap-space-sm pt-space-sm">
        <div class="flex items-center gap-space-sm">
          <span class="material-symbols-outlined text-primary text-headline-sm">verified_user</span>
          <span class="font-body-md text-body-md text-on-surface">Algorithmic handicap matchmaking ensures competitive rallies</span>
        </div>
        <div class="flex items-center gap-space-sm">
          <span class="material-symbols-outlined text-primary text-headline-sm">notifications_active</span>
          <span class="font-body-md text-body-md text-on-surface">Instant court push notifications when slots drop near you</span>
        </div>
        <div class="flex items-center gap-space-sm">
          <span class="material-symbols-outlined text-primary text-headline-sm">groups</span>
          <span class="font-body-md text-body-md text-on-surface">Community dinking ladders &amp; weekend round-robins</span>
        </div>
      </div>
      <div class="pt-space-md">
        <a class="inline-flex items-center gap-space-xs font-label-lg text-label-lg px-space-lg py-space-sm bg-surface-container-high hover:bg-surface-bright text-on-surface rounded-full transition-colors no-underline" href="#/auth?mode=up">
          <span>Browse All Active Lobbies</span>
          <span class="material-symbols-outlined text-label-md">arrow_forward</span>
        </a>
      </div>
    </div>
    <!-- Right Column: Live Open Sessions Widget -->
    <div class="lg:col-span-7 flex flex-col gap-space-md bg-surface-container-high p-space-lg md:p-space-xl rounded-2xl shadow-xl">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-space-xs">
          <span class="w-3 h-3 rounded-full bg-primary animate-pulse"></span>
          <span class="font-headline-sm text-headline-sm text-on-surface font-bold">Open Play Preview</span>
        </div>
        <span class="font-label-sm text-label-sm text-on-surface-variant">Metro Region • Sample Sessions</span>
      </div>
      <div class="flex flex-col gap-space-sm mt-space-xs">
        <!-- Match Session 1: Full -->
        <div class="p-space-md rounded-xl bg-surface-container flex flex-col sm:flex-row items-start sm:items-center justify-between gap-space-md">
          <div class="flex items-center gap-space-md">
            <div class="w-12 h-12 rounded-xl bg-surface-container-highest flex items-center justify-center text-primary font-headline-sm font-bold">
              3.5
            </div>
            <div>
              <div class="flex items-center gap-2">
                <h4 class="font-headline-sm text-headline-sm text-on-surface font-semibold">Intermediate Open Play</h4>
                <span class="px-2 py-0.5 rounded-full bg-surface-bright text-outline text-label-sm font-label-sm">4/4 Full</span>
              </div>
              <p class="font-body-sm text-body-sm text-on-surface-variant">Southside Courts • Starts in 45m • 2hr session</p>
            </div>
          </div>
          <button class="px-space-md py-2 rounded-full bg-surface-container-highest text-outline font-label-md text-label-md cursor-not-allowed border-0" disabled="">
            Waitlist Full
          </button>
        </div>
        <!-- Match Session 2: 1 Spot Remaining (Active Highlight) -->
        <div class="p-space-md rounded-xl bg-surface-container flex flex-col sm:flex-row items-start sm:items-center justify-between gap-space-md relative overflow-hidden shadow-[0_0_20px_rgba(163,230,53,0.15)]">
          <div class="absolute left-0 top-0 bottom-0 w-1.5 bg-primary"></div>
          <div class="flex items-center gap-space-md pl-1">
            <div class="w-12 h-12 rounded-xl bg-primary/20 flex items-center justify-center text-primary font-headline-sm font-bold">
              4.5+
            </div>
            <div>
              <div class="flex items-center gap-2">
                <h4 class="font-headline-sm text-headline-sm text-on-surface font-semibold">Competitive King of Court</h4>
                <span class="px-2 py-0.5 rounded-full bg-primary/20 text-primary text-label-sm font-label-sm font-bold animate-pulse">1 Spot Left!</span>
              </div>
              <p class="font-body-sm text-body-sm text-on-surface-variant">Apex Dinking Hub • Today, 7:00 PM • DUPR Ready</p>
            </div>
          </div>
          <a class="px-space-lg py-2 rounded-full bg-primary hover:bg-secondary-fixed text-on-primary font-label-md text-label-md font-bold shadow-[0_0_16px_rgba(163,230,53,0.35)] transition-all no-underline" href="#/auth?mode=up">Claim Slot</a>
        </div>
        <!-- Match Session 3: Clinic Spots -->
        <div class="p-space-md rounded-xl bg-surface-container flex flex-col sm:flex-row items-start sm:items-center justify-between gap-space-md">
          <div class="flex items-center gap-space-md">
            <div class="w-12 h-12 rounded-xl bg-surface-container-highest flex items-center justify-center text-secondary font-headline-sm font-bold">
              2.5
            </div>
            <div>
              <div class="flex items-center gap-2">
                <h4 class="font-headline-sm text-headline-sm text-on-surface font-semibold">Mixed Doubles Beginner Clinic</h4>
                <span class="px-2 py-0.5 rounded-full bg-surface-container-highest text-secondary text-label-sm font-label-sm">6/8 Filled</span>
              </div>
              <p class="font-body-sm text-body-sm text-on-surface-variant">The Pickleshot Club • Tomorrow, 10:00 AM • Led by Coach Vance</p>
            </div>
          </div>
          <a class="px-space-md py-2 rounded-full bg-surface-bright hover:bg-surface-container-highest text-on-surface font-label-md text-label-md font-semibold transition-colors no-underline" href="#/auth?mode=up">Join Clinic</a>
        </div>
      </div>
    </div>
  </div>
</section>

<!-- CLUB OWNER / PARTNER PRO BANNER -->
<section class="w-full py-space-lg px-gutter md:px-margin-desktop bg-surface">
  <div class="max-w-7xl mx-auto p-space-xl rounded-3xl bg-gradient-to-r from-surface-container-high via-surface-container to-surface-container-high shadow-2xl relative overflow-hidden">
    <div class="absolute right-0 top-0 bottom-0 w-1/3 bg-primary/5 blur-3xl pointer-events-none"></div>
    <div class="flex flex-col md:flex-row items-center justify-between gap-space-xl relative z-10">
      <div class="flex flex-col gap-space-xs max-w-2xl">
        <div class="inline-flex items-center gap-2 font-label-sm text-label-sm text-primary uppercase font-bold tracking-wider">
          <span class="material-symbols-outlined text-label-md">storefront</span> DINKSLOT PARTNER PRO
        </div>
        <h3 class="font-headline-lg text-headline-lg text-on-surface font-bold">
          Own or manage a pickleball facility?
        </h3>
        <p class="font-body-lg text-body-md md:text-body-lg text-on-surface-variant">
          Fill off-peak court hours by up to <span class="text-primary font-bold">40%</span>, eliminate manual spreadsheet headaches, and connect directly to 45,000+ local paddle athletes.
        </p>
      </div>
      <div class="flex flex-col sm:flex-row items-center gap-space-md whitespace-nowrap">
        <a class="px-space-xl py-space-md rounded-full bg-surface-container-highest hover:bg-surface-bright text-on-surface font-label-lg text-label-lg font-bold transition-all shadow-md no-underline" href="#/register-club">
          Schedule Demo
        </a>
        <a class="px-space-xl py-space-md rounded-full bg-primary hover:bg-secondary-fixed text-on-primary font-label-lg text-label-lg font-bold shadow-[0_0_20px_rgba(163,230,53,0.3)] hover:shadow-[0_0_28px_rgba(163,230,53,0.5)] transition-all no-underline" href="#/register-club">
          Register Your Club
        </a>
      </div>
    </div>
  </div>
</section>

<!-- CALL TO ACTION BANNER (BOTTOM) -->
<section class="w-full py-space-xl px-gutter md:px-margin-desktop bg-surface-container-lowest">
  <div class="max-w-6xl mx-auto rounded-3xl p-space-xl md:p-20 text-center relative overflow-hidden bg-gradient-to-b from-surface-container to-surface-container-lowest shadow-[0_0_50px_rgba(0,0,0,0.8)]">
    <!-- Glow ambient backdrop -->
    <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[250px] bg-primary/15 rounded-full blur-[100px] pointer-events-none"></div>
    <div class="relative z-10 flex flex-col items-center max-w-3xl mx-auto">
      <span class="font-label-sm text-label-sm uppercase tracking-widest text-primary font-bold">Instant Access</span>
      <h2 class="font-headline-display text-headline-display-mobile md:text-headline-display text-on-surface font-bold mt-2">
        Ready to rule the court?
      </h2>
      <p class="font-body-lg text-body-md md:text-body-lg text-on-surface-variant mt-space-md max-w-xl">
        Find your club and book your next court slot online in under 60 seconds.
      </p>
      <!-- CTA Buttons -->
      <div class="flex flex-col sm:flex-row items-center gap-space-md mt-space-xl">
        <a class="px-space-xl py-space-md rounded-full bg-primary hover:bg-secondary-fixed text-on-primary font-label-lg text-label-lg font-bold shadow-[0_0_28px_rgba(163,230,53,0.4)] hover:shadow-[0_0_36px_rgba(163,230,53,0.6)] transition-all no-underline" href="#/auth?mode=up">
          Get Started for Free
        </a>
        <div class="flex items-center gap-space-sm">
          <a class="flex items-center gap-space-xs px-space-md py-space-sm rounded-full bg-surface-container-high hover:bg-surface-bright text-on-surface transition-colors no-underline" href="#/auth">
            <span class="material-symbols-outlined text-primary text-headline-sm">phone_iphone</span>
            <span class="font-label-md text-label-md font-semibold">Player Sign In</span>
          </a>
          <a class="flex items-center gap-space-xs px-space-md py-space-sm rounded-full bg-surface-container-high hover:bg-surface-bright text-on-surface transition-colors no-underline" href="#/auth">
            <span class="material-symbols-outlined text-primary text-headline-sm">smart_display</span>
            <span class="font-label-md text-label-md font-semibold">My Bookings</span>
          </a>
        </div>
      </div>
      <!-- Footnote guarantee -->
      <p class="font-label-sm text-label-sm text-outline mt-space-lg flex items-center gap-1.5">
        <span class="material-symbols-outlined text-label-md text-primary">verified</span>
        Booking rates and cancellation policies are set by each club.
      </p>
    </div>
  </div>
</section>
</div>`;

document.querySelectorAll("[data-landing-section]").forEach(function (button) {
  button.addEventListener("click", function () {
    var section = document.getElementById(button.getAttribute("data-landing-section"));
    if (section) section.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  });
});
