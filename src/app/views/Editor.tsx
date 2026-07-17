import { useEffect, useMemo, useState } from 'preact/hooks';
import { marked } from 'marked';
import type { GhClient } from '../../gh/index.js';
import { GhError } from '../../gh/index.js';
import { create, patch, read, split, type Edits } from '../../frontmatter/index.js';
import { jekyllDate, publishPath, slugify } from '../dates.js';
import { MSG } from '../messages.js';
import type { PublishTarget } from './Publish.js';

export interface EditorProps {
  gh: GhClient;
  /** null = new post */
  path: string | null;
  onPublished(target: PublishTarget): void;
}

interface Fields {
  title: string;
  date: string;
  description: string;
  tags: string;
  categories: string;
  image: string;
}

const EMPTY: Fields = { title: '', date: '', description: '', tags: '', categories: '', image: '' };

const asCsv = (v: unknown): string =>
  Array.isArray(v) ? v.map(String).join(', ') : v == null ? '' : String(v);

const fromCsv = (s: string): string[] =>
  s.split(',').map((x) => x.trim()).filter(Boolean);

function toFields(data: Record<string, unknown>): Fields {
  const image = data.image;
  return {
    title: asCsv(data.title),
    date: data.date == null ? '' : String(data.date),
    description: asCsv(data.description),
    tags: asCsv(data.tags),
    categories: asCsv(data.categories),
    image:
      image != null && typeof image === 'object'
        ? String((image as Record<string, unknown>).path ?? '')
        : asCsv(image),
  };
}

// Only changed fields become edits — untouched keys must never be rewritten.
function diffEdits(original: Fields, current: Fields, data: Record<string, unknown>): Edits {
  const edits: Edits = {};
  if (current.title !== original.title) edits.title = current.title;
  if (current.date !== original.date) edits.date = current.date;
  if (current.description !== original.description) edits.description = current.description;
  if (current.tags !== original.tags) edits.tags = fromCsv(current.tags);
  if (current.categories !== original.categories) edits.categories = fromCsv(current.categories);
  if (current.image !== original.image) {
    // Match the file's own shape: a scalar `image:` stays scalar; nested (or
    // absent, per the design's image.path example) goes to image.path.
    const existing = data.image;
    if (existing != null && typeof existing !== 'object') edits.image = current.image;
    else edits['image.path'] = current.image;
  }
  return edits;
}

const withBody = (raw: string, body: string): string => {
  const p = split(raw)!;
  return p.open + p.yaml + p.close + body;
};

export function EditorView({ gh, path, onPublished }: EditorProps) {
  const isNew = path === null;
  const isDraft = path?.startsWith('_drafts/') ?? false;

  const [loaded, setLoaded] = useState(!path);
  const [raw, setRaw] = useState('');
  const [headAtOpen, setHeadAtOpen] = useState<string | null>(null);
  const [fields, setFields] = useState<Fields>(EMPTY);
  const [original, setOriginal] = useState<Fields>(EMPTY);
  const [body, setBody] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(false);

  useEffect(() => {
    if (!path) return;
    Promise.all([gh.readFile(path), gh.getHeadSha()])
      .then(([file, head]) => {
        const parsed = read(file.text);
        const f = toFields(parsed?.data ?? {});
        setRaw(file.text);
        setHeadAtOpen(head);
        setFields(f);
        setOriginal(f);
        setBody(parsed?.body ?? file.text);
        setLoaded(true);
      })
      .catch((e) => setStatus(String(e instanceof Error ? e.message : e)));
  }, [path]);

  const previewHtml = useMemo(
    () => (preview ? (marked.parse(body, { async: false }) as string) : ''),
    [preview, body],
  );

  const field = (key: keyof Fields, label: string, type = 'text') => (
    <label>
      {label}
      <input
        type={type}
        value={fields[key]}
        onInput={(e) => setFields({ ...fields, [key]: (e.target as HTMLInputElement).value })}
      />
    </label>
  );

  async function run(action: () => Promise<string | null>) {
    setBusy(true);
    setStatus(null);
    try {
      setStatus(await action());
    } catch (e) {
      setStatus(e instanceof GhError && e.conflict ? MSG.conflict : String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }

  const save = () =>
    run(async () => {
      if (isNew) {
        const slug = slugify(fields.title || 'untitled');
        const content = create(
          {
            title: fields.title,
            date: fields.date || jekyllDate(new Date()),
            description: fields.description,
            tags: fromCsv(fields.tags),
            categories: fromCsv(fields.categories),
            ...(fields.image ? { image: { path: fields.image } } : {}),
          },
          body,
        );
        await gh.commit({
          message: `Draft: ${fields.title || slug}`,
          changes: [{ path: `_drafts/${slug}.md`, content }],
        });
        location.hash = `#/edit/_drafts/${slug}.md`;
        return 'Draft saved.';
      }
      const parsed = read(raw);
      const edits = diffEdits(original, fields, parsed?.data ?? {});
      let next = Object.keys(edits).length > 0 ? patch(raw, edits) : raw;
      next = withBody(next, body);
      if (next === raw) return 'Nothing to save.';
      await gh.commit({
        message: `Update: ${fields.title || path}`,
        changes: [{ path: path!, content: next }],
        expectedHeadSha: headAtOpen ?? undefined,
      });
      setRaw(next);
      setOriginal(fields);
      setHeadAtOpen(await gh.getHeadSha());
      return isDraft ? 'Draft saved.' : MSG.staleEdit;
    });

  const publish = () =>
    run(async () => {
      // Publish = one atomic move commit: _drafts/x.md → _posts/DATE-x.md.
      const date = fields.date || jekyllDate(new Date());
      const parsed = read(raw);
      const edits = diffEdits(original, { ...fields, date }, parsed?.data ?? {});
      let next = Object.keys(edits).length > 0 ? patch(raw, edits) : raw;
      next = withBody(next, body);
      const slug = slugify(fields.title || path!.replace(/^_drafts\//, '').replace(/\.md$/, ''));
      const to = publishPath(slug, date);
      const { sha } = await gh.commit({
        message: `Publish: ${fields.title || slug}`,
        changes: [{ path: to, content: next }],
        deletions: [path!],
        expectedHeadSha: headAtOpen ?? undefined,
      });
      onPublished({ sha, slug, front: read(next)?.data ?? {} });
      return null;
    });

  if (!loaded) return <p>{status ?? 'Opening…'}</p>;

  return (
    <div class="editor">
      <header>
        <a href="#/">← Posts</a>
        <div>
          <button type="button" onClick={() => setPreview(!preview)}>
            {preview ? 'Edit' : 'Preview'}
          </button>
          <button type="button" disabled={busy} onClick={save}>
            Save
          </button>
          {(isDraft || isNew) && (
            <button type="button" class="primary" disabled={busy || isNew} onClick={publish}>
              Publish
            </button>
          )}
        </div>
      </header>
      {status && <p class="banner">{status}</p>}
      <form onSubmit={(e) => e.preventDefault()}>
        {field('title', 'Title')}
        {field('date', 'Date')}
        {field('description', 'Description')}
        {field('tags', 'Tags (comma-separated)')}
        {field('categories', 'Categories (comma-separated)')}
        {field('image', 'Cover image path')}
      </form>
      {preview ? (
        <article class="preview" dangerouslySetInnerHTML={{ __html: previewHtml }} />
      ) : (
        <textarea
          value={body}
          onInput={(e) => setBody((e.target as HTMLTextAreaElement).value)}
          placeholder="Write your post in Markdown…"
        />
      )}
    </div>
  );
}
