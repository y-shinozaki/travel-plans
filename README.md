# Thailand 2026 Travel Plan

タイ旅行（2026年8月12日～17日）のスケジュール＆マップサイト。

**[Live →](https://y-shinozaki.github.io/travel-plans/)**

## Features

- 📅 **Weekly Calendar**: 時間別スケジュール表示（カスタマイズ可能な表示時間）
- 🗺️ **Interactive Map**: CartoDB Voyager タイル、マップクリック連動
- 🎯 **Event Details**: サイドパネルで詳細情報表示
- 🏨 **Hotel Toggle**: ホテル表示/非表示の切り替え
- 🔍 **Location Filters**: カテゴリと日付でスポット検索
- 📱 **Responsive**: モバイル・タブレット対応

## Tech Stack

- **HTML5** / **CSS3** (No build process required)
- **Vanilla JavaScript** (Framework-free)
- **Leaflet.js** (Interactive mapping)
- **Google Fonts**: Fraunces (display), DM Sans (body)
- **Material Symbols** (Icons)

## Design System

[DESIGN.md](./DESIGN.md) に従う Starbucks 風の暖色中立パレット：
- **Primary**: Starbucks Green (`#006241`), Green Accent (`#00754A`)
- **Dark**: House Green (`#1E3932`, headers/footers)
- **Canvas**: Neutral Warm (`#f2f0eb`)
- **Typography**: Fraunces (serif, WONK variation), DM Sans (sans-serif)

## Project Structure

```
.
├── index.html           # Single-page application
├── DESIGN.md            # Design system documentation
├── schedule.csv         # Event data (parsed in HTML)
├── README.md            # This file
└── .gitignore
```

## Local Development

No build tools required. Simply open `index.html` in a browser:

```bash
open index.html
```

Or serve locally with Python:

```bash
python3 -m http.server 8000
# http://localhost:8000
```

## GitHub Pages Deployment

This repository is published to GitHub Pages. To deploy:

1. Push changes to `main` branch
2. GitHub Actions automatically publishes to `gh-pages`
3. Live site: `https://<username>.github.io/travel-plans/`

**Enable Pages in repository settings:**
- Go to Settings → Pages
- Source: `gh-pages` branch (or `main` if deploying from root)

## File Format: schedule.csv

Events are stored in `schedule.csv` with the following columns:

```csv
title,icon,all_day,start_date,end_date,location,description,url
```

- **title**: イベント名（表示用）
- **icon**: Material Symbol icon name
- **all_day**: `true` = 終日イベント（ホテル宿泊など）
- **start_date / end_date**: ISO 8601 形式 (`YYYY-MM-DD` or `YYYY/MM/DD HH:MM`)
- **location**: スポット名（マップに表示）
- **description**: 詳細説明（改行: `\n` エスケープ）
- **url**: リンク先（オプション）

**例:**
```csv
バンコクホテル,ホテル,false,2026/08/12 15:00,2026/08/14 11:00,137 ピラーズ レジデンス バンコク,- 予約番号: 30522440,https://example.com
```

## Key Code Sections

### Calendar Rendering
`renderCalendar()` - Time-slot grid with event layout

### Map Initialization
`L.tileLayer('...CartoDB Voyager...')` - Map tiles

### Event Filtering
`buildFilteredLocations()` - Location filtering by category + date

### Detail Panel
`showPanel(event)` - Slide-in sidebar with event details

## Browser Support

- Chrome/Edge (latest)
- Firefox (latest)
- Safari (iOS 14+)

## License

Private project

## Author

y-shinozaki

---

**Last updated**: 2026-06-07
