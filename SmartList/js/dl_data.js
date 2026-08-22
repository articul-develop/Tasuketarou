/**
 * スマート一覧プラグイン データ取得・展開
 * フォーム定義／一覧定義の取得、母集団クエリの組み立て、親レコードの取得、
 * サブテーブルの展開（virtualRows生成）を担当する。
 */
window.SubtableList = window.SubtableList || {};
((DL) => {
  'use strict';

  const GET_RECORDS_LIMIT = 500;

  // 型ごとの既定列幅（px）
  const DEFAULT_WIDTHS = {
    RECORD_NUMBER: 110,
    SINGLE_LINE_TEXT: 160,
    MULTI_LINE_TEXT: 220,
    RICH_TEXT: 220,
    LINK: 180,
    NUMBER: 100,
    CALC: 110,
    DATE: 110,
    DATETIME: 150,
    TIME: 90,
    DROP_DOWN: 120,
    RADIO_BUTTON: 120,
    CHECK_BOX: 140,
    MULTI_SELECT: 140,
    STATUS: 110,
    CATEGORY: 140,
    USER_SELECT: 140,
    ORGANIZATION_SELECT: 140,
    GROUP_SELECT: 140,
    CREATOR: 120,
    MODIFIER: 120,
    CREATED_TIME: 150,
    UPDATED_TIME: 150,
    FILE: 160
  };

  DL.getDefaultWidth = (type) => DEFAULT_WIDTHS[type] || 140;

  /* ------------------------------------------------------------------ *
   * フォーム定義・一覧定義の取得
   * ------------------------------------------------------------------ */

  DL.fetchFormFields = (appId, usePreview) => {
    const path = usePreview ? '/k/v1/preview/app/form/fields.json' : '/k/v1/app/form/fields.json';
    return kintone.api(kintone.api.url(path, true), 'GET', { app: appId })
      .then((response) => (response && response.properties) || {});
  };

  DL.fetchFormLayout = (appId) => kintone.api(kintone.api.url('/k/v1/preview/app/form/layout.json', true), 'GET', { app: appId })
    .then((response) => (response && response.layout) || []);

  DL.fetchViews = (appId, usePreview) => {
    const path = usePreview ? '/k/v1/preview/app/views.json' : '/k/v1/app/views.json';
    return kintone.api(kintone.api.url(path, true), 'GET', { app: appId })
      .then((response) => {
        const views = (response && response.views) || {};
        return Object.keys(views).map((name) => {
          const view = views[name] || {};
          return {
            id: String(view.id || ''),
            name: view.name || name,
            type: view.type || 'LIST',
            filterCond: view.filterCond || '',
            index: Number(view.index || 0)
          };
        }).sort((a, b) => a.index - b.index);
      });
  };

  /**
   * 現在の一覧設定を保持したまま、未反映のアプリ設定へカスタマイズビューを追加する。
   * 一覧更新APIは送信しなかった既存ビューを削除するため、取得した全ビューを再送する。
   */
  DL.createCustomView = async (appId, viewName, html) => {
    const path = '/k/v1/preview/app/views.json';
    const url = kintone.api.url(path, true);
    const response = await kintone.api(url, 'GET', { app: appId });
    const currentViews = (response && response.views) || {};

    if (Object.prototype.hasOwnProperty.call(currentViews, viewName)) {
      throw new Error(`「${viewName}」という名前の一覧はすでに存在します。別の名前を入力してください。`);
    }

    const views = {};
    let maxIndex = -1;
    Object.keys(currentViews).forEach((name) => {
      const view = currentViews[name] || {};
      const normalized = {
        type: view.type,
        index: Number(view.index) || 0,
        filterCond: view.filterCond || '',
        sort: view.sort || ''
      };
      maxIndex = Math.max(maxIndex, normalized.index);

      // 追加・更新どちらでも name が必要なため、既存ビューにも必ず付与する
      normalized.name = view.name || name;
      if (view.type === 'LIST') {
        normalized.fields = Array.isArray(view.fields) ? view.fields : [];
      } else if (view.type === 'CALENDAR') {
        normalized.date = view.date || '';
        normalized.title = view.title || '';
      } else if (view.type === 'CUSTOM') {
        normalized.html = view.html || '';
        normalized.pager = view.pager !== false;
      }
      views[name] = normalized;
    });

    views[viewName] = {
      type: 'CUSTOM',
      name: viewName,
      index: maxIndex + 1,
      html,
      filterCond: '',
      sort: '',
      pager: false
    };

    return kintone.api(url, 'PUT', {
      app: appId,
      views,
      revision: response.revision
    });
  };

  /* ------------------------------------------------------------------ *
   * 列の組み立て
   * ------------------------------------------------------------------ */

  const buildOptions = (property) => {
    if (!property || !property.options) {
      return [];
    }
    return Object.keys(property.options)
      .map((name) => ({ name, index: Number(property.options[name].index || 0) }))
      .sort((a, b) => a.index - b.index)
      .map((item) => item.name);
  };

  const createColumn = (scope, property, code) => ({
    key: DL.makeColumnKey(scope, code),
    scope,
    code,
    label: (property && property.label) || code,
    type: property.type,
    options: buildOptions(property),
    defaultWidth: DL.getDefaultWidth(property.type)
  });

  /**
   * フォーム定義から対応する全フィールドを列候補にする。
   * 管理者設定の columnOrder / initialVisibleKeys で初期並び・初期表示を決める。
   * （表示可能項目の制限は設けず、利用者が一覧画面で表示列を切り替えられる）
   */
  DL.buildColumns = (properties, setting) => {
    const warnings = [];
    const columns = [];
    const parentMode = DL.isParentListMode(setting);
    const preferredParent = Array.isArray(setting.parentFieldCodes) ? setting.parentFieldCodes : [];
    const preferredTable = Array.isArray(setting.tableFieldCodes) ? setting.tableFieldCodes : [];
    const seenParent = new Set();
    const seenTable = new Set();

    const pushParent = (code, excludeTableCode) => {
      if (!code || seenParent.has(code) || (excludeTableCode && code === excludeTableCode)) {
        return;
      }
      const property = properties[code];
      if (!property || property.type === 'SUBTABLE' || !DL.isSupportedType(property.type)) {
        return;
      }
      seenParent.add(code);
      columns.push(createColumn(DL.SCOPE.PARENT, property, code));
    };

    if (parentMode) {
      preferredParent.forEach((code) => pushParent(code, ''));
      Object.keys(properties).forEach((code) => pushParent(code, ''));
      if (seenParent.size === 0) {
        warnings.push('一覧へ表示できる親レコードの項目がありません。プラグイン設定を確認してください。');
      }
      const orderedParent = DL.applyColumnOrder(columns, setting.columnOrder);
      const parentMap = {};
      orderedParent.forEach((column) => {
        parentMap[column.key] = column;
      });
      return {
        columns: orderedParent,
        columnMap: parentMap,
        tableLabel: '',
        warnings
      };
    }

    const tableProperty = properties[setting.tableCode];
    if (!setting.tableCode) {
      warnings.push('対象のサブテーブルが設定されていません。プラグイン設定を確認してください。');
      return { columns: [], columnMap: {}, tableLabel: '', warnings };
    }
    if (!tableProperty || tableProperty.type !== 'SUBTABLE') {
      warnings.push(`サブテーブル「${setting.tableCode}」が見つかりません。プラグイン設定を確認してください。`);
      return { columns: [], columnMap: {}, tableLabel: '', warnings };
    }

    const tableCode = setting.tableCode;
    const tableFields = tableProperty.fields || {};
    const pushTable = (code) => {
      if (!code || seenTable.has(code)) {
        return;
      }
      const property = tableFields[code];
      if (!property || !DL.isSupportedType(property.type)) {
        return;
      }
      seenTable.add(code);
      columns.push(createColumn(DL.SCOPE.TABLE, property, code));
    };

    // 設定に残っている順序を優先し、フォーム上の未登録フィールドを末尾に足す
    preferredParent.forEach((code) => pushParent(code, tableCode));
    Object.keys(properties).forEach((code) => pushParent(code, tableCode));
    preferredTable.forEach(pushTable);
    Object.keys(tableFields).forEach(pushTable);

    if (seenTable.size === 0) {
      warnings.push(`サブテーブル「${tableCode}」に表示可能な項目がありません。`);
    }

    const ordered = DL.applyColumnOrder(columns, setting.columnOrder);
    const columnMap = {};
    ordered.forEach((column) => {
      columnMap[column.key] = column;
    });

    return {
      columns: ordered,
      columnMap,
      tableLabel: tableProperty.label || setting.tableCode,
      warnings
    };
  };

  /**
   * 指定された順序に列を並べ替える。順序に含まれない列は元の順序を保って末尾へ。
   */
  DL.applyColumnOrder = (columns, order) => {
    if (!Array.isArray(order) || order.length === 0) {
      return columns.slice();
    }
    const indexByKey = new Map();
    order.forEach((key, index) => {
      if (!indexByKey.has(key)) {
        indexByKey.set(key, index);
      }
    });
    return columns
      .map((column, originalIndex) => ({ column, originalIndex }))
      .sort((a, b) => {
        const aIndex = indexByKey.has(a.column.key) ? indexByKey.get(a.column.key) : Number.MAX_SAFE_INTEGER;
        const bIndex = indexByKey.has(b.column.key) ? indexByKey.get(b.column.key) : Number.MAX_SAFE_INTEGER;
        if (aIndex !== bIndex) {
          return aIndex - bIndex;
        }
        return a.originalIndex - b.originalIndex;
      })
      .map((item) => item.column);
  };

  /* ------------------------------------------------------------------ *
   * 母集団クエリ
   * ------------------------------------------------------------------ */

  DL.escapeQueryValue = (value) => String(value === null || value === undefined ? '' : value)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"');

  DL.combineConditions = (conditions) => conditions
    .map((condition) => String(condition || '').replace(/\s+order\s+by\s+.*$/i, '').replace(/\s+limit\s+\d+.*$/i, '').trim())
    .filter(Boolean)
    .map((condition) => `(${condition})`)
    .join(' and ');

  /**
   * 絞り込み条件のうち、kintoneのクエリへ安全に変換できるものだけを条件式にする。
   * 明細項目の条件は「その条件を満たす行を持つ親レコード」までの粗い絞り込みになるため、
   * 必ずクライアント側で明細単位に再評価する（dl_filter）。
   */
  DL.buildPushDownCondition = (conditions, columnMap) => {
    const parts = [];

    (conditions || []).forEach((condition) => {
      const column = columnMap[condition.key];
      if (!column) {
        return;
      }
      const group = DL.getTypeGroup(column.type);
      // 計算フィールドは書式によりクエリの型が変わるため対象外
      if (column.type === 'CALC' || group === 'FILE') {
        return;
      }
      const code = `${column.code}`;
      const value = condition.value;

      switch (condition.op) {
        case 'eq':
          if (group === 'TEXT' && typeof value === 'string' && value !== '') {
            parts.push(`${code} = "${DL.escapeQueryValue(value)}"`);
          } else if (group === 'NUMBER' && value !== '' && value !== null && Number.isFinite(Number(value))) {
            parts.push(`${code} = "${Number(value)}"`);
          }
          break;
        case 'gte':
          if (group === 'NUMBER' && Number.isFinite(Number(value))) {
            parts.push(`${code} >= "${Number(value)}"`);
          }
          break;
        case 'lte':
          if (group === 'NUMBER' && Number.isFinite(Number(value))) {
            parts.push(`${code} <= "${Number(value)}"`);
          }
          break;
        case 'between':
          if (group === 'NUMBER' && value) {
            if (Number.isFinite(Number(value.from)) && value.from !== '' && value.from !== null) {
              parts.push(`${code} >= "${Number(value.from)}"`);
            }
            if (Number.isFinite(Number(value.to)) && value.to !== '' && value.to !== null) {
              parts.push(`${code} <= "${Number(value.to)}"`);
            }
          }
          break;
        case 'in':
          if ((group === 'CHOICE' || group === 'ENTITY') && Array.isArray(value) && value.length > 0) {
            // ステータスや作成者などの組み込み型もそのまま in で扱える
            const list = value.map((item) => `"${DL.escapeQueryValue(item)}"`).join(', ');
            parts.push(`${code} in (${list})`);
          }
          break;
        case 'today':
        case 'yesterday':
        case 'beforeToday':
        case 'afterToday':
        case 'onOrBeforeToday':
        case 'onOrAfterToday':
        case 'thisWeek':
        case 'thisMonth':
        case 'lastMonth':
        case 'dateBetween': {
          if (group !== 'DATE' && group !== 'DATETIME') {
            break;
          }
          const range = DL.resolveDateRange(condition.op, value);
          if (range.from) {
            parts.push(`${code} >= "${DL.escapeQueryValue(range.from)}"`);
          }
          if (range.to) {
            // DATETIMEは終了日の当日を含めるため翌日未満で表現する
            if (group === 'DATETIME') {
              const next = new Date(`${range.to}T00:00:00`);
              next.setDate(next.getDate() + 1);
              parts.push(`${code} < "${DL.toLocalDateString(next)}"`);
            } else {
              parts.push(`${code} <= "${DL.escapeQueryValue(range.to)}"`);
            }
          }
          break;
        }
        default:
          break;
      }
    });

    return parts.join(' and ');
  };

  /* ------------------------------------------------------------------ *
   * 親レコードの取得
   * ------------------------------------------------------------------ */

  const buildSeekQuery = (condition, lastId) => {
    const seek = `$id > "${DL.escapeQueryValue(lastId)}"`;
    const merged = condition ? `${condition} and ${seek}` : seek;
    return `${merged} order by $id asc limit ${GET_RECORDS_LIMIT}`;
  };

  /**
   * $id のシーク方式で全件取得する。offsetの上限(10000)に影響されず、
   * 並び順はクライアント側で決めるため取得順は $id 昇順で構わない。
   */
  const fetchBySeek = async (appId, condition, fields, maxRecords, onProgress) => {
    const records = [];
    let lastId = '0';
    let truncated = false;

    for (;;) {
      const response = await kintone.api(kintone.api.url('/k/v1/records.json', true), 'GET', {
        app: appId,
        query: buildSeekQuery(condition, lastId),
        fields,
        totalCount: records.length === 0
      });
      const fetched = (response && response.records) || [];
      if (fetched.length === 0) {
        break;
      }

      for (let i = 0; i < fetched.length; i += 1) {
        if (records.length >= maxRecords) {
          truncated = true;
          break;
        }
        records.push(fetched[i]);
      }

      lastId = (fetched[fetched.length - 1].$id || {}).value || lastId;
      if (typeof onProgress === 'function') {
        onProgress(records.length, response && response.totalCount ? Number(response.totalCount) : null);
      }

      if (truncated || fetched.length < GET_RECORDS_LIMIT) {
        break;
      }
    }

    return { records, truncated };
  };

  /**
   * 親レコードを取得する。粗絞り条件付きのクエリが失敗した場合は、
   * 母集団クエリのみで再取得して画面が空にならないようにする。
   */
  DL.fetchParentRecords = async (options) => {
    const { appId, baseCondition, pushDownCondition, fields, maxRecords, onProgress } = options;
    const fullCondition = DL.combineConditions([baseCondition, pushDownCondition]);

    try {
      return await fetchBySeek(appId, fullCondition, fields, maxRecords, onProgress);
    } catch (error) {
      if (!pushDownCondition) {
        throw error;
      }
      console.warn('スマート一覧: 絞り込み条件のクエリ変換に失敗したため、母集団のみで取得します', error);
      return fetchBySeek(appId, DL.combineConditions([baseCondition]), fields, maxRecords, onProgress);
    }
  };

  /**
   * 取得に必要なフィールドコードを算出する。
   * サブテーブルはコードを指定すると行内の全フィールドが返る。
   */
  DL.buildFetchFieldCodes = (columns, tableCode) => {
    const codes = new Set(['$id']);
    columns.forEach((column) => {
      if (column.scope === DL.SCOPE.PARENT) {
        codes.add(column.code);
      }
    });
    if (tableCode) {
      codes.add(tableCode);
    }
    return Array.from(codes);
  };

  /* ------------------------------------------------------------------ *
   * サブテーブルの展開
   * ------------------------------------------------------------------ */

  /**
   * 親レコード、または 親レコード × サブテーブル行 を展開して virtualRows を作る。
   * 親レコードは1つの実体を参照させ、明細ごとに複製しない（大量データでのメモリ対策）。
   * tableCode が空のときは親レコード1件＝一覧1行。
   */
  DL.buildVirtualRows = (records, tableCode, maxRows) => {
    const rows = [];
    let truncated = false;
    let emptyTableCount = 0;

    if (!tableCode) {
      for (let index = 0; index < records.length; index += 1) {
        if (rows.length >= maxRows) {
          truncated = true;
          break;
        }
        const record = records[index];
        const recordId = (record.$id && record.$id.value) || '';
        rows.push({
          id: String(recordId || `p${index}`),
          recordId,
          rowId: null,
          rowIndex: 0,
          parentSeq: index,
          parent: record,
          row: {}
        });
      }
      return { rows, truncated, emptyTableCount };
    }

    for (let index = 0; index < records.length; index += 1) {
      const record = records[index];
      const recordId = (record.$id && record.$id.value) || '';
      const table = record[tableCode];
      const tableRows = table && Array.isArray(table.value) ? table.value : [];

      if (tableRows.length === 0) {
        emptyTableCount += 1;
        continue;
      }

      for (let rowIndex = 0; rowIndex < tableRows.length; rowIndex += 1) {
        if (rows.length >= maxRows) {
          truncated = true;
          break;
        }
        const tableRow = tableRows[rowIndex] || {};
        const rowId = tableRow.id ? String(tableRow.id) : '';
        rows.push({
          id: `${recordId}:${rowId || `i${rowIndex}`}`,
          recordId,
          rowId: rowId || null,
          rowIndex,
          parentSeq: index,
          parent: record,
          row: tableRow.value || {}
        });
      }

      if (truncated) {
        break;
      }
    }

    return { rows, truncated, emptyTableCount };
  };
})(window.SubtableList);
