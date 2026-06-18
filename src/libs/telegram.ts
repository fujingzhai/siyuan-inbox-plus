import { forwardProxy, upload } from "../api";
import log from "./logger";
import { BotTokenRequiredError } from "./errors";

export type TelegramRequestMode = "direct" | "proxy";

export function normalizeTelegramRequestMode(value: unknown): TelegramRequestMode {
  return value === "proxy" ? "proxy" : "direct";
}

export function normalizeTelegramApiUrl(value: unknown): string {
  const raw = String(value || "https://api.telegram.org").trim();
  const parsed = new URL(raw);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("Invalid Telegram API base URL");
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  return parsed.toString().replace(/\/+$/, "");
}

export class Telegram {
  pollingInterval: number;
  isProcessing: boolean;
  isStopped: boolean;
  botToken: string;
  updateId: number;
  authorizedUser: string;
  telegramApiUrl: string;
  telegramRequestMode: TelegramRequestMode;
  i18n: any;
  callback: (messages: ITelegramResponse | null, error?: Error) => Promise<void> | void;

  constructor(opts: {
    botToken: string;
    pollingInterval?: number;
    updateId?: number;
    authorizedUser?: string;
    telegramApiUrl?: string;
    telegramRequestMode?: TelegramRequestMode;
    i18n?: any;
    callback: (messages: ITelegramResponse | null, error?: Error) => Promise<void> | void;
  }) {
    this.isProcessing = false;
    this.isStopped = false;

    if (!opts.i18n) {
      throw new Error("i18n is required");
    }

    if (!opts.botToken) {
      throw new BotTokenRequiredError();
    }

    this.i18n = opts.i18n;
    this.pollingInterval = opts.pollingInterval || 0;
    this.botToken = opts.botToken;
    this.updateId = opts.updateId || 0;
    this.authorizedUser = opts.authorizedUser || "";
    this.telegramApiUrl = normalizeTelegramApiUrl(opts.telegramApiUrl);
    this.telegramRequestMode = normalizeTelegramRequestMode(opts.telegramRequestMode);
    this.callback = opts.callback;

    log.debug(this.i18n.log.InstanceInitialized, {
      pollingInterval: this.pollingInterval,
      botTokenConfigured: true,
      updateId: this.updateId,
      authorizedUserConfigured: Boolean(this.authorizedUser),
      telegramApiUrl: this.telegramApiUrl,
      telegramRequestMode: this.telegramRequestMode,
    });
  }

  start() {
    log.info(this.i18n.log.startPolling, this.pollingInterval);
    this._process();
  }

  stop() {
    log.info(this.i18n.log.stopPolling);
    this.isStopped = true;
  }

  setUpdateId(updateId: number) {
    this.updateId = updateId;
  }

  async terminate() {
    log.debug(this.i18n.log.InstanceTerminated);
    this.stop();
    while (this.isProcessing) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  private async requestTelegram(
    path: string,
    method: "GET" | "POST",
    payload: any = {}
  ): Promise<any> {
    const baseUrl = this.telegramApiUrl.trim().replace(/\/+$/, "");
    const mode = this.telegramRequestMode || "direct";
    const url = `${baseUrl}${path}`;
    const safePath = path.replace(/\/bot[^/]+/i, "/bot<redacted>");
    const safeUrl = `${baseUrl}${safePath}`;
    const timeout = 10000; // 10s timeout

    if (mode === "direct") {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);

      try {
        log.debug(`[fetch-direct] Sending request to Telegram: ${safeUrl}`, payload);
        const options: RequestInit = {
          method,
          headers: {
            "Content-Type": "application/json",
          },
          signal: controller.signal,
        };

        if (method === "POST") {
          options.body = JSON.stringify(payload);
        }

        const response = await window.fetch(url, options);
        clearTimeout(timer);

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const text = await response.text();
        return JSON.parse(text);
      } catch (err: any) {
        clearTimeout(timer);
        const isAbort = err.name === "AbortError";
        const errMsg = isAbort ? "Connection timeout (10s)" : err.message;
        log.error(`[fetch-direct] Native fetch failed for ${safeUrl}:`, errMsg);
        throw new Error(errMsg);
      }
    } else {
      log.debug(`[fetch-proxy] Sending request via Siyuan: ${safeUrl}`, payload);
      try {
        const proxyResponse = await forwardProxy(
          url,
          method,
          payload,
          [],
          timeout,
          "application/json"
        );

        if (proxyResponse && proxyResponse.body && proxyResponse.status === 200) {
          return JSON.parse(proxyResponse.body);
        } else {
          const detail = proxyResponse ? `status: ${proxyResponse.status}` : "empty response";
          throw new Error(`Invalid proxy response (${detail})`);
        }
      } catch (err: any) {
        log.error(`[fetch-proxy] Siyuan proxy request failed:`, err);
        throw err;
      }
    }
  }

  private async _process() {
    if (this.isStopped) return;

    this.isProcessing = true;

    try {
      const messages = await this.getInboxMessages();
      await this.callback(messages, undefined);
    } catch (error) {
      log.error(this.i18n.errors.ProcessingMessagesError, error);
    } finally {
      this.isProcessing = false;
      if (!this.isStopped && this.pollingInterval > 0) {
        setTimeout(() => this._process(), this.pollingInterval);
      }
    }
  }

  /**
   * 授权校验：authorizedUser 留空则不限制；
   * 否则同时支持数字用户 ID 与用户名（用户名忽略大小写、可带可不带 @）。
   */
  private isAuthorized(from: { id?: number; username?: string }): boolean {
    const allow = (this.authorizedUser || "").trim();
    if (!allow) return true;
    if (!from) return false;
    if (from.id !== undefined && String(from.id) === allow) return true;
    const username = (from.username || "").toLowerCase();
    const target = allow.replace(/^@/, "").toLowerCase();
    return username !== "" && username === target;
  }

