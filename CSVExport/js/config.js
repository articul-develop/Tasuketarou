/* eslint @typescript-eslint/no-unused-vars: 0 */
(async (PLUGIN_ID) => {
  'use strict';

  const SUPPORTED_FIELD_TYPES = [
    'SINGLE_LINE_TEXT',
    'MULTI_LINE_TEXT',
    'NUMBER',
    'DROP_DOWN',
    'RADIO_BUTTON',
    'CHECK_BOX',
    'MULTI_SELECT'
  ];
  const DEFAULT_ENCODING = 'UTF-8-BOM';
  const DEFAULT_MAX_EXPORT_COUNT = '1000';
  const DEFAULT_QUOTE_MODE = 'DOUBLE_ALWAYS';
  const DEFAULT_LINE_ENDING = 'CRLF';
  const DEFAULT_INCLUDE_HEADER = true;
  const DEFAULT_DATE_FORMAT = 'YYYY-MM-DD';
  const DEFAULT_FILE_NAME_TEMPLATE = '{CSV定義名}_YYYYMMDDHHmmss';
  const QUOTE_MODE_OPTIONS = [
    { value: 'DOUBLE_ALWAYS', label: 'ダブルクォート "（常に全項目）' },
    { value: 'SINGLE', label: "シングルクォート '（常に全項目）" }
  ];
  const LINE_ENDING_OPTIONS = [
    { value: 'CRLF', label: 'CRLF（Windows / Excel）' },
    { value: 'LF', label: 'LF（Unix / Mac）' }
  ];
  const INCLUDE_HEADER_OPTIONS = [
    { value: 'true', label: 'あり' },
    { value: 'false', label: 'なし' }
  ];
  const DATE_FORMAT_OPTIONS = [
    { value: 'YYYY-MM-DD', label: 'YYYY-MM-DD' },
    { value: 'YYYY/MM/DD', label: 'YYYY/MM/DD' },
    { value: 'YYYYMMDD', label: 'YYYYMMDD' },
    { value: 'YYYY-MM-DD HH:mm:ss', label: 'YYYY-MM-DD HH:mm:ss（日時）' },
    { value: 'YYYY/MM/DD HH:mm:ss', label: 'YYYY/MM/DD HH:mm:ss（日時）' }
  ];
  const FILE_NAME_TOKEN_OPTIONS = [
    '{アプリ名}',
    '{一覧名}',
    '{CSV定義名}',
    'YYYY',
    'MM',
    'DD',
    'HH',
    'mm',
    'ss'
  ];

  const config = kintone.plugin.app.getConfig(PLUGIN_ID) || {};
  const authState = {
    checked: false,
    isValid: false,
    trialEndDate: config.Trial_enddate || ''
  };
  const state = {
    views: [],
    fields: [],
    fieldMap: {},
    definitions: [],
    activeDefinitionId: null
  };

  const addTabBtn = document.getElementById('add-tab-button');
  const tabsEl = document.getElementById('definition-tabs');
  const editorEl = document.getElementById('definition-editor');
  const emptyEl = document.getElementById('definition-empty');
  const authStatusEl = document.getElementById('auth-status');
  const saveBtn = document.getElementById('save-button');
  const cancelBtn = document.getElementById('cancel-button');

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
    return `def_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function getSortedFieldOptions(fieldCode) {
    const field = state.fieldMap[fieldCode];
    const rawOptions = field && field.options ? field.options : {};

    return Object.keys(rawOptions)
      .map((key) => ({
        label: rawOptions[key].label || key,
        index: Number(rawOptions[key].index || 0)
      }))
      .sort((a, b) => a.index - b.index)
      .map((option) => option.label);
  }

  function getFieldType(fieldCode) {
    return state.fieldMap[fieldCode] ? state.fieldMap[fieldCode].type : '';
  }

  function coerceDefinitionValue(definition) {
    const nextDefinition = Object.assign({}, definition);
    const fieldType = getFieldType(nextDefinition.updateFieldCode);
    const optionLabels = getSortedFieldOptions(nextDefinition.updateFieldCode);

    if (fieldType === 'CHECK_BOX' || fieldType === 'MULTI_SELECT') {
      const currentValues = Array.isArray(nextDefinition.updateValue)
        ? nextDefinition.updateValue
        : [];
      nextDefinition.updateValue = currentValues.filter((value) => optionLabels.indexOf(value) !== -1);
      return nextDefinition;
    }

    const currentValue = Array.isArray(nextDefinition.updateValue)
      ? ''
      : String(nextDefinition.updateValue || '');

    if ((fieldType === 'DROP_DOWN' || fieldType === 'RADIO_BUTTON') && optionLabels.length > 0) {
      nextDefinition.updateValue = optionLabels.indexOf(currentValue) !== -1 ? currentValue : optionLabels[0];
      return nextDefinition;
    }

    nextDefinition.updateValue = currentValue;
    return nextDefinition;
  }

  function createDefaultDefinition(index) {
    return {
      id: generateId(),
      name: `定義${index + 1}`,
      buttonLabel: 'CSV出力',
      targetViewIds: [],
      updateFieldCode: '',
      updateValue: '',
      encoding: DEFAULT_ENCODING,
      maxExportCount: DEFAULT_MAX_EXPORT_COUNT,
      quoteMode: DEFAULT_QUOTE_MODE,
      lineEnding: DEFAULT_LINE_ENDING,
      includeHeader: DEFAULT_INCLUDE_HEADER,
      dateFormat: DEFAULT_DATE_FORMAT,
      fileNameTemplate: DEFAULT_FILE_NAME_TEMPLATE
    };
  }

  function normalizeDefinition(definition, index) {
    const normalized = {
      id: definition.id || generateId(),
      name: definition.name || `定義${index + 1}`,
      buttonLabel: definition.buttonLabel || 'CSV出力',
      targetViewIds: Array.isArray(definition.targetViewIds)
        ? definition.targetViewIds.map((value) => String(value))
        : [],
      updateFieldCode: definition.updateFieldCode || '',
      updateValue: typeof definition.updateValue === 'undefined' ? '' : definition.updateValue,
      encoding: definition.encoding || DEFAULT_ENCODING,
      maxExportCount: String(definition.maxExportCount || DEFAULT_MAX_EXPORT_COUNT),
      quoteMode: definition.quoteMode || DEFAULT_QUOTE_MODE,
      lineEnding: definition.lineEnding || DEFAULT_LINE_ENDING,
      includeHeader: typeof definition.includeHeader === 'boolean'
        ? definition.includeHeader
        : definition.includeHeader !== 'false',
      dateFormat: definition.dateFormat || DEFAULT_DATE_FORMAT,
      fileNameTemplate: definition.fileNameTemplate || DEFAULT_FILE_NAME_TEMPLATE
    };

    return coerceDefinitionValue(normalized);
  }

  function loadDefinitions() {
    if (!config.definitions) {
      state.definitions = [createDefaultDefinition(0)];
      state.activeDefinitionId = state.definitions[0].id;
      return;
    }

    try {
      const parsed = JSON.parse(config.definitions);
      const list = Array.isArray(parsed) ? parsed.map(normalizeDefinition) : [];
      state.definitions = list.length > 0 ? list : [createDefaultDefinition(0)];
      state.activeDefinitionId = state.definitions[0].id;
    } catch (error) {
      console.error('定義設定の解析に失敗しました。', error);
      state.definitions = [createDefaultDefinition(0)];
      state.activeDefinitionId = state.definitions[0].id;
    }
  }

  function getActiveDefinition() {
    return state.definitions.find((definition) => definition.id === state.activeDefinitionId) || null;
  }

  function updateDefinition(definitionId, patch) {
    state.definitions = state.definitions.map((definition) => {
      if (definition.id !== definitionId) {
        return definition;
      }
      return coerceDefinitionValue(Object.assign({}, definition, patch));
    });
  }

  function getViewOptionsHtml(targetViewIds) {
    return state.views.map((view) => {
      const checked = targetViewIds.indexOf(String(view.id)) !== -1 ? ' checked' : '';
      return `
        <label class="checkbox-item">
          <input type="checkbox" data-target-view-checkbox value="${escapeHtml(view.id)}"${checked}>
          <span>${escapeHtml(view.name)} (${escapeHtml(view.id)})</span>
        </label>
      `;
    }).join('');
  }

  function getFieldOptionsHtml(selectedCode) {
    const emptyOption = '<option value="">更新しない</option>';
    const options = state.fields.map((field) => {
      const selected = field.code === selectedCode ? ' selected' : '';
      return `<option value="${escapeHtml(field.code)}"${selected}>${escapeHtml(field.label)} (${escapeHtml(field.code)})</option>`;
    }).join('');
    return emptyOption + options;
  }

  function getEncodingOptionsHtml(selectedEncoding) {
    return ['SJIS', 'UTF-8-BOM'].map((encoding) => {
      const selected = encoding === selectedEncoding ? ' selected' : '';
      return `<option value="${encoding}"${selected}>${encoding}</option>`;
    }).join('');
  }

  function getSelectOptionsHtml(options, selectedValue) {
    return options.map((option) => {
      const selected = option.value === selectedValue ? ' selected' : '';
      return `<option value="${escapeHtml(option.value)}"${selected}>${escapeHtml(option.label)}</option>`;
    }).join('');
  }

  function getFileNameTokenButtonsHtml() {
    return FILE_NAME_TOKEN_OPTIONS.map((token) => {
      return `<button type="button" class="token-insert-button" data-file-name-token="${escapeHtml(token)}">${escapeHtml(token)}</button>`;
    }).join('');
  }

  function buildValueEditorHtml(definition) {
    const fieldType = getFieldType(definition.updateFieldCode);
    const value = definition.updateValue;

    if (!definition.updateFieldCode) {
      return '<p class="field-note">更新対象フィールドを選択しない場合、CSV出力後のレコード更新は行いません。</p>';
    }

    if (fieldType === 'CHECK_BOX' || fieldType === 'MULTI_SELECT') {
      const currentValues = Array.isArray(value) ? value : [];
      const options = getSortedFieldOptions(definition.updateFieldCode);
      if (options.length === 0) {
        return '<p class="field-note">選択肢を取得できませんでした。</p>';
      }
      return `
        <div class="checkbox-list">
          ${options.map((option) => `
            <label class="checkbox-item">
              <input type="checkbox" data-update-value-checkbox value="${escapeHtml(option)}"${currentValues.indexOf(option) !== -1 ? ' checked' : ''}>
              <span>${escapeHtml(option)}</span>
            </label>
          `).join('')}
        </div>
        <span class="field-note">未選択のまま保存すると、出力後に値を空に戻します。</span>
      `;
    }

    if (fieldType === 'DROP_DOWN' || fieldType === 'RADIO_BUTTON') {
      const options = getSortedFieldOptions(definition.updateFieldCode);
      if (options.length === 0) {
        return '<p class="field-note">選択肢を取得できませんでした。</p>';
      }
      return `
        <select id="definition-update-value" class="kintoneplugin-select">
          ${options.map((option) => `
            <option value="${escapeHtml(option)}"${value === option ? ' selected' : ''}>${escapeHtml(option)}</option>
          `).join('')}
        </select>
      `;
    }

    if (fieldType === 'NUMBER') {
      return `<input type="number" id="definition-update-value" class="kintoneplugin-input-text" value="${escapeHtml(value)}">`;
    }

    if (fieldType === 'MULTI_LINE_TEXT') {
      return `<textarea id="definition-update-value" class="kintoneplugin-textarea">${escapeHtml(value)}</textarea>`;
    }

    return `<input type="text" id="definition-update-value" class="kintoneplugin-input-text" value="${escapeHtml(value)}">`;
  }

  function renderTabs() {
    tabsEl.innerHTML = '';

    state.definitions.forEach((definition, index) => {
      const isActive = definition.id === state.activeDefinitionId;
      const tab = document.createElement('div');
      tab.className = `definition-nav-item${isActive ? ' is-active' : ''}`;
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
      tab.setAttribute('tabindex', isActive ? '0' : '-1');
      tab.dataset.definitionId = definition.id;

      tab.innerHTML = `
        <span class="definition-nav-item-index">${index + 1}</span>
        <span class="definition-nav-item-body">
          <span class="definition-nav-item-title">${escapeHtml(definition.name || '無題')}</span>
        </span>
        <button
          type="button"
          class="definition-nav-item-remove"
          data-action="remove"
          data-definition-id="${escapeHtml(definition.id)}"
          aria-label="${escapeHtml(definition.name || '定義')}を削除"
        >×</button>
      `;

      tabsEl.appendChild(tab);
    });
  }

  function buildActiveDefinitionBannerHtml(definition) {
    const title = escapeHtml(definition.name || '無題');
    return `
      <div class="definition-active-banner" aria-label="編集中: ${title}">
        <div class="definition-active-banner-marker" aria-hidden="true"></div>
        <h3 class="definition-active-title">${title}</h3>
      </div>
    `;
  }

  function renderEditor() {
    const definition = getActiveDefinition();
    const hasDefinition = Boolean(definition);

    emptyEl.hidden = hasDefinition;
    editorEl.hidden = !hasDefinition;

    if (!definition) {
      editorEl.innerHTML = '';
      return;
    }

    editorEl.innerHTML = `
      ${buildActiveDefinitionBannerHtml(definition)}
      <div class="definition-grid">
        <div class="section-card">
          <div class="section-card-header">
            <span class="section-card-step">01</span>
            <div>
              <h3>基本設定</h3>
              <p>ボタン名や出力条件の基本情報を設定します。</p>
            </div>
          </div>
          <div class="form-stack">
            <div class="form-field">
              <label class="kintoneplugin-label" for="definition-name">定義名</label>
              <input type="text" id="definition-name" class="kintoneplugin-input-text" value="${escapeHtml(definition.name)}">
            </div>
            <div class="form-field">
              <label class="kintoneplugin-label" for="definition-button-label">ボタンラベル</label>
              <input type="text" id="definition-button-label" class="kintoneplugin-input-text" value="${escapeHtml(definition.buttonLabel)}">
            </div>
          </div>
        </div>

        <div class="section-card">
          <div class="section-card-header">
            <span class="section-card-step">02</span>
            <div>
              <h3>一覧の選択</h3>
              <p>CSV出力の対象にする一覧を選択します。</p>
            </div>
          </div>
          <div class="form-stack">
            <div class="form-field">
              <label class="kintoneplugin-label" for="definition-target-views">出力対象の一覧</label>
              <div id="definition-target-views" class="checkbox-list checkbox-panel">
                ${getViewOptionsHtml(definition.targetViewIds)}
              </div>
              <span class="field-note">複数選択できます。CSV列は表示中一覧の列順をそのまま使います。</span>
            </div>
          </div>
        </div>

        <div class="section-card">
          <div class="section-card-header">
            <span class="section-card-step">03</span>
            <div>
              <h3>出力成功後の更新（任意）</h3>
              <p>CSV出力が完了したレコードに値を反映したい場合だけ設定します。</p>
            </div>
          </div>
          <div class="form-stack">
            <div class="form-field">
              <label class="kintoneplugin-label" for="definition-update-field">更新対象フィールド</label>
              <select id="definition-update-field" class="kintoneplugin-select">
                ${getFieldOptionsHtml(definition.updateFieldCode)}
              </select>
              <span class="field-note">未選択の場合は更新しません。文字列、ドロップダウン、ラジオ、チェック、数値に対応します。</span>
            </div>
            <div class="form-field">
              <label class="kintoneplugin-label">更新値</label>
              <div id="definition-update-value-container">${buildValueEditorHtml(definition)}</div>
            </div>
          </div>
        </div>
        <div class="section-card">
          <div class="section-card-header">
            <span class="section-card-step">04</span>
            <div>
              <h3>CSV詳細設定</h3>
              <p>文字コード、出力件数、引用符、改行コード、ヘッダー行、日付形式を設定します。</p>
            </div>
          </div>
          <div class="form-stack">
            <div class="form-row-2">
              <div class="form-field">
                <label class="kintoneplugin-label" for="definition-encoding">文字コード</label>
                <select id="definition-encoding" class="kintoneplugin-select">
                  ${getEncodingOptionsHtml(definition.encoding)}
                </select>
              </div>
              <div class="form-field">
                <label class="kintoneplugin-label" for="definition-max-export-count">最大出力件数</label>
                <input type="number" id="definition-max-export-count" class="kintoneplugin-input-text" min="1" step="1" value="${escapeHtml(definition.maxExportCount)}">
                <span class="field-note">一覧の抽出結果がこの件数を超える場合は出力を中止します。</span>
              </div>
            </div>
            <div class="form-row-2">
              <div class="form-field">
                <label class="kintoneplugin-label" for="definition-quote-mode">引用符</label>
                <select id="definition-quote-mode" class="kintoneplugin-select">
                  ${getSelectOptionsHtml(QUOTE_MODE_OPTIONS, definition.quoteMode)}
                </select>
                <span class="field-note">すべての項目を指定した引用符で囲みます。</span>
              </div>
              <div class="form-field">
                <label class="kintoneplugin-label" for="definition-line-ending">改行コード</label>
                <select id="definition-line-ending" class="kintoneplugin-select">
                  ${getSelectOptionsHtml(LINE_ENDING_OPTIONS, definition.lineEnding)}
                </select>
              </div>
            </div>
            <div class="form-row-2">
              <div class="form-field">
                <label class="kintoneplugin-label" for="definition-include-header">ヘッダー行</label>
                <select id="definition-include-header" class="kintoneplugin-select">
                  ${getSelectOptionsHtml(INCLUDE_HEADER_OPTIONS, definition.includeHeader ? 'true' : 'false')}
                </select>
              </div>
              <div class="form-field">
                <label class="kintoneplugin-label" for="definition-date-format">日付形式</label>
                <select id="definition-date-format" class="kintoneplugin-select">
                  ${getSelectOptionsHtml(DATE_FORMAT_OPTIONS, definition.dateFormat)}
                </select>
                <span class="field-note">日付・日時フィールドの出力形式です。時刻のみフィールドはそのまま出力します。</span>
              </div>
            </div>
            <div class="form-field">
              <label class="kintoneplugin-label" for="definition-file-name-template">CSVファイル名</label>
              <input type="text" id="definition-file-name-template" class="kintoneplugin-input-text" value="${escapeHtml(definition.fileNameTemplate)}">
              <div class="token-insert-panel" aria-label="CSVファイル名に挿入できる項目">
                ${getFileNameTokenButtonsHtml()}
              </div>
              <span class="field-note">使用できる変数: {アプリ名}, {一覧名}, {CSV定義名}。日付は YYYYMMDDHHmmss や YYYYMMDD などを直接入力できます。使用できない文字（\ / : * ? &quot; &lt; &gt; |）は自動で _ に置換します。</span>
            </div>
          </div>
        </div>
      </div>
    `;

    bindEditorEvents(definition.id);
  }

  function renderAll() {
    renderTabs();
    renderEditor();
  }

  function handleTabRemove(definitionId) {
    if (state.definitions.length === 1) {
      alert('定義は1件以上必要です。');
      return;
    }

    state.definitions = state.definitions.filter((definition) => definition.id !== definitionId);
    if (state.activeDefinitionId === definitionId) {
      state.activeDefinitionId = state.definitions[0].id;
    }
    renderAll();
  }

  function renderActiveBanner(definitionId) {
    const banner = editorEl.querySelector('.definition-active-banner');
    const definition = state.definitions.find((item) => item.id === definitionId);
    if (!banner || !definition) {
      return;
    }

    const nextBanner = document.createElement('div');
    nextBanner.innerHTML = buildActiveDefinitionBannerHtml(definition);
    banner.replaceWith(nextBanner.firstElementChild);
  }

  function bindTabEvents() {
    tabsEl.addEventListener('click', (event) => {
      const removeButton = event.target.closest('button[data-action="remove"]');
      if (removeButton) {
        event.stopPropagation();
        handleTabRemove(removeButton.dataset.definitionId);
        return;
      }

      const tab = event.target.closest('.definition-nav-item');
      if (!tab) {
        return;
      }
      state.activeDefinitionId = tab.dataset.definitionId;
      renderAll();
    });
  }

  function bindEditorEvents(definitionId) {
    const nameInput = document.getElementById('definition-name');
    const buttonLabelInput = document.getElementById('definition-button-label');
    const encodingInput = document.getElementById('definition-encoding');
    const maxExportCountInput = document.getElementById('definition-max-export-count');
    const quoteModeInput = document.getElementById('definition-quote-mode');
    const lineEndingInput = document.getElementById('definition-line-ending');
    const includeHeaderInput = document.getElementById('definition-include-header');
    const dateFormatInput = document.getElementById('definition-date-format');
    const fileNameTemplateInput = document.getElementById('definition-file-name-template');
    const updateFieldInput = document.getElementById('definition-update-field');
    const updateValueInput = document.getElementById('definition-update-value');

    nameInput.addEventListener('input', () => {
      updateDefinition(definitionId, { name: nameInput.value });
      renderTabs();
      renderActiveBanner(definitionId);
    });

    buttonLabelInput.addEventListener('input', () => {
      updateDefinition(definitionId, { buttonLabel: buttonLabelInput.value });
      renderTabs();
    });

    encodingInput.addEventListener('change', () => {
      updateDefinition(definitionId, { encoding: encodingInput.value });
    });

    maxExportCountInput.addEventListener('input', () => {
      updateDefinition(definitionId, { maxExportCount: maxExportCountInput.value });
    });

    quoteModeInput.addEventListener('change', () => {
      updateDefinition(definitionId, { quoteMode: quoteModeInput.value });
    });

    lineEndingInput.addEventListener('change', () => {
      updateDefinition(definitionId, { lineEnding: lineEndingInput.value });
    });

    includeHeaderInput.addEventListener('change', () => {
      updateDefinition(definitionId, { includeHeader: includeHeaderInput.value === 'true' });
    });

    dateFormatInput.addEventListener('change', () => {
      updateDefinition(definitionId, { dateFormat: dateFormatInput.value });
    });

    fileNameTemplateInput.addEventListener('input', () => {
      updateDefinition(definitionId, { fileNameTemplate: fileNameTemplateInput.value });
    });

    editorEl.querySelectorAll('[data-file-name-token]').forEach((button) => {
      button.addEventListener('click', () => {
        insertTextAtCursor(fileNameTemplateInput, button.dataset.fileNameToken || '');
        updateDefinition(definitionId, { fileNameTemplate: fileNameTemplateInput.value });
      });
    });

    editorEl.querySelectorAll('[data-target-view-checkbox]').forEach((checkbox) => {
      checkbox.addEventListener('change', () => {
        const selectedValues = Array.from(editorEl.querySelectorAll('[data-target-view-checkbox]'))
          .filter((input) => input.checked)
          .map((input) => input.value);
        updateDefinition(definitionId, { targetViewIds: selectedValues });
        renderTabs();
        renderActiveBanner(definitionId);
      });
    });

    updateFieldInput.addEventListener('change', () => {
      updateDefinition(definitionId, { updateFieldCode: updateFieldInput.value, updateValue: '' });
      renderTabs();
      renderEditor();
    });

    if (updateValueInput) {
      updateValueInput.addEventListener('input', () => {
        updateDefinition(definitionId, { updateValue: updateValueInput.value });
      });
      updateValueInput.addEventListener('change', () => {
        updateDefinition(definitionId, { updateValue: updateValueInput.value });
      });
    }

    editorEl.querySelectorAll('[data-update-value-checkbox]').forEach((checkbox) => {
      checkbox.addEventListener('change', () => {
        const selectedValues = Array.from(editorEl.querySelectorAll('[data-update-value-checkbox]'))
          .filter((input) => input.checked)
          .map((input) => input.value);
        updateDefinition(definitionId, { updateValue: selectedValues });
      });
    });
  }

  function insertTextAtCursor(input, text) {
    const start = typeof input.selectionStart === 'number' ? input.selectionStart : input.value.length;
    const end = typeof input.selectionEnd === 'number' ? input.selectionEnd : input.value.length;
    input.value = `${input.value.slice(0, start)}${text}${input.value.slice(end)}`;
    const nextPosition = start + text.length;
    input.focus();
    input.setSelectionRange(nextPosition, nextPosition);
  }

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

  async function loadViews() {
    const response = await kintone.api(kintone.api.url('/k/v1/app/views.json', true), 'GET', {
      app: kintone.app.getId()
    });

    state.views = Object.keys(response.views || {})
      .map((name) => {
        const view = response.views[name];
        return {
          id: String(view.id),
          name: view.name || name
        };
      })
      .map((view) => ({
        id: view.id,
        name: view.name
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'ja'));
  }

  async function loadFields() {
    const response = await kintone.api(kintone.api.url('/k/v1/preview/app/form/fields.json', true), 'GET', {
      app: kintone.app.getId()
    });

    state.fields = Object.keys(response.properties || {})
      .map((fieldCode) => Object.assign({ code: fieldCode }, response.properties[fieldCode]))
      .filter((field) => field.type !== 'SUBTABLE')
      .filter((field) => SUPPORTED_FIELD_TYPES.indexOf(field.type) !== -1)
      .sort((a, b) => a.label.localeCompare(b.label, 'ja'));
    state.fieldMap = state.fields.reduce((accumulator, field) => {
      accumulator[field.code] = field;
      return accumulator;
    }, {});
  }

  function validateDefinitions(definitions) {
    if (definitions.length === 0) {
      throw new Error('定義を1件以上作成してください。');
    }

    definitions.forEach((definition, index) => {
      if (!definition.name) {
        throw new Error(`${index + 1}件目: 定義名を入力してください。`);
      }
      if (!definition.buttonLabel) {
        throw new Error(`${index + 1}件目: ボタンラベルを入力してください。`);
      }
      if (definition.targetViewIds.length === 0) {
        throw new Error(`${index + 1}件目: 表示対象の一覧を1つ以上選択してください。`);
      }
      if (!/^\d+$/.test(String(definition.maxExportCount)) || Number(definition.maxExportCount) <= 0) {
        throw new Error(`${index + 1}件目: 最大出力件数には1以上の整数を入力してください。`);
      }
    });
  }

  function serializeDefinitions() {
    const definitions = state.definitions.map((definition) => {
      const normalized = normalizeDefinition(definition);
      return {
        id: normalized.id,
        name: normalized.name,
        buttonLabel: normalized.buttonLabel,
        targetViewIds: normalized.targetViewIds,
        updateFieldCode: normalized.updateFieldCode,
        updateValue: normalized.updateValue,
        encoding: normalized.encoding,
        maxExportCount: Number(normalized.maxExportCount),
        quoteMode: normalized.quoteMode,
        lineEnding: normalized.lineEnding,
        includeHeader: normalized.includeHeader,
        dateFormat: normalized.dateFormat,
        fileNameTemplate: normalized.fileNameTemplate
      };
    });

    validateDefinitions(definitions);
    return definitions;
  }

  addTabBtn.addEventListener('click', () => {
    const definition = createDefaultDefinition(state.definitions.length);
    state.definitions.push(definition);
    state.activeDefinitionId = definition.id;
    renderAll();
  });

  saveBtn.addEventListener('click', () => {
    if (!authState.checked || !authState.isValid) {
      alert(buildReloadPromptMessage('認証が完了していないため保存できません。'));
      return;
    }

    try {
      const definitions = serializeDefinitions();
      const newConfig = {
        definitions: JSON.stringify(definitions),
        authStatus: 'valid'
      };

      if (authState.trialEndDate) {
        newConfig.Trial_enddate = authState.trialEndDate;
      }

      kintone.plugin.app.setConfig(newConfig, () => {
        alert('設定を保存しました。');
        window.location.href = `/k/admin/app/${kintone.app.getId()}/plugin/`;
      });
    } catch (error) {
      console.error('設定保存エラー:', error);
      alert(error.message || '設定保存中にエラーが発生しました。');
    }
  });

  cancelBtn.addEventListener('click', () => {
    window.location.href = `/k/admin/app/${kintone.app.getId()}/plugin/`;
  });

  bindTabEvents();

  try {
    await Promise.all([loadViews(), loadFields()]);
    loadDefinitions();
    renderAll();
    await authenticateOnInitialize();
  } catch (error) {
    console.error(error);
    updateSaveButtonState(true, '初期化に失敗しました。');
    setAuthStatus('初期化に失敗しました。画面をリロードしてください。', true);
    alert('設定画面の初期化に失敗しました。');
  }
})(kintone.$PLUGIN_ID);
