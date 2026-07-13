Implement the complete production-ready Employee Management feature for the existing Fyndbridge ATS.

The Employee Management frontend may already exist using mock data. Preserve its current Lovable-style interface and connect it to real application data. Do not redesign it unless a minor adjustment is strictly required for functionality.

The implementation must cover:

- Real employee data
- Active / On Leave / Inactive status management
- Supabase database changes
- Secure admin-only backend operations
- Realtime status updates
- Immediate logout for inactive employees
- Initial ATS-load status validation
- Filtering of assignment dropdowns
- Employee reassignment
- Preservation of historical records
- Proper loading, error and empty states

First inspect the complete relevant codebase and existing database conventions before changing anything.

---

# 1. Strict change-scope rules

Make the smallest possible set of changes required to implement this feature correctly.

Do not:

- Modify unrelated pages, components or utilities
- Refactor unrelated code
- Rename or move existing files unnecessarily
- Reformat entire files
- Redesign the sidebar, header or Admin Panel
- Alter existing locked-record functionality
- Alter current access-control settings
- Replace existing shared components
- Change unrelated authentication behaviour
- Install a new package unless absolutely necessary
- Change project-wide TypeScript, Vite, Next.js or build configuration
- Change unrelated database tables, policies or functions
- Fix unrelated warnings or existing issues
- Delete users, profile rows or historical ATS records
- Reset, truncate or recreate the database
- Run destructive production database commands

Prefer:

- Small isolated components
- Isolated hooks and API helpers
- One additive database migration
- Existing modal, toast, icon, button and form components
- Existing admin-authentication helpers
- Existing backend and Supabase conventions

Before modifying a file, verify that it is directly required.

After implementation, inspect the complete Git diff and revert every unrelated, accidental, formatting-only or cleanup change.

---

# 2. Understand the existing architecture first

Before writing code, inspect:

- Existing profile/user table
- The field linking a profile to auth.users
- Existing profile-name save flow
- Existing Admin and Super Admin authorization
- Existing Admin Panel implementation
- Existing Employee Management mock-data components
- Existing Supabase client and server clients
- Existing API route conventions
- Existing RLS policies
- Existing Realtime implementation
- Existing online/away presence implementation
- Candidate consultant fields
- Client consultant fields
- Mandate consultant and team-lead fields
- Whether mandate consultants are stored as arrays, IDs, names or another format
- Existing activity-log or notification helpers
- Existing toast and modal system

Use the actual schema and field names found in the repository. Do not assume field names without checking them.

Do not migrate the entire ATS to a new employee-ID system during this task. Work safely with the existing schema.

---

# 3. Employment statuses

Support exactly these statuses:

type EmploymentStatus = "active" | "on_leave" | "inactive";

Meaning:

## Active

- Employee can access the ATS
- Employee can receive new assignments
- Employee appears in future assignment dropdowns

## On Leave

- Employee remains logged in
- Employee can continue accessing the ATS
- Employee must not receive new assignments
- Employee must not appear as a selectable option in new assignment dropdowns
- Existing records assigned to the employee must still display their name
- Their ATS should update immediately without requiring a refresh
- Show a clear non-blocking banner or status indication in their ATS:

  You are currently marked On Leave and cannot receive new assignments.

Do not log out an On Leave employee.

## Inactive

- Employee has left the company
- Employee must not receive assignments
- Employee must not appear in new assignment dropdowns
- Employee must be logged out immediately from every currently open ATS tab when the status change is received
- Employee must not be allowed into the authenticated ATS on a later login
- Historical records must remain intact
- Existing records must continue showing the employee’s name
- Do not delete their authentication account, profile or ATS records

Use this logout message:

Your account has been deactivated. Please contact an administrator.

---

# 4. Database design

Inspect whether the existing employee/profile table already has a suitable employment-status column.

Use the smallest safe design.

Preferred design:

Store employment status in the existing stable profile table when that table is not being continuously updated by presence or heartbeat activity.

