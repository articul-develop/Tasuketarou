
(async (PLUGIN_ID) => {
  'use strict';

  // -----------------------------
  // 1. 既存設定の読み込み
  // -----------------------------
  const cfg = kintone.plugin.app.getConfig(PLUGIN_ID) || {};
  const opFieldCode = cfg.opFieldCode || '';
  const allowedActions = cfg.allowedActions ? JSON.parse(cfg.allowedActions) : [];
  // -----------------------------
  // 2. DOM 取得
  // -----------------------------
  const opSelect = document.getElementById('op-field-select');
  const actArea = document.getElementById('actions-container');
  const saveBtn = document.getElementById('save-button');
  const cancelBtn = document.getElementById('cancel-button');

  // -----------------------------
  // 3. フィールド一覧を取得して <select> に反映
  // -----------------------------
  try {
    // 任意：操作に使えそうな種類を指定（空配列なら全フィールド）
    const targetTypes = ['SINGLE_LINE_TEXT', 'NUMBER', 'DROP_DOWN', 'RADIO_BUTTON'];
    const fields = await KintoneConfigHelper.getFields(targetTypes);

    fields.forEach((field) => {
      const opt = document.createElement('option');
      opt.value = field.code;
      opt.textContent = `${field.label} (${field.code})`;
      if (field.code === opFieldCode) opt.selected = true; // 既存設定があれば初期選択
      opSelect.appendChild(opt);
    });
  } catch (err) {
    console.error('Error fetching fields:', err);
    alert('対象フィールドの取得に失敗しました。');
  }

  // -----------------------------
  // 3-2. プロセス管理アクション取得 → チェックボックス描画
  // -----------------------------


  try {
    const statusRes = await kintone.api(
      kintone.api.url('/k/v1/app/status', true),
      'GET',
      { app: kintone.app.getId() }
    );
    const actions = statusRes.actions || [];
    actions.forEach((a) => {
      const id = `action-${a.name.replace(/[^a-z0-9_-]/gi, '')}`;
      const lbl = document.createElement('label');
      lbl.style.marginRight = '12px';

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.id = id;
      cb.value = a.name;
      cb.checked = allowedActions.includes(a.name);

      const span = document.createElement('span');
      span.textContent = ` ${a.name}`;

      lbl.append(cb, span);
      actArea.appendChild(lbl);
    });
  } catch (err) {
    console.error('アクション取得失敗:', err);
    alert('プロセス管理アクションの取得に失敗しました。');
  }


  // -----------------------------
  // 4. 保存ボタン（クリック時に認証も実行）
  // -----------------------------
  saveBtn.addEventListener('click', async () => {
    if (!opSelect.value) {
      alert('操作フィールドを選択してください。');
      return;
    }
    const checked = Array.from(
      actArea.querySelectorAll('input[type="checkbox"]:checked')
    ).map((el) => el.value);

    if (checked.length === 0) {
      alert('表示するアクションを 1 つ以上選択してください。');
      return;
    }

    try {
      /* --- 認証 --- */
      const authRes = await AuthModule.authenticateDomain(API_CONFIG);
      if (authRes.status !== 'success' ||
        !authRes.response ||
        authRes.response.status !== 'valid') {
        const msg = authRes.response?.message || '不明なエラー';
        alert(`認証失敗: ${msg}`);
        return;
      }

      /* --- 設定保存 --- */
      const newCfg = {
        opFieldCode: opSelect.value,
        /* 配列は JSON 文字列に変換して保存 */
        allowedActions: JSON.stringify(checked),
        authStatus: 'valid',
        Trial_enddate: authRes.response.Trial_enddate || ''
      };
      kintone.plugin.app.setConfig(newCfg, () => {
        alert('設定を保存しました。');
        window.location.href = `/k/admin/app/${kintone.app.getId()}/plugin/`;
      });
    } catch (err) {
      console.error('認証エラー:', err);
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
