# SQL block export

With the development plugin enabled, this handwritten block registers an export
and writes an ordinary Markdown table directly below it. Edit the SQL or save
the source CSV to refresh it. Use **Edit CSV export source or query** to change
between code block and comment syntax or pause automatic updates.

```sql csvzall
SELECT Date, "Coffee Drank (Cups)", "KPIs Delivered"
FROM "Productivity Tracker.csv"
LIMIT 5
```

## Try the viewer workflow

Open **Productivity Tracker.csv**, run a SQLite query, then choose **Insert into
note**. Search for this note and insert a second export. Source CSV edits must
be saved before creating the persistent export.
