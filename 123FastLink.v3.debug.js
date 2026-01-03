// ==UserScript==
// @name         123FastLink
// @namespace    http://tampermonkey.net/
// @version      2026.1.01.1
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
    const GlobalConfig = {
        scriptVersion: "3.1.1",
        usesBase62EtagsInExport: true,
        getFileListPageDelay: 500,
        getFileInfoBatchSize: 100,
        getFileInfoDelay: 200,
        getFolderInfoDelay: 300,
        saveLinkDelay: 100,
        mkdirDelay: 100,
        scriptName: "123FASTLINKV3",
        COMMON_PATH_LINK_PREFIX_V2: "123FLCPV2$"
    };
    const DEBUG = true;

    // 1. 123云盘API通信类
    class PanApiClient {
        constructor() {
            this.host = 'https://' + window.location.host;
            this.authToken = localStorage['authorToken'];
            this.loginUuid = localStorage['LoginUuid'];
            this.appVersion = '3';
            this.referer = document.location.href;
            this.getFileListPageDelay = GlobalConfig.getFileListPageDelay;
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
            const data = await this.sendRequest("POST", "/b/api/file/info", {}, JSON.stringify({ fileIdList }));
            return { data: { InfoList: data.data.infoList } };
        }

        async uploadRequest(fileInfo) {
            try {
                const response = await this.sendRequest('POST', '/b/api/file/upload_request', {}, JSON.stringify({
                    ...fileInfo, RequestSource: null
                }));
                const reuse = response['data']['Reuse'];
                console.log('[123FASTLINK] [PanApiClient]', 'reuse：', reuse);
                if (response['code'] !== 0) {
                    return [false, response['message']];
                }
                if (!reuse) {
                    console.error('[123FASTLINK] [PanApiClient]', '保存文件失败:', fileInfo.fileName, 'response:', response);
                    return [false, "未能实现秒传"];
                } else {
                    return [true, null];
                }
            } catch (error) {
                console.error('[123FASTLINK] [PanApiClient]', '上传请求失败:', error);
                return [false, '请求失败'];
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
        async getFile(fileInfo, parentFileId) {
            if (!parentFileId) {
                parentFileId = await this.getParentFileId();
            }
            return await this.uploadRequest({
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

            // 保存原始 createElement 方法
            const originalCreateElement = document.createElement;
            const self = this;
            document.createElement = function (tagName, options) {
                const element = originalCreateElement.call(document, tagName, options);
                if (!(tagName.toLowerCase() === 'input')) {
                    return element;
                }
                const observer = new MutationObserver(() => {
                    if (element.classList.contains('ant-checkbox-input')) {
                        if (
                            // 检查是否为全选框并绑定事件
                            element.getAttribute('aria-label') === 'Select all'
                        ) {
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
                    attributes: true,
                    attributeFilter: ['class', 'aria-label']
                });
                return element;
            };
            console.log('[123FASTLINK] [Selector] HOOK已激活');
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
            // this.selector = selector;
            this.progress = 0;
            this.progressDesc = "";
            this.taskCancel = false; // 取消当前任务的请求标志
            this.getFileInfoBatchSize = GlobalConfig.getFileInfoBatchSize;
            this.getFileInfoDelay = GlobalConfig.getFileInfoDelay;
            this.getFolderInfoDelay = GlobalConfig.getFolderInfoDelay;
            this.saveLinkDelay = GlobalConfig.saveLinkDelay;
            this.mkdirDelay = GlobalConfig.mkdirDelay;
            this.fileInfoList = [];
            // this.scriptName = GlobalConfig.scriptName,
            this.commonPath = "";
            this.COMMON_PATH_LINK_PREFIX_V2 = GlobalConfig.COMMON_PATH_LINK_PREFIX_V2;
            this.usesBase62EtagsInExport = GlobalConfig.usesBase62EtagsInExport;
            this.scriptVersion = GlobalConfig.scriptVersion;
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
         * 获取this.fileInfoList的公共路径
         * @returns this.commonPath / commonPath
         */
        async _getCommonPath() {
            if (!this.fileInfoList || this.fileInfoList.length === 0) return '';

            // 提取所有路径并转换为目录组件数组
            const pathArrays = this.fileInfoList.map(file => {
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
            this.commonPath = commonPath;
            return commonPath;
        }

        /**
         * 获取所有选择的文件,进入文件夹
         * @param {*} fileSelectionDetails - 来自selector.getSelection()
         * @returns  - 文件信息在this.fileInfoList里
         * @returns  - this.commonPath-公共路径
         * @returns  - boolean - 是否成功获取到文件
         */
        async _getSelectedFilesInfo(fileSelectionDetails) {
            this.fileInfoList = [];
            if (!fileSelectionDetails.isSelectAll && fileSelectionDetails.selectedRowKeys.length === 0) {
                return false;
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
                    return false;
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
                    return true; // 已经获取的文件保留
                }

                await this._getAllFileInfoByFolderId(folderInfo.fileId, folderInfo.fileName + "/", fileSelectFolderInfoList.length);
            }
            // 处理文件夹路径
            // 检查commonPath
            const commonPath = await this._getCommonPath();
            // 去除文件夹路径中的公共路径
            if (commonPath) {
                this.fileInfoList.forEach(info => {
                    // 切片
                    info.path = info.path.slice(commonPath.length);
                });
            }

            return true;
        }

        /**
         * 从选择文件生成分享链接
         * @param {*} fileSelectionDetails - 来自selector.getSelection()
         * @returns {Promise<string>} - 分享链接,如果未选择文件则返回空字符串
         */
        async generateShareLink(fileSelectionDetails) {
            this.progress = 0;
            this.progressDesc = "准备获取文件信息...";

            // 获取选中的文件（文件夹）的详细信息
            // this.fileInfoList, this.commonPath
            const result = await this._getSelectedFilesInfo(fileSelectionDetails);
            if (!result) return '';
            //// if (hasFolder) alert("文件夹暂时无法秒传，将被忽略");
            this.progressDesc = "秒传链接生成完成";
            return this.buildShareLink(this.fileInfoList, this.commonPath);
        }

        /**
         * 拼接链接
         * @param {*} fileInfoList - {etag: string, size: number, path: string, fileName: string}
         */
        buildShareLink(fileInfoList, commonPath) {
            const shareLinkFileInfo = fileInfoList.map(info => {
                //if (info.type === 0) {
                return [this.usesBase62EtagsInExport ? this._hexToBase62(info.etag) : info.etag, info.size, info.path.replace(/[%#$]/g, '')].join('#');
                //}
            }).filter(Boolean).join('$');
            const shareLink = `${this.COMMON_PATH_LINK_PREFIX_V2}${commonPath}%${shareLinkFileInfo}`;
            return shareLink;
        }

        /**
         * 解析秒传链接
         * @param {*} shareLink     秒传链接
         * @param {*} InputUsesBase62  输入是否使用Base62
         * @param {*} outputUsesBase62 输出是否使用Base62
         * @returns {Array} - {etag: string, size: number, path: string, fileName: string}
         */
        _parseShareLink(shareLink, InputUsesBase62 = true, outputUsesBase62 = false) {
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
                    return "[123FASTLINK] [ShareLinkManager] 不支持的公共路径格式:" + commonPathLinkPrefix;
                }

            } else {
                shareFileInfo = shareLink;
                InputUsesBase62 = false;
            }

            const shareLinkList = Array.from(shareFileInfo.replace(/\r?\n/g, '$').split('$'));
            this.commonPath = commonPath;
            return shareLinkList.map(singleShareLink => {
                const singleFileInfoList = singleShareLink.split('#');
                if (singleFileInfoList.length < 3) return null;
                return {
                    etag: InputUsesBase62 ? (outputUsesBase62 ? singleFileInfoList[0] : this._base62ToHex(singleFileInfoList[0])) : (outputUsesBase62 ? this._hexToBase62(singleFileInfoList[0]) : singleFileInfoList[0]),
                    size: singleFileInfoList[1],
                    path: singleFileInfoList[2],
                    fileName: singleFileInfoList[2].split('/').pop()
                };
            }).filter(Boolean);
        }

        /**
         * 先创建文件夹，给shareFileList添加上parentFolderId，便于保存文件
         * @param {*} fileList - {etag: string, size: number, path: string, fileName: string}
         * @returns shareFileList - {etag: string, size: number, path: string, fileName: string, parentFolderId: number}
         */
        async _makeDirForFiles(shareFileList) {
            const total = shareFileList.length;
            // 文件夹创建，并为shareFileList添加parentFolderId------------------------------------
            // 记录文件夹(path)
            this.progressDesc = `正在创建文件夹...`;
            let folder = {};
            // 如果存在commonPath，先创建文件夹
            const rootFolderId = await this.apiClient.getParentFileId();
            if (this.commonPath) {
                const commonPathParts = this.commonPath.split('/').filter(part => part !== '');
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
                let nowParentFolderId = folder[this.commonPath.slice(0, -1)] || rootFolderId;
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
                this.progressDesc = `正在保存第 ${completed} / ${total} 个文件...`;
            }
            // this.progress = 100;
            // this.progressDesc = "保存完成";
            return {
                success: successList, failed: failedList, commonPath: this.commonPath
            };
        }

        /**
         * 保存秒传链接
         */
        async saveTextShareLink(shareLink) {
            const shareFileList = this._parseShareLink(shareLink);
            return this._saveFileList(await this._makeDirForFiles(shareFileList));
        }

        /**
         * 保存JSON格式的秒传链接
         * @param {string} jsonContent
         * @returns {Promise<object>} - 保存结果
         */
        async saveJsonShareLink(jsonContent) {
            const shareFileList = this._parseJsonShareLink(jsonContent);
            return this._saveFileList(await this._makeDirForFiles(shareFileList));
        }

        async saveShareLink(content) {
            let saveResult = { success: [], failed: [] };
            try {
                // 尝试作为JSON解析
                const jsonData = this.safeParse(content);
                if (jsonData) {
                    saveResult = await this.saveJsonShareLink(jsonData);
                } else {
                    // 作为普通秒传链接处理
                    saveResult = await this.saveTextShareLink(content);
                    console.log('保存结果:', saveResult);
                }
            } catch (error) {
                console.error('保存失败:', error);
                saveResult = { success: [], failed: [] };
            }
            return saveResult;
        }

        /**
         * 重试保存失败的文件
         * @param {*} FileList - 包含parentFolderId - {etag: string, size: number, path: string, fileName: string, parentFolderId: number}
         * 失败的文件列表 - this.saveShareLink().failed
         * @returns
         */
        async retrySaveFailed(FileList) {
            return this._saveFileList(FileList);
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
         * @returns {Array} - {etag: string, size: number, path: string, fileName: string}
         */
        _parseJsonShareLink(jsonData) {
            this.commonPath = jsonData['commonPath'] || '';
            const shareFileList = jsonData['files'];
            if (jsonData['usesBase62EtagsInExport']) {
                shareFileList.forEach(file => {
                    file.etag = this._base62ToHex(file.etag);
                });
            }
            shareFileList.forEach(file => {
                file.fileName = file.path.split('/').pop();
            });
            return shareFileList;
        }

        // 格式化文件大小
        _formatSize(size) {
            if (size < 1024) return size + ' B';
            if (size < 1024 * 1024) return (size / 1024).toFixed(2) + ' KB';
            if (size < 1024 * 1024 * 1024) return (size / 1024 / 1024).toFixed(2) + ' MB';
            return (size / 1024 / 1024 / 1024).toFixed(2) + ' GB';
        }

        validateJson(json) {
            return (json && Array.isArray(json.files) && json.files.every(f => f.etag && f.size && f.path));
        }

        /**
         * 将秒传链接转换为JSON格式
         * @param {*} shareLink
         * @returns
         */
        shareLinkToJson(shareLink) {
            const fileInfo = this._parseShareLink(shareLink);
            if (fileInfo.length === 0) {
                console.error('[123FASTLINK] [ShareLinkManager]', '解析秒传链接失败:', shareLink);
                return {
                    error: '解析秒传链接失败'
                };
            }
            if (this.usesBase62EtagsInExport) {
                fileInfo.forEach(f => {
                    f.etag = this._hexToBase62(f.etag);
                });
            }
            const totalSize = fileInfo.reduce((sum, f) => sum + Number(f.size), 0);
            return {
                scriptVersion: this.scriptVersion,
                exportVersion: "1.0",
                usesBase62EtagsInExport: this.usesBase62EtagsInExport,
                commonPath: this.commonPath,
                totalFilesCount: fileInfo.length,
                totalSize,
                formattedTotalSize: this._formatSize(totalSize),
                files: fileInfo.map(f => ({
                    // 去掉fileName
                    ...f, fileName: undefined
                }))
            };
        }
    }

    // 4. UI管理类
    class UiManager {
        constructor(shareLinkManager, selector) {
            this.shareLinkManager = shareLinkManager;
            this.selector = selector;
            this.isProgressMinimized = false;
            this.minimizeWidgetId = 'progress-minimize-widget';
            // this.currentShareLink = ''; // 存储当前秒传链接
            // taskList = [{id: string, type: 'generate'|'save', params: {}}]
            this.taskList = []; // 任务列表
            this.isTaskRunning = false; // 任务是否在运行
            this.taskIdCounter = 0; // 任务ID计数器
            this.currentTask = null; // 当前正在执行的任务
            // this.taskCancel = false; // 取消当前任务的请求标志
            this.iconLibrary = {
                transfer: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="16 18 22 12 16 6"></polyline>
                            <polyline points="8 6 2 12 8 18"></polyline>
                        </svg>`,
                generate: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path>
                            <polyline points="13 2 13 9 20 9"></polyline>
                        </svg>`,
                save: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
                            <polyline points="17 21 17 13 7 13 7 21"></polyline>
                            <polyline points="7 3 7 8 15 8"></polyline>
                        </svg>`
            };
        }

        /**
         * 初始化UI管理器，插入样式表，设置按钮事件
         */
        init() {
            // 按钮插入 ==========================================
            const features = [
                {
                    iconKey: 'generate',
                    text: '生成秒传链接',
                    handler: () => this.addAndRunTask('generate')
                },
                {
                    iconKey: 'save',
                    text: '保存秒传链接',
                    handler: () => this.showInputModal()
                }
            ];
            
            // 页面加载完成后插入样式表和添加按钮
            window.addEventListener('load', () => {
                this.insertStyle();
                this.addButton(
                    features
                );
            });
            
            // 监听URL变化，重新添加按钮，防止切换页面后按钮消失 =======

            const triggerUrlChange = () => {
                setTimeout(() => this.addButton(
                    features
                ), 10);
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
        }

        /**
         * 插入样式表
         */
        insertStyle() {
            if (!document.getElementById("modal-style")) {
                let style = document.createElement("style");
                style.id = "modal-style";
                style.innerHTML = `
                :root {
                    --primary-color: #6366f1;
                    --primary-hover: #4f46e5;
                    --secondary-color: #10b981;
                    --secondary-hover: #059669;
                    --danger-color: #ef4444;
                    --danger-hover: #dc2626;
                    --warning-color: #f59e0b;
                    --warning-hover: #d97706;
                    --info-color: #3b82f6;
                    --info-hover: #2563eb;
                    --background: #ffffff;
                    --surface: #f8fafc;
                    --border: #e2e8f0;
                    --text-primary: #1e293b;
                    --text-secondary: #64748b;
                    --text-tertiary: #94a3b8;
                    --shadow-sm: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
                    --shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
                    --shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
                    --shadow-xl: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
                    --radius-sm: 6px;
                    --radius: 12px;
                    --radius-lg: 16px;
                    --transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
                }

                .modal-overlay {
                    position: fixed;
                    top: 0;
                    left: 0;
                    width: 100vw;
                    height: 100vh;
                    background: rgba(0, 0, 0, 0.5);
                    backdrop-filter: blur(8px);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    z-index: 9999;
                    animation: fadeIn 0.2s ease-out;
                }

                .modal {
                    background: var(--background);
                    border-radius: var(--radius-lg);
                    box-shadow: var(--shadow-xl);
                    width: 90%;
                    max-width: 500px;
                    max-height: 90vh;
                    overflow: hidden;
                    border: 1px solid var(--border);
                    transform: translateY(0);
                    animation: slideUp 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                }

                .modal-header {
                    padding: 24px 24px 16px;
                    border-bottom: 1px solid var(--border);
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                }

                .modal-title {
                    font-size: 20px;
                    font-weight: 600;
                    color: var(--text-primary);
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }

                .modal-title svg {
                    width: 20px;
                    height: 20px;
                }

                .modal-close {
                    background: none;
                    border: none;
                    width: 32px;
                    height: 32px;
                    border-radius: 50%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    color: var(--text-secondary);
                    cursor: pointer;
                    transition: var(--transition);
                }

                .modal-close:hover {
                    background: var(--surface);
                    color: var(--text-primary);
                }

                .modal-content {
                    padding: 24px;
                }

                .modal-footer {
                    padding: 16px 24px 24px;
                    border-top: 1px solid var(--border);
                    display: flex;
                    gap: 12px;
                    justify-content: flex-end;
                }

                .file-input { display: none; }

                .file-list-container {
                    background: var(--surface);
                    border-radius: var(--radius);
                    padding: 16px;
                    margin-bottom: 20px;
                    max-height: 200px;
                    overflow-y: auto;
                }

                .file-list-header {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    margin-bottom: 12px;
                }

                .file-count {
                    font-size: 13px;
                    color: var(--text-secondary);
                    font-weight: 500;
                }

                .file-list {
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                }

                .file-item {
                    font-size: 13px;
                    color: var(--text-primary);
                    padding: 8px 12px;
                    background: white;
                    border-radius: var(--radius-sm);
                    border: 1px solid var(--border);
                    word-break: break-all;
                    line-height: 1.4;
                }

                .modal textarea {
                    width: 100%;
                    min-height: 120px;
                    padding: 16px;
                    border: 2px solid var(--border);
                    border-radius: var(--radius);
                    background: var(--surface);
                    color: var(--text-primary);
                    font-family: 'JetBrains Mono', 'Consolas', 'Monaco', monospace;
                    font-size: 13px;
                    line-height: 1.5;
                    resize: vertical;
                    transition: var(--transition);
                    box-sizing: border-box;
                }

                .modal textarea:focus {
                    outline: none;
                    border-color: var(--primary-color);
                    box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
                }

                .modal textarea.drag-over {
                    border-color: var(--primary-color);
                    background: rgba(99, 102, 241, 0.05);
                }

                .button-group {
                    display: flex;
                    gap: 12px;
                    align-items: center;
                }

                .btn {
                    padding: 10px 20px;
                    border-radius: var(--radius);
                    font-size: 14px;
                    font-weight: 500;
                    border: none;
                    cursor: pointer;
                    transition: var(--transition);
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    gap: 8px;
                    min-width: 100px;
                }

                .btn:disabled {
                    opacity: 0.5;
                    cursor: not-allowed;
                }

                .btn-primary {
                    background: linear-gradient(135deg, var(--primary-color), var(--primary-hover));
                    color: white;
                    box-shadow: var(--shadow);
                }

                .btn-primary:hover:not(:disabled) {
                    transform: translateY(-1px);
                    box-shadow: var(--shadow-lg);
                }

                .btn-secondary {
                    background: linear-gradient(135deg, var(--secondary-color), var(--secondary-hover));
                    color: white;
                    box-shadow: var(--shadow);
                }

                .btn-secondary:hover:not(:disabled) {
                    transform: translateY(-1px);
                    box-shadow: var(--shadow-lg);
                }

                .btn-outline {
                    background: white;
                    color: var(--text-primary);
                    border: 1px solid var(--border);
                }

                .btn-outline:hover:not(:disabled) {
                    background: var(--surface);
                    border-color: var(--text-secondary);
                }

                .btn-danger {
                    background: var(--danger-color);
                    color: white;
                }

                .btn-danger:hover:not(:disabled) {
                    background: var(--danger-hover);
                }

                .dropdown {
                    position: relative;
                }

                .dropdown-toggle {
                    display: inline-flex;
                    align-items: center;
                    gap: 4px;
                }

                .dropdown-menu {
                    position: absolute;
                    bottom: 100%;
                    left: 0;
                    background: white;
                    border: 1px solid var(--border);
                    border-radius: var(--radius);
                    box-shadow: var(--shadow-lg);
                    min-width: 140px;
                    z-index: 1001;
                    margin-bottom: 8px;
                    opacity: 0;
                    transform: translateY(10px);
                    visibility: hidden;
                    transition: var(--transition);
                }

                .dropdown:hover .dropdown-menu {
                    opacity: 1;
                    transform: translateY(0);
                    visibility: visible;
                }

                .dropdown-item {
                    padding: 10px 16px;
                    font-size: 13px;
                    color: var(--text-primary);
                    cursor: pointer;
                    transition: var(--transition);
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }

                .dropdown-item:hover {
                    background: var(--surface);
                }

                .dropdown-item:first-child {
                    border-radius: var(--radius) var(--radius) 0 0;
                }

                .dropdown-item:last-child {
                    border-radius: 0 0 var(--radius) var(--radius);
                }

                .dropdown-divider {
                    height: 1px;
                    background: var(--border);
                    margin: 4px 0;
                }

                .toast {
                    position: fixed;
                    top: 24px;
                    right: 24px;
                    background: white;
                    color: var(--text-primary);
                    padding: 12px 20px;
                    border-radius: var(--radius);
                    box-shadow: var(--shadow-lg);
                    z-index: 10002;
                    font-size: 14px;
                    max-width: 320px;
                    animation: slideInRight 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                    border-left: 4px solid var(--info-color);
                    display: flex;
                    align-items: center;
                    gap: 12px;
                }

                .toast.success {
                    border-left-color: var(--secondary-color);
                }

                .toast.error {
                    border-left-color: var(--danger-color);
                }

                .toast.warning {
                    border-left-color: var(--warning-color);
                }

                .toast.info {
                    border-left-color: var(--info-color);
                }

                .toast-icon {
                    width: 20px;
                    height: 20px;
                }

                .progress-modal {
                    animation: modalSlideIn 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                }

                .progress-content {
                    padding: 24px;
                    text-align: center;
                }

                .progress-title {
                    font-size: 18px;
                    font-weight: 600;
                    color: var(--text-primary);
                    margin-bottom: 20px;
                    word-break: break-all;
                    line-height: 1.4;
                }

                .progress-bar-container {
                    height: 8px;
                    background: var(--surface);
                    border-radius: 4px;
                    overflow: hidden;
                    margin-bottom: 12px;
                }

                .progress-bar {
                    height: 100%;
                    background: linear-gradient(90deg, var(--primary-color), var(--secondary-color));
                    border-radius: 4px;
                    transition: width 0.3s ease;
                }

                .progress-info {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    margin-bottom: 16px;
                }

                .progress-percent {
                    font-size: 16px;
                    font-weight: 600;
                    color: var(--primary-color);
                }

                .progress-desc {
                    font-size: 13px;
                    color: var(--text-secondary);
                    text-align: left;
                    background: var(--surface);
                    padding: 12px;
                    border-radius: var(--radius);
                    margin-top: 16px;
                    word-break: break-all;
                    line-height: 1.4;
                }

                .progress-minimize-btn {
                    position: absolute;
                    top: 16px;
                    right: 16px;
                    width: 32px;
                    height: 32px;
                    border-radius: 50%;
                    background: var(--surface);
                    border: 1px solid var(--border);
                    color: var(--text-secondary);
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    transition: var(--transition);
                }

                .progress-minimize-btn:hover {
                    background: var(--border);
                    color: var(--text-primary);
                }

                .minimized-widget {
                    position: fixed;
                    right: 24px;
                    bottom: 24px;
                    background: white;
                    border-radius: var(--radius);
                    box-shadow: var(--shadow-lg);
                    padding: 12px 16px;
                    z-index: 10005;
                    min-width: 240px;
                    cursor: pointer;
                    transition: var(--transition);
                    border: 1px solid var(--border);
                }

                .minimized-widget:hover {
                    transform: translateY(-2px);
                    box-shadow: var(--shadow-xl);
                }

                .widget-header {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    margin-bottom: 8px;
                }

                .widget-title {
                    font-size: 12px;
                    font-weight: 500;
                    color: var(--text-primary);
                }

                .widget-badge {
                    background: var(--danger-color);
                    color: white;
                    font-size: 11px;
                    font-weight: 600;
                    padding: 2px 8px;
                    border-radius: 10px;
                }

                .widget-progress {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                }

                .widget-bar {
                    flex: 1;
                    height: 4px;
                    background: var(--surface);
                    border-radius: 2px;
                    overflow: hidden;
                }

                .widget-fill {
                    height: 100%;
                    background: linear-gradient(90deg, var(--primary-color), var(--secondary-color));
                    border-radius: 2px;
                }

                .widget-percent {
                    font-size: 12px;
                    font-weight: 600;
                    color: var(--primary-color);
                    min-width: 40px;
                }

                .task-list-container {
                    margin-top: 20px;
                }

                .task-toggle {
                    width: 100%;
                    padding: 10px 16px;
                    background: var(--surface);
                    border: 1px solid var(--border);
                    border-radius: var(--radius);
                    color: var(--text-secondary);
                    font-size: 13px;
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    cursor: pointer;
                    transition: var(--transition);
                }

                .task-toggle:hover {
                    background: #f1f5f9;
                }

                .task-toggle.active {
                    background: var(--primary-color);
                    color: white;
                    border-color: var(--primary-color);
                }

                .task-list {
                    max-height: 160px;
                    overflow-y: auto;
                    border: 1px solid var(--border);
                    border-top: none;
                    border-radius: 0 0 var(--radius) var(--radius);
                    background: white;
                    display: none;
                }

                .task-list.show {
                    display: block;
                }

                .task-item {
                    padding: 12px 16px;
                    border-bottom: 1px solid var(--border);
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    transition: var(--transition);
                }

                .task-item:last-child {
                    border-bottom: none;
                }

                .task-item.current {
                    background: rgba(99, 102, 241, 0.05);
                }

                .task-info {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }

                .task-icon {
                    width: 12px;
                    height: 12px;
                    border-radius: 50%;
                }

                .task-icon.generate {
                    background: var(--secondary-color);
                }

                .task-icon.save {
                    background: var(--info-color);
                }

                .task-icon.retry {
                    background: var(--warning-color);
                }

                .task-name {
                    font-size: 13px;
                    color: var(--text-primary);
                }

                .task-status {
                    font-size: 12px;
                    color: var(--text-secondary);
                }

                .task-remove {
                    width: 24px;
                    height: 24px;
                    border-radius: 50%;
                    border: none;
                    background: var(--surface);
                    color: var(--text-secondary);
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    transition: var(--transition);
                }

                .task-remove:hover {
                    background: var(--danger-color);
                    color: white;
                }

                .task-remove:disabled {
                    opacity: 0.5;
                    cursor: not-allowed;
                }

                .results-content {
                    text-align: left;
                }

                .results-stats {
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    gap: 16px;
                    margin-bottom: 20px;
                }

                .stat-card {
                    padding: 16px;
                    border-radius: var(--radius);
                    text-align: center;
                }

                .stat-card.success {
                    background: rgba(16, 185, 129, 0.1);
                    border: 1px solid rgba(16, 185, 129, 0.2);
                }

                .stat-card.failed {
                    background: rgba(239, 68, 68, 0.1);
                    border: 1px solid rgba(239, 68, 68, 0.2);
                }

                .stat-value {
                    font-size: 24px;
                    font-weight: 700;
                    margin-bottom: 4px;
                }

                .stat-value.success {
                    color: var(--secondary-color);
                }

                .stat-value.failed {
                    color: var(--danger-color);
                }

                .stat-label {
                    font-size: 12px;
                    color: var(--text-secondary);
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                }

                .failed-list {
                    max-height: 200px;
                    overflow-y: auto;
                    background: var(--surface);
                    border-radius: var(--radius);
                    padding: 12px;
                }

                .failed-item {
                    padding: 8px 12px;
                    background: white;
                    border-radius: var(--radius-sm);
                    border: 1px solid var(--border);
                    margin-bottom: 8px;
                    font-size: 12px;
                }

                .failed-item:last-child {
                    margin-bottom: 0;
                }

                .failed-name {
                    color: var(--text-primary);
                    word-break: break-all;
                }

                .failed-error {
                    color: var(--danger-color);
                    font-size: 11px;
                    margin-top: 4px;
                }

                .mfy-button-container {
                    position: relative;
                    display: inline-block;
                }

                .mfy-button {
                    display: inline-flex;
                    align-items: center;
                    gap: 8px;
                    padding: 8px 16px;
                    background: linear-gradient(135deg, var(--primary-color), var(--primary-hover));
                    color: white;
                    border: none;
                    border-radius: var(--radius);
                    font-size: 14px;
                    font-weight: 500;
                    cursor: pointer;
                    transition: var(--transition);
                    box-shadow: var(--shadow);
                }

                .mfy-button:hover {
                    transform: translateY(-1px);
                    box-shadow: var(--shadow-lg);
                }

                .mfy-button svg {
                    width: 16px;
                    height: 16px;
                }

                .mfy-dropdown {
                    position: absolute;
                    top: calc(100% + 4px);
                    left: 0;
                    background: white;
                    border: 1px solid var(--border);
                    border-radius: var(--radius);
                    box-shadow: var(--shadow-lg);
                    min-width: 160px;
                    z-index: 1000;
                    opacity: 0;
                    transform: translateY(-10px);
                    visibility: hidden;
                    transition: var(--transition);
                }

                .mfy-button-container:hover .mfy-dropdown {
                    opacity: 1;
                    transform: translateY(0);
                    visibility: visible;
                }

                .mfy-dropdown-item {
                    padding: 10px 16px;
                    font-size: 13px;
                    color: var(--text-primary);
                    cursor: pointer;
                    transition: var(--transition);
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }

                .mfy-dropdown-item:hover {
                    background: var(--surface);
                }

                .mfy-dropdown-item:first-child {
                    border-radius: var(--radius) var(--radius) 0 0;
                }

                .mfy-dropdown-item:last-child {
                    border-radius: 0 0 var(--radius) var(--radius);
                }

                .mfy-dropdown-divider {
                    height: 1px;
                    background: var(--border);
                    margin: 4px 0;
                }

                @keyframes fadeIn {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }

                @keyframes slideUp {
                    from {
                        opacity: 0;
                        transform: translateY(20px);
                    }
                    to {
                        opacity: 1;
                        transform: translateY(0);
                    }
                }

                @keyframes slideInRight {
                    from {
                        opacity: 0;
                        transform: translateX(100%);
                    }
                    to {
                        opacity: 1;
                        transform: translateX(0);
                    }
                }

                @keyframes modalSlideIn {
                    from {
                        opacity: 0;
                        transform: translateY(-20px) scale(0.95);
                    }
                    to {
                        opacity: 1;
                        transform: translateY(0) scale(1);
                    }
                }

                @keyframes pulse {
                    0%, 100% { opacity: 1; }
                    50% { opacity: 0.5; }
                }

                .animate-pulse {
                    animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
                }
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

        /**
         * 显示复制弹窗
         */
        showCopyModal(defaultText = "") {
            const fileListHtml = Array.isArray(this.shareLinkManager.fileInfoList) &&
                this.shareLinkManager.fileInfoList.length > 0 ? `
            <div class="file-list-container">
                <div class="file-list-header">
                    <div class="file-count">文件列表（共${this.shareLinkManager.fileInfoList.length}个）</div>
                </div>
                <div class="file-list">
                    ${this.shareLinkManager.fileInfoList.map(f => `
                        <div class="file-item">${f.path}</div>
                    `).join('')}
                </div>
            </div>
        ` : '';

            const modalOverlay = document.createElement('div');
            modalOverlay.className = 'modal-overlay';
            modalOverlay.innerHTML = `
            <div class="modal">
                <div class="modal-header">
                    <div class="modal-title">
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="16 18 22 12 16 6"></polyline>
                            <polyline points="8 6 2 12 8 18"></polyline>
                        </svg>
                        秒传链接
                    </div>
                    <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </button>
                </div>
                <div class="modal-content">
                    ${fileListHtml}
                    <textarea id="copyText" placeholder="请输入或粘贴秒传链接...">${defaultText}</textarea>
                </div>
                <div class="modal-footer">
                    <div class="dropdown">
                        <button class="btn btn-primary dropdown-toggle">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                            </svg>
                            复制
                        </button>
                        <div class="dropdown-menu">
                            <div class="dropdown-item" data-type="json">
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2"></path>
                                    <path d="M18 14h-8"></path>
                                    <path d="M15 18h-5"></path>
                                    <path d="M10 6h8v4h-8V6Z"></path>
                                </svg>
                                复制JSON
                            </div>
                            <div class="dropdown-item" data-type="text">
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <polyline points="16 18 22 12 16 6"></polyline>
                                    <polyline points="8 6 2 12 8 18"></polyline>
                                </svg>
                                复制纯文本
                            </div>
                        </div>
                    </div>
                    <button class="btn btn-secondary" id="exportJsonButton">
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
            const dropdownItems = modalOverlay.querySelectorAll('.dropdown-item');
            dropdownItems.forEach(item => {
                item.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const type = item.dataset.type;
                    this.copyContent(type);
                });
            });

            // 主复制按钮事件
            modalOverlay.querySelector('.dropdown-toggle').addEventListener('click', (e) => {
                e.stopPropagation();
                this.copyContent('text');
            });

            // 导出JSON按钮事件
            modalOverlay.querySelector('#exportJsonButton').addEventListener('click', (e) => {
                e.stopPropagation();
                this.exportJson();
            });

            // 点击遮罩关闭
            modalOverlay.addEventListener('click', (e) => {
                if (e.target === modalOverlay) modalOverlay.remove();
            });

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

            if (type === 'json') {
                try {
                    const jsonData = this.shareLinkManager.shareLinkToJson(contentToCopy);
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

            try {
                const jsonData = this.shareLinkManager.shareLinkToJson(shareLink);
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
            if (this.shareLinkManager.commonPath) {
                const commonPath = this.shareLinkManager.commonPath.replace(/\/$/, ''); // 去除末尾斜杠
                return `${commonPath}.json`;
            }
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

            let modal = document.getElementById('progress-modal');
            if (!modal) {
                modal = document.createElement('div');
                modal.id = 'progress-modal';
                modal.className = 'modal-overlay progress-modal';
                modal.innerHTML = `
                <div class="modal" style="max-width: 400px;">
                    <div class="modal-header">
                        <div class="modal-title">
                            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="animate-pulse">
                                <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"></path>
                            </svg>
                            ${title}${taskCount > 1 ? ` - 队列 ${taskCount}` : ''}
                        </div>
                        <button class="progress-minimize-btn" title="最小化">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <polyline points="4 14 10 14 10 20"></polyline>
                                <polyline points="20 10 14 10 14 4"></polyline>
                                <line x1="14" y1="10" x2="21" y2="3"></line>
                                <line x1="3" y1="21" x2="10" y2="14"></line>
                            </svg>
                        </button>
                    </div>
                    <div class="progress-content">
                        <div class="progress-bar-container">
                            <div class="progress-bar" id="progress-bar" style="width: ${percent}%"></div>
                        </div>
                        <div class="progress-info">
                            <div class="progress-percent">${percent}%</div>
                        </div>
                        ${desc ? `<div class="progress-desc">${desc}</div>` : ''}
                    </div>
                </div>
            `;

                // 最小化按钮事件
                const minimizeBtn = modal.querySelector('.progress-minimize-btn');
                minimizeBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.isProgressMinimized = true;
                    this.removeProgressModalAndKeepState();
                    this.updateMinimizedWidget(title, percent, desc, taskCount);
                });

                document.body.appendChild(modal);
            } else {
                const titleElement = modal.querySelector('.modal-title');
                const barElement = modal.querySelector('#progress-bar');
                const percentElement = modal.querySelector('.progress-percent');
                const descElement = modal.querySelector('.progress-desc');

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
                        const progressContent = modal.querySelector('.progress-content');
                        const descDiv = document.createElement('div');
                        descDiv.className = 'progress-desc';
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
            const existingContainer = modal.querySelector('.task-list-container');
            const currentTaskCount = this.taskList.length;

            if (currentTaskCount === 0) {
                existingContainer?.remove();
                return;
            }

            const generateHtml = () => `
            <div class="task-list-container">
                <button class="task-toggle" id="task-list-toggle">
                    <span>任务队列 (${currentTaskCount})</span>
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="6 9 12 15 18 9"></polyline>
                    </svg>
                </button>
                <div class="task-list" id="task-list">
                    ${this.taskList.map(task => {
                const isCurrentTask = this.currentTask && this.currentTask.id === task.id;
                const typeIcon = task.type === 'generate' ? 'generate' :
                    task.type === 'save' ? 'save' : 'retry';
                const typeText = task.type === 'generate' ? '生成' :
                    task.type === 'save' ? '保存' : '重试';

                return `
                            <div class="task-item ${isCurrentTask ? 'current' : ''}" data-task-id="${task.id}">
                                <div class="task-info">
                                    <div class="task-icon ${typeIcon}"></div>
                                    <div>
                                        <div class="task-name">${typeText}秒传链接</div>
                                        ${isCurrentTask ? '<div class="task-status">执行中...</div>' : ''}
                                    </div>
                                </div>
                                <button class="task-remove" data-task-id="${task.id}" 
                                    ${isCurrentTask ? 'disabled' : ''}>
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
                const toggle = container.querySelector('#task-list-toggle');
                const taskList = container.querySelector('#task-list');

                toggle?.addEventListener('click', () => {
                    const isShown = taskList.classList.toggle('show');
                    toggle.classList.toggle('active', isShown);
                    const svg = toggle.querySelector('svg');
                    if (svg) {
                        svg.style.transform = isShown ? 'rotate(180deg)' : 'rotate(0deg)';
                    }
                });

                container.querySelectorAll('.task-remove').forEach(btn => {
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
                const progressContent = modal.querySelector('.progress-content');
                progressContent.insertAdjacentHTML('beforeend', generateHtml());
                bindEvents(modal.querySelector('.task-list-container'));
            } else {
                const existingTaskItems = existingContainer.querySelectorAll('.task-item');
                const hasCurrentTaskChanged = existingContainer.querySelector('.task-item.current') ?
                    !this.currentTask : !!this.currentTask;

                if (existingTaskItems.length !== currentTaskCount || hasCurrentTaskChanged) {
                    const wasExpanded = existingContainer.querySelector('.task-list').classList.contains('show');
                    existingContainer.remove();

                    const progressContent = modal.querySelector('.progress-content');
                    progressContent.insertAdjacentHTML('beforeend', generateHtml());
                    const newContainer = modal.querySelector('.task-list-container');
                    bindEvents(newContainer);

                    if (wasExpanded) {
                        const taskList = newContainer.querySelector('.task-list');
                        const toggle = newContainer.querySelector('#task-list-toggle');
                        taskList.classList.add('show');
                        toggle.classList.add('active');
                        const svg = toggle.querySelector('svg');
                        if (svg) svg.style.transform = 'rotate(180deg)';
                    }
                } else {
                    const toggleSpan = existingContainer.querySelector('#task-list-toggle span:first-child');
                    if (toggleSpan) toggleSpan.textContent = `任务队列 (${currentTaskCount})`;
                }
            }
        }

        // 隐藏进度条并删除浮动卡片
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

        // 创建或更新右下角最小化浮动进度条卡片
        updateMinimizedWidget(title = '正在处理...', percent = 0, desc = '', taskCount = 1) {
            let widget = document.getElementById(this.minimizeWidgetId);
            const badgeHtml = this.taskList.length >= 1 ?
                `<div class="widget-badge">${this.taskList.length}</div>` : '';

            const html = `
            <div class="widget-header">
                <div class="widget-title">${title}${taskCount > 1 ? ` - 队列 ${taskCount}` : ''}</div>
                ${badgeHtml}
            </div>
            <div class="widget-progress">
                <div class="widget-bar">
                    <div class="widget-fill" style="width: ${percent}%"></div>
                </div>
                <div class="widget-percent">${percent}%</div>
            </div>
        `;

            if (!widget) {
                widget = document.createElement('div');
                widget.id = this.minimizeWidgetId;
                widget.className = 'minimized-widget';
                widget.innerHTML = html;

                widget.addEventListener('click', (e) => {
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
        async launchProgressModal(fileSelectInfo) {
            // 轮询进度
            const mgr = this.shareLinkManager;
            // this.showProgressModal("生成秒传链接", 0, "准备中...");
            mgr.progress = 0;
            const poll = setInterval(() => {
                this.updateProgressModal("生成秒传链接", mgr.progress, mgr.progressDesc, this.taskList.length);
                if (mgr.progress > 100) {
                    clearInterval(poll);
                    setTimeout(() => this.hideProgressModal(), 500);
                }
            }, 500);

            const shareLink = await mgr.generateShareLink(fileSelectInfo);

            // 清除任务取消标志
            this.shareLinkManager.taskCancel = false;

            if (!shareLink) {
                this.showToast("没有选择文件", 'warning');
                clearInterval(poll);
                return;
            }
            clearInterval(poll);
            this.hideProgressModal();
            this.showCopyModal(shareLink);
        }

        /**
         * 显示保存结果模态框
         * @param result - {success: [], failed: []}
         * @returns {Promise<void>}
         */
        async showSaveResultsModal(result) {
            const totalCount = result.success.length + result.failed.length;
            const successCount = result.success.length;
            const failedCount = result.failed.length;

            const failedListHtml = failedCount > 0 ? `
            <div style="margin-top: 20px;">
                <div style="font-size: 13px; font-weight: 500; color: var(--danger-color); margin-bottom: 8px;">
                    失败文件列表
                </div>
                <div class="failed-list">
                    ${result.failed.map(fileInfo => `
                        <div class="failed-item">
                            <div class="failed-name">${fileInfo.fileName}</div>
                            ${fileInfo.error ? `<div class="failed-error">${fileInfo.error}</div>` : ''}
                        </div>
                    `).join('')}
                </div>
            </div>
        ` : '';

            const modalOverlay = document.createElement('div');
            modalOverlay.className = 'modal-overlay';
            modalOverlay.innerHTML = `
            <div class="modal" style="max-width: 500px;">
                <div class="modal-header">
                    <div class="modal-title">
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                            <polyline points="22 4 12 14.01 9 11.01"></polyline>
                        </svg>
                        保存结果
                    </div>
                    <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </button>
                </div>
                <div class="modal-content results-content">
                    <div class="results-stats">
                        <div class="stat-card success">
                            <div class="stat-value success">${successCount}</div>
                            <div class="stat-label">成功</div>
                        </div>
                        <div class="stat-card failed">
                            <div class="stat-value failed">${failedCount}</div>
                            <div class="stat-label">失败</div>
                        </div>
                    </div>
                    <div style="text-align: center; font-size: 13px; color: var(--text-secondary); margin: 20px 0;">
                        总计处理 <strong>${totalCount}</strong> 个文件
                    </div>
                    ${failedListHtml}
                </div>
                <div class="modal-footer">
                    <button class="btn btn-outline" onclick="this.closest('.modal-overlay').remove()">
                        关闭
                    </button>
                    ${failedCount > 0 ? `
                        <div class="dropdown">
                            <button class="btn btn-secondary dropdown-toggle">
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M21.21 15.89A10 10 0 1 1 8 2.83"></path>
                                    <path d="M22 12A10 10 0 0 0 12 2v10z"></path>
                                </svg>
                                操作
                            </button>
                            <div class="dropdown-menu">
                                <div class="dropdown-item" data-action="retry">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                        <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path>
                                        <path d="M3 3v5h5"></path>
                                    </svg>
                                    重试失败
                                </div>
                                <div class="dropdown-item" data-action="export">
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
                const dropdownItems = modalOverlay.querySelectorAll('.dropdown-item');
                dropdownItems.forEach(item => {
                    item.addEventListener('click', async () => {
                        const action = item.dataset.action;
                        modalOverlay.remove();

                        if (action === 'retry') {
                            this.addAndRunTask('retry', { fileList: result.failed });
                        } else if (action === 'export') {
                            const shareLink = this.shareLinkManager.buildShareLink(result.failed, result.commonPath || '');
                            this.showCopyModal(shareLink);
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
         * 任务函数 - 启动从输入的内容解析并保存秒传链接，UI层面的保存入口，retry为是可以重试失败的文件
         * @param {*} content - 输入内容（秒传链接/JSON）
         */
        async launchSaveLink(content, retry = false) {
            this.updateProgressModal("保存秒传链接", 0, "准备中...");
            this.shareLinkManager.progress = 0;
            const poll = setInterval(() => {
                this.updateProgressModal("保存秒传链接", this.shareLinkManager.progress, this.shareLinkManager.progressDesc, this.taskList.length);
                // 正常情况下不主动清除
                if (this.shareLinkManager.progress > 100) {
                    clearInterval(poll);
                }
            }, 100);
            let saveResult;
            if (!retry) {
                saveResult = await this.shareLinkManager.saveShareLink(content);
            } else {
                saveResult = await this.shareLinkManager.retrySaveFailed(content);
            }
            // 清除任务取消标志
            this.shareLinkManager.taskCancel = false;

            clearInterval(poll);
            this.hideProgressModal();
            this.showSaveResultsModal(saveResult);
            this.renewWebPageList();
            this.showToast(saveResult ? "保存成功" : "保存失败", saveResult ? 'success' : 'error');
        }

        /**
         * 模拟点击刷新按钮，刷新页面文件列表
         */
        renewWebPageList() {
            // 刷新页面文件列表
            const renewButton = document.querySelector('.layout-operate-icon.mfy-tooltip svg');
            if (renewButton) {
                const clickEvent = new MouseEvent('click', {
                    bubbles: true, cancelable: true, view: window
                });
                renewButton.dispatchEvent(clickEvent);
            }
        }

        /**
         * 显示输入模态框
         */
        async showInputModal() {
            const modalOverlay = document.createElement('div');
            modalOverlay.className = 'modal-overlay';
            modalOverlay.innerHTML = `
            <div class="modal" style="max-width: 500px;">
                <div class="modal-header">
                    <div class="modal-title">
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                            <polyline points="14 2 14 8 20 8"></polyline>
                            <line x1="16" y1="13" x2="8" y2="13"></line>
                            <line x1="16" y1="17" x2="8" y2="17"></line>
                            <polyline points="10 9 9 9 8 9"></polyline>
                        </svg>
                        保存秒传链接
                    </div>
                    <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </button>
                </div>
                <div class="modal-content">
                    <textarea id="saveText" placeholder="请输入或粘贴秒传链接，或将JSON文件拖拽到此处..."></textarea>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-primary" id="saveButton">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
                            <polyline points="17 21 17 13 7 13 7 21"></polyline>
                            <polyline points="7 3 7 8 15 8"></polyline>
                        </svg>
                        保存
                    </button>
                    <button class="btn btn-outline" id="selectFileButton">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path>
                            <polyline points="13 2 13 9 20 9"></polyline>
                        </svg>
                        选择JSON
                    </button>
                    <input type="file" class="file-input" id="jsonFileInput" accept=".json">
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

            modalOverlay.querySelector('#saveButton').addEventListener('click', async () => {
                const content = textarea.value.trim();
                if (!content) {
                    this.showToast("请输入秒传链接或导入JSON文件", 'warning');
                    return;
                }
                modalOverlay.remove();
                this.addAndRunTask('save', { content });
            });

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
         * 读取JSON文件并将内容填充到文本区域
         * @param {*} file - 要读取的文件
         * @param {*} textarea - 目标文本区域
         * @returns
         */
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

                    if (this.shareLinkManager.validateJson(jsonData)) {
                        // const shareLink = this.shareLinkManager.jsonToShareLink(jsonData);
                        textarea.value = jsonContent;
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

            // 执行任务
            setTimeout(async () => {
                this.isTaskRunning = true;
                if (task.type === 'generate') {
                    // 生成秒传链接
                    await this.launchProgressModal(task.params.fileSelectInfo);
                } else if (task.type === 'save') {
                    // 保存秒传链接
                    await this.launchSaveLink(task.params.content);
                } else if (task.type === 'retry') {
                    // 重试任务
                    await this.launchSaveLink(task.params.fileList, true);
                }
                this.isTaskRunning = false;
                // 任务完成，从列表中移除
                this.taskList = this.taskList.filter(t => t.id !== task.id);
                this.currentTask = null;
                this.runNextTask();
            }, 100);
            this.showToast(`任务${task.id}开始执行...`, 'info');
        }

        /**
         * 解析、添加并触发任务
         * @param taskType  - 任务类型（generate/save/retry）
         * @param params - 任务参数
         */
        addAndRunTask(taskType, params = {}) {
            const taskId = ++this.taskIdCounter;
            if (taskType === 'generate') {
                // 获取选中文件
                const fileSelectInfo = this.selector.getSelection();
                if (!fileSelectInfo || fileSelectInfo.length === 0) {
                    this.showToast("请先选择文件", 'warning');
                    return;
                }
                this.taskList.push({ id: taskId, type: 'generate', params: { fileSelectInfo } });
            } else if (taskType === 'save') {
                this.taskList.push({ id: taskId, type: 'save', params: { content: params.content } });
            } else if (taskType === 'retry') {
                this.taskList.push({ id: taskId, type: 'retry', params: { fileList: params.fileList } });
            }
            this.runNextTask();
        }

        /** 任务取消
         * @returns {boolean}
         */
        cancelCurrentTask() {
            this.shareLinkManager.taskCancel = true;
            return true;
        }


        addButton(features, options = {}) {
            const buttonExist = document.querySelector('.mfy-button-container');
            if (buttonExist) return;

            const isFilePage = window.location.pathname === "/" &&
                (window.location.search === "" || window.location.search.includes("homeFilePath"));
            if (!isFilePage) return;

            const container = document.querySelector('.home-operator-button-group');
            if (!container) return;

            const btnContainer = document.createElement('div');
            btnContainer.className = 'mfy-button-container';

            const btn = document.createElement('button');
            btn.className = 'ant-btn css-1bw9b22 ant-btn-primary ant-btn-variant-solid mfy-button upload-button'; // 利用现有样式
            btn.style = "background-color: #5ebf70;";
            btn.innerHTML = `${this.iconLibrary.transfer}<span>${options.buttonText || '秒传'}</span>`;

            const dropdown = document.createElement('div');
            dropdown.className = 'mfy-dropdown';

            // 根据功能列表创建下拉项
            features.forEach(feature => {
                const icon = this.iconLibrary[feature.iconKey] || feature.iconKey || '';
                const itemElement = document.createElement('div');
                itemElement.className = 'mfy-dropdown-item';
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

    const apiClient = new PanApiClient();
    const selector = new TableRowSelector();
    const shareLinkManager = new ShareLinkManager(apiClient);
    const uiManager = new UiManager(shareLinkManager, selector);

    selector.init();
    uiManager.init();

    if (DEBUG) {
        window._apiClient = apiClient;
        window._shareLinkManager = shareLinkManager;
        window._selector = selector;
        window._uiManager = uiManager;
    }

})();
