// ==UserScript==
// @name         123FastLink
// @namespace    http://tampermonkey.net/
// @version      2025-01-29
// @description  Creat and save 123pan instant links.
// @author       Baoqing
// @match        *://*.123pan.com/*
// @match        *://*.123pan.cn/*
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
            .modal-overlay {display: flex;position: fixed;top: 0;left: 0;width: 100%;height: 100%;background: rgba(0, 0, 0, 0.5);justify-content: center;align-items: center;z-index: 2; }
            .modal {background: white;padding: 20px;border-radius: 8px;box-shadow: 0 4px 10px rgba(0, 0, 0, 0.2);text-align: center;width: 300px;}
            .close-btn {background: #f44336;color: white;border: none;padding: 5px 10px;cursor: pointer;float: right;}
            .modal input {width: 90%;padding: 8px;margin: 10px 0;border: 1px solid #ccc;border-radius: 4px;}
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
    async function copyToClipboard() {
    try {
        const inputField = document.getElementById('copyText');
        if (!inputField) {
            throw new Error('找不到输入框元素');
        }
        
        // 使用现代 Clipboard API
        await navigator.clipboard.writeText(inputField.value);
        
        // 更新提示信息
        alert('已成功复制到剪贴板 📋');
    } catch (err) {
        console.error('复制失败:', err);
        alert(`复制失败: ${err.message || '请手动复制内容'}`);
    }
}

    // ================== 获取文件 ====================
    function startGetFile() {
        const shareLink = document.getElementById("copyText").value;
        if (getFiles(shareLink)) {
            //alert("获取成功，请刷新目录查看，如没有请检查根目录。");
            // 如果已有弹窗，则删除它
            let existingModal = document.getElementById('modal');
            if (existingModal) existingModal.remove();
            //模拟点击class="layout-operate-icon mfy-tooltip"的div下的svg元素
            const element = document.querySelector('.layout-operate-icon.mfy-tooltip svg');
            // 创建鼠标点击事件
            const clickEvent = new MouseEvent('click', {
                bubbles: true,    // 事件是否冒泡
                cancelable: true, // 事件能否被取消
                view: window      // 关联的视图（通常是 window）
            });
            // 分发事件到元素
            element.dispatchEvent(clickEvent);
        } else {
            alert("获取失败");
        }
    }

    // 等待页面加载完成创建秒传按钮
    window.addEventListener('load', function() {
        // 查找目标容器
        const container = document.querySelector('.home-operator-button-group');
        if (!container) return;

        // 创建按钮容器
        const btnContainer = document.createElement('div');
        btnContainer.className = 'mfy-button-container';
        btnContainer.style.position = 'relative';
        btnContainer.style.display = 'inline-block';

        // 创建按钮
        const btn = document.createElement('button');
        btn.className = 'ant-btn css-dev-only-do-not-override-168k93g ant-btn-default ant-btn-color-default ant-btn-variant-outlined mfy-button create-button';
        btn.style.background = "#4CAF50";
        btn.style.color = "#fff";
        btn.style.border = "none";
        btn.innerHTML = `
            <svg class="icon home-operator-icon-upload" aria-hidden="true">
                <use xlink:href="#general_upload_16_1"></use>
            </svg>
            <span>秒传</span>
        `;

        // 创建下拉菜单
        const dropdown = document.createElement('div');
        dropdown.className = 'mfy-dropdown';
        dropdown.style.display = 'none';
        dropdown.style.position = 'absolute';
        dropdown.style.top = 'calc(100% + 5px)'; // 增加5px间距
        dropdown.style.left = '0';
        dropdown.style.backgroundColor = '#fff';
        dropdown.style.border = '1px solid #d9d9d9';
        dropdown.style.borderRadius = '10px'; // 圆角调整为10px
        dropdown.style.boxShadow = '0 2px 8px rgba(0,0,0,0.15)';
        dropdown.style.zIndex = '1000';
        dropdown.style.minWidth = '120px';
        dropdown.style.overflow = 'hidden'; // 确保圆角效果

        dropdown.innerHTML = `
            <div class="mfy-dropdown-item" data-action="generate">生成秒传连接</div>
            <div class="mfy-dropdown-item" data-action="save">保存秒传连接</div>
        `;

        // 添加样式
        const style = document.createElement('style');
        style.textContent = `
            .mfy-button-container:hover .mfy-dropdown {
                display: block !important;
            }
            .mfy-dropdown-item {
                padding: 8px 12px;
                cursor: pointer;
                transition: background 0.3s;
                font-size: 14px;
            }
            .mfy-dropdown-item:hover {
                background-color: #f5f5f5;
            }
            /* 添加下拉菜单顶部间距 */
            .mfy-dropdown::before {
                content: '';
                position: absolute;
                top: -5px; /* 填补间距 */
                left: 0;
                width: 100%;
                height: 5px;
                background: transparent;
            }
        `;
        document.head.appendChild(style);

        // 组装元素
        btnContainer.appendChild(btn);
        btnContainer.appendChild(dropdown);
        container.insertBefore(btnContainer, container.firstChild);

        // 添加下拉菜单点击事件
        dropdown.querySelectorAll('.mfy-dropdown-item').forEach(item => {
            item.addEventListener('click', async function() {
                const action = this.dataset.action;
                if (action === 'generate') {
                    // 这里添加生成秒传连接的具体逻辑
                    const shareLink = await creatShareLink();
                    if (shareLink == '') {
                        alert("没有选择文件");
                        return
                    }
                    showCopyModal(shareLink);
                } else if (action === 'save') {
                    // 这里添加保存秒传连接的具体逻辑
                    showCopyModal("", "获取", startGetFile);
                }
                dropdown.style.display = 'none';
            });
        });

        // 鼠标事件处理
        btnContainer.addEventListener('mouseenter', function() {
            dropdown.style.display = 'block';
        });

        btnContainer.addEventListener('mouseleave', function() {
            let timer;
            clearTimeout(timer); // 清除已有定时器避免冲突
            timer = setTimeout(() => {
                dropdown.style.display = 'none';
            }, 300); // 10毫秒延迟
        });
    });

})();
