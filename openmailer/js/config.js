/* eslint @typescript-eslint/no-unused-vars: 0 */
(async (PLUGIN_ID) => {
  'use strict';

  const EMAIL_FIELD_TYPES = ['LINK'];
  const MANAGEABLE_FIELD_TYPES = [
    'SINGLE_LINE_TEXT', 'MULTI_LINE_TEXT', 'RICH_TEXT', 'NUMBER',
    'RADIO_BUTTON', 'CHECK_BOX', 'MULTI_SELECT', 'DROP_DOWN',
    'DATE', 'TIME', 'DATETIME', 'LINK'
  ];
  const DEFAULT_BUTTON_LABEL = 'メール作成';

  const config = kintone.plugin.app.getConfig(PLUGIN_ID) || {};
  const authState = {
    checked: false,
    isValid: false,
    trialEndDate: config.Trial_enddate || ''
  };
  const state = {
    fields: [],
    spacers: [],
    settings: []
  };

  let activeTemplateTarget = null;

  const settingsListEl = document.getElementById('settings-list');
  const settingsEmptyEl = document.getElementById('settings-empty');
  const addSettingBtn = document.getElementById('add-setting-button');
  const authStatusEl = document.getElementById('auth-status');
  const saveBtn = document.getElementById('save-button');
  const cancelBtn = document.getElementById('cancel-button');

  // ---------- 汎用 ----------
  function buildReloadPromptMessage(message) {
    return `${message}\n設定内容を確認後、画面をリロードして再試行してください。`;
  }

  function updateSaveButtonState(isBlocked, title = '') {
    saveBtn.disabled = isBlocked;
    saveBtn.setAttribute('aria-disabled', isBlocked ? 'true' : 'false');
    if (title) {
      saveBtn.title = title;
      return;
    }
    saveBtn.removeAttribute('title');
  }

  function setAuthStatus(message, isError) {
    authStatusEl.textContent = message;
    authStatusEl.classList.toggle('is-error', Boolean(isError));
  }

  function generateId() {
    return `set_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function unique(values) {
    return values.filter((value, index) => values.indexOf(value) === index);
  }

  // ---------- フィールド取得 ----------
  function fieldLabel(field) {
    return field.label ? `${field.label} (${field.code})` : field.code;
  }

  function getNormalEmailFields() {
    return state.fields.filter((field) => {
      return field.code && !field.subtableCode && EMAIL_FIELD_TYPES.indexOf(field.type) !== -1;
    });
  }

  function getSubtables() {
    return state.fields.filter((field) => field.type === 'SUBTABLE' && field.code);
  }

  function getSpacerOptionsHtml(selectedValue) {
    const options = state.spacers.map((elementId) => ({ value: elementId, label: elementId }));
    if (selectedValue && !state.spacers.includes(selectedValue)) {
      options.push({ value: selectedValue, label: `${selectedValue}（現在の設定値）` });
    }
    return optionsHtml(options, selectedValue);
  }

  function getTableEmailFields(tableCode) {
    if (!tableCode) {
      return [];
    }
    return state.fields.filter((field) => {
      return field.subtableCode === tableCode && EMAIL_FIELD_TYPES.indexOf(field.type) !== -1;
    });
  }

  function getTopLevelFields() {
    return state.fields.filter((field) => field.code && field.type !== 'SUBTABLE' && !field.subtableCode);
  }

  function getInsertableFieldsForSetting(setting) {
    const fields = getTopLevelFields();
    if (setting.displayType === 'field' && setting.addressFieldType === 'table' && setting.tableFieldCode) {
      return fields.concat(state.fields.filter((field) => field.code && field.subtableCode === setting.tableFieldCode));
    }
    return fields;
  }

  function getManageFieldsForSetting(setting) {
    const topLevel = getTopLevelFields().filter((field) => MANAGEABLE_FIELD_TYPES.indexOf(field.type) !== -1);
    if (setting.displayType === 'field' && setting.addressFieldType === 'table' && setting.tableFieldCode) {
      const tableFields = state.fields.filter((field) => {
        return field.code && field.subtableCode === setting.tableFieldCode && MANAGEABLE_FIELD_TYPES.indexOf(field.type) !== -1;
      });
      return topLevel.concat(tableFields);
    }
    return topLevel;
  }

  // ---------- 設定オブジェクト ----------
  function createDefaultSetting() {
    return normalizeSetting({
      id: generateId(),
      displayType: 'space',
      addressFieldType: 'normal',
      buttonLabel: DEFAULT_BUTTON_LABEL
    });
  }

  function normalizeSetting(raw) {
    const setting = raw || {};
    return {
      id: setting.id || generateId(),
      displayType: setting.displayType === 'field' ? 'field' : 'space',
      spaceElementId: setting.spaceElementId || '',
      addressFieldType: setting.addressFieldType === 'table' ? 'table' : 'normal',
      toAddressFieldCode: setting.toAddressFieldCode || '',
      tableFieldCode: setting.tableFieldCode || '',
      tableEmailFieldCode: setting.tableEmailFieldCode || '',
      tableEmailFieldLabel: setting.tableEmailFieldLabel || '',
      buttonLabel: setting.buttonLabel || DEFAULT_BUTTON_LABEL,
      allowBlankAddress: setting.allowBlankAddress === true || setting.allowBlankAddress === 'true',
      ccTemplate: setting.ccTemplate || '',
      bccTemplate: setting.bccTemplate || '',
      subjectTemplate: setting.subjectTemplate || '',
      bodyTemplate: setting.bodyTemplate || '',
      manageEnabled: setting.manageEnabled === true || setting.manageEnabled === 'true',
      manageFieldCode: setting.manageFieldCode || '',
      manageValue: setting.manageValue || ''
    };
  }

  function loadSettings() {
    if (config.settings) {
      try {
        const parsed = JSON.parse(config.settings);
        if (Array.isArray(parsed) && parsed.length > 0) {
          state.settings = parsed.map(normalizeSetting);
          return;
        }
      } catch (error) {
        console.error('設定の解析に失敗しました。', error);
      }
    }

    // 旧形式（単一設定）からの移行
    if (config.displayType) {
      state.settings = [normalizeSetting(config)];
      return;
    }

    state.settings = [createDefaultSetting()];
  }

  // ---------- テンプレート検証 ----------
  function extractTemplateCodes(text) {
    const codes = [];
    String(text || '').replace(/\{([^{}]+)\}/g, (match, rawCode) => {
      codes.push(rawCode.trim());
      return match;
    });
    return codes;
  }

  function findInvalidTemplateCodes(setting) {
    const valid = new Set(getInsertableFieldsForSetting(setting).map((field) => field.code));
    const codes = unique(
      extractTemplateCodes(setting.ccTemplate)
        .concat(extractTemplateCodes(setting.bccTemplate))
        .concat(extractTemplateCodes(setting.subjectTemplate))
        .concat(extractTemplateCodes(setting.bodyTemplate))
    );
    return codes.filter((code) => code && !valid.has(code));
  }

  // ---------- カード描画 ----------
  function optionsHtml(options, selectedValue) {
    return ['<option value="">選択してください</option>'].concat(
      options.map((opt) => {
        const selectedAttr = opt.value === selectedValue ? ' selected' : '';
        return `<option value="${escapeHtml(opt.value)}"${selectedAttr}>${escapeHtml(opt.label)}</option>`;
      })
    ).join('');
  }

  function insertListHtml(setting, keyword) {
    const normalized = String(keyword || '').trim().toLowerCase();
    const filtered = getInsertableFieldsForSetting(setting).filter((field) => {
      if (!normalized) {
        return true;
      }
      const label = String(field.label || '').toLowerCase();
      return field.code.toLowerCase().includes(normalized) || label.includes(normalized);
    });

    if (filtered.length === 0) {
      return '<div class="field-note">該当するフィールドがありません。</div>';
    }

    return filtered.map((field) => {
      return `
        <button type="button" class="field-insert-item" data-action="insert-code" data-code="${escapeHtml(field.code)}" title="{${escapeHtml(field.code)}} を挿入">
          <span class="field-insert-item-label">${escapeHtml(field.label || field.code)}</span>
          <span class="field-insert-item-code">{${escapeHtml(field.code)}}</span>
        </button>
      `;
    }).join('');
  }

  function validationHtml(setting) {
    const invalid = findInvalidTemplateCodes(setting);
    if (invalid.length === 0) {
      return '';
    }
    return `存在しない、または対象テーブル外のフィールドコードです: ${invalid.map((code) => `{${code}}`).join(', ')}`;
  }

  function renderSettingCard(setting, index) {
    const card = document.createElement('section');
    card.className = 'setting-card';
    card.dataset.settingId = setting.id;

    const normalSelected = optionsHtml(
      getNormalEmailFields().map((f) => ({ value: f.code, label: fieldLabel(f) })),
      setting.toAddressFieldCode
    );
    const tableSelected = optionsHtml(
      getSubtables().map((f) => ({ value: f.code, label: fieldLabel(f) })),
      setting.tableFieldCode
    );
    const tableEmailSelected = optionsHtml(
      getTableEmailFields(setting.tableFieldCode).map((f) => ({ value: f.code, label: fieldLabel(f) })),
      setting.tableEmailFieldCode
    );

    const isSpace = setting.displayType === 'space';
    const isField = setting.displayType === 'field';
    const isNormal = setting.addressFieldType === 'normal';
    const isTable = setting.addressFieldType === 'table';
    const validationText = validationHtml(setting);
    const manageSelected = optionsHtml(
      getManageFieldsForSetting(setting).map((f) => ({ value: f.code, label: fieldLabel(f) })),
      setting.manageFieldCode
    );
    const spacerSelected = getSpacerOptionsHtml(setting.spaceElementId);

    card.innerHTML = `
      <div class="setting-card-header">
        <div>
          <h3>設定 ${index + 1}</h3>
          <p>メール送信ボタン・テンプレート・送信済み更新を1セットとして設定します。</p>
        </div>
        <button type="button" class="setting-remove-button" data-action="remove-setting">削除</button>
      </div>

      <div class="form-stack">
        <section class="setting-section">
          <h4 class="setting-section-title">メール送信ボタン設定</h4>
          <div class="setting-section-body">
        <div class="form-field">
          <label class="kintoneplugin-label">表示位置タイプ</label>
          <div class="radio-group">
            <label class="radio-item">
              <input type="radio" name="display-type-${escapeHtml(setting.id)}" value="space" data-field="displayType"${isSpace ? ' checked' : ''}>
              <span>スペースフィールド（指定スペースにボタンを表示）</span>
            </label>
            <label class="radio-item">
              <input type="radio" name="display-type-${escapeHtml(setting.id)}" value="field" data-field="displayType"${isField ? ' checked' : ''}>
              <span>メールアドレスフィールド（対象フィールドの表示をボタンに置換）</span>
            </label>
          </div>
        </div>

        <div class="mode-block" data-mode-block="space"${isSpace ? '' : ' hidden'}>
          <div class="form-field">
            <label class="kintoneplugin-label">スペースフィールド要素ID <span class="kintoneplugin-require">*</span></label>
            <select class="kintoneplugin-select" data-field="spaceElementId">${spacerSelected}</select>
            <span class="field-note">フォームに設置したスペースの要素IDから選択してください。</span>
          </div>
          <div class="form-field">
            <label class="kintoneplugin-label">宛先メールアドレスフィールド（通常フィールド） <span class="kintoneplugin-require">*</span></label>
            <select class="kintoneplugin-select" data-field="spaceToAddress">${normalSelected}</select>
            <span class="field-note">スペース表示時の宛先となる通常フィールド（LINK形式）を選択します。</span>
          </div>
        </div>

        <div class="mode-block" data-mode-block="field"${isField ? '' : ' hidden'}>
          <div class="form-field">
            <label class="kintoneplugin-label">対象メールアドレス種別</label>
            <div class="radio-group">
              <label class="radio-item">
                <input type="radio" name="address-field-type-${escapeHtml(setting.id)}" value="normal" data-field="addressFieldType"${isNormal ? ' checked' : ''}>
                <span>通常フィールド</span>
              </label>
              <label class="radio-item">
                <input type="radio" name="address-field-type-${escapeHtml(setting.id)}" value="table" data-field="addressFieldType"${isTable ? ' checked' : ''}>
                <span>テーブル内フィールド</span>
              </label>
            </div>
          </div>
          <div class="form-field" data-address-block="normal"${isNormal ? '' : ' hidden'}>
            <label class="kintoneplugin-label">メールアドレスフィールド（通常フィールド） <span class="kintoneplugin-require">*</span></label>
            <select class="kintoneplugin-select" data-field="fieldToAddress">${normalSelected}</select>
            <span class="field-note">このフィールドの表示領域をボタンに置き換え、値を宛先として使用します。</span>
          </div>
          <div class="form-field" data-address-block="table"${isTable ? '' : ' hidden'}>
            <label class="kintoneplugin-label">対象テーブルフィールド <span class="kintoneplugin-require">*</span></label>
            <select class="kintoneplugin-select" data-field="tableField">${tableSelected}</select>
            <span class="field-note">メールアドレス列を含むサブテーブルを選択します。</span>
          </div>
          <div class="form-field" data-address-block="table"${isTable ? '' : ' hidden'}>
            <label class="kintoneplugin-label">テーブル内メールアドレスフィールド <span class="kintoneplugin-require">*</span></label>
            <select class="kintoneplugin-select" data-field="tableEmailField">${tableEmailSelected}</select>
            <span class="field-note">各行のこのフィールドの表示をボタンに置き換え、行ごとの宛先として使用します。</span>
          </div>
        </div>

        <div class="form-field">
          <label class="kintoneplugin-label">ボタン名 <span class="kintoneplugin-require">*</span></label>
          <input type="text" class="kintoneplugin-input-text" data-field="buttonLabel" value="${escapeHtml(setting.buttonLabel)}" placeholder="例: 注文メール作成">
          <span class="field-note">初期値は「メール作成」です。</span>
        </div>
        <div class="form-field">
          <label class="checkbox-item checkbox-inline">
            <input type="checkbox" data-field="allowBlankAddress"${setting.allowBlankAddress ? ' checked' : ''}>
            <span>宛先が空でもボタンを表示する</span>
          </label>
          <span class="field-note">有効にすると、宛先フィールドが空欄でも件名・本文テンプレート入りのメール作成画面を開けます。宛先はメールアプリ側で手入力してください。</span>
        </div>
          </div>
        </section>

        <section class="setting-section">
          <h4 class="setting-section-title">テンプレート設定</h4>
          <div class="setting-section-body">
        <div class="form-field">
          <label class="kintoneplugin-label">CCテンプレート</label>
          <input type="text" class="kintoneplugin-input-text" data-field="ccTemplate" data-template-target value="${escapeHtml(setting.ccTemplate)}" placeholder="例: {担当者メール}, cc@example.com">
          <span class="field-note">複数指定する場合はカンマ区切りで入力してください。フィールドコードも挿入できます。</span>
        </div>
        <div class="form-field">
          <label class="kintoneplugin-label">BCCテンプレート</label>
          <input type="text" class="kintoneplugin-input-text" data-field="bccTemplate" data-template-target value="${escapeHtml(setting.bccTemplate)}" placeholder="例: bcc@example.com">
          <span class="field-note">複数指定する場合はカンマ区切りで入力してください。フィールドコードも挿入できます。</span>
        </div>
        <div class="form-field">
          <label class="kintoneplugin-label">件名テンプレート</label>
          <input type="text" class="kintoneplugin-input-text" data-field="subjectTemplate" data-template-target value="${escapeHtml(setting.subjectTemplate)}" placeholder="例: 注文書送付の件：{案件番号}">
        </div>
        <div class="form-field">
          <label class="kintoneplugin-label">本文テンプレート</label>
          <textarea class="kintoneplugin-textarea" rows="10" data-field="bodyTemplate" data-template-target placeholder="例:&#10;{会社名} 御中&#10;&#10;お世話になっております。&#10;案件番号：{案件番号}">${escapeHtml(setting.bodyTemplate)}</textarea>
        </div>

        <div class="form-field field-inserter">
          <label class="kintoneplugin-label">フィールドコードの挿入</label>
          <span class="field-note">挿入先（CC／BCC／件名／本文）の入力欄をクリックしてから、下のボタンで {フィールドコード} を挿入できます。通常フィールドと、対象テーブルで選択したテーブルの項目のみ表示されます。</span>
          <input type="text" class="kintoneplugin-input-text" data-field="fieldSearch" placeholder="フィールド名またはコードで検索" autocomplete="off">
          <div class="field-insert-list" data-role="insert-list">${insertListHtml(setting, '')}</div>
        </div>

        <div class="template-validation" data-role="validation"${validationText ? '' : ' hidden'}>${escapeHtml(validationText)}</div>
          </div>
        </section>

        <section class="setting-section manage-section">
          <h4 class="setting-section-title">送信済み自動更新</h4>
          <label class="checkbox-item checkbox-inline">
            <input type="checkbox" data-field="manageEnabled"${setting.manageEnabled ? ' checked' : ''}>
            <span>メール送信済みを自動更新する</span>
          </label>
          <span class="field-note">有効にすると、ボタン押下後に「送信済みにするか」を確認し、選択した場合に指定項目を更新します。</span>
          <div class="manage-block"${setting.manageEnabled ? '' : ' hidden'}>
            <div class="form-field">
              <label class="kintoneplugin-label">更新する項目 <span class="kintoneplugin-require">*</span></label>
              <select class="kintoneplugin-select" data-field="manageFieldCode">${manageSelected}</select>
              <span class="field-note">通常フィールド、または対象テーブルで選択したテーブルの項目（例: 送信フラグ）を選択します。</span>
            </div>
            <div class="form-field">
              <label class="kintoneplugin-label">設定値 <span class="kintoneplugin-require">*</span></label>
              <input type="text" class="kintoneplugin-input-text" data-field="manageValue" value="${escapeHtml(setting.manageValue)}" placeholder="例: 送信済み">
              <span class="field-note">送信済みにした際に、上記項目へ設定する値です。</span>
            </div>
          </div>
        </section>
      </div>
    `;

    return card;
  }

  function renderSettings() {
    settingsListEl.innerHTML = '';
    settingsEmptyEl.hidden = state.settings.length > 0;
    state.settings.forEach((setting, index) => {
      settingsListEl.appendChild(renderSettingCard(setting, index));
    });
  }

  // ---------- DOM 同期 ----------
  function getSettingByCard(card) {
    return state.settings.find((setting) => setting.id === card.dataset.settingId);
  }

  function getCheckedRadioValue(card, fieldName) {
    const radio = card.querySelector(`input[type="radio"][data-field="${fieldName}"]:checked`);
    return radio ? radio.value : '';
  }

  function getInputValue(card, fieldName) {
    const el = card.querySelector(`[data-field="${fieldName}"]`);
    return el ? el.value : '';
  }

  function syncSettingFromCard(setting, card) {
    setting.displayType = getCheckedRadioValue(card, 'displayType') || setting.displayType;
    setting.addressFieldType = getCheckedRadioValue(card, 'addressFieldType') || setting.addressFieldType;
    setting.spaceElementId = getInputValue(card, 'spaceElementId').trim();
    setting.toAddressFieldCode = setting.displayType === 'space'
      ? getInputValue(card, 'spaceToAddress')
      : getInputValue(card, 'fieldToAddress');
    setting.tableFieldCode = getInputValue(card, 'tableField');
    setting.tableEmailFieldCode = getInputValue(card, 'tableEmailField');
    setting.buttonLabel = getInputValue(card, 'buttonLabel');
    const allowBlankAddressCheckbox = card.querySelector('[data-field="allowBlankAddress"]');
    setting.allowBlankAddress = allowBlankAddressCheckbox ? allowBlankAddressCheckbox.checked : false;
    setting.ccTemplate = getInputValue(card, 'ccTemplate');
    setting.bccTemplate = getInputValue(card, 'bccTemplate');
    setting.subjectTemplate = getInputValue(card, 'subjectTemplate');
    setting.bodyTemplate = getInputValue(card, 'bodyTemplate');
    const manageCheckbox = card.querySelector('[data-field="manageEnabled"]');
    setting.manageEnabled = manageCheckbox ? manageCheckbox.checked : false;
    setting.manageFieldCode = getInputValue(card, 'manageFieldCode');
    setting.manageValue = getInputValue(card, 'manageValue');
  }

  function syncAllSettingsFromDom() {
    state.settings.forEach((setting) => {
      const card = settingsListEl.querySelector(`.setting-card[data-setting-id="${setting.id}"]`);
      if (card) {
        syncSettingFromCard(setting, card);
      }
    });
  }

  function updateCardValidation(setting, card) {
    const el = card.querySelector('[data-role="validation"]');
    if (!el) {
      return;
    }
    const text = validationHtml(setting);
    el.textContent = text;
    el.hidden = !text;
  }

  function renderCardInsertList(setting, card) {
    const list = card.querySelector('[data-role="insert-list"]');
    const keyword = getInputValue(card, 'fieldSearch');
    if (list) {
      list.innerHTML = insertListHtml(setting, keyword);
    }
  }

  function insertTextIntoTarget(target, text) {
    if (!target) {
      return;
    }
    const start = typeof target.selectionStart === 'number' ? target.selectionStart : target.value.length;
    const end = typeof target.selectionEnd === 'number' ? target.selectionEnd : target.value.length;
    target.value = `${target.value.slice(0, start)}${text}${target.value.slice(end)}`;
    const caret = start + text.length;
    target.focus();
    try {
      target.setSelectionRange(caret, caret);
    } catch (error) {
      // setSelectionRange 非対応の型は無視
    }
  }

  // ---------- イベント ----------
  addSettingBtn.addEventListener('click', () => {
    syncAllSettingsFromDom();
    state.settings.push(createDefaultSetting());
    renderSettings();
  });

  settingsListEl.addEventListener('change', (event) => {
    const card = event.target.closest('.setting-card');
    if (!card) {
      return;
    }
    const setting = getSettingByCard(card);
    if (!setting) {
      return;
    }
    const field = event.target.dataset.field;

    if (field === 'displayType' || field === 'addressFieldType' || field === 'tableField' || field === 'manageEnabled') {
      syncSettingFromCard(setting, card);
      const index = state.settings.indexOf(setting);
      const newCard = renderSettingCard(setting, index);
      card.replaceWith(newCard);
    }
  });

  settingsListEl.addEventListener('input', (event) => {
    const card = event.target.closest('.setting-card');
    if (!card) {
      return;
    }
    const setting = getSettingByCard(card);
    if (!setting) {
      return;
    }
    const field = event.target.dataset.field;

    if (field === 'fieldSearch') {
      renderCardInsertList(setting, card);
      return;
    }

    if (field === 'ccTemplate' || field === 'bccTemplate' || field === 'subjectTemplate' || field === 'bodyTemplate') {
      setting[field] = event.target.value;
      updateCardValidation(setting, card);
    }
  });

  settingsListEl.addEventListener('focusin', (event) => {
    const field = event.target.dataset.field;
    if (field === 'ccTemplate' || field === 'bccTemplate' || field === 'subjectTemplate' || field === 'bodyTemplate') {
      activeTemplateTarget = event.target;
    }
  });

  settingsListEl.addEventListener('click', (event) => {
    const card = event.target.closest('.setting-card');
    if (!card) {
      return;
    }
    const setting = getSettingByCard(card);
    if (!setting) {
      return;
    }

    if (event.target.closest('[data-action="remove-setting"]')) {
      syncAllSettingsFromDom();
      state.settings = state.settings.filter((item) => item.id !== setting.id);
      renderSettings();
      return;
    }

    const insertBtn = event.target.closest('[data-action="insert-code"]');
    if (insertBtn) {
      const code = insertBtn.getAttribute('data-code');
      if (!code) {
        return;
      }
      const bodyTarget = card.querySelector('[data-field="bodyTemplate"]');
      const target = (activeTemplateTarget && card.contains(activeTemplateTarget))
        ? activeTemplateTarget
        : bodyTarget;
      insertTextIntoTarget(target, `{${code}}`);
      // 反映
      const updated = getSettingByCard(card);
      if (updated && target) {
        updated[target.dataset.field] = target.value;
        updateCardValidation(updated, card);
      }
    }
  });

  // ---------- 認証 ----------
  async function authenticateOnInitialize() {
    updateSaveButtonState(true, '認証状態を確認しています。');
    setAuthStatus('認証状態を確認しています。', false);

    try {
      const data = await AuthModule.authenticateDomain(API_CONFIG);
      if (data.status === 'success' && data.response?.status === 'valid') {
        authState.checked = true;
        authState.isValid = true;
        authState.trialEndDate = data.response.Trial_enddate || authState.trialEndDate;
        updateSaveButtonState(false);
        setAuthStatus('認証済みです。設定を保存できます。', false);
        return true;
      }

      const message = data.response?.message || '不明なエラー';
      authState.checked = true;
      authState.isValid = false;
      updateSaveButtonState(true, '認証に失敗したため保存できません。');
      setAuthStatus(`認証失敗: ${message}`, true);
      alert(buildReloadPromptMessage(`認証失敗: ${message}`));
      return false;
    } catch (error) {
      console.error('起動時認証エラー:', error);
      authState.checked = true;
      authState.isValid = false;
      updateSaveButtonState(true, '認証に失敗したため保存できません。');
      setAuthStatus('認証中にエラーが発生しました。', true);
      alert(buildReloadPromptMessage('認証中にエラーが発生しました。'));
      return false;
    }
  }

  // ---------- 保存 ----------
  function buildSettingForSave(setting, index) {
    const label = `設定 ${index + 1}`;

    const saved = {
      id: setting.id,
      displayType: setting.displayType === 'field' ? 'field' : 'space',
      buttonLabel: setting.buttonLabel.trim() || DEFAULT_BUTTON_LABEL,
      allowBlankAddress: Boolean(setting.allowBlankAddress),
      ccTemplate: setting.ccTemplate,
      bccTemplate: setting.bccTemplate,
      subjectTemplate: setting.subjectTemplate,
      bodyTemplate: setting.bodyTemplate
    };

    if (saved.displayType === 'space') {
      if (!setting.spaceElementId) {
        throw new Error(`${label}: スペースフィールド要素IDを選択してください。`);
      }
      if (!setting.toAddressFieldCode) {
        throw new Error(`${label}: 宛先メールアドレスフィールドを選択してください。`);
      }
      saved.spaceElementId = setting.spaceElementId;
      saved.toAddressFieldCode = setting.toAddressFieldCode;
    } else {
      saved.addressFieldType = setting.addressFieldType === 'table' ? 'table' : 'normal';
      if (saved.addressFieldType === 'normal') {
        if (!setting.toAddressFieldCode) {
          throw new Error(`${label}: メールアドレスフィールドを選択してください。`);
        }
        saved.toAddressFieldCode = setting.toAddressFieldCode;
      } else {
        if (!setting.tableFieldCode) {
          throw new Error(`${label}: 対象テーブルフィールドを選択してください。`);
        }
        if (!setting.tableEmailFieldCode) {
          throw new Error(`${label}: テーブル内メールアドレスフィールドを選択してください。`);
        }
        const emailField = getTableEmailFields(setting.tableFieldCode).find((f) => f.code === setting.tableEmailFieldCode);
        saved.tableFieldCode = setting.tableFieldCode;
        saved.tableEmailFieldCode = setting.tableEmailFieldCode;
        saved.tableEmailFieldLabel = (emailField && emailField.label) || setting.tableEmailFieldCode;
      }
    }

    const invalidCodes = findInvalidTemplateCodes(setting);
    if (invalidCodes.length > 0) {
      throw new Error(
        `${label}: CC・BCC・件名・本文に存在しないフィールドコードがあります:\n${invalidCodes.map((code) => `{${code}}`).join(', ')}\n\n` +
        '通常フィールド、または対象テーブルで選択したテーブルの項目のみ使用できます。'
      );
    }

    if (setting.manageEnabled) {
      if (!setting.manageFieldCode) {
        throw new Error(`${label}: 送信済み自動更新の「更新する項目」を選択してください。`);
      }
      if (!String(setting.manageValue).trim()) {
        throw new Error(`${label}: 送信済み自動更新の「設定値」を入力してください。`);
      }
      saved.manageEnabled = true;
      saved.manageFieldCode = setting.manageFieldCode;
      saved.manageValue = setting.manageValue;
    } else {
      saved.manageEnabled = false;
    }

    return saved;
  }

  function buildConfigForSave() {
    syncAllSettingsFromDom();

    if (state.settings.length === 0) {
      throw new Error('設定を1件以上追加してください。');
    }

    const settings = state.settings.map((setting, index) => buildSettingForSave(setting, index));

    const newConfig = {
      settings: JSON.stringify(settings),
      authStatus: 'valid'
    };

    if (authState.trialEndDate) {
      newConfig.Trial_enddate = authState.trialEndDate;
    }

    return newConfig;
  }

  saveBtn.addEventListener('click', () => {
    if (!authState.checked || !authState.isValid) {
      alert(buildReloadPromptMessage('認証が完了していないため保存できません。'));
      return;
    }

    let newConfig;
    try {
      newConfig = buildConfigForSave();
    } catch (error) {
      alert(error.message || '設定保存中にエラーが発生しました。');
      return;
    }

    kintone.plugin.app.setConfig(newConfig, () => {
      alert('設定を保存しました。');
      window.location.href = `/k/admin/app/${kintone.app.getId()}/plugin/`;
    });
  });

  cancelBtn.addEventListener('click', () => {
    window.location.href = `/k/admin/app/${kintone.app.getId()}/plugin/`;
  });

  // ---------- 初期化 ----------
  async function loadFields() {
    const fields = await KintoneConfigHelper.getFields();
    state.fields = fields.filter((field) => field.code);
  }

  async function loadSpacers() {
    const spacers = await KintoneConfigHelper.getFields(['SPACER']);
    state.spacers = spacers
      .map((field) => String(field.elementId || '').trim())
      .filter(Boolean)
      .filter((elementId, index, list) => list.indexOf(elementId) === index)
      .sort((a, b) => a.localeCompare(b, 'ja'));
  }

  async function initialize() {
    loadSettings();

    try {
      await Promise.all([loadFields(), loadSpacers()]);
      renderSettings();
      await authenticateOnInitialize();
    } catch (error) {
      console.error('設定画面の初期化エラー:', error);
      updateSaveButtonState(true, '設定画面の初期化に失敗しました。');
      setAuthStatus('初期化に失敗しました。画面をリロードしてください。', true);
      alert('フィールド情報の取得に失敗しました。');
    }
  }

  await initialize();
})(kintone.$PLUGIN_ID);
