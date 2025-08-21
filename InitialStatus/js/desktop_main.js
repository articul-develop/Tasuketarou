/* ==============================================
 *  initial-status-updater – desktop_main.js
 *  PC & Mobile 共通
 * ============================================== */
((PLUGIN_ID) => {
  'use strict';

  // ---------- 0. 設定 ----------
  const cfg                 = kintone.plugin.app.getConfig(PLUGIN_ID) || {};
  const DRAFT_BTN_LABEL     = cfg.draftBtnLabel    || '下書き保存';
  const ACTION_TO_COMPLETE  = cfg.actionToComplete || '';
  const INITIAL_STATUS      = cfg.initialStatus    || '';
  const INITIAL_STATUS_INDEX = cfg.initialStatusIndex ?? '';
  const DRAFT_BTN_ID        = 'custom-draft-save-btn';

  // ---------- 1. 共通ユーティリティ ----------
  /** 保存ボタン要素を探す（PC／モバイル） */
  function findSaveButton(isMobile = false) {
    const pcSel = [
      '[data-testid="record-save-button"]',
      '.gaia-argoui-app-toolbar-save button',
      '.gaia-argoui-app-toolbar-save input[type="button"]',
      '.gaia-argoui-app-toolbar-save',
      '[data-id="save"].gaia-argoui-app-toolbar-save',
      '[data-id="save"]',
      '[name="save"]'
    ];
    const mbSel = [
      '[data-testid="record-save-button"]',
      '[data-id="save"].mobile-toolbar-record-save',
      '.mobile-toolbar-record-save[data-id="save"]',
      '[data-id="save"]',
      '[name="save"]'
    ];
    const selectors = (isMobile ? mbSel : pcSel).join(',');

    let el = document.querySelector(selectors);
    if (!el) {
      // fallback: テキスト一致検索
      const cands = Array.from(document.querySelectorAll('button, input[type="button"]'));
      el = cands.find((n) => (n.textContent || n.value || '').trim() === '保存');
    }
    if (el && el.tagName === 'DIV') el = el.querySelector('button, input[type="button"]');
    return el;
  }

  /** STATUS フィールドコードを自動検出 */
  function getStatusFieldCode(record) {
    for (const key in record) {
      const f = record[key];
      if (f && typeof f === 'object' && f.type === 'STATUS') return key;
    }
    return null;
  }

  /** 現ステータス値を取得（見つからなければ null） */
  function getCurrentStatus(record) {
    const code = getStatusFieldCode(record);
    return code ? record[code].value : null;
  }

  // ---------- 1.5. 「最初のステータス index」を取得 ----------
  let FIRST_STATUS_INDEX = null; // 文字列で保持（config と比較しやすいように）

  async function fetchFirstStatusIndex(appId) {
    try {
      const url = kintone.api.url('/k/v1/app/status', true);
      const resp = await kintone.api(url, 'GET', { app: appId });
      const stateList = Object.values(resp.states || {});
      if (!stateList.length) return null;
      stateList.sort((a, b) => Number(a.index ?? Infinity) - Number(b.index ?? Infinity));
      const first = stateList[0];
      return String(first.index);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[initial-status-updater] fetchFirstStatusIndex failed', e);
      return null;
    }
  }

  function shouldHandleCreate() {
    if (FIRST_STATUS_INDEX == null || INITIAL_STATUS_INDEX === '') return false;
    return String(INITIAL_STATUS_INDEX) === String(FIRST_STATUS_INDEX);
  }

  // ---------- 2. 下書き保存ボタン ----------
  let isDraftSave = false;

  function injectDraftButton(isMobile = false) {
    if (document.getElementById(DRAFT_BTN_ID)) return; // 既に配置済み

    const space = isMobile ?
      kintone.mobile.app.getHeaderSpaceElement() :
      kintone.app.record.getHeaderMenuSpaceElement();

    const btn = document.createElement('button');
    btn.id          = DRAFT_BTN_ID;
    btn.type        = 'button';
    btn.textContent = DRAFT_BTN_LABEL;
    btn.className   = 'kintoneplugin-button-normal custom-draft-save';
    btn.style.marginTop  = '4px';
    btn.style.marginLeft = '16px';
    space.appendChild(btn);

    btn.onclick = () => {
      // 1) 保存ボタンを探してクリック（PC/モバイルでセレクタ差異あり）
      const isMobileEnv = !!kintone.mobile;
      const saveBtn = findSaveButton(isMobileEnv);
      if (!saveBtn) {
        alert('保存ボタンが見つかりませんでした。');
        return;
      }
      isDraftSave = true;
      // PC: button/input 両対応、Mobile: data-id="save"
      saveBtn.click();
    };
  }

  // ---------- 3. 保存後フック ----------
  async function afterSave(e, isMobile) {
    if (isDraftSave) {
      isDraftSave = false; // 下書き保存時は何もしない
      return e;
    }

    // 認証が成功しているか確認
    if (!window.isAuthenticated || !window.isAuthenticated()) {
      // 認証に失敗した場合、処理を中断
      return e;
    }

    const status   = getCurrentStatus(e.record || {});
    const isCreate = e.type.indexOf('create') >= 0;
    if (FIRST_STATUS_INDEX == null) {
      const appId0 = isMobile ? kintone.mobile.app.getId() : kintone.app.getId();
      FIRST_STATUS_INDEX = await fetchFirstStatusIndex(appId0);
    }
    if ((isCreate && !shouldHandleCreate()) || (!isCreate && status !== INITIAL_STATUS)) return e; // 対象外

    try {
      await kintone.api('/k/v1/record/status', 'PUT', {
        app: isMobile ? kintone.mobile.app.getId() : kintone.app.getId(),
        id: e.recordId,
        action: ACTION_TO_COMPLETE,
        revision: -1
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[initial-status-updater] status update failed', err);
      alert('アクションが実施できません。設定や権限を確認してください。');
    }

    return e;
  }

  // ---------- 4. イベント登録 ----------
  const showEvents = [
    'app.record.create.show',
    'app.record.edit.show',
    'mobile.app.record.create.show', 'mobile.app.record.edit.show'
  ];
  kintone.events.on(showEvents, async (ev) => {
    const isNew   = ev.type.indexOf('create') >= 0;
    const status  = getCurrentStatus(ev.record || {});
    if (FIRST_STATUS_INDEX == null) {
      const appId = ev.type.startsWith('mobile.') ? kintone.mobile.app.getId() : kintone.app.getId();
      FIRST_STATUS_INDEX = await fetchFirstStatusIndex(appId);
    }
    if ((isNew && shouldHandleCreate()) || (!isNew && status === INITIAL_STATUS)) {
      injectDraftButton(ev.type.startsWith('mobile.'));
    }
    return ev;
  });

  kintone.events.on('app.record.create.submit.success',  (e) => afterSave(e, false));
  kintone.events.on('mobile.app.record.create.submit.success', (e) => afterSave(e, true));
  kintone.events.on('app.record.edit.submit.success',   (e) => afterSave(e, false));
  kintone.events.on('mobile.app.record.edit.submit.success',  (e) => afterSave(e, true));

})(kintone.$PLUGIN_ID);
