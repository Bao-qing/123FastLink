import { sleep, gmPost, gmGet, getCachedCookie } from '../shared/utils.js';
import { decodeMd5 } from '../shared/ui.js';

export const quarkService = {
    async getFolderFiles(folderId, folderPath = "", onProgress) {
        const API_URL = "https://drive-pc.quark.cn/1/clouddrive/file/sort?pr=ucpro&fr=pc";
        const allFiles = [];
        let page = 1;
        const pageSize = 50;

        while (true) {
            const url = `${API_URL}&pdir_fid=${folderId}&_page=${page}&_size=${pageSize}&_fetch_total=1&_fetch_sub_dirs=0&_sort=file_type:asc,updated_at:desc`;

            const result = await new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: "GET",
                    url: url,
                    onload: function (response) {
                        try { resolve(JSON.parse(response.responseText)); }
                        catch (e) { reject(new Error("响应解析失败")); }
                    },
                    onerror: () => reject(new Error("网络请求失败")),
                });
            });

            if (result?.code !== 0 || !result?.data?.list) break;

            const items = result.data.list;
            for (const item of items) {
                const itemPath = folderPath ? `${folderPath}/${item.file_name}` : item.file_name;
                if (item.dir) {
                    const subFiles = await this.getFolderFiles(item.fid, itemPath, onProgress);
                    allFiles.push(...subFiles);
                } else if (item.file) {
                    allFiles.push({ ...item, path: itemPath });
                    if (onProgress) onProgress();
                }
            }

            if (items.length < pageSize) break;
            page++;
        }
        return allFiles;
    },

    async getShareToken(shareId, passcode = "", cookie = "") {
        const API_URL = "https://pc-api.uc.cn/1/clouddrive/share/sharepage/token";

        const result = await new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: "POST",
                url: API_URL,
                headers: {
                    "Content-Type": "application/json",
                    Cookie: cookie,
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                    Referer: "https://pan.quark.cn/",
                },
                data: JSON.stringify({ pwd_id: shareId, passcode: passcode }),
                onload: function (response) {
                    try { resolve(JSON.parse(response.responseText)); }
                    catch (e) { reject(new Error("响应解析失败")); }
                },
                onerror: () => reject(new Error("网络请求失败")),
            });
        });

        if (result?.code === 31001) throw new Error("请先登录网盘");
        if (result?.code !== 0) throw new Error(`获取token失败，代码：${result.code}，消息：${result.message}`);

        return { stoken: result.data.stoken, title: result.data.title || "" };
    },

    async getFilesWithMd5(fileList, onProgress) {
        const API_URL = "https://drive.quark.cn/1/clouddrive/file/download?pr=ucpro&fr=pc";
        const BATCH_SIZE = 15;
        const data = [];
        let processed = 0;
        const validFiles = fileList.filter((item) => item.file === true);
        const pathMap = {};
        validFiles.forEach((file) => { pathMap[file.fid] = file.path; });

        for (let i = 0; i < validFiles.length; i += BATCH_SIZE) {
            const batch = validFiles.slice(i, i + BATCH_SIZE);
            const fids = batch.map((item) => item.fid);

            const result = await gmPost(API_URL, { fids });

            if (result?.code === 31001) throw new Error("请先登录网盘");
            if (result?.code !== 0) throw new Error(`获取链接失败，代码：${result.code}，消息：${result.message}`);

            if (result?.data) {
                const filesWithPath = result.data.map((file) => {
                    const newFile = { ...file, path: pathMap[file.fid] || file.file_name };
                    let md5 = newFile.md5 || newFile.hash || newFile.etag || "";
                    md5 = decodeMd5(md5);
                    if (md5) newFile.md5 = md5;
                    return newFile;
                });
                data.push(...filesWithPath);
            }

            processed += batch.length;
            if (onProgress) onProgress(processed, validFiles.length);
            await sleep(1000);
        }
        return data;
    },

    async scanQuarkShareFiles(shareId, stoken, cookie, parentFileId = 0, path = "", recursive = true) {
        const fileItems = [];
        let page = 1;

        while (true) {
            const url = `https://pc-api.uc.cn/1/clouddrive/share/sharepage/detail?pwd_id=${shareId}&stoken=${encodeURIComponent(stoken)}&pdir_fid=${parentFileId}&_page=${page}&_size=100&pr=ucpro&fr=pc`;

            const result = await new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: "GET",
                    url: url,
                    headers: {
                        Cookie: cookie,
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36 Edg/137.0.0.0",
                        Referer: "https://pan.quark.cn/",
                    },
                    onload: function (response) {
                        try { resolve(JSON.parse(response.responseText)); }
                        catch (e) { reject(new Error("响应解析失败")); }
                    },
                    onerror: () => reject(new Error("网络请求失败")),
                });
            });

            if (result.code !== 0 || !result.data?.list) break;

            for (const item of result.data.list) {
                const itemPath = path ? `${path}/${item.file_name}` : item.file_name;
                if (item.dir) {
                    if (recursive) {
                        const subFiles = await this.scanQuarkShareFiles(shareId, stoken, cookie, item.fid, itemPath, true);
                        fileItems.push(...subFiles);
                    }
                } else {
                    fileItems.push({
                        fid: item.fid,
                        token: item.share_fid_token,
                        name: item.file_name,
                        size: item.size,
                        path: itemPath,
                    });
                }
            }

            if (result.data.list.length < 100) break;
            page++;
        }
        return fileItems;
    },

    async batchGetShareFilesMd5(shareId, stoken, cookie, fileItems, onProgress) {
        const md5Map = {};
        const batchSize = 10;
        let totalProcessed = 0;

        for (let i = 0; i < fileItems.length; i += batchSize) {
            const batch = fileItems.slice(i, i + batchSize);
            const fids = batch.map((item) => item.fid);
            const tokens = batch.map((item) => item.token);

            try {
                const requestBody = { fids, pwd_id: shareId, stoken, fids_token: tokens };

                const md5Result = await new Promise((resolve, reject) => {
                    GM_xmlhttpRequest({
                        method: "POST",
                        url: `https://pc-api.uc.cn/1/clouddrive/file/download?pr=ucpro&fr=pc&uc_param_str=&__dt=${Math.floor(Math.random() * 4 + 1) * 60 * 1000}&__t=${Date.now()}`,
                        headers: {
                            "Content-Type": "application/json",
                            Cookie: cookie,
                            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) quark-cloud-drive/3.14.2 Chrome/112.0.5615.165 Electron/24.1.3.8 Safari/537.36 Channel/pckk_other_ch",
                            Referer: "https://pan.quark.cn/",
                            Accept: "application/json, text/plain, */*",
                            Origin: "https://pan.quark.cn",
                        },
                        data: JSON.stringify(requestBody),
                        onload: function (response) {
                            try { resolve(JSON.parse(response.responseText)); }
                            catch (e) { resolve({ code: -1, message: "解析失败" }); }
                        },
                        onerror: () => resolve({ code: -1, message: "网络错误" }),
                    });
                });

                if (md5Result.code === 0 && md5Result.data) {
                    const dataList = Array.isArray(md5Result.data) ? md5Result.data : [md5Result.data];
                    dataList.forEach((item, idx) => {
                        const fid = fids[idx];
                        if (!fid) return;
                        let md5 = item.md5 || item.hash || "";
                        md5 = decodeMd5(md5);
                        md5Map[fid] = md5;
                    });
                } else {
                    fids.forEach((fid) => (md5Map[fid] = ""));
                }
            } catch (e) {
                fids.forEach((fid) => (md5Map[fid] = ""));
            }

            totalProcessed += batch.length;
            if (onProgress) onProgress(totalProcessed, fileItems.length);
            await sleep(1000);
        }
        return md5Map;
    },
};
