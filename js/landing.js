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
      <div class="landing-search-controls grid grid-cols-1 md:grid-cols-12 gap-space-xs items-stretch">
        <!-- Venue / Search Input -->
        <div class="landing-search-field md:col-span-4 flex items-center gap-space-sm px-space-md py-3.5 rounded-xl bg-surface-container text-left group transition-all">
          <span class="material-symbols-outlined text-primary text-headline-sm">search</span>
          <div class="flex flex-col flex-1 min-w-0">
            <span class="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider">Search Venue</span>
            <input id="q" data-has-icon aria-label="Search clubs" class="bg-transparent font-body-md text-body-md text-on-surface placeholder:text-outline focus:outline-none w-full truncate border-0 p-0" placeholder="Club name, venue, or zip..." type="text"/>
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
        <div class="landing-search-action md:col-span-2 flex items-stretch">
          <button id="find-courts-btn" type="button" class="w-full h-full min-h-[52px] rounded-xl bg-primary hover:bg-secondary-fixed text-on-primary font-headline-sm text-label-lg font-bold uppercase tracking-tight flex items-center justify-center gap-space-xs shadow-[0_0_24px_rgba(163,230,53,0.35)] hover:shadow-[0_0_32px_rgba(163,230,53,0.6)] transition-all cursor-pointer border-0">
            <span>Find Courts</span>
            <span class="material-symbols-outlined text-label-lg">arrow_forward</span>
          </button>
        </div>
      </div>
      <!-- Filter Pills Sub-bar -->
      <div class="landing-court-filter-row flex flex-wrap items-center justify-between text-left border-t border-outline-variant/20">
        <div class="landing-court-filter-options flex flex-wrap items-center font-label-md text-label-md">
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
        <button type="button" class="club-tab" data-tab="all" aria-pressed="true">
          <span class="material-symbols-outlined text-base" aria-hidden="true">grid_view</span>
          <span>All Clubs</span>
        </button>
        <button type="button" class="club-tab" data-tab="indoor" aria-pressed="false">
          <span class="material-symbols-outlined text-base" aria-hidden="true">roofing</span>
          <span>Indoor Courts</span>
        </button>
        <button type="button" class="club-tab" data-tab="outdoor" aria-pressed="false">
          <span class="material-symbols-outlined text-base" aria-hidden="true">wb_sunny</span>
          <span>Outdoor Courts</span>
        </button>
      </div>
    </div>
    <div class="flex items-center">
      <div id="ccount" class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-surface-container-high/60 border border-outline-variant/20 font-mono text-xs text-on-surface-variant" role="status">
        <span class="w-1.5 h-1.5 rounded-full bg-primary animate-pulse"></span>
        <span>Discovering premier pickleball venues...</span>
      </div>
    </div>
    <div id="grid" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-space-lg" aria-label="Loading clubs">
      <!-- Skeleton Club Card 1 -->
      <article class="group flex flex-col rounded-2xl bg-surface-container-high overflow-hidden shadow-lg border border-outline-variant/15" aria-hidden="true">
        <div class="relative h-48 w-full bg-surface-container ds-skeleton">
          <div class="absolute top-3 left-3 w-24 h-6 rounded-full bg-surface-container-lowest/70 backdrop-blur-md"></div>
          <div class="absolute top-3 right-3 w-14 h-6 rounded-full bg-surface-container-lowest/70 backdrop-blur-md"></div>
        </div>
        <div class="p-space-lg flex flex-col flex-1 justify-between gap-space-md">
          <div class="flex flex-col gap-2.5">
            <div class="h-3.5 w-28 rounded bg-surface-container-highest/70 ds-skeleton"></div>
            <div class="h-5 w-44 rounded-md bg-surface-container-highest ds-skeleton"></div>
            <div class="h-3.5 w-36 rounded bg-surface-container-highest/60 ds-skeleton"></div>
          </div>
          <div class="pt-space-md flex items-center justify-between border-t border-outline-variant/20">
            <div class="h-5 w-20 rounded bg-surface-container-highest/80 ds-skeleton"></div>
            <div class="h-9 w-28 rounded-full bg-primary/20 ds-skeleton"></div>
          </div>
        </div>
      </article>
      <!-- Skeleton Club Card 2 -->
      <article class="group flex flex-col rounded-2xl bg-surface-container-high overflow-hidden shadow-lg border border-outline-variant/15" aria-hidden="true">
        <div class="relative h-48 w-full bg-surface-container ds-skeleton">
          <div class="absolute top-3 left-3 w-28 h-6 rounded-full bg-surface-container-lowest/70 backdrop-blur-md"></div>
          <div class="absolute top-3 right-3 w-14 h-6 rounded-full bg-surface-container-lowest/70 backdrop-blur-md"></div>
        </div>
        <div class="p-space-lg flex flex-col flex-1 justify-between gap-space-md">
          <div class="flex flex-col gap-2.5">
            <div class="h-3.5 w-32 rounded bg-surface-container-highest/70 ds-skeleton"></div>
            <div class="h-5 w-40 rounded-md bg-surface-container-highest ds-skeleton"></div>
            <div class="h-3.5 w-32 rounded bg-surface-container-highest/60 ds-skeleton"></div>
          </div>
          <div class="pt-space-md flex items-center justify-between border-t border-outline-variant/20">
            <div class="h-5 w-20 rounded bg-surface-container-highest/80 ds-skeleton"></div>
            <div class="h-9 w-28 rounded-full bg-primary/20 ds-skeleton"></div>
          </div>
        </div>
      </article>
      <!-- Skeleton Club Card 3 -->
      <article class="group flex flex-col rounded-2xl bg-surface-container-high overflow-hidden shadow-lg border border-outline-variant/15" aria-hidden="true">
        <div class="relative h-48 w-full bg-surface-container ds-skeleton">
          <div class="absolute top-3 left-3 w-24 h-6 rounded-full bg-surface-container-lowest/70 backdrop-blur-md"></div>
          <div class="absolute top-3 right-3 w-14 h-6 rounded-full bg-surface-container-lowest/70 backdrop-blur-md"></div>
        </div>
        <div class="p-space-lg flex flex-col flex-1 justify-between gap-space-md">
          <div class="flex flex-col gap-2.5">
            <div class="h-3.5 w-24 rounded bg-surface-container-highest/70 ds-skeleton"></div>
            <div class="h-5 w-48 rounded-md bg-surface-container-highest ds-skeleton"></div>
            <div class="h-3.5 w-36 rounded bg-surface-container-highest/60 ds-skeleton"></div>
          </div>
          <div class="pt-space-md flex items-center justify-between border-t border-outline-variant/20">
            <div class="h-5 w-20 rounded bg-surface-container-highest/80 ds-skeleton"></div>
            <div class="h-9 w-28 rounded-full bg-primary/20 ds-skeleton"></div>
          </div>
        </div>
      </article>
      <!-- Skeleton Club Card 4 -->
      <article class="group flex flex-col rounded-2xl bg-surface-container-high overflow-hidden shadow-lg border border-outline-variant/15" aria-hidden="true">
        <div class="relative h-48 w-full bg-surface-container ds-skeleton">
          <div class="absolute top-3 left-3 w-24 h-6 rounded-full bg-surface-container-lowest/70 backdrop-blur-md"></div>
          <div class="absolute top-3 right-3 w-14 h-6 rounded-full bg-surface-container-lowest/70 backdrop-blur-md"></div>
        </div>
        <div class="p-space-lg flex flex-col flex-1 justify-between gap-space-md">
          <div class="flex flex-col gap-2.5">
            <div class="h-3.5 w-28 rounded bg-surface-container-highest/70 ds-skeleton"></div>
            <div class="h-5 w-36 rounded-md bg-surface-container-highest ds-skeleton"></div>
            <div class="h-3.5 w-32 rounded bg-surface-container-highest/60 ds-skeleton"></div>
          </div>
          <div class="pt-space-md flex items-center justify-between border-t border-outline-variant/20">
            <div class="h-5 w-20 rounded bg-surface-container-highest/80 ds-skeleton"></div>
            <div class="h-9 w-28 rounded-full bg-primary/20 ds-skeleton"></div>
          </div>
        </div>
      </article>
    </div>
  </div>
