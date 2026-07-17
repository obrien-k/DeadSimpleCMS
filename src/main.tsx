import { render } from 'preact';
import { App } from './app/App.js';
import { readRepoConfig, ConfigError } from './app/config.js';
import { MSG } from './app/messages.js';

const root = document.getElementById('app') ?? document.body;

function refuse(message: string) {
  render(
    <main class="refusal">
      <h1>DeadSimpleCMS</h1>
      <p>{message}</p>
    </main>,
    root,
  );
}

// A page served over plain HTTP can be MITM'd and handed a token-stealing
// script — every other defence is theatre once the attacker runs in the page.
// Hard refusal, not a warning.
if (!window.isSecureContext) {
  refuse(MSG.insecure);
} else {
  try {
    const configuredRepo = readRepoConfig(document);
    render(<App configuredRepo={configuredRepo} storage={localStorage} />, root);
  } catch (e) {
    refuse(e instanceof ConfigError ? e.message : String(e));
  }
}
