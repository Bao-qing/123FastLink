import { initQuark } from './quark/QuarkUi.js';
import { initTianyi } from './tianyi/TianyiUi.js';

export function init() {
    const hostname = location.hostname;

    if (__ENABLE_QUARK__ && hostname.includes('quark.cn')) {
        initQuark();
    }

    if (__ENABLE_TIANYI__ && hostname.includes('cloud.189.cn')) {
        initTianyi();
    }
}
