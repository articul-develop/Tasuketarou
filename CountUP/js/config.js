/* eslint @typescript-eslint/no-unused-vars: 0 */
(async (PLUGIN_ID) => {
  'use strict';

  // -----------------------------
  // 1. 既存設定の読み込み
  // -----------------------------
  const config = kintone.plugin.app.getConfig(PLUGIN_ID);
  const revField   = config.revField || '';
  const disableEdit = config.disableEdit === 'true';        // ★追加

  // -----------------------------
  // 2. DOM 取得
  // -----------------------------
  const revFieldSelect = document.getElementById('rev-field-select');
  const disableChk     = document.getElementById('disable-edit-checkbox'); // ★追加
  const saveBtn        = document.getElementById('save-button');
  const cancelBtn      = document.getElementById('cancel-button');

  // チェックボックス初期状態
  if (disableChk) disableChk.checked = disableEdit;          // ★追加

  // -----------------------------
  // 3. フィールド一覧を取得して <select> に反映
  // -----------------------------
let fields = [];

try {
  // 通常のフィールド取得
  fields = await KintoneConfigHelper.getFields(['SINGLE_LINE_TEXT', 'NUMBER']);

  // フォーム情報を取得
  const formFields = await kintone.api(kintone.api.url('/k/v1/app/form/fields', true), 'GET', {
    app: kintone.app.getId()
  });

  // サブテーブル内のフィールドコードを収集
  const subtableFieldCodes = new Set();
  Object.values(formFields.properties).forEach(field => {
    if (field.type === 'SUBTABLE') {
      Object.values(field.fields).forEach(subField => {
        subtableFieldCodes.add(subField.code);
      });
    }
  });

  // サブテーブル内のフィールドを除外
  fields = fields.filter(field => !subtableFieldCodes.has(field.code));

  // 以降、セレクトに詰める処理はそのまま
  fields.forEach((field) => {
    const opt = document.createElement('option');
    opt.value = field.code;
    opt.textContent = `${field.label} (${field.code})`;
    if (field.code === revField) opt.selected = true;
    revFieldSelect.appendChild(opt);
  });
} catch (err) {
  console.error('Error fetching fields:', err);
  alert('対象フィールドの取得に失敗しました。');
}


  // -----------------------------
  // 4. 保存ボタン
  // -----------------------------
  saveBtn.addEventListener('click', async () => {
    const selectedField = revFieldSelect.value;

    // 必須チェック
    if (!selectedField) {
      alert('REV_FIELD を選択してください。');
      return;
    }

    try {
      // -------▼ ここから API 認証部分（添付コードと同じ） ▼-------
      const data = await AuthModule.authenticateDomain(API_CONFIG);

      if (data.status !== 'success' ||
          !data.response ||
          data.response.status !== 'valid') {
        const message = data.response?.message || '不明なエラー';
        kintone.plugin.app.setConfig({ authStatus: 'invalid' }, () => {
          alert(`認証失敗: ${message}`);
        });
        return;
      }
      // -------▲ API 認証部分ここまで（変更なし） ▲-------

      // 認証成功 → 設定を保存
      const newConfig = {
        revField: selectedField,
        disableEdit: (disableChk ? disableChk.checked : false).toString(), // ★追加
        authStatus: 'valid'
      };
      if (data.response.Trial_enddate) {
        newConfig.Trial_enddate = data.response.Trial_enddate;
      }

      kintone.plugin.app.setConfig(newConfig, () => {
        alert('設定を保存しました。');
        // プラグイン一覧へ戻る
        window.location.href = `/k/admin/app/${kintone.app.getId()}/plugin/`;
      });
    } catch (err) {
      console.error('認証API呼び出しエラー:', err);
      alert('認証中にエラーが発生しました。');
    }
  });

  // -----------------------------
  // 5. キャンセルボタン
  // -----------------------------
  cancelBtn.addEventListener('click', () => {
    window.location.href = `/k/admin/app/${kintone.app.getId()}/plugin/`;
  });
})(kintone.$PLUGIN_ID);
