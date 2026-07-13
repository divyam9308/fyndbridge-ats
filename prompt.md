Enhance only the existing Employee Management reassignment feature in the Fyndbridge ATS.

The complete Employee Management system already exists, including:

- Real employee data
- Active / On Leave / Inactive statuses
- Realtime employee-status updates
- Immediate logout for inactive employees
- Initial ATS-load status check
- Active-employee filtering in assignment dropdowns
- Existing Employee Management UI
- Existing Reassign Employee modal and backend operation
- Existing employee counts and preview cards for Clients, Mandates and Candidates

Do not rebuild or redesign the Employee Management feature.

The only required enhancement is:

Allow the admin to select individual Clients, individual Mandates and individual Candidates for reassignment, while also providing a Select All option for each category.

Currently, reassignment may transfer an entire category. Replace or extend that behaviour so only explicitly selected records are reassigned.

Example:

- An employee currently has 4 mandates.
- The admin selects only 2 mandates.
- The admin transfers those 2 mandates to Cherry.
- The other 2 mandates remain assigned to the original employee.
- When the admin opens the Reassign modal again for the original employee, only the remaining 2 mandates must appear.
- The already-transferred mandates must not appear again because they are no longer assigned to the source employee.
- Those remaining 2 mandates can later be reassigned to another active employee.

This same behaviour must apply independently to Clients, Mandates and Candidates.

---

# 1. Strict change-scope rules

Make the smallest possible set of changes required for this enhancement.

Do not modify or rebuild unrelated Employee Management functionality.

Do not modify:

- Employee Active / On Leave / Inactive behaviour
- Realtime employment-status handling
- Initial ATS-load status checking
- Inactive-user logout behaviour
- On Leave banner behaviour
- Assignment-dropdown filtering
- Online / Away / Offline presence
- Existing employee creation flow
- Existing profile save flow
- Existing Employee Management layout
- Existing employee list and search
- Existing employee status controls
- Existing Clients, Mandates and Candidates overview cards
- Existing locked-record functionality
- Existing Admin Panel access controls
- Sidebar
- Header
- Dashboard
- Attendance
- PMS
- Invoice
- User Manual
- Candidate-page UI
- Client-page UI
- Mandate-page UI
- Authentication
- Unrelated backend endpoints
- Unrelated database tables
- Unrelated RLS policies
- Unrelated Supabase functions
- Unrelated migrations
- Project-wide configuration
- Package configuration
- TypeScript configuration
- Build configuration

Do not:

- Refactor unrelated code
- Rename unrelated files
- Move unrelated files
- Reformat entire files
- Install new dependencies unless absolutely necessary
- Fix unrelated warnings or existing bugs
- Delete records
- Recreate tables
- Reset the database
- Truncate tables
- Run destructive database commands
- Add a new notification feature
- Send notifications for reassignment
- Modify existing notification logic
- Add new activity-notification behaviour
- Add email notifications
- Add assignment notifications
- Add popup notifications for reassignment

There is no notification requirement for reassignment.

Do not add one.

Prefer:

- Extending the existing Reassign modal
- Extending the existing reassignment endpoint, RPC or transaction
- Reusing existing components
- Reusing existing modal, button, checkbox, input, dropdown and toast components
- Small isolated helper functions
- Additive and narrowly scoped database changes only if required

Before editing a file, verify that it is directly necessary for this individual-reassignment enhancement.

After implementation:

- Inspect the complete Git diff
- Revert all unrelated changes
- Revert formatting-only changes outside edited sections
- Confirm every changed file is directly required

---

# 2. Inspect the existing implementation first

Before writing code, inspect:

- Existing Employee Management frontend
- Existing Reassign Employee modal
- Existing employee detail API
- Existing reassignment API or RPC
- Existing admin authorization logic
- Existing client assignment field
- Existing candidate consultant field
- Existing mandate consultant field
- Existing mandate multi-consultant structure
- Existing mandate Team Lead field
- Existing database schema
- Existing Supabase migrations
- Existing transaction or RPC conventions
- Existing modal and checkbox components
- Existing toast system
- Existing pagination and search patterns

