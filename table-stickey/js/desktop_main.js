((PLUGIN_ID) => {
  'use strict';

  const CLASS_NAMES = {
    scroller: 'table-sticky-scroll',
    table: 'table-sticky-scroll-table'
  };

  const STYLE_ID = 'table-sticky-scroll-style';
  const SCROLL_MARKER = 'tableStickyScroll';
  const SCROLL_SELECTOR = '[data-table-sticky-scroll="1"]';
  const APPLY_DELAYS = [0, 100, 300, 700, 1500];
  const MIN_SCROLL_WIDTH = 320;
  const RESIZE_DEBOUNCE_MS = 200;
  const MUTATION_DEBOUNCE_MS = 150;
  const DEFAULT_SETTING = {
    fixedColumns: 4,
    maxHeight: 500,
    minWidth: 1200,
    rightMargin: 32,
    stickyStopTop: 80
  };

  const Z_INDEX = {
    headerBlock: 10,
    headerScrollable: 11,
    headerFixedCorner: 12,
    bodyFixedColumn: 2,
    bodyNormal: 1
  };

  const EVENTS = [
    'app.record.detail.show',
    'app.record.create.show',
    'app.record.edit.show'
  ];

  const observedContainers = new WeakSet();
  const observedScrollTargets = new WeakSet();
  const settings = loadSettings();

  if (settings.length === 0) {
    return;
  }

  kintone.events.on(EVENTS, (event) => {
    injectStyle();
    settings.forEach(scheduleApplyForSetting);
    return event;
  });

  window.addEventListener('resize', debounce(() => {
    settings.forEach(applyTableBehaviorIfAuthenticated);
  }, RESIZE_DEBOUNCE_MS));

  function loadSettings() {
    const config = kintone.plugin.app.getConfig(PLUGIN_ID) || {};
    const parsedSettings = parseSettings(config);

    if (parsedSettings.length === 0) {
      alert('対象サブテーブルが未設定です。プラグイン設定を確認してください。');
      return [];
    }

    return parsedSettings.map(normalizeSetting);
  }

  function parseSettings(config) {
    if (config.settings) {
      try {
        const parsed = JSON.parse(config.settings);
        if (Array.isArray(parsed)) {
          return parsed.filter((setting) => setting.tableFieldCode);
        }
      } catch (error) {
        console.error('[table sticky] 設定の解析に失敗しました。', error);
      }
    }

    return config.tableFieldCode ? [config] : [];
  }

  function normalizeSetting(config) {
    return {
      tableFieldCode: config.tableFieldCode || '',
      fixedColumns: parseNonNegativeInteger(config.fixedColumns, DEFAULT_SETTING.fixedColumns),
      maxHeight: parsePositiveInteger(config.maxHeight, DEFAULT_SETTING.maxHeight),
      minWidth: parsePositiveInteger(config.minWidth, DEFAULT_SETTING.minWidth),
      rightMargin: parsePositiveInteger(config.rightMargin, DEFAULT_SETTING.rightMargin),
      stickyStopTop: parsePositiveInteger(config.stickyStopTop, DEFAULT_SETTING.stickyStopTop)
    };
  }

  function parsePositiveInteger(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }

  function parseNonNegativeInteger(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  }

  function scheduleApplyForSetting(currentSetting) {
    APPLY_DELAYS.forEach((delay) => {
      setTimeout(() => {
        applyTableBehaviorIfAuthenticated(currentSetting);
      }, delay);
    });
  }

  function applyTableBehaviorIfAuthenticated(currentSetting) {
    if (!window.isAuthenticated || !window.isAuthenticated()) {
      return;
    }

    applyTableBehavior(currentSetting);
  }

  function applyTableBehavior(currentSetting) {
    const context = findTargetContext(currentSetting);

    if (!context?.table || !context.scrollElement) {
      console.warn(`[table sticky] テーブルが見つかりません: ${currentSetting.tableFieldCode}`);
      return;
    }

    unwrapLegacyVerticalScrollContainer(context.scrollElement);
    applyScrollFrame(context.scrollElement, currentSetting);
    applyTableBaseStyle(context.scrollElement, currentSetting);
    updateStickyState(context, currentSetting);
    bindStickyListeners(context, currentSetting);
    observeContainerChanges(context, currentSetting);
  }

  function findTargetContext(currentSetting) {
    const subTableId = findSubTableId(currentSetting.tableFieldCode);
    const subtableElement = subTableId
      ? document.querySelector(`.subtable-${escapeCss(subTableId)}`)
      : null;

    let containerElement = subtableElement;
    let table = null;

    if (subtableElement) {
      table = findBodyTable(subtableElement);
    } else {
      containerElement = getFieldElement(currentSetting.tableFieldCode);
      table = containerElement ? findBodyTable(containerElement) : null;
    }

    if (!containerElement || !table) {
      return null;
    }

    const scrollElement = ensureScrollElement(containerElement, table);

    return {
      containerElement,
      table,
      scrollElement,
      headerCells: getHeaderCells(containerElement, table)
    };
  }

  function findSubTableId(tableFieldCode) {
    try {
      const subTables = cybozu.data.page.FORM_DATA.schema.subTable;
      return Object.keys(subTables).find((id) => {
        return subTables[id].var === tableFieldCode;
      }) || '';
    } catch (error) {
      return '';
    }
  }

  function getFieldElement(tableFieldCode) {
    if (
      kintone.app &&
      kintone.app.record &&
      typeof kintone.app.record.getFieldElement === 'function'
    ) {
      return kintone.app.record.getFieldElement(tableFieldCode);
    }

    return null;
  }

  function findBodyTable(element) {
    if (element.tagName?.toLowerCase() === 'table') {
      return element;
    }

    const tables = Array.from(element.querySelectorAll('table'));
    if (tables.length === 0) {
      return null;
    }

    return tables.reduce((largest, currentTable) => {
      return currentTable.rows.length > largest.rows.length ? currentTable : largest;
    }, tables[0]);
  }

  function findExistingScrollElement(containerElement) {
    return containerElement.querySelector(`${SCROLL_SELECTOR}, [data-table-sticky-table-only-scroll="1"]`);
  }

  function ensureScrollElement(containerElement, bodyTable) {
    const existing = findExistingScrollElement(containerElement);
    if (existing) {
      return existing;
    }

    const headerElement = containerElement.querySelector('.subtable-header-gaia');
    if (!headerElement) {
      return wrapSingleTable(bodyTable);
    }

    const parent = headerElement.parentElement;
    if (!parent) {
      return wrapSingleTable(bodyTable);
    }

    const nodesToWrap = [];
    let currentNode = headerElement;

    while (currentNode) {
      nodesToWrap.push(currentNode);
      if (currentNode.contains(bodyTable)) {
        break;
      }
      currentNode = currentNode.nextElementSibling;
    }

    if (!nodesToWrap.some((node) => node.contains(bodyTable))) {
      return wrapSingleTable(bodyTable);
    }

    const wrapper = createScrollWrapper();
    parent.insertBefore(wrapper, nodesToWrap[0]);
    nodesToWrap.forEach((node) => wrapper.appendChild(node));
    return wrapper;
  }

  function wrapSingleTable(table) {
    const currentParent = table.parentElement;
    if (!currentParent) {
      return table;
    }

    const existing = currentParent.dataset?.[SCROLL_MARKER] === '1' ? currentParent : null;
    if (existing) {
      return existing;
    }

    clearScrollFrame(currentParent);

    const wrapper = createScrollWrapper();
    currentParent.insertBefore(wrapper, table);
    wrapper.appendChild(table);
    return wrapper;
  }

  function createScrollWrapper() {
    const wrapper = document.createElement('div');
    wrapper.dataset[SCROLL_MARKER] = '1';
    return wrapper;
  }

  function clearScrollFrame(element) {
    element.classList.remove(CLASS_NAMES.scroller);
    element.style.width = '';
    element.style.maxWidth = '';
    element.style.maxHeight = '';
  }

  function applyScrollFrame(scrollElement, currentSetting) {
    scrollElement.classList.add(CLASS_NAMES.scroller);
    constrainScrollWidth(scrollElement, currentSetting);
    constrainScrollHeight(scrollElement, currentSetting);
  }

  function applyTableBaseStyle(scrollElement, currentSetting) {
    scrollElement.querySelectorAll('table').forEach((table) => {
      table.classList.add(CLASS_NAMES.table);
      table.style.minWidth = currentSetting.minWidth ? `${currentSetting.minWidth}px` : '';
    });
  }

  function constrainScrollWidth(scrollElement, currentSetting) {
    const rect = scrollElement.getBoundingClientRect();
    const availableWidth = Math.max(
      MIN_SCROLL_WIDTH,
      window.innerWidth - rect.left - currentSetting.rightMargin
    );

    scrollElement.style.width = `${availableWidth}px`;
    scrollElement.style.maxWidth = `${availableWidth}px`;
  }

  function constrainScrollHeight(scrollElement, currentSetting) {
    scrollElement.style.maxHeight = currentSetting.maxHeight ? `${currentSetting.maxHeight}px` : '';
  }

  function unwrapLegacyVerticalScrollContainer(scrollElement) {
    const wrapper = scrollElement.parentElement;
    if (wrapper?.dataset.app347VerticalScroll !== '1') {
      return;
    }

    const parent = wrapper.parentElement;
    if (!parent) {
      return;
    }

    parent.insertBefore(scrollElement, wrapper);
    wrapper.remove();
  }

  function bindStickyListeners(context, currentSetting) {
    if (observedScrollTargets.has(context.scrollElement)) {
      return;
    }

    const update = () => updateStickyState(context, currentSetting);

    window.addEventListener('scroll', update, { passive: true });
    context.scrollElement.addEventListener('scroll', update, { passive: true });

    observedScrollTargets.add(context.scrollElement);
  }

  function updateStickyState(context, currentSetting) {
    const headerCells = getHeaderCells(context.containerElement, context.table);
    context.headerCells = headerCells;

    const rect = context.scrollElement.getBoundingClientRect();
    const shouldStickBody = rect.bottom > currentSetting.stickyStopTop && rect.top < window.innerHeight;
    const leftOffsets = calculateLeftOffsets(headerCells, currentSetting.fixedColumns);

    applyHeaderSticky(context.containerElement, headerCells, currentSetting, leftOffsets);

    getFixedColumnBodyCells(context.table, currentSetting.fixedColumns).forEach(({ cell, index }) => {
      applyBodyStickyCell(cell, shouldStickBody, leftOffsets[index] || 0);
    });
  }

  function applyHeaderBlockStyle(containerElement, headerCells) {
    const headerGaia = containerElement.querySelector('.subtable-header-gaia');
    if (!headerGaia || headerCells.length === 0) {
      return;
    }

    const originalBackground = headerCells[0].dataset.tableStickyOriginalBackground ||
      window.getComputedStyle(headerCells[0]).backgroundColor;
    headerGaia.style.background = originalBackground;
  }

  function applyBodyStickyCell(cell, shouldStick, leftOffset) {
    cell.style.background = '#fff';
    cell.style.backgroundClip = 'padding-box';
    cell.style.left = shouldStick ? `${leftOffset}px` : '';
    cell.style.position = shouldStick ? 'sticky' : '';
    cell.style.top = 'auto';
    cell.style.bottom = 'auto';
    cell.style.transform = '';
    cell.style.willChange = '';
    cell.style.zIndex = shouldStick ? String(Z_INDEX.bodyFixedColumn) : '';
  }

  function applyHeaderSticky(containerElement, headerCells, currentSetting, leftOffsets) {
    headerCells.forEach((cell, index) => {
      const originalBackground = cell.dataset.tableStickyOriginalBackground ||
        window.getComputedStyle(cell).backgroundColor;
      cell.dataset.tableStickyOriginalBackground = originalBackground;

      cell.style.position = 'sticky';
      cell.style.top = '0px';
      cell.style.background = originalBackground;
      cell.style.backgroundClip = 'padding-box';

      if (index < currentSetting.fixedColumns) {
        cell.style.left = `${leftOffsets[index] || 0}px`;
        cell.style.zIndex = String(Z_INDEX.headerFixedCorner);
      } else {
        cell.style.left = '';
        cell.style.zIndex = String(Z_INDEX.headerScrollable);
      }
    });

    applyHeaderBlockStyle(containerElement, headerCells);
  }

  function getFixedColumnBodyCells(table, fixedColumns) {
    return getBodyRows(table).flatMap((row) => {
      return getRowCells(row).slice(0, fixedColumns).map((cell, index) => {
        return { cell, index };
      });
    });
  }

  function getBodyRows(table) {
    if (table.tBodies.length > 0) {
      return Array.from(table.tBodies).flatMap((tbody) => Array.from(tbody.rows));
    }

    return Array.from(table.rows).filter((row) => {
      return !row.closest('thead');
    });
  }

  function getRowCells(row) {
    return Array.from(row.children).filter((child) => {
      const tagName = child.tagName.toLowerCase();
      return tagName === 'th' || tagName === 'td';
    });
  }

  function getHeaderCells(containerElement, table) {
    const headerGaia = containerElement.querySelector('.subtable-header-gaia');
    if (headerGaia) {
      const headerCells = Array.from(headerGaia.querySelectorAll('th'));
      if (headerCells.length > 0) {
        return headerCells;
      }
    }

    return table.tHead ? Array.from(table.tHead.querySelectorAll('th')) : [];
  }

  function calculateLeftOffsets(headerCells, fixedColumns) {
    const offsets = [];
    let left = 0;

    for (let index = 0; index < fixedColumns; index++) {
      offsets[index] = left;
      left += headerCells[index]?.getBoundingClientRect().width || 0;
    }

    return offsets;
  }

  function observeContainerChanges(context, currentSetting) {
    if (observedContainers.has(context.containerElement)) {
      return;
    }

    const observer = new MutationObserver(debounce(() => {
      applyTableBehavior(currentSetting);
    }, MUTATION_DEBOUNCE_MS));

    observer.observe(context.containerElement, {
      childList: true,
      subtree: true
    });

    observedContainers.add(context.containerElement);
  }

  function injectStyle() {
    let style = document.getElementById(STYLE_ID);
    if (!style) {
      style = document.createElement('style');
      style.id = STYLE_ID;
      document.head.appendChild(style);
    }

    style.textContent = `
      .${CLASS_NAMES.scroller} {
        box-sizing: border-box;
        display: block;
        isolation: isolate;
        min-width: 0;
        max-width: 100%;
        position: relative;
        width: 100% !important;
        overflow-x: auto !important;
        overflow-y: auto !important;
        padding-bottom: 8px;
        scrollbar-gutter: stable;
        -webkit-overflow-scrolling: touch;
      }

      .${CLASS_NAMES.scroller} .subtable-header-gaia {
        position: sticky;
        top: 0;
        z-index: ${Z_INDEX.headerBlock};
        background: #fff;
      }

      .${CLASS_NAMES.table} {
        border-collapse: separate !important;
        border-spacing: 0 !important;
        display: table !important;
        max-width: none !important;
        width: auto !important;
      }
    `;
  }

  function escapeCss(value) {
    if (window.CSS?.escape) {
      return window.CSS.escape(value);
    }

    return String(value).replace(/["\\]/g, '\\$&');
  }

  function debounce(callback, delay) {
    let timerId;

    return (...args) => {
      clearTimeout(timerId);
      timerId = setTimeout(() => {
        callback(...args);
      }, delay);
    };
  }
})(kintone.$PLUGIN_ID);
