// Pure Markdown block logic: find the block at a line, find or make its block id, and build link text.
// No Obsidian import here, so the golden vectors (packages/spec/vectors/block-drag-links.json) test it directly.
// The parser reads the editor text, not the metadata cache, because the editor text can be newer than the
// saved file. The drag code adds the ids from the metadata cache with reuseId() when the text still has them.

/** Line classes from one scan of the note. */
export const LineClass = { Text: 0, Frontmatter: 1, Code: 2, Math: 3, Table: 4, Comment: 5, Html: 6 } as const;

export type BlockKind = 'heading' | 'paragraph' | 'list' | 'task' | 'quote' | 'callout' | 'table';
export type RefuseKind = 'empty' | 'code' | 'math' | 'frontmatter' | 'id-line' | 'rule' | 'footnote' | 'comment' | 'html';

export interface Block {
	kind: BlockKind;
	/** First line of the block, 0-based. */
	start: number;
	/** Last line of the block, 0-based, inclusive. */
	end: number;
	/** The existing block id (without ^), or null. Always null for a heading. */
	id: string | null;
	/** Heading text as Obsidian stores it (headings only), else null. */
	heading: string | null;
}

export interface Refusal {
	kind: RefuseKind;
	refused: true;
}

export type BlockResult = Block | Refusal;

export function isRefusal(b: BlockResult): b is Refusal {
	return (b as Refusal).refused === true;
}

