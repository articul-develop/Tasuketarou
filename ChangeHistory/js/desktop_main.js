/* ==============================================
 *  変更履歴管理プラグイン – desktop_main.js
 *  PC / Mobile / 詳細 / 一覧 共通
 * ============================================== */
((PLUGIN_ID) => {
  'use strict';

  const CH = window.ChangeHistory;
  if (!CH) {
    console.error('ChangeHistory modules are not loaded.');
    return;
  }

  const config = kintone.plugin.app.getConfig(PLUGIN_ID) || {};
  const allSettings = CH.parseAllSettings(config);
  const settings = CH.parseSettings(config);
  const hideDestOnEdit = CH.parseHideDestOnEdit(config);
  const lockDestOnEdit = CH.parseLockDestOnEdit(config);

  if (!settings.length) {
    return;
  }

  let editSnapshot = null;
  let indexSnapshots = {};

  const authOk = () => !window.isAuthenticated || window.isAuthenticated();

  // 履歴サブテーブル書き込み用にフィールド型を先読み
  CH.ensureFieldTypesLoaded();

  const rejectWithPluginError = (event, errors) => {
    event.error = CH.buildPluginErrorMessage(errors);
    return event;
  };

  const rejectWithWriteError = (event, error, logLabel) => {
    console.error(logLabel, error);
    CH.ensureErrorMessageLineBreaks();
    event.error = [
      '【変更履歴管理】履歴の書き込み中にエラーが発生したため、保存を中止しました。',
      '',
      error && error.message ? error.message : '不明なエラー',
      '',
      '画面を再読み込みしてから再度お試しください。'
    ].join('\n');
    return event;
  };

  const applyHistory = (event, oldRecord, isCreate) => {
    const validation = CH.validateSettingsAgainstForm(settings);
    if (!validation.ok) {
      return rejectWithPluginError(event, validation.errors);
    }

    try {
      const changes = CH.detectChanges(event.record, oldRecord, allSettings, { isCreate: Boolean(isCreate) });
      if (changes.length) {
        CH.applyChanges(event.record, changes);
      }
    } catch (error) {
      return rejectWithWriteError(event, error, '変更履歴の書き込みに失敗しました');
    }
    return event;
  };

  // ---------- 詳細：表示時スナップショット ----------
  kintone.events.on([
    'app.record.edit.show',
    'mobile.app.record.edit.show'
  ], (event) => {
    editSnapshot = CH.deepCopy(event.record);
    CH.ensureFieldTypesLoaded();
    CH.applyDestinationFieldUi(event, allSettings, { hideDestOnEdit, lockDestOnEdit });
    return event;
  });

  kintone.events.on([
    'app.record.create.show',
    'mobile.app.record.create.show'
  ], (event) => {
    editSnapshot = null;
    CH.ensureFieldTypesLoaded();

    // レコード再利用時は、コピー元の履歴文字列・履歴サブテーブルを初期化する
    if (event.reuse) {
      CH.clearHistoryDestinations(event.record, allSettings);
    }

    CH.applyDestinationFieldUi(event, allSettings, { hideDestOnEdit, lockDestOnEdit });
    return event;
  });

  // ---------- 詳細：保存時 ----------
  kintone.events.on([
    'app.record.create.submit',
    'mobile.app.record.create.submit'
  ], (event) => {
    if (!authOk()) {
      return event;
    }
    return CH.ensureFieldTypesLoaded()
      .then(() => applyHistory(event, null, true))
      .catch((error) => rejectWithWriteError(event, error, '変更履歴（新規）処理に失敗しました'));
  });

  kintone.events.on([
    'app.record.edit.submit',
    'mobile.app.record.edit.submit'
  ], (event) => {
    if (!authOk()) {
      return event;
    }

    const run = (oldRecord) => applyHistory(event, oldRecord, false);

    return CH.ensureFieldTypesLoaded().then(() => {
      if (editSnapshot) {
        return run(editSnapshot);
      }

      const recordId = CH.getRecordIdSafe(event.record);
      if (!recordId) {
        return event;
      }

      return CH.fetchRecordById(recordId)
        .then((oldRecord) => run(oldRecord))
        .catch((error) => {
          console.error('変更履歴の比較用レコード取得に失敗しました', error);
          return event;
        });
    }).catch((error) => rejectWithWriteError(event, error, '変更履歴（編集）処理に失敗しました'));
  });

  // ---------- 一覧インライン編集 ----------
  const indexShowEvents = [
    'app.record.index.edit.show',
    'mobile.app.record.index.edit.show'
  ];

  kintone.events.on(indexShowEvents, (event) => {
    CH.applyDestinationFieldUi(event, allSettings, { hideDestOnEdit, lockDestOnEdit });
    indexSnapshots = {};
    const records = Array.isArray(event.records) ? event.records : [];

    records.forEach((record) => {
      const recordId = record.$id && record.$id.value;
      if (recordId) {
        indexSnapshots[recordId] = CH.deepCopy(record);
      }
    });

    if (records.length > 0) {
      return event;
    }

    // 一部環境では records が空のため、表示中クエリで補完
    return CH.fetchRecordsByCurrentIndexQuery().then((apiRecords) => {
      if (Array.isArray(apiRecords)) {
        apiRecords.forEach((record) => {
          const recordId = record.$id && record.$id.value;
          if (recordId) {
            indexSnapshots[recordId] = CH.deepCopy(record);
          }
        });
      }
      return event;
    });
  });

  const indexSubmitEvents = [
    'app.record.index.edit.submit',
    'mobile.app.record.index.edit.submit'
  ];

  kintone.events.on(indexSubmitEvents, (event) => {
    if (!authOk()) {
      return event;
    }

    const recordId = event.record && event.record.$id ? event.record.$id.value : null;
    const run = (oldRecord) => {
      const result = applyHistory(event, oldRecord, false);
      // 設定不整合で止めた場合はスナップショットを更新しない
      if (!result.error && recordId) {
        indexSnapshots[recordId] = CH.deepCopy(event.record);
      }
      return result;
    };

    return CH.ensureFieldTypesLoaded().then(() => {
      if (recordId && indexSnapshots[recordId]) {
        return run(indexSnapshots[recordId]);
      }

      if (!recordId) {
        return event;
      }

      return CH.fetchRecordById(recordId)
        .then((oldRecord) => run(oldRecord))
        .catch((error) => {
          console.error('一覧編集の変更履歴比較に失敗しました', error);
          return event;
        });
    }).catch((error) => rejectWithWriteError(event, error, '一覧編集の変更履歴処理に失敗しました'));
  });

  // 明細行内の履歴文字列／履歴テーブルは、行追加後も編集不可にする
  const destTargets = CH.collectDestinationTargets(allSettings);
  const lockTableCodes = Array.from(new Set([
    ...destTargets.historyTables,
    ...destTargets.rowFields.map((item) => item.tableCode).filter(Boolean)
  ]));
  const lockTableChangeEvents = [];
  lockTableCodes.forEach((tableCode) => {
    lockTableChangeEvents.push(
      `app.record.create.change.${tableCode}`,
      `app.record.edit.change.${tableCode}`,
      `mobile.app.record.create.change.${tableCode}`,
      `mobile.app.record.edit.change.${tableCode}`
    );
  });
  if (lockTableChangeEvents.length) {
    kintone.events.on(lockTableChangeEvents, (event) => {
      CH.applyDestinationFieldUi(event, allSettings, { lockDestOnEdit });
      return event;
    });
  }
})(kintone.$PLUGIN_ID);
