# UAT Test Case Specification — NibTera Edir Management Platform

**Document type:** User Acceptance Testing (UAT) Test Case Specification & Execution Workbook
**Application:** Multi‑tenant Edir (community association) management platform (Next.js 15 / Prisma / PostgreSQL)
**Status:** Baseline for UAT execution

---

## 1. Document Control

| Field | Value |
|---|---|
| Version | 1.0 |
| Author | UAT Team |
| Reviewers | Product Owner, Edir Admin SME, QA Lead |
| Approval | Product Owner sign‑off (Section 14) |
| Linked artifacts | Requirements spec, Permission catalog (`src/lib/permissions.ts`), Approval engine (`src/lib/approval-engine.ts`) |

**Revision history**

| Ver | Date | Author | Change |
|---|---|---|---|
| 1.0 | (set on execution) | UAT Team | Initial baseline |

---

## 2. Introduction & Scope

This specification provides end‑to‑end UAT coverage for every page, feature, workflow, business rule, calculation, role, and integration in the platform. It is organized **module‑by‑module**, and within each module by **scenario type**: Positive (P), Negative (N), Boundary (B), Security (S), Workflow/Maker‑Checker (W), Permission/RBAC (R), Regression (Rg), and End‑to‑End (E2E).

**In scope**
- Authentication & session (phone/email login, invite/set‑password, lockout, first‑login change)
- Role‑Based Access Control (route guard, nav filtering, control gating) and multi‑tenant scope isolation
- Dashboards (Member dashboard, Super‑Admin Platform dashboard, Committee Oversight)
- People (unified Members + User Accounts + Associations), Member 360° profile
- Payments (manual maker‑checker, settlement order, penalty waiver, void), NIB digital payments
- Approvals Center (all 7 maker‑checker modules)
- Emergencies (types, claim → approve → disburse, reserve), Events (attendance → absence penalty), Assets (issuance, return compensation)
- Rules & Bylaws (config, penalty tiers, change log, print/PDF), Member Requests, Documents repository
- Audit Log, Payment Log, Notifications, Reporting/Exports (CSV + print‑to‑PDF)
- Admin: Users, Roles (scoped permission catalog), Edir Settings; System: Edirs, Associations
- My Account self‑service portal
- Cross‑cutting: search, filter, sort, pagination, error handling, security headers/CSP, mobile responsiveness, language switching (public pay flow)

**Out of scope / known characteristics (verify, do not fail on absence)**
- Dashboard UI is **not** internationalized; language switching (English/Amharic) exists only on the **public `/pay`** flow.
- "PDF export" is implemented as **browser print‑to‑PDF** for Rules/Bylaws (`window.print()`); structured data exports are **CSV**; NIB payments may carry a `receiptUrl`. There is no server‑side PDF generator.

---

## 3. Roles Under Test

> Roles are **Edir‑scoped** (`scope = EDIR`) except Super Admin (`scope = SUPER_ADMIN`, `edirId = null`). "Approver/Checker" and "Cashier" are **configurable roles** created during test setup (Section 5). Administrative permissions affect only what a user may **manage**; every Edir‑scoped user is **also a member** for obligations/benefits.

| Role | Scope | Key permissions (catalog ids) | Notes |
|---|---|---|---|
| **Super Admin** | SUPER_ADMIN | `super_admin` (implicit all, cross‑tenant) + `manage_edirs` | No Edir of their own; must select an Edir for tenant‑bound operations |
| **Edir Admin** | EDIR | Full Edir catalog (all `view_*`/`manage_*`/`approve_*`/`record_*`/`finalize_*`/`waive_*`/`void_*`/`reset_password`/`lock_user`/`unlock_user`/`manage_edir_settings`/`manage_committee`/`manage_roles`/`manage_users`) — **never** `super_admin`/`manage_edirs` | Default tenant administrator |
| **Committee Member (Oversight)** | EDIR | `view_dashboard`, `view_committee_oversight`, `view_members`, `view_payments`, `view_audit_log`, `view_payment_log`, `view_approvals`, `view_documents` | Read‑only governance view |
| **Approver / Checker** | EDIR | `view_approvals` + one or more `approve_*` (e.g. `approve_payment`, `approve_emergency_claim`, `approve_emergency_disbursement`, `approve_asset_issuance`, `approve_member_removal`, `approve_rule_change`, `approve_penalty_waiver`) | Cannot approve own submissions (maker ≠ checker) |
| **Cashier** | EDIR | `view_payments`, `record_payment`, `view_members` | Payment maker; cannot approve |
| **Member** | EDIR | `view_dashboard` (+ self‑service My Account/portal, always available) | Obligations follow bylaws regardless of role |
| **Unassigned User** | none | none (`edirId = null`, no role) | For association tests |

---

## 4. Permission → Page Access Matrix (expected route access)

`✓` = can enter; `—` = redirected to `/forbidden` (rewrite); `(self)` = own records only.

| Page (route) | Super Admin | Edir Admin | Committee | Approver | Cashier | Member |
|---|:--:|:--:|:--:|:--:|:--:|:--:|
| `/dashboard` | ✓ (Platform) | ✓ | ✓ | ✓ | ✓ | ✓ |
| `/dashboard/people` | ✓ (all Edirs) | ✓ | — | — | ✓ (members) | — |
| `/dashboard/members/[id]` | ✓ | ✓ | ✓ (view) | — | ✓ (view) | — |
| `/dashboard/payments` | ✓ | ✓ | ✓ (view) | ✓ (view) | ✓ | — |
| `/dashboard/approvals` | ✓ | ✓ | ✓ (view) | ✓ | — | — |
| `/dashboard/emergencies` | ✓ | ✓ | — | ✓* | — | — |
| `/dashboard/events` | ✓ | ✓ | — | — | — | — |
| `/dashboard/assets` | ✓ | ✓ | — | ✓* | — | — |
| `/dashboard/rules` | ✓ | ✓ | — | ✓* | — | — |
| `/dashboard/oversight` | ✓ | ✓ | ✓ | — | — | — |
| `/dashboard/requests` | ✓ | ✓ | — | — | — | — |
| `/dashboard/documents` | ✓ | ✓ | ✓ | — | — | — |
| `/dashboard/audit` | ✓ | ✓ | ✓ | — | — | — |
| `/dashboard/payment-log` | ✓ | ✓ | ✓ | — | — | — |
| `/dashboard/admin/users` | ✓ | ✓ | — | — | — | — |
| `/dashboard/admin/roles` | ✓ | ✓ | — | — | — | — |
| `/dashboard/admin/settings` | ✓ | ✓ | — | — | — | — |
| `/dashboard/system/edirs` | ✓ | — | — | — | — | — |
| `/dashboard/system/associations` | ✓ | — | — | — | — | — |
| `/dashboard/account` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

\* Approver enters the page only if their role also holds the page `view_*` access permission; otherwise the page access permission is the gate. UAT must verify with the exact configured permission set.

---

## 5. Test Environment, Data Setup & Conventions

**Environment**
- Build verified (`npm run build` "Compiled successfully"). App on configured host (`NEXT_PUBLIC_APP_URL` / `NEXTAUTH_URL`). DB seeded (`prisma db seed`).
- Public pay routes (`/pay`, `/portal`, `/api/nib-callback`) are framable; all dashboard routes are `DENY`/`frame-ancestors 'none'`.

