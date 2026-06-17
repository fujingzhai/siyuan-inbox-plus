interface ITelegramResponse {
    messages: IMessagesList[];
    updateId: number | undefined;
  }
  
  interface IMessagesList {
    id: number;
    updateId: number;
    date: number;
    chatId: number;
    text?: string;
    attachments: IMessageAttachment[];
  }

  interface IMessageAttachment {
    fileName: string;
    path: string;
  }

  interface ITelegramFileResponse {
    file_id: string;
    file_path: string;
    file_size: number;
    file_unique_id: string;
  }
  
  interface IUpdate {
    update_id: number;
    message?: {
      date: number;
      text?: string;
      caption?: string;
      from: {
        id: number;
        username?: string;
      };
      chat: {
        id: number;
      };
      message_id: number;
      document?: {
        file_name: string;
        mime_type: string;
        file_id: string;
      };
      photo?: {
        file_id: string;
        file_unique_id: string;
        width: number;
        height: number;
        file_size?: number;
      }[];
    };
    channel_post?: {
      date: number;
      text?: string;
      chat: {
        id: number;
      };
    };
  }
  
  interface IPayload {
    offset?: number;
    limit?: number;
  }

