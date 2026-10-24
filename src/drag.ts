// The editor part: a drag handle at the block under the mouse, and the drop that inserts the link.
// Public API only: registerEditorExtension, editorInfoField, fileManager.generateMarkdownLink, metadataCache, vault.process.
import { Prec, StateEffect, StateField, type Extension, type Text } from '@codemirror/state';
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import { MarkdownView, Notice, TFile, editorInfoField, setIcon, type App, type Editor } from 'obsidian';
import { applyInsertion, blocksInRange, buildLink, classifyLines, collectIds, findBlock, idInsertion, isRefusal, newBlockId, readableBlockId, reuseId, subpathFor, type Block, type Insertion, type KnownId } from './blocks';

/** The data type that marks a drag from this plugin. */
export const DRAG_MIME = 'application/x-block-drag-links';

export interface DragOptions {
	/** Pro: drag every block of a selection. */
	multi: boolean;
	/** Pro: ids from the first words of the block. */
	readable: boolean;
}

export interface DragHost {
	app: App;
	options(): DragOptions;
}

interface DragItem {
	block: Block;
	/** The block lines at drag start. A write happens only when the lines are still the same. */
	snapshot: string[];
}

interface Session {
	token: string;
	path: string;
	view: EditorView;
	items: DragItem[];
}

/** The drag in progress. A drop must carry the same token. */
let session: Session | null = null;
/** For tests and the notice text: the result of the last drop. */
export const lastDrop: { result: string } = { result: '' };

const NOTICE_CHANGED = 'No link was made: the source note changed after the drag started.';

interface DocLines {
	lines: string[];
	classes: Uint8Array;
}

/** Lines and line classes of a document, computed one time for each document version, only on hover or drop. */
const docCache = new WeakMap<Text, DocLines>();
function linesOf(doc: Text): DocLines {
	let v = docCache.get(doc);
	if (!v) {
		const lines = doc.toJSON();
		v = { lines, classes: classifyLines(lines) };
		docCache.set(doc, v);
	}
	return v;
}

function fileOf(view: EditorView): TFile | null {
	const info = view.state.field(editorInfoField, false);
	const file = info?.file ?? null;
	return file instanceof TFile && file.extension === 'md' ? file : null;
}

/** Marks a drop position while the source note is written, so the link lands at the right place after edits. */
const addMarker = StateEffect.define<{ token: string; pos: number }>();
const removeMarker = StateEffect.define<string>();
const markerField = StateField.define<ReadonlyMap<string, number>>({
	create: () => new Map(),
	update(value, tr) {
		if (!tr.docChanged && tr.effects.length === 0) return value;
		const out = new Map<string, number>();
		for (const [k, p] of value) out.set(k, tr.docChanged ? tr.changes.mapPos(p, -1) : p);
		for (const e of tr.effects) {
			if (e.is(addMarker)) out.set(e.value.token, e.value.pos);
			else if (e.is(removeMarker)) out.delete(e.value);
		}
		return out;
	},
});

class HandleView {
	private readonly handle: HTMLElement;
	private block: Block | null = null;
	private blockDoc: Text | null = null;
	private frame = 0;
	private x = 0;
	private y = 0;
	private readonly onMove = (e: MouseEvent) => this.move(e);
	private readonly onLeave = (e: MouseEvent) => {
		if (e.relatedTarget instanceof Node && this.handle.contains(e.relatedTarget)) return;
		this.hide();
	};
	private readonly onScroll = () => this.hide();
	private readonly onDragStart = (e: DragEvent) => this.dragStart(e);
	private readonly onDragEnd = () => {
		this.view.dom.removeClass('bdl-dragging');
		window.setTimeout(() => {
			if (session?.view === this.view) session = null;
		}, 0);
		this.hide();
	};

	constructor(
		private readonly view: EditorView,
		private readonly host: DragHost,
	) {
		const handle = view.dom.createDiv({ cls: 'bdl-handle' });
		handle.draggable = true;
		handle.setAttribute('aria-label', 'Drag to a note to insert a link');
		setIcon(handle, 'grip-vertical');
		handle.hide();
		this.handle = handle;
		view.dom.addEventListener('mousemove', this.onMove);
		view.dom.addEventListener('mouseleave', this.onLeave);
		view.scrollDOM.addEventListener('scroll', this.onScroll, { passive: true });
		handle.addEventListener('dragstart', this.onDragStart);
		handle.addEventListener('dragend', this.onDragEnd);
	}