Use the actual existing table names, column names, types and assignment formats.

Do not assume schema names.

Do not create a duplicate reassignment system if one already exists.

Extend the existing system safely.

---

# 3. Required modal design

Preserve the current Employee Management design.

When the admin clicks:

Reassign

open the existing Reassign Employee modal, updated to support individual record selection.

The modal should contain:

## Header

- Existing reassignment icon
- Heading:

  Reassign Employee

- Description:

  Choose exactly which records to transfer to another employee.

- Existing close button

## Source employee

Show the selected source employee as read-only:

- Initials avatar
- Employee name
- Employee email

## Destination employee

Show a searchable employee dropdown labelled:

Transfer To

Destination employee rules:

- Destination employee is required
- Source employee must not appear
- Only Active employees may be selected
- On Leave employees must not be selectable
- Inactive employees must not be selectable
- Do not change existing Active / On Leave / Inactive rules

---

# 4. Individual record-selection sections

Show three separate sections in this exact order:

1. Clients
2. Mandates
3. Candidates

Each section must contain:

- Category icon
- Category heading
- Total number currently assigned to the source employee
- Category-level Select All checkbox
- Search input
- Full selectable record list
- One checkbox per record
- Scroll support when the list is long
- Correct selected-count state

Only records that are currently assigned to the source employee should appear.

Previously reassigned records must not appear.

Do not display stale reassignment data from the initial Employee Management page load.

Every time the modal opens, load or refresh the source employee’s current assignments.

---

# 5. Clients selection

Heading format:

Clients (count)

Search placeholder:

Search clients

Each client row should show:

- Checkbox
- Client name
- Client ID, if already available and useful

The admin must be able to:

- Select one client
- Select multiple clients
- Select all clients
- Deselect one client after selecting all
- Clear all client selections
- Reassign clients without selecting mandates or candidates

Only selected clients must be reassigned.

Unselected clients must remain assigned to the source employee.

After successful reassignment:

- Transferred clients must disappear from the source employee’s list
- Source employee client count must decrease
- Destination employee client count must increase
- Opening the modal again must show only clients still assigned to the source employee

Do not modify:

- Client contact persons
- Client follow-ups
- Contract data
- Client history
- Creator fields
- Audit fields
- Other unrelated client columns

---

# 6. Mandates selection

Heading format:

Mandates (count)

Search placeholder:

Search mandates

Each mandate row should show:

- Checkbox
- Role or mandate title
- JB ID or mandate ID when available
- Client name as secondary text when useful

The admin must be able to:

- Select one mandate
- Select multiple mandates
- Select all mandates
- Deselect one mandate after selecting all
- Clear all mandate selections
- Reassign mandates without selecting clients or candidates

Only selected mandates must be reassigned.

Unselected mandates must remain assigned to the source employee.

Example requirement:

- Source employee has 4 mandates
- Admin selects 2
- Admin transfers those 2 to Cherry
- Source employee retains the other 2
- Opening Reassign again for the source employee shows only the remaining 2
- The transferred 2 no longer appear
- The remaining 2 can later be reassigned elsewhere

This behaviour must be based on current database assignments, not cached modal state.

Inspect the actual mandate schema.

Mandates may contain:

- Multiple consultants
- A separate Team Lead

For each selected mandate:

## Consultant assignment

If the source employee is in the consultant assignment:

- Replace or remove the source employee according to the existing reassignment semantics
- Assign the destination employee
- Preserve all unrelated consultants
- Do not duplicate the destination employee if already assigned
- Preserve the current array, JSON or text format
- Remove duplicate consultant values safely

## Team Lead assignment

If the source employee is the Team Lead of the selected mandate:

- Replace the source employee with the destination employee
- Do not modify Team Lead values on unselected mandates

Do not:

- Change unselected mandates
- Remove unrelated consultants
- Corrupt mandate arrays
- Change mandate status
- Change client links
- Change creator fields
- Change historical fields
- Change unrelated mandate data

---

# 7. Candidates selection

Heading format:

Candidates (count)

Search placeholder:

Search candidates

