/**
 * スマート一覧プラグイン 絞り込み
 * filter state（クイック検索＋条件配列）の定義と、明細1行単位での条件評価を担当する。
 * 詳細絞り込みパネルと列ヘッダーの簡易フィルタは、どちらもこの同じ conditions を操作する。
 */
window.SubtableList = window.SubtableList || {};
((DL) => {
  'use strict';

  /* ------------------------------------------------------------------ *
   * 型ごとの演算子
   * valueType: none / text / number / numberRange / dateRange / datePreset / time / timeRange / tokens
   * ------------------------------------------------------------------ */

  const OPERATORS = {
    TEXT: [
      { op: 'contains', label: '含む', valueType: 'text' },
      { op: 'eq', label: '一致', valueType: 'text' },
      { op: 'notContains', label: '含まない', valueType: 'text' },
      { op: 'in', label: '値を選択', valueType: 'tokens' },
      { op: 'empty', label: '空欄', valueType: 'none' },
      { op: 'notEmpty', label: '空欄ではない', valueType: 'none' }
    ],
    NUMBER: [
      { op: 'eq', label: '=', valueType: 'number' },
      { op: 'gte', label: '以上', valueType: 'number' },
      { op: 'lte', label: '以下', valueType: 'number' },
      { op: 'between', label: '範囲', valueType: 'numberRange' },
      // 列ヘッダーの簡易フィルタ（値を一覧から選ぶ）で使う
      { op: 'in', label: '値を選択', valueType: 'tokens' },
      { op: 'empty', label: '空欄', valueType: 'none' },
      { op: 'notEmpty', label: '空欄ではない', valueType: 'none' }
    ],
    // 日付は用途で演算子を分ける
    // - filterOnly: 絞り込み（「今日」「今日より前」など値不要の固定条件）
    // - colorOnly: 条件色（比較「より前/以前…」＋値「今日/先週…」の2段）
    // - どちらも無し: 共通（日付範囲・空欄）
    DATE: [
      { op: 'today', label: '今日', valueType: 'none', filterOnly: true },
      { op: 'yesterday', label: '昨日', valueType: 'none', filterOnly: true },
      { op: 'beforeToday', label: '今日より前', valueType: 'none', filterOnly: true },
      { op: 'afterToday', label: '今日より後', valueType: 'none', filterOnly: true },
      { op: 'onOrBeforeToday', label: '今日以前', valueType: 'none', filterOnly: true },
      { op: 'onOrAfterToday', label: '今日以降', valueType: 'none', filterOnly: true },
      { op: 'thisWeek', label: '今週', valueType: 'none', filterOnly: true },
      { op: 'thisMonth', label: '今月', valueType: 'none', filterOnly: true },
      { op: 'lastMonth', label: '先月', valueType: 'none', filterOnly: true },
      { op: 'dateBefore', label: 'より前', valueType: 'datePreset', colorOnly: true },
      { op: 'dateOnOrBefore', label: '以前', valueType: 'datePreset', colorOnly: true },
      { op: 'dateEqual', label: '一致', valueType: 'datePreset', colorOnly: true },
      { op: 'dateOnOrAfter', label: '以降', valueType: 'datePreset', colorOnly: true },
      { op: 'dateAfter', label: 'より後', valueType: 'datePreset', colorOnly: true },
      { op: 'dateBetween', label: '日付範囲', valueType: 'dateRange' },
      { op: 'in', label: '値を選択', valueType: 'tokens', filterOnly: true },
      { op: 'empty', label: '空欄', valueType: 'none' },
      { op: 'notEmpty', label: '空欄ではない', valueType: 'none' }
    ],
    TIME: [
      { op: 'eq', label: '一致', valueType: 'time' },
      { op: 'between', label: '範囲', valueType: 'timeRange' },
      { op: 'in', label: '値を選択', valueType: 'tokens' },
      { op: 'empty', label: '空欄', valueType: 'none' },
      { op: 'notEmpty', label: '空欄ではない', valueType: 'none' }
    ],
    CHOICE: [
      { op: 'in', label: 'いずれかを含む', valueType: 'tokens' },
      { op: 'notIn', label: 'いずれも含まない', valueType: 'tokens' },
      { op: 'empty', label: '空欄', valueType: 'none' },
      { op: 'notEmpty', label: '空欄ではない', valueType: 'none' }
    ],
    ENTITY: [
      { op: 'in', label: 'いずれかを含む', valueType: 'tokens' },
      { op: 'notIn', label: 'いずれも含まない', valueType: 'tokens' },
      { op: 'empty', label: '空欄', valueType: 'none' },
      { op: 'notEmpty', label: '空欄ではない', valueType: 'none' }
    ],
    FILE: []
  };

  // DATETIMEはDATEと同じ演算子を使う（内部の比較方法のみ異なる）
  OPERATORS.DATETIME = OPERATORS.DATE;

  DL.getOperators = (type) => OPERATORS[DL.getTypeGroup(type)] || [];

  DL.getFilterOperators = (type) => DL.getOperators(type).filter((item) => !item.colorOnly);

  DL.getColorOperators = (type) => DL.getOperators(type).filter((item) => !item.filterOnly);

  DL.DATE_PRESET_OPTIONS = [
    { value: 'today', label: '今日' },
    { value: 'yesterday', label: '昨日' },
    { value: 'tomorrow', label: '明日' },
    { value: 'thisWeek', label: '今週' },
    { value: 'lastWeek', label: '先週' },
    { value: 'nextWeek', label: '来週' },
    { value: 'thisMonth', label: '今月' },
    { value: 'lastMonth', label: '先月' },
    { value: 'nextMonth', label: '来月' }
  ];

  DL.isFilterableType = (type) => DL.getOperators(type).length > 0;

  DL.getOperatorDefinition = (type, op) => DL.getOperators(type).find((item) => item.op === op) || null;

  DL.getDefaultOperator = (type) => {
    const operators = DL.getFilterOperators(type);
    return operators.length > 0 ? operators[0].op : '';
  };

  DL.getDefaultColorOperator = (type) => {
    const operators = DL.getColorOperators(type);
    return operators.length > 0 ? operators[0].op : '';
  };

  DL.createEmptyFilters = () => ({ quick: '', conditions: [] });

  let conditionSequence = 0;
  DL.createCondition = (columnKey, type) => {
    conditionSequence += 1;
    const op = DL.getDefaultOperator(type);
    return {
      id: `c${Date.now()}_${conditionSequence}`,
      key: columnKey,
      op,
      value: DL.createEmptyValue(type, op)
    };
  };

  DL.createEmptyValue = (type, op) => {
    const definition = DL.getOperatorDefinition(type, op);
    if (!definition) {
      return null;
    }
    switch (definition.valueType) {
      case 'text':
      case 'number':
      case 'time':
        return '';
      case 'datePreset':
        return 'today';
      case 'numberRange':
      case 'dateRange':
      case 'timeRange':
        return { from: '', to: '' };
      case 'tokens':
        return [];
      default:
        return null;
    }
  };

  /**
   * 条件に有効な値が入っているか。値が未入力の条件は評価から除外する。
   */
  DL.isConditionActive = (condition, column) => {
    if (!condition || !column) {
      return false;
    }
    const definition = DL.getOperatorDefinition(column.type, condition.op);
    if (!definition) {
      return false;
    }
    switch (definition.valueType) {
      case 'none':
        return true;
      case 'tokens':
        return Array.isArray(condition.value) && condition.value.length > 0;
      case 'datePreset':
        return DL.DATE_PRESET_OPTIONS.some((item) => item.value === condition.value);
      case 'numberRange':
      case 'dateRange':
      case 'timeRange':
        return Boolean(condition.value && (condition.value.from !== '' || condition.value.to !== ''));
      default:
        return condition.value !== '' && condition.value !== null && condition.value !== undefined;
    }
  };

  /* ------------------------------------------------------------------ *
   * 条件のコンパイル（評価用クロージャ化）
   * ------------------------------------------------------------------ */

  const compileCondition = (condition, column) => {
    const type = column.type;
    const group = DL.getTypeGroup(type);
    const getField = (virtualRow) => DL.getCellField(virtualRow, column);

    switch (condition.op) {
      case 'empty':
        return (virtualRow) => DL.isEmptyValue(getField(virtualRow));
      case 'notEmpty':
        return (virtualRow) => !DL.isEmptyValue(getField(virtualRow));

      case 'contains': {
        const needle = String(condition.value).toLowerCase();
        return (virtualRow) => DL.getSearchText(getField(virtualRow), type).indexOf(needle) >= 0;
      }
      case 'notContains': {
        const needle = String(condition.value).toLowerCase();
        return (virtualRow) => DL.getSearchText(getField(virtualRow), type).indexOf(needle) < 0;
      }

      case 'eq':
        if (group === 'NUMBER') {
          const target = Number(condition.value);
          return (virtualRow) => {
            const field = getField(virtualRow);
            if (DL.isEmptyValue(field)) {
              return false;
            }
            return Number(field.value) === target;
          };
        }
        if (group === 'TIME') {
          const target = String(condition.value);
          return (virtualRow) => {
            const field = getField(virtualRow);
            return Boolean(field) && String(field.value || '') === target;
          };
        }
        {
          const target = String(condition.value).toLowerCase();
          return (virtualRow) => DL.getSearchText(getField(virtualRow), type) === target;
        }

      case 'gte': {
        const target = Number(condition.value);
        return (virtualRow) => {
          const field = getField(virtualRow);
          if (DL.isEmptyValue(field)) {
            return false;
          }
          const numeric = Number(field.value);
          return Number.isFinite(numeric) && numeric >= target;
        };
      }
      case 'lte': {
        const target = Number(condition.value);
        return (virtualRow) => {
          const field = getField(virtualRow);
          if (DL.isEmptyValue(field)) {
            return false;
          }
          const numeric = Number(field.value);
          return Number.isFinite(numeric) && numeric <= target;
        };
      }

      case 'between': {
        if (group === 'TIME') {
          const from = condition.value && condition.value.from ? String(condition.value.from) : null;
          const to = condition.value && condition.value.to ? String(condition.value.to) : null;
          return (virtualRow) => {
            const field = getField(virtualRow);
            if (DL.isEmptyValue(field)) {
              return false;
            }
            const text = String(field.value);
            if (from !== null && text < from) {
              return false;
            }
            return !(to !== null && text > to);
          };
        }
        const from = condition.value && condition.value.from !== '' ? Number(condition.value.from) : null;
        const to = condition.value && condition.value.to !== '' ? Number(condition.value.to) : null;
        return (virtualRow) => {
          const field = getField(virtualRow);
          if (DL.isEmptyValue(field)) {
            return false;
          }
          const numeric = Number(field.value);
          if (!Number.isFinite(numeric)) {
            return false;
          }
          if (from !== null && numeric < from) {
            return false;
          }
          return !(to !== null && numeric > to);
        };
      }

      case 'in':
      case 'notIn': {
        const isNegative = condition.op === 'notIn';
        if (group === 'CHOICE' || group === 'ENTITY') {
          const tokens = new Set(condition.value || []);
          return (virtualRow) => {
            const found = DL.getFilterTokens(getField(virtualRow), type).some((token) => tokens.has(token));
            return isNegative ? !found : found;
          };
        }
        // 文字列・数値・日付の列ヘッダーフィルタは表示文字列で一致判定する
        const tokens = new Set((condition.value || []).map((token) => String(token)));
        return (virtualRow) => {
          const found = tokens.has(DL.formatCellText(getField(virtualRow), type));
          return isNegative ? !found : found;
        };
      }

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
        const range = DL.resolveDateRange(condition.op, condition.value);
        if (group === 'DATETIME') {
          const timestamps = DL.dateRangeToTimestamps(range);
          return (virtualRow) => {
            const field = getField(virtualRow);
            if (DL.isEmptyValue(field)) {
              return false;
            }
            const time = new Date(field.value).getTime();
            if (Number.isNaN(time)) {
              return false;
            }
            if (timestamps.from !== null && time < timestamps.from) {
              return false;
            }
            return !(timestamps.to !== null && time > timestamps.to);
          };
        }
        // DATEはISO文字列のまま辞書順で比較できる
        return (virtualRow) => {
          const field = getField(virtualRow);
          if (DL.isEmptyValue(field)) {
            return false;
          }
          const text = String(field.value);
          if (range.from && text < range.from) {
            return false;
          }
          return !(range.to && text > range.to);
        };
      }

      case 'dateBefore':
      case 'dateOnOrBefore':
      case 'dateEqual':
      case 'dateOnOrAfter':
      case 'dateAfter': {
        const range = DL.resolveDatePresetRange(condition.value);
        if (group === 'DATETIME') {
          const timestamps = DL.dateRangeToTimestamps(range);
          return (virtualRow) => {
            const field = getField(virtualRow);
            if (DL.isEmptyValue(field)) {
              return false;
            }
            const time = new Date(field.value).getTime();
            if (Number.isNaN(time)) {
              return false;
            }
            switch (condition.op) {
              case 'dateBefore': return timestamps.from !== null && time < timestamps.from;
              case 'dateOnOrBefore': return timestamps.to !== null && time <= timestamps.to;
              case 'dateOnOrAfter': return timestamps.from !== null && time >= timestamps.from;
              case 'dateAfter': return timestamps.to !== null && time > timestamps.to;
              default:
                return timestamps.from !== null && timestamps.to !== null
                  && time >= timestamps.from && time <= timestamps.to;
            }
          };
        }
        return (virtualRow) => {
          const field = getField(virtualRow);
          if (DL.isEmptyValue(field)) {
            return false;
          }
          const text = String(field.value);
          switch (condition.op) {
            case 'dateBefore': return Boolean(range.from) && text < range.from;
            case 'dateOnOrBefore': return Boolean(range.to) && text <= range.to;
            case 'dateOnOrAfter': return Boolean(range.from) && text >= range.from;
            case 'dateAfter': return Boolean(range.to) && text > range.to;
            default: return Boolean(range.from && range.to) && text >= range.from && text <= range.to;
          }
        };
      }

      default:
        return null;
    }
  };

  /**
   * 1条件が virtualRow にマッチするか。色付けと絞り込みの両方から使う。
   */
  DL.matchesCondition = (condition, column, virtualRow) => {
    if (!condition || !column || !virtualRow || !DL.isConditionActive(condition, column)) {
      return false;
    }
    const evaluator = compileCondition(condition, column);
    return Boolean(evaluator && evaluator(virtualRow));
  };

  /**
   * セルに適用する色IDを決める。条件色が固定色より優先。条件は上から最初の一致。
   */
  DL.resolveCellColorId = (columnKey, virtualRow, columnMap, columnColors, cellColorRules) => {
    const column = columnMap && columnMap[columnKey];
    if (!column || column.builtin) {
      return '';
    }
    const rules = Array.isArray(cellColorRules) ? cellColorRules : [];
    for (let i = 0; i < rules.length; i += 1) {
      const rule = rules[i];
      if (!rule || rule.key !== columnKey || !DL.isColorPresetId(rule.colorId)) {
        continue;
      }
      if (DL.matchesCondition(rule, column, virtualRow)) {
        return rule.colorId;
      }
    }
    const fixed = (Array.isArray(columnColors) ? columnColors : [])
      .find((item) => item && item.key === columnKey && DL.isColorPresetId(item.colorId));
    return fixed ? fixed.colorId : '';
  };

  /* ------------------------------------------------------------------ *
   * 述語の生成
   * ------------------------------------------------------------------ */

  /**
   * filter state から (virtualRow) => boolean を生成する。
   * すべての条件は「同じサブテーブル行」に対して評価されるため、
   * 親レコード単位ではなく明細単位のAND判定になる。
   */
  DL.buildPredicate = (filters, columnMap, quickSearchColumns) => {
    const evaluators = [];

    (filters.conditions || []).forEach((condition) => {
      const column = columnMap[condition.key];
      if (!column || !DL.isConditionActive(condition, column)) {
        return;
      }
      const evaluator = compileCondition(condition, column);
      if (evaluator) {
        evaluators.push(evaluator);
      }
    });

    const quick = String(filters.quick || '').trim().toLowerCase();
    if (quick && Array.isArray(quickSearchColumns) && quickSearchColumns.length > 0) {
      const targets = quickSearchColumns.slice();
      evaluators.push((virtualRow) => {
        for (let i = 0; i < targets.length; i += 1) {
          const column = targets[i];
          if (DL.getSearchText(DL.getCellField(virtualRow, column), column.type).indexOf(quick) >= 0) {
            return true;
          }
        }
        return false;
      });
    }

    if (evaluators.length === 0) {
      return null;
    }

    return (virtualRow) => {
      for (let i = 0; i < evaluators.length; i += 1) {
        if (!evaluators[i](virtualRow)) {
          return false;
        }
      }
      return true;
    };
  };

  DL.applyFilter = (virtualRows, predicate) => {
    if (!predicate) {
      return virtualRows.slice();
    }
    const result = [];
    for (let i = 0; i < virtualRows.length; i += 1) {
      if (predicate(virtualRows[i])) {
        result.push(virtualRows[i]);
      }
    }
    return result;
  };

  /* ------------------------------------------------------------------ *
   * チップ表示用のラベル
   * ------------------------------------------------------------------ */

  DL.describeCondition = (condition, column) => {
    if (!column) {
      return '';
    }
    const definition = DL.getOperatorDefinition(column.type, condition.op);
    if (!definition) {
      return column.label;
    }
    const value = condition.value;

    switch (definition.valueType) {
      case 'none':
        return `${column.label}：${definition.label}`;
      case 'tokens':
        return `${column.label}：${(value || []).join(', ')}${condition.op === 'notIn' ? ' 以外' : ''}`;
      case 'datePreset': {
        const preset = DL.DATE_PRESET_OPTIONS.find((item) => item.value === value);
        return `${column.label}：${preset ? preset.label : value} ${definition.label}`;
      }
      case 'numberRange':
      case 'dateRange':
      case 'timeRange': {
        const from = (value && value.from) || '';
        const to = (value && value.to) || '';
        if (from && to) {
          return `${column.label}：${from} 〜 ${to}`;
        }
        return from ? `${column.label}：${from} 以上` : `${column.label}：${to} 以下`;
      }
      default:
        if (condition.op === 'contains') {
          return `${column.label}：${value}`;
        }
        return `${column.label}：${definition.label} ${value}`;
    }
  };

  /* ------------------------------------------------------------------ *
   * 列ヘッダーフィルタ用の選択肢抽出
   * ------------------------------------------------------------------ */

  /**
   * 実データに現れる値を件数付きで集計する。
   * 選択肢フィールドはフォーム定義の選択肢も候補に含める（データに無い選択肢も選べるように）。
   */
  DL.collectTokenOptions = (virtualRows, column, limit) => {
    const counts = new Map();
    const group = DL.getTypeGroup(column.type);
    const maxItems = limit || 500;

    if (group === 'CHOICE' && Array.isArray(column.options)) {
      column.options.forEach((name) => counts.set(name, { token: name, label: name, count: 0 }));
    }

    let hasEmpty = false;
    for (let i = 0; i < virtualRows.length; i += 1) {
      const field = DL.getCellField(virtualRows[i], column);
      if (DL.isEmptyValue(field)) {
        hasEmpty = true;
        continue;
      }
      const items = group === 'CHOICE' || group === 'ENTITY'
        ? DL.getFilterTokenLabels(field, column.type)
        : [{ token: DL.formatCellText(field, column.type), label: DL.formatCellText(field, column.type) }];

      for (let j = 0; j < items.length; j += 1) {
        const item = items[j];
        if (!item.token) {
          continue;
        }
        const existing = counts.get(item.token);
        if (existing) {
          existing.count += 1;
        } else if (counts.size < maxItems) {
          counts.set(item.token, { token: item.token, label: item.label || item.token, count: 1 });
        }
      }
    }

    // 数量や商品コードのような数値混在の値も自然順で並ぶようにする
    const collator = new Intl.Collator('ja', { numeric: true });
    const options = Array.from(counts.values()).sort((a, b) => collator.compare(a.label, b.label));
    return { options, hasEmpty, truncated: counts.size >= maxItems };
  };
})(window.SubtableList);
