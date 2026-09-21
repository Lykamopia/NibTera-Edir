# NibTera Edir — Platform Administrator Manual

**For Super Administrators and organizational (Head Office / District / Branch) staff**

---

<table>
<tr><td><b>Product</b></td><td>NibTera Edir — Edir Management Platform</td></tr>
<tr><td><b>Document</b></td><td>Platform Administrator Manual</td></tr>
<tr><td><b>Version</b></td><td>1.0</td></tr>
<tr><td><b>Audience</b></td><td>Super Admins; Head Office, District, and Branch administrators</td></tr>
<tr><td><b>Last updated</b></td><td>2 July 2026</td></tr>
<tr><td><b>Classification</b></td><td>Internal / Restricted</td></tr>
</table>

---

## Table of contents

1. [Introduction](#1-introduction)
2. [Platform architecture and multi-tenancy](#2-platform-architecture-and-multi-tenancy)
3. [The role and scope model](#3-the-role-and-scope-model)
4. [Getting started as a platform administrator](#4-getting-started-as-a-platform-administrator)
5. [Organizational structure: districts](#5-organizational-structure-districts)
6. [Organizational structure: branches](#6-organizational-structure-branches)
7. [The Edir directory and lifecycle](#7-the-edir-directory-and-lifecycle)
8. [Registering a new Edir](#8-registering-a-new-edir)
9. [The Edir registration approval workflow](#9-the-edir-registration-approval-workflow)
10. [Editing, revoking, and deleting Edirs](#10-editing-revoking-and-deleting-edirs)
11. [Platform users](#11-platform-users)
12. [User associations and transfers](#12-user-associations-and-transfers)
13. [Roles and permissions](#13-roles-and-permissions)
14. [The Approvals Center for governance](#14-the-approvals-center-for-governance)
15. [Dashboards and reporting](#15-dashboards-and-reporting)
16. [Audit log](#16-audit-log)
17. [Payments and the NIB integration](#17-payments-and-the-nib-integration)
18. [Security and compliance](#18-security-and-compliance)
19. [System configuration and deployment](#19-system-configuration-and-deployment)
20. [Operational best practices](#20-operational-best-practices)
21. [Troubleshooting](#21-troubleshooting)
22. [Frequently asked questions](#22-frequently-asked-questions)
23. [Appendix A — Platform permission reference](#appendix-a--platform-permission-reference)
24. [Appendix B — Environment variables](#appendix-b--environment-variables)
25. [Glossary](#25-glossary)

---

## 1. Introduction

The **Platform Administrator** governs NibTera Edir at the organizational level —
above any single Edir. Your responsibilities span the whole institution's
deployment:

- Modelling the bank's operational structure as **districts** and **branches**.
- Overseeing the **Edir lifecycle**: registration, approval, activation,
  suspension, and closure.
- Managing **platform users** — the staff and operators who run Edirs — and their
  **roles and permissions**.
- **Associating and transferring** users across Edirs and appointing Edir
  Administrators.
- Enforcing **security, governance, and compliance** across all tenants.

This manual assumes familiarity with the maker–checker principle described in the
*Edir Administrator Manual*; here it applies to Edir **governance** (registration
and profile updates) rather than day-to-day Edir operations.

---

## 2. Platform architecture and multi-tenancy

NibTera Edir is a **multi-tenant** application. A single deployment serves many
Edirs; each Edir ("tenant") has its own members, payments, settings, roles, and
records, strictly isolated from others.

Sitting **above** the tenants is the bank's operational hierarchy, which provides
governance and reporting scope:

```
Head Office
   └── District
          └── Branch
                 └── Edir (tenant)
                        ├── Members
                        ├── Users (staff)
                        ├── Roles & Settings
                        └── Operational data (payments, emergencies, events, assets, …)
```

- Every **Edir belongs to a Branch**; every **Branch belongs to a District**.
- Governance actions on an Edir (registration/updates) are **routed up** this
  hierarchy: a Branch user submits, and a user at Branch, District, or Head Office
  with the right permission approves — scoped to the Edirs their org unit covers.
- **Super Admins** stand outside the hierarchy with full cross-tenant access.

> **Design note.** Super Admins manage the **platform** (tenants, users, roles,
> governance) and, by default, do **not** see an individual Edir's operational
> pages. Those belong to Edir Administrators. Super Admins can still drill into any
> Edir's operational pages through a dedicated **"Edir Pages"** group using the
> top-bar Edir switcher.

---

## 3. The role and scope model

Access is governed by two dimensions: **scope** (how far a role reaches) and
**permissions** (what it can do).

### Role scopes

| Scope | Reach | Typical use |
|-------|-------|-------------|
| **SUPER_ADMIN** | Everything, all tenants | Platform owner / top administrator. |
| **PLATFORM** | Cross-tenant platform capabilities | Central platform operators. |
| **HEAD_OFFICE** | All districts and branches | Head-office governance and oversight. |
| **DISTRICT** | One district and its branches | District-level administrators. |
| **BRANCH** | One branch and its Edirs | Branch-level administrators (often register Edirs). |
| **EDIR** | One Edir | Edir Administrators, committee, members (see *Edir Manual*). |

### Platform vs. Edir permissions

Permissions are partitioned so scope can't be bypassed:

- **Platform (cross-tenant) permissions** — managing Edirs, districts, branches,
  cross-Edir user associations, Edir registration/update approvals, and the
  `super_admin` master switch. These can be granted **only by a Super Admin** and
  appear **only** in platform-scoped role editors.
- **Edir-scoped permissions** — everything operational within a single Edir. These
  never grant cross-tenant power.

> **Important distinction.** `manage_edir_settings` (fees, penalties, branding,
> rules configuration) is an **Edir-scoped** permission held by Edir Administrators
> — it is deliberately **not** a platform permission. Platform administrators govern
> the Edir's *lifecycle*, not its internal financial policies.

### Who is a "platform user" vs. a "member"

- A login whose role is **non-EDIR scope** (Super Admin, Platform, Head Office,
  District, Branch) is always a **platform/system user**.
- An **EDIR-scoped** login is a platform user only if its role grants capabilities
  beyond the baseline member permission (`view_dashboard`); otherwise it is treated
  as an ordinary **member**.

This split determines where an account appears: the **Platform Users** directory vs.
the **Members** page.

---

## 4. Getting started as a platform administrator

### First sign-in (Super Admin)

The initial Super Admin account is created during deployment (via database seed).
Its email is set by configuration; the password is either supplied via the
`ADMIN_PASSWORD` environment variable or generated once and printed at seed time.

1. Sign in with the Super Admin email and the seed password.
2. You'll be **required to change the password immediately** on first login.
3. Choose a strong password (≥8 chars, upper/lower/number/special, not breached).

⚠ **Secure the Super Admin account first.** Change its password, record recovery
details safely, and consider enabling two-factor authentication before doing
anything else.

### Recommended bring-up order

1. Create the **districts** ([Section 5](#5-organizational-structure-districts)).
2. Create the **branches** under each district ([Section 6](#6-organizational-structure-branches)).
3. Create **platform users** for Head Office / District / Branch staff and assign
   scoped roles ([Sections 11](#11-platform-users) & [13](#13-roles-and-permissions)).
4. Begin **registering Edirs** and processing approvals ([Sections 8](#8-registering-a-new-edir)–[9](#9-the-edir-registration-approval-workflow)).
5. Appoint **Edir Administrators** for each activated Edir ([Section 12](#12-user-associations-and-transfers)).

---

## 5. Organizational structure: districts

**Page:** System → Districts · **Access:** `view_districts` / `manage_districts` /
`super_admin`

Districts are the top operational division below Head Office. Each has a unique
**name** and optional **code** and description; branches are nested beneath.

| Task | Permission |
|------|-----------|
| View districts | `view_districts` |
| Create district | `create_district` |
| Edit district | `edit_district` |
| Delete district (only when empty) | `delete_district` |
| Bulk import from CSV | `import_districts` |
| Umbrella (all of the above) | `manage_districts` |

**To create a district:** select **Add District**, enter the name and (optionally) a
unique code and description, and save.

**Bulk import:** use **Import** to upload a CSV of districts for large rollouts.

⚠ A district can only be **deleted when it has no branches**. Reassign or remove its
branches first.

---

## 6. Organizational structure: branches

**Page:** System → Branches · **Access:** `view_branches` / `manage_branches` /
`manage_districts` / `super_admin`

Branches belong to a district and are the unit an **Edir is attached to**.

| Task | Permission |
|------|-----------|
| View branches | `view_branches` |
| Create branch | `create_branch` |
| Edit branch | `edit_branch` |
| Delete branch (only when empty) | `delete_branch` |
| Bulk import from CSV | `import_branches` |
| Umbrella (all of the above) | `manage_branches` |

**To create a branch:** select **Add Branch**, choose its **district**, enter a name
and optional unique code, and save. Branch names must be unique within their
district.

⚠ A branch can only be **deleted when it has no Edirs** (and no dependent records).
Move or close its Edirs first.

---

## 7. The Edir directory and lifecycle

**Page:** Operations → Edirs · **Access:** `view_edir`, `register_edir`,
`manage_edirs`, `approve_edir_registration`, `approve_edir_update`, and related.

The **Edirs** page is the unified home for Edir management: browse the directory,
register new Edirs, and track submissions. Each Edir has a **status** that defines
what it can do.

### Edir statuses

| Status | Meaning | Can accept payments? |
|--------|---------|----------------------|
| **PENDING** | Registered but not yet approved. | No |
| **ACTIVE** | Approved and operational. | Yes (if a payment account is configured) |
| **SUSPENDED** | Administratively paused. | No |
| **CLOSED** | Permanently closed. | No |

> **Note.** Members can only pay through the mini-app when their Edir is **ACTIVE**
> and has a configured **account number**. Otherwise the mini-app shows a "payment
> account unavailable" message.

### Edir profile fields

An Edir record captures: name, description, logo, the **branch** it belongs to,
status, **account number**, address, and contact details (contact person name,
address, mobile, email), plus an **agreement document**.

---

## 8. Registering a new Edir

**Access:** `register_edir` (maker)

Registration is a **maker–checker** governance workflow. A Branch/District/Head
Office user submits; a checker up the hierarchy approves.

### The registration form (6 steps)

| Step | Fields |
|------|--------|
| **1 — Edir Details** | Edir name (required), description (optional), account number (required). |
| **2 — Branch / District** | Branch (required, scope-aware); district auto-derived from the branch. |
| **3 — Chairperson Info** | Chairperson/contact name (required), mobile (required), email (required). |
| **4 — Address Details** | Edir address (required), bank account number (required), contact address (optional). |
| **5 — Agreement Document** | Upload the signed agreement (PDF, required). |
| **6 — Review & Submit** | Review all entries; the maker–checker workflow is explained; confirm. |

**To register an Edir:**

1. Open **Edirs → Register** and complete steps 1–5.
2. On step 6, review everything and **Submit**.
3. The Edir is created with status **PENDING**, an **Edir Registration** approval
   request is opened, and the action is written to the audit log.

> **Scope-aware submission.** Branch users can register Edirs for their own branch;
> District users for any branch in their district; Head Office users for any branch.

---

## 9. The Edir registration approval workflow

**Access:** `approve_edir_registration` (checker)

Edir registration is an **org-governance** module — unlike Edir-operational
approvals, it is reviewed by organizational staff **above** the Edir, routed up the
branch → district → head-office chain. Any org user holding the checker permission
whose org unit **covers the Edir's branch** can review it.

### Reviewing a registration

1. Open the **Approvals Center**; pending Edir registrations appear (scoped to your
   org unit).
2. Open a request to review all submitted details and **download and validate the
   agreement document**.
3. Decide:

| Decision | Effect on the Edir |
|----------|--------------------|
| **Approve** | Status **PENDING → ACTIVE**. Default **settings** and default **roles** (Edir Admin, Member, Committee) are created automatically. The maker is notified. |
| **Reject** | Edir stays **PENDING**; a reason is recorded and the maker is notified. |
| **Return** | Edir stays **PENDING**; the maker receives revision notes and can update and resubmit. |

⚠ **You cannot approve your own submission.** A different authorized org user must
check it.

> **After activation.** The Edir is fully operational. Your next step is usually to
> **appoint an Edir Administrator** ([Section 12](#12-user-associations-and-transfers))
> so the Edir's own staff can take over day-to-day operations.

### Edir profile updates

Changes to an Edir's official profile also flow through governance as **Edir
Update** requests (`approve_edir_update`), reviewed the same way. This keeps
official details (name, branch, account, agreement) under organizational control.

---

## 10. Editing, revoking, and deleting Edirs

**Access:** `manage_edirs` (umbrella) or the granular permissions below.

| Task | Permission | Notes |
|------|-----------|-------|
| **Edit an Edir's profile** | `edit_edir` | Official-field changes route through the **Edir Update** approval. |
| **Revoke (suspend/close)** | `revoke_edir` | Deactivate without deleting — sets status to SUSPENDED or CLOSED. Stops payments. |
| **Delete** | `delete_edir` | Permanently removes an Edir — **only permitted when it has no operational data**. |
| **View cross-Edir reports** | `view_edir_reports` | Metrics across multiple Edirs. |

⚠ **Prefer revoke over delete.** Deletion is only possible for empty Edirs and is
irreversible. To stop a functioning Edir, **revoke** (suspend/close) it so records
and history are preserved.

---

## 11. Platform users

**Page:** Administration → Platform Users · **Access:** `view_users`,
`manage_users`, `manage_associations`, `manage_edir_associations`,
`manage_edir_users`

The Platform Users directory lists the **staff/operator accounts** across the
platform (as opposed to ordinary members). From here you provision and govern the
people who run Edirs and organizational units.

### Account lifecycle and statuses

| Status | Meaning |
|--------|---------|
| **INVITED** | Created; awaiting first sign-in / password setup. |
| **ACTIVE** | In good standing. |
| **INACTIVE** | Deactivated; cannot sign in. |
| **SUSPENDED** | Administratively suspended. |

### Common tasks

| Task | Permission |
|------|-----------|
| View users | `view_users` |
| Invite / edit / deactivate users | `manage_users` |
| Reset a user's password | `reset_password` |
| Lock a user account | `lock_user` |
| Unlock a user account | `unlock_user` |
| Create/manage users within Edirs | `manage_edir_users` |
| Associate/transfer users across Edirs | `manage_edir_associations` / `manage_associations` |

### Inviting a platform user

1. Select **Invite User**; enter name, email, and phone (Ethiopian phone numbers are
   normalized to the `251…` format).
2. Assign a **role** whose scope matches the person's reach (e.g. a DISTRICT role
   for a district administrator).
3. For scoped roles, set the **district**/**branch**/**Edir** the account belongs to.
4. Send the invitation. The user sets a password via email or changes a temporary
   one on first login.

### Account security actions

- **Reset password** — issues a new temporary credential the user must change.
- **Lock / Unlock** — manually lock a suspicious account, or clear a lockout caused
  by failed sign-ins.
- **Deactivate** — set an account INACTIVE to revoke access without deleting history.

> **Note.** Creating certain accounts may itself be governed by a **User Creation**
> approval (`approve_user_creation`) depending on your configuration, ensuring a
> second person authorizes new access.

---

## 12. User associations and transfers

**Access:** `manage_associations` / `manage_edir_associations` / `manage_edir_users`

"Association" is how you connect a user account to the Edir (and org unit) they work
in — and move them when responsibilities change. This is also how you **appoint Edir
Administrators**.

Typical operations:

| Operation | What it does |
|-----------|--------------|
| **Assign a user to an Edir** | Grants a user an operational role within a specific Edir (e.g. make someone an **Edir Admin**). |
| **Transfer a user** | Move a user from one Edir/branch/district to another, carrying or changing their role. |
| **Remove an association** | Detach a user from an Edir, revoking that access. |

**To appoint an Edir Administrator:**

1. Ensure the target Edir is **ACTIVE**.
2. In **Platform Users**, find or invite the person.
3. **Associate** them with the Edir and assign the **Edir Admin** role.
4. They can now sign in and operate that Edir (see the *Edir Administrator Manual*).

> **Note.** Cross-tenant assignment/transfer requires platform association
> permissions and respects org scope — you can only assign within the Edirs your
> scope covers (Super Admin covers all).

---

## 13. Roles and permissions

**Page:** Administration → Roles · **Access:** `view_roles` / `manage_roles`

Roles are named permission sets. The role editor presents permissions grouped by
module and action, with a **permission matrix** (modules × actions) for enterprise
review.

### Scope-aware editing

- The role editor only offers permissions valid for the role's **scope**. A
  platform role can hold platform permissions; an Edir role cannot.
- Only a **Super Admin** can grant platform/cross-tenant permissions.
- Server-side validation strips any permission that doesn't belong to a role's scope
  — you cannot smuggle platform powers into an Edir role.

### Reading the matrix

| Cue | Meaning |
|-----|---------|
| **Action columns** | Read, Create, Update, Delete, Approve, Reject, Export, Import, Assign, Revoke, Cancel, Reschedule, Settings, Reports, etc. |
| **Dangerous flag (red)** | High-blast-radius permissions: `super_admin`, and any delete/remove/revoke/void/suspend, plus `waive_penalty`. |
| **Checker permission** | `approve_*`, `reject_*`, `finalize_attendance`, `review_member_documents` — the approving half of maker–checker. |
| **Umbrella permission** | e.g. `manage_members`, `manage_edirs` — grants all fine-grained actions in that module. |

### Guidance

- **Least privilege.** Grant only what a role needs.
- **Separate maker and checker.** Don't put both halves of a maker–checker pair on
  one heavily-used role for the same person.
- **Reserve `super_admin`.** Grant it to as few accounts as possible.
- **Backfill after changes.** When permission sets change platform-wide, review
  existing roles so they gain/lose capabilities as intended.

---

## 14. The Approvals Center for governance

**Page:** Operations → Approvals Center · **Access:** `view_approvals` plus a
governance checker permission.

For platform administrators the Approvals Center surfaces **org-governance**
requests routed to your scope:

| Module | Checker permission | Who can review |
|--------|--------------------|----------------|
| **Edir Registration** | `approve_edir_registration` | Org users whose unit covers the Edir's branch. |
| **Edir Update** | `approve_edir_update` | Same as above. |
| **User Creation** | `approve_user_creation` | Per configuration. |

Approve, reject, return, or comment exactly as described in
[Section 9](#9-the-edir-registration-approval-workflow). Governance requests are
scoped so you only see Edirs within your org unit (Super Admins see all).

> **Note.** Edir **operational** approvals (payments, emergencies, assets, etc.) are
> intentionally **not** shown to organizational staff — they can only be handled by
> the Edir's own users. This preserves tenant autonomy while keeping lifecycle
> governance centralized.

---

## 15. Dashboards and reporting

Two scope dashboards give aggregated views:

| Dashboard | Permission | Shows |
|-----------|-----------|-------|
| **Branch dashboard** | `view_branch_dashboard` | Analytics scoped to a single branch. |
| **District dashboard** | `view_district_dashboard` | Analytics summed across a district's branches. |

Cross-Edir reporting is available with `view_edir_reports`. Use **date-range
filters** to focus any dashboard on a period. Combine dashboards with the **Audit
Log** and **Payment Log** for governance reviews.

---

## 16. Audit log

**Page:** Governance → Audit Log · **Access:** `view_audit_log` /
`manage_audit_log`

The audit log records significant actions across the platform — Edir lifecycle
events, approvals, user/role changes, and more — each with the actor, target,
timestamp, and details. There is also a dedicated **Security Log** capturing
authentication and security events (sign-ins, lockouts, password changes, suspicious
activity) with severity levels.

- Filter by action, actor, target, and date range to investigate incidents.
- With `manage_audit_log` you can archive and export entries for retention.

> **Compliance tip.** Establish a periodic review cadence (e.g. monthly) of the
> audit and security logs, and export/archive per your data-retention policy.

---

## 17. Payments and the NIB integration

NibTera Edir integrates with the **NIB Super App** for member payments. As a
platform administrator you should understand the flow to support Edirs and reconcile
issues.

### How a mini-app payment works

1. A member opens the payment page **inside the NIB Super App**, which passes a
   session **token**.
2. The platform **validates the token** against NIB's authentication endpoint and
   establishes a secure session bound to the member's phone.
3. The member's obligations are fetched; the member confirms an amount.
4. The platform requests a **payment token** from NIB, records a **payment intent**
   binding the transaction to the beneficiary member and Edir, and hands the token
   back to the Super App.
5. The Super App authorizes the debit; NIB calls back the platform's **callback
   endpoint**, which **settles** the transaction — atomically creating the final
   payment record against the beneficiary member.
6. The member's screen updates in **real time** via server-sent events, with a
   fallback status poll.

### Tenancy of payments

Payments are routed to the **beneficiary member's Edir account number**. The Edir
must be **ACTIVE** with a configured account, or the payment is blocked. This
ensures funds always reach the correct Edir, even when someone pays on another
member's behalf.

### Payment records and reconciliation

- The **Payment Log** (per Edir) is the source of truth for transactions.
- Each transaction has a unique **transaction ID / reference**, method, status,
  and an optional signed receipt.
- Payment signatures are protected using an encryption key (see
  [Appendix B](#appendix-b--environment-variables)).

⚠ **Configuration accuracy is critical.** The NIB endpoint URLs, account numbers,
payment key, and callback URL must be correct for settlement to work. Verify these
per environment ([Appendix B](#appendix-b--environment-variables)).

---

## 18. Security and compliance

NibTera Edir ships with defense-in-depth. Platform administrators are responsible
for operating these controls correctly.

### Authentication and passwords

| Control | Behaviour |
|---------|-----------|
| **Password policy** | ≥8 chars; upper, lower, number, special (`!@#$%^&*`); rejected if found in known breach lists. |
| **Mandatory first-login change** | Seeded/invited accounts must change their temporary password before reaching any feature. |
| **Two-factor authentication** | Available per account for an extra verification step. |
| **Account lockout** | Repeated failed sign-ins temporarily lock the account; administrators can unlock. |
| **New-login alerts** | Users are emailed when a new session starts while another is active. |

### Sessions

| Control | Value |
|---------|-------|
| **Idle timeout** | 30 minutes of inactivity ends the session. |
| **Absolute session cap** | 8 hours maximum from sign-in. |
| **Token versioning** | Password changes and security events invalidate existing sessions. |

### Route and data protection

- **Route-level permission enforcement** — the middleware blocks any dashboard page
  a user's permissions don't allow, redirecting to an access-denied screen.
- **Tenant isolation** — all data access is scoped to the actor's accessible Edirs;
  cross-tenant reads/writes are asserted against the actor's scope.
- **Security headers** — strict Content-Security-Policy (with per-request nonces),
  HSTS, `X-Content-Type-Options`, a restrictive `Permissions-Policy`, and
  clickjacking protection.
- **Framing** — only the public payment/portal routes are framable, and only from
  the **trusted origins** you configure (`FRAME_ANCESTORS`); everything else is
  `DENY`.

### Compliance practices

- Review the **audit** and **security** logs regularly.
- Enforce **least privilege** and **segregation of duties** in role design.
- Rotate secrets and credentials per policy.
- Keep the **agreement documents** for each Edir on file (uploaded at registration).

---

## 19. System configuration and deployment

> This section is for administrators who also handle deployment. If your
> organization separates these duties, coordinate with your DevOps/IT team.

### Technology overview

| Layer | Technology |
|-------|-----------|
| Application | Next.js 15 (React 19), TypeScript |
| Data | PostgreSQL via Prisma ORM |
| Authentication | NextAuth (credentials) |
| Email | SMTP via Nodemailer |
| Payments | NIB Super App REST integration |

### Standard operations

| Operation | Command / action |
|-----------|------------------|
| Install dependencies | `npm install` |
| Apply database schema | `npx prisma migrate deploy` (or `prisma db push` in dev) |
| Seed initial data | `npm run prisma:seed` (creates the first Super Admin) |
| Build for production | `npm run build` |
| Start (production) | `npm start` (serves on port 3020) |
| Type-check | `npm run typecheck` |

⚠ **The running server is a production build.** Source changes only appear after a
**rebuild and restart** — verify fixes against a freshly built instance, not the
already-running server.

⚠ **Never run `npm audit fix --force`** — it downgrades authentication dependencies
and breaks sign-in.

---

## 20. Operational best practices

- **Model the hierarchy before onboarding Edirs** — create districts and branches
  first so registrations attach cleanly.
- **Keep at least two governance checkers per org unit** so registrations aren't
  blocked by the "can't approve your own" rule.
- **Appoint an Edir Admin immediately after activation** so tenants become
  self-sufficient.
- **Revoke, don't delete**, functioning Edirs — preserve history.
- **Audit roles quarterly**, especially holders of `super_admin` and dangerous
  permissions.
- **Validate NIB configuration per environment** before go-live and after any change.
- **Establish log-review and secret-rotation schedules**.
- **Back up the database** on a defined cadence and test restores.

---

## 21. Troubleshooting

| Problem | Likely cause / fix |
|---------|-------------------|
| **A branch/district won't delete** | It still has children (branches/Edirs) or dependent records. Empty it first. |
| **A registration can't be approved** | The approver is the maker, lacks `approve_edir_registration`, or the Edir's branch is outside their org scope. |
| **A newly activated Edir has no admin** | Appoint one via **User Associations** and assign the Edir Admin role. |
| **Members can't pay for an Edir** | The Edir isn't **ACTIVE** or has no configured **account number**. Fix the profile/status. |
| **Payments don't settle** | Check NIB endpoint URLs, payment key, account number, and the callback URL for the environment. |
| **A user is locked out** | Unlock via Platform Users (`unlock_user`) or wait out the lockout window. |
| **Sign-in broke after a dependency update** | Someone likely ran `npm audit fix --force`. Restore the correct auth dependency versions and rebuild. |
| **A permission change didn't take effect** | Existing roles may need backfilling; confirm the role actually carries the new permission and the user re-authenticated. |
| **A source fix isn't visible** | The server is running a prior build — rebuild and restart. |

---

## 22. Frequently asked questions

**What's the difference between Super Admin and Head Office?**
Super Admin is unrestricted across the whole platform and manages tenants, users,
roles, and governance. Head Office is a scoped governance role covering all
districts/branches but bound by the permission model.

**Why don't I see an Edir's payment/member pages as a Super Admin?**
By default Super Admins manage the platform, not individual Edir operations. Use the
top-bar Edir switcher and the **"Edir Pages"** group to drill in when needed.

**Who approves an Edir's registration?**
An organizational user (Branch/District/Head Office) with
`approve_edir_registration` whose scope covers the Edir's branch — never the person
who submitted it.

**Can I grant an Edir Admin the ability to manage other Edirs?**
No — that requires platform permissions, which only a Super Admin can grant and
which never appear in Edir-scoped roles.

**How do I stop an Edir temporarily?**
Revoke it (suspend/close). Deletion is only for empty Edirs and is permanent.

**Is `manage_edir_settings` a platform permission?**
No. It's Edir-scoped (fees, penalties, branding). Platform admins govern the Edir
lifecycle, not its internal financial policies.

---

## Appendix A — Platform permission reference

Platform/cross-tenant permissions — **grantable only by a Super Admin**:

| Area | Permissions |
|------|-------------|
| **Edir lifecycle** | `view_edir`, `manage_edirs`, `create_edir`, `edit_edir`, `revoke_edir`, `delete_edir`, `view_edir_reports` |
| **Edir governance approvals** | `approve_edir_registration`, `approve_edir_update` |
| **Cross-Edir user management** | `manage_edir_users`, `manage_edir_associations`, `manage_associations` |
| **Districts** | `view_districts`, `manage_districts`, `create_district`, `edit_district`, `delete_district`, `import_districts` |
| **Branches** | `view_branches`, `manage_branches`, `create_branch`, `edit_branch`, `delete_branch`, `import_branches` |
| **Master switch** | `super_admin` |

Scope dashboards: `view_branch_dashboard`, `view_district_dashboard`.
Registration (maker): `register_edir`. User-creation approval: `approve_user_creation`.

> Edir-scoped permissions (member, payment, emergency, event, asset, rules,
> document, settings, and per-Edir user/role management) are listed in Appendix A of
> the *Edir Administrator Manual*.

---

## Appendix B — Environment variables

Key configuration values (set per environment; never commit secrets to source):

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | PostgreSQL connection string. |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Seed the initial Super Admin (password otherwise generated once at seed time). |
| `SIGNATURE_ENCRYPTION_KEY` | **Required.** Encrypts payment signatures (no fallback — the app requires it). |
| `FRAME_ANCESTORS` | Space-separated list of trusted origins allowed to embed the public pay/portal pages. |
| `NIB_VALIDATE_TOKEN_URL` | NIB endpoint to validate a Super App session token. |
| `NIB_PAYMENT_URL` | NIB endpoint to obtain a payment token. |
| `NIB_CHECK_STATUS_URL` | NIB endpoint to check transaction status. |
| `NIB_CALLBACK_URL` | Public URL NIB calls back to settle a transaction. |
| `NIB_ACCOUNT_NO` | Default/institution account number. |
| `NIB_COMPANY_NAME` | Company name shown in the payment flow. |
| `NIB_PAYMENT_KEY` | Secret key for the NIB payment integration. |
| `EMAIL_FROM` / SMTP settings | Outbound email sender and transport. |

⚠ `SIGNATURE_ENCRYPTION_KEY` is **mandatory** — the application will not operate
without it. Configure it before deployment.

---

## 25. Glossary

| Term | Definition |
|------|------------|
| **Multi-tenant** | One deployment serving many isolated Edirs (tenants). |
| **Tenant** | A single Edir's isolated data space. |
| **Scope** | How far a role reaches (Super Admin, Platform, Head Office, District, Branch, Edir). |
| **District / Branch** | Organizational units; an Edir attaches to a branch, which belongs to a district. |
| **Org-governance module** | An approval (Edir registration/update) routed up the org hierarchy. |
| **Edir operational module** | An approval handled only by the Edir's own users. |
| **Maker / Checker** | Submitter / approver in the two-person workflow. |
| **Association** | The link between a user account and the Edir/org unit they work in. |
| **Payment intent** | A record binding a mini-app transaction to the beneficiary member and Edir before settlement. |
| **Settlement** | Finalizing a payment when NIB calls back, creating the definitive payment record. |
| **Super Admin** | The unrestricted, cross-tenant platform administrator. |
| **Audit log / Security log** | Records of significant actions / security events. |

---

*For running an individual Edir, see the **[Edir Administrator Manual](./EDIR_MANUAL.md)**.
For the member payment experience, see the **[User Manual](./USER_MANUAL.md)**.*
