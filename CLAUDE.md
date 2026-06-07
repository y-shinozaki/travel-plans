# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Quick Start

No build tools required. This is a single-page HTML application.

```bash
# Option 1: Open directly in browser
open index.html

# Option 2: Serve locally with Python 3
python3 -m http.server 8000
# Then visit http://localhost:8000
```

## Architecture Overview

### Single HTML File (`index.html`)

The entire application lives in one file with three main sections:

1. **`<style>` block** (lines 14–1075)
   - CSS custom properties (tokens) for colors, spacing, typography
   - Responsive breakpoints: 960px (calendar layout) and 600px (mobile)
   - Component styles: hero, calendar grid, map, location filters, detail panel
   - Animations: fadeUp, cardIn, reveal effects

2. **`<body>` HTML** (lines 1078–1165)
   - Semantic structure: hero → schedule → map section → footer → detail panel
   - Calendar container (`#cal`)
   - Leaflet map container (`#leaflet-map`)
   - Filter buttons and location list

3. **`<script>` block** (lines 1167–end)
   - Event data: `days[]`, `catMeta{}`, `events[]`
   - Core functions: `renderCalendar()`, `collectLocations()`, `expandEvents()`
   - Map initialization with Leaflet + CartoDB Voyager tiles
   - Filter state: `locFilter`, `viewStart`, `viewEnd`, `showHotels`

### Key Data Structures

**Event object** (three types):

```javascript
// Type 1: Simple timed event (single day, on calendar and map)
{ d: 0, cat: 'cat-food', icon: 'restaurant', title: '...',
  start: 12.5, end: 13.5, time: '12:30 → 13:30',
  location: '...', lat: 13.7563, lng: 100.5018, notes: '...' }

// Type 2: Multi-day event (spans multiple calendar cells and days)
{ multiDay: true, startDay: 0, endDay: 2, startHour: 15, endHour: 11,
  cat: 'cat-hotel', icon: 'hotel', title: '...',
  location: '...', lat: 13.7278, lng: 100.5601, notes: '...' }

// Type 3: All-day event (no map marker, hotels list only)
{ d: 0, icon: 'hotel', title: '...', allDay: true, time: '終日',
  location: '...', notes: '' }
```

**Key constant:**
- `HOUR_H = 44`: Pixel height per 1-hour slot in the calendar grid

### Data Flow

```
events (raw data)
  ↓
expandEvents() → convert multiDay to daily segments
  ↓
renderCalendar() → time-slot grid (respects viewStart/viewEnd)
collectLocations() → extract lat/lng, deduplicate by coordinate
  ↓
buildFilteredLocations() → apply category + date filters
buildLocationList() → render cards, update marker visibility
```

### Time Format

Events use decimal hour format (e.g., `12.5` = 12:30, `15.08` = 15:04):

```javascript
start: 10.58,  // 10:35 (0.58 * 60 ≈ 35 minutes)
end: 15.08     // 15:05 (0.08 * 60 ≈ 5 minutes)
```

Convert: `hours + (minutes / 60)`.

### Map & Filtering State

```javascript
let locFilter = { cat: null, day: null };  // null = show all
let viewStart = 6, viewEnd = 22;           // calendar time range
let showHotels = false;                    // toggle hotel visibility
```

When filter changes, call `buildFilteredLocations()` and `buildLocationList()`.

## Design System

All colors are CSS custom properties (defined in `:root`):

- `--dark`: House Green (#1E3932) — headers, footers
- `--green`: Starbucks Green (#006241) — primary headings
- `--green-mid`: Green Accent (#00754A) — CTAs, active states
- `--canvas`: Neutral Warm (#f2f0eb) — page background
- `--ceramic`: Ceramic (#edebe9) — calendar row backgrounds

See `DESIGN.md` for complete palette and typography system.

**Never use hardcoded hex values.** Always use CSS variables.

## Common Development Tasks

### Add a New Event

1. Add to the `events` array in the `<script>` block
2. If time-specified: set `d` (day index), `start`/`end` (decimal hours), `location`, `lat`/`lng`
3. If multi-day: use `multiDay: true` with `startDay`, `endDay`, `startHour`, `endHour`
4. If all-day (hotel): set `allDay: true`, omit `lat`/`lng`
5. Categorize with `cat` key (e.g., `'cat-food'`, `'cat-sight'`)
6. Include `icon` (Material Symbol name), `title`, `notes`
7. Functions auto-run on page load; for live preview, reload browser

### Change Calendar Grid Height

1. Update `HOUR_H` constant (line ~1170)
2. Update `.cal-day-col` background-image repeating-linear-gradient to match:
   ```css
   repeating-linear-gradient(
     to bottom,
     transparent 0px,
     transparent ${HOUR_H - 1}px,
     var(--border) ${HOUR_H - 1}px,
     var(--border) ${HOUR_H}px
   );
   ```

### Change Calendar Time Range

1. Modify `viewStart` and `viewEnd` in `<script>` (line ~1285)
2. Update dropdown options in `buildOptions()` function to match

### Update Map Tiles

Replace the `L.tileLayer()` call in the map initialization:

```javascript
L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
  attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors © <a href="https://carto.com/attributions">CARTO</a>',
  subdomains: 'abcd', maxZoom: 19,
}).addTo(map);
```

Alternatives: Stamen Watercolor, Esri World Imagery, OpenStreetMap default.

### Modify Colors

1. Find the color in `DESIGN.md` (e.g., Starbucks Green)
2. Update the CSS variable in `:root` (line ~16)
3. All usages inherit the change automatically

## External Dependencies

All loaded via CDN; no npm/build step:

```html
<!-- Google Fonts: Fraunces (display), DM Sans (body) -->
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,700;9..144,900&family=DM+Sans:wght@300;400;500;600;700&family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20,400,0,0&display=swap">

<!-- Leaflet (mapping) -->
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
```

When updating Leaflet, match version in both `<link>` and `<script>` tags.

## Responsive Design

**Breakpoints:**
- **960px**: Map + sidebar shifts to vertical stack; hero title shrinks
- **600px**: Detail panel goes full-width; mobile-optimized padding; hero scroll indicator hidden

All breakpoints defined in `@media` queries in the `<style>` block.

## Browser Support

- Chrome/Edge (latest)
- Firefox (latest)
- Safari (iOS 14+)

## Deployment

GitHub Pages deployment on push to `main`:

1. Ensure repo settings enable Pages (source: `main` branch, root directory)
2. Push changes to `main` — site auto-updates
3. Live: `https://y-shinozaki.github.io/travel-plans/`

## Notes for Future Development

- No state management library — global variables (`viewStart`, `showHotels`, `locFilter`) are acceptable; consider refactor if complexity grows beyond current scope
- No component framework — all DOM updates via `innerHTML` (safe here since no user input)
- Leaflet MarkerCluster not implemented; add if event density grows significantly
- Fraunces WONK variation (whimsical serif) is intentional per design direction — do not remove
