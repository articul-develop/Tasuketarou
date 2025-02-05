(function() {
    'use strict';

    kintone.events.on('app.record.create.show', function(event) {
        // レコードを再利用した場合（reuse === true）
        if (event.reuse === true) {
            event.record.Text_1.value = ''; // Text_1 フィールドをクリア
        }
        return event;
    });
})();