(async (PLUGIN_ID) => {
  'use strict';

  const ALL_TAB_ID = 'all';

  const config = kintone.plugin.app.getConfig(PLUGIN_ID) || {};
  const authState = {
    checked: false,
    isValid: false,
    trialEndDate: config.Trial_enddate || ''
  };
  const state = {
    fields: [],
    spacers: [],
    tabs: []
  };

  const spaceIdSelect = document.getElementById('space-id-select');
  const spaceIdNoteEl = document.getElementById('space-id-note');
  const addTabBtn = document.getElementById('add-tab-button');
  const tabsListEl = document.getElementById('tabs-list');
  const tabsEmptyEl = document.getElementById('tabs-empty');
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
    return `tab_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function isAllTab(tab) {
    return tab.id === ALL_TAB_ID || tab.includeAllTargets === true || tab.includeAllTargets === 'true';
  }

  function isAllTabEnabled(tab) {
    return tab.enabled !== false && tab.enabled !== 'false';
  }

  function isVisibleTabForRuntime(tab) {
    const normalized = normalizeTab(tab);

    if (isAllTab(normalized) && !normalized.enabled) {
      return false;
    }

    return Boolean(String(normalized.label || '').trim())
      && (isAllTab(normalized) || normalized.fieldCodes.length > 0);
  }

  function createDefaultAllTab() {
    return {
      id: ALL_TAB_ID,
      label: '全項目タブ',
      color: '#9b51e0',
      fieldCodes: [],
      includeAllTargets: true,
      enabled: true
    };
  }

  function createDefaultTab() {
    return {
      id: generateId(),
      label: '',
      color: '#2f80ed',
      fieldCodes: [''],
      includeAllTargets: false
    };
  }

  function normalizeTab(tab) {
    const includeAllTargets = isAllTab(tab);
    let fieldCodes = Array.isArray(tab.fieldCodes) ? tab.fieldCodes.filter(Boolean) : [];

    if (!includeAllTargets && fieldCodes.length === 0) {
      fieldCodes = [''];
    }

    const normalized = {
      id: tab.id || generateId(),
      label: tab.label || '',
      color: /^#[0-9a-fA-F]{6}$/.test(tab.color || '') ? tab.color : '#2f80ed',
      fieldCodes: includeAllTargets ? [] : fieldCodes,
      includeAllTargets
    };

    if (includeAllTargets) {
      normalized.enabled = tab.enabled !== false && tab.enabled !== 'false';
    }

    return normalized;
  }

  function getRegularTabs() {
    return state.tabs.filter((tab) => !isAllTab(tab));
  }

  function getAllTab() {
    return state.tabs.find((tab) => isAllTab(tab)) || normalizeTab(createDefaultAllTab());
  }

  function ensureAllTabExists() {
    if (!state.tabs.some((tab) => isAllTab(tab))) {
      state.tabs.push(normalizeTab(createDefaultAllTab()));
    }
  }

  function cloneDefaultTabs() {
    return [createDefaultTab(), normalizeTab(createDefaultAllTab())];
  }

  function loadFormValues() {
    if (config.tabs) {
      try {
        const parsed = JSON.parse(config.tabs);
        if (Array.isArray(parsed) && parsed.length > 0) {
          state.tabs = parsed.map(normalizeTab);
          return;
        }
      } catch (error) {
        console.error('タブ設定の解析に失敗しました。', error);
      }
    }

    state.tabs = cloneDefaultTabs();
  }

  function renderSpaceSelect() {
    const savedSpaceId = String(config.spaceId || '').trim();
    const options = ['<option value="">-- スペースを選択 --</option>'];

    state.spacers.forEach((elementId) => {
      options.push(`<option value="${escapeHtml(elementId)}">${escapeHtml(elementId)}</option>`);
    });

    if (savedSpaceId && state.spacers.indexOf(savedSpaceId) === -1) {
      options.push(
        `<option value="${escapeHtml(savedSpaceId)}">${escapeHtml(savedSpaceId)}（現在の設定値）</option>`
      );
    }

    spaceIdSelect.innerHTML = options.join('');
    spaceIdSelect.value = savedSpaceId;

    if (state.spacers.length === 0) {
      spaceIdNoteEl.textContent = savedSpaceId
        ? 'フォームからスペースが取得できませんでした。現在の設定値を確認してください。'
        : 'フォームに要素ID付きのスペースがありません。事前準備のとおりスペースを設置してください。';
      return;
    }

    spaceIdNoteEl.textContent = 'フォームに設置したスペースの要素IDから選択してください。';
  }

  async function loadSpacers() {
    const spacers = await KintoneConfigHelper.getFields(['SPACER']);
    state.spacers = spacers
      .map((field) => String(field.elementId || '').trim())
      .filter(Boolean)
      .filter((elementId, index, list) => list.indexOf(elementId) === index)
      .sort((a, b) => a.localeCompare(b, 'ja'));
  }

  function getFieldLabel(fieldCode) {
    const field = state.fields.find((item) => item.code === fieldCode);
    if (!field) {
      return fieldCode;
    }
    return field.label ? `${field.label} (${field.code})` : field.code;
  }

  function getDatalistOptionsHtml() {
    const knownCodes = new Set(state.fields.map((field) => field.code));
    const missingCodes = [];

    state.tabs.forEach((tab) => {
      if (isAllTab(tab)) {
        return;
      }
      tab.fieldCodes.forEach((code) => {
        if (code && !knownCodes.has(code) && missingCodes.indexOf(code) === -1) {
          missingCodes.push(code);
        }
      });
    });

    const optionFields = state.fields.concat(missingCodes.map((code) => ({ code, label: code })));

    return optionFields.map((field) => {
      return `<option value="${escapeHtml(getFieldLabel(field.code))}"></option>`;
    }).join('');
  }

  function resolveFieldCode(inputValue) {
    const trimmed = String(inputValue || '').trim();
    if (!trimmed) {
      return '';
    }

    const exactCode = state.fields.find((field) => field.code === trimmed);
    if (exactCode) {
      return exactCode.code;
    }

    const exactLabel = state.fields.find((field) => {
      return getFieldLabel(field.code) === trimmed;
    });
    if (exactLabel) {
      return exactLabel.code;
    }

    const labelMatch = state.fields.find((field) => {
      return field.label === trimmed;
    });
    if (labelMatch) {
      return labelMatch.code;
    }

    const parenMatch = trimmed.match(/\(([^)]+)\)$/);
    if (parenMatch) {
      const codeFromLabel = parenMatch[1].trim();
      const field = state.fields.find((item) => item.code === codeFromLabel);
      if (field) {
        return field.code;
      }
      return codeFromLabel;
    }

    return trimmed;
  }

  function getFieldRowsHtml(tab) {
    const rows = tab.fieldCodes.length > 0 ? tab.fieldCodes : [''];

    return rows.map((fieldCode, rowIndex) => {
      const displayValue = fieldCode ? getFieldLabel(fieldCode) : '';
      const listId = `field-datalist-${escapeHtml(tab.id)}-${rowIndex}`;
      return `
        <div class="field-row" data-row-index="${rowIndex}">
          <input
            type="text"
            class="kintoneplugin-input-text field-search-input"
            list="${listId}"
            value="${escapeHtml(displayValue)}"
            data-field="fieldCode"
            placeholder="フィールド名またはコードで検索"
            autocomplete="off"
          >
          <datalist id="${listId}">
            ${getDatalistOptionsHtml()}
          </datalist>
          <button type="button" class="field-row-button field-row-remove" data-action="remove-field-row" aria-label="フィールド行を削除">−</button>
        </div>
      `;
    }).join('');
  }

  function syncAllTabsFromDom() {
    state.tabs.forEach((tab) => {
      const card = tabsListEl.querySelector(`.tab-card[data-tab-id="${tab.id}"]`);
      if (!card) {
        return;
      }

      syncFieldCodesFromDom(tab, card);

      const labelInput = card.querySelector('[data-field="label"]');
      const colorInput = card.querySelector('[data-field="color"]');
      const enabledInput = card.querySelector('[data-field="enabled"]');

      if (labelInput) {
        tab.label = labelInput.value;
      }
      if (colorInput) {
        tab.color = colorInput.value;
      }
      if (enabledInput) {
        tab.enabled = enabledInput.checked;
      }
    });
  }

  function moveRegularTab(tabId, direction) {
    syncAllTabsFromDom();

    const regularTabs = getRegularTabs();
    const currentIndex = regularTabs.findIndex((tab) => tab.id === tabId);
    const nextIndex = currentIndex + direction;

    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= regularTabs.length) {
      return;
    }

    const reordered = regularTabs.slice();
    const [movedTab] = reordered.splice(currentIndex, 1);
    reordered.splice(nextIndex, 0, movedTab);
    state.tabs = reordered.concat([getAllTab()]);
    renderTabs();
  }

  function renderTabCard(tab, index, options) {
    const {
      allTab = false,
      hideDelete = false,
      canMoveUp = false,
      canMoveDown = false
    } = options;
    const card = document.createElement('section');
    card.className = 'tab-card';
    if (allTab) {
      card.classList.add('tab-card-all');
    }
    card.dataset.tabId = tab.id;

    const fieldsSection = allTab
      ? `
        <label class="checkbox-item checkbox-inline all-tab-enable">
          <input type="checkbox" data-field="enabled"${tab.enabled !== false ? ' checked' : ''}>
          <span>全項目タブを表示する</span>
        </label>
        <div class="form-field all-tab-note">
          <span class="field-note">有効にすると、他のタブで指定した全フィールドをまとめて表示するタブが追加されます。</span>
        </div>
      `
      : `
        <div class="form-field">
          <div class="field-rows-header">
            <label class="kintoneplugin-label">
              対象フィールド
              <span class="kintoneplugin-require">*</span>
            </label>
            <button type="button" class="field-row-button field-row-add" data-action="add-field-row">＋ フィールドを追加</button>
          </div>
          <div class="field-rows" data-field-rows>
            ${getFieldRowsHtml(tab)}
          </div>
        </div>
      `;

    const reorderButtons = allTab
      ? ''
      : `
        <button type="button" class="tab-move-button" data-action="move-tab-up" aria-label="上へ移動"${canMoveUp ? '' : ' disabled'}>↑</button>
        <button type="button" class="tab-move-button" data-action="move-tab-down" aria-label="下へ移動"${canMoveDown ? '' : ' disabled'}>↓</button>
      `;

    const deleteButton = hideDelete
      ? ''
      : '<button type="button" class="tab-remove-button" data-action="remove-tab">削除</button>';

    card.innerHTML = `
      <div class="tab-card-header">
        <h4>${allTab ? '全項目タブ' : `タブ ${index + 1}`}</h4>
        <div class="tab-card-actions">
          ${reorderButtons}
          ${deleteButton}
        </div>
      </div>
      <div class="form-stack">
        <div class="tab-form-grid">
          <div class="form-field">
            <label class="kintoneplugin-label" for="tab-label-${escapeHtml(tab.id)}">
              タブ名
              <span class="kintoneplugin-require">*</span>
            </label>
            <input type="text" id="tab-label-${escapeHtml(tab.id)}" class="kintoneplugin-input-text" value="${escapeHtml(tab.label)}" data-field="label" placeholder="例: 添付ファイルタブ">
          </div>
          <div class="form-field">
            <label class="kintoneplugin-label" for="tab-color-${escapeHtml(tab.id)}">タブ色</label>
            <input type="color" id="tab-color-${escapeHtml(tab.id)}" class="tab-color-input" value="${escapeHtml(tab.color)}" data-field="color">
          </div>
        </div>
        ${fieldsSection}
      </div>
    `;
    return card;
  }

  function renderTabs() {
    ensureAllTabExists();
    tabsListEl.innerHTML = '';

    const regularTabs = getRegularTabs();
    const allTab = getAllTab();

    tabsEmptyEl.hidden = regularTabs.length > 0;

    regularTabs.forEach((tab, index) => {
      tabsListEl.appendChild(renderTabCard(tab, index, {
        allTab: false,
        hideDelete: false,
        canMoveUp: index > 0,
        canMoveDown: index < regularTabs.length - 1
      }));
    });

    tabsListEl.appendChild(renderTabCard(allTab, 0, { allTab: true, hideDelete: true }));
  }

  function syncFieldCodesFromDom(tab, card) {
    if (isAllTab(tab)) {
      tab.fieldCodes = [];
      return;
    }

    const inputs = Array.from(card.querySelectorAll('.field-search-input'));
    tab.fieldCodes = inputs.map((input) => resolveFieldCode(input.value));
  }

  async function loadFields() {
    const fields = await KintoneConfigHelper.getFields();
    state.fields = fields.filter((field) => {
      return field.code && field.type !== 'SPACER';
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

  function buildConfigForSave() {
    const spaceId = spaceIdSelect.value.trim();
    if (!spaceId) {
      throw new Error('スペースを選択してください。');
    }

    ensureAllTabExists();
    syncAllTabsFromDom();

    const regularTabs = getRegularTabs();
    const allTab = getAllTab();

    if (regularTabs.length === 0 && !isAllTabEnabled(allTab)) {
      throw new Error('タブを1件以上追加するか、全項目タブを有効にしてください。');
    }

    const tabsToSave = getRegularTabs().concat([getAllTab()]);
    const tabs = tabsToSave.map((tab, index) => {
      const label = tab.label.trim();
      const includeAllTargets = isAllTab(tab);
      const fieldCodes = includeAllTargets
        ? []
        : unique(tab.fieldCodes.map((code) => resolveFieldCode(code)).filter(Boolean));

      if (!label) {
        throw new Error(`${includeAllTargets ? '全項目タブ' : `${index + 1}件目`}: タブ名を入力してください。`);
      }

      if (!includeAllTargets && fieldCodes.length === 0) {
        throw new Error(`${index + 1}件目: 対象フィールドを1つ以上指定してください。`);
      }

      const savedTab = {
        id: tab.id,
        label,
        color: /^#[0-9a-fA-F]{6}$/.test(tab.color || '') ? tab.color : '#2f80ed',
        fieldCodes,
        includeAllTargets
      };

      if (includeAllTargets) {
        savedTab.enabled = isAllTabEnabled(tab);
      }

      return savedTab;
    });

    if (tabs.filter(isVisibleTabForRuntime).length === 0) {
      throw new Error('表示できるタブがありません。タブ名・対象フィールド、または全項目タブの有効設定を確認してください。');
    }

    const newConfig = {
      spaceId,
      tabs: JSON.stringify(tabs),
      authStatus: 'valid'
    };

    if (authState.trialEndDate) {
      newConfig.Trial_enddate = authState.trialEndDate;
    }

    return newConfig;
  }

  function unique(values) {
    return values.filter((value, index) => values.indexOf(value) === index);
  }

  async function initialize() {
    try {
      await loadSpacers();
      loadFormValues();
      renderSpaceSelect();
      await loadFields();
      renderTabs();
      await authenticateOnInitialize();
    } catch (error) {
      console.error('設定画面の初期化エラー:', error);
      updateSaveButtonState(true, '設定画面の初期化に失敗しました。');
      setAuthStatus('初期化に失敗しました。画面をリロードしてください。', true);
      alert('フィールド情報の取得に失敗しました。');
    }
  }

  addTabBtn.addEventListener('click', () => {
    ensureAllTabExists();
    syncAllTabsFromDom();
    const allTab = getAllTab();
    state.tabs = getRegularTabs().concat([createDefaultTab(), allTab]);
    renderTabs();
  });

  tabsListEl.addEventListener('input', (event) => {
    const input = event.target.closest('[data-field]');
    const card = event.target.closest('.tab-card');
    if (!input || !card) {
      return;
    }

    const tab = state.tabs.find((item) => item.id === card.dataset.tabId);
    if (!tab) {
      return;
    }

    if (input.dataset.field === 'fieldCode') {
      syncFieldCodesFromDom(tab, card);
      return;
    }

    if (input.dataset.field === 'enabled') {
      tab.enabled = input.checked;
      return;
    }

    tab[input.dataset.field] = input.value;
  });

  tabsListEl.addEventListener('change', (event) => {
    const input = event.target.closest('[data-field]');
    const card = event.target.closest('.tab-card');
    if (!input || !card) {
      return;
    }

    const tab = state.tabs.find((item) => item.id === card.dataset.tabId);
    if (!tab) {
      return;
    }

    if (input.dataset.field === 'fieldCode') {
      syncFieldCodesFromDom(tab, card);
      return;
    }

    if (input.dataset.field === 'enabled') {
      tab.enabled = input.checked;
      return;
    }

    tab[input.dataset.field] = input.value;
  });

  tabsListEl.addEventListener('click', (event) => {
    const card = event.target.closest('.tab-card');
    if (!card) {
      return;
    }

    const tab = state.tabs.find((item) => item.id === card.dataset.tabId);
    if (!tab) {
      return;
    }

    if (event.target.closest('[data-action="move-tab-up"]')) {
      moveRegularTab(tab.id, -1);
      return;
    }

    if (event.target.closest('[data-action="move-tab-down"]')) {
      moveRegularTab(tab.id, 1);
      return;
    }

    if (event.target.closest('[data-action="remove-tab"]')) {
      if (isAllTab(tab)) {
        return;
      }
      syncAllTabsFromDom();
      const allTabItem = getAllTab();
      state.tabs = getRegularTabs().filter((item) => item.id !== card.dataset.tabId).concat([allTabItem]);
      renderTabs();
      return;
    }

    if (event.target.closest('[data-action="add-field-row"]')) {
      syncFieldCodesFromDom(tab, card);
      tab.fieldCodes.push('');
      renderTabs();
      return;
    }

    const removeRowButton = event.target.closest('[data-action="remove-field-row"]');
    if (removeRowButton) {
      syncFieldCodesFromDom(tab, card);
      const row = removeRowButton.closest('.field-row');
      const rowIndex = Number.parseInt(row?.dataset.rowIndex || '-1', 10);

      if (rowIndex >= 0) {
        tab.fieldCodes.splice(rowIndex, 1);
      }

      if (tab.fieldCodes.length === 0) {
        tab.fieldCodes = [''];
      }

      renderTabs();
    }
  });

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

  await initialize();
})(kintone.$PLUGIN_ID);
