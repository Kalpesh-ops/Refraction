import { Brand } from './Pixel';

const UPDATED = '25 September 2026';
const REPO = 'https://github.com/Kalpesh-ops/Refraction';

function Page({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="paper">
      <header className="masthead"><Brand /><nav><a href="/">Play</a><a href="/terms">Terms</a><a href="/privacy">Privacy</a></nav></header>
      <main className="legal">
        <p className="kicker">Last updated {UPDATED}</p>
        <h1>{title}</h1>
        {children}
      </main>
      <Footer />
    </div>
  );
}

export function Footer() {
  return (
    <footer className="colophon">
      <span>Refraction is a free browser game by Kalpesh Parashar, made for the AI Skills Studio Challenge, 2026.</span>
      <span><a href="/terms">Terms</a> <a href="/privacy">Privacy</a> <a href={REPO}>Source</a></span>
    </footer>
  );
}

export function Terms() {
  return (
    <Page title="Terms of use">
      <p>Refraction is a free multiplayer browser game. By opening a room or joining one, you agree to these terms. If you do not agree, please do not use the game.</p>
      <h2>Playing</h2>
      <p>You can play without an account. You choose a display name each time you enter a room. Other players in that room will see it.</p>
      <p>Do not use names that are hateful, harassing, sexual, or that impersonate someone else. Do not try to cheat, flood rooms, disrupt other players, or interfere with the service or the database behind it.</p>
      <h2>Rooms</h2>
      <p>Anyone with a room code or invite link can join that room while it has space. Share links only with people you want to play with. We may remove rooms, names, or data that break these terms, and we may clear old rooms at any time.</p>
      <h2>No warranty</h2>
      <p>The game is provided as it is, without any warranty. It may be unavailable, change, lose a match in progress, or stop entirely. To the extent the law allows, we are not liable for any loss arising from using it.</p>
      <h2>Changes</h2>
      <p>We may update these terms. The date at the top of this page shows the latest version. Continuing to play after a change means you accept it.</p>
      <h2>Contact</h2>
      <p>Questions or reports go to the project’s issue tracker at <a href={`${REPO}/issues`}>{REPO.replace('https://', '')}/issues</a>.</p>
    </Page>
  );
}

export function Privacy() {
  return (
    <Page title="Privacy">
      <p>This page explains what Refraction stores, where, and why. The short version: a display name and the moves you make in a room. No accounts, no advertising, no analytics.</p>
      <h2>What we store</h2>
      <ul>
        <li><strong>An anonymous player ID.</strong> Firebase Authentication creates one when you first open or join a room, so the database can tell your moves from everyone else’s. It is not linked to your name, email, or any account.</li>
        <li><strong>Your display name</strong> and your player colour, saved in the room you join.</li>
        <li><strong>Match data</strong> while you play: your position, the beams you throw, hits, and scores. Other players in the room receive this in real time.</li>
      </ul>
      <h2>Where it lives</h2>
      <p>Room data is stored in Google Firebase Realtime Database, in the Singapore region. Firebase Authentication, Google’s hosting of our fonts (Google Fonts), and our web host (Vercel) receive technical data such as your IP address and browser details when your browser contacts them. Their own privacy policies apply to that processing.</p>
      <h2>On your device</h2>
      <p>The game keeps four small values in your browser’s local storage: the last display name you used, the keeper figure and colour you picked, the last room you were in (so a refresh puts you back), and whether sound is muted. The Firebase SDK also stores your anonymous sign-in in your browser. Practice mode runs entirely on your device and sends nothing.</p>
      <p>The game itself sets no tracking cookies.</p>
      <h2>How long</h2>
      <p>Rooms are not deleted automatically yet. We clear old rooms by hand from time to time. If you want a room removed sooner, open an issue with its room code. Clearing your browser’s site data removes everything stored on your device.</p>
      <h2>Children</h2>
      <p>Refraction is not directed at children under 13. Please do not enter a real full name as your display name.</p>
      <h2>Contact</h2>
      <p>Questions go to <a href={`${REPO}/issues`}>{REPO.replace('https://', '')}/issues</a>.</p>
    </Page>
  );
}