</section>

<!-- WHY PLAYERS & CLUB OWNERS CHOOSE DINKSLOT -->
<section id="landing-features" class="w-full py-space-xl px-gutter md:px-margin-desktop bg-surface-container-low relative">
  <div class="max-w-7xl mx-auto flex flex-col gap-space-xl">
    <div class="text-center max-w-3xl mx-auto flex flex-col items-center">
      <span class="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-surface-container border border-white/[0.08] text-primary font-label-sm text-[11px] font-semibold tracking-widest uppercase mb-2">
        <span class="w-1.5 h-1.5 rounded-full bg-primary animate-pulse"></span>
        Engineered For Performance
      </span>
      <h2 class="font-headline-lg text-2xl md:text-4xl text-on-surface font-extrabold tracking-tight mt-1">Why Players &amp; Club Owners Choose DINKSLOT</h2>
      <p class="font-body-md text-sm md:text-base text-on-surface-variant mt-2.5 max-w-2xl leading-relaxed">The modern athletic operating system designed to elevate recreational play into competitive perfection and maximize court yield.</p>
    </div>
    <!-- 3 Modern Bento Feature Cards -->
    <div class="landing-feature-grid grid grid-cols-1 md:grid-cols-3 gap-6 lg:gap-8">
      <!-- Card 1: Frictionless Booking -->
      <div class="relative p-6 sm:p-7 rounded-3xl bg-surface-container/70 hover:bg-surface-container border border-white/[0.08] hover:border-primary/40 transition-all duration-300 shadow-[0_8px_30px_rgb(0,0,0,0.35)] hover:shadow-[0_16px_40px_-10px_rgba(177,233,3,0.18)] hover:-translate-y-1 flex flex-col justify-between overflow-hidden group">
        <!-- Specular top highlight -->
        <div class="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent"></div>
        <!-- Ambient gradient glow on hover -->
        <div class="absolute -right-12 -top-12 w-44 h-44 bg-primary/10 rounded-full blur-3xl pointer-events-none group-hover:bg-primary/20 transition-all duration-500"></div>

        <div>
          <!-- Card top row: icon + micro-badge -->
          <div class="flex items-center justify-between gap-3 mb-6">
            <div class="w-12 h-12 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/30 flex items-center justify-center text-primary shadow-[0_0_20px_rgba(177,233,3,0.18)]">
              <span class="material-symbols-outlined text-2xl">key</span>
            </div>
            <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-primary font-label-sm text-[11px] font-semibold tracking-wide uppercase">
              <span class="w-1.5 h-1.5 rounded-full bg-primary animate-pulse"></span>
              3-Tap Reserve
            </span>
          </div>

          <h3 class="font-headline-md text-xl md:text-2xl text-on-surface font-bold tracking-tight">Frictionless Booking</h3>
          <p class="font-body-md text-sm text-on-surface-variant mt-2.5 leading-relaxed">
            Reserve private courts in under 3 taps, effortlessly split fees with doubles partners via QR/SMS, and automatically unlock gate access codes synced to your reservation time.
          </p>

          <!-- Micro-widget: Smart Gate Access preview -->
          <div class="my-5 p-3.5 rounded-2xl bg-surface-container-lowest/80 border border-white/[0.06] flex items-center justify-between gap-3 shadow-inner">
            <div class="flex items-center gap-3">
              <div class="w-9 h-9 rounded-xl bg-surface-container-high border border-white/[0.06] flex items-center justify-center text-primary">
                <span class="material-symbols-outlined text-lg">pin</span>
              </div>
              <div class="flex flex-col">
                <span class="font-label-sm text-[10px] text-on-surface-variant uppercase tracking-wider">Gate PIN Code</span>
                <span class="font-label-lg text-xs md:text-sm text-primary font-bold tracking-widest font-mono">#4892 • Court 2</span>
              </div>
            </div>
            <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-primary/10 text-primary text-[10px] font-label-sm font-semibold border border-primary/20 shrink-0">
              <span class="material-symbols-outlined text-xs">lock_open</span> Auto-Sync
            </span>
          </div>
        </div>

        <div class="pt-4 border-t border-white/[0.06] flex items-center justify-between">
          <a href="#/auth?mode=up" class="inline-flex items-center gap-2 text-primary hover:text-secondary-fixed font-label-sm text-xs font-semibold tracking-wide transition-colors group/link no-underline">
            <span>Learn smart court locks</span>
            <span class="material-symbols-outlined text-sm transition-transform duration-200 group-hover/link:translate-x-1">arrow_forward</span>
          </a>
        </div>
      </div>

      <!-- Card 2: DUPR Ready -->
      <div class="relative p-6 sm:p-7 rounded-3xl bg-surface-container/70 hover:bg-surface-container border border-white/[0.08] hover:border-secondary/40 transition-all duration-300 shadow-[0_8px_30px_rgb(0,0,0,0.35)] hover:shadow-[0_16px_40px_-10px_rgba(164,214,76,0.18)] hover:-translate-y-1 flex flex-col justify-between overflow-hidden group">
        <!-- Specular top highlight -->
        <div class="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-secondary/30 to-transparent"></div>
        <!-- Ambient gradient glow on hover -->
        <div class="absolute -right-12 -top-12 w-44 h-44 bg-secondary/10 rounded-full blur-3xl pointer-events-none group-hover:bg-secondary/20 transition-all duration-500"></div>

        <div>
          <!-- Card top row: icon + micro-badge -->
          <div class="flex items-center justify-between gap-3 mb-6">
            <div class="w-12 h-12 rounded-2xl bg-gradient-to-br from-secondary/20 to-secondary/5 border border-secondary/30 flex items-center justify-center text-secondary shadow-[0_0_20px_rgba(164,214,76,0.18)]">
              <span class="material-symbols-outlined text-2xl">verified</span>
            </div>
            <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-secondary/10 border border-secondary/20 text-secondary font-label-sm text-[11px] font-semibold tracking-wide uppercase">
              <span class="w-1.5 h-1.5 rounded-full bg-secondary"></span>
              DUPR Certified
            </span>
          </div>

          <h3 class="font-headline-md text-xl md:text-2xl text-on-surface font-bold tracking-tight">DUPR Ready</h3>
          <p class="font-body-md text-sm text-on-surface-variant mt-2.5 leading-relaxed">
            Bring your DUPR rating to your club community. Find players at your exact skill level, record validated match outcomes, and get ready for your next competitive match.
          </p>

          <!-- Micro-widget: DUPR Live Rating preview -->
          <div class="my-5 p-3.5 rounded-2xl bg-surface-container-lowest/80 border border-white/[0.06] flex items-center justify-between gap-3 shadow-inner">
            <div class="flex items-center gap-3">
              <div class="w-9 h-9 rounded-xl bg-surface-container-high border border-white/[0.06] flex items-center justify-center text-secondary font-label-lg font-bold text-xs font-mono">
                DUPR
              </div>
              <div class="flex flex-col">
                <span class="font-label-sm text-[10px] text-on-surface-variant uppercase tracking-wider">Dynamic Rating</span>
                <span class="font-label-lg text-xs md:text-sm text-on-surface font-bold tracking-tight font-mono">4.38 <span class="text-secondary text-xs font-normal">±0.06</span></span>
              </div>
            </div>
            <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-secondary/10 text-secondary text-[10px] font-label-sm font-semibold border border-secondary/20 shrink-0">
              <span class="material-symbols-outlined text-xs">trending_up</span> 100% Reliable
            </span>
          </div>
        </div>

        <div class="pt-4 border-t border-white/[0.06] flex items-center justify-between">
          <a href="#/auth?mode=up" class="inline-flex items-center gap-2 text-secondary hover:text-secondary-fixed font-label-sm text-xs font-semibold tracking-wide transition-colors group/link no-underline">
            <span>Explore DUPR Ready play</span>
            <span class="material-symbols-outlined text-sm transition-transform duration-200 group-hover/link:translate-x-1">arrow_forward</span>
          </a>
        </div>
      </div>

      <!-- Card 3: Club Management Suite -->
      <div class="relative p-6 sm:p-7 rounded-3xl bg-surface-container/70 hover:bg-surface-container border border-white/[0.08] hover:border-primary-fixed-dim/40 transition-all duration-300 shadow-[0_8px_30px_rgb(0,0,0,0.35)] hover:shadow-[0_16px_40px_-10px_rgba(152,218,39,0.18)] hover:-translate-y-1 flex flex-col justify-between overflow-hidden group">
        <!-- Specular top highlight -->
        <div class="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary-fixed-dim/30 to-transparent"></div>
        <!-- Ambient gradient glow on hover -->
        <div class="absolute -right-12 -top-12 w-44 h-44 bg-primary-fixed-dim/10 rounded-full blur-3xl pointer-events-none group-hover:bg-primary-fixed-dim/20 transition-all duration-500"></div>

        <div>
          <!-- Card top row: icon + micro-badge -->
          <div class="flex items-center justify-between gap-3 mb-6">
            <div class="w-12 h-12 rounded-2xl bg-gradient-to-br from-primary-fixed-dim/20 to-primary-fixed-dim/5 border border-primary-fixed-dim/30 flex items-center justify-center text-primary-fixed-dim shadow-[0_0_20px_rgba(152,218,39,0.18)]">
              <span class="material-symbols-outlined text-2xl">monitoring</span>
            </div>
            <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary-fixed-dim/10 border border-primary-fixed-dim/20 text-primary-fixed-dim font-label-sm text-[11px] font-semibold tracking-wide uppercase">
              <span class="w-1.5 h-1.5 rounded-full bg-primary-fixed-dim"></span>
              Turnkey OS
            </span>
          </div>

          <h3 class="font-headline-md text-xl md:text-2xl text-on-surface font-bold tracking-tight">Club Management Suite</h3>
          <p class="font-body-md text-sm text-on-surface-variant mt-2.5 leading-relaxed">
            Turnkey court operations for facility owners. Dynamic slot yield pricing, automated floodlight control integrations, membership tiered booking windows, and pro shop POS.
          </p>

          <!-- Micro-widget: Facility Yield & IoT Lights preview -->
          <div class="my-5 p-3.5 rounded-2xl bg-surface-container-lowest/80 border border-white/[0.06] flex items-center justify-between gap-3 shadow-inner">
            <div class="flex items-center gap-3">
              <div class="w-9 h-9 rounded-xl bg-surface-container-high border border-white/[0.06] flex items-center justify-center text-primary-fixed-dim">
                <span class="material-symbols-outlined text-lg">lightbulb</span>
              </div>
              <div class="flex flex-col">
                <span class="font-label-sm text-[10px] text-on-surface-variant uppercase tracking-wider">IoT Court Lights</span>
                <span class="font-label-lg text-xs md:text-sm text-on-surface font-bold tracking-tight font-mono">Auto-On <span class="text-primary-fixed-dim text-xs font-normal">Active</span></span>
              </div>
            </div>
            <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-primary-fixed-dim/10 text-primary-fixed-dim text-[10px] font-label-sm font-semibold border border-primary-fixed-dim/20 shrink-0">
              <span class="material-symbols-outlined text-xs">north_east</span> +38% Yield
            </span>
          </div>
        </div>

        <div class="pt-4 border-t border-white/[0.06] flex items-center justify-between">
          <a href="#/register-club" class="inline-flex items-center gap-2 text-primary-fixed-dim hover:text-primary font-label-sm text-xs font-semibold tracking-wide transition-colors group/link no-underline">
            <span>Explore Partner Pro features</span>
            <span class="material-symbols-outlined text-sm transition-transform duration-200 group-hover/link:translate-x-1">arrow_forward</span>
          </a>
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
      <div class="inline-flex items-center gap-2 font-label-sm text-label-sm uppercase tracking-widest text-primary font-semibold">
        <span class="w-1.5 h-1.5 rounded-full bg-primary"></span>
        Peer-to-Peer Match Engine
      </div>
      <h2 class="font-headline-lg text-2xl md:text-4xl text-on-surface font-extrabold tracking-tight">Looking for players at your exact skill level?</h2>
      <p class="font-body-lg text-body-md md:text-body-lg text-on-surface-variant leading-relaxed">
        Never sit on the bench waiting for partners again. Drop into verified open play rotations, connect with players at your skill level, or host private King of the Court lobbies.
      </p>
      <div class="flex flex-col gap-3.5 pt-2">
        <div class="flex items-center gap-3">
          <div class="w-8 h-8 rounded-lg bg-surface-container-high border border-white/[0.06] flex items-center justify-center text-primary shrink-0">
            <span class="material-symbols-outlined text-lg">verified_user</span>
          </div>
          <span class="font-body-md text-sm text-on-surface">Algorithmic handicap matchmaking ensures competitive rallies</span>
        </div>
        <div class="flex items-center gap-3">
          <div class="w-8 h-8 rounded-lg bg-surface-container-high border border-white/[0.06] flex items-center justify-center text-primary shrink-0">
            <span class="material-symbols-outlined text-lg">notifications_active</span>
          </div>
          <span class="font-body-md text-sm text-on-surface">Instant court push notifications when slots drop near you</span>
        </div>
        <div class="flex items-center gap-3">
          <div class="w-8 h-8 rounded-lg bg-surface-container-high border border-white/[0.06] flex items-center justify-center text-primary shrink-0">
            <span class="material-symbols-outlined text-lg">groups</span>
          </div>
          <span class="font-body-md text-sm text-on-surface">Community dinking ladders &amp; weekend round-robins</span>
        </div>
      </div>
      <div class="pt-4">
        <a class="inline-flex items-center gap-2 font-label-lg text-xs md:text-sm px-6 py-3 bg-surface-container-high hover:bg-surface-bright border border-white/[0.08] hover:border-white/[0.16] text-on-surface rounded-full transition-all shadow-md no-underline group" href="#/auth?mode=up">
          <span>Browse All Active Lobbies</span>
          <span class="material-symbols-outlined text-base transition-transform group-hover:translate-x-1">arrow_forward</span>
        </a>
      </div>
    </div>
    <!-- Right Column: Live Open Sessions Widget -->
    <div class="lg:col-span-7 flex flex-col gap-4 p-5 sm:p-7 md:p-8 rounded-3xl bg-surface-container-low/95 border border-white/[0.08] shadow-[0_20px_50px_rgba(0,0,0,0.5)] backdrop-blur-xl relative overflow-hidden">
      <!-- Subtle top-right ambient glow -->
      <div class="absolute -top-20 -right-20 w-56 h-56 bg-primary/10 rounded-full blur-3xl pointer-events-none"></div>

      <!-- Widget Header -->
      <div class="flex items-center justify-between gap-3 relative z-10">
        <div class="flex items-center gap-2.5">
          <span class="relative flex h-2.5 w-2.5">
            <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
            <span class="relative inline-flex rounded-full h-2.5 w-2.5 bg-primary"></span>
          </span>
          <h3 class="font-headline-sm text-lg md:text-xl text-on-surface font-bold tracking-tight">Open Play Preview</h3>
        </div>
        <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-surface-container-highest/80 border border-white/[0.06] text-on-surface-variant font-label-sm text-[11px]">
          <span class="material-symbols-outlined text-[13px] text-primary">sensors</span> Metro Region • Real-time
        </span>
      </div>

      <!-- Match Sessions List -->
      <div class="flex flex-col gap-3 relative z-10 mt-1">
        <!-- Match Session 1: Full -->
        <div class="p-3.5 sm:p-4 rounded-2xl bg-surface-container/70 hover:bg-surface-container border border-white/[0.06] transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3.5">
          <div class="flex items-center gap-3.5 min-w-0">
            <div class="w-12 h-12 rounded-xl bg-surface-container-highest/70 border border-white/[0.06] flex flex-col items-center justify-center text-center shrink-0">
              <span class="text-[9px] font-label-sm text-outline uppercase font-semibold leading-none">DUPR</span>
              <span class="font-headline-sm text-base font-bold text-on-surface leading-tight mt-0.5">3.5</span>
            </div>
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-2">
                <h4 class="font-headline-sm text-sm sm:text-base text-on-surface font-semibold truncate">Intermediate Open Play</h4>
                <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-surface-container-highest border border-white/[0.04] text-outline text-[11px] font-label-sm font-medium">
                  <span class="material-symbols-outlined text-[12px]">lock</span> 4/4 Full
                </span>
              </div>
              <p class="font-body-sm text-xs text-on-surface-variant mt-0.5 flex items-center gap-1.5 flex-wrap">
                <span>Southside Courts</span>
                <span class="text-outline-variant">•</span>
                <span>Starts in 45m</span>
                <span class="text-outline-variant">•</span>
                <span>2hr session</span>
              </p>
            </div>
          </div>
          <button class="sm:self-center px-4 py-2 rounded-xl bg-surface-container-highest/40 border border-white/[0.04] text-outline font-label-sm text-xs cursor-not-allowed whitespace-nowrap self-start" disabled="">
            Waitlist Full
          </button>
        </div>

        <!-- Match Session 2: 1 Spot Remaining (Active Highlight) -->
        <div class="p-3.5 sm:p-4 rounded-2xl bg-gradient-to-r from-primary/[0.12] via-surface-container/90 to-surface-container/90 border border-primary/40 shadow-[0_0_24px_rgba(177,233,3,0.18)] transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3.5 relative overflow-hidden group">
          <div class="absolute left-0 top-0 bottom-0 w-1.5 bg-primary shadow-[0_0_12px_rgba(177,233,3,0.8)]"></div>
          <div class="flex items-center gap-3.5 min-w-0 pl-1">
            <div class="w-12 h-12 rounded-xl bg-gradient-to-br from-primary to-primary-container text-on-primary font-bold shadow-[0_0_16px_rgba(177,233,3,0.35)] flex flex-col items-center justify-center text-center shrink-0">
              <span class="text-[9px] font-label-sm uppercase font-extrabold leading-none opacity-90">DUPR</span>
              <span class="font-headline-sm text-base font-extrabold leading-tight mt-0.5">4.5+</span>
            </div>
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-2">
                <h4 class="font-headline-sm text-sm sm:text-base text-on-surface font-bold truncate">Competitive King of Court</h4>
                <span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-primary/20 text-primary border border-primary/30 text-[11px] font-label-sm font-bold tracking-wide animate-pulse">
                  <span class="w-1.5 h-1.5 rounded-full bg-primary"></span> 1 Spot Left!
                </span>
              </div>
              <p class="font-body-sm text-xs text-on-surface-variant mt-0.5 flex items-center gap-1.5 flex-wrap">
                <span>Apex Dinking Hub</span>
                <span class="text-outline-variant">•</span>
                <span>Today, 7:00 PM</span>
                <span class="text-outline-variant">•</span>
                <span class="text-primary font-medium">DUPR Ready</span>
              </p>
            </div>
          </div>
          <a class="sm:self-center inline-flex items-center justify-center gap-1.5 px-5 py-2.5 rounded-xl bg-primary hover:bg-[#c2f822] text-on-primary font-label-sm text-xs font-bold tracking-wide shadow-[0_0_18px_rgba(177,233,3,0.35)] hover:shadow-[0_0_24px_rgba(177,233,3,0.55)] transition-all whitespace-nowrap no-underline self-start" href="#/auth?mode=up">
            <span>Claim Slot</span>
            <span class="material-symbols-outlined text-sm">arrow_forward</span>
          </a>
        </div>

        <!-- Match Session 3: Clinic Spots -->
        <div class="p-3.5 sm:p-4 rounded-2xl bg-surface-container/70 hover:bg-surface-container border border-white/[0.06] transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3.5">
          <div class="flex items-center gap-3.5 min-w-0">
            <div class="w-12 h-12 rounded-xl bg-surface-container-highest/80 border border-white/[0.08] text-secondary flex flex-col items-center justify-center text-center shrink-0">
              <span class="text-[9px] font-label-sm text-outline uppercase font-semibold leading-none">DUPR</span>
              <span class="font-headline-sm text-base font-bold leading-tight mt-0.5">2.5</span>
            </div>
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-2">
                <h4 class="font-headline-sm text-sm sm:text-base text-on-surface font-semibold truncate">Mixed Doubles Beginner Clinic</h4>
                <span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-surface-container-highest border border-white/[0.04] text-secondary text-[11px] font-label-sm font-medium">
                  <span class="w-1.5 h-1.5 rounded-full bg-secondary"></span> 6/8 Filled
                </span>
              </div>
              <p class="font-body-sm text-xs text-on-surface-variant mt-0.5 flex items-center gap-1.5 flex-wrap">
                <span>The Pickleshot Club</span>
                <span class="text-outline-variant">•</span>
                <span>Tomorrow, 10:00 AM</span>
                <span class="text-outline-variant">•</span>
                <span>Coach Vance</span>
              </p>
            </div>
          </div>
          <a class="sm:self-center inline-flex items-center justify-center px-4 py-2 rounded-xl bg-surface-container-highest hover:bg-surface-bright border border-white/[0.08] hover:border-white/[0.16] text-on-surface font-label-sm text-xs font-semibold transition-all whitespace-nowrap no-underline self-start" href="#/auth?mode=up">
            <span>Join Clinic</span>
          </a>
        </div>
      </div>

      <!-- Telemetry Bottom Strip -->
      <div class="pt-3.5 mt-1 border-t border-white/[0.06] flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-on-surface-variant font-label-sm text-[11px] relative z-10">
        <div class="flex items-center gap-2">
          <span class="material-symbols-outlined text-sm text-primary">bolt</span>
          <span>Skill-balanced handicap algorithms active</span>
        </div>
        <a href="#/auth?mode=up" class="inline-flex items-center gap-1 text-primary hover:text-secondary-fixed transition-colors no-underline font-semibold">
          <span>View all rotations</span>
          <span class="material-symbols-outlined text-[13px]">arrow_forward</span>
        </a>
      </div>
    </div>
  </div>

