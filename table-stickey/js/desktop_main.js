((PLUGIN_ID) => {
  'use strict';

  const STYLE_ID = 'table-sticky-scroll-style';
  const SCROLL_SELECTOR = '[data-table-sticky-scroll="1"]';
  const APPLY_DELAYS = [0, 100, 300, 700, 1500];
  const RESIZE_DEBOUNCE_MS = 200;
  const MUTATION_DEBOUNCE_MS = 150;
  const DEFAULT_SETTING = {
    fixedColumns: 4,
    minWidth: 1200,
    rightMargin: 32,
    stickyStopTop: 80
  };

  const Z_INDEX = {
    bodyFixedColumn: 1,
    bodyNormal: 0
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
      fixedColumns: parsePositiveInteger(config.fixedColumns, DEFAULT_SETTING.fixedColumns),
      minWidth: parsePositiveInteger(config.minWidth, DEFAULT_SETTING.minWidth),
      rightMargin: parsePositiveInteger(config.rightMargin, DEFAULT_SETTING.rightMargin),
      stickyStopTop: parsePositiveInteger(config.stickyStopTop, DEFAULT_SETTING.stickyStopTop)
    };
  }

  function parsePositiveInteger(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }

  function scheduleApplyForSetting(currentSetting) {
    APPLY_DELAYS.forEach((delay) => {
      setTimeout(() => {
        applyTableBehaviorIfAuthenticated(currentSetting);
      }, delay);
    });
  }

  async function applyTableBehaviorIfAuthenticated(currentSetting) {
    if (typeof window.whenAuthenticated === 'function') {
      const ok = await window.whenAuthenticated();
      if (!ok) {
        return;
      }
    } else if (!window.isAuthenticated || !window.isAuthenticated()) {
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

  function ensureScrollElement(containerElement, bodyTable) {
    return findNativeScrollElement(containerElement, bodyTable) || bodyTable.parentElement || containerElement;
  }

  function findNativeScrollElement(containerElement, bodyTable) {
    const markedElement = containerElement.querySelector(SCROLL_SELECTOR);
    if (markedElement) {
      return markedElement;
    }

    let currentElement = bodyTable.parentElement;
    while (currentElement && currentElement !== containerElement.parentElement) {
      const overflowX = window.getComputedStyle(currentElement).overflowX;
      if (overflowX === 'auto' || overflowX === 'scroll' || overflowX === 'overlay') {
        return currentElement;
      }
      currentElement = currentElement.parentElement;
    }

    return null;
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
    const topFixedBarBottom = getTopFixedBarBottom() || currentSetting.stickyStopTop;
    const headerGaia = context.containerElement.querySelector('.subtable-header-gaia');
    const headerOverlapsTopBar = doesElementOverlapTopBar(headerGaia, topFixedBarBottom);

    applyHeaderFixedColumns(
      headerCells,
      currentSetting.fixedColumns,
      leftOffsets,
      topFixedBarBottom,
      headerOverlapsTopBar
    );
    applyHeaderRowContainerStyle(headerGaia, headerOverlapsTopBar);

    getFixedColumnBodyCells(context.table, currentSetting.fixedColumns).forEach(({ cell, index }) => {
      applyBodyStickyCell(cell, shouldStickBody, leftOffsets[index] || 0, topFixedBarBottom);
    });
  }

  function applyHeaderFixedColumns(headerCells, fixedColumns, leftOffsets, topFixedBarBottom, headerOverlapsTopBar) {
    headerCells.forEach((cell, index) => {
      if (headerOverlapsTopBar) {
        resetHorizontalStickyCell(cell);
        return;
      }

      if (index < fixedColumns) {
        const originalBackground = cell.dataset.tableStickyOriginalBackground ||
          window.getComputedStyle(cell).backgroundColor;
        cell.dataset.tableStickyOriginalBackground = originalBackground;
        cell.style.background = originalBackground;
        cell.style.backgroundClip = 'padding-box';
        applyHorizontalStickyCell(cell, true, leftOffsets[index] || 0, null, topFixedBarBottom);
        cell.style.top = '';
        return;
      }

      resetHorizontalStickyCell(cell);
    });
  }

  function applyHeaderRowContainerStyle(headerGaia, headerOverlapsTopBar) {
    if (!headerGaia || !headerOverlapsTopBar) {
      return;
    }

    headerGaia.style.position = '';
    headerGaia.style.top = '';
    headerGaia.style.zIndex = '';
  }

  function doesElementOverlapTopBar(element, topFixedBarBottom) {
    if (!element || topFixedBarBottom <= 0) {
      return false;
    }

    const rect = element.getBoundingClientRect();
    return rect.top < topFixedBarBottom && rect.bottom > 0;
  }

  function applyBodyStickyCell(cell, shouldStick, leftOffset, topFixedBarBottom) {
    cell.style.background = '#fff';
    cell.style.backgroundClip = 'padding-box';
    applyHorizontalStickyCell(cell, shouldStick, leftOffset, Z_INDEX.bodyFixedColumn, topFixedBarBottom);
    cell.style.top = 'auto';
    cell.style.bottom = 'auto';
    cell.style.transform = '';
    cell.style.willChange = '';
  }

  function applyHorizontalStickyCell(cell, shouldStick, leftOffset, zIndex, topFixedBarBottom) {
    const cellRect = cell.getBoundingClientRect();
    const overlapsTopBar = topFixedBarBottom > 0 &&
      cellRect.top < topFixedBarBottom &&
      cellRect.bottom > 0;
    const shouldApplySticky = shouldStick && !overlapsTopBar;

    cell.style.left = shouldApplySticky ? `${leftOffset}px` : '';
    cell.style.position = shouldApplySticky ? 'sticky' : '';
    cell.style.zIndex = shouldApplySticky && zIndex != null ? String(zIndex) : '';
  }

  function resetHorizontalStickyCell(cell) {
    cell.style.left = '';
    cell.style.position = '';
    cell.style.top = '';
    cell.style.zIndex = '';
  }

  function getTopFixedBarBottom() {
    const selectors = [
      '.gaia-argoui-app-edit-buttons',
      '.gaia-argoui-app-show-toolbar',
      '.gaia-argoui-app-toolbar',
      '.gaia-argoui-floater',
      '.gaia-argoui-floater-box',
      '.gaia-argoui-floater-float'
    ];
    const bottoms = selectors.flatMap((selector) => {
      return Array.from(document.querySelectorAll(selector)).map((element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        const isTopBar = rect.top <= 8 &&
          rect.bottom > 0 &&
          rect.height >= 24 &&
          (style.position === 'fixed' || style.position === 'sticky' || style.position === 'absolute');
        return isTopBar ? rect.bottom : 0;
      });
    }).filter((bottom) => bottom > 0);

    return bottoms.length > 0 ? Math.ceil(Math.max(...bottoms)) : 0;
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

    style.textContent = '';
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
