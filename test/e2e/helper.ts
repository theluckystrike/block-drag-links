// In-app drag helper, shared by the end-to-end test and qa.json (the shots). It runs inside Obsidian.
// It moves the mouse over a line, so the plugin shows its handle, then sends dragstart from the handle, and
// dragenter, dragover, drop and dragend at a document position, with one DataTransfer, as a browser drag does.
// A pane number (0, 1) also finds an editor, for one note in two panes.
// A note name without a folder also finds the note (the shots put sample notes in a folder).
// WebDriver cannot start an HTML drag in Chromium, so the events are made with the DragEvent constructor.
export const DRAG_HELPER = `
window.__bdl = (() => {
	const app = window.app;
	const tick = (ms) => new Promise((r) => setTimeout(r, ms));
	const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
	const leaf = (p) => typeof p === 'number' ? app.workspace.getLeavesOfType('markdown')[p] : app.workspace.getLeavesOfType('markdown').find((l) => l.view.file && (l.view.file.path === p || l.view.file.name === p));
	const file = (p) => app.vault.getFileByPath(p) || app.vault.getMarkdownFiles().find((f) => f.name === p);
	const cm = (p) => { const l = leaf(p); if (!l) throw new Error('no editor for ' + p); return l.view.editor.cm; };
	const live = async (l) => { const s = l.getViewState(); await l.setViewState({ ...s, state: { ...s.state, mode: 'source', source: false } }); };
	const setup = async (src, tgt) => {
		app.workspace.detachLeavesOfType('markdown');
		await tick(100);
		const a = app.workspace.getLeaf(true);
		await a.openFile(file(src));
		await live(a);
		if (tgt) {
			const b = app.workspace.createLeafBySplit(a, 'vertical');
			await b.openFile(file(tgt));
			await live(b);
		}
		await tick(400);
		return 'ok';
	};
	const hover = async (p, line) => {
		const v = cm(p);
		const c = v.coordsAtPos(v.state.doc.line(line + 1).from);
		if (!c) throw new Error('line ' + line + ' is not drawn');
		v.contentDOM.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: c.left + 8, clientY: (c.top + c.bottom) / 2 }));
		await frame();
		await tick(60);
		const h = v.dom.querySelector('.bdl-handle');
		return h && h.style.display !== 'none' ? h : null;
	};
	let dt = null;
	let handle = null;
	const start = async (p, line) => {
		handle = await hover(p, line);
		if (!handle) throw new Error('no handle at ' + p + ' line ' + line);
		dt = new DataTransfer();
		handle.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
		return dt.types.join(',');
	};
	const drop = async (p, line, ch, ctrl) => {
		const v = cm(p);
		const ln = v.state.doc.line(line + 1);
		const pos = Math.min(ln.from + ch, ln.to);
		const c = v.coordsAtPos(pos);
		const x = c.left + 1;
		const y = (c.top + c.bottom) / 2;
		const el = document.elementFromPoint(x, y) || v.contentDOM;
		for (const t of ['dragenter', 'dragover']) el.dispatchEvent(new DragEvent(t, { bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y }));
		el.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y, ctrlKey: !!ctrl }));
		handle.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
		await tick(200);
		return 'ok';
	};
	const cancel = async () => {
		handle.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
		await tick(200);
		return dt.getData('text/plain');
	};
	const text = (p) => leaf(p) ? leaf(p).view.editor.getValue() : null;
	return { tick, leaf, file, cm, setup, hover, start, drop, cancel, text };
})();
`;