<!-- CLUB OWNER / PARTNER PRO BANNER: shares the open-play section -->
  <div class="club-owner-banner max-w-7xl mx-auto p-space-xl rounded-3xl bg-gradient-to-r from-surface-container-high via-surface-container to-surface-container-high shadow-2xl relative overflow-hidden">
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
<div class="relative w-full max-w-7xl mx-auto rounded-[28px] md:rounded-[36px] bg-[#10141a]/95 border border-[#1e2735] shadow-card-depth overflow-hidden backdrop-blur-xl" data-purpose="hero-callout-banner" id="dinkslot-hero-banner">
<!-- Ambient Kinetic Light Accent Behind Content -->
<div aria-hidden="true" class="absolute -top-32 -left-32 w-96 h-96 bg-primary/10 rounded-full blur-3xl pointer-events-none"></div>
<div aria-hidden="true" class="absolute -bottom-24 -right-24 w-80 h-80 bg-primary/5 rounded-full blur-3xl pointer-events-none"></div>
<!-- Inner Border Highlight Line -->
<div aria-hidden="true" class="absolute inset-0 rounded-[28px] md:rounded-[36px] border border-white/[0.04] pointer-events-none"></div>
<div class="relative p-6 sm:p-10 md:p-12 lg:p-14">
<!-- Top Brand Tag & Live Status Row -->
<div class="flex items-center justify-between mb-8 pb-4 border-b border-white/[0.05]">
<div class="flex items-center gap-2.5">
<!-- Mini DS Logo Badge -->
<img src="assets/dinkslot-logo.png" alt="DINKSLOT" width="32" height="32" class="callout-brand-logo" />
<span class="text-xs font-semibold tracking-widest text-slate-400 uppercase">
            Dinkslot <span class="text-slate-600">/</span> Pickleball Network
          </span>
