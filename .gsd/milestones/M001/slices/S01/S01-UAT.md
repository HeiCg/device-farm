# S01: Design tokens + base components — UAT

## Prerequisites
- Device Farm web app running (`npm run web:dev`)

## Visual Checks

### 1. Status Balls
- Navigate to /jobs (if any jobs exist)
- Verify job status indicators are colored circles (not Lucide checkmark/X icons):
  - Blue circle = passed
  - Red circle = failed
  - Pulsing amber circle = running
  - Grey circle = queued/cancelled

### 2. Filters & Pagination
- On /jobs page, verify filter dropdowns are styled (not unstyled browser defaults)
- If enough jobs exist, verify "Load more" button renders with a Material Symbols spinner when loading

### 3. No Broken Styling
- Navigate through all pages (/, /jobs, /devices, /settings)
- Look for unstyled elements (white text on white bg, missing borders, broken layout)
- Note: Pages still have old gh-* references — some elements may render without correct colors until S04/S05 fix them. Focus on shared components (status badges, filters, pagination).
