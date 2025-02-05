(function (PLUGIN_ID) {
    'use strict';


    // 今日の日付をyyyymmdd形式に変換
    const today = new Date();
    const todayStr = today.getFullYear().toString() +
        (today.getMonth() + 1).toString().padStart(2, '0') +
        today.getDate().toString().padStart(2, '0');

    // LocalStorageから認証日を取得
    const storageKey = `PLUGIN_${kintone.$PLUGIN_ID}_config`;
    const storageconfig = JSON.parse(localStorage.getItem(storageKey)) || {};
    const lastAuthDate = storageconfig.lastAuthDate || ''; // 最終認証日
    //const lastAuthDate = '20250127'

    // プラグインの設定情報を取得
    const config = kintone.plugin.app.getConfig(PLUGIN_ID) || {};
    const trialEndDateStr = config.Trial_enddate || ''; // お試し期限日
    const authStatus = config.authStatus || ''; // 認証ステータス
    /*
        // プラグインの設定情報を取得する
        const config = kintone.plugin.app.getConfig(PLUGIN_ID) || {};
    
        // 設定情報がなければ処理を終了する
        if (Object.keys(config).length === 0) {
            return;
        }
        // エラーメッセージを格納する変数
        let errorMessages = [];
    
        // 今日の日付をyyyymmdd形式に変換
        const today = new Date();
        const todayStr = today.getFullYear().toString() +
            (today.getMonth() + 1).toString().padStart(2, '0') +
            today.getDate().toString().padStart(2, '0');
    
    
        // 認証ステータスを確認
        const authStatus = config.authStatus || '';
        if (authStatus !== 'valid') {
            errorMessages.push('認証ステータスが無効です。');
        }
    
    
        // Trial_enddateの確認
        if (config.Trial_enddate) {
            const trialEndDateStr = config.Trial_enddate; // yyyymmdd形式の文字列
    
            // Trial_enddateが今日以前の場合（期限切れ）
            if (trialEndDateStr < todayStr) {
                errorMessages.push('お試し期間が終了しています。');
            }
        }
    
    
        //最終認証日を取得
        const storageKey = `PLUGIN_${kintone.$PLUGIN_ID}_config`;
        const storageconfig = JSON.parse(localStorage.getItem(storageKey)) || {};
        const AuthDate = storageconfig.lastAuthDate || '';
        //const AuthDate = '20250101' //TEST用
    
        async function checkAndReauthenticate() {
    
            if (!AuthDate || AuthDate < todayStr) {
                try {
                    const data = await AuthModule.authenticateDomain(API_CONFIG);
                    if (data.status !== 'success' || !data.response || data.response.status !== 'valid') {
                        const message = data.response?.message || '不明なエラー';
                        console.error(`認証失敗: ${message}`);
                        errorMessages.push(`認証エラー: ${message}`);
                    }
                    localStorage.setItem(storageKey, JSON.stringify({ lastAuthDate: todayStr }));
                    //console.log('認証成功: 日付を更新しました');
                } catch (error) {
                    console.error('API認証中にエラーが発生しました:', error);
                    errorMessages.push('認証中にエラーが発生しました。');
                }
            } else {
                console.log('最終認証日は有効です。再認証は不要です。');
            }
        }
    */



    //お試し期限の表示
    kintone.events.on('app.record.index.show', function (event) {
        // Trial_enddateがブランクではなく、期限内の場合にのみメッセージを表示
        if (config.Trial_enddate) {
            const trialEndDateStr = config.Trial_enddate;

            if (trialEndDateStr > todayStr) {
                // ヘッダー部分を取得
                const headerSpace = kintone.app.getHeaderMenuSpaceElement();

                // カスタムの文字を追加
                if (headerSpace && !headerSpace.querySelector('.custom-header-text')) {
                    const customText = document.createElement('div');
                    customText.className = 'custom-header-text';
                    customText.textContent = `データ一括削除プラグイン　お試し期間中（～${trialEndDateStr.slice(0, 4)}/${trialEndDateStr.slice(4, 6)}/${trialEndDateStr.slice(6, 8)}）`; // 左に全角スペースを追加
                    customText.style.marginLeft = '10px'; // 左に余白を追加
                    customText.style.fontSize = '16px';
                    customText.style.color = 'blue'; // 文字色を青に設定
                    headerSpace.appendChild(customText);
                }
            }
        }
        return event;
    });



    // 認証チェック関数
    async function checkAndReauthenticate() {
        const errorMessages = [];

        // 設定情報がない場合
        if (Object.keys(config).length === 0) {
            errorMessages.push('プラグイン設定が取得できませんでした。');
            return { success: false, errors: errorMessages };
        }

        // 認証ステータスが無効
        if (authStatus !== 'valid') {
            errorMessages.push('プラグイン認証ステータスが無効です。');
            return { success: false, errors: errorMessages };
        }

        // お試し期間が終了している
        if (trialEndDateStr && trialEndDateStr < todayStr) {
            errorMessages.push('プラグインお試し期間が終了しています。');
            return { success: false, errors: errorMessages };
        }

        // AuthDateが今日以降かどうかを確認
        if (lastAuthDate && lastAuthDate >= todayStr) {
            console.log('認証済みです。');
            return { success: true }; // 認証済み
        }

        // ここまで来た場合は認証が必要
        console.log('認証処理を開始します...');
        try {
            const response = await AuthModule.authenticateDomain(API_CONFIG);
            if (response.status === 'success' && response.response?.status === 'valid') {
                // 認証成功 → 認証日を更新
                localStorage.setItem(storageKey, JSON.stringify({ lastAuthDate: todayStr }));
                console.log('認証成功');
                return { success: true };
            } else {
                errorMessages.push('認証エラー: ' + (response.response?.message || '不明なエラー'));
            }
        } catch (error) {
            errorMessages.push('認証中にエラーが発生しました。');
        }

        alert(errorMessages.join('\n')); // メッセージを改行で結合
        return { success: false, errors: errorMessages }; // 認証失敗
    }

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
            await checkAndReauthenticate();
            if (errorMessages.length > 0) {

                // ボタンを無効化
                const button = document.getElementById('bulk-delete-button');
                if (button) {
                    button.disabled = true;
                    button.style.backgroundColor = '#ccc';
                    button.style.cursor = 'not-allowed';
                }
            }
        })();



        // ボタンクリック時の処理
        button.onclick = async function () {
            if (!confirm('一覧画面に表示されているレコードの添付ファイルを削除します。よろしいですか？')) {
                return;
            }

            try {
                const records = event.records;
                if (records.length === 0) {
                    alert('削除対象のレコードがありません。');
                    return;
                }

                const appId = kintone.app.getId();
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
                alert('添付ファイルの削除中にエラーが発生しました。');
            }
        };

        // ボタンをヘッダーに追加
        headerSpace.appendChild(button);
    });
})(kintone.$PLUGIN_ID);
