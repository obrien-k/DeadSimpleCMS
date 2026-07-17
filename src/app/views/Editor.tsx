import { useEffect, useMemo, useState } from 'preact/hooks';
import { marked } from 'marked';
import type { GhClient } from '../../gh/index.js';
import { GhError } from '../../gh/index.js';
import {
  create,
  leaves,
  patch,
  read,
  split,
  type Edits,
  type Leaf,
  type LeafKind,
} from '../../frontmatter/index.js';
import type { Resolved } from '../../layout/index.js';
import type { Inferred } from '../../infer/index.js';
import { loadListing } from '../../listing/index.js';
import { jekyllDate, publishPath, slugify } from '../dates.js';
import { editRoute } from '../router.js';
import { MSG } from '../messages.js';
import type { PublishTarget } from './Publish.js';

export interface EditorProps {
  gh: GhClient;
  /** Carries the layout (#17) and the entries inference samples (#13). */
  resolved: Resolved;
  storage: Pick<Storage, 'getItem' | 'setItem'>;
  /** null = new post */
  path: string | null;
  onPublished(target: PublishTarget): void;
}

/** A rendered form row. `path` is a dotted leaf path — the address `patch` takes. */
interface Field {
  path: string;
  kind: LeafKind;
  label: string;
}

// The phase-1 six, in FORM_ORDER, with the shape each one writes (#6, #13).
// They are a floor for POSTS only: a page shows its own keys and nothing else,
// because `about.md` has no use for a Date or a Categories field and offering
// one only invites a writer to put a post key into a page (#12, #13).
//
// `image.path` rather than `image` preserves what the hardcoded form did before
// inference existed (DESIGN.md's worked example). It is only ever reached when
// neither the file nor the corpus has an opinion — either one wins over it via
// the same-top-key rule in `buildFields`, so a site whose posts carry a scalar
// `image:` gets a scalar back.
const FIXED: Inferred[] = [
  { path: 'title', kind: 'scalar' },
  { path: 'date', kind: 'scalar' },
  { path: 'description', kind: 'scalar' },
  { path: 'tags', kind: 'list' },
  { path: 'categories', kind: 'list' },
  { path: 'image.path', kind: 'scalar' },
];

// Hand-written labels for the six; everything else is labelled with its raw key
// path (#13). The label has to let the site's owner connect the field to what
// their theme's docs told them to set: `redirect_from` is the exact string
// jekyll-redirect-from's README uses, and "Redirect From" is a name that exists
// nowhere and cannot be searched for. Keyed by full path, so `image.alt` falls
// through to raw rather than inheriting the cover image's label.
const LABELS: Record<string, string> = {
  title: 'Title',
  date: 'Date',
  description: 'Description',
  tags: 'Tags (comma-separated)',
  categories: 'Categories (comma-separated)',
  image: 'Cover image path',
  'image.path': 'Cover image path',
};

const SIX_TOPS = new Set(FIXED.map((f) => f.path.split('.')[0]!));

type Values = Record<string, string>;

const top = (path: string): string => path.split('.')[0]!;

const fromCsv = (s: string): string[] => s.split(',').map((x) => x.trim()).filter(Boolean);

const labelOf = (path: string, kind: LeafKind): string =>
  LABELS[path] ?? (kind === 'list' ? `${path} (comma-separated)` : path);

const format = (leaf: Leaf): string =>
  leaf.kind === 'list'
    ? (leaf.value as unknown[]).map(String).join(', ')
    : leaf.value == null
      ? ''
      : String(leaf.value);

/**
 * What the form shows (#13): the six (posts only) in FORM_ORDER, then the
 * file's own keys in file order, then the inferred keys the file lacks in
 * frequency order. For a page there are no six and no inference, so the rule
 * collapses to "the form mirrors the file" — one rule, no page branch.
 *
 * A six-slot yields to the file or the corpus when either has a leaf under the
 * same top-level key, which is what keeps `image` and `image.path` from both
 * rendering as separate cover-image fields.
 */
