const path = require('path');
const webpack = require('webpack');
const { version } = require('./version.json');

function createConfig({ enableQuark, enableTianyi, filename }) {
    const matchRules = [
        '// @include      *://*.123*.com/*',
        '// @include      *://*.123*.cn/*',
    ];
    if (enableQuark) {
        matchRules.push(
            '// @match        https://pan.quark.cn/*',
            '// @match        https://drive.quark.cn/*',
            '// @match        https://pan.quark.cn/s/*',
            '// @match        https://drive.quark.cn/s/*',
        );
    }
    if (enableTianyi) {
        matchRules.push(
            '// @match        https://cloud.189.cn/web/*',
        );
    }

    const grantRules = [
        '// @grant        GM_getValue',
        '// @grant        GM_setValue',
    ];
    if (enableQuark || enableTianyi) {
        grantRules.push(
            '// @grant        GM_setClipboard',
            '// @grant        GM_notification',
            '// @grant        GM_xmlhttpRequest',
            '// @grant        GM_info',
        );
    }

    const connectRules = [];
    if (enableQuark) {
        connectRules.push(
            '// @connect      drive.quark.cn',
            '// @connect      drive-pc.quark.cn',
            '// @connect      pc-api.uc.cn',
        );
    }
    if (enableTianyi) {
        connectRules.push(
            '// @connect      cloud.189.cn',
        );
    }

    const userScriptHeader = `// ==UserScript==
// @name         123FastLink${(enableQuark || enableTianyi) ? ' With Platform' : ''}
// @namespace    http://tampermonkey.net/
// @version      ${version}
// @description  123云盘秒传链接脚本${enableQuark ? '，集成夸克网盘' : ''}${enableTianyi ? '，集成天翼云盘' : ''}
// @author       Baoqing
// @author       Chaofan
// @author       lipkiat
// @author       JiangKaslana
${matchRules.join('\n')}
// @icon         https://www.google.com/s2/favicons?sz=64&domain=123pan.com
${grantRules.join('\n')}
${connectRules.length > 0 ? connectRules.join('\n') + '\n' : ''}// @license      MIT
// ==/UserScript==
`;

    return {
        entry: './src/index.js',
        output: {
            filename,
            path: path.resolve(__dirname, 'dist'),
        },
        mode: 'production',
        optimization: {
            minimize: false,
        },
        module: {
            rules: [
                {
                    test: /\.css$/,
                    use: 'raw-loader',
                },
            ],
        },
        plugins: [
            new webpack.DefinePlugin({
                __ENABLE_QUARK__: JSON.stringify(enableQuark),
                __ENABLE_TIANYI__: JSON.stringify(enableTianyi),
            }),
            new webpack.BannerPlugin({
                banner: userScriptHeader,
                raw: true,
            }),
        ],
        target: 'web',
    };
}

module.exports = [
    createConfig({
        enableQuark: false,
        enableTianyi: false,
        filename: '123FastLink.v3.user.js',
    }),
    createConfig({
        enableQuark: true,
        enableTianyi: true,
        filename: '123FastLinkWithPlatform.v3.user.js',
    }),
];
