# S03: Dashboard reskin — UAT

## Prerequisites
- Device Farm web app running (`npm run web:dev`)
- Server running with health endpoint

## Visual Checks

### 1. Infrastructure Health Widget
- Top-left card: large weather icon (sunny/cloudy/rainy based on fleet health %)
- Health percentage text below icon
- 3-column metric grid: Online (blue), Maintenance (yellow), Error (red) counts

### 2. Queue Status
- Top-right card: per-platform queue depth (Android / iOS)
- Text summary below counts

### 3. Alert Banners
- If any devices are in error/offline state: red alert banner per device with name and ID
- If queue depth > 3: yellow warning banner about scaling runners
- If everything is healthy: no alert banners shown

### 4. Device Table
- Jenkins-table with columns: S (status ball), W (weather icon), Name, Platform, State, Current Job
- Platform shown as mono badge
- Current Job links to job detail page (or dash for no job)

### 5. Quick Actions
- 4-column grid: Maintenance, Build History, Logs, Settings
- Each card links to a real route

### 6. Page Header
- "Fleet Overview" title with subtitle
- CONFIGURE → /settings, BUILD NOW → /jobs buttons
