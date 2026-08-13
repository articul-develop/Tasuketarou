/* eslint @typescript-eslint/no-unused-vars: 0 */
(async (PLUGIN_ID) => {
  'use strict';

  const CH = window.ChangeHistory;
  const config = kintone.plugin.app.getConfig(PLUGIN_ID) || {};
  const authState = {
    checked: false,
    isValid: false,
    trialEndDate: config.Trial_enddate || ''
  };

  const settingsListEl = document.getElementById('settings-list');
  const addSettingBtn = document.getElementById('add-setting-button');
  const hideDestOnEditEl = document.getElementById('hide-dest-on-edit');
  const lockDestOnEditEl = document.getElementById('lock-dest-on-edit');
  const authStatusEl = document.getElementById('auth-status');
  const trialStatusEl = document.getElementById('trial-status');
  const saveBtn = document.getElementById('save-button');
  const cancelBtn = document.getElementById('cancel-button');

  const HISTORY_TABLE_BASE_NAME = '変更履歴テーブル';

  let formFields = [];
  let settingsState = [];

  const HISTORY_COLUMN_DEFS = [
    { key: 'datetime', label: '変更日時', required: true, forField: true, forSubtable: true, forPerSave: true },
    { key: 'user', label: '変更者', required: true, forField: true, forSubtable: true, forPerSave: true },
    { key: 'target', label: '変更対象', required: true, forField: true, forSubtable: true, forPerSave: false },
    { key: 'before', label: '変更前', required: true, forField: true, forSubtable: true, forPerSave: false },
    { key: 'after', label: '変更後', required: true, forField: true, forSubtable: true, forPerSave: false },
    { key: 'content', label: '変更内容', required: true, forField: false, forSubtable: false, forPerSave: true },
    { key: 'tableName', label: '対象テーブル名（任意）', required: false, forField: false, forSubtable: true, forPerSave: false },
    { key: 'rowLabel', label: '明細識別値（任意）', required: false, forField: false, forSubtable: true, forPerSave: false },
    { key: 'rowNo', label: '行NO（任意）', required: false, forField: false, forSubtable: true, forPerSave: false }
  ];

  const COLUMN_MATCH_ALIASES = {
    datetime: ['変更日時', '日時'],
    user: ['変更者', '更新者'],
    target: ['変更対象', '対象', '項目'],
    before: ['変更前', '変更前の値'],
    after: ['変更後', '変更後の値'],
    content: ['変更内容', '履歴', '変更履歴'],
    tableName: ['対象テーブル', '対象テーブル名', 'テーブル名'],
    rowLabel: ['明細識別', '明細', '品番'],
    rowNo: ['行NO', '行No', '行番号', '行ID']
  };

  /** 自動作成時の列定義（key → フィールド定義） */
  const CREATE_COLUMN_SPECS = {
    datetime: { type: 'SINGLE_LINE_TEXT', code: '変更日時', label: '変更日時' },
    user: { type: 'SINGLE_LINE_TEXT', code: '変更者', label: '変更者' },
    target: { type: 'SINGLE_LINE_TEXT', code: '変更対象', label: '変更対象' },
    before: { type: 'MULTI_LINE_TEXT', code: '変更前', label: '変更前' },
    after: { type: 'MULTI_LINE_TEXT', code: '変更後', label: '変更後' },
    content: { type: 'MULTI_LINE_TEXT', code: '変更内容', label: '変更内容' },
    tableName: { type: 'SINGLE_LINE_TEXT', code: '対象テーブル', label: '対象テーブル' },
    rowLabel: { type: 'SINGLE_LINE_TEXT', code: '明細識別', label: '明細' },
    rowNo: { type: 'SINGLE_LINE_TEXT', code: '行NO', label: '行NO' }
  };

  function isPerSaveGrain(rowGrain) {
    return rowGrain === 'perSave';
  }

  function getSavePreset(setting) {
    if (setting && setting.saveType === 'text') {
      return 'text';
    }
    if (setting && setting.historyRowGrain === 'perSave') {
      return 'perSave';
    }
    return 'perChange';
  }

  function applySavePreset(setting, preset) {
    if (preset === 'text') {
      setting.saveType = 'text';
      setting.historyRowGrain = 'perChange';
      return;
    }
    setting.saveType = 'subtable';
    setting.historyRowGrain = preset === 'perSave' ? 'perSave' : 'perChange';
  }

  function presetVisualSvg(kind) {
    const font = "Meiryo, 'Yu Gothic', sans-serif";
    if (kind === 'text') {
      return `<svg viewBox="0 0 360 320" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <rect width="360" height="320" rx="12" fill="#e8eef7"/>
        <rect x="16" y="14" width="328" height="292" rx="10" fill="#ffffff" stroke="#c5d3e6"/>
        <path d="M16 14h328a10 10 0 0 1 10 10v26H16V24a10 10 0 0 1 10-10z" fill="#315fc4"/>
        <text x="32" y="40" fill="#ffffff" font-size="16" font-weight="700" font-family="${font}">変更履歴</text>
        <rect x="32" y="64" width="52" height="22" rx="4" fill="#e8f1ff"/>
        <text x="38" y="80" fill="#214fa8" font-size="12" font-weight="700" font-family="${font}">1回目</text>
        <text x="94" y="80" fill="#315fc4" font-size="15" font-weight="700" font-family="${font}">[11:40] 山田</text>
        <text x="32" y="116" fill="#24324a" font-size="17" font-family="${font}">数量：10 → 12</text>
        <text x="32" y="146" fill="#24324a" font-size="17" font-family="${font}">納期：08-20 → 08-25</text>
        <line x1="32" y1="172" x2="328" y2="172" stroke="#dce5f1"/>
        <rect x="32" y="192" width="52" height="22" rx="4" fill="#fff4e5"/>
        <text x="38" y="208" fill="#b86a00" font-size="12" font-weight="700" font-family="${font}">2回目</text>
        <text x="94" y="208" fill="#315fc4" font-size="15" font-weight="700" font-family="${font}">[15:00] 山田</text>
        <text x="32" y="246" fill="#24324a" font-size="17" font-family="${font}">進捗：対応中 → 完了</text>
      </svg>`;
    }
    if (kind === 'perSave') {
      return `<svg viewBox="0 0 360 320" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <rect width="360" height="320" rx="12" fill="#e8eef7"/>
        <rect x="12" y="14" width="336" height="292" rx="10" fill="#ffffff" stroke="#c5d3e6"/>
        <rect x="12" y="14" width="336" height="40" rx="10" fill="#1f7a4d"/>
        <rect x="12" y="40" width="336" height="14" fill="#1f7a4d"/>
        <text x="24" y="40" fill="#ffffff" font-size="14" font-weight="700" font-family="${font}">日時</text>
        <text x="108" y="40" fill="#ffffff" font-size="14" font-weight="700" font-family="${font}">変更者</text>
        <text x="178" y="40" fill="#ffffff" font-size="14" font-weight="700" font-family="${font}">変更内容</text>
        <rect x="20" y="64" width="46" height="18" rx="4" fill="#e8f1ff"/>
        <text x="25" y="77" fill="#214fa8" font-size="11" font-weight="700" font-family="${font}">1回目</text>
        <text x="24" y="104" fill="#24324a" font-size="14" font-family="${font}">11:40</text>
        <text x="108" y="104" fill="#24324a" font-size="14" font-family="${font}">山田</text>
        <text x="178" y="96" fill="#24324a" font-size="15" font-family="${font}">数量：10 → 12</text>
        <text x="178" y="120" fill="#24324a" font-size="15" font-family="${font}">納期：08-20 → 08-25</text>
        <line x1="20" y1="140" x2="340" y2="140" stroke="#dce5f1"/>
        <rect x="20" y="156" width="46" height="18" rx="4" fill="#fff4e5"/>
        <text x="25" y="169" fill="#b86a00" font-size="11" font-weight="700" font-family="${font}">2回目</text>
        <text x="24" y="198" fill="#24324a" font-size="14" font-family="${font}">15:00</text>
        <text x="108" y="198" fill="#24324a" font-size="14" font-family="${font}">山田</text>
        <text x="178" y="198" fill="#24324a" font-size="15" font-family="${font}">進捗：対応中 → 完了</text>
        <rect x="20" y="268" width="132" height="24" rx="6" fill="#e7f6ee"/>
        <text x="30" y="285" fill="#1f7a4d" font-size="13" font-weight="700" font-family="${font}">保存2回 = 2行</text>
      </svg>`;
    }
    return `<svg viewBox="0 0 360 320" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect width="360" height="320" rx="12" fill="#e8eef7"/>
      <rect x="12" y="14" width="336" height="292" rx="10" fill="#ffffff" stroke="#c5d3e6"/>
      <rect x="12" y="14" width="336" height="40" rx="10" fill="#315fc4"/>
      <rect x="12" y="40" width="336" height="14" fill="#315fc4"/>
      <text x="20" y="40" fill="#ffffff" font-size="12" font-weight="700" font-family="${font}">日時</text>
      <text x="72" y="40" fill="#ffffff" font-size="12" font-weight="700" font-family="${font}">変更者</text>
      <text x="128" y="40" fill="#ffffff" font-size="12" font-weight="700" font-family="${font}">対象</text>
      <text x="198" y="40" fill="#ffffff" font-size="12" font-weight="700" font-family="${font}">変更前</text>
      <text x="274" y="40" fill="#ffffff" font-size="12" font-weight="700" font-family="${font}">変更後</text>
      <rect x="20" y="64" width="46" height="18" rx="4" fill="#e8f1ff"/>
      <text x="25" y="77" fill="#214fa8" font-size="11" font-weight="700" font-family="${font}">1回目</text>
      <text x="20" y="108" fill="#24324a" font-size="13" font-family="${font}">11:40</text>
      <text x="72" y="108" fill="#24324a" font-size="13" font-family="${font}">山田</text>
      <text x="128" y="108" fill="#24324a" font-size="13" font-family="${font}">数量</text>
      <text x="198" y="108" fill="#6b7c93" font-size="13" font-family="${font}">10</text>
      <text x="274" y="108" fill="#214fa8" font-size="13" font-weight="700" font-family="${font}">12</text>
      <line x1="20" y1="126" x2="340" y2="126" stroke="#e2e8f1"/>
      <text x="20" y="154" fill="#24324a" font-size="13" font-family="${font}">11:40</text>
      <text x="72" y="154" fill="#24324a" font-size="13" font-family="${font}">山田</text>
      <text x="128" y="154" fill="#24324a" font-size="13" font-family="${font}">納期</text>
      <text x="198" y="154" fill="#6b7c93" font-size="13" font-family="${font}">08-20</text>
      <text x="274" y="154" fill="#214fa8" font-size="13" font-weight="700" font-family="${font}">08-25</text>
      <line x1="20" y1="172" x2="340" y2="172" stroke="#dce5f1"/>
      <rect x="20" y="188" width="46" height="18" rx="4" fill="#fff4e5"/>
      <text x="25" y="201" fill="#b86a00" font-size="11" font-weight="700" font-family="${font}">2回目</text>
      <text x="20" y="234" fill="#24324a" font-size="13" font-family="${font}">15:00</text>
      <text x="72" y="234" fill="#24324a" font-size="13" font-family="${font}">山田</text>
      <text x="128" y="234" fill="#24324a" font-size="13" font-family="${font}">進捗</text>
      <text x="198" y="234" fill="#6b7c93" font-size="13" font-family="${font}">対応中</text>
      <text x="274" y="234" fill="#214fa8" font-size="13" font-weight="700" font-family="${font}">完了</text>
    </svg>`;
  }

  function savePresetCardHtml(preset, currentPreset, settingId) {
    const defs = {
      text: {
        title: 'かんたん',
        desc: '文字列（複数行）に追記します。'
      },
      perSave: {
        title: '1保存につき1行',
        desc: '履歴テーブルへ、保存のたびに1行まとめます。'
      },
      perChange: {
        title: '1変更につき1行',
        desc: '履歴テーブルへ、項目ごとに行を増やします。'
      }
    };
    const def = defs[preset];
    const checked = currentPreset === preset ? ' checked' : '';
    const selected = currentPreset === preset ? ' is-selected' : '';
    const badge = preset === 'perSave' ? '<span class="save-preset-badge">おすすめ</span>' : '';
    return `<label class="save-preset-card${selected}">
      <input type="radio" name="savePreset-${settingId}" data-role="savePreset" value="${preset}"${checked}>
      <span class="save-preset-heading">
        <span class="save-preset-title">${escapeHtml(def.title)}</span>
        ${badge}
      </span>
      <span class="save-preset-desc">${escapeHtml(def.desc)}</span>
      <span class="save-preset-visual">${presetVisualSvg(preset)}</span>
    </label>`;
  }

  function emptyHistoryColumns() {
    return {
      datetime: '',
      user: '',
      target: '',
      before: '',
      after: '',
      content: '',
      tableName: '',
      rowLabel: '',
      rowNo: ''
    };
  }

  function getColumnDefsForSetting(targetType, rowGrain) {
    if (isPerSaveGrain(rowGrain)) {
      return HISTORY_COLUMN_DEFS.filter((def) => def.forPerSave);
    }
    return HISTORY_COLUMN_DEFS.filter((def) => (
      targetType === 'subtable' ? def.forSubtable : def.forField
    ));
  }

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

  function formatTrialEndDate(trialEndDate) {
    const match = String(trialEndDate).match(/^(\d{4})[-/]?(\d{2})[-/]?(\d{2})$/);
    if (!match) {
      return '';
    }
    return `${Number(match[2])}月${Number(match[3])}日`;
  }

  function setTrialStatus(trialEndDate) {
    const formattedDate = formatTrialEndDate(trialEndDate);
    if (!formattedDate) {
      trialStatusEl.hidden = true;
      trialStatusEl.textContent = '';
      return;
    }
    trialStatusEl.textContent = `トライアル中（～${formattedDate}まで）`;
    trialStatusEl.hidden = false;
  }

  function createDefaultSetting() {
    return {
      id: CH.createId(),
      enabled: true,
      targetType: 'field',
      targetFields: [],
      fieldLabels: {},
      sourceTable: '',
      sourceTableLabel: '',
      rowIdentifierField: '',
      saveType: 'text',
      textDestType: 'record',
      textDestField: '',
      historyTable: '',
      historyRowGrain: 'perChange',
      historyColumns: emptyHistoryColumns(),
      logRowAdd: true,
      logRowDelete: true,
      logOnCreate: true,
      logOnCreateValues: true,
      logAddedRowValues: false
    };
  }

  function normalizeSetting(raw) {
    const setting = Object.assign(createDefaultSetting(), raw || {}, {
      historyColumns: Object.assign(
        createDefaultSetting().historyColumns,
        (raw && raw.historyColumns) || {}
      )
    });

    // 旧設定互換: logOnCreateValues 未定義なら、従来どおり新規登録時は値も残す
    if (raw && raw.logOnCreateValues === undefined && raw.logOnCreate !== false) {
      setting.logOnCreateValues = true;
    }

    // 旧 rowId マッピングを rowNo へ引き継ぎ
    if (setting.historyColumns) {
      if (!setting.historyColumns.rowNo && setting.historyColumns.rowId) {
        setting.historyColumns.rowNo = setting.historyColumns.rowId;
      }
      delete setting.historyColumns.rowId;
    }

    // サブテーブルは「新規登録・行追加」を一体で扱う
    if (setting.targetType === 'subtable') {
      const enabled = setting.logOnCreate !== false || setting.logRowAdd !== false;
      setting.logOnCreate = enabled;
      setting.logRowAdd = enabled;
    }

    if (setting.historyRowGrain !== 'perSave') {
      setting.historyRowGrain = 'perChange';
    }

    delete setting.createManageTableHistory;
    delete setting.hideDestOnEdit;

    setting.targetFields = Array.isArray(setting.targetFields)
      ? setting.targetFields.filter((code) => isSupportedTargetCode(
        code,
        setting.targetType === 'subtable' ? setting.sourceTable : null
      ))
      : [];
    const nextLabels = {};
    setting.targetFields.forEach((code) => {
      if (setting.fieldLabels && setting.fieldLabels[code]) {
        nextLabels[code] = setting.fieldLabels[code];
      }
    });
    setting.fieldLabels = nextLabels;

    if (setting.rowIdentifierField && !isSupportedTargetCode(setting.rowIdentifierField, setting.sourceTable)) {
      setting.rowIdentifierField = '';
    }

    return setting;
  }

  function isSupportedTargetCode(code, subtableCode) {
    if (!code) {
      return false;
    }
    if (!formFields.length) {
      return true;
    }
    const list = subtableCode ? getSubtableFields(subtableCode) : getRecordFields();
    const found = list.find((f) => f.code === code);
    return Boolean(found && CH.SUPPORTED_TARGET_TYPES.indexOf(found.type) !== -1);
  }

  function getRecordFields() {
    return formFields.filter((f) => !f.subtableCode && f.type !== 'SUBTABLE');
  }

  function getSubtables() {
    return formFields.filter((f) => f.type === 'SUBTABLE');
  }

  function getSubtableFields(tableCode) {
    return formFields.filter((f) => f.subtableCode === tableCode);
  }

  /**
   * KintoneConfigHelper は lookup を除外するため、fields API で補完する
   */
  async function loadFormFields() {
    const baseFields = await KintoneConfigHelper.getFields();
    const normalized = (baseFields || []).map((f) => Object.assign({}, f, {
      subtableCode: f.subtableCode || null
    }));

    try {
      const resp = await kintone.api(kintone.api.url('/k/v1/preview/app/form/fields', true), 'GET', {
        app: kintone.app.getId()
      });
      const properties = (resp && resp.properties) || {};
      const existing = new Set(normalized.map((f) => `${f.subtableCode || ''}::${f.code}`));

      Object.keys(properties).forEach((code) => {
        const prop = properties[code];
        if (!prop) {
          return;
        }
        if (prop.type === 'SUBTABLE') {
          const tableEntry = normalized.find((f) => f.type === 'SUBTABLE' && f.code === code);
          if (tableEntry && prop.label) {
            tableEntry.label = prop.label;
          } else if (!tableEntry) {
            normalized.push({
              type: 'SUBTABLE',
              code,
              label: prop.label || code,
              subtableCode: null
            });
          }
          if (prop.fields) {
            Object.keys(prop.fields).forEach((innerCode) => {
              const inner = prop.fields[innerCode];
              const key = `${code}::${innerCode}`;
              if (existing.has(key)) {
                return;
              }
              if (inner && inner.lookup) {
                normalized.push({
                  type: inner.type,
                  code: inner.code,
                  label: inner.label || inner.code,
                  subtableCode: code,
                  lookup: true
                });
                existing.add(key);
              }
            });
          }
          return;
        }
        if (prop.lookup) {
          const key = `::${prop.code}`;
          if (!existing.has(key)) {
            normalized.push({
              type: prop.type,
              code: prop.code,
              label: prop.label || prop.code,
              subtableCode: null,
              lookup: true
            });
            existing.add(key);
          }
        }
      });
    } catch (e) {
      console.warn('lookup フィールドの補完に失敗しました', e);
    }

    return normalized;
  }

  function getSupportedTargets(fields) {
    return fields.filter((f) => CH.SUPPORTED_TARGET_TYPES.indexOf(f.type) !== -1);
  }

  function getMultiLineTextFields(fields) {
    return fields.filter((f) => f.type === 'MULTI_LINE_TEXT');
  }

  function optionHtml(fields, selected, includeEmpty) {
    const options = [];
    if (includeEmpty) {
      options.push(`<option value="">（選択してください）</option>`);
    }
    fields.forEach((f) => {
      const label = f.label ? `${f.label}（${f.code}）` : f.code;
      const sel = selected === f.code ? ' selected' : '';
      options.push(`<option value="${escapeAttr(f.code)}"${sel}>${escapeHtml(label)}</option>`);
    });
    return options.join('');
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function escapeAttr(str) {
    return escapeHtml(str);
  }

  function checkboxListHtml(fields, selectedCodes, name) {
    if (!fields.length) {
      return '<p class="field-note">選択可能なフィールドがありません。</p>';
    }
    const selected = new Set(selectedCodes || []);
    return `<div class="checkbox-grid">${fields.map((f) => {
      const checked = selected.has(f.code) ? ' checked' : '';
      const label = f.label ? `${f.label}（${f.code}）` : f.code;
      return `<label class="checkbox-item">
        <input type="checkbox" data-role="target-field" data-code="${escapeAttr(f.code)}" data-label="${escapeAttr(f.label || f.code)}" name="${name}"${checked}>
        <span>${escapeHtml(label)} <em class="type-tag">${escapeHtml(f.type)}</em></span>
      </label>`;
    }).join('')}</div>`;
  }

  function renderSettingCard(setting, index) {
    const card = document.createElement('article');
    card.className = 'history-card';
    card.dataset.id = setting.id;

    const recordFields = getRecordFields();
    const subtables = getSubtables();
    const hasSubtables = subtables.length > 0;
    const isSubtable = hasSubtables && setting.targetType === 'subtable';
    const isField = !isSubtable;
    const savePreset = getSavePreset(setting);
    const isText = savePreset === 'text';
    const isHistoryTable = !isText;
    const isPerSave = savePreset === 'perSave';

    const targetCandidateFields = isField
      ? getSupportedTargets(recordFields)
      : getSupportedTargets(getSubtableFields(setting.sourceTable));

    const textDestFields = setting.textDestType === 'row' && setting.sourceTable
      ? getMultiLineTextFields(getSubtableFields(setting.sourceTable))
      : getMultiLineTextFields(recordFields);

    const historyTables = subtables;
    const historyTableFields = setting.historyTable
      ? getSubtableFields(setting.historyTable)
      : [];

    const identifierCandidates = setting.sourceTable
      ? getSupportedTargets(getSubtableFields(setting.sourceTable))
      : [];

    card.innerHTML = `
      <div class="history-card-header">
        <div class="history-card-title">
          <span class="section-card-step">${String(index + 1).padStart(2, '0')}</span>
          <div>
            <h3>履歴設定 ${index + 1}</h3>
            <p>履歴対象・保存形式・オプションを指定します。</p>
          </div>
        </div>
        <div class="history-card-actions">
          <label class="checkbox-item checkbox-inline">
            <input type="checkbox" data-role="enabled"${setting.enabled !== false ? ' checked' : ''}>
            <span>有効</span>
          </label>
          <button type="button" class="kintoneplugin-button-dialog-cancel" data-role="remove">削除</button>
        </div>
      </div>

      <div class="form-stack">
        <div class="form-section">
          <div class="form-section-head">
            <span class="form-section-num">①</span>
            <span class="kintoneplugin-label">履歴対象</span>
          </div>
          <div class="form-field">
            <div class="radio-row">
              <label class="checkbox-item checkbox-inline">
                <input type="radio" name="targetType-${setting.id}" data-role="targetType" value="field"${isField ? ' checked' : ''}>
                <span>レコードの項目</span>
              </label>
              <label class="checkbox-item checkbox-inline${hasSubtables ? '' : ' is-disabled'}" title="${hasSubtables ? '' : 'このアプリに明細テーブルがありません'}">
                <input type="radio" name="targetType-${setting.id}" data-role="targetType" value="subtable"${isSubtable ? ' checked' : ''}${hasSubtables ? '' : ' disabled'}>
                <span>明細テーブル</span>
              </label>
            </div>
            ${hasSubtables ? '' : '<span class="field-note">このアプリにサブテーブルがないため、明細テーブルは選択できません。</span>'}
          </div>

          <div class="form-field" data-section="subtable-select" style="${isSubtable ? '' : 'display:none'}">
            <label class="kintoneplugin-label">対象テーブル</label>
            <select class="kintoneplugin-select" data-role="sourceTable">
              ${optionHtml(subtables, setting.sourceTable, true)}
            </select>
          </div>

          <div class="form-field">
            <span class="kintoneplugin-label">対象項目</span>
            <div data-role="targetFieldsWrap">
              ${checkboxListHtml(targetCandidateFields, setting.targetFields, `target-${setting.id}`)}
            </div>
            <span class="field-note">添付ファイル・リッチエディターは対象外です（保存時イベントで新規添付を取得できない／HTML差分が業務上読みにくいため）。</span>
          </div>

          <div class="form-field" data-section="row-identifier" style="${isSubtable ? '' : 'display:none'}">
            <label class="kintoneplugin-label">明細を特定するフィールド（任意）</label>
            <select class="kintoneplugin-select" data-role="rowIdentifierField">
              ${optionHtml(identifierCandidates, setting.rowIdentifierField, true)}
            </select>
            <span class="field-note">履歴テーブルの「明細」列や、文字列／1更新1行の変更内容テキストの行ラベルに使います（例: 品番）。</span>
          </div>
        </div>

        <div class="form-section">
          <div class="form-section-head">
            <span class="form-section-num">②</span>
            <span class="kintoneplugin-label">保存形式</span>
          </div>
          <div class="save-preset-grid">
            ${savePresetCardHtml('text', savePreset, setting.id)}
            ${savePresetCardHtml('perSave', savePreset, setting.id)}
            ${savePresetCardHtml('perChange', savePreset, setting.id)}
          </div>

          <div class="form-field" data-section="text-dest-type" style="${isText && isSubtable ? '' : 'display:none'}">
            <span class="kintoneplugin-label">文字列の保存先位置</span>
            <div class="radio-row">
              <label class="checkbox-item checkbox-inline">
                <input type="radio" name="textDestType-${setting.id}" data-role="textDestType" value="record"${setting.textDestType !== 'row' ? ' checked' : ''}>
                <span>レコード本体</span>
              </label>
              <label class="checkbox-item checkbox-inline">
                <input type="radio" name="textDestType-${setting.id}" data-role="textDestType" value="row"${setting.textDestType === 'row' ? ' checked' : ''}>
                <span>対象サブテーブル行内</span>
              </label>
            </div>
            <span class="field-note">行内へ保存する場合、行削除の履歴はその行へ書けないため記録されません（レコード本体または履歴テーブルを利用してください）。</span>
          </div>

          <div class="form-field" data-section="text-dest-field" style="${isText ? '' : 'display:none'}">
            <label class="kintoneplugin-label">保存先（文字列・複数行）</label>
            <select class="kintoneplugin-select" data-role="textDestField">
              ${optionHtml(textDestFields, setting.textDestField, true)}
            </select>
          </div>

          <div class="form-field" data-section="history-table" style="${isHistoryTable ? '' : 'display:none'}">
            <label class="kintoneplugin-label">履歴用サブテーブル</label>
            <div class="history-table-row">
              <select class="kintoneplugin-select" data-role="historyTable">
                ${optionHtml(historyTables, setting.historyTable, true)}
              </select>
              <button type="button" class="kintoneplugin-button-dialog-ok" data-role="create-history-table">履歴サブテーブルをアプリに作成する</button>
            </div>
            <span class="field-note">${isPerSave
              ? '作成時に「変更履歴テーブル」を追加し、変更日時・変更者・変更内容を割り当てます。作成後は自動で「アプリを更新」します（他の未反映のフォーム変更も一緒に公開されます）。'
              : '作成時に「変更履歴テーブル」を追加し、この履歴設定へ割当・列マッピングします。サブテーブル対象の場合は対象テーブル名・明細識別・行NO列も作成します。作成後は自動で「アプリを更新」します（他の未反映のフォーム変更も一緒に公開されます）。'}</span>
            <p class="create-history-status" data-role="create-status" aria-live="polite"></p>
          </div>

          <div class="form-field" data-section="history-columns" style="${isHistoryTable ? '' : 'display:none'}">
            <span class="kintoneplugin-label">履歴テーブル列マッピング</span>
            <div class="mapping-grid">
              ${getColumnDefsForSetting(isSubtable ? 'subtable' : 'field', isPerSave ? 'perSave' : 'perChange').map((def) => `
                <label class="mapping-item">
                  <span>${escapeHtml(def.label)}${def.required ? ' *' : ''}</span>
                  <select class="kintoneplugin-select" data-role="historyColumn" data-column="${def.key}">
                    ${optionHtml(historyTableFields, (setting.historyColumns || {})[def.key] || '', true)}
                  </select>
                </label>
              `).join('')}
            </div>
          </div>
        </div>

        <div class="form-section">
          <div class="form-section-head">
            <span class="form-section-num">③</span>
            <span class="kintoneplugin-label">オプション</span>
          </div>
          <div class="form-field">
          <div class="checkbox-grid option-grid">
            ${isField ? `
            <label class="checkbox-item">
              <input type="checkbox" data-role="logOnCreate"${setting.logOnCreate !== false ? ' checked' : ''}>
              <span>新規登録を履歴に残す</span>
            </label>
            <label class="checkbox-item option-nested">
              <input type="checkbox" data-role="logOnCreateValues"${setting.logOnCreate !== false && setting.logOnCreateValues !== false ? ' checked' : ''}${setting.logOnCreate === false ? ' disabled' : ''}>
              <span>新規登録時に各フィールドの値も履歴に残す</span>
            </label>
            ` : ''}
            ${isSubtable ? `
            <label class="checkbox-item">
              <input type="checkbox" data-role="logCreateOrAdd"${setting.logOnCreate !== false || setting.logRowAdd !== false ? ' checked' : ''}>
              <span>新規登録・行追加を履歴に残す</span>
            </label>
            <label class="checkbox-item option-nested">
              <input type="checkbox" data-role="logAddedRowValues"${(setting.logOnCreate !== false || setting.logRowAdd !== false) && setting.logAddedRowValues ? ' checked' : ''}${setting.logOnCreate === false && setting.logRowAdd === false ? ' disabled' : ''}>
              <span>新規登録・行追加時に各フィールドの値も履歴に残す</span>
            </label>
            <label class="checkbox-item">
              <input type="checkbox" data-role="logRowDelete"${setting.logRowDelete !== false ? ' checked' : ''}>
              <span>明細行の削除を履歴に残す</span>
            </label>
            ` : ''}
          </div>
          </div>
        </div>
      </div>
    `;

    bindCardEvents(card, setting);
    return card;
  }

  function readCardToSetting(card, base) {
    const setting = Object.assign({}, base);
    setting.enabled = Boolean(card.querySelector('[data-role="enabled"]').checked);
    const targetTypeEl = card.querySelector('[data-role="targetType"]:checked');
    setting.targetType = targetTypeEl ? targetTypeEl.value : 'field';
    const presetEl = card.querySelector('[data-role="savePreset"]:checked');
    applySavePreset(setting, presetEl ? presetEl.value : 'text');

    const sourceSelect = card.querySelector('[data-role="sourceTable"]');
    setting.sourceTable = sourceSelect ? sourceSelect.value : '';
    const sourceMeta = getSubtables().find((t) => t.code === setting.sourceTable);
    setting.sourceTableLabel = sourceMeta ? (sourceMeta.label || sourceMeta.code) : setting.sourceTable;

    const idSelect = card.querySelector('[data-role="rowIdentifierField"]');
    setting.rowIdentifierField = idSelect ? idSelect.value : '';

    const textDestTypeEl = card.querySelector('[data-role="textDestType"]:checked');
    setting.textDestType = textDestTypeEl ? textDestTypeEl.value : 'record';
    if (setting.targetType === 'field') {
      setting.textDestType = 'record';
    }

    const textDestField = card.querySelector('[data-role="textDestField"]');
    setting.textDestField = textDestField ? textDestField.value : '';

    const historyTable = card.querySelector('[data-role="historyTable"]');
    setting.historyTable = historyTable ? historyTable.value : '';
    if (setting.saveType !== 'subtable') {
      setting.historyRowGrain = 'perChange';
    }

    setting.historyColumns = Object.assign(emptyHistoryColumns(), setting.historyColumns || {});
    card.querySelectorAll('[data-role="historyColumn"]').forEach((select) => {
      setting.historyColumns[select.dataset.column] = select.value;
    });
    const mappedKeys = new Set(
      getColumnDefsForSetting(setting.targetType, setting.historyRowGrain).map((def) => def.key)
    );
    Object.keys(setting.historyColumns).forEach((key) => {
      if (!mappedKeys.has(key)) {
        setting.historyColumns[key] = '';
      }
    });

    setting.targetFields = [];
    setting.fieldLabels = {};
    card.querySelectorAll('[data-role="target-field"]:checked').forEach((input) => {
      setting.targetFields.push(input.dataset.code);
      setting.fieldLabels[input.dataset.code] = input.dataset.label || input.dataset.code;
    });

    setting.logOnCreate = base.logOnCreate !== false;
    setting.logOnCreateValues = base.logOnCreateValues !== false;
    setting.logRowAdd = base.logRowAdd !== false;
    setting.logRowDelete = base.logRowDelete !== false;
    setting.logAddedRowValues = Boolean(base.logAddedRowValues);

    if (setting.targetType === 'field') {
      const logOnCreateEl = card.querySelector('[data-role="logOnCreate"]');
      const logOnCreateValuesEl = card.querySelector('[data-role="logOnCreateValues"]');
      if (logOnCreateEl) {
        setting.logOnCreate = Boolean(logOnCreateEl.checked);
      }
      if (logOnCreateValuesEl) {
        setting.logOnCreateValues = Boolean(
          setting.logOnCreate && logOnCreateValuesEl.checked
        );
      }
    } else if (setting.targetType === 'subtable') {
      const logCreateOrAddEl = card.querySelector('[data-role="logCreateOrAdd"]');
      const logAddedRowValuesEl = card.querySelector('[data-role="logAddedRowValues"]');
      const logRowDeleteEl = card.querySelector('[data-role="logRowDelete"]');
      if (logCreateOrAddEl) {
        const createOrAdd = Boolean(logCreateOrAddEl.checked);
        setting.logOnCreate = createOrAdd;
        setting.logRowAdd = createOrAdd;
        setting.logAddedRowValues = Boolean(
          createOrAdd && logAddedRowValuesEl && logAddedRowValuesEl.checked
        );
      }
      if (logRowDeleteEl) {
        setting.logRowDelete = Boolean(logRowDeleteEl.checked);
      }
    }

    // 通常フィールドでは明細系マッピングを保持しない
    if (setting.targetType === 'field' && setting.historyColumns) {
      setting.historyColumns.tableName = '';
      setting.historyColumns.rowLabel = '';
      setting.historyColumns.rowNo = '';
    }
    return setting;
  }

  function syncStateFromDom() {
    const cards = Array.from(settingsListEl.querySelectorAll('.history-card'));
    settingsState = cards.map((card) => {
      const current = settingsState.find((s) => s.id === card.dataset.id) || createDefaultSetting();
      current.id = card.dataset.id;
      return readCardToSetting(card, current);
    });
  }

  function setCreateHistoryStatus(card, message, type) {
    const statusEl = card.querySelector('[data-role="create-status"]');
    if (!statusEl) {
      return;
    }
    statusEl.textContent = message || '';
    statusEl.classList.remove('is-error', 'is-success');
    if (type === 'error') {
      statusEl.classList.add('is-error');
    } else if (type === 'success') {
      statusEl.classList.add('is-success');
    }
  }

  function collectExistingFieldCodes(properties) {
    const codes = new Set();
    Object.keys(properties || {}).forEach((code) => {
      codes.add(code);
      const prop = properties[code];
      if (prop && prop.type === 'SUBTABLE' && prop.fields) {
        Object.keys(prop.fields).forEach((innerCode) => codes.add(innerCode));
      }
    });
    return codes;
  }

  function buildUniqueCode(baseCode, existingCodes) {
    if (!existingCodes.has(baseCode)) {
      return baseCode;
    }
    let index = 2;
    while (existingCodes.has(`${baseCode}${index}`)) {
      index += 1;
    }
    return `${baseCode}${index}`;
  }

  function buildUniqueTableName(existingCodes) {
    return buildUniqueCode(HISTORY_TABLE_BASE_NAME, existingCodes);
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function updateAppAndWait(appId) {
    await kintone.api(kintone.api.url('/k/v1/preview/app/deploy.json', true), 'POST', {
      apps: [{ app: appId }]
    });

    for (let i = 0; i < 60; i += 1) {
      const statusResp = await kintone.api(
        kintone.api.url('/k/v1/preview/app/deploy.json', true),
        'GET',
        { 'apps[0]': appId }
      );
      const status = statusResp && statusResp.apps && statusResp.apps[0]
        ? statusResp.apps[0].status
        : null;
      if (status === 'SUCCESS') {
        return;
      }
      if (status === 'FAIL' || status === 'CANCEL') {
        throw new Error('アプリの更新に失敗しました。');
      }
      await sleep(1000);
    }
    throw new Error('アプリの更新が時間内に完了しませんでした。');
  }

  function findMappedFieldCode(fields, key) {
    const aliases = COLUMN_MATCH_ALIASES[key] || [];
    const candidates = aliases.slice();
    if (CREATE_COLUMN_SPECS[key]) {
      candidates.unshift(CREATE_COLUMN_SPECS[key].code);
      candidates.push(CREATE_COLUMN_SPECS[key].label);
    }
    const unique = Array.from(new Set(candidates.filter(Boolean)));

    for (let i = 0; i < unique.length; i += 1) {
      const alias = unique[i];
      const exact = fields.find((f) => f.code === alias || f.label === alias);
      if (exact) {
        return exact.code;
      }
    }

    for (let i = 0; i < unique.length; i += 1) {
      const alias = unique[i];
      const numbered = fields
        .filter((f) => new RegExp(`^${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\d*$`).test(f.code))
        .sort((a, b) => a.code.length - b.code.length || a.code.localeCompare(b.code, 'ja'));
      if (numbered.length) {
        return numbered[0].code;
      }
    }
    return '';
  }

  function autoMapHistoryColumns(tableCode, targetType, rowGrain) {
    const fields = getSubtableFields(tableCode);
    const mapping = emptyHistoryColumns();
    getColumnDefsForSetting(targetType, rowGrain).forEach((def) => {
      mapping[def.key] = findMappedFieldCode(fields, def.key);
    });
    return mapping;
  }

  function buildMappingFromCreatedFields(createdFieldMap, targetType, rowGrain) {
    const mapping = emptyHistoryColumns();
    getColumnDefsForSetting(targetType, rowGrain).forEach((def) => {
      mapping[def.key] = createdFieldMap[def.key] || '';
    });
    return mapping;
  }

  async function createHistorySubtableForSetting(settingId, card) {
    const appId = kintone.app.getId();
    syncStateFromDom();

    setCreateHistoryStatus(card, '既存フィールドを確認しています…', null);
    const fieldsResp = await kintone.api(
      kintone.api.url('/k/v1/preview/app/form/fields.json', true),
      'GET',
      { app: appId }
    );
    const properties = (fieldsResp && fieldsResp.properties) || {};
    const existingCodes = collectExistingFieldCodes(properties);
    const tableName = buildUniqueTableName(existingCodes);
    existingCodes.add(tableName);

    const currentSetting = settingsState.find((s) => s.id === settingId);
    const targetType = currentSetting ? currentSetting.targetType : 'field';
    const rowGrain = currentSetting ? currentSetting.historyRowGrain : 'perChange';
    const columnKeys = isPerSaveGrain(rowGrain)
      ? ['datetime', 'user', 'content']
      : ['datetime', 'user', 'target', 'before', 'after'];
    if (!isPerSaveGrain(rowGrain) && targetType === 'subtable') {
      columnKeys.push('tableName', 'rowLabel', 'rowNo');
    }

    const tableFields = {};
    const createdFieldMap = {};
    columnKeys.forEach((key) => {
      const spec = CREATE_COLUMN_SPECS[key];
      const uniqueCode = buildUniqueCode(spec.code, existingCodes);
      existingCodes.add(uniqueCode);
      tableFields[uniqueCode] = {
        type: spec.type,
        code: uniqueCode,
        label: uniqueCode
      };
      createdFieldMap[key] = uniqueCode;
    });

    setCreateHistoryStatus(card, 'サブテーブルを作成しています…', null);
    await kintone.api(
      kintone.api.url('/k/v1/preview/app/form/fields.json', true),
      'POST',
      {
        app: appId,
        properties: {
          [tableName]: {
            type: 'SUBTABLE',
            code: tableName,
            label: tableName,
            fields: tableFields
          }
        }
      }
    );

    setCreateHistoryStatus(card, 'アプリを更新しています…', null);
    await updateAppAndWait(appId);

    setCreateHistoryStatus(card, 'フィールド一覧を再読み込みしています…', null);
    syncStateFromDom();
    formFields = await loadFormFields();

    const target = settingsState.find((s) => s.id === settingId);
    if (target) {
      target.saveType = 'subtable';
      target.historyTable = tableName;
      target.historyColumns = buildMappingFromCreatedFields(
        createdFieldMap,
        target.targetType,
        target.historyRowGrain
      );
    }
    renderAll();

    const newCard = settingsListEl.querySelector(`.history-card[data-id="${settingId}"]`);
    if (newCard) {
      setCreateHistoryStatus(newCard, `「${tableName}」を作成し、この履歴設定へ割り当てました。アプリの更新も完了しました。`, 'success');
    }
    alert(`履歴用サブテーブル「${tableName}」を作成し、この履歴設定へ割り当てました。\nアプリの更新も完了しました。`);
  }

  function renderAll() {
    settingsListEl.innerHTML = '';
    if (!settingsState.length) {
      settingsState.push(createDefaultSetting());
    }
    settingsState.forEach((setting, index) => {
      settingsListEl.appendChild(renderSettingCard(setting, index));
    });
  }

  function bindCardEvents(card, setting) {
    card.querySelector('[data-role="remove"]').addEventListener('click', () => {
      syncStateFromDom();
      settingsState = settingsState.filter((s) => s.id !== setting.id);
      renderAll();
    });

    const rerender = () => {
      syncStateFromDom();
      renderAll();
    };

    card.querySelectorAll('[data-role="targetType"]').forEach((el) => {
      el.addEventListener('change', () => {
        syncStateFromDom();
        const current = settingsState.find((s) => s.id === setting.id);
        if (current && current.historyTable) {
          current.historyColumns = autoMapHistoryColumns(
            current.historyTable,
            current.targetType,
            current.historyRowGrain
          );
        }
        renderAll();
      });
    });
    card.querySelectorAll('[data-role="savePreset"]').forEach((el) => {
      el.addEventListener('change', () => {
        syncStateFromDom();
        const current = settingsState.find((s) => s.id === setting.id);
        if (current && current.historyTable && current.saveType === 'subtable') {
          current.historyColumns = autoMapHistoryColumns(
            current.historyTable,
            current.targetType,
            current.historyRowGrain
          );
        }
        renderAll();
      });
    });
    card.querySelectorAll('[data-role="textDestType"]').forEach((el) => {
      el.addEventListener('change', rerender);
    });

    const sourceTable = card.querySelector('[data-role="sourceTable"]');
    if (sourceTable) {
      sourceTable.addEventListener('change', rerender);
    }

    const historyTable = card.querySelector('[data-role="historyTable"]');
    if (historyTable) {
      historyTable.addEventListener('change', () => {
        syncStateFromDom();
        const current = settingsState.find((s) => s.id === setting.id);
        if (current) {
          if (current.historyTable) {
            current.historyColumns = autoMapHistoryColumns(
              current.historyTable,
              current.targetType,
              current.historyRowGrain
            );
          } else {
            current.historyColumns = emptyHistoryColumns();
          }
        }
        renderAll();
      });
    }

    const createBtn = card.querySelector('[data-role="create-history-table"]');
    if (createBtn) {
      createBtn.addEventListener('click', async () => {
        createBtn.disabled = true;
        try {
          await createHistorySubtableForSetting(setting.id, card);
        } catch (error) {
          console.error('履歴サブテーブル作成エラー:', error);
          const message = error && error.message ? error.message : '履歴サブテーブルの作成に失敗しました。';
          setCreateHistoryStatus(card, message, 'error');
          alert(message);
        } finally {
          createBtn.disabled = false;
        }
      });
    }

    const bindParentChild = (parentRole, childRole) => {
      const parent = card.querySelector(`[data-role="${parentRole}"]`);
      const child = card.querySelector(`[data-role="${childRole}"]`);
      if (!parent || !child) {
        return;
      }
      parent.addEventListener('change', () => {
        if (!parent.checked) {
          child.checked = false;
          child.disabled = true;
        } else {
          child.disabled = false;
        }
      });
      child.addEventListener('change', () => {
        if (child.checked && !parent.checked) {
          parent.checked = true;
          child.disabled = false;
        }
      });
    };

    bindParentChild('logOnCreate', 'logOnCreateValues');
    bindParentChild('logCreateOrAdd', 'logAddedRowValues');
  }

  function validateSettings(settings) {
    if (!settings.length) {
      throw new Error('履歴設定を1件以上登録してください。');
    }

    settings.forEach((setting, index) => {
      const label = `履歴設定${index + 1}`;
      if (!setting.targetFields || !setting.targetFields.length) {
        if (setting.targetType === 'subtable') {
          const hasCreateOrAdd = setting.logOnCreate !== false || setting.logRowAdd !== false;
          if (!hasCreateOrAdd && setting.logRowDelete === false) {
            throw new Error(`${label}: 対象項目を1つ以上選択するか、新規登録・行追加／削除の記録を有効にしてください。`);
          }
        }
        if (setting.targetType === 'field') {
          throw new Error(`${label}: 対象項目を1つ以上選択してください。`);
        }
      }
      if (setting.targetType === 'subtable' && !setting.sourceTable) {
        throw new Error(`${label}: 対象テーブルを選択してください。`);
      }
      if (setting.saveType === 'text') {
        if (!setting.textDestField) {
          throw new Error(`${label}: 保存先の文字列（複数行）フィールドを選択してください。`);
        }
        if (setting.textDestType === 'row' && setting.targetType !== 'subtable') {
          throw new Error(`${label}: 行内保存はサブテーブル対象時のみ利用できます。`);
        }
      } else if (setting.saveType === 'subtable') {
        if (!setting.historyTable) {
          throw new Error(`${label}: 履歴用サブテーブルを選択してください。`);
        }
        const requiredDefs = getColumnDefsForSetting(setting.targetType, setting.historyRowGrain)
          .filter((def) => def.required);
        requiredDefs.forEach((def) => {
          if (!setting.historyColumns || !setting.historyColumns[def.key]) {
            throw new Error(`${label}: 履歴テーブルの「${def.label}」列マッピングが未設定です。`);
          }
        });
      }
    });
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
        setTrialStatus(authState.trialEndDate);
        return true;
      }

      const message = data.response?.message || '不明なエラー';
      authState.checked = true;
      authState.isValid = false;
      updateSaveButtonState(true, '認証に失敗したため保存できません。');
      setAuthStatus(`認証失敗: ${message}`, true);
      setTrialStatus('');
      alert(buildReloadPromptMessage(`認証失敗: ${message}`));
      return false;
    } catch (error) {
      console.error('起動時認証エラー:', error);
      authState.checked = true;
      authState.isValid = false;
      updateSaveButtonState(true, '認証に失敗したため保存できません。');
      setAuthStatus('認証中にエラーが発生しました。', true);
      setTrialStatus('');
      alert(buildReloadPromptMessage('認証中にエラーが発生しました。'));
      return false;
    }
  }

  addSettingBtn.addEventListener('click', () => {
    syncStateFromDom();
    settingsState.push(createDefaultSetting());
    renderAll();
  });

  saveBtn.addEventListener('click', () => {
    if (!authState.checked || !authState.isValid) {
      alert(buildReloadPromptMessage('認証が完了していないため保存できません。'));
      return;
    }

    try {
      syncStateFromDom();
      validateSettings(settingsState);

      const cleanedSettings = settingsState.map((setting) => {
        const next = Object.assign({}, setting);
        delete next.createManageTableHistory;
        delete next.hideDestOnEdit;
        return next;
      });

      const newConfig = {
        historySettings: JSON.stringify(cleanedSettings),
        hideDestOnEdit: hideDestOnEditEl && hideDestOnEditEl.checked ? 'true' : 'false',
        lockDestOnEdit: lockDestOnEditEl && lockDestOnEditEl.checked ? 'true' : 'false',
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
    formFields = await loadFormFields();
    settingsState = CH.parseAllSettings(config);
    if (!settingsState.length) {
      settingsState = [createDefaultSetting()];
    } else {
      settingsState = settingsState.map((s) => normalizeSetting(s));
    }
    if (hideDestOnEditEl) {
      hideDestOnEditEl.checked = CH.parseHideDestOnEdit(config);
    }
    if (lockDestOnEditEl) {
      lockDestOnEditEl.checked = CH.parseLockDestOnEdit(config);
    }
    renderAll();
    await authenticateOnInitialize();
  } catch (error) {
    console.error(error);
    updateSaveButtonState(true, '初期化に失敗しました。');
    setAuthStatus('初期化に失敗しました。画面をリロードしてください。', true);
    alert('設定画面の初期化に失敗しました。');
  }
})(kintone.$PLUGIN_ID);