**Seed/setup data (create before execution)**
1. **Edir A** ("Demo Edir") and **Edir B** ("Bole Community Edir") with `EdirSettings` (monthlyFee, registrationFee, currency, dueDay, gracePeriodDays, penaltyTiers, autoSuspendMonths, autoTerminateMonths, minMembershipMonths, reinstatementFee, emergencyReserve).
2. **Roles per Edir**: Edir Admin, Member, Committee (Oversight). Create **Approver** (view_approvals + approve_payment + approve_emergency_claim + approve_emergency_disbursement + approve_asset_issuance + approve_member_removal + approve_rule_change + approve_penalty_waiver) and **Cashier** (view_payments + record_payment + view_members).
3. **Users**: Super Admin (no Edir); in Edir A — Admin “Abel (Maker)”, Admin “Bru (Checker)”, Committee “Hana”, Approver “Checker‑1”, Cashier “Cash‑1”, Member “Mem‑1”; one **Unassigned** user.
4. **Members**: ≥5 in Edir A with varied `paymentStatus.balance` (0, partial, multi‑month arrears), installment plans, relatives/beneficiaries, documents (PENDING/APPROVED), and ≥2 in Edir B (for isolation tests).
5. **Emergency types**, **events** (one attendance‑required with penalty), **asset categories + assets** (with quantity), and at least one **rule change** history entry.

**Test Case ID convention:** `UAT-<MODULE>-<NNN>` (e.g., `UAT-PAY-007`).
**Priority:** P1 (critical path) · P2 (important) · P3 (minor). **Severity:** S1 (blocker) · S2 (major) · S3 (minor) · S4 (cosmetic).
**Type:** P positive · N negative · B boundary · S security · W workflow · R permission · Rg regression · E2E.
**Each table row's** `Actual` and `Status` columns are left blank for execution (Status ∈ Pass/Fail/Blocked/NA).

---

## 6. Authentication & Session (AUTH)

| ID | Type | Pri/Sev | Role | Preconditions | Test Steps | Test Data | Expected Result | Actual | Status |
|---|---|---|---|---|---|---|---|---|---|
| UAT-AUTH-001 | P | P1/S1 | Any | Active user with phone | 1. Go to /login 2. Enter phone + password 3. Submit | phone `251911111111` | Authenticated; redirected to first accessible page per role | | |
| UAT-AUTH-002 | P | P1/S1 | Any | Active user with email | Log in using email + password | `abel@edir.local` | Login succeeds (phone‑OR‑email accepted) | | |
| UAT-AUTH-003 | N | P1/S2 | Any | — | Login with wrong password ×1 | invalid pwd | Generic "invalid credentials"; no account enumeration; failed‑attempt counter increments | | |
| UAT-AUTH-004 | B/S | P1/S1 | Any | Lockout threshold configured | Enter wrong password until threshold reached | N attempts | Account locked; `lockoutUntil` set; subsequent correct password is rejected with lockout message + remaining minutes | | |
| UAT-AUTH-005 | P | P1/S2 | Invited | User invited (status INVITED), valid 48h token | Open set‑password email link; set a policy‑compliant password | token | Password set; user ACTIVE; `mustChangePassword` cleared; `tokenVersion` bumped; can log in | | |
| UAT-AUTH-006 | N | P2/S2 | Invited | Token expired (>48h) or reused | Open set‑password link | expired token | Rejected; instructs to request a new link | | |
| UAT-AUTH-007 | W | P1/S1 | Member created via Add Member | New member login with temp password | Log in with phone + temp password | temp pwd | Forced to `/force-password-change`; cannot reach any `/dashboard/*` until password changed | | |
| UAT-AUTH-008 | S | P1/S1 | Any | Authenticated session | Admin resets the user's password / deactivates / changes status | — | `tokenVersion` increment invalidates existing sessions; user is logged out on next request | | |
| UAT-AUTH-009 | P | P2/S3 | Any | — | Use Forgot Password; submit email | registered email | Reset email sent (same response whether or not email exists — no enumeration) | | |
| UAT-AUTH-010 | S | P1/S1 | Any | Logged in | Click user menu → Sign out | — | Session cleared; redirect to `${NEXT_PUBLIC_APP_URL}/login` (not hard‑coded localhost); back button does not restore session | | |
| UAT-AUTH-011 | S | P2/S2 | Any | Logged in, idle | Leave session idle past timeout | — | Idle timeout logs out across tabs; redirect to login with SessionExpired notice | | |
| UAT-AUTH-012 | S | P1/S1 | Unauthenticated | — | Directly request a protected `/dashboard/*` URL | — | Redirected to `/login` (callback URL preserved) | | |

---

## 7. RBAC, Navigation & Multi‑Tenant Scope (RBAC)

| ID | Type | Pri/Sev | Role | Preconditions | Test Steps | Test Data | Expected Result | Actual | Status |
|---|---|---|---|---|---|---|---|---|---|
| UAT-RBAC-001 | R | P1/S1 | Member | Logged in as Member | Inspect sidebar/nav | — | Only permitted pages render (Dashboard, My Account); no Operations/Admin/System links | | |
| UAT-RBAC-002 | R | P1/S1 | Committee | Logged in | Navigate each oversight/read page | — | Read‑only pages accessible; management controls absent/disabled | | |
| UAT-RBAC-003 | S/R | P1/S1 | Member | Logged in | Manually enter `/dashboard/admin/users` in URL | — | Rewritten to `/forbidden` (page content not exposed) | | |
| UAT-RBAC-004 | S/R | P1/S1 | Edir Admin | Logged in | Enter `/dashboard/system/edirs` | — | Forbidden (platform‑only route) | | |
| UAT-RBAC-005 | S | P1/S1 | Edir Admin (Edir A) | Member exists in Edir B | Open `/dashboard/members/<EdirB id>` | Edir B member id | Access denied / not found — cross‑tenant record blocked (`assertSameTenant`) | | |
| UAT-RBAC-006 | S | P1/S1 | Edir Admin (Edir A) | — | Attempt a server action with a forged `edirId` for Edir B | tampered payload | Server forces actor's own Edir; operation rejected or scoped to Edir A only | | |
| UAT-RBAC-007 | R | P1/S2 | Super Admin | Logged in | Open People; use Edir filter | — | Can view/act across all Edirs; tenant filter switches dataset | | |
| UAT-RBAC-008 | R | P2/S2 | Approver | Role has only `view_approvals` + approve_* | Visit pages | — | Approvals Center accessible; non‑granted pages forbidden | | |
| UAT-RBAC-009 | Rg | P2/S2 | New role w/ permission added | Edir Admin updates a role's permissions | Add a permission, re‑login affected user | — | New permission takes effect after session refresh; nav/route updates | | |
| UAT-RBAC-010 | R | P1/S1 | Member (admin role holder) | A Committee/Admin user | Open My Account | — | Full membership profile visible regardless of admin role; obligations computed from bylaws | | |

---

## 8. Dashboards (DASH)