  async handleFile(message: any): Promise<IMessageAttachment[]> {
    if (!message) {
      return [];
    }

    let file_name = "";
    let mime_type = "";
    let file_id = "";

    if (message.document) {
      file_name = message.document.file_name;
      mime_type = message.document.mime_type;
      file_id = message.document.file_id;
    } else if (message.photo && Array.isArray(message.photo) && message.photo.length > 0) {
      // 获取最大尺寸的图片
      const photo = message.photo[message.photo.length - 1];
      file_id = photo.file_id;
      mime_type = "image/jpeg";
      file_name = `photo_${Date.now()}_${photo.file_id.substring(0, 8)}.jpg`;
    } else {
      return [];
    }

    log.debug("handleFile", {
      fileName: file_name,
      mimeType: mime_type,
      fileId: file_id,
    });

    const contentType = mime_type;
    const mode = this.telegramRequestMode || "direct";

    try {
      const getFileResponseResult = await this.requestTelegram(
        `/bot${this.botToken}/getFile?file_id=${file_id}`,
        "GET"
      );

      if (!getFileResponseResult || !getFileResponseResult.result) {
        throw new Error("Failed to get file info from Telegram API");
      }

      const getFileResponse: ITelegramFileResponse = getFileResponseResult.result;
      log.debug("getFileResponse", getFileResponse);
      const file_path = getFileResponse.file_path;

      let blob: Blob;

      if (mode === "direct") {
        const baseUrl = this.telegramApiUrl.trim().replace(/\/+$/, "");
        const downloadUrl = `${baseUrl}/file/bot${this.botToken}/${file_path}`;
        log.debug("[download-direct] Downloading Telegram file");
        const controller = new AbortController();
        const downloadTimer = setTimeout(() => controller.abort(), 15000); // 15s timeout

        try {
          const downloadResponse = await window.fetch(downloadUrl, {
            signal: controller.signal,
          });
          clearTimeout(downloadTimer);

          if (!downloadResponse.ok) {
            throw new Error(`Download HTTP error! status: ${downloadResponse.status}`);
          }
          blob = await downloadResponse.blob();
        } catch (err: any) {
          clearTimeout(downloadTimer);
          throw err;
        }
      } else {
        const baseUrl = this.telegramApiUrl.trim().replace(/\/+$/, "");
        const downloadUrl = `${baseUrl}/file/bot${this.botToken}/${file_path}`;
        log.debug("[download-proxy] Downloading Telegram file via Siyuan");
        const proxyDownloadFileResponse = await forwardProxy(
          downloadUrl,
          "GET",
          {},
          [],
          15000,
          "application/json",
          "base64"
        );

        if (proxyDownloadFileResponse && proxyDownloadFileResponse.body && proxyDownloadFileResponse.status === 200) {
          const decodedData = Buffer.from(proxyDownloadFileResponse.body, "base64");
          const uint8 = new Uint8Array(decodedData);
          blob = new Blob([uint8], { type: contentType });
        } else {
          const detail = proxyDownloadFileResponse ? `status: ${proxyDownloadFileResponse.status}` : "empty response";
          throw new Error(`Download file via Siyuan proxy failed (${detail})`);
        }
      }

      const file = new File([blob], file_name, { type: contentType });

      const uploadResult = await upload("/assets/", [file]);
      log.debug("uploadResult", uploadResult);

      if (!uploadResult || !uploadResult.succMap) {
        log.error("Upload file failed or succMap is empty:", uploadResult);
        return [];
      }

      const assets: IMessageAttachment[] = Object.entries(uploadResult.succMap).map(
        ([key, value]) => ({
          fileName: key,
          path: value,
        })
      );

      return assets;
    } catch (error) {
      log.error(this.i18n.errors.ProcessingMessagesError, error);
      return [];
    }
  }

  async getInboxMessages(): Promise<ITelegramResponse | null> {
    let updateId: number;
    let messages: IMessagesList[] = [];

    const payload: IPayload = this.updateId
      ? { offset: this.updateId + 1, limit: 100 }
      : { limit: 100 };

    try {
      const telegramResponse = await this.requestTelegram(
        `/bot${this.botToken}/getUpdates`,
        "POST",
        payload
      );

      if (telegramResponse && telegramResponse.ok) {
        const messagePromises = telegramResponse.result.map(
          async (element: IUpdate) => {
            updateId = element.update_id;
            const message = element.message;
            if (message && message.date && message.from) {
              if (!this.isAuthorized(message.from)) {
                log.warn(this.i18n.log.unauthorizedUserMessage, element);
                return null; // Return null for unauthorized messages
              }

              const attachments = [];
              attachments.push(...(await this.handleFile(message)));

              const text = message.text || message.caption || "";
              if (!text && attachments.length === 0) return;

              const result = {
                id: message.message_id,
                updateId,
                date: message.date,
                chatId: message.chat.id,
                text,
                attachments,
              };

              log.debug("getInboxMessages", result);

              return result;
            }
            return null;
          }
        );

        const processedMessages = await Promise.all(messagePromises);
        messages = processedMessages.filter(Boolean);
      } else {
        const errorCode = telegramResponse?.error_code;
        const description = telegramResponse?.description || "unknown error";
        throw new Error(`Telegram API error${errorCode ? ` ${errorCode}` : ""}: ${description}`);
      }
    } catch (error) {
      log.error(this.i18n.errors.GetMessagesError, error);
      throw error;
    }

    return {
      messages,
      updateId,
    };
  }
}
