# Edir Registration System - Complete Flowchart

## System Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     EDIR REGISTRATION SYSTEM                             │
└─────────────────────────────────────────────────────────────────────────┘

┌──────────────────┐                                    ┌──────────────────┐
│   BRANCH USER    │                                    │  DISTRICT/HEAD   │
│                  │                                    │  OFFICE CHECKER  │
│  • Register Edir │                                    │                  │
│  • Submit Form   │                                    │  • Review        │
│  • Upload Doc    │                                    │  • Approve/      │
│                  │                                    │    Reject/Return │
└────────┬─────────┘                                    └──────────┬───────┘
         │                                                          │
         │ Form Data (10 fields)                                    │
         │ Agreement Document                          Approval Action
         ▼                                                          │
┌─────────────────────────────────────────┐                       │
│  REGISTRATION FORM (6 Steps)             │                       │
├─────────────────────────────────────────┤                       │
│ Step 1: Edir Details                     │                       │
│  • Name (required)                       │                       │
│  • Description                           │                       │
│  • Account Number (required)             │                       │
│                                          │                       │
│ Step 2: Branch/District                  │                       │
│  • Branch Selector (required)             │                       │
│  • District (auto-derived)               │                       │
│                                          │                       │
│ Step 3: Chairperson Info                 │                       │
│  • Name (required)                       │                       │
│  • Mobile (required)                     │                       │
│  • Email (required)                      │                       │
│                                          │                       │
│ Step 4: Address Details                  │                       │
│  • Edir Address (required)                │                       │
│  • Contact Address                       │                       │
│  • Account Number (required)             │                       │
│                                          │                       │
│ Step 5: Agreement Document               │                       │
│  • PDF Upload (required)                  │                       │
│                                          │                       │
│ Step 6: Review & Submit                  │                       │
│  • All data displayed                    │                       │
│  • Final confirmation                    │                       │
└──────────────────┬──────────────────────┘                       │
                   │                                               │
                   │ SUBMIT                                        │
                   ▼                                               │
┌─────────────────────────────────────────┐                       │
│  CREATE EDIR (Database)                  │                       │
├─────────────────────────────────────────┤                       │
│ ✅ Save all 10 fields                     │                       │
│ ✅ Set status: PENDING                   │                       │
│ ✅ Link to Branch                        │                       │
│ ✅ Create Edir ID                        │                       │
└──────────────────┬──────────────────────┘                       │
                   │                                               │
                   │ Edir created with PENDING status             │
                   ▼                                               │
