/**
 * 変更履歴プラグイン - 履歴書き込み
 */
window.ChangeHistory = window.ChangeHistory || {};
((CH) => {
  'use strict';

  const ensureTextField = (container, fieldCode) => {
    if (!container || !fieldCode) {
      throw new Error('履歴保存先の文字列フィールドを特定できません。');
    }
    if (!container[fieldCode]) {
      throw new Error(`履歴保存先フィールド「${fieldCode}」が見つかりません。`);
    }
    if (container[fieldCode].value === null || container[fieldCode].value === undefined) {
      container[fieldCode].value = '';
    }
    return container[fieldCode];
  };

  const appendText = (field, block) => {
    const current = field.value ? String(field.value) : '';
    field.value = current ? `${current}\n\n${block}` : block;
  };

  const formatActionLabel = (change) => {
    if (change.action === 'row_add') {
      return change.newValue || '明細追加';
    }
    if (change.action === 'row_delete') {
      return change.oldValue || '明細削除';
    }
    if (change.action === 'create') {
      if (change.fieldType === 'SUBTABLE' || change.fieldType === 'CREATE_EVENT') {
        return change.rowKey
          ? `新規登録（${change.rowKey}）`
          : '新規登録';
      }
      const value = change.newValue && change.newValue !== '新規登録' ? change.newValue : '';
      return value ? `${change.fieldLabel}=${value}` : `${change.fieldLabel}=`;
    }
    return `${change.fieldLabel}：${change.oldValue} → ${change.newValue}`;
  };

  const formatCreateFieldLine = (change, options) => {
    const opts = options || {};
    if (change.fieldType === 'CREATE_EVENT') {
      return '';
    }
    if (change.fieldType === 'SUBTABLE') {
      // 行内保存では明細識別は不要。レコード本体保存時のみ行ラベルを出す
      if (opts.inRow) {
        return '';
      }
      if (change.rowKey) {
        return `[${change.rowKey}]`;
      }
      return '';
    }
    const value = change.newValue && change.newValue !== '新規登録' ? change.newValue : '';
    if (value === '') {
      return '';
    }
    return `${change.fieldLabel}=${value}`;
  };

  const formatFieldChangeLine = (change, options) => {
    const opts = options || {};
    // 行内保存では既にその行の履歴なので明細識別プレフィックスは不要
    const prefix = (!opts.inRow && change.rowKey) ? `[${change.rowKey}] ` : '';
    if (change.oldValue === '' && change.newValue) {
      return `${prefix}${change.fieldLabel}=${change.newValue}`;
    }
    return `${prefix}${change.fieldLabel}：${change.oldValue} → ${change.newValue}`;
  };

  /**
   * @param {Array} groupChanges
   * @param {{ inRow?: boolean, omitHeader?: boolean }} options
   *   inRow=true のとき行内文字列向け整形
   *   omitHeader=true のとき日時・氏名ヘッダーを出さない（履歴テーブル列側に持つ場合）
   */
  const formatTextBlock = (groupChanges, options) => {
    if (!groupChanges.length) {
      return '';
    }
    const opts = options || {};
    const head = groupChanges[0];
    const allCreate = groupChanges.every((change) => change.action === 'create');
    const hasRowAdd = groupChanges.some((change) => change.action === 'row_add');
    const valueChanges = groupChanges.filter((change) => (
      change.action === 'change'
      || (change.action === 'create' && change.fieldType !== 'SUBTABLE' && change.fieldType !== 'CREATE_EVENT')
    ));

    const pushHeader = (lines, suffix) => {
      const label = suffix ? String(suffix).trim() : '';
      if (opts.omitHeader) {
        if (label) {
          lines.push(label);
        }
        return;
      }
      const base = `[${head.timestamp}] ${head.userName}`;
      lines.push(label ? `${base}  ${label}` : base);
    };

    // 行内：行追加 + 初期値
    if (opts.inRow && hasRowAdd) {
      const lines = [];
      pushHeader(lines, '明細追加');
      valueChanges.forEach((change) => {
        if (change.action === 'change') {
          lines.push(formatFieldChangeLine(change, { inRow: true }));
        } else {
          const line = formatCreateFieldLine(change, { inRow: true });
          if (line) {
            lines.push(line);
          }
        }
      });
      return lines.join('\n');
    }

    // 行内：新規登録時の行
    if (opts.inRow && allCreate) {
      const lines = [];
      pushHeader(lines, '新規登録');
      groupChanges.forEach((change) => {
        const line = formatCreateFieldLine(change, { inRow: true });
        if (line) {
          lines.push(line);
        }
      });
      return lines.join('\n');
    }

    if (allCreate) {
      const lines = [];
      pushHeader(lines, '新規登録');
      groupChanges.forEach((change) => {
        const line = formatCreateFieldLine(change, opts);
        if (line) {
          lines.push(line);
        }
      });
      return lines.join('\n');
    }

    // レコード本体へ行追加を書く場合も、値があれば1ブロックにまとめる
    if (hasRowAdd && valueChanges.length) {
      const addChange = groupChanges.find((c) => c.action === 'row_add');
      const headerSuffix = addChange && addChange.rowKey
        ? `明細追加（${addChange.rowKey}）`
        : '明細追加';
      const lines = [];
      pushHeader(lines, headerSuffix);
      valueChanges.forEach((change) => {
        lines.push(formatFieldChangeLine(change, opts));
      });
      return lines.join('\n');
    }

    const lines = [];
    pushHeader(lines, '');
    groupChanges.forEach((change) => {
      if (change.action === 'change') {
        lines.push(formatFieldChangeLine(change, opts));
      } else {
        lines.push(formatActionLabel(change));
      }
    });
    return lines.join('\n');
  };

  const writeTextToRecord = (record, fieldCode, changes) => {
    if (!fieldCode || !changes.length) {
      return;
    }
    const field = ensureTextField(record, fieldCode);
    appendText(field, formatTextBlock(changes, { inRow: false }));
  };

  const writeTextToRows = (record, setting, changes) => {
    const fieldCode = setting.textDestField;
    const tableCode = setting.sourceTable;
    if (!fieldCode || !tableCode || !changes.length) {
      return;
    }

    const byRow = new Map();
    changes.forEach((change) => {
      if (change.action === 'row_delete') {
        return;
      }
      const row = change.targetRowRef;
      if (!row || !row.value) {
        return;
      }
      // 新規行は rowId が無いため、行オブジェクト参照で同一行をまとめる
      const key = change.rowId ? `id:${change.rowId}` : row;
      if (!byRow.has(key)) {
        byRow.set(key, { row, items: [] });
      }
      byRow.get(key).items.push(change);
    });

    byRow.forEach(({ row, items }) => {
      const field = ensureTextField(row.value, fieldCode);
      appendText(field, formatTextBlock(items, { inRow: true }));
    });

    const deletes = changes.filter((c) => c.action === 'row_delete');
    if (deletes.length && record[fieldCode] && record[fieldCode].type === 'MULTI_LINE_TEXT') {
      writeTextToRecord(record, fieldCode, deletes);
    }
  };

  const DEFAULT_HISTORY_COLUMN_TYPES = {
    datetime: 'SINGLE_LINE_TEXT',
    user: 'SINGLE_LINE_TEXT',
    target: 'SINGLE_LINE_TEXT',
    before: 'MULTI_LINE_TEXT',
    after: 'MULTI_LINE_TEXT',
    tableName: 'SINGLE_LINE_TEXT',
    rowLabel: 'SINGLE_LINE_TEXT',
    rowNo: 'SINGLE_LINE_TEXT',
    rowId: 'SINGLE_LINE_TEXT', // 旧設定互換
    content: 'MULTI_LINE_TEXT'
  };

  const resolveHistoryCellValue = (change, columnKey, sampleType) => {
    if (columnKey === 'datetime') {
      if (sampleType === 'DATETIME' || sampleType === 'DATE' || sampleType === 'TIME') {
        return CH.formatDateTimeForField(new Date(), sampleType);
      }
      return change.timestamp;
    }

    if (columnKey === 'user') {
      if (sampleType === 'USER_SELECT') {
        const user = CH.getLoginUser();
        return user.code ? [{ code: user.code, name: user.name }] : [];
      }
      return change.userName;
    }

    if (columnKey === 'target') {
      if (change.action === 'row_add') {
        return '明細追加';
      }
      if (change.action === 'row_delete') {
        return '明細削除';
      }
      if (change.action === 'create') {
        // イベントのみのときだけ「新規登録」。値付きは変更対象＝フィールド名
        if (change.fieldType === 'CREATE_EVENT' || change.fieldType === 'SUBTABLE') {
          return '新規登録';
        }
        return change.fieldLabel || change.fieldCode || '新規登録';
      }
      return change.fieldLabel || change.fieldCode || '';
    }

    if (columnKey === 'before') {
      // 新規登録・行追加の初期値は、変更前にイベント名を入れて通常更新と揃える
      if (change.initialEvent) {
        return change.initialEvent;
      }
      if (change.action === 'change') {
        return change.oldValue || '';
      }
      return '';
    }

    if (columnKey === 'after') {
      if (change.action === 'change') {
        return change.newValue || '';
      }
      // 新規登録・行追加・削除のイベント行は変更後を空にする
      if (change.action === 'row_add' || change.action === 'row_delete') {
        return '';
      }
      if (change.action === 'create') {
        if (change.fieldType === 'CREATE_EVENT' || change.fieldType === 'SUBTABLE') {
          return '';
        }
        return change.newValue || '';
      }
      return formatActionLabel(change);
    }

    if (columnKey === 'tableName') {
      return change.sourceTableLabel || change.sourceTable || '';
    }
    if (columnKey === 'rowLabel') {
      return change.rowKey || '';
    }
    if (columnKey === 'rowNo' || columnKey === 'rowId') {
      // 行NOは保存時点のテーブル内順番（1始まり）。新規行でも付与可能
      return change.rowNo || '';
    }
    if (columnKey === 'content') {
      return '';
    }
    return '';
  };

  const getSampleFieldType = (historyTableField, fieldCode) => {
    if (!historyTableField || !Array.isArray(historyTableField.value)) {
      return null;
    }
    for (let i = 0; i < historyTableField.value.length; i += 1) {
      const row = historyTableField.value[i];
      if (row && row.value && row.value[fieldCode] && row.value[fieldCode].type) {
        return row.value[fieldCode].type;
      }
    }
    return null;
  };

  const resolveHistoryFieldType = (historyTableField, fieldCode, columnKey, tableCode) => {
    if (
      tableCode
      && CH.formSchema
      && CH.formSchema.subtableFields
      && CH.formSchema.subtableFields[tableCode]
      && CH.formSchema.subtableFields[tableCode][fieldCode]
      && CH.formSchema.subtableFields[tableCode][fieldCode].type
    ) {
      return CH.formSchema.subtableFields[tableCode][fieldCode].type;
    }
    const sampleType = getSampleFieldType(historyTableField, fieldCode);
    if (sampleType) {
      return sampleType;
    }
    if (CH.fieldTypes && CH.fieldTypes[fieldCode]) {
      return CH.fieldTypes[fieldCode];
    }
    if (DEFAULT_HISTORY_COLUMN_TYPES[columnKey]) {
      return DEFAULT_HISTORY_COLUMN_TYPES[columnKey];
    }
    return 'SINGLE_LINE_TEXT';
  };

  const emptyValueForType = (fieldType) => {
    if (
      fieldType === 'CHECK_BOX'
      || fieldType === 'MULTI_SELECT'
      || fieldType === 'USER_SELECT'
      || fieldType === 'ORGANIZATION_SELECT'
      || fieldType === 'GROUP_SELECT'
      || fieldType === 'FILE'
    ) {
      return [];
    }
    return '';
  };

  const coerceCellValue = (fieldType, value) => {
    if (
      fieldType === 'CHECK_BOX'
      || fieldType === 'MULTI_SELECT'
      || fieldType === 'USER_SELECT'
      || fieldType === 'ORGANIZATION_SELECT'
      || fieldType === 'GROUP_SELECT'
      || fieldType === 'FILE'
    ) {
      return Array.isArray(value) ? value : [];
    }
    if (value === null || value === undefined) {
      return '';
    }
    return String(value);
  };

  /**
   * 履歴テーブルの全列（コード→型）を取得する。
   * 行追加時は全列を揃えないと「フィールドが不正です」になるため。
   */
  const getHistoryTableFieldMap = (tableCode, historyTableField, columns) => {
    const map = {};

    if (
      CH.formSchema
      && CH.formSchema.subtableFields
      && CH.formSchema.subtableFields[tableCode]
    ) {
      Object.keys(CH.formSchema.subtableFields[tableCode]).forEach((code) => {
        const meta = CH.formSchema.subtableFields[tableCode][code];
        if (meta && meta.type) {
          map[code] = meta.type;
        }
      });
    }

    if (!Object.keys(map).length && historyTableField && Array.isArray(historyTableField.value)) {
      historyTableField.value.forEach((row) => {
        if (!row || !row.value) {
          return;
        }
        Object.keys(row.value).forEach((code) => {
          if (row.value[code] && row.value[code].type && !map[code]) {
            map[code] = row.value[code].type;
          }
        });
      });
    }

    Object.keys(columns || {}).forEach((columnKey) => {
      const fieldCode = columns[columnKey];
      if (!fieldCode || map[fieldCode]) {
        return;
      }
      map[fieldCode] = resolveHistoryFieldType(historyTableField, fieldCode, columnKey, tableCode);
    });

    return map;
  };

  const buildFieldToColumnKey = (columns) => {
    const map = {};
    Object.keys(columns || {}).forEach((columnKey) => {
      const fieldCode = columns[columnKey];
      if (fieldCode) {
        map[fieldCode] = columnKey;
      }
    });
    return map;
  };

  const isBlankCellValue = (value) => {
    if (value === null || value === undefined) {
      return true;
    }
    if (Array.isArray(value)) {
      return value.length === 0;
    }
    return String(value) === '';
  };

  const isEmptyHistoryRow = (row, mappedFieldCodes) => {
    if (!row || !row.value) {
      return true;
    }
    if (!mappedFieldCodes.length) {
      return Object.keys(row.value).every((code) => isBlankCellValue(row.value[code] && row.value[code].value));
    }
    return mappedFieldCodes.every((code) => {
      const cell = row.value[code];
      return isBlankCellValue(cell && cell.value);
    });
  };

  const removeEmptyDraftRows = (historyTableField, columns) => {
    const mappedFieldCodes = Object.keys(columns)
      .map((key) => columns[key])
      .filter(Boolean);
    if (!historyTableField || !Array.isArray(historyTableField.value)) {
      return;
    }
    // 新規作成時にkintoneが入れる空の下書き行を除去（保存済み行 id 付きは残す）
    historyTableField.value = historyTableField.value.filter((row) => {
      if (row && row.id !== null && row.id !== undefined && row.id !== '') {
        return true;
      }
      return !isEmptyHistoryRow(row, mappedFieldCodes);
    });
  };

  const prepareHistoryTableWrite = (record, setting) => {
    const tableCode = setting.historyTable;
    const columns = setting.historyColumns || {};
    if (!tableCode) {
      return null;
    }
    // 欠落テーブルを捏造すると kintone 標準エラーになるため、存在しない場合は中断する
    if (!record[tableCode]) {
      throw new Error(`履歴用サブテーブル「${tableCode}」がレコード上にありません。`);
    }
    if (!Array.isArray(record[tableCode].value)) {
      record[tableCode].value = [];
    }

    const tableFieldMap = getHistoryTableFieldMap(tableCode, record[tableCode], columns);
    if (!Object.keys(tableFieldMap).length) {
      throw new Error(`履歴用サブテーブル「${tableCode}」の列情報を取得できません。画面を再読み込みしてください。`);
    }
    const fieldToColumn = buildFieldToColumnKey(columns);

    removeEmptyDraftRows(record[tableCode], columns);

    // 列追加後の既存行に欠けているフィールドを補完（行NO追加後など）
    record[tableCode].value.forEach((row) => {
      if (!row || !row.value) {
        return;
      }
      Object.keys(tableFieldMap).forEach((fieldCode) => {
        const fieldType = tableFieldMap[fieldCode];
        if (!row.value[fieldCode]) {
          row.value[fieldCode] = {
            type: fieldType,
            value: emptyValueForType(fieldType)
          };
          return;
        }
        if (!row.value[fieldCode].type) {
          row.value[fieldCode].type = fieldType;
        }
        if (row.value[fieldCode].value === null || row.value[fieldCode].value === undefined) {
          row.value[fieldCode].value = emptyValueForType(fieldType);
        }
      });
    });

    return {
      tableCode,
      columns,
      tableFieldMap,
      fieldToColumn
    };
  };

  const buildHistoryRowValue = (tableFieldMap, fieldToColumn, resolveValue) => {
    const rowValue = {};
    Object.keys(tableFieldMap).forEach((fieldCode) => {
      const fieldType = tableFieldMap[fieldCode];
      const columnKey = fieldToColumn[fieldCode];
      const rawValue = columnKey
        ? resolveValue(columnKey, fieldType)
        : emptyValueForType(fieldType);
      rowValue[fieldCode] = {
        type: fieldType,
        value: coerceCellValue(fieldType, rawValue)
      };
    });
    return rowValue;
  };

  const writeSubtableHistory = (record, setting, changes) => {
    if (!changes.length) {
      return;
    }
    const prepared = prepareHistoryTableWrite(record, setting);
    if (!prepared) {
      return;
    }
    const { tableCode, tableFieldMap, fieldToColumn } = prepared;

    changes.forEach((change) => {
      const rowValue = buildHistoryRowValue(tableFieldMap, fieldToColumn, (columnKey, fieldType) => (
        resolveHistoryCellValue(change, columnKey, fieldType)
      ));
      record[tableCode].value.push({ value: rowValue });
    });
  };

  const writeSubtableHistoryPerSave = (record, setting, changes) => {
    if (!changes.length) {
      return;
    }
    const prepared = prepareHistoryTableWrite(record, setting);
    if (!prepared) {
      return;
    }
    const { tableCode, tableFieldMap, fieldToColumn } = prepared;
    const sample = changes[0];
    const content = formatTextBlock(changes, { omitHeader: true });
    const rowValue = buildHistoryRowValue(tableFieldMap, fieldToColumn, (columnKey, fieldType) => {
      if (columnKey === 'content') {
        return content;
      }
      return resolveHistoryCellValue(sample, columnKey, fieldType);
    });
    record[tableCode].value.push({ value: rowValue });
  };

  /**
   * レコード再利用時など、履歴保存先を初期化する
   * - 文字列（複数行）保存先を空文字に
   * - 履歴用サブテーブルを空配列に
   */
  CH.clearHistoryDestinations = (record, settings) => {
    if (!record || !Array.isArray(settings) || settings.length === 0) {
      return false;
    }

    let cleared = false;

    settings.forEach((setting) => {
      if (!setting) {
        return;
      }

      if (setting.saveType === 'text' && setting.textDestField) {
        if (setting.textDestType === 'row' && setting.sourceTable) {
          const rows = CH.getTableRows(record, setting.sourceTable);
          rows.forEach((row) => {
            if (!row || !row.value) {
              return;
            }
            if (!row.value[setting.textDestField]) {
              row.value[setting.textDestField] = { type: 'MULTI_LINE_TEXT', value: '' };
            } else {
              row.value[setting.textDestField].value = '';
            }
            cleared = true;
          });
        } else if (record[setting.textDestField]) {
          record[setting.textDestField].value = '';
          cleared = true;
        }
      }

      if (setting.saveType === 'subtable' && setting.historyTable && record[setting.historyTable]) {
        record[setting.historyTable].value = [];
        cleared = true;
      }
    });

    return cleared;
  };

  /**
   * 変更エントリをレコードへ反映
   */
  CH.applyChanges = (record, changes) => {
    if (!record || !Array.isArray(changes) || changes.length === 0) {
      return false;
    }

    const groups = new Map();
    changes.forEach((change) => {
      const key = [
        change.settingId,
        change.saveType,
        change.textDestType || '',
        change.textDestField || '',
        change.historyTable || '',
        change.historyRowGrain || '',
        change.sourceTable || ''
      ].join('::');
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key).push(change);
    });

    groups.forEach((group) => {
      const sample = group[0];
      if (sample.saveType === 'text') {
        if (sample.textDestType === 'row') {
          writeTextToRows(record, sample, group);
        } else {
          writeTextToRecord(record, sample.textDestField, group);
        }
      } else if (sample.saveType === 'subtable') {
        if (sample.historyRowGrain === 'perSave') {
          writeSubtableHistoryPerSave(record, sample, group);
        } else {
          writeSubtableHistory(record, sample, group);
        }
      }
    });

    return true;
  };
})(window.ChangeHistory);
