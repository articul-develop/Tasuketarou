((PLUGIN_ID) => {
  'use strict';

  const STYLE_ID = 'detail-tabs-plugin-style';
  const ROOT_ID = 'detail-tabs-plugin-root';
  const ACTIVE_CLASS = 'detail-tabs-plugin-button-active';
  const SPACE_TARGET_PREFIX = 'space:';
  const HR_TARGET_PREFIX = 'hr:';
  const LABEL_TARGET_PREFIX = 'label:';
  const GROUP_CONTAINER_SELECTOR = [
    '.group-gaia',
    '.control-group-field-gaia',
    '.subtable-gaia',
    '.control-subtable-field-gaia',
    '[class*="group-field"]',
    '[class*="subtable-field"]'
  ].join(', ');
  const SPACER_SELECTOR = '.control-spacer-field-gaia, [class*="spacer-field"]';
  const HR_SELECTOR = '.control-hr-field-gaia, [class*="hr-field"]';
  const LABEL_SELECTOR = '.control-label-field-gaia, [class*="label-field"]';
  const APPLY_DELAYS = [0, 100, 300, 700, 1500];
  const TAB_URL_PARAM = 'detailTab';
  const EVENTS = [
    'app.record.detail.show',
    'app.record.create.show',
    'app.record.edit.show',
    'mobile.app.record.detail.show',
    'mobile.app.record.create.show',
    'mobile.app.record.edit.show'
  ];

  let currentSettings = null;
  let hasShownConfigError = false;
  let fieldParentGroupMap = null;
  let fieldParentGroupMapPromise = null;
  let activeTabId = null;
  let currentEventType = '';
  let currentRecordId = '';
  let editHandoffBound = false;
  let editHandoffClickHandler = null;

  kintone.events.on(EVENTS, (event) => {
    const existingRoot = document.getElementById(ROOT_ID);
    if (existingRoot) {
      existingRoot.remove();
    }

    currentSettings = loadSettings();
    if (!currentSettings) {
      return event;
    }

    currentEventType = event.type;
    currentRecordId = getRecordIdFromEvent(event);
    activeTabId = resolveInitialTabId(event.type);

    injectStyle();

    if (isDetailEvent(event.type)) {
      setupEditHandoff();
    }

    scheduleRender(event.type);
    return event;
  });

  function loadSettings() {
    const config = kintone.plugin.app.getConfig(PLUGIN_ID) || {};
    const spaceId = String(config.spaceId || '').trim();
    const tabs = parseTabs(config.tabs);
    const messages = [];

    if (!spaceId) {
      messages.push('・スペースIDが未設定です');
    }
    if (!config.tabs) {
      messages.push('・タブ設定が保存されていません（プラグイン更新後は設定画面で保存し直してください）');
    } else if (tabs.length === 0) {
      messages.push('・有効なタブがありません（タブ名・対象フィールド、または全項目タブの有効設定を確認してください）');
    }

    if (messages.length > 0) {
      console.error('[detail tabs] 設定が未完了です。', {
        spaceId: config.spaceId,
        hasTabs: Boolean(config.tabs),
        tabsRaw: config.tabs,
        parsedTabCount: tabs.length
      });
      if (!hasShownConfigError) {
        hasShownConfigError = true;
        alert(`タブ表示プラグインの設定が未完了です。\n${messages.join('\n')}\n\nプラグイン設定画面で内容を確認し、保存してください。`);
      }
      return null;
    }

    return {
      spaceId,
      tabs
    };
  }

  const ALL_TAB_ID = 'all';

  function isAllTab(tab) {
    return tab.id === ALL_TAB_ID || tab.includeAllTargets === true || tab.includeAllTargets === 'true';
  }

  function parseTabs(rawTabs) {
    if (!rawTabs) {
      return [];
    }

    try {
      let parsed = rawTabs;
      if (typeof rawTabs === 'string') {
        parsed = JSON.parse(rawTabs);
      }
      if (!Array.isArray(parsed)) {
        return [];
      }

      return parsed.map(normalizeTab).filter(isVisibleTab);
    } catch (error) {
      console.error('[detail tabs] 設定の解析に失敗しました。', error, rawTabs);
      return [];
    }
  }

  function isVisibleTab(tab) {
    if (isAllTab(tab) && !tab.enabled) {
      return false;
    }

    return Boolean(String(tab.label || '').trim()) && (isAllTab(tab) || tab.fieldCodes.length > 0);
  }

  function normalizeFieldCodesValue(rawFieldCodes) {
    if (Array.isArray(rawFieldCodes)) {
      return rawFieldCodes.filter(Boolean);
    }

    if (typeof rawFieldCodes === 'string' && rawFieldCodes.trim()) {
      return [rawFieldCodes.trim()];
    }

    return [];
  }

  function normalizeTab(tab) {
    const includeAllTargets = isAllTab(tab);

    const normalized = {
      id: tab.id || `tab_${Math.random().toString(36).slice(2, 8)}`,
      label: String(tab.label || '').trim(),
      color: /^#[0-9a-fA-F]{6}$/.test(tab.color || '') ? tab.color : '#2f80ed',
      fieldCodes: includeAllTargets ? [] : normalizeFieldCodesValue(tab.fieldCodes),
      includeAllTargets
    };

    if (includeAllTargets) {
      normalized.enabled = tab.enabled !== false && tab.enabled !== 'false';
    }

    return normalized;
  }

  function getAppId() {
    if (kintone.app && typeof kintone.app.getId === 'function') {
      return kintone.app.getId();
    }

    if (kintone.mobile && kintone.mobile.app && typeof kintone.mobile.app.getId === 'function') {
      return kintone.mobile.app.getId();
    }

    return '';
  }

  function getRecordIdFromEvent(event) {
    return event?.record?.$id?.value || '';
  }

  function isDetailEvent(eventType) {
    return eventType === 'app.record.detail.show' || eventType === 'mobile.app.record.detail.show';
  }

  function isEditEvent(eventType) {
    return eventType === 'app.record.edit.show' || eventType === 'mobile.app.record.edit.show';
  }

  function isCreateEvent(eventType) {
    return eventType === 'app.record.create.show' || eventType === 'mobile.app.record.create.show';
  }

  function isDetailPage() {
    return /\/show(?:\/|$|\?|#)/.test(location.pathname)
      || (isDetailEvent(currentEventType) && !/\/edit(?:\/|$|\?|#)/.test(location.pathname));
  }

  function readUrlParams() {
    const rawQuery = [
      location.search.replace(/^\?/, ''),
      location.hash.replace(/^#/, '')
    ].filter(Boolean).join('&');

    if (!rawQuery) {
      return new URLSearchParams();
    }

    return new URLSearchParams(rawQuery);
  }

  function buildUrlWithParams(params) {
    const query = params.toString();

    if (!query) {
      return `${location.pathname}${location.search}`;
    }

    if (location.hash || params.has('record')) {
      return `${location.pathname}${location.search}#${query}`;
    }

    return `${location.pathname}?${query}`;
  }

  function readTabIdFromUrl() {
    return readUrlParams().get(TAB_URL_PARAM) || '';
  }

  function writeTabIdToUrl(tabId) {
    if (!tabId) {
      return;
    }

    const params = readUrlParams();
    params.set(TAB_URL_PARAM, tabId);
    history.replaceState(null, '', buildUrlWithParams(params));
  }

  function removeTabIdFromUrl() {
    const params = readUrlParams();

    if (!params.has(TAB_URL_PARAM)) {
      return;
    }

    params.delete(TAB_URL_PARAM);
    history.replaceState(null, '', buildUrlWithParams(params));
  }

  function appendTabIdToUrl(url, tabId) {
    if (!tabId || !url) {
      return url;
    }

    const parsed = new URL(url, location.origin);

    if (parsed.hash) {
      const hashParams = new URLSearchParams(parsed.hash.replace(/^#/, ''));
      hashParams.set(TAB_URL_PARAM, tabId);
      parsed.hash = hashParams.toString();
    } else {
      const searchParams = new URLSearchParams(parsed.search.replace(/^\?/, ''));
      searchParams.set(TAB_URL_PARAM, tabId);
      parsed.search = searchParams.toString() ? `?${searchParams.toString()}` : '';
    }

    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  }

  function buildHandoffStorageKey(recordId) {
    return `detail_tabs_handoff_${PLUGIN_ID}_${getAppId()}_${recordId}`;
  }

  function saveTabHandoffFallback(recordId, tabId) {
    if (!recordId || !tabId) {
      return;
    }

    sessionStorage.setItem(buildHandoffStorageKey(recordId), tabId);
  }

  function readTabHandoffFallback(recordId) {
    if (!recordId) {
      return '';
    }

    return sessionStorage.getItem(buildHandoffStorageKey(recordId)) || '';
  }

  function clearTabHandoffFallback(recordId) {
    if (!recordId) {
      return;
    }

    sessionStorage.removeItem(buildHandoffStorageKey(recordId));
  }

  function isValidTabId(tabId) {
    return Boolean(findTab(tabId));
  }

  function resolveInitialTabId(eventType) {
    const defaultTabId = currentSettings.tabs[0].id;

    if (isCreateEvent(eventType)) {
      return defaultTabId;
    }

    if (isEditEvent(eventType)) {
      const candidate = readTabIdFromUrl() || readTabHandoffFallback(currentRecordId);
      return isValidTabId(candidate) ? candidate : defaultTabId;
    }

    if (isDetailEvent(eventType)) {
      const candidate = readTabIdFromUrl();
      return isValidTabId(candidate) ? candidate : defaultTabId;
    }

    return defaultTabId;
  }

  function resolveTabIdForHandoff() {
    if (activeTabId && isValidTabId(activeTabId)) {
      return activeTabId;
    }

    const fromUrl = readTabIdFromUrl();
    if (isValidTabId(fromUrl)) {
      return fromUrl;
    }

    return currentSettings.tabs[0].id;
  }

  function findEditLink(target) {
    if (!isDetailPage()) {
      return null;
    }

    const toolbarLink = target.closest('.gaia-argoui-app-toolbar-statusmenu-edit a[href*="/edit"]');
    if (toolbarLink) {
      return toolbarLink;
    }

    const link = target.closest('a[href*="/edit"]');
    if (!link) {
      return null;
    }

    const href = link.getAttribute('href') || '';
    if (href.indexOf('/edit') === -1) {
      return null;
    }

    return link;
  }

  function setupEditHandoff() {
    if (editHandoffBound) {
      return;
    }

    editHandoffClickHandler = (clickEvent) => {
      const link = findEditLink(clickEvent.target);
      if (!link) {
        return;
      }

      const tabId = resolveTabIdForHandoff();
      if (!tabId) {
        return;
      }

      clickEvent.preventDefault();
      clickEvent.stopPropagation();

      saveTabHandoffFallback(currentRecordId, tabId);
      location.href = appendTabIdToUrl(link.href, tabId);
    };

    document.addEventListener('click', editHandoffClickHandler, true);
    editHandoffBound = true;
  }

  function scheduleRender(eventType) {
    APPLY_DELAYS.forEach((delay) => {
      setTimeout(() => {
        renderIfAuthenticated(eventType);
      }, delay);
    });
  }

  function renderIfAuthenticated(eventType) {
    if (!currentSettings) {
      return;
    }

    if (!window.isAuthenticated || !window.isAuthenticated()) {
      return;
    }

    if (!document.getElementById(ROOT_ID)) {
      const initialTabId = activeTabId || currentSettings.tabs[0].id;
      renderTabs(eventType, initialTabId);
      return;
    }

    const activeButton = document.querySelector(`.${ACTIVE_CLASS}`);
    const nextActiveTabId = activeButton?.dataset.tabId || activeTabId || currentSettings.tabs[0].id;
    activateTab(eventType, nextActiveTabId);
  }

  function renderTabs(eventType, initialActiveTabId) {
    const recordApi = getRecordApi(eventType);
    const spaceElement = getSpaceElement(recordApi, currentSettings.spaceId);
    if (!spaceElement) {
      console.warn('[detail tabs] スペースが見つかりません: ' + currentSettings.spaceId);
      return;
    }

    const existingRoot = document.getElementById(ROOT_ID);
    if (existingRoot) {
      existingRoot.remove();
    }

    const root = document.createElement('div');
    root.id = ROOT_ID;
    root.className = 'detail-tabs-plugin';

    currentSettings.tabs.forEach((tab) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'detail-tabs-plugin-button';
      button.textContent = tab.label;
      button.dataset.tabId = tab.id;
      button.style.setProperty('--detail-tabs-color', tab.color);
      button.setAttribute('aria-pressed', tab.id === initialActiveTabId ? 'true' : 'false');

      button.addEventListener('click', () => {
        activateTab(eventType, tab.id);
      });

      root.appendChild(button);
    });

    spaceElement.appendChild(root);
    activateTab(eventType, initialActiveTabId);
  }

  async function activateTab(eventType, nextActiveTabId) {
    const recordApi = getRecordApi(eventType);
    if (!recordApi) {
      return;
    }

    activeTabId = nextActiveTabId;
    const activeTab = findTab(nextActiveTabId) || currentSettings.tabs[0];
    const parentMap = await getFieldParentGroupMap();
    const activeFieldCodes = remapFieldCodesToUnit(getTargetFieldCodes(activeTab), parentMap);
    const allFieldCodes = remapFieldCodesToUnit(getAllTargetFieldCodes(), parentMap);

    allFieldCodes.forEach((fieldCode) => {
      if (activeFieldCodes.indexOf(fieldCode) !== -1) {
        showField(recordApi, fieldCode, parentMap);
        return;
      }

      hideField(recordApi, fieldCode);
    });

    updateButtonState(activeTab.id);

    if (isDetailEvent(eventType)) {
      writeTabIdToUrl(activeTab.id);
    }

    if (isEditEvent(eventType)) {
      removeTabIdFromUrl();
      clearTabHandoffFallback(currentRecordId);
    }
  }

  function showField(recordApi, fieldCode, parentMap) {
    setFieldShown(recordApi, fieldCode, true);

    let parentGroupCode = parentMap[fieldCode];
    while (parentGroupCode) {
      openGroup(recordApi, parentGroupCode);
      parentGroupCode = parentMap[parentGroupCode];
    }

    openGroup(recordApi, fieldCode);
  }

  function hideField(recordApi, fieldCode) {
    setFieldShown(recordApi, fieldCode, false);
  }

  function setFieldShown(recordApi, fieldCode, isShown) {
    if (isTabBarSpaceCode(fieldCode)) {
      return;
    }

    if (isLayoutTargetCode(fieldCode)) {
      setLayoutTargetShown(recordApi, fieldCode, isShown);
      return;
    }

    if (recordApi && typeof recordApi.setFieldShown === 'function') {
      recordApi.setFieldShown(fieldCode, isShown);
      return;
    }

    const fieldElement = getFieldElement(recordApi, fieldCode);
    if (!fieldElement) {
      console.warn('[detail tabs] 項目が見つかりません: ' + fieldCode);
      return;
    }

    setElementShown(fieldElement, isShown);
  }

  function isTabBarSpaceCode(fieldCode) {
    const spaceId = currentSettings && currentSettings.spaceId;
    if (!spaceId || !fieldCode) {
      return false;
    }

    return fieldCode === `${SPACE_TARGET_PREFIX}${spaceId}` || fieldCode === spaceId;
  }

  function isLayoutTargetCode(fieldCode) {
    return fieldCode.indexOf(SPACE_TARGET_PREFIX) === 0
      || fieldCode.indexOf(HR_TARGET_PREFIX) === 0
      || fieldCode.indexOf(LABEL_TARGET_PREFIX) === 0;
  }

  function setLayoutTargetShown(recordApi, fieldCode, isShown) {
    const element = getLayoutTargetElement(recordApi, fieldCode);
    if (!element) {
      console.warn('[detail tabs] 項目が見つかりません: ' + fieldCode);
      return;
    }

    setElementShown(getLayoutTargetContainer(element), isShown);
  }

  function setElementShown(element, isShown) {
    if (!element) {
      return;
    }

    if (isShown) {
      element.style.display = element.dataset.detailTabsPluginOriginalDisplay || '';
      return;
    }

    if (element.dataset.detailTabsPluginOriginalDisplay === undefined) {
      element.dataset.detailTabsPluginOriginalDisplay = element.style.display || '';
    }

    element.style.display = 'none';
  }

  function getLayoutTargetElement(recordApi, fieldCode) {
    if (fieldCode.indexOf(SPACE_TARGET_PREFIX) === 0) {
      const key = fieldCode.slice(SPACE_TARGET_PREFIX.length);
      if (key.charAt(0) === '#') {
        const index = Number.parseInt(key.slice(1), 10);
        return getAnonymousTopLevelSpacers()[index] || null;
      }

      return getSpaceElement(recordApi, key) || document.getElementById(key);
    }

    if (fieldCode.indexOf(HR_TARGET_PREFIX) === 0) {
      const key = fieldCode.slice(HR_TARGET_PREFIX.length);
      if (key.charAt(0) === '#') {
        const index = Number.parseInt(key.slice(1), 10);
        return getAnonymousTopLevelHrs()[index] || null;
      }

      return document.getElementById(key) || findTopLevelHrByElementId(key);
    }

    if (fieldCode.indexOf(LABEL_TARGET_PREFIX) === 0) {
      const key = fieldCode.slice(LABEL_TARGET_PREFIX.length);
      if (key.charAt(0) === '#') {
        const index = Number.parseInt(key.slice(1), 10);
        return getAnonymousTopLevelLabels()[index] || null;
      }

      return document.getElementById(key) || findTopLevelLabelByElementId(key);
    }

    return null;
  }

  function getLayoutTargetContainer(element) {
    const control = element.closest(
      '.control-gaia, .control-spacer-field-gaia, .control-hr-field-gaia, .control-label-field-gaia'
    ) || element;
    const row = control.closest('.row-gaia, .kintone-app-row');
    if (!row) {
      return control;
    }

    const controls = row.querySelectorAll(
      '.control-gaia, .control-spacer-field-gaia, .control-hr-field-gaia, .control-label-field-gaia'
    );
    return controls.length <= 1 ? row : control;
  }

  function isInsideGroupOrSubtable(element) {
    return Boolean(element.closest(GROUP_CONTAINER_SELECTOR));
  }

  function isInsidePluginRoot(element) {
    return Boolean(element.closest(`#${ROOT_ID}`));
  }

  function getTopLevelLayoutElements(selector) {
    return Array.from(document.querySelectorAll(selector)).filter((element) => {
      return !isInsideGroupOrSubtable(element) && !isInsidePluginRoot(element);
    });
  }

  function getSpacerElementId(element) {
    const withId = element.id ? element : element.querySelector('[id]');
    return withId && withId.id ? withId.id : '';
  }

  function getAnonymousTopLevelSpacers() {
    return getTopLevelLayoutElements(SPACER_SELECTOR).filter((element) => !getSpacerElementId(element));
  }

  function getAnonymousTopLevelHrs() {
    return getTopLevelLayoutElements(HR_SELECTOR).filter((element) => !element.id && !element.querySelector('[id]'));
  }

  function findTopLevelHrByElementId(elementId) {
    return getTopLevelLayoutElements(HR_SELECTOR).find((element) => {
      return element.id === elementId || Boolean(element.querySelector(`#${cssEscape(elementId)}`));
    }) || null;
  }

  function getAnonymousTopLevelLabels() {
    return getTopLevelLayoutElements(LABEL_SELECTOR).filter((element) => !element.id && !element.querySelector('[id]'));
  }

  function findTopLevelLabelByElementId(elementId) {
    return getTopLevelLayoutElements(LABEL_SELECTOR).find((element) => {
      return element.id === elementId || Boolean(element.querySelector(`#${cssEscape(elementId)}`));
    }) || null;
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === 'function') {
      return window.CSS.escape(value);
    }

    return String(value).replace(/["\\]/g, '\\$&');
  }

  function getFieldParentGroupMap() {
    if (fieldParentGroupMap) {
      return Promise.resolve(fieldParentGroupMap);
    }

    if (fieldParentGroupMapPromise) {
      return fieldParentGroupMapPromise;
    }

    fieldParentGroupMapPromise = buildFieldParentGroupMap()
      .then((map) => {
        fieldParentGroupMap = map;
        return map;
      })
      .catch((error) => {
        console.warn('[detail tabs] フィールド定義の取得に失敗しました。', error);
        fieldParentGroupMap = {};
        return fieldParentGroupMap;
      });

    return fieldParentGroupMapPromise;
  }

  async function buildFieldParentGroupMap() {
    const map = {};
    const getFormLayout = getFormLayoutApi();

    if (getFormLayout) {
      const layout = await getFormLayout();
      const layoutList = Array.isArray(layout) ? layout : (layout && layout.layout) || [];
      appendLayoutParentMap(layoutList, map);
    }

    const getFormFields = getFormFieldsApi();
    if (getFormFields) {
      const formFields = await getFormFields();
      appendFieldParentGroups(formFields, map);
    }

    return map;
  }

  function getFormLayoutApi() {
    if (kintone.app && typeof kintone.app.getFormLayout === 'function') {
      return kintone.app.getFormLayout.bind(kintone.app);
    }

    if (
      kintone.mobile &&
      kintone.mobile.app &&
      typeof kintone.mobile.app.getFormLayout === 'function'
    ) {
      return kintone.mobile.app.getFormLayout.bind(kintone.mobile.app);
    }

    return null;
  }

  function appendLayoutParentMap(layoutList, map, parentCode) {
    (layoutList || []).forEach((item) => {
      if (!item || !item.type) {
        return;
      }

      if (item.type === 'ROW') {
        (item.fields || []).forEach((field) => {
          if (!parentCode) {
            return;
          }

          if (field.code) {
            map[field.code] = parentCode;
          }
          if (field.type === 'SPACER' && field.elementId) {
            map[`${SPACE_TARGET_PREFIX}${field.elementId}`] = parentCode;
          }
          if (field.type === 'HR' && field.elementId) {
            map[`${HR_TARGET_PREFIX}${field.elementId}`] = parentCode;
          }
          if (field.type === 'LABEL' && field.elementId) {
            map[`${LABEL_TARGET_PREFIX}${field.elementId}`] = parentCode;
          }
        });
        return;
      }

      if (item.type === 'GROUP') {
        if (parentCode && item.code) {
          map[item.code] = parentCode;
        }
        appendLayoutParentMap(item.layout, map, item.code);
        return;
      }

      if (item.type === 'SUBTABLE') {
        if (parentCode && item.code) {
          map[item.code] = parentCode;
        }
        (item.fields || []).forEach((field) => {
          if (field.code) {
            map[field.code] = item.code;
          }
        });
      }
    });
  }

  function getFormFieldsApi() {
    if (kintone.app && typeof kintone.app.getFormFields === 'function') {
      return kintone.app.getFormFields.bind(kintone.app);
    }

    if (
      kintone.mobile &&
      kintone.mobile.app &&
      typeof kintone.mobile.app.getFormFields === 'function'
    ) {
      return kintone.mobile.app.getFormFields.bind(kintone.mobile.app);
    }

    return null;
  }

  function appendFieldParentGroups(fields, map, parentGroupCode) {
    if (!fields || typeof fields !== 'object') {
      return;
    }

    Object.keys(fields).forEach((code) => {
      const field = fields[code];
      if (!field || typeof field !== 'object') {
        return;
      }

      if (parentGroupCode) {
        map[code] = parentGroupCode;
      }

      if (field.type === 'GROUP' && field.fields) {
        appendFieldParentGroups(field.fields, map, code);
      }

      if (field.type === 'SUBTABLE' && field.fields) {
        appendFieldParentGroups(field.fields, map, code);
      }
    });
  }

  function remapFieldCodeToUnit(fieldCode, parentMap) {
    const trimmed = String(fieldCode || '').trim();
    if (!trimmed || !parentMap) {
      return trimmed;
    }

    let code = trimmed;
    const seen = new Set();
    while (parentMap[code] && !seen.has(code)) {
      seen.add(code);
      code = parentMap[code];
    }
    return code;
  }

  function remapFieldCodesToUnit(fieldCodes, parentMap) {
    return unique((fieldCodes || []).map((fieldCode) => {
      return remapFieldCodeToUnit(fieldCode, parentMap);
    }).filter(Boolean));
  }

  function updateButtonState(activeTabId) {
    const root = document.getElementById(ROOT_ID);
    if (!root) {
      return;
    }

    Array.from(root.querySelectorAll('.detail-tabs-plugin-button')).forEach((button) => {
      const isActive = button.dataset.tabId === activeTabId;
      button.classList.toggle(ACTIVE_CLASS, isActive);
      button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
  }

  function findTab(tabId) {
    return currentSettings.tabs.find((tab) => tab.id === tabId);
  }

  function getTargetFieldCodes(tab) {
    if (isAllTab(tab)) {
      return getAllTargetFieldCodes();
    }

    return normalizeFieldCodes(tab.fieldCodes);
  }

  function getAllTargetFieldCodes() {
    return unique(
      currentSettings.tabs.filter((tab) => {
        return !isAllTab(tab);
      }).reduce((fieldCodes, tab) => {
        return fieldCodes.concat(normalizeFieldCodes(tab.fieldCodes));
      }, [])
    );
  }

  function normalizeFieldCodes(fieldCodes) {
    if (!Array.isArray(fieldCodes)) {
      return [];
    }

    return fieldCodes.filter((fieldCode) => {
      return typeof fieldCode === 'string' && fieldCode;
    });
  }

  function unique(values) {
    return values.filter((value, index) => values.indexOf(value) === index);
  }

  function openGroup(recordApi, groupFieldCode) {
    if (recordApi && typeof recordApi.setGroupFieldOpen === 'function') {
      try {
        recordApi.setGroupFieldOpen(groupFieldCode, true);
      } catch (error) {
        // グループ以外の項目は開閉APIの対象外のため、表示制御だけ行います。
      }
    }
  }

  function getRecordApi(eventType) {
    if (
      eventType.indexOf('mobile.') === 0 &&
      kintone.mobile &&
      kintone.mobile.app &&
      kintone.mobile.app.record
    ) {
      return kintone.mobile.app.record;
    }

    if (kintone.app && kintone.app.record) {
      return kintone.app.record;
    }

    return null;
  }

  function getSpaceElement(recordApi, spaceId) {
    if (recordApi && typeof recordApi.getSpaceElement === 'function') {
      return recordApi.getSpaceElement(spaceId);
    }

    return null;
  }

  function getFieldElement(recordApi, fieldCode) {
    if (recordApi && typeof recordApi.getFieldElement === 'function') {
      return recordApi.getFieldElement(fieldCode);
    }

    return null;
  }

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) {
      return;
    }

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
      '.detail-tabs-plugin {',
      '  align-items: flex-end;',
      '  border-bottom: 2px solid #d8d8d8;',
      '  box-sizing: border-box;',
      '  display: flex;',
      '  flex-wrap: wrap;',
      '  gap: 4px;',
      '  margin: 0 0 16px;',
      '  width: 100%;',
      '}',
      '.detail-tabs-plugin-button {',
      '  appearance: none;',
      '  background: #fff;',
      '  border: 1px solid var(--detail-tabs-color);',
      '  border-bottom-width: 2px;',
      '  border-radius: 6px 6px 0 0;',
      '  color: var(--detail-tabs-color);',
      '  cursor: pointer;',
      '  font-size: 14px;',
      '  line-height: 1.4;',
      '  margin: 0 0 -2px;',
      '  padding: 8px 18px;',
      '}',
      '.detail-tabs-plugin .detail-tabs-plugin-button:not(.detail-tabs-plugin-button-active):hover {',
      '  background: color-mix(in srgb, var(--detail-tabs-color) 12%, #ffffff);',
      '  color: var(--detail-tabs-color);',
      '}',
      '.detail-tabs-plugin .detail-tabs-plugin-button-active:hover {',
      '  background: var(--detail-tabs-color);',
      '  border-color: var(--detail-tabs-color);',
      '  color: #fff;',
      '  filter: brightness(0.92);',
      '}',
      '.detail-tabs-plugin-button-active {',
      '  background: var(--detail-tabs-color);',
      '  border-color: var(--detail-tabs-color);',
      '  color: #fff;',
      '  font-weight: 700;',
      '}'
    ].join('\n');

    document.head.appendChild(style);
  }
})(kintone.$PLUGIN_ID);
