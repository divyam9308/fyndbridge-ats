Implement the following two changes in the existing **Attendance page** of the ATS Fyndbridge project:

1. Add a **Today’s Attendance** summary inside the existing **Team Attendance** section.
2. Change only the colors of the existing attendance statuses.

Do not redesign or restructure the existing attendance calendar. The only visual changes to the existing calendar must be the specified status colors.

Before editing, inspect the current Attendance page, attendance APIs, Supabase queries, leave records, correction records, user-management logic, existing attendance status helpers, and CSS/theme variables. Use the current architecture rather than building a competing attendance system.

---

# Part 1: Add “Today’s Attendance” to Team Attendance

## Placement

Inside the existing Attendance page, find the **Team Attendance** section.

Add a new block at the very top of that section, before the existing team attendance table, calendar, filters, or other attendance content.

The heading must be:

```text
Today's Attendance
```

Optionally show the current date below the heading using the app’s existing date format.

The date must be calculated in the application’s existing local timezone. Where no timezone helper currently exists, use:

```text
Asia/Kolkata
```

Do not rely on UTC date boundaries for determining “today”.

---

## Summary cards

Show exactly three summary cards:

1. Present
2. Leave
3. Unmarked

Do not add any other summary card.

Each card must contain:

* Status label
* Large count
* A small appropriate icon
* A subtle indication that the count is clickable

Use the existing Fyndbridge styling:

* Existing font family
* Existing border radius
* Existing shadows
* Existing card spacing
* Existing responsive layout system

The cards should appear in a horizontal row on normal desktop widths and stack cleanly on smaller screens.

Use these card accent colors:

* Present: green
* Leave: red
* Unmarked: teal/cyan

Suggested semantic color family:

```js
present: {
  text: '#15803D',
  background: '#ECFDF3',
  border: '#BBF7D0'
}

leave: {
  text: '#DC2626',
  background: '#FEF2F2',
  border: '#FECACA'
}

unmarked: {
  text: '#0891B2',
  background: '#ECFEFF',
  border: '#A5F3FC'
}
```

Use existing design tokens where equivalent tokens already exist. Do not introduce duplicate hardcoded colors unnecessarily.

---

## Count calculation

Use the same employee/user population currently used by the Team Attendance section.

Include only employees who are currently active and should appear in team attendance.

Exclude:

* Deleted users
* Deactivated users
* Removed employees
* Former employees whose employment has ended
* Super-admin/system/service accounts that are already excluded by the existing attendance logic

Respect all existing visibility and permission rules.

For example:

* A normal consultant must not gain access to attendance data they could not already see.
* Admin and Super Admin must retain their existing attendance visibility.
* Existing team, consultant, branch, department, or employee filters must remain effective.

Each employee must appear in no more than one of the three categories.

Use the employee’s final effective attendance state for today after applying the existing correction and leave logic.

### Present

Count an employee as Present when today’s final effective attendance state is present.

This includes:

* Normal Present attendance
* Corrected attendance where the approved/final corrected result is Present

Do not count a pending correction as Corrected until the correction has actually been approved. Use the existing underlying attendance state while a correction is pending.

### Leave

Count an employee under Leave when today has:

* Approved full-day Leave
* Approved Half Day Leave

The Leave card count must include both full-day leave and half-day leave.

Inside the opened people list, retain the employee’s specific status so users can see whether that person is:

* Leave
* Half Day Leave

Do not count leave requests that are still pending approval as approved Leave.

Do not count rejected leave as Leave.

### Unmarked

Count an employee as Unmarked when:

* The employee is expected to work today
* No valid attendance has been marked for today
* The employee does not have an approved leave or half-day leave for today
* There is no other existing final attendance state that should exclude the employee from being considered unmarked

Exclude employees from Unmarked when today is already identified for that employee as:

* Holiday
* Weekly Off
* Approved Leave
* Approved Half Day Leave
* Present
* A final approved corrected attendance result

A leave request that is still pending approval must not be treated as approved leave. Use the current attendance state to determine whether the employee remains unmarked.

Do not classify Holiday or Weekly Off as Unmarked merely because there is no punch-in record.

The three counts do not need to equal the entire company headcount when some employees are excluded because of Holiday, Weekly Off, inactive employment, or existing attendance rules.

---

## Clicking the counts

The large count in each card must be a real accessible button.

When the user clicks the number, open a clean popover, drawer, or modal using the app’s existing popup design system.

Do not navigate to a new page.

The opened list must show the people belonging to that exact category.

### Present list

Title:

```text
Present Employees ({count})
```

For every employee show:

* Profile photo/avatar where available
* Existing initials fallback where no photo exists
* Employee name
* Existing role/designation if available
* A Present badge

### Leave list

Title:

```text
Employees on Leave ({count})
```

For every employee show:

* Profile photo/avatar
* Employee name
* Role/designation if available
* The exact status badge:

  * Leave
  * Half Day Leave

### Unmarked list

