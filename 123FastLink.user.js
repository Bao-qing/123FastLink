// ==UserScript==
// @name         123FastLink
// @namespace    http://tampermonkey.net/
// @version      2025-01-29
// @description  Creat and save 123pan instant links.
// @author       Baoqing
// @match        https://www.123pan.com/*
// @match        https://www.123pan.cn/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=123pan.com
// @grant        none
// ==/UserScript==

(function() {
    'use strict';
    // ----------------------------------------------------基础环境----------------------------------------------------
    // ==================🚀 构建URL函数 ==================
    const buildURL = (host, path, queryParams) => {
        const queryString = new URLSearchParams(queryParams).toString();
        return `${host}${path}?${queryString}`;
    };

    // ==================🌐 发送请求函数 ==================
    async function sendRequest(method, path, queryParams, body) {
        const config = {
            host: 'https://' + window.location.host,
            queryParams: { // 🛡️ 预留的签名参数（可选）
                //'803521858': '1738073884-258518-2032310069'
            },
            // 🔑 获取身份认证信息
            authToken: localStorage['authorToken'],
            loginUuid: localStorage['LoginUuid'],

            appVersion: '3',
            referer: document.location.href,
        };

        const headers = {
            'Content-Type': 'application/json;charset=UTF-8',
            'Authorization': 'Bearer ' + config.authToken,
            'platform': 'web',
            'App-Version': config.appVersion,
            'LoginUuid': config.loginUuid,
            'Origin': config.host,
            'Referer': config.referer,
        };

        try {
            const response = await fetch(buildURL(config.host, path, queryParams), {
                method: method,
                headers: headers,
                body: body,
                credentials: 'include'
            });

            console.log(`[${response.status}] ${response.statusText}`);
            const data = await response.json();
            console.table(data); // ✅ 表格化输出

            if (data.code !== 0) {
                console.error('❗ 业务逻辑错误:', data.message);
                throw '❗ 业务逻辑错误:' + data.message;
            }

            return data; // ✅ 确保 sendRequest 返回 data
        } catch (error) {
            console.error('⚠️ 网络请求失败:', error);
            throw '未知错误';
            return null;
        }
    }

    // ----------------------------------------------------生成秒传----------------------------------------------------

    // ====================== 📂 获取文件信息 ================
    async function getFileInfo(idList) {
        const transformedList = idList.map(fileId => ({ fileId }));
        const responseData = await sendRequest(
            "POST",
            "/b/api/file/info", {},
            JSON.stringify({ // 请求体
                fileIdList: transformedList
            })
        );
        return responseData;
    }

    // ===================== 获取选择的文件id =============
    function getSelectFile() {
        const fileRow = Array.from(document.getElementsByClassName("ant-table-row ant-table-row-level-0 editable-row"));
        const selectFile = fileRow.map(function(element, index, array) {
            if (element.getElementsByTagName("input")[0].checked) {
                return element.getAttribute('data-row-key'); // 返回修改后的元素
            }
        }).filter(item => item != null);
        return selectFile;
    }

    // ====================🔗 生成秒传链接 ===================
    async function creatShareLink() {
        const fileSelect = getSelectFile();
        //console.log("fileS", fileSelect);
        if (!fileSelect.length) {
            return ""
        }
        const fileInfo = Array.from((await getFileInfo(fileSelect))['data']['infoList']);
        var hasFloder = 0;
        const shareLink = fileInfo.map(function(info, infoIndex, infoArray) { //.filter(item => item != null)
            if (info.Type == 0) {
                return [info.Etag, info.Size, info.FileName.replace("#", "").replace("$", "")].join('#')
            } else {
                console.log("忽略文件夹", info.FileName);
                hasFloder = 1;
            }
        }).filter(item => item != null).join('$');
        if (hasFloder) {
            alert("文件夹无法秒传，将被忽略");
        }
        return shareLink;
    }


    // ----------------------------------------------------接受秒传----------------------------------------------------
    // ==================📥 参数解析 ====================
    function getShareFileInfo(shareLink) {

        const shareLinkList = Array.from(shareLink.split('$'));
        const shareFileInfoList = shareLinkList.map(function(singleShareLink, linkIndex, linkArray) {
            const singleFileInfoList = singleShareLink.split('#');
            const singleFileInfo = {
                etag: singleFileInfoList[0],
                size: singleFileInfoList[1],
                fileName: singleFileInfoList[2]
            };
            return singleFileInfo;
        });
        return shareFileInfoList;
        //JSON.parse(decodeURIComponent(atob(shareLink)));
    }

    // ================== 获取单一文件 ===================
    async function getSingleFile(shareFileInfo) {
        // --------------------- 文件信息 ---------------------
        const fileInfo = {
            driveId: 0,
            etag: shareFileInfo.etag,
            fileName: shareFileInfo.fileName,
            parentFileId: JSON.parse(sessionStorage['filePath'])['homeFilePath'][0] || 0,
            size: shareFileInfo.size,
            type: 0,
            duplicate: 1
        };
        // --------------------- 发送请求 ---------------------
        const responseData = await sendRequest('POST', '/b/api/file/upload_request', {},
            JSON.stringify({...fileInfo, RequestSource: null }));
        return responseData;
    }

    // ================== 获取全部文件 ===================
    async function getFiles(shareLink) {
        try {
            const shareFileList = getShareFileInfo(shareLink);
            for (var i = 0; i < shareFileList.length; i++) {
                getSingleFile(shareFileList[i]);
            }
            return 1
        } catch {
            return 0
        }
    }

    // ----------------------------------------------------创建按钮----------------------------------------------------
    // =================== 📌 创建按钮 ===================
    function creatButton() {
        const targetElement = document.querySelector('.ant-dropdown-trigger.sysdiv.parmiryButton');

        if (targetElement && targetElement.parentNode) {
            // 创建“展开”按钮
            const expandButton = document.createElement('div');
            expandButton.className = 'ant-dropdown-trigger sysdiv parmiryButton';
            expandButton.style.borderRight = '0.5px solid rgb(217, 217, 217)';
            expandButton.style.cursor = 'pointer';
            expandButton.style.marginLeft = '20px';
            expandButton.innerHTML = `
                <span id="fasttrans123" role="img" aria-label="menu" class="anticon anticon-menu" style="margin-right: 6px;">
                    <svg viewBox="64 64 896 896" focusable="false" data-icon="menu" width="1em" height="1em" fill="currentColor" aria-hidden="true">
                        <path d="M120 300h720v60H120zm0 180h720v60H120zm0 180h720v60H120z"></path>
                    </svg>
                </span>
                秒传
            `;

            // 创建下拉菜单（默认隐藏）
            const dropdownMenu = document.createElement('div');
            dropdownMenu.style.display = 'none';
            dropdownMenu.style.id = 'fast_trans_button'
            dropdownMenu.style.position = 'absolute';
            dropdownMenu.style.background = '#fff';
            dropdownMenu.style.border = '1px solid #ccc';
            dropdownMenu.style.padding = '2px';
            dropdownMenu.style.boxShadow = '0px 4px 6px rgba(0, 0, 0, 0.1)';
            dropdownMenu.style.marginTop = '5px';


            dropdownMenu.innerHTML = `
                <ul class="ant-dropdown-menu ant-dropdown-menu-root ant-dropdown-menu-vertical ant-dropdown-menu-light" role="menu" tabindex="0" data-menu-list="true" style="border-radius: 10px;">
                    <li id="generateShare" class="ant-dropdown-menu-item ant-dropdown-menu-item-only-child" role="menuitem" tabindex="-1" data-menu-id="rc-menu-uuid-73825-3-1">
                        <span class="ant-dropdown-menu-title-content">
                            <div style="width: 100px; height: 20px; line-height: 20px; padding: 0px 6px; position: relative; margin-top: 6px;">
                                生成链接
                            </div>
                        </span>
                    </li>
                    
                    <li id="receiveDirect" class="ant-dropdown-menu-item ant-dropdown-menu-item-only-child" role="menuitem" tabindex="-1" data-menu-id="rc-menu-uuid-73825-3-2">
                        <span class="ant-dropdown-menu-title-content">
                            <div style="width: 100px; height: 20px; line-height: 20px; padding: 0px 6px; position: relative;">
                                链接转存
                            </div>
                        </span>
                    </li>

                    <li id="closeMenu" class="ant-dropdown-menu-item ant-dropdown-menu-item-only-child" role="menuitem" tabindex="-1" data-menu-id="rc-menu-uuid-73825-3-3">
                        <span class="ant-dropdown-menu-title-content">
                            <div style="width: 100px; height: 20px; line-height: 20px; padding: 0px 6px; position: relative;">
                                关闭
                            </div>
                        </span>
                    </li>
                    
                </ul>
            `;

            // 绑定按钮事件
            expandButton.addEventListener('click', () => {
                dropdownMenu.style.display = dropdownMenu.style.display === 'none' ? 'block' : 'none';
            });

            // 绑定 "关闭" 按钮事件
            dropdownMenu.querySelector('#closeMenu').addEventListener('click', () => {
                document.querySelector('#fast_trans_button').display = 'none';
            });

            // 绑定生成直链按钮事件
            dropdownMenu.querySelector('#generateShare').addEventListener('click', async() => {
                const shareLink = await creatShareLink();
                if (shareLink == '') {
                    alert("没有选择文件");
                    return
                }
                showCopyModal(shareLink);
            });

            // 绑定接受直链按钮事件
            dropdownMenu.querySelector('#receiveDirect').addEventListener('click', () => {
                showCopyModal("", "获取", startGetFile);
            });

            // 插入到目标元素的同级
            targetElement.parentNode.insertBefore(expandButton, targetElement.nextSibling);
            expandButton.appendChild(dropdownMenu);
        }
    }



    // =================✨ 弹出操作框 ================
    function showCopyModal(defaultText = "", buttonText = "复制", buttonFunction = copyToClipboard) {
        // 这个样式会遮挡，清除掉
        const floatTable = document.getElementsByClassName('ant-table-header ant-table-sticky-holder');
        if (floatTable.length > 0) {
            floatTable[0].className = "ant-table-header";
        }

        // 检查是否已有样式，防止重复添加
        if (!document.getElementById("modal-style")) {
            let style = document.createElement("style");
            style.id = "modal-style";
            style.innerHTML = `
            .modal-overlay {display: flex;position: fixed;top: 0;left: 0;width: 100%;height: 100%;background: rgba(0, 0, 0, 0.5);justify-content: center;align-items: center; }
            .modal {background: white;padding: 20px;border-radius: 8px;box-shadow: 0 4px 10px rgba(0, 0, 0, 0.2);text-align: center;width: 300px;}
            .close-btn {background: #f44336;color: white;border: none;padding: 5px 10px;cursor: pointer;float: right;}
            .modal input {width: 100%;padding: 8px;margin: 10px 0;border: 1px solid #ccc;border-radius: 4px;}
            .copy-btn {background: #4CAF50;color: white;border: none;padding: 8px 12px;cursor: pointer;border-radius: 4px;}
        `;
            document.head.appendChild(style);
        }

        // 如果已有弹窗，则删除它
        let existingModal = document.getElementById('modal');
        if (existingModal) existingModal.remove();

        // 创建遮罩层
        let modalOverlay = document.createElement('div');
        modalOverlay.className = 'modal-overlay';
        modalOverlay.id = 'modal';

        // 创建弹窗
        modalOverlay.innerHTML = `
        <div class="modal">
            <button class="close-btn" onclick="document.getElementById('modal').remove()">×</button>
            <h3>秒传链接</h3>
            <input type="text" id="copyText" value="${defaultText}">
            <button class="copy-btn" id="massageboxButton" onclick="${buttonFunction}()">${buttonText}</button>
        </div>
    `;

        // 绑定接受直链按钮事件
        modalOverlay.querySelector('#massageboxButton').addEventListener('click', () => {
            buttonFunction();
        });

        // 添加到 body
        document.body.appendChild(modalOverlay);
    }

    // ===================📋 写入剪贴板 ====================
    function copyToClipboard() {
        let inputField = document.getElementById('copyText');
        inputField.select();
        document.execCommand('copy');
        alert('已尝试写入剪贴板,请确保授予相关权限');
    }

    // ================== 获取文件 ====================
    function startGetFile() {
        const shareLink = document.getElementById("copyText").value;
        if (getFiles(shareLink)) {
            alert("获取成功，请刷新目录查看，如没有请检查根目录。");
            // 如果已有弹窗，则删除它
            let existingModal = document.getElementById('modal');
            if (existingModal) existingModal.remove();
        } else {
            alert("获取失败");
        }
    }

    // ⏳ =============== 创建 ======================
    function createButtonIfNotExists() {
        // 如果未创建按钮
        const fastTrans123 = document.getElementById('fasttrans123');
        if (fastTrans123 == null) {
            creatButton();
        }
    }

    setInterval(createButtonIfNotExists, 1000);
})();