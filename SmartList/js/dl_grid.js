/**
 * スマート一覧プラグイン グリッド描画
 * ツールバー・条件チップ・テーブル本体（ヘッダー固定／左列固定）・ページングを描画する。
 * 状態は一切保持せず、desktop_main から渡されたモデルを描画し、操作は handlers へ通知する。
 */
window.SubtableList = window.SubtableList || {};
((DL) => {
  'use strict';

  const LINK_COLUMN_KEY = '__link';
  const LONG_TEXT_THRESHOLD = 24;
  const MIN_COLUMN_WIDTH = 48;
  const MAX_AUTO_WIDTH = 420;

  DL.LINK_COLUMN_KEY = LINK_COLUMN_KEY;

  /**
   * 描画用の列リスト。管理者が親レコードリンク列を指定していない場合は、
   * 先頭に専用のリンク列を追加して必ず親レコードへ辿れるようにする。
   */
  DL.buildRenderColumns = (visibleColumns, setting, columnMap) => {
    const hasLinkColumn = Boolean(setting.linkColumnKey)
      && Boolean(columnMap[setting.linkColumnKey])
      && visibleColumns.some((column) => column.key === setting.linkColumnKey);

    if (hasLinkColumn) {
      return { renderColumns: visibleColumns.slice(), builtinLinkColumn: false };
    }
    const linkColumn = {
      key: LINK_COLUMN_KEY,
      scope: DL.SCOPE.PARENT,
      code: '',
      label: '',
      type: 'BUILTIN_LINK',
      builtin: true,
      defaultWidth: 36
    };
    return { renderColumns: [linkColumn].concat(visibleColumns), builtinLinkColumn: true };
  };

  const createElement = (tagName, className, text) => {
    const element = document.createElement(tagName);
    if (className) {
      element.className = className;
    }
    if (text !== undefined && text !== null) {
      element.textContent = text;
    }
    return element;
  };

  let measureContext = null;
  const measureTextWidth = (text, font) => {
    if (!measureContext) {
      measureContext = document.createElement('canvas').getContext('2d');
    }
    measureContext.font = font;
    return measureContext.measureText(text).width;
  };

  /**
   * グリッドを生成する。
   * handlers: onQuickSearch / onOpenFilterPanel / onOpenColumnPanel / onOpenColumnFilter /
   *           onExportCsv / onReload / onToggleSort / onRemoveCondition / onClearConditions /
   *           onChangeDensity / onChangePageSize / onChangePage / onChangeColumnWidth /
   *           onSaveView / onResetView
   */
  DL.createGrid = (rootElement, context) => {
    const handlers = context.handlers || {};
    const setting = context.setting;

    const root = createElement('div', 'dl-root');
    root.dataset.density = setting.density;

    /* -------------------------------------------------- ツールバー */
    const toolbar = createElement('div', 'dl-toolbar');

    const titleRow = createElement('div', 'dl-toolbar-head');
    if (setting.title) {
      titleRow.appendChild(createElement('h2', 'dl-title', setting.title));
    }

    const controls = createElement('div', 'dl-controls');

    const searchBox = createElement('div', 'dl-search');
    searchBox.appendChild(createElement('span', 'dl-search-icon', '\uD83D\uDD0D'));
    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.className = 'dl-search-input';
    searchInput.setAttribute('autocomplete', 'off');
    searchBox.appendChild(searchInput);
    const searchClear = createElement('button', 'dl-search-clear', '\u00D7');
    searchClear.type = 'button';
    searchClear.title = '検索をクリア';
    searchBox.appendChild(searchClear);
    controls.appendChild(searchBox);

    const viewActions = createElement('div', 'dl-view-actions');
    const saveViewButton = createElement('button', 'dl-btn dl-btn-primary', 'この表示を覚える');
    saveViewButton.type = 'button';
    saveViewButton.title = '表示列・列順・列幅・固定列・密度・件数・絞り込み・並び順を保存します';
    viewActions.appendChild(saveViewButton);

    const resetViewButton = createElement('button', 'dl-btn', '初期表示に戻す');
    resetViewButton.type = 'button';
    resetViewButton.title = '保存した個人設定を削除して、プラグインの初期設定に戻します';
    viewActions.appendChild(resetViewButton);
    controls.appendChild(viewActions);

    const filterButton = createElement('button', 'dl-btn');
    filterButton.type = 'button';
    filterButton.appendChild(createElement('span', null, '絞り込み'));
    const filterBadge = createElement('span', 'dl-badge');
    filterBadge.hidden = true;
    filterButton.appendChild(filterBadge);
    controls.appendChild(filterButton);

    const columnButton = createElement('button', 'dl-btn', '表示列');
    columnButton.type = 'button';
    controls.appendChild(columnButton);

    const csvButton = createElement('button', 'dl-btn', 'CSV出力');
    csvButton.type = 'button';
    controls.appendChild(csvButton);

    const reloadButton = createElement('button', 'dl-btn dl-btn-icon', '\u21BB');
    reloadButton.type = 'button';
    reloadButton.title = '最新のデータを再取得';
    controls.appendChild(reloadButton);

    titleRow.appendChild(controls);
    toolbar.appendChild(titleRow);

    const chipsRow = createElement('div', 'dl-chips');
    chipsRow.hidden = true;
    toolbar.appendChild(chipsRow);

    root.appendChild(toolbar);

    /* -------------------------------------------------- 通知 */
    const noticeArea = createElement('div', 'dl-notices');
    root.appendChild(noticeArea);

    /* -------------------------------------------------- 件数・表示設定 */
    const statusBar = createElement('div', 'dl-statusbar');
    const countLabel = createElement('div', 'dl-count', '');
    statusBar.appendChild(countLabel);

    const statusRight = createElement('div', 'dl-statusbar-right');

    const densityLabel = createElement('label', 'dl-inline-field');
    densityLabel.appendChild(createElement('span', null, '表示密度'));
    const densitySelect = document.createElement('select');
    densitySelect.className = 'dl-select';
    Object.keys(DL.DENSITY).forEach((key) => {
      const option = document.createElement('option');
      option.value = key;
      option.textContent = DL.DENSITY[key].label;
      densitySelect.appendChild(option);
    });
    densityLabel.appendChild(densitySelect);
    statusRight.appendChild(densityLabel);

    const pageSizeLabel = createElement('label', 'dl-inline-field');
    const pageSizeSelect = document.createElement('select');
    pageSizeSelect.className = 'dl-select';
    DL.PAGE_SIZE_OPTIONS.forEach((size) => {
      const option = document.createElement('option');
      option.value = String(size);
      option.textContent = String(size);
      pageSizeSelect.appendChild(option);
    });
    pageSizeLabel.appendChild(pageSizeSelect);
    pageSizeLabel.appendChild(createElement('span', null, '件 / ページ'));
    statusRight.appendChild(pageSizeLabel);

    statusBar.appendChild(statusRight);
    root.appendChild(statusBar);

    /* -------------------------------------------------- テーブル */
    const scrollArea = createElement('div', 'dl-scroll');
    const table = createElement('table', 'dl-table');
    const colGroup = document.createElement('colgroup');
    const tableHead = document.createElement('thead');
    const tableBody = document.createElement('tbody');
    table.appendChild(colGroup);
    table.appendChild(tableHead);
    table.appendChild(tableBody);
    scrollArea.appendChild(table);
    root.appendChild(scrollArea);

    const emptyState = createElement('div', 'dl-empty', '該当する明細がありません。');
    emptyState.hidden = true;
    root.appendChild(emptyState);

    /* -------------------------------------------------- ページャ */
    const pager = createElement('div', 'dl-pager');
    root.appendChild(pager);

    /* -------------------------------------------------- 全文ポップオーバー */
    const textPopover = createElement('div', 'dl-text-popover');
    textPopover.hidden = true;
    root.appendChild(textPopover);

    /* -------------------------------------------------- ローディング */
    const loading = createElement('div', 'dl-loading');
    const loadingCard = createElement('div', 'dl-loading-card');
    loadingCard.appendChild(createElement('div', 'dl-spinner'));
    const loadingText = createElement('div', 'dl-loading-text', '読み込み中...');
    loadingCard.appendChild(loadingText);
    loading.appendChild(loadingCard);
    loading.hidden = true;
    root.appendChild(loading);

    rootElement.appendChild(root);

    /* ================================================== イベント */

    const notifyQuickSearch = DL.debounce((value) => {
      if (handlers.onQuickSearch) {
        handlers.onQuickSearch(value);
      }
    }, 250);

    searchInput.addEventListener('input', () => {
      notifyQuickSearch(searchInput.value);
    });
    searchClear.addEventListener('click', () => {
      searchInput.value = '';
      if (handlers.onQuickSearch) {
        handlers.onQuickSearch('');
      }
    });
    saveViewButton.addEventListener('click', () => {
      if (!handlers.onSaveView) {
        return;
      }
      const saved = handlers.onSaveView();
      const originalText = 'この表示を覚える';
      saveViewButton.textContent = saved === false ? '保存できませんでした' : '保存しました';
      saveViewButton.classList.toggle('is-error', saved === false);
      window.setTimeout(() => {
        saveViewButton.textContent = originalText;
        saveViewButton.classList.remove('is-error');
      }, 1800);
    });
    resetViewButton.addEventListener('click', () => {
      if (!handlers.onResetView || handlers.onResetView() !== true) {
        return;
      }
      resetViewButton.textContent = '初期表示に戻しました';
      window.setTimeout(() => {
        resetViewButton.textContent = '初期表示に戻す';
      }, 1800);
    });
    filterButton.addEventListener('click', () => {
      if (handlers.onOpenFilterPanel) {
        handlers.onOpenFilterPanel(filterButton);
      }
    });
    columnButton.addEventListener('click', () => {
      if (handlers.onOpenColumnPanel) {
        handlers.onOpenColumnPanel(columnButton);
      }
    });
    csvButton.addEventListener('click', () => {
      if (handlers.onExportCsv) {
        handlers.onExportCsv();
      }
    });
    reloadButton.addEventListener('click', () => {
      if (handlers.onReload) {
        handlers.onReload();
      }
    });
    densitySelect.addEventListener('change', () => {
      if (handlers.onChangeDensity) {
        handlers.onChangeDensity(densitySelect.value);
      }
    });
    pageSizeSelect.addEventListener('change', () => {
      if (handlers.onChangePageSize) {
        handlers.onChangePageSize(Number(pageSizeSelect.value));
      }
    });

    // destroy() でまとめて解除できるよう、document / window へのリスナーを記録しておく
    const globalListeners = [];
    const addGlobalListener = (target, type, handler) => {
      target.addEventListener(type, handler);
      globalListeners.push({ target, type, handler });
    };

    const hideTextPopover = () => {
      textPopover.hidden = true;
    };
    addGlobalListener(document, 'click', (event) => {
      if (!textPopover.hidden && !textPopover.contains(event.target)) {
        hideTextPopover();
      }
    });
    scrollArea.addEventListener('scroll', hideTextPopover);

    /* ================================================== 描画 */

    let currentModel = null;

    const getColumnWidth = (column) => {
      if (column.builtin) {
        return column.defaultWidth;
      }
      const stored = currentModel.columnWidths[column.key];
      return stored && stored >= MIN_COLUMN_WIDTH ? stored : column.defaultWidth;
    };

    // 固定列の left は自分が保持する列幅の累積から求めるため、
    // 画面幅やDOM実測に依存せず横スクロール中も崩れない。
    const computeLeftOffsets = (renderColumns, frozenCount) => {
      const offsets = [];
      let left = 0;
      for (let i = 0; i < frozenCount && i < renderColumns.length; i += 1) {
        offsets[i] = left;
        left += getColumnWidth(renderColumns[i]);
      }
      return offsets;
    };

    const applyStickyOffsets = () => {
      if (!currentModel) {
        return;
      }
      const offsets = computeLeftOffsets(currentModel.renderColumns, currentModel.frozenCount);
      Array.from(table.querySelectorAll('[data-frozen-index]')).forEach((cell) => {
        const index = Number(cell.dataset.frozenIndex);
        cell.style.left = `${offsets[index] || 0}px`;
      });
    };

    // table-layout:fixed で列幅を確定させるため、テーブル全体の幅も列幅の合計で明示する
    const applyTableWidth = () => {
      const total = currentModel.renderColumns.reduce((sum, column) => sum + getColumnWidth(column), 0);
      table.style.width = `${total}px`;
      table.style.minWidth = '100%';
    };

    const renderColGroup = (renderColumns) => {
      colGroup.textContent = '';
      renderColumns.forEach((column) => {
        const col = document.createElement('col');
        col.dataset.key = column.key;
        col.style.width = `${getColumnWidth(column)}px`;
        colGroup.appendChild(col);
      });
      applyTableWidth();
    };

    // 親レコード項目と明細項目の境目が分かるグループヘッダー行を作る。
    // 列順を自由に変更しても壊れないよう、同じ区分が連続する範囲ごとにまとめる。
    const buildGroupRuns = (renderColumns, frozenCount) => {
      const runs = [];
      renderColumns.forEach((column, index) => {
        const last = runs[runs.length - 1];
        // 固定列と横スクロール領域の境目でも分割する。
        // 分割しないと、固定側に追従する見出しがスクロール領域まで覆ってしまう。
        if (last && last.scope === column.scope && index !== frozenCount) {
          last.span += 1;
          return;
        }
        runs.push({ scope: column.scope, span: 1, startIndex: index });
      });
      return runs;
    };

    const renderHead = (model) => {
      tableHead.textContent = '';
      const offsets = computeLeftOffsets(model.renderColumns, model.frozenCount);
      const parentMode = model.listMode === DL.LIST_MODE.PARENT;

      // 親レコード一覧では区分見出しは不要。サブテーブル一覧だけ親／明細の境目を示す。
      if (!parentMode) {
        const groupRow = createElement('tr', 'dl-group-row');
        const groupRuns = buildGroupRuns(model.renderColumns, model.frozenCount);
        groupRuns.forEach((run, runIndex) => {
          const cell = createElement('th', `dl-group-th dl-group-${run.scope === DL.SCOPE.PARENT ? 'parent' : 'table'}`);
          if (runIndex > 0 && groupRuns[runIndex - 1].scope !== run.scope) {
            cell.classList.add('dl-scope-boundary');
          }
          cell.colSpan = run.span;
          cell.textContent = run.scope === DL.SCOPE.PARENT ? '親レコード' : model.tableLabel;
          if (run.startIndex < model.frozenCount) {
            // 境目で分割済みなので、この範囲は必ず固定列の内側に収まる
            cell.classList.add('dl-frozen');
            cell.dataset.frozenIndex = String(run.startIndex);
            cell.style.left = `${offsets[run.startIndex] || 0}px`;
          }
          if (run.startIndex + run.span === model.frozenCount) {
            cell.classList.add('dl-frozen-edge');
          }
          groupRow.appendChild(cell);
        });
        tableHead.appendChild(groupRow);
      }

      const headRow = createElement('tr', 'dl-head-row');
      model.renderColumns.forEach((column, index) => {
        const cell = createElement('th', 'dl-th');
        cell.dataset.key = column.key;
        if (!parentMode && index > 0 && model.renderColumns[index - 1].scope !== column.scope) {
          cell.classList.add('dl-scope-boundary');
        }
        if (index < model.frozenCount) {
          cell.classList.add('dl-frozen');
          cell.dataset.frozenIndex = String(index);
          cell.style.left = `${offsets[index] || 0}px`;
        }
        if (index === model.frozenCount - 1 && model.frozenCount > 0) {
          cell.classList.add('dl-frozen-edge');
        }

        if (column.builtin) {
          cell.classList.add('dl-th-builtin');
          headRow.appendChild(cell);
          return;
        }

        const inner = createElement('button', 'dl-th-inner');
        inner.type = 'button';
        inner.title = `${column.label}（クリックで並び替え / Shift+クリックで複数列）`;
        inner.appendChild(createElement('span', 'dl-th-label', column.label));

        const sortState = DL.findSortState(model.sorts, column.key);
        if (sortState) {
          const mark = createElement('span', 'dl-sort-mark', sortState.dir === 'asc' ? '\u2191' : '\u2193');
          if (sortState.total > 1) {
            mark.appendChild(createElement('span', 'dl-sort-order', String(sortState.order)));
          }
          inner.appendChild(mark);
        }
        inner.addEventListener('click', (event) => {
          if (handlers.onToggleSort) {
            handlers.onToggleSort(column.key, event.shiftKey);
          }
        });
        cell.appendChild(inner);

        if (DL.isFilterableType(column.type)) {
          const menuButton = createElement('button', 'dl-th-menu', '\u25BE');
          menuButton.type = 'button';
          menuButton.title = `${column.label}で絞り込む`;
          if (model.filteredKeys.has(column.key)) {
            menuButton.classList.add('is-active');
          }
          menuButton.addEventListener('click', (event) => {
            event.stopPropagation();
            if (handlers.onOpenColumnFilter) {
              handlers.onOpenColumnFilter(column, menuButton);
            }
          });
          cell.appendChild(menuButton);
        }

        const resizer = createElement('span', 'dl-resizer');
        resizer.dataset.key = column.key;
        resizer.title = 'ドラッグで列幅変更 / ダブルクリックで自動調整';
        cell.appendChild(resizer);

        headRow.appendChild(cell);
      });
      tableHead.appendChild(headRow);
    };

    const buildCellContent = (cell, virtualRow, column, model) => {
      if (column.builtin) {
        const anchor = document.createElement('a');
        anchor.className = 'dl-link-icon';
        anchor.href = `/k/${model.appId}/show#record=${encodeURIComponent(virtualRow.recordId)}`;
        anchor.target = '_blank';
        anchor.rel = 'noopener noreferrer';
        anchor.title = `レコード ${virtualRow.recordId} を別タブで開く`;
        anchor.textContent = '\u2197';
        cell.appendChild(anchor);
        return;
      }

      const field = DL.getCellField(virtualRow, column);
      const text = DL.formatCellText(field, column.type);

      if (column.key === model.linkColumnKey) {
        const anchor = document.createElement('a');
        anchor.className = 'dl-cell-link';
        anchor.href = `/k/${model.appId}/show#record=${encodeURIComponent(virtualRow.recordId)}`;
        anchor.target = '_blank';
        anchor.rel = 'noopener noreferrer';
        anchor.title = `レコード ${virtualRow.recordId} を別タブで開く`;
        anchor.textContent = text;
        cell.appendChild(anchor);
        cell.appendChild(createElement('span', 'dl-cell-link-mark', '\u2197'));
        return;
      }

      cell.textContent = text;
      if (text.length > LONG_TEXT_THRESHOLD) {
        cell.classList.add('dl-td-long');
        cell.title = text;
      }
    };

    const renderBody = (model) => {
      tableBody.textContent = '';
      if (model.pageRows.length === 0) {
        return;
      }

      const offsets = computeLeftOffsets(model.renderColumns, model.frozenCount);
      const fragment = document.createDocumentFragment();
      let previousRecordId = null;

      model.pageRows.forEach((virtualRow) => {
        const row = createElement('tr', 'dl-row');
        row.dataset.virtualRowId = virtualRow.id;
        if (
          model.highlightParentBoundary
          && previousRecordId !== null
          && previousRecordId !== virtualRow.recordId
        ) {
          // 親レコードが切り替わる位置に区切り線を入れる（セル結合はしない）
          row.classList.add('dl-row-parent-start');
        }
        previousRecordId = virtualRow.recordId;

        model.renderColumns.forEach((column, index) => {
          const cell = createElement('td', 'dl-td');
          if (
            model.listMode !== DL.LIST_MODE.PARENT
            && index > 0
            && model.renderColumns[index - 1].scope !== column.scope
          ) {
            cell.classList.add('dl-scope-boundary');
          }
          if (index < model.frozenCount) {
            cell.classList.add('dl-frozen');
            cell.dataset.frozenIndex = String(index);
            cell.style.left = `${offsets[index] || 0}px`;
          }
          if (index === model.frozenCount - 1 && model.frozenCount > 0) {
            cell.classList.add('dl-frozen-edge');
          }
          if (DL.isNumericType(column.type)) {
            cell.classList.add('dl-td-number');
          }
          const colorId = DL.resolveCellColorId(
            column.key,
            virtualRow,
            model.columnMap,
            model.columnColors,
            model.cellColorRules
          );
          if (colorId) {
            cell.dataset.color = colorId;
          }
          buildCellContent(cell, virtualRow, column, model);
          row.appendChild(cell);
        });

        fragment.appendChild(row);
      });

      tableBody.appendChild(fragment);
    };

    const renderChips = (model) => {
      chipsRow.textContent = '';
      const chips = model.chips || [];
      if (chips.length === 0) {
        chipsRow.hidden = true;
        return;
      }
      chipsRow.hidden = false;

      chips.forEach((chip) => {
        const element = createElement('span', 'dl-chip');
        element.appendChild(createElement('span', 'dl-chip-text', chip.label));
        const remove = createElement('button', 'dl-chip-remove', '\u00D7');
        remove.type = 'button';
        remove.title = 'この条件を解除';
        remove.addEventListener('click', () => {
          if (handlers.onRemoveCondition) {
            handlers.onRemoveCondition(chip.id);
          }
        });
        element.appendChild(remove);
        chipsRow.appendChild(element);
      });

      const clearAll = createElement('button', 'dl-chip-clear', 'すべてクリア');
      clearAll.type = 'button';
      clearAll.addEventListener('click', () => {
        if (handlers.onClearConditions) {
          handlers.onClearConditions();
        }
      });
      chipsRow.appendChild(clearAll);
    };

    const renderNotices = (model) => {
      noticeArea.textContent = '';
      (model.notices || []).forEach((notice) => {
        const element = createElement('div', `dl-notice dl-notice-${notice.level || 'info'}`);
        element.appendChild(createElement('span', 'dl-notice-text', notice.message));
        if (notice.retry && handlers.onReload) {
          const retry = createElement('button', 'dl-notice-action', '再試行');
          retry.type = 'button';
          retry.addEventListener('click', () => handlers.onReload());
          element.appendChild(retry);
        }
        noticeArea.appendChild(element);
      });
    };

    const renderPager = (model) => {
      pager.textContent = '';
      if (model.pageCount <= 1) {
        return;
      }

      const createPageButton = (label, page, disabled, isCurrent) => {
        const button = createElement('button', 'dl-page-btn', label);
        button.type = 'button';
        button.disabled = Boolean(disabled);
        if (isCurrent) {
          button.classList.add('is-current');
        }
        if (!disabled && !isCurrent) {
          button.addEventListener('click', () => {
            if (handlers.onChangePage) {
              handlers.onChangePage(page);
            }
          });
        }
        return button;
      };

      pager.appendChild(createPageButton('\u2039', model.page - 1, model.page <= 1, false));

      // 現在ページの前後2ページを表示し、端は先頭・末尾を必ず出す
      const windowSize = 2;
      const pages = new Set([1, model.pageCount]);
      for (let page = model.page - windowSize; page <= model.page + windowSize; page += 1) {
        if (page >= 1 && page <= model.pageCount) {
          pages.add(page);
        }
      }
      const sortedPages = Array.from(pages).sort((a, b) => a - b);
      let previous = 0;
      sortedPages.forEach((page) => {
        if (previous && page - previous > 1) {
          pager.appendChild(createElement('span', 'dl-page-gap', '...'));
        }
        pager.appendChild(createPageButton(String(page), page, false, page === model.page));
        previous = page;
      });

      pager.appendChild(createPageButton('\u203A', model.page + 1, model.page >= model.pageCount, false));
    };

    /* -------------------------------------------------- 列幅変更 */

    let resizeState = null;

    const finishResize = () => {
      if (!resizeState) {
        return;
      }
      const key = resizeState.key;
      const width = resizeState.width;
      resizeState = null;
      document.body.classList.remove('dl-resizing');
      if (handlers.onChangeColumnWidth) {
        handlers.onChangeColumnWidth(key, width);
      }
    };

    const setColumnWidthLive = (key, width) => {
      const col = colGroup.querySelector(`col[data-key="${CSS.escape(key)}"]`);
      if (col) {
        col.style.width = `${width}px`;
      }
      if (currentModel) {
        currentModel.columnWidths[key] = width;
        applyTableWidth();
      }
      applyStickyOffsets();
    };

    tableHead.addEventListener('mousedown', (event) => {
      const resizer = event.target.closest('.dl-resizer');
      if (!resizer) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const key = resizer.dataset.key;
      const column = currentModel.renderColumns.find((item) => item.key === key);
      resizeState = {
        key,
        startX: event.clientX,
        startWidth: column ? getColumnWidth(column) : MIN_COLUMN_WIDTH,
        width: column ? getColumnWidth(column) : MIN_COLUMN_WIDTH
      };
      document.body.classList.add('dl-resizing');
    });

    addGlobalListener(document, 'mousemove', (event) => {
      if (!resizeState) {
        return;
      }
      const next = Math.max(MIN_COLUMN_WIDTH, Math.round(resizeState.startWidth + (event.clientX - resizeState.startX)));
      resizeState.width = next;
      setColumnWidthLive(resizeState.key, next);
    });

    addGlobalListener(document, 'mouseup', finishResize);

    // ダブルクリックで現在ページの内容に合わせた幅へ調整する
    tableHead.addEventListener('dblclick', (event) => {
      const resizer = event.target.closest('.dl-resizer');
      if (!resizer || !currentModel) {
        return;
      }
      event.preventDefault();
      const key = resizer.dataset.key;
      const column = currentModel.renderColumns.find((item) => item.key === key);
      if (!column || column.builtin) {
        return;
      }
      const font = window.getComputedStyle(table).font || '13px sans-serif';
      let widest = measureTextWidth(column.label, font);
      currentModel.pageRows.forEach((virtualRow) => {
        const text = DL.formatCellText(DL.getCellField(virtualRow, column), column.type);
        if (text) {
          widest = Math.max(widest, measureTextWidth(text, font));
        }
      });
      const next = Math.min(MAX_AUTO_WIDTH, Math.max(MIN_COLUMN_WIDTH, Math.ceil(widest) + 40));
      setColumnWidthLive(key, next);
      if (handlers.onChangeColumnWidth) {
        handlers.onChangeColumnWidth(key, next);
      }
    });

    /* -------------------------------------------------- 長文セルの全文表示 */

    tableBody.addEventListener('click', (event) => {
      const cell = event.target.closest('.dl-td-long');
      if (!cell || event.target.closest('a')) {
        return;
      }
      event.stopPropagation();
      textPopover.textContent = cell.title || cell.textContent;
      textPopover.hidden = false;
      const rootRect = root.getBoundingClientRect();
      const cellRect = cell.getBoundingClientRect();
      const left = Math.min(
        Math.max(8, cellRect.left - rootRect.left),
        Math.max(8, root.clientWidth - textPopover.offsetWidth - 8)
      );
      textPopover.style.left = `${left}px`;
      textPopover.style.top = `${cellRect.bottom - rootRect.top + 4}px`;
    });

    // 画面幅が変わっても固定列の位置がずれないよう再適用する
    addGlobalListener(window, 'resize', DL.debounce(applyStickyOffsets, 150));

    /* ================================================== 公開API */

    return {
      root,
      elements: { filterButton, columnButton, searchInput },

      render(model) {
        currentModel = model;
        root.dataset.density = model.density;
        root.dataset.listMode = model.listMode || DL.LIST_MODE.SUBTABLE;
        searchInput.placeholder = model.quickSearchPlaceholder;
        searchInput.disabled = !model.quickSearchEnabled;
        if (document.activeElement !== searchInput && searchInput.value !== model.quick) {
          searchInput.value = model.quick;
        }
        searchClear.hidden = !model.quick;
        densitySelect.value = model.density;
        pageSizeSelect.value = String(model.pageSize);

        const conditionCount = model.chips ? model.chips.length : 0;
        filterBadge.hidden = conditionCount === 0;
        filterBadge.textContent = String(conditionCount);
        filterButton.classList.toggle('is-active', conditionCount > 0);
        columnButton.disabled = model.allColumns.length === 0;
        csvButton.disabled = model.totalCount === 0;

        renderNotices(model);
        renderChips(model);

        countLabel.textContent = model.totalCount > 0
          ? `${model.totalCount.toLocaleString()}件`
          : '0件';

        if (model.renderColumns.length === 0) {
          scrollArea.hidden = true;
          emptyState.hidden = false;
          emptyState.textContent = '表示する列がありません。「表示列」から列を選択してください。';
          pager.textContent = '';
          return;
        }

        scrollArea.hidden = false;
        renderColGroup(model.renderColumns);
        renderHead(model);
        renderBody(model);
        renderPager(model);

        emptyState.hidden = model.pageRows.length > 0;
        if (model.pageRows.length === 0) {
          const parentMode = model.listMode === DL.LIST_MODE.PARENT;
          emptyState.textContent = model.hasAnyRow
            ? (parentMode
              ? '該当するレコードがありません。検索条件を変更してください。'
              : '該当する明細がありません。検索条件を変更してください。')
            : (parentMode
              ? '表示できるレコードがありません。'
              : '表示できる明細がありません。');
        }
        scrollArea.scrollTop = 0;
      },

      showLoading(message) {
        loadingText.textContent = message || '読み込み中...';
        loading.hidden = false;
      },

      hideLoading() {
        loading.hidden = true;
      },

      destroy() {
        globalListeners.forEach(({ target, type, handler }) => target.removeEventListener(type, handler));
        globalListeners.length = 0;
        root.remove();
      }
    };
  };
})(window.SubtableList);
