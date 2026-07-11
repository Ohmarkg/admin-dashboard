# TAMU SHPE Admin Portal — Design Brief

A brief for a design tool (Figma Make, Claude design, etc.). It describes **what to design** — screens, layout, components, brand, states — not how it's engineered. Design the **authenticated experience** for officers; skip auth/server internals. Brand direction is grounded in the Texas A&M web brand (`tamu-design-system.html`), adapted for a dense internal tool — see §2.

---

## 1. Product in one paragraph

An internal **admin portal** for the Texas A&M SHPE (Society of Hispanic Professional Engineers) chapter. Officers use it on a laptop to run chapter operations that are too heavy for the member-facing mobile app: reviewing membership proofs, editing attendance points in a spreadsheet, browsing an events calendar and approving attendance, browsing committees, and running batch tools (resume zip, shirt pickup). It is a **data-dense back-office tool**, not a consumer app or public site. Think "Linear/Notion-grade polish applied to a Texas A&M control panel."

**Who uses it:** chapter officers (via one shared account) and developers/admins. All authorized, all internal. No onboarding flows, no marketing pages, no role-based UI variation — everyone who's in, sees everything.

**The redesign goal:** the previous version was hand-built and visually unpolished. This is a from-scratch UI on a modern component system. Prioritize **clarity, density done well, and consistency** over decoration.

---

## 2. Brand & visual identity

Grounded in the official Texas A&M web brand (see `tamu-design-system.html` for the full reference — treat it as **inspiration, not law**: it's a marketing-site system; we're adapting its DNA for a dense internal tool).

### Color — Aggie maroon family + neutral grays

| Token | Value | Use |
|---|---|---|
| **Aggie Maroon** (primary) | `#500000` | The signature. Navbar, primary buttons, headers, active states, verified-member badge, chrome |
| **Brand Dark** | `#3C001C` | Depth — footers, dark floods, grounding, hover-pressed |
| **Brand Light** | `#732F2F` | Warmer maroon for hovers/accents and hierarchy within maroon fields |
| **White** | `#FFFFFF` | The breathing room; pairs with maroon to carry most of the layout |
| **Gray scale** | `#F6F6F6` `#EAEAEA` `#D1D1D1` `#A7A7A7` `#707070` `#626262` `#535353` `#3E3E3E` `#202020` | 100→900. Surfaces, table stripes, borders, muted text. `#202020` = primary ink, `#626262` = muted, `#D1D1D1` = rules |
| **Focus ring** | `#E7B7B7` (light rose) | Accessible focus outline — reads on both white and maroon |

**App-specific functional colors (deliberately outside the TAMU palette — use sparingly and only functionally):**
| Token | Value | Use |
|---|---|---|
| **Officer Gold** | `#FCE300` | Officer-identity badges **only**. Dark text (`#202020`), never white. This is a SHPE convention, not an Aggie brand color — keep it strictly to officer badges so it never reads as a general accent |
| **Deny / destructive** | red `#B91C1C` | Deny/delete actions and error states |
| **Approve / positive** | maroon `#500000` **or** green `#15803D` | Approve actions. Prefer maroon-primary to stay on-brand; use green only if approve/deny need stronger color separation |

**The 75 / 20 / 5 balance (adapted).** The brand leads ~75% maroon+white, ~20% neutral gray, ~5% accent. For a data tool, apply this to **chrome, not content**: maroon+white dominate the navbar, headers, and primary actions; grays carry the dense tables and surfaces; the 5% accent is reserved for officer-gold and status colors. Do **not** flood spreadsheet/table screens in maroon — there, white/gray content dominates and maroon frames it.

### Typography — the four Aggie voices

Load from Google Fonts. Each font has a job; adapt the marketing-heavy uppercase for a back-office tool (uppercase belongs on chrome, never on data).

