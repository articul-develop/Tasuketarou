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
  async function sendErrorLog(API_CONFIG, errorContext, errorMessage) {
    try {

      console.log("🔍【デバッグ情報】sendErrorLog に渡された API_CONFIG:", API_CONFIG);
      console.log("🖥️ ERROR_LOG_ENDPOINT:", API_CONFIG?.ERROR_LOG_ENDPOINT);

      if (!API_CONFIG || !API_CONFIG.ERROR_LOG_ENDPOINT) {
          throw new Error("API_CONFIG または ERROR_LOG_ENDPOINT が undefined です");
      }

      console.log("📡【送信データ】: ", {
          Domain: location.hostname,
          ItemKey: API_CONFIG.ItemKey,
          ErrorContext: errorContext,
          ErrorMessage: errorMessage,
          Timestamp: new Date().toLocaleString()
      });

      console.log("📡 fetch() を実行します...");
/*
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
          Timestamp: new Date().toLocaleString()
        })
      });
*/
const controller = new AbortController();
const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("⏳ Fetchタイムアウト")), 5000));
const fetchPromise = fetch(API_CONFIG.ERROR_LOG_ENDPOINT, {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Authorization': API_CONFIG.AUTH_TOKEN,
    },
    body: JSON.stringify({
        Domain: location.hostname,
        ItemKey: API_CONFIG.ItemKey,
        ErrorContext: errorContext,
        ErrorMessage: errorMessage,
        Timestamp: new Date().toLocaleString()
    }),
    signal: controller.signal
});

const response = await Promise.race([fetchPromise, timeout]);
clearTimeout(controller.abort);

console.log("📡【レスポンス情報】fetch() の完了を確認");
console.log("📡【レスポンス情報】ステータスコード:", response.status);

} catch (error) {
console.error("🚨【エラーログ送信エラー】", error.message || "エラー詳細不明");
if (error.message === "⏳ Fetchタイムアウト") {
    console.error("⏳ Bubble API からのレスポンスが返ってこない可能性があります");
}
}
}


      /*
            if (!response.ok) {
              console.error('エラーログの送信に失敗:', response.statusText);
            }
          } catch (error) {
            console.error('エラーログ送信エラー:', error);
          }
        }
          */
         
      



  // 公開する関数をreturn
  return {
    authenticateDomain,
    sendErrorLog

  };
})();