Title:

```text
Unmarked Employees ({count})
```

For every employee show:

* Profile photo/avatar
* Employee name
* Role/designation if available
* Unmarked badge

The list must:

* Have a maximum height
* Scroll internally when there are many employees
* Keep the header visible where practical
* Close through an X button
* Close when pressing Escape
* Close when clicking outside if the existing popup component supports that behaviour
* Show a clean empty state if the count is zero

Example empty state:

```text
No employees in this category today.
```

Do not render hundreds of employees without a scroll container.

---

## Data-fetching requirements

Do not make one independent API request for each summary card.

Fetch or derive all three counts and their employee lists together.

Prefer this order:

1. Reuse attendance and employee data already loaded by Team Attendance.
2. Extend the existing attendance query or response.
3. Add one consolidated API request only if the current data is insufficient.

Counts and displayed lists must come from the same normalized dataset so they cannot disagree.

Avoid:

* N+1 employee queries
* Separate profile queries for every employee
* Continuous polling
* Refetching the whole page whenever the popup opens
* Additional Supabase subscriptions unless the page already uses them

When attendance, leave approval, or correction approval changes successfully, update or invalidate the relevant cached data so Today’s Attendance refreshes correctly.

Use stable loading placeholders with reserved height so the new cards do not create layout shifting.

Show an existing-style error state if the attendance summary fails to load. Do not display false zero counts when the API request actually failed.

---

# Part 2: Change attendance status colors

Change only the colors of existing attendance statuses.

Do not change:

* Calendar layout
* Calendar size
* Cell spacing
* Text
* Labels
* Icons
* Font sizes
* Border radius
* Status logic
* Date logic
* Click behaviour
* Tooltips
* Modal design
* Existing filters
* Existing cards
* Existing attendance calculations

Apply the updated colors consistently wherever the status is displayed, including:

* Attendance calendar cells
* Status pills
* Status badges
* Calendar legends
* Colored dots
* Employee attendance details
* Team Attendance table
* Attendance popup/modals
* Monthly summaries
* Any mobile attendance view
* Any other attendance status component using the same status definitions

Centralize the color mapping if the same mapping is currently duplicated in multiple components.

Do not centralize unrelated attendance logic or perform a large refactor.

---

## Required color mapping

### Present

Present must be green.

Suggested palette:

```js
text: '#15803D'
background: '#ECFDF3'
border: '#BBF7D0'
dot: '#22C55E'
```

---

### Leave

Leave must be red.

Suggested palette:

```js
text: '#DC2626'
background: '#FEF2F2'
border: '#FECACA'
dot: '#EF4444'
```

---

### Half Day Leave

Half Day Leave must also be red.

Use the same semantic red family as Leave.

It may use a slightly different background opacity only if required to preserve existing UI contrast, but it must not look orange, yellow, pink, or gold.

Preferred mapping:

```js
text: '#DC2626'
background: '#FFF1F2'
border: '#FECDD3'
dot: '#FB7185'
```

The text must still clearly read as red.

---

### Corrected

Corrected is already blue and must remain blue.

Preserve the exact existing Corrected blue colors unless there is a contrast/accessibility problem.

Do not unnecessarily change the current Corrected shade.

---

### Pending Correction

Pending Correction must use the Fyndbridge golden color.

First inspect the existing theme, logo styles, dashboard styles, and CSS variables for the golden brand color already used by Fyndbridge.

Reuse the existing brand-gold token where available.

Fallback palette only when no brand-gold token exists:

```js
text: '#A16207'
background: '#FFFBEB'
border: '#FDE68A'
dot: '#D4A017'
```

---

### Leave Pending Approval

Leave Pending Approval must use the same Fyndbridge golden color family as Pending Correction.

Use the same semantic color token for both statuses.

Do not use a separate orange status color.

---

### Holiday

Holiday must be purple and visually different from:

* Corrected blue
* Present green
* Fyndbridge gold
* Leave red
* Not Marked teal
* Grey states

Suggested palette:

```js
text: '#7C3AED'
background: '#F5F3FF'
border: '#DDD6FE'
dot: '#8B5CF6'
```

Use an existing matching purple token if one already exists.

---

### Weekly Off

Weekly Off must retain its current grey color.

Do not change its current working grey palette.

---

### Leave Rejected

Leave Rejected must use the same current grey semantic color family as Weekly Off.

Do not show Leave Rejected in red.

---

### Future

Future must use the same current grey semantic color family as Weekly Off and Leave Rejected.

Preserve the existing grey color currently used for these states.

If these three grey states currently use slightly different grey values for hierarchy, preserve those values. They must still clearly belong to the same grey family.

---

### Not Marked

Use a teal/cyan color for Not Marked.

This color must be clearly distinguishable from:

* Present green
* Corrected blue
* Holiday purple
* Leave red
* Pending gold
* Grey states

Suggested palette:

