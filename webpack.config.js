const path = require('path');
const webpack = require('webpack');

const userScriptHeader = `// ==UserScript==
// @name         123FastLink
// @namespace    http://tampermonkey.net/
// @version      2026.5.27.1
// @description  123云盘秒传链接脚本
// @author       Baoqing
// @author       Chaofan
// @author       lipkiat
// @include      *://*.123*.com/*
// @include      *://*.123*.cn/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=123pan.com
// @grant        GM_getValue
// @grant        GM_setValue
// @license      MIT
// ==/UserScript==
`;

module.exports = {
    entry: './src/index.js',
    output: {
        filename: '123FastLink.v3.user.js',
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
        new webpack.BannerPlugin({
            banner: userScriptHeader,
            raw: true,
        }),
    ],
    target: 'web',
};