	update(u: ViewUpdate): void {
		// No work on a key press: only hide the handle. The block is found again on the next mouse move.
		if (u.docChanged || u.geometryChanged) this.hide();
	}

	destroy(): void {
		if (this.frame) window.cancelAnimationFrame(this.frame);
		this.view.dom.removeEventListener('mousemove', this.onMove);
		this.view.dom.removeEventListener('mouseleave', this.onLeave);
		this.view.scrollDOM.removeEventListener('scroll', this.onScroll);
		this.handle.removeEventListener('dragstart', this.onDragStart);
		this.handle.removeEventListener('dragend', this.onDragEnd);
		this.handle.remove();
	}

	private hide(): void {
		this.block = null;
		this.handle.hide();
	}

	private move(e: MouseEvent): void {
		if (e.target instanceof Node && this.handle.contains(e.target)) return;
		if (e.buttons !== 0) {
			this.hide();
			return;
		}
		this.x = e.clientX;
		this.y = e.clientY;
		if (this.frame) return;
		this.frame = window.requestAnimationFrame(() => {
			this.frame = 0;
			this.place();
		});
	}

	/** Finds the block under the mouse and shows the handle at its first line. */
	private place(): void {
		const view = this.view;
		if (!fileOf(view)) return this.hide();
		const content = view.contentDOM.getBoundingClientRect();
		if (this.y < content.top || this.y > content.bottom) return this.hide();
		const x = Math.min(Math.max(this.x, content.left + 2), content.right - 2);
		const pos = view.posAtCoords({ x, y: this.y }, false);
		const doc = view.state.doc;
		const { lines, classes } = linesOf(doc);
		const b = findBlock(lines, doc.lineAt(pos).number - 1, classes);
		if (isRefusal(b)) return this.hide();
		const outer = view.dom.getBoundingClientRect();
		const lb = view.lineBlockAt(doc.line(b.start + 1).from);
		const top = view.documentTop + lb.top - outer.top;
		const size = 20;
		const lineH = Math.min(lb.height, view.defaultLineHeight * 2);
		this.handle.style.setProperty('--bdl-top', `${Math.round(top + Math.max(0, (lineH - size) / 2))}px`);
		this.handle.style.setProperty('--bdl-left', `${Math.max(0, Math.round(content.left - outer.left - size - 6))}px`);
		this.block = b;
		this.blockDoc = doc;
		this.handle.show();
	}

	private dragStart(e: DragEvent): void {
		const view = this.view;
		const file = fileOf(view);
		const b = this.block;
		if (!file || !b || !e.dataTransfer || this.blockDoc !== view.state.doc) {
			e.preventDefault();
			return;
		}
		const doc = view.state.doc;
		const { lines, classes } = linesOf(doc);
		let blocks = [b];
		const sel = view.state.selection.main;
		if (this.host.options().multi && !sel.empty) {
			const from = doc.lineAt(sel.from).number - 1;
			const to = doc.lineAt(sel.to).number - 1;
			if (b.start >= from && b.start <= to) {
				const all = blocksInRange(lines, from, to, classes);
				if (all.length > 1) blocks = all;
			}
		}
		// Ids that Obsidian knows (sections and blocks of the metadata cache) win over a new id, when the text has them.
		const known = knownIds(this.host.app, file);
		const items = blocks.map((block) => ({ block: reuseId(lines, block, known), snapshot: lines.slice(block.start, block.end + 1) }));
		const token = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
		session = { token, path: file.path, view, items };
		const linktext = this.host.app.metadataCache.fileToLinktext(file, '', true);
		// A drop outside a Markdown editor gets plain text: a link when the target exists, else the block text.
		const plain = items.map((it) => (it.block.kind === 'heading' || it.block.id ? `[[${linktext}${subpathFor(it.block, null)}]]` : it.snapshot.join('\n'))).join('\n');
		e.dataTransfer.setData(DRAG_MIME, token);
		e.dataTransfer.setData('text/plain', plain);
		e.dataTransfer.effectAllowed = 'copyLink';
		const ghost = document.body.createDiv({ cls: 'bdl-ghost', text: items.length > 1 ? `${items.length} blocks` : (lines[b.start] ?? '').trim().slice(0, 60) });
		e.dataTransfer.setDragImage(ghost, 0, 0);
		window.setTimeout(() => ghost.remove(), 0);
		view.dom.addClass('bdl-dragging');
	}
}

