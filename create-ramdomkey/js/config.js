(async (PLUGIN_ID) => {
  'use strict';

  let fields = []; // グローバルに fields を定義

  const config = kintone.plugin.app.getConfig(PLUGIN_ID);
  const digitLength = config.digitLength || '';
  const charType = config.charType || '';
  const targetField = config.targetField || '';
  const noRefreshNumbering = config.noRefreshNumbering || 'false'; // 保存済みのチェックボックス値（初期値は"false"）

  // digitLength の設定
  const digitLengthSelect = document.querySelector('select[name="digitLength"]');
  for (let i = 1; i <= 20; i++) {
    const option = document.createElement('option');
    option.value = i;
    option.textContent = i;
    if (i.toString() === digitLength) {
      option.selected = true; // 初期値を設定
    }
    digitLengthSelect.appendChild(option);
  }

  // charType の設定
  const charTypeSelect = document.querySelector('select[name="charType"]');
  const charTypeOptions = [
    { value: 'numeric', text: '数字のみ' },
    { value: 'numeric_lowercase', text: '数字+アルファベット小文字' },
    { value: 'numeric_mixedcase', text: '数字+アルファベット大文字小文字' },
    { value: 'numeric_mixedcase_symbol', text: '数字+アルファベット大文字小文字記号' }
  ];
  charTypeOptions.forEach((option) => {
    const optionElement = document.createElement('option');
    optionElement.value = option.value;
    optionElement.textContent = option.text;
    if (option.value === charType) {
      optionElement.selected = true; // 初期値を設定
    }
    charTypeSelect.appendChild(optionElement);
  });

  // targetField の設定
  const targetFieldSelect = document.querySelector('select[name="targetField"]');
  try {
    fields = await KintoneConfigHelper.getFields(['SINGLE_LINE_TEXT', 'NUMBER']); // グローバル変数に代入
    fields.forEach((field) => {
      const option = document.createElement('option');
      option.value = field.code;
      option.textContent = field.label;
      if (field.code === targetField) {
        option.selected = true; // 初期値を設定
      }
      targetFieldSelect.appendChild(option);
    });
  } catch (error) {
    console.error('Error fetching fields:', error);
    alert('対象フィールドの取得に失敗しました');
  }

  // 再利用時のチェックボックス
  const noRefreshNumberingCheckbox = document.getElementById('noRefreshNumbering');
  if (noRefreshNumberingCheckbox) {
    noRefreshNumberingCheckbox.checked = noRefreshNumbering === 'true';
  }
  
  // 保存ボタンの動作
  const saveButton = document.getElementById('save-button');
  saveButton.addEventListener('click', async () => {
    const digitLengthValue = digitLengthSelect.value;
    const charTypeValue = charTypeSelect.value;
    const targetFieldValue = targetFieldSelect.value;
    const noRefreshNumberingValue = document.getElementById('noRefreshNumbering').checked;

    // 必須チェック
    if (!digitLengthValue || !charTypeValue || !targetFieldValue) {
      alert('すべての項目を選択してください。');
      return;
    }

    // 画面の値で対象フィールドを探す
    const selectedField = fields.find(field => field.code === targetFieldValue);

    // 条件チェック: charTypeが「数字のみ」以外かつtargetFieldがNUMBER型の場合エラー
    if (selectedField && selectedField.type === 'NUMBER' && charTypeValue !== 'numeric') {
      alert('数値型のフィールドには、アルファベットや記号を含んだ文字列を設定できません。');
      return;
    }




    try {
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

      // 認証成功後の処理: 設定の保存
      const config = {
        digitLength: digitLengthValue,
        charType: charTypeValue,
        targetField: targetFieldValue,
        noRefreshNumbering: noRefreshNumberingValue.toString(),
        authStatus: 'valid' // 認証結果を保存
      };

      // Trial_enddateが存在する場合に追加
      if (data.response.Trial_enddate) {
        config.Trial_enddate = data.response.Trial_enddate; // 返却されたTrial_enddateを保存
      }

      kintone.plugin.app.setConfig(config, () => {
        alert('設定を保存しました。');
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
