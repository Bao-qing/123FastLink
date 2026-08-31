import { GlobalConfig } from "./config";
import { createLogger } from "./logger";

const log = createLogger('API');
const uploadLog = createLogger('Upload');
const downloadLog = createLogger('Download');

export class PanApiClient {
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
            log.error('API请求失败:', e);
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
        //log.log("获取文件列表:", data.data.InfoList);
        log.log("获取文件列表 ID：", parentFileId, "Page：", page);
        return { data: { InfoList: data.data.InfoList }, total: data.data.Total };
        //return { data: { fileList: data.data.fileList } };
    }

    async getFileList(parentFileId) {
        let InfoList = [];
        this.progress = 0;
        this.progressDesc = `获取文件列表 文件夹ID：${parentFileId}`;
        // 默认一页100
        // 先获取一次，得到Total
        log.log("开始获取文件列表,ID:", parentFileId);
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
        return { data: { InfoList }, total: total };
    }

    async getFileInfo(idList) {
        const fileIdList = idList.map(fileId => ({ fileId }));
        const data = await this.sendRequest("POST", "/b/api/file/info", {}, JSON.stringify({ fileIdList }));
        return { data: { InfoList: data.data.infoList } };
    }

    // 尝试秒传
    async fastUpload(fileInfo) {
        try {
            const response = await this.sendRequest('POST', '/b/api/file/upload_request', {}, JSON.stringify({
                ...fileInfo, RequestSource: null
            }));
            const reuse = response['data']['Reuse'];
            log.log('reuse：', reuse);
            if (response['code'] !== 0) {
                return [false, response['message'], null];
            }
            if (!reuse) {
                log.error('保存文件失败:', fileInfo.fileName, 'response:', response);
                return [false, "未能实现秒传", null];
            } else {
                return [true, null, response['data']['Info']['FileId']];
            }
        } catch (error) {
            log.error('上传请求失败:', error);
            return [false, '请求失败', null];
        }
    }

    // 从sessionStorage中获取父级文件ID
    async getParentFileId() {
        let homeFilePath = null;

        // 旧版页面将当前路径写入 sessionStorage，新版页面有时只保留在 URL 中。
        const rawFilePath = sessionStorage.getItem('filePath') || sessionStorage['filePath'];
        if (rawFilePath) {
            try {
                const filePathData = typeof rawFilePath === 'string' ? JSON.parse(rawFilePath) : rawFilePath;
                if (Array.isArray(filePathData?.homeFilePath)) {
                    homeFilePath = filePathData.homeFilePath;
                }
            } catch (error) {
                log.warn('解析 sessionStorage.filePath 失败，将尝试从 URL 获取当前路径:', error);
            }
        }

        if (!homeFilePath) {
            const urlHomeFilePath = new URLSearchParams(window.location.search).get('homeFilePath');
            if (urlHomeFilePath) {
                homeFilePath = urlHomeFilePath.split(',').filter(Boolean);
            }
        }

        const parentFileId = (homeFilePath?.[homeFilePath.length - 1] || 0);
        log.log('parentFileId:', parentFileId);
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
            log.error('创建文件夹失败:', error);
            return {
                'folderFileId': null, 'folderName': folderName, 'success': false
            };
        }
        log.log('创建文件夹 ID:', folderFileId);
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

            uploadLog.log('upload_request响应:', data);

            if (data.code !== 0) {
                return [false, data.message, null];
            }

            return [true, null, data.data];

        } catch (error) {
            uploadLog.error('上传请求失败:', error);
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

            uploadLog.log('获取上传凭证响应:', data);

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
            uploadLog.error('获取上传凭证失败:', error);
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
            const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });

            uploadLog.log('开始上传到S3:', presignedUrl);

            // 移除 x-amz-acl 头，因为预签名URL通常已经包含了所有必要的认证信息
            const response = await fetch(presignedUrl, {
                method: 'PUT', headers: {
                    'Content-Type': 'text/plain;charset=utf-8'
                    // 注意：不要添加 x-amz-acl，因为预签名URL已经包含了权限信息
                }, body: blob
            });

            uploadLog.log('S3上传响应状态:', response.status, response.statusText);

            if (response.ok || response.status === 200) {
                return [true, null];
            } else {
                const errorText = await response.text();
                uploadLog.error('S3上传失败详情:', errorText);

                // 尝试不带Content-Type头再次上传（某些S3配置可能不需要）
                if (response.status === 403 || response.status === 400) {
                    uploadLog.log('尝试不带Content-Type头上传');
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
            uploadLog.error('S3上传失败:', error);
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

            uploadLog.log('完成上传响应:', data);

            if (data.code !== 0) {
                return [false, data.message, null];
            }

            return [true, null, data.data];

        } catch (error) {
            uploadLog.error('完成上传失败:', error);
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
            uploadLog.log('开始上传文本文件:', fileName);

            // 1. 获取父文件夹ID
            if (!parentFileId) {
                parentFileId = await this.getParentFileId();
            }

            // 2. 计算文件大小
            const fileSize = this.calculateStringSize(text);
            uploadLog.log('文件大小:', fileSize, '字节');

            // 3. 计算MD5
            const md5 = this.md5(text);
            uploadLog.log('文件MD5:', md5);

            // 4. 第一步：上传请求
            uploadLog.log('步骤1: 上传请求');
            const [requestSuccess, requestError, uploadData] = await this.uploadRequest({
                driveId: 0, etag: md5, fileName: fileName, parentFileId: parentFileId, size: fileSize, type: 0,  // 0表示文件，1表示文件夹
                duplicate: 1,  // 1表示覆盖同名文件
                event: "homeUploadFile",  // 添加事件类型
                operateType: 1
            });

            if (!requestSuccess) {
                return [false, '上传请求失败: ' + requestError, null];
            }

            uploadLog.log('上传请求数据:', uploadData);

            // 5. 检查是否秒传
            if (uploadData.Reuse) {
                uploadLog.log('秒传成功，文件ID:', uploadData.FileId);
                return [true, "秒传成功", uploadData.FileId, {
                    etag: md5, fileName: fileName, size: fileSize
                }];
            }

            // 6. 第二步：获取上传凭证
            uploadLog.log('步骤2: 获取上传凭证');
            const [authSuccess, authError, presignedUrl] = await this.getUploadAuth(uploadData.Bucket, uploadData.Key, uploadData.UploadId, uploadData.StorageNode);

            if (!authSuccess) {
                return [false, '获取上传凭证失败: ' + authError, null];
            }

            uploadLog.log('预签名URL:', presignedUrl);

            // 7. 第三步：上传到S3
            uploadLog.log('步骤3: 上传到S3');
            const [uploadSuccess, uploadError] = await this.uploadToS3Entire(presignedUrl, text);

            if (!uploadSuccess) {
                return [false, 'S3上传失败: ' + uploadError, null];
            }

            uploadLog.log('S3上传成功');

            // 8. 第四步：完成上传
            uploadLog.log('步骤4: 完成上传');
            const [completeSuccess, completeError, completeData] = await this.completeUpload(uploadData.FileId, uploadData.Bucket, fileSize, uploadData.Key, uploadData.UploadId, uploadData.StorageNode);

            if (!completeSuccess) {
                return [false, '完成上传失败: ' + completeError, null];
            }

            uploadLog.log('上传完成，文件ID:', uploadData.FileId);
            return [true, "上传完成", uploadData.FileId, {
                etag: md5, fileName: fileName, size: fileSize
            }];

        } catch (error) {
            uploadLog.error('文本上传流程失败:', error);
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
            downloadLog.log('获取下载调度列表，文件:', fileInfo.fileName);

            const data = await this.sendRequest('POST', '/b/api/v2/file/download_info', {}, JSON.stringify({
                driveId: 0,
                etag: fileInfo.etag,
                fileId: fileInfo.fileId.toString(),
                s3keyFlag: fileInfo.s3keyFlag,
                type: 0,  // 0-文件
                fileName: fileInfo.fileName,
                size: fileInfo.size.toString()
            }));

            downloadLog.log('获取下载调度列表响应:', data);

            if (data.code !== 0) {
                downloadLog.error('获取下载调度列表失败:', data.message);
                return [false, data.message, null];
            }

            return [true, null, data.data];

        } catch (error) {
            downloadLog.error('获取下载调度列表异常:', error);
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
            downloadLog.log('获取下载链接，文件:', fileInfo.fileName);

            // 1. 获取调度列表
            const [dispatchSuccess, dispatchError, dispatchData] = await this.getDispatchList(fileInfo);
            if (!dispatchSuccess) {
                return [false, dispatchError, null];
            }

            const { dispatchList, downloadPath } = dispatchData;

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

            downloadLog.log('选择的下载线路:', selectedDispatch.isp, 'URL前缀:', selectedDispatch.prefix);

            // 3. 拼接完整的下载链接
            // 确保前缀不以斜杠结尾，路径以斜杠开头
            const cleanPrefix = selectedDispatch.prefix.endsWith('/') ? selectedDispatch.prefix.slice(0, -1) : selectedDispatch.prefix;
            const cleanPath = downloadPath.startsWith('/') ? downloadPath : '/' + downloadPath;

            const downloadLink = `${cleanPrefix}${cleanPath}`;

            downloadLog.log('完整下载链接:', downloadLink);

            return [true, null, {
                downloadLink,
                isp: selectedDispatch.isp,
                prefix: selectedDispatch.prefix,
                downloadPath,
                fileId: fileInfo.fileId,
                fileName: fileInfo.fileName
            }];

        } catch (error) {
            downloadLog.error('获取下载链接异常:', error);
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
            downloadLog.log('获取链接文本内容:', downloadLink);

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

                downloadLog.log('响应状态:', response.status, response.statusText);

                if (!response.ok) {
                    // 尝试获取更多错误信息
                    let errorText = '';
                    try {
                        errorText = await response.text();
                        downloadLog.error('错误响应内容:', errorText);
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
                downloadLog.log('获取到文本内容，长度:', textContent.length, '字符');

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
                downloadLog.error('请求超时:', timeout, 'ms');
                return [false, `请求超时 (${timeout}ms)`, null];
            }

            downloadLog.error('获取链接文本内容异常:', error);
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
            downloadLog.log('开始下载文本文件:', fileInfo.fileName);

            // 1. 获取下载链接
            downloadLog.log('步骤1: 获取下载链接');
            const [linkSuccess, linkError, linkData] = await this.getDownloadLink(fileInfo, preferredIsp);
            if (!linkSuccess) {
                return [false, '获取下载链接失败: ' + linkError, null];
            }

            const { downloadLink } = linkData;

            // 2. 获取文本内容
            downloadLog.log('步骤2: 获取文本内容');
            const [contentSuccess, contentError, content] = await this.getLinkTextContent(downloadLink, options);

            if (!contentSuccess) {
                return [false, '获取文本内容失败: ' + contentError, null];
            }

            downloadLog.log('下载完成，文件:', fileInfo.fileName);
            return [true, null, content];

        } catch (error) {
            downloadLog.error('下载文本文件流程异常:', error);
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
            downloadLog.log('通过文件ID下载文本文件:', fileId);

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
            downloadLog.log('获取到文件信息:', fileInfo);

            // 3. 下载文件
            return await this.downloadTextFile(fileInfo, preferredIsp);

        } catch (error) {
            downloadLog.error('通过文件ID下载异常:', error);
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
            downloadLog.log('下载文件为Blob:', fileInfo.fileName);

            // 1. 获取下载链接
            const [linkSuccess, linkError, linkData] = await this.getDownloadLink(fileInfo, preferredIsp);
            if (!linkSuccess) {
                return [false, linkError, null];
            }

            const { downloadLink } = linkData;

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
            downloadLog.log('下载Blob完成，大小:', blob.size, '字节');

            return [true, null, blob];

        } catch (error) {
            downloadLog.error('下载文件为Blob异常:', error);
            return [false, '下载文件失败: ' + error.message, null];
        }
    }
}