Each candidate row should show:

- Checkbox
- Candidate name
- Candidate ID when available
- Current client or mandate as secondary text when useful

The admin must be able to:

- Select one candidate
- Select multiple candidates
- Select all candidates
- Deselect one candidate after selecting all
- Clear all candidate selections
- Reassign candidates without selecting clients or mandates

Only selected candidates must be reassigned.

Unselected candidates must remain assigned to the source employee.

After successful reassignment:

- Transferred candidates must disappear from the source employee’s reassignment list
- Source candidate count must decrease
- Destination candidate count must increase
- Opening the modal again must show only candidates still assigned to the source employee

Do not load or modify:

- CV files
- Resume text
- Candidate comments
- Duplicate detection data
- Candidate history
- Creator fields
- Client assignment
- Mandate assignment
- Any unrelated candidate fields

Only update the existing consultant or ownership assignment field required for employee reassignment.

---

# 8. Select All behaviour

Each category must have its own independent Select All checkbox.

The admin must be able to:

- Select all Clients only
- Select all Mandates only
- Select all Candidates only
- Select all Clients and only two Mandates
- Select one Client, three Candidates and no Mandates
- Select any combination across categories

Select All must select all records currently assigned to the source employee in that category.

It must not select:

- Only visible rows
- Only the current scroll area
- Only the current pagination page
- Records no longer assigned to the source employee
- Records belonging to another employee

Search must only filter displayed records.

Search must not clear existing selections.

Example:

- Admin selects Client A
- Searches for Client B
- Selects Client B
- Clears search
- Both Client A and Client B remain selected

Select All checkbox states:

## Checked

All currently assigned records in the category are selected.

## Unchecked

No records in the category are selected.

## Indeterminate

Some, but not all, records are selected.

After Select All:

- Admin may deselect individual records
- Select All becomes indeterminate
- Only the remaining selected records are reassigned

Clearing Select All should clear all selections in that category.

---

# 9. Selection summary

At the bottom of the record sections, show a live summary.

Example:

Selected: 2 clients, 1 mandate, 3 candidates

Use correct singular and plural wording:

- 1 client
- 2 clients
- 1 mandate
- 2 mandates
- 1 candidate
- 2 candidates

When nothing is selected, show:

No records selected

Update this summary immediately when selections change.

---

# 10. Modal actions and validation

Show:

- Cancel
- Confirm Reassignment

Confirm Reassignment must remain disabled until:

1. An Active destination employee is selected
2. At least one individual record is selected

While submitting:

- Disable destination selection
- Disable record checkboxes
- Disable Select All controls
- Prevent duplicate submissions
- Show loading state on the confirm button
- Prevent accidental modal closing while the request is running, following the existing modal pattern

On success:

- Close the modal
- Use the existing success-toast system if one already exists
- Do not create a new notification system
- Refresh only the affected Employee Management data
- Update the source employee counts
- Update source preview pills
- Update destination counts when visible
- Do not reload the page
- Do not reload the Admin Panel
- Do not reload the full ATS

Example success message:

Reassigned 2 clients, 1 mandate and 3 candidates to Cherry.

This success message is normal immediate UI feedback only.

It must not create:

- Notification rows
- Bell notifications
- Reassignment notifications
- Emails
- Persistent employee notifications

On failure:

- Keep the modal open
- Preserve the destination employee
- Preserve all record selections
- Show the existing error feedback
- Do not clear selections
- Do not update counts optimistically
- Do not show partial success

---

# 11. Reopening the modal after reassignment

This behaviour is mandatory.

Every time the Reassign modal opens:

- Query the current assignments for the selected source employee
- Do not reuse stale record lists
- Do not include records already transferred
- Show the latest counts
- Show only records still assigned to the source employee

Example:

Initial state:

- Mandate A
- Mandate B
- Mandate C
- Mandate D

Admin transfers:

- Mandate A
- Mandate B

to Cherry.

After success, reopening Reassign for the original employee must show:

- Mandate C
- Mandate D

It must not show:

- Mandate A
- Mandate B

If Mandate C is then transferred to another employee, reopening the modal again must show only:

