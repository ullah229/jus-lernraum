# JUS Lernraum — Version 4

Private tutoring administration for JUS Nachhilfen. React/TypeScript, Sites Vinext, D1 database, private R2 object storage. Published owner-private. No student/parent access and no automatic Google Calendar integration. Team support uses individual ChatGPT identities plus explicit JUS membership; the Site remains owner-private until named teachers are separately allowed at the platform level.

## Daily workflows
- Student records, billing recipient/address, contacts, rates, archive status.
- Individual lessons and weekly / two-week / four-week series (2–52 occurrences). Preview with explicit holiday/date exclusions. Europe/Berlin wall-clock time preserved across DST; ambiguous times rejected. Single occurrences editable; cancel remaining planned series from a chosen occurrence. Series creation rejects overlaps with existing planned lessons.
- Complete a started planned lesson: attendance, notes, optional learning observation and homework in one D1 transaction with version guard. No-show is cancelled and not charged. No cancellation-fee policy is inferred.
- Homework with due date, open/done/discussed status, student filter and attachment references restricted to the same student. Material download remains authenticated.
- Payments, expenses, student balances, monthly billing. Bill only delivered, unbilled lessons. Invoice creation snapshots issuer, recipient and line data, allocates yearly sequential numbers and claims lessons transactionally. Billed lessons cannot be edited, deleted or restored over. Cancellation keeps history, frees lessons and creates a printable cancellation document. Assigned payments must be unassigned before cancellation.
- Business profile requires explicit tax mode (Kleinunternehmer / specified exemption / 19% included in end price), name/address and tax identifier. No tax status is assumed. Amounts are integer EUR cents. Per-lesson total is hourly rate × minutes / 60 rounded; for 19%, net is rounded gross / 1.19 and tax is the difference. Issued invoices keep their original issuer details.
- Authenticated printable invoices and cancellation documents; browser print-to-PDF. No structured XRechnung/ZUGFeRD and no accounting/GoBD certification.
- Reminders for the next 24h/48h/7 days: review recipient and editable text, open email draft or copy, then explicitly mark as sent. Marking stores the lesson version, so edits make a new reminder due. **No unattended email/SMS sending:** Sites connector eligibility discovery is unavailable. Draft opening does not confirm delivery.
- Manual Google Calendar template links and ICS export remain available, without automatic synchronization.

## Recovery and files
PDF, PNG, JPEG, TXT, DOCX, XLSX, PPTX; 10 MB per file, 1 GB / 1,000 original files including trash. Basic signature checks, no malware scanning. Authenticated attachment downloads, owner-scoped object keys.

Daily snapshot before the first write of each UTC day; old snapshots pruned after 30 days on later usage, not a scheduler. New snapshots copy referenced material bytes to content-addressed backup objects. Missing originals fail the snapshot rather than silently report success. Previous snapshots may have no binary copies. Restore a daily snapshot using the dated restore action. Existing active records are retained.

Full TAR export streams manifest plus all original file bytes, including trash. Restore imports records first and processes files one at a time with SHA-256 verification. Failed imports can be repeated; they may have partially succeeded. Maximum 2,000 records per restore. Original file limits also apply on restore. Keep other editing tabs idle during export/import. Portable exports do not include change history. Copies and manifests stored with the Site are not independent disaster recovery: download and protect an external TAR backup.

Permanent deletion removes the primary file. Copies can remain while referenced by a retained daily snapshot; unused copies older than 30 days are pruned at a later daily snapshot. Backup copies count toward provider storage separately from the application's original-file limit.

## Security and migrations
Visitor identity comes from the private Sites proxy; don't expose the Worker via another entry point. Server checks ownership, Origin for mutations, body limits, schemas, material/student relationships and optimistic versions. Invoice claims and financial immutability are enforced with SQLite unique constraints and transaction-local guards. Invoice APIs cannot use generic edits. Site sharing alone does not authorize JUS access: an active bound membership and pupil assignments are required. The configured JUS_OWNER_ID is the existing owner’s site-scoped authenticated user ID, verified against persisted records, not the account ID from Site sharing metadata.

