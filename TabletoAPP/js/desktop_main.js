(function (PLUGIN_ID) {
  'use strict';

  // プラグインの設定情報を取得する
  const config = kintone.plugin.app.getConfig(PLUGIN_ID) || {};
  //console.log('プラグイン設定取得');


  async function getAuthenticationStatus() {
    let authStatus = window.isAuthenticated();

    // 認証処理が完了していない場合、少し待つ
    if (authStatus === undefined || authStatus === "") {
      console.warn("認証処理が完了していないため、待機します...");
      await new Promise(resolve => setTimeout(resolve, 500)); // 500ms待機
      authStatus = window.isAuthenticated(); // 再取得
    }
    return !!authStatus; // `undefined`, `""`, `null` を `false` に変換
  }


  //認証済みの場合にのみ、Kintoneイベントを登録

  async function registerKintoneEvents() {
    const isAuthenticated = await getAuthenticationStatus();

    if (!isAuthenticated) {
      console.warn("プラグインの処理をスキップします（認証されていません）");
      return;
    }




    //ここまで追加

    //更新元アプリの設定
    const tableFieldCode = config.tableFieldCode;
    const baseUrl = location.origin;

    // 更新先アプリの設定
    const targetAppId = config.targetAppId;
    const apiToken = config.apiToken;
    const targetUrl = `${baseUrl}/k/v1/records.json`;

    // 更新キー項目の定義
    const ROW_IDENTIFIER_FIELD = config.rowIdentifierField;

    //連携項目の設定
    const SOURCE_RECORD_NUMBER = config.sourceRecordNumber; // レコードNOに対応
    const TABLE_ROW_NUMBER = config.tableRowNumber;


    // 動的な変数設定
    const VARIABLES = [];
    const ROW_VARIABLES = [];

    for (let i = 1; i <= 20; i++) {
      VARIABLES.push(config[`VARIABLE_${i}`] || '');
      ROW_VARIABLES.push(config[`ROW_VARIABLE_${i}`] || '');
    }


    // 行識別子の非表示
    const eventsToShow = ['app.record.create.show', 'app.record.edit.show'];
    kintone.events.on(eventsToShow, function (event) {
      const config = kintone.plugin.app.getConfig(PLUGIN_ID) || {};
      if (config.hideKeyField) {
        kintone.app.record.setFieldShown(ROW_IDENTIFIER_FIELD, false);
      }
      return event;
    });

    //レコード再利用時に行識別子をクリア
    kintone.events.on('app.record.create.show', function (event) {
      // レコードを再利用した場合（reuse === true）
      if (event.reuse === true) {
        event.record[tableFieldCode].value.forEach(row => {
          row.value[ROW_IDENTIFIER_FIELD].value = '';
        }
        );
      }
      return event;
    });

    // 削除時処理の共通ロジック
    async function deleteRecordsByIdentifiers(identifiers, targetUrl, targetAppId, apiToken) {
      if (!Array.isArray(identifiers) || identifiers.length === 0) {
        return; // 削除対象がない場合は終了
      }

      try {
        const idsToDelete = [];

        for (const identifier of identifiers) {
          const deleteQuery = `${ROW_IDENTIFIER_FIELD} = "${identifier}"`;
          const deleteResponse = await fetch(`${targetUrl}?app=${targetAppId}&query=${encodeURIComponent(deleteQuery)}`, {
            method: 'GET',
            headers: { 'X-Cybozu-API-Token': apiToken },
          });

          if (!deleteResponse.ok) continue; // エラー時はスキップ

          const deleteRecords = (await deleteResponse.json()).records;
          deleteRecords.forEach(record => idsToDelete.push(record.$id.value));
        }

        if (idsToDelete.length > 0) {
          const deletePayload = { app: targetAppId, ids: idsToDelete };
          const deleteRequest = await fetch(targetUrl, {
            method: 'DELETE',
            headers: {
              'Content-Type': 'application/json',
              'X-Cybozu-API-Token': apiToken,
            },
            body: JSON.stringify(deletePayload),
          });

          if (!deleteRequest.ok) {
            const errorData = await deleteRequest.json();
            console.error('削除リクエストエラー:', errorData);
            const errorMessage = errorData?.message || errorData?.errors?.[0]?.message || 'エラー内容が取得できませんでした。';
            alert(`プラグインエラー：削除リクエストエラー\n${errorMessage}`);
          }
        }
      } catch (error) {
        console.error('削除処理中のエラー:', error.message);
        const errorMessage = error?.message || '削除処理中に予期しないエラーが発生しました。';
        alert(`プラグインエラー：削除処理中にエラーが発生しました。\n${errorMessage}`);
      }
    }

    // 削除時処理の共通ロジックEND

    //行削除前データ取得
    // 保存前のテーブル状態（更新キー項目のみ）を保持
    let previousIdentifiers = [];

    // 編集画面表示時に現在のテーブル状態（更新キー項目のみ）を記録
    kintone.events.on('app.record.edit.show', function (event) {
      const record = event.record;

      // テーブルの更新キー項目だけを記録
      if (record[tableFieldCode] && record[tableFieldCode].value) {
        previousIdentifiers = record[tableFieldCode].value
          .map(row => row.value[ROW_IDENTIFIER_FIELD].value || '');
      } else {
        previousIdentifiers = [];
      }
      return event;
    });
    //行削除前データ取得END

    //保存時処理
    const saveEvents = [
      'app.record.create.submit.success',
      'app.record.edit.submit.success'
    ];

    kintone.events.on(saveEvents, async function (event) {
      const record = event.record;

      // レコード番号を6桁にフォーマット（前ゼロ付与）
      const recordNumber = event.recordId; // レコード保存時に自動的に割り振られる番号
      const formattedRecordNumber = recordNumber.toString().padStart(6, '0'); // 例: "15" -> "000015"

      // テーブルフィールドコード
      const tableRecords = record[tableFieldCode].value;

      // 保存後の更新キー項目リストを取得
      const currentIdentifiers = tableRecords.map(row => row.value[ROW_IDENTIFIER_FIELD].value || '');

      // 削除された更新キー項目を特定
      const deletedIdentifiers = previousIdentifiers.filter(id => !currentIdentifiers.includes(id));


      // 1.自アプリの更新キー項目を更新 (重複しないように採番)
      let existingIdentifiers = new Set(
        tableRecords.map(row => row.value[ROW_IDENTIFIER_FIELD].value || '')
      ); // 既存の更新キー項目を取得

      const recordsToCreateInTarget = [];

      for (let i = 0; i < tableRecords.length; i++) {
        if (!tableRecords[i].value[ROW_IDENTIFIER_FIELD].value) {
          // 更新キー項目が未設定の場合、新しい識別子を生成
          let newIdentifier;
          let rowNo = i + 1;
          do {
            newIdentifier = `${formattedRecordNumber}${rowNo.toString().padStart(3, '0')}`; // 例: "000015001"
            rowNo++;
          } while (existingIdentifiers.has(newIdentifier)); // 重複がある場合は再生成

          // 更新キー項目を設定
          tableRecords[i].value[ROW_IDENTIFIER_FIELD].value = newIdentifier;
          existingIdentifiers.add(newIdentifier); // 生成済み識別子を追加


          // 更新先アプリに追加するためのデータを作成
          const recordData = {
            [ROW_IDENTIFIER_FIELD]: { value: newIdentifier },
            [SOURCE_RECORD_NUMBER]: { value: recordNumber },
            [TABLE_ROW_NUMBER]: { value: i + 1 },
          };

          // 動的に VARIABLE_X を設定
          VARIABLES.forEach((variable, index) => {
            if (variable) {
              recordData[variable] = { value: record[variable]?.value || '' };
            }
          });

          // 動的に ROW_VARIABLE_X を設定
          ROW_VARIABLES.forEach((rowVariable, index) => {
            if (rowVariable) {
              recordData[rowVariable] = { value: tableRecords[i].value[rowVariable]?.value || '' };
            }
          });

          // 作成用データリストに追加
          recordsToCreateInTarget.push(recordData);
        }
      }

      // 自アプリを更新するためのリクエスト
      const updatePayload = {
        app: kintone.app.getId(),
        id: recordNumber,
        record: {
          [tableFieldCode]: {
            value: tableRecords
          }
        }
      };

      try {
        // 自アプリの更新
        await kintone.api(kintone.api.url('/k/v1/record', true), 'PUT', updatePayload);
      } catch (error) {
        const errorMessage = error?.message;
        alert(`プラグインエラー：当アプリの更新キー項目の更新に失敗しました。\n${errormessage}`);
        return event;
      }

      // 2. 削除された行を更新先アプリから削除
      if (deletedIdentifiers.length > 0) {
        try {
          await deleteRecordsByIdentifiers(deletedIdentifiers, targetUrl, targetAppId, apiToken);
        } catch (error) {
          const errorMessage = error?.message;
          alert(`プラグインエラー：削除処理中にエラーが発生しました。\n${errormessage}`);
        }
      }


      //3.Update
      // 更新元アプリに存在する更新キー項目リストを取得
      const recordsToUpdate = [];

      const identifiers = tableRecords
        .filter(row => row.value[ROW_IDENTIFIER_FIELD].value) // 更新キー項目が設定されている行のみ
        .map(row => `"${row.value[ROW_IDENTIFIER_FIELD].value}"`); // 値をクエリ用にエスケープ

      if (identifiers.length === 0) {
        return event; // 更新キー項目がない場合は処理をスキップ
      }

      // クエリ文字列を作成
      const query = `${ROW_IDENTIFIER_FIELD} in (${identifiers.join(",")})`;

      // 更新先アプリの既存レコードを取得
      try {
        const response = await fetch(`${targetUrl}?app=${targetAppId}&query=${encodeURIComponent(query)}`, {
          method: 'GET',
          headers: {
            'X-Cybozu-API-Token': apiToken,
          },
        });

        if (!response.ok) {
          const errorData = await response.json();
          console.error('更新先アプリのレコード取得エラー:', errorData);
          const errorMessage = errorData?.message || errorData?.errors?.[0]?.message || 'エラー内容が取得できませんでした。';
          alert(`プラグインエラー：更新先アプリからレコードを取得できませんでした。\n${errorMessage}`);

          return event;
        }

        const targetRecords = (await response.json()).records;

        // 更新用データを構築
        for (let row of tableRecords) {
          const identifier = row.value?.[ROW_IDENTIFIER_FIELD]?.value || null;
          if (!identifier) continue; // 更新キー項目がない場合はスキップ

          const matchingRecord = targetRecords.find(rec => rec?.[ROW_IDENTIFIER_FIELD]?.value === identifier);

          if (matchingRecord) {
            // 動的に VARIABLE_X と ROW_VARIABLE_X を設定
            const recordData = {};

            VARIABLES.forEach((variable, index) => {
              if (variable) {
                recordData[variable] = { value: record[variable]?.value || '' };
              }
            });

            ROW_VARIABLES.forEach((rowVariable, index) => {
              if (rowVariable) {
                recordData[rowVariable] = { value: row.value?.[rowVariable]?.value || '' };
              }
            });

            // 必要な固定データを追加
            recordData[TABLE_ROW_NUMBER] = { value: tableRecords.indexOf(row) + 1 };

            recordsToUpdate.push({
              id: matchingRecord.$id?.value || null,
              record: recordData,
            });
          }
        }

      } catch (error) {
        const errorMessage = error?.message;
        alert(`プラグインエラー：更新処理に失敗しました。\n${errormessage}`);
        return event;
      }



      // 更新先アプリにデータを送信
      if (recordsToUpdate.length > 0) {
        const updatePayload = {
          app: targetAppId,
          records: recordsToUpdate.map(record => ({
            id: record.id,
            revision: record.revision || -1, // 最新リビジョンを使うか明示的に指定されたものを使用
            record: record.record,
          })),
        };

        try {
          const updateResponse = await fetch(targetUrl, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              'X-Cybozu-API-Token': apiToken,
            },
            body: JSON.stringify(updatePayload),
          });

          if (!updateResponse.ok) {
            const errorData = await updateResponse.json();
            console.error('更新先アプリの更新エラー:', errorData);
            const errorMessage = errorData?.message || errorData?.errors?.[0]?.message || 'エラー内容が取得できませんでした。';
            alert(`プラグインエラー：更新先アプリへの更新に失敗しました。\n${errorMessage}`);
          }
        } catch (error) {
          const errorMessage = error?.message;
          alert(`プラグインエラー：更新先アプリへの通信に失敗しました。\n${errormessage}`);

        }
      }



      // 4.Create
      if (recordsToCreateInTarget.length > 0) {
        try {
          const createResponse = await fetch(targetUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Cybozu-API-Token': apiToken,
            },
            body: JSON.stringify({ app: targetAppId, records: recordsToCreateInTarget }),
          });

          if (!createResponse.ok) {
            const errorData = await createResponse.json();
            console.error('更新先アプリの新規登録エラー:', errorData);
            const errorMessage = errorData?.message || errorData?.errors?.[0]?.message || 'エラー内容が取得できませんでした。';
            alert(`プラグインエラー：更新先アプリへの新規登録に失敗しました。\n${errorMessage}`);
          }
        } catch (error) {
          const errorMessage = error?.message;
          alert(`プラグインエラー：更新先アプリへの通信に失敗しました。\n${errormessage}`);
          return event;
        }
      }
    });




    //5.削除
    // レコード削除時（詳細画面）
    kintone.events.on('app.record.detail.delete.submit', async function (event) {
      try {
        await deleteRecordsByIdentifiers(
          event.record[tableFieldCode]?.value.map(row => row.value[ROW_IDENTIFIER_FIELD].value || ''),
          targetUrl,
          targetAppId,
          apiToken
        );
      } catch (error) {
        const errorMessage = error?.message;
        console.error('詳細画面での削除処理エラー:', error.message); // エラー時のみログを出力
        alert(`プラグインエラー：詳細画面での削除処理中にエラーが発生しました。\n${errormessage}`);
      }
      return event;
    });

    // レコード削除時（一覧画面）
    kintone.events.on('app.record.index.delete.submit', async function (event) {
      try {
        await deleteRecordsByIdentifiers(
          event.record[tableFieldCode]?.value.map(row => row.value[ROW_IDENTIFIER_FIELD].value || ''),
          targetUrl,
          targetAppId,
          apiToken
        );
      } catch (error) {
        const errorMessage = error?.message;
        console.error('一覧画面での削除処理エラー:', error.message); // エラー時のみログを出力
        alert(`プラグインエラー：一覧画面での削除処理中にエラーが発生しました。\n${errormessage}`);
      }
      return event;
    });


  }

  // イベント登録の実行
  registerKintoneEvents();

  //ここまで追加

})(kintone.$PLUGIN_ID);