</div>
<div class="flex items-center gap-3">
<span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-semibold tracking-wide bg-primary/10 text-primary border border-primary/20">
<span class="w-1.5 h-1.5 rounded-full bg-primary animate-ping"></span>
            DUPR READY
          </span>
</div>
</div>
<!-- Main Grid Split: Content Left & Visual Action Cards Right -->
<div class="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-center">
<!-- Left Column: Copy & Actions -->
<div class="lg:col-span-6 xl:col-span-7 flex flex-col justify-center">
<!-- Eyebrow Sub-Badge -->
<div class="inline-flex items-center gap-2 mb-4" data-purpose="eyebrow-badge">
<span class="w-2.5 h-2.5 rounded-full bg-primary neon-pulse-dot inline-block"></span>
<span class="text-xs md:text-sm font-headline-md font-bold tracking-widest text-primary uppercase">
              Your Next Match Starts Here
            </span>
</div>
<!-- Bold Kinetic Headline -->
<h1 class="text-4xl sm:text-5xl md:text-6xl font-headline-md font-extrabold text-white tracking-tight leading-[1.08] mb-5">
            Ready to rule <br class="hidden sm:inline"/>
            the <span class="text-primary drop-shadow-[0_0_20px_rgba(163,230,53,0.35)]">court?</span>
