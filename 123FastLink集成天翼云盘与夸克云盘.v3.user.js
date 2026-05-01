// ==UserScript==
// @name         123FastLink
// @namespace    http://tampermonkey.net/
// @version      2026.4.03.1
// @description  123云盘秒传链接脚本，集成夸克网盘/天翼云盘秒传JSON生成器
// @author       Baoqing
// @author       Chaofan
// @author       lipkiat
// @match        *://*.123pan.com/*
// @match        *://*.123pan.cn/*
// @match        https://pan.quark.cn/*
// @match        https://drive.quark.cn/*
// @match        https://pan.quark.cn/s/*
// @match        https://drive.quark.cn/s/*
// @match        https://cloud.189.cn/web/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=123pan.com
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_setClipboard
// @grant        GM_notification
// @grant        GM_xmlhttpRequest
// @grant        GM_cookie
// @grant        GM_info
// @connect      drive.quark.cn
// @connect      drive-pc.quark.cn
// @connect      pc-api.uc.cn
// @connect      cloud.189.cn
// @license      MIT
// ==/UserScript==


(function () {
    'use strict';
    var GlobalConfig = {
        scriptVersion: "3.1.4",                     // 脚本版本
        usesBase62EtagsInExport: true,              // 导出时使用Base62编码的etag
        getFileListPageDelay: 500,                  // 获取文件列表每页延时
        getFileInfoBatchSize: 100,                  // 批量获取文件信息的数量
        getFileInfoDelay: 200,                      // 获取文件信息延时
        getFolderInfoDelay: 300,                    // 获取文件夹信息延时
        saveLinkDelay: 100,                         // 保存链接延时
        mkdirDelay: 100,                            // 创建文件夹延时
        scriptName: "123FASTLINKV3",                // 脚本名称
        COMMON_PATH_LINK_PREFIX_V2: "123FLCPV2$",   // 通用路径链接前缀V2
        MAX_TEXT_FILE_SIZE: 3 * 1024 * 1024,        // 文本文件最大3MB
        DEFAULT_EXPORT_FILENAME: "123FastLink_Export", // 默认导出文件名
        DEBUGMODE: false, seedFilePathId: null,                        // 种子文件路径ID
        secondaryLinkUseJson: true                  // 二级秒传链接使用JSON格式
    };

    // 1. 123云盘API通信类
    class PanApiClient {
        constructor() {
            this.init();
        }

        init() {
            this.host = 'https://' + window.location.host;
            this.authToken = localStorage['authorToken'];
            this.loginUuid = localStorage['LoginUuid'];
            this.appVersion = '3';
            this.referer = document.location.href;
            this.getFileListPageDelay = GlobalConfig.getFileListPageDelay;
            this.maxTextFileSize = GlobalConfig.MAX_TEXT_FILE_SIZE;
            this.progress = 0;
            this.progressDesc = "";
        }

        buildURL(path, queryParams) {
            const queryString = new URLSearchParams(queryParams || {}).toString();
            return `${this.host}${path}?${queryString}`;
        }

        async sendRequest(method, path, queryParams, body) {
            const headers = {
                'Content-Type': 'application/json;charset=UTF-8',
                'Authorization': 'Bearer ' + this.authToken,
                'platform': 'web',
                'App-Version': this.appVersion,
                'LoginUuid': this.loginUuid,
                'Origin': this.host,
                'Referer': this.referer,
            };
            try {
                const response = await fetch(this.buildURL(path, queryParams), {
                    method, headers, body, credentials: 'include'
                });
                const data = await response.json();
                if (data.code !== 0) {
                    throw new Error(data.message);
                }
                return data;
            } catch (e) {
                console.error('[123FASTLINK] [PanApiClient]', 'API请求失败:', e);
                throw e;
            }
        }

        async getOnePageFileList(parentFileId, page) {
            const urlParams = {
                //'2015049069': '1756010983-3879364-4059457292',
                driveId: '0',
                limit: '100',
                next: '0',
                orderBy: 'file_name',
                orderDirection: 'asc',
                parentFileId: parentFileId.toString(),
                trashed: 'false',
                SearchData: '',
                Page: page.toString(),
                OnlyLookAbnormalFile: '0',
                event: 'homeListFile',
                operateType: '1',
                inDirectSpace: 'false'
            };
            const data = await this.sendRequest("GET", "/b/api/file/list/new", urlParams);
            //console.log("[123FASTLINK] [PanApiClient]", "获取文件列表:", data.data.InfoList);
            console.log("[123FASTLINK] [PanApiClient]", "获取文件列表 ID：", parentFileId, "Page：", page);
            return {data: {InfoList: data.data.InfoList}, total: data.data.Total};
            //return { data: { fileList: data.data.fileList } };
        }

        async getFileList(parentFileId) {
            let InfoList = [];
            this.progress = 0;
            this.progressDesc = `获取文件列表 文件夹ID：${parentFileId}`;
            // 默认一页100
            // 先获取一次，得到Total
            console.log("[123FASTLINK] [PanApiClient]", "开始获取文件列表,ID:", parentFileId);
            const info = await this.getOnePageFileList(parentFileId, 1);
            InfoList.push(...info.data.InfoList);
            const total = info.total;
            if (total > 100) {
                const times = Math.ceil(total / 100);
                for (let i = 2; i < times + 1; i++) {
                    this.progress = Math.ceil((i / times) * 100);
                    // this.progressDesc = `获取文件列表: ${this.progress}%`;
                    const pageInfo = await this.getOnePageFileList(parentFileId, i);
                    InfoList.push(...pageInfo.data.InfoList);
                    // 延时
                    await new Promise(resolve => setTimeout(resolve, this.getFileListPageDelay));
                }
            }
            this.progress = 100;
            return {data: {InfoList}, total: total};
        }

        async getFileInfo(idList) {
            const fileIdList = idList.map(fileId => ({fileId}));
            const data = await this.sendRequest("POST", "/b/api/file/info", {}, JSON.stringify({fileIdList}));
            return {data: {InfoList: data.data.infoList}};
        }

        // 尝试秒传
        async fastUpload(fileInfo) {
            try {
                const response = await this.sendRequest('POST', '/b/api/file/upload_request', {}, JSON.stringify({
                    ...fileInfo, RequestSource: null
                }));
                const reuse = response['data']['Reuse'];
                console.log('[123FASTLINK] [PanApiClient]', 'reuse：', reuse);
                if (response['code'] !== 0) {
                    return [false, response['message'], null];
                }
                if (!reuse) {
                    console.error('[123FASTLINK] [PanApiClient]', '保存文件失败:', fileInfo.fileName, 'response:', response);
                    return [false, "未能实现秒传", null];
                } else {
                    return [true, null, response['data']['Info']['FileId']];
                }
            } catch (error) {
                console.error('[123FASTLINK] [PanApiClient]', '上传请求失败:', error);
                return [false, '请求失败', null];
            }
        }

        // 从sessionStorage中获取父级文件ID
        async getParentFileId() {
            const homeFilePath = JSON.parse(sessionStorage['filePath'])['homeFilePath'];
            const parentFileId = (homeFilePath[homeFilePath.length - 1] || 0);
            console.log('[123FASTLINK] [PanApiClient] parentFileId:', parentFileId);
            return parentFileId.toString();
        }

        /**
         * 获取文件，尝试秒传
         * @param {dict} fileInfo - 文件信息字典，包含 etag, fileName, size 字段
         * @param {string} parentFileId
         * @returns [boolean, string] - [是否成功, 错误信息]
         */
        async getFile(fileInfo, parentFileId) {
            if (!parentFileId) {
                parentFileId = await this.getParentFileId();
            }
            return await this.fastUpload({
                driveId: 0,
                etag: fileInfo.etag,
                fileName: fileInfo.fileName,
                parentFileId,
                size: fileInfo.size,
                type: 0,
                duplicate: 1
            });
        }

        async mkdirInNowFolder(folderName = "New Folder") {
            const parentFileId = await this.getParentFileId();
            return this.mkdir(parentFileId, folderName);
        }

        async mkdir(parentFileId, folderName = "New Folder") {
            let folderFileId = null;
            try {
                const response = await this.sendRequest('POST', '/b/api/file/upload_request', {}, JSON.stringify({
                    driveId: 0,
                    etag: "",
                    fileName: folderName,
                    parentFileId,
                    size: 0,
                    type: 1,
                    duplicate: 1,
                    NotReuse: true,
                    event: "newCreateFolder",
                    operateType: 1,
                    RequestSource: null
                }));
                folderFileId = response['data']['Info']['FileId'];
            } catch (error) {
                console.error('[123FASTLINK] [PanApiClient]', '创建文件夹失败:', error);
                return {
                    'folderFileId': null, 'folderName': folderName, 'success': false
                };
            }
            console.log('[123FASTLINK] [PanApiClient]', '创建文件夹 ID:', folderFileId);
            return {
                'folderFileId': folderFileId, 'folderName': folderName, 'success': true
            };
        }


        calculateStringSize(text) {
            // 使用TextEncoder计算UTF-8编码的字节大小
            const encoder = new TextEncoder();
            return encoder.encode(text).length;
        }

        md5(inputString) {
            var hc = "0123456789abcdef";

            function rh(n) {
                var j, s = "";
                for (j = 0; j <= 3; j++) s += hc.charAt((n >> (j * 8 + 4)) & 0x0F) + hc.charAt((n >> (j * 8)) & 0x0F);
                return s;
            }

            function ad(x, y) {
                var l = (x & 0xFFFF) + (y & 0xFFFF);
                var m = (x >> 16) + (y >> 16) + (l >> 16);
                return (m << 16) | (l & 0xFFFF);
            }

            function rl(n, c) {
                return (n << c) | (n >>> (32 - c));
            }

            function cm(q, a, b, x, s, t) {
                return ad(rl(ad(ad(a, q), ad(x, t)), s), b);
            }

            function ff(a, b, c, d, x, s, t) {
                return cm((b & c) | ((~b) & d), a, b, x, s, t);
            }

            function gg(a, b, c, d, x, s, t) {
                return cm((b & d) | (c & (~d)), a, b, x, s, t);
            }

            function hh(a, b, c, d, x, s, t) {
                return cm(b ^ c ^ d, a, b, x, s, t);
            }

            function ii(a, b, c, d, x, s, t) {
                return cm(c ^ (b | (~d)), a, b, x, s, t);
            }

            function sb(x) {
                var i;
                var nblk = ((x.length + 8) >> 6) + 1;
                var blks = new Array(nblk * 16);
                for (i = 0; i < nblk * 16; i++) blks[i] = 0;
                for (i = 0; i < x.length; i++) blks[i >> 2] |= x.charCodeAt(i) << ((i % 4) * 8);
                blks[i >> 2] |= 0x80 << ((i % 4) * 8);
                blks[nblk * 16 - 2] = x.length * 8;
                return blks;
            }

            var i, x = sb(inputString), a = 1732584193, b = -271733879, c = -1732584194, d = 271733878, olda, oldb,
                oldc, oldd;
            for (i = 0; i < x.length; i += 16) {
                olda = a;
                oldb = b;
                oldc = c;
                oldd = d;
                a = ff(a, b, c, d, x[i + 0], 7, -680876936);
                d = ff(d, a, b, c, x[i + 1], 12, -389564586);
                c = ff(c, d, a, b, x[i + 2], 17, 606105819);
                b = ff(b, c, d, a, x[i + 3], 22, -1044525330);
                a = ff(a, b, c, d, x[i + 4], 7, -176418897);
                d = ff(d, a, b, c, x[i + 5], 12, 1200080426);
                c = ff(c, d, a, b, x[i + 6], 17, -1473231341);
                b = ff(b, c, d, a, x[i + 7], 22, -45705983);
                a = ff(a, b, c, d, x[i + 8], 7, 1770035416);
                d = ff(d, a, b, c, x[i + 9], 12, -1958414417);
                c = ff(c, d, a, b, x[i + 10], 17, -42063);
                b = ff(b, c, d, a, x[i + 11], 22, -1990404162);
                a = ff(a, b, c, d, x[i + 12], 7, 1804603682);
                d = ff(d, a, b, c, x[i + 13], 12, -40341101);
                c = ff(c, d, a, b, x[i + 14], 17, -1502002290);
                b = ff(b, c, d, a, x[i + 15], 22, 1236535329);
                a = gg(a, b, c, d, x[i + 1], 5, -165796510);
                d = gg(d, a, b, c, x[i + 6], 9, -1069501632);
                c = gg(c, d, a, b, x[i + 11], 14, 643717713);
                b = gg(b, c, d, a, x[i + 0], 20, -373897302);
                a = gg(a, b, c, d, x[i + 5], 5, -701558691);
                d = gg(d, a, b, c, x[i + 10], 9, 38016083);
                c = gg(c, d, a, b, x[i + 15], 14, -660478335);
                b = gg(b, c, d, a, x[i + 4], 20, -405537848);
                a = gg(a, b, c, d, x[i + 9], 5, 568446438);
                d = gg(d, a, b, c, x[i + 14], 9, -1019803690);
                c = gg(c, d, a, b, x[i + 3], 14, -187363961);
                b = gg(b, c, d, a, x[i + 8], 20, 1163531501);
                a = gg(a, b, c, d, x[i + 13], 5, -1444681467);
                d = gg(d, a, b, c, x[i + 2], 9, -51403784);
                c = gg(c, d, a, b, x[i + 7], 14, 1735328473);
                b = gg(b, c, d, a, x[i + 12], 20, -1926607734);
                a = hh(a, b, c, d, x[i + 5], 4, -378558);
                d = hh(d, a, b, c, x[i + 8], 11, -2022574463);
                c = hh(c, d, a, b, x[i + 11], 16, 1839030562);
                b = hh(b, c, d, a, x[i + 14], 23, -35309556);
                a = hh(a, b, c, d, x[i + 1], 4, -1530992060);
                d = hh(d, a, b, c, x[i + 4], 11, 1272893353);
                c = hh(c, d, a, b, x[i + 7], 16, -155497632);
                b = hh(b, c, d, a, x[i + 10], 23, -1094730640);
                a = hh(a, b, c, d, x[i + 13], 4, 681279174);
                d = hh(d, a, b, c, x[i + 0], 11, -358537222);
                c = hh(c, d, a, b, x[i + 3], 16, -722521979);
                b = hh(b, c, d, a, x[i + 6], 23, 76029189);
                a = hh(a, b, c, d, x[i + 9], 4, -640364487);
                d = hh(d, a, b, c, x[i + 12], 11, -421815835);
                c = hh(c, d, a, b, x[i + 15], 16, 530742520);
                b = hh(b, c, d, a, x[i + 2], 23, -995338651);
                a = ii(a, b, c, d, x[i + 0], 6, -198630844);
                d = ii(d, a, b, c, x[i + 7], 10, 1126891415);
                c = ii(c, d, a, b, x[i + 14], 15, -1416354905);
                b = ii(b, c, d, a, x[i + 5], 21, -57434055);
                a = ii(a, b, c, d, x[i + 12], 6, 1700485571);
                d = ii(d, a, b, c, x[i + 3], 10, -1894986606);
                c = ii(c, d, a, b, x[i + 10], 15, -1051523);
                b = ii(b, c, d, a, x[i + 1], 21, -2054922799);
                a = ii(a, b, c, d, x[i + 8], 6, 1873313359);
                d = ii(d, a, b, c, x[i + 15], 10, -30611744);
                c = ii(c, d, a, b, x[i + 6], 15, -1560198380);
                b = ii(b, c, d, a, x[i + 13], 21, 1309151649);
                a = ii(a, b, c, d, x[i + 4], 6, -145523070);
                d = ii(d, a, b, c, x[i + 11], 10, -1120210379);
                c = ii(c, d, a, b, x[i + 2], 15, 718787259);
                b = ii(b, c, d, a, x[i + 9], 21, -343485551);
                a = ad(a, olda);
                b = ad(b, oldb);
                c = ad(c, oldc);
                d = ad(d, oldd);
            }
            return rh(a) + rh(b) + rh(c) + rh(d);
        }


        /**
         * 第一步：上传请求
         */
        async uploadRequest(fileInfo) {
            try {
                const data = await this.sendRequest('POST', '/b/api/file/upload_request', {}, JSON.stringify({
                    ...fileInfo, RequestSource: null
                }));

                console.log('[123FASTLINK] [文本上传]', 'upload_request响应:', data);

                if (data.code !== 0) {
                    return [false, data.message, null];
                }

                return [true, null, data.data];

            } catch (error) {
                console.error('[123FASTLINK] [文本上传]', '上传请求失败:', error);
                return [false, '上传请求失败: ' + error.message, null];
            }
        }

        /**
         * 第二步：获取S3上传凭证
         */
        async getUploadAuth(bucket, key, uploadId, storageNode, partNumberStart = 1, partNumberEnd = 1) {
            try {
                const data = await this.sendRequest('POST', '/b/api/file/s3_upload_object/auth', {}, JSON.stringify({
                    bucket: bucket,
                    key: key,
                    partNumberEnd: partNumberEnd.toString(),
                    partNumberStart: partNumberStart.toString(),
                    uploadId: uploadId,
                    StorageNode: storageNode
                }));

                console.log('[123FASTLINK] [文本上传]', '获取上传凭证响应:', data);

                if (data.code !== 0) {
                    return [false, data.message, null];
                }

                const presignedUrls = data.data.presignedUrls;
                const firstUrl = presignedUrls[partNumberStart.toString()];

                if (!firstUrl) {
                    return [false, '未获取到上传URL', null];
                }

                return [true, null, firstUrl];

            } catch (error) {
                console.error('[123FASTLINK] [文本上传]', '获取上传凭证失败:', error);
                return [false, '获取上传凭证失败: ' + error.message, null];
            }
        }

        /**
         * 第三步：上传文本到S3
         * 上传整个文本内容（非分片），不使用sendRequest
         * @param {string} presignedUrl - 预签名URL
         * @param {string} text - 要上传的文本内容
         * @returns {Promise<Array>} [是否成功, 错误信息]
         */
        async uploadToS3Entire(presignedUrl, text) {
            try {
                // 将文本转换为Blob
                const blob = new Blob([text], {type: 'text/plain;charset=utf-8'});

                console.log('[123FASTLINK] [文本上传]', '开始上传到S3:', presignedUrl);

                // 移除 x-amz-acl 头，因为预签名URL通常已经包含了所有必要的认证信息
                const response = await fetch(presignedUrl, {
                    method: 'PUT', headers: {
                        'Content-Type': 'text/plain;charset=utf-8'
                        // 注意：不要添加 x-amz-acl，因为预签名URL已经包含了权限信息
                    }, body: blob
                });

                console.log('[123FASTLINK] [文本上传]', 'S3上传响应状态:', response.status, response.statusText);

                if (response.ok || response.status === 200) {
                    return [true, null];
                } else {
                    const errorText = await response.text();
                    console.error('[123FASTLINK] [文本上传]', 'S3上传失败详情:', errorText);

                    // 尝试不带Content-Type头再次上传（某些S3配置可能不需要）
                    if (response.status === 403 || response.status === 400) {
                        console.log('[123FASTLINK] [文本上传]', '尝试不带Content-Type头上传');
                        const retryResponse = await fetch(presignedUrl, {
                            method: 'PUT', body: blob
                            // 完全不设置headers
                        });

                        if (retryResponse.ok || retryResponse.status === 200) {
                            return [true, null];
                        } else {
                            const retryError = await retryResponse.text();
                            return [false, `S3上传失败: ${response.status} ${response.statusText}, 重试: ${retryResponse.status} ${retryResponse.statusText}`];
                        }
                    }

                    return [false, `S3上传失败: ${response.status} ${response.statusText}`];
                }

            } catch (error) {
                console.error('[123FASTLINK] [文本上传]', 'S3上传失败:', error);
                return [false, 'S3上传失败: ' + error.message];
            }
        }

        /**
         * 第四步：完成上传
         */
        async completeUpload(fileId, bucket, fileSize, key, uploadId, storageNode) {
            try {
                const data = await this.sendRequest('POST', '/b/api/file/upload_complete/v2', {}, JSON.stringify({
                    fileId: fileId, bucket: bucket, fileSize: fileSize.toString(), key: key, isMultipart: false,  // 文本文件较小，单分片上传
                    uploadId: uploadId, StorageNode: storageNode
                }));

                console.log('[123FASTLINK] [文本上传]', '完成上传响应:', data);

                if (data.code !== 0) {
                    return [false, data.message, null];
                }

                return [true, null, data.data];

            } catch (error) {
                console.error('[123FASTLINK] [文本上传]', '完成上传失败:', error);
                return [false, '完成上传失败: ' + error.message, null];
            }
        }

        /**
         * 完整文本上传流程
         * @param {string} fileName - 文件名
         * @param {string} text - 要上传的文本内容
         * @param {string|number} parentFileId - 父文件夹ID，可选
         * @param {boolean} calculateMD5 - 是否计算MD5，默认true
         * @returns {Promise<Array>} [是否成功, 错误信息, 文件ID]
         */
        async uploadTextFile(fileName, text, parentFileId = 0) {
            try {
                console.log('[123FASTLINK] [文本上传]', '开始上传文本文件:', fileName);

                // 1. 获取父文件夹ID
                if (!parentFileId) {
                    parentFileId = await this.getParentFileId();
                }

                // 2. 计算文件大小
                const fileSize = this.calculateStringSize(text);
                console.log('[123FASTLINK] [文本上传]', '文件大小:', fileSize, '字节');

                // 3. 计算MD5
                const md5 = this.md5(text);
                console.log('[123FASTLINK] [文本上传]', '文件MD5:', md5);

                // 4. 第一步：上传请求
                console.log('[123FASTLINK] [文本上传]', '步骤1: 上传请求');
                const [requestSuccess, requestError, uploadData] = await this.uploadRequest({
                    driveId: 0, etag: md5, fileName: fileName, parentFileId: parentFileId, size: fileSize, type: 0,  // 0表示文件，1表示文件夹
                    duplicate: 1,  // 1表示覆盖同名文件
                    event: "homeUploadFile",  // 添加事件类型
                    operateType: 1
                });

                if (!requestSuccess) {
                    return [false, '上传请求失败: ' + requestError, null];
                }

                console.log('[123FASTLINK] [文本上传]', '上传请求数据:', uploadData);

                // 5. 检查是否秒传
                if (uploadData.Reuse) {
                    console.log('[123FASTLINK] [文本上传]', '秒传成功，文件ID:', uploadData.FileId);
                    return [true, "秒传成功", uploadData.FileId, {
                        etag: md5, fileName: fileName, size: fileSize
                    }];
                }

                // 6. 第二步：获取上传凭证
                console.log('[123FASTLINK] [文本上传]', '步骤2: 获取上传凭证');
                const [authSuccess, authError, presignedUrl] = await this.getUploadAuth(uploadData.Bucket, uploadData.Key, uploadData.UploadId, uploadData.StorageNode);

                if (!authSuccess) {
                    return [false, '获取上传凭证失败: ' + authError, null];
                }

                console.log('[123FASTLINK] [文本上传]', '预签名URL:', presignedUrl);

                // 7. 第三步：上传到S3
                console.log('[123FASTLINK] [文本上传]', '步骤3: 上传到S3');
                const [uploadSuccess, uploadError] = await this.uploadToS3Entire(presignedUrl, text);

                if (!uploadSuccess) {
                    return [false, 'S3上传失败: ' + uploadError, null];
                }

                console.log('[123FASTLINK] [文本上传]', 'S3上传成功');

                // 8. 第四步：完成上传
                console.log('[123FASTLINK] [文本上传]', '步骤4: 完成上传');
                const [completeSuccess, completeError, completeData] = await this.completeUpload(uploadData.FileId, uploadData.Bucket, fileSize, uploadData.Key, uploadData.UploadId, uploadData.StorageNode);

                if (!completeSuccess) {
                    return [false, '完成上传失败: ' + completeError, null];
                }

                console.log('[123FASTLINK] [文本上传]', '上传完成，文件ID:', uploadData.FileId);
                return [true, "上传完成", uploadData.FileId, {
                    etag: md5, fileName: fileName, size: fileSize
                }];

            } catch (error) {
                console.error('[123FASTLINK] [文本上传]', '文本上传流程失败:', error);
                return [false, '上传流程失败: ' + error.message, null];
            }
        }

        /**
         * 创建文本文件（在指定文件夹中）
         * @param {string} fileName - 文件名
         * @param {string} text - 文本内容
         * @param {string|number} folderId - 文件夹ID
         * @returns {Promise<Array>} [是否成功, 错误信息, 文件ID]
         */
        async createTextFileInFolder(fileName, text, folderId) {
            return await this.uploadTextFile(fileName, text, folderId, true);
        }

        /**
         * 在当前文件夹创建文本文件
         * @param {string} fileName - 文件名
         * @param {string} text - 文本内容
         * @returns {Promise<Array>} [是否成功, 错误信息, 文件ID]
         */
        async createTextFileInCurrentFolder(fileName, text) {
            const parentFileId = await this.getParentFileId();
            return await this.uploadTextFile(fileName, text, parentFileId, true);
        }

        /**
         * 第一步：获取下载调度列表
         * @param {Object} fileInfo - 文件信息
         * @param {string} fileInfo.etag - 文件MD5
         * @param {string|number} fileInfo.fileId - 文件ID
         * @param {string} fileInfo.s3keyFlag - S3 Key标志
         * @param {string} fileInfo.fileName - 文件名
         * @param {string|number} fileInfo.size - 文件大小
         * @returns {Promise<Array>} [是否成功, 错误信息, 调度数据]
         */
        async getDispatchList(fileInfo) {
            try {
                console.log('[123FASTLINK] [下载API]', '获取下载调度列表，文件:', fileInfo.fileName);

                const data = await this.sendRequest('POST', '/b/api/v2/file/download_info', {}, JSON.stringify({
                    driveId: 0,
                    etag: fileInfo.etag,
                    fileId: fileInfo.fileId.toString(),
                    s3keyFlag: fileInfo.s3keyFlag,
                    type: 0,  // 0-文件
                    fileName: fileInfo.fileName,
                    size: fileInfo.size.toString()
                }));

                console.log('[123FASTLINK] [下载API]', '获取下载调度列表响应:', data);

                if (data.code !== 0) {
                    console.error('[123FASTLINK] [下载API]', '获取下载调度列表失败:', data.message);
                    return [false, data.message, null];
                }

                return [true, null, data.data];

            } catch (error) {
                console.error('[123FASTLINK] [下载API]', '获取下载调度列表异常:', error);
                return [false, '获取下载调度列表失败: ' + error.message, null];
            }
        }

        /**
         * 第二步：获取下载链接
         * 随机选择一个下载线路，拼接完整下载链接
         * @param {Object} fileInfo - 文件信息
         * @param {string} fileInfo.etag - 文件MD5
         * @param {string|number} fileInfo.fileId - 文件ID
         * @param {string} fileInfo.s3keyFlag - S3 Key标志
         * @param {string} fileInfo.fileName - 文件名
         * @param {string|number} fileInfo.size - 文件大小
         * @param {string} preferredIsp - 优先选择的ISP线路（可选）
         * @returns {Promise<Array>} [是否成功, 错误信息, 下载链接]
         */
        async getDownloadLink(fileInfo, preferredIsp = null) {
            try {
                console.log('[123FASTLINK] [下载API]', '获取下载链接，文件:', fileInfo.fileName);

                // 1. 获取调度列表
                const [dispatchSuccess, dispatchError, dispatchData] = await this.getDispatchList(fileInfo);
                if (!dispatchSuccess) {
                    return [false, dispatchError, null];
                }

                const {dispatchList, downloadPath} = dispatchData;

                if (!dispatchList || dispatchList.length === 0) {
                    return [false, '没有可用的下载线路', null];
                }

                if (!downloadPath) {
                    return [false, '没有获取到下载路径', null];
                }

                // 2. 选择下载线路
                let selectedDispatch = null;

                if (preferredIsp) {
                    // 如果指定了优先线路，尝试匹配
                    selectedDispatch = dispatchList.find(item => item.isp === preferredIsp);
                }

                // 如果没有匹配到指定线路，随机选择一个
                if (!selectedDispatch) {
                    const randomIndex = Math.floor(Math.random() * dispatchList.length);
                    selectedDispatch = dispatchList[randomIndex];
                }

                console.log('[123FASTLINK] [下载API]', '选择的下载线路:', selectedDispatch.isp, 'URL前缀:', selectedDispatch.prefix);

                // 3. 拼接完整的下载链接
                // 确保前缀不以斜杠结尾，路径以斜杠开头
                const cleanPrefix = selectedDispatch.prefix.endsWith('/') ? selectedDispatch.prefix.slice(0, -1) : selectedDispatch.prefix;
                const cleanPath = downloadPath.startsWith('/') ? downloadPath : '/' + downloadPath;

                const downloadLink = `${cleanPrefix}${cleanPath}`;

                console.log('[123FASTLINK] [下载API]', '完整下载链接:', downloadLink);

                return [true, null, {
                    downloadLink,
                    isp: selectedDispatch.isp,
                    prefix: selectedDispatch.prefix,
                    downloadPath,
                    fileId: fileInfo.fileId,
                    fileName: fileInfo.fileName
                }];

            } catch (error) {
                console.error('[123FASTLINK] [下载API]', '获取下载链接异常:', error);
                return [false, '获取下载链接失败: ' + error.message, null];
            }
        }

        /**
         * 第三步：获取链接文本内容
         * 通过GET请求下载链接，返回文本内容
         * @param {string} downloadLink - 下载链接
         * @param {Object} options - 可选参数
         * @param {number} options.timeout - 超时时间（毫秒），默认30000
         * @param {boolean} options.includeHeaders - 是否包含响应头信息
         * @returns {Promise<Array>} [是否成功, 错误信息, 文本内容/响应数据]
         */
        async getLinkTextContent(downloadLink, options = {}) {
            const {
                timeout = 30000, includeHeaders = false
            } = options;

            try {
                console.log('[123FASTLINK] [下载API]', '获取链接文本内容:', downloadLink);

                // 使用AbortController实现超时控制
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), timeout);

                try {
                    const response = await fetch(downloadLink, {
                        method: 'GET', signal: controller.signal, headers: {
                            'Accept': 'text/plain,text/html,application/json,*/*',
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                        }
                    });

                    clearTimeout(timeoutId);

                    console.log('[123FASTLINK] [下载API]', '响应状态:', response.status, response.statusText);

                    if (!response.ok) {
                        // 尝试获取更多错误信息
                        let errorText = '';
                        try {
                            errorText = await response.text();
                            console.error('[123FASTLINK] [下载API]', '错误响应内容:', errorText);
                        } catch (e) {
                            // 忽略读取错误
                        }

                        return [false, `HTTP ${response.status}: ${response.statusText}`, null];
                    }

                    // 获取响应头
                    const headers = {};
                    response.headers.forEach((value, key) => {
                        headers[key] = value;
                    });

                    // 获取文本内容
                    const textContent = await response.text();
                    console.log('[123FASTLINK] [下载API]', '获取到文本内容，长度:', textContent.length, '字符');

                    if (includeHeaders) {
                        return [true, null, {
                            content: textContent,
                            headers: headers,
                            status: response.status,
                            statusText: response.statusText
                        }];
                    } else {
                        return [true, null, textContent];
                    }

                } catch (fetchError) {
                    clearTimeout(timeoutId);
                    throw fetchError;
                }

            } catch (error) {
                if (error.name === 'AbortError') {
                    console.error('[123FASTLINK] [下载API]', '请求超时:', timeout, 'ms');
                    return [false, `请求超时 (${timeout}ms)`, null];
                }

                console.error('[123FASTLINK] [下载API]', '获取链接文本内容异常:', error);
                return [false, '获取链接文本内容失败: ' + error.message, null];
            }
        }

        /**
         * 完整的下载文本文件流程
         * 整合上述三个步骤，从文件信息直接获取文本内容
         * @param {Object} fileInfo - 文件信息
         * @param {string} fileInfo.etag - 文件MD5
         * @param {string|number} fileInfo.fileId - 文件ID
         * @param {string} fileInfo.s3keyFlag - S3 Key标志
         * @param {string} fileInfo.fileName - 文件名
         * @param {string|number} fileInfo.size - 文件大小
         * @param {string} preferredIsp - 优先选择的ISP线路（可选）
         * @param {Object} options - 可选参数
         * @returns {Promise<Array>} [是否成功, 错误信息, 文本内容]
         */
        async downloadTextFile(fileInfo, preferredIsp = null, options = {}) {
            try {
                console.log('[123FASTLINK] [下载API]', '开始下载文本文件:', fileInfo.fileName);

                // 1. 获取下载链接
                console.log('[123FASTLINK] [下载API]', '步骤1: 获取下载链接');
                const [linkSuccess, linkError, linkData] = await this.getDownloadLink(fileInfo, preferredIsp);
                if (!linkSuccess) {
                    return [false, '获取下载链接失败: ' + linkError, null];
                }

                const {downloadLink} = linkData;

                // 2. 获取文本内容
                console.log('[123FASTLINK] [下载API]', '步骤2: 获取文本内容');
                const [contentSuccess, contentError, content] = await this.getLinkTextContent(downloadLink, options);

                if (!contentSuccess) {
                    return [false, '获取文本内容失败: ' + contentError, null];
                }

                console.log('[123FASTLINK] [下载API]', '下载完成，文件:', fileInfo.fileName);
                return [true, null, content];

            } catch (error) {
                console.error('[123FASTLINK] [下载API]', '下载文本文件流程异常:', error);
                return [false, '下载文本文件失败: ' + error.message, null];
            }
        }

        /**
         * 通过文件ID获取文件信息并下载
         * 这是一个便捷方法，先通过fileId获取文件信息，然后下载
         * @param {string|number} fileId - 文件ID
         * @param {string} preferredIsp - 优先选择的ISP线路（可选）
         * @returns {Promise<Array>} [是否成功, 错误信息, 文本内容]
         */
        async downloadTextFileById(fileId, preferredIsp = null) {
            try {
                console.log('[123FASTLINK] [下载API]', '通过文件ID下载文本文件:', fileId);

                // 1. 先获取文件信息
                const fileInfoResponse = await this.getFileInfo([fileId]);
                // 检查文件大小
                if (fileInfoResponse.data.InfoList[0].Size > this.maxTextFileSize) {
                    return [false, `文件过大，无法作为文本下载（最大支持 ${this.maxTextFileSize} 字节）`, null];
                }
                if (!fileInfoResponse.data.InfoList || fileInfoResponse.data.InfoList.length === 0) {
                    return [false, '文件不存在或无法访问', null];
                }

                const fileData = fileInfoResponse.data.InfoList[0];

                // 2. 构建文件信息对象
                const fileInfo = {
                    fileId: fileData.FileId,
                    etag: fileData.Etag,
                    s3keyFlag: fileData.S3KeyFlag,
                    fileName: fileData.FileName,
                    size: fileData.Size
                };

                // 为防止非文本文件过大造成卡顿，对文件最大值进行限制
                if (fileInfo.size > this.maxTextFileSize) {
                    return [false, `文件过大，无法作为文本下载（最大支持 ${this.maxTextFileSize} 字节）`, null];
                }
                console.log('[123FASTLINK] [下载API]', '获取到文件信息:', fileInfo);

                // 3. 下载文件
                return await this.downloadTextFile(fileInfo, preferredIsp);

            } catch (error) {
                console.error('[123FASTLINK] [下载API]', '通过文件ID下载异常:', error);
                return [false, '通过文件ID下载失败: ' + error.message, null];
            }
        }

        /**
         * 下载文件并保存为Blob（适用于二进制文件）
         * @param {Object} fileInfo - 文件信息
         * @param {string} preferredIsp - 优先选择的ISP线路
         * @returns {Promise<Array>} [是否成功, 错误信息, Blob对象]
         */
        async downloadFileAsBlob(fileInfo, preferredIsp = null) {
            try {
                console.log('[123FASTLINK] [下载API]', '下载文件为Blob:', fileInfo.fileName);

                // 1. 获取下载链接
                const [linkSuccess, linkError, linkData] = await this.getDownloadLink(fileInfo, preferredIsp);
                if (!linkSuccess) {
                    return [false, linkError, null];
                }

                const {downloadLink} = linkData;

                // 2. 下载为Blob
                const response = await fetch(downloadLink, {
                    method: 'GET', headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                    }
                });

                if (!response.ok) {
                    return [false, `HTTP ${response.status}: ${response.statusText}`, null];
                }

                const blob = await response.blob();
                console.log('[123FASTLINK] [下载API]', '下载Blob完成，大小:', blob.size, '字节');

                return [true, null, blob];

            } catch (error) {
                console.error('[123FASTLINK] [下载API]', '下载文件为Blob异常:', error);
                return [false, '下载文件失败: ' + error.message, null];
            }
        }
    }

    // 2. 选中文件管理类
    class TableRowSelector {
        constructor() {
            this.selectedRowKeys = [];
            this.unselectedRowKeys = [];
            this.isSelectAll = false;
            this._inited = false;
        }

        // 暂时没有用到
        deconstructor() {
            if (this.observer) {
                this.observer.disconnect();
            }
            this.observer = null;
            if (this.originalCreateElement) {
                document.createElement = this.originalCreateElement;
            }
        }

        init() {
            if (this._inited) return;
            this._inited = true;

            // 保存原始 createElement 方法
            const originalCreateElement = document.createElement;
            this.originalCreateElement = originalCreateElement;

            const self = this;
            document.createElement = function (tagName, options) {
                const element = originalCreateElement.call(document, tagName, options);
                if (!(tagName.toLowerCase() === 'input')) {
                    return element;
                }
                const observer = new MutationObserver(() => {
                    if (element.classList.contains('ant-checkbox-input')) {
                        if (// 检查是否为全选框并绑定事件
                            element.getAttribute('aria-label') === 'Select all') {
                            // 新建全选框，新页面，清除已选择
                            self.unselectedRowKeys = [];
                            self.selectedRowKeys = [];
                            self.isSelectAll = false;

                            self._bindSelectAllEvent(element);
                            console.log('[123FASTLINK] [Selector] 已为全选框绑定事件');
                        } else {
                            {
                                const input = element
                                input.addEventListener('click', function () {
                                    const rowKey = input.closest('.ant-table-row').getAttribute('data-row-key');
                                    if (self.isSelectAll) {
                                        if (!this.checked) {
                                            if (!self.unselectedRowKeys.includes(rowKey)) {
                                                self.unselectedRowKeys.push(rowKey);
                                            }
                                        } else {
                                            const idx = self.unselectedRowKeys.indexOf(rowKey);
                                            if (idx > -1) {
                                                self.unselectedRowKeys.splice(idx, 1);
                                            }
                                        }
                                    } else {
                                        if (this.checked) {
                                            if (!self.selectedRowKeys.includes(rowKey)) {
                                                self.selectedRowKeys.push(rowKey);
                                            }
                                        } else {
                                            const idx = self.selectedRowKeys.indexOf(rowKey);
                                            if (idx > -1) {
                                                self.selectedRowKeys.splice(idx, 1);
                                            }
                                        }
                                    }
                                    self._outputSelection();
                                });
                            }
                        }
                    }
                    observer.disconnect();
                });
                observer.observe(element, {
                    attributes: true, attributeFilter: ['class', 'aria-label']
                });
                return element;
            };
            console.log('[123FASTLINK] [Selector] HOOK已激活');
        }

        _bindSelectAllEvent(checkbox) {
            this._onSelectAllChange(checkbox);
        }

        _onSelectAllChange(checkbox) {
            const targetElement = checkbox.parentElement;
            const self = this;
            // 创建观察器
            this.observer = new MutationObserver(function (mutations) {
                mutations.forEach(function (mutation) {
                    if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
                        console.log('Class changed!');
                        console.log('旧值:', mutation.oldValue);
                        console.log('新值:', targetElement.className);

                        onClassChanged.call(self, targetElement);
                    }
                });
            });

            // 配置观察选项
            const config = {
                attributes: true,           // 监听属性变化
                attributeOldValue: true,    // 记录旧值
                attributeFilter: ['class']  // 只监听 class 属性
            };

            // 开始观察
            this.observer.observe(targetElement, config);

            // 处理函数
            function onClassChanged(element) {
                console.log('处理 class 变化:', element.className);
                if (element.classList.contains('ant-checkbox-indeterminate')) {
                    // 半选状态，不处理
                } else if (element.classList.contains('ant-checkbox-checked')) {
                    // 全选状态
                    this.isSelectAll = true;
                    this.unselectedRowKeys = [];
                    this.selectedRowKeys = [];
                } else {
                    this.isSelectAll = false;
                    this.selectedRowKeys = [];
                    this.unselectedRowKeys = [];
                }

            }

            // observer.disconnect();
        }

        _outputSelection() {
            if (this.isSelectAll) {
                if (this.unselectedRowKeys.length === 0) {
                    console.log('全选');
                } else {
                    console.log('全选，反选这些：', this.unselectedRowKeys);
                }
            } else {
                console.log('当前选中：', this.selectedRowKeys);
            }
        }

        getSelection() {
            return {
                isSelectAll: this.isSelectAll,
                selectedRowKeys: [...this.selectedRowKeys],
                unselectedRowKeys: [...this.unselectedRowKeys]
            };
        }
    }

    // 3. 秒传链接生成/转存类
    class ShareLinkManager {
        constructor(apiClient) {
            this.apiClient = apiClient;
            this.init();
        }

        init() {
            this.apiClient.init();
            this.progress = 0;
            this.progressDesc = "";
            this.taskCancel = false; // 取消当前任务的请求标志
            this.getFileInfoBatchSize = GlobalConfig.getFileInfoBatchSize;
            this.getFileInfoDelay = GlobalConfig.getFileInfoDelay;
            this.getFolderInfoDelay = GlobalConfig.getFolderInfoDelay;
            this.saveLinkDelay = GlobalConfig.saveLinkDelay;
            this.mkdirDelay = GlobalConfig.mkdirDelay;
            this.fileInfoList = []; // fileInfoList 在递归获取文件时使用的全局变量
            // this.scriptName = GlobalConfig.scriptName,
            // this.commonPath = "";
            this.COMMON_PATH_LINK_PREFIX_V2 = GlobalConfig.COMMON_PATH_LINK_PREFIX_V2;
            this.usesBase62EtagsInExport = GlobalConfig.usesBase62EtagsInExport;
            this.scriptVersion = GlobalConfig.scriptVersion;
            this.defaultExportName = GlobalConfig.DEFAULT_EXPORT_FILENAME;
            this.secondaryLinkUseJson = GlobalConfig.secondaryLinkUseJson;
        }

        /**
         * 递归获取指定文件夹ID下的所有文件信息
         * @param {*} parentFileId
         * @param folderName
         * @param {*} total 仅用来计算进度
         */
        async _getAllFileInfoByFolderId(parentFileId, folderName = '', total) {
            //console.log("[123FASTLINK] [ShareLinkManager]", await this.apiClient.getFileList(parentFileId));
            this.progressDesc = `正在扫描文件夹：${folderName}`;
            let progress = this.progress;

            const progressUpdater = setInterval(() => {
                //this.showProgressModal("生成秒传链接", , this.progressDesc);
                this.progress = progress + this.apiClient.progress / total;
                this.progressDesc = this.apiClient.progressDesc;
                // 不主动停止
                if (this.progress > 100) {
                    clearInterval(progressUpdater);
                    //setTimeout(() => this.hideProgressModal(), 500);
                }
            }, 500);
            const allFileInfoList = (await this.apiClient.getFileList(parentFileId)).data.InfoList.map(file => ({
                fileName: file.FileName, etag: file.Etag, size: file.Size, type: file.Type, fileId: file.FileId
            }));
            clearInterval(progressUpdater);

            // 分开文件和文件夹
            // 文件添加所在文件夹名称
            const fileInfo = allFileInfoList.filter(file => file.type !== 1);
            fileInfo.forEach(file => {
                file.path = folderName + file.fileName;
            });

            this.fileInfoList.push(...fileInfo);
            console.log("[123FASTLINK] [ShareLinkManager]", "获取文件列表,ID:", parentFileId);

            const directoryFileInfo = allFileInfoList.filter(file => file.type === 1);

            for (const folder of directoryFileInfo) {
                // 延时
                await new Promise(resolve => setTimeout(resolve, this.getFolderInfoDelay));

                // 任务取消，停止深入文件夹
                if (this.taskCancel) {
                    this.progressDesc = "任务已取消";
                    return;
                }
                await this._getAllFileInfoByFolderId(folder.fileId, folderName + folder.fileName + "/", total * directoryFileInfo.length);
            }
            this.progress = progress + 100 / total;
        }

        /**
         * 分批获取文件信息
         * @param {*} idList - 文件ID列表
         * @returns - 来自服务器的文件全面数据
         */
        async _getFileInfoBatch(idList) {
            const total = idList.length;
            let completed = 0;
            let allFileInfo = [];
            for (let i = 0; i < total; i += this.getFileInfoBatchSize) {
                const batch = idList.slice(i, i + this.getFileInfoBatchSize);
                try {
                    const response = await this.apiClient.getFileInfo(batch);
                    allFileInfo = allFileInfo.concat(response.data.InfoList || []);
                } catch (e) {
                    console.error('[123FASTLINK] [ShareLinkManager]', '获取文件信息失败:', e);
                }
                completed += batch.length;
                // 不能走到100，否则会自动消失，下面获取文件夹还用使用
                this.progress = Math.round((completed / total) * 100 - 1);
                this.progressDesc = `正在获取文件信息... (${completed} / ${total})`;
                await new Promise(resolve => setTimeout(resolve, this.getFileInfoDelay));
            }
            return allFileInfo.map(file => ({
                fileName: file.FileName, etag: file.Etag, size: file.Size, type: file.Type, fileId: file.FileId
            }));
        }

        /**
         * 获取fileInfoList的公共路径
         * @returns commonPath
         */
        async _getCommonPath(fileInfoList) {
            if (!fileInfoList || fileInfoList.length === 0) return '';
            // 提取所有路径并转换为目录组件数组
            const pathArrays = fileInfoList.map(file => {
                const path = file.path || '';
                // 移除路径末尾的文件名（如果有）
                const lastSlashIndex = path.lastIndexOf('/');
                return lastSlashIndex === -1 ? [] : path.substring(0, lastSlashIndex).split('/');
            });

            // 找出最长的公共前缀
            let commonPrefix = [];
            const firstPath = pathArrays[0];

            for (let i = 0; i < firstPath.length; i++) {
                const currentComponent = firstPath[i];
                const allMatch = pathArrays.every(pathArray => pathArray.length > i && pathArray[i] === currentComponent);

                if (allMatch) {
                    commonPrefix.push(currentComponent);
                } else {
                    break;
                }
            }

            // 将公共前缀组件组合为路径字符串
            const commonPath = commonPrefix.length > 0 ? commonPrefix.join('/') + '/' : '';
            // this.commonPath = commonPath;
            return commonPath;
        }

        /**
         * 获取所有选择的文件,进入文件夹
         * @param {*} fileSelectionDetails - 来自selector.getSelection()
         * @returns  - [boolean, 错误信息, 文件信息列表,commonPath]
         */
        async _getSelectedFilesInfo(fileSelectionDetails) {
            this.fileInfoList = [];
            if (!fileSelectionDetails.isSelectAll && fileSelectionDetails.selectedRowKeys.length === 0) {
                return [false, "未选择文件", null];
            }
            let fileSelectFolderInfoList = [];
            if (fileSelectionDetails.isSelectAll) {
                this.progress = 10;
                this.progressDesc = "正在递归获取选择的文件..."
                let allFileInfo = (await this.apiClient.getFileList(await this.apiClient.getParentFileId())).data.InfoList.map(file => ({
                    fileName: file.FileName, etag: file.Etag, size: file.Size, type: file.Type, fileId: file.FileId
                }));
                // 分开处理文件和文件夹
                let fileInfo = allFileInfo.filter(file => file.type !== 1);
                // 剔除反选的文件,并添加文件夹名称
                fileInfo.filter(file => !fileSelectionDetails.unselectedRowKeys.includes(file.fileId.toString())).forEach(file => {
                    file.path = file.fileName;
                });
                // 方便后面继续添加
                this.fileInfoList.push(...fileInfo);
                fileSelectFolderInfoList = allFileInfo.filter(file => file.type === 1).filter(file => !fileSelectionDetails.unselectedRowKeys.includes(file.fileId.toString()));
            } else {
                // 未全选
                let fileSelectIdList = fileSelectionDetails.selectedRowKeys;
                if (!fileSelectIdList.length) {
                    this.progress = 100;
                    this.progressDesc = "未选择文件";
                    return [false, "未选择文件", null];
                }
                // 获取文件信息

                const allFileInfo = await this._getFileInfoBatch(fileSelectIdList);
                const fileInfo = allFileInfo.filter(info => info.type !== 1);
                fileInfo.forEach(file => {
                    file.path = file.fileName;
                });
                this.fileInfoList.push(...fileInfo);
                fileSelectFolderInfoList = allFileInfo.filter(info => info.type === 1);
            }

            // 处理文件夹，递归获取全部文件
            // this.progressDesc = "正在递归获取选择的文件，如果文件夹过多则可能耗时较长";
            for (let i = 0; i < fileSelectFolderInfoList.length; i++) {
                const folderInfo = fileSelectFolderInfoList[i];
                this.progress = Math.round((i / fileSelectFolderInfoList.length) * 100);
                await new Promise(resolve => setTimeout(resolve, this.getFolderInfoDelay));
                // 任务取消
                if (this.taskCancel) {
                    this.progressDesc = "任务已取消";
                    return [true, "任务已取消", this.fileInfoList];
                    // 已经获取的文件保留
                }

                await this._getAllFileInfoByFolderId(folderInfo.fileId, folderInfo.fileName + "/", fileSelectFolderInfoList.length);
            }
            // 处理文件夹路径
            // 检查commonPath
            const commonPath = await this._getCommonPath(this.fileInfoList);
            // 去除文件夹路径中的公共路径
            if (commonPath) {
                this.fileInfoList.forEach(info => {
                    // 切片
                    info.path = info.path.slice(commonPath.length);
                });
            }

            return [true, null, this.fileInfoList, commonPath];
        }

        /**
         * 从选择文件生成分享链接
         * @param {*} fileSelectionDetails - 来自selector.getSelection()
         * @returns {Promise<string>} - 分享链接,如果未选择文件则返回空字符串
         */
        async generateShareLink(fileSelectionDetails, jsonExport = false) {
            this.progress = 0;
            this.progressDesc = "准备获取文件信息...";

            // 获取选中的文件（文件夹）的详细信息
            const [resultSuccess, resultError, fileInfoList, commonPath] = await this._getSelectedFilesInfo(fileSelectionDetails);
            if (!resultSuccess) return [false, resultError, null];
            //// if (hasFolder) alert("文件夹暂时无法秒传，将被忽略");
            let allFilePath = [];
            for (const fileInfo of fileInfoList) {
                if (fileInfo.type !== 1) {
                    allFilePath.push(fileInfo.path);
                }
            }
            this.progressDesc = "秒传链接生成完成";
            return [...this.buildShareLink(fileInfoList, commonPath, jsonExport), allFilePath];
        }

        /**
         * 拼接链接 etag: 来自服务器md5，由函数转换格式
         * @param {*} fileInfoList - {etag: string, size: number, path: string, fileName: string}
         */
        buildShareLink(fileInfoList, commonPath, jsonExport = false) {
            if (jsonExport) {
                return this._buildJsonShareLink(fileInfoList, commonPath, this.usesBase62EtagsInExport);
            } else {
                const shareLinkFileInfo = fileInfoList.map(info => {
                    //if (info.type === 0) {
                    return [this.usesBase62EtagsInExport ? this._hexToBase62(info.etag) : info.etag, info.size, info.path.replace(/[%#$]/g, '')].join('#');
                    //}
                }).filter(Boolean).join('$');
                const shareLink = `${this.COMMON_PATH_LINK_PREFIX_V2}${commonPath}%${shareLinkFileInfo}`;
                return [true, null, shareLink];
            }
        }

        _isValidEtag(etag) {
            // 简单校验etag格式为32位十六进制字符串或Base62字符串
            const hexRegex = /^[a-fA-F0-9]{32}$/;
            const base62Regex = /^[A-Za-z0-9]{22}$/;
            return hexRegex.test(etag) || base62Regex.test(etag);
        }

        /**
         * 解析文本秒传链接
         * @param {*} shareLink     秒传链接
         * @param {*} InputUsesBase62  输入是否使用Base62
         * @param {*} outputUsesBase62 函数输出是否使用Base62，本脚本中使用hex传递，默认false
         * @returns {Array} - [boolean, 错误信息, 文件信息列表 - [{etag: string, size: number, path: string, fileName: string}], 失败列表, commonPath]
         */
        _parseTextShareLink(shareLink, InputUsesBase62 = true, outputUsesBase62 = false) {
            // Why use Base62 ???
            // 本脚本采用hex传递
            // 兼容旧版本，检查是否有链接头
            let commonPath = '';
            let shareFileInfo = '';
            if (shareLink.slice(0, 4) === "123F") {
                const commonPathLinkPrefix = shareLink.split('$')[0];
                shareLink = shareLink.replace(`${commonPathLinkPrefix}$`, '');

                if (commonPathLinkPrefix + "$" === this.COMMON_PATH_LINK_PREFIX_V2) {
                    commonPath = shareLink.split('%')[0];
                    shareFileInfo = shareLink.replace(`${commonPath}%`, '');

                } else {
                    console.error('[123FASTLINK] [ShareLinkManager]', '不支持的公共路径格式', commonPathLinkPrefix);
                    return [false, '不支持的公共路径格式', null];
                }

            } else {
                shareFileInfo = shareLink;
                InputUsesBase62 = false;
            }

            const shareLinkList = Array.from(shareFileInfo.replace(/\r?\n/g, '$').split('$'));
            // this.commonPath = commonPath;
            let failList = [];
            const fileList = shareLinkList.map(singleShareLink => {
                const singleFileInfoList = singleShareLink.split('#');
                if (singleFileInfoList.length < 3) return null;
                const etag = InputUsesBase62 ? (outputUsesBase62 ? singleFileInfoList[0] : this._base62ToHex(singleFileInfoList[0])) : (outputUsesBase62 ? this._hexToBase62(singleFileInfoList[0]) : singleFileInfoList[0]);
                let failed = false;
                // etag校验
                if (!this._isValidEtag(etag)) {
                    console.error('[123FASTLINK] [ShareLinkManager]', '无效的etag:', etag);
                    failed = true;
                }
                const size = singleFileInfoList[1];
                if (isNaN(size) || Number(size) < 0) {
                    console.error('[123FASTLINK] [ShareLinkManager]', '无效的文件大小:', size);
                    failed = true;
                }
                if (!singleFileInfoList[2]) {
                    console.error('[123FASTLINK] [ShareLinkManager]', '无效的文件路径:', singleFileInfoList[2]);
                    failed = true;
                }
                if (failed) {
                    failList.push({
                        etag: etag,
                        size: size,
                        path: singleFileInfoList[2],
                        fileName: singleFileInfoList[2].split('/').pop()
                    });
                    return null;
                }
                return {
                    // etag: InputUsesBase62 ? (outputUsesBase62 ? singleFileInfoList[0] : this._base62ToHex(singleFileInfoList[0])) : (outputUsesBase62 ? this._hexToBase62(singleFileInfoList[0]) : singleFileInfoList[0]),
                    etag: etag,
                    size: size,
                    path: singleFileInfoList[2],
                    fileName: singleFileInfoList[2].split('/').pop()
                };
            }).filter(Boolean);
            if (fileList.length === 0) {
                return [false, '未解析到有效的文件信息', null, failList];
            }
            return [true, null, fileList, failList, commonPath];
        }

        /**
         * 自动判断秒传链接格式并解析
         * @param {string} shareLink
         */
        async parseShareLink(shareLink) {
            let result = null;
            try {
                // 尝试作为JSON解析
                const jsonData = this.safeParse(shareLink);
                if (jsonData) {
                    result = await this._parseJsonShareLink(jsonData);
                } else {
                    // 作为普通秒传链接处理
                    result = await this._parseTextShareLink(shareLink, this.usesBase62EtagsInExport, false);
                }
            } catch (error) {
                return [false, '保存失败: ' + error.message, result];
            }
            return result;
        }

        /**
         * 先创建文件夹，给shareFileList添加上parentFolderId，便于保存文件
         * @param {*} fileList - {etag: string, size: number, path: string, fileName: string}
         * @returns shareFileList - {etag: string, size: number, path: string, fileName: string, parentFolderId: number}
         */
        async _makeDirForFiles(shareFileList, commonPath) {
            const total = shareFileList.length;
            // 文件夹创建，并为shareFileList添加parentFolderId------------------------------------
            // 记录文件夹(path)
            this.progressDesc = `正在创建文件夹...`;
            let folder = {};
            // 如果存在commonPath，先创建文件夹
            const rootFolderId = await this.apiClient.getParentFileId();
            if (commonPath) {
                const commonPathParts = commonPath.split('/').filter(part => part !== '');
                let currentParentId = rootFolderId;

                for (let i = 0; i < commonPathParts.length; i++) {
                    const currentPath = commonPathParts.slice(0, i + 1).join('/');
                    const folderName = commonPathParts[i];

                    if (!folder[currentPath]) {
                        const newFolder = await this.apiClient.mkdir(currentParentId, folderName);
                        await new Promise(resolve => setTimeout(resolve, this.mkdirDelay));
                        folder[currentPath] = newFolder.folderFileId;
                    }

                    currentParentId = folder[currentPath];
                }
            } else {
                folder[''] = rootFolderId;
            }

            for (let i = 0; i < shareFileList.length; i++) {
                const item = shareFileList[i];
                const itemPath = item.path.split('/').slice(0, -1);

                // 记得去掉commonPath末尾的斜杠
                let nowParentFolderId = folder[commonPath.slice(0, -1)] || rootFolderId;
                for (let i = 0; i < itemPath.length; i++) {
                    const path = itemPath.slice(0, i + 1).join('/');
                    if (!folder[path]) {
                        const newFolderID = await this.apiClient.mkdir(nowParentFolderId, itemPath[i]);
                        await new Promise(resolve => setTimeout(resolve, this.mkdirDelay));
                        folder[path] = newFolderID.folderFileId;
                        nowParentFolderId = newFolderID.folderFileId;
                    } else {
                        nowParentFolderId = folder[path];
                    }

                    // 任务取消
                    if (this.taskCancel) {
                        this.progressDesc = "任务已取消";
                        return shareFileList;
                    }
                }
                shareFileList[i].parentFolderId = nowParentFolderId;
                this.progress = Math.round((i / total) * 100);
                this.progressDesc = `正在创建文件夹... (${i + 1} / ${total})`;
            }
            return shareFileList;
        }

        /**
         * 保存文件列表
         * @param {Array} shareFileList - 带parentFolderId的 - _makeDirForFiles - {etag: string, size: number, path: string, fileName: string, parentFolderId: number}
         * @returns {Object} -  {success: [], failed: [fileInfo]}
         */
        async _saveFileList(shareFileList) {
            let completed = 0;
            let success = 0;
            let failed = 0;
            let successList = [];
            let failedList = [];
            const total = shareFileList.length;
            // 获取文件 -----------------------------
            for (let i = 0; i < shareFileList.length; i++) {

                // 任务取消
                if (this.taskCancel) {
                    this.progressDesc = "任务已取消";
                    break;
                }

                const fileInfo = shareFileList[i];
                if (i > 0) {
                    await new Promise(resolve => setTimeout(resolve, this.saveLinkDelay));
                }

                const reuse = await this.apiClient.getFile({
                    etag: fileInfo.etag, size: fileInfo.size, fileName: fileInfo.fileName
                }, fileInfo.parentFolderId);
                if (reuse[0]) {
                    success++;
                    successList.push(fileInfo);
                } else {
                    failed++;
                    console.error('[123FASTLINK] [ShareLinkManager]', '保存文件失败:', fileInfo.fileName);
                    fileInfo.error = reuse[1];
                    failedList.push(fileInfo);
                }
                completed++;
                console.log('[123FASTLINK] [ShareLinkManager]', '已保存:', fileInfo.fileName);
                this.progress = Math.round((completed / total) * 100);
                this.progressDesc = `(成功: ${success}，失败: ${failed})
                正在保存第 ${completed} / ${total} 个文件(${fileInfo.fileName})...`;
            }
            // this.progress = 100;
            // this.progressDesc = "保存完成";
            return {
                success: successList, failed: failedList
            };
        }

        /**
         *  保存秒传链接（自动判断格式）
         * @param {string} content
         * @returns {Promise<object>} - 保存结果
         * {success: [], failed: []}
         */
        async saveShareLink(content) {
            let saveResult = {success: [], failed: []};

            const fileInfoList = await this.parseShareLink(content);
            if (!fileInfoList[0]) {
                saveResult.failed.push(...fileInfoList[3]); // 添加解析失败的文件
                return [false, '保存失败: ' + fileInfoList[1], saveResult];
            }
            saveResult = await this._saveFileList(await this._makeDirForFiles(fileInfoList[2], fileInfoList[4]));
            saveResult.failed.push(...fileInfoList[3]); // 添加解析失败的文件
            saveResult.commonPath = fileInfoList[4];
            return [true, null, saveResult];
        }

        async saveShareLinkOnlyText(shareLink, fileName) {
            return this.apiClient.createTextFileInCurrentFolder(fileName, shareLink);
        }

        /**
         * 重试保存失败的文件
         * @param {*} FileList - 包含parentFolderId - {etag: string, size: number, path: string, fileName: string, parentFolderId: number}
         * 失败的文件列表 - this.saveShareLink()[2].failed
         * @returns
         */
        // // TODO commonPath 处理
        async retrySaveFailed(FileList) {
            return [true, null, await this._saveFileList(FileList)];
        }

        // ------------------二级秒传链接相关----------------------
        /**
         * 获取文件内容为文本
         * @param {string} fileId
         * @returns [boolean, string, string] - 是否成功, 错误信息, 文本内容
         */
        async getFileContentAsText(fileId) {
            const fileTextInfo = await this.apiClient.downloadTextFileById(fileId);
            if (!fileTextInfo[0]) {
                return [false, fileTextInfo[1], null];
            }
            return [true, null, fileTextInfo[2]];
        }

        /**
         * 从文本文件获取并保存秒传链接
         * @param {string} fileId - 二级秒传链接文件ID
         * @returns
         */
        async saveShareLinkFile(fileId) {
            const [downloadSuccess, downloadError, fileContent] = await this.getFileContentAsText(fileId);
            if (!downloadSuccess) {
                return [false, '获取文件内容失败: ' + downloadError, null];
            }
            return await this.saveShareLink(fileContent);
        }

        async saveSecondaryShareLink(secondaryLink, seedFilePathId = null) {

            if (seedFilePathId && seedFilePathId.toString().length !== 8) {
                return [false, '种子文件路径ID无效，请清除路径', null];
            }
            // 提取文件信息
            const secondaryFileInfoRes = await this.parseShareLink(secondaryLink);
            if (!secondaryFileInfoRes[0]) {
                return [false, '解析二级秒传链接失败: ' + secondaryFileInfoRes[1], null];
            }
            const secondaryFileInfo = secondaryFileInfoRes[2];
            if (secondaryFileInfo.length !== 1) {
                return [false, '二级秒传链接格式错误，应该只包含一个文件', null];
            }
            // 保存文件（要先保存才能获取文件内容）
            this.progress = 10;
            this.progressDesc = "正在保存二级秒传链接文件...";
            const saveResult = await this.apiClient.getFile({
                etag: secondaryFileInfo[0].etag,
                size: secondaryFileInfo[0].size,
                fileName: secondaryFileInfo[0].fileName
            }, seedFilePathId);
            if (!saveResult[0]) {
                return [false, '保存二级秒传链接文件失败: ' + saveResult[1], null];
            }
            // 获取文件内容
            this.progress = 50;
            this.progressDesc = "正在获取二级秒传链接文件内容...";
            const getResult = await this.getFileContentAsText(saveResult[2]);
            const [downloadSuccess, downloadError, fileContent] = getResult;
            if (!downloadSuccess) {
                return [false, '获取文件内容失败: ' + downloadError, null];
            }
            this.progress = 70;
            this.progressDesc = "正在保存秒传链接...";
            return await this.saveShareLink(fileContent);
        }

        /**
         *
         * @param {dict} fileSelectionDetails - 文件选择
         * @param {*} fileName - 二级秒传链接文件名
         * @returns
         */
        async generateSecondaryShareLink(fileSelectionDetails, fileName, seedFilePathId = null) {
            if (seedFilePathId && seedFilePathId.toString().length !== 8) {
                return [false, '种子文件路径ID无效，请清除路径', null];
            }
            // 固定parentFolderId为当前文件夹,防止用户切换页面
            let parentFolderId = null;
            if (seedFilePathId) {
                parentFolderId = seedFilePathId;
            } else {
                parentFolderId = await this.apiClient.getParentFileId();
            }
            // 先根据fileSelectionDetails 生成一级秒传链接
            const [linkSuccess, linkError, shareLink] = await this.generateShareLink(fileSelectionDetails, this.secondaryLinkUseJson);
            if (!linkSuccess) {
                return [false, '生成一级秒传链接失败: ' + linkError, null];
            }
            // 判断文件名
            if (!fileName || fileName.trim() === '') {
                fileName = await this.getExportFilename(shareLink) + '.123fastlink.' + (this.secondaryLinkUseJson ? 'json' : 'txt');
            }
            // 然后保存为文本文件
            const saveResult = await this.apiClient.createTextFileInFolder(fileName, shareLink, parentFolderId);
            if (!saveResult[0]) {
                return [false, '保存一级秒传链接文件失败: ' + saveResult[1], null];
            }
            // const fileId =  saveResult[2];
            const fileInfo = saveResult[3]; // {fileName, etag, size}
            fileInfo.path = fileName;
            // 最后生成二级秒传链接
            const secondaryShareLink = this.buildShareLink([fileInfo], '', false)[2];
            return [true, null, secondaryShareLink];
        }

        // -------------------JSON相关-----------------------
        safeParse(str) {
            try {
                return JSON.parse(str);
            } catch {
                return null;
            }
        }

        _base62chars() {
            return '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
        }

        _hexToBase62(hex) {
            if (!hex) return '';
            let num = BigInt('0x' + hex);
            if (num === 0n) return '0';
            let chars = [];
            const base62 = this._base62chars();
            while (num > 0n) {
                chars.push(base62[Number(num % 62n)]);
                num = num / 62n;
            }
            return chars.reverse().join('');
        }

        _base62ToHex(base62) {
            if (!base62) return '';
            const chars = this._base62chars();
            let num = 0n;
            for (let i = 0; i < base62.length; i++) {
                num = num * 62n + BigInt(chars.indexOf(base62[i]));
            }
            let hex = num.toString(16);
            if (hex.length % 2) hex = '0' + hex;
            while (hex.length < 32) hex = '0' + hex;
            return hex;
        }


        /**
         * 解析JSON格式的秒传链接
         * @param {object} jsonData
         * @returns {Array} - [boolean, string, [{etag: string, size: number, path: string, fileName: string}], commonPath] - 是否成功, 错误信息, 文件列表
         */
        _parseJsonShareLink(jsonData) {
            // 如果是字符串，先尝试解析为JSON对象
            if (typeof jsonData === 'string') {
                jsonData = this.safeParse(jsonData);
                if (!jsonData) {
                    return [false, '无效的JSON格式', null];
                }
            }
            let failedList = [];
            try {
                const commonPath = jsonData['commonPath'] || '';
                // this.commonPath = commonPath;
                const shareFileList = jsonData['files'];
                if (jsonData['usesBase62EtagsInExport']) {
                    shareFileList.forEach(file => {
                        file.etag = this._base62ToHex(file.etag);
                        if (!this._isValidEtag(file.etag)) {
                            console.error('[123FASTLINK] [ShareLinkManager]', '无效的etag:', file.etag);
                            failedList.push({
                                etag: file.etag, size: file.size, path: file.path, fileName: file.path.split('/').pop()
                            });
                        }
                    });
                }
                shareFileList.forEach(file => {
                    file.fileName = file.path.split('/').pop();
                });
                return [true, null, shareFileList, failedList, commonPath];
            } catch (error) {
                console.error('[123FASTLINK] [ShareLinkManager]', '解析JSON格式秒传链接失败:', error);
                return [false, '解析JSON格式秒传链接失败: ' + error.message, null, null];
            }
        }

        // 格式化文件大小
        _formatSize(size) {
            const KB = 1024;
            const MB = KB * 1024;
            const GB = MB * 1024;
            const TB = GB * 1024;
            const PB = TB * 1024;

            if (size < KB) return size + ' B';
            if (size < MB) return (size / KB).toFixed(2) + ' KB';
            if (size < GB) return (size / MB).toFixed(2) + ' MB';
            if (size < TB) return (size / GB).toFixed(2) + ' GB';
            if (size < PB) return (size / TB).toFixed(2) + ' TB';
            return (size / PB).toFixed(2) + ' PB';
        }

        validateJson(json) {
            return (json && Array.isArray(json.files) && json.files.every(f => f.etag && f.size && f.path));
        }

        /**
         * 将秒传链接转换为JSON格式
         * @param {*} shareLink
         * @returns
         */
        textShareLinkToJson(shareLink) {
            const [, , fileInfoList, , commonPath] = this._parseTextShareLink(shareLink);
            // const commonPath = this.commonPath;
            return this._buildJsonShareLink(fileInfoList, commonPath, this.usesBase62EtagsInExport);
        }

        _buildJsonShareLink(fileInfoList, commonPath = '', usesBase62EtagsInExport = false) {
            if (fileInfoList.length === 0) {
                console.error('[123FASTLINK] [ShareLinkManager]', '解析秒传链接失败:', shareLink);
                return [false, '解析秒传链接失败: 文件列表为空', null];
            }
            // if (usesBase62EtagsInExport) {
            //     fileInfoList.forEach(f => {
            //         f.etag = this._hexToBase62(f.etag);
            //     });
            // }
            const totalSize = fileInfoList.reduce((sum, f) => sum + Number(f.size), 0);
            const jsonData = {
                scriptVersion: this.scriptVersion,
                exportVersion: "1.0",
                usesBase62EtagsInExport: usesBase62EtagsInExport,
                commonPath: commonPath,
                totalFilesCount: fileInfoList.length,
                totalSize,
                formattedTotalSize: this._formatSize(totalSize),
                files: fileInfoList.map(f => ({
                    // 去掉fileName
                    ...f, fileName: undefined, etag: usesBase62EtagsInExport ? this._hexToBase62(f.etag) : f.etag
                }))
            };
            return [true, null, JSON.stringify(jsonData, null, 2)];
        }

        /**
         * 从JSON格式生成文本秒传链接
         * @param {string} jsonText
         * @returns    {boolean, string, string} - 是否成功, 错误信息, 秒传链接
         */
        jsonToTextShareLink(jsonText) {
            const jsonData = this.safeParse(jsonText);
            if (!this.validateJson(jsonData)) {
                return [false, '无效的JSON格式', null];
            }
            const shareFileList = this._parseJsonShareLink(jsonData);
            const [success, errorMsg, filePath, fileName, etag] = shareFileList;
            if (!success) {
                return [false, '解析JSON失败: ' + errorMsg, null];
            }
            return this.buildShareLink(filePath, etag, false);
        }

        // -------------------工具函数-----------------------
        /**
         * 获取导出文件名，默认根据公共路径或第一个文件名生成，不带扩展名
         * @param {string} shareLink(text)
         * @param {string} defaultName
         * @returns
         */
        async getExportFilename(shareLink, defaultName = this.defaultExportName) {
            const [success, , fileInfoList, , commonPath] = await this.parseShareLink(shareLink);
            if (!success) {
                return defaultName;
            }
            if (commonPath) {
                const commonPathClean = commonPath.replace(/\/$/, '');
                return `${commonPathClean}`;
            }
            // 获取第一个文件名

            if (fileInfoList.length > 0) {
                const firstFileName = fileInfoList[0].fileName;
                const baseName = firstFileName.split('.')[0] || 'export';
                return `${baseName}`;
            }
        }

        linkChecker(shareLink) {
            if (!shareLink || shareLink.trim() === '') {
                return [false, '链接为空'];
            }
            if (this._parseTextShareLink(shareLink)[0]) {
                return [true, null, "text"];
            }
            if (this._parseJsonShareLink(shareLink)[0]) {
                return [true, null, "json"];
            }
            return [false, '无效的秒传链接格式', null];
        }

    }

    // 4. UI管理类
    class UiManager {
        constructor(shareLinkManager, selector, firstTime = false) {
            this.firstTime = firstTime;
            this.shareLinkManager = shareLinkManager;
            this.selector = selector;
            this.isProgressMinimized = false;
            this.minimizeWidgetId = 'fs-progress-minimize-widget';
            this.settings = [{
                key: "scriptVersion",
                label: "脚本版本",
                type: "text",
                value: this.shareLinkManager.scriptVersion,
                readonly: true
            }, {
                key: "COMMON_PATH_LINK_PREFIX_V2",
                label: "公共路径链接前缀",
                type: "text",
                value: this.shareLinkManager.COMMON_PATH_LINK_PREFIX_V2,
                readonly: true
            }, {
                key: "DEFAULT_EXPORT_FILENAME",
                label: "默认导出文件名",
                type: "text",
                value: this.shareLinkManager.defaultExportName,
                description: "当无法从公共路径或文件名生成时使用此默认名称"
            }, {
                key: "seedFilePathId",
                label: "秒传文件保存文件夹ID",
                type: "number",
                value: GlobalConfig.seedFilePathId,
                description: "用于保存二级秒传链接文件的文件夹ID，留空则使用当前文件夹"
            }, {
                key: "usesBase62EtagsInExport",
                label: "Base62编码",
                type: "checkbox",
                value: GlobalConfig.usesBase62EtagsInExport,
                description: "Base62编码的etag可以减少链接长度，但不兼容旧版本脚本"
            }, {
                key: "secondaryLinkUseJson",
                label: "二级秒传链接使用JSON格式",
                type: "checkbox",
                value: GlobalConfig.secondaryLinkUseJson,
                description: "启用后生成二级秒传链接时秒传文件将采用JSON格式"
            }, {
                key: "getFileListPageDelay",
                label: "获取文件列表每页延时 (毫秒)",
                type: "number",
                value: GlobalConfig.getFileListPageDelay
            }, {
                key: "getFileInfoBatchSize",
                label: "批量获取文件信息的数量",
                type: "number",
                value: GlobalConfig.getFileInfoBatchSize
            }, {
                key: "getFileInfoDelay",
                label: "获取文件信息延时 (毫秒)",
                type: "number",
                value: GlobalConfig.getFileInfoDelay
            }, {
                key: "getFolderInfoDelay",
                label: "获取文件夹信息延时 (毫秒)",
                type: "number",
                value: GlobalConfig.getFolderInfoDelay
            }, {
                key: "saveLinkDelay", label: "保存链接延时 (毫秒)", type: "number", value: GlobalConfig.saveLinkDelay
            }, {key: "mkdirDelay", label: "创建文件夹延时 (毫秒)", type: "number", value: GlobalConfig.mkdirDelay}, {
                key: "maxTextFileSize",
                label: "文本文件最大大小 (字节)",
                type: "number",
                value: GlobalConfig.MAX_TEXT_FILE_SIZE
            }, {
                key: "DEBUGMODE",
                label: "调试模式",
                type: "checkbox",
                value: GlobalConfig.DEBUGMODE,
                description: "启用调试模式，页面刷新后生效"
            }];

            this.iconLibrary = {
                transfer: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="16 18 22 12 16 6"></polyline>
                            <polyline points="8 6 2 12 8 18"></polyline>
                        </svg>`, generate: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path>
                            <polyline points="13 2 13 9 20 9"></polyline>
                        </svg>`, save: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
                            <polyline points="17 21 17 13 7 13 7 21"></polyline>
                            <polyline points="7 3 7 8 15 8"></polyline>
                        </svg>`, generateSecondary: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                    </svg>`,

                saveSecondary: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                    <polyline points="7 10 12 15 17 10"></polyline>
                    <line x1="12" y1="15" x2="12" y2="3"></line>
                </svg>`, getFromFile: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path>
                    <polyline points="13 2 13 9 20 9"></polyline>
                    <line x1="12" y1="15" x2="12" y2="9"></line>
                    <polyline points="9 12 12 9 15 12"></polyline>
                </svg>`, settings: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="3"></circle>
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                </svg>`
            };

            // --------------------------任务相关----------------------------
            // taskList = [{id: string, type: 'generate'|'save', params: {}}]
            this.taskList = [];                 // 任务列表
            this.taskIdCounter = 0;             // 任务ID计数器
            this.currentTask = null;            // 当前正在执行的任务
            this.isTaskRunning = false;         // 任务是否在运行

            // 任务处理器
            this.taskHandlers = {
                'generate': {
                    addTask: function (params = {}) {
                        const fileSelectInfo = this.selector.getSelection();
                        if (!fileSelectInfo || fileSelectInfo.length === 0) {
                            this.showToast("请先选择文件", 'warning');
                            return null;
                        }
                        return {type: 'generate', params: {fileSelectInfo}};
                    }, handler: async function (task) {
                        await this.launchGenerateModal(task.params.fileSelectInfo);
                    }, description: '生成秒传链接'
                }, 'generateSecondary': {
                    addTask: function (params = {}) {
                        const fileSelectInfo = this.selector.getSelection();
                        if (!fileSelectInfo || fileSelectInfo.length === 0) {
                            this.showToast("请先选择文件", 'warning');
                            return null;
                        }
                        return {type: 'generateSecondary', params: {fileSelectInfo}};
                    }, handler: async function (task) {
                        await this.launchSecondaryGenerateModal(task.params.fileSelectInfo);
                    }, description: '生成二级秒传链接'
                }, 'save': {
                    addTask: function (params = {}) {
                        return {type: 'save', params: {content: params.content}};
                    }, handler: async function (task) {
                        await this.launchSaveLink(task.params.content);
                    }, description: '保存秒传链接'
                }, 'retry': {
                    addTask: function (params = {}) {
                        return {type: 'retry', params: {fileList: params.fileList}};
                    }, handler: async function (task) {
                        await this.launchSaveLink(task.params.fileList, true);
                    }, description: '重试保存失败的文件'
                }, 'saveOnlyLink': {
                    addTask: function (params = {}) {
                        return {
                            type: 'saveOnlyLink', params: {
                                content: params.content, fileName: params.fileName || '123FastLink.123share'
                            }
                        };
                    }, handler: async function (task) {
                        await this.launchSaveLinkOnlyText(task.params.content, task.params.fileName);
                    }, description: '保存为文本文件'
                }, 'saveSecondary': {
                    addTask: function (params = {}) {
                        return {type: 'saveSecondary', params: {content: params.content}};
                    }, handler: async function (task) {
                        await this.launchSaveSecondaryLink(task.params.content);
                    }, description: '保存二级秒传链接'
                }, 'convert': {
                    addTask: function (params = {}) {
                        return {type: 'convert', params: {content: params.content}};
                    }, handler: async function (task) {
                        await this.launchConvert(task.params.content);
                    }, description: '转换链接格式'
                }, 'saveFromFile': {
                    addTask: function (params = {}) {
                        const fileSelectInfo = this.selector.getSelection();
                        if (!fileSelectInfo || fileSelectInfo.length === 0) {
                            this.showToast("请先选择文件", 'warning');
                            return null;
                        }
                        return {type: 'saveFromFile', params: {fileSelectInfo}};
                    }, handler: async function (task) {
                        await this.launchSaveFromFile(task.params.fileSelectInfo);
                    }, description: '从秒传文件获取并保存'
                }
            };

            this.resetSettings();
        }

        resetSettings() {
            this.maxTextFileSize = GlobalConfig.MAX_TEXT_FILE_SIZE;
            this.seedFilePathId = GlobalConfig.seedFilePathId;
        }

        /**
         * 初始化UI管理器，插入样式表，设置按钮事件
         */
        init() {
            // 按钮插入 ==========================================
            // todo: 二级链接转换
            // 定义功能按钮
            const features = [{
                iconKey: 'generate', text: '生成秒传链接', handler: () => this.addAndRunTask('generate')
            }, {
                iconKey: 'save', text: '保存秒传链接', handler: () => this.showInputModal()
            }, {
                iconKey: 'generateSecondary',
                text: '生成二级链接',
                handler: () => this.addAndRunTask('generateSecondary')
            }, {
                iconKey: 'saveSecondary',
                text: '保存二级链接',
                handler: () => this.showInputModal("saveSecondary", false, '保存二级链接')
            }, {
                iconKey: 'transfer', text: '转换链接格式', handler: () => this.showInputModal("convert", false, '确定')
            }, {
                iconKey: 'getFromFile', text: '从秒传文件获取', handler: () => this.addAndRunTask('saveFromFile')
            }, {
                iconKey: 'settings', text: '设置', handler: () => this.showSettingsModal()
            }];

            // 页面加载完成后插入样式表和添加按钮
            window.addEventListener('load', () => {
                this.insertStyle();
                this.addButton(features);
            });

            // 监听URL变化，重新添加按钮，防止切换页面后按钮消失 =======

            const triggerUrlChange = () => {
                setTimeout(() => this.addButton(features), 10);
            };

            const originalPushState = history.pushState;
            const originalReplaceState = history.replaceState;

            history.pushState = function () {
                originalPushState.apply(this, arguments);
                triggerUrlChange();
            };

            history.replaceState = function () {
                originalReplaceState.apply(this, arguments);
                triggerUrlChange();
            };

            window.addEventListener('popstate', triggerUrlChange);

            // 首次运行提示
            if (this.firstTime) {
                setTimeout(() => {
                    this.showFirstTimeGuide();
                }, 1000);
            }
        }

        saveSettings() {
            // 保存设置
            const newSettings = {};
            this.settings.forEach(setting => {
                if (!setting.readonly) {
                    newSettings[setting.key] = setting.value;
                }
            });

            // 全局保存函数
            saveSettings(newSettings);
            // 应用到ShareLinkManager
            this.shareLinkManager.init();

            this.resetSettings();
        }

        /**
         * 插入样式表
         */
        insertStyle() {
            if (!document.getElementById("fs-modal-style")) {
                let style = document.createElement("style");
                style.id = "fs-modal-style";
                style.innerHTML = `
                :root{--primary-color:#6366f1;--primary-hover:#4f46e5;--secondary-color:#10b981;--secondary-hover:#059669;--danger-color:#ef4444;--danger-hover:#dc2626;--warning-color:#f59e0b;--warning-hover:#d97706;--info-color:#3b82f6;--info-hover:#2563eb;--background:#ffffff;--surface:#f8fafc;--border:#e2e8f0;--text-primary:#1e293b;--text-secondary:#64748b;--text-tertiary:#94a3b8;--shadow-sm:0 1px 2px 0 rgba(0,0,0,0.05);--shadow:0 4px 6px -1px rgba(0,0,0,0.1),0 2px 4px -1px rgba(0,0,0,0.06);--shadow-lg:0 10px 15px -3px rgba(0,0,0,0.1),0 4px 6px -2px rgba(0,0,0,0.05);--shadow-xl:0 20px 25px -5px rgba(0,0,0,0.1),0 10px 10px -5px rgba(0,0,0,0.04);--radius-sm:6px;--radius:12px;--radius-lg:16px;--transition:all 0.2s cubic-bezier(0.4,0,0.2,1)}
                .fs-modal-overlay{position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.5);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;z-index:9999;animation:fadeIn 0.2s ease-out}
                .modal{background:var(--background);border-radius:var(--radius-lg);box-shadow:var(--shadow-xl);width:90%;max-width:500px;max-height:90vh;overflow:hidden;border:1px solid var(--border);transform:translateY(0);animation:slideUp 0.3s cubic-bezier(0.4,0,0.2,1)}
                .fs-modal-header{padding:24px 24px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between}
                .fs-modal-title{font-size:20px;font-weight:600;color:var(--text-primary);display:flex;align-items:center;gap:8px}
                .fs-modal-title svg{width:20px;height:20px}
                .fs-modal-close{background:none;border:none;height:32px;display:flex;align-items:center;justify-content:center;color:var(--text-secondary);cursor:pointer;transition:var(--transition)}
                .fs-modal-close:hover{background:var(--surface);color:var(--text-primary)}
                .fs-modal-content{padding:24px}
                .fs-modal-footer{padding:16px 24px 24px;border-top:1px solid var(--border);display:flex;gap:12px;justify-content:flex-end}
                .fs-file-input{display:none}
                .fs-file-list-container{background:var(--surface);border-radius:var(--radius);padding:16px;margin-bottom:20px;max-height:200px;overflow-y:auto}
                .fs-file-list-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}
                .fs-file-count{font-size:13px;color:var(--text-secondary);font-weight:500}
                .fs-file-list{display:flex;flex-direction:column;gap:8px}
                .fs-file-item{font-size:13px;color:var(--text-primary);padding:8px 12px;background:white;border-radius:var(--radius-sm);border:1px solid var(--border);word-break:break-all;line-height:1.4}
                .modal textarea{width:100%;min-height:120px;padding:16px;border:2px solid var(--border);border-radius:var(--radius);background:var(--surface);color:var(--text-primary);font-family:'JetBrains Mono','Consolas','Monaco',monospace;font-size:13px;line-height:1.5;resize:vertical;transition:var(--transition);box-sizing:border-box}
                .modal textarea:focus{outline:none;border-color:var(--primary-color);box-shadow:0 0 0 3px rgba(99,102,241,0.1)}
                .modal textarea.drag-over{border-color:var(--primary-color);background:rgba(99,102,241,0.05)}
                .button-group{display:flex;gap:12px;align-items:center}
                .btn{padding:10px 20px;border-radius:var(--radius);font-size:14px;font-weight:500;border:none;cursor:pointer;transition:var(--transition);display:inline-flex;align-items:center;justify-content:center;gap:8px;min-width:100px}
                .btn:disabled{opacity:0.5;cursor:not-allowed}
                .fs-btn-primary{background:linear-gradient(135deg,var(--primary-color),var(--primary-hover));color:white;box-shadow:var(--shadow)}
                .fs-btn-primary:hover:not(:disabled){transform:translateY(-1px);box-shadow:var(--shadow-lg)}
                .fs-btn-secondary{background:linear-gradient(135deg,var(--secondary-color),var(--secondary-hover));color:white;box-shadow:var(--shadow)}
                .fs-btn-secondary:hover:not(:disabled){transform:translateY(-1px);box-shadow:var(--shadow-lg)}
                .fs-btn-outline{background:white;color:var(--text-primary);border:1px solid var(--border)}
                .fs-btn-outline:hover:not(:disabled){background:var(--surface);border-color:var(--text-secondary)}
                .fs-btn-danger{background:var(--danger-color);color:white}
                .fs-btn-danger:hover:not(:disabled){background:var(--danger-hover)}
                .dropdown{position:relative}
                .fs-dropdown-toggle{display:inline-flex;align-items:center;gap:4px}
                .fs-dropdown-menu{position:absolute;bottom:100%;left:0;background:white;border:1px solid var(--border);border-radius:var(--radius);box-shadow:var(--shadow-lg);min-width:140px;z-index:1001;margin-bottom:8px;opacity:0;transform:translateY(10px);visibility:hidden;transition:var(--transition)}
                .dropdown:hover .fs-dropdown-menu{opacity:1;transform:translateY(0);visibility:visible}
                .fs-dropdown-item{padding:10px 16px;font-size:13px;color:var(--text-primary);cursor:pointer;transition:var(--transition);display:flex;align-items:center;gap:8px}
                .fs-dropdown-item:hover{background:var(--surface)}
                .fs-dropdown-item:first-child{border-radius:var(--radius) var(--radius) 0 0}
                .fs-dropdown-item:last-child{border-radius:0 0 var(--radius) var(--radius)}
                .fs-dropdown-divider{height:1px;background:var(--border);margin:4px 0}
                .toast{position:fixed;top:24px;right:24px;background:white;color:var(--text-primary);padding:12px 20px;border-radius:var(--radius);box-shadow:var(--shadow-lg);z-index:10002;font-size:14px;max-width:320px;animation:slideInRight 0.3s cubic-bezier(0.4,0,0.2,1);border-left:4px solid var(--info-color);display:flex;align-items:center;gap:12px}
                .toast.success{border-left-color:var(--secondary-color)}
                .toast.error{border-left-color:var(--danger-color)}
                .toast.warning{border-left-color:var(--warning-color)}
                .toast.info{border-left-color:var(--info-color)}
                .toast-icon{width:20px;height:20px}
                .fs-progress-modal{animation:modalSlideIn 0.3s cubic-bezier(0.4,0,0.2,1)}
                .fs-progress-content{padding:24px;text-align:center}
                .fs-progress-title{font-size:18px;font-weight:600;color:var(--text-primary);margin-bottom:20px;word-break:break-all;line-height:1.4}
                .fs-progress-bar-container{height:8px;background:var(--surface);border-radius:4px;overflow:hidden;margin-bottom:12px}
                .fs-progress-bar{height:100%;background:linear-gradient(90deg,var(--primary-color),var(--secondary-color));border-radius:4px;transition:width 0.3s ease}
                .fs-progress-info{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px}
                .fs-progress-percent{font-size:16px;font-weight:600;color:var(--primary-color)}
                .fs-progress-desc{font-size:13px;color:var(--text-secondary);text-align:left;background:var(--surface);padding:12px;border-radius:var(--radius);margin-top:16px;word-break:break-all;line-height:1.4}
                .fs-progress-minimize-btn{position:absolute;top:16px;right:16px;width:32px;height:32px;border-radius:50%;background:var(--surface);border:1px solid var(--border);color:var(--text-secondary);cursor:pointer;display:flex;align-items:center;justify-content:center;transition:var(--transition)}
                .fs-progress-minimize-btn:hover{background:var(--border);color:var(--text-primary)}
                .minimized-widget{position:fixed;right:24px;bottom:24px;background:white;border-radius:var(--radius);box-shadow:var(--shadow-lg);padding:12px 16px;z-index:10005;min-width:240px;cursor:pointer;transition:var(--transition);border:1px solid var(--border)}
                .minimized-widget:hover{transform:translateY(-2px);box-shadow:var(--shadow-xl)}
                .fs-widget-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}
                .fs-widget-title{font-size:12px;font-weight:500;color:var(--text-primary)}
                .fs-widget-badge{background:var(--danger-color);color:white;font-size:11px;font-weight:600;padding:2px 8px;border-radius:10px}
                .fs-widget-progress{display:flex;align-items:center;gap:12px}
                .fs-widget-bar{flex:1;height:4px;background:var(--surface);border-radius:2px;overflow:hidden}
                .fs-widget-fill{height:100%;background:linear-gradient(90deg,var(--primary-color),var(--secondary-color));border-radius:2px}
                .fs-widget-percent{font-size:12px;font-weight:600;color:var(--primary-color);min-width:40px}
                .fs-task-list-container{margin-top:20px}
                .fs-task-toggle{width:100%;padding:10px 16px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);color:var(--text-secondary);font-size:13px;display:flex;align-items:center;justify-content:space-between;cursor:pointer;transition:var(--transition)}
                .fs-task-toggle:hover{background:#f1f5f9}
                .fs-task-toggle.active{background:var(--primary-color);color:white;border-color:var(--primary-color)}
                .fs-task-list{max-height:160px;overflow-y:auto;border:1px solid var(--border);border-top:none;border-radius:0 0 var(--radius) var(--radius);background:white;display:none}
                .fs-task-list.show{display:block}
                .fs-task-item{padding:12px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;transition:var(--transition)}
                .fs-task-item:last-child{border-bottom:none}
                .fs-task-item.current{background:rgba(99,102,241,0.05)}
                .fs-task-info{display:flex;align-items:center;gap:8px}
                .fs-task-icon{width:12px;height:12px;border-radius:50%}
                .fs-task-icon.generate{background:var(--secondary-color)}
                .fs-task-icon.save{background:var(--info-color)}
                .fs-task-icon.retry{background:var(--warning-color)}
                .fs-task-name{font-size:13px;color:var(--text-primary)}
                .fs-task-status{font-size:12px;color:var(--text-secondary)}
                .fs-task-remove{width:24px;height:24px;border-radius:50%;border:none;background:var(--surface);color:var(--text-secondary);cursor:pointer;display:flex;align-items:center;justify-content:center;transition:var(--transition)}
                .fs-task-remove:hover{background:var(--danger-color);color:white}
                .fs-task-remove:disabled{opacity:0.5;cursor:not-allowed}
                .fs-results-content{text-align:left}
                .fs-results-stats{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px}
                .fs-stat-card{padding:16px;border-radius:var(--radius);text-align:center}
                .fs-stat-card.success{background:rgba(16,185,129,0.1);border:1px solid rgba(16,185,129,0.2)}
                .fs-stat-card.failed{background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.2)}
                .fs-stat-value{font-size:24px;font-weight:700;margin-bottom:4px}
                .fs-stat-value.success{color:var(--secondary-color)}
                .fs-stat-value.failed{color:var(--danger-color)}
                .fs-stat-label{font-size:12px;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.5px}
                .fs-failed-list{max-height:200px;overflow-y:auto;background:var(--surface);border-radius:var(--radius);padding:12px}
                .fs-failed-item{padding:8px 12px;background:white;border-radius:var(--radius-sm);border:1px solid var(--border);margin-bottom:8px;font-size:12px}
                .fs-failed-item:last-child{margin-bottom:0}
                .fs-failed-name{color:var(--text-primary);word-break:break-all}
                .fs-failed-error{color:var(--danger-color);font-size:11px;margin-top:4px}
                .fs-mfy-button-container{position:relative;display:inline-block}
                .fs-mfy-button{display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:8px 16px;background:linear-gradient(135deg,#64cc77,#4db366);color:white;border:none;border-radius:var(--radius);font-size:14px;font-weight:500;cursor:pointer;transition:var(--transition);box-shadow:var(--shadow);width:90px;box-sizing:border-box}
                .fs-mfy-button:hover{transform:translateY(-1px);box-shadow:var(--shadow-lg)}
                .fs-mfy-button svg{width:16px;height:16px}
                .fs-mfy-dropdown{position:absolute;top:calc(100% + 4px);left:0;background:white;border:1px solid var(--border);border-radius:var(--radius);box-shadow:var(--shadow-lg);min-width:160px;z-index:1000;opacity:0;transform:translateY(-10px);visibility:hidden;transition:var(--transition)}
                .fs-mfy-button-container:hover .fs-mfy-dropdown{opacity:1;transform:translateY(0);visibility:visible}
                .fs-mfy-dropdown-item{padding:10px 16px;font-size:13px;color:var(--text-primary);cursor:pointer;transition:var(--transition);display:flex;align-items:center;gap:8px}
                .fs-mfy-dropdown-item:hover{background:var(--surface)}
                .fs-mfy-dropdown-item:first-child{border-radius:var(--radius) var(--radius) 0 0}
                .fs-mfy-dropdown-item:last-child{border-radius:0 0 var(--radius) var(--radius)}
                .fs-mfy-dropdown-divider{height:1px;background:var(--border);margin:4px 0}
                @keyframes fadeIn{from{opacity:0}
                to{opacity:1}
                }@keyframes slideUp{from{opacity:0;transform:translateY(20px)}
                to{opacity:1;transform:translateY(0)}
                }@keyframes slideInRight{from{opacity:0;transform:translateX(100%)}
                to{opacity:1;transform:translateX(0)}
                }@keyframes modalSlideIn{from{opacity:0;transform:translateY(-20px) scale(0.95)}
                to{opacity:1;transform:translateY(0) scale(1)}
                }@keyframes pulse{0%,100%{opacity:1}
                50%{opacity:0.5}
                }.animate-pulse{animation:pulse 2s cubic-bezier(0.4,0,0.6,1) infinite}
                /* ============================================================
                设置页面样式
                ============================================================ */
                /* 1. 容器与布局 */
                .fs-settings-container {display: flex;flex-direction: column;gap: 12px;padding: 4px 0;}
                /* 2. 设置行项目 - 卡片感设计 */
                .fs-setting-row {display: flex;align-items: center;justify-content: space-between;padding: 16px;background: var(--surface);border-radius: var(--radius);transition: var(--transition);border: 1px solid transparent;}
                .fs-setting-row:hover {background: #ffffff;border-color: var(--border);box-shadow: var(--shadow-sm);transform: translateY(-1px);}
                .fs-setting-row.readonly {opacity: 0.6;cursor: not-allowed;}
                /* 3. 文本信息区 */
                .fs-setting-info {display: flex;flex-direction: column;gap: 4px;flex: 1;padding-right: 24px;}
                .fs-setting-label-text {font-size: 14.5px;font-weight: 600;color: var(--text-primary);letter-spacing: 0.3px;}
                .fs-setting-describe {font-size: 12.5px;color: var(--text-secondary);line-height: 1.5;}
                /* 4. 交互控件区 */
                .fs-setting-action {display: flex;align-items: center;justify-content: flex-end;min-width: 100px;}
                /* 5. Switch 开关 */
                .fs-settings-switch {position: relative;display: inline-block;width: 44px;height: 24px;}
                .fs-settings-switch input {opacity: 0;width: 0;height: 0;}
                .switch-slider {position: absolute;cursor: pointer;top: 0; left: 0; right: 0; bottom: 0;background-color: var(--border);transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);border-radius: 24px;}
                .switch-slider:before {position: absolute;content: "";height: 18px;width: 18px;left: 3px;bottom: 3px;background-color: white;transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);border-radius: 50%;box-shadow: 0 2px 4px rgba(0,0,0,0.1);}
                .fs-settings-switch input:checked + .switch-slider {background-color: var(--primary-color);}
                .fs-settings-switch input:focus + .switch-slider {box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.2);}
                .fs-settings-switch input:checked + .switch-slider:before {transform: translateX(20px);}
                /* 6. 分段选择器 (Segmented Radio) */
                .fs-settings-radio-group {display: flex;background: #eef2f6;padding: 3px;border-radius: 10px;gap: 2px;}
                .fs-reset-tab {cursor: pointer;position: relative;}
                .fs-reset-tab input {position: absolute;opacity: 0;}
                .fs-reset-tab span {display: block;padding: 6px 14px;font-size: 12px;font-weight: 500;border-radius: 7px;color: var(--text-secondary);transition: all 0.2s;}
                .fs-reset-tab input:checked + span {background: white;color: var(--primary-color);box-shadow: var(--shadow-sm);}
                /* 7. 输入框与下拉框 */
                .fs-settings-input, .fs-settings-select {width: 100%;max-width: 180px;padding: 8px 12px;border: 1.5px solid var(--border);border-radius: var(--radius-sm);background: #ffffff !important;color: var(--text-primary);font-size: 13px;transition: var(--transition);}
                .fs-settings-input:focus, .fs-settings-select:focus {border-color: var(--primary-color);outline: none;box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);}
                /* 8. 底部状态反馈样式 */
                .fs-settings-status {flex: 1;font-size: 13px;display: flex;align-items: center;gap: 6px;}
                .fs-status-warning {color: var(--warning-color);background: rgba(245, 158, 11, 0.1);padding: 4px 10px;border-radius: 20px;}
                .fs-status-success {color: var(--secondary-color);animation: fadeIn 0.3s ease;}
                /* 9. 底部按钮组微调 */
                .fs-modal-footer .button-group {display: flex;gap: 10px;}
                .fs-reset-default-btn {margin-right: auto; /* 将恢复默认按钮推向最左侧 */color: var(--text-secondary) !important;}
                .fs-reset-default-btn:hover {color: var(--danger-color) !important;border-color: var(--danger-color) !important;}/* 模态框布局固定 */
                .fs-settings-modal-box {width: 90%;max-width: 600px;max-height: 85vh; /* 限制最高高度 */display: flex;flex-direction: column; /* 纵向排列 Header, Content, Footer */}
                /* 内容滚动区 */
                .fs-settings-scroll-area {flex: 1; /* 自动占据剩余高度 */overflow-y: auto; /* 关键：设置项过多时在此滚动 */padding: 24px;background: #ffffff;}
                /* 只读行样式 */
                .fs-setting-row.readonly-row {background: #f1f5f9; /* 灰色背景 */opacity: 0.75;cursor: not-allowed;border: 1px dashed var(--border);}
                .fs-setting-row.readonly-row:hover {transform: none;box-shadow: none;}
                .readonly-badge {background: var(--text-tertiary);color: white;font-size: 10px;padding: 2px 6px;border-radius: 4px;margin-left: 8px;vertical-align: middle;}
                /* 禁用控件样式 */
                .fs-settings-switch.readonly, 
                .fs-settings-radio-group.readonly,
                .fs-settings-select:disabled,
                .fs-settings-input:read-only {pointer-events: none; /* 禁止点击 */filter: grayscale(1); /* 置灰 */}
                /* Footer 固定在底部 */
                .fs-modal-footer {flex-shrink: 0;background: white;z-index: 10;}
                `;
                document.head.appendChild(style);
            }
        }

        /**
         * 显示提示消息
         */
        showToast(message, type = 'info', duration = 3000) {
            const icons = {
                success: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>',
                error: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
                warning: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
                info: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>'
            };

            const toast = document.createElement('div');
            toast.className = `toast ${type}`;
            toast.innerHTML = `
            <div class="toast-icon">${icons[type]}</div>
            <div>${message}</div>
        `;

            document.body.appendChild(toast);

            setTimeout(() => {
                toast.style.opacity = '0';
                toast.style.transform = 'translateX(100%)';
                setTimeout(() => {
                    if (toast.parentNode) {
                        toast.parentNode.removeChild(toast);
                    }
                }, 300);
            }, duration);
        }

        // ------------------------------ 设置页 ----------------------------------
        /**
         * 显示系统设置模态框
         */
        showSettingsModal() {
            // this.insertStyle();

            // 1. 防止重复打开
            const existingModal = document.getElementById('fs-settings-modal');
            if (existingModal) existingModal.remove();

            // 2. 数据副本隔离：深拷贝原始设置
            const editingSettings = JSON.parse(JSON.stringify(this.settings));
            let settingsChanged = false;

            // 3. 生成设置项 HTML
            let settingsHtml = '';
            editingSettings.forEach((setting) => {
                const id = `fs-setting-${setting.key}`;
                let controlHtml = '';
                // 判定是否只读
                const isReadonly = setting.readonly === true;

                switch (setting.type) {
                    case 'checkbox':
                        controlHtml = `
                    <label class="fs-settings-switch ${isReadonly ? 'readonly' : ''}">
                        <input type="checkbox" id="${id}" ${setting.value ? 'checked' : ''} 
                                class="fs-settings-control-input" data-key="${setting.key}" ${isReadonly ? 'disabled' : ''}>
                        <span class="switch-slider"></span>
                    </label>`;
                        break;
                    case 'select':
                        controlHtml = `
                    <select id="${id}" class="fs-settings-select" data-key="${setting.key}" ${isReadonly ? 'disabled' : ''}>
                        ${setting.options.map(opt => `<option value="${opt.value}" ${opt.value === setting.value ? 'selected' : ''}>${opt.label}</option>`).join('')}
                    </select>`;
                        break;
                    case 'radio':
                        controlHtml = `
                    <div class="fs-settings-radio-group ${isReadonly ? 'readonly' : ''}" data-key="${setting.key}">
                        ${setting.options.map(opt => `
                            <label class="fs-reset-tab">
                                <input type="radio" name="${setting.key}" value="${opt.value}" 
                                    ${opt.value === setting.value ? 'checked' : ''} 
                                    class="fs-settings-control-input" ${isReadonly ? 'disabled' : ''}>
                                <span>${opt.label}</span>
                            </label>
                        `).join('')}
                    </div>`;
                        break;
                    default:
                        controlHtml = `<input type="${setting.type || 'text'}" id="${id}" value="${setting.value}" 
                                    class="fs-settings-input" data-key="${setting.key}" ${isReadonly ? 'readonly' : ''}>`;
                }

                settingsHtml += `
                    <div class="fs-setting-row ${isReadonly ? 'readonly-row' : ''}">
                        <div class="fs-setting-info">
                            <div class="fs-setting-label-text">${setting.label}</div>
                            <div class="fs-setting-describe">${setting.describe || setting.description || ''}</div>
                        </div>
                        <div class="fs-setting-action">${controlHtml}</div>
                    </div>`;
            });

            // 4. 构建模态框结构 (关键：固定头部底部，中间滚动)
            const modalOverlay = document.createElement('div');
            modalOverlay.className = 'fs-modal-overlay';
            modalOverlay.id = 'fs-settings-modal';
            modalOverlay.innerHTML = `
            <div class="modal fs-settings-modal-box">
                <div class="fs-modal-header">
                    <div class="fs-modal-title">
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
                        系统设置
                    </div>
                    <button class="fs-modal-close" id="close-modal-btn">
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                    </button>
                </div>
                <div class="fs-modal-content fs-settings-scroll-area">
                    <div class="fs-settings-container">${settingsHtml}</div>
                </div>
                <div class="fs-modal-footer">
                    <div id="fs-settings-status-bar" class="fs-settings-status"></div>
                    <div class="button-group">
                        <button class="btn fs-btn-outline fs-reset-default-btn" id="fs-reset-btn">恢复默认</button>
                        <button class="btn fs-btn-outline" id="cancel-btn">取消</button>
                        <button class="btn fs-btn-primary" id="save-btn">保存设置</button>
                    </div>
                </div>
            </div>`;

            document.body.appendChild(modalOverlay);

            // --- 内部逻辑函数 ---

            const setStatus = (msg, type = 'info') => {
                const statusEl = document.getElementById('fs-settings-status-bar');
                if (statusEl) statusEl.innerHTML = `<span class="fs-status-${type}">${msg}</span>`;
            };

            const closeSettings = (needConfirm = true) => {
                if (settingsChanged && needConfirm) {
                    this.showAlertModal('warning', '未保存', '确定放弃当前修改并离开吗？', {
                        confirmText: '放弃',
                        showCancel: true,
                        cancelText: '返回',
                        onConfirm: () => modalOverlay.remove()
                    });
                } else {
                    modalOverlay.remove();
                }
            };

            const saveSettings = () => {
                if (!settingsChanged) return closeSettings(false);
                try {
                    editingSettings.forEach(edited => {
                        const original = this.settings.find(s => s.key === edited.key);
                        if (original && !original.readonly) {
                            // 检查seedFilePath
                            if (edited.key === 'seedFilePathId') {
                                if (edited.value) {
                                    const pathLenth = edited.value.toString().length;
                                    if (pathLenth === 1 || pathLenth === 8) {
                                        this.seedFilePathId = edited.value;
                                        original.value = edited.value; // 更新内存
                                    } else {
                                        this.showAlertModal('error', '种子文件路径错误', "跳过设置路径ID");
                                    }
                                }
                            } else {
                                original.value = edited.value; // 更新内存
                            }
                            if (typeof GlobalConfig !== 'undefined' && GlobalConfig.hasOwnProperty(edited.key)) {
                                GlobalConfig[edited.key] = edited.value; // 更新业务配置
                            }
                            this.saveSettings(); // 持久化
                        }
                    });
                    this.showToast('设置保存成功', 'success', 2000);
                    closeSettings(false);
                } catch (e) {
                    this.showToast('持久化失败: ' + e.message, 'error');
                }
            };

            // --- 事件绑定 ---

            modalOverlay.addEventListener('change', (e) => {
                const target = e.target;
                const key = target.dataset.key || target.name;
                if (!key) return;

                const setting = editingSettings.find(s => s.key === key);
                // 【核心拦截】如果副本标志位或原始项是 readonly，直接不响应
                if (!setting || setting.readonly) return;

                if (target.type === 'checkbox') setting.value = target.checked; else if (target.type === 'radio') setting.value = target.value; else if (target.type === 'number') setting.value = parseFloat(target.value); else setting.value = target.value;

                settingsChanged = true;
                setStatus('设置已修改，请保存', 'warning');
            });

            modalOverlay.querySelector('#save-btn').onclick = saveSettings;
            modalOverlay.querySelector('#cancel-btn').onclick = () => closeSettings(true);
            modalOverlay.querySelector('#close-modal-btn').onclick = () => closeSettings(true);
            modalOverlay.querySelector('#fs-reset-btn').onclick = () => {
                this.showAlertModal('error', '重置所有设置？', '该操作将清除 GM 存储并刷新页面恢复默认配置！', {
                    confirmText: '立即重置', showCancel: true, onConfirm: () => {
                        deleteSettings();
                        location.reload();
                    }
                });
            };

            // 遮罩点击及键盘支持
            modalOverlay.onclick = (e) => {
                if (e.target === modalOverlay) closeSettings(true);
            };
            const handleKey = (e) => {
                if (e.key === 'Escape') closeSettings(true);
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) saveSettings();
            };
            document.addEventListener('keydown', handleKey);
            const originalRemove = modalOverlay.remove;
            modalOverlay.remove = function () {
                document.removeEventListener('keydown', handleKey);
                originalRemove.call(this);
            };
        }

        showFirstTimeGuide() {
            this.showAlertModal('info', '欢迎使用123FastLink', `如果您是第一次使用本脚本，建议先阅读使用说明文档，了解基本功能和操作方法。
                \n
                ✅️ 如果要使用二级秒传链接，
                建议先在设置中设置秒传文件路径`);
        }

        /**
         * 显示复制弹窗
         */
        showCopyModal(defaultText = "", allFilePath = [], title = "秒传链接") {
            const fileListHtml = Array.isArray(this.shareLinkManager.fileInfoList) && allFilePath.length > 0 ? `
                <div class="fs-file-list-container">
                    <div class="fs-file-list-header">
                        <div class="fs-file-count">文件列表（共${allFilePath.length}个）</div>
                    </div>
                    <div class="fs-file-list">
                        ${allFilePath.map(f => `
                            <div class="fs-file-item">${f}</div>
                        `).join('')}
                    </div>
                </div>
            ` : '';

            const modalOverlay = document.createElement('div');
            modalOverlay.className = 'fs-modal-overlay';
            modalOverlay.innerHTML = `
            <div class="modal">
                <div class="fs-modal-header">
                    <div class="fs-modal-title">
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="16 18 22 12 16 6"></polyline>
                            <polyline points="8 6 2 12 8 18"></polyline>
                        </svg>
                        ${title}
                    </div>
                    <button class="fs-modal-close" onclick="this.closest('.fs-modal-overlay').remove()">
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </button>
                </div>
                <div class="fs-modal-content">
                    ${fileListHtml}
                    <textarea id="copyText" placeholder="请输入或粘贴秒传链接...">${defaultText}</textarea>
                </div>
                <div class="fs-modal-footer">
                    <div class="dropdown">
                        <button class="btn fs-btn-primary fs-dropdown-toggle">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                            </svg>
                            复制
                        </button>
                        <div class="fs-dropdown-menu">
                            <div class="fs-dropdown-item" data-type="json">
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2"></path>
                                    <path d="M18 14h-8"></path>
                                    <path d="M15 18h-5"></path>
                                    <path d="M10 6h8v4h-8V6Z"></path>
                                </svg>
                                复制JSON
                            </div>
                            <div class="fs-dropdown-item" data-type="text">
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <polyline points="16 18 22 12 16 6"></polyline>
                                    <polyline points="8 6 2 12 8 18"></polyline>
                                </svg>
                                复制纯文本
                            </div>
                        </div>
                    </div>
                    <button class="btn fs-btn-secondary" id="exportJsonButton">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                            <polyline points="7 10 12 15 17 10"></polyline>
                            <line x1="12" y1="15" x2="12" y2="3"></line>
                        </svg>
                        导出JSON
                    </button>
                </div>
            </div>
        `;

            // 复制菜单事件
            const dropdownItems = modalOverlay.querySelectorAll('.fs-dropdown-item');
            dropdownItems.forEach(item => {
                item.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const type = item.dataset.type;
                    this.copyContent(type);
                });
            });

            // 主复制按钮事件
            modalOverlay.querySelector('.fs-dropdown-toggle').addEventListener('click', (e) => {
                e.stopPropagation();
                this.copyContent('default');
            });

            // 导出按钮事件
            modalOverlay.querySelector('#exportJsonButton').addEventListener('click', (e) => {
                e.stopPropagation();
                this.exportJson();
            });

            // 点击遮罩关闭
            // modalOverlay.addEventListener('click', (e) => {
            //     if (e.target === modalOverlay) modalOverlay.remove();
            // });

            document.body.appendChild(modalOverlay);

            // 自动聚焦文本域
            setTimeout(() => {
                const textarea = modalOverlay.querySelector('#copyText');
                if (textarea && !defaultText) textarea.focus();
            }, 100);
        }

        /**
         * 复制内容到剪贴板
         * @param {*} type - 复制类型（文本或JSON）
         * @returns
         */
        copyContent(type) {
            const inputField = document.querySelector('#copyText');
            if (!inputField) return;

            let contentToCopy = inputField.value;

            if (type !== 'default') {
                let contentType = this.shareLinkManager.linkChecker(contentToCopy);
                if (!contentType[0]) {
                    this.showToast('无效的秒传链接，无法复制', 'error');
                    return;
                }

                if (type === 'json') {
                    if (contentType[2] === 'text') {
                        contentToCopy = this.shareLinkManager.textShareLinkToJson(contentToCopy)[2];
                        // contentToCopy = JSON.stringify(contentToCopyInfo, null, 2);
                    }
                } else if (type === 'text') {
                    if (contentType[2] === 'json') {
                        contentToCopy = this.shareLinkManager.jsonToTextShareLink(contentToCopy)[2];
                    }
                }
            }

            navigator.clipboard.writeText(contentToCopy).then(() => {
                this.showToast(`已成功复制到剪贴板 📋`, 'success');
            }).catch(err => {
                this.showToast(`复制失败: ${err.message || '请手动复制内容'}`, 'error');
            });
        }

        /**
         * 导出JSON
         * @returns
         */
        exportJson() {
            const inputField = document.querySelector('#copyText');
            if (!inputField) return;

            const shareLink = inputField.value;
            if (!shareLink.trim()) {
                this.showToast('没有内容可导出', 'warning');
                return;
            }


            const jsonContent = this.shareLinkManager.textShareLinkToJson(shareLink)[2];
            // const jsonContent = JSON.stringify(jsonData, null, 2);
            this.shareLinkManager.getExportFilename(shareLink).then(filename => {
                this.downloadJsonFile(jsonContent, filename + '.json');
                this.showToast('JSON文件导出成功 📁', 'success');
            }).catch(err => {
                this.showToast(`导出失败: ${err.message || '请重试'}`, 'error');
            });

        }

        // 下载JSON文件
        downloadJsonFile(content, filename) {
            const blob = new Blob([content], {type: 'application/json'});
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }

        /**
         * 显示或更新进度模态框
         * @param title - 标题
         * @param percent - 进度百分比（0-100）
         * @param desc - 进度描述
         * @param taskCount - 任务队列长度
         */
        updateProgressModal(title = "正在处理...", percent = 0, desc = "", taskCount = 1) {
            percent = Math.ceil(percent);

            if (this.isProgressMinimized) {
                this.updateMinimizedWidget(title, percent, desc, taskCount);
                return;
            }

            let modal = document.getElementById('fs-progress-modal');
            if (!modal) {
                modal = document.createElement('div');
                modal.id = 'fs-progress-modal';
                modal.className = 'fs-modal-overlay fs-progress-modal';
                modal.innerHTML = `
                <div class="modal" style="max-width: 400px;">
                    <div class="fs-modal-header">
                        <div class="fs-modal-title">
                            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="animate-pulse">
                                <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"></path>
                            </svg>
                            ${title}${taskCount > 1 ? ` - 队列 ${taskCount}` : ''}
                        </div>
                        <button class="fs-progress-minimize-btn" title="最小化">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <polyline points="4 14 10 14 10 20"></polyline>
                                <polyline points="20 10 14 10 14 4"></polyline>
                                <line x1="14" y1="10" x2="21" y2="3"></line>
                                <line x1="3" y1="21" x2="10" y2="14"></line>
                            </svg>
                        </button>
                    </div>
                    <div class="fs-progress-content">
                        <div class="fs-progress-bar-container">
                            <div class="fs-progress-bar" id="fs-progress-bar" style="width: ${percent}%"></div>
                        </div>
                        <div class="fs-progress-info">
                            <div class="fs-progress-percent">${percent}%</div>
                        </div>
                        ${desc ? `<div class="fs-progress-desc">${desc}</div>` : ''}
                    </div>
                </div>
            `;

                // 最小化按钮事件
                const minimizeBtn = modal.querySelector('.fs-progress-minimize-btn');
                minimizeBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.isProgressMinimized = true;
                    this.removeProgressModalAndKeepState();
                    this.updateMinimizedWidget(title, percent, desc, taskCount);
                });

                document.body.appendChild(modal);
            } else {
                const titleElement = modal.querySelector('.fs-modal-title');
                const barElement = modal.querySelector('#fs-progress-bar');
                const percentElement = modal.querySelector('.fs-progress-percent');
                const descElement = modal.querySelector('.fs-progress-desc');

                if (titleElement) {
                    titleElement.innerHTML = `
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="animate-pulse">
                        <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"></path>
                    </svg>
                    ${title}${taskCount > 1 ? ` - 队列 ${taskCount}` : ''}
                `;
                }

                if (barElement) barElement.style.width = percent + '%';
                if (percentElement) percentElement.textContent = percent + '%';

                if (desc) {
                    if (!descElement) {
                        const progressContent = modal.querySelector('.fs-progress-content');
                        const descDiv = document.createElement('div');
                        descDiv.className = 'fs-progress-desc';
                        descDiv.textContent = desc;
                        progressContent.appendChild(descDiv);
                    } else {
                        descElement.textContent = desc;
                    }
                } else if (descElement) {
                    descElement.remove();
                }
            }

            this.manageTaskList(modal);
        }

        /**
         * 任务列表管理 - 统一处理任务列表的创建、更新和事件绑定
         */
        manageTaskList(modal) {
            const existingContainer = modal.querySelector('.fs-task-list-container');
            const currentTaskCount = this.taskList.length;

            if (currentTaskCount === 0) {
                existingContainer?.remove();
                return;
            }

            const generateHtml = () => `
            <div class="fs-task-list-container">
                <button class="fs-task-toggle" id="fs-task-list-toggle">
                    <span>任务队列 (${currentTaskCount})</span>
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="6 9 12 15 18 9"></polyline>
                    </svg>
                </button>
                <div class="fs-task-list" id="fs-task-list">
                    ${this.taskList.map(task => {
                const isCurrentTask = this.currentTask && this.currentTask.id === task.id;
                const typeIcon = task.type === 'generate' ? 'generate' : task.type === 'save' ? 'save' : 'retry';
                return `
                            <div class="fs-task-item ${isCurrentTask ? 'current' : ''}" data-task-id="${task.id}">
                                <div class="fs-task-info">
                                    <div class="fs-task-icon ${typeIcon}"></div>
                                    <div>
                                        <div class="fs-task-name">${this.taskHandlers[task.type].description}</div>
                                        ${isCurrentTask ? '<div class="fs-task-status">执行中...</div>' : ''}
                                    </div>
                                </div>
                                <button class="fs-task-remove" data-task-id="${task.id}" 
                                    ${/*isCurrentTask ? 'disabled' : ''*/ ""}>
                                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                        <line x1="18" y1="6" x2="6" y2="18"></line>
                                        <line x1="6" y1="6" x2="18" y2="18"></line>
                                    </svg>
                                </button>
                            </div>
                        `;
            }).join('')}
                        </div>
                    </div>
                `;

            const bindEvents = (container) => {
                const toggle = container.querySelector('#fs-task-list-toggle');
                const taskList = container.querySelector('#fs-task-list');

                toggle?.addEventListener('click', () => {
                    const isShown = taskList.classList.toggle('show');
                    toggle.classList.toggle('active', isShown);
                    const svg = toggle.querySelector('svg');
                    if (svg) {
                        svg.style.transform = isShown ? 'rotate(180deg)' : 'rotate(0deg)';
                    }
                });

                container.querySelectorAll('.fs-task-remove').forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const taskId = btn.dataset.taskId;
                        if (this.currentTask && this.currentTask.id.toString() === taskId) {
                            this.showToast('正在中断任务', 'warning');
                            this.cancelCurrentTask();
                            return;
                        }
                        this.taskList = this.taskList.filter(task => task.id.toString() !== taskId);
                        this.manageTaskList(modal);
                        this.showToast('任务已取消', 'info');
                    });
                });
            };

            if (!existingContainer) {
                const progressContent = modal.querySelector('.fs-progress-content');
                progressContent.insertAdjacentHTML('beforeend', generateHtml());
                bindEvents(modal.querySelector('.fs-task-list-container'));
            } else {
                const existingTaskItems = existingContainer.querySelectorAll('.fs-task-item');
                const hasCurrentTaskChanged = existingContainer.querySelector('.fs-task-item.current') ? !this.currentTask : !!this.currentTask;

                if (existingTaskItems.length !== currentTaskCount || hasCurrentTaskChanged) {
                    const wasExpanded = existingContainer.querySelector('.fs-task-list').classList.contains('show');
                    existingContainer.remove();

                    const progressContent = modal.querySelector('.fs-progress-content');
                    progressContent.insertAdjacentHTML('beforeend', generateHtml());
                    const newContainer = modal.querySelector('.fs-task-list-container');
                    bindEvents(newContainer);

                    if (wasExpanded) {
                        const taskList = newContainer.querySelector('.fs-task-list');
                        const toggle = newContainer.querySelector('#fs-task-list-toggle');
                        taskList.classList.add('show');
                        toggle.classList.add('active');
                        const svg = toggle.querySelector('svg');
                        if (svg) svg.style.transform = 'rotate(180deg)';
                    }
                } else {
                    const toggleSpan = existingContainer.querySelector('#fs-task-list-toggle span:first-child');
                    if (toggleSpan) toggleSpan.textContent = `任务队列 (${currentTaskCount})`;
                }
            }
        }

        // 隐藏进度条并删除浮动卡片
        hideProgressModal() {
            const modal = document.getElementById('fs-progress-modal');
            if (modal) modal.remove();
            this.removeMinimizedWidget();
            this.isProgressMinimized = false;
        }

        // 移除模态但保留 isProgressMinimized 标志（供最小化按钮调用）
        removeProgressModalAndKeepState() {
            const modal = document.getElementById('fs-progress-modal');
            if (modal) modal.remove();
        }

        // 创建或更新右下角最小化浮动进度条卡片
        updateMinimizedWidget(title = '正在处理...', percent = 0, desc = '', taskCount = 1) {
            let widget = document.getElementById(this.minimizeWidgetId);
            const badgeHtml = this.taskList.length >= 1 ? `<div class="fs-widget-badge">${this.taskList.length}</div>` : '';

            const html = `
            <div class="fs-widget-header">
                <div class="fs-widget-title">${title}${taskCount > 1 ? ` - 队列 ${taskCount}` : ''}</div>
                ${badgeHtml}
            </div>
            <div class="fs-widget-progress">
                <div class="fs-widget-bar">
                    <div class="fs-widget-fill" style="width: ${percent}%"></div>
                </div>
                <div class="fs-widget-percent">${percent}%</div>
            </div>
            `;

            if (!widget) {
                widget = document.createElement('div');
                widget.id = this.minimizeWidgetId;
                widget.className = 'minimized-widget';
                widget.innerHTML = html;

                widget.addEventListener('mouseup', (e) => {
                    e.stopPropagation();
                    this.isProgressMinimized = false;
                    this.removeMinimizedWidget();
                    this.updateProgressModal(title, percent, desc, taskCount);
                });

                document.body.appendChild(widget);
            } else {
                widget.innerHTML = html;
            }
        }

        // 移除右下角浮动卡片
        removeMinimizedWidget() {
            const w = document.getElementById(this.minimizeWidgetId);
            if (w) w.remove();
        }

        /**
         * 任务函数 - 启动生成链接，UI层面的生成入口
         * 包括UI进度条显示和轮询
         * @param {*} fileSelectInfo - 选中文件信息，来自selector
         */
        async launchGenerateModal(fileSelectInfo, secondary = false) {
            const poll = this.startRollPolling("生成秒传链接");
            let shareLinkResult;
            if (secondary) {
                shareLinkResult = await this.shareLinkManager.generateSecondaryShareLink(fileSelectInfo, null, this.seedFilePathId);
            } else {
                shareLinkResult = await this.shareLinkManager.generateShareLink(fileSelectInfo);
            }
            if (!shareLinkResult[0]) {
                this.showToast(shareLinkResult[1] || "秒传链接生成失败", 'error');
                this.showAlertModal("error", "秒传链接生成失败", shareLinkResult[1] || "未知错误");
                this.stopRollPolling(poll);
                return null;
            }
            const shareLink = shareLinkResult[2];
            // 清除任务取消标志
            this.shareLinkManager.taskCancel = false;
            if (!shareLink) {
                this.showToast("没有选择文件", 'warning');
                this.stopRollPolling(poll);
                return;
            }
            this.stopRollPolling(poll);
            this.showCopyModal(shareLink, shareLinkResult[3] || [], secondary ? "二级链接" : "秒传链接");
            return shareLink;
        }

        async launchSecondaryGenerateModal(fileSelectInfo) {
            return this.launchGenerateModal(fileSelectInfo, true);
        }

        /**
         * 显示保存结果模态框
         * @param result - {success: [], failed: []}
         * @returns null
         */
        async showSaveResultsModal(result) {
            const totalCount = result.success.length + result.failed.length;
            const successCount = result.success.length;
            const failedCount = result.failed.length;

            // 成功的列表是后加的，先借用失败的样式了
            const successListHtml = successCount > 0 ? `
            <div style="margin-top: 20px;">
                <div style="font-size: 13px; font-weight: 500; color: var(--info-color); margin-bottom: 8px;">
                    成功文件列表
                </div>
                <div class="fs-failed-list">
                    ${result.success.map(fileInfo => `
                        <div class="fs-failed-item">
                            <div class="fs-failed-name">${fileInfo.fileName}</div>
                        </div>
                    `).join('')}
                </div>
            </div>
            ` : '';

            const failedListHtml = failedCount > 0 ? `
            <div style="margin-top: 20px;">
                <div style="font-size: 13px; font-weight: 500; color: var(--danger-color); margin-bottom: 8px;">
                    失败文件列表
                </div>
                <div class="fs-failed-list">
                    ${result.failed.map(fileInfo => `
                        <div class="fs-failed-item">
                            <div class="fs-failed-name">${fileInfo.fileName}</div>
                            ${fileInfo.error ? `<div class="fs-failed-error">${fileInfo.error}</div>` : ''}
                        </div>
                    `).join('')}
                </div>
            </div>
            ` : '';

            const modalOverlay = document.createElement('div');
            modalOverlay.className = 'fs-modal-overlay';
            modalOverlay.innerHTML = `
            <div class="modal" style="max-width: 500px;">
                <div class="fs-modal-header">
                    <div class="fs-modal-title">
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                            <polyline points="22 4 12 14.01 9 11.01"></polyline>
                        </svg>
                        保存结果
                    </div>
                    <button class="fs-modal-close" onclick="this.closest('.fs-modal-overlay').remove()">
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </button>
                </div>
                <div class="fs-modal-content fs-results-content">
                    <div class="fs-results-stats">
                        <div class="fs-stat-card success">
                            <div class="fs-stat-value success">${successCount}</div>
                            <div class="fs-stat-label">成功</div>
                        </div>
                        <div class="fs-stat-card failed">
                            <div class="fs-stat-value failed">${failedCount}</div>
                            <div class="fs-stat-label">失败</div>
                        </div>
                    </div>
                    <div style="text-align: center; font-size: 13px; color: var(--text-secondary); margin: 20px 0;">
                        总计处理 <strong>${totalCount}</strong> 个文件
                    </div>
                    ${successListHtml}
                    ${failedListHtml}
                </div>
                <div class="fs-modal-footer">
                    <button class="btn fs-btn-outline" onclick="this.closest('.fs-modal-overlay').remove()">
                        关闭
                    </button>
                    ${failedCount > 0 ? `
                        <div class="dropdown">
                            <button class="btn fs-btn-secondary fs-dropdown-toggle">
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M21.21 15.89A10 10 0 1 1 8 2.83"></path>
                                    <path d="M22 12A10 10 0 0 0 12 2v10z"></path>
                                </svg>
                                操作
                            </button>
                            <div class="fs-dropdown-menu">
                                <div class="fs-dropdown-item" data-action="retry">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                        <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path>
                                        <path d="M3 3v5h5"></path>
                                    </svg>
                                    重试失败
                                </div>
                                <div class="fs-dropdown-item" data-action="export">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                                        <polyline points="7 10 12 15 17 10"></polyline>
                                        <line x1="12" y1="15" x2="12" y2="3"></line>
                                    </svg>
                                    导出失败链接
                                </div>
                            </div>
                        </div>
                    ` : ''}
                </div>
            </div>
            `;

            if (failedCount > 0) {
                const dropdownItems = modalOverlay.querySelectorAll('.fs-dropdown-item');
                dropdownItems.forEach(item => {
                    item.addEventListener('click', async () => {
                        const action = item.dataset.action;
                        modalOverlay.remove();

                        if (action === 'retry') {
                            this.addAndRunTask('retry', {fileList: result.failed});
                        } else if (action === 'export') {
                            const shareLinkResult = this.shareLinkManager.buildShareLink(result.failed, result.commonPath || '', false);
                            this.showCopyModal(shareLinkResult[2], shareLinkResult[3] || [], "导出失败链接");
                        }
                    });
                });
            }

            modalOverlay.addEventListener('click', (e) => {
                if (e.target === modalOverlay) modalOverlay.remove();
            });

            document.body.appendChild(modalOverlay);
        }

        /**
         * 显示提示窗
         * @param {string} type - 提示类型: 'success' | 'error'
         * @param {string} title - 标题
         * @param {string} message - 消息内容
         * @param {Object} options - 配置选项
         * @param {string} options.confirmText - 确认按钮文字
         * @param {Function} options.onConfirm - 确认回调
         * @param {boolean} options.showCancel - 是否显示取消按钮
         * @param {string} options.cancelText - 取消按钮文字
         * @param {Function} options.onCancel - 取消回调
         * @param {number} options.autoClose - 自动关闭时间(毫秒)
         */
        async showAlertModal(type, title, message, options = {}) {
            const {
                confirmText = '确定',
                onConfirm = null,
                showCancel = false,
                cancelText = '取消',
                onCancel = null,
                autoClose = 0
            } = options;

            // 定义图标和颜色
            const iconConfig = {
                success: {
                    icon: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                    <polyline points="22 4 12 14.01 9 11.01"></polyline>
                    </svg>`,
                    color: 'var(--secondary-color)',
                    bgColor: 'rgba(16, 185, 129, 0.1)',
                    borderColor: 'rgba(16, 185, 129, 0.2)'
                }, error: {
                    icon: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="15" y1="9" x2="9" y2="15"></line>
                    <line x1="9" y1="9" x2="15" y2="15"></line>
                    </svg>`,
                    color: 'var(--danger-color)',
                    bgColor: 'rgba(239, 68, 68, 0.1)',
                    borderColor: 'rgba(239, 68, 68, 0.2)'
                }, warning: {
                    icon: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                    <line x1="12" y1="9" x2="12" y2="13"></line>
                    <line x1="12" y1="17" x2="12.01" y2="17"></line>
                    </svg>`,
                    color: 'var(--warning-color)',
                    bgColor: 'rgba(245, 158, 11, 0.1)',
                    borderColor: 'rgba(245, 158, 11, 0.2)'
                }, info: {
                    icon: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="12" y1="16" x2="12" y2="12"></line>
                    <line x1="12" y1="8" x2="12.01" y2="8"></line>
                    </svg>`,
                    color: 'var(--info-color)',
                    bgColor: 'rgba(59, 130, 246, 0.1)',
                    borderColor: 'rgba(59, 130, 246, 0.2)'
                }
            };

            const config = iconConfig[type] || iconConfig.success;

            const modalOverlay = document.createElement('div');
            modalOverlay.className = 'fs-modal-overlay';
            modalOverlay.innerHTML = `
                <div class="modal" style="max-width: 420px;">
                    <div class="fs-modal-header" style="border-bottom: none; padding-bottom: 0;">
                        <div class="fs-modal-title" style="justify-content: center; gap: 12px;">
                            <div style="width: 48px; height: 48px; border-radius: 50%; 
                                background: ${config.bgColor}; border: 1px solid ${config.borderColor};
                                display: flex; align-items: center; justify-content: center;
                                color: ${config.color};">
                                ${config.icon}
                            </div>
                        </div>
                        <button class="fs-modal-close" onclick="this.closest('.fs-modal-overlay').remove()">
                            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <line x1="18" y1="6" x2="6" y2="18"></line>
                                <line x1="6" y1="6" x2="18" y2="18"></line>
                            </svg>
                        </button>
                    </div>
                    <div class="fs-modal-content" style="text-align: center; padding-top: 8px;">
                        <h3 style="margin: 0 0 12px 0; font-size: 18px; font-weight: 600; color: var(--text-primary);">
                            ${title}
                        </h3>
                        <div style="color: var(--text-secondary); font-size: 14px; line-height: 1.5; 
                            margin-bottom: 24px; word-break: break-all;">
                            ${message}
                        </div>
                    </div>
                    <div class="fs-modal-footer" style="justify-content: ${showCancel ? 'space-between' : 'center'};">
                        ${showCancel ? `
                            <button class="btn fs-btn-outline" id="cancelButton" style="min-width: 100px;">
                                ${cancelText}
                            </button>
                        ` : ''}
                        <button class="btn fs-btn-primary" id="confirmButton" 
                            style="min-width: 100px; background: ${config.color}; border-color: ${config.color};">
                            ${confirmText}
                        </button>
                    </div>
                </div>
            `;

            // 确认按钮事件
            const confirmButton = modalOverlay.querySelector('#confirmButton');
            confirmButton.addEventListener('click', () => {
                modalOverlay.remove();
                if (onConfirm && typeof onConfirm === 'function') {
                    onConfirm();
                }
            });

            // 取消按钮事件
            if (showCancel) {
                const cancelButton = modalOverlay.querySelector('#cancelButton');
                cancelButton.addEventListener('click', () => {
                    modalOverlay.remove();
                    if (onCancel && typeof onCancel === 'function') {
                        onCancel();
                    }
                });
            }

            // 点击遮罩关闭
            modalOverlay.addEventListener('click', (e) => {
                if (e.target === modalOverlay) {
                    modalOverlay.remove();
                    if (onCancel && typeof onCancel === 'function') {
                        onCancel();
                    }
                }
            });

            // 回车键确认
            const handleKeyPress = (e) => {
                if (e.key === 'Enter') {
                    modalOverlay.remove();
                    if (onConfirm && typeof onConfirm === 'function') {
                        onConfirm();
                    }
                } else if (e.key === 'Escape') {
                    modalOverlay.remove();
                    if (onCancel && typeof onCancel === 'function') {
                        onCancel();
                    }
                }
            };
            document.addEventListener('keydown', handleKeyPress);

            // 自动关闭
            if (autoClose > 0) {
                setTimeout(() => {
                    if (modalOverlay.parentNode) {
                        modalOverlay.remove();
                        if (onConfirm && typeof onConfirm === 'function') {
                            onConfirm();
                        }
                    }
                }, autoClose);
            }

            // 移除时清理事件监听
            const originalRemove = modalOverlay.remove;
            modalOverlay.remove = function () {
                document.removeEventListener('keydown', handleKeyPress);
                originalRemove.call(this);
            };

            document.body.appendChild(modalOverlay);

            // 自动聚焦确认按钮
            setTimeout(() => {
                confirmButton.focus();
            }, 100);
        }

        /*
            * 启动轮询刷新进度框
        */
        startRollPolling(title) {
            this.updateProgressModal(title, 0, "准备中...");
            this.shareLinkManager.progress = 0;
            return setInterval(() => {
                this.updateProgressModal(title, this.shareLinkManager.progress, this.shareLinkManager.progressDesc, this.taskList.length);
            }, 100);
        }

        /**
         *  停止轮询更新进度
         * @param {} poll
         */
        stopRollPolling(poll) {
            clearInterval(poll);
            this.hideProgressModal();
        }

        /**
         * 任务函数 - 启动从输入的内容解析并保存秒传链接，UI层面的保存入口，retry为是可以重试失败的文件
         * @param {*} content - 输入内容（秒传链接/JSON）
         */
        async launchSaveLink(content, retry = false) {
            const poll = this.startRollPolling("保存秒传链接");
            let saveResult;
            if (!retry) {
                saveResult = await this.shareLinkManager.saveShareLink(content);
            } else {
                saveResult = await this.shareLinkManager.retrySaveFailed(content);
            }
            // 清除任务取消标志
            this.shareLinkManager.taskCancel = false;
            this.stopRollPolling(poll);
            this.showSaveResultsModal(saveResult[2]);
            this.renewWebPageList();
            this.showToast(saveResult[0] ? "保存成功" : "保存失败", saveResult[0] ? 'success' : 'error');
        }

        async launchSaveSecondaryLink(content) {
            const poll = this.startRollPolling("保存秒传链接");
            let saveResult = await this.shareLinkManager.saveSecondaryShareLink(content, this.seedFilePathId);
            this.shareLinkManager.taskCancel = false;
            this.stopRollPolling(poll);
            if (!saveResult[0]) {
                this.showToast("保存失败 " + saveResult[1], 'error');
                this.showAlertModal('error', '保存失败', saveResult[1]);
                return;
            }
            this.showSaveResultsModal(saveResult[2]);
            this.renewWebPageList();
            this.showToast(saveResult[0] ? "保存成功" : "保存失败", saveResult[0] ? 'success' : 'error');

        }

        /**
         * 任务函数 - 启动从仅包含秒传链接文本内容保存秒传链接，UI层面的保存入口
         * @param {string} linkText
         * @param {string} fileName
         */
        async launchSaveLinkOnlyText(linkText, fileName) {
            // 链接格式校验
            const textType = this.shareLinkManager.linkChecker(linkText);
            if (!textType[0]) {
                this.showAlertModal('warning', '格式错误', '秒传链接格式无法识别，链接仍将被保存！');
            }
            const poll = this.startRollPolling("保存秒传链接");
            const saveResult = await this.shareLinkManager.saveShareLinkOnlyText(linkText, fileName);
            this.stopRollPolling(poll);
            this.showAlertModal(saveResult[0] ? 'success' : 'error', saveResult[0] ? '保存成功' : '保存失败', saveResult[1]);
            this.renewWebPageList();
            this.showToast(saveResult ? "保存成功" : "保存失败", saveResult ? 'success' : 'error');
        }


        /**
         * 任务函数 - 启动转换秒传链接格式，UI层面的转换入口
         * @param {string} content - 输入内容（秒传链接/JSON）
         */
        async launchConvert(content) {
            // 可以利用现有的复制模态框显示结果，要先转换成文本链接
            // if (this.shareLinkManager.)
            const textType = this.shareLinkManager.linkChecker(content);
            let shareLink;
            if (!textType[0]) {
                this.showAlertModal('error', '格式错误', '无法识别的秒传链接格式。');
                return;
            }
            if (textType[2] === 'json') {
                shareLink = this.shareLinkManager.jsonToTextShareLink(content)[2];
            } else if (textType[2] === 'text') {
                shareLink = this.shareLinkManager.textShareLinkToJson(content)[2];
                // shareLink = JSON.stringify(shareLinkDict, null, 2);
            }
            this.showCopyModal(shareLink, []);
        }

        async launchSaveFromFile(fileSelectInfo) {
            const selectedRowKeys = fileSelectInfo.selectedRowKeys;
            if (!selectedRowKeys || selectedRowKeys.length === 0) {
                this.showToast("没有选择文件", 'warning');
                return;
            }
            if (selectedRowKeys.length > 1) {
                this.showToast("暂时只能选择单个文件", 'warning');
                return;
            }
            const file = selectedRowKeys[0];
            // 先展开对话框
            this.updateProgressModal("读取文件中...", 0, "请稍候...");
            const fileContentRes = await this.shareLinkManager.getFileContentAsText(file);
            if (!fileContentRes[0]) {
                this.showToast("读取文件失败", 'error');
                return;
            }
            const content = fileContentRes[2];
            // 校验格式
            const textType = this.shareLinkManager.linkChecker(content);
            if (!textType[0]) {
                this.showAlertModal('error', '格式错误', '无法识别的秒传链接格式。');
                return;
            }
            // 启动保存
            this.launchSaveLink(content);
        }

        /**
         * 模拟点击刷新按钮，刷新页面文件列表
         */
        renewWebPageList() {
            // 刷新页面文件列表
            const renewButton = document.querySelector('.layout-operate-icon.mfy-tooltip svg');
            if (renewButton) {
                const clickEvent = new MouseEvent('click', {
                    bubbles: true, cancelable: true
                });
                renewButton.dispatchEvent(clickEvent);
            }
        }

        /**
         * 显示输入模态框
         */
        async showInputModal(saveTask = 'save', canOnlyLink = true, buttonText = '保存') {
            const modalOverlay = document.createElement('div');
            modalOverlay.className = 'fs-modal-overlay';
            modalOverlay.innerHTML = `
            <div class="modal" style="max-width: 500px;">
                <div class="fs-modal-header">
                    <div class="fs-modal-title">
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                            <polyline points="14 2 14 8 20 8"></polyline>
                            <line x1="16" y1="13" x2="8" y2="13"></line>
                            <line x1="16" y1="17" x2="8" y2="17"></line>
                            <polyline points="10 9 9 9 8 9"></polyline>
                        </svg>
                        保存秒传链接
                    </div>
                    <button class="fs-modal-close" onclick="this.closest('.fs-modal-overlay').remove()">
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </button>
                </div>
                <div class="fs-modal-content">
                    <textarea id="saveText" placeholder="请输入或粘贴秒传链接，或将JSON文件拖拽到此处..."></textarea>
                </div>
                <div class="fs-modal-footer">
                    <button class="btn fs-btn-secondary" id="saveButton">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
                            <polyline points="17 21 17 13 7 13 7 21"></polyline>
                            <polyline points="7 3 7 8 15 8"></polyline>
                        </svg>
                    ${buttonText}
                    </button>
                    ${canOnlyLink ? `
                    <button class="btn fs-btn-primary" id="saveButtonOnlyLink">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
                            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
                            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
                        </svg>
                        仅保存链接
                    </button>
                    ` : ''}
                    <button class="btn fs-btn-outline" id="selectFileButton">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path>
                            <polyline points="13 2 13 9 20 9"></polyline>
                        </svg>
                        选择文件
                    </button>
                    <input type="file" class="fs-file-input" id="jsonFileInput" accept=".">
                </div>
            </div>
            `;
            const textarea = modalOverlay.querySelector('#saveText');
            const fileInput = modalOverlay.querySelector('#jsonFileInput');
            const selectFileBtn = modalOverlay.querySelector('#selectFileButton');

            this.setupFileDropAndInput(textarea, fileInput);

            selectFileBtn.addEventListener('click', () => {
                fileInput.click();
            });

            // 保存按钮事件绑定
            modalOverlay.querySelector('#saveButton').addEventListener('click', async () => {
                const content = textarea.value.trim();
                if (!content) {
                    this.showToast("请输入秒传链接或导入JSON文件", 'warning');
                    return;
                }
                modalOverlay.remove();
                this.addAndRunTask(saveTask, {content});
            });

            if (canOnlyLink) {
                // 仅保存链接按钮事件绑定
                modalOverlay.querySelector('#saveButtonOnlyLink').addEventListener('click', async () => {
                    const content = textarea.value.trim();
                    if (!content) {
                        this.showToast("请输入秒传链接或导入JSON文件", 'warning');
                        return;
                    }
                    modalOverlay.remove();
                    this.addAndRunTask('saveOnlyLink', {content});
                });
            }


            modalOverlay.addEventListener('click', (e) => {
                if (e.target === modalOverlay) modalOverlay.remove();
            });


            document.body.appendChild(modalOverlay);

            setTimeout(() => {
                if (textarea) textarea.focus();
            }, 100);
        }

        // 处理文件拖拽和读取
        setupFileDropAndInput(textarea, fileInput) {
            // 拖拽事件
            textarea.addEventListener('dragover', (e) => {
                e.preventDefault();
                textarea.classList.add('drag-over');
            });

            textarea.addEventListener('dragleave', (e) => {
                e.preventDefault();
                textarea.classList.remove('drag-over');
            });

            textarea.addEventListener('drop', (e) => {
                e.preventDefault();
                textarea.classList.remove('drag-over');

                const files = e.dataTransfer.files;
                if (files.length > 0) {
                    this.readJsonFile(files[0], textarea);
                }
            });

            // 文件选择事件
            fileInput.addEventListener('change', (e) => {
                const files = e.target.files;
                if (files.length > 0) {
                    this.readJsonFile(files[0], textarea);
                }
            });
        }

        /**
         * 读取文件并将内容填充到文本区域
         * @param {*} file - 要读取的文件
         * @param {*} textarea - 目标文本区域
         * @returns
         */
        readJsonFile(file, textarea) {
            // 不再限制文件类型

            // if (!file.name.toLowerCase().endsWith('.json')) {
            //     this.showToast('请选择JSON文件', 'warning');
            //     return;
            // }

            // 限制文件大小
            if (file.size > this.maxTextFileSize) {
                this.showToast(`文件过大，最大支持 ${this.maxTextFileSize / (1024 * 1024)} MB，请检查是否选错文件`, 'error');
                this.showAlertModal('error', '文件过大', `所选文件大小为 ${(file.size / (1024 * 1024)).toFixed(2)} MB，超过最大支持 ${(this.maxTextFileSize / (1024 * 1024))} MB。请检查是否选错文件。
                如果需要导入更大文件，请修改允许的最大值`);
                return;
            }

            const reader = new FileReader();
            reader.onload = (e) => {
                textarea.value = e.target.result;
                this.showToast('文件导入成功 ✅', 'success');
            };
            reader.readAsText(file);
        }

        /**
         * 解析、添加并触发任务
         * @param taskType - 任务类型（generate/save/retry等）
         * @param params - 任务参数
         */
        addAndRunTask(taskType, params = {}) {
            const taskConfig = this.taskHandlers[taskType];

            if (!taskConfig) {
                console.warn(`未知的 taskType: ${taskType}`);
                this.showToast(`未知的任务类型: ${taskType}`, 'error');
                return;
            }

            const taskData = taskConfig.addTask.call(this, params);
            if (!taskData) return;

            const taskId = ++this.taskIdCounter;
            const task = {id: taskId, ...taskData};
            this.taskList.push(task);
            this.runNextTask();
        }

        /**
         * 队列 - 运行下一个任务
         * @returns {null|void}
         */
        runNextTask() {
            if (this.isTaskRunning) return this.showToast("已添加到队列，稍后执行", 'info');
            if (this.taskList.length === 0) return null;
            // 找到第一个未执行的任务
            const task = this.taskList.find(t => !this.currentTask || t.id !== this.currentTask.id);
            if (!task) return null;
            // 标记当前任务
            this.currentTask = task;
            const taskConfig = this.taskHandlers[task.type];
            // 执行任务
            setTimeout(async () => {
                this.isTaskRunning = true;
                if (taskConfig && taskConfig.handler) {
                    try {
                        await taskConfig.handler.call(this, task);
                    } catch (error) {
                        console.error(`任务${task.id}执行失败:`, error);
                        this.showAlertModal('error', '任务执行失败', `任务${task.id}执行过程中出现错误: ${error.message}`);
                        this.showToast(`任务${task.id}执行失败: ${error.message}`, 'error');
                    }
                } else {
                    this.showToast(`未知的任务类型: ${task.type}`, 'error');
                }
                this.isTaskRunning = false;
                // 任务完成，从列表中移除
                this.taskList = this.taskList.filter(t => t.id !== task.id);
                this.currentTask = null;
                this.runNextTask();
            }, 100);
            this.showToast(`任务${task.id}开始执行...`, 'info');
        }

        /** 任务取消
         * @returns {boolean}
         */
        cancelCurrentTask() {
            this.shareLinkManager.taskCancel = true;
            return true;
        }


        addButton(features, options = {}) {
            const buttonExist = document.querySelector('.fs-mfy-button-container');
            if (buttonExist) return;

            const container = document.querySelector('.home-operator-button-group');
            if (!container) return;

            const btnContainer = document.createElement('div');
            btnContainer.className = 'fs-mfy-button-container';

            const btn = document.createElement('button');
            // ant-btn css-1n9kme6 ant-btn-primary ant-btn-variant-solid ant-dropdown-trigger mfy-button upload-button
            btn.className = 'ant-btn css-1n9kme6 ant-btn-primary ant-btn-variant-solid ant-dropdown-trigger mfy-button upload-button fs-mfy-button upload-button'; // 利用现有样式
            btn.style = "background-color: #5ebf70;";
            btn.innerHTML = `${this.iconLibrary.transfer}<span>${options.buttonText || '秒传'}</span>`;

            const dropdown = document.createElement('div');
            dropdown.className = 'fs-mfy-dropdown';

            // 根据功能列表创建下拉项
            features.forEach(feature => {
                const icon = this.iconLibrary[feature.iconKey] || feature.iconKey || '';
                const itemElement = document.createElement('div');
                itemElement.className = 'fs-mfy-dropdown-item';
                itemElement.innerHTML = `${icon}${feature.text}`;

                itemElement.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    if (feature.handler && typeof feature.handler === 'function') {
                        await feature.handler();
                    }
                    dropdown.style.display = 'none';
                });

                dropdown.appendChild(itemElement);
            });

            btnContainer.appendChild(btn);
            btnContainer.appendChild(dropdown);
            container.insertBefore(btnContainer, container.firstChild);

            // 下拉菜单交互逻辑
            btnContainer.addEventListener('mouseenter', () => {
                dropdown.style.display = 'block';
            });

            btnContainer.addEventListener('mouseleave', (e) => {
                setTimeout(() => {
                    if (!btnContainer.matches(':hover') && !dropdown.matches(':hover')) {
                        dropdown.style.display = 'none';
                    }
                }, 300);
            });
        }

    }

    class logger {
        constructor(console) {
            this.console = console;
            this.debugMode = GlobalConfig.DEBUGMODE;
        }

        log(...args) {
            // 非调试模式不输出
            if (!GlobalConfig.DEBUGMODE) return;
            this.console.log(...args);
        }

        error(...args) {
            this.console.error(...args);
        }

        warn(...args) {
            this.console.warn(...args);
        }

        info(...args) {
            this.console.info(...args);
        }
    }

    /**
     * 初始化设置，从 GM 存储中加载
     */
    function initSettings() {
        const Settings = GM_getValue('fastlink_settings', null);

        if (Settings) {
            try {
                GlobalConfig = {
                    ...GlobalConfig, ...Settings
                };
            } catch (e) {
                console.error("加载设置失败:", e);
                // 失败则重置设置
                saveSettings({});
            }
        }
    }

    function saveSettings(settings) {
        // 应用到GlobalConfig
        GlobalConfig = {
            ...GlobalConfig, ...settings
        };
        GM_setValue('fastlink_settings', settings);
    }

    function deleteSettings() {
        GM_setValue('fastlink_settings', null);
        GM_setValue('fastlink_first_time', true);
    }

    function isFirstTime() {
        const firstTime = GM_getValue('fastlink_first_time', true);
        if (firstTime) {
            GM_setValue('fastlink_first_time', false);
        }
        return firstTime;
    }

    const is123PanHost = /(^|\.)123pan\.(com|cn)$/i.test(window.location.hostname);
    if (!is123PanHost) {
        return;
    }

    initSettings();
    // 创建 logger 实例, 并覆盖全局 console
    var console = new logger(window.console);
    const apiClient = new PanApiClient();
    const selector = new TableRowSelector();
    const shareLinkManager = new ShareLinkManager(apiClient);
    const uiManager = new UiManager(shareLinkManager, selector, isFirstTime());

    selector.init();
    uiManager.init();

    if (GlobalConfig.DEBUGMODE) {
        window._apiClient = apiClient;
        window._shareLinkManager = shareLinkManager;
        window._selector = selector;
        window._uiManager = uiManager;
    }

})();

// BEGIN integrated quark/tianyi JSON generator from 123云盘秒传JSON生成器（夸克网盘/天翼云盘） v1.0.4
(function () {
    "use strict";

    const utils = {
        getCachedCookie() {
            return GM_getValue("quark_cookie", "");
        },

        saveCookie(cookie) {
            GM_setValue("quark_cookie", cookie);
        },

        getCookie(name) {
            const value = `; ${document.cookie}`;
            const parts = value.split(`; ${name}=`);
            if (parts.length === 2) return parts.pop().split(";").shift();
            return null;
        },

        showCookieInputDialog(onSave, currentCookie = "") {
            const dialog = document.createElement("div");
            dialog.id = "quark-cookie-input-dialog";
            dialog.innerHTML = `
        <div style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); z-index: 10000; display: flex; align-items: center; justify-content: center;">
          <div style="background: white; padding: 30px; border-radius: 8px; width: 80%; max-width: 800px; max-height: 80vh; display: flex; flex-direction: column;">
            <div style="font-size: 18px; font-weight: bold; margin-bottom: 15px;">设置夸克网盘Cookie</div>
            <div style="font-size: 14px; color: #666; margin-bottom: 15px;">
              请打开浏览器开发者工具(F12) → Network → 找到任意请求 → 复制完整的Cookie值<br/>
              <strong>必须包含：__puus、__pus、ctoken 等关键Cookie</strong>
            </div>
            <textarea id="quark-cookie-input"
              placeholder="粘贴完整的Cookie字符串，例如：ctoken=xxx; __puus=xxx; __pus=xxx; ..."
              style="flex: 1; min-height: 200px; padding: 10px; border: 1px solid #d9d9d9; border-radius: 4px; font-family: monospace; font-size: 12px; resize: vertical;">${currentCookie}</textarea>
            <div style="display: flex; gap: 10px; justify-content: flex-end; margin-top: 15px;">
              <button id="quark-cookie-save-btn" style="padding: 8px 20px; background: #0d53ff; color: white; border: none; border-radius: 4px; cursor: pointer;">保存</button>
              <button id="quark-cookie-cancel-btn" style="padding: 8px 20px; background: #d9d9d9; color: #333; border: none; border-radius: 4px; cursor: pointer;">取消</button>
            </div>
          </div>
        </div>
      `;
            document.body.appendChild(dialog);

            document.getElementById("quark-cookie-save-btn").onclick = () => {
                const cookie = document
                    .getElementById("quark-cookie-input")
                    .value.trim();
                if (!cookie) {
                    alert("Cookie不能为空");
                    return;
                }
                this.saveCookie(cookie);
                dialog.remove();
                GM_notification({
                    text: "Cookie已保存",
                    timeout: 2000,
                });
                if (onSave) {
                    onSave(cookie);
                }
            };

            document.getElementById("quark-cookie-cancel-btn").onclick = () => {
                dialog.remove();
            };
        },

        sleep(ms) {
            return new Promise((resolve) => setTimeout(resolve, ms));
        },

        findReact(dom, traverseUp = 0) {
            let key = Object.keys(dom).find((key) => {
                return (
                    key.startsWith("__reactFiber$") ||
                    key.startsWith("__reactInternalInstance$")
                );
            });

            let domFiber = dom[key];

            if (domFiber == null) {
                return null;
            }

            if (domFiber._currentElement) {
                let compFiber = domFiber._currentElement._owner;
                for (let i = 0; i < traverseUp; i++) {
                    compFiber = compFiber._currentElement._owner;
                }
                return compFiber._instance;
            }

            const GetCompFiber = (fiber) => {
                let parentFiber = fiber.return;
                while (typeof parentFiber.type === "string") {
                    parentFiber = parentFiber.return;
                }
                return parentFiber;
            };

            let compFiber = GetCompFiber(domFiber);
            for (let i = 0; i < traverseUp; i++) {
                compFiber = GetCompFiber(compFiber);
            }

            return compFiber.stateNode || compFiber;
        },

        findVue(dom, traverseUp = 0) {
            let i = 0;
            let el = dom;
            while (i < traverseUp) {
                if (!el) return null;
                el = el.parentElement;
                i++;
            }
            return el?.__vue__;
        },

        getCurrentPath() {
            try {
                const urlParams = new URLSearchParams(window.location.search);
                const dirFid = urlParams.get("dir_fid");

                if (!dirFid || dirFid === "0") {
                    return "";
                }

                const breadcrumb = document.querySelector(".breadcrumb-list");
                if (breadcrumb) {
                    const items = breadcrumb.querySelectorAll(".breadcrumb-item");
                    const pathParts = [];

                    for (let i = 1; i < items.length; i++) {
                        const text = items[i].textContent.trim();
                        if (text) {
                            pathParts.push(text);
                        }
                    }

                    return pathParts.join("/");
                }

                return "";
            } catch (e) {
                return "";
            }
        },

        getSelectedList() {
            try {
                const fileListDom = document.getElementsByClassName("file-list")[0];

                if (!fileListDom) {
                    return [];
                }

                const reactObj = this.findReact(fileListDom);

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
        },

        post(url, data, headers = {}) {
            return new Promise((resolve, reject) => {
                const requestData = JSON.stringify(data);
                const QUARK_UA =
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) quark-cloud-drive/2.5.20 Chrome/100.0.4896.160 Electron/18.3.5.4-b478491100 Safari/537.36 Channel/pckk_other_ch";
                const defaultHeaders = {
                    "Content-Type": "application/json;charset=utf-8",
                    "User-Agent": QUARK_UA,
                    Origin: location.origin,
                    Referer: `${location.origin}/`,
                    Dnt: "",
                    "Cache-Control": "no-cache",
                    Pragma: "no-cache",
                    Expires: "0",
                };

                GM_xmlhttpRequest({
                    method: "POST",
                    url: url,
                    headers: {...defaultHeaders, ...headers},
                    data: requestData,
                    onload: function (response) {
                        try {
                            const result = JSON.parse(response.responseText);
                            resolve(result);
                        } catch (e) {
                            reject(new Error("响应解析失败"));
                        }
                    },
                    onerror: function (error) {
                        reject(new Error("网络请求失败"));
                    },
                });
            });
        },

        get(url, headers = {}) {
            return new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: "GET",
                    url: url,
                    headers: headers,
                    onload: function (response) {
                        if (response.status >= 200 && response.status < 300) {
                            resolve(response.responseText);
                        } else {
                            reject(new Error(`请求失败: ${response.status}`));
                        }
                    },
                    onerror: function (error) {
                        reject(new Error("网络请求失败"));
                    },
                });
            });
        },

        async getFolderFiles(folderId, folderPath = "", onProgress) {
            const API_URL =
                "https://drive-pc.quark.cn/1/clouddrive/file/sort?pr=ucpro&fr=pc";
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
                            try {
                                resolve(JSON.parse(response.responseText));
                            } catch (e) {
                                reject(new Error("响应解析失败"));
                            }
                        },
                        onerror: () => reject(new Error("网络请求失败")),
                    });
                });

                if (result?.code !== 0 || !result?.data?.list) {
                    break;
                }

                const items = result.data.list;
                for (const item of items) {
                    const itemPath = folderPath
                        ? `${folderPath}/${item.file_name}`
                        : item.file_name;

                    if (item.dir) {
                        const subFiles = await this.getFolderFiles(
                            item.fid,
                            itemPath,
                            onProgress,
                        );
                        allFiles.push(...subFiles);
                    } else if (item.file) {
                        allFiles.push({...item, path: itemPath});
                        if (onProgress) {
                            onProgress();
                        }
                    }
                }

                if (items.length < pageSize) {
                    break;
                }
                page++;
            }

            return allFiles;
        },

        async getShareFolderFiles(shareId, stoken, folderId, folderPath = "") {
            const allFiles = [];
            let page = 1;
            const pageSize = 100;

            while (true) {
                const url = `https://pc-api.uc.cn/1/clouddrive/share/sharepage/detail?pwd_id=${shareId}&stoken=${encodeURIComponent(
                    stoken,
                )}&pdir_fid=${folderId}&_page=${page}&_size=${pageSize}&pr=ucpro&fr=pc`;

                const result = await new Promise((resolve, reject) => {
                    GM_xmlhttpRequest({
                        method: "GET",
                        url: url,
                        headers: {
                            Referer: "https://pan.quark.cn/",
                        },
                        onload: function (response) {
                            try {
                                resolve(JSON.parse(response.responseText));
                            } catch (e) {
                                reject(new Error("响应解析失败"));
                            }
                        },
                        onerror: () => reject(new Error("网络请求失败")),
                    });
                });

                if (result?.code !== 0 || !result?.data?.list) {
                    break;
                }

                const items = result.data.list;
                for (const item of items) {
                    const itemPath = folderPath
                        ? `${folderPath}/${item.file_name}`
                        : item.file_name;

                    if (item.dir) {
                        const subFiles = await this.getShareFolderFiles(
                            shareId,
                            stoken,
                            item.fid,
                            itemPath,
                        );
                        allFiles.push(...subFiles);
                    } else if (item.file) {
                        allFiles.push({...item, path: itemPath});
                    }
                }

                if (items.length < pageSize) {
                    break;
                }
                page++;
            }

            return allFiles;
        },

        async getShareToken(shareId, passcode = "", cookie = "") {
            const API_URL = "https://pc-api.uc.cn/1/clouddrive/share/sharepage/token";

            try {
                const result = await new Promise((resolve, reject) => {
                    GM_xmlhttpRequest({
                        method: "POST",
                        url: API_URL,
                        headers: {
                            "Content-Type": "application/json",
                            Cookie: cookie,
                            "User-Agent":
                                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                            Referer: "https://pan.quark.cn/",
                        },
                        data: JSON.stringify({
                            pwd_id: shareId,
                            passcode: passcode,
                        }),
                        onload: function (response) {
                            try {
                                resolve(JSON.parse(response.responseText));
                            } catch (e) {
                                reject(new Error("响应解析失败"));
                            }
                        },
                        onerror: () => reject(new Error("网络请求失败")),
                    });
                });

                if (result?.code === 31001) {
                    throw new Error("请先登录网盘");
                }
                if (result?.code !== 0) {
                    throw new Error(
                        `获取token失败，代码：${result.code}，消息：${result.message}`,
                    );
                }

                return {
                    stoken: result.data.stoken,
                    title: result.data.title || ""
                };
            } catch (error) {
                throw error;
            }
        },

        async getFilesWithMd5(fileList, onProgress) {
            const API_URL =
                "https://drive.quark.cn/1/clouddrive/file/download?pr=ucpro&fr=pc";
            const BATCH_SIZE = 15;

            const data = [];
            let processed = 0;
            const validFiles = fileList.filter((item) => item.file === true);

            const pathMap = {};
            validFiles.forEach((file) => {
                pathMap[file.fid] = file.path;
            });

            for (let i = 0; i < validFiles.length; i += BATCH_SIZE) {
                const batch = validFiles.slice(i, i + BATCH_SIZE);
                const fids = batch.map((item) => item.fid);

                try {
                    const result = await this.post(API_URL, {fids});

                    if (result?.code === 31001) {
                        throw new Error("请先登录网盘");
                    }
                    if (result?.code !== 0) {
                        throw new Error(
                            `获取链接失败，代码：${result.code}，消息：${result.message}`,
                        );
                    }

                    if (result?.data) {
                        const filesWithPath = result.data.map((file) => {
                            const newFile = {
                                ...file,
                                path: pathMap[file.fid] || file.file_name,
                            };

                            let md5 = newFile.md5 || newFile.hash || newFile.etag || "";
                            md5 = this.decodeMd5(md5);

                            if (md5) {
                                newFile.md5 = md5;
                            }

                            return newFile;
                        });
                        data.push(...filesWithPath);
                    }

                    processed += batch.length;
                    if (onProgress) {
                        onProgress(processed, validFiles.length);
                    }

                    await this.sleep(1000);
                } catch (error) {
                    throw error;
                }
            }

            return data;
        },

        async scanQuarkShareFiles(
            shareId,
            stoken,
            cookie,
            parentFileId = 0,
            path = "",
            recursive = true
        ) {
            const fileItems = [];
            let page = 1;

            while (true) {
                const url = `https://pc-api.uc.cn/1/clouddrive/share/sharepage/detail?pwd_id=${shareId}&stoken=${encodeURIComponent(
                    stoken,
                )}&pdir_fid=${parentFileId}&_page=${page}&_size=100&pr=ucpro&fr=pc`;

                const result = await new Promise((resolve, reject) => {
                    GM_xmlhttpRequest({
                        method: "GET",
                        url: url,
                        headers: {
                            Cookie: cookie,
                            "User-Agent":
                                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36 Edg/137.0.0.0",
                            Referer: "https://pan.quark.cn/",
                        },
                        onload: function (response) {
                            try {
                                resolve(JSON.parse(response.responseText));
                            } catch (e) {
                                reject(new Error("响应解析失败"));
                            }
                        },
                        onerror: () => reject(new Error("网络请求失败")),
                    });
                });

                if (result.code !== 0 || !result.data?.list) break;

                for (const item of result.data.list) {
                    const itemPath = path ? `${path}/${item.file_name}` : item.file_name;

                    if (item.dir) {
                        if (recursive) {
                            const subFiles = await this.scanQuarkShareFiles(
                                shareId,
                                stoken,
                                cookie,
                                item.fid,
                                itemPath,
                                true
                            );
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

        async batchGetShareFilesMd5(
            shareId,
            stoken,
            cookie,
            fileItems,
            onProgress,
        ) {
            const md5Map = {};
            const batchSize = 10;
            let totalProcessed = 0;


            for (let i = 0; i < fileItems.length; i += batchSize) {
                const batch = fileItems.slice(i, i + batchSize);
                const fids = batch.map((item) => item.fid);
                const tokens = batch.map((item) => item.token);


                try {
                    const requestBody = {
                        fids,
                        pwd_id: shareId,
                        stoken,
                        fids_token: tokens,
                    };


                    const md5Result = await new Promise((resolve, reject) => {
                        GM_xmlhttpRequest({
                            method: "POST",
                            url: `https://pc-api.uc.cn/1/clouddrive/file/download?pr=ucpro&fr=pc&uc_param_str=&__dt=${Math.floor(Math.random() * 4 + 1) * 60 * 1000}&__t=${Date.now()}`,
                            headers: {
                                "Content-Type": "application/json",
                                Cookie: cookie,
                                "User-Agent":
                                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) quark-cloud-drive/3.14.2 Chrome/112.0.5615.165 Electron/24.1.3.8 Safari/537.36 Channel/pckk_other_ch",
                                Referer: "https://pan.quark.cn/",
                                Accept: "application/json, text/plain, */*",
                                Origin: "https://pan.quark.cn",
                            },
                            data: JSON.stringify(requestBody),
                            onload: function (response) {
                                try {
                                    const parsed = JSON.parse(response.responseText);
                                    resolve(parsed);
                                } catch (e) {
                                    resolve({code: -1, message: "解析失败"});
                                }
                            },
                            onerror: (error) => {
                                resolve({code: -1, message: "网络错误"});
                            },
                        });
                    });


                    if (md5Result.code === 0 && md5Result.data) {
                        const dataList = Array.isArray(md5Result.data)
                            ? md5Result.data
                            : [md5Result.data];

                        dataList.forEach((item, idx) => {
                            const fid = fids[idx];
                            if (!fid) return;

                            let md5 = item.md5 || item.hash || "";
                            md5 = utils.decodeMd5(md5);

                            md5Map[fid] = md5;
                        });
                    } else {
                        fids.forEach((fid) => (md5Map[fid] = ""));
                    }
                } catch (e) {
                    fids.forEach((fid) => (md5Map[fid] = ""));
                }

                totalProcessed += batch.length;
                if (onProgress) {
                    onProgress(totalProcessed, fileItems.length);
                }

                await this.sleep(1000);
            }

            return md5Map;
        },

        generateRapidTransferJson(filesData) {
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
        },

        showLoadingDialog(title, message) {
            const existingDialog = document.getElementById(
                "quark-json-loading-dialog",
            );
            if (existingDialog) {
                existingDialog.remove();
            }

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
        },

        updateProgress(processed, total, phase = "获取MD5") {
            const messageEl = document.getElementById("quark-json-loading-message");
            const detailEl = document.getElementById("quark-json-loading-detail");
            const progressBar = document.getElementById("quark-json-progress-bar");
            const progressText = document.getElementById("quark-json-progress-text");

            if (messageEl) {
                messageEl.textContent = `正在${phase}...`;
            }
            if (detailEl) {
                detailEl.textContent = `已处理 ${processed} / ${total} 个文件`;
            }
            if (progressBar) {
                const percent = total > 0 ? ((processed / total) * 100).toFixed(1) : 0;
                progressBar.style.width = `${percent}%`;
            }
            if (progressText) {
                const percent = total > 0 ? ((processed / total) * 100).toFixed(1) : 0;
                progressText.textContent = `${percent}%`;
            }
        },

        updateScanProgress(count) {
            const messageEl = document.getElementById("quark-json-loading-message");
            const detailEl = document.getElementById("quark-json-loading-detail");
            if (messageEl) {
                messageEl.textContent = "正在扫描文件...";
            }
            if (detailEl) {
                detailEl.textContent = `已发现 ${count} 个文件`;
            }
        },

        updateScanComplete(total) {
            const messageEl = document.getElementById("quark-json-loading-message");
            const detailEl = document.getElementById("quark-json-loading-detail");
            if (messageEl) {
                messageEl.textContent = "扫描完成，准备获取MD5...";
            }
            if (detailEl) {
                detailEl.textContent = `共发现 ${total} 个文件`;
            }
        },

        closeLoadingDialog() {
            const dialog = document.getElementById("quark-json-loading-dialog");
            if (dialog) {
                dialog.remove();
            }
        },

        showResultDialog(json, shareTitle = "") {
            let currentJson = json;
            const updateJsonDisplay = () => {
                const jsonStr = JSON.stringify(currentJson, null, 2);
                const preEl = document.getElementById("quark-json-preview");
                if (preEl) {
                    preEl.textContent = jsonStr;
                }
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
                const newCommonPath = shareTitle ? shareTitle + "/" : "";
                currentJson = {...json, commonPath: newCommonPath};
                updateJsonDisplay();

                const checkbox = document.getElementById("quark-json-commonpath-checkbox");
                checkbox.onchange = () => {
                    if (checkbox.checked) {
                        currentJson = {...json, commonPath: newCommonPath};
                    } else {
                        currentJson = {...json, commonPath: ""};
                    }
                    updateJsonDisplay();
                };
            }

            document.getElementById("quark-json-copy-btn").onclick = () => {
                const jsonStr = updateJsonDisplay();
                GM_setClipboard(jsonStr);
                this.showToast("已复制到剪贴板");
            };

            document.getElementById("quark-json-download-btn").onclick = () => {
                const jsonStr = updateJsonDisplay();
                const blob = new Blob([jsonStr], {type: "application/json"});
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                const filename = (shareTitle ? shareTitle : "123link") + ".json";
                a.download = filename;
                a.click();
                URL.revokeObjectURL(url);
                this.showToast("下载已开始");
            };

            document.getElementById("quark-json-close-btn").onclick = () => {
                dialog.remove();
            };
        },

        showError(message, showCookieButton = false) {
            const dialog = document.createElement("div");
            dialog.id = "quark-json-error-dialog";
            dialog.innerHTML = `
        <div style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); z-index: 10001; display: flex; align-items: center; justify-content: center; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol', 'Noto Color Emoji';">
            <div style="background: white; padding: 24px; border-radius: 8px; width: 90%; max-width: 420px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); display: flex; flex-direction: column; align-items: center;">
                <div style="color: #ff4d4f; margin-bottom: 16px;">
                    <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" fill="currentColor" viewBox="0 0 16 16">
                        <path d="M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0zM5.354 4.646a.5.5 0 1 0-.708.708L7.293 8l-2.647 2.646a.5.5 0 0 0 .708.708L8 8.707l2.646 2.647a.5.5 0 0 0 .708-.708L8.707 8l2.647-2.646a.5.5 0 0 0-.708-.708L8 7.293 5.354 4.646z"/>
                    </svg>
                </div>
                <div style="font-size: 20px; font-weight: 600; margin-bottom: 8px; color: #333;">操作失败</div>
                <div style="font-size: 14px; color: #555; margin-bottom: 24px; text-align: center; white-space: pre-line;">${message}</div>
                <div style="display: flex; gap: 12px; justify-content: center; width: 100%;">
                    ${showCookieButton ? '<button id="quark-json-error-cookie-btn" style="flex: 1; padding: 10px 20px; background: #0d53ff; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: 500;">修改Cookie</button>' : ""}
                    <button id="quark-json-error-close-btn" style="flex: 1; padding: 10px 20px; background: #f0f0f0; color: #333; border: 1px solid #d9d9d9; border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: 500;">确定</button>
                </div>
            </div>
        </div>
    `;
            document.body.appendChild(dialog);

            if (showCookieButton) {
                document.getElementById("quark-json-error-cookie-btn").onclick = () => {
                    dialog.remove();
                    this.showCookieInputDialog(null, this.getCachedCookie());
                };
            }

            document.getElementById("quark-json-error-close-btn").onclick = () => {
                dialog.remove();
            };
        },

        showToast(message) {
            const existingToast = document.getElementById("quark-json-toast");
            if (existingToast) {
                existingToast.remove();
            }

            const toast = document.createElement("div");
            toast.id = "quark-json-toast";
            toast.textContent = message;
            toast.style.cssText = `
            position: fixed;
            top: 20px;
            left: 50%;
            transform: translateX(-50%);
            background-color: rgba(0, 0, 0, 0.75);
            color: white;
            padding: 12px 24px;
            border-radius: 25px;
            font-size: 14px;
            font-weight: 500;
            z-index: 10002;
            opacity: 0;
            transition: opacity 0.3s ease-in-out, top 0.3s ease-in-out;
        `;

            document.body.appendChild(toast);

            setTimeout(() => {
                toast.style.opacity = "1";
                toast.style.top = "40px";
            }, 10);

            setTimeout(() => {
                toast.style.opacity = "0";
                toast.style.top = "20px";
                setTimeout(() => {
                    toast.remove();
                }, 300);
            }, 2500);
        },

        showUpdateDialog() {
            const version = GM_info.script.version;
            const dialog = document.createElement("div");
            dialog.id = "quark-json-update-dialog";
            dialog.innerHTML = `
        <div style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); z-index: 10001; display: flex; align-items: center; justify-content: center; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol', 'Noto Color Emoji';">
            <div style="background: white; padding: 24px; border-radius: 8px; width: 90%; max-width: 500px; box-shadow: 0 4px 12px rgba(0,0,0,0.15);">
                <div style="font-size: 20px; font-weight: 600; margin-bottom: 16px; color: #333; text-align: center;">脚本更新 v${version}</div>
                <div style="font-size: 15px; color: #555; margin-bottom: 24px;">
                    <ul style="margin: 0; padding-left: 20px;">
                        <li style="margin-bottom: 10px;"><strong>修复</strong>：修复了夸克网盘个人文件和分享链接中Base64编码的MD5值无法正确解析的问题。</li>
                        <li style="margin-bottom: 10px;"><strong>优化</strong>：将MD5解码逻辑提取为独立工具函数，提高代码可维护性。</li>
                    </ul>
                </div>
                <div style="text-align: center;">
                    <button id="quark-json-update-close-btn" style="padding: 10px 30px; background: #0d53ff; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: 500;">我已知晓</button>
                </div>
            </div>
        </div>
    `;
            document.body.appendChild(dialog);

            document.getElementById("quark-json-update-close-btn").onclick = () => {
                dialog.remove();
            };
        },

        parseSize(sizeStr) {
            if (typeof sizeStr === "number") {
                return sizeStr;
            }
            if (typeof sizeStr !== "string") {
                return 0;
            }
            const sizeMatch = sizeStr.match(/^([\d.]+)\s*([a-z]+)/i);
            if (!sizeMatch) {
                const num = parseInt(sizeStr, 10);
                return isNaN(num) ? 0 : num;
            }
            const size = parseFloat(sizeMatch[1]);
            const unit = sizeMatch[2].toUpperCase();
            switch (unit) {
                case "G":
                case "GB":
                    return Math.round(size * 1024 * 1024 * 1024);
                case "M":
                case "MB":
                    return Math.round(size * 1024 * 1024);
                case "K":
                case "KB":
                    return Math.round(size * 1024);
                case "B":
                default:
                    return Math.round(size);
            }
        },

        decodeMd5(md5) {
            if (!md5 || !md5.includes("==")) {
                return md5 || "";
            }
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
        },
    };

    const tianyiService = {
        getSelectedFiles() {
            try {
                if (typeof unsafeWindow !== "undefined") {
                    let list;
                    if (/\/web\/share/.test(location.href)) {
                        list = unsafeWindow.shareUser?.getSelectedFileList();
                    } else {
                        list = unsafeWindow.file?.getSelectedFileList();
                    }
                    if (list && list.length > 0) {
                        return list;
                    }
                }
            } catch (e) {
                // ignore
            }

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

            if (selectedElements.length === 0) {
                return [];
            }

            selectedElements.forEach((itemEl) => {
                if (itemEl.__vue__) {
                    const vueInstance = itemEl.__vue__;
                    const fileData =
                        vueInstance.fileItem ||
                        vueInstance.fileInfo ||
                        vueInstance.item ||
                        vueInstance.file;
                    if (fileData) {
                        if (
                            !selectedItems.some(
                                (item) => item.fileId === (fileData.id || fileData.fileId),
                            )
                        ) {
                            const normalizedItem = {
                                fileId: fileData.id || fileData.fileId,
                                fileName: fileData.name || fileData.fileName,
                                isFolder: fileData.isFolder || fileData.fileCata === 2,
                                md5: fileData.md5,
                                size: fileData.size,
                            };
                            selectedItems.push(normalizedItem);
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

                const signParams = {
                    ...urlParams,
                    Timestamp: timestamp,
                    AppKey: appKey,
                };
                const signature = this.get189Signature(signParams);

                const url = `https://cloud.189.cn/api/open/file/listFiles.action?${new URLSearchParams(urlParams)}`;

                const text = await utils.get(url, {
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
                    files.push({
                        path: filePath,
                        etag: (file.md5 || "").toLowerCase(),
                        size: file.size,
                        fileId: file.id,
                    });
                    if (onProgress) onProgress();
                }

                for (const folder of folderList) {
                    const folderPath = path ? `${path}/${folder.name}` : folder.name;
                    const subFiles = await this.getPersonalFolderFiles(
                        folder.id,
                        folderPath,
                        onProgress,
                    );
                    files.push(...subFiles);
                }

                if (fileList.length + folderList.length < pageSize) break;
                pageNum++;
            }
            return files;
        },

        async getBaseShareInfo(shareUrl, sharePwd) {
            let match =
                shareUrl.match(/\/t\/([a-zA-Z0-9]+)/) ||
                shareUrl.match(/[?&]code=([a-zA-Z0-9]+)/);
            if (!match) throw new Error("无效的189网盘分享链接");

            const shareCode = match[1];
            let accessCode = sharePwd || "";

            if (!accessCode) {
                const cookieName = `share_${shareCode}`;
                const cookiePwd = utils.getCookie(cookieName);
                if (cookiePwd) {
                    accessCode = cookiePwd;
                } else {
                    try {
                        const decodedUrl = decodeURIComponent(shareUrl);
                        const pwdMatch = decodedUrl.match(
                            /[（(]访问码[：:]\s*([a-zA-Z0-9]+)/,
                        );
                        if (pwdMatch && pwdMatch[1]) {
                            accessCode = pwdMatch[1];
                        }
                    } catch (e) {
                        /* ignore decoding errors */
                    }
                }
            }

            let shareId = shareCode;

            if (accessCode) {
                const checkUrl = `https://cloud.189.cn/api/open/share/checkAccessCode.action?shareCode=${shareCode}&accessCode=${accessCode}`;
                try {
                    const checkText = await utils.get(checkUrl, {
                        Accept: "application/json;charset=UTF-8",
                        Referer: "https://cloud.189.cn/web/main/",
                    });
                    const checkData = JSON.parse(checkText);
                    if (checkData.shareId) shareId = checkData.shareId;
                } catch (e) {
                    /* ignore */
                }
            }

            const params = {shareCode, accessCode: accessCode};
            const timestamp = Date.now().toString();
            const appKey = "600100422";
            const signData = {...params, Timestamp: timestamp, AppKey: appKey};
            const signature = this.get189Signature(signData);
            const apiUrl = `https://cloud.189.cn/api/open/share/getShareInfoByCodeV2.action?${new URLSearchParams(params)}`;

            const text = await utils.get(apiUrl, {
                Accept: "application/json;charset=UTF-8",
                "Sign-Type": "1",
                Signature: signature,
                Timestamp: timestamp,
                AppKey: appKey,
                Referer: "https://cloud.189.cn/web/main/",
            });

            let data;
            try {
                data = JSON.parse(
                    text.replace(
                        /"(id|fileId|parentId|shareId)":"?(\d{15,})"?/g,
                        '"$1":"$2"',
                    ),
                );
            } catch (e) {
                throw new Error("解析分享信息失败");
            }

            if (data.res_code !== 0) {
                if (data.res_code === 40401 && !accessCode)
                    throw new Error("该分享需要提取码，请输入提取码");
                throw new Error(`获取分享信息失败: ${data.res_message || "未知错误"}`);
            }

            return {
                shareId: data.shareId || shareId,
                shareMode: data.shareMode || "0",
                accessCode: accessCode,
                shareCode: shareCode,
                title: data.fileName || ""
            };
        },

        async get189ShareFiles(
            shareId,
            shareDirFileId,
            fileId,
            path = "",
            shareMode = "0",
            accessCode = "",
            shareCode = "",
            onProgress = null,
        ) {
            const files = [];
            let page = 1;

            while (true) {
                const params = {
                    pageNum: page.toString(),
                    pageSize: "100",
                    fileId: fileId.toString(),
                    shareDirFileId: shareDirFileId.toString(),
                    isFolder: "true",
                    shareId: shareId.toString(),
                    shareMode: shareMode,
                    iconOption: "5",
                    orderBy: "lastOpTime",
                    descending: "true",
                    accessCode: accessCode || "",
                };
                const queryString = new URLSearchParams(params).toString();
                const url = `https://cloud.189.cn/api/open/share/listShareDir.action?${queryString}`;

                const headers = {
                    Accept: "application/json;charset=UTF-8",
                    Referer: "https://cloud.189.cn/web/main/",
                };
                if (shareCode && accessCode) {
                    headers["Cookie"] = `share_${shareCode}=${accessCode}`;
                }

                const text = await utils.get(url, headers);
                let data;
                try {
                    const fixedText = text.replace(
                        /"(id|fileId|parentId|shareId)":(\d{15,})/g,
                        '"$1":"$2"',
                    );
                    data = JSON.parse(fixedText);
                } catch (e) {
                    break;
                }

                if (data.res_code !== 0) {
                    if (data.res_code === "FileNotFound" && path) {
                        console.log(
                            `[189] 警告：子文件夹 "${path}" 访问失败，189网盘分享可能需要登录才能访问子文件夹`,
                        );
                    }
                    break;
                }

                const fileList = data.fileListAO?.fileList || [];
                const folderList = data.fileListAO?.folderList || [];

                for (const file of fileList) {
                    const filePath = path ? `${path}/${file.name}` : file.name;
                    files.push({
                        path: filePath,
                        etag: (file.md5 || "").toLowerCase(),
                        size: file.size,
                    });
                    if (onProgress) onProgress();
                }

                for (const folder of folderList) {
                    const folderPath = path ? `${path}/${folder.name}` : folder.name;
                    const subFiles = await this.get189ShareFiles(
                        shareId,
                        folder.id,
                        folder.id,
                        folderPath,
                        shareMode,
                        accessCode,
                        shareCode,
                        onProgress,
                    );
                    files.push(...subFiles);
                }

                if (fileList.length + folderList.length < 100) {
                    break;
                }
                page++;
            }
            return files;
        },

        parseXMLResponse(xmlText) {
            const getTagValue = (xml, tagName) =>
                xml.match(new RegExp(`<${tagName}>([^<]*)<\/${tagName}>`, "i"))?.[1] ||
                null;
            return {
                res_code: parseInt(getTagValue(xmlText, "res_code") || "0"),
                res_message: getTagValue(xmlText, "res_message") || "",
                shareId: getTagValue(xmlText, "shareId") || "",
                fileId: getTagValue(xmlText, "fileId") || "",
                shareMode: getTagValue(xmlText, "shareMode") || "0",
                isFolder: getTagValue(xmlText, "isFolder") === "true",
                needAccessCode: getTagValue(xmlText, "needAccessCode") || "0",
                fileName: getTagValue(xmlText, "fileName") || "",
            };
        },

        get189Signature(params) {
            const sortedKeys = Object.keys(params).sort();
            const sortedParams = sortedKeys
                .map((key) => `${key}=${params[key]}`)
                .join("&");
            return this.simpleMD5(sortedParams);
        },

        simpleMD5(str) {
            function rotateLeft(value, shift) {
                return (value << shift) | (value >>> (32 - shift));
            }

            function addUnsigned(x, y) {
                const lsw = (x & 0xffff) + (y & 0xffff);
                const msw = (x >> 16) + (y >> 16) + (lsw >> 16);
                return (msw << 16) | (lsw & 0xffff);
            }

            function F(x, y, z) {
                return (x & y) | (~x & z);
            }

            function G(x, y, z) {
                return (x & z) | (y & ~z);
            }

            function H(x, y, z) {
                return x ^ y ^ z;
            }

            function I(x, y, z) {
                return y ^ (x | ~z);
            }

            function FF(a, b, c, d, x, s, ac) {
                a = addUnsigned(a, addUnsigned(addUnsigned(F(b, c, d), x), ac));
                return addUnsigned(rotateLeft(a, s), b);
            }

            function GG(a, b, c, d, x, s, ac) {
                a = addUnsigned(a, addUnsigned(addUnsigned(G(b, c, d), x), ac));
                return addUnsigned(rotateLeft(a, s), b);
            }

            function HH(a, b, c, d, x, s, ac) {
                a = addUnsigned(a, addUnsigned(addUnsigned(H(b, c, d), x), ac));
                return addUnsigned(rotateLeft(a, s), b);
            }

            function II(a, b, c, d, x, s, ac) {
                a = addUnsigned(a, addUnsigned(addUnsigned(I(b, c, d), x), ac));
                return addUnsigned(rotateLeft(a, s), b);
            }

            function convertToWordArray(str) {
                const lWordCount = ((str.length + 8) >>> 6) + 1;
                const lMessageLength = lWordCount * 16;
                const lWordArray = new Array(lMessageLength - 1);
                let lBytePosition = 0;
                let lByteCount = 0;
                while (lByteCount < str.length) {
                    const lWordIndex = (lByteCount - (lByteCount % 4)) / 4;
                    lBytePosition = (lByteCount % 4) * 8;
                    lWordArray[lWordIndex] =
                        lWordArray[lWordIndex] |
                        (str.charCodeAt(lByteCount) << lBytePosition);
                    lByteCount++;
                }
                const lWordIndex = (lByteCount - (lByteCount % 4)) / 4;
                lBytePosition = (lByteCount % 4) * 8;
                lWordArray[lWordIndex] =
                    lWordArray[lWordIndex] | (0x80 << lBytePosition);
                lWordArray[lMessageLength - 2] = str.length << 3;
                lWordArray[lMessageLength - 1] = str.length >>> 29;
                return lWordArray;
            }

            function wordToHex(value) {
                let result = "";
                for (let i = 0; i <= 3; i++) {
                    const byte = (value >>> (i * 8)) & 255;
                    result += ("0" + byte.toString(16)).slice(-2);
                }
                return result;
            }

            const x = convertToWordArray(str);
            let a = 0x67452301,
                b = 0xefcdab89,
                c = 0x98badcfe,
                d = 0x10325476;
            const S11 = 7,
                S12 = 12,
                S13 = 17,
                S14 = 22;
            const S21 = 5,
                S22 = 9,
                S23 = 14,
                S24 = 20;
            const S31 = 4,
                S32 = 11,
                S33 = 16,
                S34 = 23;
            const S41 = 6,
                S42 = 10,
                S43 = 15,
                S44 = 21;
            for (let k = 0; k < x.length; k += 16) {
                const AA = a,
                    BB = b,
                    CC = c,
                    DD = d;
                a = FF(a, b, c, d, x[k + 0], S11, 0xd76aa478);
                d = FF(d, a, b, c, x[k + 1], S12, 0xe8c7b756);
                c = FF(c, d, a, b, x[k + 2], S13, 0x242070db);
                b = FF(b, c, d, a, x[k + 3], S14, 0xc1bdceee);
                a = FF(a, b, c, d, x[k + 4], S11, 0xf57c0faf);
                d = FF(d, a, b, c, x[k + 5], S12, 0x4787c62a);
                c = FF(c, d, a, b, x[k + 6], S13, 0xa8304613);
                b = FF(b, c, d, a, x[k + 7], S14, 0xfd469501);
                a = FF(a, b, c, d, x[k + 8], S11, 0x698098d8);
                d = FF(d, a, b, c, x[k + 9], S12, 0x8b44f7af);
                c = FF(c, d, a, b, x[k + 10], S13, 0xffff5bb1);
                b = FF(b, c, d, a, x[k + 11], S14, 0x895cd7be);
                a = FF(a, b, c, d, x[k + 12], S11, 0x6b901122);
                d = FF(d, a, b, c, x[k + 13], S12, 0xfd987193);
                c = FF(c, d, a, b, x[k + 14], S13, 0xa679438e);
                b = FF(b, c, d, a, x[k + 15], S14, 0x49b40821);
                a = GG(a, b, c, d, x[k + 1], S21, 0xf61e2562);
                d = GG(d, a, b, c, x[k + 6], S22, 0xc040b340);
                c = GG(c, d, a, b, x[k + 11], S23, 0x265e5a51);
                b = GG(b, c, d, a, x[k + 0], S24, 0xe9b6c7aa);
                a = GG(a, b, c, d, x[k + 5], S21, 0xd62f105d);
                d = GG(d, a, b, c, x[k + 10], S22, 0x2441453);
                c = GG(c, d, a, b, x[k + 15], S23, 0xd8a1e681);
                b = GG(b, c, d, a, x[k + 4], S24, 0xe7d3fbc8);
                a = GG(a, b, c, d, x[k + 9], S21, 0x21e1cde6);
                d = GG(d, a, b, c, x[k + 14], S22, 0xc33707d6);
                c = GG(c, d, a, b, x[k + 3], S23, 0xf4d50d87);
                b = GG(b, c, d, a, x[k + 8], S24, 0x455a14ed);
                a = GG(a, b, c, d, x[k + 13], S21, 0xa9e3e905);
                d = GG(d, a, b, c, x[k + 2], S22, 0xfcefa3f8);
                c = GG(c, d, a, b, x[k + 7], S23, 0x676f02d9);
                b = GG(b, c, d, a, x[k + 12], S24, 0x8d2a4c8a);
                a = HH(a, b, c, d, x[k + 5], S31, 0xfffa3942);
                d = HH(d, a, b, c, x[k + 8], S32, 0x8771f681);
                c = HH(c, d, a, b, x[k + 11], S33, 0x6d9d6122);
                b = HH(b, c, d, a, x[k + 14], S34, 0xfde5380c);
                a = HH(a, b, c, d, x[k + 1], S31, 0xa4beea44);
                d = HH(d, a, b, c, x[k + 4], S32, 0x4bdecfa9);
                c = HH(c, d, a, b, x[k + 7], S33, 0xf6bb4b60);
                b = HH(b, c, d, a, x[k + 10], S34, 0xbebfbc70);
                a = HH(a, b, c, d, x[k + 13], S31, 0x289b7ec6);
                d = HH(d, a, b, c, x[k + 0], S32, 0xeaa127fa);
                c = HH(c, d, a, b, x[k + 3], S33, 0xd4ef3085);
                b = HH(b, c, d, a, x[k + 6], S34, 0x4881d05);
                a = HH(a, b, c, d, x[k + 9], S31, 0xd9d4d039);
                d = HH(d, a, b, c, x[k + 12], S32, 0xe6db99e5);
                c = HH(c, d, a, b, x[k + 15], S33, 0x1fa27cf8);
                b = HH(b, c, d, a, x[k + 2], S34, 0xc4ac5665);
                a = II(a, b, c, d, x[k + 0], S41, 0xf4292244);
                d = II(d, a, b, c, x[k + 7], S42, 0x432aff97);
                c = II(c, d, a, b, x[k + 14], S43, 0xab9423a7);
                b = II(b, c, d, a, x[k + 5], S44, 0xfc93a039);
                a = II(a, b, c, d, x[k + 12], S41, 0x655b59c3);
                d = II(d, a, b, c, x[k + 3], S42, 0x8f0ccc92);
                c = II(c, d, a, b, x[k + 10], S43, 0xffeff47d);
                b = II(b, c, d, a, x[k + 1], S44, 0x85845dd1);
                a = II(a, b, c, d, x[k + 8], S41, 0x6fa87e4f);
                d = II(d, a, b, c, x[k + 15], S42, 0xfe2ce6e0);
                c = II(c, d, a, b, x[k + 6], S43, 0xa3014314);
                b = II(b, c, d, a, x[k + 13], S44, 0x4e0811a1);
                a = II(a, b, c, d, x[k + 4], S41, 0xf7537e82);
                d = II(d, a, b, c, x[k + 11], S42, 0xbd3af235);
                c = II(c, d, a, b, x[k + 2], S43, 0x2ad7d2bb);
                b = II(b, c, d, a, x[k + 9], S44, 0xeb86d391);
                a = addUnsigned(a, AA);
                b = addUnsigned(b, BB);
                c = addUnsigned(c, CC);
                d = addUnsigned(d, DD);
            }
            return (
                wordToHex(a) +
                wordToHex(b) +
                wordToHex(c) +
                wordToHex(d)
            ).toLowerCase();
        },
    };

    async function generateJson() {
        try {
            const hostname = location.hostname;
            const path = location.pathname;

            if (hostname.includes("cloud.189.cn")) {
                if (path.startsWith("/web/main")) {
                    await generateTianyiHomeJson();
                } else {
                    await generateTianyiShareJson();
                }
            } else if (hostname.includes("quark.cn")) {
                const isSharePage = /^\/(s|share)\//.test(path);
                if (isSharePage) {
                    await generateShareJson();
                } else {
                    await generateHomeJson();
                }
            }
        } catch (error) {
            utils.closeLoadingDialog();
            utils.showError(error.message || "生成JSON失败");
        }
    }

    async function generateTianyiShareJson() {
        utils.showLoadingDialog("正在扫描文件", "准备中...");

        try {
            const selectedFiles = tianyiService.getSelectedFiles();

            if (selectedFiles.length === 0) {
                utils.closeLoadingDialog();
                utils.showError("请先勾选要生成JSON的文件或文件夹");
                return;
            }

            const shareUrl = window.location.href;
            let sharePwd = "";

            const allFiles = [];
            let itemsProcessed = 0;
            let filesFound = 0;

            const onProgress = () => {
                filesFound++;
                utils.updateScanProgress(filesFound);
            };

            utils.updateProgress(0, selectedFiles.length, "扫描文件");
            utils.updateScanProgress(0);

            const {shareId, shareMode, accessCode, shareCode, title} =
                await tianyiService.getBaseShareInfo(shareUrl, sharePwd);

            for (const item of selectedFiles) {
                if (item.isFolder) {
                    const folderPath = item.fileName;
                    const subFiles = await tianyiService.get189ShareFiles(
                        shareId,
                        item.fileId,
                        item.fileId,
                        folderPath,
                        shareMode,
                        accessCode,
                        shareCode,
                        onProgress,
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
                utils.updateProgress(itemsProcessed, selectedFiles.length, "扫描文件");
            }

            utils.updateScanComplete(allFiles.length);
            await utils.sleep(300);

            const finalJson = utils.generateRapidTransferJson(allFiles);
            utils.closeLoadingDialog();
            utils.showResultDialog(finalJson, title);
        } catch (error) {
            utils.closeLoadingDialog();
            utils.showError(error.message || "生成JSON失败");
        }
    }

    async function generateTianyiHomeJson() {
        utils.showLoadingDialog("正在扫描文件", "准备中...");

        try {
            const selectedFiles = tianyiService.getSelectedFiles();
            if (selectedFiles.length === 0) {
                utils.closeLoadingDialog();
                utils.showError("请先勾选要生成JSON的文件或文件夹");
                return;
            }

            const allFiles = [];
            let filesFound = 0;
            const onProgress = () => {
                filesFound++;
                utils.updateScanProgress(filesFound);
            };
            utils.updateScanProgress(0);

            for (const item of selectedFiles) {
                if (item.isFolder) {
                    const subFiles = await tianyiService.getPersonalFolderFiles(
                        item.fileId,
                        item.fileName,
                        onProgress,
                    );
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

            utils.updateScanComplete(allFiles.length);
            await utils.sleep(300);

            const filesMissingMd5 = allFiles.filter((f) => !f.etag);
            if (filesMissingMd5.length > 0) {
                utils.updateProgress(0, filesMissingMd5.length, "获取MD5");
                let md5Processed = 0;

                for (const file of filesMissingMd5) {
                    try {
                        const details = await tianyiService.getPersonalFileDetails(
                            file.fileId,
                        );
                        file.etag = (details.md5 || "").toLowerCase();
                    } catch (e) {
                        console.error(`获取文件MD5失败: ${file.path}`, e);
                    }
                    md5Processed++;
                    utils.updateProgress(md5Processed, filesMissingMd5.length, "获取MD5");
                    await utils.sleep(100); // 防止请求过快
                }
            }

            const finalJson = utils.generateRapidTransferJson(allFiles);
            utils.closeLoadingDialog();
            utils.showResultDialog(finalJson);
        } catch (error) {
            utils.closeLoadingDialog();
            utils.showError(error.message || "生成JSON失败");
        }
    }

    async function generateHomeJson() {
        const selectedItems = utils.getSelectedList();

        if (selectedItems.length === 0) {
            utils.showError("请先勾选要生成JSON的文件或文件夹");
            return;
        }

        utils.showLoadingDialog("正在扫描文件", "准备中...");

        const currentPath = utils.getCurrentPath();

        const allFiles = [];
        let totalFilesFound = 0;

        for (const item of selectedItems) {
            if (item.file) {
                const filePath = currentPath
                    ? `${currentPath}/${item.file_name}`
                    : item.file_name;
                allFiles.push({...item, path: filePath});
                totalFilesFound++;
                utils.updateScanProgress(totalFilesFound);
            } else if (item.dir) {
                const folderPath = currentPath
                    ? `${currentPath}/${item.file_name}`
                    : item.file_name;
                const folderFiles = await utils.getFolderFiles(
                    item.fid,
                    folderPath,
                    () => {
                        totalFilesFound++;
                        utils.updateScanProgress(totalFilesFound);
                    },
                );
                allFiles.push(...folderFiles);
            }
        }

        if (allFiles.length === 0) {
            utils.closeLoadingDialog();
            utils.showError("没有找到任何文件");
            return;
        }

        const filesData = await utils.getFilesWithMd5(
            allFiles,
            (processed, total) => {
                utils.updateProgress(processed, total, "获取MD5");
            },
        );

        const json = utils.generateRapidTransferJson(filesData);

        utils.closeLoadingDialog();

        utils.showResultDialog(json);
    }

    async function generateShareJson() {
        const selectedItems = utils.getSelectedList();

        if (selectedItems.length === 0) {
            utils.showError("请先勾选要生成JSON的文件或文件夹");
            return;
        }

        const match = location.pathname.match(/\/(s|share)\/([a-zA-Z0-9]+)/);
        if (!match) {
            utils.showError("无法获取分享ID");
            return;
        }
        const shareId = match[2];

        let cookie = utils.getCachedCookie();

        if (!cookie || cookie.length < 10) {
            utils.showCookieInputDialog((newCookie) => {
                setTimeout(() => generateShareJson(), 100);
            });
            return;
        }

        utils.showLoadingDialog("正在扫描文件", "准备中...");

        try {

            const {stoken, title} = await utils.getShareToken(shareId, "", cookie);

            const allFileItems = [];
            let totalFilesFound = 0;

            for (const item of selectedItems) {
                if (item.file) {
                    const parentFid = item.pdir_fid;
                    const filesInParent = await utils.scanQuarkShareFiles(
                        shareId,
                        stoken,
                        cookie,
                        parentFid,
                        '',
                        false
                    );
                    const fileInfo = filesInParent.find(f => f.fid === item.fid);

                    if (fileInfo) {
                        const fileItem = {
                            fid: item.fid,
                            token: fileInfo.token,
                            name: item.file_name,
                            size: item.size,
                            path: item.file_name,
                        };
                        allFileItems.push(fileItem);
                    } else {
                        // Fallback to old logic if not found
                        const fileItem = {
                            fid: item.fid,
                            token: item.share_fid_token,
                            name: item.file_name,
                            size: item.size,
                            path: item.file_name,
                        };
                        allFileItems.push(fileItem);
                    }
                    totalFilesFound++;
                    utils.updateScanProgress(totalFilesFound);
                } else if (item.dir) {
                    const folderFiles = await utils.scanQuarkShareFiles(
                        shareId,
                        stoken,
                        cookie,
                        item.fid,
                        item.file_name,
                    );
                    allFileItems.push(...folderFiles);
                    totalFilesFound += folderFiles.length;
                    utils.updateScanProgress(totalFilesFound);
                }
            }


            if (allFileItems.length === 0) {
                utils.closeLoadingDialog();
                utils.showError("没有找到任何文件", true);
                return;
            }

            utils.updateScanComplete(allFileItems.length);
            await utils.sleep(300);

            const md5Map = await utils.batchGetShareFilesMd5(
                shareId,
                stoken,
                cookie,
                allFileItems,
                (processed, total) => {
                    utils.updateProgress(processed, total, "获取分享文件MD5");
                },
            );

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

            utils.closeLoadingDialog();

            utils.showResultDialog(json, title);
        } catch (error) {
            utils.closeLoadingDialog();
            const errorMsg = error.message || "生成JSON失败";
            const isCookieError =
                errorMsg.includes("登录") ||
                errorMsg.includes("token") ||
                errorMsg.includes("Cookie") ||
                errorMsg.includes("23018");
            utils.showError(
                errorMsg +
                (isCookieError ? "\n\n可能是Cookie失效，请尝试更新Cookie" : ""),
                isCookieError,
            );
        }
    }

    function addButton() {
        const hostname = location.hostname;
        let container;

        if (document.getElementById("quark-json-generator-btn")) {
            return;
        }

        if (hostname.includes("cloud.189.cn")) {
            const isMainPage = location.pathname.startsWith("/web/main");

            if (isMainPage) {
                container = document.querySelector(
                    '[class*="FileHead_file-head-left"]',
                );
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
                button.style.cssText =
                    "width: 76px; height: 30px; padding: 0; border-radius: 4px; line-height: 30px; color: #fff; text-align: center; font-size: 12px; background: #52c41a; border: 1px solid #46a219; position: relative; display: block; margin-right: 12px;";
            } else {
                button.style.cssText =
                    "width: 116px; height: 36px; padding: 0; border-radius: 4px; line-height: 36px; color: #fff; text-align: center; font-size: 14px; background: #52c41a; border: 1px solid #46a219; position: relative; display: block;margin-right:20px;";
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
                      /* Override conflicting styles */
                      float: none !important;
                      text-align: unset !important;
                  }
                  .btn-save-as{
                  margin-left: 0 !important;
                  }
              `;
                    document.head.appendChild(style);
                }
            }

            button.onclick = generateJson;
        } else if (hostname.includes("quark.cn")) {
            const path = location.pathname;
            const isSharePage = /^\/(s|share)\//.test(path);
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

            const isSharePageQuark = /^\/(s|share)\//.test(location.pathname);
            if (isSharePageQuark) {
                buttonWrapper.style.cssText =
                    "display: inline-block; margin-left: 16px;";
                buttonWrapper.innerHTML = `
            <button type="button" class="ant-btn ant-btn-primary" style="background: #52c41a; border-color: #52c41a; height: 40px;">
                <svg style="width: 16px; height: 16px; margin-right: 4px; vertical-align: -3px;" viewBox="0 0 16 16" fill="currentColor"><path d="M8 2a.5.5 0 0 1 .5.5v5h5a.5.5 0 0 1 0 1h-5v5a.5.5 0 0 1-1 0v-5h-5a.5.5 0 0 1 0-1h5v-5A.5.5 0 0 1 8 2z"/></svg>
                <span>生成JSON</span>
            </button>`;
                container.appendChild(buttonWrapper);
            } else {
                buttonWrapper.style.cssText =
                    "display: inline-block; margin-right: 16px;";
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
    }

    function init() {
        const SCRIPT_VERSION = GM_info.script.version;
        const LAST_VERSION = GM_getValue("last_version", "0");

        if (SCRIPT_VERSION > LAST_VERSION) {
            utils.showUpdateDialog();
            GM_setValue("last_version", SCRIPT_VERSION);
        }

        const hostname = location.hostname;
        if (hostname.includes("quark.cn") || hostname.includes("cloud.189.cn")) {
            const observer = new MutationObserver(() => {
                addButton();
            });

            observer.observe(document.body, {
                childList: true,
                subtree: true,
            });

            addButton();
        }
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();
// END integrated quark/tianyi JSON generator

