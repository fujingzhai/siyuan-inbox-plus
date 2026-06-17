import { forwardProxy, upload } from "../api";
import log from "./logger";
import { BotTokenRequiredError } from "./errors";

export class Telegram {
  pollingInterval: number;
  isProcessing: boolean;
  isStopped: boolean;
  botToken: string;
  updateId: number;
  authorizedUser: string;
  i18n: any;
  callback: (messages: ITelegramResponse | null, error?: Error) => Promise<void> | void;

  constructor(opts: {
    botToken: string;
    pollingInterval?: number;
    updateId?: number;
    authorizedUser?: string;
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
    this.callback = opts.callback;

    log.debug(this.i18n.log.InstanceInitialized, {
      pollingInterval: this.pollingInterval,
      botToken: this.botToken,
      updateId: this.updateId,
      authorizedUser: this.authorizedUser,
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

    try {
      const proxyGetFileResponse = await forwardProxy(
        `https://api.telegram.org/bot${this.botToken}/getFile?file_id=${file_id}`,
        "GET",
        {},
        [],
        7000,
        "application/json"
      );

      const getFileResponse: ITelegramFileResponse = JSON.parse(
        proxyGetFileResponse.body
      ).result;
      log.debug("getFileResponse", getFileResponse);
      const file_path = getFileResponse.file_path;

      const proxyDownloadFileResponse = await forwardProxy(
        `https://api.telegram.org/file/bot${this.botToken}/${file_path}`,
        "GET",
        {},
        [],
        7000,
        "application/json",
        "base64"
      );

      const decodedData = Buffer.from(proxyDownloadFileResponse.body, "base64");
      const uint8 = new Uint8Array(decodedData);
      const blob = new Blob([uint8], { type: contentType });
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
      const proxyResponse = await forwardProxy(
        `https://api.telegram.org/bot${this.botToken}/getUpdates`,
        "POST",
        payload,
        [],
        7000,
        "application/json"
      );

      if (proxyResponse && proxyResponse.body && proxyResponse.status === 200) {
        let telegramResponse;
        try {
          telegramResponse = JSON.parse(proxyResponse.body);
        } catch (error) {
          log.error(this.i18n.errors.jsonParseError, error);
          return null;
        }
        log.debug(this.i18n.log.telegramResponse, telegramResponse);

        if (telegramResponse.ok) {
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
          return null;
        }
      } else {
        log.error(this.i18n.errors.InvalidProxyResponseError, proxyResponse);
        return null;
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
