(() => {
  "use strict";

  const RUNTIME_GUARD = "__MARGO_MODERATION_CENTER_RUNTIME__";
  if (window[RUNTIME_GUARD]) return;
  window[RUNTIME_GUARD] = "version;

  const SCRIPT_ID = "margo-moderation-center";
  const DB_KEY = `${SCRIPT_ID}:local-database:v1`;
  const LAUNCHER_POS = `${SCRIPT_ID}:launcher-position`;
  const PANEL_POS = `${SCRIPT_ID}:panel-position`;
  const PANEL_OPEN = `${SCRIPT_ID}:panel-open`;
  const ACTIVE_POS = `${SCRIPT_ID}:active-panel-position`;
  const ACTIVE_OPEN = `${SCRIPT_ID}:active-panel-open`;
  const MAP_STATE = `${SCRIPT_ID}:active-map-players-collapsed`;
  const ACCOUNT_KEY = `${SCRIPT_ID}:account-search:v1`;
  const CONFIG_KEY = `${SCRIPT_ID}:start-config`;
  const MIGRATION_KEY = `${SCRIPT_ID}:default-configuration:2026-08-24-v2`;
  const WIDGET_KEY = "MARGO_MODERATION_CENTER";
  const MENU_HOOK = "__margoModerationCenterPlayerMenuHook__";
  const WORLD_HOOK = "__margoModerationCenterWorldWindowHook__";
  const ONLINE_HOOK = "__margoModerationCenterPlayersOnlineHook__";
  const MAP_HOOK = "__margoModerationCenterMapHook__";
  const DATE_FMT = new Intl.DateTimeFormat("pl-PL", { dateStyle: "short", timeStyle: "medium" });
  const DEFAULT_CONFIG = {
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
    selected: [],
    active: null,
    accounts: [],
    collapsed: false,
    panel: null,
    panelCleanup: null,
    activePanel: null,
    activeCleanup: null,
    journal: []
  };
  const store = { database: null, config: null };
  const runtime = {
    cleanup: [],
    frame: 0,
    timer: 0,
    renderMain: false,
    renderActive: false,
    renderMap: false,
    running: new Set(),
    profiles: new Map(),
    versions: new Map(),
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

  init();

  function init() {
    const ready = () => {
      const engine = game.engine();
      return Boolean(engine?.hero && engine?.allInit && typeof game.api()?.addCallbackToEvent === "function");
    };
    const start = () => {
      if (runtime.initialized) return;
      runtime.initialized = true;
      migrate();
      store.database = readDb(true);
      store.config = readConfig(true);
      state.collapsed = localStorage.getItem(MAP_STATE) === "1";
      sync();
      bindGame();
      if (!widget()) launcher();
      hookMenu();
      window.addEventListener("beforeunload", dispose, { once: true });
      if (localStorage.getItem(PANEL_OPEN) === "1") showPanel();
      void loadAccounts(readAccounts());
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

  function widget() {
    try {
      const engine = game.engine();
      if (typeof engine?.widgetManager?.getDefaultWidgetSet !== "function" ||
          typeof engine?.widgetManager?.createOneWidget !== "function") return false;
      const manager = engine.widgetManager;
      const set = manager.getDefaultWidgetSet();
      if (!set || typeof set !== "object") return false;

      const stored = engine.serverStorage?.get?.(
        manager.getPathToHotWidgetVersion?.()
      );
      const empty = manager.getFirstEmptyWidgetSlot?.();
      const fallback = empty ? [empty.slot, empty.container] : null;
      const pos = stored?.[WIDGET_KEY] || fallback;
      if (!Array.isArray(pos) || pos.length < 2) return false;

      const toggle = () => {
        state.panel ? closePanel() : showPanel();
      };
      set[WIDGET_KEY] = {
        keyName: WIDGET_KEY,
        index: pos[0],
        pos: pos[1],
        txt: "Centrum Moderacji",
        type: "red",
        alwaysExist: true,
        default: true,
        clb: toggle
      };
      manager.createOneWidget(WIDGET_KEY, { [WIDGET_KEY]: pos }, true, []);
      return true;
    } catch (error) {
      console.warn("[Centrum Moderacji] Nie udało się utworzyć natywnego widżetu:", error);
      return false;
    }
  }

  function launcher() {
    if (document.getElementById(`${SCRIPT_ID}-launcher`)) return;
    const button = document.createElement("button");
    button.id = `${SCRIPT_ID}-launcher`;
    button.type = "button";
    button.innerHTML = `<strong>C</strong>`;
    button.setAttribute("aria-label", "Otwórz lub zamknij Centrum Moderacji");
    document.body.appendChild(button);
    restorePos(button, LAUNCHER_POS);
    const cleanup = makeMovable(button, {
      positionKey: LAUNCHER_POS,
      handle: button,
      click: () => {
        state.panel ? closePanel() : showPanel();
      }
    });
    runtime.cleanup.push(cleanup);
  }

  function sync() {
    refreshActive(store.database);
    const storage = event => {
      if (event.key === DB_KEY) {
        const db = readDb(true, event.newValue);
        if (state.panel) state.journal = getJournal(20, db);
        refreshActive(db);
      }
      if (event.key === CONFIG_KEY) store.config = readConfig(true, event.newValue);
    };
    const visibility = () => updateTimers();
    window.addEventListener("storage", storage);
    document.addEventListener("visibilitychange", visibility);
    runtime.cleanup.push(() => {
      clearTimeout(runtime.timer);
      window.removeEventListener("storage", storage);
      document.removeEventListener("visibilitychange", visibility);
    });
  }

  function refreshActive(db = readDb()) {
    const details = getActive(db);
    state.active = details;
    render({ main: Boolean(state.panel), active: Boolean(state.activePanel) });
    if (details?.verification?.status === "ACTIVE" && localStorage.getItem(ACTIVE_OPEN) === "1") {
      showActive();
    }
    updateTimers();
    return details;
  }

  function render({ main = false, active = false, map = false } = {}) {
    runtime.renderMain ||= main;
    runtime.renderActive ||= active;
    runtime.renderMap ||= map;
    if (runtime.frame) return;
    runtime.frame = requestAnimationFrame(() => {
      runtime.frame = 0;
      const renderMainNow = runtime.renderMain;
      const renderActiveNow = runtime.renderActive;
      const renderMapNow = runtime.renderMap;
      runtime.renderMain = false;
      runtime.renderActive = false;
      runtime.renderMap = false;
      if (renderMainNow) renderMain();
      if (renderActiveNow) renderActive();
      if (renderMapNow) renderMap();
    });
  }

  function migrate() {
    if (localStorage.getItem(MIGRATION_KEY) === "1") return;
    localStorage.setItem(CONFIG_KEY, JSON.stringify(DEFAULT_CONFIG));
    localStorage.setItem(MIGRATION_KEY, "1");
  }

  function emptyDb() {
    return {
      version: 2,
      nextVerificationId: 1,
      nextParticipantId: 1,
      nextEventId: 1,
      verifications: []
    };
  }

  function readDb(force = false, raw = null) {
    if (!force && store.database) return store.database;
    try {
      const parsed = JSON.parse(raw ?? localStorage.getItem(DB_KEY) ?? "null");
      if (!parsed || !Array.isArray(parsed.verifications)) {
        store.database = emptyDb();
        return store.database;
      }
      const db = {
        ...emptyDb(),
        ...parsed,
        verifications: parsed.verifications
      };
      db.version = 2;
      for (const record of db.verifications) {
        const info = record?.verification || {};
        for (const item of record?.participants || []) {
          item.started_at ||= item.joined_at || info.started_at || info.created_at;
          item.verification_code ||= info.verification_code || "";
          item.start_map_id ??= item.last_map_id ?? info.start_map_id ?? null;
          item.start_map_name ||= item.last_map_name || info.start_map_name || null;
        }
      }
      store.database = db;
      return db;
    } catch {
      store.database = emptyDb();
      return store.database;
    }
  }

  function writeDb(db) {
    store.database = db;
    localStorage.setItem(DB_KEY, JSON.stringify(db));
  }

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function data(record) {
    if (!record) return null;
    return {
      verification: { ...record.verification },
      participants: (record.participants || []).map(participant => ({ ...participant })),
      events: (record.events || []).filter(event =>
        event?.event_type !== "PARTICIPANT_LEFT_MAP" &&
        event?.event_type !== "PARTICIPANT_RETURNED"
      ).map(event => ({ ...event, details: clone(event.details || {}) }))
    };
  }

  function find(db, id) {
    return db.verifications.find(record =>
      String(record?.verification?.id || "") === String(id || "")
    ) || null;
  }

  function addEvent(db, record, event) {
    const now = new Date().toISOString();
    const created = {
      id: String(db.nextEventId++),
      title: event.title || event.eventType || "Zdarzenie",
      event_type: event.eventType || "NOTE",
      details: clone(event.details || {}),
      map_id: event.mapId ?? null,
      map_name: event.mapName || null,
      participant_id: event.participantId ?? null,
      occurred_at: event.occurredAt || now
    };
    record.events ||= [];
    record.events.push(created);
    return created;
  }

  function update(id, change) {
    const db = readDb();
    const record = find(db, id);
    if (!record) return null;
    change(record, db);
    writeDb(db);
    return data(record);
  }

  function getActive(db = readDb()) {
    const world = worldKey(game.world());
    const record = [...db.verifications].reverse().find(item =>
      item?.verification?.status === "ACTIVE" &&
      worldKey(item.verification.world) === world
    );
    return data(record);
  }

  function getJournal(limit = 20, database = readDb()) {
    const world = worldKey(game.world());
    return database.verifications
      .filter(record => worldKey(record?.verification?.world) === world)
      .slice(-limit)
      .reverse()
      .map(data);
  }

  function create(input) {
    const db = readDb();
    const world = worldKey(input.world);
    const existing = db.verifications.find(record =>
      record?.verification?.status === "ACTIVE" &&
      worldKey(record.verification.world) === world
    );
    if (existing) throw new Error("ACTIVE_VERIFICATION_EXISTS");
    const now = new Date().toISOString();
    const id = String(db.nextVerificationId++);
    const pid = String(db.nextParticipantId++);
    const record = {
      verification: {
        id,
        public_number: Number(id),
        world: input.world,
        verifier_character: input.verifierCharacter,
        target_character: input.targetCharacter,
        target_character_id: input.targetCharacterId || null,
        target_account_id: input.targetAccountId || null,
        start_map_id: input.startMapId || null,
        start_map_name: input.startMapName || null,
        source: input.source || "OWN_INITIATIVE",
        verification_code: input.code || "",
        status: "ACTIVE",
        started_at: now,
        ended_at: null,
        created_at: now,
        updated_at: now
      },
      participants: [{
        id: pid,
        character_name: input.targetCharacter,
        character_id: input.targetCharacterId || null,
        account_id: input.targetAccountId || null,
        joined_at: now,
        started_at: now,
        verification_code: input.code || "",
        start_map_id: input.startMapId || null,
        start_map_name: input.startMapName || null,
        resolved_at: null
      }],
      events: []
    };
    addEvent(db, record, {
      title: "Utworzono sesję weryfikacji",
      eventType: "VERIFICATION_CREATED",
      details: {
        targetCharacter: input.targetCharacter,
        moderator: input.verifierCharacter,
        code: input.code || ""
      },
      mapId: input.startMapId,
      mapName: input.startMapName,
      participantId: pid
    });
    addEvent(db, record, {
      title: "Rozpoczęto weryfikację",
      eventType: "VERIFICATION_STARTED",
      details: {
        targetCharacter: input.targetCharacter,
        moderator: input.verifierCharacter,
        code: input.code || ""
      },
      mapId: input.startMapId,
      mapName: input.startMapName,
      participantId: pid
    });
    db.verifications.push(record);
    writeDb(db);
    return data(record);
  }

  function normalizeConfig(value = {}) {
    const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    return {
      local: typeof source.local === "string" ? source.local : DEFAULT_CONFIG.local,
      startDelaySeconds: Math.max(0, Number.isFinite(Number(source.startDelaySeconds)) ? Number(source.startDelaySeconds) : DEFAULT_CONFIG.startDelaySeconds),
      console: typeof source.console === "string" ? source.console : DEFAULT_CONFIG.console,
      sendCode: typeof source.sendCode === "string" ? source.sendCode : DEFAULT_CONFIG.sendCode,
      sendNick: typeof source.sendNick === "string" ? source.sendNick : DEFAULT_CONFIG.sendNick,
      sendScreen: typeof source.sendScreen === "string" ? source.sendScreen : DEFAULT_CONFIG.sendScreen,
      sendTrade: typeof source.sendTrade === "string" ? source.sendTrade : DEFAULT_CONFIG.sendTrade,
      sendAttack: typeof source.sendAttack === "string" ? source.sendAttack : DEFAULT_CONFIG.sendAttack,
      sendReminder: typeof source.sendReminder === "string" ? source.sendReminder : DEFAULT_CONFIG.sendReminder,
      finish: typeof source.finish === "string" ? source.finish : DEFAULT_CONFIG.finish
    };
  }

  function readConfig(force = false, raw = null) {
    if (!force && store.config) return store.config;
    try {
      store.config = normalizeConfig(JSON.parse(raw ?? localStorage.getItem(CONFIG_KEY) ?? "{}"));
    } catch {
      store.config = normalizeConfig();
    }
    return store.config;
  }

  function writeConfig(value) {
    store.config = normalizeConfig(value);
    localStorage.setItem(CONFIG_KEY, JSON.stringify(store.config));
    return store.config;
  }

  function collect(root) {
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

  function save(root, showNotice = false) {
    if (!root?.isConnected) return false;
    try {
      const expected = normalizeConfig(collect(root));
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

  function playerInfo(other) {
    try {
      if (!other || typeof other !== "object") return null;
      const data = other.d || other;
      const nick = normalize(data.nick || other.getNick?.());
      const id = String(data.id ?? other.getId?.() ?? "");
      if (!id || !nick) return null;
      return {
        id,
        nick,
        accountId: accountId(other)
      };
    } catch (error) {
      console.warn("[Centrum Moderacji] Dane gracza:", error);
      return null;
    }
  }

  function bindGame() {
    const api = game.api();
    const data = game.engine()?.apiData;
    if (typeof api?.addCallbackToEvent !== "function" || !data) {
      console.warn("[Centrum Moderacji] Klient nie udostępnił API zdarzeń graczy.");
      return;
    }
    const player = () => {
      if (state.activePanel) render({ map: true });
    };
    let signature = `${game.heroId()}\u0000${worldKey(game.world())}`;
    const hero = () => {
      const next = `${game.heroId()}\u0000${worldKey(game.world())}`;
      if (next === signature) return;
      signature = next;
      render({ active: true });
    };
    const events = [
      [data.NEW_OTHER, player],
      [data.REMOVE_OTHER, () => {
        if (state.activePanel) render({ map: true });
      }],
      [data.HERO_UPDATE, hero]
    ];
    const added = [];
    try {
      if (events.some(([event]) => !event)) throw new Error("brak wymaganego zdarzenia graczy");
      for (const item of events) {
        api.addCallbackToEvent(...item);
        added.push(item);
      }
      runtime.cleanup.push(() => {
        for (const [event, callback] of added) {
          try { api.removeCallbackFromEvent(event, callback); } catch {}
        }
      });
    } catch (error) {
      for (const [event, callback] of added.reverse()) {
        try { api.removeCallbackFromEvent(event, callback); } catch {}
      }
      added.length = 0;
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
    const native = map?.updateDATA;
    if (!map || typeof native !== "function" || native[MAP_HOOK]) return false;
    const hook = function(...args) {
      const result = native.apply(this, args);
      if (state.activePanel) render({ map: true });
      return result;
    };
    Object.defineProperty(hook, MAP_HOOK, { value: true });
    map.updateDATA = hook;
    runtime.cleanup.push(() => {
      if (map.updateDATA === hook) map.updateDATA = native;
    });
    return true;
  }

  function hookMenu() {
    const others = game.engine()?.others;
    const source = others?.addMcPanelToMenu;
    if (!others || typeof source !== "function") return false;
    if (source[MENU_HOOK]) return true;

    const native = source;
    const hook = function(playerId, playerNick, menu, ...rest) {
      const result = native.apply(this, [playerId, playerNick, menu, ...rest]);
      const other = game.other(playerId);
      const card = game.engine()?.businessCardManager?.getCard?.(playerId);
      const player = other ? playerInfo(other) : {
        nick: normalize(card?.getNick?.() || playerNick),
        id: String(card?.getId?.() ?? playerId ?? "") || null,
        accountId: parseId(card?.getAcc?.()) || null
      };
      addActions(menu, player);
      return result;
    };
    Object.defineProperty(hook, MENU_HOOK, {
      value: true,
      configurable: false,
      enumerable: false,
      writable: false
    });

    try {
      others.addMcPanelToMenu = hook;
      runtime.cleanup.push(() => {
        if (others.addMcPanelToMenu === hook) others.addMcPanelToMenu = native;
      });
      const win = game.engine()?.worldWindow;
      const open = win?.open;
      if (win && typeof open === "function" && !open[WORLD_HOOK]) {
        const hook = function(...args) {
          const result = open.apply(this, args);
          hookOnline();
          return result;
        };
        Object.defineProperty(hook, WORLD_HOOK, { value: true });
        win.open = hook;
        runtime.cleanup.push(() => {
          if (win.open === hook) win.open = open;
        });
      }
      hookOnline();
      return others.addMcPanelToMenu === hook;
    } catch {
      return false;
    }
  }

  function hookOnline() {
    const online = game.engine()?.worldWindow?.playersOnline;
    const native = online?.createContextMenu;
    if (!online || typeof native !== "function" || native[ONLINE_HOOK]) return false;
    const hook = function(event, record, ...rest) {
      const ui = game.engine()?.interface;
      const popup = ui?.showPopupMenu;
      if (typeof popup !== "function") return native.apply(this, [event, record, ...rest]);
      const popupHook = function(menu, ...args) {
        addActions(menu, {
          nick: normalize(record?.n),
          id: String(record?.c ?? "") || null,
          accountId: parseId(record?.a) || null
        });
        return popup.apply(this, [menu, ...args]);
      };
      ui.showPopupMenu = popupHook;
      try {
        return native.apply(this, [event, record, ...rest]);
      } finally {
        if (ui.showPopupMenu === popupHook) ui.showPopupMenu = popup;
      }
    };
    Object.defineProperty(hook, ONLINE_HOOK, { value: true });
    online.createContextMenu = hook;
    runtime.cleanup.push(() => {
      if (online.createContextMenu === hook) online.createContextMenu = native;
    });
    return online.createContextMenu === hook;
  }

  function addActions(menu, player) {
    if (!Array.isArray(menu)) return;
    if (!player?.nick || sameNick(player.nick, game.heroNick())) return;

    const copy = "KOPIUJ ID";
    if (!menu.some(entry => Array.isArray(entry) && normalize(entry[0]) === copy)) {
      menu.push([copy, () => copyId(player)]);
    }

    const active = state.active?.verification?.status === "ACTIVE";
    const label = active ? "Dodaj do aktywnej weryfikacji" : "Rozpocznij weryfikację";
    if (menu.some(entry => Array.isArray(entry) && normalize(entry[0]) === label)) return;

    menu.push([label, () => verify(player)]);
  }

  async function copyId(player) {
    const id = parseId(player?.accountId);
    if (!id) {
      notice(`Nie udało się odczytać ID konta gracza ${player?.nick || "—"}.`);
      return false;
    }
    if (!state.panel) showPanel({
      nick: player?.nick,
      id: player?.id
    });
    const win = state.panel?.querySelector(".mc-window");
    win?.scrollTo({ top: 0, behavior: "smooth" });
    try {
      await navigator.clipboard?.writeText?.(id);
    } catch {}
    await loadAccount(player);
    notice(`Obsłużono konto ${id} gracza ${player?.nick} w Centrum Moderacji.`);
    return true;
  }

  function parseId(value) {
    const text = String(value || "").trim();
    if (/^\d{3,12}$/.test(text)) return text;
    const match = text.match(/profile\/view,(\d{3,12})/i);
    return match ? match[1] : "";
  }

  function parseIds(value) {
    const ids = new Set();
    for (const match of String(value || "").matchAll(/profile\/view,(\d{3,12})(?!\d)(?:#char_\d+,[^,\s;]+)?|(?<![\p{L}\p{N}_])(\d{3,12})(?![\p{L}\p{N}_])/giu)) {
      ids.add(match[1] || match[2]);
    }
    return [...ids];
  }

  async function loadChars(id) {
    const world = game.world();
    try {
      const html = await profile(id);
      return { characters: excludeSelf(parseChars(html, world)), loaded: true };
    } catch (error) {
      notice(`Nie udało się odczytać publicznego profilu konta ${id} (${error?.message || "błąd połączenia"}). Pokazano wyłącznie pasujące postacie aktualnie widoczne w kliencie.`);
      return { characters: excludeSelf(visible(id, world)), loaded: false };
    }
  }

  function readAccounts() {
    try {
      const stored = JSON.parse(localStorage.getItem(ACCOUNT_KEY) || "[]");
      return [...new Set((Array.isArray(stored) ? stored : []).map(parseId).filter(Boolean))];
    } catch {
      return [];
    }
  }

  function writeAccounts(input) {
    const ids = [...new Set(input.map(parseId).filter(Boolean))];
    localStorage.setItem(ACCOUNT_KEY, JSON.stringify(ids));
  }

  async function loadAccounts(input) {
    const ids = (Array.isArray(input) ? input : [input]).map(parseId).filter(Boolean);
    const versions = new Map();
    for (const id of ids) {
      const version = runtime.versions.get(id) || 0;
      runtime.versions.set(id, version);
      versions.set(id, version);
    }
    const existing = new Set(state.accounts.map(group => group.accountId));
    const button = state.panel?.querySelector("[data-select-player]");
    if (button) {
      button.disabled = true;
      button.textContent = "Pobieranie…";
    }
    try {
      for (const id of ids) {
        if (existing.has(id)) continue;
        existing.add(id);
        const version = versions.get(id);
        if (runtime.versions.get(id) !== version) continue;
        const { characters: chars, loaded } = await loadChars(id);
        if (runtime.versions.get(id) !== version) continue;
        if (state.accounts.some(group => group.accountId === id)) continue;
        state.accounts.push({ accountId: id, characters: chars });
        if (loaded) writeAccounts([...readAccounts(), id]);
        select([
          ...state.selected,
          ...chars.map(char => ({
            nick: char.name,
            id: char.id || playerId(char.name) || ""
          }))
        ], { renderActive: true });
      }
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = "Wykryj postacie";
      }
      renderAccounts();
    }
  }

  function profile(id) {
    const key = String(id);
    if (runtime.profiles.has(key)) return runtime.profiles.get(key);
    const domain = location.hostname.endsWith(".com") ? "www.margonem.com" : "www.margonem.pl";
    const url = `https://${domain}/profile/view,${encodeURIComponent(id)}`;
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
          const returned = parseId(response.finalUrl || "");
          if (returned && returned !== String(id)) {
            reject(new Error("serwis zwrócił profil innego konta"));
            return;
          }
          if (!String(response.responseText || "").trim()) {
            reject(new Error("pusty profil"));
            return;
          }
          const html = response.responseText;
          resolve(html);
        },
        ontimeout: () => reject(new Error("przekroczono czas połączenia")),
        onerror: () => reject(new Error("błąd połączenia z profilem"))
      });
    });
    runtime.profiles.set(key, request);
    request.then(
      () => runtime.profiles.delete(key),
      () => runtime.profiles.delete(key)
    );
    return request;
  }

  function parseChars(html, world) {
    const doc = new DOMParser().parseFromString(String(html || ""), "text/html");
    const wanted = worldKey(world);
    const chars = [...doc.querySelectorAll(".char-row")].map(row => ({
      name: normalize(row.dataset.nick),
      id: normalize(row.dataset.id),
      level: normalize(row.dataset.lvl),
      world: normalize(row.dataset.world)
    }));

    const seen = new Set();
    return chars
      .filter(char => char.name && worldKey(char.world) === wanted)
      .filter(char => {
        const key = char.name.toLocaleLowerCase("pl");
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map(char => ({
        name: char.name,
        id: char.id || null,
        level: finite(char.level),
        world: char.world
      }))
      .sort((left, right) =>
      Number(right.level || 0) - Number(left.level || 0) ||
      left.name.localeCompare(right.name, "pl")
    );
  }

  function visible(id, world) {
    return excludeSelf(Object.values(game.others()).map(playerInfo).filter(Boolean)
      .filter(player => String(player.accountId || "") === id)
      .map(player => ({
        name: player.nick,
        id: player.id || null,
        level: null,
        world
      })));
  }

  function excludeSelf(chars) {
    const nick = game.heroNick();
    const id = String(game.heroId() || "");
    return chars.filter(char => {
      const name = char?.name || char?.nick || "";
      const cid = String(char?.id || "");
      if (nick && sameNick(name, nick)) return false;
      if (id && cid && cid === id) return false;
      return true;
    });
  }

  function renderAccounts() {
    const target = state.panel?.querySelector("[data-search-results]");
    if (!target) return;
    const world = game.world();
    const open = new Set(
      [...target.querySelectorAll('[data-toggle-account][aria-expanded="true"]')]
        .map(toggle => toggle.closest("[data-account-group]")?.dataset.accountId)
        .filter(Boolean)
    );
    const selected = state.selected;
    if (!state.accounts.length) {
      target.innerHTML = "";
      return;
    }
    target.innerHTML = `
      ${state.accounts.map(group => {
        const expanded = open.has(group.accountId);
        const nick = group.characters[0]?.name;
        return `
        <section class="mc-account-group" data-account-group data-account-id="${escAttr(group.accountId)}">
          <div class="mc-account-group-head">
            <button type="button" data-toggle-account aria-expanded="${expanded}" aria-label="${expanded ? "Zwiń" : "Rozwiń"} konto">${expanded ? "▾" : "▸"}</button>
            <span>Konto ${escHtml(group.accountId)}</span>
            ${nick ? `<span class="mc-account-group-nick">${escHtml(nick)}</span>` : ""}
            <button type="button" data-remove-account="${escAttr(group.accountId)}" aria-label="Usuń konto">×</button>
          </div>
          <div class="mc-account-character-list" ${expanded ? "" : "hidden"}>
            ${group.characters.length ? group.characters.map((char, index) => `
              <label class="mc-account-character">
                <input
                  type="checkbox"
                  data-account-character
                  data-character-index="${index}"
                  value="${escAttr(char.name)}"
                  ${selected.some(player => sameNick(player.nick, char.name)) ? "checked" : ""}
                >
                <span>
                  <strong>${escHtml(char.name)}</strong>
                  <small>${[
                    char.level ? `${char.level} lvl` : "",
                    char.id ? `ID postaci ${char.id}` : ""
                  ].filter(Boolean).map(escHtml).join(" · ")}</small>
                </span>
              </label>`).join("") : `<p class="mc-muted">Nie wykryto postaci na świecie ${escHtml(world)}.</p>`}
          </div>
        </section>`;
      }).join("")}
      <div class="mc-account-batch" data-account-batch hidden>
        <span data-account-selection-count></span>
        <label class="mc-account-batch-time">Czas<input data-time placeholder="np. 12h"></label>
        <button type="button" class="danger" data-account-batch-command="kill">Zabij</button>
        <button type="button" class="danger" data-account-batch-command="unkill">Zdejmij zabicie</button>
      </div>`;
    const count = selectedChars().length;
    target.querySelector("[data-account-selection-count]").textContent = `Zaznaczono: ${count}`;
    target.querySelector("[data-account-batch]").hidden = count === 0;
  }

  function selectedChars() {
    return state.accounts
      .flatMap(group => group.characters)
      .filter(char => state.selected.some(player => sameNick(player.nick, char.name)))
      .map(char => ({
        nick: char.name,
        id: char.id || playerId(char.name) || ""
      }));
  }

  function syncSelected() {
    const target = state.panel?.querySelector("[data-search-results]");
    if (!target) return;
    const selected = [...target.querySelectorAll("[data-account-character]:checked")]
      .map(input => {
        const element = input.closest("[data-account-group]");
        const group = state.accounts.find(item => item.accountId === element?.dataset.accountId);
        const char = group?.characters[Number(input.dataset.characterIndex)];
        return char && {
          nick: char.name,
          id: char.id || playerId(char.name) || ""
        };
      })
      .filter(Boolean);
    select(selected, { renderActive: true });
    const batch = state.panel?.querySelector("[data-account-batch]");
    const count = state.panel?.querySelector("[data-account-selection-count]");
    if (count) count.textContent = `Zaznaczono: ${selected.length}`;
    if (batch) batch.hidden = selected.length === 0;
  }

  function removeAccount(value) {
    const id = String(value);
    const group = state.accounts.find(item => item.accountId === id);
    const nicks = (group?.characters || []).map(character => character.name);
    runtime.versions.set(id, (runtime.versions.get(id) || 0) + 1);
    state.accounts = state.accounts.filter(group => group.accountId !== id);
    writeAccounts(readAccounts().filter(item => item !== id));
    select(state.selected.filter(player =>
      !nicks.some(name => sameNick(name, player.nick))
    ), { renderActive: true });
    renderAccounts();
  }

  function clearView() {
    state.accounts = [];
    select([], { renderActive: true });
    const input = state.panel?.querySelector("[data-search]");
    const results = state.panel?.querySelector("[data-search-results]");
    if (input) input.value = "";
    if (results) results.innerHTML = "";
  }

  function clearAccounts() {
    for (const id of runtime.versions.keys()) runtime.versions.set(id, runtime.versions.get(id) + 1);
    clearView();
    writeAccounts([]);
  }

  async function loadAccount(player) {
    const nick = normalize(player?.nick || player?.name);
    const cid = player?.id || null;
    const id = parseId(player?.accountId) || accountId(game.other(cid));
    if (!id) {
      notice(`Nie udało się odczytać ID konta gracza ${nick || "—"} bezpośrednio z danych klienta.`);
      return false;
    }
    if (!state.panel) showPanel();
    state.panel?.querySelector(".mc-window")?.scrollTo({ top: 0, behavior: "smooth" });
    await loadAccounts([id]);
    state.panel?.querySelector("[data-search-results]")?.scrollIntoView({ block: "nearest" });
    return true;
  }

  async function openAccount(id) {
    const info = state.active?.verification;
    const player = (state.active?.participants || []).find(item =>
      String(item.id) === String(id)
    );
    if (!info || info.status !== "ACTIVE" || !player) {
      notice("Nie znaleziono uczestnika aktywnej weryfikacji.");
      return;
    }
    select([
      ...state.selected,
      { nick: player.character_name, id: player.character_id || playerId(player.character_name) || "" }
    ], { renderActive: true });
    await loadAccount({
      nick: player.character_name,
      id: player.character_id,
      accountId: player.account_id
    });
  }

  async function search() {
    const input = state.panel?.querySelector("[data-search]");
    const value = input?.value || "";
    if (!value) return notice("Wpisz ID konta albo link do profilu.");
    const ids = parseIds(value);
    if (!ids.length) {
      notice("Wpisz poprawne ID konta lub pełne linki do profili Margonem.");
      input?.focus();
      return;
    }
    await loadAccounts(ids);
  }

  function renderSelected() {
    if (!state.panel) return;
    state.panel.querySelector("[data-selected]").textContent = state.selected.map(item => item.nick).join(", ") || "nie rozpoznano";
  }

  function select(players = [], options = {}) {
    const normalized = [];
    const seen = new Set();
    for (const player of players) {
      const nick = normalize(player?.nick);
      if (!nick) continue;
      const key = nick.toLocaleLowerCase("pl");
      if (seen.has(key)) continue;
      seen.add(key);
      normalized.push({
        nick,
        id: player?.id || playerId(nick) || ""
      });
    }
    state.selected = normalized;
    renderSelected();
    if (options.renderActive && state.activePanel) render({ active: true });
  }

  function values(extra = {}) {
    const nick = Object.prototype.hasOwnProperty.call(extra, "nick")
      ? normalize(extra.nick)
      : state.selected.map(item => item.nick).join(", ");
    const item = findParticipant(nick);
    const reason = normalize(state.panel?.querySelector("[data-reason]")?.value);
    return {
      nick,
      moderator: game.heroNick(),
      czas: normalize(state.panel?.querySelector("[data-time]")?.value),
      powod: reason,
      tresc: reason,
      kod: Object.prototype.hasOwnProperty.call(extra, "kod")
        ? normalize(extra.kod)
        : normalize(state.panel?.querySelector("[data-code]")?.value)
        || normalize(item?.verification_code)
        || normalize(state.active?.verification?.verification_code),
      ...extra
    };
  }

  function fill(content, extra = {}) {
    const data = { ...values(), ...extra };
    const missing = [];
    const result = String(content || "")
      .replace(/\{(nick|moderator|czas|powod|powód|kod|tresc|treść)\}/gi, (_, raw) => {
      const key = raw.toLocaleLowerCase("pl").replace("powód", "powod").replace("treść", "tresc");
      const value = normalize(data[key]);
      if (!value) missing.push(`{${raw}}`);
      return value;
      });
    return { content: result, missing: [...new Set(missing)] };
  }

  async function runPenalty(action, players = null, options = {}) {
    if (action !== "kill" && action !== "unkill") return notice("Nieobsługiwane polecenie moderacyjne.");
    const time = Object.prototype.hasOwnProperty.call(options, "czas")
      ? normalize(options.czas)
      : null;
    const targets = (Array.isArray(players) ? players : [...state.selected])
      .map(target => ({
        nick: normalize(target?.nick || target?.name),
        id: target?.id || playerId(target?.nick || target?.name) || ""
      }))
      .filter(target => target.nick);
    if (!targets.length) return notice("Najpierw wybierz gracza.");
    const label = action === "kill" ? "ZABICIE POSTACI" : "ZDJĘCIE ZABICIA";
    for (let index = 0; index < targets.length; index += 1) {
      const player = targets[index];
      const item = findParticipant(player.nick);
      const data = values({
        nick: player.nick,
        kod: normalize(item?.verification_code)
          || normalize(state.panel?.querySelector("[data-code]")?.value)
          || normalize(state.active?.verification?.verification_code),
        ...(time !== null ? { czas: time } : {})
      });
      let command;
      if (action === "kill") {
        if (!data.czas) return notice("Wpisz czas kary.");
        command = `.kill "${data.nick}" ${data.czas}${data.powod ? ` "${escCmd(data.powod)}"` : ""}`;
      } else {
        command = `.unkill "${data.nick}"`;
      }
      if (!sendConsole(command)) return notice("Konsola gry nie jest obecnie dostępna.");
      await log(label, command, "CONSOLE", data.nick);
      if (Number(options.delayMs) > 0 && index < targets.length - 1) {
        await wait(options.delayMs);
      }
    }
    notice(targets.length > 1
      ? `Wysłano polecenie „${label}” osobno do ${targets.length} graczy.`
      : `Wysłano polecenie: ${label}.`);
  }

  async function batch(action) {
    const players = selectedChars();
    if (players.length === 0) {
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
    const ok = await confirmAction({
      title: operation,
      message: `Czy na pewno chcesz ${operation} dla ${players.length} zaznaczonych postaci?\n\n${players.map(player => `• ${player.nick}`).join("\n")}`,
      confirmLabel: operation,
      danger: true
    });
    if (!ok) return;
    await runPenalty(action, players, { delayMs: 750, czas: time });
  }

  async function log(name, content, channel, nick = "") {
    const info = state.active?.verification;
    if (!info || info.status !== "ACTIVE") return;
    const player = findParticipant(nick);
    const map = game.map();
    state.active = update(info.id, (record, db) => {
      addEvent(db, record, {
        title: `Wysłano polecenie ${name}`,
        eventType: "READY_COMMAND_SENT",
        details: {
          commandName: name,
          content,
          channel,
          targetCharacter: nick || null,
          moderator: game.heroNick()
        },
        mapId: map.id,
        mapName: map.name,
        participantId: player?.id || null
      });
    });
    if (state.panel) {
      state.journal = getJournal();
      render({ main: true });
    }
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

  async function sendLater(message, name, nick) {
    await wait(readConfig().startDelaySeconds * 1000);
    const sent = await sendLocal(message);
    if (sent) await log(name, message, "LOCAL", nick);
    else notice(`Nie udało się wysłać opóźnionej wiadomości lokalnej do gracza ${nick}.`);
  }

  function runOnce(key, action) {
    if (runtime.running.has(key)) return Promise.resolve(false);
    runtime.running.add(key);
    return Promise.resolve().then(action).finally(() => runtime.running.delete(key));
  }

  function verify(player) {
    const nick = normalize(player?.nick);
    return runOnce(`verify:${nick.toLocaleLowerCase("pl")}`, async () => {
      let info = state.active?.verification;
      if (info?.status !== "ACTIVE") info = null;
      const mod = game.heroNick();
      if (!nick) return notice("Nie udało się rozpoznać nicku wskazanego gracza.");
      if (!mod) return notice("Klient gry nie udostępnił danych aktualnej postaci.");
      if (info && (state.active?.participants || []).some(item => !item.resolved_at && sameNick(item.character_name, nick))) {
        return notice("Ten gracz jest już w aktywnej weryfikacji.");
      }
      const id = player.id || playerId(nick) || null;
      const account = parseId(player?.accountId) || accountId(game.other(id));
      const map = game.map();
      const code = genCode();
      const config = readConfig();
      const data = { nick, moderator: mod, kod: code, czas: "", powod: "", tresc: "" };
      const local = fill(config.local, data);
      const command = fill(config.console, data);
      if (local.missing.length || command.missing.length) {
        return notice(`Treść rozpoczęcia wymaga danych: ${[...new Set([...local.missing, ...command.missing])].join(", ")}.`);
      }
      const sent = sendConsole(command.content);
      try {
        if (!info) {
          try {
            state.active = create({
              world: game.world(), verifierCharacter: mod, targetCharacter: nick,
              targetCharacterId: id, targetAccountId: account,
              startMapId: map.id, startMapName: map.name, source: "OWN_INITIATIVE",
              code
            });
          } catch (error) {
            if (error.message !== "ACTIVE_VERIFICATION_EXISTS") throw error;
            state.active = getActive();
            info = state.active?.verification;
            if (info?.status !== "ACTIVE") throw error;
          }
        }
        if (info) {
          state.active = update(info.id, (record, db) => {
            if ((record.participants || []).some(item => !item.resolved_at && sameNick(item.character_name, nick))) {
              throw new Error("PARTICIPANT_ALREADY_ADDED");
            }
            const joined = new Date().toISOString();
            const item = {
              id: String(db.nextParticipantId++), character_name: nick,
              character_id: id, account_id: account || null,
              joined_at: joined, started_at: joined, verification_code: code,
              start_map_id: map.id, start_map_name: map.name, resolved_at: null
            };
            record.participants.push(item);
            addEvent(db, record, {
              title: `Dodano gracza ${nick} do aktywnej weryfikacji`,
              eventType: "PARTICIPANT_ADDED",
              details: { characterName: nick, moderator: mod, code },
              mapId: map.id, mapName: map.name, participantId: item.id
            });
          });
        }
        render({ main: Boolean(state.panel), active: Boolean(state.activePanel) });
        const name = info ? "DOŁĄCZENIE DO WERYFIKACJI" : "ROZPOCZĘCIE";
        let refresh = true;
        try {
          if (sent) {
            await log(`${name} — UPOMNIENIE`, command.content, "CONSOLE", nick);
            refresh = false;
          } else if (info) {
            notice(`Dodano ${nick}, ale klient nie udostępnił konsoli do wysłania .reminder.`);
          }
        } finally {
          if (refresh && state.panel) {
            state.journal = getJournal();
            render({ main: true });
          }
        }
        void sendLater(local.content, `${name} — CZAT LOKALNY`, nick);
        select([...(info ? state.selected : []), { nick, id: id || "" }], { renderActive: Boolean(info) });
        if (!info) {
          const input = state.panel?.querySelector("[data-code]");
          if (input) input.value = code;
          localStorage.setItem(ACTIVE_OPEN, "1");
          showActive();
        }
        void loadAccounts([account]);
        if (id) state.activePanel?.querySelector(`[data-map-player-list] [data-player-id="${CSS.escape(String(id))}"]`)?.classList.add("mc-verifying");
        notice(info
          ? `Dodano ${nick} do aktywnej weryfikacji. Kod gracza: ${code}.`
          : `Rozpoczęto weryfikację gracza ${nick}. Kod: ${code}.`);
        return true;
      } catch (error) {
        const label = error.message === "PARTICIPANT_ALREADY_ADDED" ? "Ten gracz jest już w aktywnej weryfikacji." : error.message;
        notice(info ? `Nie udało się dodać gracza (${label}).` : `Nie udało się utworzyć sesji (${label}).`);
        return false;
      }
    });
  }

  function findParticipant(nick) {
    const wanted = normalize(nick).toLocaleLowerCase("pl");
    return state.active?.participants?.find(item => normalize(item.character_name).toLocaleLowerCase("pl") === wanted) || null;
  }

  function findActive(id, players = state.active?.participants) {
    return (players || []).find(item =>
      String(item.id) === String(id) && !item.resolved_at
    ) || null;
  }

  function started(player, info = state.active?.verification) {
    return player?.started_at || player?.joined_at || info?.started_at || info?.created_at;
  }

  function code(player, info = state.active?.verification) {
    return normalize(player?.verification_code)
      || normalize(info?.verification_code)
      || "—";
  }

  function startMap(player, info = state.active?.verification) {
    return player?.start_map_name || player?.last_map_name || info?.start_map_name || "—";
  }

  function time(player, info = state.active?.verification) {
    const start = new Date(started(player, info)).getTime();
    const end = player?.resolved_at ? new Date(player.resolved_at).getTime() : Date.now();
    return duration(Math.max(0, end - start));
  }

  async function sendCode(id) {
    const info = state.active?.verification;
    if (!info || info.status !== "ACTIVE") return notice("Brak aktywnej weryfikacji.");
    const player = findActive(id);
    if (!player) return notice("Ten uczestnik nie ma aktywnej weryfikacji.");
    const code = genCode();
    const map = game.map();
    let refresh = false;
    try {
      state.active = update(info.id, (record, db) => {
        const item = findActive(id, record.participants);
        if (!item) throw new Error("PARTICIPANT_NOT_ACTIVE");
        item.verification_code = code;
        item.code_updated_at = new Date().toISOString();
        record.verification.updated_at = new Date().toISOString();
        addEvent(db, record, {
          title: `Wylosowano nowy kod dla ${item.character_name}`,
          eventType: "CODE_GENERATED",
          details: { code, moderator: game.heroNick(), characterName: item.character_name },
          mapId: map.id,
          mapName: map.name,
          participantId: item.id
        });
      });
      refresh = true;
      render({ main: Boolean(state.panel), active: Boolean(state.activePanel) });
      const result = fill(readConfig().sendCode, {
        nick: player.character_name,
        moderator: game.heroNick(),
        kod: code,
        czas: "",
        powod: "",
        tresc: ""
      });
      if (!result.content.trim() || result.missing.length) {
        throw new Error(`Polecenie „Wyślij kod” wymaga danych: ${result.missing.join(", ") || "treść polecenia"}`);
      }
      const command = result.content.trim();
      const sent = sendConsole(command);
      if (sent) {
        await log("NOWY KOD WERYFIKACYJNY", command, "CONSOLE", player.character_name);
        refresh = false;
      }
      notice(sent
        ? `Wysłano nowy kod ${code} graczowi ${player.character_name}.`
        : `Wylosowano kod ${code}, ale klient nie udostępnił konsoli do wysłania .reminder.`);
    } catch (error) {
      notice(`Nie udało się wysłać nowego kodu (${error.message}).`);
    } finally {
      if (refresh && state.panel) {
        state.journal = getJournal();
        render({ main: true });
      }
    }
  }

  async function send(id, key) {
    const info = state.active?.verification;
    if (!info || info.status !== "ACTIVE") return notice("Brak aktywnej weryfikacji.");
    const player = findActive(id);
    if (!player) return notice("Ten uczestnik nie ma aktywnej weryfikacji.");
    const defs = {
      sendNick: { label: "WYŚLIJ NICK" },
      sendScreen: { label: "WYŚLIJ SCREEN" },
      sendTrade: { label: "HANDEL" },
      sendAttack: { label: "ATAK MOBÓW" },
      sendReminder: { label: "PONAGLIJ" }
    };
    const def = defs[key];
    if (!def) return notice("Nieznany typ polecenia.");
    const template = readConfig()[key];
    const result = fill(template, {
      nick: player.character_name,
      moderator: game.heroNick(),
      kod: code(player, info),
      czas: "",
      powod: "",
      tresc: ""
    });
    if (!result.content.trim() || result.missing.length) {
      return notice(`Polecenie „${def.label}” wymaga danych: ${result.missing.join(", ") || "treść polecenia"}.`);
    }
    const command = result.content.trim();
    if (!sendConsole(command)) {
      return notice("Klient nie udostępnił konsoli do wysłania polecenia.");
    }
    await log(def.label, command, "CONSOLE", player.character_name);
    notice(`Wysłano polecenie „${def.label}” graczowi ${player.character_name}.`);
  }

  function finish(id) {
    return runOnce(`finish:${id}`, async () => {
      const info = state.active?.verification;
      if (!info || info.status !== "ACTIVE") return notice("Brak aktywnej weryfikacji.");
      const player = findActive(id);
      if (!player) return notice("Ten uczestnik nie ma aktywnej weryfikacji.");
      if (!await confirmAction({
        title: "Zakończ weryfikację",
        message: `Zakończyć weryfikację gracza ${player.character_name}?`,
        confirmLabel: "Zakończ",
        danger: true
      })) return;
      const template = readConfig().finish;
      const message = fill(template, {
        nick: player.character_name,
        moderator: game.heroNick(),
      }).content.trim();
      const map = game.map();
      try {
        let finished = false;
        state.active = update(info.id, (record, db) => {
          const ended = new Date().toISOString();
          const stored = findActive(id, record.participants);
          if (!stored) throw new Error("PARTICIPANT_NOT_ACTIVE");
          stored.resolved_at = ended;
          addEvent(db, record, {
            title: `Zakończono weryfikację gracza ${stored.character_name}`,
            eventType: "PARTICIPANT_FINISHED",
            details: {
              characterName: stored.character_name,
              announcement: message,
              moderator: game.heroNick()
            },
            mapId: map.id,
            mapName: map.name,
            participantId: stored.id
          });
          finished = !(record.participants || []).some(item => !item.resolved_at);
          if (finished) {
            record.verification.status = "COMPLETED";
            record.verification.ended_at = ended;
            addEvent(db, record, {
              title: "Zakończono całą weryfikację",
              eventType: "VERIFICATION_FINISHED",
              details: { moderator: game.heroNick() },
              mapId: map.id,
              mapName: map.name
            });
          }
          record.verification.updated_at = ended;
        });
        if (state.panel) state.journal = getJournal();
        render({ main: Boolean(state.panel), active: Boolean(state.activePanel) });
        if (player.character_id) state.activePanel?.querySelector(`[data-map-player-list] [data-player-id="${CSS.escape(String(player.character_id))}"]`)?.classList.remove("mc-verifying");
        const sent = message ? await sendLocal(message) : true;
        select(state.selected.filter(item => !sameNick(item.nick, player.character_name)));
        if (finished) {
          closeActive();
        }
        notice(sent
          ? `Weryfikacja gracza ${player.character_name} została zakończona.`
          : `Zakończono weryfikację gracza ${player.character_name}, ale nie udało się wysłać komunikatu na czat lokalny.`);
      } catch (error) {
        notice(`Nie udało się zakończyć weryfikacji (${error.message}).`);
      }
    });
  }

  function finishAll() {
    return runOnce("finish-all", async () => {
      const info = state.active?.verification;
      if (!info || info.status !== "ACTIVE") return notice("Brak aktywnej weryfikacji.");
      const players = (state.active.participants || []).filter(item => !item.resolved_at);
      if (!players.length) return notice("Brak aktywnych uczestników.");
      if (!await confirmAction({
        title: "Zakończ wszystkie weryfikacje",
        message: `Zakończyć weryfikację wszystkich aktywnych graczy (${players.length})?`,
        confirmLabel: "Zakończ wszystkich",
        danger: true
      })) return;

      const template = readConfig().finish;
      const mod = game.heroNick();
      const map = game.map();
      const list = players.map(player => ({
        player,
        content: fill(template, {
          nick: player.character_name,
          moderator: mod
        }).content.trim()
      }));
      try {
        state.active = update(info.id, (record, db) => {
          const ended = new Date().toISOString();
          for (const { player, content } of list) {
            const stored = findActive(player.id, record.participants);
            if (!stored) continue;
            stored.resolved_at = ended;
            addEvent(db, record, {
              title: `Zakończono weryfikację gracza ${stored.character_name}`,
              eventType: "PARTICIPANT_FINISHED",
              details: {
                characterName: stored.character_name,
                announcement: content,
                moderator: mod
              },
              mapId: map.id,
              mapName: map.name,
              participantId: stored.id
            });
          }
          record.verification.status = "COMPLETED";
          record.verification.ended_at = ended;
          record.verification.updated_at = ended;
          addEvent(db, record, {
            title: "Zakończono całą weryfikację grupową",
            eventType: "VERIFICATION_FINISHED",
            details: {
              moderator: mod,
              participants: players.map(item => item.character_name)
            },
            mapId: map.id,
            mapName: map.name
          });
        });

        if (state.panel) state.journal = getJournal();
        render({ main: Boolean(state.panel), active: Boolean(state.activePanel) });
        let failed = 0;
        for (const item of list) {
          if (item.player.character_id) state.activePanel?.querySelector(`[data-map-player-list] [data-player-id="${CSS.escape(String(item.player.character_id))}"]`)?.classList.remove("mc-verifying");
          if (item.content && !await sendLocal(item.content)) {
            failed += 1;
          }
        }
        select([]);
        closeActive();
        notice(failed
          ? `Zakończono weryfikację wszystkich graczy. Nie wysłano ${failed} komunikatów lokalnych.`
          : `Zakończono weryfikację wszystkich graczy (${players.length}).`);
      } catch (error) {
        notice(`Nie udało się zakończyć weryfikacji grupowej (${error.message}).`);
      }
    });
  }

  function genCode() {
    return String(crypto.getRandomValues(new Uint32Array(1))[0] % 10000).padStart(4, "0");
  }

  function showPanel(player = null) {
    if (state.panel) closePanel();
    if (player?.nick) select([{ nick: player.nick, id: player.id || playerId(player.nick) || "" }]);
    const overlay = document.createElement("div");
    overlay.id = `${SCRIPT_ID}-panel`;
    overlay.innerHTML = panelMarkup();
    document.body.appendChild(overlay);
    state.panel = overlay;
    localStorage.setItem(PANEL_OPEN, "1");
    restorePos(overlay.querySelector(".mc-window"), PANEL_POS);
    bindPanel(overlay);
    renderSelected();
    state.journal = getJournal();
    renderMain();
    if (state.accounts.length) renderAccounts();
  }

  function closePanel() {
    save(state.panel, false);
    state.panelCleanup?.();
    state.panelCleanup = null;
    state.panel?.remove();
    state.panel = null;
    localStorage.setItem(PANEL_OPEN, "0");
  }

  function panelMarkup() {
    const start = readConfig();
    return `
      <div class="mc-window">
        <header class="mc-head">
          <div><small>CENTRUM OPERACYJNE</small><h2>Centrum Moderacji</h2></div>
          <div class="mc-head-actions">
            <span class="mc-rank" data-user-rank>${escHtml(rank())}</span>
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
          <p>Polecenie do konsoli jest wysyłane od razu, a wiadomość lokalna po ustawionym opóźnieniu. Sesję rozpoczynasz przez PPM na graczu.</p>
          <div class="mc-start-local-row">
            <label>Wiadomość lokalna<textarea data-start-local>${escHtml(start.local)}</textarea></label>
            <label class="mc-start-delay">Opóźnienie wiadomości lokalnej (s)<input type="number" min="0" step="0.1" inputmode="decimal" data-start-delay value="${escAttr(start.startDelaySeconds)}"></label>
          </div>
          <label>Komenda konsoli<textarea data-start-console>${escHtml(start.console)}</textarea></label>
          <label>Polecenie „Wyślij kod”<textarea data-send-code-command>${escHtml(start.sendCode)}</textarea></label>
          <p>W poleceniu „Wyślij kod” użyj <code>{nick}</code> oraz <code>{kod}</code>. Kod zostanie zastąpiony osobnym kodem wybranego uczestnika.</p>
          <label>Polecenie „Wyślij nick”<textarea data-send-nick-command>${escHtml(start.sendNick)}</textarea></label>
          <label>Polecenie „Wyślij screen”<textarea data-send-screen-command>${escHtml(start.sendScreen)}</textarea></label>
          <label>Polecenie „Handel”<textarea data-send-trade-command>${escHtml(start.sendTrade)}</textarea></label>
          <label>Polecenie „Atak mobów”<textarea data-send-attack-command>${escHtml(start.sendAttack)}</textarea></label>
          <label>Polecenie „Ponaglij”<textarea data-send-reminder-command>${escHtml(start.sendReminder)}</textarea></label>
          <p>Polecenia są wysyłane przez konsolę gry do uczestnika wybranego w panelu aktywnej weryfikacji. Możesz użyć: <code>{nick}</code>, <code>{moderator}</code> oraz <code>{kod}</code>.</p>
          <label>Wiadomość kończąca na czat lokalny<textarea data-finish-local>${escHtml(start.finish)}</textarea></label>
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
      if (event.target.closest("[data-open-active]")) {
        if (state.activePanel) closeActive();
        else showActive();
      }
    });
    const stopWheel = wheel(win);
    const stopMove = makeMovable(win, {
      positionKey: PANEL_POS,
      handle: head
    });
    state.panelCleanup = () => {
      stopWheel();
      stopMove();
    };
    overlay.querySelector("[data-close]").addEventListener("click", closePanel);
    overlay.querySelector("[data-select-player]").addEventListener("click", search);
    overlay.querySelector("[data-search]").addEventListener("keydown", event => { if (event.key === "Enter") search(); });
    overlay.querySelector("[data-clear-player]").addEventListener("click", clearAccounts);
    overlay.querySelector("[data-save-start]").addEventListener("click", () => { save(overlay, true); });
    const results = overlay.querySelector("[data-search-results]");
    results.addEventListener("change", event => {
      if (event.target.matches("[data-account-character]")) syncSelected();
    });
    results.addEventListener("click", event => {
      const run = event.target.closest("[data-account-batch-command]");
      if (run) return void batch(run.dataset.accountBatchCommand);
      const remove = event.target.closest("[data-remove-account]");
      if (remove) return removeAccount(remove.dataset.removeAccount);
      const toggle = event.target.closest("[data-toggle-account]");
      if (toggle) {
        const open = toggle.getAttribute("aria-expanded") === "true";
        const list = toggle.closest("[data-account-group]")?.querySelector(".mc-account-character-list");
        toggle.setAttribute("aria-expanded", String(!open));
        toggle.setAttribute("aria-label", open ? "Rozwiń konto" : "Zwiń konto");
        toggle.textContent = open ? "▸" : "▾";
        if (list) list.hidden = open;
      }
    });
    overlay.querySelector("[data-clear-journal]").addEventListener("click", clearJournal);
  }

  function renderMain() {
    const data = state.active;
    const status = state.panel?.querySelector("[data-active-state]");
    const summary = state.panel?.querySelector("[data-active-summary]");
    const timeline = state.panel?.querySelector("[data-timeline]");
    if (!data?.verification || data.verification.status !== "ACTIVE") {
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
    const active = (data.participants || []).filter(item => !item.resolved_at);
    if (summary) {
      summary.innerHTML = `
        <div class="mc-active-summary-list">
          ${active.map(item => `
            <div class="mc-active-line">
              <strong>${escHtml(item.character_name)}</strong>
              <span>kod ${escHtml(code(item, data.verification))}</span>
               <button type="button" data-open-active>${state.activePanel ? "Zamknij panel" : "Otwórz panel"}</button>
            </div>`).join("")}
        </div>`;
    }
    renderJournal(timeline, state.journal);
  }

  function syncButtons() {
    state.panel?.querySelectorAll("[data-open-active]").forEach(btn => {
      btn.textContent = state.activePanel ? "Zamknij panel" : "Otwórz panel";
    });
  }

  function showActive() {
    if (state.active?.verification?.status !== "ACTIVE") {
      return notice("Brak aktywnej weryfikacji.");
    }
    if (state.activePanel) {
      render({ active: true });
      return;
    }
    const root = document.createElement("div");
    root.id = `${SCRIPT_ID}-active-panel`;
    root.innerHTML = `
      <div class="mc-active-window">
        <header class="mc-active-head">
          <div><small>AKTYWNA WERYFIKACJA</small><h3 data-active-panel-title>Sesja</h3></div>
          <button type="button" data-close-active aria-label="Zamknij">×</button>
        </header>
        <div data-active-panel-body></div>
      </div>`;
    document.body.appendChild(root);
    state.activePanel = root;
    localStorage.setItem(ACTIVE_OPEN, "1");
    const win = root.querySelector(".mc-active-window");
    const head = root.querySelector(".mc-active-head");
    restorePos(win, ACTIVE_POS);
    const stopWheel = wheel(win);
    const stopMove = makeMovable(win, {
      positionKey: ACTIVE_POS,
      handle: head
    });
    state.activeCleanup = () => {
      stopWheel();
      stopMove();
    };
    bindActive(root);
    renderActive();
    renderMap();
    syncButtons();
  }

  function closeActive(clear = true) {
    state.activeCleanup?.();
    state.activeCleanup = null;
    state.activePanel?.remove();
    state.activePanel = null;
    if (clear) localStorage.setItem(ACTIVE_OPEN, "0");
    syncButtons();
    updateTimers();
  }

  function bindActive(root) {
    root.addEventListener("click", async event => {
      const btn = event.target.closest("button");
      if (!btn) return;
      if (btn.matches("[data-close-active]")) return closeActive();
      if (btn.matches("[data-add-map-player]")) return verify({
        nick: btn.dataset.addMapPlayer,
        id: btn.dataset.playerId,
        accountId: btn.dataset.playerAccountId || null
      });
      if (btn.matches("[data-select-all-participants]")) {
        const active = (state.active?.participants || []).filter(item => !item.resolved_at);
        const ids = [];
        const selected = [...state.selected];
        let missing = 0;
        for (const player of active) {
          const id = parseId(
            player.account_id || accountId(game.other(player.character_id))
          );
          if (!id) {
            missing += 1;
            continue;
          }
          if (!ids.includes(id)) ids.push(id);
          selected.push({
            nick: player.character_name,
            id: player.character_id || playerId(player.character_name) || ""
          });
        }
        select(selected, { renderActive: true });
        if (missing) notice(`Nie udało się rozpoznać kont części uczestników (${missing}).`);
        await loadAccounts(ids);
        return;
      }
      if (btn.matches("[data-clear-participant-selection]")) {
        clearView();
        return notice("Wyczyszczono wybór uczestników.");
      }
      if (btn.matches("[data-finish-all-participants]")) return finishAll();
      if (btn.matches("[data-send-participant-code]")) return sendCode(btn.dataset.sendParticipantCode);
      if (btn.matches("[data-load-participant-account]")) return openAccount(btn.dataset.loadParticipantAccount);
      if (btn.matches("[data-send-participant-command]")) return send(btn.dataset.participantId, btn.dataset.sendParticipantCommand);
      if (btn.matches("[data-finish-participant]")) return finish(btn.dataset.finishParticipant);
    });
    root.addEventListener("toggle", event => {
      const section = event.target.closest("[data-map-players-section]");
      if (!section) return;
      localStorage.setItem(MAP_STATE, section.open ? "0" : "1");
      state.collapsed = !section.open;
      const label = section.querySelector("[data-map-players-toggle-label]");
      if (label) label.textContent = section.open ? "−" : "+";
    }, true);
  }

  function renderActive() {
    const root = state.activePanel;
    const data = state.active;
    if (!root) return;
    if (!data?.verification || data.verification.status !== "ACTIVE") {
      closeActive(false);
      return;
    }
    const info = data.verification;
    const players = data.participants || [];
    const active = players.filter(item => !item.resolved_at);
    const group = players.length > 1;
    const selected = state.selected.map(item => item.nick);
    const names = active.map(item => item.character_name).join(", ") || info.target_character || "—";
    root.querySelector("[data-active-panel-title]").textContent = names;
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
    body.querySelector("[data-active-kind]").textContent = group ? "Weryfikacja grupowa" : "Aktywna weryfikacja";
    body.querySelector("[data-group-actions]").hidden = !(group && active.length);
    const list = body.querySelector("[data-participants-list]");
    const rows = new Map([...list.children].map(el => [el.dataset.participantRow, el]));
    for (const item of players) {
      const chosen = selected.some(name => sameNick(name, item.character_name));
      const key = JSON.stringify([
        item.id, item.character_name, item.resolved_at, item.verification_code,
        item.started_at, item.joined_at, item.start_map_name, item.last_map_name,
        info.started_at, info.created_at, info.start_map_name,
        info.verification_code, chosen
      ]);
      let row = rows.get(String(item.id));
      if (!row || row.dataset.signature !== key) {
        const tpl = document.createElement("template");
        tpl.innerHTML = markup(item, info, chosen);
        const node = tpl.content.firstElementChild;
        node.dataset.signature = key;
        if (row) row.replaceWith(node);
        else list.appendChild(node);
      }
      rows.delete(String(item.id));
    }
    for (const row of rows.values()) row.remove();
    if (!runtime.timer) updateTimers();
  }

  function renderMap() {
    const root = state.activePanel;
    const list = root?.querySelector("[data-map-player-list]");
    if (!list) return;
    const players = Object.values(game.others()).map(playerInfo).filter(Boolean);
    const section = root.querySelector("[data-map-players-section]");
    if (section.open === state.collapsed) section.open = !state.collapsed;
    section.querySelector("[data-map-players-toggle-label]").textContent = section.open ? "−" : "+";
    const signature = JSON.stringify(players.map(player => [player.id, player.nick, player.accountId]));
    if (list.dataset.signature !== signature) {
      list.dataset.signature = signature;
      list.innerHTML = players.map(player => `<button data-add-map-player="${escAttr(player.nick)}" data-player-id="${escAttr(player.id)}" data-player-account-id="${escAttr(player.accountId || "")}">+ ${escHtml(player.nick)}</button>`).join("") || "<small>Brak graczy na mapie.</small>";
      for (const item of state.active?.participants || []) {
        if (!item.resolved_at && item.character_id && state.active?.verification?.status === "ACTIVE") {
          list.querySelector(`[data-player-id="${CSS.escape(String(item.character_id))}"]`)?.classList.add("mc-verifying");
        }
      }
    }
  }

  function markup(item, info, selected) {
    const start = started(item, info);
    return `<article data-participant-row="${escAttr(item.id)}" class="mc-participant-session ${item.resolved_at ? "resolved" : ""} ${selected ? "selected-target" : ""}">
      <div class="mc-session-grid">
        <article><small>WERYFIKOWANY GRACZ</small><strong>${escHtml(item.character_name)}</strong></article>
        <article><small>MAPA STARTOWA</small><strong>${escHtml(startMap(item, info))}</strong></article>
        <article><small>START</small><strong>${date(start)}</strong></article>
        <article><small>KOD</small><strong>${escHtml(code(item, info))}</strong></article>
        <article><small>${item.resolved_at ? "CZAS SESJI" : "CZAS TRWANIA"}</small><strong${item.resolved_at ? "" : ` data-participant-started-at="${escAttr(start)}"`}>${time(item, info)}</strong></article>
      </div>
      <div class="mc-participant-actions"><span>${item.resolved_at ? "Zakończona" : "Aktywna"}</span>${item.resolved_at ? "" : `
        <button type="button" data-load-participant-account="${escAttr(item.id)}" title="Otwórz w Centrum Moderacji postacie tego konta">IDKONTA</button>
        <button type="button" data-send-participant-code="${escAttr(item.id)}">Kod</button>
        <button type="button" data-send-participant-command="sendNick" data-participant-id="${escAttr(item.id)}">Nick</button>
        <button type="button" data-send-participant-command="sendScreen" data-participant-id="${escAttr(item.id)}">Screen</button>
        <button type="button" data-send-participant-command="sendTrade" data-participant-id="${escAttr(item.id)}">Handel</button>
        <button type="button" data-send-participant-command="sendAttack" data-participant-id="${escAttr(item.id)}">Atak mobów</button>
        <button type="button" data-send-participant-command="sendReminder" data-participant-id="${escAttr(item.id)}">Ponaglij</button>
        <button type="button" class="danger" data-finish-participant="${escAttr(item.id)}">Zakończ</button>`}</div>
    </article>`;
  }

  function updateTimers() {
    clearTimeout(runtime.timer);
    runtime.timer = 0;
    if (document.visibilityState === "hidden" || state.active?.verification?.status !== "ACTIVE" || !state.activePanel) return;
    let active = false;
    state.activePanel.querySelectorAll("[data-participant-started-at]").forEach(el => {
      if (!el.getClientRects().length) return;
      const start = new Date(el.dataset.participantStartedAt || "").getTime();
      if (!Number.isFinite(start)) return;
      el.textContent = duration(Date.now() - start);
      active = true;
    });
    if (active) runtime.timer = setTimeout(updateTimers, 1000);
  }

  async function clearJournal() {
    if (state.active?.verification?.status === "ACTIVE") {
      notice("Najpierw zakończ aktywną weryfikację.");
      return;
    }
    const world = worldKey(game.world());
    const db = readDb();
    const records = db.verifications.filter(record =>
      worldKey(record?.verification?.world) === world
    );
    if (!records.length) {
      notice("Dziennik weryfikacji jest już pusty.");
      return;
    }
    const label = game.world() || "aktualnego świata";
    if (!await confirmAction({
      title: "Wyczyść dziennik",
      message: `Usunąć wszystkie weryfikacje (${records.length}) z dziennika świata ${label}? Tej operacji nie można cofnąć.`,
      confirmLabel: "Wyczyść",
      danger: true
    })) {
      return;
    }
    db.verifications = db.verifications.filter(record =>
      worldKey(record?.verification?.world) !== world
    );
    if (!db.verifications.length) {
      db.nextVerificationId = 1;
      db.nextParticipantId = 1;
      db.nextEventId = 1;
    }
    writeDb(db);
    state.journal = [];
    if (state.panel) render({ main: true });
    notice(`Wyczyszczono dziennik świata ${label}.`);
  }

  function journalHtml(entries) {
    if (!entries?.length) return `<p>Dziennik jest pusty.</p>`;
    return `
      <div class="mc-local-journal">
        ${entries.flatMap(data => {
          const info = data.verification;
          const players = data.participants?.length
            ? data.participants
            : [{
                id: "legacy",
                character_name: info.target_character || "—",
                started_at: info.started_at,
                start_map_name: info.start_map_name,
                resolved_at: info.ended_at
              }];
          return players.map((player, index) => {
            const id = `${info.id}:${player.id || index}`;
            const start = started(player, info);
            const end = player.resolved_at
              || (info.status === "ACTIVE" ? "" : info.ended_at || "");
            const time = end ? duration(
              Math.max(0, new Date(end).getTime() - new Date(start).getTime())
            ) : "";
            const events = (data.events || []).filter(event =>
              matches(event, player, players.length)
            );
            const active = info.status === "ACTIVE" && !player.resolved_at;
            return `
            <details data-journal-id="${escAttr(id)}">
              <summary>
                <strong>#${escHtml(info.public_number || info.id)} · ${escHtml(player.character_name || "—")}</strong>
                <span>${escHtml(startMap(player, info))}</span>
                ${time ? `<span>${time}</span>` : ""}
                <b>${active ? "AKTYWNA" : "ZAKOŃCZONA"}</b>
              </summary>
              <div class="mc-timeline-events">${events.map(event => `
                <article>
                  <div><strong>${escHtml(eventTitle(event))}</strong><time>${date(event.occurred_at)}</time></div>
                  ${text(event) ? `<p>${escHtml(text(event))}</p>` : ""}
                  <small>${escHtml([event.details?.channel, event.map_name].filter(Boolean).join(" · "))}</small>
                </article>`).join("") || "<p>Brak zdarzeń.</p>"}</div>
            </details>`;
          });
        }).join("")}
      </div>`;
  }

  function matches(event, player, count) {
    const id = String(player?.id || "");
    const linked = String(event?.participant_id || "");
    if (linked) return Boolean(id) && linked === id;
    if (event?.event_type === "VERIFICATION_FINISHED") return true;
    const names = [
      event?.details?.targetCharacter,
      event?.details?.characterName,
      event?.details?.target_character
    ].filter(Boolean);
    if (names.length) {
      return names.some(name => sameNick(name, player?.character_name));
    }
    return count === 1;
  }

  function key(entries) {
    return JSON.stringify(entries.map(data => ({
      verification: [
        data?.verification?.id,
        data?.verification?.status,
        data?.verification?.updated_at,
        data?.verification?.ended_at
      ],
      participants: (data?.participants || []).map(item => [
        item.id,
        item.character_name,
        item.resolved_at,
        item.verification_code
      ]),
      events: (data?.events || []).map(event => [
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
    if (!target) return;
    const next = key(entries);
    if (target.dataset.renderSignature === next) return;
    const html = journalHtml(entries);
    const scroll = target.closest(".mc-window, .mc-active-window");
    const top = scroll?.scrollTop || 0;
    const open = new Set(
      [...target.querySelectorAll("details[data-journal-id][open]")]
        .map(el => el.dataset.journalId)
    );
    target.innerHTML = html;
    target.dataset.renderSignature = next;
    target.querySelectorAll("details[data-journal-id]").forEach(el => {
      el.open = open.has(el.dataset.journalId);
    });
    if (scroll) scroll.scrollTop = top;
  }

  function eventTitle(event) {
    if (event.event_type === "READY_COMMAND_SENT") return event.title || `Wysłano polecenie ${event.details?.commandName || ""}`;
    if (event.event_type === "PARTICIPANT_FINISHED") return `Zakończono weryfikację gracza ${event.details?.characterName || ""}`;
    return event.title || event.event_type;
  }

  function text(event) {
    const data = event.details || {};
    if (data.content) return `${data.commandName ? `${data.commandName}: ` : ""}${data.content}`;
    if (event.event_type === "CODE_GENERATED" && data.code) return `Kod: ${data.code}`;
    return "";
  }

  function makeMovable(el, { positionKey: key, handle, click }) {
    const ctrl = new AbortController();
    const sig = ctrl.signal;
    let drag = null;
    let moved = false;
    handle.addEventListener("pointerdown", event => {
      if (event.button !== 0) return;
      if (event.target.closest("button") && event.target !== handle && el !== handle) return;
      const rect = el.getBoundingClientRect();
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
    }, { signal: sig });
    handle.addEventListener("pointermove", event => {
      if (!drag) return;
      drag.left = clamp(event.clientX - drag.x, 0, Math.max(0, innerWidth - drag.width));
      drag.top = clamp(event.clientY - drag.y, 0, Math.max(0, innerHeight - drag.height));
      if (!runtime.dragFrame) {
        runtime.dragFrame = requestAnimationFrame(() => {
          runtime.dragFrame = 0;
          if (!drag) return;
          Object.assign(el.style, { left: `${Math.round(drag.left)}px`, top: `${Math.round(drag.top)}px`, right: "auto" });
        });
      }
      moved = true;
    }, { signal: sig });
    handle.addEventListener("pointerup", event => {
      if (!drag) return;
      Object.assign(el.style, { left: `${Math.round(drag.left)}px`, top: `${Math.round(drag.top)}px`, right: "auto" });
      drag = null;
      try {
        if (!handle.hasPointerCapture || handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture?.(event.pointerId);
      } catch {}
      savePos(el, key);
    }, { signal: sig });
    handle.addEventListener("pointercancel", event => {
      drag = null;
      try {
        if (!handle.hasPointerCapture || handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture?.(event.pointerId);
      } catch {}
    }, { signal: sig });
    if (click) {
      el.addEventListener("click", event => {
        if (moved) {
          moved = false;
          event.preventDefault();
          return;
        }
        click();
      }, { signal: sig });
    }
    const fit = () => {
      const rect = el.getBoundingClientRect();
      Object.assign(el.style, {
        left: `${Math.round(clamp(rect.left, 0, Math.max(0, innerWidth - rect.width)))}px`,
        top: `${Math.round(clamp(rect.top, 0, Math.max(0, innerHeight - rect.height)))}px`,
        right: "auto"
      });
    };
    window.addEventListener("resize", fit, { signal: sig });
    return () => ctrl.abort();
  }

  function wheel(element) {
    const controller = new AbortController();
    element.addEventListener("wheel", event => event.stopPropagation(), { capture: true, passive: true, signal: controller.signal });
    return () => controller.abort();
  }

  function restorePos(el, key) {
    try {
      const pos = JSON.parse(localStorage.getItem(key) || "null");
      if (!Number.isFinite(pos?.left) || !Number.isFinite(pos?.top)) return;
      el.style.left = `${clamp(pos.left, 0, Math.max(0, innerWidth - el.offsetWidth))}px`;
      el.style.top = `${clamp(pos.top, 0, Math.max(0, innerHeight - el.offsetHeight))}px`;
      el.style.right = "auto";
    } catch {}
  }

  function savePos(el, key) {
    const rect = el.getBoundingClientRect();
    localStorage.setItem(key, JSON.stringify({ left: Math.round(rect.left), top: Math.round(rect.top) }));
  }

  function confirmAction({ title, message, confirmLabel: label = "Potwierdź", danger = false }) {
    runtime.confirm?.(false);
    const focus = document.activeElement;
    const root = document.createElement("div");
    root.id = `${SCRIPT_ID}-confirm`;
    root.innerHTML = `
      <div class="mc-confirm-window" role="dialog" aria-modal="true" aria-labelledby="${SCRIPT_ID}-confirm-title">
        <h3 id="${SCRIPT_ID}-confirm-title">${escHtml(title)}</h3>
        <p>${escHtml(message).replace(/\n/g, "<br>")}</p>
        <div><button type="button" data-confirm-cancel>Anuluj</button><button type="button" ${danger ? 'class="danger"' : ""} data-confirm-ok>${escHtml(label)}</button></div>
      </div>`;
    document.body.appendChild(root);
    return new Promise(resolve => {
      const finish = ok => {
        if (!root.isConnected) return;
        root.remove();
        document.removeEventListener("keydown", onKey);
        runtime.confirm = null;
        if (focus instanceof HTMLElement && focus.isConnected) focus.focus();
        resolve(ok);
      };
      const onKey = event => {
        if (event.key === "Escape") finish(false);
        if (event.key === "Tab") {
          const list = [...root.querySelectorAll("button")];
          const index = list.indexOf(document.activeElement);
          const next = event.shiftKey ? (index <= 0 ? list.length - 1 : index - 1) : (index + 1) % list.length;
          list[next].focus();
          event.preventDefault();
        }
      };
      runtime.confirm = finish;
      root.addEventListener("click", event => {
        if (event.target === root || event.target.closest("[data-confirm-cancel]")) finish(false);
        if (event.target.closest("[data-confirm-ok]")) finish(true);
      });
      document.addEventListener("keydown", onKey);
      root.querySelector("[data-confirm-cancel]").focus();
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

  function worldKey(value) {
    return normalize(value).replace(/^#/, "").toLocaleLowerCase("pl");
  }

  function playerId(nick) {
    const wanted = nickKey(nick);
    for (const other of Object.values(game.others())) {
      const player = playerInfo(other);
      if (player && nickKey(player.nick) === wanted) return player.id;
    }
    return null;
  }

  function accountId(other) {
    const id = Number(other?.getAccountId?.() ?? other?.d?.account);
    return Number.isSafeInteger(id) && id > 0
      ? id
      : null;
  }

  function rank() {
    const rights = Number(game.engine()?.hero?.d?.uprawnienia || 0);
    if (rights === 4 || rights === 16) return "Super Moderator";
    if (rights !== 0) return "Moderator Czatu";
    return "Brak rangi";
  }

  function duration(milliseconds) {
    const total = Math.max(0, Math.floor(milliseconds / 1000));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    return hours ? `${hours}h ${minutes}m ${seconds}s` : `${minutes}m ${seconds}s`;
  }

  function date(value) {
    try {
      return DATE_FMT.format(new Date(value));
    } catch {
      return String(value || "");
    }
  }

  function finite(value) {
    return Number.isFinite(Number(value)) ? Number(value) : null;
  }

  function sameNick(a, b) {
    return nickKey(a) === nickKey(b);
  }

  function nickKey(value) {
    return normalize(value).toLocaleLowerCase("pl");
  }

  function normalize(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim();
  }

  function escHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, character =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character]
    );
  }

  function escAttr(value) {
    return escHtml(value).replace(/`/g, "&#096;");
  }

  function escCmd(value) {
    return String(value || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/[\r\n]+/g, " ");
  }

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function wait(milliseconds) {
    const duration = Math.max(0, Number(milliseconds) || 0);
    return duration ? new Promise(resolve => setTimeout(resolve, duration)) : Promise.resolve();
  }

  function dispose() {
    if (runtime.frame) cancelAnimationFrame(runtime.frame);
    if (runtime.dragFrame) cancelAnimationFrame(runtime.dragFrame);
    runtime.confirm?.(false);
    state.panelCleanup?.();
    state.activeCleanup?.();
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

  console.info(`[Centrum Moderacji] v${version} gotowe.`);
})();
