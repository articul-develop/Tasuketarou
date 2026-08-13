/**
 * 変更履歴プラグイン - 差分検知
 */
window.ChangeHistory = window.ChangeHistory || {};
((CH) => {
  'use strict';

  const getLabel = (setting, fieldCode) => {
    if (setting && setting.fieldLabels && setting.fieldLabels[fieldCode]) {
      return setting.fieldLabels[fieldCode];
    }
    return fieldCode;
  };

  const getRowKey = (row, identifierField) => {
    if (!identifierField || !row || !row.value || !row.value[identifierField]) {
      return '';
    }
    const meta = row.value[identifierField];
    return CH.toDisplay(meta.value, meta.type);
  };

  const getRowNo = (rows, row) => {
    const index = rows.indexOf(row);
    return index >= 0 ? String(index + 1) : '';
  };

  const buildBase = (ctx, setting, extras) => Object.assign({
    settingId: setting.id,
    timestamp: ctx.timestamp,
    userName: ctx.user.name,
    userCode: ctx.user.code,
    saveType: setting.saveType,
    textDestType: setting.textDestType || 'record',
    textDestField: setting.textDestField || '',
    historyTable: setting.historyTable || '',
    historyRowGrain: setting.historyRowGrain || 'perChange',
    historyColumns: setting.historyColumns || {},
    sourceTable: setting.sourceTable || '',
    sourceTableLabel: setting.sourceTableLabel || setting.sourceTable || ''
  }, extras || {});

  const detectFieldChanges = (newRecord, oldRecord, setting, excluded, ctx, changes) => {
    const codes = Array.isArray(setting.targetFields) ? setting.targetFields : [];
    codes.forEach((fieldCode) => {
      if (!fieldCode || excluded.has(fieldCode)) {
        return;
      }
      const newMeta = CH.getFieldMeta(newRecord, fieldCode);
      const oldMeta = oldRecord ? CH.getFieldMeta(oldRecord, fieldCode) : null;

      // 一覧編集などで片側にフィールドが無い場合は誤検知を避ける
      if (!newMeta || !oldMeta) {
        return;
      }
      if (!CH.isSupportedTargetType(newMeta.type)) {
        return;
      }
      if (CH.isSameValue(oldMeta.value, newMeta.value, newMeta.type)) {
        return;
      }

      changes.push(buildBase(ctx, setting, {
        action: 'change',
        fieldCode,
        fieldLabel: getLabel(setting, fieldCode),
        fieldType: newMeta.type,
        oldValue: CH.toDisplay(oldMeta.value, newMeta.type),
        newValue: CH.toDisplay(newMeta.value, newMeta.type)
      }));
    });
  };

  const detectSubtableChanges = (newRecord, oldRecord, setting, excluded, ctx, changes) => {
    const tableCode = setting.sourceTable;
    if (!tableCode || excluded.has(tableCode)) {
      return;
    }

    const newRows = CH.getTableRows(newRecord, tableCode);
    const oldRows = oldRecord ? CH.getTableRows(oldRecord, tableCode) : [];
    const oldRowMap = {};
    oldRows.forEach((row) => {
      if (row && row.id !== null && row.id !== undefined && row.id !== '') {
        oldRowMap[String(row.id)] = row;
      }
    });

    const newIdSet = new Set();
    const targetFields = Array.isArray(setting.targetFields) ? setting.targetFields : [];
    const logRowAdd = setting.logRowAdd !== false;
    const logRowDelete = setting.logRowDelete !== false;
    const identifierField = setting.rowIdentifierField || '';

    newRows.forEach((row) => {
      const rowId = row && row.id !== null && row.id !== undefined && row.id !== '' ? String(row.id) : null;
      if (rowId) {
        newIdSet.add(rowId);
      }
      const rowKey = getRowKey(row, identifierField);
      const rowNo = getRowNo(newRows, row);
      const oldRow = rowId ? oldRowMap[rowId] : null;

      if (!oldRow) {
        let valuePushed = false;

        // 追加行の初期値も個別に残したい場合
        if (logRowAdd && setting.logAddedRowValues) {
          targetFields.forEach((fieldCode) => {
            if (!fieldCode || excluded.has(fieldCode)) {
              return;
            }
            const newMeta = CH.getSubtableFieldMeta(row, fieldCode);
            if (!newMeta || !CH.isSupportedTargetType(newMeta.type)) {
              return;
            }
            const display = CH.toDisplay(newMeta.value, newMeta.type);
            if (display === '') {
              return;
            }
            changes.push(buildBase(ctx, setting, {
              action: 'change',
              fieldCode,
              fieldLabel: getLabel(setting, fieldCode),
              fieldType: newMeta.type,
              oldValue: '',
              newValue: display,
              rowId,
              rowNo,
              rowKey,
              rowRef: row,
              targetRowId: rowId,
              targetRowRef: row,
              initialEvent: '（明細追加）'
            }));
            valuePushed = true;
          });
        }

        // 値ログが無いときだけ「明細追加」イベントを残す
        // 文字列保存ではヘッダー用に row_add が必要なので残す
        if (logRowAdd && (!valuePushed || setting.saveType === 'text')) {
          changes.push(buildBase(ctx, setting, {
            action: 'row_add',
            fieldCode: tableCode,
            fieldLabel: setting.sourceTableLabel || tableCode,
            fieldType: 'SUBTABLE',
            oldValue: '',
            newValue: rowKey ? `明細追加（${identifierField}:${rowKey}）` : '明細追加',
            rowId,
            rowNo,
            rowKey,
            rowRef: row,
            targetRowId: rowId,
            targetRowRef: row
          }));
        }
        return;
      }

      targetFields.forEach((fieldCode) => {
        if (!fieldCode || excluded.has(fieldCode)) {
          return;
        }
        const newMeta = CH.getSubtableFieldMeta(row, fieldCode);
        const oldMeta = CH.getSubtableFieldMeta(oldRow, fieldCode);
        if (!newMeta || !oldMeta) {
          return;
        }
        if (!CH.isSupportedTargetType(newMeta.type)) {
          return;
        }
        if (CH.isSameValue(oldMeta.value, newMeta.value, newMeta.type)) {
          return;
        }
        changes.push(buildBase(ctx, setting, {
          action: 'change',
          fieldCode,
          fieldLabel: getLabel(setting, fieldCode),
          fieldType: newMeta.type,
          oldValue: CH.toDisplay(oldMeta.value, newMeta.type),
          newValue: CH.toDisplay(newMeta.value, newMeta.type),
          rowId,
          rowNo,
          rowKey,
          rowRef: row,
          targetRowId: rowId,
          targetRowRef: row
        }));
      });
    });

    if (logRowDelete && oldRecord) {
      oldRows.forEach((oldRow) => {
        const rowId = oldRow && oldRow.id !== null && oldRow.id !== undefined && oldRow.id !== ''
          ? String(oldRow.id)
          : null;
        if (!rowId || newIdSet.has(rowId)) {
          return;
        }
        const rowKey = getRowKey(oldRow, identifierField);
        const rowNo = getRowNo(oldRows, oldRow);
        changes.push(buildBase(ctx, setting, {
          action: 'row_delete',
          fieldCode: tableCode,
          fieldLabel: setting.sourceTableLabel || tableCode,
          fieldType: 'SUBTABLE',
          oldValue: rowKey ? `明細削除（${identifierField}:${rowKey}）` : '明細削除',
          newValue: '',
          rowId,
          rowNo,
          rowKey,
          rowRef: oldRow,
          // 削除行には書けない
          targetRowId: null,
          targetRowRef: null
        }));
      });
    }
  };

  const detectCreateLogs = (newRecord, setting, excluded, ctx, changes) => {
    const logOnCreate = setting.logOnCreate !== false;
    if (!logOnCreate) {
      return;
    }
    const logValues = Boolean(setting.logOnCreateValues);

    if (setting.targetType === 'field') {
      if (!logValues) {
        // イベントのみ
        changes.push(buildBase(ctx, setting, {
          action: 'create',
          fieldCode: '__create__',
          fieldLabel: '新規登録',
          fieldType: 'CREATE_EVENT',
          oldValue: '',
          newValue: ''
        }));
        return;
      }

      const codes = Array.isArray(setting.targetFields) ? setting.targetFields : [];
      let pushed = false;
      codes.forEach((fieldCode) => {
        if (!fieldCode || excluded.has(fieldCode)) {
          return;
        }
        const meta = CH.getFieldMeta(newRecord, fieldCode);
        if (!meta || !CH.isSupportedTargetType(meta.type)) {
          return;
        }
        const display = CH.toDisplay(meta.value, meta.type);
        if (display === '') {
          return;
        }
        changes.push(buildBase(ctx, setting, {
          action: 'create',
          fieldCode,
          fieldLabel: getLabel(setting, fieldCode),
          fieldType: meta.type,
          oldValue: '',
          newValue: display,
          initialEvent: '（新規登録）'
        }));
        pushed = true;
      });
      if (!pushed) {
        changes.push(buildBase(ctx, setting, {
          action: 'create',
          fieldCode: '__create__',
          fieldLabel: '新規登録',
          fieldType: 'CREATE_EVENT',
          oldValue: '',
          newValue: ''
        }));
      }
      return;
    }

    if (setting.targetType === 'subtable') {
      // サブテーブルの新規登録は logRowAdd 系と共通（logOnCreate で制御）
      const tableCode = setting.sourceTable;
      if (!tableCode || excluded.has(tableCode)) {
        return;
      }
      const rows = CH.getTableRows(newRecord, tableCode);
      const identifierField = setting.rowIdentifierField || '';
      const targetFields = Array.isArray(setting.targetFields) ? setting.targetFields : [];
      const logValuesForRow = Boolean(setting.logAddedRowValues);

      rows.forEach((row) => {
        const rowId = row && row.id !== null && row.id !== undefined && row.id !== '' ? String(row.id) : null;
        const rowKey = getRowKey(row, identifierField);
        const rowNo = getRowNo(rows, row);
        let valuePushed = false;

        if (logValuesForRow) {
          targetFields.forEach((fieldCode) => {
            if (!fieldCode || excluded.has(fieldCode)) {
              return;
            }
            const newMeta = CH.getSubtableFieldMeta(row, fieldCode);
            if (!newMeta || !CH.isSupportedTargetType(newMeta.type)) {
              return;
            }
            const display = CH.toDisplay(newMeta.value, newMeta.type);
            if (display === '') {
              return;
            }
            changes.push(buildBase(ctx, setting, {
              action: 'create',
              fieldCode,
              fieldLabel: getLabel(setting, fieldCode),
              fieldType: newMeta.type,
              oldValue: '',
              newValue: display,
              rowId,
              rowNo,
              rowKey,
              rowRef: row,
              targetRowId: rowId,
              targetRowRef: row,
              initialEvent: '（新規登録）'
            }));
            valuePushed = true;
          });
        }

        // 値ログが無いときだけ「新規登録」イベント行を残す
        if (!valuePushed) {
          changes.push(buildBase(ctx, setting, {
            action: 'create',
            fieldCode: tableCode,
            fieldLabel: setting.sourceTableLabel || tableCode,
            fieldType: 'SUBTABLE',
            oldValue: '',
            newValue: rowKey ? `新規登録（${identifierField}:${rowKey}）` : '新規登録',
            rowId,
            rowNo,
            rowKey,
            rowRef: row,
            targetRowId: rowId,
            targetRowRef: row
          }));
        }
      });
    }
  };

  /**
   * @returns {Array} ChangeEntry[]
   */
  CH.detectChanges = (newRecord, oldRecord, settings, options) => {
    const opts = options || {};
    const allSettings = settings || [];
    const excluded = CH.collectExcludedFieldCodes(allSettings);
    const user = CH.getLoginUser();
    const ctx = {
      timestamp: opts.timestamp || CH.formatDateTime(new Date()),
      now: opts.now || new Date(),
      user
    };
    const changes = [];

    allSettings.forEach((setting) => {
      if (!setting || setting.enabled === false) {
        return;
      }
      if (opts.isCreate) {
        detectCreateLogs(newRecord, setting, excluded, ctx, changes);
        return;
      }
      if (!oldRecord) {
        return;
      }
      if (setting.targetType === 'field') {
        detectFieldChanges(newRecord, oldRecord, setting, excluded, ctx, changes);
      } else if (setting.targetType === 'subtable') {
        detectSubtableChanges(newRecord, oldRecord, setting, excluded, ctx, changes);
      }
    });

    return changes;
  };
})(window.ChangeHistory);
