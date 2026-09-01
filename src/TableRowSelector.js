export class TableRowSelector {
    /**
     * 通过 React Fiber 定位表格，从内存态读取全量数据与选中状态。
     * @param {number} tableIndex - 页面中第几个文件表格 (从0开始)
     */
    constructor(tableIndex = 0) {
        this.tableIndex = tableIndex;
        this._cachedTableEl = null; // 缓存已定位的表格容器元素，避免重复扫描
    }

    /**
     * 判断 fiber 是否为表格组件（memoizedProps 同时含 dataSource/rowSelection/columns）
     * @private
     */
    _isTableFiber(node) {
        const p = node.memoizedProps;
        return !!(p && Array.isArray(p.dataSource) && p.rowSelection && Array.isArray(p.columns));
    }

    /**
     * 从元素出发沿 fiber.return 链向上查找表格 fiber
     * @private
     */
    _findTableInElement(el) {
        const fiberKey = Object.keys(el).find(k => k.startsWith('__reactFiber$'));
        if (!fiberKey) return null;
        let node = el[fiberKey]?.return;
        for (let i = 0; i < 12 && node; i++, node = node.return) {
            if (this._isTableFiber(node)) return node;
        }
        return null;
    }

    /**
     * 定位 antd 风格表格的 fiber（memoizedProps 含 dataSource/rowSelection/columns）
     * @private
     * @returns {object|null}
     */
    _findTableFiber() {
        // 1. 校验缓存容器是否仍有效（元素仍在文档中且仍能解析出表格 fiber）
        if (this._cachedTableEl && document.contains(this._cachedTableEl)) {
            const fiber = this._findTableInElement(this._cachedTableEl);
            if (fiber) return fiber;
            this._cachedTableEl = null;
        }

        // 2. 快速路径：语义化选择器定位候选容器（覆盖旧版 antd / 新版 123pan / 模糊 table 相关 class）
        const containerSelectors = [
            '.ant-table-wrapper',
            '.file-table-list-wrapper',
            '[class*="table-list-wrapper"]',
            '[class*="table-module"]',
            '[class*="ant-table"]',
        ];
        const candidates = new Set();
        for (const selector of containerSelectors) {
            document.querySelectorAll(selector).forEach(el => candidates.add(el));
        }

        // 3. 兜底：候选容器为空时，从 React 根容器沿 fiber 树遍历定位（与 class 名完全解耦）
        let tableCount = 0;
        if (candidates.size === 0) {
            const roots = this._findReactRoots();
            for (const root of roots) {
                const stack = [root];
                let visited = 0;
                while (stack.length && visited < 100000) {
                    const node = stack.pop();
                    visited++;
                    if (this._isTableFiber(node)) {
                        if (tableCount === this.tableIndex) {
                            this._cachedTableEl = this._hostElementOf(node);
                            return node;
                        }
                        tableCount++;
                    }
                    if (node.child) stack.push(node.child);
                    if (node.sibling) stack.push(node.sibling);
                }
            }
            return null;
        }

        // 4. 在候选元素中按 tableIndex 定位第 N 个表格
        for (const el of candidates) {
            const fiber = this._findTableInElement(el);
            if (fiber) {
                if (tableCount === this.tableIndex) {
                    this._cachedTableEl = el;
                    return fiber;
                }
                tableCount++;
            }
        }
        return null;
    }

    /**
     * 查找 React 根容器 fiber（优先常见挂载点，找不到再扫描页面元素）
     * @private
     * @returns {object[]}
     */
    _findReactRoots() {
        const roots = [];
        const pushRoot = (el) => {
            if (!el) return;
            const containerKey = Object.keys(el).find(k => k.startsWith('__reactContainer$'));
            if (containerKey && el[containerKey]) roots.push(el[containerKey]);
        };
        for (const selector of ['#app', '#root', '#__next', '#main', '#content']) {
            pushRoot(document.querySelector(selector));
        }
        if (roots.length === 0) {
            const all = document.querySelectorAll('*');
            for (let i = 0; i < all.length && roots.length < 3; i++) {
                pushRoot(all[i]);
            }
        }
        return roots;
    }

    /**
     * 从表格 fiber 向下找到首个宿主 DOM 元素，用于缓存
     * @private
     */
    _hostElementOf(fiber) {
        let node = fiber;
        for (let i = 0; i < 20 && node; i++, node = node.child) {
            if (node.stateNode && node.stateNode.nodeType === 1) return node.stateNode;
        }
        return null;
    }

    /**
     * 获取表格内存态的数据、选中 key 与行 key 定义
     * @private
     * @returns {{dataSource: Array, selectedRowKeys: Array, rowKey: *}}
     */
    _getTableInfo() {
        const tableFiber = this._findTableFiber();
        if (!tableFiber) return { dataSource: [], selectedRowKeys: [], rowKey: null };
        const p = tableFiber.memoizedProps;
        return {
            dataSource: Array.isArray(p.dataSource) ? p.dataSource : [],
            selectedRowKeys: Array.isArray(p.rowSelection?.selectedRowKeys) ? p.rowSelection.selectedRowKeys : [],
            rowKey: p.rowKey,
        };
    }

    /**
     * 计算行的唯一 key，与 rowSelection.selectedRowKeys 匹配
     * @private
     */
    _getRowKey(item, rowKey) {
        if (typeof rowKey === 'string') return item[rowKey];
        if (typeof rowKey === 'function') return rowKey(item);
        return item.FileId ?? item.keys ?? item.id ?? item.key;
    }

    /**
     * 获取表格全部行数据
     * @returns {FileRecord[]}
     */
    getAll() {
        return structuredClone(this._getTableInfo().dataSource);
    }

    /**
     * 获取当前选中的行数据。
     * 优先用 antd rowSelection.selectedRowKeys（内存态，含虚拟列表未渲染行的选中项），
     * 找不到 key 时回退到 dataSource.checked 字段。
     * @returns {FileRecord[]}
     */
    getSelection() {
        const { dataSource, selectedRowKeys, rowKey } = this._getTableInfo();
        if (dataSource.length === 0) return [];

        if (selectedRowKeys.length > 0) {
            const keySet = new Set(selectedRowKeys);
            return structuredClone(dataSource.filter(item => keySet.has(this._getRowKey(item, rowKey))));
        }

        return structuredClone(dataSource.filter(item => item.checked));
    }
}
