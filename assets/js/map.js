import { collectLocations } from "./events.js";
import { timeLabel } from "./time.js";
import { icon, CATEGORY_ICON } from "./icons.js";
import { CAT_META } from "./calendar.js";

/**
 * タイルは CartoDB Positron（低彩度）を使う。
 * Voyager は彩度が高く、無彩色基調のページから浮くため。
 */
const TILE_URL =
  "https://{s}.basemaps.cartocdn.com/rastertiles/light_all/{z}/{x}/{y}{r}.png";
const TILE_ATTR =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> ' +
  '&copy; <a href="https://carto.com/attributions">CARTO</a>';

const iconOf = (ev) => ev.icon || CATEGORY_ICON[ev.cat];
const keyOf = (ev) => `${ev.lat},${ev.lng}`;

/** カテゴリのアクセント色を tokens.css から読む。色をここに書かない。 */
function accentColor(cat) {
  const name = `--c-${cat.replace("cat-", "")}`;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function createMap({ mapMount, listMount, days, onSelect }) {
  const map = L.map(mapMount, { scrollWheelZoom: false }).setView([13.4, 100.7], 8);
  L.tileLayer(TILE_URL, { attribution: TILE_ATTR, subdomains: "abcd", maxZoom: 19 }).addTo(map);

  let markers = new Map();

  function drawMarkers(locations) {
    for (const marker of markers.values()) map.removeLayer(marker);
    markers = new Map();

    for (const ev of locations) {
      const divIcon = L.divIcon({
        className: "",
        html: `<div class="pin" style="background:${accentColor(ev.cat)}">
                 <svg viewBox="0 0 24 24"><use href="#${iconOf(ev)}"/></svg>
               </div>`,
        iconSize: [30, 30],
        iconAnchor: [15, 15],
      });
      const marker = L.marker([ev.lat, ev.lng], { icon: divIcon })
        .addTo(map)
        .bindPopup(
          `<div class="pop__title">${ev.title}</div>` +
            `<div class="pop__meta">${ev.location || ""}</div>`
        );
      markers.set(keyOf(ev), marker);
    }

    if (locations.length) {
      map.fitBounds(L.latLngBounds(locations.map((e) => [e.lat, e.lng])).pad(0.18));
    }
  }

  function drawList(locations) {
    listMount.innerHTML = "";
    for (const ev of locations) {
      const day = days[ev.startDay];
      const row = document.createElement("div");
      row.className = "loc";
      row.innerHTML = `
        <div class="loc__thumbwrap">
          <img class="loc__thumb" src="${ev.image || ""}" alt="" loading="lazy">
        </div>
        <div>
          <div class="loc__cat" style="color:${accentColor(ev.cat)}">
            ${icon(iconOf(ev), "ico--sm")}${CAT_META[ev.cat].label}
          </div>
          <div class="loc__name">${ev.title}</div>
          <div class="loc__meta">${day.date}（${day.dow}） · ${timeLabel(ev)}</div>
        </div>
        <span class="loc__go">${icon("i-arrow-right", "ico--sm")}</span>`;

      row.addEventListener("click", () => {
        map.flyTo([ev.lat, ev.lng], 14, { duration: 0.8 });
        markers.get(keyOf(ev))?.openPopup();
        onSelect?.(ev);
      });
      listMount.appendChild(row);
    }
  }

  return {
    update(events, catFilter) {
      const locations = collectLocations(events, catFilter);
      drawMarkers(locations);
      drawList(locations);
    },
  };
}
