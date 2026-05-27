import { GlobalConfig } from "./config";
import { createLogger } from "./logger";

const log = createLogger('ShareLink');

export class ShareLinkManager {
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
        //log.log(await this.apiClient.getFileList(parentFileId));
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
        log.log("获取文件列表,ID:", parentFileId);

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
                log.error('获取文件信息失败:', e);
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
     * @param {FileRecord[]} selectedFiles - 来自selector.getSelection()
     * @returns  - [boolean, 错误信息, 文件信息列表,commonPath]
     */
    async _getSelectedFilesInfo(selectedFiles) {
        this.fileInfoList = [];
        if (!selectedFiles || selectedFiles.length === 0) {
            return [false, "未选择文件", null];
        }
        let fileSelectFolderInfoList = [];

        this.progress = 10;
        this.progressDesc = "正在递归获取选择的文件..."

        const allFileInfo = selectedFiles.map(file => ({
            fileName: file.FileName, etag: file.Etag, size: file.Size, type: file.Type, fileId: file.FileId
        }));
        const fileInfo = allFileInfo.filter(file => file.type !== 1);
        fileInfo.forEach(file => {
            file.path = file.fileName;
        });
        this.fileInfoList.push(...fileInfo);
        fileSelectFolderInfoList = allFileInfo.filter(file => file.type === 1);

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
                log.error('不支持的公共路径格式', commonPathLinkPrefix);
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
                log.error('无效的etag:', etag);
                failed = true;
            }
            const size = singleFileInfoList[1];
            if (isNaN(size) || Number(size) < 0) {
                log.error('无效的文件大小:', size);
                failed = true;
            }
            if (!singleFileInfoList[2]) {
                log.error('无效的文件路径:', singleFileInfoList[2]);
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
                log.error('保存文件失败:', fileInfo.fileName);
                fileInfo.error = reuse[1];
                failedList.push(fileInfo);
            }
            completed++;
            log.log('已保存:', fileInfo.fileName);
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
        let saveResult = { success: [], failed: [] };

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
                        log.error('无效的etag:', file.etag);
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
            log.error('解析JSON格式秒传链接失败:', error);
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
            log.error('解析秒传链接失败:', shareLink);
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

