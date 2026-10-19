# Bundled CSV viewer demo

This vault is a small test bed for csvzall Lite on desktop, phones, and tablets.
The bundled viewer works offline without a helper binary. Enable community
plugins and csvzall Lite, then open a sample CSV from the file explorer.
On desktop, keep the full native csvzall plugin disabled in this vault; both
plugins register as the CSV handler.

## Sample files

- [[Productivity Tracker.csv]] is the same small numeric fixture as the desktop demo.
- [[Tasks.csv]] has text, status, and priority columns for editing and sorting.
- [[CSV edge cases.csv]] has commas, quotes, multiline text, Unicode, and blank cells.
- [[Projects/Project tasks.csv]] exercises CSV files and new-file creation in a folder.
- [[Variable width.tsv]] has uneven tab-separated rows and an incomplete header.

## Test checklist

1. Open Tasks.csv. Edit a title and a priority, save, close, and reopen. Check
   that both edits survived. Sort and filter the grid.
2. On Android, edit a cell near the bottom or right edge with the keyboard open.
   Check that the cell remains visible and the toolbar and grid stay stable.
   Open and close grid menus while editing; try portrait and landscape.
3. Start saving and continue editing. Check that the newer edit still needs
   saving. Switch notes with an unsaved edit and check the save/discard/cancel
   choices. Use a disposable copy for simulating a rejected file write.
4. Change Obsidian's light/dark mode, accent, and theme while the viewer is open.
   Check grid and menu colors, focus, and unsaved edits.
5. Open CSV edge cases.csv. Check that quoted commas, quotes, multiline values,
   café, 日本語, and emoji render correctly and survive an edit/save/reopen.
6. Use New CSV from the command palette and ribbon. With the nested CSV active,
   create another file and check its folder. Try New CSV from the folder menu.
   Repeat creation to check that existing filenames are preserved.
7. On mobile, use the viewer navigation button to return to the file explorer. Open another
   CSV, close/reopen panes, and restart Obsidian; check that the right file loads.
8. After the first successful load, enable airplane mode and reopen a CSV.
   Confirm viewing and saving still work.
9. Open Variable width.tsv. Check that all four rows and the SURPRISE cell are
   visible under A, B, C. On mobile, Options should be absent from the toolbar
   and More actions. In a disposable copy, edit and save; confirm the file still
   uses tabs and keeps every row. On desktop, Options should explain why headers
   are disabled and how to repair the first row.

Keep temporary edits in a disposable copy, or review fixture diffs after testing.
The sample notes contain no desktop chart automation or helper configuration.
