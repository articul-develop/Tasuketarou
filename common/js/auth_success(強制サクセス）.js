window.AuthModule = (function () {
  'use strict';

  async function authenticateDomain(API_CONFIG) {
    return {
      status: 'success',
      response: {
        status: 'valid',
        mode: 'official',
        Trial_enddate: ''
      }
    };
  }

  async function sendErrorLog() {
    return;
  }

  async function checkAndReauthenticate() {
    return { success: true, mode: 'official' };
  }

  function shouldShowTrialBanner() {
    return false;
  }

  function formatTrialBannerText(pluginName, trialEndDate) {
    const dateText = `${trialEndDate.slice(0, 4)}/${trialEndDate.slice(4, 6)}/${trialEndDate.slice(6, 8)}`;
    return `${pluginName}　お試し期間中（～${dateText}）`;
  }

  function appendTrialBanner() {
    return;
  }

  function normalizeMode(mode) {
    return String(mode || '').toLowerCase();
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
