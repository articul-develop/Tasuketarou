/**
 * スマート一覧プラグイン エントリポイント
 * カスタマイズビュー上にスマート一覧を描画し、状態（filters / sorts / 列 / ページ）を一元管理する。
 * 取得 → 展開 → 絞り込み → 並び替え → ページング → 描画 のパイプラインを制御する。
 */
((PLUGIN_ID) => {
  'use strict';

  const DL = window.SubtableList;
  if (!DL) {
    console.error('スマート一覧: モジュールを読み込めませんでした。');
    return;
  }

  const AUTH_WAIT_INTERVAL = 100;
  const AUTH_WAIT_MAX = 8000;

  const config = kintone.plugin.app.getConfig(PLUGIN_ID) || {};
  const pluginConfig = DL.parsePluginConfig(config);

  let instance = null;

  /* ------------------------------------------------------------------ *
   * 認証待ち（desktop_auth.js の非同期チェック完了を待つ）
   * ------------------------------------------------------------------ */

  const waitForAuthentication = () => new Promise((resolve) => {
    if (typeof window.isAuthenticated !== 'function') {
      resolve(false);
      return;
    }
    if (window.isAuthenticated()) {
      resolve(true);
      return;
    }
    let waited = 0;
    const timerId = window.setInterval(() => {
      waited += AUTH_WAIT_INTERVAL;
      if (window.isAuthenticated()) {
        window.clearInterval(timerId);
        resolve(true);
        return;
      }
      if (waited >= AUTH_WAIT_MAX) {
        window.clearInterval(timerId);
        resolve(false);
      }
    }, AUTH_WAIT_INTERVAL);
  });

  /* ------------------------------------------------------------------ *
   * 描画先の解決
   * ------------------------------------------------------------------ */

  const resolveContainer = (setting) => {
    const containerId = (setting && setting.containerId) || DL.DEFAULT_CONTAINER_ID;
    const byId = containerId ? document.getElementById(containerId) : null;
    if (byId) {
      return { element: byId, fallback: false };
    }
    const headerSpace = kintone.app.getHeaderSpaceElement();
    if (!headerSpace) {
      return { element: null, fallback: false };
    }
    // ビューの再表示ごとに空のコンテナが増えないよう、既にある要素を使い回す
    const existing = headerSpace.querySelector('.dl-fallback-container');
    if (existing) {
      existing.textContent = '';
      return { element: existing, fallback: true };
    }
    const container = document.createElement('div');
    container.className = 'dl-fallback-container';
    headerSpace.appendChild(container);
    return { element: container, fallback: true };
  };

  /* ------------------------------------------------------------------ *
   * 一覧インスタンス
   * ------------------------------------------------------------------ */

  const createInstance = async (container, isFallbackContainer, viewId, setting) => {
    const appId = kintone.app.getId();
    const storageKey = DL.buildStorageKey(PLUGIN_ID, appId, viewId);

    const state = {
      appId,
      viewId,
      storageKey,
      columns: [],
      columnMap: {},
      tableLabel: '',
      baseCondition: '',
      allRows: [],
      filteredRows: [],
      filters: DL.createEmptyFilters(),
      sorts: [],
      visibleKeys: [],
      columnOrder: [],
      columnWidths: {},
      frozenColumnCount: 0,
      density: setting.density,
      pageSize: setting.pageSize,
      page: 1,
      loadedPushDownCondition: null,
      hasLoaded: false,
      dataNotices: [],
      configNotices: [],
      errorNotice: null
    };

    const tokenOptionCache = new Map();

    /* ------------------------------------------------ 個人設定 */

    const restorePersonalSettings = () => {
      const stored = DL.loadPersonalSettings(storageKey);
      if (!stored) {
        return;
      }
      const validKeys = new Set(state.columns.map((column) => column.key));

      if (Array.isArray(stored.columnOrder)) {
        const restored = stored.columnOrder.filter((key) => validKeys.has(key));
        // 設定で新しく許可された列は末尾に追加する
        state.columnOrder.forEach((key) => {
          if (!restored.includes(key)) {
            restored.push(key);
          }
        });
        state.columnOrder = restored;
      }
      if (Array.isArray(stored.visibleKeys)) {
        const restoredVisible = stored.visibleKeys.filter((key) => validKeys.has(key));
        // 管理者設定の変更で全滅した場合は初期表示に戻す（列が1つも無い状態を避ける）
        if (restoredVisible.length > 0) {
          state.visibleKeys = restoredVisible;
        }
      }
      const storedFrozenCount = Number(stored.frozenColumnCount);
      if (Number.isInteger(storedFrozenCount) && storedFrozenCount >= 0) {
        state.frozenColumnCount = Math.min(storedFrozenCount, state.visibleKeys.length);
      }
      if (stored.columnWidths && typeof stored.columnWidths === 'object') {
        Object.keys(stored.columnWidths).forEach((key) => {
          const width = Number(stored.columnWidths[key]);
          if (validKeys.has(key) && Number.isFinite(width) && width > 0) {
            state.columnWidths[key] = width;
          }
        });
      }
      if (DL.DENSITY[stored.density]) {
        state.density = stored.density;
      }
      if (DL.PAGE_SIZE_OPTIONS.includes(Number(stored.pageSize))) {
        state.pageSize = Number(stored.pageSize);
      }
      if (Array.isArray(stored.conditions)) {
        state.filters.conditions = stored.conditions
          .filter((condition) => {
            const column = condition && state.columnMap[condition.key];
            return column && DL.getOperatorDefinition(column.type, condition.op);
          })
          .map((condition) => JSON.parse(JSON.stringify(condition)));
      }
      if (Array.isArray(stored.sorts)) {
        state.sorts = stored.sorts
          .filter((sort) => sort && state.columnMap[sort.key])
          .map((sort) => ({ key: sort.key, dir: sort.dir === 'desc' ? 'desc' : 'asc' }));
      }
    };

    const savePersonalSettings = () => DL.savePersonalSettings(storageKey, {
      visibleKeys: state.visibleKeys,
      columnOrder: state.columnOrder,
      columnWidths: state.columnWidths,
      frozenColumnCount: state.frozenColumnCount,
      density: state.density,
      pageSize: state.pageSize,
      conditions: state.filters.conditions,
      sorts: state.sorts
    });

    const resetColumnState = () => {
      state.columnOrder = state.columns.map((column) => column.key);
      const allowed = new Set(state.columnOrder);
      const initialVisible = setting.initialVisibleKeys.filter((key) => allowed.has(key));
      state.visibleKeys = initialVisible.length > 0 ? initialVisible : state.columnOrder.slice();
      state.columnWidths = {};
      state.frozenColumnCount = 0;
      state.density = setting.density;
      state.pageSize = setting.pageSize;
    };

    /* ------------------------------------------------ 列定義の準備 */

    const properties = await DL.fetchFormFields(appId, false);
    const built = DL.buildColumns(properties, setting);
    state.columns = built.columns;
    state.columnMap = built.columnMap;
    state.tableLabel = built.tableLabel;
    state.configNotices = built.warnings.map((message) => ({ level: 'warn', message }));

    state.sorts = setting.initialSorts.filter((sort) => Boolean(state.columnMap[sort.key]));
    resetColumnState();
    restorePersonalSettings();

    // カスタマイズビュー自身の絞り込み条件を母集団にする
    const viewCondition = (kintone.app.getQueryCondition && kintone.app.getQueryCondition()) || '';
    state.baseCondition = DL.combineConditions([viewCondition]);

    /* ------------------------------------------------ グリッド生成 */

    const getVisibleColumns = () => state.columnOrder
      .filter((key) => state.visibleKeys.includes(key))
      .map((key) => state.columnMap[key])
      .filter(Boolean);

    const getActiveConditions = () => state.filters.conditions
      .filter((condition) => DL.isConditionActive(condition, state.columnMap[condition.key]));

    const buildQuickSearchColumns = () => setting.quickSearchKeys
      .map((key) => state.columnMap[key])
      .filter(Boolean);

    const buildQuickSearchPlaceholder = () => {
      const labels = buildQuickSearchColumns().map((column) => column.label);
      if (labels.length === 0) {
        return 'クイック検索の対象が未設定です';
      }
      return `${labels.join('・')}を検索...`;
    };

    const parentListMode = DL.isParentListMode(setting);

    const buildModel = () => {
      const visibleColumns = getVisibleColumns();
      const { renderColumns, builtinLinkColumn } = DL.buildRenderColumns(visibleColumns, setting, state.columnMap);
      const frozenCount = Math.min(
        (builtinLinkColumn ? 1 : 0) + state.frozenColumnCount,
        renderColumns.length
      );

      const totalCount = state.filteredRows.length;
      const pageCount = Math.max(1, Math.ceil(totalCount / state.pageSize));
      if (state.page > pageCount) {
        state.page = pageCount;
      }
      const start = (state.page - 1) * state.pageSize;

      const activeConditions = getActiveConditions();
      const notices = state.configNotices
        .concat(state.dataNotices)
        .concat(state.errorNotice ? [state.errorNotice] : []);

      return {
        appId: state.appId,
        listMode: DL.resolveListMode(setting),
        renderColumns,
        allColumns: state.columns,
        dataColumns: visibleColumns,
        frozenCount,
        tableLabel: state.tableLabel,
        linkColumnKey: state.columnMap[setting.linkColumnKey] ? setting.linkColumnKey : '',
        columnWidths: state.columnWidths,
        sorts: state.sorts,
        columnColors: Array.isArray(setting.columnColors) ? setting.columnColors : [],
        cellColorRules: Array.isArray(setting.cellColorRules) ? setting.cellColorRules : [],
        columnMap: state.columnMap,
        filteredKeys: new Set(activeConditions.map((condition) => condition.key)),
        chips: activeConditions.map((condition) => ({
          id: condition.id,
          label: DL.describeCondition(condition, state.columnMap[condition.key])
        })),
        quick: state.filters.quick,
        quickSearchEnabled: buildQuickSearchColumns().length > 0,
        quickSearchPlaceholder: buildQuickSearchPlaceholder(),
        density: state.density,
        highlightParentBoundary: !parentListMode && setting.highlightParentBoundary !== false,
        pageSize: state.pageSize,
        page: state.page,
        pageCount,
        totalCount,
        hasAnyRow: state.allRows.length > 0,
        pageRows: state.filteredRows.slice(start, start + state.pageSize),
        notices
      };
    };

    const render = () => {
      grid.render(buildModel());
    };

    const refreshSort = () => {
      state.filteredRows = DL.applySort(state.filteredRows, state.sorts, state.columnMap);
      render();
    };

    const refreshFilter = () => {
      const predicate = DL.buildPredicate(state.filters, state.columnMap, buildQuickSearchColumns());
      state.filteredRows = DL.applyFilter(state.allRows, predicate);
      refreshSort();
    };

    const buildDataNotices = (recordCount, truncatedRecords, truncatedRows) => {
      const notices = [];
      if (truncatedRecords) {
        notices.push({
          level: 'warn',
          message: parentListMode
            ? `取得上限（${setting.maxParentRecords.toLocaleString()}件）に達したため、一部のみを表示しています。カスタマイズビューの絞り込み条件で対象を絞ってください。`
            : `取得上限（親レコード ${setting.maxParentRecords.toLocaleString()}件）に達したため、一部のみを表示しています。カスタマイズビューの絞り込み条件で対象を絞ってください。`
        });
      }
      if (!parentListMode && truncatedRows) {
        notices.push({
          level: 'warn',
          message: `明細の表示上限（${setting.maxDetailRows.toLocaleString()}行）に達したため、一部のみを表示しています。`
        });
      }
      if (recordCount === 0) {
        notices.push({
          level: 'info',
          message: parentListMode ? '対象となるレコードがありません。' : '対象となる親レコードがありません。'
        });
      }
      return notices;
    };

    const loadData = async () => {
      if (state.columns.length === 0) {
        state.hasLoaded = true;
        render();
        return;
      }

      const pushDownCondition = DL.buildPushDownCondition(getActiveConditions(), state.columnMap);
      state.errorNotice = null;
      grid.showLoading('データを取得しています...');

      try {
        const result = await DL.fetchParentRecords({
          appId: state.appId,
          baseCondition: state.baseCondition,
          pushDownCondition,
          fields: DL.buildFetchFieldCodes(state.columns, parentListMode ? '' : setting.tableCode),
          maxRecords: setting.maxParentRecords,
          onProgress: (fetched, total) => {
            grid.showLoading(total
              ? `データを取得しています... ${fetched.toLocaleString()} / ${Math.min(total, setting.maxParentRecords).toLocaleString()}件`
              : `データを取得しています... ${fetched.toLocaleString()}件`);
          }
        });

        const rowLimit = parentListMode ? setting.maxParentRecords : setting.maxDetailRows;
        const expanded = DL.buildVirtualRows(
          result.records,
          parentListMode ? '' : setting.tableCode,
          rowLimit
        );
        state.allRows = expanded.rows;
        state.dataNotices = buildDataNotices(result.records.length, result.truncated, expanded.truncated);
        state.loadedPushDownCondition = pushDownCondition;
        state.hasLoaded = true;
        tokenOptionCache.clear();
      } catch (error) {
        console.error('スマート一覧: レコードの取得に失敗しました', error);
        state.allRows = [];
        state.dataNotices = [];
        state.errorNotice = {
          level: 'error',
          message: `データの取得に失敗しました。${(error && error.message) || ''}`,
          retry: true
        };
        if (window.AuthModule && window.API_CONFIG) {
          AuthModule.sendErrorLog(API_CONFIG, 'subtableList.loadData', (error && error.message) || String(error));
        }
      } finally {
        grid.hideLoading();
      }

      refreshFilter();
    };

    /**
     * 絞り込み条件が変わったとき、kintone側へ渡す粗絞り条件が変化する場合は再取得し、
     * 変化しない場合はキャッシュ済みの明細に対してクライアント側で再評価する。
     */
    const applyConditionChange = () => {
      state.page = 1;
      const nextPushDown = DL.buildPushDownCondition(getActiveConditions(), state.columnMap);
      if (state.hasLoaded && nextPushDown === state.loadedPushDownCondition) {
        refreshFilter();
        return;
      }
      loadData();
    };

    const getTokenOptions = (column) => {
      if (tokenOptionCache.has(column.key)) {
        return tokenOptionCache.get(column.key);
      }
      const result = DL.collectTokenOptions(state.allRows, column);
      tokenOptionCache.set(column.key, result);
      return result;
    };

    const exportCsv = () => {
      const visibleColumns = getVisibleColumns();
      if (visibleColumns.length === 0 || state.filteredRows.length === 0) {
        return;
      }
      grid.showLoading('CSVを作成しています...');
      // 大量行でも操作をブロックしたように見えないよう、描画を1フレーム進めてから生成する
      window.setTimeout(() => {
        try {
          const csvText = DL.buildCsv(visibleColumns, state.filteredRows);
          DL.downloadCsv(DL.resolveCsvFileName(setting.csvFileName), csvText, setting.csvEncoding);
        } catch (error) {
          console.error('スマート一覧: CSV出力に失敗しました', error);
          alert(`CSV出力に失敗しました。\n${(error && error.message) || ''}`);
        } finally {
          grid.hideLoading();
        }
      }, 30);
    };

    const grid = DL.createGrid(container, {
      setting,
      handlers: {
        onQuickSearch(value) {
          state.filters.quick = value;
          state.page = 1;
          refreshFilter();
        },
        onOpenFilterPanel() {
          panels.openFilterPanel();
        },
        onOpenColumnPanel(anchor) {
          panels.openColumnPanel(anchor);
        },
        onOpenColumnFilter(column, anchor) {
          panels.openColumnFilter(column, anchor);
        },
        onToggleSort(key, additive) {
          state.sorts = DL.toggleSort(state.sorts, key, additive);
          state.page = 1;
          refreshSort();
        },
        onRemoveCondition(conditionId) {
          state.filters.conditions = state.filters.conditions.filter((condition) => condition.id !== conditionId);
          applyConditionChange();
        },
        onClearConditions() {
          state.filters.conditions = [];
          state.filters.quick = '';
          applyConditionChange();
        },
        onChangeDensity(density) {
          state.density = DL.DENSITY[density] ? density : state.density;
          render();
        },
        onChangePageSize(pageSize) {
          state.pageSize = DL.PAGE_SIZE_OPTIONS.includes(pageSize) ? pageSize : state.pageSize;
          state.page = 1;
          render();
        },
        onChangePage(page) {
          state.page = Math.max(1, page);
          render();
        },
        onChangeColumnWidth(key, width) {
          state.columnWidths[key] = width;
        },
        onSaveView() {
          return savePersonalSettings();
        },
        onResetView() {
          if (!window.confirm('保存した個人設定を削除し、プラグインで設定された初期表示に戻しますか？')) {
            return false;
          }
          if (!DL.removePersonalSettings(storageKey)) {
            alert('個人設定を削除できませんでした。ブラウザの保存設定を確認してください。');
            return false;
          }
          resetColumnState();
          state.filters = DL.createEmptyFilters();
          state.sorts = setting.initialSorts.filter((sort) => Boolean(state.columnMap[sort.key]));
          // 条件を消すと kintone へ渡す粗絞り条件も変わるため、必要なら再取得させる
          applyConditionChange();
          return true;
        },
        onExportCsv: exportCsv,
        onReload() {
          state.page = 1;
          loadData();
        }
      }
    });

    const panels = DL.createPanels({
      getColumns: () => state.columns,
      getColumnMap: () => state.columnMap,
      getFilters: () => state.filters,
      getColumnState: () => ({
        columnOrder: state.columnOrder,
        visibleKeys: state.visibleKeys,
        frozenColumnCount: state.frozenColumnCount
      }),
      getTokenOptions,
      handlers: {
        onApplyFilters(working) {
          state.filters.conditions = working.conditions;
          applyConditionChange();
        },
        onApplyColumnFilter(column, selection) {
          // 詳細絞り込みと同じ conditions を編集する（状態を二重に持たない）
          state.filters.conditions = state.filters.conditions.filter((condition) => {
            if (condition.key !== column.key) {
              return true;
            }
            return condition.op !== 'in' && condition.op !== 'empty';
          });
          if (selection.tokens.length > 0) {
            const condition = DL.createCondition(column.key, column.type);
            condition.op = 'in';
            condition.value = selection.tokens;
            state.filters.conditions.push(condition);
          } else if (selection.empty) {
            const condition = DL.createCondition(column.key, column.type);
            condition.op = 'empty';
            condition.value = null;
            state.filters.conditions.push(condition);
          }
          applyConditionChange();
        },
        onApplyColumns(next) {
          state.columnOrder = next.columnOrder;
          state.visibleKeys = next.visibleKeys;
          state.frozenColumnCount = next.frozenColumnCount;
          render();
        },
        onResetColumns() {
          resetColumnState();
          render();
        }
      }
    });

    if (isFallbackContainer) {
      state.configNotices.push({
        level: 'info',
        message: `カスタマイズビューのHTMLに <div id="${setting.containerId}"></div> を追加すると、より広い領域に表示できます。`
      });
    }

    render();
    await loadData();

    return {
      destroy() {
        panels.destroy();
        grid.destroy();
      }
    };
  };

  /* ------------------------------------------------------------------ *
   * イベント登録
   * ------------------------------------------------------------------ */

  kintone.events.on('app.record.index.show', async (event) => {
    if (event.viewType !== 'custom') {
      return event;
    }
    const viewId = String(event.viewId || '');
    const definition = DL.findDefinitionByViewId(pluginConfig.definitions, viewId);
    if (!definition) {
      return event;
    }
    const setting = DL.toRuntimeSetting(definition);
    if (event.viewName) {
      setting.title = event.viewName;
      setting.name = event.viewName;
    }
    if (!DL.isParentListMode(setting) && !setting.tableCode) {
      console.warn('スマート一覧: 対象のサブテーブルが設定されていません。');
      return event;
    }

    const authenticated = await waitForAuthentication();
    if (!authenticated) {
      return event;
    }

    // ビュー切り替えや再表示で二重に描画しないよう、前回のインスタンスを破棄する
    if (instance) {
      instance.destroy();
      instance = null;
    }

    const container = resolveContainer(setting);
    if (!container.element) {
      console.error('スマート一覧: 描画先の要素が見つかりませんでした。');
      return event;
    }

    try {
      instance = await createInstance(container.element, container.fallback, viewId, setting);
    } catch (error) {
      console.error('スマート一覧: 初期化に失敗しました', error);
      if (window.AuthModule && window.API_CONFIG) {
        AuthModule.sendErrorLog(API_CONFIG, 'subtableList.init', (error && error.message) || String(error));
      }
      container.element.textContent = `スマート一覧の初期化に失敗しました。${(error && error.message) || ''}`;
    }

    return event;
  });
})(kintone.$PLUGIN_ID);