</h1>
<!-- Descriptive Subtitle -->
<p class="text-slate-300 text-base sm:text-lg md:text-xl font-normal leading-relaxed max-w-xl mb-8">
            More play. Less planning. Find your club, pick your time, and make the court yours.
          </p>
<!-- Primary & Secondary CTA Buttons -->
<div class="flex flex-wrap items-center gap-3.5 sm:gap-4 mb-8" data-purpose="cta-group">
<!-- Primary Lime Pill CTA -->
<a class="group relative inline-flex items-center justify-center gap-2.5 px-7 py-3.5 rounded-full font-headline-md font-bold text-sm sm:text-base text-on-primary bg-primary hover:bg-[#bbf246] transition-all duration-200 transform hover:-translate-y-0.5 active:translate-y-0 shadow-neon-glow" href="#/auth?mode=up">
<span>Get Started for Free</span>
<svg class="w-4 h-4 transition-transform duration-200 group-hover:translate-x-1" fill="none" stroke="currentColor" stroke-width="2.5" viewbox="0 0 24 24">
<path d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" stroke-linecap="round" stroke-linejoin="round"></path>
</svg>
</a>
<!-- Secondary Player Sign In Button -->
<a class="group inline-flex items-center justify-center gap-2.5 px-6 py-3.5 rounded-2xl font-headline-md font-semibold text-sm sm:text-base text-slate-200 bg-[#161c24] hover:bg-[#1c2430] border border-white/10 hover:border-slate-500/50 transition-all duration-200" href="#/auth?mode=in">
<span>Player Sign In</span>
<svg class="callout-login-icon" aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h5a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-5M4 12h11m-4-4 4 4-4 4"/></svg>
</a>
</div>
<!-- Policy & Disclaimer Footnote -->
<div class="flex items-center gap-2 text-xs text-slate-400 font-medium" data-purpose="terms-footnote">
<svg class="w-3.5 h-3.5 text-slate-400 flex-shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewbox="0 0 24 24">
<path d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" stroke-linecap="round" stroke-linejoin="round"></path>
</svg>
<span>Rates and cancellation policies are set by each club.</span>
</div>
</div>
<!-- Right Column: Media Preview & Bookings Quick-Action Card -->
<div class="lg:col-span-6 xl:col-span-5 flex flex-col gap-4">
<!-- Aerial Court Image Container -->
<div class="relative group rounded-2xl md:rounded-3xl overflow-hidden border border-white/10 bg-[#0e1218] shadow-2xl" data-purpose="court-preview-card">
<!-- Court Drone Image -->
<img alt="Premier outdoor pickleball courts active with players during a tournament" class="w-full h-56 sm:h-64 md:h-72 object-cover object-center transform group-hover:scale-105 transition-transform duration-500 ease-out" loading="lazy" src="assets/pickleball-courts-hd.jpg"/>
<!-- Dark Overlay Vignette for Contrast -->
<div class="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent pointer-events-none"></div>
<!-- Top Left Floating Badge on Image -->
<div class="absolute top-3 left-3 flex items-center gap-2 px-3 py-1 rounded-full bg-black/60 backdrop-blur-md border border-white/15 text-[11px] font-semibold text-white">
<span class="w-2 h-2 rounded-full bg-primary"></span>
<span>Explore Pickleball Courts</span>
</div>
<!-- Bottom Left Location Tag -->
<div class="absolute bottom-3 left-3 right-3 flex items-center justify-between text-xs text-slate-300">
<span class="font-medium flex items-center gap-1.5 backdrop-blur-sm bg-black/40 px-2.5 py-1 rounded-md">
<svg class="w-3.5 h-3.5 text-primary" fill="currentColor" viewbox="0 0 20 20">
<path clip-rule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" fill-rule="evenodd"></path>
</svg>
                Find your next court
              </span>
