import { findReact, getCachedCookie, showCookieInputDialog } from './utils.js';

export function showLoadingDialog(title, message) {
    const existingDialog = document.getElementById("quark-json-loading-dialog");
    if (existingDialog) existingDialog.remove();

    const dialog = document.createElement("div");
    dialog.id = "quark-json-loading-dialog";
    dialog.innerHTML = `
        <div style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); z-index: 9999; display: flex; align-items: center; justify-content: center;">
            <div style="background: white; padding: 30px; border-radius: 8px; min-width: 350px; text-align: center;">
                <div style="font-size: 18px; font-weight: bold; margin-bottom: 15px;">${title}</div>
                <div id="quark-json-loading-message" style="font-size: 14px; color: #666; margin-bottom: 10px;">${message}</div>
                <div id="quark-json-loading-detail" style="font-size: 12px; color: #999; margin-bottom: 10px; min-height: 18px;"></div>
                <div style="margin-top: 15px;">
                    <div style="width: 100%; height: 8px; background: #f0f0f0; border-radius: 4px; overflow: hidden;">
                        <div id="quark-json-progress-bar" style="width: 0%; height: 100%; background: linear-gradient(90deg, #0d53ff, #52c41a); transition: width 0.3s;"></div>
                    </div>
                    <div id="quark-json-progress-text" style="font-size: 13px; color: #666; margin-top: 8px; font-weight: 500;">0%</div>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(dialog);
    return dialog;
}

export function updateProgress(processed, total, phase = "获取MD5") {
    const messageEl = document.getElementById("quark-json-loading-message");
    const detailEl = document.getElementById("quark-json-loading-detail");
    const progressBar = document.getElementById("quark-json-progress-bar");
    const progressText = document.getElementById("quark-json-progress-text");

    if (messageEl) messageEl.textContent = `正在${phase}...`;
    if (detailEl) detailEl.textContent = `已处理 ${processed} / ${total} 个文件`;
    if (progressBar) {
        const percent = total > 0 ? ((processed / total) * 100).toFixed(1) : 0;
        progressBar.style.width = `${percent}%`;
    }
    if (progressText) {
        const percent = total > 0 ? ((processed / total) * 100).toFixed(1) : 0;
        progressText.textContent = `${percent}%`;
    }
}

export function updateScanProgress(count) {
    const messageEl = document.getElementById("quark-json-loading-message");
    const detailEl = document.getElementById("quark-json-loading-detail");
    if (messageEl) messageEl.textContent = "正在扫描文件...";
    if (detailEl) detailEl.textContent = `已发现 ${count} 个文件`;
}

export function updateScanComplete(total) {
    const messageEl = document.getElementById("quark-json-loading-message");
    const detailEl = document.getElementById("quark-json-loading-detail");
    if (messageEl) messageEl.textContent = "扫描完成，准备获取MD5...";
    if (detailEl) detailEl.textContent = `共发现 ${total} 个文件`;
}

export function closeLoadingDialog() {
    const dialog = document.getElementById("quark-json-loading-dialog");
    if (dialog) dialog.remove();
}

export function showResultDialog(json, shareTitle = "") {
    let currentJson = json;
    const updateJsonDisplay = () => {
        const jsonStr = JSON.stringify(currentJson, null, 2);
        const preEl = document.getElementById("quark-json-preview");
        if (preEl) preEl.textContent = jsonStr;
        return jsonStr;
    };

    const jsonStr = JSON.stringify(json, null, 2);
    const dialog = document.createElement("div");
    const checkboxHtml = shareTitle ? `
        <div style="margin-bottom: 15px; padding: 10px; background: #f0f7ff; border-radius: 4px;">
            <label style="display: flex; align-items: center; cursor: pointer;">
                <input type="checkbox" id="quark-json-commonpath-checkbox" checked style="margin-right: 8px; width: 16px; height: 16px; cursor: pointer;">
                <span style="font-size: 14px; color: #333;">设置 commonPath 为分享标题：<strong>${shareTitle}</strong></span>
            </label>
        </div>
    ` : '';

    dialog.innerHTML = `
        <div style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); z-index: 9999; display: flex; align-items: center; justify-content: center;">
            <div style="background: white; padding: 30px; border-radius: 8px; width: 80%; max-width: 800px; max-height: 80vh; display: flex; flex-direction: column;">
                <div style="font-size: 18px; font-weight: bold; margin-bottom: 15px;">秒传JSON生成成功</div>
                ${checkboxHtml}
                <div style="flex: 1; overflow: auto; background: #f5f5f5; padding: 15px; border-radius: 4px; font-family: monospace; font-size: 12px; margin-bottom: 15px;">
                    <pre id="quark-json-preview" style="margin: 0; white-space: pre-wrap; word-wrap: break-word;">${jsonStr}</pre>
                </div>
                <div style="display: flex; gap: 10px; justify-content: flex-end;">
                    <button id="quark-json-copy-btn" style="padding: 8px 20px; background: #0d53ff; color: white; border: none; border-radius: 4px; cursor: pointer;">复制JSON</button>
                    <button id="quark-json-download-btn" style="padding: 8px 20px; background: #52c41a; color: white; border: none; border-radius: 4px; cursor: pointer;">下载文件</button>
                    <button id="quark-json-close-btn" style="padding: 8px 20px; background: #d9d9d9; color: #333; border: none; border-radius: 4px; cursor: pointer;">关闭</button>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(dialog);

    if (shareTitle) {
        const newCommonPath = shareTitle + "/";
        currentJson = { ...json, commonPath: newCommonPath };
        updateJsonDisplay();

        const checkbox = document.getElementById("quark-json-commonpath-checkbox");
        checkbox.onchange = () => {
            currentJson = checkbox.checked
                ? { ...json, commonPath: newCommonPath }
                : { ...json, commonPath: "" };
            updateJsonDisplay();
        };
    }

    document.getElementById("quark-json-copy-btn").onclick = () => {
        const jsonStr = updateJsonDisplay();
        GM_setClipboard(jsonStr);
        showToast("已复制到剪贴板");
    };

    document.getElementById("quark-json-download-btn").onclick = () => {
        const jsonStr = updateJsonDisplay();
        const blob = new Blob([jsonStr], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = (shareTitle ? shareTitle : "123link") + ".json";
        a.click();
        URL.revokeObjectURL(url);
        showToast("下载已开始");
    };

    document.getElementById("quark-json-close-btn").onclick = () => {
        dialog.remove();
    };
}

