import { Plugin, showMessage, openTab } from "siyuan";
import { SettingUtils } from "./libs/setting-utils";
import { Telegram } from "./libs/telegram";
import {
  getBlockByID,
  prependBlock,
  searchDocs,
  setBlockAttrs,
  request,
  lsNotebooks,
  createDocWithMd,
} from "./api";
import {
  SETTINGS_STORAGE_NAME,
  STORAGE_NAME,
  PLUGIN_NAME,
} from "./libs/constants";
import log from "./libs/logger";

type SyncStorage = {
  updateId?: number;
  lastInboxShorthands?: number;
};

type MemoSource = "telegram" | "siyuan-inbox";

interface PendingMemo {
  type: "short" | "long";
  source: MemoSource;
  content: string;
  timestamp: number;
  createdCompact: string;
  tgMessage?: IMessagesList;
  inboxItem?: any;
  longNotebookId?: string;
  longTitle?: string;
}

export default class SiyuanInboxPlusPlugin extends Plugin {
  private settingUtils: SettingUtils;
  private telegram?: Telegram;
  private isManualSyncing = false;
  private inboxTimer: ReturnType<typeof setInterval> | null = null;

  async onload() {
    log.info(this.i18n.helloPlugin);
    this.injectCustomStyles();
    this.data[STORAGE_NAME] = (await this.loadData(STORAGE_NAME)) || {};
    this.addTopBarEntry();
    this.addCommands();

    this.settingUtils = new SettingUtils({
      plugin: this,
      name: SETTINGS_STORAGE_NAME,
      callback: () => {
        this.restartTelegram();
        this.startInboxPolling();
      },
      width: "760px",
      height: "auto",
    });

    this.addSettings();
  }

  onLayoutReady() {
    this.settingUtils
      .load()
      .then(() => {
        this.restartTelegram();
        this.startInboxPolling();
      })
      .catch((error) => {
        log.error(this.i18n.settings.loadError, error);
      });
  }

  async onunload() {
    if (this.inboxTimer) {
      clearInterval(this.inboxTimer);
      this.inboxTimer = null;
    }
    await this.telegram?.terminate();
    log.debug(this.i18n.byePlugin);
  }

  // ─── Settings ──────────────────────────────────────────────

  private addSettings() {
    this.settingUtils.addItem({
      key: "pollingInterval",
      value: 60,
      type: "number",
      title: this.i18n.settings.pollingInterval.title,
      description: this.i18n.settings.pollingInterval.description,
      action: {
        callback: () => {
          this.settingUtils.takeAndSave("pollingInterval");
        },
      },
    });

    this.settingUtils.addItem({
      key: "inboxSectionHeader",
      value: "",
      type: "hint",
      createElement: () => this.createSectionHeader("收集箱", "#07c160"),
    });

    this.settingUtils.addItem({
      key: "targetDocId",
      value: "",
      type: "hint",
      direction: "row",
      title: this.i18n.settings.targetDoc.title,
      description: this.i18n.settings.targetDoc.description,
      createElement: () => this.createTargetDocPicker("targetDocId", "siyuan-inbox"),
    });

    this.settingUtils.addItem({
      key: "inboxWordLimit",
      value: 200,
      type: "number",
      title: this.i18n.settings.inboxWordLimit.title,
      description: this.i18n.settings.inboxWordLimit.description,
      action: {
        callback: () => {
          this.settingUtils.takeAndSave("inboxWordLimit");
        },
      },
    });

    this.settingUtils.addItem({
      key: "targetNotebookId",
      value: "none",
      type: "hint",
      direction: "row",
      title: this.i18n.settings.targetNotebook.title,
      description: this.i18n.settings.targetNotebook.description,
      createElement: () => this.createTargetNotebookPicker(),
    });

    this.settingUtils.addItem({
      key: "tgSectionHeader",
      value: "",
      type: "hint",
      createElement: () => this.createSectionHeader("Telegram", "#229ed9"),
    });

    this.settingUtils.addItem({
      key: "botToken",
      value: "",
      type: "textinput",
      title: this.i18n.settings.botToken.title,
      action: {
        callback: () => {
          this.settingUtils.takeAndSave("botToken");
        },
      },
    });

    this.settingUtils.addItem({
      key: "authorizedUser",
      value: "",
      type: "textinput",
      title: this.i18n.settings.authorizedUser.title,
      description: this.i18n.settings.authorizedUser.description,
      action: {
        callback: () => {
          this.settingUtils.takeAndSave("authorizedUser");
        },
      },
    });

    this.settingUtils.addItem({
      key: "telegramTargetDocId",
      value: "",
      type: "hint",
      direction: "row",
      title: this.i18n.settings.telegramTargetDoc.title,
      description: this.i18n.settings.telegramTargetDoc.description,
      createElement: () => this.createTargetDocPicker("telegramTargetDocId", "telegram", {
        fallbackKey: "targetDocId",
        fallbackLabel: this.i18n.settings.telegramTargetDoc.fallback,
      }),
    });
  }

