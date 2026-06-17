# SiYuan Inbox+

SiYuan Inbox+ is a powerful and lightweight information gathering assistant designed to seamlessly sync Telegram messages and native WeChat Inbox items into native SiYuan note blocks, complete with smart routing and content splitting.

## 🌟 Key Features

- **Multi-source Sync**: Effortlessly syncs Telegram messages and SiYuan native inbox items.
- **Smart Content Routing**:
  - **Shorthand Inbox**: Automatically appends fragmented short items into a designated "Short Content Document".
  - **Long Content Splitting**: Automatically splits and saves items exceeding a defined character threshold (e.g., 200 characters) as standalone documents in a selected notebook.
- **Flexible Telegram Target**: Specify a separate document target for Telegram messages, or let them fall back to the shorthand document.
- **Native Block Writing**: Writes content as native blocks without relying on any external panels, maintaining a clean note database.
- **Silent Background Sync**: Polls every 60 seconds by default, and can be changed anytime to a custom interval, daily schedule, or manual refresh.

## ⚙️ Core Settings

- **Sync Control**: Defaults to auto polling every 60 seconds. You can change the interval anytime, or switch to daily scheduled sync or manual refresh.
- **Short Content Document**: Target document for shorthand items below the length threshold.
- **Long Content Routing Threshold**: The character count boundary (defaults to 200 characters).
- **Long Content Notebook**: Receives longer content moved from the inbox, saving them as independent documents.
- **Bound Document**: Optional separate document for Telegram; leave empty to merge into the Short Content Document.
- **Bot Token**: Telegram Bot Token.
- **Authorized Username**: Limit processing to a specific Telegram username or ID for privacy and security.

## 🚀 Quick Start

1. Configure your target documents, notebooks, and Telegram Bot Token in the plugin settings.
2. Click the "Inbox+" icon on the top bar to trigger a manual sync, or wait for background polling.
3. Your incoming notes will automatically route and format into your notebook according to your settings.

## 🛠️ Troubleshooting

### Occasional Telegram `forward request failed` / `getUpdates` / `EOF`

This usually means the network connection was interrupted before Telegram Bot API returned a response. Check your network, system proxy, transparent proxy, or gateway connectivity to `api.telegram.org` first.

If Telegram note sync had already worked before, and your Bot Token, authorized username, proxy, and network settings have not changed, this is often a temporary network fluctuation or connection reuse failure. Later polling may recover automatically. If it keeps happening, check proxy rules, Telegram API reachability, and SiYuan logs around the same time.

## 📄 License

[MIT](LICENSE)

---

## 👏 Credits / Acknowledgements

This project references and draws inspiration from [shady2k/siyuan-inbox-telegram-plugin](https://github.com/shady2k/siyuan-inbox-telegram-plugin) for its Telegram message synchronization logic. Sincere thanks to the original author!

---

## Declaration

This plugin was developed entirely using vibe coding. The tools and models utilized include:

- Codex (GPT 5.5): ~50% workload
- Antigravity (Gemini 3.5 Flash): ~50% workload

Please exercise your own discretion when using this plugin.
