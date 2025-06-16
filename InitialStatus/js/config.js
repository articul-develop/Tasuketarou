/* eslint @typescript-eslint/no-unused-vars: 0 */
(async (PLUGIN_ID) => {
  'use strict';

  // -----------------------------
  // 1. 既存設定の読み込み
  // -----------------------------
  const config = kintone.plugin.app.getConfig(PLUGIN_ID) || {};
  const draftBtnLabel   = config.draftBtnLabel || '下書き保存';
  const actionToComplete = config.actionToComplete || '';
  const initialStatus    = config.initialStatus || '';

  // -----------------------------
  // 2. DOM 取得
  // -----------------------------
  const draftBtnInput = document.getElementById('draft-btn-label');
  const actionSelect  = document.getElementById('action-to-complete');
  const statusSelect  = document.getElementById('initial-status');
  const saveBtn       = document.getElementById('save-button');
  const cancelBtn     = document.getElementById('cancel-button');

  if (draftBtnInput) draftBtnInput.value = draftBtnLabel;

  // -----------------------------
  // 3. ステータス / アクション一覧を取得して <select> に反映
  // -----------------------------
  try {
    const apiUrl = kintone.api.url('/k/v1/app/status', true);
    const resp   = await kintone.api(apiUrl, 'GET', { app: kintone.app.getId() });

    // ▼ ステータス
    const stateList = Object.values(resp.states || {});
    if (stateList.length === 0) {
      alert('プロセス管理でステータスが設定されていません。');
    }
    stateList.forEach((item) => {
      const opt = document.createElement('option');
      opt.value = item.name;
      opt.textContent = item.name;
      if (item.name === initialStatus) opt.selected = true;
      statusSelect.appendChild(opt);
    });

    // ▼ アクション
    const actions = resp.actions || [];
    if (actions.length === 0) {
      alert('プロセス管理でアクションが設定されていません。');
    }
    actions.forEach((item) => {
      const opt = document.createElement('option');
      opt.value = item.name;
      opt.textContent = item.name;
      if (item.name === actionToComplete) opt.selected = true;
      actionSelect.appendChild(opt);
    });
  } catch (e) {
    alert('アプリのプロセス管理設定情報の取得に失敗しました。kintone管理者にご相談ください。');
  }

  // -----------------------------
  // 4. 保存ボタン
  // -----------------------------
  saveBtn.addEventListener('click', async () => {
    const newDraftLabel   = draftBtnInput.value.trim() || '下書き保存';
    const newAction       = actionSelect.value;
    const newInitialState = statusSelect.value;

    // 必須チェック
    if (!newAction || !newInitialState) {
      alert('アクション / 初期ステータスを選択してください。');
      return;
    }

    try {
      // -------▼ API 認証 ▼-------
      const data = await AuthModule.authenticateDomain(API_CONFIG);

      if (data.status !== 'success' ||
          !data.response ||
          data.response.status !== 'valid') {
        const message = data.response?.message || '不明なエラー';
        kintone.plugin.app.setConfig({ authStatus: 'invalid' }, () => {
          alert(`認証失敗: ${message}`);
        });
        return;
      }
      // -------▲ API 認証 ▲-------

      // 認証成功 → 設定を保存
      const newConfig = {
        draftBtnLabel:   newDraftLabel,
        actionToComplete: newAction,
        initialStatus:    newInitialState,
        authStatus:       'valid'
      };

      if (data.response.Trial_enddate) {
        newConfig.Trial_enddate = data.response.Trial_enddate;
      }

      kintone.plugin.app.setConfig(newConfig, () => {
        alert('設定を保存しました。');
        // プラグイン一覧へ戻る
        window.location.href = `/k/admin/app/${kintone.app.getId()}/plugin/`;
      });
    } catch (err) {
      console.error('認証API呼び出しエラー:', err);
      alert('認証中にエラーが発生しました。');
    }
  });

  // -----------------------------
  // 5. キャンセルボタン
  // -----------------------------
  cancelBtn.addEventListener('click', () => {
    window.location.href = `/k/admin/app/${kintone.app.getId()}/plugin/`;
  });
})(kintone.$PLUGIN_ID);
