(function (PLUGIN_ID) {
  'use strict';

  // 今日の日付をyyyymmdd形式に変換
  const today = new Date();
  const todayStr = today.getFullYear().toString() +
    (today.getMonth() + 1).toString().padStart(2, '0') +
    today.getDate().toString().padStart(2, '0');

  // LocalStorageから認証日を取得
  const storageKey = `PLUGIN_${kintone.$PLUGIN_ID}_config`;
  const storageconfig = JSON.parse(localStorage.getItem(storageKey)) || {};
  const lastAuthDate = storageconfig.lastAuthDate || ''; // 最終認証日
  //const lastAuthDate = '20250127'

  // プラグインの設定情報を取得
  const config = kintone.plugin.app.getConfig(PLUGIN_ID) || {};
  const trialEndDateStr = config.Trial_enddate || ''; // お試し期限日
  const authStatus = config.authStatus || ''; // 認証ステータス

  //お試し期限の表示
  kintone.events.on(['app.record.create.show', 'app.record.edit.show'], function (event) {
    if (config.Trial_enddate) {
      const trialEndDateStr = config.Trial_enddate;

      if (trialEndDateStr > todayStr) {
        const headerSpace = kintone.app.record.getHeaderMenuSpaceElement();

        // カスタムメッセージの追加
        if (headerSpace && !headerSpace.querySelector('.custom-header-text')) {
          const customText = document.createElement('div');
          customText.className = 'custom-header-text';
          customText.textContent = `テーブル連携プラグイン　お試し期間中（～${trialEndDateStr.slice(0, 4)}/${trialEndDateStr.slice(4, 6)}/${trialEndDateStr.slice(6, 8)}）`;
          customText.style.marginLeft = '10px';
          customText.style.fontSize = '16px';
          customText.style.color = 'blue';
          headerSpace.appendChild(customText);
        }
      }
    }
    return event;
  });

  // 認証状態を保持するフラグ
  let isAuthenticated = false;

  // 認証チェック関数
  async function initializeAuthentication() {
    const authResult = await checkAndReauthenticate();
    isAuthenticated = authResult?.success ?? false;  // authResultがundefinedの可能性も考慮
  }


  // 認証チェック関数
  async function checkAndReauthenticate() {
    const errorMessages = [];

    // 設定情報がない場合
    if (Object.keys(config).length === 0) {
      errorMessages.push('プラグイン設定が取得できませんでした。');
      return { success: false, errors: errorMessages };
    }

    // 認証ステータスが無効
    if (authStatus !== 'valid') {
      errorMessages.push('プラグイン認証ステータスが無効です。');
      return { success: false, errors: errorMessages };
    }

    // お試し期間が終了している
    if (trialEndDateStr && trialEndDateStr < todayStr) {
      errorMessages.push('プラグインお試し期間が終了しています。');
      return { success: false, errors: errorMessages };
    }

    // AuthDateが今日以降かどうかを確認
    if (lastAuthDate && lastAuthDate >= todayStr) {
      console.log('認証済みです。');
      return { success: true }; // 認証済み
    }

    // ここまで来た場合は認証が必要
    console.log('認証処理を開始します...');
    try {
      const response = await AuthModule.authenticateDomain(API_CONFIG);
      if (response.status === 'success' && response.response?.status === 'valid') {
        // 認証成功 → 認証日を更新
        localStorage.setItem(storageKey, JSON.stringify({ lastAuthDate: todayStr }));
        console.log('認証成功');
        return { success: true };
      } else {
        errorMessages.push('認証エラー: ' + (response.response?.message || '不明なエラー'));
      }
    } catch (error) {
      errorMessages.push('認証中にエラーが発生しました。');
    }

    console.error(errorMessages.join('\n'));
    return { success: false, errors: errorMessages }; // 認証失敗
  }

  // 認証初期化を同期的にエクスポート
  window.isAuthenticated = function () {
    return isAuthenticated;
  };

  // 初期化処理を実行
  (async () => {
    await initializeAuthentication();
  })();







})(kintone.$PLUGIN_ID);
