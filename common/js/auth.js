window.AuthModule = (function () {
  'use strict';

  const OFFICIAL_REAUTH_DAYS = 7;

  function stripNamedBrackets(text) {
    return String(text || '')
      .replace(/【[^】]+】/g, '')
      .replace(/[ \t]+/g, ' ')
      .replace(/[：:]\s*/g, ': ')
      .replace(/\n{2,}/g, '\n')
      .trim();
  }

  function prefixMessage(pluginName, message) {
    const body = stripNamedBrackets(message);
    if (!pluginName) {
      return body;
    }
    return `【${pluginName}】${body}`;
  }

  function normalizeMode(mode) {
    const value = String(mode || '').toLowerCase();
    if (value === 'official') {
      return 'official';
    }
    if (value === 'subscription') {
      return 'subscription';
    }
    if (value === 'trial') {
      return 'trial';
    }
    return '';
  }

  function todayStr() {
    const today = new Date();
    return today.getFullYear().toString() +
      (today.getMonth() + 1).toString().padStart(2, '0') +
      today.getDate().toString().padStart(2, '0');
  }

  function addDaysYmd(ymd, days) {
    if (!ymd || ymd.length !== 8) {
      return '';
    }
    const date = new Date(
      Number(ymd.slice(0, 4)),
      Number(ymd.slice(4, 6)) - 1,
      Number(ymd.slice(6, 8))
    );
    date.setDate(date.getDate() + days);
    return date.getFullYear().toString() +
      (date.getMonth() + 1).toString().padStart(2, '0') +
      date.getDate().toString().padStart(2, '0');
  }

  function getStorageKey(pluginId) {
    return `PLUGIN_${pluginId}_config`;
  }

  function readStorage(pluginId) {
    try {
      return JSON.parse(localStorage.getItem(getStorageKey(pluginId))) || {};
    } catch (error) {
      return {};
    }
  }

  function writeStorage(pluginId, data) {
    localStorage.setItem(getStorageKey(pluginId), JSON.stringify(data));
  }

  function needsReauth(lastAuthDate, mode, today) {
    if (!lastAuthDate || !mode) {
      return true;
    }
    if (lastAuthDate >= today) {
      return false;
    }
    if (mode === 'official') {
      const nextAuthDate = addDaysYmd(lastAuthDate, OFFICIAL_REAUTH_DAYS);
      return !nextAuthDate || nextAuthDate <= today;
    }
    return true;
  }

  function isTrialExpired(trialEndDate, today) {
    return Boolean(trialEndDate && trialEndDate < today);
  }

  async function handleAuthError(apiConfig, pluginName, errorMessages) {
    const raw = errorMessages.join('\n') || '認証中に不明なエラーが発生しました';
    const errorText = prefixMessage(pluginName, raw);
    await sendErrorLog(apiConfig, 'checkAndReauthenticate', errorText);
    alert(errorText);
    return { success: false, errors: errorMessages };
  }

  function shouldShowTrialBanner(options) {
    const pluginId = options.pluginId || (typeof kintone !== 'undefined' ? kintone.$PLUGIN_ID : '');
    const config = options.config || {};
    const mode = normalizeMode(readStorage(pluginId).mode);
    const trialEndDate = config.Trial_enddate || '';
    const today = todayStr();

    if (mode === 'official' || mode === 'subscription') {
      return false;
    }
    if (!trialEndDate || trialEndDate < today) {
      return false;
    }
    return mode === 'trial' || !mode;
  }

  function formatTrialBannerText(pluginName, trialEndDate) {
    const dateText = `${trialEndDate.slice(0, 4)}/${trialEndDate.slice(4, 6)}/${trialEndDate.slice(6, 8)}`;
    return `${pluginName}　お試し期間中（～${dateText}）`;
  }

  function appendTrialBanner(headerSpace, pluginName, options) {
    if (!shouldShowTrialBanner(options)) {
      return;
    }
    if (!headerSpace || headerSpace.querySelector('.custom-header-text')) {
      return;
    }
    const trialEndDate = (options.config || {}).Trial_enddate;
    if (!trialEndDate) {
      return;
    }
    const customText = document.createElement('div');
    customText.className = 'custom-header-text';
    customText.textContent = formatTrialBannerText(pluginName, trialEndDate);
    customText.style.marginLeft = '10px';
    customText.style.fontSize = '16px';
    customText.style.color = 'blue';
    headerSpace.appendChild(customText);
  }

  async function authenticateDomain(API_CONFIG) {
    try {
      const response = await fetch(API_CONFIG.ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': API_CONFIG.AUTH_TOKEN,
        },
        body: JSON.stringify({
          Domain: location.hostname,
          ItemKey: API_CONFIG.ItemKey
        })
      });

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('認証API呼び出しエラー:', error);
      throw error;
    }
  }

  async function sendErrorLog(API_CONFIG, errorContext, errorMessage) {
    try {
      const response = await fetch(API_CONFIG.ERROR_LOG_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': API_CONFIG.AUTH_TOKEN,
        },
        body: JSON.stringify({
          Domain: location.hostname,
          ItemKey: API_CONFIG.ItemKey,
          ErrorContext: errorContext,
          ErrorMessage: errorMessage,
          Timestamp: new Date().toLocaleString()
        })
      });

      if (!response.ok) {
        console.error('エラーログの送信に失敗:', response.statusText);
      }
    } catch (error) {
      console.error('エラーログ送信エラー:', error);
    }
  }

  async function checkAndReauthenticate(options) {
    const pluginName = options.pluginName || 'プラグイン';
    const pluginId = options.pluginId || kintone.$PLUGIN_ID;
    const config = options.config || {};
    const apiConfig = options.apiConfig;
    const today = todayStr();
    const storage = readStorage(pluginId);
    const lastAuthDate = storage.lastAuthDate || '';
    const cachedMode = normalizeMode(storage.mode);
    const trialEndDateStr = config.Trial_enddate || '';
    const authStatus = config.authStatus || '';

    if (!config || Object.keys(config).length === 0) {
      return handleAuthError(apiConfig, pluginName, [
        'プラグイン設定が取得できませんでした。再度プラグインの設定を行ってください。'
      ]);
    }

    if (authStatus !== 'valid') {
      return handleAuthError(apiConfig, pluginName, [
        'プラグイン設定が失敗しています。再度プラグインの設定を行ってください。'
      ]);
    }

    if (!needsReauth(lastAuthDate, cachedMode, today)) {
      console.log('認証済みです。');
      return { success: true, mode: cachedMode };
    }

    console.log('認証処理を開始します...');
    try {
      const response = await authenticateDomain(apiConfig);
      if (response.status === 'success' && response.response?.status === 'valid') {
        const mode = normalizeMode(response.response.mode) || cachedMode;
        const apiTrialEnd = response.response.Trial_enddate || trialEndDateStr;
        writeStorage(pluginId, {
          lastAuthDate: today,
          mode
        });

        if (mode === 'trial' && isTrialExpired(apiTrialEnd, today)) {
          return handleAuthError(apiConfig, pluginName, [
            'プラグインお試し期間が終了しています。本契約をご検討ください。ご使用にならない場合はプラグイン設定より無効にしてください。'
          ]);
        }

        console.log('認証成功');
        return { success: true, mode };
      }

      return handleAuthError(apiConfig, pluginName, [
        '認証エラー: ' + (response.response?.message || '不明なエラー')
      ]);
    } catch (error) {
      console.error('認証中にエラーが発生しました。', error);
      if (lastAuthDate) {
        console.warn('認証APIに失敗したため、前回の認証結果で暫定許可します。');
        return { success: true, mode: cachedMode, provisional: true };
      }
      return handleAuthError(apiConfig, pluginName, ['認証中にエラーが発生しました。']);
    }
  }

  return {
    authenticateDomain,
    sendErrorLog,
    checkAndReauthenticate,
    shouldShowTrialBanner,
    formatTrialBannerText,
    appendTrialBanner,
    normalizeMode
  };
})();
