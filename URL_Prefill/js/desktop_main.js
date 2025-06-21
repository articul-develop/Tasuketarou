/* ============================================================
 *  - URL クエリ(search/hash)でフィールドを自動入力
 *  - PC   : /k/171/edit?Field=Value または #Field=Value
 *  - SP   : /k/m/171/edit#Field=Value
 *  - ルックアップ自動取得：PC・モバイル共通
 * ============================================================*/
((PLUGIN_ID) => {
  'use strict';

  /* ---------- プラグイン認証チェック ---------- */
  const cfg = kintone.plugin.app.getConfig(PLUGIN_ID);
  if (!cfg || cfg.authStatus !== 'valid') return; // 未認証なら停止

  /* ---------- URL クエリ(search + hash) ---------- */
  const rawQuery = [
    location.search.replace(/^\?/, ''),
    location.hash.replace(/^#/, '')
  ].filter(Boolean).join('&');
  if (!rawQuery) return; // パラメータなし

  const query = Object.fromEntries(new URLSearchParams(rawQuery));
  delete query.record; // kintone 標準パラメータを除外
  delete query.mode;

  /* ---------- PC / Mobile 判定 (パスで判断) ---------- */
  const isMobileUI = /\/k\/m\//.test(location.pathname); // URL に /k/m/ を含む

  /* ---------- 対象イベント ---------- */
  const EVENTS = [
    'app.record.create.show', 'app.record.edit.show',
    'mobile.app.record.create.show', 'mobile.app.record.edit.show'
  ];

  kintone.events.on(EVENTS, (event) => {
    const record   = event.record;
    // 正確な APP ハンドラを取得（モバイル UI で PC API が欠落するケースに備える）
    const APP      = isMobileUI && kintone.mobile && kintone.mobile.app ? kintone.mobile.app : kintone.app;
    let needLookup = false;

    /* ---------- 値の流し込み ---------- */
    for (const [code, raw] of Object.entries(query)) {
      if (!record[code]) continue; // 存在しないフィールドは無視

      switch (record[code].type) {
        case 'CHECK_BOX':
        case 'MULTI_SELECT':
          record[code].value = raw.split(',').map(v => v.trim()).filter(Boolean);
          break;
        case 'USER_SELECT':
        case 'ORGANIZATION_SELECT':
        case 'GROUP_SELECT':
          record[code].value = raw.split(',').map(v => v.trim()).filter(Boolean)
                                 .map(code => ({ code }));
          break;
        default:
          record[code].value = raw;
      }

      /* ---------- ルックアップ自動取得フラグ ---------- */
      if (APP.getLookupTargetAppId && APP.getLookupTargetAppId(code) !== null) {
        record[code].lookup = 'UPDATE';
        needLookup = true;
      }
    }

    /* ---------- ルックアップ発火 ---------- */
    if (needLookup) {
      setTimeout(() => {
        // PC でもモバイルでも確実に差分検知させるため、fresh copy を渡す
        const latest = APP.record.get().record;
        APP.record.set({ record: latest });
      }, 0);
    }

    return event; // kintone へ変更を返す
  });

})(kintone.$PLUGIN_ID);
