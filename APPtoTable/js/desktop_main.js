(function (PLUGIN_ID) {
  'use strict';

  const TARGET_SCOPE = {
    RECORD: 'record',
    TABLE: 'table'
  };
  const MAX_MAPPING_COUNT = 20;
  const config = kintone.plugin.app.getConfig(PLUGIN_ID) || {};
  const sourceAppId = config.sourceAppId;
  const sourceTableFieldCode = config.sourceTableFieldCode || '';
  const suppressSuccessMessage = config.suppressSuccessMessage === 'true';
  const recordApiUrl = kintone.api.url('/k/v1/record', true);
  const recordsApiUrl = kintone.api.url('/k/v1/records', true);

  const updateConditions = getSavedUpdateConditions(config);
  const fieldMappings = getSavedFieldMappings(config);
  const recordConditions = updateConditions.filter((condition) => condition.targetScope === TARGET_SCOPE.RECORD);
  const tableConditions = updateConditions.filter((condition) => condition.targetScope === TARGET_SCOPE.TABLE);
  const recordMappings = fieldMappings.filter((mapping) => mapping.targetScope === TARGET_SCOPE.RECORD);
  const tableMappings = fieldMappings.filter((mapping) => mapping.targetScope === TARGET_SCOPE.TABLE);
  const usesTableTargets = tableConditions.length > 0 || tableMappings.length > 0;

  if (!sourceAppId) {
    alert('APPtoTableプラグインの必須設定が不足しています。プラグイン設定を確認してください。');
    return;
  }

  if (!updateConditions.length) {
    alert('APPtoTableプラグインの更新条件設定が不足しています。プラグイン設定を確認してください。');
    return;
  }

  if (!fieldMappings.length) {
    alert('APPtoTableプラグインの更新対象マッピング設定が不足しています。プラグイン設定を確認してください。');
    return;
  }

  if (usesTableTargets && !sourceTableFieldCode) {
    alert('APPtoTableプラグインで更新先種別「テーブル」を使う場合は、更新先テーブルの設定が必要です。');
    return;
  }

  async function getAuthenticationStatus() {
    let authStatus = window.isAuthenticated();
    if (authStatus === undefined || authStatus === '') {
      await new Promise((resolve) => setTimeout(resolve, 500));
      authStatus = window.isAuthenticated();
    }
    return !!authStatus;
  }

  async function safeSendErrorLog(errorContext, errorMessage) {
    try {
      await AuthModule.sendErrorLog(API_CONFIG, errorContext, errorMessage);
    } catch (logError) {
      console.error('エラーログ送信失敗:', logError);
    }
  }

  function getAppId() {
    if (kintone.app.getId() === null) {
      return kintone.mobile.app.getId();
    }
    return kintone.app.getId();
  }

  function showSuccessMessage(message) {
    if (!suppressSuccessMessage) {
      alert(message);
    }
  }

  function getSourceAppPermissionGuidance() {
    return '操作ユーザーに設定アプリの閲覧・追加・編集権限、および更新先アプリの閲覧・編集権限があるか確認してください。lookup項目がある場合は参照先アプリの閲覧権限も必要です。';
  }

  function cloneValue(value) {
    return JSON.parse(JSON.stringify(value));
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
    const currentConditions = parseJsonArray(configObject.updateConditionsJson);
    if (currentConditions.length > 0) {
      return currentConditions
        .map((condition) => ({
          sourceFieldCode: condition?.sourceFieldCode || '',
          operator: '=',
          targetScope: normalizeTargetScope(condition?.targetScope),
          targetFieldCode: condition?.targetFieldCode || ''
        }))
        .filter((condition) => condition.sourceFieldCode && condition.targetFieldCode);
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
    const mergedLegacy = [...legacyRecordConditions, ...legacyRowConditions]
      .filter((condition) => condition.sourceFieldCode && condition.targetFieldCode);
    if (mergedLegacy.length > 0) {
      return mergedLegacy;
    }

    const legacySourceKey = configObject.sourceRowIdentifierField || configObject.rowIdentifierField || '';
    const legacyTargetKey = configObject.targetRowIdentifierField || configObject.rowIdentifierField || '';
    if (legacySourceKey && legacyTargetKey) {
      return [{
        sourceFieldCode: legacySourceKey,
        operator: '=',
        targetScope: TARGET_SCOPE.TABLE,
        targetFieldCode: legacyTargetKey
      }];
    }

    return [];
  }

  function getSavedFieldMappings(configObject) {
    if (configObject.fieldMappingsJson) {
      try {
        const parsed = JSON.parse(configObject.fieldMappingsJson);
        if (Array.isArray(parsed)) {
          return parsed
            .map((mapping) => ({
              sourceFieldCode: mapping?.sourceFieldCode || '',
              targetScope: normalizeTargetScope(mapping?.targetScope),
              targetFieldCode: mapping?.targetFieldCode || ''
            }))
            .filter((mapping) => mapping.sourceFieldCode && mapping.targetFieldCode);
        }
      } catch (error) {
        console.warn('fieldMappingsJson の解析に失敗しました。旧設定を読み込みます。', error);
      }
    }

    const mappings = [];
    for (let index = 1; index <= MAX_MAPPING_COUNT; index += 1) {
      const sourceFieldCode = configObject[`VARIABLE_${index}`];
      const targetFieldCode = configObject[`ROW_VARIABLE_${index}`];
      if (sourceFieldCode && targetFieldCode) {
        mappings.push({
          sourceFieldCode,
          targetScope: TARGET_SCOPE.TABLE,
          targetFieldCode
        });
      }
    }
    return mappings;
  }

  function parseApiErrors(errorData) {
    let combinedMessage = errorData && errorData.message
      ? errorData.message
      : 'エラー内容が取得できませんでした。';

    if (errorData && errorData.errors && typeof errorData.errors === 'object') {
      Object.entries(errorData.errors).forEach(([fieldKey, fieldValue]) => {
        if (fieldValue && Array.isArray(fieldValue.messages)) {
          fieldValue.messages.forEach((message) => {
            combinedMessage += `\n${fieldKey}：${message}`;
          });
        } else {
          combinedMessage += `\n${fieldKey}：${JSON.stringify(fieldValue)}`;
        }
      });
    }

    return combinedMessage;
  }

  async function fetchRecord(appId, recordId) {
    const response = await kintone.api(recordApiUrl, 'GET', {
      app: appId,
      id: recordId
    });
    return response.record;
  }

  async function fetchAllTargetRecords() {
    const allRecords = [];
    let lastRecordId = '0';

    while (true) {
      const response = await kintone.api(recordsApiUrl, 'GET', {
        app: sourceAppId,
        query: `$id > ${lastRecordId} order by $id asc limit 500`
      });

      const records = response.records || [];
      if (!records.length) {
        break;
      }

      allRecords.push(...records);
      lastRecordId = records[records.length - 1].$id.value;
    }

    return allRecords;
  }

  function getFieldValue(container, fieldCode) {
    if (!container || !fieldCode || !container[fieldCode]) {
      return undefined;
    }
    return container[fieldCode].value;
  }

  function normalizeCompareValue(value) {
    if (value === undefined || value === null) {
      return '';
    }
    if (Array.isArray(value)) {
      return JSON.stringify(value);
    }
    if (typeof value === 'object') {
      return JSON.stringify(value);
    }
    return String(value);
  }

  function matchesConditions(currentRecord, targetContainer, conditions) {
    return conditions.every((condition) => {
      const sourceValue = normalizeCompareValue(getFieldValue(currentRecord, condition.sourceFieldCode));
      const targetValue = normalizeCompareValue(getFieldValue(targetContainer, condition.targetFieldCode));
      return sourceValue === targetValue;
    });
  }

  function getTargetRows(targetRecord) {
    const table = targetRecord[sourceTableFieldCode];
    return table && Array.isArray(table.value) ? table.value : [];
  }

  function buildMatchedTargets(targetRecords, currentRecord) {
    const matchedTargets = [];

    targetRecords.forEach((targetRecord) => {
      if (!matchesConditions(currentRecord, targetRecord, recordConditions)) {
        return;
      }

      if (!usesTableTargets) {
        matchedTargets.push({
          record: targetRecord,
          rowIndex: null
        });
        return;
      }

      const targetRows = getTargetRows(targetRecord);
      const matchedRowIndexes = targetRows
        .map((row, index) => {
          if (tableConditions.length > 0 && !matchesConditions(currentRecord, row.value, tableConditions)) {
            return null;
          }
          return index;
        })
        .filter((index) => index !== null);

      matchedRowIndexes.forEach((rowIndex) => {
        matchedTargets.push({
          record: targetRecord,
          rowIndex
        });
      });
    });

    return matchedTargets;
  }

  function applyRecordMappings(updateEntry, currentRecord, originalRecord) {
    let applied = false;

    recordMappings.forEach((mapping) => {
      if (!currentRecord[mapping.sourceFieldCode] || !originalRecord[mapping.targetFieldCode]) {
        return;
      }

      updateEntry.record[mapping.targetFieldCode] = {
        value: cloneValue(currentRecord[mapping.sourceFieldCode].value)
      };
      applied = true;
    });

    return applied;
  }

  function applyTableMappings(targetRowValue, currentRecord) {
    let applied = false;

    tableMappings.forEach((mapping) => {
      if (!currentRecord[mapping.sourceFieldCode] || !targetRowValue[mapping.targetFieldCode]) {
        return;
      }

      targetRowValue[mapping.targetFieldCode].value = cloneValue(currentRecord[mapping.sourceFieldCode].value);
      applied = true;
    });

    return applied;
  }

  async function applyUpdates(currentRecord, sourceAppName) {
    let targetRecords;
    try {
      targetRecords = await fetchAllTargetRecords();
    } catch (error) {
      const errorMessage = parseApiErrors(error);
      alert(`プラグインエラー：更新先レコードの走査に失敗しました。\n${errorMessage}\n${getSourceAppPermissionGuidance()}`);
      await safeSendErrorLog('更新先レコード特定失敗', errorMessage);
      return;
    }

    const matchedTargets = buildMatchedTargets(targetRecords, currentRecord);

    if (!matchedTargets.length) {
      const warningMessage = '条件に一致する更新先が見つからなかったため、同期をスキップしました。';
      console.warn(warningMessage);
      alert(warningMessage);
      return;
    }

    const updatesByRecordId = new Map();
    let matchedCount = 0;

    matchedTargets.forEach((target) => {
      matchedCount += 1;
      const recordId = target.record.$id.value;
      let updateEntry = updatesByRecordId.get(recordId);

      if (!updateEntry) {
        updateEntry = {
          id: recordId,
          revision: -1,
          record: {}
        };

        if (usesTableTargets) {
          updateEntry.tableRows = getTargetRows(target.record).map((row) => ({
            id: row.id,
            value: cloneValue(row.value)
          }));
        }

        updatesByRecordId.set(recordId, updateEntry);
      }

      applyRecordMappings(updateEntry, currentRecord, target.record);

      if (target.rowIndex !== null && updateEntry.tableRows) {
        applyTableMappings(updateEntry.tableRows[target.rowIndex].value, currentRecord);
      }
    });

    const recordsToUpdate = Array.from(updatesByRecordId.values())
      .map((updateEntry) => {
        if (updateEntry.tableRows) {
          updateEntry.record[sourceTableFieldCode] = {
            value: updateEntry.tableRows
          };
        }

        return {
          id: updateEntry.id,
          revision: updateEntry.revision,
          record: updateEntry.record
        };
      })
      .filter((recordToUpdate) => Object.keys(recordToUpdate.record).length > 0);

    if (!recordsToUpdate.length) {
      const warningMessage = '条件に一致する更新先は見つかりましたが、更新対象項目がありませんでした。';
      console.warn(warningMessage);
      alert(warningMessage);
      return;
    }

    try {
      await kintone.api(recordsApiUrl, 'PUT', {
        app: sourceAppId,
        records: recordsToUpdate
      });
      const matchedLabel = usesTableTargets ? '一致対象' : '一致レコード';
      showSuccessMessage(`${sourceAppName}の${matchedLabel}${matchedCount}件・更新レコード${recordsToUpdate.length}件を正常に更新しました。`);
    } catch (error) {
      const errorMessage = parseApiErrors(error);
      alert(`プラグインエラー：更新先レコードの更新に失敗しました。\n${errorMessage}\n${getSourceAppPermissionGuidance()}`);
      await safeSendErrorLog('更新先レコード更新失敗', errorMessage);
    }
  }

  async function registerKintoneEvents() {
    const isAuthenticated = await getAuthenticationStatus();
    if (!isAuthenticated) {
      console.warn('プラグインの処理をスキップします（認証されていません）');
      return;
    }

    let sourceAppName = `AppID:${sourceAppId}`;
    (async () => {
      try {
        const response = await kintone.api(kintone.api.url('/k/v1/app', true), 'GET', { id: sourceAppId });
        sourceAppName = response.name;
      } catch (error) {
        console.warn('更新先アプリ名の取得に失敗しました', error);
      }
    })();

    const showEvents = [
      'app.record.create.show',
      'app.record.edit.show',
      'app.record.index.edit.show',
      'mobile.app.record.create.show',
      'mobile.app.record.edit.show'
    ];

    kintone.events.on(showEvents, (event) => {
      return event;
    });

    const saveEvents = [
      'app.record.create.submit.success',
      'app.record.edit.submit.success',
      'app.record.index.edit.submit.success',
      'mobile.app.record.create.submit.success',
      'mobile.app.record.edit.submit.success'
    ];

    kintone.events.on(saveEvents, async (event) => {
      const currentRecordId = event.recordId || (event.record && event.record.$id ? event.record.$id.value : '');
      if (!currentRecordId) {
        const errorMessage = '設定アプリのレコードID取得に失敗したため、同期をスキップしました。';
        alert(errorMessage);
        await safeSendErrorLog('設定アプリレコード特定失敗', errorMessage);
        return event;
      }

      let currentRecord;
      try {
        currentRecord = await fetchRecord(getAppId(), currentRecordId);
      } catch (error) {
        const errorMessage = parseApiErrors(error);
        alert(`プラグインエラー：設定アプリのレコード再取得に失敗しました。\n${errorMessage}`);
        await safeSendErrorLog('設定アプリレコード取得失敗', errorMessage);
        return event;
      }

      await applyUpdates(currentRecord, sourceAppName);
      return event;
    });
  }

  registerKintoneEvents();
})(kintone.$PLUGIN_ID);