| Font | Role in this app |
|---|---|
| **Oswald** (condensed, uppercase, 300–700) | Page titles, section headers, navbar wordmark, big stat numbers, button labels. Uppercase + slight letter-spacing. **Not** for body or table data |
| **Work Sans** | Primary body & interface reading voice — form labels' values, descriptions, most UI text |
| **Open Sans** | Utility: table content, data cells, captions, small labels, badges, fine print. Pair with **tabular figures** for the points spreadsheet and all numeric columns |
| **Crimson Text** (italic serif) | Editorial accent only — e.g. the login tagline or a friendly empty-state line. Use rarely; skip entirely inside data screens |

### Signatures to borrow (and what to leave behind)

**Borrow (they translate well to an admin tool):**
- **Maroon top bar** with a 3px darker-maroon (`#3C001C`) bottom border — the navbar.
- **Eyebrow labels:** tiny uppercase Open Sans, wide letter-spacing (~.2em), maroon — perfect as section/kicker labels above cards and table groups.
- **Card top band:** an 8px maroon strip across the top of key cards (dashboard tiles, committee cards).
- **Sharp corners:** the Aggie system uses a tight ~2px radius — crisp and architectural. Prefer small radii (2–4px) over pillowy rounding; it reads more "institutional control panel" than "consumer app." (shadcn defaults are fine; just tighten `--radius`.)
- **Oswald stat numbers:** big maroon Oswald numerals for dashboard metrics.
- **Focus ring** in `#E7B7B7`.
- **Button styles:** maroon fill / ghost-outline / on-dark(white) variants; Oswald uppercase labels for primary buttons.
- **Pills/tags:** maroon-fill / maroon-outline / gray variants.

