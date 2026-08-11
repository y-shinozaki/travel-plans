import test from "node:test";
import assert from "node:assert/strict";
import {
  nextEventId,
  mergeEvent,
  withEvent,
  withoutEvent,
  createEventEditor,
} from "../assets/js/event-editor.js";
import { emptyEvent, readEventForm, formProblems } from "../assets/js/event-form.js";
import { validateEvents } from "../assets/js/validate.js";
import { decToHHMM } from "../assets/js/time.js";

// Phase B4 で events.json が暗号文になり、テストから中身を読めなくなったため
// フィクスチャに切り替えた（経緯は tests/data.test.js の冒頭コメント）。
// フィクスチャは併合・採番・丸めの検査に必要な性質（image を持つ 1 件、
// 時刻を持つ複数件、複数日、終日）を意図的に備えている。
import { ITINERARY as DATA } from "./fixtures/itinerary.js";

/**
 * フォームに表示される値を id → 文字列の表にする（描画せずに読み出しを再現する）。
 * 時刻は event-form.js の timeValue と同じく decToHHMM で出す ── 固定値にすると
 * 「開いてそのまま保存した」ことにならず、往復の丸めも試せない。
 */
function valuesOf(ev) {
  return {
    "f-title": ev.title ?? "",
    "f-cat": ev.cat,
    "f-allday": ev.allDay ? "on" : "",
    "f-sday": String(ev.startDay),
    "f-eday": String(ev.endDay),
    "f-start": ev.allDay ? "" : decToHHMM(ev.start ?? 9),
    "f-end": ev.allDay ? "" : decToHHMM(ev.end ?? 10),
    "f-loc": ev.location ?? "",
    "f-lat": ev.lat == null ? "" : String(ev.lat),
    "f-lng": ev.lng == null ? "" : String(ev.lng),
    "f-url": ev.url ?? "",
    "f-notes": ev.notes ?? "",
  };
}
const getter = (values) => (id) => values[id] ?? "";

/** フォームを開いてタイトルだけ書き換え、保存した結果のイベントを返す。 */
function editTitle(original, title) {
  const values = { ...valuesOf(original), "f-title": title };
  return mergeEvent(original, readEventForm(getter(values)));
}

/* ── id の採番 ────────────────────────────────────────── */

test("採番した id は既存と衝突しない", () => {
  const events = [{ id: "ev-001" }, { id: "ev-002" }];
  assert.equal(nextEventId(events), "ev-003");
});

test("件数と最大値がずれていても衝突しない", () => {
  // 途中を削除したデータ。件数（2）から作る ev-003 は埋まっている
  const events = [{ id: "ev-001" }, { id: "ev-003" }];
  assert.equal(nextEventId(events), "ev-004");
});

test("実データの次の id は既存のどれとも重ならない", () => {
  const id = nextEventId(DATA.events);
  assert.ok(!DATA.events.some((ev) => ev.id === id), `${id} は既存の id と重なっています`);
  // 採番したイベントを足したデータ全体が検査を通ること（重複はここでしか出ない）
  const added = { id, ...readEventForm(getter(valuesOf({ ...DATA.events[0], allDay: false }))) };
  validateEvents(withEvent(DATA, added));
});

/* ── 併合（保存で既存の値を消さないこと） ─────────────── */

test("フォームに無い image / imagePos / icon は編集で消えない", () => {
  const original = {
    id: "ev-999",
    cat: "cat-sight",
    title: "元のタイトル",
    allDay: false,
    startDay: 0,
    endDay: 0,
    location: "",
    lat: null,
    lng: null,
    url: "",
    notes: "",
    start: 9,
    end: 10,
    image: "https://example.com/a.jpg",
    imagePos: "center 30%",
    icon: "i-boat",
  };
  const updated = editTitle(original, "直したタイトル");

  assert.equal(updated.title, "直したタイトル");
  assert.equal(updated.image, "https://example.com/a.jpg");
  assert.equal(updated.imagePos, "center 30%");
  assert.equal(updated.icon, "i-boat");
  assert.equal(updated.id, "ev-999");
});

test("併合しないと消えることを確かめる", () => {
  // ここが「なぜ mergeEvent が要るのか」。readEventForm の戻り値をそのまま
  // 保存すると、画像を持つイベントからキーごと image が消える。しかも
  // image は省略できる項目なので validateEvents は何も言わない
  //
  // 下限は「フィクスチャから image が消えたら気付く」ための番人。
  // 実データを読んでいた頃は 24 件あった（B4 で読めなくなった）
  const withImage = DATA.events.filter((ev) => ev.image);
  assert.ok(withImage.length >= 2, `画像を持つイベントが ${withImage.length} 件しかありません`);

  const naive = readEventForm(getter(valuesOf(withImage[0])));
  assert.equal("image" in naive, false);
  validateEvents({ ...DATA, events: [{ ...naive, id: withImage[0].id }] }); // 検査は通ってしまう

  const merged = mergeEvent(withImage[0], naive);
  assert.equal(merged.image, withImage[0].image);
});