  // ─── Top Bar ───────────────────────────────────────────────

  private addTopBarEntry() {
    this.addTopBar({
      icon: "iconInboxPlus",
      title: this.i18n.topBar.title,
      position: "right",
      callback: () => this.manualRefresh(),
    });
    this.addIcons(`<symbol id="iconInboxPlus" viewBox="0 0 24 24">
<path d="M12 3.2a6.1 6.1 0 0 0-3.3 11.25c.55.35.9.95.9 1.6v.7h4.8v-.7c0-.66.35-1.25.9-1.6A6.1 6.1 0 0 0 12 3.2Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"></path>
<path d="M9.7 18.7h4.6M10.3 21h3.4M10 11.1h4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"></path>
<path d="M10.2 8.8 12 11l1.8-2.2" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"></path>
</symbol>`);
  }

  // ─── Commands ──────────────────────────────────────────────

  private addCommands() {
    this.addCommand({
      langKey: "inboxPlusRefresh",
      langText: this.i18n.commands.refresh,
      hotkey: "",
      callback: () => this.manualRefresh(),
    });
  }

  // ─── Polling ───────────────────────────────────────────────

  private startInboxPolling() {
    if (this.inboxTimer) {
      clearInterval(this.inboxTimer);
      this.inboxTimer = null;
    }

    const interval = Math.max(0, Number(this.settingUtils.get("pollingInterval") || 0));
    if (interval === 0) {
      return;
    }

    this.inboxTimer = setInterval(async () => {
      if (this.isManualSyncing) {
        return;
      }
      try {
        await this.pullSiYuanInbox();
      } catch (e) {
        log.error("Automatic sync SiYuan inbox failed:", e);
      }
    }, interval * 1000);
  }

  // ─── Telegram ──────────────────────────────────────────────

  private async restartTelegram() {
    await this.telegram?.terminate();
    this.telegram = undefined;

    const botToken = this.settingUtils.get("botToken");
    if (!botToken) {
      log.info(this.i18n.errors.BotTokenRequiredError);
      return;
    }

    this.telegram = new Telegram({
      botToken,
      updateId: this.getStorage().updateId,
      pollingInterval: Math.max(0, Number(this.settingUtils.get("pollingInterval") || 0)) * 1000,
      authorizedUser: this.settingUtils.get("authorizedUser"),
      i18n: this.i18n,
      callback: async (res) => {
        await this.handleTelegramResponse(res);
      },
    });

    this.telegram.start();
  }

