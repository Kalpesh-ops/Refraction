# Refraction

Refraction is a 2–6 player live mirror-maze game. Each runner leaves a five-second delayed reflection. Use your reflection to hold a sigil plate, take a relic, return it to your shrine, and dash rivals before they score.

## Run locally

```powershell
npm install
npm run dev
```

Without Firebase configuration, the app runs in a local preview mode for UI and one-browser gameplay. Firebase is required for players on separate devices.

## Enable live rooms

1. Create a Firebase project, enable **Anonymous** sign-in, and create a **Realtime Database**.
2. Copy `.env.example` to `.env.local` and fill every `VITE_FIREBASE_*` value from Firebase's Web app configuration.
3. Deploy `database.rules.json` in the Firebase Realtime Database Rules editor.
4. Run `npm run build` again to confirm the production bundle.

## Deploy on Vercel

1. Import this folder into Vercel, or run `npx vercel link` and then `npx vercel --prod`.
2. Add every `VITE_FIREBASE_*` setting from `.env.local` to both Preview and Production environments in Vercel.
3. Redeploy. Visitors can share `https://your-domain.example/?room=ABCDE` after creating a room.

## Contest submission copy

**Title:** Refraction

**Description:** Refraction is a live multiplayer mirror-maze for 2–6 players. Every runner leaves a spectral echo that repeats their route five seconds later. Time that echo onto a sigil plate to unlock relics, race them back to your shrine, and dash rivals before they score. Create a room, share the link, and outplay your own past on phone or desktop.

Use `public/assets/refraction-cover.png` as the project cover image and paste the final Vercel URL into the project link field.
