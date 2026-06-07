# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Quick Start

**No build tools required.** This is a single-page HTML application. To develop:

```bash
# Local server (Python 3)
python3 -m http.server 8000
# Open http://localhost:8000/index.html
```

**Or open directly:**
```bash
open index.html
```

## Architecture Overview

### Single HTML File (`index.html`)

The entire application is in one file with three main sections:

1. **`<style>` block** (lines ~11–422)
   - CSS variables (colors from `DESIGN.md`, typography, shadows)
   - All component styles (hero, calendar, map, detail panel)
   - Animations (fadeUp, scrollLine, reveal effects)
   - Responsive breakpoints at 960px and 600px

2. **`<body>` HTML** (lines ~710–800)
   - Semantic sections: Hero → Schedule → Map → Footer → Detail Panel
   - All UI structure (no templating)

3. **`<script>` block** (lines ~820–1080)
   - Core functions: `renderCalendar()`, `deriveMapLocations()`, `expandEvents()`
   - Filter logic: `buildFilteredLocations()`, `buildLocationList()`
   - Map initialization with Leaflet + CartoDB Voyager tiles
   - Intersection Observer for scroll-triggered reveals

### Data Flow

```
schedule.csv (parsed from <script> block)
    ↓
expandEvents() → splits multi-day events into daily segments
    ↓
renderCalendar() → time-slot grid layout
deriveMapLocations() → extracts lat/lng, deduplicates
    ↓
buildFilteredLocations() → applies category + date filters
    ↓
buildLocationList() → renders location cards
```

## Key Concepts

### Multi-Day Events (`expandEvents`)

Events spanning multiple days use the `multiDay` structure:

```javascript
{
  multiDay: true,
  startDay: 2,   // day index in `days` array
  endDay: 4,
  startHour: 15, // first day: 15:00→24:00
  endHour: 11,   // last day: 0:00→11:00
  // … other fields
}
```

`expandEvents()` converts each to individual day-segment objects with calculated `visStart` / `visEnd` hours. This lets calendar render them correctly across multiple cells.

### Map Locations (`deriveMapLocations`)

Extracts `{lat, lng}` from all time-based events and deduplicates by coordinate:

```javascript
function deriveMapLocations() {
  const seen = new Map(); // key: "lat,lng"
  events.forEach(ev => {
    if (ev.lat && ev.lng) {
      const key = `${ev.lat},${ev.lng}`;
      if (!seen.has(key)) {
        seen.set(key, {
          name: ev.location,
          icon: ev.icon,
          lat: ev.lat,
          lng: ev.lng,
          evs: [] // populated later
        });
      }
    }
  });
  return [...seen.values()];
}
```

**Important:** All-day events (hotels, flights) intentionally have NO `lat`/`lng` — they're filtered out of the map. Only time-based events populate the map.

### Filtering by Category + Date

`locFilter` state:
- `.cat`: `null` (all) or category string (e.g., `'cat-food'`)
- `.day`: `null` (all days) or day index (0–5)

`buildFilteredLocations()` recalculates visible locations. `buildLocationList()` re-renders cards and updates marker visibility on the map.

### Calendar Time Grid

- `HOUR_H = 44` (CSS height per 1-hour slot)
- `viewStart` / `viewEnd` (user-selected, default 6–22)
- Background gradient for hour lines matches `HOUR_H` (43px transparent + 1px border at 44px)
- Events positioned absolutely within their time slots with `top` and `height` calculated from hour offsets

### Typography & WONK Variation

Fraunces font uses CSS custom property `font-variation-settings`:

```css
.hero-title-en {
  font-variation-settings: "opsz" 144, "WONK" 1;
}
```

- `opsz` (optical size): 144 for huge display, 72 for section titles, 36 for panel/calendar
- `WONK` 1: activates whimsical serif variations (unique to Fraunces)

**Do not remove or change.** These settings are intentional per the design direction.

## Design System (`DESIGN.md`)

All colors are CSS variables. **Strict adherence required:**

- **`--dark` (`#1E3932`)**: House Green, used for header/footer/dark bands
- **`--green` (`#006241`)**: Starbucks Green, primary headings/brand
- **`--green-mid` (`#00754A`)**: Green Accent, CTAs/interactive elements
- **`--canvas` (`#f2f0eb`)**: Neutral Warm, primary page background
- **`--ceramic` (`#edebe9`)**: Ceramic, calendar row backgrounds

Shadows use three-tier system: `--sh-sm`, `--sh-md`, `--sh-lg` per DESIGN.md specifications. Do not invent new colors or shadows.

## External Dependencies

All loaded via CDN (no npm/yarn):

```html
<!-- Google Fonts -->
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,700;9..144,900&family=DM+Sans:wght@300;400;500;600;700&family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20,400,0,0&display=swap">

<!-- Leaflet (mapping) -->
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
```

If updating Leaflet: update version in both `<link>` and `<script>` tags.

## Common Tasks

### Modify Color Palette

1. Find the color in `DESIGN.md` (e.g., Starbucks Green)
2. Update `:root` CSS variable (e.g., `--green`)
3. All usages automatically inherit the change
4. Do NOT use hardcoded hex codes — always use CSS variables

### Add a New Event

1. Add row to `schedule.csv` (or inline in the `events` array)
2. If multi-day, use `multiDay: true` with `startDay`/`endDay`/`startHour`/`endHour`
3. If showing on map, include `lat` and `lng`
4. If all-day (hotel, flight), omit `lat`/`lng` and set `allDay: true`
5. Run `renderCalendar()` and `buildLocationList()` are called automatically on page load

### Adjust Schedule Grid Height

Change `HOUR_H = 44` (line ~553). Then update the repeating-linear-gradient in `.cal-day-col`:

```css
background-image: repeating-linear-gradient(
  to bottom,
  transparent 0px,
  transparent ${HOUR_H - 1}px,
  var(--border) ${HOUR_H - 1}px,
  var(--border) ${HOUR_H}px
);
```

### Change Default View Time

Modify `viewStart` and `viewEnd` (line ~651). Update dropdown initial selections in `buildOptions()`.

### Update Map Tiles

Currently using CartoDB Voyager:

```javascript
L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
  attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors © <a href="https://carto.com/attributions">CARTO</a>',
  subdomains: 'abcd', maxZoom: 19,
}).addTo(map);
```

To change: replace the URL and attribution. Stamen Watercolor or Esri World Imagery are good alternatives.

## Responsive Design

Breakpoints:
- **960px**: Map shifts from side-by-side to stacked layout; hero title shrinks
- **600px**: Detail panel becomes full-width; hero scroll indicator hidden; padding reduced

Mobile-first constraints: Ensure `.detail-panel` works at 100vw width.

## GitHub Pages Deployment

On push to `main`, GitHub Pages serves `index.html` at the repo root. No build step needed.

**Enable in repo settings:**
- Settings → Pages
- Source: `main` branch, root directory

## Notes for Future Development

- **No state management library** — use global variables (`viewStart`, `showHotels`, `locFilter`) sparingly; consider refactor if complexity grows
- **No component framework** — HTML structure is fixed; any dynamic content uses `innerHTML` (safe here since no user input)
- **Leaflet map** — MarkerCluster not implemented; if event count grows significantly, consider adding
- **Fraunces availability** — ensure WONK variation is loaded by Google Fonts; fallback to serif if unavailable
