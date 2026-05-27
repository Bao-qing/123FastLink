import { sleep, gmGet, getCookie, findVue } from '../shared/utils.js';

export const tianyiService = {
    getSelectedFiles() {
        try {
            if (typeof unsafeWindow !== "undefined") {
                let list;
                if (/\/web\/share/.test(location.href)) {
                    list = unsafeWindow.shareUser?.getSelectedFileList();
                } else {
                    list = unsafeWindow.file?.getSelectedFileList();
                }
                if (list && list.length > 0) return list;
            }
        } catch (e) { /* ignore */ }

        const selectedItems = [];
        let selectedElements = document.querySelectorAll("li.c-file-item-select");

        if (selectedElements.length === 0) {
            const checkedBoxes = document.querySelectorAll(".ant-checkbox-checked");
            if (checkedBoxes.length > 0) {
                selectedElements = Array.from(checkedBoxes)
                    .map((box) => box.closest("li.c-file-item"))
                    .filter((el) => el);
            }
        }

        if (selectedElements.length === 0) return [];

        selectedElements.forEach((itemEl) => {
            if (itemEl.__vue__) {
                const vueInstance = itemEl.__vue__;
                const fileData = vueInstance.fileItem || vueInstance.fileInfo || vueInstance.item || vueInstance.file;
                if (fileData) {
                    if (!selectedItems.some((item) => item.fileId === (fileData.id || fileData.fileId))) {
                        selectedItems.push({
                            fileId: fileData.id || fileData.fileId,
                            fileName: fileData.name || fileData.fileName,
                            isFolder: fileData.isFolder || fileData.fileCata === 2,
                            md5: fileData.md5,
                            size: fileData.size,
                        });
                    }
                }
            }
        });
        return selectedItems;
    },

    async getPersonalFolderFiles(folderId, path = "", onProgress = null) {
        const files = [];
        let pageNum = 1;
        const pageSize = 100;

        while (true) {
            const appKey = "600100422";
            const timestamp = Date.now().toString();
            const urlParams = {
                folderId: folderId,
                pageNum: pageNum,
                pageSize: pageSize,
                orderBy: "lastOpTime",
                descending: "true",
            };

            const signParams = { ...urlParams, Timestamp: timestamp, AppKey: appKey };
            const signature = this.get189Signature(signParams);

            const url = `https://cloud.189.cn/api/open/file/listFiles.action?${new URLSearchParams(urlParams)}`;
            const text = await gmGet(url, {
                Accept: "application/json;charset=UTF-8",
                "Sign-Type": "1",
                Signature: signature,
                Timestamp: timestamp,
                AppKey: appKey,
            });

            const data = JSON.parse(text);
            if (data.res_code !== 0) break;

            const fileList = data.fileListAO?.fileList || [];
            const folderList = data.fileListAO?.folderList || [];
            if (fileList.length === 0 && folderList.length === 0) break;

            for (const file of fileList) {
                const filePath = path ? `${path}/${file.name}` : file.name;
                files.push({ path: filePath, etag: (file.md5 || "").toLowerCase(), size: file.size, fileId: file.id });
                if (onProgress) onProgress();
            }

            for (const folder of folderList) {
                const folderPath = path ? `${path}/${folder.name}` : folder.name;
                const subFiles = await this.getPersonalFolderFiles(folder.id, folderPath, onProgress);
                files.push(...subFiles);
            }

            if (fileList.length + folderList.length < pageSize) break;
            pageNum++;
        }
        return files;
    },

    async getPersonalFileDetails(fileId) {
        const appKey = "600100422";
        const timestamp = Date.now().toString();
        const urlParams = { fileId: fileId.toString() };
        const signParams = { ...urlParams, Timestamp: timestamp, AppKey: appKey };
        const signature = this.get189Signature(signParams);

        const url = `https://cloud.189.cn/api/open/file/getFileInfo.action?${new URLSearchParams(urlParams)}`;
        const text = await gmGet(url, {
            Accept: "application/json;charset=UTF-8",
            "Sign-Type": "1",
            Signature: signature,
            Timestamp: timestamp,
            AppKey: appKey,
        });
        return JSON.parse(text);
    },

    async getBaseShareInfo(shareUrl, sharePwd) {
        let match = shareUrl.match(/\/t\/([a-zA-Z0-9]+)/) || shareUrl.match(/[?&]code=([a-zA-Z0-9]+)/);
        if (!match) throw new Error("无效的189网盘分享链接");

        const shareCode = match[1];
        let accessCode = sharePwd || "";

        if (!accessCode) {
            const cookieName = `share_${shareCode}`;
            const cookiePwd = getCookie(cookieName);
            if (cookiePwd) {
                accessCode = cookiePwd;
            } else {
                try {
                    const decodedUrl = decodeURIComponent(shareUrl);
                    const pwdMatch = decodedUrl.match(/[（(]访问码[：:]\s*([a-zA-Z0-9]+)/);
                    if (pwdMatch && pwdMatch[1]) accessCode = pwdMatch[1];
                } catch (e) { /* ignore */ }
            }
        }

        let shareId = shareCode;

        if (accessCode) {
            const checkUrl = `https://cloud.189.cn/api/open/share/checkAccessCode.action?shareCode=${shareCode}&accessCode=${accessCode}`;
            try {
                const checkText = await gmGet(checkUrl, {
                    Accept: "application/json;charset=UTF-8",
                    Referer: "https://cloud.189.cn/web/main/",
                });
                const checkData = JSON.parse(checkText);
                if (checkData.shareId) shareId = checkData.shareId;
            } catch (e) { /* ignore */ }
        }

        const params = { shareCode, accessCode: accessCode };
        const timestamp = Date.now().toString();
        const appKey = "600100422";
        const signData = { ...params, Timestamp: timestamp, AppKey: appKey };
        const signature = this.get189Signature(signData);
        const apiUrl = `https://cloud.189.cn/api/open/share/getShareInfoByCodeV2.action?${new URLSearchParams(params)}`;

        const text = await gmGet(apiUrl, {
            Accept: "application/json;charset=UTF-8",
            "Sign-Type": "1",
            Signature: signature,
            Timestamp: timestamp,
            AppKey: appKey,
            Referer: "https://cloud.189.cn/web/main/",
        });

        let data;
        try {
            data = JSON.parse(text.replace(/"(id|fileId|parentId|shareId)":"?(\d{15,})"?/g, '"$1":"$2"'));
        } catch (e) {
            throw new Error("解析分享信息失败");
        }

        if (data.res_code !== 0) {
            if (data.res_code === 40401 && !accessCode) throw new Error("该分享需要提取码，请输入提取码");
            throw new Error(`获取分享信息失败: ${data.res_message || "未知错误"}`);
        }

        return {
            shareId: data.shareId || shareId,
            shareMode: data.shareMode || "0",
            accessCode: accessCode,
            shareCode: shareCode,
            title: data.fileName || "",
        };
    },

    async get189ShareFiles(shareId, shareDirFileId, fileId, path = "", shareMode = "0", accessCode = "", shareCode = "", onProgress = null) {
        const files = [];
        let page = 1;

        while (true) {
            const params = {
                pageNum: page.toString(), pageSize: "100",
                fileId: fileId.toString(), shareDirFileId: shareDirFileId.toString(),
                isFolder: "true", shareId: shareId.toString(),
                shareMode: shareMode, iconOption: "5",
                orderBy: "lastOpTime", descending: "true",
                accessCode: accessCode || "",
            };
            const queryString = new URLSearchParams(params).toString();
            const url = `https://cloud.189.cn/api/open/share/listShareDir.action?${queryString}`;

            const headers = { Accept: "application/json;charset=UTF-8", Referer: "https://cloud.189.cn/web/main/" };
            if (shareCode && accessCode) headers["Cookie"] = `share_${shareCode}=${accessCode}`;

            const text = await gmGet(url, headers);
            let data;
            try {
                const fixedText = text.replace(/"(id|fileId|parentId|shareId)":(\d{15,})/g, '"$1":"$2"');
                data = JSON.parse(fixedText);
            } catch (e) { break; }

            if (data.res_code !== 0) {
                if (data.res_code === "FileNotFound" && path) {
                    console.log(`[189] 警告：子文件夹 "${path}" 访问失败`);
                }
                break;
            }

            const fileList = data.fileListAO?.fileList || [];
            const folderList = data.fileListAO?.folderList || [];

            for (const file of fileList) {
                const filePath = path ? `${path}/${file.name}` : file.name;
                files.push({ path: filePath, etag: (file.md5 || "").toLowerCase(), size: file.size });
                if (onProgress) onProgress();
            }

            for (const folder of folderList) {
                const folderPath = path ? `${path}/${folder.name}` : folder.name;
                const subFiles = await this.get189ShareFiles(shareId, folder.id, folder.id, folderPath, shareMode, accessCode, shareCode, onProgress);
                files.push(...subFiles);
            }

            if (fileList.length + folderList.length < 100) break;
            page++;
        }
        return files;
    },

    get189Signature(params) {
        const sortedKeys = Object.keys(params).sort();
        const sortedParams = sortedKeys.map((key) => `${key}=${params[key]}`).join("&");
        return this.simpleMD5(sortedParams);
    },

    simpleMD5(string) {
        function rotateLeft(lValue, iShiftBits) { return (lValue << iShiftBits) | (lValue >>> (32 - iShiftBits)); }
        function addUnsigned(lX, lY) {
            var lX4, lY4, lX8, lY8, lResult;
            lX8 = lX & 0x80000000; lY8 = lY & 0x80000000;
            lX4 = lX & 0x40000000; lY4 = lY & 0x40000000;
            lResult = (lX & 0x3fffffff) + (lY & 0x3fffffff);
            if (lX4 & lY4) return lResult ^ 0x80000000 ^ lX8 ^ lY8;
            if (lX4 | lY4) {
                if (lResult & 0x40000000) return lResult ^ 0xc0000000 ^ lX8 ^ lY8;
                else return lResult ^ 0x40000000 ^ lX8 ^ lY8;
            } else return lResult ^ lX8 ^ lY8;
        }
        function F(x, y, z) { return (x & y) | (~x & z); }
        function G(x, y, z) { return (x & z) | (y & ~z); }
        function H(x, y, z) { return x ^ y ^ z; }
        function I(x, y, z) { return y ^ (x | ~z); }
        function FF(a, b, c, d, x, s, ac) { a = addUnsigned(a, addUnsigned(addUnsigned(F(b, c, d), x), ac)); return addUnsigned(rotateLeft(a, s), b); }
        function GG(a, b, c, d, x, s, ac) { a = addUnsigned(a, addUnsigned(addUnsigned(G(b, c, d), x), ac)); return addUnsigned(rotateLeft(a, s), b); }
        function HH(a, b, c, d, x, s, ac) { a = addUnsigned(a, addUnsigned(addUnsigned(H(b, c, d), x), ac)); return addUnsigned(rotateLeft(a, s), b); }
        function II(a, b, c, d, x, s, ac) { a = addUnsigned(a, addUnsigned(addUnsigned(I(b, c, d), x), ac)); return addUnsigned(rotateLeft(a, s), b); }
        function convertToWordArray(string) {
            var lWordCount, lMessageLength = string.length, lNumberOfWords_temp1 = lMessageLength + 8;
            var lNumberOfWords_temp2 = (lNumberOfWords_temp1 - (lNumberOfWords_temp1 % 64)) / 64;
            var lNumberOfWords = (lNumberOfWords_temp2 + 1) * 16;
            var lWordArray = Array(lNumberOfWords - 1);
            var lBytePosition = 0, lByteCount = 0;
            while (lByteCount < lMessageLength) {
                lWordCount = (lByteCount - (lByteCount % 4)) / 4;
                lBytePosition = (lByteCount % 4) * 8;
                lWordArray[lWordCount] = lWordArray[lWordCount] | (string.charCodeAt(lByteCount) << lBytePosition);
                lByteCount++;
            }
            lWordCount = (lByteCount - (lByteCount % 4)) / 4;
            lBytePosition = (lByteCount % 4) * 8;
            lWordArray[lWordCount] = lWordArray[lWordCount] | (0x80 << lBytePosition);
            lWordArray[lNumberOfWords - 2] = lMessageLength << 3;
            lWordArray[lNumberOfWords - 1] = lMessageLength >>> 29;
            return lWordArray;
        }
        function wordToHex(lValue) {
            var WordToHexValue = "", WordToHexValue_temp = "", lByte, lCount;
            for (lCount = 0; lCount <= 3; lCount++) {
                lByte = (lValue >>> (lCount * 8)) & 255;
                WordToHexValue_temp = "0" + lByte.toString(16);
                WordToHexValue = WordToHexValue + WordToHexValue_temp.substr(WordToHexValue_temp.length - 2, 2);
            }
            return WordToHexValue;
        }

        var x = convertToWordArray(string);
        var k, AA, BB, CC, DD, a, b, c, d;
        var S11 = 7, S12 = 12, S13 = 17, S14 = 22;
        var S21 = 5, S22 = 9, S23 = 14, S24 = 20;
        var S31 = 4, S32 = 11, S33 = 16, S34 = 23;
        var S41 = 6, S42 = 10, S43 = 15, S44 = 21;
        a = 0x67452301; b = 0xefcdab89; c = 0x98badcfe; d = 0x10325476;

        for (k = 0; k < x.length; k += 16) {
            AA = a; BB = b; CC = c; DD = d;
            a = FF(a, b, c, d, x[k + 0], S11, 0xd76aa478); d = FF(d, a, b, c, x[k + 1], S12, 0xe8c7b756);
            c = FF(c, d, a, b, x[k + 2], S13, 0x242070db); b = FF(b, c, d, a, x[k + 3], S14, 0xc1bdceee);
            a = FF(a, b, c, d, x[k + 4], S11, 0xf57c0faf); d = FF(d, a, b, c, x[k + 5], S12, 0x4787c62a);
            c = FF(c, d, a, b, x[k + 6], S13, 0xa8304613); b = FF(b, c, d, a, x[k + 7], S14, 0xfd469501);
            a = FF(a, b, c, d, x[k + 8], S11, 0x698098d8); d = FF(d, a, b, c, x[k + 9], S12, 0x8b44f7af);
            c = FF(c, d, a, b, x[k + 10], S13, 0xffff5bb1); b = FF(b, c, d, a, x[k + 11], S14, 0x895cd7be);
            a = FF(a, b, c, d, x[k + 12], S11, 0x6b901122); d = FF(d, a, b, c, x[k + 13], S12, 0xfd987193);
            c = FF(c, d, a, b, x[k + 14], S13, 0xa679438e); b = FF(b, c, d, a, x[k + 15], S14, 0x49b40821);
            a = GG(a, b, c, d, x[k + 1], S21, 0xf61e2562); d = GG(d, a, b, c, x[k + 6], S22, 0xc040b340);
            c = GG(c, d, a, b, x[k + 11], S23, 0x265e5a51); b = GG(b, c, d, a, x[k + 0], S24, 0xe9b6c7aa);
            a = GG(a, b, c, d, x[k + 5], S21, 0xd62f105d); d = GG(d, a, b, c, x[k + 10], S22, 0x2441453);
            c = GG(c, d, a, b, x[k + 15], S23, 0xd8a1e681); b = GG(b, c, d, a, x[k + 4], S24, 0xe7d3fbc8);
            a = GG(a, b, c, d, x[k + 9], S21, 0x21e1cde6); d = GG(d, a, b, c, x[k + 14], S22, 0xc33707d6);
            c = GG(c, d, a, b, x[k + 3], S23, 0xf4d50d87); b = GG(b, c, d, a, x[k + 8], S24, 0x455a14ed);
            a = GG(a, b, c, d, x[k + 13], S21, 0xa9e3e905); d = GG(d, a, b, c, x[k + 2], S22, 0xfcefa3f8);
            c = GG(c, d, a, b, x[k + 7], S23, 0x676f02d9); b = GG(b, c, d, a, x[k + 12], S24, 0x8d2a4c8a);
            a = HH(a, b, c, d, x[k + 5], S31, 0xfffa3942); d = HH(d, a, b, c, x[k + 8], S32, 0x8771f681);
            c = HH(c, d, a, b, x[k + 11], S33, 0x6d9d6122); b = HH(b, c, d, a, x[k + 14], S34, 0xfde5380c);
            a = HH(a, b, c, d, x[k + 1], S31, 0xa4beea44); d = HH(d, a, b, c, x[k + 4], S32, 0x4bdecfa9);
            c = HH(c, d, a, b, x[k + 7], S33, 0xf6bb4b60); b = HH(b, c, d, a, x[k + 10], S34, 0xbebfbc70);
            a = HH(a, b, c, d, x[k + 13], S31, 0x289b7ec6); d = HH(d, a, b, c, x[k + 0], S32, 0xeaa127fa);
            c = HH(c, d, a, b, x[k + 3], S33, 0xd4ef3085); b = HH(b, c, d, a, x[k + 6], S34, 0x4881d05);
            a = HH(a, b, c, d, x[k + 9], S31, 0xd9d4d039); d = HH(d, a, b, c, x[k + 12], S32, 0xe6db99e5);
            c = HH(c, d, a, b, x[k + 15], S33, 0x1fa27cf8); b = HH(b, c, d, a, x[k + 2], S34, 0xc4ac5665);
            a = II(a, b, c, d, x[k + 0], S41, 0xf4292244); d = II(d, a, b, c, x[k + 7], S42, 0x432aff97);
            c = II(c, d, a, b, x[k + 14], S43, 0xab9423a7); b = II(b, c, d, a, x[k + 5], S44, 0xfc93a039);
            a = II(a, b, c, d, x[k + 12], S41, 0x655b59c3); d = II(d, a, b, c, x[k + 3], S42, 0x8f0ccc92);
            c = II(c, d, a, b, x[k + 10], S43, 0xffeff47d); b = II(b, c, d, a, x[k + 1], S44, 0x85845dd1);
            a = II(a, b, c, d, x[k + 8], S41, 0x6fa87e4f); d = II(d, a, b, c, x[k + 15], S42, 0xfe2ce6e0);
            c = II(c, d, a, b, x[k + 6], S43, 0xa3014314); b = II(b, c, d, a, x[k + 13], S44, 0x4e0811a1);
            a = II(a, b, c, d, x[k + 4], S41, 0xf7537e82); d = II(d, a, b, c, x[k + 11], S42, 0xbd3af235);
            c = II(c, d, a, b, x[k + 2], S43, 0x2ad7d2bb); b = II(b, c, d, a, x[k + 9], S44, 0xeb86d391);
            a = addUnsigned(a, AA); b = addUnsigned(b, BB); c = addUnsigned(c, CC); d = addUnsigned(d, DD);
        }
        return (wordToHex(a) + wordToHex(b) + wordToHex(c) + wordToHex(d)).toLowerCase();
    },
};