test("実データのどの予定でも、タイトルだけの編集で省略項目が残る", () => {
  for (const original of DATA.events) {
    const values = { ...valuesOf(original), "f-title": `${original.title}（改）` };
    const input = readEventForm(getter(values));

    // 「既存のどの予定も、開いてそのまま保存できる」。ここが赤くなるのは
    // 実データがフォームの規則に反したときで、利用者から見ると
    // 「開いて何も触っていないのに保存できない予定がある」状態になる
    assert.deepEqual(
      formProblems(input, DATA.days.length),
      [],
      `${original.id}: 開いてそのまま保存できません`
    );

    const updated = mergeEvent(original, input);
    for (const key of ["image", "imagePos", "icon"]) {
      assert.equal(
        Object.hasOwn(updated, key),
        Object.hasOwn(original, key),
        `${original.id}: ${key} のキーが増減しています`
      );
      assert.equal(updated[key], original[key], `${original.id}: ${key} の値が変わっています`);
    }
    assert.equal(updated.title, `${original.title}（改）`);
    // 保存前に必ず通す全体検査を、1 件ずつ差し替えた形でも通ること
    validateEvents(withEvent(DATA, updated));
  }
});

test("触っていない時刻に往復の丸めを載せない", () => {
  // 10.58 → "10:35" → 10.583333333333334 の揺れ。
  // 表示は変わらないが、タイトルだけ直したときの公開差分にノイズが載る。
  // 下限は「フィクスチャから時刻つきイベントが消えたら気付く」ための番人
  const wobbly = DATA.events.filter((ev) => !ev.allDay && Number.isFinite(ev.start));
  assert.ok(wobbly.length >= 5, `時刻を持つイベントが ${wobbly.length} 件しかありません`);

  for (const original of wobbly) {
    const updated = editTitle(original, `${original.title}（改）`);
    assert.equal(updated.start, original.start, `${original.id}: start が変わっています`);
    assert.equal(updated.end, original.end, `${original.id}: end が変わっています`);
    // 「値が同じ」であって「Object.is で同一」ではないことに注意（-0 は出ない）
    assert.equal(Object.is(updated.start, original.start), true);
  }
});

test("時刻を実際に変えたときは新しい値が入る", () => {
  // 上の「残す」が効きすぎて、変更まで無視されないこと
  const original = DATA.events.find((ev) => !ev.allDay && Number.isFinite(ev.start));
  const values = { ...valuesOf(original), "f-start": "08:15", "f-end": "09:45" };
  const updated = mergeEvent(original, readEventForm(getter(values)));
  assert.equal(updated.start, 8.25);
  assert.equal(updated.end, 9.75);
});

test("併合しても id はフォームの外から変えられない", () => {
  const original = { id: "ev-001", cat: "cat-food", title: "a", allDay: true, startDay: 0, endDay: 0 };
  // フォームは id を返さないが、万一混ざっても元の id が勝つこと
  const merged = mergeEvent(original, { id: "ev-999", title: "b" });
  assert.equal(merged.id, "ev-001");
});

test("終日に切り替えると start / end が落ちる", () => {
  const original = {
    id: "ev-001", cat: "cat-hotel", title: "泊まる", allDay: false,
    startDay: 0, endDay: 0, start: 15, end: 23,
  };
  const values = { ...valuesOf(original), "f-allday": "on" };
  const merged = mergeEvent(original, readEventForm(getter(values)));

  assert.equal(merged.allDay, true);
  assert.equal("start" in merged, false, "終日なのに start が残っています");
  assert.equal("end" in merged, false, "終日なのに end が残っています");
});

test("終日から時刻ありに戻すと start / end が入る", () => {
  const original = { id: "ev-001", cat: "cat-hotel", title: "泊まる", allDay: true, startDay: 0, endDay: 0 };
  const values = { ...valuesOf(original), "f-allday": "", "f-start": "15:00", "f-end": "23:30" };
  const merged = mergeEvent(original, readEventForm(getter(values)));

  assert.equal(merged.allDay, false);
  assert.equal(merged.start, 15);
  assert.equal(merged.end, 23.5);
});

/* ── 配列の差し替え ──────────────────────────────────── */

