(function (PLUGIN_ID) {
    'use strict';

    const PLUGIN_NAME = 'ファイル一括削除プラグイン';
    const config = kintone.plugin.app.getConfig(PLUGIN_ID) || {};

    kintone.events.on('app.record.index.show', function (event) {
        AuthModule.appendTrialBanner(kintone.app.getHeaderMenuSpaceElement(), PLUGIN_NAME, {
            pluginId: PLUGIN_ID,
            config: config
        });
        return event;
    });

    let isAuthenticated = false;

    async function initializeAuthentication() {
        const authResult = await AuthModule.checkAndReauthenticate({
            pluginId: PLUGIN_ID,
            pluginName: PLUGIN_NAME,
            config: config,
            apiConfig: API_CONFIG
        });
        if (authResult !== undefined) {
            isAuthenticated = Boolean(authResult.success);
        }
        return isAuthenticated;
    }

    window.isAuthenticated = function () {
        return isAuthenticated;
    };

    const authReady = initializeAuthentication();
    window.whenAuthenticated = function () {
        return authReady.then(function () {
            return isAuthenticated;
        });
    };

    //ここまで共通処理


    // ボタンを追加する処理
    kintone.events.on('app.record.index.show', function (event) {
        // 設定から選択された一覧を取得


        if (!config.dropdownList || config.dropdownList !== event.viewName) {
            return;
        }

        // ボタンがすでに存在する場合は何もしない
        if (document.getElementById('bulk-delete-button') !== null) {
            console.log('既にボタンが存在します。処理を終了します。');
            return;
        }

        const headerSpace = kintone.app.getHeaderMenuSpaceElement();

        // ボタン要素を作成
        const button = document.createElement('button');
        button.id = 'bulk-delete-button';
        button.textContent = '添付ファイル一括削除';

        // スタイルを直接設定
        button.style.backgroundColor = '#3498db'; // ボタンの背景色
        button.style.color = '#fff'; // ボタンの文字色
        button.style.border = 'none'; // ボーダーをなくす
        button.style.borderRadius = '5px'; // ボタンの角を丸くする
        button.style.padding = '8px 16px'; // ボタンの余白
        button.style.fontSize = '14px'; // フォントサイズ
        button.style.cursor = 'pointer'; // ポインターを表示
        button.style.marginRight = '20px'; // 隣の要素との間隔

        //エラー時処理
        (async () => {
            const ok = await window.whenAuthenticated();

            if (!ok) {
                // ボタンを無効化
                const button = document.getElementById('bulk-delete-button');
                if (button) {
                    button.disabled = true;
                    button.style.backgroundColor = '#ccc';
                    button.style.cursor = 'not-allowed';
                }
            }
        })();

        // 全レコードを取得する非同期関数
        async function fetchAllRecords(appId) {
            const limit = 100; // 一度に取得する件数
            let offset = 0;
            let allRecords = [];
            let response;

            // 取得できたレコードがlimit件の場合、まだデータが残っている可能性があるため、繰り返し取得する
            do {
                response = await kintone.api(kintone.api.url('/k/v1/records', true), 'GET', {
                    app: appId,
                    query: `limit ${limit} offset ${offset}`
                });
                allRecords = allRecords.concat(response.records);
                offset += limit;
            } while (response.records.length === limit);

            return allRecords;
        }

        // --- fetchFilteredRecords 20250514>>
        async function fetchFilteredRecords(appId, query) {
            const limit = 100;
            let offset = 0;
            const all = [];
            //console.log('fetchFilteredRecords: appId:', appId, 'query:', query);
            while (true) {
                const resp = await kintone.api(
                    kintone.api.url('/k/v1/records', true),
                    'GET',
                    { app: appId, query: `${query} limit ${limit} offset ${offset}` }
                );
                all.push(...resp.records);
                if (resp.records.length < limit) break;
                offset += limit;
            }
            return all;
        }
        // --- <<fetchFilteredRecords 20250514


        // ボタンクリック時の処理
        button.onclick = async function () {


            try {
                const appId = kintone.app.getId();
                // 絞り込みした全件取得
                //20250514 edit>>
                //const records = await fetchAllRecords(appId);

                // ── 修正後：画面上・ビューの絞り込み条件を取得し、limit/offset を除去してからフェッチ
                const rawQuery = kintone.app.getQuery();
                const cleanedQuery = rawQuery.replace(/\s*limit\s+\d+\s+offset\s+\d+$/i, '').trim();
                const records = await fetchFilteredRecords(appId, cleanedQuery);
                //<<20250514 edit

                const recordCount = records.length;

                if (!confirm(`全件のレコード（${recordCount}件）の添付ファイルを削除します。よろしいですか？`)) {
                    return;
                }

                if (records.length === 0) {
                    alert('削除対象のレコードがありません。');
                    return;
                }

                //const appId = kintone.app.getId();
                const dropdownContainerFields = JSON.parse(config.dropdownContainer || '[]');

                if (dropdownContainerFields.length === 0) {
                    alert('削除対象のフィールドが設定されていません。プラグイン設定を確認してください。');
                    return;
                }

                const updates = records.map(record => {
                    const updateFields = {};

                    // 設定されたフィールドを空配列に置き換える
                    dropdownContainerFields.forEach(fieldCode => {
                        updateFields[fieldCode] = { value: [] };
                    });

                    return {
                        id: record.$id.value,
                        record: updateFields
                    };
                });

                // 一括更新APIを利用して添付ファイルを削除
                const BATCH_SIZE = 100; // 一度に処理できる最大レコード数
                let batchIndex = 0;

                while (batchIndex < updates.length) {
                    const chunk = updates.slice(batchIndex, batchIndex + BATCH_SIZE);
                    await kintone.api(kintone.api.url('/k/v1/records', true), 'PUT', {
                        app: appId,
                        records: chunk
                    });
                    batchIndex += BATCH_SIZE;
                }

                alert('添付ファイルを削除しました。ページをリロードしてください。');
            } catch (error) {
                console.error(error);
                const errorMessage = error?.message || 'エラー内容が取得できませんでした。';
                alert(`添付ファイルの削除中にエラーが発生しました。\n${errorMessage}`);
                await AuthModule.sendErrorLog(API_CONFIG, 'bulk-delete-button', errorMessage);
            }
        };

        // ボタンをヘッダーに追加
        headerSpace.appendChild(button);
    });
})(kintone.$PLUGIN_ID);
