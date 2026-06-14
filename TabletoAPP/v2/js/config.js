(async (PLUGIN_ID) => {
    'use strict';

    const MAX_LINKAGES = 5;
    const MAX_MAPPINGS = 50;
    const savedConfig = kintone.plugin.app.getConfig(PLUGIN_ID) || {};

    const dom = {
        linkageTabs: document.getElementById('linkage-tabs'),
        addLinkageButton: document.getElementById('add-linkage-button'),
        tableName: document.getElementById('tableName'),
        targetAppId: document.getElementById('targetAppId'),
        fetchFieldsButton: document.getElementById('fetch-fields-button'),
        sourceRowIdentifierField: document.getElementById('sourceRowIdentifierField'),
        targetRowIdentifierField: document.getElementById('targetRowIdentifierField'),
        sourceRecordNumber: document.getElementById('sourceRecordNumber'),
        tableRowNumber: document.getElementById('tableRowNumber'),
        normalMappingsEditor: document.getElementById('normal-mappings-editor'),
        tableMappingsEditor: document.getElementById('table-mappings-editor'),
        addNormalMappingButton: document.getElementById('add-normal-mapping-button'),
        addTableMappingButton: document.getElementById('add-table-mapping-button'),
        autoNormalMappingButton: document.getElementById('auto-normal-mapping-button'),
        autoTableMappingButton: document.getElementById('auto-table-mapping-button'),
        conditionEditor: document.getElementById('condition-editor'),
        addConditionButton: document.getElementById('add-condition-button'),
        hideKeyField: document.getElementById('hideKeyField'),
        suppressSuccessMessage: document.getElementById('suppressSuccessMessage'),
        authStatus: document.getElementById('auth-status'),
        trialStatus: document.getElementById('trial-status'),
        saveButton: document.getElementById('save-button'),
        cancelButton: document.getElementById('cancel-button')
    };

    const sourceTableOptions = [];
    const appOptions = [];
    let activeLinkageIndex = 0;
    let linkageConfigs = getSavedLinkageConfigs(savedConfig);
    const authState = {
        checked: false,
        isValid: false,
        trialEndDate: savedConfig.Trial_enddate || ''
    };
    if (linkageConfigs.length === 0) {
        linkageConfigs = [createDefaultLinkageConfig(0)];
    }

    dom.hideKeyField.checked = savedConfig.hideKeyField === 'true';
    dom.suppressSuccessMessage.checked = savedConfig.suppressSuccessMessage === 'true';
    function buildReloadPromptMessage(message) {
        return `${message}\n設定内容を確認後、画面をリロードして再試行してください。`;
    }

    function updateSaveButtonState(isBlocked, title = '') {
        dom.saveButton.setAttribute('aria-disabled', isBlocked ? 'true' : 'false');
        if (title) {
            dom.saveButton.title = title;
            return;
        }
        dom.saveButton.removeAttribute('title');
    }

    function setAuthStatus(message, isError) {
        dom.authStatus.textContent = message;
        dom.authStatus.classList.toggle('is-error', Boolean(isError));
    }

    function formatTrialEndDate(trialEndDate) {
        const match = String(trialEndDate).match(/^(\d{4})[-/]?(\d{2})[-/]?(\d{2})$/);
        if (!match) {
            return '';
        }

        return `${Number(match[2])}月${Number(match[3])}日`;
    }

    function setTrialStatus(trialEndDate) {
        const formattedDate = formatTrialEndDate(trialEndDate);
        if (!formattedDate) {
            dom.trialStatus.hidden = true;
            dom.trialStatus.textContent = '';
            return;
        }

        dom.trialStatus.textContent = `トライアル中（～${formattedDate}まで）`;
        dom.trialStatus.hidden = false;
    }

    function formatFieldDisplayName(label, code) {
        return `${label || code}（${code}）`;
    }

    function createDefaultLinkageConfig(index) {
        return {
            id: `linkage-${index + 1}`,
            title: '',
            tableFieldCode: '',
            targetAppId: '',
            sourceRowIdentifierField: '',
            targetRowIdentifierField: '',
            sourceRecordNumber: '',
            tableRowNumber: '',
            syncConditions: [],
            normalMappings: [],
            tableMappings: [],
            sourceRowIdentifierOptions: [],
            targetRowIdentifierOptions: [],
            targetMetaFieldOptions: [],
            sourceNormalDefinitions: [],
            sourceTableDefinitions: [],
            targetDefinitions: []
        };
    }

    function getLegacyMappings(configObject, prefix) {
        const values = [];
        for (let i = 1; i <= MAX_MAPPINGS; i++) {
            const value = configObject[`${prefix}_${i}`];
            if (value) {
                values.push(value);
            }
        }
        return values;
    }

    function normalizeConditionList(rawConditions) {
        if (!Array.isArray(rawConditions)) {
            return [];
        }

        return rawConditions
            .map(condition => ({
                fieldScope: condition?.fieldScope === 'table' ? 'table' : 'record',
                fieldCode: condition?.fieldCode || '',
                fieldType: condition?.fieldType || '',
                operator: condition?.operator || '',
                value: condition?.value ?? ''
            }))
            .filter(condition => condition.fieldCode)
            .slice(0, MAX_MAPPINGS);
    }

    function normalizeMappingList(rawMappings, legacyCodes = []) {
        if (Array.isArray(rawMappings)) {
            return rawMappings
                .map(mapping => ({
                    sourceFieldCode: mapping?.sourceFieldCode || mapping?.source || '',
                    targetFieldCode: mapping?.targetFieldCode || mapping?.target || ''
                }))
                .filter(mapping => mapping.sourceFieldCode)
                .slice(0, MAX_MAPPINGS);
        }

        return legacyCodes
            .filter(Boolean)
            .slice(0, MAX_MAPPINGS)
            .map(code => ({
                sourceFieldCode: code,
                targetFieldCode: code
            }));
    }

    function normalizeLinkageConfig(raw, index) {
        const defaultConfig = createDefaultLinkageConfig(index);
        const legacyVariables = Array.isArray(raw?.variables) ? raw.variables : [];
        const legacyRowVariables = Array.isArray(raw?.rowVariables) ? raw.rowVariables : [];
        return {
            ...defaultConfig,
            ...raw,
            id: raw?.id || defaultConfig.id,
            sourceRowIdentifierField: raw?.sourceRowIdentifierField || raw?.rowIdentifierField || '',
            targetRowIdentifierField: raw?.targetRowIdentifierField || raw?.rowIdentifierField || '',
            syncConditions: normalizeConditionList(raw?.syncConditions),
            normalMappings: normalizeMappingList(raw?.normalMappings, legacyVariables),
            tableMappings: normalizeMappingList(raw?.tableMappings, legacyRowVariables),
            sourceRowIdentifierOptions: [],
            targetRowIdentifierOptions: [],
            targetMetaFieldOptions: [],
            sourceNormalDefinitions: [],
            sourceTableDefinitions: [],
            targetDefinitions: []
        };
    }

    function getSavedLinkageConfigs(config) {
        if (config.linkageConfigsJson) {
            try {
                const parsed = JSON.parse(config.linkageConfigsJson);
                if (Array.isArray(parsed)) {
                    return parsed.slice(0, MAX_LINKAGES).map((linkage, index) => normalizeLinkageConfig(linkage, index));
                }
            } catch (error) {
                console.warn('linkageConfigsJson の解析に失敗しました。旧設定を読み込みます。', error);
            }
        }

        if (config.tableFieldCode || config.targetAppId || config.rowIdentifierField) {
            return [normalizeLinkageConfig({
                tableFieldCode: config.tableFieldCode || '',
                targetAppId: config.targetAppId || '',
                rowIdentifierField: config.rowIdentifierField || '',
                sourceRecordNumber: config.sourceRecordNumber || '',
                tableRowNumber: config.tableRowNumber || '',
                variables: getLegacyMappings(config, 'VARIABLE'),
                rowVariables: getLegacyMappings(config, 'ROW_VARIABLE')
            }, 0)];
        }

        return [];
    }

    function flattenLayoutFields(layoutList, subtableCode = null) {
        return layoutList.reduce((acc, layout) => {
            switch (layout.type) {
                case 'ROW':
                    return acc.concat(
                        layout.fields
                            .filter(field => field.type !== 'LABEL' && field.type !== 'HR')
                            .map(field => subtableCode ? { ...field, subtableCode } : field)
                    );
                case 'GROUP':
                    return acc.concat(
                        layout.layout.reduce((groupAcc, childLayout) => {
                            return groupAcc.concat(flattenLayoutFields([childLayout], subtableCode));
                        }, [])
                    );
                case 'SUBTABLE':
                    return acc.concat(
                        layout.fields
                            .filter(field => field.type !== 'LABEL' && field.type !== 'HR')
                            .map(field => ({ ...field, subtableCode: layout.code }))
                    );
                default:
                    return acc;
            }
        }, []);
    }

    async function fetchSourceLayoutFieldsInOrder(appId) {
        const layoutResponse = await kintone.api(
            kintone.api.url('/k/v1/preview/app/form/layout', true),
            'GET',
            { app: appId }
        );
        return flattenLayoutFields(layoutResponse.layout);
    }

    async function fetchAllApps() {
        const allApps = [];
        const limit = 100;
        let offset = 0;

        while (true) {
            const res = await kintone.api('/k/v1/apps', 'GET', { limit, offset });
            if (res && Array.isArray(res.apps)) {
                allApps.push(...res.apps);
            }
            if (!res || !res.apps || res.apps.length < limit) {
                break;
            }
            offset += limit;
        }

        allApps.sort((a, b) => (a.name || '').localeCompare((b.name || ''), 'ja'));
        appOptions.splice(0, appOptions.length, ...allApps.map(app => ({
            value: String(app.appId),
            label: `${app.name}（App ID: ${app.appId}）`
        })));
    }

    async function fetchSourceTableOptions() {
        const fields = await KintoneConfigHelper.getFields(['SUBTABLE']);
        sourceTableOptions.splice(0, sourceTableOptions.length, ...fields.map(field => ({
            value: field.code,
            label: formatFieldDisplayName(field.label, field.code)
        })));
    }

    function renderSelectOptions(selectElement, options, selectedValue, placeholder = '選択してください') {
        selectElement.innerHTML = '';
        const defaultOption = document.createElement('option');
        defaultOption.value = '';
        defaultOption.textContent = placeholder;
        selectElement.appendChild(defaultOption);

        options.forEach(optionData => {
            const option = document.createElement('option');
            option.value = optionData.value;
            option.textContent = optionData.label;
            if (String(optionData.value) === String(selectedValue)) {
                option.selected = true;
            }
            selectElement.appendChild(option);
        });
    }

    function getTableLabel(tableFieldCode) {
        return sourceTableOptions.find(option => option.value === tableFieldCode)?.label || '';
    }

    function getLinkageTabLabel(linkage, index) {
        const tableLabel = getTableLabel(linkage.tableFieldCode);
        if (tableLabel) {
            return `${index + 1}. ${tableLabel}`;
        }
        return `連携${index + 1}`;
    }

    function getActiveLinkage() {
        return linkageConfigs[activeLinkageIndex];
    }

    function createFieldDefinition(field, code, fallbackLabel) {
        const options = field?.options
            ? Object.keys(field.options).map((key) => ({
                value: key,
                label: field.options[key]?.label || key
            }))
            : [];
        return {
            code,
            label: field?.label || fallbackLabel || code,
            type: field?.type || '',
            options
        };
    }

    function buildFieldOptions(definitions) {
        return definitions.map(definition => ({
            value: definition.code,
            label: formatFieldDisplayName(definition.label, definition.code)
        }));
    }

    function getDefinitionByCode(definitions, code) {
        return definitions.find(definition => definition.code === code) || null;
    }

    function getConditionDefinitionsByScope(linkage, fieldScope) {
        return fieldScope === 'table' ? linkage.sourceTableDefinitions : linkage.sourceNormalDefinitions;
    }

    function getConditionOperatorOptions(fieldType) {
        switch (fieldType) {
            case 'NUMBER':
            case 'CALC':
            case 'DATE':
            case 'DATETIME':
            case 'TIME':
                return [
                    { value: '=', label: '=' },
                    { value: '!=', label: '!=' },
                    { value: '>', label: '>' },
                    { value: '>=', label: '>=' },
                    { value: '<', label: '<' },
                    { value: '<=', label: '<=' }
                ];
            case 'RADIO_BUTTON':
            case 'DROP_DOWN':
                return [
                    { value: '=', label: '=' },
                    { value: '!=', label: '!=' }
                ];
            case 'CHECK_BOX':
            case 'MULTI_SELECT':
                return [
                    { value: 'contains', label: '含む' },
                    { value: 'not_contains', label: '含まない' }
                ];
            case 'SINGLE_LINE_TEXT':
            case 'MULTI_LINE_TEXT':
            case 'RICH_TEXT':
            case 'LINK':
            default:
                return [
                    { value: '=', label: '=' },
                    { value: '!=', label: '!=' },
                    { value: 'contains', label: '含む' },
                    { value: 'not_contains', label: '含まない' }
                ];
        }
    }

    function getConditionValueInputKind(definition) {
        if (!definition) {
            return 'text';
        }

        switch (definition.type) {
            case 'NUMBER':
            case 'CALC':
                return 'number';
            case 'DATE':
                return 'date';
            case 'DROP_DOWN':
            case 'RADIO_BUTTON':
            case 'CHECK_BOX':
            case 'MULTI_SELECT':
                return 'select';
            default:
                return 'text';
        }
    }

    function getDefaultConditionValue(definition) {
        if (!definition) {
            return '';
        }
        if (getConditionValueInputKind(definition) === 'select') {
            return definition.options[0]?.value || '';
        }
        return '';
    }

    function createConditionFromDefinition(fieldScope, definition) {
        const operators = getConditionOperatorOptions(definition?.type || '');
        return {
            fieldScope,
            fieldCode: definition?.code || '',
            fieldType: definition?.type || '',
            operator: operators[0]?.value || '=',
            value: getDefaultConditionValue(definition)
        };
    }

    function sanitizeCondition(linkage, condition) {
        const fieldScope = condition?.fieldScope === 'table' ? 'table' : 'record';
        const definitions = getConditionDefinitionsByScope(linkage, fieldScope);
        const definition = getDefinitionByCode(definitions, condition?.fieldCode);
        if (!definition) {
            return null;
        }

        const operatorOptions = getConditionOperatorOptions(definition.type);
        const operator = operatorOptions.some(option => option.value === condition?.operator)
            ? condition.operator
            : operatorOptions[0]?.value || '=';

        let value = condition?.value ?? '';
        if (getConditionValueInputKind(definition) === 'select') {
            if (!definition.options.some(option => String(option.value) === String(value))) {
                value = getDefaultConditionValue(definition);
            }
        }

        return {
            fieldScope,
            fieldCode: definition.code,
            fieldType: definition.type,
            operator,
            value
        };
    }

    function sanitizeConditions(linkage, conditions) {
        return (conditions || [])
            .map(condition => sanitizeCondition(linkage, condition))
            .filter(Boolean)
            .slice(0, MAX_MAPPINGS);
    }

    function filterCompatibleTargets(sourceDefinition, targetDefinitions) {
        return targetDefinitions.filter(targetDefinition => targetDefinition.type === sourceDefinition.type);
    }

    function filterCompatibleSources(targetDefinition, sourceDefinitions) {
        return sourceDefinitions.filter(sourceDefinition => sourceDefinition.type === targetDefinition.type);
    }

    function resolveDefaultTargetField(sourceFieldCode, targetDefinitions) {
        const sameCode = targetDefinitions.find(targetDefinition => targetDefinition.code === sourceFieldCode);
        return sameCode ? sameCode.code : '';
    }

    function createEmptyMapping() {
        return {
            sourceFieldCode: '',
            sourceLabel: '',
            sourceType: '',
            targetFieldCode: ''
        };
    }

    function enrichMapping(mapping, sourceDefinitions, targetDefinitions) {
        const sourceDefinition = getDefinitionByCode(sourceDefinitions, mapping.sourceFieldCode);
        const targetDefinition = getDefinitionByCode(targetDefinitions, mapping.targetFieldCode);

        if (!sourceDefinition && !targetDefinition) {
            return createEmptyMapping();
        }

        if (!sourceDefinition && targetDefinition) {
            return {
                sourceFieldCode: '',
                sourceLabel: '',
                sourceType: '',
                targetFieldCode: targetDefinition.code
            };
        }

        const compatibleTargets = filterCompatibleTargets(sourceDefinition, targetDefinitions);
        const targetFieldCode = compatibleTargets.some(target => target.code === mapping.targetFieldCode)
            ? mapping.targetFieldCode
            : '';

        return {
            sourceFieldCode: sourceDefinition.code,
            sourceLabel: sourceDefinition.label,
            sourceType: sourceDefinition.type,
            targetFieldCode
        };
    }

    function sanitizeMappings(sourceDefinitions, targetDefinitions, existingMappings) {
        return (existingMappings || [])
            .map(mapping => enrichMapping(mapping, sourceDefinitions, targetDefinitions))
            .filter(mapping => mapping.sourceFieldCode || mapping.targetFieldCode)
            .slice(0, MAX_MAPPINGS);
    }

    function appendMappingRow(mappings, sourceDefinitions, targetDefinitions) {
        if (mappings.length >= MAX_MAPPINGS || sourceDefinitions.length === 0) {
            return mappings;
        }

        return [...mappings, createEmptyMapping()];
    }

    function autoAppendMappings(mappings, sourceDefinitions, targetDefinitions) {
        let nextMappings = sanitizeMappings(sourceDefinitions, targetDefinitions, mappings);
        const existingSources = new Set(nextMappings.map(mapping => mapping.sourceFieldCode));

        sourceDefinitions.forEach((sourceDefinition) => {
            if (nextMappings.length >= MAX_MAPPINGS || existingSources.has(sourceDefinition.code)) {
                return;
            }

            const defaultTargetFieldCode = resolveDefaultTargetField(sourceDefinition.code, filterCompatibleTargets(sourceDefinition, targetDefinitions));
            if (!defaultTargetFieldCode) {
                return;
            }

            nextMappings.push({
                sourceFieldCode: sourceDefinition.code,
                sourceLabel: sourceDefinition.label,
                sourceType: sourceDefinition.type,
                targetFieldCode: defaultTargetFieldCode
            });
            existingSources.add(sourceDefinition.code);
        });

        return nextMappings.slice(0, MAX_MAPPINGS);
    }

    function appendConditionRow(linkage) {
        if (linkage.syncConditions.length >= MAX_MAPPINGS) {
            return linkage.syncConditions;
        }

        const defaultScope = linkage.sourceNormalDefinitions.length > 0 ? 'record' : 'table';
        const defaultDefinition = getConditionDefinitionsByScope(linkage, defaultScope)[0] || linkage.sourceTableDefinitions[0] || linkage.sourceNormalDefinitions[0];
        if (!defaultDefinition) {
            return linkage.syncConditions;
        }

        return [...linkage.syncConditions, createConditionFromDefinition(defaultScope, defaultDefinition)];
    }

    function clearLinkageFieldState(linkage, preserveSelections = false) {
        linkage.sourceRowIdentifierOptions = [];
        linkage.targetRowIdentifierOptions = [];
        linkage.targetMetaFieldOptions = [];
        linkage.sourceNormalDefinitions = [];
        linkage.sourceTableDefinitions = [];
        linkage.targetDefinitions = [];
        linkage.syncConditions = [];
        linkage.normalMappings = [];
        linkage.tableMappings = [];
        if (!preserveSelections) {
            linkage.sourceRowIdentifierField = '';
            linkage.targetRowIdentifierField = '';
            linkage.sourceRecordNumber = '';
            linkage.tableRowNumber = '';
        }
    }

    function syncActiveFormToState() {
        const linkage = getActiveLinkage();
        if (!linkage) {
            return;
        }

        linkage.tableFieldCode = dom.tableName.value;
        linkage.targetAppId = dom.targetAppId.value;
        linkage.sourceRowIdentifierField = dom.sourceRowIdentifierField.value;
        linkage.targetRowIdentifierField = dom.targetRowIdentifierField.value;
        linkage.sourceRecordNumber = dom.sourceRecordNumber.value;
        linkage.tableRowNumber = dom.tableRowNumber.value;
    }

    function renderTabs() {
        dom.linkageTabs.innerHTML = '';
        linkageConfigs.forEach((linkage, index) => {
            const tabWrapper = document.createElement('div');
            tabWrapper.className = `linkage-tab-wrap${index === activeLinkageIndex ? ' is-active' : ''}`;

            const tabButton = document.createElement('button');
            tabButton.type = 'button';
            tabButton.className = `linkage-tab${index === activeLinkageIndex ? ' is-active' : ''}`;
            tabButton.textContent = getLinkageTabLabel(linkage, index);
            tabButton.addEventListener('click', () => {
                syncActiveFormToState();
                activeLinkageIndex = index;
                renderTabs();
                renderActiveLinkage();
            });

            const deleteButton = document.createElement('button');
            deleteButton.type = 'button';
            deleteButton.className = 'linkage-tab-close';
            deleteButton.setAttribute('aria-label', `${getLinkageTabLabel(linkage, index)} を削除`);
            deleteButton.textContent = '×';
            deleteButton.addEventListener('click', (event) => {
                event.stopPropagation();
                syncActiveFormToState();

                if (linkageConfigs.length === 1) {
                    linkageConfigs = [createDefaultLinkageConfig(0)];
                    activeLinkageIndex = 0;
                } else {
                    linkageConfigs.splice(index, 1);
                    if (activeLinkageIndex >= linkageConfigs.length) {
                        activeLinkageIndex = linkageConfigs.length - 1;
                    } else if (activeLinkageIndex > index) {
                        activeLinkageIndex -= 1;
                    }
                }

                renderTabs();
                renderActiveLinkage();
            });

            tabWrapper.appendChild(tabButton);
            tabWrapper.appendChild(deleteButton);
            dom.linkageTabs.appendChild(tabWrapper);
        });
    }

    function renderMappingEditor(container, mappings, sourceDefinitions, targetDefinitions, emptyMessage, mappingType) {
        container.innerHTML = '';
        if (!mappings.length) {
            const empty = document.createElement('p');
            empty.className = 'mapping-empty';
            empty.textContent = emptyMessage;
            container.appendChild(empty);
            return;
        }

        mappings.forEach((mapping, index) => {
            const row = document.createElement('div');
            row.className = 'mapping-row';

            const target = document.createElement('div');
            target.className = 'mapping-target';

            const targetSelect = document.createElement('select');
            targetSelect.dataset.mappingType = mappingType;
            targetSelect.dataset.mappingRole = 'target';
            targetSelect.dataset.mappingIndex = String(index);

            const defaultOption = document.createElement('option');
            defaultOption.value = '';
            defaultOption.textContent = '選択してください';
            targetSelect.appendChild(defaultOption);

            const sourceDefinition = getDefinitionByCode(sourceDefinitions, mapping.sourceFieldCode);
            const usedTargetCodes = new Set(
                mappings
                    .filter((item, itemIndex) => itemIndex !== index)
                    .map(item => item.targetFieldCode)
                    .filter(Boolean)
            );
            const targetOptions = sourceDefinition
                ? filterCompatibleTargets(sourceDefinition, targetDefinitions)
                : targetDefinitions;
            targetOptions
                .filter(targetDefinition =>
                    targetDefinition.code === mapping.targetFieldCode || !usedTargetCodes.has(targetDefinition.code)
                )
                .forEach(targetDefinition => {
                const option = document.createElement('option');
                option.value = targetDefinition.code;
                option.textContent = formatFieldDisplayName(targetDefinition.label, targetDefinition.code);
                if (targetDefinition.code === mapping.targetFieldCode) {
                    option.selected = true;
                }
                targetSelect.appendChild(option);
            });

            target.appendChild(targetSelect);
            row.appendChild(target);

            const arrow = document.createElement('div');
            arrow.className = 'mapping-arrow';
            arrow.setAttribute('aria-hidden', 'true');
            arrow.textContent = '←';
            row.appendChild(arrow);

            const source = document.createElement('div');
            source.className = 'mapping-source';
            const sourceSelect = document.createElement('select');
            sourceSelect.dataset.mappingType = mappingType;
            sourceSelect.dataset.mappingRole = 'source';
            sourceSelect.dataset.mappingIndex = String(index);

            const sourceDefaultOption = document.createElement('option');
            sourceDefaultOption.value = '';
            sourceDefaultOption.textContent = '選択してください';
            sourceSelect.appendChild(sourceDefaultOption);

            const selectedTargetDefinition = getDefinitionByCode(targetDefinitions, mapping.targetFieldCode);
            const sourceOptions = selectedTargetDefinition
                ? filterCompatibleSources(selectedTargetDefinition, sourceDefinitions)
                : sourceDefinitions;
            sourceOptions.forEach(sourceDefinitionOption => {
                const option = document.createElement('option');
                option.value = sourceDefinitionOption.code;
                option.textContent = formatFieldDisplayName(sourceDefinitionOption.label, sourceDefinitionOption.code);
                if (sourceDefinitionOption.code === mapping.sourceFieldCode) {
                    option.selected = true;
                }
                sourceSelect.appendChild(option);
            });
            source.appendChild(sourceSelect);
            row.appendChild(source);

            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'mapping-remove';
            remove.dataset.mappingType = mappingType;
            remove.dataset.mappingRole = 'remove';
            remove.dataset.mappingIndex = String(index);
            remove.textContent = '×';
            row.appendChild(remove);

            container.appendChild(row);
        });
    }

    function renderConditionEditor(container, linkage) {
        container.innerHTML = '';

        if (!linkage.syncConditions.length) {
            const empty = document.createElement('p');
            empty.className = 'condition-empty';
            empty.textContent = '条件は未設定です。設定しない場合、すべての行が同期対象です。';
            container.appendChild(empty);
            return;
        }

        linkage.syncConditions.forEach((condition, index) => {
            const row = document.createElement('div');
            row.className = 'condition-row';

            const scopeSelect = document.createElement('select');
            scopeSelect.dataset.conditionRole = 'scope';
            scopeSelect.dataset.conditionIndex = String(index);
            [
                { value: 'record', label: '通常項目' },
                { value: 'table', label: 'テーブル項目' }
            ].forEach(optionData => {
                const option = document.createElement('option');
                option.value = optionData.value;
                option.textContent = optionData.label;
                if (optionData.value === condition.fieldScope) {
                    option.selected = true;
                }
                scopeSelect.appendChild(option);
            });

            const fieldSelect = document.createElement('select');
            fieldSelect.dataset.conditionRole = 'field';
            fieldSelect.dataset.conditionIndex = String(index);
            const fieldDefinitions = getConditionDefinitionsByScope(linkage, condition.fieldScope);
            fieldDefinitions.forEach((definition) => {
                const option = document.createElement('option');
                option.value = definition.code;
                option.textContent = formatFieldDisplayName(definition.label, definition.code);
                if (definition.code === condition.fieldCode) {
                    option.selected = true;
                }
                fieldSelect.appendChild(option);
            });

            const operatorSelect = document.createElement('select');
            operatorSelect.dataset.conditionRole = 'operator';
            operatorSelect.dataset.conditionIndex = String(index);
            getConditionOperatorOptions(condition.fieldType).forEach((operatorOption) => {
                const option = document.createElement('option');
                option.value = operatorOption.value;
                option.textContent = operatorOption.label;
                if (operatorOption.value === condition.operator) {
                    option.selected = true;
                }
                operatorSelect.appendChild(option);
            });

            const definition = getDefinitionByCode(fieldDefinitions, condition.fieldCode);
            const valueInputKind = getConditionValueInputKind(definition);
            let valueInput;
            if (valueInputKind === 'select') {
                valueInput = document.createElement('select');
                (definition?.options || []).forEach((optionData) => {
                    const option = document.createElement('option');
                    option.value = optionData.value;
                    option.textContent = optionData.label;
                    if (String(optionData.value) === String(condition.value)) {
                        option.selected = true;
                    }
                    valueInput.appendChild(option);
                });
            } else {
                valueInput = document.createElement('input');
                valueInput.type = valueInputKind === 'number' ? 'number' : valueInputKind;
                valueInput.value = condition.value;
            }
            valueInput.dataset.conditionRole = 'value';
            valueInput.dataset.conditionIndex = String(index);

            const removeButton = document.createElement('button');
            removeButton.type = 'button';
            removeButton.className = 'condition-remove';
            removeButton.dataset.conditionRole = 'remove';
            removeButton.dataset.conditionIndex = String(index);
            removeButton.textContent = '×';

            row.appendChild(scopeSelect);
            row.appendChild(fieldSelect);
            row.appendChild(operatorSelect);
            row.appendChild(valueInput);
            row.appendChild(removeButton);
            container.appendChild(row);
        });
    }

    function renderActiveLinkage() {
        const linkage = getActiveLinkage();
        if (!linkage) {
            return;
        }

        renderSelectOptions(dom.tableName, sourceTableOptions, linkage.tableFieldCode);
        renderSelectOptions(dom.targetAppId, appOptions, linkage.targetAppId);
        renderSelectOptions(dom.sourceRowIdentifierField, linkage.sourceRowIdentifierOptions, linkage.sourceRowIdentifierField);
        renderSelectOptions(dom.targetRowIdentifierField, linkage.targetRowIdentifierOptions, linkage.targetRowIdentifierField);
        renderSelectOptions(dom.sourceRecordNumber, linkage.targetMetaFieldOptions, linkage.sourceRecordNumber);
        renderSelectOptions(dom.tableRowNumber, linkage.targetMetaFieldOptions, linkage.tableRowNumber);
        renderConditionEditor(dom.conditionEditor, linkage);

        renderMappingEditor(
            dom.normalMappingsEditor,
            linkage.normalMappings,
            linkage.sourceNormalDefinitions,
            linkage.targetDefinitions,
            'テーブル名と更新先アプリを選択すると、通常フィールドの候補が表示されます。必要に応じて「項目再取得」を押してください。',
            'normal'
        );
        renderMappingEditor(
            dom.tableMappingsEditor,
            linkage.tableMappings,
            linkage.sourceTableDefinitions,
            linkage.targetDefinitions,
            'テーブル名と更新先アプリを選択すると、テーブル内フィールドの候補が表示されます。必要に応じて「項目再取得」を押してください。',
            'table'
        );
    }

    function isLinkageTouched(linkage) {
        return Boolean(
            linkage.tableFieldCode ||
            linkage.targetAppId ||
            linkage.sourceRowIdentifierField ||
            linkage.targetRowIdentifierField ||
            linkage.sourceRecordNumber ||
            linkage.tableRowNumber ||
            linkage.syncConditions.length ||
            linkage.normalMappings.length ||
            linkage.tableMappings.length
        );
    }

    function applySavedKeySelection(currentValue, sourceDefinitions, targetDefinitions) {
        if (currentValue && targetDefinitions.some(target => target.code === currentValue)) {
            return currentValue;
        }
        return resolveDefaultTargetField(sourceDefinitions[0]?.code || '', targetDefinitions);
    }

    async function loadFieldSettingsForLinkage(index, showSuccessMessage = false, showErrorAlert = true) {
        const linkage = linkageConfigs[index];
        if (!linkage) {
            return;
        }

        if (!linkage.tableFieldCode || !linkage.targetAppId) {
            if (showErrorAlert) {
                alert('全ての項目を選択または入力してください');
            }
            return;
        }

        const appId = kintone.app.getId();
        const sourceResponse = await kintone.api(
            kintone.api.url('/k/v1/app/form/fields', true),
            'GET',
            { app: appId }
        );
        const sourceLayoutFields = await fetchSourceLayoutFieldsInOrder(appId);
        const targetResponse = await kintone.api(
            kintone.api.url('/k/v1/app/form/fields', true),
            'GET',
            { app: linkage.targetAppId }
        );

        const selectedTableFieldDef = sourceResponse.properties[linkage.tableFieldCode];
        const excludeFields = [
            'レコード番号',
            '作業者',
            '更新者',
            '作成者',
            'ステータス',
            '更新日時',
            'カテゴリー',
            '作成日時',
        ];
        const excludedTypes = ['FILE', 'REFERENCE_TABLE', 'GROUP', 'SUBTABLE'];

        const sourceNormalDefinitions = sourceLayoutFields
            .filter(field => !field.subtableCode)
            .map(field => createFieldDefinition(sourceResponse.properties[field.code], field.code, field.label))
            .filter(definition =>
                definition.code &&
                !excludeFields.includes(definition.code) &&
                definition.type &&
                !excludedTypes.includes(definition.type)
            );

        const sourceTableFieldCodes = sourceLayoutFields
            .filter(field => field.subtableCode === linkage.tableFieldCode)
            .map(field => field.code);
        const fallbackTableFieldCodes = Object.keys(selectedTableFieldDef?.fields || {});
        const sourceTableDefinitions = (sourceTableFieldCodes.length > 0 ? sourceTableFieldCodes : fallbackTableFieldCodes)
            .map(code => createFieldDefinition(selectedTableFieldDef?.fields?.[code], code))
            .filter(definition =>
                definition.code &&
                definition.type &&
                !excludedTypes.includes(definition.type)
            );

        const targetDefinitions = Object.values(targetResponse.properties)
            .map(field => createFieldDefinition(field, field.code))
            .filter(definition =>
                definition.code &&
                !excludeFields.includes(definition.code) &&
                definition.type &&
                !excludedTypes.includes(definition.type)
            );

        const sourceRowIdentifierDefinitions = sourceTableDefinitions.filter(definition => definition.type === 'SINGLE_LINE_TEXT');
        const targetRowIdentifierDefinitions = targetDefinitions.filter(definition => definition.type === 'SINGLE_LINE_TEXT');
        const targetMetaFieldDefinitions = targetDefinitions.filter(definition => definition.type === 'SINGLE_LINE_TEXT' || definition.type === 'NUMBER');

        linkage.sourceNormalDefinitions = sourceNormalDefinitions;
        linkage.sourceTableDefinitions = sourceTableDefinitions;
        linkage.targetDefinitions = targetDefinitions;
        linkage.sourceRowIdentifierOptions = buildFieldOptions(sourceRowIdentifierDefinitions);
        linkage.targetRowIdentifierOptions = buildFieldOptions(targetRowIdentifierDefinitions);
        linkage.targetMetaFieldOptions = buildFieldOptions(targetMetaFieldDefinitions);
        linkage.syncConditions = sanitizeConditions(linkage, linkage.syncConditions);
        linkage.normalMappings = sanitizeMappings(sourceNormalDefinitions, targetDefinitions, linkage.normalMappings);
        linkage.tableMappings = sanitizeMappings(sourceTableDefinitions, targetDefinitions, linkage.tableMappings);

        linkage.sourceRowIdentifierField = sourceRowIdentifierDefinitions.some(definition => definition.code === linkage.sourceRowIdentifierField)
            ? linkage.sourceRowIdentifierField
            : sourceRowIdentifierDefinitions[0]?.code || '';

        const compatibleKeyTargets = linkage.sourceRowIdentifierField
            ? filterCompatibleTargets({ type: 'SINGLE_LINE_TEXT' }, targetRowIdentifierDefinitions)
            : targetRowIdentifierDefinitions;
        if (!compatibleKeyTargets.some(definition => definition.code === linkage.targetRowIdentifierField)) {
            linkage.targetRowIdentifierField = resolveDefaultTargetField(linkage.sourceRowIdentifierField, compatibleKeyTargets);
        }

        if (!targetMetaFieldDefinitions.some(definition => definition.code === linkage.sourceRecordNumber)) {
            linkage.sourceRecordNumber = '';
        }
        if (!targetMetaFieldDefinitions.some(definition => definition.code === linkage.tableRowNumber)) {
            linkage.tableRowNumber = '';
        }

        if (activeLinkageIndex === index) {
            renderTabs();
            renderActiveLinkage();
        }

        if (!linkage.sourceRowIdentifierOptions.length && showErrorAlert) {
            alert('更新元テーブル側に、更新キー候補となる文字列項目が見つかりません。');
        } else if (!linkage.targetRowIdentifierOptions.length && showErrorAlert) {
            alert('更新先アプリ側に、更新キー候補となる文字列項目が見つかりません。');
        } else if (showSuccessMessage) {
            alert('項目取得が完了しました。必要に応じて追加または自動マッピングを実行してください。');
        }
    }

    async function reloadFieldSettingsForActiveLinkage(showSuccessMessage = false, showErrorAlert = true) {
        syncActiveFormToState();
        const linkage = getActiveLinkage();
        if (!linkage || !linkage.tableFieldCode || !linkage.targetAppId) {
            return;
        }

        try {
            await loadFieldSettingsForLinkage(activeLinkageIndex, showSuccessMessage, showErrorAlert);
        } catch (error) {
            console.error('エラー:', error);
            alert('更新先アプリの項目取得中にエラーが発生しました。更新先アプリとルックアップ参照先アプリの閲覧権限があること、および更新先アプリで「アプリを更新」済みであることを確認してください。');
        }
    }

    function createSerializableLinkage(linkage, index) {
        const syncConditions = sanitizeConditions(linkage, linkage.syncConditions)
            .filter(condition => condition.fieldCode && condition.operator);
        const normalMappings = linkage.normalMappings.filter(mapping => mapping.sourceFieldCode && mapping.targetFieldCode);
        const tableMappings = linkage.tableMappings.filter(mapping => mapping.sourceFieldCode && mapping.targetFieldCode);

        return {
            id: linkage.id || `linkage-${index + 1}`,
            title: getLinkageTabLabel(linkage, index),
            tableFieldCode: linkage.tableFieldCode,
            targetAppId: linkage.targetAppId,
            rowIdentifierField: linkage.sourceRowIdentifierField,
            sourceRowIdentifierField: linkage.sourceRowIdentifierField,
            targetRowIdentifierField: linkage.targetRowIdentifierField,
            sourceRecordNumber: linkage.sourceRecordNumber,
            tableRowNumber: linkage.tableRowNumber,
            syncConditions,
            normalMappings,
            tableMappings,
            variables: normalMappings.map(mapping => mapping.sourceFieldCode).slice(0, MAX_MAPPINGS),
            rowVariables: tableMappings.map(mapping => mapping.sourceFieldCode).slice(0, MAX_MAPPINGS)
        };
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
    }

    async function initialize() {
        try {
            await fetchAllApps();
            await fetchSourceTableOptions();
        } catch (error) {
            console.error('初期データ取得エラー:', error);
            alert('設定画面の初期化に失敗しました。');
            return;
        }

        renderTabs();
        renderActiveLinkage();

        await authenticateOnInitialize();

        for (let i = 0; i < linkageConfigs.length; i++) {
            const linkage = linkageConfigs[i];
            if (linkage.tableFieldCode && linkage.targetAppId) {
                try {
                    await loadFieldSettingsForLinkage(i, false, false);
                } catch (error) {
                    console.error(`連携${i + 1}の初期表示に失敗しました:`, error);
                }
            }
        }

        renderTabs();
        renderActiveLinkage();
    }

    dom.addLinkageButton.addEventListener('click', () => {
        syncActiveFormToState();
        if (linkageConfigs.length >= MAX_LINKAGES) {
            alert('連携設定は最大5件までです。');
            return;
        }

        linkageConfigs.push(createDefaultLinkageConfig(linkageConfigs.length));
        activeLinkageIndex = linkageConfigs.length - 1;
        renderTabs();
        renderActiveLinkage();
    });

    dom.tableName.addEventListener('change', async () => {
        const linkage = getActiveLinkage();
        if (!linkage) {
            return;
        }
        linkage.tableFieldCode = dom.tableName.value;
        clearLinkageFieldState(linkage);
        renderTabs();
        renderActiveLinkage();
        await reloadFieldSettingsForActiveLinkage(false, true);
    });

    dom.targetAppId.addEventListener('change', async () => {
        const linkage = getActiveLinkage();
        if (!linkage) {
            return;
        }
        linkage.targetAppId = dom.targetAppId.value;
        clearLinkageFieldState(linkage);
        renderActiveLinkage();
        await reloadFieldSettingsForActiveLinkage(false, true);
    });

    dom.sourceRowIdentifierField.addEventListener('change', () => {
        const linkage = getActiveLinkage();
        if (linkage) {
            linkage.sourceRowIdentifierField = dom.sourceRowIdentifierField.value;
        }
    });

    dom.targetRowIdentifierField.addEventListener('change', () => {
        const linkage = getActiveLinkage();
        if (linkage) {
            linkage.targetRowIdentifierField = dom.targetRowIdentifierField.value;
        }
    });

    dom.sourceRecordNumber.addEventListener('change', () => {
        const linkage = getActiveLinkage();
        if (linkage) {
            linkage.sourceRecordNumber = dom.sourceRecordNumber.value;
        }
    });

    dom.tableRowNumber.addEventListener('change', () => {
        const linkage = getActiveLinkage();
        if (linkage) {
            linkage.tableRowNumber = dom.tableRowNumber.value;
        }
    });

    function updateConditionFromControl(conditionIndex, role, value) {
        const linkage = getActiveLinkage();
        if (!linkage) {
            return;
        }

        const index = Number(conditionIndex);
        if (Number.isNaN(index) || !linkage.syncConditions[index]) {
            return;
        }

        const current = linkage.syncConditions[index];
        if (role === 'scope') {
            const nextScope = value === 'table' ? 'table' : 'record';
            const nextDefinition = getConditionDefinitionsByScope(linkage, nextScope)[0];
            linkage.syncConditions[index] = nextDefinition
                ? createConditionFromDefinition(nextScope, nextDefinition)
                : {
                    fieldScope: nextScope,
                    fieldCode: '',
                    fieldType: '',
                    operator: '',
                    value: ''
                };
        } else if (role === 'field') {
            const definition = getDefinitionByCode(getConditionDefinitionsByScope(linkage, current.fieldScope), value);
            linkage.syncConditions[index] = definition
                ? createConditionFromDefinition(current.fieldScope, definition)
                : current;
        } else if (role === 'operator') {
            current.operator = value;
        } else if (role === 'value') {
            current.value = value;
        }

        linkage.syncConditions = sanitizeConditions(linkage, linkage.syncConditions);
        renderActiveLinkage();
    }

    function removeConditionRow(conditionIndex) {
        const linkage = getActiveLinkage();
        if (!linkage) {
            return;
        }

        const index = Number(conditionIndex);
        if (Number.isNaN(index)) {
            return;
        }

        linkage.syncConditions = linkage.syncConditions.filter((_, itemIndex) => itemIndex !== index);
        renderActiveLinkage();
    }

    dom.conditionEditor.addEventListener('change', (event) => {
        const target = event.target;
        if (!(target instanceof HTMLSelectElement) && !(target instanceof HTMLInputElement)) {
            return;
        }

        updateConditionFromControl(target.dataset.conditionIndex, target.dataset.conditionRole, target.value);
    });

    dom.conditionEditor.addEventListener('click', (event) => {
        const button = event.target;
        if (!(button instanceof HTMLButtonElement)) {
            return;
        }
        if (button.dataset.conditionRole !== 'remove') {
            return;
        }
        removeConditionRow(button.dataset.conditionIndex);
    });

    dom.addConditionButton.addEventListener('click', () => {
        const linkage = getActiveLinkage();
        if (!linkage) {
            return;
        }
        linkage.syncConditions = appendConditionRow(linkage);
        renderActiveLinkage();
    });

    function updateMappingFromSelect(mappingType, mappingIndex, role, value) {
        const linkage = getActiveLinkage();
        if (!linkage) {
            return;
        }

        const sourceDefinitions = mappingType === 'normal' ? linkage.sourceNormalDefinitions : linkage.sourceTableDefinitions;
        const mappings = mappingType === 'normal' ? linkage.normalMappings : linkage.tableMappings;
        const index = Number(mappingIndex);
        if (Number.isNaN(index) || !mappings[index]) {
            return;
        }

        if (role === 'source') {
            mappings[index] = enrichMapping({ sourceFieldCode: value, targetFieldCode: mappings[index].targetFieldCode }, sourceDefinitions, linkage.targetDefinitions);
        } else if (role === 'target') {
            const currentSourceDefinition = getDefinitionByCode(sourceDefinitions, mappings[index].sourceFieldCode);
            const nextTargetDefinition = getDefinitionByCode(linkage.targetDefinitions, value);
            const nextSourceFieldCode = currentSourceDefinition && nextTargetDefinition && currentSourceDefinition.type !== nextTargetDefinition.type
                ? ''
                : mappings[index].sourceFieldCode;
            mappings[index] = enrichMapping({ sourceFieldCode: nextSourceFieldCode, targetFieldCode: value }, sourceDefinitions, linkage.targetDefinitions);
        }

        if (mappingType === 'normal') {
            linkage.normalMappings = sanitizeMappings(sourceDefinitions, linkage.targetDefinitions, mappings);
        } else {
            linkage.tableMappings = sanitizeMappings(sourceDefinitions, linkage.targetDefinitions, mappings);
        }
        renderActiveLinkage();
    }

    function removeMappingRow(mappingType, mappingIndex) {
        const linkage = getActiveLinkage();
        if (!linkage) {
            return;
        }

        const index = Number(mappingIndex);
        if (Number.isNaN(index)) {
            return;
        }

        if (mappingType === 'normal') {
            linkage.normalMappings = linkage.normalMappings.filter((_, itemIndex) => itemIndex !== index);
        } else {
            linkage.tableMappings = linkage.tableMappings.filter((_, itemIndex) => itemIndex !== index);
        }
        renderActiveLinkage();
    }

    function bindMappingEditorEvents(container) {
        container.addEventListener('change', (event) => {
            const select = event.target;
            if (!(select instanceof HTMLSelectElement)) {
                return;
            }
            updateMappingFromSelect(
                select.dataset.mappingType,
                select.dataset.mappingIndex,
                select.dataset.mappingRole,
                select.value
            );
        });

        container.addEventListener('click', (event) => {
            const button = event.target;
            if (!(button instanceof HTMLButtonElement)) {
                return;
            }
            if (button.dataset.mappingRole !== 'remove') {
                return;
            }
            removeMappingRow(button.dataset.mappingType, button.dataset.mappingIndex);
        });
    }

    bindMappingEditorEvents(dom.normalMappingsEditor);
    bindMappingEditorEvents(dom.tableMappingsEditor);

    dom.addNormalMappingButton.addEventListener('click', () => {
        const linkage = getActiveLinkage();
        if (!linkage) {
            return;
        }
        linkage.normalMappings = appendMappingRow(linkage.normalMappings, linkage.sourceNormalDefinitions, linkage.targetDefinitions);
        renderActiveLinkage();
    });

    dom.addTableMappingButton.addEventListener('click', () => {
        const linkage = getActiveLinkage();
        if (!linkage) {
            return;
        }
        linkage.tableMappings = appendMappingRow(linkage.tableMappings, linkage.sourceTableDefinitions, linkage.targetDefinitions);
        renderActiveLinkage();
    });

    dom.autoNormalMappingButton.addEventListener('click', () => {
        const linkage = getActiveLinkage();
        if (!linkage) {
            return;
        }
        linkage.normalMappings = autoAppendMappings(linkage.normalMappings, linkage.sourceNormalDefinitions, linkage.targetDefinitions);
        renderActiveLinkage();
    });

    dom.autoTableMappingButton.addEventListener('click', () => {
        const linkage = getActiveLinkage();
        if (!linkage) {
            return;
        }
        linkage.tableMappings = autoAppendMappings(linkage.tableMappings, linkage.sourceTableDefinitions, linkage.targetDefinitions);
        renderActiveLinkage();
    });

    dom.fetchFieldsButton.addEventListener('click', async () => {
        await reloadFieldSettingsForActiveLinkage(true, true);
    });

    dom.saveButton.addEventListener('click', async () => {
        try {
            if (!authState.checked || !authState.isValid) {
                alert(buildReloadPromptMessage('認証が完了していないため保存できません。'));
                return;
            }

            syncActiveFormToState();

            const linkageConfigsToSave = linkageConfigs
                .filter(isLinkageTouched)
                .slice(0, MAX_LINKAGES)
                .map((linkage, index) => createSerializableLinkage(linkage, index));

            if (!linkageConfigsToSave.length) {
                alert('少なくとも1件の連携設定を入力してください。');
                return;
            }

            const invalidLinkageIndex = linkageConfigsToSave.findIndex(linkage =>
                !linkage.targetAppId ||
                !linkage.tableFieldCode ||
                !linkage.sourceRowIdentifierField ||
                !linkage.targetRowIdentifierField
            );
            if (invalidLinkageIndex !== -1) {
                alert(`連携${invalidLinkageIndex + 1}の必須項目を入力してください。`);
                return;
            }

            const firstLinkage = linkageConfigsToSave[0];
            const configToSave = {
                linkageConfigsJson: JSON.stringify(linkageConfigsToSave),
                targetAppId: firstLinkage.targetAppId,
                tableFieldCode: firstLinkage.tableFieldCode,
                rowIdentifierField: firstLinkage.sourceRowIdentifierField,
                sourceRecordNumber: firstLinkage.sourceRecordNumber,
                tableRowNumber: firstLinkage.tableRowNumber,
                hideKeyField: dom.hideKeyField.checked.toString(),
                suppressSuccessMessage: dom.suppressSuccessMessage.checked.toString(),
                authStatus: 'valid'
            };

            if (authState.trialEndDate) {
                configToSave.Trial_enddate = authState.trialEndDate;
            }

            for (let i = 1; i <= MAX_MAPPINGS; i++) {
                configToSave[`VARIABLE_${i}`] = firstLinkage.variables[i - 1] || '';
                configToSave[`ROW_VARIABLE_${i}`] = firstLinkage.rowVariables[i - 1] || '';
            }

            kintone.plugin.app.setConfig(configToSave);
        } catch (error) {
            console.error('設定保存エラー:', error);
            alert('設定保存中にエラーが発生しました。');
        }
    });

    dom.cancelButton.addEventListener('click', () => {
        window.location.href = `/k/admin/app/${kintone.app.getId()}/plugin/`;
    });

    await initialize();
})(kintone.$PLUGIN_ID);
