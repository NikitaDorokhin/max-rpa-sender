# MAX RPA Sender

Experimental browser automation for sending a first message in MAX Web from a logged-in personal account.

This is not an official MAX API client. It controls a real Chrome window:

1. Opens MAX Web.
2. You log in once.
3. The script clicks `+`.
4. Selects `Find by phone number`.
5. Enters the phone number.
6. Opens the found chat.
7. Sends the message.

Use only for contacts who consented to being contacted. Do not use for spam.

## Requirements

- Windows, macOS, or Linux
- Node.js 20+
- Google Chrome or bundled Playwright Chromium

## Install

```powershell
npm install
npm run install-browser
```

## Login

Open MAX Web in a separate browser profile:

```powershell
npm run open
```

Log in to MAX in the opened browser window and keep the window open.

## Send One Message

```powershell
npm run send -- --phone "+79000000000" --message "Hello"
```

The script prints one JSON line:

```json
{"ok":true,"status":"sent","phone":"+79000000000"}
```

Possible statuses:

- `sent` - message was sent.
- `not_found` - MAX did not find a contact by phone.
- `not_logged_in` - MAX session is not logged in.
- `failed` - another automation error happened.

## Notes

- Phone numbers are normalized for the Russian `+7` UI. For `+79000000000`, the script enters `9000000000`.
- The script stores browser state in `max-browser-profile/`. This folder is ignored by Git and must not be published.
- This is a pilot RPA script. MAX Web UI changes can break selectors.