**Leave for marketing (don't literally reproduce):**
- The oversized **ghost monogram** bleeding off the corner — at most a *very* subtle nod on the login screen; never on working screens.
- Editorial hero blocks, gradient radial heros, long serif ledes — too marketing for a daily-use tool. The login screen may hint at it; everything post-login stays utilitarian.
- Heavy all-caps Oswald on running text or data — chrome only.

### Other

- **Design system:** shadcn/ui + Tailwind. Map the above onto its tokens (`--primary` = maroon, tighten `--radius`, wire the gray scale to `--muted`/`--border`). Vocabulary: Card, Table, Dialog, Tabs, Badge, Button, Input, Select, Checkbox, Toast/Sonner, Calendar, Skeleton.
- **Personality:** proud, clear, service-minded, efficient — "say the thing" microcopy (active voice, concrete labels) in empty states, toasts, and confirmations. Collegiate Aggie identity via maroon + Oswald; neutral and legible everywhere data lives.
- **Theme:** light mode is default and priority. Dark mode optional (Brand Dark `#3C001C` makes a natural dark surface if pursued).
- **Density:** comfortable in navigation/cards; **compact and information-rich in the data tables** (points, membership, shirt tracker) — the workhorse screens.

---

## 3. Layout shell & navigation

**Desktop-first** (officers work on laptops; the spreadsheet and calendar need width). Should degrade gracefully to tablet; mobile is a distant third (members use the mobile app).

- **Persistent top Navbar** in maroon, spanning full width. Left: "TAMU SHPE Admin" wordmark + SHPE logo. Center/left nav links: **Dashboard · Events · Points · Committees · Membership · Tools**. Right: **Sign out**. Active link clearly indicated (underline or lighter maroon pill).
- Below the navbar: a white content area with a page title and the screen's content.
- **Global patterns:**
  - **Loading** → skeleton rows/cards (not just a spinner) for tables and lists; a centered spinner only for full-page auth checks.
  - **Empty** → friendly empty state with an icon, one line of explanation, and (where relevant) a primary action.
  - **Error** → inline error card with a retry affordance.
  - **Mutation feedback** → toast notifications on save/approve/deny success and failure. Data refreshes automatically — **there are no manual "reload" buttons** (a key improvement over the old app).

---

## 4. Screens

Ordered by importance. Screens 3 (Points) and 2 (Events) are the showcases; screen 1 (Dashboard) is a fresh design opportunity.

### 0. Login (`/`)
The one screen allowed a little brand flourish. Centered card on a maroon/Brand-Dark gradient background, optionally with a **very subtle ghost monogram** bleeding off a corner (the only place that motif appears). SHPE + TAMU logo, Oswald uppercase title **"TAMU SHPE Admin Portal"**, one primary maroon button: **"Sign in with TAMU Google"**. A one-line subtitle in Crimson Text italic ("For authorized officers of the Aggie SHPE family") is a fitting spot for the editorial voice. Include the **access-denied** state: after a failed role check, an inline message ("Access denied — your account isn't authorized") with a "Try another account" link. No password fields, no signup.

### 1. Dashboard (`/dashboard`)
The post-login landing. Previously empty — **design real summary widgets.** A responsive grid of cards:
- **Stat tiles (top row):** "Pending membership requests" (count), "Events needing approval" (count), "Total active members" (count), "Points recalculation status." Each tile: **big Oswald maroon numeral**, uppercase Open Sans label, an **eyebrow** kicker, an 8px maroon **top band**, small trend/last-updated line, click-through to the relevant screen.
- **Recent membership requests** card: a short list (3–5) with member name, submitted date, and a "Review" link to Membership.
- **Points leaderboard preview** card: top 5 members by points, with rank, name, points, and an officer-gold marker for officers. "View full spreadsheet →".
- Keep it glanceable — this is a triage launchpad, not an analytics dashboard.

### 2. Events (`/events`) — Calendar & attendance review
- **Calendar** as the centerpiece, with a **Month / Week toggle**. Events render as colored chips (color by committee or event type); show name + time. Clicking a day opens a **Day drill-down modal** listing that day's events.
- **"Pending Approval" section** (side panel or below the calendar): cards for events that have **unverified attendance logs**, each showing event name, date, and count of unverified logs, with a "Review" action.
- **Event modal (create / edit)** — a large dialog form:
  - Fields: name, description, event type (select), start/end date-time, sign-in buffer / sign-out buffer, location name, geofencing (map point + radius), committee association, point rules (**sign-in points, sign-out points, points-per-hour** — which appear depends on event type), workshop subtype (only for Workshop), visibility flags (general/club-wide, hidden).
  - Below the form: an **attendee log table** (member name, points, sign-in/out time, verified status) with **per-row Approve** and a **Bulk Approve** action for selected/all unverified rows.
  - Event types: General Meeting, Committee Meeting, Study Hours, Workshop, Volunteer, Social, Intramural, Custom.

### 3. Points (`/points`) — The spreadsheet (most-used screen)
A high-density, editable data grid for the SHPE school year (**June–May**).
- **Two views via a toggle/tabs: "Total Points"** (cumulative standings) and **"Monthly Points"** (a matrix of members × events for a selected month, plus Instagram-points columns). A **month selector** for the monthly view.
- **Table:** frozen/sticky first column (member name) and sticky header row. Rows = members (sorted by points, descending). **Officer rows highlighted** (maroon-tinted row or officer-gold name badge).
- **Inline cell editing:** double-click/tab into a cell to edit a point value; edited cells show a "dirty" indicator. A **Save** button commits all pending edits at once (toast on success).
- **Toolbar:** "Save changes," **"Update Points"** (recalculates aggregate totals — show a progress/loading state), and **"Export to Excel"** (downloads a multi-sheet workbook: master + per-month).
- This screen must feel like a fast spreadsheet: tabular numerals, tight rows, clear edit affordances, no layout shift on edit.

### 4. Membership (`/membership`) — Verification workflow
- **Three tabs:** **Official Members** · **Requests** · **All Users.**
- **Requests tab** is the action center: a list/grid of **member cards**, each showing name, submitted shirt size, and **two proof documents** (chapter proof + national proof) as viewable/downloadable links, plus expiration dates. Each card has **Approve** (positive) and **Deny** (destructive) buttons. Approving/denying removes the card and fires a toast.
- **Official Members tab:** roster of verified members (valid chapter + national membership), with membership badge.
- **All Users tab:** full roster table with role display.
- **Badges:** officer → **gold `#FCE300`** badge (dark text); verified member → **maroon `#500000`** badge; others → neutral. Roles surfaced: Admin, Developer, Lead, Officer, Representative, SHPE Member, Student, Guest.

### 5. Committees (`/committees`) — Read-only directory
A responsive grid of **committee cards.** Each card uses the committee's **own color** as an accent (header band or border), and shows: committee logo, name, description, **committee head** (name/avatar), **leads**, and **member count**. Read-only — no edit controls. Purely a browsable directory.

### 6. Tools (`/tools`) — Operational utilities
A simple two-panel utility page:
- **Resume Download** panel: a "Generate resume zip" button that kicks off a background job; show **live status** (idle → generating… → ready) and, when ready, a **Download** button with the file's created/expiry time. Handle the "expired link" state.
- **Shirt Tracker** panel: a link/button into the shirt tracker sub-page.

#### 6a. Shirt Tracker (`/tools/shirt-tracker`)
A single table: **member name, email, membership status, shirt size, picked-up (checkbox toggle).** Toggling the checkbox updates pickup status with a toast. Include a search/filter field and a count of picked-up vs remaining.

---

## 5. Component inventory (reusable)

Design these once, reuse across screens:
- **Navbar** (maroon, 3px Brand-Dark bottom border, Oswald wordmark, active-state)
- **Eyebrow label** (tiny uppercase Open Sans, wide letter-spacing, maroon — section/kicker labels)
- **Page header** (Oswald uppercase title + optional action buttons/toolbar)
- **Data table** (sticky header, optional frozen first column, editable cell variant, row highlight variant, sortable headers, zebra striping via gray-100; Open Sans + tabular figures)
- **Stat tile** (8px maroon top band, big Oswald numeral, uppercase label, eyebrow, trend, clickable)
- **Member card** (avatar/name, badges, proof-doc links, approve/deny actions) — compact variant for lists
- **Committee card** (top band in committee color, logo, head/leads, count)
- **Event chip** (in calendar) and **pending-event card**
- **Modal/Dialog** (large form variant for event create/edit; smaller confirm variant)
- **Tabs**, **Badge** (officer-gold / verified-maroon / neutral gray), **Button** (maroon fill / ghost-outline / on-dark; Oswald uppercase on primary), **Pill/tag** (maroon-fill / outline / gray)
- **Toast**, **Skeleton loaders**, **Empty state**, **Error state**
- **Month/Week toggle**, **month selector**, **search/filter input**, **checkbox toggle**
- Sharp ~2px corners and `#E7B7B7` focus ring throughout

---

## 6. Sample data (for realistic mockups)

**Members / points row:**
`Maria Gonzalez — Mechanical Engineering — 47 pts — rank 3 — Officer (gold badge)`
`James Le — Computer Science — 39 pts — rank 5 — Verified member (maroon badge)`

**Membership request card:**
`Ana Ruiz · submitted 3 days ago · shirt: M · [Chapter proof ▸] [National proof ▸] · Chapter exp: May 2026 · National exp: Aug 2026 · [Approve] [Deny]`

**Event chip:** `General Meeting · 6:00–7:00 PM · Zachry 102 · +1 pt` (color: General/maroon)
**Pending event card:** `Volunteer Event — Feb 12 — 8 logs awaiting approval — [Review]`

**Committee card:** `Technical Affairs · Head: Priya Nair · 3 leads · 24 members` (accent: committee color)

**Dashboard stat tiles:** `Pending Requests: 6` · `Events Needing Approval: 4` · `Active Members: 212` · `Points: recalculated 2h ago`

**Shirt tracker row:** `James Le · jle@tamu.edu · Verified · L · ☐ Picked up`

---

## 7. Priorities & guardrails

1. **Points spreadsheet** and **Events calendar** are the two hero screens — invest the most polish there.
2. **Dashboard** is greenfield — make it a genuinely useful triage view.
3. Keep the officer-gold `#FCE300` reserved strictly for officer identity; don't let it become a general accent.
4. Tables must stay legible at high row counts — this app lives in dense data.
5. Every list/table needs designed **loading, empty, and error** states, plus **success/error toasts** for actions.
6. No manual reload buttons, no role-switching UI, no public/marketing surfaces.

Reference the feature detail in `PURPOSE_AND_FUNCTIONALITY.md` and data shapes in `DATA_MODEL.md` if you need to go deeper on any screen.