test("差し替えは並び順を保ち、元の配列を書き換えない", () => {
  const data = { days: DATA.days, events: [{ id: "a" }, { id: "b" }, { id: "c" }] };
  const next = withEvent(data, { id: "b", title: "新" });

  assert.deepEqual(next.events.map((e) => e.id), ["a", "b", "c"]);
  assert.equal(next.events[1].title, "新");
  assert.equal(data.events[1].title, undefined, "元の配列が書き換えられています");
  assert.notEqual(next.events, data.events);
});

test("知らない id は末尾に足される", () => {
  const data = { days: DATA.days, events: [{ id: "a" }] };
  assert.deepEqual(withEvent(data, { id: "z" }).events.map((e) => e.id), ["a", "z"]);
});

test("days と updatedAt は差し替えで失われない", () => {
  const next = withEvent(DATA, { ...DATA.events[0], title: "変更" });
  assert.equal(next.days, DATA.days);
  assert.equal(next.updatedAt, DATA.updatedAt);
});

test("削除は 1 件だけ取り除く", () => {
  const next = withoutEvent(DATA, DATA.events[3].id);
  assert.equal(next.events.length, DATA.events.length - 1);
  assert.ok(!next.events.some((ev) => ev.id === DATA.events[3].id));
  assert.equal(DATA.events.length, 6, "元の配列が書き換えられています");
  validateEvents(next);
});

/* ── 全体検査が最後の砦であること ─────────────────────── */

test("formProblems は古い dayCount を信じるが、validateEvents は騙されない", () => {
  // 日程を 3 日に縮めたのに、6 日だった頃の dayCount で検査した場合
  const shrunk = { ...DATA, days: DATA.days.slice(0, 2) };
  const ev = { ...DATA.events[0], startDay: 5, endDay: 5 };
  const input = readEventForm(getter(valuesOf(ev)));

  assert.deepEqual(formProblems(input, 6), [], "古い日数では素通りするはず（前提の確認）");
  assert.throws(() => validateEvents(withEvent(shrunk, mergeEvent(ev, input))), /startDay/);
});

test("id が重複したまま保存しようとすると全体検査が止める", () => {
  const duped = { ...DATA, events: [...DATA.events, { ...DATA.events[0] }] };
  assert.throws(() => validateEvents(duped), /id が重複しています/);
});

/* ══════════════════════════════════════════════════════════
   配線（createEventEditor）

   純粋な部分をいくら覆っても、それを繋ぐ save() / applyChange() が
   素朴な書き方に戻れば image は消えるし、検査を飛ばせば起動しないデータが
   保存できてしまう。このタスクが存在する理由そのものなので、
   ブラウザでの 1 回きりの確認ではなくここで押さえる。
   ══════════════════════════════════════════════════════════ */

/**
 * createEventEditor を Node で動かすための最小の DOM。
 * 用意するのはエディタが実際に触る操作だけ
 * （createElement / querySelector / classList.toggle / addEventListener …）。
 */
function makeNode(tag = "div") {
  const node = {
    tag,
    className: "",
    type: "",
    title: "",
    checked: false,
    value: "",
    innerHTML: "",
    textContent: "",
    children: [],
    attrs: {},
    classes: new Set(),
    listeners: {},
    focused: 0,
    classList: {
      toggle(name, on) {
        if (on) node.classes.add(name);
        else node.classes.delete(name);
      },
    },
    appendChild(child) {
      node.children.push(child);
      return child;
    },
    setAttribute(key, value) {
      node.attrs[key] = String(value);
    },
    removeAttribute(key) {
      delete node.attrs[key];
    },
    addEventListener(type, fn) {
      (node.listeners[type] ??= []).push(fn);
    },
    querySelector(sel) {
      return node.children.find((child) => child.tag === sel) ?? null;
    },
    querySelectorAll() {
      return [];
    },
    scrollIntoView() {},
    focus() {
      node.focused++;
    },
  };
  return node;
}

/** その要素に登録されたリスナーを全部呼ぶ（クリック・変更の代わり）。 */
const fire = (node, type = "click") => {
  for (const fn of node.listeners[type] ?? []) fn();
};

