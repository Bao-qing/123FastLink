/**
 * TableRowSelector - 通过 React Fiber 获取 Ant Design Table 的行数据
 *
 * @example
 * const selector = new TableRowSelector();
 * selector.getAll();       // 获取全部行
 * selector.getSelection(); // 获取选中行
 *
 * @typedef {Object} FileRecord
 * @property {number} FileId - 文件ID
 * @property {string} FileName - 文件名
 * @property {number} Type - 类型 (0=文件, 1=文件夹)
 * @property {number} Size - 文件大小 (bytes)
 * @property {string} ContentType - 内容类型
 * @property {string} S3KeyFlag - S3存储标识
 * @property {string} CreateAt - 创建时间 (ISO 8601)
 * @property {string} UpdateAt - 更新时间 (ISO 8601)
 * @property {boolean} Hidden - 是否隐藏
 * @property {string} Etag - 文件哈希
 * @property {number} Status - 状态 (0=正常, 2=异常)
 * @property {number} ParentFileId - 父文件夹ID
 * @property {number} Category - 文件分类
 * @property {number} PunishFlag - 违规标记
 * @property {string} DownloadUrl - 下载链接
 * @property {number} AbnormalAlert - 异常提醒
 * @property {boolean} Trashed - 是否在回收站
 * @property {string} StorageNode - 存储节点
 * @property {number} DirectLink - 直链状态
 * @property {string} AbsPath - 绝对路径
 * @property {string} PinYin - 拼音索引
 * @property {boolean} checked - 是否选中
 */
class TableRowSelector {
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
