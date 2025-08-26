// ==UserScript==
// @name         123FastLink
// @namespace    http://tampermonkey.net/
// @version      2025.8.24.2
// @description  Creat and save 123pan instant links.
// @author       Baoqing
// @author       Chaofan
// @author       lipkiat
// @match        *://*.123pan.com/*
// @match        *://*.123pan.cn/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=123pan.com
// @grant        none
// ==/UserScript==


(function () {
    'use strict';
    const DEBUG = true;
    // 模拟浏览器环境
    // var window = {
    //     location: {
    //         host: "www.123pan.com",
    //     },
    //     sessionStorage: {
    //     }
    // };

    // var localStorage = {
    //     'authorToken': "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJleHAiOjE3NTY3MzMzMTgsImlhdCI6MTc1NjEyODUxOCwiaWQiOjE4NDYzMDE5NDMsIm1haWwiOiIiLCJuaWNrbmFtZSI6IjE2Nzk2MTIwODUxIiwic3VwcGVyIjpmYWxzZSwidXNlcm5hbWUiOjE2Nzk2MTIwODUxLCJ2IjowfQ.RGsu0mI8GgWe-Ijbf-BroMa18OsieeOk0ReFJg0Io7o",
    //     'LoginUuid': "104c52b90f979e9fec605420327d9c29c47ce8cacbfcd89a2eb6333d7d581af4c26f53b73653d9d4c648ac1bc305426a",
    // };

    // var document = {
    //     location:{
    //         href:"https://www.123pan.com"
    //     }
    // }
    // 集成ShareLinkJsonManager类
    class ShareLinkJsonManager {
        static shareLinkToJson(shareLink, options = {}) {
            const lines = shareLink
                .replace(/\r?\n/g, '$')
                .split('$')
                .map(line => line.trim())
                .filter(Boolean);

            let commonPath = options.commonPath || '';
            const usesBase62EtagsInExport = options.usesBase62EtagsInExport !== undefined ? options.usesBase62EtagsInExport : true;

            const files = lines.map(line => {
                const [etag, size, ...nameParts] = line.split('#');
                const fileName = nameParts.join('#');
                return {
                    etag: usesBase62EtagsInExport ? ShareLinkJsonManager.hexToBase62(etag) : etag,
                    size,
                    path: fileName
                };
            });

            if (!commonPath && files.length > 1) {
                const paths = files.map(f => f.path.split('/'));
                let prefix = [];
                for (let i = 0; ; i++) {
                    const seg = paths[0][i];
                    if (seg && paths.every(p => p[i] === seg)) {
                        prefix.push(seg);
                    } else {
                        break;
                    }
                }
                if (prefix.length) {
                    commonPath = prefix.join('/') + '/';
                    files.forEach(f => {
                        f.path = f.path.substring(commonPath.length);
                    });
                }
            }

            const totalSize = files.reduce((sum, f) => sum + Number(f.size), 0);
            return {
                scriptVersion: "1.0.0",
                exportVersion: "1.0",
                usesBase62EtagsInExport,
                commonPath,
                totalFilesCount: files.length,
                totalSize,
                formattedTotalSize: ShareLinkJsonManager.formatSize(totalSize),
                files: files.map(f => ({
                    path: f.path,
                    size: f.size,
                    etag: f.etag
                }))
            };
        }

        static jsonToShareLink(json) {
            const commonPath = json.commonPath || '';
            const usesBase62 = !!json.usesBase62EtagsInExport;
            return (json.files || [])
                .map(f => {
                    const fileName = commonPath ? (commonPath + f.path) : f.path;
                    const safeName = fileName.replace(/[#\$]/g, '');
                    const etag = usesBase62 ? ShareLinkJsonManager.base62ToHex(f.etag) : f.etag;
                    return [etag, f.size, safeName].join('#');
                })
                .join('\n');
        }

        static formatSize(size) {
            if (size < 1024) return size + ' B';
            if (size < 1024 * 1024) return (size / 1024).toFixed(2) + ' KB';
            if (size < 1024 * 1024 * 1024) return (size / 1024 / 1024).toFixed(2) + ' MB';
            return (size / 1024 / 1024 / 1024).toFixed(2) + ' GB';
        }

        static validateJson(json) {
            return (
                json &&
                Array.isArray(json.files) &&
                json.files.every(f => f.etag && f.size && f.path)
            );
        }

        static safeParse(str) {
            try {
                return JSON.parse(str);
            } catch {
                return null;
            }
        }

        static parseJsonShareLink(json) {
            if (typeof json === 'string') {
                try {
                    json = JSON.parse(json);
                } catch {
                    return [];
                }
            }
            if (!json || !Array.isArray(json.files)) return [];
            const usesBase62 = !!json.usesBase62EtagsInExport;

            return json.files.map(f => ({
                etag: usesBase62 ? ShareLinkJsonManager.base62ToHex(f.etag) : f.etag,
                size: f.size,
                fileName: json.commonPath ? (json.commonPath + f.path) : f.path
            }));
        }

        static get base62chars() {
            return '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
        }

        static hexToBase62(hex) {
            if (!hex) return '';
            let num = BigInt('0x' + hex);
            if (num === 0n) return '0';
            let chars = [];
            const base62 = ShareLinkJsonManager.base62chars;
            while (num > 0n) {
                chars.push(base62[Number(num % 62n)]);
                num = num / 62n;
            }
            return chars.reverse().join('');
        }

        static base62ToHex(base62) {
            if (!base62) return '';
            const chars = ShareLinkJsonManager.base62chars;
            let num = 0n;
            for (let i = 0; i < base62.length; i++) {
                num = num * 62n + BigInt(chars.indexOf(base62[i]));
            }
            let hex = num.toString(16);
            if (hex.length % 2) hex = '0' + hex;
            return hex;
        }
    }

    // 1. 123云盘API通信类
    class PanApiClient {
        constructor() {
            this.host = 'https://' + window.location.host;
            this.authToken = localStorage['authorToken'];
            this.loginUuid = localStorage['LoginUuid'];
            this.appVersion = '3';
            this.referer = document.location.href;
            this.getFileListPageDelay = 500;
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
                    method,
                    headers,
                    body,
                    credentials: 'include'
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
            const data = await this.sendRequest(
                "GET",
                "/b/api/file/list/new",
                urlParams
            );
            //console.log("[123FASTLINK] [PanApiClient]", "获取文件列表:", data.data.InfoList);
            console.log("[123FASTLINK] [PanApiClient]", "获取文件列表 ID：", parentFileId, "Page：", page);
            return { data: { InfoList: data.data.InfoList }, total: data.data.Total };
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
            return { data: { InfoList }, total: total };
        }

        async getFileInfo(idList) {
            const fileIdList = idList.map(fileId => ({ fileId }));
            const data = await this.sendRequest(
                "POST",
                "/b/api/file/info", {},
                JSON.stringify({ fileIdList })
            );
            return { data: { InfoList: data.data.infoList } };
        }

        async uploadRequest(fileInfo) {
            try {
                const response = await this.sendRequest(
                    'POST',
                    '/b/api/file/upload_request', {},
                    JSON.stringify({ ...fileInfo, RequestSource: null })
                );
                const reuse = response['data']['Reuse'];
                console.log('[123FASTLINK] [PanApiClient]', 'reuse：', reuse);
                if (!reuse) {
                    console.error('[123FASTLINK] [PanApiClient]', '保存文件失败:', fileInfo.fileName, 'response:', response);
                }
                return reuse;
            } catch (error) {
                console.error('[123FASTLINK] [PanApiClient]', '上传请求失败:', error);
                return false;
            }
        }

        // 从sessionStorage中获取父级文件ID
        async getParentFileId() {
            const homeFilePath = JSON.parse(sessionStorage['filePath'])['homeFilePath'];
            const parentFileId = (homeFilePath[homeFilePath.length - 1] || 0);
            console.log('[123FASTLINK] [PanApiClient] parentFileId:', parentFileId);
            return parentFileId.toString();
        }

        // 获取文件
        async getFile(fileInfo) {
            // TODO: 不要每次都获取父级文件ID，如果用户此时切换页面，文件保存路径也会变！
            const parentFileId = await this.getParentFileId();
            const reuse = await this.uploadRequest({
                driveId: 0,
                etag: fileInfo.etag,
                fileName: fileInfo.fileName,
                parentFileId,
                size: fileInfo.size,
                type: 0,
                duplicate: 1
            });
            return reuse;
        }

        async mkdirInNowFloder(folderName = "New Folder") {
            const parentFileId = await this.getParentFileId();
            return this.mkdir(parentFileId, folderName);
        }

        async mkdir(parentFileId, folderName = "New Folder") {
            let folderFileId = null;
            try {
                const response = await this.sendRequest(
                    'POST',
                    '/b/api/file/upload_request',
                    {},
                    JSON.stringify({
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
                    })
                );
                folderFileId = response['data']['Info']['fileId'];
            } catch (error) {
                console.error('[123FASTLINK] [PanApiClient]', '创建文件夹失败:', error);
                return {
                    'folderFileId': null,
                    'folderName': folderName,
                    'success': false
                };
            }
            console.log('[123FASTLINK] [PanApiClient]', '创建文件夹 ID:', folderFileId);
            return {
                'folderFileId': folderFileId,
                'folderName': folderName,
                'success': true
            };
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

        init() {
            if (this._inited) return;
            this._inited = true;
            const originalCreateElement = document.createElement;
            const self = this;
            document.createElement = function (tagName, options) {
                const element = originalCreateElement.call(document, tagName, options);

                const observer = new MutationObserver(() => {
                    if (
                        element.classList.contains('ant-table-row') &&
                        element.classList.contains('ant-table-row-level-0') &&
                        element.classList.contains('editable-row')
                    ) {
                        const input = element.querySelector('input');
                        if (input) {
                            input.addEventListener('click', function () {
                                const rowKey = element.getAttribute('data-row-key');
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
                        observer.disconnect();
                    } else if (
                        // 检查是否为全选框并绑定事件
                        element.classList.contains('ant-checkbox-input') &&
                        element.getAttribute('aria-label') === 'Select all'
                    ) {
                        // 新建全选框时 如果父元素<span>没有ant-checkbox-indeterminate或ant-checkbox-checked的class值
                        // 则是切换页面而非点击刷新按钮，或者没有选择，此时所有清除选择缓存。
                        if (
                            !(element.parentElement.classList.contains('ant-checkbox-indeterminate') ||
                                element.parentElement.classList.contains('ant-checkbox-checked'))
                        ) {
                            self.unselectedRowKeys = [];
                            self.selectedRowKeys = [];
                            self.isSelectAll = false;
                        }
                        self._bindSelectAllEvent(element);
                        console.log('[123FASTLINK] [Selector] 已为全选框绑定事件');
                    } else if (
                        // 取消选择按钮
                        element.classList.contains('ant-btn') &&
                        element.classList.contains('ant-btn-link') &&
                        element.classList.contains('ant-btn-color-link') &&
                        element.classList.contains('ant-btn-variant-link') &&
                        element.classList.contains('mfy-button')
                    ) {
                        element.addEventListener('click', function () {
                            self.selectedRowKeys = [];
                            self.unselectedRowKeys = [];
                            self.isSelectAll = false;
                            self._outputSelection && self._outputSelection();
                        });
                    }

                });
                observer.observe(element, {
                    attributes: true,
                    attributeFilter: ['class', 'aria-label']
                });
                return element;
            };
            console.log('[123FASTLINK] [Selector] CreatElement监听已激活');
        }

        _bindSelectAllEvent(checkbox) {
            if (checkbox.dataset.selectAllBound) return;
            checkbox.dataset.selectAllBound = 'true';
            checkbox.addEventListener('click', () => {
                if (checkbox.checked) {
                    this.isSelectAll = true;
                    this.unselectedRowKeys = [];
                    this.selectedRowKeys = [];
                } else {
                    this.isSelectAll = false;
                    this.selectedRowKeys = [];
                    this.unselectedRowKeys = [];
                }
                this._outputSelection();
            });
        }

        _outputSelection() {
            if (this.isSelectAll) {
                if (this.unselectedRowKeys.length === 0) {
                    console.log('[123FASTLINK] [Selector]', '全选');
                } else {
                    console.log('[123FASTLINK] [Selector]', '全选，反选这些：', this.unselectedRowKeys);
                }
            } else {
                console.log('[123FASTLINK] [Selector]', '当前选中：', this.selectedRowKeys);
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
        constructor(apiClient, selector) {
            this.apiClient = apiClient;
            this.selector = selector;
            this.progress = 0;
            this.progressDesc = "";
            this.getFileInfoBatchSize = 20;
            this.getFileInfoDelay = 500;
            this.getFloderInfoDelay = 500;
            this.saveLinkDelay = 200;
            this.fileInfoList = [],
                this.scriptName = "123FASTLINKV3"
        }

        async getAllFileInfoByFloderId(parentFileId, folderName = '', total) {
            // total 用来计算进度
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
            const allFileInfoList = (await this.apiClient.getFileList(parentFileId)).data.InfoList;
            clearInterval(progressUpdater);
            
            // 分开文件和文件夹
            // 文件添加所在文件夹名称
            const fileInfo = allFileInfoList.filter(file => file.Type !== 1);
            fileInfo.forEach(file => {
                file.FolderName = folderName;
            });

            this.fileInfoList.push(...fileInfo);
            console.log("[123FASTLINK] [ShareLinkManager]", "获取文件列表,ID:", parentFileId);

            const fileFolderInfo = allFileInfoList.filter(file => file.Type === 1);
            // if (fileFolderInfo.length === 0) {
            //     this.progress = progress + 100 / total;
            // }
            for (const folder of fileFolderInfo) {
                // 延时
                await new Promise(resolve => setTimeout(resolve, this.getFloderInfoDelay));
                await this.getAllFileInfoByFloderId(folder.FileId, folderName + folder.FileName + "/", total * fileFolderInfo.length);
            }
            this.progress = progress + 100 / total;
        }

        // 批量获取文件信息
        async getFileInfoBatch(idList) {
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
            return allFileInfo;
        }

        async generateShareLink() {
            this.progress = 0;
            this.progressDesc = "准备获取文件信息...";
            const fileSelectInfo = this.selector.getSelection();

            this.fileInfoList = [];
            let fileSelectFloderInfoList = [];

            if (fileSelectInfo.isSelectAll) {
                this.progress = 10;
                this.progressDesc = "正在递归获取选择的文件..."
                let allFileInfo = (await this.apiClient.getFileList(await this.apiClient.getParentFileId())).data.InfoList;
                // 分开处理文件和文件夹
                let fileInfo = allFileInfo.filter(file => file.Type !== 1);
                // 剔除反选的文件,并添加文件夹名称
                fileInfo.filter(file => !fileSelectInfo.unselectedRowKeys.includes(file.FileId.toString())).forEach(file => {
                    file.FolderName = "";
                });
                // 放到全局属性里，方便后面递归继续添加
                this.fileInfoList.push(...fileInfo);
                fileSelectFloderInfoList = allFileInfo.filter(file => file.Type === 1).filter(file => !fileSelectInfo.unselectedRowKeys.includes(file.FileId.toString()));
                // const fileFolderInfo = fileInfo.filter(file => file.Type === 1);
                // for (const folder of fileFolderInfo) {
                //     await this.getAllFileInfoByFloderId(folder.FileId);
                // }
            } else {
                // 未全选
                let fileSelectIdList = fileSelectInfo.selectedRowKeys;
                if (!fileSelectIdList.length) {
                    this.progress = 100;
                    this.progressDesc = "未选择文件";
                    return "";
                }
                // 获取文件信息

                const allFileInfo = await this.getFileInfoBatch(fileSelectIdList);
                const fileInfo = allFileInfo.filter(info => info.Type !== 1);
                fileInfo.forEach(file => {
                    file.FolderName = "";
                });
                this.fileInfoList.push(...fileInfo);

                fileSelectFloderInfoList = allFileInfo.filter(info => info.Type === 1);
            }

            // 处理文件夹，递归获取全部文件
            this.progressDesc = "正在递归获取选择的文件，如果文件夹过多则可能耗时较长";
            for (let i = 0; i < fileSelectFloderInfoList.length; i++) {
                const folderInfo = fileSelectFloderInfoList[i];
                this.progress = Math.round((i / fileSelectFloderInfoList.length) * 100);
                await new Promise(resolve => setTimeout(resolve, this.getFloderInfoDelay));
                await this.getAllFileInfoByFloderId(folderInfo.FileId, folderInfo.FileName + "/", fileSelectFloderInfoList.length);
            }

            // 生成秒传链接
            const shareLink = this.fileInfoList.map(info => {
                if (info.Type === 0) {
                    return [info.Etag, info.Size, info.FileName.replace(/[%#$\/]/g, '')].join('#');
                }
            }).filter(Boolean).join('\n');

            // if (hasFolder) alert("文件夹暂时无法秒传，将被忽略");
            this.progressDesc = "秒传链接生成完成";
            return shareLink;
        }

        parseShareLink(shareLink) {
            const shareLinkList = Array.from(shareLink.replace(/\r?\n/g, '$').split('$'));
            return shareLinkList.map(singleShareLink => {
                const singleFileInfoList = singleShareLink.split('#');
                if (singleFileInfoList.length < 3) return null;
                return {
                    etag: singleFileInfoList[0],
                    size: singleFileInfoList[1],
                    fileName: singleFileInfoList[2]
                };
            }).filter(Boolean);
        }

        async saveShareLink(shareLink) {
            const shareFileList = this.parseShareLink(shareLink);
            const total = shareFileList.length;
            let completed = 0;
            let success = 0;
            let failed = 0;
            let successList = [];
            let failedList = [];
            for (let i = 0; i < shareFileList.length; i++) {
                const fileInfo = shareFileList[i];
                if (!fileInfo) continue;
                if (i > 0) {
                    await new Promise(resolve => setTimeout(resolve, this.saveLinkDelay));
                }
                const reuse = await this.apiClient.getFile(fileInfo);
                if (reuse) {
                    success++;
                    successList.push(fileInfo.fileName);
                } else {
                    failed++;
                    console.error('[123FASTLINK] [ShareLinkManager]', '保存文件失败:', fileInfo.fileName);
                    failedList.push(fileInfo.fileName);
                }
                completed++;
                console.log('[123FASTLINK] [ShareLinkManager]', '已保存:', fileInfo.fileName);
                console.log(completed);
                this.progress = Math.round((completed / total) * 100);
                this.progressDesc = `正在保存第 ${completed} / ${total} 个文件...`;
            }
            //this.progress = 100;
            this.progressDesc = "保存完成";
            return {
                success: successList,
                failed: failedList
            };
        }

        // 添加从JSON解析秒传链接的方法
        parseJsonShareLink(jsonContent) {
            try {
                const json = typeof jsonContent === 'string' ? JSON.parse(jsonContent) : jsonContent;
                return ShareLinkJsonManager.parseJsonShareLink(json);
            } catch (error) {
                console.error('[123FASTLINK] [ShareLinkManager]', '解析JSON失败:', error);
                return [];
            }
        }

        // 保存JSON格式的秒传链接
        async saveJsonShareLink(jsonContent) {
            const shareFileList = this.parseJsonShareLink(jsonContent);
            if (shareFileList.length === 0) {
                throw new Error('无效的JSON格式或没有找到文件信息');
            }

            const total = shareFileList.length;
            let completed = 0;
            let success = 0;
            let failed = 0;
            let successList = [];
            let failedList = [];

            for (let i = 0; i < shareFileList.length; i++) {
                const fileInfo = shareFileList[i];
                if (!fileInfo) continue;
                if (i > 0) {
                    await new Promise(resolve => setTimeout(resolve, this.saveLinkDelay));
                }
                const reuse = await this.apiClient.getFile(fileInfo);
                if (reuse) {
                    success++;
                    successList.push(fileInfo.fileName);
                } else {
                    failed++;
                    console.error('[123FASTLINK] [ShareLinkManager]', '保存文件失败:', fileInfo.fileName);
                    failedList.push(fileInfo.fileName);
                }
                completed++;
                console.log('[123FASTLINK] [ShareLinkManager]', '已保存:', fileInfo.fileName);
                this.progress = Math.round((completed / total) * 100);
                this.progressDesc = `正在保存第 ${completed} / ${total} 个文件...`;
            }
            this.progressDesc = "保存完成";
            return {
                success: successList,
                failed: failedList
            };
        }
    }

    // 4. UI管理类
    class UiManager {
        constructor(shareLinkManager) {
            this.shareLinkManager = shareLinkManager;
            this.isProgressMinimized = false;
            this.minimizeWidgetId = 'progress-minimize-widget';
            this.currentShareLink = ''; // 存储当前秒传链接
        }

        insertStyle() {
            if (!document.getElementById("modal-style")) {
                let style = document.createElement("style");
                style.id = "modal-style";
                style.innerHTML = `
                .modal-overlay { display: flex; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0, 0, 0, 0.6); backdrop-filter: blur(4px); justify-content: center; align-items: center; z-index: 10000; animation: fadeIn 0.3s ease-out; }
                .modal { background: #fff; padding: 32px; border-radius: 16px; box-shadow: 0 20px 60px rgba(0, 0, 0, 0.15), 0 8px 16px rgba(0, 0, 0, 0.1); text-align: center; width: 480px; max-width: 90vw; max-height: 90vh; overflow: hidden; position: relative; border: 1px solid rgba(255, 255, 255, 0.2); animation: modalSlideIn 0.3s ease-out; }
                .close-btn { position: absolute; top: 16px; right: 16px; background: transparent; border: none; font-size: 24px; color: #999; cursor: pointer; width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; transition: all 0.2s ease; }
                .close-btn:hover { background: rgba(244, 67, 54, 0.1); color: #f44336; transform: scale(1.1); }
                .modal textarea { width: 100%; padding: 16px; margin: 0 0 24px 0; border: 2px solid #e1e5e9; border-radius: 12px; resize: vertical; min-height: 120px; font-family: 'Consolas', 'Monaco', 'Courier New', monospace; font-size: 14px; line-height: 1.5; background: #fafbfc; transition: all 0.3s ease; box-sizing: border-box; outline: none; }
                .modal textarea:focus { border-color: #4CAF50; background: #ffffff; box-shadow: 0 0 0 3px rgba(76, 175, 80, 0.1); transform: translateY(-2px); }
                .modal textarea.drag-over { border-color: #4CAF50; background: #f0f8f0; }
                .copy-btn { background: linear-gradient(135deg, #4CAF50 0%, #45a049 100%); color: white; border: none; padding: 14px 32px; cursor: pointer; border-radius: 8px; font-size: 16px; font-weight: 500; min-width: 120px; position: relative; overflow: hidden; transition: all 0.3s ease; box-shadow: 0 4px 12px rgba(76, 175, 80, 0.3); }
                .copy-btn:hover { transform: translateY(-2px); box-shadow: 0 8px 20px rgba(76, 175, 80, 0.4); }
                .copy-btn:active { transform: translateY(0); box-shadow: 0 2px 8px rgba(76, 175, 80, 0.3); }
                .button-group { display: flex; gap: 12px; align-items: center; justify-content: center; position: relative; }
                .copy-dropdown { position: relative; display: inline-block; }
                .copy-dropdown-menu { position: absolute; bottom: 100%; left: 0; background: #fff; border: 1px solid #ddd; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); display: none; min-width: 120px; z-index: 10001; margin-bottom: 5px; }
                .copy-dropdown:hover .copy-dropdown-menu { display: block; }
                .copy-dropdown-item { padding: 10px 16px; cursor: pointer; transition: background 0.2s; font-size: 14px; border-bottom: 1px solid #f0f0f0; }
                .copy-dropdown-item:last-child { border-bottom: none; }
                .copy-dropdown-item:hover { background: #f5f5f5; }
                .copy-dropdown-item:first-child { border-radius: 8px 8px 0 0; }
                .copy-dropdown-item:last-child { border-radius: 0 0 8px 8px; }
                .export-btn { background: linear-gradient(135deg, #2196F3 0%, #1976D2 100%); color: white; border: none; padding: 14px 24px; cursor: pointer; border-radius: 8px; font-size: 16px; font-weight: 500; min-width: 100px; transition: all 0.3s ease; box-shadow: 0 4px 12px rgba(33, 150, 243, 0.3); }
                .export-btn:hover { transform: translateY(-2px); box-shadow: 0 8px 20px rgba(33, 150, 243, 0.4); }
                .file-input-btn { background: linear-gradient(135deg, #FF9800 0%, #F57C00 100%); color: white; border: none; padding: 14px 24px; cursor: pointer; border-radius: 8px; font-size: 16px; font-weight: 500; min-width: 100px; transition: all 0.3s ease; box-shadow: 0 4px 12px rgba(255, 152, 0, 0.3); }
                .file-input-btn:hover { transform: translateY(-2px); box-shadow: 0 8px 20px rgba(255, 152, 0, 0.4); }
                .file-input { display: none; }
                .toast { position: fixed; top: 20px; right: 20px; background: #fff; color: #333; padding: 12px 20px; border-radius: 8px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15); z-index: 10002; font-size: 14px; max-width: 300px; animation: toastSlideIn 0.3s ease-out; }
                .toast.success { border-left: 4px solid #4CAF50; }
                .toast.error { border-left: 4px solid #f44336; }
                .toast.warning { border-left: 4px solid #ff9800; }
                .toast.info { border-left: 4px solid #2196F3; }
                .progress-minimize-btn{position:absolute;left:-10px;top:-10px;width:30px;height:30px;border-radius:50%;background:#ffc504;color:#000000ff;border:none;display:flex;align-items:center;justify-content:center;font-weight:700;cursor:pointer;box-shadow:0 2px 6px rgba(0,0,0,0.15);z-index:10003}.progress-minimize-btn:hover{transform:scale(1.05)}
                .minimized-widget{position:fixed;right:20px;bottom:20px;width:220px;background:#fff;border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,0.18);padding:10px 12px;z-index:10005;display:flex;align-items:center;gap:10px;cursor:pointer}
                .minimized-widget .mini-bar{flex:1}
                .minimized-widget .mini-title{font-size:12px;color:#333;margin-bottom:6px}
                .minimized-widget .mini-progress{height:8px;background:#eee;border-radius:6px;overflow:hidden}
                .minimized-widget .mini-progress>i{display:block;height:100%;background:#4CAF50;width:0%;transition:width 0.2s}
                .minimized-widget .mini-percent{font-size:12px;color:#666;width:36px;text-align:right}
                .toast-shake {animation: toastShake 0.4s cubic-bezier(.36,.07,.19,.97) both, toastSlideIn 0.3s ease-out;}
                @keyframes toastShake {
                    10%, 90% { transform: translateX(-2px); }
                    20%, 80% { transform: translateX(4px); }
                    30%, 50%, 70% { transform: translateX(-8px); }
                    40%, 60% { transform: translateX(8px); }
                    100% { transform: translateX(0); }
                }
                `;
                document.head.appendChild(style);
            }
        }

        showToast(message, type = 'info', duration = 3000) {
            this.insertStyle();
            const toast = document.createElement('div');
            toast.className = `toast ${type} toast-shake`; // 添加 toast-shake 类
            toast.textContent = message;
            document.body.appendChild(toast);

            setTimeout(() => {
                toast.style.animation = 'toastSlideOut 0.3s ease-out forwards';
                setTimeout(() => {
                    if (toast.parentNode) {
                        toast.parentNode.removeChild(toast);
                    }
                }, 300);
            }, duration);
        }

        showCopyModal(defaultText = "") {
            this.insertStyle();
            this.currentShareLink = defaultText;
            let existingModal = document.getElementById('modal');
            if (existingModal) existingModal.remove();

            let modalOverlay = document.createElement('div');
            modalOverlay.className = 'modal-overlay';
            modalOverlay.id = 'modal';
            modalOverlay.innerHTML = `
                <div class="modal">
                    <button class="close-btn" onclick="document.getElementById('modal').remove()">×</button>
                    <h3>🚀 秒传链接</h3>
                    <textarea id="copyText" placeholder="请输入或粘贴秒传链接...">${defaultText}</textarea>
                    <div class="button-group">
                        <div class="copy-dropdown">
                            <button class="copy-btn" id="massageboxButton">
                                复制 ▼
                            </button>
                            <div class="copy-dropdown-menu">
                                <div class="copy-dropdown-item" data-type="text">复制纯文本</div>
                                <div class="copy-dropdown-item" data-type="json">复制JSON</div>
                            </div>
                        </div>
                        <button class="export-btn" id="exportJsonButton">导出JSON</button>
                    </div>
                </div>
            `;

            // 复制按钮事件
            modalOverlay.querySelector('#massageboxButton').addEventListener('click', () => {
                this.copyContent('text');
            });

            // 下拉菜单事件
            modalOverlay.querySelectorAll('.copy-dropdown-item').forEach(item => {
                item.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const type = item.dataset.type;
                    this.copyContent(type);
                });
            });

            // 导出JSON按钮事件
            modalOverlay.querySelector('#exportJsonButton').addEventListener('click', () => {
                this.exportJson();
            });

            modalOverlay.addEventListener('click', (e) => {
                if (e.target === modalOverlay) modalOverlay.remove();
            });

            document.body.appendChild(modalOverlay);
            setTimeout(() => {
                const textarea = modalOverlay.querySelector('#copyText');
                if (textarea && !defaultText) textarea.focus();
            }, 100);
        }

        copyContent(type) {
            const inputField = document.querySelector('#copyText');
            if (!inputField) return;

            let contentToCopy = inputField.value;

            if (type === 'json') {
                try {
                    const jsonData = ShareLinkJsonManager.shareLinkToJson(contentToCopy);
                    contentToCopy = JSON.stringify(jsonData, null, 2);
                } catch (error) {
                    this.showToast('转换JSON失败: ' + error.message, 'error');
                    return;
                }
            }

            navigator.clipboard.writeText(contentToCopy).then(() => {
                this.showToast(`已成功复制${type === 'json' ? 'JSON' : '纯文本'}到剪贴板 📋`, 'success');
            }).catch(err => {
                this.showToast(`复制失败: ${err.message || '请手动复制内容'}`, 'error');
            });
        }

        exportJson() {
            const inputField = document.querySelector('#copyText');
            if (!inputField) return;

            const shareLink = inputField.value;
            if (!shareLink.trim()) {
                this.showToast('没有内容可导出', 'warning');
                return;
            }

            try {
                const jsonData = ShareLinkJsonManager.shareLinkToJson(shareLink);
                const jsonContent = JSON.stringify(jsonData, null, 2);
                const filename = this.getExportFilename(shareLink);

                this.downloadJsonFile(jsonContent, filename);
                this.showToast('JSON文件导出成功 📁', 'success');
            } catch (error) {
                this.showToast('导出失败: ' + error.message, 'error');
            }
        }

        // 下载JSON文件
        downloadJsonFile(content, filename) {
            const blob = new Blob([content], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }

        // 获取文件名用于JSON导出
        getExportFilename(shareLink) {
            const lines = shareLink.trim().split('\n').filter(Boolean);
            if (lines.length === 0) return 'export.json';

            const firstLine = lines[0];
            const parts = firstLine.split('#');
            if (parts.length >= 3) {
                const fileName = parts[2];
                const baseName = fileName.split('/').pop().split('.')[0] || 'export';
                return `${baseName}.json`;
            }
            return 'export.json';
        }

        // TODO 进度格式化，文字长度限制
        showProgressModal(title = "正在处理...", percent = 0, desc = "") {
            // 如果处于最小化状态，则展示/更新右下角浮动卡片并返回
            if (this.isProgressMinimized) {
                this.createOrUpdateMinimizedWidget(title, percent, desc);
                return;
            }

            let modal = document.getElementById('progress-modal');
            if (!modal) {
                modal = document.createElement('div');
                modal.id = 'progress-modal';
                modal.style = 'position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:10001;background:rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;';
                modal.innerHTML = `
                    <div id="progress-card" style="position:relative;background:#fff;padding:32px 48px;border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,0.15);min-width:320px;text-align:center;">
                        <button class="progress-minimize-btn" title="最小化">−</button>
                        <div id="progress-title" style="margin-bottom:16px;font-size:18px;">${title}</div>
                        <div style="background:#eee;border-radius:8px;overflow:hidden;height:18px;">
                            <div id="progress-bar" style="background:#4CAF50;height:18px;width:${percent}%;transition:width 0.2s;"></div>
                        </div>
                        <div id="progress-percent" style="margin-top:8px;font-size:14px;">${percent}%</div>
                        <div id="progress-desc" style="margin-top:8px;font-size:13px;color:#888;">${desc}</div>
                    </div>
                `;
                document.body.appendChild(modal);

                // 绑定最小化按钮事件（点击后移除模态并创建右下角浮动卡片）
                const btn = modal.querySelector('.progress-minimize-btn');
                if (!btn.dataset.bound) {
                    btn.dataset.bound = 'true';
                    btn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        this.isProgressMinimized = true;
                        // 读取当前进度显示到浮动卡片
                        const curTitle = modal.querySelector('#progress-title')?.innerText || title;
                        const curPercent = parseInt(modal.querySelector('#progress-percent')?.innerText || percent) || 0;
                        const curDesc = modal.querySelector('#progress-desc')?.innerText || desc;
                        this.removeProgressModalAndKeepState();
                        this.createOrUpdateMinimizedWidget(curTitle, curPercent, curDesc);
                    });
                }
            } else {
                modal.querySelector('#progress-title').innerText = title;
                modal.querySelector('#progress-bar').style.width = percent + '%';
                modal.querySelector('#progress-percent').innerText = percent + '%';
                modal.querySelector('#progress-desc').innerText = desc;
            }
        }
        // 隐藏模态并删除浮动卡片
        hideProgressModal() {
            const modal = document.getElementById('progress-modal');
            if (modal) modal.remove();
            this.removeMinimizedWidget();
            this.isProgressMinimized = false;
        }

        // 移除模态但保留 isProgressMinimized 标志（供最小化按钮调用）
        removeProgressModalAndKeepState() {
            const modal = document.getElementById('progress-modal');
            if (modal) modal.remove();
        }

        // 创建或更新右下角最小化浮动卡片
        createOrUpdateMinimizedWidget(title = '正在处理...', percent = 0, desc = '') {
            let widget = document.getElementById(this.minimizeWidgetId);
            const html = `
                <div class="mini-bar">
                    <div class="mini-title">${title}</div>
                    <div class="mini-progress"><i style="width:${percent}%"></i></div>
                </div>
                <div class="mini-percent">${percent}%</div>
            `;
            if (!widget) {
                widget = document.createElement('div');
                widget.id = this.minimizeWidgetId;
                widget.className = 'minimized-widget';
                widget.innerHTML = html;
                // 修复点击不灵敏：用mousedown替换click，并阻止冒泡
                widget.addEventListener('mousedown', (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    this.isProgressMinimized = false;
                    this.removeMinimizedWidget();
                    // 重新显示模态，使用当前进度值
                    this.showProgressModal(title, percent, desc);
                });
                document.body.appendChild(widget);
            } else {
                widget.innerHTML = html;
            }
        }

        removeMinimizedWidget() {
            const w = document.getElementById(this.minimizeWidgetId);
            if (w) w.remove();
        }

        async showGenerateModal() {
            // 轮询进度
            const mgr = this.shareLinkManager;
            // this.showProgressModal("生成秒传链接", 0, "准备中...");
            mgr.progress = 0;
            const poll = setInterval(() => {
                this.showProgressModal("生成秒传链接", mgr.progress, mgr.progressDesc);
                if (mgr.progress > 100) {
                    clearInterval(poll);
                    setTimeout(() => this.hideProgressModal(), 500);
                }
            }, 500);

            const shareLink = await mgr.generateShareLink();
            if (!shareLink) {
                this.showToast("没有选择文件", 'warning');
                clearInterval(poll);
                return;
            }
            clearInterval(poll);
            this.hideProgressModal();
            this.showCopyModal(shareLink);
        }
        async showResultsModal(result) {
            this.insertStyle();
            let existingModal = document.getElementById('results-modal');
            if (existingModal) existingModal.remove();

            const totalCount = result.success.length + result.failed.length;
            const successCount = result.success.length;
            const failedCount = result.failed.length;

            let failedListHtml = '';
            if (failedCount > 0) {
                failedListHtml = `
                    <div style="margin-top: 12px; color: #f44336; font-size: 14px;">
                        <div style="margin-bottom: 6px;">失败文件列表：</div>
                        <div style="max-height: 160px; overflow-y: auto; background: #f5f5f5; border-radius: 4px; padding: 8px;">
                            ${result.failed.map(fileName => `<div style="font-size: 13px; color: #b71c1c; margin: 2px 0;">${fileName}</div>`).join('')}
                        </div>
                    </div>
                `;
            }

            let modalOverlay = document.createElement('div');
            modalOverlay.className = 'modal-overlay';
            modalOverlay.id = 'results-modal';
            modalOverlay.innerHTML = `
                <div class="modal">
                    <button class="close-btn" onclick="document.getElementById('results-modal').remove()">×</button>
                    <h3>📊 保存结果</h3>
                    <div style="margin: 20px 0; text-align: left;">
                        <div style="font-size: 16px; margin-bottom: 16px;">
                            <span style="color: #666;">总计：</span><strong>${totalCount}</strong> 个文件
                        </div>
                        <div style="font-size: 16px; margin-bottom: 8px; color: #4CAF50;">
                            ✅ 成功：<strong>${successCount}</strong> 个
                        </div>
                        <div style="font-size: 16px; margin-bottom: 8px; color: ${failedCount > 0 ? '#f44336' : '#666'};">
                            ${failedCount > 0 ? '❌' : '✅'} 失败：<strong>${failedCount}</strong> 个
                        </div>
                        ${failedListHtml}
                    </div>
                    <button class="copy-btn" onclick="document.getElementById('results-modal').remove()">确定</button>
                </div>
            `;

            modalOverlay.addEventListener('click', (e) => {
                if (e.target === modalOverlay) modalOverlay.remove();
            });

            document.body.appendChild(modalOverlay);
        }

        async showSaveModal() {
            this.insertStyle();
            let existingModal = document.getElementById('save-modal');
            if (existingModal) existingModal.remove();

            let modalOverlay = document.createElement('div');
            modalOverlay.className = 'modal-overlay';
            modalOverlay.id = 'save-modal';
            modalOverlay.innerHTML = `
                <div class="modal">
                    <button class="close-btn" onclick="document.getElementById('save-modal').remove()">×</button>
                    <h3>📥 保存秒传链接</h3>
                    <textarea id="saveText" placeholder="请输入或粘贴秒传链接，或拖入JSON文件导入..."></textarea>
                    <div class="button-group">
                        <button class="copy-btn" id="saveButton">保存</button>
                        <button class="file-input-btn" id="selectFileButton">选择JSON</button>
                        <input type="file" class="file-input" id="jsonFileInput" accept=".json">
                    </div>
                </div>
            `;

            const textarea = modalOverlay.querySelector('#saveText');
            const fileInput = modalOverlay.querySelector('#jsonFileInput');
            const selectFileBtn = modalOverlay.querySelector('#selectFileButton');

            // 设置文件拖拽和选择
            this.setupFileDropAndInput(textarea, fileInput);

            // 选择文件按钮
            selectFileBtn.addEventListener('click', () => {
                fileInput.click();
            });

            modalOverlay.querySelector('#saveButton').addEventListener('click', async () => {
                const content = document.getElementById("saveText").value;
                if (!content.trim()) {
                    this.showToast("请输入秒传链接或导入JSON文件", 'warning');
                    return;
                }

                modalOverlay.remove();

                this.showProgressModal("保存秒传链接", 0, "准备中...");
                this.shareLinkManager.progress = 0;
                const poll = setInterval(() => {
                    this.showProgressModal("保存秒传链接", this.shareLinkManager.progress, this.shareLinkManager.progressDesc);
                    // 正常情况下不主动清除
                    if (this.shareLinkManager.progress > 100) {
                        clearInterval(poll);
                    }
                }, 100);

                let saveResult;
                try {
                    // 尝试作为JSON解析
                    const jsonData = ShareLinkJsonManager.safeParse(content);
                    if (jsonData && ShareLinkJsonManager.validateJson(jsonData)) {
                        saveResult = await this.shareLinkManager.saveJsonShareLink(jsonData);
                    } else {
                        // 作为普通秒传链接处理
                        saveResult = await this.shareLinkManager.saveShareLink(content);
                    }
                } catch (error) {
                    console.error('保存失败:', error);
                    saveResult = { success: [], failed: ['保存过程中发生错误'] };
                }

                clearInterval(poll);
                this.hideProgressModal();

                this.showResultsModal(saveResult);
                this.showToast(saveResult ? "保存成功" : "保存失败", saveResult ? 'success' : 'error');

                // 刷新页面
                const renewButton = document.querySelector('.layout-operate-icon.mfy-tooltip svg');
                if (renewButton) {
                    const clickEvent = new MouseEvent('click', {
                        bubbles: true,
                        cancelable: true,
                        view: window
                    });
                    renewButton.dispatchEvent(clickEvent);
                }
            });

            modalOverlay.addEventListener('click', (e) => {
                if (e.target === modalOverlay) modalOverlay.remove();
            });

            document.body.appendChild(modalOverlay);
            setTimeout(() => {
                const textarea = modalOverlay.querySelector('#saveText');
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

        readJsonFile(file, textarea) {
            if (!file.name.toLowerCase().endsWith('.json')) {
                this.showToast('请选择JSON文件', 'warning');
                return;
            }

            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const jsonContent = e.target.result;
                    const jsonData = JSON.parse(jsonContent);

                    if (ShareLinkJsonManager.validateJson(jsonData)) {
                        const shareLink = ShareLinkJsonManager.jsonToShareLink(jsonData);
                        textarea.value = shareLink;
                        this.showToast('JSON文件导入成功 ✅', 'success');
                    } else {
                        this.showToast('无效的JSON格式', 'error');
                    }
                } catch (error) {
                    this.showToast('JSON文件解析失败: ' + error.message, 'error');
                }
            };
            reader.readAsText(file);
        }

        addButton() {
            const buttonExist = document.querySelector('.mfy-button-container');
            if (buttonExist) return;
            const isFilePage = window.location.pathname == "/" && (window.location.search == "" || window.location.search.includes("homeFilePath"));
            if (!isFilePage) return;
            const container = document.querySelector('.home-operator-button-group');
            if (!container) return;
            const btnContainer = document.createElement('div');
            btnContainer.className = 'mfy-button-container';
            btnContainer.style.position = 'relative';
            btnContainer.style.display = 'inline-block';
            const btn = document.createElement('button');
            btn.className = 'ant-btn css-dev-only-do-not-override-168k93g ant-btn-default ant-btn-color-default ant-btn-variant-outlined mfy-button create-button';
            btn.style.background = "#4CAF50";
            btn.style.color = "#fff";
            btn.style.border = "none";
            btn.innerHTML = `<svg t="1753345987410" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="2781" width="16" height="16"><path d="M395.765333 586.570667h-171.733333c-22.421333 0-37.888-22.442667-29.909333-43.381334L364.768 95.274667A32 32 0 0 1 394.666667 74.666667h287.957333c22.72 0 38.208 23.018667 29.632 44.064l-99.36 243.882666h187.050667c27.509333 0 42.186667 32.426667 24.042666 53.098667l-458.602666 522.56c-22.293333 25.408-63.626667 3.392-54.976-29.28l85.354666-322.421333z" fill="#ffffff" p-id="2782"></path></svg><span>秒传</span>`;
            const dropdown = document.createElement('div');
            dropdown.className = 'mfy-dropdown';
            dropdown.style.display = 'none';
            dropdown.style.position = 'absolute';
            dropdown.style.top = 'calc(100% + 5px)';
            dropdown.style.left = '0';
            dropdown.style.backgroundColor = '#fff';
            dropdown.style.border = '1px solid #d9d9d9';
            dropdown.style.borderRadius = '10px';
            dropdown.style.boxShadow = '0 2px 8px rgba(0,0,0,0.15)';
            dropdown.style.zIndex = '1000';
            dropdown.style.minWidth = '120px';
            dropdown.style.overflow = 'hidden';
            dropdown.innerHTML = `
                <div class="mfy-dropdown-item" data-action="generate">生成秒传连接</div>
                <div class="mfy-dropdown-item" data-action="save">保存秒传连接</div>
            `;
            const style = document.createElement('style');
            style.textContent = `
                .mfy-button-container:hover .mfy-dropdown { display: block !important; }
                .mfy-dropdown-item { padding: 8px 12px; cursor: pointer; transition: background 0.3s; font-size: 14px; }
                .mfy-dropdown-item:hover { background-color: #f5f5f5; }
                .mfy-dropdown::before { content: ''; position: absolute; top: -5px; left: 0; width: 100%; height: 5px; background: transparent; }
            `;
            document.head.appendChild(style);
            btnContainer.appendChild(btn);
            btnContainer.appendChild(dropdown);
            container.insertBefore(btnContainer, container.firstChild);
            dropdown.querySelectorAll('.mfy-dropdown-item').forEach(item => {
                item.addEventListener('click', async () => {
                    const action = item.dataset.action;
                    if (action === 'generate') {
                        await this.showGenerateModal();
                    } else if (action === 'save') {
                        await this.showSaveModal();
                    }
                    dropdown.style.display = 'none';
                });
            });
            btnContainer.addEventListener('mouseenter', function () {
                dropdown.style.display = 'block';
            });
            btnContainer.addEventListener('mouseleave', function () {
                let timer;
                clearTimeout(timer);
                timer = setTimeout(() => {
                    dropdown.style.display = 'none';
                }, 300);
            });
        }
    }

    // 实例化并初始化
    const apiClient = new PanApiClient();
    const selector = new TableRowSelector();
    const shareLinkManager = new ShareLinkManager(apiClient, selector);
    const uiManager = new UiManager(shareLinkManager);

    selector.init();


    if (DEBUG) {
        window._apiClient = apiClient;
        window._shareLinkManager = shareLinkManager;
        window._selector = selector;
        window._uiManager = uiManager;
    }

    // 页面加载和路由变化时添加按钮
    window.addEventListener('load', () => uiManager.insertStyle());
    window.addEventListener('load', () => uiManager.addButton());

    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;
    history.pushState = function () { originalPushState.apply(this, arguments); triggerUrlChange(); };
    history.replaceState = function () { originalReplaceState.apply(this, arguments); triggerUrlChange(); };
    window.addEventListener('popstate', triggerUrlChange);
    function triggerUrlChange() { setTimeout(() => uiManager.addButton(), 10); }
})();