If the profile table is also used for frequent online-presence updates and would cause noisy Realtime events, create a small dedicated table such as:

employee_statuses

The table should contain, using the repository’s real user/profile key:

- user_id
- status
- created_at
- updated_at
- updated_by

Requirements:

- One status row per employee
- Default status: active
- Database constraint allowing only:
  - active
  - on_leave
  - inactive
- Foreign key to the existing profile/auth user identifier
- Index on status if useful for selectable-employee queries
- Enable Supabase Realtime for the relevant status table
- Use the existing migration format and naming convention

Do not duplicate status storage in multiple tables.

---

# 5. Existing-employee backfill

Create a safe additive migration that gives every existing valid employee an active status.

A valid employee is an existing profile with a saved, non-empty profile name, following the current application rules.

Requirements:

- Existing employees become Active
- Existing status values must not be overwritten
- Migration must be idempotent where practical
- Do not delete or recreate profile rows
- Do not alter candidate, client or mandate ownership during migration

---

# 6. Automatic employee creation

A new employee must appear in Employee Management automatically after:

1. They successfully log in for the first time
2. They save a valid profile name

Do not add an Add Employee button or employee-creation form.

When the profile name is saved:

- Ensure an employment-status row exists
- Create it with status active only when no status row already exists
- Never reset an existing employee’s status to Active when they later edit their profile
- Prevent duplicate status rows

Use the existing profile-save flow or a safe database trigger, depending on the current architecture.

Do not create the employee-management status before the profile name has been saved.

A first-time user without a completed profile must still be able to access the existing profile setup process.

---

# 7. RLS and database security

Enable RLS on any new status table.

Use the existing Admin/Super Admin authorization system. Do not create a second role system.

Required access rules:

- Authenticated ATS users may read the employment statuses needed for:
  - Their own status
  - Employee assignment dropdown filtering
- Normal users must not directly update employment statuses
- Only an authorized Admin or Super Admin may change another employee’s status
- Status changes should be performed through a secure server endpoint using existing server-side authorization conventions
- Never expose the service-role key to the browser

Inactive users must not be able to access protected ATS data using an old browser session or access token.

Inspect how the ATS accesses Supabase.

## If protected data is accessed through backend APIs

Add or extend a centralized server-side authorization check that rejects inactive users.

Use a consistent response such as:

{
  "code": "ACCOUNT_INACTIVE",
  "message": "Your account has been deactivated."
}

Use HTTP 403.

## If the browser directly accesses protected Supabase tables

Add a reusable database authorization function following the existing RLS conventions, for example:

is_current_employee_active()

This may be a security-definer function if that matches the existing architecture and is implemented safely.

Use it to ensure inactive employees cannot access protected ATS data.

Avoid recursive profile-table RLS policies.

Do not block On Leave users from normal ATS access. Only Inactive users should be denied general ATS access.

Server-side and RLS authorization are security enforcement. They are not additional frontend status-refetch fallbacks.

---

# 8. Admin Employee Management data

Replace the isolated mock-data adapter with real data.

Do not redesign the existing Employee Management interface.

The employee list should include profiles that have a valid saved profile name.

Load:

- Employee ID
- Profile name
- Email
- Mobile number when available
- Employment status

Do not show:

- Role
- Designation
- Department
- Last active
- Device
- IP address
- Location

Employee-list filters must continue to work:

- All
- Active
- On Leave
- Inactive

Search must continue to work by:

- Name
- Email

Do not load thousands of candidates or all assignment rows for every employee in the initial employee-list request.

Use an efficient structure.

## Employee list request

Return:

- Employee identity fields
- Employment status
- Client count
- Mandate count
- Candidate count

## Selected employee detail request

Return only:

- Counts
- A small preview of names for each section
- Enough records to show the existing pills
- The +N more count

Avoid N+1 queries.

Keep the existing card order exactly:

1. Clients
2. Mandates
3. Candidates

