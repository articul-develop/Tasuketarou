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
  fields = await KintoneConfigHelper.getFields(['SINGLE_LINE_TEXT', 'NUMBER']);

  // ---- ここから追加：レイアウトAPIでサブテーブル内フィールドを特定して除外 ----
  const app = kintone.app.getId();
  const layout = await kintone.api(
    kintone.api.url('/k/v1/app/form/layout', true),
    'GET',
    { app }
  );

  // レイアウトを走査してサブテーブル内のフィールドコードを集める
  const subtableFieldCodes = new Set();

  const walk = (blocks) => {
    for (const b of (blocks || [])) {
      if (!b) continue;
      if (b.type === 'ROW') {
        for (const f of (b.fields || [])) {
          if (f && f.type === 'SUBTABLE') {
            for (const sf of (f.fields || [])) {
              if (sf && sf.code) subtableFieldCodes.add(sf.code);
            }
          }
        }
      } else if (b.type === 'GROUP') {
        // グループ内も再帰
        walk(b.layout || []);
      }
    }
  };
  walk(layout.layout || []);

  // KintoneConfigHelper が flatten 済みでも、コード一致で除外できる
  fields = fields.filter(field => !subtableFieldCodes.has(field.code));


  revFieldSelect.innerHTML = ''; // 念のためクリア
  fields.forEach((field) => {
    const opt = document.createElement('option');
    opt.value = field.code;
    opt.textContent = `${field.label} (${field.code})`;
    if (field.code === revField) opt.selected = true; // 既存設定があれば初期選択
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