  private async manualRefresh() {
    if (this.isManualSyncing) {
      this.showUIMessage(this.i18n.messages.refreshRunning, 2500, "info");
      return;
    }

    this.isManualSyncing = true;

    try {
      let tgMessages: IMessagesList[] = [];
      let shorthands: any[] = [];

      // 1. 获取 Telegram 消息
      const botToken = this.settingUtils.get("botToken");
      let resTG = null;
      if (botToken) {
        if (!this.telegram) {
          await this.restartTelegram();
        }
        if (this.telegram) {
          resTG = await this.telegram.getInboxMessages();
          tgMessages = resTG?.messages || [];
        }
      }

      // 2. 获取思源收集箱数据
      const resInbox = await request("/api/inbox/getShorthands", { page: 1 });
      if (resInbox) {
        const dataObj = resInbox.data ? resInbox.data : resInbox;
        if (dataObj && dataObj.shorthands && Array.isArray(dataObj.shorthands)) {
          shorthands = dataObj.shorthands;
        }
      }

      // 3. 联合绝对时间排序并写入
      const syncRes = await this.syncMemos(tgMessages, shorthands);

      // 4. 更新 Telegram 状态
      if (resTG && resTG.updateId !== undefined) {
        this.telegram?.setUpdateId(resTG.updateId);
      }

      const totalCount = syncRes.shortCount + syncRes.longCount;
      if (totalCount > 0) {
        setTimeout(() => this.refreshInboxUI(), 100);
        this.showUIMessage(
          this.i18n.messages.refreshDone.replace("${count}", String(totalCount)),
          3000,
          "info"
        );
      } else {
        this.showUIMessage(this.i18n.messages.refreshEmpty, 3000, "info");
      }
    } catch (error) {
      log.error(this.i18n.errors.manualRefreshError, error);
      this.showUIMessage(this.i18n.errors.manualRefreshError, 4000, "error");
    } finally {
      this.isManualSyncing = false;
    }
  }

  private async handleTelegramResponse(res: ITelegramResponse | null) {
    if (!res) {
      return;
    }

    if (!res.messages || res.messages.length === 0) {
      if (res.updateId !== undefined) {
        await this.persistUpdateId(res.updateId);
        this.telegram?.setUpdateId(res.updateId);
      }
      return;
    }

    const syncRes = await this.syncMemos(res.messages, []);

    if (res.updateId !== undefined) {
      this.telegram?.setUpdateId(res.updateId);
    }

    const totalCount = syncRes.shortCount + syncRes.longCount;
    if (totalCount > 0) {
      setTimeout(() => this.refreshInboxUI(), 100);
    }
  }

  private telegramText(message: IMessagesList): string {
    const parts = [message.text || ""];
    for (const attachment of message.attachments || []) {
      const isImage = /\.(png|jpe?g|gif|webp|bmp)$/i.test(attachment.path || "");
      if (isImage) {
        parts.push(`![${attachment.fileName}](${attachment.path})`);
      } else {
        parts.push(`[${attachment.fileName}](${attachment.path})`);
      }
    }
    return parts.filter(Boolean).join("\n");
  }

  // ─── SiYuan Inbox ──────────────────────────────────────────

  /**
   * Sync shorthands (思源收集箱/闪卡) from SiYuan's inbox
   * and write each one as a block into the target doc.
   * Returns the number of imported items.
   */
  private async pullSiYuanInbox(): Promise<number> {
    const doc = await this.getTargetDoc("siyuan-inbox");
    const targetNotebookId = String(this.settingUtils.get("targetNotebookId") || "none").trim();

    if (!doc && (targetNotebookId === "none" || !targetNotebookId)) {
      return 0; // Both targets are unset, nothing to do
    }

    const res = await request("/api/inbox/getShorthands", { page: 1 });
    if (!res) {
      return 0;
    }

    const dataObj = res.data ? res.data : res;
    if (!dataObj || !dataObj.shorthands || !Array.isArray(dataObj.shorthands)) {
      return 0;
    }

    const shorthands = dataObj.shorthands;
    const syncRes = await this.syncMemos([], shorthands);
    const totalCount = syncRes.shortCount + syncRes.longCount;

    if (totalCount > 0) {
      setTimeout(() => this.refreshInboxUI(), 100);
    }

    return totalCount;
  }

