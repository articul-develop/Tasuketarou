/* ==================================================
 *  Filter Condition Display Plugin – desktop_main.js
 *  (PC / Mobile 共通)
 * ==================================================*/
((PLUGIN_ID) => {
  'use strict';

  // --------------------------------------------
  // 0. 認証チェック（desktop_auth.js が定義）
  // --------------------------------------------
  if (window.isAuthenticated && !window.isAuthenticated()) {
    // 認証 NG の場合は何もしない
    return;
  }

  /** ----------------------------------------------------------
   *  1. ユーティリティ
   * -----------------------------------------------------------*/

  /** PC / モバイル判定 */
  function detectMobile(evtType) {
    if (evtType && evtType.indexOf('mobile.') === 0) return true; // イベント名が mobile.*
    return location.pathname.indexOf('/k/m/') === 0;              // URL に /k/m/ が含まれる
  }

  /** フィールド {コード:名称} マップ取得 */
  function fetchFieldMap(appId) {
    return kintone.api(kintone.api.url('/k/v1/app/form/fields', true), 'GET', { app: appId })
      .then(function (resp) {
        var map = {};
        (function traverse(props) {
          Object.keys(props).forEach(function (key) {
            var p = props[key];
            map[p.code] = p.label || p.code;
            if (p.type === 'SUBTABLE' && p.fields) traverse(p.fields);
          });
        })(resp.properties);
        return map;
      });
  }

  /** コード → 名称へ置換（日本語コード対応） */
  function replaceCodes(cond, map) {
    if (!cond) return '';
    Object.keys(map)
      .sort(function (a, b) { return b.length - a.length; }) // 長いコードから順に置換
      .forEach(function (code) {
        var esc = code.replace(/[-/\\^$*+?.()|[\\]{}]/g, '\\$&');
        var reg = new RegExp('(^|[^\\\w])(' + esc + ')(?=[^\\\w]|$)', 'g');
        cond = cond.replace(reg, function (match, pre) { return pre + map[code]; });
      });
    return cond;
  }

  /** コンテナ生成（ヘッダ領域 or ボディ先頭） */
  function getContainer(isMobile) {
    var id = isMobile ? 'filter-cond-mobile' : 'filter-cond';
    var el = document.getElementById(id);
    if (el) return el;

    el = document.createElement('div');
    el.id = id;
    el.style.cssText = 'padding:4px 8px;font-size:85%;background:#f5f5f5;border-radius:4px;margin:4px 0;white-space:pre-wrap;';

    var headSpace = (isMobile ? kintone.mobile.app : kintone.app).getHeaderSpaceElement();
    if (headSpace) {
      headSpace.appendChild(el);
    } else {
      document.body.insertBefore(el, document.body.firstChild);
    }
    return el;
  }

  /** 抽出条件を可読化して表示 */
  function render(event) {
    // 認証が途中で失効していないか都度チェック
    if (window.isAuthenticated && !window.isAuthenticated()) return event;

    var isMobile = detectMobile(event.type);
    var appApi   = isMobile ? kintone.mobile.app : kintone.app;

    // event.query がある場合はそれを使用（レポートなど）
    var raw = typeof event.query === 'string'
      ? event.query.replace(/ order .*/i, '')
      : appApi.getQueryCondition();

    var box = getContainer(isMobile);
    if (!raw) {
      box.textContent = '抽出条件は設定されていません';
      return event;
    }

    fetchFieldMap(appApi.getId())
      .then(function (map) {
        box.textContent = '抽出条件: ' + replaceCodes(raw, map);
      })
      .catch(function () {
        box.textContent = '抽出条件: ' + raw; // フォールバック
      });

    return event;
  }

  /** 2. イベント登録（PC / モバイル） */
  var evts = [
    'app.record.index.show',
    'app.report.show',
    'mobile.app.record.index.show',
    'mobile.app.report.show'
  ];

  kintone.events.on(evts, render);

})(kintone.$PLUGIN_ID);
