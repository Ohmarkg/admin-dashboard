# Officer Hub Parity Decisions — Port vs Mobile-Only

Resolves issue #10 (epic #1, M4). For every mobile admin ("officer hub")
workflow with no web equivalent, this records the decision: **port** to
admin-dashboard, **defer** (mobile-only for now, revisit on demand), or
**wontfix** (permanently mobile-only). Deferred/wontfix items are listed in
the Tools page's "Mobile-only workflows" note so officers know where to go.

Source: `MOBILE_COMPATIBILITY_AUDIT.md` §3.6–3.7, §5 item 3, §7 item 4
(2026-07-18). Decisions taken 2026-07-18.

| Workflow (mobile screen) | Decision | Rationale |
|---|---|---|
| Committee join approve/deny (`CommitteeConfirm`, `committeeVerification/{committee}/requests`) | **Port** — tracked as a follow-up issue | Same queue-review shape as membership approve/deny, which is already the web's strongest surface. Uses `sendNotificationCommitteeRequest` CF — the X3 callable mechanism (`server/lib/cloudFunctions.ts`) extends to it directly. |
| Resume verification (`ResumeConfirm` → `resumeVerified`, public resume flag) | **Port** — tracked as a follow-up issue | Document-review queue, better on a desktop screen than a phone; web already has the resume zip download, so this completes the resume story. Uses `sendNotificationResumeConfirm` CF — same mechanism. |
| Member of the Month editor (`MOTMEditor`) | **Defer** (mobile-only) | Low frequency (monthly, one write), no review queue, no desktop advantage. Revisit if officers ask. |
| Link editor | **Defer** (mobile-only) | Rarely-touched config writes; porting adds surface without removing a bottleneck. |
| Feedback editor | **Defer** (mobile-only) | Same profile as the link editor. |
| `updateCommitteeCount` / `resetOfficeOnCall` | **Defer** (mobile-only) | Maintenance/repair actions, per audit "likely defer / low priority". |
| Dedicated member search → full profile | **Defer** — partial coverage exists | Membership "All Users" tab + points spreadsheet cover the common lookups; a full profile view is a nice-to-have, not a cutover blocker. |
| QR generate/scan + manual event sign-in/out | **Wontfix** (permanently mobile-only) | Requires camera + geofencing; intrinsically a phone workflow. Attendance corrections on web go through the points editor (which now backfills both sign times, #7). |

## Consequences

- **Cutover scope:** officers can run membership, events, points, Instagram,
  conventions, shirts, and resumes from the web. Committee approvals and
  resume verification join that list when their port issues land; everything
  else stays on the mobile officer hub deliberately.
- **UI messaging:** the Tools page lists the mobile-only workflows so nobody
  hunts the web app for them.
- **Docs:** treat this file as the authority for port/defer status; update it
  when a deferred item is promoted.
