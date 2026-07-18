import { tokenListUrl, tokenTemplateUrl } from '../token.js';

// The two renewal paths a user is offered whenever a token is expiring or dead
// (#30), kept in one place so the pre-expiry banner and the post-expiry re-auth
// screen read identically. Two links, not one, because the right move depends on
// what the user remembers: regenerate the token they already made (repo access
// preserved) if they can find it, or create a fresh pre-filled one if they
// can't. Both open in a new tab so the paste field they return to survives.
export function RenewLinks({ owner }: { owner: string }) {
  return (
    <p class="renew-links">
      <a href={tokenListUrl()} target="_blank" rel="noopener noreferrer">
        Regenerate your token →
      </a>
      {owner && (
        <>
          {' · '}
          <a href={tokenTemplateUrl(owner)} target="_blank" rel="noopener noreferrer">
            Create a new one →
          </a>
        </>
      )}
    </p>
  );
}
