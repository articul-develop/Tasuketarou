/**
 * 変更履歴プラグイン - 値の正規化・比較
 */
window.ChangeHistory = window.ChangeHistory || {};
((CH) => {
  'use strict';

  const emptyToBlank = (value) => (value === null || value === undefined ? '' : value);

  const sortCopy = (arr) => arr.slice().sort((a, b) => String(a).localeCompare(String(b), 'ja'));

  /**
   * エンティティ配列（ユーザー・組織・グループ）を比較用キー配列へ
   */
  const entityKeys = (list) => {
    if (!Array.isArray(list)) {
      return [];
    }
    return sortCopy(list.map((item) => {
      if (!item) {
        return '';
      }
      return item.code || item.name || '';
    }).filter(Boolean));
  };

  const entityLabels = (list) => {
    if (!Array.isArray(list)) {
      return [];
    }
    const labeled = list.map((item) => {
      if (!item) {
        return '';
      }
      if (item.name && item.code) {
        return item.name;
      }
      return item.name || item.code || '';
    }).filter(Boolean);
    return sortCopy(labeled);
  };

  const optionValues = (list) => {
    if (!Array.isArray(list)) {
      return [];
    }
    return sortCopy(list.map((v) => String(emptyToBlank(v))).filter((v) => v !== ''));
  };

  /**
   * 比較用の正規化文字列を返す（意味的に同じなら同一文字列）
   */
  CH.toComparable = (value, type) => {
    const t = type || '';
    if (t === 'CHECK_BOX' || t === 'MULTI_SELECT') {
      return optionValues(value).join('\u0001');
    }
    if (t === 'USER_SELECT' || t === 'ORGANIZATION_SELECT' || t === 'GROUP_SELECT') {
      return entityKeys(value).join('\u0001');
    }
    if (t === 'NUMBER') {
      const raw = emptyToBlank(value);
      if (raw === '') {
        return '';
      }
      const num = Number(raw);
      return Number.isFinite(num) ? String(num) : String(raw);
    }
    return String(emptyToBlank(value));
  };

  /**
   * 履歴表示用の読みやすい文字列
   */
  CH.toDisplay = (value, type) => {
    const t = type || '';
    if (t === 'CHECK_BOX' || t === 'MULTI_SELECT') {
      return optionValues(value).join(', ');
    }
    if (t === 'USER_SELECT' || t === 'ORGANIZATION_SELECT' || t === 'GROUP_SELECT') {
      return entityLabels(value).join(', ');
    }
    return String(emptyToBlank(value));
  };

  CH.isSameValue = (oldValue, newValue, type) => CH.toComparable(oldValue, type) === CH.toComparable(newValue, type);

  CH.isSupportedTargetType = (type) => CH.SUPPORTED_TARGET_TYPES.indexOf(type) !== -1;
})(window.ChangeHistory);
