// ==UserScript==
// @name         Margonem — Centrum Moderacji 
// @namespace    https://github.com/Doiua97/panel-moderacji-weryfikacji
// @version      3.3.54
// @description  Lokalne centrum moderacji i dokumentowania weryfikacji w Margonem.
// @author       Doiua
// @match        https://*.margonem.pl/*
// @match        https://*.margonem.com/*
// @exclude      https://margonem.pl/*
// @exclude      https://www.margonem.pl/*
// @exclude      https://new.margonem.pl/*
// @exclude      https://forum.margonem.pl/*
// @exclude      https://commons.margonem.pl/*
// @exclude      https://dev-commons.margonem.pl/*
// @exclude      https://margonem.com/*
// @exclude      https://www.margonem.com/*
// @run-at       document-idle
// @grant        GM_info
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      raw.githubusercontent.com
// @connect      www.margonem.pl
// @connect      www.margonem.com
// @downloadURL  https://github.com/Doiua97/panel-moderacji-weryfikacji/raw/refs/heads/main/panel-moderacji-weryfikacja.user.js
// @updateURL    https://github.com/Doiua97/panel-moderacji-weryfikacji/raw/refs/heads/main/panel-moderacji-weryfikacja.user.js
// ==/UserScript==

(async () => {
  const base = "https://raw.githubusercontent.com/Doiua97//panel-moderacji-weryfikacji/main/src2";
  const version = GM_info.script.version;

  const get = file => new Promise((resolve, reject) =>
    GM_xmlhttpRequest({
      method: "GET",
      url: `${base}/${file}?v=${version}`,
      onload: r => r.status >= 200 && r.status < 400
        ? resolve(r.responseText)
        : reject(new Error(`HTTP ${r.status}`)),
      onerror: () => reject(new Error("Błąd połączenia"))
    })
  );

  try {
    const style = document.createElement("style");
    style.id = "margo-moderation-center-styles";
    style.textContent = await get("panel.css");
    document.head.appendChild(style);

    const js = await get("panel.js");
    new Function(
      "GM_xmlhttpRequest",
      "unsafeWindow",
      "version",
      js
    )(GM_xmlhttpRequest, unsafeWindow, version);
  } catch (error) {
    document.getElementById("margo-moderation-center-styles")?.remove();
    console.error("[Centrum Moderacji]", error);
  }
})();
