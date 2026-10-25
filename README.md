# Buildiary Android app

The phone app of [Buildiary](https://buildiary.app), construction site management for home owners
and builders, by SMH Global Services.

The first time, the app asks for the workspace name (for example `alnoor` opens
`https://alnoor.buildiary.app`). It then shows the workspace's field screens (`/field`) and gives
them the phone's live camera (no gallery), a fresh GPS fix for every photo and attendance, and the
site card scanner. English, Urdu and Arabic.

## Code

- `app/app/index.tsx`: the workspace screen (name once, then the field screens in a WebView)
- `app/src/components/Camera.tsx`: live camera and QR (site card) scanner
- `app/src/lib/location.ts`: the GPS fix (fake locations are refused)
- `VERSION`: the app version; the Android version code is made from it

## Build

Every change on `main` builds the APK (`.github/workflows/build.yml`) and attaches it to the
`latest` release as `Buildiary.apk`, and to `buildiary-v<version>`. Raise `VERSION` for a new
version, so phones install it over the old one (the signing key stays the same).

Locally: `cd app && npm ci && npx expo start`.
