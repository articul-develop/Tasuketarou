(async (PLUGIN_ID) => {
    'use strict';

    let fields = []; // グローバルに fields を定義
    //既存設定の呼び出し
    const config = kintone.plugin.app.getConfig(PLUGIN_ID);
    const targetAppId = config.targetAppId || '';
    const apiToken = config.apiToken || '';
    const tableFieldCode = config.tableFieldCode || '';
    const rowIdentifierField = config.rowIdentifierField || '';
    const sourceRecordNumber = config.sourceRecordNumber || '';
    const tableRowNumber = config.tableRowNumber || '';
    // 非表示にするチェックボックスの初期値を設定
    const hideKeyFieldCheckbox = document.getElementById('hideKeyField');
    hideKeyFieldCheckbox.checked = config.hideKeyField === 'true';


    // targetAppId の設定
    const targetAppSelect = document.querySelector('select[name="targetAppId"]');

    async function fetchAllApps() {
        try {
            // REST API を使ってアプリ情報を取得
            const response = await kintone.api('/k/v1/apps', 'GET', {});

            // アプリ情報を取得
            const apps = response.apps;

            // 選択肢にアプリを追加
            apps.forEach((app) => {
                const option = document.createElement('option');
                option.value = app.appId; // アプリIDを値として設定
                option.textContent = app.name; // アプリ名を選択肢として表示
                if (option.value === targetAppId) {
                    option.selected = true; // 初期値を設定
                }
                targetAppSelect.appendChild(option);
            });
        } catch (error) {
            console.error('Error fetching apps:', error);
            alert('アプリ情報の取得に失敗しました');
        }
    }

    // アプリのリストを取得
    fetchAllApps();
    //ここまでtargetAppId の設定

    // APIトークンに初期値を設定
    const apiTokenInput = document.getElementById('apiTokenSetting');
    apiTokenInput.value = apiToken;

    // tableNameの設定
    const tableNameSelect = document.querySelector('select[name="tableName"]');
    try {
        fields = await KintoneConfigHelper.getFields(['SUBTABLE']);
        fields.forEach((field) => {
            const option = document.createElement('option');
            option.value = field.code;
            option.textContent = field.code;
            // 初期値を設定
            if (option.value === tableFieldCode) {
                option.selected = true;
            }

            tableNameSelect.appendChild(option);
        });
    } catch (error) {
        console.error('Error fetching fields:', error);
        alert('対象フィールドの取得に失敗しました');
    }

    //ここまでtableNameの設定



    document.getElementById('fetch-fields-button').addEventListener('click', async function () {
        try {

            // 画面で選択された値を取得
            const tableFieldCode = document.getElementById('tableName').value;
            const targetAppId = document.getElementById('targetAppId').value;
            const apiToken = document.getElementById('apiTokenSetting').value;

            if (!tableFieldCode || !targetAppId || !apiToken) {
                alert('全ての項目を選択または入力してください');
                return;
            }

            const appId = kintone.app.getId();
            const baseUrl = location.origin;
            const targetUrl = `${baseUrl}/k/v1/app/form/fields.json?app=${targetAppId}`;

            const sourceResponse = await kintone.api(
                kintone.api.url('/k/v1/app/form/fields', true),
                'GET',
                { app: appId }
            );

            const sourceNormalFields = [];
            const sourceTableFields = [];


            Object.values(sourceResponse.properties).forEach(field => {
                if (field.type === 'SUBTABLE' && field.code === tableFieldCode) {
                    Object.values(field.fields).forEach(subField => {
                        sourceTableFields.push(subField.code);
                    });
                } else {
                    sourceNormalFields.push(field.code);
                }
            });


            const targetResponse = await fetch(targetUrl, {
                method: 'GET',
                headers: {
                    'X-Cybozu-API-Token': apiToken,
                    'X-Requested-With': 'XMLHttpRequest',
                },
            }).then(res => res.json());

            const targetFields = Object.keys(targetResponse.properties);

            const excludeFields = [
                'レコード番号',
                '作業者',
                '更新者',
                '作成者',
                'ステータス',
                '更新日時',
                'カテゴリー',
                '作成日時',
            ];

            //フィールドコードとtypeが一致する項目を取得
            const matchingNormalFields = sourceNormalFields.filter(code => {
                const sourceField = sourceResponse.properties[code];
                const targetField = targetResponse.properties[code];
                return (
                    targetFields.includes(code) &&
                    !excludeFields.includes(code) &&
                    sourceField &&
                    targetField &&
                    sourceField.type === targetField.type // フィールドの種類が一致しているかを確認
                );
            });


            const matchingTableFields = sourceTableFields.filter(code => {
                // サブテーブルのフィールドを参照
                const tableField = sourceResponse.properties[tableFieldCode];
                let sourceField = null;
                if (tableField && tableField.type === 'SUBTABLE') {
                    // サブテーブル内の fields から code を探す
                    sourceField = tableField.fields[code];
                }
                const targetField = targetResponse.properties[code];
                return (
                    targetFields.includes(code) &&
                    sourceField &&
                    targetField &&
                    sourceField.type === targetField.type // フィールドの種類が一致しているかを確認
                );
            });



            // rowIdentifierField の選択肢設定
            const rowIdentifierFieldSelect = document.querySelector('select[name="rowIdentifierField"]');

            // SingleText フィールドを取得
            const singleTextFields = await KintoneConfigHelper.getFields(['SINGLE_LINE_TEXT']);

            // matchingTableFields に含まれる SingleText フィールドを絞り込む
            const filteredFields = singleTextFields.filter(field =>
                matchingTableFields.includes(field.code)
            );

            // 絞り込んだ項目を選択肢に追加
            filteredFields.forEach(field => {
                const option = document.createElement('option');
                option.value = field.code; // フィールドコードを値に設定
                option.textContent = field.label || field.code; // ラベルを表示（ラベルがなければコード）
                // 初期値を設定
                if (option.value === rowIdentifierField) {
                    option.selected = true;
                }
                rowIdentifierFieldSelect.appendChild(option); // セレクトボックスに追加
            });

            // 初期値が設定されていない場合、最初の項目を選択
            if (!rowIdentifierFieldSelect.value && filteredFields.length > 0) {
                rowIdentifierFieldSelect.value = filteredFields[0].code;
            } else if (filteredFields.length === 0) {
                alert('更新キーに設定可能な項目が見つかりません');
            }
            //ここまで行識別子

            //レコードNO、行NOの選択肢を用意
            const sourceRecordNumberSelect = document.querySelector('select[name="sourceRecordNumber"]');
            const tableRowNumberSelect = document.querySelector('select[name="tableRowNumber"]');

            // targetFields を SingleText フィールドに絞り込む

            const TablesingleTextFields = Object.values(targetResponse.properties).filter(
                field => field.type === 'SINGLE_LINE_TEXT' || field.type === 'NUMBER'
            );
            TablesingleTextFields.forEach(field => {
                const option = document.createElement('option');
                option.value = field.code;
                option.textContent = field.label || field.code; // ラベルを優先表示
                sourceRecordNumberSelect.appendChild(option);
            });
            TablesingleTextFields.forEach(field => {
                const option = document.createElement('option');
                option.value = field.code;
                option.textContent = field.label || field.code; // ラベルを優先表示
                tableRowNumberSelect.appendChild(option);
            });

            // 初期値を設定（select.value を直接設定）
            if (TablesingleTextFields.length > 0) {
                sourceRecordNumberSelect.value = sourceRecordNumber || TablesingleTextFields[0].code;
                tableRowNumberSelect.value = tableRowNumber || TablesingleTextFields[0].code;
            } else {
                alert('レコードNOおよび行NOに設定可能な項目が見つかりません');
            }

            //ここまでレコードNO行NO


            for (let i = 0; i < 20; i++) {
                window[`VARIABLE_${i + 1}`] = matchingNormalFields[i] || null;
                window[`ROW_VARIABLE_${i + 1}`] = matchingTableFields[i] || null;
            }

            // 表示を更新
            const normalFieldsList = document.getElementById('normal-fields');
            const tableFieldsList = document.getElementById('table-fields');

            // リストをクリア
            normalFieldsList.innerHTML = '';
            tableFieldsList.innerHTML = '';

            // 通常フィールドをリストに追加
            matchingNormalFields.forEach(field => {
                const li = document.createElement('li');
                li.textContent = field;
                normalFieldsList.appendChild(li);
            });

            // テーブル内フィールドをリストに追加
            matchingTableFields.forEach(field => {
                const li = document.createElement('li');
                li.textContent = field;
                tableFieldsList.appendChild(li);
            });

            alert('項目取得が完了しました');

        } catch (error) {
            console.error('エラー:', error);
            alert('更新先アプリの項目取得中にエラーが発生しました。更新先アプリにて、APIトークン登録後、「アプリを更新」されているか確認してください。');
        }
    });


    //保存処理
    document.getElementById('save-button').addEventListener('click', async function () {
        try {
            // 各項目の値を取得
            const targetAppId = document.getElementById('targetAppId').value;
            const apiToken = document.getElementById('apiTokenSetting').value;
            const tableFieldCode = document.getElementById('tableName').value;
            const rowIdentifierField = document.getElementById('rowIdentifierField').value;
            const sourceRecordNumber = document.getElementById('sourceRecordNumber').value;
            const tableRowNumber = document.getElementById('tableRowNumber').value;
            const hideKeyField = document.getElementById('hideKeyField').checked;

            // 必須項目が未入力の場合にエラーを表示
            if (!targetAppId || !apiToken || !tableFieldCode || !rowIdentifierField) {
                alert('全ての必須項目を入力してください');
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

            // 保存データの作成
            const config = {
                targetAppId: targetAppId,
                apiToken: apiToken,
                tableFieldCode: tableFieldCode,
                rowIdentifierField: rowIdentifierField,
                sourceRecordNumber: sourceRecordNumber,
                tableRowNumber: tableRowNumber,
                hideKeyField: hideKeyField.toString(), // チェックボックスの値を保存
                authStatus: 'valid' // 認証結果を保存
            };
            // Trial_enddateが存在する場合に追加
            if (data.response.Trial_enddate) {
                config.Trial_enddate = data.response.Trial_enddate; // 返却されたTrial_enddateを保存
            }
            // VARIABLE_1~xとROW_VARIABLE_1~xを追加
            for (let i = 1; i <= 20; i++) {
                if (window[`VARIABLE_${i}`]) {
                    config[`VARIABLE_${i}`] = window[`VARIABLE_${i}`];
                }
                if (window[`ROW_VARIABLE_${i}`]) {
                    config[`ROW_VARIABLE_${i}`] = window[`ROW_VARIABLE_${i}`];
                }
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

})(kintone.$PLUGIN_ID);