  // ─── Unified Sync Core ─────────────────────────────────────

  /**
   * Sync Telegram messages and SiYuan inbox items together.
   * Resolves absolute created time, sorts chronologically, and prepends to target doc.
   */
  private async syncMemos(tgMessages: IMessagesList[], inboxItems: any[]): Promise<{ shortCount: number; longCount: number }> {
    const pendingMemos: PendingMemo[] = [];
    const targetNotebookId = String(this.settingUtils.get("targetNotebookId") || "none").trim();
    const limit = Math.max(0, Number(this.settingUtils.get("inboxWordLimit") || 0));

    // 1. Convert Telegram messages
    for (const message of tgMessages) {
      const timestamp = message.date * 1000;
      const d = new Date(timestamp);
      const createdCompact = this.dateToCompact(d);
      const content = this.telegramText(message);

      pendingMemos.push({
        type: "short",
        source: "telegram",
        content,
        timestamp,
        createdCompact,
        tgMessage: message
      });
    }

    // 2. Convert Siyuan inbox items
    for (const item of inboxItems) {
      const content = item.shorthandMd || item.shorthandContent || item.shorthandDesc || "";
      if (!content.trim()) {
        try {
          await request("/api/inbox/removeShorthands", { ids: [item.oId] });
        } catch (e) {
          log.error(`Failed to delete empty shorthand ${item.oId}:`, e);
        }
        continue;
      }

      const { timestamp, compact: createdCompact } = this.parseOIdToTime(item.oId);
      const wordCount = content.trim().length;

      let type: "short" | "long" = "short";
      if (limit > 0 && wordCount > limit) {
        type = "long";
      }

      pendingMemos.push({
        type,
        source: "siyuan-inbox",
        content,
        timestamp,
        createdCompact,
        inboxItem: item,
        longNotebookId: targetNotebookId,
        longTitle: (item.shorthandTitle || "").trim() || "未命名收集",
      });
    }

    // 3. Sort chronologically (oldest first, so it prepends first and ends up at the bottom)
    pendingMemos.sort((a, b) => a.timestamp - b.timestamp);

    let shortCount = 0;
    let longCount = 0;

    // 4. Process and write
    for (const memo of pendingMemos) {
      if (memo.type === "long") {
        if (memo.longNotebookId === "none" || !memo.longNotebookId) {
          continue;
        }
        try {
          const rawTitle = memo.longTitle!;
          const sanitizedTitle = rawTitle.replace(/\//g, "-");
          const docPath = `/${sanitizedTitle}`;

          const newDocId = await createDocWithMd(memo.longNotebookId, docPath, memo.content);
          if (!newDocId) {
            log.error(`Failed to create doc for shorthand ${memo.inboxItem.oId} (API returned empty)`);
            continue;
          }
          log.info(`Imported shorthand ${memo.inboxItem.oId} as doc ${newDocId}`);

          await request("/api/inbox/removeShorthands", { ids: [memo.inboxItem.oId] });
          longCount++;
        } catch (e) {
          log.error(`Failed to import long shorthand ${memo.inboxItem.oId}:`, e);
        }
      } else {
        const doc = await this.getTargetDoc(memo.source);
        if (!doc) {
          continue;
        }

        try {
          await this.writeMemoToDoc(memo.content, memo.source, memo.createdCompact);

          if (memo.source === "telegram") {
            await this.persistUpdateId(memo.tgMessage!.updateId);
          } else if (memo.source === "siyuan-inbox") {
            await request("/api/inbox/removeShorthands", { ids: [memo.inboxItem.oId] });
          }
          shortCount++;
        } catch (e) {
          log.error(`Failed to sync short memo (source: ${memo.source}):`, e);
        }
      }
    }

    return { shortCount, longCount };
  }

  // ─── Time Parse Utilities ──────────────────────────────────

  private parseOIdToTime(oId: string | number): { timestamp: number; compact: string } {
    const oIdStr = String(oId || "").trim();
    const now = new Date();
    const nowMs = now.getTime();
    const nowCompact = this.dateToCompact(now);

    if (!oIdStr) {
      return { timestamp: nowMs, compact: nowCompact };
    }

    const match14 = oIdStr.match(/^(\d{14})/);
    if (match14) {
      const comp = match14[1];
      const year = Number(comp.slice(0, 4));
      const month = Number(comp.slice(4, 6)) - 1;
      const day = Number(comp.slice(6, 8));
      const hour = Number(comp.slice(8, 10));
      const minute = Number(comp.slice(10, 12));
      const second = Number(comp.slice(12, 14));
      const d = new Date(year, month, day, hour, minute, second);
      return { timestamp: d.getTime(), compact: comp };
    }

    if (/^\d{13}$/.test(oIdStr)) {
      const ms = Number(oIdStr);
      const d = new Date(ms);
      return { timestamp: ms, compact: this.dateToCompact(d) };
    }

    if (/^\d{10}$/.test(oIdStr)) {
      const sec = Number(oIdStr);
      const d = new Date(sec * 1000);
      return { timestamp: sec * 1000, compact: this.dateToCompact(d) };
    }

    return { timestamp: nowMs, compact: nowCompact };
  }

  private dateToCompact(d: Date): string {
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  }

  // ─── Write Memo to Doc ─────────────────────────────────────

  /**
   * Write a memo message as a prepend block into the target document.
   * Each memo is a styled quote block with source metadata in IAL.
   */
  private async writeMemoToDoc(
    text: string,
    source: MemoSource,
    customTimeCompact?: string,
    extraAttrs: Record<string, string> = {}
  ) {
    const doc = await this.getTargetDoc(source);
    if (!doc) {
      throw new Error(this.i18n.errors.noTargetDoc);
    }

    const timeCompact = customTimeCompact || this.nowCompact();
    const timeStr = this.formatCompactTime(timeCompact);

    const isTG = source === "telegram";
    const sourceLabel = isTG ? "Telegram" : "微信收集";
    const brandColor = isTG ? "#229ed9" : "#1aad19";
    const brandBg = isTG ? "rgba(34, 158, 217, 0.05)" : "rgba(26, 173, 25, 0.05)";

    const styleStr = `background-color: ${brandBg}; border-left: 4px solid ${brandColor}; padding: 10px 14px; border-radius: 6px; margin: 8px 0;`;

    const attrs: Record<string, string> = {
      "custom-inbox-source": source,
      "custom-inbox-created": timeCompact,
      "style": styleStr,
      ...extraAttrs,
    };

    // Quote block: line 1 = brand color highlighted timestamp, line 2+ = content
    // 使用思源 Lute 引擎支持 of 行内 IAL 语法添加样式，百分之百绝无源码泄露
    const contentLines = text.split(/\r?\n/);
    const markdownLines = [
      `> **${timeStr}**{: style="color: ${brandColor}; font-size: 0.85em;"}`,
      ...contentLines.map((line) => `> ${line || " "}`),
    ];

    const markdown = markdownLines.join("\n");

    const result = await prependBlock("markdown", markdown, doc.id);
    const id = result?.[0]?.doOperations?.[0]?.id;
    if (id) {
      await setBlockAttrs(id, attrs);
    }
  }

  // ─── Target Doc ────────────────────────────────────────────

  private createTargetDocPicker(
    settingKey: "targetDocId" | "telegramTargetDocId",
    source: MemoSource,
    opts: { fallbackKey?: "targetDocId"; fallbackLabel?: string } = {}
  ): HTMLElement {
    const t = settingKey === "telegramTargetDocId"
      ? this.i18n.settings.telegramTargetDoc
      : this.i18n.settings.targetDoc;
    const root = document.createElement("div");
    root.className = "fn__flex-column inbox-plus-doc-picker";

    const row = document.createElement("div");
    row.className = "fn__flex inbox-plus-doc-picker__row";

    const input = document.createElement("input");
    input.className = "b3-text-field fn__flex-1";
    input.placeholder = t.placeholder;

    const openButton = document.createElement("button");
    openButton.className = "b3-button b3-button--outline";
    openButton.textContent = t.open;

    const testButton = document.createElement("button");
    testButton.className = "b3-button b3-button--outline";
    testButton.textContent = t.test;

    const space1 = document.createElement("span");
    space1.className = "fn__space";
    const space2 = document.createElement("span");
    space2.className = "fn__space";
    row.append(input, space1, openButton, space2, testButton);

    const results = document.createElement("div");
    results.className = "b3-list b3-list--background fn__none inbox-plus-doc-picker__results";

    const docTitle = (doc: Block) => doc.content || doc.name || doc.id;
    const refreshCurrent = async () => {
      const docId = this.getTargetDocId(source, false);
      if (!docId) {
        if (opts.fallbackKey) {
          const fallbackDoc = await this.getTargetDoc("siyuan-inbox");
          input.placeholder = fallbackDoc
            ? `${opts.fallbackLabel}: ${docTitle(fallbackDoc)}`
            : t.placeholder;
        } else {
          input.placeholder = t.placeholder;
        }
        return;
      }
      const doc = await this.getTargetDoc(source, false);
      input.placeholder = doc
        ? `${t.current}: ${docTitle(doc)}`
        : `${t.currentInvalid}: ${docId}`;
    };

    const hideResults = () => {
      results.innerHTML = "";
      results.classList.add("fn__none");
    };

    const renderResults = (docs: Block[]) => {
      results.innerHTML = "";
      results.classList.remove("fn__none");
      if (docs.length === 0) {
        const empty = document.createElement("div");
        empty.className = "b3-list--empty";
        empty.textContent = t.noResults;
        results.append(empty);
        return;
      }

      docs.forEach((doc) => {
        const item = document.createElement("div");
        item.className = "b3-list-item b3-list-item--narrow";
        const text = document.createElement("span");
        text.className = "b3-list-item__text";
        text.textContent = this.formatDocLabel(doc);
        item.append(text);
        item.onclick = async () => {
          await this.settingUtils.setAndSave(settingKey, doc.id);
          input.value = "";
          hideResults();
          await refreshCurrent();
          this.showUIMessage(this.i18n.messages.docBound, 2500, "info");
        };
        results.append(item);
      });
    };

    const doSearch = async () => {
      const keyword = input.value.trim();
      if (!keyword) {
        hideResults();
        return;
      }
      try {
        renderResults(await searchDocs(keyword));
      } catch (error) {
        log.error(this.i18n.errors.searchDocsError, error);
      }
    };

    let timer: ReturnType<typeof setTimeout>;
    input.oninput = () => {
      clearTimeout(timer);
      timer = setTimeout(doSearch, 300);
    };
    input.onkeydown = (event) => {
      if (event.key === "Enter") {
        clearTimeout(timer);
        doSearch();
      }
    };
    openButton.onclick = async () => {
      const doc = await this.getTargetDoc(source);
      if (!doc) {
        this.showUIMessage(this.i18n.errors.noTargetDoc, 3000, "error");
        return;
      }
      openTab({ app: this.app, doc: { id: doc.id, zoomIn: false } });
    };
    testButton.onclick = async () => {
      await this.writeMemoToDoc(this.i18n.messages.testMessage, source, undefined);
      this.showUIMessage(this.i18n.messages.testWritten, 2500, "info");
    };

    root.append(row, results);
    refreshCurrent();
    return root;
  }

  private createTargetNotebookPicker(): HTMLElement {
    const t = this.i18n.settings.targetNotebook;
    const select = document.createElement("select");
    select.className = "b3-select fn__flex-center fn__size200";

    const loadingOpt = document.createElement("option");
    loadingOpt.value = "none";
    loadingOpt.text = t.loading;
    select.appendChild(loadingOpt);

    const savedId = String(this.settingUtils.get("targetNotebookId") || "none");

    lsNotebooks().then((res) => {
      select.innerHTML = "";

      const noneOpt = document.createElement("option");
      noneOpt.value = "none";
      noneOpt.text = t.none;
      select.appendChild(noneOpt);

      if (res && res.notebooks && Array.isArray(res.notebooks)) {
        res.notebooks.forEach((nb) => {
          if (!nb.closed) {
            const opt = document.createElement("option");
            opt.value = nb.id;
            opt.text = nb.name;
            select.appendChild(opt);
          }
        });
      }

      select.value = savedId;
    }).catch((err) => {
      log.error("Failed to load notebooks for settings:", err);
      select.innerHTML = "";
      const errOpt = document.createElement("option");
      errOpt.value = "none";
      errOpt.text = t.none;
      select.appendChild(errOpt);
    });

    select.onchange = async () => {
      await this.settingUtils.setAndSave("targetNotebookId", select.value);
    };

    return select;
  }

  private getTargetDocId(source: MemoSource = "siyuan-inbox", useFallback = true): string {
    if (source === "telegram") {
      const telegramDocId = String(this.settingUtils.get("telegramTargetDocId") || "").trim();
      if (telegramDocId || !useFallback) {
        return telegramDocId;
      }
    }
    return String(this.settingUtils.get("targetDocId") || "").trim();
  }

  private async getTargetDoc(source: MemoSource = "siyuan-inbox", useFallback = true): Promise<Block | null> {
    const docId = this.getTargetDocId(source, useFallback);
    if (!docId) {
      return null;
    }
    const block = await getBlockByID(docId);
    return block?.type === "d" ? block : null;
  }

  // ─── Utils ─────────────────────────────────────────────────

  private async persistUpdateId(updateId?: number) {
    if (updateId === undefined) {
      return;
    }
    const storage = this.getStorage();
    storage.updateId = Math.max(storage.updateId || 0, updateId);
    await this.saveData(STORAGE_NAME, storage);
    this.telegram?.setUpdateId(storage.updateId);
  }

  private getStorage(): SyncStorage {
    if (!this.data[STORAGE_NAME]) {
      this.data[STORAGE_NAME] = {};
    }
    return this.data[STORAGE_NAME] as SyncStorage;
  }

  private nowCompact(): string {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  }

  private formatCompactTime(value: string): string {
    if (!/^\d{14}$/.test(value)) {
      return value;
    }
    return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)} ${value.slice(8, 10)}:${value.slice(10, 12)}`;
  }

  private formatDocLabel(doc: Block): string {
    const title = doc.content || doc.name || doc.id;
    const hpath = doc.hpath || doc.path || "";
    return hpath ? `${title} - ${hpath}` : title;
  }

  private createSectionHeader(titleText: string, color: string): HTMLElement {
    const root = document.createElement("div");
    root.className = "custom-section-header";
    root.style.width = "100%";
    root.style.margin = "0";
    root.style.padding = "0";

    const title = document.createElement("div");
    title.className = "custom-section-header-title";
    title.style.color = color;
    title.textContent = titleText;
    root.appendChild(title);

    return root;
  }

  private injectCustomStyles() {
    const styleId = "siyuan-inbox-plus-custom-styles";
    if (document.getElementById(styleId)) return;

    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `
      /* 精准且强力重置包裹了自定义分类头的那个整行容器 */
      .b3-dialog__content label:has(.custom-section-header),
      .b3-dialog__body label:has(.custom-section-header),
      .b3-dialog label:has(.custom-section-header),
      label:has(.custom-section-header),
      .b3-label:has(.custom-section-header) {
        min-height: 0 !important;
        height: auto !important;
        padding: 4px 16px 0 16px !important;
        margin: 0 !important;
        border-bottom: none !important;
        background-color: transparent !important;
        display: flex !important;
        align-items: center !important;
        width: 100% !important;
        box-sizing: border-box !important;
        border-top: 1px solid var(--b3-border-color, rgba(0,0,0,0.06)) !important;
        margin-top: 6px !important;
        padding-top: 8px !important;
      }