<span class="text-[11px] text-slate-300 bg-white/10 backdrop-blur-sm px-2 py-1 rounded">
                Outdoor Play
              </span>
</div>
</div>
<!-- Bottom Interactive Quick Card: "View My Bookings" -->
<a class="group flex items-center justify-between p-4 sm:p-5 rounded-2xl bg-[#141a23] hover:bg-[#1a222f] border border-white/10 hover:border-primary/40 transition-all duration-200" data-purpose="quick-bookings-link" href="#/me">
<div class="flex items-center gap-3.5">
<!-- Calendar / Event Icon with Lime Accent -->
<div class="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center flex-shrink-0 text-primary group-hover:scale-105 transition-transform duration-200">
<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewbox="0 0 24 24">
<path d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5m-9-6h.008v.008H12v-.008zM12 15h.008v.008H12V15zm0 2.25h.008v.008H12v-.008zM9.75 15h.008v.008H9.75V15zm0 2.25h.008v.008H9.75v-.008zM7.5 15h.008v.008H7.5V15zm0 2.25h.008v.008H7.5v-.008zm6.75-4.5h.008v.008h-.008v-.008zm0 2.25h.008v.008h-.008V15zm0 2.25h.008v.008h-.008v-.008zm2.25-4.5h.008v.008H16.5v-.008zm0 2.25h.008v.008H16.5V15z" stroke-linecap="round" stroke-linejoin="round"></path>
</svg>
</div>
<!-- Contextual Text -->
<div class="flex flex-col">
<span class="text-xs text-slate-300 font-medium">Already have a game lined up?</span>
<span class="text-sm sm:text-base font-headline-md font-bold text-white group-hover:text-primary transition-colors duration-200">
                  View my bookings
                </span>
</div>
</div>
<!-- Angled Action Arrow -->
<div class="w-8 h-8 rounded-full bg-white/5 group-hover:bg-primary group-hover:text-on-primary flex items-center justify-center text-primary transition-all duration-200">
<svg class="w-4 h-4 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" fill="none" stroke="currentColor" stroke-width="2.5" viewbox="0 0 24 24">
<path d="M4.5 19.5l15-15m0 0H8.25m11.25 0v11.25" stroke-linecap="round" stroke-linejoin="round"></path>
</svg>
</div>
</a>
</div>
</div>
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
