/**
 * スマート一覧プラグイン 共通ユーティリティ
 * 設定のパース／フィールド型の分類／セル値の文字列化・比較キー化／個人設定の保存を担当する。
 * 設定画面（config.js）とデスクトップ（desktop_main.js）の両方から読み込まれるため、
 * このファイルはロード時にDOM操作を行わない。
 */
window.SubtableList = window.SubtableList || {};
((DL) => {
  'use strict';

  DL.CONFIG_KEY = 'subtableListSetting';
  // v2: 「この表示を覚える」で明示保存した設定のみ復元する（自動保存時代の v1 は無効）
  DL.STORAGE_VERSION = 2;
  DL.DEFAULT_CONTAINER_ID = 'tasuketaro-subtable-list';

  DL.SCOPE = {
    PARENT: 'p',
    TABLE: 't'
  };

  // parent: 親レコード1件＝一覧1行 / subtable: サブテーブル1行＝一覧1行
  DL.LIST_MODE = {
    PARENT: 'parent',
    SUBTABLE: 'subtable'
  };

  DL.resolveListMode = (source) => {
    if (source && source.listMode === DL.LIST_MODE.PARENT) {
      return DL.LIST_MODE.PARENT;
    }
    if (source && source.listMode === DL.LIST_MODE.SUBTABLE) {
      return DL.LIST_MODE.SUBTABLE;
    }
    // 旧設定・未指定はサブテーブル一覧として扱う（tableCode の有無に関わらず互換優先）
    return DL.LIST_MODE.SUBTABLE;
  };

  DL.isParentListMode = (setting) => DL.resolveListMode(setting) === DL.LIST_MODE.PARENT;

  DL.DENSITY = {
    compact: { label: 'コンパクト', rowHeight: 32 },
    normal: { label: '標準', rowHeight: 40 },
    relax: { label: 'ゆったり', rowHeight: 48 }
  };

  DL.PAGE_SIZE_OPTIONS = [20, 50, 100];

  // セル／列の背景色プリセット（文字色はコントラストで自動）
  DL.COLOR_PRESETS = {
    gray: { label: 'グレー', bg: '#e8ecf1', fg: '#2b3648' },
    blue: { label: '青', bg: '#d7e6fb', fg: '#1f4f9e' },
    green: { label: '緑', bg: '#d8f0e3', fg: '#1f6b45' },
    yellow: { label: '黄', bg: '#f8ebc2', fg: '#7a5a12' },
    orange: { label: '橙', bg: '#f8dfc8', fg: '#8a4b16' },
    red: { label: '赤', bg: '#f6d6d6', fg: '#8f2d2d' },
    purple: { label: '紫', bg: '#e6ddf5', fg: '#5b3d8f' }
  };

  DL.COLOR_PRESET_IDS = Object.keys(DL.COLOR_PRESETS);

  DL.isColorPresetId = (colorId) => Boolean(colorId && DL.COLOR_PRESETS[colorId]);

  DL.createColorRuleId = () => `cc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  // 条件色の旧日付op（今日より前 など1段）→ 比較+プリセット値の2段へ
  const CELL_COLOR_DATE_LEGACY = {
    today: { op: 'dateEqual', value: 'today' },
    yesterday: { op: 'dateEqual', value: 'yesterday' },
    beforeToday: { op: 'dateBefore', value: 'today' },
    afterToday: { op: 'dateAfter', value: 'today' },
    onOrBeforeToday: { op: 'dateOnOrBefore', value: 'today' },
    onOrAfterToday: { op: 'dateOnOrAfter', value: 'today' },
    thisWeek: { op: 'dateEqual', value: 'thisWeek' },
    thisMonth: { op: 'dateEqual', value: 'thisMonth' },
    lastMonth: { op: 'dateEqual', value: 'lastMonth' }
  };

  DL.normalizeColumnColors = (raw) => {
    if (!Array.isArray(raw)) {
      return [];
    }
    const seen = new Set();
    const result = [];
    raw.forEach((item) => {
      if (!item || typeof item.key !== 'string' || !item.key || !DL.isColorPresetId(item.colorId)) {
        return;
      }
      // 同じ列は後勝ち
      if (seen.has(item.key)) {
        const index = result.findIndex((entry) => entry.key === item.key);
        if (index >= 0) {
          result.splice(index, 1);
        }
      }
      seen.add(item.key);
      result.push({ key: item.key, colorId: item.colorId });
    });
    return result;
  };

  DL.normalizeCellColorRules = (raw) => {
    if (!Array.isArray(raw)) {
      return [];
    }
    return raw
      .filter((item) => item
        && typeof item.key === 'string'
        && item.key
        && typeof item.op === 'string'
        && item.op
        && DL.isColorPresetId(item.colorId))
      .map((item) => {
        const legacy = CELL_COLOR_DATE_LEGACY[item.op];
        return {
          id: String(item.id || '') || DL.createColorRuleId(),
          key: item.key,
          op: legacy ? legacy.op : item.op,
          value: legacy
            ? legacy.value
            : (item.value === undefined ? null : JSON.parse(JSON.stringify(item.value))),
          colorId: item.colorId
        };
      });
  };

  /* ------------------------------------------------------------------ *
   * フィールド型の分類
   * ------------------------------------------------------------------ */

  DL.TYPE_GROUP = {
    SINGLE_LINE_TEXT: 'TEXT',
    MULTI_LINE_TEXT: 'TEXT',
    RICH_TEXT: 'TEXT',
    LINK: 'TEXT',
    RECORD_NUMBER: 'TEXT',
    NUMBER: 'NUMBER',
    CALC: 'NUMBER',
    DATE: 'DATE',
    DATETIME: 'DATETIME',
    CREATED_TIME: 'DATETIME',
    UPDATED_TIME: 'DATETIME',
    TIME: 'TIME',
    DROP_DOWN: 'CHOICE',
    RADIO_BUTTON: 'CHOICE',
    CHECK_BOX: 'CHOICE',
    MULTI_SELECT: 'CHOICE',
    STATUS: 'CHOICE',
    CATEGORY: 'CHOICE',
    USER_SELECT: 'ENTITY',
    ORGANIZATION_SELECT: 'ENTITY',
    GROUP_SELECT: 'ENTITY',
    CREATOR: 'ENTITY',
    MODIFIER: 'ENTITY',
    STATUS_ASSIGNEE: 'ENTITY',
    FILE: 'FILE'
  };

  // 値が配列で保持される型（選択肢・ユーザー系・添付ファイル）
  DL.MULTI_VALUE_GROUPS = ['CHOICE', 'ENTITY', 'FILE'];

  // 一覧に出せない型。サブテーブルの入れ子や装飾要素は対象外。
  DL.UNSUPPORTED_TYPES = ['SUBTABLE', 'REFERENCE_TABLE', 'SPACER', 'LABEL', 'HR', 'GROUP'];

  // 親レコードにのみ存在する型（サブテーブル内には配置できない）
  DL.PARENT_ONLY_TYPES = [
    'RECORD_NUMBER', 'CREATOR', 'CREATED_TIME', 'MODIFIER', 'UPDATED_TIME', 'STATUS', 'STATUS_ASSIGNEE', 'CATEGORY'
  ];

  DL.getTypeGroup = (type) => DL.TYPE_GROUP[type] || 'TEXT';

  DL.isSupportedType = (type) => Boolean(type) && !DL.UNSUPPORTED_TYPES.includes(type) && Boolean(DL.TYPE_GROUP[type]);

  DL.isMultiValueType = (type) => DL.MULTI_VALUE_GROUPS.includes(DL.getTypeGroup(type));

  // 数値として右寄せ表示する型
  DL.isNumericType = (type) => DL.getTypeGroup(type) === 'NUMBER';

  /* ------------------------------------------------------------------ *
   * 文字列ユーティリティ
   * ------------------------------------------------------------------ */

  DL.escapeHtml = (value) => String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  DL.escapeAttr = (value) => DL.escapeHtml(value);

  // リッチエディターの値を一覧表示用のプレーンテキストへ変換する
  DL.stripHtml = (value) => String(value || '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#3[49];/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

  DL.debounce = (fn, wait) => {
    let timerId = null;
    return function debounced(...args) {
      if (timerId) {
        window.clearTimeout(timerId);
      }
      timerId = window.setTimeout(() => {
        timerId = null;
        fn.apply(this, args);
      }, wait);
    };
  };

  /**
   * 配列内のキーを指定位置へ移動する（並べ替えリスト共用）。
   */
  DL.moveKeyInOrder = (order, key, toIndex) => {
    const next = (order || []).filter((item) => item !== key);
    const index = Math.max(0, Math.min(Number(toIndex) || 0, next.length));
    next.splice(index, 0, key);
    return next;
  };

  /**
   * ドラッグ中にスクロール端へ近づくと自動スクロールする。
   * HTML5 DnD では端で止まりやすいため、requestAnimationFrame で補う。
   */
  DL.createEdgeAutoScroller = (scrollEl, options) => {
    const edge = (options && options.edge) || 56;
    const maxSpeed = (options && options.maxSpeed) || 22;
    let dragging = false;
    let clientY = 0;
    let rafId = null;

    const step = () => {
      if (!dragging || !scrollEl) {
        rafId = null;
        return;
      }
      const rect = scrollEl.getBoundingClientRect();
      const topDist = clientY - rect.top;
      const bottomDist = rect.bottom - clientY;
      if (topDist >= 0 && topDist < edge) {
        const ratio = (edge - topDist) / edge;
        scrollEl.scrollTop -= Math.max(3, Math.round(maxSpeed * ratio));
      } else if (bottomDist >= 0 && bottomDist < edge) {
        const ratio = (edge - bottomDist) / edge;
        scrollEl.scrollTop += Math.max(3, Math.round(maxSpeed * ratio));
      }
      rafId = window.requestAnimationFrame(step);
    };

    const onDragOver = (event) => {
      if (!dragging) {
        return;
      }
      clientY = event.clientY;
      event.preventDefault();
    };

    scrollEl.addEventListener('dragover', onDragOver);

    return {
      start() {
        dragging = true;
        scrollEl.classList.add('is-sortable-dragging');
        if (!rafId) {
          rafId = window.requestAnimationFrame(step);
        }
      },
      stop() {
        dragging = false;
        scrollEl.classList.remove('is-sortable-dragging');
        if (rafId) {
          window.cancelAnimationFrame(rafId);
          rafId = null;
        }
      },
      destroy() {
        this.stop();
        scrollEl.removeEventListener('dragover', onDragOver);
      }
    };
  };

  /* ------------------------------------------------------------------ *
   * 列キー（親項目と明細項目でフィールドコードが衝突しないようにする）
   * ------------------------------------------------------------------ */

  DL.makeColumnKey = (scope, code) => `${scope}:${code}`;

  DL.parseColumnKey = (key) => {
    const text = String(key || '');
    const separatorIndex = text.indexOf(':');
    if (separatorIndex < 0) {
      return null;
    }
    return {
      scope: text.slice(0, separatorIndex),
      code: text.slice(separatorIndex + 1)
    };
  };

  DL.isParentColumn = (column) => Boolean(column) && column.scope === DL.SCOPE.PARENT;

  /* ------------------------------------------------------------------ *
   * 設定（管理者設定）
   * 新形式: { definitions: [ definition, ... ] }
   * 旧形式（単一オブジェクト）は読み込み時に1定義へ移行する。
   * ------------------------------------------------------------------ */

  DL.createDefaultDefinition = () => ({
    id: '',
    name: '',
    viewId: '',
    title: '',
    listMode: DL.LIST_MODE.SUBTABLE,
    tableCode: '',
    parentFieldCodes: [],
    tableFieldCodes: [],
    columnOrder: [],
    initialVisibleKeys: [],
    quickSearchKeys: [],
    initialSorts: [],
    pageSize: 50,
    density: 'compact',
    highlightParentBoundary: true,
    maxParentRecords: 5000,
    maxDetailRows: 50000,
    linkColumnKey: '',
    csvEncoding: 'UTF-8-BOM',
    csvFileName: 'スマート一覧_{YYYYMMDD_HHmmss}',
    columnColors: [],
    cellColorRules: []
  });

  const toPositiveInt = (value, fallback) => {
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  };

  const toStringArray = (value) => (Array.isArray(value) ? value.filter((item) => typeof item === 'string' && item) : []);

  DL.createDefinitionId = () => `def_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  DL.createEmptyDefinition = (overrides) => {
    const defaults = DL.createDefaultDefinition();
    return Object.assign({}, defaults, {
      id: DL.createDefinitionId()
    }, overrides || {});
  };

  /**
   * 1定義分を正規化する。旧設定オブジェクトにも使える。
   */
  DL.normalizeDefinition = (raw, defaults) => {
    const base = defaults || DL.createDefaultDefinition();
    const source = raw && typeof raw === 'object' ? raw : {};
    const sorts = Array.isArray(source.initialSorts)
      ? source.initialSorts
        .filter((item) => item && typeof item.key === 'string' && item.key)
        .map((item) => ({ key: item.key, dir: item.dir === 'desc' ? 'desc' : 'asc' }))
      : [];

    const name = typeof source.name === 'string' && source.name.trim()
      ? source.name.trim()
      : (typeof source.title === 'string' && source.title.trim() ? source.title.trim() : base.name);
    const title = typeof source.title === 'string' && source.title.trim()
      ? source.title.trim()
      : name;
    const listMode = DL.resolveListMode(source);
    const tableCode = listMode === DL.LIST_MODE.PARENT ? '' : String(source.tableCode || '');

    return {
      id: String(source.id || '') || DL.createDefinitionId(),
      name,
      viewId: String(source.viewId || base.viewId),
      title,
      listMode,
      tableCode,
      parentFieldCodes: toStringArray(source.parentFieldCodes),
      tableFieldCodes: listMode === DL.LIST_MODE.PARENT ? [] : toStringArray(source.tableFieldCodes),
      columnOrder: toStringArray(source.columnOrder),
      initialVisibleKeys: toStringArray(source.initialVisibleKeys),
      quickSearchKeys: toStringArray(source.quickSearchKeys),
      initialSorts: sorts,
      pageSize: DL.PAGE_SIZE_OPTIONS.includes(Number(source.pageSize)) ? Number(source.pageSize) : base.pageSize,
      density: DL.DENSITY[source.density] ? source.density : base.density,
      // 未指定の旧設定は ON（初期値）として扱う。親レコード一覧では実行時に無効化する
      highlightParentBoundary: source.highlightParentBoundary !== false,
      maxParentRecords: toPositiveInt(source.maxParentRecords, base.maxParentRecords),
      maxDetailRows: toPositiveInt(source.maxDetailRows, base.maxDetailRows),
      linkColumnKey: String(source.linkColumnKey || ''),
      csvEncoding: source.csvEncoding === 'SJIS' ? 'SJIS' : base.csvEncoding,
      csvFileName: typeof source.csvFileName === 'string' && source.csvFileName ? source.csvFileName : base.csvFileName,
      columnColors: DL.normalizeColumnColors(source.columnColors),
      cellColorRules: DL.normalizeCellColorRules(source.cellColorRules)
    };
  };

  /**
   * プラグイン設定全体をパースする。旧単一形式も definitions[0] へ移行する。
   */
  DL.parsePluginConfig = (config) => {
    let raw = {};
    try {
      raw = JSON.parse((config && config[DL.CONFIG_KEY]) || '{}') || {};
    } catch (e) {
      console.error('スマート一覧: 設定の解析に失敗しました', e);
      raw = {};
    }

    const defaults = DL.createDefaultDefinition();
    let definitions = [];

    if (Array.isArray(raw.definitions)) {
      definitions = raw.definitions.map((item) => DL.normalizeDefinition(item, defaults));
    } else if (raw && typeof raw === 'object' && (raw.viewId || raw.tableCode || raw.title || raw.columnOrder)) {
      // 旧形式（単一一覧設定）
      definitions = [DL.normalizeDefinition(raw, defaults)];
    }

    if (definitions.length === 0) {
      definitions = [DL.createEmptyDefinition()];
    }

    // id の重複を避ける
    const seen = new Set();
    definitions.forEach((definition) => {
      if (seen.has(definition.id)) {
        definition.id = DL.createDefinitionId();
      }
      seen.add(definition.id);
    });

    return { definitions };
  };

  DL.findDefinitionByViewId = (definitions, viewId) => {
    const target = String(viewId || '');
    if (!target || !Array.isArray(definitions)) {
      return null;
    }
    return definitions.find((definition) => String(definition.viewId) === target) || null;
  };

  DL.findDefinitionById = (definitions, id) => {
    if (!id || !Array.isArray(definitions)) {
      return null;
    }
    return definitions.find((definition) => definition.id === id) || null;
  };

  /**
   * ランタイム用: 定義を従来の setting 形（containerId 付き）へ変換する。
   */
  DL.toRuntimeSetting = (definition) => Object.assign({}, definition || DL.createDefaultDefinition(), {
    containerId: DL.DEFAULT_CONTAINER_ID,
    frozenColumnCount: 0
  });

  /* ------------------------------------------------------------------ *
   * 個人設定（localStorage）
   * 認証用の PLUGIN_<id>_config とは別キーにする。
   * ------------------------------------------------------------------ */

  DL.buildStorageKey = (pluginId, appId, viewId) => `PLUGIN_${pluginId}_SL_${appId}_${viewId}_view`;

  DL.loadPersonalSettings = (storageKey) => {
    try {
      const stored = JSON.parse(window.localStorage.getItem(storageKey) || 'null');
      if (!stored || typeof stored !== 'object' || stored.v !== DL.STORAGE_VERSION) {
        return null;
      }
      return stored;
    } catch (e) {
      return null;
    }
  };

  DL.savePersonalSettings = (storageKey, state) => {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify({
        v: DL.STORAGE_VERSION,
        visibleKeys: state.visibleKeys,
        columnOrder: state.columnOrder,
        columnWidths: state.columnWidths,
        frozenColumnCount: state.frozenColumnCount,
        density: state.density,
        pageSize: state.pageSize,
        conditions: state.conditions,
        sorts: state.sorts
      }));
      return true;
    } catch (e) {
      // 容量超過やプライベートモードでも一覧自体は使えるようにする
      console.warn('スマート一覧: 個人設定の保存に失敗しました', e);
      return false;
    }
  };

  DL.removePersonalSettings = (storageKey) => {
    try {
      window.localStorage.removeItem(storageKey);
      return true;
    } catch (e) {
      console.warn('スマート一覧: 個人設定の削除に失敗しました', e);
      return false;
    }
  };

  /* ------------------------------------------------------------------ *
   * セル値の取り出し
   * ------------------------------------------------------------------ */

  DL.getCellField = (virtualRow, column) => {
    if (!virtualRow || !column) {
      return null;
    }
    const source = column.scope === DL.SCOPE.PARENT ? virtualRow.parent : virtualRow.row;
    return (source && source[column.code]) || null;
  };

  DL.getRawValue = (virtualRow, column) => {
    const field = DL.getCellField(virtualRow, column);
    return field ? field.value : null;
  };

  /* ------------------------------------------------------------------ *
   * 表示文字列化
   * ------------------------------------------------------------------ */

  const pad2 = (value) => String(value).padStart(2, '0');

  // kintoneのDATETIMEはUTCのISO文字列。ブラウザのタイムゾーンで表示する。
  DL.formatDateTime = (value, withSeconds) => {
    if (!value) {
      return '';
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return String(value);
    }
    const base = `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
    return withSeconds ? `${base}:${pad2(date.getSeconds())}` : base;
  };

  DL.formatCellText = (field, type) => {
    if (!field) {
      return '';
    }
    const value = field.value;
    if (value === null || value === undefined || value === '') {
      return '';
    }

    switch (DL.getTypeGroup(type)) {
      case 'DATETIME':
        return DL.formatDateTime(value, false);
      case 'CHOICE':
        return Array.isArray(value) ? value.join(', ') : String(value);
      case 'ENTITY':
        if (Array.isArray(value)) {
          return value.map((item) => (item && (item.name || item.code)) || '').filter(Boolean).join(', ');
        }
        return (value && (value.name || value.code)) || '';
      case 'FILE':
        return Array.isArray(value) ? value.map((item) => (item && item.name) || '').filter(Boolean).join(', ') : '';
      case 'TEXT':
        return type === 'RICH_TEXT' ? DL.stripHtml(value) : String(value);
      default:
        return String(value);
    }
  };

  // CSVでは日時に秒まで含める。それ以外は一覧と同じ表現。
  DL.formatCsvText = (field, type) => {
    if (!field) {
      return '';
    }
    if (DL.getTypeGroup(type) === 'DATETIME') {
      return DL.formatDateTime(field.value, true);
    }
    return DL.formatCellText(field, type);
  };

  /* ------------------------------------------------------------------ *
   * 比較キー（ソート用）
   * ------------------------------------------------------------------ */

  // 空欄は null を返し、ソート時は常に末尾へ送る。
  DL.getSortKey = (field, type) => {
    if (!field) {
      return null;
    }
    const value = field.value;
    if (value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) {
      return null;
    }

    switch (DL.getTypeGroup(type)) {
      case 'NUMBER': {
        const parsed = parseFloat(value);
        // 計算フィールドは日付や時刻の書式になる場合があるため文字列比較へ退避する
        return Number.isFinite(parsed) ? parsed : String(value);
      }
      case 'DATE':
      case 'DATETIME':
      case 'TIME':
        // いずれもISO形式のため辞書順が時系列順と一致する
        return String(value);
      default: {
        const text = DL.formatCellText(field, type);
        return text === '' ? null : text;
      }
    }
  };

  /* ------------------------------------------------------------------ *
   * 検索キー（クイック検索・部分一致用）
   * ------------------------------------------------------------------ */

  DL.getSearchText = (field, type) => DL.formatCellText(field, type).toLowerCase();

  /* ------------------------------------------------------------------ *
   * 選択肢・ユーザーの絞り込み用の値リスト
   * 選択肢は選択肢名、ユーザー系はコードで一致判定する。
   * ------------------------------------------------------------------ */

  DL.getFilterTokens = (field, type) => {
    if (!field) {
      return [];
    }
    const value = field.value;
    if (value === null || value === undefined || value === '') {
      return [];
    }
    switch (DL.getTypeGroup(type)) {
      case 'CHOICE':
        return Array.isArray(value) ? value.slice() : [String(value)];
      case 'ENTITY':
        if (Array.isArray(value)) {
          return value.map((item) => (item && (item.code || item.name)) || '').filter(Boolean);
        }
        return value && (value.code || value.name) ? [value.code || value.name] : [];
      default:
        return [String(value)];
    }
  };

  // 選択肢の表示ラベル（ENTITYはコードに対する表示名）
  DL.getFilterTokenLabels = (field, type) => {
    if (!field) {
      return [];
    }
    const value = field.value;
    if (DL.getTypeGroup(type) === 'ENTITY') {
      if (Array.isArray(value)) {
        return value.map((item) => ({
          token: (item && (item.code || item.name)) || '',
          label: (item && (item.name || item.code)) || ''
        })).filter((item) => item.token);
      }
      return value && (value.code || value.name)
        ? [{ token: value.code || value.name, label: value.name || value.code }]
        : [];
    }
    return DL.getFilterTokens(field, type).map((token) => ({ token, label: token }));
  };

  DL.isEmptyValue = (field) => {
    if (!field) {
      return true;
    }
    const value = field.value;
    if (value === null || value === undefined || value === '') {
      return true;
    }
    return Array.isArray(value) && value.length === 0;
  };

  /* ------------------------------------------------------------------ *
   * 日付レンジ（ブラウザのタイムゾーン基準）
   * ------------------------------------------------------------------ */

  DL.toLocalDateString = (date) => `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;

  // プリセット値（today / lastWeek など）を日付レンジへ。条件色の比較演算子から使う。
  DL.resolveDatePresetRange = (preset) => DL.resolveDateRange(preset);

  // op に対応する [開始日, 終了日] をローカル日付文字列で返す。終了日は含む。
  DL.resolveDateRange = (op, value) => {
    const now = new Date();
    const startOfDay = (base) => new Date(base.getFullYear(), base.getMonth(), base.getDate());
    const addDays = (base, days) => {
      const next = new Date(base.getTime());
      next.setDate(next.getDate() + days);
      return next;
    };

    switch (op) {
      case 'today': {
        const day = startOfDay(now);
        return { from: DL.toLocalDateString(day), to: DL.toLocalDateString(day) };
      }
      case 'yesterday': {
        const day = addDays(startOfDay(now), -1);
        return { from: DL.toLocalDateString(day), to: DL.toLocalDateString(day) };
      }
      case 'tomorrow': {
        const day = addDays(startOfDay(now), 1);
        return { from: DL.toLocalDateString(day), to: DL.toLocalDateString(day) };
      }
      case 'beforeToday': {
        // 終了日は含むため、昨日まで（＝今日未満）
        const day = addDays(startOfDay(now), -1);
        return { from: '', to: DL.toLocalDateString(day) };
      }
      case 'afterToday': {
        // 開始日は含むため、明日以降（＝今日超）
        const day = addDays(startOfDay(now), 1);
        return { from: DL.toLocalDateString(day), to: '' };
      }
      case 'onOrBeforeToday': {
        const day = startOfDay(now);
        return { from: '', to: DL.toLocalDateString(day) };
      }
      case 'onOrAfterToday': {
        const day = startOfDay(now);
        return { from: DL.toLocalDateString(day), to: '' };
      }
      case 'thisWeek': {
        // 週の開始は月曜
        const day = startOfDay(now);
        const offset = (day.getDay() + 6) % 7;
        const from = addDays(day, -offset);
        return { from: DL.toLocalDateString(from), to: DL.toLocalDateString(addDays(from, 6)) };
      }
      case 'lastWeek': {
        const day = startOfDay(now);
        const offset = (day.getDay() + 6) % 7;
        const from = addDays(day, -offset - 7);
        return { from: DL.toLocalDateString(from), to: DL.toLocalDateString(addDays(from, 6)) };
      }
      case 'nextWeek': {
        const day = startOfDay(now);
        const offset = (day.getDay() + 6) % 7;
        const from = addDays(day, 7 - offset);
        return { from: DL.toLocalDateString(from), to: DL.toLocalDateString(addDays(from, 6)) };
      }
      case 'thisMonth': {
        const from = new Date(now.getFullYear(), now.getMonth(), 1);
        const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        return { from: DL.toLocalDateString(from), to: DL.toLocalDateString(to) };
      }
      case 'lastMonth': {
        const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const to = new Date(now.getFullYear(), now.getMonth(), 0);
        return { from: DL.toLocalDateString(from), to: DL.toLocalDateString(to) };
      }
      case 'nextMonth': {
        const from = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        const to = new Date(now.getFullYear(), now.getMonth() + 2, 0);
        return { from: DL.toLocalDateString(from), to: DL.toLocalDateString(to) };
      }
      case 'dateBetween':
        return {
          from: (value && value.from) || '',
          to: (value && value.to) || ''
        };
      default:
        return { from: '', to: '' };
    }
  };

  // ローカル日付文字列を、DATETIME比較用のUTCミリ秒レンジへ変換する
  DL.dateRangeToTimestamps = (range) => {
    const parseFrom = (text) => {
      if (!text) {
        return null;
      }
      const parts = String(text).split('-').map((part) => parseInt(part, 10));
      if (parts.length < 3 || parts.some((part) => !Number.isFinite(part))) {
        return null;
      }
      return new Date(parts[0], parts[1] - 1, parts[2]).getTime();
    };
    const fromTime = parseFrom(range.from);
    const toStart = parseFrom(range.to);
    return {
      from: fromTime,
      // 終了日を含めるため翌日0時の直前までを範囲とする
      to: toStart === null ? null : toStart + 24 * 60 * 60 * 1000 - 1
    };
  };
})(window.SubtableList);
