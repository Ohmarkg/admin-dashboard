# Admin Dashboard ↔ MobileApp Compatibility Audit

**Date:** 2026-07-18  
**Sources:** Understand Anything knowledge graphs + domain graphs for both repos  
**Graphs:**

| Project | Knowledge graph | Domain graph | Analyzed at |
|---------|-----------------|--------------|-------------|
| `admin-dashboard` | `.ua/knowledge-graph.json` (316 nodes) | `.ua/domain-graph.json` (6 domains / 17 flows) | 2026-07-18 |
| `MobileApp` (`shpe-app`) | `.ua/knowledge-graph.json` (531 nodes) | `.ua/domain-graph.json` (6 domains / 17 flows) | 2026-07-18 |

**Verdict:** Shared Firestore contracts for the core overlapping features (membership approve/deny, shirt pickup, Instagram awards, event/log dual-writes, points edits) are largely **compatible**. Production cutover is **not complete**: Cloud Function wiring (BUILD_PLAN **X3**) and several mobile-only officer workflows are still missing from the web portal. Officers who use only `admin-dashboard` cannot fully replace the in-app admin hub yet.

---

## 1. Scope and method

This audit compares:

1. **admin-dashboard** — Next.js officer portal with Hono write API + client Firestore reads (rebuild).
2. **MobileApp** — React Native/Expo member app plus in-app officer tools (`src/screens/admin/*`) and Cloud Functions (`functions/`).

Note: MobileApp also embeds an older `shpe-app-web/` tree. This audit treats the standalone `admin-dashboard/` as the web surface under review, and MobileApp’s **mobile admin screens + member-facing behaviors + Cloud Functions** as the behavior baseline.

Domain flows used as the feature checklist:

| Domain (admin-dashboard) | Domain (MobileApp) |
|--------------------------|--------------------|
| Officer Access & Portal Shell | Officer Admin Operations |
| Event Management | Events and Attendance |
| Points Administration | Points and Recognition |
| Membership Administration | Membership and Benefits |
| Committee Oversight | Committees |
| Operational Tools | Resumes and Career Resources (+ admin content tools) |

---

## 2. Feature coverage matrix

| Mobile capability | admin-dashboard | Status | Compatibility notes |
|-------------------|-----------------|--------|---------------------|
| MemberSHPE approve/deny | `/membership` + `POST /api/membership/:uid/{approve\|deny}` | **Present** | Same Firestore fields; prod push notification unwired (X3) |
| National expiration date override before approve | — | **Missing** | Mobile-only; wrong auto-dates cannot be fixed on web |
| Shirt pickup toggle | `/tools/shirt-tracker` | **Present** | Same `shirt-sizes/{uid}.shirtPickedUp` |
| Instagram points award | `/tools/instagram-points` | **Present** | Compatible dual-write; bypasses `addInstagramPoints` CF |
| Points spreadsheet edit + export | `/points` | **Present** (web-only strength) | Edits write logs; aggregates need recalculate |
| Recalculate aggregates (`updateAllUserPoints`) | `POST /api/points/recalculate` | **Partial** | Emulator stub / **throws in production** (X3) |
| Event create/update + attendance approve | `/events` + `/api/events` | **Partial** | Missing cover image, `nationalConventionEligible`, QR, manual sign-in |
| Resume zip download (`zipResume`) | `/tools` | **Present** | Client `httpsCallable` (intentional exception) |
| Convention tracker | `/tools/convention-tracker` | **Present** (web-only) | No mobile equivalent; eligibility ignores `nationalConventionEligible` |
| Committee join request approve | — | **Missing** | Committees page is read-only directory |
| Resume verification (`ResumeConfirm`) | — | **Missing** | Bank still depends on mobile officers |
| Member of the Month (`MOTMEditor`) | — | **Missing** | |
| Link editor | — | **Missing** | App deep links / external URLs |
| Feedback editor | — | **Missing** | |
| Member search (dedicated) | Membership “All Users” | **Partial** | Roster, not admin search→profile tool |
| `updateCommitteeCount` | — | **Missing** | |
| `resetOfficeOnCall` | — | **Missing** | |
| QR generate / scan | — | **Missing** | Intentionally mobile (camera/geofence) |
| Manual event sign-in/out for members | — | **Missing** | Mobile `EventInfo` only |
| `committeeCountCheckOnCall` | — | N/A | Referenced on mobile AdminDashboard but not exported in `functions/` (likely dead) |

