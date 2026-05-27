import { GlobalConfig } from './config';

export class logger {
    constructor(console) {
        this.console = console;
        this.debugMode = GlobalConfig.DEBUGMODE;
    }

    log(...args) {
        if (!GlobalConfig.DEBUGMODE) return;
        this.console.log(...args);
    }

    error(...args) {
        this.console.error(...args);
    }

    warn(...args) {
        this.console.warn(...args);
    }

    info(...args) {
        this.console.info(...args);
    }
}
