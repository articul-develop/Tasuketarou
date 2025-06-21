(async (PLUGIN_ID) => {
  'use strict';

  // -----------------------------
  // 1. 既存設定の読み込み
  // -----------------------------
  const config = kintone.plugin.app.getConfig(PLUGIN_ID);

  // -----------------------------
  // 2. DOM 取得
  // -----------------------------
  const activateBtn = document.getElementById('activate-button');

  // -----------------------------
  // 3. ボタン初期テキスト
  // -----------------------------
  if (config.authStatus === 'valid') {
    activateBtn.textContent = '再認証';
  }

  // -----------------------------
  // 4. 認証ボタン
  // -----------------------------
  activateBtn.addEventListener('click', async () => {
    activateBtn.disabled = true;
    activateBtn.textContent = '認証中…';

    try {
      // -------▼ API 認証部分（テンプレート共通） ▼-------
      const data = await AuthModule.authenticateDomain(API_CONFIG);

      if (data.status !== 'success' ||
          !data.response ||
          data.response.status !== 'valid') {
        const message = data.response?.message || '不明なエラー';
        kintone.plugin.app.setConfig({ authStatus: 'invalid' }, () => {
          alert(`認証失敗: ${message}`);
          activateBtn.disabled = false;
          activateBtn.textContent = '認証';
        });
        return;
      }
      // -------▲ API 認証部分ここまで（変更なし） ▲-------

      // 認証成功 → 設定を保存
      const newConfig = {
        authStatus: 'valid'
      };
      if (data.response.Trial_enddate) {
        newConfig.Trial_enddate = data.response.Trial_enddate;
      }

      kintone.plugin.app.setConfig(newConfig, () => {
        alert('認証が完了しました。');
        // プラグイン一覧へ戻る
        window.location.href = `/k/admin/app/${kintone.app.getId()}/plugin/`;
      });
    } catch (err) {
      console.error('認証API呼び出しエラー:', err);
      alert('認証中にエラーが発生しました。');
      activateBtn.disabled = false;
      activateBtn.textContent = '認証';
    }
  });

  // -----------------------------
  // 5. 画面ロード完了
  // -----------------------------
})(kintone.$PLUGIN_ID);