┌─────────────────────────────────────────┐                       │
│  SUBMIT FOR APPROVAL                     │                       │
├─────────────────────────────────────────┤                       │
│ ✅ Create ApprovalRequest                │                       │
│ ✅ Module: EDIR_REGISTRATION            │                       │
│ ✅ Status: PENDING                       │                       │
│ ✅ Maker: Current User                   │                       │
│ ✅ Create audit log entry                │                       │
│ ✅ Send notification to checkers         │                       │
└──────────────────┬──────────────────────┘                       │
                   │                                               │
                   │ Approval request created                      │
                   │ Notification sent to checkers                 │
                   │                                               │
                   │                               ┌───────────────┘
                   │                               │
                   │                               ▼
                   │                    ┌──────────────────────┐
                   │                    │ APPROVALS CENTER     │
                   │                    ├──────────────────────┤
                   │                    │ • View pending list   │
                   │                    │ • View full details   │
                   │                    │ • View all fields     │
                   │                    │ • View agreement doc  │
                   │                    │ • View history        │
                   │                    │ • Add comments        │
                   │                    └──────────────────────┘
                   │                               │
                   │                    ┌──────────┴──────────┐
                   │                    │                     │
                   │          ┌─────────▼────────┐  ┌────────▼──────────┐
                   │          │ APPROVE BUTTON   │  │ REJECT/RETURN BTN │
                   │          └────────┬─────────┘  └────────┬──────────┘
                   │                   │                     │
       ┌───────────┴───────────────────┼─────────────────────┼─────────────────┐
       │                               │                     │                 │
       │                         [Approve Path]         [Reject Path]    [Return Path]
       │                               │                     │                 │
       │                               ▼                     ▼                 ▼
       │                    ┌─────────────────────┐ ┌───────────────┐ ┌──────────────┐
       │                    │ SAME USER CHECK     │ │ STATUS: NO    │ │ STATUS: NO   │
       │                    │                     │ │ CHANGE        │ │ CHANGE       │
       │                    │ if maker == checker │ │               │ │              │
       │                    │   DENY              │ │ Edir stays    │ │ Edir stays   │
       │                    │ else ALLOW          │ │ PENDING       │ │ PENDING      │
       │                    └────────┬────────────┘ └───────────────┘ └──────────────┘
       │                             │                     │                 │
       │                ┌────────────▼─────────────┐       │                 │
       │                │ CREATE APPROVAL EVENT    │       │                 │
       │                │ • Action: APPROVED       │       │                 │
       │                │ • Comment (optional)     │       │                 │
       │                │ • Timestamp              │       │                 │
       │                │ • Actor: Checker         │       │                 │
       │                └────────────┬─────────────┘       │                 │
       │                             │                     │                 │
       │                ┌────────────▼─────────────┐       │                 │
       │                │ UPDATE APPROVAL REQUEST  │       │                 │
       │                │ • Status: APPROVED       │       │                 │
       │                │ • CheckerId: Set         │       │                 │
       │                │ • CheckedAt: Now         │       │                 │
       │                └────────────┬─────────────┘       │                 │
       │                             │                     │                 │
       │                ┌────────────▼─────────────┐       │                 │
       │                │ EXECUTE APPROVAL MODULE  │       │                 │
       │                └────────────┬─────────────┘       │                 │
       │                             │                     │                 │
       │                ┌────────────▼─────────────┐       │                 │
       │                │ CRITICAL: UPDATE EDIR    │       │                 │
       │                │                          │       │                 │
       │                │ status: PENDING → ACTIVE │       │                 │
       │                │ ✅ EDIR IS NOW ACTIVE    │       │                 │
       │                └────────────┬─────────────┘       │                 │
       │                             │                     │                 │
       │                ┌────────────▼─────────────┐       │                 │
       │                │ CREATE DEFAULT SETTINGS  │       │                 │
       │                │ • EdirSettings record    │       │                 │
       │                └────────────┬─────────────┘       │                 │
       │                             │                     │                 │
       │                ┌────────────▼─────────────┐       │                 │
       │                │ CREATE DEFAULT ROLES     │       │                 │
       │                │ • Edir Admin role        │       │                 │
       │                │ • Member role            │       │                 │
       │                │ • Committee role         │       │                 │
       │                └────────────┬─────────────┘       │                 │
       │                             │                     │                 │
       │                ┌────────────▼─────────────┐       │                 │
       │                │ WRITE AUDIT LOG          │       │                 │
       │                │ • Action: APPROVED       │       │                 │
       │                │ • Actor: Checker         │       │                 │
       │                │ • Details: Notes         │       │                 │
       │                │ • Timestamp              │       │                 │
       │                └────────────┬─────────────┘       │                 │
       │                             │                     │                 │
       │                ┌────────────▼─────────────┐       │                 │
       │                │ SEND NOTIFICATION        │       │                 │
       │                │ • To: Maker              │       │                 │
       │                │ • Type: Approval         │       │                 │
       │                │ • Status: APPROVED ✅     │       │                 │
       │                │ • Message: "Approved"    │       │                 │
       │                └────────────┬─────────────┘       │                 │
       │                             │                     │                 │
       │                             │    ┌────────────────┴─────────────────┤
       │                             │    │                                  │
       │                             │    ▼                                  ▼
       │                             │  SEND NOTIFICATION                  SEND NOTIFICATION
       │                             │  • To: Maker                        • To: Maker
       │                             │  • Type: Rejection                  • Type: Return
       │                             │  • Status: REJECTED                 • Status: RETURNED
       │                             │  • Reason: Included                 • Reason: Included
       │                             │                                     
       │                             │    EDIR REMAINS PENDING             EDIR REMAINS PENDING
       │                             │    Maker can delete                 Maker can update & retry
       │                             │                                     
       │                             └─────────────────────────────────────┘
       │
       └─────────────────────────────────┬──────────────────────────────────┘
                                         │
                                         ▼
                            ┌────────────────────────┐
                            │ PROCESS COMPLETE       │
                            ├────────────────────────┤
                            │ All notifications sent │
                            │ Audit trails created   │
                            │ Approvals tracked      │
                            │ History maintained     │
                            └────────────────────────┘
