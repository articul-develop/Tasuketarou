window.AuthModule = (function () {
  'use strict';

  // API認証を行う関数
  async function authenticateDomain(API_CONFIG) {
    try {
      const response = await fetch(API_CONFIG.ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': API_CONFIG.AUTH_TOKEN,
        },
        body: JSON.stringify({
          Domain: location.hostname,
          ItemKey: API_CONFIG.ItemKey
        })
      });

      // レスポンスを JSON でパース
      const data = await response.json();
      return data;
    } catch (error) {
      console.error('認証API呼び出しエラー:', error);
      throw error;
    }
  }

  // エラーログをAPIに送信する関数
  async function sendErrorLog(errorMessage) {
    try {
      const response = await fetch(API_CONFIG.ERROR_LOG_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': API_CONFIG.AUTH_TOKEN,
        },
        body: JSON.stringify({
          Domain: location.hostname,
          ItemKey: API_CONFIG.ItemKey,
          ErrorContext: errorContext, //エラー発生場所
          ErrorMessage: errorMessage,
          Timestamp: new Date().toISOString()
        })
      });

      if (!response.ok) {
        console.error('エラーログの送信に失敗:', response.statusText);
      }
    } catch (error) {
      console.error('エラーログ送信エラー:', error);
    }
  }

  // 公開する関数をreturn
  return {
    authenticateDomain,
    sendErrorLog

  };
})();
