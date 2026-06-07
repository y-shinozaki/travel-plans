# Thailand 2026 Travel Plan

A single-page schedule and map application for planning a trip to Thailand (August 12-17, 2026).

**Live Site**: https://y-shinozaki.github.io/travel-plans/

## Features

- Weekly calendar view with hourly time slots and customizable time range
- Interactive map powered by Leaflet and CartoDB Voyager tiles
- Location filtering by category and date
- Event details panel with quick access to information
- Hotel/accommodation toggle on the map
- Fully responsive design for mobile, tablet, and desktop
- No build process required—just open `index.html`

## Technology

- **HTML5, CSS3**: Single-file application with semantic structure
- **JavaScript**: Vanilla JavaScript, no frameworks
- **Leaflet.js**: Interactive map library
- **Google Fonts**: Fraunces (serif display), DM Sans (sans-serif body)
- **Material Symbols**: Icon library for events

## Getting Started

### Local Development

No build tools needed. Simply:

```bash
# Open directly in browser
open index.html

# Or serve locally with Python
python3 -m http.server 8000
# Then visit http://localhost:8000
```

## Project Structure

```
travel-plans/
├── index.html          Single-page application with all code
├── DESIGN.md           Design system and color palette documentation
├── schedule.csv        Event data (embedded in HTML <script>)
├── README.md           This file
├── .claude/settings.json
├── .mcp.json
└── .gitignore
```

## Design System

See [DESIGN.md](./DESIGN.md) for the complete design system.

**Color Palette**:
- Primary: Starbucks Green (#006241)
- Accent: Green (#00754A)
- Dark: House Green (#1E3932)
- Canvas: Neutral Warm (#f2f0eb)

**Typography**:
- Display: Fraunces (serif with WONK variation for unique character styling)
- Body: DM Sans (sans-serif)

## Key Features

### Calendar View
- Horizontal timeline with hourly slots (configurable view range: 6am–10pm)
- Multi-day events span across calendar cells
- Click events to show details in the side panel

### Map Integration
- Location markers for all timed events
- Hotels and all-day accommodations appear in a separate list
- Toggle hotel visibility on/off
- Click markers to highlight location details

### Event Filtering
- Filter by category (food, sightseeing, etc.)
- Filter by date
- Real-time update of map markers and location list

### Responsive Design
- Stacks vertically on screens below 960px
- Detail panel goes full-width below 600px
- Mobile-friendly touch targets

## Architecture

### Data Flow

```
Events (defined in <script>)
  ↓
expandEvents() → convert multi-day events to daily segments
  ↓
renderCalendar() → time-slot grid
deriveMapLocations() → extract lat/lng, deduplicate
  ↓
buildFilteredLocations() → apply filters
  ↓
buildLocationList() → render cards and update map
```

### Event Structure

Events support two formats:

**Time-based event** (appears on calendar and map):
```javascript
{
  title: "Lunch at Restaurant",
  icon: "restaurant",
  start: "2026/08/13 12:00",
  end: "2026/08/13 13:30",
  location: "Bangkok",
  lat: 13.7563,
  lng: 100.5018,
  category: "food"
}
```

**Multi-day event** (spans multiple calendar days):
```javascript
{
  title: "Bangkok Hotel",
  icon: "hotel",
  multiDay: true,
  startDay: 0,
  endDay: 2,
  startHour: 15,
  endHour: 11,
  location: "137 Pillars House Bangkok",
  lat: 13.7325,
  lng: 100.5064
}
```

**All-day event** (no map marker, hotels list only):
```javascript
{
  title: "Hotel Stay",
  icon: "hotel",
  allDay: true,
  start: "2026/08/12",
  end: "2026/08/14",
  location: "Bangkok"
  // Note: no lat/lng, so does not appear on map
}
```

## Customization

### Change Colors
Update CSS variables in `:root` in `index.html`:
```css
--dark: #1E3932;
--green: #006241;
--green-mid: #00754A;
--canvas: #f2f0eb;
```

All colors must be defined as CSS variables. Never use hardcoded hex values.

### Adjust Calendar Grid Height
Change `HOUR_H = 44` in the `<script>` section, then update the repeating-linear-gradient background in `.cal-day-col` CSS to match.

### Change Time Range
Edit `viewStart` and `viewEnd` variables in the `<script>` block, and update the dropdown options in `buildOptions()`.

### Update Map Tiles
Replace the `L.tileLayer()` URL in the `<script>` section. Currently uses CartoDB Voyager. Alternatives: Stamen Watercolor, Esri World Imagery, OpenStreetMap.

## Deployment

This repository is deployed to GitHub Pages.

### First-time setup:
1. Go to repository Settings → Pages
2. Select source: `main` branch, root directory
3. Save

### To deploy:
Push to the `main` branch. The site updates automatically.

## Browser Support

- Chrome/Edge (latest)
- Firefox (latest)
- Safari (iOS 14+)

## License

Private project

## Author

y-shinozaki

---

**Last updated**: June 7, 2026
