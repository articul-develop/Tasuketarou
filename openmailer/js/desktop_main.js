/* ==============================================
 *  Mailer Launch Plugin  – desktop_main.js
 *  レコード詳細画面用
 * ============================================== */
((PLUGIN_ID) => {
  'use strict';

  const BUTTON_AREA_CLASS = 'openmailer-button-area';
  const PROCESSED_FLAG = 'openmailerProcessed';
  const APPLY_DELAYS = [0, 100, 300, 700, 1500];
  const EVENTS = [
    'app.record.detail.show',
    'mobile.app.record.detail.show'
  ];

  let hasShownConfigError = false;

  kintone.events.on(EVENTS, (event) => {
    if (window.isAuthenticated && !window.isAuthenticated()) {
      return event;
    }

    const settingsList = loadSettingsList();
    if (!settingsList || settingsList.length === 0) {
      return event;
    }

    APPLY_DELAYS.forEach((delay) => {
      setTimeout(() => {
        settingsList.forEach((settings) => {
          try {
            render(event.record, settings);
          } catch (error) {
            console.error('[openmailer] 描画エラー', error);
          }
        });
      }, delay);
    });

    return event;
  });

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

  function render(record, settings) {
    if (settings.displayType === 'space') {
      renderSpaceButton(record, settings);
      return;
    }

    if (settings.addressFieldType === 'normal') {
      renderNormalFieldButton(record, settings);
      return;
    }

    if (settings.addressFieldType === 'table') {
      renderTableButtons(record, settings);
    }
  }

  // ---------- スペース表示 ----------
  function renderSpaceButton(record, settings) {
    const space = getSpaceElement(settings.spaceElementId);
    if (!space) {
      return;
    }

    const email = getFieldStringValue(record[settings.toAddressFieldCode]);

    removeButtonArea(space, settings.id);

    if (!email) {
      return;
    }

    const area = createButtonArea(settings.id);
    area.appendChild(createMailButton(record, settings, email, null, null));
    space.appendChild(area);
  }

  // ---------- 通常フィールド表示 ----------
  function renderNormalFieldButton(record, settings) {
    const fieldEl = getFieldElement(settings.toAddressFieldCode);
    if (!fieldEl) {
      return;
    }

    const email = getFieldStringValue(record[settings.toAddressFieldCode]);

    hideOriginalContentOnce(fieldEl);
    removeButtonArea(fieldEl, settings.id);

    if (!email) {
      return;
    }

    const area = createButtonArea(settings.id);
    area.appendChild(createMailButton(record, settings, email, null, null));
    fieldEl.appendChild(area);
  }

  // ---------- テーブル内フィールド表示 ----------
  function renderTableButtons(record, settings) {
    const tableField = record[settings.tableFieldCode];
    if (!tableField || !Array.isArray(tableField.value)) {
      console.warn('[openmailer] 対象テーブルが見つかりません:', settings.tableFieldCode);
      return;
    }

    const tableInfo = findTableByColumnLabel(settings.tableEmailFieldLabel);
    if (!tableInfo) {
      console.warn('[openmailer] メールアドレス列が画面上で見つかりませんでした:', settings.tableEmailFieldLabel);
      return;
    }

    const { tableElement, columnIndex } = tableInfo;
    const bodyRows = Array.from(tableElement.querySelectorAll('tbody tr'))
      .filter((tr) => tr.children.length > columnIndex);

    bodyRows.forEach((tr, rowIndex) => {
      const cell = tr.children[columnIndex];
      const rowData = tableField.value[rowIndex];
      if (!cell || !rowData || !rowData.value) {
        return;
      }

      const emailField = rowData.value[settings.tableEmailFieldCode];
      const email = getFieldStringValue(emailField);

      hideOriginalContentOnce(cell);
      removeButtonArea(cell, settings.id);

      if (!email) {
        return;
      }

      const area = createButtonArea(settings.id);
      area.appendChild(createMailButton(record, settings, email, rowData.value, rowIndex));
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

  function createMailButton(record, settings, email, rowValue, rowIndex) {
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

      let mailtoUrl = `mailto:${email}`;
      const params = [];
      if (subject) {
        params.push(`subject=${encodeURIComponent(subject)}`);
      }
      if (body) {
        params.push(`body=${encodeURIComponent(body)}`);
      }
      if (params.length > 0) {
        mailtoUrl += `?${params.join('&')}`;
      }

      window.location.href = mailtoUrl;

      if (settings.manageEnabled && settings.manageFieldCode) {
        if (window.confirm('このメールを送信済みにしますか？')) {
          markAsSent(record, settings, rowIndex)
            .then(() => {
              alert('送信済みに更新しました。');
              window.location.reload();
            })
            .catch((error) => {
              console.error('[openmailer] 送信済み更新エラー', error);
              alert('送信済みの更新に失敗しました。\n権限や設定内容をご確認ください。');
            });
        }
      }
    });

    return button;
  }

  // ---------- メール送信管理（送信済み更新） ----------
  function markAsSent(record, settings, rowIndex) {
    const appId = kintone.app.getId();
    const recordId = kintone.app.record.getId();

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
  function getSpaceElement(spaceId) {
    try {
      return kintone.app.record.getSpaceElement(spaceId);
    } catch (error) {
      return null;
    }
  }

  function getFieldElement(fieldCode) {
    try {
      return kintone.app.record.getFieldElement(fieldCode);
    } catch (error) {
      return null;
    }
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