| ID | Type | Pri/Sev | Role | Preconditions | Test Steps | Test Data | Expected Result | Actual | Status |
|---|---|---|---|---|---|---|---|---|---|
| UAT-DASH-001 | P | P1/S2 | Edir Admin | Seeded data | Open `/dashboard` | — | Member KPIs render (Total/Active Members, balances, disbursed); cards link correctly (Members → `/dashboard/people`) | | |
| UAT-DASH-002 | P | P1/S2 | Super Admin | Multiple Edirs | Open `/dashboard` | — | Platform dashboard renders cross‑tenant KPIs; no "An Edir must be selected" error | | |
| UAT-DASH-003 | P | P2/S2 | Committee | — | Open Oversight `/dashboard/oversight` | — | Read‑only KPIs, trends, charts; "Total Members" KPI links to `/dashboard/people` | | |
| UAT-DASH-004 | N | P2/S3 | Any | Simulate data‑load failure | Force action error | — | Error state with Retry; no infinite spinner | | |
| UAT-DASH-005 | B | P3/S3 | Edir Admin | Empty Edir (no members) | Open dashboard | — | Zero‑values render gracefully (no NaN/undefined) | | |
| UAT-DASH-006 | Rg | P2/S3 | Super Admin | — | Render charts (recharts) | — | Charts display; numbers match underlying data | | |

---

## 9. People — Members / User Accounts / Associations (PPL)

> Unified directory; each row is a *person* (login account ⊕ membership). Operations gated by capability flags; server re‑checks permissions.

| ID | Type | Pri/Sev | Role | Preconditions | Test Steps | Test Data | Expected Result | Actual | Status |
|---|---|---|---|---|---|---|---|---|---|
| UAT-PPL-001 | P | P1/S2 | Edir Admin | Members exist | Open People; review directory | — | Persons listed with member code, contact, role, status badges, balance; stat cards correct | | |
| UAT-PPL-002 | P | P2/S3 | Edir Admin | >1 page of rows | Search by name/ID/phone/email; apply type & status filters; sort columns | — | Client‑side search/filter/sort work; counts update ("N of M people") | | |
| UAT-PPL-003 | P | P1/S1 | Edir Admin | — | Add Member → fill sections → Review → Confirm & Create | valid member | Member created with auto `EDR‑YYYY‑NNNN`; login auto‑provisioned; **credentials dialog shows temp password**; `PaymentStatus.balance = registrationFee` | | |
| UAT-PPL-004 | N | P1/S2 | Edir Admin | — | Add Member with name <2 chars / invalid Ethiopian phone | bad data | Validation blocks; no record created | | |
| UAT-PPL-005 | S | P1/S1 | Edir Admin | — | Add Member: press Enter mid‑form | — | Enter never submits/creates; creation only via explicit Confirm | | |
| UAT-PPL-006 | P | P1/S1 | Super Admin | ≥1 Edir with roles | Add Member as Super Admin: select **Edir**, then **Role**, Confirm | — | Member created in chosen Edir; **no "An Edir must be selected" error**; Edir shown in confirm summary | | |
| UAT-PPL-007 | N | P1/S2 | Super Admin | — | Add Member without selecting Edir | — | Friendly error "Select an Edir for the new member"; role dropdown disabled until Edir chosen | | |
| UAT-PPL-008 | S | P1/S1 | Super Admin | — | Inspect Add Member / inline role dropdown options | — | **"Super Admin" / platform roles are NOT offered**; only Edir‑scoped roles for the target Edir | | |
| UAT-PPL-009 | S | P1/S1 | Edir Admin | — | Attempt to set a SUPER_ADMIN‑scope role via crafted request | tampered roleId | Rejected ("Super‑Admin role cannot be assigned here") | | |
| UAT-PPL-010 | P | P2/S2 | Edir Admin | Person with login | Inline change of account role | — | Role updated; audit `USER_ROLE_CHANGED`; permissions reflect after refresh | | |
| UAT-PPL-011 | P | P2/S2 | Edir Admin | Active user | Row menu → Deactivate / Activate | — | Status toggles; sessions invalidated on deactivate (`tokenVersion`) | | |
| UAT-PPL-012 | P | P2/S2 | Edir Admin (lock perms) | — | Lock then Unlock a user | — | Lock sets long `lockoutUntil`; Unlock clears it and resets failed attempts; audited | | |
| UAT-PPL-013 | P | P1/S2 | Edir Admin (reset perms) | User has email | Reset password from row/detail | — | Reset email sent; `USER_PASSWORD_RESET` audit; sessions invalidated | | |
| UAT-PPL-014 | W | P1/S2 | Edir Admin (maker) | Member exists | Request member removal | reason | `MEMBER_REMOVAL` approval request created; member NOT removed yet; appears in Approvals → Pending | | |
| UAT-PPL-015 | P | P1/S2 | Super Admin | Unassigned user | Associate user → select Edir + role + activate | — | User associated to Edir; **auto‑enrolled as member**; audit `USER_ASSOCIATED` | | |
| UAT-PPL-016 | P | P2/S2 | Super Admin | User in Edir A | Reassign/Transfer to Edir B | — | `edirId` updated; sessions invalidated; audit `USER_TRANSFERRED` | | |
| UAT-PPL-017 | P | P2/S2 | Super Admin | User in an Edir | Remove from Edir | — | Unassigned + deactivated; audit `USER_REMOVED_FROM_EDIR` | | |
| UAT-PPL-018 | S | P1/S1 | Super Admin | — | Attempt to reassign/remove a SUPER_ADMIN user | — | Blocked ("Platform administrators cannot be...") | | |
| UAT-PPL-019 | P | P3/S3 | Edir Admin | — | Export directory CSV | — | CSV downloads with member/account columns; respects current Edir scope | | |
| UAT-PPL-020 | N | P2/S2 | Edir Admin | Member already linked to a login | Add Member with same phone/email | duplicate | Find‑or‑link prevents duplicate; no second Member on same `userId` (unique) — clear error | | |
| UAT-PPL-021 | P | P2/S3 | Super Admin | — | Open Activity (association audit) | — | Recent association changes listed with actor + timestamp | | |
| UAT-PPL-022 | R | P1/S1 | Cashier | Role = view_members only | Open People | — | Directory viewable; Add Member/role/lock controls hidden (no manage_users/manage_members) | | |

---

## 10. Member 360° Profile (MPRO)

