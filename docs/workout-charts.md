# Workout progress charts

Open your workout CSV, choose **Charts**, create a **Line** chart, and enter a
query under **Calculate chart data with SQL**. The CSV is available as table
`data`; use your actual column names. The demo vault includes `workout-log.csv`.

This query calculates an Epley estimated one-rep maximum for each working set,
then plots the best estimate for each exercise on each training day:

```sql
SELECT date(date) AS training_date,
       exercise,
       MAX(CASE WHEN reps = 1 THEN weight
                ELSE weight * (1.0 + reps / 30.0) END) AS estimated_1rm
FROM data
WHERE weight > 0 AND reps > 0
GROUP BY training_date, exercise
ORDER BY training_date, exercise
```

Choose **Load result columns**, then set **X column** to `training_date`,
**Value column** to `estimated_1rm`, and **Series column** to `exercise`.
Leave the other value columns at **None**. Each exercise becomes a separate
line automatically, so additional exercises need no chart configuration changes.
Use **Preview** to check the result before saving an SVG output path.

For a CSV with one value column per exercise, use **Add value column** to select
as many columns as needed instead. Choose **None** in a value selector to remove
that series. A series column and multiple value columns are alternative layouts.

Numeric X values retain their numeric axis. ISO dates (`YYYY-MM-DD`) and ISO
timestamps use a time axis expressed as days since the earliest UTC date,
shown in the axis title. Gaps between training days keep their actual spacing.
Offset timestamps are normalized to UTC. For other date formats, normalize them
in SQL with `parse_date`, for example `date(parse_date(date, 'DMY'))` for
day-first dates. A chart cannot mix numeric X values and dates.

The calculation uses the weight units in your CSV. Keep units consistent across
rows. Estimated 1RM is a calculation from logged weight and repetitions; select
an appropriate formula and filter for the sets you want to compare. SQL changes
are saved with the chart and rerun when the chart regenerates.

The desktop plugin includes the native helper for these charts. If you have
configured a custom helper, it also needs support for chart SQL and series
columns. Lite does not include SQL or charts.
