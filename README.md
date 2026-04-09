# DXI Timing Map Web App

This is a standalone web app for February 2026 scheduling.

## Open the app
- Double-click `/Users/e069875/Library/CloudStorage/OneDrive-DanielJ.EdelmanHoldings,Inc/Escritorio/AppTiming/index.html`
- Or serve the folder with any static server.

## What it does
- One interactive chart covering all weekdays in February 2026 (no day filter)
- Weeks are stacked top-to-bottom (Week 1, Week 2, Week 3, Week 4) like the Excel structure
- 30-minute slots from `8:00 AM` to `5:00 PM`
- Lunch locked from `1:00 PM` to `2:00 PM`
- Paint cells by brand color (click or click-drag)
- Eraser mode
- Totals by brand (full month) and team member (full month)
- Team member monthly hours shown next to each name in the chart
- Collapsible totals panel to free more width for the schedule
- `Export Excel` button: asks for the original template file and downloads an updated workbook with current assignments
- Local persistence in browser storage

## Notes
- Team members, brand legend, and initial February assignments are preloaded from your Excel template (`data.js`).
- You can add/edit brands and add members directly in the app.
- On export, select the original file `TEST_AI - Timing_Map_DXI.xlsx` when prompted to preserve exact structure and styles.
- To reset all saved data, clear browser local storage for this page.
# EDXI2026ColombiaTMAP-QAVersion
