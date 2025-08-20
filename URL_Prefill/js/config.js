(async (PLUGIN_ID) => {
  'use strict';

  // -----------------------------
  // 1. 既存設定の読み込み（参考JSと同じ取得パターン）
  // -----------------------------
  const cfg = kintone.plugin.app.getConfig(PLUGIN_ID) || {};
  const featureEnabled = (cfg.featureEnabled ?? 'true'); // 既定：'true'（使用する）

  // -----------------------------
  // 2. DOM 取得（参考JSの命名/取得スタイルに倣う）
  // -----------------------------
  const onRadio = document.getElementById('feature-on');
  const offRadio = document.getElementById('feature-off');
  const saveBtn = document.getElementById('save-button');
  const cancelBtn = document.getElementById('cancel-button');

  // 既存設定の反映（初期表示）
  if (featureEnabled === 'false') {
    offRadio.checked = true;
  } else {
    onRadio.checked = true; // 既定：使用する
  }

  // -----------------------------
  // 3. 保存ボタン（クリック時に認証→設定保存）
  // -----------------------------
  saveBtn.addEventListener('click', async () => {
    try {
      // --- 認証 ---
      const authRes = await AuthModule.authenticateDomain(API_CONFIG);
      if (authRes.status !== 'success' ||
          !authRes.response ||
          authRes.response.status !== 'valid') {
        const msg = authRes.response?.message || '不明なエラー';
        alert(`認証失敗: ${msg}`);
        return;
      }

      // 選択値の確定
      const selected = onRadio.checked ? 'true' : 'false';

      // --- 設定保存 ---
      const newConfig = {
        featureEnabled: selected,
        authStatus: 'valid',
        Trial_enddate: authRes.response.Trial_enddate || ''
      };

      kintone.plugin.app.setConfig(newConfig);
    } catch (err) {
      console.error('認証中にエラーが発生しました。', err);
      alert('認証中にエラーが発生しました。');
    }
  });

  // -----------------------------
  // 4. キャンセルボタン（参考JSと同じ遷移）
  // -----------------------------
  cancelBtn.addEventListener('click', () => {
    window.location.href = `/k/admin/app/${kintone.app.getId()}/plugin/`;
  });
})(kintone.$PLUGIN_ID);
