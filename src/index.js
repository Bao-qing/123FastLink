import { GlobalConfig, initSettings, isFirstTime } from './config';
import { logger } from './logger';
import { PanApiClient } from './PanApiClient';
import { TableRowSelector } from './TableRowSelector';
import { ShareLinkManager } from './ShareLinkManager';
import { UiManager } from './UiManager';

initSettings();
var console = new logger(window.console);
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