```

---

## Data Flow Diagram

```
USER INPUT (6-Step Form)
        │
        ├─ Edir Name, Description
        ├─ Account Number
        ├─ Branch (scope-aware)
        ├─ Chairperson Name, Mobile, Email
        ├─ Edir Address, Contact Address
        └─ Agreement Document (PDF)
        │
        ▼
VALIDATION LAYER
        │
        ├─ Required field checks
        ├─ Branch exists & in scope
        ├─ Document format valid
        └─ All 10 fields captured
        │
        ▼
DATABASE LAYER
        │
        ├─ edir.create() with status: PENDING
        ├─ All fields stored
        ├─ Audit log entry created
        └─ Approval request created
        │
        ▼
NOTIFICATION LAYER
        │
        ├─ Notification sent to checkers
        ├─ Approvals center updated
        └─ Timeline starts
        │
        ▼
APPROVAL ACTION (Checker)
        │
        ├─ canUserApprove() check
        ├─ Prevent maker self-approval
        ├─ Create approval event
        └─ Execute approval module
        │
        ▼
STATUS TRANSITION (if approved)
        │
        ├─ status: PENDING → ACTIVE ✅
        ├─ Create default roles
        ├─ Create default settings
        └─ Notification to maker
        │
        ▼
FINAL STATE
        │
        ├─ Edir is ACTIVE
        ├─ Can be managed normally
        ├─ Audit trail complete
        └─ Full history maintained
```

---

## State Machine Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                      EDIR REGISTRATION STATES               │
└─────────────────────────────────────────────────────────────┘

                          [PENDING]
                        /    │    \
                       /     │     \
                      /      │      \
                     /       │       \
            [APPROVED]   [REJECTED] [RETURNED]
                 │            │          │
                 │            └─ Stays   └─ Stays
                 │               PENDING    PENDING
                 │
                 ▼
             [ACTIVE]
                │
                ├─→ [SUSPENDED] (admin action)
                └─→ [CLOSED] (admin action)


TRANSITIONS:

PENDING → ACTIVE
  • Trigger: Approval granted by checker
  • Conditions:
    - Checker must exist
    - Checker ≠ Maker
    - All data validated
    - Agreement document uploaded
  • Actions on transition:
    - Create default roles
    - Create default settings
    - Create audit log entry
    - Send notification

PENDING → REJECTED
  • Trigger: Rejected by checker
  • Conditions:
    - Checker ≠ Maker
    - Rejection reason provided
  • Actions on transition:
    - Create approval event with reason
    - Maintain PENDING status
    - Send notification with reason
    • Maker cannot resubmit (must delete and restart)

PENDING → RETURNED
  • Trigger: Returned for revision by checker
  • Conditions:
    - Checker ≠ Maker
    - Revision notes provided
  • Actions on transition:
    - Create approval event with notes
    - Maintain PENDING status
    - Send notification with revision notes
    • Maker can update Edir and trigger another EDIR_UPDATE approval

ACTIVE → SUSPENDED
  • Trigger: Admin action (out of registration scope)

SUSPENDED → ACTIVE
  • Trigger: Admin action (out of registration scope)

ACTIVE → CLOSED
  • Trigger: Admin action (out of registration scope)
```

---

## Database State Tracking

