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

      // エラーログ送信の成功・失敗をコンソールに出力
      console.log("🔍【デバッグ情報】sendErrorLog に渡された API_CONFIG:", API_CONFIG);
      console.log("🖥️ ERROR_LOG_ENDPOINT:", API_CONFIG?.ERROR_LOG_ENDPOINT);
      console.log("📡 送信データ:", {
        Domain: location.hostname,
        ItemKey: API_CONFIG.ItemKey,
        ErrorContext: errorContext,
        ErrorMessage: errorMessage,
        Timestamp: new Date().toLocaleString()
      });


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

      console.log("📡【レスポンス情報】ステータスコード:", response.status);
      console.log("📡【レスポンス情報】ヘッダー:", [...response.headers]);

      /*
            if (!response.ok) {
              console.error('エラーログの送信に失敗:', response.statusText);
            }
          } catch (error) {
            console.error('エラーログ送信エラー:', error);
          }
        }
          */
         
      if (!response.ok) {
        const errorData = await response.json().catch(() => "レスポンスJSONの解析に失敗");
        console.error("🚨 エラーログの送信に失敗:", response.statusText);
        console.error("❌ サーバーからのレスポンス:", errorData);
        throw new Error(`エラーログAPIエラー: ${response.status} ${response.statusText}`);
      } else {
        console.log("✅ エラーログ送信成功！");
        const responseData = await response.json();
        console.log("📡【レスポンス内容】", responseData);
      }
    } catch (error) {
      console.error("🚨【エラーログ送信エラー】", error.message || error);
      console.error("🛠️【エラー詳細】", error);
    }
  }



  // 公開する関数をreturn
  return {
    authenticateDomain,
    sendErrorLog

  };
})();
