import { collectLocations } from "./events.js";
import { timeLabel } from "./time.js";
import { icon } from "./icons.js";
import { catMeta, iconOf, accentColor } from "./categories.js";
import { makeSelectable, escapeHtml } from "./dom.js";

/**
 * タイルは CartoDB Positron（低彩度）を使う。
 * Voyager は彩度が高く、無彩色基調のページから浮くため。
 */
const TILE_URL =
  "https://{s}.basemaps.cartocdn.com/rastertiles/light_all/{z}/{x}/{y}{r}.png";
const TILE_ATTR =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> ' +
  '&copy; <a href="https://carto.com/attributions">CARTO</a>';

const keyOf = (ev) => `${ev.lat},${ev.lng}`;

/**
 * 表示中のロケーション集合を表す文字列。
 * 時間帯セレクトの変更では集合が変わらないため、これが同じなら再描画しない。
 */
const signatureOf = (locations) => locations.map((ev) => `${ev.id}@${keyOf(ev)}`).join("|");

/**
 * ポップアップとロケーション行の HTML 組み立ては、DOM も Leaflet も要らない
 * 純粋な文字列生成として切り出してある（Node のテストから直接呼べるようにするため）。
 * イベント由来の文字列は必ず escapeHtml を通す。
 */
export function popupHtml(ev) {
  return (
    `<div class="pop__title">${escapeHtml(ev.title)}</div>` +
    `<div class="pop__meta">${escapeHtml(ev.location || "")}</div>`
  );
}

export function locationRowHtml(ev, day, accent) {
  // src="" はページ自身の URL に解決され、ブラウザが HTML を画像として
  // もう一度ダウンロードしてしまう。画像が無い行では <img> ごと出さない
  // （.loc__thumbwrap の下地だけが見える）。
  const thumb = ev.image
    ? `<img class="loc__thumb" src="${escapeHtml(ev.image)}" alt="" loading="lazy">`
    : "";
  return `
        <div class="loc__thumbwrap">${thumb}</div>
        <div>
          <div class="loc__cat" style="color:${escapeHtml(accent)}">
            ${icon(iconOf(ev), "ico--sm")}${escapeHtml(catMeta(ev.cat).label)}
          </div>
          <div class="loc__name">${escapeHtml(ev.title)}</div>
          <div class="loc__meta">${escapeHtml(day.date)}（${escapeHtml(day.dow)}） · ${escapeHtml(timeLabel(ev))}</div>
        </div>
        <span class="loc__go">${icon("i-arrow-right", "ico--sm")}</span>`;
}

export function createMap({ mapMount, listMount, days, onSelect }) {
  const map = L.map(mapMount, { scrollWheelZoom: false }).setView([13.4, 100.7], 8);
  L.tileLayer(TILE_URL, { attribution: TILE_ATTR, subdomains: "abcd", maxZoom: 19 }).addTo(map);

  let markers = new Map();
  let signature = null;

  function drawMarkers(locations) {
    for (const marker of markers.values()) map.removeLayer(marker);
    markers = new Map();

    for (const ev of locations) {
      const divIcon = L.divIcon({
        className: "",
        html: `<div class="pin" style="background:${escapeHtml(accentColor(ev.cat))}">
                 <svg viewBox="0 0 24 24"><use href="#${escapeHtml(iconOf(ev))}"/></svg>
               </div>`,
        iconSize: [30, 30],
        iconAnchor: [15, 15],
      });
      const marker = L.marker([ev.lat, ev.lng], { icon: divIcon })
        .addTo(map)
        .bindPopup(popupHtml(ev));
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
      row.innerHTML = locationRowHtml(ev, day, accentColor(ev.cat));

      const activate = () => {
        map.flyTo([ev.lat, ev.lng], 14, { duration: 0.8 });
        markers.get(keyOf(ev))?.openPopup();
        onSelect?.(ev);
      };
      const label = `${catMeta(ev.cat).label}、${day.date}（${day.dow}） · ${timeLabel(ev)}`;
      makeSelectable(row, ev, label, activate);
      listMount.appendChild(row);
    }
  }

  return {
    update(events, catFilter) {
      const locations = collectLocations(events, catFilter);
      // 表示時間帯を変えただけでは集合は変わらない。それでも再構築すると
      // fitBounds が走り、ユーザーが選んだ地点・ズーム・ポップアップを
      // 巻き戻してしまう（マーカーと一覧の作り直しも丸ごと無駄になる）。
      const next = signatureOf(locations);
      if (next === signature) return;
      signature = next;

      drawMarkers(locations);
      drawList(locations);
    },
  };
}
