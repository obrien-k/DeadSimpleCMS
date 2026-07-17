import { describe, expect, it } from 'vitest';
import { spliceText } from '../../src/app/views/Editor.js';
import { insertionMarkdown } from '../../src/image/index.js';

// The cursor-insert behind "Add image" (#14). The risk this covers: a second
// image insert landing inside the markdown of the first because the caret math
// was off. The DOM parts (focus, setSelectionRange) are not logic; this is.
describe('spliceText: where inserted image markdown lands', () => {
  it('inserts at the caret when nothing is selected', () => {
    expect(spliceText('ab', 1, 1, 'X')).toEqual({ text: 'aXb', caret: 2 });
  });

  it('appends at end (the fallback when the textarea is not focused)', () => {
    const body = 'Some text.';
    expect(spliceText(body, body.length, body.length, '\n![](/x.jpg)')).toEqual({
      text: 'Some text.\n![](/x.jpg)',
      caret: body.length + '\n![](/x.jpg)'.length,
    });
  });

  it('replaces a selection rather than keeping both', () => {
    expect(spliceText('one TWO three', 4, 7, 'X')).toEqual({ text: 'one X three', caret: 5 });
  });

  it('a second insert lands AFTER the first, using the returned caret', () => {
    const a = insertionMarkdown('assets/img', 'a.jpg');
    const b = insertionMarkdown('assets/img', 'b.jpg');
    const first = spliceText('', 0, 0, a);
    const second = spliceText(first.text, first.caret, first.caret, b);
    expect(second.text).toBe(a + b);
    // The two images are adjacent and whole — neither nested in the other.
    expect(second.text).toContain('a.jpg)![');
  });
});
