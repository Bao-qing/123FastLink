import { GlobalConfig } from './config';

const COLORS = {
    log: 'color: #6b7280',
    info: 'color: #3b82f6',
    warn: 'color: #f59e0b; font-weight: bold',
    error: 'color: #ef4444; font-weight: bold'
};

function timestamp() {
    const d = new Date();
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}.${d.getMilliseconds().toString().padStart(3, '0')}`;
}

export function createLogger(moduleName) {
    return {
        log(...args) {
            if (!GlobalConfig.DEBUGMODE) return;
            window.console.log(`%c[${timestamp()}] [123FL] [${moduleName}]`, COLORS.log, ...args);
        },
        info(...args) {
            if (!GlobalConfig.DEBUGMODE) return;
            window.console.info(`%c[${timestamp()}] [123FL] [${moduleName}]`, COLORS.info, ...args);
        },
        warn(...args) {
            window.console.warn(`%c[${timestamp()}] [123FL] [${moduleName}]`, COLORS.warn, ...args);
        },
        error(...args) {
            window.console.error(`%c[${timestamp()}] [123FL] [${moduleName}]`, COLORS.error, ...args);
        }
    };
}

export const logger = createLogger('Main');
