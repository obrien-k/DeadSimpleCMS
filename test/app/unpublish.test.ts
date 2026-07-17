import { describe, expect, it } from 'vitest';
import { buildUnpublish } from '../../src/app/views/Publish.js';

// The commit that undoes a red publish (#9). The publish move was
// draft → post (draft deleted); this reverses it. The risk it covers: an Undo
// that deletes the post without restoring the draft would lose the writer's
// work, or one that strips the co-committed images the restored draft still
// links. Both are decided in the shape of this commit, so it is tested here.
describe('buildUnpublish: the reverse of the publish move', () => {
  const target = {
    path: '_posts/2026-07-17-my-post.md',
    from: '_drafts/my-post.md',
    slug: 'my-post',
    front: { title: 'My Post' },
  };
  const content = '---\ntitle: My Post\n---\n\nBody with an `{% if x %}` that broke the build.\n';

  it('restores the draft with the post’s exact content and deletes the post', () => {
    const { changes, deletions } = buildUnpublish(target, content);
    expect(changes).toEqual([{ path: '_drafts/my-post.md', content }]);
    expect(deletions).toEqual(['_posts/2026-07-17-my-post.md']);
  });

  it('touches nothing else — images that rode the publish commit are left in place', () => {
    const { changes, deletions } = buildUnpublish(target, content);
    // Exactly one write (the draft) and one delete (the post): no image path is
    // added to either list, so a co-committed /assets/img/… blob survives.
    expect(changes).toHaveLength(1);
    expect(deletions).toHaveLength(1);
  });

  it('labels the commit with the title, falling back to the slug', () => {
    expect(buildUnpublish(target, content).message).toBe('Unpublish: My Post');
    expect(buildUnpublish({ ...target, front: {} }, content).message).toBe('Unpublish: my-post');
  });
});