export function buildFields(
  data: Record<string, unknown>,
  inferred: Inferred[],
  isPost: boolean,
): Field[] {
  const own = leaves(data);
  const ownPaths = new Set(own.map((l) => l.path));
  const extraInferred = inferred.filter((i) => !ownPaths.has(i.path));

  const seen = new Set<string>();
  const out: Field[] = [];
  const push = (path: string, kind: LeafKind) => {
    if (seen.has(path)) return;
    seen.add(path);
    out.push({ path, kind, label: labelOf(path, kind) });
  };

  if (isPost) {
    for (const slot of FIXED) {
      // Under a six key the file wins outright: its own leaves are its answer,
      // and the corpus only speaks where the file is silent. That is what keeps
      // a scalar `image:` post on an `image.path` site from rendering two cover
      // image fields, one of which would write the other's shape.
      const here = own.filter((l) => top(l.path) === top(slot.path));
      const guessed = extraInferred.filter((i) => top(i.path) === top(slot.path));
      if (here.length > 0) for (const l of here) push(l.path, l.kind);
      else if (guessed.length > 0) for (const i of guessed) push(i.path, i.kind);
      else push(slot.path, slot.kind);
    }
  }
  for (const l of own) push(l.path, l.kind);
  // Inference is posts-only — pages are not a corpus (#12). A six key is
  // skipped here because its slot above already settled it, whichever way.
  if (isPost) {
    for (const i of extraInferred) {
      if (!SIX_TOPS.has(top(i.path))) push(i.path, i.kind);
    }
  }
  return out;
}

const valuesOf = (fields: Field[], data: Record<string, unknown>): Values => {
  const own = new Map(leaves(data).map((l) => [l.path, format(l)]));
  return Object.fromEntries(fields.map((f) => [f.path, own.get(f.path) ?? '']));
};

// Only changed fields become edits — untouched keys must never be rewritten.
// This is also what answers "does an inferred field left blank get written?":
// it never changed, so it produces no edit and #6's insertion rule never fires.
function diffEdits(fields: Field[], original: Values, current: Values): Edits {
  const edits: Edits = {};
  for (const f of fields) {
    const value = current[f.path] ?? '';
    if (value === (original[f.path] ?? '')) continue;
    edits[f.path] = f.kind === 'list' ? fromCsv(value) : value;
  }
  return edits;
}

const withBody = (raw: string, body: string): string => {
  const p = split(raw)!;
  return p.open + p.yaml + p.close + body;
};

