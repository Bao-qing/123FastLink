import { quarkService } from './QuarkService.js';
import { sleep, getCachedCookie, showCookieInputDialog } from '../shared/utils.js';
import {
    showLoadingDialog, closeLoadingDialog, showResultDialog,
    showError, updateProgress, updateScanProgress, updateScanComplete,
    generateRapidTransferJson, getCurrentPath, getSelectedList
} from '../shared/ui.js';

async function generateHomeJson() {
    const selectedItems = getSelectedList();
    if (selectedItems.length === 0) {
        showError("请先勾选要生成JSON的文件或文件夹");
        return;
    }

    showLoadingDialog("正在扫描文件", "准备中...");
    const currentPath = getCurrentPath();
    const allFiles = [];
    let totalFilesFound = 0;

    for (const item of selectedItems) {
        if (item.file) {
            const filePath = currentPath ? `${currentPath}/${item.file_name}` : item.file_name;
            allFiles.push({ ...item, path: filePath });
            totalFilesFound++;
            updateScanProgress(totalFilesFound);
        } else if (item.dir) {
            const folderPath = currentPath ? `${currentPath}/${item.file_name}` : item.file_name;
            const folderFiles = await quarkService.getFolderFiles(item.fid, folderPath, () => {
                totalFilesFound++;
                updateScanProgress(totalFilesFound);
            });
            allFiles.push(...folderFiles);
        }
    }

    if (allFiles.length === 0) {
        closeLoadingDialog();
        showError("没有找到任何文件");
        return;
    }

    const filesData = await quarkService.getFilesWithMd5(allFiles, (processed, total) => {
        updateProgress(processed, total, "获取MD5");
    });

    const json = generateRapidTransferJson(filesData);
    closeLoadingDialog();
    showResultDialog(json);
}

async function generateShareJson() {
    const selectedItems = getSelectedList();
    if (selectedItems.length === 0) {
        showError("请先勾选要生成JSON的文件或文件夹");
        return;
    }

    const match = location.pathname.match(/\/(s|share)\/([a-zA-Z0-9]+)/);
    if (!match) {
        showError("无法获取分享ID");
        return;
    }
    const shareId = match[2];

    let cookie = getCachedCookie();
    if (!cookie || cookie.length < 10) {
        showCookieInputDialog(() => { setTimeout(() => generateShareJson(), 100); });
        return;
    }

    showLoadingDialog("正在扫描文件", "准备中...");

    try {
        const { stoken, title } = await quarkService.getShareToken(shareId, "", cookie);
        const allFileItems = [];
        let totalFilesFound = 0;

        for (const item of selectedItems) {
            if (item.file) {
                const parentFid = item.pdir_fid;
                const filesInParent = await quarkService.scanQuarkShareFiles(shareId, stoken, cookie, parentFid, '', false);
                const fileInfo = filesInParent.find(f => f.fid === item.fid);

                if (fileInfo) {
                    allFileItems.push({
                        fid: item.fid, token: fileInfo.token,
                        name: item.file_name, size: item.size, path: item.file_name,
                    });
                } else {
                    allFileItems.push({
                        fid: item.fid, token: item.share_fid_token,
                        name: item.file_name, size: item.size, path: item.file_name,
                    });
                }
                totalFilesFound++;
                updateScanProgress(totalFilesFound);
            } else if (item.dir) {
                const folderFiles = await quarkService.scanQuarkShareFiles(shareId, stoken, cookie, item.fid, item.file_name);
                allFileItems.push(...folderFiles);
                totalFilesFound += folderFiles.length;
                updateScanProgress(totalFilesFound);
            }
        }

        if (allFileItems.length === 0) {
            closeLoadingDialog();
            showError("没有找到任何文件", true);
            return;
        }

        updateScanComplete(allFileItems.length);
        await sleep(300);

        const md5Map = await quarkService.batchGetShareFilesMd5(shareId, stoken, cookie, allFileItems, (processed, total) => {
            updateProgress(processed, total, "获取分享文件MD5");
        });

        const files = allFileItems.map((item) => ({
            path: item.path,
            etag: (md5Map[item.fid] || "").toLowerCase(),
            size: item.size,
        }));

        const json = {
            scriptVersion: "3.0.3",
            exportVersion: "1.0",
            usesBase62EtagsInExport: false,
            commonPath: "",
            files,
            totalFilesCount: files.length,
            totalSize: files.reduce((sum, f) => sum + f.size, 0),
        };

        closeLoadingDialog();
        showResultDialog(json, title);
    } catch (error) {
        closeLoadingDialog();
        const errorMsg = error.message || "生成JSON失败";
        const isCookieError = errorMsg.includes("登录") || errorMsg.includes("token") || errorMsg.includes("Cookie") || errorMsg.includes("23018");
        showError(errorMsg + (isCookieError ? "\n\n可能是Cookie失效，请尝试更新Cookie" : ""), isCookieError);
    }
}

