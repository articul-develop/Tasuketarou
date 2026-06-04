/* ==============================================
 *  Lookup Field Edit Plugin – desktop_main.js
 *  PC & Mobile 共通
 * ============================================== */
(function(PLUGIN_ID) {
  'use strict';

  var SHOW_EVENTS = [
    'app.record.create.show', 'mobile.app.record.create.show',
    'app.record.edit.show', 'mobile.app.record.edit.show'
  ];

  var cfg = kintone.plugin.app.getConfig(PLUGIN_ID) || {};
  var editableFieldSet = buildEditableFieldSet(cfg.editableFields);

  var lookupConfigPromise = null;
  var changeEventsRegistered = false;

  if (Object.keys(editableFieldSet).length === 0) {
    return;
  }

  kintone.events.on(SHOW_EVENTS, function(event) {
    return getLookupConfig().then(function(config) {
      if (isAuthenticated()) {
        enableLookupCopyFields(event.record, config, null);
      }
      registerChangeEvents(config);
      return event;
    }).catch(function(error) {
      console.error('ルックアップコピー先フィールドの編集可制御に失敗しました。', error);
      return event;
    });
  });

  getLookupConfig().then(function(config) {
    registerChangeEvents(config);
  }).catch(function(error) {
    console.error('ルックアップ設定の取得に失敗しました。', error);
  });

  function isAuthenticated() {
    return typeof window.isAuthenticated === 'function' && window.isAuthenticated();
  }

  function buildEditableFieldSet(rawEditableFields) {
    var set = {};

    if (!rawEditableFields) {
      return set;
    }

    try {
      var parsed = JSON.parse(rawEditableFields);
      if (Array.isArray(parsed)) {
        parsed.forEach(function(fieldCode) {
          set[fieldCode] = true;
        });
      }
    } catch (error) {
      console.error('editableFields の解析に失敗しました。', error);
    }

    return set;
  }

  function getLookupConfig() {
    if (!lookupConfigPromise) {
      lookupConfigPromise = fetchFormProperties().then(function(properties) {
        return buildLookupConfig(properties);
      });
    }

    return lookupConfigPromise;
  }

  function fetchFormProperties() {
    if (kintone.app && typeof kintone.app.getFormFields === 'function') {
      return kintone.app.getFormFields();
    }

    return kintone.api(kintone.api.url('/k/v1/app/form/fields.json', true), 'GET', {
      app: kintone.app.getId()
    }).then(function(response) {
      return response.properties;
    });
  }

  function buildLookupConfig(properties) {
    var topLevelCopyFieldCodeMap = {};
    var tableCopyFieldCodeMapByTable = {};
    var triggerFieldCodeMap = {};
    var tableFieldCodeMap = {};

    collectLookupConfig(properties, null, topLevelCopyFieldCodeMap, tableCopyFieldCodeMapByTable, triggerFieldCodeMap, tableFieldCodeMap);

    return {
      topLevelCopyFieldCodes: Object.keys(topLevelCopyFieldCodeMap),
      tableCopyFieldCodesByTable: toFieldCodeListMap(tableCopyFieldCodeMapByTable),
      triggerFieldCodes: Object.keys(triggerFieldCodeMap),
      tableFieldCodes: Object.keys(tableFieldCodeMap)
    };
  }

  function collectLookupConfig(properties, parentTableCode, topLevelCopyFieldCodeMap, tableCopyFieldCodeMapByTable, triggerFieldCodeMap, tableFieldCodeMap) {
    Object.keys(properties || {}).forEach(function(fieldCode) {
      var field = properties[fieldCode];

      if (field.lookup && Array.isArray(field.lookup.fieldMappings)) {
        var hasEditableMapping = false;

        field.lookup.fieldMappings.forEach(function(mapping) {
          if (mapping && mapping.field && editableFieldSet[mapping.field]) {
            if (parentTableCode) {
              tableCopyFieldCodeMapByTable[parentTableCode] = tableCopyFieldCodeMapByTable[parentTableCode] || {};
              tableCopyFieldCodeMapByTable[parentTableCode][mapping.field] = true;
            } else {
              topLevelCopyFieldCodeMap[mapping.field] = true;
            }
            triggerFieldCodeMap[mapping.field] = true;
            hasEditableMapping = true;
          }
        });

        if (hasEditableMapping) {
          triggerFieldCodeMap[fieldCode] = true;
        }
      }

      if (field.type === 'SUBTABLE' && field.fields) {
        tableFieldCodeMap[fieldCode] = true;
        collectLookupConfig(field.fields, fieldCode, topLevelCopyFieldCodeMap, tableCopyFieldCodeMapByTable, triggerFieldCodeMap, tableFieldCodeMap);
      }
    });
  }

  function registerChangeEvents(config) {
    if (changeEventsRegistered || !config || config.triggerFieldCodes.length === 0) {
      return;
    }

    var changeEvents = [];

    config.triggerFieldCodes.forEach(function(fieldCode) {
      changeEvents.push('app.record.create.change.' + fieldCode);
      changeEvents.push('app.record.edit.change.' + fieldCode);
      changeEvents.push('mobile.app.record.create.change.' + fieldCode);
      changeEvents.push('mobile.app.record.edit.change.' + fieldCode);
    });

    config.tableFieldCodes.forEach(function(fieldCode) {
      changeEvents.push('app.record.create.change.' + fieldCode);
      changeEvents.push('app.record.edit.change.' + fieldCode);
      changeEvents.push('mobile.app.record.create.change.' + fieldCode);
      changeEvents.push('mobile.app.record.edit.change.' + fieldCode);
    });

    kintone.events.on(changeEvents, function(event) {
      if (!isAuthenticated()) {
        return event;
      }
      enableLookupCopyFields(event.record, config, event.changes ? event.changes.row : null);
      return event;
    });

    changeEventsRegistered = true;
  }

  function enableLookupCopyFields(record, config, changedRow) {
    config.topLevelCopyFieldCodes.forEach(function(fieldCode) {
      if (!record[fieldCode]) {
        return;
      }

      record[fieldCode].disabled = false;
    });

    if (changedRow && changedRow.value) {
      enableTableLookupCopyFieldsInRow(changedRow, config.tableCopyFieldCodesByTable);
      return;
    }

    Object.keys(config.tableCopyFieldCodesByTable).forEach(function(tableCode) {
      var table = record[tableCode];
      if (!table || !Array.isArray(table.value)) {
        return;
      }

      table.value.forEach(function(row) {
        enableFieldsInRow(row, config.tableCopyFieldCodesByTable[tableCode]);
      });
    });
  }

  function enableTableLookupCopyFieldsInRow(row, tableCopyFieldCodesByTable) {
    Object.keys(tableCopyFieldCodesByTable).forEach(function(tableCode) {
      enableFieldsInRow(row, tableCopyFieldCodesByTable[tableCode]);
    });
  }

  function enableFieldsInRow(row, fieldCodes) {
    if (!row || !row.value || !Array.isArray(fieldCodes)) {
      return;
    }

    fieldCodes.forEach(function(fieldCode) {
      if (!row.value[fieldCode]) {
        return;
      }

      row.value[fieldCode].disabled = false;
    });
  }

  function toFieldCodeListMap(fieldCodeMapByKey) {
    var result = {};

    Object.keys(fieldCodeMapByKey).forEach(function(key) {
      result[key] = Object.keys(fieldCodeMapByKey[key]);
    });

    return result;
  }
})(kintone.$PLUGIN_ID);