/** A backtick fence: its info string has no backtick (CommonMark), so ```x``` text is inline code. */
const BACKTICK_FENCE = /^ {0,3}(`{3,})[^`]*$/;
const TILDE_FENCE = /^ {0,3}(~{3,})/;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/;
const LIST = /^(\s*)([-*+]|\d{1,9}[.)])(?:[ \t]+|$)/;
const TASK = /^\s*(?:[-*+]|\d{1,9}[.)])[ \t]+\[.\](?:[ \t]|$)/;
const QUOTE = /^\s{0,3}>/;
const CALLOUT = /^\s{0,3}>\s*\[!/;
const TABLE = /^\s*\|/;
/** A table delimiter row such as |---|:--:| or --|--. */
const TABLE_DELIM = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)+\|?[ \t]*$|^ {0,3}\|[ \t]*:?-+:?[ \t]*\|?[ \t]*$/;
/** A thematic break: three or more -, * or _ with only spaces between. */
const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
/** A setext underline: = or - only. */
const UNDERLINE = /^ {0,3}(?:=+|-+)[ \t]*$/;
const FOOTNOTE = /^ {0,3}\[\^[^\]]+\]:/;
/** CommonMark HTML block start conditions 1 to 6. These can interrupt a paragraph. */
const HTML_BLOCK =
	/^ {0,3}(?:<(?:script|pre|style|textarea)(?:\s|>|$)|<!--|<\?|<![A-Za-z]|<!\[CDATA\[|<\/?(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?:\s|\/?>|$))/i;
/** CommonMark HTML block conditions 1 to 5 and their end markers. These blocks can hold blank lines. */
const HTML_RAW: ReadonlyArray<[RegExp, RegExp]> = [
	[/^ {0,3}<(?:script|pre|style|textarea)(?:\s|>|$)/i, /<\/(?:script|pre|style|textarea)>/i],
	[/^ {0,3}<!--/, /-->/],
	[/^ {0,3}<\?/, /\?>/],
	[/^ {0,3}<![A-Za-z]/, />/],
	[/^ {0,3}<!\[CDATA\[/, /\]\]>/],
];
/** CommonMark HTML block condition 7: one complete open or close tag alone on the line. It cannot interrupt a paragraph. */
const HTML_LONE_TAG = /^ {0,3}(?:<[A-Za-z][A-Za-z0-9-]*(?:\s+[A-Za-z_:][\w.:-]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*\s*\/?>|<\/[A-Za-z][A-Za-z0-9-]*\s*>)[ \t]*$/;
/** A block id at the end of a line: a space (or line start), ^, then letters, digits and dashes. */
const END_ID = /(?:^|\s)\^([A-Za-z0-9-]+)[ \t]*$/;
const ID_LINE = /^\^([A-Za-z0-9-]+)[ \t]*$/;

/** Strips a trailing carriage return, so CRLF notes give the same lines as LF notes. */
function bare(line: string | undefined): string {
	if (line === undefined) return '';
	return line.endsWith('\r') ? line.slice(0, -1) : line;
}

/** Indent width, a tab counts as 4. */
function indent(line: string): number {
	let w = 0;
	for (const ch of line) {
		if (ch === ' ') w++;
		else if (ch === '\t') w += 4 - (w % 4);
		else break;
	}
	return w;
}

/**
 * Classifies each line in one pass: front matter, fenced or indented code, math, comment, table or text.
 * A fence closes on a line with the same character, at least as long, and nothing else.
 */
export function classifyLines(rawLines: readonly string[]): Uint8Array {
	const n = rawLines.length;
	const at = (i: number) => bare(rawLines[i]);
	const out = new Uint8Array(n);
	let i = 0;
	if (at(0) === '---') {
		let close = -1;
		for (let j = 1; j < n; j++) {
			if (at(j) === '---' || at(j) === '...') {
				close = j;
				break;
			}
		}
		if (close > 0) {
			for (let j = 0; j <= close; j++) out[j] = LineClass.Frontmatter;
			i = close + 1;
		}
	}
	let lastText = -1;
	for (; i < n; i++) {
		const line = at(i);
		const fence = BACKTICK_FENCE.exec(line) ?? TILDE_FENCE.exec(line);
		if (fence) {
			const mark = fence[1] ?? '```';
			const ch = mark.charAt(0);
			out[i] = LineClass.Code;
			let j = i + 1;
			for (; j < n; j++) {
				out[j] = LineClass.Code;
				const close = FENCE_CLOSE.exec(at(j));
				if (close && (close[1] ?? '').charAt(0) === ch && (close[1] ?? '').length >= mark.length) break;
			}
			i = j;
			lastText = Math.min(j, n - 1);
			continue;
		}
		const t = line.trim();
		if (t.startsWith('$$')) {
			out[i] = LineClass.Math;
			// A one-line block: $$x$$.
			if (t.length > 4 && t.endsWith('$$')) continue;
			let j = i + 1;
			for (; j < n; j++) {
				out[j] = LineClass.Math;
				if (at(j).trim().endsWith('$$')) break;
			}
			i = j;
			lastText = Math.min(j, n - 1);
			continue;
		}
		if (t.startsWith('%%')) {
			out[i] = LineClass.Comment;
			if (t.length >= 4 && t.slice(2).includes('%%')) continue;
			let j = i + 1;
			for (; j < n; j++) {
				out[j] = LineClass.Comment;
				if (at(j).includes('%%')) break;
			}
			i = j;
			lastText = Math.min(j, n - 1);
			continue;
		}
		// HTML blocks of types 1 to 5 end at their end marker, also on the start line, not at a blank line.
		const raw = HTML_RAW.find(([open]) => open.test(line));
		if (raw) {
			const close = raw[1];
			let j = i;
			const startRest = line.replace(/^ {0,3}<!?-?-?\??/, '');
			if (!close.test(startRest)) {
				for (j = i + 1; j < n; j++) {
					out[j] = LineClass.Html;
					if (close.test(at(j))) break;
				}
			}
			out[i] = LineClass.Html;
			i = Math.min(j, n - 1);
			lastText = i;
			continue;
		}
		// Indented code: 4 spaces after a blank line, when the text above is not a list (a list keeps its indent).
		if (t !== '' && indent(line) >= 4 && i > 0 && at(i - 1).trim() === '' && !LIST.test(line)) {
			const above = lastText >= 0 ? at(lastText) : '';
			const inList = lastText >= 0 && out[lastText] === LineClass.Text && (LIST.test(above) || indent(above) >= 2);
			if (!inList) {
				let j = i;
				while (j < n) {
					const l = at(j);
					if (l.trim() === '') {
						let k = j + 1;
						while (k < n && at(k).trim() === '') k++;
						if (k < n && indent(at(k)) >= 4) {
							j = k;
							continue;
						}
						break;
					}
					if (indent(l) < 4) break;
					out[j] = LineClass.Code;
					lastText = j;
					j++;
				}
				i = j - 1;
				continue;
			}
		}
		// A table, also without a leading pipe: a row with a pipe, then a delimiter row, then rows with a pipe.
		if (line.includes('|') && TABLE_DELIM.test(at(i + 1))) {
			out[i] = LineClass.Table;
			let j = i + 1;
			for (; j < n; j++) {
				const l = at(j);
				if (l.trim() === '' || !l.includes('|')) break;
				out[j] = LineClass.Table;
			}
			lastText = j - 1;
			i = j - 1;
			continue;
		}
		if (t !== '') lastText = i;
	}
	return out;
}

type LineType = 'blank' | 'heading' | 'list' | 'quote' | 'table' | 'rule' | 'underline' | 'footnote' | 'html' | 'html7' | 'plain';

function lineType(line: string, cls: number | undefined): LineType {
	if (line.trim() === '') return 'blank';
	if (cls === LineClass.Table) return 'table';
	if (RULE.test(line)) return 'rule';
	if (/^ {0,3}=+[ \t]*$/.test(line)) return 'underline';
	if (HEADING.test(line)) return 'heading';
	if (QUOTE.test(line)) return 'quote';
	if (TABLE.test(line)) return 'table';
	if (FOOTNOTE.test(line)) return 'footnote';
	if (LIST.test(line)) return 'list';
	if (HTML_BLOCK.test(line)) return 'html';
	if (HTML_LONE_TAG.test(line)) return 'html7';
	return 'plain';
}

/** Heading text as Obsidian stores it: no hashes, no closing hashes, trimmed. */
export function headingText(line: string): string | null {
	const m = HEADING.exec(bare(line));
	if (!m) return null;
	const text = (m[2] ?? '').replace(/[ \t]+#+$/, '').trim();
	return text === '' || /^#+$/.test(text) ? null : text;
}

/**
 * Finds the block that holds `line` (0-based).
 * A list item is its own line plus its lazy continuation lines; child items are other blocks.
 * A quote (with its lazy lines), a callout and a table are one block each. A paragraph over a setext
 * underline is a heading. Code, math, comments, HTML, footnote definitions, thematic breaks, front matter
 * and empty lines are refused. Only the lines that the search touches are read.
 */
export function findBlock(rawLines: readonly string[], line: number, classes?: Uint8Array): BlockResult {
	const n = rawLines.length;
	const cls = classes ?? classifyLines(rawLines);
	const at = (i: number) => bare(rawLines[i]);
	if (line < 0 || line >= n) return { kind: 'empty', refused: true };
	const c = cls[line];
	if (c === LineClass.Frontmatter) return { kind: 'frontmatter', refused: true };
	if (c === LineClass.Code) return { kind: 'code', refused: true };
	if (c === LineClass.Math) return { kind: 'math', refused: true };
	if (c === LineClass.Comment) return { kind: 'comment', refused: true };
	if (c === LineClass.Html) return { kind: 'html', refused: true };
	const textAt = (i: number) => i >= 0 && i < n && (cls[i] === LineClass.Text || cls[i] === LineClass.Table);
	const raw = (i: number): LineType => (textAt(i) ? lineType(at(i), cls[i]) : 'blank');
	/**
	 * The line type in context. A lone tag (HTML condition 7) cannot interrupt a paragraph, a list item or a
	 * quote, so under text it is a plain line of that block. After a blank line it starts an HTML block.
	 */
	const type = (i: number): LineType => {
		const t = raw(i);
		if (t !== 'html7') return t;
		let k = i - 1;
		while (raw(k) === 'html7') k--;
		const above = raw(k);
		return above === 'plain' || above === 'list' || above === 'quote' ? 'plain' : 'html';
	};
	/** A - or = line right under a plain line: the underline of a setext heading. */
	const isUnderline = (i: number) => UNDERLINE.test(at(i)) && type(i - 1) === 'plain' && textAt(i);

	// A loop, not recursion: a long run of -- lines must not overflow the stack.
	while (line > 0 && isUnderline(line)) line--;
	const t = type(line);
	if (t === 'blank') return { kind: 'empty', refused: true };
	if (t === 'rule' || t === 'underline') return { kind: 'rule', refused: true };
	if (t === 'footnote') return { kind: 'footnote', refused: true };
	if (t === 'html') return { kind: 'html', refused: true };

	if (t === 'heading') {
		const heading = headingText(at(line));
		if (heading === null) return { kind: 'empty', refused: true };
		return { kind: 'heading', start: line, end: line, id: null, heading };
	}

	if (t === 'table') {
		let start = line;
		while (type(start - 1) === 'table') start--;
		let end = line;
		while (type(end + 1) === 'table') end++;
		return { kind: 'table', start, end, id: structuredId(at, end), heading: null };
	}

	if (t === 'quote') return quoteBlock(line);

	if (ID_LINE.test(at(line))) {
		// A lone id line after a table or a quote belongs to that block. Obsidian links it to the block above.
		const above = line >= 2 && at(line - 1).trim() === '' ? type(line - 2) : 'blank';
		if (above === 'table' || above === 'quote') return { kind: 'id-line', refused: true };
	}

	// List item, paragraph or setext heading. Walk up over plain lines to the start.
	let start = line;
	if (t === 'plain') {
		while (type(start - 1) === 'plain') start--;
		const above = type(start - 1);
		if (above === 'list') start--;
		else if (above === 'quote') return quoteBlock(start - 1);
		else if (above === 'footnote') return { kind: 'footnote', refused: true };
		else if (above === 'html') return { kind: 'html', refused: true };
	}
	let end = start;
	while (type(end + 1) === 'plain' && !isUnderline(end + 1)) end++;
	const first = at(start);
	if (!LIST.test(first) && isUnderline(end + 1)) {
		const heading: string[] = [];
		for (let i = start; i <= end; i++) heading.push(at(i).trim());
		return { kind: 'heading', start, end, id: null, heading: heading.join(' ') };
	}
	const kind: BlockKind = LIST.test(first) ? (TASK.test(first) ? 'task' : 'list') : 'paragraph';
	const m = END_ID.exec(at(end));
	return { kind, start, end, id: m ? (m[1] ?? null) : null, heading: null };

	/** A quote or callout: its quote lines and lazy plain lines. An id at the end of its last line counts. */
	function quoteBlock(from: number): Block {
		let start = from;
		while (type(start - 1) === 'quote' || (type(start - 1) === 'plain' && lazyQuote(start - 1))) start--;
		let end = from;
		while (type(end + 1) === 'quote' || type(end + 1) === 'plain') end++;
		const kind: BlockKind = CALLOUT.test(at(start)) ? 'callout' : 'quote';
		const m = END_ID.exec(at(end));
		return { kind, start, end, id: m ? (m[1] ?? null) : structuredId(at, end), heading: null };
	}

	/** A plain line is a lazy quote line when the nearest non-plain line above it is a quote line. */
	function lazyQuote(i: number): boolean {
		let k = i;
		while (type(k) === 'plain') k--;
		return type(k) === 'quote';
	}
}

/** The id of a table or a quote: on the next line, or on the line after one blank line. */
function structuredId(at: (i: number) => string, end: number): string | null {
	const next = at(end + 1);
	const direct = ID_LINE.exec(next);
	if (direct) return direct[1] ?? null;
	if (next.trim() !== '') return null;
	const after = ID_LINE.exec(at(end + 2));
	return after ? (after[1] ?? null) : null;
}

/** A block id that Obsidian knows from the metadata cache: its id and its line range. */
export interface KnownId {
	id: string;
	start: number;
	end: number;
}

/**
 * Takes an id from the metadata cache for a block that the text parser found no id for. The id must be in the
 * place where Obsidian reads it (end of the block, or the id line after a quote, callout or table), so a stale cache cannot give an id that is gone.
 */
export function reuseId(rawLines: readonly string[], block: Block, known: readonly KnownId[]): Block {
	if (block.kind === 'heading' || block.id !== null) return block;
	// Only where Obsidian reads an id: at the end of the last line, or (quote, callout, table) on the id line
	// after the block. An id in the middle of the text is plain text now, so the plugin makes a new id.
	const places: string[] = [];
	const end = END_ID.exec(bare(rawLines[block.end]));
	if (end) places.push((end[1] ?? '').toLowerCase());
	if (block.kind === 'quote' || block.kind === 'callout' || block.kind === 'table') {
		const after = structuredId((i) => bare(rawLines[i]), block.end);
		if (after) places.push(after.toLowerCase());
	}
	for (const k of known) {
		if (k.end < block.start || k.start > block.end) continue;
		if (places.includes(k.id.toLowerCase())) return { ...block, id: k.id };
	}
	return block;
}

/** Every block id in the note text, in lower case (Obsidian matches ids without case). */
export function collectIds(text: string): string[] {
	const out = new Set<string>();
	for (const m of text.matchAll(/(?:^|\s)\^([A-Za-z0-9-]+)[ \t]*\r?$/gm)) out.add((m[1] ?? '').toLowerCase());
	return [...out];
}

const ID_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** A new random id of 6 characters a-z and 0-9, as core makes. It is not in `taken` (compared without case). */
export function newBlockId(taken: readonly string[], rand: () => number = Math.random): string {
	const used = new Set(taken.map((t) => t.toLowerCase()));
	for (let attempt = 0; attempt < 1000; attempt++) {
		let id = '';
		for (let i = 0; i < 6; i++) id += ID_CHARS.charAt(Math.floor(rand() * ID_CHARS.length) % ID_CHARS.length);
		if (!used.has(id)) return id;
	}
	// 36^6 ids: this line runs only with a broken random source.
	let n = 0;
	while (used.has(`id-${n}`)) n++;
	return `id-${n}`;
}

/**
 * Pro: a readable id from the first three words of the block text, for example ^call-bob.
 * Returns null when the text has no letters or digits. Adds -2, -3 and so on when the id is taken.
 */
export function readableBlockId(blockText: string, taken: readonly string[]): string | null {
	const used = new Set(taken.map((t) => t.toLowerCase()));
	const text = bare(blockText.split('\n')[0] ?? '')
		.replace(/^\s*(?:>\s*)*(?:\[![^\]]*\][+-]?\s*)?/, '')
		.replace(/^\s*(?:[-*+]|\d{1,9}[.)])\s+(?:\[.\]\s+)?/, '')
		.replace(/^#{1,6}\s+/, '')
		.replace(END_ID, '')
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '');
	const words = text.match(/[a-z0-9]+/g) ?? [];
	let base = words.slice(0, 3).join('-').slice(0, 24).replace(/-+$/, '');
	if (base === '') return null;
	if (/^\d+$/.test(base)) base = `b-${base}`;
	if (!used.has(base)) return base;
	for (let n = 2; ; n++) if (!used.has(`${base}-${n}`)) return `${base}-${n}`;
}

export interface Insertion {
	/** 0-based line; the text goes at the end of this line. */
	line: number;
	text: string;
}

/**
 * Where the new id goes and what to insert.
 * Paragraph, list item and task: " ^id" at the end of the last line.
 * Quote, callout and table: the id on its own line, with a blank line before it and after it.
 * Returns null for a heading or a block that has an id.
 */
export function idInsertion(rawLines: readonly string[], block: Block, id: string, eol = '\n'): Insertion | null {
	if (block.kind === 'heading' || block.id !== null) return null;
	const last = bare(rawLines[block.end] ?? '');
	if (block.kind === 'quote' || block.kind === 'callout' || block.kind === 'table') {
		const next = rawLines[block.end + 1];
		const tail = next !== undefined && bare(next).trim() !== '' ? eol : '';
		return { line: block.end, text: `${eol}${eol}^${id}${tail}` };
	}
	return { line: block.end, text: `${/\s$/.test(last) || last === '' ? '' : ' '}^${id}` };
}

/** Applies an insertion to the note text. Every other byte stays the same. Keeps CRLF line ends. */
export function applyInsertion(text: string, ins: Insertion): string {
	let offset = 0;
	for (let i = 0; i < ins.line; i++) {
		const nl = text.indexOf('\n', offset);
		if (nl < 0) return text;
		offset = nl + 1;
	}
	let end = text.indexOf('\n', offset);
	if (end < 0) end = text.length;
	if (end > offset && text.charAt(end - 1) === '\r') end--;
	return text.slice(0, end) + ins.text + text.slice(end);
}

/**
 * The link subpath of a heading, by the core rule: the characters : # | ^ \ and the pairs %%, [[ and ]]
 * become a space, and runs of spaces become one space.
 */
export function headingSubpath(heading: string): string {
	return heading
		.replace(/([:#|^\\\r\n]|%%|\[\[|]])/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

/** The subpath (with #) of a block for a link: #Heading or #^id. */
export function subpathFor(block: Block, id: string | null): string {
	if (block.kind === 'heading') return `#${headingSubpath(block.heading ?? '')}`;
	return `#^${id ?? block.id ?? ''}`;
}

/**
 * Link text for a drop. `generated` is the link that Obsidian made for the source note with this subpath
 * (fileManager.generateMarkdownLink), so the user's link format applies.
 * In the same note, the link has no note name: [[#Heading]], or [Heading](#Heading) in Markdown link format.
 */
export function buildLink(generated: string, subpath: string, sameNote: boolean, embed: boolean): string {
	let link = generated;
	if (sameNote) {
		if (generated.startsWith('[[')) link = `[[${subpath}]]`;
		else {
			const label = subpath.replace(/^#\^?/, '');
			const target = '#' + encodeURI(subpath.slice(1)).replace(/%5E/g, '^');
			link = `[${label.replace(/([[\]])/g, '\\$1')}](${target})`;
		}
	}
	return embed && !link.startsWith('!') ? `!${link}` : link;
}

/**
 * Pro: the blocks between two lines (inclusive), in order, each one time. Refused lines are skipped.
 */
export function blocksInRange(rawLines: readonly string[], from: number, to: number, classes?: Uint8Array): Block[] {
	const cls = classes ?? classifyLines(rawLines);
	const out: Block[] = [];
	let line = Math.max(0, Math.min(from, to));
	const last = Math.min(rawLines.length - 1, Math.max(from, to));
	while (line <= last) {
		const b = findBlock(rawLines, line, cls);
		if (isRefusal(b)) {
			line++;
			continue;
		}
		if (!out.some((o) => o.start === b.start)) out.push(b);
		line = Math.max(line, b.end) + 1;
	}
	return out;
}