/** The block ids of the metadata cache with their line ranges. */
function knownIds(app: App, file: TFile): KnownId[] {
	const cache = app.metadataCache.getFileCache(file);
	const out: KnownId[] = [];
	for (const sec of cache?.sections ?? []) if (sec.id) out.push({ id: sec.id, start: sec.position.start.line, end: sec.position.end.line });
	for (const b of Object.values(cache?.blocks ?? {})) out.push({ id: b.id, start: b.position.start.line, end: b.position.end.line });
	return out;
}

function ours(e: DragEvent): boolean {
	return !!e.dataTransfer && Array.from(e.dataTransfer.types).includes(DRAG_MIME);
}

/** Where to write the id: the live editor of the source note, if one is open. */
interface SourceWriter {
	view: EditorView | null;
	editor: Editor | null;
}

function findWriter(app: App, s: Session, target: EditorView): SourceWriter {
	// Same note, also in another pane: the target editor writes the id and the link in one transaction.
	// Obsidian copies the change to the other panes of the note. Two writes in two panes would race.
	if (fileOf(target)?.path === s.path) return { view: target, editor: null };
	if (s.view.dom.isConnected && fileOf(s.view)?.path === s.path) return { view: s.view, editor: null };
	for (const leaf of app.workspace.getLeavesOfType('markdown')) {
		const v = leaf.view;
		if (v instanceof MarkdownView && v.file?.path === s.path) return { view: null, editor: v.editor };
	}
	return { view: null, editor: null };
}

function sameLines(current: readonly string[], item: DragItem): boolean {
	const now = current.slice(item.block.start, item.block.end + 1).map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));
	return now.length === item.snapshot.length && now.every((l, i) => l === item.snapshot[i]);
}

/**
 * Saves the open editors of the source note at once, so the metadata cache knows the new id before an embed
 * of it draws. Without this, an embed shows "Unable to find" until the editor saves by itself (about 2 s).
 */
function saveSource(app: App, path: string): void {
	for (const leaf of app.workspace.getLeavesOfType('markdown')) {
		const v = leaf.view;
		if (v instanceof MarkdownView && v.file?.path === path) void v.save();
	}
}

interface Plan {
	links: string;
	insertions: Insertion[];
}

/** Gives each block its id (existing or new) and builds the link text and the id insertions. */
function plan(host: DragHost, s: Session, current: readonly string[], sourceText: string, source: TFile, targetPath: string, sameNote: boolean, embed: boolean, eol: string): Plan {
	const cache = host.app.metadataCache.getFileCache(source);
	const taken = [...collectIds(sourceText), ...Object.keys(cache?.blocks ?? {}).map((k) => k.toLowerCase())];
	const links: string[] = [];
	const insertions: Insertion[] = [];
	for (const it of s.items) {
		let id = it.block.id;
		if (it.block.kind !== 'heading' && id === null) {
			id = (host.options().readable ? readableBlockId(it.snapshot.join('\n'), taken) : null) ?? newBlockId(taken);
			taken.push(id.toLowerCase());
			const ins = idInsertion(current, it.block, id, eol);
			if (ins) insertions.push(ins);
		}
		const subpath = subpathFor(it.block, id);
		const generated = host.app.fileManager.generateMarkdownLink(source, targetPath, subpath);
		links.push(buildLink(generated, subpath, sameNote, embed));
	}
	return { links: links.join('\n'), insertions };
}

class ChangedError extends Error {}

/** Inserts the links at pos in the target editor and moves the cursor after them. */
function insertLinks(view: EditorView, pos: number, text: string): void {
	if (!view.dom.isConnected) return;
	const at = Math.min(pos, view.state.doc.length);
	view.dispatch({ changes: { from: at, insert: text }, selection: { anchor: at + text.length }, userEvent: 'input.drop', scrollIntoView: true });
}

