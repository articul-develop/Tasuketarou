(function (PLUGIN_ID) {
  'use strict';

  // 共通のエラー処理関数（エラーメッセージをログ出力・alert・返却）
  async function handleAuthError(errorMessages) {
    const errorText = errorMessages.join('\n') || '認証中に不明なエラーが発生しました';
    await AuthModule.sendErrorLog(API_CONFIG, 'checkAndReauthenticate', errorText);
    alert(errorText);
    return { success: false, errors: errorMessages };
  }


  // 今日の日付をyyyymmdd形式に変換
  const today = new Date();
  const todayStr = today.getFullYear().toString() +
    (today.getMonth() + 1).toString().padStart(2, '0') +
    today.getDate().toString().padStart(2, '0');

  // LocalStorageから認証日を取得
  const storageKey = `PLUGIN_${kintone.$PLUGIN_ID}_config`;
  const storageconfig = JSON.parse(localStorage.getItem(storageKey)) || {};
  const lastAuthDate = storageconfig.lastAuthDate || ''; // 最終認証日
  //const lastAuthDate = '20250101'; //Debug 
  //console.log('lastAuthDate:', lastAuthDate);//Debug

  // プラグインの設定情報を取得
  const config = kintone.plugin.app.getConfig(PLUGIN_ID) || {};
  const trialEndDateStr = config.Trial_enddate || ''; // お試し期限日
  //const trialEndDateStr = '20250127'; //Debug
  //console.log('お試し期間：', trialEndDateStr);

  const authStatus = config.authStatus || ''; // 認証ステータス
  //const authStatus = 'invalid' //Debug 
  //console.log('authStatus:', authStatus);//Debug

  // お試し期限の表示
  function appendTrialLabel(headerSpace) {
    if (!config.Trial_enddate || config.Trial_enddate < todayStr) {
      return;
    }
    if (!headerSpace || headerSpace.querySelector('.custom-header-text')) {
      return;
    }
    const trialEndDate = config.Trial_enddate;
    const customText = document.createElement('div');
    customText.className = 'custom-header-text';
    customText.textContent = `プラグイン　お試し期間中（～${trialEndDate.slice(0, 4)}/${trialEndDate.slice(4, 6)}/${trialEndDate.slice(6, 8)}）`;
    customText.style.marginLeft = '10px';
    customText.style.fontSize = '16px';
    customText.style.color = 'blue';
    headerSpace.appendChild(customText);
  }

  kintone.events.on(['app.record.create.show', 'app.record.edit.show'], function (event) {
    appendTrialLabel(kintone.app.record.getHeaderMenuSpaceElement());
    return event;
  });

  // 本プラグインの主画面は一覧のため、一覧画面でも表示する
  kintone.events.on('app.record.index.show', function (event) {
    appendTrialLabel(kintone.app.getHeaderMenuSpaceElement());
    return event;
  });

  // 認証状態を保持するフラグ
  let isAuthenticated = false;

  // 認証チェック関数
  async function initializeAuthentication() {
    const authResult = await checkAndReauthenticate();
    if (authResult !== undefined) {
      isAuthenticated = authResult.success; // `undefined` の場合は `isAuthenticated` を確定しない
  }
  }


  // 認証チェック関数
  async function checkAndReauthenticate() {
    const errorMessages = [];

    // 設定情報がない場合
    if (Object.keys(config).length === 0) {
      errorMessages.push('プラグイン設定が取得できませんでした。再度プラグインの設定を行ってください。');
      return await handleAuthError(errorMessages);
    }

    // 認証ステータスが無効
    if (authStatus !== 'valid') {
      errorMessages.push('プラグイン設定が失敗しています。再度プラグインの設定を行ってください。');
      return await handleAuthError(errorMessages);
    }

    // お試し期間が終了している
    if (trialEndDateStr && trialEndDateStr < todayStr) {
      errorMessages.push('プラグインお試し期間が終了しています。本契約をご検討ください。ご使用にならない場合はプラグイン設定より無効にしてください。');
      return await handleAuthError(errorMessages);
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
        return await handleAuthError(errorMessages);
      }
    } catch (error) {
      errorMessages.push('認証中にエラーが発生しました。');
      return await handleAuthError(errorMessages);
    }
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