async function generateJson() {
    try {
        const path = location.pathname;
        const isSharePage = /^\/(s|share)\//.test(path);
        if (isSharePage) {
            await generateShareJson();
        } else {
            await generateHomeJson();
        }
    } catch (error) {
        closeLoadingDialog();
        showError(error.message || "生成JSON失败");
    }
}

function addQuarkButton() {
    if (document.getElementById("quark-json-generator-btn")) return;

    const path = location.pathname;
    const isSharePage = /^\/(s|share)\//.test(path);
    let container;

    if (isSharePage) {
        container = document.querySelector(".share-btns");
        if (!container) {
            const alternatives = [
                ".ant-layout-content .operate-bar",
                ".share-detail-header .operate-bar",
                ".share-header-btns",
                ".share-operate-btns",
                "[class*='share'][class*='btn']",
                ".ant-btn-group",
            ];
            for (const selector of alternatives) {
                container = document.querySelector(selector);
                if (container) break;
            }
        }
    } else {
        container = document.querySelector(".btn-operate .btn-main");
    }
    if (!container) return;

    const buttonWrapper = document.createElement("div");
    buttonWrapper.id = "quark-json-generator-btn";
    buttonWrapper.className = "ant-dropdown-trigger pl-button-json";

    if (isSharePage) {
        buttonWrapper.style.cssText = "display: inline-block; margin-left: 16px;";
        buttonWrapper.innerHTML = `
            <button type="button" class="ant-btn ant-btn-primary" style="background: #52c41a; border-color: #52c41a; height: 40px;">
                <svg style="width: 16px; height: 16px; margin-right: 4px; vertical-align: -3px;" viewBox="0 0 16 16" fill="currentColor"><path d="M8 2a.5.5 0 0 1 .5.5v5h5a.5.5 0 0 1 0 1h-5v5a.5.5 0 0 1-1 0v-5h-5a.5.5 0 0 1 0-1h5v-5A.5.5 0 0 1 8 2z"/></svg>
                <span>生成JSON</span>
            </button>`;
        container.appendChild(buttonWrapper);
    } else {
        buttonWrapper.style.cssText = "display: inline-block; margin-right: 16px;";
        buttonWrapper.innerHTML = `
            <div class="ant-upload ant-upload-select ant-upload-select-text">
                <button type="button" class="ant-btn ant-btn-primary" style="background: #52c41a; border-color: #52c41a;">
                    <svg style="width: 16px; height: 16px; margin-right: 4px; vertical-align: -3px;" viewBox="0 0 16 16" fill="currentColor"><path d="M8 2a.5.5 0 0 1 .5.5v5h5a.5.5 0 0 1 0 1h-5v5a.5.5 0 0 1-1 0v-5h-5a.5.5 0 0 1 0-1h5v-5A.5.5 0 0 1 8 2z"/></svg>
                    <span>生成JSON</span>
                </button>
            </div>`;
        container.insertBefore(buttonWrapper, container.firstChild);
    }
    buttonWrapper.querySelector("button").onclick = generateJson;
}

export function initQuark() {
    const observer = new MutationObserver(() => { addQuarkButton(); });
    observer.observe(document.body, { childList: true, subtree: true });
    addQuarkButton();
}
