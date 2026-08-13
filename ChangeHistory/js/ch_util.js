/**
 * 変更履歴プラグイン - 共通ユーティリティ
 */
window.ChangeHistory = window.ChangeHistory || {};
((CH) => {
  'use strict';

  CH.CONFIG_KEY = 'historySettings';

  CH.SUPPORTED_TARGET_TYPES = [
    'SINGLE_LINE_TEXT',
    'MULTI_LINE_TEXT',
    'NUMBER',
    'RADIO_BUTTON',
    'DROP_DOWN',
    'CHECK_BOX',
    'MULTI_SELECT',
    'DATE',
    'TIME',
    'DATETIME',
    'USER_SELECT',
    'ORGANIZATION_SELECT',
    'GROUP_SELECT',
    'LINK'
  ];

  CH.UNSUPPORTED_TARGET_TYPES = [
    'FILE',
    'RICH_TEXT',
    'CALC',
    'REFERENCE_TABLE',
    'CATEGORY',
    'STATUS',
    'STATUS_ASSIGNEE',
    'RECORD_NUMBER',
    'CREATOR',
    'CREATED_TIME',
    'MODIFIER',
    'UPDATED_TIME',
    'GROUP',
    'SPACER',
    'HR'
  ];

  CH.deepCopy = (obj) => {
    if (obj === null || obj === undefined) {
      return obj;
    }
    return JSON.parse(JSON.stringify(obj));
  };

  CH.pad2 = (num) => (num < 10 ? `0${num}` : String(num));

  CH.formatDateTime = (date) => {
    const d = date instanceof Date ? date : new Date(date);
    return `${d.getFullYear()}-${CH.pad2(d.getMonth() + 1)}-${CH.pad2(d.getDate())} ${CH.pad2(d.getHours())}:${CH.pad2(d.getMinutes())}`;
  };

  CH.formatDateTimeForField = (date, fieldType) => {
    const d = date instanceof Date ? date : new Date(date);
    if (fieldType === 'DATETIME') {
      const offsetMin = -d.getTimezoneOffset();
      const sign = offsetMin >= 0 ? '+' : '-';
      const abs = Math.abs(offsetMin);
      const oh = CH.pad2(Math.floor(abs / 60));
      const om = CH.pad2(abs % 60);
      return `${d.getFullYear()}-${CH.pad2(d.getMonth() + 1)}-${CH.pad2(d.getDate())}T${CH.pad2(d.getHours())}:${CH.pad2(d.getMinutes())}:${CH.pad2(d.getSeconds())}${sign}${oh}:${om}`;
    }
    if (fieldType === 'DATE') {
      return `${d.getFullYear()}-${CH.pad2(d.getMonth() + 1)}-${CH.pad2(d.getDate())}`;
    }
    if (fieldType === 'TIME') {
      return `${CH.pad2(d.getHours())}:${CH.pad2(d.getMinutes())}`;
    }
    return CH.formatDateTime(d);
  };

  CH.getLoginUser = () => {
    try {
      const user = kintone.getLoginUser();
      return {
        code: user && user.code ? user.code : '',
        name: user && user.name ? user.name : 'ユーザー'
      };
    } catch (e) {
      return { code: '', name: 'ユーザー' };
    }
  };

  CH.getRecordIdSafe = (record) => {
    if (record && record.$id && record.$id.value) {
      return record.$id.value;
    }
    try {
      return kintone.app.record.getId();
    } catch (e) {
      try {
        return kintone.mobile.app.record.getId();
      } catch (e2) {
        return null;
      }
    }
  };

  CH.getAppIdSafe = () => {
    try {
      return kintone.app.getId();
    } catch (e) {
      try {
        return kintone.mobile.app.getId();
      } catch (e2) {
        return null;
      }
    }
  };

  CH.fetchRecordById = (recordId) => {
    const appId = CH.getAppIdSafe();
    if (!appId || !recordId) {
      return Promise.resolve(null);
    }
    return kintone.api(kintone.api.url('/k/v1/record.json', true), 'GET', { app: appId, id: recordId })
      .then((resp) => (resp && resp.record ? resp.record : null))
      .catch(() => null);
  };

  CH.fetchRecordsByCurrentIndexQuery = () => {
    const appId = CH.getAppIdSafe();
    if (!appId) {
      return Promise.resolve(null);
    }
    let query = '';
    try {
      query = String(kintone.app.getQuery() || '');
    } catch (e) {
      try {
        query = String(kintone.mobile.app.getQuery() || '');
      } catch (e2) {
        query = '';
      }
    }
    return kintone.api(kintone.api.url('/k/v1/records.json', true), 'GET', { app: appId, query })
      .then((resp) => (resp && resp.records ? resp.records : []))
      .catch(() => null);
  };

  CH.parseSettings = (config) => {
    const raw = config && config[CH.CONFIG_KEY] ? config[CH.CONFIG_KEY] : '[]';
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((s) => s && s.enabled !== false) : [];
    } catch (e) {
      console.error('historySettings の解析に失敗しました', e);
      return [];
    }
  };

  CH.parseAllSettings = (config) => {
    const raw = config && config[CH.CONFIG_KEY] ? config[CH.CONFIG_KEY] : '[]';
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  };

  /**
   * 全体設定: 入力画面で履歴保存先を非表示にする
   * 旧設定（各履歴設定の hideDestOnEdit）が1件でもONなら全体ONとして引き継ぐ
   */
  CH.parseHideDestOnEdit = (config) => {
    if (config && config.hideDestOnEdit === 'true') {
      return true;
    }
    if (config && config.hideDestOnEdit === 'false') {
      return false;
    }
    return CH.parseAllSettings(config).some((setting) => Boolean(setting && setting.hideDestOnEdit));
  };

  /**
   * 全体設定: 入力画面で履歴保存先を編集不可にする
   * 未設定（既存アプリ）は ON として扱う
   */
  CH.parseLockDestOnEdit = (config) => {
    if (config && config.lockDestOnEdit === 'false') {
      return false;
    }
    return true;
  };

  /**
   * 履歴保存先フィールドを監視対象から除外するためのコード集合
   */
  CH.collectExcludedFieldCodes = (settings) => {
    const excluded = new Set();
    (settings || []).forEach((setting) => {
      if (!setting) {
        return;
      }
      if (setting.saveType === 'text' && setting.textDestField) {
        excluded.add(setting.textDestField);
      }
      if (setting.saveType === 'subtable' && setting.historyTable) {
        excluded.add(setting.historyTable);
        const cols = setting.historyColumns || {};
        Object.keys(cols).forEach((key) => {
          if (cols[key]) {
            excluded.add(cols[key]);
          }
        });
      }
    });
    return excluded;
  };

  CH.getTableRows = (record, tableCode) => {
    const table = record && tableCode ? record[tableCode] : null;
    if (!table || !Array.isArray(table.value)) {
      return [];
    }
    return table.value;
  };

  CH.getFieldMeta = (record, fieldCode) => {
    if (!record || !fieldCode || !record[fieldCode]) {
      return null;
    }
    return record[fieldCode];
  };

  CH.getSubtableFieldMeta = (row, fieldCode) => {
    if (!row || !row.value || !fieldCode || !row.value[fieldCode]) {
      return null;
    }
    return row.value[fieldCode];
  };

  CH.createId = () => `hs_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  CH.fieldTypes = {};
  CH.formSchema = {
    loaded: false,
    topLevel: {},
    subtableFields: {}
  };

  CH.setFieldTypesFromProperties = (properties) => {
    const map = {};
    const topLevel = {};
    const subtableFields = {};

    Object.keys(properties || {}).forEach((code) => {
      const prop = properties[code];
      if (!prop) {
        return;
      }
      if (prop.type === 'SUBTABLE' && prop.fields) {
        const innerMap = {};
        Object.keys(prop.fields).forEach((innerCode) => {
          const inner = prop.fields[innerCode];
          if (inner && inner.type) {
            map[innerCode] = inner.type;
            innerMap[innerCode] = {
              type: inner.type,
              label: inner.label || innerCode
            };
          }
        });
        map[code] = 'SUBTABLE';
        topLevel[code] = {
          type: 'SUBTABLE',
          label: prop.label || code
        };
        subtableFields[code] = innerMap;
        return;
      }
      if (prop.type) {
        map[code] = prop.type;
        topLevel[code] = {
          type: prop.type,
          label: prop.label || code
        };
      }
    });

    CH.fieldTypes = map;
    CH.formSchema = {
      loaded: true,
      topLevel,
      subtableFields
    };
    return map;
  };

  CH.ensureFieldTypesLoaded = () => {
    if (CH._fieldTypesPromise) {
      return CH._fieldTypesPromise;
    }
    const appId = CH.getAppIdSafe();
    if (!appId) {
      return Promise.resolve(CH.fieldTypes);
    }
    CH._fieldTypesPromise = kintone.api(
      kintone.api.url('/k/v1/app/form/fields.json', true),
      'GET',
      { app: appId }
    ).then((resp) => CH.setFieldTypesFromProperties((resp && resp.properties) || {}))
      .catch((error) => {
        console.error('変更履歴: フォーム定義の取得に失敗しました', error);
        CH._fieldTypesPromise = null;
        CH.formSchema = {
          loaded: false,
          topLevel: {},
          subtableFields: {}
        };
        return CH.fieldTypes;
      });
    return CH._fieldTypesPromise;
  };

  const describeSetting = (setting, index) => {
    const n = index + 1;
    if (setting && setting.targetType === 'subtable') {
      const tableName = setting.sourceTableLabel || setting.sourceTable || '（未設定）';
      return `履歴設定${n}（サブテーブル: ${tableName}）`;
    }
    return `履歴設定${n}（通常フィールド）`;
  };

  const hasTopLevelField = (code) => Boolean(
    code && CH.formSchema && CH.formSchema.topLevel && CH.formSchema.topLevel[code]
  );

  const hasSubtableField = (tableCode, fieldCode) => Boolean(
    tableCode
    && fieldCode
    && CH.formSchema
    && CH.formSchema.subtableFields
    && CH.formSchema.subtableFields[tableCode]
    && CH.formSchema.subtableFields[tableCode][fieldCode]
  );

  const isSubtable = (code) => (
    hasTopLevelField(code) && CH.formSchema.topLevel[code].type === 'SUBTABLE'
  );

  /**
   * プラグイン設定と現行フォーム定義の整合を検証する。
   * @returns {{ ok: boolean, skipped: boolean, errors: string[] }}
   */
  CH.validateSettingsAgainstForm = (settings) => {
    if (!CH.formSchema || !CH.formSchema.loaded) {
      return { ok: true, skipped: true, errors: [] };
    }

    const errors = [];
    (settings || []).forEach((setting, index) => {
      if (!setting || setting.enabled === false) {
        return;
      }

      const label = describeSetting(setting, index);
      const targetFields = Array.isArray(setting.targetFields) ? setting.targetFields.filter(Boolean) : [];

      if (setting.targetType === 'subtable') {
        if (!setting.sourceTable) {
          errors.push(`${label}: 対象テーブルが設定されていません。`);
        } else if (!isSubtable(setting.sourceTable)) {
          errors.push(`${label}: 対象テーブル「${setting.sourceTable}」が見つかりません（削除またはコード変更の可能性）。`);
        } else {
          targetFields.forEach((fieldCode) => {
            if (!hasSubtableField(setting.sourceTable, fieldCode)) {
              errors.push(`${label}: 監視対象フィールド「${fieldCode}」が対象テーブル内にありません。`);
            }
          });
          if (setting.rowIdentifierField
            && !hasSubtableField(setting.sourceTable, setting.rowIdentifierField)) {
            errors.push(`${label}: 明細識別フィールド「${setting.rowIdentifierField}」が見つかりません。`);
          }
        }
      } else {
        targetFields.forEach((fieldCode) => {
          if (!hasTopLevelField(fieldCode)) {
            errors.push(`${label}: 監視対象フィールド「${fieldCode}」が見つかりません。`);
          }
        });
      }

      if (setting.saveType === 'text') {
        if (!setting.textDestField) {
          errors.push(`${label}: 履歴保存先の文字列フィールドが設定されていません。`);
        } else if (setting.textDestType === 'row') {
          if (!setting.sourceTable || !isSubtable(setting.sourceTable)) {
            errors.push(`${label}: 行内保存のための対象テーブルが見つかりません。`);
          } else if (!hasSubtableField(setting.sourceTable, setting.textDestField)) {
            errors.push(`${label}: 行内の履歴保存先「${setting.textDestField}」が見つかりません。`);
          }
        } else if (!hasTopLevelField(setting.textDestField)) {
          errors.push(`${label}: 履歴保存先フィールド「${setting.textDestField}」が見つかりません。`);
        }
      } else if (setting.saveType === 'subtable') {
        if (!setting.historyTable) {
          errors.push(`${label}: 履歴用サブテーブルが設定されていません。`);
        } else if (!isSubtable(setting.historyTable)) {
          errors.push(`${label}: 履歴用サブテーブル「${setting.historyTable}」が見つかりません（削除またはコード変更の可能性）。`);
        } else {
          const columns = setting.historyColumns || {};
          Object.keys(columns).forEach((columnKey) => {
            const fieldCode = columns[columnKey];
            if (!fieldCode) {
              return;
            }
            if (!hasSubtableField(setting.historyTable, fieldCode)) {
              errors.push(`${label}: 履歴テーブル列「${fieldCode}」（${columnKey}）が見つかりません。`);
            }
          });
        }
      }
    });

    return { ok: errors.length === 0, skipped: false, errors };
  };

  CH.buildPluginErrorMessage = (errors) => {
    CH.ensureErrorMessageLineBreaks();
    const lines = Array.isArray(errors) ? errors.filter(Boolean) : [];
    if (!lines.length) {
      return '【変更履歴管理】設定に問題があるため保存を中止しました。\nプラグイン設定を確認してください。';
    }
    return [
      '【変更履歴管理】設定したフィールド／テーブルが見つからないため、保存を中止しました。',
      '',
      ...lines,
      '',
      'アプリのフィールド削除・コード変更後は、プラグイン設定を見直してください。'
    ].join('\n');
  };

  /**
   * event.error の \n を改行表示させる（kintone標準は white-space で潰れる）
   */
  CH.ensureErrorMessageLineBreaks = () => {
    const styleId = 'changehistory-error-linebreaks';
    if (document.getElementById(styleId)) {
      return;
    }
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = '.notifier-body-cybozu li { white-space: pre-wrap; }';
    document.head.appendChild(style);
  };

  /**
   * 履歴保存先（レコード本体フィールド／履歴テーブル／行内文字列）を収集
   */
  CH.collectDestinationTargets = (settings) => {
    const fieldCodes = new Set();
    const historyTables = new Set();
    const rowFields = [];
    (settings || []).forEach((setting) => {
      if (!setting) {
        return;
      }
      if (setting.saveType === 'text' && setting.textDestField) {
        if (setting.textDestType === 'row' && setting.sourceTable) {
          rowFields.push({
            tableCode: setting.sourceTable,
            fieldCode: setting.textDestField
          });
          fieldCodes.add(setting.textDestField);
        } else {
          fieldCodes.add(setting.textDestField);
        }
      }
      if (setting.saveType === 'subtable' && setting.historyTable) {
        fieldCodes.add(setting.historyTable);
        historyTables.add(setting.historyTable);
      }
    });
    return {
      fieldCodes: Array.from(fieldCodes),
      historyTables: Array.from(historyTables),
      rowFields
    };
  };

  /**
   * 入力画面で非表示にする履歴保存先フィールドコードを収集
   */
  CH.collectHiddenDestinationCodes = (settings, hideDestOnEdit) => {
    if (!hideDestOnEdit) {
      return [];
    }
    return CH.collectDestinationTargets(settings).fieldCodes;
  };

  const lockSubtableCells = (tableField) => {
    if (!tableField || !Array.isArray(tableField.value)) {
      return;
    }
    tableField.value.forEach((row) => {
      if (!row || !row.value) {
        return;
      }
      Object.keys(row.value).forEach((innerCode) => {
        if (row.value[innerCode]) {
          row.value[innerCode].disabled = true;
        }
      });
    });
  };

  /**
   * 新規・編集・一覧編集で履歴保存先を編集不可にする（権限は落とさない）
   */
  CH.lockDestinationFieldsOnEdit = (record, settings, lockDestOnEdit) => {
    if (!lockDestOnEdit || !record) {
      return;
    }
    const targets = CH.collectDestinationTargets(settings);
    targets.fieldCodes.forEach((code) => {
      if (!record[code]) {
        return;
      }
      record[code].disabled = true;
      if (record[code].type === 'SUBTABLE') {
        lockSubtableCells(record[code]);
      }
    });
    targets.historyTables.forEach((tableCode) => {
      if (record[tableCode] && record[tableCode].type === 'SUBTABLE') {
        lockSubtableCells(record[tableCode]);
      }
    });
    targets.rowFields.forEach((item) => {
      const rows = CH.getTableRows(record, item.tableCode);
      rows.forEach((row) => {
        if (row && row.value && row.value[item.fieldCode]) {
          row.value[item.fieldCode].disabled = true;
        }
      });
    });
  };

  CH.ensureHistoryTableLockStyles = () => {
    const styleId = 'changehistory-lock-subtable-ops';
    if (document.getElementById(styleId)) {
      return;
    }
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = [
      '.ch-history-table-locked .add-row-image-gaia,',
      '.ch-history-table-locked .remove-row-image-gaia,',
      '.ch-history-table-locked .add-row-image-action-gaia,',
      '.ch-history-table-locked .subtable-operation-gaia {',
      '  display: none !important;',
      '}'
    ].join('\n');
    document.head.appendChild(style);
  };

  /**
   * 履歴テーブルの行追加・削除ボタンを隠す（公式APIでは止められない）
   */
  CH.hideHistoryTableRowButtons = (settings, eventType) => {
    const tables = CH.collectDestinationTargets(settings).historyTables;
    if (!tables.length) {
      return;
    }
    CH.ensureHistoryTableLockStyles();
    const hideOnce = () => {
      tables.forEach((code) => {
        try {
          const el = CH.isMobileEvent(eventType)
            ? kintone.mobile.app.record.getFieldElement(code)
            : kintone.app.record.getFieldElement(code);
          if (!el) {
            return;
          }
          el.classList.add('ch-history-table-locked');
        } catch (e) {
          console.warn('変更履歴: 履歴テーブル操作ボタンの非表示に失敗しました', code, e);
        }
      });
    };
    hideOnce();
    setTimeout(hideOnce, 0);
    setTimeout(hideOnce, 200);
  };

  /**
   * 新規・編集画面で履歴保存先を非表示にする
   */
  CH.hideDestinationFieldsOnEdit = (settings, eventType, hideDestOnEdit) => {
    const codes = CH.collectHiddenDestinationCodes(settings, hideDestOnEdit);
    if (!codes.length) {
      return;
    }
    const isMobile = CH.isMobileEvent(eventType);
    codes.forEach((code) => {
      try {
        if (isMobile) {
          kintone.mobile.app.record.setFieldShown(code, false);
        } else {
          kintone.app.record.setFieldShown(code, false);
        }
      } catch (e) {
        console.warn('変更履歴: 履歴保存先の非表示に失敗しました', code, e);
      }
    });
  };

  /**
   * 入力画面の履歴保存先UI（編集不可／非表示）を適用する
   */
  CH.applyDestinationFieldUi = (event, settings, options) => {
    const opts = options || {};
    if (opts.lockDestOnEdit) {
      CH.lockDestinationFieldsOnEdit(event.record, settings, true);
      if (Array.isArray(event.records)) {
        event.records.forEach((record) => {
          CH.lockDestinationFieldsOnEdit(record, settings, true);
        });
      }
    }
    if (opts.hideDestOnEdit) {
      CH.hideDestinationFieldsOnEdit(settings, event.type, true);
    }
    if (opts.lockDestOnEdit) {
      CH.hideHistoryTableRowButtons(settings, event.type);
    }
  };

  CH.isCreateEvent = (eventType) => String(eventType || '').includes('.create.');
  CH.isEditEvent = (eventType) => String(eventType || '').includes('.edit.');
  CH.isIndexEvent = (eventType) => String(eventType || '').includes('.index.');
  CH.isMobileEvent = (eventType) => String(eventType || '').startsWith('mobile.');
})(window.ChangeHistory);