Keep the headings exactly:

- Clients
- Mandates
- Candidates

Do not use:

- Assigned Clients
- Assigned Mandates
- Assigned Candidates

---

# 9. Admin status-update endpoint

Create a secure admin-only backend operation following the project’s existing route conventions.

Conceptually, it should support:

PATCH /api/admin/employees/:employeeId/status

Do not force this exact URL if the repository uses a different routing convention.

Input:

{
  "status": "active | on_leave | inactive"
}

Requirements:

- Verify the caller is authenticated
- Verify the caller is an authorized Admin or Super Admin
- Validate employee ID
- Validate status
- Confirm the target employee exists
- Update only the employment-status data
- Set updated_at
- Set updated_by
- Return the canonical updated employee status
- Return clear validation and authorization errors
- Do not trust frontend authorization
- Do not expose service-role credentials

Use the existing activity-log helper when one already exists.

If an audit/activity system exists, log:

- Admin who changed the status
- Employee whose status changed
- Previous status
- New status
- Timestamp

Do not create an entirely new activity-log system solely for this task.

---

# 10. Frontend status-update behaviour

Connect the existing segmented status control to the real backend.

When an Admin changes status:

- Disable the control while saving
- Prevent duplicate submissions
- Show success feedback
- On failure, restore the previous UI state
- Show a clear error message
- Use the canonical server response
- Update Employee Management counts and filters where necessary

Status helper text:

## Active

Employee can log in and receive new assignments.

## On Leave

Employee remains in the system but should not receive new assignments.

## Inactive

Employee has left the company and should not receive new assignments.

Do not use mock local-only state after the backend is connected.

---

# 11. Realtime implementation

Employment-status changes must reflect without a page reload.

Use Supabase Realtime.

Important performance requirements:

- No polling
- No interval-based status queries
- No repeated database fetching
- Use one stable Realtime status subscription per authenticated ATS tab
- Do not create one subscription per component or employee
- Do not recreate subscriptions on every render
- Remove the channel on logout and unmount
- Avoid reconnect loops
- Use stable React effect dependencies

Prefer subscribing only to the dedicated status data.

If a dedicated employee_statuses table is used, subscribe to INSERT and UPDATE events for that table.

The event handler should:

1. Update the cached employee-status list used by assignment dropdowns
2. Update the Admin Employee Management UI when open
3. Check whether the changed employee is the currently logged-in user
4. Apply the correct current-user behaviour

## Current employee becomes On Leave

Immediately:

- Update the authenticated employee-status state
- Show the On Leave banner
- Keep the employee logged in
- Do not reload the page

## Current employee becomes Active

Immediately:

- Update the authenticated employee-status state
- Remove the On Leave banner
- Keep the employee logged in
- Do not reload the page

## Current employee becomes Inactive

Immediately:

1. Display:

   Your account has been deactivated. Please contact an administrator.

2. Clear relevant client-side authenticated state
3. Call the existing Supabase sign-out flow
4. Redirect to the login page
5. Ensure the message remains visible after redirect, using the existing toast/message pattern or a safe one-time navigation state

Do not require a page refresh.

Realtime should react only when database changes occur. Do not add continuous status fetching.

---

# 12. Initial ATS-load fallback

Implement exactly one frontend fallback status check:

Fetch the logged-in employee’s current status once when the authenticated ATS initially loads.

Do not add additional frontend status-refetch checks on:

- Browser-tab focus
- Window focus
- Route changes
- Page navigation
- Before create operations
- Before edit operations
- Before delete operations
- Visibility changes
- Timers
- Intervals

The initial-load flow should be:

1. Restore or obtain the authenticated Supabase session
2. Fetch the employee’s employment status once
3. Do not render protected ATS content until the result is known
4. Show an existing loading screen or layout-stable skeleton during the check

Results:

## Active

- Render the ATS normally

## On Leave

- Render the ATS
- Show the On Leave banner

## Inactive

