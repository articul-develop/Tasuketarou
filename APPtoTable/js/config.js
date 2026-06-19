(async (PLUGIN_ID) => {
  'use strict';

  const MAX_CONDITIONS = 20;
  const MAX_MAPPINGS = 20;
  const TARGET_SCOPE = {
    RECORD: 'record',
    TABLE: 'table'
  };
  const currentAppId = kintone.app.getId();
  const config = kintone.plugin.app.getConfig(PLUGIN_ID) || {};

  const elements = {
    sourceAppId: document.getElementById('sourceAppId'),
    sourceTableFieldCode: document.getElementById('sourceTableFieldCode'),
    conditionEditor: document.getElementById('condition-editor'),
    addConditionButton: document.getElementById('add-condition-button'),
    mappingEditor: document.getElementById('mapping-editor'),
    addMappingButton: document.getElementById('add-mapping-button'),
    autoMappingButton: document.getElementById('auto-mapping-button'),
    suppressSuccessMessage: document.getElementById('suppressSuccessMessage'),
    fetchFieldsButton: document.getElementById('fetch-fields-button'),
    saveButton: document.getElementById('save-button'),
    cancelButton: document.getElementById('cancel-button')
  };

  let currentFormProperties = null;
  let currentLayoutFields = null;
  let sourceNormalDefinitions = [];
  let targetRecordDefinitions = [];
  let targetTableDefinitions = [];
  let updateConditions = getSavedUpdateConditions(config);
  let fieldMappings = getSavedFieldMappings(config);
  const authState = {
    checked: false,
    isValid: false,
    trialEndDate: config.Trial_enddate || ''
  };

  elements.suppressSuccessMessage.checked = config.suppressSuccessMessage === 'true';

  function buildReloadPromptMessage(message) {
    return `${message}\n設定内容を確認後、画面をリロードして再試行してください。`;
  }

  function updateSaveButtonState(isBlocked, title = '') {
    elements.saveButton.setAttribute('aria-disabled', isBlocked ? 'true' : 'false');
    elements.saveButton.disabled = isBlocked;
    if (title) {
      elements.saveButton.title = title;
      return;
    }
    elements.saveButton.removeAttribute('title');
  }

  function formatFieldDisplayName(label, code) {
    return `${label || code}（${code}）`;
  }

  function createEmptyCondition() {
    return {
      sourceFieldCode: '',
      operator: '=',
      targetScope: TARGET_SCOPE.RECORD,
      targetFieldCode: ''
    };
  }

  function createEmptyMapping() {
    return {
      sourceFieldCode: '',
      targetScope: TARGET_SCOPE.RECORD,
      targetFieldCode: ''
    };
  }

  function parseJsonArray(jsonText) {
    if (!jsonText) {
      return [];
    }

    try {
      const parsed = JSON.parse(jsonText);
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      console.warn('JSON設定の解析に失敗しました。', error);
      return [];
    }
  }

  function normalizeTargetScope(scope) {
    return scope === TARGET_SCOPE.TABLE ? TARGET_SCOPE.TABLE : TARGET_SCOPE.RECORD;
  }

  function getSavedUpdateConditions(configObject) {
    const newConditions = parseJsonArray(configObject.updateConditionsJson);
    if (newConditions.length > 0) {
      return newConditions.slice(0, MAX_CONDITIONS).map((condition) => ({
        sourceFieldCode: condition?.sourceFieldCode || '',
        operator: '=',
        targetScope: normalizeTargetScope(condition?.targetScope),
        targetFieldCode: condition?.targetFieldCode || ''
      }));
    }

    const legacyRecordConditions = parseJsonArray(configObject.recordMatchConditionsJson).map((condition) => ({
      sourceFieldCode: condition?.sourceFieldCode || '',
      operator: '=',
      targetScope: TARGET_SCOPE.RECORD,
      targetFieldCode: condition?.targetFieldCode || ''
    }));
    const legacyRowConditions = parseJsonArray(configObject.rowMatchConditionsJson).map((condition) => ({
      sourceFieldCode: condition?.sourceFieldCode || '',
      operator: '=',
      targetScope: TARGET_SCOPE.TABLE,
      targetFieldCode: condition?.targetFieldCode || ''
    }));
    const mergedLegacy = [...legacyRecordConditions, ...legacyRowConditions].filter((condition) => condition.sourceFieldCode);
    if (mergedLegacy.length > 0) {
      return mergedLegacy.slice(0, MAX_CONDITIONS);
    }

    if (configObject.sourceRowIdentifierField || configObject.rowIdentifierField) {
      return [{
        sourceFieldCode: configObject.sourceRowIdentifierField || configObject.rowIdentifierField || '',
        operator: '=',
        targetScope: TARGET_SCOPE.TABLE,
        targetFieldCode: configObject.targetRowIdentifierField || configObject.rowIdentifierField || ''
      }];
    }

    return [];
  }

  function getSavedFieldMappings(configObject) {
    const newMappings = parseJsonArray(configObject.fieldMappingsJson);
    if (newMappings.length > 0) {
      return newMappings.slice(0, MAX_MAPPINGS).map((mapping) => ({
        sourceFieldCode: mapping?.sourceFieldCode || '',
        targetScope: normalizeTargetScope(mapping?.targetScope),
        targetFieldCode: mapping?.targetFieldCode || ''
      }));
    }

    const mappings = [];
    for (let i = 1; i <= MAX_MAPPINGS; i += 1) {
      const sourceFieldCode = configObject[`VARIABLE_${i}`] || '';
      const targetFieldCode = configObject[`ROW_VARIABLE_${i}`] || '';
      if (sourceFieldCode || targetFieldCode) {
        mappings.push({
          sourceFieldCode,
          targetScope: TARGET_SCOPE.TABLE,
          targetFieldCode
        });
      }
    }
    return mappings;
  }

  function flattenLayoutFields(layoutList, subtableCode = null) {
    return layoutList.reduce((accumulator, layout) => {
      switch (layout.type) {
        case 'ROW':
          return accumulator.concat(
            layout.fields
              .filter((field) => field.type !== 'LABEL' && field.type !== 'HR')
              .map((field) => (subtableCode ? { ...field, subtableCode } : field))
          );
        case 'GROUP':
          return accumulator.concat(
            layout.layout.reduce((groupAccumulator, childLayout) => {
              return groupAccumulator.concat(flattenLayoutFields([childLayout], subtableCode));
            }, [])
          );
        case 'SUBTABLE':
          return accumulator.concat(
            layout.fields
              .filter((field) => field.type !== 'LABEL' && field.type !== 'HR')
              .map((field) => ({ ...field, subtableCode: layout.code }))
          );
        default:
          return accumulator;
      }
    }, []);
  }

  async function fetchLayoutFieldsInOrder(appId) {
    const layoutResponse = await kintone.api(
      kintone.api.url('/k/v1/preview/app/form/layout', true),
      'GET',
      { app: appId }
    );
    return flattenLayoutFields(layoutResponse.layout);
  }

  async function fetchSubtableOptionsInOrder(appId, properties) {
    const layoutResponse = await kintone.api(
      kintone.api.url('/k/v1/preview/app/form/layout', true),
      'GET',
      { app: appId }
    );

    function collectSubtables(layoutList) {
      return layoutList.reduce((accumulator, layout) => {
        if (layout.type === 'GROUP') {
          return accumulator.concat(collectSubtables(layout.layout));
        }

        if (layout.type === 'SUBTABLE' && properties[layout.code]) {
          accumulator.push({
            value: layout.code,
            label: formatFieldDisplayName(properties[layout.code].label, layout.code)
          });
        }

        return accumulator;
      }, []);
    }

    return collectSubtables(layoutResponse.layout);
  }

  async function fetchFormProperties(appId) {
    const response = await kintone.api(
      kintone.api.url('/k/v1/app/form/fields', true),
      'GET',
      { app: appId }
    );
    return response.properties;
  }

  function setSelectOptions(selectElement, options, selectedValue) {
    selectElement.innerHTML = '';

    const defaultOption = document.createElement('option');
    defaultOption.value = '';
    defaultOption.textContent = '選択してください';
    selectElement.appendChild(defaultOption);

    options.forEach((optionData) => {
      const option = document.createElement('option');
      option.value = optionData.value;
      option.textContent = optionData.label;
      if (String(optionData.value) === String(selectedValue || '')) {
        option.selected = true;
      }
      selectElement.appendChild(option);
    });
  }

  function createFieldDefinition(field, code, fallbackLabel) {
    return {
      code,
      label: field?.label || fallbackLabel || code,
      type: field?.type || ''
    };
  }

  function buildFieldOptions(definitions) {
    return definitions.map((definition) => ({
      value: definition.code,
      label: formatFieldDisplayName(definition.label, definition.code)
    }));
  }

  function getDefinitionByCode(definitions, code) {
    return definitions.find((definition) => definition.code === code) || null;
  }

  function getExcludedTypes() {
    return ['FILE', 'REFERENCE_TABLE', 'GROUP', 'SUBTABLE'];
  }

  function buildSourceDefinitions() {
    return currentLayoutFields
      .filter((field) => !field.subtableCode)
      .map((field) => createFieldDefinition(currentFormProperties[field.code], field.code, field.label))
      .filter((definition) => definition.code && definition.type && !getExcludedTypes().includes(definition.type));
  }

  function buildTargetRecordDefinitions(targetProperties, targetLayoutOrderedFields) {
    const orderedCodes = targetLayoutOrderedFields
      .filter((field) => !field.subtableCode)
      .map((field) => field.code);
    const fallbackCodes = Object.keys(targetProperties).filter((code) => targetProperties[code]?.type !== 'SUBTABLE');
    const fieldCodes = orderedCodes.length > 0 ? orderedCodes : fallbackCodes;

    return fieldCodes
      .map((code) => createFieldDefinition(targetProperties[code], code))
      .filter((definition) => definition.code && definition.type && !getExcludedTypes().includes(definition.type));
  }

  function buildTargetTableDefinitions(targetProperties, targetLayoutOrderedFields, tableCode) {
    if (!tableCode) {
      return [];
    }

    const orderedCodes = targetLayoutOrderedFields
      .filter((field) => field.subtableCode === tableCode)
      .map((field) => field.code);
    const fallbackCodes = Object.keys(targetProperties[tableCode]?.fields || {});
    const fieldCodes = orderedCodes.length > 0 ? orderedCodes : fallbackCodes;

    return fieldCodes
      .map((code) => createFieldDefinition(targetProperties[tableCode]?.fields?.[code], code))
      .filter((definition) => definition.code && definition.type && !getExcludedTypes().includes(definition.type));
  }

  function getTargetDefinitionsByScope(targetScope) {
    return targetScope === TARGET_SCOPE.TABLE ? targetTableDefinitions : targetRecordDefinitions;
  }

  function filterCompatibleTargets(sourceDefinition, targetDefinitions) {
    if (!sourceDefinition) {
      return [];
    }
    return targetDefinitions.filter((targetDefinition) => targetDefinition.type === sourceDefinition.type);
  }

  function resolvePreferredTarget(sourceDefinition) {
    if (!sourceDefinition) {
      return { targetScope: TARGET_SCOPE.RECORD, targetFieldCode: '' };
    }

    const recordTargets = filterCompatibleTargets(sourceDefinition, targetRecordDefinitions);
    const sameRecordTarget = recordTargets.find((targetDefinition) => targetDefinition.code === sourceDefinition.code);
    if (sameRecordTarget) {
      return { targetScope: TARGET_SCOPE.RECORD, targetFieldCode: sameRecordTarget.code };
    }

    const tableTargets = filterCompatibleTargets(sourceDefinition, targetTableDefinitions);
    const sameTableTarget = tableTargets.find((targetDefinition) => targetDefinition.code === sourceDefinition.code);
    if (sameTableTarget) {
      return { targetScope: TARGET_SCOPE.TABLE, targetFieldCode: sameTableTarget.code };
    }

    if (recordTargets[0]) {
      return { targetScope: TARGET_SCOPE.RECORD, targetFieldCode: recordTargets[0].code };
    }

    if (tableTargets[0]) {
      return { targetScope: TARGET_SCOPE.TABLE, targetFieldCode: tableTargets[0].code };
    }

    return { targetScope: TARGET_SCOPE.RECORD, targetFieldCode: '' };
  }

  function resolveSameCodeTarget(sourceDefinition) {
    if (!sourceDefinition) {
      return { targetScope: TARGET_SCOPE.RECORD, targetFieldCode: '' };
    }

    const sameRecordTarget = targetRecordDefinitions.find((targetDefinition) =>
      targetDefinition.code === sourceDefinition.code && targetDefinition.type === sourceDefinition.type
    );
    if (sameRecordTarget) {
      return { targetScope: TARGET_SCOPE.RECORD, targetFieldCode: sameRecordTarget.code };
    }

    const sameTableTarget = targetTableDefinitions.find((targetDefinition) =>
      targetDefinition.code === sourceDefinition.code && targetDefinition.type === sourceDefinition.type
    );
    if (sameTableTarget) {
      return { targetScope: TARGET_SCOPE.TABLE, targetFieldCode: sameTableTarget.code };
    }

    return { targetScope: TARGET_SCOPE.RECORD, targetFieldCode: '' };
  }

  function sanitizeConditions(conditions) {
    return (conditions || [])
      .slice(0, MAX_CONDITIONS)
      .map((condition) => {
        const normalized = {
          sourceFieldCode: condition?.sourceFieldCode || '',
          operator: '=',
          targetScope: normalizeTargetScope(condition?.targetScope),
          targetFieldCode: condition?.targetFieldCode || ''
        };

        if (!normalized.sourceFieldCode) {
          return createEmptyCondition();
        }

        const sourceDefinition = getDefinitionByCode(sourceNormalDefinitions, normalized.sourceFieldCode);
        if (!sourceDefinition) {
          return createEmptyCondition();
        }

        const compatibleTargets = filterCompatibleTargets(sourceDefinition, getTargetDefinitionsByScope(normalized.targetScope));
        const targetFieldCode = compatibleTargets.some((targetDefinition) => targetDefinition.code === normalized.targetFieldCode)
          ? normalized.targetFieldCode
          : '';

        return {
          sourceFieldCode: sourceDefinition.code,
          operator: '=',
          targetScope: normalized.targetScope,
          targetFieldCode
        };
      });
  }

  function sanitizeMappings(mappings) {
    return (mappings || [])
      .slice(0, MAX_MAPPINGS)
      .map((mapping) => {
        const normalized = {
          sourceFieldCode: mapping?.sourceFieldCode || '',
          targetScope: normalizeTargetScope(mapping?.targetScope),
          targetFieldCode: mapping?.targetFieldCode || ''
        };

        if (!normalized.sourceFieldCode) {
          return createEmptyMapping();
        }

        const sourceDefinition = getDefinitionByCode(sourceNormalDefinitions, normalized.sourceFieldCode);
        if (!sourceDefinition) {
          return createEmptyMapping();
        }

        const compatibleTargets = filterCompatibleTargets(sourceDefinition, getTargetDefinitionsByScope(normalized.targetScope));
        const targetFieldCode = compatibleTargets.some((targetDefinition) => targetDefinition.code === normalized.targetFieldCode)
          ? normalized.targetFieldCode
          : '';

        return {
          sourceFieldCode: sourceDefinition.code,
          targetScope: normalized.targetScope,
          targetFieldCode
        };
      });
  }

  function renderConditionEditor() {
    elements.conditionEditor.innerHTML = '';

    if (!sourceNormalDefinitions.length || (!targetRecordDefinitions.length && !targetTableDefinitions.length)) {
      const empty = document.createElement('p');
      empty.className = 'condition-empty';
      empty.textContent = '項目取得を行うと、更新条件候補が表示されます。';
      elements.conditionEditor.appendChild(empty);
      return;
    }

    if (!updateConditions.length) {
      const empty = document.createElement('p');
      empty.className = 'condition-empty';
      empty.textContent = '更新条件は未設定です。少なくとも1件以上設定してください。';
      elements.conditionEditor.appendChild(empty);
      return;
    }

    updateConditions.forEach((condition, index) => {
      const row = document.createElement('div');
      row.className = 'condition-row';

      const source = document.createElement('div');
      source.className = 'condition-source';
      const sourceSelect = document.createElement('select');
      sourceSelect.dataset.conditionRole = 'source';
      sourceSelect.dataset.conditionIndex = String(index);
      setSelectOptions(sourceSelect, buildFieldOptions(sourceNormalDefinitions), condition.sourceFieldCode);
      source.appendChild(sourceSelect);

      const scope = document.createElement('div');
      scope.className = 'condition-scope';
      const scopeSelect = document.createElement('select');
      scopeSelect.dataset.conditionRole = 'targetScope';
      scopeSelect.dataset.conditionIndex = String(index);
      setSelectOptions(scopeSelect, [
        { value: TARGET_SCOPE.RECORD, label: 'アプリ' },
        { value: TARGET_SCOPE.TABLE, label: 'テーブル' }
      ], condition.targetScope);
      scope.appendChild(scopeSelect);

      const target = document.createElement('div');
      target.className = 'condition-target';
      const targetSelect = document.createElement('select');
      targetSelect.dataset.conditionRole = 'target';
      targetSelect.dataset.conditionIndex = String(index);
      const sourceDefinition = getDefinitionByCode(sourceNormalDefinitions, condition.sourceFieldCode);
      const compatibleTargets = filterCompatibleTargets(sourceDefinition, getTargetDefinitionsByScope(condition.targetScope));
      setSelectOptions(targetSelect, buildFieldOptions(compatibleTargets), condition.targetFieldCode);
      target.appendChild(targetSelect);

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'condition-remove';
      remove.dataset.conditionRole = 'remove';
      remove.dataset.conditionIndex = String(index);
      remove.textContent = '×';

      row.appendChild(source);
      row.appendChild(scope);
      row.appendChild(target);
      row.appendChild(remove);
      elements.conditionEditor.appendChild(row);
    });
  }

  function renderMappingEditor() {
    elements.mappingEditor.innerHTML = '';

    if (!sourceNormalDefinitions.length || (!targetRecordDefinitions.length && !targetTableDefinitions.length)) {
      const empty = document.createElement('p');
      empty.className = 'mapping-empty';
      empty.textContent = '項目取得を行うと、更新対象マッピング候補が表示されます。';
      elements.mappingEditor.appendChild(empty);
      return;
    }

    if (!fieldMappings.length) {
      const empty = document.createElement('p');
      empty.className = 'mapping-empty';
      empty.textContent = '更新対象マッピングは未設定です。少なくとも1件以上設定してください。';
      elements.mappingEditor.appendChild(empty);
      return;
    }

    fieldMappings.forEach((mapping, index) => {
      const row = document.createElement('div');
      row.className = 'mapping-row';

      const source = document.createElement('div');
      source.className = 'mapping-source';
      const sourceSelect = document.createElement('select');
      sourceSelect.dataset.mappingRole = 'source';
      sourceSelect.dataset.mappingIndex = String(index);
      setSelectOptions(sourceSelect, buildFieldOptions(sourceNormalDefinitions), mapping.sourceFieldCode);
      source.appendChild(sourceSelect);

      const scope = document.createElement('div');
      scope.className = 'mapping-scope';
      const scopeSelect = document.createElement('select');
      scopeSelect.dataset.mappingRole = 'targetScope';
      scopeSelect.dataset.mappingIndex = String(index);
      setSelectOptions(scopeSelect, [
        { value: TARGET_SCOPE.RECORD, label: 'アプリ' },
        { value: TARGET_SCOPE.TABLE, label: 'テーブル' }
      ], mapping.targetScope);
      scope.appendChild(scopeSelect);

      const target = document.createElement('div');
      target.className = 'mapping-target';
      const targetSelect = document.createElement('select');
      targetSelect.dataset.mappingRole = 'target';
      targetSelect.dataset.mappingIndex = String(index);
      const sourceDefinition = getDefinitionByCode(sourceNormalDefinitions, mapping.sourceFieldCode);
      const compatibleTargets = filterCompatibleTargets(sourceDefinition, getTargetDefinitionsByScope(mapping.targetScope));
      setSelectOptions(targetSelect, buildFieldOptions(compatibleTargets), mapping.targetFieldCode);
      target.appendChild(targetSelect);

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'mapping-remove';
      remove.dataset.mappingRole = 'remove';
      remove.dataset.mappingIndex = String(index);
      remove.textContent = '×';

      row.appendChild(source);
      row.appendChild(scope);
      row.appendChild(target);
      row.appendChild(remove);
      elements.mappingEditor.appendChild(row);
    });
  }

  function renderEditors() {
    renderConditionEditor();
    renderMappingEditor();
  }

  function resetLoadedFieldState() {
    sourceNormalDefinitions = [];
    targetRecordDefinitions = [];
    targetTableDefinitions = [];
    renderEditors();
  }

  function usesTableScope(items) {
    return items.some((item) => item.targetScope === TARGET_SCOPE.TABLE);
  }

  function appendConditionRow() {
    if (!sourceNormalDefinitions.length || (!targetRecordDefinitions.length && !targetTableDefinitions.length)) {
      return;
    }

    const sourceDefinition = sourceNormalDefinitions.find((definition) =>
      !updateConditions.some((condition) => condition.sourceFieldCode === definition.code)
    ) || sourceNormalDefinitions[0];
    const preferredTarget = resolvePreferredTarget(sourceDefinition);

    updateConditions = sanitizeConditions([
      ...updateConditions,
      {
        sourceFieldCode: sourceDefinition?.code || '',
        operator: '=',
        targetScope: preferredTarget.targetScope,
        targetFieldCode: preferredTarget.targetFieldCode
      }
    ]);
    renderEditors();
  }

  function appendMappingRow() {
    if (!sourceNormalDefinitions.length || (!targetRecordDefinitions.length && !targetTableDefinitions.length)) {
      return;
    }

    const sourceDefinition = sourceNormalDefinitions.find((definition) =>
      !fieldMappings.some((mapping) => mapping.sourceFieldCode === definition.code)
    ) || sourceNormalDefinitions[0];
    const preferredTarget = resolvePreferredTarget(sourceDefinition);

    fieldMappings = sanitizeMappings([
      ...fieldMappings,
      {
        sourceFieldCode: sourceDefinition?.code || '',
        targetScope: preferredTarget.targetScope,
        targetFieldCode: preferredTarget.targetFieldCode
      }
    ]);
    renderEditors();
  }

  function autoMapFields() {
    const nextMappings = sanitizeMappings(fieldMappings);
    const existingSources = new Set(nextMappings.map((mapping) => mapping.sourceFieldCode).filter(Boolean));

    sourceNormalDefinitions.forEach((sourceDefinition) => {
      if (nextMappings.length >= MAX_MAPPINGS || existingSources.has(sourceDefinition.code)) {
        return;
      }

      const sameCodeTarget = resolveSameCodeTarget(sourceDefinition);
      if (!sameCodeTarget.targetFieldCode) {
        return;
      }

      nextMappings.push({
        sourceFieldCode: sourceDefinition.code,
        targetScope: sameCodeTarget.targetScope,
        targetFieldCode: sameCodeTarget.targetFieldCode
      });
      existingSources.add(sourceDefinition.code);
    });

    fieldMappings = sanitizeMappings(nextMappings);
    renderEditors();
  }

  async function fetchAllApps() {
    const allApps = [];
    const limit = 100;
    let offset = 0;

    while (true) {
      const response = await kintone.api('/k/v1/apps', 'GET', { limit, offset });
      if (response && Array.isArray(response.apps)) {
        allApps.push(...response.apps);
      }
      if (!response || !response.apps || response.apps.length < limit) {
        break;
      }
      offset += limit;
    }

    allApps.sort((left, right) => (left.name || '').localeCompare((right.name || ''), 'ja'));
    setSelectOptions(
      elements.sourceAppId,
      allApps.map((app) => ({
        value: String(app.appId),
        label: `${app.name}（App ID: ${app.appId}）`
      })),
      config.sourceAppId
    );
  }

  async function populateTargetTableOptions(selectedAppId, selectedTableCode = '') {
    if (!selectedAppId) {
      setSelectOptions(elements.sourceTableFieldCode, [], '');
      return;
    }

    const targetProperties = await fetchFormProperties(selectedAppId);
    const subtableOptions = await fetchSubtableOptionsInOrder(selectedAppId, targetProperties);
    setSelectOptions(elements.sourceTableFieldCode, subtableOptions, selectedTableCode);
  }

  async function loadFieldSettings(showSuccessMessage = false, showErrorAlert = true) {
    const targetAppId = elements.sourceAppId.value;

    if (!targetAppId) {
      if (showErrorAlert) {
        alert('更新先アプリを選択してください。');
      }
      return;
    }

    const [targetProperties, targetLayoutFields] = await Promise.all([
      fetchFormProperties(targetAppId),
      fetchLayoutFieldsInOrder(targetAppId)
    ]);

    sourceNormalDefinitions = buildSourceDefinitions();
    targetRecordDefinitions = buildTargetRecordDefinitions(targetProperties, targetLayoutFields);
    targetTableDefinitions = buildTargetTableDefinitions(targetProperties, targetLayoutFields, elements.sourceTableFieldCode.value);

    updateConditions = sanitizeConditions(updateConditions);
    fieldMappings = sanitizeMappings(fieldMappings);
    renderEditors();

    if (showSuccessMessage) {
      alert('項目取得が完了しました。更新条件と更新対象マッピングを確認してください。');
    }
  }

  async function authenticateOnInitialize() {
    updateSaveButtonState(true, '認証状態を確認しています。');
    try {
      const data = await AuthModule.authenticateDomain(API_CONFIG);
      if (data.status === 'success' && data.response?.status === 'valid') {
        authState.checked = true;
        authState.isValid = true;
        authState.trialEndDate = data.response.Trial_enddate || authState.trialEndDate;
        updateSaveButtonState(false);
        return true;
      }

      const message = data.response?.message || '不明なエラー';
      authState.checked = true;
      authState.isValid = false;
      updateSaveButtonState(true, '認証に失敗したため保存できません。');
      alert(buildReloadPromptMessage(`認証失敗: ${message}`));
      return false;
    } catch (error) {
      console.error('起動時認証エラー:', error);
      authState.checked = true;
      authState.isValid = false;
      updateSaveButtonState(true, '認証に失敗したため保存できません。');
      alert(buildReloadPromptMessage('認証中にエラーが発生しました。'));
      return false;
    }
  }

  async function initialize() {
    try {
      renderEditors();

      [currentFormProperties, currentLayoutFields] = await Promise.all([
        fetchFormProperties(currentAppId),
        fetchLayoutFieldsInOrder(currentAppId)
      ]);

      await fetchAllApps();

      if (config.sourceAppId) {
        await populateTargetTableOptions(config.sourceAppId, config.sourceTableFieldCode || '');
        await loadFieldSettings(false, false);
      } else {
        setSelectOptions(elements.sourceTableFieldCode, [], '');
        renderEditors();
      }

      await authenticateOnInitialize();
    } catch (error) {
      console.error('初期表示に失敗しました:', error);
      alert('設定画面の初期表示に失敗しました。更新先アプリの閲覧権限と、対象アプリの設定状態を確認してください。');
    }
  }

  elements.sourceAppId.addEventListener('change', async () => {
    try {
      await populateTargetTableOptions(elements.sourceAppId.value, '');
      resetLoadedFieldState();
    } catch (error) {
      console.error('更新先アプリ情報の取得に失敗しました:', error);
      alert('更新先アプリ情報の取得に失敗しました。対象アプリの閲覧権限を確認してください。');
    }
  });

  elements.sourceTableFieldCode.addEventListener('change', () => {
    resetLoadedFieldState();
  });

  elements.conditionEditor.addEventListener('change', (event) => {
    const select = event.target;
    if (!(select instanceof HTMLSelectElement)) {
      return;
    }

    const index = Number(select.dataset.conditionIndex);
    if (Number.isNaN(index) || !updateConditions[index]) {
      return;
    }

    if (select.dataset.conditionRole === 'source') {
      const sourceDefinition = getDefinitionByCode(sourceNormalDefinitions, select.value);
      const preferredTarget = resolvePreferredTarget(sourceDefinition);
      updateConditions[index] = {
        sourceFieldCode: select.value,
        operator: '=',
        targetScope: preferredTarget.targetScope,
        targetFieldCode: preferredTarget.targetFieldCode
      };
    } else if (select.dataset.conditionRole === 'targetScope') {
      updateConditions[index].targetScope = normalizeTargetScope(select.value);
      updateConditions[index].targetFieldCode = '';
    } else if (select.dataset.conditionRole === 'target') {
      updateConditions[index].targetFieldCode = select.value;
    }

    updateConditions = sanitizeConditions(updateConditions);
    renderEditors();
  });

  elements.conditionEditor.addEventListener('click', (event) => {
    const button = event.target;
    if (!(button instanceof HTMLButtonElement) || button.dataset.conditionRole !== 'remove') {
      return;
    }

    const index = Number(button.dataset.conditionIndex);
    if (Number.isNaN(index)) {
      return;
    }

    updateConditions = updateConditions.filter((_, itemIndex) => itemIndex !== index);
    renderEditors();
  });

  elements.mappingEditor.addEventListener('change', (event) => {
    const select = event.target;
    if (!(select instanceof HTMLSelectElement)) {
      return;
    }

    const index = Number(select.dataset.mappingIndex);
    if (Number.isNaN(index) || !fieldMappings[index]) {
      return;
    }

    if (select.dataset.mappingRole === 'source') {
      const sourceDefinition = getDefinitionByCode(sourceNormalDefinitions, select.value);
      const preferredTarget = resolvePreferredTarget(sourceDefinition);
      fieldMappings[index] = {
        sourceFieldCode: select.value,
        targetScope: preferredTarget.targetScope,
        targetFieldCode: preferredTarget.targetFieldCode
      };
    } else if (select.dataset.mappingRole === 'targetScope') {
      fieldMappings[index].targetScope = normalizeTargetScope(select.value);
      fieldMappings[index].targetFieldCode = '';
    } else if (select.dataset.mappingRole === 'target') {
      fieldMappings[index].targetFieldCode = select.value;
    }

    fieldMappings = sanitizeMappings(fieldMappings);
    renderEditors();
  });

  elements.mappingEditor.addEventListener('click', (event) => {
    const button = event.target;
    if (!(button instanceof HTMLButtonElement) || button.dataset.mappingRole !== 'remove') {
      return;
    }

    const index = Number(button.dataset.mappingIndex);
    if (Number.isNaN(index)) {
      return;
    }

    fieldMappings = fieldMappings.filter((_, itemIndex) => itemIndex !== index);
    renderEditors();
  });

  elements.addConditionButton.addEventListener('click', () => {
    if (!sourceNormalDefinitions.length || (!targetRecordDefinitions.length && !targetTableDefinitions.length)) {
      alert('先に項目取得を実行してください。');
      return;
    }
    appendConditionRow();
  });

  elements.addMappingButton.addEventListener('click', () => {
    if (!sourceNormalDefinitions.length || (!targetRecordDefinitions.length && !targetTableDefinitions.length)) {
      alert('先に項目取得を実行してください。');
      return;
    }
    appendMappingRow();
  });

  elements.autoMappingButton.addEventListener('click', () => {
    if (!sourceNormalDefinitions.length || (!targetRecordDefinitions.length && !targetTableDefinitions.length)) {
      alert('先に項目取得を実行してください。');
      return;
    }
    autoMapFields();
  });

  elements.fetchFieldsButton.addEventListener('click', async () => {
    try {
      await loadFieldSettings(true, true);
    } catch (error) {
      console.error('項目取得中のエラー:', error);
      alert('更新先アプリの項目取得中にエラーが発生しました。更新先アプリとルックアップ参照先アプリの閲覧権限があること、および更新先アプリで「アプリを更新」済みであることを確認してください。');
    }
  });

  elements.saveButton.addEventListener('click', async () => {
    const sourceAppId = elements.sourceAppId.value;
    const sourceTableFieldCode = elements.sourceTableFieldCode.value;
    const conditionsToSave = sanitizeConditions(updateConditions)
      .filter((condition) => condition.sourceFieldCode && condition.targetFieldCode)
      .slice(0, MAX_CONDITIONS);
    const mappingsToSave = sanitizeMappings(fieldMappings)
      .filter((mapping) => mapping.sourceFieldCode && mapping.targetFieldCode)
      .slice(0, MAX_MAPPINGS);

    if (!sourceAppId) {
      alert('更新先アプリを選択してください。');
      return;
    }

    if (!conditionsToSave.length) {
      alert('更新条件を1件以上設定してください。');
      return;
    }

    if (!mappingsToSave.length) {
      alert('更新対象マッピングを1件以上設定してください。');
      return;
    }

    if ((usesTableScope(conditionsToSave) || usesTableScope(mappingsToSave)) && !sourceTableFieldCode) {
      alert('更新先種別でテーブルを使う場合は、更新先テーブルを選択してください。');
      return;
    }

    try {
      if (!authState.checked || !authState.isValid) {
        alert(buildReloadPromptMessage('認証が完了していないため保存できません。'));
        return;
      }

      const legacyKeyCondition = conditionsToSave.length === 1
        && conditionsToSave[0].targetScope === TARGET_SCOPE.TABLE
        ? conditionsToSave[0]
        : null;
      const legacyTableMappings = mappingsToSave.every((mapping) => mapping.targetScope === TARGET_SCOPE.TABLE)
        ? mappingsToSave
        : [];

      const nextConfig = {
        sourceAppId,
        sourceTableFieldCode: sourceTableFieldCode || '',
        updateConditionsJson: JSON.stringify(conditionsToSave),
        fieldMappingsJson: JSON.stringify(mappingsToSave),
        suppressSuccessMessage: elements.suppressSuccessMessage.checked.toString(),
        authStatus: 'valid',
        rowIdentifierField: legacyKeyCondition?.sourceFieldCode || '',
        sourceRowIdentifierField: legacyKeyCondition?.sourceFieldCode || '',
        targetRowIdentifierField: legacyKeyCondition?.targetFieldCode || '',
        updateMode: legacyKeyCondition ? 'linkKey' : 'condition',
        recordMatchConditionsJson: JSON.stringify(
          conditionsToSave
            .filter((condition) => condition.targetScope === TARGET_SCOPE.RECORD)
            .map((condition) => ({
              sourceFieldCode: condition.sourceFieldCode,
              targetFieldCode: condition.targetFieldCode,
              operator: '='
            }))
        ),
        rowMatchConditionsJson: JSON.stringify(
          conditionsToSave
            .filter((condition) => condition.targetScope === TARGET_SCOPE.TABLE)
            .map((condition) => ({
              sourceFieldCode: condition.sourceFieldCode,
              targetFieldCode: condition.targetFieldCode,
              operator: '='
            }))
        )
      };

      if (authState.trialEndDate) {
        nextConfig.Trial_enddate = authState.trialEndDate;
      }

      for (let i = 1; i <= MAX_MAPPINGS; i += 1) {
        nextConfig[`VARIABLE_${i}`] = legacyTableMappings[i - 1]?.sourceFieldCode || '';
        nextConfig[`ROW_VARIABLE_${i}`] = legacyTableMappings[i - 1]?.targetFieldCode || '';
      }

      kintone.plugin.app.setConfig(nextConfig);
    } catch (error) {
      console.error('設定保存エラー:', error);
      alert('設定保存中にエラーが発生しました。');
    }
  });

  elements.cancelButton.addEventListener('click', () => {
    window.location.href = `/k/admin/app/${kintone.app.getId()}/plugin/`;
  });

  renderEditors();
  await initialize();
})(kintone.$PLUGIN_ID);
