((PLUGIN_ID) => {
  'use strict';

  // ---------- 設定 ----------
  const cfg = kintone.plugin.app.getConfig(PLUGIN_ID) || {};
  const OP_FIELD_CODE = cfg.opFieldCode || '';
  const HIDE_ON_INPUT = cfg.hideOnInput === 'true';
  const ALLOWED_ACTIONS = (() => {
    try {
      return JSON.parse(cfg.allowedActions || '[]');
    } catch (_) {
      return [];
    }
  })();

  if (!OP_FIELD_CODE) {
    alert('プラグイン設定が未完了です。設定画面で操作フィールドを選択してください。');
    return;
  }

  // ---------- ユーティリティ ----------
  const normEntityRef = (item) => {
    const obj = item?.entity ? item.entity : item;
    return { type: obj?.type, code: obj?.code };
  };

  const looksLikeUserArr = (v) => Array.isArray(v) && v[0] && typeof v[0].code === 'string';

  const normalizeType = (type, ents = []) => {
    if (!type) return null;
    if (type === 'ANY') return 'ANYONE';
    if (type === 'ONE') {
      if (ents.length === 0) return 'FIELD_ENTITY';
      return 'USER';
    }
    return type;
  };

  // ---------- キャッシュ等 ----------
  let FLOW_CACHE = null;
  let OPEN_ACTIONS = null;
  const resolveCache = new Map(); // key: `${recordId}:${fieldCode}` -> code

  // ---------- プロセス設定を取得 ----------
  const fetchFlow = async () => {
    if (FLOW_CACHE && OPEN_ACTIONS) return FLOW_CACHE;
    try {
      const res = await kintone.api(
        kintone.api.url('/k/v1/app/status', true),
        'GET',
        { app: kintone.app.getId() }
      );

      const stateInfoMap = {};
      Object.entries(res.states || {}).forEach(([name, st]) => {
        const raw = st.assignee || null;
        const ents = Array.isArray(raw?.entities) ? raw.entities.map(normEntityRef) : [];
        stateInfoMap[name] = {
          type: normalizeType(raw?.type, ents),
          rawAssignee: raw
        };
      });

      const flowMap = {};
      const openAuto = [];
      (res.actions || []).forEach((a) => {
        if (!a.from || !a.to) return;
        (flowMap[a.from] ||= []).push({
          action: a.name,
          label: a.name,
          nextAsgType: stateInfoMap[a.to]?.type || null,
          toState: a.to,
          toAssigneeRaw: stateInfoMap[a.to]?.rawAssignee || null
        });

        if (a.executableUser && Array.isArray(a.executableUser.entities) && a.executableUser.entities.length === 0) {
          openAuto.push(a.name);
        }
      });

      FLOW_CACHE = flowMap;
      OPEN_ACTIONS = openAuto;
      return FLOW_CACHE;
    } catch (err) {
      // フェールセーフ: 空のマップで継続（UI が壊れないように）
      FLOW_CACHE = FLOW_CACHE || {};
      OPEN_ACTIONS = OPEN_ACTIONS || [];
      return FLOW_CACHE;
    }
  };

  // ---------- レコード情報取得（一覧のrecからステータス・assigneeを読み取る） ----------
  const getStatusInfo = (rec) => {
    let statusVal = rec.$status?.value ?? '';
    let assignees = rec.$status?.assignee ? [rec.$status.assignee] : [];

    const dfs = (obj) => {
      for (const key in obj) {
        const f = obj[key];
        if (!f) continue;
        if (!statusVal && (f.type === 'STATUS' || key === 'ステータス')) statusVal = f.value;
        if (!assignees.length && looksLikeUserArr(f.value)) assignees = f.value;
        if (f.type === 'SUBTABLE' && f.value) f.value.forEach((row) => dfs(row.value || {}));
      }
    };
    dfs(rec);
    return { statusVal, assignees };
  };

  // ---------- ボタン生成（kintoneプラグイン風） ----------
  const mkBtn = (label, disabled) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.className = disabled ? 'kintoneplugin-button-disabled' : 'kintoneplugin-button-normal';
    b.disabled = !!disabled;
    b.style.margin = '0 4px';
    return b;
  };

  // ---------- FIELD 解決（キャッシュ付き） ----------
  const resolveAssigneeFromField = async (appId, recordId, fieldCode, rec) => {
    const cacheKey = `${recordId}:${fieldCode}`;
    if (resolveCache.has(cacheKey)) return resolveCache.get(cacheKey);

    const pickSingleFromRec = (r, code) => {
      if (!r || !code) return null;
      const f = r[code];
      if (!f) return null;
      if (f.value && typeof f.value === 'object' && f.value.code) return f.value.code;
      if (Array.isArray(f.value)) {
        const users = f.value.filter(u => u && u.code);
        if (users.length === 1) return users[0].code;
      }
      for (const k in r) {
        const fld = r[k];
        if (!fld || fld.type !== 'SUBTABLE' || !Array.isArray(fld.value)) continue;
        const collected = [];
        for (const row of fld.value) {
          const cell = row?.value?.[code];
          if (!cell) continue;
          if (cell.value && Array.isArray(cell.value)) {
            collected.push(...cell.value.filter(u => u && u.code));
          } else if (cell.value && cell.value.code) {
            collected.push(cell.value);
          }
        }
        if (collected.length > 0) {
          const uniqCodes = [...new Set(collected.map(u => u.code))];
          if (uniqCodes.length === 1) return uniqCodes[0];
        }
      }
      return null;
    };

    const singleFromRec = pickSingleFromRec(rec, fieldCode);
    if (singleFromRec) {
      resolveCache.set(cacheKey, singleFromRec);
      return singleFromRec;
    }

    try {
      const resp = await kintone.api(kintone.api.url('/k/v1/record', true), 'GET', { app: appId, id: recordId });
      const r = resp?.record || null;
      const singleFromFull = pickSingleFromRec(r, fieldCode);
      if (singleFromFull) {
        resolveCache.set(cacheKey, singleFromFull);
        return singleFromFull;
      }
    } catch (_) {
      // record API が失敗しても null を返す
    }
    resolveCache.set(cacheKey, null);
    return null;
  };

  // ---------- 次作業者の推定 ----------
  const deriveAssigneeForAction = async (rec, flow) => {
    const raw = flow.toAssigneeRaw || {};
    const entsRaw = Array.isArray(raw.entities) ? raw.entities : [];
    const ents = entsRaw.map(normEntityRef);

    if (ents.length === 1 && ents[0]?.type === 'USER' && ents[0]?.code) {
      return ents[0].code;
    }

    const fieldEnt = ents.find(e => e?.type === 'FIELD' || e?.type === 'FIELD_ENTITY');
    if (fieldEnt && fieldEnt.code) {
      const appId = kintone.app.getId();
      const recordId = rec.$id?.value || (rec['$id'] && rec['$id'].value) || null;
      if (!recordId) return null;
      const resolved = await resolveAssigneeFromField(appId, recordId, fieldEnt.code, rec);
      if (resolved) return resolved;
      return null;
    }

    return null;
  };

  // ---------- ボタンを一覧セルに挿入 ----------
  const insertBtns = async (rec, cell) => {
    if (!cell) return;

    const flowMap = FLOW_CACHE || {};
    const { statusVal, assignees } = getStatusInfo(rec);
    let flows = flowMap[statusVal] || [];

    if (ALLOWED_ACTIONS.length > 0) {
      flows = flows.filter((f) => ALLOWED_ACTIONS.includes(f.action));
    }
    if (!flows.length) return;

    const me = kintone.getLoginUser().code;
    const hasAssignee = (assignees || []).length > 0;
    const isMeAssignee = hasAssignee && (assignees || []).some(u => u && u.code === me);

    if (hasAssignee && !isMeAssignee) {
      flows = Array.isArray(OPEN_ACTIONS) && OPEN_ACTIONS.length > 0
        ? flows.filter(f => OPEN_ACTIONS.includes(f.action))
        : [];
      if (!flows.length) {
        cell.innerHTML = '';
        return;
      }
    }

    cell.innerHTML = '';
    cell.style.textAlign = 'left';
    cell.style.verticalAlign = 'middle';
    cell.style.padding = '0';
    cell.style.whiteSpace = 'nowrap';

    for (const f of flows) {
      const entsToRaw = Array.isArray(f.toAssigneeRaw?.entities) ? f.toAssigneeRaw.entities : [];
      const entsTo = entsToRaw.map(normEntityRef);

      let assigneeCode = null;
      try {
        assigneeCode = await deriveAssigneeForAction(rec, f);
      } catch (_) {
        assigneeCode = null;
      }

      const isNextRequiresUser = (f.nextAsgType === 'USER');

      const btn = mkBtn(f.label, false);

      btn.onclick = async () => {
        try {
          if (isNextRequiresUser) {
            const appId = kintone.app.getId();
            const recordId = rec.$id && rec.$id.value;
            window.location.href = '/k/' + appId + '/show?record=' + recordId;
            return;
          }

          const payload = {
            app: kintone.app.getId(),
            id: rec.$id.value,
            action: f.action
          };

          await kintone.api(
            kintone.api.url('/k/v1/record/status', true),
            'PUT',
            payload
          );

          if (kintone?.app?.recordList && typeof kintone.app.recordList.refresh === 'function') {
            kintone.app.recordList.refresh();
          } else {
            location.reload();
          }
        } catch (err) {
          const code = err?.code || err?.messageCode;
          const msg = (code === 'GAIA_IL03')
            ? 'ステータス変更に失敗しました。ほかのユーザーがステータスを変更したか、アクションの実行条件を満たしていません。'
            : err?.message || code || (err?.errors ? JSON.stringify(err.errors) : '不明なエラー');
          alert(msg);
          btn.disabled = false;
        }
      };

      cell.appendChild(btn);
    }
  };

  // ---------- イベント登録 ----------
  kintone.events.on('app.record.index.show', async (e) => {
    await fetchFlow();
    const cells = kintone.app.getFieldElements(OP_FIELD_CODE) || [];
    const records = e.records || [];
    for (let i = 0; i < records.length; i++) {
      try {
        await insertBtns(records[i], cells[i]);
      } catch (_) { /* 個別失敗は無視して次へ */ }
    }
  });

  kintone.events.on('app.record.index.refresh', async (e) => {
    const cells = kintone.app.getFieldElements(OP_FIELD_CODE) || [];
    const records = e.records || [];
    for (let i = 0; i < records.length; i++) {
      try {
        await insertBtns(records[i], cells[i]);
      } catch (_) { /* 個別失敗は無視して次へ */ }
    }
  });

  kintone.events.on('app.record.index.edit.submit.success', (e) => {
    try {
      if (kintone?.app?.recordList && typeof kintone.app.recordList.refresh === 'function') {
        kintone.app.recordList.refresh();
        return e;
      }
    } catch (_) { /* noop */ }
    setTimeout(() => location.reload(), 0);
    return e;
  });

  if (HIDE_ON_INPUT && OP_FIELD_CODE) {
    kintone.events.on(
      ['app.record.create.show', 'app.record.edit.show'],
      function (event) {
        kintone.app.record.setFieldShown(OP_FIELD_CODE, false);
        return event;
      }
    );

    if (kintone.mobile && kintone.mobile.events) {
      kintone.mobile.events.on(
        ['mobile.app.record.create.show', 'mobile.app.record.edit.show'],
        function (event) {
          kintone.app.record.setFieldShown(OP_FIELD_CODE, false);
          return event;
        }
      );
    }
  }

})(kintone.$PLUGIN_ID);