Migrations in drizzle/ are the deployment authority. The third generated migration (with corrected SQLite expression-index SQL) adds invoice claims, unique expression indexes and workflow guards. Financial guards must remain within the same D1 batch as their associated mutations. This hosting migration runner does not accept multi-statement SQLite trigger bodies.

## Verification
- TypeScript: `node node_modules/typescript/bin/tsc --noEmit`
- Pure domain / TAR: `node --experimental-strip-types --test tests/domain.test.mjs`
- Isolated Worker + actual D1/R2 tests: `node --test tests/backend.test.mjs`
- Sites production build helper.

Tests replace only request identity inside a test-only bundle and use invented data. Coverage includes owner isolation, origin refusal, optimistic concurrency, history/trash, DST series, atomic lesson completion, duplicate billing prevention, numbering, payment association, cancellation, original-byte TAR roundtrip, backup-copy restore and corrupt-file refusal.

A real signed-in browser end-to-end/print check is not available in this environment. No live email delivery is tested or enabled. This release is not an assertion that every operational or data-protection requirement is satisfied.

## First use / manual acceptance with invented data
1. Create a pupil, including billing recipient/address. Create a series with an excluded holiday and inspect its dates.
2. Create a past planned lesson; complete it with learning observation and homework. Check all three records.
3. Upload a test PDF, attach it to the homework, download it, and change task status.
4. Enter your checked business/tax details in Abrechnungen → Rechnungsdaten. Preview monthly charges, issue a test invoice, check print layout/PDF and record a payment with invoice assignment.
5. For cancellation, remove the payment assignment, cancel the invoice and print its cancellation document. Confirm the lesson can be corrected and reissued.
6. Download a full backup and test restoring a deleted test file. Protect the archive outside this provider.
7. Prepare a reminder; verify recipient and text. Send externally only if desired and mark sent afterward.

## Team release
- Inhaber: full administration, named members, student assignments, scheduling, customer billing, payroll and backups. Teachers cannot administer membership or access any global backup/history/invoice/payment endpoint.
- Teachers: individual ChatGPT sign-in, only assigned student educational/contact data (no customer hourly rate or billing address), their own lessons, shared educational progress/homework/materials for assigned pupils, and their own honorarium statements. Teachers complete existing lessons and may schedule or reschedule their own planned individual lessons for assigned active pupils. They cannot set customer prices, honorarium rates or payment status. Only the owner can delete files.
- Each lesson stores optional teacherId and payRate in integer cents. Only an active, assigned teacher can be scheduled. Planned lessons cannot overlap for the same pupil or teacher; different teachers may teach different pupils simultaneously. Unassigned legacy lessons remain owner-managed.
- Payroll statements snapshot held lessons and stored rates; unique lesson claims and transaction guards prevent duplicate payroll and edits to claimed lessons. Only open statements may be marked paid or cancelled. Marking paid records confirmation, not a transfer or payroll tax calculation. Record cash outflow separately as an expense.
- Invitations: owner generates a 7-day random one-time link. Only its SHA-256 hash is stored. Acceptance requires an authenticated account with the intended email and binds the stable site-scoped user ID. All subsequent access uses the bound ID. Deactivation blocks subsequent requests. Active membership and student assignment are rechecked in mutation transactions. No emails are automatically sent.
- Activation has two independent steps: the owner must allow the named email in Sites sharing, then the teacher accepts the personal link. No recipients were supplied in this development turn, so no real teachers have been invited or granted platform access.
- Owner identity is configured as the secret runtime variable JUS_OWNER_ID. Missing configuration fails closed. Do not derive ownership from the first visitor or from client-supplied fields.
- Full and daily backups include member names/emails/rates and assignments, excluding user bindings and invitation hashes. Newly restored members are inactive and unbound; current active memberships/assignments are not overwritten. Payroll lesson claims are rebuilt on import.
- Migration 0003_serious_killmonger.sql was generated from db/schema.ts; it is additive. Existing student/lesson records are not reassigned or seeded during deployment.