- Show the deactivation message
- Sign out
- Redirect to login
- Do not briefly expose protected ATS content

## No profile name yet

- Allow the existing first-time profile setup flow
- Do not incorrectly log out a new employee before profile setup

Do not add any other frontend fallback checks.

---

# 13. Shared authenticated employment-status state

Create or extend one shared authenticated-user/session state location for employment status.

Do not independently fetch status inside multiple pages.

The state should expose enough information for:

- Authenticated layout
- On Leave banner
- Inactive logout handling
- Employee assignment dropdowns
- Admin Employee Management
- Online list filtering where needed

Follow the project’s current state-management approach.

Do not introduce a new global state library.

---

# 14. Assignment-dropdown filtering

Search the repository for every control that assigns work to an employee.

At minimum inspect:

- Candidate Consultant
- Client Consultant
- Mandate Consultant
- Mandate multi-consultant selector
- Mandate Team Lead
- Assign Another Mandate flow
- Any other new-assignment employee selector

For all future assignment controls:

- Only Active employees may be selected
- On Leave employees must not be selectable
- Inactive employees must not be selectable

Use one shared helper or query for selectable employees rather than duplicating filters throughout the application.

Do not blindly change every dropdown that displays an employee.

Historical reporting selectors and employee-management filters are not assignment selectors.

---

# 15. Existing assignments and historical display

Do not erase or hide historical employee names.

When an existing Candidate, Client or Mandate is assigned to an On Leave or Inactive employee:

- Continue displaying the employee’s name
- Do not replace the name with -
- Do not silently clear the field
- Do not delete the relationship
- Do not automatically reassign records when status changes

When editing an existing record:

- The current On Leave or Inactive assignee may be displayed as the current value
- Clearly indicate that they are not available for new assignments
- Do not allow selecting them as a new assignee for another record
- Do not clear the value merely because it is absent from the Active employee list

Keep current-assignee display logic separate from selectable-employee options.

Do not rewrite creator, audit, created-by or historical activity fields.

---

# 16. Online/Away presence

Employment status and online presence are separate concepts.

Do not replace or interfere with:

- Online
- Away
- Offline

Behaviour:

- An On Leave employee can remain Online or Away if they are using the ATS
- An Inactive employee should disappear from the Online/Away list after logout and presence cleanup
- Do not show inactive employees in the live employee-presence card
- Do not change the existing presence heartbeat unless required to remove an inactive employee cleanly

Reuse the existing logout/presence-cleanup flow.

---

# 17. Employee reassignment

Connect the existing Reassign modal to real backend data.

The source employee is the employee currently selected in Employee Management.

Destination employee rules:

- Destination must be Active
- Exclude the source employee
- Exclude On Leave employees
- Exclude Inactive employees

Categories:

- Clients
- Mandates
- Candidates

Validation:

- Destination employee required
- At least one category required
- Confirm disabled until valid
- Show the current reassignable count for each category
- Handle zero-count categories properly

---

# 18. Reassignment database operation

Reassignment across multiple tables must be atomic.

Do not issue independent frontend update calls that can partially succeed.

Implement either:

- One transactional PostgreSQL RPC/function
- Or the project’s existing safe server-side transaction mechanism

The transaction must:

1. Verify the caller is an Admin or Super Admin
2. Verify the source employee exists
3. Verify the destination employee exists
4. Verify destination status is Active
5. Transfer only the selected categories
6. Update current ownership/assignment fields
7. Preserve creator and historical audit fields
8. Avoid duplicate employee IDs or names in multi-consultant mandate arrays
9. Roll back all changes if any selected category fails
10. Return affected counts

Use the actual existing schema.

Examples requiring careful handling:

- Candidate may have one Consultant field
- Client may have one Consultant field
- Mandate may have multiple Consultants
- Mandate may separately have a Team Lead

For mandate arrays:

- Replace the source employee with the destination employee
- Do not duplicate the destination if already present
- Preserve unrelated assigned consultants
- Handle the source employee as Team Lead according to the same selected Mandates reassignment action
- Do not corrupt array or JSON formats

