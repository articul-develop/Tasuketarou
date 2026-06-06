(async (PLUGIN_ID) => {
  'use strict';

  const DEFAULT_SETTING = {
    fixedColumns: '4',
    maxHeight: '500',
    minWidth: '1200',
    rightMargin: '32',
    stickyStopTop: '80'
  };

  const config = kintone.plugin.app.getConfig(PLUGIN_ID) || {};
  const authState = {
    checked: false,
    isValid: false,
    trialEndDate: config.Trial_enddate || ''
  };
  const state = {
    fields: [],
    columnsByTableCode: {},
    settings: []
  };

  const addSettingBtn = document.getElementById('add-setting-button');
  const settingsListEl = document.getElementById('settings-list');
  const settingsEmptyEl = document.getElementById('settings-empty');
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
    return `setting_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function createDefaultSetting() {
    return {
      id: generateId(),
      tableFieldCode: '',
      fixedColumns: DEFAULT_SETTING.fixedColumns,
      maxHeight: DEFAULT_SETTING.maxHeight,
      minWidth: DEFAULT_SETTING.minWidth,
      rightMargin: DEFAULT_SETTING.rightMargin,
      stickyStopTop: DEFAULT_SETTING.stickyStopTop
    };
  }

  function normalizeSetting(setting) {
    return {
      id: setting.id || generateId(),
      tableFieldCode: setting.tableFieldCode || '',
      fixedColumns: typeof setting.fixedColumns === 'undefined'
        ? DEFAULT_SETTING.fixedColumns
        : String(setting.fixedColumns),
      maxHeight: String(setting.maxHeight || DEFAULT_SETTING.maxHeight),
      minWidth: DEFAULT_SETTING.minWidth,
      rightMargin: DEFAULT_SETTING.rightMargin,
      stickyStopTop: DEFAULT_SETTING.stickyStopTop
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
        console.error('固定表示設定の解析に失敗しました。', error);
      }
    }

    if (config.tableFieldCode) {
      state.settings = [normalizeSetting(config)];
      return;
    }

    state.settings = [createDefaultSetting()];
  }

  function getFieldOptionsHtml(selectedCode) {
    const options = state.fields.map((field) => {
      const selected = field.code === selectedCode ? ' selected' : '';
      const label = field.label ? `${field.label} (${field.code})` : field.code;
      return `<option value="${escapeHtml(field.code)}"${selected}>${escapeHtml(label)}</option>`;
    }).join('');

    return `<option value="">選択してください</option>${options}`;
  }

  function getColumnsForTable(tableFieldCode) {
    return state.columnsByTableCode[tableFieldCode] || [];
  }

  function getFixedColumnCountForPreview(value) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }

  function getColumnReferenceHtml(setting) {
    if (!setting.tableFieldCode) {
      return `
        <div class="column-reference is-empty" data-column-reference>
          <div class="column-reference-title">列構成（参考）</div>
          <p>対象テーブルを選択すると、テーブル内の項目名を表示します。</p>
        </div>
      `;
    }

    const columns = getColumnsForTable(setting.tableFieldCode);
    if (columns.length === 0) {
      return `
        <div class="column-reference is-empty" data-column-reference>
          <div class="column-reference-title">列構成（参考）</div>
          <p>このテーブルの列情報を取得できませんでした。</p>
        </div>
      `;
    }

    const fixedColumnCount = getFixedColumnCountForPreview(setting.fixedColumns);
    const items = columns.map((column, index) => {
      const columnNumber = index + 1;
      const isFixed = columnNumber <= fixedColumnCount;
      const label = column.label || column.code;
      return `
        <li class="column-reference-item${isFixed ? ' is-fixed' : ''}">
          <span class="column-reference-index">${columnNumber}</span>
          <span class="column-reference-label">${escapeHtml(label)}</span>
          <span class="column-reference-code">${escapeHtml(column.code)}</span>
          ${isFixed
            ? '<span class="column-reference-badge">固定対象</span>'
            : '<span class="column-reference-badge-placeholder" aria-hidden="true"></span>'}
        </li>
      `;
    }).join('');

    return `
      <div class="column-reference" data-column-reference>
        <div class="column-reference-header">
          <div>
            <div class="column-reference-title">列構成（参考）</div>
            <p>フォーム設定の項目順です。固定列数を0にすると、見出しラベルのみ固定します。</p>
          </div>
          <span class="column-reference-count">${columns.length}列</span>
        </div>
        <ol class="column-reference-list">
          ${items}
        </ol>
      </div>
    `;
  }

  function updateColumnReference(card, setting) {
    const referenceEl = card.querySelector('[data-column-reference]');
    if (!referenceEl) {
      return;
    }

    const wrapper = document.createElement('div');
    wrapper.innerHTML = getColumnReferenceHtml(setting).trim();
    referenceEl.replaceWith(wrapper.firstElementChild);
  }

  function renderSettings() {
    settingsListEl.innerHTML = '';
    settingsEmptyEl.hidden = state.settings.length > 0;

    state.settings.forEach((setting, index) => {
      const card = document.createElement('section');
      card.className = 'setting-card';
      card.dataset.settingId = setting.id;
      card.innerHTML = `
        <div class="setting-card-header">
          <div>
            <h4>固定表示設定 ${index + 1}</h4>
            <p>対象テーブル、固定列数、最大高さを指定します。</p>
          </div>
          <button type="button" class="setting-remove-button" data-action="remove-setting">削除</button>
        </div>
        <div class="config-form">
          <div class="form-field">
            <label class="kintoneplugin-label" for="table-field-${escapeHtml(setting.id)}">
              対象テーブル
              <span class="kintoneplugin-require">*</span>
            </label>
            <select id="table-field-${escapeHtml(setting.id)}" class="kintoneplugin-select" data-field="tableFieldCode">
              ${getFieldOptionsHtml(setting.tableFieldCode)}
            </select>
            <span class="field-note">固定表示するサブテーブルを選択します。</span>
          </div>
          <div class="form-row-2">
            <div class="form-field">
              <label class="kintoneplugin-label" for="fixed-columns-${escapeHtml(setting.id)}">
                固定列数
                <span class="kintoneplugin-require">*</span>
              </label>
              <input type="number" id="fixed-columns-${escapeHtml(setting.id)}" class="kintoneplugin-input-text" min="0" step="1" value="${escapeHtml(setting.fixedColumns)}" data-field="fixedColumns">
              <span class="field-note">左から何列を固定するか指定します。0の場合は見出しラベルのみ固定します。</span>
            </div>
            <div class="form-field">
              <label class="kintoneplugin-label" for="max-height-${escapeHtml(setting.id)}">
                最大高さ
                <span class="kintoneplugin-require">*</span>
              </label>
              <input type="number" id="max-height-${escapeHtml(setting.id)}" class="kintoneplugin-input-text" min="1" step="1" value="${escapeHtml(setting.maxHeight)}" data-field="maxHeight">
              <span class="field-note">テーブルの高さをpxで指定します。</span>
            </div>
          </div>
          ${getColumnReferenceHtml(setting)}
        </div>
      `;
      settingsListEl.appendChild(card);
    });
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

  async function loadSubtableFields() {
    const allFields = await KintoneConfigHelper.getFields();
    state.fields = allFields.filter((field) => field.type === 'SUBTABLE');
    state.columnsByTableCode = state.fields.reduce((accumulator, field) => {
      accumulator[field.code] = [];
      return accumulator;
    }, {});

    allFields.forEach((field) => {
      if (!field.subtableCode || field.type === 'SUBTABLE') {
        return;
      }

      if (!state.columnsByTableCode[field.subtableCode]) {
        state.columnsByTableCode[field.subtableCode] = [];
      }
      state.columnsByTableCode[field.subtableCode].push(field);
    });
  }

  function validatePositiveInteger(value, label) {
    const parsed = Number.parseInt(value, 10);

    if (!Number.isFinite(parsed) || parsed <= 0 || String(parsed) !== String(value).trim()) {
      throw new Error(`${label}は1以上の整数で入力してください。`);
    }

    return String(parsed);
  }

  function validateNonNegativeInteger(value, label) {
    const parsed = Number.parseInt(value, 10);

    if (!Number.isFinite(parsed) || parsed < 0 || String(parsed) !== String(value).trim()) {
      throw new Error(`${label}は0以上の整数で入力してください。`);
    }

    return String(parsed);
  }

  function buildConfigForSave() {
    if (state.settings.length === 0) {
      throw new Error('固定表示設定を1件以上追加してください。');
    }

    const settings = state.settings.map((setting, index) => {
      if (!setting.tableFieldCode) {
        throw new Error(`${index + 1}件目: 対象テーブルを選択してください。`);
      }

      return {
        id: setting.id,
        tableFieldCode: setting.tableFieldCode,
        fixedColumns: validateNonNegativeInteger(setting.fixedColumns, `${index + 1}件目: 固定列数`),
        maxHeight: validatePositiveInteger(setting.maxHeight, `${index + 1}件目: 最大高さ`),
        minWidth: DEFAULT_SETTING.minWidth,
        rightMargin: DEFAULT_SETTING.rightMargin,
        stickyStopTop: DEFAULT_SETTING.stickyStopTop
      };
    });

    const firstSetting = settings[0];
    const newConfig = {
      settings: JSON.stringify(settings),
      tableFieldCode: firstSetting.tableFieldCode,
      fixedColumns: firstSetting.fixedColumns,
      maxHeight: firstSetting.maxHeight,
      minWidth: DEFAULT_SETTING.minWidth,
      rightMargin: DEFAULT_SETTING.rightMargin,
      stickyStopTop: DEFAULT_SETTING.stickyStopTop,
      authStatus: 'valid'
    };

    if (authState.trialEndDate) {
      newConfig.Trial_enddate = authState.trialEndDate;
    }

    return newConfig;
  }

  async function initialize() {
    loadSettings();

    try {
      await loadSubtableFields();
      renderSettings();
      await authenticateOnInitialize();
    } catch (err) {
      console.error('設定画面の初期化エラー:', err);
      updateSaveButtonState(true, '設定画面の初期化に失敗しました。');
      setAuthStatus('初期化に失敗しました。画面をリロードしてください。', true);
      alert('対象サブテーブルの取得に失敗しました。');
    }
  }

  addSettingBtn.addEventListener('click', () => {
    state.settings.push(createDefaultSetting());
    renderSettings();
  });

  settingsListEl.addEventListener('input', (event) => {
    const input = event.target.closest('[data-field]');
    const card = event.target.closest('.setting-card');
    if (!input || !card) {
      return;
    }

    const setting = state.settings.find((item) => item.id === card.dataset.settingId);
    if (!setting) {
      return;
    }

    setting[input.dataset.field] = input.value;

    if (input.dataset.field === 'fixedColumns' || input.dataset.field === 'tableFieldCode') {
      updateColumnReference(card, setting);
    }
  });

  settingsListEl.addEventListener('change', (event) => {
    const input = event.target.closest('[data-field]');
    const card = event.target.closest('.setting-card');
    if (!input || !card) {
      return;
    }

    const setting = state.settings.find((item) => item.id === card.dataset.settingId);
    if (!setting) {
      return;
    }

    setting[input.dataset.field] = input.value;

    if (input.dataset.field === 'fixedColumns' || input.dataset.field === 'tableFieldCode') {
      updateColumnReference(card, setting);
    }
  });

  settingsListEl.addEventListener('click', (event) => {
    const removeButton = event.target.closest('[data-action="remove-setting"]');
    const card = event.target.closest('.setting-card');
    if (!removeButton || !card) {
      return;
    }

    state.settings = state.settings.filter((setting) => setting.id !== card.dataset.settingId);
    renderSettings();
  });

  saveBtn.addEventListener('click', () => {
    if (!authState.checked || !authState.isValid) {
      alert(buildReloadPromptMessage('認証が完了していないため保存できません。'));
      return;
    }

    let newConfig;
    try {
      newConfig = buildConfigForSave();
    } catch (err) {
      alert(err.message);
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

  await initialize();
})(kintone.$PLUGIN_ID);
