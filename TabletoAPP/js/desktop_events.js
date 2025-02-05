/*
(function (PLUGIN_ID) {
  'use strict';

  // 認証フラグを取得
  const isAuthenticated = window.isAuthenticated(); // 認証状態は同期的に取得

  // イベントハンドラーの登録
  kintone.events.on(['app.record.create.show', 'app.record.edit.show'], function (event) {
    // 認証状態をチェック
    if (!isAuthenticated) {
      event.error = '認証に失敗しているため、処理を実行できません。';
      return event;
    }

    if (isAuthenticated) {
      // 認証成功の場合のみ、実行ロジックを呼び出す
      window.executeDesktopLogic(); // 同期的に呼び出す
      return event;
      }
  });

})(kintone.$PLUGIN_ID);

*/