```js
text: '#0E7490'
background: '#ECFEFF'
border: '#A5F3FC'
dot: '#06B6D4'
```

The calendar status may continue to be called `Not Marked`.

The new Today’s Attendance summary card must be called `Unmarked`.

Both should use the same teal/cyan semantic color family.

---

## Status normalization

Inspect all current status values and aliases before applying colors.

The styling must work for existing variants such as:

```text
Present
present
Leave
leave
Half Day
Half Day Leave
half_day_leave
Corrected
Pending Correction
Leave Pending Approval
Leave Pending
Holiday
Weekly Off
Leave Rejected
Future
Not Marked
Unmarked
```

Use the project’s existing status normalization utility where available.

Do not change database values merely to apply colors.

Do not create a database migration solely for these visual changes.

---

# Accessibility

Ensure:

* Text remains readable against the new background colors
* Status is never communicated using color alone
* Existing status text remains visible
* Count buttons have accessible labels

Examples:

```text
View 14 present employees
View 3 employees on leave
View 5 unmarked employees
```

Maintain visible keyboard focus styling.

Do not remove focus outlines.

---

# Responsive behaviour

Desktop:

* Three cards in one row

Tablet:

* Cards may wrap cleanly as required

Mobile:

* Cards may stack vertically
* Popup/modal must remain within the viewport
* Employee list must scroll internally
* No horizontal page overflow

Do not redesign the rest of the Attendance page for mobile as part of this task.

---

# Performance and stability

Do not:

* Add unnecessary database tables
* Add a database migration unless the existing data model genuinely cannot support the feature
* Add a new attendance system
* Duplicate leave or attendance calculations
* Add client-side loops that query Supabase separately for each employee
* Introduce continuous polling
* Break existing attendance marking
* Break leave approval
* Break attendance correction
* Break employee removal/deactivation
* Break calendar navigation
* Break financial-year leave logic
* Change existing permissions
* Change unrelated files
* Add fake or demo employees
* Hardcode today’s counts

The counts must always be based on current application data.

---

# Required verification

Test all of the following:

## Today’s Attendance

1. Today’s Attendance appears at the top of Team Attendance.
2. Exactly three cards appear:

   * Present
   * Leave
   * Unmarked
3. Counts are based on today in Asia/Kolkata or the app’s configured timezone.
4. Inactive and removed employees are excluded.
5. An employee with Present attendance appears only under Present.
6. An employee with approved full-day leave appears only under Leave.
7. An employee with approved Half Day Leave appears only under Leave.
8. Leave list retains the specific Leave or Half Day Leave badge.
9. An employee with no attendance and no approved leave appears under Unmarked.
10. An employee on Holiday is not counted as Unmarked.
11. An employee on Weekly Off is not counted as Unmarked.
12. Pending leave is not counted as approved Leave.
13. Rejected leave is not counted as Leave.
14. Approved corrected Present attendance is counted under Present.
15. Pending correction uses the existing effective underlying status.
16. No employee appears in multiple lists.
17. Clicking the Present number opens the correct list.
18. Clicking the Leave number opens the correct list.
19. Clicking the Unmarked number opens the correct list.
20. Popup closes correctly.
21. Long lists scroll without leaving the viewport.
22. Zero-count categories show the correct empty state.
23. Existing attendance permissions remain unchanged.
24. Counts refresh after attendance, leave approval, or correction changes.
25. No unnecessary request is sent merely by opening a list.
26. No layout shift is introduced while the counts load.

## Status colors

27. Present is green.
28. Leave is red.
29. Half Day Leave is red.
30. Corrected remains blue.
31. Pending Correction is Fyndbridge gold.
32. Leave Pending Approval is Fyndbridge gold.
33. Holiday is purple.
34. Weekly Off retains the current grey.
35. Leave Rejected uses the current grey family.
36. Future uses the current grey family.
37. Not Marked uses teal/cyan.
38. Not Marked remains clearly different from Present and Corrected.
39. All legends match the corresponding status pill colors.
40. All calendar cells use the correct status colors.
41. Team Attendance table badges use the same status mapping.
42. No calendar UI, dimensions, text, or behaviour changed apart from colors.

## Regression checks

43. Existing attendance marking still works.
44. Existing attendance correction still works.
45. Existing leave application and approval still work.
46. Existing calendar month navigation still works.
47. Existing employee/team filters still work.
48. Existing employee deactivation/removal rules still work.
49. Existing admin and consultant permissions still work.
50. Production build succeeds.
51. Lint succeeds without introducing new errors.

---

# Final response after implementation

After completing the changes, report:

1. Exact files changed.
2. Where the status color mapping is defined.
3. Where Today’s Attendance is calculated.
4. Whether existing data/API calls were reused.
5. Whether any API endpoint was changed.
6. Whether any database migration was needed.
7. Commands run for lint, tests, and production build.
8. Results of each command.
9. Confirmation that no existing calendar UI was changed apart from colors.
10. Confirmation that no unrelated files were modified.
