// ==UserScript==
// @name         Margonem — Centrum Moderacji
// @namespace    https://github.com/Doiua97/panel-moderacji-weryfikacji
// @version      3.3.52
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
  window[RUNTIME_GUARD] = "3.3.52";

  const SCRIPT_ID = "margo-moderation-center";
  const LOCAL_DATABASE_KEY = `${SCRIPT_ID}:local-database:v1`;
  const LAUNCHER_POSITION_KEY = `${SCRIPT_ID}:launcher-position`;
  const PANEL_POSITION_KEY = `${SCRIPT_ID}:panel-position`;
  const PANEL_OPEN_KEY = `${SCRIPT_ID}:panel-open`;
  const ACTIVE_PANEL_POSITION_KEY = `${SCRIPT_ID}:active-panel-position`;
  const ACTIVE_PANEL_OPEN_KEY = `${SCRIPT_ID}:active-panel-open`;
  const ACTIVE_MAP_PLAYERS_COLLAPSED_KEY = `${SCRIPT_ID}:active-map-players-collapsed`;
  const START_CONFIG_KEY = `${SCRIPT_ID}:start-config`;
  const DEFAULT_CONFIGURATION_MIGRATION_KEY = `${SCRIPT_ID}:default-configuration:2026-08-24-v2`;
  const WIDGET_KEY = "MARGO_MODERATION_CENTER";
  const NATIVE_MENU_HOOK_MARK = "__margoModerationCenterPlayerMenuHook__";
  const MAP_HOOK_MARK = "__margoModerationCenterMapHook__";
  const DATE_FORMATTER = new Intl.DateTimeFormat("pl-PL", { dateStyle: "short", timeStyle: "medium" });
  const DEFAULT_START_CONFIG = {
    local: "Witam, rozpoczynam weryfikację gracza: {nick}.",
    startDelaySeconds: 0,
    console: '.reminder "{nick}" "Rozpoczynam weryfikację. Polecenie weryfikacyjne: Proszę o przesłanie linku do zrzutu ekranu z widocznym oknem gry oraz otwartym poleceniem na moją aktualną Postać poprzez Czat prywatny w Grze."',
    sendCode: '.reminder "{nick}" "Polecenie weryfikacyjne: Proszę o wiadomość zawierającą kod: {kod} na moją aktualną Postać poprzez Czat prywatny w Grze."',
    sendNick: '.reminder "{nick}" "Polecenie weryfikacyjne: Proszę o przesłanie swojego nicku z gry na moją aktualną Postać poprzez Czat prywatny w Grze."',
    sendScreen: '.reminder "{nick}" "Polecenie weryfikacyjne: Proszę o przesłanie linku do zrzutu ekranu z widocznym oknem gry oraz otwartym poleceniem na moją aktualną Postać poprzez Czat prywatny w Grze."',
    sendTrade: '.reminder "{nick}" "Polecenie weryfikacyjne: Proszę o podejście i rozpoczęcie handlu z moją Postacią w Grze."',
    sendAttack: '.reminder "{nick}" "Polecenie weryfikacyjne: Proszę o podejście i zaatakowanie najbliższego moba, lub grupę mobów."',
    sendReminder: '.reminder "{nick}" "Proszę o wykonanie polecenia weryfikacyjnego"',
    finish: "Weryfikacja Gracza {nick} zakończona."
  };
  const state = {
    selected: { nick: "", id: "" },
    selectedPlayers: [],
    active: null,
    accountGroups: [],
    mapPlayersCollapsed: false,
    ticker: 0,
    panel: null,
    panelMoveCleanup: null,
    activePanel: null,
    activePanelMoveCleanup: null,
    journal: []
  };
  const store = { database: null, config: null };
  const players = {
    byId: new Map(),
    byNick: new Map()
  };
  const runtime = {
    cleanup: [],
    renderFrame: 0,
    renderMain: false,
    renderActive: false,
    operations: new Set(),
    profileCache: new Map(),
    profileRequests: new Map(),
    confirm: null,
    initialized: false,
    dragFrame: 0
  };
  const game = {
    page() {
      return typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
    },
    engine() {
      const page = this.page();
      return typeof page.getEngine === "function" ? page.getEngine() : null;
    },
    api() {
      return this.page().API || null;
    },
    heroNick() {
      const hero = this.engine()?.hero;
      return normalize(hero?.getNick?.());
    },
    heroId() {
      const hero = this.engine()?.hero;
      return String(hero?.getId?.() ?? "") || null;
    },
    map() {
      const map = this.engine()?.map;
      return {
        id: String(map?.getId?.() ?? "") || null,
        name: normalize(map?.d?.name) || "Nieznana mapa"
      };
    },
    world() {
      const config = this.engine()?.worldConfig;
      return normalize(config?.getWorldName?.()).replace(/^#/, "") || "nieznany";
    },
    other(id) {
      const others = this.engine()?.others;
      return others?.check?.()?.[String(id)] || null;
    },
    others() {
      const others = this.engine()?.others;
      return typeof others?.check === "function" ? others.check() : {};
    },
    sendCommand(command) {
      const line = this.engine()?.console?.commandLine;
      if (typeof line?.sendMessage !== "function") return false;
      line.sendMessage(command);
      return true;
    },
    sendLocal(message) {
      const chat = this.engine()?.chatController;
      const wrapper = chat?.getChatInputWrapper?.();
      const available = chat?.getChatChannelsAvailable?.();
      if (typeof wrapper?.sendMessageGhostMessageProcedure !== "function") return false;
      if (typeof available?.checkAvailableProcedure === "function" && !available.checkAvailableProcedure("LOCAL")) return false;
      wrapper.sendMessageGhostMessageProcedure(message, "LOCAL");
      return true;
    }
  };

  waitForGame();

  function waitForGame() {
    const ready = () => {
      const engine = game.engine();
      return Boolean(engine?.hero && engine?.allInit && typeof game.api()?.addCallbackToEvent === "function");
    };
    const start = () => {
      if (runtime.initialized) return;
      runtime.initialized = true;
      migrateConfig();
      store.database = readDatabase(true);
      store.config = readConfig(true);
      state.mapPlayersCollapsed = localStorage.getItem(ACTIVE_MAP_PLAYERS_COLLAPSED_KEY) === "1";
      addStyles();
      bindGameEvents();
      createNativeWidget().then(created => {
        if (!created) createLauncher();
      });
      hookPlayerMenu();
      startSync();
      window.addEventListener("beforeunload", dispose, { once: true });
      if (localStorage.getItem(PANEL_OPEN_KEY) === "1") showPanel();
    };
    if (ready()) return start();
    let timeout = 0;
    const observer = new MutationObserver(() => {
      if (!ready()) return;
      observer.disconnect();
      clearTimeout(timeout);
      start();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    timeout = setTimeout(() => observer.disconnect(), 30000);
    runtime.cleanup.push(() => {
      clearTimeout(timeout);
      observer.disconnect();
    });
  }

  async function waitUntil(predicate, interval = 50, attempts = 300) {
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        if (predicate()) return true;
      } catch {}
      await wait(interval);
    }
    return false;
  }

  async function createNativeWidget() {
    try {
      const engine = game.engine();
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
      return true;
    } catch (error) {
      console.warn("[Centrum Moderacji] Nie udało się utworzyć natywnego widżetu:", error);
      return false;
    }
  }

  function createLauncher() {
    if (document.getElementById(`${SCRIPT_ID}-launcher`)) return;
    const launcher = document.createElement("button");
    launcher.id = `${SCRIPT_ID}-launcher`;
    launcher.type = "button";
    launcher.innerHTML = `<strong>C</strong>`;
    launcher.setAttribute("aria-label", "Otwórz lub zamknij Centrum Moderacji");
    document.body.appendChild(launcher);
    restorePosition(launcher, LAUNCHER_POSITION_KEY);
    const cleanup = makeMovable(launcher, {
      positionKey: LAUNCHER_POSITION_KEY,
      handle: launcher,
      click: () => {
        state.panel ? closePanel() : showPanel();
      }
    });
    runtime.cleanup.push(cleanup);
  }

  function startSync() {
    refreshActive(store.database);
    clearInterval(state.ticker);
    state.ticker = setInterval(updateTimers, 1000);
    const onStorage = event => {
      if (event.key === LOCAL_DATABASE_KEY) refreshActive(readDatabase(true, event.newValue));
      if (event.key === START_CONFIG_KEY) store.config = readConfig(true, event.newValue);
    };
    window.addEventListener("storage", onStorage);
    runtime.cleanup.push(() => {
      clearInterval(state.ticker);
      window.removeEventListener("storage", onStorage);
    });
  }

  function refreshActive(database = readDatabase()) {
    const details = getActiveVerification(database);
    state.active = details;
    state.journal = getJournal(20, database);
    scheduleRender({ main: true, active: true });
    if (details?.verification?.status === "ACTIVE" && localStorage.getItem(ACTIVE_PANEL_OPEN_KEY) === "1") {
      showActive();
    }
    return details;
  }

  function scheduleRender({ main = false, active = false } = {}) {
    runtime.renderMain ||= main;
    runtime.renderActive ||= active;
    if (runtime.renderFrame) return;
    runtime.renderFrame = requestAnimationFrame(() => {
      runtime.renderFrame = 0;
      const renderMainNow = runtime.renderMain;
      const renderActiveNow = runtime.renderActive;
      runtime.renderMain = false;
      runtime.renderActive = false;
      if (renderMainNow) renderActiveSections();
      if (renderActiveNow) renderActive();
    });
  }

  function migrateConfig() {
    if (localStorage.getItem(DEFAULT_CONFIGURATION_MIGRATION_KEY) === "1") return;
    localStorage.setItem(START_CONFIG_KEY, JSON.stringify(DEFAULT_START_CONFIG));
    localStorage.setItem(DEFAULT_CONFIGURATION_MIGRATION_KEY, "1");
  }

  function emptyDatabase() {
    return {
      version: 2,
      nextVerificationId: 1,
      nextParticipantId: 1,
      nextEventId: 1,
      verifications: []
    };
  }

  function readDatabase(force = false, serialized = null) {
    if (!force && store.database) return store.database;
    try {
      const parsed = JSON.parse(serialized ?? localStorage.getItem(LOCAL_DATABASE_KEY) ?? "null");
      if (!parsed || !Array.isArray(parsed.verifications)) {
        store.database = emptyDatabase();
        return store.database;
      }
      const database = {
        ...emptyDatabase(),
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
      store.database = database;
      return database;
    } catch {
      store.database = emptyDatabase();
      return store.database;
    }
  }

  function writeDatabase(database) {
    store.database = database;
    localStorage.setItem(LOCAL_DATABASE_KEY, JSON.stringify(database));
    refreshActive(database);
  }

  function cloneValue(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function verificationDetails(record) {
    if (!record) return null;
    return {
      verification: { ...record.verification },
      participants: (record.participants || []).map(participant => ({ ...participant })),
      events: (record.events || []).filter(event =>
        event?.event_type !== "PARTICIPANT_LEFT_MAP" &&
        event?.event_type !== "PARTICIPANT_RETURNED"
      ).map(event => ({ ...event, details: cloneValue(event.details || {}) }))
    };
  }

  function findVerification(database, verificationId) {
    return database.verifications.find(record =>
      String(record?.verification?.id || "") === String(verificationId || "")
    ) || null;
  }

  function addEvent(database, record, event) {
    const now = new Date().toISOString();
    const created = {
      id: String(database.nextEventId++),
      title: event.title || event.eventType || "Zdarzenie",
      event_type: event.eventType || "NOTE",
      details: cloneValue(event.details || {}),
      map_id: event.mapId ?? null,
      map_name: event.mapName || null,
      participant_id: event.participantId ?? null,
      occurred_at: event.occurredAt || now
    };
    record.events ||= [];
    record.events.push(created);
    return created;
  }

  function updateVerification(verificationId, change) {
    const database = readDatabase();
    const record = findVerification(database, verificationId);
    if (!record) return null;
    change(record, database);
    writeDatabase(database);
    return verificationDetails(record);
  }

  function getActiveVerification(database = readDatabase()) {
    const world = normalizeWorld(game.world());
    const record = [...database.verifications].reverse().find(item =>
      item?.verification?.status === "ACTIVE" &&
      normalizeWorld(item.verification.world) === world
    );
    return verificationDetails(record);
  }

  function getJournal(limit = 20, database = readDatabase()) {
    const world = normalizeWorld(game.world());
    return database.verifications
      .filter(record => normalizeWorld(record?.verification?.world) === world)
      .slice(-limit)
      .reverse()
      .map(verificationDetails);
  }

  function createVerification(data) {
    const database = readDatabase();
    const world = normalizeWorld(data.world);
    const existing = database.verifications.find(record =>
      record?.verification?.status === "ACTIVE" &&
      normalizeWorld(record.verification.world) === world
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
    addEvent(database, record, {
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
    addEvent(database, record, {
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
    writeDatabase(database);
    return verificationDetails(record);
  }

  function normalizeConfig(value = {}) {
    const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    return {
      local: typeof source.local === "string" ? source.local : DEFAULT_START_CONFIG.local,
      startDelaySeconds: Math.max(0, Number.isFinite(Number(source.startDelaySeconds)) ? Number(source.startDelaySeconds) : DEFAULT_START_CONFIG.startDelaySeconds),
      console: typeof source.console === "string" ? source.console : DEFAULT_START_CONFIG.console,
      sendCode: typeof source.sendCode === "string" ? source.sendCode : DEFAULT_START_CONFIG.sendCode,
      sendNick: typeof source.sendNick === "string" ? source.sendNick : DEFAULT_START_CONFIG.sendNick,
      sendScreen: typeof source.sendScreen === "string" ? source.sendScreen : DEFAULT_START_CONFIG.sendScreen,
      sendTrade: typeof source.sendTrade === "string" ? source.sendTrade : DEFAULT_START_CONFIG.sendTrade,
      sendAttack: typeof source.sendAttack === "string" ? source.sendAttack : DEFAULT_START_CONFIG.sendAttack,
      sendReminder: typeof source.sendReminder === "string" ? source.sendReminder : DEFAULT_START_CONFIG.sendReminder,
      finish: typeof source.finish === "string" ? source.finish : DEFAULT_START_CONFIG.finish
    };
  }

  function readConfig(force = false, serialized = null) {
    if (!force && store.config) return store.config;
    try {
      store.config = normalizeConfig(JSON.parse(serialized ?? localStorage.getItem(START_CONFIG_KEY) ?? "{}"));
    } catch {
      store.config = normalizeConfig();
    }
    return store.config;
  }

  function writeConfig(value) {
    store.config = normalizeConfig(value);
    localStorage.setItem(START_CONFIG_KEY, JSON.stringify(store.config));
    return store.config;
  }

  function collectConfig(root) {
    if (!root) return readConfig();
    return {
      local: root.querySelector("[data-start-local]")?.value.trim() ?? "",
      startDelaySeconds: Number(root.querySelector("[data-start-delay]")?.value || 0),
      console: root.querySelector("[data-start-console]")?.value.trim() ?? "",
      sendCode: root.querySelector("[data-send-code-command]")?.value.trim() ?? "",
      sendNick: root.querySelector("[data-send-nick-command]")?.value.trim() ?? "",
      sendScreen: root.querySelector("[data-send-screen-command]")?.value.trim() ?? "",
      sendTrade: root.querySelector("[data-send-trade-command]")?.value.trim() ?? "",
      sendAttack: root.querySelector("[data-send-attack-command]")?.value.trim() ?? "",
      sendReminder: root.querySelector("[data-send-reminder-command]")?.value.trim() ?? "",
      finish: root.querySelector("[data-finish-local]")?.value.trim() ?? ""
    };
  }

  function saveConfig(root, showNotice = false) {
    if (!root?.isConnected) return false;
    try {
      const expected = normalizeConfig(collectConfig(root));
      const saved = writeConfig(expected);
      const fields = {
        local: "[data-start-local]",
        startDelaySeconds: "[data-start-delay]",
        console: "[data-start-console]",
        sendCode: "[data-send-code-command]",
        sendNick: "[data-send-nick-command]",
        sendScreen: "[data-send-screen-command]",
        sendTrade: "[data-send-trade-command]",
        sendAttack: "[data-send-attack-command]",
        sendReminder: "[data-send-reminder-command]",
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

  function playerData(other) {
    try {
      if (!other || typeof other !== "object") return null;
      const data = other.d || other;
      const nick = normalize(data.nick || other.getNick?.());
      const id = String(data.id ?? other.getId?.() ?? "");
      if (!id || !isLikelyPlayerNick(nick)) return null;
      return {
        id,
        nick,
        accountId: getAccountId(other),
        level: finiteOrNull(data.lvl ?? data.level ?? other.getLvl?.()),
        x: finiteOrNull(data.x),
        y: finiteOrNull(data.y)
      };
    } catch (error) {
      console.warn("[Centrum Moderacji] Dane gracza:", error);
      return null;
    }
  }

  function cachePlayer(other) {
    const player = playerData(other);
    if (!player) return null;
    const previous = players.byId.get(player.id);
    if (previous) players.byNick.delete(normalizeNick(previous.nick));
    players.byId.set(player.id, player);
    players.byNick.set(normalizeNick(player.nick), player);
    return {
      player,
      changed: !previous || previous.nick !== player.nick || previous.accountId !== player.accountId || previous.level !== player.level
    };
  }

  function removeCachedPlayer(other) {
    const player = playerData(other);
    if (!player) return;
    players.byId.delete(player.id);
    players.byNick.delete(normalizeNick(player.nick));
    scheduleRender({ active: true });
  }

  function rebuildPlayerCache() {
    players.byId.clear();
    players.byNick.clear();
    for (const other of Object.values(game.others())) cachePlayer(other);
  }

  function bindGameEvents() {
    const api = game.api();
    const data = game.engine()?.apiData;
    if (typeof api?.addCallbackToEvent !== "function" || !data) {
      rebuildPlayerCache();
      console.warn("[Centrum Moderacji] Klient nie udostępnił API zdarzeń graczy.");
      return;
    }
    const onPlayer = other => {
      const update = cachePlayer(other);
      if (!update?.changed) return;
      scheduleRender({ active: true });
    };
    const onHero = () => {
      scheduleRender({ active: true });
    };
    const subscriptions = [
      [data.NEW_OTHER, onPlayer],
      [data.UPDATE_OTHER, onPlayer],
      [data.REMOVE_OTHER, removeCachedPlayer],
      [data.HERO_UPDATE, onHero]
    ];
    const installed = [];
    try {
      if (subscriptions.some(([event]) => !event)) throw new Error("brak wymaganego zdarzenia graczy");
      for (const subscription of subscriptions) {
        api.addCallbackToEvent(...subscription);
        installed.push(subscription);
      }
      runtime.cleanup.push(() => {
        for (const [event, callback] of installed) {
          try { api.removeCallbackFromEvent(event, callback); } catch {}
        }
      });
    } catch (error) {
      for (const [event, callback] of installed.reverse()) {
        try { api.removeCallbackFromEvent(event, callback); } catch {}
      }
      installed.length = 0;
      rebuildPlayerCache();
      console.warn("[Centrum Moderacji] Nie udało się podłączyć zdarzeń graczy:", error);
    }
    try {
      hookMap();
    } catch (error) {
      console.warn("[Centrum Moderacji] Nie udało się podłączyć zmiany mapy:", error);
    }
  }

  function hookMap() {
    const map = game.engine()?.map;
    const current = map?.updateDATA;
    if (!map || typeof current !== "function" || current[MAP_HOOK_MARK]) return false;
    const wrapped = function(...args) {
      const result = current.apply(this, args);
      players.byId.clear();
      players.byNick.clear();
      scheduleRender({ active: true });
      return result;
    };
    Object.defineProperty(wrapped, MAP_HOOK_MARK, { value: true });
    map.updateDATA = wrapped;
    runtime.cleanup.push(() => {
      if (map.updateDATA === wrapped) map.updateDATA = current;
    });
    return true;
  }

  function hookPlayerMenu() {
    const others = game.engine()?.others;
    const current = others?.addMcPanelToMenu;
    if (!others || typeof current !== "function") return false;
    if (current[NATIVE_MENU_HOOK_MARK]) return true;

    const original = current;
    const wrapped = function(playerId, playerNick, menu, ...rest) {
      const result = original.apply(this, [playerId, playerNick, menu, ...rest]);
      addPlayerMenuActions(menu, playerId, playerNick);
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
      runtime.cleanup.push(() => {
        if (others.addMcPanelToMenu === wrapped) others.addMcPanelToMenu = original;
      });
      return others.addMcPanelToMenu === wrapped;
    } catch {
      return false;
    }
  }

  function addPlayerMenuActions(menu, playerId, playerNick) {
    if (!Array.isArray(menu)) return;
    const player = menuPlayer(playerId, playerNick);
    if (!player.nick || sameNick(player.nick, game.heroNick())) return;

    const copyIdLabel = "KOPIUJ ID";
    if (!menu.some(entry => Array.isArray(entry) && normalize(entry[0]) === copyIdLabel)) {
      menu.push([copyIdLabel, () => copyAccountId(player)]);
    }

    const active = state.active?.verification?.status === "ACTIVE";
    const label = active ? "Dodaj do aktywnej weryfikacji" : "Rozpocznij weryfikację";
    if (menu.some(entry => Array.isArray(entry) && normalize(entry[0]) === label)) return;

    menu.push([label, () => {
      const refreshedPlayer = menuPlayer(player.id, player.nick);
      const currentPlayer = {
        ...player,
        ...refreshedPlayer,
        accountId: refreshedPlayer.accountId || player.accountId || null
      };
      if (!currentPlayer.nick) {
        notice("Nie udało się odczytać danych wybranej postaci.");
        return;
      }
      const hasActiveVerification = state.active?.verification?.status === "ACTIVE";
      if (hasActiveVerification) addParticipant(currentPlayer);
      else startVerification(currentPlayer);
    }]);
  }

  async function copyAccountId(player) {
    const refreshedPlayer = menuPlayer(player?.id, player?.nick);
    const accountId = parseAccountId(
      refreshedPlayer.accountId || player?.accountId || getPlayerAccountId(refreshedPlayer.id || player?.id)
    );
    if (!accountId) {
      notice(`Nie udało się odczytać ID konta gracza ${player?.nick || "—"}.`);
      return false;
    }
    if (!state.panel) showPanel({
      nick: refreshedPlayer.nick || player?.nick,
      id: refreshedPlayer.id || player?.id
    });
    const input = state.panel?.querySelector("[data-search]");
    const panelWindow = state.panel?.querySelector(".mc-window");
    if (input) {
      input.value = accountId;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.focus();
    }
    panelWindow?.scrollTo({ top: 0, behavior: "smooth" });
    try {
      await navigator.clipboard?.writeText?.(accountId);
    } catch {}
    notice(`ID konta ${accountId} gracza ${refreshedPlayer.nick || player?.nick} wpisano do Centrum Moderacji.`);
    return true;
  }

  function menuPlayer(playerId, playerNick) {
    const id = String(playerId ?? "");
    const nick = normalize(playerNick);
    return players.byId.get(id) || players.byNick.get(normalizeNick(nick)) || {
      nick: isLikelyPlayerNick(nick) ? nick : "",
      id: id || null,
      accountId: getPlayerAccountId(id),
      x: null,
      y: null
    };
  }

  function parseAccountId(value) {
    const text = String(value || "").trim();
    if (/^\d{3,12}$/.test(text)) return text;
    const profileMatch = text.match(/profile\/view,(\d{3,12})/i);
    if (profileMatch) return profileMatch[1];
    const legacyMatch = text.match(/[?&](?:id|user_id)=(\d{3,12})(?:&|$)/i);
    return legacyMatch ? legacyMatch[1] : "";
  }

  function parseAccountIds(value) {
    const seen = new Set();
    const accountIds = [];
    for (const entry of String(value || "").split(/[\s,;]+/)) {
      const accountId = parseAccountId(entry);
      if (!accountId || seen.has(accountId)) continue;
      seen.add(accountId);
      accountIds.push(accountId);
    }
    return accountIds;
  }

  async function loadAccountCharacters(id) {
    const world = game.world();
    try {
      const html = await fetchProfile(id);
      return excludeSelf(parseCharacters(html, world));
    } catch (error) {
      notice(`Nie udało się odczytać publicznego profilu konta ${id} (${error?.message || "błąd połączenia"}). Pokazano wyłącznie pasujące postacie aktualnie widoczne w kliencie.`);
      return excludeSelf(getVisibleAccountCharacters(id, world));
    }
  }

  async function loadAccounts(accountIds) {
    const ids = Array.isArray(accountIds) ? accountIds : [accountIds];
    const existing = new Set(state.accountGroups.map(group => group.accountId));
    const fetchButton = state.panel?.querySelector("[data-select-player]");
    if (fetchButton) {
      fetchButton.disabled = true;
      fetchButton.textContent = "Pobieranie…";
    }
    try {
      for (const value of ids) {
        const accountId = parseAccountId(value);
        if (!accountId || existing.has(accountId)) continue;
        existing.add(accountId);
        const characters = await loadAccountCharacters(accountId);
        state.accountGroups.push({ accountId, characters });
        selectPlayers([
          ...state.selectedPlayers,
          ...characters.map(character => ({
            nick: character.name,
            id: character.id || resolvePlayerId(character.name) || ""
          }))
        ], { renderActive: true });
      }
    } finally {
      if (fetchButton) {
        fetchButton.disabled = false;
        fetchButton.textContent = "Wykryj postacie";
      }
      renderAccountCharacters();
    }
  }

  function fetchProfile(accountId) {
    const key = String(accountId);
    const cached = runtime.profileCache.get(key);
    if (cached && Date.now() - cached.time < 300000) return Promise.resolve(cached.html);
    if (runtime.profileRequests.has(key)) return runtime.profileRequests.get(key);
    const languageDomain = location.hostname.endsWith(".com") ? "www.margonem.com" : "www.margonem.pl";
    const url = `https://${languageDomain}/profile/view,${encodeURIComponent(accountId)}`;
    const request = new Promise((resolve, reject) => {
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
        anonymous: true,
        timeout: 15000,
        onload: response => {
          if (response.status < 200 || response.status >= 400) {
            reject(new Error(`HTTP ${response.status || 0}`));
            return;
          }
          const returnedAccountId = parseAccountId(response.finalUrl || "");
          if (returnedAccountId && returnedAccountId !== String(accountId)) {
            reject(new Error("serwis zwrócił profil innego konta"));
            return;
          }
          if (!String(response.responseText || "").trim()) {
            reject(new Error("pusty profil"));
            return;
          }
          const html = response.responseText;
          runtime.profileCache.set(key, { html, time: Date.now() });
          resolve(html);
        },
        ontimeout: () => reject(new Error("przekroczono czas połączenia")),
        onerror: () => reject(new Error("błąd połączenia z profilem"))
      });
    });
    runtime.profileRequests.set(key, request);
    request.then(
      () => runtime.profileRequests.delete(key),
      () => runtime.profileRequests.delete(key)
    );
    return request;
  }

  function parseCharacters(html, requestedWorld) {
    const documentProfile = new DOMParser().parseFromString(String(html || ""), "text/html");
    const requested = normalizeWorld(requestedWorld);
    const characters = [...documentProfile.querySelectorAll(".char-row")].map(row => ({
      name: normalize(row.dataset.nick),
      id: normalize(row.dataset.id),
      level: normalize(row.dataset.lvl),
      world: normalize(row.dataset.world)
    }));

    const seen = new Set();
    return characters
      .filter(character => character.name && normalizeWorld(character.world) === requested)
      .filter(character => {
        const key = `${normalizeWorld(character.world)}\u0000${normalize(character.name).toLocaleLowerCase("pl")}`;
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

  function getVisibleAccountCharacters(accountId, world) {
    return excludeSelf(getMapPlayers()
      .filter(player => String(player.accountId || "") === String(accountId))
      .map(player => ({
        name: player.nick,
        id: player.id || null,
        level: player.level || null,
        world
      })));
  }

  function excludeSelf(characters) {
    const ownNick = game.heroNick();
    const ownId = String(game.heroId() || "");
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
    const world = game.world();
    const openIds = new Set(
      [...target.querySelectorAll('[data-toggle-account][aria-expanded="true"]')]
        .map(toggle => toggle.closest("[data-account-group]")?.dataset.accountId)
        .filter(Boolean)
    );
    const selected = state.selectedPlayers;
    if (!state.accountGroups.length) {
      target.innerHTML = "";
      return;
    }
    target.innerHTML = `
      ${state.accountGroups.map(group => {
        const expanded = openIds.has(group.accountId);
        return `
        <section class="mc-account-group" data-account-group data-account-id="${escapeAttribute(group.accountId)}">
          <div class="mc-account-group-head">
            <button type="button" data-toggle-account aria-expanded="${expanded}" aria-label="${expanded ? "Zwiń" : "Rozwiń"} konto">${expanded ? "▾" : "▸"}</button>
            <span>Konto ${escapeMarkup(group.accountId)}</span>
            <button type="button" data-remove-account="${escapeAttribute(group.accountId)}" aria-label="Usuń konto">×</button>
          </div>
          <div class="mc-account-character-list" ${expanded ? "" : "hidden"}>
            ${group.characters.length ? group.characters.map((character, index) => `
              <label class="mc-account-character">
                <input
                  type="checkbox"
                  data-account-character
                  data-character-index="${index}"
                  value="${escapeAttribute(character.name)}"
                  ${selected.some(player => sameNick(player.nick, character.name)) ? "checked" : ""}
                >
                <span>
                  <strong>${escapeMarkup(character.name)}</strong>
                  <small>${[
                    character.level ? `${character.level} lvl` : "",
                    character.id ? `ID postaci ${character.id}` : ""
                  ].filter(Boolean).map(escapeMarkup).join(" · ")}</small>
                </span>
              </label>`).join("") : `<p class="mc-muted">Nie wykryto postaci na świecie ${escapeMarkup(world)}.</p>`}
          </div>
        </section>`;
      }).join("")}
      <div class="mc-account-batch" data-account-batch hidden>
        <span data-account-selection-count></span>
        <label class="mc-account-batch-time">Czas<input data-time placeholder="np. 12h"></label>
        <button type="button" class="danger" data-account-batch-command="kill">Zabij</button>
        <button type="button" class="danger" data-account-batch-command="unkill">Zdejmij zabicie</button>
      </div>`;
    const selectionCount = selectedAccountCharacters().length;
    target.querySelector("[data-account-selection-count]").textContent = `Zaznaczono: ${selectionCount}`;
    target.querySelector("[data-account-batch]").hidden = selectionCount === 0;
  }

  function selectedAccountCharacters() {
    return state.accountGroups
      .flatMap(group => group.characters)
      .filter(character => state.selectedPlayers.some(player => sameNick(player.nick, character.name)))
      .map(character => ({
        nick: character.name,
        id: character.id || resolvePlayerId(character.name) || ""
      }));
  }

  function syncAccountSelection() {
    const target = state.panel?.querySelector("[data-search-results]");
    if (!target) return;
    const selected = [...target.querySelectorAll("[data-account-character]:checked")]
      .map(input => {
        const groupElement = input.closest("[data-account-group]");
        const group = state.accountGroups.find(item => item.accountId === groupElement?.dataset.accountId);
        const character = group?.characters[Number(input.dataset.characterIndex)];
        return character && {
          nick: character.name,
          id: character.id || resolvePlayerId(character.name) || ""
        };
      })
      .filter(Boolean);
    selectPlayers(selected, { renderActive: true });
    const batch = state.panel?.querySelector("[data-account-batch]");
    const count = state.panel?.querySelector("[data-account-selection-count]");
    if (count) count.textContent = `Zaznaczono: ${selected.length}`;
    if (batch) batch.hidden = selected.length === 0;
  }

  function removeAccount(accountId) {
    const group = state.accountGroups.find(item => item.accountId === String(accountId));
    const removedNames = (group?.characters || []).map(character => character.name);
    state.accountGroups = state.accountGroups.filter(group => group.accountId !== String(accountId));
    selectPlayers(state.selectedPlayers.filter(player =>
      !removedNames.some(name => sameNick(name, player.nick))
    ), { renderActive: true });
    renderAccountCharacters();
  }

  function clearAccountSearch() {
    state.accountGroups = [];
    selectPlayers([], { renderActive: true });
    const input = state.panel?.querySelector("[data-search]");
    const results = state.panel?.querySelector("[data-search-results]");
    if (input) input.value = "";
    if (results) results.innerHTML = "";
    renderSelection();
  }

  async function loadAccount(player) {
    const currentPlayer = menuPlayer(player?.id, player?.nick || player?.name);
    const nick = normalize(currentPlayer.nick || player?.nick || player?.name);
    const characterId = currentPlayer.id || player?.id || null;
    const accountId = parseAccountId(
      player?.accountId || currentPlayer.accountId || getPlayerAccountId(characterId)
    );
    if (!accountId) {
      notice(`Nie udało się odczytać ID konta gracza ${nick || "—"} bezpośrednio z danych klienta.`);
      return false;
    }
    const input = state.panel?.querySelector("[data-search]");
    const panelWindow = state.panel?.querySelector(".mc-window");
    if (input) input.value = accountId;
    panelWindow?.scrollTo({ top: 0, behavior: "smooth" });
    await loadAccounts([accountId]);
    state.panel?.querySelector("[data-search-results]")?.scrollIntoView({ block: "nearest" });
    return true;
  }

  async function openAccountSearch(participantId) {
    const verification = state.active?.verification;
    const participant = (state.active?.participants || []).find(item =>
      String(item.id) === String(participantId)
    );
    if (!verification || verification.status !== "ACTIVE" || !participant) {
      notice("Nie znaleziono uczestnika aktywnej weryfikacji.");
      return;
    }
    selectPlayers([
      ...selectedPlayers(),
      { nick: participant.character_name, id: participant.character_id || resolvePlayerId(participant.character_name) || "" }
    ], { renderActive: true });
    await loadAccount({
      nick: participant.character_name,
      id: participant.character_id,
      accountId: participant.account_id
    });
  }

  async function searchAccount() {
    const input = state.panel?.querySelector("[data-search]");
    const value = input?.value || "";
    if (!value) return notice("Wpisz ID konta albo link do profilu.");
    const accountIds = parseAccountIds(value);
    if (!accountIds.length) {
      notice("Wpisz poprawne ID konta lub pełne linki do profili Margonem.");
      input?.focus();
      return;
    }
    await loadAccounts(accountIds);
  }

  function renderSelection() {
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
    renderSelection();
    if (options.renderActive && state.activePanel) scheduleRender({ active: true });
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
      moderator: game.heroNick(),
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

  async function runPenalty(action, explicitTargets = null, options = {}) {
    if (action !== "kill" && action !== "unkill") return notice("Nieobsługiwane polecenie moderacyjne.");
    const fixedTime = Object.prototype.hasOwnProperty.call(options, "czas")
      ? normalize(options.czas)
      : null;
    const targets = (Array.isArray(explicitTargets) ? explicitTargets : selectedPlayers())
      .map(target => ({
        nick: normalize(target?.nick || target?.name),
        id: target?.id || resolvePlayerId(target?.nick || target?.name) || ""
      }))
      .filter(target => target.nick);
    if (!targets.length) return notice("Najpierw wybierz gracza.");
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
      if (action === "kill") {
        if (!values.czas) return notice("Wpisz czas kary.");
        command = `.kill "${values.nick}" ${values.czas}${values.powod ? ` "${escapeConsole(values.powod)}"` : ""}`;
        label = "ZABICIE POSTACI";
      } else if (action === "unkill") {
        command = `.unkill "${values.nick}"`;
        label = "ZDJĘCIE ZABICIA";
      }
      if (!command) continue;
      if (!sendConsole(command)) return notice("Konsola gry nie jest obecnie dostępna.");
      sentCommands.push({ label, command, nick: values.nick });
      await recordCommand(label, command, "CONSOLE", values.nick);
      if (Number(options.delayMs) > 0 && targetIndex < targets.length - 1) {
        await wait(options.delayMs);
      }
    }
    if (sentCommands.length) {
      const label = sentCommands[0].label;
      notice(targets.length > 1
        ? `Wysłano polecenie „${label}” osobno do ${targets.length} graczy.`
        : `Wysłano polecenie: ${label}.`);
    }
  }

  async function runAccountBatch(action) {
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
    const confirmed = await confirmAction({
      title: operation,
      message: `Czy na pewno chcesz ${operation} dla ${selected.length} zaznaczonych postaci?\n\n${selected.map(character => `• ${character.nick}`).join("\n")}`,
      confirmLabel: operation,
      danger: true
    });
    if (!confirmed) return;
    await runPenalty(action, selected, { delayMs: 750, czas: time });
  }

  async function recordCommand(name, content, channel, targetNick = "") {
    const verification = state.active?.verification;
    if (!verification || verification.status !== "ACTIVE") return;
    const participant = findParticipant(targetNick);
    const map = game.map();
    state.active = updateVerification(verification.id, (record, database) => {
      addEvent(database, record, {
        title: `Wysłano polecenie ${name}`,
        eventType: "READY_COMMAND_SENT",
        details: {
          commandName: name,
          content,
          channel,
          targetCharacter: targetNick || null,
          moderator: game.heroNick()
        },
        mapId: map.id,
        mapName: map.name,
        participantId: participant?.id || null
      });
    });
    scheduleRender({ main: true, active: true });
  }

  function sendConsole(command) {
    try {
      return game.sendCommand(command);
    } catch (error) {
      console.warn("[Centrum Moderacji] Konsola gry:", error);
      return false;
    }
  }

  async function sendLocal(message) {
    try {
      const sent = game.sendLocal(message);
      if (!sent) notice("Kanał lokalny lub API czatu nie jest obecnie dostępne.");
      return sent;
    } catch (error) {
      console.warn("[Centrum Moderacji] Czat klienta:", error);
      return false;
    }
  }

  function runOnce(key, action) {
    if (runtime.operations.has(key)) return Promise.resolve(false);
    runtime.operations.add(key);
    return Promise.resolve().then(action).finally(() => runtime.operations.delete(key));
  }

  function startVerification(player) {
    return runOnce(`start:${normalizeNick(player?.nick)}`, () => startVerificationTask(player));
  }

  async function startVerificationTask(player) {
    const nick = normalize(player?.nick);
    const moderator = game.heroNick();
    if (!isLikelyPlayerNick(nick)) return notice("Nie udało się bezpiecznie rozpoznać nicku wskazanego gracza.");
    if (!moderator) return notice("Klient gry nie udostępnił danych aktualnej postaci.");
    if (state.active?.verification?.status === "ACTIVE") return addParticipant(player);
    const code = generateCode();
    const panelCodeInput = state.panel?.querySelector("[data-code]");
    if (panelCodeInput) panelCodeInput.value = code;
    const map = game.map();
    const accountId = parseAccountId(player?.accountId) || getPlayerAccountId(player?.id);
    const config = readConfig();
    const values = { nick, moderator, kod: code, czas: "", powod: "", tresc: "" };
    const local = resolveTemplate(config.local, values);
    const consoleCommand = resolveTemplate(config.console, values);
    if (local.missing.length || consoleCommand.missing.length) {
      return notice(`Treść rozpoczęcia wymaga danych: ${[...new Set([...local.missing, ...consoleCommand.missing])].join(", ")}.`);
    }
    await wait(config.startDelaySeconds * 1000);
    const localResult = await sendLocal(local.content);
    if (!localResult) return notice("Nie udało się wysłać obowiązkowej informacji na czat lokalny. Sesja nie została utworzona.");
    try {
      state.active = createVerification({
        world: game.world(),
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
      await wait(config.startDelaySeconds * 1000);
      if (sendConsole(consoleCommand.content)) {
        await recordCommand("ROZPOCZĘCIE — UPOMNIENIE", consoleCommand.content, "CONSOLE", nick);
      }
      selectPlayers([{ nick, id: player.id || resolvePlayerId(nick) || "" }]);
      localStorage.setItem(ACTIVE_PANEL_OPEN_KEY, "1");
      showActive();
      await loadAccount(player);
      notice(`Rozpoczęto weryfikację gracza ${nick}. Kod: ${code}.`);
    } catch (error) {
      if (error.message === "ACTIVE_VERIFICATION_EXISTS") {
        state.active = getActiveVerification();
        return addParticipant(player);
      }
      notice(`Nie udało się utworzyć sesji (${error.message}).`);
    }
  }

  function addParticipant(player) {
    return runOnce(`add:${normalizeNick(player?.nick)}`, () => addParticipantTask(player));
  }

  async function addParticipantTask(player) {
    const verification = state.active?.verification;
    const nick = normalize(player?.nick);
    if (!verification || verification.status !== "ACTIVE") return notice("Nie ma aktywnej weryfikacji.");
    if (!isLikelyPlayerNick(nick)) return notice("Nie udało się bezpiecznie rozpoznać nicku gracza.");
    if ((state.active?.participants || []).some(item => !item.resolved_at && sameNick(item.character_name, nick))) {
      return notice("Ten gracz jest już w aktywnej weryfikacji.");
    }
    const map = game.map();
    const accountId = parseAccountId(player?.accountId) || getPlayerAccountId(player?.id);
    const moderator = game.heroNick();
    const code = generateCode();
    const config = readConfig();
    const values = { nick, moderator, kod: code, czas: "", powod: "", tresc: "" };
    const local = resolveTemplate(config.local, values);
    const consoleCommand = resolveTemplate(config.console, values);
    if (local.missing.length || consoleCommand.missing.length) {
      return notice(`Treść rozpoczęcia wymaga danych: ${[...new Set([...local.missing, ...consoleCommand.missing])].join(", ")}.`);
    }
    await wait(config.startDelaySeconds * 1000);
    const localResult = await sendLocal(local.content);
    if (!localResult) {
      return notice("Nie udało się wysłać obowiązkowej informacji na czat lokalny. Gracz nie został dodany.");
    }
    try {
      state.active = updateVerification(verification.id, (record, database) => {
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
        addEvent(database, record, {
          title: `Dodano gracza ${nick} do aktywnej weryfikacji`,
          eventType: "PARTICIPANT_ADDED",
          details: { characterName: nick, moderator, code },
          mapId: map.id,
          mapName: map.name,
          participantId: participant.id
        });
      });
      await recordCommand("DOŁĄCZENIE DO WERYFIKACJI — CZAT LOKALNY", local.content, "LOCAL", nick);
      await wait(config.startDelaySeconds * 1000);
      if (sendConsole(consoleCommand.content)) {
        await recordCommand("DOŁĄCZENIE DO WERYFIKACJI — UPOMNIENIE", consoleCommand.content, "CONSOLE", nick);
      } else {
        notice(`Dodano ${nick}, ale klient nie udostępnił konsoli do wysłania .reminder.`);
      }
      selectPlayers([
        ...selectedPlayers(),
        { nick, id: player.id || resolvePlayerId(nick) || "" }
      ], { renderActive: true });
      await loadAccount(player);
      notice(`Dodano ${nick} do aktywnej weryfikacji. Kod gracza: ${code}.`);
    } catch (error) {
      const label = error.message === "PARTICIPANT_ALREADY_ADDED" ? "Ten gracz jest już w aktywnej weryfikacji." : error.message;
      notice(`Nie udało się dodać gracza (${label}).`);
    }
  }

  function findParticipant(nick) {
    const wanted = normalize(nick).toLocaleLowerCase("pl");
    return state.active?.participants?.find(item => normalize(item.character_name).toLocaleLowerCase("pl") === wanted) || null;
  }

  function findActiveParticipant(participantId, participants = state.active?.participants) {
    return (participants || []).find(item =>
      String(item.id) === String(participantId) && !item.resolved_at
    ) || null;
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

  async function sendNewCode(participantId) {
    const verification = state.active?.verification;
    if (!verification || verification.status !== "ACTIVE") return notice("Brak aktywnej weryfikacji.");
    const participant = findActiveParticipant(participantId);
    if (!participant) return notice("Ten uczestnik nie ma aktywnej weryfikacji.");
    const code = generateCode();
    const map = game.map();
    try {
      state.active = updateVerification(verification.id, (record, database) => {
        const stored = findActiveParticipant(participantId, record.participants);
        if (!stored) throw new Error("PARTICIPANT_NOT_ACTIVE");
        stored.verification_code = code;
        stored.code_updated_at = new Date().toISOString();
        record.verification.updated_at = new Date().toISOString();
        addEvent(database, record, {
          title: `Wylosowano nowy kod dla ${stored.character_name}`,
          eventType: "CODE_GENERATED",
          details: { code, moderator: game.heroNick(), characterName: stored.character_name },
          mapId: map.id,
          mapName: map.name,
          participantId: stored.id
        });
      });
      const commandTemplate = readConfig().sendCode;
      const resolvedCommand = resolveTemplate(commandTemplate, {
        nick: participant.character_name,
        moderator: game.heroNick(),
        kod: code,
        czas: "",
        powod: "",
        tresc: ""
      });
      if (!resolvedCommand.content.trim() || resolvedCommand.missing.length) {
        throw new Error(`Polecenie „Wyślij kod” wymaga danych: ${resolvedCommand.missing.join(", ") || "treść polecenia"}`);
      }
      const command = resolvedCommand.content.trim();
      const sent = sendConsole(command);
      if (sent) await recordCommand("NOWY KOD WERYFIKACYJNY", command, "CONSOLE", participant.character_name);
      notice(sent
        ? `Wysłano nowy kod ${code} graczowi ${participant.character_name}.`
        : `Wylosowano kod ${code}, ale klient nie udostępnił konsoli do wysłania .reminder.`);
    } catch (error) {
      notice(`Nie udało się wysłać nowego kodu (${error.message}).`);
    }
  }

  async function sendParticipantCommand(participantId, commandKey) {
    const verification = state.active?.verification;
    if (!verification || verification.status !== "ACTIVE") return notice("Brak aktywnej weryfikacji.");
    const participant = findActiveParticipant(participantId);
    if (!participant) return notice("Ten uczestnik nie ma aktywnej weryfikacji.");
    const definitions = {
      sendNick: { label: "WYŚLIJ NICK" },
      sendScreen: { label: "WYŚLIJ SCREEN" },
      sendTrade: { label: "HANDEL" },
      sendAttack: { label: "ATAK MOBÓW" },
      sendReminder: { label: "PONAGLIJ" }
    };
    const definition = definitions[commandKey];
    if (!definition) return notice("Nieznany typ polecenia.");
    const template = readConfig()[commandKey];
    const resolved = resolveTemplate(template, {
      nick: participant.character_name,
      moderator: game.heroNick(),
      kod: participantCode(participant, verification),
      czas: "",
      powod: "",
      tresc: ""
    });
    if (!resolved.content.trim() || resolved.missing.length) {
      return notice(`Polecenie „${definition.label}” wymaga danych: ${resolved.missing.join(", ") || "treść polecenia"}.`);
    }
    const command = resolved.content.trim();
    if (!sendConsole(command)) {
      return notice("Klient nie udostępnił konsoli do wysłania polecenia.");
    }
    await recordCommand(definition.label, command, "CONSOLE", participant.character_name);
    notice(`Wysłano polecenie „${definition.label}” graczowi ${participant.character_name}.`);
  }

  function finishParticipant(participantId) {
    return runOnce(`finish:${participantId}`, () => finishParticipantTask(participantId));
  }

  async function finishParticipantTask(participantId) {
    const verification = state.active?.verification;
    if (!verification || verification.status !== "ACTIVE") return notice("Brak aktywnej weryfikacji.");
    const participant = findActiveParticipant(participantId);
    if (!participant) return notice("Ten uczestnik nie ma aktywnej weryfikacji.");
    if (!await confirmAction({
      title: "Zakończ weryfikację",
      message: `Zakończyć weryfikację gracza ${participant.character_name}?`,
      confirmLabel: "Zakończ",
      danger: true
    })) return;
    const finishTemplate = readConfig().finish;
    const localMessage = resolveTemplate(finishTemplate, {
      nick: participant.character_name,
      moderator: game.heroNick(),
    }).content.trim();
    const map = game.map();
    try {
      let finishedAll = false;
      state.active = updateVerification(verification.id, (record, database) => {
        const endedAt = new Date().toISOString();
        const stored = findActiveParticipant(participantId, record.participants);
        if (!stored) throw new Error("PARTICIPANT_NOT_ACTIVE");
        stored.resolved_at = endedAt;
        addEvent(database, record, {
          title: `Zakończono weryfikację gracza ${stored.character_name}`,
          eventType: "PARTICIPANT_FINISHED",
          details: {
            characterName: stored.character_name,
            announcement: localMessage,
            moderator: game.heroNick()
          },
          mapId: map.id,
          mapName: map.name,
          participantId: stored.id
        });
        finishedAll = !(record.participants || []).some(item => !item.resolved_at);
        if (finishedAll) {
          record.verification.status = "COMPLETED";
          record.verification.ended_at = endedAt;
          addEvent(database, record, {
            title: "Zakończono całą weryfikację",
            eventType: "VERIFICATION_FINISHED",
            details: { moderator: game.heroNick() },
            mapId: map.id,
            mapName: map.name
          });
        }
        record.verification.updated_at = endedAt;
      });
      const announced = localMessage ? await sendLocal(localMessage) : true;
      selectPlayers(selectedPlayers().filter(item => !sameNick(item.nick, participant.character_name)));
      if (finishedAll) {
        closeActive();
      }
      notice(announced
        ? `Weryfikacja gracza ${participant.character_name} została zakończona.`
        : `Zakończono weryfikację gracza ${participant.character_name}, ale nie udało się wysłać komunikatu na czat lokalny.`);
    } catch (error) {
      notice(`Nie udało się zakończyć weryfikacji (${error.message}).`);
    }
  }

  function finishAll() {
    return runOnce("finish-all", finishAllTask);
  }

  async function finishAllTask() {
    const verification = state.active?.verification;
    if (!verification || verification.status !== "ACTIVE") return notice("Brak aktywnej weryfikacji.");
    const participants = (state.active.participants || []).filter(item => !item.resolved_at);
    if (!participants.length) return notice("Brak aktywnych uczestników.");
    if (!await confirmAction({
      title: "Zakończ wszystkie weryfikacje",
      message: `Zakończyć weryfikację wszystkich aktywnych graczy (${participants.length})?`,
      confirmLabel: "Zakończ wszystkich",
      danger: true
    })) return;

    const finishTemplate = readConfig().finish;
    const moderator = game.heroNick();
    const map = game.map();
    const announcements = participants.map(participant => ({
      participant,
      content: resolveTemplate(finishTemplate, {
        nick: participant.character_name,
        moderator
      }).content.trim()
    }));
    try {
      state.active = updateVerification(verification.id, (record, database) => {
        const endedAt = new Date().toISOString();
        for (const { participant, content } of announcements) {
          const stored = findActiveParticipant(participant.id, record.participants);
          if (!stored) continue;
          stored.resolved_at = endedAt;
          addEvent(database, record, {
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
        addEvent(database, record, {
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
        if (announcement.content && !await sendLocal(announcement.content)) {
          failedAnnouncements += 1;
        }
      }
      selectPlayers([]);
      closeActive();
      notice(failedAnnouncements
        ? `Zakończono weryfikację wszystkich graczy. Nie wysłano ${failedAnnouncements} komunikatów lokalnych.`
        : `Zakończono weryfikację wszystkich graczy (${participants.length}).`);
    } catch (error) {
      notice(`Nie udało się zakończyć weryfikacji grupowej (${error.message}).`);
    }
  }

  function generateCode() {
    return String(crypto.getRandomValues(new Uint32Array(1))[0] % 10000).padStart(4, "0");
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
    renderSelection();
    renderActiveSections();
    if (state.accountGroups.length) renderAccountCharacters();
  }

  function closePanel() {
    saveConfig(state.panel, false);
    state.panelMoveCleanup?.();
    state.panelMoveCleanup = null;
    state.panel?.remove();
    state.panel = null;
    localStorage.setItem(PANEL_OPEN_KEY, "0");
  }

  function panelMarkup() {
    const start = readConfig();
    return `
      <div class="mc-window">
        <header class="mc-head">
          <div><small>CENTRUM OPERACYJNE</small><h2>Centrum Moderacji</h2></div>
          <div class="mc-head-actions">
            <span class="mc-rank" data-user-rank>${escapeMarkup(moderatorRankLabel())}</span>
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

        <details class="mc-block" open>
          <summary>Aktywna weryfikacja <b data-active-state>BRAK SESJI</b></summary>
          <div data-active-summary></div>
        </details>

        <details class="mc-block">
          <summary>Polecenia weryfikacyjne <b>ZAPIS LOKALNY</b></summary>
          <p>Pierwsza wiadomość trafia na czat lokalny, a następnie polecenie do konsoli. Sesję rozpoczynasz przez PPM na graczu.</p>
          <div class="mc-start-local-row">
            <label>Wiadomość lokalna<textarea data-start-local>${escapeMarkup(start.local)}</textarea></label>
            <label class="mc-start-delay">Opóźnienie wiadomości i konsoli (s)<input type="number" min="0" step="0.1" inputmode="decimal" data-start-delay value="${escapeAttribute(start.startDelaySeconds)}"></label>
          </div>
          <label>Komenda konsoli<textarea data-start-console>${escapeMarkup(start.console)}</textarea></label>
          <label>Polecenie „Wyślij kod”<textarea data-send-code-command>${escapeMarkup(start.sendCode)}</textarea></label>
          <p>W poleceniu „Wyślij kod” użyj <code>{nick}</code> oraz <code>{kod}</code>. Kod zostanie zastąpiony osobnym kodem wybranego uczestnika.</p>
          <label>Polecenie „Wyślij nick”<textarea data-send-nick-command>${escapeMarkup(start.sendNick)}</textarea></label>
          <label>Polecenie „Wyślij screen”<textarea data-send-screen-command>${escapeMarkup(start.sendScreen)}</textarea></label>
          <label>Polecenie „Handel”<textarea data-send-trade-command>${escapeMarkup(start.sendTrade)}</textarea></label>
          <label>Polecenie „Atak mobów”<textarea data-send-attack-command>${escapeMarkup(start.sendAttack)}</textarea></label>
          <label>Polecenie „Ponaglij”<textarea data-send-reminder-command>${escapeMarkup(start.sendReminder)}</textarea></label>
          <p>Polecenia są wysyłane przez konsolę gry do uczestnika wybranego w panelu aktywnej weryfikacji. Możesz użyć: <code>{nick}</code>, <code>{moderator}</code> oraz <code>{kod}</code>.</p>
          <label>Wiadomość kończąca na czat lokalny<textarea data-finish-local>${escapeMarkup(start.finish)}</textarea></label>
          <p>W wiadomości kończącej możesz użyć: <code>{nick}</code> oraz <code>{moderator}</code>.</p>
          <button type="button" data-save-start>Zapisz</button>
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
    overlay.addEventListener("click", event => {
      if (event.target.closest("[data-open-active]")) toggleActive();
    });
    const stopWheelIsolation = isolateWheel(win);
    const stopMoving = makeMovable(win, {
      positionKey: PANEL_POSITION_KEY,
      handle: head
    });
    state.panelMoveCleanup = () => {
      stopWheelIsolation();
      stopMoving();
    };
    overlay.querySelector("[data-close]").addEventListener("click", closePanel);
    overlay.querySelector("[data-select-player]").addEventListener("click", searchAccount);
    overlay.querySelector("[data-search]").addEventListener("keydown", event => {
      if (event.key === "Enter") searchAccount();
    });
    overlay.querySelector("[data-clear-player]").addEventListener("click", clearAccountSearch);
    overlay.querySelector("[data-save-start]").addEventListener("click", () => {
      saveConfig(overlay, true);
    });
    const searchResults = overlay.querySelector("[data-search-results]");
    searchResults.addEventListener("change", event => {
      if (event.target.matches("[data-account-character]")) syncAccountSelection();
    });
    searchResults.addEventListener("click", event => {
      const batchButton = event.target.closest("[data-account-batch-command]");
      if (batchButton) return void runAccountBatch(batchButton.dataset.accountBatchCommand);
      const removeButton = event.target.closest("[data-remove-account]");
      if (removeButton) return removeAccount(removeButton.dataset.removeAccount);
      const toggle = event.target.closest("[data-toggle-account]");
      if (toggle) {
        const expanded = toggle.getAttribute("aria-expanded") === "true";
        const list = toggle.closest("[data-account-group]")?.querySelector(".mc-account-character-list");
        toggle.setAttribute("aria-expanded", String(!expanded));
        toggle.setAttribute("aria-label", expanded ? "Rozwiń konto" : "Zwiń konto");
        toggle.textContent = expanded ? "▸" : "▾";
        if (list) list.hidden = expanded;
      }
    });
    overlay.querySelector("[data-clear-journal]").addEventListener("click", clearJournal);
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
      renderJournal(timeline, state.journal);
      closeActive(false);
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
    }
    renderJournal(timeline, state.journal);
    if (isActive && state.activePanel) scheduleRender({ active: true });
  }

  function syncActiveButton() {
    state.panel?.querySelectorAll("[data-open-active]").forEach(button => {
      button.textContent = state.activePanel ? "Zamknij panel" : "Otwórz panel";
    });
  }

  function toggleActive() {
    if (state.activePanel) closeActive();
    else showActive();
  }

  function showActive() {
    if (state.active?.verification?.status !== "ACTIVE") {
      return notice("Brak aktywnej weryfikacji.");
    }
    if (state.activePanel) {
      scheduleRender({ active: true });
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
    const stopWheelIsolation = isolateWheel(win);
    const stopMoving = makeMovable(win, {
      positionKey: ACTIVE_PANEL_POSITION_KEY,
      handle: head
    });
    state.activePanelMoveCleanup = () => {
      stopWheelIsolation();
      stopMoving();
    };
    bindActive(overlay);
    renderActive();
    syncActiveButton();
  }

  function closeActive(clearPreference = true) {
    state.activePanelMoveCleanup?.();
    state.activePanelMoveCleanup = null;
    state.activePanel?.remove();
    state.activePanel = null;
    if (clearPreference) localStorage.setItem(ACTIVE_PANEL_OPEN_KEY, "0");
    syncActiveButton();
  }

  function bindActive(root) {
    root.addEventListener("click", async event => {
      const button = event.target.closest("button");
      if (!button) return;
      if (button.matches("[data-close-active]")) return closeActive();
      if (button.matches("[data-add-map-player]")) return addParticipant({
        nick: button.dataset.addMapPlayer,
        id: button.dataset.playerId,
        accountId: button.dataset.playerAccountId || null
      });
      if (button.matches("[data-select-all-participants]")) {
        const unresolved = (state.active?.participants || []).filter(item => !item.resolved_at);
        const accountIds = [];
        const selected = [...selectedPlayers()];
        let missing = 0;
        for (const participant of unresolved) {
          const accountId = parseAccountId(
            participant.account_id || getPlayerAccountId(participant.character_id)
          );
          if (!accountId) {
            missing += 1;
            continue;
          }
          if (!accountIds.includes(accountId)) accountIds.push(accountId);
          selected.push({
            nick: participant.character_name,
            id: participant.character_id || resolvePlayerId(participant.character_name) || ""
          });
        }
        selectPlayers(selected, { renderActive: true });
        if (missing) notice(`Nie udało się rozpoznać kont części uczestników (${missing}).`);
        await loadAccounts(accountIds);
        return;
      }
      if (button.matches("[data-clear-participant-selection]")) {
        clearAccountSearch();
        return notice("Wyczyszczono wybór uczestników.");
      }
      if (button.matches("[data-finish-all-participants]")) return finishAll();
      if (button.matches("[data-send-participant-code]")) return sendNewCode(button.dataset.sendParticipantCode);
      if (button.matches("[data-load-participant-account]")) return openAccountSearch(button.dataset.loadParticipantAccount);
      if (button.matches("[data-send-participant-command]")) return sendParticipantCommand(button.dataset.participantId, button.dataset.sendParticipantCommand);
      if (button.matches("[data-finish-participant]")) return finishParticipant(button.dataset.finishParticipant);
    });
    root.addEventListener("toggle", event => {
      const section = event.target.closest("[data-map-players-section]");
      if (!section) return;
      localStorage.setItem(ACTIVE_MAP_PLAYERS_COLLAPSED_KEY, section.open ? "0" : "1");
      state.mapPlayersCollapsed = !section.open;
      const label = section.querySelector("[data-map-players-toggle-label]");
      if (label) label.textContent = section.open ? "−" : "+";
    }, true);
  }

  function renderActive() {
    const root = state.activePanel;
    const details = state.active;
    if (!root) return;
    if (!details?.verification || details.verification.status !== "ACTIVE") {
      closeActive(false);
      return;
    }
    const verification = details.verification;
    const onMap = getMapPlayers();
    const participants = details.participants || [];
    const unresolved = participants.filter(item => !item.resolved_at);
    const isGroupVerification = participants.length > 1;
    const selectedNames = selectedPlayers().map(item => item.nick);
    const targetNames = unresolved.map(item => item.character_name).join(", ") || verification.target_character || "—";
    const mapPlayersCollapsed = state.mapPlayersCollapsed;
    root.querySelector("[data-active-panel-title]").textContent = targetNames;
    const body = root.querySelector("[data-active-panel-body]");
    if (!body.querySelector("[data-participants-list]")) body.innerHTML = `
      <section class="mc-participants">
        <h4 data-active-kind></h4>
        <div class="mc-group-actions" data-group-actions>
          <button type="button" data-select-all-participants>Wybierz wszystkich</button>
          <button type="button" data-clear-participant-selection>Wyczyść</button>
          <button type="button" class="danger" data-finish-all-participants>Zakończ wszystkich</button>
        </div>
        <div data-participants-list></div>
      </section>
      <details class="mc-map-players" data-map-players-section>
        <summary>Gracze na bieżącej mapie <b data-map-players-toggle-label></b></summary>
        <div data-map-player-list></div>
      </details>`;
    body.querySelector("[data-active-kind]").textContent = isGroupVerification ? "Weryfikacja grupowa" : "Aktywna weryfikacja";
    body.querySelector("[data-group-actions]").hidden = !(isGroupVerification && unresolved.length);
    const list = body.querySelector("[data-participants-list]");
    const existing = new Map([...list.children].map(element => [element.dataset.participantRow, element]));
    for (const item of participants) {
      const selected = selectedNames.some(name => sameNick(name, item.character_name));
      const signature = JSON.stringify([item, selected, isGroupVerification]);
      let row = existing.get(String(item.id));
      if (!row || row.dataset.signature !== signature) {
        const template = document.createElement("template");
        template.innerHTML = participantMarkup(item, verification, selected);
        const next = template.content.firstElementChild;
        next.dataset.signature = signature;
        if (row) row.replaceWith(next);
        else list.appendChild(next);
        row = next;
      }
      list.appendChild(row);
      existing.delete(String(item.id));
    }
    for (const row of existing.values()) row.remove();
    const mapPlayersSection = root.querySelector("[data-map-players-section]");
    if (mapPlayersSection.open === mapPlayersCollapsed) mapPlayersSection.open = !mapPlayersCollapsed;
    mapPlayersSection.querySelector("[data-map-players-toggle-label]").textContent = mapPlayersSection.open ? "−" : "+";
    const available = onMap.filter(player => !findParticipant(player.nick));
    const mapList = body.querySelector("[data-map-player-list]");
    const mapSignature = JSON.stringify(available.map(player => [player.id, player.nick, player.accountId]));
    if (mapList.dataset.signature !== mapSignature) {
      mapList.dataset.signature = mapSignature;
      mapList.innerHTML = available.map(player => `<button data-add-map-player="${escapeAttribute(player.nick)}" data-player-id="${escapeAttribute(player.id)}" data-player-account-id="${escapeAttribute(player.accountId || "")}">+ ${escapeMarkup(player.nick)}</button>`).join("") || "<small>Brak innych graczy do dodania.</small>";
    }
  }

  function participantMarkup(item, verification, selected) {
    const started = participantStartedAt(item, verification);
    return `<article data-participant-row="${escapeAttribute(item.id)}" class="mc-participant-session ${item.resolved_at ? "resolved" : ""} ${selected ? "selected-target" : ""}">
      <div class="mc-session-grid">
        <article><small>WERYFIKOWANY GRACZ</small><strong>${escapeMarkup(item.character_name)}</strong></article>
        <article><small>MAPA STARTOWA</small><strong>${escapeMarkup(participantStartMap(item, verification))}</strong></article>
        <article><small>START</small><strong>${formatDate(started)}</strong></article>
        <article><small>KOD</small><strong>${escapeMarkup(participantCode(item, verification))}</strong></article>
        <article><small>${item.resolved_at ? "CZAS SESJI" : "CZAS TRWANIA"}</small><strong${item.resolved_at ? "" : ` data-participant-started-at="${escapeAttribute(started)}"`}>${participantDuration(item, verification)}</strong></article>
      </div>
      <div class="mc-participant-actions"><span>${item.resolved_at ? "Zakończona" : "Aktywna"}</span>${item.resolved_at ? "" : `
        <button type="button" data-load-participant-account="${escapeAttribute(item.id)}" title="Otwórz w Centrum Moderacji postacie tego konta">IDKONTA</button>
        <button type="button" data-send-participant-code="${escapeAttribute(item.id)}">Kod</button>
        <button type="button" data-send-participant-command="sendNick" data-participant-id="${escapeAttribute(item.id)}">Nick</button>
        <button type="button" data-send-participant-command="sendScreen" data-participant-id="${escapeAttribute(item.id)}">Screen</button>
        <button type="button" data-send-participant-command="sendTrade" data-participant-id="${escapeAttribute(item.id)}">Handel</button>
        <button type="button" data-send-participant-command="sendAttack" data-participant-id="${escapeAttribute(item.id)}">Atak mobów</button>
        <button type="button" data-send-participant-command="sendReminder" data-participant-id="${escapeAttribute(item.id)}">Ponaglij</button>
        <button type="button" class="danger" data-finish-participant="${escapeAttribute(item.id)}">Zakończ</button>`}</div>
    </article>`;
  }

  function updateTimers() {
    if (document.visibilityState === "hidden" || (!state.panel && !state.activePanel)) return;
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
      root.querySelectorAll('[data-journal-duration][data-ended-at=""]').forEach(element => {
        const journalStartedAt = new Date(element.dataset.startedAt || "").getTime();
        if (!Number.isFinite(journalStartedAt)) return;
        element.textContent = formatDuration(Math.max(0, Date.now() - journalStartedAt));
      });
    });
  }

  async function clearJournal() {
    if (state.active?.verification?.status === "ACTIVE") {
      notice("Najpierw zakończ aktywną weryfikację.");
      return;
    }
    const world = normalizeWorld(game.world());
    const database = readDatabase();
    const matchingRecords = database.verifications.filter(record =>
      normalizeWorld(record?.verification?.world) === world
    );
    if (!matchingRecords.length) {
      notice("Dziennik weryfikacji jest już pusty.");
      return;
    }
    const worldLabel = game.world() || "aktualnego świata";
    if (!await confirmAction({
      title: "Wyczyść dziennik",
      message: `Usunąć wszystkie weryfikacje (${matchingRecords.length}) z dziennika świata ${worldLabel}? Tej operacji nie można cofnąć.`,
      confirmLabel: "Wyczyść",
      danger: true
    })) {
      return;
    }
    database.verifications = database.verifications.filter(record =>
      normalizeWorld(record?.verification?.world) !== world
    );
    if (!database.verifications.length) {
      database.nextVerificationId = 1;
      database.nextParticipantId = 1;
      database.nextEventId = 1;
    }
    writeDatabase(database);
    state.journal = [];
    notice(`Wyczyszczono dziennik świata ${worldLabel}.`);
  }

  function journalMarkup(entries) {
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
              eventForParticipant(event, participant, participants.length)
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

  function eventForParticipant(event, participant, participantCount) {
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

  function journalSignature(entries) {
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

  function renderJournal(target, entries) {
    const signature = journalSignature(entries);
    if (!target || target.dataset.renderSignature === signature) return;
    const markup = journalMarkup(entries);
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

  function makeMovable(element, { positionKey, handle, click }) {
    const controller = new AbortController();
    const signal = controller.signal;
    let drag = null;
    let moved = false;
    handle.addEventListener("pointerdown", event => {
      if (event.button !== 0) return;
      if (event.target.closest("button") && event.target !== handle && element !== handle) return;
      const rect = element.getBoundingClientRect();
      drag = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
        width: rect.width,
        height: rect.height,
        left: rect.left,
        top: rect.top
      };
      moved = false;
      try { handle.setPointerCapture?.(event.pointerId); } catch {}
      event.preventDefault();
    }, { signal });
    handle.addEventListener("pointermove", event => {
      if (!drag) return;
      drag.left = clamp(event.clientX - drag.x, 0, Math.max(0, innerWidth - drag.width));
      drag.top = clamp(event.clientY - drag.y, 0, Math.max(0, innerHeight - drag.height));
      if (!runtime.dragFrame) {
        runtime.dragFrame = requestAnimationFrame(() => {
          runtime.dragFrame = 0;
          if (!drag) return;
          Object.assign(element.style, { left: `${Math.round(drag.left)}px`, top: `${Math.round(drag.top)}px`, right: "auto" });
        });
      }
      moved = true;
    }, { signal });
    handle.addEventListener("pointerup", event => {
      if (!drag) return;
      Object.assign(element.style, { left: `${Math.round(drag.left)}px`, top: `${Math.round(drag.top)}px`, right: "auto" });
      drag = null;
      try {
        if (!handle.hasPointerCapture || handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture?.(event.pointerId);
      } catch {}
      savePosition(element, positionKey);
    }, { signal });
    handle.addEventListener("pointercancel", event => {
      drag = null;
      try {
        if (!handle.hasPointerCapture || handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture?.(event.pointerId);
      } catch {}
    }, { signal });
    if (click) {
      element.addEventListener("click", event => {
        if (moved) {
          moved = false;
          event.preventDefault();
          return;
        }
        click();
      }, { signal });
    }
    const clampToViewport = () => {
      const rect = element.getBoundingClientRect();
      Object.assign(element.style, {
        left: `${Math.round(clamp(rect.left, 0, Math.max(0, innerWidth - rect.width)))}px`,
        top: `${Math.round(clamp(rect.top, 0, Math.max(0, innerHeight - rect.height)))}px`,
        right: "auto"
      });
    };
    window.addEventListener("resize", clampToViewport, { signal });
    return () => controller.abort();
  }

  function isolateWheel(element) {
    const controller = new AbortController();
    element.addEventListener("wheel", event => event.stopPropagation(), { capture: true, passive: true, signal: controller.signal });
    return () => controller.abort();
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

  function confirmAction({ title, message, confirmLabel = "Potwierdź", danger = false }) {
    runtime.confirm?.(false);
    const previousFocus = document.activeElement;
    const overlay = document.createElement("div");
    overlay.id = `${SCRIPT_ID}-confirm`;
    overlay.innerHTML = `
      <div class="mc-confirm-window" role="dialog" aria-modal="true" aria-labelledby="${SCRIPT_ID}-confirm-title">
        <h3 id="${SCRIPT_ID}-confirm-title">${escapeMarkup(title)}</h3>
        <p>${escapeMarkup(message).replace(/\n/g, "<br>")}</p>
        <div><button type="button" data-confirm-cancel>Anuluj</button><button type="button" ${danger ? 'class="danger"' : ""} data-confirm-ok>${escapeMarkup(confirmLabel)}</button></div>
      </div>`;
    document.body.appendChild(overlay);
    return new Promise(resolve => {
      const finish = result => {
        if (!overlay.isConnected) return;
        overlay.remove();
        document.removeEventListener("keydown", onKey);
        runtime.confirm = null;
        if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
        resolve(result);
      };
      const onKey = event => {
        if (event.key === "Escape") finish(false);
        if (event.key === "Tab") {
          const buttons = [...overlay.querySelectorAll("button")];
          const index = buttons.indexOf(document.activeElement);
          const next = event.shiftKey ? (index <= 0 ? buttons.length - 1 : index - 1) : (index + 1) % buttons.length;
          buttons[next].focus();
          event.preventDefault();
        }
      };
      runtime.confirm = finish;
      overlay.addEventListener("click", event => {
        if (event.target === overlay || event.target.closest("[data-confirm-cancel]")) finish(false);
        if (event.target.closest("[data-confirm-ok]")) finish(true);
      });
      document.addEventListener("keydown", onKey);
      overlay.querySelector("[data-confirm-cancel]").focus();
    });
  }

  function notice(text) {
    document.getElementById(`${SCRIPT_ID}-notice`)?.remove();
    const element = document.createElement("div");
    element.id = `${SCRIPT_ID}-notice`;
    element.textContent = text;
    document.body.appendChild(element);
    setTimeout(() => element.remove(), 5000);
  }

  function normalizeWorld(value) {
    return normalize(value).replace(/^#/, "").toLocaleLowerCase("pl");
  }

  function getMapPlayers() {
    return [...players.byId.values()];
  }

  function resolvePlayerId(nick) {
    return players.byNick.get(normalizeNick(nick))?.id || null;
  }

  function getPlayerAccountId(characterId) {
    return getAccountId(game.other(characterId));
  }

  function getAccountId(other) {
    const id = Number(other?.getAccountId?.() ?? other?.d?.account);
    return Number.isSafeInteger(id) && id > 0
      ? id
      : null;
  }

  function moderatorRankLabel() {
    const rights = Number(game.engine()?.hero?.d?.uprawnienia || 0);
    if (rights === 4 || rights === 16) return "Super Moderator";
    if (rights !== 0) return "Moderator Czatu";
    return "Brak rangi";
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
      return DATE_FORMATTER.format(new Date(value));
    } catch {
      return String(value || "");
    }
  }

  function finiteOrNull(value) {
    return Number.isFinite(Number(value)) ? Number(value) : null;
  }

  function sameNick(a, b) {
    return normalizeNick(a) === normalizeNick(b);
  }

  function normalizeNick(value) {
    return normalize(value).toLocaleLowerCase("pl");
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

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function wait(milliseconds) {
    const duration = Math.max(0, Number(milliseconds) || 0);
    return duration ? new Promise(resolve => setTimeout(resolve, duration)) : Promise.resolve();
  }

  function addStyles() {
    if (document.getElementById(`${SCRIPT_ID}-styles`)) return;
    const style = document.createElement("style");
    style.id = `${SCRIPT_ID}-styles`;
    style.textContent = `
      #${SCRIPT_ID}-panel,#${SCRIPT_ID}-active-panel,#${SCRIPT_ID}-notice,#${SCRIPT_ID}-confirm{--mc-glass:rgba(16,17,15,.84);
        --mc-glass-strong:rgba(10,11,10,.9);
        --mc-surface:rgba(48,50,45,.5);
        --mc-surface-strong:rgba(25,27,24,.7);
        --mc-border:rgba(143,149,139,.55);
        --mc-border-soft:rgba(112,118,108,.38);
        --mc-text:#e3e1d7;
        --mc-muted:#aaa99f;
        --mc-green:#8fad62;
        --mc-green-strong:#b1cb7d;
        --mc-gold:#d2bc67;
        --mc-danger:#c57a73;}
      .main-buttons-container .widget-button .icon.${WIDGET_KEY}{background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 32 32'%3E%3Cdefs%3E%3ClinearGradient id='s' x2='0' y2='1'%3E%3Cstop stop-color='%23775a35'/%3E%3Cstop offset='.5' stop-color='%23412e1b'/%3E%3Cstop offset='1' stop-color='%231b130c'/%3E%3C/linearGradient%3E%3C/defs%3E%3Cpath d='M16 1.8 28.5 6v10.2c0 7-4.9 11.6-12.5 14.2C8.4 27.8 3.5 23.2 3.5 16.2V6z' fill='url(%23s)' stroke='%23e0b85b' stroke-width='1.6' stroke-linejoin='round'/%3E%3Cpath d='M16 6v17M9.2 11h13.6M10.5 11.3 6.7 18h7.6zM21.5 11.3 17.7 18h7.6zM11.7 25h8.6' fill='none' stroke='%23f1d06a' stroke-width='1.65' stroke-linecap='round' stroke-linejoin='round'/%3E%3Cpath d='M7.4 18h6.2M18.4 18h6.2' stroke='%238ead4d' stroke-width='1.5' stroke-linecap='round'/%3E%3Ccircle cx='16' cy='6' r='2' fill='%23a84430' stroke='%23f1d06a' stroke-width='1'/%3E%3C/svg%3E")!important;
        background-position:center!important;
        background-repeat:no-repeat!important;
        background-size:32px 32px!important}
      #${SCRIPT_ID}-launcher{position:fixed;right:14px;top:50%;z-index:2147483000;width:43px;height:43px;padding:0;border:2px solid #2b6079;border-radius:7px;background:linear-gradient(145deg,#123346,#081824);box-shadow:0 5px 20px #000c;color:#68ded9;font:bold 24px/39px Arial,sans-serif;cursor:grab}
      #${SCRIPT_ID}-launcher:hover{border-color:#68ded9;background:linear-gradient(145deg,#17445b,#0b2231)}
      #${SCRIPT_ID}-panel,#${SCRIPT_ID}-active-panel{color:var(--mc-text);font-family:Arial,Tahoma,sans-serif}
      #${SCRIPT_ID}-panel .mc-window,#${SCRIPT_ID}-active-panel .mc-active-window{border:1px solid var(--mc-border);
        border-radius:3px;
        background:linear-gradient(180deg,rgba(38,39,35,.86),var(--mc-glass) 48px,var(--mc-glass-strong));
        box-shadow:inset 0 0 0 1px rgba(0,0,0,.82),inset 0 1px rgba(255,255,255,.07),0 8px 24px rgba(0,0,0,.68);
        scrollbar-color:#858b80 rgba(9,10,9,.72)}
      #${SCRIPT_ID}-panel{position:fixed;inset:0;z-index:2147482999;pointer-events:none;font-size:12px}
      #${SCRIPT_ID}-panel *{box-sizing:border-box}
      #${SCRIPT_ID}-panel .mc-window{position:absolute;right:70px;top:45px;width:min(455px,calc(100vw - 24px));height:auto;max-height:calc(100vh - 57px);overflow-x:hidden;overflow-y:auto;overscroll-behavior:contain;padding:10px;pointer-events:auto;scrollbar-width:thin}
      #${SCRIPT_ID}-active-panel{position:fixed;inset:0;z-index:2147483001;overflow:visible!important;pointer-events:none;font-size:12px}
      #${SCRIPT_ID}-active-panel *{box-sizing:border-box}
      #${SCRIPT_ID}-active-panel .mc-active-window{position:absolute;left:calc(50% - 430px);top:24px;bottom:auto!important;display:block;width:min(860px,calc(100vw - 24px));height:auto!important;min-height:0!important;max-height:calc(100vh - 48px)!important;max-block-size:calc(100vh - 48px)!important;overflow-x:hidden!important;overflow-y:auto!important;overscroll-behavior:contain;padding:8px;pointer-events:auto;scrollbar-width:thin}
      #${SCRIPT_ID}-panel .mc-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;padding-bottom:9px;border-bottom:1px solid;cursor:move;user-select:none;touch-action:none}
      #${SCRIPT_ID}-panel .mc-rank{padding:5px 8px;border:1px solid rgba(122,151,85,.65);border-radius:3px;background:rgba(41,57,31,.72);color:var(--mc-green-strong);font-size:11px;font-weight:700;white-space:nowrap}
      #${SCRIPT_ID}-active-panel .mc-active-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;padding-bottom:9px;border-bottom:1px solid;cursor:move;user-select:none;touch-action:none}
      #${SCRIPT_ID}-panel summary{display:flex;justify-content:space-between;gap:10px;font-weight:bold;cursor:pointer;list-style:none}
      #${SCRIPT_ID}-panel summary b{color:#aaa793;font-size:10px}
      #${SCRIPT_ID}-panel summary::-webkit-details-marker{display:none}
      #${SCRIPT_ID}-panel .mc-head-actions{display:flex;align-items:center;gap:7px}
      #${SCRIPT_ID}-panel .mc-head small{font-weight:bold;letter-spacing:.1em}
      #${SCRIPT_ID}-panel h2{margin:3px 0 0;font:700 20px Arial,sans-serif}
      #${SCRIPT_ID}-panel h3,#${SCRIPT_ID}-panel h4{margin:0 0 8px}
      #${SCRIPT_ID}-active-panel h3{margin:3px 0 0;font-size:18px}
      #${SCRIPT_ID}-panel .mc-head,#${SCRIPT_ID}-active-panel .mc-active-head{border-color:var(--mc-border-soft);
        background:linear-gradient(180deg,rgba(74,65,53,.32),rgba(17,18,16,.18));
        box-shadow:0 1px rgba(0,0,0,.72)}
      #${SCRIPT_ID}-panel button:focus-visible,#${SCRIPT_ID}-active-panel button:focus-visible,#${SCRIPT_ID}-confirm button:focus-visible{outline:1px solid var(--mc-gold);
        outline-offset:1px}
      #${SCRIPT_ID}-panel button{padding:7px 10px;border:1px solid;font-weight:bold;cursor:pointer}
      #${SCRIPT_ID}-panel .mc-head button{border:0;background:none;font-size:18px}
      #${SCRIPT_ID}-active-panel .mc-active-head button{border:0;background:none;font-size:18px;cursor:pointer}
      #${SCRIPT_ID}-active-panel button{padding:7px 10px;border:1px solid;font:bold 12px Arial;cursor:pointer}
      #${SCRIPT_ID}-panel button,#${SCRIPT_ID}-panel input,#${SCRIPT_ID}-panel textarea,#${SCRIPT_ID}-panel select{font:inherit}
      #${SCRIPT_ID}-panel .mc-account-batch button{width:100%;min-width:0;padding:6px 4px;font-size:9px;line-height:1.2}
      #${SCRIPT_ID}-panel button:disabled{opacity:.45;cursor:not-allowed}
      #${SCRIPT_ID}-active-panel .mc-group-actions button{width:100%;min-width:0;padding:6px 3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      #${SCRIPT_ID}-active-panel .mc-participant-actions button{flex:1 1 0;min-width:0;padding:6px 3px;overflow:hidden;font-size:clamp(8px,1.15vw,11px);text-overflow:ellipsis;white-space:nowrap}
      #${SCRIPT_ID}-panel button,#${SCRIPT_ID}-active-panel button,#${SCRIPT_ID}-confirm button{border-color:rgba(116,122,111,.68);
        border-radius:2px;
        background:linear-gradient(#4a4d46,#252723);
        color:var(--mc-text);
        box-shadow:inset 0 1px rgba(255,255,255,.1),inset 0 -1px rgba(0,0,0,.65);
        text-shadow:0 1px #000}
      #${SCRIPT_ID}-panel button:hover,#${SCRIPT_ID}-active-panel button:hover,#${SCRIPT_ID}-confirm button:hover{border-color:#9eb875;
        background:linear-gradient(#59654a,#30382a);
        color:#f2f0e6}
      #${SCRIPT_ID}-panel button.danger,#${SCRIPT_ID}-active-panel button.danger,#${SCRIPT_ID}-confirm button.danger{border-color:rgba(151,75,70,.82);
        background:linear-gradient(#633935,#3e2220);
        color:#f0c3bd}
      #${SCRIPT_ID}-panel input,#${SCRIPT_ID}-panel textarea,#${SCRIPT_ID}-panel select{width:100%;padding:8px;border:1px solid rgba(111,116,106,.68);border-radius:2px;outline:none;background:rgba(5,6,5,.72);color:#eeeae0;box-shadow:inset 0 1px 3px rgba(0,0,0,.72)}
      #${SCRIPT_ID}-active-panel .mc-participant-session.selected-target{outline:1px solid var(--mc-green);outline-offset:-1px;background:rgba(68,83,52,.46)}
      #${SCRIPT_ID}-panel input[type="checkbox"]{accent-color:var(--mc-green)}
      #${SCRIPT_ID}-panel .mc-selected,#${SCRIPT_ID}-panel .mc-account-group-head,#${SCRIPT_ID}-panel .mc-account-batch span,
      #${SCRIPT_ID}-active-panel .mc-participant-actions span{color:var(--mc-muted)}
      #${SCRIPT_ID}-panel textarea{min-height:55px;resize:vertical}
      #${SCRIPT_ID}-panel .mc-selected{margin:9px 0}
      #${SCRIPT_ID}-panel label{display:grid;gap:4px;color:#cbc8b9}
      #${SCRIPT_ID}-panel label.wide{min-width:0}
      #${SCRIPT_ID}-panel .mc-start-delay input{height:100%;min-height:55px;text-align:center}
      #${SCRIPT_ID}-panel .mc-account-character input{width:auto;margin:0}
      #${SCRIPT_ID}-panel input:focus,#${SCRIPT_ID}-panel textarea:focus,#${SCRIPT_ID}-panel select:focus{border-color:var(--mc-green);
        box-shadow:inset 0 1px 3px rgba(0,0,0,.72),0 0 0 1px rgba(143,173,98,.18)}
      #${SCRIPT_ID}-panel .mc-note{padding:7px;border-left:3px solid var(--mc-gold);background:rgba(83,72,37,.24);color:#c9c2a7}
      #${SCRIPT_ID}-panel .mc-block{margin-top:9px;padding:9px;border:1px solid;border-radius:3px}
      #${SCRIPT_ID}-panel .mc-start-local-row{display:grid;grid-template-columns:minmax(0,1fr) 112px;align-items:end;gap:7px}
      #${SCRIPT_ID}-panel .mc-start-delay{align-self:stretch}
      #${SCRIPT_ID}-panel .mc-search-results{display:grid;margin-top:6px;border:1px solid #4c4023}
      #${SCRIPT_ID}-panel .mc-account-group{display:grid;border-bottom:1px solid #4c4023}
      #${SCRIPT_ID}-panel .mc-account-group-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:5px 7px;font-size:10px;line-height:1.35}
      #${SCRIPT_ID}-panel .mc-account-group-head span{flex:1}
      #${SCRIPT_ID}-panel .mc-account-group-head button{min-width:23px;padding:2px 6px}
      #${SCRIPT_ID}-panel .mc-account-character{display:grid;grid-template-columns:auto minmax(0,1fr);align-items:center;gap:8px;padding:6px 7px;border-bottom:1px solid #4c4023;cursor:pointer}
      #${SCRIPT_ID}-panel .mc-search{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:6px}
      #${SCRIPT_ID}-panel .mc-search-results:empty{display:none}
      #${SCRIPT_ID}-panel .mc-account-character-list{display:grid}
      #${SCRIPT_ID}-panel .mc-account-character-list[hidden]{display:none}
      #${SCRIPT_ID}-panel .mc-account-character span{display:grid;gap:2px;min-width:0}
      #${SCRIPT_ID}-panel .mc-account-character strong{overflow:hidden;color:#dce8f2;font-size:11px;text-overflow:ellipsis;white-space:nowrap}
      #${SCRIPT_ID}-panel .mc-account-character small{color:#8ea5b5;font-size:9px}
      #${SCRIPT_ID}-panel .mc-account-batch{display:grid;grid-template-columns:84px 1fr 1fr;align-items:end;gap:6px;padding:7px}
      #${SCRIPT_ID}-panel .mc-account-batch[hidden]{display:none!important}
      #${SCRIPT_ID}-panel .mc-account-batch span{grid-column:1/-1;font-size:10px}
      #${SCRIPT_ID}-panel .mc-account-batch-time{min-width:0;font-size:9px}
      #${SCRIPT_ID}-panel .mc-account-character:hover{background:rgba(73,84,62,.42)}
      #${SCRIPT_ID}-panel .mc-session-grid article{display:grid;gap:3px;padding:7px;border:1px solid}
      #${SCRIPT_ID}-panel .mc-participants,#${SCRIPT_ID}-panel .mc-map-players{margin-top:8px;padding:8px;border:1px solid}
      #${SCRIPT_ID}-active-panel .mc-session-grid article{display:grid;align-content:center;gap:2px;min-height:42px;padding:5px 6px;border:1px solid}
      #${SCRIPT_ID}-active-panel .mc-participants,#${SCRIPT_ID}-active-panel .mc-map-players{margin-top:6px;padding:6px;border:1px solid}
      #${SCRIPT_ID}-active-panel .mc-participant-session{padding:6px 0;border-top:1px solid #263f52}
      #${SCRIPT_ID}-active-panel .mc-participant-session:first-of-type{border-top:0}
      #${SCRIPT_ID}-panel .mc-session-grid small{color:var(--mc-muted);font-size:9px}
      #${SCRIPT_ID}-active-panel .mc-map-players>summary{display:flex;align-items:center;justify-content:space-between;gap:8px;font-weight:800;cursor:pointer;user-select:none;list-style:none}
      #${SCRIPT_ID}-active-panel .mc-map-players>summary::-webkit-details-marker{display:none}
      #${SCRIPT_ID}-active-panel .mc-map-players>summary b{min-width:18px;text-align:center;color:#dce8f2;font-size:16px}
      #${SCRIPT_ID}-panel .mc-head small,#${SCRIPT_ID}-panel h2,#${SCRIPT_ID}-panel h3,#${SCRIPT_ID}-panel h4,#${SCRIPT_ID}-panel summary,
      #${SCRIPT_ID}-active-panel .mc-active-head small,#${SCRIPT_ID}-active-panel h3,#${SCRIPT_ID}-active-panel h4,#${SCRIPT_ID}-active-panel .mc-map-players>summary{color:#ddd7bd;
        text-shadow:0 1px #000}
      #${SCRIPT_ID}-panel .mc-active-line{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:8px;padding:8px}
      #${SCRIPT_ID}-panel .mc-active-line strong{flex:1}
      #${SCRIPT_ID}-panel .mc-session-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:5px;margin-top:8px}
      #${SCRIPT_ID}-panel .mc-map-players div{display:flex;flex-wrap:wrap;gap:5px}
      #${SCRIPT_ID}-active-panel [data-active-panel-body],#${SCRIPT_ID}-active-panel .mc-participants,#${SCRIPT_ID}-active-panel .mc-map-players,#${SCRIPT_ID}-active-panel .mc-participant-session{position:static;height:auto!important;min-height:0!important;max-height:none!important;max-block-size:none!important;overflow:visible!important}
      #${SCRIPT_ID}-active-panel .mc-session-grid{display:grid;grid-template-columns:1.35fr 1.35fr 1.3fr .7fr .9fr;gap:4px;margin-top:6px}
      #${SCRIPT_ID}-active-panel .mc-session-grid small{font-size:8px}
      #${SCRIPT_ID}-active-panel .mc-session-grid strong{font-size:11px;overflow-wrap:anywhere}
      #${SCRIPT_ID}-active-panel .mc-participant-session.resolved{opacity:.62}
      #${SCRIPT_ID}-active-panel .mc-group-actions{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5px;margin:5px 0}
      #${SCRIPT_ID}-active-panel .mc-group-actions[hidden]{display:none!important}
      #${SCRIPT_ID}-active-panel .mc-participant-actions{display:flex;flex-wrap:nowrap;align-items:center;justify-content:flex-end;min-width:0;gap:4px;margin-top:5px}
      #${SCRIPT_ID}-active-panel .mc-participant-actions span{flex:0 1 92px;min-width:52px;overflow:hidden;font-size:10px;text-overflow:ellipsis;white-space:nowrap}
      #${SCRIPT_ID}-active-panel .mc-map-players div{display:flex;flex-wrap:wrap;gap:5px}
      #${SCRIPT_ID}-panel .mc-block,#${SCRIPT_ID}-panel .mc-active-line,#${SCRIPT_ID}-panel .mc-session-grid article,
      #${SCRIPT_ID}-active-panel .mc-session-grid article,#${SCRIPT_ID}-active-panel .mc-participants,#${SCRIPT_ID}-active-panel .mc-map-players{border-color:var(--mc-border-soft);
        background:var(--mc-surface)}
      #${SCRIPT_ID}-panel .mc-journal-toolbar{display:flex;align-items:center;justify-content:flex-end;gap:10px;margin:8px 0 2px;padding:7px;border:1px solid}
      #${SCRIPT_ID}-panel .mc-timeline-events article{padding:7px;border-bottom:1px solid}
      #${SCRIPT_ID}-panel .mc-account-batch,#${SCRIPT_ID}-panel .mc-journal-toolbar{background:var(--mc-surface-strong)}
      #${SCRIPT_ID}-panel .mc-timeline-events small,#${SCRIPT_ID}-panel time,#${SCRIPT_ID}-active-panel .mc-session-grid small{color:var(--mc-muted)}
      #${SCRIPT_ID}-panel .mc-timeline-events{max-height:none;overflow:visible}
      #${SCRIPT_ID}-panel details[data-journal-id]:not([open])>.mc-timeline-events{display:none!important}
      #${SCRIPT_ID}-panel .mc-timeline-events article div{display:flex;justify-content:space-between;gap:8px}
      #${SCRIPT_ID}-panel .mc-timeline-events p{margin:4px 0;color:#ddd0aa}
      #${SCRIPT_ID}-panel .mc-participants,#${SCRIPT_ID}-panel .mc-map-players,#${SCRIPT_ID}-panel .mc-journal-toolbar{border-color:var(--mc-border-soft)}
      #${SCRIPT_ID}-panel .mc-search-results,#${SCRIPT_ID}-panel .mc-account-group-head,
      #${SCRIPT_ID}-panel .mc-account-character,#${SCRIPT_ID}-panel .mc-timeline-events article,
      #${SCRIPT_ID}-active-panel .mc-participant-session{border-color:var(--mc-border-soft)}
      #${SCRIPT_ID}-panel .mc-window::-webkit-scrollbar-thumb,#${SCRIPT_ID}-active-panel .mc-active-window::-webkit-scrollbar-thumb{min-height:28px;border-radius:4px;background:#858b80}
      #${SCRIPT_ID}-panel .mc-window::-webkit-scrollbar,#${SCRIPT_ID}-active-panel .mc-active-window::-webkit-scrollbar{width:4px}
      #${SCRIPT_ID}-panel .mc-window::-webkit-scrollbar-track,#${SCRIPT_ID}-active-panel .mc-active-window::-webkit-scrollbar-track{background:rgba(9,10,9,.72)}
      #${SCRIPT_ID}-panel .mc-window::-webkit-scrollbar-thumb:hover,#${SCRIPT_ID}-active-panel .mc-active-window::-webkit-scrollbar-thumb:hover{background:#a2a99b}
      #${SCRIPT_ID}-notice{position:fixed;left:50%;top:70px;z-index:2147483647;max-width:560px;transform:translateX(-50%);padding:10px 14px;border:1px solid var(--mc-border);border-radius:3px;background:rgba(17,18,16,.92);color:var(--mc-text);box-shadow:inset 0 0 0 1px #090a08,0 5px 18px rgba(0,0,0,.72);font:13px Arial,sans-serif}
      #${SCRIPT_ID}-confirm .mc-confirm-window{width:min(420px,100%);padding:16px;border:1px solid var(--mc-border);border-radius:5px;background:var(--mc-glass-strong);box-shadow:0 12px 38px #000;color:var(--mc-text);font-family:Arial,Tahoma,sans-serif}
      #${SCRIPT_ID}-confirm h3{margin:0 0 10px;color:var(--mc-gold)}
      #${SCRIPT_ID}-confirm{position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;padding:16px;background:#0008}
      #${SCRIPT_ID}-confirm p{white-space:normal;line-height:1.45}
      #${SCRIPT_ID}-confirm .mc-confirm-window>div{display:flex;justify-content:flex-end;gap:8px;margin-top:14px}
    `;
    document.head.appendChild(style);
  }

  function dispose() {
    if (runtime.renderFrame) cancelAnimationFrame(runtime.renderFrame);
    if (runtime.dragFrame) cancelAnimationFrame(runtime.dragFrame);
    runtime.confirm?.(false);
    state.panelMoveCleanup?.();
    state.activePanelMoveCleanup?.();
    for (const cleanup of runtime.cleanup.splice(0).reverse()) {
      try { cleanup(); } catch (error) { console.warn("[Centrum Moderacji] Cleanup:", error); }
    }
    state.panel?.remove();
    state.activePanel?.remove();
    document.getElementById(`${SCRIPT_ID}-launcher`)?.remove();
    document.getElementById(`${SCRIPT_ID}-notice`)?.remove();
    document.getElementById(`${SCRIPT_ID}-styles`)?.remove();
    delete game.page()[RUNTIME_GUARD];
  }

  console.info("[Centrum Moderacji] v3.3.52 gotowe.");
})();
