/**
 * スマート一覧プラグイン CSV出力
 * 現在の検索・絞り込み・ソート結果を「明細1行 = CSV1行」で出力する。
 * 文字コードと引用符の扱いは既存のCSV出力プラグインに合わせている。
 */
window.SubtableList = window.SubtableList || {};
((DL) => {
  'use strict';

  const LINE_ENDING = '\r\n';

  // Excelでの取り込みを考慮し、カンマや改行の有無にかかわらず常に囲む
  const escapeCsvValue = (value) => `"${String(value === null || value === undefined ? '' : value).replace(/"/g, '""')}"`;

  DL.buildCsv = (columns, virtualRows) => {
    const header = columns.map((column) => escapeCsvValue(column.label)).join(',');
    const lines = new Array(virtualRows.length);

    for (let i = 0; i < virtualRows.length; i += 1) {
      const virtualRow = virtualRows[i];
      const cells = new Array(columns.length);
      for (let j = 0; j < columns.length; j += 1) {
        const column = columns[j];
        cells[j] = escapeCsvValue(DL.formatCsvText(DL.getCellField(virtualRow, column), column.type));
      }
      lines[i] = cells.join(',');
    }

    return [header].concat(lines).join(LINE_ENDING);
  };

  const createCsvBlob = (csvText, encoding) => {
    if (encoding === 'SJIS') {
      if (!window.Encoding) {
        throw new Error('文字コード変換ライブラリを読み込めませんでした。UTF-8で出力するか、ページを再読み込みしてください。');
      }
      const unicodeArray = window.Encoding.stringToCode(csvText);
      const sjisArray = window.Encoding.convert(unicodeArray, { to: 'SJIS', from: 'UNICODE' });
      return new Blob([new Uint8Array(sjisArray)], { type: 'text/csv;charset=shift_jis;' });
    }
    return new Blob([`\uFEFF${csvText}`], { type: 'text/csv;charset=utf-8;' });
  };

  DL.downloadCsv = (fileName, csvText, encoding) => {
    const blob = createCsvBlob(csvText, encoding);
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    window.setTimeout(() => {
      window.URL.revokeObjectURL(url);
    }, 1000);
  };

  DL.resolveCsvFileName = (template) => {
    const now = new Date();
    const pad2 = (value) => String(value).padStart(2, '0');
    const ymd = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}`;
    const hms = `${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`;

    const resolved = String(template || 'スマート一覧')
      .replace(/\{YYYYMMDD_HHmmss\}/g, `${ymd}_${hms}`)
      .replace(/\{YYYYMMDD\}/g, ymd)
      .replace(/\{YYYY-MM-DD\}/g, `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`)
      // ファイル名に使えない文字を除去する
      .replace(/[\\/:*?"<>|]/g, '_')
      .trim();

    const safeName = resolved || 'スマート一覧';
    return /\.csv$/i.test(safeName) ? safeName : `${safeName}.csv`;
  };
})(window.SubtableList);