      /* 隐藏左侧多余的空白列和占位列 */
      label:has(.custom-section-header) > .fn__flex-1,
      label:has(.custom-section-header) > .fn__space,
      .b3-label:has(.custom-section-header) > .fn__flex-1,
      .b3-label:has(.custom-section-header) > .fn__space {
        display: none !important;
      }

      /* 强行使盛放自定义元素的容器占满100%宽度 */
      label:has(.custom-section-header) > div:not(.fn__flex-1),
      .b3-label:has(.custom-section-header) > div:not(.fn__flex-1) {
        width: 100% !important;
        padding: 0 !important;
        margin: 0 !important;
        min-height: 0 !important;
        height: auto !important;
      }

      /* 标题文字样式 */
      .custom-section-header-title {
        font-size: 13px !important;
        font-weight: 600 !important;
        display: flex !important;
        align-items: center !important;
        user-select: none !important;
        line-height: 1.2 !important;
      }

      /* 高端竖线指示标 */
      .custom-section-header-title::before {
        content: "";
        display: inline-block;
        width: 3.5px;
        height: 13px;
        margin-right: 8px;
        border-radius: 2px;
        background-color: currentColor;
      }

      .b3-dialog__content:has(.inbox-plus-doc-picker) .b3-label {
        min-height: 0 !important;
        padding-top: 8px !important;
        padding-bottom: 8px !important;
      }