28 automated tests (7 domain/TAR + 21 isolated backend flows) cover the original workflows and new roles, personal/replayed invitation refusal, educational/financial data filtering, denied cross-teacher completion, uploads, stored honorarium rates, duplicate payroll prevention, revocation and team disaster restore. Actual sign-in by three distinct people, platform invitation delivery and real browser UI remain untested.

## Learning workspace design (October 2026)

Moodle-inspired JUS interface shared by administrators and teachers: top navigation, grouped side navigation and mobile drawer, dashboard timeline (lessons and open homework), pupil learning cards, monthly calendar with date selection, and resource blocks. Material search and collapsible sections group existing uploads by file type; these are display groups, not new folders or course records. Teacher visibility and all server authorization remain enforced by the existing APIs. No Moodle integration, automatic calendar sync or parent/student access was added.

Validation for this presentation update: TypeScript and production build. Browser rendering and mobile interaction need manual verification because browser QA is unavailable in this environment.

## Homework attachments and solutions

Homework forms and lesson completion can upload multiple files directly into the selected pupil's material collection. Uploads are immediately persistent and selected; saving links their IDs to the homework. Closing a draft keeps uploaded materials. Student switching clears both selections; saving and switching are disabled during upload. A separate solution text and solutionFileIds array default to empty for legacy tasks. Both file lists are validated against the same owner, pupil and active files by the save and completion APIs. The material list groups files referenced as homework solutions under Lösungen. Existing teacher access rules apply; no pupil/parent access is introduced.

## Calendar views

The schedule now offers a Teams-inspired week/day time grid, month grid, and weekly list. All dates use Europe/Berlin with Monday-first weeks. Parallel lessons occupy separate lanes; lessons spanning midnight are shown on each affected day. Teacher colors, search and cancelled-event toggles support browsing. Clicking an event opens the existing authorized details/actions; owner-only empty hourly slots prefill the lesson form and never write automatically. Teachers retain their existing view/completion permissions. No drag-and-drop rescheduling or external synchronization is introduced. TypeScript and production build verified; interactive browser QA remains unavailable.

## Group tutoring

Groups contain 2–20 pupils, a subject, teacher, per-pupil hourly price, goal and archive status. Assigned teachers can view a group only when assigned to all its members. The owner creates dated group sessions atomically; each participant gets a linked lesson with frozen membership, customer price and teacher rate. Conflict guards run before all participant inserts, allowing the common teacher within that one group but rejecting external conflicts. The calendar/dashboard collapse linked participant lessons to one event. Existing completion records attendance and optional educational work per pupil. No-show is cancelled without tuition. Payroll waits for all participants to be documented and counts the teacher fee once if at least one attended; other participant payroll lines show zero. Invoice generation remains per pupil. Generic group-lesson edits/deletes and individual historical recovery are blocked; planned sessions can be cancelled together and re-created to reschedule. Group recurrence and batch homework assignment are not implemented.

Validation: group scheduling/replay/conflicts, teacher assignment/visibility, per-pupil attendance and billing, single teacher honorarium, snapshot membership and cancellation covered by backend integration tests.

### Smartphone calendar
At viewport widths up to 700px the shared calendar shows a light, touch-friendly agenda instead of the horizontally scrolling desktop grid. A seven-day selector, week navigation, today action, date picker, search and cancelled filter control the view. The agenda starts at the selected day, initially shows 14 days (including empty days), and can load further days. Group sessions remain a single calendar item with individual participants in the details. Owners can create lessons with the floating plus button; teachers retain their existing permissions. Teacher filtering, recurring lessons and ICS export are under the mobile management disclosure. Desktop views are preserved. Browser/device QA remains outstanding in this environment.

### Calendar subscriptions removed
The external calendar connection UI and settings card have been removed at the owner's request. Both former subscription endpoints return HTTP 410 for reads and writes, without database access, so old bearer links cannot retrieve appointments and new links cannot be generated. Applied migrations remain immutable; the unused subscription table is retained but is never accessed by the application. The internal calendar, lessons, and manual ICS export are unchanged. Previously downloaded events must be removed in the external calendar app if desired.