| ID | Type | Pri/Sev | Role | Preconditions | Test Steps | Test Data | Expected Result | Actual | Status |
|---|---|---|---|---|---|---|---|---|---|
| UAT-MPRO-001 | P | P1/S2 | Edir Admin | Member exists | Open profile from People | — | Identity, payment status, penalties, installments, relatives, documents, emergencies, audit, governing rules, compliance flags all render | | |
| UAT-MPRO-002 | P | P2/S3 | Edir Admin | — | Click "Back to people" | — | Returns to `/dashboard/people` (not the removed members list) | | |
| UAT-MPRO-003 | P | P2/S2 | Edir Admin | — | Edit member details; save | — | Updates persist; validation enforced; audit recorded | | |
| UAT-MPRO-004 | P | P2/S2 | Edir Admin | — | Add relative/beneficiary with benefit share | share 0–100 | Relative added (beneficiary by default); share validated 0–100 | | |
| UAT-MPRO-005 | B | P2/S3 | Edir Admin | — | Set benefit share to 101 / negative | 101 / ‑1 | Rejected by validation | | |
| UAT-MPRO-006 | P | P2/S2 | Edir Admin | — | Upload relative document & member document | image/pdf | Lands in PENDING review state; visible in Documents queue | | |
| UAT-MPRO-007 | W | P2/S2 | Reviewer (review_member_documents) | PENDING doc exists | Approve / Reject document with note | — | Status updates APPROVED/REJECTED; audited | | |
| UAT-MPRO-008 | P | P1/S2 | Super Admin | Member in any Edir | Reset member password from profile | — | **Works without "An Edir must be selected" error** (scoped to member's Edir); credentials returned; sessions invalidated | | |
| UAT-MPRO-009 | S | P1/S1 | Super Admin | Member in Edir A & B | Perform each profile mutation (edit, relative, doc, removal) on each Edir's member | — | All succeed scoped to the member's own Edir; none throw the Edir‑selection error | | |
| UAT-MPRO-010 | P | P3/S3 | Edir Admin | Member with login | View account panel (last login, reset count, locked, onboarding) | — | Account metadata accurate | | |

---

## 11. Payments — Manual & Settlement (PAY)

> Settlement order on approval/callback: **penalties → due installments → monthly fee**. Manual payment routes through maker‑checker; settlement runs only on approval.

| ID | Type | Pri/Sev | Role | Preconditions | Test Steps | Test Data | Expected Result | Actual | Status |
|---|---|---|---|---|---|---|---|---|---|
| UAT-PAY-001 | P | P1/S2 | Cashier | Members with balances | Open Payments; review summary cards & sortable table | — | Totals correct; search/filter/sort/export available | | |
| UAT-PAY-002 | P | P1/S1 | Cashier (maker) | Member with arrears + penalty + installments | Record Payment → dialog auto‑fills outstanding breakdown (penalty, arrears, installment, fee); live total | computed | Breakdown auto‑calculated from outstanding; editable; PaymentLog created in **awaiting‑approval** state (no balance change yet) | | |
| UAT-PAY-003 | W | P1/S1 | Approver (checker ≠ maker) | Pending manual payment | Approvals → approve the payment | — | Settlement runs in one tx in order penalties→installments→fee; balance decremented; breakdown preserved; maker notified; audit written | | |
| UAT-PAY-004 | S/W | P1/S1 | Cashier (maker) | Pending payment they created | Open the request in Approvals | — | Approve/Reject disabled for the maker (cannot self‑approve) | | |
| UAT-PAY-005 | N | P1/S2 | Cashier | — | Record payment of 0 / negative / non‑numeric | 0 / ‑5 / abc | Validation blocks submission | | |
| UAT-PAY-006 | B | P2/S2 | Cashier | Member balance = X | Record payment > outstanding (overpayment) | X+100 | Handled per business rule (capped or recorded as credit) consistently; no negative balance corruption | | |
| UAT-PAY-007 | B | P2/S2 | Cashier | Member balance = exact penalty+fee | Record exact full settlement | exact | Balance → 0; `PaymentStatus.status = PAID`; monthsPaid/totalPaid/lastPayment updated | | |
| UAT-PAY-008 | P | P2/S2 | Cashier | Member with installment plan | Pay an amount covering one installment | per‑installment | Correct installment marked paid (sequence order); remaining due unchanged | | |
| UAT-PAY-009 | W | P1/S2 | Edir Admin (maker waive) | Member with penalty | Request penalty waiver | reason | `PENALTY_WAIVER` request created; penalty unchanged until approval | | |
| UAT-PAY-010 | W | P1/S2 | Approver | Pending waiver | Approve penalty waiver | — | Penalty removed/zeroed on approval; balance recalculated; audited | | |
| UAT-PAY-011 | P | P2/S2 | Edir Admin (void) | Settled payment | Void a transaction | reason | Transaction VOID; ledger/Payment Log reflects void; balance impact reversed per rule; audited | | |
| UAT-PAY-012 | R | P1/S1 | Committee | — | Open Payments | — | View‑only; Record/Void/Approve controls absent | | |
| UAT-PAY-013 | Rg | P1/S1 | Approver | Payment approved once | Attempt to approve same request again | — | Idempotent; request CLOSED; no double settlement | | |
| UAT-PAY-014 | P | P3/S3 | Cashier | — | Export payments CSV | — | CSV reflects filtered set | | |

---

## 12. Approvals Center & Maker‑Checker Engine (APPR)

> Modules: Manual Payment, Emergency Claim, Emergency Disbursement, Asset Issuance, Member Removal, Rule Change, Penalty Waiver. Each routes to users holding the module's configured `approve_*` permission.

| ID | Type | Pri/Sev | Role | Preconditions | Test Steps | Test Data | Expected Result | Actual | Status |
|---|---|---|---|---|---|---|---|---|---|
| UAT-APPR-001 | P | P1/S2 | Approver | Pending requests exist | Open Approvals → Pending / My Submissions / History tabs; apply module & status filters | — | Tabs and filters work; each request shows timeline, payload, summary | | |
| UAT-APPR-002 | W | P1/S1 | Approver | Pending request by another user | Approve with comment | — | Registry `execute` runs in one transaction; status → CLOSED; `ApprovalEvent(APPROVED/EXECUTED)`; maker notified; audit entry | | |
| UAT-APPR-003 | W | P1/S2 | Approver | Pending request | Reject with comment | — | Status → rejected; maker notified; no side effects executed | | |
| UAT-APPR-004 | W | P1/S2 | Approver | Pending request | Return for changes | — | Status → RETURNED; maker can edit & resubmit | | |
| UAT-APPR-005 | W | P2/S2 | Maker | Own request RETURNED | Resubmit | — | Returns to PENDING; only the maker may resubmit | | |
| UAT-APPR-006 | S | P1/S1 | Maker | Own PENDING request | Try to approve own request | — | Blocked (maker ≠ checker enforced server‑side, not just UI) | | |
| UAT-APPR-007 | R | P1/S1 | Approver w/ only approve_payment | Pending emergency claim exists | Open Approvals | — | Sees only modules they can check; cannot approve emergency claim | | |
| UAT-APPR-008 | P | P2/S3 | Any with view_approvals | New pending request created | Observe nav badge | — | Pending‑count badge increments; clears after action | | |
| UAT-APPR-009 | S | P1/S1 | Approver (Edir A) | Pending request in Edir B | Attempt to act | — | Cross‑tenant approval blocked | | |
| UAT-APPR-010 | N | P2/S2 | Approver | Request already CLOSED | Attempt action | — | Guard rejects (only PENDING actionable) | | |

---

## 13. Emergencies (EMG)

> Two‑stage maker‑checker: claim approval (→ ACTIVE with `approvedAmount`) then disbursement (→ RESOLVED, draws down `emergencyReserve`).

| ID | Type | Pri/Sev | Role | Preconditions | Test Steps | Test Data | Expected Result | Actual | Status |
|---|---|---|---|---|---|---|---|---|---|
| UAT-EMG-001 | P | P1/S2 | Edir Admin | Emergency types exist | Open Emergencies; review summary cards + claims table | — | Counts (reported/active/resolved), approved/disbursed totals correct | | |
| UAT-EMG-002 | P | P1/S2 | Edir Admin (maker) | Member eligible | Report a claim; submit for approval with approved amount | type, amount | `EMERGENCY_CLAIM` request created; claim REPORTED→pending; eligibility/good‑standing checked | | |
| UAT-EMG-003 | N | P2/S2 | Edir Admin | Member not eligible (tenure < minMembershipMonths) | Submit claim | — | Blocked/flagged per eligibility rule | | |
| UAT-EMG-004 | W | P1/S1 | Approver | Pending claim | Approve | — | Claim → ACTIVE; `approvedAmount` set; no money moved yet | | |
| UAT-EMG-005 | W | P1/S1 | Edir Admin (maker) | ACTIVE claim | Request disbursement (amount) | ≤ approved | `EMERGENCY_DISBURSEMENT` request created; duplicate pending disbursement blocked | | |
| UAT-EMG-006 | W | P1/S1 | Approver | Pending disbursement | Approve | — | Claim → RESOLVED; `disbursedAmount` set; `emergencyReserve` reduced (floored at 0) in one tx | | |
| UAT-EMG-007 | N | P2/S2 | Edir Admin | Claim still REPORTED | Try to disburse | — | Rejected ("Only approved (active) claims can be disbursed") | | |
| UAT-EMG-008 | B | P2/S2 | Approver | Reserve < disbursement amount | Approve disbursement | — | Reserve floored at 0 (no negative); behavior consistent with rule | | |
| UAT-EMG-009 | R | P1/S1 | Member | — | Submit emergency request via My Account/portal | — | Self‑service request created; surfaces in Member Requests for staff | | |
| UAT-EMG-010 | P | P3/S3 | Edir Admin | — | Export emergencies CSV | — | CSV reflects filtered claims | | |

---

## 14. Events & Attendance (EVT)

> Finalizing an attendance‑required event charges the configured absence penalty to ABSENT participants (increments balance), idempotently.

| ID | Type | Pri/Sev | Role | Preconditions | Test Steps | Test Data | Expected Result | Actual | Status |
|---|---|---|---|---|---|---|---|---|---|
| UAT-EVT-001 | P | P1/S2 | Edir Admin | — | Open Events; review summary cards + table | — | Upcoming/Finalized/Total/Penalized counts correct; sort/search/filter/export work | | |
| UAT-EVT-002 | P | P1/S2 | Edir Admin | — | Create event (attendanceRequired, absencePenalty, datetime) | future date | Event SCHEDULED; appears in list | | |
| UAT-EVT-003 | N | P2/S2 | Edir Admin | — | Create event with invalid/empty date | bad date | Validation blocks | | |
| UAT-EVT-004 | P | P2/S2 | Edir Admin | Scheduled event | Add participants / Invite all active members | — | Participants added (no duplicates); only same‑tenant members eligible | | |
| UAT-EVT-005 | P | P2/S2 | Edir Admin | Participants exist | Mark attendance (PRESENT/ABSENT/EXCUSED) | — | Statuses persist while SCHEDULED | | |
| UAT-EVT-006 | W | P1/S1 | Edir Admin (finalize_attendance) | Attendance‑required event, penalty>0, some ABSENT | Finalize attendance | — | Event → COMPLETED; each ABSENT (not yet penalized) charged penalty (balance increment, status PENDING); member notified | | |
| UAT-EVT-007 | Rg | P1/S1 | Edir Admin | Event already finalized | Finalize again / re‑run | — | Idempotent via `penalized` flag; no double charge; only SCHEDULED can finalize | | |
| UAT-EVT-008 | N | P2/S2 | Edir Admin | COMPLETED event | Edit / cancel / add participant | — | Blocked (locked after finalize) | | |
| UAT-EVT-009 | B | P2/S2 | Edir Admin | attendanceRequired = false OR penalty = 0 | Finalize | — | No penalties charged; event completes | | |

---

## 15. Assets (AST)

> Issuance is maker‑checker (draws down available inventory on approval). Return compensation = per‑unit × qty × condition factor (Good 0 / Damaged 0.5 / Lost 1), with manual override.

| ID | Type | Pri/Sev | Role | Preconditions | Test Steps | Test Data | Expected Result | Actual | Status |
|---|---|---|---|---|---|---|---|---|---|
| UAT-AST-001 | P | P1/S2 | Edir Admin | Assets seeded | Open Assets; review summary + Inventory/Issuances tabs | — | Stats correct; sort/search/filter/export per tab | | |
| UAT-AST-002 | P | P2/S2 | Edir Admin (manage_asset_categories) | — | Create/edit asset category | — | Category saved | | |
| UAT-AST-003 | P | P2/S2 | Edir Admin | Category exists | Add asset with quantity & unit value | qty>0 | Asset created; available = quantity | | |
| UAT-AST-004 | W | P1/S1 | Edir Admin (maker) | Asset with availability | Issue asset (member, qty) | qty ≤ available | `ASSET_ISSUANCE` request created; inventory unchanged until approval | | |
| UAT-AST-005 | N | P1/S2 | Edir Admin | qty > available | Issue more than available | over | Rejected at approval execute ("Only N available") | | |
| UAT-AST-006 | W | P1/S1 | Approver | Pending issuance | Approve | — | Marked issued; `issuedQuantity` increased; status available/issued accordingly | | |
| UAT-AST-007 | P | P1/S1 | Edir Admin | Issued asset | Return — Good condition | qty | Compensation auto = 0; inventory restored | | |
| UAT-AST-008 | P | P1/S1 | Edir Admin | Issued asset | Return — Damaged | per‑unit V, qty Q | Compensation = V×Q×0.5; charged to member balance | | |
| UAT-AST-009 | B | P1/S1 | Edir Admin | Issued asset | Return — Lost | V, Q | Compensation = V×Q×1.0 | | |
| UAT-AST-010 | P | P2/S2 | Edir Admin | Return dialog | Use manual override then "Auto" reset | custom | Manual value used; "Auto" recomputes default | | |
| UAT-AST-011 | R | P2/S2 | Approver (approve_asset_issuance only) | — | Open Assets | — | Cannot add/issue (no manage_assets); can approve issuance | | |

---

## 16. Rules & Bylaws (RUL)

> Rule changes go through maker‑checker; each modified field recorded in change log. Bylaws printable (print‑to‑PDF).

| ID | Type | Pri/Sev | Role | Preconditions | Test Steps | Test Data | Expected Result | Actual | Status |
|---|---|---|---|---|---|---|---|---|---|
| UAT-RUL-001 | P | P1/S2 | Edir Admin | — | Open Rules; review settings, penalty tiers, change log | — | Current config + history render | | |
| UAT-RUL-002 | P | P1/S2 | Edir Admin (manage_edir_settings) | — | Edit fees/grace/thresholds; save with reason | valid | Saved; change‑log entries created per modified field with before/after | | |
| UAT-RUL-003 | N | P1/S2 | Edir Admin | — | Set autoTerminateMonths ≤ autoSuspendMonths | invalid | Rejected ("Termination must be greater than suspension") | | |
| UAT-RUL-004 | B | P2/S2 | Edir Admin | — | Add penalty tier with PERCENT value >100 / toDays < fromDays | invalid | Rejected with specific message | | |
| UAT-RUL-005 | P | P2/S2 | Edir Admin | — | Configure member roles list | — | Member role options persist; reflected in Add Member | | |
| UAT-RUL-006 | W | P1/S2 | Edir Admin (maker, manage_rules) | — | Propose a bylaw/rule change | — | `RULE_CHANGE` request created; not applied until approval | | |
| UAT-RUL-007 | W | P1/S2 | Approver | Pending rule change | Approve | — | Change applied; change log + audit recorded | | |
| UAT-RUL-008 | P | P3/S3 | Edir Admin | — | Print/Export bylaws | — | Print dialog opens (print‑to‑PDF); content formatted | | |
| UAT-RUL-009 | S | P1/S1 | Super Admin | — | Open Rules with no Edir context | — | `getRuleConfig` requires an Edir — verify graceful handling (Super Admin operates per‑Edir) | | |

---

## 17. Committee Oversight (OVS)

| ID | Type | Pri/Sev | Role | Preconditions | Test Steps | Test Data | Expected Result | Actual | Status |
|---|---|---|---|---|---|---|---|---|---|
| UAT-OVS-001 | P | P1/S2 | Committee | Data seeded | Open Oversight | — | KPIs, trends, grievance/emergency summaries render read‑only | | |
| UAT-OVS-002 | R | P1/S1 | Committee | — | Look for action controls | — | No create/edit/approve controls anywhere | | |
| UAT-OVS-003 | P | P2/S3 | Committee | — | Click "Total Members" KPI | — | Navigates to `/dashboard/people` (view) | | |

---

## 18. Member Requests / Self‑Service (REQ)

| ID | Type | Pri/Sev | Role | Preconditions | Test Steps | Test Data | Expected Result | Actual | Status |
|---|---|---|---|---|---|---|---|---|---|
| UAT-REQ-001 | P | P1/S2 | Edir Admin (handle_member_requests) | Member submitted requests | Open Member Requests | — | Relative/emergency/asset/grievance requests listed for review | | |
| UAT-REQ-002 | W | P2/S2 | Edir Admin | Pending request | Approve/respond/reject | — | Status updates; member notified; audit recorded | | |
| UAT-REQ-003 | P | P1/S2 | Member | Logged in | Submit a grievance via My Account/portal | text | Grievance created; visible to staff in Requests/Oversight | | |
| UAT-REQ-004 | R | P1/S1 | Member | — | Attempt `/dashboard/requests` | — | Forbidden (handling is staff‑only) | | |

---

## 19. Documents Repository (DOC)

| ID | Type | Pri/Sev | Role | Preconditions | Test Steps | Test Data | Expected Result | Actual | Status |
|---|---|---|---|---|---|---|---|---|---|
| UAT-DOC-001 | P | P1/S2 | Edir Admin (view_documents) | Docs uploaded | Open Documents | — | Centralized list (member + relative docs) with related links | | |
| UAT-DOC-002 | S | P1/S1 | Committee | Docs in Edir B | Open Documents | — | Only authorized/own‑tenant records visible (scope‑limited) | | |
| UAT-DOC-003 | P | P2/S2 | Reviewer | PENDING doc | Open related record link | — | Navigates to correct member profile | | |
| UAT-DOC-004 | S | P2/S2 | Any | Uploaded file path | Access `/uploads/...` directly | — | Served via route with access control; unauthorized blocked | | |
| UAT-DOC-005 | N | P2/S2 | Edir Admin | — | Upload disallowed file type / oversized | exe / huge | Rejected with message | | |

---

## 20. Audit Log (AUD)

| ID | Type | Pri/Sev | Role | Preconditions | Test Steps | Test Data | Expected Result | Actual | Status |
|---|---|---|---|---|---|---|---|---|---|
| UAT-AUD-001 | P | P1/S2 | Edir Admin (view_audit_log) | Actions performed | Open Audit Log; filter by action/keyword; paginate | — | Entries with actor, action, target, details, timestamp; filters & pagination work | | |
| UAT-AUD-002 | S | P1/S1 | Edir Admin (Edir A) | — | Review entries | — | Only Edir A entries (tenant‑scoped); no Edir B leakage | | |
| UAT-AUD-003 | P | P2/S3 | Edir Admin (manage_audit_log) | — | Archive an entry | — | Entry archived (hidden from default view); `AUDIT_ENTRY_ARCHIVED` recorded | | |
| UAT-AUD-004 | P | P3/S3 | Edir Admin | — | Export audit CSV | filters | CSV reflects filtered set (cap 5000) | | |
| UAT-AUD-005 | Rg | P2/S2 | Any | Each mutation in app | Spot‑check audit after key actions | — | Every sensitive mutation writes an audit entry | | |

---

## 21. Payment Log (PLOG)

| ID | Type | Pri/Sev | Role | Preconditions | Test Steps | Test Data | Expected Result | Actual | Status |
|---|---|---|---|---|---|---|---|---|---|
| UAT-PLOG-001 | P | P1/S2 | Edir Admin (view_payment_log) | Transactions exist | Open Payment Log; filter/sort | — | All transactions (manual + NIB) with status (PENDING/SUCCESS/PARTIAL/FAILED/VOID), method, ref | | |
| UAT-PLOG-002 | S | P1/S1 | Edir Admin (Edir A) | — | Review | — | Tenant‑scoped only | | |
| UAT-PLOG-003 | P | P2/S3 | Edir Admin | NIB payment with receipt | Open transaction detail | — | `transactionId`, breakdown, receiptUrl shown | | |

---

## 22. Admin — Users / Roles / Edir Settings (USR/ROL/SET)

| ID | Type | Pri/Sev | Role | Preconditions | Test Steps | Test Data | Expected Result | Actual | Status |
|---|---|---|---|---|---|---|---|---|---|
| UAT-USR-001 | P | P1/S2 | Edir Admin | — | Open Users; review accounts (super‑admins hidden) | — | Tenant users listed; platform admins not shown | | |
| UAT-USR-002 | P | P2/S2 | Edir Admin | — | Change status / lock / unlock / reset password | — | Operate within tenant; audited; sessions invalidated where applicable | | |
| UAT-ROL-001 | P | P1/S2 | Edir Admin (manage_roles) | — | Create new role; pick permissions; save | — | Role saved (scope EDIR, own Edir) | | |
| UAT-ROL-002 | S | P1/S1 | Edir Admin | — | Open role editor; inspect permission groups | — | **Platform permissions hidden** — no "Manage Edirs", no "Super Admin", no Associations group | | |
| UAT-ROL-003 | S | P1/S1 | Edir Admin | — | Attempt to save a role with `manage_edirs`/`super_admin` via crafted request | tampered | Server strips platform permissions; role saved without them | | |
| UAT-ROL-004 | P | P1/S2 | Super Admin | — | Open role editor | — | Full catalog visible incl. platform permissions | | |
| UAT-ROL-005 | N | P2/S2 | Edir Admin | Role assigned to users | Delete that role | — | Blocked ("Cannot delete a role still assigned") | | |
| UAT-ROL-006 | B | P2/S3 | Edir Admin | — | Create role with name <2 chars | "A" | Validation blocks | | |
| UAT-SET-001 | P | P1/S2 | Edir Admin (manage_edir_settings) | — | Edit Edir Settings (fees, currency, thresholds) | — | Saved; reflected in calculations (registration fee on Add Member, penalties) | | |
| UAT-SET-002 | P | P2/S2 | Edir Admin (manage_committee) | — | Invite/role/remove committee members | — | Committee membership updates; audited | | |
| UAT-SET-003 | P | P2/S3 | Edir Admin | — | Upload/replace/remove Edir logo | image | Logo updates in header/branding | | |

---

## 23. System — Edirs & Associations (Super Admin) (EDR/ASSOC)

| ID | Type | Pri/Sev | Role | Preconditions | Test Steps | Test Data | Expected Result | Actual | Status |
|---|---|---|---|---|---|---|---|---|---|
| UAT-EDR-001 | P | P1/S1 | Super Admin | — | Create a new Edir | name | Edir created; `EdirSettings` created; **default roles auto‑provisioned** (Edir Admin, Member, Committee) | | |
| UAT-EDR-002 | Rg | P1/S1 | Super Admin | New Edir from EDR‑001 | Add Member into the new Edir; open Role dropdown | — | "Edir Admin" available (dropdown not empty); assigning it makes a working tenant admin | | |
| UAT-EDR-003 | P | P2/S2 | Super Admin | — | Edit Edir name/description | — | Updated; audited | | |
| UAT-EDR-004 | R | P1/S1 | Edir Admin | — | Attempt `/dashboard/system/edirs` | — | Forbidden | | |
| UAT-ASSOC-001 | P | P1/S2 | Super Admin | Unassigned users | Bulk associate users to an Edir with role + activate | — | Users associated + enrolled as members; counts update; audited | | |
| UAT-ASSOC-002 | S | P1/S1 | Super Admin | — | Confirm associations exclude SUPER_ADMIN users | — | Platform admins never reassigned | | |

---

## 24. My Account / Self‑Service Portal (ACC)

| ID | Type | Pri/Sev | Role | Preconditions | Test Steps | Test Data | Expected Result | Actual | Status |
|---|---|---|---|---|---|---|---|---|---|
| UAT-ACC-001 | P | P1/S1 | Member | Member with login | Open My Account | — | Full profile: payment status, penalties, installments, benefits, emergencies, grievances, relatives, documents, activity, governing rules | | |
| UAT-ACC-002 | R | P1/S1 | Edir Admin / Committee / Approver / Cashier | Logged in | Open My Account | — | Each admin/staff user sees their **own** complete membership profile (treated as member); management controls remain elsewhere | | |
| UAT-ACC-003 | P | P2/S2 | Member | — | Update own profile fields | — | Saved; validation enforced | | |
| UAT-ACC-004 | P | P2/S2 | Member | Logged in first time after provisioning | First visit to My Account | — | Membership auto‑provisioned if missing (member record + seeded balance) | | |
| UAT-ACC-005 | S | P1/S1 | Member | — | Attempt to view another member's data via id manipulation | — | Self‑scoped only; cross‑member access blocked | | |
| UAT-ACC-006 | P | P2/S2 | Member | Security tab | Change own password | — | Password updated per policy; sessions handled | | |

---

## 25. NIB Digital Payments — Public Flow (NIB)

> Public, framable flow: token → `/pay` → member lookup by phone → `getPaymentToken` (PENDING PaymentLog + SHA‑256 signature) → `/api/nib-callback` → settlement penalties→installments→fee. Callback authenticates by validating the bank token.

| ID | Type | Pri/Sev | Role | Preconditions | Test Steps | Test Data | Expected Result | Actual | Status |
|---|---|---|---|---|---|---|---|---|---|
| UAT-NIB-001 | P | P1/S1 | Public | Valid bank token | `/portal/connect?token=...` → `/pay` | mock token | Token validated→cookie; pay page loads inside frame (framing allowed) | | |
| UAT-NIB-002 | P | P1/S1 | Public | Member exists by phone | Look up member; view outstanding & history | phone | Member + outstanding + payment history shown | | |
| UAT-NIB-003 | P | P1/S1 | Public | — | Initiate payment → `getPaymentToken` | amount | PENDING PaymentLog created with `transactionId` + signature | | |
| UAT-NIB-004 | W | P1/S1 | System | Pending log + valid callback token (matching transactionId/account, not expired) | POST `/api/nib-callback` | valid | Settlement runs penalties→installments→fee; `PaymentStatus` updated (balance, monthsPaid, totalPaid, lastPayment, PAID/PENDING) | | |
| UAT-NIB-005 | Rg | P1/S1 | System | Already‑settled transaction | Replay the callback | same ref | Idempotent — skipped, no double settlement | | |
| UAT-NIB-006 | P | P2/S2 | System | Partial payment amount | Callback with partial | < outstanding | PaymentLog PARTIAL; balance partially reduced in order | | |
| UAT-NIB-007 | S | P1/S1 | System | Missing pending log | Callback with valid token claims | — | Self‑heal: reconstruct pending from token claims, then settle | | |
| UAT-NIB-008 | S | P1/S1 | System | Forged token (wrong transactionId/account/expired) | Callback | tampered | Rejected (anti‑forgery binding); body signature is informational only, never the sole gate | | |
| UAT-NIB-009 | S | P1/S1 | Public | — | Attempt to frame a dashboard route | — | Dashboard `X-Frame-Options: DENY` / `frame-ancestors 'none'` blocks framing; only `/pay`,`/portal`,`/api/nib-callback` framable | | |
| UAT-NIB-010 | P | P2/S2 | Public | Pay page open | Live status update (SSE) | — | Status transitions to success without manual refresh | | |
| UAT-NIB-011 | P | P3/S3 | Public | — | Toggle language EN ↔ Amharic on pay page | — | All pay UI strings switch language (i18n) | | |

---

## 26. Notifications (NOT)

| ID | Type | Pri/Sev | Role | Preconditions | Test Steps | Test Data | Expected Result | Actual | Status |
|---|---|---|---|---|---|---|---|---|---|
| UAT-NOT-001 | P | P1/S2 | Approver | Maker submits a request | Observe notifications | — | Checkers (users with the module's approve permission) notified of new pending request | | |
| UAT-NOT-002 | P | P1/S2 | Maker | Checker approves/rejects | Observe | — | Maker notified of outcome | | |
| UAT-NOT-003 | P | P2/S2 | Member | Absence penalty applied / payment settled | Observe | — | Member receives payment/penalty notification | | |
| UAT-NOT-004 | P | P3/S3 | Any | Notifications exist | Open dropdown/page; mark read | — | Read/unread state persists; counts update | | |
| UAT-NOT-005 | S | P2/S2 | Any | — | Verify notification scope | — | Users only receive own/tenant notifications | | |

---

## 27. Reporting & Exports (RPT)

| ID | Type | Pri/Sev | Role | Preconditions | Test Steps | Test Data | Expected Result | Actual | Status |
|---|---|---|---|---|---|---|---|---|---|
| UAT-RPT-001 | P | P2/S3 | Edir Admin | Data exists | Export CSV from People/Payments/Emergencies/Assets/Events/Audit | — | Each export downloads; columns correct; honors active filters & tenant scope | | |
| UAT-RPT-002 | P | P3/S3 | Edir Admin | — | Print/Export bylaws (Rules) | — | Print‑to‑PDF output formatted | | |
| UAT-RPT-003 | B | P2/S3 | Edir Admin | Field with commas/quotes | Export & open CSV | tricky text | CSV escaping correct (no column break) | | |
| UAT-RPT-004 | S | P1/S2 | Edir Admin (Edir A) | — | Export any module | — | Export contains only Edir A data | | |
| UAT-RPT-005 | Rg | P2/S2 | Edir Admin | Dashboard KPIs | Compare KPI numbers vs exports | — | Figures reconcile across dashboard, tables, and exports | | |

---

## 28. Cross‑Cutting: Search / Filter / Sort / Pagination / Responsiveness / Errors (UX)

| ID | Type | Pri/Sev | Role | Preconditions | Test Steps | Test Data | Expected Result | Actual | Status |
|---|---|---|---|---|---|---|---|---|---|
| UAT-UX-001 | P | P2/S3 | Any | Lists with many rows | Search across People/Payments/etc. | partial text | Case‑insensitive search filters across configured fields | | |
| UAT-UX-002 | P | P2/S3 | Any | — | Sort each sortable column asc/desc | — | Sort indicator toggles; order correct (incl. numeric balance) | | |
| UAT-UX-003 | P | P2/S3 | Edir Admin | Members > page size | Paginate Members list | — | Page controls work; counts accurate | | |
| UAT-UX-004 | B | P3/S3 | Any | Filter yielding 0 results | Apply restrictive filter | — | Empty state shown (not error) | | |
| UAT-UX-005 | P | P2/S2 | Any | Mobile viewport (≤375px) | Open key pages on mobile | — | Responsive layout; tables scroll/stack; nav collapses; dialogs usable | | |
| UAT-UX-006 | P | P2/S2 | Any | Tablet viewport | Repeat key pages | — | Layout adapts; no clipping/overlap | | |
| UAT-UX-007 | N | P2/S2 | Any | Network/server error | Trigger action failure | — | Toast error + retry; no infinite spinner; session‑expired errors trigger clean logout | | |
| UAT-UX-008 | S | P2/S2 | Any | — | Inspect response headers on a dashboard route | — | CSP (nonce, frame‑ancestors none), HSTS, X‑Content‑Type‑Options, Referrer‑Policy present | | |
| UAT-UX-009 | B | P3/S4 | Any | Long names / Amharic script | Render lists & profile | unicode | No layout break; Amharic renders correctly | | |
| UAT-UX-010 | P | P3/S4 | Any | — | Keyboard navigation & focus on dialogs | — | Focus trapped in dialogs; ESC/Cancel close without side effects | | |

---

## 29. End‑to‑End Scenarios (E2E)

| ID | Type | Pri/Sev | Roles | Scenario (steps) | Expected Result | Actual | Status |
|---|---|---|---|---|---|---|---|
| UAT-E2E-001 | E2E | P1/S1 | Super Admin → Edir Admin | 1. Super Admin creates a new Edir (auto roles) 2. Adds a member as **Edir Admin** in that Edir 3. New admin receives credentials, logs in, forced password change 4. New admin configures Edir Settings, creates a role, adds members | Full tenant onboarding succeeds; new admin operates only within their Edir | | |
| UAT-E2E-002 | E2E | P1/S1 | Cashier → Approver | 1. Cashier records a manual payment (auto breakdown) 2. Request appears in Approvals 3. Different Approver approves 4. Settlement applies penalties→installments→fee | Balance reduced correctly; maker notified; audit + payment log updated; maker could not self‑approve | | |
| UAT-E2E-003 | E2E | P1/S1 | Edir Admin → Approver | Emergency: report claim → approve claim (ACTIVE) → request disbursement → approve (RESOLVED, reserve drawn down) | Two‑stage maker‑checker completes; reserve decremented; member notified | | |
| UAT-E2E-004 | E2E | P1/S2 | Edir Admin | Event: create attendance‑required event → invite members → mark some ABSENT → finalize | Absentees charged absence penalty (balance up); event COMPLETED; idempotent on re‑finalize | | |
| UAT-E2E-005 | E2E | P1/S1 | Member (public) | NIB: connect token → look up member → initiate payment → callback settles → status live‑updates | Outstanding settled in order; idempotent on replay; PaymentStatus updated; receipt available | | |
| UAT-E2E-006 | E2E | P1/S2 | Edir Admin → Approver | Member removal: request removal (maker) → approve (checker) | Member removed/cascaded on approval; audit recorded; not removed before approval | | |
| UAT-E2E-007 | E2E | P1/S2 | Member → Edir Admin | Member submits grievance/emergency via portal → staff handles in Member Requests → member notified | Self‑service round‑trip works; statuses and notifications consistent | | |
| UAT-E2E-008 | E2E | P1/S1 | Two Edirs | Perform parallel operations in Edir A and Edir B with different admins | Complete data isolation; no cross‑tenant leakage in lists, exports, audit, approvals | | |

---

## 30. Traceability / Coverage Matrix (summary)

| Capability area | Test case IDs |
|---|---|
| Authentication & session | UAT-AUTH-001..012 |
| RBAC & tenant scope | UAT-RBAC-001..010, UAT-*-S rows |
| Dashboards & analytics | UAT-DASH-001..006, UAT-OVS-001..003 |
| People / Users / Associations | UAT-PPL-001..022, UAT-ASSOC-001..002 |
| Member profile & documents | UAT-MPRO-001..010, UAT-DOC-001..005 |
| Payments & settlement | UAT-PAY-001..014, UAT-NIB-001..011 |
| Maker‑Checker (all 7 modules) | UAT-APPR-001..010, UAT-PAY-003/009/010, UAT-EMG-004/006, UAT-AST-004/006, UAT-RUL-006/007, UAT-PPL-014 |
| Emergencies / Events / Assets | UAT-EMG-001..010, UAT-EVT-001..009, UAT-AST-001..011 |
| Rules / Bylaws & change log | UAT-RUL-001..009 |
| Admin (Users/Roles/Settings) | UAT-USR/ROL/SET-*, UAT-EDR-001..004 |
| My Account self‑service | UAT-ACC-001..006, UAT-REQ-003 |
| Notifications | UAT-NOT-001..005 |
| Reporting / Exports / PDF | UAT-RPT-001..005 |
| Search/Sort/Filter/Pagination/Responsive | UAT-UX-001..010 |
| Security | UAT-AUTH-004/008/010/012, UAT-RBAC-003..006, UAT-PPL-008/009/018, UAT-ROL-002/003, UAT-NIB-007/008/009, UAT-UX-008 |
| End‑to‑End | UAT-E2E-001..008 |

---

## 31. Defect Log Template

| Defect ID | Linked Test Case | Title | Steps to reproduce | Severity | Priority | Status | Assigned to | Notes |
|---|---|---|---|---|---|---|---|---|
| DEF-001 | UAT-___-___ | | | S_ | P_ | Open | | |

---

## 32. Execution Summary & Sign‑off

| Metric | Value |
|---|---|
| Total test cases | (count) |
| Executed | |
| Passed | |
| Failed | |
| Blocked | |
| Pass rate % | |
| Open defects (S1/S2) | |

**Sign‑off**

| Role | Name | Decision (Accept/Reject) | Date | Signature |
|---|---|---|---|---|
| Product Owner | | | | |
| QA Lead | | | | |
| Edir Admin SME | | | | |

---

### Execution notes
- Run **P1/S1** cases first (critical path & security). A failed S1 blocks release.
- For every maker‑checker case, always use **two distinct users** (maker ≠ checker).
- For every cross‑tenant security case, keep **Edir A** and **Edir B** datasets distinct and verify no leakage in lists, exports, audit, and approvals.
- Re‑run the **Regression (Rg)** subset after any fix.
