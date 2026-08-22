/**
 * スマート一覧プラグイン 設定画面
 * フォーム定義とビュー定義を読み込み、設定を subtableListSetting（JSON文字列）へ保存する。
 */
(async (PLUGIN_ID) => {
  'use strict';

  const DL = window.SubtableList;
  const APP_ID = kintone.app.getId();

  const config = kintone.plugin.app.getConfig(PLUGIN_ID) || {};
  const pluginConfig = DL.parsePluginConfig(config);

  const authState = {
    checked: false,
    isValid: false,
    trialEndDate: config.Trial_enddate || ''
  };

  const el = {
    authStatus: document.getElementById('auth-status'),
    trialStatus: document.getElementById('trial-status'),
    definitionList: document.getElementById('definition-list'),
    definitionAddButton: document.getElementById('definition-add-button'),
    definitionDuplicateButton: document.getElementById('definition-duplicate-button'),
    definitionDeleteButton: document.getElementById('definition-delete-button'),
    viewSelect: document.getElementById('view-select'),
    viewCreateToggle: document.getElementById('view-create-toggle'),
    viewCreatePanel: document.getElementById('view-create-panel'),
    viewNameInput: document.getElementById('view-name-input'),
    viewCreateButton: document.getElementById('view-create-button'),
    viewCreateCancel: document.getElementById('view-create-cancel'),
    viewCreateMessage: document.getElementById('view-create-message'),
    listModeRadios: document.querySelectorAll('input[name="list-mode"]'),
    listModeParent: document.getElementById('list-mode-parent'),
    listModeSubtable: document.getElementById('list-mode-subtable'),
    tableSelectField: document.getElementById('table-select-field'),
    tableSelect: document.getElementById('table-select'),
    snippetText: document.getElementById('snippet-text'),
    snippetCopy: document.getElementById('snippet-copy'),
    columnOrderList: document.getElementById('column-order-list'),
    quickSearchList: document.getElementById('quick-search-list'),
    quickSearchDescription: document.getElementById('quick-search-description'),
    linkColumnSelect: document.getElementById('link-column-select'),
    sortList: document.getElementById('sort-list'),
    addSortButton: document.getElementById('add-sort-button'),
    pageSizeSelect: document.getElementById('page-size-select'),
    densitySelect: document.getElementById('density-select'),
    highlightParentBoundary: document.getElementById('highlight-parent-boundary'),
    parentBoundaryGroup: document.getElementById('parent-boundary-group'),
    maxParentInput: document.getElementById('max-parent-input'),
    maxParentLabel: document.getElementById('max-parent-label'),
    maxDetailInput: document.getElementById('max-detail-input'),
    maxDetailField: document.getElementById('max-detail-field'),
    csvEncodingSelect: document.getElementById('csv-encoding-select'),
    csvFileNameInput: document.getElementById('csv-filename-input'),
    csvDescription: document.getElementById('csv-description'),
    columnColorList: document.getElementById('column-color-list'),
    addColumnColorButton: document.getElementById('add-column-color-button'),
    cellColorList: document.getElementById('cell-color-list'),
    addCellColorButton: document.getElementById('add-cell-color-button'),
    saveButton: document.getElementById('save-button'),
    cancelButton: document.getElementById('cancel-button')
  };

  const state = {
    properties: {},
    layoutOrder: [],
    views: [],
    subtables: [],
    parentCandidates: [],
    tableCandidates: [],
    definitions: pluginConfig.definitions.map((definition) => DL.normalizeDefinition(definition)),
    activeId: pluginConfig.definitions[0].id,
    columnOrder: [],
    visibleKeys: new Set(),
    quickKeys: new Set(),
    sorts: [],
    linkColumnKey: '',
    columnColors: [],
    cellColorRules: []
  };

  /* ------------------------------------------------------------------ *
   * 汎用ヘルパー
   * ------------------------------------------------------------------ */

  const createElement = (tagName, className, text) => {
    const element = document.createElement(tagName);
    if (className) {
      element.className = className;
    }
    if (text !== undefined && text !== null) {
      element.textContent = text;
    }
    return element;
  };

  const setSelectOptions = (select, options, selectedValue) => {
    select.textContent = '';
    options.forEach((option) => {
      const element = document.createElement('option');
      element.value = option.value;
      element.textContent = option.label;
      select.appendChild(element);
    });
    select.value = options.some((option) => option.value === selectedValue)
      ? selectedValue
      : (options.length > 0 ? options[0].value : '');
  };

  const formatFieldLabel = (field) => (field.label && field.label !== field.code
    ? `${field.label}（${field.code}）`
    : field.code);

  const getColumnByKey = (key) => {
    const parsed = DL.parseColumnKey(key);
    if (!parsed) {
      return null;
    }
    const candidates = parsed.scope === DL.SCOPE.PARENT ? state.parentCandidates : state.tableCandidates;
    return candidates.find((field) => field.code === parsed.code) || null;
  };

  const getSelectedColumns = () => state.columnOrder
    .map((key) => {
      const field = getColumnByKey(key);
      if (!field) {
        return null;
      }
      const parsed = DL.parseColumnKey(key);
      return { key, scope: parsed.scope, code: parsed.code, label: field.label || field.code, type: field.type };
    })
    .filter(Boolean);

  // 色付け対象列（FILE・ビルトインリンク列は除外）
  const getColorableColumns = () => getSelectedColumns()
    .filter((column) => column.type !== 'FILE' && DL.getTypeGroup(column.type) !== 'FILE');

  const getFieldProperty = (column) => {
    if (!column) {
      return null;
    }
    if (column.scope === DL.SCOPE.PARENT) {
      return state.properties[column.code] || null;
    }
    const tableCode = el.tableSelect.value;
    const tableProperty = state.properties[tableCode];
    if (!tableProperty || !tableProperty.fields) {
      return null;
    }
    return tableProperty.fields[column.code] || null;
  };

  const getChoiceOptions = (column) => {
    const property = getFieldProperty(column);
    if (!property || !property.options) {
      return [];
    }
    return Object.keys(property.options).map((code) => {
      const option = property.options[code];
      const label = option && option.label ? option.label : code;
      return { value: code, label };
    });
  };

  /* ------------------------------------------------------------------ *
   * 一覧定義の切替
   * ------------------------------------------------------------------ */

  const getActiveDefinition = () => DL.findDefinitionById(state.definitions, state.activeId)
    || state.definitions[0]
    || null;

  const getViewLabel = (viewId) => {
    const view = state.views.find((item) => String(item.id) === String(viewId));
    if (!view) {
      return viewId ? `ビューID: ${viewId}` : 'ビュー未設定';
    }
    return view.name || `ビューID: ${view.id}`;
  };

  const getViewName = (viewId) => {
    const view = state.views.find((item) => String(item.id) === String(viewId));
    return view && view.name ? view.name : '';
  };

  const getDefinitionLabel = (definition, index) => {
    const viewName = getViewName(definition && definition.viewId);
    if (viewName) {
      return viewName;
    }
    if (definition && definition.name) {
      return definition.name;
    }
    return `${(index || 0) + 1}番目の定義`;
  };

  const syncNamesFromView = (definition, viewId) => {
    const viewName = getViewName(viewId);
    definition.viewId = viewId || '';
    definition.name = viewName;
    definition.title = viewName;
  };

  const getSelectedListMode = () => {
    const checked = Array.from(el.listModeRadios).find((radio) => radio.checked);
    return checked && checked.value === DL.LIST_MODE.PARENT
      ? DL.LIST_MODE.PARENT
      : DL.LIST_MODE.SUBTABLE;
  };

  const setSelectedListMode = (listMode) => {
    const value = listMode === DL.LIST_MODE.PARENT ? DL.LIST_MODE.PARENT : DL.LIST_MODE.SUBTABLE;
    Array.from(el.listModeRadios).forEach((radio) => {
      radio.checked = radio.value === value;
    });
  };

  const isParentListMode = () => getSelectedListMode() === DL.LIST_MODE.PARENT;

  const syncModeDependentUi = () => {
    const parentMode = isParentListMode();
    el.tableSelectField.hidden = parentMode;
    el.parentBoundaryGroup.hidden = parentMode;
    el.maxDetailField.hidden = parentMode;
    if (el.maxParentLabel) {
      el.maxParentLabel.textContent = parentMode ? 'レコードの取得上限（件）' : '親レコードの取得上限（件）';
    }
    if (el.quickSearchDescription) {
      el.quickSearchDescription.textContent = parentMode
        ? '一覧上部の検索ボックスで検索する項目です。いずれかに一致したレコードを表示します（OR検索）。'
        : '一覧上部の検索ボックスで検索する項目です。いずれかに一致した明細を表示します（OR検索）。';
    }
    if (el.csvDescription) {
      el.csvDescription.textContent = parentMode
        ? '検索・絞り込み・並び替えの結果を、レコード1件 = CSV1行で出力します。'
        : '検索・絞り込み・並び替えの結果を、明細1行 = CSV1行で出力します。';
    }
  };

  const renderViewSelect = (selectedViewId) => {
    const customViews = state.views.filter((view) => view.type === 'CUSTOM');
    setSelectOptions(el.viewSelect, customViews.length > 0
      ? customViews.map((view) => ({ value: view.id, label: view.name }))
      : [{ value: '', label: '（カスタマイズビューがありません）' }], selectedViewId);
  };

  const flushActiveToDefinition = () => {
    const active = getActiveDefinition();
    if (!active) {
      return;
    }
    const columns = getSelectedColumns();
    const columnKeys = new Set(columns.map((column) => column.key));
    syncNamesFromView(active, el.viewSelect.value);
    active.listMode = getSelectedListMode();
    active.tableCode = active.listMode === DL.LIST_MODE.PARENT ? '' : el.tableSelect.value;
    active.parentFieldCodes = state.parentCandidates.map((field) => field.code);
    active.tableFieldCodes = active.listMode === DL.LIST_MODE.PARENT
      ? []
      : state.tableCandidates.map((field) => field.code);
    active.columnOrder = state.columnOrder.slice();
    active.initialVisibleKeys = state.columnOrder.filter((key) => state.visibleKeys.has(key));
    active.quickSearchKeys = state.columnOrder.filter((key) => state.quickKeys.has(key));
    active.initialSorts = state.sorts
      .filter((sort) => columnKeys.has(sort.key))
      .map((sort) => ({ key: sort.key, dir: sort.dir }));
    active.pageSize = Number(el.pageSizeSelect.value) || active.pageSize;
    active.density = el.densitySelect.value;
    active.highlightParentBoundary = active.listMode === DL.LIST_MODE.PARENT
      ? false
      : !!el.highlightParentBoundary.checked;
    active.maxParentRecords = Number(el.maxParentInput.value) || 5000;
    active.maxDetailRows = Number(el.maxDetailInput.value) || 50000;
    active.linkColumnKey = el.linkColumnSelect.value;
    active.csvEncoding = el.csvEncodingSelect.value;
    active.csvFileName = el.csvFileNameInput.value.trim() || 'スマート一覧_{YYYYMMDD_HHmmss}';
    active.columnColors = DL.normalizeColumnColors(state.columnColors);
    active.cellColorRules = DL.normalizeCellColorRules(state.cellColorRules);
  };

  const applyDefinitionToForm = (definition) => {
    el.maxParentInput.value = String(definition.maxParentRecords);
    el.maxDetailInput.value = String(definition.maxDetailRows);
    el.csvFileNameInput.value = definition.csvFileName || '';
    el.highlightParentBoundary.checked = definition.highlightParentBoundary !== false;
    setSelectedListMode(DL.resolveListMode(definition));

    setSelectOptions(el.pageSizeSelect, DL.PAGE_SIZE_OPTIONS.map((size) => ({
      value: String(size),
      label: `${size}件`
    })), String(definition.pageSize));

    setSelectOptions(el.densitySelect, Object.keys(DL.DENSITY).map((key) => ({
      value: key,
      label: `${DL.DENSITY[key].label}（約${DL.DENSITY[key].rowHeight}px）`
    })), definition.density);

    setSelectOptions(el.csvEncodingSelect, [
      { value: 'UTF-8-BOM', label: 'UTF-8（BOM付き / Excelで開けます）' },
      { value: 'SJIS', label: 'Shift_JIS' }
    ], definition.csvEncoding);

    renderViewSelect(definition.viewId);

    const subtableOptions = state.layoutOrder
      .filter((item) => item.subtableCode)
      .map((item) => item.subtableCode)
      .filter((code, index, codes) => codes.indexOf(code) === index)
      .concat(Object.keys(state.properties).filter((code) => state.properties[code].type === 'SUBTABLE'))
      .filter((code, index, codes) => codes.indexOf(code) === index)
      .filter((code) => state.properties[code] && state.properties[code].type === 'SUBTABLE')
      .map((code) => ({
        value: code,
        label: formatFieldLabel({ code, label: state.properties[code].label })
      }));

    setSelectOptions(el.tableSelect, subtableOptions.length > 0
      ? subtableOptions
      : [{ value: '', label: '（サブテーブルがありません）' }], definition.tableCode);

    state.columnOrder = definition.columnOrder.slice();
    state.visibleKeys = new Set(definition.initialVisibleKeys);
    state.quickKeys = new Set(definition.quickSearchKeys);
    state.sorts = definition.initialSorts.map((sort) => ({ key: sort.key, dir: sort.dir }));
    state.linkColumnKey = definition.linkColumnKey;
    state.columnColors = DL.normalizeColumnColors(definition.columnColors);
    state.cellColorRules = DL.normalizeCellColorRules(definition.cellColorRules);

    syncModeDependentUi();
    renderSnippet();
    renderTableFieldSection();
  };

  const renderDefinitionList = () => {
    el.definitionList.textContent = '';
    state.definitions.forEach((definition, index) => {
      const button = createElement('button', 'definition-list-item');
      button.type = 'button';
      if (definition.id === state.activeId) {
        button.classList.add('is-active');
      }
      button.appendChild(createElement('span', 'definition-list-name', getDefinitionLabel(definition, index)));
      if (!getViewName(definition.viewId)) {
        button.appendChild(createElement('span', 'definition-list-meta', 'ビュー未設定'));
      }
      button.addEventListener('click', () => {
        selectDefinition(definition.id);
      });
      el.definitionList.appendChild(button);
    });
    el.definitionDeleteButton.disabled = state.definitions.length <= 1;
  };

  const selectDefinition = (definitionId) => {
    if (definitionId === state.activeId) {
      return;
    }
    flushActiveToDefinition();
    const next = DL.findDefinitionById(state.definitions, definitionId);
    if (!next) {
      return;
    }
    state.activeId = next.id;
    applyDefinitionToForm(next);
    renderDefinitionList();
  };

  const addDefinition = () => {
    flushActiveToDefinition();
    const created = DL.createEmptyDefinition();
    state.definitions.push(created);
    state.activeId = created.id;
    applyDefinitionToForm(created);
    renderDefinitionList();
  };

  const duplicateDefinition = () => {
    flushActiveToDefinition();
    const active = getActiveDefinition();
    if (!active) {
      return;
    }
    const cloned = DL.normalizeDefinition(Object.assign({}, active, {
      id: DL.createDefinitionId(),
      name: '',
      title: '',
      viewId: ''
    }));
    state.definitions.push(cloned);
    state.activeId = cloned.id;
    applyDefinitionToForm(cloned);
    renderDefinitionList();
  };

  const deleteDefinition = () => {
    if (state.definitions.length <= 1) {
      alert('一覧定義は最低1件必要です。');
      return;
    }
    const active = getActiveDefinition();
    if (!active) {
      return;
    }
    const label = getDefinitionLabel(active, state.definitions.indexOf(active));
    if (!window.confirm(`「${label}」を削除しますか？`)) {
      return;
    }
    state.definitions = state.definitions.filter((definition) => definition.id !== active.id);
    state.activeId = state.definitions[0].id;
    applyDefinitionToForm(state.definitions[0]);
    renderDefinitionList();
  };

  /* ------------------------------------------------------------------ *
   * フォーム定義の読み込み
   * ------------------------------------------------------------------ */

  // レイアウトAPIの順序をそのまま使い、設定画面の並びをフォームの見た目に合わせる
  const flattenLayout = (layout) => {
    const result = [];
    (layout || []).forEach((row) => {
      if (row.type === 'GROUP') {
        result.push(...flattenLayout(row.layout));
        return;
      }
      if (row.type === 'SUBTABLE') {
        (row.fields || []).forEach((field) => result.push({ code: field.code, subtableCode: row.code }));
        return;
      }
      (row.fields || []).forEach((field) => result.push({ code: field.code, subtableCode: null }));
    });
    return result;
  };

  const buildParentCandidates = (tableCode) => {
    const seen = new Set();
    const candidates = [];

    const push = (code) => {
      const property = state.properties[code];
      if (!property || seen.has(code) || code === tableCode) {
        return;
      }
      if (property.type === 'SUBTABLE' || !DL.isSupportedType(property.type)) {
        return;
      }
      seen.add(code);
      candidates.push({ code, label: property.label || code, type: property.type });
    };

    state.layoutOrder.filter((item) => !item.subtableCode).forEach((item) => push(item.code));
    // レコード番号・作成者などレイアウトに現れない組み込みフィールドを補完する
    Object.keys(state.properties).forEach(push);
    return candidates;
  };

  const buildTableCandidates = (tableCode) => {
    const tableProperty = state.properties[tableCode];
    if (!tableProperty || tableProperty.type !== 'SUBTABLE') {
      return [];
    }
    const fields = tableProperty.fields || {};
    const seen = new Set();
    const candidates = [];

    const push = (code) => {
      const property = fields[code];
      if (!property || seen.has(code) || !DL.isSupportedType(property.type)) {
        return;
      }
      seen.add(code);
      candidates.push({ code, label: property.label || code, type: property.type });
    };

    state.layoutOrder.filter((item) => item.subtableCode === tableCode).forEach((item) => push(item.code));
    Object.keys(fields).forEach(push);
    return candidates;
  };

  /* ------------------------------------------------------------------ *
   * 列の選択状態と列順の同期
   * ------------------------------------------------------------------ */

  /**
   * 対応する全項目で columnOrder を作り直す。
   * 既存の並びは保ち、新しく見つかった項目は末尾に追加する。
   */
  const syncColumnOrder = () => {
    const allKeys = []
      .concat(state.parentCandidates.map((field) => DL.makeColumnKey(DL.SCOPE.PARENT, field.code)))
      .concat(state.tableCandidates.map((field) => DL.makeColumnKey(DL.SCOPE.TABLE, field.code)));

    const allSet = new Set(allKeys);
    const next = state.columnOrder.filter((key) => allSet.has(key));
    allKeys.forEach((key) => {
      if (!next.includes(key)) {
        next.push(key);
      }
    });
    state.columnOrder = next;

    Array.from(state.visibleKeys).forEach((key) => {
      if (!allSet.has(key)) {
        state.visibleKeys.delete(key);
      }
    });
    Array.from(state.quickKeys).forEach((key) => {
      if (!allSet.has(key)) {
        state.quickKeys.delete(key);
      }
    });
    state.sorts = state.sorts.filter((sort) => allSet.has(sort.key));
    if (state.linkColumnKey && !allSet.has(state.linkColumnKey)) {
      state.linkColumnKey = '';
    }
    state.columnColors = state.columnColors.filter((item) => allSet.has(item.key));
    state.cellColorRules = state.cellColorRules.filter((item) => allSet.has(item.key));
  };

  /* ------------------------------------------------------------------ *
   * 描画
   * ------------------------------------------------------------------ */

  const renderColumnOrderList = () => {
    const scrollTop = el.columnOrderList.scrollTop;
    el.columnOrderList.textContent = '';
    const columns = getSelectedColumns();
    if (columns.length === 0) {
      el.columnOrderList.appendChild(createElement('p', 'field-note',
        isParentListMode()
          ? '表示できる親レコードの項目が一覧されます。'
          : '対象サブテーブルを選択すると、表示できる項目が一覧されます。'));
      return;
    }

    let draggingKey = null;
    if (!el.columnOrderList._dlScroller) {
      el.columnOrderList._dlScroller = DL.createEdgeAutoScroller(el.columnOrderList);
    }
    const scroller = el.columnOrderList._dlScroller;

    columns.forEach((column) => {
      const item = createElement('div', 'order-item');
      item.draggable = true;
      item.dataset.key = column.key;

      item.appendChild(createElement('span', 'order-handle', '\u2630'));

      const label = createElement('label', 'order-label');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = state.visibleKeys.has(column.key);
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
          state.visibleKeys.add(column.key);
        } else {
          state.visibleKeys.delete(column.key);
        }
      });
      label.appendChild(checkbox);
      label.appendChild(createElement('span', 'order-name', column.label));
      label.appendChild(createElement('span', `scope-tag scope-${column.scope}`, column.scope === DL.SCOPE.PARENT ? '親レコード' : '明細'));
      item.appendChild(label);

      item.addEventListener('dragstart', (event) => {
        draggingKey = column.key;
        item.classList.add('is-dragging');
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', column.key);
        scroller.start();
      });
      item.addEventListener('dragend', () => {
        draggingKey = null;
        item.classList.remove('is-dragging');
        Array.from(el.columnOrderList.children).forEach((child) => child.classList.remove('is-drop-target'));
        scroller.stop();
      });
      item.addEventListener('dragover', (event) => {
        if (!draggingKey || draggingKey === column.key) {
          return;
        }
        event.preventDefault();
        item.classList.add('is-drop-target');
      });
      item.addEventListener('dragleave', () => {
        item.classList.remove('is-drop-target');
      });
      item.addEventListener('drop', (event) => {
        event.preventDefault();
        item.classList.remove('is-drop-target');
        if (!draggingKey || draggingKey === column.key) {
          return;
        }
        const targetIndex = state.columnOrder.indexOf(column.key);
        state.columnOrder = DL.moveKeyInOrder(state.columnOrder, draggingKey, targetIndex);
        draggingKey = null;
        scroller.stop();
        renderColumnDependentUi();
      });

      el.columnOrderList.appendChild(item);
    });

    el.columnOrderList.scrollTop = scrollTop;
  };

  const renderQuickSearchList = () => {
    el.quickSearchList.textContent = '';
    const columns = getSelectedColumns();
    if (columns.length === 0) {
      el.quickSearchList.appendChild(createElement('p', 'field-note', '対象サブテーブルを選択すると、検索対象を選べます。'));
      return;
    }
    const grid = createElement('div', 'checkbox-grid');
    columns.forEach((column) => {
      const item = createElement('label', 'checkbox-item');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = state.quickKeys.has(column.key);
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
          state.quickKeys.add(column.key);
        } else {
          state.quickKeys.delete(column.key);
        }
      });
      item.appendChild(checkbox);
      const label = createElement('span', null, column.label);
      label.appendChild(createElement('em', 'type-tag', column.scope === DL.SCOPE.PARENT ? '親レコード' : '明細'));
      item.appendChild(label);
      grid.appendChild(item);
    });
    el.quickSearchList.appendChild(grid);
  };

  const renderLinkColumnSelect = () => {
    const options = [{ value: '', label: '（専用のリンクアイコン列を追加）' }].concat(
      getSelectedColumns().map((column) => ({
        value: column.key,
        label: `${column.label}（${column.scope === DL.SCOPE.PARENT ? '親レコード' : '明細'}）`
      }))
    );
    setSelectOptions(el.linkColumnSelect, options, state.linkColumnKey);
  };

  const renderSortList = () => {
    el.sortList.textContent = '';
    const columns = getSelectedColumns();
    if (state.sorts.length === 0) {
      el.sortList.appendChild(createElement('p', 'field-note', '指定なし（親レコードの登録順・テーブルの行順）'));
    }

    state.sorts.forEach((sort, index) => {
      const row = createElement('div', 'sort-row');
      row.appendChild(createElement('span', 'sort-index', String(index + 1)));

      const fieldSelect = document.createElement('select');
      fieldSelect.className = 'kintoneplugin-select';
      setSelectOptions(fieldSelect, columns.map((column) => ({ value: column.key, label: column.label })), sort.key);
      fieldSelect.addEventListener('change', () => {
        sort.key = fieldSelect.value;
      });
      row.appendChild(fieldSelect);

      const dirSelect = document.createElement('select');
      dirSelect.className = 'kintoneplugin-select';
      setSelectOptions(dirSelect, [
        { value: 'asc', label: '昇順' },
        { value: 'desc', label: '降順' }
      ], sort.dir);
      dirSelect.addEventListener('change', () => {
        sort.dir = dirSelect.value;
      });
      row.appendChild(dirSelect);

      const removeButton = createElement('button', 'sort-remove', '\u00D7');
      removeButton.type = 'button';
      removeButton.title = 'この並び順を削除';
      removeButton.addEventListener('click', () => {
        state.sorts.splice(index, 1);
        renderSortList();
      });
      row.appendChild(removeButton);

      el.sortList.appendChild(row);
    });

    el.addSortButton.disabled = columns.length === 0 || state.sorts.length >= columns.length;
  };

  const createColorPalette = (selectedColorId, onChange) => {
    const palette = createElement('div', 'color-palette');
    DL.COLOR_PRESET_IDS.forEach((colorId) => {
      const preset = DL.COLOR_PRESETS[colorId];
      const swatch = createElement('button', 'color-swatch');
      swatch.type = 'button';
      swatch.title = preset.label;
      swatch.setAttribute('aria-label', preset.label);
      swatch.dataset.color = colorId;
      swatch.style.background = preset.bg;
      if (colorId === selectedColorId) {
        swatch.classList.add('is-selected');
      }
      swatch.addEventListener('click', () => {
        onChange(colorId);
      });
      palette.appendChild(swatch);
    });
    return palette;
  };

  const createValueEditor = (rule, column, operatorDef) => {
    const wrap = createElement('div', 'color-rule-value');
    if (!operatorDef || operatorDef.valueType === 'none') {
      return wrap;
    }

    const valueType = operatorDef.valueType;
    if (valueType === 'datePreset') {
      const select = document.createElement('select');
      select.className = 'kintoneplugin-select';
      setSelectOptions(select, DL.DATE_PRESET_OPTIONS, rule.value || 'today');
      select.addEventListener('change', () => {
        rule.value = select.value;
      });
      wrap.appendChild(select);
      return wrap;
    }

    if (valueType === 'text' || valueType === 'number' || valueType === 'time') {
      const input = document.createElement('input');
      input.className = 'kintoneplugin-input-text';
      input.type = valueType === 'number' ? 'number' : (valueType === 'time' ? 'time' : 'text');
      input.value = rule.value == null ? '' : String(rule.value);
      input.placeholder = valueType === 'number' ? '数値' : (valueType === 'time' ? '' : '値');
      input.addEventListener('input', () => {
        rule.value = input.value;
      });
      wrap.appendChild(input);
      return wrap;
    }

    if (valueType === 'numberRange' || valueType === 'dateRange' || valueType === 'timeRange') {
      if (!rule.value || typeof rule.value !== 'object') {
        rule.value = { from: '', to: '' };
      }
      const fromInput = document.createElement('input');
      fromInput.className = 'kintoneplugin-input-text';
      fromInput.type = valueType === 'numberRange' ? 'number' : (valueType === 'dateRange' ? 'date' : 'time');
      fromInput.value = rule.value.from || '';
      fromInput.placeholder = 'から';
      fromInput.addEventListener('input', () => {
        rule.value.from = fromInput.value;
      });
      const toInput = document.createElement('input');
      toInput.className = 'kintoneplugin-input-text';
      toInput.type = fromInput.type;
      toInput.value = rule.value.to || '';
      toInput.placeholder = 'まで';
      toInput.addEventListener('input', () => {
        rule.value.to = toInput.value;
      });
      wrap.appendChild(fromInput);
      wrap.appendChild(createElement('span', 'color-rule-range-sep', '〜'));
      wrap.appendChild(toInput);
      return wrap;
    }

    if (valueType === 'tokens') {
      if (!Array.isArray(rule.value)) {
        rule.value = [];
      }
      const choiceOptions = DL.getTypeGroup(column.type) === 'CHOICE' ? getChoiceOptions(column) : [];
      if (choiceOptions.length > 0) {
        const box = createElement('div', 'color-token-checks');
        choiceOptions.forEach((option) => {
          const label = createElement('label', 'color-token-check');
          const checkbox = document.createElement('input');
          checkbox.type = 'checkbox';
          checkbox.checked = rule.value.indexOf(option.value) >= 0;
          checkbox.addEventListener('change', () => {
            if (checkbox.checked) {
              if (rule.value.indexOf(option.value) < 0) {
                rule.value.push(option.value);
              }
            } else {
              rule.value = rule.value.filter((token) => token !== option.value);
            }
          });
          label.appendChild(checkbox);
          label.appendChild(document.createTextNode(option.label));
          box.appendChild(label);
        });
        wrap.appendChild(box);
        return wrap;
      }

      const input = document.createElement('input');
      input.className = 'kintoneplugin-input-text';
      input.type = 'text';
      input.value = rule.value.join(', ');
      input.placeholder = '値をカンマ区切りで入力';
      input.addEventListener('input', () => {
        rule.value = input.value
          .split(',')
          .map((token) => token.trim())
          .filter(Boolean);
      });
      wrap.appendChild(input);
      return wrap;
    }

    return wrap;
  };

  const renderColumnColorList = () => {
    el.columnColorList.textContent = '';
    const columns = getColorableColumns();
    if (state.columnColors.length === 0) {
      el.columnColorList.appendChild(createElement('p', 'field-note', '指定なし（列の固定色なし）'));
    }

    state.columnColors.forEach((item, index) => {
      const row = createElement('div', 'color-rule-row');
      const fieldSelect = document.createElement('select');
      fieldSelect.className = 'kintoneplugin-select';
      setSelectOptions(fieldSelect, columns.map((column) => ({
        value: column.key,
        label: `${column.label}（${column.scope === DL.SCOPE.PARENT ? '親' : '明細'}）`
      })), item.key);
      fieldSelect.addEventListener('change', () => {
        item.key = fieldSelect.value;
      });
      row.appendChild(fieldSelect);

      row.appendChild(createColorPalette(item.colorId, (colorId) => {
        item.colorId = colorId;
        renderColumnColorList();
      }));

      const removeButton = createElement('button', 'sort-remove', '\u00D7');
      removeButton.type = 'button';
      removeButton.title = 'この固定色を削除';
      removeButton.addEventListener('click', () => {
        state.columnColors.splice(index, 1);
        renderColumnColorList();
      });
      row.appendChild(removeButton);
      el.columnColorList.appendChild(row);
    });

    el.addColumnColorButton.disabled = columns.length === 0;
  };

  const renderCellColorList = () => {
    el.cellColorList.textContent = '';
    const columns = getColorableColumns().filter((column) => DL.isFilterableType(column.type));
    if (state.cellColorRules.length === 0) {
      el.cellColorList.appendChild(createElement('p', 'field-note', '指定なし（条件付きセル色なし）'));
    }

    state.cellColorRules.forEach((rule, index) => {
      const column = columns.find((item) => item.key === rule.key) || columns[0] || null;
      if (column && rule.key !== column.key) {
        rule.key = column.key;
        rule.op = DL.getDefaultColorOperator(column.type);
        rule.value = DL.createEmptyValue(column.type, rule.op);
      }

      const row = createElement('div', 'color-rule-row color-rule-row-condition');
      row.appendChild(createElement('span', 'sort-index', String(index + 1)));

      const fieldSelect = document.createElement('select');
      fieldSelect.className = 'kintoneplugin-select';
      setSelectOptions(fieldSelect, columns.map((item) => ({
        value: item.key,
        label: `${item.label}（${item.scope === DL.SCOPE.PARENT ? '親' : '明細'}）`
      })), rule.key);
      fieldSelect.addEventListener('change', () => {
        const next = columns.find((item) => item.key === fieldSelect.value);
        rule.key = fieldSelect.value;
        if (next) {
          rule.op = DL.getDefaultColorOperator(next.type);
          rule.value = DL.createEmptyValue(next.type, rule.op);
        }
        renderCellColorList();
      });
      row.appendChild(fieldSelect);

      const currentColumn = columns.find((item) => item.key === rule.key);
      const operators = currentColumn ? DL.getColorOperators(currentColumn.type) : [];
      if (currentColumn && !operators.some((item) => item.op === rule.op)) {
        rule.op = DL.getDefaultColorOperator(currentColumn.type);
        rule.value = DL.createEmptyValue(currentColumn.type, rule.op);
      }
      const opSelect = document.createElement('select');
      opSelect.className = 'kintoneplugin-select';
      setSelectOptions(opSelect, operators.map((item) => ({ value: item.op, label: item.label })), rule.op);
      opSelect.addEventListener('change', () => {
        rule.op = opSelect.value;
        if (currentColumn) {
          rule.value = DL.createEmptyValue(currentColumn.type, rule.op);
        }
        renderCellColorList();
      });
      row.appendChild(opSelect);

      const operatorDef = currentColumn ? DL.getOperatorDefinition(currentColumn.type, rule.op) : null;
      if (currentColumn) {
        row.appendChild(createValueEditor(rule, currentColumn, operatorDef));
      }

      row.appendChild(createColorPalette(rule.colorId, (colorId) => {
        rule.colorId = colorId;
        renderCellColorList();
      }));

      const removeButton = createElement('button', 'sort-remove', '\u00D7');
      removeButton.type = 'button';
      removeButton.title = 'この条件色を削除';
      removeButton.addEventListener('click', () => {
        state.cellColorRules.splice(index, 1);
        renderCellColorList();
      });
      row.appendChild(removeButton);
      el.cellColorList.appendChild(row);
    });

    el.addCellColorButton.disabled = columns.length === 0;
  };

  const renderSnippet = () => {
    el.snippetText.textContent = `<div id="${DL.DEFAULT_CONTAINER_ID}"></div>`;
  };

  // 列の選択・並び順に依存するUIをまとめて再描画する
  const renderColumnDependentUi = () => {
    renderColumnOrderList();
    renderQuickSearchList();
    renderLinkColumnSelect();
    renderSortList();
    renderColumnColorList();
    renderCellColorList();
  };

  const renderTableFieldSection = () => {
    const parentMode = isParentListMode();
    const tableCode = parentMode ? '' : el.tableSelect.value;
    state.tableCandidates = parentMode ? [] : buildTableCandidates(tableCode);
    state.parentCandidates = buildParentCandidates(tableCode);
    syncColumnOrder();
    renderColumnDependentUi();
  };

  /* ------------------------------------------------------------------ *
   * 初期化
   * ------------------------------------------------------------------ */

  const initializeForm = async () => {
    renderSnippet();

    const [properties, layout, views] = await Promise.all([
      DL.fetchFormFields(APP_ID, true),
      DL.fetchFormLayout(APP_ID).catch(() => []),
      DL.fetchViews(APP_ID, true).catch(() => [])
    ]);
    state.properties = properties;
    state.layoutOrder = flattenLayout(layout);
    state.views = views;

    const active = getActiveDefinition() || state.definitions[0];
    state.activeId = active.id;
    applyDefinitionToForm(active);
    renderDefinitionList();
  };

  const setViewCreateMessage = (message, type) => {
    el.viewCreateMessage.textContent = message || '';
    el.viewCreateMessage.classList.toggle('is-error', type === 'error');
    el.viewCreateMessage.classList.toggle('is-success', type === 'success');
  };

  const setViewCreateBusy = (busy) => {
    el.viewNameInput.disabled = busy;
    el.viewCreateButton.disabled = busy;
    el.viewCreateCancel.disabled = busy;
    el.viewCreateToggle.disabled = busy;
    el.viewCreateButton.textContent = busy ? '作成中...' : '作成';
  };

  const createCustomView = async () => {
    const viewName = (el.viewNameInput.value || '').trim();
    if (!viewName) {
      setViewCreateMessage('ビューの名前を入力してください。', 'error');
      el.viewNameInput.focus();
      return;
    }
    if (Array.from(viewName).length > 64) {
      setViewCreateMessage('ビューの名前は64文字以内で入力してください。', 'error');
      el.viewNameInput.focus();
      return;
    }
    if (state.views.some((view) => view.name === viewName)) {
      setViewCreateMessage(`「${viewName}」という名前の一覧はすでに存在します。`, 'error');
      el.viewNameInput.focus();
      return;
    }

    setViewCreateBusy(true);
    setViewCreateMessage('カスタマイズビューを作成しています。', '');
    try {
      await DL.createCustomView(APP_ID, viewName, `<div id="${DL.DEFAULT_CONTAINER_ID}"></div>`);
      state.views = await DL.fetchViews(APP_ID, true);
      const createdView = state.views.find((view) => view.type === 'CUSTOM' && view.name === viewName);
      if (!createdView) {
        throw new Error('作成したビューを取得できませんでした。設定画面を再読み込みしてください。');
      }

      const active = getActiveDefinition();
      if (active) {
        syncNamesFromView(active, createdView.id);
      }
      renderViewSelect(createdView.id);
      renderDefinitionList();
      el.viewNameInput.value = '';
      setViewCreateMessage(`「${viewName}」を作成し、この定義に選択しました。設定保存後、アプリの設定を更新してください。`, 'success');
    } catch (error) {
      console.error('カスタマイズビュー作成エラー:', error);
      setViewCreateMessage(
        error.message || 'カスタマイズビューを作成できませんでした。アプリ管理権限を確認してください。',
        'error'
      );
      el.viewNameInput.focus();
    } finally {
      setViewCreateBusy(false);
    }
  };

  /* ------------------------------------------------------------------ *
   * 保存
   * ------------------------------------------------------------------ */

  const collectPluginConfig = () => {
    flushActiveToDefinition();
    return {
      definitions: state.definitions.map((definition) => DL.normalizeDefinition(definition))
    };
  };

  /**
   * 入力の誤りを、該当する定義・タブ・入力欄まで案内してから中断する。
   * focusTarget は要素、または保存後に要素を取り直す関数を渡す。
   */
  const failValidation = (definition, tabName, message, focusTarget) => {
    state.activeId = definition.id;
    applyDefinitionToForm(definition);
    renderDefinitionList();
    switchConfigTab(tabName);

    const error = new Error(message);
    error.focusTarget = focusTarget;
    throw error;
  };

  const validatePluginConfig = (nextConfig) => {
    if (!nextConfig.definitions || nextConfig.definitions.length === 0) {
      throw new Error('一覧定義がありません。左の「＋ 追加」で一覧定義を1件以上作成してください。');
    }

    // 同じカスタマイズビューを2つの定義に割り当てていないか調べる
    const usedViews = new Map();
    const customViews = state.views.filter((view) => view.type === 'CUSTOM');
    const customViewIds = new Set(customViews.map((view) => String(view.id)));

    nextConfig.definitions.forEach((definition, index) => {
      const label = getDefinitionLabel(definition, index);

      if (!definition.viewId) {
        const message = customViews.length === 0
          ? `定義「${label}」を表示するカスタマイズビューがありません。\nアプリの設定でカスタマイズビューを1つ作成し、この画面を再読み込みしてから選択してください。`
          : `${index + 1}番目の定義の「対象のカスタマイズビュー」が選ばれていません。\nこの一覧を表示したいカスタマイズビューを選択してください。`;
        failValidation(definition, 'basic', message, el.viewSelect);
      }

      if (customViewIds.size > 0 && !customViewIds.has(String(definition.viewId))) {
        failValidation(definition, 'basic',
          `定義「${label}」に設定されたカスタマイズビュー（ID: ${definition.viewId}）が、このアプリに見つかりません。\n削除された可能性があります。「対象のカスタマイズビュー」を選び直してください。`,
          el.viewSelect);
      }

      const viewKey = String(definition.viewId);
      if (usedViews.has(viewKey)) {
        failValidation(definition, 'basic',
          `カスタマイズビュー「${getViewLabel(definition.viewId)}」が、定義「${usedViews.get(viewKey)}」と定義「${label}」の2つに設定されています。\n1つのカスタマイズビューに表示できる一覧定義は1つだけです。\nこの定義の「対象のカスタマイズビュー」を別のビューに変更するか、不要な定義を削除してください。`,
          el.viewSelect);
      }
      usedViews.set(viewKey, label);

      const parentMode = DL.isParentListMode(definition);
      if (!parentMode && !definition.tableCode) {
        failValidation(definition, 'basic',
          `定義「${label}」の「サブテーブル」が選ばれていません。\n1行を1レコードとして展開するサブテーブルを選択してください。`,
          el.tableSelect);
      }

      if (!parentMode && (!definition.tableFieldCodes || definition.tableFieldCodes.length === 0)) {
        failValidation(definition, 'basic',
          `定義「${label}」で選んだサブテーブル「${definition.tableCode}」に、一覧へ表示できる項目がありません。\nアプリのフォーム設定でサブテーブル内に項目を追加するか、別のサブテーブルを選択してください。`,
          el.tableSelect);
      }

      if (parentMode && (!definition.parentFieldCodes || definition.parentFieldCodes.length === 0)) {
        failValidation(definition, 'basic',
          `定義「${label}」に、一覧へ表示できる親レコードの項目がありません。\nアプリのフォーム設定に表示可能な項目があるか確認してください。`,
          el.listModeParent);
      }

      if (definition.maxParentRecords < 1) {
        failValidation(definition, 'advanced',
          parentMode
            ? `定義「${label}」の「レコードの取得上限」に1以上の件数を入力してください。`
            : `定義「${label}」の「親レコードの取得上限」に1以上の件数を入力してください。`,
          el.maxParentInput);
      }

      if (!parentMode && definition.maxDetailRows < 1) {
        failValidation(definition, 'advanced',
          `定義「${label}」の「明細の表示上限」に1以上の行数を入力してください。`,
          el.maxDetailInput);
      }

      definition.initialSorts.forEach((sort, sortIndex) => {
        if (!sort.key) {
          failValidation(definition, 'advanced',
            `定義「${label}」の「初期の並び順」${sortIndex + 1}行目に、並べ替えるフィールドが選ばれていません。\nフィールドを選ぶか、行右端の × ボタンでこの行を削除してください。`,
            () => {
              const row = el.sortList.querySelectorAll('.sort-row')[sortIndex];
              return row ? row.querySelector('select') : el.addSortButton;
            });
        }
      });

      const colorableKeys = new Set(
        []
          .concat(definition.parentFieldCodes || [])
          .map((code) => DL.makeColumnKey(DL.SCOPE.PARENT, code))
          .concat((definition.tableFieldCodes || []).map((code) => DL.makeColumnKey(DL.SCOPE.TABLE, code)))
      );

      (definition.columnColors || []).forEach((item, colorIndex) => {
        if (!item.key || !colorableKeys.has(item.key)) {
          failValidation(definition, 'advanced',
            `定義「${label}」の「列の固定色」${colorIndex + 1}行目の列が不正です。\n列を選び直すか、行を削除してください。`,
            () => {
              const row = el.columnColorList.querySelectorAll('.color-rule-row')[colorIndex];
              return row ? row.querySelector('select') : el.addColumnColorButton;
            });
        }
        if (!DL.isColorPresetId(item.colorId)) {
          failValidation(definition, 'advanced',
            `定義「${label}」の「列の固定色」${colorIndex + 1}行目の色が不正です。`,
            el.addColumnColorButton);
        }
      });

      (definition.cellColorRules || []).forEach((rule, ruleIndex) => {
        if (!rule.key || !colorableKeys.has(rule.key)) {
          failValidation(definition, 'advanced',
            `定義「${label}」の「条件付きセル色」${ruleIndex + 1}行目の列が不正です。\n列を選び直すか、行を削除してください。`,
            () => {
              const row = el.cellColorList.querySelectorAll('.color-rule-row')[ruleIndex];
              return row ? row.querySelector('select') : el.addCellColorButton;
            });
        }
        const parsed = DL.parseColumnKey(rule.key);
        let type = '';
        if (parsed) {
          if (parsed.scope === DL.SCOPE.PARENT && state.properties[parsed.code]) {
            type = state.properties[parsed.code].type;
          } else if (parsed.scope === DL.SCOPE.TABLE) {
            const tableProperty = state.properties[definition.tableCode];
            if (tableProperty && tableProperty.fields && tableProperty.fields[parsed.code]) {
              type = tableProperty.fields[parsed.code].type;
            }
          }
        }
        if (type === 'FILE' || !DL.isFilterableType(type)) {
          failValidation(definition, 'advanced',
            `定義「${label}」の「条件付きセル色」${ruleIndex + 1}行目は、色付けできない列です。`,
            el.addCellColorButton);
        }
        if (!DL.getColorOperators(type).some((item) => item.op === rule.op)) {
          failValidation(definition, 'advanced',
            `定義「${label}」の「条件付きセル色」${ruleIndex + 1}行目の演算子が不正です。`,
            () => {
              const row = el.cellColorList.querySelectorAll('.color-rule-row')[ruleIndex];
              return row ? row.querySelectorAll('select')[1] : el.addCellColorButton;
            });
        }
        if (!DL.isColorPresetId(rule.colorId)) {
          failValidation(definition, 'advanced',
            `定義「${label}」の「条件付きセル色」${ruleIndex + 1}行目の色が不正です。`,
            el.addCellColorButton);
        }
        const columnMeta = { key: rule.key, type };
        if (!DL.isConditionActive(rule, columnMeta)) {
          failValidation(definition, 'advanced',
            `定義「${label}」の「条件付きセル色」${ruleIndex + 1}行目の条件値が未入力です。\n値を入力するか、行を削除してください。`,
            () => {
              const row = el.cellColorList.querySelectorAll('.color-rule-row')[ruleIndex];
              return row ? (row.querySelector('input') || row.querySelector('select')) : el.addCellColorButton;
            });
        }
      });
    });
  };

  /**
   * エラーダイアログを閉じた後に、直すべき入力欄へ移動して目立たせる。
   */
  const focusInvalidField = (focusTarget) => {
    const element = typeof focusTarget === 'function' ? focusTarget() : focusTarget;
    if (!element || typeof element.focus !== 'function') {
      return;
    }
    if (typeof element.scrollIntoView === 'function') {
      element.scrollIntoView({ block: 'center' });
    }
    element.focus();
    element.classList.add('is-invalid');

    const clearHighlight = () => {
      element.classList.remove('is-invalid');
      element.removeEventListener('input', clearHighlight);
      element.removeEventListener('change', clearHighlight);
      element.removeEventListener('blur', clearHighlight);
    };
    element.addEventListener('input', clearHighlight);
    element.addEventListener('change', clearHighlight);
    element.addEventListener('blur', clearHighlight);
  };

  /* ------------------------------------------------------------------ *
   * 認証
   * ------------------------------------------------------------------ */

  const buildReloadPromptMessage = (message) => `${message}\n設定内容を確認後、画面をリロードして再試行してください。`;

  const updateSaveButtonState = (isBlocked, title = '') => {
    el.saveButton.disabled = isBlocked;
    el.saveButton.setAttribute('aria-disabled', isBlocked ? 'true' : 'false');
    if (title) {
      el.saveButton.title = title;
      return;
    }
    el.saveButton.removeAttribute('title');
  };

  const setAuthStatus = (message, isError) => {
    el.authStatus.textContent = message;
    el.authStatus.classList.toggle('is-error', Boolean(isError));
  };

  const formatTrialEndDate = (trialEndDate) => {
    const match = String(trialEndDate).match(/^(\d{4})[-/]?(\d{2})[-/]?(\d{2})$/);
    if (!match) {
      return '';
    }
    return `${Number(match[2])}月${Number(match[3])}日`;
  };

  const setTrialStatus = (trialEndDate) => {
    const formattedDate = formatTrialEndDate(trialEndDate);
    if (!formattedDate) {
      el.trialStatus.hidden = true;
      el.trialStatus.textContent = '';
      return;
    }
    el.trialStatus.textContent = `トライアル中（～${formattedDate}まで）`;
    el.trialStatus.hidden = false;
  };

  const authenticateOnInitialize = async () => {
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
        setTrialStatus(authState.trialEndDate);
        return true;
      }

      const message = data.response?.message || '不明なエラー';
      authState.checked = true;
      authState.isValid = false;
      updateSaveButtonState(true, '認証に失敗したため保存できません。');
      setAuthStatus(`認証失敗: ${message}`, true);
      setTrialStatus('');
      alert(buildReloadPromptMessage(`認証失敗: ${message}`));
      return false;
    } catch (error) {
      console.error('起動時認証エラー:', error);
      authState.checked = true;
      authState.isValid = false;
      updateSaveButtonState(true, '認証に失敗したため保存できません。');
      setAuthStatus('認証中にエラーが発生しました。', true);
      setTrialStatus('');
      alert(buildReloadPromptMessage('認証中にエラーが発生しました。'));
      return false;
    }
  };

  /* ------------------------------------------------------------------ *
   * イベント
   * ------------------------------------------------------------------ */

  Array.from(el.listModeRadios).forEach((radio) => {
    radio.addEventListener('change', () => {
      // モード切替時は明細列を外し、親項目の並びは可能な限り維持する
      const parentKeys = new Set(state.parentCandidates.map((field) => DL.makeColumnKey(DL.SCOPE.PARENT, field.code)));
      state.columnOrder = state.columnOrder.filter((key) => parentKeys.has(key));
      Array.from(state.visibleKeys).forEach((key) => {
        if (!parentKeys.has(key)) {
          state.visibleKeys.delete(key);
        }
      });
      Array.from(state.quickKeys).forEach((key) => {
        if (!parentKeys.has(key)) {
          state.quickKeys.delete(key);
        }
      });
      state.sorts = state.sorts.filter((sort) => parentKeys.has(sort.key));
      if (state.linkColumnKey && !parentKeys.has(state.linkColumnKey)) {
        state.linkColumnKey = '';
      }
      if (isParentListMode()) {
        el.highlightParentBoundary.checked = false;
      } else if (!el.highlightParentBoundary.checked) {
        el.highlightParentBoundary.checked = true;
      }
      syncModeDependentUi();
      renderTableFieldSection();
    });
  });

  el.tableSelect.addEventListener('change', () => {
    // サブテーブル変更時は明細側の列順・表示を作り直す（親項目の並びは可能な限り維持）
    const parentKeys = new Set(state.parentCandidates.map((field) => DL.makeColumnKey(DL.SCOPE.PARENT, field.code)));
    state.columnOrder = state.columnOrder.filter((key) => parentKeys.has(key));
    Array.from(state.visibleKeys).forEach((key) => {
      if (!parentKeys.has(key)) {
        state.visibleKeys.delete(key);
      }
    });
    Array.from(state.quickKeys).forEach((key) => {
      if (!parentKeys.has(key)) {
        state.quickKeys.delete(key);
      }
    });
    state.sorts = state.sorts.filter((sort) => parentKeys.has(sort.key));
    if (state.linkColumnKey && !parentKeys.has(state.linkColumnKey)) {
      state.linkColumnKey = '';
    }
    renderTableFieldSection();
  });

  el.definitionAddButton.addEventListener('click', addDefinition);
  el.definitionDuplicateButton.addEventListener('click', duplicateDefinition);
  el.definitionDeleteButton.addEventListener('click', deleteDefinition);

  el.viewSelect.addEventListener('change', () => {
    const active = getActiveDefinition();
    if (!active) {
      return;
    }
    syncNamesFromView(active, el.viewSelect.value);
    renderDefinitionList();
  });

  el.viewCreateToggle.addEventListener('click', () => {
    el.viewCreatePanel.hidden = false;
    setViewCreateMessage('', '');
    el.viewNameInput.focus();
  });

  el.viewCreateCancel.addEventListener('click', () => {
    el.viewCreatePanel.hidden = true;
    el.viewNameInput.value = '';
    setViewCreateMessage('', '');
    el.viewCreateToggle.focus();
  });

  el.viewCreateButton.addEventListener('click', createCustomView);
  el.viewNameInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      createCustomView();
    } else if (event.key === 'Escape') {
      el.viewCreateCancel.click();
    }
  });

  el.snippetCopy.addEventListener('click', async () => {
    const text = el.snippetText.textContent;
    try {
      await navigator.clipboard.writeText(text);
      el.snippetCopy.textContent = 'コピーしました';
      window.setTimeout(() => {
        el.snippetCopy.textContent = 'コピー';
      }, 1500);
    } catch (error) {
      alert(`コピーできませんでした。次の内容を手動でコピーしてください。\n${text}`);
    }
  });

  el.linkColumnSelect.addEventListener('change', () => {
    state.linkColumnKey = el.linkColumnSelect.value;
  });

  el.addSortButton.addEventListener('click', () => {
    const columns = getSelectedColumns();
    const used = new Set(state.sorts.map((sort) => sort.key));
    const next = columns.find((column) => !used.has(column.key));
    if (!next) {
      return;
    }
    state.sorts.push({ key: next.key, dir: 'asc' });
    renderSortList();
  });

  el.addColumnColorButton.addEventListener('click', () => {
    const columns = getColorableColumns();
    if (columns.length === 0) {
      return;
    }
    const used = new Set(state.columnColors.map((item) => item.key));
    const next = columns.find((column) => !used.has(column.key)) || columns[0];
    state.columnColors.push({
      key: next.key,
      colorId: DL.COLOR_PRESET_IDS[0]
    });
    renderColumnColorList();
  });

  el.addCellColorButton.addEventListener('click', () => {
    const columns = getColorableColumns().filter((column) => DL.isFilterableType(column.type));
    if (columns.length === 0) {
      return;
    }
    const column = columns[0];
    const op = DL.getDefaultColorOperator(column.type);
    state.cellColorRules.push({
      id: DL.createColorRuleId(),
      key: column.key,
      op,
      value: DL.createEmptyValue(column.type, op),
      colorId: DL.COLOR_PRESET_IDS[0]
    });
    renderCellColorList();
  });

  el.saveButton.addEventListener('click', () => {
    if (!authState.checked || !authState.isValid) {
      alert(buildReloadPromptMessage('認証が完了していないため保存できません。'));
      return;
    }

    try {
      const nextConfig = collectPluginConfig();
      validatePluginConfig(nextConfig);

      const newConfig = {
        [DL.CONFIG_KEY]: JSON.stringify(nextConfig),
        authStatus: 'valid'
      };
      if (authState.trialEndDate) {
        newConfig.Trial_enddate = authState.trialEndDate;
      }

      kintone.plugin.app.setConfig(newConfig, () => {
        alert('設定を保存しました。');
        window.location.href = `/k/admin/app/${APP_ID}/plugin/`;
      });
    } catch (error) {
      console.error('設定保存エラー:', error);
      alert(error.message || '設定保存中にエラーが発生しました。');
      focusInvalidField(error.focusTarget);
    }
  });

  el.cancelButton.addEventListener('click', () => {
    window.location.href = `/k/admin/app/${APP_ID}/plugin/`;
  });

  // 基本設定 / 詳細設定のタブ切り替え
  const switchConfigTab = (tabName) => {
    document.querySelectorAll('.config-tab').forEach((tab) => {
      const isActive = tab.dataset.tab === tabName;
      tab.classList.toggle('is-active', isActive);
      tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
    document.querySelectorAll('.config-tab-panel').forEach((panel) => {
      const isActive = panel.id === `panel-${tabName}`;
      panel.classList.toggle('is-active', isActive);
      panel.hidden = !isActive;
    });
  };

  document.querySelectorAll('.config-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      switchConfigTab(tab.dataset.tab);
    });
  });

  try {
    await initializeForm();
    await authenticateOnInitialize();
  } catch (error) {
    console.error(error);
    updateSaveButtonState(true, '初期化に失敗しました。');
    setAuthStatus('初期化に失敗しました。画面をリロードしてください。', true);
    alert(`設定画面の初期化に失敗しました。\n${(error && error.message) || ''}`);
  }
})(kintone.$PLUGIN_ID);
