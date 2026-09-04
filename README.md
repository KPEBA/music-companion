# KPEBA Music Companion

Windows desktop companion app for KPEBA's Twitch AI Event Bot song-request feature. Pairs with your dashboard using a short code, plays requested YouTube songs during a stream, and reports back what's currently playing.

## Download

Grab the latest installer from the [Releases](../../releases) page. Windows SmartScreen may warn about the unsigned build — choose "More info" -> "Run anyway".

## Setup

1. Install and run the app.
2. In your dashboard, go to **Stream tools -> Music** and click **Connect companion** to get a pairing code (valid 10 minutes).
3. Paste the code into the app and confirm.

## Building from source

```
npm install
npm run dist:win
```

Produces an NSIS installer and a portable zip in `release/`.
