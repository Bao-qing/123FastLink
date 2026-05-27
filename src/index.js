import { GlobalConfig, initSettings, isFirstTime } from './config';
import { PanApiClient } from './PanApiClient';
import { TableRowSelector } from './TableRowSelector';
import { ShareLinkManager } from './ShareLinkManager';
import { UiManager } from './UiManager';

initSettings();
const apiClient = new PanApiClient();
const selector = new TableRowSelector();
const shareLinkManager = new ShareLinkManager(apiClient);
const uiManager = new UiManager(shareLinkManager, selector, isFirstTime());

uiManager.init();

if (GlobalConfig.DEBUGMODE) {
    window._apiClient = apiClient;
    window._shareLinkManager = shareLinkManager;
    window._selector = selector;
    window._uiManager = uiManager;
}

// 平台扩展：夸克网盘 / 天翼云盘
if (__ENABLE_QUARK__ || __ENABLE_TIANYI__) {
    const { init: initPlatforms } = require('./platforms/platformInit.js');
    initPlatforms();
}
