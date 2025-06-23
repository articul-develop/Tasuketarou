
((PLUGIN_ID) => {
  'use strict';

  /* ------------------ 1. ユーティリティ ------------------ */
  const isMobileEvent = (t) => t && t.startsWith('mobile.');

  // フィールドコード → ラベルのマッピングを取得
  function fetchFieldMap(appId) {
    return kintone.api(kintone.api.url('/k/v1/app/form/fields', true), 'GET', { app: appId })
      .then(({ properties }) => {
        const map = {};
        (function walk(obj) {
          Object.keys(obj).forEach((k) => {
            const p = obj[k];
            map[p.code] = p.label || p.code;
            if (p.type === 'SUBTABLE') walk(p.fields);
          });
        })(properties);
        return map;
      });
  }

  // 抽出条件中のフィールドコードを日本語ラベルへ置換
  function replaceCodes(expr, map) {
    if (!expr) return '';
    Object.keys(map)
      .sort((a, b) => b.length - a.length)
      .forEach((code) => {
        const esc = code.replace(/[-/\\^$*+?.()|[\\]{}]/g, '\\$&');
        expr = expr.replace(new RegExp(`(^|[^\\w])(${esc})(?=[^\\w]|$)`, 'g'), (m, pre) => pre + map[code]);
      });
    return expr;
  }

  // イベントオブジェクトから生の抽出条件文字列を取得
  function getRawCondition(evt, appApi) {
    // レポートビュー（グラフ／ピボット）
    if (evt.type.includes('.report.') && evt.report) {
      const cond = (evt.report.filterCond || '').replace(/ order .*/i, '');
      if (cond) return cond;
    }
    // 一覧ビューまたはクエリ付きレポート
    if (typeof evt.query === 'string' && evt.query) {
      return evt.query.replace(/ order .*/i, '');
    }
    // 保存されている条件
    const saved = appApi.getQueryCondition && appApi.getQueryCondition();
    return saved ? saved.replace(/ order .*/i, '') : '';
  }

  /* ---------- 2. コンテナ生成と配置 ---------- */
  function createContainer(id) {
    const el = document.createElement('div');
    el.id = id;
    el.style.cssText = [
      'padding:4px 8px',
      'font-size:85%',
      'background:#f5f5f5',
      'border-radius:4px',
      'margin:4px 0',
      'white-space:pre-wrap',
      'max-width:100%',
      // ヘッダーが取得できない場合のフォールバック（画面上部に固定表示）
      'position:sticky',
      'top:0',
      // ビュー切替ドロップダウン（z-index:100）より下に配置
      'z-index:1',
      // クリック操作を透過させる
      'pointer-events:none'
    ].join(';');
    return el;
  }

  // レポートヘッダーの候補を広くカバーするセレクタ
  const HEADER_SELECTORS = [
    '.gaia-argoui-app-report-header',
    '.gaia-argoui-app-report-title',
    '.gaia-argoui-app-report-toolbar',
    '[class*="app-report"][class*="header"]',
    '[class*="app-report"][class*="toolbar"]'
  ].join(',');

  function findReportHeader() {
    return document.querySelector(HEADER_SELECTORS);
  }

  // ヘッダーが存在すればコンテナを移動
  function moveToHeader(container) {
    const header = findReportHeader();
    if (header && !header.contains(container)) header.prepend(container);
  }

  // ヘッダー生成を監視し、生成されたら移動
  function observeHeader(container) {
    if (findReportHeader()) return moveToHeader(container);
    const obs = new MutationObserver(() => {
      if (findReportHeader()) {
        moveToHeader(container);
        obs.disconnect();
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  // コンテナを適切な場所に配置
  function placeContainer(isMobile, isReport) {
    const id = isMobile ? 'filter-cond-mobile' : 'filter-cond';
    let el = document.getElementById(id);
    if (el) return el;

    el = createContainer(id);
    const appApi = isMobile ? kintone.mobile.app : kintone.app;
    const listHeader = appApi.getHeaderSpaceElement && appApi.getHeaderSpaceElement();

    if (listHeader) {
      // 一覧ビューのヘッダーへ
      listHeader.prepend(el);
    } else if (isReport) {
      // レポートビュー：一旦 body に置き、ヘッダー出現を待つ
      document.body.prepend(el);
      observeHeader(el);
    } else {
      document.body.prepend(el);
    }
    return el;
  }

  /* ------------------- 3. レンダリング ------------------ */
  function render(evt) {
    if (window.isAuthenticated && !window.isAuthenticated()) return evt;

    const isMobile = isMobileEvent(evt.type);
    const isReport = evt.type.includes('.report.');
    const appApi   = isMobile ? kintone.mobile.app : kintone.app;

    const raw = getRawCondition(evt, appApi);
    const box = placeContainer(isMobile, isReport);

    if (!raw) {
      box.textContent = '抽出条件は設定されていません';
      return evt;
    }

    fetchFieldMap(appApi.getId())
      .then((map) => {
        box.textContent = '抽出条件: ' + replaceCodes(raw, map);
      })
      .catch(() => {
        box.textContent = '抽出条件: ' + raw;
      });

    return evt;
  }

  /* ---------------- 4. イベント登録 ------------------ */
  kintone.events.on([
    'app.record.index.show',
    'app.report.show',
    'mobile.app.record.index.show',
    'mobile.app.report.show'
  ], render);

})(kintone.$PLUGIN_ID);