---

## 3. Domain-by-domain findings

### 3.1 Membership

**Compatible**

- Approve copies `chapterExpiration` / `nationalExpiration` from `memberSHPE/{uid}` → `users/{uid}`, then deletes the request.
- Deny clears both expiration fields and deletes the request.
- Pending filter requires both `chapterURL` and `nationalURL`.
- Member app verification (`isMemberVerified`) keys off those user fields + “not expired.”

**Gaps / risks**

| Issue | Severity | Impact on MobileApp |
|-------|----------|---------------------|
| `sendNotificationMemberSHPE` not wired in production (`server/lib/cloudFunctions.ts`) | **High** | Approve/deny succeeds in Firestore but members get **no push**; status may feel “stuck” until refresh |
| No national-expiration adjust UI/API before approve | **Medium** | Officers cannot correct bad auto-June dates; wrong expiry → wrong verified badge / gated resources |
| Web approve uses atomic batch (better than mobile sequential writes) | Positive | Less risk of orphaned request docs |

### 3.2 Shirt tracking

**Compatible**

- Both toggle `shirt-sizes/{uid}.shirtPickedUp`.
- Lists derive from the `shirt-sizes` collection; no member notification expected.

**Gaps:** Low risk only (orphan shirt docs without a matching user show as N/A on web).

### 3.3 Instagram points

**Compatible (core writes)**

- Shared event name: `"Instagram Points"`.
- Create field set matches (hidden custom event, `signInPoints: 1`, etc.).
- Dual write: `events/{id}/logs/{uid}` ↔ `users/{uid}/event-logs/{eventId}`.
- Log shape: `uid`, `eventId`, `creationTime`, `verified`, `points`, `instagramLogs[]` (full-doc merge + append).
- Neither path updates aggregate `users.points` directly.

**Gaps / risks**

| Issue | Severity | Notes |
|-------|----------|-------|
| Admin bypasses `addInstagramPoints` CF | Medium | Future CF-only side effects won’t run for web awards |
| Web allows `lead` claim; mobile CF does not | Low | Role surface differs |
| Web skips unknown UIDs; mobile CF does not | Low | Safer on web |
| Duplicate `"Instagram Points"` events possible | Medium | `limit(1)` can split awards across docs |
| Web toast hardcodes “1 point” | Low | UX only if `signInPoints` changes |
| Web `MAX_VISIBLE = 50` | Medium | Easy to under-award large searches |

### 3.4 Events & attendance

**Compatible**

- Shared `EventType` string vocabulary and dual-write log paths.
- Attendance approve dual-writes verified logs.

**Gaps / risks**

| Issue | Severity | Impact |
|-------|----------|--------|
| Event create/edit omits `coverImageURI` and `nationalConventionEligible` | **High** | Web-created events look/behave differently on mobile (no cover; convention flag absent) |
| No QR / geofence check-in on web | Expected | Members still use mobile for attendance |
| No officer manual sign-in/out on web | Medium | Proxy attendance remains mobile-only |
| Mobile sign-in already sets `verified: true` | Info | Pending-approval UI is mostly for edge/legacy logs |

### 3.5 Points & leaderboards

**Compatible**

- Points editor writes event-log points with `edited` / `verified` semantics aligned with DATA_MODEL.
- Member leaderboard (`PointsLeaderboard`) reads aggregate `users.points` / `pointsThisMonth`.

**Gaps / risks**

| Issue | Severity | Impact |
|-------|----------|--------|
| `updateAllUserPoints` throws outside emulator | **Critical** | Spreadsheet + Instagram awards leave **mobile leaderboard/ranks stale** until scheduled CF or mobile “Update All User Points” runs |
| Points edits can backfill `signInTime` without `signOutTime` | Medium | Convention tracker requires **both** times → eligibility vs spreadsheet totals can diverge |

### 3.6 Committees

**Compatible (read path):** Web committees directory displays the same committee docs members see.