export function showError(message, showCookieButton = false) {
    const dialog = document.createElement("div");
    dialog.id = "quark-json-error-dialog";
    dialog.innerHTML = `
        <div style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); z-index: 10001; display: flex; align-items: center; justify-content: center;">
            <div style="background: white; padding: 24px; border-radius: 8px; width: 90%; max-width: 420px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); display: flex; flex-direction: column; align-items: center;">
                <div style="color: #ff4d4f; margin-bottom: 16px;">
                    <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" fill="currentColor" viewBox="0 0 16 16">
                        <path d="M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0zM5.354 4.646a.5.5 0 1 0-.708.708L7.293 8l-2.647 2.646a.5.5 0 0 0 .708.708L8 8.707l2.646 2.647a.5.5 0 0 0 .708-.708L8.707 8l2.647-2.646a.5.5 0 0 0-.708-.708L8 7.293 5.354 4.646z"/>
                    </svg>
                </div>
                <div style="font-size: 20px; font-weight: 600; margin-bottom: 8px; color: #333;">操作失败</div>
                <div style="font-size: 14px; color: #555; margin-bottom: 24px; text-align: center; white-space: pre-line;">${message}</div>
                <div style="display: flex; gap: 12px; justify-content: center; width: 100%;">
                    ${showCookieButton ? '<button id="quark-json-error-cookie-btn" style="flex: 1; padding: 10px 20px; background: #0d53ff; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 14px;">修改Cookie</button>' : ""}
                    <button id="quark-json-error-close-btn" style="flex: 1; padding: 10px 20px; background: #f0f0f0; color: #333; border: 1px solid #d9d9d9; border-radius: 6px; cursor: pointer; font-size: 14px;">确定</button>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(dialog);

    if (showCookieButton) {
        document.getElementById("quark-json-error-cookie-btn").onclick = () => {
            dialog.remove();
            showCookieInputDialog(null, getCachedCookie());
        };
    }

    document.getElementById("quark-json-error-close-btn").onclick = () => {
        dialog.remove();
    };
}

export function showToast(message) {
    const existingToast = document.getElementById("quark-json-toast");
    if (existingToast) existingToast.remove();

    const toast = document.createElement("div");
    toast.id = "quark-json-toast";
    toast.textContent = message;
    toast.style.cssText = `
        position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
        background-color: rgba(0, 0, 0, 0.75); color: white; padding: 12px 24px;
        border-radius: 25px; font-size: 14px; font-weight: 500; z-index: 10002;
        opacity: 0; transition: opacity 0.3s ease-in-out, top 0.3s ease-in-out;
    `;
    document.body.appendChild(toast);

    setTimeout(() => { toast.style.opacity = "1"; toast.style.top = "40px"; }, 10);
    setTimeout(() => {
        toast.style.opacity = "0";
        toast.style.top = "20px";
        setTimeout(() => toast.remove(), 300);
    }, 2500);
}

export function generateRapidTransferJson(filesData) {
    const files = filesData.map((file) => ({
        path: file.path || file.file_name,
        etag: (file.etag || file.md5 || "").toLowerCase(),
        size: file.size,
    }));
    const totalSize = files.reduce((sum, f) => sum + f.size, 0);
    return {
        scriptVersion: "3.0.3",
        exportVersion: "1.0",
        usesBase62EtagsInExport: false,
        commonPath: "",
        files: files,
        totalFilesCount: files.length,
        totalSize: totalSize,
    };
}

export function decodeMd5(md5) {
    if (!md5 || !md5.includes("==")) return md5 || "";
    try {
        const binaryString = atob(md5);
        if (binaryString.length === 16) {
            return Array.from(binaryString, (char) =>
                char.charCodeAt(0).toString(16).padStart(2, "0"),
            ).join("");
        }
        return "";
    } catch (e) {
        return "";
    }
}

export function parseSize(sizeStr) {
    if (typeof sizeStr === "number") return sizeStr;
    if (typeof sizeStr !== "string") return 0;
    const sizeMatch = sizeStr.match(/^([\d.]+)\s*([a-z]+)/i);
    if (!sizeMatch) {
        const num = parseInt(sizeStr, 10);
        return isNaN(num) ? 0 : num;
    }
    const size = parseFloat(sizeMatch[1]);
    const unit = sizeMatch[2].toUpperCase();
    switch (unit) {
        case "G": case "GB": return Math.round(size * 1024 * 1024 * 1024);
        case "M": case "MB": return Math.round(size * 1024 * 1024);
        case "K": case "KB": return Math.round(size * 1024);
        case "B": default: return Math.round(size);
    }
}

export function getCurrentPath() {
    try {
        const urlParams = new URLSearchParams(window.location.search);
        const dirFid = urlParams.get("dir_fid");
        if (!dirFid || dirFid === "0") return "";

        const breadcrumb = document.querySelector(".breadcrumb-list");
        if (breadcrumb) {
            const items = breadcrumb.querySelectorAll(".breadcrumb-item");
            const pathParts = [];
            for (let i = 1; i < items.length; i++) {
                const text = items[i].textContent.trim();
                if (text) pathParts.push(text);
            }
            return pathParts.join("/");
        }
        return "";
    } catch (e) {
        return "";
    }
}

export function getSelectedList() {
    try {
        const fileListDom = document.getElementsByClassName("file-list")[0];
        if (!fileListDom) return [];

        const reactObj = findReact(fileListDom);
        const props = reactObj?.props;

        if (props) {
            const fileList = props.list || [];
            const selectedKeys = props.selectedRowKeys || [];
            const selectedList = [];
            fileList.forEach(function (val) {
                if (selectedKeys.includes(val.fid)) {
                    selectedList.push(val);
                }
            });
            return selectedList;
        }
        return [];
    } catch (e) {
        return [];
    }
}
