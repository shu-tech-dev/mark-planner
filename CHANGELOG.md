# Changelog

## 0.3.0

- Editor dialog: separate time fields (24-hour) with an hour/minute picker and an All day switch, instead of typing the time into the date. Date and time fields show a calendar / clock button that toggles their picker.
- List and sidebar: a task with a start and a deadline shows under Today once it has started (and by its start day before that), instead of only by its deadline.

## 0.2.0

- New files are named after their ID only (`tk2m9a.md`). Existing `<id>-<title>.md` files keep working, and a copied `<id>.md` is renamed to `<new id>.md` when its duplicate ID is fixed.
- Calendar: hovering a day no longer replaces its weekend or holiday color.
- Calendar and Gantt: item types differ by shape, not only color — events are filled pills and vacations are striped bars (the 🌴 prefix is gone); tasks keep the left accent line.

## 0.1.0 — first public preview

- Calendar (month / week / day), Gantt chart, table, kanban board and to-do list views of Markdown files with dates in their frontmatter.
- Editor dialog for creating and editing items; the body's checklist can be toggled there. Alt+click opens the file.
- Drag to move and resize in the calendar and Gantt chart, drag cards between status columns, edit table cells inline.
- Parent tasks and dependencies, priorities (P1–P3), repeating tasks, checklist progress and remaining workdays.
- Weekends, Japanese public holidays and vacations (`type: holiday`).
- Sidebar with open tasks by deadline and a badge for overdue + today.
- Time-sortable IDs as file name prefixes, with detection of duplicated IDs after copying a file.
- Settings screen; English and Japanese UI; light and dark themes.