**Missing:** Approve/deny of `committeeVerification/{id}/requests` (mobile `CommitteeConfirm`). Committee join workflow still requires the mobile officer hub. `updateCommitteeCount` / office reset callables have no web path.

### 3.7 Resumes & content tools

| Tool | Status |
|------|--------|
| Resume zip download | Present (client callable) |
| Resume verification | **Missing** — mobile `ResumeConfirm` still required for `resumeVerified` / bank quality |
| MOTM, Link editor, Feedback editor | **Missing** |

### 3.8 Convention tracker (web-only)

New capability with no mobile admin twin. Eligibility is derived from event-logs by type (Volunteer / Workshop / General Meeting, counts ≥ 2 each) and **ignores** `nationalConventionEligible` (documented v1 decision). Compatible with mobile data as long as officers understand the type-based rule and the sign-in+sign-out requirement.

---

## 4. Shared data contracts (summary)

| Collection / path | Used by both | Contract status |
|-------------------|--------------|-----------------|
| `users/{uid}` | Yes | Compatible; aggregates owned by CF |
| `users/{uid}/event-logs/{eventId}` | Yes | Compatible dual-write |
| `events/{id}` / `events/{id}/logs/{uid}` | Yes | Compatible; web create field subset incomplete |
| `memberSHPE/{uid}` | Yes | Compatible |
| `shirt-sizes/{uid}` | Yes | Compatible |
| `convention-tracking/{uid}` | Admin web | No mobile admin equivalent |
| `committeeVerification/...` | Mobile admin | Not managed on web |
| `resumeVerification/{uid}` / `resumeVerified` | Mobile admin | Zip download only on web |

Architecture note from domain/tour graphs: admin-dashboard deliberately routes **writes** through Hono + Admin SDK and **reads** through the browser Firebase client — matching REBUILD_CONCEPT. Mobile admin still mixes client Firestore writes and `httpsCallable` Cloud Functions.

---

## 5. Highest-priority incompatibilities

1. **X3 Cloud Function wiring** — `updateAllUserPoints` and `sendNotificationMemberSHPE` throw in production. Breaks leaderboard freshness and membership push UX when officers work only in the web portal.
2. **Incomplete event write surface** — Missing `coverImageURI` and `nationalConventionEligible` causes web-created events to diverge from mobile member experience.
3. **Missing verification / content workflows** — Committee confirm, resume confirm, MOTM, links, feedback remain mobile-only; web cannot replace the officer hub for those chapter ops.
4. **Convention tracker vs points editor** — Sign-out requirement and type-based eligibility can disagree with spreadsheet-only attendance artifacts.
5. **Instagram award edge cases** — Duplicate named events and 50-row visibility can silently under-award.

---

## 6. What is already solid

- Auth gate for officers/admins (plus `lead` on web) with shared Firebase project assumptions.
- Membership approve/deny and shirt pickup field-level parity with member UX.
- Instagram award log dual-write parity with the mobile Cloud Function shape.
- Points editing + Excel export (web strength over mobile).
- Resume zip via client callable (documented intentional exception).
- Atomic membership batches on web improve on mobile’s sequential writes.
- Documented DATA_MODEL / API contracts largely match what mobile already stores.

---

## 7. Recommended follow-ups (ordered)

1. Complete **BUILD_PLAN X3**: wire `updateAllUserPoints` and `sendNotificationMemberSHPE` for production.
2. Add **national expiration override** on membership approve (parity with `MemberSHPEConfirm`).
3. Extend event create/edit with **`coverImageURI`** and **`nationalConventionEligible`**.
4. Port or explicitly defer: **CommitteeConfirm**, **ResumeConfirm**, **MOTM**, **LinkEditor**, **FeedbackEditor** (document “mobile-only” if deferred).
5. Harden Instagram: unique constraint / idempotent get-or-create; raise or paginate beyond `MAX_VISIBLE = 50`.
6. Align convention eligibility messaging with mobile event flag (or document that the flag is display-only forever).

---

## 8. Graph artifacts

Regenerate or explore visually with Understand Anything:

```text
MobileApp/.ua/knowledge-graph.json
MobileApp/.ua/domain-graph.json
admin-dashboard/.ua/knowledge-graph.json
admin-dashboard/.ua/domain-graph.json
```

Dashboard: `/understand-dashboard` from either project root.