- Mandate D

Apply the same logic to Clients and Candidates.

The database is the source of truth.

Do not rely only on frontend removal.

---

# 12. Efficient record loading

The ATS may contain thousands of candidates.

Do not fetch full records.

When the Reassign modal opens, load only the minimal fields required.

## Client fields

- Internal ID
- Client ID when available
- Client name

## Mandate fields

- Internal ID
- JB ID when available
- Role or title
- Client name when useful

## Candidate fields

- Internal ID
- Candidate ID when available
- Candidate name
- Client or mandate name when useful

Do not return:

- CVs
- Resume files
- Parsed resume content
- Comments
- Full candidate payloads
- Full client payloads
- Full mandate payloads
- Activity histories
- Notifications
- Unrelated columns

Use:

- Stable ordering
- Existing pagination patterns
- Server-side search if necessary
- Incremental loading if the list is large
- Efficient filtered queries
- No N+1 queries

The initial Employee Management page must continue showing only counts and preview pills.

Do not load all individual records until the Reassign modal is opened.

---

# 13. Selection-state implementation

Use a selection model that safely supports:

- No selection
- Individual selected IDs
- Select All
- Individual exclusions after Select All

A suitable structure is:

type CategorySelection =
  | {
      mode: "none";
      selectedIds: string[];
      excludedIds: string[];
    }
  | {
      mode: "selected";
      selectedIds: string[];
      excludedIds: string[];
    }
  | {
      mode: "all";
      selectedIds: string[];
      excludedIds: string[];
    };

Meaning:

## none

No records selected.

## selected

Only the IDs in selectedIds are selected.

## all

All records currently assigned to the source employee are selected except IDs in excludedIds.

You may use another equivalent implementation if it better matches the current codebase.

Do not send thousands of IDs when Select All can be represented safely by:

- mode: all
- excludedIds

---

# 14. Backend request

Extend the existing reassignment endpoint or RPC.

Do not create unnecessary duplicate APIs.

The request should support the equivalent of:

{
  "sourceEmployeeId": "source-id",
  "destinationEmployeeId": "destination-id",
  "selections": {
    "clients": {
      "mode": "selected",
      "selectedIds": ["client-1", "client-2"],
      "excludedIds": []
    },
    "mandates": {
      "mode": "all",
      "selectedIds": [],
      "excludedIds": ["mandate-4"]
    },
    "candidates": {
      "mode": "none",
      "selectedIds": [],
      "excludedIds": []
    }
  }
}

Use the project’s established request and naming conventions.

Validation requirements:

- Caller must be authenticated
- Caller must be an authorized Admin or Super Admin
- Source employee must exist
- Destination employee must exist
- Source and destination must be different
- Destination employee must currently be Active
- Selection modes must be valid
- At least one record must be selected
- Selected IDs must exist
- Selected IDs must currently belong to the source employee
- Excluded IDs must be valid
- Duplicate IDs must be removed
- IDs from another employee must be rejected
- Already-transferred records must not be transferred again
- Frontend-provided counts must not be trusted
- Frontend-provided names must not be trusted

Use current database values as the source of truth.

---

# 15. Atomic reassignment

All selected record updates in one confirmation must remain atomic.

Do not perform separate independent browser updates that may partially succeed.

Use the existing:

- PostgreSQL RPC
- Transaction function
- Or server-side transaction mechanism

Extend it to support individual record IDs and Select All semantics.

The transaction must:

1. Verify admin authorization
2. Verify the source employee
3. Verify the destination employee
4. Verify destination status is Active
5. Resolve the final selected IDs for Clients
6. Resolve the final selected IDs for Mandates
7. Resolve the final selected IDs for Candidates
8. Verify every resolved record is currently assigned to the source employee
9. Update only those resolved records
10. Leave all unselected records unchanged
11. Preserve historical and creator fields
12. Roll back every change if any category fails
13. Return exact affected counts

Example:

If 2 Clients, 1 Mandate and 3 Candidates are selected:

- Either all 6 records are transferred
- Or no records are transferred

Never allow partial reassignment.

---

# 16. Current-assignment verification

