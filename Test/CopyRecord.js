(function() {
    'use strict';
    
    // レコード作成画面が表示されたときのイベント
    kintone.events.on('app.record.create.show', function(event) {
        // 現在のURLからパラメータを取得
        var url = new URL(location.href);
        
        // 複写の場合、URLに「copyRecordId」というパラメータが付与される（※利用環境によりパラメータ名が異なる場合は調整）
        if (url.searchParams.has('copyRecordId')) {
            // 複写時にコピー対象外としたいフィールドの値をクリア
            if (event.record['Text_1']) {
                event.record['Text_1'].value = '';
            }
            // 例：他のフィールドをクリアする場合
            // if (event.record['Other_Field_Code']) {
            //     event.record['Other_Field_Code'].value = '';
            // }
        }
        return event;
    });
})();
