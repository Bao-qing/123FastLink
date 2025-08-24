// ==UserScript==
// @name         Hook Table Row Events
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  选择器测试
// @author       You
// @match        *://*.123pan.com/*
// @match        *://*.123pan.cn/*
// @match        *://*.123684.com/*
// @match        *://*.123865.com/*
// @match        *://*.123952.com/*
// @match        *://*.123912.com/*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';
    class TableRowSelectorHook {
        constructor() {
            this.selectedRowKeys = [];
            this.unselectedRowKeys = [];
            this.isSelectAll = false;
            this._inited = false;
        }

        init() {
            if (this._inited) return;
            this._inited = true;

            // // 页面加载时，为已存在的全选框绑定事件
            // window.addEventListener('load', () => {
            //     const existingSelectAll = document.querySelector('input[aria-label="Select all"]');
            //     if (existingSelectAll) {
            //         this._bindSelectAllEvent(existingSelectAll);
            //         console.log('[123FASTLINK] [Selector] 已为全选框绑定事件');
            //     } else {
            //         console.log('[123FASTLINK] [Selector] 未找到全选框');
            //     }
            // });

            // 保存原始 createElement 方法
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
                        // 新建全选框，新页面，清除已选择
                        self.unselectedRowKeys = [];
                        self.selectedRowKeys = [];
                        self.isSelectAll = false;

                        self._bindSelectAllEvent(element);
                        console.log('[123FASTLINK] [Selector] 已为全选框绑定事件');
                    }

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

    let selector = new TableRowSelectorHook();
    selector.init();

})();