The backend must verify ownership at transaction time.

This is required because assignments may change after the modal opens.

Before updating each selected record:

- Confirm it is still assigned to the source employee
- Reject or safely fail if it is no longer assigned
- Do not overwrite a newer assignment
- Do not transfer stale records
- Do not silently reassign records belonging to someone else

If the assignment changed after the modal was opened, return a clear error and refresh the modal data.

---

# 17. Historical-data preservation

Reassignment changes current assignment ownership only.

Do not modify:

- Created by
- Original creator
- Historical activity data
- Past attribution
- Attendance
- PMS
- Invoice records
- Previous notifications
- Existing audit fields
- Record creation dates
- Candidate CV data
- Client follow-ups
- Contract documents
- Mandate creation information

Do not delete employees or records.

Do not remove the original employee’s historical attribution where it is stored separately.

---

# 18. No notification changes

Do not add any notification behaviour for reassignment.

Specifically:

- Do not create notification rows
- Do not notify the source employee
- Do not notify the destination employee
- Do not add bell notifications
- Do not add notification popups
- Do not send emails
- Do not add due notifications
- Do not call notification helpers
- Do not alter existing notification code
- Do not generate duplicate assignment notifications
- Do not create a new notification migration
- Do not add a reassignment notification type

Only use the existing immediate toast or inline success message shown to the admin who performed the reassignment.

That toast is not a persistent notification feature.

---

# 19. Loading and empty states

Add or preserve:

- Modal loading skeleton
- Record-list loading state
- Search loading state when needed
- API error state
- Retry action
- Empty Clients state
- Empty Mandates state
- Empty Candidates state
- No Active destination employee state
- No search result state

Suggested messages:

- No clients assigned to this employee
- No mandates assigned to this employee
- No candidates assigned to this employee
- No records match your search
- No active employees available for reassignment

For a category with zero records:

- Show the empty state
- Disable Select All
- Do not include that category in validation
- Do not show stale records

---

# 20. Modal scrolling and layout

Preserve the current UI style.

Use:

- Existing navy colour
- Existing gold accent
- Existing fonts
- Existing modal component
- Existing buttons
- Existing inputs
- Existing checkboxes
- Existing spacing and border style

Do not redesign the Employee Management page.

The modal must:

- Fit normal laptop screens
- Keep the header visible
- Keep the footer actions usable
- Allow the content area to scroll
- Prevent page-level horizontal scrolling
- Wrap long text safely
- Keep searches and Select All controls aligned

---

# 21. Accessibility

Ensure:

- Every checkbox has an accessible label
- Select All supports checked, unchecked and indeterminate states
- Modal remains keyboard accessible
- Existing focus trap continues working
- Escape closes the modal only when submission is not active
- Close button has an aria-label
- Search inputs have labels
- Destination dropdown is keyboard searchable
- Focus returns to the Reassign button after close
- Selection is not communicated only through colour

---

# 22. Required tests

Use the project’s existing test setup only.

Do not install a new testing framework.

Test where practical:

- Selecting one Client
- Selecting multiple Clients
- Selecting one Mandate
- Selecting multiple Mandates
- Selecting one Candidate
- Selecting multiple Candidates
- Independent selection between categories
- Select All for Clients
- Select All for Mandates
- Select All for Candidates
- Deselecting one record after Select All
- Indeterminate Select All state
- Clearing Select All
- Search preserving existing selections
- Source employee excluded from destinations
- On Leave destination excluded
- Inactive destination excluded
- Confirm disabled without destination
- Confirm disabled without selected records
- IDs must belong to the source employee
- Already-transferred records are rejected
- Unselected records remain unchanged
- Partial mandate reassignment
- Mandate consultant deduplication
- Selected Team Lead replacement
- Unselected Team Lead remains unchanged
- Atomic rollback if one category fails
- Correct affected counts
- Reopening modal shows only remaining records
- Transferred records do not reappear
- Select All does not require sending every record ID
- No notification helper is called
- No notification row is created

---

# 23. Mandatory scenario verification

Verify this exact scenario:

