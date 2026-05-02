(function (PLUGIN_ID) {
  'use strict';

  const config = kintone.plugin.app.getConfig(PLUGIN_ID) || {};
  const MAX_MAPPINGS = 20;

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

  function normalizeMappingList(rawMappings, legacyCodes = []) {
    if (Array.isArray(rawMappings)) {
      return rawMappings
        .map((mapping) => ({
          sourceFieldCode: mapping?.sourceFieldCode || mapping?.source || '',
          targetFieldCode: mapping?.targetFieldCode || mapping?.target || ''
        }))
        .filter((mapping) => mapping.sourceFieldCode && mapping.targetFieldCode)
        .slice(0, MAX_MAPPINGS);
    }

    return legacyCodes
      .filter(Boolean)
      .slice(0, MAX_MAPPINGS)
      .map((code) => ({
        sourceFieldCode: code,
        targetFieldCode: code
      }));
  }

  function normalizeConditionList(rawConditions) {
    if (!Array.isArray(rawConditions)) {
      return [];
    }

    return rawConditions
      .map((condition) => ({
        fieldScope: condition?.fieldScope === 'table' ? 'table' : 'record',
        fieldCode: condition?.fieldCode || '',
        fieldType: condition?.fieldType || '',
        operator: condition?.operator || '',
        value: condition?.value ?? ''
      }))
      .filter((condition) => condition.fieldCode && condition.operator)
      .slice(0, MAX_MAPPINGS);
  }

  function getLinkageConfigs(configObject) {
    if (configObject.linkageConfigsJson) {
      try {
        const parsed = JSON.parse(configObject.linkageConfigsJson);
        if (Array.isArray(parsed)) {
          return parsed
            .filter((linkage) =>
              linkage &&
              linkage.tableFieldCode &&
              linkage.targetAppId &&
              (linkage.sourceRowIdentifierField || linkage.rowIdentifierField) &&
              (linkage.targetRowIdentifierField || linkage.rowIdentifierField)
            )
            .map((linkage, index) => ({
              id: linkage.id || `linkage-${index + 1}`,
              title: linkage.title || '',
              tableFieldCode: linkage.tableFieldCode,
              targetAppId: linkage.targetAppId,
              sourceRowIdentifierField: linkage.sourceRowIdentifierField || linkage.rowIdentifierField,
              targetRowIdentifierField: linkage.targetRowIdentifierField || linkage.rowIdentifierField,
              sourceRecordNumber: linkage.sourceRecordNumber || '',
              tableRowNumber: linkage.tableRowNumber || '',
              syncConditions: normalizeConditionList(linkage.syncConditions),
              normalMappings: normalizeMappingList(linkage.normalMappings, linkage.variables),
              tableMappings: normalizeMappingList(linkage.tableMappings, linkage.rowVariables)
            }));
        }
      } catch (error) {
        console.warn('linkageConfigsJson の解析に失敗しました。旧設定を読み込みます。', error);
      }
    }

    if (configObject.tableFieldCode && configObject.targetAppId && configObject.rowIdentifierField) {
      return [{
        id: 'linkage-1',
        title: '',
        tableFieldCode: configObject.tableFieldCode,
        targetAppId: configObject.targetAppId,
        sourceRowIdentifierField: configObject.rowIdentifierField,
        targetRowIdentifierField: configObject.rowIdentifierField,
        sourceRecordNumber: configObject.sourceRecordNumber || '',
        tableRowNumber: configObject.tableRowNumber || '',
        syncConditions: [],
        normalMappings: normalizeMappingList(null, getLegacyMappings(configObject, 'VARIABLE')),
        tableMappings: normalizeMappingList(null, getLegacyMappings(configObject, 'ROW_VARIABLE'))
      }];
    }

    return [];
  }

  function getSafeValue(value) {
    return value === undefined || value === null ? '' : value;
  }

  function setRecordFieldValue(recordData, fieldCode, value) {
    if (!fieldCode) {
      return;
    }
    recordData[fieldCode] = { value: getSafeValue(value) };
  }

  function normalizeConditionComparableValue(fieldType, rawValue) {
    if (rawValue === undefined || rawValue === null) {
      return null;
    }

    switch (fieldType) {
      case 'NUMBER':
      case 'CALC': {
        if (rawValue === '') {
          return null;
        }
        const numericValue = Number(rawValue);
        return Number.isNaN(numericValue) ? null : numericValue;
      }
      default:
        return rawValue;
    }
  }

  function matchesSingleCondition(fieldValue, condition) {
    const comparableFieldValue = normalizeConditionComparableValue(condition.fieldType, fieldValue);
    const comparableConditionValue = normalizeConditionComparableValue(condition.fieldType, condition.value);

    switch (condition.operator) {
      case '=':
        return String(comparableFieldValue ?? '') === String(comparableConditionValue ?? '');
      case '!=':
        return String(comparableFieldValue ?? '') !== String(comparableConditionValue ?? '');
      case '>':
        return comparableFieldValue !== null && comparableConditionValue !== null && comparableFieldValue > comparableConditionValue;
      case '>=':
        return comparableFieldValue !== null && comparableConditionValue !== null && comparableFieldValue >= comparableConditionValue;
      case '<':
        return comparableFieldValue !== null && comparableConditionValue !== null && comparableFieldValue < comparableConditionValue;
      case '<=':
        return comparableFieldValue !== null && comparableConditionValue !== null && comparableFieldValue <= comparableConditionValue;
      case 'contains':
        if (Array.isArray(comparableFieldValue)) {
          return comparableFieldValue.map(String).includes(String(comparableConditionValue ?? ''));
        }
        return String(comparableFieldValue ?? '').includes(String(comparableConditionValue ?? ''));
      case 'not_contains':
        if (Array.isArray(comparableFieldValue)) {
          return !comparableFieldValue.map(String).includes(String(comparableConditionValue ?? ''));
        }
        return !String(comparableFieldValue ?? '').includes(String(comparableConditionValue ?? ''));
      default:
        return true;
    }
  }

  function matchesConditions(sourceRecord, sourceRowValue, conditions) {
    if (!Array.isArray(conditions) || conditions.length === 0) {
      return true;
    }

    return conditions.every((condition) => {
      const rawFieldValue = condition.fieldScope === 'table'
        ? sourceRowValue?.[condition.fieldCode]?.value
        : sourceRecord?.[condition.fieldCode]?.value;
      return matchesSingleCondition(rawFieldValue, condition);
    });
  }

  function applyNormalMappings(recordData, sourceRecord, mappings) {
    mappings.forEach((mapping) => {
      if (!mapping.sourceFieldCode || !mapping.targetFieldCode) {
        return;
      }
      recordData[mapping.targetFieldCode] = {
        value: getSafeValue(sourceRecord[mapping.sourceFieldCode]?.value)
      };
    });
  }

  function applyTableMappings(recordData, sourceRow, mappings) {
    mappings.forEach((mapping) => {
      if (!mapping.sourceFieldCode || !mapping.targetFieldCode) {
        return;
      }
      recordData[mapping.targetFieldCode] = {
        value: getSafeValue(sourceRow[mapping.sourceFieldCode]?.value)
      };
    });
  }

  function parseApiErrors(errorData) {
    let combinedMessage = errorData?.message || 'エラー内容が取得できませんでした。';

    if (errorData?.errors && typeof errorData.errors === 'object') {
      Object.entries(errorData.errors).forEach(([fieldKey, fieldValue]) => {
        if (fieldValue?.messages && Array.isArray(fieldValue.messages)) {
          fieldValue.messages.forEach((msg) => {
            combinedMessage += `\n${fieldKey}：${msg}`;
          });
        } else {
          combinedMessage += `\n${fieldKey}：${JSON.stringify(fieldValue)}`;
        }
      });
    }

    return combinedMessage;
  }

  async function getAuthenticationStatus() {
    let authStatus = window.isAuthenticated();
    if (authStatus === undefined || authStatus === '') {
      console.warn('認証処理が完了していないため、待機します...');
      await new Promise(resolve => setTimeout(resolve, 500));
      authStatus = window.isAuthenticated();
    }
    return !!authStatus;
  }

  async function registerKintoneEvents() {
    const isAuthenticated = await getAuthenticationStatus();
    if (!isAuthenticated) {
      console.warn('プラグインの処理をスキップします（認証されていません）');
      return;
    }

    const linkageConfigs = getLinkageConfigs(config);
    if (!linkageConfigs.length) {
      console.warn('連携設定が存在しないため、同期処理をスキップします。');
      return;
    }

    function getAppId() {
      if (kintone.app.getId() === null) {
        return kintone.mobile.app.getId();
      }
      return kintone.app.getId();
    }

    function showSuccessMessage(message) {
      if (config.suppressSuccessMessage !== 'true') {
        alert(message);
      }
    }

    function getTargetAppPermissionGuidance() {
      return '操作ユーザーに更新先アプリの閲覧・追加・編集・削除権限があるか確認してください。ルックアップフィールドがある場合は、参照先アプリの閲覧権限も必要です。';
    }

    function getLinkageLabel(linkage, index) {
      return linkage.title || linkage.tableFieldCode || `連携${index + 1}`;
    }

    function getSnapshotKey(linkage, index) {
      return `${index}:${linkage.tableFieldCode}:${linkage.sourceRowIdentifierField}:${linkage.targetRowIdentifierField}`;
    }

    const targetRecordsApiUrl = kintone.api.url('/k/v1/records', true);
    const targetAppNameCache = {};
    const previousIdentifiersByLinkage = {};

    async function getTargetAppName(targetAppId) {
      if (!targetAppId) {
        return '更新先アプリ';
      }
      if (!targetAppNameCache[targetAppId]) {
        try {
          const resp = await kintone.api(kintone.api.url('/k/v1/app', true), 'GET', { id: targetAppId });
          targetAppNameCache[targetAppId] = resp.name;
        } catch (error) {
          console.warn('更新先アプリ名の取得に失敗しました', error);
          targetAppNameCache[targetAppId] = `AppID:${targetAppId}`;
        }
      }
      return targetAppNameCache[targetAppId];
    }

    function getLinkageContext(linkage, index, targetAppName) {
      return `${getLinkageLabel(linkage, index)}（更新先: ${targetAppName || `AppID:${linkage.targetAppId}`}）`;
    }

    let loadingOverlayElement = null;
    let loadingOverlayCount = 0;

    function ensureLoadingOverlay() {
      if (loadingOverlayElement) {
        return loadingOverlayElement;
      }

      const overlay = document.createElement('div');
      overlay.style.position = 'fixed';
      overlay.style.inset = '0';
      overlay.style.backgroundColor = 'rgba(255, 255, 255, 0.72)';
      overlay.style.display = 'none';
      overlay.style.alignItems = 'center';
      overlay.style.justifyContent = 'center';
      overlay.style.zIndex = '99999';

      const panel = document.createElement('div');
      panel.style.display = 'flex';
      panel.style.flexDirection = 'column';
      panel.style.alignItems = 'center';
      panel.style.gap = '12px';
      panel.style.padding = '20px 24px';
      panel.style.backgroundColor = '#fff';
      panel.style.borderRadius = '10px';
      panel.style.boxShadow = '0 8px 24px rgba(0, 0, 0, 0.12)';

      const spinner = document.createElement('div');
      spinner.style.width = '36px';
      spinner.style.height = '36px';
      spinner.style.border = '4px solid #dbeafe';
      spinner.style.borderTopColor = '#1E90FF';
      spinner.style.borderRadius = '50%';
      spinner.style.animation = 'tabletoapp-loading-spin 0.8s linear infinite';

      const message = document.createElement('div');
      message.textContent = '更新中...';
      message.style.fontSize = '14px';
      message.style.fontWeight = 'bold';
      message.style.color = '#1f2937';

      panel.appendChild(spinner);
      panel.appendChild(message);
      overlay.appendChild(panel);

      if (!document.getElementById('tabletoapp-loading-style')) {
        const style = document.createElement('style');
        style.id = 'tabletoapp-loading-style';
        style.textContent = '@keyframes tabletoapp-loading-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }';
        document.head.appendChild(style);
      }

      document.body.appendChild(overlay);
      loadingOverlayElement = overlay;
      return overlay;
    }

    function showLoadingOverlay() {
      loadingOverlayCount += 1;
      const overlay = ensureLoadingOverlay();
      overlay.style.display = 'flex';
    }

    function hideLoadingOverlay() {
      loadingOverlayCount = Math.max(loadingOverlayCount - 1, 0);
      if (loadingOverlayCount === 0 && loadingOverlayElement) {
        loadingOverlayElement.style.display = 'none';
      }
    }

    async function deleteRecordsByIdentifiers(identifiers, linkage) {
      if (!Array.isArray(identifiers) || identifiers.length === 0) {
        return;
      }

      const idsToDelete = [];
      for (const identifier of identifiers) {
        const deleteQuery = `${linkage.targetRowIdentifierField} = "${identifier}"`;
        const deleteResponse = await kintone.api(targetRecordsApiUrl, 'GET', {
          app: linkage.targetAppId,
          query: deleteQuery,
        });
        deleteResponse.records.forEach(record => idsToDelete.push(record.$id.value));
      }

      if (idsToDelete.length > 0) {
        await kintone.api(targetRecordsApiUrl, 'DELETE', {
          app: linkage.targetAppId,
          ids: idsToDelete
        });
      }
    }

    async function revertRowIdentifiers(recordNumber, linkage, tableRecords, newIdentifierIndexes) {
      newIdentifierIndexes.forEach(index => {
        tableRecords[index].value[linkage.sourceRowIdentifierField].value = '';
      });

      try {
        await kintone.api(kintone.api.url('/k/v1/record', true), 'PUT', {
          app: getAppId(),
          id: recordNumber,
          record: {
            [linkage.tableFieldCode]: {
              value: tableRecords
            }
          }
        });
      } catch (err) {
        console.error('行識別子のクリアに失敗しました:', err);
      }
    }

    async function processSingleLinkageSync(event, linkage, index) {
      let hasError = false;
      const record = event.record;
      const recordNumber = event.recordId;
      const formattedRecordNumber = recordNumber.toString().padStart(6, '0');
      const targetAppName = await getTargetAppName(linkage.targetAppId);
      const linkageContext = getLinkageContext(linkage, index, targetAppName);
      const snapshotKey = getSnapshotKey(linkage, index);

      const tableField = record[linkage.tableFieldCode];
      if (!tableField || !tableField.value) {
        const errorMsg = `${linkageContext} の更新対象テーブルフィールドコード "${linkage.tableFieldCode}" が見つかりません。`;
        alert(`プラグインエラー：${errorMsg}`);
        await AuthModule.sendErrorLog(API_CONFIG, 'テーブルフィールド未検出', errorMsg);
        return { hasError: true, targetAppName };
      }

      const tableRecords = tableField.value;
      const previousIdentifiers = previousIdentifiersByLinkage[snapshotKey] || [];
      const currentIdentifiers = tableRecords.map(row => row.value?.[linkage.sourceRowIdentifierField]?.value || '');
      const deletedIdentifiers = previousIdentifiers.filter(id => !currentIdentifiers.includes(id));
      const existingIdentifiers = new Set(currentIdentifiers);
      const recordsToCreateInTarget = [];
      const newIdentifierIndexes = [];

      for (let i = 0; i < tableRecords.length; i++) {
        const row = tableRecords[i];
        if (!row.value?.[linkage.sourceRowIdentifierField]) {
          const errorMsg = `${linkageContext} の更新元キー項目 "${linkage.sourceRowIdentifierField}" がテーブル内に存在しません。`;
          alert(`プラグインエラー：${errorMsg}`);
          await AuthModule.sendErrorLog(API_CONFIG, '更新キー項目未検出', errorMsg);
          return { hasError: true, targetAppName };
        }

        if (!matchesConditions(record, row.value, linkage.syncConditions)) {
          continue;
        }

        if (!row.value[linkage.sourceRowIdentifierField].value) {
          let newIdentifier;
          let rowNo = i + 1;
          do {
            newIdentifier = `${formattedRecordNumber}${rowNo.toString().padStart(3, '0')}`;
            rowNo++;
          } while (existingIdentifiers.has(newIdentifier));

          row.value[linkage.sourceRowIdentifierField].value = newIdentifier;
          existingIdentifiers.add(newIdentifier);
          newIdentifierIndexes.push(i);

          const recordData = {
            [linkage.targetRowIdentifierField]: { value: newIdentifier }
          };
          setRecordFieldValue(recordData, linkage.sourceRecordNumber, recordNumber);
          setRecordFieldValue(recordData, linkage.tableRowNumber, i + 1);
          applyNormalMappings(recordData, record, linkage.normalMappings);
          applyTableMappings(recordData, row.value, linkage.tableMappings);
          recordsToCreateInTarget.push(recordData);
        }
      }

      try {
        await kintone.api(kintone.api.url('/k/v1/record', true), 'PUT', {
          app: getAppId(),
          id: recordNumber,
          record: {
            [linkage.tableFieldCode]: {
              value: tableRecords
            }
          }
        });
      } catch (error) {
        const errorMessage = parseApiErrors(error);
        alert(`プラグインエラー：${linkageContext} の更新キー項目の更新に失敗しました。\n${errorMessage}`);
        await AuthModule.sendErrorLog(API_CONFIG, '当アプリの更新キー項目更新', `${linkageContext}\n${errorMessage}`);
        hasError = true;
      }

      if (deletedIdentifiers.length > 0) {
        try {
          await deleteRecordsByIdentifiers(deletedIdentifiers, linkage);
        } catch (error) {
          const errorMessage = parseApiErrors(error);
          alert(`プラグインエラー：${linkageContext} の削除処理中にエラーが発生しました。\n${errorMessage}\n${getTargetAppPermissionGuidance()}`);
          await AuthModule.sendErrorLog(API_CONFIG, '削除処理中(削除された行)', `${linkageContext}\n${errorMessage}`);
          hasError = true;
        }
      }

      const identifiers = tableRecords
        .filter(row => row.value?.[linkage.sourceRowIdentifierField]?.value)
        .map(row => `"${row.value[linkage.sourceRowIdentifierField].value}"`);

      let recordsToUpdate = [];
      if (identifiers.length > 0) {
        try {
          const response = await kintone.api(targetRecordsApiUrl, 'GET', {
            app: linkage.targetAppId,
            query: `${linkage.targetRowIdentifierField} in (${identifiers.join(',')})`,
          });
          const targetRecords = response.records;

          recordsToUpdate = tableRecords.reduce((updates, row, rowIndex) => {
            const identifier = row.value?.[linkage.sourceRowIdentifierField]?.value || null;
            if (!identifier) {
              return updates;
            }

            if (!matchesConditions(record, row.value, linkage.syncConditions)) {
              return updates;
            }

            const matchingRecord = targetRecords.find(rec => rec?.[linkage.targetRowIdentifierField]?.value === identifier);
            if (!matchingRecord) {
              return updates;
            }

            const recordData = {};
            applyNormalMappings(recordData, record, linkage.normalMappings);
            applyTableMappings(recordData, row.value, linkage.tableMappings);
            setRecordFieldValue(recordData, linkage.tableRowNumber, rowIndex + 1);

            updates.push({
              id: matchingRecord.$id?.value || null,
              record: recordData,
            });
            return updates;
          }, []);
        } catch (error) {
          const errorMessage = parseApiErrors(error);
          alert(`プラグインエラー：${linkageContext} の更新処理に失敗しました。\n${errorMessage}\n${getTargetAppPermissionGuidance()}`);
          await AuthModule.sendErrorLog(API_CONFIG, '更新処理', `${linkageContext}\n${errorMessage}`);
          hasError = true;
        }
      }

      if (recordsToUpdate.length > 0) {
        try {
          await kintone.api(targetRecordsApiUrl, 'PUT', {
            app: linkage.targetAppId,
            records: recordsToUpdate.map((recordData) => ({
              id: recordData.id,
              revision: -1,
              record: recordData.record,
            })),
          });
        } catch (error) {
          const errorMessage = parseApiErrors(error);
          alert(`プラグインエラー：${linkageContext} の更新先アプリへの更新に失敗しました。\n${errorMessage}\n${getTargetAppPermissionGuidance()}`);
          await AuthModule.sendErrorLog(API_CONFIG, '更新先アプリの通信', `${linkageContext}\n${errorMessage}`);
          hasError = true;
        }
      }

      if (recordsToCreateInTarget.length > 0) {
        try {
          await kintone.api(targetRecordsApiUrl, 'POST', {
            app: linkage.targetAppId,
            records: recordsToCreateInTarget,
          });
        } catch (error) {
          const errorMessage = parseApiErrors(error);
          alert(`プラグインエラー：${linkageContext} の更新先アプリへの新規登録に失敗しました。\n${errorMessage}\n${getTargetAppPermissionGuidance()}`);
          await AuthModule.sendErrorLog(API_CONFIG, '更新先アプリの通信', `${linkageContext}\n${errorMessage}`);
          await revertRowIdentifiers(recordNumber, linkage, tableRecords, newIdentifierIndexes);
          hasError = true;
        }
      }

      return { hasError, targetAppName };
    }

    const eventsToShow = [
      'app.record.create.show',
      'app.record.edit.show',
      'mobile.app.record.create.show',
      'mobile.app.record.edit.show'
    ];

    kintone.events.on(eventsToShow, function (event) {
      const latestConfig = kintone.plugin.app.getConfig(PLUGIN_ID) || {};
      if (latestConfig.hideKeyField === 'true') {
        const rowIdentifierFields = [...new Set(linkageConfigs.map(linkage => linkage.sourceRowIdentifierField).filter(Boolean))];
        rowIdentifierFields.forEach((fieldCode) => {
          if (kintone.app?.record?.setFieldShown) {
            kintone.app.record.setFieldShown(fieldCode, false);
          }
        });
      }
      return event;
    });

    kintone.events.on(['app.record.create.show', 'mobile.app.record.create.show'], function (event) {
      if (event.reuse === true) {
        linkageConfigs.forEach((linkage) => {
          const table = event.record[linkage.tableFieldCode];
          if (!table || !Array.isArray(table.value)) {
            return;
          }
          table.value.forEach((row) => {
            if (row.value?.[linkage.sourceRowIdentifierField]) {
              row.value[linkage.sourceRowIdentifierField].value = '';
            }
          });
        });
      }
      return event;
    });

    kintone.events.on(['app.record.edit.show', 'mobile.app.record.edit.show'], function (event) {
      linkageConfigs.forEach((linkage, index) => {
        const table = event.record[linkage.tableFieldCode];
        const snapshotKey = getSnapshotKey(linkage, index);
        if (table && Array.isArray(table.value)) {
          previousIdentifiersByLinkage[snapshotKey] = table.value
            .map(row => row.value?.[linkage.sourceRowIdentifierField]?.value || '');
        } else {
          previousIdentifiersByLinkage[snapshotKey] = [];
        }
      });
      return event;
    });

    const saveEvents = [
      'app.record.create.submit.success',
      'app.record.edit.submit.success',
      'app.record.index.edit.submit.success',
      'mobile.app.record.create.submit.success',
      'mobile.app.record.edit.submit.success'
    ];

    kintone.events.on(saveEvents, async function (event) {
      showLoadingOverlay();
      try {
        let hasAnyError = false;
        const successfulTargets = [];

        for (let i = 0; i < linkageConfigs.length; i++) {
          const result = await processSingleLinkageSync(event, linkageConfigs[i], i);
          if (result.hasError) {
            hasAnyError = true;
          } else {
            successfulTargets.push(result.targetAppName);
          }
        }

        if (!hasAnyError && successfulTargets.length > 0) {
          showSuccessMessage(`${[...new Set(successfulTargets)].join('、')}への更新が正常に完了しました`);
        }
        return event;
      } finally {
        hideLoadingOverlay();
      }
    });

    const deleteEventGroups = [
      ['app.record.detail.delete.submit', 'mobile.app.record.detail.delete.submit'],
      ['app.record.index.delete.submit', 'mobile.app.record.index.delete.submit']
    ];

    deleteEventGroups.forEach((eventNames) => {
      kintone.events.on(eventNames, async function (event) {
        let hasAnyError = false;
        const successfulTargets = [];

        for (let i = 0; i < linkageConfigs.length; i++) {
          const linkage = linkageConfigs[i];
          const targetAppName = await getTargetAppName(linkage.targetAppId);
          const linkageContext = getLinkageContext(linkage, i, targetAppName);
          const identifiers = event.record[linkage.tableFieldCode]?.value
            .map(row => row.value?.[linkage.sourceRowIdentifierField]?.value || '') || [];

          try {
            await deleteRecordsByIdentifiers(identifiers, linkage);
            successfulTargets.push(targetAppName);
          } catch (error) {
            const errorMessage = parseApiErrors(error);
            console.error('削除処理エラー:', error?.message || 'エラー詳細不明');
            alert(`プラグインエラー：${linkageContext} の更新先アプリ削除処理中にエラーが発生しました。\n${errorMessage}\n${getTargetAppPermissionGuidance()}`);
            await AuthModule.sendErrorLog(API_CONFIG, '削除処理', `${linkageContext}\n${errorMessage}`);
            hasAnyError = true;
          }
        }

        if (!hasAnyError && successfulTargets.length > 0) {
          showSuccessMessage(`${[...new Set(successfulTargets)].join('、')}の対象レコードを正常に削除しました。`);
        }
        return event;
      });
    });
  }

  registerKintoneEvents();
})(kintone.$PLUGIN_ID);

