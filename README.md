# KPEBA Music Companion

Windows desktop companion app for KPEBA's Twitch AI Event Bot song-request feature. Pairs with your dashboard using a short code, plays requested YouTube songs during a stream, and reports back what's currently playing.

## Download

Grab the latest installer from the [Releases](../../releases) page. Windows SmartScreen may warn about the unsigned build — choose "More info" -> "Run anyway".

## Setup

1. Install and run the app.
2. In your dashboard, go to **Stream tools -> Music** and click **Connect companion** to get a pairing code (valid 10 minutes).
3. Click **Open in app** next to the code — if the app is already running (or installed), it pairs itself automatically via a `kpeba-music://` link, no typing needed. If that doesn't work (e.g. first install before the OS has registered the link), paste the code into the app manually instead.

## Building from source

```
npm install
npm run dist:win
```

Produces an NSIS installer and a portable zip in `release/`.
