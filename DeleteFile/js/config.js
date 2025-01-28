(async (PLUGIN_ID) => {
  'use strict';



  // DOMの準備が完了しているかチェック
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    initializePlugin();
  } else {
    document.addEventListener('DOMContentLoaded', initializePlugin);
  }



  // プラグインの初期化関数
  function initializePlugin() {
    // ドロップダウンリスト要素を取得
    const dropdown = document.getElementById('dropdown-list');
    const dropdownContainer = document.getElementById('dropdown-container'); // ドロップダウン追加用コンテナ
    const maxFields = 10; // 最大10件まで選択可能

    let fields = []; // グローバルに fields を定義
    // 既存設定の呼び出し
    const config = kintone.plugin.app.getConfig(PLUGIN_ID);


    // アプリIDを取得
    const appId = kintone.app.getId();

    // アプリIDが取得できない場合のエラーハンドリング
    if (!appId) {
      console.error('アプリIDを取得できませんでした！');
      return;
    }

    // kintone APIのURLを作成
    const urlFields = kintone.api.url('/k/v1/app/form/fields', true);
    const urlViews = kintone.api.url('/k/v1/app/views', true);

    // APIリクエストのリクエストボディを準備
    const body = { app: appId };

    // ドロップダウン行を作成
    function createFieldRow(fields) {
      const row = document.createElement('div');
      row.className = 'field-row';

      // ドロップダウン
      const dropdown = document.createElement('select');
      dropdown.className = 'kintoneplugin-select';
      dropdown.innerHTML = '<option value="">フィールドを選択</option>';

      // FILE タイプのフィールドのみ追加
      Object.keys(fields).forEach(fieldKey => {
        const field = fields[fieldKey];
        if (field.type === 'FILE') {
          const option = document.createElement('option');
          option.value = field.code;
          option.textContent = field.label;
          dropdown.appendChild(option);
        }
      });

      // + ボタン
      const addButton = document.createElement('button');
      addButton.className = 'add-row-button';
      addButton.textContent = '+';
      addButton.addEventListener('click', () => {
        if (dropdownContainer.children.length < maxFields) {
          dropdownContainer.appendChild(createFieldRow(fields));
        } else {
          alert('これ以上追加できません。最大10件までです。');
        }
      });

      // - ボタン
      const removeButton = document.createElement('button');
      removeButton.className = 'add-row-button';
      removeButton.textContent = '−';
      removeButton.addEventListener('click', () => {
        if (dropdownContainer.children.length > 1) {
          row.remove();
        } else {
          alert('最低1件は必要です。');
        }
      });

      // 行に要素を追加
      row.appendChild(dropdown);
      row.appendChild(addButton);
      row.appendChild(removeButton);

      return row;
    }


    // フォームフィールド情報を取得
    kintone.api(urlFields, 'GET', body).then(response => {
      const fields = response.properties;

      if (!fields || Object.keys(fields).length === 0) {
        console.warn('レスポンスにフィールドが見つかりませんでした！');
        return;
      }



      // ビュー情報を取得
      kintone.api(urlViews, 'GET', body).then(response => {
        const views = response.views;

        if (!views || Object.keys(views).length === 0) {
          console.warn('レスポンスにビューが見つかりませんでした！');
          return;
        }

        // typeがLISTのビューのみをドロップダウンに追加
        Object.keys(views).forEach(viewKey => {
          const view = views[viewKey];
          if (view.type === 'LIST') {
            const option = document.createElement('option');
            option.value = viewKey;
            option.textContent = view.name;
            dropdown.appendChild(option);
          }
        });

        // 既存設定の初期化
        if (config) {
          // dropdown-list の初期値設定
          if (config.dropdownList) {
            dropdown.value = config.dropdownList;
          }
        }

        // dropdown-container の初期値設定
        if (config.dropdownContainer) {
          const savedValues = JSON.parse(config.dropdownContainer);
          if (savedValues.length > 0) {
            savedValues.forEach(value => {
              const fieldRow = createFieldRow(fields); // フィールド情報を渡す
              const selectElement = fieldRow.querySelector('select');
              if (selectElement) {
                selectElement.value = value;
              }
              dropdownContainer.appendChild(fieldRow);
            });
          } else {
            dropdownContainer.appendChild(createFieldRow(fields));
          }
        } else {
          dropdownContainer.appendChild(createFieldRow(fields));
        }


      }).catch(error => {
        console.error('ビュー情報の取得中にエラーが発生しました:', error);
      });




      // 保存処理

      document.getElementById('save-button').addEventListener('click', async function () {
        try {
          // dropdown-list の選択値を取得
          const dropdownListValue = document.getElementById('dropdown-list').value;

          // dropdown-container の選択値を取得
          const dropdownContainerValues = Array.from(
            document.getElementById('dropdown-container').querySelectorAll('select')
          )
            .map(dropdown => dropdown.value)
            .filter(value => value !== '');


          // 必須項目が未選択の場合のチェック
          if (!dropdownListValue) {
            alert('削除ボタンを表示する一覧を選択してください');
            return;
          }

          if (dropdownContainerValues.length === 0) {
            alert('少なくとも1つの削除対象フィールドを選択してください');
            return;
          }



          //  API認証
          const data = await AuthModule.authenticateDomain(API_CONFIG);
          //console.log('レスポンスJSONデータ※分割後:', data);



          // 認証結果の確認
          if (data.status !== 'success' || !data.response || data.response.status !== 'valid') {
            const message = data.response?.message || '不明なエラー';

            // 認証失敗時にauthStatusをinvalidで保存
            kintone.plugin.app.setConfig(
              {
                authStatus: 'invalid' // 認証失敗として保存
              },
              () => {
                alert(`認証失敗: ${message}`);
              }
            );
            return;
          }


          // 保存データの準備
          const now = new Date();
          const formattedDate = `${now.getFullYear()}${(now.getMonth() + 1).toString().padStart(2, '0')}${now.getDate().toString().padStart(2, '0')}`;

          const config = {
            dropdownList: dropdownListValue, // dropdown-list の選択値を保存
            dropdownContainer: JSON.stringify(dropdownContainerValues), // dropdown-container の選択値を保存
            authStatus: 'valid',   
          };

          // Trial_enddateが存在する場合に追加
          if (data.response.Trial_enddate) {
            config.Trial_enddate = data.response.Trial_enddate; // 返却されたTrial_enddateを保存
          }



          // 保存処理 (kintone.plugin.app.setConfigを使用)
          kintone.plugin.app.setConfig(config, () => {
            alert('設定が保存されました');
            window.location.href = `/k/admin/app/${kintone.app.getId()}/plugin/`;
          });


        } catch (error) {
          console.error('認証API呼び出しエラー:', error);
          alert('認証中にエラーが発生しました。');
        }
      });

      // キャンセルボタンの動作
      const cancelButton = document.getElementById('cancel-button');
      cancelButton.addEventListener('click', () => {
        window.location.href = `/k/admin/app/${kintone.app.getId()}/plugin/`;
      });
    })
  }
})(kintone.$PLUGIN_ID);
