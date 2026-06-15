/* ==============================================
 *  Mailer Launch Plugin  – desktop_main.js
 *  レコード詳細画面用（PC / モバイル）
 *  ※モバイルはスペース表示・通常フィールド置換・テーブル行置換に対応（DOM走査）
 * ============================================== */
((PLUGIN_ID) => {
  'use strict';

  const BUTTON_AREA_CLASS = 'openmailer-button-area';
  const STATUS_DIALOG_ID = 'openmailer-status-dialog';
  const PROCESSED_FLAG = 'openmailerProcessed';
  const APPLY_DELAYS = [0, 100, 300, 700, 1500];
  const MOBILE_APPLY_DELAYS = [0, 200, 500, 1000, 2000];
  const EVENTS = [
    'app.record.detail.show',
    'mobile.app.record.detail.show'
  ];

  let hasShownConfigError = false;
  let pendingMobileStatusUpdate = null;
  let mobileStatusResumeTimer = null;

  kintone.events.on(EVENTS, (event) => {
    if (window.isAuthenticated && !window.isAuthenticated()) {
      return event;
    }

    const settingsList = loadSettingsList();
    if (!settingsList || settingsList.length === 0) {
      return event;
    }

    const recordApi = getRecordApi(event.type);
    const isMobile = isMobileEvent(event.type);
    const delays = isMobile ? MOBILE_APPLY_DELAYS : APPLY_DELAYS;

    delays.forEach((delay, index) => {
      setTimeout(() => {
        const isFinalAttempt = index === delays.length - 1;
        settingsList.forEach((settings) => {
          try {
            render(event.record, settings, recordApi, isMobile, isFinalAttempt);
          } catch (error) {
            console.error('[openmailer] 描画エラー', error);
          }
        });
      }, delay);
    });

    return event;
  });

  document.addEventListener('visibilitychange', () => {
    if (!pendingMobileStatusUpdate) {
      return;
    }

    if (document.hidden) {
      pendingMobileStatusUpdate.hasLeftPage = true;
      return;
    }

    schedulePendingMobileStatusUpdate();
  });

  window.addEventListener('pageshow', schedulePendingMobileStatusUpdate);
  window.addEventListener('focus', schedulePendingMobileStatusUpdate);

  function isMobileEvent(eventType) {
    return String(eventType || '').indexOf('mobile.') === 0;
  }

  function getRecordApi(eventType) {
    if (
      isMobileEvent(eventType) &&
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

  function getAppId(isMobile) {
    if (isMobile && kintone.mobile && kintone.mobile.app && typeof kintone.mobile.app.getId === 'function') {
      return kintone.mobile.app.getId();
    }
    return kintone.app.getId();
  }

  function getRecordId(recordApi) {
    if (recordApi && typeof recordApi.getId === 'function') {
      return recordApi.getId();
    }
    return null;
  }

  function loadSettingsList() {
    const config = kintone.plugin.app.getConfig(PLUGIN_ID) || {};
    let rawList = [];

    if (config.settings) {
      try {
        const parsed = JSON.parse(config.settings);
        if (Array.isArray(parsed)) {
          rawList = parsed;
        }
      } catch (error) {
        console.error('[openmailer] 設定の解析に失敗しました。', error);
      }
    } else if (config.displayType) {
      // 旧形式（単一設定）からの移行
      rawList = [config];
    }

    if (rawList.length === 0) {
      showConfigErrorOnce(['・設定が登録されていません']);
      return null;
    }

    const result = [];
    const messages = [];

    rawList.forEach((raw, index) => {
      const normalized = normalizeSetting(raw, index);
      const issues = validateSetting(normalized, index);
      if (issues.length > 0) {
        messages.push(...issues);
        return;
      }
      result.push(normalized);
    });

    if (messages.length > 0) {
      showConfigErrorOnce(messages);
    }

    return result;
  }

  function normalizeSetting(raw, index) {
    const setting = raw || {};
    return {
      id: setting.id || `setting_${index}`,
      displayType: setting.displayType || '',
      spaceElementId: setting.spaceElementId || '',
      addressFieldType: setting.addressFieldType || '',
      toAddressFieldCode: setting.toAddressFieldCode || '',
      tableFieldCode: setting.tableFieldCode || '',
      tableEmailFieldCode: setting.tableEmailFieldCode || '',
      tableEmailFieldLabel: setting.tableEmailFieldLabel || setting.tableEmailFieldCode || '',
      buttonLabel: setting.buttonLabel || 'メール作成',
      allowBlankAddress: setting.allowBlankAddress === true || setting.allowBlankAddress === 'true',
      ccTemplate: setting.ccTemplate || '',
      bccTemplate: setting.bccTemplate || '',
      subjectTemplate: setting.subjectTemplate || '',
      bodyTemplate: setting.bodyTemplate || '',
      manageEnabled: setting.manageEnabled === true || setting.manageEnabled === 'true',
      manageFieldCode: setting.manageFieldCode || '',
      manageValue: setting.manageValue || ''
    };
  }

  function validateSetting(setting, index) {
    const label = `設定 ${index + 1}`;
    const messages = [];

    if (setting.displayType !== 'space' && setting.displayType !== 'field') {
      messages.push(`・${label}: 表示位置タイプが未設定です`);
    } else if (setting.displayType === 'space') {
      if (!setting.spaceElementId) {
        messages.push(`・${label}: スペースフィールド要素IDが未設定です`);
      }
      if (!setting.toAddressFieldCode) {
        messages.push(`・${label}: 宛先メールアドレスフィールドが未設定です`);
      }
    } else if (setting.displayType === 'field') {
      if (setting.addressFieldType === 'normal') {
        if (!setting.toAddressFieldCode) {
          messages.push(`・${label}: メールアドレスフィールドが未設定です`);
        }
      } else if (setting.addressFieldType === 'table') {
        if (!setting.tableFieldCode || !setting.tableEmailFieldCode) {
          messages.push(`・${label}: テーブル／テーブル内メールアドレスフィールドが未設定です`);
        }
      } else {
        messages.push(`・${label}: 対象メールアドレス種別が未設定です`);
      }
    }

    return messages;
  }

  function showConfigErrorOnce(messages) {
    console.error('[openmailer] 設定が未完了です。', messages);
    if (!hasShownConfigError) {
      hasShownConfigError = true;
      alert(`メーラー起動プラグインの設定が未完了です。\n${messages.join('\n')}\n\nプラグイン設定画面で内容を確認し、保存してください。`);
    }
  }

  function render(record, settings, recordApi, isMobile, isFinalAttempt) {
    if (settings.displayType === 'space') {
      renderSpaceButton(record, settings, recordApi, isMobile);
      return;
    }

    if (settings.addressFieldType === 'normal') {
      renderNormalFieldButton(record, settings, recordApi, isMobile);
      return;
    }

    if (settings.addressFieldType === 'table') {
      renderTableButtons(record, settings, recordApi, isMobile, isFinalAttempt);
    }
  }

  // ---------- スペース表示 ----------
  function renderSpaceButton(record, settings, recordApi, isMobile) {
    const space = getSpaceElement(recordApi, settings.spaceElementId);
    if (!space) {
      return;
    }

    const email = getFieldStringValue(record[settings.toAddressFieldCode]);

    removeButtonArea(space, settings.id);

    if (!email && !settings.allowBlankAddress) {
      return;
    }

    const area = createButtonArea(settings.id);
    area.appendChild(createMailButton(record, settings, email, null, null, recordApi, isMobile));
    space.appendChild(area);
  }

  // ---------- 通常フィールド表示 ----------
  function renderNormalFieldButton(record, settings, recordApi, isMobile) {
    const fieldEl = getFieldElement(recordApi, settings.toAddressFieldCode);
    if (!fieldEl) {
      return;
    }

    const email = getFieldStringValue(record[settings.toAddressFieldCode]);

    hideOriginalContentOnce(fieldEl);
    removeButtonArea(fieldEl, settings.id);

    if (!email && !settings.allowBlankAddress) {
      return;
    }

    const area = createButtonArea(settings.id);
    area.appendChild(createMailButton(record, settings, email, null, null, recordApi, isMobile));
    fieldEl.appendChild(area);
  }

  // ---------- テーブル内フィールド表示 ----------
  function renderTableButtons(record, settings, recordApi, isMobile, isFinalAttempt) {
    const tableField = record[settings.tableFieldCode];
    if (!tableField || !Array.isArray(tableField.value)) {
      console.warn('[openmailer] 対象テーブルが見つかりません:', settings.tableFieldCode);
      return;
    }

    const rowCells = findTableRowCells(
      settings.tableFieldCode,
      settings.tableEmailFieldCode,
      settings.tableEmailFieldLabel,
      tableField.value.length,
      isMobile
    );
    const rowTargets = rowCells.map((cell) => {
      return { element: cell, replaceOriginal: true };
    });

    if (rowTargets.length === 0 && isMobile) {
      findMobileTableRowCards(settings.tableFieldCode, tableField.value.length).forEach((card) => {
        rowTargets.push({ element: card, replaceOriginal: false });
      });
    }

    if (rowTargets.length === 0) {
      if (!isFinalAttempt) {
        return;
      }
      console.warn('[openmailer] メールアドレス列が画面上で見つかりませんでした:', {
        tableFieldCode: settings.tableFieldCode,
        tableEmailFieldLabel: settings.tableEmailFieldLabel,
        isMobile
      });
      return;
    }

    rowTargets.forEach((target, rowIndex) => {
      const cell = target.element;
      const rowData = tableField.value[rowIndex];
      if (!cell || !rowData || !rowData.value) {
        return;
      }

      const emailField = rowData.value[settings.tableEmailFieldCode];
      const email = getFieldStringValue(emailField);

      if (target.replaceOriginal) {
        hideOriginalContentOnce(cell);
      }
      removeButtonArea(cell, settings.id);

      if (!email && !settings.allowBlankAddress) {
        return;
      }

      const area = createButtonArea(settings.id);
      if (!target.replaceOriginal) {
        area.style.display = 'block';
        area.style.margin = '10px 0 0';
      }
      area.appendChild(createMailButton(record, settings, email, rowData.value, rowIndex, recordApi, isMobile));
      cell.appendChild(area);
    });
  }

  // ---------- ボタン生成 ----------
  function createButtonArea(settingId) {
    const area = document.createElement('div');
    area.className = BUTTON_AREA_CLASS;
    area.style.display = 'inline-block';
    area.style.margin = '2px 6px 2px 0';
    area.dataset.openmailerSetting = settingId || '';
    return area;
  }

  function createMailButton(record, settings, email, rowValue, rowIndex, recordApi, isMobile) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'openmailer-button';
    button.textContent = settings.buttonLabel;

    button.style.padding = '6px 14px';
    button.style.border = '1px solid #c8d6ea';
    button.style.borderRadius = '6px';
    button.style.background = '#f5f8ff';
    button.style.color = '#1f55b5';
    button.style.fontWeight = '700';
    button.style.cursor = 'pointer';

    button.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();

      const subject = applyTemplate(settings.subjectTemplate, record, rowValue);
      const body = applyTemplate(settings.bodyTemplate, record, rowValue);
      const cc = applyTemplate(settings.ccTemplate, record, rowValue);
      const bcc = applyTemplate(settings.bccTemplate, record, rowValue);

      let mailtoUrl = `mailto:${email || ''}`;
      const params = [];
      if (cc) {
        params.push(`cc=${encodeURIComponent(cc)}`);
      }
      if (bcc) {
        params.push(`bcc=${encodeURIComponent(bcc)}`);
      }
      if (subject) {
        params.push(`subject=${encodeURIComponent(subject)}`);
      }
      if (body) {
        params.push(`body=${encodeURIComponent(body)}`);
      }
      if (params.length > 0) {
        mailtoUrl += `?${params.join('&')}`;
      }

      if (isMobile && settings.manageEnabled && settings.manageFieldCode) {
        pendingMobileStatusUpdate = {
          record,
          settings,
          rowIndex,
          recordApi,
          isMobile,
          hasLeftPage: false,
          openedAt: Date.now()
        };
        window.setTimeout(schedulePendingMobileStatusUpdate, 2500);
      }

      window.location.href = mailtoUrl;

      if (settings.manageEnabled && settings.manageFieldCode) {
        if (isMobile) {
          return;
        }
        confirmAndMarkAsSent(record, settings, rowIndex, recordApi, isMobile);
      }
    });

    return button;
  }

  function schedulePendingMobileStatusUpdate() {
    if (!pendingMobileStatusUpdate || document.hidden) {
      return;
    }

    if (mobileStatusResumeTimer) {
      window.clearTimeout(mobileStatusResumeTimer);
    }

    mobileStatusResumeTimer = window.setTimeout(() => {
      const pending = pendingMobileStatusUpdate;
      if (!pending || document.hidden) {
        return;
      }

      const elapsed = Date.now() - pending.openedAt;
      if (!pending.hasLeftPage && elapsed < 2000) {
        return;
      }

      pendingMobileStatusUpdate = null;
      confirmAndMarkAsSent(
        pending.record,
        pending.settings,
        pending.rowIndex,
        pending.recordApi,
        pending.isMobile
      );
    }, 600);
  }

  function confirmAndMarkAsSent(record, settings, rowIndex, recordApi, isMobile) {
    showStatusConfirmDialog()
      .then((confirmed) => {
        if (!confirmed) {
          return null;
        }
        return markAsSent(record, settings, rowIndex, recordApi, isMobile)
          .then(() => {
            return showStatusMessageDialog('更新しました', '送信済みに更新しました。')
              .then(() => {
                window.location.reload();
              });
          })
          .catch((error) => {
            console.error('[openmailer] 送信済み更新エラー', error);
            return showStatusMessageDialog(
              '更新に失敗しました',
              '送信済みの更新に失敗しました。\n権限や設定内容をご確認ください。'
            );
          });
      });
  }

  function showStatusConfirmDialog() {
    return showStatusDialog({
      title: '送信済み更新',
      message: 'このメールを送信済みにしますか？',
      primaryLabel: '送信済みにする',
      secondaryLabel: 'キャンセル'
    });
  }

  function showStatusMessageDialog(title, message) {
    return showStatusDialog({
      title,
      message,
      primaryLabel: 'OK',
      secondaryLabel: ''
    });
  }

  function showStatusDialog(options) {
    return new Promise((resolve) => {
      const existing = document.getElementById(STATUS_DIALOG_ID);
      if (existing) {
        existing.remove();
      }

      const overlay = document.createElement('div');
      overlay.id = STATUS_DIALOG_ID;
      overlay.style.position = 'fixed';
      overlay.style.inset = '0';
      overlay.style.zIndex = '999999';
      overlay.style.display = 'flex';
      overlay.style.alignItems = 'center';
      overlay.style.justifyContent = 'center';
      overlay.style.padding = '24px';
      overlay.style.background = 'rgba(0, 0, 0, 0.35)';

      const panel = document.createElement('div');
      panel.style.boxSizing = 'border-box';
      panel.style.width = '100%';
      panel.style.maxWidth = '360px';
      panel.style.padding = '20px';
      panel.style.borderRadius = '10px';
      panel.style.background = '#fff';
      panel.style.boxShadow = '0 8px 24px rgba(0, 0, 0, 0.2)';
      panel.style.color = '#222';

      const title = document.createElement('div');
      title.textContent = options.title || '';
      title.style.margin = '0 0 10px';
      title.style.fontSize = '16px';
      title.style.fontWeight = '700';

      const message = document.createElement('div');
      message.textContent = options.message || '';
      message.style.margin = '0 0 18px';
      message.style.fontSize = '14px';
      message.style.lineHeight = '1.6';
      message.style.whiteSpace = 'pre-line';

      const actions = document.createElement('div');
      actions.style.display = 'flex';
      actions.style.justifyContent = 'flex-end';
      actions.style.gap = '10px';

      const close = (result) => {
        overlay.remove();
        resolve(result);
      };

      if (options.secondaryLabel) {
        const secondary = document.createElement('button');
        secondary.type = 'button';
        secondary.textContent = options.secondaryLabel;
        secondary.style.padding = '8px 14px';
        secondary.style.border = '1px solid #c8d6ea';
        secondary.style.borderRadius = '6px';
        secondary.style.background = '#fff';
        secondary.style.color = '#1f55b5';
        secondary.addEventListener('click', () => close(false));
        actions.appendChild(secondary);
      }

      const primary = document.createElement('button');
      primary.type = 'button';
      primary.textContent = options.primaryLabel || 'OK';
      primary.style.padding = '8px 14px';
      primary.style.border = '1px solid #1f55b5';
      primary.style.borderRadius = '6px';
      primary.style.background = '#1f55b5';
      primary.style.color = '#fff';
      primary.style.fontWeight = '700';
      primary.addEventListener('click', () => close(true));
      actions.appendChild(primary);

      panel.appendChild(title);
      panel.appendChild(message);
      panel.appendChild(actions);
      overlay.appendChild(panel);
      document.body.appendChild(overlay);
      primary.focus();
    });
  }

  // ---------- メール送信管理（送信済み更新） ----------
  function markAsSent(record, settings, rowIndex, recordApi, isMobile) {
    const appId = getAppId(isMobile);
    const recordId = getRecordId(recordApi);

    if (!recordId) {
      return Promise.reject(new Error('レコードIDを取得できませんでした。'));
    }

    const body = { app: appId, id: recordId, record: {} };
    const tableField = record[settings.tableFieldCode];
    const isTableManageField =
      settings.displayType === 'field' &&
      settings.addressFieldType === 'table' &&
      rowIndex != null &&
      tableField &&
      Array.isArray(tableField.value) &&
      tableField.value[rowIndex] &&
      tableField.value[rowIndex].value &&
      Object.prototype.hasOwnProperty.call(tableField.value[rowIndex].value, settings.manageFieldCode);

    if (isTableManageField) {
      const targetType = tableField.value[rowIndex].value[settings.manageFieldCode].type;
      const newValue = tableField.value.map((row, index) => {
        if (index === rowIndex) {
          return {
            id: row.id,
            value: {
              [settings.manageFieldCode]: { value: computeManageValue(targetType, settings.manageValue) }
            }
          };
        }
        return { id: row.id };
      });
      body.record[settings.tableFieldCode] = { value: newValue };
    } else {
      const targetType = record[settings.manageFieldCode] ? record[settings.manageFieldCode].type : '';
      body.record[settings.manageFieldCode] = { value: computeManageValue(targetType, settings.manageValue) };
    }

    return kintone.api(kintone.api.url('/k/v1/record.json', true), 'PUT', body);
  }

  function computeManageValue(fieldType, rawValue) {
    if (fieldType === 'CHECK_BOX' || fieldType === 'MULTI_SELECT') {
      return rawValue ? [rawValue] : [];
    }
    return rawValue;
  }

  // ---------- テンプレート差し込み ----------
  function applyTemplate(template, record, rowValue) {
    return String(template || '').replace(/\{([^{}]+)\}/g, (match, rawCode) => {
      const code = rawCode.trim();

      if (rowValue && Object.prototype.hasOwnProperty.call(rowValue, code)) {
        return getFieldStringValue(rowValue[code]);
      }
      if (record && Object.prototype.hasOwnProperty.call(record, code)) {
        return getFieldStringValue(record[code]);
      }
      return '';
    });
  }

  function getFieldStringValue(field) {
    if (!field || field.value == null) {
      return '';
    }
    const value = field.value;

    if (Array.isArray(value)) {
      return value
        .map((item) => {
          if (item == null) {
            return '';
          }
          if (typeof item === 'object') {
            return item.name || item.code || item.value || '';
          }
          return String(item);
        })
        .filter(Boolean)
        .join(', ');
    }

    if (typeof value === 'object') {
      return value.name || value.code || '';
    }

    return String(value);
  }

  // ---------- DOM ヘルパー ----------
  function getSpaceElement(recordApi, spaceId) {
    if (!recordApi || typeof recordApi.getSpaceElement !== 'function') {
      return null;
    }
    try {
      return recordApi.getSpaceElement(spaceId);
    } catch (error) {
      return null;
    }
  }

  function getFieldElement(recordApi, fieldCode) {
    if (!recordApi || typeof recordApi.getFieldElement !== 'function') {
      return findFieldElementByDom(fieldCode);
    }
    try {
      return recordApi.getFieldElement(fieldCode) || findFieldElementByDom(fieldCode);
    } catch (error) {
      return findFieldElementByDom(fieldCode);
    }
  }

  function findFieldElementByDom(fieldCode) {
    if (!fieldCode) {
      return null;
    }

    const byCode = document.querySelector(`[data-field-code="${escapeAttributeValue(fieldCode)}"]`);
    if (byCode) {
      return getReplaceTargetElement(byCode);
    }

    const fieldId = findFieldClassId(fieldCode);
    if (!fieldId) {
      return null;
    }

    const escapedId = escapeCss(fieldId);
    return document.querySelector(
      `.field-${escapedId}, .value-${escapedId}, .control-${escapedId}`
    );
  }

  function getReplaceTargetElement(element) {
    return element.closest(
      '.control-value-gaia, .control-gaia, .field-gaia, .row-gaia, td, li'
    ) || element.parentElement || element;
  }

  function findFieldClassId(fieldCode) {
    const schema = getFormSchema();
    const visited = new WeakSet();

    function search(node) {
      if (!node || typeof node !== 'object') {
        return '';
      }
      if (visited.has(node)) {
        return '';
      }
      visited.add(node);

      if ((node.var === fieldCode || node.code === fieldCode) && node.id != null) {
        return String(node.id);
      }

      return Object.keys(node).reduce((found, key) => {
        return found || search(node[key]);
      }, '');
    }

    return search(schema);
  }

  function getFormSchema() {
    try {
      return cybozu.data?.page?.FORM_DATA?.schema || null;
    } catch (error) {
      return null;
    }
  }

  function escapeAttributeValue(value) {
    return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  function escapeCss(value) {
    if (window.CSS && typeof window.CSS.escape === 'function') {
      return window.CSS.escape(String(value));
    }
    return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
  }

  function hideOriginalContentOnce(el) {
    if (el.dataset[PROCESSED_FLAG]) {
      return;
    }
    Array.from(el.childNodes).forEach((node) => {
      if (node.nodeType === Node.ELEMENT_NODE) {
        if (!node.classList || !node.classList.contains(BUTTON_AREA_CLASS)) {
          node.style.display = 'none';
        }
      } else if (node.nodeType === Node.TEXT_NODE) {
        node.textContent = '';
      }
    });
    el.dataset[PROCESSED_FLAG] = '1';
  }

  function removeButtonArea(el, settingId) {
    const areas = Array.from(el.querySelectorAll(`:scope > .${BUTTON_AREA_CLASS}`));
    areas.forEach((area) => {
      if ((area.dataset.openmailerSetting || '') === (settingId || '')) {
        area.remove();
      }
    });
  }

  function findSubTableId(tableFieldCode) {
    try {
      const subTables = cybozu.data?.page?.FORM_DATA?.schema?.subTable;
      if (!subTables) {
        return '';
      }
      return Object.keys(subTables).find((id) => {
        return subTables[id].var === tableFieldCode || subTables[id].code === tableFieldCode;
      }) || '';
    } catch (error) {
      return '';
    }
  }

  function getSubtableContainer(tableFieldCode) {
    const subTableId = findSubTableId(tableFieldCode);
    if (subTableId) {
      const byClass = document.querySelector(`.subtable-${escapeCss(subTableId)}`);
      if (byClass) {
        return byClass;
      }
    }

    return document.querySelector(`[data-field-code="${escapeAttributeValue(tableFieldCode)}"]`) ||
      findFieldElementByDom(tableFieldCode);
  }

  function findTableRowCells(tableFieldCode, emailFieldCode, columnLabel, expectedRowCount, isMobile) {
    const container = getSubtableContainer(tableFieldCode);
    if (container) {
      const scopedCells = findCellsInSubtableContainer(
        container,
        tableFieldCode,
        columnLabel,
        emailFieldCode,
        expectedRowCount,
        isMobile
      );
      if (scopedCells.length > 0) {
        return scopedCells;
      }
    }

    if (isMobile) {
      const innerFieldId = findInnerFieldClassId(tableFieldCode, emailFieldCode);
      const mobileFallbackCells = findCellsByDirectFieldQuery(
        document,
        emailFieldCode,
        expectedRowCount,
        innerFieldId
      );
      if (mobileFallbackCells.length > 0) {
        return mobileFallbackCells;
      }
    }

    const tableInfo = findTableByColumnLabel(columnLabel);
    if (!tableInfo) {
      return [];
    }

    const bodyRows = Array.from(tableInfo.tableElement.querySelectorAll('tbody tr'))
      .filter((tr) => !tr.querySelector('th') && tr.children.length > tableInfo.columnIndex);

    return bodyRows
      .map((tr) => tr.children[tableInfo.columnIndex])
      .filter(Boolean)
      .slice(0, expectedRowCount);
  }

  function findMobileTableRowCards(tableFieldCode, expectedRowCount) {
    const container = getSubtableContainer(tableFieldCode);
    if (!container) {
      return [];
    }

    const cardSelectors = [
      '.subtable-row-gaia',
      '[class*="subtable-row"]',
      '[class*="subtableRow"]',
      '[data-row-id]'
    ];

    for (const selector of cardSelectors) {
      const cards = uniqueElements(Array.from(container.querySelectorAll(selector)))
        .filter(isVisibleElement)
        .filter((element) => !element.querySelector('th'));
      if (cards.length >= expectedRowCount) {
        return cards.slice(0, expectedRowCount);
      }
    }

    const directCards = Array.from(container.children)
      .filter(isVisibleElement)
      .filter((element) => {
        const tagName = element.tagName?.toLowerCase();
        if (tagName === 'table' || tagName === 'thead' || tagName === 'tbody') {
          return false;
        }
        if (element.querySelector('th')) {
          return false;
        }
        return normalizeText(element.textContent).length > 0;
      });

    if (directCards.length >= expectedRowCount) {
      return directCards.slice(0, expectedRowCount);
    }

    return [];
  }

  function findInnerFieldClassId(tableFieldCode, emailFieldCode) {
    try {
      const subTableId = findSubTableId(tableFieldCode);
      const subTables = cybozu.data?.page?.FORM_DATA?.schema?.subTable;
      if (!subTableId || !subTables?.[subTableId]?.fields) {
        return '';
      }
      const fields = subTables[subTableId].fields;
      const entry = Object.values(fields).find((field) => {
        return field.var === emailFieldCode || field.code === emailFieldCode;
      });
      return entry?.id ? String(entry.id) : '';
    } catch (error) {
      return '';
    }
  }

  function findCellsInSubtableContainer(container, tableFieldCode, columnLabel, emailFieldCode, expectedRowCount, isMobile) {
    if (isMobile && emailFieldCode) {
      const innerFieldId = findInnerFieldClassId(tableFieldCode, emailFieldCode);
      const cellsByDirectQuery = findCellsByDirectFieldQuery(
        container,
        emailFieldCode,
        expectedRowCount,
        innerFieldId
      );
      if (cellsByDirectQuery.length > 0) {
        return cellsByDirectQuery;
      }

      const cellsByFieldCode = findCellsByFieldCodeInRows(
        container,
        emailFieldCode,
        expectedRowCount,
        innerFieldId
      );
      if (cellsByFieldCode.length > 0) {
        return cellsByFieldCode;
      }
    }

    const columnIndex = findColumnIndexInContainer(container, columnLabel);
    if (columnIndex < 0) {
      const innerFieldId = findInnerFieldClassId(tableFieldCode, emailFieldCode);
      return findCellsByDirectFieldQuery(container, emailFieldCode, expectedRowCount, innerFieldId)
        .concat(findCellsByFieldCodeInRows(container, emailFieldCode, expectedRowCount, innerFieldId))
        .filter((element, index, list) => list.indexOf(element) === index)
        .slice(0, expectedRowCount);
    }

    const bodyRows = findBodyRowsInContainer(container);
    return bodyRows
      .filter((tr) => tr.children.length > columnIndex)
      .map((tr) => tr.children[columnIndex])
      .filter(Boolean)
      .slice(0, expectedRowCount);
  }

  function findCellsByDirectFieldQuery(container, emailFieldCode, expectedRowCount, innerFieldId) {
    const selectors = [];
    if (innerFieldId) {
      const escapedId = escapeCss(innerFieldId);
      selectors.push(`.value-${escapedId}`);
      selectors.push(`.control-${escapedId}`);
      selectors.push(`.field-${escapedId}`);
    }
    if (emailFieldCode) {
      selectors.push(`[data-field-code="${escapeAttributeValue(emailFieldCode)}"]`);
    }

    for (const selector of selectors) {
      const cells = uniqueElements(
        Array.from(container.querySelectorAll(selector))
          .map(getTableReplaceTargetElement)
          .filter(Boolean)
      );

      if (cells.length > 0) {
        return cells.slice(0, expectedRowCount);
      }
    }

    return [];
  }

  function findCellsByFieldCodeInRows(container, emailFieldCode, expectedRowCount, innerFieldId) {
    const rowSelectors = [
      '.subtable-row-gaia tbody tr',
      '.subtable-row-gaia tr',
      'table tbody tr'
    ];

    for (const selector of rowSelectors) {
      const rows = Array.from(container.querySelectorAll(selector)).filter((tr) => !tr.querySelector('th'));
      if (rows.length === 0) {
        continue;
      }

      const cells = rows.map((row) => {
        if (innerFieldId) {
          const escapedId = escapeCss(innerFieldId);
          const byClass = row.querySelector(`.value-${escapedId}, .control-${escapedId}, .field-${escapedId}`);
          if (byClass) {
            return getTableReplaceTargetElement(byClass);
          }
        }
        const byCode = row.querySelector(`[data-field-code="${escapeAttributeValue(emailFieldCode)}"]`);
        if (byCode) {
          return getTableReplaceTargetElement(byCode);
        }
        return null;
      }).filter(Boolean);

      if (cells.length > 0) {
        return cells.slice(0, expectedRowCount);
      }
    }

    return [];
  }

  function getTableReplaceTargetElement(element) {
    return element.closest(
      '.control-value-gaia, .control-gaia, .subtable-cell-gaia, td'
    ) || element;
  }

  function uniqueElements(elements) {
    return elements.filter((element, index, list) => list.indexOf(element) === index);
  }

  function isVisibleElement(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) {
      return false;
    }
    const style = window.getComputedStyle(element);
    return style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      element.offsetParent !== null;
  }

  function findColumnIndexInContainer(container, columnLabel) {
    const normalizedLabel = normalizeText(columnLabel);
    if (!normalizedLabel) {
      return -1;
    }

    const headerSelectors = [
      '.subtable-header-gaia th',
      '.subtable-header-gaia thead th',
      'thead th'
    ];

    for (const selector of headerSelectors) {
      const headerCells = Array.from(container.querySelectorAll(selector));
      const columnIndex = headerCells.findIndex((th) => {
        return normalizeText(th.textContent).includes(normalizedLabel);
      });
      if (columnIndex !== -1) {
        return columnIndex;
      }
    }

    const tables = Array.from(container.querySelectorAll('table'));
    for (const table of tables) {
      const headerCells = Array.from(table.querySelectorAll('thead th, tr:first-child th'));
      const columnIndex = headerCells.findIndex((th) => {
        return normalizeText(th.textContent).includes(normalizedLabel);
      });
      if (columnIndex !== -1) {
        return columnIndex;
      }
    }

    return -1;
  }

  function findBodyRowsInContainer(container) {
    const rowSelectors = [
      '.subtable-row-gaia tbody tr',
      '.subtable-row-gaia tr',
      'table tbody tr'
    ];

    for (const selector of rowSelectors) {
      const rows = Array.from(container.querySelectorAll(selector)).filter((tr) => !tr.querySelector('th'));
      if (rows.length > 0) {
        return rows;
      }
    }

    return [];
  }

  function findTableByColumnLabel(label) {
    const normalizedLabel = normalizeText(label);
    if (!normalizedLabel) {
      return null;
    }
    const tables = Array.from(document.querySelectorAll('table'));

    for (const table of tables) {
      const headerCells = Array.from(table.querySelectorAll('thead th, tr:first-child th'));
      const columnIndex = headerCells.findIndex((th) => {
        return normalizeText(th.textContent).includes(normalizedLabel);
      });

      if (columnIndex !== -1) {
        return { tableElement: table, columnIndex };
      }
    }

    return null;
  }

  function normalizeText(text) {
    return String(text || '').replace(/\s/g, '');
  }
})(kintone.$PLUGIN_ID);
