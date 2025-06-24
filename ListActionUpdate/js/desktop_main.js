
((PLUGIN_ID) => {
  'use strict';

  // ---------- 0. 設定 ----------
  const cfg = kintone.plugin.app.getConfig(PLUGIN_ID) || {};
  const OP_FIELD_CODE = cfg.opFieldCode || '';
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

  /* ---------- 共通ユーティリティ ---------- */
  const looksLikeUserArr = (v) => Array.isArray(v) && v[0] && typeof v[0].code === 'string';

  const normalizeType = (type, ents = []) => {
    if (!type) return null;
    if (type === 'ANY') return 'ANYONE';              // 誰でも
    if (type === 'ONE') {
      if (ents.length === 0) return 'FIELD_ENTITY';   // 次ユーザーから選択
      return 'USER';                                  // 固定 1 ユーザー
    }
    return type; // ORGANIZATION / GROUP
  };

  /* ---------- プロセス管理を取得 ---------- */
  let FLOW_CACHE = null;
  const fetchFlow = async () => {
    if (FLOW_CACHE) return FLOW_CACHE;
    const res = await kintone.api(
      kintone.api.url('/k/v1/app/status', true),
      'GET',
      { app: kintone.app.getId() }
    );

    const stateTypeMap = {};
    Object.entries(res.states || {}).forEach(([name, st]) => {
      stateTypeMap[name] = normalizeType(st.assignee?.type, st.assignee?.entities);
    });

    const flowMap = {};
    (res.actions || []).forEach((a) => {
      if (!a.from || !a.to) return;
      (flowMap[a.from] ||= []).push({
        action: a.name,
        label : a.name,
        nextAsgType: stateTypeMap[a.to] || null
      });
    });
    return (FLOW_CACHE = flowMap);
  };

  /* ---------- レコードの現在ステータス・作業者 ---------- */
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

  /* ---------- 権限制御 ---------- */
  const canShow = (assignees) => {
    if (!assignees.length) return true;                    // 未設定
    const me = kintone.getLoginUser().code;
    return assignees.some((u) => u.code === me);
  };

  /* ---------- ボタン生成 ---------- */
  const mkBtn = (label, disabled) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.className  = disabled ? 'button-disabled-gaia' : 'button-normal-gaia';
    b.disabled   = !!disabled;
    b.style.margin = '0 4px';
    return b;
  };

  /* ---------- ボタン挿入 ---------- */
  const insertBtns = async (rec, cell) => {
    const flowMap = await fetchFlow();
    const { statusVal, assignees } = getStatusInfo(rec);
    let flows = flowMap[statusVal] || [];

    // -- チェックで許可されたアクションのみ表示 --
    if (ALLOWED_ACTIONS.length > 0) {
      flows = flows.filter((f) => ALLOWED_ACTIONS.includes(f.action));
    }

    if (!flows.length || !canShow(assignees)) return;

    cell.innerHTML = '';
    cell.style.textAlign     = 'left';
    cell.style.verticalAlign = 'middle';
    cell.style.padding       = '0';
    cell.style.whiteSpace    = 'nowrap';

    flows.forEach((f) => {
      const disabled = f.nextAsgType === 'USER';
      const btn = mkBtn(f.label, disabled);
      if (!disabled) {
        btn.onclick = async () => {
          try {
            await kintone.api(
              kintone.api.url('/k/v1/record/status', true),
              'PUT',
              {
                app: kintone.app.getId(),
                id : rec.$id.value,
                action: f.action
              }
            );

            /* ---------- 一覧の軽量リロード ---------- */
            if (kintone?.app?.recordList && typeof kintone.app.recordList.refresh === 'function') {
              kintone.app.recordList.refresh(); // PC一覧のみ
            } else {
              location.reload();                // フォールバック
            }
          } catch (err) {
            console.error('Process‑action error', err);
            const code = err?.code || err?.messageCode;
            const msg = (code === 'GAIA_IL03')
              ? 'ステータス変更に失敗しました。ほかのユーザーがステータスを変更したか、アクションの実行条件を満たしていません。'
              : err?.message || code || (err?.errors ? JSON.stringify(err.errors) : '不明なエラー');
            alert(msg);
          }
        };
      }
      cell.appendChild(btn);
    });
  };

  /* ---------- 一覧イベント ---------- */
  kintone.events.on('app.record.index.show', (e) => {
    const cells = kintone.app.getFieldElements(OP_FIELD_CODE) || [];
    e.records.forEach((rec, idx) => insertBtns(rec, cells[idx]));
  });

  /* ---------- 一覧リフレッシュ後の再描画 ---------- */
  kintone.events.on('app.record.index.refresh', (e) => {
    const cells = kintone.app.getFieldElements(OP_FIELD_CODE) || [];
    e.records.forEach((rec, idx) => insertBtns(rec, cells[idx]));
  });
})(kintone.$PLUGIN_ID);