      .b3-dialog__content:has(.inbox-plus-doc-picker) .b3-label .ft__on-surface,
      .b3-dialog__content:has(.inbox-plus-doc-picker) .b3-label .b3-label__text {
        line-height: 1.35 !important;
      }

      .b3-dialog__content:has(.inbox-plus-doc-picker) .b3-text-field,
      .b3-dialog__content:has(.inbox-plus-doc-picker) .b3-select {
        min-height: 28px !important;
      }

      .inbox-plus-doc-picker {
        width: min(520px, 100%) !important;
      }

      .inbox-plus-doc-picker__row {
        width: 100%;
        flex-wrap: nowrap;
        align-items: center;
      }

      .inbox-plus-doc-picker__row .b3-button {
        flex: 0 0 auto;
        min-width: 52px;
      }

      .inbox-plus-doc-picker__results {
        max-height: 180px;
        overflow: auto;
        margin-top: 6px;
        border: 1px solid var(--b3-border-color, rgba(0,0,0,0.08));
        border-radius: 6px;
      }
    `;
    document.head.appendChild(style);
  }

  private refreshInboxUI() {
    try {
      const inboxContainer = document.querySelector('[data-type="inbox"]');
      if (!inboxContainer) {
        log.debug("Inbox container not found, UI might not be open");
        return;
      }
      const useElements = inboxContainer.querySelectorAll("svg use");
      for (const use of Array.from(useElements)) {
        const href = use.getAttribute("xlink:href") || use.getAttribute("href") || "";
        if (href.includes("iconRefresh") || href.includes("iconSync") || href.includes("iconReload")) {
          const btn = use.closest(".block__icon") || use.closest("button") || use.closest(".toolbar__item") || use.parentElement;
          if (btn && typeof (btn as any).click === "function") {
            (btn as any).click();
            log.info("Triggered Siyuan Inbox UI refresh click");
            return;
          }
        }
      }
      log.debug("Refresh button not found in Inbox container");
    } catch (e) {
      log.error("Failed to refresh Siyuan Inbox UI:", e);
    }
  }

  private showUIMessage(
    text: string,
    timeout?: number,
    type?: "info" | "error",
    id?: string
  ): void {
    showMessage(`[${PLUGIN_NAME}]<br/>${text}<br/>`, timeout, type, id);
  }
}