async function drop(host: DragHost, s: Session, view: EditorView, pos: number, embed: boolean): Promise<void> {
	const app = host.app;
	const source = app.vault.getFileByPath(s.path);
	if (!source) {
		lastDrop.result = 'missing';
		new Notice('No link was made: the source note does not exist now.');
		return;
	}
	const targetFile = fileOf(view);
	const sameNote = targetFile?.path === s.path;
	const targetPath = targetFile?.path ?? '';
	const writer = findWriter(app, s, view);

	if (writer.view) {
		// The source is open in an editor: write the id there, so Undo in that editor removes it.
		const w = writer.view;
		const doc = w.state.doc;
		const { lines } = linesOf(doc);
		if (!s.items.every((it) => sameLines(lines, it))) {
			lastDrop.result = 'changed';
			new Notice(NOTICE_CHANGED);
			return;
		}
		const p = plan(host, s, lines, doc.toString(), source, targetPath, sameNote, embed, '\n');
		const idChanges = p.insertions.map((ins) => ({ from: doc.line(ins.line + 1).to, insert: ins.text }));
		if (w === view) {
			// Same note in the same editor: the id and the link are one transaction, so one Undo removes both.
			const changes = [...idChanges, { from: pos, insert: p.links }].sort((a, b) => a.from - b.from);
			const set = w.state.changes(changes);
			w.dispatch({ changes: set, selection: { anchor: set.mapPos(pos, 1) }, userEvent: 'input.drop', scrollIntoView: true });
		} else {
			if (idChanges.length) w.dispatch({ changes: idChanges, userEvent: 'input' });
			insertLinks(view, pos, p.links);
		}
		if (idChanges.length) saveSource(app, s.path);
		lastDrop.result = 'editor';
		return;
	}

	if (writer.editor) {
		const ed = writer.editor;
		const current = ed.getValue().split('\n');
		if (!s.items.every((it) => sameLines(current, it))) {
			lastDrop.result = 'changed';
			new Notice(NOTICE_CHANGED);
			return;
		}
		const p = plan(host, s, current, current.join('\n'), source, targetPath, sameNote, embed, '\n');
		if (p.insertions.length) ed.transaction({ changes: p.insertions.map((ins) => ({ from: { line: ins.line, ch: ed.getLine(ins.line).length }, text: ins.text })) });
		insertLinks(view, pos, p.links);
		if (p.insertions.length) saveSource(app, s.path);
		lastDrop.result = 'editor';
		return;
	}

	// The source note is closed: write the id with vault.process. Mark the drop position, so edits in the
	// target during the write move the link with the text.
	view.dispatch({ effects: addMarker.of({ token: s.token, pos }) });
	let links = '';
	try {
		await app.vault.process(source, (data) => {
			const current = data.split('\n');
			if (!s.items.every((it) => sameLines(current, it))) throw new ChangedError('changed');
			const eol = data.includes('\r\n') ? '\r\n' : '\n';
			const p = plan(host, s, current, data, source, targetPath, sameNote, embed, eol);
			links = p.links;
			// From the bottom up, so each line number stays correct.
			let out = data;
			for (const ins of [...p.insertions].sort((a, b) => b.line - a.line)) out = applyInsertion(out, ins);
			return out;
		});
	} catch (err) {
		if (view.dom.isConnected) view.dispatch({ effects: removeMarker.of(s.token) });
		lastDrop.result = 'changed';
		new Notice(err instanceof ChangedError ? NOTICE_CHANGED : 'No link was made: the source note could not be written.');
		return;
	}
	if (!view.dom.isConnected) return;
	const at = view.state.field(markerField).get(s.token) ?? pos;
	view.dispatch({ effects: removeMarker.of(s.token) });
	insertLinks(view, at, links);
	lastDrop.result = 'vault';
}

/** The editor extension: the handle in every Markdown editor, and the drop handler at the highest precedence. */
export function dragExtension(host: DragHost): Extension {
	return [
		markerField,
		ViewPlugin.define((view) => new HandleView(view, host)),
		Prec.highest(
			EditorView.domEventHandlers({
				dragover(e) {
					if (!ours(e)) return false;
					e.preventDefault();
					if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
					return false;
				},
				drop(e, view) {
					if (!ours(e)) return false;
					const token = e.dataTransfer?.getData(DRAG_MIME) ?? '';
					const s = session;
					if (!s || s.token !== token) return false;
					e.preventDefault();
					session = null;
					const pos = view.posAtCoords({ x: e.clientX, y: e.clientY }, false);
					// A drop inside a dragged block of the same note does nothing.
					if (fileOf(view)?.path === s.path && s.items.some((it) => pos >= view.state.doc.line(it.block.start + 1).from && pos <= view.state.doc.line(it.block.end + 1).to)) {
						lastDrop.result = 'inside';
						return true;
					}
					void drop(host, s, view, pos, e.ctrlKey || e.metaKey);
					return true;
				},
			}),
		),
	];
}
