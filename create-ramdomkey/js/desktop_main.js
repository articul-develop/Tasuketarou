((PLUGIN_ID) => {
  'use strict';

  // プラグインの設定情報を取得する
  const config = kintone.plugin.app.getConfig(PLUGIN_ID) || {};

  const targetField = config.targetField; // フィールドコード
  let digitLength = parseInt(config.digitLength, 10); // 数値に変換
  const charType = config.charType || 'alphanumeric'; // デフォルト値

  //レコード再利用時に行識別子をクリア
  kintone.events.on(['app.record.create.show', 'mobile.app.record.create.show'], function (event) {
    // レコードを再利用した場合（reuse === true）
    if (event.reuse === true) {
      event.record[targetField].value = '';
    }
    return event;
  });



  (function () {
    // 対象イベント: 新規登録および編集登録時に処理を実行
    kintone.events.on(['app.record.create.submit', 'app.record.edit.submit', 'mobile.app.record.create.submit', 'mobile.app.record.edit.submit'],
      async function (event) {

        // 認証が成功しているか確認
        if (!window.isAuthenticated || !window.isAuthenticated()) {
          // 認証に失敗した場合、処理を中断
          return;
        }


        // ランダムな文字列を生成する関数
        function generateRandomKey(length, charType) {
          let characters = '';
          switch (charType) {
            case 'numeric':
              characters = '0123456789';
              break;
            case 'numeric_lowercase':
              characters = '0123456789abcdefghijklmnopqrstuvwxyz';
              break;
            case 'numeric_mixedcase':
              characters = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
              break;
            case 'numeric_mixedcase_symbol':
              characters = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ!@#$%^&*()-_=+[]{}|;:",.<>?';
              break;
            default:
              console.error('Invalid charType specified.');
              return '';
          }

          let result = '';
          for (let i = 0; i < length; i++) {
            result += characters.charAt(Math.floor(Math.random() * characters.length));
          }
          return result;
        }



        if (isNaN(digitLength) || digitLength <= 0) {
          digitLength = 10; // デフォルト値: 10
        }
        if (isNaN(digitLength) || digitLength <= 0) {
          alert('エラー: digitLength の値が無効です。');
          throw new Error('digitLength の値が無効です');
        }

        // 設定されたフィールドコードが存在するか確認
        if (!targetField || !event.record[targetField]) {
          const errorMessage = `指定されたフィールドコード "${targetField}" が存在しません。`;
          alert(errorMessage);
          await AuthModule.sendErrorLog(API_CONFIG, 'generateRandomKey', errorMessage);
          return event; // エラーでも処理を続行
        }

        // 対象フィールドがブランクの場合のみランダムキーを設定
        if (!event.record[targetField].value) {
          let randomKey = generateRandomKey(digitLength, charType);
          event.record[targetField].value = randomKey;
        }
        return event;
      });
  })();

})(kintone.$PLUGIN_ID);
