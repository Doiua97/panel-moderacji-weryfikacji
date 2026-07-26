// ==UserScript==
// @name         Margonem — Centrum Moderacji
// @namespace    https://github.com/Doiua97/panel-moderacji-weryfikacji
// @version      3.3.31
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
  window[RUNTIME_GUARD] = "3.3.31";

  const SCRIPT_ID = "margo-moderation-center";
  const LOCAL_DATABASE_KEY = `${SCRIPT_ID}:local-database:v1`;
  const LOCAL_DATABASE_EVENT = `${SCRIPT_ID}:local-database-change`;
  const LAUNCHER_POSITION_KEY = `${SCRIPT_ID}:launcher-position`;
  const LAUNCHER_LOCK_KEY = `${SCRIPT_ID}:launcher-locked`;
  const PANEL_POSITION_KEY = `${SCRIPT_ID}:panel-position`;
  const PANEL_OPEN_KEY = `${SCRIPT_ID}:panel-open`;
  const ACTIVE_PANEL_POSITION_KEY = `${SCRIPT_ID}:active-panel-position`;
  const ACTIVE_PANEL_OPEN_KEY = `${SCRIPT_ID}:active-panel-open`;
  const ACTIVE_MAP_PLAYERS_COLLAPSED_KEY = `${SCRIPT_ID}:active-map-players-collapsed`;
  const READY_COMMANDS_KEY = `${SCRIPT_ID}:ready-commands`;
  const START_CONFIG_KEY = `${SCRIPT_ID}:start-config`;
  const DEFAULT_CONFIGURATION_MIGRATION_KEY = `${SCRIPT_ID}:default-configuration:2026-07-26-v1`;
  const WIDGET_KEY = "MARGO_MODERATION_CENTER";
  const NATIVE_MENU_HOOK_MARK = "__margoModerationCenterPlayerMenuHook__";
  const DEFAULT_START_CONFIG = {
    local: "Weryfikacja Gracza {nick} rozpoczęta.",
    console: '.reminder "{nick}" "Polecenie weryfikacyjne: Proszę o przesłanie zrzutu ekranu na moją aktualną Postać w prywatnej wiadomości na czacie prywatnym."',
    sendCode: '.reminder "{nick}" "Polecenie weryfikacyjne: Proszę o wiadomość {kod} na moją aktualną Postać w prywatnej wiadomości na czacie prywatnym."',
    sendNick: '.reminder "{nick}" "Polecenie weryfikacyjne: Proszę o przesłanie swojego nicku z gry na moją aktualną Postać w prywatnej wiadomości na czacie prywatnym."',
    sendScreen: '.reminder "{nick}" "Polecenie weryfikacyjne: Proszę o przesłanie zrzutu ekranu na moją aktualną Postać w prywatnej wiadomości na czacie prywatnym."',
    finish: "Weryfikacja Gracza {nick} zakończona."
  };
  const DEFAULT_READY_COMMANDS = [
    {
      id: "default-code-v2",
      label: "KOD",
      channel: "CONSOLE",
      content: '.reminder "{nick}" "Polecenie weryfikacyjne: Proszę o wiadomość {kod} na moją aktualną Postać w prywatnej wiadomości na czacie prywatnym."'
    },
    {
      id: "default-nick-v2",
      label: "NICK",
      channel: "CONSOLE",
      content: '.reminder "{nick}" "Polecenie weryfikacyjne: Proszę o przesłanie swojego nicku z gry na moją aktualną Postać w prywatnej wiadomości na czacie prywatnym."'
    },
    {
      id: "default-screen-v2",
      label: "SCREEN",
      channel: "CONSOLE",
      content: '.reminder "{nick}" "Polecenie weryfikacyjne: Proszę o przesłanie zrzutu ekranu na moją aktualną Postać w prywatnej wiadomości na czacie prywatnym."'
    },
    {
      id: "default-attack-mobs-v2",
      label: "ZAATAKOWANIE MOBÓW",
      channel: "CONSOLE",
      content: '.reminder "{nick}" "Polecenie weryfikacyjne: Proszę zaatakować najbliższego moba, lub grupę mobów."'
    },
    {
      id: "default-trade-v2",
      label: "HANDEL",
      channel: "CONSOLE",
      content: '.reminder "{nick}" "Polecenie weryfikacyjne: Proszę o podejście i rozpoczęcie handlu z moją aktualną Postacią w Grze."'
    },
    {
      id: "default-approach-v2",
      label: "PODEJŚCIE DO WERYFIKUJĄCEGO",
      channel: "CONSOLE",
      content: '.reminder "{nick}" "Polecenie weryfikacyjne: Proszę o podejście do mojej aktualnej Postaci w Grze."'
    }
  ];
  const LEGACY_READY_COMMAND_IDS = new Set(["finish", "code", "nick", "screen", "mobs", "trade", "approach"]);
  const state = {
    selected: { nick: "", id: "" },
    selectedPlayers: [],
    active: null,
    accountCharacters: [],
    accountSearchId: "",
    nativeMenuHookTimer: 0,
    pollTimer: 0,
    ticker: 0,
    panel: null,
    activePanel: null,
    journal: []
  };

  waitForGame();

  function waitForGame() {
    const ready = () => Boolean(document.getElementById("GAME_CANVAS") || getEngine()?.hero);
    const start = () => {
      migrateDefaultConfiguration();
      addStyles();
      createNativeWidget().then(created => {
        if (!created) createLauncher();
      });
      startNativePlayerMenuIntegration();
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

  function migrateDefaultConfiguration() {
    if (localStorage.getItem(DEFAULT_CONFIGURATION_MIGRATION_KEY) === "1") return;
    localStorage.setItem(START_CONFIG_KEY, JSON.stringify(DEFAULT_START_CONFIG));
    localStorage.setItem(READY_COMMANDS_KEY, JSON.stringify(DEFAULT_READY_COMMANDS));
    localStorage.setItem(DEFAULT_CONFIGURATION_MIGRATION_KEY, "1");
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
      events: (record.events || []).filter(event =>
        event?.event_type !== "PARTICIPANT_LEFT_MAP" &&
        event?.event_type !== "PARTICIPANT_RETURNED"
      )
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
        target_account_id: data.targetAccountId || null,
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
        account_id: data.targetAccountId || null,
        joined_at: now,
        started_at: now,
        verification_code: data.code || "",
        start_map_id: data.startMapId || null,
        start_map_name: data.startMapName || null,
        resolved_at: null
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
    window.addEventListener("storage", event => {
      if (event.key === LOCAL_DATABASE_KEY) refreshActive();
    });
    window.addEventListener(LOCAL_DATABASE_EVENT, refreshActive);
  }

  function refreshActive() {
    const details = getLocalActiveVerification();
    state.active = details;
    state.journal = getLocalJournal();
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
    if (player?.nick) selectPlayers([{ nick: player.nick, id: player.id || resolvePlayerId(player.nick) || "" }]);
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
    persistStartConfigFromPanel(state.panel, false);
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
          <input data-search placeholder="ID konta lub link profilu, np. 8863242">
          <button type="button" data-select-player>Wykryj postacie</button>
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
          <summary>Polecenia weryfikacyjne <b>ZAPIS LOKALNY</b></summary>
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
          <div data-timeline></div>
          <div class="mc-journal-toolbar">
            <button type="button" class="danger" data-clear-journal>Wyczyść</button>
          </div>
        </details>
      </div>`;
  }

  function bindPanel(overlay) {
    const win = overlay.querySelector(".mc-window");
    const head = overlay.querySelector(".mc-head");
    installPanelWheelScrolling(win);
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
      selectPlayers([]);
      state.accountCharacters = [];
      state.accountSearchId = "";
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
      persistStartConfigFromPanel(overlay, true);
    });
    overlay.querySelectorAll([
      "[data-start-local]",
      "[data-start-console]",
      "[data-send-code-command]",
      "[data-send-nick-command]",
      "[data-send-screen-command]",
      "[data-finish-local]"
    ].join(",")).forEach(field => {
      field.addEventListener("input", () => persistStartConfigFromPanel(overlay, false));
    });
    overlay.querySelector("[data-ready-save]").addEventListener("click", saveReadyCommand);
    overlay.querySelector("[data-ready-cancel]").addEventListener("click", resetReadyEditor);
    overlay.querySelector("[data-clear-journal]").addEventListener("click", clearVerificationJournal);
  }

  function installPanelWheelScrolling(panelWindow) {
    if (!panelWindow) return;
    panelWindow.addEventListener("wheel", event => {
      event.stopPropagation();
      if (!event.deltaY) return;

      const direction = Math.sign(event.deltaY);
      let scrollTarget = event.target instanceof Element ? event.target : panelWindow;
      while (scrollTarget && scrollTarget !== panelWindow) {
        const style = getComputedStyle(scrollTarget);
        const canScroll = /(auto|scroll)/.test(style.overflowY)
          && scrollTarget.scrollHeight > scrollTarget.clientHeight + 1;
        const hasRoom = direction > 0
          ? scrollTarget.scrollTop + scrollTarget.clientHeight < scrollTarget.scrollHeight - 1
          : scrollTarget.scrollTop > 1;
        if (canScroll && hasRoom) break;
        scrollTarget = scrollTarget.parentElement;
      }
      if (!scrollTarget) scrollTarget = panelWindow;

      const multiplier = event.deltaMode === 1
        ? 16
        : event.deltaMode === 2
          ? panelWindow.clientHeight
          : 1;
      scrollTarget.scrollTop += event.deltaY * multiplier;
      event.preventDefault();
    }, { capture: true, passive: false });
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
    if (!value) return notice("Wpisz ID konta albo link do profilu.");
    const accountId = profileAccountId(value);
    if (!accountId) {
      notice("Wpisz poprawne ID konta albo pełny link do profilu Margonem.");
      input?.focus();
      return;
    }
    await detectAccountCharacters(accountId);
  }

  function renderSelected() {
    if (!state.panel) return;
    state.panel.querySelector("[data-selected]").textContent = state.selected.nick || "nie rozpoznano";
  }

  function selectPlayers(players = [], options = {}) {
    const normalized = [];
    const seen = new Set();
    for (const player of Array.isArray(players) ? players : [players]) {
      const nick = normalize(player?.nick);
      if (!nick) continue;
      const key = nick.toLocaleLowerCase("pl");
      if (seen.has(key)) continue;
      seen.add(key);
      normalized.push({
        nick,
        id: player?.id || resolvePlayerId(nick) || ""
      });
    }
    state.selectedPlayers = normalized;
    state.selected = normalized.length
      ? {
          nick: normalized.map(item => item.nick).join(", "),
          id: normalized.length === 1 ? normalized[0].id : ""
        }
      : { nick: "", id: "" };
    renderSelected();
    if (options.renderActive && state.activePanel) renderActivePanel();
  }

  function selectedPlayers() {
    if (state.selectedPlayers.length) return [...state.selectedPlayers];
    return state.selected.nick ? [{ ...state.selected }] : [];
  }

  function panelValues(additions = {}) {
    const selectedNick = Object.prototype.hasOwnProperty.call(additions, "nick")
      ? normalize(additions.nick)
      : state.selected.nick;
    const selectedParticipant = findParticipant(selectedNick);
    return {
      nick: selectedNick,
      moderator: getCurrentCharacterNick(),
      czas: normalize(state.panel?.querySelector("[data-time]")?.value),
      powod: normalize(state.panel?.querySelector("[data-reason]")?.value),
      tresc: normalize(state.panel?.querySelector("[data-reason]")?.value),
      kod: Object.prototype.hasOwnProperty.call(additions, "kod")
        ? normalize(additions.kod)
        : normalize(state.panel?.querySelector("[data-code]")?.value)
        || normalize(selectedParticipant?.verification_code)
        || normalize(state.active?.verification?.verification_code),
      ...additions
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

  async function executeModeratorCommand(action, explicitTargets = null, options = {}) {
    const needsTarget = ["reminder", "mute", "unmute", "kill", "unkill", "chatadd", "chatdel"].includes(action);
    const fixedTime = Object.prototype.hasOwnProperty.call(options, "czas")
      ? normalize(options.czas)
      : null;
    const targets = needsTarget
      ? (Array.isArray(explicitTargets) ? explicitTargets : selectedPlayers())
        .map(target => ({
          nick: normalize(target?.nick || target?.name),
          id: target?.id || resolvePlayerId(target?.nick || target?.name) || ""
        }))
        .filter(target => target.nick)
      : [{ nick: "", id: "" }];
    if (needsTarget && !targets.length) return notice("Najpierw wybierz gracza.");
    const sentCommands = [];
    for (let targetIndex = 0; targetIndex < targets.length; targetIndex += 1) {
      const target = targets[targetIndex];
      const participant = findParticipant(target.nick);
      const values = panelValues({
        nick: target.nick,
        kod: normalize(participant?.verification_code)
          || normalize(state.panel?.querySelector("[data-code]")?.value)
          || normalize(state.active?.verification?.verification_code),
        ...(fixedTime !== null ? { czas: fixedTime } : {})
      });
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
      if (!command) continue;
      if (!sendViaGameConsole(command)) return notice("Konsola gry nie jest obecnie dostępna.");
      sentCommands.push({ label, command, nick: values.nick });
      await recordCommand(label, command, "CONSOLE", values.nick);
      if (Number(options.delayMs) > 0 && targetIndex < targets.length - 1) {
        await new Promise(resolve => setTimeout(resolve, Number(options.delayMs)));
      }
    }
    if (sentCommands.length) {
      const label = sentCommands[0].label;
      notice(targets.length > 1
        ? `Wysłano polecenie „${label}” osobno do ${targets.length} graczy.`
        : `Wysłano polecenie: ${label}.`);
    }
  }

  function profileAccountId(value) {
    const text = String(value || "").trim();
    if (/^\d{3,12}$/.test(text)) return text;
    const profileMatch = text.match(/profile\/view,(\d{3,12})/i);
    if (profileMatch) return profileMatch[1];
    const legacyMatch = text.match(/[?&](?:id|user_id)=(\d{3,12})(?:&|$)/i);
    return legacyMatch ? legacyMatch[1] : "";
  }

  async function detectAccountCharacters(id) {
    const target = state.panel?.querySelector("[data-search-results]");
    if (!target) return;
    const fetchButton = state.panel?.querySelector("[data-select-player]");
    const world = currentWorldName();
    state.accountSearchId = String(id || "");
    if (fetchButton) {
      fetchButton.disabled = true;
      fetchButton.textContent = "Pobieranie…";
    }
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
    } finally {
      if (fetchButton) {
        fetchButton.disabled = false;
        fetchButton.textContent = "Wykryj postacie";
      }
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
          "Accept-Language": "pl-PL,pl;q=0.9,en;q=0.7",
          "Cache-Control": "no-cache"
        },
        // Publiczny profil musi być pobierany bez sesji osoby korzystającej
        // z panelu. W przeciwnym razie Margonem może dołączyć do dokumentu
        // przełącznik jej własnych postaci, który nie należy do szukanego konta.
        anonymous: true,
        timeout: 15000,
        onload: response => {
          if (response.status < 200 || response.status >= 400) {
            reject(new Error(`HTTP ${response.status || 0}`));
            return;
          }
          const returnedAccountId = profileAccountId(response.finalUrl || "");
          if (returnedAccountId && returnedAccountId !== String(accountId)) {
            reject(new Error("serwis zwrócił profil innego konta"));
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

    const readField = (container, selector) => {
      const element = container?.querySelector?.(selector);
      if (!element) return "";
      return normalize(
        ("value" in element ? element.value : "") ||
        element.getAttribute?.("value") ||
        element.textContent
      );
    };

    // Aktualny publiczny profil Margonem udostępnia postacie jako .char-row.
    // Klasy legacy pozostają dla zgodności, ale nie skanujemy już dowolnych
    // elementów data-character-id z nawigacji zalogowanego użytkownika.
    for (const container of documentProfile.querySelectorAll(".char-row, .charc, .charcs")) {
      const name = normalize(
        container.dataset.nick ||
        readField(container, ".chnick, .character-name, [name='nick'], [data-character-nick], [data-char-nick], [data-nick]")
      );
      const world = normalize(
        container.dataset.world ||
        readField(container, ".chworld, [name='world'], [data-character-world], [data-char-world], [data-world]")
      );
      if (!name || !world) continue;
      characters.push({
        name,
        world,
        id: normalize(
          container.dataset.id ||
          readField(container, ".chid, [name='char_id'], [name='character_id'], [data-character-id], [data-char-id], [data-id]")
        ),
        level: normalize(
          container.dataset.lvl ||
          readField(container, ".chlvl, [name='lvl'], [name='level'], [data-character-level], [data-char-level], [data-lvl]")
        )
      });
    }

    if (!characters.length) {
      for (const worldElement of documentProfile.querySelectorAll(".chworld")) {
        const container = worldElement.closest(".charc, .charcs") || worldElement.parentElement;
        if (!container) continue;
        const name = readField(container, ".chnick");
        const world = normalize(("value" in worldElement ? worldElement.value : "") || worldElement.textContent);
        if (!name || !world) continue;
        characters.push({
          name,
          world,
          id: readField(container, ".chid"),
          level: readField(container, ".chlvl")
        });
      }
    }

    for (const link of documentProfile.querySelectorAll('a[href*="#char_"]')) {
      const href = String(link.getAttribute("href") || "");
      const hashMatch = href.match(/#char_(\d+),([\w-]+)/i);
      if (!hashMatch) continue;
      const container = link.closest(".charc, .charcs, li, article, section, div") || link;
      const name = readField(container, ".chnick")
        || normalize(link.getAttribute("data-nick"))
        || normalize(link.textContent);
      if (!name || name.length > 80) continue;
      characters.push({
        name,
        world: hashMatch[2],
        id: hashMatch[1],
        level: readField(container, ".chlvl")
      });
    }

    if (!characters.length) {
      const source = String(html || "");
      const objectPattern = /["']nick["']\s*:\s*["']([^"']{1,80})["'][\s\S]{0,400}?["']world(?:name)?["']\s*:\s*["']([\w-]{2,40})["']/gi;
      const reversedPattern = /["']world(?:name)?["']\s*:\s*["']([\w-]{2,40})["'][\s\S]{0,400}?["']nick["']\s*:\s*["']([^"']{1,80})["']/gi;
      let match;
      while ((match = objectPattern.exec(source))) {
        characters.push({
          name: decodeProfileText(match[1]),
          world: match[2],
          id: "",
          level: ""
        });
      }
      while ((match = reversedPattern.exec(source))) {
        characters.push({
          name: decodeProfileText(match[2]),
          world: match[1],
          id: "",
          level: ""
        });
      }
    }

    const seen = new Set();
    return characters
      .filter(character => character.name && normalizeWorldName(character.world) === requested)
      .filter(character => {
        const key = `${normalizeWorldName(character.world)}\u0000${normalize(character.name).toLocaleLowerCase("pl")}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map(character => ({
        name: normalize(character.name),
        id: normalize(character.id) || null,
        level: finiteOrNull(character.level),
        world: normalize(character.world)
      }))
      .sort((left, right) =>
      Number(right.level || 0) - Number(left.level || 0) ||
      left.name.localeCompare(right.name, "pl")
    );
  }

  function decodeProfileText(value) {
    const textarea = document.createElement("textarea");
    textarea.innerHTML = String(value || "");
    return normalize(textarea.value);
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
    target.innerHTML = `
      <div class="mc-account-result-head">
        Znaleziono ${state.accountCharacters.length} postaci konta ${escapeMarkup(state.accountSearchId)}
        na świecie ${escapeMarkup(world)}. Zaznacz postacie, na których chcesz wykonać operację.
      </div>
      <div class="mc-account-character-list">
        ${state.accountCharacters.map((character, index) => `
          <label class="mc-account-character">
            <input
              type="checkbox"
              data-account-character
              data-character-index="${index}"
              value="${escapeAttribute(character.name)}"
              checked
            >
            <span>
              <strong>${escapeMarkup(character.name)}</strong>
              <small>${[
                character.level ? `${character.level} lvl` : "",
                character.id ? `ID postaci ${character.id}` : ""
              ].filter(Boolean).map(escapeMarkup).join(" · ")}</small>
            </span>
          </label>`).join("")}
      </div>
      <div class="mc-account-batch" data-account-batch hidden>
        <span data-account-selection-count></span>
        <button type="button" class="danger" data-account-batch-command="kill">Zabij zaznaczone postacie</button>
        <button type="button" class="danger" data-account-batch-command="unkill">Zdejmij zabicie z zaznaczonych postaci</button>
      </div>`;

    target.querySelectorAll("[data-account-character]").forEach(input => {
      input.addEventListener("change", syncAccountCharacterSelection);
    });
    target.querySelectorAll("[data-account-batch-command]").forEach(button => {
      button.addEventListener("click", () => executeAccountBatch(button.dataset.accountBatchCommand));
    });
    syncAccountCharacterSelection();
  }

  function selectedAccountCharacters() {
    const target = state.panel?.querySelector("[data-search-results]");
    if (!target) return [];
    return [...target.querySelectorAll("[data-account-character]:checked")]
      .map(input => state.accountCharacters[Number(input.dataset.characterIndex)])
      .filter(Boolean)
      .map(character => ({
        nick: character.name,
        id: character.id || resolvePlayerId(character.name) || ""
      }));
  }

  function syncAccountCharacterSelection() {
    const selected = selectedAccountCharacters();
    selectPlayers(selected);
    const batch = state.panel?.querySelector("[data-account-batch]");
    const count = state.panel?.querySelector("[data-account-selection-count]");
    if (count) count.textContent = `Zaznaczono: ${selected.length}`;
    if (batch) batch.hidden = selected.length === 0;
  }

  async function executeAccountBatch(action) {
    const selected = selectedAccountCharacters();
    if (selected.length === 0) {
      notice("Zaznacz co najmniej jedną postać.");
      return;
    }
    const time = normalize(state.panel?.querySelector("[data-time]")?.value);
    if (action === "kill" && !time) {
      notice("Wpisz czas kary w polu „Czas”.");
      state.panel?.querySelector("[data-time]")?.focus();
      return;
    }
    if (action === "kill" && !/^[\w.+-]+$/u.test(time)) {
      notice("Czas może zawierać tylko cyfry, litery oraz znaki: . + -");
      state.panel?.querySelector("[data-time]")?.focus();
      return;
    }
    const operation = action === "kill"
      ? `wykonać .kill na czas ${time}`
      : "wykonać .unkill";
    const confirmed = window.confirm(
      `Czy na pewno chcesz ${operation} dla ${selected.length} zaznaczonych postaci?\n\n`
      + selected.map(character => `• ${character.nick}`).join("\n")
    );
    if (!confirmed) return;
    await executeModeratorCommand(action, selected, { delayMs: 750, czas: time });
  }

  function normalizeStartConfig(value = {}) {
    const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    return {
      local: typeof source.local === "string" ? source.local : DEFAULT_START_CONFIG.local,
      console: typeof source.console === "string" ? source.console : DEFAULT_START_CONFIG.console,
      sendCode: typeof source.sendCode === "string" ? source.sendCode : DEFAULT_START_CONFIG.sendCode,
      sendNick: typeof source.sendNick === "string" ? source.sendNick : DEFAULT_START_CONFIG.sendNick,
      sendScreen: typeof source.sendScreen === "string" ? source.sendScreen : DEFAULT_START_CONFIG.sendScreen,
      finish: typeof source.finish === "string" ? source.finish : DEFAULT_START_CONFIG.finish
    };
  }

  function readStartConfig() {
    try {
      return normalizeStartConfig(JSON.parse(localStorage.getItem(START_CONFIG_KEY) || "{}"));
    } catch {
      return normalizeStartConfig();
    }
  }

  function writeStartConfig(value) {
    const normalized = normalizeStartConfig(value);
    localStorage.setItem(START_CONFIG_KEY, JSON.stringify(normalized));
    return readStartConfig();
  }

  function collectStartConfig(root) {
    if (!root) return readStartConfig();
    return {
      local: root.querySelector("[data-start-local]")?.value.trim() ?? "",
      console: root.querySelector("[data-start-console]")?.value.trim() ?? "",
      sendCode: root.querySelector("[data-send-code-command]")?.value.trim() ?? "",
      sendNick: root.querySelector("[data-send-nick-command]")?.value.trim() ?? "",
      sendScreen: root.querySelector("[data-send-screen-command]")?.value.trim() ?? "",
      finish: root.querySelector("[data-finish-local]")?.value.trim() ?? ""
    };
  }

  function persistStartConfigFromPanel(root, showNotice = false) {
    if (!root?.isConnected) return false;
    try {
      const expected = normalizeStartConfig(collectStartConfig(root));
      const saved = writeStartConfig(expected);
      const fields = {
        local: "[data-start-local]",
        console: "[data-start-console]",
        sendCode: "[data-send-code-command]",
        sendNick: "[data-send-nick-command]",
        sendScreen: "[data-send-screen-command]",
        finish: "[data-finish-local]"
      };
      const complete = Object.entries(fields).every(([key, selector]) => {
        const field = root.querySelector(selector);
        if (!field || saved[key] !== expected[key]) return false;
        if (showNotice) field.value = saved[key];
        return true;
      });
      if (!complete) {
        if (showNotice) notice("Nie udało się zapisać wszystkich pól konfiguracji.");
        return false;
      }
      if (showNotice) notice("Zapisano wszystkie treści rozpoczęcia i zakończenia weryfikacji.");
      return true;
    } catch (error) {
      if (showNotice) notice(`Nie udało się zapisać konfiguracji (${error.message}).`);
      return false;
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
    const targets = selectedPlayers();
    const usesNick = /\{nick\}/i.test(command.content);
    const usesCode = /\{kod\}/i.test(command.content);
    if ((usesNick || usesCode) && !targets.length) return notice("Najpierw wybierz gracza.");

    // Czat lokalny potrafi zawrzeć wiele nicków w jednej wiadomości. Kod jest
    // jednak indywidualny, dlatego szablony z {kod} zawsze wysyłamy osobno.
    if (command.channel === "LOCAL" && targets.length > 1 && usesNick && !usesCode) {
      const combinedNames = targets.map(item => item.nick).join(", ");
      const resolved = resolveTemplate(command.content, { nick: combinedNames });
      if (resolved.missing.length) return notice(`Uzupełnij dane dla: ${resolved.missing.join(", ")}.`);
      if (!await sendLocalChatMessage(resolved.content)) return notice("Nie udało się wysłać polecenia.");
      for (const target of targets) {
        await recordCommand(command.label, resolved.content, command.channel, target.nick);
      }
      notice(`Wysłano polecenie „${command.label}” do ${targets.length} graczy.`);
      return;
    }

    const deliveries = (usesNick || usesCode) ? targets : [{ nick: "", id: "" }];
    for (const target of deliveries) {
      const participant = findParticipant(target.nick);
      const resolved = resolveTemplate(command.content, {
        nick: target.nick,
        kod: normalize(participant?.verification_code)
          || normalize(state.panel?.querySelector("[data-code]")?.value)
          || normalize(state.active?.verification?.verification_code)
      });
      if (resolved.missing.length) return notice(`Uzupełnij dane dla: ${resolved.missing.join(", ")}.`);
      const sent = command.channel === "LOCAL"
        ? await sendLocalChatMessage(resolved.content)
        : sendViaGameConsole(resolved.content);
      if (!sent) return notice("Nie udało się wysłać polecenia.");
      await recordCommand(command.label, resolved.content, command.channel, target.nick);
    }
    notice(deliveries.length > 1
      ? `Wysłano polecenie „${command.label}” osobno do ${deliveries.length} graczy.`
      : `Wysłano polecenie „${command.label}”.`);
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
    const isGroupVerification = participants.length > 1;
    const selectedNames = selectedPlayers().map(item => item.nick);
    const targetNames = unresolved.map(item => item.character_name).join(", ") || verification.target_character || "—";
    const mapPlayersCollapsed = localStorage.getItem(ACTIVE_MAP_PLAYERS_COLLAPSED_KEY) === "1";
    root.querySelector("[data-active-panel-title]").textContent = targetNames;
    root.querySelector("[data-active-panel-body]").innerHTML = `
      <section class="mc-participants">
        <h4>${isGroupVerification ? "Weryfikacja grupowa" : "Aktywna weryfikacja"}</h4>
        ${isGroupVerification && unresolved.length ? `
          <div class="mc-group-actions">
            <button type="button" data-select-all-participants>Wybierz wszystkich</button>
            <button type="button" data-clear-participant-selection>Wyczyść</button>
            <button type="button" class="danger" data-finish-all-participants>Zakończ wszystkich</button>
          </div>` : ""}
        ${participants.map(item => `
          <article class="mc-participant-session ${item.resolved_at ? "resolved" : ""} ${selectedNames.some(name => sameNick(name, item.character_name)) ? "selected-target" : ""}">
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
              <span>${item.resolved_at ? "Zakończona" : "Aktywna"}</span>
              ${item.resolved_at ? "" : `
                ${isGroupVerification ? `
                  <button
                    type="button"
                    data-select-participant="${escapeAttribute(item.id)}"
                    data-participant-selected="${selectedNames.some(name => sameNick(name, item.character_name)) ? "1" : "0"}"
                  >${selectedNames.some(name => sameNick(name, item.character_name)) ? "Wyczyść" : "Wybierz"}</button>` : ""}
                <button
                  type="button"
                  data-load-participant-account="${escapeAttribute(item.id)}"
                  title="Otwórz w Centrum Moderacji postacie tego konta"
                >Pobierz ID konta</button>
                <button type="button" data-send-participant-code="${escapeAttribute(item.id)}">Wyślij nowy kod</button>
                <button type="button" data-send-participant-command="sendNick" data-participant-id="${escapeAttribute(item.id)}">Wyślij nick</button>
                <button type="button" data-send-participant-command="sendScreen" data-participant-id="${escapeAttribute(item.id)}">Wyślij screen</button>
                <button type="button" class="danger" data-finish-participant="${escapeAttribute(item.id)}">Zakończ weryfikację</button>`}
            </div>
          </article>`).join("")}
      </section>
      <details class="mc-map-players" data-map-players-section ${mapPlayersCollapsed ? "" : "open"}>
        <summary>Gracze na bieżącej mapie <b data-map-players-toggle-label>${mapPlayersCollapsed ? "+" : "−"}</b></summary>
        <div>${onMap.filter(player => !findParticipant(player.nick)).map(player =>
          `<button
            data-add-map-player="${escapeAttribute(player.nick)}"
            data-player-id="${escapeAttribute(player.id)}"
            data-player-account-id="${escapeAttribute(player.accountId || "")}"
          >+ ${escapeMarkup(player.nick)}</button>`
        ).join("") || "<small>Brak innych graczy do dodania.</small>"}</div>
      </details>`;
    const mapPlayersSection = root.querySelector("[data-map-players-section]");
    mapPlayersSection?.addEventListener("toggle", () => {
      localStorage.setItem(ACTIVE_MAP_PLAYERS_COLLAPSED_KEY, mapPlayersSection.open ? "0" : "1");
      const label = mapPlayersSection.querySelector("[data-map-players-toggle-label]");
      if (label) label.textContent = mapPlayersSection.open ? "−" : "+";
    });
    root.querySelectorAll("[data-add-map-player]").forEach(button => button.addEventListener("click", async () => {
      await addParticipant({
        nick: button.dataset.addMapPlayer,
        id: button.dataset.playerId,
        accountId: button.dataset.playerAccountId || null
      });
    }));
    root.querySelectorAll("[data-select-participant]").forEach(button => button.addEventListener("click", () => {
      const participant = unresolved.find(item => String(item.id) === String(button.dataset.selectParticipant));
      if (!participant) return;
      const participantPlayer = {
        nick: participant.character_name,
        id: participant.character_id || resolvePlayerId(participant.character_name) || ""
      };
      const currentSelection = selectedPlayers();
      const isSelected = currentSelection.some(item => sameNick(item.nick, participant.character_name));
      selectPlayers(isSelected
        ? currentSelection.filter(item => !sameNick(item.nick, participant.character_name))
        : [...currentSelection, participantPlayer], { renderActive: true });
      notice(isSelected
        ? `Odznaczono gracza ${participant.character_name}.`
        : `Wybrano gracza ${participant.character_name}.`);
    }));
    root.querySelector("[data-select-all-participants]")?.addEventListener("click", () => {
      selectPlayers(unresolved.map(item => ({
        nick: item.character_name,
        id: item.character_id || resolvePlayerId(item.character_name) || ""
      })), { renderActive: true });
      notice(`Wybrano wszystkich aktywnych uczestników (${unresolved.length}).`);
    });
    root.querySelector("[data-clear-participant-selection]")?.addEventListener("click", () => {
      selectPlayers([], { renderActive: true });
      notice("Wyczyszczono wybór uczestników.");
    });
    root.querySelector("[data-finish-all-participants]")?.addEventListener("click", async () => {
      await finishAllParticipantVerifications();
    });
    root.querySelectorAll("[data-send-participant-code]").forEach(button => button.addEventListener("click", async () => {
      await sendNewVerificationCode(button.dataset.sendParticipantCode);
    }));
    root.querySelectorAll("[data-load-participant-account]").forEach(button => button.addEventListener("click", async () => {
      await openParticipantAccountSearch(button.dataset.loadParticipantAccount);
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
        ${entries.flatMap(details => {
          const verification = details.verification;
          const participants = details.participants?.length
            ? details.participants
            : [{
                id: "legacy",
                character_name: verification.target_character || "—",
                started_at: verification.started_at,
                start_map_name: verification.start_map_name,
                resolved_at: verification.ended_at
              }];
          return participants.map((participant, participantIndex) => {
            const journalId = `${verification.id}:${participant.id || participantIndex}`;
            const startedAt = participantStartedAt(participant, verification);
            const endedAt = participant.resolved_at
              || (verification.status === "ACTIVE" ? "" : verification.ended_at || "");
            const duration = formatDuration(
              Math.max(0, new Date(endedAt || Date.now()).getTime() - new Date(startedAt).getTime())
            );
            const participantEvents = (details.events || []).filter(event =>
              eventBelongsToParticipant(event, participant, participants.length)
            );
            const isActive = verification.status === "ACTIVE" && !participant.resolved_at;
            return `
            <details data-journal-id="${escapeAttribute(journalId)}">
              <summary>
                <strong>#${escapeMarkup(verification.public_number || verification.id)} · ${escapeMarkup(participant.character_name || "—")}</strong>
                <span>${escapeMarkup(participantStartMap(participant, verification))}</span>
                <span data-journal-duration data-started-at="${escapeAttribute(startedAt)}" data-ended-at="${escapeAttribute(endedAt)}">${duration}</span>
                <b>${isActive ? "AKTYWNA" : "ZAKOŃCZONA"}</b>
              </summary>
              <div class="mc-timeline-events" data-journal-events="${escapeAttribute(journalId)}">${participantEvents.map(event => `
                <article>
                  <div><strong>${escapeMarkup(eventTitle(event))}</strong><time>${formatDate(event.occurred_at)}</time></div>
                  ${eventDescription(event) ? `<p>${escapeMarkup(eventDescription(event))}</p>` : ""}
                  <small>${escapeMarkup([event.details?.channel, event.map_name].filter(Boolean).join(" · "))}</small>
                </article>`).join("") || "<p>Brak zdarzeń.</p>"}</div>
            </details>`;
          });
        }).join("")}
      </div>`;
  }

  function eventBelongsToParticipant(event, participant, participantCount) {
    const participantId = String(participant?.id || "");
    const eventParticipantId = String(event?.participant_id || "");
    if (eventParticipantId) return Boolean(participantId) && eventParticipantId === participantId;
    const eventNames = [
      event?.details?.targetCharacter,
      event?.details?.characterName,
      event?.details?.target_character
    ].filter(Boolean);
    if (eventNames.length) {
      return eventNames.some(name => sameNick(name, participant?.character_name));
    }
    return participantCount === 1;
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
        item.verification_code
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
    if (!isLikelyPlayerNick(nick)) return notice("Nie udało się bezpiecznie rozpoznać nicku wskazanego gracza.");
    if (!moderator) return notice("Klient gry nie udostępnił danych aktualnej postaci.");
    if (state.active?.verification?.status === "ACTIVE") return addParticipant(player);
    const code = generateCode();
    if (state.panel) state.panel.querySelector("[data-code]").value = code;
    const map = currentMap();
    const accountId = player?.accountId || resolvePlayerAccountId(nick, player?.id);
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
        targetAccountId: accountId,
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
      selectPlayers([{ nick, id: player.id || resolvePlayerId(nick) || "" }]);
      // Otwarte Centrum Moderacji pozostaje widoczne. Użytkownik może pracować
      // równolegle w głównym panelu oraz w kompaktowym oknie aktywnej sesji.
      if (state.panel) renderActiveSections();
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
    if (!isLikelyPlayerNick(nick)) return notice("Nie udało się bezpiecznie rozpoznać nicku gracza.");
    if ((state.active?.participants || []).some(item => !item.resolved_at && sameNick(item.character_name, nick))) {
      return notice("Ten gracz jest już w aktywnej weryfikacji.");
    }
    const map = currentMap();
    const accountId = player?.accountId || resolvePlayerAccountId(nick, player?.id);
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
          character_id: player.id || resolvePlayerId(nick) || null,
          account_id: accountId || null,
          joined_at: joinedAt,
          started_at: joinedAt,
          verification_code: code,
          start_map_id: map.id,
          start_map_name: map.name,
          resolved_at: null
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
      selectPlayers([{ nick, id: player.id || "" }]);
      renderActiveSections();
      notice(`Dodano ${nick} do aktywnej weryfikacji. Kod gracza: ${code}.`);
    } catch (error) {
      const label = error.message === "PARTICIPANT_ALREADY_ADDED" ? "Ten gracz jest już w aktywnej weryfikacji." : error.message;
      notice(`Nie udało się dodać gracza (${label}).`);
    }
  }

  async function openParticipantAccountSearch(participantId) {
    const verification = state.active?.verification;
    const participant = (state.active?.participants || []).find(item =>
      String(item.id) === String(participantId)
    );
    if (!verification || verification.status !== "ACTIVE" || !participant) {
      notice("Nie znaleziono uczestnika aktywnej weryfikacji.");
      return;
    }
    const accountId = profileAccountId(participant.account_id);
    if (!accountId) {
      notice(`Sesja gracza ${participant.character_name} nie zawiera zapisanego ID konta. Funkcja będzie dostępna dla nowo rozpoczętych sesji.`);
      return;
    }
    if (!state.panel) showPanel();
    const input = state.panel?.querySelector("[data-search]");
    const panelWindow = state.panel?.querySelector(".mc-window");
    if (!input) {
      notice("Nie udało się otworzyć wyszukiwarki konta.");
      return;
    }
    input.value = accountId;
    panelWindow?.scrollTo({ top: 0, behavior: "smooth" });
    await detectAccountCharacters(accountId);
    state.panel?.querySelector("[data-search-results]")?.scrollIntoView({ block: "nearest" });
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
      const commandTemplate = readStartConfig().sendCode;
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
      sendNick: { label: "WYŚLIJ NICK" },
      sendScreen: { label: "WYŚLIJ SCREEN" }
    };
    const definition = definitions[commandKey];
    if (!definition) return notice("Nieznany typ polecenia.");
    const template = readStartConfig()[commandKey];
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
    const finishTemplate = readStartConfig().finish;
    const localMessage = resolveTemplate(finishTemplate, {
      nick: participant.character_name,
      moderator: getCurrentCharacterNick(),
    }).content.trim();
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
      const announced = localMessage ? await sendLocalChatMessage(localMessage) : true;
      selectPlayers(selectedPlayers().filter(item => !sameNick(item.nick, participant.character_name)));
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

  async function finishAllParticipantVerifications() {
    const verification = state.active?.verification;
    if (!verification || verification.status !== "ACTIVE") return notice("Brak aktywnej weryfikacji.");
    const participants = (state.active.participants || []).filter(item => !item.resolved_at);
    if (!participants.length) return notice("Brak aktywnych uczestników.");
    if (!confirm(`Zakończyć weryfikację wszystkich aktywnych graczy (${participants.length})?`)) return;

    const finishTemplate = readStartConfig().finish;
    const moderator = getCurrentCharacterNick();
    const map = currentMap();
    const announcements = participants.map(participant => ({
      participant,
      content: resolveTemplate(finishTemplate, {
        nick: participant.character_name,
        moderator
      }).content.trim()
    }));
    try {
      state.active = mutateLocalVerification(verification.id, (record, database) => {
        const endedAt = new Date().toISOString();
        for (const { participant, content } of announcements) {
          const stored = (record.participants || []).find(item =>
            String(item.id) === String(participant.id) && !item.resolved_at
          );
          if (!stored) continue;
          stored.resolved_at = endedAt;
          addLocalEvent(database, record, {
            title: `Zakończono weryfikację gracza ${stored.character_name}`,
            eventType: "PARTICIPANT_FINISHED",
            details: {
              characterName: stored.character_name,
              announcement: content,
              moderator
            },
            mapId: map.id,
            mapName: map.name,
            participantId: stored.id
          });
        }
        record.verification.status = "COMPLETED";
        record.verification.ended_at = endedAt;
        record.verification.updated_at = endedAt;
        addLocalEvent(database, record, {
          title: "Zakończono całą weryfikację grupową",
          eventType: "VERIFICATION_FINISHED",
          details: {
            moderator,
            participants: participants.map(item => item.character_name)
          },
          mapId: map.id,
          mapName: map.name
        });
      });

      let failedAnnouncements = 0;
      for (const announcement of announcements) {
        if (announcement.content && !await sendLocalChatMessage(announcement.content)) {
          failedAnnouncements += 1;
        }
      }
      selectPlayers([]);
      closeActivePanel();
      refreshActive();
      notice(failedAnnouncements
        ? `Zakończono weryfikację wszystkich graczy. Nie wysłano ${failedAnnouncements} komunikatów lokalnych.`
        : `Zakończono weryfikację wszystkich graczy (${participants.length}).`);
    } catch (error) {
      notice(`Nie udało się zakończyć weryfikacji grupowej (${error.message}).`);
    }
  }

  function startNativePlayerMenuIntegration() {
    installNativePlayerMenuHook();
    clearInterval(state.nativeMenuHookTimer);
    state.nativeMenuHookTimer = setInterval(installNativePlayerMenuHook, 1000);
  }

  function installNativePlayerMenuHook() {
    const others = getEngine()?.others;
    const current = others?.addMcPanelToMenu;
    if (!others || typeof current !== "function") return false;
    if (current[NATIVE_MENU_HOOK_MARK]) return true;

    const original = current;
    const wrapped = function(playerId, playerNick, menu, ...rest) {
      const result = original.apply(this, [playerId, playerNick, menu, ...rest]);
      appendNativeVerificationAction(menu, playerId, playerNick);
      return result;
    };
    Object.defineProperty(wrapped, NATIVE_MENU_HOOK_MARK, {
      value: true,
      configurable: false,
      enumerable: false,
      writable: false
    });
    Object.defineProperty(wrapped, "originalFunction", {
      value: original,
      configurable: false,
      enumerable: false,
      writable: false
    });

    try {
      others.addMcPanelToMenu = wrapped;
      return others.addMcPanelToMenu === wrapped;
    } catch {
      return false;
    }
  }

  function appendNativeVerificationAction(menu, playerId, playerNick) {
    if (!Array.isArray(menu)) return;
    const player = nativeMenuPlayer(playerId, playerNick);
    if (!player.nick || sameNick(player.nick, getCurrentCharacterNick())) return;

    const active = state.active?.verification?.status === "ACTIVE";
    const label = active ? "Dodaj do aktywnej weryfikacji" : "Rozpocznij weryfikację";
    if (menu.some(entry => Array.isArray(entry) && normalize(entry[0]) === label)) return;

    menu.push([label, () => {
      const currentPlayer = nativeMenuPlayer(player.id, player.nick);
      if (!currentPlayer.nick) {
        notice("Nie udało się odczytać danych wybranej postaci.");
        return;
      }
      const hasActiveVerification = state.active?.verification?.status === "ACTIVE";
      if (hasActiveVerification) addParticipant(currentPlayer);
      else startVerification(currentPlayer);
    }]);
  }

  function nativeMenuPlayer(playerId, playerNick) {
    const id = String(playerId ?? "");
    const nick = normalize(playerNick);
    const visiblePlayer = readPlayersOnCurrentMap().find(player =>
      (id && String(player.id) === id) ||
      (nick && sameNick(player.nick, nick))
    );
    const resolvedNick = normalize(visiblePlayer?.nick || nick);
    return {
      nick: isLikelyPlayerNick(resolvedNick) ? resolvedNick : "",
      id: visiblePlayer?.id || id || null,
      accountId: visiblePlayer?.accountId || null,
      x: visiblePlayer?.x ?? null,
      y: visiblePlayer?.y ?? null
    };
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

  function resolvePlayerAccountId(nick, characterId = null) {
    const player = readPlayersOnCurrentMap().find(item =>
      (characterId && String(item.id) === String(characterId)) ||
      sameNick(item.nick, nick)
    );
    return player?.accountId || null;
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
      #${SCRIPT_ID}-panel *{box-sizing:border-box}#${SCRIPT_ID}-panel .mc-window{position:absolute;right:70px;top:45px;width:min(455px,calc(100vw - 24px));height:auto;max-height:calc(100vh - 57px);overflow-x:hidden;overflow-y:auto;padding:10px;border:1px solid #66562c;border-radius:5px;background:rgba(28,26,21,.97);box-shadow:0 14px 42px #000c;pointer-events:auto;scrollbar-width:thin;scrollbar-color:#35556d #07131d}
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
      #${SCRIPT_ID}-panel .mc-search-results{display:grid;margin-top:6px;border:1px solid #4c4023}#${SCRIPT_ID}-panel .mc-search-results:empty{display:none}#${SCRIPT_ID}-panel .mc-character{display:grid;grid-template-columns:minmax(64px,92px) minmax(0,1fr);align-items:center;gap:4px;padding:6px;border-bottom:1px solid #4c4023}#${SCRIPT_ID}-panel .mc-character>span{display:grid;gap:1px;min-width:0;overflow:hidden}#${SCRIPT_ID}-panel .mc-character>span strong{overflow:hidden;font-size:10px;line-height:1.12;text-overflow:ellipsis;white-space:nowrap}#${SCRIPT_ID}-panel .mc-character>span small{font-size:9px;line-height:1.1}
      #${SCRIPT_ID}-panel .mc-character-actions{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));min-width:0;gap:3px;white-space:nowrap}#${SCRIPT_ID}-panel .mc-character-actions button{width:100%;min-width:0;padding:3px 2px;overflow:hidden;font-size:clamp(7.5px,1.55vw,9px);line-height:1.15;text-overflow:ellipsis;white-space:nowrap}
      #${SCRIPT_ID}-panel .mc-account-result-head{padding:7px;border-bottom:1px solid #4c4023;color:#aebdca;font-size:10px;line-height:1.35}
      #${SCRIPT_ID}-panel .mc-account-character-list{display:grid}
      #${SCRIPT_ID}-panel .mc-account-character{display:grid;grid-template-columns:auto minmax(0,1fr);align-items:center;gap:8px;padding:6px 7px;border-bottom:1px solid #4c4023;cursor:pointer}
      #${SCRIPT_ID}-panel .mc-account-character:hover{background:#132536}
      #${SCRIPT_ID}-panel .mc-account-character input{width:auto;margin:0;accent-color:#61cbd0}
      #${SCRIPT_ID}-panel .mc-account-character span{display:grid;gap:2px;min-width:0}
      #${SCRIPT_ID}-panel .mc-account-character strong{overflow:hidden;color:#dce8f2;font-size:11px;text-overflow:ellipsis;white-space:nowrap}
      #${SCRIPT_ID}-panel .mc-account-character small{color:#8ea5b5;font-size:9px}
      #${SCRIPT_ID}-panel .mc-account-batch{display:grid;grid-template-columns:1fr 1fr;gap:6px;padding:7px;background:#091620}
      #${SCRIPT_ID}-panel .mc-account-batch[hidden]{display:none!important}
      #${SCRIPT_ID}-panel .mc-account-batch span{grid-column:1/-1;color:#9fb5c4;font-size:10px}
      #${SCRIPT_ID}-panel .mc-account-batch button{width:100%;min-width:0;padding:6px 4px;font-size:9px;line-height:1.2}
      #${SCRIPT_ID}-panel .mc-ready-editor{display:grid;grid-template-columns:minmax(0,1fr) 92px auto auto;gap:6px;margin:8px 0}#${SCRIPT_ID}-panel .mc-ready-editor textarea{grid-column:1/-1;min-height:37px}#${SCRIPT_ID}-panel .mc-ready-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;padding:8px;border-top:1px solid #4c4023}
      #${SCRIPT_ID}-panel .mc-ready-row div{display:grid;grid-template-columns:auto auto;gap:4px 8px}#${SCRIPT_ID}-panel .mc-ready-row code{grid-column:1/-1;overflow:hidden;color:#bfcf81;text-overflow:ellipsis;white-space:nowrap}#${SCRIPT_ID}-panel .mc-ready-row small{color:#e2b841}
      #${SCRIPT_ID}-panel .mc-active-line{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:8px;padding:8px;background:#11120f}#${SCRIPT_ID}-panel .mc-active-line strong{flex:1}#${SCRIPT_ID}-panel .mc-active-details[hidden]{display:none}
      #${SCRIPT_ID}-panel .mc-session-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:5px;margin-top:8px}#${SCRIPT_ID}-panel .mc-session-grid article{display:grid;gap:3px;padding:7px;border:1px solid #4a3e20;background:#12130f}#${SCRIPT_ID}-panel .mc-session-grid small{color:#9f987e;font-size:9px}
      #${SCRIPT_ID}-panel .mc-participants,#${SCRIPT_ID}-panel .mc-map-players{margin-top:8px;padding:8px;border:1px solid #4a3e20}#${SCRIPT_ID}-panel .mc-participant{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:7px 0;border-top:1px solid #3d351f}#${SCRIPT_ID}-panel .mc-participant div{display:grid}#${SCRIPT_ID}-panel .mc-participant small{color:#9d957b}
      #${SCRIPT_ID}-panel .mc-map-players div{display:flex;flex-wrap:wrap;gap:5px}#${SCRIPT_ID}-panel .mc-timeline-head{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px;padding:7px;border:1px solid #4b4022}#${SCRIPT_ID}-panel .mc-timeline-head strong{flex:1}#${SCRIPT_ID}-panel .mc-timeline-head b{color:#84b849}
      #${SCRIPT_ID}-panel .mc-journal-toolbar{display:flex;align-items:center;justify-content:flex-end;gap:10px;margin:8px 0 2px;padding:7px;border:1px solid #44391f;background:#17150f}#${SCRIPT_ID}-panel .mc-timeline-events{max-height:none;overflow:visible}#${SCRIPT_ID}-panel details[data-journal-id]:not([open])>.mc-timeline-events{display:none!important}#${SCRIPT_ID}-panel .mc-timeline-events article{padding:7px;border-bottom:1px solid #44391f}#${SCRIPT_ID}-panel .mc-timeline-events article div{display:flex;justify-content:space-between;gap:8px}#${SCRIPT_ID}-panel .mc-timeline-events p{margin:4px 0;color:#ddd0aa}#${SCRIPT_ID}-panel .mc-timeline-events small,#${SCRIPT_ID}-panel time{color:#948d78}
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
      #${SCRIPT_ID}-panel .mc-search-results,#${SCRIPT_ID}-panel .mc-character,#${SCRIPT_ID}-panel .mc-account-result-head,#${SCRIPT_ID}-panel .mc-account-character,#${SCRIPT_ID}-panel .mc-ready-row,#${SCRIPT_ID}-panel .mc-participant,#${SCRIPT_ID}-panel .mc-timeline-events article{border-color:#263f52}
      #${SCRIPT_ID}-panel .mc-ready-row code{color:#75dce0}
      #${SCRIPT_ID}-panel .mc-ready-row small,#${SCRIPT_ID}-panel .mc-timeline-head b{color:#68ded9}
      #${SCRIPT_ID}-panel .mc-session-grid small,#${SCRIPT_ID}-panel .mc-participant small,#${SCRIPT_ID}-panel .mc-timeline-events small,#${SCRIPT_ID}-panel time{color:#8ea5b5}
      #${SCRIPT_ID}-panel .mc-participants,#${SCRIPT_ID}-panel .mc-map-players,#${SCRIPT_ID}-panel .mc-timeline-head,#${SCRIPT_ID}-panel .mc-journal-toolbar{border-color:#29465b}#${SCRIPT_ID}-panel .mc-journal-toolbar{background:#091620}
      #${SCRIPT_ID}-notice{border-color:#2d6079;background:#0b1b28;color:#dce8f2}
      #${SCRIPT_ID}-active-panel{position:fixed;inset:0;z-index:2147483001;overflow:visible!important;pointer-events:none;color:#dce8f2;font:12px Arial,sans-serif}
      #${SCRIPT_ID}-active-panel *{box-sizing:border-box}#${SCRIPT_ID}-active-panel .mc-active-window{position:absolute;left:calc(50% - 360px);top:24px;bottom:auto!important;display:block;width:min(720px,calc(100vw - 24px));height:auto!important;min-height:0!important;max-height:calc(100vh - 48px)!important;max-block-size:calc(100vh - 48px)!important;overflow-x:hidden!important;overflow-y:auto!important;padding:8px;border:1px solid #2b465c;border-radius:5px;background:rgba(8,18,28,.97);box-shadow:0 14px 42px #000d;pointer-events:auto;scrollbar-width:thin;scrollbar-color:#35556d #07131d}
      #${SCRIPT_ID}-active-panel [data-active-panel-body],#${SCRIPT_ID}-active-panel .mc-participants,#${SCRIPT_ID}-active-panel .mc-map-players,#${SCRIPT_ID}-active-panel .mc-participant-session{position:static;height:auto!important;min-height:0!important;max-height:none!important;max-block-size:none!important;overflow:visible!important}
      #${SCRIPT_ID}-active-panel .mc-active-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;padding-bottom:9px;border-bottom:1px solid #29445a;cursor:move;user-select:none;touch-action:none}
      #${SCRIPT_ID}-active-panel .mc-active-head small,#${SCRIPT_ID}-active-panel h3,#${SCRIPT_ID}-active-panel h4{color:#68ded9}#${SCRIPT_ID}-active-panel h3{margin:3px 0 0;font-size:18px}#${SCRIPT_ID}-active-panel .mc-active-head button{border:0;background:none;color:#dce8f2;font-size:18px;cursor:pointer}
      #${SCRIPT_ID}-active-panel button{padding:7px 10px;border:1px solid #35556d;border-radius:3px;background:#16283a;color:#dce8f2;font:bold 12px Arial;cursor:pointer}#${SCRIPT_ID}-active-panel button:hover{border-color:#61cbd0;background:#1d3850}#${SCRIPT_ID}-active-panel button.danger{border-color:#784451;background:#45242e;color:#ff9ba8}
      #${SCRIPT_ID}-active-panel .mc-session-grid{display:grid;grid-template-columns:1.35fr 1.35fr 1.3fr .7fr .9fr;gap:4px;margin-top:6px}#${SCRIPT_ID}-active-panel .mc-session-grid article{display:grid;align-content:center;gap:2px;min-height:42px;padding:5px 6px;border:1px solid #29465b;background:#07131d}#${SCRIPT_ID}-active-panel .mc-session-grid small{color:#8ea5b5;font-size:8px}#${SCRIPT_ID}-active-panel .mc-session-grid strong{font-size:11px;overflow-wrap:anywhere}
      #${SCRIPT_ID}-active-panel .mc-participants,#${SCRIPT_ID}-active-panel .mc-map-players{margin-top:6px;padding:6px;border:1px solid #29465b}
      #${SCRIPT_ID}-active-panel .mc-map-players>summary{display:flex;align-items:center;justify-content:space-between;gap:8px;color:#68ded9;font-weight:800;cursor:pointer;user-select:none;list-style:none}#${SCRIPT_ID}-active-panel .mc-map-players>summary::-webkit-details-marker{display:none}#${SCRIPT_ID}-active-panel .mc-map-players>summary b{min-width:18px;text-align:center;color:#dce8f2;font-size:16px}
      #${SCRIPT_ID}-active-panel .mc-participant-session{padding:6px 0;border-top:1px solid #263f52}
      #${SCRIPT_ID}-active-panel .mc-participant-session:first-of-type{border-top:0}
      #${SCRIPT_ID}-active-panel .mc-participant-session.resolved{opacity:.62}#${SCRIPT_ID}-active-panel .mc-participant-session.selected-target{outline:1px solid #61cbd0;outline-offset:-1px;background:#0b2130}
      #${SCRIPT_ID}-active-panel .mc-group-actions{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5px;margin:5px 0}#${SCRIPT_ID}-active-panel .mc-group-actions button{width:100%;min-width:0;padding:6px 3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      #${SCRIPT_ID}-active-panel .mc-participant-actions{display:flex;flex-wrap:nowrap;align-items:center;justify-content:flex-end;min-width:0;gap:4px;margin-top:5px}
      #${SCRIPT_ID}-active-panel .mc-participant-actions span{flex:0 1 92px;min-width:52px;overflow:hidden;color:#8ea5b5;font-size:10px;text-overflow:ellipsis;white-space:nowrap}#${SCRIPT_ID}-active-panel .mc-participant-actions button{flex:1 1 0;min-width:0;padding:6px 3px;overflow:hidden;font-size:clamp(8px,1.15vw,11px);text-overflow:ellipsis;white-space:nowrap}
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

  function finiteOrNull(value) {
    return Number.isFinite(Number(value)) ? Number(value) : null;
  }

  function sameNick(a, b) {
    return normalize(a).toLocaleLowerCase("pl") === normalize(b).toLocaleLowerCase("pl");
  }

  function isLikelyPlayerNick(value) {
    const raw = String(value ?? "");
    if (!raw || /[\r\n\t]/.test(raw)) return false;
    const nick = normalize(raw);
    if (nick.length < 2 || nick.length > 40) return false;
    if (nick.split(" ").length > 5) return false;
    if (!/^[\p{L}\p{N}][\p{L}\p{N} ._'’\-]{1,39}$/u.test(nick)) return false;
    return !(
      /\[\d{1,2}:\d{2}\]/.test(nick) ||
      /\b(gracze na mapie|okno przegląd|wyloguj|dołączył|dołączyła|opuścił|opuściła|czat lokalny|czat globalny|klanowicz|weryfikacja testowa)\b/i.test(nick)
    );
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

  console.info("[Centrum Moderacji] v3.3.31 gotowe .");
})();