1. Employee A currently has four mandates:
   - Mandate 1
   - Mandate 2
   - Mandate 3
   - Mandate 4

2. Admin opens Reassign.

3. Modal shows all four mandates.

4. Admin selects only:
   - Mandate 1
   - Mandate 2

5. Admin selects Cherry as destination.

6. Admin confirms.

7. Database updates only:
   - Mandate 1
   - Mandate 2

8. Employee A still owns or remains assigned to:
   - Mandate 3
   - Mandate 4

9. Employee Management count for Employee A changes from 4 to 2.

10. Employee Management count for Cherry increases by 2.

11. Admin opens Reassign again for Employee A.

12. Modal shows only:
   - Mandate 3
   - Mandate 4

13. Modal must not show:
   - Mandate 1
   - Mandate 2

14. Admin can select Mandate 3 and transfer it to another Active employee.

15. Opening Reassign again then shows only Mandate 4.

Repeat equivalent verification for:

- Clients
- Candidates

---

# 24. Final verification

Before finishing:

1. Inspect the complete Git diff.
2. Revert all unrelated changes.
3. Revert formatting-only changes outside edited sections.
4. Confirm every modified file is directly necessary.
5. Confirm the existing Employee Management design remains unchanged.
6. Confirm employee status functionality remains unchanged.
7. Confirm Realtime status functionality remains unchanged.
8. Confirm inactive-user logout remains unchanged.
9. Confirm assignment dropdown filtering remains unchanged.
10. Confirm presence functionality remains unchanged.
11. Confirm locked-record functionality remains unchanged.
12. Confirm no notification feature was added.
13. Confirm no existing notification logic was modified.
14. Confirm individual Client selection works.
15. Confirm individual Mandate selection works.
16. Confirm individual Candidate selection works.
17. Confirm each category has independent Select All.
18. Confirm Select All covers the entire category.
19. Confirm individual exclusions work after Select All.
20. Confirm search preserves selection.
21. Confirm only selected records are transferred.
22. Confirm unselected records remain with the source employee.
23. Confirm reopening the modal shows only current remaining assignments.
24. Confirm transferred records do not reappear.
25. Confirm reassignment is atomic.
26. Confirm only Active destination employees are allowed.
27. Confirm historical fields remain unchanged.
28. Confirm no records were deleted.
29. Confirm no unrelated files were modified.
30. Run the existing lint command.
31. Run the existing typecheck command.
32. Run the existing tests.
33. Run the production build.
34. Fix only errors introduced by this enhancement.
35. Do not fix unrelated pre-existing warnings or errors.

---

# 25. Final response format

After implementation, provide:

## Files created

List each new file and why it was required.

## Files modified

List each modified file and explain why it was necessary.

## Existing functionality preserved

Confirm that the following were not changed:

- Employee statuses
- Realtime status updates
- Inactive logout
- On Leave behaviour
- Assignment dropdown filtering
- Presence
- Locked records
- Existing Admin Panel UI
- Notifications

## Frontend implementation

Explain:

- Individual Client selection
- Individual Mandate selection
- Individual Candidate selection
- Select All
- Indeterminate selection
- Search behaviour
- Selection summary
- Reopening-modal refresh behaviour
- Loading and empty states

## Backend implementation

Explain:

- Current-assignment record loading
- Selection validation
- Active destination validation
- Stale-assignment validation
- Individual selected-record handling
- Select All handling
- No-notification handling

## Database implementation

Explain:

- Existing RPC or transaction changes
- Individual record IDs
- Atomic rollback
- Mandate consultant handling
- Team Lead handling
- Remaining-record behaviour
- Affected-count response

## Verification results

Report:

- Lint
- Typecheck
- Tests
- Production build
- Four-mandates partial-reassignment scenario
- Reopening-modal remaining-record scenario

## Scope confirmation

Explicitly confirm:

- No notification feature was added
- No notification code was modified
- No unrelated files were changed
- No unrelated features were redesigned
- No records were deleted
- Only selected records are reassigned
- Unselected records remain assigned to the source employee
- Transferred records do not reappear for the source employee
- Reassignment remains atomic