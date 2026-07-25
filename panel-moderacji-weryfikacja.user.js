// ==UserScript==
// @name         Margonem — Centrum Moderacji
// @namespace    https://github.com/Doiua97/panel-moderacji-weryfikacji
// @version      3.3.4
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
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      www.margonem.pl
// @connect      www.margonem.com
// @downloadURL  https://raw.githubusercontent.com/Doiua97/panel-moderacji-weryfikacji/main/panel-moderacji-weryfikacja.user.js
// @updateURL    https://raw.githubusercontent.com/Doiua97/panel-moderacji-weryfikacji/main/panel-moderacji-weryfikacja.user.js
// ==/UserScript==

(() => {
  "use strict";

  const RUNTIME_GUARD = "__MARGO_MODERATION_CENTER_RUNTIME__";
  if (window[RUNTIME_GUARD]) return;
    window[RUNTIME_GUARD] = "3.3.4";

  const SCRIPT_ID = "margo-moderation-center";
  const LOCAL_DATABASE_KEY = `${SCRIPT_ID}:local-database:v1`;
  const LOCAL_DATABASE_EVENT = `${SCRIPT_ID}:local-database-change`;
  const LAUNCHER_POSITION_KEY = `${SCRIPT_ID}:launcher-position`;
  const LAUNCHER_LOCK_KEY = `${SCRIPT_ID}:launcher-locked`;
  const PANEL_POSITION_KEY = `${SCRIPT_ID}:panel-position`;
  const PANEL_OPEN_KEY = `${SCRIPT_ID}:panel-open`;
  const ACTIVE_PANEL_POSITION_KEY = `${SCRIPT_ID}:active-panel-position`;
  const ACTIVE_PANEL_OPEN_KEY = `${SCRIPT_ID}:active-panel-open`;
  const READY_COMMANDS_KEY = `${SCRIPT_ID}:ready-commands`;
  const START_CONFIG_KEY = `${SCRIPT_ID}:start-config`;
  const WIDGET_KEY = "MARGO_MODERATION_CENTER";
  const REQUIRED_ACTIONS = ["Atakuj", "Pokaż profil", "Nawiguj"];
  const STANDARD_ACTIONS = new Set([
    "Atakuj", "Handluj", "Pocałuj", "Wyślij wiadomość", "Pokaż ekwipunek",
    "Zaproś do przyjaciół", "Zaproś do drużyny", "Pokaż profil", "Nawiguj",
    "Złość się", "Zmień strój",
    "Rozpocznij weryfikację", "Dodaj do aktywnej weryfikacji",
    "Rozpocznij weryfikację (test)", "Dodaj do aktywnej weryfikacji (test)"
  ]);
  const DEFAULT_START_CONFIG = {
    local: "{moderator} rozpoczyna weryfikację gracza {nick}. Proszę o pozostanie w grze i stosowanie się do poleceń moderatora.",
    console: ".reminder \"{nick}\" \"Rozpoczynam weryfikację. Pozostań w miejscu i wykonuj polecenia. Kod: {kod}.\"",
    sendCode: ".reminder \"{nick}\" \"Polecenie weryfikacyjne: prześlij wiadomość z kodem {kod}\"",
    sendNick: ".reminder \"{nick}\" \"Polecenie weryfikacyjne: prześlij wiadomość zawierającą nick swojej postaci.\"",
    sendScreen: ".reminder \"{nick}\" \"Polecenie weryfikacyjne: prześlij zrzut ekranu całego okna gry.\"",
    finish: "Weryfikacja gracza {nick} została zakończona."
  };
  const DEFAULT_READY_COMMANDS = [];
  const LEGACY_READY_COMMAND_IDS = new Set(["finish", "code", "nick", "screen", "mobs", "trade", "approach"]);
  const state = {
    selected: { nick: "", id: "" },
    active: null,
    accountCharacters: [],
    lastContextTarget: null,
    scanTimer: 0,
    pollTimer: 0,
    ticker: 0,
    presenceTimer: 0,
    presence: new Map(),
    panel: null,
    activePanel: null,
    journal: []
  };

  document.addEventListener("contextmenu", event => {
    state.lastContextTarget = event.target instanceof Element ? event.target : null;
    scheduleMenuScan();
  }, true);

  waitForGame();

  function waitForGame() {
    const ready = () => Boolean(document.getElementById("GAME_CANVAS") || getEngine()?.hero);
    const start = () => {
      addStyles();
      createNativeWidget().then(created => {
        if (!created) createLauncher();
      });
      const observer = new MutationObserver(scheduleMenuScan);
      observer.observe(document.documentElement, { childList: true, subtree: true });
      scheduleMenuScan();
      startSynchronization();
      if (localStorage.getItem(PANEL_OPEN_KEY) === "1") showPanel();
    };
    if (ready()) return start();
    const observer = new MutationObserver(() => {
      if (!ready()) return;
      observer.disconnect();
      start();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(() => observer.disconnect(), 30000);
  }

  function emptyLocalDatabase() {
    return {
      version: 2,
      nextVerificationId: 1,
      nextParticipantId: 1,
      nextEventId: 1,
      verifications: []
    };
  }

  function readLocalDatabase() {
    try {
      const parsed = JSON.parse(localStorage.getItem(LOCAL_DATABASE_KEY) || "null");
      if (!parsed || !Array.isArray(parsed.verifications)) return emptyLocalDatabase();
      const database = {
        ...emptyLocalDatabase(),
        ...parsed,
        verifications: parsed.verifications
      };
      database.version = 2;
      for (const record of database.verifications) {
        const verification = record?.verification || {};
        for (const participant of record?.participants || []) {
          participant.started_at ||= participant.joined_at || verification.started_at || verification.created_at;
          participant.verification_code ||= verification.verification_code || "";
          participant.start_map_id ??= participant.last_map_id ?? verification.start_map_id ?? null;
          participant.start_map_name ||= participant.last_map_name || verification.start_map_name || null;
        }
      }
      return database;
    } catch {
      return emptyLocalDatabase();
    }
  }

  function writeLocalDatabase(database) {
    localStorage.setItem(LOCAL_DATABASE_KEY, JSON.stringify(database));
    window.dispatchEvent(new CustomEvent(LOCAL_DATABASE_EVENT));
  }

  function cloneLocalValue(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function localDetails(record) {
    if (!record) return null;
    return cloneLocalValue({
      verification: record.verification,
      participants: record.participants || [],
      events: record.events || []
    });
  }

  function findLocalRecord(database, verificationId) {
    return database.verifications.find(record =>
      String(record?.verification?.id || "") === String(verificationId || "")
    ) || null;
  }

  function addLocalEvent(database, record, event) {
    const now = new Date().toISOString();
    const created = {
      id: String(database.nextEventId++),
      title: event.title || event.eventType || "Zdarzenie",
      event_type: event.eventType || "NOTE",
      details: cloneLocalValue(event.details || {}),
      map_id: event.mapId ?? null,
      map_name: event.mapName || null,
      participant_id: event.participantId ?? null,
      occurred_at: event.occurredAt || now
    };
    record.events ||= [];
    record.events.push(created);
    return created;
  }

  function mutateLocalVerification(verificationId, change) {
    const database = readLocalDatabase();
    const record = findLocalRecord(database, verificationId);
    if (!record) return null;
    change(record, database);
    writeLocalDatabase(database);
    return localDetails(record);
  }

  function getLocalActiveVerification() {
    const world = normalizeWorldName(currentWorldName());
    const database = readLocalDatabase();
    const record = [...database.verifications].reverse().find(item =>
      item?.verification?.status === "ACTIVE" &&
      normalizeWorldName(item.verification.world) === world
    );
    return localDetails(record);
  }

  function getLocalVerification(verificationId) {
    return localDetails(findLocalRecord(readLocalDatabase(), verificationId));
  }

  function getLocalJournal(limit = 20) {
    const world = normalizeWorldName(currentWorldName());
    return readLocalDatabase().verifications
      .filter(record => normalizeWorldName(record?.verification?.world) === world)
      .slice(-limit)
      .reverse()
      .map(localDetails);
  }

  function createLocalVerification(data) {
    const database = readLocalDatabase();
    const world = normalizeWorldName(data.world);
    const existing = database.verifications.find(record =>
      record?.verification?.status === "ACTIVE" &&
      normalizeWorldName(record.verification.world) === world
    );
    if (existing) throw new Error("ACTIVE_VERIFICATION_EXISTS");
    const now = new Date().toISOString();
    const verificationId = String(database.nextVerificationId++);
    const participantId = String(database.nextParticipantId++);
    const record = {
      verification: {
        id: verificationId,
        public_number: Number(verificationId),
        world: data.world,
        verifier_character: data.verifierCharacter,
        target_character: data.targetCharacter,
        target_character_id: data.targetCharacterId || null,
        start_map_id: data.startMapId || null,
        start_map_name: data.startMapName || null,
        source: data.source || "OWN_INITIATIVE",
        verification_code: data.code || "",
        status: "ACTIVE",
        started_at: now,
        ended_at: null,
        created_at: now,
        updated_at: now
      },
      participants: [{
        id: participantId,
        character_name: data.targetCharacter,
        character_id: data.targetCharacterId || null,
        joined_at: now,
        started_at: now,
        verification_code: data.code || "",
        start_map_id: data.startMapId || null,
        start_map_name: data.startMapName || null,
        resolved_at: null,
        presence_status: "PRESENT",
        last_map_id: data.startMapId || null,
        last_map_name: data.startMapName || null,
        last_x: data.x ?? null,
        last_y: data.y ?? null
      }],
      events: []
    };
    addLocalEvent(database, record, {
      title: "Utworzono sesję weryfikacji",
      eventType: "VERIFICATION_CREATED",
      details: {
        targetCharacter: data.targetCharacter,
        moderator: data.verifierCharacter,
        code: data.code || ""
      },
      mapId: data.startMapId,
      mapName: data.startMapName,
      participantId
    });
    addLocalEvent(database, record, {
      title: "Rozpoczęto weryfikację",
      eventType: "VERIFICATION_STARTED",
      details: {
        targetCharacter: data.targetCharacter,
        moderator: data.verifierCharacter,
        code: data.code || ""
      },
      mapId: data.startMapId,
      mapName: data.startMapName,
      participantId
    });
    database.verifications.push(record);
    writeLocalDatabase(database);
    return localDetails(record);
  }

  function startSynchronization() {
    refreshActive();
    clearInterval(state.pollTimer);
    state.pollTimer = setInterval(refreshActive, 1000);
    clearInterval(state.ticker);
    state.ticker = setInterval(updateLiveTime, 1000);
    clearInterval(state.presenceTimer);
    state.presenceTimer = setInterval(synchronizePresence, 2000);
    window.addEventListener("storage", event => {
      if (event.key === LOCAL_DATABASE_KEY) refreshActive();
    });
    window.addEventListener(LOCAL_DATABASE_EVENT, refreshActive);
  }

  function refreshActive() {
    const details = getLocalActiveVerification();
    const oldId = state.active?.verification?.id || "";
    const nextId = details?.verification?.id || "";
    state.active = details;
    state.journal = getLocalJournal();
    if (oldId !== nextId) {
      state.presence.clear();
      resetEnhancedMenus();
      scheduleMenuScan();
    }
    renderActiveSections();
    if (details?.verification?.status === "ACTIVE" && localStorage.getItem(ACTIVE_PANEL_OPEN_KEY) === "1") {
      showActivePanel();
    }
    return details;
  }

  function refreshActiveById() {
    const id = state.active?.verification?.id;
    if (!id) return refreshActive();
    state.active = getLocalVerification(id);
    if (!state.active) return refreshActive();
    renderActiveSections();
    return state.active;
  }

  function createLauncher() {
    if (document.getElementById(`${SCRIPT_ID}-launcher`)) return;
    const launcher = document.createElement("button");
    launcher.id = `${SCRIPT_ID}-launcher`;
    launcher.type = "button";
    launcher.innerHTML = `<strong>C</strong><i></i>`;
    launcher.setAttribute("aria-label", "Otwórz lub zamknij Centrum Moderacji");
    document.body.appendChild(launcher);
    restorePosition(launcher, LAUNCHER_POSITION_KEY);
    updateLauncherView(launcher);
    makeMovable(launcher, {
      positionKey: LAUNCHER_POSITION_KEY,
      lockKey: LAUNCHER_LOCK_KEY,
      handle: launcher,
      click: () => {
        state.panel ? closePanel() : showPanel();
      },
      lockLabel: "Centrum Moderacji",
      onLockChange: () => updateLauncherView(launcher)
    });
  }

  async function createNativeWidget() {
    try {
      const engine = getEngine();
      const ready = await waitUntil(() =>
        engine?.allInit &&
        typeof engine?.widgetManager?.getDefaultWidgetSet === "function" &&
        typeof engine?.widgetManager?.createOneWidget === "function"
      );
      if (!ready) return false;
      const manager = engine.widgetManager;
      const widgetSet = manager.getDefaultWidgetSet();
      if (!widgetSet || typeof widgetSet !== "object") return false;

      const serverStoragePosition = engine.serverStorage?.get?.(
        manager.getPathToHotWidgetVersion?.()
      );
      const empty = manager.getFirstEmptyWidgetSlot?.();
      const fallbackPosition = empty ? [empty.slot, empty.container] : null;
      const widgetPosition = serverStoragePosition?.[WIDGET_KEY] || fallbackPosition;
      if (!Array.isArray(widgetPosition) || widgetPosition.length < 2) return false;

      const togglePanel = () => {
        state.panel ? closePanel() : showPanel();
      };
      widgetSet[WIDGET_KEY] = {
        keyName: WIDGET_KEY,
        index: widgetPosition[0],
        pos: widgetPosition[1],
        txt: "Centrum Moderacji",
        type: "red",
        alwaysExist: true,
        default: true,
        clb: togglePanel
      };
      manager.createOneWidget(WIDGET_KEY, { [WIDGET_KEY]: widgetPosition }, true, []);
      manager.setEnableDraggingButtonsWidget?.(false);

      if (!document.getElementById(`${SCRIPT_ID}-widget-style`)) {
        const style = document.createElement("style");
        style.id = `${SCRIPT_ID}-widget-style`;
        style.textContent = `
          .main-buttons-container .widget-button .icon.${WIDGET_KEY}{
            background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='44' height='44'%3E%3Cdefs%3E%3ClinearGradient id='g' x2='0' y2='1'%3E%3Cstop stop-color='%23182d3d'/%3E%3Cstop offset='1' stop-color='%23081420'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect x='2' y='2' width='40' height='40' rx='7' fill='url(%23g)' stroke='%235fd7d3' stroke-width='2'/%3E%3Ctext x='22' y='29' text-anchor='middle' font-family='Arial' font-size='22' font-weight='700' fill='%2369e3df'%3EC%3C/text%3E%3C/svg%3E")!important;
            background-position:0 0!important;
            background-size:44px 44px!important;
            width:44px!important;height:44px!important;margin:0!important;top:0!important;left:0!important
          }`;
        document.head.appendChild(style);
      }
      return true;
    } catch (error) {
      console.warn("[Centrum Moderacji] Nie udało się utworzyć natywnego widżetu:", error);
      return false;
    }
  }

  async function waitUntil(predicate, interval = 50, attempts = 300) {
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        if (predicate()) return true;
      } catch {}
      await new Promise(resolve => setTimeout(resolve, interval));
    }
    return false;
  }

  function updateLauncherView(launcher) {
    const locked = localStorage.getItem(LAUNCHER_LOCK_KEY) === "1";
    launcher.dataset.locked = locked ? "1" : "0";
    launcher.querySelector("i").textContent = locked ? "🔒" : "🔓";
    launcher.title = locked
      ? "Centrum Moderacji · PPM odblokowuje pozycję"
      : "Centrum Moderacji · przeciągnij lub kliknij; PPM blokuje pozycję";
  }

  function makeMovable(element, { positionKey, lockKey, handle, click, lockLabel, onLockChange }) {
    let drag = null;
    let moved = false;
    handle.addEventListener("pointerdown", event => {
      if (event.button !== 0 || localStorage.getItem(lockKey) === "1") return;
      if (event.target.closest("button") && event.target !== handle && element !== handle) return;
      const rect = element.getBoundingClientRect();
      drag = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      moved = false;
      handle.setPointerCapture?.(event.pointerId);
      event.preventDefault();
    });
    handle.addEventListener("pointermove", event => {
      if (!drag) return;
      const left = clamp(event.clientX - drag.x, 0, Math.max(0, innerWidth - element.offsetWidth));
      const top = clamp(event.clientY - drag.y, 0, Math.max(0, innerHeight - element.offsetHeight));
      Object.assign(element.style, { left: `${Math.round(left)}px`, top: `${Math.round(top)}px`, right: "auto" });
      moved = true;
    });
    handle.addEventListener("pointerup", event => {
      if (!drag) return;
      drag = null;
      handle.releasePointerCapture?.(event.pointerId);
      savePosition(element, positionKey);
    });
    handle.addEventListener("pointercancel", () => { drag = null; });
    if (click) {
      element.addEventListener("click", event => {
        if (moved) {
          moved = false;
          event.preventDefault();
          return;
        }
        click();
      });
    }
    // Blokowanie pozycji PPM dotyczy wyłącznie ikony uruchamiającej.
    // Okno Centrum pozostaje zawsze przesuwalne za górną belkę.
    if (element.id && onLockChange) {
      element.addEventListener("contextmenu", event => {
        if (!event.target.closest(`#${element.id}`)) return;
        event.preventDefault();
        event.stopPropagation();
        const next = localStorage.getItem(lockKey) === "1" ? "0" : "1";
        localStorage.setItem(lockKey, next);
        onLockChange();
        notice(next === "1" ? `Pozycja „${lockLabel}” została zablokowana.` : `Pozycja „${lockLabel}” została odblokowana.`);
      });
    }
  }

  function restorePosition(element, key) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || "null");
      if (!Number.isFinite(value?.left) || !Number.isFinite(value?.top)) return;
      element.style.left = `${clamp(value.left, 0, Math.max(0, innerWidth - element.offsetWidth))}px`;
      element.style.top = `${clamp(value.top, 0, Math.max(0, innerHeight - element.offsetHeight))}px`;
      element.style.right = "auto";
    } catch {}
  }

  function savePosition(element, key) {
    const rect = element.getBoundingClientRect();
    localStorage.setItem(key, JSON.stringify({ left: Math.round(rect.left), top: Math.round(rect.top) }));
  }

  function showPanel(player = null) {
    if (state.panel) closePanel();
    if (player?.nick) state.selected = { nick: player.nick, id: player.id || resolvePlayerId(player.nick) || "" };
    const overlay = document.createElement("div");
    overlay.id = `${SCRIPT_ID}-panel`;
    overlay.innerHTML = panelMarkup();
    document.body.appendChild(overlay);
    state.panel = overlay;
    localStorage.setItem(PANEL_OPEN_KEY, "1");
    restorePosition(overlay.querySelector(".mc-window"), PANEL_POSITION_KEY);
    bindPanel(overlay);
    renderSelected();
    renderReadyCommands();
    renderActiveSections();
  }

  function closePanel() {
    state.panel?.remove();
    state.panel = null;
    localStorage.setItem(PANEL_OPEN_KEY, "0");
  }

  function panelMarkup() {
    const start = readStartConfig();
    return `
      <div class="mc-window">
        <header class="mc-head">
          <div><small>CENTRUM OPERACYJNE</small><h2>Centrum Moderacji</h2></div>
          <div class="mc-head-actions">
            <span class="mc-rank" data-user-rank>${escapeMarkup(getModeratorRankLabel())}</span>
            <button type="button" data-close aria-label="Zamknij">×</button>
          </div>
        </header>

        <div class="mc-selected">Wybrany gracz: <strong data-selected>nie rozpoznano</strong></div>
        <div class="mc-search">
          <input data-search placeholder="Wpisz nick, ID konta lub link profilu">
          <button type="button" data-select-player>Wybierz gracza</button>
          <button type="button" data-clear-player>Wyczyść</button>
        </div>
        <div class="mc-search-results" data-search-results></div>
        <p class="mc-note">Tryb interfejsu. Serwer gry nadal sprawdza uprawnienia do każdego polecenia konsoli.</p>

        <div class="mc-command-fields">
          <label>Czas<input data-time placeholder="np. 12h"></label>
          <label>Kod<input data-code readonly placeholder="użyj przycisku Losuj"></label>
          <button type="button" data-random-code>Losuj</button>
          <label class="wide">Powód / treść<input data-reason placeholder="Wpisz powód lub własną treść"></label>
        </div>

        <div class="mc-command-tabs" data-command-sections>
          <button type="button" data-command-tab="player">Gracz</button>
          <button type="button" data-command-tab="location">Bieżąca lokalizacja</button>
        </div>
        <div class="mc-command-panes">
          <section class="mc-box" data-command-section="player" hidden>
            <h3>Gracz</h3>
            <div class="mc-actions">
              <button data-command="reminder">Wyślij upomnienie</button>
              <button data-command="mute">Nałóż wyciszenie</button>
              <button data-command="unmute">Zdejmij wyciszenie</button>
              <button class="danger" data-command="kill">Kill</button>
              <button class="danger" data-command="unkill">Unkill</button>
            </div>
          </section>
          <section class="mc-box" data-command-section="location" hidden>
            <h3>Bieżąca lokalizacja</h3>
            <div class="mc-actions">
              <button data-command="chatlock">Zablokuj czat</button>
              <button data-command="chatunlock">Odblokuj czat</button>
              <button data-command="chatadd">Zezwól graczowi</button>
              <button data-command="chatdel">Odbierz pozwolenie</button>
              <button data-command="chatlist">Lista uprawnionych</button>
              <button data-command="reminderlist">Lista upomnień</button>
              <button data-command="mutedlist">Lista wyciszonych</button>
            </div>
          </section>
        </div>

        <details class="mc-block" open>
          <summary>Aktywna weryfikacja <b data-active-state>BRAK SESJI</b></summary>
          <div data-active-summary></div>
        </details>

        <details class="mc-block">
          <summary>Rozpoczęcie i zakończenie weryfikacji <b>ZAPIS LOKALNY</b></summary>
          <p>Pierwsza wiadomość trafia na czat lokalny, a następnie polecenie do konsoli. Sesję rozpoczynasz przez PPM na graczu.</p>
          <label>Wiadomość lokalna<textarea data-start-local>${escapeMarkup(start.local)}</textarea></label>
          <label>Komenda konsoli<textarea data-start-console>${escapeMarkup(start.console)}</textarea></label>
          <label>Polecenie „Wyślij kod”<textarea data-send-code-command>${escapeMarkup(start.sendCode)}</textarea></label>
          <p>W poleceniu „Wyślij kod” użyj <code>{nick}</code> oraz <code>{kod}</code>. Kod zostanie zastąpiony osobnym kodem wybranego uczestnika.</p>
          <label>Polecenie „Wyślij nick”<textarea data-send-nick-command>${escapeMarkup(start.sendNick)}</textarea></label>
          <label>Polecenie „Wyślij screen”<textarea data-send-screen-command>${escapeMarkup(start.sendScreen)}</textarea></label>
          <p>Polecenia są wysyłane przez konsolę gry do uczestnika wybranego w panelu aktywnej weryfikacji. Możesz użyć: <code>{nick}</code>, <code>{moderator}</code> oraz <code>{kod}</code>.</p>
          <label>Wiadomość kończąca na czat lokalny<textarea data-finish-local>${escapeMarkup(start.finish)}</textarea></label>
          <p>W wiadomości kończącej możesz użyć: <code>{nick}</code> oraz <code>{moderator}</code>.</p>
          <button type="button" data-save-start>Zapisz</button>
        </details>

        <details class="mc-block" open>
          <summary>Gotowe polecenia <b>MENU POD PPM</b></summary>
          <p>Zmienne: <code>{nick}</code>, <code>{moderator}</code>, <code>{czas}</code>, <code>{powod}</code>/<code>{powód}</code>, <code>{kod}</code>, <code>{tresc}</code>/<code>{treść}</code>.</p>
          <div class="mc-ready-editor">
            <input data-ready-label placeholder="Nazwa polecenia">
            <select data-ready-channel><option value="CONSOLE">Konsola</option><option value="LOCAL">Czat lokalny</option></select>
            <textarea data-ready-content placeholder="Treść polecenia"></textarea>
            <button type="button" data-ready-save>Dodaj</button>
            <button type="button" data-ready-cancel hidden>Anuluj edycję</button>
          </div>
          <div data-ready-list></div>
        </details>

        <details class="mc-block">
          <summary>Dziennik weryfikacji <b>ZAPIS LOKALNY</b></summary>
          <div class="mc-journal-toolbar">
            <span>Usuwa wszystkie zapisane weryfikacje z aktualnego świata.</span>
            <button type="button" class="danger" data-clear-journal>Wyczyść</button>
          </div>
          <div data-timeline></div>
        </details>
      </div>`;
  }

  function bindPanel(overlay) {
    const win = overlay.querySelector(".mc-window");
    const head = overlay.querySelector(".mc-head");
    makeMovable(win, {
      positionKey: PANEL_POSITION_KEY,
      lockKey: `${SCRIPT_ID}:never-lock-panel`,
      handle: head,
      lockLabel: "Centrum Moderacji"
    });
    overlay.querySelector("[data-close]").addEventListener("click", closePanel);
    overlay.querySelector("[data-select-player]").addEventListener("click", selectFromSearch);
    overlay.querySelector("[data-search]").addEventListener("keydown", event => {
      if (event.key === "Enter") selectFromSearch();
    });
    overlay.querySelector("[data-clear-player]").addEventListener("click", () => {
      state.selected = { nick: "", id: "" };
      state.accountCharacters = [];
      const input = overlay.querySelector("[data-search]");
      const results = overlay.querySelector("[data-search-results]");
      if (input) input.value = "";
      if (results) results.innerHTML = "";
      renderSelected();
    });
    overlay.querySelector("[data-random-code]").addEventListener("click", randomizeVerificationCode);
    overlay.querySelectorAll("[data-command-tab]").forEach(tab => {
      tab.addEventListener("click", () => {
        const selected = tab.dataset.commandTab;
        const pane = overlay.querySelector(`[data-command-section="${selected}"]`);
        const willOpen = pane?.hidden !== false;
        overlay.querySelectorAll("[data-command-section]").forEach(section => { section.hidden = true; });
        overlay.querySelectorAll("[data-command-tab]").forEach(button => button.classList.remove("active"));
        if (pane && willOpen) {
          pane.hidden = false;
          tab.classList.add("active");
        }
      });
    });
    overlay.querySelectorAll("[data-command]").forEach(button => {
      button.addEventListener("click", () => executeModeratorCommand(button.dataset.command));
    });
    overlay.querySelector("[data-save-start]").addEventListener("click", () => {
      const config = {
        local: overlay.querySelector("[data-start-local]").value.trim(),
        console: overlay.querySelector("[data-start-console]").value.trim(),
        sendCode: overlay.querySelector("[data-send-code-command]").value.trim() || DEFAULT_START_CONFIG.sendCode,
        sendNick: overlay.querySelector("[data-send-nick-command]").value.trim() || DEFAULT_START_CONFIG.sendNick,
        sendScreen: overlay.querySelector("[data-send-screen-command]").value.trim() || DEFAULT_START_CONFIG.sendScreen,
        finish: overlay.querySelector("[data-finish-local]").value.trim() || DEFAULT_START_CONFIG.finish
      };
      localStorage.setItem(START_CONFIG_KEY, JSON.stringify(config));
      notice("Zapisano treści rozpoczęcia i zakończenia weryfikacji.");
    });
    overlay.querySelector("[data-ready-save]").addEventListener("click", saveReadyCommand);
    overlay.querySelector("[data-ready-cancel]").addEventListener("click", resetReadyEditor);
    overlay.querySelector("[data-clear-journal]").addEventListener("click", clearVerificationJournal);
  }

  function clearVerificationJournal() {
    if (state.active?.verification?.status === "ACTIVE") {
      notice("Najpierw zakończ aktywną weryfikację.");
      return;
    }
    const world = normalizeWorldName(currentWorldName());
    const database = readLocalDatabase();
    const matchingRecords = database.verifications.filter(record =>
      normalizeWorldName(record?.verification?.world) === world
    );
    if (!matchingRecords.length) {
      notice("Dziennik weryfikacji jest już pusty.");
      return;
    }
    const worldLabel = currentWorldName() || "aktualnego świata";
    if (!window.confirm(`Usunąć wszystkie weryfikacje (${matchingRecords.length}) z dziennika świata ${worldLabel}? Tej operacji nie można cofnąć.`)) {
      return;
    }
    database.verifications = database.verifications.filter(record =>
      normalizeWorldName(record?.verification?.world) !== world
    );
    if (!database.verifications.length) {
      database.nextVerificationId = 1;
      database.nextParticipantId = 1;
      database.nextEventId = 1;
    }
    writeLocalDatabase(database);
    state.journal = [];
    renderActiveSections();
    notice(`Wyczyszczono dziennik świata ${worldLabel}.`);
  }

  async function selectFromSearch() {
    const input = state.panel?.querySelector("[data-search]");
    const value = normalize(input?.value);
    if (!value) return notice("Wpisz nick, ID konta lub link profilu.");
    const accountId = profileAccountId(value);
    if (accountId) {
      await detectAccountCharacters(accountId);
      return;
    }
    state.selected = { nick: value, id: resolvePlayerId(value) || "" };
    renderSelected();
  }

  function renderSelected() {
    if (!state.panel) return;
    state.panel.querySelector("[data-selected]").textContent = state.selected.nick || "nie rozpoznano";
  }

  function panelValues() {
    const selectedParticipant = findParticipant(state.selected.nick);
    return {
      nick: state.selected.nick,
      moderator: getCurrentCharacterNick(),
      czas: normalize(state.panel?.querySelector("[data-time]")?.value),
      powod: normalize(state.panel?.querySelector("[data-reason]")?.value),
      tresc: normalize(state.panel?.querySelector("[data-reason]")?.value),
      kod: normalize(state.panel?.querySelector("[data-code]")?.value)
        || normalize(selectedParticipant?.verification_code)
        || normalize(state.active?.verification?.verification_code)
    };
  }

  async function randomizeVerificationCode() {
    const code = generateCode();
    const input = state.panel?.querySelector("[data-code]");
    if (input) input.value = code;
    const verification = state.active?.verification;
    if (!verification || verification.status !== "ACTIVE") {
      notice(`Wylosowano kod roboczy ${code}. Rozpoczęcie weryfikacji przez PPM utworzy nowy kod sesji.`);
      return;
    }
    const participant = findParticipant(state.selected.nick);
    if (!participant || participant.resolved_at) {
      notice("Wybierz aktywnego uczestnika, któremu chcesz przypisać kod.");
      return;
    }
    const map = currentMap();
    state.active = mutateLocalVerification(verification.id, (record, database) => {
      const stored = (record.participants || []).find(item => String(item.id) === String(participant.id));
      if (!stored || stored.resolved_at) throw new Error("PARTICIPANT_NOT_ACTIVE");
      stored.verification_code = code;
      stored.code_updated_at = new Date().toISOString();
      record.verification.updated_at = new Date().toISOString();
      addLocalEvent(database, record, {
        title: `Wylosowano nowy kod dla ${stored.character_name}`,
        eventType: "CODE_GENERATED",
        details: { code, moderator: getCurrentCharacterNick(), characterName: stored.character_name },
        mapId: map.id,
        mapName: map.name,
        participantId: stored.id
      });
    });
    renderActiveSections();
    notice(`Nowy kod gracza ${participant.character_name}: ${code}.`);
  }

  function resolveTemplate(content, additions = {}) {
    const values = { ...panelValues(), ...additions };
    const missing = [];
    const resolved = String(content || "")
      .replace(/\{(nick|moderator|czas|powod|powód|kod|tresc|treść)\}/gi, (_, raw) => {
      const key = raw.toLocaleLowerCase("pl").replace("powód", "powod").replace("treść", "tresc");
      const value = normalize(values[key]);
      if (!value) missing.push(`{${raw}}`);
      return value;
      });
    return { content: resolved, missing: [...new Set(missing)] };
  }

  async function executeModeratorCommand(action) {
    const values = panelValues();
    const needsTarget = ["reminder", "mute", "unmute", "kill", "unkill", "chatadd", "chatdel"].includes(action);
    if (needsTarget && !values.nick) return notice("Najpierw wybierz gracza.");
    let command = "";
    let label = "";
    if (action === "reminder") {
      const reminder = resolveTemplate(values.powod || "{kod}", values);
      if (!reminder.content.trim() || reminder.missing.length) {
        return notice(`Wpisz treść upomnienia lub wylosuj kod${reminder.missing.length ? ` (${reminder.missing.join(", ")})` : ""}.`);
      }
      command = `.reminder "${values.nick}" "${escapeConsole(reminder.content.trim())}"`;
      label = "UPOMNIENIE";
    } else if (action === "mute") {
      if (!values.czas) return notice("Wpisz czas wyciszenia.");
      command = `.mute "${values.nick}" ${values.czas}${values.powod ? ` "${escapeConsole(values.powod)}"` : ""}`;
      label = "WYCISZENIE";
    } else if (action === "unmute") {
      command = `.unmute "${values.nick}"`;
      label = "ZDJĘCIE WYCISZENIA";
    } else if (action === "kill") {
      if (!values.czas) return notice("Wpisz czas kary.");
      command = `.kill "${values.nick}" ${values.czas}${values.powod ? ` "${escapeConsole(values.powod)}"` : ""}`;
      label = "ZABICIE POSTACI";
    } else if (action === "unkill") {
      command = `.unkill "${values.nick}"`;
      label = "ZDJĘCIE ZABICIA";
    } else if (action === "chatlock") {
      command = ".chatlock";
      label = "BLOKADA CZATU";
    } else if (action === "chatunlock") {
      command = ".chatunlock";
      label = "ODBLOKOWANIE CZATU";
    } else if (action === "chatadd") {
      command = `.chatadd "${values.nick}"`;
      label = "DOSTĘP DO CZATU";
    } else if (action === "chatdel") {
      command = `.chatdel "${values.nick}"`;
      label = "ODEBRANIE DOSTĘPU DO CZATU";
    } else if (action === "chatlist") {
      command = ".chatlist";
      label = "LISTA UPRAWNIONYCH";
    } else if (action === "reminderlist") {
      command = ".reminderlist";
      label = "LISTA UPOMNIEŃ";
    } else if (action === "mutedlist") {
      command = ".mutedlist";
      label = "LISTA WYCISZONYCH";
    }
    if (!command) return;
    if (!sendViaGameConsole(command)) return notice("Konsola gry nie jest obecnie dostępna.");
    notice(`Wysłano polecenie: ${label}.`);
    await recordCommand(label, command, "CONSOLE", values.nick);
  }

  function profileAccountId(value) {
    const text = String(value || "").trim();
    const profileMatch = text.match(/profile\/view,(\d{3,12})/i);
    if (profileMatch) return profileMatch[1];
    return /^\d{3,12}$/.test(text) ? text : "";
  }

  async function detectAccountCharacters(id) {
    const target = state.panel?.querySelector("[data-search-results]");
    if (!target) return;
    const world = currentWorldName();
    target.innerHTML = `<p>Pobieranie postaci konta ${escapeMarkup(id)} ze świata ${escapeMarkup(world)}…</p>`;
    try {
      const html = await requestPublicProfile(id);
      state.accountCharacters = excludeCurrentCharacter(parseProfileCharacters(html, world));
      renderAccountCharacters();
      if (!state.accountCharacters.length) {
        target.insertAdjacentHTML(
          "beforeend",
          `<p class="mc-muted">Publiczny profil nie zawiera postaci na świecie ${escapeMarkup(world)}.</p>`
        );
      }
    } catch (error) {
      state.accountCharacters = excludeCurrentCharacter(readVisibleAccountCharacters(id, world));
      renderAccountCharacters();
      target.insertAdjacentHTML(
        "beforeend",
        `<p class="mc-muted">Nie udało się odczytać publicznego profilu (${escapeMarkup(error?.message || "błąd połączenia")}). Pokazano wyłącznie pasujące postacie aktualnie widoczne w kliencie.</p>`
      );
    }
  }

  function requestPublicProfile(accountId) {
    const languageDomain = location.hostname.endsWith(".com") ? "www.margonem.com" : "www.margonem.pl";
    const url = `https://${languageDomain}/profile/view,${encodeURIComponent(accountId)}`;
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest !== "function") {
        reject(new Error("brak uprawnienia GM_xmlhttpRequest"));
        return;
      }
      GM_xmlhttpRequest({
        method: "GET",
        url,
        headers: {
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "pl-PL,pl;q=0.9,en;q=0.7"
        },
        anonymous: false,
        timeout: 15000,
        onload: response => {
          if (response.status < 200 || response.status >= 300) {
            reject(new Error(`HTTP ${response.status || 0}`));
            return;
          }
          if (!String(response.responseText || "").trim()) {
            reject(new Error("pusty profil"));
            return;
          }
          resolve(response.responseText);
        },
        ontimeout: () => reject(new Error("przekroczono czas połączenia")),
        onerror: () => reject(new Error("błąd połączenia z profilem"))
      });
    });
  }

  function parseProfileCharacters(html, requestedWorld) {
    const documentProfile = new DOMParser().parseFromString(String(html || ""), "text/html");
    const requested = normalizeWorldName(requestedWorld);
    const characters = [];
    const characterNodes = [
      ...documentProfile.querySelectorAll(".char-row, .charc, .charcs, [data-character-id], [data-char-id]")
    ];
    for (const node of characterNodes) {
      const value = selector => {
        const elements = [
          ...(node.matches(selector) ? [node] : []),
          ...node.querySelectorAll(selector)
        ];
        const formField = elements.find(element => normalize(element.value || element.getAttribute("value")));
        const element = formField || elements[0];
        return normalize(
          element?.value ||
          element?.getAttribute("value") ||
          element?.textContent
        );
      };
      const world = normalize(
        node.dataset.world ||
        value("input.chworld, .chworld, [name='world'], [data-character-world], [data-char-world], [data-world]")
      );
      if (!world || normalizeWorldName(world) !== requested) continue;
      const name = normalize(
        node.dataset.nick ||
        value("input.chnick, .chnick, .character-name, [name='nick'], [data-character-nick], [data-char-nick], [data-nick]")
      );
      if (!name) continue;
      const character = {
        name,
        id: normalize(
          node.dataset.id ||
          value("input.chid, .chid, [name='char_id'], [name='character_id'], [data-character-id], [data-char-id], [data-id]")
        ) || null,
        level: finiteOrNull(
          node.dataset.lvl ||
          value("input.chlvl, [name='lvl'], [name='level'], [data-character-level], [data-char-level], [data-lvl], .chlvl")
        ),
        world
      };
      const dedupeKey = character.id || character.name.toLocaleLowerCase("pl");
      if (!characters.some(existing => (existing.id || existing.name.toLocaleLowerCase("pl")) === dedupeKey)) {
        characters.push(character);
      }
    }
    return characters.sort((left, right) =>
      Number(right.level || 0) - Number(left.level || 0) ||
      left.name.localeCompare(right.name, "pl")
    );
  }

  function readVisibleAccountCharacters(accountId, world) {
    return excludeCurrentCharacter(readPlayersOnCurrentMap()
      .filter(player => String(player.accountId || "") === String(accountId))
      .map(player => ({
        name: player.nick,
        id: player.id || null,
        level: player.level || null,
        world
      })));
  }

  function excludeCurrentCharacter(characters) {
    const ownNick = getCurrentCharacterNick();
    const ownId = String(getCurrentCharacterId() || "");
    return (characters || []).filter(character => {
      const characterNick = character?.name || character?.nick || "";
      const characterId = String(character?.id || "");
      if (ownNick && sameNick(characterNick, ownNick)) return false;
      if (ownId && characterId && characterId === ownId) return false;
      return true;
    });
  }

  function renderAccountCharacters() {
    const target = state.panel?.querySelector("[data-search-results]");
    if (!target) return;
    const world = currentWorldName();
    state.accountCharacters = excludeCurrentCharacter(state.accountCharacters);
    if (!state.accountCharacters.length) {
      target.innerHTML = `<p>Nie wykryto postaci na świecie ${escapeMarkup(world)}.</p>`;
      return;
    }
    target.innerHTML = state.accountCharacters.map(character => `
      <article class="mc-character">
        <span><strong>${escapeMarkup(character.name)}</strong>${character.level ? `<small>${escapeMarkup(character.level)} lvl</small>` : ""}</span>
        <button type="button" data-select-character="${escapeAttribute(character.name)}" data-character-id="${escapeAttribute(character.id || "")}">Wybierz</button>
      </article>`).join("");
    target.querySelectorAll("[data-select-character]").forEach(button => button.addEventListener("click", () => {
      state.selected = {
        nick: button.dataset.selectCharacter || "",
        id: button.dataset.characterId || resolvePlayerId(button.dataset.selectCharacter) || ""
      };
      renderSelected();
      notice(`Wybrano postać ${state.selected.nick}.`);
    }));
  }

  function readStartConfig() {
    try {
      return { ...DEFAULT_START_CONFIG, ...JSON.parse(localStorage.getItem(START_CONFIG_KEY) || "{}") };
    } catch {
      return { ...DEFAULT_START_CONFIG };
    }
  }

  function readReadyCommands() {
    try {
      const value = JSON.parse(localStorage.getItem(READY_COMMANDS_KEY) || "null");
      if (!Array.isArray(value)) return structuredClone(DEFAULT_READY_COMMANDS);
      const commands = value.filter(command => !LEGACY_READY_COMMAND_IDS.has(command?.id));
      if (commands.length !== value.length) writeReadyCommands(commands);
      return commands;
    } catch {
      return structuredClone(DEFAULT_READY_COMMANDS);
    }
  }

  function writeReadyCommands(commands) {
    localStorage.setItem(READY_COMMANDS_KEY, JSON.stringify(commands));
  }

  function renderReadyCommands() {
    const target = state.panel?.querySelector("[data-ready-list]");
    if (!target) return;
    target.innerHTML = readReadyCommands().map(command => `
      <article class="mc-ready-row">
        <div><strong>${escapeMarkup(command.label)}</strong><small>${command.channel === "LOCAL" ? "CZAT" : "KONSOLA"}</small><code>${escapeMarkup(command.content)}</code></div>
        <span>
          <button data-ready-send="${escapeAttribute(command.id)}">Wyślij</button>
          <button data-ready-edit="${escapeAttribute(command.id)}">Edytuj</button>
          <button class="danger" data-ready-delete="${escapeAttribute(command.id)}">Usuń</button>
        </span>
      </article>`).join("");
    target.querySelectorAll("[data-ready-send]").forEach(button => button.addEventListener("click", () => sendReadyCommand(button.dataset.readySend)));
    target.querySelectorAll("[data-ready-edit]").forEach(button => button.addEventListener("click", () => editReadyCommand(button.dataset.readyEdit)));
    target.querySelectorAll("[data-ready-delete]").forEach(button => button.addEventListener("click", () => {
      writeReadyCommands(readReadyCommands().filter(item => item.id !== button.dataset.readyDelete));
      renderReadyCommands();
    }));
  }

  async function sendReadyCommand(id) {
    const command = readReadyCommands().find(item => item.id === id);
    if (!command) return;
    const resolved = resolveTemplate(command.content);
    if (resolved.missing.length) return notice(`Uzupełnij dane dla: ${resolved.missing.join(", ")}.`);
    const sent = command.channel === "LOCAL"
      ? await sendLocalChatMessage(resolved.content)
      : sendViaGameConsole(resolved.content);
    if (!sent) return notice("Nie udało się wysłać polecenia.");
    notice(`Wysłano polecenie „${command.label}”.`);
    await recordCommand(command.label, resolved.content, command.channel, state.selected.nick);
  }

  function editReadyCommand(id) {
    const command = readReadyCommands().find(item => item.id === id);
    if (!command || !state.panel) return;
    state.panel.querySelector("[data-ready-label]").value = command.label;
    state.panel.querySelector("[data-ready-channel]").value = command.channel;
    state.panel.querySelector("[data-ready-content]").value = command.content;
    state.panel.querySelector("[data-ready-save]").dataset.editId = id;
    state.panel.querySelector("[data-ready-save]").textContent = "Zapisz";
    state.panel.querySelector("[data-ready-cancel]").hidden = false;
  }

  function saveReadyCommand() {
    if (!state.panel) return;
    const label = normalize(state.panel.querySelector("[data-ready-label]").value);
    const content = normalize(state.panel.querySelector("[data-ready-content]").value);
    const channel = state.panel.querySelector("[data-ready-channel]").value === "LOCAL" ? "LOCAL" : "CONSOLE";
    if (!label || !content) return notice("Podaj nazwę oraz treść polecenia.");
    const button = state.panel.querySelector("[data-ready-save]");
    const commands = readReadyCommands();
    const editId = button.dataset.editId;
    if (editId) {
      const index = commands.findIndex(item => item.id === editId);
      if (index >= 0) commands[index] = { ...commands[index], label, channel, content };
    } else {
      commands.push({ id: crypto.randomUUID?.() || `${Date.now()}`, label, channel, content });
    }
    writeReadyCommands(commands);
    resetReadyEditor();
    renderReadyCommands();
  }

  function resetReadyEditor() {
    if (!state.panel) return;
    state.panel.querySelector("[data-ready-label]").value = "";
    state.panel.querySelector("[data-ready-content]").value = "";
    state.panel.querySelector("[data-ready-channel]").value = "CONSOLE";
    const button = state.panel.querySelector("[data-ready-save]");
    delete button.dataset.editId;
    button.textContent = "Dodaj";
    state.panel.querySelector("[data-ready-cancel]").hidden = true;
  }

  async function recordCommand(name, content, channel, targetNick = "") {
    const verification = state.active?.verification;
    if (!verification || verification.status !== "ACTIVE") return;
    const participant = findParticipant(targetNick);
    const map = currentMap();
    state.active = mutateLocalVerification(verification.id, (record, database) => {
      addLocalEvent(database, record, {
        title: `Wysłano polecenie ${name}`,
        eventType: "READY_COMMAND_SENT",
        details: {
          commandName: name,
          content,
          channel,
          targetCharacter: targetNick || null,
          moderator: getCurrentCharacterNick()
        },
        mapId: map.id,
        mapName: map.name,
        participantId: participant?.id || null
      });
    });
    renderActiveSections();
  }

  function findParticipant(nick) {
    const wanted = normalize(nick).toLocaleLowerCase("pl");
    return state.active?.participants?.find(item => normalize(item.character_name).toLocaleLowerCase("pl") === wanted) || null;
  }

  function participantStartedAt(participant, verification = state.active?.verification) {
    return participant?.started_at || participant?.joined_at || verification?.started_at || verification?.created_at;
  }

  function participantCode(participant, verification = state.active?.verification) {
    return normalize(participant?.verification_code)
      || normalize(verification?.verification_code)
      || "—";
  }

  function participantStartMap(participant, verification = state.active?.verification) {
    return participant?.start_map_name || participant?.last_map_name || verification?.start_map_name || "—";
  }

  function participantDuration(participant, verification = state.active?.verification) {
    const startedAt = new Date(participantStartedAt(participant, verification)).getTime();
    const endedAt = participant?.resolved_at ? new Date(participant.resolved_at).getTime() : Date.now();
    return formatDuration(Math.max(0, endedAt - startedAt));
  }

  function renderActiveSections() {
    const details = state.active;
    const isActive = details?.verification?.status === "ACTIVE";
    const status = state.panel?.querySelector("[data-active-state]");
    const summary = state.panel?.querySelector("[data-active-summary]");
    const timeline = state.panel?.querySelector("[data-timeline]");
    if (!details?.verification || details.verification.status !== "ACTIVE") {
      if (status) status.textContent = "BRAK SESJI";
      if (summary) {
        summary.innerHTML = `
          <div class="mc-active-line">
            <span>Brak aktywnej weryfikacji.</span>
            <button type="button" data-open-active disabled>Otwórz panel</button>
          </div>`;
      }
      renderJournal(timeline, localJournalMarkup(state.journal), journalRenderSignature(state.journal));
      closeActivePanel(false);
      return;
    }
    if (status) status.textContent = "AKTYWNA";
    const unresolved = (details.participants || []).filter(item => !item.resolved_at);
    if (summary) {
      summary.innerHTML = `
        <div class="mc-active-summary-list">
          ${unresolved.map(item => `
            <div class="mc-active-line">
              <strong>${escapeMarkup(item.character_name)}</strong>
              <span data-participant-started-at="${escapeAttribute(participantStartedAt(item, details.verification))}">${participantDuration(item, details.verification)}</span>
              <span>kod ${escapeMarkup(participantCode(item, details.verification))}</span>
               <button type="button" data-open-active>${state.activePanel ? "Zamknij panel" : "Otwórz panel"}</button>
            </div>`).join("")}
        </div>`;
      summary.querySelectorAll("[data-open-active]").forEach(button => button.addEventListener("click", toggleActivePanel));
    }
    renderJournal(timeline, localJournalMarkup(state.journal), journalRenderSignature(state.journal));
    if (isActive && state.activePanel) renderActivePanel();
  }

  function syncActivePanelButtonLabel() {
    state.panel?.querySelectorAll("[data-open-active]").forEach(button => {
      button.textContent = state.activePanel ? "Zamknij panel" : "Otwórz panel";
    });
  }

  function toggleActivePanel() {
    if (state.activePanel) closeActivePanel();
    else showActivePanel();
  }

  function showActivePanel() {
    if (state.active?.verification?.status !== "ACTIVE") {
      return notice("Brak aktywnej weryfikacji.");
    }
    if (state.activePanel) {
      renderActivePanel();
      return;
    }
    const overlay = document.createElement("div");
    overlay.id = `${SCRIPT_ID}-active-panel`;
    overlay.innerHTML = `
      <div class="mc-active-window">
        <header class="mc-active-head">
          <div><small>AKTYWNA WERYFIKACJA</small><h3 data-active-panel-title>Sesja</h3></div>
          <button type="button" data-close-active aria-label="Zamknij">×</button>
        </header>
        <div data-active-panel-body></div>
      </div>`;
    document.body.appendChild(overlay);
    state.activePanel = overlay;
    localStorage.setItem(ACTIVE_PANEL_OPEN_KEY, "1");
    const win = overlay.querySelector(".mc-active-window");
    const head = overlay.querySelector(".mc-active-head");
    restorePosition(win, ACTIVE_PANEL_POSITION_KEY);
    makeMovable(win, {
      positionKey: ACTIVE_PANEL_POSITION_KEY,
      lockKey: `${SCRIPT_ID}:never-lock-active-panel`,
      handle: head,
      lockLabel: "Aktywna weryfikacja"
    });
    overlay.querySelector("[data-close-active]").addEventListener("click", () => closeActivePanel());
    renderActivePanel();
    syncActivePanelButtonLabel();
  }

  function closeActivePanel(clearPreference = true) {
    state.activePanel?.remove();
    state.activePanel = null;
    if (clearPreference) localStorage.setItem(ACTIVE_PANEL_OPEN_KEY, "0");
    syncActivePanelButtonLabel();
  }

  function renderActivePanel() {
    const root = state.activePanel;
    const details = state.active;
    if (!root) return;
    if (!details?.verification || details.verification.status !== "ACTIVE") {
      closeActivePanel(false);
      return;
    }
    const verification = details.verification;
    const map = currentMap();
    const onMap = readPlayersOnCurrentMap();
    const participants = details.participants || [];
    const unresolved = participants.filter(item => !item.resolved_at);
    const targetNames = unresolved.map(item => item.character_name).join(", ") || verification.target_character || "—";
    root.querySelector("[data-active-panel-title]").textContent = targetNames;
    root.querySelector("[data-active-panel-body]").innerHTML = `
      <section class="mc-participants">
        <h4>${participants.length > 1 ? "Weryfikacja grupowa" : "Aktywna weryfikacja"}</h4>
        ${participants.map(item => `
          <article class="mc-participant-session ${item.resolved_at ? "resolved" : ""}">
            <div class="mc-session-grid">
              <article><small>WERYFIKOWANY GRACZ</small><strong>${escapeMarkup(item.character_name)}</strong></article>
              <article><small>MAPA STARTOWA</small><strong>${escapeMarkup(participantStartMap(item, verification))}</strong></article>
              <article><small>START</small><strong>${formatDate(participantStartedAt(item, verification))}</strong></article>
              <article><small>KOD</small><strong>${escapeMarkup(participantCode(item, verification))}</strong></article>
              <article>
                <small>${item.resolved_at ? "CZAS SESJI" : "CZAS TRWANIA"}</small>
                <strong${item.resolved_at ? "" : ` data-participant-started-at="${escapeAttribute(participantStartedAt(item, verification))}"`}>${participantDuration(item, verification)}</strong>
              </article>
            </div>
            <div class="mc-participant-actions">
              <span>${item.resolved_at ? "Zakończona" : presenceLabel(item.presence_status)}</span>
              ${item.resolved_at ? "" : `
                <button type="button" data-send-participant-code="${escapeAttribute(item.id)}">Wyślij nowy kod</button>
                <button type="button" data-send-participant-command="sendNick" data-participant-id="${escapeAttribute(item.id)}">Wyślij nick</button>
                <button type="button" data-send-participant-command="sendScreen" data-participant-id="${escapeAttribute(item.id)}">Wyślij screen</button>
                <button type="button" class="danger" data-finish-participant="${escapeAttribute(item.id)}">Zakończ weryfikację</button>`}
            </div>
          </article>`).join("")}
      </section>
      <section class="mc-map-players">
        <h4>Gracze na bieżącej mapie</h4>
        <div>${onMap.filter(player => !findParticipant(player.nick)).map(player =>
          `<button data-add-map-player="${escapeAttribute(player.nick)}" data-player-id="${escapeAttribute(player.id)}">+ ${escapeMarkup(player.nick)}</button>`
        ).join("") || "<small>Brak innych graczy do dodania.</small>"}</div>
      </section>`;
    root.querySelectorAll("[data-add-map-player]").forEach(button => button.addEventListener("click", async () => {
      await addParticipant({ nick: button.dataset.addMapPlayer, id: button.dataset.playerId });
    }));
    root.querySelectorAll("[data-send-participant-code]").forEach(button => button.addEventListener("click", async () => {
      await sendNewVerificationCode(button.dataset.sendParticipantCode);
    }));
    root.querySelectorAll("[data-send-participant-command]").forEach(button => button.addEventListener("click", async () => {
      await sendParticipantConfiguredCommand(button.dataset.participantId, button.dataset.sendParticipantCommand);
    }));
    root.querySelectorAll("[data-finish-participant]").forEach(button => button.addEventListener("click", async () => {
      await finishParticipantVerification(button.dataset.finishParticipant);
    }));
  }

  function timelineMarkup(details) {
    const verification = details.verification;
    const events = details.events || [];
    return `
      <div class="mc-timeline-head">
        <strong>${escapeMarkup((details.participants || []).map(item => item.character_name).join(", "))}</strong>
        <span>${formatDate(verification.started_at)}</span>
        <span data-live-duration>${formatDuration(Date.now() - new Date(verification.started_at).getTime())}</span>
        <b>AKTYWNA</b>
      </div>
      <div class="mc-timeline-events">${events.map(event => `
        <article>
          <div><strong>${escapeMarkup(eventTitle(event))}</strong><time>${formatDate(event.occurred_at)}</time></div>
          ${eventDescription(event) ? `<p>${escapeMarkup(eventDescription(event))}</p>` : ""}
          <small>${escapeMarkup([event.details?.channel, event.map_name].filter(Boolean).join(" · "))}</small>
        </article>`).join("") || "<p>Brak zdarzeń.</p>"}</div>`;
  }

  function localJournalMarkup(entries) {
    if (!entries?.length) return `<p>Dziennik jest pusty.</p>`;
    return `
      <div class="mc-local-journal">
        ${entries.map(details => {
          const verification = details.verification;
          const targets = (details.participants || []).map(item => item.character_name).join(", ")
            || verification.target_character
            || "—";
          const duration = verification.ended_at
            ? formatDuration(new Date(verification.ended_at).getTime() - new Date(verification.started_at).getTime())
            : formatDuration(Date.now() - new Date(verification.started_at).getTime());
          return `
            <details data-journal-id="${escapeAttribute(verification.id)}">
              <summary>
                <strong>#${escapeMarkup(verification.public_number || verification.id)} · ${escapeMarkup(targets)}</strong>
                <span>${escapeMarkup(verification.start_map_name || "—")}</span>
                <span data-journal-duration data-started-at="${escapeAttribute(verification.started_at)}" data-ended-at="${escapeAttribute(verification.ended_at || "")}">${duration}</span>
                <b>${verification.status === "ACTIVE" ? "AKTYWNA" : "ZAKOŃCZONA"}</b>
              </summary>
              <div class="mc-timeline-events" data-journal-events="${escapeAttribute(verification.id)}">${(details.events || []).map(event => `
                <article>
                  <div><strong>${escapeMarkup(eventTitle(event))}</strong><time>${formatDate(event.occurred_at)}</time></div>
                  ${eventDescription(event) ? `<p>${escapeMarkup(eventDescription(event))}</p>` : ""}
                  <small>${escapeMarkup([event.details?.channel, event.map_name].filter(Boolean).join(" · "))}</small>
                </article>`).join("") || "<p>Brak zdarzeń.</p>"}</div>
            </details>`;
        }).join("")}
      </div>`;
  }

  function journalRenderSignature(entries) {
    const list = Array.isArray(entries) ? entries : entries ? [entries] : [];
    return JSON.stringify(list.map(details => ({
      verification: [
        details?.verification?.id,
        details?.verification?.status,
        details?.verification?.updated_at,
        details?.verification?.ended_at
      ],
      participants: (details?.participants || []).map(item => [
        item.id,
        item.character_name,
        item.resolved_at,
        item.verification_code,
        item.presence_status
      ]),
      events: (details?.events || []).map(event => [
        event.id,
        event.event_type,
        event.occurred_at,
        event.title,
        event.details?.content,
        event.details?.code
      ])
    })));
  }

  function renderJournal(target, markup, signature) {
    if (!target || target.dataset.renderSignature === signature) return;
    const scrollContainer = target.closest(".mc-window, .mc-active-window");
    const outerScrollTop = scrollContainer?.scrollTop || 0;
    const openIds = new Set(
      [...target.querySelectorAll("details[data-journal-id][open]")]
        .map(element => element.dataset.journalId)
    );
    const innerScroll = new Map(
      [...target.querySelectorAll("[data-journal-events]")]
        .map(element => [element.dataset.journalEvents, element.scrollTop])
    );
    target.innerHTML = markup;
    target.dataset.renderSignature = signature;
    target.querySelectorAll("details[data-journal-id]").forEach(element => {
      element.open = openIds.has(element.dataset.journalId);
    });
    target.querySelectorAll("[data-journal-events]").forEach(element => {
      element.scrollTop = innerScroll.get(element.dataset.journalEvents) || 0;
    });
    if (scrollContainer) scrollContainer.scrollTop = outerScrollTop;
  }

  function eventTitle(event) {
    if (event.event_type === "READY_COMMAND_SENT") return event.title || `Wysłano polecenie ${event.details?.commandName || ""}`;
    if (event.event_type === "PARTICIPANT_FINISHED") return `Zakończono weryfikację gracza ${event.details?.characterName || ""}`;
    return event.title || event.event_type;
  }

  function eventDescription(event) {
    const details = event.details || {};
    if (details.content) return `${details.commandName ? `${details.commandName}: ` : ""}${details.content}`;
    if (event.event_type === "CODE_GENERATED" && details.code) return `Kod: ${details.code}`;
    return "";
  }

  function updateLiveTime() {
    const startedAt = state.active?.verification?.started_at;
    const value = startedAt
      ? formatDuration(Date.now() - new Date(startedAt).getTime())
      : "";
    [state.panel, state.activePanel].filter(Boolean).forEach(root => {
      if (value) {
        root.querySelectorAll("[data-live-duration]").forEach(element => { element.textContent = value; });
      }
      root.querySelectorAll("[data-participant-started-at]").forEach(element => {
        const startedAt = new Date(element.dataset.participantStartedAt || "").getTime();
        if (Number.isFinite(startedAt)) element.textContent = formatDuration(Date.now() - startedAt);
      });
      root.querySelectorAll("[data-journal-duration]").forEach(element => {
        const journalStartedAt = new Date(element.dataset.startedAt || "").getTime();
        const journalEndedAt = new Date(element.dataset.endedAt || "").getTime();
        if (!Number.isFinite(journalStartedAt)) return;
        element.textContent = formatDuration(
          Math.max(0, (Number.isFinite(journalEndedAt) ? journalEndedAt : Date.now()) - journalStartedAt)
        );
      });
    });
  }

  async function startVerification(player) {
    const nick = normalize(player?.nick);
    const moderator = getCurrentCharacterNick();
    if (!nick) return notice("Nie udało się rozpoznać wskazanego gracza.");
    if (!moderator) return notice("Klient gry nie udostępnił danych aktualnej postaci.");
    if (state.active?.verification?.status === "ACTIVE") return addParticipant(player);
    const code = generateCode();
    if (state.panel) state.panel.querySelector("[data-code]").value = code;
    const map = currentMap();
    const config = readStartConfig();
    const values = { nick, moderator, kod: code, czas: "", powod: "", tresc: "" };
    const local = resolveTemplate(config.local, values);
    const consoleCommand = resolveTemplate(config.console, values);
    if (local.missing.length || consoleCommand.missing.length) {
      return notice(`Treść rozpoczęcia wymaga danych: ${[...new Set([...local.missing, ...consoleCommand.missing])].join(", ")}.`);
    }
    const localResult = await sendLocalChatMessage(local.content);
    if (!localResult) return notice("Nie udało się wysłać obowiązkowej informacji na czat lokalny. Sesja nie została utworzona.");
    try {
      state.active = createLocalVerification({
        world: currentWorldName(),
        verifierCharacter: moderator,
        targetCharacter: nick,
        targetCharacterId: player.id || resolvePlayerId(nick),
        startMapId: map.id,
        startMapName: map.name,
        source: "OWN_INITIATIVE",
        code,
        x: player.x,
        y: player.y
      });
      await recordCommand("ROZPOCZĘCIE — CZAT LOKALNY", local.content, "LOCAL", nick);
      if (sendViaGameConsole(consoleCommand.content)) {
        await recordCommand("ROZPOCZĘCIE — UPOMNIENIE", consoleCommand.content, "CONSOLE", nick);
      }
      state.selected = { nick, id: player.id || resolvePlayerId(nick) || "" };
      // Po utworzeniu sesji pozostawiamy na ekranie wyłącznie kompaktowe
      // okno aktywnej weryfikacji. Centrum można ponownie otworzyć widżetem.
      closePanel();
      localStorage.setItem(ACTIVE_PANEL_OPEN_KEY, "1");
      showActivePanel();
      notice(`Rozpoczęto weryfikację gracza ${nick}. Kod: ${code}.`);
    } catch (error) {
      if (error.message === "ACTIVE_VERIFICATION_EXISTS") {
        state.active = getLocalActiveVerification();
        return addParticipant(player);
      }
      notice(`Nie udało się utworzyć sesji (${error.message}).`);
    }
  }

  async function addParticipant(player) {
    const verification = state.active?.verification;
    const nick = normalize(player?.nick);
    if (!verification || verification.status !== "ACTIVE") return notice("Nie ma aktywnej weryfikacji.");
    if (!nick) return notice("Nie udało się rozpoznać gracza.");
    if ((state.active?.participants || []).some(item => !item.resolved_at && sameNick(item.character_name, nick))) {
      return notice("Ten gracz jest już w aktywnej weryfikacji.");
    }
    const map = currentMap();
    const onMap = readPlayersOnCurrentMap().find(item => sameNick(item.nick, nick));
    const moderator = getCurrentCharacterNick();
    const code = generateCode();
    const config = readStartConfig();
    const values = { nick, moderator, kod: code, czas: "", powod: "", tresc: "" };
    const local = resolveTemplate(config.local, values);
    const consoleCommand = resolveTemplate(config.console, values);
    if (local.missing.length || consoleCommand.missing.length) {
      return notice(`Treść rozpoczęcia wymaga danych: ${[...new Set([...local.missing, ...consoleCommand.missing])].join(", ")}.`);
    }
    const localResult = await sendLocalChatMessage(local.content);
    if (!localResult) {
      return notice("Nie udało się wysłać obowiązkowej informacji na czat lokalny. Gracz nie został dodany.");
    }
    try {
      state.active = mutateLocalVerification(verification.id, (record, database) => {
        if ((record.participants || []).some(item => !item.resolved_at && sameNick(item.character_name, nick))) {
          throw new Error("PARTICIPANT_ALREADY_ADDED");
        }
        const joinedAt = new Date().toISOString();
        const participant = {
          id: String(database.nextParticipantId++),
          character_name: nick,
          character_id: player.id || onMap?.id || resolvePlayerId(nick) || null,
          joined_at: joinedAt,
          started_at: joinedAt,
          verification_code: code,
          start_map_id: map.id,
          start_map_name: map.name,
          resolved_at: null,
          presence_status: onMap ? "PRESENT" : "MISSING",
          last_map_id: map.id,
          last_map_name: map.name,
          last_x: onMap?.x ?? null,
          last_y: onMap?.y ?? null
        };
        record.participants.push(participant);
        addLocalEvent(database, record, {
          title: `Dodano gracza ${nick} do aktywnej weryfikacji`,
          eventType: "PARTICIPANT_ADDED",
          details: { characterName: nick, moderator, code },
          mapId: map.id,
          mapName: map.name,
          participantId: participant.id
        });
      });
      await recordCommand("DOŁĄCZENIE DO WERYFIKACJI — CZAT LOKALNY", local.content, "LOCAL", nick);
      if (sendViaGameConsole(consoleCommand.content)) {
        await recordCommand("DOŁĄCZENIE DO WERYFIKACJI — UPOMNIENIE", consoleCommand.content, "CONSOLE", nick);
      } else {
        notice(`Dodano ${nick}, ale klient nie udostępnił konsoli do wysłania .reminder.`);
      }
      state.selected = { nick, id: player.id || onMap?.id || "" };
      renderSelected();
      renderActiveSections();
      notice(`Dodano ${nick} do aktywnej weryfikacji. Kod gracza: ${code}.`);
    } catch (error) {
      const label = error.message === "PARTICIPANT_ALREADY_ADDED" ? "Ten gracz jest już w aktywnej weryfikacji." : error.message;
      notice(`Nie udało się dodać gracza (${label}).`);
    }
  }

  async function sendNewVerificationCode(participantId) {
    const verification = state.active?.verification;
    if (!verification || verification.status !== "ACTIVE") return notice("Brak aktywnej weryfikacji.");
    const participant = (state.active.participants || []).find(item =>
      String(item.id) === String(participantId) && !item.resolved_at
    );
    if (!participant) return notice("Ten uczestnik nie ma aktywnej weryfikacji.");
    const code = generateCode();
    const map = currentMap();
    try {
      state.active = mutateLocalVerification(verification.id, (record, database) => {
        const stored = (record.participants || []).find(item =>
          String(item.id) === String(participantId) && !item.resolved_at
        );
        if (!stored) throw new Error("PARTICIPANT_NOT_ACTIVE");
        stored.verification_code = code;
        stored.code_updated_at = new Date().toISOString();
        record.verification.updated_at = new Date().toISOString();
        addLocalEvent(database, record, {
          title: `Wylosowano nowy kod dla ${stored.character_name}`,
          eventType: "CODE_GENERATED",
          details: { code, moderator: getCurrentCharacterNick(), characterName: stored.character_name },
          mapId: map.id,
          mapName: map.name,
          participantId: stored.id
        });
      });
      const commandTemplate = readStartConfig().sendCode || DEFAULT_START_CONFIG.sendCode;
      const resolvedCommand = resolveTemplate(commandTemplate, {
        nick: participant.character_name,
        moderator: getCurrentCharacterNick(),
        kod: code,
        czas: "",
        powod: "",
        tresc: ""
      });
      if (!resolvedCommand.content.trim() || resolvedCommand.missing.length) {
        throw new Error(`Polecenie „Wyślij kod” wymaga danych: ${resolvedCommand.missing.join(", ") || "treść polecenia"}`);
      }
      const command = resolvedCommand.content.trim();
      const sent = sendViaGameConsole(command);
      if (sent) await recordCommand("NOWY KOD WERYFIKACYJNY", command, "CONSOLE", participant.character_name);
      renderActiveSections();
      notice(sent
        ? `Wysłano nowy kod ${code} graczowi ${participant.character_name}.`
        : `Wylosowano kod ${code}, ale klient nie udostępnił konsoli do wysłania .reminder.`);
    } catch (error) {
      notice(`Nie udało się wysłać nowego kodu (${error.message}).`);
    }
  }

  async function sendParticipantConfiguredCommand(participantId, commandKey) {
    const verification = state.active?.verification;
    if (!verification || verification.status !== "ACTIVE") return notice("Brak aktywnej weryfikacji.");
    const participant = (state.active.participants || []).find(item =>
      String(item.id) === String(participantId) && !item.resolved_at
    );
    if (!participant) return notice("Ten uczestnik nie ma aktywnej weryfikacji.");
    const definitions = {
      sendNick: { label: "WYŚLIJ NICK", fallback: DEFAULT_START_CONFIG.sendNick },
      sendScreen: { label: "WYŚLIJ SCREEN", fallback: DEFAULT_START_CONFIG.sendScreen }
    };
    const definition = definitions[commandKey];
    if (!definition) return notice("Nieznany typ polecenia.");
    const template = readStartConfig()[commandKey] || definition.fallback;
    const resolved = resolveTemplate(template, {
      nick: participant.character_name,
      moderator: getCurrentCharacterNick(),
      kod: participantCode(participant, verification),
      czas: "",
      powod: "",
      tresc: ""
    });
    if (!resolved.content.trim() || resolved.missing.length) {
      return notice(`Polecenie „${definition.label}” wymaga danych: ${resolved.missing.join(", ") || "treść polecenia"}.`);
    }
    const command = resolved.content.trim();
    if (!sendViaGameConsole(command)) {
      return notice("Klient nie udostępnił konsoli do wysłania polecenia.");
    }
    await recordCommand(definition.label, command, "CONSOLE", participant.character_name);
    notice(`Wysłano polecenie „${definition.label}” graczowi ${participant.character_name}.`);
  }

  async function finishParticipantVerification(participantId) {
    const verification = state.active?.verification;
    if (!verification || verification.status !== "ACTIVE") return notice("Brak aktywnej weryfikacji.");
    const participant = (state.active.participants || []).find(item =>
      String(item.id) === String(participantId) && !item.resolved_at
    );
    if (!participant) return notice("Ten uczestnik nie ma aktywnej weryfikacji.");
    if (!confirm(`Zakończyć weryfikację gracza ${participant.character_name}?`)) return;
    const finishTemplate = readStartConfig().finish || DEFAULT_START_CONFIG.finish;
    const localMessage = resolveTemplate(finishTemplate, {
      nick: participant.character_name,
      moderator: getCurrentCharacterNick(),
    }).content.trim() || `Weryfikacja gracza ${participant.character_name} została zakończona.`;
    const map = currentMap();
    try {
      let finishedAll = false;
      state.active = mutateLocalVerification(verification.id, (record, database) => {
        const endedAt = new Date().toISOString();
        const stored = (record.participants || []).find(item =>
          String(item.id) === String(participantId) && !item.resolved_at
        );
        if (!stored) throw new Error("PARTICIPANT_NOT_ACTIVE");
        stored.resolved_at = endedAt;
        stored.presence_status = "RESOLVED";
        addLocalEvent(database, record, {
          title: `Zakończono weryfikację gracza ${stored.character_name}`,
          eventType: "PARTICIPANT_FINISHED",
          details: {
            characterName: stored.character_name,
            announcement: localMessage,
            moderator: getCurrentCharacterNick()
          },
          mapId: map.id,
          mapName: map.name,
          participantId: stored.id
        });
        finishedAll = !(record.participants || []).some(item => !item.resolved_at);
        if (finishedAll) {
          record.verification.status = "COMPLETED";
          record.verification.ended_at = endedAt;
          addLocalEvent(database, record, {
            title: "Zakończono całą weryfikację",
            eventType: "VERIFICATION_FINISHED",
            details: { moderator: getCurrentCharacterNick() },
            mapId: map.id,
            mapName: map.name
          });
        }
        record.verification.updated_at = endedAt;
      });
      const announced = await sendLocalChatMessage(localMessage);
      if (finishedAll) {
        closeActivePanel();
        refreshActive();
      } else {
        renderActivePanel();
        renderActiveSections();
      }
      notice(announced
        ? `Weryfikacja gracza ${participant.character_name} została zakończona.`
        : `Zakończono weryfikację gracza ${participant.character_name}, ale nie udało się wysłać komunikatu na czat lokalny.`);
    } catch (error) {
      notice(`Nie udało się zakończyć weryfikacji (${error.message}).`);
    }
  }

  function synchronizePresence() {
    const details = state.active;
    if (!details?.verification || details.verification.status !== "ACTIVE") return;
    const map = currentMap();
    const players = readPlayersOnCurrentMap();
    const updates = [];
    for (const participant of details.participants || []) {
      if (participant.resolved_at) continue;
      const found = players.find(player => sameNick(player.nick, participant.character_name));
      const status = found ? "PRESENT" : "MISSING";
      if (state.presence.get(participant.id) === status) continue;
      state.presence.set(participant.id, status);
      updates.push({ participantId: participant.id, status, found });
    }
    if (!updates.length) return;
    state.active = mutateLocalVerification(details.verification.id, record => {
      for (const update of updates) {
        const participant = (record.participants || []).find(item => String(item.id) === String(update.participantId));
        if (!participant) continue;
        participant.presence_status = update.status;
        participant.last_map_id = map.id;
        participant.last_map_name = map.name;
        participant.last_x = update.found?.x ?? null;
        participant.last_y = update.found?.y ?? null;
        participant.presence_updated_at = new Date().toISOString();
      }
    });
    if (state.activePanel) {
      renderActivePanel();
    }
  }

  function scheduleMenuScan() {
    clearTimeout(state.scanTimer);
    state.scanTimer = setTimeout(scanMenus, 60);
  }

  function scanMenus() {
    for (const attack of exactTextElements("Atakuj")) {
      const menu = findMenu(attack);
      if (menu) enhanceMenu(menu, attack);
    }
    for (const profile of exactTextElements("Pokaż profil")) {
      const menu = findOwnCharacterMenu(profile);
      if (menu) enhanceOwnCharacterMenu(menu, profile);
    }
  }

  function resetEnhancedMenus() {
    document.querySelectorAll("[data-mc-menu-enhanced='1'],[data-mc-self-menu-enhanced='1']").forEach(menu => {
      menu.querySelectorAll("[data-mc-action]").forEach(item => item.remove());
      delete menu.dataset.mcMenuEnhanced;
      delete menu.dataset.mcSelfMenuEnhanced;
    });
  }

  function enhanceMenu(menu, styleSource) {
    if (menu.dataset.mcMenuEnhanced === "1") return;
    menu.dataset.mcMenuEnhanced = "1";
    const player = readPlayer(menu);
    if (!player.nick) return;
    const hasActiveVerification = state.active?.verification?.status === "ACTIVE";
    const item = styleSource.cloneNode(false);
    item.removeAttribute("id");
    item.dataset.mcAction = hasActiveVerification ? "add" : "start";
    item.textContent = hasActiveVerification ? "Dodaj do aktywnej weryfikacji" : "Rozpocznij weryfikację";
    item.setAttribute("role", "button");
    item.setAttribute("tabindex", "0");
    item.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      hasActiveVerification ? addParticipant(player) : startVerification(player);
    });
    item.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") item.click();
    });
    menu.appendChild(item);
  }

  function enhanceOwnCharacterMenu(menu, styleSource) {
    if (menu.dataset.mcSelfMenuEnhanced === "1") return;
    menu.dataset.mcSelfMenuEnhanced = "1";
    const player = {
      nick: getCurrentCharacterNick(),
      id: getCurrentCharacterId()
    };
    if (!player.nick) return;
    const hasActiveVerification = state.active?.verification?.status === "ACTIVE";
    const item = styleSource.cloneNode(false);
    item.removeAttribute("id");
    item.dataset.mcAction = hasActiveVerification ? "add-test" : "start-test";
    item.textContent = hasActiveVerification
      ? "Dodaj do aktywnej weryfikacji (test)"
      : "Rozpocznij weryfikację (test)";
    item.setAttribute("role", "button");
    item.setAttribute("tabindex", "0");
    item.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      hasActiveVerification ? addParticipant(player) : startVerification(player);
    });
    item.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") item.click();
    });
    menu.appendChild(item);
  }

  function readPlayer(menu) {
    const attributes = readContextAttributes(state.lastContextTarget);
    return {
      nick: attributes.nick || readMenuHeader(menu),
      id: attributes.id || null
    };
  }

  function readMenuHeader(menu) {
    let element = menu;
    for (let depth = 0; element && depth < 6; depth++, element = element.parentElement) {
      const lines = String(element.innerText || "").split(/\r?\n/).map(normalize).filter(Boolean);
      const firstAction = lines.findIndex(line => STANDARD_ACTIONS.has(line));
      if (firstAction > 0) {
        const possible = lines.slice(0, firstAction).filter(line =>
          line.length <= 80 && !STANDARD_ACTIONS.has(line) && !/^(lokalny|globalny|klanowy|handlowy)$/i.test(line)
        );
        if (possible.length) return possible.join(" ");
      }
    }
    return "";
  }

  function readContextAttributes(target) {
    let nick = "";
    let id = "";
    for (let element = target, depth = 0; element && depth < 8; element = element.parentElement, depth++) {
      for (const attribute of element.attributes || []) {
        if (!/^(data-|id$|name$|title$)/i.test(attribute.name) || attribute.value.length > 180) continue;
        if (!id && /^(data-)?(player|hero|char|user)[-_]?id$/i.test(attribute.name) && /^\d{1,12}$/.test(attribute.value)) id = attribute.value;
        if (!nick && /(^|[-_])(nick|nickname|player[-_]?name)$/i.test(attribute.name)) nick = attribute.value;
      }
    }
    return { nick, id };
  }

  function exactTextElements(text) {
    return [...document.querySelectorAll("button,[role='button'],li,a,div,span")]
      .filter(element => normalize(element.textContent) === text && isVisible(element));
  }

  function findMenu(start) {
    for (let element = start.parentElement, depth = 0; element && depth < 8; element = element.parentElement, depth++) {
      const text = normalize(element.innerText);
      const rect = element.getBoundingClientRect();
      if (REQUIRED_ACTIONS.every(label => text.includes(label)) && rect.width >= 90 && rect.width <= 440 && rect.height <= 900) return element;
    }
    return null;
  }

  function findOwnCharacterMenu(start) {
    for (let element = start.parentElement, depth = 0; element && depth < 8; element = element.parentElement, depth++) {
      const text = normalize(element.innerText);
      const rect = element.getBoundingClientRect();
      if (
        text.includes("Zmień strój") &&
        text.includes("Pokaż profil") &&
        !text.includes("Atakuj") &&
        rect.width >= 90 &&
        rect.width <= 440 &&
        rect.height <= 900
      ) return element;
    }
    return null;
  }

  function currentMap() {
    const engine = getEngine();
    const page = getPageWindow();
    const map = engine?.map;
    const name = normalize(
      (typeof map?.getName === "function" ? map.getName() : "") ||
      map?.d?.name || map?.name || page.map?.name || page.g?.map?.name
    ) || "Nieznana mapa";
    const id = String(
      (typeof map?.getId === "function" ? map.getId() : "") ||
      map?.d?.id || map?.id || page.map?.id || page.g?.map?.id || ""
    );
    return { id: id || null, name };
  }

  function currentWorldName() {
    const engine = getEngine();
    return normalize(
      (typeof engine?.worldConfig?.getWorldName === "function" ? engine.worldConfig.getWorldName() : "") ||
      engine?.worldConfig?.worldName ||
      location.hostname.split(".")[0] ||
      "nieznany"
    ).replace(/^#/, "") || "nieznany";
  }

  function normalizeWorldName(value) {
    return normalize(value).replace(/^#/, "").toLocaleLowerCase("pl");
  }

  function readPlayersOnCurrentMap() {
    const engine = getEngine();
    const collection = typeof engine?.others?.check === "function" ? engine.others.check() : engine?.others;
    if (!collection || typeof collection !== "object") return [];
    const players = [];
    for (const [key, other] of Object.entries(collection)) {
      if (!other || typeof other !== "object") continue;
      const data = other.d || other;
      const nick = normalize(data.nick || (typeof other.getNick === "function" ? other.getNick() : ""));
      if (!nick) continue;
      players.push({
        nick,
        id: String(data.id ?? (typeof other.getId === "function" ? other.getId() : key) ?? ""),
        accountId: readAccountId(data, other),
        level: finiteOrNull(data.lvl ?? data.level ?? (typeof other.getLvl === "function" ? other.getLvl() : null)),
        x: finiteOrNull(data.x),
        y: finiteOrNull(data.y)
      });
    }
    return players;
  }

  function resolvePlayerId(nick) {
    const player = readPlayersOnCurrentMap().find(item => sameNick(item.nick, nick));
    return player?.id || null;
  }

  function readAccountId(data, source = null) {
    const candidates = [
      data?.account_id,
      data?.accountId,
      data?.profile_id,
      data?.profileId,
      data?.aid,
      data?.account,
      source?.account_id,
      source?.accountId,
      source?.profile_id,
      source?.profileId
    ];
    const value = candidates.find(candidate => /^\d{3,12}$/.test(String(candidate ?? "")));
    return value == null ? null : String(value);
  }

  function readCurrentCharacter() {
    const engine = getEngine();
    const page = getPageWindow();
    const hero = engine?.hero;
    const data = hero?.d || hero || page.hero?.d || page.hero || page.g?.hero || {};
    return {
      nick: getCurrentCharacterNick(),
      id: getCurrentCharacterId(),
      accountId: readAccountId(data, hero),
      level: finiteOrNull(data.lvl ?? data.level ?? (typeof hero?.getLvl === "function" ? hero.getLvl() : null))
    };
  }

  function getCurrentCharacterNick() {
    const engine = getEngine();
    const page = getPageWindow();
    return normalize(
      (typeof engine?.hero?.getNick === "function" ? engine.hero.getNick() : "") ||
      engine?.hero?.d?.nick || engine?.hero?.nick ||
      page.hero?.d?.nick || page.hero?.nick || page.g?.hero?.nick
    );
  }

  function getCurrentCharacterId() {
    const engine = getEngine();
    const page = getPageWindow();
    return String(
      (typeof engine?.hero?.getId === "function" ? engine.hero.getId() : "") ||
      engine?.hero?.d?.id || engine?.hero?.id ||
      page.hero?.d?.id || page.hero?.id || page.g?.hero?.id || ""
    ) || null;
  }

  function getPageWindow() {
    return typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
  }

  function getEngine() {
    const page = getPageWindow();
    return page.Engine || (typeof page.getEngine === "function" ? page.getEngine() : null);
  }

  function getModeratorRankLabel() {
    const rights = Number(getEngine()?.hero?.d?.uprawnienia || 0);
    if (rights === 4 || rights === 16) return "Super Moderator";
    if (rights !== 0) return "Moderator Czatu";
    return "Brak rangi";
  }

  function sendViaGameConsole(command) {
    try {
      const engine = getEngine();
      const sender = engine?.console?.commandLine?.sendMessage;
      if (typeof sender !== "function") return false;
      sender.call(engine.console.commandLine, command);
      return true;
    } catch (error) {
      console.warn("[Centrum Moderacji] Konsola gry:", error);
      return false;
    }
  }

  async function sendLocalChatMessage(message) {
    try {
      const engine = getEngine();
      const wrapper = engine?.chatController?.getChatInputWrapper?.();
      const availability = engine?.chatController?.getChatChannelsAvailable?.();
      if (typeof wrapper?.sendMessageGhostMessageProcedure === "function") {
        if (typeof availability?.checkAvailableProcedure === "function" && !availability.checkAvailableProcedure("LOCAL")) {
          notice("Kanał lokalny nie jest obecnie dostępny.");
          return false;
        }
        wrapper.sendMessageGhostMessageProcedure(message, "LOCAL");
        return true;
      }
    } catch (error) {
      console.warn("[Centrum Moderacji] Czat klienta:", error);
    }
    const input = findChatInput();
    if (!input) return false;
    selectLocalChannel(input);
    setInputValue(input, message);
    input.focus();
    for (const type of ["keydown", "keypress", "keyup"]) {
      input.dispatchEvent(new KeyboardEvent(type, {
        key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true
      }));
    }
    await new Promise(resolve => setTimeout(resolve, 180));
    return normalize(readInputValue(input)) !== normalize(message);
  }

  function findChatInput() {
    return [...document.querySelectorAll("input,textarea,[contenteditable='true']")]
      .filter(isVisible)
      .map(element => {
        const hint = normalize([
          element.getAttribute("placeholder"), element.getAttribute("aria-label"),
          element.getAttribute("data-placeholder"), element.className
        ].join(" ")).toLocaleLowerCase("pl");
        return { element, score: (hint.includes("porozmawia") ? 10 : 0) + (hint.includes("chat") ? 6 : 0) + (hint.includes("wiadomo") ? 4 : 0) };
      })
      .sort((a, b) => b.score - a.score)[0]?.element || null;
  }

  function selectLocalChannel(input) {
    const rect = input.getBoundingClientRect();
    const buttons = [...document.querySelectorAll("button,[role='button'],div,span")]
      .filter(element => normalize(element.textContent) === "Lokalny" && isVisible(element))
      .sort((a, b) => elementDistance(a.getBoundingClientRect(), rect) - elementDistance(b.getBoundingClientRect(), rect));
    buttons[0]?.click();
  }

  function setInputValue(element, value) {
    if (element.isContentEditable) element.textContent = value;
    else {
      const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
      setter ? setter.call(element, value) : (element.value = value);
    }
    element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function readInputValue(element) {
    return element.isContentEditable ? element.textContent : element.value;
  }

  function addStyles() {
    if (document.getElementById(`${SCRIPT_ID}-styles`)) return;
    const style = document.createElement("style");
    style.id = `${SCRIPT_ID}-styles`;
    style.textContent = `
      #${SCRIPT_ID}-launcher{position:fixed;right:14px;top:50%;z-index:2147483000;width:43px;height:43px;padding:0;border:2px solid #8b753b;border-radius:7px;background:linear-gradient(#3e4e29,#1e2815);box-shadow:0 4px 16px #000c;color:#f1d778;font:bold 24px/39px Georgia,serif;cursor:pointer}
      #${SCRIPT_ID}-launcher:hover{border-color:#d0b45f;background:linear-gradient(#526a33,#28391b)}
      #${SCRIPT_ID}-launcher[data-locked="0"]{cursor:grab}#${SCRIPT_ID}-launcher i{position:absolute;right:-6px;bottom:-6px;width:18px;height:18px;border:1px solid #806a3d;border-radius:50%;background:#171713;font:10px/17px Arial}
      #${SCRIPT_ID}-panel{position:fixed;inset:0;z-index:2147482999;pointer-events:none;color:#e8dfbf;font:12px Arial,sans-serif}
      #${SCRIPT_ID}-panel *{box-sizing:border-box}#${SCRIPT_ID}-panel .mc-window{position:absolute;right:70px;top:45px;width:min(455px,calc(100vw - 24px));height:auto;max-height:none;overflow:visible;padding:10px;border:1px solid #66562c;border-radius:5px;background:rgba(28,26,21,.97);box-shadow:0 14px 42px #000c;pointer-events:auto}
      #${SCRIPT_ID}-panel .mc-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;padding-bottom:9px;border-bottom:1px solid #5a4a27;cursor:move;user-select:none;touch-action:none}
      #${SCRIPT_ID}-panel .mc-head-actions{display:flex;align-items:center;gap:7px}
      #${SCRIPT_ID}-panel .mc-rank{padding:5px 8px;border:1px solid #31516a;border-radius:8px;background:#101e2b;color:#67d8dc;font-size:11px;font-weight:700;white-space:nowrap}
      #${SCRIPT_ID}-panel .mc-head small{color:#d8b94e;font-weight:bold;letter-spacing:.1em}#${SCRIPT_ID}-panel h2{margin:3px 0 0;color:#f0d372;font:700 20px Georgia,serif}
      #${SCRIPT_ID}-panel button,#${SCRIPT_ID}-panel input,#${SCRIPT_ID}-panel textarea,#${SCRIPT_ID}-panel select{font:inherit}#${SCRIPT_ID}-panel button{padding:7px 10px;border:1px solid #6f5c2d;border-radius:3px;background:#33471d;color:#f0e7c7;font-weight:bold;cursor:pointer}
      #${SCRIPT_ID}-panel button:hover{background:#465f27;border-color:#9b8140}#${SCRIPT_ID}-panel button.danger{border-color:#793f3f;background:#4a2426;color:#ffb2ad}#${SCRIPT_ID}-panel .mc-head button{border:0;background:none;font-size:18px}
      #${SCRIPT_ID}-panel input,#${SCRIPT_ID}-panel textarea,#${SCRIPT_ID}-panel select{width:100%;padding:8px;border:1px solid #5d512e;border-radius:2px;background:#11120f;color:#eee2b8;outline:none}#${SCRIPT_ID}-panel textarea{min-height:55px;resize:vertical}
      #${SCRIPT_ID}-panel input:focus,#${SCRIPT_ID}-panel textarea:focus,#${SCRIPT_ID}-panel select:focus{border-color:#b79b4d}
      #${SCRIPT_ID}-panel .mc-selected{margin:9px 0;color:#c0b596}#${SCRIPT_ID}-panel .mc-search{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:6px}#${SCRIPT_ID}-panel .mc-note{padding:7px;border-left:3px solid #c6a641;background:#151610;color:#9e967e}
      #${SCRIPT_ID}-panel .mc-command-fields{display:grid;grid-template-columns:76px 76px auto minmax(0,1fr);gap:6px;align-items:end;margin:8px 0}#${SCRIPT_ID}-panel label{display:grid;gap:4px;color:#d4c68e}#${SCRIPT_ID}-panel label.wide{min-width:0}
      #${SCRIPT_ID}-panel .mc-command-tabs{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:9px}#${SCRIPT_ID}-panel .mc-command-tabs button{text-align:left}#${SCRIPT_ID}-panel .mc-command-tabs button.active{border-color:#61cbd0;background:#1d3850;color:#68ded9}#${SCRIPT_ID}-panel .mc-command-panes [data-command-section][hidden]{display:none!important}#${SCRIPT_ID}-panel .mc-command-panes .mc-box{margin-top:7px}#${SCRIPT_ID}-panel .mc-box,#${SCRIPT_ID}-panel .mc-block{margin-top:9px;padding:9px;border:1px solid #554825;border-radius:3px;background:#1d1b16}
      #${SCRIPT_ID}-panel h3,#${SCRIPT_ID}-panel h4{margin:0 0 8px;color:#e4c85f}#${SCRIPT_ID}-panel .mc-actions{display:grid;grid-template-columns:1fr 1fr;gap:6px}#${SCRIPT_ID}-panel .mc-actions button{text-align:left}
      #${SCRIPT_ID}-panel summary{display:flex;justify-content:space-between;gap:10px;color:#e6cc67;font-weight:bold;cursor:pointer;list-style:none}#${SCRIPT_ID}-panel summary b{color:#938a70;font-size:10px}#${SCRIPT_ID}-panel summary::-webkit-details-marker{display:none}
      #${SCRIPT_ID}-panel .mc-search-results{display:grid;margin-top:6px;border:1px solid #4c4023}#${SCRIPT_ID}-panel .mc-search-results:empty{display:none}#${SCRIPT_ID}-panel .mc-character{display:flex;justify-content:space-between;align-items:center;gap:7px;padding:7px;border-bottom:1px solid #4c4023}#${SCRIPT_ID}-panel .mc-character>span{display:grid;gap:2px;min-width:0}
      #${SCRIPT_ID}-panel .mc-ready-editor{display:grid;grid-template-columns:minmax(0,1fr) 92px auto auto;gap:6px;margin:8px 0}#${SCRIPT_ID}-panel .mc-ready-editor textarea{grid-column:1/-1;min-height:37px}#${SCRIPT_ID}-panel .mc-ready-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;padding:8px;border-top:1px solid #4c4023}
      #${SCRIPT_ID}-panel .mc-ready-row div{display:grid;grid-template-columns:auto auto;gap:4px 8px}#${SCRIPT_ID}-panel .mc-ready-row code{grid-column:1/-1;overflow:hidden;color:#bfcf81;text-overflow:ellipsis;white-space:nowrap}#${SCRIPT_ID}-panel .mc-ready-row small{color:#e2b841}
      #${SCRIPT_ID}-panel .mc-active-line{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:8px;padding:8px;background:#11120f}#${SCRIPT_ID}-panel .mc-active-line strong{flex:1}#${SCRIPT_ID}-panel .mc-active-details[hidden]{display:none}
      #${SCRIPT_ID}-panel .mc-session-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:5px;margin-top:8px}#${SCRIPT_ID}-panel .mc-session-grid article{display:grid;gap:3px;padding:7px;border:1px solid #4a3e20;background:#12130f}#${SCRIPT_ID}-panel .mc-session-grid small{color:#9f987e;font-size:9px}
      #${SCRIPT_ID}-panel .mc-participants,#${SCRIPT_ID}-panel .mc-map-players{margin-top:8px;padding:8px;border:1px solid #4a3e20}#${SCRIPT_ID}-panel .mc-participant{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:7px 0;border-top:1px solid #3d351f}#${SCRIPT_ID}-panel .mc-participant div{display:grid}#${SCRIPT_ID}-panel .mc-participant small{color:#9d957b}
      #${SCRIPT_ID}-panel .mc-map-players div{display:flex;flex-wrap:wrap;gap:5px}#${SCRIPT_ID}-panel .mc-timeline-head{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px;padding:7px;border:1px solid #4b4022}#${SCRIPT_ID}-panel .mc-timeline-head strong{flex:1}#${SCRIPT_ID}-panel .mc-timeline-head b{color:#84b849}
      #${SCRIPT_ID}-panel .mc-journal-toolbar{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:8px 0 2px;padding:7px;border:1px solid #44391f;background:#17150f}#${SCRIPT_ID}-panel .mc-journal-toolbar span{color:#948d78;font-size:11px}#${SCRIPT_ID}-panel .mc-timeline-events{max-height:none;overflow:visible}#${SCRIPT_ID}-panel details[data-journal-id]:not([open])>.mc-timeline-events{display:none!important}#${SCRIPT_ID}-panel .mc-timeline-events article{padding:7px;border-bottom:1px solid #44391f}#${SCRIPT_ID}-panel .mc-timeline-events article div{display:flex;justify-content:space-between;gap:8px}#${SCRIPT_ID}-panel .mc-timeline-events p{margin:4px 0;color:#ddd0aa}#${SCRIPT_ID}-panel .mc-timeline-events small,#${SCRIPT_ID}-panel time{color:#948d78}
      #${SCRIPT_ID}-notice{position:fixed;left:50%;top:70px;z-index:2147483647;max-width:560px;transform:translateX(-50%);padding:10px 14px;border:1px solid #806a3d;border-radius:4px;background:#24221e;color:#f2e4b1;box-shadow:0 5px 20px #000;font:13px Arial,sans-serif}
      #${SCRIPT_ID}-launcher{border-color:#2b6079;background:linear-gradient(145deg,#123346,#081824);color:#68ded9;font-family:Arial,sans-serif;box-shadow:0 5px 20px #000c}
      #${SCRIPT_ID}-launcher:hover{border-color:#68ded9;background:linear-gradient(145deg,#17445b,#0b2231)}
      #${SCRIPT_ID}-launcher[data-locked="0"]{cursor:grab}
      #${SCRIPT_ID}-launcher i{border-color:#2b6079;background:#07131d;color:#68ded9}
      #${SCRIPT_ID}-panel{color:#dce8f2;font-family:Arial,sans-serif}
      #${SCRIPT_ID}-panel .mc-window{border-color:#2b465c;background:rgba(8,18,28,.97);box-shadow:0 14px 42px #000d}
      #${SCRIPT_ID}-panel .mc-head{border-color:#29445a}
      #${SCRIPT_ID}-panel .mc-head small,#${SCRIPT_ID}-panel h2,#${SCRIPT_ID}-panel h3,#${SCRIPT_ID}-panel h4,#${SCRIPT_ID}-panel summary{color:#68ded9;font-family:Arial,sans-serif}
      #${SCRIPT_ID}-panel button{border-color:#35556d;background:#16283a;color:#dce8f2}
      #${SCRIPT_ID}-panel button:hover{border-color:#61cbd0;background:#1d3850}
      #${SCRIPT_ID}-panel button:disabled{opacity:.45;cursor:not-allowed}
      #${SCRIPT_ID}-panel button.danger{border-color:#784451;background:#45242e;color:#ff9ba8}
      #${SCRIPT_ID}-panel input,#${SCRIPT_ID}-panel textarea,#${SCRIPT_ID}-panel select{border-color:#304e64;background:#07131d;color:#e6f2f8}
      #${SCRIPT_ID}-panel input:focus,#${SCRIPT_ID}-panel textarea:focus,#${SCRIPT_ID}-panel select:focus{border-color:#56cbd0}
      #${SCRIPT_ID}-panel label{color:#b9cedc}
      #${SCRIPT_ID}-panel .mc-selected{color:#9fb5c4}
      #${SCRIPT_ID}-panel .mc-note{border-color:#53cbd0;background:#0b1b28;color:#9eb5c4}
      #${SCRIPT_ID}-panel .mc-box,#${SCRIPT_ID}-panel .mc-block{border-color:#29465b;background:#0d1b27}
      #${SCRIPT_ID}-panel .mc-active-line,#${SCRIPT_ID}-panel .mc-session-grid article{border-color:#29465b;background:#07131d}
      #${SCRIPT_ID}-panel .mc-search-results,#${SCRIPT_ID}-panel .mc-character,#${SCRIPT_ID}-panel .mc-ready-row,#${SCRIPT_ID}-panel .mc-participant,#${SCRIPT_ID}-panel .mc-timeline-events article{border-color:#263f52}
      #${SCRIPT_ID}-panel .mc-ready-row code{color:#75dce0}
      #${SCRIPT_ID}-panel .mc-ready-row small,#${SCRIPT_ID}-panel .mc-timeline-head b{color:#68ded9}
      #${SCRIPT_ID}-panel .mc-session-grid small,#${SCRIPT_ID}-panel .mc-participant small,#${SCRIPT_ID}-panel .mc-timeline-events small,#${SCRIPT_ID}-panel time{color:#8ea5b5}
      #${SCRIPT_ID}-panel .mc-participants,#${SCRIPT_ID}-panel .mc-map-players,#${SCRIPT_ID}-panel .mc-timeline-head,#${SCRIPT_ID}-panel .mc-journal-toolbar{border-color:#29465b}#${SCRIPT_ID}-panel .mc-journal-toolbar{background:#091620}
      #${SCRIPT_ID}-notice{border-color:#2d6079;background:#0b1b28;color:#dce8f2}
      #${SCRIPT_ID}-active-panel{position:fixed;inset:0;z-index:2147483001;overflow:visible!important;pointer-events:none;color:#dce8f2;font:12px Arial,sans-serif}
      #${SCRIPT_ID}-active-panel *{box-sizing:border-box}#${SCRIPT_ID}-active-panel .mc-active-window{position:absolute;left:calc(50% - 360px);top:55px;bottom:auto!important;display:block;width:min(720px,calc(100vw - 24px));height:auto!important;min-height:0!important;max-height:none!important;max-block-size:none!important;overflow:visible!important;overflow-y:visible!important;padding:8px;border:1px solid #2b465c;border-radius:5px;background:rgba(8,18,28,.97);box-shadow:0 14px 42px #000d;pointer-events:auto}
      #${SCRIPT_ID}-active-panel [data-active-panel-body],#${SCRIPT_ID}-active-panel .mc-participants,#${SCRIPT_ID}-active-panel .mc-map-players,#${SCRIPT_ID}-active-panel .mc-participant-session{position:static;height:auto!important;min-height:0!important;max-height:none!important;max-block-size:none!important;overflow:visible!important;overflow-y:visible!important}
      #${SCRIPT_ID}-active-panel .mc-active-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;padding-bottom:9px;border-bottom:1px solid #29445a;cursor:move;user-select:none;touch-action:none}
      #${SCRIPT_ID}-active-panel .mc-active-head small,#${SCRIPT_ID}-active-panel h3,#${SCRIPT_ID}-active-panel h4{color:#68ded9}#${SCRIPT_ID}-active-panel h3{margin:3px 0 0;font-size:18px}#${SCRIPT_ID}-active-panel .mc-active-head button{border:0;background:none;color:#dce8f2;font-size:18px;cursor:pointer}
      #${SCRIPT_ID}-active-panel button{padding:7px 10px;border:1px solid #35556d;border-radius:3px;background:#16283a;color:#dce8f2;font:bold 12px Arial;cursor:pointer}#${SCRIPT_ID}-active-panel button:hover{border-color:#61cbd0;background:#1d3850}#${SCRIPT_ID}-active-panel button.danger{border-color:#784451;background:#45242e;color:#ff9ba8}
      #${SCRIPT_ID}-active-panel .mc-session-grid{display:grid;grid-template-columns:1.35fr 1.35fr 1.3fr .7fr .9fr;gap:4px;margin-top:6px}#${SCRIPT_ID}-active-panel .mc-session-grid article{display:grid;align-content:center;gap:2px;min-height:42px;padding:5px 6px;border:1px solid #29465b;background:#07131d}#${SCRIPT_ID}-active-panel .mc-session-grid small{color:#8ea5b5;font-size:8px}#${SCRIPT_ID}-active-panel .mc-session-grid strong{font-size:11px;overflow-wrap:anywhere}
      #${SCRIPT_ID}-active-panel .mc-participants,#${SCRIPT_ID}-active-panel .mc-map-players{margin-top:6px;padding:6px;border:1px solid #29465b}
      #${SCRIPT_ID}-active-panel .mc-participant-session{padding:6px 0;border-top:1px solid #263f52}
      #${SCRIPT_ID}-active-panel .mc-participant-session:first-of-type{border-top:0}
      #${SCRIPT_ID}-active-panel .mc-participant-session.resolved{opacity:.62}
      #${SCRIPT_ID}-active-panel .mc-participant-actions{display:flex;flex-wrap:wrap;align-items:center;justify-content:flex-end;gap:6px;margin-top:5px}
      #${SCRIPT_ID}-active-panel .mc-participant-actions span{margin-right:auto;color:#8ea5b5}
      #${SCRIPT_ID}-active-panel .mc-map-players div{display:flex;flex-wrap:wrap;gap:5px}
      @media(max-width:760px){#${SCRIPT_ID}-panel .mc-command-tabs{grid-template-columns:1fr}#${SCRIPT_ID}-panel .mc-command-fields{grid-template-columns:1fr 1fr}#${SCRIPT_ID}-panel .mc-command-fields .wide{grid-column:1/-1}#${SCRIPT_ID}-panel .mc-ready-editor{grid-template-columns:1fr}#${SCRIPT_ID}-panel .mc-session-grid,#${SCRIPT_ID}-active-panel .mc-session-grid{grid-template-columns:1fr 1fr}#${SCRIPT_ID}-active-panel .mc-active-window{left:12px}}
    `;
    document.head.appendChild(style);
  }

  function notice(text) {
    document.getElementById(`${SCRIPT_ID}-notice`)?.remove();
    const element = document.createElement("div");
    element.id = `${SCRIPT_ID}-notice`;
    element.textContent = text;
    document.body.appendChild(element);
    setTimeout(() => element.remove(), 5000);
  }

  function generateCode() {
    return String(crypto.getRandomValues(new Uint32Array(1))[0] % 10000).padStart(4, "0");
  }

  function formatDuration(milliseconds) {
    const total = Math.max(0, Math.floor(milliseconds / 1000));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    return hours ? `${hours}h ${minutes}m ${seconds}s` : `${minutes}m ${seconds}s`;
  }

  function formatDate(value) {
    try {
      return new Intl.DateTimeFormat("pl-PL", { dateStyle: "short", timeStyle: "medium" }).format(new Date(value));
    } catch {
      return String(value || "");
    }
  }

  function presenceLabel(value) {
    return value === "MISSING" ? "poza bieżącą mapą" : value === "RESOLVED" ? "zakończona" : "obecny na mapie";
  }

  function finiteOrNull(value) {
    return Number.isFinite(Number(value)) ? Number(value) : null;
  }

  function sameNick(a, b) {
    return normalize(a).toLocaleLowerCase("pl") === normalize(b).toLocaleLowerCase("pl");
  }

  function normalize(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim();
  }

  function escapeMarkup(value) {
    return String(value ?? "").replace(/[&<>"']/g, character =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character]
    );
  }

  function escapeAttribute(value) {
    return escapeMarkup(value).replace(/`/g, "&#096;");
  }

  function escapeConsole(value) {
    return String(value || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/[\r\n]+/g, " ");
  }

  function isVisible(element) {
    if (!(element instanceof Element)) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
  }

  function elementDistance(a, b) {
    return Math.abs(a.left - b.left) + Math.abs(a.top - b.top);
  }

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  console.info("[Centrum Moderacji] v3.0.0 gotowe — tryb lokalny bez API i zewnętrznego runtime.");
})();