Do not change fields unrelated to current assignment ownership.

If existing activity-log or notification helpers already support assignment changes, reuse them carefully.

Do not generate duplicate notifications.

---

# 19. Reassignment frontend result

After successful reassignment:

- Close the modal
- Show a success toast
- Refresh only the affected Employee Management data
- Update source counts
- Update destination counts when visible
- Update preview pills
- Do not reload the entire Admin Panel
- Do not reload the entire website

Show the server-returned affected counts.

Example:

Reassigned 4 clients, 7 mandates and 23 candidates to Priya Sharma.

On failure:

- Keep the modal open
- Preserve selections
- Show a clear error
- Do not show partial success
- Do not optimistically clear counts unless the transaction succeeds

---

# 20. Efficient data access

The ATS may contain thousands of candidates.

Do not load all candidate rows merely to display Employee Management counts.

Use database aggregation and limited previews.

For each selected employee return:

- Client total count
- First few client names
- Mandate total count
- First few mandate names
- Candidate total count
- First few candidate names

Use deterministic ordering for previews.

Do not return CV data, comments, resumes, full candidate payloads or unrelated columns.

Add narrowly scoped indexes only when the relevant employee-assignment fields are not already indexed and the index is genuinely needed.

Do not alter unrelated indexes.

---

# 21. Loading, error and empty states

Preserve the existing Employee Management layout.

Add:

- Employee-list skeleton
- Selected-employee detail skeleton
- Status-save loading state
- Assignment-preview loading state
- Reassignment loading state
- No employees state
- No matching employees state
- No linked clients state
- No linked mandates state
- No linked candidates state
- API error retry state where appropriate

Avoid layout shift.

Do not introduce artificial loading delays.

---

# 22. Admin permissions

Use the Admin Panel’s existing authorization model.

Only authorized Admin/Super Admin users may:

- View management controls, according to existing Admin Panel access
- Change employment status
- Perform reassignment

Do not trust only hidden frontend buttons.

Every write operation must verify admin authorization on the server.

Do not create a new unrelated role or permission system.

---

# 23. React and Realtime cleanup

Ensure:

- One Realtime subscription per authenticated tab
- No duplicate channels after React Strict Mode mounting
- Channel removed during logout
- Channel removed during component or provider unmount
- No subscription inside employee-list rows
- No subscription per assignment dropdown
- No status polling
- No memory leaks
- No state updates after unmount
- No infinite effect loops
- No unnecessary full-app rerenders

Use the project’s existing query cache or state-update mechanism where available.

---

# 24. Behaviour verification

Verify these scenarios manually or through appropriate tests.

## New employee

1. User logs in
2. User has no saved profile name
3. Profile setup remains accessible
4. User saves profile name
5. Employee appears automatically in Employee Management
6. Status is Active

## Active to On Leave

1. Admin selects an Active employee
2. Admin changes status to On Leave
3. Admin UI updates
4. Employee’s already-open ATS updates without reload
5. Employee remains logged in
6. On Leave banner appears
7. Employee disappears from new-assignment dropdowns
8. Historical assigned records continue showing their name

## On Leave to Active

1. Admin changes status to Active
2. Employee’s open ATS updates without reload
3. Banner disappears
4. Employee reappears in new-assignment dropdowns

## Active to Inactive

1. Admin changes status to Inactive
2. Employee’s open ATS receives the Realtime event
3. Deactivation message appears
4. Employee is signed out
5. Employee is redirected to login
6. Employee disappears from assignment dropdowns
7. Employee disappears from the online-presence list
8. Historical records remain visible

## Inactive login attempt

1. Inactive employee authenticates
2. Initial ATS-load status check runs
3. Protected ATS content does not flash
4. Employee is signed out
5. Deactivation message appears

## Reassignment

