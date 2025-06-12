/* ==============================================
 *  Count-Up Plugin  – desktop_main.js
 *  PC & Mobile 共通
 * ============================================== */
((PLUGIN_ID) => {
  'use strict';

  // ---------- 0. 設定 ----------
  const cfg           = kintone.plugin.app.getConfig(PLUGIN_ID) || {};
  const REV_FIELD     = cfg.revField;
  const DISABLE_EDIT  = cfg.disableEdit === 'true';
  const appId         = kintone.app.getId();

  if (!REV_FIELD) {
    alert('対象フィールドが未設定です。');
    return;
  }

  // ---------- 1. 現在値取得 ----------
  const fetchCurrent = (recordId) => kintone.api(
    kintone.api.url('/k/v1/record.json', true),
    'GET',
    { app: appId, id: recordId }
  ).then((res) => Number(res.record[REV_FIELD]?.value) || 0);

  // ---------- 2. 画面表示 ----------
  const showEv = [
    'app.record.create.show', 'mobile.app.record.create.show',
    'app.record.edit.show',   'mobile.app.record.edit.show',
    'app.record.index.edit.show', 'mobile.app.record.index.edit.show'
  ];
  kintone.events.on(showEv, (e) => {
    if (e.type.includes('.create.show')) e.record[REV_FIELD].value = 0;
    if (DISABLE_EDIT && e.record[REV_FIELD]) e.record[REV_FIELD].disabled = true;
    return e;
  });

  // ---------- 3. 新規保存（0 固定） ----------
  kintone.events.on([
    'app.record.create.submit',
    'mobile.app.record.create.submit'
  ], (e) => {
    if (!window.isAuthenticated || !window.isAuthenticated()) return e;
    e.record[REV_FIELD].value = 0;
    return e;
  });

  // ---------- 4. 既存保存（+1） ----------
  const editSubmitEv = [
    'app.record.edit.submit',          'mobile.app.record.edit.submit',
    'app.record.index.edit.submit',    'mobile.app.record.index.edit.submit'
  ];
  kintone.events.on(editSubmitEv, (e) => {
    if (!window.isAuthenticated || !window.isAuthenticated()) return e;

    const handle = async () => {
      let cur;

      if (e.record[REV_FIELD]) {
        // 詳細 / 編集フォーム：フィールドが含まれている
        cur = Number(e.record[REV_FIELD].value) || 0;
      } else {
        // 一覧インライン編集のみ → REST で取得
        const recId = e.record.$id?.value || e.recordId;
        if (!recId) throw new Error('recordId 取得失敗');
        cur = await fetchCurrent(recId);
        e.record[REV_FIELD] = {};            // フィールドが無い場合は生成
      }

      e.record[REV_FIELD].value = cur + 1;
      return e;
    };

    return handle().catch((err) => {
      console.error('CountUp error', err);
      e.error = 'カウントアップ値の取得に失敗しました。再試行してください。';
      return e;
    });
  });
})(kintone.$PLUGIN_ID);
