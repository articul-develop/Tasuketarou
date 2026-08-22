/**
 * スマート一覧プラグイン ソート
 * フィールド型に応じた比較と、複数列ソートを担当する。
 * 数値を文字列として比較しない／日付を文字列順で処理しないことを保証する。
 */
window.SubtableList = window.SubtableList || {};
((DL) => {
  'use strict';

  // 数値混在の文字列（商品コードA001など）も自然順で並ぶようにする
  const collator = new Intl.Collator('ja', { numeric: true, sensitivity: 'base' });

  // 空欄は昇順・降順にかかわらず常に末尾へ送る
  const compareWithDirection = (a, b, direction) => {
    const aEmpty = a === null || a === undefined;
    const bEmpty = b === null || b === undefined;
    if (aEmpty && bEmpty) {
      return 0;
    }
    if (aEmpty) {
      return 1;
    }
    if (bEmpty) {
      return -1;
    }

    let result;
    if (typeof a === 'number' && typeof b === 'number') {
      result = a < b ? -1 : (a > b ? 1 : 0);
    } else {
      result = collator.compare(String(a), String(b));
    }
    return result * direction;
  };

  /**
   * 明細行を並べ替える。比較キーは事前に1度だけ算出する（大量データでの再計算を避ける）。
   * ソート未指定時は取得順（親レコード順 → テーブル行順）のまま。
   */
  DL.applySort = (virtualRows, sorts, columnMap) => {
    const active = (sorts || [])
      .map((sort) => ({ direction: sort.dir === 'desc' ? -1 : 1, column: columnMap[sort.key] }))
      .filter((item) => Boolean(item.column));

    if (active.length === 0) {
      return virtualRows.slice();
    }

    const decorated = new Array(virtualRows.length);
    for (let i = 0; i < virtualRows.length; i += 1) {
      const virtualRow = virtualRows[i];
      const keys = new Array(active.length);
      for (let j = 0; j < active.length; j += 1) {
        const column = active[j].column;
        keys[j] = DL.getSortKey(DL.getCellField(virtualRow, column), column.type);
      }
      decorated[i] = { virtualRow, keys };
    }

    decorated.sort((a, b) => {
      for (let i = 0; i < active.length; i += 1) {
        const result = compareWithDirection(a.keys[i], b.keys[i], active[i].direction);
        if (result !== 0) {
          return result;
        }
      }
      // 同値のときは取得順に戻して並びを再現可能にする
      if (a.virtualRow.parentSeq !== b.virtualRow.parentSeq) {
        return a.virtualRow.parentSeq - b.virtualRow.parentSeq;
      }
      return a.virtualRow.rowIndex - b.virtualRow.rowIndex;
    });

    const sorted = new Array(decorated.length);
    for (let i = 0; i < decorated.length; i += 1) {
      sorted[i] = decorated[i].virtualRow;
    }
    return sorted;
  };

  /**
   * 列クリックによるソート状態の遷移。
   * 通常クリックは単一ソートの置き換え、Shift+クリックは複数列ソートへの追加。
   * 同じ列を押すごとに 昇順 → 降順 → 解除 と切り替わる。
   */
  DL.toggleSort = (sorts, key, additive) => {
    const current = Array.isArray(sorts) ? sorts.slice() : [];
    const index = current.findIndex((sort) => sort.key === key);

    if (!additive) {
      if (index < 0 || current.length !== 1) {
        return [{ key, dir: 'asc' }];
      }
      if (current[0].dir === 'asc') {
        return [{ key, dir: 'desc' }];
      }
      return [];
    }

    if (index < 0) {
      current.push({ key, dir: 'asc' });
      return current;
    }
    if (current[index].dir === 'asc') {
      current[index] = { key, dir: 'desc' };
      return current;
    }
    current.splice(index, 1);
    return current;
  };

  DL.findSortState = (sorts, key) => {
    const index = (sorts || []).findIndex((sort) => sort.key === key);
    if (index < 0) {
      return null;
    }
    return { dir: sorts[index].dir, order: index + 1, total: sorts.length };
  };
})(window.SubtableList);
