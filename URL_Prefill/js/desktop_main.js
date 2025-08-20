/* ============================================================
 * URLパラメータ → レコード編集画面に初期値を流し込む
 *  - 数値/日付: 軽量バリデーション → NGは代入せず通知
 *  - 選択系  : API(values) + DOM(values) の和集合で照合
 *              （どちらも取得不可ならチェックをスキップ＝誤検知防止）
 *  - USER/ORG/GROUP: ログイン名/コードの存在照合（タイプ毎に1回だけ）
 *  - ルックアップは UPDATE 指定で自動取得を発火
 *  - 追加仕上げ:
 *      * フィールド定義を revision 連動で sessionStorage キャッシュ（更新も実施）
 *      * 通知は role="alert" / aria-live="polite"（重複生成防止）
 *      * 通知行数の上限（UI 崩れ防止）
 * 対象URL: /k/{appId}/edit?Field=Value または #Field=Value（SPも可）
 * ============================================================ */
((PLUGIN_ID) => {
  'use strict';

  /* ---------- プラグイン認証 ---------- */
  var cfg = kintone.plugin.app.getConfig(PLUGIN_ID);
  if (!cfg || cfg.authStatus !== 'valid') return;

  /* ---------- URL クエリ(search + hash) ---------- */
  var rawQuery = [location.search.replace(/^\?/, ''), location.hash.replace(/^#/, '')]
    .filter(function (s) { return !!s; })
    .join('&');
  if (!rawQuery) return;

  var query = Object.fromEntries(new URLSearchParams(rawQuery));
  delete query.record; // kintone 標準パラメータ除外
  delete query.mode;

  /* ---------- PC / Mobile 吸収 ---------- */
  var isMobileUI = /\/k\/m\//.test(location.pathname);
  var APP = (isMobileUI && kintone.mobile && kintone.mobile.app) ? kintone.mobile.app : kintone.app;

  /* ---------- ユーティリティ ---------- */
  function normalize(s) { return String(s == null ? '' : s).normalize('NFKC').trim(); }
  function parseList(s) {
    return String(s == null ? '' : s)
      .split(',')
      .map(normalize)
      .filter(function (v) { return !!v; });
  }

  // アクセシブル＆重複生成しない通知（\n 改行表示／長文要約）
  function notify(msg) {
    var el = (APP.getHeaderSpaceElement ? APP.getHeaderSpaceElement() : kintone.app.record.getHeaderSpaceElement());
    var lines = Array.isArray(msg) ? msg : [String(msg)];
    var MAX_LINES = 10;
    var compact = lines.length > MAX_LINES
      ? [].concat(lines.slice(0, MAX_LINES), '…ほか ' + (lines.length - MAX_LINES) + ' 件')
      : lines;
    var text = compact.join('\n');

    if (!el) { alert(text); return; }

    var box = el.querySelector('.urlfill-notice');
    if (!box) {
      box = document.createElement('div');
      box.className = 'urlfill-notice';
      box.setAttribute('role', 'alert');
      box.setAttribute('aria-live', 'polite');
      el.appendChild(box);
    }
    box.style.cssText = [
      'padding:8px 12px','margin:8px 0','border-radius:6px',
      'background:#fdecea','color:#d93025','font-size:13px',
      'white-space:pre-line','line-height:1.5',
      'max-height:220px','overflow:auto'
    ].join(';');
    box.textContent = text;
  }


/* ---------- 数値/日付系の厳格バリデーション（暦日チェック付き） ---------- */
var validators = {
  NUMBER: function (raw) {
    var v = normalize(raw);
    return v === '' || /^[-+]?(\d+(\.\d+)?|\.\d+)$/.test(v);
  },
  TIME: function (raw) {
    var v = normalize(raw);
    return v === '' || /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
  },
  DATE: function (raw) {
    var v = normalize(raw);
    if (v === '') return true;
    var m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return false;
    var y = +m[1], mo = +m[2], d = +m[3];
    // 暦日として実在するか（うるう年含む）
    var dt = new Date(y, mo - 1, d);
    return dt.getFullYear() === y && (dt.getMonth() + 1) === mo && dt.getDate() === d;
  },
  DATETIME: function (raw) {
    var v = normalize(raw);
    if (v === '') return true;
    // "YYYY-MM-DDTHH:MM", "YYYY-MM-DD HH:MM", 末尾に ":SS" や TZ (Z / ±HH:MM) 付きも許容
    var m = v.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):([0-5]\d)(?::([0-5]\d))?(Z|[+\-]\d{2}:\d{2})?$/);
    if (!m) return false;
    var y = +m[1], mo = +m[2], d = +m[3];
    var hh = +m[4], mm = +m[5], ss = m[6] ? +m[6] : 0;

    // 暦日 + 時刻の妥当性（※ここはローカル時計で良い：検証のみ）
    var dt = new Date(y, mo - 1, d, hh, mm, ss);
    if (!(dt.getFullYear() === y && (dt.getMonth() + 1) === mo && dt.getDate() === d)) return false;
    if (!(dt.getHours() === hh && dt.getMinutes() === mm && dt.getSeconds() === ss)) return false;

    return true;
  }
};


  /* ---------- 選択肢セット：API（キャッシュ）＋DOM（補助） ---------- */

  // APIから選択肢を構築（code -> Set(values)）。revision を sessionStorage に保存。
  function buildChoicesMap(appId) {
    return (function () { return __buildChoicesMap(); })();

    function __buildChoicesMap() {
      var cacheKey = 'urlfill:choices:' + appId;
      // いったん API で最新を取得（確実）し、キャッシュを更新
      var map = {};
      var revision = null;
      return kintone.api(kintone.api.url('/k/v1/app/form/fields', true), 'GET', { app: appId })
        .then(function (res) {
          revision = (res && res.revision) ? res.revision : null;
          var props = (res && res.properties) ? res.properties : {};
          var types = { DROP_DOWN:1, RADIO_BUTTON:1, CHECK_BOX:1, MULTI_SELECT:1 };
          var codes = Object.keys(props);
          for (var i=0;i<codes.length;i++) {
            var code = codes[i];
            var def = props[code];
            if (!types[def.type]) continue;
            var arr = toValueArray(def.options);
            if (arr.length) map[code] = new Set(arr);
          }
          // キャッシュ保存（Set→配列）
          try {
            var serializable = {};
            Object.keys(map).forEach(function (c) { serializable[c] = Array.from(map[c]); });
            sessionStorage.setItem(cacheKey, JSON.stringify({ revision: revision, map: serializable }));
          } catch (e) { /* storage 不可時は無視 */ }
          return map;
        })
        .catch(function () {
          // API 失敗時：キャッシュがあればそれを復元、無ければ空
          try {
            var cachedRaw = sessionStorage.getItem(cacheKey);
            if (cachedRaw) {
              var cached = JSON.parse(cachedRaw);
              if (cached && cached.map) {
                var cmap = {};
                var entries = Object.keys(cached.map);
                for (var j=0;j<entries.length;j++) {
                  var k = entries[j];
                  cmap[k] = new Set(cached.map[k]);
                }
                return cmap;
              }
            }
          } catch (e) {}
          return {}; // 空マップ（後段でスキップ方針）
        });

      function toValueArray(options) {
        var out = [];
        if (Array.isArray(options)) {
          for (var i=0;i<options.length;i++) {
            if (options[i] && options[i].value) out.push(String(options[i].value).trim());
          }
          for (var j=0;j<options.length;j++) { // 互換対策：label も許容
            if (options[j] && options[j].label) out.push(String(options[j].label).trim());
          }
        } else if (options && typeof options === 'object') {
          var vals = Object.values(options);
          for (var k=0;k<vals.length;k++) {
            if (vals[k] && vals[k].value) out.push(String(vals[k].value).trim());
            if (vals[k] && vals[k].label) out.push(String(vals[k].label).trim());
          }
        }
        // 重複除去
        var seen = Object.create(null), uniq = [];
        for (var m=0;m<out.length;m++) { var v = out[m]; if (!seen[v]) { seen[v]=1; uniq.push(v); } }
        return uniq;
      }
    }
  }

  // DOM から value 集合を取得（取れなければ null）
  function getChoicesFromDOM(code, type) {
    var root = (APP.record.getFieldElement && APP.record.getFieldElement(code)) || null;
    if (!root) return null;
    try {
      if (type === 'DROP_DOWN') {
        var sel = root.querySelector('select'); if (!sel) return null;
        var vals1 = Array.prototype.slice.call(sel.options).map(function (o) { return String(o.value).trim(); }).filter(Boolean);
        return vals1.length ? new Set(vals1) : null;
      }
      if (type === 'RADIO_BUTTON') {
        var inputsR = root.querySelectorAll('input[type="radio"]');
        var vals2 = Array.prototype.slice.call(inputsR).map(function (i) { return String(i.value).trim(); }).filter(Boolean);
        return vals2.length ? new Set(vals2) : null;
      }
      if (type === 'CHECK_BOX' || type === 'MULTI_SELECT') {
        var selm = root.querySelector('select[multiple]');
        if (selm) {
          var vals3 = Array.prototype.slice.call(selm.options).map(function (o) { return String(o.value).trim(); }).filter(Boolean);
          return vals3.length ? new Set(vals3) : null;
        }
        var inputsC = root.querySelectorAll('input[type="checkbox"]');
        var vals4 = Array.prototype.slice.call(inputsC).map(function (i) { return String(i.value).trim(); }).filter(Boolean);
        return vals4.length ? new Set(vals4) : null;
      }
    } catch (e) {}
    return null;
  }

  // DOM と API の和集合（どちらか片方でもあれば照合可能）
  function mergeChoiceSets(domSet, apiSet) {
    if (domSet && apiSet) {
      var merged = new Set(domSet);
      apiSet.forEach(function (v) { merged.add(v); });
      return merged;
    }
    return domSet || apiSet || null;
  }

  /* ---------- ユーザー/組織/グループの存在照合（イベント毎にタイプ別1回） ---------- */

  // URLに含まれる候補だけ収集
  function collectWantedCodes(record) {
    var want = { user: new Set(), org: new Set(), group: new Set() };
    Object.keys(query).forEach(function (code) {
      var f = record[code]; if (!f) return;
      var t = f.type, raw = query[code];
      if (t === 'USER_SELECT')            parseList(raw).forEach(function (v) { want.user.add(v); });
      else if (t === 'ORGANIZATION_SELECT') parseList(raw).forEach(function (v) { want.org.add(v); });
      else if (t === 'GROUP_SELECT')       parseList(raw).forEach(function (v) { want.group.add(v); });
    });
    return want;
  }

  // 存在するログイン名/コードのみ集合に追加（取得失敗は空集合＝代入しない）
  function fetchExistenceMaps(want) {
    var out = { user: new Set(), org: new Set(), group: new Set() };

    var pUser = want.user.size
      ? kintone.api(kintone.api.url('/v1/users', true), 'GET', { codes: Array.from(want.user) })
          .then(function (res) {
            var arr = (res && res.users) ? res.users : [];
            for (var i=0;i<arr.length;i++) out.user.add(normalize(arr[i].code));
          })
          .catch(function () {})
      : Promise.resolve();

    var pOrg = want.org.size
      ? kintone.api(kintone.api.url('/v1/organizations', true), 'GET', { codes: Array.from(want.org) })
          .then(function (res) {
            var arr = (res && res.organizations) ? res.organizations : [];
            for (var i=0;i<arr.length;i++) out.org.add(normalize(arr[i].code));
          })
          .catch(function () {})
      : Promise.resolve();

    var pGroup = want.group.size
      ? kintone.api(kintone.api.url('/v1/groups', true), 'GET', { codes: Array.from(want.group) })
          .then(function (res) {
            var arr = (res && res.groups) ? res.groups : [];
            for (var i=0;i<arr.length;i++) out.group.add(normalize(arr[i].code));
          })
          .catch(function () {})
      : Promise.resolve();

    return Promise.all([pUser, pOrg, pGroup]).then(function () { return out; });
  }

  /* ---------- 対象イベント（PC/SPの新規・編集） ---------- */
  var EVENTS = [
    'app.record.create.show','app.record.edit.show',
    'mobile.app.record.create.show','mobile.app.record.edit.show'
  ];

  kintone.events.on(EVENTS, async function (event) {
    var record = event.record;
    var invalids = [];
    var needLookup = false;

    // 1) 選択肢（API）を先に構築（DOMが未構築でも照合できる）
    var apiChoices = await buildChoicesMap(APP.getId());

    // 2) USER/ORG/GROUP の存在照合（必要時のみ）
    var wanted = collectWantedCodes(record);
    var exists = await fetchExistenceMaps(wanted);

    // 3) 各パラメータを型に合わせて代入（不正は事前に弾く）
    var entries = Object.entries(query);
    for (var i=0;i<entries.length;i++) {
      var code = entries[i][0];
      var raw0 = entries[i][1];
      var field = record[code];
      if (!field) continue;

      var type = field.type;
      var raw  = String(raw0);
      var valueToSet;

      // 3-1) 値の型だけ整形
      if (type === 'CHECK_BOX' || type === 'MULTI_SELECT') {
        valueToSet = parseList(raw);
      } else if (type === 'USER_SELECT') {
        var arrU = parseList(raw);
        var ngU = arrU.filter(function (v) { return !exists.user.has(v); });
        if (ngU.length) {
          invalids.push('「' + code + '」の入力内容が不正です。存在するユーザーのログイン名を指定してください。（入力値: ' + ngU.join(', ') + '）');
          arrU = arrU.filter(function (v) { return exists.user.has(v); });
        }
        valueToSet = arrU.map(function (v) { return { code: v }; });
      } else if (type === 'ORGANIZATION_SELECT') {
        var arrO = parseList(raw);
        var ngO = arrO.filter(function (v) { return !exists.org.has(v); });
        if (ngO.length) {
          invalids.push('「' + code + '」の入力内容が不正です。存在する組織コードを指定してください。（入力値: ' + ngO.join(', ') + '）');
          arrO = arrO.filter(function (v) { return exists.org.has(v); });
        }
        valueToSet = arrO.map(function (v) { return { code: v }; });
      } else if (type === 'GROUP_SELECT') {
        var arrG = parseList(raw);
        var ngG = arrG.filter(function (v) { return !exists.group.has(v); });
        if (ngG.length) {
          invalids.push('「' + code + '」の入力内容が不正です。存在するグループコードを指定してください。（入力値: ' + ngG.join(', ') + '）');
          arrG = arrG.filter(function (v) { return exists.group.has(v); });
        }
        valueToSet = arrG.map(function (v) { return { code: v }; });
      } else {
        valueToSet = raw0; // 文字/日付/時刻/計算などはそのまま（kintone型に依存）
      }

      // 3-2) 数値/日付のプリチェック（NGは代入せず次へ）
      if (validators[type] && !validators[type](raw0)) {
        var msg = {
          NUMBER  : '「' + code + '」には数値を入力してください。（入力値: ' + raw0 + '）',
          DATE    : '「' + code + '」には日付(YYYY-MM-DD)を入力してください。（入力値: ' + raw0 + '）',
          TIME    : '「' + code + '」には時刻(HH:MM)を入力してください。（入力値: ' + raw0 + '）',
          DATETIME: '「' + code + '」には日時(YYYY-MM-DDThh:mm など)を入力してください。（入力値: ' + raw0 + '）'
        }[type];
        invalids.push(msg);
        continue;
      }

      // 3-3) 選択系は集合で照合（APIとDOMの和集合。取れなければスキップ＝誤検知防止）
      if (type === 'DROP_DOWN' || type === 'RADIO_BUTTON' || type === 'CHECK_BOX' || type === 'MULTI_SELECT') {
        var domSet = getChoicesFromDOM(code, type);
        var set = mergeChoiceSets(domSet, apiChoices[code]); // Set or null

        if (set) {
          if (type === 'CHECK_BOX' || type === 'MULTI_SELECT') {
            var vals = Array.isArray(valueToSet) ? valueToSet : [];
            var ng = vals.filter(function (v) { return !set.has(normalize(v)); });
            if (ng.length) { invalids.push('「' + code + '」の入力内容が不正です。選択肢に存在する値を指定してください。（入力値: ' + ng.join(', ') + '）'); continue; }
          } else {
            var v = normalize(raw0);
            if (!set.has(v)) { invalids.push('「' + code + '」の入力内容が不正です。選択肢に存在する値を指定してください。（入力値: ' + v + '）'); continue; }
          }
        }
        // set が null ならチェックはスキップ（正当値まで誤検知しないため）
      }

      // 3-4) 代入（保険で try/catch）
      try {
        field.value = valueToSet;
        if (APP.getLookupTargetAppId && APP.getLookupTargetAppId(code) !== null) {
          field.lookup = 'UPDATE';
          needLookup = true;
        }
      } catch (e) {
        invalids.push('「' + code + '」の入力内容が不正です。（入力値: ' + raw0 + '）');
        continue;
      }
    }

    // 4) まとめて通知（行ごと）
    if (invalids.length) notify(invalids);

    // 5) ルックアップ差分検知
    if (needLookup) {
      setTimeout(function () {
        var latest = APP.record.get().record;
        APP.record.set({ record: latest });
      }, 0);
    }

    return event; // kintoneへ変更を返す
  });

})(kintone.$PLUGIN_ID);
