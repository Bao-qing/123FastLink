export class TableRowSelector {
    /**
     * @param {number} tableIndex - 页面中第几个 .ant-table-wrapper (从0开始)
     */
    constructor(tableIndex = 0) {
        this.tableIndex = tableIndex;
    }

    /**
     * 从 React Fiber 树中提取 dataSource
     * @private
     * @returns {FileRecord[]}
     */
    _getDataSource() {
        const tables = document.querySelectorAll('.ant-table-wrapper');
        const table = tables[this.tableIndex];
        if (!table) return [];

        const fiberKey = Object.keys(table).find(k => k.startsWith('__reactFiber$'));
        if (!fiberKey) return [];

        const rootFiber = table[fiberKey];
        // depth 1: InternalTable 组件
        const internalTableFiber = rootFiber?.return;
        let data = internalTableFiber?.memoizedProps?.dataSource;

        // depth 2: Table 组件 (备用)
        if (!Array.isArray(data)) {
            data = internalTableFiber?.return?.memoizedProps?.dataSource;
        }

        return Array.isArray(data) ? data : [];
    }

    /**
     * 获取表格全部行数据
     * @returns {FileRecord[]}
     */
    getAll() {
        return structuredClone(this._getDataSource());
    }

    /**
     * 获取当前选中的行数据
     * @returns {FileRecord[]}
     */
    getSelection() {
        return structuredClone(this._getDataSource().filter(item => item.checked));
    }
}
