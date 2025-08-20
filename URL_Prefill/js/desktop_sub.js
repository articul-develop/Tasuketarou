// 初期値URL作成（PC専用 / create・editのみ）
// - 「PC用」「モバイル用」の2ボタン
// - 出力は押下時のみ生成
// - URLは押下時に自動コピー（問題文字のみ % エンコード。※ , は除外）
// - サブテーブル配下は除外、複数選択はカンマ区切り、ユーザー/組織/グループは code

((PLUGIN_ID) => {
  'use strict';
  const cfg = kintone.plugin.app.getConfig(PLUGIN_ID) || {};
  if (cfg.featureEnabled === 'false') {
    // 「使用しない」ならを無効化
    return;
  }


(function () {
  'use strict';

  var EVENTS = ['app.record.create.show', 'app.record.edit.show'];

  kintone.events.on(EVENTS, function (event) {
    try {
      removeExisting();
      var mount = resolveMountPoint();
      buildUI(mount);
    } catch (e) {
      console.error('[初期値用URL作成] 初期化エラー → フローティングに設置:', e);
      buildUI(createFloatingMount());
    }
    return event;
  });

  // ---- 設置先（Space[INIT_URL_SPACE] → HeaderMenu → HeaderSpace → Floating）----
  function resolveMountPoint() {
    var el = null;
    try {
      el = kintone.app.record.getSpaceElement('INIT_URL_SPACE'); // 推奨
      if (el) return el;
    } catch (e) {}
    try {
      el = kintone.app.record.getHeaderMenuSpaceElement();
      if (el) return el;
    } catch (e) {}
    try {
      el = kintone.app.record.getHeaderSpaceElement();
      if (el) return el;
    } catch (e) {}
    return createFloatingMount();
  }

  function createFloatingMount() {
    var mount = document.createElement('div');
    mount.id = 'initurl-mount-floating';
    mount.style.position = 'fixed';
    mount.style.top = '12px';
    mount.style.right = '12px';
    mount.style.zIndex = '9999';
    mount.style.maxWidth = '90vw';
    document.body.appendChild(mount);
    return mount;
  }

  function removeExisting() {
    var old = document.getElementById('initurl-wrap');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    var float = document.getElementById('initurl-mount-floating');
    if (float && float.parentNode) float.parentNode.removeChild(float);
  }

  // ---- UI（出力エリアは押下時に生成）----
  function buildUI(mountPoint) {
    var wrap = document.createElement('div');
    wrap.id = 'initurl-wrap';
    wrap.style.display = 'flex';
    wrap.style.flexDirection = 'column';
    wrap.style.gap = '8px';
    wrap.style.maxWidth = '760px';
    wrap.style.width = '100%';

    var row = document.createElement('div');
    row.style.display = 'flex';
    row.style.gap = '8px';
    row.style.flexWrap = 'wrap';
    row.style.padding = '16px';

    var btnPC = makeGhostButton('PC用 初期値URL作成');
    var btnSP = makeGhostButton('モバイル用 初期値URL作成');

    btnPC.addEventListener('click', function () { onClickGenerate('pc'); });
    btnSP.addEventListener('click', function () { onClickGenerate('sp'); });

    row.appendChild(btnPC);
    row.appendChild(btnSP);
    wrap.appendChild(row);
    mountPoint.appendChild(wrap);
  }

  // キャンセル風ゴーストボタン
  function makeGhostButton(text) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = text;
    // ▼上下左右パディングを強めに
    btn.style.padding = '8px 16px';
    btn.style.fontSize = '12px';
    btn.style.background = '#fff';
    btn.style.color = '#333';
    btn.style.border = '1px solid #e3e7e8';
    btn.style.borderRadius = '4px';
    btn.style.cursor = 'pointer';
    btn.style.lineHeight = '1.6';
    btn.style.boxShadow = 'none';
    btn.addEventListener('mouseover', function(){ btn.style.background = '#f5f6f7'; });
    btn.addEventListener('mouseout',  function(){ btn.style.background = '#fff'; });
    return btn;
  }

  async function onClickGenerate(target) {
    try {
      var base = (target === 'sp') ? getCreateBaseUrl_Mobile() : getCreateBaseUrl_PC();
      var pairList = buildParamPairs(); // {key, value} 配列（未エンコード）

      if (pairList.length === 0) {
        alert('入力済みの項目がありません。');
        return;
      }

      // 問題文字のみをエンコード（, は除外）
      var url = base + '?' + pairList.map(function(p){
        return partialEncode(p.key) + '=' + partialEncode(p.value);
      }).join('&');

      renderOutputs(target === 'sp' ? 'モバイル用' : 'PC用', url);

      // 自動コピー＋通知
      await copyAndAlert(url, 'URL');
    } catch (e) {
      console.error('[初期値用URL作成] 生成エラー:', e);
      alert('URLの生成中にエラーが発生しました。コンソールを確認してください。');
    }
  }

  // ---- 出力エリア描画（単一のURL + コピー）----
  function renderOutputs(label, url) {
    var wrap = document.getElementById('initurl-wrap');
    var old = document.getElementById('initurl-outbox');
    if (old && old.parentNode) old.parentNode.removeChild(old);

    var box = document.createElement('div');
    box.id = 'initurl-outbox';
    box.style.display = 'flex';
    box.style.flexDirection = 'column';
    box.style.gap = '6px';
    box.style.padding = '16px';

    var title = document.createElement('div');
    title.textContent = '生成結果（' + label + '）';
    title.style.fontWeight = 'bold';

    // 追記：初期値で自動入力されている場合でもURLに自動記載される旨
    var note = document.createElement('div');
    note.textContent = '※ 初期値で自動入力された値も URL パラメータに含まれます。不要なパラメータは生成後の URL から削除してください。';
    note.style.fontSize = '12px';
    note.style.color = '#666';

    var urlArea = document.createElement('textarea');
    urlArea.readOnly = true;
    urlArea.rows = 3;
    urlArea.style.width = '100%';
    urlArea.style.fontFamily = 'monospace';
    urlArea.style.resize = 'vertical';
    urlArea.style.padding = '16px';
    urlArea.value = url;

    var copyBtn = makeGhostButton('URLをコピー');
    copyBtn.addEventListener('click', function () {
      copyAndAlert(url, 'URL');
    });

    box.appendChild(title);
    box.appendChild(note);     // ← ここでタイトル直下に注意書きを表示
    box.appendChild(urlArea);
    box.appendChild(copyBtn);
    wrap.appendChild(box);
  }

  // ---- PC/モバイルのベースURL（生成はPC画面上で実行）----
  function getCreateBaseUrl_PC() {
    var origin = window.location.origin;
    var appId = kintone.app.getId();
    var path = window.location.pathname; // 例: /k/123/edit, /k/guest/5/123/show
    var mGuest = path.match(/^\/k\/guest\/(\d+)\//);
    if (mGuest) {
      var gId = mGuest[1];
      return origin + '/k/guest/' + gId + '/' + appId + '/edit';
    }
    return origin + '/k/' + appId + '/edit';
  }

  function getCreateBaseUrl_Mobile() {
    var origin = window.location.origin;
    var appId = kintone.app.getId();
    var path = window.location.pathname;
    var mGuest = path.match(/^\/k\/guest\/(\d+)\//);
    if (mGuest) {
      var gId = mGuest[1];
      return origin + '/k/guest/m/' + gId + '/' + appId + '/edit';
    }
    return origin + '/k/m/' + appId + '/edit';
  }

  // ---- パラメータ配列作成（未エンコードの key/value を用意）----
  function buildParamPairs() {
    var recObj = kintone.app.record.get();
    if (!recObj || !recObj.record) return [];

    var rec = recObj.record;
    var SKIP_TYPES = new Set([
      'SUBTABLE', 'FILE',
      'CREATOR', 'CREATED_TIME', 'MODIFIER', 'UPDATED_TIME',
      'RECORD_NUMBER', 'STATUS', 'STATUS_ASSIGNEE', 'CATEGORY',
      'CALC'
    ]);

    var pairs = [];

    Object.keys(rec).forEach(function (code) {
      var f = rec[code];
      if (!f || SKIP_TYPES.has(f.type)) return;

      var val = normalizeValueForQuery(f);
      if (val == null) return;

      if (typeof val === 'string' && val.trim() === '') return;
      if (Array.isArray(val) && val.length === 0) return;

      var v = Array.isArray(val) ? val.join(',') : String(val);
      pairs.push({ key: code, value: v });
    });

    return pairs;
  }

  // ---- 問題文字のみ%エンコード（, は除外）----
  function partialEncode(str) {
    if (str == null) return '';
    // エンコード対象: 空白, 制御, &, #, +, %, ?, =, ;, ", ', <, >
    // ※ カンマ(,)は接続用のため対象外
    var map = {
      ' ': '%20',
      '\t': '%09',
      '\n': '%0A',
      '\r': '%0D',
      '&': '%26',
      '#': '%23',
      '+': '%2B',
      '%': '%25',
      '?': '%3F',
      '=': '%3D',
      ';': '%3B',
      '"': '%22',
      "'": '%27',
      '<': '%3C',
      '>': '%3E'
    };
    return String(str).replace(/[ \t\n\r&#+%?=;"'<>]/g, function (m) {
      return map[m];
    });
  }

// ---- 置換：日時をローカル時刻の「分」までに丸める（UTC→Local 変換 + 秒/タイムゾーン除去）----
function toLocalMinuteStringFromDatetime(v) {
  if (!v) return '';
  try {
    var d = new Date(v);               // "2025-08-25T11:27:00Z" / "...+09:00" などOK
    if (isNaN(d.getTime())) throw new Error('Invalid Date');

    var yyyy = String(d.getFullYear());
    var mm   = String(d.getMonth() + 1).padStart(2, '0');
    var dd   = String(d.getDate()).padStart(2, '0');
    var HH   = String(d.getHours()).padStart(2, '0');     // ← ローカル時刻
    var MM   = String(d.getMinutes()).padStart(2, '0');   // ← ローカル分
    return yyyy + '-' + mm + '-' + dd + 'T' + HH + ':' + MM;
  } catch (e) {
    // フォールバック：元の関数相当（TZを落として "YYYY-MM-DDTHH:MM" を拾う）
    var s = String(v).replace(/(Z|[+\-]\d{2}:\d{2})$/, '');
    var m = s.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})/);
    return m ? (m[1] + 'T' + m[2] + ':' + m[3]) : s;
  }
}

  function toMinuteStringFromTime(v) {
    if (!v) return '';
    var s = String(v);
    var m = s.match(/^(\d{2}):(\d{2})/);
    return m ? (m[1] + ':' + m[2]) : s;
  }

  // ---- 値の正規化 ----
  function normalizeValueForQuery(field) {
    switch (field.type) {
      case 'SINGLE_LINE_TEXT':
      case 'MULTI_LINE_TEXT':
      case 'LINK':
      case 'RADIO_BUTTON':
      case 'DROP_DOWN':
      case 'NUMBER':
      case 'DATE':
      case 'PHONE':
      case 'FAX':
      case 'POSTAL_CODE':
      case 'TEXT':
        return field.value || '';

      case 'TIME':
        // 例: "22:00:00" -> "22:00"
        return toMinuteStringFromTime(field.value || '');

      case 'DATETIME':
        // 例: "2024-06-10T22:00:00Z" -> "2024-06-10T22:00"
        // 例: "2024-06-10T22:00:00+09:00" -> "2024-06-10T22:00"
        return toLocalMinuteStringFromDatetime(field.value || '');

        
      case 'RICH_TEXT':
        // HTMLを簡易除去してプレーン化
        return (field.value || '').replace(/<[^>]*>/g, '').trim();

      case 'CHECK_BOX':
      case 'MULTI_SELECT':
        return Array.isArray(field.value) ? field.value.slice() : [];

      case 'USER_SELECT':
      case 'GROUP_SELECT':
      case 'ORGANIZATION_SELECT':
        if (!Array.isArray(field.value)) return [];
        return field.value
          .map(function (o) { return (o && o.code) ? o.code : ''; })
          .filter(Boolean);

      default:
        return null;
    }
  }

  // ---- クリップボード（成功時は true を返す）----
  async function copyToClipboard(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (e) {
      // 続けてフォールバック
    }
    // フォールバック
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    var ok = false;
    try {
      ok = document.execCommand('copy');
    } catch (e) {
      ok = false;
    } finally {
      document.body.removeChild(ta);
    }
    return ok;
  }

  // ---- コピー＋ポップアップ通知（ボタンでも使用）----
  async function copyAndAlert(text, label) {
    var ok = await copyToClipboard(text);
    if (ok) {
      alert(label + 'をクリップボードにコピーしました。');
    } else {
      alert('コピーに失敗しました。ブラウザの設定をご確認ください。');
    }
  }

})();
})(kintone.$PLUGIN_ID);
