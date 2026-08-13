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
   * 履歴テーブルごとに、プラグインが書き込む列コードを収集する
   * @returns {Object<string, Set<string>>}
   */
  CH.collectHistoryTableLockColumns = (settings) => {
    const byTable = {};
    (settings || []).forEach((setting) => {
      if (!setting || setting.saveType !== 'subtable' || !setting.historyTable) {
        return;
      }
      const tableCode = setting.historyTable;
      if (!byTable[tableCode]) {
        byTable[tableCode] = new Set();
      }
      const cols = setting.historyColumns || {};
      Object.keys(cols).forEach((key) => {
        if (cols[key]) {
          byTable[tableCode].add(cols[key]);
        }
      });
    });
    return byTable;
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

  const lockSubtableCells = (tableField, columnCodes) => {
    if (!tableField || !Array.isArray(tableField.value)) {
      return;
    }
    const allow = columnCodes && columnCodes.size ? columnCodes : null;
    tableField.value.forEach((row) => {
      if (!row || !row.value) {
        return;
      }
      Object.keys(row.value).forEach((innerCode) => {
        if (allow && !allow.has(innerCode)) {
          return;
        }
        if (row.value[innerCode]) {
          row.value[innerCode].disabled = true;
        }
      });
    });
  };

  /**
   * 新規・編集・一覧編集で履歴保存先を編集不可にする（権限は落とさない）
   * 履歴テーブルは行の追加・削除と、プラグインが書き込む列のみ編集不可。他列は編集可。
   */
  CH.lockDestinationFieldsOnEdit = (record, settings, lockDestOnEdit) => {
    if (!lockDestOnEdit || !record) {
      return;
    }
    const targets = CH.collectDestinationTargets(settings);
    const historyTableSet = new Set(targets.historyTables);
    const lockColumnsByTable = CH.collectHistoryTableLockColumns(settings);

    targets.fieldCodes.forEach((code) => {
      if (!record[code] || historyTableSet.has(code)) {
        return;
      }
      record[code].disabled = true;
      if (record[code].type === 'SUBTABLE') {
        lockSubtableCells(record[code]);
      }
    });
    Object.keys(lockColumnsByTable).forEach((tableCode) => {
      const tableField = record[tableCode];
      if (!tableField || tableField.type !== 'SUBTABLE') {
        return;
      }
      lockSubtableCells(tableField, lockColumnsByTable[tableCode]);
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

  const HISTORY_TABLE_ROW_BUTTON_SELECTOR = [
    '.add-row-image-gaia',
    '.remove-row-image-gaia',
    '.add-row-image-action-gaia',
    '.subtable-operation-gaia',
    '.subtable-row-add-gaia',
    '.subtable-row-delete-gaia',
    '.subtable-row-buttons-gaia',
    '[class*="add-row"]',
    '[class*="remove-row"]',
    '[class*="addRow"]',
    '[class*="removeRow"]',
    '[class*="AddRow"]',
    '[class*="RemoveRow"]',
    '[class*="deleteRow"]',
    '[class*="DeleteRow"]',
    'button[title="行を追加"]',
    'button[title="行を削除"]',
    'button[title="Add row"]',
    'button[title="Delete row"]',
    'button[aria-label="行を追加"]',
    'button[aria-label="行を削除"]',
    'button[aria-label="Add row"]',
    'button[aria-label="Delete row"]',
    'img[alt="行を追加する"]',
    'img[alt="行を削除する"]'
  ].join(',');

  CH.captureHistoryTableRows = (record, settings) => {
    const snap = {};
    CH.collectDestinationTargets(settings).historyTables.forEach((code) => {
      snap[code] = CH.deepCopy(CH.getTableRows(record, code));
    });
    return snap;
  };

  const sameRowStructure = (original, current) => {
    if (original.length !== current.length) {
      return false;
    }
    for (let i = 0; i < original.length; i += 1) {
      const origId = original[i] ? original[i].id : null;
      const currId = current[i] ? current[i].id : null;
      if (origId !== currId) {
        return false;
      }
    }
    return true;
  };

  /**
   * 履歴テーブルの行追加・削除を元に戻す（他列の入力は残す）
   */
  CH.restoreHistoryTableStructure = (record, rowSnapshot) => {
    if (!record || !rowSnapshot) {
      return;
    }
    Object.keys(rowSnapshot).forEach((tableCode) => {
      const tableField = record[tableCode];
      if (!tableField || tableField.type !== 'SUBTABLE') {
        return;
      }
      const original = Array.isArray(rowSnapshot[tableCode]) ? rowSnapshot[tableCode] : [];
      const current = Array.isArray(tableField.value) ? tableField.value : [];
      if (sameRowStructure(original, current)) {
        return;
      }
      const currentById = {};
      current.forEach((row) => {
        if (row && row.id != null && row.id !== '') {
          currentById[String(row.id)] = row;
        }
      });
      tableField.value = original.map((origRow) => {
        if (origRow && origRow.id != null && origRow.id !== '') {
          const live = currentById[String(origRow.id)];
          if (live) {
            return live;
          }
        }
        return CH.deepCopy(origRow);
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
      '.ch-history-table-locked .subtable-operation-gaia,',
      '.ch-history-table-locked .subtable-row-add-gaia,',
      '.ch-history-table-locked .subtable-row-delete-gaia,',
      '.ch-history-table-locked .subtable-row-buttons-gaia,',
      '.ch-history-table-locked [class*="add-row"],',
      '.ch-history-table-locked [class*="remove-row"],',
      '.ch-history-table-locked [class*="addRow"],',
      '.ch-history-table-locked [class*="removeRow"],',
      '.ch-history-table-locked [class*="AddRow"],',
      '.ch-history-table-locked [class*="RemoveRow"],',
      '.ch-history-table-locked [class*="deleteRow"],',
      '.ch-history-table-locked [class*="DeleteRow"],',
      '.ch-history-table-locked button[title="行を追加"],',
      '.ch-history-table-locked button[title="行を削除"],',
      '.ch-history-table-locked button[title="Add row"],',
      '.ch-history-table-locked button[title="Delete row"],',
      '.ch-history-table-locked button[aria-label="行を追加"],',
      '.ch-history-table-locked button[aria-label="行を削除"],',
      '.ch-history-table-locked button[aria-label="Add row"],',
      '.ch-history-table-locked button[aria-label="Delete row"],',
      '.ch-history-table-locked img[alt="行を追加する"],',
      '.ch-history-table-locked img[alt="行を削除する"] {',
      '  display: none !important;',
      '  visibility: hidden !important;',
      '  pointer-events: none !important;',
      '}'
    ].join('\n');
    document.head.appendChild(style);
  };

  const hideRowButtonsIn = (root) => {
    if (!root || !root.querySelectorAll) {
      return;
    }
    root.querySelectorAll(HISTORY_TABLE_ROW_BUTTON_SELECTOR).forEach((btn) => {
      btn.style.setProperty('display', 'none', 'important');
      btn.style.setProperty('visibility', 'hidden', 'important');
      btn.style.setProperty('pointer-events', 'none', 'important');
      btn.setAttribute('aria-hidden', 'true');
      btn.tabIndex = -1;
    });
  };

  const markHistoryTableLockTarget = (el) => {
    if (!el || !el.classList) {
      return;
    }
    el.classList.add('ch-history-table-locked');
    hideRowButtonsIn(el);
    let node = el.parentElement;
    for (let i = 0; i < 4 && node; i += 1) {
      if (node.classList) {
        node.classList.add('ch-history-table-locked');
      }
      hideRowButtonsIn(node);
      if (node.querySelector && node.querySelector('.subtable-gaia, .subtable-operation-gaia, .subtable-row-buttons-gaia')) {
        break;
      }
      node = node.parentElement;
    }
  };

  const findHistoryTableRoots = (code, eventType) => {
    const roots = [];
    const seen = new Set();
    const add = (el) => {
      if (!el || seen.has(el)) {
        return;
      }
      seen.add(el);
      roots.push(el);
    };
    try {
      add(CH.isMobileEvent(eventType)
        ? kintone.mobile.app.record.getFieldElement(code)
        : kintone.app.record.getFieldElement(code));
    } catch (e) {
      // フィールド未表示など
    }
    try {
      const esc = window.CSS && CSS.escape ? CSS.escape(code) : code;
      document.querySelectorAll(`[data-group-code="${esc}"]`).forEach(add);
    } catch (e) {
      // selector 不正時は無視
    }
    return roots;
  };

  CH.armHistoryTableRowGuard = (settings, rowSnapshot, eventType) => {
    CH._historyTableGuard = {
      settings,
      rowSnapshot,
      eventType
    };
  };

  CH.enforceHistoryTableStructureFromUi = () => {
    const guard = CH._historyTableGuard;
    if (!guard || CH._restoringHistoryTable) {
      return;
    }
    const isMobile = CH.isMobileEvent(guard.eventType);
    const api = isMobile ? kintone.mobile.app.record : kintone.app.record;
    if (!api || typeof api.get !== 'function' || typeof api.set !== 'function') {
      return;
    }
    let recObj;
    try {
      recObj = api.get();
    } catch (e) {
      return;
    }
    if (!recObj || !recObj.record) {
      return;
    }
    const idsOf = (record) => CH.collectDestinationTargets(guard.settings).historyTables.map((code) => (
      CH.getTableRows(record, code).map((row) => (row && row.id != null ? String(row.id) : '')).join(',')
    )).join('|');
    const before = idsOf(recObj.record);
    CH.restoreHistoryTableStructure(recObj.record, guard.rowSnapshot);
    if (before === idsOf(recObj.record)) {
      return;
    }
    CH._restoringHistoryTable = true;
    try {
      api.set(recObj);
      CH.lockDestinationFieldsOnEdit(recObj.record, guard.settings, true);
    } finally {
      setTimeout(() => {
        CH._restoringHistoryTable = false;
      }, 50);
    }
  };

  CH.startHistoryTableButtonObserver = () => {
    if (CH._historyTableButtonObserver || !document.body) {
      return;
    }
    CH._historyTableButtonObserver = new MutationObserver(() => {
      document.querySelectorAll('.ch-history-table-locked').forEach((el) => {
        hideRowButtonsIn(el);
      });
      if (!CH._historyTableGuard) {
        return;
      }
      clearTimeout(CH._historyTableGuardTimer);
      CH._historyTableGuardTimer = setTimeout(() => {
        CH.enforceHistoryTableStructureFromUi();
      }, 50);
    });
    CH._historyTableButtonObserver.observe(document.body, {
      childList: true,
      subtree: true
    });
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
    CH.startHistoryTableButtonObserver();
    const hideOnce = () => {
      tables.forEach((code) => {
        try {
          const roots = findHistoryTableRoots(code, eventType);
          if (!roots.length) {
            return;
          }
          roots.forEach((el) => {
            markHistoryTableLockTarget(el);
          });
        } catch (e) {
          console.warn('変更履歴: 履歴テーブル操作ボタンの非表示に失敗しました', code, e);
        }
      });
    };
    hideOnce();
    setTimeout(hideOnce, 0);
    setTimeout(hideOnce, 200);
    setTimeout(hideOnce, 800);
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
