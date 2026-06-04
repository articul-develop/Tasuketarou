/* eslint @typescript-eslint/no-unused-vars: 0 */
(async (PLUGIN_ID) => {
  'use strict';

  const config = kintone.plugin.app.getConfig(PLUGIN_ID) || {};
  const authState = {
    checked: false,
    isValid: false,
    trialEndDate: config.Trial_enddate || ''
  };

  const lookupFieldListEl = document.getElementById('lookup-field-list');
  const authStatusEl = document.getElementById('auth-status');
  const saveBtn = document.getElementById('save-button');
  const cancelBtn = document.getElementById('cancel-button');

  function parseEditableFields() {
    if (!config.editableFields) {
      return [];
    }
    try {
      const parsed = JSON.parse(config.editableFields);
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      console.error('editableFields の解析に失敗しました。', error);
      return [];
    }
  }

  const savedEditableFields = parseEditableFields();

  function buildReloadPromptMessage(message) {
    return `${message}\n設定内容を確認後、画面をリロードして再試行してください。`;
  }

  function updateSaveButtonState(isBlocked, title = '') {
    saveBtn.disabled = isBlocked;
    saveBtn.setAttribute('aria-disabled', isBlocked ? 'true' : 'false');
    if (title) {
      saveBtn.title = title;
      return;
    }
    saveBtn.removeAttribute('title');
  }

  function setAuthStatus(message, isError) {
    authStatusEl.textContent = message;
    authStatusEl.classList.toggle('is-error', Boolean(isError));
  }

  function fetchFormProperties() {
    return kintone.api(
      kintone.api.url('/k/v1/preview/app/form/fields.json', true),
      'GET',
      { app: kintone.app.getId() }
    ).then((response) => response.properties);
  }

  function collectCopyFields(properties, parentTableLabel, result) {
    Object.keys(properties || {}).forEach((fieldCode) => {
      const field = properties[fieldCode];

      if (field.lookup && Array.isArray(field.lookup.fieldMappings)) {
        field.lookup.fieldMappings.forEach((mapping) => {
          if (!mapping || !mapping.field) {
            return;
          }
          const target = properties[mapping.field];
          if (!target) {
            return;
          }
          if (result.some((item) => item.code === mapping.field)) {
            return;
          }
          result.push({
            code: mapping.field,
            label: target.label || mapping.field,
            tableLabel: parentTableLabel || ''
          });
        });
      }

      if (field.type === 'SUBTABLE' && field.fields) {
        collectCopyFields(field.fields, field.label || fieldCode, result);
      }
    });
  }

  function buildCopyFieldList(properties) {
    const result = [];
    collectCopyFields(properties, null, result);
    return result;
  }

  function renderCopyFieldList(copyFields) {
    lookupFieldListEl.innerHTML = '';

    if (copyFields.length === 0) {
      const note = document.createElement('p');
      note.className = 'field-note';
      note.textContent = 'このアプリには、ルックアップでコピーされる項目がありません。';
      lookupFieldListEl.appendChild(note);
      return;
    }

    copyFields.forEach((item) => {
      const label = document.createElement('label');
      label.className = 'checkbox-item';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = item.code;
      checkbox.dataset.fieldCode = item.code;
      checkbox.checked = savedEditableFields.indexOf(item.code) !== -1;

      const text = document.createElement('span');
      const displayLabel = item.tableLabel
        ? `${item.tableLabel} > ${item.label}`
        : item.label;
      text.textContent = `${displayLabel}（${item.code}）`;

      label.appendChild(checkbox);
      label.appendChild(text);
      lookupFieldListEl.appendChild(label);
    });
  }

  function collectCheckedFieldCodes() {
    const checkboxes = lookupFieldListEl.querySelectorAll('input[type="checkbox"]');
    const codes = [];
    checkboxes.forEach((checkbox) => {
      if (checkbox.checked) {
        codes.push(checkbox.value);
      }
    });
    return codes;
  }

  async function authenticateOnInitialize() {
    updateSaveButtonState(true, '認証状態を確認しています。');
    setAuthStatus('認証状態を確認しています。', false);

    try {
      const data = await AuthModule.authenticateDomain(API_CONFIG);
      if (data.status === 'success' && data.response?.status === 'valid') {
        authState.checked = true;
        authState.isValid = true;
        authState.trialEndDate = data.response.Trial_enddate || authState.trialEndDate;
        updateSaveButtonState(false);
        setAuthStatus('認証済みです。設定を保存できます。', false);
        return true;
      }

      const message = data.response?.message || '不明なエラー';
      authState.checked = true;
      authState.isValid = false;
      updateSaveButtonState(true, '認証に失敗したため保存できません。');
      setAuthStatus(`認証失敗: ${message}`, true);
      alert(buildReloadPromptMessage(`認証失敗: ${message}`));
      return false;
    } catch (error) {
      console.error('起動時認証エラー:', error);
      authState.checked = true;
      authState.isValid = false;
      updateSaveButtonState(true, '認証に失敗したため保存できません。');
      setAuthStatus('認証中にエラーが発生しました。', true);
      alert(buildReloadPromptMessage('認証中にエラーが発生しました。'));
      return false;
    }
  }

  saveBtn.addEventListener('click', () => {
    if (!authState.checked || !authState.isValid) {
      alert(buildReloadPromptMessage('認証が完了していないため保存できません。'));
      return;
    }

    try {
      const editableFields = collectCheckedFieldCodes();

      const newConfig = {
        editableFields: JSON.stringify(editableFields),
        authStatus: 'valid'
      };

      if (authState.trialEndDate) {
        newConfig.Trial_enddate = authState.trialEndDate;
      }

      kintone.plugin.app.setConfig(newConfig, () => {
        alert('設定を保存しました。');
        window.location.href = `/k/admin/app/${kintone.app.getId()}/plugin/`;
      });
    } catch (error) {
      console.error('設定保存エラー:', error);
      alert(error.message || '設定保存中にエラーが発生しました。');
    }
  });

  cancelBtn.addEventListener('click', () => {
    window.location.href = `/k/admin/app/${kintone.app.getId()}/plugin/`;
  });

  try {
    const properties = await fetchFormProperties();
    renderCopyFieldList(buildCopyFieldList(properties));
    await authenticateOnInitialize();
  } catch (error) {
    console.error(error);
    updateSaveButtonState(true, '初期化に失敗しました。');
    setAuthStatus('初期化に失敗しました。画面をリロードしてください。', true);
    alert('設定画面の初期化に失敗しました。');
  }
})(kintone.$PLUGIN_ID);
