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
          ItemKey: 3 // ★BubbleでのアプリID
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



  // 公開する関数をreturn
  return {
    authenticateDomain
  };
})();