export function EditorView({ gh, resolved, storage, path, onPublished }: EditorProps) {
  const { layout } = resolved;
  const isNew = path === null;
  const isDraft = path !== null && layout.draftsDirs.some((d) => path.startsWith(`${d}/`));
  const isPost =
    isNew || isDraft || (path !== null && layout.postsDirs.some((d) => path.startsWith(`${d}/`)));
  // postsDirs/draftsDirs are read sets and can be empty — a site with no
  // `_drafts/` anywhere is ordinary. Writes go through writeBase, which always
  // resolves to a usable target (#18).
  const newDraftsDir = `${layout.writeBase ? `${layout.writeBase}/` : ''}_drafts`;
  const newPostsDir = `${layout.writeBase ? `${layout.writeBase}/` : ''}_posts`;

  const [loaded, setLoaded] = useState(false);
  const [raw, setRaw] = useState('');
  const [headAtOpen, setHeadAtOpen] = useState<string | null>(null);
  const [fields, setFields] = useState<Field[]>([]);
  const [values, setValues] = useState<Values>({});
  const [original, setOriginal] = useState<Values>({});
  const [body, setBody] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(false);

  useEffect(() => {
    // The corpus comes through the listing's oid-keyed cache, so arriving from
    // the list costs nothing; a deep link straight to a file pays for the
    // window once and then never again (#13). Inference is posts-only, so a
    // page does not wait on it.
    const corpus: Promise<Inferred[]> = isPost
      ? loadListing(gh, storage, resolved).then((l) => l.inferred)
      : Promise.resolve([]);
    Promise.all([path ? gh.readFile(path) : null, path ? gh.getHeadSha() : null, corpus])
      .then(([file, head, inferred]) => {
        const parsed = file ? read(file.text) : null;
        const data = parsed?.data ?? {};
        const built = buildFields(data, inferred, isPost);
        const v = valuesOf(built, data);
        setRaw(file?.text ?? '');
        setHeadAtOpen(head);
        setFields(built);
        setValues(v);
        setOriginal(v);
        setBody(parsed?.body ?? file?.text ?? '');
        setLoaded(true);
      })
      .catch((e) => setStatus(String(e instanceof Error ? e.message : e)));
  }, [path]);

  const previewHtml = useMemo(
    () => (preview ? (marked.parse(body, { async: false }) as string) : ''),
    [preview, body],
  );

  // Liquid is a measurable fact about the file, not a category we invented
  // (#12): the app deliberately does not sort pages into "content" and
  // "machinery", because Jekyll has no such distinction to read. What it can
  // honestly say is that `marked` does not know Liquid, so the preview renders
  // `{% include %}` as literal text — a lie about a file the writer is about to
  // trust. Homepages are where this bites; they are also legitimately editable.
  const hasLiquid = useMemo(() => /\{%|\{\{/.test(body), [body]);

  async function run(action: () => Promise<string | null>) {
    setBusy(true);
    setStatus(null);
    try {
      setStatus(await action());
    } catch (e) {
      setStatus(
        e instanceof GhError && e.conflict ? MSG.conflict : String(e instanceof Error ? e.message : e),
      );
    } finally {
      setBusy(false);
    }
  }

  const save = () =>
    run(async () => {
      if (isNew) {
        const title = values.title ?? '';
        const slug = slugify(title || 'untitled');
        const content = create(
          { ...diffEdits(fields, {}, { ...values, date: values.date || jekyllDate(new Date()) }) },
          body,
        );
        const draftPath = `${newDraftsDir}/${slug}.md`;
        await gh.commit({
          message: `Draft: ${title || slug}`,
          changes: [{ path: draftPath, content }],
        });
        location.hash = editRoute(draftPath);
        return 'Draft saved.';
      }
      const edits = diffEdits(fields, original, values);
      let next = Object.keys(edits).length > 0 ? patch(raw, edits) : raw;
      next = withBody(next, body);
      if (next === raw) return 'Nothing to save.';
      await gh.commit({
        message: `Update: ${values.title || path}`,
        changes: [{ path: path!, content: next }],
        expectedHeadSha: headAtOpen ?? undefined,
      });
      setRaw(next);
      setOriginal(values);
      setHeadAtOpen(await gh.getHeadSha());
      return isDraft ? 'Draft saved.' : MSG.staleEdit;
    });

  const publish = () =>
    run(async () => {
      // Publish = one atomic move commit: <drafts>/x.md → <posts>/DATE-x.md,
      // both resolved rather than assumed (#17).
      const date = values.date || jekyllDate(new Date());
      const edits = diffEdits(fields, original, { ...values, date });
      let next = Object.keys(edits).length > 0 ? patch(raw, edits) : raw;
      next = withBody(next, body);
      const fallbackSlug = path!.slice(path!.lastIndexOf('/') + 1).replace(/\.md$/, '');
      const slug = slugify(values.title || fallbackSlug);
      const to = publishPath(slug, date, newPostsDir);
      const { sha } = await gh.commit({
        message: `Publish: ${values.title || slug}`,
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
      {hasLiquid && <p class="banner warn">{MSG.liquidPreview}</p>}
      <form onSubmit={(e) => e.preventDefault()}>
        {fields.map((f) => (
          <label key={f.path}>
            {f.label}
            <input
              type="text"
              value={values[f.path] ?? ''}
              onInput={(e) =>
                setValues({ ...values, [f.path]: (e.target as HTMLInputElement).value })
              }
            />
          </label>
        ))}
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
