# Cloudplay

Minimal pod-pool site on the Foxphone Public API. One home page lists Roblox (Modded), Terraria (Modded) and Fortnite (Normal). Launch reserves a free matching cloud phone for 30 minutes.

## What the Foxphone API allows
The public API only lists phones and proxies, resets phones and binds proxies. It cannot stream a screen, launch apps, install games, lock a phone to one app or send controller or keyboard input, so players open their reserved phone in the Foxphone app or web client. Lock a phone to one game with Android app pinning or kiosk settings on the phone itself.

## Setup in Foxphone
The site finds games by phone name. Any phone whose name contains `Roblox`, `Terraria` or `Fortnite` (any case) is used for that game, e.g. `Roblox 1`, `fortnite-02`. Install each game on its phones yourself.

## Adding your API key
1. In Foxphone, click your avatar, open Settings, then the API Key page, and generate a key. It is shown once.
2. Locally: copy `.env.example` to `.env`, paste the key after `FOXPHONE_API_KEY=`, set `ADMIN_TOKEN` to any long secret, then run `node --env-file=.env server.js`.
3. On Render: open your service, go to Environment, add `FOXPHONE_API_KEY` and `ADMIN_TOKEN`, then save. Render redeploys and the site finds your phones.
Never paste the key into code, GitHub or the browser.

## Run locally
    npm install
    FOXPHONE_API_KEY=... ADMIN_TOKEN=... npm start

## Deploy on Render
Push to GitHub, then in Render choose New > Blueprint and select the repo. Set `FOXPHONE_API_KEY` and `ADMIN_TOKEN` when prompted. Never commit the key.

Rate limit: 60 requests/minute per key; phone lists are cached for 15 seconds.

## ADB launch, lock and controls (optional)
Needs `adb` (Android platform-tools) on the machine running the server, so run it on your own PC or a VPS, not Render's plain Node runtime.
1. In Foxphone, get each phone's SSH tunnel details and open the tunnel, e.g. `ssh user@host -p 1824 -L 8767:adb-proxy:53398 -Nf`.
2. Copy `phones.config.example.json` to `phones.config.json` (it is git-ignored) and fill in each phone's `pod_id`, local ADB address, joystick centre and radius, and button positions in screen pixels. Package names are built in (Roblox `com.roblox.client`, Terraria `com.and.games505.TerrariaPaid`, Fortnite `com.epicgames.fortnite`); add a `"games": {"roblox": "..."}` entry to a phone only to override one.
3. Start the server. Launch then connects over ADB, starts only that game, and relaunches it if anything else takes focus.

Known limits: the lock is a 2.5-second focus watchdog, not Android kiosk mode. The screen preview is screenshots at a few frames per second, not video. Each input is an `adb shell input` call, so expect noticeable lag, and `input motionevent` needs a recent Android version.

## Admin page
Open `/admin.html` and sign in with the value of the `ADMIN_TOKEN` environment variable. It lists every phone with its game, online state and reservation, and has Release and Reset buttons. Five wrong attempts lock that IP out for 10 minutes. Set the password only as an environment variable, never in the code.

Terraria's cover is a placeholder (`public/terraria.svg`). Replace it with your own image and update the `image` path in `server.js` if the file name changes.
