# NibTera Edir — Edir Administrator Manual

**For Edir Administrators, treasurers, secretaries, and committee members**

---

<table>
<tr><td><b>Product</b></td><td>NibTera Edir — Edir Management Platform</td></tr>
<tr><td><b>Document</b></td><td>Edir Administrator Manual</td></tr>
<tr><td><b>Version</b></td><td>1.0</td></tr>
<tr><td><b>Audience</b></td><td>Edir Administrators and staff who operate a single Edir</td></tr>
<tr><td><b>Last updated</b></td><td>2 July 2026</td></tr>
<tr><td><b>Classification</b></td><td>Internal / Operational</td></tr>
</table>

---

## Table of contents

1. [Introduction](#1-introduction)
2. [Roles inside an Edir](#2-roles-inside-an-edir)
3. [Getting started](#3-getting-started)
4. [Navigating the workspace](#4-navigating-the-workspace)
5. [The maker–checker principle](#5-the-makerchecker-principle)
6. [Dashboard](#6-dashboard)
7. [Members](#7-members)
8. [Payments and contributions](#8-payments-and-contributions)
9. [Approvals Center](#9-approvals-center)
10. [Emergencies](#10-emergencies)
11. [Events and attendance](#11-events-and-attendance)
12. [Assets](#12-assets)
13. [Rules and bylaws](#13-rules-and-bylaws)
14. [Documents](#14-documents)
15. [Member requests and grievances](#15-member-requests-and-grievances)
16. [Committee oversight](#16-committee-oversight)
17. [Edir settings](#17-edir-settings)
18. [Users and roles within your Edir](#18-users-and-roles-within-your-edir)
19. [Audit log and payment log](#19-audit-log-and-payment-log)
20. [Notifications](#20-notifications)
21. [Best practices](#21-best-practices)
22. [Troubleshooting](#22-troubleshooting)
23. [Frequently asked questions](#23-frequently-asked-questions)
24. [Appendix A — Edir permission reference](#appendix-a--edir-permission-reference)
25. [Glossary](#25-glossary)

---

## 1. Introduction

As an **Edir Administrator**, you run the day-to-day operations of your Edir on the
NibTera Edir platform. This manual covers every operational module you'll use:
managing members and their families, recording and reconciling payments, processing
emergency benefit claims, running events and attendance, tracking shared assets,
maintaining rules and documents, and configuring your Edir's financial policies.

NibTera Edir is **multi-tenant**: many Edirs share the same platform, but your data
is strictly isolated. You only ever see and act on **your own Edir** unless you
have been granted a broader organizational role (covered in the *Platform
Administrator Manual*).

A defining feature of the platform is that **every sensitive action requires a
second person to approve it** — the maker–checker workflow. Understanding this
([Section 5](#5-the-makerchecker-principle)) is essential to operating smoothly.

---

## 2. Roles inside an Edir

When an Edir is created, three default roles are provisioned. You can customize
them and add your own ([Section 18](#18-users-and-roles-within-your-edir)).

| Default role | Typical holder | Capabilities |
|--------------|----------------|--------------|
| **Edir Admin** | Chairperson / manager | Full operational control of the Edir: all member, payment, emergency, event, asset, rules, document, settings, and user/role management **within the Edir**. Does **not** include platform-wide (cross-Edir) powers. |
| **Committee (Oversight)** | Audit / oversight committee | **Read-only** visibility into members, payments, approvals, documents, logs, and the oversight dashboard. Cannot change data. |
| **Member** | Ordinary member | Basic access (view dashboard); primarily uses the payment mini-app and self-service requests. |

> **Note.** Roles are **collections of permissions**. Two people can share a role
> (for example, two "Edir Admin" users acting as maker and checker for each other),
> or you can create fine-grained roles such as "Treasurer" (payments only) or
> "Secretary" (members and events only). See [Appendix A](#appendix-a--edir-permission-reference).

### Maker vs. checker

Because no one may approve their own submission, an Edir needs **at least two
people** who can act on any workflow: one to **submit** (maker) and another to
**approve** (checker). Plan role assignments so that critical modules always have a
second approver available.

---

## 3. Getting started

### Signing in

1. Open the NibTera Edir sign-in page.
2. Enter your **email** and **password** and select **Sign in**.
3. On your **first login** you'll be required to change a temporary password. Your
   new password must be at least 8 characters and include an uppercase letter, a
   lowercase letter, a number, and a special character (`!@#$%^&*`), and must not
   appear in known breach lists.

> **Session security.** You'll be signed out automatically after **30 minutes of
> inactivity** or **8 hours** after signing in. Repeated failed sign-ins temporarily
> lock the account.

### First-run checklist for a new Edir

If your Edir was just activated, complete these steps in order:

1. **Configure Edir Settings** — fees, currency, due day, grace period, and penalty
   rules ([Section 17](#17-edir-settings)).
2. **Set up roles and invite staff** — ensure you have at least a maker and a
   checker ([Section 18](#18-users-and-roles-within-your-edir)).
3. **Define emergency types** — the benefit categories your Edir supports
   ([Section 10](#10-emergencies)).
4. **Add asset categories and assets** if your Edir lends equipment
   ([Section 12](#12-assets)).
5. **Publish your Rules & Bylaws** ([Section 13](#13-rules-and-bylaws)).
6. **Register members** and, where needed, issue member logins
   ([Section 7](#7-members)).

---

## 4. Navigating the workspace

The left sidebar groups pages into sections. You only see the pages your role
permits:

| Section | Pages |
|---------|-------|
| **Main** | Dashboard |
| **Operations** | Members, Payments, Approvals Center, Emergencies, Events, Assets, Member Requests |
| **Governance** | Rules & Bylaws, Committee Oversight, Documents, Audit Log, Payment Log |
| **Administration** | Platform Users (scoped to your Edir), Roles, Edir Settings |

A **top bar** provides search, the notification bell, and your account menu. Lists
throughout the app support **searching, filtering, date-range filtering, and CSV
export** where your role allows.

---

## 5. The maker–checker principle

Every sensitive operation is routed through a **two-person approval workflow**. The
person who submits a request (**maker**) can never approve it — a different
authorized person (**checker**) must review it.

### The lifecycle

```
Draft ─► Pending ─►┬─► Approved ─► Closed (the change is applied)
                   ├─► Rejected (the change is discarded)
                   └─► Returned ─► (maker revises) ─► Pending …
```

| State | Meaning |
|-------|---------|
| **Pending** | Submitted and awaiting a checker. |
| **Approved / Closed** | A checker approved it; the underlying change was applied within a single transaction, audited, and the maker was notified. |
| **Rejected** | A checker declined it; nothing changes. A reason is recorded. |
| **Returned** | A checker sent it back for revision. The maker can amend and resubmit. |

### What is protected by maker–checker

| Module | Maker action | Checker permission needed to approve |
|--------|--------------|--------------------------------------|
| Manual Payment | Record a payment | `approve_payment` |
| Penalty Waiver | Request a waiver | `approve_penalty_waiver` |
| Member Removal | Request removal | `approve_member_removal` |
| Emergency Claim | Report a claim | `approve_emergency_claim` |
| Emergency Disbursement | Request a disbursement | `approve_emergency_disbursement` |
| Asset Issuance / Return | Issue or return an asset | `approve_asset_issuance` |
| Rule Change | Propose a rules change | `approve_rule_change` |
| Document Action | Upload/edit/delete/share/etc. a document | `approve_document` |
| Relative Document | Upload/change a relative's document | `review_member_documents` |
| Relationship Category | Add/change a relationship category | `manage_edir_settings` |

> **Note.** These operational approvals can be handled **only by users of your own
> Edir**. (Edir *registration* and profile *updates* are different — those are
> reviewed by organizational staff above the Edir; see the *Platform Administrator
> Manual*.)

All approvals surface in the **Approvals Center** ([Section 9](#9-approvals-center)).

---

## 6. Dashboard

The dashboard gives you an at-a-glance view of your Edir's health. Depending on
your configuration and role it can include:

- **Membership** totals by status (active, inactive, suspended, terminated).
- **Contributions** collected, outstanding balances, and collection trends.
- **Pending approvals** waiting for you.
- **Emergencies** in progress.
- **Upcoming events**.

Use the **date-range filter** to focus figures on a specific period.

---

## 7. Members

**Page:** Operations → Members · **Access:** `view_members` / `manage_members`

The Members page is the register of everyone who belongs to your Edir.

### The member record

Each member has:

- **Personal details** — name, photo, date of birth, gender, national ID, occupation.
- **Contact** — phone, email, address (city, subcity, woreda).
- **Emergency contact** — name and phone.
- **Membership** — member ID (`EDR-YYYY-NNNN`), role, status, join date.
- **Payment status** — balance, months paid, total paid, standing.
- **Relatives** — family members and beneficiaries.
- **Documents** — supporting files.

### Member statuses

| Status | Meaning |
|--------|---------|
| **Active** | In good standing. |
| **Inactive** | Not currently participating; may owe arrears. |
| **Suspended** | Temporarily suspended (often for prolonged non-payment). |
| **Terminated** | Membership ended. |

### Common tasks

| Task | Permission | Notes |
|------|-----------|-------|
| **Add a member** | `create_member` | Assigns the next member ID automatically. |
| **Edit a member** | `edit_member` | Update personal/contact details. |
| **Suspend a member** | `suspend_member` | For non-payment or policy breaches. |
| **Reinstate a member** | `reinstate_member` | Reactivate; a reinstatement fee may apply per your settings. |
| **Approve a member** | `approve_member` | Approve pending membership applications. |
| **Manage relatives** | `manage_relatives` | Add/edit/remove relatives and beneficiaries. |
| **Manage documents** | `manage_documents` | Upload/delete member and relative documents. |
| **Review relative documents** | `review_member_documents` | Approve/reject documents attached to relatives (checker). |
| **Remove a member** | `remove_members` → `approve_member_removal` | **Maker–checker.** Removal is requested, then approved by a second person. |
| **Export members** | `export_members` | Download the member list as CSV. |

### Adding a member — step by step

1. Go to **Members** and select **Add Member**.
2. Complete personal, contact, and emergency-contact details.
3. Set the **membership role** and (if applicable) a **registration installment
   count** to spread the registration fee.
4. Save. The member is created with an auto-generated member ID and an initial
   payment status.

### Relatives and beneficiaries

Open a member and use the **Relatives** tab to record family members. For each
relative you can capture the relationship, whether they are a **dependent**, and
whether they are a **beneficiary** (with an optional benefit share percentage).
Relationship types are drawn from your Edir's **Relationship Categories**
([Section 17](#17-edir-settings)).

Documents attached to relatives (e.g. a birth certificate) go through the
**relative-document review** workflow — uploaded as pending, then approved by a
user with `review_member_documents`.

### Removing a member (maker–checker)

1. Open the member and choose **Request Removal** (needs `remove_members`).
2. Provide a reason. A removal request is created and appears in the Approvals
   Center.
3. A different user with `approve_member_removal` reviews and approves or rejects.

⚠ Member removal is a governed, irreversible action once approved. Prefer
**suspension** for temporary situations.

---

## 8. Payments and contributions

**Page:** Operations → Payments · **Access:** `view_payments` / `record_payment`

Most contributions arrive automatically through the **NIB Super App** (see the
*User Manual*). This page is for **manual reconciliation** and handling arrears,
penalties, and cash/bank payments.

### How payments are applied

A payment is always allocated in this order:

1. **Penalties** (late fees, event absence, asset compensation, reinstatement fee)
2. **Installments** (e.g. registration fee parts)
3. **Monthly contribution**

This ensures charges are cleared before regular dues, and it drives the member's
**coverage** (paid-through month).

### Payment statuses

| Status | Meaning |
|--------|---------|
| **Success** | Fully settled. |
| **Partial** | Part of the amount settled. |
| **Pending** | In progress / awaiting settlement. |
| **Failed** | Did not complete. |
| **Void** | Cancelled/reversed. |

### Recording a manual payment (maker–checker)

1. Select **Record Payment** (needs `record_payment`).
2. Choose the member, enter the amount and method (Cash, Bank, etc.), and add a
   note or reference.
3. Submit. This creates a **Manual Payment** approval request.
4. A different user with `approve_payment` reviews and approves it. Only then is the
   payment posted to the member's account.

### Penalty waivers (maker–checker)

If a penalty should be forgiven:

1. Select **Waive Penalty** on the relevant charge (needs `waive_penalty`).
2. Provide a justification and submit.
3. A user with `approve_penalty_waiver` approves it. The penalty is then cleared.

### Voiding a payment

Use **Void Payment** (needs `void_payment`) to reverse an erroneous transaction.
Voids are audited and hidden from members' history so they aren't mistaken for real
payments.

### Installment plans

For large one-time amounts (typically the registration fee), a member can be placed
on an **installment plan**. The plan defines the total and a schedule of dated
installments; each is marked paid as contributions come in. Members see their
installment progress in the payment mini-app.

### Exporting

Use **Export Payments** (needs `export_payments`) to download the payment log as
CSV for offline reconciliation or reporting. Apply date-range and status filters
first to scope the export.

---

## 9. Approvals Center

**Page:** Operations → Approvals Center · **Access:** `view_approvals` (or any
checker permission)

The Approvals Center is the single queue for **everything awaiting approval** in
your Edir. You'll only see requests for modules your role can check.

### Working the queue

1. Open **Approvals Center**. Requests are listed with module, title, submitter,
   and age.
2. Select a request to open its **detail view**, which shows the full payload, the
   maker's comments, and the complete event history.
3. Choose an action:

| Action | Effect |
|--------|--------|
| **Approve** | Applies the change immediately (in one transaction), records it, and notifies the maker. |
| **Reject** | Declines the request with a reason; nothing changes. |
| **Return** | Sends it back to the maker for revision with notes. |
| **Comment** | Adds a note without deciding, for discussion. |

⚠ **You cannot approve your own submission.** If you are the maker, the action
buttons are disabled and a message explains why. Arrange for a colleague to check
your requests.

> **Note.** When a request is approved, the platform runs the real downstream
> action (e.g. posting the payment, activating the change) atomically — either it
> all succeeds or none of it does — then writes an audit entry and notifies the
> maker. There is a companion **Approvals Tracker** for following the progress of
> requests you have submitted.

---

## 10. Emergencies

**Page:** Operations → Emergencies · **Access:** `view_emergencies` /
`manage_emergencies`

This module handles the core purpose of an Edir: providing benefits when members
face hardship.

### Emergency types (benefit catalog)

Before processing claims, define the **emergency types** your Edir supports. Each
type configures:

| Setting | Purpose |
|---------|---------|
| **Name & description** | e.g. "Death in Family", "Serious Illness". |
| **Base payout** | The standard benefit amount. |
| **Relationship payouts** | Optional per-relationship amounts (e.g. spouse vs. parent). |
| **Documentation required** | Whether supporting documents are mandatory, and which. |
| **Requires approval** | Whether claims of this type must be approved. |
| **Waiting period (days)** | Delay before a claim can be made. |
| **Eligibility months** | Minimum membership tenure before a member can claim. |
| **Active** | Whether the type is currently offered. |

### The claim lifecycle

```
Reported ─► (approve claim) ─► Active/Approved ─► (request disbursement)
        ─► (approve disbursement) ─► Resolved
Reported ─► (reject) ─► Rejected
```

| Status | Meaning |
|--------|---------|
| **Reported** | A claim has been logged. |
| **Pending / Active** | Under review or approved for benefit. |
| **Resolved** | Benefit disbursed and closed. |
| **Rejected** | Declined. |

### Processing a claim — step by step

1. **Report the claim** (needs `report_emergency`): select the member, emergency
   type, affected person, date, location, priority, and attach documents. This is a
   **maker** action.
2. A checker with `approve_emergency_claim` **approves** the claim (or `reject_emergency`
   to decline), setting the **approved amount**.
3. **Request disbursement** (needs `request_disbursement`) — a maker requests that
   the approved amount be paid out, attaching disbursement receipts as needed.
4. A checker with `approve_emergency_disbursement` **approves the disbursement**,
   recording the disbursed amount and closing the claim.

> **Note.** Separating **claim approval** from **disbursement approval** provides
> two independent control points over money leaving the Edir. Both are maker–checker.

Use **Export Emergencies** (needs `export_emergencies`) to download claims as CSV.

---

## 11. Events and attendance

**Page:** Operations → Events · **Access:** `view_events` / `manage_events`

Edirs hold gatherings — some mandatory. This module schedules events and tracks
attendance, applying absence penalties where configured.

### Creating an event

1. Select **Create Event** (needs `manage_events`).
2. Enter the title, date/time, and location.
3. If attendance is compulsory, enable **Attendance required** and set an **absence
   penalty** amount.
4. Save. The event is **Scheduled**.

### Managing events

| Task | Permission | Notes |
|------|-----------|-------|
| **Reschedule** | `reschedule_event` | Change date/time. |
| **Cancel** | `cancel_event` | Cancel a scheduled event. |
| **Finalize attendance** | `finalize_attendance` | Mark who was present/absent and apply penalties. |
| **Export** | `export_events` | Download events as CSV. |

### Attendance and penalties

Invite members to an event and, after it takes place, record each participant's
status: **Invited, Attending, Declined, Present, Absent, Excused**. When you
**finalize attendance**, absence penalties are applied to members marked absent
(unless excused). Those penalties then appear on the member's balance and in the
payment mini-app.

⚠ **Finalizing attendance is a control action** — review the present/absent list
carefully before finalizing, because it creates charges against members.

---

## 12. Assets

**Page:** Operations → Assets · **Access:** `view_assets` / `manage_assets`

Track shared equipment the Edir lends to members (tents, chairs, cooking pots,
etc.), including loss/damage compensation.

### Setup

1. Create **asset categories** (needs `manage_asset_categories`), e.g. "Tents &
   Shelter", "Kitchen & Catering".
2. Add **assets** (needs `create_asset`): name, category, quantity, purchase and
   current value, condition, location, and **compensation cost** (charged if lost
   or damaged).

### Issuing and returning (maker–checker)

| Step | Permission | Result |
|------|-----------|--------|
| **Issue to a member** | `issue_asset` (maker) → `approve_asset_issuance` (checker) | On approval, the asset is issued and available quantity reduced. |
| **Return an asset** | `return_asset` (maker) → `approve_asset_issuance` (checker) | On approval, the return is recorded; condition is captured. |

### Issuance statuses

| Status | Meaning |
|--------|---------|
| **Requested** | Issuance/return submitted, awaiting approval. |
| **Approved / Issued** | Approved and handed out. |
| **Returned** | Returned in acceptable condition. |
| **Compensation pending** | Lost/damaged — compensation charge outstanding. |
| **Closed** | Fully settled. |

If an asset is returned damaged or not returned, a **compensation charge** is added
to the member's balance based on the asset's compensation cost.

Use **Export Assets** (needs `export_assets`) for inventory/issuance reports.

---

## 13. Rules and bylaws

**Page:** Governance → Rules & Bylaws · **Access:** `view_rules` / `manage_rules`

Your Edir's official rules are maintained here as a **versioned document** — there
is exactly one live (approved) version at a time, with full history.

### Versions and their states

| State | Meaning |
|-------|---------|
| **Draft** | Being edited; pending approval is represented by an open request. |
| **Approved** | The current, member-visible version. |
| **Archived** | A previously approved version kept for history. |

### Proposing a rules change (maker–checker)

1. Create or edit a **draft** version (needs `manage_rules`), including a **change
   summary** and effective date, and attach supporting files if needed.
2. Submit it for approval. This creates a **Rule Change** request.
3. A user with `approve_rule_change` reviews and approves it.
4. On approval, the new version becomes the live **Approved** version, the previous
   one is **Archived**, and members see the update.

> **Note.** Rules content supports rich text and is sanitized for safety. Keep a
> clear change summary on every version so members and auditors understand what
> changed and why.

---

## 14. Documents

**Page:** Governance → Documents · **Access:** `view_documents` / `upload_document`
/ `approve_document`

A centralized document repository for governance and administrative files
(agreements, minutes, financial statements, policies). Every sensitive document
action is governed by maker–checker.

### Document lifecycle

| Status | Meaning |
|--------|---------|
| **Draft** | Being prepared. |
| **Pending** | Submitted, awaiting approval. |
| **Approved** | Live and visible per its visibility setting. |
| **Rejected** | Declined with a reason. |
| **Archived** | Retired but retained. |

### Visibility

Each document has a visibility level controlling who can see it:

- **Staff** — operational staff only.
- **Committee** — committee/oversight roles.
- **All** — all appropriate roles.

### Maker actions (each routed through approval)

| Action | Permission |
|--------|-----------|
| Upload | `upload_document` |
| Edit | `edit_document` |
| Classify (category/tags) | `classify_document` |
| Share / change visibility | `share_document` |
| Archive | `archive_document` |
| Delete | `delete_document` |

### Checker actions

| Action | Permission |
|--------|-----------|
| Open the review queue | `review_document` |
| Approve | `approve_document` |
| Reject | `reject_document` |
| Revoke shared access | `revoke_document_access` |

**To upload a document:** choose **Upload**, provide a title, category, tags,
purpose, visibility, and the file (image/PDF/other). It stays **Pending** until a
checker approves it. Use **Export Documents** (`export_documents`) to download
document metadata.

---

## 15. Member requests and grievances

**Page:** Operations → Member Requests · **Access:** `handle_member_requests`

Members submit self-service requests (see the *User Manual*). Staff triage and
resolve them here.

### Request types

| Type | Typical follow-up |
|------|-------------------|
| **Relative** | Add/update a relative — may feed into member records. |
| **Emergency** | Start a formal emergency claim ([Section 10](#10-emergencies)). |
| **Asset** | Issue an asset ([Section 12](#12-assets)). |
| **Grievance** | Investigate and respond to a complaint. |
| **Feedback** | Acknowledge and log suggestions. |

### Handling a request

1. Open a request to see the member, subject, description, attachments, and
   type-specific details.
2. Move it through its states: **Pending → In review → Approved / Rejected /
   Resolved**.
3. Write a **response** to the member and, where relevant, convert it into the
   appropriate operational workflow (claim, issuance, etc.).
4. The member is notified automatically of status changes.

Use **Export Requests** (`export_member_requests`) to download requests/grievances
as CSV.

---

## 16. Committee oversight

**Page:** Governance → Committee Oversight · **Access:** `view_committee_oversight`

A **read-only** dashboard for oversight and audit committee members. It aggregates
membership, financial, and governance indicators so the committee can monitor the
Edir's health **without the ability to change any data**. Pair this with the
**Audit Log** and **Payment Log** for full transparency.

---

## 17. Edir settings

**Page:** Administration → Edir Settings · **Access:** `manage_edir_settings` /
`manage_committee`

This is where you configure your Edir's financial and operational policies. These
settings drive penalties, coverage, reminders, and eligibility across the whole
platform — including what members see in the payment mini-app.

### Financial settings

| Setting | Description |
|---------|-------------|
| **Monthly fee** | The standard monthly contribution. |
| **Registration fee** | One-time joining fee (can be split into installments). |
| **Currency** | Defaults to ETB. |
| **Due day** | Day of the month contributions are due. |
| **Grace period (days)** | Days after the due date before penalties start. |
| **Reinstatement fee** | Charged to reactivate a suspended/inactive member. |
| **Emergency reserve / Operating fund** | Tracked fund balances for governance. |

### Penalty configuration

NibTera Edir supports two complementary penalty mechanisms:

1. **Penalty tiers** — bands based on how many days late a payment is. Each tier is
   **Fixed** (a set amount) or **Percent** (of the balance). Example:

   | Tier | Days late | Type | Value |
   |------|-----------|------|-------|
   | 1 | 6–15 | Fixed | 25 ETB |
   | 2 | 16–30 | Fixed | 50 ETB |
   | 3 | 31+ | Percent | 5% |

2. **Daily penalty accrual** (optional) — a penalty that grows each day past the
   grace window. Configure the **type** (Fixed per day / Percent per day), the
   **value**, and an optional **maximum number of accruing days**.

### Membership lifecycle automation

| Setting | Effect |
|---------|--------|
| **Auto-suspend enabled / after N months** | Automatically suspend members who fall N months behind. |
| **Auto-terminate enabled / after N months** | Automatically terminate members who fall further behind. |
| **Minimum membership months** | Tenure required before a member is eligible for benefits. |

### Reminders

| Setting | Effect |
|---------|--------|
| **Auto-reminder enabled** | Turn payment reminders on/off. |
| **Reminder days before** | A list of days before the due date to send reminders (e.g. 7, 3, 1). |

### Member roles and relationship categories

- **Member roles** — configure the role labels available for members (e.g. Member,
  Chairperson, Treasurer).
- **Relationship categories** — the family relationship types used across the app
  (Spouse, Child, Parent, etc.). Each category configures benefit/emergency
  eligibility, required documents, and a maximum number of dependents. Changes go
  through a maker–checker workflow (`manage_edir_settings`).

### Committee management

With `manage_committee` you can invite, assign roles to, and remove committee
members who hold oversight responsibilities.

⚠ **Settings changes affect money.** Adjusting fees or penalty rules changes what
members owe going forward. Communicate significant changes to members, ideally via
a rules update.

---

## 18. Users and roles within your Edir

### Platform Users (scoped to your Edir)

**Page:** Administration → Platform Users · **Access:** `view_users` /
`manage_users`

Here you manage the **staff/operator accounts** for your Edir — the people who log
in to run operations (not ordinary members, who live on the Members page).

| Task | Permission |
|------|-----------|
| View user accounts | `view_users` |
| Invite / edit / deactivate users | `manage_users` |
| Reset a user's password | `reset_password` |
| Lock a user account | `lock_user` |
| Unlock a user account | `unlock_user` |

**Inviting a staff user**

1. Select **Invite User** and enter their name, email, and phone.
2. Assign a **role** (which grants a set of permissions).
3. Send the invitation. The user receives an email to set their password, or a
   temporary password they must change on first login.

### Roles

**Page:** Administration → Roles · **Access:** `view_roles` / `manage_roles`

Create and edit roles by selecting permissions from a grouped catalog (organized by
module and action — View, Create, Update, Delete, Approve, etc.).

- Umbrella permissions like **Manage Members** grant all the fine-grained member
  operations at once; use fine-grained permissions for tightly scoped roles.
- **Dangerous permissions** (delete, remove, revoke, void, suspend, waive) are
  flagged so you assign them deliberately.
- **Checker permissions** (`approve_*`) are the second half of maker–checker pairs —
  ensure the people holding them are different from those who submit.

> **Note.** As an Edir Administrator you can only assign **Edir-scoped**
> permissions. Platform/cross-Edir permissions (managing other Edirs, districts,
> branches, the super switch) never appear in your role editor — those are managed
> by Platform Administrators.

⚠ **Segregation of duties.** Avoid giving one person both the maker and the checker
permission for the same module. If unavoidable in a very small Edir, at least have
a second person available to check, since no one can approve their own request.

---

## 19. Audit log and payment log

### Audit log

**Page:** Governance → Audit Log · **Access:** `view_audit_log`

Every significant action — approvals, member changes, settings changes,
disbursements — is recorded with the actor, target, timestamp, and details. Use
filters and date ranges to investigate. With `manage_audit_log` you can archive or
export entries.

### Payment log

**Page:** Governance → Payment Log · **Access:** `view_payment_log`

A complete, read-only record of every transaction (mini-app, manual, cash, bank)
with amount, method, status, and reference. This is your reconciliation source of
truth.

---

## 20. Notifications

You'll receive in-app (and, where configured, email) notifications for:

- New requests awaiting your approval.
- Decisions on requests you submitted (approved/rejected/returned).
- Member requests and grievances.
- Security events on your own account.

Open the **notification bell** to review and clear them.

---

## 21. Best practices

- **Always keep two approvers per critical module** so operations never stall on
  maker–checker.
- **Reconcile the payment log regularly** against your bank statements.
- **Review absence lists before finalizing attendance** — it creates member charges.
- **Use suspension before termination** for temporary non-payment.
- **Keep rules and documents current and approved** so members always see accurate
  policy.
- **Grant the least privilege necessary** when creating roles.
- **Communicate settings changes** (fees, penalties) to members in advance.
- **Export periodic CSVs** for offline records and audits.

---

## 22. Troubleshooting

| Problem | Likely cause / fix |
|---------|-------------------|
| **I can't approve a request** | You are the maker, or you lack the module's checker permission. A different authorized user must approve it. |
| **A member can't pay in the mini-app** | The Edir may not be **Active** or its **payment account** isn't configured. Check with your Platform Administrator; verify the account number in your Edir profile. |
| **A page is missing from my sidebar** | Your role lacks that page's access permission. Ask a Roles administrator to grant it. |
| **A manual payment isn't reflected** | It may still be **Pending** in the Approvals Center awaiting a checker. |
| **Penalties look wrong** | Review your **penalty tiers** and **daily penalty** settings, grace period, and due day. |
| **A member was auto-suspended unexpectedly** | Check the **auto-suspend months** setting and the member's arrears. |
| **I'm locked out** | Wait out the lockout or ask another administrator to unlock your account. |

---

## 23. Frequently asked questions

**Can one person do both maker and checker?**
No — no one can approve their own submission. You need a second authorized person.

**Do most payments need manual recording?**
No. Mini-app payments settle automatically. Manual recording is for cash/bank
payments and reconciliation.

**How do members get a login?**
You issue one from **Platform Users**. Many members never need a login — the payment
mini-app is enough.

**What's the difference between suspend and terminate?**
Suspension is temporary and reversible (with a reinstatement fee). Termination ends
the membership.

**Who approves Edir registration and profile changes?**
Not the Edir itself — those are reviewed by organizational staff (Branch/District/
Head Office). See the *Platform Administrator Manual*.

**Can I undo an approved action?**
Approved actions are applied and audited. Some have compensating actions (e.g. void
a payment, reinstate a member), but there is no blanket "undo." Review carefully
before approving.

---

## Appendix A — Edir permission reference

These are the permissions available to Edir-scoped roles, grouped by page.

| Page | Permissions |
|------|-------------|
| **Dashboard** | `view_dashboard` |
| **Members** | `view_members`, `manage_members`, `create_member`, `edit_member`, `suspend_member`, `reinstate_member`, `approve_member`, `manage_relatives`, `manage_documents`, `remove_members`, `approve_member_removal`, `review_member_documents`, `export_members` |
| **Payments** | `view_payments`, `record_payment`, `approve_payment`, `waive_penalty`, `approve_penalty_waiver`, `void_payment`, `export_payments` |
| **Approvals** | `view_approvals` (plus any `approve_*` checker permission) |
| **Emergencies** | `view_emergencies`, `manage_emergencies`, `report_emergency`, `reject_emergency`, `request_disbursement`, `approve_emergency_claim`, `approve_emergency_disbursement`, `export_emergencies` |
| **Events** | `view_events`, `manage_events`, `reschedule_event`, `cancel_event`, `finalize_attendance`, `export_events` |
| **Assets** | `view_assets`, `manage_assets`, `create_asset`, `edit_asset`, `delete_asset`, `issue_asset`, `return_asset`, `manage_asset_categories`, `approve_asset_issuance`, `export_assets` |
| **Rules & Bylaws** | `view_rules`, `manage_rules`, `approve_rule_change` |
| **Committee Oversight** | `view_committee_oversight` |
| **Member Requests** | `handle_member_requests`, `export_member_requests` |
| **Documents** | `view_documents`, `upload_document`, `edit_document`, `classify_document`, `share_document`, `archive_document`, `delete_document`, `review_document`, `approve_document`, `reject_document`, `revoke_document_access`, `export_documents` |
| **Audit Log** | `view_audit_log`, `manage_audit_log` |
| **Payment Log** | `view_payment_log` |
| **Platform Users** | `view_users`, `manage_users`, `reset_password`, `lock_user`, `unlock_user` |
| **Roles** | `view_roles`, `manage_roles` |
| **Edir Settings** | `manage_edir_settings`, `manage_committee` |

---

## 25. Glossary

| Term | Definition |
|------|------------|
| **Edir** | An Ethiopian mutual-aid association. |
| **Tenant** | One Edir's isolated data space on the shared platform. |
| **Maker** | The person who submits a request. |
| **Checker** | The person who approves/rejects a request (never the maker). |
| **Approval request** | A governed change awaiting a checker's decision. |
| **Penalty tier** | A late-payment charge band based on days overdue. |
| **Daily penalty** | An optional penalty that accrues each overdue day. |
| **Coverage / Paid through** | The latest month a member's contributions cover. |
| **Installment plan** | A schedule to pay a large amount in parts. |
| **Emergency type** | A configured benefit category (with payout and rules). |
| **Disbursement** | The act of paying out an approved emergency benefit. |
| **Relationship category** | A configurable family relationship type. |
| **Committee oversight** | Read-only governance visibility. |
| **Audit log** | The immutable record of significant actions. |
| **Payment log** | The record of all financial transactions. |

---

*For platform-level topics (registering your Edir, districts/branches, cross-Edir
user assignment, security configuration), see the **[Platform Administrator
Manual](./ADMIN_MANUAL.md)**. For the member payment experience, see the **[User
Manual](./USER_MANUAL.md)**.*