### Invoice-based pupil accounts (October 2026)
Finanzen now displays received payments, held-but-uninvoiced lessons, outstanding issued invoices and unapplied cash credit separately. Each pupil account expands into invoices, payment dates/methods/allocations and pending lessons. Zero-price lessons are free services and never create cash credit. Archived pupils retain their accounts. Expenses remain a separate list; teacher payroll remains separate.

Payments support a method and explicit allocations of integer-cent amounts to one or more issued invoices belonging to the same pupil. Unallocated funds remain credit. Edit the payment to use credit on another invoice or to remove an allocation; no additional payment is created. There is no automatic allocation on invoice creation. A payment may not allocate more than its own amount, and new allocations cannot overpay an invoice. Version checks and transactional post-mutation guards also protect concurrent writes and backup/history restoration. Remove invoice allocations before cancelling an invoice; cancelling releases the lessons for rebilling.

Compatibility: existing payment records with a single invoiceId are read unchanged, in date/ID order. Their applied amounts are capped at the invoice total, with excess shown as credit. On editing, the new form saves explicit allocations. No production records are migrated or rewritten at deployment. Original payment methods that were not recorded display 'Nicht angegeben'. The version-12 code backup predates allocations: do not run the old application against newly edited allocation data; restore a matching data backup if a complete rollback is required.

Validation: 30 backend tests cover the existing workflows plus 100/80/20 EUR accounting, partial payments, multiple invoice allocations, free lessons, old overpayments, concurrent allocation rejection, cancellation and restore/import integrity. Smartphone/desktop browser QA remains outstanding in this environment. This remains an internal management tool rather than a complete accounting suite.

## Teacher scheduling (16 October 2026)

Teachers can create individual future appointments from their overview, pupil cards and calendar (including the mobile plus button). Own planned individual appointments can be moved or edited; the pupil remains fixed. Editing an individual occurrence retains its series ID without changing other occurrences. Group scheduling and cancellation remain owner-managed.

A dedicated `teacher-schedule` workflow accepts only student, subject, start, duration, location, notes, ID and version. The server assigns the authenticated teacher, takes current pupil/customer and member/honorarium rates for new appointments, and preserves both stored rates for edits. Client financial fields, another teacher ID, group metadata and status changes are refused. Active pupil/member, current assignment, pupil/member versions, lesson versions, invoice/payroll claims and overlapping planned lessons are checked; transactional guards protect concurrent writes. Generic lesson CRUD remains owner-only. Customer rates remain absent from teacher responses.

Validation: TypeScript and 34 isolated backend tests pass, including create/reschedule, immutable rates, revoked access, foreign pupils/lessons, prohibited financial fields, archived pupils, completed/group lessons and simultaneous overlapping bookings. Browser/device interaction still requires manual QA.

## Teacher calendar downloads (16 October 2026)
Teacher appointment details now offer “Termin als Kalenderdatei speichern” for non-cancelled lessons, and “Meine Termine exportieren” downloads their currently authorized lessons. Downloads reuse the existing ICS serializer and only use the server-filtered teacher data. Group sessions are collapsed for the bulk export. No external connection or automatic synchronization is added. Downloads deliberately omit pupil names and financial data, like the existing owner export. The files are imported manually in the user's calendar application; later changes are not pushed.

## Corrections to completed individual lessons (16 October 2026)
Teachers can now edit their own held individual lessons for assigned active pupils before invoice or payroll claims exist. The existing dedicated workflow preserves held status, attendance, teacher, pupil, customer rate and honorarium rate; it permits correcting start (not into the future), duration, subject, location and notes. An altered duration affects the billable total. Related learning observations and homework remain independently editable and are not rewritten. Cancelled and group sessions remain excluded. Preflight claim checks provide a specific explanation, and transactional lesson guards continue to enforce invoice/payroll immutability against concurrent changes. Validation: 35 backend tests and TypeScript pass; new coverage checks held edits, preserved rates/status, future-date refusal, stale versions, and both invoice and payroll locks. Browser QA remains unavailable.