1. Admin selects the source employee
2. Admin opens the Reassign modal
3. Only Active destination employees are selectable
4. Admin selects categories
5. Reassignment succeeds atomically
6. Counts and previews update
7. Historical audit fields remain unchanged
8. No duplicate mandate consultants are created

## Realtime performance

1. Only one employee-status channel exists per authenticated tab
2. No recurring status network request occurs
3. No polling interval exists
4. Status handler runs only when a matching database change is received
5. Unmount and logout remove the channel

---

# 25. Tests

Add focused tests using the project’s existing testing setup.

At minimum cover where practical:

- Status validation
- Admin authorization
- Existing-employee backfill behaviour
- Automatic status creation after profile save
- Active employee filtering
- On Leave exclusion from assignment dropdowns
- Inactive exclusion from assignment dropdowns
- Existing inactive assignee display
- Initial-load inactive handling
- Realtime Active to On Leave handling
- Realtime On Leave to Active handling
- Realtime Active to Inactive logout handling
- Reassignment validation
- Reassignment destination must be Active
- Reassignment mandate-array deduplication
- Reassignment transaction rollback
- Employee counts and preview limits

Do not introduce an entirely new test framework.

---

# 26. Migration safety

Before completing:

- Confirm migrations are additive
- Confirm existing data is preserved
- Confirm existing employees are backfilled as Active
- Confirm no existing status is overwritten
- Confirm no users are deleted
- Confirm no candidate, client or mandate rows are deleted
- Confirm no destructive production reset command was used
- Confirm Realtime is enabled only for the required status table
- Confirm RLS does not create recursion
- Confirm service-role credentials remain server-side

Do not automatically apply destructive migrations to production.

Follow the repository’s normal migration and deployment workflow.

---

# 27. Final verification

Before finishing:

1. Review the entire Git diff.
2. Revert unrelated changes.
3. Revert formatting-only changes outside edited areas.
4. Confirm every modified file is directly required.
5. Run the existing lint command.
6. Run the existing typecheck command.
7. Run the existing test command where available.
8. Run the production build.
9. Fix only errors introduced by this feature.
10. Do not fix unrelated pre-existing warnings or errors.
11. Confirm all current Admin Panel sections remain unchanged.
12. Confirm locked records remain unchanged.
13. Confirm the Employee Management design was preserved.
14. Confirm there is no Add Employee button.
15. Confirm role and last-active fields are absent.
16. Confirm the cards are named exactly:
    - Clients
    - Mandates
    - Candidates
17. Confirm Active, On Leave and Inactive work with real data.
18. Confirm only Active employees appear in future assignment controls.
19. Confirm Realtime does not poll.
20. Confirm only the initial ATS-load frontend fallback status check exists.
21. Confirm no focus, route-change, visibility or timer-based status refetch was added.
22. Confirm inactive users are blocked server-side or database-side.
23. Confirm historical data remains intact.
24. Confirm no unrelated files were touched.

---

# 28. Final response format

After implementation, provide:

## Files created

List each new file and its purpose.

## Existing files modified

List each modified file and explain why it was necessary.

## Database changes

Include:

- Migration created
- Table or column used
- Backfill behaviour
- RLS policies
- Realtime publication
- Transaction or RPC created

## Backend changes

Include:

- Employee-list/detail endpoints
- Status-update endpoint
- Reassignment endpoint or RPC
- Authorization enforcement

## Frontend changes

Include:

- Mock-data removal
- Real-data integration
- Realtime provider or subscription
- Initial-load status gate
- On Leave banner
- Inactive logout handling
- Assignment-dropdown filtering
- Reassignment integration

## Verification results

Report:

- Lint
- Typecheck
- Tests
- Production build
- Realtime subscription count
- Confirmation that no polling was added

## Scope confirmation

Explicitly confirm:

- No unrelated frontend was redesigned
- No unrelated backend was modified
- No existing records were deleted
- No employee accounts were deleted
- No unnecessary dependencies were installed
- No unrelated files were changed