/** 指定したイベントを表示している状態のシート本文。 */
function makeBody(ev) {
  const fields = {};
  for (const [id, value] of Object.entries(valuesOf(ev))) {
    const node = makeNode("input");
    if (id === "f-allday") {
      node.type = "checkbox";
      node.checked = value !== "";
    } else {
      node.value = value;
    }
    fields[id] = node;
  }
  fields["f-error"] = makeNode("div");
  fields["f-times"] = makeNode("div");

  const body = makeNode("div");
  body.fields = fields;
  body.querySelector = (sel) => fields[sel.replace(/^#/, "")] ?? null;
  // clearProblems が「いま aria-invalid が付いている欄」を引くのに使う。
  // 実 DOM の属性セレクタと同じく、付いている要素だけを返す
  body.querySelectorAll = (sel) =>
    sel === "[aria-invalid]"
      ? Object.values(fields).filter((f) => f.attrs["aria-invalid"] != null)
      : [];
  return body;
}

function fakeSheet() {
  const sheet = {
    opens: [],
    closes: 0,
    open(title, body, foot = []) {
      sheet.opens.push({ title, body, foot });
    },
    close() {
      sheet.closes += 1;
    },
  };
  return sheet;
}

/**
 * document と CSS を差し替えて run を実行する。
 * console.error は捕まえて run に渡す（出力を汚さず、記録されたことも確かめる）。
 */
function withDom(run) {
  const previous = { doc: globalThis.document, css: globalThis.CSS, error: console.error };
  const errors = [];
  globalThis.document = {
    createElement: (tag) => makeNode(tag),
    // 再描画後のカレンダーは存在しないので、フォーカスは fallbackFocus へ落ちる
    querySelector: () => null,
  };
  globalThis.CSS = { escape: (value) => value };
  console.error = (...args) => errors.push(args.map(String).join(" "));
  try {
    return run(errors);
  } finally {
    globalThis.document = previous.doc;
    globalThis.CSS = previous.css;
    console.error = previous.error;
  }
}

/** data の中の ev を表示している editor 一式。 */
function mountEditor(data, ev) {
  const sheet = fakeSheet();
  const bodyEl = makeBody(ev);
  const commits = [];
  const fallbackFocus = makeNode("button");
  const editor = createEventEditor({
    sheet,
    bodyEl,
    getData: () => data,
    commit: (next) => commits.push(next),
    fallbackFocus,
  });
  return { editor, sheet, bodyEl, commits, fallbackFocus };
}

/** DATA を壊さないための浅い複製。 */
const copyData = (extraEvents = []) => ({
  ...DATA,
  events: [...DATA.events.map((ev) => ({ ...ev })), ...extraEvents],
});

test("配線: 詳細 → 編集 → 保存を通しても image が残る", () => {
  withDom(() => {
    const data = copyData();
    const target = data.events.find((ev) => ev.image && !ev.allDay);
    // 往復で丸まる時刻にしておく（実データでは画像と 10.58 が同じ 1 件に同居
    // しないので、配線の上でも「触っていない値は変わらない」を試せるようにする）
    target.start = 10.58;
    const original = { ...target };
    const h = mountEditor(data, target);

    // 通常モードでイベントを選ぶ → 読み取り専用の詳細
    h.editor.select(target);
    assert.equal(h.sheet.opens.length, 1);
    assert.equal(h.sheet.opens[0].title, "予定の詳細");

    // フッターの「この予定を編集」→ フォーム
    fire(h.sheet.opens[0].foot[0]);
    assert.equal(h.sheet.opens[1].title, "予定を編集");

    // タイトルだけ打ち替えて保存
    h.bodyEl.fields["f-title"].value = "配線テスト";
    fire(h.sheet.opens[1].foot[0]);

    assert.equal(h.commits.length, 1, "commit が呼ばれていません");
    const saved = h.commits[0].events.find((ev) => ev.id === original.id);
    assert.equal(saved.title, "配線テスト");
    assert.equal(saved.image, original.image, "image が消えています（併合していない）");
    assert.equal(saved.imagePos, original.imagePos, "imagePos が消えています");
    assert.equal(saved.start, original.start, "触っていない start が変わっています");
    assert.equal(h.commits[0].events.length, DATA.events.length, "件数が変わっています");
    assert.equal(h.sheet.closes, 1, "保存後にシートが閉じていません");
    assert.equal(h.fallbackFocus.focused, 1, "フォーカスの戻し先が無いままです");
  });
});

test("配線: 全体検査に落ちる保存では commit が一度も呼ばれない", () => {
  withDom((errors) => {
    // すでに id が重複しているデータ。formProblems は 1 件しか見ないので
    // 素通りし、applyChange の validateEvents だけが止められる
    const data = copyData([{ ...DATA.events[1], id: DATA.events[0].id }]);
    const target = data.events[0];
    const h = mountEditor(data, target);

    h.editor.setEditMode(true);
    h.editor.select(target); // 編集モードなので直接フォーム
    assert.equal(h.sheet.opens[0].title, "予定を編集");

    h.bodyEl.fields["f-title"].value = "止まるはず";
    fire(h.sheet.opens[0].foot[0]);

    assert.equal(h.commits.length, 0, "検査に落ちたのに commit が呼ばれています");
    assert.equal(h.sheet.closes, 0, "検査に落ちたのにシートが閉じています");

    // 理由はシートの中に出す（画面から消えない）
    const box = h.bodyEl.fields["f-error"];
    assert.equal(box.children.length, 1);
    assert.match(box.children[0].textContent, /id が重複しています/);
    assert.equal(box.attrs["role"], "alert");
    assert.equal(errors.length, 1, "コンソールにも残していません");
  });
});

test("配線: 削除は 2 度押し。1 度目では commit されない", () => {
  withDom(() => {
    const data = copyData();
    const target = data.events.find((ev) => !ev.allDay);
    const h = mountEditor(data, target);

    h.editor.setEditMode(true);
    h.editor.select(target);
    const del = h.sheet.opens[0].foot[1];

    fire(del); // 1 度目: 身構えるだけ
    assert.equal(h.commits.length, 0, "1 度目で消えています");
    assert.equal(del.children[0].textContent, "もう一度で削除");
    assert.equal(del.className, "btn btn--danger");

    fire(del); // 2 度目: 消す
    assert.equal(h.commits.length, 1);
    assert.equal(h.commits[0].events.length, DATA.events.length - 1);
    assert.ok(!h.commits[0].events.some((ev) => ev.id === target.id));
    assert.equal(h.sheet.closes, 1);
  });
});

test("配線: 新規追加は採番され、削除ボタンを出さない", () => {
  withDom(() => {
    const data = copyData();
    const h = mountEditor(data, emptyEvent(DATA.days.length));

    h.editor.openNew();
    assert.equal(h.sheet.opens[0].title, "予定を追加");
    assert.equal(h.sheet.opens[0].foot.length, 1, "新規に削除ボタンが出ています");

    fire(h.sheet.opens[0].foot[0]);
    assert.equal(h.commits.length, 1);
    const added = h.commits[0].events.at(-1);
    assert.equal(added.id, "ev-007");
    assert.ok(!DATA.events.some((ev) => ev.id === added.id));
    assert.equal(h.commits[0].events.length, DATA.events.length + 1);
    // 元が無いので、フォームに無いキーは付かない
    for (const key of ["image", "imagePos", "icon"]) {
      assert.equal(Object.hasOwn(added, key), false, `${key} がどこからか付いています`);
    }
  });
});

test("不備のある欄すべてに aria-invalid が付き、直すと消える", () => {
  /*
   * 以前はタイトル欄にしか付けておらず、緯度や時刻を直すべき場面では
   * 支援技術に「どこが悪いのか」が伝わらなかった。さらに clearProblems が
   * role="alert" を残していたので、空の警告の器が居座り続けた（設計書 §13）。
   */
  withDom(() => {
    const data = copyData();
    const target = data.events.find((ev) => !ev.allDay);
    const h = mountEditor(data, target);

    h.editor.select(target);
    fire(h.sheet.opens[0].foot[0]); // 「この予定を編集」
    const form = h.sheet.opens[1];

    // タイトルを空にし、同じ日の中で終了を開始より前にする（別々の欄の不備を 2 件）
    h.bodyEl.fields["f-title"].value = "";
    h.bodyEl.fields["f-sday"].value = "0";
    h.bodyEl.fields["f-eday"].value = "0";
    h.bodyEl.fields["f-start"].value = "12:00";
    h.bodyEl.fields["f-end"].value = "11:00";
    fire(form.foot[0]); // 保存

    assert.equal(h.commits.length, 0, "不備があるのに保存されています");
    assert.equal(h.bodyEl.fields["f-title"].attrs["aria-invalid"], "true");
    assert.equal(
      h.bodyEl.fields["f-end"].attrs["aria-invalid"],
      "true",
      "時刻の不備が終了時刻の欄に伝わっていません（以前はタイトル欄にしか付かなかった）"
    );
    assert.equal(h.bodyEl.fields["f-error"].attrs.role, "alert");

    // 直して保存し直すと、印も警告の器も残らない
    h.bodyEl.fields["f-title"].value = "直した予定";
    h.bodyEl.fields["f-end"].value = "13:00";
    fire(form.foot[0]);

    assert.equal(h.commits.length, 1, "直したのに保存されていません");
    assert.equal(h.bodyEl.fields["f-title"].attrs["aria-invalid"], undefined);
    assert.equal(h.bodyEl.fields["f-end"].attrs["aria-invalid"], undefined);
    assert.equal(h.bodyEl.fields["f-error"].attrs.role, undefined, "role=alert が残っています");
  });
});
