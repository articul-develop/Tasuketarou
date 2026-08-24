(function (PLUGIN_ID) {
  'use strict';

  const PLUGIN_NAME = 'ワンクリック申請プラグイン';
  const config = kintone.plugin.app.getConfig(PLUGIN_ID) || {};

  function appendTrialLabel(headerSpace) {
    AuthModule.appendTrialBanner(headerSpace, PLUGIN_NAME, {
      pluginId: PLUGIN_ID,
      config: config
    });
  }

  kintone.events.on(['app.record.create.show', 'app.record.edit.show'], function (event) {
    appendTrialLabel(kintone.app.record.getHeaderMenuSpaceElement());
    return event;
  });

  let isAuthenticated = false;

  async function initializeAuthentication() {
    const authResult = await AuthModule.checkAndReauthenticate({
      pluginId: PLUGIN_ID,
      pluginName: PLUGIN_NAME,
      config: config,
      apiConfig: API_CONFIG
    });
    if (authResult !== undefined) {
      isAuthenticated = Boolean(authResult.success);
    }
    return isAuthenticated;
  }

  window.isAuthenticated = function () {
    return isAuthenticated;
  };

  const authReady = initializeAuthentication();
  window.whenAuthenticated = function () {
    return authReady.then(function () {
      return isAuthenticated;
    });
  };
})(kintone.$PLUGIN_ID);