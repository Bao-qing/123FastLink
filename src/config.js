export var GlobalConfig = {
    scriptVersion: "3.2.0",
    usesBase62EtagsInExport: true,
    getFileListPageDelay: 500,
    getFileInfoBatchSize: 100,
    getFileInfoDelay: 200,
    getFolderInfoDelay: 300,
    saveLinkDelay: 100,
    mkdirDelay: 100,
    scriptName: "123FASTLINKV3",
    COMMON_PATH_LINK_PREFIX_V2: "123FLCPV2$",
    MAX_TEXT_FILE_SIZE: 3 * 1024 * 1024,
    DEFAULT_EXPORT_FILENAME: "123FastLink_Export",
    DEBUGMODE: true,
    seedFilePathId: null,
    secondaryLinkUseJson: true
};

export function initSettings() {
    const Settings = GM_getValue('fastlink_settings', null);
    if (Settings) {
        try {
            GlobalConfig = { ...GlobalConfig, ...Settings };
        } catch (e) {
            console.error("加载设置失败:", e);
            saveSettings({});
        }
    }
}

export function saveSettings(settings) {
    GlobalConfig = { ...GlobalConfig, ...settings };
    GM_setValue('fastlink_settings', settings);
}

export function deleteSettings() {
    GM_setValue('fastlink_settings', null);
    GM_setValue('fastlink_first_time', true);
}

export function isFirstTime() {
    const firstTime = GM_getValue('fastlink_first_time', true);
    if (firstTime) {
        GM_setValue('fastlink_first_time', false);
    }
    return firstTime;
}
