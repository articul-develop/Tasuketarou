((PLUGIN_ID) => {
  'use strict';

  const STYLE_ID = 'detail-tabs-plugin-style';
  const ROOT_ID = 'detail-tabs-plugin-root';
  const ACTIVE_CLASS = 'detail-tabs-plugin-button-active';
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
    const activeFieldCodes = getTargetFieldCodes(activeTab);
    const allFieldCodes = getAllTargetFieldCodes();
    const parentMap = await getFieldParentGroupMap();

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
    if (recordApi && typeof recordApi.setFieldShown === 'function') {
      recordApi.setFieldShown(fieldCode, isShown);
      return;
    }

    const fieldElement = getFieldElement(recordApi, fieldCode);
    if (!fieldElement) {
      console.warn('[detail tabs] 項目が見つかりません: ' + fieldCode);
      return;
    }

    if (isShown) {
      fieldElement.style.display = fieldElement.dataset.detailTabsPluginOriginalDisplay || '';
      return;
    }

    if (fieldElement.dataset.detailTabsPluginOriginalDisplay === undefined) {
      fieldElement.dataset.detailTabsPluginOriginalDisplay = fieldElement.style.display || '';
    }

    fieldElement.style.display = 'none';
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
    const getFormFields = getFormFieldsApi();

    if (!getFormFields) {
      return map;
    }

    const formFields = await getFormFields();
    appendFieldParentGroups(formFields, map);
    return map;
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
    });
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
