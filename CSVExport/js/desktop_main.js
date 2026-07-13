((PLUGIN_ID) => {
  'use strict';

  const BUTTON_CLASS = 'custom-csv-export-button';
  const BUTTON_MARGIN_LEFT = '8px';
  const INDEX_SHOW_EVENTS = ['app.record.index.show'];
  const GET_RECORDS_LIMIT = 500;
  const UPDATE_RECORDS_LIMIT = 100;
  const FILE_NAME_DATE_FORMAT = 'YYYYMMDD_HHmmss';
  const DEFAULT_ENCODING = 'UTF-8-BOM';
  const DEFAULT_QUOTE_MODE = 'DOUBLE_ALWAYS';
  const DEFAULT_LINE_ENDING = 'CRLF';
  const DEFAULT_INCLUDE_HEADER = true;
  const DEFAULT_DATE_FORMAT = 'YYYY-MM-DD';
  const DEFAULT_FILE_NAME_TEMPLATE = '{CSV定義名}_YYYYMMDDHHmmss';
  const SUPPORTED_UPDATE_TYPES = [
    'SINGLE_LINE_TEXT',
    'MULTI_LINE_TEXT',
    'NUMBER',
    'DROP_DOWN',
    'RADIO_BUTTON',
    'CHECK_BOX',
    'MULTI_SELECT'
  ];

  const config = kintone.plugin.app.getConfig(PLUGIN_ID) || {};
  const definitions = parseDefinitions(config.definitions);
  const cache = {
    appInfoById: {},
    fieldMapByApp: {},
    viewsByApp: {}
  };
  let latestIndexState = null;

  if (definitions.length === 0) {
    return;
  }

  kintone.events.on(INDEX_SHOW_EVENTS, (event) => {
    latestIndexState = {
      appId: kintone.app.getId(),
      viewId: resolveCurrentViewId(event),
      viewName: resolveCurrentViewName(event),
      query: resolveCurrentQuery(event)
    };

    renderExportButtons();
    return event;
  });

  function parseDefinitions(serialized) {
    if (!serialized) {
      return [];
    }

    try {
      const parsed = JSON.parse(serialized);
      if (!Array.isArray(parsed)) {
        return [];
      }

      return parsed.map((definition, index) => ({
        id: String(definition.id || `definition_${index + 1}`),
        name: String(definition.name || `定義${index + 1}`),
        buttonLabel: String(definition.buttonLabel || 'CSV出力'),
        targetViewIds: Array.isArray(definition.targetViewIds)
          ? definition.targetViewIds.map((value) => String(value))
          : [],
        updateFieldCode: String(definition.updateFieldCode || ''),
        updateValue: typeof definition.updateValue === 'undefined' ? '' : definition.updateValue,
        encoding: String(definition.encoding || DEFAULT_ENCODING),
        maxExportCount: Number(definition.maxExportCount || 1000),
        quoteMode: String(definition.quoteMode || DEFAULT_QUOTE_MODE),
        lineEnding: String(definition.lineEnding || DEFAULT_LINE_ENDING),
        includeHeader: typeof definition.includeHeader === 'boolean'
          ? definition.includeHeader
          : definition.includeHeader !== false && definition.includeHeader !== 'false',
        dateFormat: String(definition.dateFormat || DEFAULT_DATE_FORMAT),
        fileNameTemplate: String(definition.fileNameTemplate || DEFAULT_FILE_NAME_TEMPLATE)
      }));
    } catch (error) {
      console.error('CSV出力定義の読み込みに失敗しました。', error);
      return [];
    }
  }

  function renderExportButtons() {
    const headerSpace = kintone.app.getHeaderMenuSpaceElement();
    if (!headerSpace || !latestIndexState) {
      return;
    }

    Array.from(headerSpace.querySelectorAll(`.${BUTTON_CLASS}`)).forEach((button) => {
      button.remove();
    });

    getAvailableDefinitions(latestIndexState).forEach((definition) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `${BUTTON_CLASS} kintoneplugin-button-normal`;
      button.dataset.definitionId = definition.id;
      button.textContent = definition.buttonLabel;
      button.style.marginLeft = BUTTON_MARGIN_LEFT;
      button.addEventListener('click', () => {
        handleExportButtonClick(definition, button);
      });
      headerSpace.appendChild(button);
    });
  }

  function getAvailableDefinitions(indexState) {
    return definitions.filter((definition) => {
      if (!definition.targetViewIds || definition.targetViewIds.length === 0) {
        return false;
      }
      if (definition.targetViewIds.indexOf(String(indexState.viewId || '')) === -1) {
        return false;
      }
      return true;
    });
  }

  async function handleExportButtonClick(definition, button) {
    if (!latestIndexState) {
      return;
    }
    if (!window.isAuthenticated || !window.isAuthenticated()) {
      alert('認証が完了していないため、CSV出力できません。');
      return;
    }

    setButtonDisabled(button, true);
    showLoading('CSV出力中...');

    try {
      const context = await buildExportContext(latestIndexState, definition);
      const totalCount = await fetchTotalCount(context.appId, context.query);

      if (totalCount > context.maxExportCount) {
        alert(`出力対象件数が${context.maxExportCount}件を超えているため、CSV出力を中止しました。`);
        return;
      }

      const records = await fetchAllRecords(context.appId, context.query, context.fieldCodesForFetch, totalCount);
      const orderedRows = buildOrderedRows(context.columns, records, context.csvOptions);
      const csvText = buildCsvFromOrderedRows(context.columns, orderedRows, context.csvOptions);

      if (context.updateFieldCode && records.length > 0) {
        showLoading('CSV出力後の更新中...');
        await updateExportFlagsAtomically(context, records);
      }

      startCsvDownload(context.fileName, csvText, context.encoding);
    } catch (error) {
      console.error(error);
      alert(buildErrorMessage(error));
    } finally {
      hideLoading();
      setButtonDisabled(button, false);
    }
  }

  async function buildExportContext(indexState, definition) {
    const appId = indexState.appId;
    const appInfo = await fetchAppInfo(appId);
    const fieldMap = await fetchFieldMap(appId);
    const viewInfo = await fetchCurrentViewInfo(indexState, appId);
    const visibleColumns = resolveVisibleColumnsFromRenderedList(fieldMap, viewInfo.fields);
    const updateField = definition.updateFieldCode ? fieldMap[definition.updateFieldCode] : null;

    if (visibleColumns.length === 0) {
      throw new Error('表示中の一覧列を取得できませんでした。');
    }
    if (definition.updateFieldCode && !updateField) {
      throw new Error(`更新対象フィールドが見つかりません: ${definition.updateFieldCode}`);
    }
    if (updateField && SUPPORTED_UPDATE_TYPES.indexOf(updateField.type) === -1) {
      throw new Error(`未対応の更新対象フィールド型です: ${updateField.type}`);
    }

    const columns = visibleColumns.map((fieldInfo) => {
      return {
        code: fieldInfo.code,
        label: fieldInfo.label || fieldInfo.code,
        subtableCode: fieldInfo.subtableCode || null
      };
    });
    const visibleFieldCodesForFetch = columns.map((column) => column.subtableCode || column.code);

    return {
      appId,
      query: indexState.query,
      viewId: viewInfo.id,
      viewName: viewInfo.name,
      definitionName: definition.name,
      columns,
      fieldCodesForFetch: unique(['$id', '$revision'].concat(definition.updateFieldCode ? [definition.updateFieldCode] : [], visibleFieldCodesForFetch)),
      fileName: buildFileName(
        definition.fileNameTemplate || DEFAULT_FILE_NAME_TEMPLATE,
        appInfo.name,
        viewInfo.name,
        definition.name
      ),
      encoding: definition.encoding || DEFAULT_ENCODING,
      maxExportCount: Number(definition.maxExportCount || 1000),
      updateFieldCode: definition.updateFieldCode,
      updateFieldType: updateField ? updateField.type : '',
      updateValue: definition.updateValue,
      csvOptions: {
        quoteMode: definition.quoteMode || DEFAULT_QUOTE_MODE,
        lineEnding: definition.lineEnding || DEFAULT_LINE_ENDING,
        includeHeader: definition.includeHeader !== false && definition.includeHeader !== 'false',
        dateFormat: definition.dateFormat || DEFAULT_DATE_FORMAT
      }
    };
  }

  async function fetchAppInfo(appId) {
    if (cache.appInfoById[appId]) {
      return cache.appInfoById[appId];
    }

    cache.appInfoById[appId] = await kintone.api(kintone.api.url('/k/v1/app.json', true), 'GET', {
      id: appId
    });
    return cache.appInfoById[appId];
  }

  async function fetchCurrentViewInfo(indexState, appId) {
    const views = await fetchViews(appId);
    const currentViewId = String(indexState.viewId || '');
    const currentViewName = String(indexState.viewName || '');

    let matchedView = (views || []).find((view) => String(view.id) === currentViewId) || null;
    if (!matchedView && currentViewName) {
      matchedView = (views || []).find((view) => view.name === currentViewName) || null;
    }

    if (matchedView) {
      return {
        id: String(matchedView.id || ''),
        name: matchedView.name || currentViewName || '一覧',
        fields: Array.isArray(matchedView.fields) ? matchedView.fields.map((fieldCode) => String(fieldCode)) : []
      };
    }

    return {
      id: currentViewId,
      name: currentViewName || '一覧',
      fields: []
    };
  }

  async function fetchViews(appId) {
    if (cache.viewsByApp[appId]) {
      return cache.viewsByApp[appId];
    }

    try {
      const response = await kintone.api(kintone.api.url('/k/v1/app/views.json', true), 'GET', {
        app: appId
      });
      cache.viewsByApp[appId] = Object.keys(response.views || {}).map((name) => {
        const view = response.views[name] || {};
        return {
          id: String(view.id || ''),
          name: view.name || name,
          fields: Array.isArray(view.fields) ? view.fields : []
        };
      });
      return cache.viewsByApp[appId];
    } catch (error) {
      console.warn('一覧設定の取得に失敗したため、画面表示から列を推測します。', error);
      const views = await kintone.app.getViews();
      cache.viewsByApp[appId] = Array.isArray(views) ? views : [];
      return cache.viewsByApp[appId];
    }
  }

  async function fetchFieldMap(appId) {
    if (cache.fieldMapByApp[appId]) {
      return cache.fieldMapByApp[appId];
    }

    const response = await kintone.api(kintone.api.url('/k/v1/app/form/fields.json', true), 'GET', {
      app: appId
    });

    cache.fieldMapByApp[appId] = flattenFieldProperties(response.properties);
    return cache.fieldMapByApp[appId];
  }

  function flattenFieldProperties(properties) {
    const fieldMap = {};

    Object.keys(properties).forEach((fieldCode) => {
      const field = properties[fieldCode];
      fieldMap[fieldCode] = {
        code: fieldCode,
        label: field.label || fieldCode,
        type: field.type,
        options: field.options || {},
        subtableCode: null,
        subtableLabel: ''
      };

      if (field.type === 'SUBTABLE' && field.fields) {
        Object.keys(field.fields).forEach((subFieldCode) => {
          const subField = field.fields[subFieldCode];
          fieldMap[subFieldCode] = {
            code: subFieldCode,
            label: subField.label || subFieldCode,
            type: subField.type,
            options: subField.options || {},
            subtableCode: fieldCode,
            subtableLabel: field.label || fieldCode
          };
        });
      }
    });

    return fieldMap;
  }

  async function fetchTotalCount(appId, query) {
    const response = await kintone.api(kintone.api.url('/k/v1/records.json', true), 'GET', {
      app: appId,
      query: appendLimitOffset(query, 1, 0),
      totalCount: true,
      fields: ['$id']
    });

    return Number(response.totalCount || 0);
  }

  async function fetchAllRecords(appId, query, fieldCodes, totalCount) {
    if (totalCount === 0) {
      return [];
    }

    let records = [];
    let offset = 0;

    while (offset < totalCount) {
      const limit = Math.min(GET_RECORDS_LIMIT, totalCount - offset);
      const response = await kintone.api(kintone.api.url('/k/v1/records.json', true), 'GET', {
        app: appId,
        query: appendLimitOffset(query, limit, offset),
        fields: fieldCodes
      });
      records = records.concat(response.records);
      offset += limit;
    }

    return records;
  }

  async function updateExportFlagsAtomically(context, records) {
    const recordBatches = chunk(records, UPDATE_RECORDS_LIMIT);
    const successfulSnapshots = [];

    for (let i = 0; i < recordBatches.length; i += 1) {
      const batch = recordBatches[i];
      try {
        await updateExportFlagsByBatch(context, batch);
        successfulSnapshots.push(...batch.map((record) => ({
          id: record.$id.value,
          previousValue: deepCloneValue(record[context.updateFieldCode] ? record[context.updateFieldCode].value : '')
        })));
      } catch (error) {
        const rollbackFailures = await rollbackUpdatedRecords(context, successfulSnapshots);
        const rollbackSuffix = rollbackFailures.length > 0
          ? `\nロールバック失敗レコードID: ${rollbackFailures.join(', ')}`
          : '';
        throw new Error(`更新処理に失敗したためCSV出力を中止しました。${rollbackSuffix}`);
      }
    }
  }

  function updateExportFlagsByBatch(context, records) {
    return kintone.api(kintone.api.url('/k/v1/records.json', true), 'PUT', {
      app: context.appId,
      records: records.map((record) => ({
        id: record.$id.value,
        revision: record.$revision && record.$revision.value ? record.$revision.value : undefined,
        record: buildUpdateRecord(context.updateFieldCode, context.updateFieldType, context.updateValue)
      }))
    });
  }

  async function rollbackUpdatedRecords(context, snapshots) {
    const failures = [];
    const batches = chunk(snapshots, UPDATE_RECORDS_LIMIT);

    for (let i = batches.length - 1; i >= 0; i -= 1) {
      const batch = batches[i];
      try {
        await kintone.api(kintone.api.url('/k/v1/records.json', true), 'PUT', {
          app: context.appId,
          records: batch.map((snapshot) => ({
            id: snapshot.id,
            record: buildRollbackRecord(context.updateFieldCode, snapshot.previousValue)
          }))
        });
      } catch (error) {
        console.error('ロールバックに失敗しました。', error);
        failures.push(...batch.map((snapshot) => snapshot.id));
      }
    }

    return failures;
  }

  function buildUpdateRecord(fieldCode, fieldType, updateValue) {
    const record = {};
    let value;

    switch (fieldType) {
      case 'CHECK_BOX':
      case 'MULTI_SELECT':
        value = Array.isArray(updateValue) ? updateValue : [];
        break;
      case 'NUMBER':
        value = updateValue === '' || updateValue === null ? '' : String(updateValue);
        break;
      default:
        value = Array.isArray(updateValue) ? '' : String(updateValue || '');
        break;
    }

    record[fieldCode] = { value };
    return record;
  }

  function buildRollbackRecord(fieldCode, previousValue) {
    const record = {};
    record[fieldCode] = {
      value: deepCloneValue(previousValue)
    };
    return record;
  }

  function buildCsvFromOrderedRows(columns, orderedRows, csvOptions) {
    const lineEnding = csvOptions.lineEnding === 'LF' ? '\n' : '\r\n';
    const headerColumns = hasSubtableColumns(columns)
      ? [{ label: 'レコードの開始行' }].concat(columns)
      : columns;
    const dataRows = orderedRows.map((row) => {
      return row.map((value) => escapeCsvValue(value, csvOptions.quoteMode)).join(',');
    });

    if (csvOptions.includeHeader === false) {
      return dataRows.join(lineEnding);
    }

    const headerRow = headerColumns.map((column) => escapeCsvValue(column.label, csvOptions.quoteMode)).join(',');
    return [headerRow].concat(dataRows).join(lineEnding);
  }

  function buildOrderedRows(columns, records, csvOptions) {
    if (hasSubtableColumns(columns)) {
      return records.reduce((rows, record) => {
        return rows.concat(buildSubtableExpandedRows(columns, record, csvOptions));
      }, []);
    }

    return records.map((record) => {
      return columns.map((column) => {
        return formatColumnValue(record, column, csvOptions);
      });
    });
  }

  function hasSubtableColumns(columns) {
    return columns.some((column) => Boolean(column.subtableCode));
  }

  function buildSubtableExpandedRows(columns, record, csvOptions) {
    const rowCount = getMaxSubtableRowCount(columns, record);

    return Array.from({ length: rowCount }).map((_, rowIndex) => {
      return [rowIndex === 0 ? '*' : ''].concat(columns.map((column) => {
        if (column.subtableCode) {
          return formatSubtableFieldValueAt(record[column.subtableCode], column.code, rowIndex, csvOptions);
        }
        return formatFieldValue(record[column.code], csvOptions);
      }));
    });
  }

  function getMaxSubtableRowCount(columns, record) {
    const counts = columns.filter((column) => column.subtableCode).map((column) => {
      const tableField = record[column.subtableCode];
      return tableField && Array.isArray(tableField.value) ? tableField.value.length : 0;
    });

    return Math.max(1, ...counts);
  }

  function formatColumnValue(record, column, csvOptions) {
    if (column.subtableCode) {
      return formatSubtableFieldValue(record[column.subtableCode], column.code, csvOptions);
    }
    return formatFieldValue(record[column.code], csvOptions);
  }

  function formatSubtableFieldValue(tableField, fieldCode, csvOptions) {
    if (!tableField || !Array.isArray(tableField.value)) {
      return '';
    }

    return tableField.value.map((row) => {
      const rowValue = row && row.value ? row.value : {};
      return formatFieldValue(rowValue[fieldCode], csvOptions);
    }).join('\n');
  }

  function formatSubtableFieldValueAt(tableField, fieldCode, rowIndex, csvOptions) {
    if (!tableField || !Array.isArray(tableField.value)) {
      return '';
    }

    const row = tableField.value[rowIndex];
    if (!row || !row.value) {
      return '';
    }

    return formatFieldValue(row.value[fieldCode], csvOptions);
  }

  function formatFieldValue(field, csvOptions) {
    if (!field) {
      return '';
    }

    const value = field.value;

    switch (field.type) {
      case 'DATE':
      case 'DATETIME':
        return formatDateFieldValue(value, field.type, csvOptions.dateFormat);
      case 'USER_SELECT':
        return (value || []).map((item) => item.code || item.name || '').join(',');
      case 'ORGANIZATION_SELECT':
      case 'GROUP_SELECT':
      case 'STATUS_ASSIGNEE':
        return (value || []).map((item) => item.name || item.code || '').join(',');
      case 'CHECK_BOX':
      case 'MULTI_SELECT':
      case 'CATEGORY':
        return (value || []).join(',');
      case 'FILE':
        return (value || []).map((file) => file.name || '').join(',');
      case 'CREATOR':
      case 'MODIFIER':
        return value && value.name ? value.name : '';
      default:
        if (Array.isArray(value)) {
          return value.join(',');
        }
        if (value === null || typeof value === 'undefined') {
          return '';
        }
        if (typeof value === 'object') {
          if (typeof value.name === 'string') {
            return value.name;
          }
          if (typeof value.code === 'string') {
            return value.code;
          }
          return JSON.stringify(value);
        }
        return String(value);
    }
  }

  function formatDateFieldValue(value, fieldType, dateFormat) {
    if (!value) {
      return '';
    }

    if (fieldType === 'DATE') {
      const matched = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (!matched) {
        return String(value);
      }
      return applyDateFormat(matched[1], matched[2], matched[3], null, null, null, dateFormat);
    }

    const matched = String(value).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
    if (!matched) {
      return String(value);
    }

    return applyDateFormat(
      matched[1],
      matched[2],
      matched[3],
      matched[4],
      matched[5],
      matched[6],
      dateFormat
    );
  }

  function applyDateFormat(year, month, day, hour, minute, second, dateFormat) {
    const datePart = dateFormat.indexOf('HH') === -1
      ? dateFormat
      : dateFormat.replace(/\s*HH:mm:ss$/, '');

    let formattedDate = datePart
      .replace(/YYYY/g, year)
      .replace(/MM/g, month)
      .replace(/DD/g, day);

    if (hour === null || dateFormat.indexOf('HH') === -1) {
      return formattedDate;
    }

    const timePart = `${hour}:${minute}:${second}`;
    if (dateFormat.indexOf(' ') !== -1) {
      return `${formattedDate} ${timePart}`;
    }

    return `${formattedDate}${timePart}`;
  }

  function escapeCsvValue(value, quoteMode) {
    const text = String(value || '');
    if (quoteMode === 'SINGLE') {
      return `'${text.replace(/'/g, "''")}'`;
    }

    return `"${text.replace(/"/g, '""')}"`;
  }

  function startCsvDownload(fileName, csvText, encoding) {
    const blob = createCsvBlob(csvText, encoding);
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement('a');

    anchor.href = url;
    anchor.download = fileName;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);

    window.setTimeout(() => {
      window.URL.revokeObjectURL(url);
    }, 1000);
  }

  function createCsvBlob(csvText, encoding) {
    if (encoding === 'UTF-8-BOM') {
      return new Blob([`\uFEFF${csvText}`], {
        type: 'text/csv;charset=utf-8;'
      });
    }

    if (encoding === 'SJIS') {
      if (!window.Encoding || typeof window.Encoding.stringToCode !== 'function') {
        throw new Error('Shift_JISで出力するには encoding.js の読み込みが必要です。');
      }

      const unicodeArray = window.Encoding.stringToCode(csvText);
      const sjisArray = window.Encoding.convert(unicodeArray, {
        to: 'SJIS',
        from: 'UNICODE'
      });

      return new Blob([new Uint8Array(sjisArray)], {
        type: 'text/csv;charset=shift_jis;'
      });
    }

    throw new Error(`未対応のCSVエンコーディングです: ${encoding}`);
  }

  function buildFileName(template, appName, viewName, definitionName) {
    const resolvedName = resolveFileNameTemplate(template, appName, viewName, definitionName);
    const sanitizedName = sanitizeFileName(resolvedName);
    return `${sanitizedName || formatNow(FILE_NAME_DATE_FORMAT)}.csv`;
  }

  function resolveFileNameTemplate(template, appName, viewName, definitionName) {
    return replaceDateTokens(String(template || DEFAULT_FILE_NAME_TEMPLATE))
      .replace(/\{アプリ名\}/g, appName || '')
      .replace(/\{一覧名\}/g, viewName || '')
      .replace(/\{CSV定義名\}/g, definitionName || '');
  }

  function replaceDateTokens(value) {
    return String(value || '')
      .replace(/YYYYMMDDHHmmss/g, formatNow('YYYYMMDDHHmmss'))
      .replace(/YYYYMMDD_HHmmss/g, formatNow('YYYYMMDD_HHmmss'))
      .replace(/YYYY-MM-DD_HH-mm-ss/g, formatNow('YYYY-MM-DD_HH-mm-ss'))
      .replace(/YYYY_MM_DD_HH_mm_ss/g, formatNow('YYYY_MM_DD_HH_mm_ss'))
      .replace(/YYYYMMDD/g, formatNow('YYYYMMDD'))
      .replace(/YYYY-MM-DD/g, formatNow('YYYY-MM-DD'));
  }

  function resolveCurrentViewId(event) {
    return String(
      event.viewId ||
      kintone.app.getViewId() ||
      getViewIdFromUrl() ||
      ''
    );
  }

  function resolveCurrentViewName(event) {
    return String(
      event.viewName ||
      getCurrentViewNameFromDom() ||
      ''
    );
  }

  function resolveCurrentQuery(event) {
    if (kintone.app && typeof kintone.app.getQuery === 'function') {
      return sanitizeQuery(kintone.app.getQuery() || event.query || '');
    }
    return sanitizeQuery(event.query || '');
  }

  function resolveVisibleColumnsFromRenderedList(fieldMap, viewFieldCodes) {
    const viewFields = resolveFieldsFromViewSetting(fieldMap, viewFieldCodes);
    if (viewFields.length > 0) {
      return viewFields;
    }

    const candidateFields = Object.keys(fieldMap).map((fieldCode) => fieldMap[fieldCode]).filter((fieldInfo) => {
      return fieldInfo.type !== 'SUBTABLE';
    });
    const headerOrderedFields = orderFieldsByHeaderLabels(candidateFields);
    if (headerOrderedFields.length > 0) {
      return headerOrderedFields;
    }

    const visibleFields = candidateFields.map((fieldInfo) => {
      const elements = getFieldElementsSafe(fieldInfo.code);
      if (elements === null) {
        return null;
      }

      return {
        code: fieldInfo.code,
        label: fieldInfo.label,
        subtableCode: fieldInfo.subtableCode || null,
        subtableLabel: fieldInfo.subtableLabel || '',
        firstElement: elements[0] || null
      };
    }).filter((fieldInfo) => fieldInfo !== null);

    if (visibleFields.length === 0) {
      return [];
    }

    const orderedByDom = visibleFields.filter((fieldInfo) => fieldInfo.firstElement);
    if (orderedByDom.length > 0) {
      orderedByDom.sort(compareElementsInDocumentOrder);

      const fieldsWithoutElements = visibleFields.filter((fieldInfo) => !fieldInfo.firstElement).sort((a, b) => {
        return compareHeaderLabels(a.label, b.label);
      });

      return orderedByDom.concat(fieldsWithoutElements);
    }

    return visibleFields;
  }

  function resolveFieldsFromViewSetting(fieldMap, viewFieldCodes) {
    if (!Array.isArray(viewFieldCodes) || viewFieldCodes.length === 0) {
      return [];
    }

    return viewFieldCodes.reduce((columns, fieldCode) => {
      const fieldInfo = fieldMap[fieldCode];
      if (!fieldInfo) {
        return columns;
      }
      if (fieldInfo.type === 'SUBTABLE') {
        return columns.concat(getSubtableChildFields(fieldMap, fieldInfo.code));
      }
      columns.push(fieldInfo);
      return columns;
    }, []);
  }

  function getSubtableChildFields(fieldMap, subtableCode) {
    return Object.keys(fieldMap).map((fieldCode) => fieldMap[fieldCode]).filter((fieldInfo) => {
      return fieldInfo.subtableCode === subtableCode;
    });
  }

  function getFieldElementsSafe(fieldCode) {
    try {
      return kintone.app.getFieldElements(fieldCode);
    } catch (error) {
      console.warn(`フィールド要素取得に失敗しました: ${fieldCode}`, error);
      return null;
    }
  }

  function compareElementsInDocumentOrder(a, b) {
    if (a.firstElement === b.firstElement) {
      return 0;
    }
    if (a.firstElement.compareDocumentPosition(b.firstElement) & Node.DOCUMENT_POSITION_FOLLOWING) {
      return -1;
    }
    return 1;
  }

  function orderFieldsByHeaderLabels(candidateFields) {
    const headerLabels = getVisibleHeaderLabelsFromDom();
    if (headerLabels.length === 0) {
      return [];
    }

    const labelToFields = {};
    candidateFields.forEach((fieldInfo) => {
      getFieldHeaderLabelCandidates(fieldInfo).forEach((label) => {
        const normalizedLabel = normalizeHeaderLabel(label);
        if (!normalizedLabel) {
          return;
        }
        if (!labelToFields[normalizedLabel]) {
          labelToFields[normalizedLabel] = [];
        }
        labelToFields[normalizedLabel].push(fieldInfo);
      });
    });

    const orderedFields = [];
    headerLabels.forEach((label) => {
      const normalizedLabel = normalizeHeaderLabel(label);
      const candidates = labelToFields[normalizedLabel];
      if (!candidates || candidates.length === 0) {
        return;
      }
      const selectedField = candidates.shift();
      orderedFields.push(selectedField);
      removeFieldFromLabelCandidates(labelToFields, selectedField);
    });

    return orderedFields;
  }

  function removeFieldFromLabelCandidates(labelToFields, selectedField) {
    Object.keys(labelToFields).forEach((label) => {
      labelToFields[label] = labelToFields[label].filter((fieldInfo) => fieldInfo.code !== selectedField.code);
    });
  }

  function getFieldHeaderLabelCandidates(fieldInfo) {
    const labels = [fieldInfo.label, fieldInfo.code];
    if (fieldInfo.subtableCode) {
      labels.push(`${fieldInfo.subtableLabel || fieldInfo.subtableCode} ${fieldInfo.label}`);
      labels.push(`${fieldInfo.subtableLabel || fieldInfo.subtableCode}.${fieldInfo.label}`);
      labels.push(`${fieldInfo.subtableCode} ${fieldInfo.code}`);
      labels.push(`${fieldInfo.subtableCode}.${fieldInfo.code}`);
    }

    return labels;
  }

  function getVisibleHeaderLabelsFromDom() {
    const selectors = [
      'th[role="columnheader"]',
      '.recordlist-header-cell-gaia',
      '.gaia-argoui-app-index-table-header-cell',
      '.gaia-app-index-table-header-cell'
    ];

    let elements = [];
    selectors.some((selector) => {
      elements = Array.prototype.slice.call(document.querySelectorAll(selector));
      return elements.length > 0;
    });

    return elements.map((element) => normalizeHeaderLabel(element.textContent)).filter((label) => label !== '');
  }

  function normalizeHeaderLabel(label) {
    return String(label || '').replace(/\s+/g, ' ').trim();
  }

  function compareHeaderLabels(a, b) {
    return normalizeHeaderLabel(a).localeCompare(normalizeHeaderLabel(b), 'ja');
  }

  function setButtonDisabled(button, isDisabled) {
    button.disabled = isDisabled;
    button.className = `${BUTTON_CLASS} ${isDisabled ? 'kintoneplugin-button-disabled' : 'kintoneplugin-button-normal'}`;
    button.style.marginLeft = BUTTON_MARGIN_LEFT;
  }

  function showLoading(message) {
    let overlay = document.getElementById('custom-csv-export-loading');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'custom-csv-export-loading';
      overlay.className = 'custom-csv-export-loading';
      overlay.setAttribute('role', 'status');
      overlay.setAttribute('aria-live', 'polite');
      overlay.innerHTML = `
        <div class="custom-csv-export-loading-card">
          <div class="custom-csv-export-loading-spinner" aria-hidden="true"></div>
          <div class="custom-csv-export-loading-text"></div>
        </div>
      `;
      document.body.appendChild(overlay);
    }

    const text = overlay.querySelector('.custom-csv-export-loading-text');
    if (text) {
      text.textContent = message || 'Loading中...';
    }
    overlay.hidden = false;
  }

  function hideLoading() {
    const overlay = document.getElementById('custom-csv-export-loading');
    if (overlay) {
      overlay.hidden = true;
    }
  }

  function buildErrorMessage(error) {
    if (error && error.message) {
      return `CSV出力中にエラーが発生しました\n${error.message}`;
    }
    return 'CSV出力中にエラーが発生しました';
  }

  function formatNow(format) {
    const now = new Date();
    const values = {
      YYYY: String(now.getFullYear()),
      MM: pad2(now.getMonth() + 1),
      DD: pad2(now.getDate()),
      HH: pad2(now.getHours()),
      mm: pad2(now.getMinutes()),
      ss: pad2(now.getSeconds())
    };

    return format
      .replace(/YYYY/g, values.YYYY)
      .replace(/MM/g, values.MM)
      .replace(/DD/g, values.DD)
      .replace(/HH/g, values.HH)
      .replace(/mm/g, values.mm)
      .replace(/ss/g, values.ss);
  }

  function sanitizeQuery(query) {
    return String(query || '')
      .replace(/(^|\s+)limit\s+\d+(\s+|$)/gi, ' ')
      .replace(/(^|\s+)offset\s+\d+(\s+|$)/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function appendLimitOffset(query, limit, offset) {
    const baseQuery = sanitizeQuery(query);
    const paging = `limit ${limit} offset ${offset}`;
    return baseQuery ? `${baseQuery} ${paging}` : paging;
  }

  function sanitizeFileName(name) {
    return String(name || '')
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function getViewIdFromUrl() {
    try {
      const url = new URL(window.location.href);
      return url.searchParams.get('view') || url.searchParams.get('viewId') || '';
    } catch (error) {
      return '';
    }
  }

  function getCurrentViewNameFromDom() {
    const selectors = [
      '.gaia-argoui-app-index-toolbar-view-selector-text',
      '.gaia-argoui-app-index-toolbar-view-selector-label',
      '.gaia-app-index-toolbar-view-selector-text',
      '.gaia-app-index-toolbar-view-selector-label'
    ];

    for (let i = 0; i < selectors.length; i += 1) {
      const element = document.querySelector(selectors[i]);
      if (element && element.textContent) {
        return element.textContent.trim();
      }
    }

    return '';
  }

  function unique(values) {
    return values.filter((value, index, self) => self.indexOf(value) === index);
  }

  function chunk(values, size) {
    const result = [];
    for (let i = 0; i < values.length; i += size) {
      result.push(values.slice(i, i + size));
    }
    return result;
  }

  function pad2(value) {
    return String(value).padStart(2, '0');
  }

  function deepCloneValue(value) {
    return JSON.parse(JSON.stringify(value));
  }
})(kintone.$PLUGIN_ID);
