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
  const looksLikeUserArr = (v) => Array.isArray(v) && v[0] && typeof v[0].code === 'string';

  const normalizeType = (type, ents = []) => {
    if (!type) return null;
    if (type === 'ANY') return 'ANYONE';              // 誰でも
    if (type === 'ONE') {
      if (ents.length === 0) return 'FIELD_ENTITY';   // フィールド等から選択
      return 'USER';                                  // 固定 1 ユーザー
    }
    return type; // ORGANIZATION / GROUP など
  };

  // ---------- プロセス管理を取得（キャッシュ） ----------
  let FLOW_CACHE = null;
  let OPEN_ACTIONS = null; // ← 追加: 誰でも実行可アクション（/app/statusのexecutableUser由来）

  const fetchFlow = async () => {
    if (FLOW_CACHE && OPEN_ACTIONS) return FLOW_CACHE;

    const res = await kintone.api(
      kintone.api.url('/k/v1/app/status', true),
      'GET',
      { app: kintone.app.getId() }
    );

    // ステータス名 → { type, rawAssignee }
    const stateInfoMap = {};
    Object.entries(res.states || {}).forEach(([name, st]) => {
      const raw = st.assignee || null; // { type, entities? }
      const ents = Array.isArray(raw?.entities) ? raw.entities : [];
      stateInfoMap[name] = {
        type: normalizeType(raw?.type, ents),
        rawAssignee: raw
      };
    });

    // fromステータス → [ { action, label, nextAsgType, toState, toAssigneeRaw } ]
    const flowMap = {};
    const openAuto = []; // ← 追加: executableUser.entities が空のアクション名を収集

    (res.actions || []).forEach((a) => {
      if (!a.from || !a.to) return;
      (flowMap[a.from] ||= []).push({
        action: a.name,
        label: a.name,
        nextAsgType: stateInfoMap[a.to]?.type || null,
        toState: a.to,
        toAssigneeRaw: stateInfoMap[a.to]?.rawAssignee || null
      });

      // 追加: 誰でも実行可判定（executableUser.entities が空配列）
      if (a.executableUser && Array.isArray(a.executableUser.entities) && a.executableUser.entities.length === 0) {
        openAuto.push(a.name);
      }
    });

    FLOW_CACHE = flowMap;
    OPEN_ACTIONS = openAuto; // ← 追加

    return FLOW_CACHE;
  };

  // ---------- レコードの現在ステータス・作業者 ----------
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

    // 作成者（差し戻し等で使う場合があるため念のため拾う）
    const creator = rec.CREATOR?.value || rec['作成者']?.value || null;

    return { statusVal, assignees, creator };
  };

  // ---------- 権限制御（担当者以外には表示しない等の制御） ----------
  const canShow = (assignees) => {
    if (!assignees.length) return true; // 未設定なら表示
    const me = kintone.getLoginUser().code;
    return assignees.some((u) => u.code === me);
  };

  // ---------- ボタン生成 ----------
  const mkBtn = (label, disabled) => {
    const b = document.createElement('button');
    b.type = 'button'; // 小改善: submit 副作用を防止
    b.textContent = label;
    b.className = disabled
      ? 'kintoneplugin-button-disabled'
      : 'kintoneplugin-button-normal';
    b.disabled = !!disabled;
    b.style.margin = '0 4px';
    return b;
  };

  // ---------- 遷移先の割当情報から作業者を推定 ----------
  // - 固定ユーザーが1名ならその code
  // - 「差し戻す」等で申請者へ戻す運用を想定し、作成者コードを採用（ある場合）
  // - 推定不可なら null（＝メンテが必要、ボタンは無効のまま）
  const deriveAssigneeForAction = (rec, flow) => {
    const raw = flow.toAssigneeRaw || {};
    const ents = Array.isArray(raw.entities) ? raw.entities : [];

    // 固定1ユーザーに確定
    if (ents.length === 1 && ents[0]?.type === 'USER' && ents[0]?.code) {
      return ents[0].code;
    }

    // “差し戻す”系は作成者へ戻す簡易推定（運用に合わせて調整可）
    if (/差し戻/.test(flow.action) || /戻/.test(flow.action)) {
      const cr = rec.CREATOR?.value || rec['作成者']?.value || null;
      if (cr && cr.code) return cr.code;
    }

    // TODO: FIELD_ENTITY 等のときは、該当フィールドの単一ユーザー値を読む拡張が可能
    return null;
  };

  // ---------- ボタン挿入 ----------
  const insertBtns = (rec, cell) => {
    if (!cell) return;

    const flowMap = FLOW_CACHE || {};
    const { statusVal, assignees } = getStatusInfo(rec);
    let flows = flowMap[statusVal] || [];

    // 表示するアクションを制限
    if (ALLOWED_ACTIONS.length > 0) {
      flows = flows.filter((f) => ALLOWED_ACTIONS.includes(f.action));
    }
    if (!flows.length) return;

    // 追加: 担当者でない場合は「誰でも実行可（OPEN_ACTIONS）」に限定
    const me = kintone.getLoginUser().code;
    const hasAssignee = (assignees || []).length > 0;
    const isMeAssignee = hasAssignee && (assignees || []).some(u => u && u.code === me);

    // 担当者が「いる」かつ「自分ではない」場合のみ、OPEN_ACTIONS で絞り込む
    if (hasAssignee && !isMeAssignee) {
      flows = Array.isArray(OPEN_ACTIONS) && OPEN_ACTIONS.length > 0
        ? flows.filter(f => OPEN_ACTIONS.includes(f.action))
        : []; // 誰でも実行可がなければ非表示
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
      const assigneeCode = deriveAssigneeForAction(rec, f);

      // USER に割当が必要な場合は単一ユーザーが推定できるときのみ有効
      // ORGANIZATION/GROUP/ANYONE/FIELD_ENTITY 等は基本 assignee 不要想定（PUT 側で最終判定）
      const ok = (f.nextAsgType === 'USER') ? !!assigneeCode : true;

      const btn = mkBtn(f.label, !ok);

      if (ok) {
        btn.onclick = async () => {
          try {
            // ← ここを差し替え
            const payload = {
              app: kintone.app.getId(),
              id: rec.$id.value,
              action: f.action
            };
            // assignee は「次ステータスの割当が USER」のときだけ付与
            if (f.nextAsgType === 'USER' && assigneeCode) {
              payload.assignee = assigneeCode;
            }

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
            console.error('Process-action error', err);
            const code = err?.code || err?.messageCode;
            const msg = (code === 'GAIA_IL03')
              ? 'ステータス変更に失敗しました。ほかのユーザーがステータスを変更したか、アクションの実行条件を満たしていません。'
              : err?.message || code || (err?.errors ? JSON.stringify(err.errors) : '不明なエラー');
            alert(msg);
            btn.disabled = false;
          }
        };

      } else {
        btn.title = '作業者の選択が必要です（プロセスの割当設定をご確認ください）';
      }

      cell.appendChild(btn);
    }
  };

  // ---------- 一覧イベント ----------
  kintone.events.on('app.record.index.show', async (e) => {
    await fetchFlow(); // 最初に一度だけ取得（以後はキャッシュ）
    const cells = kintone.app.getFieldElements(OP_FIELD_CODE) || [];
    (e.records || []).forEach((rec, idx) => insertBtns(rec, cells[idx]));
  });

  kintone.events.on('app.record.index.refresh', (e) => {
    const cells = kintone.app.getFieldElements(OP_FIELD_CODE) || [];
    (e.records || []).forEach((rec, idx) => insertBtns(rec, cells[idx]));
  });

  // 一覧のインライン編集 保存後に再描画（再マウント）
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

  // ---------- 入力画面（作成・編集）で操作フィールドを非表示 ----------
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