```
┌──────────────────────────────────────────────────────────┐
│              DATABASE RECORDS CREATED/UPDATED             │
└──────────────────────────────────────────────────────────┘

1. EDIR TABLE
   ┌─────────────────────────────────────┐
   │ id: UUID                            │
   │ name: "Addis Community Edir"        │
   │ description: null                   │
   │ branchId: UUID                      │
   │ status: "PENDING" → "ACTIVE"        │
   │ address: "Addis Ababa"              │
   │ accountNumber: "1234567890"         │
   │ contactPersonName: "Ahmed Hassan"   │
   │ contactAddress: "Addis Ababa"       │
   │ contactMobile: "+251 911 123 456"   │
   │ contactEmail: "ahmed@edir.com"      │
   │ agreementDocUrl: "/uploads/..."     │
   │ createdAt: NOW                      │
   │ updatedAt: APPROVAL_TIME            │
   └─────────────────────────────────────┘

2. APPROVAL_REQUEST TABLE
   ┌─────────────────────────────────────┐
   │ id: UUID                            │
   │ edirId: UUID (FK)                   │
   │ module: "EDIR_REGISTRATION"         │
   │ status: "APPROVED"                  │
   │ makerId: UUID (FK to User)          │
   │ checkerId: UUID (FK to User)        │
   │ createdAt: SUBMISSION_TIME          │
   │ checkedAt: APPROVAL_TIME            │
   └─────────────────────────────────────┘

3. APPROVAL_EVENT TABLE (Multiple rows)
   ┌─────────────────────────────────────┐
   │ id: UUID                            │
   │ approvalRequestId: UUID (FK)        │
   │ actorId: UUID (FK to User)          │
   │ action: "SUBMITTED"/"APPROVED"      │
   │ status: "PENDING"/"APPROVED"        │
   │ comment: "..."                      │
   │ createdAt: EVENT_TIME               │
   └─────────────────────────────────────┘

4. AUDIT_LOG TABLE
   ┌─────────────────────────────────────┐
   │ id: UUID                            │
   │ userId: UUID (FK)                   │
   │ action: "EDIR_REGISTRATION_SUBMITTED" │
   │         "APPROVAL_GRANTED"          │
   │ targetType: "Edir"                  │
   │ targetId: UUID (FK to Edir)         │
   │ details: "Submitted/Approved edir"  │
   │ createdAt: EVENT_TIME               │
   └─────────────────────────────────────┘

5. EDIR_SETTINGS TABLE (created on approval)
   ┌─────────────────────────────────────┐
   │ id: UUID                            │
   │ edirId: UUID (FK)                   │
   │ ... default settings ...            │
   │ createdAt: APPROVAL_TIME            │
   └─────────────────────────────────────┘

6. ROLE TABLE (created on approval)
   ┌─────────────────────────────────────┐
   │ id: UUID                            │
   │ edirId: UUID (FK)                   │
   │ name: "Edir Admin" / "Member" /     │
   │       "Committee (Oversight)"       │
   │ scope: "EDIR"                       │
   │ permissions: CSV list               │
   │ createdAt: APPROVAL_TIME            │
   └─────────────────────────────────────┘

7. NOTIFICATION TABLE
   ┌─────────────────────────────────────┐
   │ id: UUID                            │
   │ userId: UUID (FK to Maker)          │
   │ type: "approval"                    │
   │ title: "EDIR_REGISTRATION Approved" │
   │ body: "Your registration was..."    │
   │ linkUrl: "/dashboard/approvals/..." │
   │ createdAt: APPROVAL_TIME            │
   │ readAt: null (until read)           │
   └─────────────────────────────────────┘
```

---

## Summary

The system ensures:
- ✅ All 10 form fields captured and stored
- ✅ Edir starts in PENDING state
- ✅ Maker cannot approve own submission
- ✅ Checker reviews and approves/rejects/returns
- ✅ Approval transitions PENDING → ACTIVE
- ✅ Rejection/Return maintain PENDING state
- ✅ Complete audit trail throughout
- ✅ Notifications sent at each step
- ✅ Scope-aware access control enforced
