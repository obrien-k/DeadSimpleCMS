import { render } from 'preact';
import { Installer } from './Installer.js';
import { MSG } from '../app/messages.js';

const root = document.getElementById('app') ?? document.body;

// Same hard refusal as the admin app: the installer takes a write-scoped PAT,
// and a page an attacker can rewrite in flight makes every later defence moot.
// The installer holds the token in memory only (never storage) — a github.io
// origin is shared with every other project page of its owner (#3).
if (!window.isSecureContext) {
  render(
    <main>
      <h1>DeadSimpleCMS</h1>
      <p>{MSG.insecure}</p>
    </main>,
    root,
  );
} else {
  render(
    <main>
      <h1>DeadSimpleCMS</h1>
      <Installer />
    </main>,
    root,
  );
}
