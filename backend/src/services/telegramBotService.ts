import { Bot } from "grammy";

export interface TelegramConfig {
  token: string;
  chatIds?: string[];
}

class TelegramBotService {
  private bot: Bot | null = null;
  private config: TelegramConfig | null = null;
  private isRunning = false;

  initialize(config: TelegramConfig) {
    if (!config.token) {
      console.warn("[Telegram] No token provided, bot disabled");
      return;
    }

    this.config = config;
    this.bot = new Bot(config.token);

    // Handle /start command
    this.bot.command("start", (ctx) =>
      ctx.reply("Halo! Saya adalah bot notifikasi Daftar Upah Portal.")
    );

    // Handle /help command
    this.bot.command("help", (ctx) =>
      ctx.reply(
        "Perintah tersedia:\n" +
        "/start - Memulai bot\n" +
        "/help - Menampilkan bantuan\n" +
        "/status - Cek status sistem"
      )
    );

    // Handle /status command
    this.bot.command("status", (ctx) =>
      ctx.reply("Sistem berjalan normal ✓")
    );

    // Handle any message
    this.bot.on("message", (ctx) => {
      console.log("[Telegram] Received message:", ctx.message.text);
    });

    console.log("[Telegram] Bot initialized");
  }

  async sendMessage(message: string, parseMode?: "HTML" | "Markdown") {
    if (!this.bot || !this.config) {
      console.warn("[Telegram] Bot not initialized");
      return;
    }

    try {
      if (this.config.chatIds && this.config.chatIds.length > 0) {
        for (const chatId of this.config.chatIds) {
          await this.bot.api.sendMessage(chatId, message, {
            parse_mode: parseMode || "HTML",
          });
        }
      }
      console.log("[Telegram] Message sent successfully");
    } catch (error) {
      console.error("[Telegram] Failed to send message:", error);
    }
  }

  async start() {
    if (!this.bot) {
      console.warn("[Telegram] Bot not initialized");
      return;
    }

    if (this.isRunning) {
      console.log("[Telegram] Bot already running");
      return;
    }

    this.isRunning = true;
    console.log("[Telegram] Bot started");
    
    // Start bot in background (non-blocking)
    this.bot.start({
      onStart: (botInfo) => {
        console.log(`[Telegram] Bot @${botInfo.username} is running`);
      }
    });
  }

  stop() {
    if (this.bot) {
      this.bot.stop();
      this.isRunning = false;
      console.log("[Telegram] Bot stopped");
    }
  }
}

export const telegramBot = new TelegramBotService();

// Also export a simple notification function for easy use
export async function sendTelegramNotification(
  message: string,
  parseMode: "HTML" | "Markdown" = "HTML"
) {
  telegramBot.sendMessage(message, parseMode);
}
