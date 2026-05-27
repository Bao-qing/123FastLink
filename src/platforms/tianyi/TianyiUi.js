import { tianyiService } from './TianyiService.js';
import { sleep } from '../shared/utils.js';
import {
    showLoadingDialog, closeLoadingDialog, showResultDialog,
    showError, updateProgress, updateScanProgress, updateScanComplete,
    generateRapidTransferJson
} from '../shared/ui.js';

async function generateTianyiShareJson() {
    showLoadingDialog("正在扫描文件", "准备中...");

    try {
        const selectedFiles = tianyiService.getSelectedFiles();
        if (selectedFiles.length === 0) {
            closeLoadingDialog();
            showError("请先勾选要生成JSON的文件或文件夹");
            return;
        }

        const shareUrl = window.location.href;
        let sharePwd = "";
        const allFiles = [];
        let itemsProcessed = 0;
        let filesFound = 0;

        const onProgress = () => { filesFound++; updateScanProgress(filesFound); };
        updateProgress(0, selectedFiles.length, "扫描文件");
        updateScanProgress(0);

        const { shareId, shareMode, accessCode, shareCode, title } =
            await tianyiService.getBaseShareInfo(shareUrl, sharePwd);

        for (const item of selectedFiles) {
            if (item.isFolder) {
                const subFiles = await tianyiService.get189ShareFiles(
                    shareId, item.fileId, item.fileId, item.fileName,
                    shareMode, accessCode, shareCode, onProgress
                );
                allFiles.push(...subFiles);
            } else {
                allFiles.push({
                    path: item.fileName,
                    etag: (item.md5 || "").toLowerCase(),
                    size: item.size,
                });
                onProgress();
            }
            itemsProcessed++;
            updateProgress(itemsProcessed, selectedFiles.length, "扫描文件");
        }

        updateScanComplete(allFiles.length);
        await sleep(300);

        const finalJson = generateRapidTransferJson(allFiles);
        closeLoadingDialog();
        showResultDialog(finalJson, title);
    } catch (error) {
        closeLoadingDialog();
        showError(error.message || "生成JSON失败");
    }
}

async function generateTianyiHomeJson() {
    showLoadingDialog("正在扫描文件", "准备中...");

    try {
        const selectedFiles = tianyiService.getSelectedFiles();
        if (selectedFiles.length === 0) {
            closeLoadingDialog();
            showError("请先勾选要生成JSON的文件或文件夹");
            return;
        }

        const allFiles = [];
        let filesFound = 0;
        const onProgress = () => { filesFound++; updateScanProgress(filesFound); };
        updateScanProgress(0);

        for (const item of selectedFiles) {
            if (item.isFolder) {
                const subFiles = await tianyiService.getPersonalFolderFiles(item.fileId, item.fileName, onProgress);
                allFiles.push(...subFiles);
            } else {
                allFiles.push({
                    path: item.fileName,
                    size: item.size,
                    fileId: item.fileId,
                    etag: (item.md5 || "").toLowerCase(),
                });
                onProgress();
            }
        }

        updateScanComplete(allFiles.length);
        await sleep(300);

        const filesMissingMd5 = allFiles.filter((f) => !f.etag);
        if (filesMissingMd5.length > 0) {
            updateProgress(0, filesMissingMd5.length, "获取MD5");
            let md5Processed = 0;

            for (const file of filesMissingMd5) {
                try {
                    const details = await tianyiService.getPersonalFileDetails(file.fileId);
                    file.etag = (details.md5 || "").toLowerCase();
                } catch (e) {
                    console.error(`获取文件MD5失败: ${file.path}`, e);
                }
                md5Processed++;
                updateProgress(md5Processed, filesMissingMd5.length, "获取MD5");
                await sleep(100);
            }
        }

        const finalJson = generateRapidTransferJson(allFiles);
        closeLoadingDialog();
        showResultDialog(finalJson);
    } catch (error) {
        closeLoadingDialog();
        showError(error.message || "生成JSON失败");
    }
}

async function generateJson() {
    try {
        const path = location.pathname;
        if (path.startsWith("/web/main")) {
            await generateTianyiHomeJson();
        } else {
            await generateTianyiShareJson();
        }
    } catch (error) {
        closeLoadingDialog();
        showError(error.message || "生成JSON失败");
    }
}

function addTianyiButton() {
    if (document.getElementById("quark-json-generator-btn")) return;

    const isMainPage = location.pathname.startsWith("/web/main");
    let container;

    if (isMainPage) {
        container = document.querySelector('[class*="FileHead_file-head-left"]');
    } else {
        container = document.querySelector(".file-operate");
    }
    if (!container) return;

    const button = document.createElement("a");
    button.id = "quark-json-generator-btn";
    button.className = "btn";
    button.href = "javascript:;";
    button.textContent = "生成JSON";

    if (isMainPage) {
        button.style.cssText = "width: 76px; height: 30px; padding: 0; border-radius: 4px; line-height: 30px; color: #fff; text-align: center; font-size: 12px; background: #52c41a; border: 1px solid #46a219; position: relative; display: block; margin-right: 12px;";
    } else {
        button.style.cssText = "width: 116px; height: 36px; padding: 0; border-radius: 4px; line-height: 36px; color: #fff; text-align: center; font-size: 14px; background: #52c41a; border: 1px solid #46a219; position: relative; display: block; margin-right: 20px;";
    }

    container.insertBefore(button, container.firstChild);

    if (!isMainPage) {
        const styleId = "quark-json-flex-style";
        if (!document.getElementById(styleId)) {
            const style = document.createElement("style");
            style.id = styleId;
            style.textContent = `
                .outlink-box-b .file-operate {
                    display: flex !important;
                    flex-wrap: nowrap !important;
                    justify-content: flex-end !important;
                    align-items: center !important;
                    float: none !important;
                    text-align: unset !important;
                }
                .btn-save-as { margin-left: 0 !important; }
            `;
            document.head.appendChild(style);
        }
    }

    button.onclick = generateJson;
}

export function initTianyi() {
    const observer = new MutationObserver(() => { addTianyiButton(); });
    observer.observe(document.body, { childList: true, subtree: true });
    addTianyiButton();
}
