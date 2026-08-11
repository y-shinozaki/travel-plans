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
 * 表示中のロケーションを表す文字列。**署名は 2 つある。分けたままにすること。**
 *
 * 1 つにまとめていたころは、タイトルを 1 文字直しただけでも「変わった」と
 * 判定され、再描画のついでに fitBounds が走って**ユーザーが選んだ地点・
 * ズーム・開いていたポップアップが初期位置へ巻き戻っていた**（設計書 §13）。
 * 地図を動かしてよいのは「どこにピンが立つか」が変わったときだけで、
 * 「ピンに何が書いてあるか」が変わっただけなら動かす理由が無い。
 *
 * - bounds: 地図の当てはめ（fitBounds）をやり直すかの判断。地点の集合そのもの
 * - content: マーカーと一覧を作り直すかの判断。表示に出る値すべて
 *
 * content に無い値を drawList / drawMarkers が読み始めたら、content にも足すこと
 * （足し忘れると、その値の編集が画面に出ないまま黙って無視される）。
 */
export const boundsSignatureOf = (locations) =>
  JSON.stringify(locations.map((ev) => [ev.id, ev.lat, ev.lng]));

export const contentSignatureOf = (locations) =>
  JSON.stringify(
    locations.map((ev) => [
      ev.id,
      ev.lat,
      ev.lng,
      ev.cat,
      ev.icon ?? null,
      ev.title,
      ev.location ?? null,
      ev.image ?? null,
      ev.startDay,
      ev.allDay ?? false,
      ev.start ?? null,
      ev.end ?? null,
    ])
  );

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
  // 2 つ持つ理由は boundsSignatureOf / contentSignatureOf のコメント
  let boundsSignature = null;
  let contentSignature = null;

  function drawMarkers(locations, refit) {
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

    if (refit && locations.length) {
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

      // 地図の移動に失敗しても詳細シートは開く。行をクリックした人にとっての
      // 主目的は詳細を見ることで、地図が動かないのは副作用の失敗にすぎない。
      // ここで投げると onSelect まで届かず、画面が完全に無反応になる。
      const activate = () => {
        try {
          map.flyTo([ev.lat, ev.lng], 14, { duration: 0.8 });
          markers.get(keyOf(ev))?.openPopup();
        } catch (error) {
          console.error(`map: 地点への移動に失敗しました（${ev.id} / ${ev.title}）`, error);
        }
        onSelect?.(ev);
      };
      const label = `${catMeta(ev.cat).label}、${day.date}（${day.dow}） · ${timeLabel(ev)}`;
      makeSelectable(row, ev, label, activate);
      listMount.appendChild(row);
    }
  }

  return {
    update(events, hiddenCats) {
      const locations = collectLocations(events, hiddenCats);
      // 表示時間帯を変えただけでは集合は変わらない。それでも再構築すると
      // fitBounds が走り、ユーザーが選んだ地点・ズーム・ポップアップを
      // 巻き戻してしまう（マーカーと一覧の作り直しも丸ごと無駄になる）。
      const nextContent = contentSignatureOf(locations);
      if (nextContent === contentSignature) return;
      contentSignature = nextContent;

      // 地点の集合が変わったときだけ地図を当てはめ直す。内容だけの編集
      // （タイトルを 1 文字直した、など）で動かすと、選んでいた地点・ズーム・
      // 開いていたポップアップが初期位置へ巻き戻る
      const nextBounds = boundsSignatureOf(locations);
      const refit = nextBounds !== boundsSignature;
      boundsSignature = nextBounds;

      drawMarkers(locations, refit);
      drawList(locations);
    },
  };
}
