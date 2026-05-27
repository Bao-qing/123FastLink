export function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export function findReact(dom, traverseUp = 0) {
    let key = Object.keys(dom).find((key) => {
        return (
            key.startsWith("__reactFiber$") ||
            key.startsWith("__reactInternalInstance$")
        );
    });

    let domFiber = dom[key];
    if (domFiber == null) return null;

    if (domFiber._currentElement) {
        let compFiber = domFiber._currentElement._owner;
        for (let i = 0; i < traverseUp; i++) {
            compFiber = compFiber._currentElement._owner;
        }
        return compFiber._instance;
    }

    const GetCompFiber = (fiber) => {
        let parentFiber = fiber.return;
        while (typeof parentFiber.type === "string") {
            parentFiber = parentFiber.return;
        }
        return parentFiber;
    };

    let compFiber = GetCompFiber(domFiber);
    for (let i = 0; i < traverseUp; i++) {
        compFiber = GetCompFiber(compFiber);
    }

    return compFiber.stateNode || compFiber;
}

export function findVue(dom, traverseUp = 0) {
    let i = 0;
    let el = dom;
    while (i < traverseUp) {
        if (!el) return null;
        el = el.parentElement;
        i++;
    }
    return el?.__vue__;
}

export function getCachedCookie() {
    return GM_getValue("quark_cookie", "");
}

export function saveCookie(cookie) {
    GM_setValue("quark_cookie", cookie);
}

export function getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(";").shift();
    return null;
}

export function showCookieInputDialog(onSave, currentCookie = "") {
    const dialog = document.createElement("div");
    dialog.id = "quark-cookie-input-dialog";
    dialog.innerHTML = `
        <div style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); z-index: 10000; display: flex; align-items: center; justify-content: center;">
          <div style="background: white; padding: 30px; border-radius: 8px; width: 80%; max-width: 800px; max-height: 80vh; display: flex; flex-direction: column;">
            <div style="font-size: 18px; font-weight: bold; margin-bottom: 15px;">设置夸克网盘Cookie</div>
            <div style="font-size: 14px; color: #666; margin-bottom: 15px;">
              请打开浏览器开发者工具(F12) → Network → 找到任意请求 → 复制完整的Cookie值<br/>
              <strong>必须包含：__puus、__pus、ctoken 等关键Cookie</strong>
            </div>
            <textarea id="quark-cookie-input"
              placeholder="粘贴完整的Cookie字符串，例如：ctoken=xxx; __puus=xxx; __pus=xxx; ..."
              style="flex: 1; min-height: 200px; padding: 10px; border: 1px solid #d9d9d9; border-radius: 4px; font-family: monospace; font-size: 12px; resize: vertical;">${currentCookie}</textarea>
            <div style="display: flex; gap: 10px; justify-content: flex-end; margin-top: 15px;">
              <button id="quark-cookie-save-btn" style="padding: 8px 20px; background: #0d53ff; color: white; border: none; border-radius: 4px; cursor: pointer;">保存</button>
              <button id="quark-cookie-cancel-btn" style="padding: 8px 20px; background: #d9d9d9; color: #333; border: none; border-radius: 4px; cursor: pointer;">取消</button>
            </div>
          </div>
        </div>
    `;
    document.body.appendChild(dialog);

    document.getElementById("quark-cookie-save-btn").onclick = () => {
        const cookie = document.getElementById("quark-cookie-input").value.trim();
        if (!cookie) {
            alert("Cookie不能为空");
            return;
        }
        saveCookie(cookie);
        dialog.remove();
        GM_notification({ text: "Cookie已保存", timeout: 2000 });
        if (onSave) onSave(cookie);
    };

    document.getElementById("quark-cookie-cancel-btn").onclick = () => {
        dialog.remove();
    };
}

export function gmGet(url, headers = {}) {
    return new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
            method: "GET",
            url: url,
            headers: headers,
            onload: function (response) {
                if (response.status >= 200 && response.status < 300) {
                    resolve(response.responseText);
                } else {
                    reject(new Error(`请求失败: ${response.status}`));
                }
            },
            onerror: function () {
                reject(new Error("网络请求失败"));
            },
        });
    });
}

export function gmPost(url, data, headers = {}) {
    return new Promise((resolve, reject) => {
        const requestData = JSON.stringify(data);
        const QUARK_UA =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) quark-cloud-drive/2.5.20 Chrome/100.0.4896.160 Electron/18.3.5.4-b478491100 Safari/537.36 Channel/pckk_other_ch";
        const defaultHeaders = {
            "Content-Type": "application/json;charset=utf-8",
            "User-Agent": QUARK_UA,
            Origin: location.origin,
            Referer: `${location.origin}/`,
            Dnt: "",
            "Cache-Control": "no-cache",
            Pragma: "no-cache",
            Expires: "0",
        };

        GM_xmlhttpRequest({
            method: "POST",
            url: url,
            headers: { ...defaultHeaders, ...headers },
            data: requestData,
            onload: function (response) {
                try {
                    const result = JSON.parse(response.responseText);
                    resolve(result);
                } catch (e) {
                    reject(new Error("响应解析失败"));
                }
            },
            onerror: function () {
                reject(new Error("网络请求失败"));
            },
        });
    });
}
